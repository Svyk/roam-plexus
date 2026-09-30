import assert from "node:assert/strict";
import test from "node:test";

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
    createBlock: async (o) => { created.push({ block: o }); blocks.card000002 = { string: "" }; return "card000002"; },
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

const closed = { editor: null };
const plainInfo = (over = {}) => ({ uid: "tgt000001", string: "Target", order: 2, parentUid: "par000001", parentString: "Parent", parentIsPage: false, pageUid: "pg00000ab", pageTitle: "Notes", ...over });

// ---- newDrawing ----

test("newDrawing here is the first child of the target and emits a drawing change", async () => {
  const w = build({ editor: null, infos: { tgt000001: plainInfo() } });
  const uid = await w.actions.newDrawing({ where: "here", uid: "tgt000001", open: false });
  assert.equal(uid, "new000001");
  assert.deepEqual(w.created, [{ parentUid: "tgt000001", order: 0 }]);
  assert.deepEqual(w.emitted, [{ uid: "new000001", kind: "drawing" }]);
  assert.deepEqual(w.locks, ["plexus:g:new:tgt000001"]);
});

test("newDrawing below is a sibling at order+1 under the same parent", async () => {
  const w = build({ editor: null, infos: { tgt000001: plainInfo() } });
  await w.actions.newDrawing({ where: "below", uid: "tgt000001", open: false });
  assert.deepEqual(w.created, [{ parentUid: "par000001", order: 3 }]);
  assert.deepEqual(w.locks, ["plexus:g:new:par000001"]);
});

test("newDrawing reads the focused block when no uid is given and refuses without one", async () => {
  const w = build({ editor: null, focused: { "block-uid": "tgt000001" }, infos: { tgt000001: plainInfo() } });
  await w.actions.newDrawing({ where: "here", open: false });
  assert.equal(w.created[0].parentUid, "tgt000001");
  const none = build({ editor: null });
  assert.equal(await none.actions.newDrawing({ where: "here", open: false }), null);
  assert.equal(none.toasts.at(-1)[0], "Click into a block first");
  assert.equal(none.created.length, 0);
  const missing = build({ editor: null });
  assert.equal(await missing.actions.newDrawing({ where: "below", uid: "gone00001", open: false }), null);
  assert.equal(missing.toasts.at(-1)[0], "Click into a block first");
});

test("newDrawing refuses with an editor mounted and on Plexus blocks, writing nothing", async () => {
  const mounted = build({ infos: { tgt000001: plainInfo() } });
  assert.equal(await mounted.actions.newDrawing({ where: "here", uid: "tgt000001", open: false }), null);
  assert.equal(mounted.toasts.at(-1)[0], "Close the open drawing first");
  const region = build({ editor: null, infos: { tgt000001: plainInfo({ string: "{{[[plexus-region]]: k=area d=drw000001}}" }), tgt000002: plainInfo({ uid: "tgt000002", parentString: "{{[[plexus-regions]]}}" }) } });
  assert.equal(await region.actions.newDrawing({ where: "below", uid: "tgt000001", open: false }), null);
  assert.equal(await region.actions.newDrawing({ where: "here", uid: "tgt000002", open: false }), null);
  assert.equal(region.created.length, 0);
  assert.equal(mounted.created.length, 0);
});

test("newDrawing on a daily page places a top-level child after the top ancestor, for here and below", async () => {
  const info = plainInfo({ pageUid: "09-29-2026", parentUid: "sched0001" });
  const w = build({ editor: null, infos: { tgt000001: info }, topAncestor: () => ({ uid: "sched0001", order: 4, pageUid: "09-29-2026" }) });
  await w.actions.newDrawing({ where: "here", uid: "tgt000001", open: false });
  assert.deepEqual(w.created, [{ parentUid: "09-29-2026", order: 5 }]);
  const w2 = build({ editor: null, infos: { tgt000001: info }, topAncestor: () => ({ uid: "sched0001", order: 4, pageUid: "09-29-2026" }) });
  await w2.actions.newDrawing({ where: "below", uid: "tgt000001", open: false });
  assert.deepEqual(w2.created, [{ parentUid: "09-29-2026", order: 5 }]);
});

test("newDrawing today creates a last child of today's page, and reuses an existing drawing", async () => {
  const w = build({ editor: null });
  assert.equal(await w.actions.newDrawing({ where: "today", open: false }), "new000001");
  assert.deepEqual(w.created, [{ page: "September 29th, 2026" }, { parentUid: "pg0000001", order: "last" }]);
  assert.deepEqual(w.locks, ["plexus:g:new:today:09-29-2026"]);
  const reuse = build({ editor: null, firstDrawingChild: () => "old000001" });
  assert.equal(await reuse.actions.newDrawing({ where: "today", open: false }), "old000001");
  assert.deepEqual(reuse.created, [{ page: "September 29th, 2026" }]);
  assert.deepEqual(reuse.emitted, []);
});

test("newDrawing page names the page from the template and avoids taken titles", async () => {
  const w = build({ editor: null, settings: { drawingName: "Sketch {page} {n}" }, openPageUid: async () => "pg00000ab", pageTitleOf: () => "Plan [[A]]", pageUidByTitle: (t) => (t === "Drawings/Sketch Plan A 1" ? "x" : null) });
  await w.actions.newDrawing({ where: "page", open: false });
  assert.deepEqual(w.created, [{ title: "Sketch Plan A 2" }]);
  const plain = build({ editor: null, pageUidByTitle: (t) => (t === "Drawings/Drawing September 29th, 2026" || t === "Drawings/Drawing September 29th, 2026 2" ? "x" : null) });
  await plain.actions.newDrawing({ where: "page", open: false });
  assert.deepEqual(plain.created, [{ title: "Drawing September 29th, 2026 3" }]);
  const blank = build({ editor: null, settings: { drawingName: "{page}" } });
  await blank.actions.newDrawing({ where: "page", open: false });
  assert.deepEqual(blank.created, [{ title: "Drawing September 29th, 2026" }]);
});

test("a double invoke creates one drawing: concurrent calls and a repeat within 2 s", async () => {
  const w = build({ editor: null, infos: { tgt000001: plainInfo() } });
  const [a, b] = await Promise.all([
    w.actions.newDrawing({ where: "here", uid: "tgt000001", open: false }),
    w.actions.newDrawing({ where: "here", uid: "tgt000001", open: false }),
  ]);
  assert.equal(a, "new000001");
  assert.equal(b, null);
  const c = await w.actions.newDrawing({ where: "here", uid: "tgt000001", open: false });
  assert.equal(c, "new000001");
  assert.equal(w.created.length, 1);
});

test("a lock that is not acquired toasts and writes nothing", async () => {
  const w = build({ editor: null, infos: { tgt000001: plainInfo() }, lock: async () => ({ acquired: false }) });
  assert.equal(await w.actions.newDrawing({ where: "here", uid: "tgt000001", open: false }), null);
  assert.equal(w.created.length, 0);
  assert.equal(w.emitted.length, 0);
  assert.equal(w.toasts.length, 1);
});

test("newDrawing opens an empty drawing through its placeholder", async () => {
  let editor = null;
  const placeholder = {
    isConnected: true,
    dispatchEvent(e) { if (e.type === "click") editor = { app: {}, drawingUid: "new000001" }; return true; },
  };
  const el = {
    id: "block-input-abc-new000001",
    closest: () => null,
    querySelector: (sel) => (sel.includes("bp3-icon-fullscreen") ? null : sel === ".excalidraw-container > div" ? placeholder : null),
  };
  const w = build({
    editor: null,
    infos: { tgt000001: plainInfo() },
    doc: { querySelectorAll: () => [el], defaultView: { MouseEvent: class { constructor(type) { this.type = type; } } } },
  });
  w.ctx.editor = null;
  const origActive = w.actions;
  // Swap the fake editor lookup in place: the click sets `editor`.
  Object.defineProperty(w.ctx, "editor", { get: () => editor, set() {} });
  const uid = await origActive.newDrawing({ where: "here", uid: "tgt000001" });
  assert.equal(uid, "new000001");
  assert.deepEqual(w.opened, []);
  assert.equal(w.toasts.length, 0);
});

test("newDrawing keeps the block and says so when the drawing never opens", async () => {
  const w = build({ editor: null, infos: { tgt000001: plainInfo() }, doc: { querySelectorAll: () => [], defaultView: {} } });
  const started = Date.now();
  const uid = await w.actions.newDrawing({ where: "here", uid: "tgt000001" });
  assert.equal(uid, "new000001");
  assert.deepEqual(w.opened, ["new000001"]);
  assert.equal(w.toasts.at(-1)[0], "Drawing created; open it from the outline");
  assert.ok(Date.now() - started < 20000);
});

// ---- embedFromPick / createPageAndEmbed ----

test("embedFromPick drops a live embed anchor through the guard with one undo step", async () => {
  const w = build();
  const id = await w.actions.embedFromPick({ ref: "((blk000001))", scenePoint: { x: 500, y: 300 }, app: w.app });
  assert.ok(id.startsWith("plexus-embed-"));
  const u = w.app.updates.at(-1);
  assert.equal(u.captureUpdate, "IMMEDIATELY");
  assert.deepEqual(u.appState.selectedElementIds, { [id]: true });
  const anchor = w.app.els[0];
  assert.equal(anchor.customData.plexus.embed, "((blk000001))");
  assert.equal(anchor.x + anchor.width / 2, 500);
  assert.equal(anchor.y + anchor.height / 2, 300);
  assert.equal(w.app.els.length, 2);
});

test("embedFromPick handles pages, the today token, missing refs and a closed drawing", async () => {
  const w = build();
  await w.actions.embedFromPick({ ref: "[[Some Page]]", app: w.app });
  assert.equal(w.app.els[0].customData.plexus.embed, "[[Some Page]]");
  const t = build();
  await t.actions.embedFromPick({ ref: "plexus:today", app: t.app });
  assert.equal(t.app.els[0].customData.plexus.embed, "plexus:today");
  assert.equal(t.app.els[0].link, "[[September 29th, 2026]]");
  assert.equal(t.app.els[1].text, "Today");
  const miss = build();
  assert.equal(await miss.actions.embedFromPick({ ref: "((miss00001))", app: miss.app }), null);
  assert.equal(miss.toasts.at(-1)[0], "Could not find that block");
  assert.equal(miss.app.updates.length, 0);
  const other = build();
  assert.equal(await other.actions.embedFromPick({ ref: "((blk000001))", app: {} }), null);
  assert.equal(other.toasts.at(-1)[0], "Drawing closed");
  assert.equal(other.app.updates.length, 0);
  const none = build(closed);
  assert.equal(await none.actions.embedFromPick({ ref: "((blk000001))" }), null);
  assert.equal(none.toasts.at(-1)[0], "Drawing closed");
});

test("createPageAndEmbed creates the page, waits for it and then embeds", async () => {
  let visible = 0;
  const w = build({ pageUidByTitle: () => (++visible > 2 ? "pg0000009" : null) });
  const id = await w.actions.createPageAndEmbed("  New   Page ", null, { app: w.app });
  assert.ok(id);
  assert.deepEqual(w.created, [{ page: "New Page" }]);
  assert.ok(visible >= 3);
  assert.equal(w.app.els[0].customData.plexus.embed, "[[New Page]]");
  const bad = build();
  assert.equal(await bad.actions.createPageAndEmbed("a [[b]]", null, { app: bad.app }), null);
  assert.equal(bad.created.length, 0);
  const gone = build();
  assert.equal(await gone.actions.createPageAndEmbed("X", null, { app: {} }), null);
  assert.equal(gone.created.length, 0);
});

// ---- placeBlocks ----

test("placeBlocks lays embeds in a centred grid, selects all, in one guarded write", async () => {
  const w = build();
  const uids = ["b00000001", "b00000002", "b00000003", "b00000004", "b00000005"];
  const out = await w.actions.placeBlocks(uids, { mode: "embed", scenePoint: { x: 0, y: 0 } });
  assert.equal(out.count, 5);
  assert.equal(w.app.updates.length, 1);
  const u = w.app.updates[0];
  assert.equal(u.captureUpdate, "IMMEDIATELY");
  assert.equal(Object.keys(u.appState.selectedElementIds).length, 5);
  const rects = w.app.els.filter((e) => e.type === "rectangle");
  assert.equal(rects.length, 5);
  // ceil(sqrt 5) = 3 columns, cell = 360 + 40.
  assert.deepEqual([...new Set(rects.map((r) => r.x))].sort((a, b) => a - b), [-580, -180, 220]);
  assert.deepEqual([...new Set(rects.map((r) => r.y))].sort((a, b) => a - b), [-220, 20]);
  const minX = Math.min(...rects.map((r) => r.x));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  assert.equal(minX + maxX, 0);
});

test("placeBlocks dedupes, drops missing blocks and descendants of listed blocks, and orders by document position", async () => {
  const paths = new Map([
    ["b00000002", { ancestors: [], orders: [5] }],
    ["b00000001", { ancestors: [], orders: [1, 0] }],
    ["b00000003", { ancestors: ["b00000001"], orders: [1, 0, 2] }],
  ]);
  const w = build({ blockPaths: () => paths });
  const out = await w.actions.placeBlocks(["((b00000002))", "b00000001", "b00000001", "b00000003", "gone00001"], { mode: "embed" });
  assert.equal(out.count, 2);
  const order = w.app.els.filter((e) => e.type === "rectangle").map((e) => e.customData.plexus.embed);
  assert.deepEqual(order, ["((b00000001))", "((b00000002))"]);
});

test("placeBlocks asks in-page above 30 embeds and places nothing; the action places links", async () => {
  const w = build();
  const uids = Array.from({ length: 31 }, (_, i) => `b${String(i).padStart(8, "0")}`);
  assert.equal(await w.actions.placeBlocks(uids, { mode: "embed" }), null);
  assert.equal(w.app.updates.length, 0);
  const [message, opts] = w.toasts.at(-1);
  assert.match(message, /31/);
  assert.equal(opts.action.label, "Place 31 as links");
  opts.action.run();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(w.app.els.filter((e) => e.type === "text").length, 31);
});

test("placeBlocks in link mode makes free text nodes with a plain label, a link, and injected measure", async () => {
  const w = build({ ensureFonts: async () => {}, blocks: { b00000001: { string: "", label: "See ((zzzzzzzzz)) and [[Page]] " + "x".repeat(80) } } });
  const out = await w.actions.placeBlocks(["((b00000001))", "[[Some Page]]"], { mode: "link", scenePoint: { x: 0, y: 0 } });
  assert.equal(out.count, 2);
  const texts = w.app.els;
  assert.equal(texts.length, 2);
  assert.deepEqual(texts.map((t) => t.link), ["((b00000001))", "[[Some Page]]"]);
  assert.ok(texts.every((t) => t.type === "text" && t.fontFamily === 5 && t.fontSize === 20 && t.lineHeight === 1.25 && t.containerId === null));
  assert.ok(texts[0].text.length <= 60);
  assert.ok(!texts[0].text.includes("(("));
  assert.ok(!texts[0].text.includes("[["));
  assert.equal(texts[0].width, texts[0].text.length * 10);
});

test("placeBlocks link mode caps at NODE_CAP with a toast, and never uses confirm", async () => {
  const w = build({ mindmap: { NODE_CAP: 3 } });
  const uids = Array.from({ length: 5 }, (_, i) => `b${String(i).padStart(8, "0")}`);
  const out = await w.actions.placeBlocks(uids, { mode: "link" });
  assert.equal(out.count, 3);
  assert.ok(w.toasts.some(([m]) => /first 3 of 5/.test(m)));
});

test("placeBlocks goes through the injected guard and needs an open drawing", async () => {
  const calls = [];
  const w = build({ guard: { guardedWrite: (app, o) => { calls.push(o); return true; } } });
  await w.actions.placeBlocks(["b00000001"], { mode: "embed" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].captureUpdate, "IMMEDIATELY");
  assert.equal(typeof calls[0].next, "function");
  assert.equal(w.app.updates.length, 0);
  const none = build(closed);
  assert.equal(await none.actions.placeBlocks(["b00000001"]), null);
  assert.equal(none.toasts.at(-1)[0], "Open a drawing first");
});

// ---- armPlace / pending ----

test("armPlace stores the list, placePending places it and clears, cancel and a new arm reset", async () => {
  const w = build(closed);
  assert.equal(w.actions.pendingPlace(), null);
  assert.equal(w.actions.armPlace(["b00000001", "((b00000002))", "b00000001"]), true);
  assert.deepEqual(w.actions.pendingPlace(), { count: 2 });
  assert.match(w.toasts.at(-1)[0], /Place 2 blocks here/);
  assert.equal(await w.actions.placePending({ x: 0, y: 0 }), null);
  assert.deepEqual(w.actions.pendingPlace(), { count: 2 });
  w.ctx.editor = { app: w.app, drawingUid: D };
  const out = await w.actions.placePending({ x: 0, y: 0 });
  assert.equal(out.count, 2);
  assert.equal(w.actions.pendingPlace(), null);
  w.actions.armPlace(["b00000001"]);
  w.actions.armPlace(["b00000001", "b00000002", "b00000003"]);
  assert.deepEqual(w.actions.pendingPlace(), { count: 3 });
  w.actions.cancelPendingPlace();
  assert.equal(w.actions.pendingPlace(), null);
  w.actions.armPlace(["b00000001"]);
  w.actions.dispose();
  assert.equal(w.actions.pendingPlace(), null);
});

test("pending place expires after 10 minutes", async () => {
  const w = build(closed);
  const real = Date.now;
  w.actions.armPlace(["b00000001"]);
  Date.now = () => real() + 11 * 60 * 1000;
  try {
    assert.equal(w.actions.pendingPlace(), null);
  } finally {
    Date.now = real;
  }
});

// ---- newNoteCard / discardIfUntouched ----

test("newNoteCard creates the card under the drawing, inserts the anchor and opens the editable flow", async () => {
  const w = build();
  const uid = await w.actions.newNoteCard({ x: 100, y: 50 });
  assert.equal(uid, "card000001");
  assert.deepEqual(w.created, [{ card: true }]);
  const anchor = w.app.els[0];
  assert.equal(anchor.customData.plexus.embed, "((card000001))");
  assert.equal(w.app.els[1].text, "Note");
  assert.equal(w.edits.length, 1);
  assert.equal(w.edits[0][0], anchor.id);
  assert.equal(typeof w.edits[0][1].onLeave, "function");
});

test("newNoteCard honours card-home page and daily, and refuses in unsafe states", async () => {
  const page = build({ settings: { cardHome: "page" }, infos: { [D]: plainInfo({ uid: D }) } });
  await page.actions.newNoteCard();
  assert.deepEqual(page.created, [{ block: { parentUid: "pg00000ab", order: "last", string: "" } }]);
  const daily = build({ settings: { cardHome: "daily" } });
  await daily.actions.newNoteCard();
  assert.deepEqual(daily.created, [{ page: "September 29th, 2026" }, { block: { parentUid: "pg0000001", order: "last", string: "" } }]);
  for (const over of [closed, { overlay: null }, { overlay: { editState: () => "active", hasPortal: () => true, edit: async () => true } }, { editor: { app: { state: {}, getSceneElementsIncludingDeleted: () => [] }, drawingUid: null } }]) {
    const w = build(over);
    assert.equal(await w.actions.newNoteCard(), null);
    assert.equal(w.created.length, 0);
  }
  const typing = build({ state: { editingTextElement: { id: "t" } } });
  assert.equal(await typing.actions.newNoteCard(), null);
  assert.equal(typing.created.length, 0);
});

test("discardIfUntouched deletes only an empty card this session made, plus its anchor", async () => {
  const w = build();
  await w.actions.newNoteCard();
  const anchorId = w.app.els[0].id;
  assert.equal(await w.actions.discardIfUntouched("card000001", { trigger: "escape" }), true);
  assert.deepEqual(w.deleted, ["card000001"]);
  assert.ok(w.app.els.every((e) => e.isDeleted));
  assert.ok(w.app.els.some((e) => e.id === anchorId));
  assert.equal(w.app.updates.at(-1).captureUpdate, "NEVER");
  // Second call: no longer tracked.
  assert.equal(await w.actions.discardIfUntouched("card000001", { trigger: "escape" }), false);
});

test("discardIfUntouched keeps a card with text or children, foreign uids and keep triggers", async () => {
  const typed = build();
  await typed.actions.newNoteCard();
  typed.blocks.card000001 = { string: "hello" };
  assert.equal(await typed.actions.discardIfUntouched("card000001", { trigger: "escape" }), false);
  assert.deepEqual(typed.deleted, []);
  assert.ok(typed.app.els.every((e) => !e.isDeleted));
  const kids = build();
  await kids.actions.newNoteCard();
  kids.blocks.card000001 = { string: "", children: [{ uid: "kid000001", string: "x", order: 0 }] };
  assert.equal(await kids.actions.discardIfUntouched("card000001", { trigger: "enter" }), false);
  const foreign = build({ blocks: { foreign001: { string: "" } } });
  assert.equal(await foreign.actions.discardIfUntouched("foreign001", { trigger: "escape" }), false);
  assert.deepEqual(foreign.deleted, []);
  for (const trigger of ["unload", "hidden", "api"]) {
    const w = build();
    await w.actions.newNoteCard();
    assert.equal(await w.actions.discardIfUntouched("card000001", { trigger }), false);
    assert.deepEqual(w.deleted, []);
    assert.ok(w.app.els.every((e) => !e.isDeleted));
  }
});

test("removed deletes only the block; a different active editor keeps the anchor untouched", async () => {
  const w = build();
  await w.actions.newNoteCard();
  const before = w.app.updates.length;
  assert.equal(await w.actions.discardIfUntouched("card000001", { trigger: "removed" }), true);
  assert.deepEqual(w.deleted, ["card000001"]);
  assert.equal(w.app.updates.length, before);
  const other = build();
  await other.actions.newNoteCard();
  other.ctx.editor = { app: { getSceneElementsIncludingDeleted: () => [] }, drawingUid: "other0001" };
  const count = other.app.updates.length;
  assert.equal(await other.actions.discardIfUntouched("card000001", { trigger: "pointer" }), true);
  assert.equal(other.app.updates.length, count);
});

test("onLeave from the overlay runs the discard for its trigger", async () => {
  const w = build();
  await w.actions.newNoteCard();
  await w.edits[0][1].onLeave({ trigger: "escape" });
  assert.deepEqual(w.deleted, ["card000001"]);
});

test("a card whose anchor cannot be inserted is discarded", async () => {
  const w = build({ guard: { guardedWrite: () => false } });
  assert.equal(await w.actions.newNoteCard(), null);
  assert.deepEqual(w.deleted, ["card000001"]);
});

// ---- review fixes ----

test("newDrawing from a page menu (a page uid, not a block) creates a last child of that page, daily or not", async () => {
  for (const pageUid of ["pg00000ab", "09-29-2026"]) {
    const w = build({ editor: null, pageTitleOf: (u) => (u === pageUid ? "Some page" : null) });
    const uid = await w.actions.newDrawing({ where: "here", uid: pageUid, open: false, order: "last" });
    assert.equal(uid, "new000001");
    assert.deepEqual(w.created, [{ parentUid: pageUid, order: "last" }]);
    assert.ok(!w.toasts.some(([m]) => m === "Click into a block first"));
    assert.deepEqual(w.locks, [`plexus:g:new:${pageUid}`]);
  }
  const w = build({ editor: null, pageTitleOf: (u) => (u === "pg00000ab" ? "Some page" : null) });
  await w.actions.newDrawing({ where: "here", uid: "pg00000ab", open: false });
  assert.deepEqual(w.created, [{ parentUid: "pg00000ab", order: "last" }]);
  const none = build({ editor: null, pageTitleOf: () => null });
  assert.equal(await none.actions.newDrawing({ where: "here", uid: "nothing01", open: false }), null);
  assert.equal(none.toasts.at(-1)[0], "Click into a block first");
});

test("embedFromPick creates a daily page that does not exist yet, then embeds it", async () => {
  let made = false;
  const w = build({
    pageTitleToDate: (t) => (t === "October 2nd, 2026" ? new Date(2026, 9, 2) : null),
    pullEmbedContent: (ref) => (ref === "[[October 2nd, 2026]]" ? (made ? { kind: "page", string: "", title: "October 2nd, 2026" } : null) : null),
    ensurePage: async (t) => { made = true; w.created.push({ page: t }); return "10-02-2026"; },
    pageUidByTitle: () => (made ? "10-02-2026" : null),
  });
  const id = await w.actions.embedFromPick({ ref: "[[October 2nd, 2026]]", app: w.app });
  assert.ok(id);
  assert.deepEqual(w.created, [{ page: "October 2nd, 2026" }]);
  assert.equal(w.app.els[0].customData.plexus.embed, "[[October 2nd, 2026]]");
  const plain = build({ pullEmbedContent: () => null });
  assert.equal(await plain.actions.embedFromPick({ ref: "[[Missing page]]", app: plain.app }), null);
  assert.equal(plain.created.length, 0);
  assert.equal(plain.toasts.at(-1)[0], "Could not find that page");
});

test("discarding an untouched note card writes with NEVER and leaves no restore-ring entry", async () => {
  const guard = createWriteGuard({ toaster: { show: () => {} } });
  const w = build({ guard });
  await w.actions.newNoteCard();
  assert.equal(guard.hasSnapshot(D), false);
  assert.equal(await w.actions.discardIfUntouched("card000001", { trigger: "escape" }), true);
  assert.equal(w.app.updates.at(-1).captureUpdate, "NEVER");
  assert.ok(w.app.els.every((e) => e.isDeleted));
  assert.equal(guard.hasSnapshot(D), false);
});

test("accepting the links fallback clears the pending place list", async () => {
  const w = build();
  const uids = Array.from({ length: 40 }, (_, i) => `b${String(i).padStart(8, "0")}`);
  assert.equal(w.actions.armPlace(uids), true);
  assert.equal(await w.actions.placePending({ x: 0, y: 0 }), null);
  assert.deepEqual(w.actions.pendingPlace(), { count: 40 });
  w.toasts.at(-1)[1].action.run();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(w.app.els.filter((e) => e.type === "text").length, 40);
  assert.equal(w.actions.pendingPlace(), null);
});

// ---- menu -> placePending -> placeBlocksRun, end to end ----

test("canvas menu click places every armed block through the real guard: anchors, selection, one IMMEDIATELY write", async () => {
  const { installCanvasMenu, plexusCanvasItems } = await import("../src/view/context-menus.js");
  const { viewportToScene } = await import("../src/model/scene.js");
  const w = build({ guard: createWriteGuard({ toaster: { show: () => {} } }) });
  const uids = ["b00000001", "b00000002", "b00000003", "b00000004", "b00000005"];
  assert.equal(w.actions.armPlace(uids), true);
  assert.match(w.toasts.at(-1)[0], /Place 5 blocks here/);
  const node = (tag) => ({
    tag, children: [], attrs: {}, listeners: {}, className: "", style: {}, textContent: "",
    append(...c) { this.children.push(...c); },
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
    removeEventListener() {},
    remove() {},
    querySelectorAll() { return this.children.filter((n) => n.attrs?.["data-plexus-item"]); },
  });
  const ul = node("ul");
  const container = node("div");
  container.querySelector = () => ul;
  ul.closest = () => node("div");
  const queue = [];
  installCanvasMenu({
    doc: { createElement: node, defaultView: { innerHeight: 1000 } }, app: w.app, containerEl: container, raf: (f) => { queue.push(f); return 1; }, caf() {},
    getItems: (point) => plexusCanvasItems({
      app: w.app, native: { selectedElementIds: () => [] }, actions: w.actions, openSettings() {}, drawingUid: D, guard: null, point,
      toScene: (p) => viewportToScene({ x: p.x, y: p.y, appState: w.app.state }),
    }),
  });
  container.listeners.contextmenu[0]({ clientX: 400, clientY: 300 });
  queue.shift()();
  const li = ul.children.find((n) => n.attrs["data-testid"] === "plexus-place-pending");
  assert.ok(li, "place item is in the menu");
  li.children[0].listeners.click[0]({});
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(w.app.updates.length, 1);
  assert.equal(w.app.updates[0].captureUpdate, "IMMEDIATELY");
  assert.equal(w.app.els.filter((e) => e.type === "rectangle").length, 5);
  assert.equal(Object.keys(w.app.updates[0].appState.selectedElementIds).length, 5);
  assert.equal(w.toasts.at(-1)[0], "Placed 5 blocks");
  assert.equal(w.actions.pendingPlace(), null);
});

test("placing says why it refuses, with a [plexus] warning, and never throws", async () => {
  const warns = [];
  const realWarn = console.warn;
  console.warn = (...a) => warns.push(a.join(" "));
  try {
    const none = build(closed);
    assert.equal(await none.actions.placeBlocks(["b00000001"]), null);
    assert.equal(none.toasts.at(-1)[0], "Open a drawing first");
    const idle = build();
    assert.equal(await idle.actions.placePending({ x: 0, y: 0 }), null);
    assert.equal(idle.toasts.at(-1)[0], "Nothing to place");
    assert.equal(await idle.actions.placeBlocks(["gone00001"]), null);
    assert.equal(idle.toasts.at(-1)[0], "Nothing to place");
    const boom = build({ blockPaths: () => { throw new Error("pull failed"); } });
    assert.equal(await boom.actions.placeBlocks(["b00000001"]), null);
    assert.match(boom.toasts.at(-1)[0], /^Could not place: pull failed$/);
    const refused = build({ guard: { guardedWrite: () => false } });
    assert.equal(await refused.actions.placeBlocks(["b00000001"]), null);
    assert.match(refused.toasts.at(-1)[0], /^Could not place: /);
    assert.equal(warns.length >= 5 && warns.every((w) => w.startsWith("[plexus]")), true);
  } finally {
    console.warn = realWarn;
  }
});
