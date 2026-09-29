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
  const spots = [];
  const app = { getSceneElements: () => over.elements || elements };
  const state = { editor: over.editor === undefined ? { app, drawingUid: "drw000001" } : over.editor };
  const native = {
    activeEditor: () => state.editor,
    selectedElementIds: () => over.ids || ["rect-a", "text-a"],
    captureSelectionSvg: over.capture || (async () => svg),
    zoomTo: (a, box) => zooms.push(box),
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
  });
  return { actions, created, puts, copied, toasts, zooms, spots, state, app };
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

test("image region negatives: no selection match, non-image, multi-select, rotated", async () => {
  const img = { id: "img-a", type: "image", x: 0, y: 0, width: 10, height: 10, angle: 0, isDeleted: false };
  const cases = [
    [{ ids: ["rect-a"] }, "Select exactly one image"],
    [{ ids: ["img-a", "rect-a"], elements: [img, ...elements] }, "Select exactly one image"],
    [{ ids: ["ghost"] }, "Select exactly one image"],
    [{ ids: ["img-a"], elements: [{ ...img, angle: 0.5 }] }, "Rotated images are not supported"],
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

import { detectRegionKind } from "../src/actions.js";

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
