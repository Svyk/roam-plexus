import { elementBounds, liveElements, regionSceneBBox } from "./scene.js";

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

const orderOf = (el) => {
  const o = el?.customData?.plexus?.order;
  return typeof o === "number" && Number.isFinite(o) ? o : null;
};

export function orderFrames(elements) {
  const frames = liveElements(elements).filter((el) => el.type === "frame" || el.type === "magicframe");
  return frames.sort((a, b) => {
    const oa = orderOf(a), ob = orderOf(b);
    if (oa !== null && ob !== null) {
      if (oa !== ob) return oa - ob;
    } else if (oa !== null) return -1;
    else if (ob !== null) return 1;
    const n = collator.compare(String(a.name ?? ""), String(b.name ?? ""));
    if (n) return n;
    return (Number(a.y) || 0) - (Number(b.y) || 0) || (Number(a.x) || 0) - (Number(b.x) || 0);
  });
}

export function stepOf(el) {
  const n = el?.customData?.plexus?.step;
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export function occludeOf(el) {
  const v = el?.customData?.plexus?.occlude;
  return typeof v === "string" && v.length > 0 ? v : null;
}

const idMap = (elements) => new Map(liveElements(elements).map((el) => [el.id, el]));

function effectiveStep(el, byId) {
  const own = stepOf(el);
  if (own !== null) return own;
  const parent = el?.containerId ? byId.get(el.containerId) : null;
  return parent ? stepOf(parent) : null;
}

export function frameMembers(elements, frameId) {
  if (!frameId) return [];
  return liveElements(elements).filter((el) => el.frameId === frameId && el.id !== frameId);
}

export function maxBuild(elements, frame) {
  const byId = idMap(elements);
  let max = 0;
  for (const el of frameMembers(elements, frame?.id)) {
    const s = effectiveStep(el, byId);
    if (s !== null && s > max) max = s;
  }
  return max;
}

export function nextStep(elements, frameId) {
  let max = 0;
  for (const el of frameMembers(elements, frameId)) {
    const s = stepOf(el);
    if (s !== null && s > max) max = s;
  }
  return max + 1;
}

export function idsForBuild(elements, frame, build) {
  if (!frame?.id) return [];
  const live = liveElements(elements);
  const byId = idMap(elements);
  const b = Number.isInteger(build) && build >= 0 ? build : 0;
  const members = frameMembers(elements, frame.id);
  const later = members.some((el) => {
    const s = effectiveStep(el, byId);
    return s !== null && s > b;
  });
  const ids = [];
  if (!later && live.some((el) => el.id === frame.id)) ids.push(frame.id);
  for (const el of members) {
    const s = effectiveStep(el, byId);
    if (s === null || s <= b) ids.push(el.id);
  }
  return ids;
}

export function hiddenIds(elements, frame, build) {
  const byId = idMap(elements);
  const b = Number.isInteger(build) && build >= 0 ? build : 0;
  return frameMembers(elements, frame?.id).filter((el) => {
    const s = effectiveStep(el, byId);
    return s !== null && s > b;
  }).map((el) => el.id);
}

export function buildTier(build, stepped, kind = "svg") {
  if (!stepped) return kind;
  const b = Number.isInteger(build) && build >= 0 ? build : 0;
  return `${kind}-b${b}`;
}

export function occluderIds(elements, regionUid) {
  if (!regionUid) return [];
  return liveElements(elements).filter((el) => occludeOf(el) === regionUid).map((el) => el.id);
}

export function idsWithoutOccluders(ids, elements, regionUid) {
  const drop = new Set(occluderIds(elements, regionUid));
  for (const el of liveElements(elements)) if (el.containerId && drop.has(el.containerId)) drop.add(el.id);
  return (ids || []).filter((id) => !drop.has(id));
}

export function coverBoxes(elements, ids, bbox) {
  if (!bbox) return [];
  const [bx, by, bx2, by2] = bbox;
  const bw = bx2 - bx;
  const bh = by2 - by;
  if (!(bw > 0) || !(bh > 0)) return [];
  const set = new Set(ids || []);
  const out = [];
  for (const el of liveElements(elements)) {
    if (!set.has(el.id)) continue;
    const [x1, y1, x2, y2] = elementBounds(el);
    const left = (x1 - bx) / bw;
    const top = (y1 - by) / bh;
    const right = (x2 - bx) / bw;
    const bottom = (y2 - by) / bh;
    const x = Math.max(0, left);
    const y = Math.max(0, top);
    const w = Math.min(1, right) - x;
    const h = Math.min(1, bottom) - y;
    if (w > 0 && h > 0) out.push({ x, y, w, h });
  }
  return out;
}

export function containingRegion(entries, elements, appState, box) {
  if (!box) return null;
  let best = null;
  let area = Infinity;
  for (const entry of entries || []) {
    if (!entry?.region?.supported) continue;
    const hit = regionSceneBBox(entry.region, elements, appState);
    if (!hit?.bbox) continue;
    const [x1, y1, x2, y2] = hit.bbox;
    if (box[0] < x1 || box[1] < y1 || box[2] > x2 || box[3] > y2) continue;
    const a = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    if (a < area) { area = a; best = entry; }
  }
  return best;
}

export function patchPlexus(el, patch) {
  const base = el?.customData && typeof el.customData === "object" ? el.customData : {};
  const plexus = { ...(base.plexus && typeof base.plexus === "object" ? base.plexus : {}) };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value == null) delete plexus[key];
    else plexus[key] = value;
  }
  const customData = { ...base };
  if (Object.keys(plexus).length) customData.plexus = plexus;
  else delete customData.plexus;
  return {
    ...el,
    customData,
    version: (Number(el?.version) || 0) + 1,
    versionNonce: (Number(el?.versionNonce) || 0) + 1,
  };
}
