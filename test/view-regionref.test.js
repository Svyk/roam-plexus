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
    removeEventListener: (t, fn) => { if (el.listeners[t] === fn) delete el.listeners[t]; },
    matches: (sel) => sel.split(",").map((x) => x.trim()).some((x) => x.startsWith(".") && el.classes.has(x.slice(1))),
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
    getSettings: () => ({ figureHeight: 360, openInSidebar: false, ...settings }),
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
    png2x: cropKey({ regionUid, geometryKey: gk, drawingHash: "abcd1234", tier: "png2x" }),
    png: cropKey({ regionUid, geometryKey: gk, drawingHash: "abcd1234", tier: "png" }),
  };
};
const rendered = (naturalWidth = 500, naturalHeight = 160) => ({ canvas: {}, naturalWidth, naturalHeight });

test("hot path peeks the exact svg, png2x, then png key (region uid, geometry, drawing hash)", () => {
  const { r, btn, peeks } = setup({ regionString: areaString });
  r.claim(btn);
  assert.deepEqual(peeks.slice(0, 3), [keys().svg, keys().png2x, keys().png]);
});

test("cold render: crops the png, puts it under the png key, paints it", async () => {
  const { r, btn, parent, puts } = setup({ regionString: areaString, cold: { renderDrawing: async () => rendered() } });
  r.claim(btn);
  assert.ok(parent.children[1].classes.has("plexus-placeholder"));
  await flush();
  assert.equal(puts.length, 1);
  assert.equal(puts[0][0], keys().png);
  assert.equal(puts[0][2].persist, true);
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

test("F4: an image drawing asks for a 1200 ms settle, a plain one for 150 ms", async () => {
  const seen = [];
  const cold = { renderDrawing: async (uid, opts) => { seen.push(opts.settleMs); return null; } };
  const plain = setup({ regionString: areaString, cold });
  plain.r.claim(plain.btn);
  await flush();
  const withImage = setup({
    regionString: areaString,
    cold,
    drawing: { uid: "drw000001", hash: "img", elements: [...elements, { id: "im", type: "image", fileId: "f", x: 0, y: 0, width: 5, height: 5, angle: 0, isDeleted: false }] },
  });
  withImage.r.claim(withImage.btn);
  await flush();
  assert.deepEqual(seen, [150, 1200]);
});

test("F4: an unsettled render is painted but not persisted", async () => {
  const { r, btn, parent, puts } = setup({ regionString: areaString, cold: { renderDrawing: async () => ({ ...rendered(), settled: false }) } });
  r.claim(btn);
  await flush();
  assert.equal(puts.length, 1);
  assert.equal(puts[0][2].persist, false);
  assert.equal(parent.children[1].children[0].src, "blob:png");
});

test("U2: a ref inside text gets a thumbnail card; alone gives image; API refreshes in place", async () => {
  const parent = makeEl("p");
  const btn = makeEl("button");
  parent.append(btn);
  const refEl = makeEl("span");
  refEl.parentElement = makeEl("div");
  refEl.closest = () => ({ id: "block-input-x-outer0001" });
  btn.closest = (sel) => (sel === ".rm-block-ref[data-uid]" ? refEl : null);
  let refString = `see ((${regionUid}))`;
  let overrides = {};
  const host = {
    blockUidFromNode: (n) => (n === btn ? regionUid : "blk000001"),
    pullBlock: (uid) => ({ uid, string: uid === regionUid ? areaString : refString }),
    drawing: () => ({ uid: "drw000001", elements, hash: "abcd1234" }),
  };
  const cache = { peek: () => ({ url: "blob:x", w: 1, h: 1 }), get: async () => null, put: async () => {}, delete: async () => {} };
  const r = createRegionRefRenderer({ host, cache, cold: {}, getSettings: () => ({ figureHeight: 280, thumbHeight: 72, refOverrides: overrides }), onOpen() {}, doc });
  r.claim(btn);
  const root = parent.children[1];
  assert.ok(refEl.classes.has("plexus-ref-card") && refEl.classes.has("plexus-mode-thumbnail"));
  assert.ok(root.classes.has("plexus-regionref--thumbnail"));
  assert.equal(root.children[0].style.height, "72px");
  assert.equal(r.modeOf({ blockUid: "blk000001", refUid: regionUid }), "thumbnail");

  refString = `((${regionUid}))`;
  r.refreshBlock("blk000001");
  assert.equal(parent.children.filter((c) => c.classes.has("plexus-root") && c.isConnected).length, 1);
  assert.ok(refEl.classes.has("plexus-mode-image") && !refEl.classes.has("plexus-mode-thumbnail"));

  overrides = { [`blk000001|${regionUid}`]: "link" };
  r.refreshAll();
  const live = parent.children.filter((c) => c.classes.has("plexus-root") && c.isConnected);
  assert.equal(live.length, 1);
  assert.ok(live[0].classes.has("plexus-ref-glyph"));
  assert.ok(!refEl.classes.has("plexus-ref-card"));
  assert.equal(r.modeOf({ blockUid: "blk000001", refUid: regionUid }), "link");

  await r.refreshRegion(regionUid);
  assert.equal(parent.children.filter((c) => c.classes.has("plexus-root") && c.isConnected).length, 1);
  r.releaseAll();
  assert.ok(!refEl.classes.has("plexus-ref-card"));
  assert.ok(!btn.classes.has("plexus-hidden"));
});

test("U2: refreshAll over two roots leaves two roots; disconnected buttons are dropped", () => {
  const { r, btn, parent } = setup({ regionString: areaString, hit: { url: "blob:x", w: 1, h: 1, type: "x" } });
  const btn2 = makeEl("button");
  parent.append(btn2);
  r.claim(btn);
  r.claim(btn2);
  r.refreshAll();
  assert.equal(parent.children.filter((c) => c.classes.has("plexus-root") && c.isConnected).length, 2);
  btn2.isConnected = false;
  r.refreshAll();
  assert.equal(parent.children.filter((c) => c.classes.has("plexus-root") && c.isConnected).length, 1);
});

test("U2: the crop is invertible for a light drawing without images and not for image kinds or dark drawings", () => {
  const hit = { url: "blob:x", w: 1, h: 1, type: "x" };
  const a = setup({ regionString: areaString, hit });
  a.r.claim(a.btn);
  assert.ok(a.parent.children[1].children[0].classes.has("plexus-crop--invertible"));
  const b = setup({ regionString: areaString, hit, drawing: { uid: "drw000001", hash: "h", elements, appState: { theme: "dark" } } });
  b.r.claim(b.btn);
  assert.ok(!b.parent.children[1].children[0].classes.has("plexus-crop--invertible"));
  const c = setup({ regionString: areaString, hit, settings: { darkCrops: false } });
  c.r.claim(c.btn);
  assert.ok(!c.parent.children[1].children[0].classes.has("plexus-crop--invertible"));
});

test("P6 fix: a host-dark marker leaves --invert to CSS; luminance-only dark stamps it", async () => {
  const { resetThemeMemo } = await import("../src/host/theme.js");
  const hit = { url: "blob:x", w: 1, h: 1, type: "x" };
  const cls = (...c) => ({ classList: { contains: (x) => c.includes(x) } });
  try {
    doc.documentElement = cls();
    doc.body = cls("bp3-dark");
    resetThemeMemo();
    const a = setup({ regionString: areaString, hit });
    a.r.claim(a.btn);
    const ia = a.parent.children[1].children[0];
    assert.ok(ia.classes.has("plexus-crop--invertible"));
    assert.ok(!ia.classes.has("plexus-crop--invert"));
    doc.body = cls();
    doc.defaultView = { getComputedStyle: () => ({ backgroundColor: "rgb(20, 20, 20)" }) };
    resetThemeMemo();
    const b = setup({ regionString: areaString, hit });
    b.r.claim(b.btn);
    const ib = b.parent.children[1].children[0];
    assert.ok(ib.classes.has("plexus-crop--invertible"));
    assert.ok(ib.classes.has("plexus-crop--invert"));
  } finally {
    delete doc.body; delete doc.documentElement; delete doc.defaultView;
    resetThemeMemo();
  }
});

test("P6 fix: thumbnails lift the base max-height and cap width with min(100%, ...)", () => {
  const parent = makeEl("p");
  const btn = makeEl("button");
  parent.append(btn);
  const refEl = makeEl("span");
  refEl.parentElement = makeEl("div");
  refEl.closest = () => ({ id: "block-input-x-outer0001" });
  btn.closest = (sel) => (sel === ".rm-block-ref[data-uid]" ? refEl : null);
  const host = {
    blockUidFromNode: (n) => (n === btn ? regionUid : "blk000001"),
    pullBlock: (uid) => ({ uid, string: uid === regionUid ? areaString : `see ((${regionUid}))` }),
    drawing: () => ({ uid: "drw000001", elements, hash: "abcd1234" }),
  };
  const cache = { peek: () => ({ url: "blob:x", w: 1, h: 1 }), get: async () => null, put: async () => {}, delete: async () => {} };
  const r = createRegionRefRenderer({ host, cache, cold: {}, getSettings: () => ({ figureHeight: 280, thumbHeight: 400, refOverrides: {} }), onOpen() {}, doc });
  r.claim(btn);
  const img = parent.children[1].children[0];
  assert.equal(img.style.height, "400px");
  assert.equal(img.style.maxHeight, "none");
  assert.match(img.style.maxWidth, /^min\(100%/);
});

function hostSetup({ thumbnail = true, refs = 1, settings = {} } = {}) {
  const outer = makeEl("span");
  outer.classes.add("bp3-popover-target");
  const wrapper = makeEl("span");
  wrapper.classes.add("bp3-popover-wrapper");
  wrapper.parentElement = outer;
  const inner = makeEl("span");
  inner.classes.add("bp3-popover-target");
  inner.parentElement = wrapper;
  const input = makeEl("div");
  input.classes.add("rm-block__input");
  const beyond = makeEl("span");
  beyond.classes.add("bp3-popover-target");
  input.parentElement = beyond;
  outer.parentElement = input;
  const refEls = [];
  const btns = [];
  const parents = [];
  for (let i = 0; i < refs; i += 1) {
    const parent = makeEl("p");
    const btn = makeEl("button");
    parent.append(btn);
    const refEl = makeEl("span");
    refEl.parentElement = i === 0 ? inner : makeEl("span");
    if (i > 0) refEl.parentElement.parentElement = inner;
    refEl.closest = () => ({ id: "block-input-x-outer0001" });
    btn.closest = (sel) => (sel === ".rm-block-ref[data-uid]" ? refEl : null);
    refEls.push(refEl); btns.push(btn); parents.push(parent);
  }
  const host = {
    blockUidFromNode: (n) => (btns.includes(n) ? regionUid : "blk000001"),
    pullBlock: (uid) => ({ uid, string: uid === regionUid ? areaString : thumbnail ? `see ((${regionUid}))` : `((${regionUid}))` }),
    drawing: () => ({ uid: "drw000001", elements, hash: "abcd1234" }),
  };
  const cache = { peek: () => ({ url: "blob:x", w: 1, h: 1 }), get: async () => null, put: async () => {}, delete: async () => {} };
  const r = createRegionRefRenderer({ host, cache, cold: {}, getSettings: () => ({ figureHeight: 280, thumbHeight: 72, refOverrides: {}, ...settings }), onOpen() {}, doc });
  return { r, btns, parents, refEls, chain: [inner, wrapper, outer], beyond };
}

test("host attr: added to popover ancestors up to the block input, removed on release and refresh", () => {
  const { r, btns, chain, beyond } = hostSetup();
  r.claim(btns[0]);
  assert.ok(chain.every((e) => e.attrs["data-plexus-card-host"]));
  assert.ok(!beyond.attrs["data-plexus-card-host"]);
  r.refreshAll();
  assert.ok(chain.every((e) => e.attrs["data-plexus-card-host"]));
  r.releaseAll();
  assert.ok(chain.every((e) => !e.attrs["data-plexus-card-host"]));
});

test("host attr: shared ancestors are refcounted", () => {
  const s = hostSetup({ refs: 2 });
  s.r.claim(s.btns[0]);
  s.r.claim(s.btns[1]);
  const [inner, wrapper] = s.chain;
  assert.ok(inner.attrs["data-plexus-card-host"] && wrapper.attrs["data-plexus-card-host"]);
  s.r.releaseAll();
  assert.ok(!inner.attrs["data-plexus-card-host"] && !wrapper.attrs["data-plexus-card-host"]);

  const t = hostSetup({ refs: 2 });
  t.r.claim(t.btns[0]);
  t.r.claim(t.btns[1]);
  const shared = t.chain[1];
  // release only the first ref: the shared wrapper is still used by the second
  t.parents[0].children[1].remove();
  t.btns[0].isConnected = false;
  t.r.refreshAll();
  assert.ok(shared.attrs["data-plexus-card-host"]);
  t.btns[1].isConnected = false;
  t.r.refreshAll();
  assert.ok(!shared.attrs["data-plexus-card-host"]);
  assert.ok(!t.chain[0].attrs["data-plexus-card-host"]);
});

test("host attr: link mode never marks ancestors", () => {
  const { r, btns, chain } = hostSetup({ settings: { inlineDisplay: "link" } });
  r.claim(btns[0]);
  assert.ok(chain.every((e) => !e.attrs["data-plexus-card-host"]));
});

test("hover stoppers: thumbnail on root, link on refEl, image none; disposed on release", () => {
  const stop = { stopped: 0, stopPropagation() { this.stopped += 1; } };
  const t = hostSetup();
  t.r.claim(t.btns[0]);
  const troot = t.parents[0].children[1];
  assert.equal(typeof troot.listeners.mouseover, "function");
  assert.equal(typeof troot.listeners.mouseout, "function");
  assert.equal(typeof troot.listeners.mouseenter, "function");
  assert.equal(t.refEls[0].listeners.mouseenter, undefined);
  assert.equal(t.refEls[0].listeners.mouseover, undefined);
  troot.listeners.mouseover(stop);
  assert.equal(stop.stopped, 1);
  t.r.releaseAll();
  assert.equal(troot.listeners.mouseover, undefined);

  const l = hostSetup({ settings: { inlineDisplay: "link" } });
  l.r.claim(l.btns[0]);
  const lref = l.refEls[0];
  assert.equal(typeof lref.listeners.mouseenter, "function");
  assert.equal(typeof lref.listeners.mouseover, "function");
  assert.equal(typeof lref.listeners.mouseout, "function");
  assert.equal(l.parents[0].children[1].listeners.mouseover, undefined);

  const i = hostSetup({ thumbnail: false });
  i.r.claim(i.btns[0]);
  const iroot = i.parents[0].children[1];
  assert.ok(iroot.classes.has("plexus-regionref--image"));
  assert.equal(iroot.listeners.mouseover, undefined);
  assert.equal(iroot.listeners.mouseenter, undefined);
  assert.equal(i.refEls[0].listeners.mouseover, undefined);
  assert.equal(i.refEls[0].listeners.mouseenter, undefined);
});

test("host attr survives React overwriting the ancestor className", () => {
  const { r, btns, chain } = hostSetup();
  r.claim(btns[0]);
  chain[0].className = "bp3-popover-target bp3-popover-open";
  assert.equal(chain[0].attrs["data-plexus-card-host"], "1");
  r.releaseAll();
  assert.equal(chain[0].attrs["data-plexus-card-host"], undefined);
});
