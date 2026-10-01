import { parseRegion, geometryKey } from "../model/region.js";
import { exportBounds, naturalToScene, regionSceneBBox, sceneToNatural, viewPngCropRect } from "../model/scene.js";
import { clipPolyToUnit, imageCropRect, parseImageRefs, polyBBox, polyToLocal } from "../model/image.js";
import { fnv1a } from "../model/hash.js";
import { cropKey, png2xKey, thumbKey } from "../host/cache.js";
import { cropCanvasToBlob } from "../host/cold-render.js";
import { cropToBlob, loadImageBitmap } from "../host/image-source.js";
import { hostDarkMarker, isHostDark } from "../host/theme.js";
import { cardScale, overrideKey, refContext, resolveCaption, resolveDisplay } from "../model/refdisplay.js";
import { KIND_WORDS, drawingTitleOf, imageAltAt, regionLabel } from "../model/label.js";
import { createCropPopover } from "./crop-popover.js";

const CLAIMED = "data-plexus-claimed";
const ALIAS_CLAIMED = "data-plexus-alias";
const FAIL_TTL_MS = 60000;
const PRUNE_FLOOR = 64;
export const IMAGE_SETTLE_MS = 1200;
export const PLAIN_SETTLE_MS = 150;

export const IMAGE_KINDS = new Set(["imgrect", "imgpoly"]);
export const isImageKind = (kind) => IMAGE_KINDS.has(kind);

const ATTR_RE = /^\s*([^:\n]+)::(.*)$/;

function childText(child) {
  if (typeof child === "string") return child;
  if (child && typeof child.string === "string") return child.string;
  return "";
}

function attrName(text) {
  if (typeof text !== "string") return null;
  const m = ATTR_RE.exec(text);
  if (!m) return null;
  const name = m[1].trim();
  if (!name || !m[2].trim() || name.startsWith("BT_attr")) return null;
  return name;
}

export function regionMeta(children) {
  const list = Array.isArray(children) ? children : [];
  const hover = [];
  const attrs = [];
  for (let i = 0; i < list.length; i += 1) {
    const text = childText(list[i]);
    if (hover.length < 5) hover.push(text);
    if (attrName(text)) attrs.push(list[i]);
  }
  return { count: list.length, hover, attrs };
}

export function regionMatchesTag(strings, tag) {
  if (tag == null || tag === "") return true;
  const list = Array.isArray(strings) ? strings : [];
  const hash = `#${tag}`;
  const wiki = `[[${tag}]]`;
  const hashWiki = `#[[${tag}]]`;
  return list.some((item) => {
    const text = typeof item === "string" ? item : childText(item);
    return text.includes(hashWiki) || text.includes(wiki) || text.includes(hash);
  });
}

const pt = (v) => (Array.isArray(v) ? v : [v.x, v.y]);

// Natural-image fraction rect -> fractions of the displayed element box, clipped to what the crop shows.
// Null when nothing is visible. With no crop the fraction is returned unchanged.
export function displayedRect(el, f) {
  if (!el?.crop) return f;
  const [ax, ay] = pt(naturalToScene(el, [f[0], f[1]]));
  const [bx, by] = pt(naturalToScene(el, [f[0] + f[2], f[1] + f[3]]));
  const x1 = Math.max(el.x, Math.min(ax, bx));
  const y1 = Math.max(el.y, Math.min(ay, by));
  const x2 = Math.min(el.x + el.width, Math.max(ax, bx));
  const y2 = Math.min(el.y + el.height, Math.max(ay, by));
  if (!(x2 > x1) || !(y2 > y1)) return null;
  return [(x1 - el.x) / el.width, (y1 - el.y) / el.height, (x2 - x1) / el.width, (y2 - y1) / el.height];
}

// Natural-image polygon (flat fractions) -> displayed-box fractions, clipped to the box. Null when nothing is visible.
export function displayedPoly(el, p) {
  if (!el?.crop) return p;
  const out = [];
  for (let i = 0; i + 1 < p.length; i += 2) {
    const [sx, sy] = pt(naturalToScene(el, [p[i], p[i + 1]]));
    out.push((sx - el.x) / el.width, (sy - el.y) / el.height);
  }
  return clipPolyToUnit(out);
}

// Image-tool output (fractions of the displayed box) -> natural-image fractions, the stored form.
export function displayedToNatural(el, picked) {
  if (!el?.crop) return picked;
  const toNat = (fx, fy) => pt(sceneToNatural(el, [el.x + fx * el.width, el.y + fy * el.height]));
  if (Array.isArray(picked)) {
    const [x1, y1] = toNat(picked[0], picked[1]);
    const [x2, y2] = toNat(picked[0] + picked[2], picked[1] + picked[3]);
    return [x1, y1, x2 - x1, y2 - y1];
  }
  const p = [];
  for (let i = 0; i + 1 < picked.p.length; i += 2) p.push(...toNat(picked.p[i], picked.p[i + 1]));
  return { p };
}

export const OUTSIDE_CROP_TEXT = "Region is outside the image's crop";

// Where a region's pixels come from. Drawing kinds read the drawing block; image kinds read a plain block's image.
export function resolveRegionTarget(host, region) {
  if (isImageKind(region.kind)) {
    const block = host.pullBlock(region.drawingUid);
    const ref = block ? parseImageRefs(block.string).find((r) => r.index === region.i) : null;
    if (!ref) return { error: "Image not found" };
    return { url: ref.url, hash: fnv1a(ref.url) };
  }
  const drawing = host.drawing(region.drawingUid);
  if (!drawing) return { error: "Drawing not found" };
  const sceneBox = regionSceneBBox(region, drawing.elements, drawing.appState);
  if (sceneBox.error === "outside-crop") return { error: OUTSIDE_CROP_TEXT };
  if (sceneBox.error) return { error: `Region unavailable (${sceneBox.error})` };
  return { drawing, sceneBox, hash: drawing.hash };
}

// Cold pixels for one region: the view PNG (drawings) or the decoded image (plain blocks), cropped and,
// for polygon kinds, clipped. Resolves { blob, w, h, settled } or { error }.
export async function renderRegionCrop({ region, target, cold, doc, api, settleMs, loadBitmap = loadImageBitmap }) {
  if (isImageKind(region.kind)) {
    const bitmap = await loadBitmap(target.url, { api });
    const f = region.kind === "imgrect" ? region.f : polyBBox(region.p);
    const crop = imageCropRect({ naturalWidth: bitmap.width, naturalHeight: bitmap.height, f });
    if (!crop) return { error: "bad-crop" };
    const poly = region.kind === "imgpoly" ? polyToLocal(region.p, f) : undefined;
    const blob = await cropToBlob(bitmap, crop, { doc, poly });
    return { blob, w: crop.sw, h: crop.sh, settled: true };
  }
  const { drawing, sceneBox } = target;
  const hasImage = drawing.elements.some((el) => !el.isDeleted && (el.type === "image" || el.fileId));
  const rendered = await cold.renderDrawing(region.drawingUid, { settleMs: settleMs ?? (hasImage ? IMAGE_SETTLE_MS : PLAIN_SETTLE_MS) });
  if (!rendered) return { error: "no-render" };
  const crop = viewPngCropRect({
    elements: drawing.elements,
    appState: drawing.appState,
    bbox: sceneBox.bbox,
    naturalWidth: rendered.naturalWidth,
    naturalHeight: rendered.naturalHeight,
  });
  if (crop.error) return { error: crop.error };
  let poly;
  if (region.kind === "poly") {
    const el = drawing.elements.find((e) => e.id === region.el);
    const p = displayedPoly(el, region.p);
    if (!p) return { error: "outside-crop" };
    poly = polyToLocal(p, polyBBox(p));
  }
  const blob = await cropCanvasToBlob(rendered.canvas, crop, { doc, poly });
  return { blob, w: crop.sw, h: crop.sh, settled: rendered.settled !== false };
}

const GLYPH = '<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><path d="M1.5 5V1.5H5M9 1.5h3.5V5M12.5 9v3.5H9M5 12.5H1.5V9" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';

const isDarkTier = (key) => typeof key === "string" && key.endsWith("|png2x-dark");

const num = (v, d) => (Number.isFinite(Number(v)) && v !== "" && v != null ? Number(v) : d);

const overlaps = (bbox, el) => el.x < bbox[2] && el.x + el.width > bbox[0] && el.y < bbox[3] && el.y + el.height > bbox[1];

export function createRegionRefRenderer({ host, cache, cold, getSettings, onOpen, doc, api = globalThis.roamAlphaAPI, loadBitmap = loadImageBitmap }) {
  const roots = new Map();
  const aliases = new Map();
  const notRegions = new WeakSet();
  const hostRefs = new Map();
  const failed = new Map();
  let pruneAt = PRUNE_FLOOR;
  let popover = null;
  const getPopover = () => popover || (popover = createCropPopover({ doc }));

  const settings = () => {
    const s = getSettings() || {};
    return {
      figureHeight: num(s.figureHeight, 280),
      thumbHeight: num(s.thumbHeight, 72),
      inlineDisplay: s.inlineDisplay === "link" ? "link" : "thumbnail",
      captionDisplay: s.captionDisplay === "always" || s.captionDisplay === "never" ? s.captionDisplay : "written",
      refOverrides: s.refOverrides && typeof s.refOverrides === "object" ? s.refOverrides : {},
      darkCrops: s.darkCrops !== false,
      openInSidebar: s.openInSidebar,
    };
  };

  const prune = () => {
    if (roots.size + aliases.size < pruneAt) return;
    for (const [root, info] of [...roots]) if (!root.isConnected) { dropInfo(info); roots.delete(root); }
    for (const [anchor, info] of [...aliases]) if (anchor.isConnected === false) unalias(anchor, info);
    pruneAt = Math.max(PRUNE_FLOOR, (roots.size + aliases.size) * 2);
  };

  function dropInfo(info) {
    for (const d of info.disposers.splice(0)) {
      try { d(); } catch (error) { console.warn("[plexus] dispose failed", error); }
    }
  }

  const HOST_SEL = ".bp3-popover-target, .bp3-popover-wrapper";
  const STOP_SEL = '.rm-block__input, .roam-block, [id^="block-input-"]';

  // Roam wraps a block ref in inline Blueprint popover spans; make them wrap the tall card so its tooltip anchors to the card box.
  const hostAncestors = (refEl, info) => {
    let el = refEl.parentElement;
    for (let i = 0; el && i < 6; i += 1, el = el.parentElement) {
      if (el.matches?.(STOP_SEL)) break;
      if (!el.matches?.(HOST_SEL)) continue;
      el.setAttribute("data-plexus-card-host", "1");
      hostRefs.set(el, (hostRefs.get(el) || 0) + 1);
      info.hosts.push(el);
    }
  };

  const releaseHosts = (info) => {
    for (const el of info.hosts.splice(0)) {
      const n = (hostRefs.get(el) || 0) - 1;
      if (n > 0) { hostRefs.set(el, n); continue; }
      hostRefs.delete(el);
      el.removeAttribute("data-plexus-card-host");
    }
  };

  // Keep React's delegated hover on Roam's tooltip Popover from seeing the pointer over our preview anchor.
  const stopHover = (el, info) => {
    const stop = (e) => e.stopPropagation();
    el.addEventListener("mouseover", stop);
    el.addEventListener("mouseout", stop);
    info.disposers.push(() => {
      el.removeEventListener?.("mouseover", stop);
      el.removeEventListener?.("mouseout", stop);
    });
  };

  const unclaim = (root, info) => {
    dropInfo(info);
    releaseHosts(info);
    for (const c of ["plexus-ref-card", "plexus-mode-image", "plexus-mode-thumbnail", "plexus-caption-hidden", "plexus-ref-bare"]) info.refEl?.classList?.remove(c);
    if (info.refEl?.style) {
      info.refEl.style.padding = "";
      info.refEl.style.textAlign = "";
    }
    for (const el of info.extras.splice(0)) el.remove?.();
    info.btn.classList.remove("plexus-hidden");
    info.btn.removeAttribute(CLAIMED);
    root.remove();
    roots.delete(root);
  };

  const chip = (root, text) => {
    root.removeAttribute?.("role");
    root.removeAttribute?.("aria-label");
    root.removeAttribute?.("tabindex");
    root.className = "plexus-root plexus-regionref plexus-chip";
    root.textContent = text;
  };

  const paint = (root, entry, key, region, info, target) => {
    if (!root.isConnected) return;
    const s = settings();
    const img = doc.createElement("img");
    img.draggable = false;
    if (info.label) img.alt = info.label;
    const inv = !isDarkTier(key) && invertible(region, target, s);
    img.className = `plexus-crop${inv ? " plexus-crop--invertible" : ""}`;
    if (inv && isHostDark(doc) && !hostDarkMarker(doc)) img.classList.add("plexus-crop--invert");
    img.onerror = () => {
      if (key) Promise.resolve(cache.delete?.(key)).catch(() => {});
      if (root.isConnected) finishChip(root, region);
    };
    const scale = cardScale(info.size);
    if (info.mode === "thumbnail") {
      const h = Math.round(s.thumbHeight * scale);
      img.style.height = `${h}px`;
      img.style.maxHeight = "none";
      img.style.maxWidth = `min(100%, ${4 * h}px)`;
    } else {
      img.style.maxHeight = `${Math.round(s.figureHeight * scale)}px`;
    }
    img.src = entry.url;
    root.className = `plexus-root plexus-regionref plexus-regionref--${info.mode}`;
    if (root.style) {
      const align = info.align;
      root.style.marginLeft = align === "center" || align === "right" ? "auto" : align === "left" ? "0" : "";
      root.style.marginRight = align === "center" || align === "left" ? "auto" : align === "right" ? "0" : "";
    }
    root.textContent = "";
    root.append(img);
  };

  function invertible(region, target, s) {
    if (!s.darkCrops || isImageKind(region.kind) || !target?.drawing) return false;
    if (target.drawing.appState?.theme === "dark") return false;
    const bbox = target.sceneBox?.bbox;
    if (!bbox) return true;
    return !target.drawing.elements.some((el) => !el.isDeleted && (el.type === "image" || el.fileId) && overlaps(bbox, el));
  }

  const keysFor = (uid, region, target) => {
    const gk = geometryKey(region);
    const drawing = !target.url;
    return {
      png: cropKey({ regionUid: uid, geometryKey: gk, drawingHash: target.hash, tier: "png" }),
      svg: drawing ? cropKey({ regionUid: uid, geometryKey: gk, drawingHash: target.hash, tier: "svg" }) : null,
      png2x: drawing ? png2xKey({ regionUid: uid, geometryKey: gk, drawingHash: target.hash }) : null,
      png2xDark: drawing ? png2xKey({ regionUid: uid, geometryKey: gk, drawingHash: target.hash, dark: true }) : null,
    };
  };

  // A dark 2x export is worth using when the host is dark, the setting is on and the drawing itself is light.
  const wantsDark = (region, target, s) => !!(s.darkCrops && !isImageKind(region.kind) && target?.drawing
    && target.drawing.appState?.theme !== "dark" && isHostDark(doc));

  // Memory-only lookup in paint order: png2x-dark (when wanted) > svg > png2x > png. png2x tiers are never read with get.
  const hotEntry = (region, target, keys, s) => {
    if (keys.png2xDark && wantsDark(region, target, s)) {
      const e = cache.peek(keys.png2xDark);
      if (e) return { entry: e, key: keys.png2xDark };
    }
    if (keys.svg) {
      const e = cache.peek(keys.svg);
      if (e) return { entry: e, key: keys.svg };
    }
    if (keys.png2x) {
      const e = cache.peek(keys.png2x);
      if (e) return { entry: e, key: keys.png2x };
    }
    const e = cache.peek(keys.png);
    return e ? { entry: e, key: keys.png } : null;
  };

  // Cache, then a cold render. Resolves { entry, entryKey } | { error } | { gone }.
  async function fetchEntry(region, target, keys, alive) {
    let entry = null;
    let entryKey = keys.svg || keys.png;
    if (keys.svg) entry = await cache.get(keys.svg);
    if (!entry && keys.png2x) {
      entry = cache.peek(keys.png2x);
      if (entry) entryKey = keys.png2x;
    }
    if (!entry) { entryKey = keys.png; entry = await cache.get(keys.png); }
    if (!entry) {
      const failKey = `${region.drawingUid}|${target.hash}`;
      const failedAt = failed.get(failKey);
      if (failedAt != null && Date.now() - failedAt < FAIL_TTL_MS) return { error: true };
      if (!alive()) return { gone: true };
      let rendered;
      try {
        rendered = await renderRegionCrop({ region, target, cold, doc, api, loadBitmap });
      } catch (error) {
        console.warn("[plexus] crop failed", error);
        rendered = { error: "render-failed" };
      }
      if (!alive()) return { gone: true };
      if (rendered.error) {
        failed.set(failKey, Date.now());
        return { error: true };
      }
      entryKey = keys.png;
      // An unsettled render may still be Roam's placeholder: paint it from memory, never persist it.
      await cache.put(keys.png, rendered.blob, { w: rendered.w, h: rendered.h, persist: rendered.settled !== false });
      entry = cache.peek(keys.png) || (await cache.get(keys.png));
    }
    return { entry, entryKey };
  }

  function childNotes(uid) {
    try {
      return regionMeta(host.pullBlock(uid)?.children).hover;
    } catch {
      return [];
    }
  }

  async function hoverEntryOf(region, target, keys, uid) {
    const s = settings();
    const hot = hotEntry(region, target, keys, s);
    let entry = hot?.entry;
    let key = hot?.key;
    if (!entry?.url) {
      const res = await fetchEntry(region, target, keys, () => true);
      if (res?.entry?.url) {
        entry = res.entry;
        key = res.entryKey;
      }
    }
    const notes = childNotes(uid);
    if (!entry?.url) return notes.length ? { notes } : null;
    const out = { url: entry.url, w: entry.w, h: entry.h, invertible: !isDarkTier(key) && invertible(region, target, s) };
    if (notes.length) out.notes = notes;
    const peek = await peekOf(region, target, uid);
    if (peek) out.peek = peek;
    return out;
  }

  let peekLogged = false;

  // Source peek: cache-only 160 px thumbnail of the whole drawing plus the region rect in thumbnail pixels.
  // Image kinds and cold thumbnails give null (the crop alone).
  async function peekOf(region, target, uid) {
    try {
      if (isImageKind(region.kind) || !target?.drawing || !target.sceneBox?.bbox) return null;
      const key = thumbKey({ uid: region.drawingUid, hash: target.hash, maxWidth: 160 });
      const thumb = cache.peek(key) ?? (await cache.get(key));
      if (!thumb?.url || !(thumb.w > 0) || !(thumb.h > 0)) return null;
      const { elements, appState } = target.drawing;
      const cb = exportBounds(elements, appState);
      if (!cb) return null;
      const ew = Math.round(cb[2] - cb[0] + 2 * 10);
      const eh = Math.round(cb[3] - cb[1] + 2 * 10);
      const crop = viewPngCropRect({ elements, appState, bbox: target.sceneBox.bbox, naturalWidth: ew, naturalHeight: eh });
      if (crop.error) return null;
      const k = thumb.w / ew;
      const ky = thumb.h / eh;
      const rect = {
        x: crop.sx * k,
        y: crop.sy * ky,
        w: Math.max(4, crop.sw * k),
        h: Math.max(4, crop.sh * ky),
      };
      let src = null;
      try { src = host.labelSource?.(region.drawingUid); } catch { /* ignore */ }
      const title = drawingTitleOf(src?.string ?? "", src?.pageTitle ?? null);
      return { url: thumb.url, w: thumb.w, h: thumb.h, rect, title, kind: KIND_WORDS[region.kind] ?? region.kind };
    } catch (error) {
      if (!peekLogged) { peekLogged = true; console.warn("[plexus] source peek unavailable", error); }
      return null;
    }
  }

  const contextOf = (btn, uid) => {
    const refEl = btn.closest?.(".rm-block-ref[data-uid]") || null;
    if (!refEl) return { refEl: null, blockUid: null, outerUid: null, context: "home" };
    const blockUid = host.blockUidFromNode(refEl.parentElement) || null;
    const outerUid = refEl.closest?.('[id^="block-input-"]')?.id?.slice(-9) || null;
    const context = blockUid ? refContext(host.pullBlock(blockUid)?.string ?? "", uid) : "inline";
    return { refEl, blockUid, outerUid, context };
  };

  // Each field comes from the first of the block and outer-block entries that has it.
  const overrideOf = (ctx, uid, s) => {
    if (!ctx.blockUid) return {};
    const entries = [ctx.blockUid, ctx.outerUid]
      .filter(Boolean)
      .map((b) => s.refOverrides[overrideKey(b, uid)])
      .map((e) => (typeof e === "string" ? { mode: e } : e))
      .filter((e) => e && typeof e === "object");
    const pick = (field) => entries.find((e) => e[field] != null)?.[field];
    return { mode: pick("mode"), caption: pick("caption"), size: pick("size"), align: pick("align"), bare: pick("bare"), pad: pick("pad") };
  };

  const captionOf = (ctx, override, s) => resolveCaption({ captionDisplay: s.captionDisplay, override: { caption: override.caption }, context: ctx.context });

  const modeFor = (btn, ctx, override, s) => {
    let mode = resolveDisplay({ context: ctx.context, override: override.mode, inlineDisplay: s.inlineDisplay });
    if (mode === "image" && btn.closest?.(".plexus-portal.plexus-embed")) mode = "thumbnail";
    return mode;
  };

  const labelOf = (region) => {
    try {
      const src = host.labelSource?.(region.drawingUid) ?? { string: "", pageTitle: null };
      return regionLabel({
        kind: region.kind,
        caption: region.caption,
        drawingTitle: drawingTitleOf(src.string, src.pageTitle),
        imageAlt: isImageKind(region.kind) ? imageAltAt(src.string, region.i) : null,
        resolveBlock: (u) => host.pullBlock(u)?.string,
      });
    } catch {
      return "Region";
    }
  };

  const addSpan = (root, info, className, text) => {
    const span = doc.createElement("span");
    span.className = className;
    span.textContent = text;
    root.parentNode?.insertBefore(span, root.nextSibling);
    info.extras.push(span);
  };

  const addMeta = (root, info, children) => {
    const meta = regionMeta(children);
    if (!(meta.count > 0)) return;
    const parent = root.parentNode;
    const place = (node) => {
      const anchor = info.extras.length ? info.extras[info.extras.length - 1] : root;
      parent?.insertBefore?.(node, anchor.nextSibling);
      info.extras.push(node);
    };
    const sup = doc.createElement("sup");
    sup.className = "plexus-count";
    sup.textContent = String(meta.count);
    place(sup);
    for (const attr of meta.attrs) {
      const span = doc.createElement("span");
      span.className = "plexus-attr";
      span.textContent = typeof attr === "string" ? attr : String(attr?.string ?? "");
      place(span);
    }
  };

  const hasTail = (region) => !!String(region.caption ?? "").trim();

  // Image and thumbnail cards: hide the written text, or show the derived label when there is no tail.
  const applyCaption = (root, region, ctx, info, state) => {
    if (!ctx.refEl || ctx.context === "home") return;
    if (state === "hide") {
      const size = ctx.refEl.ownerDocument?.defaultView?.getComputedStyle?.(ctx.refEl)?.fontSize || doc.defaultView?.getComputedStyle?.(ctx.refEl)?.fontSize;
      if (size) root.style.fontSize = size;
      ctx.refEl.classList.add("plexus-caption-hidden");
    } else if (state === "show" && !hasTail(region)) {
      addSpan(root, info, "plexus-root plexus-caption-derived", info.label);
    }
  };

  const claim = (btn) => {
    try {
      if (btn.closest?.(".plexus-offscreen")) return;
      if (btn.isConnected === false) return;
      if (btn.getAttribute(CLAIMED)) return;
      const uid = host.blockUidFromNode(btn);
      if (!uid) return;
      const block = host.pullBlock(uid);
      const region = block ? parseRegion(block.string) : null;
      if (!region) return;

      const s = settings();
      const ctx = contextOf(btn, uid);
      const override = overrideOf(ctx, uid, s);
      const mode = modeFor(btn, ctx, override, s);
      const capState = captionOf(ctx, override, s);
      const label = labelOf(region);

      btn.setAttribute(CLAIMED, "1");
      btn.classList.add("plexus-hidden");
      const root = doc.createElement("span");
      root.className = `plexus-root plexus-regionref plexus-regionref--${mode}`;
      root.title = label;
      btn.parentNode.insertBefore(root, btn.nextSibling);
      prune();
      const info = { btn, refEl: ctx.refEl, refUid: uid, blockUid: ctx.blockUid, outerUid: ctx.outerUid, mode, label, capState, size: override.size, align: override.align, disposers: [], hosts: [], extras: [] };
      roots.set(root, info);
      if (ctx.refEl && mode !== "link") {
        ctx.refEl.classList.add("plexus-ref-card");
        ctx.refEl.classList.add(`plexus-mode-${mode}`);
        if (override.bare === true) ctx.refEl.classList.add("plexus-ref-bare");
        if (Number.isInteger(override.pad) && ctx.refEl.style) ctx.refEl.style.padding = `${override.pad}px`;
        if ((override.align === "left" || override.align === "center" || override.align === "right") && ctx.refEl.style) ctx.refEl.style.textAlign = override.align;
        hostAncestors(ctx.refEl, info);
      }
      addMeta(root, info, block.children);

      if (!region.supported) {
        chip(root, region.error ? `Invalid region: ${region.error}` : `Region kind ${region.kind} needs a newer Plexus`);
        return;
      }

      root.setAttribute("role", "img");
      root.setAttribute("aria-label", label);
      root.setAttribute("tabindex", "0");
      if (mode !== "link") applyCaption(root, region, ctx, info, capState);

      root.addEventListener("keydown", (e) => {
        try {
          if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          e.stopPropagation();
          onOpen(uid, { sidebar: !!getSettings().openInSidebar !== !!e.shiftKey });
        } catch (error) {
          console.warn("[plexus] open failed", error);
        }
      });
      root.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        e.preventDefault();
      }, true);
      root.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        try {
          onOpen(uid, { sidebar: !!getSettings().openInSidebar !== !!e.shiftKey });
        } catch (error) {
          console.warn("[plexus] open failed", error);
        }
      }, true);

      const target = resolveRegionTarget(host, region);
      if (target.error) return chip(root, target.error);
      const keys = keysFor(uid, region, target);

      const hoverEntry = () => hoverEntryOf(region, target, keys, uid);

      if (mode === "link") {
        root.className = "plexus-root plexus-regionref plexus-regionref--link plexus-ref-glyph";
        root.innerHTML = GLYPH;
        if (ctx.context !== "home" && !hasTail(region)) addSpan(root, info, "plexus-root plexus-ref-label", label);
        const anchor = ctx.refEl || root;
        info.disposers.push(getPopover().hoverOn(anchor, hoverEntry));
        stopHover(anchor, info);
        return;
      }
      if (mode === "thumbnail" || mode === "image") {
        info.disposers.push(getPopover().hoverOn(root, hoverEntry));
        stopHover(root, info);
      }

      const hot = hotEntry(region, target, keys, s);
      if (hot) return paint(root, hot.entry, hot.key, region, info, target);

      let bw = 4;
      let bh = 3;
      if (target.sceneBox) {
        const [x1, y1, x2, y2] = target.sceneBox.bbox;
        bw = Math.max(1, x2 - x1);
        bh = Math.max(1, y2 - y1);
      }
      const h = mode === "thumbnail" ? s.thumbHeight : Math.min(s.figureHeight, target.sceneBox ? bh : 120);
      root.className = `plexus-root plexus-regionref plexus-regionref--${mode} plexus-placeholder`;
      root.style.height = `${h}px`;
      root.style.width = `${Math.round((h * bw) / bh)}px`;

      void (async () => {
        try {
          const res = await fetchEntry(region, target, keys, () => root.isConnected);
          if (res.gone) return;
          if (res.error) return finishChip(root, region);
          if (!root.isConnected) return;
          if (!res.entry) return finishChip(root, region);
          root.style.height = "";
          root.style.width = "";
          paint(root, res.entry, res.entryKey, region, info, target);
        } catch (error) {
          console.warn("[plexus] crop failed", error);
          finishChip(root, region);
        }
      })();
    } catch (error) {
      console.warn("[plexus] claim failed", error);
    }
  };

  function unalias(anchor, info) {
    dropInfo(info);
    anchor.removeAttribute?.(ALIAS_CLAIMED);
    aliases.delete(anchor);
  }

  const regionOf = (uid) => {
    const block = host.pullBlock(uid);
    const region = block ? parseRegion(block.string) : null;
    return region?.supported ? region : null;
  };

  // [text](((regionUid))) alias: crop hover, plain click opens the region, modified clicks stay Roam's.
  const claimAlias = (anchor) => {
    try {
      if (!anchor || anchor.isConnected === false) return;
      if (anchor.closest?.(".plexus-offscreen, .plexus-root")) return;
      if (anchor.classList?.contains("rm-alias--page") || !anchor.classList?.contains("rm-alias--block")) return;
      if (anchor.getAttribute?.(ALIAS_CLAIMED) || notRegions.has(anchor)) return;
      const uid = anchor.dataset?.linkUid ?? anchor.getAttribute?.("data-link-uid");
      if (!uid) return;
      if (!regionOf(uid)) { notRegions.add(anchor); return; }

      anchor.setAttribute(ALIAS_CLAIMED, "1");
      const info = { uid, disposers: [] };
      aliases.set(anchor, info);
      prune();

      const currentUid = () => anchor.dataset?.linkUid ?? anchor.getAttribute?.("data-link-uid");
      const hoverEntry = async () => {
        const u = currentUid();
        const region = u ? regionOf(u) : null;
        if (!region) return null;
        info.uid = u;
        const target = resolveRegionTarget(host, region);
        if (target.error) return null;
        return hoverEntryOf(region, target, keysFor(u, region, target), u);
      };
      info.disposers.push(getPopover().hoverOn(anchor, hoverEntry));
      stopHover(anchor, info);

      const plain = (e) => (e.button ?? 0) === 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
      const capture = (open) => (e) => {
        try {
          const u = currentUid();
          if (!plain(e) || !u || !regionOf(u)) return;
          e.preventDefault();
          e.stopPropagation();
          info.uid = u;
          if (open) onOpen(u, { sidebar: !!getSettings().openInSidebar });
        } catch (error) {
          console.warn("[plexus] alias open failed", error);
        }
      };
      const onDown = capture(false);
      const onClick = capture(true);
      anchor.addEventListener("mousedown", onDown, true);
      anchor.addEventListener("click", onClick, true);
      info.disposers.push(() => {
        anchor.removeEventListener?.("mousedown", onDown, true);
        anchor.removeEventListener?.("click", onClick, true);
      });
    } catch (error) {
      console.warn("[plexus] alias claim failed", error);
    }
  };

  const reclaimAliases = (match) => {
    for (const [anchor, info] of [...aliases]) {
      try {
        if (anchor.isConnected === false) { unalias(anchor, info); continue; }
        if (!match(info)) continue;
        unalias(anchor, info);
        claimAlias(anchor);
      } catch (error) {
        console.warn("[plexus] alias refresh failed", error);
      }
    }
  };

  function finishChip(root, region) {
    root.style.height = "";
    root.style.width = "";
    chip(root, region && isImageKind(region.kind) ? "Image not available" : "Open the drawing to render this region");
  }

  const reclaim = (match) => {
    for (const [root, info] of [...roots]) {
      try {
        if (info.btn.isConnected === false || !root.isConnected) {
          unclaim(root, info);
          continue;
        }
        if (!match(info)) continue;
        unclaim(root, info);
        claim(info.btn);
      } catch (error) {
        console.warn("[plexus] refresh failed", error);
      }
    }
  };

  return {
    claim,
    claimAlias,
    refreshAll() {
      reclaim(() => true);
      reclaimAliases(() => true);
    },
    refreshBlock(blockUid) {
      reclaim((info) => info.blockUid === blockUid || info.outerUid === blockUid);
    },
    async refreshRegion(regionUid, { purge = true } = {}) {
      try {
        if (purge) {
          const block = host.pullBlock(regionUid);
          const region = block ? parseRegion(block.string) : null;
          if (region?.supported) {
            const target = resolveRegionTarget(host, region);
            if (!target.error) {
              const keys = keysFor(regionUid, region, target);
              await Promise.all([keys.svg, keys.png2x, keys.png2xDark, keys.png].filter(Boolean).map((k) => Promise.resolve(cache.delete?.(k)).catch(() => {})));
              failed.delete(`${region.drawingUid}|${target.hash}`);
            }
          }
        }
        reclaim((info) => info.refUid === regionUid);
        reclaimAliases((info) => info.uid === regionUid);
      } catch (error) {
        console.warn("[plexus] refreshRegion failed", error);
      }
    },
    modeOf({ blockUid, refUid }) {
      try {
        for (const [root, info] of roots) {
          if (root.isConnected && info.refUid === refUid && (info.blockUid === blockUid || info.outerUid === blockUid)) return info.mode;
        }
        const s = settings();
        const context = blockUid ? refContext(host.pullBlock(blockUid)?.string ?? "", refUid) : "inline";
        const override = blockUid ? s.refOverrides[overrideKey(blockUid, refUid)] : undefined;
        return resolveDisplay({ context, override, inlineDisplay: s.inlineDisplay });
      } catch (error) {
        console.warn("[plexus] modeOf failed", error);
        return "thumbnail";
      }
    },
    captionStateOf({ blockUid, refUid }) {
      try {
        for (const [root, info] of roots) {
          if (root.isConnected && info.refUid === refUid && (info.blockUid === blockUid || info.outerUid === blockUid)) return info.capState;
        }
        const s = settings();
        const context = blockUid ? refContext(host.pullBlock(blockUid)?.string ?? "", refUid) : "inline";
        const override = overrideOf({ blockUid, outerUid: null }, refUid, s);
        return captionOf({ context }, override, s);
      } catch (error) {
        console.warn("[plexus] captionStateOf failed", error);
        return "written";
      }
    },
    releaseAll() {
      for (const [root, info] of [...roots]) unclaim(root, info);
      roots.clear();
      for (const [anchor, info] of [...aliases]) unalias(anchor, info);
      aliases.clear();
      failed.clear();
      popover?.dispose();
      popover = null;
    },
  };
}
