import test from "node:test";
import assert from "node:assert/strict";
import { resolveDrop } from "../src/model/mmdrop.js";

// Right layout: R at x=0; children a, b, c stacked at x=100 (h=40, gap 18); a has child a1 at x=200.
function plan(extra = {}) {
  const R = { uid: "R" };
  const a = { uid: "a" };
  const b = { uid: "b", ...(extra.bVia ? { via: extra.bVia } : {}) };
  const c = { uid: "c" };
  const a1 = { uid: "a1" };
  const nodes = [
    { node: R, parent: null, depth: 0 },
    { node: a, parent: R, depth: 1 },
    { node: a1, parent: a, depth: 2 },
    { node: b, parent: R, depth: 1 },
    { node: c, parent: R, depth: 1 },
  ];
  const rects = { R: [0, 60, 80, 40], a: [100, 0, 80, 40], a1: [200, 0, 80, 40], b: [100, 58, 80, 40], c: [100, 116, 80, 40] };
  const positions = {};
  const info = new Map();
  for (const [uid, [x, y, width, height]] of Object.entries(rects)) {
    positions[uid] = { x, y };
    info.set(uid, { size: { width, height }, mm: extra.pinned === uid ? { pinned: true } : {} });
  }
  return { nodes, positions, info };
}
const tree = { uid: "R" };
const drop = (dragged, x, y, extra = {}, layout = "right") => resolveDrop({ plan: plan(extra), tree, dragged, point: { x, y }, layout });

test("the inner 60 percent of another node reparents it; the edge inset does not", () => {
  const r = drop("c", 140, 78);
  assert.deepEqual([r.type, r.parentUid], ["reparent", "b"]);
  assert.deepEqual(r.ring, { x: 100, y: 58, width: 80, height: 40 });
  assert.notEqual(drop("c", 104, 78).type, "reparent");
});

test("dropping onto the root reparents; dragging the root is refused", () => {
  assert.deepEqual(drop("c", 40, 80).parentUid, "R");
  assert.deepEqual(resolveDrop({ plan: plan(), tree, dragged: "R", point: { x: 140, y: 78 }, layout: "right" }), { type: "refuse", reason: "root" });
});

test("the dragged node and its subtree are not targets; a drop inside its own box pins", () => {
  assert.deepEqual(drop("a", 240, 20), { type: "refuse", reason: "own-subtree" });
  assert.deepEqual(drop("a", 140, 20), { type: "pin" });
});

test("the gap between siblings reorders before the lower one; the ends reorder before the first and after the last", () => {
  const between = drop("c", 140, 49);
  assert.deepEqual([between.type, between.parentUid, between.beforeUid, between.afterUid], ["reorder", "R", "b", undefined]);
  const first = drop("c", 140, -12);
  assert.deepEqual([first.parentUid, first.beforeUid], ["R", "a"]);
  const last = drop("a", 140, 170);
  assert.deepEqual([last.parentUid, last.afterUid, last.beforeUid], ["R", "c", undefined]);
});

test("the dragged node is left out of the sibling bands", () => {
  const r = drop("b", 140, 106);
  assert.deepEqual([r.type, r.beforeUid, r.afterUid], ["reorder", "c", undefined]);
  const between = drop("b", 140, 36);
  assert.deepEqual([between.beforeUid, between.afterUid], ["c", undefined]);
});

test("bands have a cross-axis reach of 20 and nothing beyond it", () => {
  assert.equal(drop("c", 82, 49).type, "reorder");
  assert.equal(drop("c", 78, 49).type, "pin");
  assert.equal(drop("c", 199, 49).type, "reorder");
  assert.equal(drop("c", 205, 79).type, "pin");
});

test("a carrier child next to an ordinary sibling resolves to the ordinary block parent, or to the carrier", () => {
  const near = drop("c", 140, 49, { bVia: "K" });
  assert.deepEqual([near.parentUid, near.afterUid, near.beforeUid], ["R", "a", undefined]);
  const p = plan({ bVia: "K" });
  p.nodes.find((v) => v.node.uid === "a").node.via = "K";
  const both = resolveDrop({ plan: p, tree, dragged: "c", point: { x: 140, y: 49 }, layout: "right" });
  assert.deepEqual([both.parentUid, both.beforeUid], ["K", "b"]);
});

test("radial and fishbone layouts have no reorder zones; pinned siblings are skipped", () => {
  assert.equal(drop("c", 140, 49, {}, "radial").type, "pin");
  assert.equal(drop("c", 140, 49, {}, "fishbone").type, "pin");
  const r = drop("c", 140, 49, { pinned: "b" });
  assert.deepEqual([r.type, r.beforeUid, r.afterUid], ["reorder", undefined, "a"]);
});

test("vertical layouts band along x, and a drop in empty space pins", () => {
  const p = plan();
  for (const [uid, [, , w, h]] of Object.entries({ a: [0, 0, 80, 40], b: [0, 0, 80, 40], c: [0, 0, 80, 40] })) {
    const i = ["a", "b", "c"].indexOf(uid);
    p.positions[uid] = { x: i * 98, y: 100 };
    p.info.get(uid).size = { width: w, height: h };
  }
  const r = resolveDrop({ plan: p, tree, dragged: "c", point: { x: 89, y: 120 }, layout: "down" });
  assert.deepEqual([r.type, r.beforeUid], ["reorder", "b"]);
  assert.equal(resolveDrop({ plan: p, tree, dragged: "c", point: { x: 900, y: 900 }, layout: "down" }).type, "pin");
  assert.equal(resolveDrop({ plan: p, tree, dragged: "c", point: { x: NaN, y: 1 }, layout: "down" }).type, "pin");
});
