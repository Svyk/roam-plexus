import { readEdn } from "./edn.js";
import { mergePlexusData } from "./embeds.js";

const MACRO_RE = /^\{\{\s*(?:\[\[roam\/render\]\]|roam\/render)\s*:\s*\(\(ExcalDATA\)\)\s*/;
const START_RE = /^\{\{\s*(?:\[\[roam\/render\]\]|roam\/render)\s*:\s*\(\(ExcalDATA\)\)\s*(?:\{|\}\})/;
const COMPONENT_PAGE = "roam/excalidraw";
const LINEAR = new Set(["line", "arrow", "draw", "freedraw"]);
const LINK_RE = /(?<!\S)#\[\[[^\[\]]+\]\]|\[\[[^\[\]]+\]\]|\(\([A-Za-z0-9_-]{9}\)\)|(?<!\S)#[^\s\[\]()\{\},;:!?"'`#]+/g;
const encoder = new TextEncoder();

export const LEGACY_QUERY =
  '[:find ?u ?s ?t :where [?b :block/string ?s] [(clojure.string/includes? ?s "((ExcalDATA))")] [?b :block/uid ?u] [?b :block/page ?p] [?p :node/title ?t]]';

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const finite = (v) => typeof v === "number" && Number.isFinite(v);

// data.q results ([uid string page] tuples) -> [{uid, page, string}].
export function rowsFromQuery(results) {
  const out = [];
  for (const r of Array.isArray(results) ? results : []) {
    if (Array.isArray(r) && typeof r[0] === "string" && typeof r[1] === "string") {
      out.push({ uid: r[0], string: r[1], page: typeof r[2] === "string" ? r[2] : "" });
    }
  }
  return out;
}

const normRow = (r) => (Array.isArray(r) ? { uid: r[0], string: r[1], page: r[2] ?? "" } : r);

export function mentionsExcalData(s) {
  return typeof s === "string" && s.includes("((ExcalDATA))");
}

export function isLegacyDrawingString(s) {
  return typeof s === "string" && START_RE.test(s.trim());
}

export function parseLegacyDrawing(s) {
  if (!isLegacyDrawingString(s)) return { error: "not a legacy drawing" };
  const t = s.trim();
  const at = MACRO_RE.exec(t)[0].length;
  if (t.startsWith("}}", at)) {
    const out = { elements: [], appState: null, version: null };
    if (t.slice(at + 2).trim()) out.trailing = true;
    return out;
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
    version: isObj(map.roamExcalidraw) && map.roamExcalidraw.version !== undefined ? map.roamExcalidraw.version : null,
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

export function legacyToElements(ednElements, { migratedFrom } = {}) {
  const elements = [];
  let invalid = 0;
  let invisible = 0;
  for (const src of Array.isArray(ednElements) ? ednElements : []) {
    if (isObj(src) && src.isDeleted === true) continue;
    if (!isObj(src) || typeof src.type !== "string"
      || !finite(src.x) || !finite(src.y) || !finite(src.width) || !finite(src.height)
      || (src.angle !== undefined && src.angle !== null && !finite(src.angle))) {
      invalid++;
      continue;
    }
    let points;
    if (src.points !== undefined && src.points !== null) {
      points = coercePoints(src.points);
      if (!points) { invalid++; continue; }
    }
    const linear = LINEAR.has(src.type);
    if ((linear && (!points || points.length < 2))
      || (!linear && src.type !== "text" && src.width === 0 && src.height === 0)
      || (src.type === "text" && (typeof src.text !== "string" || src.text === ""))) {
      invisible++;
      continue;
    }
    const el = structuredClone(src);
    if (points) el.points = points;
    if (el.version === null) delete el.version;
    if (el.versionNonce === null) delete el.versionNonce;
    if (migratedFrom !== undefined) el.customData = mergePlexusData(el.customData, { migratedFrom });
    elements.push(el);
  }
  return { elements, invalid, invisible };
}

function extractLinks(elements) {
  const set = new Set();
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

// Report rows for drawings only; component code and non-drawings are listed by legacySummary instead.
export function legacyReport(rows) {
  const out = [];
  for (const raw of Array.isArray(rows) ? rows : []) {
    const r = normRow(raw);
    if (!isDrawingRow(r)) continue;
    const row = {
      uid: r.uid, page: r.page ?? "", elementCount: 0, types: {}, empty: true,
      bytes: encoder.encode(r.string).length, invalid: 0, invisible: 0,
      links: [], macroText: 0, trailing: false,
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

export function legacySummary(queryRows) {
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
    empty: legacyReport(drawings).filter((r) => r.empty).length,
  };
}
