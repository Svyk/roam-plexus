import { parseRoamLink } from "./links.js";

const MAX_CAPTION = 200;
const UID_RE = /^[A-Za-z0-9_-]+$/;

function cleanText(text) {
  return String(text ?? "")
    .replace(/[{}`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Text of text elements whose id is in ids OR whose containerId is in ids, in scene order.
export function captionFromElements(elements, ids) {
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

function refFromLink(value) {
  const parsed = parseRoamLink(value);
  if (!parsed) return null;
  if (parsed.type === "block" && parsed.uid) return `((${parsed.uid}))`;
  if (parsed.type === "page" && parsed.title) return `[[${parsed.title}]]`;
  return null;
}

// The Roam ref behind an element: mind-map node uid, embed target, or a Roam-ref Excalidraw link.
export function sourceRefOf(el) {
  const plexus = el?.customData?.plexus;
  const uid = plexus?.mm?.uid;
  if (typeof uid === "string" && UID_RE.test(uid)) return `((${uid}))`;
  return refFromLink(plexus?.embed) || refFromLink(el?.link);
}

const SEP = " · ";
const WORD_BUDGET = 60;
const ARROW_ONLY = /^[\s→←↑↓↔⇒⇐⇔↗↘↙↖>=<-]*$/u;
const NUMERIC_ONLY = /^[\s\d\p{P}\p{S}]*$/u;

const lengthOf = (text) => [...text].length;

// First sentence of a text part (the terminator stays).
function firstSentence(text) {
  const m = /[.?!](?=\s)/.exec(text);
  return m ? text.slice(0, m.index + 1) : text;
}

function boxOf(el) {
  const h = Number(el?.height) || 0;
  return { x: Number(el?.x) || 0, yc: (Number(el?.y) || 0) + h / 2, h };
}

// Visual reading order: rows by y-centre (a row breaks when a part sits more than half the median height below the row's
// first part), left to right within a row. Rows are cut sequentially, so the comparison stays transitive.
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

// Like captionFromElements, but elements backed by a Roam block/page contribute that ref instead of their text.
// Source refs come first, then (frames) the frame name or the container labels and free text, each group in visual
// order. Returns { caption, hasRef }.
export function captionRefsInfo(elements, ids, { frameName, words = true } = {}) {
  if (!Array.isArray(elements) || !ids) return { caption: "", hasRef: false };
  const wanted = new Set(Array.isArray(ids) ? ids : [...ids]);
  const byId = new Map();
  for (const el of elements) if (el && el.id) byId.set(el.id, el);
  const refs = [];
  const bound = [];
  const free = [];
  const seenRefs = new Set();
  let seq = 0;
  for (const el of elements) {
    if (!el || el.isDeleted) continue;
    const isText = el.type === "text";
    if (!wanted.has(el.id) && !(isText && el.containerId && wanted.has(el.containerId))) continue;
    const container = isText && el.containerId ? byId.get(el.containerId) : null;
    const live = container && !container.isDeleted ? container : null;
    const box = boxOf(live || el);
    const ref = (live && sourceRefOf(live)) || sourceRefOf(el);
    if (ref) {
      if (!seenRefs.has(ref)) { seenRefs.add(ref); refs.push({ value: ref, box, seq: seq++ }); }
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
  const seen = new Set();
  let used = 0;
  for (const part of wordParts) {
    if (seen.has(part.value)) continue;
    seen.add(part.value);
    const size = lengthOf(part.value);
    if (used + size <= WORD_BUDGET) { parts.push({ value: part.value, isRef: false }); used += size; continue; }
    const cutText = cutWords(part.value, WORD_BUDGET - used, used === 0);
    if (cutText) parts.push({ value: cutText, isRef: false });
    break;
  }
  let caption = "";
  for (const part of parts) {
    const next = caption ? `${caption}${SEP}${part.value}` : part.value;
    if (next.length <= MAX_CAPTION) { caption = next; continue; }
    if (!part.isRef) caption = next.slice(0, MAX_CAPTION).trim();
    break;
  }
  return { caption, hasRef: parts.some((p) => p.isRef) };
}

export const captionRefsFromElements = (elements, ids, opts) => captionRefsInfo(elements, ids, opts).caption;
