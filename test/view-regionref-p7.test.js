import assert from "node:assert/strict";
import test from "node:test";

import { createRegionRefRenderer } from "../src/view/regionref.js";
import { serializeRegion } from "../src/model/region.js";

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
  defaultView: { getComputedStyle: () => ({ fontSize: "12px" }) },
  createElement: (tag) => makeEl(tag),
};

const regionUid = "reg000001";
const elements = [{ id: "rect-a", type: "rectangle", x: 100, y: 100, width: 220, height: 140, angle: 0, isDeleted: false }];
const stringOf = (caption) => serializeRegion({ kind: "area", drawingUid: "drw000001", ids: ["rect-a"], pad: 10, caption });

function cardSetup({ caption = "Cap", blockString = `see ((${regionUid}))`, settings = {}, labelSource, getDoc = doc } = {}) {
  const parent = makeEl("p");
  const btn = makeEl("button");
  parent.append(btn);
  const refEl = makeEl("span");
  refEl.parentElement = makeEl("div");
  refEl.closest = () => ({ id: "block-input-x-outer0001" });
  btn.closest = (sel) => (sel === ".rm-block-ref[data-uid]" ? refEl : null);
  const calls = [];
  const host = {
    blockUidFromNode: (n) => (n === btn ? regionUid : "blk000001"),
    pullBlock: (uid) => ({ uid, string: uid === regionUid ? stringOf(caption) : blockString }),
    drawing: () => ({ uid: "drw000001", elements, hash: "abcd1234" }),
    ...(labelSource ? { labelSource } : {}),
  };
  const cache = { peek: () => ({ url: "blob:x", w: 1, h: 1 }), get: async () => null, put: async () => {}, delete: async () => {} };
  const r = createRegionRefRenderer({
    host,
    cache,
    cold: {},
    getSettings: () => ({ figureHeight: 280, thumbHeight: 72, refOverrides: {}, ...settings }),
    onOpen: (uid, opts) => calls.push([uid, opts]),
    doc: getDoc,
  });
  return { r, btn, parent, refEl, calls };
}

const rootOf = (parent) => parent.children[1];
const key = `blk000001|${regionUid}`;

test("caption display: never hides the card and restores font size on the root", () => {
  const { r, btn, parent, refEl } = cardSetup({ settings: { captionDisplay: "never" } });
  r.claim(btn);
  assert.ok(refEl.classes.has("plexus-caption-hidden"));
  assert.equal(rootOf(parent).style.fontSize, "12px");
  assert.equal(r.captionStateOf({ blockUid: "blk000001", refUid: regionUid }), "hide");
  r.releaseAll();
  assert.ok(!refEl.classes.has("plexus-caption-hidden"));
});

test("caption display: a missing defaultView still hides without an inline size", () => {
  const { r, btn, parent, refEl } = cardSetup({ settings: { captionDisplay: "never" }, getDoc: { createElement: doc.createElement } });
  r.claim(btn);
  assert.ok(refEl.classes.has("plexus-caption-hidden"));
  assert.equal(rootOf(parent).style.fontSize, undefined);
});

test("caption display: written adds nothing; the per-ref show override adds the derived label only for an empty tail", () => {
  const w = cardSetup({ caption: "" });
  w.r.claim(w.btn);
  assert.ok(!w.refEl.classes.has("plexus-caption-hidden"));
  assert.equal(w.parent.children.length, 2);

  const empty = cardSetup({ caption: "", settings: { captionDisplay: "always" } });
  empty.r.claim(empty.btn);
  const derived = empty.parent.children[2];
  assert.ok(derived.classes.has("plexus-caption-derived") && derived.classes.has("plexus-root"));
  assert.match(derived.textContent, /area/);
  empty.r.releaseAll();
  assert.equal(derived.isConnected, false);

  const written = cardSetup({ caption: "Cap", settings: { captionDisplay: "always" } });
  written.r.claim(written.btn);
  assert.equal(written.parent.children.length, 2);
});

test("caption display: override caption wins, and mode and caption are looked up per field", () => {
  const show = cardSetup({ caption: "", settings: { captionDisplay: "never", refOverrides: { [key]: { caption: "show" } } } });
  show.r.claim(show.btn);
  assert.ok(!show.refEl.classes.has("plexus-caption-hidden"));
  assert.ok(show.parent.children[2].classes.has("plexus-caption-derived"));

  // a caption-only entry on the block must not shadow the outer entry's mode
  const merged = cardSetup({ settings: { refOverrides: { [key]: { caption: "hide" }, [`outer0001|${regionUid}`]: { mode: "image" } } } });
  merged.r.claim(merged.btn);
  assert.ok(merged.refEl.classes.has("plexus-mode-image"));
  assert.ok(merged.refEl.classes.has("plexus-caption-hidden"));
});

test("link mode never hides; an empty tail appends the derived label after the glyph", () => {
  const empty = cardSetup({ caption: "", settings: { inlineDisplay: "link", captionDisplay: "never" } });
  empty.r.claim(empty.btn);
  assert.ok(!empty.refEl.classes.has("plexus-caption-hidden"));
  const label = empty.parent.children[2];
  assert.ok(label.classes.has("plexus-ref-label") && label.classes.has("plexus-root"));
  assert.match(label.textContent, /area/);
  empty.r.refreshAll();
  assert.equal(label.isConnected, false);
  assert.equal(empty.parent.children.filter((c) => c.isConnected && c.classes.has("plexus-ref-label")).length, 1);

  const tail = cardSetup({ caption: "Cap", settings: { inlineDisplay: "link" } });
  tail.r.claim(tail.btn);
  assert.equal(tail.parent.children.length, 2);
});

test("home context: nothing is hidden or added", () => {
  const parent = makeEl("p");
  const btn = makeEl("button");
  parent.append(btn);
  const host = {
    blockUidFromNode: () => regionUid,
    pullBlock: () => ({ uid: regionUid, string: stringOf("") }),
    drawing: () => ({ uid: "drw000001", elements, hash: "abcd1234" }),
  };
  const cache = { peek: () => ({ url: "blob:x", w: 1, h: 1 }), get: async () => null, put: async () => {}, delete: async () => {} };
  const r = createRegionRefRenderer({ host, cache, cold: {}, getSettings: () => ({ captionDisplay: "always" }), onOpen() {}, doc });
  r.claim(btn);
  assert.equal(parent.children.length, 2);
});

test("UX-4: label as title, role, aria-label, tabindex and img alt", () => {
  const { r, btn, parent } = cardSetup({ caption: "Site 12" });
  r.claim(btn);
  const root = rootOf(parent);
  assert.equal(root.title, "Site 12");
  assert.equal(root.attrs.role, "img");
  assert.equal(root.attrs["aria-label"], "Site 12");
  assert.equal(root.attrs.tabindex, "0");
  assert.equal(root.children[0].alt, "Site 12");
});

test("UX-4: an empty caption is labelled from the drawing title and kind, via labelSource", () => {
  const { r, btn, parent } = cardSetup({ caption: "", labelSource: () => ({ string: "{{[[excalidraw]]}}", pageTitle: "Line 3" }) });
  r.claim(btn);
  assert.equal(rootOf(parent).title, "Line 3 · area");
});

test("UX-4: a throwing labelSource falls back to Region", () => {
  const { r, btn, parent } = cardSetup({ caption: "", labelSource: () => { throw new Error("boom"); } });
  r.claim(btn);
  assert.equal(rootOf(parent).title, "Region");
});

test("UX-4: chips get no role, tabindex or aria-label", () => {
  const parent = makeEl("p");
  const btn = makeEl("button");
  parent.append(btn);
  const host = { blockUidFromNode: () => regionUid, pullBlock: () => ({ uid: regionUid, string: "{{[[plexus-region]]: k=poly d=drw000001 ids=a}}" }), drawing: () => null };
  const r = createRegionRefRenderer({ host, cache: {}, cold: {}, getSettings: () => ({}), onOpen() {}, doc });
  r.claim(btn);
  const root = rootOf(parent);
  assert.equal(root.attrs.role, undefined);
  assert.equal(root.attrs.tabindex, undefined);
  assert.equal(root.attrs["aria-label"], undefined);
});

test("UX-4: Enter and Space open with the click XOR; modified and other keys pass", () => {
  const { r, btn, parent, calls } = cardSetup({ settings: { openInSidebar: false } });
  r.claim(btn);
  const keydown = rootOf(parent).listeners.keydown;
  let prevented = 0;
  const ev = (o) => ({ preventDefault() { prevented += 1; }, stopPropagation() {}, ...o });
  keydown(ev({ key: "Enter" }));
  keydown(ev({ key: " " }));
  keydown(ev({ key: "Enter", shiftKey: true }));
  keydown(ev({ key: "Enter", ctrlKey: true }));
  keydown(ev({ key: "Enter", metaKey: true }));
  keydown(ev({ key: "Enter", altKey: true }));
  keydown(ev({ key: "Enter", isComposing: true }));
  keydown(ev({ key: "a" }));
  assert.deepEqual(calls, [[regionUid, { sidebar: false }], [regionUid, { sidebar: false }], [regionUid, { sidebar: true }]]);
  assert.equal(prevented, 3);
});

function aliasSetup({ region = true, settings = {}, uid = regionUid, pull } = {}) {
  const anchor = makeEl("a");
  anchor.className = "rm-alias rm-alias--block";
  anchor.attrs["data-link-uid"] = uid;
  anchor.dataset = { linkUid: uid };
  const calls = [];
  let supported = region;
  const host = {
    blockUidFromNode: () => null,
    pullBlock: pull || (() => ({ uid, string: supported ? stringOf("Cap") : "just text" })),
    drawing: () => ({ uid: "drw000001", elements, hash: "abcd1234" }),
  };
  const cache = { peek: () => ({ url: "blob:x", w: 1, h: 1 }), get: async () => null, put: async () => {}, delete: async () => {} };
  const r = createRegionRefRenderer({ host, cache, cold: {}, getSettings: () => ({ openInSidebar: false, ...settings }), onOpen: (u, o) => calls.push([u, o]), doc });
  return { r, anchor, calls, unsupport: () => { supported = false; } };
}

const clickEv = (o = {}) => ({ button: 0, stoppedProp: 0, prevented: 0, stopPropagation() { this.stoppedProp += 1; }, preventDefault() { this.prevented += 1; }, ...o });

test("REF-3: a region alias is claimed with hover, stoppers and a capture click that opens the region", () => {
  const { r, anchor, calls } = aliasSetup();
  r.claimAlias(anchor);
  assert.equal(anchor.attrs["data-plexus-alias"], "1");
  assert.equal(typeof anchor.listeners.mouseenter, "function");
  assert.equal(typeof anchor.listeners.mouseover, "function");
  assert.equal(typeof anchor.listeners.mouseout, "function");
  const stop = { n: 0, stopPropagation() { this.n += 1; } };
  anchor.listeners.mouseover(stop);
  assert.equal(stop.n, 1);

  const down = clickEv();
  anchor.listeners.mousedown(down);
  assert.equal(down.prevented, 1);
  assert.equal(down.stoppedProp, 1);
  assert.equal(calls.length, 0);
  const click = clickEv();
  anchor.listeners.click(click);
  assert.equal(click.prevented, 1);
  assert.equal(click.stoppedProp, 1);
  assert.deepEqual(calls, [[regionUid, { sidebar: false }]]);
});

test("REF-3: modified and non-primary clicks stay Roam's; Shift-click never opens", () => {
  const { r, anchor, calls } = aliasSetup({ settings: { openInSidebar: true } });
  r.claimAlias(anchor);
  for (const o of [{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { button: 1 }]) {
    const ev = clickEv(o);
    anchor.listeners.click(ev);
    anchor.listeners.mousedown(ev);
    assert.equal(ev.prevented, 0);
    assert.equal(ev.stoppedProp, 0);
  }
  assert.equal(calls.length, 0);
  anchor.listeners.click(clickEv());
  assert.deepEqual(calls, [[regionUid, { sidebar: true }]]);
});

test("REF-3: a target that stopped being a region leaves the click to Roam", () => {
  const { r, anchor, calls, unsupport } = aliasSetup();
  r.claimAlias(anchor);
  unsupport();
  const ev = clickEv();
  anchor.listeners.click(ev);
  assert.equal(ev.prevented, 0);
  assert.equal(calls.length, 0);
});

test("REF-3: non-region targets, page aliases, own output and offscreen anchors are skipped without writing attributes", () => {
  const plain = aliasSetup({ region: false });
  plain.r.claimAlias(plain.anchor);
  assert.deepEqual(plain.anchor.attrs, { "data-link-uid": regionUid });
  assert.equal(plain.anchor.listeners.click, undefined);

  const page = aliasSetup();
  page.anchor.className = "rm-alias rm-alias--page";
  page.r.claimAlias(page.anchor);
  assert.equal(page.anchor.attrs["data-plexus-alias"], undefined);

  const own = aliasSetup();
  own.anchor.closest = (sel) => (sel.includes("plexus-root") ? {} : null);
  own.r.claimAlias(own.anchor);
  assert.equal(own.anchor.attrs["data-plexus-alias"], undefined);

  const off = aliasSetup();
  off.anchor.closest = (sel) => (sel.includes("plexus-offscreen") ? {} : null);
  off.r.claimAlias(off.anchor);
  assert.equal(off.anchor.attrs["data-plexus-alias"], undefined);
});

test("REF-3: already claimed anchors are not claimed twice; releaseAll removes the attribute and listeners", () => {
  const { r, anchor } = aliasSetup();
  r.claimAlias(anchor);
  const click = anchor.listeners.click;
  r.claimAlias(anchor);
  assert.equal(anchor.listeners.click, click);
  r.releaseAll();
  assert.equal(anchor.attrs["data-plexus-alias"], undefined);
  assert.equal(anchor.listeners.click, undefined);
  assert.equal(anchor.listeners.mouseover, undefined);
  assert.equal(anchor.listeners.mouseenter, undefined);
});

test("REF-3: refreshRegion reclaims aliases of that region; a disconnected anchor is dropped", async () => {
  const { r, anchor } = aliasSetup();
  r.claimAlias(anchor);
  const first = anchor.listeners.click;
  await r.refreshRegion(regionUid, { purge: false });
  assert.equal(anchor.attrs["data-plexus-alias"], "1");
  assert.notEqual(anchor.listeners.click, first);
  anchor.isConnected = false;
  r.refreshAll();
  assert.equal(anchor.attrs["data-plexus-alias"], undefined);
});

test("UX-4: error chips on supported regions drop role, aria-label and tabindex", async () => {
  const mk = (drawing, cold) => {
    const parent = makeEl("p");
    const btn = makeEl("button");
    parent.append(btn);
    const host = { blockUidFromNode: () => regionUid, pullBlock: () => ({ uid: regionUid, string: stringOf("Cap") }), drawing };
    const cache = { peek: () => null, get: async () => null, put: async () => {}, delete: async () => {} };
    const r = createRegionRefRenderer({ host, cache, cold: cold || {}, getSettings: () => ({}), onOpen() {}, doc });
    r.claim(btn);
    return rootOf(parent);
  };
  const missing = mk(() => null);
  assert.match(missing.textContent, /not found/i);
  assert.equal(missing.attrs.role, undefined);
  assert.equal(missing.attrs["aria-label"], undefined);
  assert.equal(missing.attrs.tabindex, undefined);
  const cold = mk(() => ({ uid: "drw000001", elements, hash: "abcd1234" }), { render: async () => { throw new Error("no"); } });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(cold.attrs.role, undefined);
  assert.equal(cold.attrs["aria-label"], undefined);
  assert.equal(cold.attrs.tabindex, undefined);
});

test("REF-3: a retargeted alias opens the current data-link-uid, or passes through when it is no region", () => {
  const other = "reg000002";
  const pull = (u) => ({ uid: u, string: u === "txt000001" ? "plain" : stringOf("Cap") });
  const a = aliasSetup({ pull });
  a.r.claimAlias(a.anchor);
  a.anchor.dataset.linkUid = other;
  a.anchor.listeners.click(clickEv());
  assert.deepEqual(a.calls, [[other, { sidebar: false }]]);
  const b = aliasSetup({ pull });
  b.r.claimAlias(b.anchor);
  b.anchor.dataset.linkUid = "txt000001";
  const ev = clickEv();
  b.anchor.listeners.click(ev);
  assert.equal(ev.prevented, 0);
  assert.equal(b.calls.length, 0);
});
