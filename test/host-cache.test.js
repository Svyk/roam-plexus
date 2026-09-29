import test from "node:test";
import assert from "node:assert/strict";
import { createCropCache, cropKey } from "../src/host/cache.js";

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
  assert.equal(cropKey({ regionUid: "r", geometryKey: "g", drawingHash: "h", tier: "svg" }), "r|g|h|svg");
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
  await cache.put("a", blob(10), { w: 1, h: 1 });
  await new Promise((r) => setTimeout(r, 2));
  await cache.put("b", blob(10), { w: 1, h: 1 });
  await new Promise((r) => setTimeout(r, 2));
  await cache.put("c", blob(10), { w: 1, h: 1 });
  assert.deepEqual([...idb.rows.keys()].sort(), ["g|b", "g|c"]);

  const cache2 = createCropCache({ graph: "g", idb, urls: fakeUrls() });
  assert.equal(cache2.peek("c"), null);
  const hit = await cache2.get("c");
  assert.equal(hit.w, 1);
  assert.ok(cache2.peek("c"));
  assert.equal(await cache2.get("zzz"), null);

  const other = createCropCache({ graph: "other", idb, urls: fakeUrls() });
  assert.equal(await other.get("c"), null);

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
