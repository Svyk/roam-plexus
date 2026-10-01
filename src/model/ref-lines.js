import { embedAnchors, parseEmbedRef } from "./embeds.js";
import { viewportToScene } from "./scene.js";

export const REF_LINE_CAP = 12;

export function cardTexts(content) {
  const out = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.string === "string" && node.string) out.push(node.string);
    if (typeof node.title === "string" && node.title) out.push(`[[${node.title}]]`);
    for (const child of node.children || []) walk(child);
  };
  walk(content);
  return out;
}

function token(ref) {
  const parsed = parseEmbedRef(ref);
  if (!parsed || parsed.kind === "query" || parsed.kind === "today") return null;
  if (parsed.kind === "page") return `[[${parsed.title}]]`;
  if (parsed.kind === "block") return `((${parsed.uid}))`;
  return null;
}

export function mentions(texts, ref) {
  const needle = token(ref);
  if (!needle) return false;
  return (texts || []).some((text) => typeof text === "string" && text.includes(needle));
}

// Lines from the hovered card to other cards on this canvas that mention each other. One line per pair.
export function hoveredRefLines({ hoveredId, cards } = {}) {
  const list = Array.isArray(cards) ? cards : [];
  const me = list.find((card) => card && card.id === hoveredId);
  if (!me) return [];
  const lines = [];
  for (const other of list) {
    if (!other || other.id === me.id) continue;
    if (!mentions(me.texts, other.ref) && !mentions(other.texts, me.ref)) continue;
    lines.push({
      fromId: me.id,
      toId: other.id,
      x1: me.x + me.width / 2,
      y1: me.y + me.height / 2,
      x2: other.x + other.width / 2,
      y2: other.y + other.height / 2,
    });
    if (lines.length >= REF_LINE_CAP) break;
  }
  return lines;
}

// Topmost embed under a viewport point. Null when the point misses every card.
export function embedAtPoint(elements, appState, x, y) {
  const point = viewportToScene({ x, y, appState });
  const list = embedAnchors(elements);
  for (let i = list.length - 1; i >= 0; i--) {
    const el = list[i];
    if (point.x >= el.x && point.x <= el.x + el.width && point.y >= el.y && point.y <= el.y + el.height) return el.id;
  }
  return null;
}
