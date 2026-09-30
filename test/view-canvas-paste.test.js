import assert from "node:assert/strict";
import test from "node:test";

import { excalidrawClipboardToText, installCanvasPaste } from "../src/view/canvas-paste.js";

const payload = (elements) => JSON.stringify({ type: "excalidraw/clipboard", elements, files: {} });
const el = (o) => ({ id: o.id ?? Math.random().toString(36), type: "rectangle", x: 0, y: 0, width: 100, height: 40, ...o });

function setup({ value = "", caret, id = "block-input-abc-body-outline-pageuid01-blockuid1", cls = true } = {}) {
  const listeners = {};
  const win = {
    addEventListener(t, f, c) { (listeners[t] ||= []).push({ f, c }); },
    removeEventListener(t, f) { listeners[t] = (listeners[t] || []).filter((x) => x.f !== f); },
  };
  const toasts = [], sibs = [], inserts = [];
  const off = installCanvasPaste({
    win, doc: {}, toast: (m) => toasts.push(m),
    createSibling: (a) => { sibs.push(a); return Promise.resolve(); },
    insertText: (ta, t) => inserts.push(t),
  });
  const ta = { tagName: "TEXTAREA", id, className: cls ? "rm-block-input" : "", value, selectionStart: caret ?? value.length };
  const paste = (text, extra = {}) => {
    const ev = { target: ta, defaultPrevented: false, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; },
      clipboardData: { types: ["text/plain"], getData: () => text }, ...extra };
    for (const { f } of listeners.paste || []) f(ev);
    return ev;
  };
  return { listeners, off, toasts, sibs, inserts, paste, ta };
}

test("reading order, rows by vertical centre, then x", () => {
  const r = excalidrawClipboardToText(payload([
    el({ type: "text", text: "c", y: 100 }),
    el({ type: "text", text: "b", x: 200, y: 4 }),
    el({ type: "text", text: "a", x: 0, y: 0 }),
  ]));
  assert.deepEqual(r.lines, ["a", "b", "c"]);
});

test("per-element rules", () => {
  const r = excalidrawClipboardToText(payload([
    el({ id: "anc", customData: { plexus: { embed: "((abcdefghi))" } }, y: 0 }),
    el({ type: "text", containerId: "anc", text: "label", y: 0 }),
    el({ type: "text", text: "wrapped", originalText: "original", y: 50 }),
    el({ type: "image", customData: { firebaseUrl: "https://x/y.png" }, y: 100 }),
    el({ type: "image", customData: { firebaseUrl: "http://x/y.png" }, y: 150 }),
    el({ type: "image", y: 160 }),
    el({ link: "[[Page]]", y: 200 }),
    el({ link: "https://example.com", y: 250 }),
    el({ type: "arrow", y: 300 }),
    el({ type: "frame", y: 350 }),
    el({ type: "text", text: "gone", isDeleted: true, y: 400 }),
  ]));
  assert.deepEqual(r.lines, ["((abcdefghi))", "original", "![](https://x/y.png)", "[[Page]]"]);
});

test("non-clipboard JSON is null; empty payload gives empty lines", () => {
  assert.equal(excalidrawClipboardToText("{"), null);
  assert.equal(excalidrawClipboardToText('{"type":"x"}'), null);
  assert.deepEqual(excalidrawClipboardToText(payload([el({})])), { lines: [] });
});

test("acts: first line inserted, rest as siblings, Roam stopped", async () => {
  const t = setup();
  const ev = t.paste(payload([el({ type: "text", text: "one" }), el({ type: "text", text: "two", y: 100 })]));
  assert.equal(ev.prevented, true);
  assert.equal(ev.stopped, true);
  assert.deepEqual(t.inserts, ["one"]);
  assert.deepEqual(t.sibs, [{ uid: "blockuid1", strings: ["two"] }]);
});

test("a single line adds no siblings", () => {
  const t = setup();
  t.paste(payload([el({ type: "text", text: "one" })]));
  assert.equal(t.sibs.length, 0);
});

test("empty result outside code is swallowed with a toast", () => {
  const t = setup();
  const ev = t.paste(payload([el({})]));
  assert.equal(ev.prevented, true);
  assert.equal(ev.stopped, true);
  assert.equal(t.inserts.length, 0);
  assert.match(t.toasts[0], /Nothing to paste/);
});

test("bail-outs leave the paste to Roam", () => {
  const json = payload([el({ type: "text", text: "one" })]);
  const cases = [
    setup().paste(json, { defaultPrevented: true }),
    setup({ id: "other", cls: false }).paste(json),
    setup().paste(json, { clipboardData: { types: ["Files", "text/plain"], getData: () => json } }),
    setup().paste("plain text"),
    setup().paste('{"type":"excalidraw/clipboard", broken'),
    setup({ value: "```\ncode ", caret: 9 }).paste(json),
    setup({ value: "```js\nx\n```\nthen `in", caret: 20 }).paste(json),
    setup({ value: "```x```" }).paste(json),
  ];
  for (const ev of cases) { assert.equal(ev.prevented, false); assert.equal(ev.stopped, false); }
});

test("inline code with an even backtick count still converts", () => {
  const t = setup({ value: "see `a` ", caret: 8 });
  assert.equal(t.paste(payload([el({ type: "text", text: "one" })])).prevented, true);
});

test("caps at 100 lines with a toast", () => {
  const t = setup();
  const els = Array.from({ length: 120 }, (_, i) => el({ type: "text", text: `l${i}`, y: i * 100 }));
  t.paste(payload(els));
  assert.equal(t.sibs[0].strings.length, 99);
  assert.match(t.toasts[0], /100/);
});

test("registered on window capture and removed on dispose; never throws", () => {
  const t = setup();
  assert.equal(t.listeners.paste.length, 1);
  assert.equal(t.listeners.paste[0].c, true);
  assert.doesNotThrow(() => t.paste(payload([el({ type: "text", text: "a" })]), { preventDefault() { throw new Error("boom"); } }));
  t.off();
  assert.equal(t.listeners.paste.length, 0);
});

test("default insertText falls back to the native setter and input event", () => {
  const listeners = {};
  const win = { addEventListener(t, f) { listeners[t] = f; }, removeEventListener() {}, Event: class { constructor(type, o) { this.type = type; this.o = o; } } };
  const events = [];
  installCanvasPaste({ win, doc: { execCommand: () => false }, toast() {}, createSibling() {} });
  const ta = { tagName: "TEXTAREA", id: "block-input-x-blockuid1", className: "rm-block-input", value: "ab", selectionStart: 1, selectionEnd: 1, dispatchEvent: (e) => events.push(e.type), setSelectionRange() {} };
  listeners.paste({ target: ta, defaultPrevented: false, preventDefault() {}, stopImmediatePropagation() {}, clipboardData: { types: [], getData: () => payload([el({ type: "text", text: "X" })]) } });
  assert.equal(ta.value, "aXb");
  assert.deepEqual(events, ["input"]);
});
