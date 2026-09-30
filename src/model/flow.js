// Process-flow model (Phase 13, unit F1): pure grammar, structure and layout of the "flow" mind-map layout.
// No DOM, no Roam calls. The block tree is the raw outline tree; control blocks (Lane:: and whole-string refs)
// are never steps. mindmap.js re-exports the public names below.
import { taskParts, plainText, hasMarkup, visibleChildren, visualTree, isFolded, countHidden } from "./mindmap.js";

export const FLOW_LAYOUT = "flow";
export const FLOW_DECISION_WRAP = 160;
export const FLOW_ROOT_FONT = 20;
export const FLOW_STEP_FONT = 16;
export const FLOW_CHIP_FONT = 12;
export const FLOW_PAD = 24;
export const FLOW_H_GAP = 40;
export const FLOW_ROW_GAP = 70;
export const FLOW_LANE_GAP = 40;

// ---- grammar ----

const LANE_BLOCK_RE = /^\s*Lane::/;
const LANE_VALUE_RE = /^\s*Lane::\s*([\s\S]*)$/;
const REF_ONLY_RE = /^\(\(([^()\s]+)\)\)$/;
const LABEL_RE = /^([^:\s[\]{}()#][^:\n[\]{}()#]{0,11}):[ \t]+/;
const TOKEN_SRC = String.raw`#(?:decision|end|hazard|CCP\d*)(?![\p{L}\p{N}_/-])|#lane/[\p{L}\p{N}_/-]+|#\[\[(?:lane/[^\]]+|CCP[^\]]*|hazard)\]\]`;
const SUFFIX_RE = new RegExp(String.raw`(?:(?:^|[ \t]+)(?:${TOKEN_SRC}))+[ \t]*$`, "iu");
const TOKEN_RE = new RegExp(TOKEN_SRC, "giu");
const INLINE_LANE_RE = /#\[\[lane\/([^\]]+)\]\]|(?:^|[\s(])#lane\/([\p{L}\p{N}_/-]+)/giu;

const tidy = (s) => String(s).replace(/\s+/g, " ").trim();
const tagsOf = (suffix) => (suffix ? suffix.match(TOKEN_RE) || [] : []);
const hasTag = (suffix, name) => tagsOf(suffix).some((t) => t.toLowerCase() === `#${name}`);

/**
 * Flow text split: `task` (macro prefix), `label` (branch children only, "Yes"), `body` (what is drawn) and
 * `suffix` (the trailing run of flow tags, whitespace included). task + label + body + suffix rebuild the block.
 */
export function flowParts(string, { branch = false } = {}) {
  const s = typeof string === "string" ? string : "";
  const tp = taskParts(s);
  let rest = tp.rest;
  let label = "";
  if (branch) {
    const m = LABEL_RE.exec(rest);
    if (m) { label = m[1]; rest = rest.slice(m[0].length); }
  }
  const sm = SUFFIX_RE.exec(rest);
  return { task: tp.prefix, label, body: sm ? rest.slice(0, sm.index) : rest, suffix: sm ? sm[0] : "" };
}

export const branchLabel = (string) => flowParts(string, { branch: true }).label;

/** A step whose drawn text ends with "?" or that carries #decision. */
export function isDecision(string, opts) {
  const p = flowParts(string, opts);
  return p.body.trimEnd().endsWith("?") || hasTag(p.suffix, "decision");
}

export const isEndStep = (string, opts) => hasTag(flowParts(string, opts).suffix, "end");

/** Chips of a step: at most one CCP (n 0) and one hazard (n 1), from the trailing tags. */
export function chipsOf(string, opts) {
  const out = [];
  let ccp = null;
  let hazard = false;
  for (const t of tagsOf(flowParts(string, opts).suffix)) {
    const low = t.toLowerCase();
    if (ccp === null && (low.startsWith("#ccp") || low.startsWith("#[[ccp"))) {
      const rest = low.startsWith("#[[") ? t.slice(3, -2).replace(/^CCP/i, "").trim() : t.slice(4).trim();
      ccp = rest ? `CCP ${rest}` : "CCP";
    } else if (low === "#hazard" || low === "#[[hazard]]") hazard = true;
  }
  if (ccp !== null) out.push({ kind: "ccp", text: ccp });
  if (hazard) out.push({ kind: "hazard", text: "Hazard" });
  return out;
}

/** Lane name of a step read from its RAW children (works when folded): a `Lane::` child, else the first inline tag; null when none. */
export function laneOf(node) {
  if (!node) return null;
  for (const c of node.children || []) {
    const m = LANE_VALUE_RE.exec(typeof c.string === "string" ? c.string : "");
    if (!m) continue;
    const v = m[1].trim();
    if (v === "") continue;
    const name = tidy(plainText(v));
    if (name !== "" && name !== "·") return name;
  }
  const s = typeof node.string === "string" ? node.string : "";
  const re = new RegExp(INLINE_LANE_RE.source, "giu");
  const m = re.exec(s);
  if (m) {
    const name = tidy(m[1] !== undefined ? m[1] : m[2]);
    if (name !== "") return name;
  }
  return null;
}

// ---- control blocks and the drawn tree ----

const isLaneBlock = (c) => LANE_BLOCK_RE.test(typeof c.string === "string" ? c.string : "");
const refTarget = (c) => {
  const m = REF_ONLY_RE.exec(typeof c.string === "string" ? c.string.trim() : "");
  return m ? m[1] : null;
};
const hasDrawableKids = (c) => c.children.some((k) => !isLaneBlock(k) && refTarget(k) === null);

/**
 * Control blocks of a flow tree: Lane:: blocks and qualified whole-string refs. `controls` holds their uids;
 * `refs` maps a qualified ref uid to {uid, parent, target}. A ref qualifies only with no drawable children, a
 * target that is a step of the same flow (or the root) and that is not the ref itself or its parent.
 */
export function flowControls(tree) {
  const controls = new Set();
  const refs = new Map();
  if (!tree) return { controls, refs };
  const steps = new Set([tree.uid]);
  const cands = [];
  (function walk(n) {
    for (const c of n.children) {
      if (isLaneBlock(c)) { controls.add(c.uid); continue; }
      const t = refTarget(c);
      if (t !== null && !hasDrawableKids(c)) cands.push({ uid: c.uid, parent: n.uid, target: t });
      else steps.add(c.uid);
      walk(c);
    }
  })(tree);
  for (const c of cands) {
    if (controls.has(c.parent)) { controls.add(c.uid); continue; }
    if (!steps.has(c.target) || c.target === c.uid || c.target === c.parent) continue;
    controls.add(c.uid);
    refs.set(c.uid, c);
  }
  return { controls, refs };
}

function prune(n, controls) {
  return { ...n, children: n.children.filter((c) => !controls.has(c.uid)).map((c) => prune(c, controls)) };
}

/**
 * The tree the canvas draws. Flow: control blocks removed at every level, attribute edges ignored; any other
 * layout: exactly visualTree(tree, {attrEdges}).
 */
export function drawnTree(tree, { layout, attrEdges = false } = {}) {
  if (!tree) return tree;
  if (layout !== FLOW_LAYOUT) return visualTree(tree, { attrEdges });
  return prune(tree, flowControls(tree).controls);
}

/**
 * New block string for a flow node whose bound text now shows `displayed`; null when it cannot be written back.
 * Pass a node of drawnTree so the fold suffix counts drawn descendants.
 */
export function flowEditable(node, displayed, { branch = false } = {}) {
  if (!node || typeof displayed !== "string") return null;
  let text = displayed;
  if (isFolded(node)) {
    const suffix = ` (+${countHidden(node)})`;
    if (!text.endsWith(suffix)) return null;
    text = text.slice(0, -suffix.length);
  }
  const parts = flowParts(node.string, { branch });
  if (parts.task) {
    if (text.startsWith("☐ ") || text.startsWith("☑ ")) text = text.slice(2);
    else if (text === "☐" || text === "☑") text = "";
  }
  if (hasMarkup(parts.body)) return null;
  if (text === "" || text === "·") return null;
  const next = parts.task + (parts.label ? `${parts.label}: ` : "") + text + parts.suffix;
  return next === node.string ? null : next;
}

// ---- structure ----

/**
 * Steps, edges and ranks of a raw flow tree (no sizes). steps: DFS pre-order of drawn steps
 * {uid, node, parentUid, pred, rank, lane, type: root|decision|end|step, branchHead, label, chips};
 * edges: {from, to, kind: seq|branch|merge|loop, label, primary, via?}. `dtree` is the drawn tree.
 */
export function flowStructure(tree) {
  const out = { root: tree ? tree.uid : null, steps: [], byUid: new Map(), edges: [], lanes: [""], hasLanes: false, dtree: null };
  if (!tree) return out;
  const { controls, refs } = flowControls(tree);
  const dtree = prune(tree, controls);
  out.dtree = dtree;
  const raw = new Map();
  const parentRaw = new Map();
  (function idx(n, p) {
    raw.set(n.uid, n);
    parentRaw.set(n.uid, p);
    for (const c of n.children) if (!controls.has(c.uid)) idx(c, n.uid);
  })(tree, null);
  const visible = new Set();
  (function vis(n) { visible.add(n.uid); for (const c of visibleChildren(n)) vis(c); })(dtree);
  const resolve = (uid) => {
    let u = uid;
    while (u != null && !visible.has(u)) u = parentRaw.get(u) ?? null;
    return u;
  };
  const loopsOf = new Map();
  for (const r of refs.values()) {
    const p = raw.get(r.parent);
    if (!p || !visible.has(r.parent) || p.open === false) continue;
    const to = resolve(r.target);
    if (to == null || to === r.parent) continue;
    if (!loopsOf.has(r.parent)) loopsOf.set(r.parent, []);
    loopsOf.get(r.parent).push({ from: r.parent, to, kind: "loop", label: "", primary: false, via: r.uid });
  }

  const add = (node, parentUid, type, rank, lane, pred, branchHead, label, chips) => {
    const step = { uid: node.uid, node, parentUid, pred, rank, lane, type, branchHead, label, chips };
    out.steps.push(step);
    out.byUid.set(node.uid, step);
    return step;
  };
  add(dtree, null, "root", 0, "", null, false, "", []);

  // pending: dangling arrows {from, kind: seq|branch|merge, noMerge} waiting for the next step of the sequence.
  function processStep(node, parentUid, pending, laneFromUid, branchHead) {
    const parts = flowParts(node.string, { branch: branchHead });
    const kids = visibleChildren(node);
    const dec = isDecision(node.string, { branch: branchHead });
    const withBranches = dec && kids.length > 0;
    const isEnd = !dec && hasTag(parts.suffix, "end");
    const tagEnd = hasTag(parts.suffix, "end");
    const laneFrom = out.byUid.get(laneFromUid);
    const primary = pending.length === 1 && pending[0].kind !== "merge" ? pending[0] : null;
    const rank = pending.length ? 1 + Math.max(...pending.map((p) => out.byUid.get(p.from).rank)) : laneFrom.rank + 1;
    const explicit = laneOf(raw.get(node.uid));
    const lane = explicit !== null ? explicit : primary ? out.byUid.get(primary.from).lane : laneFrom.lane;
    const step = add(node, parentUid, dec ? "decision" : isEnd ? "end" : "step", rank, lane, primary ? primary.from : null, branchHead && !!primary, parts.label, chipsOf(node.string, { branch: branchHead }));
    if (primary) out.edges.push({ from: primary.from, to: node.uid, kind: primary.kind, label: branchHead ? parts.label : "", primary: true });
    else for (const p of pending) out.edges.push({ from: p.from, to: node.uid, kind: "merge", label: "", primary: false });
    if (withBranches) {
      const tails = [];
      for (const k of kids) {
        for (const t of processStep(k, node.uid, [{ from: node.uid, kind: "branch" }], node.uid, true)) {
          if (!t.noMerge) tails.push({ from: t.from, kind: "merge", noMerge: false });
        }
      }
      return tails;
    }
    const own = tagEnd ? [] : [{ from: node.uid, kind: "seq", noMerge: (loopsOf.get(node.uid) || []).length > 0 }];
    if (kids.length === 0) return own;
    const rest = processSeq(kids, own, node.uid);
    return tagEnd ? [] : rest;
  }
  function processSeq(items, pending, ownerUid) {
    let p = pending;
    let prev = ownerUid;
    for (const it of items) {
      p = processStep(it, ownerUid, p, prev, false);
      prev = it.uid;
    }
    return p;
  }
  processSeq(visibleChildren(dtree), [{ from: dtree.uid, kind: "seq", noMerge: false }], dtree.uid);

  for (const s of out.steps) for (const l of loopsOf.get(s.uid) || []) out.edges.push(l);
  const seen = new Set([""]);
  for (const s of out.steps) if (!seen.has(s.lane)) { seen.add(s.lane); out.lanes.push(s.lane); }
  out.hasLanes = out.lanes.length > 1;
  return out;
}

// ---- layout ----

/**
 * Positions for every step, chip rectangles and lane frames. sizes: uid -> {width, height} (final container
 * sizes); chipSize(uid, index, chip) -> {width, height}; labelWidth(uid) -> width of the branch label. The root
 * keeps `anchor` (its top-left). Rows are ranks; a (lane, rank) cell lays its steps side by side in DFS order.
 */
export function flowLayout(struct, { sizes, chipSize = () => ({ width: 40, height: 20 }), labelWidth = () => 0, anchor = { x: 0, y: 0 } }) {
  const positions = {};
  const chips = new Map();
  const frames = [];
  const steps = struct.steps;
  if (steps.length === 0) return { positions, chips, frames };
  const sz = (uid) => sizes[uid] || { width: 0, height: 0 };
  const ranks = [...new Set(steps.map((s) => s.rank))].sort((a, b) => a - b);
  const cell = new Map();
  for (const s of steps) {
    const k = `${s.rank}\n${s.lane}`;
    if (!cell.has(k)) cell.set(k, []);
    cell.get(k).push(s);
  }
  const rowH = new Map();
  for (const r of ranks) rowH.set(r, 0);
  for (const s of steps) rowH.set(s.rank, Math.max(rowH.get(s.rank), sz(s.uid).height));
  const rowY = new Map();
  let y = 0;
  for (const r of ranks) { rowY.set(r, y); y += rowH.get(r) + FLOW_ROW_GAP; }
  const totalH = y - FLOW_ROW_GAP;
  const gapBetween = (a, b) => Math.max(FLOW_H_GAP, Math.max(labelWidth(a.uid), labelWidth(b.uid)) + 24);
  const cellW = (members) => {
    let w = 0;
    members.forEach((m, i) => { w += sz(m.uid).width + (i ? gapBetween(members[i - 1], m) : 0); });
    return w;
  };
  const chipRects = new Map();
  for (const s of steps) {
    if (s.chips.length) chipRects.set(s.uid, s.chips.map((c, i) => ({ ...c, ...chipSize(s.uid, i, c) })));
  }
  const inner = new Map();
  const over = new Map();
  for (const lane of struct.lanes) { inner.set(lane, 0); over.set(lane, 0); }
  for (const [k, members] of cell) {
    const lane = k.slice(k.indexOf("\n") + 1);
    inner.set(lane, Math.max(inner.get(lane), cellW(members)));
  }
  for (const s of steps) {
    const cr = chipRects.get(s.uid);
    if (cr) over.set(s.lane, Math.max(over.get(s.lane), cr[0].width / 2));
  }
  const colX = new Map();
  const colW = new Map();
  let x = 0;
  for (const lane of struct.lanes) {
    const w = inner.get(lane) + 2 * FLOW_PAD + over.get(lane);
    colX.set(lane, x);
    colW.set(lane, w);
    x += w + FLOW_LANE_GAP;
  }
  for (const [k, members] of cell) {
    const [rs, lane] = [Number(k.slice(0, k.indexOf("\n"))), k.slice(k.indexOf("\n") + 1)];
    let cx = colX.get(lane) + FLOW_PAD + (inner.get(lane) - cellW(members)) / 2;
    members.forEach((m, i) => {
      if (i) cx += gapBetween(members[i - 1], m);
      const s = sz(m.uid);
      positions[m.uid] = { x: cx, y: rowY.get(rs) + (rowH.get(rs) - s.height) / 2 };
      cx += s.width;
    });
  }
  const dx = anchor.x - positions[struct.root].x;
  const dy = anchor.y - positions[struct.root].y;
  for (const uid of Object.keys(positions)) positions[uid] = { x: positions[uid].x + dx, y: positions[uid].y + dy };
  for (const s of steps) {
    const cr = chipRects.get(s.uid);
    if (!cr) continue;
    const p = positions[s.uid];
    const w = sz(s.uid).width;
    let cx = p.x + w - cr[0].width / 2;
    chips.set(s.uid, cr.map((c, i) => {
      if (i) cx -= c.width + 4;
      return { ...c, x: cx, y: p.y - c.height / 2 };
    }));
  }
  for (const lane of struct.lanes) {
    if (lane === "") continue;
    frames.push({ name: lane, x: colX.get(lane) + dx, y: -FLOW_PAD + dy, width: colW.get(lane), height: totalH + 2 * FLOW_PAD });
  }
  return { positions, chips, frames };
}

/** Shape-aware exit of the ray from a shape's centre towards (tx, ty): distance from the centre to the outline. */
function exitDistance(r, tx, ty) {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { ux: 0, uy: 1, d: 0, cx, cy };
  const hw = r.width / 2;
  const hh = r.height / 2;
  let s;
  if (r.type === "diamond") s = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  else if (r.type === "ellipse") s = 1 / Math.hypot(dx / hw, dy / hh);
  else s = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
  return { ux: dx / len, uy: dy / len, d: s * len, cx, cy };
}

/**
 * Straight route between two shapes {x, y, width, height, type}. adjacent: same-lane primary edge between
 * neighbouring ranks, drawn bottom-centre to top-centre. Otherwise centre to centre, clipped to each outline
 * plus `gap`. Returns {x, y, points} like edgeGeometry.
 */
export function flowRoute(a, b, adjacent, gap) {
  let sx; let sy; let ex; let ey;
  if (adjacent) {
    sx = a.x + a.width / 2; sy = a.y + a.height; ex = b.x + b.width / 2; ey = b.y;
  } else {
    const bx = b.x + b.width / 2;
    const by = b.y + b.height / 2;
    const ax = a.x + a.width / 2;
    const ay = a.y + a.height / 2;
    const ea = exitDistance(a, bx, by);
    const eb = exitDistance(b, ax, ay);
    sx = ea.cx + ea.ux * (ea.d + gap); sy = ea.cy + ea.uy * (ea.d + gap);
    ex = eb.cx + eb.ux * (eb.d + gap); ey = eb.cy + eb.uy * (eb.d + gap);
  }
  return { x: sx, y: sy, points: [[0, 0], [ex - sx, ey - sy]] };
}

/** Contract shape: {steps, edges, lanes, chips}; positions and frames too when `sizes` (uid -> {width, height}) is given. */
export function flowPlan(tree, { sizes, chipSize, labelWidth, anchor } = {}) {
  const st = flowStructure(tree);
  const lay = sizes ? flowLayout(st, { sizes, chipSize, labelWidth, anchor }) : { positions: {}, chips: new Map(), frames: [] };
  return { steps: st.steps, edges: st.edges, lanes: st.lanes, chips: lay.chips, positions: lay.positions, frames: lay.frames };
}
