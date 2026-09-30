import { hostDarkMarker, isHostDark } from "../host/theme.js";

const MAX_W = 480;
const MAX_H = 360;
const GAP = 6;
const EDGE = 4;
const HEAD_H = 18;
const NOTE_CAP = 5;

function noteLines(notes) {
  if (!Array.isArray(notes)) return [];
  const lines = [];
  for (const note of notes) {
    if (typeof note !== "string") continue;
    lines.push(note);
    if (lines.length === NOTE_CAP) break;
  }
  return lines;
}

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
    // With a source peek the box is header + crop | thumbnail; flip and clamp use the combined size.
    const peek = entry.peek;
    const totalW = peek ? w + GAP + peek.w : w;
    const totalH = peek ? HEAD_H + Math.max(h, peek.h) : h;
    const rect = anchor.getBoundingClientRect?.() || { left: 0, top: 0, bottom: 0 };
    let top = rect.bottom + GAP;
    if (top + totalH > vh - EDGE) top = rect.top - GAP - totalH;
    top = Math.max(EDGE, Math.min(top, vh - totalH - EDGE));
    const left = Math.max(EDGE, Math.min(rect.left, vw - totalW - EDGE));
    return { w, h, top, left };
  }

  function peekHead(peek) {
    const head = doc.createElement("div");
    head.className = "plexus-peek-head";
    head.style.height = `${HEAD_H}px`;
    head.style.overflow = "hidden";
    head.style.whiteSpace = "nowrap";
    head.style.textOverflow = "ellipsis";
    head.style.fontSize = "12px";
    head.textContent = [peek.title, peek.kind].filter(Boolean).join(" \u00b7 ");
    return head;
  }

  // Crop on the left; the thumbnail on the right with an absolutely positioned outline div (no canvas, no decode).
  function peekRow(img, peek, invertClass) {
    const row = doc.createElement("div");
    row.className = "plexus-peek-row";
    row.style.display = "flex";
    row.style.alignItems = "flex-start";
    row.style.gap = `${GAP}px`;
    const thumb = doc.createElement("div");
    thumb.className = "plexus-peek-thumb";
    thumb.style.position = "relative";
    thumb.style.flex = "none";
    thumb.style.width = `${peek.w}px`;
    thumb.style.height = `${peek.h}px`;
    const timg = doc.createElement("img");
    timg.className = `plexus-crop plexus-peek-img${invertClass}`;
    timg.draggable = false;
    timg.style.width = `${peek.w}px`;
    timg.style.height = `${peek.h}px`;
    timg.src = peek.url;
    const outline = doc.createElement("div");
    outline.className = "plexus-peek-outline";
    outline.style.position = "absolute";
    outline.style.boxSizing = "border-box";
    outline.style.border = "2px solid #e8590c";
    outline.style.pointerEvents = "none";
    outline.style.left = `${peek.rect.x}px`;
    outline.style.top = `${peek.rect.y}px`;
    outline.style.width = `${peek.rect.w}px`;
    outline.style.height = `${peek.rect.h}px`;
    thumb.append(timg, outline);
    row.append(img, thumb);
    return row;
  }

  function notesList(lines) {
    const list = doc.createElement("ul");
    list.className = "plexus-notes";
    for (const line of lines) {
      const li = doc.createElement("li");
      li.textContent = line;
      list.append(li);
    }
    return list;
  }

  function show(anchor, getEntry) {
    const mine = ++token;
    Promise.resolve()
      .then(() => getEntry())
      .then((entry) => {
        const lines = noteLines(entry?.notes);
        if (mine !== token || anchor.isConnected === false || !entry || (!entry.url && lines.length === 0)) return;
        const box = place(anchor, entry);
        portal?.remove();
        portal = doc.createElement("div");
        portal.className = "plexus-portal plexus-crop-popover";
        portal.style.position = "fixed";
        portal.style.pointerEvents = "none";
        portal.style.zIndex = "100001";
        portal.style.left = `${box.left}px`;
        portal.style.top = `${box.top}px`;
        if (lines.length) portal.append(notesList(lines));
        if (entry.url) {
          const invertClass = `${entry.invertible ? " plexus-crop--invertible" : ""}${entry.invertible && isHostDark(doc) && !hostDarkMarker(doc) ? " plexus-crop--invert" : ""}`;
          const img = doc.createElement("img");
          img.className = `plexus-crop${invertClass}`;
          img.draggable = false;
          img.style.width = `${box.w}px`;
          img.style.height = `${box.h}px`;
          img.onerror = () => { if (mine === token) hide(); };
          img.src = entry.url;
          if (entry.peek) {
            portal.append(peekHead(entry.peek));
            portal.append(peekRow(img, entry.peek, invertClass));
          } else {
            portal.append(img);
          }
        }
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
