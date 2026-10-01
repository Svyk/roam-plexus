// GRAPH-11. One plain text element inside a region stays in step with the caption.
// Markup cannot round-trip, so a link, a block ref, a component, or a tag writes nothing.
// The first look records both sides and writes nothing. If both sides then change, nothing is written.

import { regionSceneBBox } from "./scene.js";

const MARKUP = /\[\[|\(\(|\{\{|#/;
export const SYNC_CAP = 20;

export function hasMarkup(value) {
  return MARKUP.test(String(value ?? ""));
}

export function plainPiece(value) {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!s || hasMarkup(s)) return null;
  return s;
}

/** The only non-mind-map text whose center sits in the box, or null. */
export function singleText(elements, bbox) {
  if (!bbox || bbox.length !== 4) return null;
  const [x1, y1, x2, y2] = bbox;
  const hits = [];
  for (const el of elements || []) {
    if (!el || el.isDeleted || el.type !== "text") continue;
    if (typeof el.id === "string" && el.id.startsWith("pmm-")) continue;
    const cx = (Number(el.x) || 0) + (Number(el.width) || 0) / 2;
    const cy = (Number(el.y) || 0) + (Number(el.height) || 0) / 2;
    if (cx < x1 || cy < y1 || cx > x2 || cy > y2) continue;
    hits.push(el);
    if (hits.length > 1) return null;
  }
  return hits.length === 1 ? hits[0] : null;
}

export function syncRows({ regions, elements, appState }) {
  const rows = [];
  for (const row of regions || []) {
    const region = row?.region;
    if (!region || region.supported === false) continue;
    let box;
    try { box = regionSceneBBox(region, elements, appState); } catch { box = null; }
    if (!box?.bbox) continue;
    const text = singleText(elements, box.bbox);
    if (!text) continue;
    rows.push({
      regionUid: row.uid,
      caption: region.caption || "",
      text: text.originalText ?? text.text ?? "",
      elementId: text.id,
    });
    if (rows.length >= SYNC_CAP) break;
  }
  return rows;
}

/**
 * prev is the last acknowledged {caption, text}, or null before the first look.
 * write: canvas plain text becomes the caption. paint: the caption becomes the canvas text.
 */
export function stepSync(prev, row) {
  if (!row || row.editing) return { action: "none", next: prev || null };
  const rawCap = String(row.caption ?? "").replace(/\s+/g, " ").trim();
  const rawText = String(row.text ?? "").replace(/\s+/g, " ").trim();
  if (hasMarkup(rawCap) || hasMarkup(rawText)) return { action: "none", next: prev || null };
  if (!prev) return { action: "none", next: { caption: rawCap, text: rawText } };
  const capChanged = rawCap !== prev.caption;
  const textChanged = rawText !== prev.text;
  if (capChanged && textChanged) return { action: "none", next: prev };
  if (textChanged && rawText && rawText !== rawCap) return { action: "write", caption: rawText, next: { caption: rawText, text: rawText } };
  if (capChanged && rawCap !== rawText) return { action: "paint", text: rawCap, next: { caption: rawCap, text: rawCap } };
  return { action: "none", next: { caption: rawCap, text: rawText } };
}
