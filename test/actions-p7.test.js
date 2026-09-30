import assert from "node:assert/strict";
import test from "node:test";

import { createActions, headPreservingString, pinFraction } from "../src/actions.js";
import { parseRegion, serializeRegion, geometryKey } from "../src/model/region.js";
import { cropKey } from "../src/host/cache.js";
import { fnv1a } from "../src/model/hash.js";

const svg = '<svg viewBox="0 0 240 160" width="240" height="160"><g/></svg>';
const AREA = "{{[[plexus-region]]: k=area d=drw000001 ids=rect-a pad=10}}";
const baseElements = [
  { id: "rect-a", type: "rectangle", x: 100, y: 100, width: 220, height: 140, angle: 0, isDeleted: false },
  { id: "text-a", type: "text", x: 130, y: 150, width: 160, height: 25, angle: 0, isDeleted: false, text: "Hello" },
];
const img = { id: "img-a", type: "image", x: 0, y: 0, width: 200, height: 100, angle: 0, isDeleted: false };
const tool = (value) => () => Object.assign(Promise.resolve(value), { cancel() {} });
const png = () => new Blob(["png"], { type: "image/png" });

function blocksOf(map) {
  return (uid) => (uid in map ? { uid, string: map[uid], children: [] } : null);
}

function fakeDoc(extra = {}) {
  const made = [];
  const body = { children: [], append(x) { this.children.push(x); } };
  return {
    made,
    body,
    querySelectorAll: () => [],
    createElement: (tag) => {
      const n = { tag, style: {}, clicked: 0, click() { this.clicked += 1; }, remove() { this.removed = true; }, width: 0, height: 0, getContext: () => ({ drawImage() {} }), toBlob: (cb) => cb(png()) };
      made.push(n);
      return n;
    },
    ...extra,
  };
}

function build(over = {}) {
  const created = [];
  const puts = [];
  const toasts = [];
  const copied = [];
  const captured = [];
  const updates = [];
  const refreshes = [];
  const emitted = [];
  const blocks = over.blocks || {};
  const elements = over.elements || baseElements;
  const app = { getSceneElements: () => elements, state: {} };
  const editor = over.editor === undefined ? { app, drawingUid: "drw000001" } : over.editor;
  const cache = over.cache || { put: async (k, b, d) => puts.push([k, b, d]), clear: async () => {} };
  const actions = createActions({
    host: {
      createRegion: async (d, s) => { created.push([d, s]); return "reg000001"; },
      drawing: over.drawing || (() => ({ hash: "abcd1234", elements, appState: {} })),
      pullBlock: over.pullBlock || blocksOf(blocks),
      openBlock: async () => {},
      regionsOf: over.regionsOf || (() => []),
      updateRegionString: over.updateRegionString || (async (d, u, s) => { updates.push([d, u, s]); blocks[u] = s; }),
      allRegionBlocks: over.allRegionBlocks,
      graphName: () => "g",
      isEncrypted: () => !!over.encrypted,
      labelSource: over.labelSource,
    },
    native: {
      activeEditor: () => editor,
      selectedElementIds: () => over.ids || ["rect-a", "text-a"],
      captureSelectionSvg: async (a, ids) => { captured.push(ids); return svg; },
      clipboardBusy: over.busy,
      viewportRectOf: () => ({ left: 5, top: 6, width: 7, height: 8 }),
      ...(over.native || {}),
    },
    cache,
    cold: over.cold || {},
    toaster: { show: (m, o) => toasts.push([m, o]) },
    spotlight: () => {},
    getSettings: () => over.settings || {},
    doc: over.doc || fakeDoc(),
    clipboard: over.clipboard || { writeText: async (t) => copied.push(t), write: async (items) => { copied.push(items); } },
    emit: (e) => emitted.push(e),
    refreshRegion: async (uid, opts) => { refreshes.push([uid, opts]); },
    startTool: over.startTool,
    openPrompt: over.openPrompt,
    confirm: over.confirm,
    createCleanup: over.createCleanup,
    ClipboardItemCtor: over.ClipboardItemCtor,
    rasterize: over.rasterize,
    urls: over.urls,
    upload: over.upload,
    fetchBlob: over.fetchBlob,
    loadBitmap: over.loadBitmap,
    api: over.api,
    closePollMs: 5,
    closeWindowMs: over.closeWindowMs ?? 60,
    revokeDelayMs: 0,
  });
  return { actions, created, puts, toasts, copied, captured, updates, refreshes, emitted, blocks, editor };
}

// ---- REF-1 fallbacks and caption modes ----

test("creator fallbacks are empty, and a frame keeps its own name", async () => {
  const scene = [
    { id: "f", type: "frame", name: "Prep", isDeleted: false },
    { id: "g", type: "frame", name: "", isDeleted: false },
    { id: "a", type: "rectangle", x: 0, y: 0, width: 10, height: 10, frameId: "f", groupIds: ["G"], isDeleted: false },
    { id: "b", type: "rectangle", x: 0, y: 0, width: 10, height: 10, groupIds: ["H"], isDeleted: false },
  ];
  const named = build({ elements: scene, ids: ["f"], editor: { app: { getSceneElements: () => scene, state: {} }, drawingUid: "drw000001" } });
  await named.actions.createFrameRegion();
  assert.equal(parseRegion(named.created[0][1]).caption, "Prep");
  const bare = build({ elements: scene, ids: ["g"], editor: { app: { getSceneElements: () => scene, state: {} }, drawingUid: "drw000001" } });
  await bare.actions.createFrameRegion();
  assert.equal(parseRegion(bare.created[0][1]).caption, "");
  const area = build({ elements: scene, ids: ["b"], editor: { app: { getSceneElements: () => scene, state: {} }, drawingUid: "drw000001" } });
  await area.actions.createAreaRegion();
  assert.equal(parseRegion(area.created[0][1]).caption, "");
});

const refScene = [
  { id: "n1", type: "rectangle", x: 0, y: 0, width: 50, height: 20, isDeleted: false, customData: { plexus: { mm: { uid: "src000001" } } } },
  { id: "t1", type: "text", x: 0, y: 30, width: 50, height: 20, text: "Site twelve", isDeleted: false },
];
const refEditor = { app: { getSceneElements: () => refScene, state: {} }, drawingUid: "drw000001" };

test("caption-mode none keeps only source refs, auto keeps refs and words", async () => {
  const none = build({ elements: refScene, ids: ["n1", "t1"], editor: refEditor, settings: { captionMode: "none" } });
  await none.actions.createAreaRegion();
  assert.equal(parseRegion(none.created[0][1]).caption, "((src000001))");
  const auto = build({ elements: refScene, ids: ["n1", "t1"], editor: refEditor, settings: { captionMode: "auto" } });
  await auto.actions.createAreaRegion();
  assert.equal(parseRegion(auto.created[0][1]).caption, "((src000001)) · Site twelve");
});

test("caption-mode ask prompts with the auto text selected, before the capture, and writes the answer", async () => {
  const calls = [];
  let order = [];
  const t = build({
    elements: refScene,
    ids: ["n1", "t1"],
    editor: refEditor,
    settings: { captionMode: "ask" },
    openPrompt: (o) => { calls.push(o); order.push("prompt"); return Object.assign(Promise.resolve("Typed"), { cancel() {} }); },
    native: { captureSelectionSvg: async () => { order.push("capture"); return svg; } },
  });
  await t.actions.createAreaRegion();
  assert.equal(calls[0].initial, "((src000001)) · Site twelve");
  assert.equal(calls[0].select, true);
  assert.equal(calls[0].escape, "empty");
  assert.deepEqual(order, ["prompt", "capture"]);
  assert.equal(parseRegion(t.created[0][1]).caption, "Typed");
});

test("ask mode anchors the prompt to the selection's viewport rect, not the editor", async () => {
  const calls = [];
  const boxes = [];
  const t = build({
    elements: refScene,
    ids: ["n1", "t1"],
    editor: refEditor,
    settings: { captionMode: "ask" },
    openPrompt: (o) => { calls.push(o); return Object.assign(Promise.resolve("T"), { cancel() {} }); },
    native: { viewportRectOf: (app, bbox) => { boxes.push(bbox); return { left: 1, top: 2, width: 3, height: 4 }; } },
  });
  await t.actions.createAreaRegion();
  assert.deepEqual(calls[0].rect, { left: 1, top: 2, width: 3, height: 4 });
  assert.deepEqual(boxes[0], [0, 0, 50, 50]);
  const throwing = build({ elements: refScene, ids: ["n1"], editor: refEditor, settings: { captionMode: "ask" }, openPrompt: (o) => { calls.push(o); return Object.assign(Promise.resolve("T"), { cancel() {} }); }, native: { viewportRectOf: () => { throw new Error("x"); } } });
  await throwing.actions.createAreaRegion();
  assert.equal(calls.at(-1).rect, null);
});

test("a cancelled ask prompt creates nothing; cancelDrawingTool cancels an open prompt", async () => {
  const t = build({ settings: { captionMode: "ask" }, openPrompt: () => Object.assign(Promise.resolve(null), { cancel() {} }) });
  assert.equal(await t.actions.createAreaRegion(), null);
  assert.equal(t.created.length, 0);
  let cancelled = 0;
  let release;
  const held = new Promise((r) => { release = r; });
  const u = build({ settings: { captionMode: "ask" }, openPrompt: () => Object.assign(held, { cancel() { cancelled++; release(null); } }) });
  const run = u.actions.createAreaRegion();
  await new Promise((r) => setTimeout(r, 5));
  u.actions.cancelDrawingTool();
  assert.equal(await run, null);
  assert.equal(cancelled, 1);
  assert.equal(u.created.length, 0);
});

test("dispose cancels an open prompt with no write", async () => {
  let cancelled = 0;
  let release;
  const held = new Promise((r) => { release = r; });
  const t = build({ settings: { captionMode: "ask" }, openPrompt: () => Object.assign(held, { cancel() { cancelled++; release(null); } }) });
  const run = t.actions.createAreaRegion();
  await new Promise((r) => setTimeout(r, 5));
  t.actions.dispose();
  assert.equal(await run, null);
  assert.equal(cancelled, 1);
});

test("image regions write an empty caption in auto and none modes", async () => {
  const editor = { app: { getSceneElements: () => [img], state: {} }, drawingUid: "drw000001" };
  for (const captionMode of ["auto", "none"]) {
    const t = build({ elements: [img], ids: ["img-a"], editor, settings: { captionMode }, startTool: tool({ kind: "rect", f: [0.1, 0.1, 0.3, 0.3], altKey: false }) });
    await t.actions.createImageRegion();
    const region = parseRegion(t.created[0][1]);
    assert.equal(region.kind, "rect");
    assert.equal(region.caption, "");
  }
});

// ---- REF-2 whole image ----

const imgEditor = { app: { getSceneElements: () => [img], state: {} }, drawingUid: "drw000001" };

test("a whole drawing image makes an area region of that element", async () => {
  const t = build({ elements: [img], ids: ["img-a"], editor: imgEditor, startTool: tool({ kind: "rect", f: [0, 0, 1, 1], altKey: false }) });
  await t.actions.createImageRegion();
  const region = parseRegion(t.created[0][1]);
  assert.equal(region.kind, "area");
  assert.deepEqual(region.ids, ["img-a"]);
  assert.equal(region.pad, 0);
  assert.deepEqual(t.captured[0], ["img-a"]);
});

test("Alt forces a rect region even over the whole drawing image", async () => {
  const t = build({ elements: [img], ids: ["img-a"], editor: imgEditor, startTool: tool({ kind: "rect", f: [0, 0, 1, 1], altKey: true }) });
  await t.actions.createImageRegion();
  assert.equal(parseRegion(t.created[0][1]).kind, "rect");
});

const plainDoc = () => {
  const image = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 100 }), naturalWidth: 400, naturalHeight: 200 };
  return fakeDoc({ querySelectorAll: () => [{ id: "block-input-x-blk000001", closest: () => null, querySelectorAll: () => [image] }] });
};
const plainBlock = { blk000001: "![alt text](https://x/y.png)" };

test("a whole plain image makes no region, copies the block ref and toasts", async () => {
  const copied = [];
  const t = build({
    doc: plainDoc(),
    blocks: plainBlock,
    clipboard: { writeText: async (x) => copied.push(x) },
    startTool: tool({ kind: "rect", f: [0, 0, 0.99, 1], altKey: false }),
  });
  assert.equal(await t.actions.createPlainImageRegion("blk000001"), null);
  assert.equal(t.created.length, 0);
  assert.deepEqual(copied, ["((blk000001))"]);
  assert.match(t.toasts.at(-1)[0], /^Whole image: copied the image block ref\. Hold Alt/);
});

test("Alt over a whole plain image creates an imgrect with an empty caption", async () => {
  const t = build({
    doc: plainDoc(),
    blocks: plainBlock,
    loadBitmap: async () => ({ width: 400, height: 200 }),
    startTool: tool({ kind: "rect", f: [0, 0, 1, 1], altKey: true }),
  });
  assert.equal(await t.actions.createPlainImageRegion("blk000001"), "reg000001");
  const region = parseRegion(t.created[0][1]);
  assert.equal(region.kind, "imgrect");
  assert.equal(region.caption, "");
});

// ---- REF-17 pins ----

test("pinFraction is a square of pct of the shorter side, shifted inside the image", () => {
  const mid = pinFraction({ x: 0.5, y: 0.5, width: 200, height: 100, pct: 8 });
  assert.deepEqual(mid.map((v) => Math.round(v * 1e6) / 1e6), [0.48, 0.46, 0.04, 0.08]);
  const corner = pinFraction({ x: 0, y: 1, width: 200, height: 100, pct: 12 });
  assert.equal(corner[0], 0);
  assert.equal(Math.round((corner[1] + corner[3]) * 1e6) / 1e6, 1);
  assert.equal(Math.round(corner[2] * 200 * 1e6) / 1e6, Math.round(corner[3] * 100 * 1e6) / 1e6);
});

test("a pin on a drawing image always prompts, then writes a rect region", async () => {
  const calls = [];
  const t = build({
    elements: [img],
    ids: ["img-a"],
    editor: imgEditor,
    settings: { captionMode: "none", pinSize: 8 },
    startTool: tool({ kind: "pin", x: 0.5, y: 0.5 }),
    openPrompt: (o) => { calls.push(o); return Object.assign(Promise.resolve("Site 4"), { cancel() {} }); },
  });
  await t.actions.createImageRegion();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].initial, "");
  assert.equal(calls[0].select, false);
  assert.equal(calls[0].escape, "empty");
  const region = parseRegion(t.created[0][1]);
  assert.equal(region.kind, "rect");
  assert.equal(region.caption, "Site 4");
  assert.deepEqual(region.f.map((v) => Math.round(v * 100) / 100), [0.48, 0.46, 0.04, 0.08]);
});

test("number-pins pre-fills 1 + the largest leading integer among the same image's regions", async () => {
  const calls = [];
  const others = [
    { uid: "r1", region: { supported: true, kind: "rect", el: "img-a", caption: "3 north wall" } },
    { uid: "r2", region: { supported: true, kind: "rect", el: "img-a", caption: "7" } },
    { uid: "r3", region: { supported: true, kind: "rect", el: "other", caption: "40" } },
    { uid: "r4", region: { supported: true, kind: "imgrect", i: 0, caption: "50" } },
  ];
  const t = build({
    elements: [img],
    ids: ["img-a"],
    editor: imgEditor,
    settings: { numberPins: true },
    regionsOf: () => others,
    startTool: tool({ kind: "pin", x: 0.2, y: 0.2 }),
    openPrompt: (o) => { calls.push(o); return Object.assign(Promise.resolve(o.initial), { cancel() {} }); },
  });
  await t.actions.createImageRegion();
  assert.equal(calls[0].initial, "8");
  assert.equal(parseRegion(t.created[0][1]).caption, "8");
});

test("a cancelled pin prompt creates nothing", async () => {
  const t = build({
    elements: [img],
    ids: ["img-a"],
    editor: imgEditor,
    startTool: tool({ kind: "pin", x: 0.5, y: 0.5 }),
    openPrompt: () => Object.assign(Promise.resolve(null), { cancel() {} }),
  });
  assert.equal(await t.actions.createImageRegion(), null);
  assert.equal(t.created.length, 0);
});

test("createPinRegion on an image block writes an imgrect pin of the configured size", async () => {
  const t = build({
    doc: plainDoc(),
    blocks: plainBlock,
    settings: { pinSize: 12 },
    loadBitmap: async () => ({ width: 400, height: 200 }),
    openPrompt: () => Object.assign(Promise.resolve("A"), { cancel() {} }),
  });
  assert.equal(await t.actions.createPinRegion({ blockUid: "blk000001", point: { x: 0.5, y: 0.5 } }), "reg000001");
  const region = parseRegion(t.created[0][1]);
  assert.equal(region.kind, "imgrect");
  assert.equal(region.caption, "A");
  assert.equal(Math.round(region.f[2] * 200), Math.round(region.f[3] * 100));
  assert.equal(Math.round(region.f[3] * 100 * 100) / 100, 12);
});

// ---- nameRegion ----

test("nameRegion keeps a non-canonical head byte for byte", async () => {
  const head = "{{[[plexus-region]]: pad=10 ids=rect-a d=drw000001 k=area future=1}}";
  const t = build({ blocks: { reg000001: `${head} Old name` } });
  assert.equal(await t.actions.nameRegion("reg000001", "  New   name "), true);
  assert.equal(t.updates[0][2], `${head} New name`);
  assert.deepEqual(t.updates[0].slice(0, 2), ["drw000001", "reg000001"]);
  assert.deepEqual(t.refreshes, [["reg000001", { purge: false }]]);
  assert.equal(t.emitted[0].uid, "reg000001");
});

test("nameRegion with an empty name writes the bare head; an unchanged name writes nothing", async () => {
  const t = build({ blocks: { reg000001: `${AREA} Old` } });
  await t.actions.nameRegion("reg000001", "");
  assert.equal(t.updates[0][2], AREA);
  assert.equal(await t.actions.nameRegion("reg000001", ""), false);
  assert.equal(t.updates.length, 1);
});

test("nameRegion refuses unsupported and missing regions", async () => {
  const t = build({ blocks: { reg000001: "{{[[plexus-region]]: k=weird d=drw000001}} x" } });
  assert.equal(await t.actions.nameRegion("reg000001", "y"), false);
  assert.equal(await t.actions.nameRegion("nope00001", "y"), false);
  assert.equal(t.updates.length, 0);
});

test("headPreservingString rejects a caption that would not round-trip", () => {
  assert.equal(headPreservingString("not a region", "x"), null);
  assert.equal(headPreservingString(`${AREA} a`, "b"), `${AREA} b`);
});

// ---- cleanup ----

const cleanupScene = [
  { id: "fr1", type: "frame", name: "", isDeleted: false },
  { id: "fr2", type: "frame", name: "Region", isDeleted: false },
  { id: "rect-a", type: "rectangle", x: 0, y: 0, width: 10, height: 10, isDeleted: false },
  { id: "words", type: "text", x: 0, y: 0, width: 10, height: 10, text: "Region", isDeleted: false },
];

function cleanupWorld(extra = {}) {
  const strings = {
    ok0000001: "{{[[plexus-region]]: k=area d=drw000001 ids=rect-a pad=10}} Region",
    ok0000002: "{{[[plexus-region]]: k=imgrect d=blk000001 i=0 f=0.1,0.1,0.2,0.2}} Image region",
    ok0000003: "{{[[plexus-region]]: k=rect d=drw000001 el=img-a f=0.1,0.1,0.2,0.2}} Image crop",
    ok0000004: "{{[[plexus-region]]: k=cframe fr=fr1 d=drw000001}} Frame",
    real00001: "{{[[plexus-region]]: k=area d=drw000001 ids=words pad=10}} Region",
    named0001: "{{[[plexus-region]]: k=cframe fr=fr2 d=drw000001}} Region",
    gone00001: "{{[[plexus-region]]: k=cframe fr=missing d=drw000001}} Frame",
    kept00001: "{{[[plexus-region]]: k=area d=drw000001 ids=rect-a pad=10}} North wall",
    bad000001: "{{[[plexus-region]]: k=weird d=drw000001}} Region",
  };
  const rows = Object.entries(strings).map(([uid, string]) => ({ uid, string, containerUid: "cont00001" }));
  return build({ elements: cleanupScene, blocks: { ...strings }, allRegionBlocks: () => rows, createCleanup: () => ({ show() {}, close() {}, dispose() {} }), ...extra });
}

test("dry run lists exact placeholders and skips real text, real names and missing frames with reasons", async () => {
  const shown = [];
  const t = cleanupWorld({ createCleanup: () => ({ show: (x) => shown.push(x), close() {}, dispose() {} }) });
  const report = await t.actions.captionCleanupDryRun();
  assert.deepEqual(report.candidates.map((c) => c.uid).sort(), ["ok0000001", "ok0000002", "ok0000003", "ok0000004"]);
  const reasons = Object.fromEntries(report.skipped.map((s) => [s.uid, s.reason]));
  assert.match(reasons.real00001, /reads the same/);
  assert.match(reasons.named0001, /is named "Region"/);
  assert.match(reasons.gone00001, /frame missing/);
  assert.equal(report.candidates[0].before.endsWith("Region"), true);
  assert.equal(report.candidates.find((c) => c.uid === "ok0000001").after, "{{[[plexus-region]]: k=area d=drw000001 ids=rect-a pad=10}}");
  assert.equal(t.updates.length, 0);
  assert.equal(shown.length, 1);
});

test("apply writes only unchanged blocks, stops at the first failure, and undo restores exact matches", async () => {
  const t = cleanupWorld();
  const report = await t.actions.captionCleanupDryRun();
  t.blocks.ok0000002 = `${t.blocks.ok0000002} edited`;
  const result = await t.actions.applyCaptionCleanup(report);
  assert.deepEqual(result.changed.map((c) => c.uid).sort(), ["ok0000001", "ok0000003", "ok0000004"]);
  assert.deepEqual(result.skipped.map((s) => s.uid), ["ok0000002"]);
  assert.equal(result.failed.length, 0);
  assert.equal(t.blocks.ok0000001, "{{[[plexus-region]]: k=area d=drw000001 ids=rect-a pad=10}}");
  assert.equal(t.emitted.length, 3);
  t.blocks.ok0000003 = `${t.blocks.ok0000003} more`;
  const undone = await t.actions.undoCaptionCleanup();
  assert.deepEqual(undone.restored.sort(), ["ok0000001", "ok0000004"]);
  assert.deepEqual(undone.skipped.map((s) => s.uid), ["ok0000003"]);
  assert.equal(t.blocks.ok0000001.endsWith("Region"), true);
  assert.equal(await t.actions.undoCaptionCleanup(), null);
  assert.equal(t.toasts.at(-1)[0], "Nothing to undo");
});

test("apply stops at the first write failure", async () => {
  let n = 0;
  const t = cleanupWorld({ updateRegionString: async () => { if (++n === 2) throw new Error("locked"); } });
  const report = await t.actions.captionCleanupDryRun();
  const result = await t.actions.applyCaptionCleanup(report);
  assert.equal(result.changed.length, 1);
  assert.equal(result.failed.length, 1);
  assert.equal(result.skipped.length, 2);
  assert.equal(n, 2);
});

test("the dialog's Apply asks for confirmation naming the graph and the count", async () => {
  let dialogOpts;
  const asked = [];
  const t = cleanupWorld({
    createCleanup: (o) => { dialogOpts = o; return { show() {}, close() {}, dispose() {} }; },
    confirm: (m) => { asked.push(m); return false; },
  });
  const report = await t.actions.captionCleanupDryRun();
  await dialogOpts.onApply(report);
  assert.match(asked[0], /Clear 4 placeholder captions in graph "g"/);
  assert.equal(t.updates.length, 0);
});

// ---- relink gate ----

test("relink is not offered when only the separator format differs", () => {
  const scene = [
    { id: "n1", type: "rectangle", x: 0, y: 0, width: 50, height: 20, isDeleted: false, customData: { plexus: { mm: { uid: "src000001" } } } },
    { id: "t1", type: "text", x: 0, y: 30, width: 50, height: 20, text: "Site", isDeleted: false },
  ];
  const linked = `{{[[plexus-region]]: k=area d=drw000001 ids=n1,t1 pad=10}} ((src000001)) ; Site`;
  const t = build({ elements: scene, blocks: { reg000001: linked } });
  assert.equal(t.actions.regionCaptionCandidate("reg000001"), null);
  const unlinked = build({ elements: scene, blocks: { reg000001: `{{[[plexus-region]]: k=area d=drw000001 ids=n1,t1 pad=10}} Site` } });
  assert.equal(unlinked.actions.regionCaptionCandidate("reg000001"), "((src000001)) · Site");
});

// ---- EXP-1 ----

function clipWorld(over = {}) {
  const writes = [];
  class Item {
    constructor(data) { this.data = data; }
    static supports(type) { return over.supportsSvg ? type === "image/svg+xml" : false; }
  }
  const clipboard = { writeText: async () => {}, write: async (items) => { writes.push(items); for (const it of items) for (const v of Object.values(it.data)) { try { await v; } catch { throw new Error("NotAllowedError"); } } } };
  const svgKey = cropKey({ regionUid: "reg000001", geometryKey: geometryKey(parseRegion(AREA)), drawingHash: "abcd1234", tier: "svg" });
  const pngKey = cropKey({ regionUid: "reg000001", geometryKey: geometryKey(parseRegion(AREA)), drawingHash: "abcd1234", tier: "png" });
  const reads = [];
  const entries = over.entries || {};
  const cache = {
    put: async () => {},
    clear: async () => {},
    peek: (k) => over.memory?.[k] ?? null,
    get: async (k) => entries[k] ?? over.memory?.[k] ?? null,
  };
  const blobs = over.blobs || {};
  const t = build({
    blocks: { reg000001: `${AREA} Site 12` },
    cache,
    clipboard,
    ClipboardItemCtor: over.noItem ? undefined : Item,
    fetchBlob: async (url) => { reads.push(url); if (!(url in blobs)) throw new Error("revoked"); return blobs[url]; },
    rasterize: over.rasterize || (async (text, o) => { reads.push(["raster", o.scale]); return png(); }),
    busy: over.busy,
    urls: over.urls || { createObjectURL: () => "blob:dl", revokeObjectURL: (u) => reads.push(["revoke", u]) },
    upload: over.upload,
    encrypted: over.encrypted,
    api: over.api,
    labelSource: () => ({ string: "{{[[excalidraw]]}}", pageTitle: "Kitchen" }),
    doc: over.doc,
    startTool: undefined,
  });
  return { ...t, writes, reads, svgKey, pngKey };
}

test("copyCropPng writes to the clipboard synchronously, before any await", async () => {
  const w = clipWorld({});
  const key = w.svgKey;
  const w2 = clipWorld({ memory: { [w.svgKey]: { url: "mem:svg" } }, blobs: { "mem:svg": new Blob([svg], { type: "image/svg+xml" }) } });
  const pending = w2.actions.copyCropPng("reg000001");
  assert.equal(w2.writes.length, 1, "clipboard.write must be called synchronously");
  assert.deepEqual(Object.keys(w2.writes[0][0].data), ["image/png"]);
  assert.equal(await pending, true);
  assert.deepEqual(w2.reads, ["mem:svg", ["raster", 2]]);
  assert.equal(w2.toasts.at(-1)[0], "Crop copied as PNG");
  assert.ok(key);
});

test("copyCropPng falls back: a memory PNG when the SVG has an external href, and a refusal when busy", async () => {
  const seed = clipWorld({});
  const external = '<svg viewBox="0 0 10 10"><image href="https://x/y.png"/></svg>';
  const w = clipWorld({
    memory: { [seed.svgKey]: { url: "mem:svg" }, [seed.pngKey]: { url: "mem:png" } },
    blobs: { "mem:svg": new Blob([external]), "mem:png": png() },
  });
  assert.equal(await w.actions.copyCropPng("reg000001"), true);
  assert.equal(w.reads.some((r) => Array.isArray(r) && r[0] === "raster"), false);
  const busy = clipWorld({ busy: () => true });
  assert.equal(await busy.actions.copyCropPng("reg000001"), false);
  assert.equal(busy.writes.length, 0);
  assert.equal(busy.toasts.at(-1)[0], "Busy capturing a crop, try again");
});

test("copyCropPng without ClipboardItem toasts that copying is not supported", async () => {
  const w = clipWorld({ noItem: true });
  assert.equal(await w.actions.copyCropPng("reg000001"), false);
  assert.equal(w.toasts.at(-1)[0], "Copying images is not supported here");
});

test("copyCropPng survives an SVG entry whose URL was revoked by falling through to an IndexedDB PNG", async () => {
  const seed = clipWorld({});
  const w = clipWorld({
    memory: { [seed.svgKey]: { url: "mem:gone" } },
    entries: { [seed.pngKey]: { url: "idb:png" } },
    blobs: { "idb:png": png() },
  });
  assert.equal(await w.actions.copyCropPng("reg000001"), true);
});

test("copyCropSvg writes the markup as text/plain, plus image/svg+xml only when supported", async () => {
  const seed = clipWorld({});
  const mem = { [seed.svgKey]: { url: "mem:svg" } };
  const blobs = { "mem:svg": new Blob([svg]) };
  const plain = clipWorld({ memory: mem, blobs });
  assert.equal(await plain.actions.copyCropSvg("reg000001"), true);
  assert.deepEqual(Object.keys(plain.writes[0][0].data), ["text/plain"]);
  const both = clipWorld({ memory: mem, blobs, supportsSvg: true });
  await both.actions.copyCropSvg("reg000001");
  assert.deepEqual(Object.keys(both.writes[0][0].data).sort(), ["image/svg+xml", "text/plain"]);
  const none = clipWorld({});
  assert.equal(await none.actions.copyCropSvg("reg000001"), false);
  assert.equal(none.toasts.at(-1)[0], "Open the drawing to copy as SVG");
});

test("downloadCrop clicks an anchor named after the label and revokes the URL", async () => {
  const seed = clipWorld({});
  const doc = fakeDoc();
  const w = clipWorld({ memory: { [seed.svgKey]: { url: "mem:svg" } }, blobs: { "mem:svg": new Blob([svg]) }, doc });
  assert.equal(await w.actions.downloadCrop("reg000001"), true);
  const a = doc.made.find((n) => n.tag === "a");
  assert.equal(a.download, "Site 12.png");
  assert.equal(a.href, "blob:dl");
  assert.equal(a.clicked, 1);
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(w.reads.some((r) => Array.isArray(r) && r[0] === "revoke"));
});

test("insertCropImage uploads once and creates exactly one sibling block after the target", async () => {
  const seed = clipWorld({});
  const creates = [];
  const uploads = [];
  const api = {
    data: {
      pull: () => ({ ":block/order": 3, ":block/_children": [{ ":block/uid": "parent001", ":block/string": "notes" }] }),
      block: { create: async (a) => { creates.push(a); } },
    },
    util: { generateUID: () => "newblock01" },
  };
  const w = clipWorld({
    memory: { [seed.svgKey]: { url: "mem:svg" } },
    blobs: { "mem:svg": new Blob([svg]) },
    api,
    upload: async (file) => { uploads.push(file); return "![](https://firebase/x.png)"; },
  });
  w.blocks.tgt000001 = "target";
  assert.equal(await w.actions.insertCropImage("reg000001", "tgt000001"), "newblock01");
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].type, "image/png");
  assert.equal(creates.length, 1);
  assert.deepEqual(creates[0].location, { "parent-uid": "parent001", order: 4 });
  assert.equal(creates[0].block.string, "![Site 12](https://firebase/x.png)");
});

test("insertCropImage refuses encrypted graphs and blocks inside a regions container", async () => {
  const enc = clipWorld({ encrypted: true });
  assert.equal(await enc.actions.insertCropImage("reg000001", "tgt000001"), null);
  assert.equal(enc.toasts.at(-1)[0], "Insert crop is not available on encrypted graphs yet");
  const api = {
    data: { pull: () => ({ ":block/order": 0, ":block/_children": [{ ":block/uid": "cont00001", ":block/string": "{{[[plexus-regions]]}}" }] }), block: { create: async () => { throw new Error("must not create"); } } },
    util: { generateUID: () => "x" },
  };
  const inside = clipWorld({ api, upload: async () => { throw new Error("must not upload"); } });
  inside.blocks.tgt000001 = "child";
  assert.equal(await inside.actions.insertCropImage("reg000001", "tgt000001"), null);
});

test("copyAlias writes [label](((uid))) with brackets stripped from the label", async () => {
  const copied = [];
  const t = build({
    blocks: { reg000001: `${AREA} Site [12] (north)` },
    clipboard: { writeText: async (x) => copied.push(x) },
  });
  assert.equal(await t.actions.copyAlias("reg000001"), true);
  assert.deepEqual(copied, ["[Site 12 north](((reg000001)))"]);
});

// ---- REF-6 ----

test("refreshAfterClose re-claims only when the drawing hash changed", async () => {
  let hash = "h1";
  const regions = [{ uid: "r1", region: {} }, { uid: "r2", region: {} }];
  const t = build({ editor: null, drawing: () => ({ hash, elements: [] }), regionsOf: () => regions });
  const unchanged = await t.actions.refreshAfterClose("drw000001", "h1");
  assert.equal(unchanged, 0);
  assert.equal(t.refreshes.length, 0);
  setTimeout(() => { hash = "h2"; }, 12);
  const count = await t.actions.refreshAfterClose("drw000001", "h1");
  assert.equal(count, 2);
  assert.deepEqual(t.refreshes, [["r1", { purge: false }], ["r2", { purge: false }]]);
});

test("a newer refreshAfterClose call replaces the older poll", async () => {
  let hash = "h1";
  const t = build({ editor: null, drawing: () => ({ hash, elements: [] }), regionsOf: () => [{ uid: "r1", region: {} }], closeWindowMs: 200 });
  const first = t.actions.refreshAfterClose("drw000001", "h1");
  const second = t.actions.refreshAfterClose("drw000001", "h1");
  setTimeout(() => { hash = "h2"; }, 15);
  assert.equal(await first, 0);
  assert.equal(await second, 1);
});

test("refreshAfterClose stops when the editor mounts again, and when disposed", async () => {
  let hash = "h1";
  const mounted = { value: null };
  const t = build({ drawing: () => ({ hash, elements: [] }), regionsOf: () => [{ uid: "r1", region: {} }], closeWindowMs: 200, native: { activeEditor: () => mounted.value } });
  const run = t.actions.refreshAfterClose("drw000001", "h1");
  setTimeout(() => { mounted.value = { app: {}, drawingUid: "drw000001" }; hash = "h2"; }, 12);
  assert.equal(await run, 0);
  assert.equal(t.refreshes.length, 0);
  mounted.value = null;
  const again = t.actions.refreshAfterClose("drw000001", "h2");
  t.actions.dispose();
  assert.equal(await again, 0);
});

test("serializeRegion and fnv1a stay available to the tests", () => {
  assert.ok(serializeRegion && fnv1a);
});

test("a pin primes the cache under the key of the stored (rounded) geometry", async () => {
  const t = build({
    elements: [img],
    ids: ["img-a"],
    editor: imgEditor,
    settings: { pinSize: 8 },
    startTool: tool({ kind: "pin", x: 0.3333333, y: 0.7777777 }),
    openPrompt: () => Object.assign(Promise.resolve("P"), { cancel() {} }),
  });
  await t.actions.createImageRegion();
  const stored = parseRegion(t.created[0][1]);
  const key = cropKey({ regionUid: "reg000001", geometryKey: geometryKey(stored), drawingHash: "abcd1234", tier: "svg" });
  assert.ok(t.puts.length > 0);
  assert.ok(t.puts.some((p) => p[0] === key), "primed key must equal the stored-geometry key");
});

test("copyCropPng: an SVG wrapped in Excalidraw link anchors still takes the SVG path; an external image href does not", async () => {
  const seed = clipWorld({});
  const anchored = '<svg viewBox="0 0 10 10"><a href="((abcdefghi))"><rect width="4" height="4"/></a></svg>';
  const w = clipWorld({ memory: { [seed.svgKey]: { url: "mem:svg" } }, blobs: { "mem:svg": new Blob([anchored]) } });
  assert.equal(await w.actions.copyCropPng("reg000001"), true);
  assert.ok(w.reads.some((r) => Array.isArray(r) && r[0] === "raster"));
  const external = '<svg viewBox="0 0 10 10"><a href="((abcdefghi))"><image href="https://x/y.png"/></a></svg>';
  const w2 = clipWorld({ memory: { [seed.svgKey]: { url: "mem:svg" }, [seed.pngKey]: { url: "mem:png" } }, blobs: { "mem:svg": new Blob([external]), "mem:png": png() } });
  assert.equal(await w2.actions.copyCropPng("reg000001"), true);
  assert.equal(w2.reads.some((r) => Array.isArray(r) && r[0] === "raster"), false);
});

test("refreshAfterClose refreshes on each new hash inside the window", async () => {
  let hash = "h1";
  const t = build({ editor: null, drawing: () => ({ hash, elements: [] }), regionsOf: () => [{ uid: "r1", region: {} }], closeWindowMs: 150 });
  setTimeout(() => { hash = "h2"; }, 12);
  setTimeout(() => { hash = "h3"; }, 60);
  const count = await t.actions.refreshAfterClose("drw000001", "h1");
  assert.equal(count, 2);
  assert.equal(t.refreshes.length, 2);
});

test("dialog Apply while an apply runs is ignored, so the undo slot keeps every change", async () => {
  let dialogOpts;
  let release;
  const gate = new Promise((r) => { release = r; });
  let asked = 0;
  const t = cleanupWorld({
    createCleanup: (o) => { dialogOpts = o; return { show() {}, close() {}, dispose() {} }; },
    confirm: () => { asked += 1; return true; },
    updateRegionString: async (d, u, s) => { await gate; t.blocks[u] = s; },
  });
  const report = await t.actions.captionCleanupDryRun();
  const first = dialogOpts.onApply(report);
  await new Promise((r) => setTimeout(r, 5));
  const second = dialogOpts.onApply(report);
  release();
  await Promise.all([first, second]);
  assert.equal(asked, 1);
  const undone = await t.actions.undoCaptionCleanup();
  assert.equal(undone.restored.length, 4);
});

test("a failed undo keeps the unrestored entries so it can be retried", async () => {
  let failNext = false;
  const t = cleanupWorld({ updateRegionString: async (d, u, s) => { if (failNext) { failNext = false; throw new Error("locked"); } t.blocks[u] = s; } });
  const report = await t.actions.captionCleanupDryRun();
  await t.actions.applyCaptionCleanup(report);
  failNext = true;
  const first = await t.actions.undoCaptionCleanup();
  assert.equal(first.failed.length, 1);
  assert.equal(first.restored.length, 0);
  const retry = await t.actions.undoCaptionCleanup();
  assert.equal(retry.restored.length, 4);
  assert.equal(await t.actions.undoCaptionCleanup(), null);
});
