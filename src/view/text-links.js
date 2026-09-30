import { findTokens, alignWrapped } from "../model/tokens.js";
import { viewportToScene } from "../model/scene.js";
import { isCanvasEvent, linksActive } from "../host/links.js";

// Same still-click limits as installLinkInterception (host/links.js).
const MAX_MOVE_PX = 6;
const MAX_HOLD_MS = 400;
const MEASURE_CAP = 2000;
const LAYOUT_CAP = 500;
const NOTE_ARMED_ATTR = "data-plexus-note-armed";
const CHOOSER_LABEL_MAX = 60;
const FRAME_TYPES = new Set(["frame", "magicframe"]);
const LINEAR_TYPES = new Set(["arrow", "line"]);

const FAMILY = {
  1: "Virgil", 2: "Helvetica", 3: "Cascadia", 5: "Excalifont", 6: "Nunito",
  7: "Lilita One", 8: "Comic Shanns", 9: "Liberation Sans",
};

const warn = (what, ...rest) => console.warn(`[plexus] ${what}`, ...rest);

export const fontFor = (element) =>
  `${element.fontSize ?? 20}px ${FAMILY[element.fontFamily] ?? "Excalifont"}, Xiaolai, sans-serif, Segoe UI Emoji`;

// Font-aware canvas measurer, LRU-memoized by font|text. measure(text, font) -> width in px.
export function createFontMeasurer({ doc = globalThis.document } = {}) {
  const memo = new Map();
  let ctx = null;
  const context = () => {
    if (ctx) return ctx;
    try { ctx = doc?.createElement?.("canvas")?.getContext?.("2d") || null; } catch { ctx = null; }
    return ctx;
  };
  return function measure(text, font) {
    const str = String(text ?? "");
    const key = `${font}|${str}`;
    if (memo.has(key)) {
      const hit = memo.get(key);
      memo.delete(key);
      memo.set(key, hit);
      return hit;
    }
    const c = context();
    let width;
    if (c) {
      c.font = font;
      width = c.measureText(str).width;
    } else {
      width = str.length * (parseFloat(font) || 20) * 0.6;
    }
    memo.set(key, width);
    if (memo.size > MEASURE_CAP) memo.delete(memo.keys().next().value);
    return width;
  };
}

let defaultMeasure = null;
const layouts = new WeakMap();

export function tokenTarget(token) {
  return token.kind === "block" ? { type: "block", uid: token.uid } : { type: "page", title: token.title };
}

// Line boxes of one text element in the element's own (unrotated) frame, plus its tokens with their per-line segments.
function layoutOf(element, measure) {
  let byId = layouts.get(measure);
  if (!byId) { byId = new Map(); layouts.set(measure, byId); }
  const cached = byId.get(element.id);
  if (cached && cached.version === element.version && cached.text === element.text && cached.original === element.originalText) return cached;

  const text = String(element.text ?? "");
  const lines = text.split("\n");
  const font = fontFor(element);
  const lhPx = (element.fontSize ?? 20) * (element.lineHeight ?? 1.25);
  const align = element.textAlign || "left";
  const boxes = [];
  let at = 0;
  lines.forEach((line, i) => {
    const w = measure(line, font);
    const left = align === "center" ? element.x + (element.width - w) / 2 : align === "right" ? element.x + element.width - w : element.x;
    boxes.push({ line, start: at, left, top: element.y + i * lhPx, height: lhPx });
    at += line.length + 1;
  });

  const segsIn = (map, tok) => {
    const segs = [];
    for (const b of boxes) {
      let a = -1;
      let z = -1;
      for (let k = 0; k < b.line.length; k++) {
        const o = map[b.start + k];
        if (o >= tok.start && o < tok.end) { if (a < 0) a = k; z = k + 1; }
      }
      if (a < 0) continue;
      const x1 = b.left + measure(b.line.slice(0, a), font);
      const x2 = b.left + measure(b.line.slice(0, z), font);
      segs.push({ x1, x2, y1: b.top, y2: b.top + b.height });
    }
    return segs;
  };

  const map = element.originalText != null && element.originalText !== "" ? alignWrapped(text, element.originalText) : null;
  const nested = [];
  const flat = [];
  if (map) {
    const orig = String(element.originalText);
    for (const tok of findTokens(orig, { nested: true })) nested.push({ ...tok, segs: segsIn(map, tok) });
    for (const tok of findTokens(orig)) flat.push({ ...tok });
  } else {
    boxes.forEach((b) => {
      for (const tok of findTokens(b.line, { nested: true })) {
        const seg = {
          x1: b.left + measure(b.line.slice(0, tok.start), font),
          x2: b.left + measure(b.line.slice(0, tok.end), font),
          y1: b.top, y2: b.top + b.height,
        };
        nested.push({ ...tok, segs: [seg] });
      }
      for (const tok of findTokens(b.line)) flat.push({ ...tok });
    });
  }
  const entry = { version: element.version, text: element.text, original: element.originalText, nested, flat };
  byId.set(element.id, entry);
  if (byId.size > LAYOUT_CAP) byId.delete(byId.keys().next().value);
  return entry;
}

// Point in the element's frame: rotate by -angle about the element's own centre.
function toLocal(element, point) {
  const angle = element.angle || 0;
  if (!angle) return point;
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const dx = point.x - cx;
  const dy = point.y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

const inBox = (el, p) => p.x >= el.x && p.x <= el.x + el.width && p.y >= el.y && p.y <= el.y + el.height;

// Innermost token of a text element under a scene point, or null.
export function hitToken({ element, point, measure } = {}) {
  if (!element || element.type !== "text" || !point) return null;
  measure = measure || (defaultMeasure ||= createFontMeasurer());
  const p = toLocal(element, point);
  let best = null;
  for (const tok of layoutOf(element, measure).nested) {
    if (!tok.segs.some((s) => p.x >= s.x1 && p.x <= s.x2 && p.y >= s.y1 && p.y <= s.y2)) continue;
    if (!best || tok.end - tok.start < best.end - best.start) best = tok;
  }
  if (!best) return null;
  const { segs, ...token } = best;
  return token;
}

// Every token in the element, in reading order, non-overlapping.
export function elementTokens({ element, measure } = {}) {
  if (!element || element.type !== "text") return [];
  measure = measure || (defaultMeasure ||= createFontMeasurer());
  return layoutOf(element, measure).flat.map((t) => ({ ...t }));
}

// Topmost element under the point: a text element, or a container whose bound text has tokens. Anything else ends the search.
export function topmostText(elements, point) {
  const byId = new Map();
  for (const el of elements) if (el) byId.set(el.id, el);
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (!el || el.isDeleted || FRAME_TYPES.has(el.type)) continue;
    if (!inBox(el, toLocal(el, point))) continue;
    if (el.type === "text") return { text: el, container: el.containerId ? byId.get(el.containerId) ?? null : null };
    if (LINEAR_TYPES.has(el.type)) return null;
    const bound = (el.boundElements || []).find((b) => b?.type === "text");
    const text = bound ? byId.get(bound.id) : null;
    return text && !text.isDeleted ? { text, container: el } : null;
  }
  return null;
}

export function installTextLinks({
  doc, api = globalThis.roamAlphaAPI, app, containerEl, navigate, toast, zIndex = 0,
  mac = /mac|iphone|ipad/i.test(String(doc?.defaultView?.navigator?.platform ?? "")),
  measure, now = () => Date.now(),
  raf = (fn) => (doc?.defaultView?.requestAnimationFrame ?? globalThis.requestAnimationFrame)(fn),
  caf = (id) => (doc?.defaultView?.cancelAnimationFrame ?? globalThis.cancelAnimationFrame)?.(id),
} = {}) {
  if (!app || !containerEl?.addEventListener) return () => {};
  const win = doc?.defaultView ?? null;
  const measurer = measure || createFontMeasurer({ doc });
  let down = null;
  let chooser = null;
  let hoverOn = false;
  let frame = null;
  let last = null;
  let disposed = false;

  const modifier = (e) => (mac ? !!e.metaKey && !e.ctrlKey : !!e.ctrlKey && !e.metaKey);
  const isModifierKey = (e) => (mac ? e.key === "Meta" : e.key === "Control");

  function blocked() {
    const s = app.state || {};
    if (s.editingTextElement || s.newElement || s.multiElement || s.selectedLinearElement?.isEditing) return true;
    if (s.openDialog || s.openMenu || s.contextMenu) return true;
    return !!doc?.body?.hasAttribute?.(NOTE_ARMED_ATTR);
  }

  function scenePoint(e) {
    const r = containerEl.getBoundingClientRect?.() || { left: 0, top: 0 };
    return viewportToScene({ x: e.clientX, y: e.clientY, appState: { ...app.state, offsetLeft: r.left, offsetTop: r.top } });
  }

  // -> {text, container, point} when the point is over tokened text and no element link outranks it.
  function locate(e) {
    if (!linksActive(app) || blocked()) return null;
    const point = scenePoint(e);
    const found = app.getElementLinkAtPosition?.(point, null);
    if (typeof found === "string" ? found : found?.link) return null;
    const top = topmostText(app.getSceneElements?.() ?? [], point);
    if (!top || top.text.link || top.container?.link) return null;
    return { ...top, point };
  }

  function decide(e) {
    const hit = locate(e);
    if (!hit) return null;
    const token = hitToken({ element: hit.text, point: hit.point, measure: measurer });
    if (token) return { tokens: [token] };
    const all = elementTokens({ element: hit.text, measure: measurer });
    return all.length ? { tokens: all } : null;
  }

  function exists(token) {
    const t = tokenTarget(token);
    try {
      const found = t.type === "block"
        ? api.data.pull("[:block/uid]", [":block/uid", t.uid])
        : api.data.pull("[:block/uid]", [":node/title", t.title]);
      return !!found;
    } catch (error) {
      warn("token lookup failed", error);
      return false;
    }
  }

  function go(token, sidebar) {
    if (disposed) return;
    const target = tokenTarget(token);
    if (!exists(token)) {
      toast?.(target.type === "block" ? "Block not found" : `No page named ${target.title}`);
      return;
    }
    try { navigate?.({ target, sidebar: !!sidebar }); } catch (error) { warn("token navigation failed", error); }
  }

  function blockLabel(uid) {
    try {
      const raw = api.data.pull("[:block/string]", [":block/uid", uid]);
      const s = String(raw?.[":block/string"] ?? "").replace(/\s+/g, " ").trim();
      return s ? s.slice(0, CHOOSER_LABEL_MAX) : `((${uid}))`;
    } catch { return `((${uid}))`; }
  }

  const labelOf = (t) => (t.kind === "block" ? blockLabel(t.uid) : t.kind === "tag" ? `#${t.title}` : t.title);

  function closeChooser(refocus = true) {
    const c = chooser;
    if (!c) return;
    chooser = null;
    c.dispose();
    if (refocus) { try { containerEl.focus?.({ preventScroll: true }); } catch { /* focus is best effort */ } }
  }

  function openChooser(tokens, at) {
    closeChooser(false);
    const root = doc.createElement("div");
    root.className = "rm-autocomplete__results bp3-elevation-3 plexus-portal plexus-token-chooser";
    root.setAttribute("tabindex", "-1");
    root.style.position = "fixed";
    root.style.zIndex = String((zIndex || 0) + 3);
    const scroll = doc.createElement("div");
    scroll.className = "rm-autocomplete__results-scroll";
    const rows = [];
    let active = 0;
    const setActive = (i) => {
      active = i;
      rows.forEach((r, k) => { r.style.backgroundColor = k === i ? "rgb(213, 218, 223)" : ""; });
    };
    const choose = (token, sidebar) => {
      closeChooser(false);
      go(token, sidebar);
    };
    tokens.forEach((token, k) => {
      const row = doc.createElement("div");
      row.className = "dont-unfocus-block";
      row.style.padding = "6px";
      row.style.cursor = "pointer";
      row.style.borderRadius = "2px";
      const inner = doc.createElement("div");
      inner.className = "rm-autocomplete-result";
      inner.textContent = labelOf(token);
      row.append(inner);
      row.addEventListener("mousemove", () => setActive(k));
      row.addEventListener("click", (ev) => { ev.stopPropagation(); choose(token, ev.shiftKey); });
      scroll.append(row);
      rows.push(row);
    });
    root.append(scroll);
    const stop = (ev) => ev.stopPropagation();
    root.addEventListener("keyup", stop);
    root.addEventListener("keypress", stop);
    root.addEventListener("pointerdown", stop);
    root.addEventListener("mousedown", (ev) => { ev.preventDefault?.(); ev.stopPropagation(); });
    root.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Escape") { ev.preventDefault(); closeChooser(true); }
      else if (ev.key === "ArrowDown") { ev.preventDefault(); setActive((active + 1) % rows.length); }
      else if (ev.key === "ArrowUp") { ev.preventDefault(); setActive((active - 1 + rows.length) % rows.length); }
      else if (ev.key === "Enter") { ev.preventDefault(); choose(tokens[active], ev.shiftKey); }
    });
    const onOutside = (ev) => { if (!(ev.target && root.contains?.(ev.target))) closeChooser(true); };
    const onWheel = (ev) => { if (!(ev.target && root.contains?.(ev.target))) closeChooser(true); };
    doc.addEventListener("pointerdown", onOutside, true);
    doc.addEventListener("wheel", onWheel, { capture: true, passive: true });
    doc.body.append(root);
    const rect = root.getBoundingClientRect?.() || { width: 0, height: 0 };
    const vw = win?.innerWidth ?? Infinity;
    const vh = win?.innerHeight ?? Infinity;
    root.style.left = `${Math.max(0, Math.min(at.x, vw - (rect.width || 0) - 8))}px`;
    root.style.top = `${Math.max(0, Math.min(at.y, vh - (rect.height || 0) - 8))}px`;
    setActive(0);
    chooser = {
      dispose() {
        doc.removeEventListener("pointerdown", onOutside, true);
        doc.removeEventListener("wheel", onWheel, { capture: true });
        root.remove();
      },
    };
    try { root.focus({ preventScroll: true }); } catch { /* focus is best effort */ }
  }

  const onDown = (e) => {
    down = null;
    if (disposed || !e.isTrusted || (e.button ?? 0) !== 0 || !modifier(e)) return;
    try {
      if (!isCanvasEvent(e)) return;
      const decision = decide(e);
      if (!decision) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      down = { x: e.clientX, y: e.clientY, t: now(), tokens: decision.tokens, pointerId: e.pointerId };
    } catch (error) {
      warn("text link claim failed", error);
    }
  };

  const onUp = (e) => {
    const start = down;
    if (!start || disposed) return;
    if (e.pointerId !== start.pointerId) return;
    down = null;
    e.preventDefault?.();
    e.stopImmediatePropagation?.();
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > MAX_MOVE_PX || now() - start.t > MAX_HOLD_MS) return;
    try {
      if (start.tokens.length === 1) go(start.tokens[0], e.shiftKey);
      else openChooser(start.tokens, { x: e.clientX, y: e.clientY });
    } catch (error) {
      warn("text link navigation failed", error);
    }
  };

  const onCancel = () => { down = null; };
  // A release outside the canvas never reaches onUp; drop the claim so it cannot swallow a later unrelated pointerup.
  const onWinUp = (e) => { if (down && !containerEl.contains?.(e.target)) down = null; };

  function setHover(on) {
    if (on === hoverOn) return;
    hoverOn = on;
    if (on) containerEl.classList?.add("plexus-token-hover");
    else containerEl.classList?.remove("plexus-token-hover");
  }

  function evaluate() {
    frame = null;
    if (disposed || !last) return;
    let over = false;
    try {
      if (last.mod && isCanvasEvent(last)) {
        const hit = locate(last);
        over = !!(hit && hitToken({ element: hit.text, point: hit.point, measure: measurer }));
      }
    } catch (error) {
      warn("text link hover failed", error);
    }
    setHover(over);
  }

  const schedule = () => { if (frame == null) frame = raf(evaluate); };

  const onMove = (e) => {
    if (!modifier(e)) {
      last = null;
      if (hoverOn) setHover(false);
      return;
    }
    last = { clientX: e.clientX, clientY: e.clientY, target: e.target, mod: true };
    schedule();
  };

  const onKeyUp = (e) => { if (isModifierKey(e)) { last = null; setHover(false); } };
  const onOff = () => { last = null; setHover(false); };

  containerEl.addEventListener("pointerdown", onDown, true);
  containerEl.addEventListener("pointerup", onUp, true);
  containerEl.addEventListener("pointercancel", onCancel, true);
  containerEl.addEventListener("pointermove", onMove, { capture: true, passive: true });
  containerEl.addEventListener("pointerleave", onOff);
  win?.addEventListener?.("keyup", onKeyUp, true);
  win?.addEventListener?.("pointerup", onWinUp, true);
  win?.addEventListener?.("blur", onOff);

  return () => {
    if (disposed) return;
    disposed = true;
    down = null;
    last = null;
    if (frame != null) { try { caf(frame); } catch { /* nothing to cancel */ } frame = null; }
    closeChooser(false);
    setHover(false);
    containerEl.removeEventListener("pointerdown", onDown, true);
    containerEl.removeEventListener("pointerup", onUp, true);
    containerEl.removeEventListener("pointercancel", onCancel, true);
    containerEl.removeEventListener("pointermove", onMove, { capture: true });
    containerEl.removeEventListener("pointerleave", onOff);
    win?.removeEventListener?.("keyup", onKeyUp, true);
    win?.removeEventListener?.("pointerup", onWinUp, true);
    win?.removeEventListener?.("blur", onOff);
  };
}
