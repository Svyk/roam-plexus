import test from "node:test";
import assert from "node:assert/strict";
import { createMindMap } from "../src/view/mindmap.js";
import { applyOps, makeSizer, nodeId, patchMarker, reconcile, mmOf } from "../src/model/mmsync.js";
import { treeFromPull } from "../src/model/mindmap.js";

const measure = (s, fs) => s.length * fs * 0.5;
const sizes = makeSizer(measure);
const blk = (uid, string, children = [], extra = {}) => ({ ":block/uid": uid, ":block/string": string, ":block/order": 0, ":block/children": children.map((c, i) => ({ ...c, ":block/order": i })), ...extra });

function rawTree() {
  return blk("R", "Root", [blk("a", "Alpha", [blk("a1", "Alpha one")]), blk("b", "Beta")]);
}

function setup({ raw = rawTree(), state = {}, mmOpts = {}, mountOpts = {} } = {}) {
  const rafQ = [];
  const raf = (fn) => { rafQ.push(fn); return rafQ.length; };
  const caf = (id) => { rafQ[id - 1] = null; };
  const flush = () => { for (let n = 0; n < 5; n++) { const q = rafQ.splice(0); for (const fn of q) fn?.(); } };
  const toasts = [];
  const toaster = { show: (m, o) => toasts.push(m) };
  const tree0 = treeFromPull(raw, {});
  let elements = applyOps([], reconcile({ elements: [], tree: tree0, sizes, textOf: (u, n) => n.string, layout: "right" }));
  const listeners = { change: new Set(), up: new Set(), down: new Set(), scroll: new Set() };
  const app = {
    state: { cursorButton: "up", selectedElementIds: {}, isLoading: false, zoom: { value: 1 }, scrollX: 0, scrollY: 0, width: 1000, height: 800, offsetLeft: 0, offsetTop: 0, ...state },
    scene: { nonce: 1, getSceneNonce() { return this.nonce; } },
    getSceneElementsIncludingDeleted: () => elements,
    updateScene(u) {
      if (u.elements) { elements = u.elements; app.scene.nonce += 1; }
      if (u.appState) app.state = { ...app.state, ...u.appState };
      app.updates = (app.updates || 0) + 1;
    },
    onChangeEmitter: { on: (cb) => { listeners.change.add(cb); return () => listeners.change.delete(cb); } },
    onScrollChangeEmitter: { on: (cb) => { listeners.scroll.add(cb); return () => listeners.scroll.delete(cb); } },
    onPointerDownEmitter: { on: (cb) => { listeners.down.add(cb); return () => listeners.down.delete(cb); } },
    onPointerUpEmitter: { on: (cb) => { listeners.up.add(cb); return () => listeners.up.delete(cb); } },
    updates: 0,
  };
  const containerListeners = [];
  const containerEl = {
    addEventListener: (t, fn, o) => containerListeners.push([t, fn, o]),
    removeEventListener: (t, fn) => { const i = containerListeners.findIndex(([tt, f]) => tt === t && f === fn); if (i >= 0) containerListeners.splice(i, 1); },
    focus() { containerEl.focused = true; },
  };
  const body = { children: [], append(el) { this.children.push(el); } };
  const docListeners = [];
  const viewListeners = [];
  const reg = (list) => (t, fn) => list.push([t, fn]);
  const unreg = (list) => (t, fn) => { const i = list.findIndex(([tt, f]) => tt === t && f === fn); if (i >= 0) list.splice(i, 1); };
  const doc = {
    body,
    visibilityState: "visible",
    addEventListener: reg(docListeners),
    removeEventListener: unreg(docListeners),
    defaultView: { addEventListener: reg(viewListeners), removeEventListener: unreg(viewListeners) },
    createElement: () => {
      const l = [];
      const el = {
        style: {}, value: "", className: "",
        addEventListener: (t, fn) => l.push([t, fn]),
        removeEventListener: (t, fn) => { const i = l.findIndex(([tt, f]) => tt === t && f === fn); if (i >= 0) l.splice(i, 1); },
        remove() { const i = body.children.indexOf(el); if (i >= 0) body.children.splice(i, 1); },
        focus() {}, select() {}, listeners: l,
        fire(t, ev = {}) { const e = { stopPropagation() { e.stopped = true; }, preventDefault() {}, ...ev }; for (const [tt, f] of [...l]) if (tt === t) f(e); return e; },
      };
      return el;
    },
  };
  const watches = new Map();
  const calls = [];
  const writer = {
    pullTree: (uid) => { const st = [raw]; while (st.length) { const n = st.pop(); if (n[":block/uid"] === uid) return n; st.push(...(n[":block/children"] || [])); } return null; },
    watchTree: (uid, cb) => { const rec = { uid, cb, live: true }; watches.set(uid, rec); return () => { rec.live = false; }; },
    createChild: async (...a) => { calls.push(["createChild", ...a]); return { ok: true }; },
    createSiblingAfter: async (...a) => { calls.push(["createSiblingAfter", ...a]); return { ok: true }; },
    updateString: async (...a) => { calls.push(["updateString", ...a]); return { ok: true, written: true }; },
    setOpen: async (...a) => { calls.push(["setOpen", ...a]); return { ok: true }; },
    moveBranch: async (...a) => { calls.push(["moveBranch", ...a]); return { ok: true }; },
    copyBranch: async (...a) => { calls.push(["copyBranch", ...a]); return { ok: true }; },
    deleteBranch: async (...a) => { calls.push(["deleteBranch", ...a]); return { ok: true, count: 2 }; },
    moveTo: async (...a) => { calls.push(["moveTo", ...a]); return { ok: true }; },
    discardPlaceholder: async (...a) => { calls.push(["discardPlaceholder", ...a]); return { ok: true }; },
  };
  const api = {
    util: { generateUID: (() => { let n = 0; return () => `gen${++n}xxxx`; })() },
    data: { pull: () => ({}) },
  };
  const native = {
    activeEditor: () => ({ app }),
    selectedElementIds: (a) => Object.keys(a.state.selectedElementIds).filter((k) => a.state.selectedElementIds[k]),
    viewportRectOf: () => ({ left: 10, top: 20, width: 100, height: 40 }),
    zoomTo() {},
  };
  const measurer = { measure, ensureFonts: async () => false, clear() {} };
  const mm = createMindMap({ doc, api, writer, measurer, native, toaster, raf, caf, now: () => Date.now(), ...mmOpts });
  const unmount = mm.mount({ app, containerEl, outerEl: null, zIndex: 100, ...mountOpts });
  flush();
  const key = (init) => {
    const e = { code: "", key: "", altKey: false, metaKey: false, ctrlKey: false, shiftKey: false, repeat: false, isComposing: false, keyCode: 0, target: containerEl, defaultPrevented: false, preventDefault() { e.defaultPrevented = true; }, stopImmediatePropagation() {}, ...init };
    for (const [t, fn] of [...containerListeners]) if (t === "keydown") fn(e);
    return e;
  };
  const select = (uid) => { app.state.selectedElementIds = { [nodeId("R", uid)]: true }; };
  const live = () => elements.filter((e) => !e.isDeleted);
  const el = (uid) => elements.find((e) => e.id === nodeId("R", uid));
  const fireDoc = (type, ev = {}) => { for (const [t, fn] of [...docListeners]) if (t === type) fn(ev); };
  return { native, fireDoc, docListeners, viewListeners, mm, app, key, select, flush, toasts, calls, watches, listeners, containerListeners, doc, unmount, el, live, elements: () => elements, setElements: (e) => { elements = e; app.scene.nonce += 1; }, fireChange: () => { for (const cb of [...listeners.change]) cb(); }, writer };
}

const tab = { code: "Tab", key: "Tab" };
const tool = { type: "selection" };
const dragOf = (t, uid, to, { hasBeenDuplicated = false, meta = false, moveBy = 0 } = {}) => {
  const id = nodeId("R", uid);
  const from = t.el(uid);
  t.select(uid);
  const hit = { element: from, hasBeenDuplicated };
  for (const cb of [...t.listeners.down]) cb(tool, { hit, drag: { hasOccurred: false } }, { clientX: from.x + 5, clientY: from.y + 5 });
  t.setElements(t.elements().map((e) => (e.id === id ? { ...e, x: e.x + moveBy, version: e.version + 1 } : e)));
  return {
    move: (x, y) => t.fireDoc("pointermove", { clientX: x, clientY: y }),
    up: () => { for (const cb of [...t.listeners.up]) cb(tool, { hit, drag: { hasOccurred: true } }, { clientX: to.x, clientY: to.y, metaKey: meta }); },
  };
};
const centre = (t, uid) => { const e = t.el(uid); return { x: e.x + e.width / 2, y: e.y + e.height / 2 }; };

test("a drop on another node reparents it as the last child; the move is queued, the node is not pinned", async () => {
  const t = setup();
  const d = dragOf(t, "a1", centre(t, "b"), { moveBy: 200 });
  d.up();
  t.flush();
  assert.deepEqual(t.calls.at(-1), ["moveTo", "R", "a1", { parentUid: "b" }]);
  assert.notEqual(mmOf(t.el("a1")).pinned, true);
  const tree = t.writer.pullTree("R");
  assert.ok(tree);
  await Promise.resolve();
});

test("a drop in the gap between siblings reorders; a drop past the last sibling goes after it", () => {
  const raw = blk("R", "Root", [blk("a", "Alpha"), blk("b", "Beta"), blk("c", "Gamma")]);
  const t = setup({ raw });
  const a = t.el("a");
  const b = t.el("b");
  const gap = { x: a.x + a.width / 2, y: (a.y + a.height + b.y) / 2 };
  dragOf(t, "c", gap, { moveBy: 0 }).up();
  t.flush();
  assert.deepEqual(t.calls.at(-1), ["moveTo", "R", "c", { parentUid: "R", beforeUid: "b" }]);
  const t2 = setup({ raw });
  const c = t2.el("c");
  dragOf(t2, "a", { x: c.x + c.width / 2, y: c.y + c.height + 12 }).up();
  t2.flush();
  assert.deepEqual(t2.calls.at(-1), ["moveTo", "R", "a", { parentUid: "R", afterUid: "c" }]);
});

test("Cmd at release pins instead of moving; a drop outside every zone pins; Esc during the drag ends it", () => {
  const t = setup();
  dragOf(t, "b", centre(t, "a1"), { meta: true, moveBy: 60 }).up();
  t.flush();
  assert.equal(t.calls.filter((c) => c[0] === "moveTo").length, 0);
  assert.equal(mmOf(t.el("b")).pinned, true);
  const t2 = setup();
  dragOf(t2, "b", { x: 900, y: 700 }, { moveBy: 500 }).up();
  t2.flush();
  assert.equal(t2.calls.filter((c) => c[0] === "moveTo").length, 0);
  assert.equal(mmOf(t2.el("b")).pinned, true);
  const t3 = setup();
  const d = dragOf(t3, "b", centre(t3, "a"), { moveBy: 0 });
  t3.fireDoc("keydown", { key: "Escape" });
  d.up();
  t3.flush();
  assert.equal(t3.calls.filter((c) => c[0] === "moveTo").length, 0);
});

test("a duplicating drag, a resize and view mode never move blocks", () => {
  const t = setup();
  dragOf(t, "b", centre(t, "a"), { hasBeenDuplicated: true }).up();
  t.flush();
  assert.equal(t.calls.filter((c) => c[0] === "moveTo").length, 0);
  const t2 = setup({ state: { viewModeEnabled: true } });
  dragOf(t2, "b", centre(t2, "a")).up();
  t2.flush();
  assert.equal(t2.calls.filter((c) => c[0] === "moveTo").length, 0);
});

test("dropping a branch into its own subtree snaps back with a toast and pins nothing", () => {
  const t = setup();
  dragOf(t, "a", centre(t, "a1"), { moveBy: 0 }).up();
  t.flush();
  assert.ok(t.toasts.includes("Cannot move a branch into itself"));
  assert.equal(t.calls.filter((c) => c[0] === "moveTo").length, 0);
  assert.notEqual(mmOf(t.el("a")).pinned, true);
});

test("a pinned node dropped into a sibling gap reorders using the plan from drag start and clears the pin", () => {
  const raw = blk("R", "Root", [blk("a", "Alpha"), blk("b", "Beta"), blk("c", "Gamma")]);
  const t = setup({ raw });
  t.setElements(t.elements().map((e) => (e.id === nodeId("R", "c") ? patchMarker(e, { pinned: true }) : e)));
  t.setElements(applyOps(t.elements(), reconcile({ elements: t.elements(), tree: treeFromPull(raw, {}), sizes, textOf: (u, n) => n.string, layout: "right" })));
  const a = t.el("a");
  const b = t.el("b");
  const gap = { x: a.x + a.width / 2, y: (a.y + a.height + b.y) / 2 };
  const d = dragOf(t, "c", gap, { moveBy: 0 });
  d.move(gap.x, gap.y);
  t.flush();
  t.setElements(t.elements().map((e) => (e.id === nodeId("R", "c") ? { ...e, x: gap.x - e.width / 2, y: gap.y - e.height / 2, version: e.version + 1 } : e)));
  d.up();
  t.flush();
  assert.deepEqual(t.calls.at(-1), ["moveTo", "R", "c", { parentUid: "R", beforeUid: "b" }]);
  assert.notEqual(mmOf(t.el("c")).pinned, true);
});

test("a short nudge inside the node's own box pins it instead of snapping back", () => {
  const t = setup();
  dragOf(t, "b", centre(t, "b"), { moveBy: 20 }).up();
  t.flush();
  assert.equal(t.calls.filter((c) => c[0] === "moveTo").length, 0);
  assert.equal(mmOf(t.el("b")).pinned, true);
});

test("a throw while drawing the drag ring ends the drag without escaping", () => {
  const t = setup();
  const ringCount = () => t.doc.body.children.filter((c) => /plexus-mm-ring/.test(c.className)).length;
  const before = t.docListeners.length;
  const d = dragOf(t, "a1", centre(t, "b"), { moveBy: 200 });
  t.native.viewportRectOf = () => { throw new Error("detached"); };
  const b = centre(t, "b");
  d.move(b.x, b.y);
  assert.doesNotThrow(() => t.flush());
  assert.equal(ringCount(), 0);
  assert.equal(t.docListeners.length, before);
});

test("the drop is recorded in the emitter and written only in the next pass", () => {
  const t = setup();
  const before = t.app.updates;
  dragOf(t, "a1", centre(t, "b"), { moveBy: 200 }).up();
  assert.equal(t.calls.filter((c) => c[0] === "moveTo").length, 0);
  assert.equal(t.app.updates, before);
  t.flush();
  assert.equal(t.calls.filter((c) => c[0] === "moveTo").length, 1);
});

test("a failed move refreshes from the outline and toasts", async () => {
  const t = setup();
  t.writer.moveTo = async () => { throw new Error("boom"); };
  dragOf(t, "a1", centre(t, "b"), { moveBy: 200 }).up();
  t.flush();
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(t.toasts.includes("Could not update the outline"));
});

test("the drag ring exists only during a drag and is removed on release, cancel and dispose", () => {
  const t = setup();
  const ringCount = () => t.doc.body.children.filter((c) => /plexus-mm-ring/.test(c.className)).length;
  assert.equal(t.docListeners.length >= 1, true);
  const before = t.docListeners.length;
  const d = dragOf(t, "a1", centre(t, "b"), { moveBy: 200 });
  assert.ok(t.docListeners.length > before);
  const b = centre(t, "b");
  d.move(b.x, b.y);
  t.flush();
  assert.equal(ringCount(), 1);
  d.up();
  assert.equal(ringCount(), 0);
  assert.equal(t.docListeners.length, before);
  const d2 = dragOf(t, "a1", centre(t, "b"));
  d2.move(b.x, b.y);
  t.flush();
  assert.equal(ringCount(), 1);
  t.unmount();
  assert.equal(ringCount(), 0);
  assert.equal(t.docListeners.length, 0);
});

test("no listener is attached outside a drag, and a press away from a map node attaches none", () => {
  const t = setup();
  const before = t.docListeners.length;
  for (const cb of [...t.listeners.down]) cb(tool, { hit: { element: { id: "free", type: "rectangle" } } }, { clientX: 1, clientY: 1 });
  for (const cb of [...t.listeners.down]) cb(tool, { hit: { element: t.el("R") } }, { clientX: 1, clientY: 1 });
  assert.equal(t.docListeners.length, before);
});

test("Alt+Shift+Down and Up reorder among block siblings; the ends and repeats write nothing", () => {
  const raw = blk("R", "Root", [blk("a", "Alpha"), blk("b", "Beta"), blk("c", "Gamma")]);
  const down = { code: "ArrowDown", key: "ArrowDown", altKey: true, shiftKey: true };
  const up = { code: "ArrowUp", key: "ArrowUp", altKey: true, shiftKey: true };
  const t = setup({ raw });
  t.select("a");
  const e = t.key(down);
  assert.equal(e.defaultPrevented, true);
  assert.deepEqual(t.calls.at(-1), ["moveTo", "R", "a", { parentUid: "R", afterUid: "b" }]);
  const t2 = setup({ raw });
  t2.select("c");
  t2.key({ ...up, repeat: true });
  assert.equal(t2.key(down).defaultPrevented, true);
  t2.select("a");
  assert.equal(t2.key(up).defaultPrevented, true);
  assert.equal(t2.calls.length, 0);
  t2.select("c");
  t2.key(up);
  assert.deepEqual(t2.calls.at(-1), ["moveTo", "R", "c", { parentUid: "R", beforeUid: "b" }]);
});

test("Shift+Tab selects the parent; on the root it is swallowed and does nothing", () => {
  const t = setup();
  t.select("a1");
  const e = t.key({ code: "Tab", key: "Tab", shiftKey: true });
  assert.equal(e.defaultPrevented, true);
  assert.deepEqual(Object.keys(t.app.state.selectedElementIds), [nodeId("R", "a")]);
  t.select("R");
  const r = t.key({ code: "Tab", key: "Tab", shiftKey: true });
  assert.equal(r.defaultPrevented, true);
  assert.deepEqual(Object.keys(t.app.state.selectedElementIds), [nodeId("R", "R")]);
  assert.equal(t.calls.length, 0);
});

test("Backspace deletes only a placeholder created this session in the last 30 s", () => {
  let clock = 1000;
  const t = setup({ mmOpts: { now: () => clock } });
  t.select("b");
  t.key(tab);
  const uid = t.calls.at(-1)[3].uid;
  t.doc.body.children[0].fire("blur");
  const bs = { code: "Backspace", key: "Backspace" };
  clock += 31000;
  const late = t.key(bs);
  assert.equal(late.defaultPrevented, false);
  assert.equal(t.calls.at(-1)[0], "createChild");
  clock = 1000 + 5000;
  const e = t.key(bs);
  assert.equal(e.defaultPrevented, true);
  assert.deepEqual(t.calls.at(-1), ["discardPlaceholder", "R", uid, "New idea"]);
  t.select("a");
  const n = t.calls.length;
  assert.equal(t.key(bs).defaultPrevented, false);
  assert.equal(t.calls.length, n);
});

test("Backspace leaves an edited new node and a node with children alone", () => {
  const t = setup();
  t.select("b");
  t.key(tab);
  const uid = t.calls.at(-1)[3].uid;
  const input = t.doc.body.children[0];
  input.value = "Named";
  input.fire("blur");
  t.select("b");
  t.key({ code: "Backspace", key: "Backspace" });
  assert.equal(t.calls.at(-1)[0], "updateString");
  assert.equal(t.calls.filter((c) => c[0] === "discardPlaceholder").length, 0);
  assert.ok(uid);
});

const TODO = "{{[[TODO]]}}";
const DONE = "{{[[DONE]]}}";
const altEnter = { code: "Enter", key: "Enter", altKey: true };

test("Alt+Enter toggles TODO and DONE with a prefix-only string write and swallows Enter", () => {
  const raw = blk("R", "Root", [blk("a", `${TODO} Task one`), blk("b", `${DONE} Done one`), blk("c", "Plain")]);
  const t = setup({ raw });
  t.select("a");
  const e = t.key(altEnter);
  assert.equal(e.defaultPrevented, true);
  assert.deepEqual(t.calls.at(-1), ["updateString", "R", "a", `${DONE} Task one`, `${TODO} Task one`]);
  t.select("b");
  t.key(altEnter);
  assert.deepEqual(t.calls.at(-1), ["updateString", "R", "b", `${TODO} Done one`, `${DONE} Done one`]);
  t.select("c");
  t.key(altEnter);
  assert.deepEqual(t.calls.at(-1), ["updateString", "R", "c", `${TODO} Plain`, "Plain"]);
  const n = t.calls.length;
  t.key({ ...altEnter, repeat: true });
  assert.equal(t.calls.length, n);
});

test("Alt+Enter does nothing in view mode but is still swallowed", () => {
  const t = setup({ state: { viewModeEnabled: true } });
  t.select("a");
  const e = t.key(altEnter);
  assert.equal(e.defaultPrevented, true);
  assert.equal(t.calls.length, 0);
});

test("F2 on a task edits the text after the macro and writes the prefix back; an empty value writes nothing", () => {
  const raw = blk("R", "Root", [blk("a", `${TODO} Task one`), blk("m", `${TODO} See [[Page]]`)]);
  const t = setup({ raw });
  t.select("a");
  t.key({ code: "F2", key: "F2" });
  const input = t.doc.body.children[0];
  assert.equal(input.value, "Task one");
  input.value = "Task two";
  input.fire("keydown", { key: "Enter" });
  assert.deepEqual(t.calls.at(-1), ["updateString", "R", "a", `${TODO} Task two`, `${TODO} Task one`]);
  t.select("a");
  t.key({ code: "F2", key: "F2" });
  const again = t.doc.body.children[0];
  again.value = "";
  again.fire("keydown", { key: "Enter" });
  assert.equal(t.calls.filter((c) => c[0] === "updateString").length, 1);
  t.select("m");
  t.key({ code: "F2", key: "F2" });
  assert.equal(t.doc.body.children.length, 0);
  assert.ok(t.toasts.some((m) => /Edit this node in the outline/.test(m)));
});

test("a native edit of a task node strips the glyph and keeps the prefix", () => {
  const raw = blk("R", "Root", [blk("a", `${TODO} Task one`)]);
  const t = setup({ raw });
  const container = t.el("a");
  const txt = t.elements().find((e) => e.containerId === container.id);
  assert.match(txt.originalText, /^☐ /);
  t.app.state.editingTextElement = { id: txt.id };
  t.fireChange();
  t.flush();
  t.setElements(t.elements().map((e) => (e.id === txt.id ? { ...e, text: "☐ Task 1b", originalText: "☐ Task 1b", version: e.version + 1 } : e)));
  t.app.state.editingTextElement = null;
  t.fireChange();
  t.flush();
  assert.deepEqual(t.calls.at(-1), ["updateString", "R", "a", `${TODO} Task 1b`, `${TODO} Task one`]);
});

test("Ctrl/Cmd+Alt+Arrow selects the neighbour and always centres it, without reaching Excalidraw", () => {
  const t = setup();
  t.select("R");
  const e = t.key({ code: "ArrowRight", key: "ArrowRight", metaKey: true, altKey: true });
  assert.equal(e.defaultPrevented, true);
  const sel = Object.keys(t.app.state.selectedElementIds);
  assert.equal(sel.length, 1);
  assert.notEqual(sel[0], nodeId("R", "R"));
  const target = t.live().find((x) => x.id === sel[0]);
  assert.equal(t.app.state.scrollX, 500 - (target.x + target.width / 2));
  t.key({ code: "ArrowRight", key: "ArrowRight", ctrlKey: true, altKey: true, repeat: true });
  assert.equal(t.calls.length, 0);
});

test("mapOptions, setLayout and setAttrEdges act on the selected node's map through one commit each", () => {
  const t = setup();
  assert.equal(t.mm.mapOptions(t.app), null);
  t.select("a");
  assert.deepEqual(t.mm.mapOptions(t.app), { root: "R", layout: "right", attrEdges: false });
  const before = t.app.updates;
  assert.equal(t.mm.setLayout(t.app, "cause"), true);
  assert.equal(t.app.updates, before + 1);
  assert.equal(mmOf(t.el("R")).layout, "cause");
  assert.ok(t.toasts.some((m) => /Layout: cause.*choose again to change back/.test(m)));
  assert.equal(t.mm.setLayout(t.app, "spiral"), false);
  assert.equal(mmOf(t.el("R")).layout, "cause");
  assert.equal(t.mm.setAttrEdges(t.app, true), true);
  assert.equal(mmOf(t.el("R")).attrEdges, true);
  assert.equal(t.mm.mapOptions(t.app).attrEdges, true);
  t.mm.setAttrEdges(t.app, false);
  assert.equal("attrEdges" in mmOf(t.el("R")), false);
  assert.equal(t.calls.length, 0);
  t.key({ code: "KeyL", key: "l", altKey: true });
  assert.equal(mmOf(t.el("R")).layout, "right");
});

test("a new map gets attrEdges on the root; an existing map does not; tag colours come from the getter", () => {
  const seen = [];
  const raw = blk("R", "Root", [blk("a", "Fix #urgent"), blk("b", "Beta")]);
  const t = setup({ raw, mmOpts: { getTagColors: () => { seen.push(1); return new Map([["urgent", "#ff0000"]]); } } });
  assert.notEqual(mmOf(t.el("R")).attrEdges, true);
  assert.ok(seen.length > 0);
  assert.equal(t.el("a").backgroundColor, "#ff0000");
  const uid = t.mm.startRoot({ app: t.app, drawingUid: "D" });
  const rootEl = t.elements().find((e) => e.id === nodeId(uid, uid));
  assert.equal(mmOf(rootEl).attrEdges, true);
});

test("a native edit of an attribute label toasts once and writes nothing", () => {
  const raw = blk("R", "Root", [blk("k", "Cause::", [blk("x", "Kid")]), blk("b", "Beta")]);
  const t = setup({ raw, mmOpts: {} });
  t.select("R");
  t.mm.setAttrEdges(t.app, true);
  const label = t.elements().find((e) => e.type === "text" && !e.isDeleted && e.containerId && e.containerId.endsWith("-e"));
  assert.ok(label);
  t.app.state.editingTextElement = { id: label.id };
  t.fireChange();
  t.flush();
  t.setElements(t.elements().map((e) => (e.id === label.id ? { ...e, text: "Other", originalText: "Other", version: e.version + 1 } : e)));
  t.app.state.editingTextElement = null;
  t.fireChange();
  t.flush();
  assert.equal(t.toasts.filter((m) => m === "Edit the attribute block in the outline").length, 1);
  assert.equal(t.calls.filter((c) => c[0] === "updateString").length, 0);
});
