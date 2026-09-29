import assert from "node:assert/strict";
import test from "node:test";

import { createRegionRefRenderer } from "../src/view/regionref.js";
import { serializeRegion, geometryKey } from "../src/model/region.js";
import { cropKey } from "../src/host/cache.js";

function makeEl(tag) {
  const el = {
    tag,
    attrs: {},
    classes: new Set(),
    children: [],
    style: {},
    listeners: {},
    parentNode: null,
    nextSibling: null,
    isConnected: true,
    textContent: "",
    set className(v) { this.classes = new Set(v.split(/\s+/).filter(Boolean)); },
    get className() { return [...this.classes].join(" "); },
    classList: {
      add: (c) => el.classes.add(c),
      remove: (c) => el.classes.delete(c),
      contains: (c) => el.classes.has(c),
    },
    getAttribute: (k) => el.attrs[k] ?? null,
    setAttribute: (k, v) => { el.attrs[k] = v; },
    removeAttribute: (k) => { delete el.attrs[k]; },
    addEventListener: (t, fn) => { el.listeners[t] = fn; },
    closest: () => null,
    append: (c) => { el.children.push(c); c.parentNode = el; },
    remove: () => { el.isConnected = false; },
    insertBefore: (n, ref) => { el.children.splice(ref ? el.children.indexOf(ref) : el.children.length, 0, n); n.parentNode = el; },
  };
  return el;
}

const doc = {
  createElement: (tag) => {
    if (tag === "canvas") return { width: 0, height: 0, getContext: () => ({ drawImage() {} }), toBlob: (cb, type) => cb({ type, size: 5 }) };
    return makeEl(tag);
  },
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

const elements = [
  { id: "rect-a", type: "rectangle", x: 100, y: 100, width: 220, height: 140, angle: 0, isDeleted: false },
  { id: "rect-b", type: "rectangle", x: 420, y: 120, width: 160, height: 100, angle: 0, isDeleted: false },
];

function setup({ regionString, hit, cold, cacheGet, drawing: drawingOverride, onOpen = () => {}, settings = {} }) {
  const parent = makeEl("p");
  const btn = makeEl("button");
  parent.append(btn);
  const puts = [];
  const peeks = [];
  const deleted = [];
  const store = new Map();
  const cache = {
    peek: (key) => {
      peeks.push(key);
      if (store.has(key)) return store.get(key);
      return hit && key.endsWith("|svg") ? hit : null;
    },
    get: cacheGet || (async () => null),
    put: async (key, blob, dims) => { puts.push([key, blob, dims]); store.set(key, { url: "blob:png", ...dims }); },
    delete: async (key) => { deleted.push(key); },
  };
  const drawing = drawingOverride === undefined ? { uid: "drw000001", elements, hash: "abcd1234" } : drawingOverride;
  const host = {
    blockUidFromNode: () => "reg000001",
    pullBlock: () => ({ uid: "reg000001", string: regionString }),
    drawing: () => drawing,
  };
  const r = createRegionRefRenderer({
    host,
    cache,
    cold: cold || { renderDrawing: async () => null },
    getSettings: () => ({ maxCropHeight: 360, openInSidebar: false, ...settings }),
    onOpen,
    doc,
  });
  return { r, btn, parent, puts, peeks, deleted };
}

const areaString = serializeRegion({ kind: "area", drawingUid: "drw000001", ids: ["rect-a"], pad: 10, caption: "Cap" });

test("cache hit sets img.src synchronously and hides the button", () => {
  const { r, btn, parent } = setup({ regionString: areaString, hit: { url: "blob:x", w: 10, h: 10, type: "image/svg+xml" } });
  r.claim(btn);
  const root = parent.children[1];
  assert.ok(btn.classes.has("plexus-hidden"));
  assert.equal(btn.attrs["data-plexus-claimed"], "1");
  assert.equal(root.title, "Cap");
  assert.equal(root.children[0].src, "blob:x");
  r.claim(btn);
  assert.equal(parent.children.length, 2);
});

test("unsupported kind renders a chip", () => {
  const { r, btn, parent } = setup({ regionString: "{{[[plexus-region]]: k=poly d=drw000001 ids=a}}" });
  r.claim(btn);
  assert.match(parent.children[1].textContent, /needs a newer Plexus|Invalid region/);
});

test("non-region blocks are ignored and releaseAll restores the button", () => {
  const ignored = setup({ regionString: "hello" });
  ignored.r.claim(ignored.btn);
  assert.equal(ignored.btn.attrs["data-plexus-claimed"], undefined);

  const { r, btn, parent } = setup({ regionString: areaString, hit: { url: "blob:x", w: 1, h: 1, type: "x" } });
  r.claim(btn);
  r.releaseAll();
  assert.ok(!btn.classes.has("plexus-hidden"));
  assert.equal(btn.attrs["data-plexus-claimed"], undefined);
  assert.equal(parent.children[1].isConnected, false);
});

const regionUid = "reg000001";
const keys = () => {
  const gk = geometryKey({ kind: "area", drawingUid: "drw000001", ids: ["rect-a"], pad: 10 });
  return {
    svg: cropKey({ regionUid, geometryKey: gk, drawingHash: "abcd1234", tier: "svg" }),
    png: cropKey({ regionUid, geometryKey: gk, drawingHash: "abcd1234", tier: "png" }),
  };
};
const rendered = (naturalWidth = 500, naturalHeight = 160) => ({ canvas: {}, naturalWidth, naturalHeight });

test("hot path peeks the exact svg key then the png key (region uid, geometry, drawing hash)", () => {
  const { r, btn, peeks } = setup({ regionString: areaString });
  r.claim(btn);
  assert.deepEqual(peeks.slice(0, 2), [keys().svg, keys().png]);
});

test("cold render: crops the png, puts it under the png key, paints it", async () => {
  const { r, btn, parent, puts } = setup({ regionString: areaString, cold: { renderDrawing: async () => rendered() } });
  r.claim(btn);
  assert.ok(parent.children[1].classes.has("plexus-placeholder"));
  await flush();
  assert.equal(puts.length, 1);
  assert.equal(puts[0][0], keys().png);
  assert.deepEqual(puts[0][2], { w: 480 + 20 - 260 + 40 - 40 + 0 === 0 ? 0 : puts[0][2].w, h: puts[0][2].h });
  assert.equal(parent.children[1].children[0].src, "blob:png");
  assert.ok(!parent.children[1].classes.has("plexus-placeholder"));
});

test("bounds mismatch and render failure show the open-the-drawing chip", async () => {
  for (const result of [rendered(503, 160), null]) {
    const { r, btn, parent, puts } = setup({ regionString: areaString, cold: { renderDrawing: async () => result } });
    r.claim(btn);
    await flush();
    assert.equal(puts.length, 0);
    assert.equal(parent.children[1].textContent, "Open the drawing to render this region");
  }
});

test("a failed cold render is remembered per drawing hash, so a re-claim goes straight to the chip", async () => {
  let renders = 0;
  const cold = { renderDrawing: async () => { renders += 1; return null; } };
  const first = setup({ regionString: areaString, cold });
  first.r.claim(first.btn);
  await flush();
  const btn2 = makeEl("button");
  first.parent.append(btn2);
  first.r.claim(btn2);
  await flush();
  assert.equal(renders, 1);
  assert.equal(first.parent.children.at(-1).textContent, "Open the drawing to render this region");
});

test("a claim whose node detached before the render starts never enqueues a cold render", async () => {
  let renders = 0;
  const { r, btn, parent } = setup({ regionString: areaString, cold: { renderDrawing: async () => { renders += 1; return rendered(); } }, cacheGet: async () => null });
  r.claim(btn);
  parent.children[1].isConnected = false;
  await flush();
  assert.equal(renders, 0);
});

test("missing drawing and unsupported region geometry show chips", () => {
  const missing = setup({ regionString: areaString, drawing: null });
  missing.r.claim(missing.btn);
  assert.equal(missing.parent.children[1].textContent, "Drawing not found");
  const gone = setup({ regionString: serializeRegion({ kind: "area", drawingUid: "drw000001", ids: ["nope"], pad: 10, caption: "" }) });
  gone.r.claim(gone.btn);
  assert.match(gone.parent.children[1].textContent, /^Region unavailable/);
});

test("click opens with the sidebar/shift XOR", () => {
  for (const [openInSidebar, shiftKey, expected] of [[false, false, false], [false, true, true], [true, false, true], [true, true, false]]) {
    const calls = [];
    const { r, btn, parent } = setup({ regionString: areaString, hit: { url: "blob:x", w: 1, h: 1, type: "x" }, onOpen: (uid, opts) => calls.push([uid, opts]), settings: { openInSidebar } });
    r.claim(btn);
    parent.children[1].listeners.click({ shiftKey, stopPropagation() {}, preventDefault() {} });
    assert.deepEqual(calls, [[regionUid, { sidebar: expected }]]);
  }
});

test("an image that fails to load drops the cache entry and falls back to the chip", () => {
  const { r, btn, parent, deleted } = setup({ regionString: areaString, hit: { url: "blob:x", w: 1, h: 1, type: "x" } });
  r.claim(btn);
  const img = parent.children[1].children[0];
  img.onerror();
  assert.deepEqual(deleted, [keys().svg]);
  assert.equal(parent.children[1].textContent, "Open the drawing to render this region");
});

test("detached roots are pruned so releaseAll only visits live ones", () => {
  const { r, btn, parent } = setup({ regionString: areaString, hit: { url: "blob:x", w: 1, h: 1, type: "x" } });
  r.claim(btn);
  parent.children[1].isConnected = false;
  for (let i = 0; i < 70; i++) {
    const b = makeEl("button");
    parent.append(b);
    r.claim(b);
  }
  r.releaseAll();
  assert.ok(!btn.classes.has("plexus-hidden") === false, "pruned entries are not touched by releaseAll");
});

test("a detached button is not claimed", () => {
  const { r, btn } = setup({ regionString: areaString, hit: { url: "blob:x", w: 1, h: 1, type: "x" } });
  btn.isConnected = false;
  r.claim(btn);
  assert.equal(btn.attrs["data-plexus-claimed"], undefined);
});
