// Nested drawings, the unplaced tray, block-ref text, and comment threads. Pure. No scene writes.
import { embedLabel, parseEmbedRef } from "./embeds.js";
import { drawingName } from "./drawing-name.js";
import { liveElements } from "./scene.js";

export const INBOX_CAP = 24;
export const THREAD_CAP = 20;
export const CRUMB_CAP = 8;

const DRAWING_RE = /^(\{\{\[\[excalidraw\]\]\}\}|\{\{excalidraw\}\})/;
const SKIP_EXACT = new Set(["{{[[mermaid]]}}", "{{[[plexus-cards]]}}", "{{[[plexus-regions]]}}"]);

export function isDrawingString(value) {
  return DRAWING_RE.test(String(value ?? "").trim());
}

function clip(text, max = 40) {
  return embedLabel(text, max);
}

// read(uid) -> { string, parentUid, isPage, title, name } or null. Root first, current last.
export function breadcrumbRows(uid, read) {
  const out = [];
  const seen = new Set();
  let cur = uid;
  for (let i = 0; i < CRUMB_CAP && cur && !seen.has(cur); i += 1) {
    seen.add(cur);
    let row = null;
    try { row = read(cur); } catch { row = null; }
    if (!row) break;
    if (row.isPage) {
      out.push({ uid: cur, label: clip(row.title || "Page"), page: true, drawing: false });
      break;
    }
    if (isDrawingString(row.string)) {
      out.push({ uid: cur, label: clip(row.name || "Drawing"), page: false, drawing: true });
      cur = row.parentUid || null;
      continue;
    }
    out.push({ uid: cur, label: clip(row.string) || "Block", page: false, drawing: false });
    break;
  }
  return out.reverse();
}

export function referencedUids(elements) {
  const found = new Set();
  for (const el of liveElements(elements)) {
    const plexus = el?.customData?.plexus;
    if (plexus && typeof plexus === "object") {
      const embed = parseEmbedRef(plexus.embed);
      if (embed?.uid) found.add(embed.uid);
      for (const key of ["transclude", "comment", "query"]) {
        if (typeof plexus[key] === "string" && plexus[key]) found.add(plexus[key]);
      }
    }
    for (const raw of [el?.link, el?.originalText, el?.text]) {
      const ref = parseEmbedRef(String(raw ?? "").trim());
      if (ref?.kind === "block") found.add(ref.uid);
    }
  }
  return found;
}

export function skipInbox(string) {
  const text = String(string ?? "").trim();
  if (!text) return false;
  if (text.startsWith("Name::")) return true;
  if (SKIP_EXACT.has(text)) return true;
  if (text.startsWith("{{[[plexus-")) return true;
  return false;
}

export function inboxLabel(child) {
  if (isDrawingString(child?.string)) return clip(child.name || "Drawing", 60);
  return clip(child?.string, 60) || "(empty)";
}

// Children of the drawing that no live element already points at. Capped.
export function inboxList(children, elements) {
  const placed = referencedUids(elements);
  const all = [];
  for (const child of children || []) {
    if (!child?.uid || placed.has(child.uid) || skipInbox(child.string)) continue;
    all.push({ uid: child.uid, label: inboxLabel(child) });
  }
  return { rows: all.slice(0, INBOX_CAP), total: all.length };
}

export function transcludeUid(el) {
  if (!el || el.type !== "text" || el.containerId) return null;
  const stored = el.customData?.plexus?.transclude;
  if (typeof stored === "string" && stored) return stored;
  const ref = parseEmbedRef(String(el.originalText ?? "").trim()) || parseEmbedRef(String(el.text ?? "").trim());
  return ref?.kind === "block" ? ref.uid : null;
}

// A new text element, or null when the words and the uid are already current. Does not write the block.
export function transcludePatch(el, blockString) {
  const uid = transcludeUid(el);
  if (!uid) return null;
  const text = embedLabel(blockString, 240) || "(empty)";
  if (el.customData?.plexus?.transclude === uid && el.text === text && el.originalText === text) return null;
  return {
    ...el,
    text,
    originalText: text,
    version: (Number(el.version) || 1) + 1,
    customData: {
      ...(el.customData && typeof el.customData === "object" ? el.customData : {}),
      plexus: { ...(el.customData?.plexus || {}), transclude: uid },
    },
  };
}

// stringOf(uid) returns the block string, or null when the block is missing.
export function refreshTransclusions(elements, stringOf) {
  let changed = false;
  const next = (elements || []).map((el) => {
    const uid = transcludeUid(el);
    if (!uid) return el;
    let raw = null;
    try { raw = stringOf(uid); } catch { return el; }
    if (typeof raw !== "string") return el;
    const patch = transcludePatch(el, raw);
    if (!patch) return el;
    changed = true;
    return patch;
  });
  return changed ? next : null;
}

export function threadRows(block, cap = THREAD_CAP) {
  const children = Array.isArray(block?.children) ? block.children : [];
  return {
    uid: block?.uid ?? null,
    text: embedLabel(block?.string, 160) || "(empty)",
    replies: children.slice(0, cap).map((child) => ({
      uid: child.uid,
      text: embedLabel(child.string, 160) || "(empty)",
    })),
    total: children.length,
  };
}

export function drawingNameOf(children) {
  return drawingName(children)?.value || "";
}
