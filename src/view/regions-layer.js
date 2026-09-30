import * as defaultNative from "../host/native.js";
import { KIND_WORDS, isImageKind, plainCaption } from "../model/label.js";
import { liveElements, regionSceneBBox } from "../model/scene.js";
import { regionMatchesTag } from "./regionref.js";

export const REGION_LAYER_CAP = 150;
const REGION_REFETCH_MS = 3000;
const CHIP_HEIGHT = 20;
const SVG_NS = "http://www.w3.org/2000/svg";
const CHIP_ABOVE = "scale(var(--plexus-inv-zoom)) translateY(-100%)";
const CHIP_INSIDE = "scale(var(--plexus-inv-zoom)) translateY(2px)";
const CHIP_MAX_TEXT = 32;
const P95_EVERY = 120;
const DRAWN_KINDS = new Set(["area", "group", "frame", "cframe", "rect", "poly"]);
const GESTURE_KEYS = ["newElement", "resizingElement", "isResizing", "isRotating", "editingTextElement", "selectedElementsAreBeingDragged"];
const OVERLAY_KEYS = ["contextMenu", "openDialog", "openMenu", "openPopup"];

const cutChip = (text) => (text.length <= CHIP_MAX_TEXT ? text : `${text.slice(0, CHIP_MAX_TEXT - 1).trimEnd()}…`);

export function createRegionsLayer({
  doc,
  app,
  containerEl,
  host,
  drawingUid,
  native = defaultNative,
  zIndex = 1000,
  labelOf = () => "Region",
  onSelect = () => {},
  onOpenSidebar = () => {},
  debug = false,
  raf,
  caf,
  now = () => Date.now(),
  clock = () => (typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now()),
}) {
  const view = doc.defaultView;
  const requestFrame = raf ?? ((cb) => (typeof view?.requestAnimationFrame === "function" ? view.requestAnimationFrame(cb) : setTimeout(cb, 16)));
  const cancelFrame = caf ?? ((id) => (typeof view?.cancelAnimationFrame === "function" ? view.cancelAnimationFrame(id) : clearTimeout(id)));
  const debugOn = () => (typeof debug === "function" ? !!debug() : !!debug);
  const warn = (message, error) => console.warn("[plexus]", message, error);

  let root = null;
  let stage = null;
  let svg = null;
  let rootKey = "";
  let stageKey = "";
  let svgKey = "";
  let lastZoom = NaN;
  let chipsDirty = true;
  let items = new Map();
  let regions = [];
  let regionsAt = -Infinity;
  let regionSig = "";
  let sceneSig = null;
  let unsubscribe = null;
  let pendingFrame = null;
  let coverHidden = false;
  let dark = null;
  let capLogged = false;
  let samples = [];
  let disposed = false;
  let filterTag = "";
  let onFilterKey = null;

  const isVisible = () => root != null;

  const resolveBlock = (uid) => host?.labelSource?.(uid)?.string ?? "";

  function fetchRegions() {
    try {
      regions = host.regionsOf(drawingUid) ?? [];
    } catch (error) {
      warn("regions layer regions failed", error);
      regions = [];
    }
    regionsAt = now();
    const sig = regions.map((r) => `${r.uid}\u0000${r.string}`).join("\u0001");
    const changed = sig !== regionSig;
    regionSig = sig;
    return changed;
  }

  function sceneSignature() {
    const nonce = app.scene?.getSceneNonce?.();
    if (nonce != null) return `n${nonce}`;
    const elements = app.getSceneElementsIncludingDeleted?.() ?? [];
    let sum = elements.length;
    for (const el of elements) sum += Number(el?.version) || 0;
    return `v${sum}:${elements.length}`;
  }

  const gestureActive = () => {
    const s = app.state ?? {};
    return GESTURE_KEYS.some((k) => !!s[k]);
  };

  const overlayOpen = () => {
    const s = app.state ?? {};
    return OVERLAY_KEYS.some((k) => !!s[k]);
  };

  function chipTextOf(region, index) {
    let text = "";
    try { text = plainCaption(region.caption, resolveBlock); } catch { text = ""; }
    if (!text) text = `${KIND_WORDS[region.kind] ?? "region"} ${index + 1}`;
    return cutChip(text);
  }

  function labelFor(entry) {
    try { return String(labelOf(entry.region, entry.uid) ?? ""); } catch { return ""; }
  }

  function makeItem(uid) {
    const outline = doc.createElementNS ? doc.createElementNS(SVG_NS, "rect") : doc.createElement("rect");
    outline.setAttribute("class", "plexus-region-outline");
    outline.setAttribute("vector-effect", "non-scaling-stroke");
    const chip = doc.createElement("div");
    chip.className = "plexus-region-chip";
    chip.setAttribute?.("role", "button");
    chip.setAttribute?.("tabindex", "0");
    const activate = (e) => {
      e?.stopPropagation?.();
      e?.preventDefault?.();
      try {
        if (e?.shiftKey) onOpenSidebar(uid); else onSelect(uid);
      } catch (error) { warn("regions layer chip failed", error); }
    };
    const onMouseDown = (e) => e?.preventDefault?.();
    const onPointerDown = (e) => e?.stopPropagation?.();
    const onKeyDown = (e) => {
      if (e?.key === "Enter" || e?.key === " " || e?.key === "Spacebar") activate(e);
    };
    chip.addEventListener("mousedown", onMouseDown);
    chip.addEventListener("pointerdown", onPointerDown);
    chip.addEventListener("click", activate);
    chip.addEventListener("keydown", onKeyDown);
    svg.append(outline);
    stage.append(chip);
    return {
      uid, outline, chip, bbox: null, text: null, label: null,
      rectKey: "", chipPos: "", chipFlip: null,
      detach() {
        chip.removeEventListener("mousedown", onMouseDown);
        chip.removeEventListener("pointerdown", onPointerDown);
        chip.removeEventListener("click", activate);
        chip.removeEventListener("keydown", onKeyDown);
        outline.remove();
        chip.remove();
      },
    };
  }

  function collect() {
    const elements = app.getSceneElementsIncludingDeleted?.() ?? [];
    const appState = app.state;
    // One live list shared by every region (built once here with its id map, not per region).
    const live = liveElements(elements);
    const sceneIndex = { live, byId: new Map(live.map((el) => [el.id, el])) };
    const wanted = [];
    regions.forEach((entry, index) => {
      const region = entry?.region;
      if (!region || isImageKind(region.kind) || !DRAWN_KINDS.has(region.kind)) return;
      wanted.push({ entry, index });
    });
    let drawn = wanted;
    if (wanted.length > REGION_LAYER_CAP) {
      drawn = wanted.slice(0, REGION_LAYER_CAP);
      if (!capLogged) { capLogged = true; console.warn(`[plexus] regions layer: more than ${REGION_LAYER_CAP} regions, extra outlines are not drawn`); }
    }
    const keep = new Set();
    for (const { entry, index } of drawn) {
      let out;
      try { out = regionSceneBBox(entry.region, live, appState, sceneIndex); } catch (error) { warn("regions layer bbox failed", error); continue; }
      if (!out?.bbox) continue;
      keep.add(entry.uid);
      let item = items.get(entry.uid);
      if (!item) { item = makeItem(entry.uid); items.set(entry.uid, item); }
      item.bbox = out.bbox;
      const text = chipTextOf(entry.region, index);
      if (item.text !== text) { item.text = text; item.chip.textContent = text; }
      const label = labelFor(entry);
      if (item.label !== label) {
        item.label = label;
        item.chip.title = label;
        item.chip.setAttribute?.("aria-label", label);
      }
    }
    for (const [uid, item] of [...items]) {
      if (keep.has(uid)) continue;
      items.delete(uid);
      item.detach();
    }
    syncOutlines();
    chipsDirty = true;
    applyFilter();
  }

  function classOf(outline) {
    if (typeof outline?.getAttribute === "function") return outline.getAttribute("class") || "";
    return outline?.attrs?.class || "";
  }

  function setDim(outline, on) {
    const parts = classOf(outline).split(/\s+/).filter(Boolean);
    const has = parts.includes("plexus-region-dim");
    if (on === has) return;
    const next = on ? [...parts, "plexus-region-dim"] : parts.filter((c) => c !== "plexus-region-dim");
    outline.setAttribute?.("class", next.join(" "));
  }

  function textsFor(entry) {
    const texts = [];
    if (typeof entry?.string === "string") texts.push(entry.string);
    if (!entry) return texts;
    let children = null;
    try { children = host?.pullBlock?.(entry.uid)?.children ?? null; } catch { children = null; }
    if (!Array.isArray(children)) return texts;
    for (const child of children) texts.push(typeof child === "string" ? child : String(child?.string ?? ""));
    return texts;
  }

  function applyFilter() {
    const active = filterTag !== "";
    const byUid = active ? new Map(regions.map((r) => [r.uid, r])) : null;
    for (const [uid, item] of items) {
      const dim = active && !regionMatchesTag(textsFor(byUid.get(uid)), filterTag);
      setDim(item.outline, dim);
    }
  }

  function listenFilter() {
    if (onFilterKey || !filterTag) return;
    const fn = (e) => { if (e?.key === "Escape") setTagFilter(""); };
    try {
      doc.addEventListener("keydown", fn);
      onFilterKey = fn;
    } catch (error) {
      warn("regions layer filter key failed", error);
    }
  }

  function silenceFilter() {
    if (!onFilterKey) return;
    const fn = onFilterKey;
    onFilterKey = null;
    try { doc.removeEventListener("keydown", fn); } catch (error) { warn("regions layer filter key failed", error); }
  }

  function setTagFilter(tag) {
    if (disposed) return;
    filterTag = typeof tag === "string" ? tag : "";
    if (filterTag) listenFilter();
    else silenceFilter();
    applyFilter();
  }

  // Scene-unit outlines: only touched when the scene signature changes, never on pan.
  function syncOutlines() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const item of items.values()) {
      const [x1, y1, x2, y2] = item.bbox;
      if (x1 < minX) minX = x1;
      if (y1 < minY) minY = y1;
      if (x2 > maxX) maxX = x2;
      if (y2 > maxY) maxY = y2;
    }
    if (!(minX <= maxX)) { minX = 0; minY = 0; maxX = 0; maxY = 0; }
    const key = `${minX}|${minY}|${maxX}|${maxY}`;
    if (key !== svgKey) {
      svgKey = key;
      svg.style.left = `${minX}px`;
      svg.style.top = `${minY}px`;
      svg.style.width = `${Math.max(0, maxX - minX)}px`;
      svg.style.height = `${Math.max(0, maxY - minY)}px`;
    }
    for (const item of items.values()) {
      const [x1, y1, x2, y2] = item.bbox;
      const x = x1 - minX, y = y1 - minY;
      const w = Math.max(0, x2 - x1), h = Math.max(0, y2 - y1);
      const rk = `${x}|${y}|${w}|${h}`;
      if (rk === item.rectKey) continue;
      item.rectKey = rk;
      item.outline.setAttribute("x", String(x));
      item.outline.setAttribute("y", String(y));
      item.outline.setAttribute("width", String(w));
      item.outline.setAttribute("height", String(h));
    }
  }

  // Chips sit at the region's top-left in scene units. The flip-inside rule is evaluated here
  // (scene change or zoom change), not per pan frame.
  function placeChips(box) {
    for (const item of items.values()) {
      const pos = `${item.bbox[0]}|${item.bbox[1]}`;
      if (pos !== item.chipPos) {
        item.chipPos = pos;
        item.chip.style.left = `${item.bbox[0]}px`;
        item.chip.style.top = `${item.bbox[1]}px`;
      }
      const rect = native.viewportRectOf(app, item.bbox);
      const inside = rect.top - CHIP_HEIGHT < box.top;
      if (inside !== item.chipFlip) {
        item.chipFlip = inside;
        item.chip.style.transform = inside ? CHIP_INSIDE : CHIP_ABOVE;
      }
    }
  }

  function setVar(node, name, value) {
    if (typeof node.style.setProperty === "function") node.style.setProperty(name, value);
    else node.style[name] = value;
  }

  function layout() {
    if (!isVisible()) return;
    const isDark = app.state?.theme === "dark";
    if (isDark !== dark) {
      dark = isDark;
      root.className = isDark ? "plexus-portal plexus-regions-layer plexus-regions-layer--dark" : "plexus-portal plexus-regions-layer";
    }
    const cover = overlayOpen();
    if (cover !== coverHidden) {
      coverHidden = cover;
      root.style.display = cover ? "none" : "";
    }
    if (cover) return;
    const raw = containerEl?.getBoundingClientRect?.();
    const clipped = raw != null && Number.isFinite(raw.left) && Number.isFinite(raw.top);
    const box = clipped ? raw : { left: 0, top: 0, right: Infinity, bottom: Infinity };
    const key = clipped
      ? `${box.left}|${box.top}|${Math.max(0, box.right - box.left)}|${Math.max(0, box.bottom - box.top)}`
      : "open";
    if (key !== rootKey) {
      rootKey = key;
      root.style.left = `${box.left}px`;
      root.style.top = `${box.top}px`;
      root.style.width = clipped ? `${Math.max(0, box.right - box.left)}px` : "100vw";
      root.style.height = clipped ? `${Math.max(0, box.bottom - box.top)}px` : "100vh";
    }
    const st = app.state ?? {};
    const zoom = (typeof st.zoom === "number" ? st.zoom : st.zoom?.value) || 1;
    if (zoom !== lastZoom) {
      lastZoom = zoom;
      setVar(stage, "--plexus-inv-zoom", String(1 / zoom));
      chipsDirty = true;
    }
    if (chipsDirty) {
      chipsDirty = false;
      placeChips(box);
    }
    // Same math as native.viewportRectOf / sceneToViewport, relative to the layer's fixed origin.
    const tx = (st.scrollX || 0) * zoom + (st.offsetLeft || 0) - box.left;
    const ty = (st.scrollY || 0) * zoom + (st.offsetTop || 0) - box.top;
    const sk = `translate(${tx}px, ${ty}px) scale(${zoom})`;
    if (sk !== stageKey) {
      stageKey = sk;
      stage.style.transform = sk;
    }
  }

  function update() {
    if (!isVisible()) return;
    const started = clock();
    let changed = false;
    if (now() - regionsAt > REGION_REFETCH_MS && fetchRegions()) changed = true;
    if (!gestureActive()) {
      const sig = sceneSignature();
      if (changed || sig !== sceneSig) {
        sceneSig = sig;
        collect();
      }
    }
    layout();
    if (debugOn()) {
      samples.push(clock() - started);
      if (samples.length >= P95_EVERY) {
        const sorted = [...samples].sort((a, b) => a - b);
        const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
        console.log(`[plexus] regions layer p95 ${p95.toFixed(2)} ms`);
        samples = [];
      }
    }
  }

  function schedule() {
    if (disposed || !isVisible() || pendingFrame != null) return;
    pendingFrame = requestFrame(() => {
      pendingFrame = null;
      try { update(); } catch (error) { warn("regions layer update failed", error); }
    });
  }

  function refresh() {
    if (disposed || !isVisible()) return;
    try {
      fetchRegions();
      sceneSig = null;
      update();
    } catch (error) { warn("regions layer refresh failed", error); }
  }

  function show() {
    if (disposed || !drawingUid) return;
    if (isVisible()) { refresh(); return; }
    root = doc.createElement("div");
    root.className = "plexus-portal plexus-regions-layer";
    root.style.zIndex = String(zIndex);
    stage = doc.createElement("div");
    stage.className = "plexus-regions-stage";
    svg = doc.createElementNS ? doc.createElementNS(SVG_NS, "svg") : doc.createElement("svg");
    svg.setAttribute("class", "plexus-regions-svg");
    stage.append(svg);
    root.append(stage);
    doc.body.append(root);
    rootKey = ""; stageKey = ""; svgKey = ""; lastZoom = NaN; chipsDirty = true;
    dark = null;
    coverHidden = false;
    capLogged = false;
    samples = [];
    try {
      unsubscribe = native.subscribeViewport(app, schedule);
    } catch (error) { warn("regions layer subscribe failed", error); }
    refresh();
  }

  function hide() {
    if (pendingFrame != null) { cancelFrame(pendingFrame); pendingFrame = null; }
    try { unsubscribe?.(); } catch (error) { warn("regions layer unsubscribe failed", error); }
    unsubscribe = null;
    for (const item of items.values()) item.detach();
    items = new Map();
    if (root) { root.remove(); root = null; }
    stage = null;
    svg = null;
    sceneSig = null;
    regionSig = "";
    regionsAt = -Infinity;
  }

  function toggle() {
    if (isVisible()) hide(); else show();
    return isVisible();
  }

  function dispose() {
    if (disposed) return;
    hide();
    filterTag = "";
    silenceFilter();
    disposed = true;
  }

  return { show, hide, toggle, visible: isVisible, refresh, dispose, setTagFilter };
}
