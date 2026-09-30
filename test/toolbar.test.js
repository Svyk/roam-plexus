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

test("Edit embed button sits between Embed block and Present, exists only with onEditEmbed, is gated, and fires", async () => {
  const make = (withEdit, canEdit) => {
    const buttons = [];
    const { doc, bar } = fakeDoc(36);
    const create = doc.createElement;
    doc.createElement = (tag) => {
      const el = create(tag);
      if (tag === "button") { el.disabled = false; el.handlers = {}; el.addEventListener = (t, f) => { el.handlers[t] = f; }; buttons.push(el); }
      return el;
    };
    let fired = 0;
    const tb = createEditorToolbar({
      doc, onAreaRegion() {}, onImageRegion() {}, onFrameRegion() {}, onCropRegion() {}, onEmbed() {}, onPresent() {}, onMindMap() {},
      ...(withEdit ? { onEditEmbed: () => { fired += 1; }, canEditEmbed: () => canEdit } : {}),
    });
    tb.show(outerEl);
    return { buttons, fired: () => fired, tb, bar };
  };
  const off = make(false);
  assert.equal(off.buttons.some((b) => /Edit embed/.test(b.textContent || "")), false);
  off.tb.hide();
  const on = make(true, true);
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(on.bar.children.map((b) => b.textContent), ["Region", "Image region", "Frame (with margin)", "Region from crop", "Embed block", "Edit embed", "Present", "Mind map"]);
  const b = on.buttons.find((x) => /Edit embed/.test(x.textContent));
  assert.equal(b.disabled, false);
  b.handlers.click({ stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(on.fired(), 1);
  on.tb.hide();
  const gated = make(true, false);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(gated.buttons.find((x) => /Edit embed/.test(x.textContent)).disabled, true);
  gated.tb.hide();
});

test("Outline button follows dockOpen, toggles the dock, and place() centres on the canvas minus the dock inset", async () => {
  const buttons = [];
  const { doc, bar } = fakeDoc(36);
  const create = doc.createElement;
  doc.createElement = (tag) => {
    const el = create(tag);
    if (tag === "button") {
      el.attrs = {};
      el.handlers = {};
      el.setAttribute = (k, v) => { el.attrs[k] = v; };
      el.addEventListener = (t, f) => { el.handlers[t] = f; };
      buttons.push(el);
    }
    return el;
  };
  let open = false;
  let inset = 0;
  let toggled = 0;
  const tb = createEditorToolbar({ doc, onAreaRegion() {}, onImageRegion() {}, onToggleDock() { toggled++; open = !open; }, dockOpen: () => open, dockInset: () => inset });
  tb.show(outerEl);
  const ob = buttons.find((b) => b.textContent === "Outline");
  assert.ok(ob, "outline button exists");
  assert.equal(ob.attrs["aria-pressed"], "false");
  assert.match(ob.title, /Shift\+.*O/);
  ob.handlers.click({ stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(toggled, 1);
  assert.equal(ob.attrs["aria-pressed"], "true");
  inset = 320;
  tb.place();
  assert.equal(bar.style.left, "340px");
  inset = 0;
  tb.place();
  assert.equal(bar.style.left, "500px");
  tb.hide();
});

test("place() caps the bar at the visible canvas width minus 24px, dock inset included", () => {
  const { doc, bar } = fakeDoc(36);
  let inset = 0;
  const tb = createEditorToolbar({ doc, onAreaRegion() {}, onImageRegion() {}, dockInset: () => inset });
  tb.show(outerEl);
  const width = outerEl.getBoundingClientRect().width;
  assert.equal(bar.style.maxWidth, `${width - 24}px`);
  inset = 320;
  tb.place();
  assert.equal(bar.style.maxWidth, `${width - 320 - 24}px`);
  inset = 5000;
  tb.place();
  assert.equal(bar.style.maxWidth, "0px");
  tb.hide();
});

function flyoutDoc() {
  const mk = (tag) => {
    const n = {
      tag, style: {}, className: "", textContent: "", disabled: false, children: [], attrs: {}, handlers: {}, removed: false,
      append(...c) { for (const x of c) { x.parentNode = this; this.children.push(x); } },
      remove() { this.removed = true; if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((x) => x !== this); },
      addEventListener(t, f) { (this.handlers[t] ||= []).push(f); },
      removeEventListener() {},
      setAttribute(k, v) { this.attrs[k] = v; },
      contains(x) { for (let c = x; c; c = c.parentNode) if (c === this) return true; return false; },
      getBoundingClientRect: () => ({ left: 100, top: 600, width: 80, height: 30 }),
      fire(t, e = {}) { for (const f of this.handlers[t] || []) f({ stopPropagation() {}, preventDefault() {}, target: this, ...e }); },
    };
    return n;
  };
  const docListeners = {};
  const body = mk("body");
  const doc = {
    defaultView: { getComputedStyle: () => ({ zIndex: "50" }), addEventListener() {}, removeEventListener() {}, innerWidth: 1200 },
    body,
    createElement: mk,
    addEventListener(t, f, cap) { (docListeners[t] ||= []).push([f, cap]); },
    removeEventListener(t, f) { docListeners[t] = (docListeners[t] || []).filter(([g]) => g !== f); },
  };
  const all = (n) => [n, ...n.children.flatMap(all)];
  return { doc, body, docListeners, all: () => all(body) };
}

test("Frames flyout: presets, gated Reformat group, layouts with the last preset, and popover lifecycle", async () => {
  const f = flyoutDoc();
  const calls = [];
  let canR = false;
  const tb = createEditorToolbar({
    doc: f.doc, onAreaRegion() {}, onImageRegion() {},
    onAddFrame: (p) => calls.push(["add", p]), onReformatFrame: (p) => calls.push(["reformat", p]), canReformat: () => canR,
    onMakeSlide: () => calls.push(["slide"]), onLayout: (k, p) => calls.push(["layout", k, p]),
  });
  tb.show(outerEl);
  const btn = () => f.all().find((n) => n.tag === "button" && n.textContent === "Frames ▾");
  const openIt = async () => { btn().fire("click"); await new Promise((r) => setTimeout(r, 5)); return f.all().find((n) => n.className.includes("plexus-frames-popover")); };
  let pop = await openIt();
  assert.ok(pop, "popover opens");
  assert.equal(pop.style.zIndex, "52");
  assert.equal(btn().attrs["aria-expanded"], "true");
  const rows = () => pop.children.filter((n) => n.tag === "button");
  assert.deepEqual(rows().map((r) => r.textContent), [
    "A4", "Letter", "16:9", "4:3", "1:1", "Mobile", "A4", "Letter", "16:9", "4:3", "1:1", "Mobile", "Slide", "2x2 · 16:9", "Strip · 16:9",
  ]);
  assert.deepEqual(rows().slice(6, 12).map((r) => r.disabled), Array(6).fill(true));
  // Disabled reformat rows do nothing and keep the popover open.
  rows()[6].fire("click");
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(calls, []);
  assert.equal(pop.removed, false);
  rows()[3].fire("click");
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(calls, [["add", "4:3"]]);
  assert.equal(pop.removed, true, "closes after an action");
  assert.equal(btn().attrs["aria-expanded"], "false");
  canR = true;
  pop = await openIt();
  assert.deepEqual(rows().slice(6, 12).map((r) => r.disabled), Array(6).fill(false));
  assert.equal(rows()[13].textContent, "2x2 · 4:3");
  rows()[13].fire("click");
  await new Promise((r) => setTimeout(r, 5));
  pop = await openIt();
  rows()[10].fire("click");
  await new Promise((r) => setTimeout(r, 5));
  pop = await openIt();
  assert.equal(rows()[14].textContent, "Strip · 1:1");
  rows()[14].fire("click");
  pop = await openIt();
  rows()[12].fire("click");
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(calls.slice(1), [["layout", "2x2", "4:3"], ["reformat", "1:1"], ["layout", "strip", "1:1"], ["slide"]]);
  tb.hide();
});

test("Frames flyout closes on outside pointerdown, Esc and hide; inside pointerdown keeps it; listeners removed", async () => {
  const f = flyoutDoc();
  const tb = createEditorToolbar({ doc: f.doc, onAreaRegion() {}, onImageRegion() {}, onAddFrame() {} });
  tb.show(outerEl);
  const btn = () => f.all().find((n) => n.tag === "button" && n.textContent === "Frames ▾");
  const open = async () => { btn().fire("click"); await new Promise((r) => setTimeout(r, 5)); return f.all().find((n) => n.className.includes("plexus-frames-popover")); };
  const fireDoc = (t, e) => { for (const [fn] of [...(f.docListeners[t] || [])]) fn(e); };
  let pop = await open();
  fireDoc("pointerdown", { target: pop.children[0] });
  assert.equal(pop.removed, false);
  fireDoc("pointerdown", { target: f.body });
  assert.equal(pop.removed, true);
  assert.deepEqual([f.docListeners.pointerdown, f.docListeners.keydown].map((l) => l.length), [0, 0]);
  pop = await open();
  let prevented = false;
  fireDoc("keydown", { key: "a" });
  assert.equal(pop.removed, false);
  fireDoc("keydown", { key: "Escape", preventDefault() { prevented = true; }, stopPropagation() {} });
  assert.equal(pop.removed, true);
  assert.equal(prevented, true);
  pop = await open();
  btn().fire("click");
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(pop.removed, true, "second click on the button toggles it closed");
  pop = await open();
  tb.hide();
  assert.equal(pop.removed, true);
  assert.deepEqual([f.docListeners.pointerdown, f.docListeners.keydown].map((l) => l.length), [0, 0]);
});

test("Frames button and Reformat group are absent without their callbacks", () => {
  const f = flyoutDoc();
  createEditorToolbar({ doc: f.doc, onAreaRegion() {}, onImageRegion() {} }).show(outerEl);
  assert.equal(f.all().some((n) => n.textContent === "Frames ▾"), false);
});
