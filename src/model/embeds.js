import { liveElements } from "./scene.js";

const REF_RE = /^\(\(([A-Za-z0-9_-]{9})\)\)$/;
const PAGE_RE = /^\[\[([^\]]+)\]\]$/;
const UID_RE = /^[A-Za-z0-9_-]{9}$/;

// Token for the live "today" embed. Only this exact string; "[[today]]" stays an ordinary page ref.
export const TODAY_REF = "plexus:today";
export const QUERY_REF = "plexus:query";

// "((uid))", "[[Title]]", a bare 9-char uid or the today token -> { kind, uid?, title?, ref } or null.
export function parseEmbedRef(text) {
  if (typeof text !== "string") return null;
  const t = text.trim();
  if (t === TODAY_REF) return { kind: "today", ref: TODAY_REF };
  if (t === QUERY_REF) return { kind: "query", ref: QUERY_REF };
  let m = REF_RE.exec(t);
  if (m) return { kind: "block", uid: m[1], ref: `((${m[1]}))` };
  m = PAGE_RE.exec(t);
  if (m && m[1].trim()) return { kind: "page", title: m[1].trim(), ref: `[[${m[1].trim()}]]` };
  if (UID_RE.test(t)) return { kind: "block", uid: t, ref: `((${t}))` };
  return null;
}

// First 80 chars of plain text: strips {}, backticks and [[ ]] brackets.
export function embedLabel(text, max = 80) {
  const plain = String(text ?? "").replace(/[{}`]/g, "").replace(/\[\[|\]\]/g, "").replace(/\s+/g, " ").trim();
  return plain.slice(0, max).trimEnd();
}

// Merge a plexus payload into existing customData without dropping other keys (e.g. Roam's firebaseUrl).
export function mergePlexusData(customData, patch) {
  const base = customData && typeof customData === "object" ? customData : {};
  const plexus = base.plexus && typeof base.plexus === "object" ? base.plexus : {};
  return { ...base, plexus: { ...plexus, ...patch } };
}

const rnd = () => Math.floor(Math.random() * 2 ** 31);
const rid = (prefix) => `${prefix}${Math.random().toString(36).slice(2, 12)}`;

export function baseElement(id, type, x, y, width, height) {
  return {
    id, type, x, y, width, height, angle: 0,
    strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid",
    strokeWidth: 1, strokeStyle: "solid", roughness: 0, opacity: 100,
    groupIds: [], frameId: null, roundness: null,
    seed: rnd(), version: 1, versionNonce: rnd(), isDeleted: false,
    boundElements: null, updated: Date.now(), link: null, locked: false, index: null,
  };
}

function wrapLines(text, perLine) {
  const lines = [];
  let cur = "";
  for (const word of text.split(" ")) {
    let w = word;
    while (w.length > perLine) {
      if (cur) { lines.push(cur); cur = ""; }
      lines.push(w.slice(0, perLine));
      w = w.slice(perLine);
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= perLine) cur += ` ${w}`;
    else { lines.push(cur); cur = w; }
  }
  if (cur || !lines.length) lines.push(cur);
  return lines;
}

// Wrapped, centred label for an anchor box. x/y/width/height in the result are the bound text element's.
// Shared by creation and refresh so the two cannot drift; long labels are cut to the lines that fit, ending in "...".
export function layoutAnchorLabel({ label = "", x = 0, y = 0, width = 360, height = 200, fontSize = 16, lineHeight = 1.25 } = {}) {
  const text = embedLabel(label);
  const perLine = Math.max(4, Math.floor((width - 16) / (fontSize * 0.6)));
  let lines = wrapLines(text, perLine);
  const maxLines = Math.max(1, Math.floor((height - 8) / (fontSize * lineHeight)));
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = `${last.length >= perLine ? last.slice(0, Math.max(0, perLine - 1)) : last}\u2026`;
  }
  const longest = Math.max(1, ...lines.map((l) => l.length));
  const tw = Math.min(width - 16, Math.max(10, Math.ceil(longest * fontSize * 0.6)));
  const th = Math.ceil(lines.length * fontSize * lineHeight);
  return { text: lines.join("\n"), originalText: text, x: x + (width - tw) / 2, y: y + (height - th) / 2, width: tw, height: th };
}

export function makeEmbedAnchor({ ref, link = ref, label = "", x = 0, y = 0, width = 360, height = 200, idPrefix = "plexus-embed-" } = {}) {
  const rectId = rid(idPrefix);
  const textId = rid(idPrefix);
  const fontSize = 16;
  const lineHeight = 1.25;
  const laid = layoutAnchorLabel({ label: embedLabel(label) || embedLabel(ref), x, y, width, height, fontSize, lineHeight });
  const rect = {
    ...baseElement(rectId, "rectangle", x, y, width, height),
    strokeStyle: "dashed",
    backgroundColor: "transparent",
    link,
    boundElements: [{ id: textId, type: "text" }],
    customData: { plexus: { embed: ref } },
  };
  const t = {
    ...baseElement(textId, "text", laid.x, laid.y, laid.width, laid.height),
    text: laid.text, originalText: laid.originalText, fontSize, fontFamily: 1, textAlign: "center", verticalAlign: "middle",
    containerId: rectId, autoResize: true, lineHeight,
  };
  return [rect, t];
}

export function embedAnchors(elements) {
  return liveElements(elements).filter((el) => el.type === "rectangle" && typeof el.customData?.plexus?.embed === "string");
}
