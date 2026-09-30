import assert from "node:assert/strict";
import test from "node:test";

import { installRefPaste, pastedRef } from "../src/view/paste.js";

function setup({ settings = { pasteRefs: "embed" }, exists = () => true, hit = "CANVAS" } = {}) {
  const listeners = {};
  const containerEl = {
    addEventListener(t, f) { (listeners[t] ||= []).push(f); },
    removeEventListener(t, f) { listeners[t] = (listeners[t] || []).filter((x) => x !== f); },
  };
  const canvas = { tagName: hit, parentNode: containerEl };
  const doc = { elementFromPoint: () => canvas };
  const app = { state: { scrollX: 0, scrollY: 0, zoom: { value: 2 }, offsetLeft: 0, offsetTop: 0 } };
  const refs = [];
  let t = 1000;
  const off = installRefPaste({ doc, containerEl, app, getSettings: () => settings, exists, onRef: (r) => refs.push(r), now: () => t });
  const fire = (type, ev) => { for (const f of listeners[type] || []) f(ev); return ev; };
  const paste = (text, extra = {}) => fire("paste", {
    target: canvas, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; },
    clipboardData: { files: [], types: ["text/plain"], getData: () => text }, ...extra,
  });
  const move = () => fire("pointermove", { clientX: 100, clientY: 60 });
  return { listeners, off, refs, paste, move, fire, app, advance: (ms) => { t += ms; }, settings };
}

test("pastedRef accepts only a single ((uid)) or [[Page]]", () => {
  assert.equal(pastedRef("((abcdefghi))").kind, "block");
  assert.equal(pastedRef(" [[My Page]] ").kind, "page");
  for (const bad of ["Something", "abcdefghi", "plexus:today", "[[a\nb]]", "((abcdefghi))\n((abcdefghj))", "", null]) assert.equal(pastedRef(bad), null, String(bad));
});

test("a ref pasted over the canvas is consumed and reported with a scene point", () => {
  const t = setup();
  t.move();
  const ev = t.paste("((abcdefghi))");
  assert.equal(ev.prevented, true);
  assert.equal(ev.stopped, true);
  assert.deepEqual(t.refs, [{ kind: "block", ref: "((abcdefghi))", scenePoint: { x: 50, y: 30 } }]);
});

test("setting text (or unknown) passes through, read on every event", () => {
  const t = setup({ settings: { pasteRefs: "text" } });
  t.move();
  assert.equal(t.paste("((abcdefghi))").prevented, false);
  t.settings.pasteRefs = "link";
  assert.equal(t.paste("[[Page]]").prevented, true);
  t.settings.pasteRefs = "bogus";
  assert.equal(t.paste("[[Page]]").prevented, false);
  assert.equal(t.refs.length, 1);
});

test("passes through for editable targets, text editing, files, non-canvas hit, no pointer, missing refs and plain text", () => {
  const t = setup();
  assert.equal(t.paste("((abcdefghi))").prevented, false, "no pointer yet");
  t.move();
  assert.equal(t.paste("((abcdefghi))", { target: { tagName: "TEXTAREA" } }).prevented, false);
  assert.equal(t.paste("((abcdefghi))", { target: { tagName: "DIV", isContentEditable: true } }).prevented, false);
  t.app.state.editingTextElement = { id: "x" };
  assert.equal(t.paste("((abcdefghi))").prevented, false);
  t.app.state.editingTextElement = null;
  assert.equal(t.paste("((abcdefghi))", { clipboardData: { files: [{}], types: ["Files"], getData: () => "((abcdefghi))" } }).prevented, false);
  assert.equal(t.paste("Something").prevented, false);
  assert.equal(t.paste("((abcdefghi))\nmore").prevented, false);
  assert.deepEqual(t.refs, []);
  const missing = setup({ exists: () => false });
  missing.move();
  assert.equal(missing.paste("((missing01))").prevented, false);
  const notCanvas = setup({ hit: "DIV" });
  notCanvas.move();
  assert.equal(notCanvas.paste("((abcdefghi))").prevented, false);
});

test("Shift+Ctrl/Cmd+V within 100 ms is a plain paste and stays text", () => {
  const t = setup();
  t.move();
  t.fire("keydown", { ctrlKey: true, shiftKey: true, code: "KeyV", key: "V" });
  t.advance(50);
  assert.equal(t.paste("((abcdefghi))").prevented, false);
  t.advance(200);
  assert.equal(t.paste("((abcdefghi))").prevented, true);
  t.fire("keydown", { metaKey: true, shiftKey: false, code: "KeyV", key: "v" });
  t.advance(10);
  assert.equal(t.paste("((abcdefghi))").prevented, true, "plain Ctrl+V without Shift is not plain paste");
});

test("the disposer removes every listener", () => {
  const t = setup();
  t.off();
  for (const list of Object.values(t.listeners)) assert.equal(list.length, 0);
});
