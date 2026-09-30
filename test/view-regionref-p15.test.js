import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { viewportRectOf } from "../src/host/native.js";
import { serializeRegion } from "../src/model/region.js";
import { createCropPopover } from "../src/view/crop-popover.js";
import { regionMatchesTag, regionMeta, createRegionRefRenderer } from "../src/view/regionref.js";
import { createRegionsLayer } from "../src/view/regions-layer.js";

const children = [
  { uid: "c1", string: "one", order: 0 },
  { uid: "c2", string: "Site:: lab", order: 1 },
  { uid: "c3", string: "BT_attrDue:: tomorrow", order: 2 },
  { uid: "c4", string: "three", order: 3 },
  { uid: "c5", string: "Last result:: 4", order: 4 },
  { uid: "c6", string: "Zone:: A", order: 5 },
  { uid: "c7", string: "seven", order: 6 },
];

test("regionMeta counts every child, hovers the first five strings, and keeps non-BT_attr attributes", () => {
  const meta = regionMeta(children);
  assert.equal(meta.count, 7);
  assert.deepEqual(meta.hover, ["one", "Site:: lab", "BT_attrDue:: tomorrow", "three", "Last result:: 4"]);
  assert.deepEqual(meta.attrs, [children[1], children[4], children[5]]);
  const bare = { uid: "bare", string: "Name::", order: 0 };
  const spaced = { uid: "sp", string: "  CFU:: 0", order: 1 };
  const mine = { uid: "mine", string: "MyBT_attr:: kept", order: 2 };
  const hidden = { uid: "hid", string: "BT_attr:: x", order: 3 };
  const tight = { uid: "tight", string: "Site::lab", order: 4 };
  const unordered = [{ uid: "b", string: "second", order: 1 }, { uid: "a", string: "first", order: 0 }];
  assert.deepEqual(regionMeta([bare, spaced, mine, hidden, tight]).attrs, [spaced, mine, tight]);
  assert.deepEqual(regionMeta(unordered).hover, ["second", "first"]);
  assert.deepEqual(regionMeta(["Site:: lab", "note", "BT_attrDue:: x"]), {
    count: 3,
    hover: ["Site:: lab", "note", "BT_attrDue:: x"],
    attrs: ["Site:: lab"],
  });
  assert.deepEqual(regionMeta(null), { count: 0, hover: [], attrs: [] });
  assert.deepEqual(regionMeta(undefined), { count: 0, hover: [], attrs: [] });
  assert.deepEqual(regionMeta("Site:: lab"), { count: 0, hover: [], attrs: [] });
});

test("regionMatchesTag matches hash, brackets, and hash-brackets; an empty tag matches", () => {
  assert.equal(regionMatchesTag(["swab #Lab today"], "Lab"), true);
  assert.equal(regionMatchesTag(["see [[Lab]]"], "Lab"), true);
  assert.equal(regionMatchesTag(["prefix #[[Lab]] suffix"], "Lab"), true);
  assert.equal(regionMatchesTag(["Laboratory", "just Lab"], "Lab"), false);
  assert.equal(regionMatchesTag(["#lab"], "Lab"), false);
  assert.equal(regionMatchesTag(["#a.b"], "a.b"), true);
  assert.equal(regionMatchesTag(["#axb"], "a.b"), false);
  assert.equal(regionMatchesTag([], "Lab"), false);
  assert.equal(regionMatchesTag([], ""), true);
  assert.equal(regionMatchesTag(["nope"], ""), true);
  assert.equal(regionMatchesTag(["nope"], null), true);
  assert.equal(regionMatchesTag(["nope"], undefined), true);
  assert.equal(regionMatchesTag("nope", "Lab"), false);
});

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
    set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
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
    append: (...cs) => { for (const c of cs) { el.children.push(c); c.parentNode = el; el.child = c; } },
    remove: () => { el.isConnected = false; },
    insertBefore: (n, ref) => { el.children.splice(ref ? el.children.indexOf(ref) : el.children.length, 0, n); n.parentNode = el; },
  };
  return el;
}

const regionUid = "reg000001";
const elements = [{ id: "rect-a", type: "rectangle", x: 100, y: 100, width: 220, height: 140, angle: 0, isDeleted: false }];
const regionString = serializeRegion({ kind: "area", drawingUid: "drw000001", ids: ["rect-a"], pad: 10, caption: "Cap" });

function refSetup({ childList, hit, mode = "image" } = {}) {
  const body = makeEl("body");
  const doc = {
    body,
    createElement: (tag) => makeEl(tag),
    addEventListener() {},
    removeEventListener() {},
    defaultView: {
      innerWidth: 1000,
      innerHeight: 800,
      getComputedStyle: () => ({ fontSize: "12px" }),
      addEventListener() {},
      removeEventListener() {},
    },
  };
  const parent = makeEl("p");
  const btn = makeEl("button");
  parent.append(btn);
  const refEl = makeEl("span");
  refEl.parentElement = makeEl("div");
  btn.closest = (sel) => (sel === ".rm-block-ref[data-uid]" ? refEl : null);
  const block = { uid: regionUid, string: regionString, children: childList };
  const host = {
    blockUidFromNode: (n) => (n === btn ? regionUid : "blk000001"),
    pullBlock: (uid) => (uid === regionUid ? block : { uid, string: `see ((${regionUid}))` }),
    drawing: () => ({ uid: "drw000001", elements, hash: "abcd1234" }),
  };
  const cache = {
    peek: (key) => (hit && !String(key).includes("|thumb|") ? hit : null),
    get: async () => null,
    put: async () => {},
    delete: async () => {},
  };
  const r = createRegionRefRenderer({
    host,
    cache,
    cold: { renderDrawing: async () => null },
    getSettings: () => ({ refOverrides: { [`blk000001|${regionUid}`]: { mode } }, figureHeight: 280, thumbHeight: 72 }),
    onOpen() {},
    doc,
  });
  return { r, btn, parent, doc };
}

async function flushHover(t, node) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  node.listeners.mouseenter();
  t.mock.timers.tick(300);
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
}

test("a region ref appends a plain count and one attr chip per attribute without touching the crop", () => {
  const { r, btn, parent } = refSetup({ childList: children, hit: { url: "blob:crop", w: 20, h: 10 } });
  r.claim(btn);
  const root = parent.children[1];
  const meta = regionMeta(children);
  const sup = parent.children.find((c) => c.tag === "sup");
  const attrs = parent.children.filter((c) => c.classes.has("plexus-attr"));
  assert.equal(root.children[0].tag, "img");
  assert.equal(root.children[0].src, "blob:crop");
  assert.equal(root.children.some((c) => c.tag === "sup"), false);
  assert.equal(sup.className, "plexus-count");
  assert.equal(sup.textContent, String(meta.count));
  assert.deepEqual(attrs.map((c) => c.textContent), meta.attrs.map((c) => c.string));
  assert.equal(attrs.every((c) => c.parentNode === sup.parentNode), true);
  r.releaseAll();
  assert.equal(sup.isConnected, false);
  assert.equal(attrs.every((c) => c.isConnected === false), true);

  const bare = refSetup();
  bare.r.claim(bare.btn);
  assert.equal(bare.parent.children.some((c) => c.tag === "sup" || c.classes.has("plexus-attr")), false);
});

test("image mode hovers, and notes still paint when the crop url is missing", async (t) => {
  const { r, btn, parent, doc } = refSetup({ childList: children });
  r.claim(btn);
  const root = parent.children[1];
  assert.ok(root.classes.has("plexus-regionref--image"));
  assert.equal(typeof root.listeners.mouseenter, "function");
  await flushHover(t, root);
  const portal = doc.body.children[0];
  const list = portal.children[0];
  assert.equal(list.className, "plexus-notes");
  assert.deepEqual(list.children.map((c) => c.textContent), regionMeta(children).hover);
  assert.equal(portal.children.some((c) => c.tag === "img"), false);
});

test("image mode hover appends the crop after the notes, one node at a time", async (t) => {
  const { r, btn, parent, doc } = refSetup({ childList: children, hit: { url: "blob:crop", w: 960, h: 720 } });
  r.claim(btn);
  const root = parent.children[1];
  await flushHover(t, root);
  const portal = doc.body.children[0];
  assert.equal(portal.children[0].className, "plexus-notes");
  assert.equal(portal.children.length, 2);
  assert.equal(portal.child, portal.children[1]);
  assert.equal(portal.child.tag, "img");
  assert.equal(portal.child.src, "blob:crop");
  assert.equal(portal.child.style.width, "480px");
  assert.equal(portal.child.style.height, "360px");
});

function popoverDoc() {
  const body = makeEl("body");
  const doc = {
    body,
    createElement: (tag) => makeEl(tag),
    addEventListener() {},
    removeEventListener() {},
    defaultView: {
      innerWidth: 1000,
      innerHeight: 800,
      addEventListener() {},
      removeEventListener() {},
    },
  };
  const anchor = makeEl("a");
  anchor.getBoundingClientRect = () => ({ left: 100, top: 100, bottom: 120 });
  return { doc, body, anchor };
}

const shown = async (entry) => {
  const { doc, body, anchor } = popoverDoc();
  const listeners = {};
  anchor.addEventListener = (t, fn) => { listeners[t] = fn; };
  const p = createCropPopover({ doc, delayMs: 1 });
  p.hoverOn(anchor, async () => entry);
  listeners.mouseenter();
  await new Promise((r) => setTimeout(r, 20));
  return body.children[0] ?? null;
};

test("the crop popover paints at most five notes without a url, and nothing when both are missing", async () => {
  const notes = ["n1", "n2", "n3", "n4", "n5", "n6", "n7"];
  const only = await shown({ notes });
  assert.equal(only.className, "plexus-portal plexus-crop-popover");
  assert.equal(only.children.length, 1);
  assert.equal(only.child.className, "plexus-notes");
  assert.deepEqual(only.child.children.map((c) => c.textContent), notes.slice(0, 5));
  assert.equal(only.children.some((c) => c.tag === "img"), false);
  assert.equal(await shown(null), null);
  assert.equal(await shown({}), null);
  assert.equal(await shown({ notes: [] }), null);
  assert.equal(await shown({ notes: [1, null], url: "" }), null);
});

test("notes plus a url keep the image last and the crop box unchanged", async () => {
  const portal = await shown({ url: "blob:x", w: 960, h: 720, notes: ["a", "b"], invertible: true });
  assert.equal(portal.children[0].className, "plexus-notes");
  assert.deepEqual(portal.children[0].children.map((c) => c.textContent), ["a", "b"]);
  assert.equal(portal.child.tag, "img");
  assert.equal(portal.child.src, "blob:x");
  assert.equal(portal.style.top, "126px");
  assert.equal(portal.child.style.width, "480px");
  assert.equal(portal.child.style.height, "360px");
});

function fakeNode(tag = "div") {
  return {
    tag, children: [], listeners: {}, className: "", style: {}, textContent: "", title: "", attrs: {}, parentNode: null,
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k] ?? null; },
    append(...c) { for (const x of c) { x.parentNode = this; this.children.push(x); } },
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((x) => x !== this); this.parentNode = null; },
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
    removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); },
    fire(t, e = {}) {
      const ev = { key: e.key, defaultPrevented: false, stopped: false, stopPropagation() { this.stopped = true; }, preventDefault() { this.defaultPrevented = true; } };
      for (const f of [...(this.listeners[t] || [])]) f(ev);
      return ev;
    },
  };
}

const rect = (id, x, y, w = 50, h = 40) => ({ id, type: "rectangle", x, y, width: w, height: h, angle: 0, version: 1, isDeleted: false });

function layerSetup() {
  const regions = [
    { uid: "R1", string: "swab #Lab", region: { kind: "area", ids: ["a"], pad: 0, caption: "" } },
    { uid: "R2", string: "Laboratory", region: { kind: "area", ids: ["b"], pad: 0, caption: "" } },
    { uid: "R3", string: "Laboratory", region: { kind: "area", ids: ["c"], pad: 0, caption: "" } },
    { uid: "R4", string: "Laboratory", region: { kind: "area", ids: ["d"], pad: 0, caption: "" } },
  ];
  const blocks = {
    R2: { children: [{ uid: "k2", string: "see [[Lab]]", order: 0 }] },
    R3: { children: [{ uid: "k3", string: "prefix #[[Lab]] suffix", order: 0 }] },
    R4: { children: [{ uid: "k4", string: "just Lab", order: 0 }] },
  };
  const body = fakeNode("body");
  const doc = Object.assign(fakeNode("doc"), {
    body,
    defaultView: {},
    createElement: (t) => fakeNode(t),
    createElementNS: (_n, t) => fakeNode(t),
  });
  const frames = [];
  const raf = (cb) => { frames.push(cb); return frames.length; };
  let writes = 0;
  const subs = {};
  const app = {
    state: { scrollX: 0, scrollY: 0, zoom: { value: 1 }, offsetLeft: 0, offsetTop: 0 },
    elements: [rect("a", 100, 100), rect("b", 300, 100), rect("c", 500, 100), rect("d", 700, 100)],
    getSceneElementsIncludingDeleted() { return this.elements; },
    updateScene() { writes += 1; },
    scene: { updateScene() { writes += 1; } },
  };
  const native = { viewportRectOf, subscribeViewport: (_a, cb) => { subs.cb = cb; return () => {}; } };
  const host = {
    regionsOf: () => regions,
    pullBlock: (uid) => blocks[uid] ?? { children: [] },
    labelSource: () => null,
  };
  const layer = createRegionsLayer({
    doc, app, containerEl: { getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600 }) },
    host, drawingUid: "DRAW", native, raf, caf() {}, now: () => 1000,
  });
  const root = () => body.children.find((c) => /plexus-regions-layer/.test(c.className));
  const svg = () => root()?.children[0]?.children.find((c) => c.tag === "svg");
  const outlines = () => (svg() ? svg().children.filter((c) => String(c.attrs.class).split(/\s+/).includes("plexus-region-outline")) : []);
  const keys = () => doc.listeners.keydown?.length ?? 0;
  return { layer, doc, app, subs, frames, outlines, keys, writes: () => writes };
}

test("setTagFilter dims outlines whose string and children lack the tag, and Escape clears it", () => {
  const s = layerSetup();
  assert.equal(typeof s.layer.setTagFilter, "function");
  assert.equal(s.keys(), 0);
  s.layer.setTagFilter("Lab");
  assert.equal(s.keys(), 1);
  s.layer.setTagFilter("Lab");
  assert.equal(s.keys(), 1);
  s.layer.show();
  const cls = () => s.outlines().map((c) => c.attrs.class);
  assert.deepEqual(cls(), [
    "plexus-region-outline",
    "plexus-region-outline",
    "plexus-region-outline",
    "plexus-region-outline plexus-region-dim",
  ]);
  s.doc.fire("keydown", { key: "a" });
  assert.equal(s.keys(), 1);
  assert.equal(cls()[3], "plexus-region-outline plexus-region-dim");
  s.doc.fire("keydown", { key: "Escape" });
  assert.equal(s.keys(), 0);
  assert.deepEqual(cls(), [
    "plexus-region-outline",
    "plexus-region-outline",
    "plexus-region-outline",
    "plexus-region-outline",
  ]);
  assert.equal(s.writes(), 0);
  s.app.state.scrollX = -20;
  s.subs.cb();
  while (s.frames.length) s.frames.shift()();
  assert.equal(s.writes(), 0);
  assert.equal(cls()[3], "plexus-region-outline");
});

test("a filter set before show dims on the next collect, and dispose drops the key listener", () => {
  const s = layerSetup();
  s.layer.setTagFilter("Nope");
  assert.equal(s.keys(), 1);
  s.layer.show();
  assert.equal(s.outlines().every((c) => c.attrs.class.includes("plexus-region-dim")), true);
  s.layer.setTagFilter("");
  assert.equal(s.keys(), 0);
  assert.equal(s.outlines().every((c) => c.attrs.class === "plexus-region-outline"), true);
  s.layer.setTagFilter("Lab");
  s.layer.dispose();
  assert.equal(s.keys(), 0);
  s.layer.setTagFilter("Lab");
  assert.equal(s.keys(), 0);
  assert.equal(s.writes(), 0);
});

test("p15 css adds the count, attr, notes, and dim rules", () => {
  const css = readFileSync(new URL("../src/extension.css", import.meta.url), "utf8");
  assert.match(css, /sup\.plexus-count\s*\{/);
  assert.match(css, /span\.plexus-attr\s*\{/);
  assert.match(css, /\.plexus-notes\s*\{/);
  assert.match(css, /\.plexus-region-dim\s*\{/);
  assert.doesNotMatch(css, /body:has/);
});
