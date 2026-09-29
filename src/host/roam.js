import { withLock } from "./locks.js";

export function createRoamHost({ api = globalThis.roamAlphaAPI, withLockFn = withLock } = {}) {
  return {
    graphName() { throw new Error("not implemented"); },
    isEncrypted() { throw new Error("not implemented"); },
    pullBlock(uid) { throw new Error("not implemented"); },
    drawing(uid) { throw new Error("not implemented"); },
    regionsOf(drawingUid) { throw new Error("not implemented"); },
    async ensureRegionContainer(drawingUid) { throw new Error("not implemented"); },
    async createRegion(drawingUid, regionString) { throw new Error("not implemented"); },
    async openBlock(uid, { sidebar = false } = {}) { throw new Error("not implemented"); },
    blockUidFromNode(node) { throw new Error("not implemented"); },
  };
}
