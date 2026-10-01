import { parseEmbedRef } from "./embeds.js";
import { liveElements } from "./scene.js";

export const APP_STATE_KEYS = ["viewBackgroundColor", "gridSize"];
export const LINKS_MARK = "{{[[plexus-links]]}}";
export const EXPORT_MARK = "{{[[plexus-export]]}}";

const REF_RE = /\[\[([^\]\n]+)\]\]|\(\(([A-Za-z0-9_-]{9})\)\)/g;

export function sceneDocument({ elements, appState, files } = {}) {
  const src = appState && typeof appState === "object" ? appState : {};
  const state = {};
  for (const key of APP_STATE_KEYS) {
    if (src[key] != null) state[key] = src[key];
  }
  const list = liveElements(elements);
  const fileMap = files && typeof files === "object" && !Array.isArray(files) ? files : {};
  return {
    type: "excalidraw",
    version: 2,
    source: "roam-plexus",
    elements: list,
    appState: state,
    files: fileMap,
  };
}

export function parseSceneDocument(raw) {
  let data = raw;
  if (typeof raw === "string") {
    try { data = JSON.parse(raw); } catch { return null; }
  }
  if (!data || typeof data !== "object" || data.type !== "excalidraw" || !Array.isArray(data.elements)) return null;
  return data;
}

export function elementsToAdd(elements) {
  return liveElements(elements).filter((el) => el.type !== "image");
}

export function tagName(raw) {
  const name = String(raw ?? "").trim().replace(/^#/, "").replace(/^\[\[/, "").replace(/\]\]$/, "").trim();
  if (!name || /[\n\[\]()]/.test(name)) return "";
  return name;
}

export function tagToken(raw) {
  const name = tagName(raw);
  return name ? `#[[${name}]]` : "";
}

export function appendTagText(text, raw) {
  const token = tagToken(raw);
  const src = String(text ?? "");
  if (!token) return src;
  if (src.includes(token)) return src;
  return src.trim() ? `${src.trim()} ${token}` : token;
}

export function textHasTag(text, raw) {
  const token = tagToken(raw);
  return !!token && String(text ?? "").includes(token);
}

export function elementText(el) {
  if (!el || typeof el !== "object") return "";
  if (typeof el.originalText === "string") return el.originalText;
  return typeof el.text === "string" ? el.text : "";
}

export function taggedElementIds(elements, raw) {
  const ids = [];
  for (const el of liveElements(elements)) {
    if (el.type === "text" && textHasTag(elementText(el), raw)) ids.push(el.id);
  }
  return ids;
}

function pushRef(out, ref, skipUid) {
  if (!ref || ref === skipUid) return;
  if (out.includes(ref)) return;
  out.push(ref);
}

function refsInText(text, out, skipUid) {
  const src = String(text ?? "").replace(/\{\{[\s\S]*?\}\}/g, " ");
  REF_RE.lastIndex = 0;
  let m;
  while ((m = REF_RE.exec(src))) {
    if (m[1] && m[1].trim()) pushRef(out, `[[${m[1].trim()}]]`, skipUid);
    else if (m[2]) pushRef(out, `((${m[2]}))`, skipUid);
  }
}

export function collectTargets({ elements, regions, drawingUid } = {}) {
  const out = [];
  const skip = typeof drawingUid === "string" ? `((${drawingUid}))` : "";
  for (const el of liveElements(elements)) {
    const embed = parseEmbedRef(el?.customData?.plexus?.embed);
    if (embed?.kind === "block") pushRef(out, `((${embed.uid}))`, skip);
    else if (embed?.kind === "page") pushRef(out, `[[${embed.title}]]`, skip);
    if (el.type === "text") refsInText(elementText(el), out, skip);
    if (typeof el.link === "string") refsInText(el.link, out, skip);
  }
  for (const region of Array.isArray(regions) ? regions : []) {
    if (region?.uid && region.uid !== drawingUid) pushRef(out, `((${region.uid}))`, skip);
    refsInText(region?.string, out, skip);
  }
  return out;
}

export function linkPlan({ children, markChildren, targets } = {}) {
  const kids = Array.isArray(children) ? children : [];
  const mark = kids.find((child) => child?.string === LINKS_MARK) || null;
  const want = [];
  for (const ref of Array.isArray(targets) ? targets : []) pushRef(want, ref, "");
  if (!want.length) {
    if (!mark?.uid) return { action: "none" };
    return { action: "delete", markUid: mark.uid };
  }
  if (!mark?.uid) return { action: "create", refs: want };
  const have = (Array.isArray(markChildren) ? markChildren : []).map((child) => child?.string);
  if (have.length === want.length && want.every((ref, i) => have[i] === ref)) {
    return { action: "none", markUid: mark.uid };
  }
  return { action: "update", markUid: mark.uid, refs: want };
}

export function exportPlan({ children, markChildren, hash } = {}) {
  const kids = Array.isArray(children) ? children : [];
  const mark = kids.find((child) => child?.string === EXPORT_MARK) || null;
  if (!mark?.uid) return { action: "skip" };
  const nested = Array.isArray(markChildren) ? markChildren : [];
  const image = nested.find((child) => typeof child?.string === "string" && child.string.startsWith("![")) || null;
  const hashChild = nested.find((child) => child && child !== image && typeof child.string === "string" && child.string.startsWith("`")) || null;
  const stored = hashChild ? hashChild.string.replace(/`/g, "").trim() : "";
  const next = String(hash ?? "");
  if (stored && stored === next) return { action: "skip", markUid: mark.uid };
  const oldUrl = image ? (/!\[[^\]]*\]\(([^)]+)\)/.exec(image.string)?.[1] || "") : "";
  return {
    action: "update",
    markUid: mark.uid,
    imageUid: image?.uid || null,
    hashUid: hashChild?.uid || null,
    oldUrl,
    hash: next,
  };
}
