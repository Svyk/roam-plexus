import { DEFAULT_PAD, geometryKey, isContainerString, isId, normalizeFrac, normalizePoly, parseRegion, serializeRegion } from "./model/region.js";
import { commonBounds, elementBounds, regionSceneBBox, cropSvgToFraction, normalizeSvgSize, viewPngCropRect, viewportToScene } from "./model/scene.js";
import { rewriteSvgTitles, roamPageUrl } from "./model/pagelink.js";
import { createLiveShow, rememberIndex, saveIndex, viewPatch } from "./view/live-present.js";
import { createExportDialog } from "./view/export-dialog.js";
import { QUERY_REF, embedAnchors, embedLabel, layoutAnchorLabel, makeEmbedAnchor, mergePlexusData, parseEmbedRef } from "./model/embeds.js";
import { LEGACY_QUERY, isLegacyDrawingString, legacyReport, legacySummary, legacyToElements, parseLegacyDrawing, rowsFromQuery } from "./model/legacy.js";
import { orderFrames, buildTier, containingRegion, coverBoxes, hiddenIds, idsForBuild, idsWithoutOccluders, maxBuild, nextStep, patchPlexus } from "./model/slides.js";
import { DEFAULT_PRESET, frameId, applyOrderRewrite, bumped, childrenOutside, frameAt, layoutFrames, nearestFrame, nextSlideSlot, planOrders, presetFrame, presetSize, reformatRect, selectedFrameOf, withOrder } from "./model/frames.js";
import { captionRefsFromElements, captionRefsInfo } from "./model/caption.js";
import { clipSvgToPolygon, parseImageRefs, polyBBox, polyToLocal, simplifyPoly, thumbnailSize } from "./model/image.js";
import { isExcludedString } from "./model/mindmap.js";
import { drawingTitleOf, imageAltAt, isPlaceholderCaption, plainCaption, regionLabel } from "./model/label.js";
import { fnv1a } from "./model/hash.js";
import { cropKey } from "./host/cache.js";
import { directGuard } from "./host/guard.js";
import { isHostDark } from "./host/theme.js";
import { lockName, withLock } from "./host/locks.js";
import { cropCanvasToBlob } from "./host/cold-render.js";
import { clearImageMemo, loadImageBitmap } from "./host/image-source.js";
import { startImageRegionTool } from "./view/image-region-tool.js";
import { downloadPngs, printPages } from "./view/print.js";
import { createLegacyDialog } from "./view/legacy-dialog.js";
import { createCleanupDialog } from "./view/cleanup-dialog.js";
import { IMAGE_SETTLE_MS, PLAIN_SETTLE_MS, displayedPoly, displayedRect, displayedToNatural, isImageKind, renderRegionCrop, resolveRegionTarget } from "./view/regionref.js";
import { EXPORT_MARK, LINKS_MARK, appendTagText, collectTargets, elementsToAdd, exportPlan, linkPlan, parseSceneDocument, sceneDocument, tagToken } from "./model/carry.js";
import { drawingName, namePlan } from "./model/drawing-name.js";
import { cappedBounds, fitSize, imageParts, placedImage, reuseFileId, stageReusedFile } from "./model/image-insert.js";
import { blockRef, dropElement, imageMarkdown, pageRef, sourceText, splitTitleBody, turnBackToText, turnIntoEmbed, turnIntoLink } from "./model/turninto.js";
import { taskLabel, toggleTaskString } from "./model/task-card.js";
import { attrWrite, chosenAttrs, parseAttr } from "./model/page-card.js";
import { queryPageTitles } from "./model/query-live.js";
import { openInsertPicker } from "./view/insert-picker.js";
import { nextStampNumber, stackCopies, stampElements, stickyElements } from "./model/stamps.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const noop = () => {};

const CAPTION_MODES = ["auto", "ask", "none"];
const PIN_SIZES = [4, 8, 12];
const WHOLE_IMAGE_AREA = 0.98;
const SVG_HREF_RE = /(?:xlink:)?href\s*=\s*["']([^"']*)["']/gi;
const REFS_RE = /\(\([\w-]+\)\)|\[\[[^\]]+\]\]/g;
const refTokens = (text) => new Set(String(text ?? "").match(REFS_RE) || []);
const REGION_HEAD_RE = /^\s*\{\{\[\[plexus-region\]\]:[^}]*\}\}/;
const PRESENT_CAP = 100;
const OUTLINE_REF_RES = [/^\(\(([A-Za-z0-9_-]{9})\)\)$/, /^\[[^\]]*\]\(\(\(([A-Za-z0-9_-]{9})\)\)\)$/];
const KIND_RANK = { cframe: 0, frame: 1 };
const PRINT_CAP = 50;
const PRINT_SIZES = ["letter", "a4", "16:9"];
const LABEL_DEBOUNCE_MS = 1500;
const LABEL_RETRY_MS = 1000;
const WARM_KINDS = new Set(["area", "group", "frame", "cframe"]);
const AUDIT_ROW_CAP = 2000;
const AUDIT_YIELD_EVERY = 20;
const REPAIR_OF = { partial: "auto", "no-elements": "reselect", "outside-crop": "reselect", "not-image": "reselect", rotated: "reselect", "not-frame": "reselect" };
const BOX_PROBLEM = { "no-elements": "no-elements", "outside-crop": "outside-crop", "not-image": "not-image", "rotated-image": "rotated", "not-frame": "not-frame" };
const REMOVED_TOAST = "Removed from the drawing. The block is unchanged.";

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

// Every kind this selection can be. A whole frame or group still counts when other shapes are selected.
export function regionKindCandidates({ elements, ids, selectedGroupIds }) {
  const live = (elements || []).filter((el) => el && !el.isDeleted);
  const byId = new Map(live.map((el) => [el.id, el]));
  const selectedIds = [];
  const seen = new Set();
  for (const id of ids || []) {
    if (!byId.has(id) || seen.has(id)) continue;
    seen.add(id);
    selectedIds.push(id);
  }
  const candidates = [];
  const covered = new Set();
  const frames = selectedIds.map((id) => byId.get(id)).filter(isFrame);
  if (frames.length === 1) {
    const frame = frames[0];
    const children = live.filter((el) => el.frameId === frame.id);
    candidates.push({ kind: "cframe", frame, children });
    covered.add(frame.id);
    for (const el of children) covered.add(el.id);
  }
  const fullGroups = [];
  for (const groupId of Object.keys(selectedGroupIds || {})) {
    if (!selectedGroupIds[groupId]) continue;
    const members = live.filter((el) => Array.isArray(el.groupIds) && el.groupIds.includes(groupId));
    if (members.length && members.every((el) => seen.has(el.id))) fullGroups.push({ groupId, members });
  }
  if (fullGroups.length === 1) {
    const { groupId, members } = fullGroups[0];
    candidates.push({ kind: "group", groupId, members });
    for (const el of members) covered.add(el.id);
  }
  if (candidates.length) {
    const loose = selectedIds.filter((id) => !covered.has(id));
    if (loose.length) candidates.push({ kind: "area", ids: loose });
    return candidates;
  }
  if ((ids || []).length) return [{ kind: "area", ids: selectedIds }];
  return [];
}

// One button per candidate. Null when the document cannot host the dialog, or on Escape.
export function chooseRegionKind(doc, candidates) {
  const parent = typeof doc?.body?.append === "function" ? doc.body
    : typeof doc?.documentElement?.append === "function" ? doc.documentElement
      : null;
  if (!parent || typeof doc.createElement !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    const box = doc.createElement("div");
    box.className = "plexus-kind-chooser";
    box.setAttribute("role", "dialog");
    let settled = false;
    function finish(value) {
      if (settled) return;
      settled = true;
      doc.removeEventListener?.("keydown", onKey, true);
      box.remove();
      resolve(value);
    }
    function onKey(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      finish(null);
    }
    doc.addEventListener("keydown", onKey, true);
    for (const candidate of candidates) {
      const button = doc.createElement("button");
      button.textContent = candidate.kind === "cframe" ? "Frame" : candidate.kind === "group" ? "Group" : "Loose shapes";
      button.addEventListener("click", () => finish(candidate));
      box.appendChild(button);
    }
    parent.append(box);
  });
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
  guard = directGuard,
  camera = null,
  motionOk = () => false,
  viewHistory = () => null,
  measure = null,
  ensureFonts = null,
  printKit = { printPages, downloadPngs },
  printWin = (win) => win?.print?.(),
  setTimer = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimer = (id) => globalThis.clearTimeout(id),
  chooseKind = null,
  onDrawingName = () => {},
  openInsert = openInsertPicker,
}) {
  let disposed = false;
  let activeTool = null;
  let activeToolIsDrawing = false;
  let stopSpotlight = null;
  const busy = new Set();
  let presentOwner = null;
  let liveStop = null;
  const liveAt = new Map();
  let exportDialog = null;
  let printJob = null;
  let labelTimer = null;
  let labelGen = 0;
  const labelReady = new WeakSet();
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
  let pendingUpdate = null;
  // Anchor ids Remove embed just deleted. The leave watch must not toast those again.
  const leaveSilenced = new Set();
  const leaveWatches = new Set();
  const cameraTo = camera ?? {
    animateTo: async (app, bbox, { maxZoom } = {}) => {
      native.zoomTo(app, bbox, { maxZoom });
      return { moved: true };
    },
  };

  async function once(name, fn) {
    if (busy.has(name)) return null;
    busy.add(name);
    try {
      return await fn();
    } finally {
      busy.delete(name);
    }
  }

  const sceneElements = (app) => {
    const primary = typeof app?.getSceneElements === "function" ? app.getSceneElements() : null;
    if (Array.isArray(primary) && primary.length) return primary;
    // getSceneElements can be empty while the scene object still has the elements.
    const fromScene = app?.scene?.getNonDeletedElements?.();
    if (Array.isArray(fromScene) && fromScene.length) return fromScene;
    if (Array.isArray(primary)) return primary;
    return app?.getSceneElementsIncludingDeleted?.() ?? [];
  };

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

  // ---- P9: Roam onto the canvas ----

  const NEW_REUSE_MS = 2000;
  const PLEXUS_BLOCK_RE = /^\s*\{\{\[\[plexus-/;
  const DAILY_UID_RE = /^\d{2}-\d{2}-\d{4}$/;
  const EMBED_PLACE_CAP = 30;
  const PLACE_GAP = 40;
  const LINK_FONT = 20;
  const LINK_LINE = 1.25;
  const FONT_WAIT_MS = 500;
  const PENDING_MS = 10 * 60 * 1000;
  const newDone = new Map();
  const cards = new Map();
  let pending = null;

  const rnd = () => Math.floor(Math.random() * 2 ** 31);
  const refText = (ref) => (ref && typeof ref === "object" ? ref.ref : ref);
  const isValidDate = (d) => d instanceof Date && !Number.isNaN(d.getTime());
  const todayTitle = () => api.util.dateToPageTitle(new Date());

  function viewCentre(app) {
    const st = app.state || {};
    return viewportToScene({ x: (st.offsetLeft || 0) + (st.width || 0) / 2, y: (st.offsetTop || 0) + (st.height || 0) / 2, appState: st });
  }

  // One guarded write that appends elements and selects them: one undo step.
  function placeBuilt(label, build) {
    const editor = native.activeEditor(doc);
    if (!editor?.app) {
      toaster.show("Open a drawing full-screen first", { kind: "error" });
      return null;
    }
    if (!editor.drawingUid) {
      toaster.show("Could not identify this drawing", { kind: "error" });
      return null;
    }
    let n = 0;
    const elements = build(viewCentre(editor.app), () => `plx${rnd().toString(36)}${n++}`);
    if (!elements?.length) return null;
    if (!insertGuarded(editor.app, editor.drawingUid, elements, label)) {
      toaster.show("Could not add to the drawing", { kind: "error" });
      return null;
    }
    return elements.find((el) => !el.containerId)?.id ?? elements[0].id;
  }

  function insertGuarded(app, drawingUid, elements, label) {
    const selectedElementIds = {};
    for (const el of elements) if (!el.containerId) selectedElementIds[el.id] = true;
    return guard.guardedWrite(app, {
      drawingUid,
      label,
      captureUpdate: "IMMEDIATELY",
      next: (current) => [...current, ...elements],
      appState: { selectedElementIds, selectedGroupIds: {} },
    });
  }

  function cleanTitle(text) {
    return String(text ?? "").replace(/\[\[|\]\]|#/g, "").replace(/\s+/g, " ").trim();
  }

  async function newDrawingRun({ where, uid, open, order: wantOrder, fresh = false }) {
    if (native.activeEditor(doc)) {
      toaster.show("Close the open drawing first", { kind: "error" });
      return null;
    }
    const graph = host.graphName();
    let key;
    let create;
    if (where === "here" || where === "below") {
      const target = uid ? host.blockInfo(uid) : null;
      const onPage = !target && where === "here" && !!uid && host.pageTitleOf?.(uid) != null;
      if (!target && !onPage) {
        toaster.show("Click into a block first", { kind: "error" });
        return null;
      }
      if (onPage) {
        key = uid;
        create = () => host.createDrawing({ parentUid: uid, order: wantOrder ?? "last" });
      } else {
        if (PLEXUS_BLOCK_RE.test(target.string) || PLEXUS_BLOCK_RE.test(target.parentString)) {
          toaster.show("Plexus blocks cannot hold a drawing", { kind: "error" });
          return null;
        }
        let parentUid;
        let order;
        if (DAILY_UID_RE.test(target.pageUid ?? "")) {
          const top = host.topAncestor(uid);
          if (!top) {
            toaster.show("Could not find where to put the drawing", { kind: "error" });
            return null;
          }
          parentUid = top.pageUid;
          order = top.order + 1;
        } else if (where === "here") {
          parentUid = uid;
          order = 0;
        } else {
          parentUid = target.parentUid;
          order = target.order + 1;
        }
        if (!parentUid) {
          toaster.show("Could not find where to put the drawing", { kind: "error" });
          return null;
        }
        key = parentUid;
        create = () => host.createDrawing({ parentUid, order });
      }
    } else if (where === "today") {
      const now = new Date();
      key = `today:${api.util.dateToPageUid(now)}`;
      const title = api.util.dateToPageTitle(now);
      create = async () => {
        const pageUid = await host.ensurePage(title);
        const existing = fresh ? null : host.firstDrawingChild(pageUid);
        if (existing) return { uid: existing, reused: true };
        return host.createDrawing({ parentUid: pageUid, order: "last" });
      };
    } else if (where === "page") {
      const template = String(settingsNow().drawingName ?? "").trim() || "Drawing {date}";
      const dateText = safe(() => api.util.dateToPageTitle(new Date())) ?? new Date().toISOString().slice(0, 10);
      const openPage = await host.openPageUid?.();
      const pageText = (openPage && host.pageTitleOf?.(openPage)) || "";
      const expand = (tpl, n) => cleanTitle(tpl.replace(/\{date\}/g, dateText).replace(/\{page\}/g, pageText).replace(/\{n\}/g, n ? String(n) : ""));
      const hasN = /\{n\}/.test(template);
      const base = expand(template, 0) || expand("Drawing {date}", 0);
      key = `page:${base}`;
      const taken = (name) => !!host.pageUidByTitle(`Drawings/${name}`);
      create = () => {
        let name = null;
        if (hasN) {
          for (let n = 1; n < 1000 && !name; n++) {
            const candidate = expand(template, n) || expand("Drawing {date}", 0);
            if (!taken(candidate)) name = candidate;
          }
        }
        if (!name) {
          name = base;
          for (let k = 2; taken(name) && k < 1000; k++) name = `${base} ${k}`;
        }
        return host.createDrawing({ title: name });
      };
    } else {
      toaster.show("Unknown place for a new drawing", { kind: "error" });
      return null;
    }
    const memoKey = `${where}|${key}`;
    const recent = newDone.get(memoKey);
    let result;
    if (!fresh && recent && Date.now() - recent.at < NEW_REUSE_MS) {
      result = { uid: recent.uid, reused: true };
    } else {
      try {
        const lock = await withLockFn(lockName(graph, `new:${key}`), create);
        if (!lock.acquired) {
          toaster.show("Another drawing is being created, try again", { kind: "error" });
          return null;
        }
        result = lock.value;
      } catch (error) {
        console.warn("[plexus] new drawing failed", error);
        toaster.show("Could not create the drawing", { kind: "error" });
        return null;
      }
      if (!fresh) newDone.set(memoKey, { uid: result.uid, at: Date.now() });
      if (!result.reused) {
        try { emit({ uid: result.uid, kind: "drawing" }); } catch (error) { console.warn("[plexus] change emit failed", error); }
      }
    }
    let opened = false;
    if (open && !disposed) {
      const rendered = () => {
        for (const el of doc.querySelectorAll('[id^="block-input-"]')) {
          if (el.id.endsWith(result.uid) && !el.closest?.(".plexus-offscreen") && !el.closest?.(".plexus-dock") && (el.querySelector(".excalidraw-outer-container .bp3-icon-fullscreen") || el.querySelector(".excalidraw-container > div"))) return true;
        }
        return false;
      };
      await waitFor(rendered, 1500, 50, aborted);
      const editor = disposed ? null : await openDrawingOnce(result.uid, { reuseIcon: true, placeholder: true, quiet: true });
      opened = !!editor;
      if (!editor && !disposed && !fresh) toaster.show("Drawing created; open it from the outline");
    }
    return fresh ? { uid: result.uid, reused: !!result.reused, opened } : result.uid;
  }

  async function embedFromPickRun({ ref, scenePoint, app } = {}) {
    const editor = native.activeEditor(doc);
    if (!editor || (app && editor.app !== app)) {
      toaster.show("Drawing closed");
      return null;
    }
    const text = refText(ref);
    let embed;
    let label;
    let link = null;
    if (text === "plexus:today") {
      embed = "plexus:today";
      label = "Today";
      link = `[[${todayTitle()}]]`;
    } else {
      const parsed = parseEmbedRef(text);
      if (!parsed) {
        toaster.show("Could not embed that", { kind: "error" });
        return null;
      }
      let content = null;
      try {
        content = await host.pullEmbedContent(parsed.ref);
      } catch (error) {
        console.warn("[plexus] embed pull failed", error);
      }
      if (!content && !disposed && parsed.kind === "page" && isValidDate(safe(() => api.util.pageTitleToDate(parsed.title)))) {
        try {
          await host.ensurePage(parsed.title);
          await waitFor(() => host.pageUidByTitle(parsed.title), 2000, 50, aborted);
          if (!disposed) content = await host.pullEmbedContent(parsed.ref);
        } catch (error) {
          console.warn("[plexus] daily page create failed", error);
        }
      }
      if (!content || disposed) {
        if (!disposed) toaster.show(parsed.kind === "page" ? "Could not find that page" : "Could not find that block", { kind: "error" });
        return null;
      }
      embed = parsed.ref;
      label = embedLabel(content.string || content.title || parsed.ref);
    }
    if (native.activeEditor(doc)?.app !== editor.app) {
      toaster.show("Drawing closed");
      return null;
    }
    const c = scenePoint ?? viewCentre(editor.app);
    const width = 360;
    const height = 200;
    const elements = makeEmbedAnchor({ ref: embed, label, x: c.x - width / 2, y: c.y - height / 2, width, height, idPrefix: "plexus-embed-" });
    if (link) elements[0].link = link;
    if (!insertGuarded(editor.app, editor.drawingUid, elements, "Embed")) {
      toaster.show("Could not embed that", { kind: "error" });
      return null;
    }
    toaster.show(`Embedded ${label}`);
    return elements[0].id;
  }

  async function createPageAndEmbedRun(title, scenePoint, { app } = {}) {
    const editor = native.activeEditor(doc);
    if (!editor || (app && editor.app !== app)) {
      toaster.show("Drawing closed");
      return null;
    }
    const name = String(title ?? "").replace(/\s+/g, " ").trim();
    if (!name || /\[\[|\]\]/.test(name)) {
      toaster.show("That is not a valid page title", { kind: "error" });
      return null;
    }
    try {
      await host.ensurePage(name);
    } catch (error) {
      console.warn("[plexus] create page failed", error);
      toaster.show("Could not create the page", { kind: "error" });
      return null;
    }
    await waitFor(() => host.pageUidByTitle(name), 2000, 50, aborted);
    if (disposed) return null;
    return embedFromPickRun({ ref: `[[${name}]]`, scenePoint, app: editor.app });
  }

  const linkLabel = (text) => embedLabel(String(text ?? "").replace(/\(\([^()]*\)\)/g, ""), 60);

  function textNode(text, x, y, width, link) {
    const height = Math.ceil(LINK_FONT * LINK_LINE);
    return {
      id: `plexus-node-${Math.random().toString(36).slice(2, 12)}`,
      type: "text", x, y, width, height, angle: 0,
      strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid",
      strokeWidth: 1, strokeStyle: "solid", roughness: 0, opacity: 100,
      groupIds: [], frameId: null, roundness: null,
      seed: rnd(), version: 1, versionNonce: rnd(), isDeleted: false,
      boundElements: null, updated: Date.now(), link, locked: false, index: null,
      text, originalText: text, fontSize: LINK_FONT, fontFamily: 5, textAlign: "left", verticalAlign: "top",
      containerId: null, autoResize: true, lineHeight: LINK_LINE,
    };
  }

  const compareOrders = (a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
    return a.length - b.length;
  };

  function placeRefuse(message) {
    console.warn("[plexus] place:", message);
    toaster.show(message, { kind: "error" });
    return null;
  }

  async function placeBlocksRun(items, opts = {}) {
    try {
      return await placeBlocksInner(items, opts);
    } catch (error) {
      console.warn("[plexus] place failed", error);
      return placeRefuse(`Could not place: ${error?.message || error}`);
    }
  }

  async function placeBlocksInner(items, { mode = "embed", scenePoint, app, onPlaced } = {}) {
    const editor = native.activeEditor(doc);
    if (!editor || (app && editor.app !== app)) return placeRefuse("Open a drawing first");
    if (mode !== "embed" && mode !== "link" && mode !== "label") return placeRefuse("Could not place");
    const textMode = mode === "link" || mode === "label";
    const seen = new Set();
    const parsed = [];
    for (const item of items || []) {
      const p = parseEmbedRef(refText(item));
      if (p && !seen.has(p.ref)) {
        seen.add(p.ref);
        parsed.push(p);
      }
    }
    const paths = host.blockPaths(parsed.filter((p) => p.kind === "block").map((p) => p.uid));
    const listed = new Set(paths.keys());
    const blocks = parsed
      .filter((p) => p.kind === "block" && paths.has(p.uid) && !paths.get(p.uid).ancestors.some((a) => listed.has(a)))
      .sort((a, b) => compareOrders(paths.get(a.uid).orders, paths.get(b.uid).orders));
    const pages = parsed.filter((p) => p.kind === "page" && (textMode || host.pageUidByTitle(p.title)));
    let list = [...blocks, ...pages];
    if (!list.length) return placeRefuse("Nothing to place");
    const at = Number.isFinite(scenePoint?.x) && Number.isFinite(scenePoint?.y) ? scenePoint : undefined;
    if (scenePoint && !at) console.warn("[plexus] place: bad click point, using the view centre", scenePoint);
    if (!textMode && list.length > EMBED_PLACE_CAP) {
      const n = list.length;
      toaster.show(`Too many to embed live (${n}, max ${EMBED_PLACE_CAP})`, {
        action: { label: `Place ${n} as links`, run: () => { void placeBlocksRun(items, { mode: "link", scenePoint: at, app, onPlaced }); } },
      });
      return null;
    }
    const cap = mindmap?.NODE_CAP ?? 500;
    if (textMode && list.length > cap) {
      toaster.show(`Placing the first ${cap} of ${list.length}`);
      list = list.slice(0, cap);
    }
    const labels = list.map((p) => (p.kind === "page" ? p.title : (host.labelSource?.(p.uid)?.string ?? "")));
    let nodes;
    if (textMode) {
      const texts = labels.map((l, i) => linkLabel(l) || (list[i].kind === "page" ? list[i].title : "Block"));
      if (ensureFonts) {
        try { await Promise.race([ensureFonts(texts, LINK_FONT), sleep(FONT_WAIT_MS)]); } catch (error) { console.warn("[plexus] font load failed", error); }
      }
      nodes = texts.map((t, i) => {
        const w = measure ? Math.ceil(measure(t, LINK_FONT)) : Math.ceil(t.length * LINK_FONT * 0.6);
        return { w: Math.max(10, w), h: Math.ceil(LINK_FONT * LINK_LINE), build: (x, y) => [textNode(t, x, y, Math.max(10, w), mode === "label" ? null : list[i].ref)] };
      });
    } else {
      nodes = list.map((p, i) => ({ w: 360, h: 200, build: (x, y) => makeEmbedAnchor({ ref: p.ref, label: labels[i], x, y, width: 360, height: 200, idPrefix: "plexus-embed-" }) }));
    }
    if (disposed) {
      console.warn("[plexus] place: extension disposed");
      return null;
    }
    if (native.activeEditor(doc)?.app !== editor.app) return placeRefuse("Drawing closed");
    const n = nodes.length;
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const cellW = Math.max(...nodes.map((x) => x.w)) + PLACE_GAP;
    const cellH = Math.max(...nodes.map((x) => x.h)) + PLACE_GAP;
    const c = at ?? viewCentre(editor.app);
    const x0 = c.x - (cols * cellW - PLACE_GAP) / 2;
    const y0 = c.y - (rows * cellH - PLACE_GAP) / 2;
    const elements = nodes.flatMap((node, i) => node.build(x0 + (i % cols) * cellW, y0 + Math.floor(i / cols) * cellH));
    if (!insertGuarded(editor.app, editor.drawingUid, elements, "Place blocks")) return placeRefuse("Could not place: the drawing refused the write");
    const noun = mode === "link" ? "link" : mode === "label" ? "label" : "block";
    toaster.show(n === 1 ? `Placed 1 ${noun}` : `Placed ${n} ${noun}s`);
    try { onPlaced?.(); } catch (error) { console.warn("[plexus] place callback failed", error); }
    return { count: n, ids: elements.filter((e) => !e.containerId).map((e) => e.id) };
  }

  async function newNoteCardRun(scenePoint) {
    const editor = native.activeEditor(doc);
    if (!editor) {
      toaster.show("Open a drawing full-screen first", { kind: "error" });
      return null;
    }
    const { app, drawingUid } = editor;
    if (!drawingUid) {
      toaster.show("Could not identify this drawing", { kind: "error" });
      return null;
    }
    const overlay = getEmbedOverlay();
    if (!overlay || overlay.editState?.() !== "idle" || app.state?.editingTextElement) {
      toaster.show("Finish the current edit first", { kind: "error" });
      return null;
    }
    const home = ["drawing", "page", "daily"].includes(settingsNow().cardHome) ? settingsNow().cardHome : "drawing";
    let uid;
    try {
      if (home === "drawing") {
        uid = await host.createCard(drawingUid);
      } else {
        let pageUid;
        if (home === "page") pageUid = host.blockInfo(drawingUid)?.pageUid;
        else pageUid = await host.ensurePage(todayTitle());
        if (!pageUid) throw new Error("no page for the card");
        uid = await host.createBlock({ parentUid: pageUid, order: "last", string: "" });
      }
    } catch (error) {
      console.warn("[plexus] create note card failed", error);
      toaster.show("Could not create the note", { kind: "error" });
      return null;
    }
    cards.set(uid, { anchorId: null, app, drawingUid });
    if (disposed || native.activeEditor(doc)?.app !== app) {
      await discardIfUntouched(uid, { trigger: "error" });
      return null;
    }
    const c = scenePoint ?? viewCentre(app);
    const elements = makeEmbedAnchor({ ref: `((${uid}))`, label: "Note", x: c.x - 180, y: c.y - 100, width: 360, height: 200, idPrefix: "plexus-embed-" });
    if (!insertGuarded(app, drawingUid, elements, "New note")) {
      toaster.show("Could not add the note", { kind: "error" });
      await discardIfUntouched(uid, { trigger: "error" });
      return null;
    }
    const anchorId = elements[0].id;
    cards.get(uid).anchorId = anchorId;
    const ready = await waitFor(() => overlay.hasPortal?.(anchorId), 1000, 50, aborted);
    if (!ready || disposed) return uid;
    try {
      await overlay.edit(anchorId, { onLeave: (info) => discardIfUntouched(uid, { trigger: info?.trigger ?? "escape" }) });
    } catch (error) {
      console.warn("[plexus] note edit failed", error);
    }
    return uid;
  }

  function pendingNow() {
    if (pending && Date.now() - pending.at > PENDING_MS) pending = null;
    return pending ? { count: pending.items.length } : null;
  }

  const DISCARD_TRIGGERS = new Set(["escape", "enter", "pointer", "focus-lost", "error"]);

  // Deletes a note card this session created, only while it is still empty. Returns true when the block was deleted.
  async function discardIfUntouched(cardUid, { trigger = "escape" } = {}) {
    const card = cards.get(cardUid);
    if (!card) return false;
    if (!DISCARD_TRIGGERS.has(trigger) && trigger !== "removed") {
      cards.delete(cardUid);
      return false;
    }
    let block;
    try { block = host.pullBlock(cardUid); } catch (error) { console.warn("[plexus] card pull failed", error); return false; }
    if (!block) {
      cards.delete(cardUid);
      return false;
    }
    if (block.string.trim() !== "" || block.children.length) {
      cards.delete(cardUid);
      return false;
    }
    try {
      await host.deleteBlock(cardUid);
    } catch (error) {
      console.warn("[plexus] card delete failed", error);
      return false;
    }
    cards.delete(cardUid);
    if (trigger !== "removed" && card.anchorId) {
      const editor = native.activeEditor(doc);
      if (editor && editor.app === card.app) {
        try {
          const current = editor.app.getSceneElementsIncludingDeleted?.() ?? [];
          const ids = new Set([card.anchorId]);
          for (const el of current) if (el?.containerId === card.anchorId) ids.add(el.id);
          guard.guardedWrite(editor.app, {
            drawingUid: card.drawingUid,
            label: "Discard note",
            captureUpdate: "NEVER",
            next: (cur) => cur.map((el) => (el && ids.has(el.id) && !el.isDeleted ? { ...el, isDeleted: true, version: (el.version || 0) + 1, versionNonce: rnd(), updated: Date.now() } : el)),
          });
        } catch (error) {
          console.warn("[plexus] card anchor removal failed", error);
        }
      }
    }
    return true;
  }

  function stepOfEl(el) {
    const n = el?.customData?.plexus?.step;
    return Number.isInteger(n) && n >= 0 ? n : null;
  }

  function stampSelection(label, patchFor, empty) {
    const editor = native.activeEditor(doc);
    if (!editor?.app) {
      toaster.show("Open a drawing full-screen first", { kind: "error" });
      return false;
    }
    const ids = new Set(native.selectedElementIds(editor.app));
    if (!ids.size) {
      toaster.show(empty || "Select something first", { kind: "error" });
      return false;
    }
    let wrote = false;
    const ok = guard.guardedWrite(editor.app, {
      drawingUid: editor.drawingUid,
      label,
      captureUpdate: "IMMEDIATELY",
      next: (current) => current.map((el) => {
        if (!el || el.isDeleted || !ids.has(el.id)) return el;
        const patch = patchFor(el, current);
        if (!patch) return el;
        wrote = true;
        return patchPlexus(el, patch);
      }),
    });
    if (ok && !wrote) toaster.show(empty || "Nothing to change", { kind: "error" });
    return !!ok && wrote;
  }

  async function revealRegion(regionUid) {
    if (!isId(regionUid)) return false;
    const block = safe(() => host.pullBlock?.(regionUid));
    const region = block ? parseRegion(block.string) : null;
    if (!region?.supported) return false;
    const editor = native.activeEditor(doc);
    if (!editor?.app || editor.drawingUid !== region.drawingUid) return false;
    const elements = sceneElements(editor.app);
    const ids = idsWithoutOccluders(hotIds(region, elements), elements, regionUid);
    if (!ids.length) return false;
    const svg = await captureSafe(editor.app, ids);
    if (!svg) return false;
    const target = resolveRegionTarget(host, region);
    if (target?.error || !target?.hash) return false;
    const key = cropKey({ regionUid, geometryKey: geometryKey(region), drawingHash: target.hash, tier: "svg-reveal" });
    await cache.put(key, new Blob([normalizeSvgSize(svg)], { type: "image/svg+xml" }), svgSize(svg));
    return true;
  }

  async function markFlashcardOnce() {
    const editor = native.activeEditor(doc);
    if (!editor?.app) {
      toaster.show("Open a drawing full-screen first", { kind: "error" });
      return null;
    }
    const ids = new Set(native.selectedElementIds(editor.app));
    const elements = sceneElements(editor.app);
    const selected = elements.filter((el) => ids.has(el?.id) && !el.isDeleted);
    const hit = containingRegion(safe(() => host.regionsOf?.(editor.drawingUid)) || [], elements, editor.app.state, selected.length ? commonBounds(selected) : null);
    if (!hit?.uid) {
      toaster.show("Create a region over this first", { kind: "error" });
      return null;
    }
    const kids = safe(() => host.pullBlock?.(hit.uid)?.children) || [];
    if (kids.some((c) => String(c?.string ?? "").includes("#flashcard"))) {
      toaster.show("Already a flashcard");
      return hit.uid;
    }
    let child = null;
    try {
      child = await host.createBlock?.({ parentUid: hit.uid, order: "last", string: "#flashcard" });
    } catch (error) {
      console.warn("[plexus] flashcard failed", error);
    }
    if (!child) {
      toaster.show("Could not mark the flashcard", { kind: "error" });
      return null;
    }
    toaster.show("Marked as a flashcard");
    return hit.uid;
  }

  function pageUrl(title) {
    const graph = safe(() => host.graphName?.());
    if (!graph || !api?.data?.pull) return null;
    let uid = null;
    try { uid = api.data.pull("[:block/uid]", [":node/title", title])?.[":block/uid"] ?? null; } catch { return null; }
    return roamPageUrl(graph, uid);
  }

  async function exportOnce(editor, choice) {
    const elements = sceneElements(editor.app).filter((el) => el && !el.isDeleted);
    const selected = native.selectedElementIds(editor.app);
    const ids = choice?.scope === "selection" && selected.length ? selected : elements.map((el) => el.id);
    if (!ids.length) {
      toaster.show("Nothing to export", { kind: "error" });
      return null;
    }
    if (choice?.output === "clipboard") {
      const svg = await captureSafe(editor.app, ids);
      if (!svg) {
        toaster.show("Could not export", { kind: "error" });
        return null;
      }
      const text = rewriteSvgTitles(normalizeSvgSize(svg), pageUrl);
      try {
        const write = () => clipboard.writeText(text);
        await (native.withClipboard ? native.withClipboard(write) : write());
      } catch (error) {
        console.warn("[plexus] export copy failed", error);
        toaster.show("Clipboard access was blocked", { kind: "error" });
        return null;
      }
      toaster.show("Export copied");
      return "clipboard";
    }
    const png = typeof native.captureSelectionPng === "function"
      ? await native.captureSelectionPng(editor.app, ids, { scale: choice.scale, dark: choice.theme === "dark", padding: choice.padding, clipboard })
      : null;
    if (!png) {
      toaster.show("Could not export", { kind: "error" });
      return null;
    }
    if (choice.output === "download") {
      const url = urls.createObjectURL(png);
      try {
        const a = doc.createElement("a");
        a.href = url;
        a.download = "drawing.png";
        doc.body?.append?.(a);
        a.click?.();
        a.remove?.();
      } finally {
        setTimeout(() => urls.revokeObjectURL?.(url), revokeDelayMs);
      }
      toaster.show("Export downloaded");
      return "download";
    }
    try {
      const file = new File([png], "drawing.png", { type: "image/png" });
      const res = await (upload ? upload(file) : api.file.upload({ file }));
      const raw = typeof res === "string" ? res : res?.url ?? "";
      const md = /^!\[[^\]]*\]\(([^)]+)\)$/.exec(String(raw).trim());
      const href = md ? md[1] : String(raw).trim();
      if (!href) throw new Error("[plexus] upload returned nothing");
      const made = await host.createBlock?.({ parentUid: editor.drawingUid, order: "last", string: `![drawing](${href})` });
      if (!made) throw new Error("[plexus] no child");
      toaster.show("Export inserted");
      return "insert";
    } catch (error) {
      console.warn("[plexus] export insert failed", error);
      toaster.show("Could not insert the image", { kind: "error" });
      return null;
    }
  }

  // A hash in block props is not a Roam ref. The live scene is what just changed; props can still be the previous save.
  const liveScene = (app) => sceneElements(app).filter((el) => el && !el.isDeleted);
  const sceneHash = (app) => fnv1a(JSON.stringify(liveScene(app)));
  let closeSyncTail = Promise.resolve();

  function drawingUidOf(uid) {
    const editor = native.activeEditor(doc);
    const block = isId(uid) ? safe(() => host.pullBlock(uid)) : null;
    if (block && DRAWING_BLOCK_RE.test(block.string)) return uid;
    if (isId(editor?.drawingUid)) return editor.drawingUid;
    return "";
  }

  function downloadBlob(blob, name) {
    const url = urls.createObjectURL(blob);
    try {
      const a = doc.createElement("a");
      a.href = url;
      a.download = name;
      doc.body?.append?.(a);
      a.click?.();
      a.remove?.();
    } finally {
      setTimeout(() => urls.revokeObjectURL?.(url), revokeDelayMs);
    }
  }

  function pickSceneText() {
    return new Promise((resolve) => {
      let input;
      try { input = doc.createElement("input"); } catch { resolve(null); return; }
      if (!input) { resolve(null); return; }
      input.type = "file";
      input.accept = ".excalidraw,.json,application/json";
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        try { input.remove?.(); } catch { /* already gone */ }
        resolve(value);
      };
      input.addEventListener?.("change", async () => {
        const file = input.files?.[0];
        if (!file) return finish(null);
        try {
          const text = typeof file.text === "function" ? await file.text() : await new Promise((res, rej) => {
            const reader = new doc.defaultView.FileReader();
            reader.onload = () => res(String(reader.result ?? ""));
            reader.onerror = () => rej(reader.error);
            reader.readAsText(file);
          });
          finish(text);
        } catch (error) {
          console.warn("[plexus] scene read failed", error);
          finish(null);
        }
      });
      input.addEventListener?.("cancel", () => finish(null));
      try { doc.body?.append?.(input); } catch { /* a detached input can still open the picker */ }
      try { input.click?.(); } catch { finish(null); }
    });
  }

  async function exportScene(uid) {
    const drawingUid = drawingUidOf(uid);
    if (!drawingUid) {
      toaster.show("Open a drawing or click a drawing block", { kind: "error" });
      return null;
    }
    const editor = native.activeEditor(doc);
    const open = editor?.app && editor.drawingUid === drawingUid ? editor : null;
    const drawing = safe(() => host.drawing(drawingUid));
    const elements = open ? liveScene(open.app) : (drawing?.elements ?? []);
    if (!elements.length) {
      toaster.show("Nothing to export", { kind: "error" });
      return null;
    }
    const files = open && open.app.files && typeof open.app.files === "object" && !Array.isArray(open.app.files) ? open.app.files : {};
    const payload = sceneDocument({ elements, appState: open ? open.app.state : drawing?.appState, files });
    downloadBlob(new Blob([JSON.stringify(payload)], { type: "application/json" }), "drawing.excalidraw");
    toaster.show("Scene exported");
    return drawingUid;
  }

  async function importScene(parentUid) {
    const text = await pickSceneText();
    if (text == null) return null;
    const data = parseSceneDocument(text);
    if (!data) {
      toaster.show("That file is not a scene", { kind: "error" });
      return null;
    }
    const elements = elementsToAdd(data.elements);
    if (!elements.length) {
      toaster.show("Images are not imported", { kind: "error" });
      return null;
    }
    const parent = isId(parentUid) ? safe(() => host.pullBlock(parentUid)) : null;
    const below = parent && !DRAWING_BLOCK_RE.test(parent.string);
    const made = await newDrawingRun({ where: below ? "below" : "page", uid: below ? parentUid : undefined, open: true, fresh: true });
    const drawingUid = made && typeof made === "object" ? made.uid : made;
    if (!isId(drawingUid)) return null;
    const editor = native.activeEditor(doc);
    if (!editor?.app || editor.drawingUid !== drawingUid) {
      toaster.show("Drawing created; open it from the outline");
      return drawingUid;
    }
    if (typeof native.insertElements !== "function" || !native.insertElements(editor.app, elements, { select: true })) {
      toaster.show("Could not add the scene", { kind: "error" });
      return drawingUid;
    }
    toaster.show("Scene imported");
    return drawingUid;
  }

  async function tagElements(raw) {
    const editor = native.activeEditor(doc);
    if (!editor?.app || !isId(editor.drawingUid)) {
      toaster.show("Open a drawing full-screen first", { kind: "error" });
      return null;
    }
    const st = editor.app.state || {};
    // A right-click leaves the button down while this menu item runs. Only an open text editor blocks the tag.
    if (st.editingTextElement || st.newElement) {
      toaster.show("Finish the current edit first", { kind: "error" });
      return null;
    }
    const selected = new Set(native.selectedElementIds(editor.app));
    const targets = liveScene(editor.app).filter((el) => selected.has(el.id) && el.type === "text");
    if (!targets.length) {
      toaster.show("Select a text element first", { kind: "error" });
      return null;
    }
    let name = raw;
    if (!name) {
      name = await askCaption({ initial: "", select: true, escape: "cancel", rect: null, drawing: true });
      if (!name) return null;
    }
    const token = tagToken(name);
    if (!token) {
      toaster.show("That tag name will not work", { kind: "error" });
      return null;
    }
    const ids = new Set(targets.map((el) => el.id));
    const ok = guard.guardedWrite(editor.app, {
      drawingUid: editor.drawingUid,
      label: "Tag elements",
      captureUpdate: "IMMEDIATELY",
      next: (current) => current.map((el) => {
        if (!el || !ids.has(el.id)) return el;
        const prev = typeof el.originalText === "string" ? el.originalText : (typeof el.text === "string" ? el.text : "");
        const nextText = appendTagText(prev, name);
        if (nextText === prev) return el;
        return {
          ...el,
          text: nextText,
          originalText: nextText,
          version: (el.version || 0) + 1,
          versionNonce: Math.floor(Math.random() * 2147483647),
          updated: Date.now(),
        };
      }),
    });
    if (!ok) return null;
    const kids = safe(() => host.pullBlock(editor.drawingUid)?.children) || [];
    if (!kids.some((child) => String(child?.string ?? "").includes(token))) {
      const made = await host.createBlock?.({ parentUid: editor.drawingUid, order: "last", string: token });
      if (!made) {
        toaster.show("Could not add the tag ref", { kind: "error" });
        return null;
      }
    }
    toaster.show("Tag added");
    return token;
  }

  function openEditor() {
    const editor = native.activeEditor(doc);
    if (!editor?.app || !isId(editor.drawingUid)) {
      toaster.show("Open a drawing full-screen first", { kind: "error" });
      return null;
    }
    const st = editor.app.state || {};
    if (st.editingTextElement || st.newElement) {
      toaster.show("Finish the current edit first", { kind: "error" });
      return null;
    }
    return editor;
  }

  function selectedLive(app) {
    const ids = new Set(native.selectedElementIds(app));
    return liveScene(app).filter((el) => el && ids.has(el.id));
  }

  function applyWrite(editor, label, apply) {
    let produced = null;
    const ok = guard.guardedWrite(editor.app, {
      drawingUid: editor.drawingUid,
      label,
      captureUpdate: "IMMEDIATELY",
      next: (current) => {
        produced = apply(current);
        return Array.isArray(produced) ? produced : current;
      },
    });
    return ok && Array.isArray(produced) ? produced : null;
  }

  async function dropCreatedPage(existed, pageUid) {
    if (existed || !pageUid) return;
    try { await api.data.page.delete({ page: { uid: pageUid } }); }
    catch (error) { console.warn("[plexus] page delete failed", error); }
  }

  async function dropCreatedBlock(uid) {
    if (!uid) return;
    try { await host.deleteBlock?.(uid); }
    catch (error) { console.warn("[plexus] block delete failed", error); }
  }

  function turnBackValue(elements, el) {
    const raw = el?.customData?.plexus?.embed;
    const parsed = parseEmbedRef(typeof raw === "string" ? raw : "");
    if (parsed?.kind === "block") {
      const string = safe(() => host.pullBlock(parsed.uid)?.string);
      if (string) return string;
    }
    if (parsed?.kind === "page" && parsed.title) return parsed.title;
    const bound = (elements || []).find((item) => item && !item.isDeleted && item.type === "text" && item.containerId === el.id);
    const label = bound ? sourceText(bound) : "";
    return label || embedLabel(raw);
  }

  async function turnPage(editor, el, embed) {
    const split = splitTitleBody(sourceText(el));
    const confirmed = await askCaption({ initial: split.title, select: true, escape: "cancel", rect: null, drawing: true });
    if (confirmed == null) return null;
    const title = splitTitleBody(confirmed).title;
    const ref = pageRef(title);
    if (!ref) {
      toaster.show("That title will not work", { kind: "error" });
      return null;
    }
    const existed = typeof host.pageUidByTitle === "function" && !!safe(() => host.pageUidByTitle(title));
    let pageUid = null;
    try { pageUid = await host.ensurePage?.(title); }
    catch (error) {
      console.warn("[plexus] page create failed", error);
      toaster.show("Could not create the page", { kind: "error" });
      return null;
    }
    if (!pageUid) {
      toaster.show("Could not create the page", { kind: "error" });
      return null;
    }
    const written = applyWrite(editor, "Turn into page", (current) => (
      embed ? turnIntoEmbed(current, el.id, { ref, label: title }) : turnIntoLink(current, el.id, ref)
    ));
    if (!written) {
      await dropCreatedPage(existed, pageUid);
      return null;
    }
    if (!existed && split.body) {
      try { await host.createBlock?.({ parentUid: pageUid, order: "last", string: split.body }); }
      catch (error) {
        console.warn("[plexus] page body failed", error);
        toaster.show("Could not add the page body", { kind: "error" });
      }
    }
    toaster.show(embed ? "Turned into a page embed" : "Turned into a page link");
    return ref;
  }

  async function turnBlock(editor, el, embed) {
    const text = sourceText(el);
    if (!String(text ?? "").trim()) {
      toaster.show("Select a free text element", { kind: "error" });
      return null;
    }
    let childUid = null;
    try {
      childUid = await host.createBlock?.({ parentUid: editor.drawingUid, order: "last", string: text, open: false });
    } catch (error) {
      console.warn("[plexus] block create failed", error);
      toaster.show("Could not add the block", { kind: "error" });
      return null;
    }
    const ref = blockRef(childUid);
    if (!ref) {
      await dropCreatedBlock(childUid);
      toaster.show("Could not add the block", { kind: "error" });
      return null;
    }
    const written = applyWrite(editor, "Turn into block", (current) => (
      embed ? turnIntoEmbed(current, el.id, { ref, label: embedLabel(text) }) : turnIntoLink(current, el.id, ref)
    ));
    if (!written) {
      await dropCreatedBlock(childUid);
      return null;
    }
    toaster.show(embed ? "Turned into a block embed" : "Turned into a block link");
    return ref;
  }

  async function turnImage(editor, el) {
    const markdown = imageMarkdown(el.customData?.firebaseUrl);
    if (!markdown) {
      toaster.show("This image has no file address", { kind: "error" });
      return null;
    }
    let childUid = null;
    try {
      childUid = await host.createBlock?.({ parentUid: editor.drawingUid, order: "last", string: markdown, open: false });
    } catch (error) {
      console.warn("[plexus] image block failed", error);
      toaster.show("Could not add the block", { kind: "error" });
      return null;
    }
    if (!childUid) {
      toaster.show("Could not add the block", { kind: "error" });
      return null;
    }
    const written = applyWrite(editor, "Move image to block", (current) => dropElement(current, el.id));
    if (!written) {
      await dropCreatedBlock(childUid);
      return null;
    }
    toaster.show("Image moved to a block");
    return childUid;
  }

  async function turnBack(editor, el) {
    const value = turnBackValue(editor.app.getSceneElementsIncludingDeleted?.() ?? liveScene(editor.app), el);
    const written = applyWrite(editor, "Turn back to text", (current) => turnBackToText(current, el.id, value));
    if (!written) return null;
    toaster.show("Turned back to text");
    return true;
  }

  async function turnInto(mode) {
    return once("turnInto", async () => {
      const editor = openEditor();
      if (!editor) return null;
      const hits = selectedLive(editor.app);
      const el = hits.length === 1 ? hits[0] : null;
      const free = !!(el && el.type === "text" && !el.containerId);
      if (mode === "page-embed" || mode === "page-link" || mode === "block-embed" || mode === "block-link") {
        if (!free) {
          toaster.show(hits.length === 1 ? "Select a free text element" : "Select one element", { kind: "error" });
          return null;
        }
        const embed = mode === "page-embed" || mode === "block-embed";
        return mode.startsWith("page") ? turnPage(editor, el, embed) : turnBlock(editor, el, embed);
      }
      if (mode === "image-block") {
        if (!el || el.type !== "image") {
          toaster.show("Select one element", { kind: "error" });
          return null;
        }
        return turnImage(editor, el);
      }
      if (mode === "text") {
        if (!el || el.type !== "rectangle" || typeof el.customData?.plexus?.embed !== "string") {
          toaster.show("Select one element", { kind: "error" });
          return null;
        }
        return turnBack(editor, el);
      }
      return null;
    });
  }

  const INSERT_CAP = 40;

  function collectInsertRows(pageUid, skipUid) {
    const rows = [];
    const visit = (uid, depth) => {
      if (!uid || depth > 3 || rows.length >= INSERT_CAP) return;
      const block = safe(() => host.pullBlock(uid));
      for (const child of block?.children || []) {
        if (rows.length >= INSERT_CAP) return;
        if (!child?.uid || child.uid === skipUid) continue;
        const string = String(child.string ?? "");
        if (DRAWING_BLOCK_RE.test(string)) {
          const named = drawingName(safe(() => host.pullBlock(child.uid)?.children));
          rows.push({ kind: "drawing", uid: child.uid, label: named?.value || "Drawing" });
          continue;
        }
        const image = imageParts(string);
        if (image) rows.push({ kind: "image", uid: child.uid, label: image.alt || "Image", url: image.url });
        if (depth < 3) visit(child.uid, depth + 1);
      }
    };
    visit(pageUid, 1);
    return rows;
  }

  async function asDataURL(file) {
    if (typeof file === "string") return file.startsWith("data:") ? file : null;
    if (typeof file?.dataURL === "string") return file.dataURL;
    if (typeof file?.arrayBuffer !== "function") return null;
    const buf = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let i = 0; i < buf.length; i += 0x8000) binary += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return `data:${file.type || "image/png"};base64,${btoa(binary)}`;
  }

  async function reusePayload(url) {
    let file = null;
    try { file = await api.file.get({ url }); }
    catch (error) {
      console.warn("[plexus] file get failed", error);
      return null;
    }
    if (!file) return null;
    const dataURL = await asDataURL(file);
    if (!dataURL) return null;
    let width = 480;
    let height = 360;
    let sized = false;
    if (typeof createBitmap === "function") {
      try {
        const bmp = await createBitmap(file);
        if (bmp?.width > 0 && bmp?.height > 0) {
          width = bmp.width;
          height = bmp.height;
          sized = true;
        }
        bmp?.close?.();
      } catch { /* natural size falls back */ }
    }
    if (!sized && typeof loadBitmap === "function") {
      try {
        const bmp = await loadBitmap(url);
        if (bmp?.width > 0 && bmp?.height > 0) {
          width = bmp.width;
          height = bmp.height;
        }
        bmp?.close?.();
      } catch { /* 480 by 360 */ }
    }
    return { dataURL, mimeType: file.type || file.mimeType || "image/png", width, height };
  }

  async function placeInsert(choice) {
    const editor = openEditor();
    if (!editor) return null;
    const row = choice.row;
    const centre = viewCentre(editor.app);
    if (row.kind === "drawing") {
      let width = 480;
      let height = 360;
      if (choice.full) {
        const bounds = cappedBounds(safe(() => host.drawing?.(row.uid)?.elements));
        if (bounds) { width = bounds.width; height = bounds.height; }
      }
      const ref = blockRef(row.uid);
      if (!ref) {
        toaster.show("Could not insert that", { kind: "error" });
        return null;
      }
      const [rect, text] = makeEmbedAnchor({
        ref,
        label: row.label || "Drawing",
        x: centre.x - width / 2,
        y: centre.y - height / 2,
        width,
        height,
      });
      const ok = insertGuarded(editor.app, editor.drawingUid, [rect, text], "Insert drawing");
      if (!ok) {
        toaster.show("Could not insert that", { kind: "error" });
        return null;
      }
      toaster.show("Drawing inserted");
      return ref;
    }
    if (row.kind !== "image" || !row.url) {
      toaster.show("Could not insert that", { kind: "error" });
      return null;
    }
    const payload = await reusePayload(row.url);
    if (!payload) {
      toaster.show("Could not reuse that file", { kind: "error" });
      return null;
    }
    const size = fitSize(payload.width, payload.height, !!choice.full);
    const fileId = reuseFileId(row.uid);
    const elementId = `plximg${Math.random().toString(36).slice(2, 10)}`;
    let staged = false;
    try { staged = stageReusedFile(editor.app, { fileId, dataURL: payload.dataURL, mimeType: payload.mimeType }); }
    catch (error) {
      console.warn("[plexus] file reuse failed", error);
      toaster.show("Could not reuse that file", { kind: "error" });
      return null;
    }
    if (!staged || !fileId) {
      toaster.show("Could not reuse that file", { kind: "error" });
      return null;
    }
    const image = placedImage({
      elementId,
      fileId,
      url: row.url,
      link: blockRef(row.uid),
      x: centre.x - size.width / 2,
      y: centre.y - size.height / 2,
      width: size.width,
      height: size.height,
    });
    if (!image) {
      toaster.show("Could not insert that", { kind: "error" });
      return null;
    }
    const ok = insertGuarded(editor.app, editor.drawingUid, [image], "Insert image");
    if (!ok) {
      toaster.show("Could not insert that", { kind: "error" });
      return null;
    }
    toaster.show("Image inserted");
    return image.id;
  }

  async function insertImageOrDrawing() {
    return once("insertImage", async () => {
      const editor = openEditor();
      if (!editor) return null;
      const pageUid = safe(() => host.blockInfo?.(editor.drawingUid)?.pageUid);
      if (!pageUid) {
        toaster.show("Could not identify this drawing", { kind: "error" });
        return null;
      }
      const rows = collectInsertRows(pageUid, editor.drawingUid);
      return new Promise((resolve) => {
        try {
          openInsert({
            doc,
            rows,
            zIndex: 100003,
            onChoose: (choice) => {
              if (!choice?.row) { resolve(null); return; }
              Promise.resolve(placeInsert(choice)).then(resolve, (error) => {
                console.warn("[plexus] insert failed", error);
                toaster.show("Could not insert that", { kind: "error" });
                resolve(null);
              });
            },
          });
        } catch (error) {
          console.warn("[plexus] insert picker failed", error);
          toaster.show("Could not insert that", { kind: "error" });
          resolve(null);
        }
      });
    });
  }

  function drawingUidForName(uid) {
    if (!isId(uid)) return null;
    const info = safe(() => host.blockInfo?.(uid));
    if (info) return DRAWING_BLOCK_RE.test(info.string || "") ? uid : null;
    const pulled = safe(() => host.pullBlock?.(uid));
    if (pulled?.string && !DRAWING_BLOCK_RE.test(pulled.string)) return null;
    return uid;
  }

  async function setDrawingName(uid) {
    return once("drawingName", async () => {
      let drawingUid = drawingUidForName(uid);
      if (!drawingUid) {
        const editor = native.activeEditor(doc);
        drawingUid = isId(editor?.drawingUid) ? editor.drawingUid : null;
      }
      if (!drawingUid) {
        toaster.show("Open a drawing full-screen first", { kind: "error" });
        return null;
      }
      const children = safe(() => host.pullBlock(drawingUid)?.children) || [];
      const current = drawingName(children);
      const value = await askCaption({ initial: current?.value || "", select: true, escape: "cancel", rect: null, drawing: true });
      if (value == null) return null;
      const plan = namePlan(children, value);
      if (plan.action === "none") {
        try { onDrawingName(drawingUid, current?.value || ""); } catch (error) { console.warn("[plexus] drawing name paint failed", error); }
        return "none";
      }
      try {
        if (plan.action === "delete") await host.deleteBlock?.(plan.uid);
        else if (plan.action === "update") await api.data.block.update({ block: { uid: plan.uid, string: plan.string } });
        else if (plan.action === "create") {
          const made = await host.createBlock?.({ parentUid: drawingUid, order: "last", string: plan.string });
          if (!made) throw new Error("[plexus] name block was not created");
        } else return null;
      } catch (error) {
        console.warn("[plexus] drawing name failed", error);
        toaster.show("Could not save the name", { kind: "error" });
        return null;
      }
      const shown = plan.action === "delete" ? "" : String(value).trim();
      try { onDrawingName(drawingUid, shown); } catch (error) { console.warn("[plexus] drawing name paint failed", error); }
      toaster.show(plan.action === "delete" ? "Name removed" : "Name saved");
      return plan.action;
    });
  }

  async function placeCard(editor, elements, label) {
    if (!insertGuarded(editor.app, editor.drawingUid, elements, label)) {
      toaster.show("Could not add the card", { kind: "error" });
      return false;
    }
    return true;
  }

  async function taskCard(focusedUid) {
    return once("taskCard", async () => {
      const editor = openEditor();
      if (!editor) return null;
      let uid = null;
      let created = false;
      let label = "Task";
      if (isId(focusedUid)) {
        const block = safe(() => host.pullBlock(focusedUid));
        const named = taskLabel(block?.string);
        if (named) { uid = focusedUid; label = named; }
      }
      if (!uid) {
        const text = await askCaption({ initial: "", select: true, escape: "cancel", rect: null, drawing: true });
        if (text == null || !String(text).trim()) return null;
        label = String(text).trim();
        try {
          uid = await host.createBlock({ parentUid: editor.drawingUid, order: "last", string: `{{[[TODO]]}} ${label}` });
          created = true;
        } catch (error) {
          console.warn("[plexus] task create failed", error);
          toaster.show("Could not create the task", { kind: "error" });
          return null;
        }
      }
      const centre = viewCentre(editor.app);
      const elements = makeEmbedAnchor({ ref: `((${uid}))`, label, x: centre.x - 180, y: centre.y - 60, width: 360, height: 120 });
      if (!await placeCard(editor, elements, "Task card")) {
        if (created) { try { await host.deleteBlock(uid); } catch (error) { console.warn("[plexus] task cleanup failed", error); } }
        return null;
      }
      toaster.show("Task card added");
      return uid;
    });
  }

  async function toggleTask(uid) {
    if (!isId(uid)) return null;
    const block = safe(() => host.pullBlock(uid));
    const next = toggleTaskString(block?.string);
    if (!next) return null;
    try {
      await api.data.block.update({ block: { uid, string: next } });
    } catch (error) {
      console.warn("[plexus] task toggle failed", error);
      toaster.show("Could not update the task", { kind: "error" });
      return null;
    }
    return next;
  }

  async function pageCard() {
    return once("pageCard", async () => {
      const editor = openEditor();
      if (!editor) return null;
      const typed = await askCaption({ initial: "", select: true, escape: "cancel", rect: null, drawing: true });
      const title = cleanTitle(typed);
      if (!title) return null;
      const before = safe(() => host.pageUidByTitle(title));
      let pageUid;
      try {
        pageUid = await host.ensurePage(title);
      } catch (error) {
        console.warn("[plexus] page card failed", error);
        toaster.show("Could not open that page", { kind: "error" });
        return null;
      }
      const created = !before;
      const named = await askCaption({ initial: "", select: true, escape: "cancel", rect: null, drawing: true });
      const dropNew = async () => {
        if (!created || !pageUid) return;
        try { await api.data.page.delete({ page: { uid: pageUid } }); } catch (error) { console.warn("[plexus] page cleanup failed", error); }
      };
      if (named == null) { await dropNew(); return null; }
      const names = chosenAttrs(named);
      if (!names.length) {
        toaster.show("Name at least one attribute");
        await dropNew();
        return null;
      }
      const centre = viewCentre(editor.app);
      const elements = makeEmbedAnchor({ ref: `[[${title}]]`, label: title, x: centre.x - 180, y: centre.y - 100, width: 360, height: 200 });
      elements[0].customData = mergePlexusData(elements[0].customData, { attrs: names });
      if (!await placeCard(editor, elements, "Page card")) {
        await dropNew();
        return null;
      }
      toaster.show("Page card added");
      return pageUid;
    });
  }

  async function setPageAttr({ pageUid, name, value, uid } = {}) {
    const plan = attrWrite(name, value);
    if (plan.action === "none") return "locked";
    if (isId(uid)) {
      const current = safe(() => host.pullBlock(uid));
      if (parseAttr(current?.string)?.bt) return "locked";
      try {
        if (plan.action === "delete") await host.deleteBlock(uid);
        else await api.data.block.update({ block: { uid, string: plan.string } });
      } catch (error) {
        console.warn("[plexus] attribute edit failed", error);
        toaster.show("Could not save the attribute", { kind: "error" });
        return null;
      }
      return plan.action === "delete" ? "delete" : "update";
    }
    if (plan.action === "delete" || !isId(pageUid)) return "none";
    try {
      await host.createBlock({ parentUid: pageUid, order: "last", string: plan.string });
    } catch (error) {
      console.warn("[plexus] attribute edit failed", error);
      toaster.show("Could not save the attribute", { kind: "error" });
      return null;
    }
    return "create";
  }

  async function liveQuery() {
    return once("liveQuery", async () => {
      const editor = openEditor();
      if (!editor) return null;
      const typed = await askCaption({ initial: "{{[[query]]: {and: [[TODO]] [[]]}}}", select: true, escape: "cancel", rect: null, drawing: true });
      if (typed == null || !String(typed).trim()) return null;
      const raw = String(typed).trim();
      const stored = raw.includes("{{") ? raw : `{{[[query]]: ${raw}}}`;
      const centre = viewCentre(editor.app);
      const elements = makeEmbedAnchor({ ref: QUERY_REF, label: "Query", x: centre.x - 210, y: centre.y - 120, width: 420, height: 240 });
      elements[0].customData = mergePlexusData(elements[0].customData, { liveQuery: stored });
      if (!await placeCard(editor, elements, "Live query")) return null;
      toaster.show(queryPageTitles(stored).length ? "Live query added" : "Query added. No page to watch");
      return elements[0].id;
    });
  }

  async function syncExport(app, drawingUid) {
    if (!app || !isId(drawingUid)) return { action: "skip" };
    const children = safe(() => host.pullBlock(drawingUid)?.children) || [];
    const mark = children.find((child) => child?.string === EXPORT_MARK) || null;
    if (!mark?.uid) return { action: "skip" };
    const nested = safe(() => host.pullBlock(mark.uid)?.children) || [];
    const plan = exportPlan({ children, markChildren: nested, hash: sceneHash(app) });
    if (plan.action !== "update") return plan;
    const ids = liveScene(app).map((el) => el.id);
    if (!ids.length) return { action: "skip" };
    const png = ids.length && typeof native.captureSelectionPng === "function"
      ? await native.captureSelectionPng(app, ids, { scale: 2, dark: app.state?.theme === "dark", clipboard })
      : null;
    if (!png) {
      toaster.show("Could not export", { kind: "error" });
      return null;
    }
    try {
      const file = new File([png], "drawing.png", { type: "image/png" });
      const res = await (upload ? upload(file) : api.file.upload({ file }));
      const raw = typeof res === "string" ? res : res?.url ?? "";
      const md = /^!\[[^\]]*\]\(([^)]+)\)$/.exec(String(raw).trim());
      const href = md ? md[1] : String(raw).trim();
      if (!href) throw new Error("[plexus] upload returned nothing");
      const image = `![drawing](${href})`;
      const hashString = `\`${plan.hash}\``;
      if (plan.imageUid) await api.data.block.update({ block: { uid: plan.imageUid, string: image } });
      else await host.createBlock?.({ parentUid: plan.markUid, order: 0, string: image });
      if (plan.hashUid) await api.data.block.update({ block: { uid: plan.hashUid, string: hashString } });
      else await host.createBlock?.({ parentUid: plan.markUid, order: 1, string: hashString });
      if (plan.oldUrl && plan.oldUrl !== href) {
        try { await api.file?.delete?.({ url: plan.oldUrl }); }
        catch (error) { console.warn("[plexus] old export delete failed", error); }
      }
      return { action: "update", href };
    } catch (error) {
      console.warn("[plexus] export image failed", error);
      toaster.show("Could not export", { kind: "error" });
      return null;
    }
  }

  async function applyLinks(app, drawingUid, { createMark }) {
    const elements = app ? liveScene(app) : (safe(() => host.drawing(drawingUid)?.elements) ?? []);
    const regions = safe(() => host.regionsOf?.(drawingUid)) || [];
    const targets = collectTargets({ elements, regions, drawingUid });
    const children = safe(() => host.pullBlock(drawingUid)?.children) || [];
    const mark = children.find((child) => child?.string === LINKS_MARK) || null;
    const markChildren = mark?.uid ? (safe(() => host.pullBlock(mark.uid)?.children) || []) : [];
    const plan = linkPlan({ children, markChildren, targets });
    if (plan.action === "none" || plan.action === "create" && !createMark) return plan;
    if (plan.action === "delete") {
      await host.deleteBlock?.(plan.markUid);
      return plan;
    }
    if (plan.action === "create") {
      const markUid = await host.createBlock?.({ parentUid: drawingUid, order: "last", string: LINKS_MARK, open: false });
      if (!markUid) return null;
      for (let i = 0; i < plan.refs.length; i++) await host.createBlock?.({ parentUid: markUid, order: i, string: plan.refs[i] });
      return { ...plan, markUid };
    }
    for (const child of [...markChildren]) if (child?.uid) await host.deleteBlock?.(child.uid);
    for (let i = 0; i < plan.refs.length; i++) await host.createBlock?.({ parentUid: plan.markUid, order: i, string: plan.refs[i] });
    return plan;
  }

  async function keepExportImage() {
    const editor = native.activeEditor(doc);
    if (!editor?.app || !isId(editor.drawingUid)) {
      toaster.show("Open a drawing full-screen first", { kind: "error" });
      return null;
    }
    const children = safe(() => host.pullBlock(editor.drawingUid)?.children) || [];
    if (!children.some((child) => child?.string === EXPORT_MARK)) {
      const made = await host.createBlock?.({ parentUid: editor.drawingUid, order: "last", string: EXPORT_MARK, open: false });
      if (!made) {
        toaster.show("Could not keep the export image", { kind: "error" });
        return null;
      }
    }
    const result = await syncExport(editor.app, editor.drawingUid);
    if (!result) return null;
    toaster.show("Export image kept");
    return editor.drawingUid;
  }

  async function keepLinkedReferences(uid) {
    const drawingUid = drawingUidOf(uid);
    if (!drawingUid) {
      toaster.show("Open a drawing or click a drawing block", { kind: "error" });
      return null;
    }
    const editor = native.activeEditor(doc);
    const app = editor?.drawingUid === drawingUid ? editor.app : null;
    const plan = await applyLinks(app, drawingUid, { createMark: true });
    if (!plan || (plan.action === "none" && !plan.markUid) || plan.action === "delete") {
      toaster.show("Nothing to list");
      return plan?.action === "delete" ? drawingUid : null;
    }
    toaster.show("Linked references kept");
    return drawingUid;
  }

  function syncOnClose(app, drawingUid) {
    if (!app || !isId(drawingUid) || disposed) return Promise.resolve(null);
    const run = closeSyncTail.catch(() => {}).then(async () => {
      try { await syncExport(app, drawingUid); }
      catch (error) { console.warn("[plexus] close sync failed", error); }
      try { await applyLinks(app, drawingUid, { createMark: false }); }
      catch (error) { console.warn("[plexus] close sync failed", error); }
    });
    closeSyncTail = run;
    return run;
  }

  return {
    dispose() {
      disposed = true;
      liveStop?.();
      liveStop = null;
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
      cancelEmbedLabels();
      printJob?.dispose();
      pendingUpdate = null;
      pending = null;
      cards.clear();
      newDone.clear();
      for (const revoke of [...revokers]) revoke();
      for (const stop of [...leaveWatches]) stop();
      leaveSilenced.clear();
    },

    // The drawing image tool is bound to the mounted editor; cancel it when that editor goes away.
    cancelDrawingTool() {
      cancelEmbedLabels();
      pendingUpdate = null;
      if (activeToolIsDrawing) activeTool?.cancel?.();
      if (activePromptIsDrawing) activePrompt?.cancel?.();
    },

    // New drawing where the user is. where: "here" | "below" | "page" | "today". uid: the target block (else the focused block).
    // fresh: skip the reuse memo and the today-page reuse, and return { uid, reused, opened } (P13 templates).
    newDrawing({ where = "here", uid, open = true, order, fresh = false } = {}) {
      const target = typeof uid === "string" && uid ? uid : safe(() => api.ui?.getFocusedBlock?.()?.["block-uid"]);
      return once("new-drawing", () => newDrawingRun({ where, uid: target, open, order, fresh }));
    },

    embedFromPick: (opts) => embedFromPickRun(opts),

    createPageAndEmbed: (title, scenePoint, opts) => createPageAndEmbedRun(title, scenePoint, opts),

    placeBlocks: (items, opts) => placeBlocksRun(items, opts),

    async addOutlineBlock(rootUid) {
      try {
        if (!rootUid || !host.pullBlock(rootUid)) {
          toaster.show("Could not add a block", { kind: "error" });
          return null;
        }
        return await host.createBlock({ parentUid: rootUid, order: "last", string: "" });
      } catch (error) {
        console.warn("[plexus] add outline block failed", error);
        toaster.show("Could not add a block", { kind: "error" });
        return null;
      }
    },

    // Remembers an ordered list of blocks to place once a drawing is open (the full-screen editor hides the outline).
    armPlace(uids, { mode = "embed" } = {}) {
      const items = [...new Set((uids || []).map((u) => parseEmbedRef(refText(u))?.ref).filter(Boolean))];
      if (!items.length) return false;
      pending = { items, mode, at: Date.now() };
      toaster.show(`Open a drawing, then right-click the canvas: Place ${items.length} blocks here`);
      return true;
    },

    pendingPlace: pendingNow,

    async placePending(scenePoint) {
      if (!pendingNow()) return placeRefuse("Nothing to place");
      const job = pending;
      const done = await placeBlocksRun(job.items, { mode: job.mode, scenePoint, onPlaced: () => { if (pending === job) pending = null; } });
      if (done && pending === job) pending = null;
      return done;
    },

    cancelPendingPlace() {
      pending = null;
    },

    newNoteCard: (scenePoint) => once("note", () => newNoteCardRun(scenePoint)),

    discardIfUntouched,

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
      const selectedGroupIds = app.state?.selectedGroupIds;
      const candidates = regionKindCandidates({ elements, ids, selectedGroupIds });
      let detected;
      if (candidates.length >= 2) {
        detected = await (chooseKind || chooseRegionKind)(doc, candidates);
        if (!detected || disposed) return null;
      } else {
        detected = detectRegionKind({ elements, ids, selectedGroupIds });
      }
      let region;
      let words;
      let anchorIds = ids;
      if (detected.kind === "cframe") {
        const { frame, children } = detected;
        words = drawingCaptions(elements, children.map((el) => el.id), frame.name);
        region = { kind: "cframe", drawingUid, frameId: frame.id };
      } else if (detected.kind === "group") {
        words = drawingCaptions(elements, detected.members.map((el) => el.id));
        region = { kind: "group", drawingUid, groupId: detected.groupId, pad: DEFAULT_PAD };
      } else {
        const areaIds = Array.isArray(detected.ids) ? detected.ids : ids;
        words = drawingCaptions(elements, areaIds);
        region = { kind: "area", drawingUid, ids: areaIds, pad: DEFAULT_PAD };
        anchorIds = areaIds;
      }
      const caption = await chooseCaption({ ...words, rect: anchorRect(app, commonBounds(elements.filter((e) => anchorIds.includes(e.id)))), drawing: true });
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

    presentDrawing: ({ drawingUid, from = "start", at } = {}) => runPresent((release) => presentOnce(drawingUid, release, { from, at })),

    presentLive: () => {
      const editor = native.activeEditor(doc);
      if (!editor?.app || !editor.outer) {
        toaster.show("Open a drawing full-screen first", { kind: "error" });
        return null;
      }
      const elements = sceneElements(editor.app);
      const frames = orderFrames(elements);
      if (!frames.length) {
        toaster.show("No frames in this drawing", { kind: "error" });
        return null;
      }
      liveStop?.();
      const { app, outer, drawingUid } = editor;
      const readView = () => {
        const z = app.state?.zoom;
        return {
          scrollX: app.state?.scrollX || 0,
          scrollY: app.state?.scrollY || 0,
          zoom: (typeof z === "number" ? z : z?.value) || 1,
        };
      };
      const hud = doc.createElement("div");
      hud.className = "plexus-portal plexus-live-hud";
      hud.hidden = true;
      doc.body?.append?.(hud);
      const view = doc.defaultView;
      const show = createLiveShow({
        frames,
        elements,
        viewport: { width: app.state?.width || outer.clientWidth || 1, height: app.state?.height || outer.clientHeight || 1 },
        readView,
        writeView: (next) => { try { app.updateScene(viewPatch(next)); } catch (error) { console.warn("[plexus] live view failed", error); } },
        onChrome: (on) => {
          outer.classList?.toggle?.("plexus-live", !!on);
          hud.hidden = !on;
        },
        onStatus: (index, build, total) => { hud.textContent = `${index + 1} / ${total}${build ? ` · ${build + 1}` : ""} · Esc`; },
        now: () => view?.performance?.now?.() ?? Date.now(),
        raf: (fn) => (typeof view?.requestAnimationFrame === "function" ? view.requestAnimationFrame(fn) : setTimeout(() => fn(Date.now()), 16)),
        caf: (id) => (typeof view?.cancelAnimationFrame === "function" ? view.cancelAnimationFrame(id) : clearTimeout(id)),
      });
      const onKey = (e) => {
        if (!e || e.metaKey || e.ctrlKey || e.altKey) return;
        const next = e.key === "ArrowRight" || e.key === "PageDown" || e.key === " " || e.key === "Spacebar";
        const prev = e.key === "ArrowLeft" || e.key === "PageUp" || e.key === "Backspace";
        if (e.key !== "Escape" && !next && !prev) return;
        e.preventDefault?.();
        e.stopPropagation?.();
        if (e.key === "Escape") finish();
        else if (next) show.next();
        else show.prev();
      };
      function finish() {
        if (liveStop !== finish) return;
        liveStop = null;
        saveIndex(liveAt, drawingUid, show.index());
        show.exit();
        doc.removeEventListener?.("keydown", onKey, true);
        hud.remove?.();
      }
      liveStop = finish;
      doc.addEventListener?.("keydown", onKey, true);
      show.start(rememberIndex(liveAt, drawingUid, frames.length));
      return drawingUid;
    },

    setRevealStep: () => stampSelection("Reveal step", (el, current) => (
      el.frameId ? { step: nextStep(current, el.frameId) } : null
    ), "Select elements inside a frame"),

    clearRevealStep: () => stampSelection("Clear reveal step", (el) => (stepOfEl(el) === null ? null : { step: null }), "Select a stepped element"),

    addOcclusion: () => {
      const editor = native.activeEditor(doc);
      if (!editor?.app) {
        toaster.show("Open a drawing full-screen first", { kind: "error" });
        return null;
      }
      const ids = new Set(native.selectedElementIds(editor.app));
      const elements = sceneElements(editor.app);
      const selected = elements.filter((el) => ids.has(el?.id) && !el.isDeleted);
      if (!selected.length) {
        toaster.show("Select the cover first", { kind: "error" });
        return null;
      }
      const hit = containingRegion(safe(() => host.regionsOf?.(editor.drawingUid)) || [], elements, editor.app.state, commonBounds(selected));
      if (!hit?.uid) {
        toaster.show("Create a region over this first", { kind: "error" });
        return null;
      }
      const ok = guard.guardedWrite(editor.app, {
        drawingUid: editor.drawingUid,
        label: "Add occlusion",
        captureUpdate: "IMMEDIATELY",
        next: (current) => current.map((el) => (el && ids.has(el.id) && !el.isDeleted ? patchPlexus(el, { occlude: hit.uid }) : el)),
      });
      if (!ok) return null;
      Promise.resolve(revealRegion(hit.uid)).catch((error) => console.warn("[plexus] reveal capture failed", error));
      toaster.show("Occlusion added");
      return hit.uid;
    },

    markFlashcard: () => markFlashcardOnce(),

    revealRegion: (uid) => revealRegion(uid),

    exportDrawing: () => {
      const editor = native.activeEditor(doc);
      if (!editor?.app) {
        toaster.show("Open a drawing full-screen first", { kind: "error" });
        return null;
      }
      if (!exportDialog) exportDialog = createExportDialog({ doc });
      const selected = native.selectedElementIds(editor.app);
      exportDialog.open({
        hasSelection: selected.length > 0,
        onSubmit: (choice) => { Promise.resolve(exportOnce(editor, choice)).catch((error) => console.warn("[plexus] export failed", error)); },
      });
      return true;
    },

    exportScene: (uid) => exportScene(uid),
    importScene: (uid) => importScene(uid),
    tagElements: (raw) => tagElements(raw),
    turnInto: (mode) => turnInto(mode),
    insertImageOrDrawing: () => insertImageOrDrawing(),
    setDrawingName: (uid) => setDrawingName(uid),
    taskCard: (uid) => taskCard(uid),
    toggleTask: (uid) => toggleTask(uid),
    pageCard: () => pageCard(),
    setPageAttr: (row) => setPageAttr(row),
    liveQuery: () => liveQuery(),
    keepExportImage: () => keepExportImage(),
    keepLinkedReferences: (uid) => keepLinkedReferences(uid),
    syncOnClose: (app, drawingUid) => syncOnClose(app, drawingUid),

    presentFromRegion: async (regionUid) => {
      const block = isId(regionUid) ? safe(() => host.pullBlock(regionUid)) : null;
      const region = block ? parseRegion(block.string) : null;
      if (!region?.supported || !(region.kind === "frame" || region.kind === "cframe") || !region.frameId) {
        toaster.show("Not a frame region", { kind: "error" });
        return null;
      }
      return runPresent((release) => presentOnce(region.drawingUid, release, { from: region.frameId }));
    },

    presentOutline: (blockUid) => runPresent((release) => presentOutlineOnce(blockUid, release)),

    printFrames: (opts) => once("print", () => printFramesOnce(opts || {})),

    refreshEmbedLabels,
    scheduleEmbedLabels,
    selectedFrameId,
    addFrame: (opts) => addFrameOnce(opts || {}),
    addFrameLayout: (opts) => addFrameLayoutOnce(opts || {}),
    reformatFrame: (opts) => reformatFrameOnce(opts || {}),
    makeSlide: () => makeSlideOnce(),
    addNotesForFrame: async ({ drawingUid, frameId } = {}) => {
      const editor = native.activeEditor(doc);
      const uid = drawingUid || editor?.drawingUid;
      const scene = editor && editor.drawingUid === uid ? sceneElements(editor.app) : safe(() => host.drawing(uid)?.elements) ?? [];
      const frame = scene.find((el) => el && !el.isDeleted && isFrameEl(el) && el.id === frameId);
      if (!isId(uid) || !frame) {
        toaster.show("Select a frame first", { kind: "error" });
        return null;
      }
      const added = [];
      const out = await addNotesForFrame(uid, frame, added);
      afterPresent(added);
      if (!out) toaster.show("Could not add notes", { kind: "error" });
      else if (!added.length) toaster.show("Notes already exist: Outline › regions");
      return out;
    },

    createPlainImageRegion: (blockUid) => once("plain", async () => {
      const block = isId(blockUid) ? host.pullBlock(blockUid) : null;
      const refs = block ? parseImageRefs(block.string) : [];
      if (!refs.length) {
        toaster.show("No image in this block", { kind: "error" });
        return null;
      }
      let index = 0;
      for (;;) {
      const ref = refs[index];
      const img = findRenderedImage(blockUid, ref.index);
      if (!img) {
        toaster.show("Show the image on screen first", { kind: "error" });
        return null;
      }
      const imageRect = contentRect(img, doc.defaultView);
      const tool = startTool({ doc, imageRect, cycle: refs.length > 1 });
      activeTool = tool;
      activeToolIsDrawing = false;
      let picked;
      try {
        picked = await tool;
      } finally {
        if (activeTool === tool) activeTool = null;
      }
      if (!picked || disposed) return null;
      if (picked.kind === "cycle") {
        if (refs.length < 2) return null;
        index = (index + 1) % refs.length;
        toaster.show(`Image ${index + 1} of ${refs.length}`);
        continue;
      }
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
      }
    }),

    stickyNote: () => once("sticky", () => placeBuilt("Sticky note", (c, newId) => stickyElements({
      x: c.x - 100, y: c.y - 70, newId, measure,
    }))),

    numberStamp: () => once("stamp", () => {
      const editor = native.activeEditor(doc);
      if (!editor?.app) {
        toaster.show("Open a drawing full-screen first", { kind: "error" });
        return null;
      }
      const n = nextStampNumber(sceneElements(editor.app));
      const id = placeBuilt("Number stamp", (c, newId) => stampElements({ x: c.x, y: c.y, n, newId, measure }));
      if (id) toaster.show(String(n));
      return id;
    }),

    stackSelection: () => once("stack", () => {
      const editor = native.activeEditor(doc);
      if (!editor?.app) {
        toaster.show("Open a drawing full-screen first", { kind: "error" });
        return null;
      }
      if (!editor.drawingUid) {
        toaster.show("Could not identify this drawing", { kind: "error" });
        return null;
      }
      const ids = native.selectedElementIds(editor.app);
      let n = 0;
      const copies = stackCopies(sceneElements(editor.app), ids, { newId: () => `plxstack${rnd().toString(36)}${n++}` });
      if (!copies) {
        toaster.show(ids?.length ? "Nothing to stack" : "Select something first");
        return null;
      }
      if (!insertGuarded(editor.app, editor.drawingUid, copies, "Stack")) {
        toaster.show("Could not add to the drawing", { kind: "error" });
        return null;
      }
      return copies.filter((el) => !el.containerId).map((el) => el.id);
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

    // Same anchor selection as canEditEmbed. The embed editor does not have to be idle.
    canRemoveEmbed() {
      const editor = native.activeEditor(doc);
      if (!editor?.app) return false;
      return !!selectedAnchor(editor.app);
    },

    removeSelectedEmbed,

    addCitedEmbed,

    installAnchorLeaveWatch,

    openDrawing: (uid, { sidebar = false, placeholder = false } = {}) => once(`opendrawing:${uid}`, () => openDrawingOnce(uid, { sidebar, reuseIcon: true, placeholder })),

    mindMapFromOutline: (blockUid) => once(`mindmap:${blockUid}`, () => mindMapFromOutlineOnce(blockUid)),

    openRegion: (regionUid, opts) => once(`open:${regionUid}`, () => openRegionOnce(regionUid, opts)),

    // One cframe region per frame that has none, in slide order (cap 50 per run).
    regionsForAllFrames: () => once("all-frames", regionsForAllFramesOnce),

    updateRegionFromSelection: (regionUid) => once(`update:${regionUid}`, () => updateRegionOnce(regionUid)),

    pendingRegionUpdate() {
      if (!pendingUpdate) return null;
      const block = safe(() => host.pullBlock(pendingUpdate.uid));
      const region = block ? parseRegion(block.string) : null;
      if (!region?.supported) {
        pendingUpdate = null;
        return null;
      }
      return { uid: pendingUpdate.uid, label: labelOf(region) };
    },

    applyPendingUpdate: () => once("apply-pending", applyPendingOnce),

    cancelPendingUpdate() { pendingUpdate = null; },

    repairRegion: (regionUid) => once(`repair:${regionUid}`, () => repairRegionOnce(regionUid)),

    selectRegionOnDrawing: (regionUid) => once(`select:${regionUid}`, () => selectRegionOnce(regionUid)),

    auditRegions: ({ scope = "page" } = {}) => once("audit", () => auditRegionsOnce(scope)),

    copyRegionLink(uid) {
      if (!isId(uid)) return Promise.resolve(false);
      const hash = safe(() => doc.defaultView?.location?.hash) ?? "";
      const route = String(hash).startsWith("#/offline/") ? "offline" : "app";
      return copyText(`https://roamresearch.com/#/${route}/${encodeURIComponent(host.graphName())}/page/${uid}`, "Region link copied");
    },

    copyDrawingRef() {
      const editor = native.activeEditor(doc);
      if (!isId(editor?.drawingUid)) {
        toaster.show("Open a drawing full-screen first", { kind: "error" });
        return Promise.resolve(false);
      }
      return copyText(`((${editor.drawingUid}))`, "Drawing ref copied");
    },

    copyDrawingEmbed() {
      const editor = native.activeEditor(doc);
      if (!isId(editor?.drawingUid)) {
        toaster.show("Open a drawing full-screen first", { kind: "error" });
        return Promise.resolve(false);
      }
      return copyText(`{{[[embed]]: ((${editor.drawingUid}))}}`, "Drawing embed copied");
    },

    selectTextOnly() {
      const editor = native.activeEditor(doc);
      if (!editor) {
        toaster.show("Open a drawing full-screen first", { kind: "error" });
        return 0;
      }
      const { app } = editor;
      const free = sceneElements(app).filter((e) => e && !e.isDeleted && e.type === "text" && !e.containerId);
      const ids = native.selectedElementIds(app);
      const pick = ids.length ? free.filter((e) => ids.includes(e.id)) : free;
      if (!pick.length) {
        toaster.show("No free text to select", { kind: "error" });
        return 0;
      }
      const selection = {};
      for (const el of pick) selection[el.id] = true;
      app.updateScene({ appState: { selectedElementIds: selection, selectedGroupIds: {} } });
      return pick.length;
    },

    removeElementLink: () => once("remove-link", removeElementLinkOnce),

    hasSnapshot() {
      const editor = native.activeEditor(doc);
      return !!editor?.drawingUid && !!guard.hasSnapshot?.(editor.drawingUid);
    },

    restoreBeforeLastPlexusChange() {
      const editor = native.activeEditor(doc);
      if (!editor?.drawingUid) {
        toaster.show("Open a drawing full-screen first", { kind: "error" });
        return 0;
      }
      try {
        const n = guard.restoreLast(editor.app, editor.drawingUid);
        if (guard === directGuard) toaster.show("Nothing to restore");
        return n;
      } catch (error) {
        console.warn("[plexus] restore failed", error);
        toaster.show("Could not restore the drawing", { kind: "error" });
        return 0;
      }
    },

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

  // Writes text through the clipboard helper; the write starts synchronously so the user gesture still counts.
  function copyText(text, done) {
    let pending;
    try {
      const write = () => clipboard.writeText(text);
      pending = native.withClipboard ? native.withClipboard(write) : write();
    } catch (error) {
      pending = Promise.reject(error);
    }
    return Promise.resolve(pending).then(
      () => {
        toaster.show(done);
        return true;
      },
      (error) => {
        console.warn("[plexus] clipboard failed", error);
        toaster.show("Clipboard access was blocked", { kind: "error" });
        return false;
      },
    );
  }

  // Crisp 2x PNG of a drawing-kind region while its editor is mounted (memory only). Never throws.
  async function warmPng2x(app, regionUid, region, svg) {
    if (!WARM_KINDS.has(region.kind) || typeof native.captureSelectionPng !== "function") return;
    try {
      const dark = !!safe(() => isHostDark(doc)) && !!settingsNow().darkCrops;
      const blob = await native.captureSelectionPng(app, hotIds(region, sceneElements(app)), { scale: 2, dark });
      if (!blob || disposed) return;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.length < 24) return;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const pw = view.getUint32(16);
      const ph = view.getUint32(20);
      const want = svgSize(svg);
      if (Math.abs(pw - want.w * 2) > 4 || Math.abs(ph - want.h * 2) > 4) {
        console.warn("[plexus] png2x size differs from the svg, dropped", regionUid, `${pw}x${ph}`, `${want.w * 2}x${want.h * 2}`);
        return;
      }
      const drawing = host.drawing(region.drawingUid);
      if (!drawing) return;
      const key = cropKey({ regionUid, geometryKey: geometryKey(region), drawingHash: drawing.hash, tier: dark ? "png2x-dark" : "png2x" });
      await cache.put(key, blob, { w: pw / 2, h: ph / 2, persist: false });
    } catch (error) {
      console.warn("[plexus] png2x capture failed", regionUid, error);
    }
  }

  function tokenReplaced(before, key, value) {
    const head = REGION_HEAD_RE.exec(before)?.[0];
    if (!head) return null;
    const re = new RegExp(`(\\s)${key}=[^\\s}]*`);
    if (!re.test(head)) return null;
    return before.replace(head, () => head.replace(re, (whole, sp) => `${sp}${key}=${value}`));
  }

  // The one token a selection changes for this region kind, as { next } or { error }. Kind never changes.
  function geometryFromSelection(region, before, app) {
    if (isImageKind(region.kind)) return { error: "Image regions cannot be updated from a selection" };
    const elements = sceneElements(app);
    const ids = native.selectedElementIds(app);
    if (!ids.length) return { error: "Select the new elements first" };
    let key;
    let value;
    if (region.kind === "area") {
      const sel = new Set(ids);
      key = "ids";
      value = elements.filter((e) => e && !e.isDeleted && sel.has(e.id)).map((e) => e.id).join(",");
    } else if (region.kind === "group") {
      const detected = detectRegionKind({ elements, ids, selectedGroupIds: app.state?.selectedGroupIds });
      if (detected.kind !== "group") return { error: "Select exactly one group" };
      key = "g";
      value = detected.groupId;
    } else if (region.kind === "frame" || region.kind === "cframe") {
      const detected = detectRegionKind({ elements, ids, selectedGroupIds: app.state?.selectedGroupIds });
      if (detected.kind !== "cframe") return { error: "Select exactly one frame" };
      key = "fr";
      value = detected.frame.id;
    } else {
      const el = ids.length === 1 ? elements.find((e) => e.id === ids[0] && !e.isDeleted) : null;
      if (!el || el.type !== "image") return { error: "Select exactly one image" };
      const fits = region.kind === "rect" ? displayedRect(el, region.f) : displayedPoly(el, region.p);
      if (!fits) return { error: "The region does not fit that image" };
      key = "el";
      value = el.id;
    }
    if (!value || !value.split(",").every(isId)) return { error: "Could not read the selection" };
    const next = tokenReplaced(before, key, value);
    const check = next ? parseRegion(next) : null;
    if (!check?.supported || check.kind !== region.kind || check.drawingUid !== region.drawingUid || check.caption !== region.caption) {
      console.warn("[plexus] geometry update round-trip mismatch");
      return { error: "Could not update region" };
    }
    if (geometryKey(check) === geometryKey(region)) return { same: true };
    return { next, region: check };
  }

  async function writeGeometry(regionUid, app, block, region, next, nextRegion) {
    try {
      await host.updateRegionString(region.drawingUid, regionUid, next, { expect: block.string });
    } catch (error) {
      if (error?.code === "changed" || /changed elsewhere/.test(String(error?.message))) {
        toaster.show("Region changed elsewhere; not updated", { kind: "error" });
      } else {
        console.warn("[plexus] region update failed", error);
        toaster.show("Could not update region, try again", { kind: "error" });
      }
      return false;
    }
    try {
      const svg = await hotSvg(app, nextRegion);
      if (svg) {
        await putSvg(regionUid, nextRegion, svg);
        await warmPng2x(app, regionUid, nextRegion, svg);
      }
    } catch (error) {
      console.warn("[plexus] crop refresh after update failed", error);
    }
    emitChange(regionUid);
    try {
      await refreshRegion?.(regionUid, { purge: false });
    } catch (error) {
      console.warn("[plexus] refresh after update failed", error);
    }
    return true;
  }

  async function applyGeometryUpdate(regionUid, editor, block, region) {
    const r = geometryFromSelection(region, block.string, editor.app);
    if (r.error) {
      toaster.show(r.error, { kind: "error" });
      return false;
    }
    if (r.same) {
      toaster.show("Region already matches the selection");
      return false;
    }
    const ok = await writeGeometry(regionUid, editor.app, block, region, r.next, r.region);
    if (ok) toaster.show("Region updated");
    return ok;
  }

  function readRegion(regionUid) {
    const block = isId(regionUid) ? safe(() => host.pullBlock(regionUid)) : null;
    const region = block ? parseRegion(block.string) : null;
    return { block, region };
  }

  async function updateRegionOnce(regionUid) {
    const { block, region } = readRegion(regionUid);
    if (!region?.supported) {
      toaster.show("Region cannot be updated", { kind: "error" });
      return false;
    }
    if (isImageKind(region.kind)) {
      toaster.show("Image regions cannot be updated from a selection", { kind: "error" });
      return false;
    }
    const editor = native.activeEditor(doc);
    if (editor && editor.drawingUid === region.drawingUid && native.selectedElementIds(editor.app).length) {
      pendingUpdate = null;
      return applyGeometryUpdate(regionUid, editor, block, region);
    }
    await armPending(regionUid, region);
    return false;
  }

  // Opens the drawing with the region's elements selected (when any survive) and waits for the user's new selection.
  async function armPending(regionUid, region) {
    await selectRegionInner(regionUid, { quiet: true });
    if (disposed) return false;
    const editor = native.activeEditor(doc);
    if (!editor || editor.drawingUid !== region.drawingUid) return false;
    pendingUpdate = { uid: regionUid };
    toaster.show("Select the new elements, then right-click → Plexus: Update region from selection");
    return true;
  }

  async function applyPendingOnce() {
    if (!pendingUpdate) return false;
    const { uid } = pendingUpdate;
    const { block, region } = readRegion(uid);
    if (!region?.supported) {
      pendingUpdate = null;
      return false;
    }
    const editor = native.activeEditor(doc);
    if (!editor || editor.drawingUid !== region.drawingUid) {
      pendingUpdate = null;
      toaster.show("Drawing is no longer open", { kind: "error" });
      return false;
    }
    const ok = await applyGeometryUpdate(uid, editor, block, region);
    if (ok && pendingUpdate?.uid === uid) pendingUpdate = null;
    return ok;
  }

  function selectionFor(region, elements) {
    const live = elements.filter((e) => e && !e.isDeleted);
    const has = (id) => live.some((e) => e.id === id);
    let ids = [];
    let groups = {};
    if (region.kind === "area") ids = (region.ids || []).filter(has);
    else if (region.kind === "group") {
      ids = live.filter((e) => Array.isArray(e.groupIds) && e.groupIds.includes(region.groupId)).map((e) => e.id);
      if (ids.length) groups = { [region.groupId]: true };
    } else if (region.kind === "frame" || region.kind === "cframe") ids = has(region.frameId) ? [region.frameId] : [];
    else if (region.kind === "rect" || region.kind === "poly") ids = has(region.el) ? [region.el] : [];
    if (!ids.length) return null;
    const selectedElementIds = {};
    for (const id of ids) selectedElementIds[id] = true;
    return { selectedElementIds, selectedGroupIds: groups };
  }

  async function selectRegionInner(regionUid, { quiet = false } = {}) {
    const { region } = readRegion(regionUid);
    if (!region?.supported || isImageKind(region.kind)) {
      if (!quiet) toaster.show(region?.supported ? "Select on drawing is for drawing regions" : "Region cannot be selected", { kind: "error" });
      return false;
    }
    let editor = native.activeEditor(doc);
    if (!editor || editor.drawingUid !== region.drawingUid) {
      if (!(await openRegionOnce(regionUid, { select: true }))) return false;
      editor = native.activeEditor(doc);
      if (!editor || editor.drawingUid !== region.drawingUid) return false;
    }
    const picked = selectionFor(region, sceneElements(editor.app));
    if (!picked) {
      if (!quiet) toaster.show("Region elements are gone; use Repair region", { kind: "error" });
      return false;
    }
    editor.app.updateScene({ appState: picked });
    return true;
  }

  function selectRegionOnce(regionUid) {
    return selectRegionInner(regionUid);
  }

  async function repairRegionOnce(regionUid) {
    const { block, region } = readRegion(regionUid);
    if (!region?.supported || isImageKind(region.kind)) {
      toaster.show("Region cannot be repaired", { kind: "error" });
      return { fixed: false, reason: "unsupported" };
    }
    const editor = native.activeEditor(doc);
    const mounted = editor && editor.drawingUid === region.drawingUid ? editor : null;
    const drawing = mounted ? null : safe(() => host.drawing(region.drawingUid));
    const elements = mounted ? sceneElements(mounted.app) : drawing?.elements ?? null;
    if (!elements) {
      toaster.show("Drawing not found", { kind: "error" });
      return { fixed: false, reason: "no-drawing" };
    }
    const box = regionSceneBBox(region, elements, mounted ? mounted.app.state : drawing.appState);
    if (!box.error && !(box.missing?.length)) {
      toaster.show("Region looks fine");
      return { fixed: false, reason: "ok" };
    }
    if (region.kind === "area" && !box.error && box.missing.length) {
      const gone = new Set(box.missing);
      const value = region.ids.filter((id) => !gone.has(id)).join(",");
      const next = tokenReplaced(block.string, "ids", value);
      const check = next ? parseRegion(next) : null;
      if (!check?.supported || check.kind !== "area" || check.caption !== region.caption || check.drawingUid !== region.drawingUid) {
        toaster.show("Could not repair region", { kind: "error" });
        return { fixed: false, reason: "mismatch" };
      }
      if (mounted) {
        const ok = await writeGeometry(regionUid, mounted.app, block, region, next, check);
        if (ok) toaster.show("Region repaired");
        return { fixed: ok, reason: ok ? "dropped-missing" : "write-failed" };
      }
      try {
        await host.updateRegionString(region.drawingUid, regionUid, next, { expect: block.string });
      } catch (error) {
        console.warn("[plexus] region repair failed", error);
        toaster.show(error?.code === "changed" ? "Region changed elsewhere; not updated" : "Could not repair region, try again", { kind: "error" });
        return { fixed: false, reason: "write-failed" };
      }
      emitChange(regionUid);
      try { await refreshRegion?.(regionUid); } catch (error) { console.warn("[plexus] refresh after repair failed", error); }
      toaster.show("Region repaired");
      return { fixed: true, reason: "dropped-missing" };
    }
    await armPending(regionUid, region);
    return { fixed: false, reason: "reselect" };
  }

  async function regionsForAllFramesOnce() {
    const editor = native.activeEditor(doc);
    if (!editor) {
      toaster.show("Open a drawing full-screen first", { kind: "error" });
      return null;
    }
    const { app, drawingUid } = editor;
    if (!isId(drawingUid)) {
      toaster.show("Could not identify this drawing", { kind: "error" });
      return null;
    }
    const named = new Set();
    for (const { region } of safe(() => host.regionsOf(drawingUid)) || []) {
      if (region?.supported && (region.kind === "frame" || region.kind === "cframe")) named.add(region.frameId);
    }
    const todo = orderFrames(sceneElements(app)).filter((f) => !named.has(f.id) && isId(f.id));
    if (!todo.length) {
      toaster.show("Every frame already has a region");
      return { created: 0, uids: [] };
    }
    const batch = todo.slice(0, 50);
    const strings = batch.map((f) => serializeRegion({ kind: "cframe", drawingUid, frameId: f.id, caption: String(f.name ?? "").trim() }));
    let uids;
    try {
      uids = await host.createRegions(drawingUid, strings);
    } catch (error) {
      console.warn("[plexus] regions for all frames failed", error);
      toaster.show("Could not create regions, try again", { kind: "error" });
      return null;
    }
    for (const uid of uids) emitChange(uid);
    if (!uids.length) toaster.show("Could not create regions, try again", { kind: "error" });
    else if (uids.length < batch.length) toaster.show(`Created ${uids.length} of ${batch.length} frame regions; run again for the rest`, { kind: "error" });
    else if (todo.length > batch.length) toaster.show("Created 50; run again for the rest");
    else toaster.show(`Created ${uids.length} frame region${uids.length === 1 ? "" : "s"}`);
    return { created: uids.length, uids };
  }

  async function removeElementLinkOnce() {
    const editor = native.activeEditor(doc);
    if (!editor) {
      toaster.show("Open a drawing full-screen first", { kind: "error" });
      return 0;
    }
    const { app, drawingUid } = editor;
    const ids = new Set(native.selectedElementIds(app));
    const linked = sceneElements(app).filter((e) => e && !e.isDeleted && ids.has(e.id) && e.link);
    if (!linked.length) {
      toaster.show("No links on the selection");
      return 0;
    }
    const hit = new Set(linked.map((e) => e.id));
    let ok = false;
    try {
      ok = guard.guardedWrite(app, {
        drawingUid,
        label: "Remove link",
        captureUpdate: "IMMEDIATELY",
        next: (current) => current.map((e) => (hit.has(e.id) ? { ...e, link: null, version: (e.version || 0) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() } : e)),
      });
    } catch (error) {
      console.warn("[plexus] remove link failed", error);
      toaster.show("Could not remove the link", { kind: "error" });
      return 0;
    }
    if (!ok) return 0;
    toaster.show(`Removed ${hit.size} link${hit.size === 1 ? "" : "s"}`);
    return hit.size;
  }


  async function auditRegionsOnce(scope) {
    let pageUid = null;
    if (scope !== "graph") {
      try { pageUid = (await host.openPageUid?.()) ?? null; } catch { pageUid = null; }
      if (!pageUid) {
        toaster.show("Open a page first", { kind: "error" });
        return null;
      }
    }
    let blocks;
    let containers;
    try {
      blocks = host.regionBlocksForAudit(pageUid ? { pageUid } : {});
      containers = host.containersForAudit(pageUid ? { pageUid } : {});
    } catch (error) {
      console.warn("[plexus] region audit query failed", error);
      toaster.show("Could not scan for regions", { kind: "error" });
      return null;
    }
    const containerOf = new Map(containers.map((c) => [c.uid, c]));
    const byDrawing = new Map();
    for (const row of blocks) {
      const region = parseRegion(row.string);
      if (!region) continue;
      const key = region.drawingUid || "";
      if (!byDrawing.has(key)) byDrawing.set(key, []);
      byDrawing.get(key).push({ row, region });
    }
    const out = [];
    let truncated = false;
    let drawings = 0;
    const push = (row, region, problem, detail = "") => {
      out.push({
        uid: row.uid,
        kind: region.kind,
        problem,
        detail,
        drawingUid: region.drawingUid || null,
        label: labelOf(region),
        pageTitle: row.pageTitle ?? null,
        repair: REPAIR_OF[problem] ?? null,
      });
    };
    for (const [drawingUid, list] of byDrawing) {
      if (disposed) return null;
      if (out.length >= AUDIT_ROW_CAP) { truncated = true; break; }
      let target = null;
      let ownerBlock = null;
      const needsTarget = list.some(({ region }) => region.supported);
      if (needsTarget && isId(drawingUid)) {
        ownerBlock = safe(() => host.pullBlock(drawingUid));
        target = ownerBlock && DRAWING_BLOCK_RE.test(ownerBlock.string) ? safe(() => host.drawing(drawingUid)) ?? null : null;
      }
      for (const { row, region } of list) {
        if (out.length >= AUDIT_ROW_CAP) { truncated = true; break; }
        if (!region.supported) { push(row, region, "unsupported", region.error || ""); continue; }
        if (!isContainerString(row.parentString)) { push(row, region, "outside-container"); continue; }
        const container = containerOf.get(row.parentUid);
        if (container && container.ownerUid !== region.drawingUid) { push(row, region, "owner-mismatch", `container is under ${container.ownerUid}`); continue; }
        if (isImageKind(region.kind)) {
          const has = ownerBlock && parseImageRefs(ownerBlock.string).some((r) => r.index === region.i);
          if (!has) push(row, region, ownerBlock ? "no-image" : "no-owner");
          continue;
        }
        if (!ownerBlock || !target) { push(row, region, "no-owner"); continue; }
        const box = regionSceneBBox(region, target.elements, target.appState);
        if (box.error) push(row, region, BOX_PROBLEM[box.error] ?? "no-elements", box.error);
        else if (box.missing?.length) push(row, region, "partial", `missing ${box.missing.join(", ")}`);
      }
      drawings += 1;
      if (drawings % AUDIT_YIELD_EVERY === 0) await sleep(0);
    }
    const perOwner = new Map();
    for (const c of containers) {
      if (!perOwner.has(c.ownerUid)) perOwner.set(c.ownerUid, []);
      perOwner.get(c.ownerUid).push(c);
    }
    for (const c of containers) {
      const isDrawing = DRAWING_BLOCK_RE.test(c.ownerString);
      const hasImages = !isDrawing && parseImageRefs(c.ownerString).length > 0;
      const many = perOwner.get(c.ownerUid).length > 1;
      const problem = many ? "two-containers" : isDrawing || hasImages ? null : "orphan-container";
      if (problem) out.push({ uid: c.uid, kind: "container", problem, detail: many ? `${perOwner.get(c.ownerUid).length} containers on ${c.ownerUid}` : "", drawingUid: c.ownerUid, label: "Region container", pageTitle: c.pageTitle ?? null, repair: null });
    }
    out.sort((a, b) => String(a.pageTitle ?? "").localeCompare(String(b.pageTitle ?? "")) || String(a.drawingUid ?? "").localeCompare(String(b.drawingUid ?? "")) || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
    Object.defineProperty(out, "truncated", { value: truncated, enumerable: false });
    return out;
  }

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
  // Toast-free: { prep } or { message } for the caller to show (or not).
  function cropPrepQuiet(regionUid) {
    const block = isId(regionUid) ? host.pullBlock(regionUid) : null;
    const region = block ? parseRegion(block.string) : null;
    if (!region?.supported) return { message: "Region cannot be copied" };
    const target = resolveRegionTarget(host, region);
    if (target.error) return { message: target.error };
    const gk = geometryKey(region);
    return {
      prep: {
        uid: regionUid,
        region,
        target,
        keys: {
          png: cropKey({ regionUid, geometryKey: gk, drawingHash: target.hash, tier: "png" }),
          svg: target.url ? null : cropKey({ regionUid, geometryKey: gk, drawingHash: target.hash, tier: "svg" }),
          png2x: target.url ? null : cropKey({ regionUid, geometryKey: gk, drawingHash: target.hash, tier: "png2x" }),
        },
      },
    };
  }

  function cropPrep(regionUid) {
    const { prep, message } = cropPrepQuiet(regionUid);
    if (!prep) {
      toaster.show(message, { kind: "error" });
      return null;
    }
    return prep;
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
    return prep ? startPngFor(prep) : null;
  }

  // Toast-free source of a region's PNG (png2x -> svg -> png -> cold); null when the region cannot be rendered.
  function cropSource(regionUid) {
    const { prep } = cropPrepQuiet(regionUid);
    return prep ? startPngFor(prep) : null;
  }

  function startPngFor(prep) {
    const { region, target, keys } = prep;
    const mem2x = keys.png2x ? readEntry(cache.peek?.(keys.png2x)) : null;
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
      const blob2x = await mem2x;
      if (blob2x) return asPng(blob2x);
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
          await warmPng2x(editor.app, regionUid, region, svg);
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

  // ---- embed labels (EMB-6) ----

  function cancelEmbedLabels() {
    labelGen += 1;
    if (labelTimer !== null) clearTimer(labelTimer);
    labelTimer = null;
  }

  function editorBusy(app) {
    const st = app?.state || {};
    if (st.editingTextElement || st.newElement || st.resizingElement || st.multiElement) return true;
    if (st.selectedElementsAreBeingDragged || st.isResizing || st.isRotating || st.cursorButton === "down") return true;
    const edit = safe(() => getEmbedOverlay()?.editState?.());
    return !!edit && edit !== "idle";
  }

  // One synchronous scan; every anchor whose bound text differs from the block's creation label is patched in a single
  // "NEVER" write (not an undo step). Returns how many were rewritten.
  function refreshEmbedLabels(app) {
    const editor = native.activeEditor(doc);
    if (!app || editor?.app !== app || !isId(editor.drawingUid)) return 0;
    const scene = sceneElements(app);
    const byId = new Map(scene.map((el) => [el?.id, el]));
    const patches = new Map();
    for (const anchor of embedAnchors(scene)) {
      const parsed = parseEmbedRef(anchor.customData.plexus.embed);
      if (!parsed || parsed.kind === "today" || parsed.kind === "query") continue;
      const bound = (anchor.boundElements || []).find((b) => b?.type === "text");
      const text = bound ? byId.get(bound.id) : null;
      if (!text || text.isDeleted || text.type !== "text" || text.containerId !== anchor.id) continue;
      let content = null;
      try { content = host.pullEmbedContent(parsed.ref); } catch { content = null; }
      if (!content || typeof content.then === "function") continue;
      const label = embedLabel(taskLabel(content.string || "") || content.string || content.title);
      if (!label || label === (text.originalText ?? text.text)) continue;
      const laid = layoutAnchorLabel({
        label, x: anchor.x, y: anchor.y, width: anchor.width, height: anchor.height,
        fontSize: text.fontSize || 16, lineHeight: text.lineHeight || 1.25,
      });
      patches.set(text.id, { text: laid.text, originalText: laid.originalText, x: laid.x, y: laid.y, width: laid.width, height: laid.height });
    }
    if (!patches.size) return 0;
    const ok = guard.guardedWrite(app, {
      drawingUid: editor.drawingUid,
      label: "Embed labels",
      captureUpdate: "NEVER",
      next: (current) => current.map((el) => (el && patches.has(el.id) ? bumped(el, patches.get(el.id)) : el)),
    });
    return ok ? patches.size : 0;
  }

  // Trailing 1500 ms debounce. Skips (re-arming after 1 s) while the user is mid-gesture or the overlay is editing.
  function scheduleEmbedLabels(app) {
    if (disposed || !app) return;
    cancelEmbedLabels();
    const gen = labelGen;
    const arm = (ms) => {
      labelTimer = setTimer(() => { labelTimer = null; void flush(); }, ms);
    };
    const current = () => !disposed && gen === labelGen;
    const flush = async () => {
      if (!current()) return;
      const editor = native.activeEditor(doc);
      if (editor?.app !== app || !isId(editor.drawingUid)) return;
      if (editorBusy(app)) { arm(LABEL_RETRY_MS); return; }
      if (!labelReady.has(app)) {
        await native.waitNotLoading?.(app, 5000, { doc });
        await frame();
        await frame();
        if (!current() || native.activeEditor(doc)?.app !== app) return;
        labelReady.add(app);
        if (editorBusy(app)) { arm(LABEL_RETRY_MS); return; }
      }
      try {
        refreshEmbedLabels(app);
      } catch (error) {
        console.warn("[plexus] embed label refresh failed", error);
      }
    };
    arm(LABEL_DEBOUNCE_MS);
  }

  // ---- frames (AUTH-8) ----

  function requireEditor() {
    const editor = native.activeEditor(doc);
    if (!editor || !isId(editor.drawingUid)) {
      toaster.show("Open a drawing full-screen first", { kind: "error" });
      return null;
    }
    return editor;
  }

  function sceneViewRect(app) {
    const st = app.state || {};
    const a = viewportToScene({ x: st.offsetLeft || 0, y: st.offsetTop || 0, appState: st });
    const b = viewportToScene({ x: (st.offsetLeft || 0) + (st.width || 0), y: (st.offsetTop || 0) + (st.height || 0), appState: st });
    return { left: a.x, top: a.y, right: b.x, bottom: b.y };
  }

  // Scrolls (never zooms) to the frames only when they are not fully in view.
  function revealFrames(app, frames) {
    if (!frames.length || typeof app.scrollToContent !== "function") return;
    const view = sceneViewRect(app);
    const inside = frames.every((f) => f.x >= view.left && f.y >= view.top && f.x + f.width <= view.right && f.y + f.height <= view.bottom);
    if (inside) return;
    const animate = !!safe(() => motionOk(doc, settingsNow().animation));
    safe(() => app.scrollToContent(frames.length === 1 ? frames[0] : frames, { fitToContent: false, animate }));
  }

  function selectedFrameId() {
    const editor = native.activeEditor(doc);
    if (!editor) return null;
    return selectedFrameOf(sceneElements(editor.app), native.selectedElementIds(editor.app));
  }

  // One write, one undo step: existing frames get orders when needed, new frames are appended and selected.
  function insertFrames(editor, rects, preset, label) {
    const ids = rects.map(() => frameId());
    const selectedElementIds = {};
    for (const id of ids) selectedElementIds[id] = true;
    let created = [];
    const ok = guard.guardedWrite(editor.app, {
      drawingUid: editor.drawingUid,
      label,
      captureUpdate: "IMMEDIATELY",
      next: (current) => {
        const plan = planOrders(current, rects.length);
        created = rects.map((r, i) => ({ ...presetFrame({ id: ids[i], preset, x: r.x, y: r.y, order: plan.orders[i] }), width: r.width, height: r.height }));
        return [...applyOrderRewrite(current, plan.rewrite), ...created];
      },
      appState: { selectedElementIds, selectedGroupIds: {} },
    });
    if (!ok) return null;
    revealFrames(editor.app, created);
    return created;
  }

  function addFrameOnce({ preset = DEFAULT_PRESET, placement = "centre" } = {}) {
    const editor = requireEditor();
    if (!editor) return null;
    const size = presetSize(preset);
    if (!size) {
      toaster.show("Unknown frame size", { kind: "error" });
      return null;
    }
    const slot = placement === "next" ? nextSlideSlot(sceneElements(editor.app)) : null;
    const c = viewCentre(editor.app);
    const rect = slot ? { x: slot.x, y: slot.y, ...size } : { x: c.x - size.width / 2, y: c.y - size.height / 2, ...size };
    const created = insertFrames(editor, [rect], preset, "Add frame");
    if (!created) {
      toaster.show("Could not add the frame", { kind: "error" });
      return null;
    }
    return created[0].id;
  }

  function addFrameLayoutOnce({ kind = "grid", preset = DEFAULT_PRESET } = {}) {
    const editor = requireEditor();
    if (!editor) return null;
    const rects = layoutFrames({ kind, preset, centre: viewCentre(editor.app) });
    if (!rects.length) {
      toaster.show("Unknown frame layout", { kind: "error" });
      return null;
    }
    const created = insertFrames(editor, rects, preset, "Add frames");
    if (!created) {
      toaster.show("Could not add the frames", { kind: "error" });
      return null;
    }
    return created.map((f) => f.id);
  }

  function reformatFrameOnce({ preset = DEFAULT_PRESET } = {}) {
    const editor = requireEditor();
    if (!editor) return null;
    const scene = sceneElements(editor.app);
    const id = selectedFrameOf(scene, native.selectedElementIds(editor.app));
    const target = id ? scene.find((el) => el?.id === id && !el.isDeleted) : null;
    if (!target) {
      toaster.show("Select a frame first", { kind: "error" });
      return null;
    }
    const rect = reformatRect(target, preset);
    if (!rect) {
      toaster.show("Unknown frame size", { kind: "error" });
      return null;
    }
    const released = new Set(childrenOutside(scene, target, rect).map((el) => el.id));
    const ok = guard.guardedWrite(editor.app, {
      drawingUid: editor.drawingUid,
      label: "Reformat frame",
      captureUpdate: "IMMEDIATELY",
      next: (current) => current.map((el) => {
        if (!el) return el;
        if (el.id === id) return bumped(el, rect);
        if (released.has(el.id)) return bumped(el, { frameId: null });
        return el;
      }),
    });
    if (!ok) {
      toaster.show("Could not reformat the frame", { kind: "error" });
      return null;
    }
    if (released.size) toaster.show(`${released.size} element${released.size === 1 ? "" : "s"} left the frame`);
    return id;
  }

  function makeSlideOnce() {
    const editor = requireEditor();
    if (!editor) return null;
    const { app } = editor;
    const scene = sceneElements(app);
    const ids = native.selectedElementIds(app);
    const byId = new Map(scene.map((el) => [el?.id, el]));
    const picked = ids.map((id) => byId.get(id)).filter((el) => el && !el.isDeleted);
    if (!picked.length || picked.some(isFrameEl)) {
      toaster.show("Select elements that are not frames", { kind: "error" });
      return null;
    }
    const before = new Set(scene.filter(isFrameEl).map((el) => el.id));
    const wrap = app.actionManager?.actions?.wrapSelectionInFrame;
    let newFrameId = null;
    if (wrap) {
      try { app.actionManager.executeAction(wrap, "api"); } catch (error) { console.warn("[plexus] wrap in frame failed", error); }
      newFrameId = sceneElements(app).find((el) => isFrameEl(el) && !el.isDeleted && !before.has(el.id))?.id ?? null;
    }
    let resultId = null;
    let ok = false;
    if (wrap && !newFrameId) {
      toaster.show("Could not make a slide", { kind: "error" });
      return null;
    }
    if (newFrameId) {
      ok = guard.guardedWrite(app, {
        drawingUid: editor.drawingUid,
        label: "Make slide",
        captureUpdate: "IMMEDIATELY",
        next: (current) => {
          const frameEl = current.find((el) => el?.id === newFrameId);
          const rest = current.filter((el) => el?.id !== newFrameId);
          const plan = planOrders(rest, 1);
          const named = { ...withOrder(frameEl, plan.orders[0]), name: `Slide ${plan.orders[0]}` };
          // Keep the frame where the action put it in the array; only its fields change.
          return applyOrderRewrite(current, plan.rewrite).map((el) => (el?.id === newFrameId ? named : el));
        },
        appState: { selectedElementIds: { [newFrameId]: true }, selectedGroupIds: {} },
      });
      resultId = newFrameId;
    } else {
      // Fallback: the selection's box plus 16, children adopted in the same write.
      const box = commonBounds(picked);
      const pad = 16;
      const members = new Set(picked.map((el) => el.id));
      const fallbackId = frameId();
      resultId = fallbackId;
      for (const el of scene) if (el && !el.isDeleted && el.containerId && members.has(el.containerId)) members.add(el.id);
      ok = guard.guardedWrite(app, {
        drawingUid: editor.drawingUid,
        label: "Make slide",
        captureUpdate: "IMMEDIATELY",
        next: (current) => {
          const plan = planOrders(current, 1);
          const order = plan.orders[0];
          const frameEl = { ...presetFrame({ id: fallbackId, preset: DEFAULT_PRESET, x: box[0] - pad, y: box[1] - pad, order }), width: box[2] - box[0] + 2 * pad, height: box[3] - box[1] + 2 * pad, name: `Slide ${order}` };
          const adopted = applyOrderRewrite(current, plan.rewrite).map((el) => (el && members.has(el.id) && !isFrameEl(el) ? bumped(el, { frameId: frameEl.id }) : el));
          return [...adopted, frameEl];
        },
        appState: { selectedElementIds: { [fallbackId]: true }, selectedGroupIds: {} },
      });
    }
    if (!ok || !resultId) {
      toaster.show("Could not make a slide", { kind: "error" });
      return null;
    }
    return resultId;
  }

  // ---- shared frame-image pipeline (presenting, printing, PNG export) ----

  async function pngSizeOf(blob) {
    try {
      const bytes = new Uint8Array(await blob.slice(0, 24).arrayBuffer());
      if (bytes.length < 24) return null;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { w: view.getUint32(16), h: view.getUint32(20) };
    } catch {
      return null;
    }
  }

  // Renders the wanted frames one at a time and hands each result to sink(i, result|null). Results are
  // { type: "svg", svg } (mounted, format "svg") or { type: "png", blob, w, h, persist }. Never throws.
  // Mounted png: native 2x, light only, accepted at 2x the frame size +-4 px, else the cold 1x crop.
  async function frameImages({ uid, drawing, mounted, items, format, alive, sink }) {
    const out = { renderFailed: false };
    let coldState;
    const ensureCold = async () => {
      if (coldState !== undefined) return coldState;
      coldState = null;
      if (!drawing) return null;
      try {
        const hasImage = drawing.elements.some((el) => !el.isDeleted && (el.type === "image" || el.fileId));
        coldState = (await cold.renderDrawing(uid, { settleMs: hasImage ? IMAGE_SETTLE_MS : PLAIN_SETTLE_MS })) || null;
      } catch (error) {
        console.warn("[plexus] cold render failed", error);
      }
      if (!coldState) out.renderFailed = true;
      return coldState;
    };
    const cropFrame = async (frame, covers) => {
      const rendered = await ensureCold();
      if (!rendered || !alive()) return null;
      const region = { kind: "cframe", drawingUid: uid, frameId: frame.id, caption: frame.name || "" };
      const box = regionSceneBBox(region, drawing.elements, drawing.appState);
      if (box.error) return null;
      const crop = viewPngCropRect({ elements: drawing.elements, appState: drawing.appState, bbox: box.bbox, naturalWidth: rendered.naturalWidth, naturalHeight: rendered.naturalHeight });
      if (crop.error) return null;
      const blob = await cropCanvasToBlob(rendered.canvas, crop, { doc, covers });
      return { type: "png", blob, w: crop.sw, h: crop.sh, persist: rendered.settled !== false };
    };
    const native2x = async (frame) => {
      if (typeof native.captureSelectionPng !== "function") return null;
      try {
        const blob = await native.captureSelectionPng(mounted.app, [frame.id], { scale: 2, dark: false });
        if (!blob) return null;
        const size = await pngSizeOf(blob);
        if (!size || Math.abs(size.w - 2 * frame.width) > 4 || Math.abs(size.h - 2 * frame.height) > 4) return null;
        return { type: "png", blob, w: size.w / 2, h: size.h / 2, persist: false };
      } catch (error) {
        console.warn("[plexus] frame png2x failed", error);
        return null;
      }
    };
    for (const item of items) {
      const { frame, i } = item;
      if (!alive()) break;
      let result = null;
      const live = mounted && native.activeEditor(doc)?.app === mounted.app;
      try {
        if (live && format === "svg" && item.ids?.length !== 0) {
          const ids = item.ids?.length ? item.ids : [frame.id];
          const svg = await captureSafe(mounted.app, ids);
          result = svg ? { type: "svg", svg: normalizeSvgSize(svg) } : null;
        } else if (live && item.ids?.length !== 0 && !item.covers?.length) {
          result = (await native2x(frame)) ?? (await cropFrame(frame, item.covers));
        } else {
          result = await cropFrame(frame, item.covers);
        }
      } catch (error) {
        console.warn("[plexus] frame render failed", error);
        result = null;
      }
      if (!alive()) break;
      await sink(i, result);
    }
    return out;
  }

  // ---- presenting ----

  function laserNow() {
    const s = settingsNow();
    const color = typeof s.laserColor === "string" && /^#[0-9a-f]{6}$/i.test(s.laserColor.trim()) ? s.laserColor.trim().toLowerCase() : "#e03131";
    const n = Number(s.laserDecay);
    return { color, decay: Number.isFinite(n) ? Math.min(3000, Math.max(300, n)) : 1000 };
  }

  // Owned object URLs for one deck: revoked on close and on dispose(), never the cache's own URLs.
  function urlBag() {
    const held = new Set();
    let gone = false;
    const revoke = () => {
      gone = true;
      for (const url of held) safe(() => urls.revokeObjectURL(url));
      held.clear();
      revokers.delete(revoke);
    };
    revokers.add(revoke);
    return {
      make(blob) {
        if (gone) return null;
        const url = urls.createObjectURL(blob);
        held.add(url);
        return url;
      },
      revoke,
    };
  }

  function notesFor(regions, frameId) {
    const cands = regions
      .filter((r) => r?.region?.supported && (r.region.kind === "cframe" || r.region.kind === "frame") && r.region.frameId === frameId)
      .sort((a, b) => KIND_RANK[a.region.kind] - KIND_RANK[b.region.kind]);
    const kids = (r) => safe(() => host.pullBlock?.(r.uid)?.children?.length) || 0;
    return cands.find((r) => kids(r) > 0) ?? cands[0] ?? null;
  }

  // Idempotent: re-reads the notes first, so a second press (or a note written meanwhile) adds nothing. No toasts:
  // the presenter is open while this runs.
  function addNotesForFrame(drawingUid, frame, added) {
    return once(`notes:${drawingUid}:${frame.id}`, async () => {
      try {
        const regions = safe(() => host.regionsOf?.(drawingUid)) ?? [];
        const found = notesFor(regions, frame.id);
        let regionUid = found?.uid ?? null;
        if (regionUid) {
          const kids = safe(() => host.pullBlock?.(regionUid)?.children) ?? [];
          if (kids.length) return { regionUid, childUid: kids[0].uid };
        } else {
          regionUid = await host.createRegion(drawingUid, serializeRegion({ kind: "cframe", drawingUid, frameId: frame.id, caption: String(frame.name ?? "").trim() }));
        }
        const childUid = await host.createBlock({ parentUid: regionUid, string: "" });
        emitChange(regionUid);
        added.push(regionUid);
        return { regionUid, childUid };
      } catch (error) {
        console.warn("[plexus] add notes failed", error);
        return null;
      }
    });
  }

  function afterPresent(added) {
    if (!added.length || disposed) return;
    if (!native.activeEditor(doc)) {
      safe(() => host.openBlock?.(added[0], { sidebar: true }));
    } else {
      toaster.show("Notes added: Outline › regions");
    }
  }

  async function presentOnce(requestedUid, release, { from = "start", at } = {}) {
    const editor = native.activeEditor(doc);
    const uid = requestedUid || editor?.drawingUid;
    if (!isId(uid) || !presenter) {
      toaster.show("Could not identify this drawing", { kind: "error" });
      return null;
    }
    const mounted = editor && editor.drawingUid === uid ? editor : null;
    const drawing = host.drawing(uid);
    const elements = mounted ? sceneElements(mounted.app) : drawing?.elements ?? [];
    const frames = orderFrames(elements);
    if (!frames.length) {
      toaster.show("No frames in this drawing", { kind: "error" });
      return null;
    }
    if (!drawing) {
      toaster.show("Drawing not found", { kind: "error" });
      return null;
    }
    // Where to start (A9). "here" needs the mounted drawing; an unknown frame id starts at 0 with a notice.
    let start = 0;
    let startNotice = null;
    if (from === "here") {
      if (mounted) {
        const scene = sceneElements(mounted.app);
        const pick = (Number.isFinite(at?.x) && Number.isFinite(at?.y) ? frameAt(frames, at) : null)
          ?? frames.find((f) => f.id === selectedFrameOf(scene, native.selectedElementIds(mounted.app)))
          ?? nearestFrame(frames, viewCentre(mounted.app));
        start = Math.max(0, frames.indexOf(pick));
      }
    } else if (from !== "start" && from != null) {
      const at0 = frames.findIndex((f) => f.id === from);
      if (at0 >= 0) start = at0;
      else startNotice = "That frame was not found; starting at the first slide";
    }
    // Mounted slides are captured from the live scene, so key them on the live scene, not the last saved hash.
    const slideHash = mounted ? fnv1a(JSON.stringify(sceneElements(mounted.app))) : drawing.hash;
    const regions = safe(() => host.regionsOf?.(uid)) ?? [];
    const added = [];
    const slides = [];
    frames.forEach((frame, idx) => {
      const top = maxBuild(elements, frame);
      const stepped = top > 0;
      const region = { kind: "cframe", drawingUid: uid, frameId: frame.id, caption: frame.name || "" };
      const gk = geometryKey(region);
      const found = notesFor(regions, frame.id);
      const hasKids = !!found && (safe(() => host.pullBlock?.(found.uid)?.children?.length) || 0) > 0;
      const box = elementBounds(frame);
      const base = frame.name || `Frame ${idx + 1}`;
      for (let build = 0; build <= top; build++) {
        slides.push({
          frame,
          build,
          ids: stepped ? idsForBuild(elements, frame, build) : null,
          covers: stepped ? coverBoxes(elements, hiddenIds(elements, frame, build), box) : null,
          name: stepped ? `${base} ${build + 1}/${top + 1}` : base,
          url: null,
          notes: {
            rootUid: found?.uid ?? null,
            ...(build === 0 && !hasKids ? { onAdd: () => addNotesForFrame(uid, frame, added) } : {}),
          },
          svgKey: cropKey({ regionUid: `slide:${uid}:${frame.id}`, geometryKey: gk, drawingHash: slideHash, tier: buildTier(build, stepped, "svg") }),
          pngKey: cropKey({ regionUid: `slide:${uid}:${frame.id}`, geometryKey: gk, drawingHash: slideHash, tier: buildTier(build, stepped, "png") }),
        });
      }
    });
    const openAt = Math.max(0, slides.findIndex((s) => s.frame === frames[start] && s.build === 0));
    // Whatever is already cached opens immediately; the rest fills in behind it.
    for (const slide of slides) {
      const entry = (mounted ? cache.peek?.(slide.svgKey) : null) || cache.peek?.(slide.pngKey) || cache.peek?.(slide.svgKey);
      slide.url = entry?.url ?? null;
    }
    const handle = presenter.open({
      slides: slides.map(({ name, url, notes }) => ({ name, url, notes })),
      index: openAt,
      onClose: () => { release?.(); afterPresent(added); },
      laser: laserNow(),
    });
    const notice = (text) => { if (handle.isOpen()) safe(() => handle.notice?.(text)); };
    if (startNotice) notice(startNotice);
    const missing = slides.map((s, i) => [s, i]).filter(([s]) => !s.url);
    if (!missing.length) return uid;
    const fail = (i) => { if (handle.isOpen()) handle.setSlide(i, { error: true }); };
    const fill = (i, entry) => { if (entry?.url && handle.isOpen()) handle.setSlide(i, { url: entry.url }); };
    // From the start slide forward, then the ones before it.
    const rank = (i) => (i >= openAt ? i - openAt : slides.length + i);
    const items = missing.sort((a, b) => rank(a[1]) - rank(b[1])).map(([slide, i]) => ({ frame: slide.frame, i, ids: slide.ids, covers: slide.covers }));
    try {
      const result = await frameImages({
        uid, drawing, mounted, items, format: "svg",
        alive: () => !disposed && handle.isOpen(),
        sink: async (i, r) => {
          const slide = slides[i];
          if (!r) { fail(i); return; }
          if (r.type === "svg") {
            await cache.put(slide.svgKey, new Blob([r.svg], { type: "image/svg+xml" }), svgSize(r.svg));
            fill(i, cache.peek?.(slide.svgKey) || (await cache.get(slide.svgKey)));
          } else {
            await cache.put(slide.pngKey, r.blob, { w: r.w, h: r.h, persist: r.persist });
            fill(i, cache.peek?.(slide.pngKey) || (await cache.get(slide.pngKey)));
          }
        },
      });
      if (result.renderFailed) notice("Could not render this drawing");
    } catch (error) {
      console.warn("[plexus] present fill failed", error);
      for (const [slide, i] of missing) if (!cache.peek?.(slide.svgKey) && !cache.peek?.(slide.pngKey)) fail(i);
    }
    return uid;
  }

  // Outline deck: each child of the block that is a region ref (bare or the copyAlias form) is a slide.
  async function presentOutlineOnce(blockUid, release, { start: startIndex = 0 } = {}) {
    if (!isId(blockUid) || !presenter) {
      toaster.show("Could not identify this block", { kind: "error" });
      return null;
    }
    const block = safe(() => host.pullBlock(blockUid));
    const uidOf = (text) => {
      for (const re of OUTLINE_REF_RES) {
        const m = re.exec(String(text ?? "").trim());
        if (m) return m[1];
      }
      return null;
    };
    const kids = (block?.children ?? []).map((c) => ({ childUid: c.uid, regionUid: uidOf(c.string) }));
    const refs = kids.filter((k) => k.regionUid).slice(0, PRESENT_CAP);
    const slides = [];
    let skipped = kids.length - kids.filter((k) => k.regionUid).length;
    for (const { childUid, regionUid } of refs) {
      const { prep } = cropPrepQuiet(regionUid);
      if (!prep) { skipped += 1; continue; }
      slides.push({ regionUid, prep, notes: isId(childUid) ? { rootUid: childUid } : undefined, name: stripBrackets(labelOf(prep.region)) || `Slide ${slides.length + 1}`, url: null });
    }
    if (!slides.length) {
      toaster.show("No region refs under this block", { kind: "error" });
      return null;
    }
    const bag = urlBag();
    const handle = presenter.open({
      slides: slides.map(({ name, url, notes }) => ({ name, url, notes })),
      index: Math.min(Math.max(0, startIndex), slides.length - 1),
      onClose: () => { bag.revoke(); release?.(); },
      laser: laserNow(),
    });
    const notice = (text) => { if (handle.isOpen()) safe(() => handle.notice?.(text)); };
    if (skipped) notice(`Skipped ${skipped} child${skipped === 1 ? "" : "ren"} that cannot be presented`);
    const begin = Math.min(Math.max(0, startIndex), slides.length - 1);
    const rank = (i) => (i >= begin ? i - begin : slides.length + i);
    const order = slides.map((_, i) => i).sort((a, b) => rank(a) - rank(b));
    try {
      for (const i of order) {
        if (disposed || !handle.isOpen()) break;
        try {
          const blob = await startPngFor(slides[i].prep).promise;
          if (disposed || !handle.isOpen()) break;
          const url = bag.make(blob);
          if (url) handle.setSlide(i, { url });
        } catch (error) {
          console.warn("[plexus] outline slide failed", slides[i].regionUid, error);
          if (handle.isOpen()) handle.setSlide(i, { error: true });
        }
      }
    } finally {
      if (!handle.isOpen()) bag.revoke();
    }
    return blockUid;
  }

  async function runPresent(fn) {
    if (presentOwner) return null;
    const token = {};
    presentOwner = token;
    const release = () => { if (presentOwner === token) presentOwner = null; };
    try {
      return await fn(release);
    } finally {
      release();
    }
  }

  // ---- print / PNG per frame ----

  function printSettings() {
    const s = settingsNow();
    const size = PRINT_SIZES.includes(String(s.printSize).toLowerCase()) ? String(s.printSize).toLowerCase() : "letter";
    const n = Number(s.printMargin);
    return { size, margin: Number.isFinite(n) ? Math.min(30, Math.max(0, n)) : 10 };
  }

  async function printFramesOnce({ drawingUid, size, margin, mode = "print" } = {}) {
    const editor = native.activeEditor(doc);
    const uid = isId(drawingUid) ? drawingUid : editor?.drawingUid;
    if (!isId(uid)) {
      toaster.show("Open a drawing or pick a drawing block", { kind: "error" });
      return null;
    }
    const mounted = editor && editor.drawingUid === uid ? editor : null;
    const drawing = safe(() => host.drawing(uid));
    let frames = orderFrames(mounted ? sceneElements(mounted.app) : drawing?.elements ?? []);
    if (!drawing && !mounted) {
      toaster.show("Drawing not found", { kind: "error" });
      return null;
    }
    if (!frames.length) {
      toaster.show("No frames in this drawing", { kind: "error" });
      return null;
    }
    if (frames.length > PRINT_CAP) {
      toaster.show(`Using the first ${PRINT_CAP} of ${frames.length} frames`);
      frames = frames.slice(0, PRINT_CAP);
    }
    const defaults = printSettings();
    const pageSize = PRINT_SIZES.includes(String(size).toLowerCase()) ? String(size).toLowerCase() : defaults.size;
    const pageMargin = Number.isFinite(Number(margin)) && margin !== null && margin !== undefined ? Math.min(40, Math.max(0, Number(margin))) : defaults.margin;
    toaster.show(`Preparing ${frames.length} page${frames.length === 1 ? "" : "s"}…`);
    const bag = urlBag();
    const job = { dispose: () => { bag.revoke(); safe(() => active?.dispose?.()); } };
    let active = null;
    printJob = job;
    const pages = [];
    try {
      const src = safe(() => host.labelSource?.(uid)) ?? { string: "", pageTitle: null };
      const title = safe(() => drawingTitleOf(src.string, src.pageTitle)) || "Drawing";
      const result = await frameImages({
        uid, drawing, mounted, format: "png",
        items: frames.map((frame, i) => ({ frame, i })),
        alive: () => !disposed && printJob === job,
        sink: async (i, r) => {
          if (!r || r.type !== "png") return;
          const url = mode === "png" ? null : bag.make(r.blob);
          if (mode === "png" || url) pages.push({ blob: r.blob, url, name: frames[i].name || `Frame ${i + 1}`, index: i, width: r.w, height: r.h });
        },
      });
      if (disposed || printJob !== job) return null;
      if (!pages.length) {
        toaster.show(result.renderFailed ? "Could not render this drawing" : "Could not render any frame", { kind: "error" });
        return null;
      }
      if (pages.length < frames.length) toaster.show(`${frames.length - pages.length} frame${frames.length - pages.length === 1 ? "" : "s"} could not be rendered`, { kind: "error" });
      if (mode === "png") {
        active = printKit.downloadPngs({ doc, drawing: title, frames: pages.map(({ blob, name, index }) => ({ blob, name, index })), total: frames.length });
      } else {
        active = printKit.printPages({ doc, drawing: title, pages, size: pageSize, margin: pageMargin, print: printWin });
      }
      await active?.done;
      return { pages: pages.length, mode };
    } catch (error) {
      console.warn("[plexus] print failed", error);
      if (!disposed) toaster.show(mode === "png" ? "Could not export the frames" : "Could not print the frames", { kind: "error" });
      return null;
    } finally {
      bag.revoke();
      if (printJob === job) printJob = null;
    }
  }

  function findRenderedImage(blockUid, index = 0) {
    for (const el of doc.querySelectorAll('[id^="block-input-"]')) {
      if (!el.id.endsWith(blockUid) || el.closest?.(".plexus-offscreen") || el.closest?.(".plexus-dock")) continue;
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
    if (!ref || ref.kind !== "block") {
      toaster.show(ref?.kind === "today" ? "Today embeds are read-only" : "Page embeds are read-only for now");
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

  // Marks the selected embed anchor and its bound text deleted. No Roam block write.
  function removeSelectedEmbed() {
    const editor = native.activeEditor(doc);
    const anchor = editor?.app ? selectedAnchor(editor.app) : null;
    if (!anchor) return false;
    const current = editor.app.getSceneElementsIncludingDeleted?.() ?? sceneElements(editor.app);
    const ids = new Set([anchor.id]);
    for (const el of current) if (el && el.containerId === anchor.id) ids.add(el.id);
    for (const id of ids) leaveSilenced.add(id);
    let ok = false;
    try {
      ok = guard.guardedWrite(editor.app, {
        drawingUid: editor.drawingUid,
        label: "Remove embed",
        captureUpdate: "IMMEDIATELY",
        next: (cur) => cur.map((el) => (el && ids.has(el.id) && !el.isDeleted ? { ...el, isDeleted: true, version: (el.version || 0) + 1, versionNonce: rnd(), updated: Date.now() } : el)),
      }) === true;
    } catch (error) {
      console.warn("[plexus] remove embed failed", error);
      ok = false;
    }
    if (!ok) {
      for (const id of ids) leaveSilenced.delete(id);
      return false;
    }
    toaster.show(REMOVED_TOAST);
    return true;
  }

  function blockCite(ref) {
    const text = typeof ref === "string" ? ref : (ref && typeof ref === "object" ? (ref.ref || ref.uid || "") : "");
    const parsed = parseEmbedRef(text);
    if (!parsed || parsed.kind !== "block") return null;
    return parsed.ref;
  }

  function citedLabel(cite) {
    const uid = parseEmbedRef(cite)?.uid;
    const textOf = (value) => {
      if (value == null || typeof value.then === "function") return "";
      if (typeof value === "string") return embedLabel(value);
      if (typeof value === "object") return embedLabel(value.string || value.title || "");
      return "";
    };
    for (const read of [
      () => host.pullEmbedContent?.(cite),
      () => host.pullBlock?.(uid),
      () => host.labelSource?.(uid),
    ]) {
      try {
        const label = textOf(read());
        if (label) return label;
      } catch { /* a failed read still inserts the anchor */ }
    }
    return "";
  }

  // One embed beside bbox. elementId is the citing element and is not bound; no arrow and no block write.
  function addCitedEmbed({ elementId, bbox, ref } = {}) {
    const editor = requireEditor();
    if (!editor) return false;
    const cite = blockCite(ref);
    if (!cite || !Array.isArray(bbox) || !Number.isFinite(bbox[1]) || !Number.isFinite(bbox[2])) return false;
    const elements = makeEmbedAnchor({ ref: cite, link: cite, label: citedLabel(cite), x: bbox[2] + 16, y: bbox[1] });
    void elementId;
    try {
      return insertGuarded(editor.app, editor.drawingUid, elements, "Embed") === true;
    } catch (error) {
      console.warn("[plexus] cited embed failed", error);
      return false;
    }
  }

  // After start, one toast when a live embed anchor disappears, or a listed frame/cframe anchor becomes deleted.
  function installAnchorLeaveWatch(app, drawingUid) {
    if (!app || disposed) return () => {};
    const seenEmbed = new Set();
    const seenFrame = new Set();
    const toasted = new Set();
    let stopped = false;
    let started = false;
    let off = null;

    const readElements = () => {
      try {
        const els = app.getSceneElementsIncludingDeleted?.() ?? app.getSceneElements?.() ?? [];
        return Array.isArray(els) ? els : [];
      } catch (error) {
        console.warn("[plexus] anchor leave watch failed", error);
        return null;
      }
    };

    const listedFrameIds = () => {
      const ids = new Set();
      const entries = safe(() => host.regionsOf?.(drawingUid)) || [];
      for (const entry of entries) {
        const region = entry?.region;
        if (!region || (region.kind !== "frame" && region.kind !== "cframe")) continue;
        if (typeof region.frameId === "string" && region.frameId) ids.add(region.frameId);
      }
      return ids;
    };

    const scan = () => {
      if (stopped || disposed) return;
      const elements = readElements();
      if (!elements) return;
      const byId = new Map();
      for (const el of elements) if (el?.id) byId.set(el.id, el);
      const liveEmbed = new Set(embedAnchors(elements).map((el) => el.id));
      const listed = listedFrameIds();
      const liveFrame = new Set();
      for (const id of listed) {
        const el = byId.get(id);
        if (el && !el.isDeleted) liveFrame.add(id);
      }
      if (!started) {
        for (const id of liveEmbed) seenEmbed.add(id);
        for (const id of liveFrame) seenFrame.add(id);
        started = true;
        return;
      }
      for (const id of liveEmbed) seenEmbed.add(id);
      for (const id of liveFrame) seenFrame.add(id);
      let hit = false;
      const depart = (id) => {
        if (toasted.has(id) || leaveSilenced.has(id)) return;
        toasted.add(id);
        hit = true;
      };
      for (const id of seenEmbed) {
        const el = byId.get(id);
        if (!el || el.isDeleted) depart(id);
      }
      for (const id of seenFrame) {
        if (!listed.has(id)) continue;
        const el = byId.get(id);
        if (!el || el.isDeleted) depart(id);
      }
      if (!hit) return;
      try { toaster.show(REMOVED_TOAST); } catch (error) { console.warn("[plexus] anchor leave watch failed", error); }
    };

    scan();
    try {
      const unsub = app.onChangeEmitter?.on?.(() => {
        try { scan(); } catch (error) { console.warn("[plexus] anchor leave watch failed", error); }
      });
      if (typeof unsub === "function") off = unsub;
    } catch (error) {
      console.warn("[plexus] anchor leave watch failed", error);
    }

    const stop = () => {
      if (stopped) return;
      stopped = true;
      leaveWatches.delete(stop);
      try { off?.(); } catch (error) { console.warn("[plexus] unsubscribe failed", error); }
      off = null;
    };
    leaveWatches.add(stop);
    return stop;
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

  // placeholder: an empty drawing shows "Click to start editing" and may have no fullscreen icon; click that instead.
  // quiet: no toasts (the caller reports).
  async function openDrawingOnce(uid, { sidebar = false, reuseIcon = false, placeholder = false, quiet = false } = {}) {
    const note = (message) => { if (!quiet) toaster.show(message, { kind: "error" }); };
    const matches = () => {
      const ed = native.activeEditor(doc);
      return ed && ed.drawingUid === uid ? ed : null;
    };
    const findIcon = () => {
      for (const el of doc.querySelectorAll('[id^="block-input-"]')) {
        if (!el.id.endsWith(uid) || el.closest?.(".plexus-offscreen") || el.closest?.(".plexus-dock")) continue;
        const found = el.querySelector(".excalidraw-outer-container .bp3-icon-fullscreen")
          ?? (placeholder ? el.querySelector(".excalidraw-container > div") : null);
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
        note("Could not open drawing");
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
    if (!editor && !disposed) note("Drawing did not open");
    return editor || null;
  }

  async function openRegionOnce(regionUid, { sidebar = false, select = false } = {}) {
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
        if (!el.id.endsWith(uid) || el.closest?.(".plexus-offscreen") || el.closest?.(".plexus-dock")) continue;
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
    await native.waitNotLoading?.(app, 5000, { doc });
    await frame();
    await frame();
    if (disposed || native.activeEditor(doc)?.app !== app) return null;
    const box = regionSceneBBox(region, sceneElements(app), app.state);
    if (box.error) {
      if (select) return uid;
      toaster.show(`Region unavailable (${box.error})`, { kind: "error" });
      return null;
    }
    const settings = settingsNow();
    const maxZoom = Number.isFinite(Number(settings.zoomCap)) && Number(settings.zoomCap) > 0 ? Number(settings.zoomCap) : 1;
    const animate = !!safe(() => motionOk(doc, settings.animation));
    const hist = safe(() => viewHistory(app));
    const sizeBefore = safe(() => hist?.size?.()) ?? 0;
    safe(() => hist?.push(app));
    let moved = null;
    try {
      moved = await cameraTo.animateTo(app, box.bbox, { maxZoom, animate, doc });
    } catch (error) {
      console.warn("[plexus] camera move failed", error);
    }
    // Already framed: the pushed entry equals the current view, so drop it rather than leave a no-op Back.
    if (!moved?.moved && hist && (safe(() => hist.size()) ?? 0) > sizeBefore) safe(() => hist.discard?.());
    if (disposed) return null;
    if (select || moved?.aborted) return uid;
    stopSpotlight?.();
    stopSpotlight = spotlight({ rect: native.viewportRectOf(app, box.bbox), doc, motion: animate }) || null;
    return uid;
  }
}
