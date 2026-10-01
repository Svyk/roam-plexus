import { cropToBlob } from "./image-source.js";

const DEFAULT_SETTLE_MS = 150;

export function createColdRenderer({ api = globalThis.roamAlphaAPI, doc = globalThis.document, timeoutMs = 8000 } = {}) {
  const pending = new Map();
  const wanted = new Map();
  let tail = Promise.resolve();
  let disposed = false;
  const inflight = new Set();

  const findImg = (host) => host.querySelector("img.rm-inline-img--excalidraw");
  const isReady = (img) => !!img && img.complete && img.naturalWidth > 0;

  // Roam swaps the view PNG more than once (a placeholder export first), so resolve only once the src has been
  // complete and unchanged for settleMs. At the timeout cap, a complete image resolves as unsettled.
  function waitForImage(host, settleMs) {
    return new Promise((resolve) => {
      let cancel = null;
      let observer = null;
      let timer = null;
      let poll = null;
      let quiet = null;
      let done = false;
      let seenImg = null;
      let seenSrc = null;
      const finish = (img, settled) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearTimeout(quiet);
        clearInterval(poll);
        observer?.disconnect?.();
        host.removeEventListener?.("load", check, true);
        inflight.delete(cancel);
        resolve(img ? { img, settled } : null);
      };
      cancel = () => finish(null, false);
      inflight.add(cancel);
      function check() {
        if (done) return;
        const img = findImg(host);
        const src = img ? img.src : null;
        if (img !== seenImg || src !== seenSrc) {
          seenImg = img;
          seenSrc = src;
          clearTimeout(quiet);
          quiet = null;
        }
        if (!isReady(img)) { clearTimeout(quiet); quiet = null; return; }
        if (settleMs <= 0) { finish(img, true); return; }
        if (quiet) return;
        quiet = setTimeout(() => {
          quiet = null;
          const now = findImg(host);
          if (now === seenImg && now?.src === seenSrc && isReady(now)) finish(now, true);
          else check();
        }, settleMs);
      }
      host.addEventListener?.("load", check, true);
      const MO = doc.defaultView?.MutationObserver ?? globalThis.MutationObserver;
      if (MO) {
        observer = new MO(check);
        observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
      }
      poll = setInterval(check, 50);
      timer = setTimeout(() => {
        const img = findImg(host);
        finish(isReady(img) ? img : null, false);
      }, timeoutMs);
      check();
    });
  }

  async function run(drawingUid) {
    const settleMs = wanted.get(drawingUid) ?? DEFAULT_SETTLE_MS;
    wanted.delete(drawingUid);
    if (disposed) return null;
    const host = doc.createElement("div");
    host.className = "plexus-offscreen";
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:fixed;left:-10000px;top:0;width:1200px;visibility:hidden;pointer-events:none";
    doc.body.appendChild(host);
    try {
      api.ui.components.renderBlock({ uid: drawingUid, el: host });
      const waited = await waitForImage(host, settleMs);
      if (!waited || disposed) return null;
      const { img, settled } = waited;
      const canvas = doc.createElement("canvas");
      const naturalWidth = img.naturalWidth;
      const naturalHeight = img.naturalHeight;
      canvas.width = naturalWidth;
      canvas.height = naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      return { canvas, naturalWidth, naturalHeight, settled };
    } catch (error) {
      console.warn("[plexus] cold render failed", error);
      return null;
    } finally {
      try { api.ui.components.unmountNode({ el: host }); } catch (error) { console.warn("[plexus] unmount failed", error); }
      host.remove();
    }
  }

  return {
    renderDrawing(drawingUid, { settleMs = DEFAULT_SETTLE_MS } = {}) {
      wanted.set(drawingUid, Math.max(wanted.get(drawingUid) ?? 0, settleMs));
      const existing = pending.get(drawingUid);
      if (existing) return existing;
      const p = tail.then(() => run(drawingUid));
      tail = p.catch(() => {});
      pending.set(drawingUid, p);
      const clear = () => { if (pending.get(drawingUid) === p) { pending.delete(drawingUid); wanted.delete(drawingUid); } };
      p.then(clear, clear);
      return p;
    },
    dispose() {
      disposed = true;
      pending.clear();
      for (const cancel of [...inflight]) cancel();
    },
  };
}

export function cropCanvasToBlob(canvas, rect, { doc = globalThis.document, poly, covers } = {}) {
  return cropToBlob(canvas, rect, { doc, poly, covers });
}
