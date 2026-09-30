import assert from "node:assert/strict";
import test from "node:test";

import { animateTo, animateView, createViewHistory } from "../src/host/camera.js";

const mkApp = (state = {}) => {
  const app = {
    state: { width: 1000, height: 800, scrollX: 0, scrollY: 0, zoom: { value: 1 }, ...state },
    writes: [],
    updateScene(o) {
      this.writes.push(o);
      if (o.appState) {
        const a = o.appState;
        if (a.zoom) this.state.zoom = a.zoom;
        for (const k of ["scrollX", "scrollY", "shouldCacheIgnoreZoom"]) if (k in a) this.state[k] = a[k];
      }
    },
  };
  return app;
};

// Fake doc whose querySelector yields an editor that findApp can resolve to `app`.
const mkDoc = (app) => {
  const listeners = {};
  const el = { closest: (sel) => (sel === ".plexus-offscreen" ? null : { closest: () => null }), __reactFiber$x: { stateNode: { updateScene() {}, getSceneElementsIncludingDeleted() {}, actionManager: {} } } };
  el.__reactFiber$x.stateNode = Object.assign(app, { getSceneElementsIncludingDeleted: () => [], actionManager: {} });
  return {
    listeners,
    active: true,
    querySelector() { return this.active ? el : null; },
    addEventListener(t, f) { (listeners[t] ||= []).push(f); },
    removeEventListener(t, f) { listeners[t] = (listeners[t] || []).filter((x) => x !== f); },
    fire(t) { for (const f of [...(listeners[t] || [])]) f({}); },
  };
};

const mkRaf = () => {
  const q = [];
  const raf = (f) => { q.push(f); };
  raf.flush = () => { const f = q.shift(); if (f) f(); return !!f; };
  raf.pending = () => q.length;
  return raf;
};

test("instant: one exact write with captureUpdate NEVER", async () => {
  const app = mkApp();
  const r = await animateView(app, { scrollX: 5, scrollY: 6, zoom: 1.5 }, { animate: false });
  assert.deepEqual(r, { moved: true, aborted: false });
  assert.equal(app.writes.length, 1);
  assert.deepEqual(app.writes[0], { appState: { scrollX: 5, scrollY: 6, zoom: { value: 1.5 } }, captureUpdate: "NEVER" });
});

test("tween: eases to the exact target, monotone zoom, listeners removed", async () => {
  const app = mkApp({ shouldCacheIgnoreZoom: false });
  const doc = mkDoc(app);
  const raf = mkRaf();
  let t = 0;
  const p = animateView(app, { scrollX: 100, scrollY: 50, zoom: 2 }, { animate: true, doc, raf, now: () => t, duration: 400 });
  const zooms = [];
  while (raf.pending()) {
    raf.flush();
    zooms.push(app.state.zoom.value);
    t += 100;
  }
  const r = await p;
  assert.deepEqual(r, { moved: true, aborted: false });
  assert.deepEqual([app.state.scrollX, app.state.scrollY, app.state.zoom.value], [100, 50, 2]);
  for (let i = 1; i < zooms.length; i++) assert.ok(zooms[i] >= zooms[i - 1]);
  assert.ok(zooms.length >= 4);
  assert.equal(app.state.shouldCacheIgnoreZoom, false);
  assert.ok(app.writes.some((w) => w.appState.shouldCacheIgnoreZoom === true));
  for (const list of Object.values(doc.listeners)) assert.equal(list.length, 0);
  assert.ok(app.writes.every((w) => w.captureUpdate === "NEVER"));
});

test("pointer, wheel and key input abort in place without a snap", async () => {
  for (const type of ["pointerdown", "wheel", "keydown"]) {
    const app = mkApp();
    const doc = mkDoc(app);
    const raf = mkRaf();
    let t = 0;
    const p = animateView(app, { scrollX: 100, scrollY: 0, zoom: 2 }, { animate: true, doc, raf, now: () => t });
    raf.flush(); t += 100; raf.flush();
    const mid = app.state.zoom.value;
    doc.fire(type);
    const r = await p;
    assert.equal(r.aborted, true);
    assert.equal(app.state.zoom.value, mid);
    assert.notEqual(mid, 2);
    assert.equal(raf.flush() && app.state.zoom.value, mid);
    for (const list of Object.values(doc.listeners)) assert.equal(list.length, 0);
  }
});

test("a newer animateView and losing the editor both abort", async () => {
  const app = mkApp();
  const doc = mkDoc(app);
  const raf = mkRaf();
  let t = 0;
  const first = animateView(app, { scrollX: 100, scrollY: 0, zoom: 2 }, { animate: true, doc, raf, now: () => t });
  const second = animateView(app, { scrollX: 0, scrollY: 0, zoom: 1 }, { animate: false });
  raf.flush();
  assert.equal((await first).aborted, true);
  assert.equal((await second).aborted, false);

  const app2 = mkApp();
  const doc2 = mkDoc(app2);
  const raf2 = mkRaf();
  const p = animateView(app2, { scrollX: 100, scrollY: 0, zoom: 2 }, { animate: true, doc: doc2, raf: raf2, now: () => t });
  doc2.active = false;
  raf2.flush();
  assert.equal((await p).aborted, true);
});

test("two slow frames jump straight to the target", async () => {
  const app = mkApp();
  const doc = mkDoc(app);
  const raf = mkRaf();
  let t = 0;
  const origUpdate = app.updateScene.bind(app);
  app.updateScene = (o) => { t += 40; origUpdate(o); };
  const p = animateView(app, { scrollX: 100, scrollY: 0, zoom: 2 }, { animate: true, doc, raf, now: () => t, duration: 100000 });
  while (raf.pending()) raf.flush();
  assert.deepEqual(await p, { moved: true, aborted: false });
  assert.deepEqual([app.state.scrollX, app.state.zoom.value], [100, 2]);
});

test("animateTo honors maxZoom, reports the settled rect, and skips when already framed", async () => {
  const app = mkApp();
  const r = await animateTo(app, [2000, 1300, 2100, 1400], { maxZoom: 1.5, animate: false });
  assert.equal(r.moved, true);
  assert.equal(app.state.zoom.value, 1.5);
  const c = r.rect.left + r.rect.width / 2;
  assert.ok(Math.abs(c - 500) < 1e-6);
  const before = app.writes.length;
  const again = await animateTo(app, [2000, 1300, 2100, 1400], { maxZoom: 1.5, animate: false });
  assert.equal(again.moved, false);
  assert.equal(app.writes.length, before);

  const app2 = mkApp();
  await animateTo(app2, [0, 0, 100, 100], { maxZoom: 1, animate: false });
  assert.equal(app2.state.zoom.value, 1);
  const app3 = mkApp();
  await animateTo(app3, [0, 0, 100, 100], { maxZoom: 2, animate: false });
  assert.equal(app3.state.zoom.value, 2);
});

test("animateTo never throws", async () => {
  const warn = console.warn; console.warn = () => {};
  try {
    const r = await animateTo({ state: { width: 10, height: 10 }, updateScene() { throw new Error("x"); } }, [0, 0, 5, 5], { animate: false });
    assert.equal(r.moved, false);
  } finally { console.warn = warn; }
});

test("view history discard drops the newest entry and reports a change; empty discard is a no-op", () => {
  let changes = 0;
  const h = createViewHistory({ onChange: () => { changes++; } });
  const app = mkApp();
  h.discard();
  assert.equal(changes, 0);
  h.push(app);
  assert.equal(h.size(), 1);
  h.discard();
  assert.equal(h.size(), 0);
  assert.equal(changes, 2);
});

test("view history: dedupe, cap, back restores exactly, empty resolves false", async () => {
  let changes = 0;
  const h = createViewHistory({ cap: 3, onChange: () => { changes++; } });
  const app = mkApp();
  h.push(app);
  h.push(app);
  assert.equal(h.size(), 1);
  for (let i = 1; i <= 4; i++) { app.state.scrollX = i * 10; h.push(app); }
  assert.equal(h.size(), 3);
  app.state.scrollX = 999;
  assert.equal(await h.back(app), true);
  assert.equal(app.state.scrollX, 40);
  assert.equal(app.writes.at(-1).captureUpdate, "NEVER");
  assert.equal(await h.back(app), true);
  assert.equal(app.state.scrollX, 30);
  h.clear();
  assert.equal(h.size(), 0);
  assert.equal(await h.back(app), false);
  assert.ok(changes >= 5);
});
