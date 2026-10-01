import { commonBounds } from "./scene.js";
import { createBuilder } from "./build.js";

export const STICKY_FILL = "#fff3bf";
export const STACK_GAP = 16;

// Next canvas stamp: one more than the largest whole number already written as text, or 1.
export function nextStampNumber(elements) {
  let max = 0;
  for (const el of Array.isArray(elements) ? elements : []) {
    if (!el || el.isDeleted || el.type !== "text") continue;
    const raw = String(el.originalText ?? el.text ?? "").trim();
    if (!/^[1-9]\d*$/.test(raw)) continue;
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n > max) max = Number.isSafeInteger(n) ? n : max;
  }
  return (Number.isSafeInteger(max) ? max : 0) + 1;
}

function leavesSelection(el, ids) {
  if (!el || el.type !== "arrow") return false;
  const ends = [el.startBinding?.elementId, el.endBinding?.elementId].filter(Boolean);
  return ends.some((id) => !ids.has(id));
}

// One copy of the selection, shifted down by its height plus the gap. Arrows bound outside the selection are dropped.
export function stackCopies(elements, selectedIds, { newId, gap = STACK_GAP } = {}) {
  if (typeof newId !== "function") return null;
  const ids = new Set(Array.isArray(selectedIds) ? selectedIds : []);
  const live = (Array.isArray(elements) ? elements : []).filter((el) => el && !el.isDeleted && ids.has(el.id));
  const keep = live.filter((el) => !leavesSelection(el, ids));
  if (!keep.length) return null;
  const b = commonBounds(keep);
  if (!b) return null;
  const dy = (b[3] - b[1]) + gap;
  const used = new Set((Array.isArray(elements) ? elements : []).map((el) => el?.id).filter(Boolean));
  const fresh = () => {
    for (let i = 0; i < 8; i += 1) {
      const id = String(newId() ?? "");
      if (id && !used.has(id)) {
        used.add(id);
        return id;
      }
    }
    const id = `plxstack${used.size}`;
    used.add(id);
    return id;
  };
  const idMap = new Map();
  const groups = new Map();
  for (const el of keep) idMap.set(el.id, fresh());
  const mapGroup = (g) => {
    if (!groups.has(g)) groups.set(g, fresh());
    return groups.get(g);
  };
  return keep.map((el) => {
    const copy = structuredClone(el);
    copy.id = idMap.get(el.id);
    copy.y = (Number(copy.y) || 0) + dy;
    if (copy.containerId) copy.containerId = idMap.get(copy.containerId) ?? null;
    if (Array.isArray(copy.boundElements)) {
      copy.boundElements = copy.boundElements
        .filter((entry) => entry && idMap.has(entry.id))
        .map((entry) => ({ ...entry, id: idMap.get(entry.id) }));
    }
    for (const key of ["startBinding", "endBinding"]) {
      if (copy[key]?.elementId) {
        const nid = idMap.get(copy[key].elementId);
        copy[key] = nid ? { ...copy[key], elementId: nid } : null;
      }
    }
    if (Array.isArray(copy.groupIds) && copy.groupIds.length) copy.groupIds = copy.groupIds.map(mapGroup);
    copy.version = (Number(copy.version) || 1) + 1;
    return copy;
  });
}

export function stickyElements({ x = 0, y = 0, newId, measure } = {}) {
  const b = createBuilder({
    newId,
    measure,
    style: { backgroundColor: STICKY_FILL, fillStyle: "solid", strokeColor: "#1e1e1e", roughness: 0 },
  });
  b.box("Note", {
    x, y, backgroundColor: STICKY_FILL, strokeColor: "#1e1e1e", roughness: 0, minWidth: 200, minHeight: 140,
  });
  return b.elements();
}

export function stampElements({ x = 0, y = 0, n = 1, newId, measure } = {}) {
  const b = createBuilder({ newId, measure, style: { strokeColor: "#1e1e1e" } });
  b.text(x, y, String(n));
  return b.elements();
}
