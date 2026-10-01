import { commonBounds, elementBounds, liveElements } from "../model/scene.js";

export const MINIMAP_W = 160;
export const MINIMAP_H = 110;

const zoomOf = (state) => {
  const z = state?.zoom;
  const n = typeof z === "number" ? z : z?.value;
  return n || 1;
};

export function visibleScene(appState) {
  const zoom = zoomOf(appState);
  const x0 = -(appState?.scrollX || 0);
  const y0 = -(appState?.scrollY || 0);
  return { x0, y0, x1: x0 + (appState?.width || 0) / zoom, y1: y0 + (appState?.height || 0) / zoom };
}

export function boundsKey(elements) {
  const live = liveElements(elements);
  let version = 0;
  for (const el of live) version += Number(el.version) || 0;
  return { count: live.length, version };
}

export function createBoundsCache() {
  let key = null;
  let bounds = null;
  return {
    get(elements) {
      const next = boundsKey(elements);
      if (key && key.count === next.count && key.version === next.version) return bounds;
      key = next;
      bounds = commonBounds(elements);
      return bounds;
    },
  };
}

export function sceneFits(bounds, view) {
  if (!bounds || !view) return true;
  return bounds[0] >= view.x0 && bounds[1] >= view.y0 && bounds[2] <= view.x1 && bounds[3] <= view.y1;
}

export function portalFit(bounds, width = MINIMAP_W, height = MINIMAP_H) {
  if (!bounds) return null;
  const bw = Math.max(bounds[2] - bounds[0], 1);
  const bh = Math.max(bounds[3] - bounds[1], 1);
  const scale = Math.min(width / bw, height / bh);
  return { scale, ox: (width - bw * scale) / 2, oy: (height - bh * scale) / 2 };
}

export function toPortal(fit, bounds, x0, y0, x1, y1) {
  return {
    x: fit.ox + (x0 - bounds[0]) * fit.scale,
    y: fit.oy + (y0 - bounds[1]) * fit.scale,
    w: (x1 - x0) * fit.scale,
    h: (y1 - y0) * fit.scale,
  };
}

export function scrollFor(appState, sceneX, sceneY) {
  const zoom = zoomOf(appState);
  return {
    scrollX: (appState?.width || 0) / (2 * zoom) - sceneX,
    scrollY: (appState?.height || 0) / (2 * zoom) - sceneY,
  };
}

export function scrollForPointer(appState, bounds, px, py) {
  const fit = portalFit(bounds);
  if (!fit) return null;
  return scrollFor(appState, bounds[0] + (px - fit.ox) / fit.scale, bounds[1] + (py - fit.oy) / fit.scale);
}

export function layout(elements, appState, { enabled = true, cache } = {}) {
  if (!enabled) return { hidden: true, boxes: [], viewport: null };
  const bounds = cache ? cache.get(elements) : commonBounds(elements);
  if (!bounds || sceneFits(bounds, visibleScene(appState))) return { hidden: true, boxes: [], viewport: null };
  const fit = portalFit(bounds);
  const view = visibleScene(appState);
  return {
    hidden: false,
    boxes: liveElements(elements).map((el) => {
      const b = elementBounds(el);
      return toPortal(fit, bounds, b[0], b[1], b[2], b[3]);
    }),
    viewport: toPortal(fit, bounds, view.x0, view.y0, view.x1, view.y1),
  };
}

function place(node, outer, zIndex) {
  const rect = outer?.getBoundingClientRect?.();
  if (!rect) return;
  node.style.position = "fixed";
  node.style.top = `${rect.top + 12}px`;
  node.style.left = `${rect.right - 12 - MINIMAP_W}px`;
  node.style.zIndex = String(zIndex || 1);
}

export function mountMinimap({ doc, app, outer, getEnabled = () => true, subscribe = () => () => {}, raf, cancel, zIndex = 1 } = {}) {
  const noop = { refresh() {}, dispose() {} };
  if (!doc || !app || !outer || !outer.classList?.contains("full-screen")) return noop;
  const view = doc.defaultView || globalThis;
  const nativeRaf = view.requestAnimationFrame || globalThis.requestAnimationFrame;
  const nativeCancel = view.cancelAnimationFrame || globalThis.cancelAnimationFrame;
  const frame = raf || (typeof nativeRaf === "function" && typeof nativeCancel === "function"
    ? (fn) => nativeRaf.call(view, fn)
    : (fn) => { fn(); return 0; });
  const cancelFrame = cancel || (typeof nativeCancel === "function" ? (id) => nativeCancel.call(view, id) : () => {});
  const node = doc.createElement("div");
  node.className = "plexus-portal plexus-minimap";
  node.hidden = true;
  const canvas = doc.createElement("canvas");
  canvas.width = MINIMAP_W;
  canvas.height = MINIMAP_H;
  node.append(canvas);
  (doc.body || outer).append(node);

  const cache = createBoundsCache();
  let off = null;
  let scheduled = false;
  let rafId = 0;
  const elementsOf = () => (typeof app.scene?.getNonDeletedElements === "function"
    ? app.scene.getNonDeletedElements()
    : (app.getSceneElementsIncludingDeleted?.() || []).filter((el) => el && !el.isDeleted));

  const draw = () => {
    scheduled = false;
    rafId = 0;
    if (!getEnabled()) {
      node.hidden = true;
      return;
    }
    const laid = layout(elementsOf(), app.state, { enabled: true, cache });
    node.hidden = laid.hidden;
    if (laid.hidden) return;
    place(node, outer, zIndex);
    const ctx = canvas.getContext?.("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, MINIMAP_W, MINIMAP_H);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#5c7080";
    for (const box of laid.boxes) ctx.strokeRect(box.x, box.y, Math.max(box.w, 1), Math.max(box.h, 1));
    ctx.strokeStyle = "#2d72d2";
    ctx.strokeRect(laid.viewport.x, laid.viewport.y, laid.viewport.w, laid.viewport.h);
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    rafId = frame(() => draw());
  };

  const listen = () => {
    if (off) return;
    try {
      const stop = subscribe(schedule);
      off = typeof stop === "function" ? stop : () => {};
    } catch (error) {
      console.warn("[plexus] minimap subscribe failed", error);
      off = () => {};
    }
  };

  const quiet = () => {
    if (off) {
      const stop = off;
      off = null;
      try { stop(); } catch (error) { console.warn("[plexus] minimap unsubscribe failed", error); }
    }
    if (rafId) {
      try { cancelFrame(rafId); } catch { /* ignore */ }
      rafId = 0;
    }
    scheduled = false;
    node.hidden = true;
  };

  const pan = (event) => {
    if (node.hidden) return;
    const bounds = cache.get(elementsOf());
    const rect = canvas.getBoundingClientRect?.();
    if (!bounds || !rect) return;
    const next = scrollForPointer(app.state, bounds, event.clientX - rect.left, event.clientY - rect.top);
    if (!next) return;
    app.updateScene({ appState: { scrollX: next.scrollX, scrollY: next.scrollY }, captureUpdate: "NEVER" });
  };

  const stop = (event) => {
    event?.stopPropagation?.();
    event?.preventDefault?.();
  };

  let dragging = false;
  const onDown = (event) => {
    stop(event);
    dragging = true;
    try { node.setPointerCapture?.(event.pointerId); } catch { /* ignore */ }
    pan(event);
  };
  const onMove = (event) => {
    if (!dragging) return;
    stop(event);
    pan(event);
  };
  const onUp = (event) => {
    dragging = false;
    stop(event);
  };
  node.addEventListener("pointerdown", onDown);
  node.addEventListener("pointermove", onMove);
  node.addEventListener("pointerup", onUp);

  const refresh = () => {
    if (!getEnabled()) {
      quiet();
      return;
    }
    listen();
    schedule();
  };

  refresh();
  return {
    refresh,
    dispose() {
      quiet();
      try { node.remove(); } catch (error) { console.warn("[plexus] minimap remove failed", error); }
    },
  };
}
