import assert from "node:assert/strict";
import test from "node:test";

import { createRegionRefRenderer } from "../src/view/regionref.js";
import { serializeRegion, geometryKey } from "../src/model/region.js";
import { cropKey, png2xKey, thumbKey } from "../src/host/cache.js";
import { resetThemeMemo } from "../src/host/theme.js";

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
    removeEventListener: (t, fn) => { if (el.listeners[t] === fn) delete el.listeners[t]; },
    matches: () => false,
    closest: () => null,
    append: (...cs) => { for (const c of cs) { el.children.push(c); c.parentNode = el; } },
    remove: () => { el.isConnected = false; },
    insertBefore: (n, ref) => { el.children.splice(ref ? el.children.indexOf(ref) : el.children.length, 0, n); n.parentNode = el; },
  };
  return el;
}

function makeDoc({ dark = false } = {}) {
  resetThemeMemo();
  const body = makeEl("body");
  body.kids = [];
  body.append = (...cs) => { for (const c of cs) { body.kids.push(c); c.isConnected = true; } };
  if (dark) body.classList.add("bp3-dark");
  return {
    body,
    documentElement: makeEl("html"),
    defaultView: { innerWidth: 1200, innerHeight: 900, getComputedStyle: () => ({ fontSize: "12px" }), addEventListener() {}, removeEventListener() {} },
    createElement: (tag) => makeEl(tag),
    addEventListener() {},
    removeEventListener() {},
  };
}

const regionUid = "reg000001";
const elements = [
  { id: "rect-a", type: "rectangle", x: 100, y: 100, width: 220, height: 140, angle: 0, isDeleted: false },
  { id: "rect-b", type: "rectangle", x: 420, y: 120, width: 160, height: 100, angle: 0, isDeleted: false },
];
const areaString = serializeRegion({ kind: "area", drawingUid: "drw000001", ids: ["rect-a"], pad: 10, caption: "Cap" });
const gk = geometryKey({ kind: "area", drawingUid: "drw000001", ids: ["rect-a"], pad: 10 });
const K = {
  svg: cropKey({ regionUid, geometryKey: gk, drawingHash: "abcd1234", tier: "svg" }),
  png: cropKey({ regionUid, geometryKey: gk, drawingHash: "abcd1234", tier: "png" }),
  png2x: png2xKey({ regionUid, geometryKey: gk, drawingHash: "abcd1234" }),
  dark: png2xKey({ regionUid, geometryKey: gk, drawingHash: "abcd1234", dark: true }),
  thumb: thumbKey({ uid: "drw000001", hash: "abcd1234", maxWidth: 160 }),
};

function setup({ store = {}, dark = false, settings = {}, drawing, labelSource } = {}) {
  const doc = makeDoc({ dark });
  const parent = makeEl("p");
  const btn = makeEl("button");
  parent.append(btn);
  const peeks = [];
  const gets = [];
  const cache = {
    peek: (key) => { peeks.push(key); return store[key] ?? null; },
    get: async (key) => { gets.push(key); return store[key] ?? null; },
    put: async () => {},
    delete: async () => {},
  };
  const d = drawing === undefined ? { uid: "drw000001", elements, hash: "abcd1234" } : drawing;
  const host = {
    blockUidFromNode: () => regionUid,
    pullBlock: () => ({ uid: regionUid, string: areaString }),
    drawing: () => d,
    labelSource: labelSource || (() => ({ string: "Plant map", pageTitle: "Plant map" })),
  };
  const r = createRegionRefRenderer({ host, cache, cold: { renderDrawing: async () => null }, getSettings: () => ({ figureHeight: 360, ...settings }), onOpen() {}, doc });
  return { r, btn, parent, doc, peeks, gets };
}

const entry = (url) => ({ url, w: 10, h: 10, type: "image/png" });
const paintedImg = (parent) => parent.children[1].children[0];

test("paint order is svg, then png2x, then png; png2x is never read with get", () => {
  const a = setup({ store: { [K.png2x]: entry("blob:2x"), [K.png]: entry("blob:1x") } });
  a.r.claim(a.btn);
  assert.equal(paintedImg(a.parent).src, "blob:2x");
  assert.deepEqual(a.peeks, [K.svg, K.png2x]);
  const b = setup({ store: { [K.svg]: entry("blob:svg"), [K.png2x]: entry("blob:2x") } });
  b.r.claim(b.btn);
  assert.equal(paintedImg(b.parent).src, "blob:svg");
  const c = setup({ store: { [K.png]: entry("blob:1x") } });
  c.r.claim(c.btn);
  assert.equal(paintedImg(c.parent).src, "blob:1x");
  assert.ok(![...a.gets, ...b.gets, ...c.gets].includes(K.png2x));
});

test("a warm png2x-dark paints first in a dark host and is never inverted", () => {
  const { r, btn, parent, peeks } = setup({ dark: true, store: { [K.dark]: entry("blob:dark"), [K.svg]: entry("blob:svg"), [K.png2x]: entry("blob:2x") } });
  r.claim(btn);
  const img = paintedImg(parent);
  assert.equal(img.src, "blob:dark");
  assert.equal(peeks[0], K.dark);
  assert.ok(!img.classes.has("plexus-crop--invertible"));
  assert.ok(!img.classes.has("plexus-crop--invert"));
});

test("png2x-dark is skipped when the host is light, darkCrops is off or the drawing is dark", () => {
  for (const cfg of [{ dark: false }, { dark: true, settings: { darkCrops: false } }, { dark: true, drawing: { uid: "drw000001", elements, hash: "abcd1234", appState: { theme: "dark" } } }]) {
    const { r, btn, parent, peeks } = setup({ ...cfg, store: { [K.dark]: entry("blob:dark"), [K.svg]: entry("blob:svg") } });
    r.claim(btn);
    assert.equal(paintedImg(parent).src, "blob:svg");
    assert.ok(!peeks.includes(K.dark));
  }
});

test("a light png2x entry keeps the invertible class like the svg", () => {
  const { r, btn, parent } = setup({ store: { [K.png2x]: entry("blob:2x") } });
  r.claim(btn);
  assert.ok(paintedImg(parent).classes.has("plexus-crop--invertible"));
});

function aliasAnchor() {
  const a = makeEl("a");
  a.classes = new Set(["rm-alias--block"]);
  a.dataset = { linkUid: regionUid };
  return a;
}

test("REF-4: the hover entry carries a cache-only peek with the region outline in thumbnail pixels", async () => {
  const { r, doc, gets } = setup({ store: { [K.png]: entry("blob:1x"), [K.thumb]: { url: "blob:thumb", w: 160, h: 51, type: "image/png" } } });
  const anchor = aliasAnchor();
  r.claimAlias(anchor);
  anchor.listeners.mouseenter();
  await new Promise((res) => setTimeout(res, 380));
  const portal = doc.body.kids[0];
  assert.ok(portal, "popover shown");
  const [head, row] = portal.children;
  assert.equal(head.textContent, "Plant map · area");
  const [crop, thumb] = row.children;
  assert.equal(crop.src, "blob:1x");
  const [timg, outline] = thumb.children;
  assert.equal(timg.src, "blob:thumb");
  // area bbox [90,90,330,250] over export box 500x160: 240x160 at (0,0) scaled by 160/500 and 51/160
  assert.equal(outline.style.left, "0px");
  assert.equal(outline.style.top, "0px");
  assert.equal(outline.style.width, `${240 * (160 / 500)}px`);
  assert.equal(outline.style.height, `${160 * (51 / 160)}px`);
  assert.ok(gets.includes(K.thumb) === false, "warm thumbnail comes from peek");
});

test("REF-4: a cold thumbnail shows the crop alone", async () => {
  const { r, doc } = setup({ store: { [K.png]: entry("blob:1x") } });
  const anchor = aliasAnchor();
  r.claimAlias(anchor);
  anchor.listeners.mouseenter();
  await new Promise((res) => setTimeout(res, 380));
  const portal = doc.body.kids[0];
  assert.ok(portal);
  assert.equal(portal.children.length, 1);
  assert.equal(portal.children[0].src, "blob:1x");
});
