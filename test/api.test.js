import test from "node:test";
import assert from "node:assert/strict";
import { createPublicApi, installPublicApi, uninstallPublicApi } from "../src/api.js";

function makeEmitter() {
  const l = new Set();
  return { on: (t, f) => l.add(f), off: (t, f) => l.delete(f), emit: (t, d) => [...l].forEach((f) => f(d)), size: () => l.size };
}

function build() {
  const emitter = makeEmitter();
  const calls = [];
  const host = {
    graphName: () => "g",
    createDrawing: async (a) => { calls.push(["create", a]); return { uid: "u", pageUid: "p" }; },
    drawingsOn: (p) => ["d1"],
    regionsOf: () => [{ uid: "r1", string: "s", region: { kind: "area", caption: "cap" } }],
    pullBlock: (uid) => ({ string: uid === "r1" ? "{{[[plexus-region]]: k=area d=abcdefghi}}" : "{{[[excalidraw]]}}" }),
    openBlock: async (uid, o) => calls.push(["openBlock", uid, o]),
  };
  const actions = { openRegion: async (uid, o) => calls.push(["openRegion", uid, o]), thumbnail: async (uid, o) => { calls.push(["thumb", uid, o]); return null; } };
  return { api: createPublicApi({ host, actions, emitter, version: "0.2.0" }), emitter, calls };
}

test("regionsOf labels img and view as Plexus Diagram · region", () => {
  const emitter = makeEmitter();
  const host = {
    graphName: () => "g",
    regionsOf: () => [
      { uid: "i1", region: { kind: "img", caption: "test" } },
      { uid: "v1", region: { kind: "view", caption: "" } },
    ],
    labelSource: () => ({ string: "", pageTitle: null }),
  };
  const api = createPublicApi({ host, actions: {}, emitter, version: "0.33.0" });
  assert.deepEqual(api.regionsOf("d").map((row) => [row.uid, row.caption, row.label]), [
    ["i1", "test", "Plexus Diagram · region"],
    ["v1", "", "Plexus Diagram · region"],
  ]);
});

test("public api is frozen and delegates", async () => {
  const { api, calls } = build();
  assert.ok(Object.isFrozen(api));
  assert.equal(api.apiVersion, 7);
  assert.equal(api.version, "0.2.0");
  assert.equal(api.isAvailable(), true);
  assert.deepEqual(await api.create({ title: "T" }), { uid: "u", pageUid: "p" });
  assert.deepEqual(api.regionsOf("d"), [{ uid: "r1", kind: "area", caption: "cap", label: "cap" }]);
  assert.deepEqual(api.drawingsOn("p"), ["d1"]);
  await api.open("r1", { sidebar: true });
  await api.open("d");
  await api.open("d", { region: true });
  await api.thumbnail("d", { maxWidth: 100 });
  assert.deepEqual(calls.slice(1), [
    ["openRegion", "r1", { sidebar: true }],
    ["openBlock", "d", { sidebar: false }],
    ["openRegion", "d", { sidebar: false }],
    ["thumb", "d", { maxWidth: 100 }],
  ]);
});

test("change listeners add, dedupe, remove, and survive throwing callbacks", () => {
  const { api, emitter } = build();
  const got = [];
  const cb = (d) => got.push(d);
  api.addEventListener("change", cb);
  api.addEventListener("change", cb);
  api.addEventListener("change", () => { throw new Error("boom"); });
  api.addEventListener("other", cb);
  assert.equal(emitter.size(), 2);
  const origError = console.error;
  console.error = () => {};
  emitter.emit("change", { uid: "x", kind: "drawing" });
  console.error = origError;
  assert.deepEqual(got, [{ uid: "x", kind: "drawing" }]);
  api.removeEventListener("change", cb);
  assert.equal(emitter.size(), 1);
});

test("install dispatches ready; uninstall dispatches unload and deletes only when ours", () => {
  const { api } = build();
  const events = [];
  const win = { dispatchEvent: (e) => events.push([e.type, e.detail]) };
  class CE { constructor(type, init) { this.type = type; this.detail = init.detail; } }
  installPublicApi(api, { win, CustomEventCtor: CE });
  assert.equal(win.RoamPlexus, api);
  assert.equal(uninstallPublicApi(api, { win, CustomEventCtor: CE }), true);
  assert.equal("RoamPlexus" in win, false);
  const foreign = { mine: false };
  win.RoamPlexus = foreign;
  assert.equal(uninstallPublicApi(api, { win, CustomEventCtor: CE }), false);
  assert.equal(win.RoamPlexus, foreign);
  assert.deepEqual(events.map((e) => e[0]), ["roam-plexus:ready", "roam-plexus:unload", "roam-plexus:unload"]);
  assert.deepEqual(events[0][1], { apiVersion: 7 });
});

import { createSceneRegistry } from "../src/api.js";

function sceneFixture() {
  const listeners = new Set();
  const app = {
    state: { scrollX: 1, scrollY: 2, zoom: { value: 1.5 }, selectedElementIds: {}, selectedGroupIds: {}, theme: "light", width: 800, height: 600 },
    els: [{ id: "a", type: "rectangle", x: 0, y: 0, width: 10, height: 10, version: 1, customData: { k: 1 } }, { id: "t", type: "text", containerId: "a", text: "x", version: 1 }],
    updates: [],
    onChangeEmitter: { on: (f) => { listeners.add(f); return () => listeners.delete(f); } },
    getSceneElementsIncludingDeleted() { return this.els; },
    updateScene(u) { this.updates.push(u); if (u.elements) this.els = u.elements; if (u.appState) Object.assign(this.state, u.appState); },
  };
  const ctx = { drawingUid: "d1", app };
  let n = 0;
  const native = {
    activeEditor: () => ctx.app && ctx,
    addViaPaste(a, copies, opts) {
      native.lastOpts = opts;
      for (const c of copies) a.els.push({ ...structuredClone(c), id: `new${n++}`, frameId: "f" });
    },
    waitNotLoading: async () => true,
    captureSelectionSvg: async () => '<svg width="10" height="10" viewBox="0 0 10 10"></svg>',
    zoomTo(a, bbox) { native.zoomed = bbox; },
  };
  const frames = [];
  const reg = createSceneRegistry({ native, doc: {}, raf: (f) => frames.push(f) });
  return { app, ctx, native, reg, listeners, frames };
}

test("scene is frozen, cached per app, and throws after release or unmount", () => {
  const { app, ctx, reg } = sceneFixture();
  const s = reg.sceneFor(app, "d1");
  assert.ok(Object.isFrozen(s));
  assert.equal(reg.sceneFor(app, "d1"), s);
  assert.equal(reg.sceneOf("d1"), s);
  assert.equal(reg.sceneOf("other"), null);
  assert.equal(s.appState().zoom, 1.5);
  assert.equal(s.elements().length, 2);
  ctx.app = null;
  assert.throws(() => s.elements(), /Scene is no longer open/);
  ctx.app = app;
  reg.release(app);
  assert.throws(() => s.appState(), /Scene is no longer open/);
  assert.notEqual(reg.sceneFor(app, "d1"), s);
});

test("add returns input-order ids, drops invisible, restores customData and frameId", () => {
  const { app, reg } = sceneFixture();
  const s = reg.sceneFor(app, "d1");
  const ids = s.add([
    { type: "rectangle", x: 0, y: 0, width: 5, height: 5, frameId: null },
    { type: "rectangle", x: 0, y: 0, width: 0, height: 0 },
    { type: "ellipse", x: 1, y: 1, width: 5, height: 5, customData: { z: 1 } },
  ]);
  assert.deepEqual(ids, ["new0", null, "new1"]);
  const [r, e] = [app.els.find((x) => x.id === "new0"), app.els.find((x) => x.id === "new1")];
  assert.equal("customData" in r, false);
  assert.equal(r.frameId, null);
  assert.deepEqual(e.customData, { z: 1 });
  assert.equal(e.frameId, null);
  assert.deepEqual(app.state.selectedElementIds, { new0: true, new1: true });
  assert.throws(() => s.add([]), /non-empty/);
  assert.throws(() => s.add([{ type: "image" }]), /image/);
});

test("update merges customData and bumps versions; remove sets isDeleted with bound text", () => {
  const { app, reg } = sceneFixture();
  const s = reg.sceneFor(app, "d1");
  const out = s.update("a", { customData: { j: 2 }, x: 5 });
  assert.deepEqual(out.customData, { k: 1, j: 2 });
  assert.equal(out.version, 2);
  assert.equal(app.els[0].x, 5);
  assert.throws(() => s.update("a", { id: "z" }), /Cannot patch id/);
  assert.throws(() => s.update("nope", { x: 1 }), /No element nope/);
  assert.equal(s.remove(["a", "missing"]), 1);
  assert.equal(app.els.find((e) => e.id === "a").isDeleted, true);
  assert.equal(app.els.find((e) => e.id === "t").isDeleted, true);
});

test("exportSvg normalizes, zoomTo fits, onChange is frame-throttled and cleaned by release", async () => {
  const { app, reg, native, listeners, frames } = sceneFixture();
  const s = reg.sceneFor(app, "d1");
  assert.match(await s.exportSvg(["a"]), /<svg/);
  s.zoomTo(["a"]);
  assert.deepEqual(native.zoomed, [0, 0, 10, 10]);
  const got = [];
  const off = s.onChange((d) => { got.push(d); s.update("a", { x: 9 }); });
  const fire = [...listeners][0];
  fire(); fire();
  assert.equal(got.length, 0);
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.deepEqual(got, [{ uid: "d1" }]);
  assert.equal(listeners.size, 1);
  off();
  assert.equal(listeners.size, 0);
  s.onChange(() => {});
  reg.release(app);
  assert.equal(listeners.size, 0);
});

test("whenOpen validates, shares in-flight promise, and rejects on dispose", async () => {
  const { app, ctx, reg } = sceneFixture();
  ctx.drawingUid = "other";
  const host = { pullBlock: (u) => ({ string: u === "bad" ? "hello" : "{{[[excalidraw]]}}" }) };
  const opened = [];
  const api = createPublicApi({ host, actions: {}, emitter: null, version: "x", scenes: reg, openDrawing: async (u) => { opened.push(u); return { app, drawingUid: u }; } });
  assert.equal(api.apiVersion, 7);
  assert.equal(api.scene("d1"), null);
  await assert.rejects(api.whenOpen("bad"), /Not a drawing/);
  await assert.rejects(api.whenOpen("d1"), /Another drawing is open/);
  ctx.app = null;
  ctx.drawingUid = "d1";
  const restore = () => { ctx.app = app; };
  const p1 = api.whenOpen("d1");
  assert.equal(api.whenOpen("d1"), p1);
  await assert.rejects(api.whenOpen("d2"), /Busy opening d1/);
  restore();
  assert.equal((await p1).uid, "d1");
  assert.deepEqual(opened, ["d1"]);
  assert.equal((await api.whenOpen("d1")).uid, "d1");
  assert.equal(opened.length, 1);
  ctx.app = null;
  const hang = createPublicApi({ host, actions: {}, scenes: reg, openDrawing: () => new Promise(() => {}) }).whenOpen("d1", { timeoutMs: 5000 });
  reg.dispose();
  await assert.rejects(hang, /Plexus unloaded/);
});

test("add: an isDeleted-only input returns null ids and does not throw, for keep and center", () => {
  const { app, reg } = sceneFixture();
  const s = reg.sceneFor(app, "d1");
  const dead = { type: "rectangle", x: 0, y: 0, width: 5, height: 5, isDeleted: true };
  assert.deepEqual(s.add([dead]), [null]);
  assert.deepEqual(s.add([dead], { at: "center" }), [null]);
});

test("add: no captureUpdate on the scene update, position follows at, select:false restores the prior selection", () => {
  const { app, native, reg } = sceneFixture();
  const s = reg.sceneFor(app, "d1");
  app.state.selectedElementIds = { a: true };
  const r = { type: "rectangle", x: 0, y: 0, width: 10, height: 10 };
  s.add([r], { select: false });
  assert.ok(app.updates.every((u) => !("captureUpdate" in u)), "one undo step: no captureUpdate");
  assert.deepEqual(app.state.selectedElementIds, { a: true });
  assert.ok(native.lastOpts.position && typeof native.lastOpts.position === "object", "keep passes a client position");
  s.add([r], { at: "center", select: true });
  assert.equal(native.lastOpts.position, "center");
});

test("update: a partial customData.plexus patch keeps sibling plexus keys", () => {
  const { app, reg } = sceneFixture();
  app.els[0].customData = { k: 1, plexus: { embed: "((abcdefghi))", migratedFrom: "XYZ123456" } };
  const s = reg.sceneFor(app, "d1");
  const out = s.update("a", { customData: { plexus: { order: 2 } } });
  assert.deepEqual(out.customData, { k: 1, plexus: { embed: "((abcdefghi))", migratedFrom: "XYZ123456", order: 2 } });
});

test("regionsOf labels: caption, derived from labelSource, and Region on failure", () => {
  const regions = [
    { uid: "a", region: { kind: "area", caption: "" } },
    { uid: "b", region: { kind: "imgrect", caption: "", i: 1 } },
    { uid: "c", region: { kind: "poly", caption: "" } },
  ];
  const src = { string: "{{[[excalidraw]]}}", pageTitle: "Wing" };
  const mk = (labelSource) => createPublicApi({ host: { regionsOf: () => regions, labelSource, pullBlock: () => null }, actions: {}, emitter: null, version: "x" });
  const withSrc = mk(() => src).regionsOf("d");
  assert.deepEqual(withSrc.map((r) => r.label), ["Wing · area", "Wing · image area", "Wing · lasso"]);
  assert.deepEqual(Object.keys(withSrc[0]), ["uid", "kind", "caption", "label"]);
  const noSrc = mk(undefined).regionsOf("d");
  assert.deepEqual(noSrc.map((r) => r.label), ["Image · area", "Image · image area", "Image · lasso"]);
  const throws = mk(() => { throw new Error("x"); }).regionsOf("d");
  assert.equal(throws[0].label, "Image · area");
  const bad = createPublicApi({ host: { regionsOf: () => [{ uid: "z", region: { kind: "nope", caption: "" } }], labelSource: () => src }, actions: {}, emitter: null, version: "x" }).regionsOf("d");
  assert.equal(bad[0].label, "Wing · region");
});
