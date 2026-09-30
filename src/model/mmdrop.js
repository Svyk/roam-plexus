// Mind-map drop resolver (Phase 12, MM-1): pure hit-testing of a drag release against a map plan.
import { SIBLING_GAP } from "./mindmap.js";

export const REPARENT_INSET = 0.2;
export const BAND_PAD = 20;

const HORIZONTAL = new Set(["right", "left", "cause"]);
const VERTICAL = new Set(["down", "up"]);

const refuse = (reason) => ({ type: "refuse", reason });
const inside = (r, x, y) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
const inner = (r) => ({ x: r.x + REPARENT_INSET * r.width, y: r.y + REPARENT_INSET * r.height, width: r.width * (1 - 2 * REPARENT_INSET), height: r.height * (1 - 2 * REPARENT_INSET) });

/**
 * plan: planMap output ({nodes, positions, info}); tree: the block tree (its uid is the root); dragged: uid;
 * point: scene coordinates; layout: the map layout. Returns
 * {type:"reparent", parentUid, ring} | {type:"reorder", parentUid, beforeUid | afterUid, ring} | {type:"pin"} | {type:"refuse", reason}.
 * `ring` is the scene rect of the highlight (a zero-thickness bar for a reorder).
 */
export function resolveDrop({ plan, tree, dragged, point, layout }) {
  if (!plan || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return { type: "pin" };
  if (tree && dragged === tree.uid) return refuse("root");
  const nodes = Array.isArray(plan.nodes) ? plan.nodes : [];
  const byUid = new Map();
  const kids = new Map();
  for (const v of nodes) {
    byUid.set(v.node.uid, v);
    if (v.parent) {
      if (!kids.has(v.parent.uid)) kids.set(v.parent.uid, []);
      kids.get(v.parent.uid).push(v);
    }
  }
  if (!byUid.has(dragged)) return refuse("missing");
  const rectOf = (uid) => {
    const p = plan.positions?.[uid];
    const s = plan.info?.get?.(uid)?.size;
    return p && s ? { x: p.x, y: p.y, width: s.width, height: s.height } : null;
  };
  const sub = new Set([dragged]);
  for (const v of nodes) if (v.parent && sub.has(v.parent.uid)) sub.add(v.node.uid);

  for (const v of nodes) {
    if (sub.has(v.node.uid)) continue;
    const r = rectOf(v.node.uid);
    if (r && inside(inner(r), point.x, point.y)) return { type: "reparent", parentUid: v.node.uid, ring: r };
  }
  for (const uid of sub) {
    const r = rectOf(uid);
    if (!r) continue;
    if (uid === dragged) { if (inside(r, point.x, point.y)) return { type: "pin" }; }
    else if (inside(inner(r), point.x, point.y)) return refuse("own-subtree");
  }

  const horizontal = HORIZONTAL.has(layout);
  if (!horizontal && !VERTICAL.has(layout)) return { type: "pin" };
  const cross = (r) => (horizontal ? { start: r.y, size: r.height } : { start: r.x, size: r.width });
  const axis = (r) => (horizontal ? { start: r.x, end: r.x + r.width } : { start: r.y, end: r.y + r.height });
  const pc = horizontal ? point.y : point.x;
  const pa = horizontal ? point.x : point.y;
  for (const [parentUid, list] of kids) {
    const sibs = list.filter((v) => v.node.uid !== dragged && plan.info?.get?.(v.node.uid)?.mm?.pinned !== true);
    if (!sibs.length) continue;
    const rs = sibs.map((v) => ({ v, r: rectOf(v.node.uid) }));
    if (rs.some((x) => !x.r)) continue;
    let lo = Infinity;
    let hi = -Infinity;
    for (const { r } of rs) { const a = axis(r); lo = Math.min(lo, a.start); hi = Math.max(hi, a.end); }
    if (pa < lo - BAND_PAD || pa > hi + BAND_PAD) continue;
    const blockParent = (v) => v.node.via ?? parentUid;
    const bar = (at) => (horizontal ? { x: lo, y: at, width: hi - lo, height: 0 } : { x: at, y: lo, width: 0, height: hi - lo });
    const first = rs[0];
    const last = rs[rs.length - 1];
    const cf = cross(first.r);
    if (pc >= cf.start - (0.5 * cf.size + SIBLING_GAP) && pc <= cf.start + REPARENT_INSET * cf.size) {
      return { type: "reorder", parentUid: blockParent(first.v), beforeUid: first.v.node.uid, ring: bar(cf.start - SIBLING_GAP / 2) };
    }
    for (let i = 0; i + 1 < rs.length; i++) {
      const a = rs[i];
      const b = rs[i + 1];
      const ca = cross(a.r);
      const cb = cross(b.r);
      if (pc < ca.start + (1 - REPARENT_INSET) * ca.size || pc > cb.start + REPARENT_INSET * cb.size) continue;
      const ring = bar((ca.start + ca.size + cb.start) / 2);
      if (b.v.node.via == null) return { type: "reorder", parentUid: parentUid, beforeUid: b.v.node.uid, ring };
      if (a.v.node.via == null) return { type: "reorder", parentUid: parentUid, afterUid: a.v.node.uid, ring };
      return { type: "reorder", parentUid: b.v.node.via, beforeUid: b.v.node.uid, ring };
    }
    const cl = cross(last.r);
    if (pc >= cl.start + (1 - REPARENT_INSET) * cl.size && pc <= cl.start + cl.size + 0.5 * cl.size + SIBLING_GAP) {
      return { type: "reorder", parentUid: blockParent(last.v), afterUid: last.v.node.uid, ring: bar(cl.start + cl.size + SIBLING_GAP / 2) };
    }
  }
  return { type: "pin" };
}
