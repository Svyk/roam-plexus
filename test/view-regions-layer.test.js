import assert from "node:assert/strict";
import test from "node:test";

import { REGION_LAYER_CAP, createRegionsLayer } from "../src/view/regions-layer.js";
import { viewportRectOf } from "../src/host/native.js";

function fakeNode(tag = "div") {
  return {
    tag, children: [], listeners: {}, className: "", style: {}, textContent: "", title: "", attrs: {}, parentNode: null,
    setAttribute(k, v) { this.attrs[k] = v; },
    append(...c) { for (const x of c) { x.parentNode = this; this.children.push(x); } },
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((x) => x !== this); this.parentNode = null; },
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
    removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); },
    fire(t, e = {}) {
      const ev = { defaultPrevented: false, stopped: false, stopPropagation() { this.stopped = true; }, preventDefault() { this.defaultPrevented = true; }, ...e };
      for (const f of [...(this.listeners[t] || [])]) f(ev);
      return ev;
    },
  };
}

const rect = (id, x, y, w = 50, h = 40) => ({ id, type: "rectangle", x, y, width: w, height: h, angle: 0, version: 1, isDeleted: false });
const area = (uid, ids, caption = "", extra = {}) => ({ uid, string: `s-${uid}`, region: { kind: "area", ids, pad: 0, caption, ...extra } });

function setup({ elements, regions, state = {}, debug = false, nonce } = {}) {
  const body = fakeNode("body");
  const doc = Object.assign(fakeNode("doc"), { body, defaultView: {}, createElement: (t) => fakeNode(t), createElementNS: (_n, t) => fakeNode(t) });
  const frames = [];
  const raf = (cb) => { frames.push(cb); return frames.length; };
  const flush = () => { while (frames.length) frames.shift()(); };
  const app = {
    state: { scrollX: 0, scrollY: 0, zoom: { value: 1 }, offsetLeft: 0, offsetTop: 0, ...state },
    elements: elements ?? [rect("a", 100, 100), rect("b", 300, 300)],
    getSceneElementsIncludingDeleted() { return this.elements; },
  };
  if (nonce) app.scene = { getSceneNonce: () => nonce.v };
  const subs = { on: 0, off: 0 };
  const native = { viewportRectOf, subscribeViewport: (_a, cb) => { subs.on++; subs.cb = cb; return () => { subs.off++; }; } };
  const calls = { regionsOf: 0 };
  const list = { v: regions ?? [area("R1", ["a"]), area("R2", ["b"], "Second")] };
  const host = { regionsOf: () => { calls.regionsOf++; return list.v; }, labelSource: () => null };
  const containerEl = { getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600 }) };
  const clock = { t: 1000 };
  const selected = [];
  const sidebar = [];
  const layer = createRegionsLayer({
    doc, app, containerEl, host, drawingUid: "DRAW", native, zIndex: 50, raf, caf() {},
    labelOf: (r) => `L:${r.kind}`, onSelect: (u) => selected.push(u), onOpenSidebar: (u) => sidebar.push(u),
    now: () => clock.t, debug,
  });
  const root = () => body.children.find((c) => /plexus-regions-layer/.test(c.className));
  const stage = () => root()?.children[0];
  const svg = () => stage()?.children.find((c) => c.tag === "svg");
  const chips = () => (stage() ? stage().children.filter((c) => c.className === "plexus-region-chip") : []);
  const outlines = () => (svg() ? svg().children.filter((c) => c.attrs.class === "plexus-region-outline") : []);
  return { stage, svg, layer, doc, body, app, subs, flush, frames, root, chips, outlines, selected, sidebar, list, calls, clock };
}

test("created hidden; show draws outlines and chips with z-index, labels and derived text", () => {
  const s = setup();
  assert.equal(s.layer.visible(), false);
  assert.equal(s.root(), undefined);
  s.layer.show();
  assert.equal(s.layer.visible(), true);
  assert.equal(s.root().style.zIndex, "50");
  assert.equal(s.root().style.pointerEvents, undefined);
  assert.equal(s.outlines().length, 2);
  assert.deepEqual(s.chips().map((c) => c.textContent), ["area 1", "Second"]);
  assert.equal(s.chips()[0].title, "L:area");
  assert.equal(s.chips()[0].attrs["aria-label"], "L:area");
  assert.equal(s.subs.on, 1);
  assert.equal(s.outlines()[0].attrs.x, "0");
  assert.equal(s.outlines()[0].attrs.width, "50");
  assert.equal(s.outlines()[0].attrs["vector-effect"], "non-scaling-stroke");
  assert.equal(s.svg().style.left, "100px");
  assert.equal(s.svg().style.width, "250px");
  assert.equal(s.chips()[0].style.left, "100px");
  assert.equal(s.chips()[0].style.top, "100px");
  assert.equal(s.chips()[0].style.transform, "scale(var(--plexus-inv-zoom)) translateY(-100%)");
  assert.equal(s.stage().style.transform, "translate(0px, 0px) scale(1)");
  assert.equal(s.root().style.width, "800px");
  assert.equal(s.stage().style["--plexus-inv-zoom"], "1");
});

test("chip text is cut at 32 characters and flips inside at the container top", () => {
  const long = "x".repeat(50);
  const s = setup({ elements: [rect("a", 100, 5)], regions: [area("R1", ["a"], long)] });
  s.layer.show();
  assert.equal(s.chips()[0].textContent, `${"x".repeat(31)}…`);
  assert.equal(s.chips()[0].style.transform, "scale(var(--plexus-inv-zoom)) translateY(2px)");
});

test("a region whose top edge is above the container keeps its chip inside the container", () => {
  const s = setup({ elements: [rect("a", 100, -500, 50, 900)], regions: [area("R1", ["a"])] });
  s.layer.show();
  assert.equal(s.chips()[0].style.transform, "scale(var(--plexus-inv-zoom)) translateY(2px)");
});

test("image kinds and unresolvable regions draw nothing", () => {
  const regions = [
    { uid: "I1", string: "s", region: { kind: "imgrect", el: "a", f: [0, 0, 1, 1] } },
    area("R1", ["missing"]),
    area("R2", ["a"]),
  ];
  const s = setup({ regions });
  s.layer.show();
  assert.equal(s.outlines().length, 1);
});

test("chip clicks: select, shift opens sidebar, keyboard, mousedown prevented, pointerdown stopped", () => {
  const s = setup();
  s.layer.show();
  const chip = s.chips()[0];
  assert.equal(chip.fire("mousedown").defaultPrevented, true);
  assert.equal(chip.fire("pointerdown").stopped, true);
  chip.fire("click");
  chip.fire("click", { shiftKey: true });
  chip.fire("keydown", { key: "Enter" });
  chip.fire("keydown", { key: " " });
  chip.fire("keydown", { key: "a" });
  assert.deepEqual(s.selected, ["R1", "R1", "R1"]);
  assert.deepEqual(s.sidebar, ["R1"]);
});

function countWrites(node) {
  const counter = { n: 0 };
  node.style = new Proxy(node.style, { set(t, k, v) { counter.n++; t[k] = v; return true; } });
  const orig = node.setAttribute.bind(node);
  node.setAttribute = (k, v) => { counter.n++; orig(k, v); };
  return counter;
}

test("a pan frame writes only the container transform", () => {
  const s = setup();
  s.layer.show();
  const counters = [...s.outlines(), ...s.chips(), s.svg()].map(countWrites);
  const stageWrites = countWrites(s.stage());
  for (let i = 1; i <= 10; i++) { s.app.state.scrollX = -i * 7; s.app.state.scrollY = i * 3; s.subs.cb(); s.flush(); }
  assert.deepEqual(counters.map((c) => c.n), counters.map(() => 0));
  assert.equal(stageWrites.n, 10);
  assert.equal(s.stage().style.transform, "translate(-70px, 30px) scale(1)");
});

test("stage transform follows scroll, zoom and offsets like viewportRectOf; zoom updates --plexus-inv-zoom", () => {
  const s = setup();
  s.layer.show();
  s.app.state.zoom = { value: 2 };
  s.app.state.scrollX = -30;
  s.app.state.scrollY = 10;
  s.app.state.offsetLeft = 5;
  s.subs.cb(); s.flush();
  assert.equal(s.stage().style["--plexus-inv-zoom"], "0.5");
  assert.equal(s.stage().style.transform, "translate(-55px, 20px) scale(2)");
  const r = viewportRectOf(s.app, [100, 100, 150, 140]);
  assert.equal(r.left, (100 - 30) * 2 + 5);
  assert.equal(r.left, -55 + 100 * 2);
  const c = countWrites(s.chips()[0]);
  s.app.state.scrollX = -31;
  s.subs.cb(); s.flush();
  assert.equal(c.n, 0);
});

test("stage origin is relative to the container rect", () => {
  const s = setup({ state: { offsetLeft: 40, offsetTop: 10 } });
  s.layer.show();
  assert.equal(s.stage().style.transform, "translate(40px, 10px) scale(1)");
});

test("a scene change updates the SVG rects", () => {
  const s = setup();
  s.layer.show();
  s.app.elements = [rect("a", 100, 100, 80, 40), rect("b", 300, 300)];
  s.app.elements[0].version = 2;
  s.subs.cb(); s.flush();
  assert.equal(s.outlines()[0].attrs.width, "80");
  assert.equal(s.svg().style.width, "250px");
  s.app.elements = [rect("a", 90, 100, 80, 40), rect("b", 300, 300)];
  s.app.elements[0].version = 3;
  s.subs.cb(); s.flush();
  assert.equal(s.svg().style.left, "90px");
  assert.equal(s.chips()[0].style.left, "90px");
});

test("pan does not recompute scene boxes; scene change does", () => {
  const s = setup();
  s.layer.show();
  let reads = 0;
  const orig = s.app.getSceneElementsIncludingDeleted.bind(s.app);
  s.app.getSceneElementsIncludingDeleted = () => { reads++; return orig(); };
  s.app.state.scrollX = -5;
  s.subs.cb();
  s.flush();
  const panReads = reads;
  assert.equal(panReads, 1);
  s.app.elements = [rect("a", 100, 100, 80, 40), rect("b", 300, 300)];
  s.app.elements[0].version = 2;
  s.subs.cb();
  s.flush();
  assert.equal(s.outlines()[0].attrs.width, "80");
});

test("scene nonce drives the signature when available", () => {
  const nonce = { v: 1 };
  const s = setup({ nonce });
  s.layer.show();
  s.app.elements = [rect("a", 100, 100, 90, 40), rect("b", 300, 300)];
  s.subs.cb(); s.flush();
  assert.equal(s.outlines()[0].attrs.width, "50");
  nonce.v = 2;
  s.subs.cb(); s.flush();
  assert.equal(s.outlines()[0].attrs.width, "90");
});

test("no scene recompute during an element gesture, but layout still runs", () => {
  const s = setup();
  s.layer.show();
  s.app.state.isResizing = true;
  s.app.elements = [rect("a", 100, 100, 90, 40), rect("b", 300, 300)];
  s.app.elements[0].version = 5;
  s.app.state.scrollX = -10;
  s.subs.cb(); s.flush();
  assert.equal(s.outlines()[0].attrs.width, "50");
  assert.equal(s.stage().style.transform, "translate(-10px, 0px) scale(1)");
  s.app.state.isResizing = false;
  s.subs.cb(); s.flush();
  assert.equal(s.outlines()[0].attrs.width, "90");
});

test("whole layer hides while an Excalidraw menu or dialog is open", () => {
  const s = setup();
  s.layer.show();
  s.app.state.contextMenu = { items: [] };
  s.subs.cb(); s.flush();
  assert.equal(s.root().style.display, "none");
  s.app.state.contextMenu = null;
  s.subs.cb(); s.flush();
  assert.equal(s.root().style.display, "");
});

test("regions refetch on show, refresh and after 3 s; refresh picks up new regions", () => {
  const s = setup();
  s.layer.show();
  assert.equal(s.calls.regionsOf, 1);
  s.list.v = [...s.list.v, area("R3", ["a"], "Third")];
  s.subs.cb(); s.flush();
  assert.equal(s.calls.regionsOf, 1);
  assert.equal(s.outlines().length, 2);
  s.clock.t += 3500;
  s.subs.cb(); s.flush();
  assert.equal(s.calls.regionsOf, 2);
  assert.equal(s.outlines().length, 3);
  s.list.v = s.list.v.slice(0, 1);
  s.layer.refresh();
  assert.equal(s.outlines().length, 1);
  assert.equal(s.chips().length, 1);
});

test("cap of 150 with one warning", () => {
  const els = Array.from({ length: 160 }, (_, i) => rect(`e${i}`, i * 3, 10, 2, 2));
  const regions = els.map((e, i) => area(`R${i}`, [e.id]));
  const s = setup({ elements: els, regions });
  const warns = [];
  const w = console.warn;
  console.warn = (...a) => warns.push(a.join(" "));
  try {
    s.layer.show();
    s.layer.refresh();
  } finally { console.warn = w; }
  assert.equal(REGION_LAYER_CAP, 150);
  assert.equal(s.outlines().length, 150);
  assert.equal(warns.filter((x) => /more than 150/.test(x)).length, 1);
});

test("hide unsubscribes and drops the DOM; toggle and idempotent dispose", () => {
  const s = setup();
  assert.equal(s.layer.toggle(), true);
  assert.equal(s.subs.on, 1);
  s.subs.cb();
  assert.equal(s.frames.length, 1);
  assert.equal(s.layer.toggle(), false);
  assert.equal(s.subs.off, 1);
  assert.equal(s.root(), undefined);
  s.flush();
  s.layer.show();
  assert.equal(s.subs.on, 2);
  s.layer.dispose();
  s.layer.dispose();
  assert.equal(s.subs.off, 2);
  assert.equal(s.root(), undefined);
  s.layer.show();
  assert.equal(s.layer.visible(), false);
});

test("null drawingUid: show is a no-op", () => {
  const body = fakeNode("body");
  const doc = Object.assign(fakeNode("doc"), { body, defaultView: {}, createElement: (t) => fakeNode(t) });
  const layer = createRegionsLayer({ doc, app: { state: {} }, host: { regionsOf: () => [] }, drawingUid: null, native: { subscribeViewport() { throw new Error("no"); } } });
  layer.show();
  assert.equal(layer.visible(), false);
  assert.equal(body.children.length, 0);
});

test("errors never escape; dark theme class follows app state", () => {
  const s = setup({ state: { theme: "dark" } });
  s.list.v = null;
  s.layer.show();
  assert.match(s.root().className, /plexus-regions-layer--dark/);
  s.app.getSceneElementsIncludingDeleted = () => { throw new Error("boom"); };
  const w = console.warn;
  console.warn = () => {};
  try { s.layer.refresh(); s.subs.cb(); s.flush(); } finally { console.warn = w; }
  assert.equal(s.layer.visible(), true);
});

test("debug logs p95 every 120 frames", () => {
  const s = setup({ debug: true });
  const logs = [];
  const l = console.log;
  console.log = (...a) => logs.push(a.join(" "));
  try {
    s.layer.show();
    for (let i = 0; i < 125; i++) { s.subs.cb(); s.flush(); }
  } finally { console.log = l; }
  assert.equal(logs.filter((x) => /^\[plexus\] regions layer p95 [\d.]+ ms$/.test(x)).length, 1);
});

test("layout cost at 50 regions stays small per pan frame", () => {
  const els = Array.from({ length: 50 }, (_, i) => rect(`e${i}`, i * 10, i * 8, 8, 8));
  const s = setup({ elements: els, regions: els.map((e, i) => area(`R${i}`, [e.id])) });
  s.layer.show();
  const t0 = performance.now();
  for (let i = 0; i < 100; i++) { s.app.state.scrollX = -i; s.subs.cb(); s.flush(); }
  assert.ok((performance.now() - t0) / 100 < 2);
});
