import { fnv1a } from "../model/hash.js";
import { signature } from "./guard.js";

const DB_NAME = "plexus-snapshots";
const META = "snapshots";
const DATA = "snapshotData";
const PER_DRAWING = 20;
const MAX_SNAPSHOT_BYTES = 20 * 1024 * 1024;
const MAX_GRAPH_BYTES = 100 * 1024 * 1024;
const OPEN_TIMEOUT_MS = 3000;
const OFF_MS = 60000;
const DISPOSE_WAIT_MS = 1000;

const nonce = () => Math.floor(Math.random() * 2 ** 31);
const live = (els) => (els || []).filter((e) => e && !e.isDeleted);

const request = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error ?? new Error("IndexedDB request failed"));
});

const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
  tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
});

const isQuota = (error) => error?.name === "QuotaExceededError";

// Persistent ring of drawing versions in IndexedDB (DATA-1). Metadata and data live in separate stores so listing never
// loads element JSON. Everything resolves quietly: a snapshot that cannot be taken is a warning, never an error.
export function createSnapshotStore({
  idb,
  keyRange = globalThis.IDBKeyRange,
  graphName,
  isEncrypted = false,
  now = () => Date.now(),
  timers = { setTimeout: (...a) => globalThis.setTimeout(...a), clearTimeout: (...a) => globalThis.clearTimeout(...a) },
  openTimeoutMs = OPEN_TIMEOUT_MS,
  disposeWaitMs = DISPOSE_WAIT_MS,
} = {}) {
  const graph = String(graphName ?? "");
  const enabled = !!idb && !!keyRange && !isEncrypted;
  let disposed = false;
  let dbPromise = null;
  let offUntil = 0;
  const inflight = new Set();
  const lastSig = new Map();
  const lastHash = new Map();
  const lastT = new Map();
  const warned = new Set();

  const drawingRange = (uid) => keyRange.bound([graph, uid, 0], [graph, uid, Infinity]);
  const graphRange = () => keyRange.bound([graph], [graph, []]);

  const warnOnce = (uid, message) => {
    if (warned.has(uid)) return;
    warned.add(uid);
    console.warn(`[plexus] snapshots: ${message}`);
  };

  // One open attempt. Resolves null on error, block, or timeout; a database that arrives after that is closed at once.
  function openRequest(version) {
    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const finish = (db) => {
        if (settled) {
          try { db?.close?.(); } catch { /* ignore */ }
          return;
        }
        settled = true;
        if (timer != null) timers.clearTimeout(timer);
        resolve(db);
      };
      try {
        const req = version ? idb.open(DB_NAME, version) : idb.open(DB_NAME);
        timer = timers.setTimeout(() => finish(null), openTimeoutMs);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "key" });
          if (!db.objectStoreNames.contains(DATA)) db.createObjectStore(DATA, { keyPath: "key" });
        };
        req.onblocked = () => finish(null);
        req.onerror = () => { console.warn("[plexus] snapshots db unavailable", req.error); finish(null); };
        req.onsuccess = () => {
          const db = req.result;
          if (settled || disposed) {
            try { db.close(); } catch { /* ignore */ }
            finish(null);
            return;
          }
          finish(db);
        };
      } catch (error) {
        console.warn("[plexus] snapshots db unavailable", error);
        finish(null);
      }
    });
  }

  const hasStores = (db) => db.objectStoreNames.contains(META) && db.objectStoreNames.contains(DATA);

  async function openOnce() {
    let db = await openRequest();
    if (db && !hasStores(db)) {
      const next = db.version + 1;
      try { db.close(); } catch { /* ignore */ }
      db = await openRequest(next);
      if (db && !hasStores(db)) {
        try { db.close(); } catch { /* ignore */ }
        db = null;
      }
    }
    if (db) {
      const mine = db;
      db.onversionchange = () => {
        try { mine.close(); } catch { /* ignore */ }
        dbPromise = null;
      };
    }
    return db;
  }

  function openDb() {
    if (!enabled || disposed || now() < offUntil) return Promise.resolve(null);
    if (!dbPromise) {
      const p = openOnce().then((db) => {
        if (!db) {
          offUntil = now() + OFF_MS;
          if (dbPromise === p) dbPromise = null;
        }
        return db;
      });
      dbPromise = p;
    }
    return dbPromise;
  }

  // Delete rows past the per-drawing cap, then the oldest rows across drawings past the graph byte cap; never a
  // drawing's newest row.
  async function trim(metaStore, dataStore, uid) {
    const own = (await request(metaStore.getAll(drawingRange(uid)))).sort((a, b) => a.t - b.t);
    const drop = (row) => { metaStore.delete(row.key); dataStore.delete(row.key); };
    for (const row of own.slice(0, Math.max(0, own.length - PER_DRAWING))) drop(row);
    const all = await request(metaStore.getAll(graphRange()));
    let total = 0;
    for (const row of all) total += row.bytes || 0;
    if (total <= MAX_GRAPH_BYTES) return;
    const newest = new Map();
    for (const row of all) if (!newest.has(row.key[1]) || newest.get(row.key[1]).t < row.t) newest.set(row.key[1], row);
    for (const row of all.filter((r) => newest.get(r.key[1]) !== r).sort((a, b) => a.t - b.t)) {
      if (total <= MAX_GRAPH_BYTES) break;
      drop(row);
      total -= row.bytes || 0;
    }
  }

  async function write(db, uid, meta, elementsJson) {
    const tx = db.transaction([META, DATA], "readwrite");
    const metaStore = tx.objectStore(META);
    const dataStore = tx.objectStore(DATA);
    const finished = done(tx);
    finished.catch(() => {});
    try {
      metaStore.put(meta);
      dataStore.put({ key: meta.key, elements: elementsJson });
      await trim(metaStore, dataStore, uid);
    } catch (error) {
      try { tx.abort?.(); } catch { /* ignore */ }
      throw error;
    }
    await finished;
  }

  async function evictQuarter(db) {
    const tx = db.transaction([META, DATA], "readwrite");
    const metaStore = tx.objectStore(META);
    const dataStore = tx.objectStore(DATA);
    const finished = done(tx);
    finished.catch(() => {});
    const all = await request(metaStore.getAll(graphRange()));
    const newest = new Map();
    for (const row of all) if (!newest.has(row.key[1]) || newest.get(row.key[1]).t < row.t) newest.set(row.key[1], row);
    const old = all.filter((r) => newest.get(r.key[1]) !== r).sort((a, b) => a.t - b.t);
    for (const row of old.slice(0, Math.ceil(all.length / 4))) {
      metaStore.delete(row.key);
      dataStore.delete(row.key);
    }
    await finished;
  }

  async function newestRow(db, uid) {
    const tx = db.transaction([META], "readonly");
    const rows = await request(tx.objectStore(META).getAll(drawingRange(uid)));
    return rows.reduce((best, r) => (!best || r.t > best.t ? r : best), null);
  }

  async function doPut(uid, elements) {
    if (!enabled || disposed || !uid) return false;
    const els = live(elements);
    if (!els.length) return false;
    const sig = signature(els);
    if (lastSig.get(uid) === sig) return false;
    const json = JSON.stringify(els);
    if (json.length > MAX_SNAPSHOT_BYTES) {
      warnOnce(uid, "drawing is over 20 MB, not snapshotted");
      return false;
    }
    const hash = fnv1a(json);
    const db = await openDb();
    if (!db) return false;
    let newest = null;
    if (!lastHash.has(uid)) {
      newest = await newestRow(db, uid);
      if (newest) lastHash.set(uid, newest.hash);
    }
    if (lastHash.get(uid) === hash) {
      lastSig.set(uid, sig);
      return false;
    }
    const prevT = newest ? newest.t : (lastT.get(uid) ?? 0);
    const t = Math.max(now(), prevT + 1, (lastT.get(uid) ?? 0) + 1);
    lastT.set(uid, t);
    const meta = { key: [graph, uid, t], graph, drawingUid: uid, t, count: els.length, hash, bytes: json.length };
    try {
      try {
        await write(db, uid, meta, json);
      } catch (error) {
        if (!isQuota(error)) throw error;
        await evictQuarter(db);
        await write(db, uid, meta, json);
      }
    } catch (error) {
      console.warn("[plexus] snapshot not saved", error);
      return false;
    }
    lastSig.set(uid, sig);
    lastHash.set(uid, hash);
    lastT.set(uid, t);
    return true;
  }

  function put(drawingUid, elements) {
    if (!enabled || disposed) return Promise.resolve(false);
    const p = doPut(drawingUid, elements).catch((error) => {
      console.warn("[plexus] snapshot failed", error);
      return false;
    });
    inflight.add(p);
    p.then(() => inflight.delete(p));
    return p;
  }

  async function list(drawingUid) {
    if (!enabled || disposed) return [];
    try {
      const db = await openDb();
      if (!db || disposed) return [];
      const tx = db.transaction([META], "readonly");
      const rows = await request(tx.objectStore(META).getAll(drawingRange(drawingUid)));
      return rows
        .sort((a, b) => b.t - a.t)
        .map((r) => ({ key: r.key, t: r.t, count: r.count, hash: r.hash, bytes: r.bytes }));
    } catch (error) {
      console.warn("[plexus] snapshot list failed", error);
      return [];
    }
  }

  async function get(key) {
    if (!enabled || disposed || !Array.isArray(key) || key[0] !== graph) return null;
    try {
      const db = await openDb();
      if (!db || disposed) return null;
      const tx = db.transaction([DATA], "readonly");
      const row = await request(tx.objectStore(DATA).get(key));
      return row ? JSON.parse(row.elements) : null;
    } catch (error) {
      console.warn("[plexus] snapshot read failed", error);
      return null;
    }
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    const wait = (p) => new Promise((resolve) => {
      const timer = timers.setTimeout(resolve, disposeWaitMs);
      Promise.resolve(p).then(() => { timers.clearTimeout(timer); resolve(); }, () => { timers.clearTimeout(timer); resolve(); });
    });
    if (inflight.size) await wait(Promise.all([...inflight]));
    const p = dbPromise;
    dbPromise = null;
    if (p) {
      let db = null;
      await wait(p.then((d) => { db = d; }));
      try { db?.close?.(); } catch { /* ignore */ }
    }
  }

  return { put, list, get, dispose, isEnabled: () => enabled && !disposed };
}

const BUSY_STATE = ["editingTextElement", "newElement", "resizingElement", "isResizing", "isRotating"];
const busy = (state) => !!state && (state.cursorButton === "down" || BUSY_STATE.some((k) => !!state[k]));

// Takes a snapshot on mount (once loaded), every intervalMs while the hash may have changed, and on final dispose.
// Excalidraw has emptied its scene by the time an unmount is reported, so the last scene array seen through
// onChangeEmitter is what dispose({final: true}) stores.
export function createSnapshotScheduler({
  store,
  app,
  drawingUid,
  intervalMs = 600000,
  timers = { setTimeout: (...a) => globalThis.setTimeout(...a), clearTimeout: (...a) => globalThis.clearTimeout(...a) },
  requestIdle = (fn) => (typeof globalThis.requestIdleCallback === "function" ? globalThis.requestIdleCallback(fn, { timeout: 5000 }) : timers.setTimeout(fn, 0)),
  loadPollMs = 250,
  loadWaitMs = 5000,
  retryMs = 30000,
} = {}) {
  let disposed = false;
  let last = null;
  let unsubscribe = null;
  let intervalTimer = null;
  let loadTimer = null;

  const idle = (fn) => {
    try { requestIdle(() => { if (!disposed) fn(); }); } catch (error) { console.warn("[plexus] snapshot idle failed", error); }
  };

  try {
    const off = app?.onChangeEmitter?.on?.((elements) => {
      if (elements && elements.length) last = elements;
    });
    unsubscribe = typeof off === "function" ? off : null;
  } catch (error) {
    console.warn("[plexus] snapshot subscribe failed", error);
  }

  const source = () => {
    if (app && app.unmounted !== true) {
      try {
        const els = app.getSceneElementsIncludingDeleted?.();
        if (els && els.length) return els;
      } catch { /* fall back to the last captured scene */ }
    }
    return last;
  };

  function snapshotNow() {
    if (disposed) return Promise.resolve(false);
    const els = source();
    if (!els || !els.length) return Promise.resolve(false);
    return store.put(drawingUid, els);
  }

  const scheduleInterval = (ms) => {
    if (disposed || !(ms > 0)) return;
    intervalTimer = timers.setTimeout(() => {
      intervalTimer = null;
      idle(() => {
        if (busy(app?.state)) {
          scheduleInterval(retryMs);
          return;
        }
        snapshotNow();
        scheduleInterval(intervalMs);
      });
    }, ms);
  };

  let waited = 0;
  const pollLoaded = () => {
    loadTimer = null;
    if (disposed) return;
    if (!app?.state?.isLoading || waited >= loadWaitMs) {
      idle(() => snapshotNow());
      return;
    }
    waited += loadPollMs;
    loadTimer = timers.setTimeout(pollLoaded, loadPollMs);
  };
  pollLoaded();
  scheduleInterval(intervalMs);

  async function dispose({ final = false } = {}) {
    if (disposed) return false;
    const keep = last;
    disposed = true;
    if (intervalTimer != null) timers.clearTimeout(intervalTimer);
    if (loadTimer != null) timers.clearTimeout(loadTimer);
    intervalTimer = null;
    loadTimer = null;
    try { unsubscribe?.(); } catch { /* ignore */ }
    unsubscribe = null;
    last = null;
    if (final && keep && keep.length) return store.put(drawingUid, keep);
    return false;
  }

  return { snapshotNow, dispose };
}

// Pure plan for restoring a saved version over the current scene. `snapshot` is the live element array of the saved
// version, `current` the scene including deleted elements, `files` the App's files map. Mind-map projections (pmm-)
// keep their current state on both sides: the outline owns them.
export function planRestore({ current = [], snapshot = [], files, now = () => Date.now() } = {}) {
  const stamp = now();
  const byId = new Map();
  for (const el of current) if (el) byId.set(el.id, el);
  const owned = (el) => typeof el?.id === "string" && el.id.startsWith("pmm-");
  const bump = (el, from, extra) => ({
    ...el,
    ...extra,
    version: Math.max(from?.version || 0, el.version || 0) + 1,
    versionNonce: nonce(),
    updated: stamp,
  });
  const next = [];
  const kept = new Set();
  let missingFiles = 0;
  for (const el of snapshot) {
    if (!el || owned(el)) continue;
    kept.add(el.id);
    next.push(bump(el, byId.get(el.id), { isDeleted: false }));
    if (el.type === "image" && el.fileId && !files?.[el.fileId]) missingFiles += 1;
  }
  const restored = next.length;
  let deleted = 0;
  for (const el of current) {
    if (!el || kept.has(el.id)) continue;
    if (owned(el) || el.isDeleted) {
      next.push(el);
      continue;
    }
    next.push(bump(el, el, { isDeleted: true }));
    deleted += 1;
  }
  return { next, restored, deleted, missingFiles };
}
