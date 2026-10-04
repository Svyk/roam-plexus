export const REGION_COMPONENT = "plexus-region";
export const CONTAINER_STRING = "{{[[plexus-regions]]}}";
export const REGION_BUTTON_CLASS = "rm-xparser-default-plexus-region";
export const DEFAULT_PAD = 10;
export const SUPPORTED_KINDS = Object.freeze(["area", "rect", "group", "frame", "cframe", "poly", "imgrect", "imgpoly"]);
export const RESERVED_KINDS = Object.freeze(["img", "view"]);

const ID_RE = /^[A-Za-z0-9_-]+$/;
export const isId = (value) => typeof value === "string" && ID_RE.test(value);
const HEAD_RE = /^\s*\{\{\[\[plexus-region\]\]:\s*([^}]*)\}\}(?: ([\s\S]*))?$/;
const KNOWN_KEYS = new Set(["k", "d", "ids", "pad", "el", "f", "g", "fr", "p", "i"]);

const clamp01 = (n) => Math.min(1, Math.max(0, n));
const round4 = (n) => Math.round(n * 10000) / 10000;

// Flat [x1,y1,x2,y2,...] (or [[x,y],...]) fractions -> clamped, 4 dp, at least 3 points; else null.
export function normalizePoly(p) {
  if (!Array.isArray(p)) return null;
  const flat = p.length && Array.isArray(p[0]) ? p.flat() : p;
  if (flat.length < 6 || flat.length % 2) return null;
  const nums = flat.map((n) => (typeof n === "string" && n.trim() === "" ? NaN : Number(n)));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return nums.map((n) => round4(clamp01(n)));
}

export function normalizeFrac(f) {
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

export function isContainerString(s) {
  return typeof s === "string" && s.trim() === CONTAINER_STRING;
}

export function parseRegion(blockString) {
  if (typeof blockString !== "string") return null;
  const m = HEAD_RE.exec(blockString);
  if (!m) return null;
  const caption = (m[2] ?? "").trim();
  const args = new Map();
  const extra = [];
  const bad = [];
  for (const tok of m[1].split(/\s+/)) {
    if (!tok) continue;
    const eq = tok.indexOf("=");
    if (eq <= 0) { bad.push(tok); continue; }
    const key = tok.slice(0, eq);
    const value = tok.slice(eq + 1);
    if (KNOWN_KEYS.has(key) && !args.has(key)) args.set(key, value);
    else extra.push([key, value]);
  }
  const kind = args.get("k") ?? "";
  const drawingUid = args.get("d") ?? "";
  const region = { kind, drawingUid, caption, extra, supported: false };
  const fail = (error) => { region.error = error; return region; };
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
    if (!err) { const pad = parsePad(); if (pad === null) err = "bad pad"; else region.pad = pad; }
  } else if (kind === "frame") {
    err = parseIdToken("fr", "frameId");
    if (!err) { const pad = parsePad(); if (pad === null) err = "bad pad"; else region.pad = pad; }
  } else if (kind === "cframe") {
    err = parseIdToken("fr", "frameId");
    if (!err && args.has("pad")) { extra.unshift(["pad", args.get("pad")]); }
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

export function serializeRegion(region) {
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
    const id = isGroup ? (region.groupId ?? region.g) : (region.frameId ?? region.fr);
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

export function geometryKey(region) {
  if (region.kind === "area") {
    return `area|${region.drawingUid}|${[...(region.ids ?? [])].sort().join(",")}|${region.pad ?? DEFAULT_PAD}`;
  }
  if (region.kind === "rect") {
    return `rect|${region.drawingUid}|${region.el}|${(region.f ?? []).join(",")}`;
  }
  const base = `${region.kind}|${region.drawingUid}`;
  switch (region.kind) {
    case "group": return `${base}|${region.groupId ?? region.g}|${region.pad ?? DEFAULT_PAD}`;
    case "frame": return `${base}|${region.frameId ?? region.fr}|${region.pad ?? DEFAULT_PAD}`;
    case "cframe": return `${base}|${region.frameId ?? region.fr}`;
    case "poly": return `${base}|${region.el}|${(region.p ?? []).join(",")}`;
    case "imgrect": return `${base}|${region.i}|${(region.f ?? []).join(",")}`;
    case "imgpoly": return `${base}|${region.i}|${(region.p ?? []).join(",")}`;
    default: return base;
  }
}
