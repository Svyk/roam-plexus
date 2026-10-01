import assert from "node:assert/strict";
import test from "node:test";

import { installRoamMenus, plexusCanvasItems } from "../src/view/context-menus.js";
import { createEditorToolbar, installBackKey } from "../src/view/toolbar.js";
import { auditOpenTarget } from "../src/view/audit-dialog.js";
import { installRegionLanding } from "../src/view/landing.js";
import { openAuditDialog } from "../src/view/audit-dialog.js";

const REGION = "{{[[plexus-region]]: k=area d=abc123XYZ ids=rect-a,text_a pad=10}} Region A";
const tick = () => new Promise((r) => setImmediate(r));

// ---- roam menus ----

function menuSetup({ strings = {}, host = {} } = {}) {
  const commands = { blockRefContextMenu: new Map(), blockContextMenu: new Map() };
  const ui = {};
  for (const m of Object.keys(commands)) {
    ui[m] = { addCommand: (c) => commands[m].set(c.label, c), removeCommand: ({ label }) => commands[m].delete(label) };
  }
  const api = { ui, data: { pull: (_p, [, uid]) => (uid in strings ? { ":block/string": strings[uid] } : null) } };
  const calls = [];
  const rec = (name) => (...a) => { calls.push([name, ...a]); };
  const actions = {
    selectRegionOnDrawing: rec("select"), updateRegionFromSelection: rec("update"), copyRegionLink: rec("link"),
    repairRegion: async (...a) => { calls.push(["repair", ...a]); return { fixed: true }; },
  };
  const regionref = { modeOf: () => "thumbnail", refreshBlock() {}, refreshRegion: rec("refresh") };
  installRoamMenus({ api, host, actions, regionref, setRefOverride() {}, openSettings() {}, now: () => 0 });
  return { commands, calls };
}
const shown = (c, menu, label, e) => c[menu].get(label)["display-conditional"](e);

test("block menu: select and update show for drawing regions, callbacks call actions synchronously", () => {
  const { commands, calls } = menuSetup({ strings: { reg000001: REGION, plain0001: "hi" } });
  const e = { "block-uid": "reg000001" };
  for (const label of ["Plexus: Select on drawing", "Plexus: Update region from selection", "Plexus: Copy region link"]) {
    assert.equal(shown(commands, "blockContextMenu", label, e), true);
    assert.equal(shown(commands, "blockContextMenu", label, { "block-uid": "plain0001" }), false);
    commands.blockContextMenu.get(label).callback(e);
  }
  assert.deepEqual(calls, [["select", "reg000001"], ["update", "reg000001"], ["link", "reg000001"]]);
});

test("Copy region link also lives on the block-ref menu", () => {
  const { commands, calls } = menuSetup({ strings: { reg000001: REGION } });
  const e = { "ref-uid": "reg000001", "block-uid": "blk000001" };
  assert.equal(shown(commands, "blockRefContextMenu", "Plexus: Copy region link", e), true);
  commands.blockRefContextMenu.get("Plexus: Copy region link").callback(e);
  assert.deepEqual(calls, [["link", "reg000001"]]);
});

test("Repair region shows for an unresolved target or an area with missing ids, not for a healthy region", async () => {
  const drawing = (elements) => ({ elements, appState: {}, hash: "h" });
  const el = (id) => ({ id, type: "rectangle", x: 0, y: 0, width: 10, height: 10 });
  const cases = [
    [() => null, true],
    [() => drawing([el("rect-a")]), true],
    [() => drawing([el("rect-a"), el("text_a")]), false],
    [() => { throw new Error("x"); }, false],
  ];
  for (const [fn, expected] of cases) {
    const { commands, calls } = menuSetup({ strings: { reg000001: REGION }, host: { drawing: fn } });
    const e = { "block-uid": "reg000001" };
    assert.equal(shown(commands, "blockContextMenu", "Plexus: Repair region", e), expected);
    if (expected) {
      commands.blockContextMenu.get("Plexus: Repair region").callback(e);
      await tick();
      assert.deepEqual(calls, [["repair", "reg000001"], ["refresh", "reg000001", { purge: false }]]);
    }
  }
});

// ---- canvas items ----

function canvas({ selected = [], elements = [], pending = null, snapshot = false, frames = false, drawingUid = "abc123XYZ", guard } = {}) {
  const calls = [];
  const rec = (name) => () => { calls.push(name); };
  const actions = {
    isFrameSelected: () => false, hasCroppedImageSelected: () => false, hasSingleImageSelected: () => false, canEditEmbed: () => false,
    hasFrames: () => frames, pendingRegionUpdate: () => pending, hasSnapshot: guard ? undefined : () => snapshot,
    copyDrawingRef: rec("ref"), copyDrawingEmbed: rec("embed"), regionsForAllFrames: rec("frames"), restoreBeforeLastPlexusChange: rec("restore"),
    selectTextOnly: rec("text"), removeElementLink: rec("unlink"), applyPendingUpdate: rec("apply"),
  };
  const app = { state: {}, getSceneElementsIncludingDeleted: () => elements };
  const native = { selectedElementIds: () => selected };
  const items = plexusCanvasItems({ app, native, actions, openSettings() {}, drawingUid, guard });
  const enabled = () => items.filter((i) => i.enabled).map((i) => i.id);
  return { items, enabled, calls, run: (id) => items.find((i) => i.id === id).run() };
}
const NINE = ["region", "frame", "crop", "image", "embed", "edit-embed", "present", "mindmap", "settings"];

test("canvas items keep today's nine in order (P9 adds the picker and note items after Embed)", () => {
  const { items } = canvas();
  const ids = items.map((i) => i.id);
  assert.deepEqual(ids.filter((id) => NINE.includes(id)), NINE);
  assert.deepEqual(ids.slice(0, 7), ["region", "frame", "crop", "image", "embed", "embed-picker", "note"]);
  const at = ids.indexOf("export");
  assert.deepEqual(ids.slice(at, at + 6), ["export", "export-scene", "tag-elements", "show-tag", "keep-export", "keep-links"]);
});

test("nothing selected: copy items always, frames and restore by condition", () => {
  assert.deepEqual(canvas().enabled(), ["embed", "export", "export-scene", "show-tag", "keep-export", "keep-links", "insert-image", "drawing-name", "mindmap", "settings", "copy-drawing", "copy-embed"]);
  const c = canvas({ frames: true, snapshot: true });
  assert.deepEqual(c.enabled(), ["embed", "present", "present-here", "present-live", "export", "export-scene", "show-tag", "keep-export", "keep-links", "insert-image", "drawing-name", "mindmap", "settings", "copy-drawing", "copy-embed", "frames-regions", "restore"]);
  for (const id of ["copy-drawing", "copy-embed", "frames-regions", "restore"]) c.run(id);
  assert.deepEqual(c.calls, ["ref", "embed", "frames", "restore"]);
  assert.ok(!canvas({ drawingUid: null }).enabled().includes("copy-drawing"));
});

test("restore can read hasSnapshot from an injected guard", () => {
  const guard = { hasSnapshot: (uid) => uid === "abc123XYZ" };
  assert.ok(canvas({ guard }).enabled().includes("restore"));
});

test("tag elements shows for a selected text element", () => {
  const text = { id: "t", type: "text" };
  const rect = { id: "r", type: "rectangle" };
  assert.ok(canvas({ selected: ["t"], elements: [text] }).enabled().includes("tag-elements"));
  assert.ok(!canvas({ selected: ["r"], elements: [rect] }).enabled().includes("tag-elements"));
  assert.ok(!canvas().enabled().includes("tag-elements"));
});

test("with a selection the nothing-selected items go away", () => {
  const e = canvas({ selected: ["a"], elements: [{ id: "a", type: "rectangle" }], frames: true, snapshot: true }).enabled();
  for (const id of ["copy-drawing", "copy-embed", "frames-regions", "restore"]) assert.ok(!e.includes(id));
});

test("Select text only needs two selected with a free text; Remove link needs a link", () => {
  const rect = { id: "r", type: "rectangle" };
  const free = { id: "t", type: "text" };
  const bound = { id: "b", type: "text", containerId: "r" };
  assert.ok(canvas({ selected: ["r", "t"], elements: [rect, free] }).enabled().includes("text-only"));
  assert.ok(!canvas({ selected: ["t"], elements: [free] }).enabled().includes("text-only"));
  assert.ok(!canvas({ selected: ["r", "b"], elements: [rect, bound] }).enabled().includes("text-only"));
  assert.ok(canvas({ selected: ["r"], elements: [{ ...rect, link: "https://x" }] }).enabled().includes("remove-link"));
  assert.ok(!canvas({ selected: ["r"], elements: [rect] }).enabled().includes("remove-link"));
  assert.ok(!canvas({ selected: ["r"], elements: [{ ...rect, link: "https://x", isDeleted: true }] }).enabled().includes("remove-link"));
});

test("a pending region update adds its item, labelled, only with a selection", () => {
  const pending = { uid: "reg000001", label: "Area 1" };
  const withSel = canvas({ selected: ["a"], elements: [{ id: "a", type: "rectangle" }], pending });
  const item = withSel.items.find((i) => i.id === "apply-pending");
  assert.equal(item.label, 'Plexus: Update region "Area 1" from selection');
  assert.ok(withSel.enabled().includes("apply-pending"));
  withSel.run("apply-pending");
  assert.deepEqual(withSel.calls, ["apply"]);
  assert.ok(!canvas({ selected: [], pending }).enabled().includes("apply-pending"));
  assert.equal(canvas().items.some((i) => i.id === "apply-pending"), false);
});

test("a throwing condition disables the item and a throwing action does not escape", () => {
  const items = plexusCanvasItems({
    app: {}, native: { selectedElementIds: () => { throw new Error("x"); } },
    actions: { hasFrames: () => { throw new Error("y"); }, copyDrawingRef: () => { throw new Error("z"); } },
    openSettings() {}, drawingUid: "abc123XYZ",
  });
  assert.equal(items.find((i) => i.id === "region").enabled, false);
  const warn = console.warn; console.warn = () => {};
  try { assert.doesNotThrow(() => items.find((i) => i.id === "copy-drawing").run()); } finally { console.warn = warn; }
});

// ---- toolbar ----

function toolbarDoc() {
  const buttons = [];
  const bar = { style: {}, className: "", children: [], append(...c) { this.children.push(...c); }, remove() {}, getBoundingClientRect: () => ({ height: 36 }) };
  const doc = {
    defaultView: { getComputedStyle: () => ({ zIndex: "auto" }), addEventListener() {}, removeEventListener() {} },
    body: { append() {} },
    createElement: (tag) => {
      if (tag === "div") return bar;
      const b = { style: {}, attrs: {}, handlers: {}, disabled: false, addEventListener(t, f) { this.handlers[t] = f; }, setAttribute(k, v) { this.attrs[k] = v; } };
      buttons.push(b);
      return b;
    },
  };
  return { doc, buttons, bar };
}
const outerEl = { parentElement: null, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 700, right: 1000, bottom: 700 }) };

test("Regions button toggles and mirrors aria-pressed; Back is gated, titled and fires", async () => {
  const { doc, buttons } = toolbarDoc();
  let on = false;
  let back = false;
  let went = 0;
  const tb = createEditorToolbar({
    doc, onAreaRegion() {}, onImageRegion() {},
    onToggleRegions: () => { on = !on; }, regionsVisible: () => on,
    onBack: () => { went += 1; }, canBack: () => back,
  });
  tb.show(outerEl);
  const regions = buttons.find((b) => b.textContent === "Regions");
  const backButton = buttons.find((b) => b.textContent === "Back");
  assert.equal(regions.attrs["aria-pressed"], "false");
  assert.equal(backButton.title, "Back (Alt+←)");
  assert.equal(backButton.disabled, true);
  regions.handlers.click({ stopPropagation() {} });
  await tick();
  assert.equal(regions.attrs["aria-pressed"], "true");
  back = true;
  backButton.handlers.click({ stopPropagation() {} });
  await tick();
  assert.equal(went, 1);
  assert.equal(backButton.disabled, false);
  tb.hide();
});

test("no Regions or Back buttons unless their callbacks are given", () => {
  const { doc, buttons } = toolbarDoc();
  createEditorToolbar({ doc, onAreaRegion() {}, onImageRegion() {} }).show(outerEl);
  assert.equal(buttons.some((b) => b.textContent === "Regions" || b.textContent === "Back"), false);
});

// ---- Alt+Left ----

function backKey({ state = {}, canBack = true } = {}) {
  const containerEl = { handlers: [], removed: 0, addEventListener(t, f, cap) { this.handlers.push([t, f, cap]); }, removeEventListener() { this.removed += 1; } };
  const app = { state };
  let went = 0;
  const dispose = installBackKey({ containerEl, app, canBack: () => canBack, onBack: () => { went += 1; } });
  const fire = (over = {}) => {
    const log = [];
    const e = { key: "ArrowLeft", altKey: true, target: containerEl, preventDefault: () => log.push("pd"), stopImmediatePropagation: () => log.push("sip"), ...over };
    containerEl.handlers[0][1](e);
    return log;
  };
  return { containerEl, dispose, fire, went: () => went };
}

test("Alt+Left goes back with nothing selected, swallowing the key", () => {
  const k = backKey();
  assert.equal(k.containerEl.handlers[0][0], "keydown");
  assert.equal(k.containerEl.handlers[0][2], true);
  assert.deepEqual(k.fire(), ["pd", "sip"]);
  assert.equal(k.went(), 1);
  k.dispose();
  assert.equal(k.containerEl.removed, 1);
});

test("Alt+Left passes through with a selection, an empty history, modifiers, or busy editor state", () => {
  assert.deepEqual(backKey({ state: { selectedElementIds: { a: true } } }).fire(), []);
  assert.deepEqual(backKey({ canBack: false }).fire(), []);
  for (const over of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: false }, { key: "ArrowRight" }, { isComposing: true }, { target: {} }]) {
    const k = backKey();
    assert.deepEqual(k.fire(over), [], JSON.stringify(over));
    assert.equal(k.went(), 0);
  }
  for (const state of [{ editingTextElement: {} }, { openDialog: {} }, { openMenu: "x" }, { contextMenu: {} }]) {
    assert.deepEqual(backKey({ state }).fire(), []);
  }
  assert.equal(backKey({ state: { selectedElementIds: { a: false } } }).fire().length, 2);
});

// ---- landing ----

const fakeEditorEl = {
  closest: () => null,
  __reactFiber$t: { stateNode: { updateScene() {}, getSceneElementsIncludingDeleted() {}, actionManager: {} } },
};

function landing({ hash = "", now = 100, graph = "Readwisenotes", strings = {}, nav = true, enabled = true, editor = false, mainWindow } = {}) {
  const listeners = {};
  const navListeners = {};
  const win = {
    location: { hash },
    performance: { now: () => now },
    addEventListener: (t, f) => { listeners[t] = f; },
    removeEventListener: (t) => { delete listeners[t]; },
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    navigation: nav ? { addEventListener: (t, f) => { navListeners[t] = f; }, removeEventListener: (t) => { delete navListeners[t]; } } : undefined,
  };
  const doc = { defaultView: win, querySelector: () => (editor ? fakeEditorEl : null) };
  const opened = [];
  const dispose = installRegionLanding({
    doc, win, api: { graph: { name: graph }, ...(mainWindow ? { ui: { mainWindow } } : {}) },
    host: { pullBlock: (uid) => (uid in strings ? { string: strings[uid] } : null) },
    getSettings: () => ({ regionLanding: enabled }),
    openRegion: async (uid) => { opened.push(uid); },
  });
  const go = async (next, type) => {
    win.location.hash = next;
    navListeners.navigate?.({ navigationType: type });
    listeners.hashchange?.();
    await tick();
  };
  return { opened, go, dispose, listeners, navListeners };
}
const R = { reg000001: REGION };

test("landing opens a region on a fresh load, once", async () => {
  const l = landing({ hash: "#/app/Readwisenotes/page/reg000001", strings: R });
  await tick();
  assert.deepEqual(l.opened, ["reg000001"]);
  await l.go("#/app/Readwisenotes/page/reg000001", "reload");
  assert.deepEqual(l.opened, ["reg000001"]);
});

test("landing skips a stale page, another graph, a plain block and a disabled setting", async () => {
  for (const cfg of [
    { hash: "#/app/Readwisenotes/page/reg000001", now: 60000 },
    { hash: "#/app/Other/page/reg000001" },
    { hash: "#/app/Readwisenotes/page/plain0001", strings: { plain0001: "hi" } },
    { hash: "#/app/Readwisenotes/page/reg000001", enabled: false },
    { hash: "#/app/Readwisenotes/page/reg000001", editor: true },
    { hash: "#/app/Readwisenotes" },
  ]) {
    const l = landing({ strings: R, ...cfg });
    await tick();
    assert.deepEqual(l.opened, [], JSON.stringify(cfg));
  }
});

test("landing accepts the offline route and an encoded graph name", async () => {
  const l = landing({ hash: "#/offline/My%20Graph/page/reg000001", graph: "My Graph", strings: R });
  await tick();
  assert.deepEqual(l.opened, ["reg000001"]);
});

test("push and replace navigations land; a traverse never does, and a later push lands again", async () => {
  const l = landing({ strings: R });
  const H = "#/app/Readwisenotes/page/reg000001";
  await l.go(H, "push");
  assert.deepEqual(l.opened, ["reg000001"]);
  await l.go("#/app/Readwisenotes/page/drawing01", "push");
  await l.go(H, "traverse");
  assert.deepEqual(l.opened, ["reg000001"]);
  await l.go("#/app/Readwisenotes/page/other0001", "push");
  await l.go(H, "push");
  assert.deepEqual(l.opened, ["reg000001", "reg000001"]);
  await l.go("#/app/Readwisenotes/page/other0002", "push");
  await l.go(H, "replace");
  assert.equal(l.opened.length, 3);
});

test("without the Navigation API only the fresh-load check lands; hashchange never re-lands on Back", async () => {
  const H = "#/app/Readwisenotes/page/reg000001";
  const l = landing({ strings: R, nav: false, hash: H });
  await tick();
  assert.deepEqual(l.opened, ["reg000001"]);
  await l.go("#/app/Readwisenotes/page/drawing01");
  await l.go(H);
  await l.go(H);
  assert.deepEqual(l.opened, ["reg000001"]);
  const stale = landing({ strings: R, nav: false, now: 60000 });
  await stale.go(H);
  assert.deepEqual(stale.opened, []);
});

test("audit Open goes through the region only for rows whose region still frames; unsupported and no-owner open the block", () => {
  assert.deepEqual(auditOpenTarget({ uid: "r1", problem: "partial", drawingUid: "d1" }), { via: "region", uid: "r1" });
  assert.deepEqual(auditOpenTarget({ uid: "r1", problem: "unsupported" }), { via: "block", uid: "r1" });
  assert.deepEqual(auditOpenTarget({ uid: "r1", problem: "no-owner", drawingUid: "gone" }), { via: "block", uid: "r1" });
  assert.deepEqual(auditOpenTarget({ uid: "c1", kind: "container", problem: "orphan-container", drawingUid: "d1" }), { via: "block", uid: "d1" });
  assert.deepEqual(auditOpenTarget({ uid: "c1", kind: "container", problem: "orphan-container" }), { via: "block", uid: "c1" });
});

test("audit dialog says when the scan was truncated, including after update", () => {
  const doc = auditDoc();
  const rows = [...ROWS];
  Object.defineProperty(rows, "truncated", { value: true, enumerable: false });
  const h = openAuditDialog({ doc, rows });
  const d = doc.body.children[0];
  assert.equal(byText(d, "3 problems (scan stopped at 2000 rows; some regions were not checked)").length, 1);
  const next = [ROWS[0]];
  Object.defineProperty(next, "truncated", { value: true, enumerable: false });
  h.update(next);
  assert.equal(byText(d, "1 problem (scan stopped at 2000 rows; some regions were not checked)").length, 1);
});

test("landing dispose removes its listeners; a failing openRegion is logged, not thrown", async () => {
  const l = landing({ strings: R });
  l.dispose();
  assert.deepEqual(Object.keys(l.listeners), []);
  assert.deepEqual(Object.keys(l.navListeners), []);
  const win = { location: { hash: "#/app/G/page/reg000001" }, performance: { now: () => 1 }, addEventListener() {}, removeEventListener() {} };
  const warn = console.warn; let warned = 0; console.warn = () => { warned += 1; };
  try {
    installRegionLanding({
      doc: { defaultView: win, querySelector: () => null }, win, api: { graph: { name: "G" } },
      host: { pullBlock: () => ({ string: REGION }) }, getSettings: () => ({ regionLanding: true }),
      openRegion: async () => { throw new Error("nope"); },
    });
    await tick();
  } finally { console.warn = warn; }
  assert.equal(warned, 1);
});

// ---- audit dialog ----

function node(tag) {
  const n = {
    tag, children: [], handlers: {}, attrs: {}, className: "", disabled: false, removed: false, textContent: "",
    append(...c) { this.children.push(...c); },
    replaceChildren(...c) { this.children = c; },
    addEventListener(t, f) { this.handlers[t] = f; },
    removeEventListener(t) { delete this.handlers[t]; },
    setAttribute(k, v) { this.attrs[k] = v; },
    remove() { this.removed = true; },
  };
  Object.defineProperty(n, "innerHTML", { set() { throw new Error("innerHTML is forbidden"); } });
  return n;
}
function auditDoc(clip = []) {
  const body = { children: [], append(x) { this.children.push(x); } };
  return {
    body,
    defaultView: { navigator: { clipboard: { writeText: async (t) => { clip.push(t); } } } },
    createElement: (tag) => {
      const n = node(tag);
      if (tag === "dialog") { n.showModal = () => { n.modal = true; }; n.close = () => { n.closedCalled = true; }; }
      return n;
    },
  };
}
const flat = (n) => [n, ...(n.children || []).flatMap((c) => (typeof c === "object" ? flat(c) : []))];
const byText = (root, text) => flat(root).filter((n) => n.textContent === text);
const ROWS = [
  { uid: "reg000001", kind: "area", problem: "partial", detail: "1 of 2 missing", drawingUid: "abc123XYZ", label: "Area 1", pageTitle: "Page A", repair: "auto" },
  { uid: "reg000002", kind: "cframe", problem: "not-frame", drawingUid: "abc123XYZ", label: "Frame 2", pageTitle: "Page A", repair: "reselect" },
  { uid: "reg000003", kind: "area", problem: "unsupported", drawingUid: "zzz123XYZ", label: "Area 3", pageTitle: "Page B", repair: null },
];

test("audit dialog groups by page then drawing and shows label, problem and detail; Repair only where offered", () => {
  const doc = auditDoc();
  openAuditDialog({ doc, rows: ROWS });
  const d = doc.body.children[0];
  assert.equal(d.modal, true);
  const texts = flat(d).map((n) => n.textContent).filter(Boolean);
  assert.ok(texts.includes("3 problems"));
  assert.ok(texts.includes("Page A") && texts.includes("Page B"));
  assert.ok(texts.includes("Some elements are missing") && texts.includes("1 of 2 missing"));
  assert.ok(texts.indexOf("Page A") < texts.indexOf("Area 1") && texts.indexOf("Area 3") > texts.indexOf("Page B"));
  assert.equal(byText(d, "Repair").length, 2);
  assert.equal(byText(d, "Open").length, 3);
});

test("audit dialog empty state and the 500-row cap", () => {
  const doc = auditDoc();
  openAuditDialog({ doc, rows: [] });
  assert.ok(byText(doc.body.children[0], "No problems found").length === 1);
  const many = Array.from({ length: 503 }, (_, i) => ({ uid: `r${i}`, problem: "unsupported", label: `R${i}`, pageTitle: "P" }));
  const doc2 = auditDoc();
  openAuditDialog({ doc: doc2, rows: many });
  const d = doc2.body.children[0];
  assert.equal(byText(d, "Open").length, 500);
  assert.equal(byText(d, "+3 more").length, 1);
});

test("Open closes the dialog before calling onOpen", () => {
  const doc = auditDoc();
  const log = [];
  openAuditDialog({ doc, rows: ROWS, onOpen: (r) => log.push(["open", r.uid, doc.body.children[0].removed]), onClose: () => log.push(["closed"]) });
  byText(doc.body.children[0], "Open")[0].handlers.click({});
  assert.deepEqual(log, [["closed"], ["open", "reg000001", true]]);
});

test("Repair keeps the dialog open and reports Fixed; a reselect row closes it", async () => {
  const doc = auditDoc();
  const repaired = [];
  let closes = 0;
  openAuditDialog({ doc, rows: ROWS, onRepair: async (r) => { repaired.push(r.uid); return { fixed: r.uid === "reg000001", reason: r.repair === "reselect" ? "reselect" : undefined }; }, onClose: () => { closes += 1; } });
  const d = doc.body.children[0];
  byText(d, "Repair")[0].handlers.click({});
  await tick();
  assert.equal(closes, 0);
  assert.ok(byText(d, "Fixed").length === 1);
  byText(d, "Repair")[1].handlers.click({});
  await tick();
  assert.deepEqual(repaired, ["reg000001", "reg000002"]);
  assert.equal(closes, 1);
  assert.equal(d.removed, true);
});

test("Copy report writes JSON; Close, cancel and close events end the dialog once; update re-renders", async () => {
  const clip = [];
  const doc = auditDoc(clip);
  let closes = 0;
  const h = openAuditDialog({ doc, rows: ROWS, onClose: () => { closes += 1; } });
  const d = doc.body.children[0];
  byText(d, "Copy report")[0].handlers.click({});
  await tick();
  assert.deepEqual(JSON.parse(clip[0]).map((r) => r.uid), ["reg000001", "reg000002", "reg000003"]);
  h.update([ROWS[0]]);
  assert.ok(byText(d, "1 problem").length === 1);
  assert.equal(byText(d, "Open").length, 1);
  d.handlers.cancel();
  d.handlers.close?.();
  h.close();
  assert.equal(closes, 1);
  assert.equal(d.closedCalled, true);
  assert.equal(d.removed, true);
  assert.doesNotThrow(() => h.update(ROWS));
});

test("audit dialog stops key and pointer events from reaching Roam and never uses innerHTML", () => {
  const doc = auditDoc();
  openAuditDialog({ doc, rows: ROWS });
  const d = doc.body.children[0];
  for (const t of ["keydown", "pointerdown", "wheel", "click"]) {
    let stopped = false;
    d.handlers[t]({ stopPropagation: () => { stopped = true; } });
    assert.equal(stopped, true, t);
  }
});

test("landing waits for Roam to show the region before opening, and drops it if the user moved on", async () => {
  let open = "someother";
  const l = landing({ strings: R, mainWindow: { getOpenPageOrBlockUid: async () => open } });
  await l.go("#/app/Readwisenotes/page/reg000001", "push");
  assert.deepEqual(l.opened, [], "not opened while Roam still shows another page");
  open = "reg000001";
  await new Promise((r) => setTimeout(r, 250));
  assert.deepEqual(l.opened, ["reg000001"]);

  let open2 = "someother";
  const l2 = landing({ strings: R, mainWindow: { getOpenPageOrBlockUid: async () => open2 } });
  await l2.go("#/app/Readwisenotes/page/reg000001", "push");
  await l2.go("#/app/Readwisenotes/page/other0001", "push");
  open2 = "reg000001";
  await new Promise((r) => setTimeout(r, 250));
  assert.deepEqual(l2.opened, [], "hash moved on before Roam settled");
});
