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

const ev = (type, props = {}) => Object.assign(new Event(type, { cancelable: true }), { pointerId: 1, buttons: 1, ...props });
const rect = { left: 100, top: 100, width: 200, height: 100 };

test("plain drag resolves a rect fraction array", async () => {
  const doc = fakeDoc();
  const tool = startImageRegionTool({ doc, imageRect: rect });
  const overlay = doc.body.children[0];
  overlay.dispatchEvent(ev("pointerdown", { clientX: 110, clientY: 110 }));
  overlay.dispatchEvent(ev("pointermove", { clientX: 210, clientY: 160 }));
  overlay.dispatchEvent(ev("pointerup", { clientX: 210, clientY: 160 }));
  assert.deepEqual(await tool, [0.05, 0.1, 0.5, 0.5]);
  assert.equal(overlay.removed, true);
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
  assert.deepEqual(await tool, { p: [0.05, 0.1, 0.25, 0.1, 0.25, 0.5, 0.05, 0.5] });
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
