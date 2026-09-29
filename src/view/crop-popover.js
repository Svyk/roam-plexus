import { hostDarkMarker, isHostDark } from "../host/theme.js";

const MAX_W = 480;
const MAX_H = 360;
const GAP = 6;
const EDGE = 4;

export function createCropPopover({ doc, delayMs = 300 }) {
  let portal = null;
  let token = 0;
  let timer = null;
  let scrollTarget = null;
  const hovers = new Set();

  const onDismiss = () => hide();

  function unlisten() {
    scrollTarget?.removeEventListener?.("scroll", onDismiss, true);
    scrollTarget = null;
    doc.removeEventListener?.("mousedown", onDismiss, true);
  }

  function hide() {
    token += 1;
    if (timer != null) clearTimeout(timer);
    timer = null;
    unlisten();
    portal?.remove();
    portal = null;
  }

  function place(anchor, entry) {
    const view = doc.defaultView;
    const vw = view?.innerWidth || 1024;
    const vh = view?.innerHeight || 768;
    const nw = entry.w > 0 ? entry.w : MAX_W;
    const nh = entry.h > 0 ? entry.h : MAX_H;
    const scale = Math.min(1, MAX_W / nw, MAX_H / nh);
    const w = Math.max(1, Math.round(nw * scale));
    const h = Math.max(1, Math.round(nh * scale));
    const rect = anchor.getBoundingClientRect?.() || { left: 0, top: 0, bottom: 0 };
    let top = rect.bottom + GAP;
    if (top + h > vh - EDGE) top = rect.top - GAP - h;
    top = Math.max(EDGE, Math.min(top, vh - h - EDGE));
    const left = Math.max(EDGE, Math.min(rect.left, vw - w - EDGE));
    return { w, h, top, left };
  }

  function show(anchor, getEntry) {
    const mine = ++token;
    Promise.resolve()
      .then(() => getEntry())
      .then((entry) => {
        if (mine !== token || !entry?.url || anchor.isConnected === false) return;
        const box = place(anchor, entry);
        portal?.remove();
        portal = doc.createElement("div");
        portal.className = "plexus-portal plexus-crop-popover";
        portal.style.position = "fixed";
        portal.style.pointerEvents = "none";
        portal.style.zIndex = "100001";
        portal.style.left = `${box.left}px`;
        portal.style.top = `${box.top}px`;
        const img = doc.createElement("img");
        img.className = `plexus-crop${entry.invertible ? " plexus-crop--invertible" : ""}${entry.invertible && isHostDark(doc) && !hostDarkMarker(doc) ? " plexus-crop--invert" : ""}`;
        img.draggable = false;
        img.style.width = `${box.w}px`;
        img.style.height = `${box.h}px`;
        img.onerror = () => { if (mine === token) hide(); };
        img.src = entry.url;
        portal.append(img);
        doc.body.append(portal);
        scrollTarget = doc.defaultView;
        scrollTarget?.addEventListener?.("scroll", onDismiss, true);
        doc.addEventListener?.("mousedown", onDismiss, true);
      })
      .catch((error) => console.warn("[plexus] crop popover failed", error));
  }

  function hoverOn(anchor, getEntry) {
    const enter = () => {
      if (timer != null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        try { show(anchor, getEntry); } catch (error) { console.warn("[plexus] crop popover failed", error); }
      }, delayMs);
    };
    const leave = () => hide();
    anchor.addEventListener("mouseenter", enter);
    anchor.addEventListener("mouseleave", leave);
    const dispose = () => {
      anchor.removeEventListener?.("mouseenter", enter);
      anchor.removeEventListener?.("mouseleave", leave);
      hovers.delete(dispose);
      hide();
    };
    hovers.add(dispose);
    return dispose;
  }

  return {
    hoverOn,
    hide,
    dispose() {
      for (const d of [...hovers]) d();
      hide();
    },
  };
}
