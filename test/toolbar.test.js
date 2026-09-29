import assert from "node:assert/strict";
import test from "node:test";

import { createEditorToolbar } from "../src/view/toolbar.js";

function fakeDoc(barHeight) {
  const bar = {
    style: {},
    className: "",
    children: [],
    append(...c) { this.children.push(...c); },
    remove() { this.removed = true; },
    getBoundingClientRect: () => ({ height: barHeight }),
  };
  const view = {
    getComputedStyle: () => ({ zIndex: "auto" }),
    addEventListener() {},
    removeEventListener() {},
  };
  const doc = {
    defaultView: view,
    body: { append() {} },
    createElement: (tag) => (tag === "div" ? bar : { addEventListener() {}, style: {} }),
  };
  return { doc, bar };
}

const outerEl = {
  parentElement: null,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 700, right: 1000, bottom: 700 }),
};

test("toolbar sits bottom-centered, 16px above the outer rect's bottom edge", () => {
  const { doc, bar } = fakeDoc(36);
  createEditorToolbar({ doc, onAreaRegion() {}, onImageRegion() {} }).show(outerEl);
  assert.equal(bar.style.left, "500px");
  assert.equal(bar.style.top, `${700 - 16 - 36}px`);
});

test("toolbar falls back to 40px height when it measures 0", () => {
  const { doc, bar } = fakeDoc(0);
  createEditorToolbar({ doc, onAreaRegion() {}, onImageRegion() {} }).show(outerEl);
  assert.equal(bar.style.top, `${700 - 16 - 40}px`);
});
