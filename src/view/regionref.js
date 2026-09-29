import { parseRegion, geometryKey } from "../model/region.js";
import { naturalToScene, regionSceneBBox, sceneToNatural, viewPngCropRect } from "../model/scene.js";
import { clipPolyToUnit, imageCropRect, parseImageRefs, polyBBox, polyToLocal } from "../model/image.js";
import { fnv1a } from "../model/hash.js";
import { cropKey } from "../host/cache.js";
import { cropCanvasToBlob } from "../host/cold-render.js";
import { cropToBlob, loadImageBitmap } from "../host/image-source.js";
import { hostDarkMarker, isHostDark } from "../host/theme.js";
import { overrideKey, refContext, resolveDisplay } from "../model/refdisplay.js";
import { createCropPopover } from "./crop-popover.js";

const CLAIMED = "data-plexus-claimed";
const FAIL_TTL_MS = 60000;
const PRUNE_FLOOR = 64;
export const IMAGE_SETTLE_MS = 1200;
export const PLAIN_SETTLE_MS = 150;

export const IMAGE_KINDS = new Set(["imgrect", "imgpoly"]);
export const isImageKind = (kind) => IMAGE_KINDS.has(kind);

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

const num = (v, d) => (Number.isFinite(Number(v)) && v !== "" && v != null ? Number(v) : d);

const overlaps = (bbox, el) => el.x < bbox[2] && el.x + el.width > bbox[0] && el.y < bbox[3] && el.y + el.height > bbox[1];

export function createRegionRefRenderer({ host, cache, cold, getSettings, onOpen, doc, api = globalThis.roamAlphaAPI, loadBitmap = loadImageBitmap }) {
  const roots = new Map();
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
      refOverrides: s.refOverrides && typeof s.refOverrides === "object" ? s.refOverrides : {},
      darkCrops: s.darkCrops !== false,
      openInSidebar: s.openInSidebar,
    };
  };

  const prune = () => {
    if (roots.size < pruneAt) return;
    for (const [root, info] of [...roots]) if (!root.isConnected) { dropInfo(info); roots.delete(root); }
    pruneAt = Math.max(PRUNE_FLOOR, roots.size * 2);
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
    for (const c of ["plexus-ref-card", "plexus-mode-image", "plexus-mode-thumbnail"]) info.refEl?.classList?.remove(c);
    info.btn.classList.remove("plexus-hidden");
    info.btn.removeAttribute(CLAIMED);
    root.remove();
    roots.delete(root);
  };

  const chip = (root, text) => {
    root.className = "plexus-root plexus-regionref plexus-chip";
    root.textContent = text;
  };

  const paint = (root, entry, key, region, info, target) => {
    if (!root.isConnected) return;
    const s = settings();
    const img = doc.createElement("img");
    img.draggable = false;
    img.className = `plexus-crop${invertible(region, target, s) ? " plexus-crop--invertible" : ""}`;
    if (invertible(region, target, s) && isHostDark(doc) && !hostDarkMarker(doc)) img.classList.add("plexus-crop--invert");
    img.onerror = () => {
      if (key) Promise.resolve(cache.delete?.(key)).catch(() => {});
      if (root.isConnected) finishChip(root, region);
    };
    if (info.mode === "thumbnail") {
      img.style.height = `${s.thumbHeight}px`;
      img.style.maxHeight = "none";
      img.style.maxWidth = `min(100%, ${4 * s.thumbHeight}px)`;
    } else {
      img.style.maxHeight = `${s.figureHeight}px`;
    }
    img.src = entry.url;
    root.className = `plexus-root plexus-regionref plexus-regionref--${info.mode}`;
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
    return {
      png: cropKey({ regionUid: uid, geometryKey: gk, drawingHash: target.hash, tier: "png" }),
      svg: target.url ? null : cropKey({ regionUid: uid, geometryKey: gk, drawingHash: target.hash, tier: "svg" }),
    };
  };

  // Cache, then a cold render. Resolves { entry, entryKey } | { error } | { gone }.
  async function fetchEntry(region, target, keys, alive) {
    let entry = null;
    let entryKey = keys.svg || keys.png;
    if (keys.svg) entry = await cache.get(keys.svg);
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

  const contextOf = (btn, uid) => {
    const refEl = btn.closest?.(".rm-block-ref[data-uid]") || null;
    if (!refEl) return { refEl: null, blockUid: null, outerUid: null, context: "home" };
    const blockUid = host.blockUidFromNode(refEl.parentElement) || null;
    const outerUid = refEl.closest?.('[id^="block-input-"]')?.id?.slice(-9) || null;
    const context = blockUid ? refContext(host.pullBlock(blockUid)?.string ?? "", uid) : "inline";
    return { refEl, blockUid, outerUid, context };
  };

  const modeFor = (btn, ctx, uid, s) => {
    const overrides = s.refOverrides;
    const override = ctx.blockUid ? overrides[overrideKey(ctx.blockUid, uid)] ?? (ctx.outerUid ? overrides[overrideKey(ctx.outerUid, uid)] : undefined) : undefined;
    let mode = resolveDisplay({ context: ctx.context, override, inlineDisplay: s.inlineDisplay });
    if (mode === "image" && btn.closest?.(".plexus-portal.plexus-embed")) mode = "thumbnail";
    return mode;
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
      const mode = modeFor(btn, ctx, uid, s);

      btn.setAttribute(CLAIMED, "1");
      btn.classList.add("plexus-hidden");
      const root = doc.createElement("span");
      root.className = `plexus-root plexus-regionref plexus-regionref--${mode}`;
      if (region.caption) root.title = region.caption;
      btn.parentNode.insertBefore(root, btn.nextSibling);
      prune();
      const info = { btn, refEl: ctx.refEl, refUid: uid, blockUid: ctx.blockUid, outerUid: ctx.outerUid, mode, disposers: [], hosts: [] };
      roots.set(root, info);
      if (ctx.refEl && mode !== "link") {
        ctx.refEl.classList.add("plexus-ref-card");
        ctx.refEl.classList.add(`plexus-mode-${mode}`);
        hostAncestors(ctx.refEl, info);
      }

      if (!region.supported) {
        chip(root, region.error ? `Invalid region: ${region.error}` : `Region kind ${region.kind} needs a newer Plexus`);
        return;
      }

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

      const hoverEntry = async () => {
        const hot = (keys.svg && cache.peek(keys.svg)) || cache.peek(keys.png);
        let entry = hot;
        if (!entry) {
          const res = await fetchEntry(region, target, keys, () => true);
          entry = res.entry;
        }
        return entry ? { url: entry.url, w: entry.w, h: entry.h, invertible: invertible(region, target, settings()) } : null;
      };

      if (mode === "link") {
        root.className = "plexus-root plexus-regionref plexus-regionref--link plexus-ref-glyph";
        root.innerHTML = GLYPH;
        const anchor = ctx.refEl || root;
        info.disposers.push(getPopover().hoverOn(anchor, hoverEntry));
        stopHover(anchor, info);
        return;
      }
      if (mode === "thumbnail") {
        info.disposers.push(getPopover().hoverOn(root, hoverEntry));
        stopHover(root, info);
      }

      const hotSvg = keys.svg ? cache.peek(keys.svg) : null;
      const hot = hotSvg || cache.peek(keys.png);
      if (hot) return paint(root, hot, hotSvg ? keys.svg : keys.png, region, info, target);

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
    refreshAll() {
      reclaim(() => true);
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
              await Promise.all([keys.svg, keys.png].filter(Boolean).map((k) => Promise.resolve(cache.delete?.(k)).catch(() => {})));
              failed.delete(`${region.drawingUid}|${target.hash}`);
            }
          }
        }
        reclaim((info) => info.refUid === regionUid);
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
    releaseAll() {
      for (const [root, info] of [...roots]) unclaim(root, info);
      roots.clear();
      failed.clear();
      popover?.dispose();
      popover = null;
    },
  };
}
