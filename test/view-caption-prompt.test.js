import assert from "node:assert/strict";
import test from "node:test";

import { openCaptionPrompt } from "../src/view/caption-prompt.js";

class Input extends EventTarget {
  constructor() {
    super();
    this.style = {};
    this.className = "";
    this.value = "";
    this.selection = null;
  }
  focus() { this.focused = true; }
  select() { this.selected = true; }
  setSelectionRange(a, b) { this.selection = [a, b]; }
  remove() { this.removed = true; }
}

function setup(opts = {}) {
  const frames = [];
  let t = 1000;
  const doc = { body: { children: [], append(n) { this.children.push(n); } }, createElement: () => new Input(), defaultView: { innerWidth: 1000, innerHeight: 800 } };
  const p = openCaptionPrompt({ doc, rect: { left: 100, top: 100, width: 50, height: 20 }, raf: (fn) => { frames.push(fn); return frames.length; }, now: () => t, ...opts });
  const run = () => frames.shift()();
  return { doc, p, run, input: () => doc.body.children[0], advance: (ms) => { t += ms; } };
}
const key = (key, extra = {}) => Object.assign(new Event("keydown", { cancelable: true }), { key, ...extra });

test("opens on the next frame with the mm-input classes, focused, caret at the end", () => {
  const s = setup({ initial: "12 Site" });
  assert.equal(s.doc.body.children.length, 0);
  s.run();
  const el = s.input();
  assert.match(el.className, /plexus-portal plexus-mm-input plexus-caption-prompt/);
  assert.equal(el.value, "12 Site");
  assert.equal(el.focused, true);
  assert.deepEqual(el.selection, [7, 7]);
  assert.equal(el.style.left, "100px");
  assert.equal(el.style.top, "126px");
});

test("select: true selects the whole value", () => {
  const s = setup({ initial: "x", select: true });
  s.run();
  assert.equal(s.input().selected, true);
});

test("Enter resolves the raw value and removes the input; IME Enter is ignored", async () => {
  const s = setup();
  s.run();
  const el = s.input();
  el.value = "  Site 12 ";
  el.dispatchEvent(key("Enter", { isComposing: true }));
  assert.equal(el.removed, undefined);
  el.dispatchEvent(key("Enter"));
  assert.equal(await s.p, "  Site 12 ");
  assert.equal(el.removed, true);
});

test("Escape resolves empty by default and null with escape: cancel", async () => {
  const a = setup();
  a.run();
  a.input().dispatchEvent(key("Escape"));
  assert.equal(await a.p, "");
  const b = setup({ escape: "cancel", initial: "keep" });
  b.run();
  b.input().dispatchEvent(key("Escape"));
  assert.equal(await b.p, null);
});

test("blur in the first 200 ms is ignored and refocuses; later blur commits; blur into the suggest is ignored", async () => {
  const s = setup({ initial: "a" });
  s.run();
  const el = s.input();
  el.focused = false;
  el.dispatchEvent(new Event("blur"));
  assert.equal(el.focused, true);
  assert.equal(el.removed, undefined);
  s.advance(300);
  el.dispatchEvent(Object.assign(new Event("blur"), { relatedTarget: { closest: (sel) => (sel === ".plexus-suggest" ? {} : null) } }));
  assert.equal(el.removed, undefined);
  el.value = "b";
  el.dispatchEvent(new Event("blur"));
  assert.equal(await s.p, "b");
});

test("cancel() resolves null, also before the first frame, and the frame then does nothing", async () => {
  const a = setup();
  a.p.cancel();
  assert.equal(await a.p, null);
  a.run();
  assert.equal(a.doc.body.children.length, 0);
  const b = setup();
  b.run();
  b.p.cancel();
  assert.equal(await b.p, null);
  assert.equal(b.input().removed, true);
});

test("opening a second prompt commits the first", async () => {
  const doc = { body: { children: [], append(n) { this.children.push(n); } }, createElement: () => new Input() };
  const frames = [];
  const raf = (fn) => { frames.push(fn); };
  const first = openCaptionPrompt({ doc, initial: "one", raf, now: () => 0 });
  frames.shift()();
  const second = openCaptionPrompt({ doc, initial: "two", raf, now: () => 0 });
  assert.equal(await first, "one");
  frames.shift()();
  doc.body.children[1].dispatchEvent(key("Enter"));
  assert.equal(await second, "two");
});

test("keyboard and input events stop at the input; other keys do not resolve", () => {
  const s = setup();
  s.run();
  const el = s.input();
  let leaked = 0;
  const parent = new EventTarget();
  for (const type of ["keydown", "keyup", "keypress", "beforeinput", "input", "paste", "copy", "cut"]) {
    const ev = Object.assign(new Event(type, { cancelable: true }), { key: "a" });
    let stopped = false;
    ev.stopPropagation = () => { stopped = true; };
    el.dispatchEvent(ev);
    if (!stopped) leaked++;
  }
  assert.equal(leaked, 0);
  assert.equal(el.removed, undefined);
  void parent;
});
