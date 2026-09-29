export const REGION_COMPONENT = "plexus-region";
export const CONTAINER_STRING = "{{[[plexus-regions]]}}";
export const REGION_BUTTON_CLASS = "rm-xparser-default-plexus-region";
export const DEFAULT_PAD = 10;
export const SUPPORTED_KINDS = Object.freeze(["area", "rect"]);
export const RESERVED_KINDS = Object.freeze(["group", "frame", "cframe", "poly"]);

const ID_RE = /^[A-Za-z0-9_-]+$/;
const HEAD_RE = /^\s*\{\{\[\[plexus-region\]\]:\s*([^}]*)\}\}(?: ([\s\S]*))?$/;
const KNOWN_KEYS = new Set(["k", "d", "ids", "pad", "el", "f"]);

const clamp01 = (n) => Math.min(1, Math.max(0, n));
const round4 = (n) => Math.round(n * 10000) / 10000;

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
  return `${region.kind}|${region.drawingUid}`;
}
