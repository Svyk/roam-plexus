export function createColdRenderer({ api = globalThis.roamAlphaAPI, doc = globalThis.document, timeoutMs = 8000 } = {}) {
  const pending = new Map();
  let tail = Promise.resolve();
  let disposed = false;
  const inflight = new Set();

  const findImg = (host) => host.querySelector("img.rm-inline-img--excalidraw");
  const isReady = (img) => !!img && img.complete && img.naturalWidth > 0;

  function waitForImage(host) {
    return new Promise((resolve) => {
      let cancel = null;
      let observer = null;
      let timer = null;
      let poll = null;
      let done = false;
      const finish = (img) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearInterval(poll);
        observer?.disconnect?.();
        host.removeEventListener?.("load", check, true);
        inflight.delete(cancel);
        resolve(img);
      };
      cancel = () => finish(null);
      inflight.add(cancel);
      function check() {
        const img = findImg(host);
        if (isReady(img)) finish(img);
      }
      const initial = findImg(host);
      if (isReady(initial)) { finish(initial); return; }
      host.addEventListener?.("load", check, true);
      const MO = doc.defaultView?.MutationObserver ?? globalThis.MutationObserver;
      if (MO) {
        observer = new MO(check);
        observer.observe(host, { childList: true, subtree: true, attributes: true });
      }
      poll = setInterval(check, 100);
      timer = setTimeout(() => finish(null), timeoutMs);
    });
  }

  async function run(drawingUid) {
    if (disposed) return null;
    const host = doc.createElement("div");
    host.className = "plexus-offscreen";
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:fixed;left:-10000px;top:0;width:1200px;visibility:hidden;pointer-events:none";
    doc.body.appendChild(host);
    try {
      api.ui.components.renderBlock({ uid: drawingUid, el: host });
      const img = await waitForImage(host);
      if (!img || disposed) return null;
      const canvas = doc.createElement("canvas");
      const naturalWidth = img.naturalWidth;
      const naturalHeight = img.naturalHeight;
      canvas.width = naturalWidth;
      canvas.height = naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      return { canvas, naturalWidth, naturalHeight };
    } catch (error) {
      console.warn("[plexus] cold render failed", error);
      return null;
    } finally {
      try { api.ui.components.unmountNode({ el: host }); } catch (error) { console.warn("[plexus] unmount failed", error); }
      host.remove();
    }
  }

  return {
    renderDrawing(drawingUid) {
      const existing = pending.get(drawingUid);
      if (existing) return existing;
      const p = tail.then(() => run(drawingUid));
      tail = p.catch(() => {});
      pending.set(drawingUid, p);
      const clear = () => { if (pending.get(drawingUid) === p) pending.delete(drawingUid); };
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

export async function cropCanvasToBlob(canvas, { sx, sy, sw, sh }, { doc = globalThis.document } = {}) {
  const out = doc.createElement("canvas");
  out.width = sw;
  out.height = sh;
  out.getContext("2d").drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return new Promise((resolve, reject) => {
    out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("[plexus] toBlob failed"))), "image/png");
  });
}
