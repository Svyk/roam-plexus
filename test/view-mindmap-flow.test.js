import test from "node:test";
import assert from "node:assert/strict";
import { createMindMap } from "../src/view/mindmap.js";
import { applyOps, makeSizer, nodeId, patchMarker, reconcile, mmOf } from "../src/model/mmsync.js";
import { FLOW_LAYOUT, treeFromPull } from "../src/model/mindmap.js";

const measure = (s, fs) => s.length * fs * 0.5;
const sizes = makeSizer(measure);
const blk = (uid, string, children = [], extra = {}) => ({ ":block/uid": uid, ":block/string": string, ":block/order": 0, ":block/children": children.map((c, i) => ({ ...c, ":block/order": i })), ...extra });

function rawTree() {
  return blk("R", "Root", [blk("a", "Alpha"), blk("d", "Ok?", [blk("y", "Yes: fill #CCP1"), blk("n", "No: hold")]), blk("c", "Ship")]);
}

function setup({ raw = rawTree(), state = {}, mmOpts = {}, mountOpts = {}, layout = "flow" } = {}) {
  const rafQ = [];
  const raf = (fn) => { rafQ.push(fn); return rafQ.length; };
  const caf = (id) => { rafQ[id - 1] = null; };
  const flush = () => { for (let n = 0; n < 5; n++) { const q = rafQ.splice(0); for (const fn of q) fn?.(); } };
  const toasts = [];
  const toaster = { show: (m, o) => toasts.push(m) };
  const tree0 = treeFromPull(raw, {});
  let elements = applyOps([], reconcile({ elements: [], tree: tree0, sizes, textOf: (u, n) => n.string, layout }));
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

const tool = { type: "selection" };
const shiftTab = { code: "Tab", key: "Tab", shiftKey: true };
const dragOf = (t, uid, to, { meta = false, moveBy = 0 } = {}) => {
  const id = nodeId("R", uid);
  const from = t.el(uid);
  t.select(uid);
  const hit = { element: from, hasBeenDuplicated: false };
  for (const cb of [...t.listeners.down]) cb(tool, { hit, drag: { hasOccurred: false } }, { clientX: from.x + 5, clientY: from.y + 5 });
  t.setElements(t.elements().map((e) => (e.id === id ? { ...e, x: e.x + moveBy, y: e.y + moveBy, version: e.version + 1 } : e)));
  return { up: () => { for (const cb of [...t.listeners.up]) cb(tool, { hit, drag: { hasOccurred: true } }, { clientX: to.x, clientY: to.y, metaKey: meta }); } };
};
const centre = (t, uid) => { const e = t.el(uid); return { x: e.x + e.width / 2, y: e.y + e.height / 2 }; };
const selected = (t) => Object.keys(t.app.state.selectedElementIds).filter((k) => t.app.state.selectedElementIds[k]);

test("setLayout accepts flow and writes the root marker", () => {
  const t = setup({ layout: "right" });
  t.select("R");
  assert.equal(t.mm.setLayout(t.app, FLOW_LAYOUT), true);
  assert.equal(mmOf(t.el("R")).layout, "flow");
  assert.equal(t.mm.setLayout(t.app, "bogus"), false);
});

test("Alt+L on a flow map toasts and writes nothing", () => {
  const t = setup();
  t.select("R");
  const before = t.app.updates;
  const versions = t.elements().map((e) => e.version).join();
  t.key({ code: "KeyL", key: "l", altKey: true });
  t.flush();
  assert.ok(t.toasts.includes("Flow layout: change it from the map menu"));
  assert.equal(mmOf(t.el("R")).layout, "flow");
  assert.equal(t.elements().map((e) => e.version).join(), versions);
  assert.equal(t.app.updates, before);
});

test("Alt+P toasts on a flow map and pins nothing", () => {
  const t = setup();
  t.select("c");
  t.key({ code: "KeyP", key: "p", altKey: true });
  assert.ok(t.toasts.includes("Flow steps follow the outline"));
  assert.notEqual(mmOf(t.el("c")).pinned, true);
});

test("attribute blocks as edges is refused on a flow map", () => {
  const t = setup();
  t.select("R");
  assert.equal(t.mm.setAttrEdges(t.app, true), false);
  assert.ok(t.toasts.includes("Not used in flow layout"));
});

test("flow drag: an inner-rect drop reparents; a gap or empty-space drop snaps back without pinning", () => {
  const t = setup();
  dragOf(t, "c", centre(t, "a"), { moveBy: 200 }).up();
  t.flush();
  assert.deepEqual(t.calls.at(-1), ["moveTo", "R", "c", { parentUid: "a" }]);
  const t2 = setup();
  const home = { x: t2.el("c").x, y: t2.el("c").y };
  dragOf(t2, "c", { x: 900, y: 700 }, { moveBy: 300 }).up();
  t2.flush();
  assert.equal(t2.calls.filter((c) => c[0] === "moveTo").length, 0);
  assert.notEqual(mmOf(t2.el("c")).pinned, true);
  assert.deepEqual({ x: t2.el("c").x, y: t2.el("c").y }, home);
});

test("flow drag: Cmd at release snaps back, never pins or moves a block", () => {
  const t = setup();
  const home = { x: t.el("c").x, y: t.el("c").y };
  dragOf(t, "c", centre(t, "a"), { meta: true, moveBy: 120 }).up();
  t.flush();
  assert.equal(t.calls.filter((c) => c[0] === "moveTo").length, 0);
  assert.notEqual(mmOf(t.el("c")).pinned, true);
  assert.deepEqual({ x: t.el("c").x, y: t.el("c").y }, home);
});

test("a moved flow node is not pinned by the pass (pin detection skipped)", () => {
  const t = setup();
  t.setElements(t.elements().map((e) => (e.id === nodeId("R", "c") ? { ...e, x: e.x + 500, version: e.version + 1 } : e)));
  t.fireChange();
  t.flush();
  assert.notEqual(mmOf(t.el("c")).pinned, true);
});

test("Shift+Tab selects the primary predecessor on a flow map", () => {
  const t = setup();
  const id = (uid) => nodeId("R", uid);
  const pick = (uid) => { t.select(uid); t.key(shiftTab); return selected(t); };
  assert.deepEqual(pick("a"), [id("R")]);
  assert.deepEqual(pick("d"), [id("a")]);
  assert.deepEqual(pick("y"), [id("d")]);
  assert.deepEqual(pick("n"), [id("d")]);
  assert.deepEqual(pick("c"), [id("n")]);
});

test("Tab under a decision adds a branch child; Enter adds the next sibling", () => {
  const t = setup();
  t.select("d");
  t.key({ code: "Tab", key: "Tab" });
  assert.equal(t.calls.at(-1)[0], "createChild");
  assert.equal(t.calls.at(-1)[2], "d");
  const t2 = setup();
  t2.select("y");
  t2.key({ code: "Enter", key: "Enter" });
  assert.equal(t2.calls.at(-1)[0], "createSiblingAfter");
  assert.equal(t2.calls.at(-1)[2], "y");
});

test("F2 on a branch with a suffix shows only the text and keeps label, task prefix and tags", () => {
  const t = setup();
  t.select("y");
  t.key({ code: "F2", key: "F2" });
  const input = t.doc.body.children[0];
  assert.ok(input);
  assert.equal(input.value, "fill");
  input.value = "pack";
  input.fire("keydown", { key: "Enter" });
  assert.deepEqual(t.calls.at(-1), ["updateString", "R", "y", "Yes: pack #CCP1", "Yes: fill #CCP1"]);
});

test("F2 on a plain step with only a tag suffix keeps the tag", () => {
  const raw = blk("R", "Root", [blk("a", "Weigh #hazard"), blk("b", "Ship")]);
  const t = setup({ raw });
  t.select("a");
  t.key({ code: "F2", key: "F2" });
  const input = t.doc.body.children[0];
  assert.equal(input.value, "Weigh");
  input.value = "Weigh it";
  input.fire("keydown", { key: "Enter" });
  assert.deepEqual(t.calls.at(-1), ["updateString", "R", "a", "Weigh it #hazard", "Weigh #hazard"]);
});

test("a canvas edit of a branch node keeps the label and suffix", () => {
  const t = setup();
  const txt = t.elements().find((e) => e.containerId === nodeId("R", "y"));
  assert.ok(txt);
  t.app.state.editingTextElement = { id: txt.id };
  t.fireChange();
  t.flush();
  t.setElements(t.elements().map((e) => (e.id === txt.id ? { ...e, text: "pack", originalText: "pack", version: e.version + 1 } : e)));
  t.app.state.editingTextElement = null;
  t.fireChange();
  t.flush();
  assert.deepEqual(t.calls.at(-1), ["updateString", "R", "y", "Yes: pack #CCP1", "Yes: fill #CCP1"]);
});

test("a root that ends in '?' does not make its children branch heads", () => {
  const raw = blk("R", "Ship it?", [blk("a", "Step 1: Mix", [blk("s", "Sub")]), blk("b", "Two")]);
  const t = setup({ raw });
  const txt = t.elements().find((e) => e.containerId === nodeId("R", "a"));
  t.app.state.editingTextElement = { id: txt.id };
  t.fireChange();
  t.flush();
  t.setElements(t.elements().map((e) => (e.id === txt.id ? { ...e, text: "Step 1: Mix2", originalText: "Step 1: Mix2", version: e.version + 1 } : e)));
  t.app.state.editingTextElement = null;
  t.fireChange();
  t.flush();
  assert.deepEqual(t.calls.at(-1), ["updateString", "R", "a", "Step 1: Mix2", "Step 1: Mix"]);
  t.select("b");
  t.key(shiftTab);
  assert.deepEqual(selected(t), [nodeId("R", "s")]);
});

test("a canvas edit of a branch-label arrow toasts once and writes nothing", () => {
  const t = setup();
  const label = t.elements().find((e) => e.type === "text" && !e.isDeleted && e.containerId && e.containerId.endsWith("-e"));
  assert.ok(label);
  for (const text of ["Maybe", "Perhaps"]) {
    t.app.state.editingTextElement = { id: label.id };
    t.fireChange();
    t.flush();
    t.setElements(t.elements().map((e) => (e.id === label.id ? { ...e, text, originalText: text, version: e.version + 1 } : e)));
    t.app.state.editingTextElement = null;
    t.fireChange();
    t.flush();
  }
  assert.equal(t.toasts.filter((m) => m === "Edit the Yes:/No: prefix in the outline").length, 1);
  assert.equal(t.calls.filter((c) => c[0] === "updateString").length, 0);
});

const laneRaw = () => blk("R", "Root", [blk("a", "Receive", [blk("la", "Lane:: QA")]), blk("b", "Ship #lane/Ops")]);
const laneFrames = (t) => t.elements().filter((e) => e.type === "frame" && !e.isDeleted && /-lane-/.test(e.id));

test("lane regions are requested once at session start for existing named lanes", async () => {
  const calls = [];
  const t = setup({ raw: laneRaw(), mountOpts: { drawingUid: "D" }, mmOpts: { createLaneRegions: async (uid, frames) => { calls.push([uid, frames]); return []; } } });
  await new Promise((r) => setTimeout(r, 0));
  const frames = laneFrames(t);
  assert.equal(frames.length, 2);
  assert.ok(calls.length >= 1);
  const all = calls.flatMap(([, f]) => f);
  assert.deepEqual(new Set(all.map((f) => f.name)), new Set(["QA", "Ops"]));
  assert.ok(calls.every(([uid]) => uid === "D"));
});

test("lane regions are skipped without a drawing uid, and errors are swallowed", async () => {
  const calls = [];
  setup({ raw: laneRaw(), mmOpts: { createLaneRegions: async (...a) => { calls.push(a); } } });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.length, 0);
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a);
  try {
    const t = setup({ raw: laneRaw(), mountOpts: { drawingUid: "D" }, mmOpts: { createLaneRegions: async () => { throw new Error("boom"); } } });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(t.toasts.length, 0);
  } finally { console.warn = orig; }
  assert.ok(warns.some((w) => String(w[0]).startsWith("[plexus]")));
});

test("lane regions are single-flight per drawing with one merged queued re-run", async () => {
  const calls = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const t = setup({ raw: laneRaw(), mountOpts: { drawingUid: "D" }, mmOpts: { createLaneRegions: async (uid, frames) => { calls.push(frames.map((f) => f.name)); if (calls.length === 1) await gate; return []; } } });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.length, 1);
  const cb = t.watches.get("R").cb;
  cb(blk("R", "Root", [blk("a", "Receive", [blk("la", "Lane:: QA")]), blk("b", "Ship #lane/Ops"), blk("c", "Pack #lane/Lab")]));
  cb(blk("R", "Root", [blk("a", "Receive", [blk("la", "Lane:: QA")]), blk("b", "Ship #lane/Ops"), blk("c", "Pack #lane/Lab"), blk("e", "Bill #lane/Fin")]));
  t.flush();
  assert.equal(calls.length, 1);
  release();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls.length, 2);
  assert.ok(calls[1].includes("Lab") && calls[1].includes("Fin"));
});

test("unmounting removes every listener on a flow map", () => {
  const t = setup();
  t.unmount();
  assert.equal(t.containerListeners.length, 0);
  assert.equal(t.docListeners.length, 0);
  assert.equal(t.viewListeners.length, 0);
});
