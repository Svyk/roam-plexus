export function createRegionRefRenderer({ host, cache, cold, getSettings, onOpen, doc }) {
  return {
    claim(btn) { throw new Error("not implemented"); },
    releaseAll() { throw new Error("not implemented"); },
  };
}
