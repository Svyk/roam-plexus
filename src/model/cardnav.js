import { embedAnchors, parseEmbedRef } from "./embeds.js";
import { nearestInDirection } from "./mindmap.js";
import { elementBounds, liveElements } from "./scene.js";

function namedIds(region) {
  if (!region || region.supported !== true) return [];
  if (region.kind === "area") return Array.isArray(region.ids) ? region.ids : [];
  if (region.kind === "rect" || region.kind === "poly") return region.el == null ? [] : [region.el];
  if (region.kind === "frame" || region.kind === "cframe") return region.frameId == null ? [] : [region.frameId];
  return [];
}

function lowestRegionUid(regions) {
  const byId = new Map();
  if (!Array.isArray(regions)) return byId;
  for (const row of regions) {
    const uid = row?.uid;
    if (typeof uid !== "string") continue;
    for (const id of namedIds(row.region)) {
      const prev = byId.get(id);
      if (prev === undefined || uid < prev) byId.set(id, uid);
    }
  }
  return byId;
}

function boxOf(el) {
  const b = elementBounds(el);
  const x = b[0];
  const y = b[1];
  const width = b[2] - b[0];
  const height = b[3] - b[1];
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { x, y, width, height };
}

function blockOf(el, regionUid) {
  if (regionUid != null) return regionUid;
  const ref = parseEmbedRef(el?.customData?.plexus?.embed);
  return ref?.kind === "block" ? ref.uid : null;
}

// One record per live anchor, ordered by element id.
export function collectAnchors(elements, regions) {
  const named = lowestRegionUid(regions);
  const embeds = new Set(embedAnchors(elements));
  const byId = new Map();
  for (const el of liveElements(elements)) {
    if (el.id == null || byId.has(el.id)) continue;
    const regionUid = named.has(el.id) ? named.get(el.id) : null;
    const anchor = embeds.has(el) || el.type === "frame" || el.type === "magicframe" || regionUid != null;
    if (!anchor) continue;
    const box = boxOf(el);
    if (!box) continue;
    byId.set(el.id, { id: el.id, ...box, blockUid: blockOf(el, regionUid), regionUid });
  }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// Id of the nearest anchor in the 90-degree cone, or null.
export function nextAnchorId(anchors, id, dir) {
  if (!Array.isArray(anchors)) return null;
  const from = anchors.find((a) => a && a.id === id);
  if (!from) return null;
  return nearestInDirection(from, anchors, dir);
}

// Live frameId when that frame is itself a live anchor; else null.
export function parentAnchorId(anchors, elements, id) {
  const live = liveElements(elements);
  const el = live.find((e) => e.id === id);
  if (!el || el.frameId == null) return null;
  const frame = live.find((e) => e.id === el.frameId);
  if (!frame) return null;
  const ids = new Set(Array.isArray(anchors) ? anchors.map((a) => a && a.id) : []);
  return ids.has(frame.id) ? frame.id : null;
}
