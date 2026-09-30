import test from "node:test";
import assert from "node:assert/strict";
import { API_VERSION, createSceneRegistry } from "../src/api.js";
import { createWriteGuard } from "../src/host/guard.js";

function fixture(n = 50) {
  const app = {
    state: { selectedElementIds: {}, selectedGroupIds: {} },
    els: Array.from({ length: n }, (_, i) => ({ id: `e${i}`, type: "rectangle", x: 0, y: 0, width: 5, height: 5, version: 1, isDeleted: false })),
    updates: [],
    getSceneElementsIncludingDeleted() { return this.els; },
    updateScene(u) { this.updates.push(u); if (u.elements) this.els = u.elements; if (u.appState) Object.assign(this.state, u.appState); },
  };
  const ctx = { drawingUid: "d1", app };
  const native = { activeEditor: () => ctx };
  const toasts = [];
  const guard = createWriteGuard({ toaster: { show: (message, opts) => toasts.push({ message, opts }) } });
  const reg = createSceneRegistry({ native, doc: {}, raf: () => {}, guard });
  return { app, toasts, guard, scene: reg.sceneFor(app, "d1") };
}

const ids = (from, to) => Array.from({ length: to - from }, (_, i) => `e${from + i}`);

test("API version is 4", () => assert.equal(API_VERSION, 4));

test("remove of 40 of 50 throws after the toast, writes nothing, and Apply anyway then Restore round-trips", () => {
  const { app, toasts, guard, scene } = fixture(50);
  assert.throws(() => scene.remove(ids(0, 40)), /^Error: Not applied: would remove 40 of 50$/);
  assert.equal(app.updates.length, 0);
  assert.equal(toasts[0].opts.action.label, "Apply anyway");
  toasts[0].opts.action.run();
  assert.equal(app.els.filter((e) => e.isDeleted).length, 40);
  assert.equal(app.updates[0].captureUpdate, "IMMEDIATELY");
  assert.equal(guard.restoreLast(app, "d1"), 40);
  assert.equal(app.els.filter((e) => e.isDeleted).length, 0);
});

test("remove with force bypasses the check and snapshots the removal", () => {
  const { app, guard, scene } = fixture(50);
  assert.equal(scene.remove(ids(0, 45), { force: true }), 45);
  assert.equal(app.els.filter((e) => e.isDeleted).length, 45);
  assert.equal(guard.hasSnapshot("d1"), true);
});

test("small removes and updates pass the guard unchanged", () => {
  const { app, scene } = fixture(50);
  assert.equal(scene.remove(["e0", "e1"]), 2);
  const out = scene.update("e5", { x: 9 });
  assert.equal(out.x, 9);
  assert.equal(out.version, 2);
  assert.equal(app.updates.at(-1).captureUpdate, "IMMEDIATELY");
});

// ---- live repro 2026-09-29: add 50, remove 40 (refused), Apply anyway through the real toast, Restore, Undo ----

function toastDoc() {
  const body = { children: [], append(c) { this.children.push(c); } };
  const mk = (tag) => ({
    tag, children: [], listeners: {}, className: "", removed: false, _text: "",
    setAttribute() {}, append(c) { this.children.push(c); }, addEventListener(t, f) { this.listeners[t] = f; }, remove() { this.removed = true; },
    get textContent() { return this._text; }, set textContent(v) { this._text = v; this.children = []; },
  });
  return { body, createElement: mk };
}

async function liveFlow() {
  const { createToaster } = await import("../src/view/toast.js");
  const { createActions } = await import("../src/actions.js");
  const app = {
    state: { selectedElementIds: {}, selectedGroupIds: {} },
    els: [],
    updates: [],
    history: [],
    getSceneElementsIncludingDeleted() { return this.els; },
    updateScene(u) {
      this.updates.push({ captureUpdate: u.captureUpdate, elements: !!u.elements });
      if (u.elements) {
        if (u.captureUpdate === "IMMEDIATELY") this.history.push(this.els);
        this.els = u.elements;
      }
      if (u.appState) Object.assign(this.state, u.appState);
    },
    undo() { if (this.history.length) this.els = this.history.pop(); },
  };
  const ctx = { drawingUid: "d1", app };
  const native = {
    activeEditor: () => ctx,
    addViaPaste(a, copies) {
      a.history.push(a.els);
      a.els = [...a.els, ...copies.map((c, i) => ({ ...c, id: `n${a.els.length + i}`, version: 1, versionNonce: 1, isDeleted: false }))];
    },
  };
  const doc = toastDoc();
  const toaster = createToaster({ doc });
  const guard = createWriteGuard({ toaster });
  const reg = createSceneRegistry({ native, doc: {}, raf: () => {}, guard });
  const actions = createActions({ native, doc: {}, toaster, guard, host: {}, api: {} });
  const toastEl = () => doc.body.children.filter((n) => !n.removed).at(-1);
  const live = () => app.els.filter((e) => !e.isDeleted).length;
  return { app, scene: reg.sceneFor(app, "d1"), guard, actions, toastEl, live };
}

test("live flow: refused remove, Apply anyway click, Restore toasts, restores 40, and Undo returns to 10", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = await liveFlow();
  const made = f.scene.add(Array.from({ length: 50 }, (_, i) => ({ type: "rectangle", x: i, y: 0, width: 5, height: 5 })));
  assert.equal(f.live(), 50);
  assert.throws(() => f.scene.remove(made.slice(0, 40)), /would remove 40 of 50/);
  assert.equal(f.live(), 50);
  const button = f.toastEl().children[0];
  assert.equal(button.textContent, "Apply anyway");
  button.listeners.click();
  assert.equal(f.live(), 10);
  assert.equal(f.app.updates.at(-1).captureUpdate, "IMMEDIATELY");
  assert.equal(f.guard.hasSnapshot("d1"), true);
  assert.equal(f.actions.hasSnapshot(), true);
  assert.equal(f.actions.restoreBeforeLastPlexusChange(), 40);
  assert.equal(f.live(), 50);
  assert.equal(f.app.updates.at(-1).captureUpdate, "IMMEDIATELY");
  assert.match(f.toastEl()._text, /^Restored 40 elements/);
  f.app.undo();
  assert.equal(f.live(), 10);
});

test("Restore toasts on every exit: nothing to restore, closed drawing, and an update the drawing ignores", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = await liveFlow();
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(f.actions.restoreBeforeLastPlexusChange(), 0);
    assert.equal(f.toastEl()._text, "Nothing to restore");
    const made = f.scene.add(Array.from({ length: 50 }, (_, i) => ({ type: "rectangle", x: i, y: 0, width: 5, height: 5 })));
    f.scene.remove(made.slice(0, 40), { force: true });
    const real = f.app.updateScene;
    f.app.updateScene = () => {};
    assert.equal(f.actions.restoreBeforeLastPlexusChange(), 0);
    assert.equal(f.toastEl()._text, "Could not restore the drawing");
    f.app.updateScene = () => { throw new Error("boom"); };
    assert.equal(f.actions.restoreBeforeLastPlexusChange(), 0);
    assert.equal(f.toastEl()._text, "Could not restore the drawing");
    f.app.updateScene = real;
    assert.equal(f.guard.hasSnapshot("d1"), true);
    assert.equal(f.actions.restoreBeforeLastPlexusChange(), 40);
  } finally {
    console.warn = warn;
  }
});
