import { parseOverrides, withOverride } from "./model/refdisplay.js";

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
  debug: "debug",
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
  [SETTING_IDS.debug]: false,
});

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
      { id: SETTING_IDS.debug, name: "Debug logging", description: "Log Plexus diagnostics to the console.", action: { type: "switch" } },
    ],
  };
}

const clampNumber = (value, fallback, min, max) => {
  const n = Number(value);
  const base = value == null || (typeof value === "string" && value.trim() === "") || !Number.isFinite(n) ? fallback : n;
  return Math.round(Math.min(max, Math.max(min, base)));
};

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
    debug: !!get(SETTING_IDS.debug),
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

export function setRefOverride(extensionAPI, blockUid, refUid, mode) {
  const prev = overrideQueues.get(extensionAPI) || Promise.resolve();
  const next = prev.then(async () => {
    try {
      const map = parseOverrides(extensionAPI.settings.get(SETTING_IDS.refOverrides));
      await writeSetting(extensionAPI, SETTING_IDS.refOverrides, JSON.stringify(withOverride(map, blockUid, refUid, mode)));
    } catch (error) {
      console.warn("[plexus] setRefOverride failed", error);
    }
  });
  overrideQueues.set(extensionAPI, next);
  return next;
}
