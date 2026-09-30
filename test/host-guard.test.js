import assert from "node:assert/strict";
import test from "node:test";

import { createWriteGuard, directGuard } from "../src/host/guard.js";

const el = (id, extra = {}) => ({ id, type: "rectangle", version: 1, versionNonce: 1, isDeleted: false, x: 0, y: 0, ...extra });
const many = (n) => Array.from({ length: n }, (_, i) => el(`e${i}`));
const gone = (e) => ({ ...e, isDeleted: true, version: e.version + 1 });

function fixture(n = 50, over = {}) {
  const app = {
    els: many(n),
    updates: [],
    getSceneElementsIncludingDeleted() { return this.els; },
    updateScene(u) { this.updates.push(u); if (u.elements) this.els = u.elements; },
  };
  const toasts = [];
  const toaster = { show: (message, opts) => toasts.push({ message, opts }) };
  const guard = createWriteGuard({ toaster, ...over });
  return { app, toasts, guard };
}

const dropTo = (keep) => (current) => current.map((e, i) => (i < keep ? e : gone(e)));

test("a write dropping to a fifth or less of more than 10 elements is refused with Apply anyway", () => {
  const { app, toasts, guard } = fixture(50);
  const ok = guard.guardedWrite(app, { drawingUid: "d1", next: dropTo(10), label: "Remove", captureUpdate: "IMMEDIATELY" });
  assert.equal(ok, false);
  assert.equal(app.updates.length, 0);
  assert.equal(toasts[0].message, "Not applied: would remove 40 of 50");
  assert.equal(toasts[0].opts.action.label, "Apply anyway");
  assert.equal(typeof toasts[0].opts.onHide, "function");
});

test("thresholds: 11 of 50 stays, 10 of 50 is refused, 10 or fewer elements are never refused", () => {
  const a = fixture(50);
  assert.equal(a.guard.guardedWrite(a.app, { drawingUid: "d1", next: dropTo(11) }), true);
  const b = fixture(50);
  assert.equal(b.guard.guardedWrite(b.app, { drawingUid: "d1", next: dropTo(10) }), false);
  const c = fixture(10);
  assert.equal(c.guard.guardedWrite(c.app, { drawingUid: "d1", next: dropTo(0) }), true);
  const d = fixture(11);
  assert.equal(d.guard.guardedWrite(d.app, { drawingUid: "d1", next: dropTo(2) }), false);
  const e = fixture(50);
  assert.equal(e.guard.guardedWrite(e.app, { drawingUid: "d1", next: dropTo(0), force: true }), true);
});

test("captureUpdate is forwarded only when given, and appState passes through", () => {
  const { app, guard } = fixture(3);
  guard.guardedWrite(app, { drawingUid: "d1", next: app.els });
  guard.guardedWrite(app, { drawingUid: "d1", next: app.els, captureUpdate: "NEVER", appState: { a: 1 } });
  assert.equal("captureUpdate" in app.updates[0], false);
  assert.equal(app.updates[1].captureUpdate, "NEVER");
  assert.deepEqual(app.updates[1].appState, { a: 1 });
});

test("an identical refusal while its toast is visible does not toast again; a different one does", () => {
  const { app, toasts, guard } = fixture(50);
  const opts = { drawingUid: "d1", next: dropTo(5), label: "Remove" };
  guard.guardedWrite(app, opts);
  guard.guardedWrite(app, opts);
  assert.equal(toasts.length, 1);
  guard.guardedWrite(app, { ...opts, label: "Mind map" });
  assert.equal(toasts.length, 2);
  toasts[1].opts.onHide();
  guard.guardedWrite(app, { ...opts, label: "Mind map" });
  assert.equal(toasts.length, 3);
});

test("Apply anyway with an array applies it when the scene signature still matches", () => {
  const { app, toasts, guard } = fixture(50);
  const next = dropTo(5)(app.els);
  guard.guardedWrite(app, { drawingUid: "d1", next, label: "Remove", captureUpdate: "IMMEDIATELY" });
  toasts[0].opts.action.run();
  assert.equal(app.updates.length, 1);
  assert.equal(app.updates[0].elements, next);
  assert.equal(guard.hasSnapshot("d1"), true);
});

test("Apply anyway with an array refuses to apply over a changed scene", () => {
  const { app, toasts, guard } = fixture(50);
  guard.guardedWrite(app, { drawingUid: "d1", next: dropTo(5)(app.els) });
  app.els = app.els.map((e, i) => (i === 0 ? { ...e, version: 9 } : e));
  toasts[0].opts.action.run();
  assert.equal(app.updates.length, 0);
  assert.equal(toasts.at(-1).message, "The drawing changed; run it again");
});

test("Apply anyway re-evaluates a function next, or calls onApplyAnyway instead", () => {
  const a = fixture(50);
  let calls = 0;
  const next = (cur) => { calls += 1; return dropTo(5)(cur); };
  a.guard.guardedWrite(a.app, { drawingUid: "d1", next });
  a.app.els = [...a.app.els, el("late")];
  a.toasts[0].opts.action.run();
  assert.equal(calls, 2);
  assert.equal(a.app.updates.length, 1);
  assert.ok(a.app.updates[0].elements.some((e) => e.id === "late"));

  const b = fixture(50);
  const seen = [];
  b.guard.guardedWrite(b.app, { drawingUid: "d1", next: dropTo(5), onApplyAnyway: () => seen.push("cb") });
  b.toasts[0].opts.action.run();
  assert.deepEqual(seen, ["cb"]);
  assert.equal(b.app.updates.length, 0);
});

test("Apply anyway says the drawing is closed when the app is no longer active, and is single use", () => {
  let active = true;
  const { app, toasts, guard } = fixture(50, { isActive: () => active });
  guard.guardedWrite(app, { drawingUid: "d1", next: dropTo(5)(app.els) });
  active = false;
  toasts[0].opts.action.run();
  assert.equal(app.updates.length, 0);
  assert.equal(toasts.at(-1).message, "Drawing is no longer open");
  // The refusal toast can show again once the closure is gone.
  active = true;
  guard.guardedWrite(app, { drawingUid: "d1", next: dropTo(5)(app.els) });
  assert.equal(toasts.filter((t) => t.message.startsWith("Not applied")).length, 2);
});

test("snapshots: only applied removals, never NEVER, delta clones survive in-place mutation", () => {
  const { app, guard } = fixture(20);
  guard.guardedWrite(app, { drawingUid: "d1", next: (cur) => [...cur, el("added")], captureUpdate: "IMMEDIATELY" });
  assert.equal(guard.hasSnapshot("d1"), false);
  guard.guardedWrite(app, { drawingUid: "d1", next: (cur) => cur.map((e) => (e.id === "e0" ? { ...e, x: 5, version: 2 } : e)) });
  assert.equal(guard.hasSnapshot("d1"), false);
  guard.guardedWrite(app, { drawingUid: "d1", next: (cur) => cur.map((e) => (e.id === "e1" ? gone(e) : e)), captureUpdate: "NEVER", label: "Mind map" });
  assert.equal(guard.hasSnapshot("d1"), false);
  const victim = app.els.find((e) => e.id === "e2");
  guard.guardedWrite(app, { drawingUid: "d1", next: (cur) => cur.map((e) => (e.id === "e2" ? gone(e) : e)), label: "Remove" });
  assert.equal(guard.hasSnapshot("d1"), true);
  victim.x = 999;
  assert.equal(guard.restoreLast(app, "d1"), 1);
  assert.equal(app.els.find((e) => e.id === "e2").x, 0);
});

test("the ring keeps 5 entries per drawing and 10 drawings, oldest first out", () => {
  const { app, guard } = fixture(30);
  for (let i = 0; i < 7; i += 1) {
    guard.guardedWrite(app, { drawingUid: "d1", next: (cur) => cur.map((e) => (e.id === `e${i}` ? gone(e) : e)) });
  }
  let restored = 0;
  while (guard.hasSnapshot("d1")) {
    guard.restoreLast(app, "d1");
    restored += 1;
  }
  assert.equal(restored, 5);

  const lru = fixture(30);
  for (let i = 0; i < 11; i += 1) {
    lru.guard.guardedWrite(lru.app, { drawingUid: `dr${i}`, next: (cur) => cur.map((e) => (e.id === `e${i}` ? gone(e) : e)) });
  }
  assert.equal(lru.guard.hasSnapshot("dr0"), false);
  assert.equal(lru.guard.hasSnapshot("dr1"), true);
  assert.equal(lru.guard.hasSnapshot("dr10"), true);
});

test("restoreLast puts removed elements back, deletes added ones, keeps later user edits, and Undo-able via IMMEDIATELY", () => {
  const { app, toasts, guard } = fixture(50);
  guard.guardedWrite(app, {
    drawingUid: "d1",
    label: "Remove",
    next: (cur) => [...dropTo(10)(cur), el("made")],
    force: true,
  });
  // A user edit after the write survives; a user-drawn element stays.
  app.els = app.els.map((e) => (e.id === "e3" ? { ...e, x: 77, version: e.version + 1 } : e));
  app.els.push(el("user"));
  const n = guard.restoreLast(app, "d1");
  assert.equal(n, 40);
  const last = app.updates.at(-1);
  assert.equal(last.captureUpdate, "IMMEDIATELY");
  const byId = new Map(app.els.map((e) => [e.id, e]));
  assert.equal(byId.get("e20").isDeleted, false);
  assert.ok(byId.get("e20").version > 2);
  assert.equal(byId.get("made").isDeleted, true);
  assert.equal(byId.get("e3").x, 77);
  assert.equal(byId.get("user").isDeleted, false);
  assert.equal(toasts.at(-1).message, "Restored 40 elements; Undo reverses this");
  assert.equal(guard.hasSnapshot("d1"), false);
  assert.equal(guard.restoreLast(app, "d1"), 0);
  assert.equal(toasts.at(-1).message, "Nothing to restore");
});

test("restoreLast appends a removed element that is missing from the scene and refuses when inactive", () => {
  let active = true;
  const { app, toasts, guard } = fixture(20, { isActive: () => active });
  guard.guardedWrite(app, { drawingUid: "d1", next: (cur) => cur.map((e) => (e.id === "e0" ? gone(e) : e)) });
  app.els = app.els.filter((e) => e.id !== "e0");
  active = false;
  assert.equal(guard.restoreLast(app, "d1"), 0);
  assert.equal(toasts.at(-1).message, "Drawing is no longer open");
  active = true;
  assert.equal(guard.restoreLast(app, "d1"), 1);
  assert.ok(app.els.some((e) => e.id === "e0" && !e.isDeleted));
});

test("dispose clears the ring and pending closure; directGuard writes plainly", () => {
  const { app, toasts, guard } = fixture(50);
  guard.guardedWrite(app, { drawingUid: "d1", next: (cur) => cur.map((e, i) => (i === 0 ? gone(e) : e)) });
  guard.guardedWrite(app, { drawingUid: "d2", next: dropTo(5)(app.els) });
  guard.dispose();
  assert.equal(guard.hasSnapshot("d1"), false);
  toasts[0].opts.action.run();
  assert.equal(app.updates.length, 1);
  assert.equal(guard.guardedWrite(app, { drawingUid: "d1", next: [] }), false);

  const direct = fixture(50);
  assert.equal(directGuard.guardedWrite(direct.app, { next: [], captureUpdate: "IMMEDIATELY" }), true);
  assert.deepEqual(direct.app.updates, [{ elements: [], captureUpdate: "IMMEDIATELY" }]);
  assert.equal(directGuard.restoreLast(), 0);
});
