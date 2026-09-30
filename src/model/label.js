import { parseImageRefs } from "./image.js";

export const PLACEHOLDER_REGION = "Region";
export const PLACEHOLDER_IMAGE_REGION = "Image region";
export const PLACEHOLDER_IMAGE_CROP = "Image crop";
export const PLACEHOLDER_FRAME = "Frame";
export const PLACEHOLDER_CAPTIONS = Object.freeze([PLACEHOLDER_REGION, PLACEHOLDER_IMAGE_REGION, PLACEHOLDER_IMAGE_CROP, PLACEHOLDER_FRAME]);

// Which kinds each placeholder is a placeholder for (cleanup only).
export const PLACEHOLDER_KINDS = Object.freeze({
  [PLACEHOLDER_REGION]: Object.freeze(["area", "group", "frame", "cframe"]),
  [PLACEHOLDER_FRAME]: Object.freeze(["frame", "cframe"]),
  [PLACEHOLDER_IMAGE_REGION]: Object.freeze(["rect", "poly", "imgrect", "imgpoly"]),
  [PLACEHOLDER_IMAGE_CROP]: Object.freeze(["rect"]),
});

export const KIND_WORDS = Object.freeze({
  area: "area",
  group: "group",
  frame: "frame",
  cframe: "clipped frame",
  rect: "crop",
  poly: "lasso",
  imgrect: "image area",
  imgpoly: "image lasso",
});

export const IMAGE_KINDS = new Set(["imgrect", "imgpoly"]);
export const isImageKind = (kind) => IMAGE_KINDS.has(kind);

const MAX_LABEL = 80;
const MAX_TITLE = 40;
const MAX_REF_TEXT = 40;

// True when caption is one of the generic placeholders for this kind. Frame-name checks are the caller's job.
export function isPlaceholderCaption(caption, kind) {
  const text = String(caption ?? "").trim();
  return Object.hasOwn(PLACEHOLDER_KINDS, text) && PLACEHOLDER_KINDS[text].includes(kind);
}

function cut(text, max) {
  if (text.length <= max) return text;
  const head = text.slice(0, max - 1);
  const space = head.lastIndexOf(" ");
  const base = text[max - 1] === " " || space <= 0 ? head : head.slice(0, space);
  return `${base.trimEnd()}…`;
}

function dropMacros(text) {
  let out = text;
  for (let i = 0; i < 5; i++) {
    const next = out.replace(/\{\{(?:(?!\{\{)[\s\S])*?\}\}/g, " ");
    if (next === out) break;
    out = next;
  }
  return out;
}

function stripMarkup(input) {
  let text = dropMacros(String(input ?? ""));
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt) => ` ${alt} `);
  text = text.replace(/\[([^\]]*)\]\((?:\(\([^)]*\)\)|[^)]*)\)/g, " $1 ");
  text = text.replace(/#?\[\[/g, "[[");
  for (let pass = 0; pass < 3 && text.includes("[["); pass++) text = text.replace(/\[\[([^[\]]*)\]\]/g, "$1");
  text = text.replace(/(^|\s)#([^\s#[\]()]+)/g, "$1$2");
  return text.replace(/\*\*|__|\^\^|~~|`/g, "");
}

function collapseSeparators(text) {
  const parts = text.replace(/\s+/g, " ").trim().split(/(?:^|\s)[;·](?=\s|$)/).map((p) => p.trim()).filter(Boolean);
  return parts.join(" · ");
}

function blockText(uid, resolveBlock) {
  if (typeof resolveBlock !== "function") return "";
  let string;
  try { string = resolveBlock(uid); } catch { return ""; }
  if (typeof string !== "string" || /^\s*\{\{/.test(string)) return "";
  const plain = collapseSeparators(stripMarkup(string.replace(/\(\([\w-]+\)\)/g, " ")));
  return plain.slice(0, MAX_REF_TEXT).trim();
}

// Plain one-line text of a caption: markup stripped, block refs resolved through resolveBlock or dropped.
export function plainCaption(caption, resolveBlock) {
  const withRefs = String(caption ?? "").replace(/(\[[^\]]*\]\()?\(\(([\w-]+)\)\)/g, (whole, alias, uid) => (alias ? whole : ` ${blockText(uid, resolveBlock)} `));
  return collapseSeparators(stripMarkup(withRefs));
}

export function regionLabel(input) {
  try {
    const { kind, caption, drawingTitle, imageAlt, resolveBlock } = input || {};
    const own = plainCaption(caption, resolveBlock);
    if (own && own !== PLACEHOLDER_REGION) return cut(own, MAX_LABEL);
    const image = isImageKind(kind);
    if (image) {
      const alt = collapseSeparators(stripMarkup(imageAlt));
      if (alt) return cut(alt, MAX_LABEL);
    }
    const title = collapseSeparators(stripMarkup(drawingTitle)) || (image ? "Image" : "Drawing");
    return cut(`${title} · ${KIND_WORDS[kind] || "region"}`, MAX_LABEL);
  } catch {
    return "Drawing · region";
  }
}

export function imageAltAt(blockString, index) {
  try {
    return parseImageRefs(blockString).find((r) => r.index === index)?.alt.trim() || null;
  } catch {
    return null;
  }
}

const DRAWING_RE = /\{\{\s*(?:\[\[excalidraw\]\]|excalidraw)\s*\}\}/;

// Name of the drawing an owner block holds. pageTitle is passed only when the owner sits directly on a page.
export function drawingTitleOf(ownerString, pageTitle) {
  try {
    const page = collapseSeparators(stripMarkup(pageTitle));
    if (page) return cut(page, MAX_TITLE);
    const string = String(ownerString ?? "");
    if (DRAWING_RE.test(string)) {
      const info = /Text elements in drawing:\s*([^;}]*)/.exec(string);
      const first = info ? collapseSeparators(stripMarkup(info[1])) : "";
      return first ? cut(first, MAX_TITLE) : "Drawing";
    }
    const plain = collapseSeparators(stripMarkup(string.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")));
    return plain ? cut(plain, MAX_TITLE) : "Image";
  } catch {
    return "Drawing";
  }
}
