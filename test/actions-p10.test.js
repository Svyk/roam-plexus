import assert from "node:assert/strict";
import test from "node:test";

import { serializeRegion } from "../src/model/region.js";
import { createActions } from "../src/actions.js";
import { createWriteGuard } from "../src/host/guard.js";

const D = "drw000001";
const rect = (id) => ({ id, type: "rectangle", x: 0, y: 0, width: 50, height: 50, isDeleted: false, version: 1 });

function build(over = {}) {
  const app = {
    els: over.elements || [],
    state: { selectedElementIds: {}, width: 800, height: 600, scrollX: 0, scrollY: 0, zoom: { value: 1 }, offsetLeft: 0, offsetTop: 0, ...(over.state || {}) },
    updates: [],
    getSceneElements() { return this.els.filter((e) => !e.isDeleted); },
    getSceneElementsIncludingDeleted() { return this.els; },
    updateScene(u) {
      this.updates.push(u);
      if (u.elements) this.els = u.elements;
      if (u.appState) Object.assign(this.state, u.appState);
    },
  };
  const ctx = { editor: over.editor === undefined ? { app, drawingUid: D } : over.editor };
  const toasts = [];
  const emitted = [];
  const created = [];
  const blocks = { ...(over.blocks || {}) };
  const deleted = [];
  const edits = [];
  const locks = [];
  const opened = [];
  let n = 0;
  const infos = over.infos || {};
  const host = {
    graphName: () => "g",
    pullBlock: (uid) => (uid in blocks ? { uid, string: blocks[uid].string ?? blocks[uid], children: blocks[uid].children || [] } : null),
    blockInfo: (uid) => infos[uid] ?? null,
    topAncestor: over.topAncestor || (() => null),
    createDrawing: async (o) => { created.push(o); return { uid: `new00000${++n}`, pageUid: "pg" }; },
    ensurePage: over.ensurePage || (async (t) => { created.push({ page: t }); return "pg0000001"; }),
    pageUidByTitle: over.pageUidByTitle || (() => null),
    pageTitleOf: over.pageTitleOf || (() => "Plan"),
    openPageUid: over.openPageUid || (async () => null),
    firstDrawingChild: over.firstDrawingChild || (() => null),
    openBlock: async (uid) => { opened.push(uid); },
    pullEmbedContent: over.pullEmbedContent || ((ref) => (ref.includes("miss") ? null : { kind: ref.startsWith("[[") ? "page" : "block", string: ref.startsWith("[[") ? "" : `text of ${ref}`, title: ref.startsWith("[[") ? ref.slice(2, -2) : "" })),
    blockPaths: over.blockPaths || ((uids) => new Map(uids.filter((u) => !u.startsWith("gone")).map((u, i) => [u, { ancestors: [], orders: [i] }]))),
    labelSource: (uid) => ({ string: blocks[uid]?.label ?? `label ${uid}`, pageTitle: null }),
    createCard: over.createCard || (async () => { created.push({ card: true }); blocks.card000001 = { string: "" }; return "card000001"; }),
    createBlock: over.createBlock || (async (o) => { created.push({ block: o }); blocks.card000002 = { string: "" }; return "card000002"; }),
    deleteBlock: async (uid) => { deleted.push(uid); delete blocks[uid]; return true; },
  };
  const overlay = over.overlay === undefined ? {
    editState: () => "idle",
    hasPortal: () => true,
    edit: async (id, o) => { edits.push([id, o]); return true; },
  } : over.overlay;
  const native = {
    activeEditor: () => ctx.editor,
    selectedElementIds: () => [],
    zoomTo: () => {},
  };
  const actions = createActions({
    host,
    native,
    cache: {},
    cold: {},
    toaster: { show: (m, o) => toasts.push([m, o]) },
    spotlight: () => () => {},
    getSettings: () => over.settings || {},
    doc: over.doc || { querySelectorAll: () => [], defaultView: {} },
    clipboard: {},
    api: over.api || {
      util: { dateToPageTitle: () => "September 29th, 2026", dateToPageUid: () => "09-29-2026", pageTitleToDate: over.pageTitleToDate || (() => null) },
      ui: { getFocusedBlock: () => over.focused ?? null },
    },
    emit: (e) => emitted.push(e),
    withLockFn: async (name, fn) => { locks.push(name); return over.lock ? over.lock(name, fn) : { acquired: true, value: await fn() }; },
    getEmbedOverlay: () => overlay,
    measure: (t, size) => t.length * 10,
    ensureFonts: over.ensureFonts,
    mindmap: over.mindmap || null,
    guard: over.guard,
    frame: async () => {},
  });
  return { actions, app, ctx, toasts, emitted, created, blocks, deleted, edits, locks, opened, host, overlay };
}

const uids = ["b00000001", "b00000002"];
const texts = (w) => w.app.els.filter((e) => e.type === "text");

test("placeBlocks label mode places unlinked text and toasts labels", async () => {
  const w = build();
  const out = await w.actions.placeBlocks(uids, { mode: "label", scenePoint: { x: 0, y: 0 } });
  assert.equal(out.count, 2);
  const t = texts(w);
  assert.equal(t.length, 2);
  assert.ok(t.every((e) => e.link === null));
  assert.deepEqual(t.map((e) => e.text), ["label b00000001", "label b00000002"]);
  assert.equal(w.app.els.filter((e) => e.type === "rectangle").length, 0);
  assert.equal(w.toasts.at(-1)[0], "Placed 2 labels");
});

test("placeBlocks label mode of one block toasts a single label", async () => {
  const w = build();
  await w.actions.placeBlocks(["b00000001"], { mode: "label" });
  assert.equal(w.toasts.at(-1)[0], "Placed 1 label");
});

test("placeBlocks label mode takes pages without a lookup and is not capped by the embed cap", async () => {
  const w = build();
  const many = Array.from({ length: 40 }, (_, i) => `b${String(i).padStart(8, "0")}`);
  const out = await w.actions.placeBlocks([...many, "[[Some Page]]"], { mode: "label" });
  assert.equal(out.count, 41);
  assert.ok(texts(w).every((e) => e.link === null));
  assert.ok(texts(w).some((e) => e.text === "Some Page"));
});

test("placeBlocks link mode still links and keeps its toasts", async () => {
  const w = build();
  await w.actions.placeBlocks(uids, { mode: "link" });
  assert.ok(texts(w).every((e) => typeof e.link === "string" && e.link.startsWith("((")));
  assert.equal(w.toasts.at(-1)[0], "Placed 2 links");
  const v = build();
  await v.actions.placeBlocks(["b00000001"], { mode: "link" });
  assert.equal(v.toasts.at(-1)[0], "Placed 1 link");
  const e = build();
  await e.actions.placeBlocks(uids, { mode: "embed" });
  assert.equal(e.toasts.at(-1)[0], "Placed 2 blocks");
});

test("placeBlocks embed cap toast still offers links", async () => {
  const w = build();
  const many = Array.from({ length: 40 }, (_, i) => `b${String(i).padStart(8, "0")}`);
  assert.equal(await w.actions.placeBlocks(many, { mode: "embed" }), null);
  assert.equal(w.toasts.at(-1)[1].action.label, "Place 40 as links");
});

test("placeBlocks refuses an unknown mode and writes nothing", async () => {
  const w = build();
  assert.equal(await w.actions.placeBlocks(uids, { mode: "bogus" }), null);
  assert.equal(w.toasts.at(-1)[0], "Could not place");
  assert.equal(w.app.updates.length, 0);
});

test("addOutlineBlock creates an empty last child through host.createBlock", async () => {
  const w = build({ blocks: { root00001: { string: "root" } } });
  assert.equal(await w.actions.addOutlineBlock("root00001"), "card000002");
  assert.deepEqual(w.created, [{ block: { parentUid: "root00001", order: "last", string: "" } }]);
});

test("addOutlineBlock toasts and returns null when the root is missing or the create fails", async () => {
  const w = build();
  assert.equal(await w.actions.addOutlineBlock("nope00001"), null);
  assert.equal(w.toasts.at(-1)[0], "Could not add a block");
  const f = build({ blocks: { root00001: { string: "r" } }, createBlock: async () => { throw new Error("boom"); } });
  assert.equal(await f.actions.addOutlineBlock("root00001"), null);
  assert.equal(f.toasts.at(-1)[0], "Could not add a block");
});

test("openRegion ignores fullscreen icons inside the outline dock", async () => {
  const string = serializeRegion({ kind: "area", drawingUid: "drw000001", ids: ["rect-a"], pad: 10, caption: "x" });
  let searched = 0;
  const icon = { dispatchEvent: () => { throw new Error("clicked dock icon"); } };
  const inDock = {
    id: "block-input-x-drw000001",
    closest: (sel) => (sel === ".plexus-dock" ? {} : null),
    querySelector: () => { searched += 1; return icon; },
  };
  const w = build({
    blocks: { reg000001: { string } },
    editor: null,
    doc: { querySelectorAll: () => [inDock], defaultView: {} },
  });
  const result = w.actions.openRegion("reg000001");
  setTimeout(() => w.actions.dispose(), 120);
  assert.equal(await result, null);
  assert.equal(searched, 0);
});
