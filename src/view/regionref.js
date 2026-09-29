import { parseRegion, geometryKey } from "../model/region.js";
import { naturalToScene, regionSceneBBox, sceneToNatural, viewPngCropRect } from "../model/scene.js";
import { imageCropRect, parseImageRefs, polyBBox, polyToLocal } from "../model/image.js";
import { fnv1a } from "../model/hash.js";
import { cropKey } from "../host/cache.js";
import { cropCanvasToBlob } from "../host/cold-render.js";
import { cropToBlob, loadImageBitmap } from "../host/image-source.js";

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

// Natural-image polygon (flat fractions) -> displayed-box fractions, clamped to the box. Null when fully outside.
export function displayedPoly(el, p) {
  if (!el?.crop) return p;
  const out = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < p.length; i += 2) {
    const [sx, sy] = pt(naturalToScene(el, [p[i], p[i + 1]]));
    const x = (sx - el.x) / el.width;
    const y = (sy - el.y) / el.height;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    out.push(x, y);
  }
  if (!(maxX > 0) || !(maxY > 0) || !(minX < 1) || !(minY < 1)) return null;
  return out.map((v) => Math.min(1, Math.max(0, v)));
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

export function createRegionRefRenderer({ host, cache, cold, getSettings, onOpen, doc, api = globalThis.roamAlphaAPI, loadBitmap = loadImageBitmap }) {
  const roots = new Map();
  const failed = new Map();
  let pruneAt = PRUNE_FLOOR;

  const prune = () => {
    if (roots.size < pruneAt) return;
    for (const root of [...roots.keys()]) if (!root.isConnected) roots.delete(root);
    pruneAt = Math.max(PRUNE_FLOOR, roots.size * 2);
  };

  const chip = (root, text) => {
    root.className = "plexus-root plexus-regionref plexus-chip";
    root.textContent = text;
  };

  const paint = (root, entry, key, region) => {
    if (!root.isConnected) return;
    const img = doc.createElement("img");
    img.className = "plexus-crop";
    img.draggable = false;
    img.onerror = () => {
      if (key) Promise.resolve(cache.delete?.(key)).catch(() => {});
      if (root.isConnected) finishChip(root, region);
    };
    img.style.maxHeight = `${getSettings().maxCropHeight}px`;
    img.src = entry.url;
    root.className = "plexus-root plexus-regionref";
    root.textContent = "";
    root.append(img);
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

      btn.setAttribute(CLAIMED, "1");
      btn.classList.add("plexus-hidden");
      const root = doc.createElement("span");
      root.className = "plexus-root plexus-regionref";
      if (region.caption) root.title = region.caption;
      btn.parentNode.insertBefore(root, btn.nextSibling);
      prune();
      roots.set(root, btn);

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

      const gk = geometryKey(region);
      const pngKey = cropKey({ regionUid: uid, geometryKey: gk, drawingHash: target.hash, tier: "png" });
      const svgKey = target.url ? null : cropKey({ regionUid: uid, geometryKey: gk, drawingHash: target.hash, tier: "svg" });

      const hotSvg = svgKey ? cache.peek(svgKey) : null;
      const hot = hotSvg || cache.peek(pngKey);
      if (hot) return paint(root, hot, hotSvg ? svgKey : pngKey, region);

      const maxH = getSettings().maxCropHeight;
      let bw = 4;
      let bh = 3;
      if (target.sceneBox) {
        const [x1, y1, x2, y2] = target.sceneBox.bbox;
        bw = Math.max(1, x2 - x1);
        bh = Math.max(1, y2 - y1);
      }
      const h = Math.min(maxH, target.sceneBox ? bh : 120);
      root.className = "plexus-root plexus-regionref plexus-placeholder";
      root.style.height = `${h}px`;
      root.style.width = `${Math.round((h * bw) / bh)}px`;

      void (async () => {
        try {
          let entry = null;
          let entryKey = svgKey || pngKey;
          if (svgKey) entry = await cache.get(svgKey);
          if (!entry) { entryKey = pngKey; entry = await cache.get(pngKey); }
          if (!entry) {
            const failKey = `${region.drawingUid}|${target.hash}`;
            const failedAt = failed.get(failKey);
            if (failedAt != null && Date.now() - failedAt < FAIL_TTL_MS) return finishChip(root, region);
            if (!root.isConnected) return;
            let rendered;
            try {
              rendered = await renderRegionCrop({ region, target, cold, doc, api, loadBitmap });
            } catch (error) {
              console.warn("[plexus] crop failed", error);
              rendered = { error: "render-failed" };
            }
            if (!root.isConnected) return;
            if (rendered.error) {
              failed.set(failKey, Date.now());
              return finishChip(root, region);
            }
            entryKey = pngKey;
            // An unsettled render may still be Roam's placeholder: paint it from memory, never persist it.
            await cache.put(pngKey, rendered.blob, { w: rendered.w, h: rendered.h, persist: rendered.settled !== false });
            entry = cache.peek(pngKey) || (await cache.get(pngKey));
          }
          if (!root.isConnected) return;
          if (!entry) return finishChip(root, region);
          root.style.height = "";
          root.style.width = "";
          paint(root, entry, entryKey, region);
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

  return {
    claim,
    releaseAll() {
      for (const [root, btn] of roots) {
        btn.classList.remove("plexus-hidden");
        btn.removeAttribute(CLAIMED);
        root.remove();
      }
      roots.clear();
      failed.clear();
    },
  };
}
