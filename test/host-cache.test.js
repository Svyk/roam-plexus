import test from "node:test";
import assert from "node:assert/strict";
import { createCropCache, cropKey, CACHE_VERSION } from "../src/host/cache.js";

function fakeUrls() {
  let n = 0;
  const live = new Set();
  return {
    live,
    createObjectURL: () => { const u = `blob:${++n}`; live.add(u); return u; },
    revokeObjectURL: (u) => { live.delete(u); },
  };
}
const blob = (size = 10, type = "image/png") => ({ size, type });

test("cropKey format", () => {
  assert.equal(cropKey({ regionUid: "r", geometryKey: "g", drawingHash: "h", tier: "svg" }), "v3|r|g|h|svg");
  assert.equal(CACHE_VERSION, 3);
});

test("memory-only: put, peek, get, clear", async () => {
  const urls = fakeUrls();
  const cache = createCropCache({ graph: "g", idb: undefined, urls });
  assert.equal(cache.peek("k"), null);
  assert.equal(await cache.get("k"), null);
  await cache.put("k", blob(), { w: 3, h: 4 });
  const hit = cache.peek("k");
  assert.equal(hit.w, 3);
  assert.equal(hit.h, 4);
  assert.equal(hit.type, "image/png");
  assert.deepEqual(await cache.get("k"), hit);
  await cache.clear();
  assert.equal(cache.peek("k"), null);
  assert.equal(urls.live.size, 0);
});

test("LRU eviction revokes URLs and peek refreshes recency", async () => {
  const urls = fakeUrls();
  const cache = createCropCache({ graph: "g", idb: undefined, urls, memoryEntries: 2 });
  await cache.put("a", blob(), { w: 1, h: 1 });
  await cache.put("b", blob(), { w: 1, h: 1 });
  cache.peek("a");
  await cache.put("c", blob(), { w: 1, h: 1 });
  assert.ok(cache.peek("a"));
  assert.equal(cache.peek("b"), null);
  assert.ok(cache.peek("c"));
  assert.equal(urls.live.size, 2);
});

test("replacing a key revokes the old URL; dispose revokes all", async () => {
  const urls = fakeUrls();
  const cache = createCropCache({ graph: "g", idb: undefined, urls });
  await cache.put("a", blob(), { w: 1, h: 1 });
  await cache.put("a", blob(), { w: 2, h: 2 });
  assert.equal(urls.live.size, 1);
  cache.dispose();
  assert.equal(urls.live.size, 0);
});

// Minimal IndexedDB fake.
function fakeIdb() {
  const rows = new Map();
  const later = (fn) => queueMicrotask(fn);
  const request = (produce) => {
    const r = { result: undefined, error: null };
    later(() => { r.result = produce(); r.onsuccess?.(); });
    return r;
  };
  const store = {
    put: (v) => request(() => { rows.set(v.key, v); return v.key; }),
    get: (k) => request(() => rows.get(k)),
    delete: (k) => request(() => { rows.delete(k); }),
    index: () => ({ openCursor: () => cursorOver([...rows.values()].sort((a, b) => a.ts - b.ts)) }),
    openCursor: () => cursorOver([...rows.values()]),
  };
  function cursorOver(list) {
    const r = { result: null, error: null };
    let i = 0;
    const step = () => later(() => {
      r.result = i < list.length ? { value: list[i], continue: () => { i++; step(); }, delete: () => { rows.delete(list[i].key); } } : null;
      r.onsuccess?.();
    });
    step();
    return r;
  }
  const db = {
    createObjectStore: () => ({ createIndex() {} }),
    transaction: () => {
      const tx = { objectStore: () => store };
      setTimeout(() => tx.oncomplete?.(), 5);
      return tx;
    },
    close() { db.closed = true; },
  };
  return {
    rows, db,
    open: () => { const r = { result: db }; later(() => { r.onupgradeneeded?.(); r.onsuccess?.(); }); return r; },
  };
}

test("IndexedDB: persists with graph prefix, hydrates, evicts to limit", async () => {
  const idb = fakeIdb();
  const urls = fakeUrls();
  const cache = createCropCache({ graph: "g", idb, urls, limitBytes: 25 });
  await cache.put("v3|a", blob(10), { w: 1, h: 1 });
  await new Promise((r) => setTimeout(r, 2));
  await cache.put("v3|b", blob(10), { w: 1, h: 1 });
  await new Promise((r) => setTimeout(r, 2));
  await cache.put("v3|c", blob(10), { w: 1, h: 1 });
  assert.deepEqual([...idb.rows.keys()].sort(), ["g|v3|b", "g|v3|c"]);

  const cache2 = createCropCache({ graph: "g", idb, urls: fakeUrls() });
  assert.equal(cache2.peek("v3|c"), null);
  const hit = await cache2.get("v3|c");
  assert.equal(hit.w, 1);
  assert.ok(cache2.peek("v3|c"));
  assert.equal(await cache2.get("zzz"), null);

  const other = createCropCache({ graph: "other", idb, urls: fakeUrls() });
  assert.equal(await other.get("v3|c"), null);

  await cache.clear();
  assert.equal(idb.rows.size, 0);
  cache.dispose();
  await new Promise((r) => setTimeout(r, 1));
  assert.equal(idb.db.closed, true);
});

test("persist=false ignores idb", async () => {
  const idb = fakeIdb();
  const cache = createCropCache({ graph: "g", idb, persist: false, urls: fakeUrls() });
  await cache.put("a", blob(), { w: 1, h: 1 });
  assert.equal(idb.rows.size, 0);
});

test("dispose while an IndexedDB read is pending does not leak an object URL", async () => {
  const idb = fakeIdb();
  const urls = fakeUrls();
  const writer = createCropCache({ graph: "g", idb, urls: fakeUrls() });
  await writer.put("k", blob(), { w: 1, h: 1 });
  const cache = createCropCache({ graph: "g", idb, urls });
  const realGet = idb.rows.get.bind(idb.rows);
  idb.rows.get = (key) => { cache.dispose(); return realGet(key); };
  assert.equal(await cache.get("k"), null);
  assert.equal(urls.live.size, 0);
});

test("put scans the store once, then only when the tracked size passes the limit", async () => {
  const idb = fakeIdb();
  const realTx = idb.db.transaction;
  let transactions = 0;
  idb.db.transaction = (...a) => { transactions += 1; return realTx(...a); };
  const cache = createCropCache({ graph: "g", idb, urls: fakeUrls(), limitBytes: 1000 });
  for (let i = 0; i < 5; i++) await cache.put(`k${i}`, blob(10), { w: 1, h: 1 });
  assert.equal(transactions, 7); // 1 stale-version purge at open + 1 initial scan + 5 puts
  const small = createCropCache({ graph: "g", idb, urls: fakeUrls(), limitBytes: 25 });
  transactions = 0;
  await small.put("z", blob(10), { w: 1, h: 1 });
  assert.equal(transactions, 3); // purge at open, put, scan
});

test("delete drops the memory entry, revokes its URL, and removes the row", async () => {
  const idb = fakeIdb();
  const urls = fakeUrls();
  const cache = createCropCache({ graph: "g", idb, urls });
  await cache.put("k", blob(), { w: 1, h: 1 });
  await cache.delete("k");
  assert.equal(cache.peek("k"), null);
  assert.equal(urls.live.size, 0);
  assert.equal(idb.rows.has("g|k"), false);
});

test("open purges this graph's rows from older cache versions, keeps current and other graphs", async () => {
  const idb = fakeIdb();
  const row = (key) => ({ key, blob: blob(), w: 1, h: 1, type: "image/png", size: 10, ts: 1 });
  for (const k of ["g|old|geom|hash|png", "g|v1|old|geom|hash|png", "g|v3|keep", "other|old|x", "other|v3|keep"]) idb.rows.set(k, row(k));
  const cache = createCropCache({ graph: "g", idb, urls: fakeUrls() });
  assert.equal(await cache.get("v3|missing"), null);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual([...idb.rows.keys()].sort(), ["g|v3|keep", "other|old|x", "other|v3|keep"]);
  const stale = await cache.get("old|geom|hash|png");
  assert.equal(stale, null);
});

test("put with persist:false stays in memory only", async () => {
  const idb = fakeIdb();
  const cache = createCropCache({ graph: "g", idb, urls: fakeUrls() });
  await cache.put("v3|mem", blob(), { w: 1, h: 1, persist: false });
  assert.ok(cache.peek("v3|mem"));
  assert.equal(idb.rows.size, 0);
});
