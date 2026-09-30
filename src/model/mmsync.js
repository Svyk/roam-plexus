// Mind-map projection (Phase 4, unit A): element builders and the pure reconcile over (tree, markers, sizes).
import {
  BRANCH_COLORS, ROOT_COLOR, LINE_HEIGHT, PAD_X, PAD_Y, LEVEL_GAP, nodeSize, fontSizeForDepth, layoutTree, fishboneLayout,
  visibleNodes, countHidden, isFolded, allUids, plainText, isCauseLayout, visualTree, taskState, tagColor,
} from "./mindmap.js";
import { arrowLabelRect, arrowLabelWrapWidth } from "./arrowlabel.js";

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

export function buildNode({ map, uid, x, y, width, height, backgroundColor, mm, boundElements, opacity, strokeStyle }) {
  return base(nodeId(map, uid), "rectangle", x, y, width, height, {
    backgroundColor,
    roundness: { type: 3 },
    boundElements: boundElements || [],
    customData: withMM(null, mm),
    ...(opacity !== undefined ? { opacity } : {}),
    ...(strokeStyle !== undefined ? { strokeStyle } : {}),
  });
}

export function buildText({ map, uid, x, y, width, height, text, originalText, fontSize, opacity }) {
  return base(textId(map, uid), "text", x, y, width, height, {
    ...(opacity !== undefined ? { opacity } : {}),
    text, originalText, fontSize,
    fontFamily: 5,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: nodeId(map, uid),
    autoResize: true,
    lineHeight: LINE_HEIGHT,
  });
}

export function buildEdge({ map, parentUid, childUid, x, y, points, via, unboundStart = false, boundElements }) {
  const [, [dx, dy]] = points;
  return base(edgeId(map, childUid), "arrow", x, y, Math.abs(dx), Math.abs(dy), {
    points,
    lastCommittedPoint: null,
    startBinding: unboundStart ? null : { elementId: nodeId(map, parentUid), focus: 0, gap: EDGE_GAP },
    endBinding: { elementId: nodeId(map, childUid), focus: 0, gap: EDGE_GAP },
    startArrowhead: null,
    endArrowhead: null,
    elbowed: false,
    ...(boundElements && boundElements.length ? { boundElements } : {}),
    customData: withMM(null, edgeMM(map, parentUid, childUid, via)),
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

/** Bound-text origin inside a container (amendment 12, Excalidraw computeBoundTextPosition). */
export function textRect(node, textWidth, textHeight) {
  return { x: node.x + (node.width - textWidth) / 2, y: node.y + (node.height - textHeight) / 2 };
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
const schemeFill = (v, scheme) => (scheme === "cause" ? CAUSE_FILLS[Math.min(v.depth, 3)] : colorFor(v));
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
  const family = isCauseLayout(dir) ? "cause" : "branch";
  const oldScheme = rootMM.scheme === "cause" ? "cause" : "branch";
  const attrEdges = rootEl ? rootMM.attrEdges === true : !!(rootDefaults && rootDefaults.attrEdges === true);
  const vtree = visualTree(tree, { attrEdges });
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
    const fs = fontSizeForDepth(v.depth);
    let base = textOf ? textOf(n.uid, n) : plainText(n.string, () => "…");
    if (v.depth === 0 && family === "cause") base = `★ ${base}`;
    const text = isFolded(n) ? `${base} (+${countHidden(n)})` : base;
    const raw = typeof sizes === "function" ? { ...sizes(text, fs, n.uid) } : { ...(sizes && sizes[n.uid]) };
    const s = fullSize(raw, text, fs);
    sizeMap[n.uid] = s;
    const el = byId.get(nodeId(root, n.uid));
    const mm = mmOf(el);
    if (v.depth > 0 && el && mm && mm.pinned === true) pinned[n.uid] = { x: el.x, y: el.y };
    info.set(n.uid, {
      fs, text, size: s, el, mm,
      tag: tagColor(n.string, tags),
      done: taskState(n.string) === "DONE",
      dash: family === "cause" && EVIDENCE_RE.test(n.string),
    });
    if (v.depth > 0) {
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
  if (dir === "fishbone") {
    const fb = fishboneLayout({ tree: vtree, sizes: sizeMap, pinned, root: anchor, gapOf });
    positions = fb.positions; spine = fb.spine; slotX = fb.slotX;
  } else positions = layoutTree({ tree: vtree, sizes: sizeMap, layout: dir, pinned, root: anchor, gapOf });
  return { root, dir, family, oldScheme, bounds, nodes, info, positions, byId, textByContainer, vtree, labels, labelSize, spine, slotX, attrEdges };
}

export function reconcile({ elements, tree, sizes, layout = "right", textOf, rootPos, tagColors, rootDefaults }) {
  const ops = { add: [], update: [], remove: [] };
  if (!tree) return ops;
  const plan = planMap({ elements, tree, sizes, layout, textOf, rootPos, tagColors, rootDefaults });
  const { root, dir, family, oldScheme, bounds, nodes, info, positions, byId, textByContainer, labels, labelSize, spine, slotX } = plan;
  const fishbone = dir === "fishbone";
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
    else if (typeof mm.label === "string") canon = labelId(root, mm.label);
    else if (mm.spine) canon = spineId(root);
    else if (mm.uid) canon = nodeId(root, mm.uid);
    if (canon !== null && el.id !== canon) patchOf(el.id).customData = withoutMM(el.customData);
  }

  const kidEdges = new Map();
  const finalRect = new Map();
  for (const v of nodes) {
    // Fishbone bones start on the spine, not on the head: they stay out of the root's boundElements.
    if (v.parent && !(fishbone && v.depth === 1)) {
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
    if (i.tag) wantMM.tag = i.tag; else delete wantMM.tag;
    if (i.done) wantMM.done = true; else delete wantMM.done;
    if (i.dash) wantMM.dash = true; else delete wantMM.dash;
    if (isRoot) {
      if (family === "cause") wantMM.scheme = "cause"; else delete wantMM.scheme;
    }
    const fill = i.tag || schemeFill(v, family);

    if (!i.el) {
      if (isRoot && rootDefaults) Object.assign(wantMM, { ...rootDefaults, ...wantMM });
      addBodies.push(
        buildNode({
          map: root, uid, x: rect.x, y: rect.y, width: rect.width, height: rect.height, backgroundColor: fill, mm: wantMM, boundElements: ownBound,
          opacity: i.done ? 50 : undefined, strokeStyle: i.dash ? "dashed" : undefined,
        }),
        buildText({ map: root, uid, ...want, opacity: i.done ? 50 : undefined }),
      );
    } else {
      const el = i.el;
      const p = patchOf(nid);
      if (el.isDeleted) p.isDeleted = false;
      for (const k of ["x", "y", "width", "height"]) if (!close(el[k], rect[k])) p[k] = rect[k];
      if (Math.abs(el.angle || 0) > 1e-6) p.angle = 0;
      // Fill ownership (P4 amendment 10, P12 amendment 20): repaint only on an event, and only a fill Plexus set.
      if (!isRoot && curMM.branch !== undefined && curMM.branch !== branch) p.backgroundColor = fill;
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
        addBodies.push(buildText({ map: root, uid, ...want, opacity: i.done ? 50 : undefined }));
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
        if (i.done && curMM.done !== true) tp.opacity = 50;
        else if (!i.done && curMM.done === true && txtEl.opacity === 50) tp.opacity = 100;
      }
    }

    if (!isRoot) {
      const eid = edgeId(root, uid);
      desiredIds.add(eid);
      const parentUid = v.parent.uid;
      const pid = nodeId(root, parentUid);
      const boneStart = fishbone && v.depth === 1 && spine ? { x: slotX[uid], y: spine.y } : null;
      const g = edgeGeometry(finalRect.get(parentUid), rect, dir, boneStart);
      const e = byId.get(eid);
      const [, [dx, dy]] = g.points;
      const wantEdgeMM = edgeMM(root, parentUid, uid, v.node.via);

      // Bound label: attribute name or "caused by". A live bound text that is not ours (a user's label) wins.
      const lid = labelId(root, uid);
      let label = null;
      const ltext = labels.get(uid);
      if (ltext) {
        const foreign = e && (Array.isArray(e.boundElements) ? e.boundElements : []).some((b) => {
          if (!b || b.type !== "text" || b.id === lid) return false;
          const t = byId.get(b.id);
          return t && !t.isDeleted && t.type === "text";
        });
        if (!foreign) {
          const ls = labelSize(uid, ltext, arrowLabelWrapWidth(Math.abs(dx), LABEL_FONT));
          const lr = arrowLabelRect({ x: g.x, y: g.y, points: g.points }, ls.textWidth, ls.textHeight);
          label = { x: lr.x, y: lr.y, width: ls.textWidth, height: ls.textHeight, text: ls.text, originalText: ltext };
        }
      }
      const edgeBound = label ? [{ id: lid, type: "text" }] : [];
      if (label) {
        desiredIds.add(lid);
        const lt = byId.get(lid);
        if (!lt) addLabels.push(buildLabel({ map: root, childUid: uid, ...label }));
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
          if (!lm || lm.label !== uid || lm.map !== root) lp.customData = withMM(lt.customData, { label: uid, map: root });
        }
      }

      if (!e) {
        addEdges.push(buildEdge({ map: root, parentUid, childUid: uid, ...g, via: v.node.via, unboundStart: !!boneStart, boundElements: edgeBound }));
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
        if (!same(mmOf(e) || null, wantEdgeMM)) ep.customData = withMM(e.customData, wantEdgeMM);
        const eb = mergeBound(e.boundElements, pre, edgeBound);
        if (!same(eb, e.boundElements || [])) ep.boundElements = eb;
      }
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

  ops.add = [...addSpine, ...addEdges, ...addBodies, ...addLabels, ...addBoundaries];

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
