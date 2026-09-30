const URL_RE = /^https:\/\/roamresearch\.com\/#\/app\/([^/?#]+)\/page\/([A-Za-z0-9_-]+)\/?$/;

// Pure. Returns {type:"page", title} | {type:"block", uid} | {type:"page", uid} (same-graph URL; the host resolves page vs block) | null.
export function parseRoamLink(link, graphName) {
  if (typeof link !== "string") return null;
  const s = link.trim();
  if (!s) return null;
  let m = /^\[\[([^\]\n]+)\]\]$/.exec(s) || /^#\[\[([^\]\n]+)\]\]$/.exec(s);
  if (m) return { type: "page", title: m[1] };
  m = /^#([^\s[\]#()]+)$/.exec(s);
  if (m) return { type: "page", title: m[1] };
  m = /^\(\(([A-Za-z0-9_-]+)\)\)$/.exec(s);
  if (m) return { type: "block", uid: m[1] };
  m = URL_RE.exec(s);
  if (m) {
    let graph;
    try { graph = decodeURIComponent(m[1]); } catch { return null; }
    if (graphName && graph === graphName) return { type: "page", uid: m[2] };
  }
  return null;
}

const LINK_UID_RE = /^[A-Za-z0-9_-]+$/;
const MAX_LINKS = 200;
const MAX_LINK_TEXT = 80;

function cutLinkText(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return [...text].slice(0, MAX_LINK_TEXT).join("");
}

function boundText(el, elements) {
  if (!el?.id || !Array.isArray(elements)) return "";
  for (const child of elements) {
    if (!child || child.isDeleted || child.type !== "text" || child.containerId !== el.id) continue;
    const text = cutLinkText(child.originalText ?? child.text);
    if (text) return text;
  }
  return "";
}

function mindRef(el) {
  const mm = el?.customData?.plexus?.mm;
  if (!mm || typeof mm !== "object") return null;
  if (mm.edge || mm.boundary) return false;
  const uid = mm.uid;
  if (typeof uid !== "string" || !LINK_UID_RE.test(uid)) return null;
  return { kind: "mindmap", ref: `((${uid}))` };
}

function roamRef(value, kind) {
  const parsed = parseRoamLink(value);
  if (!parsed) return null;
  if (parsed.type === "block" && parsed.uid) return { kind, ref: `((${parsed.uid}))` };
  if (parsed.type === "page" && parsed.title) return { kind, ref: `[[${parsed.title}]]` };
  return null;
}

// One row per live element that points at a Roam ref: mind-map node, embed, or element link.
export function linksIn(elements) {
  if (!Array.isArray(elements)) return [];
  const out = [];
  const seen = new Set();
  for (const el of elements) {
    if (!el || el.isDeleted) continue;
    const mind = mindRef(el);
    if (mind === false) continue;
    const embed = roamRef(el?.customData?.plexus?.embed, "embed");
    const hit = mind || embed || roamRef(el.link, "link");
    if (!hit) continue;
    const key = `${hit.kind}\n${hit.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const own = cutLinkText(el.originalText ?? el.text);
    out.push({
      elementId: el.id,
      kind: hit.kind,
      ref: hit.ref,
      text: own || boundText(el, elements),
    });
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}
