import { liveElements } from "./scene.js";

const REF_RE = /^\(\(([A-Za-z0-9_-]{9})\)\)$/;
const PAGE_RE = /^\[\[([^\]]+)\]\]$/;
const UID_RE = /^[A-Za-z0-9_-]{9}$/;

// "((uid))", "[[Title]]" or a bare 9-char uid -> { kind, uid?, title?, ref } or null.
export function parseEmbedRef(text) {
  if (typeof text !== "string") return null;
  const t = text.trim();
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
  return plain.slice(0, max);
}

// Merge a plexus payload into existing customData without dropping other keys (e.g. Roam's firebaseUrl).
export function mergePlexusData(customData, patch) {
  const base = customData && typeof customData === "object" ? customData : {};
  const plexus = base.plexus && typeof base.plexus === "object" ? base.plexus : {};
  return { ...base, plexus: { ...plexus, ...patch } };
}

const rnd = () => Math.floor(Math.random() * 2 ** 31);
const rid = (prefix) => `${prefix}${Math.random().toString(36).slice(2, 12)}`;

function base(id, type, x, y, width, height) {
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

export function makeEmbedAnchor({ ref, label = "", x = 0, y = 0, width = 360, height = 200, idPrefix = "plexus-embed-" } = {}) {
  const rectId = rid(idPrefix);
  const textId = rid(idPrefix);
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
    boundElements: [{ id: textId, type: "text" }],
    customData: { plexus: { embed: ref } },
  };
  const t = {
    ...base(textId, "text", x + (width - tw) / 2, y + (height - th) / 2, tw, th),
    text: wrapped, originalText: text, fontSize, fontFamily: 1, textAlign: "center", verticalAlign: "middle",
    containerId: rectId, autoResize: true, lineHeight,
  };
  return [rect, t];
}

export function embedAnchors(elements) {
  return liveElements(elements).filter((el) => el.type === "rectangle" && typeof el.customData?.plexus?.embed === "string");
}
