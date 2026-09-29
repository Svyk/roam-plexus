import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNode, buildText, buildEdge, buildBoundary, reconcile, applyOps, isEmptyOps, patchMarker, planMap,
  nodeId, textId, edgeId, boundaryId, mmOf, makeSizer, projectionIds, FONT_FAMILY,
} from "../src/model/mmsync.js";
import { BRANCH_COLORS, ROOT_COLOR } from "../src/model/mindmap.js";
import { isId } from "../src/model/region.js";

const measure = (s, fs) => s.length * fs * 0.5;
const sizes = makeSizer(measure);

function mk(spec) {
  const [uid, kids = [], open = true, string] = spec;
  return { uid, string: string ?? `text ${uid}`, open, children: kids.map(mk) };
}
const run = (elements, tree, extra = {}) => reconcile({ elements, tree, sizes, layout: "right", ...extra });
const build = (tree, elements = [], extra = {}) => {
  const ops = run(elements, tree, extra);
  return applyOps(elements, ops);
};
const live = (els) => els.filter((e) => !e.isDeleted);
const get = (els, id) => els.find((e) => e.id === id);

const BASE_KEYS = ["id", "type", "x", "y", "width", "height", "angle", "strokeColor", "backgroundColor", "fillStyle", "strokeWidth", "strokeStyle", "roughness", "opacity", "groupIds", "frameId", "index", "roundness", "seed", "version", "versionNonce", "isDeleted", "boundElements", "updated", "link", "locked", "customData"];

test("builders emit every Excalidraw base field and the right extras", () => {
  const n = buildNode({ map: "R", uid: "a", x: 1, y: 2, width: 100, height: 40, backgroundColor: "#fff", mm: { uid: "a", map: "R" }, boundElements: [] });
  const t = buildText({ map: "R", uid: "a", x: 1, y: 2, width: 50, height: 25, text: "t", originalText: "t", fontSize: 20 });
  const e = buildEdge({ map: "R", parentUid: "p", childUid: "a", x: 0, y: 0, points: [[0, 0], [30, -10]] });
  const b = buildBoundary({ map: "R", uid: "a", x: 0, y: 0, width: 10, height: 10 });
  for (const el of [n, t, e, b]) {
    for (const k of BASE_KEYS) assert.ok(k in el, `${el.type} lacks ${k}`);
    assert.equal(el.index, null);
    assert.equal(el.isDeleted, false);
    assert.equal(el.angle, 0);
    assert.ok(isId(el.id), el.id);
  }
  assert.equal(n.type, "rectangle");
  assert.deepEqual(n.roundness, { type: 3 });
  assert.deepEqual(t.roundness, null);
  assert.equal(t.fontFamily, FONT_FAMILY);
  assert.equal(t.fontFamily, 5);
  assert.equal(t.containerId, n.id);
  assert.equal(t.lineHeight, 1.25);
  for (const k of ["text", "fontSize", "fontFamily", "textAlign", "verticalAlign", "containerId", "originalText", "autoResize", "lineHeight"]) assert.ok(k in t);
  assert.equal(e.type, "arrow");
  assert.equal(e.endArrowhead, null);
  assert.deepEqual(e.startBinding, { elementId: nodeId("R", "p"), focus: 0, gap: 4 });
  assert.deepEqual(e.endBinding, { elementId: nodeId("R", "a"), focus: 0, gap: 4 });
  assert.deepEqual(e.customData.plexus.mm, { edge: ["p", "a"], map: "R" });
  assert.equal(b.strokeStyle, "dashed");
  assert.equal(b.backgroundColor, "transparent");
  assert.deepEqual(b.customData.plexus.mm, { boundary: "a", map: "R" });
  assert.equal(nodeId("R", "a"), "pmm-R-a");
  assert.equal(textId("R", "a"), "pmm-R-a-t");
  assert.equal(edgeId("R", "a"), "pmm-R-a-e");
  assert.equal(boundaryId("R", "a"), "pmm-R-a-b");
});

test("add: edge, container, text per node; wiring and geometry", () => {
  const tree = mk(["R", [["a"], ["b", [["b1"]]]]]);
  const ops = run([], tree);
  assert.equal(ops.update.length + ops.remove.length, 0);
  assert.equal(ops.add.length, 4 * 2 + 3);
  const ids = ops.add.map((e) => e.id);
  assert.ok(ids.indexOf(edgeId("R", "a")) < ids.indexOf(nodeId("R", "a")));
  assert.ok(ids.indexOf(nodeId("R", "a")) < ids.indexOf(textId("R", "a")));
  const els = applyOps([], ops);
  const root = get(els, nodeId("R", "R"));
  assert.equal(root.backgroundColor, ROOT_COLOR);
  assert.deepEqual(mmOf(root), { uid: "R", map: "R", root: true, layout: "right", bounds: [] });
  assert.deepEqual(root.boundElements, [
    { id: textId("R", "R"), type: "text" }, { id: edgeId("R", "a"), type: "arrow" }, { id: edgeId("R", "b"), type: "arrow" },
  ]);
  const a = get(els, nodeId("R", "a"));
  const b = get(els, nodeId("R", "b"));
  const b1 = get(els, nodeId("R", "b1"));
  assert.equal(a.backgroundColor, BRANCH_COLORS[0]);
  assert.equal(b.backgroundColor, BRANCH_COLORS[1]);
  assert.equal(b1.backgroundColor, BRANCH_COLORS[1]);
  assert.ok(a.boundElements.some((x) => x.id === edgeId("R", "a") && x.type === "arrow"));
  const ta = get(els, textId("R", "a"));
  assert.equal(ta.containerId, a.id);
  assert.equal(ta.x, a.x + (a.width - ta.width) / 2);
  assert.equal(ta.y, a.y + (a.height - ta.height) / 2);
  assert.equal(ta.height, ta.text.split("\n").length * ta.fontSize * 1.25);
  assert.equal(ta.fontSize, 20);
  assert.equal(get(els, textId("R", "b1")).fontSize, 16);
  assert.equal(get(els, textId("R", "R")).fontSize, 24);
  const e = get(els, edgeId("R", "a"));
  assert.equal(e.x, root.x + root.width);
  assert.equal(e.y, root.y + root.height / 2);
  assert.equal(e.x + e.points[1][0], a.x);
  assert.equal(e.y + e.points[1][1], a.y + a.height / 2);
  for (const el of els) assert.ok(isId(el.id), el.id);
});

test("idempotence: reconcile(apply(reconcile(x))) is empty, in every direction and with folds and bounds", () => {
  const tree = mk(["R", [["a", [["a1"], ["a2", [["a21"]], false]]], ["b"]]]);
  for (const layout of ["right", "down", "left", "up", "radial"]) {
    let els = build(tree, [], { layout });
    assert.ok(isEmptyOps(run(els, tree, { layout })), layout);
    els = els.map((e) => (e.id === nodeId("R", "R") ? patchMarker(e, { bounds: ["a"] }) : e));
    els = build(tree, els, { layout });
    assert.ok(get(els, boundaryId("R", "a")));
    assert.ok(isEmptyOps(run(els, tree, { layout })), `${layout} with boundary`);
  }
});

test("echo tolerance: geometry within 0.5px and bumped versions add no ops", () => {
  const tree = mk(["R", [["a"]]]);
  const els = build(tree).map((e) => ({ ...e, x: e.x + 0.3, version: e.version + 5, index: "a0", seed: 1, versionNonce: 9, updated: 1 }));
  assert.ok(isEmptyOps(run(els, tree)));
});

test("update: text, size and position diffs; input never mutated", () => {
  const tree = mk(["R", [["a"], ["b"]]]);
  const els = build(tree);
  const snapshot = JSON.stringify(els);
  const tree2 = mk(["R", [["a", [], true, "a much longer text that will wrap onto lines for sure yes it will"], ["b"]]]);
  const ops = run(els, tree2);
  assert.equal(JSON.stringify(els), snapshot);
  const ids = ops.update.map((u) => u.id);
  assert.ok(ids.includes(textId("R", "a")));
  assert.ok(ids.includes(nodeId("R", "a")));
  assert.ok(ids.includes(nodeId("R", "b")), "sibling moves to make room");
  const out = applyOps(els, ops);
  assert.ok(out[0] !== els[0] || ops.update.every((u) => u.id !== els[0].id));
  const ta = get(out, textId("R", "a"));
  assert.ok(ta.text.includes("\n"));
  assert.ok(ta.originalText.startsWith("a much longer"));
  assert.equal(get(out, nodeId("R", "a")).version, get(els, nodeId("R", "a")).version + 1);
  assert.ok(isEmptyOps(run(out, tree2)));
});

test("remove: gone or folded nodes go with edges and boundary; refold un-deletes and keeps pin and color", () => {
  const tree = mk(["R", [["a", [["a1"]]], ["b"]]]);
  let els = build(tree);
  els = els.map((e) => (e.id === nodeId("R", "a1") ? patchMarker(e, { pinned: true }) : e));
  els = els.map((e) => (e.id === nodeId("R", "R") ? patchMarker(e, { bounds: ["a1"] }) : e));
  els = build(tree, els);
  els = els.map((e) => (e.id === nodeId("R", "a1") ? { ...e, x: 900, y: 900, backgroundColor: "#123456" } : e));
  const folded = mk(["R", [["a", [["a1"]], false], ["b"]]]);
  const ops = run(els, folded);
  for (const id of [nodeId("R", "a1"), textId("R", "a1"), edgeId("R", "a1"), boundaryId("R", "a1")]) assert.ok(ops.remove.includes(id), id);
  assert.equal(ops.remove.length, 4);
  const at = ops.update.find((u) => u.id === textId("R", "a"));
  assert.ok(at.patch.text.endsWith(" (+1)"));
  els = applyOps(els, ops);
  assert.equal(get(els, nodeId("R", "a1")).isDeleted, true);
  assert.ok(isEmptyOps(run(els, folded)));
  const ops2 = run(els, tree);
  assert.equal(ops2.add.length, 0, "un-delete, never re-add");
  els = applyOps(els, ops2);
  const a1 = get(els, nodeId("R", "a1"));
  assert.equal(a1.isDeleted, false);
  assert.equal(a1.x, 900);
  assert.equal(a1.backgroundColor, "#123456");
  assert.equal(get(els, textId("R", "a1")).isDeleted, false);
  assert.equal(get(els, edgeId("R", "a1")).isDeleted, false);
  assert.equal(get(els, boundaryId("R", "a1")).isDeleted, false);
  assert.ok(isEmptyOps(run(els, tree)));
  // block deleted in the outline
  const gone = mk(["R", [["b"]]]);
  const ops3 = run(els, gone);
  assert.ok(ops3.remove.includes(nodeId("R", "a")) && ops3.remove.includes(nodeId("R", "a1")));
  const out = applyOps(els, ops3);
  assert.ok(isEmptyOps(run(out, gone)));
  assert.equal(get(out, nodeId("R", "R")).customData.plexus.mm.bounds.length, 0, "stale bounds pruned");
});

test("pinned nodes keep their position; subtree lays out relative", () => {
  const tree = mk(["R", [["a", [["a1"]]], ["b"]]]);
  let els = build(tree);
  els = els.map((e) => (e.id === nodeId("R", "a") ? { ...patchMarker(e, { pinned: true }), x: 700, y: -300 } : e));
  const ops = run(els, tree);
  assert.ok(!ops.update.some((u) => u.id === nodeId("R", "a") && ("x" in u.patch || "y" in u.patch)));
  els = applyOps(els, ops);
  assert.equal(get(els, nodeId("R", "a")).x, 700);
  assert.ok(get(els, nodeId("R", "a1")).x > 700);
  assert.ok(isEmptyOps(run(els, tree)));
  const plan = planMap({ elements: els, tree, sizes });
  assert.equal(plan.positions.a.x, 700);
});

test("root is the anchor: it keeps its position and is never pinned", () => {
  const tree = mk(["R", [["a"]]]);
  let els = build(tree, [], { rootPos: { x: 50, y: 60 } });
  assert.equal(get(els, nodeId("R", "R")).x, 50);
  els = els.map((e) => (e.id === nodeId("R", "R") ? { ...e, x: 400, y: 400 } : e));
  const out = build(tree, els);
  assert.equal(get(out, nodeId("R", "R")).x, 400);
  assert.equal(get(out, nodeId("R", "a")).x > 400, true);
});

test("owned fields only: native recolor survives; move to another depth-1 branch recolors", () => {
  const tree = mk(["R", [["a", [["a1"]]], ["b"]]]);
  let els = build(tree);
  els = els.map((e) => (e.id === nodeId("R", "a1") ? { ...e, backgroundColor: "#000000", strokeColor: "#ff0000" } : e));
  assert.ok(isEmptyOps(run(els, tree)));
  const moved = mk(["R", [["a"], ["b", [["a1"]]]]]);
  const ops = run(els, moved);
  const p = ops.update.find((u) => u.id === nodeId("R", "a1")).patch;
  assert.equal(p.backgroundColor, BRANCH_COLORS[1]);
  const out = applyOps(els, ops);
  assert.equal(get(out, nodeId("R", "a1")).strokeColor, "#ff0000");
  assert.ok(isEmptyOps(run(out, moved)));
});

test("boundElements merge keeps foreign entries", () => {
  const tree = mk(["R", [["a"]]]);
  let els = build(tree);
  els = els.map((e) => (e.id === nodeId("R", "a") ? { ...e, boundElements: [...e.boundElements, { id: "user-arrow", type: "arrow" }, { id: "pmm-R-stale-e", type: "arrow" }] } : e));
  const ops = run(els, tree);
  const p = ops.update.find((u) => u.id === nodeId("R", "a")).patch;
  assert.ok(p.boundElements.some((b) => b.id === "user-arrow"));
  assert.ok(!p.boundElements.some((b) => b.id === "pmm-R-stale-e"));
  const out = applyOps(els, ops);
  assert.ok(isEmptyOps(run(out, tree)));
});

test("copies lose the marker and are not deleted; one node per uid", () => {
  const tree = mk(["R", [["a"]]]);
  let els = build(tree);
  const orig = get(els, nodeId("R", "a"));
  const copy = { ...orig, id: "copy1", x: orig.x + 30, boundElements: null, index: "zz" };
  const copyEdge = { ...get(els, edgeId("R", "a")), id: "copy2" };
  els = [...els, copy, copyEdge];
  const ops = run(els, tree);
  assert.equal(ops.remove.length, 0);
  assert.equal(ops.add.length, 0);
  const out = applyOps(els, ops);
  assert.equal(mmOf(get(out, "copy1")), undefined);
  assert.equal(mmOf(get(out, "copy2")), undefined);
  assert.equal(get(out, "copy1").isDeleted, false);
  assert.equal(get(out, "copy1").width, orig.width);
  const withMarker = out.filter((e) => mmOf(e) && mmOf(e).uid === "a");
  assert.equal(withMarker.length, 1);
  assert.ok(isEmptyOps(run(out, tree)));
});

test("missing bound text or deleted container are repaired", () => {
  const tree = mk(["R", [["a"]]]);
  let els = build(tree);
  const noText = els.filter((e) => e.id !== textId("R", "a"));
  const out = applyOps(noText, run(noText, tree));
  assert.ok(get(out, textId("R", "a")));
  assert.ok(isEmptyOps(run(out, tree)));
  const deleted = els.map((e) => (e.id === nodeId("R", "a") || e.id === textId("R", "a") ? { ...e, isDeleted: true } : e));
  const back = applyOps(deleted, run(deleted, tree));
  assert.equal(get(back, nodeId("R", "a")).isDeleted, false);
  assert.equal(get(back, textId("R", "a")).isDeleted, false);
  assert.equal(back.length, deleted.length);
});

test("boundary encloses the branch with padding 12 and follows layout", () => {
  const tree = mk(["R", [["a", [["a1"], ["a2"]]], ["b"]]]);
  let els = build(tree);
  els = els.map((e) => (e.id === nodeId("R", "R") ? patchMarker(e, { bounds: ["a"] }) : e));
  els = build(tree, els);
  const bd = get(els, boundaryId("R", "a"));
  const rects = ["a", "a1", "a2"].map((u) => get(els, nodeId("R", u)));
  const x1 = Math.min(...rects.map((r) => r.x)) - 12;
  const y1 = Math.min(...rects.map((r) => r.y)) - 12;
  const x2 = Math.max(...rects.map((r) => r.x + r.width)) + 12;
  const y2 = Math.max(...rects.map((r) => r.y + r.height)) + 12;
  assert.deepEqual([bd.x, bd.y, bd.width, bd.height], [x1, y1, x2 - x1, y2 - y1]);
  assert.equal(bd.strokeStyle, "dashed");
  assert.equal(els[els.length - 1].id, boundaryId("R", "a"), "boundary appended last");
  // native delete of the boundary: re-added through un-delete
  const del = els.map((e) => (e.id === bd.id ? { ...e, isDeleted: true } : e));
  const back = applyOps(del, run(del, tree));
  assert.equal(get(back, bd.id).isDeleted, false);
});

test("layout marker on the root drives direction; patchMarker returns a new element", () => {
  const tree = mk(["R", [["a"]]]);
  let els = build(tree);
  const r0 = get(els, nodeId("R", "R"));
  const r1 = patchMarker(r0, { layout: "down" });
  assert.notEqual(r1, r0);
  assert.equal(mmOf(r0).layout, "right");
  assert.equal(r1.version, r0.version + 1);
  els = els.map((e) => (e === r0 ? r1 : e));
  els = build(tree, els);
  const a = get(els, nodeId("R", "a"));
  const root = get(els, nodeId("R", "R"));
  assert.ok(a.y >= root.y + root.height);
  assert.ok(isEmptyOps(run(els, tree)));
});

test("append only: existing elements keep their order and index", () => {
  const tree = mk(["R", [["a"]]]);
  const els = build(tree).map((e, i) => ({ ...e, index: `a${i}` }));
  const out = applyOps(els, run(els, mk(["R", [["a"], ["b"]]])));
  assert.deepEqual(out.slice(0, els.length).map((e) => e.id), els.map((e) => e.id));
  assert.ok(out.slice(els.length).every((e) => e.index === null));
});

test("projectionIds lists live elements of a map", () => {
  const els = build(mk(["R", [["a"]]]));
  assert.equal(projectionIds(els, "R").length, els.length);
  assert.equal(projectionIds(els, "X").length, 0);
});

test("bench: full 200-node reconcile (cold and warm)", () => {
  const kids = [];
  let n = 1;
  for (let i = 0; i < 10; i++) {
    const sub = [];
    for (let j = 0; j < 19; j++) sub.push([`n${n++}`]);
    kids.push([`n${n++}`, sub]);
  }
  const tree = mk(["R", kids]);
  let t0 = performance.now();
  let els = build(tree);
  const cold = performance.now() - t0;
  assert.equal(live(els).length, 201 * 3 - 1);
  t0 = performance.now();
  const ops = run(els, tree);
  const warm = performance.now() - t0;
  assert.ok(isEmptyOps(ops));
  console.log(`[bench] reconcile 201 nodes: cold add ${cold.toFixed(2)} ms, warm no-op ${warm.toFixed(2)} ms`);
  assert.ok(warm < 50);
});

test("a truncated tree keeps stored bounds so they survive until the tree is complete", () => {
  const full = mk(["R", [["a", [["a1"]]], ["b"]]]);
  let els = build(full);
  els = els.map((e) => (e.id === nodeId("R", "R") ? patchMarker(e, { bounds: ["b"] }) : e));
  els = build(full, els);
  const partial = mk(["R", [["a", [["a1"]]]]]);
  partial.truncated = true;
  els = applyOps(els, run(els, partial));
  assert.deepEqual(get(els, nodeId("R", "R")).customData.plexus.mm.bounds, ["b"]);
  els = applyOps(els, run(els, full));
  assert.equal(get(els, boundaryId("R", "b")).isDeleted, false);
});
