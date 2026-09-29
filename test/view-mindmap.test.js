import test from "node:test";
import assert from "node:assert/strict";
import { createMindMap } from "../src/view/mindmap.js";
import { applyOps, makeSizer, nodeId, reconcile, mmOf } from "../src/model/mmsync.js";
import { treeFromPull } from "../src/model/mindmap.js";

const measure = (s, fs) => s.length * fs * 0.5;
const sizes = makeSizer(measure);
const blk = (uid, string, children = [], extra = {}) => ({ ":block/uid": uid, ":block/string": string, ":block/order": 0, ":block/children": children.map((c, i) => ({ ...c, ":block/order": i })), ...extra });

function rawTree() {
  return blk("R", "Root", [blk("a", "Alpha", [blk("a1", "Alpha one")]), blk("b", "Beta")]);
}

function setup({ raw = rawTree(), state = {} } = {}) {
  const rafQ = [];
  const raf = (fn) => { rafQ.push(fn); return rafQ.length; };
  const caf = (id) => { rafQ[id - 1] = null; };
  const flush = () => { for (let n = 0; n < 5; n++) { const q = rafQ.splice(0); for (const fn of q) fn?.(); } };
  const toasts = [];
  const toaster = { show: (m, o) => toasts.push(m) };
  const tree0 = treeFromPull(raw, {});
  let elements = applyOps([], reconcile({ elements: [], tree: tree0, sizes, textOf: (u, n) => n.string, layout: "right" }));
  const listeners = { change: new Set(), up: new Set(), scroll: new Set() };
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
  const doc = {
    body,
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
  const mm = createMindMap({ doc, api, writer, measurer, native, toaster, raf, caf, now: () => Date.now() });
  const unmount = mm.mount({ app, containerEl, outerEl: null, zIndex: 100 });
  flush();
  const key = (init) => {
    const e = { code: "", key: "", altKey: false, metaKey: false, ctrlKey: false, shiftKey: false, repeat: false, isComposing: false, keyCode: 0, target: containerEl, defaultPrevented: false, preventDefault() { e.defaultPrevented = true; }, stopImmediatePropagation() {}, ...init };
    for (const [t, fn] of [...containerListeners]) if (t === "keydown") fn(e);
    return e;
  };
  const select = (uid) => { app.state.selectedElementIds = { [nodeId("R", uid)]: true }; };
  const live = () => elements.filter((e) => !e.isDeleted);
  const el = (uid) => elements.find((e) => e.id === nodeId("R", uid));
  return { mm, app, key, select, flush, toasts, calls, watches, listeners, containerListeners, doc, unmount, el, live, elements: () => elements, setElements: (e) => { elements = e; app.scene.nonce += 1; }, fireChange: () => { for (const cb of [...listeners.change]) cb(); }, writer };
}

const tab = { code: "Tab", key: "Tab" };
const enter = { code: "Enter", key: "Enter" };
const altBack = { code: "Backspace", key: "Backspace", altKey: true };

test("mount discovers the root from scene markers, watches it once, and unmount leaves nothing behind", () => {
  const t = setup();
  assert.equal(t.watches.size, 1);
  assert.equal(t.watches.get("R").live, true);
  assert.ok(t.containerListeners.length >= 1);
  assert.ok(t.listeners.change.size >= 1);
  t.unmount();
  assert.equal(t.watches.get("R").live, false);
  assert.equal(t.containerListeners.length, 0);
  assert.equal(t.listeners.change.size + t.listeners.up.size + t.listeners.scroll.size, 0);
  assert.equal(t.doc.body.children.length, 0);
});

test("hotkeys need exactly one selected map node and no text editing", () => {
  const t = setup();
  t.key(tab);
  assert.equal(t.calls.length, 0);
  t.app.state.selectedElementIds = { [nodeId("R", "a")]: true, [nodeId("R", "b")]: true };
  t.key(tab);
  assert.equal(t.calls.length, 0);
  t.select("a");
  t.app.state.editingTextElement = { id: "x" };
  t.key(tab);
  assert.equal(t.calls.length, 0);
  t.app.state.editingTextElement = null;
  const e = t.key({ ...tab, target: {} });
  assert.equal(t.calls.length, 0);
  assert.equal(e.defaultPrevented, false);
  t.key(tab);
  assert.equal(t.calls[0][0], "createChild");
});

test("Tab creates a child with an inline input; Enter commits the new text; blur commits; Esc discards the placeholder", async () => {
  const t = setup();
  t.select("a");
  t.key(tab);
  assert.deepEqual(t.calls[0].slice(0, 3), ["createChild", "R", "a"]);
  assert.equal(t.calls[0][3].string, "New idea");
  assert.equal(t.doc.body.children.length, 1);
  const input = t.doc.body.children[0];
  assert.match(input.className, /plexus-mm-input/);
  const stopped = input.fire("keypress");
  assert.equal(stopped.stopped, true);
  input.value = "Gamma";
  input.fire("keydown", { key: "Enter" });
  assert.equal(t.doc.body.children.length, 0);
  assert.deepEqual(t.calls.at(-1), ["updateString", "R", t.calls[0][3].uid, "Gamma", "New idea"]);

  t.select("b");
  t.key(enter);
  assert.equal(t.calls.at(-1)[0], "createSiblingAfter");
  const i2 = t.doc.body.children[0];
  i2.value = "Delta";
  i2.fire("blur");
  assert.equal(t.calls.at(-1)[3], "Delta");

  t.select("b");
  t.key(tab);
  const i3 = t.doc.body.children[0];
  const uid3 = t.calls.at(-1)[3].uid;
  i3.fire("keydown", { key: "Escape" });
  assert.equal(t.doc.body.children.length, 0);
  assert.deepEqual(t.calls.at(-1), ["discardPlaceholder", "R", uid3, "New idea"]);
});

test("Tab inside the input commits then adds a child; an unchanged commit writes nothing", () => {
  const t = setup();
  t.select("b");
  t.key(tab);
  const uid = t.calls.at(-1)[3].uid;
  const input = t.doc.body.children[0];
  input.value = "Kid";
  input.fire("keydown", { key: "Tab" });
  const names = t.calls.map((c) => c[0]);
  assert.deepEqual(names.slice(-2), ["updateString", "createChild"]);
  assert.equal(t.calls.at(-1)[2], uid);
  const second = t.doc.body.children[0];
  second.fire("blur");
  assert.equal(t.calls.filter((c) => c[0] === "updateString").length, 1);
});

test("Enter on the root adds a last child of the root", () => {
  const t = setup();
  t.select("R");
  t.key(enter);
  assert.equal(t.calls.at(-1)[0], "createChild");
  assert.equal(t.calls.at(-1)[2], "R");
});

test("Alt+Backspace needs two matching presses; a changed selection resets it; the root detaches without writes", async () => {
  const t = setup();
  t.select("a");
  t.key(altBack);
  await new Promise((r) => setImmediate(r));
  assert.equal(t.calls.filter((c) => c[0] === "deleteBranch").length, 0);
  assert.ok(t.toasts.some((m) => /again to delete 2 blocks/.test(m)), t.toasts.join("|"));
  t.select("b");
  t.key(altBack);
  await new Promise((r) => setImmediate(r));
  assert.equal(t.calls.filter((c) => c[0] === "deleteBranch").length, 0);
  t.key(altBack);
  await new Promise((r) => setImmediate(r));
  assert.equal(t.calls.filter((c) => c[0] === "deleteBranch").length, 1);

  t.select("R");
  t.key(altBack);
  await new Promise((r) => setImmediate(r));
  t.key(altBack);
  await new Promise((r) => setImmediate(r));
  assert.equal(t.live().length, 0);
  assert.equal(t.calls.filter((c) => c[0] === "deleteBranch").length, 1);
  assert.equal(t.watches.get("R").live, false);
});

test("a native delete is restored from the outline with a once-per-session toast", () => {
  const t = setup();
  const victim = t.el("b");
  t.setElements(t.elements().map((e) => (e.id === victim.id ? { ...e, isDeleted: true, version: e.version + 1 } : e)));
  t.fireChange();
  t.flush();
  assert.equal(t.el("b").isDeleted, false);
  assert.equal(t.toasts.filter((m) => /Alt\+Backspace deletes a branch/.test(m)).length, 1);
  assert.equal(t.calls.length, 0);
  t.setElements(t.elements().map((e) => (e.id === victim.id ? { ...e, isDeleted: true, version: e.version + 1 } : e)));
  t.fireChange();
  t.flush();
  assert.equal(t.toasts.filter((m) => /Alt\+Backspace deletes a branch/.test(m)).length, 1);
});

test("a native move over 2px pins the node; the root is never pinned; under 2px is ignored", () => {
  const t = setup();
  const move = (uid, dx) => t.setElements(t.elements().map((e) => (e.id === nodeId("R", uid) ? { ...e, x: e.x + dx, version: e.version + 1 } : e)));
  move("a", 1);
  t.fireChange();
  t.flush();
  assert.notEqual(mmOf(t.el("a")).pinned, true);
  move("a", 40);
  t.fireChange();
  t.flush();
  assert.equal(mmOf(t.el("a")).pinned, true);
  assert.notEqual(mmOf(t.el("R")).pinned, true);
  assert.equal(t.calls.length, 0);
});

test("no detector runs while a drag is in progress and zero ops mean zero updateScene", () => {
  const t = setup();
  const before = t.app.updates;
  t.fireChange();
  t.flush();
  assert.equal(t.app.updates, before);
  t.app.state.cursorButton = "down";
  t.setElements(t.elements().map((e) => (e.id === nodeId("R", "a") ? { ...e, x: e.x + 90, version: e.version + 1 } : e)));
  t.fireChange();
  t.flush();
  assert.notEqual(mmOf(t.el("a")).pinned, true);
});

test("a native text edit writes the stripped text; markup-protected nodes revert with a toast", () => {
  const raw = blk("R", "Root", [blk("a", "Alpha"), blk("m", "See [[Page]]")]);
  const t = setup({ raw });
  const edit = (uid, text) => {
    const container = t.el(uid);
    const txt = t.elements().find((e) => e.containerId === container.id);
    t.app.state.editingTextElement = { id: txt.id };
    t.fireChange();
    t.flush();
    t.setElements(t.elements().map((e) => (e.id === txt.id ? { ...e, text, originalText: text, version: e.version + 1 } : e)));
    t.app.state.editingTextElement = null;
    t.fireChange();
    t.flush();
    return txt;
  };
  edit("a", "Alpha edited");
  assert.deepEqual(t.calls.at(-1), ["updateString", "R", "a", "Alpha edited", "Alpha"]);
  const before = t.calls.length;
  const txt = edit("m", "Changed");
  assert.equal(t.calls.length, before);
  assert.ok(t.toasts.some((m) => /Edit this node in the outline/.test(m)));
  assert.equal(t.elements().find((e) => e.id === txt.id).text, "See Page");
});

test("Alt+Arrow selects the neighbour; Cmd+Arrow and Cmd+Z only toast", () => {
  const t = setup();
  t.select("R");
  t.key({ code: "ArrowRight", key: "ArrowRight", altKey: true });
  const sel = Object.keys(t.app.state.selectedElementIds);
  assert.equal(sel.length, 1);
  assert.notEqual(sel[0], nodeId("R", "R"));
  t.key({ code: "ArrowRight", key: "ArrowRight", metaKey: true });
  assert.ok(t.toasts.includes("Use Tab / Enter to grow this map"));
  t.key({ code: "KeyZ", key: "z", metaKey: true });
  assert.ok(t.toasts.includes("Undo mind-map edits in the outline"));
  assert.equal(t.calls.length, 0);
});

test("Alt+F folds via a setOpen-only write; a leaf toasts; view mode blocks writes", async () => {
  const t = setup();
  t.select("a");
  t.key({ code: "KeyF", key: "f", altKey: true });
  assert.deepEqual(t.calls.at(-1), ["setOpen", "R", "a", false]);
  t.select("b");
  t.key({ code: "KeyF", key: "f", altKey: true });
  assert.ok(t.toasts.includes("No children to fold"));
  const n = t.calls.length;
  t.app.state.viewModeEnabled = true;
  t.select("a");
  t.key(tab);
  assert.equal(t.calls.length, n);
});

test("Alt+L cycles the layout on the root marker; composing and repeat keys are ignored", () => {
  const t = setup();
  t.select("a");
  t.key({ code: "KeyL", key: "l", altKey: true });
  assert.equal(mmOf(t.el("R")).layout, "down");
  t.key({ ...tab, isComposing: true });
  t.key({ ...tab, repeat: true });
  assert.equal(t.calls.length, 0);
});

test("dispose closes an open input without writing and removes every listener and watch", () => {
  const t = setup();
  t.select("a");
  t.key(tab);
  const input = t.doc.body.children[0];
  const writes = t.calls.length;
  t.mm.dispose();
  assert.equal(t.doc.body.children.length, 0);
  assert.equal(input.listeners.length, 0);
  assert.equal(t.calls.length, writes);
  assert.equal(t.watches.get("R").live, false);
  assert.equal(t.containerListeners.length, 0);
  assert.equal(t.listeners.change.size, 0);
});

test("dragging only the root pins nothing and the children follow on the next commit", () => {
  const t = setup();
  const ids = new Set([nodeId("R", "R"), `${nodeId("R", "R")}-t`]);
  const before = t.el("a").x;
  t.setElements(t.elements().map((e) => (ids.has(e.id) ? { ...e, x: e.x + 46, y: e.y + 30, version: e.version + 1 } : e)));
  t.fireChange();
  t.flush();
  for (const uid of ["a", "b", "a1"]) assert.notEqual(mmOf(t.el(uid)).pinned, true, uid);
  assert.equal(t.el("a").x, before + 46);
  t.fireChange();
  t.flush();
  assert.notEqual(mmOf(t.el("a")).pinned, true);
});

test("a native text edit that ends while the pointer is down is written after the gesture", () => {
  const t = setup();
  const txt = t.elements().find((e) => e.containerId === t.el("a").id);
  t.app.state.editingTextElement = { id: txt.id };
  t.fireChange();
  t.flush();
  t.setElements(t.elements().map((e) => (e.id === txt.id ? { ...e, text: "Alpha2", originalText: "Alpha2", version: e.version + 1 } : e)));
  t.app.state.editingTextElement = null;
  t.app.state.cursorButton = "down";
  t.fireChange();
  t.flush();
  assert.equal(t.calls.length, 0);
  t.app.state.cursorButton = "up";
  for (const cb of [...t.listeners.up]) cb();
  t.flush();
  assert.deepEqual(t.calls.at(-1), ["updateString", "R", "a", "Alpha2", "Alpha"]);
});

test("a watch payload that arrives during a gesture is applied after pointer up", () => {
  const raw = rawTree();
  const t = setup({ raw });
  t.app.state.cursorButton = "down";
  raw[":block/children"][0][":block/string"] = "Alpha2";
  t.watches.get("R").cb(raw);
  t.flush();
  assert.equal(t.elements().find((e) => e.id === `${t.el("a").id}-t`).originalText, "Alpha");
  t.app.state.cursorButton = "up";
  for (const cb of [...t.listeners.up]) cb();
  t.flush();
  assert.equal(t.elements().find((e) => e.id === `${t.el("a").id}-t`).originalText, "Alpha2");
});

test("refreshRoot waits for a busy write queue instead of pulling", async () => {
  const t = setup();
  let busy = true;
  let idle = null;
  t.writer.isBusy = () => busy;
  t.writer.onIdle = (root, fn) => { idle = fn; };
  t.writer.updateString = async () => ({ ok: false, reason: "changed" });
  let pulls = 0;
  const pull = t.writer.pullTree;
  t.writer.pullTree = (u) => { pulls += 1; return pull(u); };
  t.select("b");
  t.key({ code: "F2", key: "F2" });
  const input = t.doc.body.children[0];
  input.value = "Beta 2";
  input.fire("keydown", { key: "Enter" });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(pulls, 0);
  assert.equal(typeof idle, "function");
  busy = false;
  idle();
  assert.equal(pulls, 1);
});

test("Esc on a fresh placeholder reselects its anchor so hotkeys keep working", () => {
  const t = setup();
  t.select("b");
  t.key(tab);
  const input = t.doc.body.children[0];
  input.fire("keydown", { key: "Escape" });
  assert.deepEqual(Object.keys(t.app.state.selectedElementIds), [nodeId("R", "b")]);
});

test("commit persists projection writes with captureUpdate NEVER", () => {
  const t = setup();
  const seen = [];
  const orig = t.app.updateScene;
  t.app.updateScene = (u) => { if (u.elements) seen.push(u.captureUpdate); return orig.call(t.app, u); };
  t.select("b");
  t.key(tab);
  assert.ok(seen.length > 0);
  assert.ok(seen.every((c) => c === "NEVER"));
});
