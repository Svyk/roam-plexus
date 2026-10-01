import assert from "node:assert/strict";
import test from "node:test";

import { createActions } from "../src/actions.js";
import { directGuard } from "../src/host/guard.js";
import { plexusCanvasItems } from "../src/view/context-menus.js";

const REMOVED = "Removed from the drawing. The block is unchanged.";
const D = "drw000001";

function embed(id, ref, extra = {}) {
  return {
    id, type: "rectangle", x: 1, y: 2, width: 360, height: 200,
    isDeleted: false, version: 1, boundElements: null,
    ...extra,
    customData: { plexus: { embed: ref } },
  };
}

function world({ elements = [], selected = [], editor = true, regions = () => [], blocks = {}, overlay = "idle", guard } = {}) {
  const listeners = new Set();
  const toasts = [];
  const writes = [];
  const note = (name) => (...args) => { writes.push([name, ...args]); };
  let regionList = regions;
  let overlayState = overlay;
  let selectedIds = selected.slice();
  const app = {
    els: elements,
    state: {},
    listeners,
    getSceneElements() { return this.els.filter((el) => el && !el.isDeleted); },
    getSceneElementsIncludingDeleted() { return this.els; },
    updateScene(update) {
      if (update.elements) this.els = update.elements;
      if (update.appState) Object.assign(this.state, update.appState);
      for (const cb of [...listeners]) cb();
    },
    onChangeEmitter: {
      on(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    },
  };
  const ctx = { editor: editor ? { app, drawingUid: D } : null };
  const actions = createActions({
    host: {
      regionsOf: (uid) => regionList(uid),
      pullBlock: (uid) => blocks[uid] ?? null,
      labelSource: (uid) => (blocks[uid] ? { string: blocks[uid].string ?? "", pageTitle: null } : null),
      createBlock: note("createBlock"),
      deleteBlock: note("deleteBlock"),
      createCard: note("createCard"),
      createRegion: note("createRegion"),
      createDrawing: note("createDrawing"),
      ensurePage: note("ensurePage"),
    },
    native: {
      activeEditor: () => ctx.editor,
      selectedElementIds: () => selectedIds,
    },
    cache: {},
    cold: {},
    toaster: { show: (message, opts) => toasts.push([message, opts]) },
    spotlight: () => () => {},
    getSettings: () => ({}),
    doc: {},
    clipboard: {},
    api: {
      data: {
        block: { create: note("block.create"), update: note("block.update"), delete: note("block.delete") },
        pull: () => null,
      },
      util: {},
    },
    getEmbedOverlay: () => ({ editState: () => overlayState, edit: async () => true }),
    guard,
  });
  const items = (extra = {}) => plexusCanvasItems({ app, native: { selectedElementIds: () => selectedIds }, actions, openSettings() {}, drawingUid: D, ...extra });
  const fire = () => { for (const cb of [...listeners]) cb(); };
  return {
    actions, app, ctx, toasts, writes, listeners, items, fire,
    setSelected(ids) { selectedIds = ids.slice(); },
    setOverlay(state) { overlayState = state; },
    scene: () => app.getSceneElementsIncludingDeleted(),
  };
}

test("remove embed menu follows canRemoveEmbed and deletes only the anchor and its bound text", () => {
  const anchor = embed("emb000001", "((blk000001))", { boundElements: [{ id: "txt000001", type: "text" }] });
  const text = { id: "txt000001", type: "text", containerId: "emb000001", text: "Hello", isDeleted: false, version: 1 };
  const other = { id: "rect00001", type: "rectangle", isDeleted: false, version: 1, x: 0, y: 0, width: 10, height: 10 };
  const foreign = { id: "txt000002", type: "text", containerId: "rect00001", text: "no", isDeleted: false, version: 1 };
  const w = world({ elements: [anchor, text, other, foreign], selected: ["emb000001", "txt000001"], overlay: "editing" });
  assert.equal(w.actions.canEditEmbed(), false);
  assert.equal(w.actions.canRemoveEmbed(), true);

  const built = w.items();
  const ids = built.map((item) => item.id);
  const item = built.find((entry) => entry.id === "remove-embed");
  assert.equal(ids[ids.indexOf("edit-embed") + 1], "remove-embed");
  assert.equal(item.label, "Plexus: Remove embed (block untouched)");
  assert.equal(built.filter((entry) => entry.label === item.label).length, 1);
  assert.equal(item.enabled, w.actions.canRemoveEmbed());

  w.setSelected([]);
  assert.equal(w.actions.canRemoveEmbed(), false);
  assert.equal(w.items().find((entry) => entry.id === "remove-embed").enabled, false);
  w.ctx.editor = null;
  assert.equal(w.actions.canRemoveEmbed(), false);
  assert.equal(w.actions.removeSelectedEmbed(), false);
  assert.deepEqual(w.toasts, []);
  w.ctx.editor = { app: w.app, drawingUid: D };
  w.setSelected(["rect00001"]);
  assert.equal(w.actions.canRemoveEmbed(), false);
  w.setSelected(["txt000001"]);
  assert.equal(w.actions.canRemoveEmbed(), false);
  w.setSelected(["emb000001", "rect00001"]);
  assert.equal(w.actions.canRemoveEmbed(), false);

  w.setSelected(["emb000001", "txt000001"]);
  const again = w.items().find((entry) => entry.id === "remove-embed");
  assert.equal(again.enabled, true);
  assert.equal(again.enabled, w.actions.canRemoveEmbed());
  let ran = 0;
  const impl = w.actions.removeSelectedEmbed;
  w.actions.removeSelectedEmbed = () => { ran += 1; return impl(); };
  again.run();
  assert.equal(ran, 1);
  const byId = Object.fromEntries(w.scene().map((el) => [el.id, el]));
  assert.equal(byId.emb000001.isDeleted, true);
  assert.equal(byId.txt000001.isDeleted, true);
  assert.equal(byId.rect00001.isDeleted, false);
  assert.equal(byId.txt000002.isDeleted, false);
  assert.deepEqual(w.toasts.map((t) => t[0]), [REMOVED]);
  assert.deepEqual(w.writes, []);
  assert.equal(w.actions.removeSelectedEmbed(), false);
  assert.equal(w.toasts.length, 1);
});

test("addCitedEmbed writes one embed beside the bbox and no arrow", () => {
  const citing = { id: "src000001", type: "text", x: 4, y: 8, width: 36, height: 20, isDeleted: false, text: "see", version: 1 };
  const w = world({ elements: [citing], blocks: { cite00001: { string: "Cited note" } } });
  const before = new Set(w.scene().map((el) => el.id));
  assert.equal(w.actions.addCitedEmbed({ elementId: "src000001", bbox: [4, 8, 40, 90], ref: "((cite00001))" }), true);
  const added = w.scene().filter((el) => !before.has(el.id));
  assert.deepEqual(added.map((el) => el.type).sort(), ["rectangle", "text"]);
  const rect = added.find((el) => el.type === "rectangle");
  const label = added.find((el) => el.type === "text");
  assert.equal(rect.x, 56);
  assert.equal(rect.y, 8);
  assert.equal(rect.link, "((cite00001))");
  assert.equal(rect.customData.plexus.embed, "((cite00001))");
  assert.equal(rect.frameId, null);
  assert.equal(label.containerId, rect.id);
  assert.equal(label.originalText, "Cited note");
  assert.equal(JSON.stringify(added).includes("src000001"), false);
  assert.equal(w.scene().includes(citing), true);
  assert.equal(citing.isDeleted, false);
  assert.equal(w.scene().some((el) => el.type === "arrow"), false);
  assert.deepEqual(w.writes, []);

  w.ctx.editor = null;
  const count = w.scene().length;
  assert.equal(w.actions.addCitedEmbed({ elementId: "src000001", bbox: [4, 8, 40, 90], ref: "((cite00001))" }), false);
  assert.equal(w.scene().length, count);
  assert.equal(w.toasts.at(-1)[0], "Open a drawing full-screen first");
  assert.equal(w.toasts.at(-1)[1].kind, "error");
  assert.deepEqual(w.writes, []);

  let guardCalls = 0;
  const refused = world({
    elements: [citing],
    blocks: { cite00001: { string: "Cited note" } },
    guard: { guardedWrite: () => { guardCalls += 1; return false; } },
  });
  assert.equal(refused.actions.addCitedEmbed({ elementId: "src000001", bbox: [4, 8, 40, 90], ref: "((cite00001))" }), false);
  assert.equal(guardCalls, 1);
  assert.equal(refused.scene().length, 1);
  assert.deepEqual(refused.toasts, []);
  assert.deepEqual(refused.writes, []);
});

test("leave watch stays quiet at start and toasts once when a live embed anchor disappears", () => {
  const gone = embed("embgone01", "((gone00001))", { isDeleted: true });
  const live = embed("emblive01", "((live00001))");
  const missing = embed("embmiss01", "((miss00001))");
  const w = world({ elements: [gone, live, missing] });
  const stop = w.actions.installAnchorLeaveWatch(w.app, D);
  w.fire();
  assert.deepEqual(w.toasts, []);
  live.isDeleted = true;
  w.fire();
  assert.deepEqual(w.toasts.map((t) => t[0]), [REMOVED]);
  w.fire();
  assert.equal(w.toasts.length, 1);
  const at = w.scene().indexOf(missing);
  w.scene().splice(at, 1);
  w.fire();
  assert.deepEqual(w.toasts.map((t) => t[0]), [REMOVED, REMOVED]);
  w.fire();
  assert.equal(w.toasts.length, 2);
  assert.deepEqual(w.writes, []);
  stop();
  assert.equal(w.app.listeners.size, 0);
  w.actions.installAnchorLeaveWatch(w.app, D);
  assert.equal(w.app.listeners.size, 1);
  w.actions.dispose();
  assert.equal(w.app.listeners.size, 0);
});

test("removeSelectedEmbed does not toast again through the leave watch", () => {
  const anchor = embed("emb000001", "((blk000001))");
  const text = { id: "txt000001", type: "text", containerId: "emb000001", text: "Hello", isDeleted: false, version: 1 };
  const w = world({ elements: [anchor, text], selected: ["emb000001"] });
  w.actions.installAnchorLeaveWatch(w.app, D);
  assert.deepEqual(w.toasts, []);
  assert.equal(w.actions.removeSelectedEmbed(), true);
  const byId = Object.fromEntries(w.scene().map((el) => [el.id, el]));
  assert.equal(byId.emb000001.isDeleted, true);
  assert.equal(byId.txt000001.isDeleted, true);
  assert.deepEqual(w.toasts.map((t) => t[0]), [REMOVED]);
  w.fire();
  assert.equal(w.toasts.length, 1);
  assert.deepEqual(w.writes, []);
});

test("a listed frame or cframe anchor that becomes deleted toasts once", () => {
  for (const kind of ["frame", "cframe"]) {
    const frame = { id: "frm000001", type: "frame", isDeleted: false, x: 0, y: 0, width: 100, height: 80 };
    const loose = { id: "frm000002", type: "frame", isDeleted: false, x: 0, y: 200, width: 40, height: 40 };
    const already = { id: "frmgone01", type: "frame", isDeleted: true, x: 0, y: 0, width: 10, height: 10 };
    const listed = [
      { uid: "reg000001", region: { kind, frameId: "frm000001", supported: true } },
      { uid: "reggone01", region: { kind, frameId: "frmgone01", supported: true } },
      { uid: "regarea01", region: { kind: "area", ids: ["frm000002"], supported: true } },
    ];
    const w = world({ elements: [frame, loose, already], regions: () => listed });
    const stop = w.actions.installAnchorLeaveWatch(w.app, D);
    w.fire();
    loose.isDeleted = true;
    w.fire();
    assert.deepEqual(w.toasts, [], kind);
    frame.isDeleted = true;
    w.fire();
    assert.deepEqual(w.toasts.map((t) => t[0]), [REMOVED], kind);
    w.fire();
    assert.equal(w.toasts.length, 1, kind);
    assert.equal(listed.length, 3, kind);
    assert.equal(listed[0].region.frameId, "frm000001");
    assert.deepEqual(w.writes, []);
    stop();
    assert.equal(w.app.listeners.size, 0, kind);
  }
});

test("a refused remove does not toast and leaves the anchor visible to the watch", () => {
  const anchor = embed("emb000001", "((blk000001))");
  const text = { id: "txt000001", type: "text", containerId: "emb000001", text: "Hello", isDeleted: false, version: 1 };
  const w = world({
    elements: [anchor, text],
    selected: ["emb000001"],
    guard: { guardedWrite: (app, opts) => (opts.label === "Remove embed" ? false : directGuard.guardedWrite(app, opts)) },
  });
  w.actions.installAnchorLeaveWatch(w.app, D);
  assert.equal(w.actions.removeSelectedEmbed(), false);
  assert.equal(anchor.isDeleted, false);
  assert.deepEqual(w.toasts, []);
  anchor.isDeleted = true;
  w.fire();
  assert.deepEqual(w.toasts.map((t) => t[0]), [REMOVED]);
  assert.deepEqual(w.writes, []);
});
