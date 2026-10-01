import assert from "node:assert/strict";
import test from "node:test";

import { lassoToFraction, startImageRegionTool } from "../src/view/image-region-tool.js";

class El extends EventTarget {
  constructor() {
    super();
    this.style = {};
    this.children = [];
    this.className = "";
  }
  append(...c) { this.children.push(...c); }
  remove() { this.removed = true; }
  contains(t) { return t === this || this.children.includes(t); }
  setPointerCapture() {}
}

function fakeDoc() {
  const doc = new EventTarget();
  doc.body = new El();
  doc.createElement = () => new El();
  return doc;
}

const ev = (type, props = {}) => Object.assign(new Event(type, { cancelable: true }), { pointerId: 1, buttons: 1, button: 0, ...props });
const rect = { left: 100, top: 100, width: 200, height: 100 };

test("plain drag resolves a rect result", async () => {
  const doc = fakeDoc();
  const tool = startImageRegionTool({ doc, imageRect: rect });
  const overlay = doc.body.children[0];
  overlay.dispatchEvent(ev("pointerdown", { clientX: 110, clientY: 110 }));
  overlay.dispatchEvent(ev("pointermove", { clientX: 210, clientY: 160 }));
  overlay.dispatchEvent(ev("pointerup", { clientX: 210, clientY: 160 }));
  assert.deepEqual(await tool, { kind: "rect", f: [0.05, 0.1, 0.5, 0.5], altKey: false });
});

test("Alt-drag is a lasso sampled every 4 px or more and closes on release", async () => {
  const doc = fakeDoc();
  const tool = startImageRegionTool({ doc, imageRect: rect });
  const overlay = doc.body.children[0];
  overlay.dispatchEvent(ev("pointerdown", { clientX: 110, clientY: 110, altKey: true }));
  for (const [x, y] of [[112, 110], [150, 110], [151, 111], [150, 150], [110, 150]]) {
    overlay.dispatchEvent(ev("pointermove", { clientX: x, clientY: y, altKey: true }));
  }
  overlay.dispatchEvent(ev("pointerup", { clientX: 110, clientY: 150 }));
  assert.deepEqual(await tool, { kind: "lasso", p: [0.05, 0.1, 0.25, 0.1, 0.25, 0.5, 0.05, 0.5], altKey: false });
});

test("Escape cancels an in-progress lasso", async () => {
  const doc = fakeDoc();
  const tool = startImageRegionTool({ doc, imageRect: rect });
  const overlay = doc.body.children[0];
  overlay.dispatchEvent(ev("pointerdown", { clientX: 110, clientY: 110, altKey: true }));
  overlay.dispatchEvent(ev("pointermove", { clientX: 150, clientY: 110 }));
  doc.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
  assert.equal(await tool, null);
  assert.equal(overlay.removed, true);
});

test("lassoToFraction clamps to the image box and rejects tiny or degenerate loops", () => {
  const out = lassoToFraction([{ x: 50, y: 100 }, { x: 400, y: 100 }, { x: 400, y: 300 }], rect);
  assert.deepEqual(out, { p: [0, 0, 1, 0, 1, 1] });
  assert.equal(lassoToFraction([{ x: 110, y: 110 }, { x: 112, y: 110 }, { x: 110, y: 112 }], rect), null);
  assert.equal(lassoToFraction([{ x: 110, y: 110 }, { x: 150, y: 110 }], rect), null);
});

test("a click that moves under 4 px is a pin, even with Alt, and reports displayed-box fractions", async () => {
  const doc = fakeDoc();
  const tool = startImageRegionTool({ doc, imageRect: rect, setTimeout: () => 1, clearTimeout() {} });
  const overlay = doc.body.children[0];
  overlay.dispatchEvent(ev("pointerdown", { clientX: 200, clientY: 150, altKey: true }));
  overlay.dispatchEvent(ev("pointermove", { clientX: 202, clientY: 151, altKey: true }));
  overlay.dispatchEvent(ev("pointerup", { clientX: 202, clientY: 151, altKey: true }));
  assert.deepEqual(await tool, { kind: "pin", x: 0.51, y: 0.51 });
});

test("a pin keeps the overlay to swallow the trailing click, then removes it on that click", async () => {
  const doc = fakeDoc();
  const tool = startImageRegionTool({ doc, imageRect: rect, setTimeout: () => 7, clearTimeout() {} });
  const overlay = doc.body.children[0];
  overlay.dispatchEvent(ev("pointerdown", { clientX: 200, clientY: 150 }));
  overlay.dispatchEvent(ev("pointerup", { clientX: 200, clientY: 150 }));
  await tool;
  assert.equal(overlay.removed, undefined);
  overlay.dispatchEvent(ev("mouseup"));
  assert.equal(overlay.removed, undefined);
  overlay.dispatchEvent(ev("click"));
  assert.equal(overlay.removed, true);
});

test("the overlay is removed 50 ms after pointerup when no click arrives, and cancel() removes it at once", async () => {
  const doc = fakeDoc();
  const timers = [];
  const cleared = [];
  const opts = { setTimeout: (fn, ms) => { timers.push([fn, ms]); return timers.length; }, clearTimeout: (id) => cleared.push(id) };
  const tool = startImageRegionTool({ doc, imageRect: rect, ...opts });
  const overlay = doc.body.children[0];
  overlay.dispatchEvent(ev("pointerdown", { clientX: 110, clientY: 110 }));
  overlay.dispatchEvent(ev("pointermove", { clientX: 210, clientY: 160 }));
  overlay.dispatchEvent(ev("pointerup", { clientX: 210, clientY: 160 }));
  await tool;
  assert.equal(timers.length, 1);
  assert.equal(timers[0][1], 50);
  assert.equal(overlay.removed, undefined);
  timers[0][0]();
  assert.equal(overlay.removed, true);

  const doc2 = fakeDoc();
  const tool2 = startImageRegionTool({ doc: doc2, imageRect: rect, ...opts });
  const overlay2 = doc2.body.children[0];
  overlay2.dispatchEvent(ev("pointerdown", { clientX: 200, clientY: 150 }));
  overlay2.dispatchEvent(ev("pointerup", { clientX: 200, clientY: 150 }));
  await tool2;
  tool2.cancel();
  assert.equal(overlay2.removed, true);
  assert.ok(cleared.length >= 1);
});

test("Alt released over a plain drag reports altKey from pointerup", async () => {
  const doc = fakeDoc();
  const tool = startImageRegionTool({ doc, imageRect: rect, setTimeout: () => 1, clearTimeout() {} });
  const overlay = doc.body.children[0];
  overlay.dispatchEvent(ev("pointerdown", { clientX: 110, clientY: 110 }));
  overlay.dispatchEvent(ev("pointermove", { clientX: 290, clientY: 190 }));
  overlay.dispatchEvent(ev("pointerup", { clientX: 290, clientY: 190, altKey: true }));
  const out = await tool;
  assert.equal(out.kind, "rect");
  assert.equal(out.altKey, true);
});

test("a middle or right button press cancels the tool and creates nothing", async () => {
  for (const button of [1, 2]) {
    const doc = fakeDoc();
    const tool = startImageRegionTool({ doc, imageRect: rect, setTimeout: () => 1, clearTimeout() {} });
    const overlay = doc.body.children[0];
    overlay.dispatchEvent(ev("pointerdown", { clientX: 200, clientY: 150, button }));
    overlay.dispatchEvent(ev("pointerup", { clientX: 200, clientY: 150, button }));
    assert.equal(await tool, null);
  }
});

test("S cycles only while the tool was asked to, and otherwise does nothing", async () => {
  const quiet = fakeDoc();
  const idle = startImageRegionTool({ doc: quiet, imageRect: rect });
  quiet.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), { key: "s" }));
  assert.equal(quiet.body.children[0].removed, undefined);
  quiet.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), { key: "Escape" }));
  assert.equal(await idle, null);

  const doc = fakeDoc();
  const tool = startImageRegionTool({ doc, imageRect: rect, cycle: true });
  const key = Object.assign(new Event("keydown", { cancelable: true }), { key: "S" });
  doc.dispatchEvent(key);
  assert.equal(key.defaultPrevented, true);
  assert.deepEqual(await tool, { kind: "cycle" });
  assert.equal(doc.body.children[0].removed, true);
});

test("a rotated image maps the click into its own box", async () => {
  const doc = fakeDoc();
  const element = { id: "img", type: "image", x: 0, y: 0, width: 200, height: 100, angle: Math.PI / 2 };
  const app = { state: { zoom: { value: 1 }, scrollX: 0, scrollY: 0, offsetLeft: 0, offsetTop: 0 } };
  const tool = startImageRegionTool({ app, element, doc, setTimeout: () => 1, clearTimeout() {} });
  const overlay = doc.body.children[0];
  overlay.dispatchEvent(ev("pointerdown", { clientX: 100, clientY: 150 }));
  overlay.dispatchEvent(ev("pointerup", { clientX: 100, clientY: 150 }));
  const pin = await tool;
  assert.equal(pin.kind, "pin");
  assert.ok(Math.abs(pin.x - 1) < 1e-6, pin.x);
  assert.ok(Math.abs(pin.y - 0.5) < 1e-6, pin.y);
});

test("the overlay swallows contextmenu while active", () => {
  const doc = fakeDoc();
  startImageRegionTool({ doc, imageRect: rect, setTimeout: () => 1, clearTimeout() {} });
  const overlay = doc.body.children[0];
  const e = ev("contextmenu");
  overlay.dispatchEvent(e);
  assert.equal(e.defaultPrevented, true);
});
