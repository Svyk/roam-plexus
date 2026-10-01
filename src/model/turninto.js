import { elementText } from "./carry.js";
import { makeEmbedAnchor } from "./embeds.js";

const UID_RE = /^[A-Za-z0-9_-]{9}$/;

const bump = (el, patch) => ({
  ...el,
  ...patch,
  version: (el.version || 1) + 1,
  versionNonce: Math.floor(Math.random() * 2147483647),
  updated: Date.now(),
});

export function splitTitleBody(text) {
  const raw = String(text ?? "").replace(/\r\n/g, "\n");
  const [first, ...rest] = raw.split("\n");
  const title = String(first ?? "").replace(/[\[\]{}#`]/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
  const body = rest.join("\n").trim();
  return { title, body };
}

export function pageRef(title) {
  const name = String(title ?? "").trim();
  if (!name || name.includes("[") || name.includes("]")) return null;
  return `[[${name}]]`;
}

export function blockRef(uid) {
  return UID_RE.test(String(uid ?? "")) ? `((${uid}))` : null;
}

export function imageMarkdown(url) {
  const href = String(url ?? "").trim();
  if (!href || /[\s)]/.test(href)) return null;
  return `![image](${href})`;
}

function retire(elements, ids) {
  return elements.map((el) => (ids.has(el.id) && !el.isDeleted ? bump(el, { isDeleted: true }) : el));
}

function rebindScene(elements, fromIds, toEl) {
  const arrowIds = [];
  const next = elements.map((el) => {
    if (el.type !== "arrow" || el.isDeleted) return el;
    const start = el.startBinding?.elementId;
    const end = el.endBinding?.elementId;
    if (!fromIds.has(start) && !fromIds.has(end)) return el;
    const patch = {};
    if (fromIds.has(start)) patch.startBinding = { ...el.startBinding, elementId: toEl.id };
    if (fromIds.has(end)) patch.endBinding = { ...el.endBinding, elementId: toEl.id };
    arrowIds.push(el.id);
    return bump(el, patch);
  });
  if (arrowIds.length) {
    const existing = Array.isArray(toEl.boundElements) ? toEl.boundElements.filter((b) => !fromIds.has(b.id)) : [];
    const have = new Set(existing.map((b) => b.id));
    toEl.boundElements = [
      ...existing,
      ...arrowIds.filter((id) => !have.has(id)).map((id) => ({ id, type: "arrow" })),
    ];
  }
  return next;
}

function dropSet(elements, fromId) {
  const drop = new Set([fromId]);
  for (const el of elements) if (el?.containerId === fromId) drop.add(el.id);
  return drop;
}

function mergeCustom(source, rect) {
  const custom = source.customData && typeof source.customData === "object" ? source.customData : {};
  const rectData = rect.customData && typeof rect.customData === "object" ? rect.customData : {};
  rect.customData = {
    ...custom,
    ...rectData,
    plexus: { ...(custom.plexus || {}), ...(rectData.plexus || {}) },
  };
}

// Replace one element with an embed anchor in the same box. Arrows follow the rectangle.
export function turnIntoEmbed(elements, fromId, { ref, label } = {}) {
  const list = Array.isArray(elements) ? elements : [];
  const source = list.find((el) => el && el.id === fromId && !el.isDeleted);
  if (!source || !ref) return null;
  const width = Math.max(source.width || 0, 160);
  const height = Math.max(source.height || 0, 80);
  const [rect, text] = makeEmbedAnchor({
    ref,
    label: label || ref,
    x: source.x || 0,
    y: source.y || 0,
    width,
    height,
  });
  mergeCustom(source, rect);
  const drop = dropSet(list, source.id);
  return [...rebindScene(retire(list, drop), drop, rect), rect, text];
}

export function turnIntoLink(elements, fromId, link) {
  if (!link) return null;
  let hit = false;
  const next = (Array.isArray(elements) ? elements : []).map((el) => {
    if (!el || el.id !== fromId || el.isDeleted) return el;
    hit = true;
    return bump(el, { link });
  });
  return hit ? next : null;
}

export function turnBackToText(elements, fromId, value) {
  const list = Array.isArray(elements) ? elements : [];
  const source = list.find((el) => el && el.id === fromId && !el.isDeleted);
  if (!source) return null;
  const text = String(value ?? "");
  const made = {
    id: `plxtext${Math.random().toString(36).slice(2, 10)}`,
    type: "text",
    x: source.x || 0,
    y: source.y || 0,
    width: Math.max(source.width || 0, 20),
    height: Math.max(source.height || 0, 20),
    angle: source.angle || 0,
    strokeColor: source.strokeColor || "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: source.opacity ?? 100,
    groupIds: Array.isArray(source.groupIds) ? source.groupIds.slice() : [],
    frameId: source.frameId ?? null,
    roundness: null,
    seed: Math.floor(Math.random() * 2147483647),
    version: 1,
    versionNonce: Math.floor(Math.random() * 2147483647),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    text,
    originalText: text,
    fontSize: 20,
    fontFamily: 1,
    textAlign: "left",
    verticalAlign: "top",
    autoResize: true,
    lineHeight: 1.25,
  };
  const drop = dropSet(list, source.id);
  return [...rebindScene(retire(list, drop), drop, made), made];
}

// The image leaves the canvas. Arrows that pointed at it are unbound.
export function dropElement(elements, fromId) {
  const list = Array.isArray(elements) ? elements : [];
  const source = list.find((el) => el && el.id === fromId && !el.isDeleted);
  if (!source) return null;
  const drop = dropSet(list, source.id);
  return list.map((el) => {
    if (!el) return el;
    if (drop.has(el.id) && !el.isDeleted) return bump(el, { isDeleted: true, boundElements: null });
    if (el.type === "arrow" && !el.isDeleted && (drop.has(el.startBinding?.elementId) || drop.has(el.endBinding?.elementId))) {
      const patch = {};
      if (drop.has(el.startBinding?.elementId)) patch.startBinding = null;
      if (drop.has(el.endBinding?.elementId)) patch.endBinding = null;
      return bump(el, patch);
    }
    if (Array.isArray(el.boundElements) && el.boundElements.some((b) => drop.has(b.id))) {
      return bump(el, { boundElements: el.boundElements.filter((b) => !drop.has(b.id)) });
    }
    return el;
  });
}

export function sourceText(el) {
  return elementText(el);
}
