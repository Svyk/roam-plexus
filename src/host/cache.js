export function cropKey({ regionUid, geometryKey, drawingHash, tier }) {
  return `${regionUid}|${geometryKey}|${drawingHash}|${tier}`;
}

export function createCropCache({ graph, persist = true, limitBytes = 100 * 2 ** 20, memoryEntries = 300, idb = globalThis.indexedDB, urls = globalThis.URL } = {}) {
  return {
    peek(key) { throw new Error("not implemented"); },
    async get(key) { throw new Error("not implemented"); },
    async put(key, blob, { w, h }) { throw new Error("not implemented"); },
    async clear() { throw new Error("not implemented"); },
    dispose() { throw new Error("not implemented"); },
  };
}
