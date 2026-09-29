export function createColdRenderer({ api = globalThis.roamAlphaAPI, doc = globalThis.document, timeoutMs = 8000 } = {}) {
  return {
    async renderDrawing(drawingUid) { throw new Error("not implemented"); },
    dispose() { throw new Error("not implemented"); },
  };
}
export async function cropCanvasToBlob(canvas, { sx, sy, sw, sh }, { doc = globalThis.document } = {}) { throw new Error("not implemented"); }
