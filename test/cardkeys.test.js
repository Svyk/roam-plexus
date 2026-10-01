import assert from "node:assert/strict";
import test from "node:test";

import { installCardKeys } from "../src/view/cardkeys.js";

function fakeNode() {
  const listeners = [];
  return {
    listeners,
    addEventListener(type, fn, capture) { listeners.push([type, fn, capture]); },
    removeEventListener(type, fn, capture) {
      const i = listeners.findIndex((l) => l[0] === type && l[1] === fn && l[2] === capture);
      if (i >= 0) listeners.splice(i, 1);
    },
  };
}

function key(target, extra = {}) {
  const e = {
    altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false,
    key: "", code: "", target, prevented: false, stopped: false, ...extra,
  };
  e.preventDefault = () => { e.prevented = true; };
  e.stopImmediatePropagation = () => { e.stopped = true; };
  return e;
}

function anchor(id, x, extra = {}) {
  return { id, x, y: 0, width: 20, height: 20, blockUid: null, regionUid: null, ...extra };
}

function install(overrides = {}) {
  const el = fakeNode();
  const doc = fakeNode();
  doc.body = { tagName: "BODY" };
  doc.documentElement = { tagName: "HTML" };
  const inside = new Set(overrides.inside ?? []);
  el.contains = (n) => inside.has(n);
  const anchors = overrides.anchors ?? [anchor("a", 0, { blockUid: "abcdefghi" }), anchor("b", 120)];
  const app = overrides.app ?? {
    state: { selectedElementIds: overrides.selected ?? { a: true }, editingTextElement: overrides.editing ?? null },
  };
  const calls = { select: [], copy: [], open: [], look: [] };
  let look = overrides.look ?? true;
  const off = installCardKeys({
    containerEl: el,
    doc,
    getApp: overrides.getApp ?? (() => app),
    getAnchors: overrides.getAnchors ?? (() => anchors),
    getElements: overrides.getElements ?? (() => overrides.elements ?? []),
    getSettings: overrides.getSettings ?? (() => ({})),
    onSelect: (id) => calls.select.push(id),
    onCopy: (text) => calls.copy.push(text),
    onOpen: (uid) => calls.open.push(uid),
    onQuickLook: (item) => { calls.look.push(item); return typeof look === "function" ? look(item) : look; },
  });
  const fire = (extra, target = el) => {
    const e = key(target, extra);
    for (const [, fn] of [...doc.listeners]) fn(e);
    return e;
  };
  return { el, doc, calls, off, fire, setLook: (v) => { look = v; } };
}

test("Alt+ArrowRight selects the next id and claims the event; a plain arrow does not", () => {
  const h = install();
  assert.equal(h.doc.listeners[0][0], "keydown");
  assert.equal(h.doc.listeners[0][2], true);
  assert.equal(h.el.listeners.length, 0);
  const hit = h.fire({ altKey: true, key: "ArrowRight", code: "ArrowRight" });
  assert.deepEqual(h.calls.select, ["b"]);
  assert.ok(hit.prevented && hit.stopped);
  const plain = h.fire({ key: "ArrowRight", code: "ArrowRight" });
  assert.equal(plain.prevented, false);
  assert.equal(plain.stopped, false);
  assert.deepEqual(h.calls.select, ["b"]);
  const alone = install({ anchors: [anchor("a", 0, { blockUid: "abcdefghi" })] });
  const miss = alone.fire({ altKey: true, key: "ArrowRight", code: "ArrowRight" });
  assert.equal(miss.prevented, false);
  assert.equal(miss.stopped, false);
  assert.deepEqual(alone.calls.select, []);
});

test("editingTextElement or a null app blocks Alt+Arrow", () => {
  const editing = install({ editing: { id: "t" } });
  const blocked = editing.fire({ altKey: true, key: "ArrowRight", code: "ArrowRight" });
  assert.equal(blocked.prevented, false);
  assert.deepEqual(editing.calls.select, []);
  const missing = install({ getApp: () => null });
  const skipped = missing.fire({ altKey: true, key: "ArrowRight", code: "ArrowRight" });
  assert.equal(skipped.prevented, false);
  assert.deepEqual(missing.calls.select, []);
});

test("two selected ids do nothing", () => {
  const h = install({ selected: { a: true, b: true } });
  const e = h.fire({ altKey: true, key: "ArrowRight", code: "ArrowRight" });
  assert.equal(e.prevented, false);
  assert.equal(e.stopped, false);
  assert.deepEqual(h.calls.select, []);
});

test("Shift+Tab selects the parent, and does not claim when there is none", () => {
  const elements = [{ id: "a", frameId: "p" }, { id: "p", type: "frame" }];
  const anchors = [anchor("a", 0, { blockUid: "abcdefghi" }), anchor("p", 0, { y: -200 })];
  const h = install({ anchors, elements });
  const hit = h.fire({ shiftKey: true, key: "Tab", code: "Tab" });
  assert.deepEqual(h.calls.select, ["p"]);
  assert.ok(hit.prevented && hit.stopped);
  const none = install({ anchors: [anchor("a", 0, { blockUid: "abcdefghi" })], elements: [{ id: "a" }] });
  const miss = none.fire({ shiftKey: true, key: "Tab", code: "Tab" });
  assert.equal(miss.prevented, false);
  assert.equal(miss.stopped, false);
  assert.deepEqual(none.calls.select, []);
});

test("meta+L and ctrl+L copy the block link, and a null blockUid does not claim", () => {
  const h = install();
  const meta = h.fire({ metaKey: true, key: "l", code: "KeyL" });
  const ctrl = h.fire({ ctrlKey: true, key: "L", code: "KeyL" });
  assert.deepEqual(h.calls.copy, ["((abcdefghi))", "((abcdefghi))"]);
  assert.ok(meta.prevented && meta.stopped && ctrl.prevented && ctrl.stopped);
  const empty = install({ anchors: [anchor("a", 0, { blockUid: null }), anchor("b", 120)] });
  const miss = empty.fire({ metaKey: true, key: "l", code: "KeyL" });
  assert.equal(miss.prevented, false);
  assert.equal(miss.stopped, false);
  assert.deepEqual(empty.calls.copy, []);
});

test("Alt+Enter calls onOpen with the block uid", () => {
  const h = install();
  const e = h.fire({ altKey: true, key: "Enter", code: "Enter" });
  assert.deepEqual(h.calls.open, ["abcdefghi"]);
  assert.ok(e.prevented && e.stopped);
});

test("Space claims only when onQuickLook returns true", () => {
  const h = install({ look: false });
  const no = h.fire({ code: "Space", key: " " });
  assert.equal(no.prevented, false);
  assert.equal(no.stopped, false);
  assert.equal(h.calls.look.length, 1);
  assert.equal(h.calls.look[0].id, "a");
  h.setLook(true);
  const yes = h.fire({ code: "Space", key: " " });
  assert.ok(yes.prevented && yes.stopped);
  assert.equal(h.calls.look.length, 2);
});

test("cardAltArrows false lets Alt+Arrow through", () => {
  const h = install({ getSettings: () => ({ cardAltArrows: false }) });
  const e = h.fire({ altKey: true, key: "ArrowRight", code: "ArrowRight" });
  assert.equal(e.prevented, false);
  assert.equal(e.stopped, false);
  assert.deepEqual(h.calls.select, []);
});

test("dispose removes the listener", () => {
  const h = install();
  h.fire({ altKey: true, key: "ArrowRight", code: "ArrowRight" });
  assert.equal(h.calls.select.length, 1);
  h.off();
  assert.equal(h.doc.listeners.length, 0);
  const again = h.fire({ altKey: true, key: "ArrowRight", code: "ArrowRight" });
  assert.equal(again.prevented, false);
  assert.equal(h.calls.select.length, 1);
});

test("text fields and outside targets are ignored; body and documentElement count as inside", () => {
  const input = { tagName: "INPUT" };
  const area = { tagName: "TEXTAREA" };
  const rich = { tagName: "DIV", isContentEditable: true };
  const outside = { tagName: "DIV" };
  const h = install({ inside: [input, area, rich] });
  for (const target of [input, area, rich, outside]) {
    const e = h.fire({ altKey: true, key: "ArrowRight", code: "ArrowRight" }, target);
    assert.equal(e.prevented, false, target.tagName);
  }
  const composing = h.fire({ altKey: true, key: "ArrowRight", code: "ArrowRight", isComposing: true });
  assert.equal(composing.prevented, false);
  assert.deepEqual(h.calls.select, []);
  const body = h.fire({ altKey: true, key: "ArrowRight", code: "ArrowRight" }, h.doc.body);
  const root = h.fire({ altKey: true, key: "ArrowRight", code: "ArrowRight" }, h.doc.documentElement);
  assert.ok(body.prevented && root.prevented);
  assert.deepEqual(h.calls.select, ["b", "b"]);
});
