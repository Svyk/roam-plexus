import { DEFAULT_PAD, geometryKey, isContainerString, isId, normalizeFrac, normalizePoly, parseRegion, serializeRegion } from "./model/region.js";
import { commonBounds, elementBounds, regionSceneBBox, cropSvgToFraction, normalizeSvgSize, viewPngCropRect, viewportToScene } from "./model/scene.js";
import { embedAnchors, embedLabel, makeEmbedAnchor, parseEmbedRef } from "./model/embeds.js";
import { LEGACY_QUERY, isLegacyDrawingString, legacyReport, legacySummary, legacyToElements, parseLegacyDrawing, rowsFromQuery } from "./model/legacy.js";
import { orderFrames } from "./model/slides.js";
import { captionRefsFromElements, captionRefsInfo } from "./model/caption.js";
import { clipSvgToPolygon, parseImageRefs, polyBBox, polyToLocal, simplifyPoly, thumbnailSize } from "./model/image.js";
import { isExcludedString } from "./model/mindmap.js";
import { drawingTitleOf, imageAltAt, isPlaceholderCaption, plainCaption, regionLabel } from "./model/label.js";
import { fnv1a } from "./model/hash.js";
import { cropKey } from "./host/cache.js";
import { lockName, withLock } from "./host/locks.js";
import { cropCanvasToBlob } from "./host/cold-render.js";
import { clearImageMemo, loadImageBitmap } from "./host/image-source.js";
import { startImageRegionTool } from "./view/image-region-tool.js";
import { createLegacyDialog } from "./view/legacy-dialog.js";
import { createCleanupDialog } from "./view/cleanup-dialog.js";
import { IMAGE_SETTLE_MS, PLAIN_SETTLE_MS, displayedPoly, displayedRect, displayedToNatural, isImageKind, renderRegionCrop, resolveRegionTarget } from "./view/regionref.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const noop = () => {};

const CAPTION_MODES = ["auto", "ask", "none"];
const PIN_SIZES = [4, 8, 12];
const WHOLE_IMAGE_AREA = 0.98;
const SVG_HREF_RE = /(?:xlink:)?href\s*=\s*["']([^"']*)["']/gi;
const REFS_RE = /\(\([\w-]+\)\)|\[\[[^\]]+\]\]/g;
const refTokens = (text) => new Set(String(text ?? "").match(REFS_RE) || []);
const REGION_HEAD_RE = /^\s*\{\{\[\[plexus-region\]\]:[^}]*\}\}/;

// The exact current head plus " " + tail (or the bare head): the string is never re-serialized, so token order and
// extras survive. Null when the result is not the same region with exactly that caption.
export function headPreservingString(before, tail) {
  const head = REGION_HEAD_RE.exec(before)?.[0];
  if (!head) return null;
  const text = String(tail ?? "").replace(/\s+/g, " ").trim();
  const next = text ? `${head} ${text}` : head;
  const a = parseRegion(before);
  const b = parseRegion(next);
  if (!a?.supported || !b?.supported || geometryKey(a) !== geometryKey(b) || b.caption !== text) return null;
  return next;
}

const isFrameEl = (el) => !!el && (el.type === "frame" || el.type === "magicframe");

// A pin: a square whose side is pct% of the shorter displayed side, centred on (x, y) and shifted (not shrunk) to stay inside.
export function pinFraction({ x, y, width, height, pct }) {
  const side = (pct / 100) * Math.min(width, height);
  const fw = Math.min(1, side / width);
  const fh = Math.min(1, side / height);
  const left = Math.min(1 - fw, Math.max(0, x - fw / 2));
  const top = Math.min(1 - fh, Math.max(0, y - fh / 2));
  return [left, top, fw, fh];
}

const DRAWING_BLOCK_RE = /^\s*\{\{(?:\[\[excalidraw\]\]|excalidraw)\}\}/;
const NOT_EDITABLE_RE = /^\s*\{\{(?:\[\[excalidraw\]\]|excalidraw|\[\[roam\/render\]\]|roam\/render)/;
const liveTagged = (drawing, uid) => (drawing?.elements || []).filter((e) => !e.isDeleted && e.customData?.plexus?.migratedFrom === uid).length;

async function waitFor(fn, timeoutMs, stepMs = 50, aborted = () => false) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (aborted()) return null;
    const value = fn();
    if (value) return value;
    if (Date.now() >= end) return null;
    await sleep(stepMs);
  }
}

function svgSize(svg) {
  const vb = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(svg);
  if (vb) return { w: Math.round(Number(vb[1])), h: Math.round(Number(vb[2])) };
  return { w: 0, h: 0 };
}

// A native crop as natural-image fractions, the stored form of a region.
export function cropToFraction(crop) {
  return [crop.x / crop.naturalWidth, crop.y / crop.naturalHeight, crop.width / crop.naturalWidth, crop.height / crop.naturalHeight];
}

const validCrop = (c) => !!c && c.width > 0 && c.height > 0 && c.naturalWidth > 0 && c.naturalHeight > 0;

const isFrame = (el) => el.type === "frame" || el.type === "magicframe";
const DRAWING_STRING_RE = /^\s*\{\{(?:\[\[excalidraw\]\]|excalidraw)\}\}/;

// Which region kind the Region button should create for a selection (contract: cframe, then group, else area).
export function detectRegionKind({ elements, ids, selectedGroupIds }) {
  const live = (elements || []).filter((el) => el && !el.isDeleted);
  const byId = new Map(live.map((el) => [el.id, el]));
  const selected = ids.map((id) => byId.get(id)).filter(Boolean);
  const frames = selected.filter(isFrame);
  if (frames.length === 1 && selected.every((el) => el === frames[0] || el.frameId === frames[0].id)) {
    const frame = frames[0];
    return { kind: "cframe", frame, children: live.filter((el) => el.frameId === frame.id) };
  }
  const groupIds = Object.keys(selectedGroupIds || {}).filter((g) => selectedGroupIds[g]);
  if (groupIds.length === 1) {
    const g = groupIds[0];
    const members = live.filter((el) => Array.isArray(el.groupIds) && el.groupIds.includes(g));
    const sel = new Set(ids);
    if (members.length && members.length === sel.size && members.every((el) => sel.has(el.id))) {
      return { kind: "group", groupId: g, members };
    }
  }
  return { kind: "area" };
}

export function contentRect(img, view) {
  const rect = img.getBoundingClientRect();
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const fit = view?.getComputedStyle?.(img)?.objectFit;
  if (!(nw > 0) || !(nh > 0) || !(rect.width > 0) || !(rect.height > 0) || !["contain", "scale-down"].includes(fit)) {
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }
  const fitScale = Math.min(rect.width / nw, rect.height / nh);
  const scale = fit === "scale-down" ? Math.min(1, fitScale) : fitScale;
  const width = nw * scale;
  const height = nh * scale;
  return { left: rect.left + (rect.width - width) / 2, top: rect.top + (rect.height - height) / 2, width, height };
}

async function downscaleTo(source, width, height, maxWidth, doc) {
  const size = thumbnailSize({ width, height, maxWidth });
  const out = doc.createElement("canvas");
  out.width = size.width;
  out.height = size.height;
  out.getContext("2d").drawImage(source, 0, 0, width, height, 0, 0, size.width, size.height);
  return new Promise((resolve, reject) => {
    out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("[plexus] toBlob failed"))), "image/png");
  });
}

export function createActions({
  host,
  native,
  cache,
  cold,
  toaster,
  spotlight,
  getSettings,
  doc,
  clipboard,
  api = globalThis.roamAlphaAPI,
  emit = () => {},
  loadBitmap = loadImageBitmap,
  fetchBlob = (url) => globalThis.fetch(url).then((r) => r.blob()),
  createBitmap = globalThis.createImageBitmap?.bind(globalThis),
  startTool = startImageRegionTool,
  presenter = null,
  mindmap = null,
  getEmbedOverlay = () => null,
  refreshRegion = null,
  createDialog = createLegacyDialog,
  createCleanup = createCleanupDialog,
  openPrompt = null,
  ClipboardItemCtor = globalThis.ClipboardItem,
  rasterize = null,
  urls = globalThis.URL,
  upload = null,
  closePollMs = 150,
  closeWindowMs = 3000,
  revokeDelayMs = 1000,
  confirm = (message) => globalThis.confirm?.(message),
  withLockFn = withLock,
  frame = () => new Promise((resolve) => (typeof globalThis.requestAnimationFrame === "function" ? globalThis.requestAnimationFrame(() => resolve()) : setTimeout(resolve, 16))),
  verifyPollMs = 100,
  verifyTimeoutMs = 3000,
}) {
  let disposed = false;
  let activeTool = null;
  let activeToolIsDrawing = false;
  let stopSpotlight = null;
  const busy = new Set();
  let presentOwner = null;
  const thumbPending = new Map();
  const aborted = () => disposed;
  let legacyDialog = null;
  let cleanupDialog = null;
  let migrating = false;
  let activePrompt = null;
  let activePromptIsDrawing = false;
  let cleanupReport = null;
  let undoSlot = null;
  const closePolls = new Map();
  const revokers = new Set();

  async function once(name, fn) {
    if (busy.has(name)) return null;
    busy.add(name);
    try {
      return await fn();
    } finally {
      busy.delete(name);
    }
  }

  const sceneElements = (app) => app.getSceneElements?.() ?? app.getSceneElementsIncludingDeleted?.() ?? [];

  async function putSvg(uid, region, svg) {
    const drawing = host.drawing(region.drawingUid);
    if (!svg || !drawing) return;
    svg = normalizeSvgSize(svg);
    const key = cropKey({ regionUid: uid, geometryKey: geometryKey(region), drawingHash: drawing.hash, tier: "svg" });
    await cache.put(key, new Blob([svg], { type: "image/svg+xml" }), svgSize(svg));
  }

  async function finishCreate(region, svg) {
    return finishWith(region, (uid) => putSvg(uid, region, svg));
  }

  async function finishWith(region, cachePut) {
    let uid;
    if (Array.isArray(region.f)) region.f = normalizeFrac(region.f);
    if (Array.isArray(region.p)) region.p = normalizePoly(region.p);
    try {
      uid = await host.createRegion(region.drawingUid, serializeRegion(region));
    } catch (error) {
      console.warn("[plexus] create region failed", error);
      toaster.show("Could not create region, try again", { kind: "error" });
      return null;
    }
    try {
      await cachePut(uid);
    } catch (error) {
      console.warn("[plexus] cache put failed", error);
    }
    try {
      emit({ uid, kind: "region" });
    } catch (error) {
      console.warn("[plexus] change emit failed", error);
    }
    try {
      const write = () => clipboard.writeText(`((${uid}))`);
      await (native.withClipboard ? native.withClipboard(write) : write());
      toaster.show(`Region ((${uid})) copied`);
    } catch (error) {
      console.warn("[plexus] clipboard failed", error);
      toaster.show(`Region ((${uid})) created`);
    }
    return uid;
  }

  async function captureSafe(app, ids) {
    try {
      return await native.captureSelectionSvg(app, ids, { clipboard });
    } catch (error) {
      console.warn("[plexus] svg capture failed", error);
      return null;
    }
  }

  const membersOf = (region, elements) => {
    const live = elements.filter((el) => el && !el.isDeleted);
    if (region.kind === "group") return live.filter((el) => el.groupIds?.includes(region.groupId ?? region.g)).map((el) => el.id);
    const frameId = region.frameId ?? region.fr;
    const children = live.filter((el) => el.frameId === frameId).map((el) => el.id);
    return region.kind === "cframe" ? [frameId] : [frameId, ...children];
  };

  // Elements a hot SVG export must select for this region.
  const hotIds = (region, elements) => {
    if (region.kind === "area") return region.ids;
    if (region.kind === "rect" || region.kind === "poly") return [region.el];
    return membersOf(region, elements);
  };

  // Hot path: Excalidraw's own SVG export, cropped (rect/poly) and clipped (poly). Null on any failure.
  async function hotSvg(app, region) {
    const elements = sceneElements(app);
    const imageEl = region.kind === "rect" || region.kind === "poly" ? elements.find((el) => el.id === region.el && !el.isDeleted) : null;
    // rect/poly fractions are natural-image; map them onto the displayed (cropped) box before cropping the export.
    const f = region.kind === "rect" ? displayedRect(imageEl, region.f) : null;
    const p = region.kind === "poly" ? displayedPoly(imageEl, region.p) : null;
    if ((region.kind === "rect" && !f) || (region.kind === "poly" && !p)) return null;
    const svg = await captureSafe(app, hotIds(region, elements));
    if (!svg) return null;
    try {
      if (region.kind === "rect") return cropSvgToFraction(svg, f);
      if (region.kind === "poly") {
        const box = polyBBox(p);
        return clipSvgToPolygon(cropSvgToFraction(svg, box), polyToLocal(p, box));
      }
      return svg;
    } catch (error) {
      console.warn("[plexus] svg crop failed", error);
      return null;
    }
  }

  // Element ids whose captions describe a drawing region (same sets the creators use).
  const captionIds = (region, elements) => {
    const live = elements.filter((el) => el && !el.isDeleted);
    if (region.kind === "area") return region.ids;
    if (region.kind === "group") return live.filter((el) => el.groupIds?.includes(region.groupId)).map((el) => el.id);
    return live.filter((el) => el.frameId === region.frameId).map((el) => el.id);
  };

  const RELINK_KINDS = new Set(["area", "group", "frame", "cframe"]);

  // { region, caption } when the region's caption would change by linking source refs, else null. Never throws.
  function relinkPlan(regionUid) {
    try {
      const block = isId(regionUid) ? host.pullBlock(regionUid) : null;
      const region = block ? parseRegion(block.string) : null;
      if (!region || !region.supported || !RELINK_KINDS.has(region.kind)) return null;
      const elements = host.drawing(region.drawingUid)?.elements;
      if (!Array.isArray(elements)) return null;
      const frameEl = region.kind === "frame" || region.kind === "cframe" ? elements.find((e) => e && e.id === region.frameId && !e.isDeleted) : null;
      const { caption, hasRef } = captionRefsInfo(elements, captionIds(region, elements), frameEl?.name ? { frameName: frameEl.name } : undefined);
      if (!hasRef || !caption) return null;
      const have = refTokens(region.caption);
      const missing = [...refTokens(caption)].some((token) => !have.has(token));
      return { region, caption, current: region.caption, block, missing };
    } catch (error) {
      console.warn("[plexus] caption plan failed", error);
      return null;
    }
  }

  const croppedImage = (app) => {
    const ids = native.selectedElementIds(app);
    if (ids.length !== 1) return null;
    const el = sceneElements(app).find((e) => e.id === ids[0] && !e.isDeleted);
    return el && el.type === "image" && validCrop(el.crop) ? el : null;
  };

  const settingsNow = () => {
    try { return getSettings?.() || {}; } catch { return {}; }
  };
  const captionMode = () => {
    const m = settingsNow().captionMode;
    return CAPTION_MODES.includes(m) ? m : "auto";
  };
  const pinPct = () => {
    const n = Number(settingsNow().pinSize);
    return PIN_SIZES.includes(n) ? n : 8;
  };
  const safe = (fn) => {
    try { return fn(); } catch { return undefined; }
  };
  const resolveBlock = (uid) => host.pullBlock?.(uid)?.string;

  // Words and refs a drawing region's auto caption would carry. frameName only for frame kinds.
  const drawingCaptions = (elements, ids, frameName) => ({
    auto: captionRefsFromElements(elements, ids, frameName ? { frameName } : undefined),
    refs: captionRefsFromElements(elements, ids, { words: false }),
  });

  // Ask-mode prompt anchor: the selection's viewport rect, or null (the prompt then centres at the top).
  const anchorRect = (app, bbox) => safe(() => (bbox ? native.viewportRectOf?.(app, bbox) : null)) ?? null;

  // The prompt is held like activeTool: cancelDrawingTool() and dispose() cancel it with no write. null = create nothing.
  async function askCaption({ initial, select, escape, rect, drawing }) {
    if (typeof openPrompt !== "function") return initial;
    let prompt;
    try {
      prompt = openPrompt({ doc, rect, initial, select, escape });
    } catch (error) {
      console.warn("[plexus] caption prompt failed", error);
      return null;
    }
    activePrompt = prompt;
    activePromptIsDrawing = drawing;
    try {
      const value = await prompt;
      return typeof value === "string" && !disposed ? value : null;
    } catch (error) {
      console.warn("[plexus] caption prompt failed", error);
      return null;
    } finally {
      if (activePrompt === prompt) activePrompt = null;
    }
  }

  // Caption by mode: auto writes the auto text, ask prompts with it selected, none keeps source refs only.
  async function chooseCaption({ auto, refs, rect, drawing }) {
    const mode = captionMode();
    if (mode === "none") return refs;
    if (mode === "ask") return askCaption({ initial: auto, select: true, escape: "empty", rect, drawing });
    return auto;
  }

  function labelOf(region, caption = region.caption) {
    try {
      const src = host.labelSource?.(region.drawingUid) ?? { string: "", pageTitle: null };
      return regionLabel({
        kind: region.kind,
        caption,
        drawingTitle: drawingTitleOf(src.string, src.pageTitle),
        imageAlt: isImageKind(region.kind) ? imageAltAt(src.string, region.i) : null,
        resolveBlock,
      });
    } catch {
      return "Region";
    }
  }

  // 1 + the largest leading integer among captions of regions on the same image.
  function nextPinNumber(regions) {
    let max = 0;
    for (const { region } of regions) {
      const m = /^\s*(\d+)\b/.exec(plainCaption(region.caption, resolveBlock));
      if (m) max = Math.max(max, Number(m[1]));
    }
    return max + 1;
  }

  const badTarget = (drawingUid, ids) => {
    if (isId(drawingUid) && ids.length && ids.every(isId)) return false;
    toaster.show("Could not identify this drawing", { kind: "error" });
    return true;
  };

  return {
    dispose() {
      disposed = true;
      activeTool?.cancel?.();
      activeTool = null;
      activePrompt?.cancel?.();
      activePrompt = null;
      stopSpotlight?.();
      stopSpotlight = null;
      legacyDialog?.dispose();
      legacyDialog = null;
      cleanupDialog?.dispose();
      cleanupDialog = null;
      closePolls.clear();
      for (const revoke of [...revokers]) revoke();
    },

    // The drawing image tool is bound to the mounted editor; cancel it when that editor goes away.
    cancelDrawingTool() {
      if (activeToolIsDrawing) activeTool?.cancel?.();
      if (activePromptIsDrawing) activePrompt?.cancel?.();
    },

    createAreaRegion: () => once("area", async () => {
      const editor = native.activeEditor(doc);
      if (!editor) {
        toaster.show("Open a drawing full-screen first", { kind: "error" });
        return null;
      }
      const { app, drawingUid } = editor;
      const ids = native.selectedElementIds(app);
      if (!ids.length) {
        toaster.show("Select some elements first", { kind: "error" });
        return null;
      }
      if (badTarget(drawingUid, ids)) return null;
      const elements = sceneElements(app);
      const detected = detectRegionKind({ elements, ids, selectedGroupIds: app.state?.selectedGroupIds });
      let region;
      let words;
      if (detected.kind === "cframe") {
        const { frame, children } = detected;
        words = drawingCaptions(elements, children.map((el) => el.id), frame.name);
        region = { kind: "cframe", drawingUid, frameId: frame.id };
      } else if (detected.kind === "group") {
        words = drawingCaptions(elements, detected.members.map((el) => el.id));
        region = { kind: "group", drawingUid, groupId: detected.groupId, pad: DEFAULT_PAD };
      } else {
        words = drawingCaptions(elements, ids);
        region = { kind: "area", drawingUid, ids, pad: DEFAULT_PAD };
      }
      const caption = await chooseCaption({ ...words, rect: anchorRect(app, commonBounds(elements.filter((e) => ids.includes(e.id)))), drawing: true });
      if (caption == null || disposed) return null;
      region.caption = caption;
      return finishCreate(region, await hotSvg(app, region));
    }),

    regionCaptionCandidate(regionUid) {
      const plan = relinkPlan(regionUid);
      return plan && plan.missing ? plan.caption : null;
    },

    relinkRegionCaption: (regionUid) => once(`relink:${regionUid}`, async () => {
      const plan = relinkPlan(regionUid);
      if (!plan) {
        toaster.show("No source blocks to link", { kind: "error" });
        return { changed: false, caption: null };
      }
      if (!plan.missing) {
        toaster.show("Caption already linked");
        return { changed: false, caption: plan.caption };
      }
      const next = serializeRegion({ ...plan.region, caption: plan.caption });
      const check = parseRegion(next);
      const head = (str) => str.replace(/\}\}[\s\S]*$/, "}}");
      if (!check?.supported || check.caption !== plan.caption || head(next) !== head(plan.block.string)) {
        console.warn("[plexus] relink round-trip mismatch", regionUid);
        toaster.show("Could not link caption", { kind: "error" });
        return { changed: false, caption: plan.region.caption };
      }
      try {
        await host.updateRegionString(plan.region.drawingUid, regionUid, next);
      } catch (error) {
        console.warn("[plexus] relink caption failed", error);
        toaster.show("Could not link caption, try again", { kind: "error" });
        return { changed: false, caption: plan.region.caption };
      }
      try {
        emit({ uid: regionUid, kind: "region" });
      } catch (error) {
        console.warn("[plexus] change emit failed", error);
      }
      toaster.show("Caption linked");
      return { changed: true, caption: plan.caption };
    }),

    // Rewrites only the caption tail (head kept byte for byte). Resolves true when the block changed.
    nameRegion: (regionUid, text) => once(`name:${regionUid}`, () => nameRegionOnce(regionUid, text)),

    captionCleanupDryRun: () => once("cleanup-dry-run", cleanupDryRunOnce),

    applyCaptionCleanup: (report) => once("cleanup-apply", () => applyCleanupOnce(report ?? cleanupReport)),

    undoCaptionCleanup: () => once("cleanup-undo", undoCleanupOnce),

    copyCropPng: (regionUid) => once(`copy-png:${regionUid}`, () => copyCropPngOnce(regionUid)),

    copyCropSvg: (regionUid) => once(`copy-svg:${regionUid}`, () => copyCropSvgOnce(regionUid)),

    downloadCrop: (regionUid) => once(`download:${regionUid}`, () => downloadCropOnce(regionUid)),

    insertCropImage: (regionUid, blockUid) => once(`insert:${regionUid}`, () => insertCropImageOnce(regionUid, blockUid)),

    copyAlias: (regionUid) => once(`alias:${regionUid}`, () => copyAliasOnce(regionUid)),

    // After a full-screen editor closes: refresh crops only when the drawing's hash moved off the one seen at mount.
    refreshAfterClose: (drawingUid, mountHash) => refreshAfterCloseOnce(drawingUid, mountHash),

    isFrameSelected() {
      const editor = native.activeEditor(doc);
      if (!editor) return false;
      const ids = native.selectedElementIds(editor.app);
      return ids.length > 0 && detectRegionKind({ elements: sceneElements(editor.app), ids, selectedGroupIds: editor.app.state?.selectedGroupIds }).kind === "cframe";
    },

    createFrameRegion: () => once("frame", async () => {
      const editor = native.activeEditor(doc);
      if (!editor) {
        toaster.show("Open a drawing full-screen first", { kind: "error" });
        return null;
      }
      const { app, drawingUid } = editor;
      const ids = native.selectedElementIds(app);
      const elements = sceneElements(app);
      const detected = detectRegionKind({ elements, ids, selectedGroupIds: app.state?.selectedGroupIds });
      if (detected.kind !== "cframe") {
        toaster.show("Select exactly one frame", { kind: "error" });
        return null;
      }
      if (badTarget(drawingUid, [detected.frame.id])) return null;
      const { frame, children } = detected;
      const words = drawingCaptions(elements, children.map((el) => el.id), frame.name);
      const caption = await chooseCaption({ ...words, rect: anchorRect(app, [detected.frame.x, detected.frame.y, detected.frame.x + detected.frame.width, detected.frame.y + detected.frame.height]), drawing: true });
      if (caption == null || disposed) return null;
      const region = { kind: "frame", drawingUid, frameId: frame.id, pad: DEFAULT_PAD, caption };
      return finishCreate(region, await hotSvg(app, region));
    }),

    createImageRegion: () => once("image", async () => {
      const editor = native.activeEditor(doc);
      if (!editor) {
        toaster.show("Open a drawing full-screen first", { kind: "error" });
        return null;
      }
      const { app, drawingUid } = editor;
      const ids = native.selectedElementIds(app);
      const element = ids.length === 1 ? sceneElements(app).find((el) => el.id === ids[0] && !el.isDeleted) : null;
      if (!element || element.type !== "image") {
        toaster.show("Select exactly one image", { kind: "error" });
        return null;
      }
      if (element.angle) {
        toaster.show("Rotated images are not supported", { kind: "error" });
        return null;
      }
      if (badTarget(drawingUid, [element.id])) return null;
      const tool = startTool({ app, element, doc });
      activeTool = tool;
      activeToolIsDrawing = true;
      let picked;
      try {
        picked = await tool;
      } finally {
        if (activeTool === tool) activeTool = null;
      }
      if (!picked || disposed) return null;
      if (picked.kind === "pin") return pinInDrawing({ app, element, drawingUid, x: picked.x, y: picked.y });
      const rect = anchorRect(app, elementBounds(element));
      let region;
      if (picked.kind === "rect" && !picked.altKey && picked.f[2] * picked.f[3] >= WHOLE_IMAGE_AREA) {
        // The whole drawing image picked as a whole: an area region of that element.
        const words = drawingCaptions(sceneElements(app), [element.id]);
        const caption = await chooseCaption({ ...words, rect, drawing: true });
        if (caption == null || disposed) return null;
        region = { kind: "area", drawingUid, ids: [element.id], pad: 0, caption };
      } else if (picked.kind === "rect") {
        const caption = await chooseCaption({ auto: "", refs: "", rect, drawing: true });
        if (caption == null || disposed) return null;
        region = { kind: "rect", drawingUid, el: element.id, f: displayedToNatural(element, picked.f), caption };
      } else if (picked.kind === "lasso") {
        const p = simplifyPoly(displayedToNatural(element, { p: picked.p }).p);
        if (!p || !polyBBox(p)) return null;
        const caption = await chooseCaption({ auto: "", refs: "", rect, drawing: true });
        if (caption == null || disposed) return null;
        region = { kind: "poly", drawingUid, el: element.id, p, caption };
      } else {
        return null;
      }
      return finishCreate(region, await hotSvg(app, region));
    }),

    hasCroppedImageSelected() {
      const editor = native.activeEditor(doc);
      return !!editor && !!croppedImage(editor.app);
    },

    hasFrames() {
      const editor = native.activeEditor(doc);
      return !!editor && orderFrames(sceneElements(editor.app)).length > 0;
    },

    regionFromCrop: () => once("crop", async () => {
      const editor = native.activeEditor(doc);
      if (!editor) {
        toaster.show("Open a drawing full-screen first", { kind: "error" });
        return null;
      }
      const { app, drawingUid } = editor;
      const element = croppedImage(app);
      if (!element) {
        toaster.show("Select exactly one cropped image", { kind: "error" });
        return null;
      }
      if (element.angle) {
        toaster.show("Rotated images are not supported", { kind: "error" });
        return null;
      }
      if (badTarget(drawingUid, [element.id])) return null;
      const caption = await chooseCaption({ auto: "", refs: "", rect: anchorRect(app, elementBounds(element)), drawing: true });
      if (caption == null || disposed) return null;
      const region = { kind: "rect", drawingUid, el: element.id, f: cropToFraction(element.crop), caption };
      return finishCreate(region, await hotSvg(app, region));
    }),

    insertEmbedFromClipboard: () => once("embed", async () => {
      const editor = native.activeEditor(doc);
      if (!editor) {
        toaster.show("Open a drawing full-screen first", { kind: "error" });
        return null;
      }
      const { app } = editor;
      const hint = "Copy a block ref first (right-click a bullet \u2192 Copy block ref)";
      let text = null;
      try {
        text = await native.readClipboardText({ clipboard });
      } catch (error) {
        console.warn("[plexus] clipboard read failed", error);
        toaster.show("Clipboard access was blocked. Allow paste in the browser, then try again", { kind: "error" });
        return null;
      }
      if (native.activeEditor(doc)?.app !== app) return null;
      const parsed = parseEmbedRef(text);
      if (!parsed) {
        toaster.show(hint, { kind: "error" });
        return null;
      }
      let content = null;
      try {
        content = await host.pullEmbedContent(parsed.ref);
      } catch (error) {
        console.warn("[plexus] embed pull failed", error);
      }
      if (!content || disposed) {
        if (!disposed) toaster.show("Could not find that block or page", { kind: "error" });
        return null;
      }
      const label = embedLabel(content.string || content.title || parsed.ref);
      const st = app.state || {};
      const c = viewportToScene({ x: (st.offsetLeft || 0) + (st.width || 0) / 2, y: (st.offsetTop || 0) + (st.height || 0) / 2, appState: st });
      const width = 360;
      const height = 200;
      const elements = makeEmbedAnchor({ ref: parsed.ref, label, x: c.x - width / 2, y: c.y - height / 2, width, height, idPrefix: "plexus-embed-" });
      if (!native.insertElements(app, elements, { select: true })) {
        toaster.show("Could not embed block", { kind: "error" });
        return null;
      }
      toaster.show(`Embedded ${label}`);
      return elements[0].id;
    }),

    presentDrawing: async ({ drawingUid } = {}) => {
      if (presentOwner) return null;
      const token = {};
      presentOwner = token;
      const release = () => { if (presentOwner === token) presentOwner = null; };
      try {
        return await presentOnce(drawingUid, release);
      } finally {
        release();
      }
    },

    createPlainImageRegion: (blockUid) => once("plain", async () => {
      const block = isId(blockUid) ? host.pullBlock(blockUid) : null;
      const refs = block ? parseImageRefs(block.string) : [];
      if (!refs.length) {
        toaster.show("No image in this block", { kind: "error" });
        return null;
      }
      // TODO: P2 targets only the first image; let the user pick when a block has several.
      const ref = refs[0];
      const img = findRenderedImage(blockUid);
      if (!img) {
        toaster.show("Show the image on screen first", { kind: "error" });
        return null;
      }
      const imageRect = contentRect(img, doc.defaultView);
      const tool = startTool({ doc, imageRect });
      activeTool = tool;
      activeToolIsDrawing = false;
      let picked;
      try {
        picked = await tool;
      } finally {
        if (activeTool === tool) activeTool = null;
      }
      if (!picked || disposed) return null;
      if (picked.kind === "pin") return pinInPlain({ blockUid, ref, imageRect, x: picked.x, y: picked.y });
      const anchor = { left: imageRect.left, top: imageRect.top, width: imageRect.width, height: imageRect.height };
      if (picked.kind === "rect" && !picked.altKey && picked.f[2] * picked.f[3] >= WHOLE_IMAGE_AREA) {
        // Nearly the whole image: no region, just the image block's ref. Alt while releasing forces a region.
        try {
          const write = () => clipboard.writeText(`((${blockUid}))`);
          await (native.withClipboard ? native.withClipboard(write) : write());
          toaster.show("Whole image: copied the image block ref. Hold Alt while releasing to make a region.");
        } catch (error) {
          console.warn("[plexus] clipboard failed", error);
          toaster.show("Clipboard access was blocked", { kind: "error" });
        }
        return null;
      }
      let region;
      if (picked.kind === "rect") {
        const caption = await chooseCaption({ auto: "", refs: "", rect: anchor, drawing: false });
        if (caption == null || disposed) return null;
        region = { kind: "imgrect", drawingUid: blockUid, i: ref.index, f: picked.f, caption };
      } else if (picked.kind === "lasso") {
        const p = simplifyPoly(picked.p);
        if (!p || !polyBBox(p)) return null;
        const caption = await chooseCaption({ auto: "", refs: "", rect: anchor, drawing: false });
        if (caption == null || disposed) return null;
        region = { kind: "imgpoly", drawingUid: blockUid, i: ref.index, p, caption };
      } else {
        return null;
      }
      return finishWith(region, plainCachePut(region, ref));
    }),

    // A pin: a small square region at a point, always prompting for its caption. Give { blockUid, index?, imageRect? } for
    // an image block, else { element?, drawingUid? } for a drawing image in the open editor. Point is { x, y } as
    // displayed-box fractions (or x and y directly).
    createPinRegion: (opts = {}) => once("pin", () => pinRegionOnce(opts)),

    // Cache only unless render is set; never touches Excalidraw when render is false.
    thumbnail: (uid, { maxWidth = 480, render = false } = {}) => thumbnailOnce(uid, { maxWidth, render }),

    async startMindMap() {
      const editor = native.activeEditor(doc);
      if (!editor || !mindmap) {
        toaster.show("Open a drawing full-screen first", { kind: "error" });
        return null;
      }
      if (mindmap.selectedNode(editor.app)) {
        toaster.show("Use Tab / Enter to grow this map");
        return null;
      }
      if (!editor.drawingUid) {
        toaster.show("Could not identify this drawing", { kind: "error" });
        return null;
      }
      return mindmap.startRoot({ app: editor.app, drawingUid: editor.drawingUid });
    },

    legacyDryRun: () => once("legacy-dry-run", legacyDryRunOnce),

    migrateLegacy: (uid) => migrateLegacyOnce(uid),

    // Exactly one live, non-bound-text element selected, and it is an embed anchor.
    canEditEmbed() {
      const overlay = getEmbedOverlay();
      if (!overlay || overlay.editState?.() !== "idle") return false;
      const editor = native.activeEditor(doc);
      return !!(editor && selectedAnchor(editor.app));
    },

    editEmbed: () => once("edit-embed", editEmbedOnce),

    openDrawing: (uid, { sidebar = false } = {}) => once(`opendrawing:${uid}`, () => openDrawingOnce(uid, { sidebar, reuseIcon: true })),

    mindMapFromOutline: (blockUid) => once(`mindmap:${blockUid}`, () => mindMapFromOutlineOnce(blockUid)),

    openRegion: (regionUid, opts) => once(`open:${regionUid}`, () => openRegionOnce(regionUid, opts)),

    async refreshCropsForOpenDrawing() {
      const editor = native.activeEditor(doc);
      if (!editor) {
        toaster.show("Open a drawing full-screen first", { kind: "error" });
        return 0;
      }
      const count = await refreshCrops(editor.drawingUid);
      toaster.show(`Refreshed ${count} crop${count === 1 ? "" : "s"}`);
      return count;
    },

    refreshCropsForDrawing: (uid) => refreshCrops(uid),

    hasSingleImageSelected() {
      const editor = native.activeEditor(doc);
      if (!editor) return false;
      const ids = native.selectedElementIds(editor.app);
      if (ids.length !== 1) return false;
      return sceneElements(editor.app).some((e) => e.id === ids[0] && e.type === "image");
    },

    async clearCache() {
      clearImageMemo();
      await cache.clear();
      toaster.show("Crop cache cleared");
    },
  };

  function plainCachePut(region, ref) {
    return async (uid) => {
      const target = { url: ref.url, hash: fnv1a(ref.url) };
      const rendered = await renderRegionCrop({ region, target, cold, doc, api, loadBitmap });
      if (rendered.error) return;
      const key = cropKey({ regionUid: uid, geometryKey: geometryKey(region), drawingHash: target.hash, tier: "png" });
      await cache.put(key, rendered.blob, { w: rendered.w, h: rendered.h });
    };
  }

  async function pinInDrawing({ app, element, drawingUid, x, y }) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const f = pinFraction({ x, y, width: element.width, height: element.height, pct: pinPct() });
    const same = (safe(() => host.regionsOf?.(drawingUid)) || []).filter(({ region }) => region?.supported && (region.kind === "rect" || region.kind === "poly") && region.el === element.id);
    const initial = settingsNow().numberPins ? String(nextPinNumber(same)) : "";
    const rect = safe(() => native.viewportRectOf?.(app, [element.x + f[0] * element.width, element.y + f[1] * element.height, element.x + (f[0] + f[2]) * element.width, element.y + (f[1] + f[3]) * element.height]));
    const caption = await askCaption({ initial, select: false, escape: "empty", rect, drawing: true });
    if (caption == null || disposed) return null;
    const region = { kind: "rect", drawingUid, el: element.id, f: displayedToNatural(element, f), caption };
    return finishCreate(region, await hotSvg(app, region));
  }

  async function pinInPlain({ blockUid, ref, imageRect, x, y }) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const f = pinFraction({ x, y, width: imageRect.width, height: imageRect.height, pct: pinPct() });
    const same = (safe(() => host.regionsOf?.(blockUid)) || []).filter(({ region }) => region?.supported && (region.kind === "imgrect" || region.kind === "imgpoly") && region.i === ref.index);
    const initial = settingsNow().numberPins ? String(nextPinNumber(same)) : "";
    const rect = { left: imageRect.left + f[0] * imageRect.width, top: imageRect.top + f[1] * imageRect.height, width: f[2] * imageRect.width, height: f[3] * imageRect.height };
    const caption = await askCaption({ initial, select: false, escape: "empty", rect, drawing: false });
    if (caption == null || disposed) return null;
    const region = { kind: "imgrect", drawingUid: blockUid, i: ref.index, f, caption };
    return finishWith(region, plainCachePut(region, ref));
  }

  async function pinRegionOnce(opts) {
    const point = opts?.point ?? opts ?? {};
    const x = Number(point.x);
    const y = Number(point.y);
    if (opts?.blockUid) {
      const blockUid = opts.blockUid;
      const block = isId(blockUid) ? host.pullBlock(blockUid) : null;
      const refs = block ? parseImageRefs(block.string) : [];
      const ref = refs.find((r) => r.index === (opts.index ?? refs[0]?.index));
      if (!ref) {
        toaster.show("No image in this block", { kind: "error" });
        return null;
      }
      let imageRect = opts.imageRect;
      if (!imageRect) {
        const img = findRenderedImage(blockUid, refs.indexOf(ref));
        if (!img) {
          toaster.show("Show the image on screen first", { kind: "error" });
          return null;
        }
        imageRect = contentRect(img, doc.defaultView);
      }
      return pinInPlain({ blockUid, ref, imageRect, x, y });
    }
    const editor = native.activeEditor(doc);
    if (!editor) {
      toaster.show("Open a drawing full-screen first", { kind: "error" });
      return null;
    }
    const { app } = editor;
    const ids = native.selectedElementIds(app);
    const element = opts?.element ?? (ids.length === 1 ? sceneElements(app).find((el) => el.id === ids[0] && !el.isDeleted) : null);
    if (!element || element.type !== "image") {
      toaster.show("Select exactly one image", { kind: "error" });
      return null;
    }
    if (element.angle) {
      toaster.show("Rotated images are not supported", { kind: "error" });
      return null;
    }
    const drawingUid = opts?.drawingUid ?? editor.drawingUid;
    if (badTarget(drawingUid, [element.id])) return null;
    return pinInDrawing({ app, element, drawingUid, x, y });
  }

  function emitChange(uid) {
    try {
      emit({ uid, kind: "region" });
    } catch (error) {
      console.warn("[plexus] change emit failed", error);
    }
  }

  async function nameRegionOnce(regionUid, text) {
    const block = isId(regionUid) ? host.pullBlock(regionUid) : null;
    const region = block ? parseRegion(block.string) : null;
    if (!region?.supported) {
      toaster.show("Region cannot be named", { kind: "error" });
      return false;
    }
    const tail = String(text ?? "").replace(/\s+/g, " ").trim();
    if (tail === region.caption) return false;
    const next = headPreservingString(block.string, tail);
    if (next == null) {
      console.warn("[plexus] name region round-trip mismatch", regionUid);
      toaster.show("Could not name region", { kind: "error" });
      return false;
    }
    try {
      await host.updateRegionString(region.drawingUid, regionUid, next);
    } catch (error) {
      console.warn("[plexus] name region failed", error);
      toaster.show("Could not name region, try again", { kind: "error" });
      return false;
    }
    emitChange(regionUid);
    try {
      await refreshRegion?.(regionUid, { purge: false });
    } catch (error) {
      console.warn("[plexus] refresh after naming failed", error);
    }
    return true;
  }

  // Report of the placeholder captions that could be cleared. Reads only.
  function cleanupScan() {
    let rows;
    try {
      rows = host.allRegionBlocks?.() ?? [];
    } catch (error) {
      console.warn("[plexus] region scan failed", error);
      toaster.show("Could not scan for regions", { kind: "error" });
      return null;
    }
    const candidates = [];
    const skipped = [];
    let scanned = 0;
    const drawings = new Map();
    const elementsOf = (uid) => {
      if (!drawings.has(uid)) drawings.set(uid, safe(() => host.drawing(uid)?.elements) ?? null);
      return drawings.get(uid);
    };
    for (const row of rows) {
      const region = parseRegion(row.string);
      if (!region?.supported) continue;
      scanned += 1;
      if (!isPlaceholderCaption(region.caption, region.kind)) continue;
      const caption = region.caption.trim();
      const info = { uid: row.uid, kind: region.kind, drawingUid: region.drawingUid, caption };
      const skip = (reason) => skipped.push({ ...info, reason });
      if (RELINK_KINDS.has(region.kind)) {
        const elements = elementsOf(region.drawingUid);
        if (!Array.isArray(elements)) { skip("drawing not readable"); continue; }
        const isFrameKind = region.kind === "frame" || region.kind === "cframe";
        const frameEl = isFrameKind ? elements.find((e) => e && e.id === region.frameId && !e.isDeleted && isFrameEl(e)) : null;
        if (isFrameKind && !frameEl) { skip("frame missing"); continue; }
        const name = String(frameEl?.name ?? "").trim();
        if (isFrameKind && name === caption) { skip(`frame is named "${name}"`); continue; }
        if (isFrameKind && name && caption === "Frame") { skip("frame has a name"); continue; }
        const auto = captionRefsFromElements(elements, captionIds(region, elements));
        if (auto === caption) { skip("text in the drawing reads the same"); continue; }
      }
      const after = headPreservingString(row.string, "");
      if (after == null) { skip("could not rewrite safely"); continue; }
      candidates.push({ ...info, before: row.string, after });
    }
    return { graph: safe(() => host.graphName?.()) ?? null, scanned, candidates, skipped };
  }

  async function cleanupDryRunOnce() {
    const report = cleanupScan();
    if (!report) return null;
    cleanupReport = report;
    if (!cleanupDialog) {
      cleanupDialog = createCleanup({
        doc,
        onApply: async (r) => {
          if (busy.has("cleanup-apply")) return;
          const n = r?.candidates?.length ?? 0;
          let ok = false;
          try { ok = confirm(`Clear ${n} placeholder caption${n === 1 ? "" : "s"} in graph "${safe(() => host.graphName?.()) ?? ""}"? "Plexus: Undo caption cleanup" restores them.`) === true; } catch { ok = false; }
          if (!ok) return;
          const result = await once("cleanup-apply", () => applyCleanupOnce(r));
          if (result) cleanupDialog?.close();
        },
        onCopy: async (r) => {
          const write = () => clipboard.writeText(JSON.stringify(r, null, 2));
          try {
            await (native.withClipboard ? native.withClipboard(write) : write());
            toaster.show("Report copied");
          } catch (error) {
            console.warn("[plexus] clipboard failed", error);
            toaster.show("Clipboard access was blocked", { kind: "error" });
          }
        },
      });
    }
    cleanupDialog.show({ report });
    return report;
  }

  async function applyCleanupOnce(report) {
    const list = report?.candidates;
    if (!Array.isArray(list)) {
      toaster.show("Run the cleanup dry run first", { kind: "error" });
      return null;
    }
    const changed = [];
    const skipped = [];
    const failed = [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (disposed) break;
      const block = safe(() => host.pullBlock(c.uid));
      if (!block || block.string !== c.before) {
        skipped.push({ uid: c.uid, reason: "changed since the dry run" });
        continue;
      }
      try {
        await host.updateRegionString(c.drawingUid, c.uid, c.after);
      } catch (error) {
        console.warn("[plexus] caption cleanup write failed", c.uid, error);
        failed.push({ uid: c.uid, error: String(error?.message ?? error) });
        for (const rest of list.slice(i + 1)) skipped.push({ uid: rest.uid, reason: "not attempted" });
        break;
      }
      changed.push({ uid: c.uid, before: c.before, after: c.after });
      emitChange(c.uid);
      try {
        await refreshRegion?.(c.uid, { purge: false });
      } catch (error) {
        console.warn("[plexus] refresh after cleanup failed", error);
      }
    }
    if (changed.length) undoSlot = { changes: changed };
    const tail = `${skipped.length ? `, ${skipped.length} skipped` : ""}${failed.length ? `, ${failed.length} failed` : ""}`;
    toaster.show(`Cleared ${changed.length} placeholder caption${changed.length === 1 ? "" : "s"}${tail}`, failed.length ? { kind: "error" } : undefined);
    return { changed, skipped, failed };
  }

  async function undoCleanupOnce() {
    if (!undoSlot) {
      toaster.show("Nothing to undo");
      return null;
    }
    const { changes } = undoSlot;
    const restored = [];
    const skipped = [];
    const failed = [];
    for (let i = changes.length - 1; i >= 0; i--) {
      const c = changes[i];
      if (disposed) { undoSlot = { changes: changes.slice(0, i + 1) }; break; }
      const block = safe(() => host.pullBlock(c.uid));
      const region = block ? parseRegion(block.string) : null;
      if (!block || block.string !== c.after || !region?.supported) {
        skipped.push({ uid: c.uid, reason: "changed since the cleanup" });
        continue;
      }
      try {
        await host.updateRegionString(region.drawingUid, c.uid, c.before);
      } catch (error) {
        console.warn("[plexus] caption cleanup undo failed", c.uid, error);
        failed.push({ uid: c.uid, error: String(error?.message ?? error) });
        undoSlot = { changes: changes.slice(0, i + 1) };
        break;
      }
      restored.push(c.uid);
      emitChange(c.uid);
      try {
        await refreshRegion?.(c.uid, { purge: false });
      } catch (error) {
        console.warn("[plexus] refresh after undo failed", error);
      }
    }
    if (!failed.length && !disposed) undoSlot = null;
    toaster.show(`Restored ${restored.length} caption${restored.length === 1 ? "" : "s"}${skipped.length ? `, ${skipped.length} skipped` : ""}${failed.length ? `, ${failed.length} failed` : ""}`, failed.length ? { kind: "error" } : undefined);
    return { restored, skipped, failed };
  }

  // Everything synchronous a crop export needs: the region, where its pixels live, and the cache keys (regionref's keysFor).
  function cropPrep(regionUid) {
    const block = isId(regionUid) ? host.pullBlock(regionUid) : null;
    const region = block ? parseRegion(block.string) : null;
    if (!region?.supported) {
      toaster.show("Region cannot be copied", { kind: "error" });
      return null;
    }
    const target = resolveRegionTarget(host, region);
    if (target.error) {
      toaster.show(target.error, { kind: "error" });
      return null;
    }
    const gk = geometryKey(region);
    return {
      uid: regionUid,
      region,
      target,
      keys: {
        png: cropKey({ regionUid, geometryKey: gk, drawingHash: target.hash, tier: "png" }),
        svg: target.url ? null : cropKey({ regionUid, geometryKey: gk, drawingHash: target.hash, tier: "svg" }),
      },
    };
  }

  // Starts reading a cache entry at once: the LRU may revoke its URL. Never rejects.
  function readEntry(entry) {
    if (!entry?.url) return null;
    let p;
    try { p = Promise.resolve(fetchBlob(entry.url)); } catch { return null; }
    const safeP = p.catch(() => null);
    return safeP;
  }

  function hasExternalHref(svg) {
    const s = String(svg).replace(/<a\b[^>]*>/gi, "<a>");
    for (const m of s.matchAll(SVG_HREF_RE)) if (!/^(data:|#)/i.test(m[1].trim())) return true;
    return false;
  }

  async function rasterizeSvg(svg) {
    if (rasterize) return rasterize(svg, { scale: 2 });
    const { w, h } = svgSize(svg);
    if (!(w > 0) || !(h > 0)) throw new Error("[plexus] svg has no size");
    const url = urls.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    try {
      const View = doc.defaultView;
      const img = new (View?.Image ?? globalThis.Image)();
      img.src = url;
      await img.decode();
      const canvas = doc.createElement("canvas");
      canvas.width = w * 2;
      canvas.height = h * 2;
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      return await new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("[plexus] toBlob failed"))), "image/png"));
    } finally {
      urls.revokeObjectURL(url);
    }
  }

  function asPng(blob) {
    return blob.type === "image/png" ? blob : new Blob([blob], { type: "image/png" });
  }

  // PNG bytes for a region, best source first. The producer starts synchronously (its memory reads begin before the
  // first await) so callers can hand `promise` straight to a ClipboardItem inside the user gesture.
  function startPng(regionUid) {
    const prep = cropPrep(regionUid);
    if (!prep) return null;
    const { region, target, keys } = prep;
    const memSvg = keys.svg ? readEntry(cache.peek?.(keys.svg)) : null;
    const memPng = readEntry(cache.peek?.(keys.png));
    const job = { region, lowRes: false, promise: null };
    const fromSvg = async (blobP) => {
      try {
        const blob = await blobP;
        if (!blob) return null;
        const text = await blob.text();
        if (hasExternalHref(text)) return null;
        return asPng(await rasterizeSvg(text));
      } catch {
        return null;
      }
    };
    job.promise = (async () => {
      let png = await fromSvg(memSvg);
      if (png) return png;
      const pngBlob = await (memPng || readEntry(await cache.get(keys.png)));
      if (pngBlob) return asPng(pngBlob);
      if (keys.svg) {
        png = await fromSvg(readEntry(await cache.get(keys.svg)));
        if (png) return png;
      }
      const rendered = await renderRegionCrop({ region, target, cold, doc, api, loadBitmap });
      if (rendered.error) throw new Error(`[plexus] ${rendered.error}`);
      if (!isImageKind(region.kind)) job.lowRes = true;
      return asPng(rendered.blob);
    })();
    job.promise.catch(noop);
    return job;
  }

  function clipboardWritable() {
    if (typeof ClipboardItemCtor !== "function" || typeof clipboard?.write !== "function") {
      toaster.show("Copying images is not supported here", { kind: "error" });
      return false;
    }
    return true;
  }

  async function copyCropPngOnce(regionUid) {
    if (native.clipboardBusy?.()) {
      toaster.show("Busy capturing a crop, try again", { kind: "error" });
      return false;
    }
    if (!clipboardWritable()) return false;
    const job = startPng(regionUid);
    if (!job) return false;
    try {
      await clipboard.write([new ClipboardItemCtor({ "image/png": job.promise })]);
    } catch (error) {
      console.warn("[plexus] copy crop failed", error);
      toaster.show("Could not copy the crop", { kind: "error" });
      return false;
    }
    toaster.show(job.lowRes ? "Copied at 1×; open the drawing for a sharper copy" : "Crop copied as PNG");
    return true;
  }

  async function copyCropSvgOnce(regionUid) {
    if (native.clipboardBusy?.()) {
      toaster.show("Busy capturing a crop, try again", { kind: "error" });
      return false;
    }
    if (!clipboardWritable()) return false;
    const prep = cropPrep(regionUid);
    if (!prep) return false;
    if (!prep.keys.svg) {
      toaster.show("SVG copy is for drawing regions", { kind: "error" });
      return false;
    }
    const mem = readEntry(cache.peek?.(prep.keys.svg));
    const text = (async () => {
      let blob = await mem;
      if (!blob) blob = await readEntry(await cache.get(prep.keys.svg));
      if (!blob) throw Object.assign(new Error("[plexus] no svg"), { noSvg: true });
      return blob.text();
    })();
    text.catch(noop);
    const data = { "text/plain": text.then((t) => new Blob([t], { type: "text/plain" })) };
    if (ClipboardItemCtor.supports?.("image/svg+xml")) data["image/svg+xml"] = text.then((t) => new Blob([t], { type: "image/svg+xml" }));
    for (const v of Object.values(data)) v.catch(noop);
    try {
      await clipboard.write([new ClipboardItemCtor(data)]);
    } catch (error) {
      const missing = await text.then(() => false, (e) => !!e?.noSvg);
      if (missing) {
        toaster.show("Open the drawing to copy as SVG", { kind: "error" });
        return false;
      }
      console.warn("[plexus] copy svg failed", error);
      toaster.show("Could not copy the crop", { kind: "error" });
      return false;
    }
    toaster.show("Crop copied as SVG");
    return true;
  }

  function stripBrackets(text) {
    return String(text).replace(/[\[\]()]/g, "").replace(/\s+/g, " ").trim();
  }

  function fileNameOf(label) {
    return `${String(label).replace(/[^\w .-]/g, "").trim().slice(0, 60).trim() || "plexus-crop"}.png`;
  }

  async function downloadCropOnce(regionUid) {
    const job = startPng(regionUid);
    if (!job) return false;
    let blob;
    try {
      blob = await job.promise;
    } catch (error) {
      console.warn("[plexus] download crop failed", error);
      toaster.show("Could not render the crop", { kind: "error" });
      return false;
    }
    if (disposed) return false;
    const url = urls.createObjectURL(blob);
    try {
      const a = doc.createElement("a");
      a.href = url;
      a.download = fileNameOf(labelOf(job.region));
      if (a.style) a.style.display = "none";
      doc.body?.append?.(a);
      a.click();
      a.remove?.();
    } catch (error) {
      console.warn("[plexus] download crop failed", error);
      urls.revokeObjectURL(url);
      toaster.show("Could not download the crop", { kind: "error" });
      return false;
    }
    const revoke = () => {
      if (!revokers.delete(revoke)) return;
      clearTimeout(timer);
      urls.revokeObjectURL(url);
    };
    const timer = setTimeout(revoke, revokeDelayMs);
    timer.unref?.();
    revokers.add(revoke);
    toaster.show(job.lowRes ? "Downloaded at 1×; open the drawing for a sharper copy" : "Crop downloaded");
    return true;
  }

  async function insertCropImageOnce(regionUid, blockUid) {
    if (host.isEncrypted?.()) {
      toaster.show("Insert crop is not available on encrypted graphs yet", { kind: "error" });
      return null;
    }
    const target = isId(blockUid) ? host.pullBlock(blockUid) : null;
    if (!target) {
      toaster.show("Could not find the block to insert after", { kind: "error" });
      return null;
    }
    let at;
    try {
      at = api.data.pull("[:block/order {:block/_children [:block/uid :block/string]}]", [":block/uid", blockUid]);
    } catch (error) {
      console.warn("[plexus] parent pull failed", error);
    }
    const parent = [at?.[":block/_children"]].flat()[0];
    const parentUid = parent?.[":block/uid"];
    if (!parentUid) {
      toaster.show("Could not find the block to insert after", { kind: "error" });
      return null;
    }
    if (isContainerString(target.string) || isContainerString(parent[":block/string"])) {
      toaster.show("Pick a block outside the regions container", { kind: "error" });
      return null;
    }
    const job = startPng(regionUid);
    if (!job) return null;
    let markdown;
    try {
      const png = await job.promise;
      const label = stripBrackets(labelOf(job.region)) || "Region";
      const file = new File([png], fileNameOf(labelOf(job.region)), { type: "image/png" });
      const res = await (upload ? upload(file) : api.file.upload({ file }));
      const text = typeof res === "string" ? res : res?.url ?? "";
      const md = /^!\[[^\]]*\]\(([^)]+)\)$/.exec(text.trim());
      const url = md ? md[1] : text.trim();
      if (!url) throw new Error("[plexus] upload returned nothing");
      markdown = `![${label}](${url})`;
    } catch (error) {
      console.warn("[plexus] insert crop upload failed", error);
      toaster.show("Could not upload the crop", { kind: "error" });
      return null;
    }
    if (disposed) return null;
    try {
      const uid = api.util.generateUID();
      await api.data.block.create({
        location: { "parent-uid": parentUid, order: (at[":block/order"] ?? 0) + 1 },
        block: { uid, string: markdown },
      });
      toaster.show("Crop inserted as an image block");
      return uid;
    } catch (error) {
      console.warn("[plexus] insert crop failed", error);
      toaster.show("Could not insert the crop", { kind: "error" });
      return null;
    }
  }

  async function copyAliasOnce(regionUid) {
    const block = isId(regionUid) ? host.pullBlock(regionUid) : null;
    const region = block ? parseRegion(block.string) : null;
    if (!region?.supported) {
      toaster.show("Region cannot be copied", { kind: "error" });
      return false;
    }
    const label = stripBrackets(labelOf(region)) || "Region";
    try {
      const write = () => clipboard.writeText(`[${label}](((${regionUid})))`);
      await (native.withClipboard ? native.withClipboard(write) : write());
    } catch (error) {
      console.warn("[plexus] clipboard failed", error);
      toaster.show("Clipboard access was blocked", { kind: "error" });
      return false;
    }
    toaster.show("Alias copied");
    return true;
  }

  async function refreshAfterCloseOnce(drawingUid, mountHash) {
    if (!isId(drawingUid) || disposed) return 0;
    const token = {};
    closePolls.set(drawingUid, token);
    const live = () => !disposed && closePolls.get(drawingUid) === token;
    const end = Date.now() + closeWindowMs;
    let last = mountHash ?? "";
    let count = 0;
    try {
      for (;;) {
        if (!live()) return count;
        if (native.activeEditor(doc)?.drawingUid === drawingUid) return count;
        const hash = safe(() => host.drawing(drawingUid)?.hash) ?? "";
        if (hash !== last) {
          last = hash;
          for (const { uid } of safe(() => host.regionsOf(drawingUid)) || []) {
            if (!live()) break;
            try {
              await refreshRegion?.(uid, { purge: false });
              count += 1;
            } catch (error) {
              console.warn("[plexus] refresh after close failed", uid, error);
            }
          }
        }
        if (Date.now() >= end) return count;
        await sleep(closePollMs);
      }
    } finally {
      if (closePolls.get(drawingUid) === token) closePolls.delete(drawingUid);
    }
  }

  async function refreshCrops(uid) {
    const editor = native.activeEditor(doc);
    const hot = !!editor && editor.drawingUid === uid;
    let count = 0;
    for (const { uid: regionUid, region } of host.regionsOf(uid)) {
      if (disposed) break;
      if (hot && native.activeEditor(doc)?.app !== editor.app) break;
      if (!region?.supported) continue;
      try {
        if (hot) {
          if (isImageKind(region.kind)) continue;
          const svg = await hotSvg(editor.app, region);
          if (!svg) continue;
          await putSvg(regionUid, region, svg);
          await refreshRegion?.(regionUid, { purge: false });
        } else {
          await refreshRegion?.(regionUid);
        }
        count += 1;
      } catch (error) {
        console.warn("[plexus] refresh failed", regionUid, error);
      }
    }
    return count;
  }

  async function presentOnce(requestedUid, release) {
    const editor = native.activeEditor(doc);
    const uid = requestedUid || editor?.drawingUid;
    if (!isId(uid) || !presenter) {
      toaster.show("Could not identify this drawing", { kind: "error" });
      return null;
    }
    const mounted = editor && editor.drawingUid === uid ? editor : null;
    const drawing = host.drawing(uid);
    const frames = orderFrames(mounted ? sceneElements(mounted.app) : drawing?.elements ?? []);
    if (!frames.length) {
      toaster.show("No frames in this drawing", { kind: "error" });
      return null;
    }
    if (!drawing) {
      toaster.show("Drawing not found", { kind: "error" });
      return null;
    }
    // Mounted slides are captured from the live scene, so key them on the live scene, not the last saved hash.
    const slideHash = mounted ? fnv1a(JSON.stringify(sceneElements(mounted.app))) : drawing.hash;
    const slides = frames.map((frame) => {
      const region = { kind: "cframe", drawingUid: uid, frameId: frame.id, caption: frame.name || "" };
      const gk = geometryKey(region);
      return {
        frame,
        region,
        name: frame.name || `Frame ${frames.indexOf(frame) + 1}`,
        url: null,
        svgKey: cropKey({ regionUid: `slide:${uid}:${frame.id}`, geometryKey: gk, drawingHash: slideHash, tier: "svg" }),
        pngKey: cropKey({ regionUid: `slide:${uid}:${frame.id}`, geometryKey: gk, drawingHash: slideHash, tier: "png" }),
      };
    });
    // Whatever is already cached opens immediately; the rest fills in behind it.
    for (const slide of slides) {
      const entry = (mounted ? cache.peek?.(slide.svgKey) : null) || cache.peek?.(slide.pngKey) || cache.peek?.(slide.svgKey);
      slide.url = entry?.url ?? null;
    }
    const handle = presenter.open({ slides: slides.map(({ name, url }) => ({ name, url })), index: 0, onClose: release });
    const missing = slides.map((s, i) => [s, i]).filter(([s]) => !s.url);
    if (!missing.length) return uid;
    const fail = (i) => { if (handle.isOpen()) handle.setSlide(i, { error: true }); };
    const fill = (i, entry) => { if (entry?.url && handle.isOpen()) handle.setSlide(i, { url: entry.url }); };
    try {
      if (mounted) {
        for (const [slide, i] of missing) {
          if (disposed || !handle.isOpen()) break;
          let svg = await captureSafe(mounted.app, [slide.frame.id]);
          if (!svg) continue;
          svg = normalizeSvgSize(svg);
          await cache.put(slide.svgKey, new Blob([svg], { type: "image/svg+xml" }), svgSize(svg));
          fill(i, cache.peek?.(slide.svgKey) || (await cache.get(slide.svgKey)));
        }
      } else {
        const hasImage = drawing.elements.some((el) => !el.isDeleted && (el.type === "image" || el.fileId));
        const rendered = await cold.renderDrawing(uid, { settleMs: hasImage ? IMAGE_SETTLE_MS : PLAIN_SETTLE_MS });
        if (!rendered || disposed || !handle.isOpen()) {
          if (!rendered && !disposed && handle.isOpen()) {
            for (const [, i] of missing) fail(i);
            toaster.show("Could not render this drawing", { kind: "error" });
          }
          return uid;
        }
        for (const [slide, i] of missing) {
          if (disposed || !handle.isOpen()) break;
          const box = regionSceneBBox(slide.region, drawing.elements, drawing.appState);
          if (box.error) { fail(i); continue; }
          const crop = viewPngCropRect({
            elements: drawing.elements,
            appState: drawing.appState,
            bbox: box.bbox,
            naturalWidth: rendered.naturalWidth,
            naturalHeight: rendered.naturalHeight,
          });
          if (crop.error) { fail(i); continue; }
          const blob = await cropCanvasToBlob(rendered.canvas, crop, { doc });
          await cache.put(slide.pngKey, blob, { w: crop.sw, h: crop.sh, persist: rendered.settled !== false });
          fill(i, cache.peek?.(slide.pngKey) || (await cache.get(slide.pngKey)));
        }
      }
    } catch (error) {
      console.warn("[plexus] present fill failed", error);
      for (const [slide, i] of missing) if (!cache.peek?.(slide.svgKey) && !cache.peek?.(slide.pngKey)) fail(i);
    }
    return uid;
  }

  function findRenderedImage(blockUid, index = 0) {
    for (const el of doc.querySelectorAll('[id^="block-input-"]')) {
      if (!el.id.endsWith(blockUid) || el.closest?.(".plexus-offscreen")) continue;
      const img = el.querySelectorAll("img.rm-inline-img:not(.rm-inline-img--excalidraw)")[index];
      if (img) return img;
    }
    return null;
  }

  function thumbnailOnce(uid, { maxWidth, render }) {
    const id = `${uid}|${maxWidth}|${render ? 1 : 0}`;
    const existing = thumbPending.get(id);
    if (existing) return existing;
    const p = thumbnailRun(uid, { maxWidth, render }).catch((error) => {
      console.warn("[plexus] thumbnail failed", uid, error);
      return null;
    });
    thumbPending.set(id, p);
    p.then(() => thumbPending.delete(id));
    return p;
  }

  async function thumbnailRun(uid, { maxWidth, render }) {
    const block = isId(uid) ? host.pullBlock(uid) : null;
    if (!block) return null;
    const region = parseRegion(block.string);
    let hash;
    let target = null;
    let drawing = null;
    const fallbacks = [];
    if (region) {
      if (!region.supported) return null;
      target = resolveRegionTarget(host, region);
      if (target.error) return null;
      const gk = geometryKey(region);
      hash = fnv1a(`${gk}|${target.hash}`);
      fallbacks.push(cropKey({ regionUid: uid, geometryKey: gk, drawingHash: target.hash, tier: "png" }));
      if (!target.url) fallbacks.push(cropKey({ regionUid: uid, geometryKey: gk, drawingHash: target.hash, tier: "svg" }));
    } else if (DRAWING_STRING_RE.test(block.string)) {
      drawing = host.drawing(uid);
      if (!drawing) return null;
      hash = drawing.hash;
    } else {
      return null;
    }
    const key = cropKey({ regionUid: uid, geometryKey: "thumb", drawingHash: `${hash}|${maxWidth}`, tier: "png" });
    const lookup = async (k) => {
      const entry = cache.peek?.(k) || (await cache.get(k));
      return entry ? fetchBlob(entry.url) : null;
    };
    const cached = await lookup(key);
    if (cached) return cached;
    if (!render) {
      for (const k of fallbacks) {
        const blob = await lookup(k);
        if (blob) return blob;
      }
      return null;
    }
    let blob;
    let dims;
    let settled = true;
    if (region) {
      const rendered = await renderRegionCrop({ region, target, cold, doc, api, loadBitmap });
      if (rendered.error || disposed) return null;
      settled = rendered.settled;
      if (rendered.w <= maxWidth) {
        blob = rendered.blob;
        dims = { w: rendered.w, h: rendered.h };
      } else {
        const bitmap = await createBitmap(rendered.blob);
        blob = await downscaleTo(bitmap, bitmap.width, bitmap.height, maxWidth, doc);
        dims = thumbnailSize({ width: rendered.w, height: rendered.h, maxWidth });
      }
    } else {
      const hasImage = drawing.elements.some((el) => !el.isDeleted && (el.type === "image" || el.fileId));
      const rendered = await cold.renderDrawing(uid, { settleMs: hasImage ? IMAGE_SETTLE_MS : PLAIN_SETTLE_MS });
      if (!rendered || disposed) return null;
      settled = rendered.settled !== false;
      blob = await downscaleTo(rendered.canvas, rendered.naturalWidth, rendered.naturalHeight, maxWidth, doc);
      const size = thumbnailSize({ width: rendered.naturalWidth, height: rendered.naturalHeight, maxWidth });
      dims = { w: size.width, h: size.height };
    }
    await cache.put(key, blob, { ...dims, persist: settled !== false });
    return blob;
  }

  async function mindMapFromOutlineOnce(blockUid) {
    if (!mindmap || !isId(blockUid)) {
      toaster.show("Click into a block first", { kind: "error" });
      return null;
    }
    const info = mindmap.outlineInfo(blockUid);
    if (!info) {
      toaster.show("Block not found", { kind: "error" });
      return null;
    }
    if (isExcludedString(info.string)) {
      toaster.show("Drawings cannot be a mind map root", { kind: "error" });
      return null;
    }
    if (info.visible >= mindmap.NODE_CAP) {
      toaster.show(`Collapse some branches first (${info.total} blocks)`, { kind: "error" });
      return null;
    }
    let drawingUid;
    try {
      const at = api.data.pull("[:block/order {:block/_children [:block/uid]}]", [":block/uid", blockUid]);
      const parent = at?.[":block/_children"]?.[0]?.[":block/uid"];
      if (!parent) throw new Error("no parent");
      drawingUid = api.util.generateUID();
      await api.data.block.create({
        location: { "parent-uid": parent, order: (at[":block/order"] ?? 0) + 1 },
        block: { uid: drawingUid, string: "{{[[excalidraw]]}}" },
      });
    } catch (error) {
      console.warn("[plexus] mind map drawing create failed", error);
      toaster.show("Could not create the drawing", { kind: "error" });
      return null;
    }
    const opened = await openDrawingOnce(drawingUid);
    if (!opened || disposed) return null;
    const ok = await mindmap.showOutline({ app: opened.app, rootUid: blockUid });
    if (!ok && !disposed) toaster.show("Could not build the mind map", { kind: "error" });
    return ok ? drawingUid : null;
  }


  function selectedAnchor(app) {
    const all = sceneElements(app);
    const ids = native.selectedElementIds(app);
    const picked = ids.map((id) => all.find((e) => e.id === id)).filter((e) => e && !(e.type === "text" && e.containerId));
    if (picked.length !== 1) return null;
    return embedAnchors(picked)[0] ?? null;
  }

  async function editEmbedOnce() {
    const overlay = getEmbedOverlay();
    const editor = native.activeEditor(doc);
    if (!overlay || !editor) {
      toaster.show("Open a drawing full-screen first", { kind: "error" });
      return false;
    }
    if (overlay.editState?.() !== "idle") return false;
    const anchor = selectedAnchor(editor.app);
    if (!anchor) {
      toaster.show("Select one embedded block first", { kind: "error" });
      return false;
    }
    const ref = parseEmbedRef(anchor.customData.plexus.embed);
    if (!ref || ref.kind === "page") {
      toaster.show("Page embeds are read-only for now");
      return false;
    }
    const block = host.pullBlock(ref.uid);
    let ancestor = false;
    if (block && editor.drawingUid) {
      try {
        const raw = api.data.pull("[{:block/parents [:block/uid]}]", [":block/uid", editor.drawingUid]);
        ancestor = (raw?.[":block/parents"] || []).some((p) => p[":block/uid"] === ref.uid);
      } catch (error) {
        console.warn("[plexus] ancestor check failed", error);
      }
    }
    if (!block || ref.uid === editor.drawingUid || ancestor || NOT_EDITABLE_RE.test(block.string)) {
      toaster.show("This block cannot be edited on the canvas", { kind: "error" });
      return false;
    }
    return overlay.edit(anchor.id);
  }

  async function legacyDryRunOnce() {
    let rows;
    try {
      rows = rowsFromQuery(api.data.q(LEGACY_QUERY));
    } catch (error) {
      console.warn("[plexus] legacy query failed", error);
      toaster.show("Could not scan for legacy drawings", { kind: "error" });
      return null;
    }
    const summary = legacySummary(rows);
    const report = legacyReport(rows);
    if (!legacyDialog) {
      legacyDialog = createDialog({
        doc,
        onMigrate: (uid) => migrateLegacyOnce(uid),
        onCopy: async ({ summary: sum, rows: list }) => {
          const write = () => clipboard.writeText(JSON.stringify({ summary: sum, rows: list }, null, 2));
          try {
            await (native.withClipboard ? native.withClipboard(write) : write());
            toaster.show("Report copied");
          } catch (error) {
            console.warn("[plexus] clipboard failed", error);
            toaster.show("Clipboard access was blocked", { kind: "error" });
          }
        },
      });
    }
    legacyDialog.show({ summary, rows: report });
    return { summary, rows: report };
  }

  function legacySnapshot(uid) {
    const b = host.pullBlock(uid);
    return b ? { string: b.string, editTime: b.editTime } : null;
  }

  async function migrateLegacyOnce(legacyUid) {
    if (!isId(legacyUid)) return null;
    if (native.activeEditor(doc)) {
      toaster.show("Close the open drawing first", { kind: "error" });
      return null;
    }
    if (migrating) {
      toaster.show("A migration is already running", { kind: "error" });
      return null;
    }
    const block = host.pullBlock(legacyUid);
    if (!block || !isLegacyDrawingString(block.string)) {
      toaster.show("Not a legacy drawing", { kind: "error" });
      return null;
    }
    const parsed = parseLegacyDrawing(block.string);
    if (parsed.error) {
      toaster.show(`Cannot migrate: ${parsed.error}`, { kind: "error" });
      return null;
    }
    const conv = legacyToElements(parsed.elements, { migratedFrom: legacyUid });
    if (!conv.elements.length) {
      toaster.show("Nothing to migrate", { kind: "error" });
      return null;
    }
    let ok = false;
    try { ok = confirm("Create a new native drawing right below this legacy block? The legacy block is not changed.") === true; } catch { ok = false; }
    if (!ok) return null;
    migrating = true;
    const run = { before: legacySnapshot(legacyUid), target: null };
    try {
      const lock = await withLockFn(lockName(host.graphName(), `migrate:${legacyUid}`), () => migrateBody(legacyUid, parsed, conv, run), { ifAvailable: true });
      if (!lock.acquired) {
        toaster.show("Migration already running in another window", { kind: "error" });
        return null;
      }
      return lock.value ?? null;
    } catch (error) {
      console.warn("[plexus] migration failed", error);
      if (!disposed) toaster.show(migrationStoppedText(legacyUid, run, "Migration failed."), { kind: "error" });
      return null;
    } finally {
      migrating = false;
    }
  }

  function migrationStoppedText(legacyUid, run, head) {
    const now = legacySnapshot(legacyUid);
    const same = !!run.before && !!now && run.before.string === now.string && run.before.editTime === now.editTime;
    const made = run.target ? ` An empty drawing (${run.target}) was created; run Migrate again and it will be reused.` : "";
    return `${head}${made} ${same ? "The legacy block is unchanged." : "The legacy block changed meanwhile (not by Plexus)."}`;
  }

  async function migrateBody(legacyUid, parsed, conv, run = { before: null, target: null }) {
    const before = run.before ?? legacySnapshot(legacyUid);
    const target = `m${fnv1a(legacyUid)}`;
    const at = api.data.pull("[:block/order {:block/_children [:block/uid]}]", [":block/uid", legacyUid]);
    const parent = at?.[":block/_children"]?.[0]?.[":block/uid"];
    if (!parent) {
      toaster.show("Could not find the legacy block's parent", { kind: "error" });
      return null;
    }
    const already = () => {
      toaster.show("Already migrated");
      return null;
    };
    const existing = host.pullBlock(target);
    let targetUid = target;
    let reuse = false;
    if (existing) {
      if (!DRAWING_BLOCK_RE.test(existing.string)) {
        toaster.show("The block below the legacy drawing changed; nothing was written", { kind: "error" });
        return null;
      }
      const d = host.drawing(target);
      if (liveTagged(d, legacyUid) > 0) return already();
      if ((d?.elements || []).some((e) => !e.isDeleted)) {
        toaster.show("The block below the legacy drawing changed; nothing was written", { kind: "error" });
        return null;
      }
      reuse = true;
    }
    for (const sib of host.pullBlock(parent)?.children || []) {
      if (sib.uid === legacyUid || sib.uid === target || !DRAWING_BLOCK_RE.test(sib.string)) continue;
      if (liveTagged(host.drawing(sib.uid), legacyUid) > 0) return already();
    }
    legacyDialog?.close();
    if (!reuse) {
      const create = (uid) => api.data.block.create({
        location: { "parent-uid": parent, order: (at[":block/order"] ?? 0) + 1 },
        block: { uid, string: "{{[[excalidraw]]}}" },
      });
      try {
        await create(target);
      } catch (error) {
        if (!host.pullBlock(target)) {
          targetUid = api.util.generateUID();
          await create(targetUid);
        }
      }
    }
    if (disposed) return null;
    run.target = targetUid;
    const editor = await openDrawingOnce(targetUid, {});
    if (disposed) return null;
    if (!editor) {
      toaster.show(migrationStoppedText(legacyUid, run, "Migration stopped: the drawing did not open."), { kind: "error" });
      return null;
    }
    const app = editor.app;
    const stillHere = () => {
      const now = native.activeEditor(doc);
      return !!now && now.app === app && now.drawingUid === targetUid && app.state?.width > 0 && app.state?.height > 0;
    };
    const loaded = await native.waitNotLoading(app, 5000, { doc });
    await frame();
    await frame();
    if (disposed) return null;
    if (!stillHere()) {
      toaster.show("Drawing closed before migration finished; run Migrate again", { kind: "error" });
      return null;
    }
    if (!loaded || app.state?.isLoading) {
      toaster.show("Drawing is still loading; run Migrate again and the empty drawing will be reused", { kind: "error" });
      return null;
    }
    const ids = native.addViaPaste(app, conv.elements);
    const N = ids.length;
    if (!N) {
      toaster.show("Migration pasted no elements", { kind: "error" });
      return null;
    }
    try {
      const all = sceneElements(app);
      const pasted = all.filter((e) => ids.includes(e.id));
      const bbox = commonBounds(pasted);
      if (bbox) native.zoomTo(app, bbox);
    } catch (error) {
      console.warn("[plexus] zoom to migrated drawing failed", error);
    }
    const M = parsed.elements.length;
    const end = Date.now() + verifyTimeoutMs;
    let confirmed = false;
    for (;;) {
      if (disposed) return null;
      if (liveTagged(host.drawing(targetUid), legacyUid) === N) { confirmed = true; break; }
      if (Date.now() >= end) break;
      await sleep(verifyPollMs);
    }
    if (!confirmed) {
      toaster.show("Migration not confirmed yet. Reopen the drawing before running Migrate again", { kind: "error" });
      return null;
    }
    const after = legacySnapshot(legacyUid);
    const unchanged = !!before && !!after && before.string === after.string && before.editTime === after.editTime;
    const skipped = M - N;
    const head = N === M ? `Migrated ${N} elements.` : `Migrated ${N} of ${M} elements (${skipped} not migrated).`;
    toaster.show(`${head} ${unchanged ? "The legacy block is unchanged." : "The legacy block changed during migration (not by Plexus)."}`);
    return targetUid;
  }

  async function openDrawingOnce(uid, { sidebar = false, reuseIcon = false } = {}) {
    const matches = () => {
      const ed = native.activeEditor(doc);
      return ed && ed.drawingUid === uid ? ed : null;
    };
    const findIcon = () => {
      for (const el of doc.querySelectorAll('[id^="block-input-"]')) {
        if (!el.id.endsWith(uid) || el.closest?.(".plexus-offscreen")) continue;
        const found = el.querySelector(".excalidraw-outer-container .bp3-icon-fullscreen");
        if (found && found.isConnected !== false) return found;
      }
      return null;
    };
    // A drawing already on screen is opened through its own icon: navigating away would destroy the user's view.
    if (!(reuseIcon && (matches() || findIcon()))) {
      try {
        await host.openBlock(uid, sidebar ? { sidebar } : {});
      } catch (error) {
        console.warn("[plexus] open block failed", error);
        toaster.show("Could not open drawing", { kind: "error" });
        return null;
      }
    }
    const View = doc.defaultView;
    const deadline = Date.now() + 10000;
    let editor = matches();
    for (let attempt = 0; attempt < 3 && !editor; attempt++) {
      const icon = await waitFor(findIcon, Math.min(3000, Math.max(0, deadline - Date.now())), 50, aborted);
      if (disposed) return null;
      if (!icon) break;
      for (const type of ["mousedown", "mouseup", "click"]) {
        icon.dispatchEvent(new View.MouseEvent(type, { bubbles: true, cancelable: true, view: View }));
      }
      editor = await waitFor(matches, Math.min(1500, Math.max(0, deadline - Date.now())), 50, aborted);
    }
    if (!editor) editor = await waitFor(matches, Math.max(0, deadline - Date.now()), 50, aborted);
    if (!editor && !disposed) toaster.show("Drawing did not open", { kind: "error" });
    return editor || null;
  }

  async function openRegionOnce(regionUid, { sidebar = false } = {}) {
    const block = host.pullBlock(regionUid);
    const region = block ? parseRegion(block.string) : null;
    if (!region || !region.supported) {
      toaster.show("Region cannot be opened", { kind: "error" });
      return null;
    }
    const uid = region.drawingUid;
    if (isImageKind(region.kind)) {
      // The source is an ordinary image block, not a drawing: just take the user there.
      try {
        await host.openBlock(uid, { sidebar });
      } catch (error) {
        console.warn("[plexus] open block failed", error);
        toaster.show("Could not open image", { kind: "error" });
        return null;
      }
      const settled = (img) => {
        if (!img || !(img.naturalWidth > 0)) return null;
        const r = img.getBoundingClientRect?.();
        return r && r.width > 0 && r.height > 0 ? img : null;
      };
      const index = region.i || 0;
      let img = await waitFor(() => settled(findRenderedImage(uid, index)), 3000, 50, aborted);
      if (img) {
        await sleep(100);
        img = settled(findRenderedImage(uid, index)) || img;
      }
      if (img && !disposed) {
        const f = region.kind === "imgrect" ? region.f : polyBBox(region.p);
        if (f) {
          const box = contentRect(img, doc.defaultView);
          stopSpotlight?.();
          stopSpotlight = spotlight({
            rect: { left: box.left + f[0] * box.width, top: box.top + f[1] * box.height, width: f[2] * box.width, height: f[3] * box.height },
            doc,
          }) || null;
        }
      }
      return uid;
    }
    const matches = () => {
      const ed = native.activeEditor(doc);
      return ed && ed.drawingUid === uid ? ed : null;
    };
    const findIcon = () => {
      for (const el of doc.querySelectorAll('[id^="block-input-"]')) {
        if (!el.id.endsWith(uid) || el.closest?.(".plexus-offscreen")) continue;
        const found = el.querySelector(".excalidraw-outer-container .bp3-icon-fullscreen");
        if (found && found.isConnected !== false) return found;
      }
      return null;
    };
    const deadline = Date.now() + 10000;
    let editor = matches();
    if (!editor) {
      // The editor is full-screen, so a drawing already in the DOM needs no navigation (navigation destroys that DOM).
      if (!findIcon()) {
        try {
          await host.openBlock(uid, { sidebar });
        } catch (error) {
          console.warn("[plexus] open block failed", error);
          toaster.show("Could not open drawing", { kind: "error" });
          return null;
        }
      }
      const View = doc.defaultView;
      let dispatched = false;
      for (let attempt = 0; attempt < 3 && !editor; attempt++) {
        const icon = await waitFor(findIcon, Math.min(attempt === 0 ? 3000 : 1500, Math.max(0, deadline - Date.now())), 50, aborted);
        if (disposed) return null;
        if (!icon) {
          if (!dispatched) {
            toaster.show("Could not find the drawing", { kind: "error" });
            return null;
          }
          continue;
        }
        if (icon.isConnected === false) continue;
        for (const type of ["mousedown", "mouseup", "click"]) {
          icon.dispatchEvent(new View.MouseEvent(type, { bubbles: true, cancelable: true, view: View }));
        }
        dispatched = true;
        editor = await waitFor(matches, Math.min(1500, Math.max(0, deadline - Date.now())), 50, aborted);
      }
    }
    if (!editor) editor = await waitFor(matches, Math.max(0, deadline - Date.now()), 50, aborted);
    if (!editor) {
      if (disposed) return null;
      toaster.show("Drawing did not open", { kind: "error" });
      return null;
    }
    const { app } = editor;
    const box = regionSceneBBox(region, sceneElements(app), app.state);
    if (box.error) {
      toaster.show(`Region unavailable (${box.error})`, { kind: "error" });
      return null;
    }
    native.zoomTo(app, box.bbox, { maxZoom: 1 });
    await sleep(60);
    if (disposed) return null;
    stopSpotlight?.();
    stopSpotlight = spotlight({ rect: native.viewportRectOf(app, box.bbox), doc }) || null;
    return uid;
  }
}
