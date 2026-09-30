/* Plexus v0.10.0 | MIT | generated; edit src/ */
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/lifecycle.js
function isPromiseLike(value) {
  return value != null && typeof value.then === "function";
}
async function callSafely(disposer) {
  const result = disposer();
  if (isPromiseLike(result)) await result;
}
function createLifecycle() {
  let disposed = false;
  const disposers = [];
  const add = (disposer) => {
    if (typeof disposer !== "function") throw new TypeError("A disposer must be a function");
    if (disposed) {
      void callSafely(disposer).catch((error) => console.error("[plexus] Late cleanup failed", error));
      return disposer;
    }
    disposers.push(disposer);
    return disposer;
  };
  return {
    get disposed() {
      return disposed;
    },
    add,
    async command(commandApi, config) {
      if (!commandApi?.addCommand || !commandApi?.removeCommand) {
        throw new TypeError("A command API with addCommand/removeCommand is required");
      }
      await commandApi.addCommand(config);
      add(() => commandApi.removeCommand({ label: config.label }));
    },
    event(target, type, listener, options) {
      target.addEventListener(type, listener, options);
      add(() => target.removeEventListener(type, listener, options));
      return listener;
    },
    interval(callback, delay, ...args) {
      const id = globalThis.setInterval(callback, delay, ...args);
      add(() => globalThis.clearInterval(id));
      return id;
    },
    timeout(callback, delay, ...args) {
      const id = globalThis.setTimeout(callback, delay, ...args);
      add(() => globalThis.clearTimeout(id));
      return id;
    },
    observer(observer, target, options) {
      observer.observe(target, options);
      add(() => observer.disconnect());
      return observer;
    },
    node(node, parent = globalThis.document?.body) {
      if (!parent) throw new Error("A parent node is required outside the browser");
      parent.append(node);
      add(() => node.remove());
      return node;
    },
    pullWatch(dataApi, pattern, entity, callback) {
      if (!dataApi?.addPullWatch || !dataApi?.removePullWatch) {
        throw new TypeError("A Roam data API with addPullWatch/removePullWatch is required");
      }
      dataApi.addPullWatch(pattern, entity, callback);
      add(() => dataApi.removePullWatch(pattern, entity, callback));
      return callback;
    },
    async settingsPanel(extensionAPI, config) {
      await extensionAPI.settings.panel.create(config);
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      const errors = [];
      for (const disposer of disposers.splice(0).reverse()) {
        try {
          await callSafely(disposer);
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw new AggregateError(errors, "One or more extension cleanups failed");
    }
  };
}

// src/model/refdisplay.js
var DISPLAY_MODES = ["image", "thumbnail", "link"];
var CAPTION_OVERRIDES = ["hide", "show"];
var CAPTION_DISPLAYS = ["written", "always", "never"];
var MAX_OVERRIDES = 500;
function overrideKey(blockUid, refUid) {
  return `${blockUid}|${refUid}`;
}
function refContext(blockString, refUid) {
  return String(blockString ?? "").trim() === `((${refUid}))` ? "alone" : "inline";
}
function resolveDisplay({ context, override, inlineDisplay } = {}) {
  if (context === "home") return "image";
  const mode = typeof override === "string" ? override : override?.mode;
  if (DISPLAY_MODES.includes(mode)) return mode;
  if (context === "alone") return "image";
  return inlineDisplay === "link" ? "link" : "thumbnail";
}
function cleanEntry(value) {
  if (typeof value === "string") return DISPLAY_MODES.includes(value) ? { mode: value } : null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = {};
  if (DISPLAY_MODES.includes(value.mode)) entry.mode = value.mode;
  if (CAPTION_OVERRIDES.includes(value.caption)) entry.caption = value.caption;
  return entry.mode || entry.caption ? entry : null;
}
function parseOverrides(value) {
  let raw = value;
  if (typeof value === "string") {
    try {
      raw = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, entry] of Object.entries(raw)) {
    const clean = cleanEntry(entry);
    if (clean) out[key] = clean;
  }
  return out;
}
function withOverride(map, blockUid, refUid, patch) {
  const out = {};
  for (const [key2, entry] of Object.entries(map && typeof map === "object" ? map : {})) {
    const clean2 = cleanEntry(entry);
    if (clean2) out[key2] = clean2;
  }
  const key = overrideKey(blockUid, refUid);
  const prev = out[key];
  delete out[key];
  if (patch == null) return out;
  const fields = typeof patch === "string" ? { mode: patch } : patch;
  if (typeof fields !== "object" || Array.isArray(fields)) return out;
  const next = { ...prev };
  for (const field of ["mode", "caption"]) {
    if (!(field in fields)) continue;
    if (fields[field] == null) delete next[field];
    else next[field] = fields[field];
  }
  const clean = cleanEntry(next);
  if (!clean) return out;
  out[key] = clean;
  const keys = Object.keys(out);
  for (let i = 0; i < keys.length - MAX_OVERRIDES; i++) delete out[keys[i]];
  return out;
}
function serializeOverrides(map) {
  const out = {};
  for (const [key, entry] of Object.entries(parseOverrides(map))) {
    out[key] = entry.caption ? entry : entry.mode;
  }
  return out;
}
function resolveCaption({ captionDisplay, override, context } = {}) {
  if (context === "home") return "written";
  const caption = override && typeof override === "object" ? override.caption : null;
  if (CAPTION_OVERRIDES.includes(caption)) return caption;
  if (captionDisplay === "never") return "hide";
  if (captionDisplay === "always") return "show";
  return "written";
}

// src/settings.js
var SETTING_IDS = Object.freeze({
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
  dockWidth: "dock-width"
});
var DEFAULTS = Object.freeze({
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
  [SETTING_IDS.dockWidth]: "320"
});
var CAPTION_MODES = Object.freeze(["auto", "ask", "none"]);
var PIN_SIZES = Object.freeze([4, 8, 12]);
var ZOOM_CAPS = Object.freeze(["100", "150", "200"]);
var ANIMATIONS = Object.freeze(["system", "on", "off"]);
var PASTE_REFS = Object.freeze(["text", "embed", "link"]);
var CARD_HOMES = Object.freeze(["drawing", "page", "daily"]);
var DEFAULT_DRAWING_NAME = "Drawing {date}";
var HOTKEYS = Object.freeze([
  Object.freeze({ id: "region", spec: "alt-shift-r", label: "Create region from selection" }),
  Object.freeze({ id: "image", spec: "alt-shift-i", label: "Create image region" }),
  Object.freeze({ id: "present", spec: "alt-shift-p", label: "Present open drawing" }),
  Object.freeze({ id: "mindmap", spec: "alt-shift-m", label: "Mind map" }),
  Object.freeze({ id: "embed", spec: "alt-shift-e", label: "Embed page or block" }),
  Object.freeze({ id: "note", spec: "alt-shift-n", label: "New note card" }),
  Object.freeze({ id: "dock", spec: "alt-shift-o", label: "Outline dock" })
]);
function formatHotkey(spec, { mac = false } = {}) {
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
function hotkeyFor(id, opts) {
  const h = HOTKEYS.find((x) => x.id === id);
  return h ? formatHotkey(h.spec, opts) : "";
}
async function initializeSettings(extensionAPI) {
  if (extensionAPI.settings.canSet === false) return;
  for (const [id, value] of Object.entries(DEFAULTS)) {
    if (extensionAPI.settings.get(id) == null) await extensionAPI.settings.set(id, value);
  }
}
function createSettingsPanel({ onChange } = {}) {
  const wrap = (action) => ({
    ...action,
    onChange: () => {
      try {
        onChange?.();
      } catch (error) {
        console.warn("[plexus] settings onChange failed", error);
      }
    }
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
      { id: SETTING_IDS.debug, name: "Debug logging", description: "Log Plexus diagnostics to the console.", action: { type: "switch" } }
    ]
  };
}
var clampNumber = (value, fallback, min, max) => {
  const n = Number(value);
  const base3 = value == null || typeof value === "string" && value.trim() === "" || !Number.isFinite(n) ? fallback : n;
  return Math.round(Math.min(max, Math.max(min, base3)));
};
var oneOf = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
var drawingNameOf = (value) => typeof value === "string" && value.trim() ? value : DEFAULT_DRAWING_NAME;
var overridesMemo = { raw: void 0, value: null };
function memoOverrides(raw) {
  if (overridesMemo.value && overridesMemo.raw === raw) return overridesMemo.value;
  const value = Object.freeze(parseOverrides(raw));
  overridesMemo = { raw, value };
  return value;
}
function readSettings(extensionAPI) {
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
    dockWidth: clampNumber(get(SETTING_IDS.dockWidth), 320, 240, 640)
  };
}
async function writeSetting(extensionAPI, id, value) {
  try {
    await extensionAPI.settings.set(id, value);
  } catch (error) {
    console.warn("[plexus] settings write failed", id, error);
  }
}
var overrideQueues = /* @__PURE__ */ new WeakMap();
function setRefOverride(extensionAPI, blockUid, refUid, patch) {
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

// src/host/locks.js
function lockName(graph, uid) {
  return `plexus:${graph}:${uid}`;
}
async function withLock(name, fn, { ifAvailable = false, locks = globalThis.navigator?.locks, timeoutMs = 5e3 } = {}) {
  if (!locks || typeof locks.request !== "function") {
    return { acquired: true, fallback: true, value: await fn() };
  }
  const result = { acquired: false, fallback: false, value: void 0 };
  const body = async (lock) => {
    if (!lock) return;
    result.acquired = true;
    result.value = await fn();
  };
  if (ifAvailable) {
    await locks.request(name, { ifAvailable: true }, body);
    return result;
  }
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    await locks.request(name, controller ? { signal: controller.signal } : {}, async (lock) => {
      if (timer) clearTimeout(timer);
      await body(lock);
    });
  } catch (error) {
    if (error?.name === "AbortError" && !result.acquired) return result;
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
  return result;
}

// src/model/region.js
var REGION_COMPONENT = "plexus-region";
var CONTAINER_STRING = "{{[[plexus-regions]]}}";
var REGION_BUTTON_CLASS = "rm-xparser-default-plexus-region";
var DEFAULT_PAD = 10;
var SUPPORTED_KINDS = Object.freeze(["area", "rect", "group", "frame", "cframe", "poly", "imgrect", "imgpoly"]);
var RESERVED_KINDS = Object.freeze([]);
var ID_RE = /^[A-Za-z0-9_-]+$/;
var isId = (value) => typeof value === "string" && ID_RE.test(value);
var HEAD_RE = /^\s*\{\{\[\[plexus-region\]\]:\s*([^}]*)\}\}(?: ([\s\S]*))?$/;
var KNOWN_KEYS = /* @__PURE__ */ new Set(["k", "d", "ids", "pad", "el", "f", "g", "fr", "p", "i"]);
var clamp01 = (n) => Math.min(1, Math.max(0, n));
var round4 = (n) => Math.round(n * 1e4) / 1e4;
function normalizePoly(p) {
  if (!Array.isArray(p)) return null;
  const flat = p.length && Array.isArray(p[0]) ? p.flat() : p;
  if (flat.length < 6 || flat.length % 2) return null;
  const nums = flat.map((n) => typeof n === "string" && n.trim() === "" ? NaN : Number(n));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return nums.map((n) => round4(clamp01(n)));
}
function normalizeFrac(f) {
  let v;
  if (Array.isArray(f)) v = f;
  else if (f && typeof f === "object") {
    if ("rx" in f) v = [f.rx, f.ry, f.rw, f.rh];
    else if ("x" in f) v = [f.x, f.y, f.w, f.h];
  }
  if (!v || v.length !== 4) return null;
  const nums = v.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const out = nums.map((n) => round4(clamp01(n)));
  if (out[2] <= 0 || out[3] <= 0) return null;
  return out;
}
function isContainerString(s) {
  return typeof s === "string" && s.trim() === CONTAINER_STRING;
}
function parseRegion(blockString) {
  if (typeof blockString !== "string") return null;
  const m = HEAD_RE.exec(blockString);
  if (!m) return null;
  const caption = (m[2] ?? "").trim();
  const args = /* @__PURE__ */ new Map();
  const extra = [];
  const bad = [];
  for (const tok of m[1].split(/\s+/)) {
    if (!tok) continue;
    const eq = tok.indexOf("=");
    if (eq <= 0) {
      bad.push(tok);
      continue;
    }
    const key = tok.slice(0, eq);
    const value = tok.slice(eq + 1);
    if (KNOWN_KEYS.has(key) && !args.has(key)) args.set(key, value);
    else extra.push([key, value]);
  }
  const kind = args.get("k") ?? "";
  const drawingUid = args.get("d") ?? "";
  const region = { kind, drawingUid, caption, extra, supported: false };
  const fail2 = (error) => {
    region.error = error;
    return region;
  };
  if (bad.length) return fail2(`bad token ${bad[0]}`);
  if (!kind) return fail2("missing k");
  if (RESERVED_KINDS.includes(kind)) {
    for (const key of ["f", "el", "pad", "ids"]) if (args.has(key)) extra.unshift([key, args.get(key)]);
    if (drawingUid && !ID_RE.test(drawingUid)) return fail2("bad d");
    return region;
  }
  if (!SUPPORTED_KINDS.includes(kind)) return fail2(`unknown kind ${kind}`);
  if (!drawingUid) return fail2("missing d");
  if (!ID_RE.test(drawingUid)) return fail2("bad d");
  const parsePad = () => {
    if (!args.has("pad")) return DEFAULT_PAD;
    const raw = args.get("pad");
    const pad = /^\d+$/.test(raw) ? Number(raw) : NaN;
    return pad >= 0 && pad <= 200 ? pad : null;
  };
  const parseIdToken = (key, field) => {
    if (!args.has(key)) return `missing ${key}`;
    const v = args.get(key);
    if (!ID_RE.test(v)) return `bad ${key}`;
    region[field] = v;
    return null;
  };
  const parseFrac = () => {
    if (!args.has("f")) return "missing f";
    const parts = args.get("f").split(",");
    if (parts.length !== 4 || parts.some((x) => x.trim() === "")) return "bad f";
    const f = normalizeFrac(parts.map(Number));
    if (!f) return "bad f";
    region.f = f;
    return null;
  };
  const parsePoly = () => {
    if (!args.has("p")) return "missing p";
    const p = normalizePoly(args.get("p").split(","));
    if (!p) return "bad p";
    region.p = p;
    return null;
  };
  const parseIndex = () => {
    if (!args.has("i")) return "missing i";
    const raw = args.get("i");
    if (!/^\d+$/.test(raw)) return "bad i";
    region.i = Number(raw);
    return null;
  };
  let err = null;
  if (kind === "area") {
    if (!args.has("ids")) return fail2("missing ids");
    const ids = args.get("ids").split(",");
    if (!ids.length || ids.some((id) => !ID_RE.test(id))) return fail2("bad ids");
    const pad = parsePad();
    if (pad === null) return fail2("bad pad");
    region.ids = ids;
    region.pad = pad;
  } else if (kind === "rect") {
    err = parseIdToken("el", "el") || parseFrac();
  } else if (kind === "group") {
    err = parseIdToken("g", "groupId");
    if (!err) {
      const pad = parsePad();
      if (pad === null) err = "bad pad";
      else region.pad = pad;
    }
  } else if (kind === "frame") {
    err = parseIdToken("fr", "frameId");
    if (!err) {
      const pad = parsePad();
      if (pad === null) err = "bad pad";
      else region.pad = pad;
    }
  } else if (kind === "cframe") {
    err = parseIdToken("fr", "frameId");
    if (!err && args.has("pad")) {
      extra.unshift(["pad", args.get("pad")]);
    }
  } else if (kind === "poly") {
    err = parseIdToken("el", "el") || parsePoly();
  } else if (kind === "imgrect") {
    err = parseIndex() || parseFrac();
  } else if (kind === "imgpoly") {
    err = parseIndex() || parsePoly();
  }
  if (err) return fail2(err);
  region.supported = true;
  return region;
}
function need(cond2, msg) {
  if (!cond2) throw new TypeError(`serializeRegion: ${msg}`);
}
function serializeRegion(region) {
  need(region && typeof region === "object", "region required");
  const { kind, drawingUid } = region;
  need(SUPPORTED_KINDS.includes(kind) || RESERVED_KINDS.includes(kind), `unknown kind ${kind}`);
  need(typeof drawingUid === "string" && ID_RE.test(drawingUid), "bad drawingUid");
  const tokens2 = [`k=${kind}`, `d=${drawingUid}`];
  if (kind === "area") {
    need(Array.isArray(region.ids) && region.ids.length > 0 && region.ids.every((id) => typeof id === "string" && ID_RE.test(id)), "bad ids");
    const pad = region.pad ?? DEFAULT_PAD;
    need(Number.isInteger(pad) && pad >= 0 && pad <= 200, "bad pad");
    tokens2.push(`ids=${region.ids.join(",")}`, `pad=${pad}`);
  } else if (kind === "rect") {
    need(typeof region.el === "string" && ID_RE.test(region.el), "bad el");
    const f = normalizeFrac(region.f);
    need(f, "bad f");
    tokens2.push(`el=${region.el}`, `f=${f.join(",")}`);
  } else if (kind === "group" || kind === "frame" || kind === "cframe") {
    const isGroup = kind === "group";
    const id = isGroup ? region.groupId ?? region.g : region.frameId ?? region.fr;
    need(typeof id === "string" && ID_RE.test(id), isGroup ? "bad groupId" : "bad frameId");
    tokens2.push(`${isGroup ? "g" : "fr"}=${id}`);
    if (kind !== "cframe") {
      const pad = region.pad ?? DEFAULT_PAD;
      need(Number.isInteger(pad) && pad >= 0 && pad <= 200, "bad pad");
      tokens2.push(`pad=${pad}`);
    }
  } else if (kind === "poly" || kind === "imgrect" || kind === "imgpoly") {
    if (kind === "poly") {
      need(typeof region.el === "string" && ID_RE.test(region.el), "bad el");
      tokens2.push(`el=${region.el}`);
    } else {
      need(Number.isInteger(region.i) && region.i >= 0, "bad i");
      tokens2.push(`i=${region.i}`);
    }
    if (kind === "imgrect") {
      const f = normalizeFrac(region.f);
      need(f, "bad f");
      tokens2.push(`f=${f.join(",")}`);
    } else {
      const p = normalizePoly(region.p);
      need(p, "bad p");
      tokens2.push(`p=${p.join(",")}`);
    }
  }
  for (const pair of region.extra ?? []) {
    need(Array.isArray(pair) && typeof pair[0] === "string" && /^[^\s=}]+$/.test(pair[0]) && /^[^\s}]*$/.test(String(pair[1])), "bad extra token");
    tokens2.push(`${pair[0]}=${pair[1]}`);
  }
  const caption = String(region.caption ?? "").replace(/\s+/g, " ").trim();
  return `{{[[${REGION_COMPONENT}]]: ${tokens2.join(" ")}}}${caption ? ` ${caption}` : ""}`;
}
function geometryKey(region) {
  if (region.kind === "area") {
    return `area|${region.drawingUid}|${[...region.ids ?? []].sort().join(",")}|${region.pad ?? DEFAULT_PAD}`;
  }
  if (region.kind === "rect") {
    return `rect|${region.drawingUid}|${region.el}|${(region.f ?? []).join(",")}`;
  }
  const base3 = `${region.kind}|${region.drawingUid}`;
  switch (region.kind) {
    case "group":
      return `${base3}|${region.groupId ?? region.g}|${region.pad ?? DEFAULT_PAD}`;
    case "frame":
      return `${base3}|${region.frameId ?? region.fr}|${region.pad ?? DEFAULT_PAD}`;
    case "cframe":
      return `${base3}|${region.frameId ?? region.fr}`;
    case "poly":
      return `${base3}|${region.el}|${(region.p ?? []).join(",")}`;
    case "imgrect":
      return `${base3}|${region.i}|${(region.f ?? []).join(",")}`;
    case "imgpoly":
      return `${base3}|${region.i}|${(region.p ?? []).join(",")}`;
    default:
      return base3;
  }
}

// src/model/hash.js
var encoder = new TextEncoder();
function fnv1a(str) {
  const bytes = encoder.encode(String(str ?? ""));
  let h = 2166136261;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// src/model/image.js
var blank = (m) => " ".repeat(m.length);
function parseImageRefs(blockString) {
  if (typeof blockString !== "string") return [];
  const masked = blockString.replace(/```[\s\S]*?(?:```|$)/g, blank).replace(/(`+)[\s\S]*?\1/g, blank);
  const out = [];
  const re = /!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
  let m;
  while (m = re.exec(masked)) out.push({ alt: m[1], url: m[2], index: out.length });
  return out;
}
function imageCropRect({ naturalWidth, naturalHeight, f }) {
  const frac = normalizeFrac(f);
  if (!frac || !(naturalWidth > 0) || !(naturalHeight > 0)) return null;
  const [rx, ry, rw, rh] = frac;
  const x1 = Math.min(naturalWidth - 1, Math.max(0, Math.round(rx * naturalWidth)));
  const y1 = Math.min(naturalHeight - 1, Math.max(0, Math.round(ry * naturalHeight)));
  const x2 = Math.min(naturalWidth, Math.max(x1 + 1, Math.round((rx + rw) * naturalWidth)));
  const y2 = Math.min(naturalHeight, Math.max(y1 + 1, Math.round((ry + rh) * naturalHeight)));
  return { sx: x1, sy: y1, sw: x2 - x1, sh: y2 - y1 };
}
function polyBBox(p) {
  const poly = normalizePoly(p);
  if (!poly) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (let i = 0; i < poly.length; i += 2) {
    x1 = Math.min(x1, poly[i]);
    x2 = Math.max(x2, poly[i]);
    y1 = Math.min(y1, poly[i + 1]);
    y2 = Math.max(y2, poly[i + 1]);
  }
  return normalizeFrac([x1, y1, x2 - x1, y2 - y1]);
}
function clipPolyToUnit(flat) {
  let pts = [];
  for (let i = 0; i + 1 < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
  const edges = [
    [(q) => q[0], 0, true],
    [(q) => q[0], 1, false],
    [(q) => q[1], 0, true],
    [(q) => q[1], 1, false]
  ];
  for (const [get, lim, keepAbove] of edges) {
    const inside = (q) => keepAbove ? get(q) >= lim : get(q) <= lim;
    const next = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const ia = inside(a);
      const ib = inside(b);
      if (ia !== ib) {
        const t = (lim - get(a)) / (get(b) - get(a));
        next.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      }
      if (ib) next.push(b);
    }
    pts = next;
    if (!pts.length) return null;
  }
  if (pts.length < 3) return null;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  if (Math.abs(area) / 2 < 1e-9) return null;
  return pts.flat();
}
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0];
  const [bx, by] = pts[pts.length - 1];
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  let idx = -1, max = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = len > 0 ? Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len : Math.hypot(pts[i][0] - ax, pts[i][1] - ay);
    if (d > max) {
      max = d;
      idx = i;
    }
  }
  if (max <= eps) return [pts[0], pts[pts.length - 1]];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}
function simplifyPoly(p, epsilon = 3e-3, maxPoints = 48) {
  const poly = normalizePoly(p);
  if (!poly) return null;
  const pts = [];
  for (let i = 0; i < poly.length; i += 2) pts.push([poly[i], poly[i + 1]]);
  if (pts.length <= 3) return poly;
  let far = 1, best = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const chainA = pts.slice(0, far + 1);
  const chainB = [...pts.slice(far), pts[0]];
  let eps = epsilon;
  let result = pts;
  for (let guard2 = 0; guard2 < 60; guard2++) {
    const a = rdp(chainA, eps);
    const b = rdp(chainB, eps);
    const ring = [...a.slice(0, -1), ...b.slice(0, -1)];
    if (ring.length < 3) break;
    result = ring;
    if (ring.length <= maxPoints) break;
    eps *= 1.3;
  }
  if (result.length > maxPoints) {
    const step = result.length / maxPoints;
    result = Array.from({ length: maxPoints }, (_, i) => result[Math.floor(i * step)]);
  }
  return result.flat().map((n) => Math.round(n * 1e3) / 1e3);
}
function polyToLocal(p, bboxFrac) {
  const poly = normalizePoly(p);
  const bb = normalizeFrac(bboxFrac);
  if (!poly || !bb) return null;
  const out = [];
  for (let i = 0; i < poly.length; i += 2) {
    out.push(Math.round((poly[i] - bb[0]) / bb[2] * 1e6) / 1e6, Math.round((poly[i + 1] - bb[1]) / bb[3] * 1e6) / 1e6);
  }
  return out;
}
var num = (n) => String(Math.round(n * 1e3) / 1e3);
function clipSvgToPolygon(svgString, localPoints) {
  const pts = normalizePoly(localPoints);
  if (!pts) throw new TypeError("clipSvgToPolygon: bad polygon");
  const open4 = /<svg\b[^>]*>/.exec(svgString);
  const closeIdx = svgString.lastIndexOf("</svg>");
  if (!open4 || closeIdx < open4.index + open4[0].length) throw new TypeError("clipSvgToPolygon: no <svg> root");
  const tag = open4[0];
  const vb = /\sviewBox\s*=\s*["']\s*(-?[\d.eE+-]+)[\s,]+(-?[\d.eE+-]+)[\s,]+([\d.eE+-]+)[\s,]+([\d.eE+-]+)\s*["']/.exec(tag);
  let minX = 0, minY = 0, w, h;
  if (vb) [minX, minY, w, h] = vb.slice(1).map(Number);
  else {
    w = Number(/\swidth\s*=\s*["']([\d.]+)/.exec(tag)?.[1]);
    h = Number(/\sheight\s*=\s*["']([\d.]+)/.exec(tag)?.[1]);
  }
  if (!(w > 0) || !(h > 0)) throw new TypeError("clipSvgToPolygon: no size");
  const coords = [];
  for (let i = 0; i < pts.length; i += 2) coords.push(`${num(minX + pts[i] * w)},${num(minY + pts[i + 1] * h)}`);
  const attr = coords.join(" ");
  const id = `plexus-clip-${fnv1a(attr)}`;
  const head = svgString.slice(0, open4.index + tag.length);
  const body = svgString.slice(open4.index + tag.length, closeIdx);
  return `${head}<defs><clipPath id="${id}"><polygon points="${attr}"/></clipPath></defs><g clip-path="url(#${id})">${body}</g>${svgString.slice(closeIdx)}`;
}
function thumbnailSize({ width, height, maxWidth }) {
  if (!(width > 0) || !(height > 0)) return { width: 1, height: 1 };
  const scale = maxWidth > 0 ? Math.min(1, maxWidth / width) : 1;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// src/model/scene.js
var VIEW_EXPORT_PADDING = 10;
var CURVE_SAMPLES = 24;
function pick(props, name) {
  if (!props || typeof props !== "object") return void 0;
  for (const key of [`:excalidraw/${name}`, `excalidraw/${name}`, name]) {
    if (props[key] !== void 0 && props[key] !== null) return props[key];
  }
  return void 0;
}
function parseJson(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return void 0;
  }
}
function parseDrawingProps(props) {
  const raw = pick(props, "elements-json");
  if (raw === void 0) return null;
  const elements = parseJson(raw);
  if (!Array.isArray(elements)) return null;
  const state = parseJson(pick(props, "state-json"));
  return {
    elements,
    appState: state && typeof state === "object" && !Array.isArray(state) ? state : {},
    version: pick(props, "version") ?? null,
    instanceId: pick(props, "instance-id") ?? null,
    elementsJson: typeof raw === "string" ? raw : JSON.stringify(raw)
  };
}
function liveElements(elements) {
  return Array.isArray(elements) ? elements.filter((el) => el && !el.isDeleted) : [];
}
function rotate(px, py, cx, cy, angle) {
  if (!angle) return [px, py];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = px - cx;
  const dy = py - cy;
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
}
function boundsOf(points) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const [x, y] of points) {
    if (x < x1) x1 = x;
    if (y < y1) y1 = y;
    if (x > x2) x2 = x;
    if (y > y2) y2 = y;
  }
  return [x1, y1, x2, y2];
}
function curveToBezier(pointsIn) {
  const len = pointsIn.length;
  if (len === 3) return [pointsIn[0], pointsIn[1], pointsIn[2], pointsIn[2]];
  const pts = [pointsIn[0], pointsIn[0]];
  for (let i = 1; i < len; i++) {
    pts.push(pointsIn[i]);
    if (i === len - 1) pts.push(pointsIn[i]);
  }
  const s = 1;
  const b = [[pts[0][0], pts[0][1]]];
  for (let i = 1; i + 2 < pts.length; i++) {
    const p = pts[i];
    b.push([p[0] + (s * pts[i + 1][0] - s * pts[i - 1][0]) / 6, p[1] + (s * pts[i + 1][1] - s * pts[i - 1][1]) / 6]);
    b.push([pts[i + 1][0] + (s * pts[i][0] - s * pts[i + 2][0]) / 6, pts[i + 1][1] + (s * pts[i][1] - s * pts[i + 2][1]) / 6]);
    b.push([pts[i + 1][0], pts[i + 1][1]]);
  }
  return b;
}
function sampleCurve(points) {
  const b = curveToBezier(points);
  const out = [];
  for (let i = 0; i + 3 < b.length; i += 3) {
    const [p0, p1, p2, p3] = [b[i], b[i + 1], b[i + 2], b[i + 3]];
    for (let k = 0; k <= CURVE_SAMPLES; k++) {
      const t = k / CURVE_SAMPLES;
      const u = 1 - t;
      const a = u * u * u, bb = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
      out.push([a * p0[0] + bb * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + bb * p1[1] + c * p2[1] + d * p3[1]]);
    }
  }
  return out;
}
function elementBounds(el) {
  const x = Number(el.x) || 0;
  const y = Number(el.y) || 0;
  const w = Number(el.width) || 0;
  const h = Number(el.height) || 0;
  const angle = Number(el.angle) || 0;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rot = (px, py) => rotate(px, py, cx, cy, angle);
  const corners = () => boundsOf([rot(x, y), rot(x + w, y), rot(x + w, y + h), rot(x, y + h)]);
  switch (el.type) {
    case "diamond":
      return boundsOf([rot(cx, y), rot(x + w, cy), rot(cx, y + h), rot(x, cy)]);
    case "ellipse": {
      const a = w / 2, b = h / 2;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const hx = Math.sqrt((a * cos) ** 2 + (b * sin) ** 2);
      const hy = Math.sqrt((a * sin) ** 2 + (b * cos) ** 2);
      return [cx - hx, cy - hy, cx + hx, cy + hy];
    }
    case "line":
    case "arrow":
    case "freedraw": {
      const pts = Array.isArray(el.points) ? el.points.filter((p) => Array.isArray(p) && p.length >= 2) : [];
      if (!pts.length) return corners();
      const [lx1, ly1, lx2, ly2] = boundsOf(pts);
      const pcx = x + (lx1 + lx2) / 2;
      const pcy = y + (ly1 + ly2) / 2;
      const curved = (el.type === "line" || el.type === "arrow") && el.roundness != null && el.elbowed !== true && pts.length >= 3;
      const source = curved ? [...pts, ...sampleCurve(pts)] : pts;
      return boundsOf(source.map(([px, py]) => rotate(x + px, y + py, pcx, pcy, angle)));
    }
    default:
      return corners();
  }
}
function commonBounds(elements) {
  const live = liveElements(elements);
  if (!live.length) return null;
  const all = live.map(elementBounds);
  return [
    Math.min(...all.map((b) => b[0])),
    Math.min(...all.map((b) => b[1])),
    Math.max(...all.map((b) => b[2])),
    Math.max(...all.map((b) => b[3]))
  ];
}
var FRAME_LABEL_HEIGHT = 20.5;
var showsFrameLabel = (appState) => appState?.frameRendering?.name !== false;
function exportBounds(elements, appState) {
  const cb = commonBounds(elements);
  if (!cb || !showsFrameLabel(appState)) return cb;
  let [x1, y1, x2, y2] = cb;
  for (const el of liveElements(elements)) {
    if (el.type !== "frame" && el.type !== "magicframe") continue;
    const b = elementBounds(el);
    x1 = Math.min(x1, b[0]);
    y1 = Math.min(y1, b[1] - FRAME_LABEL_HEIGHT);
    x2 = Math.max(x2, b[2]);
  }
  return [x1, y1, x2, y2];
}
function validCrop(c) {
  return !!c && c.width > 0 && c.height > 0 && c.naturalWidth > 0 && c.naturalHeight > 0;
}
function naturalToScene(el, [nx, ny]) {
  const c = el.crop;
  if (!validCrop(c)) return [el.x + nx * el.width, el.y + ny * el.height];
  return [
    el.x + (nx * c.naturalWidth - c.x) * el.width / c.width,
    el.y + (ny * c.naturalHeight - c.y) * el.height / c.height
  ];
}
function sceneToNatural(el, [sx, sy]) {
  const c = el.crop;
  if (!validCrop(c)) return [(sx - el.x) / el.width, (sy - el.y) / el.height];
  return [
    (c.x + (sx - el.x) * c.width / el.width) / c.naturalWidth,
    (c.y + (sy - el.y) * c.height / el.height) / c.naturalHeight
  ];
}
function regionSceneBBox(region, elements, appState, index) {
  const live = index?.live ?? liveElements(elements);
  const lookup = (id) => index?.byId ? index.byId.get(id) : live.find((e) => e.id === id);
  if (!region || !live.length) return { error: "no-elements" };
  if (region.kind === "area") {
    const byId = index?.byId ?? new Map(live.map((el) => [el.id, el]));
    const found = [];
    const missing = [];
    for (const id of region.ids ?? []) {
      if (byId.has(id)) found.push(byId.get(id));
      else missing.push(id);
    }
    if (!found.length) return { error: "no-elements" };
    const b = commonBounds(found);
    const pad = region.pad ?? 10;
    return { bbox: [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad], missing };
  }
  if (region.kind === "rect" || region.kind === "poly") {
    const el = lookup(region.el);
    if (!el) return { error: "no-elements" };
    if (el.type !== "image") return { error: "not-image" };
    if (Number(el.angle) || 0) return { error: "rotated-image" };
    const [rx, ry, rw, rh] = region.kind === "rect" ? region.f : polyBBox(region.p) ?? [0, 0, 0, 0];
    if (!(rw > 0) || !(rh > 0)) return { error: "no-elements" };
    if (!validCrop(el.crop)) {
      return {
        bbox: [el.x + rx * el.width, el.y + ry * el.height, el.x + (rx + rw) * el.width, el.y + (ry + rh) * el.height],
        missing: []
      };
    }
    if (region.kind === "poly") {
      const disp = [];
      for (let i = 0; i + 1 < region.p.length; i += 2) {
        const [sx, sy] = naturalToScene(el, [region.p[i], region.p[i + 1]]);
        disp.push((sx - el.x) / el.width, (sy - el.y) / el.height);
      }
      const clipped = clipPolyToUnit(disp);
      if (!clipped) return { error: "outside-crop" };
      let cx1 = Infinity, cy1 = Infinity, cx2 = -Infinity, cy2 = -Infinity;
      for (let i = 0; i < clipped.length; i += 2) {
        cx1 = Math.min(cx1, clipped[i]);
        cx2 = Math.max(cx2, clipped[i]);
        cy1 = Math.min(cy1, clipped[i + 1]);
        cy2 = Math.max(cy2, clipped[i + 1]);
      }
      return { bbox: [el.x + cx1 * el.width, el.y + cy1 * el.height, el.x + cx2 * el.width, el.y + cy2 * el.height], missing: [] };
    }
    const [ax, ay] = naturalToScene(el, [rx, ry]);
    const [bx, by] = naturalToScene(el, [rx + rw, ry + rh]);
    const x1 = Math.max(ax, el.x), y1 = Math.max(ay, el.y);
    const x2 = Math.min(bx, el.x + el.width), y2 = Math.min(by, el.y + el.height);
    if (!(x2 > x1) || !(y2 > y1)) return { error: "outside-crop" };
    return { bbox: [x1, y1, x2, y2], missing: [] };
  }
  if (region.kind === "group") {
    const g = region.groupId ?? region.g;
    let members;
    if (index) {
      if (!index.byGroup) {
        index.byGroup = /* @__PURE__ */ new Map();
        for (const el of live) for (const gid of Array.isArray(el.groupIds) ? el.groupIds : []) (index.byGroup.get(gid) ?? index.byGroup.set(gid, []).get(gid)).push(el);
      }
      members = index.byGroup.get(g) ?? [];
    } else {
      members = live.filter((el) => Array.isArray(el.groupIds) && el.groupIds.includes(g));
    }
    if (!members.length) return { error: "no-elements" };
    const b = commonBounds(members);
    const pad = region.pad ?? 10;
    return { bbox: [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad], missing: [] };
  }
  if (region.kind === "frame" || region.kind === "cframe") {
    const id = region.frameId ?? region.fr;
    const frame = lookup(id);
    if (!frame) return { error: "no-elements" };
    if (frame.type !== "frame" && frame.type !== "magicframe") return { error: "not-frame" };
    const b = elementBounds(frame);
    const pad = region.kind === "cframe" ? 0 : region.pad ?? 10;
    let top = b[1] - pad;
    if (region.kind === "frame" && showsFrameLabel(appState)) top = b[1] - pad - FRAME_LABEL_HEIGHT;
    return { bbox: [b[0] - pad, top, b[2] + pad, b[3] + pad], missing: [] };
  }
  return { error: "unsupported-kind" };
}
function viewPngCropRect({ elements, appState, bbox, naturalWidth, naturalHeight, padding = VIEW_EXPORT_PADDING }) {
  const cb = exportBounds(elements, appState);
  if (!cb || !bbox) return { error: "bounds-mismatch", expected: [0, 0], actual: [naturalWidth, naturalHeight] };
  const ew = Math.round(cb[2] - cb[0] + 2 * padding);
  const eh = Math.round(cb[3] - cb[1] + 2 * padding);
  if (Math.abs(naturalWidth - ew) > 2 || Math.abs(naturalHeight - eh) > 2) {
    return { error: "bounds-mismatch", expected: [ew, eh], actual: [naturalWidth, naturalHeight] };
  }
  const ox = cb[0] - padding;
  const oy = cb[1] - padding;
  const x1 = Math.min(naturalWidth - 1, Math.max(0, Math.round(bbox[0] - ox)));
  const y1 = Math.min(naturalHeight - 1, Math.max(0, Math.round(bbox[1] - oy)));
  const x2 = Math.min(naturalWidth, Math.max(x1 + 1, Math.round(bbox[2] - ox)));
  const y2 = Math.min(naturalHeight, Math.max(y1 + 1, Math.round(bbox[3] - oy)));
  return { sx: x1, sy: y1, sw: x2 - x1, sh: y2 - y1 };
}
function fitZoom({ bbox, viewportWidth, viewportHeight, margin = 0.12, minZoom = 0.1, maxZoom = 4 }) {
  const bw = Math.max(bbox[2] - bbox[0], 1);
  const bh = Math.max(bbox[3] - bbox[1], 1);
  const raw = Math.min(viewportWidth * (1 - 2 * margin) / bw, viewportHeight * (1 - 2 * margin) / bh);
  const zoom = Math.min(maxZoom, Math.max(minZoom, raw));
  const cx = (bbox[0] + bbox[2]) / 2;
  const cy = (bbox[1] + bbox[3]) / 2;
  return { zoom, scrollX: viewportWidth / (2 * zoom) - cx, scrollY: viewportHeight / (2 * zoom) - cy };
}
function view(appState) {
  const z = appState?.zoom;
  return {
    zoom: (typeof z === "number" ? z : z?.value) || 1,
    scrollX: appState?.scrollX || 0,
    scrollY: appState?.scrollY || 0,
    left: appState?.offsetLeft || 0,
    top: appState?.offsetTop || 0
  };
}
function sceneToViewport({ x, y, appState }) {
  const v = view(appState);
  return { x: (x + v.scrollX) * v.zoom + v.left, y: (y + v.scrollY) * v.zoom + v.top };
}
function viewportToScene({ x, y, appState }) {
  const v = view(appState);
  return { x: (x - v.left) / v.zoom - v.scrollX, y: (y - v.top) / v.zoom - v.scrollY };
}
function rectToFraction(dragRect, imageRect) {
  if (!dragRect || !imageRect || !(imageRect.width > 0) || !(imageRect.height > 0)) return null;
  const x1 = Math.max(dragRect.left, imageRect.left);
  const y1 = Math.max(dragRect.top, imageRect.top);
  const x2 = Math.min(dragRect.left + dragRect.width, imageRect.left + imageRect.width);
  const y2 = Math.min(dragRect.top + dragRect.height, imageRect.top + imageRect.height);
  if (x2 - x1 < 4 || y2 - y1 < 4) return null;
  return normalizeFrac({
    rx: (x1 - imageRect.left) / imageRect.width,
    ry: (y1 - imageRect.top) / imageRect.height,
    rw: (x2 - x1) / imageRect.width,
    rh: (y2 - y1) / imageRect.height
  });
}
var fmt = (n) => String(Math.round(n * 1e3) / 1e3);
function setAttr(tag, name, value) {
  const re = new RegExp(`(\\s${name}\\s*=\\s*)(["'])[^"']*\\2`);
  if (re.test(tag)) return tag.replace(re, `$1"${value}"`);
  return tag.replace(/\s*(\/?)>$/, ` ${name}="${value}"$1>`);
}
function cropSvgToFraction(svgString, f, pad = VIEW_EXPORT_PADDING) {
  const frac = normalizeFrac(f);
  if (!frac) throw new TypeError("cropSvgToFraction: bad fraction");
  const m = /<svg\b[^>]*>/.exec(svgString);
  if (!m) throw new TypeError("cropSvgToFraction: no <svg> root");
  const tag = m[0];
  const vb = /\sviewBox\s*=\s*["']\s*(-?[\d.eE+-]+)[\s,]+(-?[\d.eE+-]+)[\s,]+([\d.eE+-]+)[\s,]+([\d.eE+-]+)\s*["']/.exec(tag);
  if (!vb) throw new TypeError("cropSvgToFraction: no viewBox");
  const [minX, minY, vw, vh] = vb.slice(1).map(Number);
  const wAttr = /\swidth\s*=\s*["']([\d.]+)(?:px)?["']/.exec(tag);
  const hAttr = /\sheight\s*=\s*["']([\d.]+)(?:px)?["']/.exec(tag);
  const sx = wAttr && vw > 0 ? Number(wAttr[1]) / vw : 1;
  const sy = hAttr && vh > 0 ? Number(hAttr[1]) / vh : 1;
  const ew = vw - 2 * pad;
  const eh = vh - 2 * pad;
  const [rx, ry, rw, rh] = frac;
  const nx = minX + pad + rx * ew;
  const ny = minY + pad + ry * eh;
  const nw = rw * ew;
  const nh = rh * eh;
  let next = setAttr(tag, "viewBox", `${fmt(nx)} ${fmt(ny)} ${fmt(nw)} ${fmt(nh)}`);
  next = setAttr(next, "width", fmt(nw * sx));
  next = setAttr(next, "height", fmt(nh * sy));
  return svgString.slice(0, m.index) + next + svgString.slice(m.index + tag.length);
}
var fmt2 = (n) => String(Math.round(n * 100) / 100);
function normalizeSvgSize(svgString) {
  const m = /<svg\b[^>]*>/.exec(svgString);
  if (!m) return svgString;
  const tag = m[0];
  const vb = /\sviewBox\s*=\s*["']\s*(-?[\d.eE+-]+)[\s,]+(-?[\d.eE+-]+)[\s,]+([\d.eE+-]+)[\s,]+([\d.eE+-]+)\s*["']/.exec(tag);
  if (!vb) return svgString;
  const vw = Number(vb[3]);
  const vh = Number(vb[4]);
  if (!(vw > 0) || !(vh > 0)) return svgString;
  let next = setAttr(tag, "width", fmt2(vw));
  next = setAttr(next, "height", fmt2(vh));
  return svgString.slice(0, m.index) + next + svgString.slice(m.index + tag.length);
}

// src/host/roam.js
var PULL_PATTERN = "[:block/uid :block/string :edit/time :block/open :block/props {:block/children [:block/uid :block/string :block/order]}]";
var DRAWING_MEMO_CAP = 64;
var DRAWING_STRING = "{{[[excalidraw]]}}";
var DRAWING_START = /^(\{\{\[\[excalidraw\]\]\}\}|\{\{excalidraw\}\})/;
var DRAWINGS_CAP = 50;
var EMBED_CAP = 30;
var EMBED_PATTERN = "[:block/uid :block/string :node/title {:block/page [:node/title]} {:block/children [:block/uid :block/string :block/order {:block/children [:block/uid :block/string :block/order]}]}]";
var EMBED_UID = /^[A-Za-z0-9_-]{9}$/;
var CARDS_STRING = "{{[[plexus-cards]]}}";
var PATH_CAP = 100;
function parseEmbedTarget(ref) {
  const text = String(ref ?? "").trim();
  let m = /^\(\(([^()]+)\)\)$/.exec(text);
  if (m) return { uid: m[1] };
  m = /^\[\[([\s\S]+)\]\]$/.exec(text);
  if (m) return { title: m[1] };
  return EMBED_UID.test(text) ? { uid: text } : null;
}
var byOrder = (a, b) => (a[":block/order"] ?? 0) - (b[":block/order"] ?? 0);
function normalizeProps(props) {
  if (typeof props === "string") {
    try {
      return JSON.parse(props);
    } catch {
      return null;
    }
  }
  return props && typeof props === "object" ? props : null;
}
function createRoamHost({ api = globalThis.roamAlphaAPI, withLockFn = withLock, parseProps = parseDrawingProps, hashFn = fnv1a } = {}) {
  const memo3 = /* @__PURE__ */ new Map();
  function pullBlock(uid) {
    if (!uid) return null;
    const raw = api.data.pull(PULL_PATTERN, [":block/uid", uid]);
    if (!raw || !raw[":block/uid"]) return null;
    const children = (raw[":block/children"] || []).map((c) => ({ uid: c[":block/uid"], string: c[":block/string"] ?? "", order: c[":block/order"] ?? 0 })).sort((a, b) => a.order - b.order);
    return {
      uid: raw[":block/uid"],
      string: raw[":block/string"] ?? "",
      editTime: raw[":edit/time"] ?? 0,
      open: raw[":block/open"] !== false,
      props: normalizeProps(raw[":block/props"]),
      children
    };
  }
  function drawing(uid) {
    const block = pullBlock(uid);
    if (!block) return null;
    const cached = memo3.get(uid);
    if (cached && cached.editTime === block.editTime) {
      memo3.delete(uid);
      memo3.set(uid, cached);
      return cached.value;
    }
    const parsed = block.props ? parseProps(block.props) : null;
    const value = parsed ? { ...parsed, uid, editTime: block.editTime, hash: hashFn(parsed.elementsJson ?? "") } : null;
    memo3.delete(uid);
    memo3.set(uid, { editTime: block.editTime, value });
    while (memo3.size > DRAWING_MEMO_CAP) memo3.delete(memo3.keys().next().value);
    return value;
  }
  function findContainer(block) {
    return block?.children.find((c) => isContainerString(c.string)) || null;
  }
  function regionsOf(drawingUid) {
    const container = findContainer(pullBlock(drawingUid));
    if (!container) return [];
    const full = pullBlock(container.uid);
    if (!full) return [];
    const out = [];
    for (const child of full.children) {
      const region = parseRegion(child.string);
      if (region) out.push({ uid: child.uid, string: child.string, region });
    }
    return out;
  }
  function labelSource(uid) {
    if (!uid) return null;
    const raw = api.data.pull("[:block/uid :block/string {:block/_children [:node/title]}]", [":block/uid", uid]);
    if (!raw || !raw[":block/uid"]) return null;
    const parents = raw[":block/_children"];
    const parent = Array.isArray(parents) ? parents[0] : parents;
    return { string: raw[":block/string"] ?? "", pageTitle: parent?.[":node/title"] ?? null };
  }
  const REGION_ROWS_QUERY = `[:find ?u ?s ?cu :where [?c :block/string "${CONTAINER_STRING}"] [?c :block/uid ?cu] [?c :block/children ?b] [?b :block/uid ?u] [?b :block/string ?s]]`;
  function allRegionBlocks() {
    const rows = api.data.q(REGION_ROWS_QUERY) || [];
    return rows.map((r) => ({ uid: r[0], string: String(r[1] ?? ""), containerUid: r[2] })).sort((a, b) => a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0);
  }
  async function ensureRegionContainer(drawingUid) {
    const existing = findContainer(pullBlock(drawingUid));
    if (existing) return existing.uid;
    const uid = `p${hashFn(drawingUid)}`;
    try {
      await api.data.block.create({
        location: { "parent-uid": drawingUid, order: "last" },
        block: { uid, string: CONTAINER_STRING, open: false }
      });
    } catch (error) {
      const found = findContainer(pullBlock(drawingUid));
      if (found) return found.uid;
      if (!pullBlock(uid)) throw error;
    }
    return uid;
  }
  async function createRegion(parentUid, regionString) {
    const graph = api.graph.name;
    const lock = await withLockFn(lockName(graph, parentUid), async () => {
      const containerUid = await ensureRegionContainer(parentUid);
      const uid = api.util.generateUID();
      await api.data.block.create({
        location: { "parent-uid": containerUid, order: "last" },
        block: { uid, string: regionString }
      });
      return uid;
    });
    if (!lock.acquired) throw new Error("[plexus] could not acquire drawing lock");
    return lock.value;
  }
  async function createRegions(drawingUid, regionStrings) {
    const graph = api.graph.name;
    const made = [];
    const lock = await withLockFn(lockName(graph, drawingUid), async () => {
      const containerUid = await ensureRegionContainer(drawingUid);
      for (const string of regionStrings || []) {
        const uid = api.util.generateUID();
        try {
          await api.data.block.create({
            location: { "parent-uid": containerUid, order: "last" },
            block: { uid, string }
          });
        } catch (error) {
          console.warn("[plexus] create regions stopped", error);
          break;
        }
        made.push(uid);
      }
      return made;
    });
    if (!lock.acquired) throw new Error("[plexus] could not acquire drawing lock");
    return lock.value;
  }
  async function updateRegionString(drawingUid, regionUid, regionString, { expect } = {}) {
    const graph = api.graph.name;
    const lock = await withLockFn(lockName(graph, drawingUid), async () => {
      if (expect !== void 0 && pullBlock(regionUid)?.string !== expect) {
        throw Object.assign(new Error("[plexus] region changed elsewhere"), { code: "changed" });
      }
      await api.data.block.update({ block: { uid: regionUid, string: regionString } });
      return regionUid;
    });
    if (!lock.acquired) throw new Error("[plexus] could not acquire drawing lock");
    return lock.value;
  }
  const AUDIT_REGION_QUERY = (page) => `[:find ?u ?s ?pu ?ps ?pt ${page ? ":in $ ?pg" : ""} :where [?r :node/title "plexus-region"] [?b :block/refs ?r] [?b :block/uid ?u] [?b :block/string ?s] [?b :block/page ?p] [?p :block/uid ?pg2] [?p :node/title ?pt] ${page ? "[(= ?pg2 ?pg)]" : ""} [?par :block/children ?b] [?par :block/uid ?pu] [(get-else $ ?par :block/string "") ?ps]]`;
  const AUDIT_CONTAINER_QUERY = (page) => `[:find ?cu ?pu ?ps ?pt ${page ? ":in $ ?pg" : ""} :where [?c :block/string "${CONTAINER_STRING}"] [?c :block/uid ?cu] [?c :block/page ?p] [?p :block/uid ?pg2] [?p :node/title ?pt] ${page ? "[(= ?pg2 ?pg)]" : ""} [?par :block/children ?c] [?par :block/uid ?pu] [(get-else $ ?par :block/string "") ?ps]]`;
  const byUid = (a, b) => a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
  async function openPageUid() {
    let uid;
    try {
      uid = await api.ui?.mainWindow?.getOpenPageOrBlockUid?.();
    } catch {
      uid = null;
    }
    if (!uid) return null;
    let raw;
    try {
      raw = api.data.pull("[:node/title {:block/page [:block/uid]}]", [":block/uid", uid]);
    } catch {
      raw = null;
    }
    if (!raw) return null;
    if (raw[":node/title"] != null) return uid;
    const page = raw[":block/page"];
    return (Array.isArray(page) ? page[0] : page)?.[":block/uid"] ?? null;
  }
  function regionBlocksForAudit({ pageUid } = {}) {
    const rows = (pageUid ? api.data.q(AUDIT_REGION_QUERY(true), pageUid) : api.data.q(AUDIT_REGION_QUERY(false))) || [];
    return rows.map((r) => ({ uid: r[0], string: String(r[1] ?? ""), parentUid: r[2], parentString: String(r[3] ?? ""), pageTitle: r[4] ?? null })).sort(byUid);
  }
  function containersForAudit({ pageUid } = {}) {
    const rows = (pageUid ? api.data.q(AUDIT_CONTAINER_QUERY(true), pageUid) : api.data.q(AUDIT_CONTAINER_QUERY(false))) || [];
    return rows.map((r) => ({ uid: r[0], ownerUid: r[1], ownerString: String(r[2] ?? ""), pageTitle: r[3] ?? null })).sort(byUid);
  }
  function pageUidByTitle(title) {
    const raw = api.data.pull("[:block/uid]", [":node/title", title]);
    return raw?.[":block/uid"] || null;
  }
  function resolveUidKind(uid) {
    if (!uid) return null;
    const raw = api.data.pull("[:node/title :block/string]", [":block/uid", uid]);
    if (!raw) return null;
    if (raw[":node/title"] != null) return "page";
    if (raw[":block/string"] != null) return "block";
    return null;
  }
  async function ensurePage(title) {
    const existing = pageUidByTitle(title);
    if (existing) return existing;
    let uid;
    try {
      const date = api.util?.pageTitleToDate?.(title);
      if (date instanceof Date && !Number.isNaN(date.getTime()) && typeof api.util.dateToPageUid === "function") uid = api.util.dateToPageUid(date);
    } catch {
      uid = void 0;
    }
    uid = uid || api.util.generateUID();
    try {
      await api.data.page.create({ page: { title, uid } });
    } catch (error) {
      const found = pageUidByTitle(title);
      if (found) return found;
      throw error;
    }
    return pageUidByTitle(title) || uid;
  }
  async function createDrawing({ pageUid, parentUid, title, order = "last" } = {}) {
    let page = pageUid;
    let parent = parentUid || pageUid;
    if (title) {
      page = await ensurePage(`Drawings/${title}`);
      parent = page;
    }
    if (!parent) throw new Error("[plexus] createDrawing needs pageUid, parentUid, or title");
    const uid = api.util.generateUID();
    await api.data.block.create({
      location: { "parent-uid": parent, order },
      block: { uid, string: DRAWING_STRING }
    });
    return { uid, pageUid: page || null };
  }
  const BLOCK_INFO_PATTERN = "[:block/uid :block/string :block/order :node/title {:block/_children [:block/uid :block/string :node/title]} {:block/page [:block/uid :node/title]}]";
  const one = (v) => Array.isArray(v) ? v[0] : v;
  function blockInfo(uid) {
    if (!uid) return null;
    let raw;
    try {
      raw = api.data.pull(BLOCK_INFO_PATTERN, [":block/uid", uid]);
    } catch {
      raw = null;
    }
    if (!raw || !raw[":block/uid"] || raw[":node/title"] != null) return null;
    const parent = one(raw[":block/_children"]);
    const page = one(raw[":block/page"]);
    return {
      uid: raw[":block/uid"],
      string: raw[":block/string"] ?? "",
      order: raw[":block/order"] ?? 0,
      parentUid: parent?.[":block/uid"] ?? null,
      parentString: parent?.[":block/string"] ?? "",
      parentIsPage: parent?.[":node/title"] != null,
      pageUid: page?.[":block/uid"] ?? null,
      pageTitle: page?.[":node/title"] ?? null
    };
  }
  function parentOf(uid) {
    const info = blockInfo(uid);
    if (!info || !info.parentUid) return null;
    return {
      uid: info.parentUid,
      isPage: info.parentIsPage,
      title: info.parentIsPage ? info.pageTitle : info.parentString,
      pageTitle: info.pageTitle
    };
  }
  function topAncestor(uid) {
    let cur = uid;
    for (let i = 0; i < PATH_CAP && cur; i++) {
      const info = blockInfo(cur);
      if (!info) return null;
      if (info.parentIsPage) return { uid: info.uid, order: info.order, pageUid: info.parentUid };
      cur = info.parentUid;
    }
    return null;
  }
  function blockPaths(uids) {
    const nodes = /* @__PURE__ */ new Map();
    const node = (uid) => {
      if (nodes.has(uid)) return nodes.get(uid);
      let value = null;
      try {
        const raw = api.data.pull("[:block/uid :block/order :node/title {:block/_children [:block/uid :node/title]}]", [":block/uid", uid]);
        if (raw && raw[":block/uid"]) {
          const parent = one(raw[":block/_children"]);
          value = { order: raw[":block/order"] ?? 0, isPage: raw[":node/title"] != null, parentUid: parent?.[":block/uid"] ?? null, parentIsPage: parent?.[":node/title"] != null };
        }
      } catch {
        value = null;
      }
      nodes.set(uid, value);
      return value;
    };
    const out = /* @__PURE__ */ new Map();
    for (const uid of uids || []) {
      const own = node(uid);
      if (!own || own.isPage) continue;
      const ancestors = [];
      const orders = [own.order];
      let cur = own;
      for (let i = 0; i < PATH_CAP && cur && !cur.parentIsPage && cur.parentUid; i++) {
        ancestors.unshift(cur.parentUid);
        cur = node(cur.parentUid);
        if (cur) orders.unshift(cur.order);
      }
      out.set(uid, { ancestors, orders });
    }
    return out;
  }
  function pageTitleOf(pageUid) {
    if (!pageUid) return null;
    try {
      return api.data.pull("[:node/title]", [":block/uid", pageUid])?.[":node/title"] ?? null;
    } catch {
      return null;
    }
  }
  async function createBlock({ parentUid, order = "last", string = "", uid, open: open4 } = {}) {
    if (!parentUid) throw new Error("[plexus] createBlock needs parentUid");
    const id = uid || api.util.generateUID();
    await api.data.block.create({
      location: { "parent-uid": parentUid, order },
      block: { uid: id, string, ...open4 === void 0 ? {} : { open: open4 } }
    });
    return id;
  }
  async function deleteBlock(uid) {
    await api.data.block.delete({ block: { uid } });
    return true;
  }
  async function ensureCardsContainer(drawingUid) {
    const find = () => pullBlock(drawingUid)?.children.find((c) => c.string.trim() === CARDS_STRING) || null;
    const existing = find();
    if (existing) return existing.uid;
    const uid = `c${hashFn(drawingUid)}`;
    try {
      await api.data.block.create({
        location: { "parent-uid": drawingUid, order: "last" },
        block: { uid, string: CARDS_STRING, open: false }
      });
    } catch (error) {
      const found = find();
      if (found) return found.uid;
      if (!pullBlock(uid)) throw error;
    }
    return uid;
  }
  async function createCard(drawingUid) {
    const lock = await withLockFn(lockName(api.graph.name, drawingUid), async () => {
      const containerUid = await ensureCardsContainer(drawingUid);
      return createBlock({ parentUid: containerUid, order: "last", string: "" });
    });
    if (!lock.acquired) throw new Error("[plexus] could not acquire drawing lock");
    return lock.value;
  }
  const DRAWINGS_QUERY = `[:find ?u ?s ?o :in $ ?pu :where [?p :block/uid ?pu] [?b :block/page ?p] [?b :block/uid ?u] [?b :block/string ?s] [?b :block/order ?o] (or [(clojure.string/starts-with? ?s "{{[[excalidraw]]}}")] [(clojure.string/starts-with? ?s "{{excalidraw}}")])]`;
  function firstDrawingChild(pageUid) {
    if (!pageUid) return null;
    let raw;
    try {
      raw = api.data.pull("[:block/uid {:block/children [:block/uid :block/string :block/order]}]", [":block/uid", pageUid]);
    } catch {
      raw = null;
    }
    const hit = [...raw?.[":block/children"] || []].sort(byOrder).find((c) => DRAWING_START.test(String(c[":block/string"] ?? "")));
    return hit?.[":block/uid"] ?? null;
  }
  function drawingsOn(pageUid) {
    if (!pageUid) return [];
    const rows = api.data.q(DRAWINGS_QUERY, pageUid) || [];
    return rows.filter((r) => DRAWING_START.test(String(r[1]))).sort((a, b) => (a[2] ?? 0) - (b[2] ?? 0)).slice(0, DRAWINGS_CAP).map((r) => r[0]);
  }
  async function openBlock(uid, { sidebar = false } = {}) {
    if (sidebar) {
      return api.ui.rightSidebar.addWindow({ window: { type: "block", "block-uid": uid } });
    }
    return api.ui.mainWindow.openBlock({ block: { uid } });
  }
  function blockUidFromNode(node) {
    const el = node && typeof node.closest === "function" ? node : node?.parentElement;
    if (!el || typeof el.closest !== "function") return null;
    const ref = el.closest(".rm-block-ref[data-uid]");
    if (ref?.dataset?.uid) return ref.dataset.uid;
    const input = el.closest('[id^="block-input-"]');
    if (input?.id) return input.id.slice(-9);
    return null;
  }
  function pullEmbedContent(ref) {
    const target = parseEmbedTarget(ref);
    if (!target) return null;
    let raw;
    try {
      raw = api.data.pull(EMBED_PATTERN, target.title != null ? [":node/title", target.title] : [":block/uid", target.uid]);
    } catch (error) {
      console.warn("[plexus] embed pull failed", error);
      return null;
    }
    if (!raw || !raw[":block/uid"]) return null;
    const isPage = raw[":node/title"] != null;
    let budget = EMBED_CAP;
    const take = (nodes, depth) => {
      const out = [];
      for (const n of [...nodes || []].sort(byOrder)) {
        if (budget <= 0) break;
        budget--;
        out.push({ string: n[":block/string"] ?? "", children: depth > 1 ? take(n[":block/children"], depth - 1) : [] });
      }
      return out;
    };
    return {
      kind: isPage ? "page" : "block",
      uid: raw[":block/uid"],
      title: isPage ? raw[":node/title"] : "",
      pageTitle: isPage ? "" : raw[":block/page"]?.[":node/title"] ?? "",
      string: isPage ? "" : raw[":block/string"] ?? "",
      children: take(raw[":block/children"], isPage ? 1 : 2)
    };
  }
  function watchEmbed(uid, cb) {
    if (!uid || typeof api.data?.addPullWatch !== "function") return () => {
    };
    const ident = `[:block/uid "${String(uid).replace(/["\\]/g, "")}"]`;
    const handler = (before, after) => {
      try {
        cb(before, after);
      } catch (error) {
        console.warn("[plexus] embed watch callback failed", error);
      }
    };
    api.data.addPullWatch(EMBED_PATTERN, ident, handler);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      try {
        api.data.removePullWatch(EMBED_PATTERN, ident, handler);
      } catch (error) {
        console.warn("[plexus] removePullWatch failed", error);
      }
    };
  }
  return {
    graphName() {
      return api.graph.name;
    },
    isEncrypted() {
      return !!api.graph.isEncrypted;
    },
    pullBlock,
    drawing,
    regionsOf,
    labelSource,
    allRegionBlocks,
    ensureRegionContainer,
    createRegion,
    createRegions,
    updateRegionString,
    openPageUid,
    regionBlocksForAudit,
    containersForAudit,
    createDrawing,
    ensurePage,
    pageUidByTitle,
    pageTitleOf,
    blockInfo,
    parentOf,
    topAncestor,
    blockPaths,
    createBlock,
    deleteBlock,
    ensureCardsContainer,
    createCard,
    firstDrawingChild,
    drawingsOn,
    resolveUidKind,
    openBlock,
    blockUidFromNode,
    pullEmbedContent,
    watchEmbed
  };
}

// src/host/native.js
var native_exports = {};
__export(native_exports, {
  activeEditor: () => activeEditor,
  addViaPaste: () => addViaPaste,
  captureSelectionPng: () => captureSelectionPng,
  captureSelectionSvg: () => captureSelectionSvg,
  clipboardBusy: () => clipboardBusy,
  findApp: () => findApp,
  insertElements: () => insertElements,
  looksLikeSvg: () => looksLikeSvg,
  readClipboardText: () => readClipboardText,
  readPngSize: () => readPngSize,
  selectedElementIds: () => selectedElementIds,
  subscribeViewport: () => subscribeViewport,
  viewportRectOf: () => viewportRectOf,
  waitNotLoading: () => waitNotLoading,
  withClipboard: () => withClipboard,
  zoomTo: () => zoomTo
});
function findApp(excalidrawEl) {
  if (!excalidrawEl) return null;
  const key = Object.keys(excalidrawEl).find((k) => k.startsWith("__reactFiber$"));
  if (!key) return null;
  let fiber = excalidrawEl[key];
  for (let i = 0; fiber && i <= 6; i++) {
    const node = fiber.stateNode;
    if (node && typeof node.updateScene === "function" && typeof node.getSceneElementsIncludingDeleted === "function" && node.actionManager && typeof node.actionManager === "object") return node;
    fiber = fiber.return;
  }
  return null;
}
function activeEditor(doc = globalThis.document) {
  const el = doc?.querySelector?.(".excalidraw-outer-container.full-screen .excalidraw");
  if (!el || el.closest?.(".plexus-offscreen") || el.closest?.(".plexus-dock")) return null;
  const outer = el.closest(".excalidraw-outer-container");
  const app = findApp(el);
  if (!app) return null;
  const block = outer?.closest?.('[id^="block-input-"]');
  return { el, app, outer, drawingUid: block?.id ? block.id.slice(-9) : null };
}
function selectedElementIds(app) {
  const sel = app?.state?.selectedElementIds || {};
  const deleted = new Set((app.getSceneElementsIncludingDeleted?.() || []).filter((e) => e.isDeleted).map((e) => e.id));
  return Object.keys(sel).filter((id) => sel[id] && !deleted.has(id));
}
var captureTail = Promise.resolve();
var capturing = 0;
var clipboardBusy = () => capturing > 0;
function captureSelectionSvg(app, ids, opts = {}) {
  capturing += 1;
  const run = captureTail.then(() => captureOnce(app, ids, opts));
  const done = () => {
    capturing -= 1;
  };
  run.then(done, done);
  captureTail = run.catch(() => {
  });
  return run;
}
function captureSelectionPng(app, ids, opts = {}) {
  capturing += 1;
  const run = captureTail.then(() => capturePngOnce(app, ids, opts).catch((error) => {
    console.warn("[plexus] png capture failed", error);
    return null;
  }));
  const done = () => {
    capturing -= 1;
  };
  run.then(done, done);
  captureTail = run.catch(() => {
  });
  return run;
}
async function readPngSize(blob) {
  try {
    const bytes = new Uint8Array(await blob.slice(0, 24).arrayBuffer());
    if (bytes.length < 24 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) return null;
    const view2 = new DataView(bytes.buffer, bytes.byteOffset, 24);
    return { w: view2.getUint32(16), h: view2.getUint32(20) };
  } catch {
    return null;
  }
}
function withClipboard(fn) {
  const run = captureTail.then(fn);
  captureTail = run.catch(() => {
  });
  return run;
}
var SVG_RE = /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>/]/;
var looksLikeSvg = (text) => SVG_RE.test(String(text));
async function pollToast(app, ms) {
  const end = Date.now() + ms;
  while (app.state?.toast == null && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => setTimeout(r, 0));
}
async function captureOnce(app, ids, { clipboard = globalThis.navigator?.clipboard, raf = globalThis.requestAnimationFrame, timeoutMs = 3e3, graceMs = 1500, doneWaitMs = 1e3 } = {}) {
  if (!clipboard) throw new Error("[plexus] clipboard unavailable");
  const prevIds = { ...app.state?.selectedElementIds || {} };
  const prevGroups = { ...app.state?.selectedGroupIds || {} };
  const origWriteText = clipboard.writeText;
  const origWrite = clipboard.write;
  let timer = null;
  let timedOut = false;
  let performed = null;
  const am = app.actionManager;
  const origUpdater = am?.updater;
  let wrapped = false;
  try {
    const selection = {};
    for (const id of ids) selection[id] = true;
    app.updateScene({ appState: { selectedElementIds: selection, selectedGroupIds: {} } });
    await new Promise((resolve) => typeof raf === "function" ? raf(() => resolve()) : setTimeout(resolve, 16));
    let settle;
    const captured = new Promise((resolve) => {
      settle = resolve;
    });
    const offer = (text) => {
      if (looksLikeSvg(text)) settle(String(text));
    };
    clipboard.writeText = async (text) => {
      offer(text);
    };
    clipboard.write = async (items) => {
      for (const item of items || []) {
        const type = item?.types?.find?.((t) => t === "text/plain" || t === "image/svg+xml");
        if (type) {
          offer(await (await item.getType(type)).text());
          return;
        }
      }
    };
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    const action = app.actionManager.actions.copyAsSvg;
    if (typeof origUpdater === "function") {
      wrapped = true;
      am.updater = function(result) {
        if (result && typeof result.then === "function") {
          performed = Promise.resolve(result);
          performed.catch(() => {
          });
        }
        return origUpdater.apply(this, arguments);
      };
    }
    const ret = am.executeAction(action, "api");
    if (!performed && ret && typeof ret.then === "function") {
      performed = Promise.resolve(ret);
      performed.catch(() => {
      });
    }
    const svg = await Promise.race([captured, timeout, ...performed ? [performed.then(() => timeout)] : []]);
    if (!svg) {
      timedOut = true;
      throw new Error("[plexus] no SVG captured");
    }
    return svg;
  } finally {
    if (timer) clearTimeout(timer);
    if (timedOut && graceMs > 0) {
      clipboard.writeText = async (text) => looksLikeSvg(text) ? void 0 : origWriteText.call(clipboard, text);
      clipboard.write = async (items) => {
        for (const item of items || []) {
          const type = item?.types?.find?.((t) => t === "text/plain" || t === "image/svg+xml");
          if (type && looksLikeSvg(await (await item.getType(type)).text())) return void 0;
        }
        return origWrite.call(clipboard, items);
      };
      await new Promise((resolve) => setTimeout(resolve, graceMs));
    }
    if (wrapped) am.updater = origUpdater;
    {
      let settleTimer = null;
      const wait = new Promise((resolve) => {
        settleTimer = setTimeout(resolve, doneWaitMs);
      });
      if (performed) await Promise.race([performed.catch(() => {
      }), wait]);
      else if (!wrapped && app.state?.toast == null) await pollToast(app, doneWaitMs);
      clearTimeout(settleTimer);
    }
    clipboard.writeText = origWriteText;
    clipboard.write = origWrite;
    try {
      app.updateScene({ appState: { selectedElementIds: prevIds, selectedGroupIds: prevGroups, toast: null } });
    } catch (error) {
      console.warn("[plexus] could not restore selection", error);
    }
  }
}
var pngItemType = (item) => item?.types?.find?.((t) => t === "image/png");
async function capturePngOnce(app, ids, { scale = 2, dark = false, clipboard = globalThis.navigator?.clipboard, raf = globalThis.requestAnimationFrame, timeoutMs = 3e3, graceMs = 1500, doneWaitMs = 1e3 } = {}) {
  if (!clipboard) throw new Error("clipboard unavailable");
  const action = app?.actionManager?.actions?.copyAsPng;
  if (!action || typeof app.actionManager.executeAction !== "function") throw new Error("copyAsPng unavailable");
  const prev = {
    exportScale: app.state?.exportScale ?? 1,
    exportWithDarkMode: app.state?.exportWithDarkMode ?? false
  };
  const prevIds = { ...app.state?.selectedElementIds || {} };
  const prevGroups = { ...app.state?.selectedGroupIds || {} };
  const origWrite = clipboard.write;
  let timer = null;
  let timedOut = false;
  let performed = null;
  const am = app.actionManager;
  const origUpdater = am.updater;
  let wrapped = false;
  const restoreExport = () => {
    try {
      app.updateScene({ appState: { ...prev } });
    } catch (error) {
      console.warn("[plexus] could not restore export settings", error);
    }
  };
  try {
    const selection = {};
    for (const id of ids) selection[id] = true;
    app.updateScene({ appState: { selectedElementIds: selection, selectedGroupIds: {}, exportScale: scale, exportWithDarkMode: !!dark } });
    await new Promise((resolve) => typeof raf === "function" ? raf(() => resolve()) : setTimeout(resolve, 16));
    let settle;
    const captured = new Promise((resolve) => {
      settle = resolve;
    });
    clipboard.write = async (items) => {
      for (const item of items || []) {
        const type = pngItemType(item);
        if (!type) continue;
        restoreExport();
        settle(await item.getType(type));
        return;
      }
    };
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    if (typeof origUpdater === "function") {
      wrapped = true;
      am.updater = function(result) {
        if (result && typeof result.then === "function") {
          performed = Promise.resolve(result);
          performed.catch(() => {
          });
        }
        return origUpdater.apply(this, arguments);
      };
    }
    const ret = am.executeAction(action, "contextMenu");
    if (ret && typeof ret.catch === "function") ret.catch(() => {
    });
    if (!performed && ret && typeof ret.then === "function") {
      performed = Promise.resolve(ret);
      performed.catch(() => {
      });
    }
    const blob = await Promise.race([captured, timeout]);
    if (!blob) {
      timedOut = true;
      throw new Error("no PNG captured");
    }
    return blob;
  } finally {
    if (timer) clearTimeout(timer);
    if (timedOut) restoreExport();
    if (timedOut && graceMs > 0) {
      clipboard.write = async (items) => {
        for (const item of items || []) if (pngItemType(item)) return void 0;
        return origWrite.call(clipboard, items);
      };
      await new Promise((resolve) => setTimeout(resolve, graceMs));
    }
    if (wrapped) am.updater = origUpdater;
    if (performed) {
      let settleTimer = null;
      const wait = new Promise((resolve) => {
        settleTimer = setTimeout(resolve, doneWaitMs);
      });
      await Promise.race([performed.catch(() => {
      }), wait]);
      clearTimeout(settleTimer);
    }
    clipboard.write = origWrite;
    try {
      app.updateScene({ appState: { selectedElementIds: prevIds, selectedGroupIds: prevGroups, ...prev, toast: null } });
    } catch (error) {
      console.warn("[plexus] could not restore selection", error);
    }
  }
}
function addViaPaste(app, elements, { position = "center" } = {}) {
  const before = new Set((app.getSceneElementsIncludingDeleted?.() || []).map((e) => e.id));
  app.addElementsFromPasteOrLibrary({ elements, files: {}, position });
  return (app.getSceneElementsIncludingDeleted?.() || []).filter((e) => !before.has(e.id) && !e.isDeleted).map((e) => e.id);
}
function waitNotLoading(app, timeoutMs, { doc = globalThis.document, raf = globalThis.requestAnimationFrame, now = () => Date.now() } = {}) {
  const tick = typeof raf === "function" ? (fn) => raf(fn) : (fn) => setTimeout(fn, 16);
  const end = now() + timeoutMs;
  return new Promise((resolve) => {
    const step = () => {
      if (activeEditor(doc)?.app !== app) return resolve(false);
      if (!app.state?.isLoading) return resolve(true);
      if (now() >= end) return resolve(false);
      tick(step);
    };
    step();
  });
}
function zoomTo(app, bbox, opts = {}) {
  const result = fitZoom({ bbox, viewportWidth: app.state.width, viewportHeight: app.state.height, ...opts });
  app.updateScene({ appState: { zoom: { value: result.zoom }, scrollX: result.scrollX, scrollY: result.scrollY } });
  return result;
}
function viewportRectOf(app, bbox) {
  const appState = app.state;
  const a = sceneToViewport({ x: bbox[0], y: bbox[1], appState });
  const b = sceneToViewport({ x: bbox[2], y: bbox[3], appState });
  return { left: a.x, top: a.y, width: b.x - a.x, height: b.y - a.y };
}
function subscribeViewport(app, cb) {
  const offs = [];
  for (const name of ["onScrollChangeEmitter", "onChangeEmitter"]) {
    const emitter = app?.[name];
    if (!emitter || typeof emitter.on !== "function") continue;
    try {
      const off = emitter.on((...args) => {
        try {
          cb(...args);
        } catch (error) {
          console.warn("[plexus] viewport listener failed", error);
        }
      });
      if (typeof off === "function") offs.push(off);
    } catch (error) {
      console.warn("[plexus] could not subscribe to", name, error);
    }
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    for (const off of offs) {
      try {
        off();
      } catch (error) {
        console.warn("[plexus] unsubscribe failed", error);
      }
    }
  };
}
function insertElements(app, elements, { select = true } = {}) {
  const list = Array.isArray(elements) ? elements : [];
  if (!app || typeof app.updateScene !== "function" || !list.length) return false;
  const existing = app.getSceneElementsIncludingDeleted?.() || [];
  const update = { elements: [...existing, ...list], captureUpdate: "IMMEDIATELY" };
  if (select) {
    const selection = {};
    for (const el of list) if (!el.containerId) selection[el.id] = true;
    update.appState = { selectedElementIds: selection, selectedGroupIds: {} };
  }
  app.updateScene(update);
  return true;
}
async function readClipboardText({ clipboard = globalThis.navigator?.clipboard } = {}) {
  if (!clipboard || typeof clipboard.readText !== "function") return null;
  return clipboard.readText();
}

// src/host/cache.js
var DB_NAME = "plexus-cache";
var STORE = "crops";
var CACHE_VERSION = 3;
function cropKey({ regionUid, geometryKey: geometryKey2, drawingHash, tier }) {
  return `v${CACHE_VERSION}|${regionUid}|${geometryKey2}|${drawingHash}|${tier}`;
}
var TIER_PNG2X = "png2x";
var TIER_PNG2X_DARK = "png2x-dark";
function png2xKey({ regionUid, geometryKey: geometryKey2, drawingHash, dark = false }) {
  return cropKey({ regionUid, geometryKey: geometryKey2, drawingHash, tier: dark ? TIER_PNG2X_DARK : TIER_PNG2X });
}
function thumbKey({ uid, hash, maxWidth }) {
  return cropKey({ regionUid: uid, geometryKey: "thumb", drawingHash: `${hash}|${maxWidth}`, tier: "png" });
}
var reqPromise = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
var txPromise = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error("aborted"));
});
function createCropCache({ graph, persist = true, limitBytes = 100 * 2 ** 20, memoryEntries = 300, idb = globalThis.indexedDB, urls = globalThis.URL } = {}) {
  const memory = /* @__PURE__ */ new Map();
  const prefix = `${graph}|`;
  const currentPrefix = `${prefix}v${CACHE_VERSION}|`;
  const useDb = !!(persist && idb);
  let dbPromise = null;
  let disposed = false;
  let knownBytes = 0;
  let scanned = false;
  function revoke(entry) {
    try {
      urls?.revokeObjectURL?.(entry.url);
    } catch {
    }
  }
  function remember(key, entry) {
    const old = memory.get(key);
    if (old) {
      memory.delete(key);
      if (old.url !== entry.url) revoke(old);
    }
    memory.set(key, entry);
    while (memory.size > memoryEntries) {
      const oldestKey = memory.keys().next().value;
      revoke(memory.get(oldestKey));
      memory.delete(oldestKey);
    }
  }
  function openDb() {
    if (!useDb || disposed) return Promise.resolve(null);
    if (!dbPromise) {
      dbPromise = new Promise((resolve) => {
        try {
          const request = idb.open(DB_NAME, 1);
          request.onupgradeneeded = () => {
            const db = request.result;
            const store = db.createObjectStore(STORE, { keyPath: "key" });
            store.createIndex("ts", "ts");
          };
          request.onsuccess = () => {
            resolve(request.result);
            purgeStale(request.result).catch((error) => console.warn("[plexus] cache purge failed", error));
          };
          request.onerror = () => {
            console.warn("[plexus] cache db unavailable", request.error);
            resolve(null);
          };
        } catch (error) {
          console.warn("[plexus] cache db unavailable", error);
          resolve(null);
        }
      });
    }
    return dbPromise;
  }
  async function purgeStale(db) {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    await new Promise((resolve, reject) => {
      const cursorReq = store.openCursor();
      cursorReq.onerror = () => reject(cursorReq.error);
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) {
          resolve();
          return;
        }
        const k = cursor.value.key;
        if (typeof k === "string" && k.startsWith(prefix) && !k.startsWith(currentPrefix)) cursor.delete();
        cursor.continue();
      };
    });
    await txPromise(tx);
  }
  async function evictDb(db) {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const rows = [];
    await new Promise((resolve, reject) => {
      const cursorReq = store.index("ts").openCursor();
      cursorReq.onerror = () => reject(cursorReq.error);
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) {
          resolve();
          return;
        }
        const v = cursor.value;
        if (typeof v.key === "string" && v.key.startsWith(prefix)) rows.push({ key: v.key, size: v.size || 0 });
        cursor.continue();
      };
    });
    let total = rows.reduce((n, r) => n + r.size, 0);
    scanned = true;
    knownBytes = total;
    for (const row of rows) {
      if (total <= limitBytes) break;
      store.delete(row.key);
      total -= row.size;
      knownBytes = total;
    }
    await txPromise(tx);
  }
  return {
    peek(key) {
      const entry = memory.get(key);
      if (!entry) return null;
      memory.delete(key);
      memory.set(key, entry);
      return { url: entry.url, w: entry.w, h: entry.h, type: entry.type };
    },
    async get(key) {
      const hit = this.peek(key);
      if (hit) return hit;
      try {
        const db = await openDb();
        if (!db || disposed) return null;
        const dbKey = prefix + key;
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        const row = await reqPromise(store.get(dbKey));
        if (disposed || !row || !row.blob) return null;
        store.put({ ...row, ts: Date.now() });
        const entry = { url: urls.createObjectURL(row.blob), w: row.w, h: row.h, type: row.type || row.blob.type, size: row.size || 0 };
        remember(key, entry);
        return { url: entry.url, w: entry.w, h: entry.h, type: entry.type };
      } catch (error) {
        console.warn("[plexus] cache read failed", error);
        return null;
      }
    },
    async put(key, blob, { w, h, persist: persist2 = true } = {}) {
      if (disposed) return;
      const entry = { url: urls.createObjectURL(blob), w, h, type: blob.type, size: blob.size || 0 };
      remember(key, entry);
      if (!persist2) return;
      try {
        const db = await openDb();
        if (!db || disposed) return;
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put({ key: prefix + key, blob, w, h, type: blob.type, size: entry.size, ts: Date.now() });
        await txPromise(tx);
        knownBytes += entry.size;
        if (!scanned || knownBytes > limitBytes) await evictDb(db);
      } catch (error) {
        console.warn("[plexus] cache write failed", error);
      }
    },
    async delete(key) {
      const entry = memory.get(key);
      if (entry) {
        revoke(entry);
        memory.delete(key);
      }
      try {
        const db = await openDb();
        if (!db) return;
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(prefix + key);
        await txPromise(tx);
      } catch (error) {
        console.warn("[plexus] cache delete failed", error);
      }
    },
    async clear() {
      knownBytes = 0;
      for (const entry of memory.values()) revoke(entry);
      memory.clear();
      try {
        const db = await openDb();
        if (!db) return;
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        await new Promise((resolve, reject) => {
          const cursorReq = store.openCursor();
          cursorReq.onerror = () => reject(cursorReq.error);
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (!cursor) {
              resolve();
              return;
            }
            if (typeof cursor.value.key === "string" && cursor.value.key.startsWith(prefix)) cursor.delete();
            cursor.continue();
          };
        });
        await txPromise(tx);
      } catch (error) {
        console.warn("[plexus] cache clear failed", error);
      }
    },
    dispose() {
      disposed = true;
      for (const entry of memory.values()) revoke(entry);
      memory.clear();
      const p = dbPromise;
      dbPromise = null;
      p?.then((db) => {
        try {
          db?.close();
        } catch {
        }
      });
    }
  };
}

// src/host/image-source.js
var BITMAP_MEMO_CAP = 4;
var memo = /* @__PURE__ */ new Map();
function polyPoints(poly) {
  if (!Array.isArray(poly) || !poly.length) return null;
  let pts;
  if (typeof poly[0] === "number") {
    pts = [];
    for (let i = 0; i + 1 < poly.length; i += 2) pts.push([poly[i], poly[i + 1]]);
  } else pts = poly.map((p) => Array.isArray(p) ? [p[0], p[1]] : [p?.x, p?.y]);
  if (pts.length < 3 || pts.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return null;
  return pts;
}
function cropToBlob(src, { sx, sy, sw, sh }, { poly, doc = globalThis.document } = {}) {
  const out = doc.createElement("canvas");
  out.width = sw;
  out.height = sh;
  const ctx = out.getContext("2d");
  const pts = polyPoints(poly);
  if (pts) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => i ? ctx.lineTo(x * sw, y * sh) : ctx.moveTo(x * sw, y * sh));
    ctx.closePath();
    ctx.clip();
  }
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
  return new Promise((resolve, reject) => {
    out.toBlob((blob) => blob ? resolve(blob) : reject(new Error("[plexus] toBlob failed")), "image/png");
  });
}
function loadImageBitmap(url, { api = globalThis.roamAlphaAPI, createBitmap = globalThis.createImageBitmap } = {}) {
  if (!url) return Promise.reject(new Error("[plexus] image url required"));
  const hit = memo.get(url);
  if (hit) {
    memo.delete(url);
    memo.set(url, hit);
    return hit;
  }
  const p = (async () => {
    const file = await api.file.get({ url });
    if (!file) throw new Error("[plexus] image not available");
    return createBitmap(file);
  })();
  memo.set(url, p);
  p.catch(() => {
    if (memo.get(url) === p) memo.delete(url);
  });
  while (memo.size > BITMAP_MEMO_CAP) memo.delete(memo.keys().next().value);
  return p;
}
function clearImageMemo() {
  memo.clear();
}

// src/host/cold-render.js
var DEFAULT_SETTLE_MS = 150;
function createColdRenderer({ api = globalThis.roamAlphaAPI, doc = globalThis.document, timeoutMs = 8e3 } = {}) {
  const pending = /* @__PURE__ */ new Map();
  const wanted = /* @__PURE__ */ new Map();
  let tail = Promise.resolve();
  let disposed = false;
  const inflight = /* @__PURE__ */ new Set();
  const findImg = (host) => host.querySelector("img.rm-inline-img--excalidraw");
  const isReady = (img) => !!img && img.complete && img.naturalWidth > 0;
  function waitForImage(host, settleMs) {
    return new Promise((resolve) => {
      let cancel = null;
      let observer = null;
      let timer = null;
      let poll = null;
      let quiet = null;
      let done = false;
      let seenImg = null;
      let seenSrc = null;
      const finish = (img, settled) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearTimeout(quiet);
        clearInterval(poll);
        observer?.disconnect?.();
        host.removeEventListener?.("load", check, true);
        inflight.delete(cancel);
        resolve(img ? { img, settled } : null);
      };
      cancel = () => finish(null, false);
      inflight.add(cancel);
      function check() {
        if (done) return;
        const img = findImg(host);
        const src = img ? img.src : null;
        if (img !== seenImg || src !== seenSrc) {
          seenImg = img;
          seenSrc = src;
          clearTimeout(quiet);
          quiet = null;
        }
        if (!isReady(img)) {
          clearTimeout(quiet);
          quiet = null;
          return;
        }
        if (settleMs <= 0) {
          finish(img, true);
          return;
        }
        if (quiet) return;
        quiet = setTimeout(() => {
          quiet = null;
          const now = findImg(host);
          if (now === seenImg && now?.src === seenSrc && isReady(now)) finish(now, true);
          else check();
        }, settleMs);
      }
      host.addEventListener?.("load", check, true);
      const MO = doc.defaultView?.MutationObserver ?? globalThis.MutationObserver;
      if (MO) {
        observer = new MO(check);
        observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
      }
      poll = setInterval(check, 50);
      timer = setTimeout(() => {
        const img = findImg(host);
        finish(isReady(img) ? img : null, false);
      }, timeoutMs);
      check();
    });
  }
  async function run(drawingUid) {
    const settleMs = wanted.get(drawingUid) ?? DEFAULT_SETTLE_MS;
    wanted.delete(drawingUid);
    if (disposed) return null;
    const host = doc.createElement("div");
    host.className = "plexus-offscreen";
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:fixed;left:-10000px;top:0;width:1200px;visibility:hidden;pointer-events:none";
    doc.body.appendChild(host);
    try {
      api.ui.components.renderBlock({ uid: drawingUid, el: host });
      const waited = await waitForImage(host, settleMs);
      if (!waited || disposed) return null;
      const { img, settled } = waited;
      const canvas = doc.createElement("canvas");
      const naturalWidth = img.naturalWidth;
      const naturalHeight = img.naturalHeight;
      canvas.width = naturalWidth;
      canvas.height = naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      return { canvas, naturalWidth, naturalHeight, settled };
    } catch (error) {
      console.warn("[plexus] cold render failed", error);
      return null;
    } finally {
      try {
        api.ui.components.unmountNode({ el: host });
      } catch (error) {
        console.warn("[plexus] unmount failed", error);
      }
      host.remove();
    }
  }
  return {
    renderDrawing(drawingUid, { settleMs = DEFAULT_SETTLE_MS } = {}) {
      wanted.set(drawingUid, Math.max(wanted.get(drawingUid) ?? 0, settleMs));
      const existing = pending.get(drawingUid);
      if (existing) return existing;
      const p = tail.then(() => run(drawingUid));
      tail = p.catch(() => {
      });
      pending.set(drawingUid, p);
      const clear = () => {
        if (pending.get(drawingUid) === p) {
          pending.delete(drawingUid);
          wanted.delete(drawingUid);
        }
      };
      p.then(clear, clear);
      return p;
    },
    dispose() {
      disposed = true;
      pending.clear();
      for (const cancel of [...inflight]) cancel();
    }
  };
}
function cropCanvasToBlob(canvas, rect, { doc = globalThis.document, poly } = {}) {
  return cropToBlob(canvas, rect, { doc, poly });
}

// src/view/toast.js
function createToaster({ doc }) {
  let el = null;
  let timer = null;
  let disposed = false;
  let action = null;
  let onHide = null;
  let held = null;
  const hide = () => {
    if (timer != null) clearTimeout(timer);
    timer = null;
    el?.remove();
    el = null;
    action = null;
    const cb = onHide;
    onHide = null;
    try {
      cb?.();
    } catch (error) {
      console.warn("[plexus] toast hide callback failed", error);
    }
    const next = held;
    held = null;
    if (next && !disposed) show(next.message, next.opts);
  };
  function show(message, { kind = "info", ms, action: act, onHide: hideCb } = {}) {
    if (disposed) return;
    const hasAction = !!act && typeof act.run === "function";
    if (action && !hasAction) {
      held = { message, opts: { kind, ms } };
      return;
    }
    held = null;
    if (timer != null) clearTimeout(timer);
    const prevHide = onHide;
    onHide = null;
    try {
      prevHide?.();
    } catch (error) {
      console.warn("[plexus] toast hide callback failed", error);
    }
    if (!el) {
      el = doc.createElement("div");
      el.setAttribute("role", "status");
      doc.body.append(el);
    }
    el.className = `plexus-portal plexus-toast plexus-toast-${kind}`;
    el.textContent = message;
    action = null;
    onHide = typeof hideCb === "function" ? hideCb : null;
    if (hasAction) {
      const run = act.run;
      const button = doc.createElement("button");
      button.className = "plexus-toast-action";
      button.type = "button";
      button.textContent = act.label ?? "Undo";
      button.addEventListener("mousedown", (event) => event.preventDefault());
      let used = false;
      button.addEventListener("click", () => {
        if (used) return;
        used = true;
        hide();
        try {
          run();
        } catch (error) {
          console.warn("[plexus] toast action failed", error);
        }
      });
      el.append(button);
      action = { run };
    }
    timer = setTimeout(hide, ms ?? (hasAction ? 1e4 : 2600));
  }
  return {
    show,
    dispose() {
      disposed = true;
      held = null;
      onHide = null;
      hide();
    }
  };
}

// src/view/toolbar.js
function baseZIndex(doc, outerEl) {
  const view2 = doc.defaultView;
  for (let el = outerEl; el && el !== doc.body; el = el.parentElement) {
    const z = Number.parseInt(view2.getComputedStyle(el).zIndex, 10);
    if (Number.isFinite(z)) return z;
  }
  return 1e3;
}
function createEditorToolbar({ doc, onAreaRegion, onImageRegion, onFrameRegion, canFrame, onCropRegion, canCrop, onEmbed, onEmbedPicker, onNote, onPresent, canPresent, onMindMap, onEditEmbed, canEditEmbed, onToggleRegions, regionsVisible, onToggleDock, dockOpen, dockInset, onBack, canBack }) {
  const view2 = doc.defaultView;
  const mac = /mac|iphone|ipad/i.test(String(view2?.navigator?.platform ?? ""));
  const withKey = (name, id) => {
    const keys = hotkeyFor(id, { mac });
    return keys ? `${name} (${keys})` : name;
  };
  let bar = null;
  let outer = null;
  let gated = [];
  let pressed = [];
  let refreshTimer = null;
  const refresh = () => {
    refreshTimer = null;
    for (const [b, visible] of pressed) {
      let on = false;
      try {
        on = !!visible?.();
      } catch {
        on = false;
      }
      b.setAttribute?.("aria-pressed", String(on));
    }
    for (const [b, can] of gated) {
      let ok = false;
      try {
        ok = !!can?.();
      } catch {
        ok = false;
      }
      b.disabled = !ok;
    }
  };
  const scheduleRefresh = () => {
    if (refreshTimer != null) return;
    refreshTimer = setTimeout(refresh, 0);
  };
  const place = () => {
    if (!bar || !outer) return;
    const rect = outer.getBoundingClientRect();
    let inset = 0;
    try {
      inset = Math.max(0, Number(dockInset?.()) || 0);
    } catch {
      inset = 0;
    }
    const visible = Math.max(0, rect.width - inset);
    bar.style.maxWidth = `${Math.max(0, visible - 24)}px`;
    bar.style.left = `${rect.left + visible / 2}px`;
    const height = bar.getBoundingClientRect().height || 40;
    bar.style.top = `${rect.bottom - 16 - height}px`;
  };
  const button = (label, handler, hotkey) => {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "plexus-toolbar-button";
    b.textContent = label;
    if (hotkey) b.title = withKey(label, hotkey);
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      Promise.resolve().then(handler).catch((error) => console.warn("[plexus] toolbar action failed", error));
    });
    return b;
  };
  const hide = () => {
    view2?.removeEventListener("resize", place);
    if (refreshTimer != null) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    outer?.removeEventListener?.("pointerup", scheduleRefresh, true);
    outer?.removeEventListener?.("keyup", scheduleRefresh, true);
    bar?.remove();
    bar = null;
    outer = null;
    gated = [];
    pressed = [];
  };
  return {
    show(outerEl) {
      hide();
      outer = outerEl;
      bar = doc.createElement("div");
      bar.className = "plexus-portal plexus-toolbar";
      bar.style.zIndex = String(baseZIndex(doc, outerEl) + 1);
      const frameButton = button("Frame (with margin)", onFrameRegion);
      const cropButton = button("Region from crop", onCropRegion);
      const presentButton = button("Present", onPresent, "present");
      gated = [[frameButton, canFrame], [cropButton, canCrop], [presentButton, canPresent]];
      const controls = [button("Region", onAreaRegion, "region"), button("Image region", onImageRegion, "image"), frameButton, cropButton];
      controls.push(onEmbedPicker ? button("Embed…", onEmbedPicker, "embed") : button("Embed block", onEmbed));
      if (onNote) controls.push(button("Note", onNote, "note"));
      if (onEditEmbed) {
        const editButton = button("Edit embed", onEditEmbed);
        editButton.title = "Edit embed (F2)";
        gated.push([editButton, canEditEmbed]);
        controls.push(editButton);
      }
      controls.push(presentButton);
      if (onMindMap) controls.push(button("Mind map", onMindMap, "mindmap"));
      pressed = [];
      if (onToggleRegions) {
        const regionsButton = button("Regions", async () => {
          await onToggleRegions();
          refresh();
        });
        pressed.push([regionsButton, regionsVisible]);
        controls.push(regionsButton);
      }
      if (onToggleDock) {
        const dockButton = button("Outline", async () => {
          await onToggleDock();
          refresh();
        }, "dock");
        pressed.push([dockButton, dockOpen]);
        controls.push(dockButton);
      }
      if (onBack) {
        const backButton = button("Back", async () => {
          await onBack();
          refresh();
        });
        backButton.title = "Back (Alt+←)";
        gated.push([backButton, canBack]);
        controls.push(backButton);
      }
      bar.append(...controls);
      doc.body.append(bar);
      refresh();
      outerEl.addEventListener?.("pointerup", scheduleRefresh, true);
      outerEl.addEventListener?.("keyup", scheduleRefresh, true);
      place();
      view2?.addEventListener("resize", place);
    },
    refresh: scheduleRefresh,
    place,
    hide,
    dispose: hide
  };
}
var hasSelection = (app) => {
  const sel = app?.state?.selectedElementIds;
  return !!sel && Object.keys(sel).some((id) => sel[id]);
};
function installBackKey({ containerEl, app, canBack, onBack } = {}) {
  if (!containerEl?.addEventListener) return () => {
  };
  const onKeyDown = (e) => {
    try {
      if (e.key !== "ArrowLeft" || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.isComposing || e.keyCode === 229 || e.target !== containerEl) return;
      const st = app?.state || {};
      if (st.editingTextElement || st.openDialog || st.openMenu || st.contextMenu) return;
      if (hasSelection(app)) return;
      if (!canBack?.()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      Promise.resolve(onBack()).catch((error) => console.warn("[plexus] back failed", error));
    } catch (error) {
      console.warn("[plexus] back key failed", error);
    }
  };
  containerEl.addEventListener("keydown", onKeyDown, true);
  return function dispose() {
    containerEl.removeEventListener?.("keydown", onKeyDown, true);
  };
}

// src/model/embeds.js
var REF_RE = /^\(\(([A-Za-z0-9_-]{9})\)\)$/;
var PAGE_RE = /^\[\[([^\]]+)\]\]$/;
var UID_RE = /^[A-Za-z0-9_-]{9}$/;
var TODAY_REF = "plexus:today";
function parseEmbedRef(text) {
  if (typeof text !== "string") return null;
  const t = text.trim();
  if (t === TODAY_REF) return { kind: "today", ref: TODAY_REF };
  let m = REF_RE.exec(t);
  if (m) return { kind: "block", uid: m[1], ref: `((${m[1]}))` };
  m = PAGE_RE.exec(t);
  if (m && m[1].trim()) return { kind: "page", title: m[1].trim(), ref: `[[${m[1].trim()}]]` };
  if (UID_RE.test(t)) return { kind: "block", uid: t, ref: `((${t}))` };
  return null;
}
function embedLabel(text, max = 80) {
  const plain = String(text ?? "").replace(/[{}`]/g, "").replace(/\[\[|\]\]/g, "").replace(/\s+/g, " ").trim();
  return plain.slice(0, max);
}
function mergePlexusData(customData, patch) {
  const base3 = customData && typeof customData === "object" ? customData : {};
  const plexus = base3.plexus && typeof base3.plexus === "object" ? base3.plexus : {};
  return { ...base3, plexus: { ...plexus, ...patch } };
}
var rnd = () => Math.floor(Math.random() * 2 ** 31);
var rid = (prefix) => `${prefix}${Math.random().toString(36).slice(2, 12)}`;
function base(id, type, x, y, width, height) {
  return {
    id,
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: rnd(),
    version: 1,
    versionNonce: rnd(),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    index: null
  };
}
function wrapLines(text, perLine) {
  const lines = [];
  let cur = "";
  for (const word of text.split(" ")) {
    let w = word;
    while (w.length > perLine) {
      if (cur) {
        lines.push(cur);
        cur = "";
      }
      lines.push(w.slice(0, perLine));
      w = w.slice(perLine);
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= perLine) cur += ` ${w}`;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur || !lines.length) lines.push(cur);
  return lines;
}
function makeEmbedAnchor({ ref, link = ref, label = "", x = 0, y = 0, width = 360, height = 200, idPrefix: idPrefix2 = "plexus-embed-" } = {}) {
  const rectId = rid(idPrefix2);
  const textId2 = rid(idPrefix2);
  const text = embedLabel(label) || embedLabel(ref);
  const fontSize = 16;
  const lineHeight = 1.25;
  const perLine = Math.max(4, Math.floor((width - 16) / (fontSize * 0.6)));
  const lines = wrapLines(text, perLine);
  const wrapped = lines.join("\n");
  const longest = Math.max(1, ...lines.map((l) => l.length));
  const tw = Math.min(width - 16, Math.max(10, Math.ceil(longest * fontSize * 0.6)));
  const th = Math.ceil(lines.length * fontSize * lineHeight);
  const rect = {
    ...base(rectId, "rectangle", x, y, width, height),
    strokeStyle: "dashed",
    backgroundColor: "transparent",
    link,
    boundElements: [{ id: textId2, type: "text" }],
    customData: { plexus: { embed: ref } }
  };
  const t = {
    ...base(textId2, "text", x + (width - tw) / 2, y + (height - th) / 2, tw, th),
    text: wrapped,
    originalText: text,
    fontSize,
    fontFamily: 1,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: rectId,
    autoResize: true,
    lineHeight
  };
  return [rect, t];
}
function embedAnchors(elements) {
  return liveElements(elements).filter((el) => el.type === "rectangle" && typeof el.customData?.plexus?.embed === "string");
}

// src/view/embeds.js
var EMBED_BLOCK_CAP = 30;
var WATCH_CAP = 150;
var NOT_FOUND_RETRIES = [300, 1e3, 3e3];
var HOUR_MS = 60 * 60 * 1e3;
var KEYBOARD_LEAVES = /* @__PURE__ */ new Set(["keyboard", "escape", "enter", "focus-lost"]);
var CHILD_DEPTH = 2;
var LEAVE_WAIT_MS = 300;
var SELECTION_RECHECK_MS = 100;
var QUIET_CAP_MS = 900;
var FOCUS_WAIT_MS = 300;
var REFOCUS_WINDOW_MS = 1200;
var ROAM_MENU_SELECTOR = ".rm-autocomplete__results, .bp3-popover, .bp3-menu, .bp3-overlay-open:not(.bp3-toast-container)";
var POPUP_HOST_SELECTOR = ".bp3-portal";
var MENU_KEYS = /* @__PURE__ */ new Set(["Escape", "Enter", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"]);
var KEY_EVENTS = ["keydown", "keyup", "keypress", "input", "paste", "copy", "cut"];
var POINTER_ALWAYS = ["pointerdown", "mousedown", "dblclick", "wheel"];
var POINTER_GATED = ["pointerup", "mouseup", "click"];
function within(node, root) {
  for (let n = node; n; n = n.parentNode ?? n.parentElement) if (n === root) return true;
  return false;
}
var swallow = (e) => {
  e.preventDefault?.();
  e.stopImmediatePropagation?.();
};
function installEmbedF2({ containerEl, app, canEdit, onEdit }) {
  const handler = (e) => {
    if (e.key !== "F2" || e.repeat || e.isComposing || e.keyCode === 229) return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.target !== containerEl) return;
    const st = app?.state || {};
    if (st.editingTextElement || st.openDialog || st.openMenu || st.openPopup || st.contextMenu) return;
    let ok = false;
    try {
      ok = !!canEdit();
    } catch {
      ok = false;
    }
    if (!ok) return;
    swallow(e);
    Promise.resolve().then(onEdit).catch((error) => console.warn("[plexus] edit embed failed", error));
  };
  containerEl.addEventListener("keydown", handler, true);
  return () => containerEl.removeEventListener("keydown", handler, true);
}
function embedPlacement(el, appState, containerRect) {
  const zoom = appState?.zoom?.value || 1;
  const angle = Number(el.angle) || 0;
  let sx = el.x;
  let sy = el.y;
  if (angle) {
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    const dx = -el.width / 2;
    const dy = -el.height / 2;
    sx = cx + dx * Math.cos(angle) - dy * Math.sin(angle);
    sy = cy + dx * Math.sin(angle) + dy * Math.cos(angle);
  }
  const p = sceneToViewport({ x: sx, y: sy, appState });
  const transform = `translate(${p.x}px, ${p.y}px) scale(${zoom}) rotate(${angle}rad)`;
  let clip = null;
  let hidden = false;
  if (!angle && containerRect) {
    const right = p.x + el.width * zoom;
    const bottom = p.y + el.height * zoom;
    if (right <= containerRect.left || bottom <= containerRect.top || p.x >= containerRect.right || p.y >= containerRect.bottom) {
      hidden = true;
    } else {
      const inset = [
        (containerRect.top - p.y) / zoom,
        (right - containerRect.right) / zoom,
        (bottom - containerRect.bottom) / zoom,
        (containerRect.left - p.x) / zoom
      ].map((v) => Math.max(0, v));
      if (inset.some((v) => v > 0)) clip = `inset(${inset.map((v) => `${v}px`).join(" ")})`;
    }
  }
  return { transform, clip, hidden, width: el.width, height: el.height };
}
function createEmbedOverlay({
  doc,
  api = globalThis.roamAlphaAPI,
  host,
  app,
  containerEl,
  zIndex = 1e3,
  subscribe: subscribe2 = subscribeViewport,
  sleep: sleep2 = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  waitQuiet = null,
  now = () => /* @__PURE__ */ new Date(),
  setTimeout: setTimer = globalThis.setTimeout,
  clearTimeout: clearTimer = globalThis.clearTimeout,
  toast = () => {
  },
  onStateChange = () => {
  },
  menuSelector = ROAM_MENU_SELECTOR
}) {
  const view2 = doc.defaultView;
  const portals = /* @__PURE__ */ new Map();
  const watches = /* @__PURE__ */ new Map();
  const dirty = /* @__PURE__ */ new Set();
  let raf = null;
  let disposed = false;
  let unsubscribe2 = null;
  let session = null;
  let disposePromise = null;
  let midnightTimer = null;
  let visListening = false;
  let watchCapLogged = false;
  const requestFrame = (cb) => typeof view2?.requestAnimationFrame === "function" ? view2.requestAnimationFrame(cb) : setTimeout(cb, 16);
  const cancelFrame = (id) => typeof view2?.cancelAnimationFrame === "function" ? view2.cancelAnimationFrame(id) : clearTimeout(id);
  const unmountHosts = (portal) => {
    for (const el of portal.hosts) {
      try {
        api?.ui?.components?.unmountNode?.({ el });
      } catch (error) {
        console.warn("[plexus] unmount failed", error);
      }
      el.remove?.();
    }
    portal.hosts.clear();
  };
  const renderInto = (portal, parent, string, className) => {
    const el = doc.createElement("div");
    el.className = className;
    parent.append(el);
    portal.hosts.add(el);
    try {
      api.ui.components.renderString({ el, string });
    } catch (error) {
      console.warn("[plexus] embed render failed", error);
      el.textContent = string;
    }
    return el;
  };
  const paint = (portal, content, today = null) => {
    unmountHosts(portal);
    portal.body.textContent = "";
    if (today) {
      portal.title.textContent = `Today · ${today.title || ""}`;
      if (!content) {
        const empty = doc.createElement("div");
        empty.className = "plexus-embed-empty";
        empty.textContent = "No notes yet";
        portal.body.append(empty);
        return;
      }
    } else {
      portal.title.textContent = content ? (content.kind === "page" ? content.title : content.pageTitle) || "" : "Block not found";
    }
    if (!content) return;
    let budget = EMBED_BLOCK_CAP;
    if (content.kind !== "page" && content.string) {
      renderInto(portal, portal.body, content.string, "plexus-embed-block");
      budget -= 1;
    }
    const walk2 = (children, depth, parent) => {
      for (const child of children || []) {
        if (budget <= 0) return;
        budget -= 1;
        const row = doc.createElement("div");
        row.className = "plexus-embed-child";
        parent.append(row);
        portal.hosts.add(row);
        renderInto(portal, row, child.string ?? "", "plexus-embed-block");
        if (depth < CHILD_DEPTH && content.kind !== "page") walk2(child.children, depth + 1, row);
      }
    };
    walk2(content.children, 1, portal.body);
  };
  const watchUid = (portal, uid) => {
    if (!uid || !host.watchEmbed || portal.uid === uid) return;
    releaseWatch(portal);
    portal.uid = uid;
    let entry = watches.get(uid);
    if (!entry && watches.size >= WATCH_CAP) {
      if (!watchCapLogged) {
        watchCapLogged = true;
        console.warn(`[plexus] embed watch cap ${WATCH_CAP} reached; further embeds render once`);
      }
      return;
    }
    if (!entry) {
      entry = { portals: /* @__PURE__ */ new Set(), dispose: null };
      entry.dispose = host.watchEmbed(uid, () => {
        for (const p of entry.portals) dirty.add(p);
        schedule();
      });
      watches.set(uid, entry);
    }
    entry.portals.add(portal);
  };
  function releaseWatch(portal) {
    const uid = portal.uid;
    portal.uid = null;
    const entry = uid ? watches.get(uid) : null;
    if (!entry) return;
    entry.portals.delete(portal);
    if (entry.portals.size) return;
    watches.delete(uid);
    try {
      entry.dispose?.();
    } catch (error) {
      console.warn("[plexus] unwatch failed", error);
    }
  }
  const todayTitle = () => {
    try {
      const t = api?.util?.dateToPageTitle?.(now());
      return typeof t === "string" && t ? t : null;
    } catch (error) {
      console.warn("[plexus] today title failed", error);
      return null;
    }
  };
  const pullOnce = async (ref) => {
    try {
      return await host.pullEmbedContent(ref);
    } catch (error) {
      console.warn("[plexus] embed pull failed", error);
      return null;
    }
  };
  const load = async (portal) => {
    if (portal.editing) {
      portal.stale = true;
      return;
    }
    const gen = ++portal.gen;
    const parsed = parseEmbedRef(portal.ref);
    const isToday = parsed?.kind === "today";
    let ref = portal.ref;
    let today = null;
    if (isToday) {
      const title = todayTitle();
      today = { title };
      ref = title ? `[[${title}]]` : null;
      if (portal.todayTitle !== title) releaseWatch(portal);
      portal.todayTitle = title;
    }
    let content = ref ? await pullOnce(ref) : null;
    if (!content && !isToday && parsed?.kind === "page") {
      for (const ms of NOT_FOUND_RETRIES) {
        await sleep2(ms);
        if (disposed || portal.dead || gen !== portal.gen) return;
        content = await pullOnce(ref);
        if (content) break;
      }
    }
    if (disposed || portal.dead || gen !== portal.gen) return;
    portal.missing = isToday && !content;
    paint(portal, content, today);
    const uid = content?.uid ?? parsed?.uid;
    if (uid) watchUid(portal, uid);
    else if (isToday) releaseWatch(portal);
  };
  const hasToday = () => {
    for (const portal of portals.values()) if (!portal.dead && parseEmbedRef(portal.ref)?.kind === "today") return true;
    return false;
  };
  const recheckToday = () => {
    if (disposed) return;
    const title = todayTitle();
    for (const portal of portals.values()) {
      if (portal.dead || parseEmbedRef(portal.ref)?.kind !== "today") continue;
      if (portal.todayTitle !== title || portal.missing) void load(portal);
    }
  };
  const onVisibility = () => {
    recheckToday();
    armMidnight();
  };
  function armMidnight() {
    const need2 = !disposed && hasToday();
    if (!need2 && midnightTimer != null) {
      clearTimer(midnightTimer);
      midnightTimer = null;
    }
    if (need2 && !visListening && typeof doc.addEventListener === "function") {
      doc.addEventListener("visibilitychange", onVisibility);
      visListening = true;
    } else if (!need2 && visListening) {
      doc.removeEventListener?.("visibilitychange", onVisibility);
      visListening = false;
    }
    if (!need2 || midnightTimer != null) return;
    const d = now();
    const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    const delay = Math.max(1e3, Math.min(HOUR_MS, midnight - d.getTime()));
    midnightTimer = setTimer(() => {
      midnightTimer = null;
      recheckToday();
      armMidnight();
    }, delay);
  }
  const applyTheme = (portal) => {
    const theme = app.state?.theme === "dark" ? "dark" : "light";
    if (portal.theme === theme) return;
    portal.theme = theme;
    portal.root.setAttribute?.("data-theme", theme);
  };
  const create = (el) => {
    const root = doc.createElement("div");
    root.className = "plexus-portal plexus-embed";
    root.setAttribute?.("aria-hidden", "true");
    root.style.zIndex = String(zIndex);
    const title = doc.createElement("div");
    title.className = "plexus-embed-title";
    const body = doc.createElement("div");
    body.className = "plexus-embed-body";
    root.append(title, body);
    doc.body.append(root);
    const portal = { root, title, body, hosts: /* @__PURE__ */ new Set(), ref: el.customData.plexus.embed, uid: null, gen: 0, dead: false, theme: null, editing: false, stale: false, removing: false, session: null, todayTitle: null, missing: false };
    applyTheme(portal);
    portals.set(el.id, portal);
    void load(portal);
    return portal;
  };
  const remove = (id) => {
    const portal = portals.get(id);
    if (!portal) return;
    if (portal.session) {
      if (portal.removing) return;
      portal.removing = true;
      void leave("removed").then(() => {
        if (portals.get(id) === portal) remove(id);
      });
      return;
    }
    portals.delete(id);
    portal.dead = true;
    dirty.delete(portal);
    releaseWatch(portal);
    unmountHosts(portal);
    portal.root.remove();
    armMidnight();
  };
  let lastNonce;
  const sync = () => {
    const nonce3 = app.scene?.getSceneNonce?.();
    if (!portals.size && nonce3 !== void 0 && nonce3 === lastNonce) return;
    lastNonce = nonce3;
    const anchors = embedAnchors(app.getSceneElementsIncludingDeleted?.() ?? app.getSceneElements?.() ?? []);
    const ids = new Set(anchors.map((el) => el.id));
    for (const id of [...portals.keys()]) if (!ids.has(id)) remove(id);
    if (!anchors.length) {
      armMidnight();
      return;
    }
    const containerRect = containerEl.getBoundingClientRect();
    for (const el of anchors) {
      let portal = portals.get(el.id);
      const ref = el.customData.plexus.embed;
      if (portal && portal.ref !== ref) {
        portal.ref = ref;
        if (!portal.editing) releaseWatch(portal);
        void load(portal);
      }
      if (!portal) portal = create(el);
      const place = embedPlacement(el, app.state, containerRect);
      if (portal.editing) {
        const s2 = portal.session;
        if (s2 && s2.phase !== "leaving") {
          if (place.hidden) void leave("hidden");
          else placeEditing(portal, el);
        }
        applyTheme(portal);
        continue;
      }
      const s = portal.root.style;
      s.width = `${place.width}px`;
      s.height = `${place.height}px`;
      s.transform = place.transform;
      s.clipPath = place.clip || "";
      s.display = place.hidden ? "none" : "";
      applyTheme(portal);
    }
    armMidnight();
  };
  function schedule() {
    if (disposed || raf != null) return;
    raf = requestFrame(() => {
      raf = null;
      if (disposed) return;
      try {
        for (const portal of [...dirty]) {
          dirty.delete(portal);
          if (portal.editing) portal.stale = true;
          else if (!portal.dead) void load(portal);
        }
        sync();
      } catch (error) {
        console.warn("[plexus] embed reposition failed", error);
      }
    });
  }
  const notify = () => {
    try {
      onStateChange();
    } catch (error) {
      console.warn("[plexus] state listener failed", error);
    }
  };
  const anchorOf = (id) => embedAnchors(app.getSceneElementsIncludingDeleted?.() ?? app.getSceneElements?.() ?? []).find((el) => el.id === id) ?? null;
  const updateSelection = (ids, groups) => {
    try {
      app.updateScene({ appState: { selectedElementIds: ids, selectedGroupIds: groups } });
    } catch (error) {
      console.warn("[plexus] selection update failed", error);
    }
  };
  function placeEditing(portal, el) {
    const p = sceneToViewport({ x: el.x, y: el.y, appState: app.state });
    portal.root.style.left = `${p.x}px`;
    portal.root.style.top = `${p.y}px`;
  }
  function applyEditGeometry(portal, el) {
    const zoom = app.state?.zoom?.value || 1;
    const rect = containerEl.getBoundingClientRect();
    const cw = rect.width ?? rect.right - rect.left;
    const s = portal.root.style;
    s.transform = "";
    s.clipPath = "";
    s.display = "";
    s.width = `${Math.min(Math.max(el.width * zoom, 320), cw > 0 ? cw : Infinity)}px`;
    s.height = "auto";
    s.minHeight = `${el.height * zoom}px`;
    s.pointerEvents = "auto";
    s.zIndex = String(zIndex + 2);
    placeEditing(portal, el);
  }
  const defaultQuiet = (el) => new Promise((resolve) => {
    const MO = view2?.MutationObserver ?? globalThis.MutationObserver;
    let frames = 0;
    let done = false;
    let mo = null;
    let cap = null;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        mo?.disconnect();
      } catch {
      }
      clearTimeout(cap);
      resolve();
    };
    cap = setTimeout(finish, QUIET_CAP_MS);
    if (typeof MO === "function") {
      mo = new MO(() => {
        frames = 0;
      });
      mo.observe(el, { childList: true, subtree: true, attributes: true, characterData: true });
    }
    const tick = () => {
      if (done) return;
      frames += 1;
      if (frames >= 2) finish();
      else requestFrame(tick);
    };
    requestFrame(tick);
  });
  const rootInputOf = (s) => {
    const list = s.inner.querySelectorAll?.(".rm-block__input");
    if (!list) return null;
    return [...list].find((n) => String(n.id ?? "").endsWith(s.uid)) ?? null;
  };
  const isRootTextarea = (s, t) => !!t && t.tagName === "TEXTAREA" && within(t, s.inner) && String(t.id ?? "").endsWith(s.uid);
  const rootTextarea = (s) => {
    const list = s.inner.querySelectorAll?.("textarea");
    return list ? [...list].find((t) => isRootTextarea(s, t)) ?? null : null;
  };
  const caretToEnd = (ta) => {
    const n = String(ta.value ?? "").length;
    if (typeof ta.setSelectionRange === "function") ta.setSelectionRange(n, n);
    else {
      ta.selectionStart = n;
      ta.selectionEnd = n;
    }
  };
  function clickRoot(s) {
    const input = rootInputOf(s);
    if (!input) return false;
    const Mouse = view2?.MouseEvent ?? globalThis.MouseEvent;
    for (const type of ["mousedown", "mouseup", "click"]) {
      input.dispatchEvent(new Mouse(type, { bubbles: true, cancelable: true, view: view2 }));
    }
    return true;
  }
  const focusedRoot = (s) => isRootTextarea(s, doc.activeElement) ? doc.activeElement : null;
  async function focusRoot(s) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (s.phase !== "entering") return false;
      clickRoot(s);
      const end = Date.now() + FOCUS_WAIT_MS;
      for (; ; ) {
        const ta = focusedRoot(s);
        if (ta) {
          caretToEnd(ta);
          return true;
        }
        if (Date.now() >= end) break;
        await sleep2(25);
        if (s.phase !== "entering") return false;
      }
    }
    return false;
  }
  function installGlobals(s) {
    const { portal } = s;
    const onKey = (e) => {
      if (s.phase !== "active" && s.phase !== "entering" || e.isComposing || e.keyCode === 229) return;
      const t = e.target;
      if (s.phase === "entering") {
        if (within(t, portal.root) || t?.closest?.(`${menuSelector}, ${POPUP_HOST_SELECTOR}`)) return;
        swallow(e);
        if (e.key === "Escape") void leave("escape");
        return;
      }
      if (!within(t, portal.root)) {
        if (t?.closest?.(`${menuSelector}, ${POPUP_HOST_SELECTOR}`)) return;
        swallow(e);
        const ta = rootTextarea(s);
        if (ta) {
          try {
            ta.focus?.({ preventScroll: true });
            caretToEnd(ta);
          } catch (error) {
            console.warn("[plexus] refocus failed", error);
          }
        } else if (Date.now() - s.clickedAt > REFOCUS_WINDOW_MS) void leave("focus-lost");
        else clickRoot(s);
        return;
      }
      const menuOpen = !!doc.querySelector?.(menuSelector);
      if (e.key === "Escape") {
        if (menuOpen) return;
        swallow(e);
        void leave("escape");
        return;
      }
      if (!t || t.tagName !== "TEXTAREA") return;
      const start = t.selectionStart;
      const end = t.selectionEnd;
      const len = String(t.value ?? "").length;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.altKey && !e.shiftKey && (e.code === "KeyA" || String(e.key).toLowerCase() === "a") && start === 0 && end === len) {
        swallow(e);
        return;
      }
      const key = e.key;
      if (!menuOpen && (key === "ArrowUp" && e.shiftKey && !e.altKey && !mod && start === 0 || key === "ArrowDown" && e.shiftKey && !e.altKey && !mod && end === len)) {
        swallow(e);
        return;
      }
      if (menuOpen || !isRootTextarea(s, t)) return;
      if (key === "Enter" && !e.shiftKey && !mod && !e.altKey) {
        swallow(e);
        void leave("enter");
        return;
      }
      const arrow = key === "ArrowUp" || key === "ArrowDown";
      if (key === "Tab" || key === "Backspace" && start === 0 && end === 0 || key === "Delete" && start === len && end === len || arrow && e.shiftKey && (e.altKey || mod) || key === "ArrowUp" && e.shiftKey && start === 0 || key === "ArrowDown" && e.shiftKey && end === len) swallow(e);
    };
    const onDown = (e) => {
      if (s.phase !== "active" && s.phase !== "entering") return;
      const t = e.target;
      if (within(t, portal.root) || t?.closest?.(`${menuSelector}, ${POPUP_HOST_SELECTOR}`)) return;
      void leave("pointer");
    };
    const onUp = () => {
      s.downInside = false;
    };
    view2.addEventListener("keydown", onKey, true);
    doc.addEventListener("pointerdown", onDown, true);
    doc.addEventListener("pointerup", onUp);
    s.globalOffs.push(
      () => view2.removeEventListener("keydown", onKey, true),
      () => doc.removeEventListener("pointerdown", onDown, true),
      () => doc.removeEventListener("pointerup", onUp)
    );
  }
  function installStoppers(s) {
    const root = s.portal.root;
    const stop = (e) => e.stopPropagation();
    const on = (list, type, fn) => {
      root.addEventListener(type, fn);
      list.push(() => root.removeEventListener(type, fn));
    };
    const stopKey = (e) => {
      if (MENU_KEYS.has(e.key) && doc.querySelector?.(menuSelector)) return;
      e.stopPropagation();
    };
    for (const type of KEY_EVENTS) on(s.keyOffs, type, type === "keydown" || type === "keyup" ? stopKey : stop);
    for (const type of POINTER_ALWAYS) {
      on(s.pointerOffs, type, (e) => {
        if (type === "pointerdown" || type === "mousedown") s.downInside = true;
        e.stopPropagation();
      });
    }
    for (const type of POINTER_GATED) {
      on(s.pointerOffs, type, (e) => {
        if (s.downInside) e.stopPropagation();
        if (type === "click") s.downInside = false;
      });
    }
  }
  async function edit(id, { onLeave = null } = {}) {
    if (disposed) return false;
    if (session) {
      if (session.phase !== "leaving") return false;
      await session.leavePromise;
      if (disposed || session) return false;
    }
    const portal = portals.get(id);
    const target = portal && !portal.dead ? parseEmbedRef(portal.ref) : null;
    const anchor = target?.kind === "block" ? anchorOf(id) : null;
    if (!anchor) return false;
    const s = {
      id,
      portal,
      uid: target.uid,
      inner: doc.createElement("div"),
      phase: "entering",
      clickedAt: 0,
      leavePromise: null,
      keyOffs: [],
      pointerOffs: [],
      globalOffs: [],
      downInside: false,
      prev: null,
      onLeave
    };
    session = s;
    portal.session = s;
    portal.editing = true;
    portal.gen += 1;
    dirty.delete(portal);
    notify();
    installStoppers(s);
    installGlobals(s);
    s.prev = { ids: { ...app.state?.selectedElementIds || {} }, groups: { ...app.state?.selectedGroupIds || {} } };
    updateSelection({}, {});
    unmountHosts(portal);
    portal.body.textContent = "";
    s.inner.className = "plexus-embed-editor";
    portal.body.append(s.inner);
    portal.root.className = "plexus-portal plexus-embed plexus-embed--editing";
    portal.root.removeAttribute?.("aria-hidden");
    applyEditGeometry(portal, anchor);
    try {
      api.ui.components.renderBlock({ uid: s.uid, el: s.inner });
    } catch (error) {
      console.warn("[plexus] editable embed render failed", error);
      toast("Could not open the block editor");
      await leave("error");
      return false;
    }
    await (waitQuiet ?? defaultQuiet)(s.inner);
    if (s.phase !== "entering") return false;
    if (!await focusRoot(s)) {
      if (s.phase === "entering") {
        toast("Could not open the block editor");
        await leave("error");
      }
      return false;
    }
    s.clickedAt = Date.now();
    s.phase = "active";
    notify();
    return true;
  }
  function leave(trigger = "api") {
    const s = session;
    if (!s) return Promise.resolve();
    if (s.leavePromise) return s.leavePromise;
    s.phase = "leaving";
    s.leavePromise = runLeave(s, trigger);
    return s.leavePromise;
  }
  async function ownsSelection(s) {
    try {
      const get = api?.ui?.multiselect?.getSelected;
      if (typeof get !== "function") return false;
      const list = await get.call(api.ui.multiselect);
      const prefix = `render-block-path-${s.uid}`;
      return Array.isArray(list) && list.some((x) => String(x?.["window-id"] ?? "").startsWith(prefix));
    } catch (error) {
      console.warn("[plexus] selection read failed", error);
      return false;
    }
  }
  async function clearMountSelection(s) {
    if (!await ownsSelection(s)) return;
    dispatchEscape();
    await sleep2(SELECTION_RECHECK_MS);
    if (await ownsSelection(s)) dispatchEscape();
  }
  function dispatchEscape() {
    try {
      const View = doc.defaultView;
      const Ctor = View?.KeyboardEvent ?? globalThis.KeyboardEvent;
      doc.dispatchEvent(new Ctor("keydown", { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true }));
    } catch (error) {
      console.warn("[plexus] selection clear failed", error);
    }
  }
  async function runLeave(s, trigger) {
    const { portal, inner } = s;
    for (const off of s.globalOffs.splice(0)) off();
    for (const off of s.pointerOffs.splice(0)) off();
    portal.root.style.pointerEvents = "none";
    notify();
    const active = doc.activeElement;
    if (active && within(active, inner)) {
      try {
        active.blur?.();
      } catch (error) {
        console.warn("[plexus] blur failed", error);
      }
    }
    const keyboard = KEYBOARD_LEAVES.has(trigger);
    if (keyboard) {
      try {
        containerEl.focus?.({ preventScroll: true });
      } catch (error) {
        console.warn("[plexus] container focus failed", error);
      }
    }
    await sleep2(LEAVE_WAIT_MS);
    try {
      api?.ui?.components?.unmountNode?.({ el: inner });
    } catch (error) {
      console.warn("[plexus] unmount failed", error);
    }
    inner.remove?.();
    if (typeof s.onLeave === "function") {
      try {
        Promise.resolve(s.onLeave({ trigger })).catch((error) => console.warn("[plexus] onLeave failed", error));
      } catch (error) {
        console.warn("[plexus] onLeave failed", error);
      }
    }
    for (const off of s.keyOffs.splice(0)) off();
    portal.root.className = "plexus-portal plexus-embed";
    portal.root.setAttribute?.("aria-hidden", "true");
    const st = portal.root.style;
    st.pointerEvents = "";
    st.zIndex = String(zIndex);
    st.left = "";
    st.top = "";
    st.minHeight = "";
    portal.editing = false;
    portal.stale = false;
    portal.session = null;
    session = null;
    if (!disposed && !portal.dead && !portal.removing) {
      void load(portal);
      try {
        sync();
      } catch (error) {
        console.warn("[plexus] embed reposition failed", error);
      }
    }
    await clearMountSelection(s);
    if (keyboard && !disposed && s.prev) {
      const live = new Set((app.getSceneElements?.() ?? app.getSceneElementsIncludingDeleted?.() ?? []).filter((e) => !e.isDeleted).map((e) => e.id));
      const now2 = app.state || {};
      const untouched = !Object.keys(now2.selectedElementIds || {}).length && !Object.keys(now2.selectedGroupIds || {}).length;
      if (untouched && Object.keys(s.prev.ids).every((id) => live.has(id))) updateSelection(s.prev.ids, s.prev.groups);
    }
    notify();
  }
  unsubscribe2 = subscribe2(app, schedule);
  schedule();
  return {
    portalCount: () => portals.size,
    isEditing: () => !!session,
    editState: () => session?.phase ?? "idle",
    editingId: () => session?.id ?? null,
    hasPortal: (id) => !!portals.get(id) && !portals.get(id).dead,
    edit,
    leave,
    dispose() {
      if (disposed) return disposePromise;
      disposed = true;
      if (raf != null) cancelFrame(raf);
      raf = null;
      try {
        unsubscribe2?.();
      } catch (error) {
        console.warn("[plexus] unsubscribe failed", error);
      }
      unsubscribe2 = null;
      const finish = () => {
        for (const id of [...portals.keys()]) remove(id);
        for (const entry of [...watches.values()]) {
          try {
            entry.dispose?.();
          } catch (error) {
            console.warn("[plexus] unwatch failed", error);
          }
        }
        watches.clear();
        dirty.clear();
      };
      if (session) {
        disposePromise = leave("unload").then(finish, (error) => {
          console.warn("[plexus] leave failed", error);
          finish();
        });
      } else {
        finish();
        disposePromise = Promise.resolve();
      }
      return disposePromise;
    }
  };
}

// src/view/backlinks.js
var BACKLINK_WATCH_CAP = 150;
var BACKLINK_ROW_CAP = 20;
var MERGE_TOLERANCE = 2;
var REGION_REFETCH_MS = 3e3;
var REFS_PATTERN = "[{:block/_refs [:block/uid :block/string {:block/page [:node/title :block/uid]}]}]";
var WATCH_PATTERN = "[{:block/_refs [:block/uid]}]";
var IMAGE_KINDS = /* @__PURE__ */ new Set(["imgrect", "imgpoly"]);
var union = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
var themed = (base3, dark) => dark ? `${base3} plexus-backlinks--dark` : base3;
var sameBox = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= MERGE_TOLERANCE);
function createCanvasBacklinks({
  doc,
  api = globalThis.roamAlphaAPI,
  host,
  app,
  containerEl,
  drawingUid,
  zIndex = 1e3,
  native = native_exports,
  openTarget = () => {
  },
  raf,
  caf,
  now = () => Date.now()
}) {
  const view2 = doc.defaultView;
  const requestFrame = raf ?? ((cb) => typeof view2?.requestAnimationFrame === "function" ? view2.requestAnimationFrame(cb) : setTimeout(cb, 16));
  const cancelFrame = caf ?? ((id) => typeof view2?.cancelAnimationFrame === "function" ? view2.cancelAnimationFrame(id) : clearTimeout(id));
  const layer = doc.createElement("div");
  layer.className = "plexus-portal plexus-backlinks";
  layer.style.zIndex = String(zIndex + 1);
  doc.body.append(layer);
  const badges = /* @__PURE__ */ new Map();
  const refsByUid = /* @__PURE__ */ new Map();
  const watches = /* @__PURE__ */ new Map();
  let regions = [];
  let regionsAt = -Infinity;
  let regionSig = "";
  let targets = [];
  let sceneSig = null;
  let pendingFrame = null;
  let unsubscribe2 = null;
  let disposed = false;
  let capLogged = false;
  let popover = null;
  const warn5 = (message, error) => console.warn("[plexus]", message, error);
  const excludedUids = () => /* @__PURE__ */ new Set([drawingUid, ...regions.map((r) => r.uid)]);
  function loadRefs(uid) {
    let raw;
    try {
      raw = api.data.pull(REFS_PATTERN, [":block/uid", uid]);
    } catch (error) {
      warn5("backlinks pull failed", error);
      return [];
    }
    const excluded = excludedUids();
    const rows = [];
    for (const r of raw?.[":block/_refs"] ?? []) {
      const refUid = r?.[":block/uid"];
      if (!refUid || excluded.has(refUid)) continue;
      const string = r[":block/string"] ?? "";
      if (isContainerString(string)) continue;
      rows.push({ uid: refUid, string, page: r[":block/page"]?.[":node/title"] ?? "" });
    }
    return rows;
  }
  function fetchRegions() {
    try {
      regions = host.regionsOf(drawingUid) ?? [];
    } catch (error) {
      warn5("backlinks regions failed", error);
      regions = [];
    }
    regionsAt = now();
    const sig = regions.map((r) => r.uid).join(",");
    const changed = sig !== regionSig;
    regionSig = sig;
    return changed;
  }
  function nodeUidOf(el, byId) {
    const own = el?.customData?.plexus?.mm?.uid;
    if (own) return own;
    const container = el?.containerId ? byId.get(el.containerId) : null;
    return container?.customData?.plexus?.mm?.uid ?? null;
  }
  function regionNodeUid(region, live, byId) {
    let members = [];
    if (region.kind === "area") members = (region.ids ?? []).map((id) => byId.get(id)).filter(Boolean);
    else if (region.kind === "group") {
      const g = region.groupId ?? region.g;
      members = live.filter((el) => Array.isArray(el.groupIds) && el.groupIds.includes(g));
    }
    if (!members.length) return null;
    const uids = new Set(members.map((el) => nodeUidOf(el, byId)));
    return uids.size === 1 && !uids.has(null) ? [...uids][0] : null;
  }
  function collectTargets() {
    const elements = app.getSceneElementsIncludingDeleted?.() ?? [];
    const appState = app.state;
    const live = liveElements(elements);
    const byId = new Map(live.map((el) => [el.id, el]));
    const byAnchor = /* @__PURE__ */ new Map();
    const add = (anchor, uid, bbox) => {
      const prev = byAnchor.get(anchor);
      if (!prev) byAnchor.set(anchor, { uids: /* @__PURE__ */ new Set([uid]), bbox });
      else {
        prev.uids.add(uid);
        prev.bbox = union(prev.bbox, bbox);
      }
    };
    for (const { uid, region } of regions) {
      if (!region || IMAGE_KINDS.has(region.kind)) continue;
      try {
        const out = regionSceneBBox({ ...region, pad: 0 }, elements, appState);
        if (out?.bbox) add(regionNodeUid(region, live, byId) ?? uid, uid, out.bbox);
      } catch (error) {
        warn5("backlinks region bbox failed", error);
      }
    }
    for (const el of live) {
      const uid = el?.customData?.plexus?.mm?.uid;
      if (!uid) continue;
      try {
        add(uid, uid, elementBounds(el));
      } catch (error) {
        warn5("backlinks node bbox failed", error);
      }
    }
    return [...byAnchor.values()].map((t) => ({ uids: [...t.uids], bbox: t.bbox }));
  }
  function syncWatches(uids) {
    const wanted = new Set(uids);
    for (const [uid, entry] of [...watches]) {
      if (wanted.has(uid)) continue;
      removeWatch(uid, entry);
    }
    for (const uid of uids) {
      if (watches.has(uid)) continue;
      if (watches.size >= BACKLINK_WATCH_CAP) {
        if (!capLogged) {
          capLogged = true;
          console.warn(`[plexus] backlinks: more than ${BACKLINK_WATCH_CAP} targets, extra badges are not live`);
        }
        continue;
      }
      const eid = `[:block/uid "${uid}"]`;
      const cb = () => {
        if (disposed) return;
        try {
          refsByUid.set(uid, loadRefs(uid));
          render();
          layout();
        } catch (error) {
          warn5("backlinks watch failed", error);
        }
      };
      try {
        api.data.addPullWatch(WATCH_PATTERN, eid, cb);
        watches.set(uid, { eid, cb });
      } catch (error) {
        warn5("backlinks watch failed", error);
      }
    }
  }
  function removeWatch(uid, entry) {
    watches.delete(uid);
    try {
      api.data.removePullWatch(WATCH_PATTERN, entry.eid, entry.cb);
    } catch (error) {
      warn5("backlinks unwatch failed", error);
    }
  }
  function groups() {
    const out = [];
    const sorted = [...targets].sort((a, b) => a.uids[0] < b.uids[0] ? -1 : 1);
    for (const t of sorted) {
      const g = out.find((x) => sameBox(x.bbox, t.bbox));
      if (g) {
        g.uids.push(...t.uids.filter((u) => !g.uids.includes(u)));
        g.bbox = union(g.bbox, t.bbox);
      } else out.push({ uids: [...t.uids], bbox: [...t.bbox] });
    }
    for (const g of out) g.uids.sort();
    return out;
  }
  function refsOf(uids) {
    const seen = /* @__PURE__ */ new Set();
    const rows = [];
    for (const uid of uids) {
      for (const row of refsByUid.get(uid) ?? []) {
        if (seen.has(row.uid)) continue;
        seen.add(row.uid);
        rows.push(row);
      }
    }
    return rows;
  }
  function makeBadge(key) {
    const el = doc.createElement("button");
    el.className = "plexus-backlink-badge";
    el.type = "button";
    const stop = (e) => e?.stopPropagation?.();
    const onClick = (e) => {
      e?.stopPropagation?.();
      e?.preventDefault?.();
      if (popover?.key === key) closePopover();
      else openPopover(key);
    };
    el.addEventListener("pointerdown", stop);
    el.addEventListener("mousedown", stop);
    el.addEventListener("click", onClick);
    layer.append(el);
    return {
      key,
      el,
      uids: [],
      bbox: null,
      refs: [],
      x: 0,
      y: 0,
      hidden: false,
      detach() {
        el.removeEventListener("pointerdown", stop);
        el.removeEventListener("mousedown", stop);
        el.removeEventListener("click", onClick);
        el.remove();
      }
    };
  }
  function render() {
    const live = /* @__PURE__ */ new Map();
    for (const g of groups()) {
      const refs = refsOf(g.uids);
      if (!refs.length) continue;
      const key = g.uids.join("|");
      let badge = badges.get(key);
      if (!badge) {
        badge = makeBadge(key);
        badges.set(key, badge);
      }
      const changed = badge.refs.length !== refs.length || badge.refs.some((r, i) => r.uid !== refs[i].uid || r.string !== refs[i].string);
      badge.uids = g.uids;
      badge.bbox = g.bbox;
      badge.refs = refs;
      if (badge.count !== refs.length) {
        badge.count = refs.length;
        badge.el.textContent = String(refs.length);
        badge.el.title = `${refs.length} ${refs.length === 1 ? "reference" : "references"}`;
      }
      live.set(key, badge);
      if (changed && popover?.key === key) repaintPopover();
    }
    for (const [key, badge] of [...badges]) {
      if (live.has(key)) continue;
      badges.delete(key);
      if (popover?.key === key) closePopover();
      badge.detach();
    }
  }
  function layout() {
    if (disposed || !badges.size) return;
    const dark = app.state?.theme === "dark";
    layer.className = themed("plexus-portal plexus-backlinks", dark);
    if (popover) popover.el.className = themed("plexus-portal plexus-backlink-popover", dark);
    const box = containerEl?.getBoundingClientRect?.() ?? { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
    for (const badge of badges.values()) {
      const rect = native.viewportRectOf(app, badge.bbox);
      const cx = rect.left + rect.width;
      const cy = rect.top;
      const hidden = !(cx >= box.left && cx <= box.right && cy >= box.top && cy <= box.bottom);
      badge.x = cx + 3;
      badge.y = cy + 3;
      badge.hidden = hidden;
      badge.el.style.left = `${badge.x}px`;
      badge.el.style.top = `${badge.y}px`;
      badge.el.style.display = hidden ? "none" : "";
      if (hidden && popover?.key === badge.key) closePopover();
    }
    if (popover) placePopover();
  }
  function update() {
    if (disposed) return;
    let regionsChanged = false;
    if (now() - regionsAt > REGION_REFETCH_MS) regionsChanged = fetchRegions();
    const elements = app.getSceneElementsIncludingDeleted?.() ?? [];
    let sum = elements.length;
    for (const el of elements) sum += Number(el?.version) || 0;
    const sig = `${sum}:${elements.length}`;
    if (regionsChanged || sig !== sceneSig) {
      sceneSig = sig;
      targets = collectTargets();
      const uids = targets.flatMap((t) => t.uids);
      syncWatches(uids);
      for (const uid of uids) if (!refsByUid.has(uid) || regionsChanged) refsByUid.set(uid, loadRefs(uid));
      for (const uid of [...refsByUid.keys()]) if (!uids.includes(uid)) refsByUid.delete(uid);
      render();
    }
    layout();
  }
  function schedule() {
    if (disposed || pendingFrame != null) return;
    pendingFrame = requestFrame(() => {
      pendingFrame = null;
      try {
        update();
      } catch (error) {
        warn5("backlinks update failed", error);
      }
    });
  }
  function placePopover() {
    const badge = badges.get(popover?.key);
    if (!badge) return;
    const width = view2?.innerWidth;
    const left = Number.isFinite(width) ? Math.max(0, Math.min(badge.x, width - 340)) : badge.x;
    popover.el.style.left = `${left}px`;
    popover.el.style.top = `${badge.y + 24}px`;
  }
  function onKey(e) {
    if (e?.key === "Escape") closePopover();
  }
  const inside = (target) => {
    for (let n = target; n; n = n.parentNode ?? n.parentElement) {
      if (n === popover?.el) return true;
      if (n?.classList?.contains?.("plexus-backlink-badge") || n?.className === "plexus-backlink-badge") return true;
    }
    return false;
  };
  const onOutside = (e) => {
    if (!inside(e?.target)) closePopover();
  };
  function openPopover(key) {
    closePopover();
    const badge = badges.get(key);
    if (!badge) return;
    const el = doc.createElement("div");
    el.className = themed("plexus-portal plexus-backlink-popover", app.state?.theme === "dark");
    el.style.zIndex = String(zIndex + 3);
    const stop = (e) => e?.stopPropagation?.();
    el.addEventListener("mousedown", stop);
    el.addEventListener("pointerdown", stop);
    const hosts = [];
    const rowHandlers = [];
    for (const ref of badge.refs.slice(0, BACKLINK_ROW_CAP)) {
      const row = doc.createElement("div");
      row.className = "plexus-backlink-row";
      const page = doc.createElement("div");
      page.className = "plexus-backlink-page";
      page.textContent = ref.page;
      const body = doc.createElement("div");
      body.className = "plexus-backlink-block";
      row.append(page, body);
      el.append(row);
      hosts.push(body);
      try {
        api.ui.components.renderString({ el: body, string: ref.string });
      } catch (error) {
        warn5("backlinks render failed", error);
        body.textContent = ref.string;
      }
      const onClick = (e) => {
        e?.stopPropagation?.();
        e?.preventDefault?.();
        closePopover();
        try {
          openTarget({ type: "block", uid: ref.uid }, { sidebar: !!e?.shiftKey });
        } catch (error) {
          warn5("backlinks open failed", error);
        }
      };
      row.addEventListener("click", onClick);
      rowHandlers.push([row, onClick]);
    }
    if (badge.refs.length > BACKLINK_ROW_CAP) {
      const more = doc.createElement("div");
      more.className = "plexus-backlink-more";
      more.textContent = `+${badge.refs.length - BACKLINK_ROW_CAP} more`;
      el.append(more);
    }
    doc.body.append(el);
    popover = { key, el, hosts, stop, rowHandlers };
    doc.addEventListener("keydown", onKey, true);
    doc.addEventListener("mousedown", onOutside, true);
    doc.addEventListener("wheel", onOutside, true);
    doc.addEventListener("scroll", onOutside, true);
    placePopover();
  }
  function closePopover() {
    const p = popover;
    if (!p) return;
    popover = null;
    doc.removeEventListener("keydown", onKey, true);
    doc.removeEventListener("mousedown", onOutside, true);
    doc.removeEventListener("wheel", onOutside, true);
    doc.removeEventListener("scroll", onOutside, true);
    for (const host_ of p.hosts) {
      try {
        api.ui.components.unmountNode({ el: host_ });
      } catch (error) {
        warn5("backlinks unmount failed", error);
      }
    }
    for (const [row, fn] of p.rowHandlers) row.removeEventListener("click", fn);
    p.el.removeEventListener("mousedown", p.stop);
    p.el.removeEventListener("pointerdown", p.stop);
    p.el.remove();
  }
  function repaintPopover() {
    const key = popover?.key;
    if (key) openPopover(key);
  }
  function refresh() {
    if (disposed) return;
    try {
      fetchRegions();
      sceneSig = null;
      targets = [];
      for (const uid of [...refsByUid.keys()]) refsByUid.delete(uid);
      update();
    } catch (error) {
      warn5("backlinks refresh failed", error);
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (pendingFrame != null) {
      cancelFrame(pendingFrame);
      pendingFrame = null;
    }
    try {
      unsubscribe2?.();
    } catch (error) {
      warn5("backlinks unsubscribe failed", error);
    }
    unsubscribe2 = null;
    closePopover();
    for (const [uid, entry] of [...watches]) removeWatch(uid, entry);
    for (const badge of badges.values()) badge.detach();
    badges.clear();
    refsByUid.clear();
    layer.remove();
  }
  try {
    unsubscribe2 = native.subscribeViewport(app, schedule);
  } catch (error) {
    warn5("backlinks subscribe failed", error);
  }
  refresh();
  return { refresh, dispose };
}

// src/view/present.js
var NEXT_KEYS = /* @__PURE__ */ new Set(["ArrowRight", "PageDown", " ", "Spacebar", "Enter"]);
var PREV_KEYS = /* @__PURE__ */ new Set(["ArrowLeft", "PageUp", "Backspace"]);
function createPresenter({ doc }) {
  let current2 = null;
  const close2 = () => {
    const state = current2;
    if (!state) return;
    current2 = null;
    state.dialog.removeEventListener?.("keydown", state.onKey);
    state.dialog.removeEventListener?.("keyup", state.onKeyUp);
    state.dialog.removeEventListener?.("click", state.onClick);
    state.dialog.removeEventListener?.("cancel", state.onCancel);
    state.dialog.removeEventListener?.("close", state.onClosed);
    try {
      if (state.dialog.open) state.dialog.close?.();
    } catch (error) {
      console.warn("[plexus] dialog close failed", error);
    }
    state.preload.src = "";
    state.dialog.remove();
    try {
      state.onClose?.();
    } catch (error) {
      console.warn("[plexus] present close hook failed", error);
    }
  };
  return {
    isOpen: () => !!current2,
    close: close2,
    dispose: close2,
    // slides: [{ name, url|null }]. Returns a handle; setSlide fills a slide that was not ready yet.
    open({ slides, index = 0, onClose } = {}) {
      close2();
      const list = slides.map((s) => ({ name: s.name ?? "", url: s.url ?? null }));
      const dialog = doc.createElement("dialog");
      dialog.className = "plexus-portal plexus-present";
      dialog.setAttribute("aria-label", "Presentation");
      dialog.tabIndex = -1;
      const img = doc.createElement("img");
      img.className = "plexus-present-slide";
      img.draggable = false;
      img.alt = "";
      const wait = doc.createElement("div");
      wait.className = "plexus-present-wait";
      wait.textContent = "Rendering...";
      const hud = doc.createElement("div");
      hud.className = "plexus-present-hud";
      img.addEventListener?.("load", () => {
        if (list[at]?.url) wait.hidden = true;
      });
      dialog.append(img, wait, hud);
      const preload = doc.createElement("img");
      let at = Math.min(Math.max(0, index), list.length - 1);
      const show = () => {
        const slide = list[at];
        hud.textContent = `${at + 1} / ${list.length} · ${slide.name}`;
        if (slide.url) {
          img.src = slide.url;
          img.hidden = false;
          wait.hidden = true;
        } else {
          wait.textContent = slide.error ? "Could not render this slide" : "Rendering...";
          img.removeAttribute?.("src");
          img.hidden = true;
          wait.hidden = false;
        }
        const next = list[at + 1];
        if (next?.url) preload.src = next.url;
      };
      const go = (to) => {
        const clamped = Math.min(list.length - 1, Math.max(0, to));
        if (clamped === at) return;
        at = clamped;
        show();
      };
      const onKey = (e) => {
        let handled = true;
        if (NEXT_KEYS.has(e.key)) go(at + 1);
        else if (PREV_KEYS.has(e.key)) go(at - 1);
        else if (e.key === "Home") go(0);
        else if (e.key === "End") go(list.length - 1);
        else handled = false;
        if (handled) e.preventDefault?.();
        if (e.key !== "Escape" && e.key !== "Tab") e.stopPropagation?.();
      };
      const onKeyUp = (e) => e.stopPropagation?.();
      const onClick = (e) => {
        const width = dialog.getBoundingClientRect?.().width || doc.defaultView?.innerWidth || 0;
        const left = dialog.getBoundingClientRect?.().left || 0;
        e.stopPropagation?.();
        go(e.clientX - left < width / 2 ? at - 1 : at + 1);
      };
      const onCancel = (e) => {
        e.preventDefault?.();
        close2();
      };
      const onClosed = () => close2();
      dialog.addEventListener("keydown", onKey);
      dialog.addEventListener("keyup", onKeyUp);
      dialog.addEventListener("click", onClick);
      dialog.addEventListener("cancel", onCancel);
      dialog.addEventListener("close", onClosed);
      current2 = { dialog, preload, onKey, onKeyUp, onClick, onCancel, onClosed, onClose };
      doc.body.append(dialog);
      show();
      dialog.showModal();
      dialog.focus?.();
      const state = current2;
      return {
        setSlide(i, patch) {
          if (current2 !== state || !list[i]) return;
          Object.assign(list[i], patch);
          if (i === at || i === at + 1) show();
        },
        isOpen: () => current2 === state,
        close: () => {
          if (current2 === state) close2();
        }
      };
    }
  };
}

// src/host/theme.js
var MEMO_MS = 1e3;
var memo2 = null;
var has = (el, cls) => !!el?.classList?.contains?.(cls);
function markerDark(doc) {
  const html = doc.documentElement;
  const body = doc.body;
  return has(html, "bp3-dark") || has(body, "bp3-dark") || has(body, "bt-theme-dark") || has(html, "rm-dark-theme") || has(body, "rm-dark-theme") || has(body, "roam-body") && has(body, "dark");
}
function hostDarkMarker(doc) {
  try {
    return !!doc?.body && markerDark(doc);
  } catch {
    return false;
  }
}
function parseColor(value) {
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(String(value ?? "").trim());
  if (!m) return null;
  let a = m[4] == null ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  if (!Number.isFinite(a)) a = 1;
  return { r: +m[1], g: +m[2], b: +m[3], a };
}
function luminance({ r, g, b }) {
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function measure(doc) {
  const view2 = doc.defaultView;
  if (!doc.body || !view2?.getComputedStyle) return false;
  for (const el of [doc.body, doc.documentElement]) {
    if (!el) continue;
    const c = parseColor(view2.getComputedStyle(el).backgroundColor);
    if (c && c.a > 0) return luminance(c) < 0.4;
  }
  return false;
}
function isHostDark(doc) {
  try {
    const now = Date.now();
    if (memo2 && memo2.doc === doc && now - memo2.at < MEMO_MS) return memo2.value;
    const value = !!doc?.body && (markerDark(doc) || measure(doc));
    memo2 = { doc, at: now, value };
    return value;
  } catch (error) {
    console.warn("[plexus] theme probe failed", error);
    return false;
  }
}
function resetThemeMemo() {
  memo2 = null;
}
function motionOk(doc, animationSetting) {
  if (animationSetting === "off") return false;
  if (animationSetting === "on") return true;
  try {
    const mq = doc?.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)");
    return mq ? !mq.matches : true;
  } catch {
    return true;
  }
}

// src/model/label.js
var PLACEHOLDER_REGION = "Region";
var PLACEHOLDER_IMAGE_REGION = "Image region";
var PLACEHOLDER_IMAGE_CROP = "Image crop";
var PLACEHOLDER_FRAME = "Frame";
var PLACEHOLDER_CAPTIONS = Object.freeze([PLACEHOLDER_REGION, PLACEHOLDER_IMAGE_REGION, PLACEHOLDER_IMAGE_CROP, PLACEHOLDER_FRAME]);
var PLACEHOLDER_KINDS = Object.freeze({
  [PLACEHOLDER_REGION]: Object.freeze(["area", "group", "frame", "cframe"]),
  [PLACEHOLDER_FRAME]: Object.freeze(["frame", "cframe"]),
  [PLACEHOLDER_IMAGE_REGION]: Object.freeze(["rect", "poly", "imgrect", "imgpoly"]),
  [PLACEHOLDER_IMAGE_CROP]: Object.freeze(["rect"])
});
var KIND_WORDS = Object.freeze({
  area: "area",
  group: "group",
  frame: "frame",
  cframe: "clipped frame",
  rect: "crop",
  poly: "lasso",
  imgrect: "image area",
  imgpoly: "image lasso"
});
var IMAGE_KINDS2 = /* @__PURE__ */ new Set(["imgrect", "imgpoly"]);
var isImageKind = (kind) => IMAGE_KINDS2.has(kind);
var MAX_LABEL = 80;
var MAX_TITLE = 40;
var MAX_REF_TEXT = 40;
function isPlaceholderCaption(caption, kind) {
  const text = String(caption ?? "").trim();
  return Object.hasOwn(PLACEHOLDER_KINDS, text) && PLACEHOLDER_KINDS[text].includes(kind);
}
function cut(text, max) {
  if (text.length <= max) return text;
  const head = text.slice(0, max - 1);
  const space = head.lastIndexOf(" ");
  const base3 = text[max - 1] === " " || space <= 0 ? head : head.slice(0, space);
  return `${base3.trimEnd()}…`;
}
function dropMacros(text) {
  let out = text;
  for (let i = 0; i < 5; i++) {
    const next = out.replace(/\{\{(?:(?!\{\{)[\s\S])*?\}\}/g, " ");
    if (next === out) break;
    out = next;
  }
  return out;
}
function stripMarkup(input) {
  let text = dropMacros(String(input ?? ""));
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt) => ` ${alt} `);
  text = text.replace(/\[([^\]]*)\]\((?:\(\([^)]*\)\)|[^)]*)\)/g, " $1 ");
  text = text.replace(/#?\[\[/g, "[[");
  for (let pass = 0; pass < 3 && text.includes("[["); pass++) text = text.replace(/\[\[([^[\]]*)\]\]/g, "$1");
  text = text.replace(/(^|\s)#([^\s#[\]()]+)/g, "$1$2");
  return text.replace(/\*\*|__|\^\^|~~|`/g, "");
}
function collapseSeparators(text) {
  const parts = text.replace(/\s+/g, " ").trim().split(/(?:^|\s)[;·](?=\s|$)/).map((p) => p.trim()).filter(Boolean);
  return parts.join(" · ");
}
function blockText(uid, resolveBlock) {
  if (typeof resolveBlock !== "function") return "";
  let string;
  try {
    string = resolveBlock(uid);
  } catch {
    return "";
  }
  if (typeof string !== "string" || /^\s*\{\{/.test(string)) return "";
  const plain = collapseSeparators(stripMarkup(string.replace(/\(\([\w-]+\)\)/g, " ")));
  return plain.slice(0, MAX_REF_TEXT).trim();
}
function plainCaption(caption, resolveBlock) {
  const withRefs = String(caption ?? "").replace(/(\[[^\]]*\]\()?\(\(([\w-]+)\)\)/g, (whole, alias, uid) => alias ? whole : ` ${blockText(uid, resolveBlock)} `);
  return collapseSeparators(stripMarkup(withRefs));
}
function regionLabel(input) {
  try {
    const { kind, caption, drawingTitle, imageAlt, resolveBlock } = input || {};
    const own = plainCaption(caption, resolveBlock);
    if (own) return cut(own, MAX_LABEL);
    const image = isImageKind(kind);
    if (image) {
      const alt = collapseSeparators(stripMarkup(imageAlt));
      if (alt) return cut(alt, MAX_LABEL);
    }
    const title = collapseSeparators(stripMarkup(drawingTitle)) || (image ? "Image" : "Drawing");
    return cut(`${title} · ${KIND_WORDS[kind] || "region"}`, MAX_LABEL);
  } catch {
    return "Region";
  }
}
function imageAltAt(blockString, index) {
  try {
    return parseImageRefs(blockString).find((r) => r.index === index)?.alt.trim() || null;
  } catch {
    return null;
  }
}
var DRAWING_RE = /\{\{\s*(?:\[\[excalidraw\]\]|excalidraw)\s*\}\}/;
function drawingTitleOf(ownerString, pageTitle) {
  try {
    const page = collapseSeparators(stripMarkup(pageTitle));
    if (page) return cut(page, MAX_TITLE);
    const string = String(ownerString ?? "");
    if (DRAWING_RE.test(string)) {
      const info = /Text elements in drawing:\s*([^;}]*)/.exec(string);
      const first = info ? collapseSeparators(stripMarkup(info[1])) : "";
      return first ? cut(first, MAX_TITLE) : "Drawing";
    }
    const plain = collapseSeparators(stripMarkup(string.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")));
    return plain ? cut(plain, MAX_TITLE) : "Image";
  } catch {
    return "Drawing";
  }
}

// src/view/crop-popover.js
var MAX_W = 480;
var MAX_H = 360;
var GAP = 6;
var EDGE = 4;
var HEAD_H = 18;
function createCropPopover({ doc, delayMs = 300 }) {
  let portal = null;
  let token = 0;
  let timer = null;
  let scrollTarget = null;
  const hovers = /* @__PURE__ */ new Set();
  const onDismiss = () => hide();
  function unlisten() {
    scrollTarget?.removeEventListener?.("scroll", onDismiss, true);
    scrollTarget = null;
    doc.removeEventListener?.("mousedown", onDismiss, true);
  }
  function hide() {
    token += 1;
    if (timer != null) clearTimeout(timer);
    timer = null;
    unlisten();
    portal?.remove();
    portal = null;
  }
  function place(anchor, entry) {
    const view2 = doc.defaultView;
    const vw = view2?.innerWidth || 1024;
    const vh = view2?.innerHeight || 768;
    const nw = entry.w > 0 ? entry.w : MAX_W;
    const nh = entry.h > 0 ? entry.h : MAX_H;
    const scale = Math.min(1, MAX_W / nw, MAX_H / nh);
    const w = Math.max(1, Math.round(nw * scale));
    const h = Math.max(1, Math.round(nh * scale));
    const peek = entry.peek;
    const totalW = peek ? w + GAP + peek.w : w;
    const totalH = peek ? HEAD_H + Math.max(h, peek.h) : h;
    const rect = anchor.getBoundingClientRect?.() || { left: 0, top: 0, bottom: 0 };
    let top = rect.bottom + GAP;
    if (top + totalH > vh - EDGE) top = rect.top - GAP - totalH;
    top = Math.max(EDGE, Math.min(top, vh - totalH - EDGE));
    const left = Math.max(EDGE, Math.min(rect.left, vw - totalW - EDGE));
    return { w, h, top, left };
  }
  function peekHead(peek) {
    const head = doc.createElement("div");
    head.className = "plexus-peek-head";
    head.style.height = `${HEAD_H}px`;
    head.style.overflow = "hidden";
    head.style.whiteSpace = "nowrap";
    head.style.textOverflow = "ellipsis";
    head.style.fontSize = "12px";
    head.textContent = [peek.title, peek.kind].filter(Boolean).join(" · ");
    return head;
  }
  function peekRow(img, peek, invertClass) {
    const row = doc.createElement("div");
    row.className = "plexus-peek-row";
    row.style.display = "flex";
    row.style.alignItems = "flex-start";
    row.style.gap = `${GAP}px`;
    const thumb = doc.createElement("div");
    thumb.className = "plexus-peek-thumb";
    thumb.style.position = "relative";
    thumb.style.flex = "none";
    thumb.style.width = `${peek.w}px`;
    thumb.style.height = `${peek.h}px`;
    const timg = doc.createElement("img");
    timg.className = `plexus-crop plexus-peek-img${invertClass}`;
    timg.draggable = false;
    timg.style.width = `${peek.w}px`;
    timg.style.height = `${peek.h}px`;
    timg.src = peek.url;
    const outline = doc.createElement("div");
    outline.className = "plexus-peek-outline";
    outline.style.position = "absolute";
    outline.style.boxSizing = "border-box";
    outline.style.border = "2px solid #e8590c";
    outline.style.pointerEvents = "none";
    outline.style.left = `${peek.rect.x}px`;
    outline.style.top = `${peek.rect.y}px`;
    outline.style.width = `${peek.rect.w}px`;
    outline.style.height = `${peek.rect.h}px`;
    thumb.append(timg, outline);
    row.append(img, thumb);
    return row;
  }
  function show(anchor, getEntry) {
    const mine = ++token;
    Promise.resolve().then(() => getEntry()).then((entry) => {
      if (mine !== token || !entry?.url || anchor.isConnected === false) return;
      const box = place(anchor, entry);
      portal?.remove();
      portal = doc.createElement("div");
      portal.className = "plexus-portal plexus-crop-popover";
      portal.style.position = "fixed";
      portal.style.pointerEvents = "none";
      portal.style.zIndex = "100001";
      portal.style.left = `${box.left}px`;
      portal.style.top = `${box.top}px`;
      const invertClass = `${entry.invertible ? " plexus-crop--invertible" : ""}${entry.invertible && isHostDark(doc) && !hostDarkMarker(doc) ? " plexus-crop--invert" : ""}`;
      const img = doc.createElement("img");
      img.className = `plexus-crop${invertClass}`;
      img.draggable = false;
      img.style.width = `${box.w}px`;
      img.style.height = `${box.h}px`;
      img.onerror = () => {
        if (mine === token) hide();
      };
      img.src = entry.url;
      if (entry.peek) portal.append(peekHead(entry.peek), peekRow(img, entry.peek, invertClass));
      else portal.append(img);
      doc.body.append(portal);
      scrollTarget = doc.defaultView;
      scrollTarget?.addEventListener?.("scroll", onDismiss, true);
      doc.addEventListener?.("mousedown", onDismiss, true);
    }).catch((error) => console.warn("[plexus] crop popover failed", error));
  }
  function hoverOn(anchor, getEntry) {
    const enter = () => {
      if (timer != null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        try {
          show(anchor, getEntry);
        } catch (error) {
          console.warn("[plexus] crop popover failed", error);
        }
      }, delayMs);
    };
    const leave = () => hide();
    anchor.addEventListener("mouseenter", enter);
    anchor.addEventListener("mouseleave", leave);
    const dispose = () => {
      anchor.removeEventListener?.("mouseenter", enter);
      anchor.removeEventListener?.("mouseleave", leave);
      hovers.delete(dispose);
      hide();
    };
    hovers.add(dispose);
    return dispose;
  }
  return {
    hoverOn,
    hide,
    dispose() {
      for (const d of [...hovers]) d();
      hide();
    }
  };
}

// src/view/regionref.js
var CLAIMED = "data-plexus-claimed";
var ALIAS_CLAIMED = "data-plexus-alias";
var FAIL_TTL_MS = 6e4;
var PRUNE_FLOOR = 64;
var IMAGE_SETTLE_MS = 1200;
var PLAIN_SETTLE_MS = 150;
var IMAGE_KINDS3 = /* @__PURE__ */ new Set(["imgrect", "imgpoly"]);
var isImageKind2 = (kind) => IMAGE_KINDS3.has(kind);
var pt = (v) => Array.isArray(v) ? v : [v.x, v.y];
function displayedRect(el, f) {
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
function displayedPoly(el, p) {
  if (!el?.crop) return p;
  const out = [];
  for (let i = 0; i + 1 < p.length; i += 2) {
    const [sx, sy] = pt(naturalToScene(el, [p[i], p[i + 1]]));
    out.push((sx - el.x) / el.width, (sy - el.y) / el.height);
  }
  return clipPolyToUnit(out);
}
function displayedToNatural(el, picked) {
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
var OUTSIDE_CROP_TEXT = "Region is outside the image's crop";
function resolveRegionTarget(host, region) {
  if (isImageKind2(region.kind)) {
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
async function renderRegionCrop({ region, target, cold, doc, api, settleMs, loadBitmap = loadImageBitmap }) {
  if (isImageKind2(region.kind)) {
    const bitmap = await loadBitmap(target.url, { api });
    const f = region.kind === "imgrect" ? region.f : polyBBox(region.p);
    const crop2 = imageCropRect({ naturalWidth: bitmap.width, naturalHeight: bitmap.height, f });
    if (!crop2) return { error: "bad-crop" };
    const poly2 = region.kind === "imgpoly" ? polyToLocal(region.p, f) : void 0;
    const blob2 = await cropToBlob(bitmap, crop2, { doc, poly: poly2 });
    return { blob: blob2, w: crop2.sw, h: crop2.sh, settled: true };
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
    naturalHeight: rendered.naturalHeight
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
var GLYPH = '<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><path d="M1.5 5V1.5H5M9 1.5h3.5V5M12.5 9v3.5H9M5 12.5H1.5V9" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
var isDarkTier = (key) => typeof key === "string" && key.endsWith("|png2x-dark");
var num2 = (v, d) => Number.isFinite(Number(v)) && v !== "" && v != null ? Number(v) : d;
var overlaps = (bbox, el) => el.x < bbox[2] && el.x + el.width > bbox[0] && el.y < bbox[3] && el.y + el.height > bbox[1];
function createRegionRefRenderer({ host, cache, cold, getSettings, onOpen, doc, api = globalThis.roamAlphaAPI, loadBitmap = loadImageBitmap }) {
  const roots = /* @__PURE__ */ new Map();
  const aliases = /* @__PURE__ */ new Map();
  const notRegions = /* @__PURE__ */ new WeakSet();
  const hostRefs = /* @__PURE__ */ new Map();
  const failed = /* @__PURE__ */ new Map();
  let pruneAt = PRUNE_FLOOR;
  let popover = null;
  const getPopover = () => popover || (popover = createCropPopover({ doc }));
  const settings = () => {
    const s = getSettings() || {};
    return {
      figureHeight: num2(s.figureHeight, 280),
      thumbHeight: num2(s.thumbHeight, 72),
      inlineDisplay: s.inlineDisplay === "link" ? "link" : "thumbnail",
      captionDisplay: s.captionDisplay === "always" || s.captionDisplay === "never" ? s.captionDisplay : "written",
      refOverrides: s.refOverrides && typeof s.refOverrides === "object" ? s.refOverrides : {},
      darkCrops: s.darkCrops !== false,
      openInSidebar: s.openInSidebar
    };
  };
  const prune = () => {
    if (roots.size + aliases.size < pruneAt) return;
    for (const [root, info] of [...roots]) if (!root.isConnected) {
      dropInfo(info);
      roots.delete(root);
    }
    for (const [anchor, info] of [...aliases]) if (anchor.isConnected === false) unalias(anchor, info);
    pruneAt = Math.max(PRUNE_FLOOR, (roots.size + aliases.size) * 2);
  };
  function dropInfo(info) {
    for (const d of info.disposers.splice(0)) {
      try {
        d();
      } catch (error) {
        console.warn("[plexus] dispose failed", error);
      }
    }
  }
  const HOST_SEL = ".bp3-popover-target, .bp3-popover-wrapper";
  const STOP_SEL = '.rm-block__input, .roam-block, [id^="block-input-"]';
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
      if (n > 0) {
        hostRefs.set(el, n);
        continue;
      }
      hostRefs.delete(el);
      el.removeAttribute("data-plexus-card-host");
    }
  };
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
    for (const c of ["plexus-ref-card", "plexus-mode-image", "plexus-mode-thumbnail", "plexus-caption-hidden"]) info.refEl?.classList?.remove(c);
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
      if (key) Promise.resolve(cache.delete?.(key)).catch(() => {
      });
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
    if (!s.darkCrops || isImageKind2(region.kind) || !target?.drawing) return false;
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
      png2xDark: drawing ? png2xKey({ regionUid: uid, geometryKey: gk, drawingHash: target.hash, dark: true }) : null
    };
  };
  const wantsDark = (region, target, s) => !!(s.darkCrops && !isImageKind2(region.kind) && target?.drawing && target.drawing.appState?.theme !== "dark" && isHostDark(doc));
  const hotEntry = (region, target, keys, s) => {
    if (keys.png2xDark && wantsDark(region, target, s)) {
      const e2 = cache.peek(keys.png2xDark);
      if (e2) return { entry: e2, key: keys.png2xDark };
    }
    if (keys.svg) {
      const e2 = cache.peek(keys.svg);
      if (e2) return { entry: e2, key: keys.svg };
    }
    if (keys.png2x) {
      const e2 = cache.peek(keys.png2x);
      if (e2) return { entry: e2, key: keys.png2x };
    }
    const e = cache.peek(keys.png);
    return e ? { entry: e, key: keys.png } : null;
  };
  async function fetchEntry(region, target, keys, alive) {
    let entry = null;
    let entryKey = keys.svg || keys.png;
    if (keys.svg) entry = await cache.get(keys.svg);
    if (!entry && keys.png2x) {
      entry = cache.peek(keys.png2x);
      if (entry) entryKey = keys.png2x;
    }
    if (!entry) {
      entryKey = keys.png;
      entry = await cache.get(keys.png);
    }
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
      await cache.put(keys.png, rendered.blob, { w: rendered.w, h: rendered.h, persist: rendered.settled !== false });
      entry = cache.peek(keys.png) || await cache.get(keys.png);
    }
    return { entry, entryKey };
  }
  async function hoverEntryOf(region, target, keys, uid) {
    const s = settings();
    const hot = hotEntry(region, target, keys, s);
    let entry = hot?.entry;
    let key = hot?.key;
    if (!entry) {
      const res = await fetchEntry(region, target, keys, () => true);
      entry = res.entry;
      key = res.entryKey;
    }
    if (!entry) return null;
    const out = { url: entry.url, w: entry.w, h: entry.h, invertible: !isDarkTier(key) && invertible(region, target, s) };
    const peek = await peekOf(region, target, uid);
    if (peek) out.peek = peek;
    return out;
  }
  let peekLogged = false;
  async function peekOf(region, target, uid) {
    try {
      if (isImageKind2(region.kind) || !target?.drawing || !target.sceneBox?.bbox) return null;
      const key = thumbKey({ uid: region.drawingUid, hash: target.hash, maxWidth: 160 });
      const thumb = cache.peek(key) ?? await cache.get(key);
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
        h: Math.max(4, crop.sh * ky)
      };
      let src = null;
      try {
        src = host.labelSource?.(region.drawingUid);
      } catch {
      }
      const title = drawingTitleOf(src?.string ?? "", src?.pageTitle ?? null);
      return { url: thumb.url, w: thumb.w, h: thumb.h, rect, title, kind: KIND_WORDS[region.kind] ?? region.kind };
    } catch (error) {
      if (!peekLogged) {
        peekLogged = true;
        console.warn("[plexus] source peek unavailable", error);
      }
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
  const overrideOf = (ctx, uid, s) => {
    if (!ctx.blockUid) return {};
    const entries = [ctx.blockUid, ctx.outerUid].filter(Boolean).map((b) => s.refOverrides[overrideKey(b, uid)]).map((e) => typeof e === "string" ? { mode: e } : e).filter((e) => e && typeof e === "object");
    const pick3 = (field) => entries.find((e) => e[field] != null)?.[field];
    return { mode: pick3("mode"), caption: pick3("caption") };
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
        imageAlt: isImageKind2(region.kind) ? imageAltAt(src.string, region.i) : null,
        resolveBlock: (u) => host.pullBlock(u)?.string
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
  const hasTail = (region) => !!String(region.caption ?? "").trim();
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
      const info = { btn, refEl: ctx.refEl, refUid: uid, blockUid: ctx.blockUid, outerUid: ctx.outerUid, mode, label, capState, disposers: [], hosts: [], extras: [] };
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
      if (mode === "thumbnail") {
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
      root.style.width = `${Math.round(h * bw / bh)}px`;
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
  const claimAlias = (anchor) => {
    try {
      if (!anchor || anchor.isConnected === false) return;
      if (anchor.closest?.(".plexus-offscreen, .plexus-root")) return;
      if (anchor.classList?.contains("rm-alias--page") || !anchor.classList?.contains("rm-alias--block")) return;
      if (anchor.getAttribute?.(ALIAS_CLAIMED) || notRegions.has(anchor)) return;
      const uid = anchor.dataset?.linkUid ?? anchor.getAttribute?.("data-link-uid");
      if (!uid) return;
      if (!regionOf(uid)) {
        notRegions.add(anchor);
        return;
      }
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
      const capture = (open4) => (e) => {
        try {
          const u = currentUid();
          if (!plain(e) || !u || !regionOf(u)) return;
          e.preventDefault();
          e.stopPropagation();
          info.uid = u;
          if (open4) onOpen(u, { sidebar: !!getSettings().openInSidebar });
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
        if (anchor.isConnected === false) {
          unalias(anchor, info);
          continue;
        }
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
    chip(root, region && isImageKind2(region.kind) ? "Image not available" : "Open the drawing to render this region");
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
              await Promise.all([keys.svg, keys.png2x, keys.png2xDark, keys.png].filter(Boolean).map((k) => Promise.resolve(cache.delete?.(k)).catch(() => {
              })));
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
        const override = blockUid ? s.refOverrides[overrideKey(blockUid, refUid)] : void 0;
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
    }
  };
}

// src/view/discover.js
var SKIP_SELECTOR = ".plexus-offscreen, .plexus-root";
var ALIAS_CLASS = "rm-alias--block";
var DOCK_SELECTOR = ".plexus-dock";
var EDITOR_OUTER = ".excalidraw-outer-container.full-screen";
function skipped(node) {
  return !!node.closest?.(SKIP_SELECTOR);
}
function underFullScreen(el) {
  return !!el.closest?.(EDITOR_OUTER) && !el.closest?.(DOCK_SELECTOR);
}
function classifyAddedNode(node) {
  const out = { regionButtons: [], editors: [], aliases: [] };
  if (!node || node.nodeType !== 1 || skipped(node)) return out;
  if (node.classList?.contains(REGION_BUTTON_CLASS)) out.regionButtons.push(node);
  const buttons = node.getElementsByClassName?.(REGION_BUTTON_CLASS);
  if (buttons) for (let i = 0; i < buttons.length; i++) out.regionButtons.push(buttons[i]);
  if (node.classList?.contains(ALIAS_CLASS)) out.aliases.push(node);
  const aliases = node.getElementsByClassName?.(ALIAS_CLASS);
  if (aliases) for (let i = 0; i < aliases.length; i++) out.aliases.push(aliases[i]);
  if (node.classList?.contains("excalidraw")) {
    if (underFullScreen(node)) out.editors.push(node);
  } else {
    const editors = node.getElementsByClassName?.("excalidraw");
    if (editors) {
      for (let i = 0; i < editors.length; i++) {
        if (underFullScreen(editors[i])) out.editors.push(editors[i]);
      }
    }
  }
  return out;
}
function createDiscovery({ root, onRegionButton, onAlias, onEditorMount, onEditorUnmount, MutationObserverImpl = globalThis.MutationObserver }) {
  let trackedEditor = null;
  let disposed = false;
  const safe = (fn, arg) => {
    try {
      fn?.(arg);
    } catch (error) {
      console.warn("[plexus] discovery handler failed", error);
    }
  };
  const mountEditor = (el) => {
    if (trackedEditor === el) return;
    trackedEditor = el;
    safe(onEditorMount, el);
  };
  const handle = ({ regionButtons, editors, aliases = [] }) => {
    for (const btn of regionButtons) safe(onRegionButton, btn);
    for (const a of aliases) safe(onAlias, a);
    for (const el of editors) mountEditor(el);
  };
  const observer = new MutationObserverImpl((records) => {
    if (disposed) return;
    try {
      for (const record of records) {
        for (const node of record.addedNodes) handle(classifyAddedNode(node));
        if (trackedEditor && record.removedNodes.length && !trackedEditor.isConnected) {
          const gone = trackedEditor;
          trackedEditor = null;
          safe(onEditorUnmount, gone);
        }
      }
    } catch (error) {
      console.warn("[plexus] discovery failed", error);
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  return {
    scanExisting() {
      try {
        const regionButtons = Array.from(root.querySelectorAll(`.${REGION_BUTTON_CLASS}`)).filter((el) => !skipped(el));
        const editors = Array.from(root.querySelectorAll(`${EDITOR_OUTER} .excalidraw`)).filter((el) => !skipped(el) && !el.closest?.(DOCK_SELECTOR));
        const aliases = Array.from(root.querySelectorAll(`a.${ALIAS_CLASS}`)).filter((el) => !skipped(el));
        handle({ regionButtons, editors, aliases });
      } catch (error) {
        console.warn("[plexus] scanExisting failed", error);
      }
    },
    dispose() {
      disposed = true;
      observer.disconnect();
      trackedEditor = null;
    }
  };
}

// src/view/spotlight.js
function showSpotlight({ rect, doc, durationMs = 1400, motion = true }) {
  const el = doc.createElement("div");
  el.className = `plexus-portal plexus-spotlight ${motion ? "plexus-spotlight--pulse" : "plexus-spotlight--static"}`;
  el.style.left = `${rect.left}px`;
  el.style.top = `${rect.top}px`;
  el.style.width = `${rect.width}px`;
  el.style.height = `${rect.height}px`;
  doc.body.append(el);
  const events = ["wheel", "pointerdown", "keydown"];
  let done = false;
  let timer = null;
  const remove = () => {
    if (done) return;
    done = true;
    if (timer != null) clearTimeout(timer);
    for (const type of events) doc.removeEventListener(type, remove, { capture: true });
    el.remove();
  };
  for (const type of events) doc.addEventListener(type, remove, { capture: true, passive: true });
  timer = setTimeout(remove, durationMs);
  return remove;
}

// src/model/links.js
var URL_RE = /^https:\/\/roamresearch\.com\/#\/app\/([^/?#]+)\/page\/([A-Za-z0-9_-]+)\/?$/;
function parseRoamLink(link, graphName) {
  if (typeof link !== "string") return null;
  const s = link.trim();
  if (!s) return null;
  let m = /^\[\[([^\]\n]+)\]\]$/.exec(s) || /^#\[\[([^\]\n]+)\]\]$/.exec(s);
  if (m) return { type: "page", title: m[1] };
  m = /^#([^\s[\]#()]+)$/.exec(s);
  if (m) return { type: "page", title: m[1] };
  m = /^\(\(([A-Za-z0-9_-]+)\)\)$/.exec(s);
  if (m) return { type: "block", uid: m[1] };
  m = URL_RE.exec(s);
  if (m) {
    let graph;
    try {
      graph = decodeURIComponent(m[1]);
    } catch {
      return null;
    }
    if (graphName && graph === graphName) return { type: "page", uid: m[2] };
  }
  return null;
}

// src/host/links.js
var MAX_MOVE_PX = 6;
var MAX_HOLD_MS = 400;
function isCanvasEvent(event) {
  const tag = event?.target?.tagName;
  return !tag || String(tag).toUpperCase() === "CANVAS";
}
function linksActive(app) {
  const tool = app?.state?.activeTool?.type;
  return !tool || tool === "selection" || !!app.state.viewModeEnabled;
}
function clearLinkTooltip(doc) {
  for (const el of doc?.querySelectorAll?.(".excalidraw-tooltip--visible") ?? []) {
    el.classList.remove("excalidraw-tooltip--visible");
  }
}
function pageUidOf(api, title) {
  return api.data.pull("[:block/uid]", [":node/title", title])?.[":block/uid"] || null;
}
function sidebarWindow(api, target) {
  return target.type === "page" ? { type: "outline", "block-uid": target.uid ?? pageUidOf(api, target.title) } : { type: "block", "block-uid": target.uid };
}
function navigate(api, containerEl, target, sidebar, window) {
  if (sidebar) {
    api.ui.rightSidebar.addWindow({ window });
    return;
  }
  containerEl.closest?.(".excalidraw-outer-container")?.querySelector?.(".bp3-icon-minimize")?.click?.();
  if (target.type === "page") {
    const uid = target.uid ?? pageUidOf(api, target.title);
    if (uid) api.ui.mainWindow.openPage({ page: { uid } });
    else api.ui.mainWindow.openPage({ page: { title: target.title } });
  } else api.ui.mainWindow.openBlock({ block: { uid: target.uid } });
  clearLinkTooltip(containerEl.ownerDocument);
}
function navigateToTarget({ api, containerEl, target, sidebar = false }) {
  const window = sidebar ? sidebarWindow(api, target) : null;
  if (sidebar && !window["block-uid"]) return false;
  navigate(api, containerEl, target, sidebar, window);
  return true;
}
function installLinkInterception({ app, containerEl, api = globalThis.roamAlphaAPI, getSettings, onNavigate, parse = parseRoamLink, now = () => Date.now() } = {}) {
  if (!app || !containerEl?.addEventListener) return () => {
  };
  let down = null;
  const kindOf = (uid) => {
    const raw = api.data.pull("[:node/title :block/string]", [":block/uid", uid]);
    if (!raw) return null;
    return raw[":node/title"] != null ? "page" : "block";
  };
  function resolve(event) {
    const el = containerEl.getBoundingClientRect?.() || { left: 0, top: 0 };
    const appState = { ...app.state, offsetLeft: el.left, offsetTop: el.top };
    const point = viewportToScene({ x: event.clientX, y: event.clientY, appState });
    const found = app.getElementLinkAtPosition(point, null);
    const link = typeof found === "string" ? found : found?.link;
    if (!link) return null;
    const target = parse(link, api.graph.name);
    if (!target) return null;
    if (target.type === "block" && target.uid) return target;
    if (target.type === "page" && target.title) return target;
    if (target.uid) {
      const type = kindOf(target.uid);
      return type ? { type, uid: target.uid } : null;
    }
    return null;
  }
  const onDown = (e) => {
    down = e.isTrusted && (e.button ?? 0) === 0 ? { x: e.clientX, y: e.clientY, t: now() } : null;
  };
  const onUp = (e) => {
    const start = down;
    down = null;
    if (!start || !e.isTrusted) return;
    if (getSettings?.()?.links === false) return;
    if (!isCanvasEvent(e) || !linksActive(app)) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > MAX_MOVE_PX || now() - start.t > MAX_HOLD_MS) return;
    try {
      const target = resolve(e);
      if (!target) return;
      const sidebar = !!e.shiftKey;
      const window = sidebar ? sidebarWindow(api, target) : null;
      if (sidebar && !window["block-uid"]) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      navigate(api, containerEl, target, sidebar, window);
      onNavigate?.({ target, sidebar });
    } catch (error) {
      console.warn("[plexus] link interception failed", error);
    }
  };
  containerEl.addEventListener("pointerdown", onDown, true);
  containerEl.addEventListener("pointerup", onUp, true);
  return () => {
    containerEl.removeEventListener("pointerdown", onDown, true);
    containerEl.removeEventListener("pointerup", onUp, true);
  };
}

// src/view/hover-preview.js
var OFFSET_PX = 14;
var MAX_CHILDREN = 3;
function createHoverPreview({
  doc,
  api = globalThis.roamAlphaAPI,
  raf = globalThis.requestAnimationFrame?.bind(globalThis),
  caf = globalThis.cancelAnimationFrame?.bind(globalThis),
  delayMs = 250,
  parse = parseRoamLink
} = {}) {
  let portal = null;
  let body = null;
  let shownKey = null;
  let timer = null;
  let memoLink = null;
  let memoTarget = null;
  let detachCurrent = null;
  const hide = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    shownKey = null;
    memoLink = null;
    memoTarget = null;
    if (!portal) return;
    try {
      api.ui.components.unmountNode({ el: body });
    } catch (error) {
      console.warn("[plexus] unmount failed", error);
    }
    portal.remove();
    portal = null;
    body = null;
  };
  function classify(link) {
    if (link === memoLink) return memoTarget;
    memoTarget = classifyUncached(link);
    memoLink = link;
    return memoTarget;
  }
  function classifyUncached(link) {
    const target = parse(link, api.graph.name);
    if (!target) return null;
    if (target.title) return { type: "page", title: target.title };
    if (!target.uid) return null;
    if (target.type === "block") return { type: "block", uid: target.uid };
    const raw = api.data.pull("[:node/title :block/string]", [":block/uid", target.uid]);
    if (!raw) return null;
    return raw[":node/title"] != null ? { type: "page", title: raw[":node/title"] } : { type: "block", uid: target.uid };
  }
  function childStrings(title) {
    const raw = api.data.pull("[{:block/children [:block/string :block/order]}]", [":node/title", title]);
    return (raw?.[":block/children"] || []).slice().sort((a, b) => (a[":block/order"] ?? 0) - (b[":block/order"] ?? 0)).slice(0, MAX_CHILDREN).map((c) => c[":block/string"] ?? "");
  }
  function place(x, y) {
    if (!portal) return;
    const view2 = doc.defaultView;
    const w = view2?.innerWidth || 1280;
    const h = view2?.innerHeight || 800;
    const rect = portal.getBoundingClientRect?.() || { width: 320, height: 160 };
    portal.style.left = `${Math.max(4, Math.min(x + OFFSET_PX, w - (rect.width || 320) - 4))}px`;
    portal.style.top = `${Math.max(4, Math.min(y + OFFSET_PX, h - (rect.height || 160) - 4))}px`;
  }
  function show(target, x, y) {
    const key = target.type === "page" ? `p:${target.title}` : `b:${target.uid}`;
    if (portal && shownKey === key) return place(x, y);
    hide();
    shownKey = key;
    portal = doc.createElement("div");
    portal.className = "plexus-portal plexus-hover";
    body = doc.createElement("div");
    body.className = "plexus-hover-body";
    portal.append(body);
    doc.body.append(portal);
    place(x, y);
    try {
      api.ui.components.renderString({ el: body, string: target.type === "page" ? `[[${target.title}]]` : `((${target.uid}))` });
      if (target.type === "page") {
        for (const text of childStrings(target.title)) {
          const line = doc.createElement("div");
          line.className = "plexus-hover-line";
          line.textContent = text;
          portal.append(line);
        }
      }
    } catch (error) {
      console.warn("[plexus] hover render failed", error);
    }
    place(x, y);
  }
  return {
    hide,
    // Returns the disposer for this editor mount.
    attach({ app, containerEl }) {
      detachCurrent?.();
      if (!app || !containerEl?.addEventListener) return () => {
      };
      let last = null;
      let frame = null;
      const probe = () => {
        frame = null;
        if (!last) return;
        const { x, y } = last;
        try {
          const box = containerEl.getBoundingClientRect?.() || { left: 0, top: 0 };
          const point = viewportToScene({ x, y, appState: { ...app.state, offsetLeft: box.left, offsetTop: box.top } });
          const found = app.getElementLinkAtPosition?.(point, null);
          const link = typeof found === "string" ? found : found?.link;
          const target = link ? classify(link) : null;
          if (!target) return hide();
          const key = target.type === "page" ? `p:${target.title}` : `b:${target.uid}`;
          if (portal && shownKey === key) return place(x, y);
          if (timer != null) clearTimeout(timer);
          timer = setTimeout(() => {
            timer = null;
            show(target, x, y);
          }, delayMs);
        } catch (error) {
          console.warn("[plexus] hover probe failed", error);
        }
      };
      const onMove = (e) => {
        if (e.buttons || !isCanvasEvent(e)) {
          if (last || portal) onHide();
          return;
        }
        last = { x: e.clientX, y: e.clientY };
        if (frame != null) return;
        frame = raf ? raf(probe) : (probe(), null);
      };
      const onHide = () => {
        last = null;
        hide();
      };
      containerEl.addEventListener("pointermove", onMove, { capture: true });
      containerEl.addEventListener("pointerleave", onHide);
      containerEl.addEventListener("pointerdown", onHide, { capture: true });
      containerEl.addEventListener("wheel", onHide, { capture: true, passive: true });
      const dispose = () => {
        if (detachCurrent !== dispose) return;
        detachCurrent = null;
        containerEl.removeEventListener("pointermove", onMove, { capture: true });
        containerEl.removeEventListener("pointerleave", onHide);
        containerEl.removeEventListener("pointerdown", onHide, { capture: true });
        containerEl.removeEventListener("wheel", onHide, { capture: true });
        if (frame != null && caf) caf(frame);
        frame = null;
        last = null;
        hide();
      };
      detachCurrent = dispose;
      return dispose;
    },
    dispose() {
      detachCurrent?.();
      hide();
    }
  };
}

// src/host/guard.js
var ACTION_MS = 1e4;
var MAX_DRAWINGS = 10;
var nonce = () => Math.floor(Math.random() * 2 ** 31);
var liveCount = (els) => (els || []).reduce((n, e) => n + (e && !e.isDeleted ? 1 : 0), 0);
var versionSum = (els) => (els || []).reduce((n, e) => n + (e?.version || 0), 0);
var signature = (els) => `${liveCount(els)}|${versionSum(els)}`;
var plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
var directGuard = Object.freeze({
  guardedWrite(app, { next, captureUpdate, appState } = {}) {
    const elements = typeof next === "function" ? next(app.getSceneElementsIncludingDeleted?.() ?? []) : next;
    app.updateScene({ elements, ...appState ? { appState } : {}, ...captureUpdate !== void 0 ? { captureUpdate } : {} });
    return true;
  },
  restoreLast: () => 0,
  hasSnapshot: () => false,
  dispose() {
  }
});
function createWriteGuard({ toaster, ringSize = 5, maxDrawings = MAX_DRAWINGS, isActive = (app) => !!app && app.unmounted !== true, now = () => Date.now() } = {}) {
  let disposed = false;
  const rings = /* @__PURE__ */ new Map();
  let pending = null;
  const toast = (message, opts) => {
    try {
      toaster?.show?.(message, opts);
    } catch (error) {
      console.warn("[plexus] guard toast failed", error);
    }
  };
  const dropPending = (token) => {
    if (!token || pending === token) pending = null;
  };
  function push(drawingUid, entry) {
    const ring = rings.get(drawingUid) ?? [];
    ring.push(entry);
    while (ring.length > ringSize) ring.shift();
    rings.delete(drawingUid);
    rings.set(drawingUid, ring);
    while (rings.size > maxDrawings) rings.delete(rings.keys().next().value);
  }
  function deltaOf(current2, nextEls) {
    const nextById = new Map(nextEls.map((e) => [e?.id, e]));
    const curIds = /* @__PURE__ */ new Set();
    const before = [];
    let removed = 0;
    for (const el of current2) {
      if (!el) continue;
      curIds.add(el.id);
      if (el.isDeleted) continue;
      const nx = nextById.get(el.id);
      const gone = !nx || nx.isDeleted;
      if (gone) removed += 1;
      if (gone || nx !== el && nx.version !== el.version) before.push(structuredClone(el));
    }
    const added = nextEls.filter((e) => e && !curIds.has(e.id)).map((e) => e.id);
    return { removed, before, added };
  }
  function guardedWrite(app, opts = {}) {
    if (disposed || !app) return false;
    const { drawingUid, next, label = "Change", captureUpdate, appState, force = false } = opts;
    const current2 = app.getSceneElementsIncludingDeleted?.() ?? [];
    const nextEls = typeof next === "function" ? next(current2) : next;
    if (!Array.isArray(nextEls)) return false;
    const before = liveCount(current2);
    const after = liveCount(nextEls);
    if (!force && before > 10 && after * 5 <= before) {
      refuse(app, opts, before - after, before, current2);
      return false;
    }
    const delta = captureUpdate !== "NEVER" ? deltaOf(current2, nextEls) : null;
    app.updateScene({ elements: nextEls, ...appState ? { appState } : {}, ...captureUpdate !== void 0 ? { captureUpdate } : {} });
    if (delta && delta.removed > 0 && drawingUid) push(drawingUid, { drawingUid, time: now(), label, before: delta.before, added: delta.added });
    return true;
  }
  function refuse(app, opts, n, m, current2) {
    const { drawingUid, next, label = "Change", captureUpdate, appState, onApplyAnyway } = opts;
    const key = `${drawingUid}|${label}|${n}|${m}`;
    if (pending && pending.key === key && now() < pending.until) return;
    const token = { key, until: now() + ACTION_MS };
    const sig = signature(current2);
    const run = () => {
      dropPending(token);
      if (disposed) return;
      if (!isActive(app, drawingUid)) {
        toast("Drawing is no longer open");
        return;
      }
      try {
        if (typeof onApplyAnyway === "function") {
          onApplyAnyway();
        } else if (typeof next === "function") {
          guardedWrite(app, { ...opts, force: true });
        } else if (signature(app.getSceneElementsIncludingDeleted?.() ?? []) === sig) {
          guardedWrite(app, { drawingUid, next, label, captureUpdate, appState, force: true });
        } else {
          toast("The drawing changed; run it again");
        }
      } catch (error) {
        console.warn("[plexus] apply anyway failed", error);
        toast("Could not apply the change", { kind: "error" });
      }
    };
    pending = token;
    toast(`Not applied: would remove ${n} of ${m}`, { kind: "error", action: { label: "Apply anyway", run }, onHide: () => dropPending(token) });
  }
  function restoreLast(app, drawingUid) {
    if (disposed) return 0;
    if (!app || !isActive(app, drawingUid)) {
      toast("Drawing is no longer open");
      return 0;
    }
    const ring = rings.get(drawingUid);
    const entry = ring?.[ring.length - 1];
    if (!entry) {
      toast("Nothing to restore");
      return 0;
    }
    const current2 = app.getSceneElementsIncludingDeleted?.() ?? [];
    const byId = new Map(current2.map((e) => [e?.id, e]));
    const before = new Map(entry.before.map((e) => [e.id, e]));
    const added = new Set(entry.added);
    const stamp = Date.now();
    const elements = current2.map((el) => {
      const old = before.get(el?.id);
      if (old) return { ...old, version: (el.version || 0) + 1, versionNonce: nonce(), updated: stamp };
      if (el && added.has(el.id) && !el.isDeleted) return { ...el, isDeleted: true, version: (el.version || 0) + 1, versionNonce: nonce(), updated: stamp };
      return el;
    });
    for (const old of entry.before) {
      if (!byId.has(old.id)) elements.push({ ...old, version: (old.version || 0) + 1, versionNonce: nonce(), updated: stamp });
    }
    try {
      app.updateScene({ elements, captureUpdate: "IMMEDIATELY" });
    } catch (error) {
      console.warn("[plexus] restore failed", error);
      toast("Could not restore the drawing", { kind: "error" });
      return 0;
    }
    const after = new Map((app.getSceneElementsIncludingDeleted?.() ?? []).map((e) => [e?.id, e]));
    if (entry.before.some((old) => after.get(old.id)?.isDeleted !== false)) {
      console.warn("[plexus] restore was not applied by the drawing", entry.before.length);
      toast("Could not restore the drawing", { kind: "error" });
      return 0;
    }
    ring.pop();
    if (!ring.length) rings.delete(drawingUid);
    const n = entry.before.length;
    toast(`Restored ${plural(n, "element")}; Undo reverses this`);
    return n;
  }
  return {
    guardedWrite,
    restoreLast,
    hasSnapshot: (drawingUid) => (rings.get(drawingUid)?.length ?? 0) > 0,
    dispose() {
      disposed = true;
      pending = null;
      rings.clear();
    }
  };
}

// src/api.js
var API_VERSION = 4;
var GONE = "Scene is no longer open";
var FORBIDDEN_PATCH_KEYS = ["id", "type", "version", "versionNonce", "isDeleted", "index"];
var DRAWING_RE2 = /^\s*\{\{(\[\[excalidraw\]\]|excalidraw)\}\}/;
var isPlain = (v) => v != null && typeof v === "object" && !Array.isArray(v);
var nonce2 = () => Math.floor(Math.random() * 2 ** 31);
var bump = (el, extra = {}) => ({ ...el, ...extra, version: (el.version || 0) + 1, versionNonce: nonce2(), updated: Date.now() });
function invisible(el) {
  if (el.isDeleted) return true;
  if (["line", "arrow", "draw", "freedraw"].includes(el.type)) return !Array.isArray(el.points) || el.points.length < 2;
  if (el.type === "text") return !el.text;
  return el.width === 0 && el.height === 0;
}
function createSceneRegistry({ native, doc = globalThis.document, raf = globalThis.requestAnimationFrame, guard: writeGuard = directGuard } = {}) {
  let disposed = false;
  const scenes = /* @__PURE__ */ new WeakMap();
  const subs = /* @__PURE__ */ new Map();
  const disposeHooks = /* @__PURE__ */ new Set();
  const frame = typeof raf === "function" ? (fn) => raf(fn) : (fn) => setTimeout(fn, 16);
  function build(app, uid) {
    let released = false;
    const live = () => !released && !disposed && native.activeEditor(doc)?.app === app && native.activeEditor(doc)?.drawingUid === uid;
    const guard2 = () => {
      if (!live()) throw new Error(GONE);
    };
    const all = () => app.getSceneElementsIncludingDeleted?.() || [];
    const write = (next, label, { force = false } = {}) => writeGuard.guardedWrite(app, { drawingUid: uid, next, label, captureUpdate: "IMMEDIATELY", force });
    const scene = {
      uid,
      elements() {
        guard2();
        return structuredClone(liveElements(all()));
      },
      appState() {
        guard2();
        const s = app.state || {};
        return { scrollX: s.scrollX, scrollY: s.scrollY, zoom: s.zoom?.value ?? s.zoom, selectedElementIds: { ...s.selectedElementIds || {} }, theme: s.theme, width: s.width, height: s.height };
      },
      add(elements, { select = true, at = "keep" } = {}) {
        guard2();
        if (!Array.isArray(elements) || !elements.length) throw new Error("add needs a non-empty array");
        if (elements.some((e) => e?.type === "image")) throw new Error("image elements are not supported");
        const inputs = elements.map((e) => structuredClone(e));
        const kept = [];
        const copies = [];
        inputs.forEach((el, i) => {
          if (invisible(el)) return;
          const cd = isPlain(el.customData) ? el.customData : {};
          copies.push({ ...el, customData: { ...cd, plexus: { ...isPlain(cd.plexus) ? cd.plexus : {}, addKey: i } } });
          kept.push(i);
        });
        const ids = inputs.map(() => null);
        if (!copies.length) return ids;
        const prevSel = { ...app.state?.selectedElementIds || {} };
        const prevGroups = { ...app.state?.selectedGroupIds || {} };
        let position = "center";
        if (at === "keep") {
          const bounds = commonBounds(copies);
          if (bounds) {
            const [x1, y1, x2, y2] = bounds;
            const p = sceneToViewport({ x: (x1 + x2) / 2, y: (y1 + y2) / 2, appState: app.state });
            position = { clientX: p.x, clientY: p.y };
          }
        }
        native.addViaPaste(app, copies, { position });
        const byKey = /* @__PURE__ */ new Map();
        for (const el of all()) {
          const k = el.customData?.plexus?.addKey;
          if (!el.isDeleted && Number.isInteger(k) && kept.includes(k) && !byKey.has(k)) byKey.set(k, el.id);
        }
        const keyOf = new Map([...byKey].map(([k, id]) => [id, k]));
        const next = all().map((el) => {
          const k = keyOf.get(el.id);
          if (k === void 0) return el;
          const orig = elements[k];
          const out = { ...el };
          if (orig.customData === void 0) delete out.customData;
          else out.customData = structuredClone(orig.customData);
          if (orig.frameId == null) out.frameId = null;
          return bump(out);
        });
        let selection = prevSel;
        let groups = prevGroups;
        if (select) {
          selection = {};
          groups = {};
          for (const el of next) if (keyOf.has(el.id) && !el.containerId) selection[el.id] = true;
        }
        writeGuard.guardedWrite(app, { drawingUid: uid, next, label: "Add", appState: { selectedElementIds: selection, selectedGroupIds: groups } });
        for (const [k, id] of byKey) ids[k] = id;
        return ids;
      },
      update(id, patch) {
        guard2();
        if (!isPlain(patch)) throw new Error("patch must be an object");
        for (const key of FORBIDDEN_PATCH_KEYS) if (key in patch) throw new Error(`Cannot patch ${key}`);
        const el = all().find((e) => e.id === id);
        if (!el) throw new Error(`No element ${id}`);
        const extra = { ...patch };
        if (patch.customData !== void 0) {
          const merged = { ...el.customData || {}, ...patch.customData };
          if (isPlain(patch.customData.plexus) && isPlain(el.customData?.plexus)) merged.plexus = { ...el.customData.plexus, ...patch.customData.plexus };
          extra.customData = merged;
        }
        if (typeof patch.text === "string" && patch.originalText === void 0) extra.originalText = patch.text;
        const updated = bump(el, extra);
        if (!write(all().map((e) => e.id === id ? updated : e), "Update")) throw new Error("Not applied: update was refused");
        return structuredClone(updated);
      },
      remove(ids, { force = false } = {}) {
        guard2();
        const set = new Set(Array.isArray(ids) ? ids : [ids]);
        const els = all();
        const hit = new Set(els.filter((e) => set.has(e.id)).map((e) => e.id));
        const doomed = /* @__PURE__ */ new Set([...hit, ...els.filter((e) => e.containerId && hit.has(e.containerId)).map((e) => e.id)]);
        if (!doomed.size) return 0;
        const n = els.filter((e) => doomed.has(e.id) && !e.isDeleted).length;
        const applied = write(els.map((e) => doomed.has(e.id) && !e.isDeleted ? bump(e, { isDeleted: true }) : e), "Remove", { force: force === true });
        if (!applied) throw new Error(`Not applied: would remove ${n} of ${els.filter((e) => !e.isDeleted).length}`);
        return hit.size;
      },
      select(ids) {
        guard2();
        const selection = {};
        for (const id of ids || []) selection[id] = true;
        app.updateScene({ appState: { selectedElementIds: selection, selectedGroupIds: {} } });
      },
      zoomTo(ids) {
        guard2();
        const set = new Set(ids || []);
        const els = liveElements(all()).filter((e) => set.has(e.id));
        if (!els.length) throw new Error("No elements to zoom to");
        native.zoomTo(app, commonBounds(els));
      },
      async exportSvg(ids) {
        guard2();
        const list = ids?.length ? ids : liveElements(all()).map((e) => e.id);
        const svg = await native.captureSelectionSvg(app, list);
        guard2();
        return normalizeSvgSize(svg);
      },
      onChange(cb) {
        guard2();
        if (typeof cb !== "function") throw new Error("callback required");
        const emitter = app.onChangeEmitter;
        let pending = false;
        let off = null;
        let closed = false;
        const close2 = () => {
          if (closed) return;
          closed = true;
          try {
            off?.();
          } catch (error) {
            console.warn("[plexus] unsubscribe failed", error);
          }
          subs.get(app)?.delete(close2);
        };
        off = emitter?.on?.(() => {
          if (pending || closed) return;
          pending = true;
          frame(() => {
            pending = false;
            if (closed || !live()) return;
            try {
              cb({ uid });
            } catch (error) {
              console.error("[plexus] onChange failed", error);
            }
          });
        });
        if (!subs.has(app)) subs.set(app, /* @__PURE__ */ new Set());
        subs.get(app).add(close2);
        return close2;
      }
    };
    const frozen = Object.freeze(scene);
    return { scene: frozen, release() {
      released = true;
    } };
  }
  const registry = {
    sceneFor(app, uid) {
      if (disposed || !app || !uid) return null;
      const cur = scenes.get(app);
      if (cur && cur.uid === uid && !cur.released) return cur.scene;
      cur?.release();
      const made = build(app, uid);
      const entry = { uid, scene: made.scene, release: made.release, released: false };
      const rel = made.release;
      entry.release = () => {
        entry.released = true;
        rel();
      };
      scenes.set(app, entry);
      return entry.scene;
    },
    sceneOf(uid) {
      if (disposed) return null;
      const ed = native.activeEditor(doc);
      return ed?.app && ed.drawingUid === uid ? registry.sceneFor(ed.app, uid) : null;
    },
    activeApp() {
      return native.activeEditor(doc)?.app ?? null;
    },
    activeUid() {
      return native.activeEditor(doc)?.drawingUid ?? null;
    },
    ready(app, timeoutMs) {
      return native.waitNotLoading(app, timeoutMs, { doc });
    },
    release(app) {
      scenes.get(app)?.release();
      scenes.delete(app);
      for (const close2 of [...subs.get(app) || []]) close2();
      subs.delete(app);
    },
    onDispose(cb) {
      disposeHooks.add(cb);
      return () => disposeHooks.delete(cb);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const set of subs.values()) for (const close2 of [...set]) close2();
      subs.clear();
      for (const cb of [...disposeHooks]) {
        try {
          cb();
        } catch (error) {
          console.warn("[plexus] dispose hook failed", error);
        }
      }
      disposeHooks.clear();
    }
  };
  return registry;
}
function subscribe(emitter, type, cb) {
  if (typeof emitter?.on === "function") return emitter.on(type, cb);
  if (typeof emitter?.addEventListener === "function") return emitter.addEventListener(type, cb);
  return void 0;
}
function unsubscribe(emitter, type, cb) {
  if (typeof emitter?.off === "function") return emitter.off(type, cb);
  if (typeof emitter?.removeEventListener === "function") return emitter.removeEventListener(type, cb);
  return void 0;
}
function createPublicApi({ host, actions, emitter, version, scenes, openDrawing } = {}) {
  const listeners = /* @__PURE__ */ new Map();
  const opening = /* @__PURE__ */ new Map();
  const api = {
    apiVersion: API_VERSION,
    version: String(version ?? ""),
    isAvailable() {
      try {
        return !!host?.graphName?.();
      } catch {
        return false;
      }
    },
    async create(args) {
      const result = await host.createDrawing(args || {});
      try {
        emitter?.emit?.({ uid: result?.uid, kind: "drawing" });
      } catch (error) {
        console.warn("[plexus] change emit failed", error);
      }
      return result;
    },
    open(uid, { region, sidebar = false } = {}) {
      let isRegion = region;
      if (isRegion == null) isRegion = !!parseRegion(host.pullBlock?.(uid)?.string);
      return isRegion ? actions.openRegion(uid, { sidebar }) : host.openBlock(uid, { sidebar });
    },
    thumbnail(uid, opts) {
      return actions.thumbnail(uid, opts || {});
    },
    regionsOf(uid) {
      const entries = host.regionsOf(uid);
      let src = { string: "", pageTitle: null };
      try {
        src = host.labelSource?.(uid) ?? src;
      } catch (error) {
        console.warn("[plexus] labelSource failed", error);
      }
      return entries.map(({ uid: regionUid, region }) => {
        let label = "Region";
        try {
          label = regionLabel({
            kind: region.kind,
            caption: region.caption ?? "",
            drawingTitle: drawingTitleOf(src.string, src.pageTitle),
            imageAlt: isImageKind(region.kind) ? imageAltAt(src.string, region.i) : null,
            resolveBlock: (u) => host.pullBlock?.(u)?.string
          });
        } catch (error) {
          console.warn("[plexus] region label failed", error);
        }
        return { uid: regionUid, kind: region.kind, caption: region.caption ?? "", label };
      });
    },
    drawingsOn(pageUid) {
      return host.drawingsOn(pageUid);
    },
    scene(uid) {
      return scenes?.sceneOf?.(uid) ?? null;
    },
    whenOpen(uid, { timeoutMs = 1e4, sidebar = false } = {}) {
      if (opening.has(uid)) return opening.get(uid).promise;
      if (opening.size) return Promise.reject(new Error(`Busy opening ${[...opening.keys()][0]}`));
      let timer = null;
      let offDispose = null;
      const promise = new Promise((resolve, reject) => {
        const fail2 = (message) => reject(new Error(message));
        timer = setTimeout(() => fail2("Timed out"), timeoutMs);
        offDispose = scenes?.onDispose?.(() => fail2("Plexus unloaded"));
        (async () => {
          if (!scenes) throw new Error("Scenes unavailable");
          if (!DRAWING_RE2.test(String(host.pullBlock?.(uid)?.string ?? ""))) throw new Error("Not a drawing");
          let app = scenes.sceneOf(uid) ? scenes.activeApp() : null;
          if (!app) {
            const active = scenes.activeUid?.();
            if (active && active !== uid) throw new Error("Another drawing is open");
            const opened = await openDrawing?.(uid, { sidebar });
            if (!opened?.app) throw new Error("Could not open drawing");
            app = opened.app;
          }
          if (!await scenes.ready(app, timeoutMs)) throw new Error("Timed out");
          const scene = scenes.sceneFor(app, uid);
          if (!scene) throw new Error("Plexus unloaded");
          return scene;
        })().then(resolve, reject);
      });
      const entry = { promise };
      opening.set(uid, entry);
      const done = () => {
        clearTimeout(timer);
        offDispose?.();
        if (opening.get(uid) === entry) opening.delete(uid);
      };
      promise.then(done, done);
      return promise;
    },
    addEventListener(type, cb) {
      if (type !== "change" || typeof cb !== "function" || listeners.has(cb)) return;
      const wrapped = (detail) => {
        try {
          cb(detail);
        } catch (error) {
          console.error("[plexus] listener failed", error);
        }
      };
      listeners.set(cb, wrapped);
      subscribe(emitter, "change", wrapped);
    },
    removeEventListener(type, cb) {
      if (type !== "change") return;
      const wrapped = listeners.get(cb);
      if (!wrapped) return;
      listeners.delete(cb);
      unsubscribe(emitter, "change", wrapped);
    }
  };
  return Object.freeze(api);
}
var fire = (win, type, detail, Ctor) => {
  try {
    const C = Ctor ?? win.CustomEvent ?? globalThis.CustomEvent;
    if (C) win.dispatchEvent(new C(type, { detail }));
  } catch (error) {
    console.warn("[plexus] event dispatch failed", error);
  }
};
function installPublicApi(api, { win = globalThis.window ?? globalThis, CustomEventCtor } = {}) {
  win.RoamPlexus = api;
  fire(win, "roam-plexus:ready", { apiVersion: API_VERSION }, CustomEventCtor);
}
function uninstallPublicApi(api, { win = globalThis.window ?? globalThis, CustomEventCtor } = {}) {
  const ours = win.RoamPlexus === api;
  if (ours) delete win.RoamPlexus;
  fire(win, "roam-plexus:unload", { apiVersion: API_VERSION }, CustomEventCtor);
  return ours;
}

// src/model/mindmap.js
var MAX_TEXT_WIDTH = 240;
var PAD_X = 14;
var PAD_Y = 10;
var LINE_HEIGHT = 1.25;
var SIBLING_GAP = 18;
var LEVEL_GAP = 70;
var RADIAL_RADIUS = 220;
var RADIAL_STEP = 180;
var MAX_DISPLAY = 280;
var REF_MAX = 60;
var ROOT_COLOR = "#ffec99";
var BRANCH_COLORS = Object.freeze(["#a5d8ff", "#b2f2bb", "#ffc9c9", "#d0bfff", "#ffd8a8"]);
var LAYOUTS = Object.freeze(["right", "down", "left", "up", "radial"]);
var EXCLUDED_RE = /^\s*(?:\{\{\[\[excalidraw\]\]\}\}|\{\{excalidraw\}\}|\{\{\[\[plexus-)/;
var isExcludedString = (s) => typeof s === "string" && EXCLUDED_RE.test(s);
var fontSizeForDepth = (depth) => depth === 0 ? 24 : depth === 1 ? 20 : 16;
function pick2(obj, name) {
  if (!obj || typeof obj !== "object") return void 0;
  const v = obj[`:block/${name}`];
  return v !== void 0 ? v : obj[name];
}
function treeFromPull(pull, opts = {}) {
  const prune = opts.prune instanceof Set ? opts.prune : null;
  const cap = Number.isFinite(opts.maxVisible) ? opts.maxVisible : Infinity;
  let visible = 0;
  let truncated = false;
  function conv(p, isRoot) {
    const uid = pick2(p, "uid");
    if (typeof uid !== "string") return null;
    const string = pick2(p, "string");
    const str = typeof string === "string" ? string : "";
    if (isExcludedString(str)) return null;
    if (!isRoot && prune && prune.has(uid)) return null;
    if (visible >= cap) {
      truncated = true;
      return null;
    }
    visible += 1;
    const open4 = pick2(p, "open") !== false;
    const raw = pick2(p, "children");
    const kids2 = Array.isArray(raw) ? raw.slice() : [];
    kids2.sort((a, b) => (pick2(a, "order") ?? 0) - (pick2(b, "order") ?? 0));
    const node = { uid, string: str, open: open4, children: [] };
    for (const k of kids2) {
      const c = conv(k, false);
      if (c) node.children.push(c);
    }
    return node;
  }
  if (!pull || typeof pull !== "object") return null;
  const tree = conv(pull, true);
  if (tree && truncated) tree.truncated = true;
  return tree;
}
var isFolded = (node) => node.open === false && node.children.length > 0;
function countHidden(node) {
  let n = 0;
  const stack = [...node.children];
  while (stack.length) {
    const c = stack.pop();
    n += 1;
    for (const k of c.children) stack.push(k);
  }
  return n;
}
var visibleChildren = (node) => node.open === false ? [] : node.children;
function visibleNodes(tree) {
  const out = [];
  function walk2(node, parent, depth, branch, branchIndex) {
    out.push({ node, parent, depth, branch, branchIndex });
    const kids2 = visibleChildren(node);
    for (let i = 0; i < kids2.length; i++) {
      const k = kids2[i];
      if (depth === 0) walk2(k, node, 1, k.uid, i);
      else walk2(k, node, depth + 1, branch, branchIndex);
    }
  }
  if (tree) walk2(tree, null, 0, null, -1);
  return out;
}
var allUids = (tree) => {
  const set = /* @__PURE__ */ new Set();
  const stack = tree ? [tree] : [];
  while (stack.length) {
    const n = stack.pop();
    set.add(n.uid);
    for (const c of n.children) stack.push(c);
  }
  return set;
};
var RE_IMG = /!\[([^\]]*)\]\([^)]*\)/g;
var RE_LINK = /\[([^\]]*)\]\([^)]*\)/g;
var RE_REF = /\(\(([^()\s]+)\)\)/g;
var RE_TAG_BR = /#\[\[([^\]]+)\]\]/g;
var RE_PAGE = /\[\[([^\]]+)\]\]/g;
var RE_TAG = /(^|[\s(])#([\p{L}\p{N}_/-]+(?:[.:][\p{L}\p{N}_/-]+)*)/gu;
var RE_BOLD = /\*\*(.+?)\*\*/g;
var RE_ITAL = /__(.+?)__/g;
var RE_HL = /\^\^(.+?)\^\^/g;
var RE_STRIKE = /~~(.+?)~~/g;
function hasComponent(s) {
  return s.indexOf("{{") !== -1 && s.indexOf("}}", s.indexOf("{{")) !== -1;
}
function replaceComponents(s) {
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] === "{" && s[i + 1] === "{") {
      let depth = 0;
      let j = i;
      let end = -1;
      while (j < s.length) {
        if (s[j] === "{" && s[j + 1] === "{") {
          depth += 1;
          j += 2;
          continue;
        }
        if (s[j] === "}" && s[j + 1] === "}") {
          depth -= 1;
          j += 2;
          if (depth === 0) {
            end = j;
            break;
          }
          continue;
        }
        j += 1;
      }
      if (end === -1) {
        out += s.slice(i);
        break;
      }
      out += "⧉";
      i = end;
    } else {
      out += s[i];
      i += 1;
    }
  }
  return out;
}
function fresh(re) {
  re.lastIndex = 0;
  return re;
}
function hasMarkup(s) {
  if (typeof s !== "string" || s === "" || s.length > MAX_DISPLAY) return true;
  if (hasComponent(s) && replaceComponents(s) !== s) return true;
  for (const re of [RE_IMG, RE_LINK, RE_REF, RE_TAG_BR, RE_PAGE, RE_TAG, RE_BOLD, RE_ITAL, RE_HL, RE_STRIKE]) {
    if (fresh(re).test(s)) return true;
  }
  return false;
}
function rewrite(s, resolveRef, depthLimit) {
  let t = s;
  if (hasComponent(t)) t = replaceComponents(t);
  t = t.replace(RE_IMG, (_, alt) => `▣ ${alt}`);
  t = t.replace(RE_LINK, (_, txt) => txt);
  t = t.replace(RE_REF, (_, uid) => {
    if (depthLimit <= 0) return "…";
    let ref;
    try {
      ref = resolveRef ? resolveRef(uid) : null;
    } catch {
      ref = null;
    }
    if (typeof ref !== "string") return "…";
    let r = rewrite(ref, () => "…", 0);
    if (r.length > REF_MAX) r = `${r.slice(0, REF_MAX - 1)}…`;
    return r;
  });
  t = t.replace(RE_TAG_BR, (_, x) => x);
  t = t.replace(RE_PAGE, (_, x) => x);
  t = t.replace(RE_TAG, (_, pre, x) => pre + x);
  t = t.replace(RE_BOLD, (_, x) => x);
  t = t.replace(RE_ITAL, (_, x) => x);
  t = t.replace(RE_HL, (_, x) => x);
  t = t.replace(RE_STRIKE, (_, x) => x);
  return t;
}
function plainText(s, resolveRef) {
  if (typeof s !== "string" || s === "") return "·";
  let t = rewrite(s, resolveRef, 1);
  if (t.length > MAX_DISPLAY) t = `${t.slice(0, MAX_DISPLAY - 1)}…`;
  if (t === "") return "·";
  return t;
}
function wrapLines2(text, maxWidth, measure2) {
  const out = [];
  for (const para of String(text).split("\n")) {
    if (para === "") {
      out.push("");
      continue;
    }
    let line = "";
    const flush = () => {
      out.push(line);
      line = "";
    };
    for (const word of para.split(" ")) {
      const cand = line === "" ? word : `${line} ${word}`;
      if (measure2(cand) <= maxWidth) {
        line = cand;
        continue;
      }
      if (line !== "") flush();
      if (measure2(word) <= maxWidth) {
        line = word;
        continue;
      }
      let chunk = "";
      for (const ch of Array.from(word)) {
        if (chunk !== "" && measure2(chunk + ch) > maxWidth) {
          out.push(chunk);
          chunk = ch;
        } else chunk += ch;
      }
      line = chunk;
    }
    out.push(line);
  }
  return out;
}
function nodeSize(text, fontSize, measure2) {
  const m = (s) => measure2(s, fontSize);
  const lines = wrapLines2(text, MAX_TEXT_WIDTH, m);
  let tw = 0;
  for (const l of lines) tw = Math.max(tw, m(l));
  const textWidth = Math.max(1, Math.ceil(tw));
  const textHeight = lines.length * fontSize * LINE_HEIGHT;
  return {
    width: textWidth + 2 * PAD_X,
    height: textHeight + 2 * PAD_Y,
    textWidth,
    textHeight,
    lines,
    text: lines.join("\n")
  };
}
function layoutTree({ tree, sizes, layout = "right", pinned = {}, root = { x: 0, y: 0 } }) {
  const pos = {};
  if (!tree) return pos;
  const sz = (n) => sizes[n.uid] || { width: 0, height: 0 };
  const isPinned = (n) => n.uid !== tree.uid && pinned[n.uid] && Number.isFinite(pinned[n.uid].x) && Number.isFinite(pinned[n.uid].y);
  if (layout === "radial") return radial(tree, sz, isPinned, pinned, root, pos);
  const horizontal = layout === "right" || layout === "left";
  const cross = (n) => horizontal ? sz(n).height : sz(n).width;
  const ext = /* @__PURE__ */ new Map();
  const free = (n) => visibleChildren(n).filter((k) => !isPinned(k));
  function extent(n) {
    let span = 0;
    const kids2 = free(n);
    for (let i = 0; i < kids2.length; i++) span += extent(kids2[i]) + (i ? SIBLING_GAP : 0);
    for (const k of visibleChildren(n)) if (isPinned(k)) extent(k);
    const e = Math.max(cross(n), span);
    ext.set(n, { e, span });
    return e;
  }
  function place(n, x, y) {
    pos[n.uid] = { x, y };
    const s = sz(n);
    const { span } = ext.get(n);
    const kids2 = free(n);
    let cursor = (horizontal ? y + s.height / 2 : x + s.width / 2) - span / 2;
    for (const k of kids2) {
      const ks = sz(k);
      const e = ext.get(k).e;
      const c = cursor + (e - cross(k)) / 2;
      let kx;
      let ky;
      if (layout === "right") {
        kx = x + s.width + LEVEL_GAP;
        ky = c;
      } else if (layout === "left") {
        kx = x - LEVEL_GAP - ks.width;
        ky = c;
      } else if (layout === "down") {
        kx = c;
        ky = y + s.height + LEVEL_GAP;
      } else {
        kx = c;
        ky = y - LEVEL_GAP - ks.height;
      }
      place(k, kx, ky);
      cursor += e + SIBLING_GAP;
    }
    for (const k of visibleChildren(n)) if (isPinned(k)) place(k, pinned[k.uid].x, pinned[k.uid].y);
  }
  extent(tree);
  place(tree, root.x, root.y);
  return pos;
}
function radial(tree, sz, isPinned, pinned, rootPos, pos) {
  const rs = sz(tree);
  const cx = rootPos.x + rs.width / 2;
  const cy = rootPos.y + rs.height / 2;
  pos[tree.uid] = { x: rootPos.x, y: rootPos.y };
  function fan(n, ncx, ncy, angle, width, first) {
    const kids2 = visibleChildren(n);
    const m = kids2.length;
    for (let i = 0; i < m; i++) {
      const k = kids2[i];
      const ks = sz(k);
      const a = first ? -Math.PI / 2 + 2 * Math.PI * i / m : angle - width / 2 + width * (i + 0.5) / m;
      const w = first ? 2 * Math.PI / m : width / m;
      let kcx;
      let kcy;
      let dirA = a;
      if (isPinned(k)) {
        kcx = pinned[k.uid].x + ks.width / 2;
        kcy = pinned[k.uid].y + ks.height / 2;
        dirA = Math.atan2(kcy - cy, kcx - cx);
        pos[k.uid] = { x: pinned[k.uid].x, y: pinned[k.uid].y };
        fan(k, kcx, kcy, dirA, w, false);
        continue;
      }
      const r = first ? RADIAL_RADIUS : RADIAL_STEP;
      kcx = ncx + r * Math.cos(a);
      kcy = ncy + r * Math.sin(a);
      pos[k.uid] = { x: kcx - ks.width / 2, y: kcy - ks.height / 2 };
      fan(k, kcx, kcy, a, w, false);
    }
  }
  fan(tree, cx, cy, 0, 2 * Math.PI, true);
  return pos;
}
function nearestInDirection(from, candidates, dir) {
  const fx = from.x + from.width / 2;
  const fy = from.y + from.height / 2;
  let best = null;
  let bestD = Infinity;
  for (const c of candidates) {
    if (c.id === from.id) continue;
    const dx = c.x + c.width / 2 - fx;
    const dy = c.y + c.height / 2 - fy;
    const inCone = dir === "right" ? dx > 0 && Math.abs(dy) <= dx : dir === "left" ? dx < 0 && Math.abs(dy) <= -dx : dir === "down" ? dy > 0 && Math.abs(dx) <= dy : dir === "up" ? dy < 0 && Math.abs(dx) <= -dy : false;
    if (!inCone) continue;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = c.id;
    }
  }
  return best;
}

// src/model/mmsync.js
var FONT_FAMILY = 5;
var BOUNDARY_PAD = 12;
var EDGE_GAP = 4;
var TOL = 0.5;
var idPrefix = (root) => `pmm-${root}-`;
var nodeId = (root, uid) => `pmm-${root}-${uid}`;
var textId = (root, uid) => `pmm-${root}-${uid}-t`;
var edgeId = (root, childUid) => `pmm-${root}-${childUid}-e`;
var boundaryId = (root, uid) => `pmm-${root}-${uid}-b`;
var rnd2 = () => Math.floor(Math.random() * 2147483646) + 1;
var mmOf = (el) => el && el.customData && el.customData.plexus && el.customData.plexus.mm || void 0;
function withMM(customData, mm) {
  const cd = customData && typeof customData === "object" ? customData : {};
  const plexus = cd.plexus && typeof cd.plexus === "object" ? cd.plexus : {};
  return { ...cd, plexus: { ...plexus, mm } };
}
function withoutMM(customData) {
  const cd = { ...customData };
  const plexus = { ...cd.plexus || {} };
  delete plexus.mm;
  if (Object.keys(plexus).length) cd.plexus = plexus;
  else delete cd.plexus;
  return Object.keys(cd).length ? cd : null;
}
function bump2(el, patch) {
  return { ...el, ...patch, version: (el.version || 0) + 1, versionNonce: rnd2(), updated: Date.now() };
}
function patchMarker(el, mmPatch) {
  const next = { ...mmOf(el) || {}, ...mmPatch };
  for (const k of Object.keys(next)) if (next[k] === void 0) delete next[k];
  return bump2(el, { customData: withMM(el.customData, next) });
}
function base2(id, type, x, y, width, height, extra) {
  return {
    id,
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: null,
    roundness: null,
    seed: rnd2(),
    version: 1,
    versionNonce: rnd2(),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    customData: void 0,
    ...extra
  };
}
function buildNode({ map, uid, x, y, width, height, backgroundColor, mm, boundElements }) {
  return base2(nodeId(map, uid), "rectangle", x, y, width, height, {
    backgroundColor,
    roundness: { type: 3 },
    boundElements: boundElements || [],
    customData: withMM(null, mm)
  });
}
function buildText({ map, uid, x, y, width, height, text, originalText, fontSize }) {
  return base2(textId(map, uid), "text", x, y, width, height, {
    text,
    originalText,
    fontSize,
    fontFamily: 5,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: nodeId(map, uid),
    autoResize: true,
    lineHeight: LINE_HEIGHT
  });
}
function buildEdge({ map, parentUid, childUid, x, y, points }) {
  const [, [dx, dy]] = points;
  return base2(edgeId(map, childUid), "arrow", x, y, Math.abs(dx), Math.abs(dy), {
    points,
    lastCommittedPoint: null,
    startBinding: { elementId: nodeId(map, parentUid), focus: 0, gap: EDGE_GAP },
    endBinding: { elementId: nodeId(map, childUid), focus: 0, gap: EDGE_GAP },
    startArrowhead: null,
    endArrowhead: null,
    elbowed: false,
    customData: withMM(null, { edge: [parentUid, childUid], map })
  });
}
function buildBoundary({ map, uid, x, y, width, height }) {
  return base2(boundaryId(map, uid), "rectangle", x, y, width, height, {
    strokeStyle: "dashed",
    strokeWidth: 1,
    roundness: { type: 3 },
    customData: withMM(null, { boundary: uid, map })
  });
}
function edgeGeometry(p, c, layout) {
  let sx;
  let sy;
  let ex;
  let ey;
  if (layout === "right") {
    sx = p.x + p.width;
    sy = p.y + p.height / 2;
    ex = c.x;
    ey = c.y + c.height / 2;
  } else if (layout === "left") {
    sx = p.x;
    sy = p.y + p.height / 2;
    ex = c.x + c.width;
    ey = c.y + c.height / 2;
  } else if (layout === "down") {
    sx = p.x + p.width / 2;
    sy = p.y + p.height;
    ex = c.x + c.width / 2;
    ey = c.y;
  } else if (layout === "up") {
    sx = p.x + p.width / 2;
    sy = p.y;
    ex = c.x + c.width / 2;
    ey = c.y + c.height;
  } else {
    sx = p.x + p.width / 2;
    sy = p.y + p.height / 2;
    ex = c.x + c.width / 2;
    ey = c.y + c.height / 2;
  }
  return { x: sx, y: sy, points: [[0, 0], [ex - sx, ey - sy]] };
}
function textRect(node, textWidth, textHeight) {
  return { x: node.x + (node.width - textWidth) / 2, y: node.y + (node.height - textHeight) / 2 };
}
var makeSizer = (measure2) => (text, fontSize) => nodeSize(text, fontSize, measure2);
var close = (a, b) => Math.abs((a ?? 0) - (b ?? 0)) <= TOL;
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
var same = (a, b) => stable(a) === stable(b);
function mergeBound(existing, prefix, desired) {
  const want = new Set(desired.map((d) => d.id));
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const b of Array.isArray(existing) ? existing : []) {
    if (!b || typeof b.id !== "string") continue;
    if (b.id.startsWith(prefix)) {
      if (!want.has(b.id) || seen.has(b.id)) continue;
      seen.add(b.id);
    }
    out.push(b);
  }
  for (const d of desired) if (!seen.has(d.id)) out.push(d);
  return out;
}
var colorFor = (v) => v.depth === 0 ? ROOT_COLOR : BRANCH_COLORS[v.branchIndex % BRANCH_COLORS.length];
function planMap({ elements, tree, sizes, layout = "right", textOf, rootPos }) {
  const root = tree.uid;
  const pre = idPrefix(root);
  const byId = /* @__PURE__ */ new Map();
  const textByContainer = /* @__PURE__ */ new Map();
  for (const el of elements || []) {
    if (!el || typeof el.id !== "string") continue;
    byId.set(el.id, el);
  }
  for (const el of byId.values()) {
    if (el.type !== "text" || typeof el.containerId !== "string" || !el.containerId.startsWith(pre)) continue;
    const cur = textByContainer.get(el.containerId);
    if (!cur || cur.isDeleted && !el.isDeleted || el.id === `${el.containerId}-t`) textByContainer.set(el.containerId, el);
  }
  const rootEl = byId.get(nodeId(root, root));
  const rootMM = mmOf(rootEl) || {};
  const dir = rootMM.layout || layout;
  const nodes = visibleNodes(tree);
  const uids = allUids(tree);
  const storedBounds = Array.isArray(rootMM.bounds) ? rootMM.bounds : [];
  const bounds = tree.truncated ? storedBounds : storedBounds.filter((u) => uids.has(u));
  const info = /* @__PURE__ */ new Map();
  const sizeMap = {};
  const pinned = {};
  for (const v of nodes) {
    const n = v.node;
    const fs = fontSizeForDepth(v.depth);
    const base3 = textOf ? textOf(n.uid, n) : plainText(n.string, () => "…");
    const text = isFolded(n) ? `${base3} (+${countHidden(n)})` : base3;
    const s = typeof sizes === "function" ? { ...sizes(text, fs, n.uid) } : { ...sizes && sizes[n.uid] };
    if (!Array.isArray(s.lines)) s.lines = String(s.text ?? text).split("\n");
    if (s.text === void 0) s.text = s.lines.join("\n");
    if (s.textWidth === void 0) s.textWidth = s.width - 2 * PAD_X;
    if (s.textHeight === void 0) s.textHeight = s.lines.length * fs * LINE_HEIGHT;
    if (s.height === void 0) s.height = s.textHeight + 2 * PAD_Y;
    sizeMap[n.uid] = s;
    const el = byId.get(nodeId(root, n.uid));
    const mm = mmOf(el);
    if (v.depth > 0 && el && mm && mm.pinned === true) pinned[n.uid] = { x: el.x, y: el.y };
    info.set(n.uid, { fs, text, size: s, el, mm });
  }
  const anchor = rootEl && Number.isFinite(rootEl.x) ? { x: rootEl.x, y: rootEl.y } : rootPos || { x: 0, y: 0 };
  const positions = layoutTree({ tree, sizes: sizeMap, layout: dir, pinned, root: anchor });
  return { root, dir, bounds, nodes, info, positions, byId, textByContainer };
}
function reconcile({ elements, tree, sizes, layout = "right", textOf, rootPos }) {
  const ops = { add: [], update: [], remove: [] };
  if (!tree) return ops;
  const { root, dir, bounds, nodes, info, positions, byId, textByContainer } = planMap({ elements, tree, sizes, layout, textOf, rootPos });
  const pre = idPrefix(root);
  const desiredIds = /* @__PURE__ */ new Set();
  const patches = /* @__PURE__ */ new Map();
  const patchOf = (id) => {
    if (!patches.has(id)) patches.set(id, {});
    return patches.get(id);
  };
  for (const el of elements || []) {
    const mm = mmOf(el);
    if (!el || !mm || mm.map !== root) continue;
    let canon = null;
    if (mm.boundary) canon = boundaryId(root, mm.boundary);
    else if (Array.isArray(mm.edge)) canon = edgeId(root, mm.edge[1]);
    else if (mm.uid) canon = nodeId(root, mm.uid);
    if (canon !== null && el.id !== canon) patchOf(el.id).customData = withoutMM(el.customData);
  }
  const kidEdges = /* @__PURE__ */ new Map();
  const finalRect = /* @__PURE__ */ new Map();
  for (const v of nodes) {
    if (v.parent) {
      if (!kidEdges.has(v.parent.uid)) kidEdges.set(v.parent.uid, []);
      kidEdges.get(v.parent.uid).push(v.node.uid);
    }
    const p = positions[v.node.uid];
    const s = info.get(v.node.uid).size;
    finalRect.set(v.node.uid, { x: p.x, y: p.y, width: s.width, height: s.height });
  }
  const addEdges = [];
  const addBodies = [];
  for (const v of nodes) {
    const uid = v.node.uid;
    const i = info.get(uid);
    const rect = finalRect.get(uid);
    const nid = nodeId(root, uid);
    const isRoot = v.depth === 0;
    const branch = isRoot ? void 0 : v.branch;
    const txtEl = textByContainer.get(nid);
    const tid = txtEl ? txtEl.id : textId(root, uid);
    desiredIds.add(nid);
    desiredIds.add(tid);
    const ownBound = [{ id: tid, type: "text" }];
    if (!isRoot) ownBound.push({ id: edgeId(root, uid), type: "arrow" });
    for (const c of kidEdges.get(uid) || []) ownBound.push({ id: edgeId(root, c), type: "arrow" });
    const tr = textRect(rect, i.size.textWidth, i.size.textHeight);
    const want = {
      x: tr.x,
      y: tr.y,
      width: i.size.textWidth,
      height: i.size.textHeight,
      text: i.size.text,
      originalText: i.text,
      fontSize: i.fs
    };
    const curMM = i.mm || {};
    const wantMM = isRoot ? { ...curMM, uid, map: root, root: true, layout: curMM.layout || dir, bounds } : { ...curMM, uid, map: root, ...branch !== void 0 ? { branch } : {} };
    if (!i.el) {
      addBodies.push(
        buildNode({ map: root, uid, x: rect.x, y: rect.y, width: rect.width, height: rect.height, backgroundColor: colorFor(v), mm: wantMM, boundElements: ownBound }),
        buildText({ map: root, uid, ...want })
      );
    } else {
      const el = i.el;
      const p = patchOf(nid);
      if (el.isDeleted) p.isDeleted = false;
      for (const k of ["x", "y", "width", "height"]) if (!close(el[k], rect[k])) p[k] = rect[k];
      if (Math.abs(el.angle || 0) > 1e-6) p.angle = 0;
      if (!isRoot && curMM.branch !== void 0 && curMM.branch !== branch) p.backgroundColor = colorFor(v);
      if (!same(curMM, wantMM)) p.customData = withMM(el.customData, wantMM);
      const mb = mergeBound(el.boundElements, pre, ownBound);
      if (!same(mb, el.boundElements || [])) p.boundElements = mb;
      if (!txtEl) {
        addBodies.push(buildText({ map: root, uid, ...want }));
      } else {
        const tp = patchOf(txtEl.id);
        if (txtEl.isDeleted) tp.isDeleted = false;
        for (const k of ["x", "y", "width", "height"]) if (!close(txtEl[k], want[k])) tp[k] = want[k];
        if (Math.abs(txtEl.angle || 0) > 1e-6) tp.angle = 0;
        if (txtEl.text !== want.text) tp.text = want.text;
        if (txtEl.originalText !== want.originalText) tp.originalText = want.originalText;
        if (txtEl.fontSize !== want.fontSize) tp.fontSize = want.fontSize;
        if (txtEl.fontFamily !== FONT_FAMILY) tp.fontFamily = FONT_FAMILY;
        if (Math.abs((txtEl.lineHeight ?? 0) - LINE_HEIGHT) > 1e-3) tp.lineHeight = LINE_HEIGHT;
        if (txtEl.containerId !== nid) tp.containerId = nid;
      }
    }
    if (!isRoot) {
      const eid = edgeId(root, uid);
      desiredIds.add(eid);
      const pid = nodeId(root, v.parent.uid);
      const g = edgeGeometry(finalRect.get(v.parent.uid), rect, dir);
      const e = byId.get(eid);
      if (!e) {
        addEdges.push(buildEdge({ map: root, parentUid: v.parent.uid, childUid: uid, ...g }));
      } else {
        const ep = patchOf(eid);
        const [, [dx, dy]] = g.points;
        if (e.isDeleted) ep.isDeleted = false;
        if (!close(e.x, g.x)) ep.x = g.x;
        if (!close(e.y, g.y)) ep.y = g.y;
        if (!close(e.width, Math.abs(dx))) ep.width = Math.abs(dx);
        if (!close(e.height, Math.abs(dy))) ep.height = Math.abs(dy);
        const pts = Array.isArray(e.points) ? e.points : [];
        const ok = pts.length === 2 && close(pts[0][0], 0) && close(pts[0][1], 0) && close(pts[1][0], dx) && close(pts[1][1], dy);
        if (!ok) ep.points = g.points;
        if (!e.startBinding || e.startBinding.elementId !== pid) ep.startBinding = { elementId: pid, focus: 0, gap: EDGE_GAP };
        if (!e.endBinding || e.endBinding.elementId !== nid) ep.endBinding = { elementId: nid, focus: 0, gap: EDGE_GAP };
      }
    }
  }
  const bb = /* @__PURE__ */ new Map();
  for (let k = nodes.length - 1; k >= 0; k--) {
    const v = nodes[k];
    const r = finalRect.get(v.node.uid);
    const own = bb.get(v.node.uid);
    const b = {
      x1: Math.min(r.x, own ? own.x1 : Infinity),
      y1: Math.min(r.y, own ? own.y1 : Infinity),
      x2: Math.max(r.x + r.width, own ? own.x2 : -Infinity),
      y2: Math.max(r.y + r.height, own ? own.y2 : -Infinity)
    };
    bb.set(v.node.uid, b);
    if (v.parent) {
      const pb = bb.get(v.parent.uid) || { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
      bb.set(v.parent.uid, { x1: Math.min(pb.x1, b.x1), y1: Math.min(pb.y1, b.y1), x2: Math.max(pb.x2, b.x2), y2: Math.max(pb.y2, b.y2) });
    }
  }
  const addBoundaries = [];
  for (const uid of bounds) {
    const b = bb.get(uid);
    if (!b) continue;
    const want = { x: b.x1 - BOUNDARY_PAD, y: b.y1 - BOUNDARY_PAD, width: b.x2 - b.x1 + 2 * BOUNDARY_PAD, height: b.y2 - b.y1 + 2 * BOUNDARY_PAD };
    const id = boundaryId(root, uid);
    desiredIds.add(id);
    const e = byId.get(id);
    if (!e) {
      addBoundaries.push(buildBoundary({ map: root, uid, ...want }));
      continue;
    }
    const p = patchOf(id);
    if (e.isDeleted) p.isDeleted = false;
    for (const k of ["x", "y", "width", "height"]) if (!close(e[k], want[k])) p[k] = want[k];
    if (Math.abs(e.angle || 0) > 1e-6) p.angle = 0;
    const m = mmOf(e);
    if (!m || m.boundary !== uid || m.map !== root) p.customData = withMM(e.customData, { boundary: uid, map: root });
  }
  ops.add = [...addEdges, ...addBodies, ...addBoundaries];
  const removed = /* @__PURE__ */ new Set();
  for (const el of elements || []) {
    if (!el || el.isDeleted || typeof el.id !== "string" || !el.id.startsWith(pre) || desiredIds.has(el.id)) continue;
    removed.add(el.id);
  }
  for (const el of elements || []) {
    if (el && !el.isDeleted && el.type === "text" && removed.has(el.containerId)) removed.add(el.id);
  }
  ops.remove = [...removed];
  for (const [id, patch] of patches) {
    if (removed.has(id) || Object.keys(patch).length === 0) continue;
    ops.update.push({ id, patch });
  }
  return ops;
}
function applyOps(elements, ops) {
  const upd = new Map(ops.update.map((u) => [u.id, u.patch]));
  const rem = new Set(ops.remove);
  const out = elements.map((el) => {
    if (rem.has(el.id)) return bump2(el, { isDeleted: true });
    const p = upd.get(el.id);
    return p ? bump2(el, p) : el;
  });
  const have = new Set(out.map((e) => e.id));
  for (const a of ops.add) if (!have.has(a.id)) out.push(a);
  return out;
}
var isEmptyOps = (ops) => !ops.add.length && !ops.update.length && !ops.remove.length;
function projectionIds(elements, root) {
  const pre = idPrefix(root);
  return (elements || []).filter((el) => el && !el.isDeleted && typeof el.id === "string" && el.id.startsWith(pre)).map((el) => el.id);
}

// src/view/mindmap.js
var NODE_CAP = 500;
var DELETE_WINDOW_MS = 3e3;
var LOAD_WAIT_MS = 5e3;
var MAX_WAIT_MS = 4e3;
var FORCE_MARK_MS = 5e3;
var PLACEHOLDER_CHILD = "New idea";
var PLACEHOLDER_ROOT = "Central idea";
var GROW_HINT = "Use Tab / Enter to grow this map";
var FOLLOW_HINT = "Mind-map nodes follow the outline; Alt+Backspace deletes a branch";
var MARKUP_HINT = "Edit this node in the outline (it has links or formatting)";
var WRITE_FAILED = "Could not update the outline";
var CHANGED_ELSEWHERE = "Block changed elsewhere; not overwritten";
var GESTURE_FIELDS = ["editingTextElement", "newElement", "resizingElement", "multiElement", "editingLinearElement"];
var INPUT_ISOLATED = ["keyup", "keypress", "beforeinput", "input", "paste", "copy", "cut"];
var ARROWS = { ArrowRight: "right", ArrowLeft: "left", ArrowDown: "down", ArrowUp: "up" };
var LETTERS = /* @__PURE__ */ new Set(["KeyF", "KeyL", "KeyP", "KeyB", "KeyX", "KeyC", "KeyV"]);
var defaultRaf = (fn) => typeof globalThis.requestAnimationFrame === "function" ? globalThis.requestAnimationFrame(fn) : setTimeout(fn, 16);
var defaultGuardedWrite = (app, { next, captureUpdate } = {}) => {
  const current2 = app.getSceneElementsIncludingDeleted?.() ?? [];
  app.updateScene({ elements: typeof next === "function" ? next(current2) : next, ...captureUpdate ? { captureUpdate } : {} });
  return true;
};
var defaultCaf = (id) => typeof globalThis.cancelAnimationFrame === "function" ? globalThis.cancelAnimationFrame(id) : clearTimeout(id);
function findNode(tree, uid) {
  if (!tree) return null;
  const stack = [{ node: tree, parent: null }];
  while (stack.length) {
    const { node, parent } = stack.pop();
    if (node.uid === uid) return { node, parent };
    for (const c of node.children) stack.push({ node: c, parent: node });
  }
  return null;
}
function rawWalk(raw, fn) {
  const stack = raw ? [raw] : [];
  while (stack.length) {
    const n = stack.pop();
    fn(n);
    for (const c of n[":block/children"] || []) stack.push(c);
  }
}
function createMindMap({ doc, api = globalThis.roamAlphaAPI, writer, measurer, native, toaster, raf = defaultRaf, caf = defaultCaf, now = () => Date.now(), zIndexFor = () => 1e3, guardedWrite = defaultGuardedWrite }) {
  const sessions = /* @__PURE__ */ new Map();
  let disposed = false;
  const warn5 = (what, error) => console.warn(`[plexus] mind map ${what} failed`, error);
  const toast = (message, opts) => {
    try {
      toaster.show(message, opts);
    } catch (error) {
      warn5("toast", error);
    }
  };
  const failToast = () => toast(WRITE_FAILED, { kind: "error" });
  function blockString(uid) {
    try {
      const raw = api.data.pull("[:block/string]", [":block/uid", uid]);
      return typeof raw?.[":block/string"] === "string" ? raw[":block/string"] : null;
    } catch {
      return null;
    }
  }
  const textOf = (uid, node) => plainText(node.string, blockString);
  const sizer = makeSizer((text, size) => measurer.measure(text, size));
  function mount({ app, containerEl, outerEl, zIndex, drawingUid = null } = {}) {
    if (disposed || !app || !containerEl) return () => {
    };
    const s = createSession({ app, containerEl, outerEl, zIndex, drawingUid });
    sessions.set(app, s);
    return () => {
      s.dispose();
      if (sessions.get(app) === s) sessions.delete(app);
    };
  }
  function createSession({ app, containerEl, outerEl, zIndex, drawingUid }) {
    let alive = true;
    const trees = /* @__PURE__ */ new Map();
    const watches = /* @__PURE__ */ new Map();
    const rootPos = /* @__PURE__ */ new Map();
    const pendingRefresh = /* @__PURE__ */ new Set();
    const pendingFinished = /* @__PURE__ */ new Set();
    const idleRefresh = /* @__PURE__ */ new Set();
    const lastRoot = /* @__PURE__ */ new Map();
    const truncatedToast = /* @__PURE__ */ new Set();
    const offs = [];
    let snapshot = /* @__PURE__ */ new Map();
    let lastNonce = null;
    let prevEditingId = null;
    let dirty = false;
    let scheduled = null;
    let deleteToasted = false;
    let clip = null;
    let pendingDelete = null;
    let input = null;
    const fontSig = /* @__PURE__ */ new Map();
    let loadedTimer = null;
    let deferredSince = null;
    const forceMarks = /* @__PURE__ */ new Map();
    const els = () => app.getSceneElementsIncludingDeleted?.() ?? [];
    const guard2 = () => alive && !disposed && native.activeEditor(doc)?.app === app;
    const state = () => app.state || {};
    function takeSnapshot() {
      snapshot = /* @__PURE__ */ new Map();
      for (const el of els()) if (typeof el.id === "string" && el.id.startsWith("pmm-")) snapshot.set(el.id, el.version);
      recordRoots();
    }
    function recordRoots() {
      const live = els();
      for (const root of trees.keys()) {
        const el = live.find((e) => e.id === nodeId(root, root));
        if (el && Number.isFinite(el.x)) lastRoot.set(root, { x: el.x, y: el.y });
      }
    }
    function commit(mutate, roots, { force = false } = {}) {
      if (!guard2()) return false;
      let next = els();
      if (mutate) next = mutate(next);
      let changed = next !== els();
      const staged = [];
      for (const root of roots) {
        const tree = trees.get(root);
        if (!tree) continue;
        const ops = reconcile({ elements: next, tree, sizes: sizer, textOf, rootPos: rootPos.get(root) });
        if (!isEmptyOps(ops)) {
          next = applyOps(next, ops);
          changed = true;
        }
        staged.push(tree);
      }
      if (!changed) return false;
      const marked = roots.some((r) => (forceMarks.get(r) ?? 0) > now());
      const written = guardedWrite(app, { drawingUid, next, label: "Mind map", captureUpdate: "NEVER", force: force || marked, onApplyAnyway: () => commit(mutate, roots, { force: true }) });
      if (!written) return false;
      for (const root of roots) forceMarks.delete(root);
      takeSnapshot();
      afterApply(roots);
      return true;
    }
    function afterApply(roots) {
      for (const root of roots) {
        const tree = trees.get(root);
        if (!tree) continue;
        if (tree.truncated && !truncatedToast.has(root)) {
          truncatedToast.add(root);
          toast(`Showing the first ${NODE_CAP} nodes of this map`);
        }
        const texts = visibleNodes(tree).map((v) => textOf(v.node.uid, v.node));
        const sig = texts.join("\n");
        if (sig !== fontSig.get(root) && typeof measurer.ensureFonts === "function") {
          fontSig.set(root, sig);
          Promise.resolve(measurer.ensureFonts(texts)).then((cleared) => {
            if (cleared && alive) commit(null, [root]);
          }).catch((error) => warn5("fonts", error));
        }
      }
      if (input) {
        if (liveNode(input.rootUid, input.uid)) placeInput();
        else commitInput();
      }
    }
    function liveNode(root, uid) {
      const el = els().find((e) => e.id === nodeId(root, uid));
      return !!el && !el.isDeleted;
    }
    function buildTree(root, raw) {
      const prune = new Set(trees.keys());
      prune.delete(root);
      return treeFromPull(raw, { prune, maxVisible: NODE_CAP });
    }
    function detach(root, { force = false } = {}) {
      const ids = new Set(projectionIds(els(), root));
      if (ids.size && guard2()) {
        const written = guardedWrite(app, { drawingUid, next: (list) => list.map((el) => ids.has(el.id) ? bump2(el, { isDeleted: true }) : el), label: "Mind map", captureUpdate: "NEVER", force, onApplyAnyway: () => detach(root, { force: true }) });
        if (!written) return;
        takeSnapshot();
      }
      watches.get(root)?.();
      watches.delete(root);
      trees.delete(root);
      rootPos.delete(root);
      lastRoot.delete(root);
      fontSig.delete(root);
      pendingRefresh.delete(root);
      forceMarks.delete(root);
    }
    function onRaw(root, raw) {
      if (!alive) return;
      if (!raw) {
        detach(root);
        return;
      }
      if (gestureActive()) {
        pendingRefresh.add(root);
        dirty = true;
        deferredSince ?? (deferredSince = now());
        return;
      }
      const prevTree = trees.get(root);
      const nextTree = buildTree(root, raw);
      const foldOnly = !!prevTree && !prevTree.truncated && !nextTree.truncated && (() => {
        const now2 = allUids(nextTree);
        for (const u of allUids(prevTree)) if (!now2.has(u)) return false;
        return true;
      })();
      trees.set(root, nextTree);
      commit(null, [root], { force: foldOnly });
    }
    function refreshRoot(root) {
      if (writer.isBusy?.(root)) {
        if (idleRefresh.has(root)) return;
        idleRefresh.add(root);
        writer.onIdle(root, () => {
          idleRefresh.delete(root);
          if (alive) refreshRoot(root);
        });
        return;
      }
      let raw = null;
      try {
        raw = writer.pullTree(root);
      } catch (error) {
        warn5("pull", error);
        return;
      }
      onRaw(root, raw);
    }
    function ensureRoot(root) {
      if (watches.has(root)) return;
      watches.set(root, writer.watchTree(root, (raw) => onRaw(root, raw)));
      if (!trees.has(root)) trees.set(root, null);
    }
    function discoverRoots() {
      const found = /* @__PURE__ */ new Set();
      for (const el of els()) {
        const mm = mmOf(el);
        if (el.isDeleted || !mm || typeof mm.map !== "string") continue;
        const ok = mm.uid && el.id === nodeId(mm.map, mm.uid) || mm.boundary && el.id === boundaryId(mm.map, mm.boundary) || Array.isArray(mm.edge) && el.id === edgeId(mm.map, mm.edge[1]);
        if (ok) found.add(mm.map);
      }
      return found;
    }
    function start() {
      const deadline = now() + LOAD_WAIT_MS;
      const poll = () => {
        loadedTimer = null;
        if (!alive) return;
        if (state().isLoading && now() < deadline) {
          loadedTimer = raf(poll);
          return;
        }
        const roots = discoverRoots();
        for (const root of roots) if (!trees.has(root)) trees.set(root, null);
        for (const root of roots) {
          ensureRoot(root);
          refreshRoot(root);
        }
        takeSnapshot();
      };
      poll();
    }
    function selectedNode() {
      const ids = native.selectedElementIds(app);
      if (ids.length !== 1) return null;
      const el = els().find((e) => e.id === ids[0]);
      const mm = mmOf(el);
      if (!el || el.isDeleted || !mm || !mm.uid || mm.edge || mm.boundary) return null;
      if (el.id !== nodeId(mm.map, mm.uid) || !trees.get(mm.map) || !findNode(trees.get(mm.map), mm.uid)) return null;
      return { el, uid: mm.uid, root: mm.map, isRoot: mm.root === true };
    }
    const selectedId = (root, uid) => !!state().selectedElementIds?.[nodeId(root, uid)];
    function select(root, uid) {
      app.updateScene({ appState: { selectedElementIds: { [nodeId(root, uid)]: true }, selectedGroupIds: {} }, captureUpdate: "NEVER" });
    }
    const refocus = () => {
      try {
        containerEl.focus({ preventScroll: true });
      } catch {
      }
    };
    function gestureActive() {
      const st = state();
      if (st.cursorButton === "down") return true;
      for (const key of GESTURE_FIELDS) if (key in st && st[key]) return true;
      return !!(st.isResizing || st.isRotating);
    }
    function onChange() {
      if (!alive || scheduled != null) return;
      scheduled = raf(() => pass());
    }
    function onPointerUp() {
      dirty = true;
      onChange();
    }
    function pass(force = false) {
      scheduled = null;
      if (!alive) return;
      force = force === true || deferredSince != null && now() - deferredSince > MAX_WAIT_MS;
      const st = state();
      const editingId = st.editingTextElement?.id ?? null;
      if (prevEditingId && !editingId) pendingFinished.add(prevEditingId);
      prevEditingId = editingId;
      const nonce3 = app.scene?.getSceneNonce?.();
      if (!pendingFinished.size && !pendingRefresh.size && !dirty && nonce3 !== void 0 && nonce3 === lastNonce) {
        if (input) placeInput();
        return;
      }
      if (!force && gestureActive()) {
        dirty = true;
        deferredSince ?? (deferredSince = now());
        if (input) placeInput();
        return;
      }
      deferredSince = null;
      dirty = false;
      lastNonce = nonce3;
      const finishedIds = [...pendingFinished];
      pendingFinished.clear();
      const refreshRoots = [...pendingRefresh];
      pendingRefresh.clear();
      try {
        for (const id of finishedIds) nativeTextEdit(id);
        nativeChanges();
      } catch (error) {
        warn5("change pass", error);
      }
      for (const root of refreshRoots) if (trees.has(root)) refreshRoot(root);
      if (input) placeInput();
    }
    function flush({ unloading = false } = {}) {
      if (!alive) return;
      if (unloading) closeInput({ write: true });
      if (scheduled != null) {
        caf(scheduled);
        scheduled = null;
      }
      try {
        pass(true);
      } catch (error) {
        warn5("flush", error);
      }
    }
    function nativeTextEdit(textId2) {
      const txt = els().find((e) => e.id === textId2);
      if (!txt || typeof txt.containerId !== "string" || !txt.containerId.startsWith("pmm-")) return;
      if (snapshot.get(txt.id) === txt.version) return;
      const container = els().find((e) => e.id === txt.containerId);
      const mm = mmOf(container);
      if (!mm || !mm.uid) return;
      const tree = trees.get(mm.map);
      const found = tree ? findNode(tree, mm.uid) : null;
      if (!found) return;
      const node = found.node;
      if (hasMarkup(node.string)) {
        toast(MARKUP_HINT);
        return;
      }
      let text = typeof txt.originalText === "string" ? txt.originalText : txt.text;
      if (isFolded(node)) {
        const suffix = ` (+${countHidden(node)})`;
        if (!text.endsWith(suffix)) return;
        text = text.slice(0, -suffix.length);
      }
      if (text === "" || text === "·" || text === node.string) return;
      writeString(mm.map, mm.uid, text, node.string);
    }
    function nativeChanges() {
      const live = els();
      const liveById = new Map(live.map((e) => [e.id, e]));
      let restored = false;
      for (const root of trees.keys()) {
        const tree = trees.get(root);
        if (!tree) continue;
        for (const v of visibleNodes(tree)) {
          const el = liveById.get(nodeId(root, v.node.uid));
          if (el && el.isDeleted && snapshot.get(el.id) !== el.version) restored = true;
        }
      }
      if (restored && !deleteToasted) {
        deleteToasted = true;
        toast(FOLLOW_HINT);
      }
      const pinPatch = /* @__PURE__ */ new Map();
      for (const root of trees.keys()) {
        const tree = trees.get(root);
        if (!tree) continue;
        const plan = planMap({ elements: live, tree, sizes: sizer, textOf });
        const rootEl = plan.info.get(root)?.el;
        const was = lastRoot.get(root);
        const dx = rootEl && was ? rootEl.x - was.x : 0;
        const dy = rootEl && was ? rootEl.y - was.y : 0;
        for (const v of plan.nodes) {
          if (v.depth === 0) continue;
          const info = plan.info.get(v.node.uid);
          const pos = plan.positions[v.node.uid];
          if (!info.el || info.el.isDeleted || info.mm && info.mm.pinned === true || !pos) continue;
          const off = (ox, oy) => Math.abs(info.el.x - (pos.x - ox)) > 2 || Math.abs(info.el.y - (pos.y - oy)) > 2;
          if (off(0, 0) && off(dx, dy)) pinPatch.set(info.el.id, true);
        }
      }
      const roots = [...trees.keys()].filter((r) => trees.get(r));
      const wasCommitted = commit(pinPatch.size ? (list) => list.map((el) => pinPatch.has(el.id) ? patchMarker(el, { pinned: true }) : el) : null, roots);
      if (!wasCommitted) recordRoots();
    }
    function writeString(root, uid, value, base3) {
      const tree = trees.get(root);
      const found = tree ? findNode(tree, uid) : null;
      if (found) {
        found.node.string = value;
        commit(null, [root]);
      }
      writer.updateString(root, uid, value, base3).then((result) => {
        if (result && result.ok === false) {
          if (result.reason === "changed") toast(CHANGED_ELSEWHERE, { kind: "error" });
          refreshRoot(root);
        }
      }).catch((error) => {
        warn5("write", error);
        failToast();
        refreshRoot(root);
      });
    }
    function newNode(root, anchorUid, kind) {
      const tree = trees.get(root);
      const found = tree ? findNode(tree, anchorUid) : null;
      if (!found) return;
      const uid = api.util.generateUID();
      const node = { uid, string: PLACEHOLDER_CHILD, open: true, children: [] };
      let job;
      if (kind === "sibling" && found.parent) {
        const at = found.parent.children.indexOf(found.node);
        found.parent.children.splice(at + 1, 0, node);
        job = writer.createSiblingAfter(root, anchorUid, { uid, string: PLACEHOLDER_CHILD });
      } else {
        found.node.open = true;
        found.node.children.push(node);
        job = writer.createChild(root, anchorUid, { uid, string: PLACEHOLDER_CHILD });
      }
      commit(null, [root]);
      select(root, uid);
      openInput({ root, uid, base: PLACEHOLDER_CHILD, placeholder: PLACEHOLDER_CHILD });
      Promise.resolve(job).catch((error) => {
        warn5("create", error);
        closeInput({ write: false });
        failToast();
        refreshRoot(root);
      });
    }
    function inputRect() {
      const el = els().find((e) => e.id === nodeId(input.rootUid, input.uid));
      if (!el) return null;
      return native.viewportRectOf(app, [el.x, el.y, el.x + el.width, el.y + el.height]);
    }
    function placeInput() {
      if (!input) return;
      const r = inputRect();
      if (!r) return;
      const st = state();
      const zoom = st.zoom?.value || 1;
      const s = input.el.style;
      s.left = `${r.left}px`;
      s.top = `${r.top}px`;
      s.width = `${Math.max(r.width, 80 * zoom)}px`;
      s.height = `${r.height}px`;
      const txt = els().find((e) => e.id === textId(input.rootUid, input.uid));
      s.fontSize = `${(txt && Number.isFinite(txt.fontSize) ? txt.fontSize : 16) * zoom}px`;
    }
    function openInput({ root, uid, base: base3, placeholder = null }) {
      closeInput({ write: true });
      const el = doc.createElement("input");
      el.type = "text";
      el.className = "plexus-portal plexus-mm-input";
      el.value = base3;
      el.style.zIndex = String((zIndex ?? zIndexFor(outerEl)) + 2);
      const handle = { el, rootUid: root, uid, base: base3, placeholder, composing: false, listeners: [], done: false };
      const on = (type, fn) => {
        el.addEventListener(type, fn);
        handle.listeners.push([type, fn]);
      };
      on("keydown", (e) => {
        e.stopPropagation();
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === "Enter") {
          e.preventDefault();
          commitInput();
        } else if (e.key === "Tab" && !e.shiftKey) {
          e.preventDefault();
          const target = { root: handle.rootUid, uid: handle.uid };
          commitInput();
          newNode(target.root, target.uid, "child");
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancelInput();
        }
      });
      for (const type of INPUT_ISOLATED) on(type, (e) => e.stopPropagation());
      on("blur", () => commitInput());
      input = handle;
      doc.body.append(el);
      placeInput();
      el.focus?.();
      el.select?.();
    }
    function removeInput(handle) {
      handle.done = true;
      for (const [type, fn] of handle.listeners.splice(0)) handle.el.removeEventListener?.(type, fn);
      handle.el.remove?.();
      if (input === handle) input = null;
    }
    function closeInput({ write }) {
      const handle = input;
      if (!handle) return;
      const value = handle.el.value;
      removeInput(handle);
      if (write) finishInput(handle, value);
    }
    function finishInput(handle, value) {
      const { rootUid, uid, base: base3, placeholder } = handle;
      if (value === "") {
        if (placeholder) discard(rootUid, uid, placeholder);
        return;
      }
      if (value === base3) return;
      writeString(rootUid, uid, value, base3);
    }
    function discard(root, uid, placeholder) {
      const tree = trees.get(root);
      const found = tree ? findNode(tree, uid) : null;
      if (found?.parent) {
        const at = found.parent.children.indexOf(found.node);
        const anchor = at > 0 ? found.parent.children[at - 1] : found.parent;
        found.parent.children = found.parent.children.filter((c) => c.uid !== uid);
        commit(null, [root]);
        if (selectedId(root, uid)) select(root, anchor.uid);
      }
      writer.discardPlaceholder(root, uid, placeholder).then(() => refreshRoot(root)).catch((error) => {
        warn5("discard", error);
        refreshRoot(root);
      });
    }
    function commitInput() {
      if (!input) return;
      closeInput({ write: true });
      refocus();
    }
    function cancelInput() {
      const handle = input;
      if (!handle) return;
      removeInput(handle);
      if (handle.placeholder) discard(handle.rootUid, handle.uid, handle.placeholder);
      refocus();
    }
    function onKeyDown(e) {
      if (!alive || e.isComposing || e.keyCode === 229 || e.target !== containerEl || input) return;
      const st = state();
      if (st.editingTextElement) return;
      if (st.openDialog || st.openMenu || st.openPopup || st.contextMenu) return;
      const sel = selectedNode();
      if (!sel) return;
      const swallow4 = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      if (e.metaKey || e.ctrlKey) {
        if (e.altKey) return;
        if (e.key in ARROWS) {
          swallow4();
          toast(GROW_HINT);
        } else if (e.code === "KeyZ") {
          swallow4();
          toast("Undo mind-map edits in the outline");
        }
        return;
      }
      const alt = e.altKey && !e.shiftKey;
      const plain = !e.altKey && !e.shiftKey;
      let action = null;
      let repeatSafe = true;
      if (plain && e.key === "Tab") {
        action = () => newNode(sel.root, sel.uid, "child");
        repeatSafe = false;
      } else if (plain && e.key === "Enter") {
        action = () => newNode(sel.root, sel.uid, sel.isRoot ? "child" : "sibling");
        repeatSafe = false;
      } else if (plain && e.key === "F2") action = () => editSelected(sel);
      else if (alt && e.key in ARROWS) {
        swallow4();
        moveSelection(sel, ARROWS[e.key]);
        return;
      } else if (alt && e.key === "Backspace") {
        action = () => deleteBranch(sel);
        repeatSafe = false;
      } else if (alt && LETTERS.has(e.code)) {
        const letter = e.code.slice(3);
        action = () => letterAction(letter, sel);
        repeatSafe = letter !== "V";
      }
      if (!action) return;
      swallow4();
      if (e.repeat && !repeatSafe) return;
      if (e.altKey && e.key !== "Backspace") pendingDelete = null;
      else if (!(e.key === "Backspace")) pendingDelete = null;
      if (st.viewModeEnabled) return;
      try {
        const out = action();
        if (out && typeof out.catch === "function") out.catch((error) => {
          warn5("hotkey", error);
          failToast();
        });
      } catch (error) {
        warn5("hotkey", error);
      }
    }
    function editSelected(sel) {
      const node = findNode(trees.get(sel.root), sel.uid)?.node;
      if (!node) return;
      if (hasMarkup(node.string)) {
        toast(MARKUP_HINT);
        return;
      }
      openInput({ root: sel.root, uid: sel.uid, base: node.string });
    }
    function moveSelection(sel, dir) {
      const tree = trees.get(sel.root);
      const rects = [];
      for (const v of visibleNodes(tree)) {
        const el = els().find((e) => e.id === nodeId(sel.root, v.node.uid));
        if (el && !el.isDeleted) rects.push({ id: v.node.uid, x: el.x, y: el.y, width: el.width, height: el.height });
      }
      const from = rects.find((r) => r.id === sel.uid);
      if (!from) return;
      const target = nearestInDirection(from, rects, dir);
      if (!target) return;
      const to = rects.find((r) => r.id === target);
      select(sel.root, target);
      const st = state();
      const zoom = st.zoom?.value || 1;
      const vr = native.viewportRectOf(app, [to.x, to.y, to.x + to.width, to.y + to.height]);
      const left = st.offsetLeft || 0;
      const top = st.offsetTop || 0;
      const off = vr.left < left || vr.top < top || vr.left + vr.width > left + (st.width || 0) || vr.top + vr.height > top + (st.height || 0);
      if (off) {
        app.updateScene({ appState: { scrollX: (st.width || 0) / (2 * zoom) - (to.x + to.width / 2), scrollY: (st.height || 0) / (2 * zoom) - (to.y + to.height / 2) }, captureUpdate: "NEVER" });
      }
    }
    function letterAction(letter, sel) {
      if (letter === "F") return toggleFold(sel);
      if (letter === "L") return cycleLayout(sel);
      if (letter === "P") return togglePin(sel);
      if (letter === "B") return toggleBoundary(sel);
      if (letter === "X" || letter === "C") return copyOrCut(letter === "X" ? "cut" : "copy", sel);
      return paste(sel);
    }
    function toggleFold(sel) {
      const node = findNode(trees.get(sel.root), sel.uid)?.node;
      if (!node) return null;
      if (!node.children.length) {
        toast("No children to fold");
        return null;
      }
      const open4 = node.open === false;
      node.open = open4;
      commit(null, [sel.root], { force: true });
      return writer.setOpen(sel.root, sel.uid, open4).catch((error) => {
        warn5("fold", error);
        failToast();
        refreshRoot(sel.root);
      });
    }
    function rootElement(root) {
      return els().find((e) => e.id === nodeId(root, root));
    }
    function cycleLayout(sel) {
      const rootEl = rootElement(sel.root);
      if (!rootEl) return null;
      const cur = mmOf(rootEl)?.layout || "right";
      const next = LAYOUTS[(LAYOUTS.indexOf(cur) + 1) % LAYOUTS.length];
      commit((list) => list.map((e) => e.id === rootEl.id ? patchMarker(e, { layout: next }) : e), [sel.root]);
      toast(`Layout: ${next}`);
      return null;
    }
    function togglePin(sel) {
      if (sel.isRoot) return null;
      const pinned = mmOf(sel.el)?.pinned === true;
      commit((list) => list.map((e) => e.id === sel.el.id ? patchMarker(e, { pinned: pinned ? void 0 : true }) : e), [sel.root]);
      return null;
    }
    function toggleBoundary(sel) {
      const rootEl = rootElement(sel.root);
      if (!rootEl) return null;
      const bounds = new Set(mmOf(rootEl)?.bounds || []);
      if (bounds.has(sel.uid)) bounds.delete(sel.uid);
      else bounds.add(sel.uid);
      commit((list) => list.map((e) => e.id === rootEl.id ? patchMarker(e, { bounds: [...bounds] }) : e), [sel.root]);
      return null;
    }
    function copyOrCut(mode, sel) {
      if (mode === "cut" && sel.isRoot) {
        toast("The root cannot be cut");
        return null;
      }
      clip = { mode, uid: sel.uid, root: sel.root };
      toast(mode === "cut" ? "Branch cut" : "Branch copied");
      return null;
    }
    async function paste(sel) {
      if (!clip) {
        toast("Cut or copy a branch first");
        return null;
      }
      const source = clip;
      const opts = source.root !== sel.root ? { targetRootUid: sel.root } : {};
      const result = source.mode === "cut" ? await writer.moveBranch(source.root, source.uid, sel.uid, opts) : await writer.copyBranch(source.root, source.uid, sel.uid, opts);
      if (!result || result.ok === false) {
        const reason = result?.reason;
        if (reason === "inside-source") toast("Cannot paste a branch into itself");
        else if (reason === "too-large") toast(`That branch is too large to copy (${result.count} blocks)`);
        else if (reason === "excluded") toast("Drawings cannot be copied here");
        else toast(WRITE_FAILED, { kind: "error" });
      } else {
        if (source.mode === "cut") clip = null;
        if (result.skipped) toast(`Skipped ${result.skipped} drawing block${result.skipped === 1 ? "" : "s"}`);
      }
      refreshRoot(sel.root);
      if (source.root !== sel.root && trees.has(source.root)) refreshRoot(source.root);
      return null;
    }
    function branchCheck(uid) {
      const raw = writer.pullTree(uid);
      if (!raw) return null;
      const uids = /* @__PURE__ */ new Set();
      let excluded = false;
      rawWalk(raw, (n) => {
        uids.add(n[":block/uid"]);
        if (isExcludedString(n[":block/string"] ?? "")) excluded = true;
      });
      let referenced = false;
      for (const id of uids) {
        const r = api.data.pull("[:block/uid {:block/_refs [:block/uid]}]", [":block/uid", id]);
        if ((r?.[":block/_refs"] || []).some((x) => !uids.has(x[":block/uid"]))) {
          referenced = true;
          break;
        }
      }
      return { count: uids.size, excluded, referenced, string: raw[":block/string"] ?? "" };
    }
    async function deleteBranch(sel) {
      const t = now();
      const armed = pendingDelete && pendingDelete.uid === sel.uid && t - pendingDelete.at <= DELETE_WINDOW_MS ? pendingDelete : null;
      if (sel.isRoot) {
        if (!armed) {
          pendingDelete = { uid: sel.uid, at: t };
          toast("Press Alt+Backspace again to detach this mind map (the outline stays)");
          return;
        }
        pendingDelete = null;
        detach(sel.root, { force: true });
        return;
      }
      const info = branchCheck(sel.uid);
      if (!info) {
        refreshRoot(sel.root);
        return;
      }
      if (!armed) {
        if (info.excluded) {
          toast("This branch contains drawings; delete it in the outline", { kind: "error" });
          return;
        }
        if (info.referenced) {
          toast("A block in this branch is referenced elsewhere; delete it in the outline", { kind: "error" });
          return;
        }
        pendingDelete = { uid: sel.uid, at: t, count: info.count, string: info.string };
        toast(`Press Alt+Backspace again to delete ${info.count} block${info.count === 1 ? "" : "s"}`);
        return;
      }
      pendingDelete = null;
      if (armed.count !== info.count || armed.string !== info.string) {
        toast("The branch changed; press Alt+Backspace again", { kind: "error" });
        return;
      }
      const result = await writer.deleteBranch(sel.root, sel.uid, { count: armed.count, string: armed.string });
      if (!result || result.ok === false) toast(WRITE_FAILED, { kind: "error" });
      else forceMarks.set(sel.root, now() + FORCE_MARK_MS);
      refreshRoot(sel.root);
    }
    function startRoot({ drawingUid: drawingUid2 }) {
      const root = api.util.generateUID();
      const st = state();
      const zoom = st.zoom?.value || 1;
      const cx = (st.width || 0) / (2 * zoom) - (st.scrollX || 0);
      const cy = (st.height || 0) / (2 * zoom) - (st.scrollY || 0);
      rootPos.set(root, { x: cx - 70, y: cy - 24 });
      trees.set(root, { uid: root, string: PLACEHOLDER_ROOT, open: true, children: [] });
      const job = writer.createChild(root, drawingUid2, { uid: root, string: PLACEHOLDER_ROOT, unfold: false });
      ensureRoot(root);
      commit(null, [root]);
      select(root, root);
      openInput({ root, uid: root, base: PLACEHOLDER_ROOT, placeholder: PLACEHOLDER_ROOT });
      Promise.resolve(job).catch((error) => {
        warn5("start", error);
        closeInput({ write: false });
        detach(root);
        failToast();
      });
      return root;
    }
    function showOutline(root) {
      rootPos.set(root, { x: 0, y: 0 });
      trees.set(root, null);
      ensureRoot(root);
      refreshRoot(root);
      if (!trees.get(root)) return false;
      select(root, root);
      const rect = els().filter((e) => !e.isDeleted && e.id.startsWith(`pmm-${root}-`) && !e.containerId);
      if (rect.length) {
        const box = [Math.min(...rect.map((e) => e.x)), Math.min(...rect.map((e) => e.y)), Math.max(...rect.map((e) => e.x + e.width)), Math.max(...rect.map((e) => e.y + e.height))];
        native.zoomTo(app, box);
      }
      return true;
    }
    const listen = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      offs.push(() => target.removeEventListener(type, fn, opts));
    };
    listen(containerEl, "keydown", onKeyDown, true);
    for (const name of ["onChangeEmitter", "onScrollChangeEmitter"]) {
      try {
        const off = app[name]?.on?.(() => onChange());
        if (typeof off === "function") offs.push(off);
      } catch (error) {
        warn5("subscribe", error);
      }
    }
    try {
      const off = app.onPointerUpEmitter?.on?.(onPointerUp);
      if (typeof off === "function") offs.push(off);
    } catch (error) {
      warn5("subscribe", error);
    }
    const view2 = doc.defaultView;
    if (view2?.addEventListener) listen(view2, "pagehide", () => flush({ unloading: true }));
    if (doc.addEventListener) listen(doc, "visibilitychange", () => {
      if (doc.visibilityState === "hidden") flush();
    });
    start();
    return {
      app,
      selectedNode,
      startRoot,
      showOutline,
      flush,
      dispose() {
        flush();
        alive = false;
        if (loadedTimer != null) caf(loadedTimer);
        if (scheduled != null) caf(scheduled);
        loadedTimer = null;
        scheduled = null;
        if (input) removeInput(input);
        for (const off of offs.splice(0)) {
          try {
            off();
          } catch (error) {
            warn5("cleanup", error);
          }
        }
        for (const off of watches.values()) {
          try {
            off();
          } catch (error) {
            warn5("cleanup", error);
          }
        }
        watches.clear();
        trees.clear();
        clip = null;
        pendingDelete = null;
        measurer.clear?.();
      }
    };
  }
  const sessionFor = (app) => sessions.get(app) || null;
  async function waitForSession(app, ms = 2e3) {
    const end = now() + ms;
    for (; ; ) {
      const s = sessionFor(app);
      if (s || disposed || now() >= end) return s;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  function outlineInfo(blockUid) {
    const raw = writer.pullTree(blockUid);
    if (!raw) return null;
    const full = treeFromPull(raw);
    return { string: raw[":block/string"] ?? "", visible: full ? visibleNodes(full).length : 0, total: full ? countHidden(full) + 1 : 0 };
  }
  return {
    mount,
    selectedNode: (app) => sessionFor(app)?.selectedNode() ?? null,
    startRoot: ({ app, drawingUid }) => sessionFor(app)?.startRoot({ drawingUid }) ?? null,
    async showOutline({ app, rootUid }) {
      const s = await waitForSession(app);
      return s ? s.showOutline(rootUid) : false;
    },
    outlineInfo,
    NODE_CAP,
    hasSession: (app) => sessions.has(app),
    dispose() {
      disposed = true;
      for (const s of [...sessions.values()]) s.dispose();
      sessions.clear();
    }
  };
}

// src/host/mmwrites.js
var TREE_PATTERN = "[:block/uid :block/string :block/open :block/order {:block/children ...}]";
var COPY_CAP = 200;
var byOrder2 = (a, b) => (a[":block/order"] ?? 0) - (b[":block/order"] ?? 0);
var kids = (node) => (node?.[":block/children"] || []).slice().sort(byOrder2);
var quote = (uid) => String(uid).replace(/["\\]/g, "");
function walk(node, fn) {
  fn(node);
  for (const child of kids(node)) walk(child, fn);
}
function createMmWriter({ api = globalThis.roamAlphaAPI, withLockFn = withLock, graph, raf } = {}) {
  const queues = /* @__PURE__ */ new Map();
  const drainHooks = /* @__PURE__ */ new Map();
  const created = /* @__PURE__ */ new Set();
  const schedule = raf || ((fn) => typeof globalThis.requestAnimationFrame === "function" ? globalThis.requestAnimationFrame(fn) : setTimeout(fn, 16));
  const graphName = () => graph ?? api.graph?.name;
  const state = (root) => {
    let s = queues.get(root);
    if (!s) {
      s = { tail: Promise.resolve(), pending: 0 };
      queues.set(root, s);
    }
    return s;
  };
  const busy = (root) => (queues.get(root)?.pending || 0) > 0;
  function pullRaw(pattern, uid) {
    if (!uid) return null;
    const raw = api.data.pull(pattern, [":block/uid", uid]);
    return raw && raw[":block/uid"] ? raw : null;
  }
  const pullTree = (rootUid) => pullRaw(TREE_PATTERN, rootUid);
  async function underLocks(roots, fn) {
    const sorted = [...new Set(roots)].sort();
    const step = async (i) => {
      if (i >= sorted.length) return fn();
      const lock = await withLockFn(lockName(graphName(), `mm:${sorted[i]}`), () => step(i + 1));
      if (!lock.acquired) throw new Error("[plexus] could not acquire mind-map lock");
      return lock.value;
    };
    return step(0);
  }
  function run(rootUid, fn, extraRoots = []) {
    const s = state(rootUid);
    s.pending += 1;
    const job = s.tail.then(() => underLocks([rootUid, ...extraRoots], fn));
    s.tail = job.then(() => {
    }, () => {
    });
    return job.finally(() => {
      s.pending -= 1;
      if (s.pending === 0) for (const hook of [...drainHooks.get(rootUid) || []]) hook();
    });
  }
  async function createAt(parentUid, order, uid, string) {
    await api.data.block.create({ location: { "parent-uid": parentUid, order }, block: { uid, string } });
    created.add(uid);
  }
  async function unfold(uid) {
    const raw = pullRaw("[:block/uid :block/open]", uid);
    if (raw && raw[":block/open"] === false) await api.data.block.update({ block: { uid, open: true } });
  }
  function createChild(rootUid, parentUid, { uid = api.util.generateUID(), string = "", unfold: doUnfold = true } = {}) {
    return run(rootUid, async () => {
      if (doUnfold) await unfold(parentUid);
      await createAt(parentUid, "last", uid, string);
      return uid;
    });
  }
  function createSiblingAfter(rootUid, siblingUid, { uid = api.util.generateUID(), string = "" } = {}) {
    return run(rootUid, async () => {
      if (siblingUid === rootUid) {
        await unfold(rootUid);
        await createAt(rootUid, "last", uid, string);
        return uid;
      }
      const raw = api.data.pull("[:block/uid :block/order {:block/_children [:block/uid]}]", [":block/uid", siblingUid]);
      const parent = raw?.[":block/_children"]?.[0]?.[":block/uid"];
      if (!raw?.[":block/uid"] || !parent) throw new Error("[plexus] sibling block not found");
      await createAt(parent, (raw[":block/order"] ?? 0) + 1, uid, string);
      return uid;
    });
  }
  function updateString(rootUid, uid, string, baseString) {
    return run(rootUid, async () => {
      const raw = pullRaw("[:block/uid :block/string]", uid);
      if (!raw) return { ok: false, reason: "missing" };
      if ((raw[":block/string"] ?? "") !== baseString) return { ok: false, reason: "changed" };
      if (string === baseString) return { ok: true, written: false };
      await api.data.block.update({ block: { uid, string } });
      return { ok: true, written: true };
    });
  }
  function setOpen(rootUid, uid, open4) {
    return run(rootUid, async () => {
      await api.data.block.update({ block: { uid, open: !!open4 } });
      return { ok: true };
    });
  }
  async function insideBranch(sourceUid, targetUid) {
    if (sourceUid === targetUid) return true;
    const raw = api.data.pull("[:block/uid {:block/parents [:block/uid]}]", [":block/uid", targetUid]);
    return (raw?.[":block/parents"] || []).some((p) => p[":block/uid"] === sourceUid);
  }
  function moveBranch(rootUid, uid, targetParentUid, { targetRootUid } = {}) {
    return run(rootUid, async () => {
      if (!pullRaw("[:block/uid]", uid)) return { ok: false, reason: "missing" };
      if (!pullRaw("[:block/uid]", targetParentUid)) return { ok: false, reason: "missing-target" };
      if (await insideBranch(uid, targetParentUid)) return { ok: false, reason: "inside-source" };
      await unfold(targetParentUid);
      await api.data.block.move({ location: { "parent-uid": targetParentUid, order: "last" }, block: { uid } });
      return { ok: true };
    }, targetRootUid && targetRootUid !== rootUid ? [targetRootUid] : []);
  }
  function copyBranch(rootUid, sourceUid, targetParentUid, { targetRootUid, cap = COPY_CAP } = {}) {
    return run(rootUid, async () => {
      const source = pullTree(sourceUid);
      if (!source) return { ok: false, reason: "missing" };
      if (!pullRaw("[:block/uid]", targetParentUid)) return { ok: false, reason: "missing-target" };
      if (await insideBranch(sourceUid, targetParentUid)) return { ok: false, reason: "inside-source" };
      let total = 0;
      let skipped2 = 0;
      const plan = (node) => {
        const string = node[":block/string"] ?? "";
        if (isExcludedString(string)) {
          walk(node, () => {
            skipped2 += 1;
          });
          return null;
        }
        total += 1;
        return { string, open: node[":block/open"], children: kids(node).map(plan).filter(Boolean) };
      };
      const tree = plan(source);
      if (!tree) return { ok: false, reason: "excluded", skipped: skipped2 };
      if (total > cap) return { ok: false, reason: "too-large", count: total };
      await unfold(targetParentUid);
      let made = 0;
      const emit = async (node, parent) => {
        const uid2 = api.util.generateUID();
        await createAt(parent, "last", uid2, node.string);
        made += 1;
        for (const child of node.children) await emit(child, uid2);
        if (node.children.length && node.open === false) await api.data.block.update({ block: { uid: uid2, open: false } });
        return uid2;
      };
      const uid = await emit(tree, targetParentUid);
      return { ok: true, uid, created: made, skipped: skipped2 };
    }, targetRootUid && targetRootUid !== rootUid ? [targetRootUid] : []);
  }
  function deleteBranch(rootUid, uid, expect = {}) {
    return run(rootUid, async () => {
      if (uid === rootUid) return { ok: false, reason: "root" };
      const tree = pullTree(uid);
      if (!tree) return { ok: false, reason: "missing" };
      const uids = /* @__PURE__ */ new Set();
      let excluded = false;
      walk(tree, (n) => {
        uids.add(n[":block/uid"]);
        if (isExcludedString(n[":block/string"] ?? "")) excluded = true;
      });
      if (excluded) return { ok: false, reason: "excluded", count: uids.size };
      if (expect.count != null && expect.count !== uids.size) return { ok: false, reason: "changed", count: uids.size };
      if (expect.string != null && expect.string !== (tree[":block/string"] ?? "")) return { ok: false, reason: "changed", count: uids.size };
      for (const id of uids) {
        const raw = api.data.pull("[:block/uid {:block/_refs [:block/uid]}]", [":block/uid", id]);
        if ((raw?.[":block/_refs"] || []).some((r) => !uids.has(r[":block/uid"]))) return { ok: false, reason: "referenced", count: uids.size };
      }
      await api.data.block.delete({ block: { uid } });
      return { ok: true, count: uids.size };
    });
  }
  function discardPlaceholder(rootUid, uid, placeholder) {
    return run(rootUid, async () => {
      if (!created.has(uid)) return { ok: false, reason: "not-created" };
      const raw = pullRaw("[:block/uid :block/string {:block/children [:block/uid]}]", uid);
      if (!raw) return { ok: false, reason: "missing" };
      if ((raw[":block/string"] ?? "") !== placeholder || (raw[":block/children"] || []).length) return { ok: false, reason: "changed" };
      await api.data.block.delete({ block: { uid } });
      created.delete(uid);
      return { ok: true };
    });
  }
  function watchTree(rootUid, cb) {
    if (!rootUid || typeof api.data?.addPullWatch !== "function") return () => {
    };
    const ident = `[:block/uid "${quote(rootUid)}"]`;
    let dirty = false;
    let scheduled = false;
    let done = false;
    const flush = () => {
      scheduled = false;
      if (done || !dirty) return;
      if (busy(rootUid)) return;
      dirty = false;
      try {
        cb(pullTree(rootUid));
      } catch (error) {
        console.warn("[plexus] mind-map watch callback failed", error);
      }
    };
    const mark = () => {
      dirty = true;
      if (busy(rootUid) || scheduled) return;
      scheduled = true;
      schedule(flush);
    };
    const handler = () => {
      if (!done) mark();
    };
    const onDrain = () => {
      if (dirty && !done && !scheduled) {
        scheduled = true;
        schedule(flush);
      }
    };
    let hooks = drainHooks.get(rootUid);
    if (!hooks) {
      hooks = /* @__PURE__ */ new Set();
      drainHooks.set(rootUid, hooks);
    }
    hooks.add(onDrain);
    api.data.addPullWatch(TREE_PATTERN, ident, handler);
    return () => {
      if (done) return;
      done = true;
      hooks.delete(onDrain);
      if (!hooks.size) drainHooks.delete(rootUid);
      try {
        api.data.removePullWatch(TREE_PATTERN, ident, handler);
      } catch (error) {
        console.warn("[plexus] removePullWatch failed", error);
      }
    };
  }
  function onIdle(rootUid, fn) {
    if (!busy(rootUid)) {
      fn();
      return;
    }
    let hooks = drainHooks.get(rootUid);
    if (!hooks) {
      hooks = /* @__PURE__ */ new Set();
      drainHooks.set(rootUid, hooks);
    }
    const hook = () => {
      hooks.delete(hook);
      if (!hooks.size && drainHooks.get(rootUid) === hooks) drainHooks.delete(rootUid);
      fn();
    };
    hooks.add(hook);
  }
  return { isBusy: busy, onIdle, createChild, createSiblingAfter, updateString, setOpen, moveBranch, copyBranch, deleteBranch, discardPlaceholder, pullTree, watchTree };
}

// src/host/camera.js
var camera_exports = {};
__export(camera_exports, {
  animateTo: () => animateTo,
  animateView: () => animateView,
  createViewHistory: () => createViewHistory
});
var ABORT_EVENTS = ["pointerdown", "wheel", "keydown"];
var SLOW_FRAME_MS = 32;
var tokens = /* @__PURE__ */ new WeakMap();
var zoomOf = (state) => (typeof state?.zoom === "number" ? state.zoom : state?.zoom?.value) || 1;
var viewOf = (state) => ({ scrollX: state?.scrollX || 0, scrollY: state?.scrollY || 0, zoom: zoomOf(state) });
function safeUpdate(app, appState) {
  try {
    app.updateScene({ appState, captureUpdate: "NEVER" });
    return true;
  } catch (error) {
    console.warn("[plexus] camera update failed", error);
    return false;
  }
}
var writeView = (app, v, extra = {}) => safeUpdate(app, { scrollX: v.scrollX, scrollY: v.scrollY, zoom: { value: v.zoom }, ...extra });
var rectFor = (app, bbox, v) => {
  const s = app.state || {};
  const left = (bbox[0] + v.scrollX) * v.zoom + (s.offsetLeft || 0);
  const top = (bbox[1] + v.scrollY) * v.zoom + (s.offsetTop || 0);
  return { left, top, width: (bbox[2] - bbox[0]) * v.zoom, height: (bbox[3] - bbox[1]) * v.zoom };
};
function animateView(app, target, { animate = true, doc = globalThis.document, raf = globalThis.requestAnimationFrame, now = () => Date.now(), duration = 400 } = {}) {
  const token = {};
  tokens.set(app, token);
  if (!animate || typeof raf !== "function") {
    return Promise.resolve({ moved: writeView(app, target), aborted: false });
  }
  const start = viewOf(app.state);
  const w = app.state?.width || 0;
  const h = app.state?.height || 0;
  const centerOf = (v) => ({ x: w / (2 * v.zoom) - v.scrollX, y: h / (2 * v.zoom) - v.scrollY });
  const c0 = centerOf(start);
  const c1 = centerOf(target);
  const cacheKey = app.state && "shouldCacheIgnoreZoom" in app.state;
  return new Promise((resolve) => {
    let finished = false;
    let slow = 0;
    let t0 = null;
    const off = () => {
      for (const type of ABORT_EVENTS) doc?.removeEventListener?.(type, onInput, { capture: true });
    };
    const finish = (result) => {
      if (finished) return;
      finished = true;
      off();
      if (cacheKey) safeUpdate(app, { shouldCacheIgnoreZoom: false });
      if (tokens.get(app) === token) tokens.delete(app);
      resolve(result);
    };
    const abort = () => finish({ moved: true, aborted: true });
    function onInput() {
      abort();
    }
    for (const type of ABORT_EVENTS) doc?.addEventListener?.(type, onInput, { capture: true, passive: true });
    if (cacheKey) safeUpdate(app, { shouldCacheIgnoreZoom: true });
    const step = () => {
      if (finished) return;
      if (tokens.get(app) !== token || doc && activeEditor(doc)?.app !== app) return abort();
      const t = now();
      if (t0 == null) t0 = t;
      const p = Math.min(1, (t - t0) / duration);
      const before = now();
      let ok;
      if (p >= 1) ok = writeView(app, target);
      else {
        const e = 1 - (1 - p) ** 3;
        const zoom = start.zoom * (target.zoom / start.zoom) ** e;
        const cx = c0.x + (c1.x - c0.x) * e;
        const cy = c0.y + (c1.y - c0.y) * e;
        ok = writeView(app, { zoom, scrollX: w / (2 * zoom) - cx, scrollY: h / (2 * zoom) - cy });
        if (ok && now() - before > SLOW_FRAME_MS && ++slow >= 2) {
          ok = writeView(app, target);
          return finish({ moved: ok, aborted: false });
        }
      }
      if (!ok || p >= 1) return finish({ moved: ok, aborted: false });
      raf(step);
    };
    raf(step);
  });
}
async function animateTo(app, bbox, { maxZoom = 1, animate = true, doc = globalThis.document, ...rest } = {}) {
  try {
    const s = app.state || {};
    const cur = viewOf(s);
    const fit = fitZoom({ bbox, viewportWidth: s.width, viewportHeight: s.height, maxZoom });
    const target = { scrollX: fit.scrollX, scrollY: fit.scrollY, zoom: fit.zoom };
    const inside = (v) => {
      const r = rectFor(app, bbox, v);
      const l = s.offsetLeft || 0;
      const tp = s.offsetTop || 0;
      return r.left >= l && r.top >= tp && r.left + r.width <= l + s.width && r.top + r.height <= tp + s.height;
    };
    if (inside(cur) && cur.zoom >= 0.6 * target.zoom && cur.zoom <= 1.25 * target.zoom) {
      return { moved: false, aborted: false, rect: rectFor(app, bbox, cur) };
    }
    const result = await animateView(app, target, { animate, doc, ...rest });
    return { ...result, rect: rectFor(app, bbox, viewOf(app.state)) };
  } catch (error) {
    console.warn("[plexus] animateTo failed", error);
    return { moved: false, aborted: false, rect: null };
  }
}
function createViewHistory({ cap = 50, onChange } = {}) {
  const stack = [];
  const changed = () => {
    try {
      onChange?.();
    } catch (error) {
      console.warn("[plexus] view history onChange failed", error);
    }
  };
  return {
    push(app) {
      const v = viewOf(app?.state);
      const top = stack[stack.length - 1];
      if (top && Math.abs(top.scrollX - v.scrollX) < 0.5 && Math.abs(top.scrollY - v.scrollY) < 0.5 && Math.abs(top.zoom - v.zoom) < 1e-3) return;
      stack.push(v);
      if (stack.length > cap) stack.shift();
      changed();
    },
    async back(app, { animate = false, doc } = {}) {
      const v = stack.pop();
      if (!v) return false;
      changed();
      await animateView(app, v, { animate, doc });
      return true;
    },
    size: () => stack.length,
    discard() {
      if (!stack.length) return;
      stack.pop();
      changed();
    },
    clear() {
      if (!stack.length) return;
      stack.length = 0;
      changed();
    }
  };
}

// src/view/regions-layer.js
var REGION_LAYER_CAP = 150;
var REGION_REFETCH_MS2 = 3e3;
var CHIP_HEIGHT = 20;
var SVG_NS = "http://www.w3.org/2000/svg";
var CHIP_ABOVE = "scale(var(--plexus-inv-zoom)) translateY(-100%)";
var CHIP_INSIDE = "scale(var(--plexus-inv-zoom)) translateY(2px)";
var CHIP_MAX_TEXT = 32;
var P95_EVERY = 120;
var DRAWN_KINDS = /* @__PURE__ */ new Set(["area", "group", "frame", "cframe", "rect", "poly"]);
var GESTURE_KEYS = ["newElement", "resizingElement", "isResizing", "isRotating", "editingTextElement", "selectedElementsAreBeingDragged"];
var OVERLAY_KEYS = ["contextMenu", "openDialog", "openMenu", "openPopup"];
var cutChip = (text) => text.length <= CHIP_MAX_TEXT ? text : `${text.slice(0, CHIP_MAX_TEXT - 1).trimEnd()}…`;
function createRegionsLayer({
  doc,
  app,
  containerEl,
  host,
  drawingUid,
  native = native_exports,
  zIndex = 1e3,
  labelOf = () => "Region",
  onSelect = () => {
  },
  onOpenSidebar = () => {
  },
  debug = false,
  raf,
  caf,
  now = () => Date.now(),
  clock = () => typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now()
}) {
  const view2 = doc.defaultView;
  const requestFrame = raf ?? ((cb) => typeof view2?.requestAnimationFrame === "function" ? view2.requestAnimationFrame(cb) : setTimeout(cb, 16));
  const cancelFrame = caf ?? ((id) => typeof view2?.cancelAnimationFrame === "function" ? view2.cancelAnimationFrame(id) : clearTimeout(id));
  const debugOn = () => typeof debug === "function" ? !!debug() : !!debug;
  const warn5 = (message, error) => console.warn("[plexus]", message, error);
  let root = null;
  let stage = null;
  let svg = null;
  let rootKey = "";
  let stageKey = "";
  let svgKey = "";
  let lastZoom = NaN;
  let chipsDirty = true;
  let items = /* @__PURE__ */ new Map();
  let regions = [];
  let regionsAt = -Infinity;
  let regionSig = "";
  let sceneSig = null;
  let unsubscribe2 = null;
  let pendingFrame = null;
  let coverHidden = false;
  let dark = null;
  let capLogged = false;
  let samples = [];
  let disposed = false;
  const isVisible = () => root != null;
  const resolveBlock = (uid) => host?.labelSource?.(uid)?.string ?? "";
  function fetchRegions() {
    try {
      regions = host.regionsOf(drawingUid) ?? [];
    } catch (error) {
      warn5("regions layer regions failed", error);
      regions = [];
    }
    regionsAt = now();
    const sig = regions.map((r) => `${r.uid}\0${r.string}`).join("");
    const changed = sig !== regionSig;
    regionSig = sig;
    return changed;
  }
  function sceneSignature() {
    const nonce3 = app.scene?.getSceneNonce?.();
    if (nonce3 != null) return `n${nonce3}`;
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
    try {
      text = plainCaption(region.caption, resolveBlock);
    } catch {
      text = "";
    }
    if (!text) text = `${KIND_WORDS[region.kind] ?? "region"} ${index + 1}`;
    return cutChip(text);
  }
  function labelFor(entry) {
    try {
      return String(labelOf(entry.region, entry.uid) ?? "");
    } catch {
      return "";
    }
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
        if (e?.shiftKey) onOpenSidebar(uid);
        else onSelect(uid);
      } catch (error) {
        warn5("regions layer chip failed", error);
      }
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
      uid,
      outline,
      chip,
      bbox: null,
      text: null,
      label: null,
      rectKey: "",
      chipPos: "",
      chipFlip: null,
      detach() {
        chip.removeEventListener("mousedown", onMouseDown);
        chip.removeEventListener("pointerdown", onPointerDown);
        chip.removeEventListener("click", activate);
        chip.removeEventListener("keydown", onKeyDown);
        outline.remove();
        chip.remove();
      }
    };
  }
  function collect() {
    const elements = app.getSceneElementsIncludingDeleted?.() ?? [];
    const appState = app.state;
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
      if (!capLogged) {
        capLogged = true;
        console.warn(`[plexus] regions layer: more than ${REGION_LAYER_CAP} regions, extra outlines are not drawn`);
      }
    }
    const keep = /* @__PURE__ */ new Set();
    for (const { entry, index } of drawn) {
      let out;
      try {
        out = regionSceneBBox(entry.region, live, appState, sceneIndex);
      } catch (error) {
        warn5("regions layer bbox failed", error);
        continue;
      }
      if (!out?.bbox) continue;
      keep.add(entry.uid);
      let item = items.get(entry.uid);
      if (!item) {
        item = makeItem(entry.uid);
        items.set(entry.uid, item);
      }
      item.bbox = out.bbox;
      const text = chipTextOf(entry.region, index);
      if (item.text !== text) {
        item.text = text;
        item.chip.textContent = text;
      }
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
  }
  function syncOutlines() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const item of items.values()) {
      const [x1, y1, x2, y2] = item.bbox;
      if (x1 < minX) minX = x1;
      if (y1 < minY) minY = y1;
      if (x2 > maxX) maxX = x2;
      if (y2 > maxY) maxY = y2;
    }
    if (!(minX <= maxX)) {
      minX = 0;
      minY = 0;
      maxX = 0;
      maxY = 0;
    }
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
    const key = clipped ? `${box.left}|${box.top}|${Math.max(0, box.right - box.left)}|${Math.max(0, box.bottom - box.top)}` : "open";
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
    if (now() - regionsAt > REGION_REFETCH_MS2 && fetchRegions()) changed = true;
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
      try {
        update();
      } catch (error) {
        warn5("regions layer update failed", error);
      }
    });
  }
  function refresh() {
    if (disposed || !isVisible()) return;
    try {
      fetchRegions();
      sceneSig = null;
      update();
    } catch (error) {
      warn5("regions layer refresh failed", error);
    }
  }
  function show() {
    if (disposed || !drawingUid) return;
    if (isVisible()) {
      refresh();
      return;
    }
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
    rootKey = "";
    stageKey = "";
    svgKey = "";
    lastZoom = NaN;
    chipsDirty = true;
    dark = null;
    coverHidden = false;
    capLogged = false;
    samples = [];
    try {
      unsubscribe2 = native.subscribeViewport(app, schedule);
    } catch (error) {
      warn5("regions layer subscribe failed", error);
    }
    refresh();
  }
  function hide() {
    if (pendingFrame != null) {
      cancelFrame(pendingFrame);
      pendingFrame = null;
    }
    try {
      unsubscribe2?.();
    } catch (error) {
      warn5("regions layer unsubscribe failed", error);
    }
    unsubscribe2 = null;
    for (const item of items.values()) item.detach();
    items = /* @__PURE__ */ new Map();
    if (root) {
      root.remove();
      root = null;
    }
    stage = null;
    svg = null;
    sceneSig = null;
    regionSig = "";
    regionsAt = -Infinity;
  }
  function toggle() {
    if (isVisible()) hide();
    else show();
    return isVisible();
  }
  function dispose() {
    if (disposed) return;
    hide();
    disposed = true;
  }
  return { show, hide, toggle, visible: isVisible, refresh, dispose };
}

// src/view/landing.js
var ROUTE = /^#\/(app|offline)\/([^/]+)\/page\/([^/?#]+)$/;
var FRESH_LOAD_MS = 3e4;
var SETTLE_TRIES = 30;
var SETTLE_STEP_MS = 100;
function installRegionLanding({ doc, win = doc?.defaultView, api, host, getSettings = () => ({}), openRegion } = {}) {
  let disposed = false;
  let lastHash = null;
  let navType = null;
  let seq = 0;
  const enabled = () => {
    try {
      return !!getSettings()?.regionLanding;
    } catch {
      return false;
    }
  };
  const graphName = () => {
    try {
      return api?.graph?.name ?? null;
    } catch {
      return null;
    }
  };
  const frame = () => new Promise((resolve) => {
    const raf = win?.requestAnimationFrame;
    if (typeof raf === "function") raf.call(win, () => resolve());
    else setTimeout(resolve, 16);
  });
  const settled = async (uid) => {
    const current2 = api?.ui?.mainWindow?.getOpenPageOrBlockUid;
    if (typeof current2 !== "function") return true;
    for (let i = 0; i < SETTLE_TRIES; i++) {
      let open4 = null;
      try {
        open4 = await current2.call(api.ui.mainWindow);
      } catch {
        open4 = null;
      }
      if (disposed) return false;
      if (open4 === uid) {
        await frame();
        await frame();
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, SETTLE_STEP_MS));
    }
    return false;
  };
  const consider = async (hash) => {
    if (disposed || !hash || hash === lastHash) return;
    lastHash = hash;
    if (!enabled()) return;
    const m = ROUTE.exec(hash);
    if (!m) return;
    let graph = m[2];
    try {
      graph = decodeURIComponent(graph);
    } catch {
    }
    const name = graphName();
    if (!name || graph !== name) return;
    const uid = m[3];
    const mine = ++seq;
    try {
      const block = await host.pullBlock(uid);
      if (disposed || mine !== seq || !parseRegion(block?.string ?? "")?.supported) return;
      if (!await settled(uid) || disposed || mine !== seq || (win?.location?.hash ?? "") !== hash) return;
      if (activeEditor(doc)) return;
      await openRegion(uid);
    } catch (error) {
      console.warn("[plexus] region landing failed", error);
    }
  };
  const nav = win?.navigation;
  const hasNav = typeof nav?.addEventListener === "function";
  const onNavigate = (e) => {
    navType = e?.navigationType ?? null;
  };
  const onHashChange = () => {
    const type = navType;
    navType = null;
    const hash = win?.location?.hash ?? "";
    if (!hasNav || type !== "push" && type !== "replace") {
      lastHash = hash;
      return;
    }
    consider(hash);
  };
  if (hasNav) nav.addEventListener("navigate", onNavigate);
  win?.addEventListener?.("hashchange", onHashChange);
  let fresh2 = false;
  try {
    fresh2 = (win?.performance?.now?.() ?? Infinity) < FRESH_LOAD_MS;
  } catch {
    fresh2 = false;
  }
  if (fresh2) consider(win?.location?.hash ?? "");
  else lastHash = win?.location?.hash ?? null;
  return function dispose() {
    if (disposed) return;
    disposed = true;
    if (hasNav) nav.removeEventListener?.("navigate", onNavigate);
    win?.removeEventListener?.("hashchange", onHashChange);
  };
}

// src/view/audit-dialog.js
var STOP_EVENTS = ["keydown", "keyup", "keypress", "input", "paste", "copy", "cut", "mousedown", "pointerdown", "wheel", "click"];
var MAX_ROWS = 500;
var PROBLEM_TEXT = {
  unsupported: "Unsupported region string",
  "no-owner": "No drawing named in the region",
  partial: "Some elements are missing",
  "no-elements": "The region's elements are gone",
  "outside-crop": "Outside the image crop",
  "not-image": "The element is not an image",
  rotated: "The image is rotated",
  "not-frame": "The element is not a frame",
  "no-image": "The image is missing",
  "outside-container": "Not under a region container",
  "owner-mismatch": "Names a different drawing than its container",
  "two-containers": "More than one region container",
  "orphan-container": "Region container without a drawing"
};
var VIA_REGION = /* @__PURE__ */ new Set(["partial", "no-elements", "outside-crop", "not-image", "rotated", "not-frame", "no-image", "outside-container", "owner-mismatch"]);
function auditOpenTarget(row) {
  if (row?.kind === "container") return { via: "block", uid: row.drawingUid ?? row.uid };
  if (VIA_REGION.has(row?.problem) && row?.uid) return { via: "region", uid: row.uid };
  return { via: "block", uid: row?.uid };
}
function openAuditDialog({ doc, rows = [], onOpen = () => {
}, onRepair = () => {
}, onClose = () => {
}, dark = false } = {}) {
  const statuses = /* @__PURE__ */ new Map();
  let current2 = Array.isArray(rows) ? rows : [];
  let closed = false;
  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  };
  const warn5 = (what) => (error) => console.warn(`[plexus] audit dialog ${what} failed`, error);
  const run = (what, fn) => {
    try {
      const out = fn();
      if (out && typeof out.catch === "function") out.catch(warn5(what));
      return out;
    } catch (error) {
      warn5(what)(error);
      return void 0;
    }
  };
  const button = (label, handler) => {
    const b = el("button", "plexus-toolbar-button", label);
    b.type = "button";
    b.addEventListener("click", (e) => {
      e?.stopPropagation?.();
      run(label, handler);
    });
    return b;
  };
  const d = el("dialog", `plexus-portal plexus-legacy plexus-audit${dark ? " plexus-audit--dark" : ""}`);
  const summary = el("div", "plexus-legacy-summary");
  const list = el("div", "plexus-legacy-rows plexus-audit-rows");
  const stop = (e) => e?.stopPropagation?.();
  for (const type of STOP_EVENTS) d.addEventListener(type, stop);
  const close2 = () => {
    if (closed) return;
    closed = true;
    for (const type of STOP_EVENTS) d.removeEventListener?.(type, stop);
    d.removeEventListener?.("cancel", close2);
    d.removeEventListener?.("close", close2);
    try {
      if (typeof d.close === "function") d.close();
    } catch (error) {
      console.warn("[plexus] audit dialog close failed", error);
    }
    d.remove?.();
    run("onClose", () => onClose());
  };
  const rowNode = (row) => {
    const node = el("div", "plexus-legacy-row plexus-audit-row");
    const status = el("span", "plexus-audit-status", statuses.get(row.uid) ?? "");
    node.append(
      el("span", "plexus-audit-label", row.label || row.uid),
      el("span", "plexus-audit-problem", PROBLEM_TEXT[row.problem] ?? row.problem ?? "")
    );
    if (row.detail) node.append(el("span", "plexus-legacy-uid plexus-audit-detail", row.detail));
    node.append(button("Open", () => {
      close2();
      return onOpen(row);
    }));
    if (row.repair) {
      node.append(button("Repair", async () => {
        const result = await onRepair(row);
        if (row.repair === "reselect" || result?.reason === "reselect") {
          close2();
          return;
        }
        const text = result === true || result?.fixed ? "Fixed" : `Not fixed${result?.reason ? `: ${result.reason}` : ""}`;
        statuses.set(row.uid, text);
        status.textContent = text;
      }));
    }
    node.append(status);
    return node;
  };
  const render = () => {
    const shown = current2.slice(0, MAX_ROWS);
    summary.textContent = current2.length ? `${current2.length} problem${current2.length === 1 ? "" : "s"}` : "No problems found";
    if (current2.truncated) summary.textContent += " (scan stopped at 2000 rows; some regions were not checked)";
    const nodes = [];
    const pages = /* @__PURE__ */ new Map();
    for (const row of shown) {
      const page = row.pageTitle || "(no page)";
      if (!pages.has(page)) pages.set(page, /* @__PURE__ */ new Map());
      const drawings = pages.get(page);
      const key = row.drawingUid || "";
      if (!drawings.has(key)) drawings.set(key, []);
      drawings.get(key).push(row);
    }
    for (const [page, drawings] of pages) {
      nodes.push(el("div", "plexus-audit-page", page));
      for (const [uid, group] of drawings) {
        if (uid) nodes.push(el("div", "plexus-legacy-uid plexus-audit-drawing", `Drawing ${uid}`));
        for (const row of group) nodes.push(rowNode(row));
      }
    }
    if (current2.length > MAX_ROWS) nodes.push(el("div", "plexus-legacy-uid", `+${current2.length - MAX_ROWS} more`));
    if (typeof list.replaceChildren === "function") list.replaceChildren(...nodes);
    else {
      list.textContent = "";
      list.append(...nodes);
    }
  };
  const actions = el("div", "plexus-legacy-actions");
  actions.append(
    button("Copy report", () => {
      const json = JSON.stringify(current2, null, 2);
      const clipboard = doc.defaultView?.navigator?.clipboard;
      return withClipboard(() => clipboard.writeText(json));
    }),
    button("Close", close2)
  );
  d.append(el("div", "plexus-legacy-title", "Region audit"), summary, list, actions);
  d.addEventListener("cancel", close2);
  d.addEventListener("close", close2);
  render();
  doc.body.append(d);
  if (typeof d.showModal === "function") d.showModal();
  else d.setAttribute?.("open", "");
  return {
    close: close2,
    update(next) {
      if (closed) return;
      current2 = Array.isArray(next) ? next : [];
      render();
    }
  };
}

// src/host/measure.js
var MEMO_CAP = 2e3;
var fontString = (size) => `${size}px Excalifont, Xiaolai, sans-serif, Segoe UI Emoji`;
function createMeasurer({ doc = globalThis.document } = {}) {
  const memo3 = /* @__PURE__ */ new Map();
  let ctx = null;
  function context() {
    if (ctx) return ctx;
    try {
      ctx = doc?.createElement?.("canvas")?.getContext?.("2d") || null;
    } catch {
      ctx = null;
    }
    return ctx;
  }
  function measure2(text, fontSize) {
    const str = String(text ?? "");
    const font = fontString(fontSize);
    const key = `${font}|${str}`;
    if (memo3.has(key)) {
      const hit = memo3.get(key);
      memo3.delete(key);
      memo3.set(key, hit);
      return hit;
    }
    const c = context();
    let width;
    if (c) {
      c.font = font;
      width = c.measureText(str).width;
    } else {
      width = str.length * fontSize * 0.6;
    }
    memo3.set(key, width);
    if (memo3.size > MEMO_CAP) memo3.delete(memo3.keys().next().value);
    return width;
  }
  async function ensureFonts(texts, fontSize = 20) {
    const fonts = doc?.fonts;
    if (!fonts || typeof fonts.load !== "function") return false;
    try {
      const font = fontString(fontSize);
      const text = (texts || []).join("");
      const wasLoaded = typeof fonts.check === "function" ? fonts.check(font, text) : false;
      const loaded = await fonts.load(font, text);
      if (!wasLoaded && loaded && loaded.length) {
        memo3.clear();
        return true;
      }
    } catch (error) {
      console.warn("[plexus] font load failed", error);
    }
    return false;
  }
  return { measure: measure2, ensureFonts, clear: () => memo3.clear(), size: () => memo3.size };
}

// src/model/edn.js
var MAX_DEPTH = 512;
var NUMBER_RE = /^[+-]?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
var NUMERIC_START_RE = /^[+-]?\d/;
var HEX4_RE = /^[0-9a-fA-F]{4}$/;
var CLOSERS = { "[": "]", "(": ")", "{": "}", "#{": "}" };
function fail(message, position) {
  const e = new SyntaxError(`${message} at ${position}`);
  e.position = position;
  return e;
}
function isWs(c) {
  return c === 32 || c === 44 || c === 10 || c === 9 || c === 13 || c === 12 || c === 11;
}
function isDelim(c) {
  return isWs(c) || c === 40 || c === 41 || c === 91 || c === 93 || c === 123 || c === 125 || c === 34 || c === 59;
}
function skipWs(text, pos) {
  const n = text.length;
  while (pos < n) {
    const c = text.charCodeAt(pos);
    if (isWs(c)) pos++;
    else if (c === 59) {
      while (pos < n && text.charCodeAt(pos) !== 10) pos++;
    } else break;
  }
  return pos;
}
function readToken(text, pos) {
  let end = pos;
  while (end < text.length && !isDelim(text.charCodeAt(end))) end++;
  return end;
}
function readString(text, start) {
  const n = text.length;
  let pos = start + 1;
  let out = "";
  let chunk = pos;
  while (pos < n) {
    const c = text[pos];
    if (c === '"') return { value: out + text.slice(chunk, pos), end: pos + 1 };
    if (c === "\\") {
      out += text.slice(chunk, pos);
      const e = text[pos + 1];
      switch (e) {
        case '"':
          out += '"';
          break;
        case "\\":
          out += "\\";
          break;
        case "n":
          out += "\n";
          break;
        case "t":
          out += "	";
          break;
        case "r":
          out += "\r";
          break;
        case "b":
          out += "\b";
          break;
        case "f":
          out += "\f";
          break;
        case "u": {
          const hex = text.slice(pos + 2, pos + 6);
          if (!HEX4_RE.test(hex)) throw fail("Bad \\u escape", pos);
          out += String.fromCharCode(parseInt(hex, 16));
          pos += 4;
          break;
        }
        default:
          throw fail("Bad escape", pos);
      }
      pos += 2;
      chunk = pos;
      continue;
    }
    pos++;
  }
  throw fail("Unterminated string", start);
}
function atom(token, start) {
  if (token === "nil") return null;
  if (token === "true") return true;
  if (token === "false") return false;
  if (token.charCodeAt(0) === 58) {
    if (token.length === 1) throw fail("Empty keyword", start);
    return token.slice(1);
  }
  if (NUMBER_RE.test(token)) return Number(token);
  if (NUMERIC_START_RE.test(token)) throw fail(`Invalid number "${token}"`, start);
  if (token === "NaN") return NaN;
  if (token === "Infinity") return Infinity;
  if (token === "-Infinity") return -Infinity;
  return token;
}
function finishMap(items, opener) {
  if (items.length % 2 !== 0) throw fail("Odd number of forms in map", opener);
  const obj = {};
  for (let i = 0; i < items.length; i += 2) {
    const k = items[i];
    if (k !== null && typeof k === "object") throw fail("Collection used as map key", opener);
    Object.defineProperty(obj, String(k), { value: items[i + 1], enumerable: true, writable: true, configurable: true });
  }
  return obj;
}
function readEdn(text, start = 0) {
  if (typeof text !== "string") throw fail("EDN input must be a string", 0);
  const n = text.length;
  const stack = [];
  let pos = start;
  const push = (frame) => {
    if (stack.length >= MAX_DEPTH) throw fail("Nesting too deep", frame.opener);
    stack.push(frame);
  };
  const deliver = (value) => {
    for (; ; ) {
      const top = stack[stack.length - 1];
      if (!top) {
        result = value;
        return true;
      }
      if (top.kind === "discard") {
        stack.pop();
        return false;
      }
      if (top.kind === "tag") {
        stack.pop();
        continue;
      }
      top.items.push(value);
      return false;
    }
  };
  let result;
  for (; ; ) {
    pos = skipWs(text, pos);
    if (pos >= n) {
      const top = stack[stack.length - 1];
      if (!top) throw fail("Unexpected end of input", pos);
      throw fail(top.kind === "discard" ? "Discard without a form" : top.kind === "tag" ? "Tag without a form" : top.kind === "map" ? "Unterminated map" : top.kind === "set" ? "Unterminated set" : "Unterminated collection", top.opener);
    }
    const ch = text[pos];
    if (ch === ")" || ch === "]" || ch === "}") {
      const top = stack[stack.length - 1];
      if (!top || top.close !== ch) throw fail(`Unexpected "${ch}"`, pos);
      stack.pop();
      pos++;
      const value = top.kind === "map" ? finishMap(top.items, top.opener) : top.items;
      if (deliver(value)) return { value: result, end: pos };
      continue;
    }
    if (ch === "[" || ch === "(") {
      push({ kind: "vec", close: CLOSERS[ch], items: [], opener: pos });
      pos++;
      continue;
    }
    if (ch === "{") {
      push({ kind: "map", close: "}", items: [], opener: pos });
      pos++;
      continue;
    }
    if (ch === '"') {
      const s = readString(text, pos);
      pos = s.end;
      if (deliver(s.value)) return { value: result, end: pos };
      continue;
    }
    if (ch === "#") {
      const next = text[pos + 1];
      if (next === "{") {
        push({ kind: "set", close: "}", items: [], opener: pos });
        pos += 2;
        continue;
      }
      if (next === "_") {
        push({ kind: "discard", opener: pos });
        pos += 2;
        continue;
      }
      if (next === "#") {
        const end3 = readToken(text, pos + 2);
        const name2 = text.slice(pos + 2, end3);
        const v2 = name2 === "NaN" ? NaN : name2 === "Inf" ? Infinity : name2 === "-Inf" ? -Infinity : void 0;
        if (v2 === void 0) throw fail(`Unknown special value "##${name2}"`, pos);
        pos = end3;
        if (deliver(v2)) return { value: result, end: pos };
        continue;
      }
      const end2 = readToken(text, pos + 1);
      const name = text.slice(pos + 1, end2);
      if (!/^[A-Za-z][^\s]*$/.test(name)) throw fail("Invalid # dispatch", pos);
      push({ kind: "tag", opener: pos });
      pos = end2;
      continue;
    }
    const end = readToken(text, pos);
    const v = atom(text.slice(pos, end), pos);
    pos = end;
    if (deliver(v)) return { value: result, end: pos };
  }
}

// src/model/legacy.js
var MACRO_RE = /^\{\{\s*(?:\[\[roam\/render\]\]|roam\/render)\s*:\s*\(\(ExcalDATA\)\)\s*/;
var START_RE = /^\{\{\s*(?:\[\[roam\/render\]\]|roam\/render)\s*:\s*\(\(ExcalDATA\)\)\s*(?:\{|\}\})/;
var COMPONENT_PAGE = "roam/excalidraw";
var LINEAR = /* @__PURE__ */ new Set(["line", "arrow", "draw", "freedraw"]);
var LINK_RE = /(?<!\S)#\[\[[^\[\]]+\]\]|\[\[[^\[\]]+\]\]|\(\([A-Za-z0-9_-]{9}\)\)|(?<!\S)#[^\s\[\]()\{\},;:!?"'`#]+/g;
var encoder2 = new TextEncoder();
var LEGACY_QUERY = '[:find ?u ?s ?t :where [?b :block/string ?s] [(clojure.string/includes? ?s "((ExcalDATA))")] [?b :block/uid ?u] [?b :block/page ?p] [?p :node/title ?t]]';
var cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
var isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
var finite = (v) => typeof v === "number" && Number.isFinite(v);
function rowsFromQuery(results) {
  const out = [];
  for (const r of Array.isArray(results) ? results : []) {
    if (Array.isArray(r) && typeof r[0] === "string" && typeof r[1] === "string") {
      out.push({ uid: r[0], string: r[1], page: typeof r[2] === "string" ? r[2] : "" });
    }
  }
  return out;
}
var normRow = (r) => Array.isArray(r) ? { uid: r[0], string: r[1], page: r[2] ?? "" } : r;
function mentionsExcalData(s) {
  return typeof s === "string" && s.includes("((ExcalDATA))");
}
function isLegacyDrawingString(s) {
  return typeof s === "string" && START_RE.test(s.trim());
}
function parseLegacyDrawing(s) {
  if (!isLegacyDrawingString(s)) return { error: "not a legacy drawing" };
  const t = s.trim();
  const at = MACRO_RE.exec(t)[0].length;
  if (t.startsWith("}}", at)) {
    const out2 = { elements: [], appState: null, version: null };
    if (t.slice(at + 2).trim()) out2.trailing = true;
    return out2;
  }
  let read;
  try {
    read = readEdn(t, at);
  } catch (e) {
    if (e instanceof SyntaxError) return { error: `invalid EDN: ${e.message}` };
    throw e;
  }
  let pos = read.end;
  while (pos < t.length && /\s/.test(t[pos])) pos++;
  if (!t.startsWith("}}", pos)) return { error: "unterminated macro" };
  const map = read.value;
  if (!isObj(map) || !Array.isArray(map.elements)) return { error: "no elements" };
  const out = {
    elements: map.elements.filter((el) => !(isObj(el) && el.isDeleted === true)),
    appState: isObj(map.appState) ? map.appState : null,
    version: isObj(map.roamExcalidraw) && map.roamExcalidraw.version !== void 0 ? map.roamExcalidraw.version : null
  };
  if (t.slice(pos + 2).trim()) out.trailing = true;
  return out;
}
function coercePoints(points) {
  if (!Array.isArray(points)) return null;
  const out = [];
  for (const p of points) {
    if (!Array.isArray(p) || p.length < 2 || !finite(p[0]) || !finite(p[1])) return null;
    out.push([p[0], p[1]]);
  }
  return out;
}
function legacyToElements(ednElements, { migratedFrom } = {}) {
  const elements = [];
  let invalid = 0;
  let invisible2 = 0;
  for (const src of Array.isArray(ednElements) ? ednElements : []) {
    if (isObj(src) && src.isDeleted === true) continue;
    if (!isObj(src) || typeof src.type !== "string" || !finite(src.x) || !finite(src.y) || !finite(src.width) || !finite(src.height) || src.angle !== void 0 && src.angle !== null && !finite(src.angle)) {
      invalid++;
      continue;
    }
    let points;
    if (src.points !== void 0 && src.points !== null) {
      points = coercePoints(src.points);
      if (!points) {
        invalid++;
        continue;
      }
    }
    const linear = LINEAR.has(src.type);
    if (linear && (!points || points.length < 2) || !linear && src.type !== "text" && src.width === 0 && src.height === 0 || src.type === "text" && (typeof src.text !== "string" || src.text === "")) {
      invisible2++;
      continue;
    }
    const el = structuredClone(src);
    if (points) el.points = points;
    if (el.version === null) delete el.version;
    if (el.versionNonce === null) delete el.versionNonce;
    if (migratedFrom !== void 0) el.customData = mergePlexusData(el.customData, { migratedFrom });
    elements.push(el);
  }
  return { elements, invalid, invisible: invisible2 };
}
function extractLinks(elements) {
  const set = /* @__PURE__ */ new Set();
  for (const el of elements) {
    if (el.type !== "text" || typeof el.text !== "string") continue;
    for (const m of el.text.matchAll(LINK_RE)) {
      const tok = m[0].startsWith("#") && !m[0].startsWith("#[[") ? m[0].replace(/\.+$/, "") : m[0];
      if (tok.length > 1) set.add(tok);
    }
  }
  return [...set].sort(cmp);
}
function isDrawingRow(r) {
  return !!r && r.page !== COMPONENT_PAGE && isLegacyDrawingString(r.string);
}
function legacyReport(rows) {
  const out = [];
  for (const raw of Array.isArray(rows) ? rows : []) {
    const r = normRow(raw);
    if (!isDrawingRow(r)) continue;
    const row = {
      uid: r.uid,
      page: r.page ?? "",
      elementCount: 0,
      types: {},
      empty: true,
      bytes: encoder2.encode(r.string).length,
      invalid: 0,
      invisible: 0,
      links: [],
      macroText: 0,
      trailing: false
    };
    const parsed = parseLegacyDrawing(r.string);
    if (parsed.error) {
      row.error = parsed.error;
      out.push(row);
      continue;
    }
    const conv = legacyToElements(parsed.elements);
    const types = {};
    for (const el of conv.elements) types[el.type] = (types[el.type] || 0) + 1;
    row.elementCount = conv.elements.length;
    row.types = Object.fromEntries(Object.keys(types).sort(cmp).map((k) => [k, types[k]]));
    row.empty = conv.elements.length === 0;
    row.invalid = conv.invalid;
    row.invisible = conv.invisible;
    row.links = extractLinks(conv.elements);
    row.macroText = conv.elements.filter((el) => el.type === "text" && /\{\{|\}\}/.test(el.text)).length;
    row.trailing = parsed.trailing === true;
    out.push(row);
  }
  return out.sort((a, b) => cmp(a.page, b.page) || cmp(a.uid, b.uid));
}
function legacySummary(queryRows) {
  const rows = (Array.isArray(queryRows) ? queryRows : []).map(normRow).filter((r) => r && mentionsExcalData(r.string));
  const excluded = [];
  const drawings = [];
  for (const r of rows) {
    if (r.page === COMPONENT_PAGE) excluded.push({ uid: r.uid, page: r.page, reason: "component-code" });
    else if (!isLegacyDrawingString(r.string)) excluded.push({ uid: r.uid, page: r.page ?? "", reason: "not-a-drawing" });
    else drawings.push(r);
  }
  excluded.sort((a, b) => cmp(a.page, b.page) || cmp(a.uid, b.uid));
  return {
    mentions: rows.length,
    excluded,
    drawings: drawings.length,
    empty: legacyReport(drawings).filter((r) => r.empty).length
  };
}

// src/model/slides.js
var collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
var orderOf = (el) => {
  const o = el?.customData?.plexus?.order;
  return typeof o === "number" && Number.isFinite(o) ? o : null;
};
function orderFrames(elements) {
  const frames = liveElements(elements).filter((el) => el.type === "frame" || el.type === "magicframe");
  return frames.sort((a, b) => {
    const oa = orderOf(a), ob = orderOf(b);
    if (oa !== null && ob !== null) {
      if (oa !== ob) return oa - ob;
    } else if (oa !== null) return -1;
    else if (ob !== null) return 1;
    const n = collator.compare(String(a.name ?? ""), String(b.name ?? ""));
    if (n) return n;
    return (Number(a.y) || 0) - (Number(b.y) || 0) || (Number(a.x) || 0) - (Number(b.x) || 0);
  });
}

// src/model/caption.js
var MAX_CAPTION = 200;
var UID_RE2 = /^[A-Za-z0-9_-]+$/;
function cleanText(text) {
  return String(text ?? "").replace(/[{}`]/g, "").replace(/\s+/g, " ").trim();
}
function refFromLink(value) {
  const parsed = parseRoamLink(value);
  if (!parsed) return null;
  if (parsed.type === "block" && parsed.uid) return `((${parsed.uid}))`;
  if (parsed.type === "page" && parsed.title) return `[[${parsed.title}]]`;
  return null;
}
function sourceRefOf(el) {
  const plexus = el?.customData?.plexus;
  const uid = plexus?.mm?.uid;
  if (typeof uid === "string" && UID_RE2.test(uid)) return `((${uid}))`;
  return refFromLink(plexus?.embed) || refFromLink(el?.link);
}
var SEP = " · ";
var WORD_BUDGET = 60;
var ARROW_ONLY = /^[\s→←↑↓↔⇒⇐⇔↗↘↙↖>=<-]*$/u;
var NUMERIC_ONLY = /^[\s\d\p{P}\p{S}]*$/u;
var lengthOf = (text) => [...text].length;
function firstSentence(text) {
  const m = /[.?!](?=\s)/.exec(text);
  return m ? text.slice(0, m.index + 1) : text;
}
function boxOf(el) {
  const h = Number(el?.height) || 0;
  return { x: Number(el?.x) || 0, yc: (Number(el?.y) || 0) + h / 2, h };
}
function visualOrder(parts) {
  if (parts.length < 2) return parts;
  const heights = parts.map((p) => p.box.h).sort((a, b) => a - b);
  const half = heights[Math.floor(heights.length / 2)] / 2;
  const sorted = [...parts].sort((a, b) => a.box.yc - b.box.yc || a.seq - b.seq);
  const rows = [];
  for (const part of sorted) {
    const row = rows[rows.length - 1];
    if (row && part.box.yc - row[0].box.yc <= half) row.push(part);
    else rows.push([part]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.box.x - b.box.x || a.seq - b.seq));
}
function cutWords(text, room, hard) {
  if (lengthOf(text) <= room) return text;
  const head = [...text].slice(0, room).join("");
  const next = [...text][room];
  if (next === " ") return head.trim();
  const space = head.lastIndexOf(" ");
  return space > 0 ? head.slice(0, space).trim() : hard ? head : "";
}
function captionRefsInfo(elements, ids, { frameName, words = true } = {}) {
  if (!Array.isArray(elements) || !ids) return { caption: "", hasRef: false };
  const wanted = new Set(Array.isArray(ids) ? ids : [...ids]);
  const byId = /* @__PURE__ */ new Map();
  for (const el of elements) if (el && el.id) byId.set(el.id, el);
  const refs = [];
  const bound = [];
  const free = [];
  const seenRefs = /* @__PURE__ */ new Set();
  let seq = 0;
  for (const el of elements) {
    if (!el || el.isDeleted) continue;
    const isText = el.type === "text";
    if (!wanted.has(el.id) && !(isText && el.containerId && wanted.has(el.containerId))) continue;
    const container = isText && el.containerId ? byId.get(el.containerId) : null;
    const live = container && !container.isDeleted ? container : null;
    const box = boxOf(live || el);
    const ref = live && sourceRefOf(live) || sourceRefOf(el);
    if (ref) {
      if (!seenRefs.has(ref)) {
        seenRefs.add(ref);
        refs.push({ value: ref, box, seq: seq++ });
      }
      continue;
    }
    if (!isText || !words) continue;
    const text = firstSentence(cleanText(el.originalText ?? el.text));
    if (text) (live ? bound : free).push({ value: text, box, seq: seq++ });
  }
  const name = words ? cleanText(frameName) : "";
  let wordParts;
  if (name) {
    wordParts = [{ value: name }];
  } else {
    const texts = [...visualOrder(bound), ...visualOrder(free)];
    const keep = texts.filter((p) => lengthOf(p.value) > 1 && !NUMERIC_ONLY.test(p.value) && !ARROW_ONLY.test(p.value));
    wordParts = keep.length ? keep : texts.filter((p) => NUMERIC_ONLY.test(p.value) && !ARROW_ONLY.test(p.value) && /\d/.test(p.value));
  }
  const parts = visualOrder(refs).map((p) => ({ value: p.value, isRef: true }));
  const seen = /* @__PURE__ */ new Set();
  let used = 0;
  for (const part of wordParts) {
    if (seen.has(part.value)) continue;
    seen.add(part.value);
    const size = lengthOf(part.value);
    if (used + size <= WORD_BUDGET) {
      parts.push({ value: part.value, isRef: false });
      used += size;
      continue;
    }
    const cutText = cutWords(part.value, WORD_BUDGET - used, used === 0);
    if (cutText) parts.push({ value: cutText, isRef: false });
    break;
  }
  let caption = "";
  for (const part of parts) {
    const next = caption ? `${caption}${SEP}${part.value}` : part.value;
    if (next.length <= MAX_CAPTION) {
      caption = next;
      continue;
    }
    if (!part.isRef) caption = next.slice(0, MAX_CAPTION).trim();
    break;
  }
  return { caption, hasRef: parts.some((p) => p.isRef) };
}
var captionRefsFromElements = (elements, ids, opts) => captionRefsInfo(elements, ids, opts).caption;

// src/view/image-region-tool.js
var LASSO_STEP_PX = 4;
var PIN_SLOP_PX = 4;
var LINGER_MS = 50;
var SVG_NS2 = "http://www.w3.org/2000/svg";
function startImageRegionTool({ app, element, doc, imageRect: fixedRect, setTimeout: setT = (...a) => globalThis.setTimeout(...a), clearTimeout: clearT = (...a) => globalThis.clearTimeout(...a) }) {
  let cancel = null;
  const promise = new Promise((resolve) => {
    if (!fixedRect && element?.angle) return resolve(null);
    const imageRect = fixedRect || viewportRectOf(app, elementBounds(element));
    const overlay = doc.createElement("div");
    overlay.className = "plexus-portal plexus-image-tool";
    overlay.style.left = `${imageRect.left}px`;
    overlay.style.top = `${imageRect.top}px`;
    overlay.style.width = `${imageRect.width}px`;
    overlay.style.height = `${imageRect.height}px`;
    const marquee = doc.createElement("div");
    marquee.className = "plexus-marquee";
    marquee.hidden = true;
    overlay.append(marquee);
    let lassoPath = null;
    if (doc.createElementNS) {
      const svg = doc.createElementNS(SVG_NS2, "svg");
      svg.setAttribute("class", "plexus-lasso");
      lassoPath = doc.createElementNS(SVG_NS2, "path");
      svg.append(lassoPath);
      overlay.append(svg);
    }
    doc.body.append(overlay);
    let lasso = null;
    let start = null;
    let drag = null;
    let moved = 0;
    let finished = false;
    let lingerTimer = null;
    const removeOverlay = () => {
      if (lingerTimer != null) {
        clearT(lingerTimer);
        lingerTimer = null;
      }
      overlay.removeEventListener("click", onTrailingClick);
      overlay.remove();
    };
    const onTrailingClick = () => removeOverlay();
    const finish = (value, { linger = false } = {}) => {
      if (finished) return;
      finished = true;
      doc.removeEventListener("keydown", onKey, true);
      doc.removeEventListener("pointerdown", onOutside, true);
      doc.removeEventListener("wheel", cancelOnMove, true);
      doc.removeEventListener("scroll", cancelOnMove, true);
      doc.defaultView?.removeEventListener?.("resize", cancelOnMove);
      if (linger && value) {
        overlay.addEventListener("click", onTrailingClick);
        lingerTimer = setT(removeOverlay, LINGER_MS);
      } else removeOverlay();
      resolve(value);
    };
    cancel = () => {
      finish(null);
      removeOverlay();
    };
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      finish(null);
    };
    const onOutside = (e) => {
      if (!overlay.contains(e.target)) finish(null);
    };
    const cancelOnMove = () => finish(null);
    const rectFrom = (a, b) => ({
      left: Math.min(a.x, b.x),
      top: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y)
    });
    overlay.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (e.button !== 0) return finish(null);
      if (finished) return;
      moved = 0;
      start = { x: e.clientX, y: e.clientY };
      drag = rectFrom(start, start);
      lasso = e.altKey ? [start] : null;
      overlay.setPointerCapture?.(e.pointerId);
    });
    overlay.addEventListener("pointermove", (e) => {
      e.stopPropagation();
      if (!start || finished) return;
      moved = Math.max(moved, Math.hypot(e.clientX - start.x, e.clientY - start.y));
      if (lasso) {
        const last = lasso[lasso.length - 1];
        if (Math.hypot(e.clientX - last.x, e.clientY - last.y) >= LASSO_STEP_PX) {
          lasso.push({ x: e.clientX, y: e.clientY });
          lassoPath?.setAttribute("d", `M${lasso.map((pt2) => `${pt2.x - imageRect.left},${pt2.y - imageRect.top}`).join(" L")}`);
        }
        return;
      }
      drag = rectFrom(start, { x: e.clientX, y: e.clientY });
      marquee.hidden = false;
      marquee.style.left = `${drag.left - imageRect.left}px`;
      marquee.style.top = `${drag.top - imageRect.top}px`;
      marquee.style.width = `${drag.width}px`;
      marquee.style.height = `${drag.height}px`;
    });
    overlay.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    overlay.addEventListener("pointerup", (e) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      if (!start || finished) return;
      const altKey = !!e.altKey;
      if (moved < PIN_SLOP_PX) {
        const x = Math.min(1, Math.max(0, (e.clientX - imageRect.left) / imageRect.width));
        const y = Math.min(1, Math.max(0, (e.clientY - imageRect.top) / imageRect.height));
        return finish({ kind: "pin", x, y }, { linger: true });
      }
      if (lasso) {
        const p = lassoToFraction(lasso, imageRect);
        return finish(p ? { kind: "lasso", p: p.p, altKey } : null, { linger: true });
      }
      const f = rectToFraction(drag, imageRect);
      finish(f ? { kind: "rect", f, altKey } : null, { linger: true });
    });
    const reset = () => {
      start = null;
      drag = null;
      lasso = null;
      lassoPath?.setAttribute("d", "");
      marquee.hidden = true;
    };
    overlay.addEventListener("pointercancel", reset);
    overlay.addEventListener("lostpointercapture", (e) => {
      if (start && e.buttons === 0 && !finished) reset();
    });
    for (const type of ["click", "mousedown", "mouseup"]) overlay.addEventListener(type, (e) => e.stopPropagation());
    doc.addEventListener("keydown", onKey, true);
    doc.addEventListener("pointerdown", onOutside, true);
    doc.addEventListener("wheel", cancelOnMove, true);
    doc.addEventListener("scroll", cancelOnMove, true);
    doc.defaultView?.addEventListener?.("resize", cancelOnMove);
  });
  promise.cancel = () => cancel?.();
  return promise;
}
function lassoToFraction(points, imageRect) {
  if (!Array.isArray(points) || points.length < 3 || !(imageRect?.width > 0) || !(imageRect?.height > 0)) return null;
  const xs = [];
  const ys = [];
  const p = [];
  for (const pt2 of points) {
    const x = Math.min(imageRect.left + imageRect.width, Math.max(imageRect.left, pt2.x));
    const y = Math.min(imageRect.top + imageRect.height, Math.max(imageRect.top, pt2.y));
    xs.push(x);
    ys.push(y);
    p.push((x - imageRect.left) / imageRect.width, (y - imageRect.top) / imageRect.height);
  }
  if (Math.max(...xs) - Math.min(...xs) < 4 || Math.max(...ys) - Math.min(...ys) < 4) return null;
  return { p };
}

// src/view/legacy-dialog.js
function createLegacyDialog({ doc, onMigrate = () => {
}, onCopy = () => {
} } = {}) {
  let dialog = null;
  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  };
  const button = (label, handler, disabled = false) => {
    const b = el("button", "plexus-toolbar-button", label);
    b.type = "button";
    b.disabled = disabled;
    b.addEventListener("click", (e) => {
      e.stopPropagation?.();
      try {
        const out = handler();
        if (out && typeof out.catch === "function") out.catch((error) => console.warn("[plexus] legacy dialog action failed", error));
      } catch (error) {
        console.warn("[plexus] legacy dialog action failed", error);
      }
    });
    return b;
  };
  const typesText = (types) => Object.entries(types || {}).map(([k, n]) => `${k} ${n}`).join(", ");
  const rowNode = (row) => {
    const node = el("div", "plexus-legacy-row");
    node.append(
      el("span", "plexus-legacy-page", row.page),
      el("span", "plexus-legacy-uid", row.uid),
      el("span", "plexus-legacy-count", row.error ? `error: ${row.error}` : `${row.elementCount} elements`),
      el("span", "plexus-legacy-types", typesText(row.types))
    );
    const flags = [];
    if (row.empty) flags.push("empty");
    if (row.invalid) flags.push(`${row.invalid} invalid`);
    if (row.invisible) flags.push(`${row.invisible} invisible`);
    if (row.macroText) flags.push(`${row.macroText} text with braces`);
    if (row.trailing) flags.push("trailing text");
    if (flags.length) node.append(el("span", "plexus-legacy-flags", flags.join(", ")));
    if (row.links?.length) node.append(el("span", "plexus-legacy-links", `links: ${row.links.join(" ")}`));
    node.append(button("Migrate", () => onMigrate(row.uid), !!row.empty || !!row.error));
    return node;
  };
  const close2 = () => {
    const d = dialog;
    if (!d) return;
    dialog = null;
    try {
      if (typeof d.close === "function") d.close();
    } catch (error) {
      console.warn("[plexus] legacy dialog close failed", error);
    }
    d.remove?.();
  };
  return {
    // A second call replaces the first: only one legacy dialog exists.
    show({ summary, rows }) {
      close2();
      const d = el("dialog", "plexus-portal plexus-legacy");
      const excluded = (summary?.excluded || []).map((x) => `${x.page}/${x.uid} (${x.reason})`).join("; ");
      d.append(
        el("div", "plexus-legacy-title", "Legacy drawings (dry run)"),
        el(
          "div",
          "plexus-legacy-summary",
          `${summary?.mentions ?? 0} mentions, ${summary?.drawings ?? 0} drawings, ${summary?.empty ?? 0} empty, ${summary?.excluded?.length ?? 0} excluded`
        )
      );
      if (excluded) d.append(el("div", "plexus-legacy-excluded", `Excluded: ${excluded}`));
      const list = el("div", "plexus-legacy-rows");
      for (const row of rows || []) list.append(rowNode(row));
      const actions = el("div", "plexus-legacy-actions");
      actions.append(button("Copy report", () => onCopy({ summary, rows })), button("Close", close2));
      d.append(list, actions);
      d.addEventListener("close", () => {
        if (dialog !== d) return;
        dialog = null;
        d.remove?.();
      });
      doc.body.append(d);
      dialog = d;
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute?.("open", "");
      return d;
    },
    close: close2,
    isOpen: () => !!dialog,
    dispose: close2
  };
}

// src/view/cleanup-dialog.js
function createCleanupDialog({ doc, onApply = () => {
}, onCopy = () => {
} } = {}) {
  let dialog = null;
  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  };
  const button = (label, handler, disabled = false) => {
    const b = el("button", "plexus-toolbar-button", label);
    b.type = "button";
    b.disabled = disabled;
    b.addEventListener("click", (e) => {
      e.stopPropagation?.();
      try {
        const out = handler();
        if (out && typeof out.catch === "function") out.catch((error) => console.warn("[plexus] cleanup dialog action failed", error));
      } catch (error) {
        console.warn("[plexus] cleanup dialog action failed", error);
      }
    });
    return b;
  };
  const rowNode = (row, skipped2) => {
    const node = el("div", "plexus-legacy-row");
    node.append(
      el("span", "plexus-legacy-uid", row.uid),
      el("span", "plexus-legacy-types", row.kind),
      el("span", "plexus-legacy-count", skipped2 ? `skipped: ${row.reason}` : `"${row.caption}" -> (empty)`)
    );
    return node;
  };
  const close2 = () => {
    const d = dialog;
    if (!d) return;
    dialog = null;
    try {
      if (typeof d.close === "function") d.close();
    } catch (error) {
      console.warn("[plexus] cleanup dialog close failed", error);
    }
    d.remove?.();
  };
  return {
    // A second call replaces the first: only one cleanup dialog exists.
    show({ report }) {
      close2();
      const candidates = report?.candidates || [];
      const skipped2 = report?.skipped || [];
      const d = el("dialog", "plexus-portal plexus-legacy plexus-cleanup");
      d.append(
        el("div", "plexus-legacy-title", "Placeholder captions (dry run)"),
        el("div", "plexus-legacy-summary", `${candidates.length} to clear, ${skipped2.length} skipped, ${report?.scanned ?? 0} regions scanned`)
      );
      const list = el("div", "plexus-legacy-rows");
      for (const row of candidates) list.append(rowNode(row, false));
      for (const row of skipped2) list.append(rowNode(row, true));
      const actions = el("div", "plexus-legacy-actions");
      actions.append(
        button("Copy report", () => onCopy(report)),
        button(`Apply ${candidates.length}`, () => onApply(report), candidates.length === 0),
        button("Close", close2)
      );
      d.append(list, actions);
      d.addEventListener("close", () => {
        if (dialog !== d) return;
        dialog = null;
        d.remove?.();
      });
      doc.body.append(d);
      dialog = d;
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute?.("open", "");
      return d;
    },
    close: close2,
    isOpen: () => !!dialog,
    dispose: close2
  };
}

// src/actions.js
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
var noop = () => {
};
var CAPTION_MODES2 = ["auto", "ask", "none"];
var PIN_SIZES2 = [4, 8, 12];
var WHOLE_IMAGE_AREA = 0.98;
var SVG_HREF_RE = /(?:xlink:)?href\s*=\s*["']([^"']*)["']/gi;
var REFS_RE = /\(\([\w-]+\)\)|\[\[[^\]]+\]\]/g;
var refTokens = (text) => new Set(String(text ?? "").match(REFS_RE) || []);
var REGION_HEAD_RE = /^\s*\{\{\[\[plexus-region\]\]:[^}]*\}\}/;
var WARM_KINDS = /* @__PURE__ */ new Set(["area", "group", "frame", "cframe"]);
var AUDIT_ROW_CAP = 2e3;
var AUDIT_YIELD_EVERY = 20;
var REPAIR_OF = { partial: "auto", "no-elements": "reselect", "outside-crop": "reselect", "not-image": "reselect", rotated: "reselect", "not-frame": "reselect" };
var BOX_PROBLEM = { "no-elements": "no-elements", "outside-crop": "outside-crop", "not-image": "not-image", "rotated-image": "rotated", "not-frame": "not-frame" };
function headPreservingString(before, tail) {
  const head = REGION_HEAD_RE.exec(before)?.[0];
  if (!head) return null;
  const text = String(tail ?? "").replace(/\s+/g, " ").trim();
  const next = text ? `${head} ${text}` : head;
  const a = parseRegion(before);
  const b = parseRegion(next);
  if (!a?.supported || !b?.supported || geometryKey(a) !== geometryKey(b) || b.caption !== text) return null;
  return next;
}
var isFrameEl = (el) => !!el && (el.type === "frame" || el.type === "magicframe");
function pinFraction({ x, y, width, height, pct }) {
  const side = pct / 100 * Math.min(width, height);
  const fw = Math.min(1, side / width);
  const fh = Math.min(1, side / height);
  const left = Math.min(1 - fw, Math.max(0, x - fw / 2));
  const top = Math.min(1 - fh, Math.max(0, y - fh / 2));
  return [left, top, fw, fh];
}
var DRAWING_BLOCK_RE = /^\s*\{\{(?:\[\[excalidraw\]\]|excalidraw)\}\}/;
var NOT_EDITABLE_RE = /^\s*\{\{(?:\[\[excalidraw\]\]|excalidraw|\[\[roam\/render\]\]|roam\/render)/;
var liveTagged = (drawing, uid) => (drawing?.elements || []).filter((e) => !e.isDeleted && e.customData?.plexus?.migratedFrom === uid).length;
async function waitFor(fn, timeoutMs, stepMs = 50, aborted = () => false) {
  const end = Date.now() + timeoutMs;
  for (; ; ) {
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
function cropToFraction(crop) {
  return [crop.x / crop.naturalWidth, crop.y / crop.naturalHeight, crop.width / crop.naturalWidth, crop.height / crop.naturalHeight];
}
var validCrop2 = (c) => !!c && c.width > 0 && c.height > 0 && c.naturalWidth > 0 && c.naturalHeight > 0;
var isFrame = (el) => el.type === "frame" || el.type === "magicframe";
var DRAWING_STRING_RE = /^\s*\{\{(?:\[\[excalidraw\]\]|excalidraw)\}\}/;
function detectRegionKind({ elements, ids, selectedGroupIds }) {
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
function contentRect(img, view2) {
  const rect = img.getBoundingClientRect();
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const fit = view2?.getComputedStyle?.(img)?.objectFit;
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
    out.toBlob((blob) => blob ? resolve(blob) : reject(new Error("[plexus] toBlob failed")), "image/png");
  });
}
function createActions({
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
  emit = () => {
  },
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
  closeWindowMs = 3e3,
  revokeDelayMs = 1e3,
  confirm = (message) => globalThis.confirm?.(message),
  withLockFn = withLock,
  frame = () => new Promise((resolve) => typeof globalThis.requestAnimationFrame === "function" ? globalThis.requestAnimationFrame(() => resolve()) : setTimeout(resolve, 16)),
  verifyPollMs = 100,
  verifyTimeoutMs = 3e3,
  guard: guard2 = directGuard,
  camera = null,
  motionOk: motionOk2 = () => false,
  viewHistory = () => null,
  measure: measure2 = null,
  ensureFonts = null
}) {
  let disposed = false;
  let activeTool = null;
  let activeToolIsDrawing = false;
  let stopSpotlight = null;
  const busy = /* @__PURE__ */ new Set();
  let presentOwner = null;
  const thumbPending = /* @__PURE__ */ new Map();
  const aborted = () => disposed;
  let legacyDialog = null;
  let cleanupDialog = null;
  let migrating = false;
  let activePrompt = null;
  let activePromptIsDrawing = false;
  let cleanupReport = null;
  let undoSlot = null;
  const closePolls = /* @__PURE__ */ new Map();
  const revokers = /* @__PURE__ */ new Set();
  let pendingUpdate = null;
  const cameraTo = camera ?? {
    animateTo: async (app, bbox, { maxZoom } = {}) => {
      native.zoomTo(app, bbox, { maxZoom });
      return { moved: true };
    }
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
  const hotIds = (region, elements) => {
    if (region.kind === "area") return region.ids;
    if (region.kind === "rect" || region.kind === "poly") return [region.el];
    return membersOf(region, elements);
  };
  async function hotSvg(app, region) {
    const elements = sceneElements(app);
    const imageEl = region.kind === "rect" || region.kind === "poly" ? elements.find((el) => el.id === region.el && !el.isDeleted) : null;
    const f = region.kind === "rect" ? displayedRect(imageEl, region.f) : null;
    const p = region.kind === "poly" ? displayedPoly(imageEl, region.p) : null;
    if (region.kind === "rect" && !f || region.kind === "poly" && !p) return null;
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
  const captionIds = (region, elements) => {
    const live = elements.filter((el) => el && !el.isDeleted);
    if (region.kind === "area") return region.ids;
    if (region.kind === "group") return live.filter((el) => el.groupIds?.includes(region.groupId)).map((el) => el.id);
    return live.filter((el) => el.frameId === region.frameId).map((el) => el.id);
  };
  const RELINK_KINDS = /* @__PURE__ */ new Set(["area", "group", "frame", "cframe"]);
  function relinkPlan(regionUid) {
    try {
      const block = isId(regionUid) ? host.pullBlock(regionUid) : null;
      const region = block ? parseRegion(block.string) : null;
      if (!region || !region.supported || !RELINK_KINDS.has(region.kind)) return null;
      const elements = host.drawing(region.drawingUid)?.elements;
      if (!Array.isArray(elements)) return null;
      const frameEl = region.kind === "frame" || region.kind === "cframe" ? elements.find((e) => e && e.id === region.frameId && !e.isDeleted) : null;
      const { caption, hasRef } = captionRefsInfo(elements, captionIds(region, elements), frameEl?.name ? { frameName: frameEl.name } : void 0);
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
    return el && el.type === "image" && validCrop2(el.crop) ? el : null;
  };
  const settingsNow = () => {
    try {
      return getSettings?.() || {};
    } catch {
      return {};
    }
  };
  const captionMode = () => {
    const m = settingsNow().captionMode;
    return CAPTION_MODES2.includes(m) ? m : "auto";
  };
  const pinPct = () => {
    const n = Number(settingsNow().pinSize);
    return PIN_SIZES2.includes(n) ? n : 8;
  };
  const safe = (fn) => {
    try {
      return fn();
    } catch {
      return void 0;
    }
  };
  const resolveBlock = (uid) => host.pullBlock?.(uid)?.string;
  const drawingCaptions = (elements, ids, frameName) => ({
    auto: captionRefsFromElements(elements, ids, frameName ? { frameName } : void 0),
    refs: captionRefsFromElements(elements, ids, { words: false })
  });
  const anchorRect = (app, bbox) => safe(() => bbox ? native.viewportRectOf?.(app, bbox) : null) ?? null;
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
        imageAlt: isImageKind2(region.kind) ? imageAltAt(src.string, region.i) : null,
        resolveBlock
      });
    } catch {
      return "Region";
    }
  }
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
  const NEW_REUSE_MS = 2e3;
  const PLEXUS_BLOCK_RE = /^\s*\{\{\[\[plexus-/;
  const DAILY_UID_RE = /^\d{2}-\d{2}-\d{4}$/;
  const EMBED_PLACE_CAP = 30;
  const PLACE_GAP = 40;
  const LINK_FONT = 20;
  const LINK_LINE = 1.25;
  const FONT_WAIT_MS = 500;
  const PENDING_MS = 10 * 60 * 1e3;
  const newDone = /* @__PURE__ */ new Map();
  const cards = /* @__PURE__ */ new Map();
  let pending = null;
  const rnd3 = () => Math.floor(Math.random() * 2 ** 31);
  const refText = (ref) => ref && typeof ref === "object" ? ref.ref : ref;
  const isValidDate = (d) => d instanceof Date && !Number.isNaN(d.getTime());
  const todayTitle = () => api.util.dateToPageTitle(/* @__PURE__ */ new Date());
  function viewCentre(app) {
    const st = app.state || {};
    return viewportToScene({ x: (st.offsetLeft || 0) + (st.width || 0) / 2, y: (st.offsetTop || 0) + (st.height || 0) / 2, appState: st });
  }
  function insertGuarded(app, drawingUid, elements, label) {
    const selectedElementIds2 = {};
    for (const el of elements) if (!el.containerId) selectedElementIds2[el.id] = true;
    return guard2.guardedWrite(app, {
      drawingUid,
      label,
      captureUpdate: "IMMEDIATELY",
      next: (current2) => [...current2, ...elements],
      appState: { selectedElementIds: selectedElementIds2, selectedGroupIds: {} }
    });
  }
  function cleanTitle(text) {
    return String(text ?? "").replace(/\[\[|\]\]|#/g, "").replace(/\s+/g, " ").trim();
  }
  async function newDrawingRun({ where, uid, open: open4, order: wantOrder }) {
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
      const now = /* @__PURE__ */ new Date();
      key = `today:${api.util.dateToPageUid(now)}`;
      const title = api.util.dateToPageTitle(now);
      create = async () => {
        const pageUid = await host.ensurePage(title);
        const existing = host.firstDrawingChild(pageUid);
        if (existing) return { uid: existing, reused: true };
        return host.createDrawing({ parentUid: pageUid, order: "last" });
      };
    } else if (where === "page") {
      const template = String(settingsNow().drawingName ?? "").trim() || "Drawing {date}";
      const dateText = safe(() => api.util.dateToPageTitle(/* @__PURE__ */ new Date())) ?? (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      const openPage = await host.openPageUid?.();
      const pageText = openPage && host.pageTitleOf?.(openPage) || "";
      const expand = (tpl, n) => cleanTitle(tpl.replace(/\{date\}/g, dateText).replace(/\{page\}/g, pageText).replace(/\{n\}/g, n ? String(n) : ""));
      const hasN = /\{n\}/.test(template);
      const base3 = expand(template, 0) || expand("Drawing {date}", 0);
      key = `page:${base3}`;
      const taken = (name) => !!host.pageUidByTitle(`Drawings/${name}`);
      create = () => {
        let name = null;
        if (hasN) {
          for (let n = 1; n < 1e3 && !name; n++) {
            const candidate = expand(template, n) || expand("Drawing {date}", 0);
            if (!taken(candidate)) name = candidate;
          }
        }
        if (!name) {
          name = base3;
          for (let k = 2; taken(name) && k < 1e3; k++) name = `${base3} ${k}`;
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
    if (recent && Date.now() - recent.at < NEW_REUSE_MS) {
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
      newDone.set(memoKey, { uid: result.uid, at: Date.now() });
      if (!result.reused) {
        try {
          emit({ uid: result.uid, kind: "drawing" });
        } catch (error) {
          console.warn("[plexus] change emit failed", error);
        }
      }
    }
    if (open4 && !disposed) {
      const rendered = () => {
        for (const el of doc.querySelectorAll('[id^="block-input-"]')) {
          if (el.id.endsWith(result.uid) && !el.closest?.(".plexus-offscreen") && !el.closest?.(".plexus-dock") && (el.querySelector(".excalidraw-outer-container .bp3-icon-fullscreen") || el.querySelector(".excalidraw-container > div"))) return true;
        }
        return false;
      };
      await waitFor(rendered, 1500, 50, aborted);
      const editor = disposed ? null : await openDrawingOnce(result.uid, { reuseIcon: true, placeholder: true, quiet: true });
      if (!editor && !disposed) toaster.show("Drawing created; open it from the outline");
    }
    return result.uid;
  }
  async function embedFromPickRun({ ref, scenePoint, app } = {}) {
    const editor = native.activeEditor(doc);
    if (!editor || app && editor.app !== app) {
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
          await waitFor(() => host.pageUidByTitle(parsed.title), 2e3, 50, aborted);
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
    if (!editor || app && editor.app !== app) {
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
    await waitFor(() => host.pageUidByTitle(name), 2e3, 50, aborted);
    if (disposed) return null;
    return embedFromPickRun({ ref: `[[${name}]]`, scenePoint, app: editor.app });
  }
  const linkLabel = (text) => embedLabel(String(text ?? "").replace(/\(\([^()]*\)\)/g, ""), 60);
  function textNode(text, x, y, width, link) {
    const height = Math.ceil(LINK_FONT * LINK_LINE);
    return {
      id: `plexus-node-${Math.random().toString(36).slice(2, 12)}`,
      type: "text",
      x,
      y,
      width,
      height,
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 0,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: rnd3(),
      version: 1,
      versionNonce: rnd3(),
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      link,
      locked: false,
      index: null,
      text,
      originalText: text,
      fontSize: LINK_FONT,
      fontFamily: 5,
      textAlign: "left",
      verticalAlign: "top",
      containerId: null,
      autoResize: true,
      lineHeight: LINK_LINE
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
    if (!editor || app && editor.app !== app) return placeRefuse("Open a drawing first");
    if (mode !== "embed" && mode !== "link" && mode !== "label") return placeRefuse("Could not place");
    const textMode = mode === "link" || mode === "label";
    const seen = /* @__PURE__ */ new Set();
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
    const blocks = parsed.filter((p) => p.kind === "block" && paths.has(p.uid) && !paths.get(p.uid).ancestors.some((a) => listed.has(a))).sort((a, b) => compareOrders(paths.get(a.uid).orders, paths.get(b.uid).orders));
    const pages = parsed.filter((p) => p.kind === "page" && (textMode || host.pageUidByTitle(p.title)));
    let list = [...blocks, ...pages];
    if (!list.length) return placeRefuse("Nothing to place");
    const at = Number.isFinite(scenePoint?.x) && Number.isFinite(scenePoint?.y) ? scenePoint : void 0;
    if (scenePoint && !at) console.warn("[plexus] place: bad click point, using the view centre", scenePoint);
    if (!textMode && list.length > EMBED_PLACE_CAP) {
      const n2 = list.length;
      toaster.show(`Too many to embed live (${n2}, max ${EMBED_PLACE_CAP})`, {
        action: { label: `Place ${n2} as links`, run: () => {
          void placeBlocksRun(items, { mode: "link", scenePoint: at, app, onPlaced });
        } }
      });
      return null;
    }
    const cap = mindmap?.NODE_CAP ?? 500;
    if (textMode && list.length > cap) {
      toaster.show(`Placing the first ${cap} of ${list.length}`);
      list = list.slice(0, cap);
    }
    const labels = list.map((p) => p.kind === "page" ? p.title : host.labelSource?.(p.uid)?.string ?? "");
    let nodes;
    if (textMode) {
      const texts = labels.map((l, i) => linkLabel(l) || (list[i].kind === "page" ? list[i].title : "Block"));
      if (ensureFonts) {
        try {
          await Promise.race([ensureFonts(texts, LINK_FONT), sleep(FONT_WAIT_MS)]);
        } catch (error) {
          console.warn("[plexus] font load failed", error);
        }
      }
      nodes = texts.map((t, i) => {
        const w = measure2 ? Math.ceil(measure2(t, LINK_FONT)) : Math.ceil(t.length * LINK_FONT * 0.6);
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
    const elements = nodes.flatMap((node, i) => node.build(x0 + i % cols * cellW, y0 + Math.floor(i / cols) * cellH));
    if (!insertGuarded(editor.app, editor.drawingUid, elements, "Place blocks")) return placeRefuse("Could not place: the drawing refused the write");
    const noun = mode === "link" ? "link" : mode === "label" ? "label" : "block";
    toaster.show(n === 1 ? `Placed 1 ${noun}` : `Placed ${n} ${noun}s`);
    try {
      onPlaced?.();
    } catch (error) {
      console.warn("[plexus] place callback failed", error);
    }
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
    const ready = await waitFor(() => overlay.hasPortal?.(anchorId), 1e3, 50, aborted);
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
  const DISCARD_TRIGGERS = /* @__PURE__ */ new Set(["escape", "enter", "pointer", "focus-lost", "error"]);
  async function discardIfUntouched(cardUid, { trigger = "escape" } = {}) {
    const card = cards.get(cardUid);
    if (!card) return false;
    if (!DISCARD_TRIGGERS.has(trigger) && trigger !== "removed") {
      cards.delete(cardUid);
      return false;
    }
    let block;
    try {
      block = host.pullBlock(cardUid);
    } catch (error) {
      console.warn("[plexus] card pull failed", error);
      return false;
    }
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
          const current2 = editor.app.getSceneElementsIncludingDeleted?.() ?? [];
          const ids = /* @__PURE__ */ new Set([card.anchorId]);
          for (const el of current2) if (el?.containerId === card.anchorId) ids.add(el.id);
          guard2.guardedWrite(editor.app, {
            drawingUid: card.drawingUid,
            label: "Discard note",
            captureUpdate: "NEVER",
            next: (cur) => cur.map((el) => el && ids.has(el.id) && !el.isDeleted ? { ...el, isDeleted: true, version: (el.version || 0) + 1, versionNonce: rnd3(), updated: Date.now() } : el)
          });
        } catch (error) {
          console.warn("[plexus] card anchor removal failed", error);
        }
      }
    }
    return true;
  }
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
      pendingUpdate = null;
      pending = null;
      cards.clear();
      newDone.clear();
      for (const revoke of [...revokers]) revoke();
    },
    // The drawing image tool is bound to the mounted editor; cancel it when that editor goes away.
    cancelDrawingTool() {
      pendingUpdate = null;
      if (activeToolIsDrawing) activeTool?.cancel?.();
      if (activePromptIsDrawing) activePrompt?.cancel?.();
    },
    // New drawing where the user is. where: "here" | "below" | "page" | "today". uid: the target block (else the focused block).
    newDrawing({ where = "here", uid, open: open4 = true, order } = {}) {
      const target = typeof uid === "string" && uid ? uid : safe(() => api.ui?.getFocusedBlock?.()?.["block-uid"]);
      return once("new-drawing", () => newDrawingRun({ where, uid: target, open: open4, order }));
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
      const done = await placeBlocksRun(job.items, { mode: job.mode, scenePoint, onPlaced: () => {
        if (pending === job) pending = null;
      } });
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
      const detected = detectRegionKind({ elements, ids, selectedGroupIds: app.state?.selectedGroupIds });
      let region;
      let words;
      if (detected.kind === "cframe") {
        const { frame: frame2, children } = detected;
        words = drawingCaptions(elements, children.map((el) => el.id), frame2.name);
        region = { kind: "cframe", drawingUid, frameId: frame2.id };
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
      const { frame: frame2, children } = detected;
      const words = drawingCaptions(elements, children.map((el) => el.id), frame2.name);
      const caption = await chooseCaption({ ...words, rect: anchorRect(app, [detected.frame.x, detected.frame.y, detected.frame.x + detected.frame.width, detected.frame.y + detected.frame.height]), drawing: true });
      if (caption == null || disposed) return null;
      const region = { kind: "frame", drawingUid, frameId: frame2.id, pad: DEFAULT_PAD, caption };
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
      const hint = "Copy a block ref first (right-click a bullet → Copy block ref)";
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
      const release = () => {
        if (presentOwner === token) presentOwner = null;
      };
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
    cancelPendingUpdate() {
      pendingUpdate = null;
    },
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
      const pick3 = ids.length ? free.filter((e) => ids.includes(e.id)) : free;
      if (!pick3.length) {
        toaster.show("No free text to select", { kind: "error" });
        return 0;
      }
      const selection = {};
      for (const el of pick3) selection[el.id] = true;
      app.updateScene({ appState: { selectedElementIds: selection, selectedGroupIds: {} } });
      return pick3.length;
    },
    removeElementLink: () => once("remove-link", removeElementLinkOnce),
    hasSnapshot() {
      const editor = native.activeEditor(doc);
      return !!editor?.drawingUid && !!guard2.hasSnapshot?.(editor.drawingUid);
    },
    restoreBeforeLastPlexusChange() {
      const editor = native.activeEditor(doc);
      if (!editor?.drawingUid) {
        toaster.show("Open a drawing full-screen first", { kind: "error" });
        return 0;
      }
      try {
        const n = guard2.restoreLast(editor.app, editor.drawingUid);
        if (guard2 === directGuard) toaster.show("Nothing to restore");
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
    }
  };
  function copyText(text, done) {
    let pending2;
    try {
      const write = () => clipboard.writeText(text);
      pending2 = native.withClipboard ? native.withClipboard(write) : write();
    } catch (error) {
      pending2 = Promise.reject(error);
    }
    return Promise.resolve(pending2).then(
      () => {
        toaster.show(done);
        return true;
      },
      (error) => {
        console.warn("[plexus] clipboard failed", error);
        toaster.show("Clipboard access was blocked", { kind: "error" });
        return false;
      }
    );
  }
  async function warmPng2x(app, regionUid, region, svg) {
    if (!WARM_KINDS.has(region.kind) || typeof native.captureSelectionPng !== "function") return;
    try {
      const dark = !!safe(() => isHostDark(doc)) && !!settingsNow().darkCrops;
      const blob = await native.captureSelectionPng(app, hotIds(region, sceneElements(app)), { scale: 2, dark });
      if (!blob || disposed) return;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.length < 24) return;
      const view2 = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const pw = view2.getUint32(16);
      const ph = view2.getUint32(20);
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
  function geometryFromSelection(region, before, app) {
    if (isImageKind2(region.kind)) return { error: "Image regions cannot be updated from a selection" };
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
      if (el.angle) return { error: "Rotated images are not supported" };
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
    if (isImageKind2(region.kind)) {
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
    const has2 = (id) => live.some((e) => e.id === id);
    let ids = [];
    let groups = {};
    if (region.kind === "area") ids = (region.ids || []).filter(has2);
    else if (region.kind === "group") {
      ids = live.filter((e) => Array.isArray(e.groupIds) && e.groupIds.includes(region.groupId)).map((e) => e.id);
      if (ids.length) groups = { [region.groupId]: true };
    } else if (region.kind === "frame" || region.kind === "cframe") ids = has2(region.frameId) ? [region.frameId] : [];
    else if (region.kind === "rect" || region.kind === "poly") ids = has2(region.el) ? [region.el] : [];
    if (!ids.length) return null;
    const selectedElementIds2 = {};
    for (const id of ids) selectedElementIds2[id] = true;
    return { selectedElementIds: selectedElementIds2, selectedGroupIds: groups };
  }
  async function selectRegionInner(regionUid, { quiet = false } = {}) {
    const { region } = readRegion(regionUid);
    if (!region?.supported || isImageKind2(region.kind)) {
      if (!quiet) toaster.show(region?.supported ? "Select on drawing is for drawing regions" : "Region cannot be selected", { kind: "error" });
      return false;
    }
    let editor = native.activeEditor(doc);
    if (!editor || editor.drawingUid !== region.drawingUid) {
      if (!await openRegionOnce(regionUid, { select: true })) return false;
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
    if (!region?.supported || isImageKind2(region.kind)) {
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
    if (!box.error && !box.missing?.length) {
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
      try {
        await refreshRegion?.(regionUid);
      } catch (error) {
        console.warn("[plexus] refresh after repair failed", error);
      }
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
    const named = /* @__PURE__ */ new Set();
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
      ok = guard2.guardedWrite(app, {
        drawingUid,
        label: "Remove link",
        captureUpdate: "IMMEDIATELY",
        next: (current2) => current2.map((e) => hit.has(e.id) ? { ...e, link: null, version: (e.version || 0) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() } : e)
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
      try {
        pageUid = await host.openPageUid?.() ?? null;
      } catch {
        pageUid = null;
      }
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
    const byDrawing = /* @__PURE__ */ new Map();
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
        repair: REPAIR_OF[problem] ?? null
      });
    };
    for (const [drawingUid, list] of byDrawing) {
      if (disposed) return null;
      if (out.length >= AUDIT_ROW_CAP) {
        truncated = true;
        break;
      }
      let target = null;
      let ownerBlock = null;
      const needsTarget = list.some(({ region }) => region.supported);
      if (needsTarget && isId(drawingUid)) {
        ownerBlock = safe(() => host.pullBlock(drawingUid));
        target = ownerBlock && DRAWING_BLOCK_RE.test(ownerBlock.string) ? safe(() => host.drawing(drawingUid)) ?? null : null;
      }
      for (const { row, region } of list) {
        if (out.length >= AUDIT_ROW_CAP) {
          truncated = true;
          break;
        }
        if (!region.supported) {
          push(row, region, "unsupported", region.error || "");
          continue;
        }
        if (!isContainerString(row.parentString)) {
          push(row, region, "outside-container");
          continue;
        }
        const container = containerOf.get(row.parentUid);
        if (container && container.ownerUid !== region.drawingUid) {
          push(row, region, "owner-mismatch", `container is under ${container.ownerUid}`);
          continue;
        }
        if (isImageKind2(region.kind)) {
          const has2 = ownerBlock && parseImageRefs(ownerBlock.string).some((r) => r.index === region.i);
          if (!has2) push(row, region, ownerBlock ? "no-image" : "no-owner");
          continue;
        }
        if (!ownerBlock || !target) {
          push(row, region, "no-owner");
          continue;
        }
        const box = regionSceneBBox(region, target.elements, target.appState);
        if (box.error) push(row, region, BOX_PROBLEM[box.error] ?? "no-elements", box.error);
        else if (box.missing?.length) push(row, region, "partial", `missing ${box.missing.join(", ")}`);
      }
      drawings += 1;
      if (drawings % AUDIT_YIELD_EVERY === 0) await sleep(0);
    }
    const perOwner = /* @__PURE__ */ new Map();
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
    const same3 = (safe(() => host.regionsOf?.(drawingUid)) || []).filter(({ region: region2 }) => region2?.supported && (region2.kind === "rect" || region2.kind === "poly") && region2.el === element.id);
    const initial = settingsNow().numberPins ? String(nextPinNumber(same3)) : "";
    const rect = safe(() => native.viewportRectOf?.(app, [element.x + f[0] * element.width, element.y + f[1] * element.height, element.x + (f[0] + f[2]) * element.width, element.y + (f[1] + f[3]) * element.height]));
    const caption = await askCaption({ initial, select: false, escape: "empty", rect, drawing: true });
    if (caption == null || disposed) return null;
    const region = { kind: "rect", drawingUid, el: element.id, f: displayedToNatural(element, f), caption };
    return finishCreate(region, await hotSvg(app, region));
  }
  async function pinInPlain({ blockUid, ref, imageRect, x, y }) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const f = pinFraction({ x, y, width: imageRect.width, height: imageRect.height, pct: pinPct() });
    const same3 = (safe(() => host.regionsOf?.(blockUid)) || []).filter(({ region: region2 }) => region2?.supported && (region2.kind === "imgrect" || region2.kind === "imgpoly") && region2.i === ref.index);
    const initial = settingsNow().numberPins ? String(nextPinNumber(same3)) : "";
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
    const skipped2 = [];
    let scanned = 0;
    const drawings = /* @__PURE__ */ new Map();
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
      const skip = (reason) => skipped2.push({ ...info, reason });
      if (RELINK_KINDS.has(region.kind)) {
        const elements = elementsOf(region.drawingUid);
        if (!Array.isArray(elements)) {
          skip("drawing not readable");
          continue;
        }
        const isFrameKind = region.kind === "frame" || region.kind === "cframe";
        const frameEl = isFrameKind ? elements.find((e) => e && e.id === region.frameId && !e.isDeleted && isFrameEl(e)) : null;
        if (isFrameKind && !frameEl) {
          skip("frame missing");
          continue;
        }
        const name = String(frameEl?.name ?? "").trim();
        if (isFrameKind && name === caption) {
          skip(`frame is named "${name}"`);
          continue;
        }
        if (isFrameKind && name && caption === "Frame") {
          skip("frame has a name");
          continue;
        }
        const auto = captionRefsFromElements(elements, captionIds(region, elements));
        if (auto === caption) {
          skip("text in the drawing reads the same");
          continue;
        }
      }
      const after = headPreservingString(row.string, "");
      if (after == null) {
        skip("could not rewrite safely");
        continue;
      }
      candidates.push({ ...info, before: row.string, after });
    }
    return { graph: safe(() => host.graphName?.()) ?? null, scanned, candidates, skipped: skipped2 };
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
          try {
            ok = confirm(`Clear ${n} placeholder caption${n === 1 ? "" : "s"} in graph "${safe(() => host.graphName?.()) ?? ""}"? "Plexus: Undo caption cleanup" restores them.`) === true;
          } catch {
            ok = false;
          }
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
        }
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
    const skipped2 = [];
    const failed = [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (disposed) break;
      const block = safe(() => host.pullBlock(c.uid));
      if (!block || block.string !== c.before) {
        skipped2.push({ uid: c.uid, reason: "changed since the dry run" });
        continue;
      }
      try {
        await host.updateRegionString(c.drawingUid, c.uid, c.after);
      } catch (error) {
        console.warn("[plexus] caption cleanup write failed", c.uid, error);
        failed.push({ uid: c.uid, error: String(error?.message ?? error) });
        for (const rest of list.slice(i + 1)) skipped2.push({ uid: rest.uid, reason: "not attempted" });
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
    const tail = `${skipped2.length ? `, ${skipped2.length} skipped` : ""}${failed.length ? `, ${failed.length} failed` : ""}`;
    toaster.show(`Cleared ${changed.length} placeholder caption${changed.length === 1 ? "" : "s"}${tail}`, failed.length ? { kind: "error" } : void 0);
    return { changed, skipped: skipped2, failed };
  }
  async function undoCleanupOnce() {
    if (!undoSlot) {
      toaster.show("Nothing to undo");
      return null;
    }
    const { changes } = undoSlot;
    const restored = [];
    const skipped2 = [];
    const failed = [];
    for (let i = changes.length - 1; i >= 0; i--) {
      const c = changes[i];
      if (disposed) {
        undoSlot = { changes: changes.slice(0, i + 1) };
        break;
      }
      const block = safe(() => host.pullBlock(c.uid));
      const region = block ? parseRegion(block.string) : null;
      if (!block || block.string !== c.after || !region?.supported) {
        skipped2.push({ uid: c.uid, reason: "changed since the cleanup" });
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
    toaster.show(`Restored ${restored.length} caption${restored.length === 1 ? "" : "s"}${skipped2.length ? `, ${skipped2.length} skipped` : ""}${failed.length ? `, ${failed.length} failed` : ""}`, failed.length ? { kind: "error" } : void 0);
    return { restored, skipped: skipped2, failed };
  }
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
        png2x: target.url ? null : cropKey({ regionUid, geometryKey: gk, drawingHash: target.hash, tier: "png2x" })
      }
    };
  }
  function readEntry(entry) {
    if (!entry?.url) return null;
    let p;
    try {
      p = Promise.resolve(fetchBlob(entry.url));
    } catch {
      return null;
    }
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
      return await new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("[plexus] toBlob failed")), "image/png"));
    } finally {
      urls.revokeObjectURL(url);
    }
  }
  function asPng(blob) {
    return blob.type === "image/png" ? blob : new Blob([blob], { type: "image/png" });
  }
  function startPng(regionUid) {
    const prep = cropPrep(regionUid);
    if (!prep) return null;
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
      if (!isImageKind2(region.kind)) job.lowRes = true;
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
        block: { uid, string: markdown }
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
      for (; ; ) {
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
          if (isImageKind2(region.kind)) continue;
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
    const slideHash = mounted ? fnv1a(JSON.stringify(sceneElements(mounted.app))) : drawing.hash;
    const slides = frames.map((frame2) => {
      const region = { kind: "cframe", drawingUid: uid, frameId: frame2.id, caption: frame2.name || "" };
      const gk = geometryKey(region);
      return {
        frame: frame2,
        region,
        name: frame2.name || `Frame ${frames.indexOf(frame2) + 1}`,
        url: null,
        svgKey: cropKey({ regionUid: `slide:${uid}:${frame2.id}`, geometryKey: gk, drawingHash: slideHash, tier: "svg" }),
        pngKey: cropKey({ regionUid: `slide:${uid}:${frame2.id}`, geometryKey: gk, drawingHash: slideHash, tier: "png" })
      };
    });
    for (const slide of slides) {
      const entry = (mounted ? cache.peek?.(slide.svgKey) : null) || cache.peek?.(slide.pngKey) || cache.peek?.(slide.svgKey);
      slide.url = entry?.url ?? null;
    }
    const handle = presenter.open({ slides: slides.map(({ name, url }) => ({ name, url })), index: 0, onClose: release });
    const missing = slides.map((s, i) => [s, i]).filter(([s]) => !s.url);
    if (!missing.length) return uid;
    const fail2 = (i) => {
      if (handle.isOpen()) handle.setSlide(i, { error: true });
    };
    const fill = (i, entry) => {
      if (entry?.url && handle.isOpen()) handle.setSlide(i, { url: entry.url });
    };
    try {
      if (mounted) {
        for (const [slide, i] of missing) {
          if (disposed || !handle.isOpen()) break;
          let svg = await captureSafe(mounted.app, [slide.frame.id]);
          if (!svg) continue;
          svg = normalizeSvgSize(svg);
          await cache.put(slide.svgKey, new Blob([svg], { type: "image/svg+xml" }), svgSize(svg));
          fill(i, cache.peek?.(slide.svgKey) || await cache.get(slide.svgKey));
        }
      } else {
        const hasImage = drawing.elements.some((el) => !el.isDeleted && (el.type === "image" || el.fileId));
        const rendered = await cold.renderDrawing(uid, { settleMs: hasImage ? IMAGE_SETTLE_MS : PLAIN_SETTLE_MS });
        if (!rendered || disposed || !handle.isOpen()) {
          if (!rendered && !disposed && handle.isOpen()) {
            for (const [, i] of missing) fail2(i);
            toaster.show("Could not render this drawing", { kind: "error" });
          }
          return uid;
        }
        for (const [slide, i] of missing) {
          if (disposed || !handle.isOpen()) break;
          const box = regionSceneBBox(slide.region, drawing.elements, drawing.appState);
          if (box.error) {
            fail2(i);
            continue;
          }
          const crop = viewPngCropRect({
            elements: drawing.elements,
            appState: drawing.appState,
            bbox: box.bbox,
            naturalWidth: rendered.naturalWidth,
            naturalHeight: rendered.naturalHeight
          });
          if (crop.error) {
            fail2(i);
            continue;
          }
          const blob = await cropCanvasToBlob(rendered.canvas, crop, { doc });
          await cache.put(slide.pngKey, blob, { w: crop.sw, h: crop.sh, persist: rendered.settled !== false });
          fill(i, cache.peek?.(slide.pngKey) || await cache.get(slide.pngKey));
        }
      }
    } catch (error) {
      console.warn("[plexus] present fill failed", error);
      for (const [slide, i] of missing) if (!cache.peek?.(slide.svgKey) && !cache.peek?.(slide.pngKey)) fail2(i);
    }
    return uid;
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
      const entry = cache.peek?.(k) || await cache.get(k);
      return entry ? fetchBlob(entry.url) : null;
    };
    const cached = await lookup(key);
    if (cached) return cached;
    if (!render) {
      for (const k of fallbacks) {
        const blob2 = await lookup(k);
        if (blob2) return blob2;
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
        block: { uid: drawingUid, string: "{{[[excalidraw]]}}" }
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
        }
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
    try {
      ok = confirm("Create a new native drawing right below this legacy block? The legacy block is not changed.") === true;
    } catch {
      ok = false;
    }
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
    const same3 = !!run.before && !!now && run.before.string === now.string && run.before.editTime === now.editTime;
    const made = run.target ? ` An empty drawing (${run.target}) was created; run Migrate again and it will be reused.` : "";
    return `${head}${made} ${same3 ? "The legacy block is unchanged." : "The legacy block changed meanwhile (not by Plexus)."}`;
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
        block: { uid, string: "{{[[excalidraw]]}}" }
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
    const loaded = await native.waitNotLoading(app, 5e3, { doc });
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
    for (; ; ) {
      if (disposed) return null;
      if (liveTagged(host.drawing(targetUid), legacyUid) === N) {
        confirmed = true;
        break;
      }
      if (Date.now() >= end) break;
      await sleep(verifyPollMs);
    }
    if (!confirmed) {
      toaster.show("Migration not confirmed yet. Reopen the drawing before running Migrate again", { kind: "error" });
      return null;
    }
    const after = legacySnapshot(legacyUid);
    const unchanged = !!before && !!after && before.string === after.string && before.editTime === after.editTime;
    const skipped2 = M - N;
    const head = N === M ? `Migrated ${N} elements.` : `Migrated ${N} of ${M} elements (${skipped2} not migrated).`;
    toaster.show(`${head} ${unchanged ? "The legacy block is unchanged." : "The legacy block changed during migration (not by Plexus)."}`);
    return targetUid;
  }
  async function openDrawingOnce(uid, { sidebar = false, reuseIcon = false, placeholder = false, quiet = false } = {}) {
    const note = (message) => {
      if (!quiet) toaster.show(message, { kind: "error" });
    };
    const matches = () => {
      const ed = native.activeEditor(doc);
      return ed && ed.drawingUid === uid ? ed : null;
    };
    const findIcon = () => {
      for (const el of doc.querySelectorAll('[id^="block-input-"]')) {
        if (!el.id.endsWith(uid) || el.closest?.(".plexus-offscreen") || el.closest?.(".plexus-dock")) continue;
        const found = el.querySelector(".excalidraw-outer-container .bp3-icon-fullscreen") ?? (placeholder ? el.querySelector(".excalidraw-container > div") : null);
        if (found && found.isConnected !== false) return found;
      }
      return null;
    };
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
    const deadline = Date.now() + 1e4;
    let editor = matches();
    for (let attempt = 0; attempt < 3 && !editor; attempt++) {
      const icon = await waitFor(findIcon, Math.min(3e3, Math.max(0, deadline - Date.now())), 50, aborted);
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
    if (isImageKind2(region.kind)) {
      try {
        await host.openBlock(uid, { sidebar });
      } catch (error) {
        console.warn("[plexus] open block failed", error);
        toaster.show("Could not open image", { kind: "error" });
        return null;
      }
      const settled = (img2) => {
        if (!img2 || !(img2.naturalWidth > 0)) return null;
        const r = img2.getBoundingClientRect?.();
        return r && r.width > 0 && r.height > 0 ? img2 : null;
      };
      const index = region.i || 0;
      let img = await waitFor(() => settled(findRenderedImage(uid, index)), 3e3, 50, aborted);
      if (img) {
        await sleep(100);
        img = settled(findRenderedImage(uid, index)) || img;
      }
      if (img && !disposed) {
        const f = region.kind === "imgrect" ? region.f : polyBBox(region.p);
        if (f) {
          const box2 = contentRect(img, doc.defaultView);
          stopSpotlight?.();
          stopSpotlight = spotlight({
            rect: { left: box2.left + f[0] * box2.width, top: box2.top + f[1] * box2.height, width: f[2] * box2.width, height: f[3] * box2.height },
            doc
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
    const deadline = Date.now() + 1e4;
    let editor = matches();
    if (!editor) {
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
        const icon = await waitFor(findIcon, Math.min(attempt === 0 ? 3e3 : 1500, Math.max(0, deadline - Date.now())), 50, aborted);
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
    await native.waitNotLoading?.(app, 5e3, { doc });
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
    const animate = !!safe(() => motionOk2(doc, settings.animation));
    const hist = safe(() => viewHistory(app));
    const sizeBefore = safe(() => hist?.size?.()) ?? 0;
    safe(() => hist?.push(app));
    let moved = null;
    try {
      moved = await cameraTo.animateTo(app, box.bbox, { maxZoom, animate, doc });
    } catch (error) {
      console.warn("[plexus] camera move failed", error);
    }
    if (!moved?.moved && hist && (safe(() => hist.size()) ?? 0) > sizeBefore) safe(() => hist.discard?.());
    if (disposed) return null;
    if (select || moved?.aborted) return uid;
    stopSpotlight?.();
    stopSpotlight = spotlight({ rect: native.viewportRectOf(app, box.bbox), doc, motion: animate }) || null;
    return uid;
  }
}

// src/model/dates.js
var WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
var MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
var prefixIndex = (names, token) => {
  if (token.length < 3) return -1;
  return names.findIndex((n) => n.startsWith(token));
};
function monthDay(now, month, day) {
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  const y = now.getFullYear();
  const d = new Date(y, month, day);
  return d.getMonth() === month && d.getDate() === day ? d : null;
}
function parseNaturalDate(text, now = /* @__PURE__ */ new Date()) {
  if (typeof text !== "string" || !(now instanceof Date) || Number.isNaN(now.getTime())) return null;
  const s = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return null;
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  if (s === "today") return new Date(y, m, d);
  if (s === "tomorrow") return new Date(y, m, d + 1);
  if (s === "yesterday") return new Date(y, m, d - 1);
  const wd = /^(?:next )?([a-z]+)$/.exec(s);
  if (wd) {
    const idx = prefixIndex(WEEKDAYS, wd[1]);
    if (idx >= 0) {
      const ahead = (idx - now.getDay() + 6) % 7 + 1;
      return new Date(y, m, d + ahead);
    }
  }
  const ord = "(?:st|nd|rd|th)?";
  const a = new RegExp(`^([a-z]+) (\\d{1,2})${ord}$`).exec(s);
  if (a) {
    const mi = prefixIndex(MONTHS, a[1]);
    return mi >= 0 ? monthDay(now, mi, Number(a[2])) : null;
  }
  const b = new RegExp(`^(\\d{1,2})${ord} ([a-z]+)$`).exec(s);
  if (b) {
    const mi = prefixIndex(MONTHS, b[2]);
    return mi >= 0 ? monthDay(now, mi, Number(b[1])) : null;
  }
  return null;
}

// src/model/suggest.js
var MAX_LOOKBACK = 300;
var MAX_QUERY = 100;
function findTrigger(text, caret) {
  if (typeof text !== "string" || !Number.isInteger(caret) || caret < 2 || caret > text.length) return null;
  const floor = Math.max(0, caret - MAX_LOOKBACK);
  for (let i = caret - 2; i >= floor; i--) {
    const c = text[i];
    if (c === "\n") return null;
    const pair = c + text[i + 1];
    if (pair !== "[[" && pair !== "((") continue;
    const tail = text.slice(i + 2, caret);
    if (tail.includes("\n") || tail.includes("]]") || tail.includes("))") || tail.length > MAX_QUERY) return null;
    return { kind: pair === "[[" ? "page" : "block", start: i, query: tail };
  }
  return null;
}
function replaceTrigger(text, caret, trigger, token) {
  const closer = trigger.kind === "page" ? "]]" : "))";
  const rest = text.slice(caret);
  const lead = /^[^\n[\]()]*/.exec(rest)[0];
  const cut2 = rest.startsWith(closer, lead.length) ? caret + lead.length + 2 : caret;
  return { text: text.slice(0, trigger.start) + token + text.slice(cut2), caret: trigger.start + token.length };
}
function applyPick(text, caret, trigger, pick3) {
  return replaceTrigger(text, caret, trigger, pick3.kind === "page" ? `[[${pick3.title}]]` : `((${pick3.uid}))`);
}
function stripTrigger(text, caret, trigger) {
  return replaceTrigger(text, caret, trigger, "");
}
var MAX_TITLE2 = 250;
function normalizeCreateTitle(query) {
  const t = String(query ?? "").replace(/\s+/g, " ").trim();
  if (!t || t.length > MAX_TITLE2 || t.includes("[[") || t.includes("]]")) return "";
  return t;
}
var ABBREVS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
function buildPageRows({ query, results = [], dateTitle = "", canCreate = false, exists = false }) {
  const q = String(query ?? "").trim().toLowerCase();
  const list = results.filter((r) => r && r.title != null);
  const exact = list.filter((r) => r.title.toLowerCase() === q);
  const rest = list.filter((r) => r.title.toLowerCase() !== q);
  const dateLower = dateTitle.toLowerCase();
  const dateRow = dateTitle ? { kind: "date", title: dateTitle } : null;
  const dupe = (r) => dateRow && r.title.toLowerCase() === dateLower;
  const abbrevWins = q.length === 3 && ABBREVS.some((n) => n.startsWith(q)) && rest.some((r) => r.title.toLowerCase().startsWith(q));
  const exactRows = exact.filter((r) => !dupe(r));
  const restRows = rest.filter((r) => !dupe(r));
  const rows = [...exactRows];
  if (dateRow && !abbrevWins) rows.push(dateRow);
  rows.push(...restRows);
  if (dateRow && abbrevWins) rows.push(dateRow);
  const title = normalizeCreateTitle(query);
  if (canCreate && title && !exists && !list.some((r) => r.title.toLowerCase() === title.toLowerCase()) && !(dateRow && dateLower === title.toLowerCase())) {
    rows.push({ kind: "create", title });
  }
  return rows;
}
var tokensOf = (query) => String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
function ranges(label, tokens2) {
  const lower = label.toLowerCase();
  const out = [];
  for (const t of tokens2) {
    let from = 0;
    for (; ; ) {
      const at = lower.indexOf(t, from);
      if (at < 0) break;
      out.push([at, at + t.length]);
      from = at + t.length;
    }
  }
  out.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}
function matchSegments(label, query) {
  const s = String(label ?? "");
  const merged = ranges(s, tokensOf(query));
  if (!merged.length) return [{ text: s, match: false }];
  const segs = [];
  let pos = 0;
  for (const [a, b] of merged) {
    if (a > pos) segs.push({ text: s.slice(pos, a), match: false });
    segs.push({ text: s.slice(a, b), match: true });
    pos = b;
  }
  if (pos < s.length) segs.push({ text: s.slice(pos), match: false });
  return segs;
}
function blockSnippet(str, query, max = 120) {
  const s = String(str ?? "").replace(/\s*\n\s*/g, " ").trim();
  if (s.length <= max) return s;
  const first = ranges(s, tokensOf(query))[0];
  let start = first ? Math.max(0, first[0] - Math.floor(max / 3)) : 0;
  const end = Math.min(s.length, start + max);
  start = Math.max(0, end - max);
  return (start > 0 ? "…" : "") + s.slice(start, end) + (end < s.length ? "…" : "");
}

// src/view/link-suggest.js
var SUGGEST_SELECTOR = "textarea.excalidraw-wysiwyg, input.excalidraw-hyperlinkContainer-input, input.plexus-mm-input";
var ACTIVE_BG = "rgb(213, 218, 223)";
var ENTER_ICON = '<svg data-icon="key-enter" width="16" height="16" viewBox="0 0 16 16"><path d="M14 2v6c0 .55-.45 1-1 1H4.41l1.3-1.29a1.003 1.003 0 0 0-1.42-1.42l-3 3c-.18.18-.29.43-.29.71s.11.53.29.71l3 3a1.003 1.003 0 0 0 1.42-1.42L4.41 11H13c1.66 0 3-1.34 3-3V2c0-.55-.45-1-1-1s-1 .45-1 1z" fill-rule="evenodd"/></svg>';
var COPY_PROPS = ["direction", "boxSizing", "width", "height", "overflowX", "overflowY", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderStyle", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSize", "fontFamily", "lineHeight", "textAlign", "textTransform", "textIndent", "letterSpacing", "wordSpacing", "tabSize", "whiteSpace", "wordBreak", "overflowWrap"];
var warn = (what, error) => console.warn(`[plexus] link suggest ${what} failed`, error);
var same2 = (a, b) => !!a && !!b && a.kind === b.kind && a.start === b.start && a.query === b.query;
function setValue(el, v) {
  for (let p = Object.getPrototypeOf(el); p; p = Object.getPrototypeOf(p)) {
    const d = Object.getOwnPropertyDescriptor(p, "value");
    if (d?.set) {
      d.set.call(el, v);
      return;
    }
  }
  el.value = v;
}
function measureCaret(doc, el, caret) {
  const cs = doc.defaultView.getComputedStyle(el);
  const isInput = String(el.tagName).toUpperCase() === "INPUT";
  const mirror = doc.createElement("div");
  for (const p of COPY_PROPS) mirror.style[p] = cs[p];
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.top = "0px";
  mirror.style.left = "-9999px";
  mirror.style.whiteSpace = isInput ? "pre" : cs.whiteSpace || "pre-wrap";
  const value = el.value ?? "";
  mirror.textContent = value.slice(0, caret);
  const marker = doc.createElement("span");
  marker.textContent = value.slice(caret) || ".";
  mirror.append(marker);
  doc.body.append(mirror);
  try {
    const fontSize = Number.parseFloat(cs.fontSize) || 16;
    const lh = Number.parseFloat(cs.lineHeight);
    return { x: marker.offsetLeft || 0, y: marker.offsetTop || 0, lineHeight: Number.isFinite(lh) ? lh : fontSize * 1.2 };
  } finally {
    mirror.remove();
  }
}
function createLinkSuggest({ doc, api, createPage, onEmbedPick, now = () => /* @__PURE__ */ new Date(), zIndexFor = () => 1e3, debounce = { page: 60, block: 150 }, setTimeout: setT = (...a) => globalThis.setTimeout(...a), clearTimeout: clearT = (...a) => globalThis.clearTimeout(...a) } = {}) {
  const view2 = doc.defaultView;
  const attached = /* @__PURE__ */ new Set();
  function attach(el) {
    let trigger = null;
    let items = [];
    let status = "hint";
    let active = 0;
    let seq = 0;
    let timer = null;
    let liveTimer = null;
    let root = null;
    let scroll = null;
    let footerTitle = null;
    let lastMouse = null;
    let rows = [];
    let dead = false;
    const safe = (what, fn) => (e) => {
      try {
        return fn(e);
      } catch (error) {
        warn(what, error);
      }
    };
    const connected = () => el.isConnected !== false;
    const clearTimers = () => {
      if (timer != null) {
        clearT(timer);
        timer = null;
      }
      if (liveTimer != null) {
        clearT(liveTimer);
        liveTimer = null;
      }
    };
    const onWinScroll = safe("scroll", (e) => {
      if (root && !(e?.target && root.contains?.(e.target))) place();
    });
    const onWinResize = safe("resize", () => {
      if (root) place();
    });
    const onWinWheel = safe("wheel", (e) => {
      if (root && !(e?.target && root.contains?.(e.target))) close2();
    });
    function destroyRoot() {
      if (!root) return;
      view2?.removeEventListener?.("resize", onWinResize);
      view2?.removeEventListener?.("scroll", onWinScroll, true);
      view2?.removeEventListener?.("wheel", onWinWheel, true);
      if (liveTimer != null) {
        clearT(liveTimer);
        liveTimer = null;
      }
      root.remove();
      root = scroll = footerTitle = null;
      rows = [];
    }
    function close2() {
      seq++;
      clearTimers();
      trigger = null;
      items = [];
      destroyRoot();
    }
    function place() {
      if (!root || !connected()) return;
      const rect = el.getBoundingClientRect();
      const sx = rect.width / el.offsetWidth;
      const sy = rect.height / el.offsetHeight;
      const scale = Number.isFinite(sx) && sx > 0 ? sx : 1;
      const isInput = String(el.tagName).toUpperCase() === "INPUT";
      let left = rect.left;
      let top = rect.bottom + 4;
      let lineTop = rect.top;
      const rotated = Number.isFinite(sx) && Number.isFinite(sy) && Math.abs(sx - sy) > 0.02;
      if (!rotated) {
        const caret = measureCaret(doc, el, el.selectionStart ?? (el.value ?? "").length);
        left = rect.left + (caret.x - (el.scrollLeft || 0)) * scale;
        if (!isInput) {
          lineTop = rect.top + (caret.y - (el.scrollTop || 0)) * scale;
          top = lineTop + caret.lineHeight * scale + 4;
        }
      }
      const h = root.getBoundingClientRect?.().height || root.offsetHeight || 300;
      const vh = view2.innerHeight || 0;
      const vw = view2.innerWidth || 0;
      if (vh && top + h > vh - 8) top = Math.max(8, lineTop - h - 4);
      if (vw) left = Math.min(left, vw - 400 - 8);
      left = Math.max(8, left);
      root.style.left = `${left}px`;
      root.style.top = `${top}px`;
    }
    function setActive(i, scrollTo) {
      active = i;
      rows.forEach((r, k) => {
        r.style.backgroundColor = k === i ? ACTIVE_BG : "";
      });
      if (scrollTo) rows[i]?.scrollIntoView?.({ block: "nearest" });
    }
    function segs(parent, text, query) {
      for (const s of matchSegments(text, query)) {
        const span = doc.createElement("span");
        if (s.match) span.className = "rm-search-match";
        span.textContent = s.text;
        parent.append(span);
      }
    }
    function render() {
      if (dead || !trigger) return;
      const isPage = trigger.kind === "page";
      const created = !root;
      if (created) {
        root = doc.createElement("div");
        root.className = "rm-autocomplete__results bp3-elevation-3 plexus-portal plexus-suggest";
        root.style.zIndex = String(Math.max((zIndexFor(el) || 0) + 10, 1010));
        root.addEventListener("pointerdown", (e) => e.stopPropagation());
        root.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
        root.addEventListener("click", (e) => e.stopPropagation());
        const main = doc.createElement("div");
        main.className = "rm-autocomplete__results-main";
        scroll = doc.createElement("div");
        scroll.className = "rm-autocomplete__results-scroll";
        const footer = doc.createElement("div");
        footer.className = "rm-autocomplete-footer";
        footerTitle = doc.createElement("div");
        footerTitle.className = "rm-autocomplete-footer__title";
        const actions = doc.createElement("div");
        actions.className = "rm-autocomplete-footer__actions";
        const action = doc.createElement("span");
        action.className = "rm-autocomplete-footer__action";
        const desc = doc.createElement("span");
        desc.className = "rm-autocomplete-footer__action__desc";
        desc.textContent = "Insert reference";
        const hotkey = doc.createElement("span");
        hotkey.className = "rm-autocomplete-footer__action__hotkey";
        const icon = doc.createElement("span");
        icon.className = "bp3-icon bp3-icon-key-enter rm-autocomplete-footer__action__hotkey__icon";
        icon.innerHTML = ENTER_ICON;
        hotkey.append(icon);
        action.append(desc, hotkey);
        actions.append(action);
        footer.append(footerTitle, actions);
        main.append(scroll, footer);
        root.append(main);
        doc.body.append(root);
        view2?.addEventListener?.("resize", onWinResize);
        view2?.addEventListener?.("scroll", onWinScroll, true);
        view2?.addEventListener?.("wheel", onWinWheel, { capture: true, passive: true });
        scheduleLive();
      }
      footerTitle.textContent = isPage ? "Page search" : "Block search";
      scroll.replaceChildren?.();
      rows = [];
      const message = (text, title) => {
        const row = doc.createElement("div");
        row.setAttribute("title", title ?? text);
        row.className = "dont-unfocus-block";
        Object.assign(row.style, { borderRadius: "2px", padding: "6px", color: "lightgray" });
        const inner = doc.createElement("div");
        inner.className = "rm-autocomplete-result";
        inner.textContent = text;
        row.append(inner);
        scroll.append(row);
      };
      if (status === "hint") message(isPage ? "Search for a page" : "Search for a block");
      else if (status === "error") message("Search failed");
      else if (!items.length) message(isPage ? "No pages found." : "No blocks found.");
      else {
        items.forEach((item, k) => {
          const row = doc.createElement("div");
          row.setAttribute("title", item.kind === "block" ? item.str : item.title);
          row.className = "dont-unfocus-block";
          Object.assign(row.style, { borderRadius: "2px", padding: "6px", cursor: "pointer" });
          const inner = doc.createElement("div");
          inner.className = "rm-autocomplete-result";
          const label = doc.createElement("span");
          if (item.kind === "create") label.textContent = `+ Create page ${item.title}`;
          else segs(label, item.kind === "block" ? blockSnippet(item.str, trigger.query) : item.title, trigger.query);
          inner.append(label);
          row.append(inner);
          if (item.kind === "date") {
            const sub = doc.createElement("div");
            sub.className = "bp3-text-overflow-ellipsis";
            sub.style.color = "rgb(129, 145, 157)";
            sub.textContent = "Daily note";
            row.append(sub);
          }
          if (item.kind === "block" && item.pageTitle) {
            const sub = doc.createElement("div");
            sub.className = "bp3-text-overflow-ellipsis";
            sub.style.color = "rgb(129, 145, 157)";
            sub.textContent = item.pageTitle;
            row.append(sub);
          }
          row.addEventListener("mousemove", safe("mousemove", (e) => {
            if (lastMouse && lastMouse[0] === e.clientX && lastMouse[1] === e.clientY) return;
            lastMouse = [e.clientX, e.clientY];
            setActive(k, false);
          }));
          row.addEventListener("click", safe("pick", (e) => {
            e.stopPropagation();
            pick3(item);
          }));
          scroll.append(row);
          rows.push(row);
        });
      }
      setActive(Math.min(active, Math.max(rows.length - 1, 0)), false);
      place();
    }
    function scheduleLive() {
      liveTimer = setT(() => {
        liveTimer = null;
        if (dead || !root) return;
        if (!connected()) {
          detach();
          return;
        }
        scheduleLive();
      }, 300);
    }
    async function pageRows(q, found) {
      let dateTitle = "";
      try {
        const date = parseNaturalDate(q, now());
        if (date && typeof api.util?.dateToPageTitle === "function") dateTitle = api.util.dateToPageTitle(date) || "";
      } catch (error) {
        warn("date row", error);
      }
      const canCreate = typeof createPage === "function";
      const title = normalizeCreateTitle(q);
      let exists = false;
      if (canCreate && title && !found.some((r) => r.title?.toLowerCase() === title.toLowerCase())) {
        try {
          const pulled = await api.data.pull("[:node/title]", [":node/title", title]);
          exists = !!pulled?.[":node/title"];
        } catch {
        }
      }
      return buildPageRows({ query: q, results: found, dateTitle, canCreate, exists });
    }
    async function search(trig, mine) {
      const q = trig.query.trim();
      try {
        let found;
        if (trig.kind === "page") {
          const res = await api.data.async.search({ "search-str": q, "search-pages": true, "search-blocks": false, limit: 12 });
          found = (res || []).map((r) => ({ kind: "page", title: r[":node/title"] ?? r.title, uid: r[":block/uid"] ?? r.uid }));
          found = await pageRows(q, found);
        } else {
          const res = await api.data.async.search({ "search-str": q, "search-pages": false, "search-blocks": true, "hide-code-blocks": true, limit: 12 });
          found = await Promise.all((res || []).map(async (r) => {
            const uid = r[":block/uid"] ?? r.uid;
            let pageTitle = "";
            try {
              const pulled = await api.data.pull("[{:block/page [:node/title]}]", [":block/uid", uid]);
              pageTitle = pulled?.[":block/page"]?.[":node/title"] ?? "";
            } catch {
            }
            return { kind: "block", uid, str: r[":block/string"] ?? r.string ?? "", pageTitle };
          }));
        }
        if (mine !== seq || dead) return;
        if (!connected()) {
          detach();
          return;
        }
        items = found;
        status = "results";
        active = 0;
        render();
      } catch (error) {
        if (mine !== seq || dead) return;
        warn("search", error);
        items = [];
        status = "error";
        render();
      }
    }
    function setTrigger(next) {
      const kindChanged = !trigger || trigger.kind !== next.kind;
      seq++;
      if (timer != null) {
        clearT(timer);
        timer = null;
      }
      trigger = next;
      active = 0;
      if (kindChanged) {
        items = [];
        destroyRoot();
      }
      if (!next.query.trim()) {
        items = [];
        status = "hint";
        render();
        return;
      }
      status = "loading";
      const mine = seq;
      timer = setT(() => {
        timer = null;
        if (mine !== seq || dead) return;
        if (!connected()) {
          detach();
          return;
        }
        search(next, mine);
      }, debounce[next.kind] ?? 60);
    }
    function recheck(canOpen) {
      if (dead) return;
      const trig = findTrigger(el.value ?? "", el.selectionStart);
      if (!trig) {
        close2();
        return;
      }
      if (same2(trig, trigger)) return;
      if (!canOpen && !trigger) return;
      setTrigger(trig);
    }
    function pick3(item) {
      const text = el.value ?? "";
      const caret = el.selectionStart ?? text.length;
      const trig = findTrigger(text, caret);
      if (!trig) {
        close2();
        return;
      }
      const out = applyPick(text, caret, trig, item.kind === "block" ? { kind: "block", uid: item.uid } : { kind: "page", title: item.title });
      setValue(el, out.text);
      el.setSelectionRange?.(out.caret, out.caret);
      let ev;
      try {
        ev = new (view2.InputEvent || view2.Event)("input", { bubbles: true, inputType: "insertReplacementText" });
      } catch {
        ev = new view2.Event("input", { bubbles: true });
      }
      close2();
      el.dispatchEvent(ev);
      if (el.value === out.text) el.setSelectionRange?.(out.caret, out.caret);
      if (item.kind === "create") {
        try {
          Promise.resolve(createPage(item.title)).catch((error) => warn("create page", error));
        } catch (error) {
          warn("create page", error);
        }
      }
    }
    const isWysiwyg = () => String(el.tagName).toUpperCase() === "TEXTAREA" && (el.classList?.contains?.("excalidraw-wysiwyg") || /(^|\s)excalidraw-wysiwyg(\s|$)/.test(el.className || ""));
    function embedPick(e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const item = status === "results" ? items[active] : null;
      if (!item) return;
      const text = el.value ?? "";
      const caret = el.selectionStart ?? text.length;
      const trig = findTrigger(text, caret);
      if (!trig) {
        close2();
        return;
      }
      const isBlock = item.kind === "block";
      try {
        onEmbedPick({ kind: isBlock ? "block" : "page", ref: isBlock ? `((${item.uid}))` : `[[${item.title}]]`, title: isBlock ? item.str : item.title, uid: item.uid, create: item.kind === "create", el });
      } catch (error) {
        warn("embed pick", error);
      }
      const out = stripTrigger(text, caret, trig);
      setValue(el, out.text);
      el.setSelectionRange?.(out.caret, out.caret);
      let ev;
      try {
        ev = new (view2.InputEvent || view2.Event)("input", { bubbles: true, inputType: "insertReplacementText" });
      } catch {
        ev = new view2.Event("input", { bubbles: true });
      }
      el.dispatchEvent(ev);
      close2();
      el.blur?.();
    }
    const onInput = safe("input", (e) => {
      if (e?.isComposing) return;
      recheck(true);
    });
    const onRecheck = safe("recheck", (e) => {
      if (e?.type === "keyup" && !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      if (trigger) recheck(false);
    });
    const onKeydown = safe("keydown", (e) => {
      if (!root || e.isComposing || e.keyCode === 229) return;
      const bare = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
      if (e.key === "Enter" && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && typeof onEmbedPick === "function" && isWysiwyg()) {
        embedPick(e);
        return;
      }
      const ctrlOnly = e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
      let move = 0;
      let commit = false;
      let esc = false;
      if (bare && e.key === "ArrowDown") move = 1;
      else if (bare && e.key === "ArrowUp") move = -1;
      else if (ctrlOnly && e.key === "n") move = 1;
      else if (ctrlOnly && e.key === "p") move = -1;
      else if (bare && (e.key === "Enter" || e.key === "Tab")) commit = true;
      else if (bare && e.key === "Escape") esc = true;
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (move) {
        if (rows.length) setActive((active + move + rows.length) % rows.length, true);
      } else if (commit) {
        if (status === "loading") return;
        if (status === "results" && items[active]) pick3(items[active]);
        else if (status === "results" && trigger?.kind === "page" && trigger.query.trim()) pick3({ kind: "page", title: trigger.query.trim() });
        else close2();
      } else if (esc) close2();
    });
    const onBlur = safe("blur", () => close2());
    el.addEventListener("input", onInput);
    el.addEventListener("keydown", onKeydown, true);
    el.addEventListener("keyup", onRecheck);
    el.addEventListener("click", onRecheck);
    el.addEventListener("blur", onBlur);
    function detach() {
      if (dead) return;
      close2();
      dead = true;
      el.removeEventListener("input", onInput);
      el.removeEventListener("keydown", onKeydown, true);
      el.removeEventListener("keyup", onRecheck);
      el.removeEventListener("click", onRecheck);
      el.removeEventListener("blur", onBlur);
      attached.delete(detach);
    }
    attached.add(detach);
    return detach;
  }
  return {
    attach,
    dispose() {
      for (const d of [...attached]) d();
    }
  };
}
function installSuggestAutoAttach({ doc, suggest, setTimeout: setT = (...a) => globalThis.setTimeout(...a), clearTimeout: clearT = (...a) => globalThis.clearTimeout(...a) }) {
  let current2 = null;
  let currentEl = null;
  let offBlur = null;
  let pending = null;
  const release = () => {
    if (pending != null) {
      clearT(pending);
      pending = null;
    }
    offBlur?.();
    offBlur = null;
    current2?.();
    current2 = null;
    currentEl = null;
  };
  const onFocusIn = (e) => {
    try {
      const t = e.target;
      if (!t || t === currentEl || !t.matches?.(SUGGEST_SELECTOR)) return;
      if (!t.closest?.(".excalidraw-outer-container") && !t.classList?.contains("plexus-portal")) return;
      release();
      currentEl = t;
      current2 = suggest.attach(t);
      const onOut = () => {
        if (pending != null) clearT(pending);
        pending = setT(() => {
          pending = null;
          if (doc.activeElement === t) return;
          if (currentEl === t) release();
        }, 0);
      };
      t.addEventListener("focusout", onOut);
      offBlur = () => t.removeEventListener("focusout", onOut);
    } catch (error) {
      console.warn("[plexus] link suggest attach failed", error);
    }
  };
  doc.addEventListener("focusin", onFocusIn, true);
  return () => {
    doc.removeEventListener("focusin", onFocusIn, true);
    release();
  };
}

// src/view/context-menus.js
var DRAWING_START2 = /^\s*\{\{(?:\[\[excalidraw\]\]|excalidraw)\}\}/;
var PLEXUS_START = /^\s*\{\{\[\[plexus-/;
var MEMO_MS2 = 500;
var INFRA_START = /^\s*\{\{\[\[plexus-(?:regions|cards)\]\]\}\}/;
var LINK_LABEL = "Plexus: Link caption to source blocks";
var guard = (label, fn) => (...args) => {
  try {
    const out = fn(...args);
    if (out && typeof out.catch === "function") out.catch((error) => console.warn(`[plexus] ${label} failed`, error));
  } catch (error) {
    console.warn(`[plexus] ${label} failed`, error);
  }
};
var cond = (fn) => (e) => {
  try {
    return !!fn(e);
  } catch {
    return false;
  }
};
var overrideMode = (o) => typeof o === "string" ? o : o?.mode ?? null;
function installRoamMenus({ api, host, actions, regionref, getSettings = () => ({}), setRefOverride: setRefOverride2, openSettings, openPrompt, isEncrypted, native, hasEditor, doc = globalThis.document, now = () => Date.now() } = {}) {
  const added = [];
  const pullString = (uid) => {
    if (!uid) return null;
    const raw = api.data.pull("[:block/string]", [":block/uid", uid]);
    return raw ? raw[":block/string"] ?? "" : null;
  };
  const memos = [];
  const clearMemo = () => {
    for (const m of memos) m.clear();
  };
  const memoize = (compute) => {
    const memo3 = /* @__PURE__ */ new Map();
    memos.push(memo3);
    return (key, ...args) => {
      const t = now();
      const hit = memo3.get(key);
      if (hit && t - hit.t < MEMO_MS2) return hit.data;
      const data = compute(...args);
      memo3.set(key, { t, data });
      if (memo3.size > 50) memo3.delete(memo3.keys().next().value);
      return data;
    };
  };
  const refInfo = memoize((ref, block) => {
    const string = pullString(ref);
    if (string == null) return { supported: false };
    const supported = !!parseRegion(string)?.supported;
    if (!supported) return { supported };
    let mode = null;
    try {
      mode = regionref.modeOf({ blockUid: block, refUid: ref });
    } catch {
      mode = null;
    }
    let captionState = "written";
    try {
      captionState = regionref.captionStateOf?.({ blockUid: block, refUid: ref }) ?? "written";
    } catch {
      captionState = "written";
    }
    const overrides = getSettings()?.refOverrides || {};
    const kind = parseRegion(string)?.kind;
    return { supported, mode, captionState, drawingKind: !isImageKind(kind), hasOverride: overrideMode(overrides[overrideKey(block, ref)]) != null };
  });
  const candidateOf = memoize((uid) => {
    try {
      return actions.regionCaptionCandidate?.(uid) ?? null;
    } catch {
      return null;
    }
  });
  const blockInfo = memoize((uid) => {
    const string = pullString(uid);
    if (string == null) return {};
    const region = parseRegion(string);
    const drawingKind = !!region?.supported && !isImageKind(region.kind);
    return {
      images: parseImageRefs(string).length > 0,
      drawing: DRAWING_START2.test(string),
      region: !!region?.supported,
      drawingKind,
      needsRepair: drawingKind && needsRepair(region)
    };
  });
  const parentString = (uid) => {
    try {
      const raw = api.data.pull("[{:block/_children [:block/string]}]", [":block/uid", uid]);
      const p = raw?.[":block/_children"];
      const parent = Array.isArray(p) ? p[0] : p;
      return typeof parent?.[":block/string"] === "string" ? parent[":block/string"] : null;
    } catch {
      return null;
    }
  };
  const newDrawingOk = memoize((uid) => {
    const string = pullString(uid);
    if (string == null) return false;
    if (DRAWING_START2.test(string) || PLEXUS_START.test(string) || parseRegion(string)?.supported) return false;
    return !PLEXUS_START.test(parentString(uid) ?? "");
  });
  const needsRepair = (region) => {
    try {
      const target = resolveRegionTarget(host, region);
      if (target.error) return true;
      return region.kind === "area" && (target.sceneBox?.missing?.length ?? 0) > 0;
    } catch {
      return false;
    }
  };
  const register = (menuName, label, display, callback) => {
    const menu = api?.ui?.[menuName];
    if (!menu?.addCommand) return;
    added.push([menu, label]);
    try {
      const out = menu.addCommand({ label, "display-conditional": cond(display), callback: guard(label, callback) });
      if (out && typeof out.catch === "function") out.catch((error) => console.warn("[plexus] menu add failed", label, error));
    } catch (error) {
      console.warn("[plexus] menu add failed", label, error);
    }
  };
  const refOf = (e) => ({ ref: e?.["ref-uid"], block: e?.["block-uid"] });
  const refShowLink = (e) => {
    const { ref, block } = refOf(e);
    return refInfo(`${ref}|${block}`, ref, block).supported && candidateOf(ref, ref) != null;
  };
  const refShow = (extra = () => true) => (e) => {
    const { ref, block } = refOf(e);
    const info = refInfo(`${ref}|${block}`, ref, block);
    return info.supported && extra(info);
  };
  register("blockRefContextMenu", "Plexus: Open region", refShow(), (e) => actions.openRegion(refOf(e).ref, { sidebar: false }));
  register("blockRefContextMenu", "Plexus: Open region in sidebar", refShow(), (e) => actions.openRegion(refOf(e).ref, { sidebar: true }));
  for (const [mode, name] of [["image", "image"], ["thumbnail", "thumbnail"], ["link", "link"]]) {
    register("blockRefContextMenu", `Plexus: Show as ${name}`, refShow((i) => i.mode !== mode), async (e) => {
      const { ref, block } = refOf(e);
      await setRefOverride2(block, ref, { mode });
      clearMemo();
      regionref.refreshBlock(block);
    });
  }
  register("blockRefContextMenu", "Plexus: Use default display", refShow((i) => i.hasOverride), async (e) => {
    const { ref, block } = refOf(e);
    await setRefOverride2(block, ref, { mode: null });
    clearMemo();
    regionref.refreshBlock(block);
  });
  for (const [caption, label, extra] of [
    ["hide", "Plexus: Hide caption", (i) => i.mode !== "link" && i.captionState !== "hide"],
    ["show", "Plexus: Show caption", (i) => i.captionState === "hide"]
  ]) {
    register("blockRefContextMenu", label, refShow(extra), async (e) => {
      const { ref, block } = refOf(e);
      await setRefOverride2(block, ref, { caption });
      clearMemo();
      regionref.refreshBlock(block);
    });
  }
  register("blockRefContextMenu", "Plexus: Refresh crop", refShow(), (e) => regionref.refreshRegion(refOf(e).ref));
  const relink = async (uid) => {
    await actions.relinkRegionCaption(uid);
    clearMemo();
    regionref.refreshRegion?.(uid);
  };
  register("blockRefContextMenu", LINK_LABEL, refShowLink, (e) => relink(refOf(e).ref));
  const encrypted = () => {
    try {
      return !!(isEncrypted ? isEncrypted() : host?.isEncrypted?.());
    } catch {
      return false;
    }
  };
  const anchorRect = (blockUid) => {
    try {
      const blockEl = [...doc.querySelectorAll?.('[id^="block-input-"]') ?? []].find((n) => String(n.id).endsWith(`-${blockUid}`));
      const target = blockEl?.querySelector?.("[data-plexus-card-host], .plexus-root") ?? blockEl;
      const r = target?.getBoundingClientRect?.();
      if (r && (r.width || r.height)) return { left: r.left, top: r.top, width: r.width, height: r.height };
    } catch {
    }
    const w = doc?.defaultView?.innerWidth ?? 800;
    return { left: Math.max(8, w / 2 - 100), top: 60, width: 200, height: 0 };
  };
  const nameRegion = async (uid, blockUid) => {
    const string = pullString(uid);
    const region = string == null ? null : parseRegion(string);
    if (!region?.supported) return;
    const text = await openPrompt({ doc, rect: anchorRect(blockUid), initial: region.caption ?? "", select: true, escape: "cancel" });
    if (text == null) return;
    await actions.nameRegion(uid, text);
    clearMemo();
    regionref.refreshRegion?.(uid, { purge: false });
  };
  const cropItems = (menuName, show, uidOf, blockOf, { insert }) => {
    const drawingShow2 = (e) => !!show(e).drawingKind;
    register(menuName, "Plexus: Name region", (e) => show(e).supported, (e) => nameRegion(uidOf(e), blockOf(e)));
    register(menuName, "Plexus: Copy crop as PNG", (e) => show(e).supported, (e) => actions.copyCropPng(uidOf(e)));
    register(menuName, "Plexus: Copy crop as SVG", drawingShow2, (e) => actions.copyCropSvg(uidOf(e)));
    register(menuName, "Plexus: Download crop", (e) => show(e).supported, (e) => actions.downloadCrop(uidOf(e)));
    if (insert) register(menuName, "Plexus: Insert crop as image block", (e) => show(e).supported && !encrypted(), (e) => actions.insertCropImage(uidOf(e), blockOf(e)));
    register(menuName, "Plexus: Copy alias", (e) => show(e).supported, (e) => actions.copyAlias(uidOf(e)));
  };
  cropItems("blockRefContextMenu", (e) => {
    const { ref, block } = refOf(e);
    return refInfo(`${ref}|${block}`, ref, block);
  }, (e) => refOf(e).ref, (e) => refOf(e).block, { insert: true });
  register("blockRefContextMenu", "Plexus: Region settings…", refShow(), () => openSettings());
  register("blockRefContextMenu", "Plexus: Copy region link", refShow(), (e) => actions.copyRegionLink(refOf(e).ref));
  const blockShow = (key) => (e) => !!blockInfo(e?.["block-uid"], e?.["block-uid"])[key];
  register("blockContextMenu", "Plexus: Region on image", blockShow("images"), (e) => actions.createPlainImageRegion(e?.["block-uid"]));
  register("blockContextMenu", "Plexus: Present frames", blockShow("drawing"), (e) => actions.presentDrawing({ drawingUid: e?.["block-uid"] }));
  register("blockContextMenu", "Plexus: Mind map from outline", () => true, (e) => actions.mindMapFromOutline(e?.["block-uid"]));
  register("blockContextMenu", "Plexus: Open region", blockShow("region"), (e) => actions.openRegion(e?.["block-uid"], { sidebar: false }));
  register("blockContextMenu", "Plexus: Refresh crop", blockShow("region"), (e) => regionref.refreshRegion(e?.["block-uid"]));
  register("blockContextMenu", LINK_LABEL, (e) => blockInfo(e?.["block-uid"], e?.["block-uid"]).region && candidateOf(e?.["block-uid"], e?.["block-uid"]) != null, (e) => relink(e?.["block-uid"]));
  cropItems("blockContextMenu", (e) => {
    const b = blockInfo(e?.["block-uid"], e?.["block-uid"]);
    return { supported: !!b.region, drawingKind: !!b.drawingKind };
  }, (e) => e?.["block-uid"], (e) => e?.["block-uid"], { insert: false });
  register("blockContextMenu", "Plexus: Refresh crops", blockShow("drawing"), (e) => actions.refreshCropsForDrawing(e?.["block-uid"]));
  register("blockContextMenu", "Plexus: Region settings…", blockShow("drawing"), () => openSettings());
  register("blockContextMenu", "Plexus: Select on drawing", blockShow("drawingKind"), (e) => actions.selectRegionOnDrawing(e?.["block-uid"]));
  register("blockContextMenu", "Plexus: Update region from selection", blockShow("drawingKind"), (e) => actions.updateRegionFromSelection(e?.["block-uid"]));
  register("blockContextMenu", "Plexus: Repair region", blockShow("needsRepair"), async (e) => {
    const uid = e?.["block-uid"];
    await actions.repairRegion(uid);
    clearMemo();
    regionref.refreshRegion?.(uid, { purge: false });
  });
  register("blockContextMenu", "Plexus: Copy region link", blockShow("region"), (e) => actions.copyRegionLink(e?.["block-uid"]));
  const drawingShow = (e) => !!newDrawingOk(e?.["block-uid"], e?.["block-uid"]);
  register("blockContextMenu", "Plexus: New drawing here", drawingShow, (e) => actions.newDrawing({ where: "here", uid: e?.["block-uid"] }));
  register("blockContextMenu", "Plexus: New drawing below", drawingShow, (e) => actions.newDrawing({ where: "below", uid: e?.["block-uid"] }));
  const pageUid = (title) => {
    if (!title) return null;
    try {
      const raw = api.data.pull("[:block/uid]", [":node/title", title]);
      return raw?.[":block/uid"] ?? null;
    } catch {
      return null;
    }
  };
  register("pageContextMenu", "Plexus: New drawing on this page", () => true, (e) => {
    const uid = e?.["page-uid"] ?? pageUid(e?.["page-title"]);
    if (!uid) {
      console.warn("[plexus] new drawing: page not found", e?.["page-title"]);
      return;
    }
    return actions.newDrawing({ where: "here", uid, order: "last" });
  });
  const nodeOf = (uid, memo3) => {
    if (memo3.has(uid)) return memo3.get(uid);
    let value;
    try {
      const raw = api.data.pull("[:block/order :block/string {:block/_children [:block/uid]}]", [":block/uid", uid]);
      const p = raw?.[":block/_children"];
      value = { order: Number(raw?.[":block/order"]) || 0, string: raw?.[":block/string"] ?? "", parent: (Array.isArray(p) ? p[0] : p)?.[":block/uid"] ?? null };
    } catch {
      value = { order: 0, string: "", parent: null };
    }
    memo3.set(uid, value);
    return value;
  };
  const orderPath = (uid, memo3) => {
    const path = [];
    let cur = uid;
    for (let i = 0; cur && i < 100; i++) {
      const n = nodeOf(cur, memo3);
      path.unshift(n.order);
      cur = n.parent;
    }
    return path;
  };
  const inOutlineOrder = (uids, memo3) => {
    const keyed = uids.map((uid, i) => ({ uid, i, path: orderPath(uid, memo3) }));
    keyed.sort((a, b) => {
      for (let k = 0; k < Math.min(a.path.length, b.path.length); k++) if (a.path[k] !== b.path[k]) return a.path[k] - b.path[k];
      return a.path.length - b.path.length || a.i - b.i;
    });
    return keyed.map((x) => x.uid);
  };
  const topMost = (uids, memo3) => {
    const set = new Set(uids);
    return uids.filter((uid) => {
      if (INFRA_START.test(nodeOf(uid, memo3).string)) return false;
      let cur = nodeOf(uid, memo3).parent;
      for (let i = 0; cur && i < 100; i++) {
        if (set.has(cur)) return false;
        cur = nodeOf(cur, memo3).parent;
      }
      return true;
    });
  };
  const editorOpen = () => {
    try {
      return !!(hasEditor ? hasEditor() : native?.activeEditor?.(doc));
    } catch {
      return false;
    }
  };
  register("msContextMenu", "Plexus: Place on drawing", () => true, (arg) => {
    let rows = Array.isArray(arg?.blocks) ? arg.blocks : null;
    if (!rows?.length) {
      try {
        rows = api.ui.multiselect?.getSelected?.() ?? [];
      } catch {
        rows = [];
      }
    }
    const uids = [...new Set((rows || []).map((r) => typeof r === "string" ? r : r?.["block-uid"]).filter(Boolean))];
    if (!uids.length) return;
    const memo3 = /* @__PURE__ */ new Map();
    const ordered = inOutlineOrder(topMost(uids, memo3), memo3);
    if (!ordered.length) {
      console.warn("[plexus] place: nothing left to place after dropping descendants and Plexus containers");
      return;
    }
    return editorOpen() ? actions.placeBlocks(ordered) : actions.armPlace(ordered);
  });
  return function dispose() {
    for (const [menu, label] of added.splice(0)) {
      try {
        const out = menu.removeCommand?.({ label });
        if (out && typeof out.catch === "function") out.catch(() => {
        });
      } catch (error) {
        console.warn("[plexus] menu remove failed", label, error);
      }
    }
  };
}
function installCanvasMenu({ doc, app, containerEl, getItems, raf, caf } = {}) {
  const win = doc?.defaultView;
  const schedule = raf ?? win?.requestAnimationFrame?.bind(win) ?? ((fn) => setTimeout(fn, 16));
  const cancel = caf ?? win?.cancelAnimationFrame?.bind(win) ?? ((id) => clearTimeout(id));
  let pending = null;
  let disposed = false;
  let point = null;
  const removeOurs = (ul) => {
    for (const n of [...ul.querySelectorAll?.("[data-plexus-item]") ?? []]) n.remove?.();
  };
  const make = (tag, className, text) => {
    const n = doc.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    n.setAttribute?.("data-plexus-item", "1");
    return n;
  };
  const inject = (ul) => {
    removeOurs(ul);
    let items = [];
    try {
      items = (getItems(point) || []).filter((i) => i && i.enabled);
    } catch (error) {
      console.warn("[plexus] canvas menu items failed", error);
    }
    if (!items.length) return;
    ul.append(make("hr", "context-menu-item-separator"));
    for (const item of items) {
      const li = make("li");
      li.setAttribute?.("data-testid", `plexus-${item.id}`);
      const button = make("button", "context-menu-item");
      button.type = "button";
      button.append(make("div", "context-menu-item__label", item.label), make("kbd", "context-menu-item__shortcut", item.kbd ?? ""));
      button.addEventListener("click", (e) => {
        e?.preventDefault?.();
        e?.stopPropagation?.();
        try {
          app?.setState?.({ contextMenu: null });
        } catch (error) {
          console.warn("[plexus] close menu failed", error);
        }
        guard(item.label, () => item.run())();
      });
      li.append(button);
      ul.append(li);
    }
    clamp2(ul);
  };
  const clamp2 = (ul) => {
    try {
      const popover = ul.closest?.(".popover") ?? ul.parentNode;
      if (!popover?.getBoundingClientRect) return;
      const rect = popover.getBoundingClientRect();
      const over = rect.bottom - ((win?.innerHeight ?? 0) - 8);
      if (over > 0) {
        const top = parseFloat(popover.style?.top) || 0;
        popover.style.top = `${top - Math.min(over, Math.max(0, rect.top - 8))}px`;
      }
    } catch (error) {
      console.warn("[plexus] menu clamp failed", error);
    }
  };
  const poll = (n) => {
    pending = schedule(() => {
      pending = null;
      if (disposed) return;
      try {
        const ul = containerEl.querySelector(".popover > ul.context-menu");
        if (ul) inject(ul);
        else if (n < 3) poll(n + 1);
      } catch (error) {
        console.warn("[plexus] canvas menu failed", error);
      }
    });
  };
  const onContext = (e) => {
    point = Number.isFinite(e?.clientX) && Number.isFinite(e?.clientY) ? { x: e.clientX, y: e.clientY } : null;
    if (pending != null) {
      cancel(pending);
      pending = null;
    }
    poll(1);
  };
  containerEl.addEventListener("contextmenu", onContext, { passive: true });
  return function dispose() {
    disposed = true;
    containerEl.removeEventListener("contextmenu", onContext, { passive: true });
    if (pending != null) {
      cancel(pending);
      pending = null;
    }
    for (const n of [...containerEl.querySelectorAll?.("[data-plexus-item]") ?? []]) n.remove?.();
  };
}
function plexusCanvasItems({ app, native, actions, openSettings, drawingUid, guard: guard2, point, openPicker, noteAt, toScene, mac = /mac|iphone|ipad/i.test(String(globalThis.navigator?.platform ?? "")) } = {}) {
  const kbd = (id) => hotkeyFor(id, { mac });
  const can = (fn) => {
    try {
      return !!fn();
    } catch {
      return false;
    }
  };
  const call = (name, fn) => () => {
    try {
      const out = fn();
      if (out && typeof out.catch === "function") out.catch((error) => console.warn("[plexus]", name, "failed", error));
    } catch (error) {
      console.warn("[plexus]", name, "failed", error);
    }
  };
  const selectedIds = () => native.selectedElementIds(app);
  const selectedElements = () => {
    const ids = new Set(selectedIds());
    const all = app?.getSceneElementsIncludingDeleted?.() ?? app?.getSceneElements?.() ?? [];
    return all.filter((el) => ids.has(el.id) && !el.isDeleted);
  };
  const noSelection = () => selectedIds().length === 0;
  const freeText = (el) => el.type === "text" && !el.containerId;
  const hasSnapshot = () => (actions.hasSnapshot ?? guard2?.hasSnapshot)?.(drawingUid);
  const pending = () => {
    try {
      return actions.pendingRegionUpdate?.() ?? null;
    } catch {
      return null;
    }
  };
  const pend = pending();
  const placing = (() => {
    try {
      return actions.pendingPlace?.() ?? null;
    } catch {
      return null;
    }
  })();
  return [
    { id: "region", label: "Plexus: Create region", enabled: can(() => selectedIds().length > 0), kbd: kbd("region"), run: call("region", () => actions.createAreaRegion()) },
    { id: "frame", label: "Plexus: Frame region", enabled: can(() => actions.isFrameSelected()), run: call("frame", () => actions.createFrameRegion()) },
    { id: "crop", label: "Plexus: Region from crop", enabled: can(() => actions.hasCroppedImageSelected()), run: call("crop", () => actions.regionFromCrop()) },
    { id: "image", label: "Plexus: Image region", enabled: can(() => actions.hasSingleImageSelected()), kbd: kbd("image"), run: call("image", () => actions.createImageRegion()) },
    { id: "embed", label: "Plexus: Embed block from clipboard", enabled: true, run: call("embed", () => actions.insertEmbedFromClipboard()) },
    { id: "embed-picker", label: "Plexus: Embed page or block…", enabled: !!openPicker, kbd: kbd("embed"), run: call("embed-picker", () => openPicker(point)) },
    { id: "note", label: "Plexus: New note card", enabled: !!noteAt, kbd: kbd("note"), run: call("note", () => noteAt(point)) },
    { id: "edit-embed", label: "Plexus: Edit embed", enabled: can(() => actions.canEditEmbed()), run: call("edit-embed", () => actions.editEmbed()) },
    { id: "present", label: "Plexus: Present", enabled: can(() => actions.hasFrames()), kbd: kbd("present"), run: call("present", () => actions.presentDrawing()) },
    { id: "mindmap", label: "Plexus: Mind map", enabled: true, kbd: kbd("mindmap"), run: call("mindmap", () => actions.startMindMap()) },
    { id: "settings", label: "Plexus: Region settings…", enabled: true, run: () => openSettings() },
    { id: "copy-drawing", label: "Plexus: Copy ((drawing))", enabled: can(() => drawingUid && noSelection()), run: call("copy-drawing", () => actions.copyDrawingRef()) },
    { id: "copy-embed", label: "Plexus: Copy drawing embed", enabled: can(() => drawingUid && noSelection()), run: call("copy-embed", () => actions.copyDrawingEmbed()) },
    { id: "frames-regions", label: "Plexus: Regions for all frames", enabled: can(() => noSelection() && actions.hasFrames()), run: call("frames-regions", () => actions.regionsForAllFrames()) },
    { id: "restore", label: "Plexus: Restore before last Plexus change", enabled: can(() => noSelection() && drawingUid && hasSnapshot()), run: call("restore", () => actions.restoreBeforeLastPlexusChange()) },
    { id: "text-only", label: "Plexus: Select text only", enabled: can(() => {
      const els = selectedElements();
      return els.length >= 2 && els.some(freeText);
    }), run: call("text-only", () => actions.selectTextOnly()) },
    { id: "remove-link", label: "Plexus: Remove link", enabled: can(() => selectedElements().some((el) => el.link)), run: call("remove-link", () => actions.removeElementLink()) },
    ...placing ? [{ id: "place-pending", label: `Plexus: Place ${placing.count} blocks here`, enabled: true, run: call("place-pending", () => actions.placePending(point && toScene ? toScene(point) : void 0)) }] : [],
    ...pend ? [{ id: "apply-pending", label: `Plexus: Update region "${pend.label ?? pend.uid}" from selection`, enabled: can(() => selectedIds().length > 0), run: call("apply-pending", () => actions.applyPendingUpdate()) }] : []
  ];
}

// src/view/caption-prompt.js
var ISOLATED = ["keyup", "keypress", "beforeinput", "input", "paste", "copy", "cut"];
var BLUR_GRACE_MS = 200;
var MIN_WIDTH = 200;
var current = null;
function openCaptionPrompt({ doc, rect, initial = "", select = false, escape = "empty", zIndex = 100002, raf, now = () => Date.now() } = {}) {
  if (current) current.commit();
  let resolveOuter;
  const promise = new Promise((resolve) => {
    resolveOuter = resolve;
  });
  const handle = { el: null, done: false, openedAt: 0, listeners: [], frame: null, cancelFrame: null };
  const win = doc?.defaultView;
  const schedule = raf ?? win?.requestAnimationFrame?.bind(win) ?? ((fn) => setTimeout(fn, 0));
  const unschedule = win?.cancelAnimationFrame?.bind(win) ?? ((id) => clearTimeout(id));
  const finish = (value) => {
    if (handle.done) return;
    handle.done = true;
    if (handle.frame != null && !handle.el) {
      try {
        unschedule(handle.frame);
      } catch {
      }
    }
    const el = handle.el;
    if (el) {
      for (const [type, fn] of handle.listeners.splice(0)) el.removeEventListener?.(type, fn);
      try {
        el.remove?.();
      } catch (error) {
        console.warn("[plexus] caption prompt remove failed", error);
      }
    }
    if (current === handle) current = null;
    resolveOuter(value);
  };
  handle.commit = () => finish(handle.el ? String(handle.el.value ?? "") : String(initial ?? ""));
  promise.cancel = () => finish(null);
  const place = (el) => {
    const vw = win?.innerWidth;
    const vh = win?.innerHeight;
    const r = rect || { left: Number.isFinite(vw) ? Math.max(0, (vw - 480) / 2) : 0, top: 0, width: 0, height: 0 };
    const width = Math.min(Math.max(MIN_WIDTH, r.width || 0), 480, (Number.isFinite(vw) ? vw : Infinity) - 16);
    let left = Number.isFinite(r.left) ? r.left : 0;
    let top = (Number.isFinite(r.top) ? r.top : 0) + (r.height || 0) + 6;
    if (Number.isFinite(vw)) left = Math.max(8, Math.min(left, vw - width - 8));
    if (Number.isFinite(vh)) top = Math.max(8, Math.min(top, vh - 40));
    const s = el.style;
    s.left = `${left}px`;
    s.top = `${top}px`;
    s.width = `${width}px`;
    s.height = "30px";
    s.zIndex = String(zIndex);
  };
  const open4 = () => {
    handle.frame = null;
    if (handle.done) return;
    try {
      const el = doc.createElement("input");
      el.type = "text";
      el.className = "plexus-portal plexus-mm-input plexus-caption-prompt";
      el.value = String(initial ?? "");
      handle.el = el;
      const on = (type, fn) => {
        el.addEventListener(type, fn);
        handle.listeners.push([type, fn]);
      };
      on("keydown", (e) => {
        e.stopPropagation();
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === "Enter") {
          e.preventDefault();
          handle.commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(escape === "cancel" ? null : "");
        }
      });
      for (const type of ISOLATED) on(type, (e) => e.stopPropagation());
      on("blur", (e) => {
        if (handle.done) return;
        if (e?.relatedTarget?.closest?.(".plexus-suggest")) return;
        if (now() - handle.openedAt < BLUR_GRACE_MS) {
          try {
            el.focus?.();
          } catch {
          }
          return;
        }
        handle.commit();
      });
      place(el);
      doc.body.append(el);
      handle.openedAt = now();
      el.focus?.();
      if (select) el.select?.();
      else if (typeof el.setSelectionRange === "function") {
        const n = el.value.length;
        el.setSelectionRange(n, n);
      }
    } catch (error) {
      console.warn("[plexus] caption prompt failed", error);
      finish(null);
    }
  };
  current = handle;
  handle.frame = schedule(open4);
  return promise;
}

// src/view/settings-dialog.js
var STOP_EVENTS2 = ["keydown", "keyup", "keypress", "input", "paste", "copy", "cut", "mousedown", "pointerdown", "wheel", "click"];
var open = /* @__PURE__ */ new WeakMap();
var clampInt = (value, fallback, min, max) => {
  const n = Number(value);
  const base3 = value === "" || value == null || !Number.isFinite(n) ? fallback : n;
  return Math.min(max, Math.max(min, Math.round(base3)));
};
var selectValue = (f, v) => {
  const s = v == null ? "" : String(v);
  return f.options.some(([value]) => value === s) ? s : f.options[f.defaultIndex ?? 0][0];
};
var FIELDS = [
  { id: SETTING_IDS.figureHeight, label: "Image height (px)", type: "number", fallback: 280, min: 80, max: 1200 },
  { id: SETTING_IDS.thumbHeight, label: "Thumbnail height (px)", type: "number", fallback: 72, min: 24, max: 400 },
  { id: SETTING_IDS.inlineDisplay, label: "Region refs inside text", type: "select", options: [["thumbnail", "Thumbnail"], ["link", "Link"]] },
  { id: SETTING_IDS.darkCrops, label: "Match dark theme", type: "checkbox", fallback: true },
  { id: SETTING_IDS.openInSidebar, label: "Open regions in sidebar", type: "checkbox", fallback: false },
  { id: SETTING_IDS.showBacklinks, label: "Show backlinks on canvas", type: "checkbox", fallback: true },
  { id: SETTING_IDS.captionDisplay, label: "Caption under crops", type: "select", options: [["written", "When written"], ["always", "Always"], ["never", "Never"]] },
  { id: SETTING_IDS.captionMode, label: "Caption mode", type: "select", options: [["auto", "Auto"], ["ask", "Ask"], ["none", "None"]] },
  { id: SETTING_IDS.pinSize, label: "Pin size", type: "select", defaultIndex: 1, options: [["4", "4%"], ["8", "8%"], ["12", "12%"]] },
  { id: SETTING_IDS.numberPins, label: "Number pins", type: "checkbox", fallback: false },
  { id: SETTING_IDS.zoomCap, label: "Zoom limit", type: "select", options: [["100", "100%"], ["150", "150%"], ["200", "200%"]] },
  { id: SETTING_IDS.animation, label: "Animation", type: "select", options: [["system", "Follow system"], ["on", "On"], ["off", "Off"]] },
  { id: SETTING_IDS.regionLanding, label: "Open region links in the drawing", type: "checkbox", fallback: false },
  { id: SETTING_IDS.pasteRefs, label: "Paste refs as", type: "select", options: [["text", "Text"], ["embed", "Embed"], ["link", "Link"]] },
  { id: SETTING_IDS.cardHome, label: "New note cards go", type: "select", options: [["drawing", "Under the drawing"], ["page", "On the drawing's page"], ["daily", "On today's page"]] },
  { id: SETTING_IDS.drawingName, label: "New drawing page name", type: "text", fallback: DEFAULT_DRAWING_NAME }
];
var NATIVE_SHORTCUTS = [["Back", "Alt+←"], ["Edit embed", "F2"]];
function openSettingsDialog({ doc, get = () => void 0, set = () => {
}, onChanged = () => {
}, zIndex = 1e5, dark = false, mac } = {}) {
  const existing = open.get(doc);
  if (existing) {
    try {
      existing.focus();
    } catch (error) {
      console.warn("[plexus] settings focus failed", error);
    }
    return existing.handle;
  }
  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  };
  const d = el("dialog", `plexus-portal plexus-settings${dark ? " plexus-settings--dark" : ""}`);
  const stop = (e) => e?.stopPropagation?.();
  for (const type of STOP_EVENTS2) d.addEventListener(type, stop);
  const stored = (f) => {
    let v;
    try {
      v = get(f.id);
    } catch {
      v = void 0;
    }
    if (f.type === "number") return String(clampInt(v, f.fallback, f.min, f.max));
    if (f.type === "select") return selectValue(f, v);
    if (f.type === "text") return drawingNameOf(v);
    return v == null ? f.fallback : !!v;
  };
  const current2 = (f, input) => {
    if (f.type === "number") return String(clampInt(input.value, f.fallback, f.min, f.max));
    if (f.type === "select") return selectValue(f, input.value);
    if (f.type === "text") return drawingNameOf(input.value);
    return !!input.checked;
  };
  const inputs = [];
  d.append(el("div", "plexus-settings-title", "Plexus region settings"));
  for (const f of FIELDS) {
    const row = el("label", "plexus-settings-row");
    row.append(el("span", "plexus-settings-label", f.label));
    let input;
    if (f.type === "select") {
      input = el("select", "plexus-settings-input");
      for (const [value, text] of f.options) {
        const o = el("option", null, text);
        o.value = value;
        input.append(o);
      }
      input.value = stored(f);
    } else if (f.type === "text") {
      input = el("input", "plexus-settings-input");
      input.type = "text";
      input.value = stored(f);
    } else if (f.type === "number") {
      input = el("input", "plexus-settings-input");
      input.type = "number";
      input.min = String(f.min);
      input.max = String(f.max);
      input.value = stored(f);
    } else {
      input = el("input", "plexus-settings-input");
      input.type = "checkbox";
      input.checked = stored(f);
    }
    row.append(input);
    d.append(row);
    inputs.push([f, input]);
  }
  const isMac = mac ?? /mac|iphone|ipad/i.test(String(doc?.defaultView?.navigator?.platform ?? ""));
  d.append(el("div", "plexus-settings-title plexus-settings-subtitle", "Shortcuts"));
  const shortcuts = [...HOTKEYS.map((h) => [h.label, formatHotkey(h.spec, { mac: isMac })]), ...NATIVE_SHORTCUTS];
  for (const [label, keys] of shortcuts) {
    const row = el("div", "plexus-settings-row plexus-settings-shortcut");
    row.append(el("span", "plexus-settings-label", label), el("kbd", "plexus-settings-kbd", keys));
    d.append(row);
  }
  d.append(el("div", "plexus-settings-note", "Mind map is a Roam hotkey: change it in Roam Settings › Hotkeys. The other keys work while a drawing is open."));
  const commit = (only) => {
    const writes = [];
    for (const [f, input] of inputs) {
      if (only && only !== input) continue;
      try {
        const value = current2(f, input);
        if (value === stored(f)) continue;
        writes.push(Promise.resolve(set(f.id, value)).catch((error) => console.warn("[plexus] settings write failed", f.id, error)));
      } catch (error) {
        console.warn("[plexus] settings write failed", f.id, error);
      }
    }
    if (!writes.length) return Promise.resolve();
    return Promise.all(writes).then(() => {
      try {
        onChanged();
      } catch (error) {
        console.warn("[plexus] settings onChanged failed", error);
      }
    });
  };
  for (const [f, input] of inputs) if (f.type !== "text") input.addEventListener("change", () => {
    if (f.type === "number") input.value = current2(f, input);
    commit(input);
  });
  let closed = false;
  const close2 = () => {
    if (closed) return;
    closed = true;
    commit();
    open.delete(doc);
    for (const type of STOP_EVENTS2) d.removeEventListener?.(type, stop);
    d.removeEventListener?.("cancel", close2);
    d.removeEventListener?.("close", close2);
    try {
      if (typeof d.close === "function") d.close();
    } catch (error) {
      console.warn("[plexus] settings close failed", error);
    }
    d.remove?.();
  };
  const actions = el("div", "plexus-settings-actions");
  const closeButton = el("button", "plexus-toolbar-button", "Close");
  closeButton.type = "button";
  closeButton.addEventListener("click", close2);
  actions.append(closeButton);
  d.append(actions);
  d.addEventListener("cancel", close2);
  d.addEventListener("close", close2);
  doc.body.append(d);
  if (typeof d.showModal === "function") d.showModal();
  else {
    d.setAttribute?.("open", "");
    if (d.style) d.style.zIndex = String(zIndex);
  }
  const handle = { close: close2 };
  open.set(doc, { handle, focus: () => (inputs[0][1].focus ?? (() => {
  })).call(inputs[0][1]) });
  return handle;
}

// src/view/embed-picker.js
var TODAY_REF2 = "plexus:today";
var ACTIVE_BG2 = "rgb(213, 218, 223)";
var MIN_Z = 100003;
var WIDTH = 400;
var UID_RE3 = /^[A-Za-z0-9_-]{9}$/;
var SEMANTIC_TIMEOUT = 1500;
var warn2 = (what, error) => console.warn(`[plexus] embed picker ${what} failed`, error);
var open2 = /* @__PURE__ */ new WeakMap();
function openEmbedPicker({
  doc,
  api,
  anchorRect,
  zIndex = 0,
  onPick,
  onCreate,
  onClose,
  semantic = false,
  now = () => /* @__PURE__ */ new Date(),
  setTimeout: setT = (...a) => globalThis.setTimeout(...a),
  clearTimeout: clearT = (...a) => globalThis.clearTimeout(...a),
  requestFrame,
  debounce = { page: 60, block: 150 }
} = {}) {
  const existing = open2.get(doc);
  if (existing) {
    existing.focus();
    return existing.handle;
  }
  const view2 = doc.defaultView;
  const frame = requestFrame || ((fn) => view2?.requestAnimationFrame ? view2.requestAnimationFrame(fn) : setT(fn, 0));
  let items = [];
  let status = "hint";
  let active = 0;
  let seq = 0;
  let timer = null;
  let retakeTimer = null;
  let related = [];
  let query = "";
  let lastMouse = null;
  let rows = [];
  let dead = false;
  let retaken = false;
  let picked = false;
  const root = doc.createElement("div");
  root.className = "rm-autocomplete__results bp3-elevation-3 plexus-portal plexus-picker";
  root.style.zIndex = String(Math.max(zIndex || 0, MIN_Z));
  const input = doc.createElement("input");
  input.className = "plexus-portal plexus-picker-input";
  input.setAttribute("type", "text");
  input.setAttribute("placeholder", "Embed page or block");
  input.setAttribute("spellcheck", "false");
  input.setAttribute("autocomplete", "off");
  const main = doc.createElement("div");
  main.className = "rm-autocomplete__results-main";
  const scroll = doc.createElement("div");
  scroll.className = "rm-autocomplete__results-scroll";
  const footer = doc.createElement("div");
  footer.className = "rm-autocomplete-footer";
  const footerTitle = doc.createElement("div");
  footerTitle.className = "rm-autocomplete-footer__title";
  footerTitle.textContent = "Embed page or block";
  footer.append(footerTitle);
  main.append(scroll, footer);
  root.append(input, main);
  const stop = (e) => e.stopPropagation();
  root.addEventListener("pointerdown", stop);
  root.addEventListener("mousedown", (e) => {
    if (e.target !== input) e.preventDefault();
    e.stopPropagation();
  });
  root.addEventListener("click", stop);
  function place() {
    const a = anchorRect || { left: 100, top: 100 };
    let left = a.left ?? 100;
    let top = (a.bottom ?? a.top ?? 100) + 4;
    const h = root.getBoundingClientRect?.().height || root.offsetHeight || 300;
    const vh = view2?.innerHeight || 0;
    const vw = view2?.innerWidth || 0;
    if (vh && top + h > vh - 8) top = Math.max(8, (a.top ?? top) - h - 4);
    if (vw) left = Math.min(left, vw - WIDTH - 8);
    root.style.left = `${Math.max(8, left)}px`;
    root.style.top = `${top}px`;
  }
  const onWinPointer = (e) => {
    if (!(e?.target && root.contains?.(e.target))) close2();
  };
  const onWinResize = () => {
    try {
      place();
    } catch (error) {
      warn2("resize", error);
    }
  };
  function close2() {
    if (dead) return;
    dead = true;
    seq++;
    if (timer != null) clearT(timer);
    if (retakeTimer != null) clearT(retakeTimer);
    timer = retakeTimer = null;
    view2?.removeEventListener?.("pointerdown", onWinPointer, true);
    view2?.removeEventListener?.("resize", onWinResize);
    root.remove();
    if (open2.get(doc)?.handle === handle) open2.delete(doc);
    try {
      onClose?.({ picked });
    } catch (error) {
      warn2("close callback", error);
    }
  }
  const handle = { close: close2 };
  function setActive(i, scrollTo) {
    active = i;
    rows.forEach((r, k) => {
      r.style.backgroundColor = k === i ? ACTIVE_BG2 : "";
    });
    if (scrollTo) rows[i]?.scrollIntoView?.({ block: "nearest" });
  }
  function segs(parent, text) {
    for (const s of matchSegments(text, query)) {
      const span = doc.createElement("span");
      if (s.match) span.className = "rm-search-match";
      span.textContent = s.text;
      parent.append(span);
    }
  }
  function render() {
    if (dead) return;
    scroll.replaceChildren?.();
    rows = [];
    const message = (text) => {
      const row = doc.createElement("div");
      row.setAttribute("title", text);
      row.className = "dont-unfocus-block";
      Object.assign(row.style, { borderRadius: "2px", padding: "6px", color: "lightgray" });
      const inner = doc.createElement("div");
      inner.className = "rm-autocomplete-result";
      inner.textContent = text;
      row.append(inner);
      scroll.append(row);
    };
    const all = [...items, ...related];
    if (status === "hint") message("Search for a page or block");
    else if (status === "loading") message("Searching");
    else if (status === "error") message("Search failed");
    else if (!all.length) message("Nothing found.");
    else {
      all.forEach((item, k) => {
        if (item.kind === "block" && item.related && !all[k - 1]?.related) {
          const head = doc.createElement("div");
          head.className = "plexus-picker-header";
          head.textContent = "Related";
          scroll.append(head);
        }
        const row = doc.createElement("div");
        row.setAttribute("title", item.kind === "block" ? item.str : item.title);
        row.className = "dont-unfocus-block";
        Object.assign(row.style, { borderRadius: "2px", padding: "6px", cursor: "pointer" });
        const inner = doc.createElement("div");
        inner.className = "rm-autocomplete-result";
        const label = doc.createElement("span");
        if (item.kind === "create") label.textContent = `+ Create page ${item.title}`;
        else if (item.kind === "today") label.textContent = "Today (always today)";
        else segs(label, item.kind === "block" ? blockSnippet(item.str, query) : item.title);
        inner.append(label);
        row.append(inner);
        const subText = item.kind === "date" ? "Daily note" : item.kind === "block" ? item.pageTitle : "";
        if (subText) {
          const sub = doc.createElement("div");
          sub.className = "bp3-text-overflow-ellipsis";
          sub.style.color = "rgb(129, 145, 157)";
          sub.textContent = subText;
          row.append(sub);
        }
        row.addEventListener("mousemove", (e) => {
          if (lastMouse && lastMouse[0] === e.clientX && lastMouse[1] === e.clientY) return;
          lastMouse = [e.clientX, e.clientY];
          setActive(k, false);
        });
        row.addEventListener("click", (e) => {
          e.stopPropagation();
          commit(item);
        });
        scroll.append(row);
        rows.push(row);
      });
    }
    setActive(Math.min(active, Math.max(rows.length - 1, 0)), false);
    place();
  }
  function commit(item) {
    if (dead || !item) return;
    picked = true;
    close2();
    try {
      if (item.kind === "create") onCreate?.(item.title);
      else if (item.kind === "today") onPick?.({ kind: "today", ref: TODAY_REF2, title: "Today" });
      else if (item.kind === "block") onPick?.({ kind: "block", ref: `((${item.uid}))`, title: item.str, uid: item.uid });
      else onPick?.({ kind: "page", ref: `[[${item.title}]]`, title: item.title, uid: item.uid });
    } catch (error) {
      warn2("callback", error);
    }
  }
  const pageOf = (r) => ({ kind: "page", title: r[":node/title"] ?? r.title, uid: r[":block/uid"] ?? r.uid });
  const blockOf = async (r) => {
    const uid = r[":block/uid"] ?? r.uid;
    let pageTitle = "";
    try {
      const pulled = await api.data.pull("[{:block/page [:node/title]}]", [":block/uid", uid]);
      pageTitle = pulled?.[":block/page"]?.[":node/title"] ?? "";
    } catch {
    }
    return { kind: "block", uid, str: r[":block/string"] ?? r.string ?? "", pageTitle };
  };
  async function direct(q) {
    const m = /^(?:\(\()?([A-Za-z0-9_-]{9})(?:\)\))?$/.exec(q);
    if (!m || !UID_RE3.test(m[1])) return null;
    try {
      const pulled = await api.data.pull("[:block/uid :block/string :node/title]", [":block/uid", m[1]]);
      if (!pulled) return null;
      if (pulled[":node/title"] != null) return { kind: "page", title: pulled[":node/title"], uid: m[1] };
      if (pulled[":block/string"] == null && pulled[":block/uid"] == null) return null;
      return { kind: "block", uid: m[1], str: pulled[":block/string"] ?? "", pageTitle: "" };
    } catch {
      return null;
    }
  }
  const todayRow = (q) => {
    const t = q.trim().toLowerCase();
    return !t || t.length >= 2 && "today".startsWith(t);
  };
  async function withTimeout(promise) {
    let t;
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        t = setT(() => reject(new Error("timeout")), SEMANTIC_TIMEOUT);
      })]);
    } finally {
      if (t != null) clearT(t);
    }
  }
  async function search(raw, mine) {
    const blocksOnly = raw.startsWith("((");
    const pagesOnly = raw.startsWith("[[");
    const q = raw.replace(/^\(\(|^\[\[/, "").replace(/\)\)$|\]\]$/, "").trim();
    try {
      const wantPages = !blocksOnly;
      const wantBlocks = !pagesOnly;
      const [pageRes, blockRes, hit] = await Promise.all([
        wantPages ? api.data.async.search({ "search-str": q, "search-pages": true, "search-blocks": false, limit: 8 }) : [],
        wantBlocks ? api.data.async.search({ "search-str": q, "search-pages": false, "search-blocks": true, "hide-code-blocks": true, limit: 8 }) : [],
        direct(raw.replace(/\s+/g, ""))
      ]);
      const foundPages = (pageRes || []).map(pageOf);
      const foundBlocks = await Promise.all((blockRes || []).map(blockOf));
      let dateTitle = "";
      if (wantPages && !blocksOnly) {
        try {
          const date = parseNaturalDate(q, now());
          if (date && typeof api.util?.dateToPageTitle === "function") dateTitle = api.util.dateToPageTitle(date) || "";
        } catch (error) {
          warn2("date row", error);
        }
      }
      const canCreate = wantPages && typeof onCreate === "function";
      const title = normalizeCreateTitle(q);
      let exists = false;
      if (canCreate && title && !foundPages.some((r) => r.title?.toLowerCase() === title.toLowerCase())) {
        try {
          const pulled = await api.data.pull("[:node/title]", [":node/title", title]);
          exists = !!pulled?.[":node/title"];
        } catch {
        }
      }
      if (mine !== seq || dead) return;
      const pageRows = wantPages ? buildPageRows({ query: q, results: foundPages, dateTitle, canCreate: false, exists }) : [];
      const list = [];
      if (wantPages && todayRow(q)) list.push({ kind: "today" });
      if (hit && !list.some((r) => r.uid === hit.uid)) list.push(hit);
      const seen = new Set(list.map((r) => r.uid).filter(Boolean));
      for (const r of pageRows) if (!r.uid || !seen.has(r.uid)) list.push(r);
      for (const b of foundBlocks) if (!seen.has(b.uid)) list.push(b);
      if (canCreate && title && !exists && !pageRows.some((r) => r.title?.toLowerCase() === title.toLowerCase()) && !list.some((r) => r.kind === "date" && r.title.toLowerCase() === title.toLowerCase())) list.push({ kind: "create", title });
      items = list;
      related = [];
      status = "results";
      active = 0;
      query = q;
      render();
      if (semantic === true && wantBlocks) semanticSection(q, mine, /* @__PURE__ */ new Set([...seen, ...foundBlocks.map((b) => b.uid)]));
    } catch (error) {
      if (mine !== seq || dead) return;
      warn2("search", error);
      items = [];
      related = [];
      status = "error";
      render();
    }
  }
  async function semanticSection(q, mine, skip) {
    try {
      const fn = api.data?.async?.semanticSearch;
      if (typeof fn !== "function") return;
      const res = await withTimeout(Promise.resolve(fn.call(api.data.async, { "search-str": q, limit: 5 })));
      if (mine !== seq || dead) return;
      const out = [];
      for (const r of res || []) {
        const uid = r[":block/uid"] ?? r.uid;
        if (!uid || skip.has(uid)) continue;
        out.push({ kind: "block", uid, str: r[":block/string"] ?? r.string ?? r[":node/title"] ?? "", pageTitle: "", related: true });
      }
      if (!out.length) return;
      related = out;
      render();
    } catch {
    }
  }
  function onInput() {
    if (dead) return;
    const raw = String(input.value ?? "").trim();
    const q = raw.replace(/^\(\(|^\[\[/, "").replace(/\)\)$|\]\]$/, "").trim();
    seq++;
    if (timer != null) {
      clearT(timer);
      timer = null;
    }
    active = 0;
    related = [];
    query = q;
    if (!q) {
      items = raw ? [] : [{ kind: "today" }];
      status = raw ? "hint" : "results";
      render();
      return;
    }
    items = !raw.startsWith("((") && !raw.startsWith("[[") && todayRow(raw) ? [{ kind: "today" }] : [];
    status = items.length ? "results" : "loading";
    render();
    const mine = seq;
    timer = setT(() => {
      timer = null;
      if (mine !== seq || dead) return;
      search(raw, mine);
    }, raw.startsWith("[[") ? debounce.page ?? 60 : debounce.block ?? 150);
  }
  function onKeydown(e) {
    e.stopPropagation();
    if (dead || e.isComposing || e.keyCode === 229) return;
    const ctrlOnly = e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
    const bare = plain && !e.shiftKey;
    let move = 0;
    let doCommit = false;
    if (bare && e.key === "ArrowDown") move = 1;
    else if (bare && e.key === "ArrowUp") move = -1;
    else if (ctrlOnly && e.key === "n") move = 1;
    else if (ctrlOnly && e.key === "p") move = -1;
    else if (plain && (e.key === "Enter" || bare && e.key === "Tab")) doCommit = true;
    else if (e.key === "Escape") {
      e.preventDefault();
      close2();
      return;
    } else return;
    e.preventDefault();
    if (move) {
      if (rows.length) setActive((active + move + rows.length) % rows.length, true);
    } else if (doCommit) {
      if (status === "loading") return;
      const all = [...items, ...related];
      if (status === "results" && all[active]) commit(all[active]);
    }
  }
  function onBlur() {
    if (dead) return;
    if (retakeTimer != null && !retaken) {
      retaken = true;
      input.focus?.({ preventScroll: true });
      return;
    }
    close2();
  }
  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onKeydown);
  input.addEventListener("blur", onBlur);
  open2.set(doc, { handle, focus: () => {
    try {
      input.focus?.({ preventScroll: true });
    } catch {
    }
  } });
  frame(() => {
    if (dead) return;
    try {
      doc.body.append(root);
      view2?.addEventListener?.("pointerdown", onWinPointer, true);
      view2?.addEventListener?.("resize", onWinResize);
      place();
      onInput();
      input.focus?.({ preventScroll: true });
      retakeTimer = setT(() => {
        retakeTimer = null;
        if (dead) return;
        if (!retaken && doc.activeElement !== input) {
          retaken = true;
          input.focus?.({ preventScroll: true });
        }
      }, 200);
    } catch (error) {
      warn2("open", error);
      close2();
    }
  });
  return handle;
}

// src/view/command-list.js
var ACTIVE_BG3 = "rgb(213, 218, 223)";
var MIN_Z2 = 100003;
var warn3 = (what, ...rest) => console.warn(`[plexus] ${what}`, ...rest);
var open3 = /* @__PURE__ */ new WeakMap();
function filterCommands(commands, query) {
  const tokens2 = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens2.length) return [...commands];
  return commands.filter((c) => {
    const label = String(c.label ?? "").toLowerCase();
    return tokens2.every((t) => label.includes(t));
  });
}
function openCommandList({
  doc,
  commands = [],
  ctx = {},
  zIndex = 0,
  onClose,
  setTimeout: setT = (...a) => globalThis.setTimeout(...a)
} = {}) {
  const existing = open3.get(doc);
  if (existing) {
    existing.focus();
    return existing.handle;
  }
  let dead = false;
  let active = 0;
  let rows = [];
  let matches = [];
  let lastMouse = null;
  const root = doc.createElement("div");
  root.className = "rm-autocomplete__results bp3-elevation-3 plexus-portal plexus-picker plexus-cmdlist";
  root.style.zIndex = String(Math.max(zIndex || 0, MIN_Z2));
  const input = doc.createElement("input");
  input.className = "plexus-portal plexus-picker-input";
  input.setAttribute("type", "text");
  input.setAttribute("placeholder", "Plexus command");
  input.setAttribute("spellcheck", "false");
  input.setAttribute("autocomplete", "off");
  const main = doc.createElement("div");
  main.className = "rm-autocomplete__results-main";
  const scroll = doc.createElement("div");
  scroll.className = "rm-autocomplete__results-scroll";
  const footer = doc.createElement("div");
  footer.className = "rm-autocomplete-footer";
  const footerTitle = doc.createElement("div");
  footerTitle.className = "rm-autocomplete-footer__title";
  footerTitle.textContent = "Plexus commands";
  footer.append(footerTitle);
  main.append(scroll, footer);
  root.append(input, main);
  const stop = (e) => e.stopPropagation();
  root.addEventListener("pointerdown", stop);
  root.addEventListener("mousedown", (e) => {
    if (e.target !== input) e.preventDefault();
    e.stopPropagation();
  });
  root.addEventListener("click", stop);
  const onDocPointer = (e) => {
    if (!(e?.target && root.contains?.(e.target))) close2();
  };
  function close2() {
    if (dead) return;
    dead = true;
    doc.removeEventListener?.("pointerdown", onDocPointer, true);
    root.remove();
    if (open3.get(doc)?.handle === handle) open3.delete(doc);
    try {
      onClose?.();
    } catch (error) {
      warn3("command list close callback failed", error);
    }
  }
  const focus = () => {
    try {
      input.focus?.({ preventScroll: true });
    } catch {
    }
  };
  const handle = { close: close2, focus };
  function setActive(i, scrollTo) {
    active = i;
    rows.forEach((r, k) => {
      r.style.backgroundColor = k === i ? ACTIVE_BG3 : "";
    });
    if (scrollTo) rows[i]?.scrollIntoView?.({ block: "nearest" });
  }
  function run(cmd) {
    if (dead || !cmd) return;
    close2();
    setT(() => {
      try {
        const out = cmd.run(ctx);
        if (out && typeof out.catch === "function") out.catch((error) => warn3("command failed", cmd.id, error));
      } catch (error) {
        warn3("command failed", cmd.id, error);
      }
    }, 0);
  }
  function render() {
    if (dead) return;
    scroll.replaceChildren?.();
    rows = [];
    matches = filterCommands(commands, input.value);
    if (!matches.length) {
      const row = doc.createElement("div");
      row.className = "dont-unfocus-block plexus-cmdlist-empty";
      Object.assign(row.style, { borderRadius: "2px", padding: "6px" });
      const inner = doc.createElement("div");
      inner.className = "rm-autocomplete-result";
      inner.textContent = "No matching command";
      row.append(inner);
      scroll.append(row);
    }
    matches.forEach((cmd, k) => {
      const row = doc.createElement("div");
      row.setAttribute("title", cmd.label);
      row.className = "dont-unfocus-block";
      Object.assign(row.style, { borderRadius: "2px", padding: "6px", cursor: "pointer" });
      const inner = doc.createElement("div");
      inner.className = "rm-autocomplete-result";
      const label = doc.createElement("span");
      label.textContent = cmd.label;
      inner.append(label);
      if (cmd.hotkey) {
        const kbd = doc.createElement("kbd");
        kbd.className = "plexus-cmdlist-kbd";
        kbd.textContent = cmd.hotkey;
        inner.append(kbd);
      }
      row.append(inner);
      row.addEventListener("mousemove", (e) => {
        if (lastMouse && lastMouse[0] === e.clientX && lastMouse[1] === e.clientY) return;
        lastMouse = [e.clientX, e.clientY];
        setActive(k, false);
      });
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        run(cmd);
      });
      scroll.append(row);
      rows.push(row);
    });
    setActive(Math.min(active, Math.max(rows.length - 1, 0)), false);
  }
  function onInput() {
    if (dead) return;
    active = 0;
    render();
  }
  function onKeydown(e) {
    e.stopPropagation();
    if (dead || e.isComposing || e.keyCode === 229) return;
    const ctrlOnly = e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
    const bare = plain && !e.shiftKey;
    let move = 0;
    let doRun = false;
    if (bare && e.key === "ArrowDown") move = 1;
    else if (bare && e.key === "ArrowUp") move = -1;
    else if (ctrlOnly && e.key === "n") move = 1;
    else if (ctrlOnly && e.key === "p") move = -1;
    else if (plain && e.key === "Enter") doRun = true;
    else if (e.key === "Escape") {
      e.preventDefault();
      close2();
      return;
    } else return;
    e.preventDefault();
    if (move) {
      if (rows.length) setActive((active + move + rows.length) % rows.length, true);
    } else if (doRun) run(matches[active]);
  }
  function onBlur() {
    if (dead) return;
    setT(() => {
      if (dead) return;
      const a = doc.activeElement;
      if (!a || !root.contains?.(a)) close2();
    }, 0);
  }
  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onKeydown);
  input.addEventListener("keyup", stop);
  input.addEventListener("keypress", stop);
  input.addEventListener("blur", onBlur);
  open3.set(doc, { handle, focus });
  try {
    doc.body.append(root);
    doc.addEventListener?.("pointerdown", onDocPointer, true);
    render();
    setT(() => {
      if (!dead) focus();
    }, 0);
  } catch (error) {
    warn3("command list open failed", error);
    close2();
  }
  return handle;
}

// src/view/paste.js
var PLAIN_WINDOW_MS = 100;
function within2(node, root) {
  for (let n = node; n; n = n.parentNode ?? n.parentElement) if (n === root) return true;
  return false;
}
function isEditable(t) {
  if (!t) return false;
  const tag = String(t.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || t.isContentEditable === true;
}
function pastedRef(text) {
  const t = typeof text === "string" ? text.trim() : "";
  if (!t || t.includes("\n") || !(t.startsWith("((") || t.startsWith("[["))) return null;
  const parsed = parseEmbedRef(t);
  return parsed && (parsed.kind === "block" || parsed.kind === "page") ? parsed : null;
}
function installRefPaste({ doc, containerEl, app, getSettings, exists, onRef, now = () => Date.now() }) {
  let last = null;
  let plainAt = -Infinity;
  const onMove = (e) => {
    last = { x: e.clientX, y: e.clientY };
  };
  const onKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.code === "KeyV" || String(e.key).toLowerCase() === "v")) plainAt = now();
  };
  const onPaste = (e) => {
    try {
      let mode = "text";
      try {
        mode = getSettings?.()?.pasteRefs ?? "text";
      } catch {
        mode = "text";
      }
      if (mode === "text" || mode !== "embed" && mode !== "link") return;
      if (isEditable(e.target) || app?.state?.editingTextElement) return;
      if (now() - plainAt <= PLAIN_WINDOW_MS) return;
      if (!last) return;
      const under = doc.elementFromPoint?.(last.x, last.y);
      if (!under || String(under.tagName ?? "").toUpperCase() !== "CANVAS" || !within2(under, containerEl)) return;
      const cd = e.clipboardData;
      if (!cd || cd.files?.length || [...cd.types ?? []].includes("Files")) return;
      const parsed = pastedRef(cd.getData?.("text/plain"));
      if (!parsed || !exists?.(parsed.ref)) return;
      e.preventDefault?.();
      e.stopPropagation?.();
      const st = app?.state ?? {};
      const scenePoint = viewportToScene({ x: last.x, y: last.y, appState: st });
      Promise.resolve(onRef({ kind: parsed.kind, ref: parsed.ref, scenePoint })).catch((error) => console.warn("[plexus] ref paste failed", error));
    } catch (error) {
      console.warn("[plexus] ref paste failed", error);
    }
  };
  containerEl.addEventListener("pointermove", onMove, { passive: true });
  containerEl.addEventListener("keydown", onKey, true);
  containerEl.addEventListener("paste", onPaste, true);
  return () => {
    containerEl.removeEventListener("pointermove", onMove, { passive: true });
    containerEl.removeEventListener("keydown", onKey, true);
    containerEl.removeEventListener("paste", onPaste, true);
  };
}

// src/view/note-tool.js
var DRAG_PX = 4;
var ARM_TIMEOUT_MS = 3e4;
var ATTR = "data-plexus-note-armed";
var CLICK_EVENTS = ["pointerdown", "pointerup", "mousedown", "mouseup", "click"];
var swallow2 = (e) => {
  e.preventDefault?.();
  e.stopImmediatePropagation?.();
};
function installNoteTool({ doc, containerEl, app, canArm = () => true, onPlace, setTimeout: setTimer = globalThis.setTimeout, clearTimeout: clearTimer = globalThis.clearTimeout }) {
  let armed = false;
  let timer = null;
  let down = null;
  const isCanvas = (t) => !!t && (typeof t.matches === "function" ? t.matches("canvas.excalidraw__canvas.interactive") : String(t.tagName ?? "").toUpperCase() === "CANVAS");
  const plain = (e) => (e.button ?? 0) === 0 && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
  function disarm() {
    if (!armed) return;
    armed = false;
    down = null;
    if (timer != null) {
      clearTimer(timer);
      timer = null;
    }
    for (const t of CLICK_EVENTS) containerEl.removeEventListener(t, onPointer, true);
    doc.removeEventListener?.("keydown", onKey, true);
    doc.body?.removeAttribute?.(ATTR);
  }
  function onKey(e) {
    if (e.key !== "Escape" || e.isComposing) return;
    swallow2(e);
    disarm();
  }
  function onPointer(e) {
    if (!armed) return;
    if (app?.state?.editingTextElement) {
      disarm();
      return;
    }
    if (!isCanvas(e.target)) {
      if (e.type === "pointerdown" || e.type === "mousedown") disarm();
      return;
    }
    if (!plain(e)) return;
    swallow2(e);
    if (e.type === "pointerdown") {
      down = { x: e.clientX, y: e.clientY };
    } else if (e.type === "pointerup" && down) {
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved >= DRAG_PX) return;
      const scenePoint = viewportToScene({ x: e.clientX, y: e.clientY, appState: app?.state ?? {} });
      disarm();
      try {
        Promise.resolve(onPlace(scenePoint)).catch((error) => console.warn("[plexus] note place failed", error));
      } catch (error) {
        console.warn("[plexus] note place failed", error);
      }
    }
  }
  function arm() {
    if (armed) return true;
    let ok = false;
    try {
      ok = !!canArm();
    } catch {
      ok = false;
    }
    if (!ok || app?.state?.editingTextElement) return false;
    armed = true;
    for (const t of CLICK_EVENTS) containerEl.addEventListener(t, onPointer, true);
    doc.addEventListener?.("keydown", onKey, true);
    doc.body?.setAttribute?.(ATTR, "");
    timer = setTimer(disarm, ARM_TIMEOUT_MS);
    return true;
  }
  return { arm, disarm, armed: () => armed, dispose: disarm };
}

// src/view/hotkeys.js
var HOTKEY_CODES = Object.freeze({
  KeyR: "region",
  KeyI: "image",
  KeyP: "present",
  KeyM: "mindmap",
  KeyE: "embed",
  KeyN: "note",
  KeyO: "dock"
});
var DEDUPE_MS = 300;
var isTextTarget = (el) => {
  if (!el) return false;
  const tag = String(el.tagName ?? "").toLowerCase();
  return tag === "input" || tag === "textarea" || el.isContentEditable === true;
};
function createHotkeyRunner({ handlers, getApp = () => null, doc = () => globalThis.document, now = () => Date.now(), dedupeMs = DEDUPE_MS } = {}) {
  const lastAt = /* @__PURE__ */ new Map();
  return function runOnce(id) {
    try {
      const t = now();
      const prev = lastAt.get(id);
      if (prev != null && t - prev < dedupeMs) return void 0;
      const app = getApp();
      if (app) {
        const d = typeof doc === "function" ? doc() : doc;
        const a = d?.activeElement;
        const guarded = isTextTarget(a) && !!a.closest?.(".excalidraw-outer-container, .plexus-portal, textarea.rm-block-input, .rm-block__input");
        if (app.state?.editingTextElement || guarded) return void 0;
      }
      lastAt.set(id, t);
      const handler = handlers?.[id];
      if (!handler) {
        console.warn("[plexus] unavailable outside Roam:", id);
        return void 0;
      }
      const out = handler();
      if (out && typeof out.catch === "function") return out.catch((error) => console.warn("[plexus] hotkey", id, "failed", error));
      return out;
    } catch (error) {
      console.warn("[plexus] hotkey", id, "failed", error);
      return void 0;
    }
  };
}
function installHotkeyGuard({ containerEl, run, doc } = {}) {
  const target = doc?.addEventListener ? doc : containerEl;
  if (!containerEl?.addEventListener || !target?.addEventListener) return () => {
  };
  const onKey = (e) => {
    try {
      if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey || e.isComposing) return;
      const id = HOTKEY_CODES[e.code];
      if (!id) return;
      const t = e.target;
      const inside = t === containerEl || t === doc?.body || t === doc?.documentElement || containerEl.contains?.(t) && !isTextTarget(t) && t?.dataset?.type !== "wysiwyg";
      if (!inside) return;
      e.preventDefault?.();
      e.stopImmediatePropagation?.();
      run(id);
    } catch (error) {
      console.warn("[plexus] hotkey guard failed", error);
    }
  };
  target.addEventListener("keydown", onKey, true);
  return () => target.removeEventListener("keydown", onKey, true);
}

// src/view/dock.js
var PLEXUS_REF_MIME = "application/x-plexus-ref";
var DOCK_MIN_WIDTH = 240;
var DOCK_MAX_WIDTH = 640;
var DOCK_MENU_SELECTOR = ".rm-autocomplete__results, .bp3-menu, .bp3-overlay-open:not(.bp3-toast-container), .bp3-popover:not(.bp3-tooltip)";
var LEAVE_WAIT_MS2 = 300;
var SELECTION_RECHECK_MS2 = 100;
var REFOCUS_WINDOW_MS2 = 1200;
var STRAY_FOCUS_MS = 500;
var POLL_MS = 25;
var ADD_POLL_MAX_MS = 1e3;
var FOCUS_WAIT_MS2 = 300;
var LABEL_MAX = 60;
var CHILDREN_PATTERN = "[:block/uid {:block/children [:block/uid :block/order]}]";
var REF_SELECTOR = "[data-link-title], [data-tag], .rm-page-ref, .rm-block-ref[data-uid], .rm-alias[data-link-uid], .rm-alias[data-link-title]";
var POPUP_HOST_SELECTOR2 = ".bp3-portal";
var BLOCK_SELECTOR = '.rm-block__input, [id^="block-input-"]';
var MENU_ESC_SETTLE_MS = 150;
var MENU_KEYS2 = /* @__PURE__ */ new Set(["Escape", "Enter", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"]);
var KEY_EVENTS2 = ["keydown", "keyup", "keypress", "input", "paste", "copy", "cut"];
var POINTER_EVENTS = ["pointerdown", "mousedown", "wheel", "dblclick", "contextmenu"];
var synthetic = false;
function within3(node, root) {
  for (let n = node; n; n = n.parentNode ?? n.parentElement) if (n === root) return true;
  return false;
}
var swallow3 = (e) => {
  e.preventDefault?.();
  e.stopImmediatePropagation?.();
};
var isTextarea = (n) => n?.tagName === "TEXTAREA";
var hasClass = (n, name) => n?.classList ? n.classList.contains(name) : String(n?.className ?? "").split(/\s+/).includes(name);
var addClass = (n, name) => {
  if (n?.classList) n.classList.add(name);
  else if (n && !hasClass(n, name)) n.className = `${n.className} ${name}`.trim();
};
var removeClass = (n, name) => {
  if (n?.classList) n.classList.remove(name);
  else if (n) n.className = String(n.className).split(/\s+/).filter((c) => c && c !== name).join(" ");
};
var clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
var uidOfId = (id) => String(id ?? "").slice(-9);
var sameKeys = (a = {}, b = {}) => {
  const ka = Object.keys(a).filter((k) => a[k]);
  const kb = Object.keys(b).filter((k) => b[k]);
  return ka.length === kb.length && ka.every((k) => b[k]);
};
function createDock({
  doc,
  api = globalThis.roamAlphaAPI,
  app,
  containerEl,
  outerEl,
  drawingUid,
  zIndex = 1e3,
  width = 320,
  onWidth = () => {
  },
  onClose = () => {
  },
  onNavigate = () => {
  },
  mac,
  parentOf = () => null,
  addBlock = async () => null,
  toast = () => {
  },
  raf,
  setTimeout: setTimer = globalThis.setTimeout,
  clearTimeout: clearTimer = globalThis.clearTimeout,
  MutationObserver: MO,
  menuSelector = DOCK_MENU_SELECTOR,
  now = () => Date.now()
}) {
  const view2 = doc.defaultView;
  const requestFrame = raf ?? ((cb) => typeof view2?.requestAnimationFrame === "function" ? view2.requestAnimationFrame(cb) : setTimer(cb, 16));
  const isMac = mac ?? /Mac/i.test(String(view2?.navigator?.platform ?? ""));
  const MutationObs = MO ?? view2?.MutationObserver ?? globalThis.MutationObserver;
  let open4 = true;
  let rootKind = "drawing";
  let rootUid = drawingUid;
  let childUids = [];
  const hosts = /* @__PURE__ */ new Map();
  let unwatch = null;
  let editing = false;
  let focusUid = null;
  let lastTa = null;
  let lastCaret = null;
  let lastKeyAt = 0;
  let strayLogged = false;
  let requestedWidth = clamp(Number(width) || 320, DOCK_MIN_WIDTH, DOCK_MAX_WIDTH);
  let applyQueued = false;
  let drag = null;
  let narrowMode = "narrowed";
  let escapeVia = null;
  let focusGen = 0;
  let clearGen = 0;
  let rootGen = 0;
  let closePromise = null;
  let overlayLogged = false;
  const pending = /* @__PURE__ */ new Set();
  const offs = [];
  const warn5 = (what, error) => console.warn(`[plexus] dock ${what}`, error);
  const safe = (what, fn) => (...args) => {
    try {
      return fn(...args);
    } catch (error) {
      warn5(`${what} failed`, error);
      return void 0;
    }
  };
  const on = (target, type, fn, capture = false) => {
    if (!target?.addEventListener) return;
    target.addEventListener(type, fn, capture);
    offs.push(() => target.removeEventListener?.(type, fn, capture));
  };
  const wait = (ms) => new Promise((resolve) => {
    let rec = null;
    const t = setTimer(() => {
      pending.delete(rec);
      resolve(true);
    }, ms);
    rec = { cancel: () => {
      clearTimer(t);
      resolve(false);
    } };
    pending.add(rec);
  });
  const frames = (n) => new Promise((resolve) => {
    let left = n;
    const rec = { live: true, cancel: () => {
      rec.live = false;
      resolve(false);
    } };
    pending.add(rec);
    const tick = () => {
      if (!rec.live) return;
      left -= 1;
      if (left <= 0) {
        pending.delete(rec);
        resolve(true);
      } else requestFrame(tick);
    };
    requestFrame(tick);
  });
  const cancelPending = () => {
    for (const rec of [...pending]) rec.cancel();
    pending.clear();
  };
  const el = doc.createElement("div");
  el.className = "plexus-portal plexus-dock";
  el.style.zIndex = String(zIndex + 2);
  el.setAttribute?.("role", "complementary");
  el.setAttribute?.("aria-label", "Outline");
  const handle = doc.createElement("div");
  handle.className = "plexus-dock-handle";
  const header = doc.createElement("div");
  header.className = "plexus-dock-header";
  const label = doc.createElement("div");
  label.className = "plexus-dock-label";
  const parentBtn = doc.createElement("button");
  parentBtn.className = "plexus-dock-button plexus-dock-parent";
  parentBtn.textContent = "Parent";
  parentBtn.setAttribute?.("type", "button");
  const closeBtn = doc.createElement("button");
  closeBtn.className = "plexus-dock-button plexus-dock-close";
  closeBtn.textContent = "×";
  closeBtn.setAttribute?.("type", "button");
  closeBtn.setAttribute?.("aria-label", "Close outline");
  const body = doc.createElement("div");
  body.className = "plexus-dock-body";
  const footer = doc.createElement("div");
  footer.className = "plexus-dock-footer";
  const addBtn = doc.createElement("button");
  addBtn.className = "plexus-dock-add";
  addBtn.textContent = "+ Add a block";
  addBtn.setAttribute?.("type", "button");
  footer.append(addBtn);
  header.append(label, parentBtn, closeBtn);
  el.append(handle, header, body, footer);
  const styleEl = doc.createElement("style");
  styleEl.setAttribute?.("data-plexus-dock", "");
  const styleHost = doc.head ?? doc.body;
  let parentInfo = null;
  try {
    parentInfo = parentOf(drawingUid) ?? null;
  } catch (error) {
    warn5("parentOf failed", error);
  }
  const hasParent = !!parentInfo && parentInfo.isPage === false && !!parentInfo.uid;
  parentBtn.hidden = !hasParent;
  if (!hasParent) parentBtn.setAttribute?.("hidden", "");
  const effectiveWidth = () => {
    const inner = Number(view2?.innerWidth) || DOCK_MAX_WIDTH * 2;
    return clamp(requestedWidth, DOCK_MIN_WIDTH, Math.max(DOCK_MIN_WIDTH, Math.min(DOCK_MAX_WIDTH, Math.floor(inner / 2))));
  };
  let theme = null;
  let themeBg = null;
  const hostBackground = () => {
    for (const node of [doc.body, doc.documentElement]) {
      if (!node) continue;
      const c = parseColor(view2?.getComputedStyle?.(node)?.backgroundColor);
      if (c && c.a > 0) return String(view2.getComputedStyle(node).backgroundColor);
    }
    return null;
  };
  const applyTheme = () => {
    const next = isHostDark(doc) ? "dark" : "light";
    if (next !== theme) {
      theme = next;
      el.setAttribute?.("data-theme", next);
    }
    const bg = hostBackground();
    if (bg !== themeBg) {
      themeBg = bg;
      if (bg == null) el.style.removeProperty?.("--plexus-dock-bg");
      else if (typeof el.style.setProperty === "function") el.style.setProperty("--plexus-dock-bg", bg);
      else el.style["--plexus-dock-bg"] = bg;
    }
  };
  const refreshTheme = () => {
    if (!open4) return;
    resetThemeMemo();
    applyTheme();
  };
  const applyWidth = () => {
    styleEl.textContent = `.plexus-dock-narrowed, .plexus-dock { --plexus-dock-w: ${effectiveWidth()}px; } body.plexus-dock-open { --plexus-dock-z: ${zIndex + 2}; }`;
    applyTheme();
  };
  const scheduleApply = () => {
    if (applyQueued || !open4) return;
    applyQueued = true;
    requestFrame(() => {
      applyQueued = false;
      if (open4) applyWidth();
    });
  };
  const widthOf = () => app?.state?.width;
  async function verifyNarrow(w0) {
    if (typeof w0 !== "number") return;
    if (!await frames(2)) return;
    if (widthOf() !== w0) return;
    try {
      const Ev = view2?.Event ?? globalThis.Event;
      view2?.dispatchEvent?.(new Ev("resize"));
    } catch (error) {
      warn5("resize dispatch failed", error);
    }
    if (!await frames(2)) return;
    if (widthOf() !== w0) return;
    narrowMode = "overlay";
    removeClass(outerEl, "plexus-dock-narrowed");
    addClass(el, "plexus-dock--overlay");
    try {
      const icon = outerEl?.querySelector?.(".bp3-icon-minimize");
      const rect = icon?.getBoundingClientRect?.();
      if (rect && Number.isFinite(rect.bottom)) el.style.top = `${Math.ceil(rect.bottom)}px`;
    } catch (error) {
      warn5("overlay offset failed", error);
    }
    if (!overlayLogged) {
      overlayLogged = true;
      console.warn("[plexus] dock overlays the canvas: Excalidraw did not follow the narrowed container");
    }
  }
  const highlight = () => !!el.querySelector?.(".block-highlight-blue");
  const dockHasTextarea = () => !!el.querySelector?.("textarea");
  const focusedTa = () => isTextarea(doc.activeElement) && within3(doc.activeElement, el) ? doc.activeElement : null;
  const menuOpen = () => !!doc.querySelector?.(menuSelector);
  const snapSel = () => ({ ids: { ...app?.state?.selectedElementIds || {} }, groups: { ...app?.state?.selectedGroupIds || {} } });
  const restoreSel = safe("selection restore", (snap) => {
    if (!snap || !app) return;
    const st = app.state || {};
    if (sameKeys(st.selectedElementIds, snap.ids) && sameKeys(st.selectedGroupIds, snap.groups)) return;
    const live = new Set((app.getSceneElements?.() ?? app.getSceneElementsIncludingDeleted?.() ?? []).filter((x) => !x.isDeleted).map((x) => x.id));
    if (!Object.keys(snap.ids).every((id) => live.has(id))) return;
    app.updateScene({ appState: { selectedElementIds: snap.ids, selectedGroupIds: snap.groups } });
  });
  async function ownsSelection() {
    try {
      const get = api?.ui?.multiselect?.getSelected;
      if (typeof get !== "function") return false;
      const list = await get.call(api.ui.multiselect);
      const prefixes = [rootUid, ...childUids].map((u) => `render-block-path-${u}`);
      return Array.isArray(list) && list.some((x) => {
        const id = String(x?.["window-id"] ?? "");
        return prefixes.some((p) => id.startsWith(p));
      });
    } catch (error) {
      warn5("selection read failed", error);
      return false;
    }
  }
  function dispatchEscape(via) {
    escapeVia = via;
    const target = via === "document" ? doc : view2;
    synthetic = true;
    try {
      const Ctor = view2?.KeyboardEvent ?? globalThis.KeyboardEvent;
      target?.dispatchEvent?.(new Ctor("keydown", { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true }));
    } catch (error) {
      warn5("synthetic Escape failed", error);
    } finally {
      synthetic = false;
    }
  }
  async function clearSelection({ refocus = false } = {}) {
    const my = ++clearGen;
    try {
      await clearRounds(my);
    } finally {
      if (refocus && my === clearGen && open4) {
        const a = doc.activeElement;
        if (!a || a === doc.body || a === doc.documentElement) {
          try {
            containerEl?.focus?.({ preventScroll: true });
          } catch (error) {
            warn5("container focus failed", error);
          }
        }
      }
    }
  }
  async function clearRounds(my) {
    let dispatched = false;
    if (highlight() || await ownsSelection()) {
      dispatchEscape("window");
      dispatched = true;
    }
    for (let round = 0; round < 2; round++) {
      if (!await wait(SELECTION_RECHECK_MS2) || my !== clearGen || !open4) return;
      const held = highlight() || await ownsSelection();
      if (my !== clearGen || !open4) return;
      if (!dispatched) {
        if (!dockHasTextarea() && !held) return;
        dispatchEscape("window");
        dispatched = true;
        continue;
      }
      if (round === 0 ? dockHasTextarea() || held : held) {
        const snap = snapSel();
        dispatchEscape("document");
        setTimer(() => restoreSel(snap), 0);
      }
      return;
    }
  }
  function leaveEditing({ refocus = true } = {}) {
    const ta = focusedTa();
    if (ta) {
      try {
        ta.blur?.();
      } catch (error) {
        warn5("blur failed", error);
      }
    }
    editing = false;
    if (refocus) {
      try {
        containerEl?.focus?.({ preventScroll: true });
      } catch (error) {
        warn5("container focus failed", error);
      }
    }
    void clearSelection({ refocus }).catch((error) => warn5("selection clear failed", error));
  }
  const findInput = (uid) => [...body.querySelectorAll?.(".rm-block__input") ?? []].find((n) => String(n.id ?? "").endsWith(uid)) ?? null;
  const focusedBlockTa = (uid) => {
    const ta = focusedTa();
    return ta && String(ta.id ?? "").endsWith(uid) ? ta : null;
  };
  const caretToEnd = (ta) => {
    const n = String(ta.value ?? "").length;
    if (typeof ta.setSelectionRange === "function") ta.setSelectionRange(n, n);
    else {
      ta.selectionStart = n;
      ta.selectionEnd = n;
    }
  };
  function clickInput(input) {
    const Mouse = view2?.MouseEvent ?? globalThis.MouseEvent;
    for (const type of ["mousedown", "mouseup", "click"]) input.dispatchEvent(new Mouse(type, { bubbles: true, cancelable: true, view: view2 }));
  }
  async function focusBlock(uid) {
    const my = ++focusGen;
    const stale = () => !open4 || my !== focusGen;
    let input = null;
    for (let waited = 0; ; waited += POLL_MS) {
      input = findInput(uid);
      if (input || waited >= ADD_POLL_MAX_MS) break;
      if (!await wait(POLL_MS) || stale()) return false;
    }
    if (!input) return false;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (stale()) return false;
      try {
        clickInput(findInput(uid) ?? input);
      } catch (error) {
        warn5("focus click failed", error);
        return false;
      }
      for (let waited = 0; waited <= FOCUS_WAIT_MS2; waited += POLL_MS) {
        const ta = focusedBlockTa(uid);
        if (ta) {
          caretToEnd(ta);
          return true;
        }
        if (!await wait(POLL_MS) || stale()) return false;
      }
    }
    return false;
  }
  const uidsOf2 = (pulled) => (Array.isArray(pulled?.[":block/children"]) ? pulled[":block/children"] : []).slice().sort((a, b) => (a?.[":block/order"] ?? 0) - (b?.[":block/order"] ?? 0)).map((c) => c?.[":block/uid"]).filter(Boolean);
  function unmountHost(h) {
    try {
      api?.ui?.components?.unmountNode?.({ el: h });
    } catch (error) {
      warn5("unmount failed", error);
    }
    h.remove?.();
  }
  function syncList(uids) {
    const active = doc.activeElement;
    const held = isTextarea(active) && within3(active, el) ? { ta: active, start: active.selectionStart, end: active.selectionEnd } : null;
    for (const [uid, h] of [...hosts]) {
      if (!uids.includes(uid)) {
        unmountHost(h);
        hosts.delete(uid);
      }
    }
    uids.forEach((uid, i) => {
      let h = hosts.get(uid);
      const fresh2 = !h;
      if (fresh2) {
        h = doc.createElement("div");
        h.className = "plexus-dock-child";
        hosts.set(uid, h);
      }
      const at = body.children?.[i] ?? null;
      if (at !== h) body.insertBefore(h, at);
      if (fresh2) {
        try {
          api.ui.components.renderBlock({ uid, el: h, "open?": true });
        } catch (error) {
          warn5("block render failed", error);
          h.textContent = "Could not render this block";
        }
      }
    });
    childUids = uids;
    if (held && within3(held.ta, el) && doc.activeElement !== held.ta) {
      try {
        held.ta.focus?.({ preventScroll: true });
        if (typeof held.ta.setSelectionRange === "function") held.ta.setSelectionRange(held.start, held.end);
        else {
          held.ta.selectionStart = held.start;
          held.ta.selectionEnd = held.end;
        }
      } catch (error) {
        warn5("focus restore failed", error);
      }
    }
  }
  function blockExists(uid) {
    try {
      return api.data.pull("[:block/uid]", `[:block/uid "${String(uid).replace(/["\\]/g, "")}"]`) != null;
    } catch {
      return true;
    }
  }
  function neighbourInput(prev, uids, goneUid) {
    const before = prev[prev.indexOf(goneUid) - 1];
    const host = hosts.get(before && uids.includes(before) ? before : uids[0]);
    const inputs = host?.querySelectorAll?.(".rm-block__input") ?? [];
    const last = inputs[inputs.length - 1];
    return last ? uidOfId(last.id) : null;
  }
  function onChildren(uids) {
    if (!open4) return;
    if (uids.length === childUids.length && uids.every((u, i) => u === childUids[i])) return;
    const prev = childUids;
    const added = uids.filter((u) => !prev.includes(u));
    const removed = prev.filter((u) => !uids.includes(u));
    let follow = null;
    let gone = null;
    if (editing) {
      follow = added.length ? added[added.length - 1] : focusUid && removed.includes(focusUid) ? focusUid : null;
      if (follow && !added.length && !blockExists(follow)) {
        gone = follow;
        follow = null;
      }
    }
    syncList(uids);
    if (gone) follow = neighbourInput(prev, uids, gone);
    if (gone && !follow) editing = false;
    if (follow) void focusBlock(follow).catch((error) => warn5("focus follow failed", error));
  }
  const visible = (uids) => rootKind === "parent" ? uids.filter((u) => u !== drawingUid) : uids;
  function startWatch(uid) {
    const ident = `[:block/uid "${String(uid).replace(/["\\]/g, "")}"]`;
    let initial = [];
    try {
      initial = visible(uidsOf2(api.data.pull(CHILDREN_PATTERN, ident)));
    } catch (error) {
      warn5("children pull failed", error);
    }
    syncList(initial);
    if (typeof api?.data?.addPullWatch !== "function") return;
    const handler = (_before, after) => {
      try {
        onChildren(visible(uidsOf2(after)));
      } catch (error) {
        warn5("children watch failed", error);
      }
    };
    try {
      api.data.addPullWatch(CHILDREN_PATTERN, ident, handler);
    } catch (error) {
      warn5("children watch failed", error);
      return;
    }
    unwatch = () => {
      unwatch = null;
      try {
        api.data.removePullWatch(CHILDREN_PATTERN, ident, handler);
      } catch (error) {
        warn5("removePullWatch failed", error);
      }
    };
  }
  let dragRef = null;
  function updateHeader() {
    let text = "";
    dragRef = null;
    if (rootKind === "parent") {
      text = String(parentInfo?.title ?? "").slice(0, LABEL_MAX);
      if (parentInfo?.uid) dragRef = `((${parentInfo.uid}))`;
    } else {
      text = String(parentInfo?.pageTitle ?? "");
      if (text) dragRef = `[[${text}]]`;
    }
    label.textContent = text || "Outline";
    label.draggable = !!dragRef;
    label.setAttribute?.("draggable", dragRef ? "true" : "false");
    if (rootKind === "parent") addClass(el, "plexus-dock--parent-root");
    else removeClass(el, "plexus-dock--parent-root");
    parentBtn.setAttribute?.("aria-pressed", rootKind === "parent" ? "true" : "false");
  }
  async function setRoot(which) {
    if (!open4 || which !== "drawing" && which !== "parent") return false;
    if (which === rootKind) return true;
    let target = drawingUid;
    if (which === "parent") {
      if (!hasParent) return false;
      target = parentInfo.uid;
    }
    const my = ++rootGen;
    if (focusedTa() || editing) {
      leaveEditing();
      await new Promise((resolve) => setTimer(resolve, LEAVE_WAIT_MS2));
      if (!open4 || my !== rootGen) return false;
    }
    try {
      unwatch?.();
    } catch (error) {
      warn5("unwatch failed", error);
    }
    unwatch = null;
    for (const h of hosts.values()) unmountHost(h);
    hosts.clear();
    childUids = [];
    rootUid = target;
    rootKind = which;
    updateHeader();
    startWatch(rootUid);
    return true;
  }
  function installKeys() {
    on(el, "keydown", safe("keydown", (e) => {
      if (synthetic || !e.isTrusted || e.isComposing || e.keyCode === 229) return;
      lastKeyAt = now();
      const t = e.target;
      if (isTextarea(t)) lastCaret = { ta: t, start: t.selectionStart, end: t.selectionEnd };
      const mOpen = menuOpen();
      if (e.key === "Escape") {
        if (mOpen) {
          const snap = snapSel();
          setTimer(() => restoreSel(snap), 0);
          setTimer(() => {
            if (!open4 || dockHasTextarea()) return;
            editing = false;
            void clearSelection({ refocus: true }).catch((error) => warn5("selection clear failed", error));
          }, MENU_ESC_SETTLE_MS);
          return;
        }
        if (isTextarea(t)) {
          swallow3(e);
          leaveEditing();
        }
        return;
      }
      if (!isTextarea(t)) return;
      const start = t.selectionStart;
      const end = t.selectionEnd;
      const len = String(t.value ?? "").length;
      const key = e.key;
      const mod = e.metaKey || e.ctrlKey;
      const blocks = [...el.querySelectorAll?.(BLOCK_SELECTOR) ?? []].map((n) => uidOfId(n.id));
      const mine = uidOfId(t.id);
      const isFirst = !blocks.length || blocks[0] === mine;
      const isLast = !blocks.length || blocks[blocks.length - 1] === mine;
      const direct = childUids.findIndex((u) => String(t.id ?? "").endsWith(u));
      let deny = false;
      if (mod && !e.altKey && !e.shiftKey && (e.code === "KeyA" || String(key).toLowerCase() === "a") && start === 0 && end === len) deny = true;
      else if (direct >= 0 && key === "Tab" && e.shiftKey) deny = true;
      else if (direct >= 0 && e.shiftKey && (e.altKey || mod) && (key === "ArrowUp" && direct === 0 || key === "ArrowDown" && direct === childUids.length - 1)) deny = true;
      else if (e.shiftKey && !e.altKey && !mod && (key === "ArrowUp" && start === 0 || key === "ArrowDown" && end === len)) deny = !mOpen;
      else if (isFirst && key === "Backspace" && start === 0 && end === 0) deny = true;
      else if (isFirst && (key === "ArrowLeft" && start === 0 && end === 0 || key === "ArrowUp" && start === 0)) deny = !mOpen;
      else if (isLast && key === "Delete" && start === len && end === len) deny = true;
      else if (isLast && (key === "ArrowRight" && end === len || key === "ArrowDown" && end === len)) deny = !mOpen;
      if (deny) swallow3(e);
    }), true);
    const undoChord = (e) => {
      const k = String(e.key).toLowerCase();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.altKey && k === "z") return true;
      return !isMac && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && k === "y";
    };
    const stopKey = (e) => {
      if (MENU_KEYS2.has(e.key) && menuOpen()) return;
      if (e.type === "keydown" && isTextarea(e.target) && undoChord(e)) return;
      if (e.key === "Escape" && !isTextarea(e.target)) return;
      e.stopPropagation();
    };
    const stop = (e) => e.stopPropagation();
    for (const type of KEY_EVENTS2) on(el, type, type === "keydown" || type === "keyup" ? stopKey : stop);
    for (const type of POINTER_EVENTS) on(el, type, stop);
    on(el, "click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (e.target?.closest?.(".rm-bullet")) {
        e.preventDefault?.();
        e.stopPropagation?.();
      }
    }, true);
    const refTarget = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.button ?? 0) !== 0) return null;
      const ref = e.target?.closest?.(REF_SELECTOR);
      if (!ref || !within3(ref, el)) return null;
      const attr = (n, name) => n?.getAttribute?.(name) ?? null;
      const uid = attr(ref, "data-uid") ?? attr(ref, "data-link-uid");
      const title = attr(ref, "data-link-title") ?? attr(ref, "data-tag");
      if (title) return { type: "page", title };
      if (uid) {
        try {
          const page = api.data.pull("[:node/title]", `[:block/uid "${String(uid).replace(/["\\]/g, "")}"]`);
          if (page?.[":node/title"]) return { type: "page", title: page[":node/title"] };
        } catch (error) {
          warn5("ref pull failed", error);
        }
        return { type: "block", uid };
      }
      const text = String(ref.textContent ?? "").replace(/^#?\[*/, "").replace(/\]*$/, "").trim();
      return text ? { type: "page", title: text } : null;
    };
    on(el, "mousedown", safe("ref mousedown", (e) => {
      if (refTarget(e)) swallow3(e);
    }), true);
    on(el, "click", safe("ref click", (e) => {
      const target = refTarget(e);
      if (!target) return;
      swallow3(e);
      onNavigate({ target, sidebar: !!e.shiftKey });
    }), true);
    on(el, "focusin", safe("focusin", (e) => {
      if (!isTextarea(e.target)) return;
      editing = true;
      focusUid = uidOfId(e.target.id);
      lastTa = e.target;
    }));
    on(doc, "keydown", safe("document keydown", (e) => {
      if (synthetic || !e.isTrusted || e.isComposing || e.keyCode === 229) return;
      const t = e.target;
      if (within3(t, el)) return;
      if (t?.closest?.(`${menuSelector}, ${POPUP_HOST_SELECTOR2}`)) return;
      if (highlight()) {
        if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && String(e.key).toLowerCase() === "c") return;
        swallow3(e);
        if (e.key === "Escape") void clearSelection().catch((error) => warn5("selection clear failed", error));
        return;
      }
      if (editing && (!t || t === doc.body) && lastKeyAt && now() - lastKeyAt <= REFOCUS_WINDOW_MS2) {
        swallow3(e);
        refocusLast();
      }
    }), true);
    on(doc, "focusin", safe("document focusin", (e) => {
      const t = e.target;
      if (!t || t === doc.body || within3(t, el)) return;
      if (editing && isTextarea(t) && /^block-input-/.test(String(t.id ?? "")) && lastKeyAt && now() - lastKeyAt <= STRAY_FOCUS_MS) {
        try {
          t.blur?.();
        } catch (error) {
          warn5("stray blur failed", error);
        }
        refocusLast();
        if (!strayLogged) {
          strayLogged = true;
          console.warn("[plexus] dock: focus escaped to a block outside the dock; returned it");
        }
        return;
      }
      editing = false;
    }), true);
    on(containerEl, "pointerdown", safe("canvas pointerdown", () => {
      if (focusedTa()) leaveEditing({ refocus: false });
    }), true);
    on(containerEl, "pointerup", safe("canvas pointerup", () => {
      if (highlight()) void clearSelection().catch((error) => warn5("selection clear failed", error));
    }), true);
  }
  function refocusLast() {
    const ta = lastTa && within3(lastTa, el) ? lastTa : el.querySelector?.("textarea");
    if (!ta) return;
    try {
      ta.focus?.({ preventScroll: true });
      if (lastCaret && lastCaret.ta === ta && typeof ta.setSelectionRange === "function") ta.setSelectionRange(lastCaret.start, lastCaret.end);
    } catch (error) {
      warn5("refocus failed", error);
    }
  }
  function installHeader() {
    const noFocus = (target) => on(target, "mousedown", (e) => e.preventDefault?.());
    noFocus(parentBtn);
    noFocus(closeBtn);
    noFocus(handle);
    noFocus(addBtn);
    on(label, "dragstart", safe("dragstart", (e) => {
      if (!dragRef || !e.dataTransfer) {
        e.preventDefault?.();
        return;
      }
      leaveEditing({ refocus: false });
      e.dataTransfer.effectAllowed = "copyLink";
      e.dataTransfer.setData(PLEXUS_REF_MIME, dragRef);
    }));
    on(parentBtn, "click", () => {
      void setRoot(rootKind === "parent" ? "drawing" : "parent").catch((error) => warn5("setRoot failed", error));
    });
    on(closeBtn, "click", () => {
      void shutdown(true);
    });
    on(addBtn, "click", () => {
      Promise.resolve().then(() => addBlock(rootUid)).then((uid) => uid && open4 ? focusBlock(uid) : null).catch((error) => {
        warn5("add block failed", error);
        toast("Could not add a block");
      });
    });
    const finishDrag = safe("resize end", () => {
      if (!drag) return;
      drag = null;
      try {
        onWidth(requestedWidth);
      } catch (error) {
        warn5("onWidth failed", error);
      }
    });
    on(handle, "pointerdown", safe("resize start", (e) => {
      e.preventDefault?.();
      try {
        handle.setPointerCapture?.(e.pointerId);
      } catch {
      }
      drag = { startX: e.clientX, startW: effectiveWidth() };
    }));
    on(handle, "pointermove", safe("resize", (e) => {
      if (!drag) return;
      requestedWidth = clamp(Math.round(drag.startW + (drag.startX - e.clientX)), DOCK_MIN_WIDTH, DOCK_MAX_WIDTH);
      scheduleApply();
    }));
    on(handle, "pointerup", finishDrag);
    on(handle, "pointercancel", finishDrag);
    on(handle, "lostpointercapture", finishDrag);
    on(view2, "resize", safe("window resize", scheduleApply));
  }
  function installObservers() {
    if (typeof MutationObs !== "function") return;
    const outerMo = new MutationObs(safe("outer observer", () => {
      if (open4 && !hasClass(outerEl, "full-screen")) void shutdown(false);
    }));
    outerMo.observe(outerEl, { attributes: true, attributeFilter: ["class"] });
    offs.push(() => outerMo.disconnect());
    const menuMo = new MutationObs(safe("menu observer", () => {
      const menu = body.querySelector?.(".rm-autocomplete__results");
      if (menu) menu.scrollIntoView?.({ block: "nearest" });
    }));
    menuMo.observe(body, { childList: true, subtree: true });
    offs.push(() => menuMo.disconnect());
  }
  function shutdown(notify) {
    if (!open4) return closePromise ?? Promise.resolve();
    open4 = false;
    const ta = focusedTa();
    const wasEditing = !!ta || editing;
    try {
      if (ta) ta.blur?.();
      if (highlight()) dispatchEscape("window");
    } catch (error) {
      warn5("close blur failed", error);
    }
    editing = false;
    cancelPending();
    for (const off of offs.splice(0)) {
      try {
        off();
      } catch (error) {
        warn5("listener removal failed", error);
      }
    }
    try {
      unwatch?.();
    } catch (error) {
      warn5("unwatch failed", error);
    }
    unwatch = null;
    try {
      el.style.display = "none";
      removeClass(outerEl, "plexus-dock-narrowed");
      removeClass(doc.body, "plexus-dock-open");
      styleEl.remove?.();
      containerEl?.focus?.({ preventScroll: true });
    } catch (error) {
      warn5("close restore failed", error);
    }
    closePromise = (async () => {
      if (wasEditing) await new Promise((resolve) => setTimer(resolve, LEAVE_WAIT_MS2));
      for (const h of hosts.values()) unmountHost(h);
      hosts.clear();
      el.remove?.();
    })().catch((error) => warn5("close failed", error));
    if (notify) {
      try {
        onClose();
      } catch (error) {
        warn5("onClose failed", error);
      }
    }
    return closePromise;
  }
  updateHeader();
  applyWidth();
  styleHost.append(styleEl);
  doc.body.append(el);
  addClass(doc.body, "plexus-dock-open");
  addClass(outerEl, "plexus-dock-narrowed");
  const width0 = widthOf();
  installKeys();
  installHeader();
  installObservers();
  try {
    startWatch(rootUid);
  } catch (error) {
    warn5("start failed", error);
  }
  void verifyNarrow(width0).catch((error) => warn5("narrowing check failed", error));
  return {
    el,
    isOpen: () => open4,
    close: () => shutdown(true),
    dispose: () => shutdown(false),
    setRoot,
    refreshTheme,
    root: () => rootKind,
    rootUid: () => rootUid,
    mode: () => narrowMode,
    escapeVia: () => escapeVia
  };
}

// src/view/drop.js
var PLEXUS_MIME = "application/x-plexus-ref";
var PARENTS = "roam/block-uid-list-only-parents";
var BLOCKS = "roam/block-uid-list";
var URIS = "roam/roam-uri-list";
var CLAIM = [PARENTS, BLOCKS, PLEXUS_MIME];
var UID_RE4 = /^[\w-]{9}$/;
var CAP = 500;
var WATCHDOG_MS = 250;
var OFFSET = 12;
var LABELS = { embed: "Embed", link: "Link", label: "Label" };
function claimableTypes(types) {
  let list;
  try {
    list = Array.from(types ?? []);
  } catch {
    return false;
  }
  return CLAIM.some((t) => list.includes(t));
}
function dropMode(e) {
  return e?.shiftKey ? "label" : e?.altKey ? "link" : "embed";
}
var uidsOf = (text) => String(text ?? "").split(/[^A-Za-z0-9_-]+/).filter((s) => UID_RE4.test(s));
function uriUids(text) {
  const out = [];
  for (const line of String(text ?? "").split(/[\r\n]+/)) {
    const m = /\/page\/([\w-]{9})\s*$/.exec(line.trim());
    if (m) out.push(m[1]);
  }
  return out;
}
async function parseRoamDrop(dataTransfer, { resolve, exclude } = {}) {
  let candidates = [];
  try {
    const get = (t) => {
      try {
        return dataTransfer.getData(t) || "";
      } catch {
        return "";
      }
    };
    const plexus = parseEmbedRef(get(PLEXUS_MIME));
    if (plexus && (plexus.kind === "block" || plexus.kind === "page")) candidates = [plexus];
    if (!candidates.length) candidates = uidsOf(get(PARENTS)).map((uid) => ({ kind: "block", uid }));
    if (!candidates.length) candidates = uidsOf(get(BLOCKS)).map((uid) => ({ kind: "block", uid }));
    if (!candidates.length) candidates = uriUids(get(URIS)).map((uid) => ({ kind: "block", uid }));
  } catch (error) {
    console.warn("[plexus] drop parse failed", error);
    return null;
  }
  const skip = new Set([].concat(typeof exclude === "function" ? exclude() : exclude ?? []).filter(Boolean));
  const seen = /* @__PURE__ */ new Set();
  const items = [];
  let excluded = 0;
  for (const c of candidates) {
    if (items.length >= CAP) break;
    let item = null;
    if (c.kind === "page") {
      item = { kind: "page", title: c.title, ref: c.ref };
    } else {
      if (skip.has(c.uid)) {
        excluded++;
        continue;
      }
      let info = null;
      try {
        info = await resolve?.(c.uid);
      } catch (error) {
        console.warn("[plexus] drop resolve failed", error);
      }
      if (!info) continue;
      item = info.kind === "page" && info.title ? { kind: "page", title: info.title, ref: `[[${info.title}]]` } : { kind: "block", uid: c.uid, ref: `((${c.uid}))` };
    }
    if (seen.has(item.ref)) continue;
    seen.add(item.ref);
    items.push(item);
  }
  if (!items.length && !excluded) return null;
  return { items, excluded };
}
function effectFor(allowed) {
  const a = String(allowed ?? "").toLowerCase();
  if (!a || a === "all" || a === "uninitialized" || a === "none") return "copy";
  for (const e of ["copy", "link", "move"]) if (a.includes(e)) return e;
  return "copy";
}
function installRoamDrop({ doc, containerEl, app, zIndex = 1e3, resolve, exclude, onDrop, toast, setTimeout: setT = globalThis.setTimeout.bind(globalThis), clearTimeout: clearT = globalThis.clearTimeout.bind(globalThis) }) {
  const win = doc.defaultView ?? null;
  let ghost = null;
  let timer = null;
  let disposed = false;
  const say = (message) => {
    try {
      toast?.(message);
    } catch {
    }
  };
  const hideGhost = () => {
    if (timer != null) clearT(timer);
    timer = null;
    ghost?.remove();
    ghost = null;
  };
  const showGhost = (e) => {
    if (!ghost) {
      ghost = doc.createElement("div");
      ghost.className = "plexus-portal plexus-drop-ghost";
      ghost.style.zIndex = String(Number(zIndex) + 3);
      doc.body.append(ghost);
    }
    ghost.textContent = LABELS[dropMode(e)];
    const w = ghost.offsetWidth || 64;
    const h = ghost.offsetHeight || 24;
    const maxX = (win?.innerWidth ?? Infinity) - w;
    const maxY = (win?.innerHeight ?? Infinity) - h;
    ghost.style.left = `${Math.max(0, Math.min(e.clientX + OFFSET, maxX))}px`;
    ghost.style.top = `${Math.max(0, Math.min(e.clientY + OFFSET, maxY))}px`;
    if (timer != null) clearT(timer);
    timer = setT(hideGhost, WATCHDOG_MS);
  };
  const claimed = (e) => claimableTypes(e?.dataTransfer?.types);
  const onOver = (e) => {
    try {
      if (disposed || !claimed(e)) return;
      e.preventDefault?.();
      e.stopImmediatePropagation?.();
      e.stopPropagation?.();
      try {
        e.dataTransfer.dropEffect = effectFor(e.dataTransfer.effectAllowed);
      } catch {
      }
      showGhost(e);
    } catch (error) {
      console.warn("[plexus] drag over failed", error);
    }
  };
  const onDropEvent = (e) => {
    try {
      if (disposed || !claimed(e)) return;
      e.preventDefault?.();
      e.stopImmediatePropagation?.();
      e.stopPropagation?.();
      hideGhost();
      const mode = dropMode(e);
      const rect = containerEl.getBoundingClientRect?.() ?? { left: 0, top: 0 };
      const point = { x: e.clientX, y: e.clientY };
      const appState = { ...app?.state ?? {}, offsetLeft: rect.left, offsetTop: rect.top };
      const parsed = parseRoamDrop(e.dataTransfer, { resolve, exclude });
      Promise.resolve(parsed).then(async (result) => {
        if (disposed) return;
        if (!result) return say("Nothing to place");
        if (!result.items.length) return say("The drawing can't contain itself");
        const scenePoint = viewportToScene({ x: point.x, y: point.y, appState });
        await onDrop?.({ items: result.items, mode, scenePoint });
      }).catch((error) => console.warn("[plexus] drop failed", error));
    } catch (error) {
      console.warn("[plexus] drop failed", error);
    }
  };
  const docEnd = () => hideGhost();
  const onBlur = () => hideGhost();
  containerEl.addEventListener("dragenter", onOver, true);
  containerEl.addEventListener("dragover", onOver, true);
  containerEl.addEventListener("drop", onDropEvent, true);
  doc.addEventListener("dragend", docEnd, true);
  doc.addEventListener("drop", docEnd, true);
  win?.addEventListener("blur", onBlur);
  return () => {
    if (disposed) return;
    disposed = true;
    hideGhost();
    containerEl.removeEventListener("dragenter", onOver, true);
    containerEl.removeEventListener("dragover", onOver, true);
    containerEl.removeEventListener("drop", onDropEvent, true);
    doc.removeEventListener("dragend", docEnd, true);
    doc.removeEventListener("drop", docEnd, true);
    win?.removeEventListener("blur", onBlur);
  };
}

// src/model/tokens.js
var MASK = "\0";
var UID_RE5 = /^\(\(([A-Za-z0-9_-]{9})\)\)/;
var ALIAS_HEAD_RE = /^\[[^[\]\n]*\]\(/;
var TAG_CHAR_RE = /[\p{L}\p{N}_\-/.:@]/u;
var blank2 = (s) => MASK.repeat(s.length);
function maskBraces(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "{" && text[i + 1] === "{") {
      let depth = 0;
      let j = i;
      let end = -1;
      while (j < text.length) {
        if (text[j] === "{" && text[j + 1] === "{") {
          depth++;
          j += 2;
          continue;
        }
        if (text[j] === "}" && text[j + 1] === "}") {
          depth--;
          j += 2;
          if (depth === 0) {
            end = j;
            break;
          }
          continue;
        }
        j++;
      }
      if (end > 0) {
        out += blank2(text.slice(i, end));
        i = end;
        continue;
      }
    }
    out += text[i];
    i++;
  }
  return out;
}
function maskText(text) {
  return maskBraces(
    String(text ?? "").replace(/```[\s\S]*?```/g, blank2).replace(/`[^`\n]*`/g, blank2).replace(/https?:\/\/\S+/g, blank2)
  );
}
function closeOf(m, open4, limit) {
  let depth = 1;
  let i = open4 + 2;
  while (i < limit) {
    if (m[i] === "[" && m[i + 1] === "[") {
      depth++;
      i += 2;
      continue;
    }
    if (m[i] === "]" && m[i + 1] === "]") {
      depth--;
      i += 2;
      if (depth === 0) return i;
      continue;
    }
    i++;
  }
  return -1;
}
function scan(m, from, to, nested, out, inTitle = false) {
  let i = from;
  while (i < to) {
    const c = m[i];
    if (inTitle && c !== "[" && !(c === "#" && m[i + 1] === "[" && m[i + 2] === "[")) {
      i++;
      continue;
    }
    if (c === "[" && m[i + 1] !== "[") {
      if (inTitle) {
        i++;
        continue;
      }
      const head = ALIAS_HEAD_RE.exec(m.slice(i, to));
      if (head) {
        const p = i + head[0].length;
        if (m[p] === "[" && m[p + 1] === "[") {
          const end = closeOf(m, p, to);
          if (end > 0 && m[end] === ")" && end - 2 > p + 2) {
            out.push({ kind: "page", title: m.slice(p + 2, end - 2), start: i, end: end + 1 });
            i = end + 1;
            continue;
          }
        } else if (m[p] === "(" && m[p + 1] === "(") {
          const u = UID_RE5.exec(m.slice(p, to));
          if (u && m[p + u[0].length] === ")") {
            out.push({ kind: "block", uid: u[1], start: i, end: p + u[0].length + 1 });
            i = p + u[0].length + 1;
            continue;
          }
        }
      }
      i++;
      continue;
    }
    if (c === "[" && m[i + 1] === "[") {
      const end = closeOf(m, i, to);
      if (end > 0 && end - 2 > i + 2) {
        out.push({ kind: "page", title: m.slice(i + 2, end - 2), start: i, end });
        if (nested) scan(m, i + 2, end - 2, nested, out, true);
        i = end;
        continue;
      }
      i += 2;
      continue;
    }
    if (c === "#" && m[i + 1] === "[" && m[i + 2] === "[") {
      const end = closeOf(m, i + 1, to);
      if (end > 0 && end - 2 > i + 3) {
        out.push({ kind: "tag", title: m.slice(i + 3, end - 2), start: i, end });
        if (nested) scan(m, i + 3, end - 2, nested, out, true);
        i = end;
        continue;
      }
      i++;
      continue;
    }
    if (c === "#") {
      let j = i + 1;
      while (j < to && TAG_CHAR_RE.test(m[j])) j++;
      while (j > i + 1 && m[j - 1] === ":") j--;
      if (j > i + 1) {
        out.push({ kind: "tag", title: m.slice(i + 1, j), start: i, end: j });
        i = j;
        continue;
      }
      i++;
      continue;
    }
    if (c === "(" && m[i + 1] === "(") {
      const u = UID_RE5.exec(m.slice(i, to));
      if (u) {
        out.push({ kind: "block", uid: u[1], start: i, end: i + u[0].length });
        i += u[0].length;
        continue;
      }
    }
    i++;
  }
}
function findTokens(text, { nested = false } = {}) {
  const src = String(text ?? "");
  if (!src) return [];
  const m = maskText(src);
  const out = [];
  scan(m, 0, m.length, nested, out);
  for (const t of out) if (t.title != null) t.title = titleFrom(src, t);
  return out.sort((a, b) => a.start - b.start || b.end - a.end);
}
function titleFrom(src, t) {
  const raw = src.slice(t.start, t.end);
  if (raw.startsWith("#[[")) return raw.slice(3, -2);
  if (raw.startsWith("[[")) return raw.slice(2, -2);
  if (raw.startsWith("#")) return raw.slice(1);
  const alias = ALIAS_HEAD_RE.exec(raw);
  if (alias) return raw.slice(alias[0].length + 2, -3);
  return t.title;
}
function alignWrapped(text, originalText) {
  const t = String(text ?? "");
  const o = String(originalText ?? "");
  const map = new Int32Array(t.length + 1);
  let i = 0;
  let j = 0;
  while (i < t.length) {
    if (j < o.length && t[i] === o[j]) {
      map[i++] = j++;
      continue;
    }
    if (t[i] === "\n") {
      map[i++] = j;
      if (j < o.length && /\s/.test(o[j])) j++;
      continue;
    }
    if (j < o.length && /\s/.test(o[j])) {
      j++;
      continue;
    }
    return null;
  }
  map[t.length] = o.length;
  return map;
}

// src/view/text-links.js
var MAX_MOVE_PX2 = 6;
var MAX_HOLD_MS2 = 400;
var MEASURE_CAP = 2e3;
var LAYOUT_CAP = 500;
var NOTE_ARMED_ATTR = "data-plexus-note-armed";
var CHOOSER_LABEL_MAX = 60;
var FRAME_TYPES = /* @__PURE__ */ new Set(["frame", "magicframe"]);
var LINEAR_TYPES = /* @__PURE__ */ new Set(["arrow", "line"]);
var FAMILY = {
  1: "Virgil",
  2: "Helvetica",
  3: "Cascadia",
  5: "Excalifont",
  6: "Nunito",
  7: "Lilita One",
  8: "Comic Shanns",
  9: "Liberation Sans"
};
var warn4 = (what, ...rest) => console.warn(`[plexus] ${what}`, ...rest);
var fontFor = (element) => `${element.fontSize ?? 20}px ${FAMILY[element.fontFamily] ?? "Excalifont"}, Xiaolai, sans-serif, Segoe UI Emoji`;
function createFontMeasurer({ doc = globalThis.document } = {}) {
  const memo3 = /* @__PURE__ */ new Map();
  let ctx = null;
  const context = () => {
    if (ctx) return ctx;
    try {
      ctx = doc?.createElement?.("canvas")?.getContext?.("2d") || null;
    } catch {
      ctx = null;
    }
    return ctx;
  };
  return function measure2(text, font) {
    const str = String(text ?? "");
    const key = `${font}|${str}`;
    if (memo3.has(key)) {
      const hit = memo3.get(key);
      memo3.delete(key);
      memo3.set(key, hit);
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
    memo3.set(key, width);
    if (memo3.size > MEASURE_CAP) memo3.delete(memo3.keys().next().value);
    return width;
  };
}
var defaultMeasure = null;
var layouts = /* @__PURE__ */ new WeakMap();
function tokenTarget(token) {
  return token.kind === "block" ? { type: "block", uid: token.uid } : { type: "page", title: token.title };
}
function layoutOf(element, measure2) {
  let byId = layouts.get(measure2);
  if (!byId) {
    byId = /* @__PURE__ */ new Map();
    layouts.set(measure2, byId);
  }
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
    const w = measure2(line, font);
    const left = align === "center" ? element.x + (element.width - w) / 2 : align === "right" ? element.x + element.width - w : element.x;
    boxes.push({ line, start: at, left, top: element.y + i * lhPx, height: lhPx });
    at += line.length + 1;
  });
  const segsIn = (map2, tok) => {
    const segs = [];
    for (const b of boxes) {
      let a = -1;
      let z = -1;
      for (let k = 0; k < b.line.length; k++) {
        const o = map2[b.start + k];
        if (o >= tok.start && o < tok.end) {
          if (a < 0) a = k;
          z = k + 1;
        }
      }
      if (a < 0) continue;
      const x1 = b.left + measure2(b.line.slice(0, a), font);
      const x2 = b.left + measure2(b.line.slice(0, z), font);
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
          x1: b.left + measure2(b.line.slice(0, tok.start), font),
          x2: b.left + measure2(b.line.slice(0, tok.end), font),
          y1: b.top,
          y2: b.top + b.height
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
var inBox = (el, p) => p.x >= el.x && p.x <= el.x + el.width && p.y >= el.y && p.y <= el.y + el.height;
function hitToken({ element, point, measure: measure2 } = {}) {
  if (!element || element.type !== "text" || !point) return null;
  measure2 = measure2 || (defaultMeasure || (defaultMeasure = createFontMeasurer()));
  const p = toLocal(element, point);
  let best = null;
  for (const tok of layoutOf(element, measure2).nested) {
    if (!tok.segs.some((s) => p.x >= s.x1 && p.x <= s.x2 && p.y >= s.y1 && p.y <= s.y2)) continue;
    if (!best || tok.end - tok.start < best.end - best.start) best = tok;
  }
  if (!best) return null;
  const { segs, ...token } = best;
  return token;
}
function elementTokens({ element, measure: measure2 } = {}) {
  if (!element || element.type !== "text") return [];
  measure2 = measure2 || (defaultMeasure || (defaultMeasure = createFontMeasurer()));
  return layoutOf(element, measure2).flat.map((t) => ({ ...t }));
}
function topmostText(elements, point) {
  const byId = /* @__PURE__ */ new Map();
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
function installTextLinks({
  doc,
  api = globalThis.roamAlphaAPI,
  app,
  containerEl,
  navigate: navigate2,
  toast,
  zIndex = 0,
  mac = /mac|iphone|ipad/i.test(String(doc?.defaultView?.navigator?.platform ?? "")),
  measure: measure2,
  now = () => Date.now(),
  raf = (fn) => (doc?.defaultView?.requestAnimationFrame ?? globalThis.requestAnimationFrame)(fn),
  caf = (id) => (doc?.defaultView?.cancelAnimationFrame ?? globalThis.cancelAnimationFrame)?.(id)
} = {}) {
  if (!app || !containerEl?.addEventListener) return () => {
  };
  const win = doc?.defaultView ?? null;
  const measurer = measure2 || createFontMeasurer({ doc });
  let down = null;
  let chooser = null;
  let hoverOn = false;
  let frame = null;
  let last = null;
  let disposed = false;
  const modifier = (e) => mac ? !!e.metaKey && !e.ctrlKey : !!e.ctrlKey && !e.metaKey;
  const isModifierKey = (e) => mac ? e.key === "Meta" : e.key === "Control";
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
      const found = t.type === "block" ? api.data.pull("[:block/uid]", [":block/uid", t.uid]) : api.data.pull("[:block/uid]", [":node/title", t.title]);
      return !!found;
    } catch (error) {
      warn4("token lookup failed", error);
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
    try {
      navigate2?.({ target, sidebar: !!sidebar });
    } catch (error) {
      warn4("token navigation failed", error);
    }
  }
  function blockLabel(uid) {
    try {
      const raw = api.data.pull("[:block/string]", [":block/uid", uid]);
      const s = String(raw?.[":block/string"] ?? "").replace(/\s+/g, " ").trim();
      return s ? s.slice(0, CHOOSER_LABEL_MAX) : `((${uid}))`;
    } catch {
      return `((${uid}))`;
    }
  }
  const labelOf = (t) => t.kind === "block" ? blockLabel(t.uid) : t.kind === "tag" ? `#${t.title}` : t.title;
  function closeChooser(refocus = true) {
    const c = chooser;
    if (!c) return;
    chooser = null;
    c.dispose();
    if (refocus) {
      try {
        containerEl.focus?.({ preventScroll: true });
      } catch {
      }
    }
  }
  function openChooser(tokens2, at) {
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
      rows.forEach((r, k) => {
        r.style.backgroundColor = k === i ? "rgb(213, 218, 223)" : "";
      });
    };
    const choose = (token, sidebar) => {
      closeChooser(false);
      go(token, sidebar);
    };
    tokens2.forEach((token, k) => {
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
      row.addEventListener("click", (ev) => {
        ev.stopPropagation();
        choose(token, ev.shiftKey);
      });
      scroll.append(row);
      rows.push(row);
    });
    root.append(scroll);
    const stop = (ev) => ev.stopPropagation();
    root.addEventListener("keyup", stop);
    root.addEventListener("keypress", stop);
    root.addEventListener("pointerdown", stop);
    root.addEventListener("mousedown", (ev) => {
      ev.preventDefault?.();
      ev.stopPropagation();
    });
    root.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Escape") {
        ev.preventDefault();
        closeChooser(true);
      } else if (ev.key === "ArrowDown") {
        ev.preventDefault();
        setActive((active + 1) % rows.length);
      } else if (ev.key === "ArrowUp") {
        ev.preventDefault();
        setActive((active - 1 + rows.length) % rows.length);
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        choose(tokens2[active], ev.shiftKey);
      }
    });
    const onOutside = (ev) => {
      if (!(ev.target && root.contains?.(ev.target))) closeChooser(true);
    };
    const onWheel = (ev) => {
      if (!(ev.target && root.contains?.(ev.target))) closeChooser(true);
    };
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
      }
    };
    try {
      root.focus({ preventScroll: true });
    } catch {
    }
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
      warn4("text link claim failed", error);
    }
  };
  const onUp = (e) => {
    const start = down;
    if (!start || disposed) return;
    if (e.pointerId !== start.pointerId) return;
    down = null;
    e.preventDefault?.();
    e.stopImmediatePropagation?.();
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > MAX_MOVE_PX2 || now() - start.t > MAX_HOLD_MS2) return;
    try {
      if (start.tokens.length === 1) go(start.tokens[0], e.shiftKey);
      else openChooser(start.tokens, { x: e.clientX, y: e.clientY });
    } catch (error) {
      warn4("text link navigation failed", error);
    }
  };
  const onCancel = () => {
    down = null;
  };
  const onWinUp = (e) => {
    if (down && !containerEl.contains?.(e.target)) down = null;
  };
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
      warn4("text link hover failed", error);
    }
    setHover(over);
  }
  const schedule = () => {
    if (frame == null) frame = raf(evaluate);
  };
  const onMove = (e) => {
    if (!modifier(e)) {
      last = null;
      if (hoverOn) setHover(false);
      return;
    }
    last = { clientX: e.clientX, clientY: e.clientY, target: e.target, mod: true };
    schedule();
  };
  const onKeyUp = (e) => {
    if (isModifierKey(e)) {
      last = null;
      setHover(false);
    }
  };
  const onOff = () => {
    last = null;
    setHover(false);
  };
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
    if (frame != null) {
      try {
        caf(frame);
      } catch {
      }
      frame = null;
    }
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

// src/extension.js
var activeLifecycle = null;
var THUMB_WIDTHS = [160, 480];
var THUMB_WARM_DELAY_MS = 1500;
var REFRESH_DEBOUNCE_MS = 300;
var LAYER_REFRESH_MS = 200;
var DOCK_SETTLE_MS = 150;
function createEmitter() {
  const listeners = /* @__PURE__ */ new Map();
  return {
    on(type, cb) {
      if (!listeners.has(type)) listeners.set(type, /* @__PURE__ */ new Set());
      listeners.get(type).add(cb);
    },
    off(type, cb) {
      listeners.get(type)?.delete(cb);
    },
    emit(detail) {
      for (const cb of [...listeners.get("change") ?? []]) cb(detail);
    },
    clear() {
      listeners.clear();
    }
  };
}
function versionFlagTarget() {
  return globalThis.window ?? globalThis;
}
async function onload({ extensionAPI, extension, openCommandList: openList = openCommandList }) {
  if (!extensionAPI) throw new TypeError("Roam did not provide extensionAPI");
  if (activeLifecycle) await activeLifecycle.dispose();
  const lifecycle = createLifecycle();
  activeLifecycle = lifecycle;
  try {
    const flagTarget = versionFlagTarget();
    flagTarget.__ROAM_PLEXUS_VERSION = extension?.version || "development";
    lifecycle.add(() => {
      delete flagTarget.__ROAM_PLEXUS_VERSION;
    });
    await initializeSettings(extensionAPI);
    let refreshTimer = null;
    let refreshAll = () => {
    };
    const scheduleRefresh = () => {
      if (refreshTimer != null) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        try {
          refreshAll();
        } catch (error) {
          console.warn("[plexus] refresh failed", error);
        }
      }, REFRESH_DEBOUNCE_MS);
    };
    lifecycle.add(() => {
      if (refreshTimer != null) clearTimeout(refreshTimer);
      refreshTimer = null;
      refreshAll = () => {
      };
    });
    await lifecycle.settingsPanel(extensionAPI, createSettingsPanel({ onChange: scheduleRefresh }));
    const getSettings = () => readSettings(extensionAPI);
    let actions = null;
    let audit = null;
    let toggleLayer = null;
    let backCommand = null;
    let showDockParent = null;
    let mountedApp = null;
    const hotkeyHandlers = {};
    const runHotkey = createHotkeyRunner({ handlers: hotkeyHandlers, getApp: () => mountedApp?.() ?? null });
    let commandZ = () => 0;
    let openSettings = () => console.warn("[plexus] unavailable outside Roam: settings");
    const doc = globalThis.document;
    const api = globalThis.roamAlphaAPI;
    if (doc && api) {
      const host = createRoamHost({ api });
      const settings = getSettings();
      const cache = createCropCache({
        graph: host.graphName(),
        persist: settings.cacheOnDisk && !host.isEncrypted(),
        limitBytes: settings.cacheLimitMb * 2 ** 20
      });
      lifecycle.add(() => cache.dispose());
      const cold = createColdRenderer({ api, doc });
      lifecycle.add(() => cold.dispose());
      const toaster = createToaster({ doc });
      lifecycle.add(() => toaster.dispose());
      const emitter = createEmitter();
      lifecycle.add(() => emitter.clear());
      const toolbar = createEditorToolbar({
        doc,
        onAreaRegion: () => actions.createAreaRegion(),
        onImageRegion: () => actions.createImageRegion(),
        onFrameRegion: () => actions.createFrameRegion(),
        canFrame: () => actions.isFrameSelected(),
        onCropRegion: () => actions.regionFromCrop(),
        canCrop: () => actions.hasCroppedImageSelected(),
        onEmbed: () => actions.insertEmbedFromClipboard(),
        onEmbedPicker: () => openPicker(),
        onNote: () => mounted?.noteTool?.arm(),
        onPresent: () => actions.presentDrawing(),
        canPresent: () => actions.hasFrames(),
        onMindMap: () => actions.startMindMap().catch((error) => console.warn("[plexus] mind map failed", error)),
        onEditEmbed: () => actions.editEmbed(),
        canEditEmbed: () => actions.canEditEmbed(),
        onToggleRegions: () => toggleRegionsLayer(),
        regionsVisible: () => !!mounted?.layer?.visible(),
        onToggleDock: () => toggleDock(),
        dockOpen: () => !!mounted?.dock?.isOpen(),
        dockInset: () => {
          const dock = mounted?.dock;
          return dock?.isOpen() && dock.mode() === "overlay" ? dock.el.getBoundingClientRect().width : 0;
        },
        onBack: () => goBack(),
        canBack: () => (mounted?.history?.size() ?? 0) > 0
      });
      lifecycle.add(() => toolbar.dispose());
      const guard2 = createWriteGuard({
        toaster,
        isActive: (app, uid) => {
          const editor = activeEditor(doc);
          return editor?.app === app && editor.drawingUid === uid;
        }
      });
      lifecycle.add(() => guard2.dispose());
      const scenes = createSceneRegistry({ native: native_exports, doc, guard: guard2 });
      lifecycle.add(() => scenes.dispose());
      let mounted = null;
      mountedApp = () => mounted?.app ?? null;
      let layerOn = false;
      const toggleRegionsLayer = () => {
        layerOn = !layerOn;
        const layer = mounted?.layer;
        if (layer) {
          if (layerOn) layer.show();
          else layer.hide();
        }
        toolbar.refresh();
        return layerOn;
      };
      let dockOn = false;
      const placeToolbar = () => {
        toolbar.refresh();
        toolbar.place();
        later(() => toolbar.place(), DOCK_SETTLE_MS);
      };
      const openDock = () => {
        const current2 = mounted;
        if (!current2?.uid || !current2.outer || current2.dock?.isOpen()) return null;
        const dock = createDock({
          doc,
          api,
          app: current2.app,
          containerEl: current2.el,
          outerEl: current2.outer,
          drawingUid: current2.uid,
          zIndex: current2.z,
          width: getSettings().dockWidth,
          onWidth: (w) => {
            writeSetting(extensionAPI, SETTING_IDS.dockWidth, String(w));
            placeToolbar();
          },
          onClose: () => {
            if (current2.dock === dock) current2.dock = null;
            dockOn = false;
            placeToolbar();
          },
          parentOf: (uid) => host.parentOf(uid),
          onNavigate: ({ target, sidebar } = {}) => {
            if (!navigateToTarget({ api, containerEl: current2.el, target, sidebar: !!sidebar })) return;
            if (!sidebar) navigatedAt = Date.now();
            hover.hide();
            if (sidebar) toaster.show("Opened in sidebar");
          },
          addBlock: (rootUid) => actions.addOutlineBlock(rootUid),
          toast: (message) => toaster.show(message, { kind: "error" })
        });
        current2.dock = dock;
        dockOn = true;
        placeToolbar();
        return dock;
      };
      const toggleDock = () => {
        const dock = mounted?.dock;
        if (dock?.isOpen()) {
          dock.close();
          return false;
        }
        return !!openDock();
      };
      const goBack = async () => {
        const current2 = mounted;
        if (!current2?.history) return false;
        return current2.history.back(current2.app, { animate: motionOk(doc, getSettings().animation), doc });
      };
      let regionref = null;
      const zIndexFor = (el) => {
        const outer = el?.closest?.(".excalidraw-outer-container");
        if (outer) return baseZIndex(doc, outer);
        const z = Number.parseInt(doc.defaultView?.getComputedStyle?.(el)?.zIndex, 10);
        return Number.isFinite(z) ? z : 1e3;
      };
      commandZ = () => {
        const editor = activeEditor(doc);
        return editor ? zIndexFor(editor.el) : 0;
      };
      const presenter = createPresenter({ doc });
      lifecycle.add(() => presenter.dispose());
      const mmWriter = createMmWriter({ api, graph: host.graphName() });
      const measurer = createMeasurer({ doc });
      const mindmap = createMindMap({ doc, api, writer: mmWriter, measurer, native: native_exports, toaster, guardedWrite: guard2.guardedWrite, zIndexFor: (outer) => outer ? baseZIndex(doc, outer) : 1e3 });
      lifecycle.add(() => mindmap.dispose());
      actions = createActions({
        host,
        native: native_exports,
        cache,
        cold,
        toaster,
        spotlight: showSpotlight,
        getSettings,
        doc,
        api,
        emit: (detail) => emitter.emit(detail),
        clipboard: globalThis.navigator?.clipboard,
        openPrompt: openCaptionPrompt,
        presenter,
        mindmap,
        getEmbedOverlay: () => mounted?.overlay ?? null,
        measure: measurer.measure,
        ensureFonts: measurer.ensureFonts,
        refreshRegion: (uid, opts) => regionref?.refreshRegion(uid, opts),
        guard: guard2,
        camera: camera_exports,
        motionOk,
        viewHistory: (app) => mounted?.app === app ? mounted.history : null
      });
      lifecycle.add(() => actions.dispose());
      const timers = /* @__PURE__ */ new Set();
      let closed = false;
      lifecycle.add(() => {
        closed = true;
        for (const t of timers) clearTimeout(t);
        timers.clear();
      });
      const later = (fn, ms) => {
        const t = setTimeout(() => {
          timers.delete(t);
          try {
            fn();
          } catch (error) {
            console.warn("[plexus] timer failed", error);
          }
        }, ms);
        timers.add(t);
      };
      const sceneAt = (app, point) => point ? viewportToScene({ x: point.x, y: point.y, appState: app.state }) : void 0;
      const refocus = (el) => {
        try {
          el?.focus?.({ preventScroll: true });
        } catch {
        }
      };
      let pickerHandle = null;
      lifecycle.add(() => {
        pickerHandle?.close?.();
        pickerHandle = null;
      });
      const openPicker = async (point) => {
        try {
          const editor = activeEditor(doc);
          if (!editor) return void toaster.show("Open a drawing first", { kind: "error" });
          const { app, el } = editor;
          let semantic = false;
          try {
            semantic = await api.data?.semanticSearchEnabled?.() === true;
          } catch {
            semantic = false;
          }
          if (closed || activeEditor(doc)?.app !== app) return;
          const rect = el.getBoundingClientRect?.() ?? { left: 100, top: 100, width: 0 };
          const anchorRect = point ? { left: point.x, top: point.y, bottom: point.y } : { left: rect.left + Math.max(0, (rect.width - 400) / 2), top: rect.top + 80, bottom: rect.top + 80 };
          const scenePoint = sceneAt(app, point);
          const finish = (out) => Promise.resolve(out).catch((error) => console.warn("[plexus] embed pick failed", error)).then(() => refocus(el));
          pickerHandle = openEmbedPicker({
            doc,
            api,
            anchorRect,
            zIndex: zIndexFor(el),
            semantic,
            onPick: ({ ref }) => finish(actions.embedFromPick({ ref, scenePoint, app })),
            onCreate: (title) => finish(actions.createPageAndEmbed(title, scenePoint, { app })),
            onClose: ({ picked }) => {
              if (!picked && (doc.activeElement == null || doc.activeElement === doc.body)) refocus(el);
            }
          });
        } catch (error) {
          console.warn("[plexus] embed picker failed", error);
        }
      };
      const onEmbedPick = ({ ref, title, create }) => {
        const editor = activeEditor(doc);
        if (!editor) return;
        const { app, el } = editor;
        const text = app.state?.editingTextElement;
        if (!text) return;
        const elements = app.getSceneElementsIncludingDeleted?.() ?? [];
        const box = text.containerId && elements.find((e) => e.id === text.containerId) || text;
        const scenePoint = { x: (box.x ?? 0) + (box.width ?? 0) / 2, y: (box.y ?? 0) + (box.height ?? 0) + 124 };
        const started = Date.now();
        const run2 = () => {
          if (closed) return;
          if (app.state?.editingTextElement && Date.now() - started < 500) return later(run2, 25);
          const out = create ? actions.createPageAndEmbed(title, scenePoint, { app }) : actions.embedFromPick({ ref, scenePoint, app });
          Promise.resolve(out).catch((error) => console.warn("[plexus] embed pick failed", error)).then(() => refocus(el));
        };
        later(run2, 25);
      };
      const createPage = (title) => Promise.resolve().then(() => host.ensurePage(title)).catch((error) => {
        console.warn("[plexus] create page failed", error);
        toaster.show("Could not create the page", { kind: "error" });
      });
      const runAction = (name) => () => actions[name]();
      hotkeyHandlers.region = runAction("createAreaRegion");
      hotkeyHandlers.image = runAction("createImageRegion");
      hotkeyHandlers.present = runAction("presentDrawing");
      hotkeyHandlers.mindmap = () => mounted ? actions.startMindMap() : actions.mindMapFromOutline(api.ui?.getFocusedBlock?.()?.["block-uid"]);
      hotkeyHandlers.embed = () => openPicker();
      hotkeyHandlers.dock = () => {
        if (!mounted?.uid) return void toaster.show("Open a drawing first", { kind: "error" });
        toggleDock();
      };
      showDockParent = () => {
        if (!mounted?.uid) return void toaster.show("Open a drawing first", { kind: "error" });
        const parent = host.parentOf(mounted.uid);
        if (!parent || parent.isPage) return void toaster.show("This drawing sits directly on its page", { kind: "error" });
        const dock = mounted.dock?.isOpen() ? mounted.dock : openDock();
        void Promise.resolve(dock?.setRoot("parent")).catch((error) => console.warn("[plexus] dock parent failed", error));
      };
      hotkeyHandlers.note = () => {
        if (!mounted?.noteTool) return void toaster.show("Open a drawing first", { kind: "error" });
        mounted.noteTool.arm();
      };
      const publicApi = createPublicApi({ host, actions, emitter, version: extension?.version || "development", scenes, openDrawing: (uid, opts) => actions.openDrawing(uid, opts) });
      installPublicApi(publicApi, { win: flagTarget });
      lifecycle.add(() => uninstallPublicApi(publicApi, { win: flagTarget }));
      lifecycle.add(installRegionLanding({
        doc,
        api,
        host,
        getSettings,
        openRegion: (uid) => actions.openRegion(uid).catch((error) => console.warn("[plexus] open failed", error))
      }));
      const labelOf = (region) => {
        try {
          const src = host.labelSource?.(region.drawingUid) ?? { string: "", pageTitle: null };
          return regionLabel({
            kind: region.kind,
            caption: region.caption ?? "",
            drawingTitle: drawingTitleOf(src.string, src.pageTitle),
            imageAlt: isImageKind(region.kind) ? imageAltAt(src.string, region.i) : null,
            resolveBlock: (u) => host.labelSource?.(u)?.string ?? ""
          });
        } catch {
          return "Region";
        }
      };
      let auditHandle = null;
      lifecycle.add(() => auditHandle?.close?.());
      const openAudit = async (scope) => {
        const rows = await actions.auditRegions({ scope });
        if (!rows) return;
        const previous = auditHandle;
        auditHandle = openAuditDialog({
          doc,
          rows,
          dark: isHostDark(doc),
          onOpen: (row) => {
            const target = auditOpenTarget(row);
            return target.via === "region" ? actions.openRegion(target.uid) : host.openBlock(target.uid);
          },
          onRepair: (row) => actions.repairRegion(row.uid)
        });
        previous?.close?.();
      };
      audit = openAudit;
      toggleLayer = toggleRegionsLayer;
      backCommand = goBack;
      regionref = createRegionRefRenderer({
        host,
        cache,
        cold,
        getSettings,
        doc,
        onOpen: (uid, opts) => actions.openRegion(uid, opts).catch((error) => console.warn("[plexus] open failed", error))
      });
      lifecycle.add(() => regionref.releaseAll());
      refreshAll = () => regionref.refreshAll();
      const ThemeMO = doc.defaultView?.MutationObserver ?? globalThis.MutationObserver;
      if (ThemeMO && doc.documentElement && doc.body) {
        let wasDark = isHostDark(doc);
        const themeObserver = new ThemeMO(() => {
          try {
            resetThemeMemo();
            const now = isHostDark(doc);
            if (mounted?.dock?.isOpen()) mounted.dock.refreshTheme();
            if (now !== wasDark) {
              wasDark = now;
              scheduleRefresh();
            }
          } catch (error) {
            console.warn("[plexus] theme observer failed", error);
          }
        });
        lifecycle.observer(themeObserver, doc.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
        themeObserver.observe(doc.body, { attributes: true, attributeFilter: ["class", "style"] });
      }
      let settingsHandle = null;
      lifecycle.add(() => settingsHandle?.close());
      openSettings = () => settingsHandle = openSettingsDialog({
        doc,
        get: (id) => extensionAPI.settings.get(id),
        set: (id, value) => writeSetting(extensionAPI, id, value),
        onChanged: () => regionref.refreshAll(),
        dark: isHostDark(doc)
      });
      lifecycle.add(installRoamMenus({
        api,
        host,
        actions,
        regionref,
        getSettings,
        setRefOverride: (blockUid, refUid, patch) => setRefOverride(extensionAPI, blockUid, refUid, patch),
        openSettings,
        openPrompt: openCaptionPrompt,
        isEncrypted: () => host.isEncrypted(),
        native: native_exports,
        hasEditor: () => !!activeEditor(doc),
        doc
      }));
      const suggest = createLinkSuggest({ doc, api, zIndexFor, createPage, onEmbedPick });
      lifecycle.add(() => suggest.dispose());
      lifecycle.add(installSuggestAutoAttach({ doc, suggest }));
      const hover = createHoverPreview({ doc, api });
      lifecycle.add(() => hover.dispose());
      const thumbTimers = /* @__PURE__ */ new Set();
      let thumbsOff = false;
      lifecycle.add(() => {
        thumbsOff = true;
        for (const t of thumbTimers) clearTimeout(t);
        thumbTimers.clear();
      });
      lifecycle.add(clearImageMemo);
      const warmThumbnails = (uid) => {
        if (thumbsOff) return;
        const timer = setTimeout(async () => {
          thumbTimers.delete(timer);
          for (const maxWidth of THUMB_WIDTHS) {
            if (thumbsOff) return;
            try {
              await actions.thumbnail(uid, { maxWidth, render: true });
            } catch (error) {
              console.warn("[plexus] thumbnail warm failed", error);
            }
          }
        }, THUMB_WARM_DELAY_MS);
        thumbTimers.add(timer);
      };
      let navigatedAt = -Infinity;
      const unmountEditor = ({ unloading = false } = {}) => {
        const current2 = mounted;
        mounted = null;
        if (!current2) return Promise.resolve();
        if (Date.now() - navigatedAt <= 2e3) clearLinkTooltip(doc);
        const pending = [];
        for (const dispose of current2.disposers) {
          try {
            const out = dispose();
            if (out && typeof out.then === "function") pending.push(out.catch((error) => console.warn("[plexus] editor cleanup failed", error)));
          } catch (error) {
            console.warn("[plexus] editor cleanup failed", error);
          }
        }
        if (current2.app) scenes.release(current2.app);
        actions.cancelDrawingTool();
        if (current2.uid) {
          emitter.emit({ uid: current2.uid, kind: "drawing" });
          warmThumbnails(current2.uid);
          if (!unloading) {
            Promise.resolve(actions.refreshAfterClose(current2.uid, current2.hash)).catch((error) => console.warn("[plexus] refresh after close failed", error));
          }
        }
        return Promise.all(pending).then(() => void 0);
      };
      lifecycle.add(() => unmountEditor({ unloading: true }));
      const discovery = createDiscovery({
        root: doc.body,
        onRegionButton: (btn) => regionref.claim(btn),
        onAlias: (a) => regionref.claimAlias(a),
        onEditorMount: (el) => {
          const outer = el.closest(".excalidraw-outer-container");
          if (outer) toolbar.show(outer);
          unmountEditor();
          const app = findApp(el);
          if (!app) return;
          const mountUid = host.blockUidFromNode(el);
          let mountHash = "";
          try {
            mountHash = mountUid && host.drawing(mountUid)?.hash || "";
          } catch (error) {
            console.warn("[plexus] mount hash failed", error);
          }
          const history = createViewHistory({ onChange: () => toolbar.refresh() });
          const mountZ = outer ? baseZIndex(doc, outer) : 1e3;
          mounted = { uid: mountUid, app, el, outer, z: mountZ, disposers: [], overlay: null, hash: mountHash, history, layer: null, dock: null };
          try {
            const off = app.onChangeEmitter?.on?.(() => toolbar.refresh());
            if (typeof off === "function") mounted.disposers.push(off);
          } catch (error) {
            console.warn("[plexus] toolbar refresh subscribe failed", error);
          }
          toolbar.refresh();
          mounted.disposers.push(hover.attach({ app, containerEl: el }));
          const overlay = createEmbedOverlay({
            doc,
            api,
            host,
            app,
            containerEl: el,
            zIndex: outer ? baseZIndex(doc, outer) : 1e3,
            toast: (message) => toaster.show(message, { kind: "error" }),
            onStateChange: () => toolbar.refresh()
          });
          mounted.overlay = overlay;
          mounted.disposers.push(() => overlay.dispose());
          mounted.disposers.push(installEmbedF2({ containerEl: el, app, canEdit: () => actions.canEditEmbed(), onEdit: () => actions.editEmbed() }));
          mounted.disposers.push(mindmap.mount({ app, containerEl: el, outerEl: outer, zIndex: outer ? baseZIndex(doc, outer) : 1e3, drawingUid: mountUid }));
          mounted.disposers.push(installBackKey({ containerEl: el, app, canBack: () => history.size() > 0, onBack: () => goBack() }));
          mounted.disposers.push(installHotkeyGuard({ containerEl: el, run: runHotkey, doc }));
          const refExists = (ref) => {
            const parsed = parseEmbedRef(ref);
            if (parsed?.kind === "block") return !!api.data.pull("[:db/id]", [":block/uid", parsed.uid]);
            if (parsed?.kind === "page") return !!api.data.pull("[:db/id]", [":node/title", parsed.title]);
            return false;
          };
          mounted.disposers.push(installRefPaste({
            doc,
            containerEl: el,
            app,
            getSettings,
            exists: refExists,
            onRef: ({ ref, scenePoint }) => {
              const out = getSettings().pasteRefs === "link" ? actions.placeBlocks([ref], { mode: "link", scenePoint, app }) : actions.embedFromPick({ ref, scenePoint, app });
              Promise.resolve(out).catch((error) => console.warn("[plexus] ref paste failed", error));
            }
          }));
          const noteTool = installNoteTool({
            doc,
            containerEl: el,
            app,
            canArm: () => !!mountUid,
            onPlace: (scenePoint) => Promise.resolve(actions.newNoteCard(scenePoint)).catch((error) => console.warn("[plexus] note failed", error))
          });
          mounted.noteTool = noteTool;
          mounted.disposers.push(() => noteTool.dispose());
          mounted.disposers.push(() => pickerHandle?.close?.());
          mounted.disposers.push(() => history.clear());
          let backlinks = null;
          if (mountUid) {
            const layer = createRegionsLayer({
              doc,
              app,
              containerEl: el,
              host,
              drawingUid: mountUid,
              native: native_exports,
              zIndex: outer ? baseZIndex(doc, outer) : 1e3,
              labelOf,
              debug: () => getSettings().debug,
              onSelect: (regionUid) => actions.selectRegionOnDrawing(regionUid),
              onOpenSidebar: (regionUid) => {
                Promise.resolve(host.openBlock(regionUid, { sidebar: true })).then(() => toaster.show("Opened in sidebar")).catch((error) => console.warn("[plexus] open in sidebar failed", error));
              }
            });
            mounted.layer = layer;
            mounted.disposers.push(() => {
              layer.dispose();
              if (mounted?.layer === layer) mounted.layer = null;
            });
            if (layerOn) layer.show();
            let layerTimer = null;
            const onChange = (detail) => {
              if (detail?.kind !== "region") return;
              if (layerTimer != null) clearTimeout(layerTimer);
              layerTimer = setTimeout(() => {
                layerTimer = null;
                try {
                  layer.refresh();
                  backlinks?.refresh();
                } catch (error) {
                  console.warn("[plexus] layer refresh failed", error);
                }
              }, LAYER_REFRESH_MS);
            };
            emitter.on("change", onChange);
            mounted.disposers.push(() => {
              emitter.off("change", onChange);
              if (layerTimer != null) clearTimeout(layerTimer);
              layerTimer = null;
            });
          }
          mounted.disposers.push(installRoamDrop({
            doc,
            containerEl: el,
            app,
            zIndex: mountZ,
            exclude: mountUid,
            resolve: (uid) => {
              const raw = api.data.pull("[:node/title :block/string]", [":block/uid", uid]);
              if (raw?.[":node/title"] != null) return { kind: "page", title: raw[":node/title"] };
              return raw?.[":block/string"] != null ? { kind: "block" } : null;
            },
            toast: (message) => toaster.show(message, { kind: "error" }),
            onDrop: ({ items, mode, scenePoint }) => {
              Promise.resolve(actions.placeBlocks(items, { mode, scenePoint, app })).catch((error) => console.warn("[plexus] drop failed", error));
            }
          }));
          mounted.disposers.push(installTextLinks({
            doc,
            api,
            app,
            containerEl: el,
            zIndex: mountZ,
            toast: (message) => toaster.show(message, { kind: "error" }),
            navigate: ({ target, sidebar } = {}) => {
              if (!navigateToTarget({ api, containerEl: el, target, sidebar: !!sidebar })) return;
              if (!sidebar) navigatedAt = Date.now();
              hover.hide();
              if (sidebar) toaster.show("Opened in sidebar");
            }
          }));
          const own = mounted;
          mounted.disposers.push(() => {
            const dock = own.dock;
            if (!dock) return void 0;
            own.dock = null;
            return dock.dispose();
          });
          if (dockOn && mountUid) {
            try {
              openDock();
            } catch (error) {
              console.warn("[plexus] dock open failed", error);
            }
          }
          mounted.disposers.push(installCanvasMenu({
            doc,
            app,
            containerEl: el,
            getItems: (point) => plexusCanvasItems({
              app,
              native: native_exports,
              actions,
              openSettings,
              drawingUid: mountUid,
              guard: guard2,
              point,
              openPicker: (p) => openPicker(p),
              noteAt: (p) => actions.newNoteCard(sceneAt(app, p)),
              toScene: (p) => sceneAt(app, p)
            })
          }));
          if (mounted.uid && getSettings().showBacklinks) {
            backlinks = createCanvasBacklinks({
              doc,
              api,
              host,
              app,
              containerEl: el,
              drawingUid: mounted.uid,
              zIndex: outer ? baseZIndex(doc, outer) : 1e3,
              native: native_exports,
              openTarget: (target, { sidebar } = {}) => {
                if (!navigateToTarget({ api, containerEl: el, target, sidebar: !!sidebar })) return;
                if (!sidebar) navigatedAt = Date.now();
                hover.hide();
                if (sidebar) toaster.show("Opened in sidebar");
              }
            });
            mounted.disposers.push(() => backlinks.dispose());
          }
          mounted.disposers.push(installLinkInterception({ app, containerEl: el, api, getSettings, onNavigate: ({ sidebar } = {}) => {
            if (!sidebar) navigatedAt = Date.now();
            hover.hide();
            if (sidebar) toaster.show("Opened in sidebar");
          } }));
        },
        onEditorUnmount: () => {
          toolbar.hide();
          unmountEditor();
        }
      });
      lifecycle.add(() => discovery.dispose());
      discovery.scanExisting();
    }
    const unavailable = (name) => console.warn("[plexus] unavailable outside Roam:", name);
    const run = (name) => () => {
      if (!actions) return unavailable(name);
      return actions[name]().catch((error) => console.warn("[plexus]", name, "failed", error));
    };
    const guarded = (name, fn) => () => {
      if (!fn()) return unavailable(name);
      try {
        const out = fn()();
        if (out && typeof out.catch === "function") return out.catch((error) => console.warn("[plexus]", name, "failed", error));
        return out;
      } catch (error) {
        console.warn("[plexus]", name, "failed", error);
      }
    };
    const specOf = (id) => HOTKEYS.find((h) => h.id === id)?.spec;
    const newDrawing = (where, useFocus) => (ctx) => {
      if (!actions) return unavailable("newDrawing");
      const args = useFocus === false ? { where } : { where, uid: ctx?.focusedUid };
      Promise.resolve(actions.newDrawing(args)).catch((error) => console.warn("[plexus] new drawing failed", error));
    };
    const isMac = /mac|iphone|ipad/i.test(String(doc?.defaultView?.navigator?.platform ?? ""));
    const hk = (id) => hotkeyFor(id, { mac: isMac });
    const commandList = [
      { id: "newDrawingHere", label: "New drawing here", run: newDrawing("here") },
      { id: "newDrawingBelow", label: "New drawing below", run: newDrawing("below") },
      { id: "newDrawingPage", label: "New drawing on page", run: newDrawing("page") },
      { id: "newDrawingToday", label: "New drawing on today", run: newDrawing("today", false) },
      { id: "region", label: "Create region from selection", hotkey: hk("region"), run: () => runHotkey("region") },
      { id: "image", label: "Create image region", hotkey: hk("image"), run: () => runHotkey("image") },
      { id: "framesRegions", label: "Regions for all frames", run: guarded("regionsForAllFrames", () => actions && (() => actions.regionsForAllFrames())) },
      { id: "mindmap", label: "Mind map", hotkey: hk("mindmap"), run: () => runHotkey("mindmap") },
      {
        id: "mindMapFromOutline",
        label: "Mind map from outline",
        run: (ctx) => {
          if (!actions) return unavailable("mindMapFromOutline");
          return actions.mindMapFromOutline(ctx?.focusedUid).catch((error) => console.warn("[plexus] mind map failed", error));
        }
      },
      { id: "embed", label: "Embed page or block…", hotkey: hk("embed"), run: () => runHotkey("embed") },
      { id: "note", label: "New note card", hotkey: hk("note"), run: () => runHotkey("note") },
      { id: "present", label: "Present open drawing", hotkey: hk("present"), run: () => runHotkey("present") },
      { id: "back", label: "Back to previous view", run: guarded("back", () => backCommand && (() => backCommand())) },
      { id: "toggleLayer", label: "Toggle regions layer", run: guarded("toggleLayer", () => toggleLayer && (() => toggleLayer())) },
      { id: "dock", label: "Toggle outline dock", hotkey: hk("dock"), run: () => runHotkey("dock") },
      { id: "dockParent", label: "Outline dock: show parent", run: () => showDockParent ? showDockParent() : unavailable("dockParent") },
      { id: "refreshCrops", label: "Refresh crops for open drawing", run: run("refreshCropsForOpenDrawing") },
      { id: "clearCache", label: "Clear crop cache", run: run("clearCache") },
      { id: "auditPage", label: "Audit regions on this page", run: guarded("auditPage", () => audit && (() => audit("page"))) },
      { id: "auditGraph", label: "Audit regions in graph", run: guarded("auditGraph", () => audit && (() => audit("graph"))) },
      { id: "restore", label: "Restore before last Plexus change", run: guarded("restore", () => actions && (() => actions.restoreBeforeLastPlexusChange())) },
      { id: "captionCleanupDryRun", label: "Clear placeholder captions (dry run)", run: run("captionCleanupDryRun") },
      { id: "undoCaptionCleanup", label: "Undo caption cleanup", run: run("undoCaptionCleanup") },
      { id: "legacyDryRun", label: "Legacy drawings (dry run)", run: run("legacyDryRun") },
      { id: "settings", label: "Region settings", run: () => openSettings() }
    ];
    let commandListHandle = null;
    lifecycle.add(() => {
      commandListHandle?.close?.();
      commandListHandle = null;
    });
    await lifecycle.command(extensionAPI.ui.commandPalette, {
      label: "Plexus: Commands…",
      callback: () => {
        try {
          const focusedUid = globalThis.roamAlphaAPI?.ui?.getFocusedBlock?.()?.["block-uid"];
          commandListHandle = openList({ doc, commands: commandList, ctx: { focusedUid }, zIndex: commandZ(), mac: isMac });
        } catch (error) {
          console.warn("[plexus] command list failed", error);
        }
      }
    });
    await lifecycle.command(extensionAPI.ui.commandPalette, { label: "Plexus: Mind map", callback: () => runHotkey("mindmap"), "default-hotkey": specOf("mindmap") });
    try {
      const slash = extensionAPI.ui?.slashCommand ?? globalThis.roamAlphaAPI?.ui?.slashCommand;
      await lifecycle.command(slash, {
        label: "Sketch here",
        callback: (ctx) => {
          const uid = ctx?.["block-uid"] ?? globalThis.roamAlphaAPI?.ui?.getFocusedBlock?.()?.["block-uid"];
          if (!actions) {
            unavailable("newDrawing");
            return "";
          }
          Promise.resolve(actions.newDrawing({ where: "here", uid })).catch((error) => console.warn("[plexus] new drawing failed", error));
          return "";
        }
      });
    } catch (error) {
      console.warn("[plexus] slash command unavailable", error);
    }
    console.info(`[plexus] Loaded v${extension?.version || "development"}`);
  } catch (error) {
    if (activeLifecycle === lifecycle) activeLifecycle = null;
    await lifecycle.dispose().catch((cleanupError) => console.error(cleanupError));
    throw error;
  }
  return async () => {
    if (activeLifecycle === lifecycle) activeLifecycle = null;
    await lifecycle.dispose();
  };
}
async function onunload() {
  const lifecycle = activeLifecycle;
  activeLifecycle = null;
  if (lifecycle) await lifecycle.dispose();
  console.info("[plexus] Unloaded");
}
var extension_default = { onload, onunload };
export {
  extension_default as default,
  onload,
  onunload
};
