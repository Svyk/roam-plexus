import assert from "node:assert/strict";
import test from "node:test";

import { API_VERSION, createPublicApi, createSceneRegistry } from "../src/api.js";
import { createWriteGuard } from "../src/host/guard.js";

const measure = (s, fs) => s.length * fs * 0.5;

function fixture({ open = true } = {}) {
  const app = {
    state: { selectedElementIds: {}, selectedGroupIds: {}, scrollX: 0, scrollY: 0, zoom: { value: 1 }, width: 800, height: 600, offsetLeft: 0, offsetTop: 0 },
    els: [{ id: "old", type: "rectangle", x: 0, y: 0, width: 5, height: 5, version: 1, isDeleted: false }],
    updates: [],
    getSceneElementsIncludingDeleted() { return this.els; },
    updateScene(u) { this.updates.push(u); if (u.elements) this.els = u.elements; if (u.appState) Object.assign(this.state, u.appState); },
  };
  const ctx = { drawingUid: "d1", app };
  const native = { activeEditor: () => (open ? ctx : null) };
  const guard = createWriteGuard({ toaster: { show() {} } });
  const bulk = [];
  const reg = createSceneRegistry({ native, doc: {}, raf: () => {}, guard, measure, beforeBulk: (a, uid, label) => bulk.push([a, uid, label]) });
  const api = createPublicApi({ host: { pullBlock: () => ({ string: "" }), graphName: () => "g" }, actions: {}, emitter: null, version: "0.12.0", scenes: reg });
  return { app, reg, api, bulk };
}

test("API_VERSION is 5", () => {
  assert.equal(API_VERSION, 5);
  assert.equal(fixture().api.apiVersion, 5);
});

test("build().commit writes once through the guard with IMMEDIATELY and never through paste", () => {
  const { app, api, bulk } = fixture();
  const b = api.build();
  const a = b.box("A", { x: 0, y: 0 });
  const c = b.box("B", { x: 300, y: 0 });
  b.arrow(a, c, { label: "why" });
  const ids = b.commit();
  assert.equal(app.updates.length, 1);
  assert.equal(app.updates[0].captureUpdate, "IMMEDIATELY");
  assert.equal(app.els.length, 1 + ids.length);
  assert.deepEqual(ids, [a, ...ids.slice(1)]);
  assert.ok(ids.length >= 5);
  const top = Object.keys(app.state.selectedElementIds);
  assert.ok(top.includes(a) && top.includes(c));
  assert.ok(!app.els.some((e) => e.containerId && app.state.selectedElementIds[e.id]));
  assert.equal(bulk.length, 1);
  assert.equal(bulk[0][1], "d1");
  assert.match(bulk[0][2], /before Build/);
});

test("a second commit throws and the builder is sealed", () => {
  const { api } = fixture();
  const b = api.build();
  b.rect(0, 0, 10, 10);
  b.commit();
  assert.throws(() => b.commit(), /Already committed/);
  assert.throws(() => b.rect(0, 0, 1, 1), /Already committed/);
  assert.equal(b.sealed, true);
  assert.equal(b.seal, undefined);
});

test("commit refuses when the drawing is not open or another drawing is", () => {
  const closed = fixture({ open: false });
  const b = closed.api.build();
  b.rect(0, 0, 10, 10);
  assert.throws(() => b.commit(), /^Error: Drawing is not open; call RoamPlexus.whenOpen\(uid\) first$/);
  assert.equal(closed.app.updates.length, 0);
  assert.equal(closed.bulk.length, 0);
  const open = fixture();
  const c = open.api.build();
  c.rect(0, 0, 10, 10);
  assert.throws(() => c.commit("other"), /Drawing is not open/);
  assert.equal(open.app.updates.length, 0);
  c.commit("d1");
  assert.equal(open.app.updates.length, 1);
});

test("commit throws when an id already exists in the scene, and nothing is written", () => {
  const { app, reg } = fixture();
  const els = [{ id: "old", type: "rectangle", x: 0, y: 0, width: 1, height: 1, version: 1, isDeleted: false, containerId: null }];
  assert.throws(() => reg.commit(els), /Element old already exists/);
  assert.equal(app.updates.length, 0);
});

test("an empty builder commits nothing", () => {
  const { api, app } = fixture();
  assert.throws(() => api.build().commit(), /Nothing to commit/);
  assert.equal(app.updates.length, 0);
});

test("build() styles apply to elements and the returned builder is frozen", () => {
  const { api, app } = fixture();
  const b = api.build({ style: { strokeColor: "#e03131", roughness: 0 } });
  assert.ok(Object.isFrozen(b));
  b.rect(0, 0, 10, 10);
  b.commit();
  const el = app.els.find((e) => e.id !== "old");
  assert.equal(el.strokeColor, "#e03131");
  assert.equal(el.roughness, 0);
});

const CHART = { nodes: [{ id: "e", text: "Effect", role: "primary" }, { id: "c", text: "Cause" }], edges: [{ effect: "e", cause: "c" }] };

test("scene.addChart appends the chart at the viewport centre in one guarded write", () => {
  const { app, reg, bulk } = fixture();
  const scene = reg.sceneFor(app, "d1");
  const r = scene.addChart(CHART, { layout: "fishbone" });
  assert.match(r.chart, /^ce-[0-9a-f]{8}$/);
  assert.equal(r.skipped, 0);
  assert.equal(app.updates.length, 1);
  assert.equal(app.updates[0].captureUpdate, "IMMEDIATELY");
  assert.deepEqual(app.els.slice(1).map((e) => e.id), r.ids);
  assert.ok(app.els.slice(1).every((e) => e.type === "text" || e.customData?.plexus?.ce?.chart === r.chart));
  const xs = app.els.slice(1).filter((e) => e.type !== "text").map((e) => e.x);
  assert.ok(Math.min(...xs) < 400 && Math.max(...xs) > 400);
  assert.equal(bulk.length, 1);
  assert.match(bulk[0][2], /before Chart/);
});

test("scene.addChart honours at, defaults to the tree layout and throws on bad input", () => {
  const { app, reg } = fixture();
  const scene = reg.sceneFor(app, "d1");
  scene.addChart(CHART, { at: { x: 5000, y: 5000 } });
  assert.ok(app.els.slice(1).every((e) => e.x > 4000));
  assert.ok(app.els.some((e) => e.customData?.plexus?.ce?.edge));
  assert.throws(() => scene.addChart("{bad"), /Invalid JSON/);
  assert.throws(() => scene.addChart({ nodes: [] }), /nodes array/);
  assert.throws(() => scene.addChart(CHART, { layout: "x" }), /Unknown layout/);
  assert.equal(app.updates.length, 1);
});

test("setBeforeBulk rebinds the hook; a throwing hook does not block the write", () => {
  const { app, reg } = fixture();
  const calls = [];
  reg.setBeforeBulk((a, uid, label) => { calls.push(label); throw new Error("boom"); });
  const scene = reg.sceneFor(app, "d1");
  const warn = console.warn;
  console.warn = () => {};
  try { scene.addChart(CHART); } finally { console.warn = warn; }
  assert.equal(calls.length, 1);
  assert.equal(app.updates.length, 1);
  reg.setBeforeBulk(null);
  scene.addChart(CHART);
  assert.equal(calls.length, 1);
});

test("a refused guarded write surfaces as a thrown error from commit and addChart", () => {
  const app = { state: {}, getSceneElementsIncludingDeleted: () => [] };
  const reg = createSceneRegistry({ native: { activeEditor: () => ({ drawingUid: "d1", app }) }, doc: {}, raf: () => {}, guard: { guardedWrite: () => false } });
  assert.throws(() => reg.commit([{ id: "n1", type: "rectangle" }]), /Not applied: Build was refused/);
  assert.throws(() => reg.sceneFor(app, "d1").addChart(CHART), /Not applied: Chart was refused/);
});
