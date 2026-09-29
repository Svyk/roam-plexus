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

// Like captionFromElements, but elements backed by a Roam block/page contribute that ref instead of their text.
// Returns { caption, hasRef }.
export function captionRefsInfo(elements, ids) {
  if (!Array.isArray(elements) || !ids) return { caption: "", hasRef: false };
  const wanted = new Set(Array.isArray(ids) ? ids : [...ids]);
  const byId = new Map();
  for (const el of elements) if (el && el.id) byId.set(el.id, el);
  const parts = [];
  const seen = new Set();
  const push = (value, isRef) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    parts.push({ value, isRef });
  };
  for (const el of elements) {
    if (!el || el.isDeleted) continue;
    const isText = el.type === "text";
    if (!wanted.has(el.id) && !(isText && el.containerId && wanted.has(el.containerId))) continue;
    const container = isText && el.containerId ? byId.get(el.containerId) : null;
    const ref = (container && !container.isDeleted && sourceRefOf(container)) || sourceRefOf(el);
    if (ref) { push(ref, true); continue; }
    if (isText) push(cleanText(el.originalText ?? el.text), false);
  }
  let caption = "";
  for (const part of parts) {
    const next = caption ? `${caption} ; ${part.value}` : part.value;
    if (next.length <= MAX_CAPTION) { caption = next; continue; }
    if (!part.isRef) caption = next.slice(0, MAX_CAPTION).trim();
    break;
  }
  return { caption, hasRef: parts.some((p) => p.isRef) };
}

export const captionRefsFromElements = (elements, ids) => captionRefsInfo(elements, ids).caption;
