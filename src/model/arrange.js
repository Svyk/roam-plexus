// AUTH-9 arrange (Phase 13, unit A): pure layout operations over units (groups, frames with children, singles).
import { arrowLabelRect } from "./arrowlabel.js";
import { baseElement } from "./embeds.js";
import { applyOrderRewrite, bumped, frameId as newFrameId, planOrders } from "./frames.js";
import { commonBounds, liveElements } from "./scene.js";

export const ARRANGE_GAP = 40;
export const BOX_PAD = 24;
export const IMAGE_CELL = 240;
export const FRAME_PAD = 24;
export const ARROW_GAP = 4;
export const UNTANGLE_MAX = 200;
export const UNTANGLE_ITERATIONS = 200;
export const MAP_MESSAGE = "Map nodes follow the outline";
const TEXT_PAD = 5;
const GOLDEN = 2.399963229728653;
const RESIZABLE = new Set(["rectangle", "diamond", "ellipse", "image", "embeddable", "iframe"]);

const isFrameLike = (el) => el.type === "frame" || el.type === "magicframe";
const isMap = (el) => typeof el.id === "string" && el.id.startsWith("pmm-");
const isLinear = (el) => el.type === "arrow" || el.type === "line";
const isBoundLinear = (el) => isLinear(el) && !!(el.startBinding || el.endBinding);
const num = (v) => Number(v) || 0;
const rectOf = (el) => ({ x: num(el.x), y: num(el.y), width: num(el.width), height: num(el.height) });
const half = (v) => Math.round(v * 2) / 2;
const intersects = (b, r) => b[0] < r.x + r.width && b[2] > r.x && b[1] < r.y + r.height && b[3] > r.y;

// ---- Excalidraw 0.18.0 bound-text geometry (textElement.ts:233-275, 349-366, 437-500) ----
export function getContainerCoords(container) {
  let offsetX = TEXT_PAD;
  let offsetY = TEXT_PAD;
  if (container.type === "ellipse") {
    offsetX += (container.width / 2) * (1 - Math.SQRT2 / 2);
    offsetY += (container.height / 2) * (1 - Math.SQRT2 / 2);
  }
  if (container.type === "diamond") {
    offsetX += container.width / 4;
    offsetY += container.height / 4;
  }
  return { x: container.x + offsetX, y: container.y + offsetY };
}

const innerWidth = (c) => {
  if (c.type === "ellipse") return Math.round((c.width / 2) * Math.SQRT2) - TEXT_PAD * 2;
  if (c.type === "diamond") return Math.round(c.width / 2) - TEXT_PAD * 2;
  return c.width - TEXT_PAD * 2;
};
const innerHeight = (c) => {
  if (c.type === "ellipse") return Math.round((c.height / 2) * Math.SQRT2) - TEXT_PAD * 2;
  if (c.type === "diamond") return Math.round(c.height / 2) - TEXT_PAD * 2;
  return c.height - TEXT_PAD * 2;
};

// Top-left of the bound text for a (non-arrow) container, honouring verticalAlign and textAlign.
export function computeBoundTextPosition(container, text) {
  const coords = getContainerCoords(container);
  const maxW = innerWidth(container);
  const maxH = innerHeight(container);
  let y;
  if (text.verticalAlign === "top") y = coords.y;
  else if (text.verticalAlign === "bottom") y = coords.y + (maxH - text.height);
  else y = coords.y + (maxH / 2 - text.height / 2);
  let x;
  if (text.textAlign === "left") x = coords.x;
  else if (text.textAlign === "right") x = coords.x + (maxW - text.width);
  else x = coords.x + (maxW / 2 - text.width / 2);
  return { x, y };
}

// ---- arrow routing ----
// Distance from the centre of `el` along the unit vector (dx, dy) to its outline (axis-aligned shape).
function exitDistance(el, dx, dy) {
  const hw = num(el.width) / 2;
  const hh = num(el.height) / 2;
  if (el.type === "ellipse") return 1 / Math.sqrt((dx / (hw || 1e-9)) ** 2 + (dy / (hh || 1e-9)) ** 2);
  if (el.type === "diamond") return 1 / (Math.abs(dx) / (hw || 1e-9) + Math.abs(dy) / (hh || 1e-9));
  const tx = dx ? hw / Math.abs(dx) : Infinity;
  const ty = dy ? hh / Math.abs(dy) : Infinity;
  return Math.min(tx, ty);
}

const centreOf = (el) => [num(el.x) + num(el.width) / 2, num(el.y) + num(el.height) / 2];

function pointsPatch(abs) {
  const [x, y] = abs[0];
  const points = abs.map(([px, py]) => [px - x, py - y]);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { x, y, points, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

// Straight re-route of a 2-point arrow between two boxes (their new state): centre to centre, clipped to each shape
// plus the binding gap. Keeps both bindings, focus 0. Returns a patch, or null when the shapes overlap or coincide.
export function routeArrow(arrow, startEl, endEl) {
  const [sx, sy] = centreOf(startEl);
  const [ex, ey] = centreOf(endEl);
  const dist = Math.hypot(ex - sx, ey - sy);
  if (dist < 1e-6) return null;
  const ux = (ex - sx) / dist;
  const uy = (ey - sy) / dist;
  const gs = num(arrow.startBinding?.gap ?? ARROW_GAP);
  const ge = num(arrow.endBinding?.gap ?? ARROW_GAP);
  const a = exitDistance(startEl, ux, uy) + gs;
  const b = exitDistance(endEl, -ux, -uy) + ge;
  if (a + b >= dist) return null;
  const patch = pointsPatch([[sx + ux * a, sy + uy * a], [ex - ux * b, ey - uy * b]]);
  patch.angle = 0;
  if (arrow.startBinding) patch.startBinding = { ...arrow.startBinding, focus: 0 };
  if (arrow.endBinding) patch.endBinding = { ...arrow.endBinding, focus: 0 };
  return patch;
}

// ---- units ----
function boundTextsOf(live) {
  const map = new Map();
  for (const el of live) {
    if (el.type === "text" && el.containerId) {
      if (!map.has(el.containerId)) map.set(el.containerId, []);
      map.get(el.containerId).push(el);
    }
  }
  return map;
}

// { units, mapSkipped }. A unit: { key, kind: "single"|"group"|"frame", root, frame?, children, members, ids, bounds }.
// members are the elements that move with the unit (bound-arrow elements and their labels are re-routed instead).
export function arrangeUnits(elements, selectionIds) {
  const live = liveElements(elements);
  const byId = new Map(live.map((el) => [el.id, el]));
  const order = new Map(live.map((el, i) => [el.id, i]));
  return unitsOf(live, byId, order, boundTextsOf(live), (selectionIds || []).map((id) => byId.get(id)).filter(Boolean), true);
}

function unitsOf(live, byId, order, texts, picked, withFrames) {
  let mapSkipped = 0;
  const followsArrow = (el) => el.type === "text" && el.containerId && byId.get(el.containerId) && isBoundLinear(byId.get(el.containerId));
  const movable = (el) => !isBoundLinear(el) && !followsArrow(el);
  const expand = (roots) => {
    const ids = new Set(roots.map((r) => r.id));
    const out = roots.filter(movable);
    for (const r of roots) {
      for (const t of texts.get(r.id) || []) {
        if (!ids.has(t.id) && movable(t)) { ids.add(t.id); out.push(t); }
      }
    }
    return out;
  };
  const eligible = [];
  for (const el of picked) {
    if (isMap(el)) { mapSkipped++; continue; }
    if (el.locked || el.containerId || isBoundLinear(el)) continue;
    eligible.push(el);
  }
  const claimed = new Set();
  const units = [];
  const finish = (key, kind, root, members, extra = {}) => {
    if (members.some(isMap)) { mapSkipped++; for (const m of members) claimed.add(m.id); return; }
    for (const m of members) claimed.add(m.id);
    units.push({ key, kind, root, members, ids: new Set(members.map((m) => m.id)), bounds: commonBounds(members), children: [], ...extra });
  };
  if (withFrames) {
    for (const el of eligible) {
      if (!isFrameLike(el) || claimed.has(el.id)) continue;
      const kids = live.filter((k) => k.frameId === el.id && !k.containerId);
      const members = expand([el, ...kids]);
      const kidIds = new Set(kids.filter(movable).map((k) => k.id));
      if (members.some(isMap)) { mapSkipped++; for (const m of members) claimed.add(m.id); continue; }
      for (const m of members) claimed.add(m.id);
      units.push({ key: el.id, kind: "frame", root: el, members, ids: new Set(members.map((m) => m.id)), bounds: commonBounds(members), children: [...kidIds] });
    }
  }
  for (const el of eligible) {
    if (claimed.has(el.id) || isFrameLike(el)) continue;
    const g = el.groupIds?.length ? el.groupIds[el.groupIds.length - 1] : null;
    if (g) {
      const roots = live.filter((m) => m.groupIds?.includes(g) && !m.containerId && !isFrameLike(m));
      finish(`g:${g}`, "group", el, expand(roots));
    } else {
      finish(el.id, "single", el, expand([el]));
    }
  }
  const first = (u) => Math.min(...u.members.map((m) => order.get(m.id) ?? 0));
  units.sort((a, b) => first(a) - first(b));
  return { units: units.filter((u) => u.bounds), mapSkipped, byId, live, order, texts };
}

// Reading order: rows by top edge (tolerance half the median height), left to right inside a row.
function readingOrder(units) {
  const hs = units.map((u) => u.bounds[3] - u.bounds[1]).sort((a, b) => a - b);
  const tol = (hs[Math.floor(hs.length / 2)] || 0) / 2;
  const byTop = [...units].sort((a, b) => a.bounds[1] - b.bounds[1] || a.bounds[0] - b.bounds[0]);
  const rows = [];
  for (const u of byTop) {
    const row = rows[rows.length - 1];
    if (row && u.bounds[1] - row.top <= tol) row.items.push(u);
    else rows.push({ top: u.bounds[1], items: [u] });
  }
  return rows.flatMap((r) => r.items.sort((a, b) => a.bounds[0] - b.bounds[0]));
}

const selBounds = (units) => commonBounds(units.flatMap((u) => u.members));

// Grid placement of units (each keeps its own size): columns ceil(sqrt(n)), gap, top-left at (left, top).
function gridPlan(sorted, cols, left, top, sizeOf = (u) => [u.bounds[2] - u.bounds[0], u.bounds[3] - u.bounds[1]]) {
  const rows = Math.ceil(sorted.length / cols);
  const colW = new Array(cols).fill(0);
  const rowH = new Array(rows).fill(0);
  sorted.forEach((u, i) => {
    const [w, h] = sizeOf(u);
    colW[i % cols] = Math.max(colW[i % cols], w);
    rowH[Math.floor(i / cols)] = Math.max(rowH[Math.floor(i / cols)], h);
  });
  const colX = [];
  let x = left;
  for (let c = 0; c < cols; c++) { colX.push(x); x += colW[c] + ARRANGE_GAP; }
  const rowY = [];
  let y = top;
  for (let r = 0; r < rows; r++) { rowY.push(y); y += rowH[r] + ARRANGE_GAP; }
  return { cell: (i) => [colX[i % cols], rowY[Math.floor(i / cols)]], width: x - ARRANGE_GAP - left, height: y - ARRANGE_GAP - top };
}

const gridCols = (n) => Math.ceil(Math.sqrt(n));

// ---- operations ----
const twoPlus = (units) => units.length >= 2;
const isImageUnit = (u) => u.kind === "single" && u.root.type === "image";
const frameUnits = (units) => units.filter((u) => u.kind === "frame");

export const ARRANGE_OPS = Object.freeze([
  { op: "row", label: "Arrange as row", hint: "Select at least two elements", enabled: (units) => twoPlus(units) },
  { op: "column", label: "Arrange as column", hint: "Select at least two elements", enabled: (units) => twoPlus(units) },
  { op: "grid", label: "Arrange as grid", hint: "Select at least two elements", enabled: (units) => twoPlus(units) },
  { op: "equal", label: "Equal size", hint: "Select at least two elements", enabled: (units) => twoPlus(units) },
  { op: "box", label: "Box around", hint: "Select something to put in a frame", enabled: (units) => units.length >= 1 && !frameUnits(units).length },
  { op: "images", label: "Grid of images", hint: "Select at least two images", enabled: (units) => units.filter(isImageUnit).length >= 2 },
  { op: "frame", label: "Lay out frame children", hint: "Select one frame that has children", enabled: (units) => frameUnits(units).length === 1 && frameUnits(units)[0].children.length >= 1 },
  { op: "swap", label: "Swap two", hint: "Select exactly two elements", enabled: (units) => units.length === 2 },
  { op: "untangle", label: "Untangle", hint: "Select at least two elements", enabled: (units) => twoPlus(units) },
]);

function moveUnit(moves, unit, dx, dy) {
  if (!dx && !dy) return;
  for (const m of unit.members) {
    const r = moves.get(m.id) ?? rectOf(m);
    moves.set(m.id, { x: r.x + dx, y: r.y + dy, width: r.width, height: r.height });
  }
}

function untangleDeltas(units, arrows) {
  const n = units.length;
  const cx = new Float64Array(n);
  const cy = new Float64Array(n);
  let diag = 0;
  units.forEach((u, i) => {
    cx[i] = (u.bounds[0] + u.bounds[2]) / 2;
    cy[i] = (u.bounds[1] + u.bounds[3]) / 2;
    diag += Math.hypot(u.bounds[2] - u.bounds[0], u.bounds[3] - u.bounds[1]);
  });
  const sb = selBounds(units);
  const bw = Math.max(sb[2] - sb[0], 1);
  const bh = Math.max(sb[3] - sb[1], 1);
  const k = Math.max(diag / n + ARRANGE_GAP, Math.sqrt((bw * bh) / n));
  const owner = new Map();
  units.forEach((u, i) => { for (const id of u.ids) owner.set(id, i); });
  const seen = new Set();
  const edges = [];
  for (const a of arrows) {
    const i = owner.get(a.startBinding?.elementId);
    const j = owner.get(a.endBinding?.elementId);
    if (i === undefined || j === undefined || i === j) continue;
    const key = i < j ? `${i}:${j}` : `${j}:${i}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push([i, j]);
  }
  const x = Float64Array.from(cx);
  const y = Float64Array.from(cy);
  for (let i = 1; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (Math.abs(x[i] - x[j]) < 0.5 && Math.abs(y[i] - y[j]) < 0.5) {
        x[i] += Math.cos(i * GOLDEN) * k * 0.25;
        y[i] += Math.sin(i * GOLDEN) * k * 0.25;
        break;
      }
    }
  }
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  const t0 = Math.max(bw, bh, k * 2) / 10;
  const k2 = k * k;
  for (let it = 0; it < UNTANGLE_ITERATIONS; it++) {
    const t = t0 * (1 - it / UNTANGLE_ITERATIONS);
    dx.fill(0);
    dy.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ex = x[i] - x[j];
        let ey = y[i] - y[j];
        let d2 = ex * ex + ey * ey;
        if (d2 < 1e-6) { const a = (i * n + j) * GOLDEN; ex = Math.cos(a); ey = Math.sin(a); d2 = 1; }
        const f = k2 / d2;
        dx[i] += ex * f; dy[i] += ey * f;
        dx[j] -= ex * f; dy[j] -= ey * f;
      }
    }
    for (const [i, j] of edges) {
      const ex = x[i] - x[j];
      const ey = y[i] - y[j];
      const f = Math.sqrt(ex * ex + ey * ey) / k;
      dx[i] -= ex * f; dy[i] -= ey * f;
      dx[j] += ex * f; dy[j] += ey * f;
    }
    for (let i = 0; i < n; i++) {
      const len = Math.hypot(dx[i], dy[i]);
      if (len > 0) {
        const s = Math.min(len, t) / len;
        x[i] += dx[i] * s;
        y[i] += dy[i] * s;
      }
    }
  }
  let mx = 0, my = 0, ox = 0, oy = 0;
  for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; ox += cx[i]; oy += cy[i]; }
  const shiftX = (ox - mx) / n;
  const shiftY = (oy - my) / n;
  return units.map((_, i) => [half(x[i] + shiftX - cx[i]), half(y[i] + shiftY - cy[i])]);
}

// Places `text` inside its (resized) container by the bound-text rule; rotated containers rotate the result about the centre.
function textPatch(container, text) {
  const pos = computeBoundTextPosition(container, text);
  if (!container.angle) return { x: pos.x, y: pos.y };
  const [ccx, ccy] = centreOf(container);
  const tx = pos.x + text.width / 2 - ccx;
  const ty = pos.y + text.height / 2 - ccy;
  const cos = Math.cos(container.angle);
  const sin = Math.sin(container.angle);
  return { x: ccx + tx * cos - ty * sin - text.width / 2, y: ccy + tx * sin + ty * cos - text.height / 2 };
}

// arrange(elements, selectionIds, op, opts) -> { next, message, bent, mapSkipped }.
// elements is the full scene array (deleted ones included). next is null when nothing can be done (message says why).
export function arrange(elements, selectionIds, op, opts = {}) {
  const found = arrangeUnits(elements, selectionIds);
  const { units, mapSkipped, byId, live, texts } = found;
  const fail = (message) => ({ next: null, message, bent: 0, mapSkipped });
  const def = ARRANGE_OPS.find((o) => o.op === op);
  if (!def) return fail("Unknown arrange operation");
  if (!units.length) return fail(mapSkipped ? MAP_MESSAGE : "Select something to arrange");
  if (op === "box" && frameUnits(units).length) return fail("A frame cannot hold a frame");
  if (!def.enabled(units, elements)) return fail(def.hint);

  const moves = new Map();
  const extra = new Map();
  let moved = units;
  let insertFrame = null;
  let membership = true;

  if (op === "row" || op === "column") {
    const b = selBounds(units);
    const row = op === "row";
    const sorted = [...units].sort((p, q) => (row ? p.bounds[0] - q.bounds[0] || p.bounds[1] - q.bounds[1] : p.bounds[1] - q.bounds[1] || p.bounds[0] - q.bounds[0]));
    let cursor = row ? b[0] : b[1];
    for (const u of sorted) {
      const w = u.bounds[2] - u.bounds[0];
      const h = u.bounds[3] - u.bounds[1];
      moveUnit(moves, u, row ? cursor - u.bounds[0] : b[0] - u.bounds[0], row ? b[1] - u.bounds[1] : cursor - u.bounds[1]);
      cursor += (row ? w : h) + ARRANGE_GAP;
    }
  } else if (op === "grid") {
    const b = selBounds(units);
    const sorted = readingOrder(units);
    const plan = gridPlan(sorted, gridCols(sorted.length), b[0], b[1]);
    sorted.forEach((u, i) => { const [x, y] = plan.cell(i); moveUnit(moves, u, x - u.bounds[0], y - u.bounds[1]); });
  } else if (op === "equal") {
    const els = units.filter((u) => u.kind === "single" && RESIZABLE.has(u.root.type)).map((u) => u.root);
    if (els.length < 2) return fail("Equal size needs shapes or images");
    moved = units.filter((u) => u.kind === "single" && RESIZABLE.has(u.root.type));
    const W = Math.max(...els.map((e) => num(e.width)));
    const H = Math.max(...els.map((e) => num(e.height)));
    for (const el of els) {
      const [ccx, ccy] = centreOf(el);
      let w = W;
      let h = H;
      if (el.type === "image") {
        const s = Math.min(W / (num(el.width) || 1), H / (num(el.height) || 1));
        w = num(el.width) * s;
        h = num(el.height) * s;
      }
      moves.set(el.id, { x: ccx - w / 2, y: ccy - h / 2, width: w, height: h });
      if (el.type === "image") continue;
      const next = { ...el, x: ccx - w / 2, y: ccy - h / 2, width: w, height: h };
      for (const t of texts.get(el.id) || []) extra.set(t.id, textPatch(next, t));
    }
  } else if (op === "images") {
    const imgs = units.filter(isImageUnit);
    moved = imgs;
    const b = commonBounds(imgs.flatMap((u) => u.members));
    const sorted = readingOrder(imgs);
    const size = (u) => [IMAGE_CELL, (num(u.root.height) * IMAGE_CELL) / (num(u.root.width) || 1)];
    const plan = gridPlan(sorted, gridCols(sorted.length), b[0], b[1], size);
    sorted.forEach((u, i) => {
      const [x, y] = plan.cell(i);
      const [w, h] = size(u);
      moves.set(u.root.id, { x, y, width: w, height: h });
    });
  } else if (op === "frame") {
    const fu = frameUnits(units)[0];
    const frame = fu.root;
    const inner = unitsOf(live, byId, found.order, texts, live.filter((k) => k.frameId === frame.id), false);
    if (!inner.units.length) return fail(def.hint);
    moved = inner.units;
    const sorted = readingOrder(inner.units);
    const left = num(frame.x) + FRAME_PAD;
    const top = num(frame.y) + FRAME_PAD;
    const plan = gridPlan(sorted, gridCols(sorted.length), left, top);
    sorted.forEach((u, i) => { const [x, y] = plan.cell(i); moveUnit(moves, u, x - u.bounds[0], y - u.bounds[1]); });
    const w = Math.max(num(frame.width), plan.width + FRAME_PAD * 2);
    const h = Math.max(num(frame.height), plan.height + FRAME_PAD * 2);
    if (w !== num(frame.width) || h !== num(frame.height)) moves.set(frame.id, { x: num(frame.x), y: num(frame.y), width: w, height: h });
    membership = false;
  } else if (op === "swap") {
    const [a, b] = units;
    const ca = [(a.bounds[0] + a.bounds[2]) / 2, (a.bounds[1] + a.bounds[3]) / 2];
    const cb = [(b.bounds[0] + b.bounds[2]) / 2, (b.bounds[1] + b.bounds[3]) / 2];
    moveUnit(moves, a, cb[0] - ca[0], cb[1] - ca[1]);
    moveUnit(moves, b, ca[0] - cb[0], ca[1] - cb[1]);
  } else if (op === "untangle") {
    if (units.length > UNTANGLE_MAX) return fail("Untangle works on up to 200 elements");
    const arrows = live.filter((el) => el.type === "arrow" && el.startBinding && el.endBinding);
    const deltas = untangleDeltas(units, arrows);
    units.forEach((u, i) => moveUnit(moves, u, deltas[i][0], deltas[i][1]));
  } else if (op === "box") {
    membership = false;
    const kids = units.flatMap((u) => u.members);
    const kidIds = new Set(kids.map((m) => m.id));
    const arrows = live.filter((el) => isBoundLinear(el) && kidIds.has(el.startBinding?.elementId) && kidIds.has(el.endBinding?.elementId));
    const ownIds = new Set(kidIds);
    for (const a of arrows) { ownIds.add(a.id); for (const t of texts.get(a.id) || []) ownIds.add(t.id); }
    const b = selBounds(units);
    const id = opts.newId ? opts.newId() : newFrameId();
    const { rewrite, orders } = planOrders(elements, 1);
    insertFrame = {
      ids: ownIds,
      el: {
        ...baseElement(id, "frame", b[0] - BOX_PAD, b[1] - BOX_PAD, b[2] - b[0] + BOX_PAD * 2, b[3] - b[1] + BOX_PAD * 2),
        name: "Group",
        customData: { plexus: { order: orders[0] } },
      },
      rewrite,
    };
    for (const id2 of ownIds) extra.set(id2, { frameId: id });
  }

  // Frame membership (frame.ts:644-692): a moved unit that left its old frame is released.
  const patches = new Map();
  const put = (id, patch) => patches.set(id, { ...(patches.get(id) || {}), ...patch });
  const curRect = (el) => moves.get(el.id) ?? rectOf(el);
  for (const [id, r] of moves) {
    const el = byId.get(id);
    const o = rectOf(el);
    if (r.x !== o.x || r.y !== o.y || r.width !== o.width || r.height !== o.height) put(id, r);
  }
  if (membership) {
    for (const u of moved) {
      if (u.kind === "frame") continue;
      const ub = commonBounds(u.members.map((m) => ({ ...m, ...(moves.get(m.id) || {}) })));
      if (!ub) continue;
      const bump = u.members.some((m) => patches.has(m.id));
      if (!bump) continue;
      for (const m of u.members) {
        const f = m.frameId ? byId.get(m.frameId) : null;
        if (f && !intersects(ub, curRect(f))) put(m.id, { frameId: null });
      }
    }
  }
  for (const [id, p] of extra) put(id, p);

  // Arrows bound to changed elements.
  let bent = 0;
  const changed = (el) => {
    const r = moves.get(el.id);
    if (!r) return false;
    const o = rectOf(el);
    return r.x !== o.x || r.y !== o.y || r.width !== o.width || r.height !== o.height;
  };
  const shiftOf = (el) => {
    const r = moves.get(el.id);
    if (!r) return { dx: 0, dy: 0, same: true };
    const o = rectOf(el);
    return { dx: r.x + r.width / 2 - o.x - o.width / 2, dy: r.y + r.height / 2 - o.y - o.height / 2, same: r.width === o.width && r.height === o.height };
  };
  const nowEl = (el) => ({ ...el, ...(moves.get(el.id) || {}) });
  for (const a of live) {
    if (!isBoundLinear(a)) continue;
    const s = a.startBinding ? byId.get(a.startBinding.elementId) : null;
    const e = a.endBinding ? byId.get(a.endBinding.elementId) : null;
    if (!(s && changed(s)) && !(e && changed(e))) continue;
    const ss = s ? shiftOf(s) : null;
    const es = e ? shiftOf(e) : null;
    const abs = (a.points || [[0, 0], [num(a.width), num(a.height)]]).map(([px, py]) => [num(a.x) + px, num(a.y) + py]);
    let patch = null;
    let whole = null;
    if (s && e && ss.same && es.same && Math.abs(ss.dx - es.dx) < 1e-9 && Math.abs(ss.dy - es.dy) < 1e-9) {
      whole = { dx: ss.dx, dy: ss.dy };
      patch = { x: num(a.x) + ss.dx, y: num(a.y) + ss.dy };
    } else {
      const simple = !a.elbowed && abs.length === 2 && !num(a.angle) && !(s && num(s.angle)) && !(e && num(e.angle));
      if (simple && s && e) patch = routeArrow(a, nowEl(s), nowEl(e));
      if (!patch) {
        if (!simple) bent++;
        const pts = abs.map((p) => [...p]);
        if (s && ss) { pts[0][0] += ss.dx; pts[0][1] += ss.dy; }
        if (e && es) { pts[pts.length - 1][0] += es.dx; pts[pts.length - 1][1] += es.dy; }
        patch = pointsPatch(pts);
      }
    }
    put(a.id, patch);
    for (const t of texts.get(a.id) || []) {
      if (whole) put(t.id, { x: num(t.x) + whole.dx, y: num(t.y) + whole.dy });
      else put(t.id, arrowLabelRect({ x: patch.x, y: patch.y, points: patch.points }, num(t.width), num(t.height)));
    }
  }

  if (!patches.size && !insertFrame) return fail("Already arranged");
  const lastIdx = insertFrame ? Math.max(...elements.map((el, i) => (el && insertFrame.ids.has(el.id) ? i : -1))) : -1;
  const next = [];
  elements.forEach((el, i) => {
    next.push(el && patches.has(el.id) ? bumped(el, patches.get(el.id)) : el);
    if (i === lastIdx) next.push(insertFrame.el);
  });
  const out = insertFrame ? applyOrderRewrite(next, insertFrame.rewrite) : next;
  return { next: out, message: null, bent, mapSkipped };
}
