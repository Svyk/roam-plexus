import { liveElements } from "./scene.js";
import { orderFrames } from "./slides.js";
import { parseEmbedRef } from "./embeds.js";

const isFrame = (el) => el.type === "frame" || el.type === "magicframe";
const mmOf = (el) => el?.customData?.plexus?.mm;
const isProjection = (el) => typeof el?.id === "string" && el.id.startsWith("pmm-");

// today: the page title of today's date ("September 30th, 2026"), or a Date / ISO string as a fallback.
function todayTitle(today) {
  if (typeof today === "string" && today) return today;
  const d = today instanceof Date ? today : today != null ? new Date(today) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : "today";
}

const cleanText = (s) => String(s ?? "").replace(/\r\n?/g, "\n").replace(/^\n+|\n+$/g, "").trim();

// One item string per element, or null when the element contributes nothing. Pure.
function itemString(el, textOf, today) {
  const plexus = el.customData?.plexus;
  if (typeof plexus?.embed === "string") {
    const ref = parseEmbedRef(plexus.embed);
    if (!ref) return plexus.embed.trim() || null;
    return ref.kind === "today" ? `[[${todayTitle(today)}]]` : ref.ref;
  }
  if (el.type === "image") {
    const url = el.customData?.firebaseUrl;
    if (typeof url !== "string" || !url) return null;
    return appendLink(`![](${url})`, el.link, today);
  }
  const text = cleanText(textOf(el));
  if (!text) return null;
  return appendLink(text, el.link, today);
}

function appendLink(text, link, today) {
  if (typeof link !== "string" || !link.trim()) return text;
  const raw = link.trim();
  const ref = parseEmbedRef(raw);
  const add = ref ? (ref.kind === "today" ? `[[${todayTitle(today)}]]` : ref.ref) : raw;
  if (text.includes(add) || text.includes(raw)) return text;
  return `${text} ${add}`;
}

// Reading order: by top y; items whose vertical centres lie within half the smaller height of the row's first item
// share a row, and a row sorts by x. Returns a new array.
function readingOrder(items) {
  const byTop = [...items].sort((a, b) => (a.y - b.y) || (a.x - b.x) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const out = [];
  let row = [];
  let anchor = null;
  const flush = () => {
    row.sort((a, b) => (a.x - b.x) || (a.y - b.y) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    out.push(...row);
    row = [];
  };
  for (const it of byTop) {
    if (anchor && Math.abs(it.cy - anchor.cy) <= 0.5 * Math.min(it.h, anchor.h)) {
      row.push(it);
      continue;
    }
    flush();
    anchor = it;
    row.push(it);
  }
  flush();
  return out;
}

// Kahn per bucket over the arrows whose two ends are both items of the bucket. Returns nested nodes.
function buildBucket(items, edges) {
  if (!items.length) return [];
  const ordered = readingOrder(items);
  const ids = new Set(items.map((i) => i.id));
  const byId = new Map(items.map((i) => [i.id, i]));
  // incoming[v] = Set of sources; deduped, self loops dropped.
  const incoming = new Map(items.map((i) => [i.id, new Set()]));
  for (const [from, to] of edges) {
    if (from === to || !ids.has(from) || !ids.has(to)) continue;
    incoming.get(to).add(from);
  }
  const emitted = new Set();
  const topo = [];
  const kept = new Map(items.map((i) => [i.id, new Set()]));
  const remaining = new Set(ids);
  while (remaining.size) {
    let pick = null;
    for (const it of ordered) {
      if (!remaining.has(it.id)) continue;
      let open = false;
      for (const src of incoming.get(it.id)) if (!emitted.has(src)) { open = true; break; }
      if (!open) { pick = it; break; }
    }
    if (!pick) {
      pick = ordered.find((it) => remaining.has(it.id));
      // A cycle: drop this item's incoming edges from items not yet emitted.
      for (const src of [...incoming.get(pick.id)]) if (!emitted.has(src)) incoming.get(pick.id).delete(src);
    }
    for (const src of incoming.get(pick.id)) kept.get(pick.id).add(src);
    remaining.delete(pick.id);
    emitted.add(pick.id);
    topo.push(pick.id);
  }
  const nodes = new Map(topo.map((id) => [id, { string: byId.get(id).string, heading: 0, children: [] }]));
  const roots = [];
  for (const id of topo) {
    const srcs = kept.get(id);
    if (srcs.size === 1) nodes.get([...srcs][0]).children.push(nodes.get(id));
    else roots.push(nodes.get(id));
  }
  return roots;
}

const countNodes = (nodes) => nodes.reduce((n, node) => n + 1 + countNodes(node.children), 0);

// elements: the drawing's elements (deleted ones are ignored). selection: an array/Set of element ids limits the
// outline to those elements (a bound text maps to its container, a frame brings its children); null means all.
// Returns { nodes: [{ string, heading, children }], count }; count includes headings.
export function elementsToOutline(elements, { selection = null, today } = {}) {
  const live = liveElements(elements);
  const frames = orderFrames(live);
  const frameIds = new Set(frames.map((f) => f.id));
  const frameName = new Map(frames.map((f, i) => [f.id, String(f.name ?? "").trim() || `Frame ${i + 1}`]));
  const byId = new Map(live.map((el) => [el.id, el]));

  const boundText = new Map(); // container id -> bound text element
  for (const el of live) {
    if (el.type === "text" && el.containerId && byId.has(el.containerId)) boundText.set(el.containerId, el);
  }
  // element id -> item id (a bound text maps to its container)
  const itemIdOf = (id) => {
    const el = byId.get(id);
    if (!el) return null;
    if (el.type === "text" && el.containerId && byId.has(el.containerId)) return el.containerId;
    return el.id;
  };

  let allowed = null;
  let selectedFrames = new Set();
  if (selection != null) {
    allowed = new Set();
    const ids = [...selection];
    for (const id of ids) {
      const el = byId.get(id);
      if (!el) continue;
      if (isFrame(el)) {
        selectedFrames.add(el.id);
        for (const child of live) if (child.frameId === el.id) allowed.add(itemIdOf(child.id));
      } else {
        allowed.add(itemIdOf(id));
      }
    }
  }

  const items = [];
  const mapSeen = new Set();
  for (const el of live) {
    if (isFrame(el) || el.type === "arrow" || el.type === "line") continue;
    if (el.type === "text" && el.containerId && byId.has(el.containerId)) continue;
    if (isProjection(el)) {
      const mm = mmOf(el);
      if (!mm?.root || typeof mm.uid !== "string" || mapSeen.has(mm.uid)) continue;
      if (allowed && !allowed.has(el.id)) continue;
      mapSeen.add(mm.uid);
      items.push(makeItem(el, `((${mm.uid}))`));
      continue;
    }
    if (allowed && !allowed.has(el.id)) continue;
    const textOf = (e) => (boundText.get(e.id) ? boundText.get(e.id).originalText ?? boundText.get(e.id).text : e.type === "text" ? e.originalText ?? e.text : "");
    const string = itemString(el, textOf, today);
    if (string) items.push(makeItem(el, string));
  }

  const frameOf = (item) => (frameIds.has(item.frameId) ? item.frameId : null);
  const buckets = new Map(); // frame id | null -> items
  for (const it of items) {
    const key = frameOf(it);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(it);
  }

  // Arrows between two items of the same bucket.
  const itemById = new Map(items.map((i) => [i.id, i]));
  const edgesByBucket = new Map();
  for (const el of live) {
    if (el.type !== "arrow") continue;
    const s = el.startBinding?.elementId, e = el.endBinding?.elementId;
    if (!s || !e) continue;
    const from = itemIdOf(s), to = itemIdOf(e);
    if (!itemById.has(from) || !itemById.has(to)) continue;
    const bf = frameOf(itemById.get(from)), bt = frameOf(itemById.get(to));
    if (bf !== bt) continue;
    if (!edgesByBucket.has(bf)) edgesByBucket.set(bf, []);
    edgesByBucket.get(bf).push([from, to]);
  }

  const nodes = [];
  for (const f of frames) {
    const bucket = buckets.get(f.id) || [];
    if (allowed && !bucket.length && !selectedFrames.has(f.id)) continue;
    nodes.push({ string: frameName.get(f.id), heading: 2, children: buildBucket(bucket, edgesByBucket.get(f.id) || []) });
  }
  nodes.push(...buildBucket(buckets.get(null) || [], edgesByBucket.get(null) || []));
  return { nodes, count: countNodes(nodes) };
}

function makeItem(el, string) {
  const x = Number(el.x) || 0, y = Number(el.y) || 0;
  const w = Number(el.width) || 0, h = Number(el.height) || 0;
  return { id: el.id, frameId: el.frameId ?? null, string, x, y, w, h, cy: y + h / 2 };
}

// Roam markdown: "- " bullets, two spaces per level, "- ## Name" for frame headings. A multi-line item continues on
// lines indented under its bullet; with multiline: false its lines are joined with spaces.
export function outlineToMarkdown(tree, { multiline = true } = {}) {
  const nodes = Array.isArray(tree) ? tree : tree?.nodes || [];
  const lines = [];
  const walk = (list, depth) => {
    const pad = "  ".repeat(depth);
    for (const node of list) {
      const prefix = node.heading > 0 ? `${"#".repeat(Math.min(3, node.heading))} ` : "";
      const parts = String(node.string ?? "").split("\n");
      if (multiline) {
        lines.push(`${pad}- ${prefix}${parts[0]}`);
        for (const rest of parts.slice(1)) lines.push(`${pad}  ${rest}`);
      } else {
        lines.push(`${pad}- ${prefix}${parts.map((p) => p.trim()).filter(Boolean).join(" ")}`);
      }
      walk(node.children || [], depth + 1);
    }
  };
  walk(nodes, 0);
  return lines.join("\n");
}
