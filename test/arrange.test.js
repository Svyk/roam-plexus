import assert from "node:assert/strict";
import test from "node:test";

import { ARRANGE_OPS, arrange, arrangeUnits, computeBoundTextPosition, routeArrow } from "../src/model/arrange.js";
import { arrowLabelRect } from "../src/model/arrowlabel.js";

const base = { angle: 0, isDeleted: false, version: 1, groupIds: [], frameId: null, boundElements: null, locked: false };
const box = (id, x, y, w = 100, h = 50, extra = {}) => ({ ...base, id, type: "rectangle", x, y, width: w, height: h, ...extra });
const img = (id, x, y, w, h, extra = {}) => ({ ...base, id, type: "image", x, y, width: w, height: h, ...extra });
const text = (id, container, w, h, extra = {}) => ({ ...base, id, type: "text", x: 0, y: 0, width: w, height: h, containerId: container, textAlign: "center", verticalAlign: "middle", text: "t", ...extra });
const arrow = (id, from, to, extra = {}) => ({
  ...base, id, type: "arrow", x: 0, y: 0, width: 10, height: 0, points: [[0, 0], [10, 0]], elbowed: false,
  startBinding: { elementId: from, focus: 0, gap: 4 }, endBinding: { elementId: to, focus: 0, gap: 4 }, ...extra,
});
const at = (els, id) => els.find((e) => e.id === id);
const strip = (els) => els.map(({ version, versionNonce, updated, ...rest }) => rest);

test("units: bound text, bound arrows, locked and map elements are never units", () => {
  const els = [box("a", 0, 0, 100, 50, { boundElements: [{ id: "ta", type: "text" }] }), text("ta", "a", 40, 20), box("b", 200, 0), arrow("ar", "a", "b"), box("c", 0, 100, 100, 50, { locked: true }), box("pmm-x-1", 0, 200)];
  const { units, mapSkipped } = arrangeUnits(els, ["a", "ta", "b", "ar", "c", "pmm-x-1"]);
  assert.deepEqual(units.map((u) => u.key), ["a", "b"]);
  assert.equal(mapSkipped, 1);
  assert.deepEqual([...units[0].ids].sort(), ["a", "ta"]);
});

test("units: groups collapse to the outermost group, frames absorb their children", () => {
  const els = [
    box("g1", 0, 0, 10, 10, { groupIds: ["in", "out"] }), box("g2", 20, 0, 10, 10, { groupIds: ["out"] }),
    { ...base, id: "f", type: "frame", x: 100, y: 100, width: 300, height: 300 }, box("k", 120, 120, 10, 10, { frameId: "f" }), box("z", 500, 0),
  ];
  const { units } = arrangeUnits(els, ["g1", "g2", "f", "k", "z"]);
  assert.deepEqual(units.map((u) => u.kind), ["group", "frame", "single"]);
  assert.equal(units[0].ids.size, 2);
  assert.deepEqual(units[1].children, ["k"]);
});

test("row: top-aligned, gap 40, keeps the selection's top-left", () => {
  const els = [box("a", 10, 30, 100, 50), box("b", 300, 90, 60, 20), box("c", 500, 5, 30, 30)];
  const { next } = arrange(els, ["a", "b", "c"], "row");
  assert.deepEqual([at(next, "c").x, at(next, "c").y], [250, 5]);
  const sorted = ["a", "b", "c"].map((id) => at(next, id)).sort((p, q) => p.x - q.x);
  for (const e of sorted) assert.equal(e.y, 5);
  assert.equal(at(next, "a").x, 10);
  assert.equal(at(next, "b").x, 150);
  assert.equal(at(next, "c").x, 250);
});

test("column: left-aligned, gap 40", () => {
  const els = [box("a", 10, 30, 100, 50), box("b", 300, 200, 60, 20)];
  const { next } = arrange(els, ["a", "b"], "column");
  assert.deepEqual([at(next, "a").x, at(next, "a").y, at(next, "b").x, at(next, "b").y], [10, 30, 10, 120]);
});

test("grid: ceil(sqrt(n)) columns, reading order, cells sized to the widest and tallest", () => {
  const els = [box("a", 0, 0, 100, 40), box("b", 300, 2, 50, 40), box("c", 5, 200, 100, 60), box("d", 310, 205, 50, 20), box("e", 0, 400, 20, 20)];
  const { next } = arrange(els, ["a", "b", "c", "d", "e"], "grid");
  const pos = (id) => [at(next, id).x, at(next, id).y];
  assert.deepEqual(pos("a"), [0, 0]);
  assert.deepEqual(pos("b"), [140, 0]);
  assert.deepEqual(pos("c"), [230, 0]);
  assert.deepEqual(pos("d"), [0, 100]);
  assert.deepEqual(pos("e"), [140, 100]);
});

test("equal size: shapes take the largest box about their centre; bound text follows the port; images scale uniformly", () => {
  const els = [
    box("a", 0, 0, 100, 50, { boundElements: [{ id: "ta", type: "text" }] }), text("ta", "a", 40, 20),
    box("b", 200, 0, 60, 80), img("i", 400, 0, 50, 25), { ...base, id: "t", type: "text", x: 0, y: 300, width: 5, height: 5, containerId: null },
  ];
  const { next } = arrange(els, ["a", "b", "i", "t"], "equal");
  assert.deepEqual([at(next, "a").width, at(next, "a").height], [100, 80]);
  assert.deepEqual([at(next, "b").width, at(next, "b").height], [100, 80]);
  assert.deepEqual([at(next, "a").x, at(next, "a").y], [0, -15]);
  assert.deepEqual([at(next, "i").width, at(next, "i").height], [100, 50]);
  const pos = computeBoundTextPosition({ ...at(next, "a") }, at(els, "ta"));
  assert.deepEqual([at(next, "ta").x, at(next, "ta").y], [pos.x, pos.y]);
  assert.equal(at(next, "t").y, 300);
});

test("computeBoundTextPosition honours ellipse, diamond and alignment", () => {
  const t = { width: 20, height: 10, textAlign: "center", verticalAlign: "middle" };
  const rect = computeBoundTextPosition({ type: "rectangle", x: 0, y: 0, width: 100, height: 50 }, t);
  assert.deepEqual(rect, { x: 40, y: 20 });
  const dia = computeBoundTextPosition({ type: "diamond", x: 0, y: 0, width: 100, height: 60 }, t);
  assert.deepEqual(dia, { x: 40, y: 25 });
  const ell = computeBoundTextPosition({ type: "ellipse", x: 0, y: 0, width: 100, height: 50 }, t);
  assert.ok(Math.abs(ell.x - 40.14) < 0.01 && Math.abs(ell.y - 19.82) < 0.01);
  assert.deepEqual(computeBoundTextPosition({ type: "rectangle", x: 0, y: 0, width: 100, height: 50 }, { ...t, textAlign: "left", verticalAlign: "top" }), { x: 5, y: 5 });
  assert.deepEqual(computeBoundTextPosition({ type: "rectangle", x: 0, y: 0, width: 100, height: 50 }, { ...t, textAlign: "right", verticalAlign: "bottom" }), { x: 75, y: 35 });
});

test("box around: frame with padding 24 after the last child, children and their arrow inside get the frameId, order set", () => {
  const els = [box("a", 0, 0), box("x", 900, 900), box("b", 300, 0), arrow("ar", "a", "b"), box("y", 0, 500)];
  const { next } = arrange(els, ["a", "b"], "box", { newId: () => "plexus-frame-test000001" });
  const f = at(next, "plexus-frame-test000001");
  assert.equal(f.type, "frame");
  assert.equal(f.name, "Group");
  assert.deepEqual([f.x, f.y, f.width, f.height], [-24, -24, 448, 98]);
  assert.equal(f.customData.plexus.order, 1);
  assert.equal(next.indexOf(f), next.findIndex((e) => e.id === "ar") + 1);
  assert.equal(at(next, "a").frameId, f.id);
  assert.equal(at(next, "b").frameId, f.id);
  assert.equal(at(next, "ar").frameId, f.id);
  assert.equal(at(next, "x").frameId, null);
});

test("box around refuses a frame in the selection", () => {
  const els = [{ ...base, id: "f", type: "frame", x: 0, y: 0, width: 100, height: 100 }, box("a", 10, 10)];
  const r = arrange(els, ["f", "a"], "box");
  assert.equal(r.next, null);
  assert.equal(r.message, "A frame cannot hold a frame");
});

test("grid of images: 240 wide, aspect kept, images only", () => {
  const els = [img("i1", 0, 0, 480, 240), img("i2", 600, 0, 100, 200), box("r", 300, 300)];
  const { next } = arrange(els, ["i1", "i2", "r"], "images");
  assert.deepEqual([at(next, "i1").width, at(next, "i1").height], [240, 120]);
  assert.deepEqual([at(next, "i2").width, at(next, "i2").height], [240, 480]);
  assert.deepEqual([at(next, "i2").x, at(next, "i2").y], [280, 0]);
  assert.equal(at(next, "r").x, 300);
});

test("lay out frame children grows the frame when the grid does not fit", () => {
  const els = [{ ...base, id: "f", type: "frame", x: 0, y: 0, width: 200, height: 100 }, box("a", 10, 10, 150, 60, { frameId: "f" }), box("b", 20, 20, 150, 60, { frameId: "f" }), box("c", 30, 30, 150, 60, { frameId: "f" })];
  const { next } = arrange(els, ["f"], "frame");
  assert.deepEqual([at(next, "a").x, at(next, "a").y, at(next, "b").x, at(next, "c").y], [24, 24, 214, 124]);
  const f = at(next, "f");
  assert.deepEqual([f.width, f.height], [388, 208]);
  assert.equal(at(next, "a").frameId, "f");
});

test("swap exchanges centres; other counts are refused", () => {
  const els = [box("a", 0, 0, 100, 50), box("b", 300, 200, 40, 40), box("c", 0, 500)];
  const { next } = arrange(els, ["a", "b"], "swap");
  assert.deepEqual([at(next, "a").x, at(next, "a").y], [270, 195]);
  assert.deepEqual([at(next, "b").x, at(next, "b").y], [30, 5]);
  assert.equal(arrange(els, ["a", "b", "c"], "swap").next, null);
});

test("a unit that leaves its frame is released; one that stays keeps it", () => {
  const els = [
    { ...base, id: "f", type: "frame", x: 0, y: 0, width: 200, height: 200 },
    box("a", 10, 10, 50, 50, { frameId: "f" }), box("b", 60, 10, 50, 50, { frameId: "f" }), box("out", 1000, 10, 50, 50),
  ];
  const { next } = arrange(els, ["a", "out"], "swap");
  assert.equal(at(next, "a").frameId, null);
  assert.equal(at(next, "out").frameId, null);
  const r = arrange(els, ["a", "b"], "swap");
  assert.equal(at(r.next, "a").frameId, "f");
});

test("map nodes are skipped with the message", () => {
  const els = [box("pmm-m-1", 0, 0), box("pmm-m-2", 200, 0)];
  const r = arrange(els, ["pmm-m-1", "pmm-m-2"], "row");
  assert.equal(r.next, null);
  assert.equal(r.message, "Map nodes follow the outline");
  const mixed = arrange([...els, box("a", 0, 100), box("b", 300, 100)], ["pmm-m-1", "a", "b"], "column");
  assert.equal(mixed.mapSkipped, 1);
  assert.equal(at(mixed.next, "pmm-m-1").y, 0);
});

test("an already arranged selection reports nothing to do", () => {
  const r = arrange([box("a", 0, 0, 100, 50), box("b", 140, 0, 100, 50)], ["a", "b"], "row");
  assert.equal(r.next, null);
  assert.equal(r.message, "Already arranged");
});

test("arrows: a group move carries the bound arrow exactly, including a bent one", () => {
  const els = [
    box("a", 0, 0, 100, 50, { groupIds: ["g"] }), box("b", 300, 0, 100, 50, { groupIds: ["g"] }), box("c", 0, 400),
    arrow("ar", "a", "b", { x: 104, y: 25, width: 192, height: 30, points: [[0, 0], [90, 30], [192, 0]], boundElements: [{ id: "lbl", type: "text" }] }),
    text("lbl", "ar", 30, 10, { x: 150, y: 40 }),
  ];
  const { next, bent } = arrange(els, ["a", "c"], "swap");
  assert.equal(bent, 0);
  const dy = at(next, "a").y - 0;
  assert.equal(at(next, "ar").y, 25 + dy);
  assert.equal(at(next, "ar").x, 104 + (at(next, "a").x));
  assert.deepEqual(at(next, "ar").points, [[0, 0], [90, 30], [192, 0]]);
  assert.equal(at(next, "lbl").y, 40 + dy);
});

test("arrows: one end moved re-routes a straight arrow with shape-aware clipping", () => {
  const els = [box("a", 0, 0, 100, 50), { ...box("b", 400, 300, 100, 100), type: "ellipse" }, arrow("ar", "a", "b", { x: 104, y: 25, width: 300, height: 300, points: [[0, 0], [300, 300]] }), box("c", 0, 700, 100, 50)];
  const { next, bent } = arrange(els, ["a", "c"], "swap");
  assert.equal(bent, 0);
  const ar = at(next, "ar");
  const a = at(next, "a");
  assert.equal(ar.points.length, 2);
  assert.equal(ar.startBinding.elementId, "a");
  assert.equal(ar.startBinding.focus, 0);
  assert.equal(ar.endBinding.elementId, "b");
  const [sx, sy] = [ar.x, ar.y];
  const [ex, ey] = [ar.x + ar.points[1][0], ar.y + ar.points[1][1]];
  const ac = [a.x + 50, a.y + 25];
  const bc = [450, 350];
  const len = Math.hypot(bc[0] - ac[0], bc[1] - ac[1]);
  const ux = (bc[0] - ac[0]) / len;
  const uy = (bc[1] - ac[1]) / len;
  assert.ok(Math.abs((sx - ac[0]) * uy - (sy - ac[1]) * ux) < 1e-6, "start on the centre line");
  const endDist = Math.hypot(bc[0] - ex, bc[1] - ey);
  assert.ok(Math.abs(endDist - (50 + 4)) < 1e-6, "ellipse radius plus gap");
  const startDist = Math.hypot(sx - ac[0], sy - ac[1]);
  assert.ok(startDist > 4 + 25 - 1e-6 && startDist < 4 + 50 * Math.SQRT2 + 1e-6);
  assert.equal(ar.width, Math.abs(ar.points[1][0]));
});

test("arrows: an arrow label is re-placed with arrowLabelRect after a re-route", () => {
  const els = [box("a", 0, 0), box("b", 400, 300), arrow("ar", "a", "b", { x: 104, y: 25, width: 300, height: 300, points: [[0, 0], [300, 300]], boundElements: [{ id: "lbl", type: "text" }] }), text("lbl", "ar", 30, 10), box("c", 0, 700)];
  const { next } = arrange(els, ["a", "c"], "swap");
  const ar = at(next, "ar");
  const want = arrowLabelRect(ar, 30, 10);
  assert.deepEqual([at(next, "lbl").x, at(next, "lbl").y], [want.x, want.y]);
});

test("arrows: bent, elbow and rotated arrows only move the bound endpoint and are counted", () => {
  const els = [
    box("a", 0, 0), box("b", 400, 0), box("c", 0, 500), box("d", 400, 500),
    arrow("bent", "a", "b", { x: 104, y: 25, width: 292, height: 60, points: [[0, 0], [146, 60], [292, 0]] }),
    arrow("elb", "c", "d", { x: 104, y: 525, width: 292, height: 0, points: [[0, 0], [146, 0], [292, 0]], elbowed: true }),
  ];
  const r = arrange(els, ["a", "c"], "swap");
  assert.equal(r.bent, 2);
  const bent = at(r.next, "bent");
  assert.deepEqual(bent.points[1].map((v, i) => v + [bent.x, bent.y][i]), [250, 85]);
  assert.deepEqual([bent.x + bent.points[2][0], bent.y + bent.points[2][1]], [396, 25]);
});

test("routeArrow returns null for overlapping shapes and keeps the gap otherwise", () => {
  const a = box("a", 0, 0, 100, 50);
  assert.equal(routeArrow(arrow("x", "a", "b"), a, box("b", 50, 10, 100, 50)), null);
  const p = routeArrow(arrow("x", "a", "b", { startBinding: { elementId: "a", focus: 0.5, gap: 8 } }), a, box("b", 300, 0, 100, 50));
  assert.deepEqual([p.x, p.y, p.points[1][0]], [108, 25, 188]);
  assert.equal(p.startBinding.focus, 0);
});

test("untangle: deterministic, capped, fast at 200 units", () => {
  const els = Array.from({ length: 200 }, (_, i) => box(`n${i}`, (i % 15) * 30, Math.floor(i / 15) * 30, 20, 20));
  const ids = els.map((e) => e.id);
  const t0 = performance.now();
  const a = arrange(els, ids, "untangle");
  const ms = performance.now() - t0;
  const b = arrange(els, ids, "untangle");
  assert.deepEqual(strip(a.next), strip(b.next));
  assert.ok(ms < 150, `untangle took ${ms.toFixed(1)} ms`);
  for (const e of a.next) assert.ok(Number.isInteger(e.x * 2) && Number.isInteger(e.y * 2));
  const over = Array.from({ length: 201 }, (_, i) => box(`m${i}`, i * 50, 0));
  const r = arrange(over, over.map((e) => e.id), "untangle");
  assert.equal(r.next, null);
  assert.equal(r.message, "Untangle works on up to 200 elements");
});

test("untangle: coincident units separate, springs pull linked units together, centroid stays", () => {
  const els = [box("a", 0, 0), box("b", 0, 0), box("c", 1000, 0), box("d", 0, 1000), arrow("ab", "c", "d")];
  const r = arrange(els, ["a", "b", "c", "d"], "untangle");
  const a = at(r.next, "a");
  const b = at(r.next, "b");
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 20);
  const cx = (n) => ["a", "b", "c", "d"].reduce((s, id) => s + at(n, id).x, 0) / 4;
  assert.ok(Math.abs(cx(r.next) - cx(els)) <= 0.5);
  const dist = (n, p, q) => Math.hypot(at(n, p).x - at(n, q).x, at(n, p).y - at(n, q).y);
  assert.ok(dist(r.next, "c", "d") < dist(els, "c", "d"));
});

test("ARRANGE_OPS enabled rules", () => {
  const els = [box("a", 0, 0), box("b", 200, 0), img("i", 0, 200, 10, 10), img("j", 200, 200, 10, 10), { ...base, id: "f", type: "frame", x: 0, y: 500, width: 100, height: 100 }, box("k", 5, 505, 10, 10, { frameId: "f" })];
  const en = (op, ids) => ARRANGE_OPS.find((o) => o.op === op).enabled(arrangeUnits(els, ids).units, els);
  assert.equal(en("row", ["a"]), false);
  assert.equal(en("row", ["a", "b"]), true);
  assert.equal(en("swap", ["a", "b"]), true);
  assert.equal(en("swap", ["a", "b", "i"]), false);
  assert.equal(en("images", ["i", "j"]), true);
  assert.equal(en("images", ["i", "a"]), false);
  assert.equal(en("frame", ["f"]), true);
  assert.equal(en("frame", ["k"]), false);
  assert.equal(en("box", ["a"]), true);
  assert.equal(en("box", ["f"]), false);
  assert.deepEqual(ARRANGE_OPS.map((o) => o.op), ["row", "column", "grid", "equal", "box", "images", "frame", "swap", "untangle"]);
});
