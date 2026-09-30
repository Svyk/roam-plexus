import assert from "node:assert/strict";
import test from "node:test";

import { createSnapshotScheduler, createSnapshotStore, planRestore } from "../src/host/snapshots.js";

// IndexedDB key order: numbers < strings < arrays; arrays compare element by element.
const rank = (v) => (Array.isArray(v) ? 2 : typeof v === "string" ? 1 : 0);
function cmp(a, b) {
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (Array.isArray(a)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) { const c = cmp(a[i], b[i]); if (c) return c; }
    return a.length - b.length;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}
const fakeRange = { bound: (lower, upper) => ({ lower, upper }) };
const inRange = (k, r) => !r || (cmp(k, r.lower) >= 0 && cmp(k, r.upper) <= 0);

// Fake IndexedDB with named stores keyed on "key", versions, upgrade and block behaviour.
function fakeIdb({ dbs = new Map(), block = false, hang = false, failWrites = 0 } = {}) {
  const state = { opens: [], closed: 0, dbs, failWrites, txs: 0 };
  const later = (fn) => queueMicrotask(fn);
  const req = (produce) => {
    const r = { result: undefined, error: null };
    let out;
    try { out = { value: produce() }; } catch (error) { out = { error }; }
    later(() => {
      if (out.error) { r.error = out.error; r.onerror?.(); } else { r.result = out.value; r.onsuccess?.(); }
    });
    return r;
  };
  function makeDb(rec) {
    const db = {
      get version() { return rec.version; },
      objectStoreNames: { contains: (n) => rec.stores.has(n) },
      createObjectStore: (n) => { rec.stores.set(n, new Map()); },
      transaction(names, mode) {
        state.txs += 1;
        const tx = {};
        const writing = mode === "readwrite";
        let failed = false;
        let failError = null;
        tx.objectStore = (n) => {
          const rows = rec.stores.get(n);
          const sorted = (range) => [...rows.values()].filter((v) => inRange(v.key, range)).sort((a, b) => cmp(a.key, b.key));
          return {
            put: (v) => req(() => {
              if (writing && state.failWrites > 0) {
                state.failWrites -= 1;
                failed = true;
                const e = new Error("quota"); e.name = "QuotaExceededError"; failError = e; throw e;
              }
              rows.set(JSON.stringify(v.key), v);
            }),
            get: (k) => req(() => rows.get(JSON.stringify(k))),
            delete: (k) => req(() => { rows.delete(JSON.stringify(k)); }),
            getAll: (range) => req(() => sorted(range)),
          };
        };
        tx.abort = () => { failed = true; };
        setTimeout(() => { if (failed) { tx.error = failError ?? new Error("aborted"); tx.onabort?.(); } else tx.oncomplete?.(); }, 3);
        return tx;
      },
      close() { state.closed += 1; db.isClosed = true; },
    };
    return db;
  }
  return {
    state,
    open(name, version) {
      state.opens.push({ name, version });
      const r = { result: null };
      later(() => {
        if (hang) return;
        if (block) { r.onblocked?.(); return; }
        let rec = state.dbs.get(name);
        const wanted = version ?? (rec ? rec.version : 1);
        const fresh = !rec;
        if (fresh) { rec = { version: 0, stores: new Map() }; state.dbs.set(name, rec); }
        const db = makeDb(rec);
        r.result = db;
        if (fresh || wanted > rec.version) {
          rec.version = wanted;
          r.onupgradeneeded?.();
        }
        state.last = db;
        r.onsuccess?.();
      });
      return r;
    },
  };
}

const el = (id, extra = {}) => ({ id, type: "rectangle", version: 1, versionNonce: 1, isDeleted: false, x: 0, y: 0, ...extra });
const scene = (n, tag = 0) => Array.from({ length: n }, (_, i) => el(`e${i}`, { version: 1 + tag }));
const mk = (idb, over = {}) => {
  let t = 1000;
  const store = createSnapshotStore({ idb, keyRange: fakeRange, graphName: "g", now: () => (t += 10), openTimeoutMs: 40, disposeWaitMs: 40, ...over });
  return store;
};

test("nothing opens until the first put or list; then a versionless open creates both stores", async () => {
  const idb = fakeIdb();
  const store = mk(idb);
  assert.equal(idb.state.opens.length, 0);
  assert.equal(await store.put("d1", scene(3)), true);
  assert.deepEqual(idb.state.opens, [{ name: "plexus-snapshots", version: undefined }]);
  const rec = idb.state.dbs.get("plexus-snapshots");
  assert.deepEqual([...rec.stores.keys()].sort(), ["snapshotData", "snapshots"]);
  await store.dispose();
});

test("an existing database missing a store is upgraded once at version + 1", async () => {
  const dbs = new Map([["plexus-snapshots", { version: 4, stores: new Map([["snapshots", new Map()]]) }]]);
  const idb = fakeIdb({ dbs });
  const store = mk(idb);
  assert.equal(await store.put("d1", scene(2)), true);
  assert.deepEqual(idb.state.opens.map((o) => o.version), [undefined, 5]);
  assert.equal(dbs.get("plexus-snapshots").version, 5);
  assert.ok(dbs.get("plexus-snapshots").stores.has("snapshotData"));
  await store.dispose();
});

test("an existing complete database is opened without an upgrade", async () => {
  const dbs = new Map([["plexus-snapshots", { version: 3, stores: new Map([["snapshots", new Map()], ["snapshotData", new Map()]]) }]]);
  const idb = fakeIdb({ dbs });
  const store = mk(idb);
  await store.put("d1", scene(2));
  assert.equal(idb.state.opens.length, 1);
  assert.equal(dbs.get("plexus-snapshots").version, 3);
  await store.dispose();
});

test("a blocked or hanging open resolves null and turns the ring off for 60 s", async () => {
  for (const mode of [{ block: true }, { hang: true }]) {
    const idb = fakeIdb(mode);
    let t = 5000;
    const store = createSnapshotStore({ idb, keyRange: fakeRange, graphName: "g", now: () => t, openTimeoutMs: 20 });
    assert.equal(await store.put("d1", scene(2)), false);
    assert.deepEqual(await store.list("d1"), []);
    assert.equal(idb.state.opens.length, 1);
    t += 30000;
    await store.list("d1");
    assert.equal(idb.state.opens.length, 1);
    t += 31000;
    await store.list("d1");
    assert.equal(idb.state.opens.length, 2);
    await store.dispose();
  }
});

test("onversionchange closes the connection and the next call reopens", async () => {
  const idb = fakeIdb();
  const store = mk(idb);
  await store.put("d1", scene(2));
  const db = idb.state.last;
  db.onversionchange();
  assert.equal(db.isClosed, true);
  await store.put("d1", scene(3));
  assert.equal(idb.state.opens.length, 2);
  await store.dispose();
});

test("put stores deleted-free elements; list is newest first from metadata; get returns the elements", async () => {
  const idb = fakeIdb();
  const store = mk(idb);
  await store.put("d1", [...scene(3), el("gone", { isDeleted: true })]);
  await store.put("d1", scene(4));
  await store.put("d2", scene(5));
  const rows = await store.list("d1");
  assert.equal(rows.length, 2);
  assert.ok(rows[0].t > rows[1].t);
  assert.deepEqual(rows.map((r) => r.count), [4, 3]);
  assert.ok(Array.isArray(rows[0].key) && rows[0].key[0] === "g" && rows[0].key[1] === "d1");
  const back = await store.get(rows[1].key);
  assert.deepEqual(back.map((e) => e.id), ["e0", "e1", "e2"]);
  assert.equal(await store.get(["other", "d1", 1]), null);
  const rec = idb.state.dbs.get("plexus-snapshots");
  const meta = [...rec.stores.get("snapshots").values()][0];
  assert.deepEqual(Object.keys(meta).sort(), ["bytes", "count", "drawingUid", "graph", "hash", "key", "t"]);
  assert.equal("elements" in meta, false);
  await store.dispose();
});

test("identical scenes are deduped by signature and by hash; empty scenes are never stored", async () => {
  const idb = fakeIdb();
  const store = mk(idb);
  assert.equal(await store.put("d1", scene(3)), true);
  assert.equal(await store.put("d1", scene(3)), false);
  // Same content under a different signature is caught by the hash.
  assert.equal(await store.put("d1", [...scene(3), el("x", { isDeleted: true })]), false);
  assert.equal((await store.list("d1")).length, 1);
  assert.equal(await store.put("d1", []), false);
  assert.equal(await store.put("d1", [el("x", { isDeleted: true })]), false);
  assert.equal((await store.list("d1")).length, 1);
  // A fresh store (new session) still dedupes against the newest stored row.
  await store.dispose();
  const again = mk(fakeIdb({ dbs: idb.state.dbs }));
  assert.equal(await again.put("d1", scene(3)), false);
  assert.equal(await again.put("d1", scene(3, 1)), true);
  await again.dispose();
});

test("keeps at most 20 snapshots per drawing and leaves other drawings alone", async () => {
  const idb = fakeIdb();
  const store = mk(idb);
  await store.put("d2", scene(2));
  for (let i = 0; i < 23; i++) await store.put("d1", scene(2, i));
  const rows = await store.list("d1");
  assert.equal(rows.length, 20);
  assert.equal((await store.list("d2")).length, 1);
  const rec = idb.state.dbs.get("plexus-snapshots");
  assert.equal(rec.stores.get("snapshots").size, rec.stores.get("snapshotData").size);
  await store.dispose();
});

test("a snapshot over 20 MB is skipped with one warning per drawing", async () => {
  const idb = fakeIdb();
  const store = mk(idb);
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a.join(" "));
  try {
    const huge = [el("big", { text: "x".repeat(21 * 1024 * 1024) })];
    assert.equal(await store.put("d1", huge), false);
    assert.equal(await store.put("d1", [el("big", { text: "y".repeat(21 * 1024 * 1024) })]), false);
  } finally {
    console.warn = orig;
  }
  assert.equal(warns.filter((w) => w.includes("20 MB")).length, 1);
  assert.equal(idb.state.opens.length, 0);
  await store.dispose();
});

test("over 100 MB for the graph deletes the oldest rows across drawings, never a drawing's newest", async () => {
  const idb = fakeIdb();
  const store = mk(idb);
  await store.put("d1", scene(2));
  await store.put("d2", scene(2));
  await store.put("d1", scene(2, 1));
  const rec = idb.state.dbs.get("plexus-snapshots");
  const metaStore = rec.stores.get("snapshots");
  for (const row of metaStore.values()) row.bytes = 40 * 1024 * 1024;
  await store.put("d2", scene(2, 1));
  const left = [...metaStore.values()];
  const d1 = left.filter((r) => r.drawingUid === "d1");
  const d2 = left.filter((r) => r.drawingUid === "d2");
  assert.ok(d1.length >= 1 && d2.length >= 1);
  assert.ok(left.reduce((n, r) => n + r.bytes, 0) <= 100 * 1024 * 1024 + 1024);
  assert.equal(d2.some((r) => r.count === 2 && r.bytes < 1024 * 1024), true);
  assert.equal(rec.stores.get("snapshotData").size, metaStore.size);
  await store.dispose();
});

test("a QuotaExceededError deletes the oldest quarter and retries once, then warns", async () => {
  const idb = fakeIdb();
  const store = mk(idb);
  for (let i = 0; i < 8; i++) await store.put(`d${i}`, scene(2));
  for (let i = 0; i < 4; i++) await store.put("d0", scene(2, i + 1));
  const rec = idb.state.dbs.get("plexus-snapshots");
  const before = rec.stores.get("snapshots").size;
  idb.state.failWrites = 1;
  assert.equal(await store.put("d0", scene(2, 9)), true);
  assert.ok(rec.stores.get("snapshots").size < before + 1);
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a.join(" "));
  try {
    idb.state.failWrites = 3;
    assert.equal(await store.put("d0", scene(2, 10)), false);
  } finally {
    console.warn = orig;
  }
  assert.ok(warns.some((w) => w.includes("not saved")));
  await store.dispose();
});

test("encrypted graph: put, list and get resolve empty and never call idb.open", async () => {
  const idb = fakeIdb();
  const store = mk(idb, { isEncrypted: true });
  assert.equal(await store.put("d1", scene(3)), false);
  assert.deepEqual(await store.list("d1"), []);
  assert.equal(await store.get(["g", "d1", 1]), null);
  await store.dispose();
  assert.equal(idb.state.opens.length, 0);
});

test("dispose waits for puts in progress, then closes the connection; later puts are no-ops", async () => {
  const idb = fakeIdb();
  const store = mk(idb);
  await store.put("d1", scene(2));
  const closedBefore = idb.state.closed;
  const p = store.put("d1", scene(3, 1));
  const d = store.dispose();
  assert.equal(await p, true);
  await d;
  assert.equal(idb.state.closed, closedBefore + 1);
  assert.equal(await store.put("d1", scene(4)), false);
  assert.deepEqual(await store.list("d1"), []);
  const rows = [...idb.state.dbs.get("plexus-snapshots").stores.get("snapshots").values()];
  assert.equal(rows.length, 2);
});

test("dispose while an open is pending closes the database when it arrives", async () => {
  const idb = fakeIdb();
  const store = mk(idb);
  const p = store.put("d1", scene(2));
  await store.dispose();
  assert.equal(await p, false);
  assert.equal(idb.state.last?.isClosed ?? true, true);
});

// Scheduler ---------------------------------------------------------------------------------------------------
function fakeApp(els, state = {}) {
  const subs = new Set();
  return {
    els, state: { isLoading: false, ...state }, unmounted: false,
    getSceneElementsIncludingDeleted() { return this.els; },
    onChangeEmitter: { on: (fn) => { subs.add(fn); return () => subs.delete(fn); } },
    subs,
    change(elements) { this.els = elements; for (const fn of [...subs]) fn(elements, this.state, {}); },
  };
}
function fakeTimers() {
  const pending = new Map();
  let id = 0;
  return {
    pending,
    setTimeout: (fn, ms) => { id += 1; pending.set(id, { fn, ms }); return id; },
    clearTimeout: (i) => { pending.delete(i); },
    fire(ms) {
      const hit = [...pending.entries()].find(([, v]) => v.ms === ms);
      if (!hit) throw new Error(`no timer at ${ms}: ${[...pending.values()].map((v) => v.ms)}`);
      pending.delete(hit[0]);
      hit[1].fn();
    },
  };
}
const tick = () => new Promise((r) => setTimeout(r, 15));
const recorder = () => { const calls = []; return { calls, put: (uid, els) => { calls.push([uid, els]); return Promise.resolve(true); } }; };

test("scheduler: mount snapshot waits for the scene to load, in an idle callback", async () => {
  const app = fakeApp(scene(3), { isLoading: true });
  const store = recorder();
  const timers = fakeTimers();
  const idle = [];
  const s = createSnapshotScheduler({ store, app, drawingUid: "d1", timers, requestIdle: (fn) => idle.push(fn) });
  assert.equal(store.calls.length, 0);
  app.state.isLoading = false;
  timers.fire(250);
  assert.equal(idle.length, 1);
  idle[0]();
  assert.equal(store.calls.length, 1);
  assert.equal(store.calls[0][0], "d1");
  await s.dispose();
});

test("scheduler: gives up waiting for loading after 5 s and snapshots anyway", () => {
  const app = fakeApp(scene(3), { isLoading: true });
  const store = recorder();
  const timers = fakeTimers();
  const idle = [];
  createSnapshotScheduler({ store, app, drawingUid: "d1", timers, requestIdle: (fn) => idle.push(fn) });
  for (let i = 0; i < 20; i++) timers.fire(250);
  assert.equal(idle.length, 1);
});

test("scheduler: interval snapshot retries in 30 s during a gesture, then takes it and reschedules", () => {
  const app = fakeApp(scene(3));
  const store = recorder();
  const timers = fakeTimers();
  const idle = [];
  createSnapshotScheduler({ store, app, drawingUid: "d1", intervalMs: 600000, timers, requestIdle: (fn) => idle.push(fn) });
  idle.splice(0)[0]();
  assert.equal(store.calls.length, 1);
  app.state.cursorButton = "down";
  timers.fire(600000);
  idle.splice(0)[0]();
  assert.equal(store.calls.length, 1);
  timers.fire(30000);
  app.state.cursorButton = "up";
  idle.splice(0)[0]();
  assert.equal(store.calls.length, 2);
  assert.ok([...timers.pending.values()].some((v) => v.ms === 600000));
});

test("scheduler: every busy state defers the interval snapshot", () => {
  for (const patch of [{ editingTextElement: {} }, { newElement: {} }, { resizingElement: {} }, { isResizing: true }, { isRotating: true }]) {
    const app = fakeApp(scene(3), patch);
    const store = recorder();
    const timers = fakeTimers();
    const idle = [];
    createSnapshotScheduler({ store, app, drawingUid: "d1", timers, requestIdle: (fn) => idle.push(fn), loadWaitMs: 0 });
    idle.splice(0);
    timers.fire(600000);
    idle.splice(0)[0]();
    assert.equal(store.calls.length, 0, JSON.stringify(patch));
    assert.ok([...timers.pending.values()].some((v) => v.ms === 30000));
  }
});

test("scheduler: final dispose stores the last captured scene after the app has emptied", async () => {
  const app = fakeApp(scene(3));
  const store = recorder();
  const timers = fakeTimers();
  const s = createSnapshotScheduler({ store, app, drawingUid: "d1", timers, requestIdle: () => {} });
  const captured = scene(4, 2);
  app.change(captured);
  app.change([]);
  app.els = [];
  app.unmounted = true;
  assert.equal(await s.dispose({ final: true }), true);
  assert.equal(store.calls.length, 1);
  assert.equal(store.calls[0][1], captured);
  assert.equal(app.subs.size, 0);
  assert.equal(timers.pending.size, 0);
  assert.equal(await s.dispose({ final: true }), false);
});

test("scheduler: dispose without final stores nothing; nothing is stored for a never-changed empty app", async () => {
  const app = fakeApp([]);
  const store = recorder();
  const timers = fakeTimers();
  const s = createSnapshotScheduler({ store, app, drawingUid: "d1", timers, requestIdle: () => {} });
  assert.equal(await s.snapshotNow("x"), false);
  await s.dispose({ final: true });
  assert.equal(store.calls.length, 0);
  const app2 = fakeApp(scene(2));
  const s2 = createSnapshotScheduler({ store, app: app2, drawingUid: "d1", timers: fakeTimers(), requestIdle: () => {} });
  app2.change(scene(2));
  await s2.dispose();
  assert.equal(store.calls.length, 0);
});

test("scheduler: end to end with the store, final dispose keeps the version after unmount", async () => {
  const idb = fakeIdb();
  const store = mk(idb);
  const app = fakeApp(scene(3));
  const s = createSnapshotScheduler({ store, app, drawingUid: "d1", timers: fakeTimers(), requestIdle: () => {} });
  app.change(scene(5, 1));
  app.els = [];
  app.unmounted = true;
  await s.dispose({ final: true });
  await store.dispose();
  const reader = mk(fakeIdb({ dbs: idb.state.dbs }));
  const rows = await reader.list("d1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 5);
  await reader.dispose();
});

// planRestore -------------------------------------------------------------------------------------------------
test("planRestore: snapshot in snapshot order, current-only live elements deleted, bumped versions", () => {
  const current = [el("a", { version: 5, x: 9 }), el("b", { version: 2 }), el("c", { isDeleted: true, version: 3 }), el("pmm-m-x", { version: 7, x: 1 })];
  const snapshot = [el("b", { version: 1, x: 100 }), el("z", { version: 4 }), el("pmm-m-x", { version: 1, x: 999 }), el("pmm-m-y", { version: 1 })];
  const plan = planRestore({ current, snapshot, files: {}, now: () => 42 });
  assert.deepEqual(plan.next.map((e) => e.id), ["b", "z", "a", "c", "pmm-m-x"]);
  const by = Object.fromEntries(plan.next.map((e) => [e.id, e]));
  assert.equal(by.b.x, 100);
  assert.equal(by.b.version, 3);
  assert.equal(by.b.isDeleted, false);
  assert.equal(by.z.version, 5);
  assert.notEqual(by.b.versionNonce, 1);
  assert.equal(by.b.updated, 42);
  assert.equal(by.a.isDeleted, true);
  assert.equal(by.a.version, 6);
  assert.equal(by.c.isDeleted, true);
  assert.equal(by.c.version, 3);
  assert.equal(by["pmm-m-x"].x, 1);
  assert.equal(by["pmm-m-x"].version, 7);
  assert.equal(plan.restored, 2);
  assert.equal(plan.deleted, 1);
  assert.equal(plan.missingFiles, 0);
});

test("planRestore: counts restored images whose file is missing", () => {
  const snapshot = [el("i1", { type: "image", fileId: "f1" }), el("i2", { type: "image", fileId: "f2" }), el("i3", { type: "image", fileId: null }), el("r")];
  const plan = planRestore({ current: [], snapshot, files: { f1: { id: "f1" } } });
  assert.equal(plan.missingFiles, 1);
  assert.equal(planRestore({ current: [], snapshot }).missingFiles, 2);
  assert.equal(plan.next.length, 4);
});

test("two unawaited puts for one drawing under a fixed clock keep two rows", async () => {
  const idb = fakeIdb();
  const store = mk(idb, { now: () => 5000 });
  const [a, b] = await Promise.all([store.put("d1", scene(3)), store.put("d1", scene(4))]);
  assert.deepEqual([a, b], [true, true]);
  const rows = await store.list("d1");
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map((r) => r.t)).size, 2);
  await store.dispose();
});
