import { createBuilder } from "./build.js";

// Plexus Canvas cause-and-effect JSON -> Excalidraw elements (P12 MM-11 JSON route). Pure: no scene, no DOM.
// Schema: {nodes: [{id, text, role, category?, terminator?}], edges: [{effect, cause}], connections: [{from, to, label}]}.
export const CE_LAYOUTS = Object.freeze(["tree", "fishbone", "pentagon"]);
export const CE_MAX_NODES = 300;
export const CE_MAX_EDGES = 1000;
export const CE_MAX_CONNECTIONS = 500;
export const CE_ROLE_COLOR = Object.freeze({ primary: "#7c5cff", action: "#0ea5e9", condition: "#10b981", neutral: "#64748b" });
export const CE_TERM_COLOR = Object.freeze({ end: "#ef4444", question: "#0ea5e9" });
export const CE_CONNECTOR_COLOR = "#f97316";
const EDGE_COLOR = "#94a3b8";
const SPINE_COLOR = "#64748b";
const FONT = 16;
const MIN_W = 152;
const MIN_H = 50;
const H_GAP = 88;
const V_GAP = 30;

export function tintColor(hex) {
  const h = String(hex || "#7c5cff").replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const chan = (i, fallback) => { const v = parseInt(n.slice(i, i + 2), 16); return Number.isNaN(v) ? fallback : v; };
  const r = chan(0, 124);
  const g = chan(2, 92);
  const b = chan(4, 255);
  const mix = (c) => Math.round(c + (255 - c) * 0.78);
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

// Validates and normalises the input (object or JSON string). Throws on unusable input; counts what it skips.
export function parseChart(input) {
  let chart = input;
  if (typeof input === "string") {
    try { chart = JSON.parse(input); } catch (error) { throw new Error(`Invalid JSON: ${error.message}`); }
  }
  if (!chart || typeof chart !== "object" || Array.isArray(chart)) throw new Error("Chart must be an object with a nodes array");
  if (!Array.isArray(chart.nodes) || !chart.nodes.length) throw new Error("Chart needs a non-empty nodes array");
  if (chart.nodes.length > CE_MAX_NODES) throw new Error(`Chart has ${chart.nodes.length} nodes; the limit is ${CE_MAX_NODES}`);
  let skipped = 0;
  const nodes = [];
  const known = new Set();
  for (const n of chart.nodes) {
    if (!n || typeof n !== "object" || n.id === undefined || n.id === null) { skipped += 1; continue; }
    const id = String(n.id);
    if (known.has(id)) { skipped += 1; continue; }
    known.add(id);
    const role = Object.hasOwn(CE_ROLE_COLOR, n.role) ? n.role : "neutral";
    nodes.push({ id, text: String(n.text ?? ""), role, category: n.category, terminator: Object.hasOwn(CE_TERM_COLOR, n.terminator) ? n.terminator : null });
  }
  if (!nodes.length) throw new Error("Chart has no usable nodes");
  const edges = [];
  const edgeKeys = new Set();
  for (const e of Array.isArray(chart.edges) ? chart.edges : []) {
    const effect = e && e.effect !== undefined && e.effect !== null ? String(e.effect) : null;
    const cause = e && e.cause !== undefined && e.cause !== null ? String(e.cause) : null;
    if (!known.has(effect) || !known.has(cause) || effect === cause) { skipped += 1; continue; }
    const key = `${effect}\u0000${cause}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push({ effect, cause });
    if (edges.length > CE_MAX_EDGES) throw new Error(`Chart has more than ${CE_MAX_EDGES} edges; the limit is ${CE_MAX_EDGES}`);
  }
  const connections = [];
  for (const c of Array.isArray(chart.connections) ? chart.connections : []) {
    const from = c && c.from !== undefined && c.from !== null ? String(c.from) : null;
    const to = c && c.to !== undefined && c.to !== null ? String(c.to) : null;
    if (!known.has(from) || !known.has(to) || from === to) { skipped += 1; continue; }
    connections.push({ from, to, label: c.label ? String(c.label) : "" });
    if (connections.length > CE_MAX_CONNECTIONS) throw new Error(`Chart has more than ${CE_MAX_CONNECTIONS} connections; the limit is ${CE_MAX_CONNECTIONS}`);
  }
  const root = (nodes.find((n) => n.role === "primary") || nodes[0]).id;
  return { nodes, edges, connections, root, skipped };
}

function nodeLabel(n) {
  const star = n.role === "primary" ? "★ " : "";
  const m = n.text.match(/^([^:]{1,32}:)\s*([\s\S]*)$/);
  if (m) return m[2] ? `${star}${m[1]}\n${m[2]}` : `${star}${m[1]}`;
  return star + n.text;
}

// Tree grid (also used by pentagon): depth is a column, leaves are rows, a parent sits at the mean of its children.
function treeCentres(nodes, kids, root, maxW, maxH) {
  const depthOf = new Map();
  const rowOf = new Map();
  const seen = new Set();
  let leaf = 0;
  const forward = [];
  const state = new Map();
  const mark = (id) => {
    state.set(id, 1);
    for (const k of kids.get(id) || []) {
      if (state.get(k) === 1) continue;
      forward.push([id, k]);
      if (!state.has(k)) mark(k);
    }
    state.set(id, 2);
  };
  mark(root);
  depthOf.set(root, 0);
  for (let round = 0; round < nodes.length; round++) {
    let moved = false;
    for (const [e, c] of forward) {
      if (!depthOf.has(e)) continue;
      const d = depthOf.get(e) + 1;
      if (!(depthOf.get(c) >= d)) { depthOf.set(c, d); moved = true; }
    }
    if (!moved) break;
  }
  const walk = (id) => {
    if (seen.has(id)) return rowOf.get(id);
    seen.add(id);
    const rows = (kids.get(id) || []).map((k) => walk(k)).filter((r) => r !== undefined);
    if (!rows.length) { rowOf.set(id, leaf++); return rowOf.get(id); }
    rowOf.set(id, (rows[0] + rows[rows.length - 1]) / 2);
    return rowOf.get(id);
  };
  walk(root);
  for (const n of nodes) if (!seen.has(n.id)) { seen.add(n.id); depthOf.set(n.id, 0); rowOf.set(n.id, leaf++); }
  const centres = new Map();
  for (const n of nodes) centres.set(n.id, { x: depthOf.get(n.id) * (maxW + H_GAP) + maxW / 2, y: rowOf.get(n.id) * (maxH + V_GAP) + maxH / 2 });
  return { centres, lines: [] };
}

// Ishikawa: the effect is the head at the right of a spine; level-1 causes alternate above and below as bones.
function fishboneCentres(nodes, kids, root, sizes, maxW, maxH) {
  const fy = Math.max(1, (maxH + V_GAP) / 80);
  const fx = Math.max(0, maxW - MIN_W);
  const majors = kids.get(root) || [];
  const M = Math.max(majors.length, 1);
  const headX = (M + 1) * 120 + 40;
  const centres = new Map();
  const lines = [];
  const placed = new Set([root]);
  centres.set(root, { x: headX + maxW / 2, y: 0 });
  lines.push({ kind: "spine", from: [0, 0], to: [headX + maxW / 2 - sizes.get(root).width / 2, 0] });
  const branch = (id, side, ax, ay) => {
    if (placed.has(id)) return;
    placed.add(id);
    const bx = ax - (170 + fx);
    const by = ay + side * 130 * fy;
    centres.set(id, { x: bx + maxW / 2, y: by });
    lines.push({ kind: "bone", from: [ax, ay], to: [bx + maxW / 2 + sizes.get(id).width / 2, by] });
    (kids.get(id) || []).forEach((k, j) => branch(k, side, bx + 30, by + side * (70 + j * 80) * fy));
  };
  majors.forEach((m, i) => branch(m, i % 2 === 0 ? -1 : 1, headX - ((i + 1) * headX) / (M + 1), 0));
  let extra = 0;
  for (const n of nodes) if (!placed.has(n.id)) { placed.add(n.id); centres.set(n.id, { x: -120 - maxW / 2, y: -300 * fy + extra++ * (maxH + V_GAP) }); }
  return { centres, lines };
}

function bboxOf(el) {
  if (Array.isArray(el.points)) {
    const xs = el.points.map((p) => el.x + p[0]);
    const ys = el.points.map((p) => el.y + p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  return [el.x, el.y, el.x + el.width, el.y + el.height];
}

// Shifts every element; arrow and line points are relative, so only x and y move.
export function translateElements(elements, dx, dy) {
  for (const el of elements) { el.x += dx; el.y += dy; }
  return elements;
}

/**
 * chartToElements(chart, {layout: "tree" | "fishbone" | "pentagon", origin: {x, y}, measure, newId, random})
 * -> {chart, elements, ids, skipped, layout}. origin is where the centre of the chart's bounding box lands (default 0, 0).
 * Throws on invalid input. Every element carries customData.plexus.ce.
 */
export function chartToElements(input, { layout = "tree", origin = { x: 0, y: 0 }, measure, newId, random = Math.random } = {}) {
  if (!CE_LAYOUTS.includes(layout)) throw new Error(`Unknown layout ${layout}`);
  const { nodes, edges, connections, root, skipped } = parseChart(input);
  const chartId = `ce-${Array.from({ length: 8 }, () => Math.floor(random() * 16).toString(16)).join("")}`;
  const mark = (extra) => ({ plexus: { ce: { chart: chartId, ...extra } } });
  const b = createBuilder({ measure, newId, style: { fontSize: FONT, fontFamily: 5, roughness: 0 } });
  const pent = layout === "pentagon";
  const gid = `g${chartId}`;

  const boxes = new Map();
  for (const n of nodes) {
    const color = CE_ROLE_COLOR[n.role];
    const head = pent && n.id === root;
    boxes.set(n.id, b.box(nodeLabel(n), {
      strokeColor: head ? "transparent" : color,
      backgroundColor: head ? "transparent" : tintColor(color),
      textColor: "#1e1e1e",
      minWidth: MIN_W, minHeight: MIN_H,
      ...(head ? { groupIds: [gid] } : {}),
      customData: mark({ node: n.id }),
    }));
  }
  const sizes = new Map(nodes.map((n) => [n.id, b.size(boxes.get(n.id))]));
  const maxW = Math.max(...[...sizes.values()].map((s) => s.width));
  const maxH = Math.max(...[...sizes.values()].map((s) => s.height));
  const kids = new Map();
  const isEffect = new Set();
  for (const e of edges) {
    if (!kids.has(e.effect)) kids.set(e.effect, []);
    kids.get(e.effect).push(e.cause);
    isEffect.add(e.effect);
  }
  const { centres, lines } = layout === "fishbone" ? fishboneCentres(nodes, kids, root, sizes, maxW, maxH) : treeCentres(nodes, kids, root, maxW, maxH);
  const rects = new Map();
  for (const n of nodes) {
    const c = centres.get(n.id);
    const s = sizes.get(n.id);
    rects.set(n.id, { x: c.x - s.width / 2, y: c.y - s.height / 2, w: s.width, h: s.height });
    b.place(boxes.get(n.id), c.x - s.width / 2, c.y - s.height / 2);
  }

  const front = [];
  if (layout === "fishbone") {
    for (const ln of lines) {
      const spine = ln.kind === "spine";
      b.line(ln.from[0], ln.from[1], [[0, 0], [ln.to[0] - ln.from[0], ln.to[1] - ln.from[1]]], { strokeColor: spine ? SPINE_COLOR : EDGE_COLOR, strokeWidth: spine ? 3 : 2, roughness: 0, customData: mark({ line: ln.kind }) });
    }
  } else {
    for (const e of edges) b.arrow(boxes.get(e.effect), boxes.get(e.cause), { label: "caused by", strokeColor: EDGE_COLOR, roughness: 0, customData: mark({ edge: [e.effect, e.cause] }) });
  }
  if (pent) {
    const r = rects.get(root);
    const color = CE_ROLE_COLOR[nodes.find((n) => n.id === root).role];
    const body = r.w * 0.72;
    front.push(b.line(r.x, r.y, [[0, 0], [body, 0], [r.w, r.h / 2], [body, r.h], [0, r.h], [0, 0]], { strokeColor: color, backgroundColor: tintColor(color), roughness: 0, groupIds: [gid], customData: mark({ line: "pentagon" }) }));
    let maxRight = -Infinity;
    for (const rc of rects.values()) maxRight = Math.max(maxRight, rc.x + rc.w);
    front.unshift(b.line(r.x + r.w, r.y + r.h / 2, [[0, 0], [maxRight + 20 - (r.x + r.w), 0]], { strokeColor: SPINE_COLOR, strokeWidth: 3, roughness: 0, customData: mark({ line: "spine" }) }));
  }
  for (const c of connections) {
    b.arrow(boxes.get(c.from), boxes.get(c.to), { label: c.label || "Connects to", strokeColor: CE_CONNECTOR_COLOR, strokeStyle: "dashed", roughness: 0, customData: mark({ conn: [c.from, c.to] }) });
  }
  for (const n of nodes) {
    if (!n.terminator || isEffect.has(n.id)) continue;
    const r = rects.get(n.id);
    const tcol = CE_TERM_COLOR[n.terminator];
    const x = r.x + r.w + 16 - 11;
    const y = r.y + r.h / 2 - 11;
    const opts = { strokeColor: tcol, backgroundColor: tintColor(tcol), roughness: 0, customData: mark({ terminator: n.id }) };
    if (n.terminator === "question") b.box("?", { ...opts, type: "ellipse", x, y, width: 22, height: 22, textColor: tcol });
    else b.ellipse(x, y, 22, 22, opts);
  }

  const built = b.elements();
  const frontSet = new Set(front);
  const elements = [...built.filter((e) => frontSet.has(e.id)).sort((p, q) => front.indexOf(p.id) - front.indexOf(q.id)), ...built.filter((e) => !frontSet.has(e.id))];
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const el of elements) {
    const [a, c, d, e] = bboxOf(el);
    x1 = Math.min(x1, a); y1 = Math.min(y1, c); x2 = Math.max(x2, d); y2 = Math.max(y2, e);
  }
  const at = origin && Number.isFinite(origin.x) && Number.isFinite(origin.y) ? origin : { x: 0, y: 0 };
  translateElements(elements, at.x - (x1 + x2) / 2, at.y - (y1 + y2) / 2);
  return { chart: chartId, elements, ids: elements.map((e) => e.id), skipped, layout };
}
