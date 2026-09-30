import assert from "node:assert/strict";
import test from "node:test";

import { createActions } from "../src/actions.js";
import { createTemplateActions, TEMPLATES_PAGE } from "../src/actions-templates.js";
import { baseElement } from "../src/model/embeds.js";
import { STARTERS } from "../src/model/templates.js";

const ORIG = "orig00001";
const TPL = "tpl000001";
const box = (id, x, y, extra = {}) => ({ ...baseElement(id, "rectangle", x, y, 100, 50), ...extra });
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 60; i++) await tick(); };
const live = (els) => (els || []).filter((e) => !e.isDeleted);

function makeApp(elements = [], state = {}) {
  return {
    els: elements,
    files: {},
    added: [],
    updates: [],
    state: { selectedElementIds: {}, width: 800, height: 600, scrollX: 0, scrollY: 0, zoom: { value: 1 }, offsetLeft: 0, offsetTop: 0, ...state },
    getSceneElements() { return this.els.filter((e) => !e.isDeleted); },
    getSceneElementsIncludingDeleted() { return this.els; },
    updateScene(u) {
      this.updates.push(u);
      if (u.elements) this.els = u.elements;
      if (u.appState) Object.assign(this.state, u.appState);
    },
    addFiles(files) { this.added.push(files); for (const f of files) this.files[f.id] = f; },
  };
}

function world(over = {}) {
  const w = { focused: 0, log: [], toasts: [], clock: 0, sleeps: 0, editor: null, pickerOpts: [], promptOpts: [], writes: [], blocks: new Map(), persisted: {}, apps: {}, sidebarRemoved: [], zooms: [], newDrawings: [], propsWrites: 0 };
  w.origApp = makeApp(over.elements ?? [box("a", 0, 0), box("b", 200, 0)]);
  w.apps[ORIG] = w.origApp;
  const setEditor = (uid) => {
    const app = (w.apps[uid] ??= makeApp([]));
    w.editor = {
      app,
      drawingUid: uid,
      el: { focus: () => { w.focused += 1; } },
      outer: { querySelector: (sel) => (sel === ".bp3-icon-minimize" ? { click: () => { if (!over.stuckOpen) { w.log.push(["minimize", uid]); w.editor = null; } } } : null) },
    };
    return w.editor;
  };
  w.setEditor = setEditor;
  if (over.open !== false) setEditor(ORIG);
  w.origApp.state.selectedElementIds = over.selected ?? { a: true, b: true };
  const pageBlocks = over.templateBlocks ?? [];
  w.userDrawings = over.userDrawings ?? {};
  const host = {
    graphName: () => "g",
    pageUidByTitle: (t) => (t === TEMPLATES_PAGE ? (w.pageUid ?? (pageBlocks.length ? "page00001" : null)) : null),
    pullBlock: (uid) => {
      if (uid === "page00001") return { uid, string: "", children: [...pageBlocks, ...[...w.blocks.values()].filter((b) => b.parent === "page00001")].map((b) => ({ uid: b.uid, string: b.string })) };
      const b = w.blocks.get(uid) ?? pageBlocks.find((x) => x.uid === uid);
      if (!b) return null;
      const kids = b.children ?? [...w.blocks.values()].filter((k) => k.parent === uid);
      return { uid, string: b.string, children: kids.map((k) => ({ uid: k.uid, string: k.string })) };
    },
    drawing: (uid) => {
      if (uid === TPL || uid in w.persisted) return { elements: w.persisted[uid] ?? [], appState: {} };
      return w.userDrawings[uid] ?? null;
    },
    ensurePage: async (t) => { w.log.push(["ensurePage", t]); w.pageUid = "page00001"; return "page00001"; },
    createBlock: async (o) => { w.log.push(["createBlock", o.string]); const uid = `blk${w.blocks.size + 1}`.padEnd(9, "0"); w.blocks.set(uid, { uid, string: o.string, parent: o.parentUid }); return uid; },
    createDrawing: async (o) => {
      w.log.push(["createDrawing", o.parentUid]);
      w.blocks.set(TPL, { uid: TPL, string: "{{[[excalidraw]]}}", parent: o.parentUid });
      return { uid: TPL, pageUid: null };
    },
    deleteBlock: async (uid) => { w.log.push(["deleteBlock", uid]); w.blocks.delete(uid); for (const [k, b] of w.blocks) if (b.parent === uid) w.blocks.delete(k); return true; },
  };
  const native = {
    activeEditor: () => w.editor,
    selectedElementIds: (app) => Object.keys(app.state.selectedElementIds).filter((id) => app.state.selectedElementIds[id]),
    waitNotLoading: async () => true,
    zoomTo: (app, bbox) => { w.zooms.push(bbox); },
  };
  const guardedWrite = (app, opts) => {
    const next = opts.next(app.getSceneElementsIncludingDeleted());
    w.writes.push({ app, opts, next });
    app.updateScene({ elements: next, appState: opts.appState, captureUpdate: opts.captureUpdate });
    return over.guardRefuses ? false : true;
  };
  const api = {
    file: { get: over.fileGet ?? (async () => ({ type: "image/png" })) },
    ui: { rightSidebar: { removeWindow: (o) => w.sidebarRemoved.push(o.window["block-uid"]) } },
    data: { block: { update: () => { w.propsWrites += 1; } } },
  };
  const sleep = async (ms) => { w.clock += ms; w.sleeps += 1; over.onSleep?.(w, w.sleeps); };
  const actions = createTemplateActions({
    doc: { defaultView: {} },
    host,
    native,
    api,
    toaster: { show: (m, o) => w.toasts.push([m, o?.kind ?? "info"]) },
    guardedWrite,
    beforeBulk: (app, uid, label) => w.log.push(["beforeBulk", uid, label]),
    measure: (s, size) => String(s).length * 0.6 * size,
    openDrawing: async (uid, opts) => {
      w.log.push(["openDrawing", uid, opts]);
      if (over.openFail?.(uid)) return null;
      const ed = setEditor(uid);
      over.onOpen?.(w, uid);
      return ed;
    },
    newDrawing: async (opts) => {
      w.newDrawings.push(opts);
      if (over.newDrawingResult !== undefined) return over.newDrawingResult(w);
      const ed = setEditor("new000001");
      return { uid: "new000001", reused: false, opened: !!ed };
    },
    thumbnail: async () => null,
    openPicker: (o) => { w.pickerOpts.push(o); return { close() { w.pickerClosed = true; }, isOpen: () => true }; },
    openPrompt: (o) => { w.promptOpts.push(o); return { close() { w.promptClosed = true; }, isOpen: () => true }; },
    withLockFn: async (name, fn) => { w.log.push(["lock", name]); return { acquired: over.lockDenied ? false : true, value: over.lockDenied ? undefined : await fn() }; },
    now: () => w.clock,
    sleep,
    zIndexFor: () => 4242,
    toDataURL: async (b) => `data:${b.type};base64,AAA`,
  });
  w.actions = actions;
  w.pick = (item) => w.pickerOpts.at(-1).onPick(item);
  w.submit = async (name) => { const o = w.promptOpts.at(-1); await o.onSubmit(name); o.onClose(); };
  return w;
}

// ---- Insert template ----

test("insertTemplate refuses without an open editor and opens the picker with starters and user templates", () => {
  const closed = world({ open: false });
  closed.actions.insertTemplate();
  assert.equal(closed.pickerOpts.length, 0);
  assert.deepEqual(closed.toasts.at(-1), ["Open a drawing first", "error"]);
  const w = world({
    templateBlocks: [{ uid: "tb0000001", string: "Mine", children: [{ uid: "td0000001", string: "{{[[excalidraw]]}}" }] }, { uid: "tb0000002", string: "Empty", children: [{ uid: "td0000002", string: "{{[[excalidraw]]}}" }] }, { uid: "tb0000003", string: "No drawing", children: [{ uid: "x00000001", string: "text" }] }],
    userDrawings: { td0000001: { elements: [box("t1", 0, 0)], appState: {} }, td0000002: { elements: [{ ...box("t2", 0, 0), isDeleted: true }], appState: {} } },
  });
  w.actions.insertTemplate();
  const o = w.pickerOpts[0];
  assert.equal(o.zIndex, 4242);
  assert.deepEqual(o.starters.map((s) => s.name), STARTERS.map((s) => s.name));
  assert.deepEqual(o.userTemplates, [{ uid: "tb0000001", drawingUid: "td0000001", name: "Mine" }]);
  assert.equal(typeof o.thumbnail, "function");
});

test("the picker returns focus to the editor on close and after an insert", async () => {
  const w = world();
  w.actions.insertTemplate();
  w.pickerOpts[0].onClose();
  assert.equal(w.focused, 1, "Cancel or Esc");
  await w.pick({ kind: "starter", id: STARTERS[0].id, name: STARTERS[0].name });
  assert.equal(w.focused, 2, "after the insert settles");
});

test("picking a starter inserts it in one guarded write after beforeBulk, centred, selected, with frame order", async () => {
  const w = world({ elements: [box("keep", 0, 0)] });
  w.actions.insertTemplate();
  await w.pick({ kind: "starter", id: "slide-16x9", name: "16:9 slide" });
  assert.equal(w.writes.length, 1);
  assert.deepEqual(w.log.find((l) => l[0] === "beforeBulk"), ["beforeBulk", ORIG, "before Template"]);
  const { opts, next } = w.writes[0];
  assert.equal(opts.drawingUid, ORIG);
  assert.equal(opts.label, "Template");
  assert.equal(opts.captureUpdate, "IMMEDIATELY");
  assert.equal(next.length, 4);
  assert.equal(next[0].id, "keep");
  const frame = next.find((e) => e.type === "frame");
  assert.equal(frame.customData.plexus.order, 1);
  assert.ok(next.indexOf(frame) > next.findIndex((e) => e.type === "text"));
  assert.ok(!next.some((e) => e.id.startsWith("tpl-")), "ids remapped");
  const cx = frame.x + frame.width / 2;
  const cy = frame.y + frame.height / 2;
  assert.ok(Math.abs(cx - 400) < 1 && Math.abs(cy - 300) < 1, "centred on the viewport centre");
  assert.deepEqual(Object.keys(opts.appState.selectedElementIds).sort(), next.slice(1).filter((e) => !e.containerId).map((e) => e.id).sort());
  assert.deepEqual(opts.appState.selectedGroupIds, {});
  assert.equal(w.propsWrites, 0);
});

test("picking a user template inserts a remapped copy, not the paste path, and leaves the source drawing untouched", async () => {
  const src = [box("t1", 0, 0, { boundElements: [{ id: "tx", type: "text" }] }), { ...baseElement("tx", "text", 5, 5, 10, 10), containerId: "t1" }];
  const w = world({ userDrawings: { td0000001: { elements: src, appState: {} } }, templateBlocks: [{ uid: "tb0000001", string: "Mine", children: [{ uid: "td0000001", string: "{{[[excalidraw]]}}" }] }] });
  w.actions.insertTemplate();
  await w.pick({ kind: "user", uid: "tb0000001", drawingUid: "td0000001", name: "Mine" });
  const added = w.writes[0].next.slice(2);
  assert.equal(added.length, 2);
  assert.notEqual(added[0].id, "t1");
  assert.equal(added[1].containerId, added[0].id);
  assert.equal(src[0].id, "t1");
  assert.equal(w.origApp.updates.some((u) => u.elements === undefined && u.appState === undefined), false);
});

test("an insert into a closed editor or a guard refusal writes nothing and says so", async () => {
  const w = world();
  w.actions.insertTemplate();
  w.editor = null;
  await w.pick({ kind: "starter", id: "five-why", name: "x" });
  assert.equal(w.writes.length, 0);
  assert.deepEqual(w.toasts.at(-1), ["Drawing closed", "error"]);
  const r = world({ guardRefuses: true });
  r.actions.insertTemplate();
  await r.pick({ kind: "starter", id: "five-why", name: "x" });
  assert.equal(r.writes.length, 1);
});

test("images: the upload is fetched into a data URL and added to the drawing before the write; a failed fetch inserts anyway and toasts", async () => {
  const img = { ...baseElement("im", "image", 0, 0, 50, 50), fileId: "file1", customData: { firebaseUrl: "https://f/1.enc" } };
  const drawings = { td0000001: { elements: [img], appState: {} } };
  const blocks = [{ uid: "tb0000001", string: "Img", children: [{ uid: "td0000001", string: "{{[[excalidraw]]}}" }] }];
  const w = world({ userDrawings: drawings, templateBlocks: blocks });
  w.actions.insertTemplate();
  await w.pick({ kind: "user", uid: "tb0000001", drawingUid: "td0000001", name: "Img" });
  assert.equal(w.origApp.added.length, 1);
  assert.equal(w.origApp.added[0][0].id, "file1");
  assert.equal(w.origApp.added[0][0].dataURL, "data:image/png;base64,AAA");
  assert.equal(w.writes.length, 1);
  assert.equal(w.writes[0].next.at(-1).fileId, "file1");
  const bad = world({ userDrawings: drawings, templateBlocks: blocks, fileGetFails: true, fileGet: async () => { throw new Error("no"); } });
  bad.actions.insertTemplate();
  await bad.pick({ kind: "user", uid: "tb0000001", drawingUid: "td0000001", name: "Img" });
  assert.equal(bad.writes.length, 1);
  assert.deepEqual(bad.toasts.at(-1), ["1 image missing", "error"]);
  const cached = world({ userDrawings: drawings, templateBlocks: blocks });
  cached.origApp.files.file1 = { id: "file1" };
  cached.actions.insertTemplate();
  await cached.pick({ kind: "user", uid: "tb0000001", drawingUid: "td0000001", name: "Img" });
  assert.equal(cached.origApp.added.length, 0);
});

// ---- New drawing from template ----

test("newFromTemplate: a focused block gets a fresh drawing below it; the template goes in without beforeBulk, then zooms and applies the style", async () => {
  const w = world({ open: false, userDrawings: { td0000001: { elements: [box("t1", 0, 0)], appState: { currentItemStrokeColor: "#f00", zoom: { value: 2 } } } }, templateBlocks: [{ uid: "tb0000001", string: "Mine", children: [{ uid: "td0000001", string: "{{[[excalidraw]]}}" }] }] });
  w.actions.newFromTemplate({ focusedUid: "foc000001" });
  assert.equal(w.pickerOpts[0].zIndex, 4242);
  await w.pick({ kind: "user", uid: "tb0000001", drawingUid: "td0000001", name: "Mine" });
  assert.deepEqual(w.newDrawings, [{ where: "below", uid: "foc000001", fresh: true }]);
  assert.equal(w.writes.length, 1);
  assert.equal(w.writes[0].opts.drawingUid, "new000001");
  assert.ok(!w.log.some((l) => l[0] === "beforeBulk"));
  assert.equal(w.zooms.length, 1);
  assert.deepEqual(w.apps.new000001.updates.find((u) => u.appState?.currentItemStrokeColor)?.appState, { currentItemStrokeColor: "#f00" });
});

test("newFromTemplate with no focused block uses today; an editor already open is refused", async () => {
  const w = world({ open: false });
  w.actions.newFromTemplate({});
  await w.pick({ kind: "starter", id: "sipoc", name: "SIPOC" });
  assert.deepEqual(w.newDrawings, [{ where: "today", fresh: true }]);
  const open = world();
  open.actions.newFromTemplate({ focusedUid: "x" });
  assert.equal(open.pickerOpts.length, 0);
  assert.deepEqual(open.toasts.at(-1), ["Use Insert template… in an open drawing", "error"]);
});

test("newFromTemplate does not insert when the new drawing did not open, or opened a different one", async () => {
  const w = world({ open: false, newDrawingResult: () => ({ uid: "new000001", reused: false, opened: false }) });
  w.actions.newFromTemplate({});
  await w.pick({ kind: "starter", id: "sipoc", name: "SIPOC" });
  assert.equal(w.writes.length, 0);
  assert.deepEqual(w.toasts.at(-1), ["Drawing created; insert the template from its menu", "info"]);
  const other = world({ open: false, newDrawingResult: (x) => { x.setEditor("else00001"); return { uid: "new000001", reused: false, opened: true }; } });
  other.actions.newFromTemplate({});
  await other.pick({ kind: "starter", id: "sipoc", name: "SIPOC" });
  assert.equal(other.writes.length, 0);
  const none = world({ open: false, newDrawingResult: () => null });
  none.actions.newFromTemplate({});
  await none.pick({ kind: "starter", id: "sipoc", name: "SIPOC" });
  assert.equal(none.writes.length, 0);
});

// ---- Save selection as template ----

// Roam saves the template drawing: after `after` sleeps the persisted elements equal the scene.
const saves = (after = 2, mode = "full") => (w, n) => {
  if (n !== after) return;
  const scene = live(w.apps[TPL]?.els);
  w.persisted[TPL] = mode === "partial" ? scene.slice(0, 1) : scene;
};

test("the name prompt returns focus to the editor on cancel", () => {
  const w = world();
  w.actions.saveSelectionAsTemplate();
  w.promptOpts[0].onClose();
  assert.equal(w.focused, 1);
});

test("save flow: captures first, prompts, creates the template block and drawing, saves in the sidebar, verifies, closes, reopens the original", async () => {
  const w = world({ onSleep: saves(2) });
  w.actions.saveSelectionAsTemplate();
  assert.equal(w.promptOpts.length, 1);
  assert.equal(w.promptOpts[0].zIndex, 4242);
  assert.equal(w.log.length, 0, "nothing is created before the name is chosen");
  w.origApp.els = []; // the drawing changing after the capture does not matter
  await w.submit("  My [[flow]] #1  ");
  await settle();
  const names = w.log.map((l) => l[0]);
  assert.deepEqual(names, ["lock", "ensurePage", "createBlock", "createDrawing", "minimize", "openDrawing", "minimize", "openDrawing"]);
  assert.deepEqual(w.log[0], ["lock", "plexus:g:plexus-templates"]);
  assert.deepEqual(w.log[1], ["ensurePage", "Plexus/Templates"]);
  assert.deepEqual(w.log[2], ["createBlock", "My flow 1"]);
  assert.deepEqual(w.log[5], ["openDrawing", TPL, { sidebar: true, placeholder: true }]);
  assert.equal(w.log[7][1], ORIG);
  assert.equal(w.writes.length, 1);
  assert.equal(w.writes[0].opts.drawingUid, TPL);
  assert.ok(!names.includes("beforeBulk"), "the template drawing is new");
  assert.equal(live(w.persisted[TPL]).length, 2);
  assert.deepEqual(w.sidebarRemoved, [TPL]);
  assert.deepEqual(w.toasts.map((t) => t[0]), ["Saving template…", "Template saved: My flow 1"]);
  assert.equal(w.editor.drawingUid, ORIG);
  assert.equal(w.propsWrites, 0);
  assert.equal(w.sleeps, 2, "polled until the persisted count matched");
});

test("save flow: an empty selection, no editor and a second concurrent save are refused before any prompt", async () => {
  const none = world({ selected: {} });
  none.actions.saveSelectionAsTemplate();
  assert.equal(none.promptOpts.length, 0);
  assert.deepEqual(none.toasts.at(-1), ["Select something to save as a template", "error"]);
  const closed = world({ open: false });
  closed.actions.saveSelectionAsTemplate();
  assert.equal(closed.promptOpts.length, 0);
  const w = world({ onSleep: saves(2) });
  w.actions.saveSelectionAsTemplate();
  await w.submit("One");
  w.actions.saveSelectionAsTemplate();
  assert.equal(w.promptOpts.length, 1);
  await settle();
});

test("save flow: images without an upload are counted in a toast, and only closed-set elements are written", async () => {
  const img = { ...baseElement("im", "image", 0, 0, 50, 50), fileId: "f" };
  const w = world({ elements: [box("a", 0, 0), img], selected: { a: true, im: true }, onSleep: saves(2) });
  w.actions.saveSelectionAsTemplate();
  assert.deepEqual(w.toasts[0], ["1 image without an upload was skipped", "info"]);
  await w.submit("Only a");
  await settle();
  assert.equal(live(w.persisted[TPL]).length, 1);
});

test("save flow: the name prompt refuses an empty name and a case-insensitive duplicate inline", async () => {
  const w = world({ templateBlocks: [{ uid: "tb0000001", string: "Flow One", children: [] }], onSleep: saves(2) });
  w.actions.saveSelectionAsTemplate();
  const o = w.promptOpts[0];
  assert.throws(() => o.onSubmit("   "), /Enter a name/);
  assert.throws(() => o.onSubmit("flow ONE"), /already|exists/);
  assert.equal(w.log.length, 0);
  o.onClose();
  await settle();
  assert.equal(w.log.length, 0, "closing without a chosen name does nothing");
});

test("save flow: a persisted count that never matches, with nothing saved, deletes the template block and still reopens the original", async () => {
  const w = world({ onSleep: () => {} });
  w.actions.saveSelectionAsTemplate();
  await w.submit("Lost");
  await settle();
  assert.ok(w.log.some((l) => l[0] === "deleteBlock"));
  assert.equal([...w.blocks.values()].some((b) => b.string === "Lost"), false);
  assert.equal(w.editor.drawingUid, ORIG);
  assert.equal(w.toasts.at(-1)[1], "error");
  assert.ok(w.clock >= 8000, "waited the full verify window");
  assert.deepEqual(w.sidebarRemoved, [TPL]);
  assert.equal(w.propsWrites, 0);
});

test("save flow: a partial persisted count keeps the template and warns", async () => {
  const w = world({ onSleep: saves(2, "partial") });
  w.actions.saveSelectionAsTemplate();
  await w.submit("Partial");
  await settle();
  assert.ok(!w.log.some((l) => l[0] === "deleteBlock"));
  assert.deepEqual(w.toasts.at(-1), ["Template may be incomplete", "error"]);
  assert.equal(w.editor.drawingUid, ORIG);
});

test("save flow: the user closing the template editor mid-save leaves no empty template block and gives a toast", async () => {
  const w = world({ onSleep: (x, n) => { if (n === 1) x.editor = null; } });
  w.actions.saveSelectionAsTemplate();
  await w.submit("Closed early");
  await settle();
  assert.ok(w.log.some((l) => l[0] === "deleteBlock"));
  assert.match(w.toasts.at(-1)[0], /not saved/);
  assert.equal(w.editor?.drawingUid, ORIG, "the original is reopened");
  assert.ok(w.clock < 8000, "did not wait out the timeout");
});

test("save flow: a close during the poll gap is not reported as saved even if the block write arrives", async () => {
  const w = world({
    onSleep: (x, n) => {
      if (n !== 1) return;
      x.editor = null;
      x.persisted[TPL] = live(x.apps[TPL]?.els);
    },
  });
  w.actions.saveSelectionAsTemplate();
  await w.submit("Closed late");
  await settle();
  assert.doesNotMatch(w.toasts.at(-1)[0], /Template saved/);
  assert.match(w.toasts.at(-1)[0], /incomplete|not saved/);
  assert.equal(w.editor?.drawingUid, ORIG);
});

test("save flow: the template drawing not opening deletes the block and reopens the original", async () => {
  const w = world({ openFail: (uid) => uid === TPL });
  w.actions.saveSelectionAsTemplate();
  await w.submit("Nope");
  await settle();
  assert.ok(w.log.some((l) => l[0] === "deleteBlock"));
  assert.equal(w.writes.length, 0);
  assert.equal(w.editor.drawingUid, ORIG);
  assert.match(w.toasts.at(-1)[0], /Could not open the template drawing/);
});

test("save flow: the source editor that will not close stops before any navigation and deletes the empty template", async () => {
  const w = world({ stuckOpen: true });
  w.actions.saveSelectionAsTemplate();
  await w.submit("Stuck");
  await settle();
  assert.ok(!w.log.some((l) => l[0] === "openDrawing"));
  assert.ok(w.log.some((l) => l[0] === "deleteBlock"));
  assert.equal(w.editor.drawingUid, ORIG);
  assert.match(w.toasts.at(-1)[0], /Could not close the drawing/);
});

test("save flow: a reopen that fails says where the template is", async () => {
  const w = world({ onSleep: saves(2), openFail: (uid) => uid === ORIG });
  w.actions.saveSelectionAsTemplate();
  await w.submit("Saved");
  await settle();
  assert.deepEqual(w.toasts.at(-1), ["Template saved; reopen the drawing from the outline", "info"]);
  assert.equal(w.editor, null);
});

test("save flow: a failed reopen after a failed save keeps both facts in one toast", async () => {
  const w = world({ onSleep: saves(2, "partial"), openFail: (uid) => uid === ORIG });
  w.actions.saveSelectionAsTemplate();
  await w.submit("Both");
  await settle();
  assert.match(w.toasts.at(-1)[0], /Template may be incomplete\. Reopen the drawing from the outline/);
});

test("save flow: unload mid-flow stops with no further navigation and no toasts", async () => {
  let w;
  w = world({ onSleep: (x, n) => { if (n === 1) w.actions.dispose(); } });
  w.actions.saveSelectionAsTemplate();
  await w.submit("Unload");
  await settle();
  const toastsAfter = w.toasts.length;
  const opens = w.log.filter((l) => l[0] === "openDrawing").length;
  assert.equal(opens, 1, "the original is not reopened");
  assert.deepEqual(w.toasts.map((t) => t[0]), ["Saving template…"]);
  assert.equal(w.propsWrites, 0);
  assert.equal(toastsAfter, 1);
});

test("save flow: a lock that is not acquired says so and creates nothing", async () => {
  const w = world({ lockDenied: true });
  w.actions.saveSelectionAsTemplate();
  await w.submit("Locked");
  await settle();
  assert.ok(!w.log.some((l) => l[0] === "createBlock"));
  assert.equal(w.toasts.at(-1)[1], "error");
  w.actions.saveSelectionAsTemplate();
  assert.equal(w.promptOpts.length, 2, "not stuck busy after a denied lock");
});

test("dispose closes the picker and the prompt and later commands do nothing", () => {
  const w = world();
  w.actions.insertTemplate();
  w.actions.saveSelectionAsTemplate();
  w.actions.dispose();
  assert.equal(w.pickerClosed, true);
  assert.equal(w.promptClosed, true);
  w.actions.insertTemplate();
  w.actions.newFromTemplate({});
  w.actions.saveSelectionAsTemplate();
  assert.equal(w.pickerOpts.length, 1);
  assert.equal(w.promptOpts.length, 1);
});

// ---- the two actions.js pass-throughs ----

function baseActions(over = {}) {
  const created = [];
  const opened = [];
  const state = { editor: null };
  const host = {
    graphName: () => "g",
    blockInfo: () => null,
    topAncestor: () => null,
    createDrawing: async (o) => { created.push(o); return { uid: `new00000${created.length}`, pageUid: "pg" }; },
    ensurePage: async () => "pg0000001",
    firstDrawingChild: () => "old000001",
    openBlock: async (uid, o) => { opened.push([uid, o]); },
    ...over.host,
  };
  const inputEl = over.inputEl;
  const actions = createActions({
    host,
    cache: {},
    cold: {},
    spotlight() {},
    getSettings: () => ({}),
    toaster: { show() {} },
    api: { util: { dateToPageTitle: () => "September 29th, 2026", dateToPageUid: () => "09-29-2026", pageTitleToDate: () => null }, ui: { getFocusedBlock: () => null } },
    doc: { querySelectorAll: () => (inputEl ? [inputEl] : []), defaultView: { MouseEvent: class { constructor(type) { this.type = type; } } } },
    native: { activeEditor: () => state.editor },
    withLockFn: async (name, fn) => ({ acquired: true, value: await fn() }),
    frame: async () => {},
  });
  return { actions, created, opened, state };
}

test("newDrawing fresh on today always creates a drawing and returns {uid, reused, opened}; plain newDrawing still reuses and returns the uid", async () => {
  const t = baseActions();
  assert.equal(await t.actions.newDrawing({ where: "today", open: false }), "old000001");
  assert.deepEqual(t.created, []);
  const fresh = await t.actions.newDrawing({ where: "today", open: false, fresh: true });
  assert.deepEqual(fresh, { uid: "new000001", reused: false, opened: false });
  assert.deepEqual(t.created, [{ parentUid: "pg0000001", order: "last" }]);
});

test("newDrawing fresh bypasses the 2 s reuse memo", async () => {
  const t = baseActions({ host: { firstDrawingChild: () => null, blockInfo: (uid) => ({ uid, string: "T", order: 0, parentUid: "par000001", parentString: "P", parentIsPage: false, pageUid: "pg00000ab", pageTitle: "N" }) } });
  const a = await t.actions.newDrawing({ where: "below", uid: "tgt000001", open: false });
  const b = await t.actions.newDrawing({ where: "below", uid: "tgt000001", open: false });
  assert.equal(a, b, "the memo reuses within 2 s");
  const c = await t.actions.newDrawing({ where: "below", uid: "tgt000001", open: false, fresh: true });
  assert.equal(c.reused, false);
  assert.notEqual(c.uid, a);
  const d = await t.actions.newDrawing({ where: "below", uid: "tgt000001", open: false, fresh: true });
  assert.notEqual(d.uid, c.uid);
});

test("newDrawing fresh reports opened through the placeholder, and false when it never opens", async () => {
  let editor = null;
  const placeholder = { isConnected: true, dispatchEvent(e) { if (e.type === "click") editor = { app: {}, drawingUid: "new000001" }; return true; } };
  const inputEl = { id: "block-input-abc-new000001", closest: () => null, querySelector: (sel) => (sel.includes("bp3-icon-fullscreen") ? null : sel === ".excalidraw-container > div" ? placeholder : null) };
  const t = baseActions({ inputEl, host: { firstDrawingChild: () => null } });
  Object.defineProperty(t.state, "editor", { get: () => editor, set() {} });
  const res = await t.actions.newDrawing({ where: "today", fresh: true });
  assert.deepEqual(res, { uid: "new000001", reused: false, opened: true });
  const never = baseActions({ host: { firstDrawingChild: () => null } });
  const res2 = await never.actions.newDrawing({ where: "today", fresh: true });
  assert.deepEqual(res2, { uid: "new000001", reused: false, opened: false });
});

test("openDrawing passes placeholder through, so an empty drawing opens by its placeholder", async () => {
  let editor = null;
  const placeholder = { isConnected: true, dispatchEvent(e) { if (e.type === "click") editor = { app: {}, drawingUid: "drw000001" }; return true; } };
  const inputEl = { id: "block-input-abc-drw000001", closest: () => null, querySelector: (sel) => (sel.includes("bp3-icon-fullscreen") ? null : sel === ".excalidraw-container > div" ? placeholder : null) };
  const t = baseActions({ inputEl });
  Object.defineProperty(t.state, "editor", { get: () => editor, set() {} });
  const withPlaceholder = await t.actions.openDrawing("drw000001", { sidebar: true, placeholder: true });
  assert.equal(withPlaceholder.drawingUid, "drw000001");
  assert.deepEqual(t.opened, [], "already on screen: no navigation");
  let e2 = null;
  const ph2 = { isConnected: true, dispatchEvent() { e2 = { app: {}, drawingUid: "drw000001" }; return true; } };
  const input2 = { id: "block-input-abc-drw000001", closest: () => null, querySelector: (sel) => (sel.includes("bp3-icon-fullscreen") ? null : sel === ".excalidraw-container > div" ? ph2 : null) };
  const t3 = baseActions({ inputEl: input2 });
  Object.defineProperty(t3.state, "editor", { get: () => e2, set() {} });
  assert.ok(await t3.actions.openDrawing("drw000001", { placeholder: true }));
});
