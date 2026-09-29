import assert from "node:assert/strict";
import test from "node:test";

import { createActions } from "../src/actions.js";
import { fnv1a } from "../src/model/hash.js";

const LEGACY = "leg000001";
const TARGET = `m${fnv1a(LEGACY)}`;
const legacyString = (extra = "") => `{{roam/render: ((ExcalDATA)) {:appState {} :elements [{:type "rectangle" :id "a" :x 1 :y 2 :width 10 :height 10} {:type "text" :id "b" :x 0 :y 0 :width 5 :height 5 :text "hi"}${extra}] :roamExcalidraw {:version 1}}}}`;
const tagged = (n) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, type: "rectangle", isDeleted: false, customData: { plexus: { migratedFrom: LEGACY } } }));

function world({ legacy = legacyString(), confirmAnswer = true, editorOpen = false, existing = {}, drawings = {}, verifyTimeoutMs = 1500, openDelay = 0, mutateLegacyOnPaste = false, pasteThrows = false, loaded = true, openFails = false, lockSpy = null } = {}) {
  const log = [];
  const toasts = [];
  const graph = { [LEGACY]: { uid: LEGACY, string: legacy, editTime: 100, children: [], props: null }, parent001: { uid: "parent001", string: "", editTime: 1, children: [{ uid: LEGACY, string: legacy, order: 2 }] } };
  for (const [uid, string] of Object.entries(existing)) graph[uid] = { uid, string, editTime: 5, children: [] };
  const state = { editor: editorOpen ? { app: {}, drawingUid: "other0001" } : null };
  const creates = [];
  const app = {
    state: { width: 800, height: 600 },
    scene: [],
    getSceneElements() { return this.scene; },
    getSceneElementsIncludingDeleted() { return this.scene; },
  };
  const strict = (name) => () => { throw new Error(`strict fake: ${name}`); };
  const api = {
    data: {
      q: (query) => { log.push("q"); return [[LEGACY, legacyString(), "Some Page"]].map((r) => r).concat([]); },
      pull: (pattern, [, uid]) => {
        if (pattern.includes(":block/_children")) return uid === LEGACY ? { ":block/order": 2, ":block/_children": [{ ":block/uid": "parent001" }] } : null;
        return null;
      },
      block: {
        create: async (arg) => {
          if (arg.location["parent-uid"] === LEGACY) throw new Error("strict fake: create under legacy");
          log.push("create");
          creates.push(arg);
          graph[arg.block.uid] = { uid: arg.block.uid, string: arg.block.string, editTime: 7, children: [] };
          graph.parent001.children.push({ uid: arg.block.uid, string: arg.block.string, order: 3 });
        },
        update: strict("block.update"),
        move: strict("block.move"),
        delete: strict("block.delete"),
      },
    },
    util: { generateUID: () => "random0001" },
    ui: { components: { renderBlock: strict("renderBlock"), renderString: strict("renderString") } },
  };
  const host = {
    graphName: () => "g",
    pullBlock: (uid) => graph[uid] ?? null,
    drawing: (uid) => (drawings[uid] ? { elements: drawings[uid] } : null),
    openBlock: async (uid) => {
      log.push("openBlock");
      if (openFails) return;
      if (openDelay) await new Promise((r) => setTimeout(r, openDelay));
      state.editor = { app, drawingUid: uid };
    },
  };
  const pasted = [];
  const native = {
    activeEditor: () => state.editor,
    waitNotLoading: async () => loaded,
    selectedElementIds: () => [],
    withClipboard: (fn) => fn(),
    zoomTo() { log.push("zoom"); },
    addViaPaste: (a, els) => {
      log.push("paste");
      if (pasteThrows) { if (mutateLegacyOnPaste) { graph[LEGACY].string = "edited by user"; graph[LEGACY].editTime = 555; } throw new Error("paste boom"); }
      pasted.push(els);
      const ids = els.map((e, i) => `n${i}`);
      a.scene.push(...els.map((e, i) => ({ ...e, id: ids[i], isDeleted: false })));
      drawings[TARGET] = els.map((e) => ({ ...e, isDeleted: false }));
      if (mutateLegacyOnPaste) graph[LEGACY].editTime = 999;
      return ids;
    },
  };
  const dialog = { shown: [], show(x) { this.shown.push(x); log.push("dialog.show"); }, close() { log.push("dialog.close"); }, dispose() { log.push("dialog.dispose"); } };
  const confirms = [];
  const actions = createActions({
    host, native, cache: {}, cold: {}, toaster: { show: (m) => toasts.push(m) }, spotlight() {}, getSettings: () => ({}),
    doc: { querySelectorAll: () => [] }, api, clipboard: { writeText: async () => {} },
    createDialog: () => dialog,
    confirm: (m) => { confirms.push(m); if (confirmAnswer === "throw") throw new Error("boom"); return confirmAnswer; },
    frame: async () => {}, verifyTimeoutMs, verifyPollMs: 5,
    ...(lockSpy ? { withLockFn: lockSpy } : {}),
  });
  return { actions, log, toasts, creates, pasted, graph, dialog, confirms, state, drawings };
}

test("dry run reads with one data.q and makes no block call; the dialog gets summary and rows", async () => {
  const w = world();
  const out = await w.actions.legacyDryRun();
  assert.equal(w.log.filter((x) => x === "q").length, 1);
  assert.equal(w.creates.length, 0);
  assert.equal(w.dialog.shown.length, 1);
  assert.equal(out.summary.drawings, 1);
  assert.equal(out.rows[0].uid, LEGACY);
  assert.equal(out.rows[0].elementCount, 2);
});

test("dry run with strict fakes: any block.* or render call would throw, and none happens", async () => {
  const w = world();
  await w.actions.legacyDryRun();
  await w.actions.legacyDryRun();
  assert.deepEqual(w.log.filter((x) => x !== "q" && x !== "dialog.show"), []);
});

test("migrate creates one block below the legacy one, tags the paste, closes the dialog first, and never writes the legacy uid", async () => {
  const w = world();
  await w.actions.legacyDryRun();
  const result = await w.actions.migrateLegacy(LEGACY);
  assert.equal(result, TARGET);
  assert.match(w.confirms[0], /Create a new native drawing right below this legacy block/);
  assert.equal(w.creates.length, 1);
  assert.deepEqual(w.creates[0], { location: { "parent-uid": "parent001", order: 3 }, block: { uid: TARGET, string: "{{[[excalidraw]]}}" } });
  assert.ok(w.log.indexOf("dialog.close") >= 0, "the dialog was open and got closed");
  assert.ok(w.log.indexOf("dialog.close") < w.log.indexOf("create"));
  assert.ok(w.log.indexOf("dialog.close") < w.log.indexOf("openBlock"));
  assert.equal(w.pasted.length, 1);
  assert.ok(w.pasted[0].every((e) => e.customData.plexus.migratedFrom === LEGACY));
  assert.deepEqual(w.toasts, ["Migrated 2 elements. The legacy block is unchanged."]);
  assert.equal(w.graph[LEGACY].string, legacyString());
});

test("Already migrated: a tagged drawing at the deterministic uid refuses with no create", async () => {
  const w = world({ existing: { [TARGET]: "{{[[excalidraw]]}}" }, drawings: { [TARGET]: tagged(2) } });
  assert.equal(await w.actions.migrateLegacy(LEGACY), null);
  assert.deepEqual(w.toasts, ["Already migrated"]);
  assert.equal(w.creates.length, 0);
  assert.equal(w.log.includes("paste"), false);
});

test("Already migrated is found among siblings too (a moved or random-uid drawing)", async () => {
  const w = world({ existing: { sib000001: "{{[[excalidraw]]}}" }, drawings: { sib000001: tagged(1) } });
  w.graph.parent001.children.push({ uid: "sib000001", string: "{{[[excalidraw]]}}", order: 9 });
  assert.equal(await w.actions.migrateLegacy(LEGACY), null);
  assert.deepEqual(w.toasts, ["Already migrated"]);
  assert.equal(w.creates.length, 0);
});

test("a failed earlier run (drawing block, zero elements) is reused: no create, paste happens", async () => {
  const w = world({ existing: { [TARGET]: "{{[[excalidraw]]}}" } });
  assert.equal(await w.actions.migrateLegacy(LEGACY), TARGET);
  assert.equal(w.creates.length, 0);
  assert.equal(w.pasted.length, 1);
});

test("a non-drawing block at the target uid is refused before any write", async () => {
  const w = world({ existing: { [TARGET]: "someone typed here" } });
  assert.equal(await w.actions.migrateLegacy(LEGACY), null);
  assert.match(w.toasts[0], /changed; nothing was written/);
  assert.equal(w.creates.length, 0);
});

test("confirm false, a throwing confirm, and an open editor all stop before any write", async () => {
  let w = world({ confirmAnswer: false });
  assert.equal(await w.actions.migrateLegacy(LEGACY), null);
  assert.equal(w.creates.length, 0);
  w = world({ confirmAnswer: "throw" });
  assert.equal(await w.actions.migrateLegacy(LEGACY), null);
  assert.equal(w.creates.length, 0);
  w = world({ editorOpen: true });
  assert.equal(await w.actions.migrateLegacy(LEGACY), null);
  assert.deepEqual(w.toasts, ["Close the open drawing first"]);
  assert.equal(w.confirms.length, 0);
});

test("single flight: a second Migrate while one runs is refused", async () => {
  const w = world({ openDelay: 30 });
  const first = w.actions.migrateLegacy(LEGACY);
  await new Promise((r) => setTimeout(r, 5));
  const second = await w.actions.migrateLegacy(LEGACY);
  assert.equal(second, null);
  assert.ok(w.toasts.includes("A migration is already running"));
  await first;
  assert.equal(w.creates.length, 1);
});

test("invalid elements are skipped and reported as N of M", async () => {
  const w = world({ legacy: legacyString(' {:type "rectangle" :id "c" :x ##NaN :y 0 :width 1 :height 1}') });
  await w.actions.migrateLegacy(LEGACY);
  assert.equal(w.pasted[0].length, 2);
  assert.match(w.toasts[0], /^Migrated 2 of 3 elements \(1 not migrated\)\. The legacy block is unchanged\.$/);
});

test("a legacy block that changed meanwhile is reported as not changed by Plexus", async () => {
  const w = world({ mutateLegacyOnPaste: true });
  await w.actions.migrateLegacy(LEGACY);
  assert.match(w.toasts[0], /The legacy block changed during migration \(not by Plexus\)\./);
});

test("no success wording when Roam never saves the pasted elements", async () => {
  const w = world({ verifyTimeoutMs: 40 });
  Object.defineProperty(w.drawings, TARGET, { get: () => [], set() {}, configurable: true, enumerable: true });
  const result = await w.actions.migrateLegacy(LEGACY);
  assert.equal(result, null);
  assert.equal(w.toasts.some((m) => /^Migrated/.test(m)), false);
  assert.deepEqual(w.toasts, ["Migration not confirmed yet. Reopen the drawing before running Migrate again"]);
  assert.equal(w.graph[LEGACY].string, legacyString());
});

test("a throwing paste names the empty drawing and does not claim the legacy block is unchanged when it was edited", async () => {
  const w = world({ pasteThrows: true, mutateLegacyOnPaste: true });
  assert.equal(await w.actions.migrateLegacy(LEGACY), null);
  assert.equal(w.toasts.length, 1);
  assert.ok(w.toasts[0].startsWith(`Migration failed. An empty drawing (${TARGET}) was created; run Migrate again and it will be reused. The legacy block changed meanwhile`));
  assert.doesNotMatch(w.toasts[0], /is unchanged/);
});

test("a throwing paste with an untouched legacy block says so, and names the created drawing", async () => {
  const w = world({ pasteThrows: true });
  assert.equal(await w.actions.migrateLegacy(LEGACY), null);
  assert.ok(w.toasts[0].includes(TARGET));
  assert.ok(w.toasts[0].endsWith("The legacy block is unchanged."));
});

test("open failure after create names the empty drawing", async () => {
  const w = world({ openFails: true });
  const result = await w.actions.migrateLegacy(LEGACY);
  assert.equal(result, null);
  assert.equal(w.creates.length, 1);
  assert.ok(w.toasts.some((m) => m.includes(TARGET) && /did not open/.test(m)));
  assert.equal(w.log.includes("paste"), false);
});

test("a scene that is still loading aborts before the paste", async () => {
  const w = world({ loaded: false });
  assert.equal(await w.actions.migrateLegacy(LEGACY), null);
  assert.equal(w.log.includes("paste"), false);
  assert.deepEqual(w.toasts, ["Drawing is still loading; run Migrate again and the empty drawing will be reused"]);
});

test("the migration lock: exact name and ifAvailable; a loser toasts and writes nothing", async () => {
  const calls = [];
  const w = world({ lockSpy: async (name, fn, opts) => { calls.push([name, opts]); return { acquired: false }; } });
  await w.actions.legacyDryRun();
  assert.equal(await w.actions.migrateLegacy(LEGACY), null);
  assert.deepEqual(calls, [[`plexus:g:migrate:${LEGACY}`, { ifAvailable: true }]]);
  assert.deepEqual(w.toasts, ["Migration already running in another window"]);
  assert.equal(w.creates.length, 0);
  assert.equal(w.log.includes("openBlock"), false);
  assert.equal(w.log.includes("dialog.close"), false);
});

test("editEmbed guards: page refs are read-only, drawings and unknown blocks are refused, a block ref opens the editor", async () => {
  const toasts = [];
  const calls = [];
  const anchor = (ref) => ({ id: "e1", type: "rectangle", isDeleted: false, customData: { plexus: { embed: ref } } });
  let el = anchor("[[A Page]]");
  const blocks = { blk000001: { string: "hello" }, drw000001: { string: "{{[[excalidraw]]}}" }, rnd000001: { string: "{{[[roam/render]]: ((x))}}" } };
  const app = { getSceneElements: () => [el] };
  let idle = "idle";
  const actions = createActions({
    host: { pullBlock: (u) => blocks[u] ?? null }, cache: {}, cold: {}, spotlight() {}, getSettings: () => ({}), doc: {},
    native: { activeEditor: () => ({ app, drawingUid: "cur000001" }), selectedElementIds: () => ["e1"] },
    toaster: { show: (m) => toasts.push(m) },
    api: { data: { pull: () => ({ ":block/parents": [{ ":block/uid": "anc000001" }] }) } },
    getEmbedOverlay: () => ({ editState: () => idle, edit: async (id) => { calls.push(id); return true; } }),
  });
  assert.equal(actions.canEditEmbed(), true);
  assert.equal(await actions.editEmbed(), false);
  assert.deepEqual(toasts, ["Page embeds are read-only for now"]);
  for (const ref of ["((drw000001))", "((rnd000001))", "((zzz000000))", "((cur000001))", "((anc000001))"]) {
    el = anchor(ref);
    blocks.anc000001 = { string: "ancestor" };
    assert.equal(await actions.editEmbed(), false, ref);
  }
  assert.ok(toasts.slice(1).every((m) => m === "This block cannot be edited on the canvas"));
  el = anchor("((blk000001))");
  assert.equal(await actions.editEmbed(), true);
  assert.deepEqual(calls, ["e1"]);
  idle = "active";
  assert.equal(actions.canEditEmbed(), false);
});

test("openDrawing clicks a visible drawing's icon without navigating", async () => {
  const state = { editor: null };
  let opened = 0;
  const icon = { isConnected: true, dispatchEvent: () => { state.editor = { app: {}, drawingUid: "drw000001" }; } };
  const host = { openBlock: async () => { opened += 1; } };
  const inputEl = { id: "block-input-w-drw000001", closest: () => null, querySelector: () => icon };
  const actions = createActions({
    host, cache: {}, cold: {}, spotlight() {}, getSettings: () => ({}), toaster: { show() {} }, api: {},
    doc: { querySelectorAll: () => [inputEl], defaultView: { MouseEvent: class { constructor(type) { this.type = type; } } } },
    native: { activeEditor: () => state.editor },
  });
  const editor = await actions.openDrawing("drw000001");
  assert.equal(editor.drawingUid, "drw000001");
  assert.equal(opened, 0);
});
