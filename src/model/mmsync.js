// Mind-map projection (Phase 4, unit A): element builders and the pure reconcile over (tree, markers, sizes).
import {
  BRANCH_COLORS, ROOT_COLOR, LINE_HEIGHT, PAD_X, PAD_Y, LEVEL_GAP, nodeSize, fontSizeForDepth, layoutTree, fishboneLayout,
  visibleNodes, countHidden, isFolded, allUids, plainText, isCauseLayout, taskState, tagColor, drawnTree,
} from "./mindmap.js";
import {
  FLOW_LAYOUT, FLOW_DECISION_WRAP, FLOW_ROOT_FONT, FLOW_STEP_FONT, FLOW_CHIP_FONT, flowParts, flowStructure, flowLayout, flowRoute,
} from "./flow.js";
import { arrowLabelRect, arrowLabelWrapWidth } from "./arrowlabel.js";
import { fnv1a } from "./hash.js";

export const FONT_FAMILY = 5;
export const BOUNDARY_PAD = 12;
export const EDGE_GAP = 4;
export const LABEL_FONT = 16;
export const CAUSE_LABEL = "caused by";
export const CAUSE_FILLS = Object.freeze(["#ffc9c9", "#ffd8a8", "#ffec99", "#e9ecef"]);
const TOL = 0.5;

// ---- ids (amendment 5) ----
export const idPrefix = (root) => `pmm-${root}-`;
export const nodeId = (root, uid) => `pmm-${root}-${uid}`;
export const textId = (root, uid) => `pmm-${root}-${uid}-t`;
export const edgeId = (root, childUid) => `pmm-${root}-${childUid}-e`;
export const boundaryId = (root, uid) => `pmm-${root}-${uid}-b`;
export const labelId = (root, childUid) => `${edgeId(root, childUid)}-t`;
export const spineId = (root) => `pmm-${root}-${root}-s`;
// Phase 13 flow ids: lane frames, chips, merge and loop arrows (never share an id with a primary edge).
export const lanePrefix = (root) => `pmm-${root}-lane-`;
export const laneId = (root, name) => `${lanePrefix(root)}${fnv1a(name)}`;
export const chipId = (root, uid, n) => `pmm-${root}-${uid}-c-${n}`;
export const chipTextId = (root, uid, n) => `${chipId(root, uid, n)}-t`;
export const mergeId = (root, tailUid) => `pmm-${root}-${tailUid}-m`;
export const loopId = (root, refUid) => `pmm-${root}-${refUid}-l`;
export const CHIP_FILLS = Object.freeze({ ccp: "#ffc9c9", hazard: "#ffd8a8" });

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

export const roundnessFor = (type) => (type === "diamond" ? { type: 2 } : type === "ellipse" ? null : { type: 3 });

export function buildNode({ map, uid, x, y, width, height, backgroundColor, mm, boundElements, opacity, strokeStyle, type = "rectangle", frameId }) {
  return base(nodeId(map, uid), type, x, y, width, height, {
    backgroundColor,
    roundness: roundnessFor(type),
    ...(frameId ? { frameId } : {}),
    boundElements: boundElements || [],
    customData: withMM(null, mm),
    ...(opacity !== undefined ? { opacity } : {}),
    ...(strokeStyle !== undefined ? { strokeStyle } : {}),
  });
}

export function buildText({ map, uid, x, y, width, height, text, originalText, fontSize, opacity, frameId }) {
  return base(textId(map, uid), "text", x, y, width, height, {
    ...(opacity !== undefined ? { opacity } : {}),
    ...(frameId ? { frameId } : {}),
    text, originalText, fontSize,
    fontFamily: 5,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: nodeId(map, uid),
    autoResize: true,
    lineHeight: LINE_HEIGHT,
  });
}

export function buildEdge({ map, parentUid, childUid, x, y, points, via, unboundStart = false, boundElements, id, mm, arrow = false, dashed = false }) {
  const [, [dx, dy]] = points;
  return base(id || edgeId(map, childUid), "arrow", x, y, Math.abs(dx), Math.abs(dy), {
    points,
    ...(dashed ? { strokeStyle: "dashed" } : {}),
    lastCommittedPoint: null,
    startBinding: unboundStart ? null : { elementId: nodeId(map, parentUid), focus: 0, gap: EDGE_GAP },
    endBinding: { elementId: nodeId(map, childUid), focus: 0, gap: EDGE_GAP },
    startArrowhead: null,
    endArrowhead: arrow ? "arrow" : null,
    elbowed: false,
    ...(boundElements && boundElements.length ? { boundElements } : {}),
    customData: withMM(null, mm || edgeMM(map, parentUid, childUid, via)),
  });
}

const edgeMM = (map, parentUid, childUid, via) => ({ edge: [parentUid, childUid], map, ...(via ? { via } : {}) });

/** Bound text of an edge (attribute label or "caused by"); geometry comes from arrowLabelRect. */
export function buildLabel({ map, childUid, x, y, width, height, text, originalText }) {
  return base(labelId(map, childUid), "text", x, y, width, height, {
    text, originalText,
    fontSize: LABEL_FONT,
    fontFamily: 5,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: edgeId(map, childUid),
    autoResize: true,
    lineHeight: LINE_HEIGHT,
    customData: withMM(null, { label: childUid, map }),
  });
}

/** Flow chip (CCP / hazard): a small rectangle with bound text, NOT grouped with its node (amendment 7). */
export function buildChip({ map, uid, n, kind, x, y, width, height, frameId }) {
  return base(chipId(map, uid, n), "rectangle", x, y, width, height, {
    backgroundColor: CHIP_FILLS[kind] || CHIP_FILLS.ccp,
    strokeWidth: 1,
    roundness: { type: 3 },
    boundElements: [{ id: chipTextId(map, uid, n), type: "text" }],
    customData: withMM(null, { chip: uid, kind, map }),
    ...(frameId ? { frameId } : {}),
  });
}

export function buildChipText({ map, uid, n, x, y, width, height, text, originalText, frameId }) {
  return base(chipTextId(map, uid, n), "text", x, y, width, height, {
    text, originalText,
    fontSize: FLOW_CHIP_FONT,
    fontFamily: 5,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: chipId(map, uid, n),
    autoResize: true,
    lineHeight: LINE_HEIGHT,
    ...(frameId ? { frameId } : {}),
  });
}

/** Flow lane frame: locked, named after the lane, marker {lane, map}. */
export function buildLane({ map, name, x, y, width, height }) {
  return base(laneId(map, name), "frame", x, y, width, height, {
    strokeColor: "#bbbbbb",
    roughness: 0,
    locked: true,
    name,
    customData: withMM(null, { lane: name, map }),
  });
}

/** Fishbone spine: an unbound line from the tail to the head's left edge. */
export function buildSpine({ map, x, y, points }) {
  const [, [dx, dy]] = points;
  return base(spineId(map), "line", x, y, Math.abs(dx), Math.abs(dy), {
    points,
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: null,
    customData: withMM(null, { spine: map, map }),
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
export function edgeGeometry(p, c, layout, start) {
  let sx; let sy; let ex; let ey;
  if (layout === "cause" || layout === "fishbone") layout = "left";
  if (layout === "right") { sx = p.x + p.width; sy = p.y + p.height / 2; ex = c.x; ey = c.y + c.height / 2; }
  else if (layout === "left") { sx = p.x; sy = p.y + p.height / 2; ex = c.x + c.width; ey = c.y + c.height / 2; }
  else if (layout === "down") { sx = p.x + p.width / 2; sy = p.y + p.height; ex = c.x + c.width / 2; ey = c.y; }
  else if (layout === "up") { sx = p.x + p.width / 2; sy = p.y; ex = c.x + c.width / 2; ey = c.y + c.height; }
  else { sx = p.x + p.width / 2; sy = p.y + p.height / 2; ex = c.x + c.width / 2; ey = c.y + c.height / 2; }
  if (start) { sx = start.x; sy = start.y; }
  return { x: sx, y: sy, points: [[0, 0], [ex - sx, ey - sy]] };
}

/** Bound-text origin inside a container (amendment 12, Excalidraw computeBoundTextPosition; ellipse and diamond ported from v0.18.0 textElement.ts). */
export function textRect(node, textWidth, textHeight, type = "rectangle") {
  if (type === "ellipse" || type === "diamond") {
    const ell = type === "ellipse";
    let ox = 5;
    let oy = 5;
    if (ell) { ox += (node.width / 2) * (1 - Math.SQRT2 / 2); oy += (node.height / 2) * (1 - Math.SQRT2 / 2); } else { ox += node.width / 4; oy += node.height / 4; }
    const maxW = (ell ? Math.round((node.width / 2) * Math.SQRT2) : Math.round(node.width / 2)) - 10;
    const maxH = (ell ? Math.round((node.height / 2) * Math.SQRT2) : Math.round(node.height / 2)) - 10;
    return { x: node.x + ox + (maxW / 2 - textWidth / 2), y: node.y + oy + (maxH / 2 - textHeight / 2) };
  }
  return { x: node.x + (node.width - textWidth) / 2, y: node.y + (node.height - textHeight) / 2 };
}

/** Excalidraw computeBoundTextDimension: container size that fits bound text of `dimension` (v0.18.0 textElement.ts:437-455, computeContainerDimensionForBoundText). */
export function containerDimension(dimension, type) {
  const d = Math.ceil(dimension);
  if (type === "ellipse") return Math.round(((d + 10) / Math.SQRT2) * 2);
  if (type === "diamond") return 2 * (d + 10);
  return d + 10;
}

/** Sizer from a measurer(str, fontSize) -> width: (text, fontSize) -> nodeSize. */
export const makeSizer = (measure) => (text, fontSize, _uid, maxWidth) => nodeSize(text, fontSize, measure, maxWidth);

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
const schemeFill = (v, scheme) => (scheme === "cause" ? CAUSE_FILLS[Math.min(v.depth, 3)] : scheme === "flow" ? (v.depth === 0 ? ROOT_COLOR : BRANCH_COLORS[0]) : colorFor(v));
const EVIDENCE_RE = /#\[\[evidence\]\]|(?:^|[\s(])#evidence(?![\p{L}\p{N}_/-]|[.:][\p{L}\p{N}_/-])/iu;

function fullSize(s, text, fs) {
  const out = { ...s };
  if (!Array.isArray(out.lines)) out.lines = String(out.text ?? text).split("\n");
  if (out.text === undefined) out.text = out.lines.join("\n");
  if (out.textWidth === undefined) out.textWidth = out.width - 2 * PAD_X;
  if (out.textHeight === undefined) out.textHeight = out.lines.length * fs * LINE_HEIGHT;
  if (out.height === undefined) out.height = out.textHeight + 2 * PAD_Y;
  return out;
}

/**
 * Layout plan for a map given the live scene. `positions` are where unpinned nodes belong (pinned nodes keep
 * their element position), so the canvas side can compare against them to detect native drags.
 * sizes: function (text, fontSize, uid, maxWidth) -> nodeSize, or map uid -> nodeSize-like {width,height,...}.
 * The drawn tree (`vtree`) applies the attribute-carrier transform; `tree` stays the raw block tree.
 * tagColors: Map<lowercase tag, colour>; rootDefaults: marker fields for a root that does not exist yet.
 */
export function planMap({ elements, tree, sizes, layout = "right", textOf, rootPos, tagColors, rootDefaults }) {
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
  const flow = dir === FLOW_LAYOUT;
  const family = flow ? "flow" : isCauseLayout(dir) ? "cause" : "branch";
  const oldScheme = rootMM.scheme === "cause" ? "cause" : rootMM.scheme === "flow" ? "flow" : "branch";
  const attrEdges = rootEl ? rootMM.attrEdges === true : !!(rootDefaults && rootDefaults.attrEdges === true);
  const vtree = drawnTree(tree, { layout: dir, attrEdges });
  const fstruct = flow ? flowStructure(tree) : null;
  const nodes = visibleNodes(vtree);
  const uids = allUids(tree);
  const storedBounds = Array.isArray(rootMM.bounds) ? rootMM.bounds : [];
  const bounds = tree.truncated ? storedBounds : storedBounds.filter((u) => uids.has(u));
  const info = new Map();
  const sizeMap = {};
  const pinned = {};
  const labels = new Map();
  const tags = tagColors instanceof Map ? tagColors : new Map();
  for (const v of nodes) {
    const n = v.node;
    const st = flow ? fstruct.byUid.get(n.uid) : null;
    const fs = flow ? (v.depth === 0 ? FLOW_ROOT_FONT : FLOW_STEP_FONT) : fontSizeForDepth(v.depth);
    const fp = flow ? flowParts(n.string, { branch: st.branchHead }) : null;
    const shown = flow ? { ...n, string: fp.task + fp.body } : n;
    let base = textOf ? textOf(n.uid, shown) : plainText(shown.string, () => "…");
    if (v.depth === 0 && family === "cause") base = `★ ${base}`;
    const text = isFolded(n) ? `${base} (+${countHidden(n)})` : base;
    const wrap = flow && st.type === "decision" ? FLOW_DECISION_WRAP : undefined;
    const raw = typeof sizes === "function" ? { ...(wrap ? sizes(text, fs, n.uid, wrap) : sizes(text, fs, n.uid)) } : { ...(sizes && sizes[n.uid]) };
    const s = fullSize(raw, text, fs);
    const shape = flow ? (st.type === "decision" ? "diamond" : st.type === "root" || st.type === "end" ? "ellipse" : "rectangle") : "rectangle";
    if (shape !== "rectangle") {
      s.width = containerDimension(s.textWidth + 4, shape);
      s.height = containerDimension(s.textHeight + 4, shape);
    }
    sizeMap[n.uid] = s;
    const el = byId.get(nodeId(root, n.uid));
    const mm = mmOf(el);
    if (v.depth > 0 && el && mm && mm.pinned === true) pinned[n.uid] = { x: el.x, y: el.y };
    info.set(n.uid, {
      fs, text, size: s, el, mm, shape,
      tag: tagColor(n.string, tags),
      done: taskState(n.string) === "DONE",
      dash: family === "cause" && EVIDENCE_RE.test(n.string),
    });
    if (flow) {
      if (st.branchHead && fp.label) labels.set(n.uid, fp.label);
    } else if (v.depth > 0) {
      const lt = n.edgeLabel !== undefined ? n.edgeLabel : family === "cause" ? CAUSE_LABEL : null;
      if (lt) labels.set(n.uid, lt);
    }
  }
  const labelMemo = new Map();
  const labelSize = (uid, text, wrapW) => {
    const key = `${wrapW}|${text}`;
    let r = labelMemo.get(key);
    if (!r) {
      const raw = typeof sizes === "function" ? { ...sizes(text, LABEL_FONT, `${uid}-e`, wrapW) }
        : { ...((sizes && sizes[`${uid}-e`]) || { width: text.length * 8 + 2 * PAD_X }) };
      r = fullSize(raw, text, LABEL_FONT);
      labelMemo.set(key, r);
    }
    return r;
  };
  const baseWrap = arrowLabelWrapWidth(0, LABEL_FONT);
  const vertical = dir === "down" || dir === "up";
  const gapOf = (uid) => {
    const lt = labels.get(uid);
    if (!lt) return LEVEL_GAP;
    const ls = labelSize(uid, lt, baseWrap);
    return Math.max(LEVEL_GAP, (vertical ? ls.textHeight : ls.textWidth) + 24);
  };
  const anchor = rootEl && Number.isFinite(rootEl.x) ? { x: rootEl.x, y: rootEl.y } : rootPos || { x: 0, y: 0 };
  let positions;
  let spine = null;
  let slotX = {};
  let flowInfo = null;
  if (flow) {
    const chipSize = (uid, i, chip) => {
      const key = `${uid}-c${i}`;
      const raw = typeof sizes === "function" ? { ...sizes(chip.text, FLOW_CHIP_FONT, key) } : { ...((sizes && sizes[key]) || { width: chip.text.length * 7 + 2 * PAD_X }) };
      const cs = fullSize(raw, chip.text, FLOW_CHIP_FONT);
      return { width: cs.textWidth + 12, height: containerDimension(cs.textHeight, "rectangle"), textWidth: cs.textWidth, textHeight: cs.textHeight, wrapped: cs.text };
    };
    const labelWidth = (uid) => (labels.has(uid) ? labelSize(uid, labels.get(uid), baseWrap).textWidth : 0);
    const lay = flowLayout(fstruct, { sizes: sizeMap, chipSize, labelWidth, anchor });
    positions = lay.positions;
    const edges = fstruct.edges.map((e) => ({ ...e, id: e.primary ? edgeId(root, e.to) : e.kind === "merge" ? mergeId(root, e.from) : loopId(root, e.via) }));
    const arrows = new Map();
    for (const e of edges) for (const u of [e.from, e.to]) { if (!arrows.has(u)) arrows.set(u, []); arrows.get(u).push(e.id); }
    flowInfo = { struct: fstruct, chips: lay.chips, frames: lay.frames, edges, arrows };
  } else if (dir === "fishbone") {
    const fb = fishboneLayout({ tree: vtree, sizes: sizeMap, pinned, root: anchor, gapOf });
    positions = fb.positions; spine = fb.spine; slotX = fb.slotX;
  } else positions = layoutTree({ tree: vtree, sizes: sizeMap, layout: dir, pinned, root: anchor, gapOf });
  return { root, dir, family, oldScheme, bounds, nodes, info, positions, byId, textByContainer, vtree, labels, labelSize, spine, slotX, attrEdges, flow: flowInfo };
}

export function reconcile({ elements, tree, sizes, layout = "right", textOf, rootPos, tagColors, rootDefaults }) {
  const ops = { add: [], update: [], remove: [] };
  if (!tree) return ops;
  const plan = planMap({ elements, tree, sizes, layout, textOf, rootPos, tagColors, rootDefaults });
  const { root, dir, family, oldScheme, bounds, nodes, info, positions, byId, textByContainer, labels, labelSize, spine, slotX } = plan;
  const flow = plan.flow;
  const fishbone = dir === "fishbone";
  const pre = idPrefix(root);
  const lpre = lanePrefix(root);
  const desiredIds = new Set();
  const desiredFrame = new Map();
  const patches = new Map();
  const patchOf = (id) => { if (!patches.has(id)) patches.set(id, {}); return patches.get(id); };

  // Amendment 6: copies lose the marker; nothing is deleted.
  for (const el of elements || []) {
    const mm = mmOf(el);
    if (!el || !mm || mm.map !== root) continue;
    let canon = null;
    if (mm.boundary) canon = boundaryId(root, mm.boundary);
    else if (Array.isArray(mm.edge)) canon = edgeId(root, mm.edge[1]);
    else if (typeof mm.label === "string") canon = labelId(root, mm.label);
    else if (mm.spine) canon = spineId(root);
    else if (typeof mm.lane === "string") canon = laneId(root, mm.lane);
    else if (typeof mm.chip === "string") canon = chipId(root, mm.chip, mm.kind === "hazard" ? 1 : 0);
    else if (mm.flow && typeof mm.flow === "object") canon = mm.flow.kind === "merge" ? mergeId(root, mm.flow.from) : mm.flow.via ? loopId(root, mm.flow.via) : null;
    else if (mm.uid) canon = nodeId(root, mm.uid);
    if (canon !== null && el.id !== canon) patchOf(el.id).customData = withoutMM(el.customData);
  }

  const kidEdges = new Map();
  const finalRect = new Map();
  for (const v of nodes) {
    // Fishbone bones start on the spine, not on the head: they stay out of the root's boundElements.
    if (v.parent && !flow && !(fishbone && v.depth === 1)) {
      if (!kidEdges.has(v.parent.uid)) kidEdges.set(v.parent.uid, []);
      kidEdges.get(v.parent.uid).push(v.node.uid);
    }
    const p = positions[v.node.uid];
    const s = info.get(v.node.uid).size;
    finalRect.set(v.node.uid, { x: p.x, y: p.y, width: s.width, height: s.height });
  }

  const addEdges = [];
  const addBodies = [];
  const addLabels = [];

  // One edge (tree or flow): geometry, bindings, marker, and the bound label. `spec` carries what differs per kind.
  const doEdge = ({ eid, parentUid, childUid, g, wantEdgeMM, via, boneStart, arrow = false, dashed = false, labelUid = null }) => {
    const pid = nodeId(root, parentUid);
    const nid = nodeId(root, childUid);
    const e = byId.get(eid);
    const [, [dx, dy]] = g.points;

    // Bound label: attribute name, "caused by" or a flow branch label. A live bound text that is not ours (a user's label) wins.
    const lid = labelId(root, childUid);
    let label = null;
    const ltext = labelUid !== null ? labels.get(labelUid) : null;
    if (ltext) {
      const foreign = e && (Array.isArray(e.boundElements) ? e.boundElements : []).some((b) => {
        if (!b || b.type !== "text" || b.id === lid) return false;
        const t = byId.get(b.id);
        return t && !t.isDeleted && t.type === "text";
      });
      if (!foreign) {
        const ls = labelSize(labelUid, ltext, arrowLabelWrapWidth(Math.abs(dx), LABEL_FONT));
        const lr = arrowLabelRect({ x: g.x, y: g.y, points: g.points }, ls.textWidth, ls.textHeight);
        label = { x: lr.x, y: lr.y, width: ls.textWidth, height: ls.textHeight, text: ls.text, originalText: ltext };
      }
    }
    const edgeBound = label ? [{ id: lid, type: "text" }] : [];
    if (label) {
      desiredIds.add(lid);
      const lt = byId.get(lid);
      if (!lt) addLabels.push(buildLabel({ map: root, childUid, ...label }));
      else {
        const lp = patchOf(lid);
        if (lt.isDeleted) lp.isDeleted = false;
        for (const k of ["x", "y", "width", "height"]) if (!close(lt[k], label[k])) lp[k] = label[k];
        if (Math.abs(lt.angle || 0) > 1e-6) lp.angle = 0;
        if (lt.text !== label.text) lp.text = label.text;
        if (lt.originalText !== label.originalText) lp.originalText = label.originalText;
        if (lt.fontSize !== LABEL_FONT) lp.fontSize = LABEL_FONT;
        if (lt.fontFamily !== FONT_FAMILY) lp.fontFamily = FONT_FAMILY;
        if (lt.textAlign !== "center") lp.textAlign = "center";
        if (lt.verticalAlign !== "middle") lp.verticalAlign = "middle";
        if (Math.abs((lt.lineHeight ?? 0) - LINE_HEIGHT) > 0.001) lp.lineHeight = LINE_HEIGHT;
        if (lt.containerId !== eid) lp.containerId = eid;
        const lm = mmOf(lt);
        if (!lm || lm.label !== childUid || lm.map !== root) lp.customData = withMM(lt.customData, { label: childUid, map: root });
      }
    }

    if (!e) {
      addEdges.push(buildEdge({ map: root, parentUid, childUid, ...g, via, unboundStart: !!boneStart, boundElements: edgeBound, id: eid, mm: wantEdgeMM, arrow, dashed }));
    } else {
      const ep = patchOf(eid);
      if (e.isDeleted) ep.isDeleted = false;
      if (!close(e.x, g.x)) ep.x = g.x;
      if (!close(e.y, g.y)) ep.y = g.y;
      if (!close(e.width, Math.abs(dx))) ep.width = Math.abs(dx);
      if (!close(e.height, Math.abs(dy))) ep.height = Math.abs(dy);
      const pts = Array.isArray(e.points) ? e.points : [];
      const ok = pts.length === 2 && close(pts[0][0], 0) && close(pts[0][1], 0) && close(pts[1][0], dx) && close(pts[1][1], dy);
      if (!ok) ep.points = g.points;
      if (boneStart) { if (e.startBinding) ep.startBinding = null; }
      else if (!e.startBinding || e.startBinding.elementId !== pid) ep.startBinding = { elementId: pid, focus: 0, gap: EDGE_GAP };
      if (!e.endBinding || e.endBinding.elementId !== nid) ep.endBinding = { elementId: nid, focus: 0, gap: EDGE_GAP };
      // Arrowheads and dashes: only edges that are, or were, flow-marked (P13 amendment 8), and only on a flow event.
      const curFlow = (mmOf(e) || {}).flow;
      if (arrow) {
        if (curFlow === undefined || !same(curFlow, wantEdgeMM.flow)) {
          if (e.endArrowhead !== "arrow") ep.endArrowhead = "arrow";
          if (dashed && e.strokeStyle !== "dashed") ep.strokeStyle = "dashed";
        }
      } else if (curFlow !== undefined && e.endArrowhead === "arrow") ep.endArrowhead = null;
      if (!same(mmOf(e) || null, wantEdgeMM)) ep.customData = withMM(e.customData, wantEdgeMM);
      const eb = mergeBound(e.boundElements, pre, edgeBound);
      if (!same(eb, e.boundElements || [])) ep.boundElements = eb;
    }
  };

  for (const v of nodes) {
    const uid = v.node.uid;
    const i = info.get(uid);
    const rect = finalRect.get(uid);
    const nid = nodeId(root, uid);
    const isRoot = v.depth === 0;
    const branch = isRoot || flow ? undefined : v.branch;
    const st = flow ? flow.struct.byUid.get(uid) : null;
    const frameWant = st && st.lane !== "" ? laneId(root, st.lane) : undefined;
    const txtEl = textByContainer.get(nid);
    const tid = txtEl ? txtEl.id : textId(root, uid);
    desiredIds.add(nid);
    desiredIds.add(tid);
    if (frameWant !== undefined) { desiredFrame.set(nid, frameWant); desiredFrame.set(tid, frameWant); }
    const ownBound = [{ id: tid, type: "text" }];
    if (flow) for (const id of flow.arrows.get(uid) || []) ownBound.push({ id, type: "arrow" });
    else {
      if (!isRoot) ownBound.push({ id: edgeId(root, uid), type: "arrow" });
      for (const c of kidEdges.get(uid) || []) ownBound.push({ id: edgeId(root, c), type: "arrow" });
    }
    const tr = textRect(rect, i.size.textWidth, i.size.textHeight, i.shape);
    const want = {
      x: tr.x, y: tr.y, width: i.size.textWidth, height: i.size.textHeight,
      text: i.size.text, originalText: i.text, fontSize: i.fs,
    };
    const curMM = i.mm || {};
    const wantMM = isRoot
      ? { ...curMM, uid, map: root, root: true, layout: curMM.layout || dir, bounds }
      : { ...curMM, uid, map: root, ...(branch !== undefined ? { branch } : {}) };
    if (flow && !isRoot) delete wantMM.branch;
    if (i.tag) wantMM.tag = i.tag; else delete wantMM.tag;
    if (i.done) wantMM.done = true; else delete wantMM.done;
    if (i.dash) wantMM.dash = true; else delete wantMM.dash;
    if (i.shape !== "rectangle") wantMM.shape = i.shape; else delete wantMM.shape;
    if (isRoot) {
      if (family === "cause") wantMM.scheme = "cause"; else if (family === "flow") wantMM.scheme = "flow"; else delete wantMM.scheme;
    }
    const fill = i.tag || schemeFill(v, family);

    if (!i.el) {
      if (isRoot && rootDefaults) Object.assign(wantMM, { ...rootDefaults, ...wantMM });
      addBodies.push(
        buildNode({
          map: root, uid, x: rect.x, y: rect.y, width: rect.width, height: rect.height, backgroundColor: fill, mm: wantMM, boundElements: ownBound,
          opacity: i.done ? 50 : undefined, strokeStyle: i.dash ? "dashed" : undefined, type: i.shape, frameId: frameWant,
        }),
        buildText({ map: root, uid, ...want, opacity: i.done ? 50 : undefined, frameId: frameWant }),
      );
    } else {
      const el = i.el;
      const p = patchOf(nid);
      if (el.isDeleted) p.isDeleted = false;
      for (const k of ["x", "y", "width", "height"]) if (!close(el[k], rect[k])) p[k] = rect[k];
      if (Math.abs(el.angle || 0) > 1e-6) p.angle = 0;
      // Shape ownership (P13 amendment 5): change the type in place only on a shape event recorded in the marker.
      if ((curMM.shape || "rectangle") !== i.shape && el.type !== i.shape) { p.type = i.shape; p.roundness = roundnessFor(i.shape); }
      if (frameWant !== undefined && el.frameId !== frameWant) p.frameId = frameWant;
      // Fill ownership (P4 amendment 10, P12 amendment 20): repaint only on an event, and only a fill Plexus set.
      if (!isRoot && !flow && curMM.branch !== undefined && curMM.branch !== branch) p.backgroundColor = fill;
      else if (oldScheme !== family || curMM.tag !== i.tag) {
        const oldExpected = curMM.tag || schemeFill(v, oldScheme);
        if (el.backgroundColor === oldExpected && oldExpected !== fill) p.backgroundColor = fill;
      }
      if (i.done && curMM.done !== true) p.opacity = 50;
      else if (!i.done && curMM.done === true && el.opacity === 50) p.opacity = 100;
      if (i.dash && curMM.dash !== true) p.strokeStyle = "dashed";
      else if (!i.dash && curMM.dash === true && el.strokeStyle === "dashed") p.strokeStyle = "solid";
      if (!same(curMM, wantMM)) p.customData = withMM(el.customData, wantMM);
      const mb = mergeBound(el.boundElements, pre, ownBound);
      if (!same(mb, el.boundElements || [])) p.boundElements = mb;
      if (!txtEl) {
        addBodies.push(buildText({ map: root, uid, ...want, opacity: i.done ? 50 : undefined, frameId: frameWant }));
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
        if (frameWant !== undefined && txtEl.frameId !== frameWant) tp.frameId = frameWant;
        if (i.done && curMM.done !== true) tp.opacity = 50;
        else if (!i.done && curMM.done === true && txtEl.opacity === 50) tp.opacity = 100;
      }
    }

    if (!isRoot && !flow) {
      const parentUid = v.parent.uid;
      const boneStart = fishbone && v.depth === 1 && spine ? { x: slotX[uid], y: spine.y } : null;
      const g = edgeGeometry(finalRect.get(parentUid), rect, dir, boneStart);
      const eid = edgeId(root, uid);
      desiredIds.add(eid);
      doEdge({ eid, parentUid, childUid: uid, g, wantEdgeMM: edgeMM(root, parentUid, uid, v.node.via), via: v.node.via, boneStart, labelUid: uid });
    }
  }

  // Flow arrows (P13): primary edges reuse edgeId(root, to); merges and loops have their own ids and markers.
  const addChips = [];
  if (flow) {
    for (const fe of flow.edges) {
      const a = flow.struct.byUid.get(fe.from);
      const b = flow.struct.byUid.get(fe.to);
      const ar = { ...finalRect.get(fe.from), type: info.get(fe.from).shape };
      const br = { ...finalRect.get(fe.to), type: info.get(fe.to).shape };
      const g = flowRoute(ar, br, fe.primary && a.lane === b.lane && b.rank === a.rank + 1, EDGE_GAP);
      const wantEdgeMM = fe.primary
        ? { edge: [fe.from, fe.to], map: root, flow: fe.kind }
        : { flow: { from: fe.from, to: fe.to, kind: fe.kind, ...(fe.via ? { via: fe.via } : {}) }, map: root };
      desiredIds.add(fe.id);
      doEdge({ eid: fe.id, parentUid: fe.from, childUid: fe.to, g, wantEdgeMM, arrow: true, dashed: fe.kind === "loop", labelUid: fe.primary ? fe.to : null });
    }

    // Chips: not grouped with their node (amendment 7); reconciled like nodes, outline-owned text.
    for (const [uid, list] of flow.chips) {
      const st = flow.struct.byUid.get(uid);
      const frameWant = st.lane !== "" ? laneId(root, st.lane) : undefined;
      list.forEach((c) => {
        const n = c.kind === "hazard" ? 1 : 0;
        const cid = chipId(root, uid, n);
        const ctid = chipTextId(root, uid, n);
        desiredIds.add(cid);
        desiredIds.add(ctid);
        if (frameWant !== undefined) { desiredFrame.set(cid, frameWant); desiredFrame.set(ctid, frameWant); }
        const tr = textRect({ x: c.x, y: c.y, width: c.width, height: c.height }, c.textWidth, c.textHeight);
        const tw = { x: tr.x, y: tr.y, width: c.textWidth, height: c.textHeight, text: c.wrapped, originalText: c.text };
        const ce = byId.get(cid);
        const te = textByContainer.get(cid);
        if (!ce) {
          addBodies.push(buildChip({ map: root, uid, n, kind: c.kind, x: c.x, y: c.y, width: c.width, height: c.height, frameId: frameWant }));
          if (!te) addBodies.push(buildChipText({ map: root, uid, n, ...tw, frameId: frameWant }));
        } else {
          const p = patchOf(cid);
          if (ce.isDeleted) p.isDeleted = false;
          for (const [k, val] of [["x", c.x], ["y", c.y], ["width", c.width], ["height", c.height]]) if (!close(ce[k], val)) p[k] = val;
          if (Math.abs(ce.angle || 0) > 1e-6) p.angle = 0;
          if (frameWant !== undefined && ce.frameId !== frameWant) p.frameId = frameWant;
          const cm = mmOf(ce);
          const wantCM = { chip: uid, kind: c.kind, map: root };
          if (!same(cm || null, wantCM)) p.customData = withMM(ce.customData, wantCM);
          const mb = mergeBound(ce.boundElements, pre, [{ id: ctid, type: "text" }]);
          if (!same(mb, ce.boundElements || [])) p.boundElements = mb;
        }
        if (ce && !te) addBodies.push(buildChipText({ map: root, uid, n, ...tw, frameId: frameWant }));
        else if (te) {
          const tp = patchOf(te.id);
          if (te.isDeleted) tp.isDeleted = false;
          for (const k of ["x", "y", "width", "height"]) if (!close(te[k], tw[k])) tp[k] = tw[k];
          if (Math.abs(te.angle || 0) > 1e-6) tp.angle = 0;
          if (te.text !== tw.text) tp.text = tw.text;
          if (te.originalText !== tw.originalText) tp.originalText = tw.originalText;
          if (te.fontSize !== FLOW_CHIP_FONT) tp.fontSize = FLOW_CHIP_FONT;
          if (te.fontFamily !== FONT_FAMILY) tp.fontFamily = FONT_FAMILY;
          if (Math.abs((te.lineHeight ?? 0) - LINE_HEIGHT) > 0.001) tp.lineHeight = LINE_HEIGHT;
          if (te.containerId !== cid) tp.containerId = cid;
          if (frameWant !== undefined && te.frameId !== frameWant) tp.frameId = frameWant;
        }
      });
    }
  }

  // Lane frames (P13 amendment 6): appended after their members, created locked, never reordered.
  const addLanes = [];
  if (flow) {
    for (const f of flow.frames) {
      const id = laneId(root, f.name);
      desiredIds.add(id);
      const e = byId.get(id);
      if (!e) { addLanes.push(buildLane({ map: root, ...f })); continue; }
      const p = patchOf(id);
      if (e.isDeleted) p.isDeleted = false;
      for (const k of ["x", "y", "width", "height"]) if (!close(e[k], f[k])) p[k] = f[k];
      if (Math.abs(e.angle || 0) > 1e-6) p.angle = 0;
      if (e.name !== f.name) p.name = f.name;
      const m = mmOf(e);
      if (!m || m.lane !== f.name || m.map !== root) p.customData = withMM(e.customData, { lane: f.name, map: root });
    }
  }

  // Fishbone spine (unbound line, marker {spine, map}).
  const addSpine = [];
  if (fishbone && spine) {
    const sid = spineId(root);
    desiredIds.add(sid);
    const len = spine.x2 - spine.x1;
    const pts = [[0, 0], [len, 0]];
    const e = byId.get(sid);
    if (!e) addSpine.push(buildSpine({ map: root, x: spine.x1, y: spine.y, points: pts }));
    else {
      const sp = patchOf(sid);
      if (e.isDeleted) sp.isDeleted = false;
      if (!close(e.x, spine.x1)) sp.x = spine.x1;
      if (!close(e.y, spine.y)) sp.y = spine.y;
      if (!close(e.width, Math.abs(len))) sp.width = Math.abs(len);
      if (!close(e.height, 0)) sp.height = 0;
      const ep = Array.isArray(e.points) ? e.points : [];
      const ok = ep.length === 2 && close(ep[0][0], 0) && close(ep[0][1], 0) && close(ep[1][0], len) && close(ep[1][1], 0);
      if (!ok) sp.points = pts;
      const m = mmOf(e);
      if (!m || m.spine !== root || m.map !== root) sp.customData = withMM(e.customData, { spine: root, map: root });
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

  ops.add = [...addSpine, ...addEdges, ...addBodies, ...addLabels, ...addBoundaries, ...addLanes];

  const removed = new Set();
  for (const el of elements || []) {
    if (!el || el.isDeleted || typeof el.id !== "string" || !el.id.startsWith(pre) || desiredIds.has(el.id)) continue;
    removed.add(el.id);
  }
  for (const el of elements || []) {
    if (el && !el.isDeleted && el.type === "text" && removed.has(el.containerId)) removed.add(el.id);
  }
  ops.remove = [...removed];
  // Stale lane frameIds (amendment 6): a map element still pointing at a lane it no longer belongs to leaves it.
  for (const el of elements || []) {
    if (!el || typeof el.id !== "string" || !el.id.startsWith(pre) || removed.has(el.id)) continue;
    if (el.isDeleted && patches.get(el.id)?.isDeleted !== false) continue;
    if (typeof el.frameId !== "string" || !el.frameId.startsWith(lpre)) continue;
    const want = desiredFrame.get(el.id) ?? null;
    if (el.frameId !== want) patchOf(el.id).frameId = want;
  }
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
