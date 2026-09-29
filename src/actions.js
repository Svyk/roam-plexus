export function createActions({ host, native, cache, cold, toaster, spotlight, getSettings, doc, clipboard }) {
  return {
    async createAreaRegion() { throw new Error("not implemented"); },
    async createImageRegion() { throw new Error("not implemented"); },
    async openRegion(regionUid, { sidebar = false } = {}) { throw new Error("not implemented"); },
    async refreshCropsForOpenDrawing() { throw new Error("not implemented"); },
    async clearCache() { throw new Error("not implemented"); },
  };
}
