/* Plexus v0.4.0 | MIT | generated; edit src/ */
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
    if (!args.has("ids")) return fail("missing ids");
    const ids = args.get("ids").split(",");
    if (!ids.length || ids.some((id) => !ID_RE.test(id))) return fail("bad ids");
    const pad = parsePad();
    if (pad === null) return fail("bad pad");
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
  if (err) return fail(err);
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
  } else if (kind === "group" || kind === "frame" || kind === "cframe") {
    const isGroup = kind === "group";
    const id = isGroup ? region.groupId ?? region.g : region.frameId ?? region.fr;
    need(typeof id === "string" && ID_RE.test(id), isGroup ? "bad groupId" : "bad frameId");
    tokens.push(`${isGroup ? "g" : "fr"}=${id}`);
    if (kind !== "cframe") {
      const pad = region.pad ?? DEFAULT_PAD;
      need(Number.isInteger(pad) && pad >= 0 && pad <= 200, "bad pad");
      tokens.push(`pad=${pad}`);
    }
  } else if (kind === "poly" || kind === "imgrect" || kind === "imgpoly") {
    if (kind === "poly") {
      need(typeof region.el === "string" && ID_RE.test(region.el), "bad el");
      tokens.push(`el=${region.el}`);
    } else {
      need(Number.isInteger(region.i) && region.i >= 0, "bad i");
      tokens.push(`i=${region.i}`);
    }
    if (kind === "imgrect") {
      const f = normalizeFrac(region.f);
      need(f, "bad f");
      tokens.push(`f=${f.join(",")}`);
    } else {
      const p = normalizePoly(region.p);
      need(p, "bad p");
      tokens.push(`p=${p.join(",")}`);
    }
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
  for (let guard = 0; guard < 60; guard++) {
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
  const open = /<svg\b[^>]*>/.exec(svgString);
  const closeIdx = svgString.lastIndexOf("</svg>");
  if (!open || closeIdx < open.index + open[0].length) throw new TypeError("clipSvgToPolygon: no <svg> root");
  const tag = open[0];
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
  const head = svgString.slice(0, open.index + tag.length);
  const body = svgString.slice(open.index + tag.length, closeIdx);
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
function regionSceneBBox(region, elements, appState) {
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
  if (region.kind === "rect" || region.kind === "poly") {
    const el = live.find((e) => e.id === region.el);
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
    const members = live.filter((el) => Array.isArray(el.groupIds) && el.groupIds.includes(g));
    if (!members.length) return { error: "no-elements" };
    const b = commonBounds(members);
    const pad = region.pad ?? 10;
    return { bbox: [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad], missing: [] };
  }
  if (region.kind === "frame" || region.kind === "cframe") {
    const id = region.frameId ?? region.fr;
    const frame = live.find((el) => el.id === id);
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
  const memo2 = /* @__PURE__ */ new Map();
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
    const cached = memo2.get(uid);
    if (cached && cached.editTime === block.editTime) {
      memo2.delete(uid);
      memo2.set(uid, cached);
      return cached.value;
    }
    const parsed = block.props ? parseProps(block.props) : null;
    const value = parsed ? { ...parsed, uid, editTime: block.editTime, hash: hashFn(parsed.elementsJson ?? "") } : null;
    memo2.delete(uid);
    memo2.set(uid, { editTime: block.editTime, value });
    while (memo2.size > DRAWING_MEMO_CAP) memo2.delete(memo2.keys().next().value);
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
    const uid = api.util.generateUID();
    try {
      await api.data.page.create({ page: { title, uid } });
    } catch (error) {
      const found = pageUidByTitle(title);
      if (found) return found;
      throw error;
    }
    return pageUidByTitle(title) || uid;
  }
  async function createDrawing({ pageUid, parentUid, title } = {}) {
    let page = pageUid;
    let parent = parentUid || pageUid;
    if (title) {
      page = await ensurePage(`Drawings/${title}`);
      parent = page;
    }
    if (!parent) throw new Error("[plexus] createDrawing needs pageUid, parentUid, or title");
    const uid = api.util.generateUID();
    await api.data.block.create({
      location: { "parent-uid": parent, order: "last" },
      block: { uid, string: DRAWING_STRING }
    });
    return { uid, pageUid: page || null };
  }
  const DRAWINGS_QUERY = `[:find ?u ?s ?o :in $ ?pu :where [?p :block/uid ?pu] [?b :block/page ?p] [?b :block/uid ?u] [?b :block/string ?s] [?b :block/order ?o] (or [(clojure.string/starts-with? ?s "{{[[excalidraw]]}}")] [(clojure.string/starts-with? ?s "{{excalidraw}}")])]`;
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
    ensureRegionContainer,
    createRegion,
    createDrawing,
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
  captureSelectionSvg: () => captureSelectionSvg,
  findApp: () => findApp,
  insertElements: () => insertElements,
  looksLikeSvg: () => looksLikeSvg,
  readClipboardText: () => readClipboardText,
  selectedElementIds: () => selectedElementIds,
  subscribeViewport: () => subscribeViewport,
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
function createEditorToolbar({ doc, onAreaRegion, onImageRegion, onFrameRegion, canFrame, onCropRegion, canCrop, onEmbed, onPresent, canPresent, onMindMap }) {
  const view2 = doc.defaultView;
  let bar = null;
  let outer = null;
  let gated = [];
  let refreshTimer = null;
  const refresh = () => {
    refreshTimer = null;
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
    bar.style.left = `${rect.left + rect.width / 2}px`;
    const height = bar.getBoundingClientRect().height || 40;
    bar.style.top = `${rect.bottom - 16 - height}px`;
  };
  const button = (label, handler) => {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "plexus-toolbar-button";
    b.textContent = label;
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
      const presentButton = button("Present", onPresent);
      gated = [[frameButton, canFrame], [cropButton, canCrop], [presentButton, canPresent]];
      const controls = [button("Region", onAreaRegion), button("Image region", onImageRegion), frameButton, cropButton, button("Embed block", onEmbed), presentButton];
      if (onMindMap) controls.push(button("Mind map", onMindMap));
      bar.append(...controls);
      doc.body.append(bar);
      refresh();
      outerEl.addEventListener?.("pointerup", scheduleRefresh, true);
      outerEl.addEventListener?.("keyup", scheduleRefresh, true);
      place();
      view2?.addEventListener("resize", place);
    },
    refresh: scheduleRefresh,
    hide,
    dispose: hide
  };
}

// src/model/embeds.js
var REF_RE = /^\(\(([A-Za-z0-9_-]{9})\)\)$/;
var PAGE_RE = /^\[\[([^\]]+)\]\]$/;
var UID_RE = /^[A-Za-z0-9_-]{9}$/;
function parseEmbedRef(text) {
  if (typeof text !== "string") return null;
  const t = text.trim();
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
function makeEmbedAnchor({ ref, label = "", x = 0, y = 0, width = 360, height = 200, idPrefix: idPrefix2 = "plexus-embed-" } = {}) {
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
    link: ref,
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
var CHILD_DEPTH = 2;
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
  subscribe: subscribe2 = subscribeViewport
}) {
  const view2 = doc.defaultView;
  const portals = /* @__PURE__ */ new Map();
  const watches = /* @__PURE__ */ new Map();
  const dirty = /* @__PURE__ */ new Set();
  let raf = null;
  let disposed = false;
  let unsubscribe2 = null;
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
  const paint = (portal, content) => {
    unmountHosts(portal);
    portal.body.textContent = "";
    portal.title.textContent = content ? (content.kind === "page" ? content.title : content.pageTitle) || "" : "Block not found";
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
  const load = async (portal) => {
    const gen = ++portal.gen;
    let content = null;
    try {
      content = await host.pullEmbedContent(portal.ref);
    } catch (error) {
      console.warn("[plexus] embed pull failed", error);
    }
    if (disposed || portal.dead || gen !== portal.gen) return;
    paint(portal, content);
    const uid = content?.uid ?? parseEmbedRef(portal.ref)?.uid;
    if (uid) watchUid(portal, uid);
  };
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
    const portal = { root, title, body, hosts: /* @__PURE__ */ new Set(), ref: el.customData.plexus.embed, uid: null, gen: 0, dead: false, theme: null };
    applyTheme(portal);
    portals.set(el.id, portal);
    void load(portal);
    return portal;
  };
  const remove = (id) => {
    const portal = portals.get(id);
    if (!portal) return;
    portals.delete(id);
    portal.dead = true;
    dirty.delete(portal);
    releaseWatch(portal);
    unmountHosts(portal);
    portal.root.remove();
  };
  let lastNonce;
  const sync = () => {
    const nonce = app.scene?.getSceneNonce?.();
    if (!portals.size && nonce !== void 0 && nonce === lastNonce) return;
    lastNonce = nonce;
    const anchors = embedAnchors(app.getSceneElementsIncludingDeleted?.() ?? app.getSceneElements?.() ?? []);
    const ids = new Set(anchors.map((el) => el.id));
    for (const id of [...portals.keys()]) if (!ids.has(id)) remove(id);
    if (!anchors.length) return;
    const containerRect = containerEl.getBoundingClientRect();
    for (const el of anchors) {
      let portal = portals.get(el.id);
      const ref = el.customData.plexus.embed;
      if (portal && portal.ref !== ref) {
        portal.ref = ref;
        releaseWatch(portal);
        void load(portal);
      }
      if (!portal) portal = create(el);
      const place = embedPlacement(el, app.state, containerRect);
      const s = portal.root.style;
      s.width = `${place.width}px`;
      s.height = `${place.height}px`;
      s.transform = place.transform;
      s.clipPath = place.clip || "";
      s.display = place.hidden ? "none" : "";
      applyTheme(portal);
    }
  };
  function schedule() {
    if (disposed || raf != null) return;
    raf = requestFrame(() => {
      raf = null;
      if (disposed) return;
      try {
        for (const portal of [...dirty]) {
          dirty.delete(portal);
          if (!portal.dead) void load(portal);
        }
        sync();
      } catch (error) {
        console.warn("[plexus] embed reposition failed", error);
      }
    });
  }
  unsubscribe2 = subscribe2(app, schedule);
  schedule();
  return {
    portalCount: () => portals.size,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (raf != null) cancelFrame(raf);
      raf = null;
      try {
        unsubscribe2?.();
      } catch (error) {
        console.warn("[plexus] unsubscribe failed", error);
      }
      unsubscribe2 = null;
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
    }
  };
}

// src/view/present.js
var NEXT_KEYS = /* @__PURE__ */ new Set(["ArrowRight", "PageDown", " ", "Spacebar", "Enter"]);
var PREV_KEYS = /* @__PURE__ */ new Set(["ArrowLeft", "PageUp", "Backspace"]);
function createPresenter({ doc }) {
  let current = null;
  const close2 = () => {
    const state = current;
    if (!state) return;
    current = null;
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
    isOpen: () => !!current,
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
      current = { dialog, preload, onKey, onKeyUp, onClick, onCancel, onClosed, onClose };
      doc.body.append(dialog);
      show();
      dialog.showModal();
      dialog.focus?.();
      const state = current;
      return {
        setSlide(i, patch) {
          if (current !== state || !list[i]) return;
          Object.assign(list[i], patch);
          if (i === at || i === at + 1) show();
        },
        isOpen: () => current === state,
        close: () => {
          if (current === state) close2();
        }
      };
    }
  };
}

// src/view/regionref.js
var CLAIMED = "data-plexus-claimed";
var FAIL_TTL_MS = 6e4;
var PRUNE_FLOOR = 64;
var IMAGE_SETTLE_MS = 1200;
var PLAIN_SETTLE_MS = 150;
var IMAGE_KINDS = /* @__PURE__ */ new Set(["imgrect", "imgpoly"]);
var isImageKind = (kind) => IMAGE_KINDS.has(kind);
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
async function renderRegionCrop({ region, target, cold, doc, api, settleMs, loadBitmap = loadImageBitmap }) {
  if (isImageKind(region.kind)) {
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
function createRegionRefRenderer({ host, cache, cold, getSettings, onOpen, doc, api = globalThis.roamAlphaAPI, loadBitmap = loadImageBitmap }) {
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
  const paint = (root, entry, key, region) => {
    if (!root.isConnected) return;
    const img = doc.createElement("img");
    img.className = "plexus-crop";
    img.draggable = false;
    img.onerror = () => {
      if (key) Promise.resolve(cache.delete?.(key)).catch(() => {
      });
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
      root.style.width = `${Math.round(h * bw / bh)}px`;
      void (async () => {
        try {
          let entry = null;
          let entryKey = svgKey || pngKey;
          if (svgKey) entry = await cache.get(svgKey);
          if (!entry) {
            entryKey = pngKey;
            entry = await cache.get(pngKey);
          }
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
            await cache.put(pngKey, rendered.blob, { w: rendered.w, h: rendered.h, persist: rendered.settled !== false });
            entry = cache.peek(pngKey) || await cache.get(pngKey);
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
  const sidebarWindow = (target) => target.type === "page" ? { type: "outline", "block-uid": target.uid ?? pageUidOf(target.title) } : { type: "block", "block-uid": target.uid };
  function navigate(target, sidebar, window) {
    if (sidebar) {
      api.ui.rightSidebar.addWindow({ window });
      return;
    }
    containerEl.closest?.(".excalidraw-outer-container")?.querySelector?.(".bp3-icon-minimize")?.click?.();
    if (target.type === "page") {
      const uid = target.uid ?? pageUidOf(target.title);
      if (uid) api.ui.mainWindow.openPage({ page: { uid } });
      else api.ui.mainWindow.openPage({ page: { title: target.title } });
    } else api.ui.mainWindow.openBlock({ block: { uid: target.uid } });
    clearLinkTooltip(containerEl.ownerDocument);
  }
  function pageUidOf(title) {
    return api.data.pull("[:block/uid]", [":node/title", title])?.[":block/uid"] || null;
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
      const window = sidebar ? sidebarWindow(target) : null;
      if (sidebar && !window["block-uid"]) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      navigate(target, sidebar, window);
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

// src/api.js
var API_VERSION = 1;
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
function createPublicApi({ host, actions, emitter, version } = {}) {
  const listeners = /* @__PURE__ */ new Map();
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
      return host.regionsOf(uid).map(({ uid: regionUid, region }) => ({ uid: regionUid, kind: region.kind, caption: region.caption ?? "" }));
    },
    drawingsOn(pageUid) {
      return host.drawingsOn(pageUid);
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
    const open = pick2(p, "open") !== false;
    const raw = pick2(p, "children");
    const kids2 = Array.isArray(raw) ? raw.slice() : [];
    kids2.sort((a, b) => (pick2(a, "order") ?? 0) - (pick2(b, "order") ?? 0));
    const node = { uid, string: str, open, children: [] };
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
function wrapLines2(text, maxWidth, measure) {
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
      if (measure(cand) <= maxWidth) {
        line = cand;
        continue;
      }
      if (line !== "") flush();
      if (measure(word) <= maxWidth) {
        line = word;
        continue;
      }
      let chunk = "";
      for (const ch of Array.from(word)) {
        if (chunk !== "" && measure(chunk + ch) > maxWidth) {
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
function nodeSize(text, fontSize, measure) {
  const m = (s) => measure(s, fontSize);
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
function bump(el, patch) {
  return { ...el, ...patch, version: (el.version || 0) + 1, versionNonce: rnd2(), updated: Date.now() };
}
function patchMarker(el, mmPatch) {
  const next = { ...mmOf(el) || {}, ...mmPatch };
  for (const k of Object.keys(next)) if (next[k] === void 0) delete next[k];
  return bump(el, { customData: withMM(el.customData, next) });
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
var makeSizer = (measure) => (text, fontSize) => nodeSize(text, fontSize, measure);
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
    if (rem.has(el.id)) return bump(el, { isDeleted: true });
    const p = upd.get(el.id);
    return p ? bump(el, p) : el;
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
function createMindMap({ doc, api = globalThis.roamAlphaAPI, writer, measurer, native, toaster, raf = defaultRaf, caf = defaultCaf, now = () => Date.now(), zIndexFor = () => 1e3 }) {
  const sessions = /* @__PURE__ */ new Map();
  let disposed = false;
  const warn = (what, error) => console.warn(`[plexus] mind map ${what} failed`, error);
  const toast = (message, opts) => {
    try {
      toaster.show(message, opts);
    } catch (error) {
      warn("toast", error);
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
  function mount({ app, containerEl, outerEl, zIndex } = {}) {
    if (disposed || !app || !containerEl) return () => {
    };
    const s = createSession({ app, containerEl, outerEl, zIndex });
    sessions.set(app, s);
    return () => {
      s.dispose();
      if (sessions.get(app) === s) sessions.delete(app);
    };
  }
  function createSession({ app, containerEl, outerEl, zIndex }) {
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
    const els = () => app.getSceneElementsIncludingDeleted?.() ?? [];
    const guard = () => alive && !disposed && native.activeEditor(doc)?.app === app;
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
    function commit(mutate, roots) {
      if (!guard()) return false;
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
      app.updateScene({ elements: next, captureUpdate: "NEVER" });
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
          }).catch((error) => warn("fonts", error));
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
    function detach(root) {
      const ids = new Set(projectionIds(els(), root));
      watches.get(root)?.();
      watches.delete(root);
      trees.delete(root);
      rootPos.delete(root);
      lastRoot.delete(root);
      fontSig.delete(root);
      pendingRefresh.delete(root);
      if (ids.size && guard()) {
        app.updateScene({ elements: els().map((el) => ids.has(el.id) ? bump(el, { isDeleted: true }) : el), captureUpdate: "NEVER" });
        takeSnapshot();
      }
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
        return;
      }
      trees.set(root, buildTree(root, raw));
      commit(null, [root]);
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
        warn("pull", error);
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
      scheduled = raf(pass);
    }
    function onPointerUp() {
      dirty = true;
      onChange();
    }
    function pass() {
      scheduled = null;
      if (!alive) return;
      const st = state();
      const editingId = st.editingTextElement?.id ?? null;
      if (prevEditingId && !editingId) pendingFinished.add(prevEditingId);
      prevEditingId = editingId;
      const nonce = app.scene?.getSceneNonce?.();
      if (!pendingFinished.size && !pendingRefresh.size && !dirty && nonce !== void 0 && nonce === lastNonce) {
        if (input) placeInput();
        return;
      }
      if (gestureActive()) {
        dirty = true;
        if (input) placeInput();
        return;
      }
      dirty = false;
      lastNonce = nonce;
      const finishedIds = [...pendingFinished];
      pendingFinished.clear();
      const refreshRoots = [...pendingRefresh];
      pendingRefresh.clear();
      try {
        for (const id of finishedIds) nativeTextEdit(id);
        nativeChanges();
      } catch (error) {
        warn("change pass", error);
      }
      for (const root of refreshRoots) if (trees.has(root)) refreshRoot(root);
      if (input) placeInput();
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
        warn("write", error);
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
        warn("create", error);
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
        warn("discard", error);
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
      const swallow = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      if (e.metaKey || e.ctrlKey) {
        if (e.altKey) return;
        if (e.key in ARROWS) {
          swallow();
          toast(GROW_HINT);
        } else if (e.code === "KeyZ") {
          swallow();
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
        swallow();
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
      swallow();
      if (e.repeat && !repeatSafe) return;
      if (e.altKey && e.key !== "Backspace") pendingDelete = null;
      else if (!(e.key === "Backspace")) pendingDelete = null;
      if (st.viewModeEnabled) return;
      try {
        const out = action();
        if (out && typeof out.catch === "function") out.catch((error) => {
          warn("hotkey", error);
          failToast();
        });
      } catch (error) {
        warn("hotkey", error);
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
      const open = node.open === false;
      node.open = open;
      commit(null, [sel.root]);
      return writer.setOpen(sel.root, sel.uid, open).catch((error) => {
        warn("fold", error);
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
        detach(sel.root);
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
      refreshRoot(sel.root);
    }
    function startRoot({ drawingUid }) {
      const root = api.util.generateUID();
      const st = state();
      const zoom = st.zoom?.value || 1;
      const cx = (st.width || 0) / (2 * zoom) - (st.scrollX || 0);
      const cy = (st.height || 0) / (2 * zoom) - (st.scrollY || 0);
      rootPos.set(root, { x: cx - 70, y: cy - 24 });
      trees.set(root, { uid: root, string: PLACEHOLDER_ROOT, open: true, children: [] });
      const job = writer.createChild(root, drawingUid, { uid: root, string: PLACEHOLDER_ROOT, unfold: false });
      ensureRoot(root);
      commit(null, [root]);
      select(root, root);
      openInput({ root, uid: root, base: PLACEHOLDER_ROOT, placeholder: PLACEHOLDER_ROOT });
      Promise.resolve(job).catch((error) => {
        warn("start", error);
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
        warn("subscribe", error);
      }
    }
    try {
      const off = app.onPointerUpEmitter?.on?.(onPointerUp);
      if (typeof off === "function") offs.push(off);
    } catch (error) {
      warn("subscribe", error);
    }
    start();
    return {
      app,
      selectedNode,
      startRoot,
      showOutline,
      dispose() {
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
            warn("cleanup", error);
          }
        }
        for (const off of watches.values()) {
          try {
            off();
          } catch (error) {
            warn("cleanup", error);
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
  function setOpen(rootUid, uid, open) {
    return run(rootUid, async () => {
      await api.data.block.update({ block: { uid, open: !!open } });
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

// src/host/measure.js
var MEMO_CAP = 2e3;
var fontString = (size) => `${size}px Excalifont, Xiaolai, sans-serif, Segoe UI Emoji`;
function createMeasurer({ doc = globalThis.document } = {}) {
  const memo2 = /* @__PURE__ */ new Map();
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
  function measure(text, fontSize) {
    const str = String(text ?? "");
    const font = fontString(fontSize);
    const key = `${font}|${str}`;
    if (memo2.has(key)) {
      const hit = memo2.get(key);
      memo2.delete(key);
      memo2.set(key, hit);
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
    memo2.set(key, width);
    if (memo2.size > MEMO_CAP) memo2.delete(memo2.keys().next().value);
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
        memo2.clear();
        return true;
      }
    } catch (error) {
      console.warn("[plexus] font load failed", error);
    }
    return false;
  }
  return { measure, ensureFonts, clear: () => memo2.clear(), size: () => memo2.size };
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
var LASSO_STEP_PX = 4;
var SVG_NS = "http://www.w3.org/2000/svg";
function startImageRegionTool({ app, element, doc, imageRect: fixedRect }) {
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
      const svg = doc.createElementNS(SVG_NS, "svg");
      svg.setAttribute("class", "plexus-lasso");
      lassoPath = doc.createElementNS(SVG_NS, "path");
      svg.append(lassoPath);
      overlay.append(svg);
    }
    doc.body.append(overlay);
    let lasso = null;
    let start = null;
    let drag = null;
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      doc.removeEventListener("keydown", onKey, true);
      doc.removeEventListener("pointerdown", onOutside, true);
      doc.removeEventListener("wheel", cancelOnMove, true);
      doc.removeEventListener("scroll", cancelOnMove, true);
      doc.defaultView?.removeEventListener?.("resize", cancelOnMove);
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
      start = { x: e.clientX, y: e.clientY };
      drag = rectFrom(start, start);
      lasso = e.altKey ? [start] : null;
      overlay.setPointerCapture?.(e.pointerId);
    });
    overlay.addEventListener("pointermove", (e) => {
      e.stopPropagation();
      if (!start) return;
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
    overlay.addEventListener("pointerup", (e) => {
      e.stopPropagation();
      if (!start) return;
      finish(lasso ? lassoToFraction(lasso, imageRect) : rectToFraction(drag, imageRect));
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
  mindmap = null
}) {
  let disposed = false;
  let activeTool = null;
  let activeToolIsDrawing = false;
  let stopSpotlight = null;
  const busy = /* @__PURE__ */ new Set();
  let presentOwner = null;
  const thumbPending = /* @__PURE__ */ new Map();
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
  const croppedImage = (app) => {
    const ids = native.selectedElementIds(app);
    if (ids.length !== 1) return null;
    const el = sceneElements(app).find((e) => e.id === ids[0] && !e.isDeleted);
    return el && el.type === "image" && validCrop2(el.crop) ? el : null;
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
    }
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
        pngKey: cropKey({ regionUid: `slide:${uid}:${frame.id}`, geometryKey: gk, drawingHash: slideHash, tier: "png" })
      };
    });
    for (const slide of slides) {
      const entry = (mounted ? cache.peek?.(slide.svgKey) : null) || cache.peek?.(slide.pngKey) || cache.peek?.(slide.svgKey);
      slide.url = entry?.url ?? null;
    }
    const handle = presenter.open({ slides: slides.map(({ name, url }) => ({ name, url })), index: 0, onClose: release });
    const missing = slides.map((s, i) => [s, i]).filter(([s]) => !s.url);
    if (!missing.length) return uid;
    const fail = (i) => {
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
            for (const [, i] of missing) fail(i);
            toaster.show("Could not render this drawing", { kind: "error" });
          }
          return uid;
        }
        for (const [slide, i] of missing) {
          if (disposed || !handle.isOpen()) break;
          const box = regionSceneBBox(slide.region, drawing.elements, drawing.appState);
          if (box.error) {
            fail(i);
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
            fail(i);
            continue;
          }
          const blob = await cropCanvasToBlob(rendered.canvas, crop, { doc });
          await cache.put(slide.pngKey, blob, { w: crop.sw, h: crop.sh, persist: rendered.settled !== false });
          fill(i, cache.peek?.(slide.pngKey) || await cache.get(slide.pngKey));
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
      const at = api.data.pull("[:block/order {:block/parent [:block/uid]}]", [":block/uid", blockUid]);
      const parent = at?.[":block/parent"]?.[":block/uid"];
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
  async function openDrawingOnce(uid) {
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
    try {
      await host.openBlock(uid, {});
    } catch (error) {
      console.warn("[plexus] open block failed", error);
      toaster.show("Could not open drawing", { kind: "error" });
      return null;
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

// src/extension.js
var activeLifecycle = null;
var THUMB_WIDTHS = [160, 480];
var THUMB_WARM_DELAY_MS = 1500;
var CONTEXT_MENU_LABEL = "Plexus: Region on image";
var MINDMAP_MENU_LABEL = "Plexus: Mind map from outline";
var PRESENT_MENU_LABEL = "Plexus: Present frames";
var DRAWING_START2 = /^\s*\{\{(?:\[\[excalidraw\]\]|excalidraw)\}\}/;
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
        onPresent: () => actions.presentDrawing(),
        canPresent: () => actions.hasFrames(),
        onMindMap: () => actions.startMindMap().catch((error) => console.warn("[plexus] mind map failed", error))
      });
      lifecycle.add(() => toolbar.dispose());
      const presenter = createPresenter({ doc });
      lifecycle.add(() => presenter.dispose());
      const mmWriter = createMmWriter({ api, graph: host.graphName() });
      const measurer = createMeasurer({ doc });
      const mindmap = createMindMap({ doc, api, writer: mmWriter, measurer, native: native_exports, toaster, zIndexFor: (outer) => outer ? baseZIndex(doc, outer) : 1e3 });
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
        presenter,
        mindmap
      });
      lifecycle.add(() => actions.dispose());
      const publicApi = createPublicApi({ host, actions, emitter, version: extension?.version || "development" });
      installPublicApi(publicApi, { win: flagTarget });
      lifecycle.add(() => uninstallPublicApi(publicApi, { win: flagTarget }));
      if (api.ui?.blockContextMenu?.addCommand) {
        api.ui.blockContextMenu.addCommand({
          label: CONTEXT_MENU_LABEL,
          callback: (e) => actions.createPlainImageRegion(e?.["block-uid"]).catch((error) => console.warn("[plexus] image region failed", error))
        });
        lifecycle.add(() => api.ui.blockContextMenu.removeCommand?.({ label: CONTEXT_MENU_LABEL }));
        api.ui.blockContextMenu.addCommand({
          label: PRESENT_MENU_LABEL,
          "display-conditional": (e) => DRAWING_START2.test(host.pullBlock(e?.["block-uid"])?.string ?? ""),
          callback: (e) => actions.presentDrawing({ drawingUid: e?.["block-uid"] }).catch((error) => console.warn("[plexus] present failed", error))
        });
        lifecycle.add(() => api.ui.blockContextMenu.removeCommand?.({ label: PRESENT_MENU_LABEL }));
        api.ui.blockContextMenu.addCommand({
          label: MINDMAP_MENU_LABEL,
          callback: (e) => actions.mindMapFromOutline(e?.["block-uid"]).catch((error) => console.warn("[plexus] mind map failed", error))
        });
        lifecycle.add(() => api.ui.blockContextMenu.removeCommand?.({ label: MINDMAP_MENU_LABEL }));
      }
      const regionref = createRegionRefRenderer({
        host,
        cache,
        cold,
        getSettings,
        doc,
        onOpen: (uid, opts) => actions.openRegion(uid, opts).catch((error) => console.warn("[plexus] open failed", error))
      });
      lifecycle.add(() => regionref.releaseAll());
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
      let mounted = null;
      let navigatedAt = -Infinity;
      const unmountEditor = () => {
        const current = mounted;
        mounted = null;
        if (!current) return;
        if (Date.now() - navigatedAt <= 2e3) clearLinkTooltip(doc);
        for (const dispose of current.disposers) {
          try {
            dispose();
          } catch (error) {
            console.warn("[plexus] editor cleanup failed", error);
          }
        }
        actions.cancelDrawingTool();
        if (current.uid) {
          emitter.emit({ uid: current.uid, kind: "drawing" });
          warmThumbnails(current.uid);
        }
      };
      lifecycle.add(unmountEditor);
      const discovery = createDiscovery({
        root: doc.body,
        onRegionButton: (btn) => regionref.claim(btn),
        onEditorMount: (el) => {
          const outer = el.closest(".excalidraw-outer-container");
          if (outer) toolbar.show(outer);
          unmountEditor();
          const app = findApp(el);
          if (!app) return;
          mounted = { uid: host.blockUidFromNode(el), disposers: [] };
          try {
            const off = app.onChangeEmitter?.on?.(() => toolbar.refresh());
            if (typeof off === "function") mounted.disposers.push(off);
          } catch (error) {
            console.warn("[plexus] toolbar refresh subscribe failed", error);
          }
          toolbar.refresh();
          mounted.disposers.push(hover.attach({ app, containerEl: el }));
          const overlay = createEmbedOverlay({ doc, api, host, app, containerEl: el, zIndex: outer ? baseZIndex(doc, outer) : 1e3 });
          mounted.disposers.push(() => overlay.dispose());
          mounted.disposers.push(mindmap.mount({ app, containerEl: el, outerEl: outer, zIndex: outer ? baseZIndex(doc, outer) : 1e3 }));
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
    const run = (name) => () => {
      if (!actions) return console.warn("[plexus] unavailable outside Roam:", name);
      return actions[name]().catch((error) => console.warn("[plexus]", name, "failed", error));
    };
    const commands = [
      ["Plexus: Create region from selection", "createAreaRegion"],
      ["Plexus: Create image region", "createImageRegion"],
      ["Plexus: Present open drawing", "presentDrawing"],
      ["Plexus: Refresh crops for open drawing", "refreshCropsForOpenDrawing"],
      ["Plexus: Clear crop cache", "clearCache"]
    ];
    for (const [label, name] of commands) {
      await lifecycle.command(extensionAPI.ui.commandPalette, { label, callback: run(name) });
    }
    await lifecycle.command(extensionAPI.ui.commandPalette, {
      label: "Plexus: Mind map from outline",
      callback: () => {
        if (!actions) return console.warn("[plexus] unavailable outside Roam: mindMapFromOutline");
        const uid = globalThis.roamAlphaAPI?.ui?.getFocusedBlock?.()?.["block-uid"];
        return actions.mindMapFromOutline(uid).catch((error) => console.warn("[plexus] mind map failed", error));
      }
    });
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
