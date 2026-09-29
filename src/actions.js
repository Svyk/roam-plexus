import { DEFAULT_PAD, geometryKey, isId, parseRegion, serializeRegion } from "./model/region.js";
import { commonBounds, regionSceneBBox, cropSvgToFraction, normalizeSvgSize, viewPngCropRect, viewportToScene } from "./model/scene.js";
import { embedAnchors, embedLabel, makeEmbedAnchor, parseEmbedRef } from "./model/embeds.js";
import { LEGACY_QUERY, isLegacyDrawingString, legacyReport, legacySummary, legacyToElements, parseLegacyDrawing, rowsFromQuery } from "./model/legacy.js";
import { orderFrames } from "./model/slides.js";
import { captionFromElements } from "./model/caption.js";
import { clipSvgToPolygon, parseImageRefs, polyBBox, polyToLocal, simplifyPoly, thumbnailSize } from "./model/image.js";
import { isExcludedString } from "./model/mindmap.js";
import { fnv1a } from "./model/hash.js";
import { cropKey } from "./host/cache.js";
import { lockName, withLock } from "./host/locks.js";
import { cropCanvasToBlob } from "./host/cold-render.js";
import { clearImageMemo, loadImageBitmap } from "./host/image-source.js";
import { startImageRegionTool } from "./view/image-region-tool.js";
import { createLegacyDialog } from "./view/legacy-dialog.js";
import { IMAGE_SETTLE_MS, PLAIN_SETTLE_MS, displayedPoly, displayedRect, displayedToNatural, isImageKind, renderRegionCrop, resolveRegionTarget } from "./view/regionref.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  createDialog = createLegacyDialog,
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
  let migrating = false;

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

  const croppedImage = (app) => {
    const ids = native.selectedElementIds(app);
    if (ids.length !== 1) return null;
    const el = sceneElements(app).find((e) => e.id === ids[0] && !e.isDeleted);
    return el && el.type === "image" && validCrop(el.crop) ? el : null;
  };

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
      stopSpotlight?.();
      stopSpotlight = null;
      legacyDialog?.dispose();
      legacyDialog = null;
    },

    // The drawing image tool is bound to the mounted editor; cancel it when that editor goes away.
    cancelDrawingTool() {
      if (activeToolIsDrawing) activeTool?.cancel?.();
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
      if (detected.kind === "cframe") {
        const { frame, children } = detected;
        const caption = captionFromElements(elements, children.map((el) => el.id)) || frame.name || "Frame";
        region = { kind: "cframe", drawingUid, frameId: frame.id, caption };
      } else if (detected.kind === "group") {
        const caption = captionFromElements(elements, detected.members.map((el) => el.id)) || "Region";
        region = { kind: "group", drawingUid, groupId: detected.groupId, pad: DEFAULT_PAD, caption };
      } else {
        const caption = captionFromElements(elements, ids) || "Region";
        region = { kind: "area", drawingUid, ids, pad: DEFAULT_PAD, caption };
      }
      return finishCreate(region, await hotSvg(app, region));
    }),

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
      const caption = captionFromElements(elements, children.map((el) => el.id)) || frame.name || "Frame";
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
      let region;
      picked = displayedToNatural(element, picked);
      if (Array.isArray(picked)) {
        region = { kind: "rect", drawingUid, el: element.id, f: picked, caption: "Image region" };
      } else {
        const p = simplifyPoly(picked.p);
        if (!p || !polyBBox(p)) return null;
        region = { kind: "poly", drawingUid, el: element.id, p, caption: "Image region" };
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
      const region = { kind: "rect", drawingUid, el: element.id, f: cropToFraction(element.crop), caption: "Image crop" };
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
      let region;
      if (Array.isArray(picked)) {
        region = { kind: "imgrect", drawingUid: blockUid, i: ref.index, f: picked, caption: "Image region" };
      } else {
        const p = simplifyPoly(picked.p);
        if (!p || !polyBBox(p)) return null;
        region = { kind: "imgpoly", drawingUid: blockUid, i: ref.index, p, caption: "Image region" };
      }
      return finishWith(region, async (uid) => {
        const target = { url: ref.url, hash: fnv1a(ref.url) };
        const rendered = await renderRegionCrop({ region, target, cold, doc, api, loadBitmap });
        if (rendered.error) return;
        const key = cropKey({ regionUid: uid, geometryKey: geometryKey(region), drawingHash: target.hash, tier: "png" });
        await cache.put(key, rendered.blob, { w: rendered.w, h: rendered.h });
      });
    }),

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
      let count = 0;
      for (const { uid, region } of host.regionsOf(editor.drawingUid)) {
        if (disposed || native.activeEditor(doc)?.app !== editor.app) break;
        if (!region?.supported) continue;
        try {
          if (isImageKind(region.kind)) continue;
          const svg = await hotSvg(editor.app, region);
          if (!svg) continue;
          await putSvg(uid, region, svg);
          count += 1;
        } catch (error) {
          console.warn("[plexus] refresh failed", uid, error);
        }
      }
      toaster.show(`Refreshed ${count} crop${count === 1 ? "" : "s"}`);
      return count;
    },

    async clearCache() {
      clearImageMemo();
      await cache.clear();
      toaster.show("Crop cache cleared");
    },
  };

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
      const region = { kind: "cframe", drawingUid: uid, frameId: frame.id, caption: frame.name || "Frame" };
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
    native.zoomTo(app, box.bbox);
    await sleep(60);
    if (disposed) return null;
    stopSpotlight?.();
    stopSpotlight = spotlight({ rect: native.viewportRectOf(app, box.bbox), doc }) || null;
    return uid;
  }
}
