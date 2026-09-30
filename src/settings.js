import { CAPTION_DISPLAYS, parseOverrides, serializeOverrides, withOverride } from "./model/refdisplay.js";

export const SETTING_IDS = Object.freeze({
  openInSidebar: "open-in-sidebar",
  figureHeight: "figure-height",
  thumbHeight: "thumb-height",
  inlineDisplay: "inline-display",
  darkCrops: "dark-crops",
  refOverrides: "ref-overrides",
  cacheOnDisk: "cache-on-disk",
  cacheLimitMb: "cache-limit-mb",
  showBacklinks: "show-backlinks",
  captionDisplay: "caption-display",
  captionMode: "caption-mode",
  pinSize: "pin-size",
  numberPins: "number-pins",
  debug: "debug",
  zoomCap: "zoom-cap",
  animation: "animation",
  regionLanding: "region-landing",
  pasteRefs: "paste-refs",
  cardHome: "card-home",
  drawingName: "drawing-name",
});

const DEFAULTS = Object.freeze({
  [SETTING_IDS.openInSidebar]: false,
  [SETTING_IDS.figureHeight]: "280",
  [SETTING_IDS.thumbHeight]: "72",
  [SETTING_IDS.inlineDisplay]: "thumbnail",
  [SETTING_IDS.darkCrops]: true,
  [SETTING_IDS.refOverrides]: "{}",
  [SETTING_IDS.cacheOnDisk]: true,
  [SETTING_IDS.cacheLimitMb]: "100",
  [SETTING_IDS.showBacklinks]: true,
  [SETTING_IDS.captionDisplay]: "written",
  [SETTING_IDS.captionMode]: "auto",
  [SETTING_IDS.pinSize]: "8",
  [SETTING_IDS.numberPins]: false,
  [SETTING_IDS.debug]: false,
  [SETTING_IDS.zoomCap]: "100",
  [SETTING_IDS.animation]: "system",
  [SETTING_IDS.regionLanding]: false,
  [SETTING_IDS.pasteRefs]: "text",
  [SETTING_IDS.cardHome]: "drawing",
  [SETTING_IDS.drawingName]: "Drawing {date}",
});

export const CAPTION_MODES = Object.freeze(["auto", "ask", "none"]);
export const PIN_SIZES = Object.freeze([4, 8, 12]);
export const ZOOM_CAPS = Object.freeze(["100", "150", "200"]);
export const ANIMATIONS = Object.freeze(["system", "on", "off"]);
export const PASTE_REFS = Object.freeze(["text", "embed", "link"]);
export const CARD_HOMES = Object.freeze(["drawing", "page", "daily"]);
export const DEFAULT_DRAWING_NAME = "Drawing {date}";

// Alt+Shift only, never a single letter. Roam registers these as command-palette default hotkeys.
export const HOTKEYS = Object.freeze([
  Object.freeze({ id: "region", spec: "alt-shift-r", label: "Create region from selection" }),
  Object.freeze({ id: "image", spec: "alt-shift-i", label: "Create image region" }),
  Object.freeze({ id: "present", spec: "alt-shift-p", label: "Present open drawing" }),
  Object.freeze({ id: "mindmap", spec: "alt-shift-m", label: "Mind map" }),
  Object.freeze({ id: "embed", spec: "alt-shift-e", label: "Embed page or block" }),
  Object.freeze({ id: "note", spec: "alt-shift-n", label: "New note card" }),
]);

// Excalidraw's own kbd wording: "Shift+Alt+R", and "Shift+Option+R" on macOS.
export function formatHotkey(spec, { mac = false } = {}) {
  const parts = String(spec ?? "").split("-").filter(Boolean);
  const mods = [];
  let key = "";
  for (const part of parts) {
    const p = part.toLowerCase();
    if (p === "ctrl" || p === "control") mods.push("Ctrl");
    else if (p === "meta" || p === "cmd") mods.push(mac ? "Cmd" : "Ctrl");
    else if (p === "shift") mods.push("Shift");
    else if (p === "alt" || p === "option") mods.push(mac ? "Option" : "Alt");
    else key = part.length === 1 ? part.toUpperCase() : part;
  }
  const order = ["Ctrl", "Cmd", "Shift", "Alt", "Option"];
  mods.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return [...new Set(mods), key].filter(Boolean).join("+");
}

export function hotkeyFor(id, opts) {
  const h = HOTKEYS.find((x) => x.id === id);
  return h ? formatHotkey(h.spec, opts) : "";
}

export async function initializeSettings(extensionAPI) {
  if (extensionAPI.settings.canSet === false) return;
  for (const [id, value] of Object.entries(DEFAULTS)) {
    if (extensionAPI.settings.get(id) == null) await extensionAPI.settings.set(id, value);
  }
}

export function createSettingsPanel({ onChange } = {}) {
  const wrap = (action) => ({
    ...action,
    onChange: () => {
      try { onChange?.(); } catch (error) { console.warn("[plexus] settings onChange failed", error); }
    },
  });
  return {
    tabTitle: "Plexus",
    settings: [
      { id: SETTING_IDS.openInSidebar, name: "Open regions in sidebar", description: "Clicking a region crop opens the drawing in the right sidebar.", action: wrap({ type: "switch" }) },
      { id: SETTING_IDS.figureHeight, name: "Image height (px)", description: "Maximum height of a region shown as an image.", action: wrap({ type: "input", placeholder: "280" }) },
      { id: SETTING_IDS.thumbHeight, name: "Thumbnail height (px)", description: "Height of a region shown as a thumbnail inside text.", action: wrap({ type: "input", placeholder: "72" }) },
      { id: SETTING_IDS.inlineDisplay, name: "Region refs inside text", description: "How a region ref that shares a block with other text is shown.", action: wrap({ type: "select", items: ["thumbnail", "link"] }) },
      { id: SETTING_IDS.darkCrops, name: "Match dark theme", description: "Invert region crops on a dark Roam theme.", action: wrap({ type: "switch" }) },
      { id: SETTING_IDS.cacheOnDisk, name: "Cache crops on disk", description: "Store rendered crops in IndexedDB. Ignored on encrypted graphs.", action: { type: "switch" } },
      { id: SETTING_IDS.cacheLimitMb, name: "Cache limit (MB)", description: "Maximum size of the on-disk crop cache.", action: { type: "input", placeholder: "100" } },
      { id: SETTING_IDS.showBacklinks, name: "Show backlinks on canvas", description: "Show a reference count beside each region or mind-map node that is referenced elsewhere in Roam.", action: wrap({ type: "switch" }) },
      { id: SETTING_IDS.captionDisplay, name: "Caption under crops", description: "written: show a region's stored caption when it has one. always: also show a derived label when it has none. never: hide captions. Per-ref override: Plexus: Hide caption / Show caption.", action: wrap({ type: "select", items: ["written", "always", "never"] }) },
      { id: SETTING_IDS.captionMode, name: "Caption mode", description: "auto: fill a new region's caption from its text and source blocks. ask: prompt for it. none: stores no words; links to source blocks are still stored.", action: { type: "select", items: ["auto", "ask", "none"] } },
      { id: SETTING_IDS.pinSize, name: "Pin size (%)", description: "Side of a pin dropped by clicking an image, as a percent of the image's shorter side.", action: { type: "select", items: ["4", "8", "12"] } },
      { id: SETTING_IDS.numberPins, name: "Number pins", description: "Pre-fill each new pin's caption with the next number on that image.", action: { type: "switch" } },
      { id: SETTING_IDS.zoomCap, name: "Zoom limit (%)", description: "Highest zoom when Plexus moves the view to a region.", action: { type: "select", items: ["100", "150", "200"] } },
      { id: SETTING_IDS.animation, name: "Animation", description: "system: follow the operating system's reduced-motion setting. on: always animate. off: never animate.", action: { type: "select", items: ["system", "on", "off"] } },
      { id: SETTING_IDS.regionLanding, name: "Open region links in the drawing", description: "Opening a region's own page link (for example from a shared URL) opens the drawing zoomed to that region.", action: { type: "switch" } },
      { id: SETTING_IDS.pasteRefs, name: "Paste refs as", description: "What pasting a single ((block)) or [[page]] ref onto the canvas does. text: Excalidraw's normal paste. embed: a live embed. link: a text node linked to the ref. Shift+Ctrl+V always pastes plain text.", action: wrap({ type: "select", items: ["text", "embed", "link"] }) },
      { id: SETTING_IDS.cardHome, name: "New note cards go", description: "Where the block behind a new note card is created. drawing: a collapsed container under the drawing. page: the last block of the drawing's page. daily: today's daily page.", action: { type: "select", items: ["drawing", "page", "daily"] } },
      { id: SETTING_IDS.drawingName, name: "New drawing page name", description: "Title of a page made by New drawing on a page, after Drawings/. Tokens: {date}, {page}, {n}.", action: { type: "input", placeholder: DEFAULT_DRAWING_NAME } },
      { id: SETTING_IDS.debug, name: "Debug logging", description: "Log Plexus diagnostics to the console.", action: { type: "switch" } },
    ],
  };
}

const clampNumber = (value, fallback, min, max) => {
  const n = Number(value);
  const base = value == null || (typeof value === "string" && value.trim() === "") || !Number.isFinite(n) ? fallback : n;
  return Math.round(Math.min(max, Math.max(min, base)));
};

const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

export const drawingNameOf = (value) => (typeof value === "string" && value.trim() ? value : DEFAULT_DRAWING_NAME);

let overridesMemo = { raw: undefined, value: null };
function memoOverrides(raw) {
  if (overridesMemo.value && overridesMemo.raw === raw) return overridesMemo.value;
  const value = Object.freeze(parseOverrides(raw));
  overridesMemo = { raw, value };
  return value;
}

export function readSettings(extensionAPI) {
  const get = (id) => {
    const value = extensionAPI.settings.get(id);
    return value == null ? DEFAULTS[id] : value;
  };
  return {
    openInSidebar: !!get(SETTING_IDS.openInSidebar),
    figureHeight: clampNumber(get(SETTING_IDS.figureHeight), 280, 80, 1200),
    thumbHeight: clampNumber(get(SETTING_IDS.thumbHeight), 72, 24, 400),
    inlineDisplay: get(SETTING_IDS.inlineDisplay) === "link" ? "link" : "thumbnail",
    darkCrops: !!get(SETTING_IDS.darkCrops),
    refOverrides: memoOverrides(get(SETTING_IDS.refOverrides)),
    cacheOnDisk: !!get(SETTING_IDS.cacheOnDisk),
    cacheLimitMb: Number(get(SETTING_IDS.cacheLimitMb)) || 100,
    showBacklinks: !!get(SETTING_IDS.showBacklinks),
    captionDisplay: oneOf(get(SETTING_IDS.captionDisplay), CAPTION_DISPLAYS, "written"),
    captionMode: oneOf(get(SETTING_IDS.captionMode), CAPTION_MODES, "auto"),
    pinSize: PIN_SIZES.includes(Number(get(SETTING_IDS.pinSize))) ? Number(get(SETTING_IDS.pinSize)) : 8,
    numberPins: !!get(SETTING_IDS.numberPins),
    debug: !!get(SETTING_IDS.debug),
    zoomCap: Number(oneOf(String(get(SETTING_IDS.zoomCap)), ZOOM_CAPS, "100")) / 100,
    animation: oneOf(get(SETTING_IDS.animation), ANIMATIONS, "system"),
    regionLanding: !!get(SETTING_IDS.regionLanding),
    pasteRefs: oneOf(get(SETTING_IDS.pasteRefs), PASTE_REFS, "text"),
    cardHome: oneOf(get(SETTING_IDS.cardHome), CARD_HOMES, "drawing"),
    drawingName: drawingNameOf(get(SETTING_IDS.drawingName)),
  };
}

export async function writeSetting(extensionAPI, id, value) {
  try {
    await extensionAPI.settings.set(id, value);
  } catch (error) {
    console.warn("[plexus] settings write failed", id, error);
  }
}

const overrideQueues = new WeakMap();

// patch is {mode?, caption?} (null field removes it). A string is shorthand for {mode}, null for {mode: null}.
export function setRefOverride(extensionAPI, blockUid, refUid, patch) {
  const fields = typeof patch === "string" ? { mode: patch } : patch == null ? { mode: null } : patch;
  const prev = overrideQueues.get(extensionAPI) || Promise.resolve();
  const next = prev.then(async () => {
    try {
      const map = parseOverrides(extensionAPI.settings.get(SETTING_IDS.refOverrides));
      await writeSetting(extensionAPI, SETTING_IDS.refOverrides, JSON.stringify(serializeOverrides(withOverride(map, blockUid, refUid, fields))));
    } catch (error) {
      console.warn("[plexus] setRefOverride failed", error);
    }
  });
  overrideQueues.set(extensionAPI, next);
  return next;
}
