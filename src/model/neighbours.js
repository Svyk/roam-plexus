// One-card neighbourhood: cap, skip, and the elements expand adds. No scene writes.
import { baseElement, embedLabel, makeEmbedAnchor, parseEmbedRef } from "./embeds.js";
import { layoutTree } from "./mindmap.js";

const CARD_W = 200;
const CARD_H = 72;

export const EXPAND_ROLES = Object.freeze({
  backlinks: { key: ":block/_refs", label: "backlink", pull: "[:block/uid {:block/_refs [:block/uid :block/string :node/title]}]" },
  children: { key: ":block/children", label: "child", pull: "[:block/uid {:block/children [:block/uid :block/string :node/title]}]" },
  refs: { key: ":block/refs", label: "ref", pull: "[:block/uid {:block/refs [:block/uid :block/string :node/title]}]" },
  parents: { key: ":block/parents", label: "parent", pull: "[:block/uid {:block/parents [:block/uid :block/string :node/title]}]" },
});

function roamOf(value) {
  const parsed = parseEmbedRef(value);
  if (!parsed || (parsed.kind !== "block" && parsed.kind !== "page")) return null;
  return parsed;
}

export function cardElement(el, byId) {
  if (!el || el.isDeleted) return null;
  const node = el.type === "text" && el.containerId ? byId?.get(el.containerId) : el;
  if (!node || node.isDeleted || node.type === "text" || node.type === "arrow") return null;
  const mm = node.customData?.plexus?.mm;
  if (mm && typeof mm === "object" && !mm.edge && !mm.boundary && typeof mm.uid === "string" && mm.uid) return node;
  if (node.type !== "rectangle") return null;
  if (roamOf(node.customData?.plexus?.embed) || roamOf(node.link)) return node;
  return null;
}

export function cardTarget(el, byId) {
  const node = cardElement(el, byId);
  if (!node) return null;
  const mm = node.customData?.plexus?.mm;
  if (mm && typeof mm === "object" && !mm.edge && !mm.boundary && typeof mm.uid === "string" && mm.uid) {
    return { uid: mm.uid, title: null, kind: "block", elementId: node.id };
  }
  const parsed = roamOf(node.customData?.plexus?.embed) || roamOf(node.link);
  if (!parsed) return null;
  if (parsed.kind === "page") return { uid: null, title: parsed.title, kind: "page", elementId: node.id };
  return { uid: parsed.uid, title: null, kind: "block", elementId: node.id };
}

export function selectedCard(elements, selectedIds) {
  const list = elements || [];
  const byId = new Map(list.filter(Boolean).map((el) => [el.id, el]));
  const ids = selectedIds || [];
  if (!ids.length) return null;
  let element = null;
  for (const id of ids) {
    const resolved = cardElement(byId.get(id), byId);
    if (!resolved) return null;
    if (!element) element = resolved;
    else if (element.id !== resolved.id) return null;
  }
  const target = cardTarget(element, byId);
  return target ? { element, target } : null;
}

export function presentUids(elements, pageUidOf = () => null) {
  const list = elements || [];
  const byId = new Map(list.filter(Boolean).map((el) => [el.id, el]));
  const set = new Set();
  for (const el of list) {
    const target = cardTarget(el, byId);
    if (!target) continue;
    if (target.uid) set.add(target.uid);
    if (target.title) {
      const uid = pageUidOf(target.title);
      if (uid) set.add(uid);
    }
  }
  return set;
}

export function neighbourRows(raw, key) {
  const value = raw?.[key];
  const items = Array.isArray(value) ? value : value ? [value] : [];
  const rows = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const uid = item[":block/uid"];
    if (typeof uid !== "string" || !uid) continue;
    const title = item[":node/title"];
    const string = item[":block/string"] ?? "";
    const named = title != null && String(title).trim() !== "";
    rows.push({
      uid,
      title: named ? String(title) : null,
      string: String(string),
      label: named ? String(title) : (embedLabel(string) || uid),
    });
  }
  return rows;
}

export function chooseNeighbours(rows, present, cap = 12) {
  const have = present instanceof Set ? present : new Set(present || []);
  const seen = new Set();
  const eligible = [];
  for (const row of rows || []) {
    const uid = row?.uid;
    if (!uid || have.has(uid) || seen.has(uid)) continue;
    seen.add(uid);
    eligible.push(row);
  }
  const limit = Number.isFinite(cap) && cap >= 0 ? cap : 12;
  return { picked: eligible.slice(0, limit), total: eligible.length };
}

export function expandElements({ source, rows, role, newId } = {}) {
  if (!source?.id || !rows?.length) return [];
  const rootUid = source.uid || source.id;
  const tree = {
    uid: rootUid,
    open: true,
    children: rows.map((row) => ({ uid: row.uid, open: true, children: [] })),
  };
  const sizes = { [rootUid]: { width: source.width || CARD_W, height: source.height || CARD_H } };
  for (const row of rows) sizes[row.uid] = { width: CARD_W, height: CARD_H };
  const pos = layoutTree({
    tree,
    sizes,
    layout: "right",
    root: { x: source.x || 0, y: source.y || 0 },
  });
  let n = 0;
  const seq = typeof newId === "function" ? newId : () => `plxexp${n++}`;
  const elements = [];
  for (const row of rows) {
    const at = pos[row.uid];
    if (!at) continue;
    const ref = row.title ? `[[${row.title}]]` : `((${row.uid}))`;
    const [rect, text] = makeEmbedAnchor({
      ref,
      label: row.label || row.uid,
      x: at.x,
      y: at.y,
      width: CARD_W,
      height: CARD_H,
      idPrefix: "plxnb-",
    });
    const arrowId = String(seq());
    const labelId = String(seq());
    const x1 = (source.x || 0) + (source.width || CARD_W);
    const y1 = (source.y || 0) + (source.height || CARD_H) / 2;
    const x2 = rect.x;
    const y2 = rect.y + rect.height / 2;
    const arrow = baseElement(arrowId, "arrow", x1, y1, Math.max(1, x2 - x1), Math.max(1, Math.abs(y2 - y1)));
    Object.assign(arrow, {
      points: [[0, 0], [x2 - x1, y2 - y1]],
      lastCommittedPoint: null,
      startBinding: { elementId: source.id, focus: 0, gap: 4 },
      endBinding: { elementId: rect.id, focus: 0, gap: 4 },
      startArrowhead: null,
      endArrowhead: "arrow",
      elbowed: false,
      boundElements: [{ id: labelId, type: "text" }],
    });
    const label = baseElement(labelId, "text", (x1 + x2) / 2, (y1 + y2) / 2, 48, 20);
    Object.assign(label, {
      text: role || "",
      originalText: role || "",
      fontSize: 16,
      fontFamily: 1,
      textAlign: "center",
      verticalAlign: "middle",
      containerId: arrowId,
      autoResize: true,
      lineHeight: 1.25,
    });
    rect.boundElements = [...(rect.boundElements || []), { id: arrowId, type: "arrow" }];
    elements.push(rect, text, arrow, label);
  }
  return elements;
}

export function appendExpanded(current, added) {
  const extra = new Map();
  for (const el of added || []) {
    if (el?.type !== "arrow") continue;
    for (const end of [el.startBinding, el.endBinding]) {
      if (!end?.elementId) continue;
      const list = extra.get(end.elementId) || [];
      list.push({ id: el.id, type: "arrow" });
      extra.set(end.elementId, list);
    }
  }
  const patch = (el) => {
    const more = el && extra.get(el.id);
    if (!more) return el;
    return {
      ...el,
      boundElements: [...(el.boundElements || []), ...more],
      version: (el.version || 0) + 1,
    };
  };
  return [...(current || []).map(patch), ...(added || []).map(patch)];
}
