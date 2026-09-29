/* Plexus v0.1.0 | MIT | generated; edit src/ */
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

// src/settings.js
var SETTING_IDS = Object.freeze({
  openInSidebar: "open-in-sidebar",
  maxCropHeight: "max-crop-height",
  cacheOnDisk: "cache-on-disk",
  cacheLimitMb: "cache-limit-mb",
  debug: "debug"
});
var DEFAULTS = Object.freeze({
  [SETTING_IDS.openInSidebar]: false,
  [SETTING_IDS.maxCropHeight]: "360",
  [SETTING_IDS.cacheOnDisk]: true,
  [SETTING_IDS.cacheLimitMb]: "100",
  [SETTING_IDS.debug]: false
});
async function initializeSettings(extensionAPI) {
  if (extensionAPI.settings.canSet === false) return;
  for (const [id, value] of Object.entries(DEFAULTS)) {
    if (extensionAPI.settings.get(id) == null) await extensionAPI.settings.set(id, value);
  }
}
function createSettingsPanel() {
  return {
    tabTitle: "Plexus",
    settings: [
      { id: SETTING_IDS.openInSidebar, name: "Open regions in sidebar", description: "Clicking a region crop opens the drawing in the right sidebar.", action: { type: "switch" } },
      { id: SETTING_IDS.maxCropHeight, name: "Max crop height (px)", description: "Maximum rendered height of a region crop.", action: { type: "input", placeholder: "360" } },
      { id: SETTING_IDS.cacheOnDisk, name: "Cache crops on disk", description: "Store rendered crops in IndexedDB. Ignored on encrypted graphs.", action: { type: "switch" } },
      { id: SETTING_IDS.cacheLimitMb, name: "Cache limit (MB)", description: "Maximum size of the on-disk crop cache.", action: { type: "input", placeholder: "100" } },
      { id: SETTING_IDS.debug, name: "Debug logging", description: "Log Plexus diagnostics to the console.", action: { type: "switch" } }
    ]
  };
}
function readSettings(extensionAPI) {
  const get = (id) => {
    const value = extensionAPI.settings.get(id);
    return value == null ? DEFAULTS[id] : value;
  };
  return {
    openInSidebar: !!get(SETTING_IDS.openInSidebar),
    maxCropHeight: Number(get(SETTING_IDS.maxCropHeight)) || 360,
    cacheOnDisk: !!get(SETTING_IDS.cacheOnDisk),
    cacheLimitMb: Number(get(SETTING_IDS.cacheLimitMb)) || 100,
    debug: !!get(SETTING_IDS.debug)
  };
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
var SUPPORTED_KINDS = Object.freeze(["area", "rect"]);
var RESERVED_KINDS = Object.freeze(["group", "frame", "cframe", "poly"]);
var ID_RE = /^[A-Za-z0-9_-]+$/;
var isId = (value) => typeof value === "string" && ID_RE.test(value);
var HEAD_RE = /^\s*\{\{\[\[plexus-region\]\]:\s*([^}]*)\}\}(?: ([\s\S]*))?$/;
var KNOWN_KEYS = /* @__PURE__ */ new Set(["k", "d", "ids", "pad", "el", "f"]);
var clamp01 = (n) => Math.min(1, Math.max(0, n));
var round4 = (n) => Math.round(n * 1e4) / 1e4;
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
  const fail = (error) => {
    region.error = error;
    return region;
  };
  if (bad.length) return fail(`bad token ${bad[0]}`);
  if (!kind) return fail("missing k");
  if (RESERVED_KINDS.includes(kind)) {
    for (const key of ["f", "el", "pad", "ids"]) if (args.has(key)) extra.unshift([key, args.get(key)]);
    if (drawingUid && !ID_RE.test(drawingUid)) return fail("bad d");
    return region;
  }
  if (!SUPPORTED_KINDS.includes(kind)) return fail(`unknown kind ${kind}`);
  if (!drawingUid) return fail("missing d");
  if (!ID_RE.test(drawingUid)) return fail("bad d");
  if (kind === "area") {
    if (!args.has("ids")) return fail("missing ids");
    const ids = args.get("ids").split(",");
    if (!ids.length || ids.some((id) => !ID_RE.test(id))) return fail("bad ids");
    let pad = DEFAULT_PAD;
    if (args.has("pad")) {
      const raw = args.get("pad");
      pad = /^\d+$/.test(raw) ? Number(raw) : NaN;
      if (!(pad >= 0 && pad <= 200)) return fail("bad pad");
    }
    region.ids = ids;
    region.pad = pad;
  } else {
    if (!args.has("el")) return fail("missing el");
    const el = args.get("el");
    if (!ID_RE.test(el)) return fail("bad el");
    if (!args.has("f")) return fail("missing f");
    const parts = args.get("f").split(",");
    if (parts.length !== 4 || parts.some((p) => p.trim() === "")) return fail("bad f");
    const f = normalizeFrac(parts.map(Number));
    if (!f) return fail("bad f");
    region.el = el;
    region.f = f;
  }
  region.supported = true;
  return region;
}
function need(cond, msg) {
  if (!cond) throw new TypeError(`serializeRegion: ${msg}`);
}
function serializeRegion(region) {
  need(region && typeof region === "object", "region required");
  const { kind, drawingUid } = region;
  need(SUPPORTED_KINDS.includes(kind) || RESERVED_KINDS.includes(kind), `unknown kind ${kind}`);
  need(typeof drawingUid === "string" && ID_RE.test(drawingUid), "bad drawingUid");
  const tokens = [`k=${kind}`, `d=${drawingUid}`];
  if (kind === "area") {
    need(Array.isArray(region.ids) && region.ids.length > 0 && region.ids.every((id) => typeof id === "string" && ID_RE.test(id)), "bad ids");
    const pad = region.pad ?? DEFAULT_PAD;
    need(Number.isInteger(pad) && pad >= 0 && pad <= 200, "bad pad");
    tokens.push(`ids=${region.ids.join(",")}`, `pad=${pad}`);
  } else if (kind === "rect") {
    need(typeof region.el === "string" && ID_RE.test(region.el), "bad el");
    const f = normalizeFrac(region.f);
    need(f, "bad f");
    tokens.push(`el=${region.el}`, `f=${f.join(",")}`);
  }
  for (const pair of region.extra ?? []) {
    need(Array.isArray(pair) && typeof pair[0] === "string" && /^[^\s=}]+$/.test(pair[0]) && /^[^\s}]*$/.test(String(pair[1])), "bad extra token");
    tokens.push(`${pair[0]}=${pair[1]}`);
  }
  const caption = String(region.caption ?? "").replace(/\s+/g, " ").trim();
  return `{{[[${REGION_COMPONENT}]]: ${tokens.join(" ")}}}${caption ? ` ${caption}` : ""}`;
}
function geometryKey(region) {
  if (region.kind === "area") {
    return `area|${region.drawingUid}|${[...region.ids ?? []].sort().join(",")}|${region.pad ?? DEFAULT_PAD}`;
  }
  if (region.kind === "rect") {
    return `rect|${region.drawingUid}|${region.el}|${(region.f ?? []).join(",")}`;
  }
  return `${region.kind}|${region.drawingUid}`;
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
function regionSceneBBox(region, elements) {
  const live = liveElements(elements);
  if (!region || !live.length) return { error: "no-elements" };
  if (region.kind === "area") {
    const byId = new Map(live.map((el) => [el.id, el]));
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
  if (region.kind === "rect") {
    const el = live.find((e) => e.id === region.el);
    if (!el) return { error: "no-elements" };
    if (el.type !== "image") return { error: "not-image" };
    if (Number(el.angle) || 0) return { error: "rotated-image" };
    const [rx, ry, rw, rh] = region.f;
    return {
      bbox: [el.x + rx * el.width, el.y + ry * el.height, el.x + (rx + rw) * el.width, el.y + (ry + rh) * el.height],
      missing: []
    };
  }
  return { error: "unsupported-kind" };
}
function viewPngCropRect({ elements, bbox, naturalWidth, naturalHeight, padding = VIEW_EXPORT_PADDING }) {
  const cb = commonBounds(elements);
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

// src/host/roam.js
var PULL_PATTERN = "[:block/uid :block/string :edit/time :block/open :block/props {:block/children [:block/uid :block/string :block/order]}]";
var DRAWING_MEMO_CAP = 64;
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
  const memo = /* @__PURE__ */ new Map();
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
    const cached = memo.get(uid);
    if (cached && cached.editTime === block.editTime) {
      memo.delete(uid);
      memo.set(uid, cached);
      return cached.value;
    }
    const parsed = block.props ? parseProps(block.props) : null;
    const value = parsed ? { ...parsed, uid, editTime: block.editTime, hash: hashFn(parsed.elementsJson ?? "") } : null;
    memo.delete(uid);
    memo.set(uid, { editTime: block.editTime, value });
    while (memo.size > DRAWING_MEMO_CAP) memo.delete(memo.keys().next().value);
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
  async function createRegion(drawingUid, regionString) {
    const graph = api.graph.name;
    const lock = await withLockFn(lockName(graph, drawingUid), async () => {
      const containerUid = await ensureRegionContainer(drawingUid);
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
    ensureRegionContainer,
    createRegion,
    openBlock,
    blockUidFromNode
  };
}

// src/host/native.js
var native_exports = {};
__export(native_exports, {
  activeEditor: () => activeEditor,
  captureSelectionSvg: () => captureSelectionSvg,
  findApp: () => findApp,
  looksLikeSvg: () => looksLikeSvg,
  selectedElementIds: () => selectedElementIds,
  viewportRectOf: () => viewportRectOf,
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
  if (!el || el.closest?.(".plexus-offscreen")) return null;
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
function captureSelectionSvg(app, ids, opts = {}) {
  const run = captureTail.then(() => captureOnce(app, ids, opts));
  captureTail = run.catch(() => {
  });
  return run;
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

// src/host/cache.js
var DB_NAME = "plexus-cache";
var STORE = "crops";
var CACHE_VERSION = 2;
function cropKey({ regionUid, geometryKey: geometryKey2, drawingHash, tier }) {
  return `v${CACHE_VERSION}|${regionUid}|${geometryKey2}|${drawingHash}|${tier}`;
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
async function cropCanvasToBlob(canvas, { sx, sy, sw, sh }, { doc = globalThis.document } = {}) {
  const out = doc.createElement("canvas");
  out.width = sw;
  out.height = sh;
  out.getContext("2d").drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return new Promise((resolve, reject) => {
    out.toBlob((blob) => blob ? resolve(blob) : reject(new Error("[plexus] toBlob failed")), "image/png");
  });
}

// src/view/toast.js
function createToaster({ doc }) {
  let el = null;
  let timer = null;
  let disposed = false;
  const hide = () => {
    if (timer != null) clearTimeout(timer);
    timer = null;
    el?.remove();
    el = null;
  };
  return {
    show(message, { kind = "info", ms = 2600 } = {}) {
      if (disposed) return;
      if (timer != null) clearTimeout(timer);
      if (!el) {
        el = doc.createElement("div");
        el.setAttribute("role", "status");
        doc.body.append(el);
      }
      el.className = `plexus-portal plexus-toast plexus-toast-${kind}`;
      el.textContent = message;
      timer = setTimeout(hide, ms);
    },
    dispose() {
      disposed = true;
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
function createEditorToolbar({ doc, onAreaRegion, onImageRegion }) {
  const view2 = doc.defaultView;
  let bar = null;
  let outer = null;
  const place = () => {
    if (!bar || !outer) return;
    const rect = outer.getBoundingClientRect();
    bar.style.left = `${rect.left + rect.width / 2}px`;
    bar.style.top = `${rect.top + 8}px`;
  };
  const button = (label, handler) => {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "plexus-toolbar-button";
    b.textContent = label;
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      Promise.resolve().then(handler).catch((error) => console.warn("[plexus] toolbar action failed", error));
    });
    return b;
  };
  const hide = () => {
    view2?.removeEventListener("resize", place);
    bar?.remove();
    bar = null;
    outer = null;
  };
  return {
    show(outerEl) {
      hide();
      outer = outerEl;
      bar = doc.createElement("div");
      bar.className = "plexus-portal plexus-toolbar";
      bar.style.zIndex = String(baseZIndex(doc, outerEl) + 1);
      bar.append(button("Region", onAreaRegion), button("Image region", onImageRegion));
      doc.body.append(bar);
      place();
      view2?.addEventListener("resize", place);
    },
    hide,
    dispose: hide
  };
}

// src/view/regionref.js
var CLAIMED = "data-plexus-claimed";
var FAIL_TTL_MS = 6e4;
var PRUNE_FLOOR = 64;
var IMAGE_SETTLE_MS = 1200;
var PLAIN_SETTLE_MS = 150;
function createRegionRefRenderer({ host, cache, cold, getSettings, onOpen, doc }) {
  const roots = /* @__PURE__ */ new Map();
  const failed = /* @__PURE__ */ new Map();
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
  const paint = (root, entry, key) => {
    if (!root.isConnected) return;
    const img = doc.createElement("img");
    img.className = "plexus-crop";
    img.draggable = false;
    img.onerror = () => {
      if (key) Promise.resolve(cache.delete?.(key)).catch(() => {
      });
      if (root.isConnected) finishChip(root);
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
      const drawing = host.drawing(region.drawingUid);
      if (!drawing) return chip(root, "Drawing not found");
      const sceneBox = regionSceneBBox(region, drawing.elements);
      if (sceneBox.error) return chip(root, `Region unavailable (${sceneBox.error})`);
      const gk = geometryKey(region);
      const svgKey = cropKey({ regionUid: uid, geometryKey: gk, drawingHash: drawing.hash, tier: "svg" });
      const pngKey = cropKey({ regionUid: uid, geometryKey: gk, drawingHash: drawing.hash, tier: "png" });
      const hotSvg = cache.peek(svgKey);
      const hot = hotSvg || cache.peek(pngKey);
      if (hot) return paint(root, hot, hotSvg ? svgKey : pngKey);
      const [x1, y1, x2, y2] = sceneBox.bbox;
      const bw = Math.max(1, x2 - x1);
      const bh = Math.max(1, y2 - y1);
      const maxH = getSettings().maxCropHeight;
      const h = Math.min(maxH, bh);
      root.className = "plexus-root plexus-regionref plexus-placeholder";
      root.style.height = `${h}px`;
      root.style.width = `${Math.round(h * bw / bh)}px`;
      void (async () => {
        try {
          let entry = null;
          let entryKey = svgKey;
          entry = await cache.get(svgKey);
          if (!entry) {
            entryKey = pngKey;
            entry = await cache.get(pngKey);
          }
          if (!entry) {
            const failKey = `${region.drawingUid}|${drawing.hash}`;
            const failedAt = failed.get(failKey);
            if (failedAt != null && Date.now() - failedAt < FAIL_TTL_MS) return finishChip(root);
            if (!root.isConnected) return;
            const hasImage = drawing.elements.some((el) => !el.isDeleted && (el.type === "image" || el.fileId));
            const rendered = await cold.renderDrawing(region.drawingUid, { settleMs: hasImage ? IMAGE_SETTLE_MS : PLAIN_SETTLE_MS });
            if (!root.isConnected) return;
            const crop = rendered ? viewPngCropRect({
              elements: drawing.elements,
              bbox: sceneBox.bbox,
              naturalWidth: rendered.naturalWidth,
              naturalHeight: rendered.naturalHeight
            }) : { error: "no-render" };
            if (crop.error) {
              failed.set(failKey, Date.now());
              return finishChip(root);
            }
            entryKey = pngKey;
            const blob = await cropCanvasToBlob(rendered.canvas, crop, { doc });
            await cache.put(pngKey, blob, { w: crop.sw, h: crop.sh, persist: rendered.settled !== false });
            entry = cache.peek(pngKey) || await cache.get(pngKey);
          }
          if (!root.isConnected) return;
          if (!entry) return finishChip(root);
          root.style.height = "";
          root.style.width = "";
          paint(root, entry, entryKey);
        } catch (error) {
          console.warn("[plexus] crop failed", error);
          finishChip(root);
        }
      })();
    } catch (error) {
      console.warn("[plexus] claim failed", error);
    }
  };
  function finishChip(root) {
    root.style.height = "";
    root.style.width = "";
    chip(root, "Open the drawing to render this region");
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
    }
  };
}

// src/view/discover.js
var SKIP_SELECTOR = ".plexus-offscreen, .plexus-root";
var EDITOR_OUTER = ".excalidraw-outer-container.full-screen";
function skipped(node) {
  return !!node.closest?.(SKIP_SELECTOR);
}
function underFullScreen(el) {
  return !!el.closest?.(EDITOR_OUTER);
}
function classifyAddedNode(node) {
  const out = { regionButtons: [], editors: [] };
  if (!node || node.nodeType !== 1 || skipped(node)) return out;
  if (node.classList?.contains(REGION_BUTTON_CLASS)) out.regionButtons.push(node);
  const buttons = node.getElementsByClassName?.(REGION_BUTTON_CLASS);
  if (buttons) for (let i = 0; i < buttons.length; i++) out.regionButtons.push(buttons[i]);
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
function createDiscovery({ root, onRegionButton, onEditorMount, onEditorUnmount, MutationObserverImpl = globalThis.MutationObserver }) {
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
  const handle = ({ regionButtons, editors }) => {
    for (const btn of regionButtons) safe(onRegionButton, btn);
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
        const editors = Array.from(root.querySelectorAll(`${EDITOR_OUTER} .excalidraw`)).filter((el) => !skipped(el));
        handle({ regionButtons, editors });
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
function showSpotlight({ rect, doc, durationMs = 1400 }) {
  const el = doc.createElement("div");
  el.className = "plexus-portal plexus-spotlight";
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

// src/model/caption.js
var MAX_CAPTION = 200;
function cleanText(text) {
  return String(text ?? "").replace(/[{}`]/g, "").replace(/\s+/g, " ").trim();
}
function captionFromElements(elements, ids) {
  if (!Array.isArray(elements) || !ids) return "";
  const wanted = new Set(Array.isArray(ids) ? ids : [...ids]);
  const parts = [];
  for (const el of elements) {
    if (!el || el.isDeleted || el.type !== "text") continue;
    if (!wanted.has(el.id) && !(el.containerId && wanted.has(el.containerId))) continue;
    const text = cleanText(el.originalText ?? el.text);
    if (text) parts.push(text);
  }
  return parts.join(" ; ").slice(0, MAX_CAPTION).trim();
}

// src/view/image-region-tool.js
function startImageRegionTool({ app, element, doc }) {
  let cancel = null;
  const promise = new Promise((resolve) => {
    if (element?.angle) return resolve(null);
    const imageRect = viewportRectOf(app, elementBounds(element));
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
    doc.body.append(overlay);
    let start = null;
    let drag = null;
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      doc.removeEventListener("keydown", onKey, true);
      doc.removeEventListener("pointerdown", onOutside, true);
      overlay.remove();
      resolve(value);
    };
    cancel = () => finish(null);
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      finish(null);
    };
    const onOutside = (e) => {
      if (!overlay.contains(e.target)) finish(null);
    };
    const rectFrom = (a, b) => ({
      left: Math.min(a.x, b.x),
      top: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y)
    });
    overlay.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      start = { x: e.clientX, y: e.clientY };
      drag = rectFrom(start, start);
      overlay.setPointerCapture?.(e.pointerId);
    });
    overlay.addEventListener("pointermove", (e) => {
      e.stopPropagation();
      if (!start) return;
      drag = rectFrom(start, { x: e.clientX, y: e.clientY });
      marquee.hidden = false;
      marquee.style.left = `${drag.left - imageRect.left}px`;
      marquee.style.top = `${drag.top - imageRect.top}px`;
      marquee.style.width = `${drag.width}px`;
      marquee.style.height = `${drag.height}px`;
    });
    overlay.addEventListener("pointerup", (e) => {
      e.stopPropagation();
      if (!start) return;
      finish(rectToFraction(drag, imageRect));
    });
    const reset = () => {
      start = null;
      drag = null;
      marquee.hidden = true;
    };
    overlay.addEventListener("pointercancel", reset);
    overlay.addEventListener("lostpointercapture", (e) => {
      if (start && e.buttons === 0 && !finished) reset();
    });
    for (const type of ["click", "mousedown", "mouseup"]) overlay.addEventListener(type, (e) => e.stopPropagation());
    doc.addEventListener("keydown", onKey, true);
    doc.addEventListener("pointerdown", onOutside, true);
  });
  promise.cancel = () => cancel?.();
  return promise;
}

// src/actions.js
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
function createActions({ host, native, cache, cold, toaster, spotlight, getSettings, doc, clipboard }) {
  let disposed = false;
  let activeTool = null;
  let stopSpotlight = null;
  const busy = /* @__PURE__ */ new Set();
  const aborted = () => disposed;
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
    let uid;
    try {
      uid = await host.createRegion(region.drawingUid, serializeRegion(region));
    } catch (error) {
      console.warn("[plexus] create region failed", error);
      toaster.show("Could not create region, try again", { kind: "error" });
      return null;
    }
    try {
      await putSvg(uid, region, svg);
    } catch (error) {
      console.warn("[plexus] cache put failed", error);
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
      const caption = captionFromElements(sceneElements(app), ids) || "Region";
      const region = { kind: "area", drawingUid, ids, pad: DEFAULT_PAD, caption };
      const svg = await captureSafe(app, ids);
      return finishCreate(region, svg);
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
      const tool = startImageRegionTool({ app, element, doc });
      activeTool = tool;
      let f;
      try {
        f = await tool;
      } finally {
        if (activeTool === tool) activeTool = null;
      }
      if (!f || disposed) return null;
      const region = { kind: "rect", drawingUid, el: element.id, f, caption: "Image region" };
      let svg = await captureSafe(app, [element.id]);
      if (svg) {
        try {
          svg = cropSvgToFraction(svg, f);
        } catch (error) {
          console.warn("[plexus] svg crop failed", error);
          svg = null;
        }
      }
      return finishCreate(region, svg);
    }),
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
          const ids = region.kind === "area" ? region.ids : [region.el];
          let svg = await native.captureSelectionSvg(editor.app, ids, { clipboard });
          if (region.kind === "rect") svg = cropSvgToFraction(svg, region.f);
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
      await cache.clear();
      toaster.show("Crop cache cleared");
    }
  };
  async function openRegionOnce(regionUid, { sidebar = false } = {}) {
    const block = host.pullBlock(regionUid);
    const region = block ? parseRegion(block.string) : null;
    if (!region || !region.supported) {
      toaster.show("Region cannot be opened", { kind: "error" });
      return null;
    }
    const uid = region.drawingUid;
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
    const box = regionSceneBBox(region, sceneElements(app));
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

// src/extension.js
var activeLifecycle = null;
function versionFlagTarget() {
  return globalThis.window ?? globalThis;
}
async function onload({ extensionAPI, extension }) {
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
    await lifecycle.settingsPanel(extensionAPI, createSettingsPanel());
    const getSettings = () => readSettings(extensionAPI);
    let actions = null;
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
      const toolbar = createEditorToolbar({
        doc,
        onAreaRegion: () => actions.createAreaRegion(),
        onImageRegion: () => actions.createImageRegion()
      });
      lifecycle.add(() => toolbar.dispose());
      actions = createActions({
        host,
        native: native_exports,
        cache,
        cold,
        toaster,
        spotlight: showSpotlight,
        getSettings,
        doc,
        clipboard: globalThis.navigator?.clipboard
      });
      lifecycle.add(() => actions.dispose());
      const regionref = createRegionRefRenderer({
        host,
        cache,
        cold,
        getSettings,
        doc,
        onOpen: (uid, opts) => actions.openRegion(uid, opts).catch((error) => console.warn("[plexus] open failed", error))
      });
      lifecycle.add(() => regionref.releaseAll());
      const discovery = createDiscovery({
        root: doc.body,
        onRegionButton: (btn) => regionref.claim(btn),
        onEditorMount: (el) => {
          const outer = el.closest(".excalidraw-outer-container");
          if (outer) toolbar.show(outer);
        },
        onEditorUnmount: () => toolbar.hide()
      });
      lifecycle.add(() => discovery.dispose());
      discovery.scanExisting();
    }
    const run = (name) => () => {
      if (!actions) return console.warn("[plexus] unavailable outside Roam:", name);
      return actions[name]().catch((error) => console.warn("[plexus]", name, "failed", error));
    };
    const commands = [
      ["Plexus: Create region from selection", "createAreaRegion"],
      ["Plexus: Create image region", "createImageRegion"],
      ["Plexus: Refresh crops for open drawing", "refreshCropsForOpenDrawing"],
      ["Plexus: Clear crop cache", "clearCache"]
    ];
    for (const [label, name] of commands) {
      await lifecycle.command(extensionAPI.ui.commandPalette, { label, callback: run(name) });
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
