import assert from "node:assert/strict";
import test from "node:test";

import { createActions } from "../src/actions.js";
import { parseRegion, geometryKey, serializeRegion } from "../src/model/region.js";
import { cropKey } from "../src/host/cache.js";

const elements = [
  { id: "rect-a", type: "rectangle", x: 100, y: 100, width: 220, height: 140, angle: 0, isDeleted: false },
  { id: "text-a", type: "text", x: 130, y: 150, width: 160, height: 25, angle: 0, isDeleted: false, text: "Hello" },
];
const svg = '<svg viewBox="0 0 240 160" width="240" height="160"></svg>';

function setup({ editor }) {
  const created = [];
  const puts = [];
  const copied = [];
  const toasts = [];
  const app = { getSceneElements: () => elements };
  const actions = createActions({
    host: {
      createRegion: async (d, string) => { created.push([d, string]); return "reg000001"; },
      drawing: () => ({ hash: "abcd1234" }),
    },
    native: {
      activeEditor: () => (editor ? { app, drawingUid: "drw000001" } : null),
      selectedElementIds: () => ["rect-a", "text-a"],
      captureSelectionSvg: async () => svg,
    },
    cache: { put: async (key, blob, dims) => puts.push([key, blob, dims]) },
    cold: {},
    toaster: { show: (m, o) => toasts.push([m, o]) },
    spotlight: () => {},
    getSettings: () => ({}),
    doc: {},
    clipboard: { writeText: async (t) => copied.push(t) },
  });
  return { actions, created, puts, copied, toasts };
}

test("createAreaRegion writes one region with caption, caches the svg, copies the ref", async () => {
  const { actions, created, puts, copied, toasts } = setup({ editor: true });
  const uid = await actions.createAreaRegion();
  assert.equal(uid, "reg000001");
  assert.equal(created.length, 1);
  assert.equal(created[0][0], "drw000001");
  const region = parseRegion(created[0][1]);
  assert.equal(region.kind, "area");
  assert.deepEqual(region.ids, ["rect-a", "text-a"]);
  assert.equal(region.caption, "Hello");
  assert.equal(puts.length, 1);
  assert.equal(puts[0][0], cropKey({ regionUid: uid, geometryKey: geometryKey(region), drawingHash: "abcd1234", tier: "svg" }));
  assert.deepEqual(puts[0][2], { w: 240, h: 160 });
  assert.deepEqual(copied, ["((reg000001))"]);
  assert.match(toasts.at(-1)[0], /reg000001/);
});

test("createAreaRegion without an editor toasts and returns null", async () => {
  const { actions, created, toasts } = setup({ editor: false });
  assert.equal(await actions.createAreaRegion(), null);
  assert.equal(created.length, 0);
  assert.equal(toasts.length, 1);
});

function make(over = {}) {
  const created = [];
  const puts = [];
  const copied = [];
  const toasts = [];
  const zooms = [];
  const zoomOpts = [];
  const spots = [];
  const app = { getSceneElements: () => over.elements || elements, state: over.state || {} };
  const state = { editor: over.editor === undefined ? { app, drawingUid: "drw000001" } : over.editor };
  const native = {
    activeEditor: () => state.editor,
    selectedElementIds: () => over.ids || ["rect-a", "text-a"],
    captureSelectionSvg: over.capture || (async () => svg),
    zoomTo: (a, box, opts) => { zooms.push(box); zoomOpts.push(opts); },
    viewportRectOf: () => ({ x: 1 }),
    ...(over.native || {}),
  };
  const actions = createActions({
    host: {
      createRegion: over.createRegion || (async (d, s) => { created.push([d, s]); return "reg000001"; }),
      drawing: () => ({ hash: "abcd1234" }),
      pullBlock: over.pullBlock || (() => null),
      openBlock: over.openBlock || (async () => {}),
      regionsOf: over.regionsOf || (() => []),
    },
    native,
    cache: { put: async (k, b, d) => puts.push([k, b, d]), clear: async () => puts.push("cleared") },
    cold: {},
    toaster: { show: (m, o) => toasts.push([m, o]) },
    spotlight: (o) => { spots.push(o); return () => spots.push("stopped"); },
    getSettings: () => ({}),
    doc: over.doc || { querySelectorAll: () => [] },
    clipboard: over.clipboard || { writeText: async (t) => copied.push(t) },
    refreshRegion: over.refreshRegion,
    startTool: over.startTool,
    loadBitmap: over.loadBitmap,
    chooseKind: over.chooseKind,
  });
  return { actions, created, puts, copied, toasts, zooms, zoomOpts, spots, state, app };
}

test("empty selection toasts and creates nothing", async () => {
  const { actions, created, toasts } = make({ ids: [] });
  assert.equal(await actions.createAreaRegion(), null);
  assert.equal(created.length, 0);
  assert.equal(toasts[0][0], "Select some elements first");
});

test("bad drawing uid or element ids toast and create nothing", async () => {
  for (const over of [{ editor: { app: {}, drawingUid: null } }, { ids: ["bad id!"] }]) {
    const { actions, created, toasts } = make(over);
    assert.equal(await actions.createAreaRegion(), null);
    assert.equal(created.length, 0);
    assert.equal(toasts.at(-1)[0], "Could not identify this drawing");
  }
});

test("createRegion rejection toasts an error and skips cache and clipboard", async () => {
  const { actions, puts, copied, toasts } = make({ createRegion: async () => { throw new Error("nope"); } });
  assert.equal(await actions.createAreaRegion(), null);
  assert.equal(puts.length, 0);
  assert.equal(copied.length, 0);
  assert.equal(toasts.at(-1)[0], "Could not create region, try again");
  assert.equal(toasts.at(-1)[1].kind, "error");
});

test("svg capture failure still creates the region, with no cache put", async () => {
  const { actions, created, puts, copied } = make({ capture: async () => { throw new Error("no svg"); } });
  assert.equal(await actions.createAreaRegion(), "reg000001");
  assert.equal(created.length, 1);
  assert.equal(puts.length, 0);
  assert.deepEqual(copied, ["((reg000001))"]);
});

test("clipboard failure still returns the uid and toasts created", async () => {
  const { actions, toasts } = make({ clipboard: { writeText: async () => { throw new Error("denied"); } } });
  assert.equal(await actions.createAreaRegion(), "reg000001");
  assert.equal(toasts.at(-1)[0], "Region ((reg000001)) created");
});

test("clipboard write goes through native.withClipboard when present", async () => {
  let wrapped = 0;
  const { actions, copied } = make({ native: { withClipboard: async (fn) => { wrapped += 1; return fn(); } } });
  await actions.createAreaRegion();
  assert.equal(wrapped, 1);
  assert.deepEqual(copied, ["((reg000001))"]);
});

test("a second createAreaRegion while one is running is ignored", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { actions, created } = make({ capture: async () => { await gate; return svg; } });
  const first = actions.createAreaRegion();
  assert.equal(await actions.createAreaRegion(), null);
  release();
  assert.equal(await first, "reg000001");
  assert.equal(created.length, 1);
});

test("a rotated drawing image starts the region tool", async () => {
  const img = { id: "img-a", type: "image", x: 0, y: 0, width: 100, height: 40, angle: Math.PI / 2, isDeleted: false };
  let seen = null;
  const { actions, created, toasts } = make({
    ids: ["img-a"],
    elements: [img],
    startTool: (opts) => {
      seen = opts.element;
      return Object.assign(Promise.resolve({ kind: "rect", f: [0.2, 0.2, 0.4, 0.4], altKey: true }), { cancel() {} });
    },
  });
  assert.equal(await actions.createImageRegion(), "reg000001");
  assert.equal(seen.angle, Math.PI / 2);
  assert.equal(parseRegion(created[0][1]).el, "img-a");
  assert.equal(toasts.some((row) => row[0] === "Rotated images are not supported"), false);
});

test("S on a multi-image block stores the next image index", async () => {
  const imgs = [0, 1].map(() => ({
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 80, height: 40 }),
    naturalWidth: 80,
    naturalHeight: 40,
  }));
  const block = { id: "block-input-blk000001", closest: () => null, querySelectorAll: () => imgs };
  let calls = 0;
  const { actions, created, toasts } = make({
    pullBlock: () => ({ string: "![one](https://x/a.png) ![two](https://x/b.png)" }),
    doc: { querySelectorAll: () => [block], defaultView: { getComputedStyle: () => ({}) } },
    loadBitmap: async () => { throw new Error("no bitmap"); },
    startTool: (opts) => {
      calls += 1;
      assert.equal(opts.cycle, true);
      const picked = calls === 1 ? { kind: "cycle" } : { kind: "rect", f: [0.1, 0.2, 0.3, 0.4], altKey: true };
      return Object.assign(Promise.resolve(picked), { cancel() {} });
    },
  });
  assert.equal(await actions.createPlainImageRegion("blk000001"), "reg000001");
  assert.equal(calls, 2);
  const region = parseRegion(created[0][1]);
  assert.equal(region.kind, "imgrect");
  assert.equal(region.i, 1);
  assert.equal(toasts.some((row) => row[0] === "Image 2 of 2"), true);
});

test("image region negatives: no selection match, non-image, multi-select", async () => {
  const img = { id: "img-a", type: "image", x: 0, y: 0, width: 10, height: 10, angle: 0, isDeleted: false };
  const cases = [
    [{ ids: ["rect-a"] }, "Select exactly one image"],
    [{ ids: ["img-a", "rect-a"], elements: [img, ...elements] }, "Select exactly one image"],
    [{ ids: ["ghost"] }, "Select exactly one image"],
    [{ ids: ["img-a"], elements: [img], editor: null }, "Open a drawing full-screen first"],
  ];
  for (const [over, message] of cases) {
    const { actions, created, toasts } = make(over);
    assert.equal(await actions.createImageRegion(), null);
    assert.equal(created.length, 0);
    assert.equal(toasts.at(-1)[0], message);
  }
});

test("openRegion toasts for a missing or unsupported region", async () => {
  const missing = make();
  assert.equal(await missing.actions.openRegion("reg000001"), null);
  assert.equal(missing.toasts.at(-1)[0], "Region cannot be opened");
  const unsupported = make({ pullBlock: () => ({ string: "{{[[plexus-region]]: garbage}}" }) });
  assert.equal(await unsupported.actions.openRegion("reg000001"), null);
  assert.equal(unsupported.toasts.at(-1)[0], "Region cannot be opened");
});

test("openRegion on the open drawing zooms and spotlights", async () => {
  const string = serializeRegion({ kind: "area", drawingUid: "drw000001", ids: ["rect-a"], pad: 10, caption: "x" });
  const { actions, zooms, spots } = make({ pullBlock: () => ({ string }) });
  assert.equal(await actions.openRegion("reg000001"), "drw000001");
  assert.equal(zooms.length, 1);
  assert.deepEqual(spots[0].rect, { x: 1 });
});

test("openRegion caps the zoom at 100%", async () => {
  const string = serializeRegion({ kind: "area", drawingUid: "drw000001", ids: ["rect-a"], pad: 10, caption: "x" });
  const { actions, zoomOpts } = make({ pullBlock: () => ({ string }) });
  await actions.openRegion("reg000001");
  assert.deepEqual(zoomOpts, [{ maxZoom: 1 }]);
});

test("refreshCropsForDrawing on the open drawing re-renders hot without purging", async () => {
  const area = { supported: true, kind: "area", drawingUid: "drw000001", ids: ["rect-a"], pad: 10, caption: "x" };
  const calls = [];
  const { actions, puts } = make({
    regionsOf: () => [{ uid: "reg000001", region: area }, { uid: "reg000002", region: { supported: false } }],
    refreshRegion: async (uid, opts) => { calls.push([uid, opts]); },
  });
  assert.equal(await actions.refreshCropsForDrawing("drw000001"), 1);
  assert.equal(puts.length, 1);
  assert.deepEqual(calls, [["reg000001", { purge: false }]]);
});

test("refreshCropsForDrawing on a closed drawing purges and re-claims each supported region", async () => {
  const area = { supported: true, kind: "area", drawingUid: "drw000009", ids: ["rect-a"], pad: 10, caption: "x" };
  const calls = [];
  const { actions, puts } = make({
    regionsOf: () => [{ uid: "reg000001", region: area }, { uid: "reg000002", region: { supported: false } }],
    refreshRegion: async (uid, opts) => { calls.push([uid, opts]); },
  });
  assert.equal(await actions.refreshCropsForDrawing("drw000009"), 1);
  assert.equal(puts.length, 0);
  assert.deepEqual(calls, [["reg000001", undefined]]);
});

test("refreshCropsForOpenDrawing re-claims refs after a hot refresh", async () => {
  const area = { supported: true, kind: "area", drawingUid: "drw000001", ids: ["rect-a"], pad: 10, caption: "x" };
  const calls = [];
  const { actions } = make({ regionsOf: () => [{ uid: "reg000001", region: area }], refreshRegion: async (uid, opts) => { calls.push([uid, opts]); } });
  assert.equal(await actions.refreshCropsForOpenDrawing(), 1);
  assert.deepEqual(calls, [["reg000001", { purge: false }]]);
});

test("hasSingleImageSelected is true only for exactly one selected image element", () => {
  const els = [{ id: "img-a", type: "image" }, { id: "rect-a", type: "rectangle" }];
  assert.equal(make({ elements: els, ids: ["img-a"] }).actions.hasSingleImageSelected(), true);
  assert.equal(make({ elements: els, ids: ["rect-a"] }).actions.hasSingleImageSelected(), false);
  assert.equal(make({ elements: els, ids: ["img-a", "rect-a"] }).actions.hasSingleImageSelected(), false);
  assert.equal(make({ editor: null, elements: els }).actions.hasSingleImageSelected(), false);
});

test("openRegion reports an unresolvable region instead of zooming", async () => {
  const string = serializeRegion({ kind: "area", drawingUid: "drw000001", ids: ["gone"], pad: 10, caption: "x" });
  const { actions, zooms, toasts } = make({ pullBlock: () => ({ string }) });
  assert.equal(await actions.openRegion("reg000001"), null);
  assert.equal(zooms.length, 0);
  assert.match(toasts.at(-1)[0], /^Region unavailable/);
});

test("openRegion toasts when openBlock fails", async () => {
  const string = serializeRegion({ kind: "area", drawingUid: "drw000001", ids: ["rect-a"], pad: 10, caption: "x" });
  const { actions, toasts } = make({
    pullBlock: () => ({ string }),
    editor: null,
    openBlock: async () => { throw new Error("boom"); },
  });
  assert.equal(await actions.openRegion("reg000001"), null);
  assert.equal(toasts.at(-1)[0], "Could not open drawing");
});

test("openRegion ignores fullscreen icons inside the offscreen renderer", async () => {
  const string = serializeRegion({ kind: "area", drawingUid: "drw000001", ids: ["rect-a"], pad: 10, caption: "x" });
  let searched = 0;
  const icon = { dispatchEvent: () => { throw new Error("clicked offscreen icon"); } };
  const offscreen = {
    id: "block-input-x-drw000001",
    closest: (sel) => (sel === ".plexus-offscreen" ? {} : null),
    querySelector: () => { searched += 1; return icon; },
  };
  const { actions, toasts } = make({
    pullBlock: () => ({ string }),
    editor: null,
    doc: { querySelectorAll: () => [offscreen], defaultView: {} },
  });
  const started = Date.now();
  const result = actions.openRegion("reg000001");
  setTimeout(() => actions.dispose(), 120);
  assert.equal(await result, null);
  assert.equal(searched, 0);
  assert.ok(Date.now() - started < 2000, "dispose aborts the wait");
  assert.equal(toasts.some(([m]) => m === "Could not find the drawing"), false);
});

test("refreshCropsForOpenDrawing counts refreshed regions and skips failures and unsupported ones", async () => {
  const area = { supported: true, kind: "area", drawingUid: "drw000001", ids: ["rect-a"], pad: 10, caption: "x" };
  let n = 0;
  const { actions, puts, toasts } = make({
    regionsOf: () => [
      { uid: "reg000001", region: area },
      { uid: "reg000002", region: { supported: false } },
      { uid: "reg000003", region: area },
    ],
    capture: async () => { n += 1; if (n === 2) throw new Error("x"); return svg; },
  });
  assert.equal(await actions.refreshCropsForOpenDrawing(), 1);
  assert.equal(puts.length, 1);
  assert.equal(toasts.at(-1)[0], "Refreshed 1 crop");
});

test("refresh stops when the active editor changes mid-loop", async () => {
  const area = { supported: true, kind: "area", drawingUid: "drw000001", ids: ["rect-a"], pad: 10, caption: "x" };
  let calls = 0;
  const wrapped = make({
    regionsOf: () => [{ uid: "reg000001", region: area }, { uid: "reg000003", region: area }],
    capture: async () => { calls += 1; wrapped.state.editor = { app: {}, drawingUid: "drw000009" }; return svg; },
  });
  assert.equal(await wrapped.actions.refreshCropsForOpenDrawing(), 1);
  assert.equal(calls, 1);
});

test("clearCache clears and toasts", async () => {
  const { actions, puts, toasts } = make();
  await actions.clearCache();
  assert.deepEqual(puts, ["cleared"]);
  assert.equal(toasts.at(-1)[0], "Crop cache cleared");
});

test("dispose stops the spotlight and halts a refresh loop", async () => {
  const string = serializeRegion({ kind: "area", drawingUid: "drw000001", ids: ["rect-a"], pad: 10, caption: "x" });
  const a = make({ pullBlock: () => ({ string }) });
  await a.actions.openRegion("reg000001");
  a.actions.dispose();
  assert.equal(a.spots.at(-1), "stopped");
  const area = { supported: true, kind: "area", drawingUid: "drw000001", ids: ["rect-a"], pad: 10, caption: "x" };
  const b = make({ regionsOf: () => [{ uid: "reg000001", region: area }] });
  b.actions.dispose();
  assert.equal(await b.actions.refreshCropsForOpenDrawing(), 0);
  assert.equal(b.puts.length, 0);
});

test("F3: cached area svg takes its size from the viewBox, not an exportScale-inflated width/height", async () => {
  const { actions, puts } = make({ capture: async () => '<svg viewBox="0 0 180 120" width="540" height="360"></svg>' });
  await actions.createAreaRegion();
  assert.deepEqual(puts[0][2], { w: 180, h: 120 });
  assert.match(await puts[0][1].text(), /viewBox="0 0 180 120" width="180" height="120"/);
});

test("F3: image-region and refresh svgs are size-normalized after the crop", async () => {
  const big = '<svg viewBox="0 0 120 120" width="360" height="360"></svg>';
  const area = { supported: true, kind: "rect", drawingUid: "drw000001", el: "rect-a", f: [0, 0, 1, 1], caption: "x" };
  const { actions, puts } = make({ regionsOf: () => [{ uid: "reg000001", region: area }], capture: async () => big });
  await actions.refreshCropsForOpenDrawing();
  const text = await puts[0][1].text();
  assert.match(text, /viewBox="10 10 100 100" width="100" height="100"/);
  assert.deepEqual(puts[0][2], { w: 100, h: 100 });
});

function iconDoc({ blocks }) {
  return { defaultView: { MouseEvent: class { constructor(type) { this.type = type; } } }, querySelectorAll: () => blocks() };
}

test("F1: a drawing already in the DOM is clicked without navigating", async () => {
  const string = serializeRegion({ kind: "area", drawingUid: "drw000001", ids: ["rect-a"], pad: 10, caption: "x" });
  const events = [];
  const icon = { isConnected: true, dispatchEvent: (e) => events.push(e.type) };
  const block = { id: "block-input-u-drw000001", closest: () => null, querySelector: () => icon };
  let navigated = 0;
  const a = make({ pullBlock: () => ({ string }), editor: null, openBlock: async () => { navigated += 1; }, doc: iconDoc({ blocks: () => [block] }) });
  const opened = a.actions.openRegion("reg000001");
  setTimeout(() => { a.state.editor = { app: a.app, drawingUid: "drw000001" }; }, 80);
  assert.equal(await opened, "drw000001");
  assert.equal(navigated, 0);
  assert.deepEqual(events, ["mousedown", "mouseup", "click"]);
});

test("F1: navigates only when absent, and never clicks a detached icon (re-queries)", async () => {
  const string = serializeRegion({ kind: "area", drawingUid: "drw000001", ids: ["rect-a"], pad: 10, caption: "x" });
  const stale = { isConnected: false, dispatchEvent: () => { throw new Error("clicked detached icon"); } };
  const clicks = [];
  const live = { isConnected: true, dispatchEvent: (e) => clicks.push(e.type) };
  let current = null;
  const mk = (icon) => ({ id: "block-input-u-drw000001", closest: () => null, querySelector: () => icon });
  const a = make({
    pullBlock: () => ({ string }),
    editor: null,
    openBlock: async () => { current = mk(stale); setTimeout(() => { current = mk(live); }, 100); },
    doc: iconDoc({ blocks: () => (current ? [current] : []) }),
  });
  const opened = a.actions.openRegion("reg000001");
  setTimeout(() => { a.state.editor = { app: a.app, drawingUid: "drw000001" }; }, 300);
  assert.equal(await opened, "drw000001");
  assert.deepEqual(clicks.slice(0, 3), ["mousedown", "mouseup", "click"]);
});

test("F1: re-dispatches when the editor has not mounted within 1500 ms, at most 3 attempts", async () => {
  const string = serializeRegion({ kind: "area", drawingUid: "drw000001", ids: ["rect-a"], pad: 10, caption: "x" });
  let clicks = 0;
  const icon = { isConnected: true, dispatchEvent: (e) => { if (e.type === "click") clicks += 1; } };
  const block = { id: "block-input-u-drw000001", closest: () => null, querySelector: () => icon };
  const a = make({ pullBlock: () => ({ string }), editor: null, doc: iconDoc({ blocks: () => [block] }) });
  const opened = a.actions.openRegion("reg000001");
  setTimeout(() => { a.state.editor = { app: a.app, drawingUid: "drw000001" }; }, 1700);
  assert.equal(await opened, "drw000001");
  assert.equal(clicks, 2);
});

import { chooseRegionKind, detectRegionKind, regionKindCandidates } from "../src/actions.js";

test("detectRegionKind: cframe, group and area", () => {
  const frame = { id: "f", type: "frame" };
  const a = { id: "a", type: "rectangle", frameId: "f" };
  const b = { id: "b", type: "rectangle", frameId: "f" };
  const out = { id: "o", type: "rectangle" };
  const all = [frame, a, b, out];
  const c = detectRegionKind({ elements: all, ids: ["f"], selectedGroupIds: {} });
  assert.equal(c.kind, "cframe");
  assert.deepEqual(c.children.map((e) => e.id), ["a", "b"]);
  assert.equal(detectRegionKind({ elements: all, ids: ["f", "a"], selectedGroupIds: {} }).kind, "cframe");
  assert.equal(detectRegionKind({ elements: all, ids: ["f", "o"], selectedGroupIds: {} }).kind, "area");
  const g1 = { id: "g1", type: "rectangle", groupIds: ["G"] };
  const g2 = { id: "g2", type: "ellipse", groupIds: ["G"] };
  const grp = detectRegionKind({ elements: [g1, g2, out], ids: ["g1", "g2"], selectedGroupIds: { G: true } });
  assert.equal(grp.kind, "group");
  assert.equal(grp.groupId, "G");
  assert.equal(detectRegionKind({ elements: [g1, g2, out], ids: ["g1"], selectedGroupIds: { G: true } }).kind, "area");
  assert.equal(detectRegionKind({ elements: all, ids: ["a"], selectedGroupIds: {} }).kind, "area");
});

test("regionKindCandidates: frame or group plus an outsider, and exact or partial matches", () => {
  const frame = { id: "f", type: "frame" };
  const a = { id: "a", type: "rectangle", frameId: "f" };
  const out = { id: "o", type: "rectangle" };
  const mixed = regionKindCandidates({ elements: [frame, a, out], ids: ["f", "a", "o"], selectedGroupIds: {} });
  assert.deepEqual(mixed.map((c) => c.kind), ["cframe", "area"]);
  assert.deepEqual(mixed[0].children.map((e) => e.id), ["a"]);
  assert.deepEqual(mixed[1].ids, ["o"]);
  const exactFrame = regionKindCandidates({ elements: [frame, a, out], ids: ["f", "a"], selectedGroupIds: {} });
  assert.equal(exactFrame.length, 1);
  assert.equal(exactFrame[0].kind, "cframe");
  const g1 = { id: "g1", type: "rectangle", groupIds: ["G"] };
  const g2 = { id: "g2", type: "ellipse", groupIds: ["G"] };
  const exactGroup = regionKindCandidates({ elements: [g1, g2, out], ids: ["g1", "g2"], selectedGroupIds: { G: true } });
  assert.equal(exactGroup.length, 1);
  assert.equal(exactGroup[0].kind, "group");
  assert.equal(exactGroup[0].groupId, "G");
  assert.deepEqual(exactGroup[0].members.map((e) => e.id), ["g1", "g2"]);
  const partial = regionKindCandidates({ elements: [g1, g2, out], ids: ["g1"], selectedGroupIds: { G: true } });
  assert.equal(partial.length, 1);
  assert.equal(partial[0].kind, "area");
  assert.deepEqual(partial[0].ids, ["g1"]);
  const withOutsider = regionKindCandidates({ elements: [g1, g2, out], ids: ["g1", "g2", "o"], selectedGroupIds: { G: true } });
  assert.deepEqual(withOutsider.map((c) => c.kind), ["group", "area"]);
  assert.deepEqual(withOutsider[1].ids, ["o"]);
});

const MIXED_FRAME = [
  { id: "f", type: "frame", name: "Frame one", x: 0, y: 0, width: 30, height: 20 },
  { id: "a", type: "rectangle", frameId: "f", x: 0, y: 0, width: 10, height: 10 },
  { id: "o", type: "rectangle", x: 40, y: 0, width: 10, height: 10 },
];

test("createAreaRegion on a frame plus an outsider cancels when chooseKind returns null", async () => {
  const { actions, created } = make({ elements: MIXED_FRAME, ids: ["f", "o"], chooseKind: async () => null });
  assert.equal(await actions.createAreaRegion(), null);
  assert.equal(created.length, 0);
});

test("createAreaRegion keeps only the outsider when the area candidate is chosen", async () => {
  const { actions, created } = make({
    elements: MIXED_FRAME,
    ids: ["f", "o"],
    chooseKind: async (_doc, candidates) => candidates.find((c) => c.kind === "area"),
  });
  await actions.createAreaRegion();
  const region = parseRegion(created[0][1]);
  assert.equal(region.kind, "area");
  assert.deepEqual(region.ids, ["o"]);
});

test("createAreaRegion writes a padless cframe when the frame candidate is chosen", async () => {
  const { actions, created } = make({
    elements: MIXED_FRAME,
    ids: ["f", "o"],
    chooseKind: async (_doc, candidates) => candidates.find((c) => c.kind === "cframe"),
  });
  await actions.createAreaRegion();
  const region = parseRegion(created[0][1]);
  assert.equal(region.kind, "cframe");
  assert.ok(!region.pad);
});

function chooserDoc() {
  const buttons = [];
  let box = null;
  let keydown = null;
  const doc = {
    body: { append(node) { box = node; } },
    createElement(tag) {
      const node = {
        className: "",
        textContent: "",
        attrs: {},
        setAttribute(name, value) { this.attrs[name] = value; },
        appendChild(child) { return child; },
        addEventListener(type, fn) { if (type === "click") this.onclick = fn; },
        remove() { this.removed = true; },
      };
      if (tag === "button") buttons.push(node);
      return node;
    },
    addEventListener(type, fn, capture) { if (type === "keydown") keydown = { fn, capture }; },
    removeEventListener() {},
  };
  return { doc, buttons, box: () => box, keydown: () => keydown };
}

test("chooseRegionKind resolves the clicked candidate and Escape resolves null", async () => {
  const cframe = { kind: "cframe", frame: { id: "f" }, children: [] };
  const group = { kind: "group", groupId: "G", members: [] };
  const area = { kind: "area", ids: ["o"] };
  const ui = chooserDoc();
  const pending = chooseRegionKind(ui.doc, [cframe, group, area]);
  assert.equal(ui.box().className, "plexus-kind-chooser");
  assert.equal(ui.box().attrs.role, "dialog");
  assert.deepEqual(ui.buttons.map((b) => b.textContent), ["Frame", "Group", "Loose shapes"]);
  ui.buttons[2].onclick();
  assert.equal(await pending, area);
  assert.equal(ui.box().removed, true);

  const ui2 = chooserDoc();
  const pending2 = chooseRegionKind(ui2.doc, [cframe, area]);
  const event = { key: "Escape", preventDefault() { this.prevented = true; } };
  assert.equal(ui2.keydown().capture, true);
  ui2.keydown().fn(event);
  assert.equal(event.prevented, true);
  assert.equal(await pending2, null);
  assert.equal(ui2.box().removed, true);
  ui2.buttons[0].onclick();
  assert.equal(await pending2, null);
});


// ---- ref captions and relink ----
const MM_ELS = [
  { id: "pmm-A-h6dynpr9M", type: "rectangle", customData: { plexus: { mm: { uid: "h6dynpr9M" } } } },
  { id: "pmm-A-h6dynpr9M-t", type: "text", text: "Child two", containerId: "pmm-A-h6dynpr9M" },
];

test("createAreaRegion uses the source ref as caption", async () => {
  const { actions, created } = make({ elements: MM_ELS, ids: ["pmm-A-h6dynpr9M"] });
  await actions.createAreaRegion();
  assert.equal(created[0][1], "{{[[plexus-region]]: k=area d=drw000001 ids=pmm-A-h6dynpr9M pad=10}} ((h6dynpr9M))");
});

function relinkActions(string, elements = MM_ELS, over = {}) {
  const writes = [];
  const toasts = [];
  const emitted = [];
  const actions = createActions({
    host: {
      pullBlock: () => ({ string }),
      drawing: () => ({ elements, hash: "h" }),
      updateRegionString: over.update || (async (d, uid, s) => { writes.push([d, uid, s]); }),
    },
    native: {}, cache: {}, cold: {}, toaster: { show: (m, o) => toasts.push([m, o]) }, spotlight() {}, getSettings: () => ({}),
    doc: {}, clipboard: {}, emit: (e) => emitted.push(e),
  });
  return { actions, writes, toasts, emitted };
}

test("relinkRegionCaption rewrites only the caption and is a no-op afterwards", async () => {
  const before = "{{[[plexus-region]]: k=area d=drw000001 ids=pmm-A-h6dynpr9M pad=10}} Child two";
  const a = relinkActions(before);
  assert.equal(a.actions.regionCaptionCandidate("reg000001"), "((h6dynpr9M))");
  const out = await a.actions.relinkRegionCaption("reg000001");
  assert.deepEqual(out, { changed: true, caption: "((h6dynpr9M))" });
  assert.deepEqual(a.writes, [["drw000001", "reg000001", "{{[[plexus-region]]: k=area d=drw000001 ids=pmm-A-h6dynpr9M pad=10}} ((h6dynpr9M))"]]);
  assert.equal(a.toasts.at(-1)[0], "Caption linked");

  const after = "{{[[plexus-region]]: k=area d=drw000001 ids=pmm-A-h6dynpr9M pad=10}} ((h6dynpr9M))";
  const b = relinkActions(after);
  assert.equal(b.actions.regionCaptionCandidate("reg000001"), null);
  assert.deepEqual(await b.actions.relinkRegionCaption("reg000001"), { changed: false, caption: "((h6dynpr9M))" });
  assert.equal(b.writes.length, 0);
  assert.equal(b.toasts.at(-1)[0], "Caption already linked");
});

test("relink skips image kinds, missing drawings and refless regions; write failure toasts", async () => {
  const img = relinkActions("{{[[plexus-region]]: k=imgrect d=drw000001 i=0 f=0,0,1,1}} x");
  assert.equal(img.actions.regionCaptionCandidate("reg000001"), null);
  const plain = relinkActions("{{[[plexus-region]]: k=area d=drw000001 ids=t1 pad=10}} Hello", [{ id: "t1", type: "text", text: "Hello" }]);
  assert.equal(plain.actions.regionCaptionCandidate("reg000001"), null);
  assert.equal((await plain.actions.relinkRegionCaption("reg000001")).changed, false);
  const fail = relinkActions("{{[[plexus-region]]: k=area d=drw000001 ids=pmm-A-h6dynpr9M pad=10}} Child two", MM_ELS, { update: async () => { throw new Error("x"); } });
  const warn = console.warn; console.warn = () => {};
  try { assert.equal((await fail.actions.relinkRegionCaption("reg000001")).changed, false); } finally { console.warn = warn; }
  assert.equal(fail.toasts.at(-1)[1].kind, "error");
});

test("relink uses children for frames and members for groups", async () => {
  const els = [{ id: "f1", type: "frame" }, { ...MM_ELS[0], frameId: "f1" }, { ...MM_ELS[1], frameId: "f1" }, { id: "g1", type: "rectangle", groupIds: ["grp1"], link: "((linkUid01))" }];
  const fr = relinkActions("{{[[plexus-region]]: k=cframe d=drw000001 fr=f1}} old", els);
  assert.equal(fr.actions.regionCaptionCandidate("reg000001"), "((h6dynpr9M))");
  const gr = relinkActions("{{[[plexus-region]]: k=group d=drw000001 g=grp1 pad=10}} old", els);
  assert.equal(gr.actions.regionCaptionCandidate("reg000001"), "((linkUid01))");
});
