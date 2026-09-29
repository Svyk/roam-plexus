import assert from "node:assert/strict";
import test from "node:test";

import { createActions, contentRect } from "../src/actions.js";
import { createPublicApi } from "../src/api.js";
import { createRegionRefRenderer } from "../src/view/regionref.js";
import { startImageRegionTool } from "../src/view/image-region-tool.js";
import { loadImageBitmap, clearImageMemo } from "../src/host/image-source.js";
import { parseRegion, geometryKey } from "../src/model/region.js";
import { cropKey } from "../src/host/cache.js";
import { fnv1a } from "../src/model/hash.js";

const svg = '<svg viewBox="0 0 240 160" width="240" height="160"><g/></svg>';
const fakeCanvasDoc = (extra = {}) => {
  const draws = [];
  const clips = [];
  return {
    draws,
    clips,
    querySelectorAll: () => [],
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip: () => clips.push(1),
        drawImage: (...a) => draws.push(a.slice(1)),
      }),
      toBlob: (cb) => cb(new Blob(["x"], { type: "image/png" })),
    }),
    ...extra,
  };
};

function build(over = {}) {
  const created = [];
  const puts = [];
  const toasts = [];
  const captured = [];
  const opened = [];
  const actions = createActions({
    host: {
      createRegion: async (d, s) => { created.push([d, s]); return "reg000001"; },
      drawing: () => ({ hash: "abcd1234", elements: over.elements || [] }),
      pullBlock: over.pullBlock || (() => null),
      openBlock: async (uid, o) => { opened.push([uid, o]); },
      regionsOf: () => [],
    },
    native: {
      activeEditor: () => over.editor ?? null,
      selectedElementIds: () => over.ids || [],
      captureSelectionSvg: async (app, ids) => { captured.push(ids); return svg; },
    },
    cache: over.cache || { put: async (k, b, d) => puts.push([k, b, d]), clear: async () => {} },
    cold: over.cold || {},
    toaster: { show: (m, o) => toasts.push([m, o]) },
    spotlight: () => {},
    getSettings: () => ({}),
    doc: over.doc || fakeCanvasDoc(),
    clipboard: { writeText: async () => {} },
    emit: () => {},
    loadBitmap: over.loadBitmap,
    startTool: over.startTool,
    fetchBlob: over.fetchBlob,
    createBitmap: over.createBitmap,
  });
  return { actions, created, puts, toasts, captured, opened };
}

const scene = [
  { id: "f", type: "frame", name: "Frame one" },
  { id: "a", type: "rectangle", frameId: "f", groupIds: ["G"], x: 0, y: 0, width: 10, height: 10 },
  { id: "b", type: "text", text: "hi", frameId: "f", groupIds: ["G"], x: 0, y: 0, width: 10, height: 10 },
  { id: "c", type: "rectangle", x: 0, y: 0, width: 10, height: 10 },
];
const editorFor = (state) => ({ app: { getSceneElements: () => scene, state }, drawingUid: "drw000001" });

test("cframe selection exports ONLY the frame id (clipped export)", async () => {
  const t = build({ editor: editorFor({}), ids: ["f", "a"] });
  await t.actions.createAreaRegion();
  assert.equal(parseRegion(t.created[0][1]).kind, "cframe");
  assert.deepEqual(t.captured[0], ["f"]);
});

test("createFrameRegion writes k=frame with pad and exports the frame plus its children", async () => {
  const t = build({ editor: editorFor({}), ids: ["f"] });
  assert.equal(t.actions.isFrameSelected(), true);
  await t.actions.createFrameRegion();
  const region = parseRegion(t.created[0][1]);
  assert.equal(region.kind, "frame");
  assert.equal(region.pad > 0, true);
  assert.deepEqual([...t.captured[0]].sort(), ["a", "b", "f"]);
});

test("isFrameSelected is false for a non-frame selection or no editor", () => {
  assert.equal(build({ editor: editorFor({}), ids: ["c"] }).actions.isFrameSelected(), false);
  assert.equal(build({ editor: null, ids: ["f"] }).actions.isFrameSelected(), false);
});

test("a whole-group selection creates k=group and exports every member", async () => {
  const t = build({ editor: editorFor({ selectedGroupIds: { G: true } }), ids: ["a", "b"] });
  await t.actions.createAreaRegion();
  const region = parseRegion(t.created[0][1]);
  assert.equal(region.kind, "group");
  assert.equal(region.groupId ?? region.g, "G");
  assert.deepEqual([...t.captured[0]].sort(), ["a", "b"]);
});

test("Alt-lasso on a drawing image writes k=poly and clips the cached svg", async () => {
  const img = { id: "img", type: "image", x: 0, y: 0, width: 100, height: 100, angle: 0 };
  const editor = { app: { getSceneElements: () => [img] }, drawingUid: "drw000001" };
  const t = build({ editor, ids: ["img"], startTool: () => Object.assign(Promise.resolve({ p: [0, 0, 1, 0, 1, 1] }), { cancel() {} }) });
  await t.actions.createImageRegion();
  const region = parseRegion(t.created[0][1]);
  assert.equal(region.kind, "poly");
  assert.deepEqual(t.captured[0], ["img"]);
  assert.match(await t.puts[0][1].text(), /clipPath/);
});

const imgEl = { id: "block-input-x-blk000001", closest: () => null };
const plainImage = (rect = { left: 0, top: 0, width: 200, height: 100 }) => ({ getBoundingClientRect: () => rect, naturalWidth: 400, naturalHeight: 200 });
function plain(picked) {
  const img = plainImage();
  const doc = fakeCanvasDoc({ querySelectorAll: () => [{ ...imgEl, querySelector: () => img }] });
  return build({
    doc,
    pullBlock: () => ({ string: "text ![alt](https://x/y.png) tail" }),
    loadBitmap: async () => ({ width: 400, height: 200 }),
    startTool: () => Object.assign(Promise.resolve(picked), { cancel() {} }),
  });
}

test("plain-image rect writes k=imgrect with i and f, caches the png under fnv1a(url)", async () => {
  const t = plain([0.1, 0.2, 0.5, 0.5]);
  assert.equal(await t.actions.createPlainImageRegion("blk000001"), "reg000001");
  assert.equal(t.created[0][0], "blk000001");
  const region = parseRegion(t.created[0][1]);
  assert.equal(region.kind, "imgrect");
  assert.equal(region.i, 0);
  assert.deepEqual(region.f, [0.1, 0.2, 0.5, 0.5]);
  const key = cropKey({ regionUid: "reg000001", geometryKey: geometryKey(region), drawingHash: fnv1a("https://x/y.png"), tier: "png" });
  assert.equal(t.puts[0][0], key);
});

test("plain-image lasso writes k=imgpoly and clips the canvas crop", async () => {
  const t = plain({ p: [0, 0, 1, 0, 1, 1] });
  await t.actions.createPlainImageRegion("blk000001");
  assert.equal(parseRegion(t.created[0][1]).kind, "imgpoly");
});

test("plain-image with nothing rendered toasts and writes nothing", async () => {
  const t = build({ pullBlock: () => ({ string: "![a](https://x/y.png)" }) });
  assert.equal(await t.actions.createPlainImageRegion("blk000001"), null);
  assert.equal(t.toasts[0][0], "Show the image on screen first");
  assert.equal(t.created.length, 0);
});

test("contentRect: fill uses the box; contain letterboxes; scale-down never enlarges", () => {
  const img = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 400, height: 400 }), naturalWidth: 100, naturalHeight: 50 };
  const view = (fit) => ({ getComputedStyle: () => ({ objectFit: fit }) });
  assert.deepEqual(contentRect(img, view("fill")), { left: 10, top: 20, width: 400, height: 400 });
  assert.deepEqual(contentRect(img, view("contain")), { left: 10, top: 120, width: 400, height: 200 });
  assert.deepEqual(contentRect(img, view("scale-down")), { left: 160, top: 195, width: 100, height: 50 });
  const tall = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 400 }), naturalWidth: 100, naturalHeight: 100 };
  assert.deepEqual(contentRect(tall, view("contain")), { left: 0, top: 150, width: 100, height: 100 });
});

test("opening an imgrect/imgpoly region goes to the image block: no toast, no editor wait", async () => {
  for (const string of [
    "{{[[plexus-region]]: k=imgrect d=blk000001 i=0 f=0.1,0.1,0.5,0.5}}",
    "{{[[plexus-region]]: k=imgpoly d=blk000001 i=0 p=0,0,1,0,1,1}}",
  ]) {
    const t = build({ pullBlock: () => ({ string }) });
    const started = Date.now();
    assert.equal(await t.actions.openRegion("reg000001", { sidebar: true }), "blk000001");
    assert.ok(Date.now() - started < 500);
    assert.deepEqual(t.opened, [["blk000001", { sidebar: true }]]);
    assert.equal(t.toasts.length, 0);
  }
});

function thumbSetup() {
  const store = new Map();
  let renders = 0;
  const t = build({
    pullBlock: () => ({ string: "{{[[excalidraw]]}}" }),
    cache: {
      peek: (k) => store.get(k),
      get: async (k) => store.get(k),
      put: async (k, b) => { store.set(k, { url: `blob:${k}` }); },
      clear: async () => {},
    },
    cold: { renderDrawing: async () => { renders++; await new Promise((r) => setTimeout(r, 5)); return { canvas: {}, naturalWidth: 800, naturalHeight: 400, settled: true }; } },
    fetchBlob: async (url) => new Blob([url]),
  });
  return { ...t, renders: () => renders };
}

test("drawing thumbnail: cache-only null before a render, a Blob after, single-flight render", async () => {
  const s = thumbSetup();
  assert.equal(await s.actions.thumbnail("drw000001", { maxWidth: 160 }), null);
  const [a, b] = await Promise.all([
    s.actions.thumbnail("drw000001", { maxWidth: 160, render: true }),
    s.actions.thumbnail("drw000001", { maxWidth: 160, render: true }),
  ]);
  assert.ok(a instanceof Blob);
  assert.equal(a, b);
  assert.equal(s.renders(), 1);
  assert.ok((await s.actions.thumbnail("drw000001", { maxWidth: 160 })) instanceof Blob);
  assert.equal(s.renders(), 1);
  assert.equal(await s.actions.thumbnail("drw000001", { maxWidth: 480 }), null);
});

test("thumbnail render failure resolves null", async () => {
  const s = build({
    pullBlock: () => ({ string: "{{[[excalidraw]]}}" }),
    cache: { peek: () => null, get: async () => null, put: async () => {}, clear: async () => {} },
    cold: { renderDrawing: async () => { throw new Error("boom"); } },
  });
  assert.equal(await s.actions.thumbnail("drw000001", { render: true }), null);
});

test("api.create emits one drawing change event after the write", async () => {
  const seen = [];
  const emitter = { on() {}, off() {}, emit: (d) => seen.push(d) };
  const api = createPublicApi({ host: { graphName: () => "g", createDrawing: async () => ({ uid: "new000001", pageUid: "p" }) }, actions: {}, emitter, version: "x" });
  const out = await api.create({ title: "T" });
  assert.equal(out.uid, "new000001");
  assert.deepEqual(seen, [{ uid: "new000001", kind: "drawing" }]);
  const bad = createPublicApi({ host: { graphName: () => "g", createDrawing: async () => ({ uid: "n" }) }, actions: {}, emitter: { emit() { throw new Error("x"); } }, version: "x" });
  assert.equal((await bad.create({})).uid, "n");
});

test("bitmap memo is capped (oldest evicted, refetched) and a null file rejects", async () => {
  clearImageMemo();
  let gets = 0;
  const api = { file: { get: async ({ url }) => { gets++; return url === "none" ? null : { url }; } } };
  const cb = async (f) => ({ from: f.url });
  for (let i = 0; i < 17; i++) await loadImageBitmap(`u${i}`, { api, createBitmap: cb });
  assert.equal(gets, 17);
  await loadImageBitmap("u16", { api, createBitmap: cb });
  assert.equal(gets, 17);
  await loadImageBitmap("u0", { api, createBitmap: cb });
  assert.equal(gets, 18);
  await assert.rejects(loadImageBitmap("none", { api, createBitmap: cb }), /not available/);
  clearImageMemo();
});

// --- regionref image kinds ---

function el(tag) {
  const e = {
    tag, attrs: {}, classes: new Set(), children: [], style: {}, listeners: {}, parentNode: null, isConnected: true, textContent: "",
    set className(v) { this.classes = new Set(v.split(/\s+/).filter(Boolean)); },
    get className() { return [...this.classes].join(" "); },
    classList: { add: (c) => e.classes.add(c), remove: (c) => e.classes.delete(c), contains: (c) => e.classes.has(c) },
    getAttribute: (k) => e.attrs[k] ?? null, setAttribute: (k, v) => { e.attrs[k] = v; }, removeAttribute: (k) => { delete e.attrs[k]; },
    addEventListener: (t, fn) => { e.listeners[t] = fn; }, closest: () => null,
    append: (c) => { e.children.push(c); c.parentNode = e; }, remove: () => { e.isConnected = false; },
    insertBefore: (n) => { e.children.push(n); n.parentNode = e; },
  };
  return e;
}
const flush = () => new Promise((r) => setTimeout(r, 10));

function refSetup({ string, loadBitmap }) {
  const drawn = [];
  const clips = [];
  const puts = [];
  const doc = {
    createElement: (tag) => (tag === "canvas"
      ? { width: 0, height: 0, getContext: () => ({ beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip: () => clips.push(1), drawImage: (...a) => drawn.push(a.slice(1)) }), toBlob: (cb) => cb({ size: 3 }) }
      : el(tag)),
  };
  const parent = el("p");
  const btn = el("button");
  parent.append(btn);
  const store = new Map();
  const r = createRegionRefRenderer({
    host: { blockUidFromNode: () => "reg000001", pullBlock: (uid) => (uid === "reg000001" ? { string } : { string: "![a](https://x/y.png)" }), drawing: () => null },
    cache: { peek: (k) => store.get(k) || null, get: async () => null, put: async (k, b, d) => { puts.push(k); store.set(k, { url: "blob:png", ...d }); } },
    cold: {},
    getSettings: () => ({ maxCropHeight: 360, openInSidebar: false }),
    doc,
    loadBitmap,
  });
  return { r, btn, parent, drawn, clips, puts };
}

test("imgrect cold crop: natural-size fractions within 1 px, png key uses fnv1a(url)", async () => {
  const s = refSetup({ string: "{{[[plexus-region]]: k=imgrect d=blk000001 i=0 f=0.1,0.2,0.5,0.25}}", loadBitmap: async () => ({ width: 400, height: 200 }) });
  s.r.claim(s.btn);
  await flush();
  const [sx, sy, sw, sh] = s.drawn[0];
  assert.ok(Math.abs(sx - 40) <= 1 && Math.abs(sy - 40) <= 1 && Math.abs(sw - 200) <= 1 && Math.abs(sh - 50) <= 1, JSON.stringify(s.drawn[0]));
  assert.equal(s.clips.length, 0);
  assert.match(s.puts[0], new RegExp(fnv1a("https://x/y.png")));
  assert.ok(!s.puts.some((k) => k.endsWith("|svg")));
  assert.equal(s.parent.children[1].children[0].tag, "img");
});

test("imgpoly cold crop applies the polygon clip", async () => {
  const s = refSetup({ string: "{{[[plexus-region]]: k=imgpoly d=blk000001 i=0 p=0.1,0.1,0.9,0.1,0.5,0.9}}", loadBitmap: async () => ({ width: 400, height: 200 }) });
  s.r.claim(s.btn);
  await flush();
  assert.equal(s.clips.length, 1);
});

test("image load failure shows an image chip and is negative-cached (no refetch on re-claim)", async () => {
  let loads = 0;
  const string = "{{[[plexus-region]]: k=imgrect d=blk000001 i=0 f=0.1,0.2,0.5,0.25}}";
  const s = refSetup({ string, loadBitmap: async () => { loads++; throw new Error("gone"); } });
  const warn = console.warn;
  console.warn = () => {};
  try {
    s.r.claim(s.btn);
    await flush();
    assert.equal(s.parent.children[1].textContent, "Image not available");
    const btn2 = el("button");
    s.parent.append(btn2);
    s.r.claim(btn2);
    await flush();
    assert.equal(loads, 1);
    assert.equal(s.parent.children.at(-1).textContent, "Image not available");
  } finally {
    console.warn = warn;
  }
});

// --- image tool cancels when the image may have moved ---

test("image tool cancels on wheel, scroll and resize instead of using a stale rect", async () => {
  for (const type of ["wheel", "scroll", "resize"]) {
    const doc = new EventTarget();
    const view = new EventTarget();
    doc.defaultView = view;
    doc.body = { append() {} };
    const overlays = [];
    doc.createElement = () => { const e = new EventTarget(); Object.assign(e, { style: {}, append() {}, remove() { this.removed = true; }, contains: () => false }); overlays.push(e); return e; };
    const tool = startImageRegionTool({ doc, imageRect: { left: 0, top: 0, width: 100, height: 100 } });
    (type === "resize" ? view : doc).dispatchEvent(new Event(type));
    assert.equal(await tool, null);
  }
});
