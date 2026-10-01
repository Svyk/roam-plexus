import { elementBounds, fitZoom } from "../model/scene.js";
import { maxBuild } from "../model/slides.js";

export function viewPatch(view) {
  return {
    appState: {
      scrollX: view.scrollX,
      scrollY: view.scrollY,
      zoom: { value: view.zoom },
    },
    captureUpdate: "NEVER",
  };
}

export function rememberIndex(store, uid, count) {
  const n = store?.get?.(uid);
  return Number.isInteger(n) && n >= 0 && n < count ? n : 0;
}

export function saveIndex(store, uid, index) {
  if (!store || !uid || !Number.isInteger(index) || index < 0) return;
  store.set(uid, index);
}

const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - ((-2 * p + 2) ** 2) / 2);

export function createLiveShow({
  frames, elements, viewport, readView, writeView, onChrome, onStatus,
  now, raf, caf, duration = 400,
} = {}) {
  const list = Array.isArray(frames) ? frames : [];
  const els = Array.isArray(elements) ? elements : [];
  const vw = Math.max(1, Number(viewport?.width) || 1);
  const vh = Math.max(1, Number(viewport?.height) || 1);
  const clock = now || (() => 0);
  const request = raf || ((fn) => { fn(clock()); return 0; });
  const cancel = caf || (() => {});
  const ms = duration > 0 ? duration : 0;
  let saved = null;
  let index = 0;
  let build = 0;
  let timer = null;
  let token = 0;
  let dead = false;

  const targetOf = (frame) => fitZoom({ bbox: elementBounds(frame), viewportWidth: vw, viewportHeight: vh });
  const status = () => { try { onStatus?.(index, build, list.length); } catch { /* status is optional */ } };
  const stop = () => {
    token += 1;
    if (timer != null) cancel(timer);
    timer = null;
  };
  const place = (i, b, animate) => {
    if (!list.length || dead) return;
    const to = targetOf(list[i]);
    index = i;
    build = b;
    status();
    if (!animate || ms === 0) {
      stop();
      writeView?.(to);
      return;
    }
    stop();
    const mine = token;
    const from = readView?.() || to;
    const t0 = clock();
    const frame = (t) => {
      if (dead || mine !== token) return;
      const same = t === t0;
      const p = same ? 1 : Math.min(1, (t - t0) / ms);
      const e = ease(p);
      writeView?.({
        scrollX: from.scrollX + (to.scrollX - from.scrollX) * e,
        scrollY: from.scrollY + (to.scrollY - from.scrollY) * e,
        zoom: from.zoom + (to.zoom - from.zoom) * e,
      });
      if (p < 1) timer = request(frame);
      else timer = null;
    };
    timer = request(frame);
  };

  return {
    start(i = 0) {
      if (!list.length || dead) return;
      saved = readView?.() || { scrollX: 0, scrollY: 0, zoom: 1 };
      try { onChrome?.(true); } catch { /* chrome is optional */ }
      place(Math.min(Math.max(0, i), list.length - 1), 0, false);
    },
    next() {
      if (dead || !list.length) return;
      const top = maxBuild(els, list[index]);
      if (build < top) { build += 1; status(); return; }
      if (index < list.length - 1) place(index + 1, 0, true);
    },
    prev() {
      if (dead || !list.length) return;
      if (build > 0) { build -= 1; status(); return; }
      if (index > 0) place(index - 1, maxBuild(els, list[index - 1]), true);
    },
    exit() {
      if (dead) return;
      dead = true;
      stop();
      if (saved) writeView?.(saved);
      try { onChrome?.(false); } catch { /* chrome is optional */ }
    },
    index: () => index,
    build: () => build,
  };
}
