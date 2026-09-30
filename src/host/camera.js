import { fitZoom } from "../model/scene.js";
import { activeEditor } from "./native.js";

const ABORT_EVENTS = ["pointerdown", "wheel", "keydown"];
const SLOW_FRAME_MS = 32;
const tokens = new WeakMap();

const zoomOf = (state) => (typeof state?.zoom === "number" ? state.zoom : state?.zoom?.value) || 1;
const viewOf = (state) => ({ scrollX: state?.scrollX || 0, scrollY: state?.scrollY || 0, zoom: zoomOf(state) });

function safeUpdate(app, appState) {
  try {
    app.updateScene({ appState, captureUpdate: "NEVER" });
    return true;
  } catch (error) {
    console.warn("[plexus] camera update failed", error);
    return false;
  }
}

const writeView = (app, v, extra = {}) => safeUpdate(app, { scrollX: v.scrollX, scrollY: v.scrollY, zoom: { value: v.zoom }, ...extra });

const rectFor = (app, bbox, v) => {
  const s = app.state || {};
  const left = (bbox[0] + v.scrollX) * v.zoom + (s.offsetLeft || 0);
  const top = (bbox[1] + v.scrollY) * v.zoom + (s.offsetTop || 0);
  return { left, top, width: (bbox[2] - bbox[0]) * v.zoom, height: (bbox[3] - bbox[1]) * v.zoom };
};

// Moves the view to {scrollX, scrollY, zoom}. Resolves {moved, aborted}.
export function animateView(app, target, { animate = true, doc = globalThis.document, raf = globalThis.requestAnimationFrame, now = () => Date.now(), duration = 400 } = {}) {
  const token = {};
  tokens.set(app, token);
  if (!animate || typeof raf !== "function") {
    return Promise.resolve({ moved: writeView(app, target), aborted: false });
  }
  const start = viewOf(app.state);
  const w = app.state?.width || 0;
  const h = app.state?.height || 0;
  const centerOf = (v) => ({ x: w / (2 * v.zoom) - v.scrollX, y: h / (2 * v.zoom) - v.scrollY });
  const c0 = centerOf(start);
  const c1 = centerOf(target);
  const cacheKey = app.state && "shouldCacheIgnoreZoom" in app.state;

  return new Promise((resolve) => {
    let finished = false;
    let slow = 0;
    let t0 = null;
    const off = () => {
      for (const type of ABORT_EVENTS) doc?.removeEventListener?.(type, onInput, { capture: true });
    };
    const finish = (result) => {
      if (finished) return;
      finished = true;
      off();
      if (cacheKey) safeUpdate(app, { shouldCacheIgnoreZoom: false });
      if (tokens.get(app) === token) tokens.delete(app);
      resolve(result);
    };
    const abort = () => finish({ moved: true, aborted: true });
    function onInput() { abort(); }
    for (const type of ABORT_EVENTS) doc?.addEventListener?.(type, onInput, { capture: true, passive: true });
    if (cacheKey) safeUpdate(app, { shouldCacheIgnoreZoom: true });

    const step = () => {
      if (finished) return;
      if (tokens.get(app) !== token || (doc && activeEditor(doc)?.app !== app)) return abort();
      const t = now();
      if (t0 == null) t0 = t;
      const p = Math.min(1, (t - t0) / duration);
      const before = now();
      let ok;
      if (p >= 1) ok = writeView(app, target);
      else {
        const e = 1 - (1 - p) ** 3;
        const zoom = start.zoom * (target.zoom / start.zoom) ** e;
        const cx = c0.x + (c1.x - c0.x) * e;
        const cy = c0.y + (c1.y - c0.y) * e;
        ok = writeView(app, { zoom, scrollX: w / (2 * zoom) - cx, scrollY: h / (2 * zoom) - cy });
        if (ok && now() - before > SLOW_FRAME_MS && ++slow >= 2) {
          ok = writeView(app, target);
          return finish({ moved: ok, aborted: false });
        }
      }
      if (!ok || p >= 1) return finish({ moved: ok, aborted: false });
      raf(step);
    };
    raf(step);
  });
}

// Frames bbox (scene coordinates) at up to maxZoom. Resolves {moved, aborted, rect} with rect in viewport pixels.
export async function animateTo(app, bbox, { maxZoom = 1, animate = true, doc = globalThis.document, ...rest } = {}) {
  try {
    const s = app.state || {};
    const cur = viewOf(s);
    const fit = fitZoom({ bbox, viewportWidth: s.width, viewportHeight: s.height, maxZoom });
    const target = { scrollX: fit.scrollX, scrollY: fit.scrollY, zoom: fit.zoom };
    const inside = (v) => {
      const r = rectFor(app, bbox, v);
      const l = s.offsetLeft || 0;
      const tp = s.offsetTop || 0;
      return r.left >= l && r.top >= tp && r.left + r.width <= l + s.width && r.top + r.height <= tp + s.height;
    };
    if (inside(cur) && cur.zoom >= 0.6 * target.zoom && cur.zoom <= 1.25 * target.zoom) {
      return { moved: false, aborted: false, rect: rectFor(app, bbox, cur) };
    }
    const result = await animateView(app, target, { animate, doc, ...rest });
    return { ...result, rect: rectFor(app, bbox, viewOf(app.state)) };
  } catch (error) {
    console.warn("[plexus] animateTo failed", error);
    return { moved: false, aborted: false, rect: null };
  }
}

export function createViewHistory({ cap = 50, onChange } = {}) {
  const stack = [];
  const changed = () => {
    try { onChange?.(); } catch (error) { console.warn("[plexus] view history onChange failed", error); }
  };
  return {
    push(app) {
      const v = viewOf(app?.state);
      const top = stack[stack.length - 1];
      if (top && Math.abs(top.scrollX - v.scrollX) < 0.5 && Math.abs(top.scrollY - v.scrollY) < 0.5 && Math.abs(top.zoom - v.zoom) < 0.001) return;
      stack.push(v);
      if (stack.length > cap) stack.shift();
      changed();
    },
    async back(app, { animate = false, doc } = {}) {
      const v = stack.pop();
      if (!v) return false;
      changed();
      await animateView(app, v, { animate, doc });
      return true;
    },
    size: () => stack.length,
    discard() {
      if (!stack.length) return;
      stack.pop();
      changed();
    },
    clear() {
      if (!stack.length) return;
      stack.length = 0;
      changed();
    },
  };
}
