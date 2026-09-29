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

test("Frame button is disabled unless canFrame reports a single frame", async () => {
  const buttons = [];
  const { doc, bar } = fakeDoc(36);
  const create = doc.createElement;
  doc.createElement = (tag) => {
    const el = create(tag);
    if (tag === "button") { el.disabled = false; buttons.push(el); }
    return el;
  };
  let frame = false;
  const tb = createEditorToolbar({ doc, onAreaRegion() {}, onImageRegion() {}, onFrameRegion() {}, canFrame: () => frame });
  tb.show(outerEl);
  await new Promise((r) => setTimeout(r, 5));
  const fb = buttons.find((b) => /Frame/.test(b.textContent || ""));
  assert.ok(fb, "frame button exists");
  assert.equal(fb.disabled, true);
  assert.equal(bar.style.left, "500px");
  tb.hide();
});

test("Frame button enables on a single frame after a pointerup refresh, fires onFrameRegion, and disables again", async () => {
  const buttons = [];
  const { doc } = fakeDoc(36);
  const create = doc.createElement;
  doc.createElement = (tag) => {
    const el = create(tag);
    if (tag === "button") {
      el.disabled = false;
      el.handlers = {};
      el.addEventListener = (t, f) => { el.handlers[t] = f; };
      buttons.push(el);
    }
    return el;
  };
  const listeners = {};
  const outer = { ...outerEl, addEventListener: (t, f) => { listeners[t] = f; }, removeEventListener: (t) => { delete listeners[t]; } };
  let frame = false;
  let framed = 0;
  const tb = createEditorToolbar({ doc, onAreaRegion() {}, onImageRegion() {}, onFrameRegion() { framed++; }, canFrame: () => frame });
  tb.show(outer);
  const fb = buttons.find((b) => /Frame/.test(b.textContent || ""));
  assert.equal(fb.disabled, true);
  frame = true;
  listeners.pointerup();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(fb.disabled, false);
  fb.handlers.click({ stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(framed, 1);
  frame = false;
  listeners.keyup();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(fb.disabled, true);
  tb.hide();
  assert.deepEqual(Object.keys(listeners), []);
});

test("toolbar has six buttons in contract order with independent enable rules", async () => {
  const buttons = [];
  const { doc, bar } = fakeDoc(36);
  const create = doc.createElement;
  doc.createElement = (tag) => {
    const el = create(tag);
    if (tag === "button") { el.disabled = false; buttons.push(el); }
    return el;
  };
  const state = { frame: false, crop: true, present: false };
  const tb = createEditorToolbar({
    doc, onAreaRegion() {}, onImageRegion() {}, onFrameRegion() {}, onCropRegion() {}, onEmbed() {}, onPresent() {},
    canFrame: () => state.frame, canCrop: () => state.crop, canPresent: () => state.present,
  });
  tb.show(outerEl);
  assert.deepEqual(bar.children.map((b) => b.textContent), ["Region", "Image region", "Frame (with margin)", "Region from crop", "Embed block", "Present"]);
  assert.deepEqual(bar.children.map((b) => b.disabled), [false, false, true, false, false, true]);
  tb.hide();
});

test("Mind map button exists only when onMindMap is given and fires it", async () => {
  const make = (withMap) => {
    const buttons = [];
    const { doc } = fakeDoc(36);
    const create = doc.createElement;
    doc.createElement = (tag) => {
      const el = create(tag);
      if (tag === "button") { el.handlers = {}; el.addEventListener = (t, f) => { el.handlers[t] = f; }; buttons.push(el); }
      return el;
    };
    let fired = 0;
    const tb = createEditorToolbar({ doc, onAreaRegion() {}, onImageRegion() {}, ...(withMap ? { onMindMap: () => { fired += 1; } } : {}) });
    tb.show(outerEl);
    return { buttons, fired: () => fired, tb };
  };
  const off = make(false);
  assert.equal(off.buttons.some((b) => /Mind map/.test(b.textContent || "")), false);
  off.tb.hide();
  const on = make(true);
  const b = on.buttons.find((x) => /Mind map/.test(x.textContent || ""));
  assert.ok(b);
  b.handlers.click({ stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(on.fired(), 1);
  on.tb.hide();
});
