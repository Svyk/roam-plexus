const DB_NAME = "plexus-cache";
const STORE = "crops";

export function cropKey({ regionUid, geometryKey, drawingHash, tier }) {
  return `${regionUid}|${geometryKey}|${drawingHash}|${tier}`;
}

const reqPromise = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const txPromise = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error("aborted"));
});

export function createCropCache({ graph, persist = true, limitBytes = 100 * 2 ** 20, memoryEntries = 300, idb = globalThis.indexedDB, urls = globalThis.URL } = {}) {
  const memory = new Map();
  const prefix = `${graph}|`;
  const useDb = !!(persist && idb);
  let dbPromise = null;
  let disposed = false;
  let knownBytes = 0;
  let scanned = false;

  function revoke(entry) {
    try { urls?.revokeObjectURL?.(entry.url); } catch { /* ignore */ }
  }

  function remember(key, entry) {
    const old = memory.get(key);
    if (old) { memory.delete(key); if (old.url !== entry.url) revoke(old); }
    memory.set(key, entry);
    while (memory.size > memoryEntries) {
      const oldestKey = memory.keys().next().value;
      revoke(memory.get(oldestKey));
      memory.delete(oldestKey);
    }
  }

  function openDb() {
    if (!useDb || disposed) return Promise.resolve(null);
    if (!dbPromise) {
      dbPromise = new Promise((resolve) => {
        try {
          const request = idb.open(DB_NAME, 1);
          request.onupgradeneeded = () => {
            const db = request.result;
            const store = db.createObjectStore(STORE, { keyPath: "key" });
            store.createIndex("ts", "ts");
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => { console.warn("[plexus] cache db unavailable", request.error); resolve(null); };
        } catch (error) {
          console.warn("[plexus] cache db unavailable", error);
          resolve(null);
        }
      });
    }
    return dbPromise;
  }

  async function evictDb(db) {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const rows = [];
    await new Promise((resolve, reject) => {
      const cursorReq = store.index("ts").openCursor();
      cursorReq.onerror = () => reject(cursorReq.error);
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) { resolve(); return; }
        const v = cursor.value;
        if (typeof v.key === "string" && v.key.startsWith(prefix)) rows.push({ key: v.key, size: v.size || 0 });
        cursor.continue();
      };
    });
    let total = rows.reduce((n, r) => n + r.size, 0);
    scanned = true;
    knownBytes = total;
    for (const row of rows) {
      if (total <= limitBytes) break;
      store.delete(row.key);
      total -= row.size;
      knownBytes = total;
    }
    await txPromise(tx);
  }

  return {
    peek(key) {
      const entry = memory.get(key);
      if (!entry) return null;
      memory.delete(key);
      memory.set(key, entry);
      return { url: entry.url, w: entry.w, h: entry.h, type: entry.type };
    },

    async get(key) {
      const hit = this.peek(key);
      if (hit) return hit;
      try {
        const db = await openDb();
        if (!db || disposed) return null;
        const dbKey = prefix + key;
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        const row = await reqPromise(store.get(dbKey));
        if (disposed || !row || !row.blob) return null;
        store.put({ ...row, ts: Date.now() });
        const entry = { url: urls.createObjectURL(row.blob), w: row.w, h: row.h, type: row.type || row.blob.type, size: row.size || 0 };
        remember(key, entry);
        return { url: entry.url, w: entry.w, h: entry.h, type: entry.type };
      } catch (error) {
        console.warn("[plexus] cache read failed", error);
        return null;
      }
    },

    async put(key, blob, { w, h } = {}) {
      if (disposed) return;
      const entry = { url: urls.createObjectURL(blob), w, h, type: blob.type, size: blob.size || 0 };
      remember(key, entry);
      try {
        const db = await openDb();
        if (!db || disposed) return;
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put({ key: prefix + key, blob, w, h, type: blob.type, size: entry.size, ts: Date.now() });
        await txPromise(tx);
        knownBytes += entry.size;
        if (!scanned || knownBytes > limitBytes) await evictDb(db);
      } catch (error) {
        console.warn("[plexus] cache write failed", error);
      }
    },

    async delete(key) {
      const entry = memory.get(key);
      if (entry) { revoke(entry); memory.delete(key); }
      try {
        const db = await openDb();
        if (!db) return;
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(prefix + key);
        await txPromise(tx);
      } catch (error) {
        console.warn("[plexus] cache delete failed", error);
      }
    },

    async clear() {
      knownBytes = 0;
      for (const entry of memory.values()) revoke(entry);
      memory.clear();
      try {
        const db = await openDb();
        if (!db) return;
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        await new Promise((resolve, reject) => {
          const cursorReq = store.openCursor();
          cursorReq.onerror = () => reject(cursorReq.error);
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (!cursor) { resolve(); return; }
            if (typeof cursor.value.key === "string" && cursor.value.key.startsWith(prefix)) cursor.delete();
            cursor.continue();
          };
        });
        await txPromise(tx);
      } catch (error) {
        console.warn("[plexus] cache clear failed", error);
      }
    },

    dispose() {
      disposed = true;
      for (const entry of memory.values()) revoke(entry);
      memory.clear();
      const p = dbPromise;
      dbPromise = null;
      p?.then((db) => { try { db?.close(); } catch { /* ignore */ } });
    },
  };
}
