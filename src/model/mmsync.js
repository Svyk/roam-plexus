// Mind-map projection (Phase 4, unit A): element builders and the pure reconcile over (tree, markers, sizes).
import {
  BRANCH_COLORS, ROOT_COLOR, LINE_HEIGHT, PAD_X, PAD_Y, nodeSize, fontSizeForDepth, layoutTree,
  visibleNodes, countHidden, isFolded, allUids, plainText,
} from "./mindmap.js";

export const FONT_FAMILY = 5;
export const BOUNDARY_PAD = 12;
export const EDGE_GAP = 4;
const TOL = 0.5;

// ---- ids (amendment 5) ----
export const idPrefix = (root) => `pmm-${root}-`;
export const nodeId = (root, uid) => `pmm-${root}-${uid}`;
export const textId = (root, uid) => `pmm-${root}-${uid}-t`;
export const edgeId = (root, childUid) => `pmm-${root}-${childUid}-e`;
export const boundaryId = (root, uid) => `pmm-${root}-${uid}-b`;

const rnd = () => Math.floor(Math.random() * 2147483646) + 1;

export const mmOf = (el) => (el && el.customData && el.customData.plexus && el.customData.plexus.mm) || undefined;

function withMM(customData, mm) {
  const cd = customData && typeof customData === "object" ? customData : {};
  const plexus = cd.plexus && typeof cd.plexus === "object" ? cd.plexus : {};
  return { ...cd, plexus: { ...plexus, mm } };
}

function withoutMM(customData) {
  const cd = { ...customData };
  const plexus = { ...(cd.plexus || {}) };
  delete plexus.mm;
  if (Object.keys(plexus).length) cd.plexus = plexus; else delete cd.plexus;
  return Object.keys(cd).length ? cd : null;
}

export function bump(el, patch) {
  return { ...el, ...patch, version: (el.version || 0) + 1, versionNonce: rnd(), updated: Date.now() };
}

/** NEW element with customData.plexus.mm merged with `mmPatch` (Alt+L layout, Alt+P pinned, Alt+B bounds). */
export function patchMarker(el, mmPatch) {
  const next = { ...(mmOf(el) || {}), ...mmPatch };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  return bump(el, { customData: withMM(el.customData, next) });
}

function base(id, type, x, y, width, height, extra) {
  return {
    id, type, x, y, width, height,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: null,
    roundness: null,
    seed: rnd(),
    version: 1,
    versionNonce: rnd(),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    customData: undefined,
    ...extra,
  };
}

export function buildNode({ map, uid, x, y, width, height, backgroundColor, mm, boundElements }) {
  return base(nodeId(map, uid), "rectangle", x, y, width, height, {
    backgroundColor,
    roundness: { type: 3 },
    boundElements: boundElements || [],
    customData: withMM(null, mm),
  });
}

export function buildText({ map, uid, x, y, width, height, text, originalText, fontSize }) {
  return base(textId(map, uid), "text", x, y, width, height, {
    text, originalText, fontSize,
    fontFamily: 5,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: nodeId(map, uid),
    autoResize: true,
    lineHeight: LINE_HEIGHT,
  });
}

export function buildEdge({ map, parentUid, childUid, x, y, points }) {
  const [, [dx, dy]] = points;
  return base(edgeId(map, childUid), "arrow", x, y, Math.abs(dx), Math.abs(dy), {
    points,
    lastCommittedPoint: null,
    startBinding: { elementId: nodeId(map, parentUid), focus: 0, gap: EDGE_GAP },
    endBinding: { elementId: nodeId(map, childUid), focus: 0, gap: EDGE_GAP },
    startArrowhead: null,
    endArrowhead: null,
    elbowed: false,
    customData: withMM(null, { edge: [parentUid, childUid], map }),
  });
}

export function buildBoundary({ map, uid, x, y, width, height }) {
  return base(boundaryId(map, uid), "rectangle", x, y, width, height, {
    strokeStyle: "dashed",
    strokeWidth: 1,
    roundness: { type: 3 },
    customData: withMM(null, { boundary: uid, map }),
  });
}

/** Edge start point and 2-point polyline from parent and child rects {x,y,width,height}. */
export function edgeGeometry(p, c, layout) {
  let sx; let sy; let ex; let ey;
  if (layout === "right") { sx = p.x + p.width; sy = p.y + p.height / 2; ex = c.x; ey = c.y + c.height / 2; }
  else if (layout === "left") { sx = p.x; sy = p.y + p.height / 2; ex = c.x + c.width; ey = c.y + c.height / 2; }
  else if (layout === "down") { sx = p.x + p.width / 2; sy = p.y + p.height; ex = c.x + c.width / 2; ey = c.y; }
  else if (layout === "up") { sx = p.x + p.width / 2; sy = p.y; ex = c.x + c.width / 2; ey = c.y + c.height; }
  else { sx = p.x + p.width / 2; sy = p.y + p.height / 2; ex = c.x + c.width / 2; ey = c.y + c.height / 2; }
  return { x: sx, y: sy, points: [[0, 0], [ex - sx, ey - sy]] };
}

/** Bound-text origin inside a container (amendment 12, Excalidraw computeBoundTextPosition). */
export function textRect(node, textWidth, textHeight) {
  return { x: node.x + (node.width - textWidth) / 2, y: node.y + (node.height - textHeight) / 2 };
}

/** Sizer from a measurer(str, fontSize) -> width: (text, fontSize) -> nodeSize. */
export const makeSizer = (measure) => (text, fontSize) => nodeSize(text, fontSize, measure);

// ---- reconcile ----

const close = (a, b) => Math.abs((a ?? 0) - (b ?? 0)) <= TOL;
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
const same = (a, b) => stable(a) === stable(b);

function mergeBound(existing, prefix, desired) {
  const want = new Set(desired.map((d) => d.id));
  const out = [];
  const seen = new Set();
  for (const b of Array.isArray(existing) ? existing : []) {
    if (!b || typeof b.id !== "string") continue;
    if (b.id.startsWith(prefix)) {
      if (!want.has(b.id) || seen.has(b.id)) continue;
      seen.add(b.id);
    }
    out.push(b);
  }
  for (const d of desired) if (!seen.has(d.id)) out.push(d);
  return out;
}

const colorFor = (v) => (v.depth === 0 ? ROOT_COLOR : BRANCH_COLORS[v.branchIndex % BRANCH_COLORS.length]);

/**
 * Layout plan for a map given the live scene. `positions` are where unpinned nodes belong (pinned nodes keep
 * their element position), so the canvas side can compare against them to detect native drags.
 * sizes: function (text, fontSize, uid) -> nodeSize, or map uid -> nodeSize-like {width,height,...}.
 */
export function planMap({ elements, tree, sizes, layout = "right", textOf, rootPos }) {
  const root = tree.uid;
  const pre = idPrefix(root);
  const byId = new Map();
  const textByContainer = new Map();
  for (const el of elements || []) {
    if (!el || typeof el.id !== "string") continue;
    byId.set(el.id, el);
  }
  for (const el of byId.values()) {
    if (el.type !== "text" || typeof el.containerId !== "string" || !el.containerId.startsWith(pre)) continue;
    const cur = textByContainer.get(el.containerId);
    if (!cur || (cur.isDeleted && !el.isDeleted) || el.id === `${el.containerId}-t`) textByContainer.set(el.containerId, el);
  }
  const rootEl = byId.get(nodeId(root, root));
  const rootMM = mmOf(rootEl) || {};
  const dir = rootMM.layout || layout;
  const nodes = visibleNodes(tree);
  const uids = allUids(tree);
  const bounds = (Array.isArray(rootMM.bounds) ? rootMM.bounds : []).filter((u) => uids.has(u));
  const info = new Map();
  const sizeMap = {};
  const pinned = {};
  for (const v of nodes) {
    const n = v.node;
    const fs = fontSizeForDepth(v.depth);
    const base = textOf ? textOf(n.uid, n) : plainText(n.string, () => "…");
    const text = isFolded(n) ? `${base} (+${countHidden(n)})` : base;
    const s = typeof sizes === "function" ? { ...sizes(text, fs, n.uid) } : { ...(sizes && sizes[n.uid]) };
    if (!Array.isArray(s.lines)) s.lines = String(s.text ?? text).split("\n");
    if (s.text === undefined) s.text = s.lines.join("\n");
    if (s.textWidth === undefined) s.textWidth = s.width - 2 * PAD_X;
    if (s.textHeight === undefined) s.textHeight = s.lines.length * fs * LINE_HEIGHT;
    if (s.height === undefined) s.height = s.textHeight + 2 * PAD_Y;
    sizeMap[n.uid] = s;
    const el = byId.get(nodeId(root, n.uid));
    const mm = mmOf(el);
    if (v.depth > 0 && el && mm && mm.pinned === true) pinned[n.uid] = { x: el.x, y: el.y };
    info.set(n.uid, { fs, text, size: s, el, mm });
  }
  const anchor = rootEl && Number.isFinite(rootEl.x) ? { x: rootEl.x, y: rootEl.y } : rootPos || { x: 0, y: 0 };
  const positions = layoutTree({ tree, sizes: sizeMap, layout: dir, pinned, root: anchor });
  return { root, dir, bounds, nodes, info, positions, byId, textByContainer };
}

export function reconcile({ elements, tree, sizes, layout = "right", textOf, rootPos }) {
  const ops = { add: [], update: [], remove: [] };
  if (!tree) return ops;
  const { root, dir, bounds, nodes, info, positions, byId, textByContainer } = planMap({ elements, tree, sizes, layout, textOf, rootPos });
  const pre = idPrefix(root);
  const desiredIds = new Set();
  const patches = new Map();
  const patchOf = (id) => { if (!patches.has(id)) patches.set(id, {}); return patches.get(id); };

  // Amendment 6: copies lose the marker; nothing is deleted.
  for (const el of elements || []) {
    const mm = mmOf(el);
    if (!el || !mm || mm.map !== root) continue;
    let canon = null;
    if (mm.boundary) canon = boundaryId(root, mm.boundary);
    else if (Array.isArray(mm.edge)) canon = edgeId(root, mm.edge[1]);
    else if (mm.uid) canon = nodeId(root, mm.uid);
    if (canon !== null && el.id !== canon) patchOf(el.id).customData = withoutMM(el.customData);
  }

  const kidEdges = new Map();
  const finalRect = new Map();
  for (const v of nodes) {
    if (v.parent) {
      if (!kidEdges.has(v.parent.uid)) kidEdges.set(v.parent.uid, []);
      kidEdges.get(v.parent.uid).push(v.node.uid);
    }
    const p = positions[v.node.uid];
    const s = info.get(v.node.uid).size;
    finalRect.set(v.node.uid, { x: p.x, y: p.y, width: s.width, height: s.height });
  }

  const addEdges = [];
  const addBodies = [];
  for (const v of nodes) {
    const uid = v.node.uid;
    const i = info.get(uid);
    const rect = finalRect.get(uid);
    const nid = nodeId(root, uid);
    const isRoot = v.depth === 0;
    const branch = isRoot ? undefined : v.branch;
    const txtEl = textByContainer.get(nid);
    const tid = txtEl ? txtEl.id : textId(root, uid);
    desiredIds.add(nid);
    desiredIds.add(tid);
    const ownBound = [{ id: tid, type: "text" }];
    if (!isRoot) ownBound.push({ id: edgeId(root, uid), type: "arrow" });
    for (const c of kidEdges.get(uid) || []) ownBound.push({ id: edgeId(root, c), type: "arrow" });
    const tr = textRect(rect, i.size.textWidth, i.size.textHeight);
    const want = {
      x: tr.x, y: tr.y, width: i.size.textWidth, height: i.size.textHeight,
      text: i.size.text, originalText: i.text, fontSize: i.fs,
    };
    const curMM = i.mm || {};
    const wantMM = isRoot
      ? { ...curMM, uid, map: root, root: true, layout: curMM.layout || dir, bounds }
      : { ...curMM, uid, map: root, ...(branch !== undefined ? { branch } : {}) };

    if (!i.el) {
      addBodies.push(
        buildNode({ map: root, uid, x: rect.x, y: rect.y, width: rect.width, height: rect.height, backgroundColor: colorFor(v), mm: wantMM, boundElements: ownBound }),
        buildText({ map: root, uid, ...want }),
      );
    } else {
      const el = i.el;
      const p = patchOf(nid);
      if (el.isDeleted) p.isDeleted = false;
      for (const k of ["x", "y", "width", "height"]) if (!close(el[k], rect[k])) p[k] = rect[k];
      if (Math.abs(el.angle || 0) > 1e-6) p.angle = 0;
      if (!isRoot && curMM.branch !== undefined && curMM.branch !== branch) p.backgroundColor = colorFor(v);
      if (!same(curMM, wantMM)) p.customData = withMM(el.customData, wantMM);
      const mb = mergeBound(el.boundElements, pre, ownBound);
      if (!same(mb, el.boundElements || [])) p.boundElements = mb;
      if (!txtEl) {
        addBodies.push(buildText({ map: root, uid, ...want }));
      } else {
        const tp = patchOf(txtEl.id);
        if (txtEl.isDeleted) tp.isDeleted = false;
        for (const k of ["x", "y", "width", "height"]) if (!close(txtEl[k], want[k])) tp[k] = want[k];
        if (Math.abs(txtEl.angle || 0) > 1e-6) tp.angle = 0;
        if (txtEl.text !== want.text) tp.text = want.text;
        if (txtEl.originalText !== want.originalText) tp.originalText = want.originalText;
        if (txtEl.fontSize !== want.fontSize) tp.fontSize = want.fontSize;
        if (txtEl.fontFamily !== FONT_FAMILY) tp.fontFamily = FONT_FAMILY;
        if (Math.abs((txtEl.lineHeight ?? 0) - LINE_HEIGHT) > 0.001) tp.lineHeight = LINE_HEIGHT;
        if (txtEl.containerId !== nid) tp.containerId = nid;
      }
    }

    if (!isRoot) {
      const eid = edgeId(root, uid);
      desiredIds.add(eid);
      const pid = nodeId(root, v.parent.uid);
      const g = edgeGeometry(finalRect.get(v.parent.uid), rect, dir);
      const e = byId.get(eid);
      if (!e) {
        addEdges.push(buildEdge({ map: root, parentUid: v.parent.uid, childUid: uid, ...g }));
      } else {
        const ep = patchOf(eid);
        const [, [dx, dy]] = g.points;
        if (e.isDeleted) ep.isDeleted = false;
        if (!close(e.x, g.x)) ep.x = g.x;
        if (!close(e.y, g.y)) ep.y = g.y;
        if (!close(e.width, Math.abs(dx))) ep.width = Math.abs(dx);
        if (!close(e.height, Math.abs(dy))) ep.height = Math.abs(dy);
        const pts = Array.isArray(e.points) ? e.points : [];
        const ok = pts.length === 2 && close(pts[0][0], 0) && close(pts[0][1], 0) && close(pts[1][0], dx) && close(pts[1][1], dy);
        if (!ok) ep.points = g.points;
        if (!e.startBinding || e.startBinding.elementId !== pid) ep.startBinding = { elementId: pid, focus: 0, gap: EDGE_GAP };
        if (!e.endBinding || e.endBinding.elementId !== nid) ep.endBinding = { elementId: nid, focus: 0, gap: EDGE_GAP };
      }
    }
  }

  // Boundaries: derived from root marker `bounds`, recomputed from final geometry (post-order union of rects).
  const bb = new Map();
  for (let k = nodes.length - 1; k >= 0; k--) {
    const v = nodes[k];
    const r = finalRect.get(v.node.uid);
    const own = bb.get(v.node.uid);
    const b = {
      x1: Math.min(r.x, own ? own.x1 : Infinity), y1: Math.min(r.y, own ? own.y1 : Infinity),
      x2: Math.max(r.x + r.width, own ? own.x2 : -Infinity), y2: Math.max(r.y + r.height, own ? own.y2 : -Infinity),
    };
    bb.set(v.node.uid, b);
    if (v.parent) {
      const pb = bb.get(v.parent.uid) || { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
      bb.set(v.parent.uid, { x1: Math.min(pb.x1, b.x1), y1: Math.min(pb.y1, b.y1), x2: Math.max(pb.x2, b.x2), y2: Math.max(pb.y2, b.y2) });
    }
  }
  const addBoundaries = [];
  for (const uid of bounds) {
    const b = bb.get(uid);
    if (!b) continue;
    const want = { x: b.x1 - BOUNDARY_PAD, y: b.y1 - BOUNDARY_PAD, width: b.x2 - b.x1 + 2 * BOUNDARY_PAD, height: b.y2 - b.y1 + 2 * BOUNDARY_PAD };
    const id = boundaryId(root, uid);
    desiredIds.add(id);
    const e = byId.get(id);
    if (!e) { addBoundaries.push(buildBoundary({ map: root, uid, ...want })); continue; }
    const p = patchOf(id);
    if (e.isDeleted) p.isDeleted = false;
    for (const k of ["x", "y", "width", "height"]) if (!close(e[k], want[k])) p[k] = want[k];
    if (Math.abs(e.angle || 0) > 1e-6) p.angle = 0;
    const m = mmOf(e);
    if (!m || m.boundary !== uid || m.map !== root) p.customData = withMM(e.customData, { boundary: uid, map: root });
  }

  ops.add = [...addEdges, ...addBodies, ...addBoundaries];

  const removed = new Set();
  for (const el of elements || []) {
    if (!el || el.isDeleted || typeof el.id !== "string" || !el.id.startsWith(pre) || desiredIds.has(el.id)) continue;
    removed.add(el.id);
  }
  for (const el of elements || []) {
    if (el && !el.isDeleted && el.type === "text" && removed.has(el.containerId)) removed.add(el.id);
  }
  ops.remove = [...removed];
  for (const [id, patch] of patches) {
    if (removed.has(id) || Object.keys(patch).length === 0) continue;
    ops.update.push({ id, patch });
  }
  return ops;
}

/** Apply ops: new objects only, append only, delete by flag (amendments 7-9). */
export function applyOps(elements, ops) {
  const upd = new Map(ops.update.map((u) => [u.id, u.patch]));
  const rem = new Set(ops.remove);
  const out = elements.map((el) => {
    if (rem.has(el.id)) return bump(el, { isDeleted: true });
    const p = upd.get(el.id);
    return p ? bump(el, p) : el;
  });
  const have = new Set(out.map((e) => e.id));
  for (const a of ops.add) if (!have.has(a.id)) out.push(a);
  return out;
}

export const isEmptyOps = (ops) => !ops.add.length && !ops.update.length && !ops.remove.length;

/** Live projection element ids of a map (root detach, Alt+Backspace on the root). */
export function projectionIds(elements, root) {
  const pre = idPrefix(root);
  return (elements || []).filter((el) => el && !el.isDeleted && typeof el.id === "string" && el.id.startsWith(pre)).map((el) => el.id);
}
