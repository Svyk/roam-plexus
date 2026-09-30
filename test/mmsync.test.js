import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNode, buildText, buildEdge, buildBoundary, reconcile, applyOps, isEmptyOps, patchMarker, planMap,
  nodeId, textId, edgeId, boundaryId, labelId, spineId, mmOf, makeSizer, projectionIds, FONT_FAMILY, CAUSE_FILLS,
  laneId, chipId, chipTextId, mergeId, loopId, lanePrefix, containerDimension, textRect,
} from "../src/model/mmsync.js";
import { BRANCH_COLORS, ROOT_COLOR, LEVEL_GAP, visualTree, visibleNodes } from "../src/model/mindmap.js";
import { arrowLabelRect, arrowLabelWrapWidth } from "../src/model/arrowlabel.js";
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

function big(stringOf = (u) => `text ${u}`) {
  const kids = [];
  let n = 1;
  for (let i = 0; i < 10; i++) {
    const sub = [];
    for (let j = 0; j < 19; j++) { const u = `n${n++}`; sub.push([u, [], true, stringOf(u)]); }
    const u = `n${n++}`;
    kids.push([u, sub, true, stringOf(u)]);
  }
  return mk(["R", kids]);
}

function benchOne(label, tree, extra = {}, expectLive) {
  let t0 = performance.now();
  const els = build(tree, [], extra);
  const cold = performance.now() - t0;
  if (expectLive !== undefined) assert.equal(live(els).length, expectLive);
  t0 = performance.now();
  const ops = run(els, tree, extra);
  const warm = performance.now() - t0;
  assert.ok(isEmptyOps(ops), label);
  console.log(`[bench] reconcile ${label}: cold add ${cold.toFixed(2)} ms, warm no-op ${warm.toFixed(2)} ms`);
  assert.ok(warm < 50, `${label} warm ${warm}`);
  return els;
}

test("bench: full 200-node reconcile (cold and warm)", () => {
  benchOne("201 nodes", big(), {}, 201 * 3 - 1);
});

test("bench: 200-node cause map with a label on every edge", () => {
  const els = benchOne("201-node cause map (200 labels)", big(), { layout: "cause" }, 201 * 3 - 1 + 200);
  assert.equal(live(els).filter((e) => e.id.endsWith("-e-t")).length, 200);
});

test("bench: 200-node map with 20 carriers", () => {
  const branches = [];
  let n = 1;
  for (let i = 0; i < 10; i++) {
    const carriers = [];
    for (let c = 0; c < 2; c++) {
      const sub = [];
      for (let j = 0; j < 9; j++) sub.push([`n${n++}`]);
      carriers.push([`c${i}_${c}`, sub, true, `Attr${c}::`]);
    }
    branches.push([`b${i}`, carriers]);
  }
  const tree = mk(["R", branches]);
  const els = benchOne("carrier map (20 carriers, 180 targets)", tree, { rootDefaults: { attrEdges: true } });
  assert.equal(live(els).filter((e) => e.id.endsWith("-e-t")).length, 180);
  assert.equal(live(els).some((e) => e.id === nodeId("R", "c0_0")), false);
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

// ---- Phase 12 ----

const FIXTURE_0_11 = JSON.parse(String.raw`[{"id":"pmm-R-a-e","type":"arrow","x":100,"y":25,"width":70,"height":31.5,"angle":0,"strokeColor":"#1e1e1e","backgroundColor":"transparent","fillStyle":"solid","strokeWidth":2,"strokeStyle":"solid","roughness":1,"opacity":100,"groupIds":[],"frameId":null,"index":null,"roundness":null,"seed":1,"version":1,"versionNonce":2,"isDeleted":false,"boundElements":null,"updated":3,"link":null,"locked":false,"customData":{"plexus":{"mm":{"edge":["R","a"],"map":"R"}}},"points":[[0,0],[70,-31.5]],"lastCommittedPoint":null,"startBinding":{"elementId":"pmm-R-R","focus":0,"gap":4},"endBinding":{"elementId":"pmm-R-a","focus":0,"gap":4},"startArrowhead":null,"endArrowhead":null,"elbowed":false},{"id":"pmm-R-a1-e","type":"arrow","x":258,"y":-6.5,"width":70,"height":29,"angle":0,"strokeColor":"#1e1e1e","backgroundColor":"transparent","fillStyle":"solid","strokeWidth":2,"strokeStyle":"solid","roughness":1,"opacity":100,"groupIds":[],"frameId":null,"index":null,"roundness":null,"seed":1,"version":1,"versionNonce":2,"isDeleted":false,"boundElements":null,"updated":3,"link":null,"locked":false,"customData":{"plexus":{"mm":{"edge":["a","a1"],"map":"R"}}},"points":[[0,0],[70,-29]],"lastCommittedPoint":null,"startBinding":{"elementId":"pmm-R-a","focus":0,"gap":4},"endBinding":{"elementId":"pmm-R-a1","focus":0,"gap":4},"startArrowhead":null,"endArrowhead":null,"elbowed":false},{"id":"pmm-R-a2-e","type":"arrow","x":258,"y":-6.5,"width":70,"height":29,"angle":0,"strokeColor":"#1e1e1e","backgroundColor":"transparent","fillStyle":"solid","strokeWidth":2,"strokeStyle":"solid","roughness":1,"opacity":100,"groupIds":[],"frameId":null,"index":null,"roundness":null,"seed":1,"version":1,"versionNonce":2,"isDeleted":false,"boundElements":null,"updated":3,"link":null,"locked":false,"customData":{"plexus":{"mm":{"edge":["a","a2"],"map":"R"}}},"points":[[0,0],[70,29]],"lastCommittedPoint":null,"startBinding":{"elementId":"pmm-R-a","focus":0,"gap":4},"endBinding":{"elementId":"pmm-R-a2","focus":0,"gap":4},"startArrowhead":null,"endArrowhead":null,"elbowed":false},{"id":"pmm-R-b-e","type":"arrow","x":100,"y":25,"width":70,"height":58,"angle":0,"strokeColor":"#1e1e1e","backgroundColor":"transparent","fillStyle":"solid","strokeWidth":2,"strokeStyle":"solid","roughness":1,"opacity":100,"groupIds":[],"frameId":null,"index":null,"roundness":null,"seed":1,"version":1,"versionNonce":2,"isDeleted":false,"boundElements":null,"updated":3,"link":null,"locked":false,"customData":{"plexus":{"mm":{"edge":["R","b"],"map":"R"}}},"points":[[0,0],[70,58]],"lastCommittedPoint":null,"startBinding":{"elementId":"pmm-R-R","focus":0,"gap":4},"endBinding":{"elementId":"pmm-R-b","focus":0,"gap":4},"startArrowhead":null,"endArrowhead":null,"elbowed":false},{"id":"pmm-R-c-e","type":"arrow","x":100,"y":25,"width":500,"height":197.5,"angle":0,"strokeColor":"#1e1e1e","backgroundColor":"transparent","fillStyle":"solid","strokeWidth":2,"strokeStyle":"solid","roughness":1,"opacity":100,"groupIds":[],"frameId":null,"index":null,"roundness":null,"seed":1,"version":1,"versionNonce":2,"isDeleted":false,"boundElements":null,"updated":3,"link":null,"locked":false,"customData":{"plexus":{"mm":{"edge":["R","c"],"map":"R"}}},"points":[[0,0],[500,197.5]],"lastCommittedPoint":null,"startBinding":{"elementId":"pmm-R-R","focus":0,"gap":4},"endBinding":{"elementId":"pmm-R-c","focus":0,"gap":4},"startArrowhead":null,"endArrowhead":null,"elbowed":false},{"id":"pmm-R-c1-e","type":"arrow","x":688,"y":222.5,"width":70,"height":0,"angle":0,"strokeColor":"#1e1e1e","backgroundColor":"transparent","fillStyle":"solid","strokeWidth":2,"strokeStyle":"solid","roughness":1,"opacity":100,"groupIds":[],"frameId":null,"index":null,"roundness":null,"seed":1,"version":1,"versionNonce":2,"isDeleted":false,"boundElements":null,"updated":3,"link":null,"locked":false,"customData":{"plexus":{"mm":{"edge":["c","c1"],"map":"R"}}},"points":[[0,0],[70,0]],"lastCommittedPoint":null,"startBinding":{"elementId":"pmm-R-c","focus":0,"gap":4},"endBinding":{"elementId":"pmm-R-c1","focus":0,"gap":4},"startArrowhead":null,"endArrowhead":null,"elbowed":false},{"id":"pmm-R-R","type":"rectangle","x":0,"y":0,"width":100,"height":50,"angle":0,"strokeColor":"#1e1e1e","backgroundColor":"#ffec99","fillStyle":"solid","strokeWidth":2,"strokeStyle":"solid","roughness":1,"opacity":100,"groupIds":[],"frameId":null,"index":null,"roundness":{"type":3},"seed":1,"version":1,"versionNonce":2,"isDeleted":false,"boundElements":[{"id":"pmm-R-R-t","type":"text"},{"id":"pmm-R-a-e","type":"arrow"},{"id":"pmm-R-b-e","type":"arrow"},{"id":"pmm-R-c-e","type":"arrow"}],"updated":3,"link":null,"locked":false,"customData":{"plexus":{"mm":{"uid":"R","map":"R","root":true,"layout":"right","bounds":["a"]}}}},{"id":"pmm-R-R-t","type":"text","x":14,"y":10,"width":72,"height":30,"angle":0,"strokeColor":"#1e1e1e","backgroundColor":"transparent","fillStyle":"solid","strokeWidth":2,"strokeStyle":"solid","roughness":1,"opacity":100,"groupIds":[],"frameId":null,"index":null,"roundness":null,"seed":1,"version":1,"versionNonce":2,"isDeleted":false,"boundElements":null,"updated":3,"link":null,"locked":false,"text":"text R","originalText":"text R","fontSize":24,"fontFamily":5,"textAlign":"center","verticalAlign":"middle","containerId":"pmm-R-R","autoResize":true,"lineHeight":1.25},{"id":"pmm-R-a","type":"rectangle","x":170,"y":-29,"width":88,"height":45,"angle":0,"strokeColor":"#1e1e1e","backgroundColor":"#a5d8ff","fillStyle":"solid","strokeWidth":2,"strokeStyle":"solid","roughness":1,"opacity":100,"groupIds":[],"frameId":null,"index":null,"roundness":{"type":3},"seed":1,"version":1,"versionNonce":2,"isDeleted":false,"boundElements":[{"id":"pmm-R-a-t","type":"text"},{"id":"pmm-R-a-e","type":"arrow"},{"id":"pmm-R-a1-e","type":"arrow"},{"id":"pmm-R-a2-e","type":"arrow"}],"updated":3,"link":null,"locked":false,"customData":{"plexus":{"mm":{"uid":"a","map":"R","branch":"a"}}}},{"id":"pmm-R-a-t","type":"text","x":184,"y":-19,"width":60,"height":25,"angle":0,"strokeColor":"#1e1e1e","backgroundColor":"transparent","fillStyle":"solid","strokeWidth":2,"strokeStyle":"solid","roughness":1,"opacity":100,"groupIds":[],"frameId":null,"index":null,"roundness":null,"seed":1,"version":1,"versionNonce":2,"isDeleted":false,"boundElements":null,"updated":3,"link":null,"locked":false,"text":"text a","originalText":"text a","fontSize":20,"fontFamily":5,"textAlign":"center","verticalAlign":"middle","containerId":"pmm-R-a","autoResize":true,"lineHeight":1.25},{"id":"pmm-R-a1","type":"rectangle","x":328,"y":-55.5,"width":84,"height":40,"angle":0,"strokeColor":"#1e1e1e","backgroundColor":"#a5d8ff","fillStyle":"solid","strokeWidth":2,"strokeStyle":"solid","roughness":1,"opacity":100,"groupIds":[],"frameId":null,"index":null,"roundness":{"type":3},"seed":1,"version":1,"versionNonce":2,"isDeleted":false,"boundElements":[{"id":"pmm-R-a1-t","type":"text"},{"id":"pmm-R-a1-e","type":"arrow"}],"updated":3,"link":null,"locked":false,"customData":{"plexus":{"mm":{"uid":"a1","map":"R","branch":"a"}}}},{"id":"pmm-R-a1-t","type":"text","x":342,"y":-45.5,"width":56,"height":20,"angle":0,"strokeColor":"#1e1e1e","backgroundColor":"transparent","fillStyle":"solid","strokeWidth":2,"strokeStyle":"solid","roughness":1,"opacity":100,"groupIds":[],"frameId":null,"index":null,"roundness":null,"seed":1,"version":1,"versionNonce":2,"isDeleted":false,"boundElements":null,"updated":3,"link":null,"locked":false,"text":"text a1","originalText":"text a1","fontSize":16,"fontFamily":5,"textAlign":"center","verticalAlign":"middle","containerId":"pmm-R-a1","autoResize":true,"lineHeight":1.25},{"id":"pmm-R-a2","type":"rectangle","x":328,"y":2.5,"width":124,"height":40,"angle":0,"strokeColor":"#1e1e1e","backgroundColor":"#a5d8ff","fillStyle":"solid","strokeWidth":2,"strokeStyle":"solid","roughness":1,"opacity":100,"groupIds":[],"frameId":null,"index":null,"roundness":{"type":3},"seed":1,"version":1,"versionNonce":2,"isDeleted":false,"boundElements":[{"id":"pmm-R-a2-t","type":"text"},{"id":"pmm-R-a2-e","type":"arrow"}],"updated":3,"link":null,"locked":false,"customData":{"plexus":{"mm":{"uid":"a2","map":"R","branch":"a"}}}},{"id":"pmm-R-a2-t","type":"text","x":342,"y":12.5,"width":96,"height":20,"angle":0,"strokeColor":"#1e1e1e","backgroundColor":"transparent","fillStyle":"solid","strokeWidth":2,"strokeStyle":"solid","roughness":1,"opacity":100,"groupIds":[],"frameId":null,"index":null,"roundness":null,"seed":1,"version":1,"versionNonce":2,"isDeleted":false,"boundElements":null,"updated":3,"link":null,"locked":false,"text":"text a2 (+1)","originalText":"text a2 (+1)","fontSize":16,"fontFamily":5,"textAlign":"center","verticalAlign":"middle","containerId":"pmm-R-a2","autoResize":true,"lineHeight":1.25},{"id":"pmm-R-b","type":"rectangle","x":170,"y":60.5,"width":88,"height":45,"angle":0,"strokeColor":"#1e1e1e","backgroundColor":"#b2f2bb","fillStyle":"solid","strokeWidth":2,"strokeStyle":"solid","roughness":1,"opacity":100,"groupIds":[],"frameId":null,"index":null,"roundness":{"type":3},"seed":1,"version":1,"versionNonce":2,"isDeleted":false,"boundElements":[{"id":"pmm-R-b-t","type":"text"},{"id":"pmm-R-b-e","type":"arrow"}],"updated":3,"link":null,"locked":false,"customData":{"plexus":{"mm":{"uid":"b","map":"R","branch":"b"}}}},{"id":"pmm-R-b-t","type":"text","x":184,"y":70.5,"width":60,"height":25,"angle":0,"strokeColor":"#1e1e1e","backgroundColor":"transparent","fillStyle":"solid","strokeWidth":2,"strokeStyle":"solid","roughness":1,"opacity":100,"groupIds":[],"frameId":null,"index":null,"roundness":null,"seed":1,"version":1,"versionNonce":2,"isDeleted":false,"boundElements":null,"updated":3,"link":null,"locked":false,"text":"text b","originalText":"text b","fontSize":20,"fontFamily":5,"textAlign":"center","verticalAlign":"middle","containerId":"pmm-R-b","autoResize":true,"lineHeight":1.25},{"id":"pmm-R-c","type":"rectangle","x":600,"y":200,"width":88,"height":45,"angle":0,"strokeColor":"#1e1e1e","backgroundColor":"#ffc9c9","fillStyle":"solid","strokeWidth":2,"strokeStyle":"solid","roughness":1,"opacity":100,"groupIds":[],"frameId":null,"index":null,"roundness":{"type":3},"seed":1,"version":1,"versionNonce":2,"isDeleted":false,"boundElements":[{"id":"pmm-R-c-t","type":"text"},{"id":"pmm-R-c-e","type":"arrow"},{"id":"pmm-R-c1-e","type":"arrow"}],"updated":3,"link":null,"locked":false,"customData":{"plexus":{"mm":{"uid":"c","map":"R","branch":"c","pinned":true}}}},{"id":"pmm-R-c-t","type":"text","x":614,"y":210,"width":60,"height":25,"angle":0,"strokeColor":"#1e1e1e","backgroundColor":"transparent","fillStyle":"solid","strokeWidth":2,"strokeStyle":"solid","roughness":1,"opacity":100,"groupIds":[],"frameId":null,"index":null,"roundness":null,"seed":1,"version":1,"versionNonce":2,"isDeleted":false,"boundElements":null,"updated":3,"link":null,"locked":false,"text":"text c","originalText":"text c","fontSize":20,"fontFamily":5,"textAlign":"center","verticalAlign":"middle","containerId":"pmm-R-c","autoResize":true,"lineHeight":1.25},{"id":"pmm-R-c1","type":"rectangle","x":758,"y":202.5,"width":84,"height":40,"angle":0,"strokeColor":"#1e1e1e","backgroundColor":"#ffc9c9","fillStyle":"solid","strokeWidth":2,"strokeStyle":"solid","roughness":1,"opacity":100,"groupIds":[],"frameId":null,"index":null,"roundness":{"type":3},"seed":1,"version":1,"versionNonce":2,"isDeleted":false,"boundElements":[{"id":"pmm-R-c1-t","type":"text"},{"id":"pmm-R-c1-e","type":"arrow"}],"updated":3,"link":null,"locked":false,"customData":{"plexus":{"mm":{"uid":"c1","map":"R","branch":"c"}}}},{"id":"pmm-R-c1-t","type":"text","x":772,"y":212.5,"width":56,"height":20,"angle":0,"strokeColor":"#1e1e1e","backgroundColor":"transparent","fillStyle":"solid","strokeWidth":2,"strokeStyle":"solid","roughness":1,"opacity":100,"groupIds":[],"frameId":null,"index":null,"roundness":null,"seed":1,"version":1,"versionNonce":2,"isDeleted":false,"boundElements":null,"updated":3,"link":null,"locked":false,"text":"text c1","originalText":"text c1","fontSize":16,"fontFamily":5,"textAlign":"center","verticalAlign":"middle","containerId":"pmm-R-c1","autoResize":true,"lineHeight":1.25},{"id":"pmm-R-a-b","type":"rectangle","x":158,"y":-67.5,"width":306,"height":122,"angle":0,"strokeColor":"#1e1e1e","backgroundColor":"transparent","fillStyle":"solid","strokeWidth":1,"strokeStyle":"dashed","roughness":1,"opacity":100,"groupIds":[],"frameId":null,"index":null,"roundness":{"type":3},"seed":1,"version":1,"versionNonce":2,"isDeleted":false,"boundElements":null,"updated":3,"link":null,"locked":false,"customData":{"plexus":{"mm":{"boundary":"a","map":"R"}}}}]`);
const TREE_0_11 = () => mk(["R", [["a", [["a1"], ["a2", [["a21"]], false]]], ["b"], ["c", [["c1"]]]]]);

test("a map made by 0.11.0 reconciles to zero ops (fixture)", () => {
  assert.equal(FIXTURE_0_11.length > 10, true);
  assert.ok(FIXTURE_0_11.some((e) => e.id === boundaryId("R", "a")));
  assert.ok(isEmptyOps(run(FIXTURE_0_11, TREE_0_11())));
  assert.ok(isEmptyOps(run(FIXTURE_0_11, TREE_0_11(), { tagColors: new Map(), rootDefaults: { attrEdges: true } })), "rootDefaults never touch an existing root");
  assert.equal(mmOf(get(FIXTURE_0_11, nodeId("R", "R"))).attrEdges, undefined);
});

const cs = (uid, kids, string) => [uid, kids, true, string];

test("attribute carriers: children keep ids, the carrier is swept, labels are bound to the moved edges", () => {
  const tree = mk(["R", [["a", [cs("c", [["x"], ["y"]], "Causes::"), ["z"]]], ["b"]]]);
  const els = build(tree, [], { rootDefaults: { attrEdges: true } });
  assert.equal(mmOf(get(els, nodeId("R", "R"))).attrEdges, true);
  assert.equal(get(els, nodeId("R", "c")), undefined, "carrier never drawn");
  const ids = live(els).map((e) => e.id);
  for (const u of ["a", "x", "y", "z", "b"]) assert.ok(ids.includes(nodeId("R", u)) && ids.includes(edgeId("R", u)) && ids.includes(textId("R", u)), u);
  const ex = get(els, edgeId("R", "x"));
  assert.equal(ex.startBinding.elementId, nodeId("R", "a"));
  assert.deepEqual(mmOf(ex), { edge: ["a", "x"], via: "c", map: "R" });
  assert.deepEqual(mmOf(get(els, edgeId("R", "z"))), { edge: ["a", "z"], map: "R" });
  const lx = get(els, labelId("R", "x"));
  assert.equal(lx.id, "pmm-R-x-e-t");
  assert.equal(lx.containerId, edgeId("R", "x"));
  assert.equal(lx.originalText, "Causes");
  assert.deepEqual(mmOf(lx), { label: "x", map: "R" });
  assert.deepEqual(ex.boundElements, [{ id: labelId("R", "x"), type: "text" }]);
  assert.equal(get(els, labelId("R", "z")), undefined, "plain children get no label");
  const r = arrowLabelRect(ex, lx.width, lx.height);
  assert.ok(Math.abs(r.x - lx.x) < 1e-9 && Math.abs(r.y - lx.y) < 1e-9);
  assert.ok(isEmptyOps(run(els, tree)));
  // the gap is widened so the label fits
  const a = get(els, nodeId("R", "a"));
  const x = get(els, nodeId("R", "x"));
  assert.ok(x.x - (a.x + a.width) >= Math.max(LEVEL_GAP, lx.width + 24) - 1e-9);
  // depth-1 nodes appear in the root's edges after splicing
  const flat = mk(["R", [cs("c", [["x"], ["y"]], "Causes::")]]);
  const fe = build(flat, [], { rootDefaults: { attrEdges: true } });
  assert.deepEqual(get(fe, nodeId("R", "R")).boundElements.map((b) => b.id), [textId("R", "R"), edgeId("R", "x"), edgeId("R", "y")]);
});

test("attribute carriers: toggle off restores the carrier without adds; toggle on sweeps it again", () => {
  const tree = mk(["R", [["a", [cs("c", [["x"]], "Causes::")]]]]);
  let els = build(tree, [], { rootDefaults: { attrEdges: true } });
  const n = els.length;
  els = els.map((e) => (e.id === nodeId("R", "R") ? patchMarker(e, { attrEdges: false }) : e));
  const off = run(els, tree);
  assert.ok(off.add.some((e) => e.id === nodeId("R", "c")), "the carrier node is new (never drawn before)");
  els = applyOps(els, off);
  assert.ok(get(els, nodeId("R", "c")) && !get(els, nodeId("R", "c")).isDeleted);
  assert.equal(get(els, labelId("R", "x")).isDeleted, true, "label swept");
  assert.equal(get(els, edgeId("R", "x")).startBinding.elementId, nodeId("R", "c"));
  assert.equal(mmOf(get(els, edgeId("R", "x"))).via, undefined);
  assert.ok(isEmptyOps(run(els, tree)));
  els = els.map((e) => (e.id === nodeId("R", "R") ? patchMarker(e, { attrEdges: true }) : e));
  const on = run(els, tree);
  assert.ok(on.remove.includes(nodeId("R", "c")) && on.remove.includes(textId("R", "c")) && on.remove.includes(edgeId("R", "c")));
  assert.equal(on.add.length, 0, "the label is un-deleted, not re-added");
  els = applyOps(els, on);
  assert.equal(get(els, labelId("R", "x")).isDeleted, false);
  assert.equal(get(els, edgeId("R", "x")).startBinding.elementId, nodeId("R", "a"));
  assert.ok(isEmptyOps(run(els, tree)));
  assert.ok(els.length >= n);
});

test("attribute edges are off for maps without the flag, and rootDefaults apply only at creation", () => {
  const tree = mk(["R", [["a", [cs("c", [["x"]], "Causes::")]]]]);
  const els = build(tree);
  assert.equal(mmOf(get(els, nodeId("R", "R"))).attrEdges, undefined);
  assert.ok(get(els, nodeId("R", "c")), "carrier drawn as an ordinary node");
  assert.equal(get(els, labelId("R", "x")), undefined);
  assert.ok(isEmptyOps(run(els, tree, { rootDefaults: { attrEdges: true } })));
});

test("a user's own edge label is kept and gets no Plexus label", () => {
  const tree = mk(["R", [["a", [cs("c", [["x"]], "Causes::")]]]]);
  let els = build(tree, [], { rootDefaults: { attrEdges: true } });
  const lbl = get(els, labelId("R", "x"));
  els = els.map((e) => (e.id === lbl.id ? { ...e, isDeleted: true } : e));
  els = els.map((e) => (e.id === edgeId("R", "x") ? { ...e, boundElements: [{ id: "usertext", type: "text" }] } : e));
  els = [...els, { ...lbl, id: "usertext", customData: undefined, containerId: edgeId("R", "x"), isDeleted: false }];
  const ops = run(els, tree);
  assert.ok(!ops.add.some((e) => e.id === labelId("R", "x")));
  const out = applyOps(els, ops);
  assert.deepEqual(get(out, edgeId("R", "x")).boundElements, [{ id: "usertext", type: "text" }]);
  assert.ok(isEmptyOps(run(out, tree)));
});

test("a native edit of a label is reverted on the next pass", () => {
  const tree = mk(["R", [cs("c", [["x"]], "Causes::")]]);
  let els = build(tree, [], { rootDefaults: { attrEdges: true } });
  els = els.map((e) => (e.id === labelId("R", "x") ? { ...e, text: "typed", originalText: "typed" } : e));
  els = applyOps(els, run(els, tree));
  assert.equal(get(els, labelId("R", "x")).originalText, "Causes");
});

test("task nodes: glyph in the text, DONE opacity 50 with marker, revert only while still 50", () => {
  const T = (state) => mk(["R", [["a", [], true, `{{[[${state}]]}} do it`], ["b"]]]);
  let els = build(T("TODO"));
  assert.equal(get(els, textId("R", "a")).originalText, "☐ do it");
  assert.equal(get(els, nodeId("R", "a")).opacity, 100);
  els = applyOps(els, run(els, T("DONE")));
  assert.equal(get(els, textId("R", "a")).originalText, "☑ do it");
  assert.equal(get(els, nodeId("R", "a")).opacity, 50);
  assert.equal(get(els, textId("R", "a")).opacity, 50);
  assert.equal(mmOf(get(els, nodeId("R", "a"))).done, true);
  assert.ok(isEmptyOps(run(els, T("DONE"))));
  const back = applyOps(els, run(els, T("TODO")));
  assert.equal(get(back, nodeId("R", "a")).opacity, 100);
  assert.equal(get(back, textId("R", "a")).opacity, 100);
  assert.equal(mmOf(get(back, nodeId("R", "a"))).done, undefined);
  assert.ok(isEmptyOps(run(back, T("TODO"))));
  const custom = els.map((e) => (e.id === nodeId("R", "a") ? { ...e, opacity: 30 } : e));
  const kept = applyOps(custom, run(custom, T("TODO")));
  assert.equal(get(kept, nodeId("R", "a")).opacity, 30, "a native opacity survives");
  // a new DONE node starts at 50
  const born = build(T("DONE"));
  assert.equal(get(born, nodeId("R", "a")).opacity, 50);
  assert.equal(mmOf(get(born, nodeId("R", "a"))).done, true);
});

test("task text shows its glyph through planMap", () => {
  const plan = planMap({ elements: [], tree: mk(["R", [["a", [], true, "{{[[TODO]]}} x"]]]), sizes });
  assert.equal(plan.info.get("a").text, "☐ x");
});

test("tag colours: set on create, repaint only on a tag event and only a Plexus fill; native recolour survives", () => {
  const tags = new Map([["urgent", "#ffc9c9"], ["ok", "#b2f2bb"]]);
  const T = (s) => mk(["R", [["a", [], true, s], ["b"]]]);
  let els = build(T("x #urgent"), [], { tagColors: tags });
  assert.equal(get(els, nodeId("R", "a")).backgroundColor, "#ffc9c9");
  assert.equal(mmOf(get(els, nodeId("R", "a"))).tag, "#ffc9c9");
  assert.ok(isEmptyOps(run(els, T("x #urgent"), { tagColors: tags })));
  // tag changes: Plexus fill follows
  let out = applyOps(els, run(els, T("x #ok"), { tagColors: tags }));
  assert.equal(get(out, nodeId("R", "a")).backgroundColor, "#b2f2bb");
  assert.ok(isEmptyOps(run(out, T("x #ok"), { tagColors: tags })));
  // tag removed: back to the branch colour
  out = applyOps(out, run(out, T("x"), { tagColors: tags }));
  assert.equal(get(out, nodeId("R", "a")).backgroundColor, BRANCH_COLORS[0]);
  assert.equal(mmOf(get(out, nodeId("R", "a"))).tag, undefined);
  // native recolour survives a tag change but the marker still updates
  const native = els.map((e) => (e.id === nodeId("R", "a") ? { ...e, backgroundColor: "#000000" } : e));
  const kept = applyOps(native, run(native, T("x #ok"), { tagColors: tags }));
  assert.equal(get(kept, nodeId("R", "a")).backgroundColor, "#000000");
  assert.equal(mmOf(get(kept, nodeId("R", "a"))).tag, "#b2f2bb");
  assert.ok(isEmptyOps(run(kept, T("x #ok"), { tagColors: tags })));
  // a colour map change alone repaints the Plexus fill
  const remap = new Map([["urgent", "#111111"]]);
  const re = applyOps(els, run(els, T("x #urgent"), { tagColors: remap }));
  assert.equal(get(re, nodeId("R", "a")).backgroundColor, "#111111");
  // the DONE macro counts as the tag "done"
  const D = mk(["R", [["a", [], true, "{{[[DONE]]}} y"]]]);
  const de = build(D, [], { tagColors: new Map([["done", "#b2f2bb"]]) });
  assert.equal(get(de, nodeId("R", "a")).backgroundColor, "#b2f2bb");
});

test("cause map: star on the effect, caused by labels, palette by depth, evidence dash, zero-op", () => {
  const tree = mk(["R", [["a", [["a1"], ["a2", [], true, "seen #evidence"]]], ["b"]]]);
  const els = build(tree, [], { layout: "cause" });
  const root = get(els, nodeId("R", "R"));
  assert.equal(get(els, textId("R", "R")).originalText, "★ text R");
  assert.equal(root.backgroundColor, CAUSE_FILLS[0]);
  assert.equal(get(els, nodeId("R", "a")).backgroundColor, CAUSE_FILLS[1]);
  assert.equal(get(els, nodeId("R", "a1")).backgroundColor, CAUSE_FILLS[2]);
  assert.equal(get(els, nodeId("R", "b")).backgroundColor, CAUSE_FILLS[1]);
  assert.equal(mmOf(root).scheme, "cause");
  assert.equal(mmOf(root).layout, "cause");
  assert.equal(get(els, nodeId("R", "a2")).strokeStyle, "dashed");
  assert.equal(mmOf(get(els, nodeId("R", "a2"))).dash, true);
  assert.equal(get(els, nodeId("R", "a1")).strokeStyle, "solid");
  for (const u of ["a", "a1", "a2", "b"]) assert.equal(get(els, labelId("R", u)).originalText, "caused by", u);
  assert.equal(get(els, labelId("R", "R")), undefined);
  // left geometry: children left of the root
  assert.ok(get(els, nodeId("R", "a")).x + get(els, nodeId("R", "a")).width < root.x);
  const e = get(els, edgeId("R", "a"));
  assert.equal(e.x, root.x);
  assert.ok(isEmptyOps(run(els, tree, { layout: "cause" })));
  // label wrap follows the Excalidraw formula
  const lbl = get(els, labelId("R", "a"));
  assert.ok(lbl.width <= arrowLabelWrapWidth(Math.abs(e.points[1][0]), 16) + 1e-9);
  assert.equal(lbl.fontSize, 16);
});

test("cause map: an attribute label wins over caused by", () => {
  const tree = mk(["R", [cs("c", [["x"]], "Because::"), ["y"]]]);
  const els = build(tree, [], { layout: "cause", rootDefaults: { attrEdges: true } });
  assert.equal(get(els, labelId("R", "x")).originalText, "Because");
  assert.equal(get(els, labelId("R", "y")).originalText, "caused by");
});

test("switching cause <-> right repaints only what Plexus coloured; a second pass is empty", () => {
  const tree = mk(["R", [["a", [["a1"]]], ["b"]]]);
  let els = build(tree, [], { layout: "right" });
  els = els.map((e) => (e.id === nodeId("R", "a1") ? { ...e, backgroundColor: "#000000" } : e));
  const rootBefore = get(els, nodeId("R", "R"));
  els = els.map((e) => (e === rootBefore ? patchMarker(e, { layout: "cause" }) : e));
  els = applyOps(els, run(els, tree));
  assert.equal(get(els, nodeId("R", "R")).backgroundColor, CAUSE_FILLS[0]);
  assert.equal(get(els, nodeId("R", "a")).backgroundColor, CAUSE_FILLS[1]);
  assert.equal(get(els, nodeId("R", "a1")).backgroundColor, "#000000", "native recolour survives");
  assert.equal(mmOf(get(els, nodeId("R", "R"))).scheme, "cause");
  assert.ok(isEmptyOps(run(els, tree)));
  els = els.map((e) => (e.id === nodeId("R", "R") ? patchMarker(e, { layout: "right" }) : e));
  els = applyOps(els, run(els, tree));
  assert.equal(get(els, nodeId("R", "R")).backgroundColor, ROOT_COLOR);
  assert.equal(get(els, nodeId("R", "a")).backgroundColor, BRANCH_COLORS[0]);
  assert.equal(get(els, nodeId("R", "b")).backgroundColor, BRANCH_COLORS[1]);
  assert.equal(get(els, nodeId("R", "a1")).backgroundColor, "#000000");
  assert.equal(mmOf(get(els, nodeId("R", "R"))).scheme, undefined);
  assert.equal(get(els, textId("R", "R")).originalText, "text R");
  assert.equal(get(els, labelId("R", "a")).isDeleted, true);
  assert.ok(isEmptyOps(run(els, tree)));
});

test("evidence dash reverts when the tag or the cause layout goes away, only while still dashed", () => {
  const T = (s) => mk(["R", [["a", [], true, s]]]);
  let els = build(T("x #[[Evidence]]"), [], { layout: "cause" });
  assert.equal(get(els, nodeId("R", "a")).strokeStyle, "dashed");
  const off = applyOps(els, run(els, T("x")));
  assert.equal(get(off, nodeId("R", "a")).strokeStyle, "solid");
  assert.ok(isEmptyOps(run(off, T("x"))));
  const native = els.map((e) => (e.id === nodeId("R", "a") ? { ...e, strokeStyle: "dotted" } : e));
  assert.equal(get(applyOps(native, run(native, T("x"))), nodeId("R", "a")).strokeStyle, "dotted");
  // evidence is a cause-map feature
  assert.equal(get(build(T("x #evidence")), nodeId("R", "a")).strokeStyle, "solid");
  assert.equal(get(build(T("x #evidenceX"), [], { layout: "cause" }), nodeId("R", "a")).strokeStyle, "solid");
});

test("fishbone: head at the anchor, spine, bones alternate, level-1 edges start unbound on the spine", () => {
  const tree = mk(["R", [["a", [["a1"]]], ["b"], ["c"], ["d"]]]);
  let els = build(tree, [], { layout: "fishbone", rootPos: { x: 900, y: 400 } });
  const root = get(els, nodeId("R", "R"));
  assert.deepEqual([root.x, root.y], [900, 400]);
  const spine = get(els, spineId("R"));
  assert.equal(spine.type, "line");
  assert.equal(spine.id, "pmm-R-R-s");
  assert.deepEqual(mmOf(spine), { spine: "R", map: "R" });
  assert.equal(spine.startBinding, null);
  assert.equal(spine.y, root.y + root.height / 2);
  assert.equal(spine.x + spine.points[1][0], root.x);
  assert.equal(spine.points[1][1], 0);
  const cy = (u) => get(els, nodeId("R", u)).y + get(els, nodeId("R", u)).height / 2;
  assert.ok(cy("a") < spine.y && cy("b") > spine.y && cy("c") < spine.y && cy("d") > spine.y);
  const ea = get(els, edgeId("R", "a"));
  assert.equal(ea.startBinding, null);
  assert.equal(ea.y, spine.y);
  assert.ok(ea.x >= spine.x && ea.x <= root.x);
  assert.equal(ea.endBinding.elementId, nodeId("R", "a"));
  assert.equal(get(els, edgeId("R", "a1")).startBinding.elementId, nodeId("R", "a"), "ribs bind to their bone");
  assert.deepEqual(root.boundElements.map((b) => b.id), [textId("R", "R")]);
  assert.equal(get(els, labelId("R", "a")).originalText, "caused by");
  assert.ok(isEmptyOps(run(els, tree, { layout: "fishbone" })));
  // leaving fishbone: bindings and spine go back to the normal rule
  els = els.map((e) => (e.id === nodeId("R", "R") ? patchMarker(e, { layout: "cause" }) : e));
  els = applyOps(els, run(els, tree));
  assert.equal(get(els, spineId("R")).isDeleted, true);
  assert.equal(get(els, edgeId("R", "a")).startBinding.elementId, nodeId("R", "R"));
  assert.ok(get(els, nodeId("R", "R")).boundElements.some((b) => b.id === edgeId("R", "a")));
  assert.ok(isEmptyOps(run(els, tree)));
  els = els.map((e) => (e.id === nodeId("R", "R") ? patchMarker(e, { layout: "fishbone" }) : e));
  els = applyOps(els, run(els, tree));
  assert.equal(get(els, spineId("R")).isDeleted, false);
  assert.equal(get(els, edgeId("R", "a")).startBinding, null);
  assert.ok(isEmptyOps(run(els, tree)));
});

test("copy rule covers labels and the spine: copies lose the marker and are never deleted", () => {
  const tree = mk(["R", [["a"], ["b"]]]);
  let els = build(tree, [], { layout: "fishbone" });
  const lbl = get(els, labelId("R", "a"));
  const sp = get(els, spineId("R"));
  els = [...els, { ...lbl, id: "lblcopy" }, { ...sp, id: "spinecopy" }];
  const out = applyOps(els, run(els, tree, { layout: "fishbone" }));
  assert.equal(mmOf(get(out, "lblcopy")), undefined);
  assert.equal(mmOf(get(out, "spinecopy")), undefined);
  assert.equal(get(out, "lblcopy").isDeleted, false);
  assert.ok(isEmptyOps(run(out, tree, { layout: "fishbone" })));
});

test("planMap exposes the drawn tree and the raw tree stays untouched", () => {
  const tree = mk(["R", [["a", [cs("c", [["x"]], "K::")]]]]);
  const snap = JSON.stringify(tree);
  const plan = planMap({ elements: [], tree, sizes, rootDefaults: { attrEdges: true } });
  assert.equal(JSON.stringify(tree), snap);
  assert.deepEqual(plan.nodes.map((v) => v.node.uid), ["R", "a", "x"]);
  assert.equal(plan.vtree.children[0].children[0].via, "c");
  assert.deepEqual(visibleNodes(visualTree(tree, { attrEdges: true })).map((v) => v.node.uid), ["R", "a", "x"]);
  assert.ok(plan.positions.x);
});

// ---- P13 amendment 9(b): existing layouts stay byte-identical to b47ad09 ----

const norm = (v) => JSON.parse(JSON.stringify(v, (k, x) => (k === "seed" || k === "versionNonce" || k === "updated" ? undefined : x)));
function goldenRun(layout) {
  const t1 = mk(["R", [["a", [["a1", [], true, "{{[[TODO]]}} do a1"], ["a2", [["a21"]], false]]], ["b", [["b1", [], true, "b1 #evidence"], ["b2"]]], ["c"]]]);
  const t2 = mk(["R", [["a", [["a1", [], true, "changed a1 text that is quite a bit longer than before"], ["a2", [["a21"]], false]]], ["b", [["b1"]]], ["c", [["c1"]]]]]);
  const first = reconcile({ elements: [], tree: t1, sizes, layout });
  let els = applyOps([], first);
  assert.ok(isEmptyOps(reconcile({ elements: els, tree: t1, sizes, layout })), `${layout} second pass`);
  els = els.map((e) => (e.id === nodeId("R", "R") ? patchMarker(e, { bounds: ["a"] }) : e));
  els = applyOps(els, reconcile({ elements: els, tree: t1, sizes, layout }));
  const second = reconcile({ elements: els, tree: t2, sizes, layout });
  return norm({ first, second });
}
const GOLDEN = {
  right: "fa6a8cdb4176d4f1", down: "3ddb250512ba0da4", left: "0fc0dc8602e2f1d1", up: "0ea46aa933776e13",
  radial: "37156e41a0f5908a", cause: "77be11bbd4970d5c", fishbone: "6f841bbb8a948011",
};
for (const layout of Object.keys(GOLDEN)) {
  test(`golden: ${layout} ops are byte-identical to b47ad09`, async () => {
    const { createHash } = await import("node:crypto");
    const h = createHash("sha256").update(JSON.stringify(goldenRun(layout))).digest("hex").slice(0, 16);
    assert.equal(h, GOLDEN[layout]);
  });
}

// ---- P13 flow layout ----

const FLOW_STRINGS = () => mk(["R", [
  ["recv", [["l1", [], true, "Lane:: Warehouse"]], true, "Receive"],
  ["store", [], true, "Store"],
  ["qa", [
    ["y", [["y1", [["ref", [], true, "((q))"]], true, "Investigate"]], true, "Yes: Hold #lane/QA"],
    ["no", [["d2", [["q", [], true, "Q"], ["s", [], true, "Stop #end"]], true, "Deeper?"]], true, "No: fill #lane/Line"],
  ], true, "Metal detected? #CCP1 #hazard #lane/QA"],
  ["fold", [["fk", [], true, "hidden"]], false, "Folded check?"],
  ["selfy", [["sr", [], true, "((sr))"]], true, "Selfy"],
  ["ship", [], true, "Ship #end"],
], true, "Process"]);
const flowBuild = (tree, elements = [], extra = {}) => applyOps(elements, run(elements, tree, { layout: "flow", ...extra }));
const idsOf = (els) => live(els).map((e) => e.id);

test("flow: builds oval root, diamond decisions, end oval, chips and locked lane frames; second pass is zero-op", () => {
  const tree = FLOW_STRINGS();
  const ops = run([], tree, { layout: "flow" });
  const els = applyOps([], ops);
  assert.ok(isEmptyOps(run(els, tree, { layout: "flow" })), "second pass");
  assert.equal(get(els, nodeId("R", "R")).type, "ellipse");
  assert.equal(get(els, nodeId("R", "R")).roundness, null);
  assert.equal(get(els, nodeId("R", "qa")).type, "diamond");
  assert.deepEqual(get(els, nodeId("R", "qa")).roundness, { type: 2 });
  assert.equal(get(els, nodeId("R", "fold")).type, "diamond", "a folded decision stays a diamond");
  assert.equal(get(els, nodeId("R", "ship")).type, "ellipse");
  assert.equal(get(els, nodeId("R", "y")).type, "rectangle");
  assert.deepEqual(get(els, nodeId("R", "y")).roundness, { type: 3 });
  assert.equal(mmOf(get(els, nodeId("R", "R"))).scheme, "flow");
  assert.equal(mmOf(get(els, nodeId("R", "R"))).layout, "flow");
  assert.equal(mmOf(get(els, nodeId("R", "qa"))).shape, "diamond");
  assert.equal(mmOf(get(els, nodeId("R", "y"))).shape, undefined);
  assert.equal(mmOf(get(els, nodeId("R", "y"))).branch, undefined);
  assert.equal(get(els, textId("R", "fold")).text.endsWith("(+1)"), true);
  assert.equal(get(els, nodeId("R", "recv")).backgroundColor, BRANCH_COLORS[0]);
  assert.equal(get(els, nodeId("R", "R")).backgroundColor, ROOT_COLOR);
  // control blocks are never drawn; the unresolvable self ref is a plain node
  for (const u of ["l1", "ref"]) assert.equal(get(els, nodeId("R", u)), undefined, u);
  assert.ok(get(els, nodeId("R", "sr")));
  assert.equal(get(els, textId("R", "sr")).text, "…");
  // lanes
  const frames = els.filter((e) => e.type === "frame");
  assert.deepEqual(frames.map((f) => f.name), ["Warehouse", "QA", "Line"]);
  for (const f of frames) {
    assert.equal(f.locked, true);
    assert.equal(f.id, laneId("R", f.name));
    assert.deepEqual(mmOf(f), { lane: f.name, map: "R" });
    assert.equal(f.height, frames[0].height);
    const at = els.indexOf(f);
    for (const e of els) if (e.frameId === f.id) assert.ok(els.indexOf(e) < at, `${e.id} comes before its frame`);
  }
  assert.equal(get(els, nodeId("R", "recv")).frameId, laneId("R", "Warehouse"));
  assert.equal(get(els, textId("R", "recv")).frameId, laneId("R", "Warehouse"));
  assert.equal(get(els, nodeId("R", "R")).frameId, null, "lane '' has no frame");
  // chips: not grouped, ids -c-n, bound text, inside the lane
  const c0 = get(els, chipId("R", "qa", 0));
  const c1 = get(els, chipId("R", "qa", 1));
  assert.deepEqual(mmOf(c0), { chip: "qa", kind: "ccp", map: "R" });
  assert.deepEqual(mmOf(c1), { chip: "qa", kind: "hazard", map: "R" });
  assert.equal(get(els, chipTextId("R", "qa", 0)).text, "CCP 1");
  assert.equal(get(els, chipTextId("R", "qa", 1)).text, "Hazard");
  for (const el of [c0, c1, get(els, nodeId("R", "qa")), get(els, textId("R", "qa"))]) assert.deepEqual(el.groupIds, []);
  assert.equal(c0.frameId, laneId("R", "QA"));
  assert.equal(get(els, chipTextId("R", "qa", 0)).frameId, laneId("R", "QA"));
  // frame contains every member and chip
  const qa = frames.find((f) => f.name === "QA");
  for (const e of els.filter((x) => x.frameId === qa.id && x.type !== "text")) {
    assert.ok(e.x >= qa.x && e.x + e.width <= qa.x + qa.width, `${e.id} x inside`);
    assert.ok(e.y >= qa.y && e.y + e.height <= qa.y + qa.height, `${e.id} y inside`);
  }
});

test("flow: diamond and ellipse containers use Excalidraw's own sizing, and bound text sits at computeBoundTextPosition", () => {
  const els = flowBuild(FLOW_STRINGS());
  for (const [uid, type] of [["qa", "diamond"], ["R", "ellipse"], ["ship", "ellipse"]]) {
    const node = get(els, nodeId("R", uid));
    const t = get(els, textId("R", uid));
    assert.equal(node.width, containerDimension(t.width + 4, type), `${uid} width`);
    assert.equal(node.height, containerDimension(t.height + 4, type), `${uid} height`);
    // the wrap width Excalidraw would use is at least the text width
    const maxW = type === "diamond" ? Math.round(node.width / 2) - 10 : Math.round((node.width / 2) * Math.SQRT2) - 10;
    assert.ok(maxW >= t.width, `${uid} keeps its wrapping`);
    const pos = textRect(node, t.width, t.height, type);
    assert.ok(Math.abs(pos.x - t.x) <= 0.5 && Math.abs(pos.y - t.y) <= 0.5);
    assert.ok(Math.abs(t.x + t.width / 2 - (node.x + node.width / 2)) <= 0.5, "centred");
  }
  assert.equal(containerDimension(100, "diamond"), 220);
  assert.equal(containerDimension(100, "ellipse"), Math.round((110 / Math.SQRT2) * 2));
  assert.equal(containerDimension(100, "rectangle"), 110);
});

test("flow: primary edges keep the edge key; merge and loop arrows have their own ids and no edge key; arrowheads and dashes", () => {
  const els = flowBuild(FLOW_STRINGS());
  const arrows = live(els).filter((e) => e.type === "arrow");
  assert.ok(arrows.length >= 10);
  for (const a of arrows) assert.equal(a.endArrowhead, "arrow", a.id);
  const prim = get(els, edgeId("R", "recv"));
  assert.deepEqual(mmOf(prim), { edge: ["R", "recv"], map: "R", flow: "seq" });
  assert.equal(mmOf(get(els, edgeId("R", "y"))).flow, "branch");
  assert.equal(get(els, labelId("R", "y")).text, "Yes");
  assert.equal(get(els, labelId("R", "no")).text, "No");
  const merge = get(els, mergeId("R", "q"));
  assert.deepEqual(mmOf(merge), { flow: { from: "q", to: "fold", kind: "merge" }, map: "R" });
  assert.equal(merge.strokeStyle, "solid");
  const loop = get(els, loopId("R", "ref"));
  assert.deepEqual(mmOf(loop), { flow: { from: "y1", to: "q", kind: "loop", via: "ref" }, map: "R" });
  assert.equal(loop.strokeStyle, "dashed");
  assert.equal(loop.startBinding.elementId, nodeId("R", "y1"));
  assert.equal(loop.endBinding.elementId, nodeId("R", "q"));
  assert.equal(mmOf(merge).edge, undefined);
  assert.equal(get(els, edgeId("R", "fold")), undefined, "a merge target has no primary edge");
  // boundElements list every arrow in and out, primary and secondary
  const bound = (uid) => get(els, nodeId("R", uid)).boundElements.filter((b) => b.type === "arrow").map((b) => b.id);
  assert.equal(bound("q").length, 3);
  assert.ok(bound("q").includes(loopId("R", "ref")) && bound("q").includes(mergeId("R", "q")) && bound("q").includes(edgeId("R", "q")));
  assert.ok(bound("y1").includes(loopId("R", "ref")));
  assert.ok(bound("fold").includes(mergeId("R", "q")));
  assert.ok(!idsOf(els).includes(mergeId("R", "s")), "#end has no merge");
  assert.ok(!idsOf(els).includes(mergeId("R", "y1")), "a branch ending in a ref has no merge");
});

test("flow: a fold reconciles away members, and a second pass is still empty", () => {
  const tree = FLOW_STRINGS();
  let els = flowBuild(tree);
  const folded = mk(["R", [["recv", [["l1", [], true, "Lane:: Warehouse"]], true, "Receive"], ["store", [], true, "Store"],
    ["qa", [["y", [], true, "Yes: Hold #lane/QA"], ["no", [], true, "No: fill"]], false, "Metal detected? #CCP1"], ["ship", [], true, "Ship"]], true, "Process"]);
  els = flowBuild(folded, els);
  assert.equal(get(els, nodeId("R", "y")).isDeleted, true);
  assert.equal(get(els, nodeId("R", "qa")).type, "diamond");
  assert.ok(isEmptyOps(run(els, folded, { layout: "flow" })));
  assert.equal(get(els, textId("R", "qa")).text.endsWith("(+2)"), true);
});

test("flow: planMap gives a position to every drawn step and never routes through layoutTree", () => {
  const tree = FLOW_STRINGS();
  const plan = planMap({ elements: [], tree, sizes, layout: "flow" });
  assert.equal(plan.dir, "flow");
  assert.equal(plan.family, "flow");
  for (const v of plan.nodes) assert.ok(plan.positions[v.node.uid], v.node.uid);
  assert.deepEqual(plan.positions.R, { x: 0, y: 0 });
  assert.equal(plan.info.get("qa").shape, "diamond");
  assert.equal(plan.info.get("qa").fs, 16);
  assert.equal(plan.info.get("R").fs, 20);
  assert.ok(plan.flow.frames.length === 3);
  assert.equal(planMap({ elements: [], tree, sizes, layout: "right" }).flow, null);
  // the root anchors at its element position
  const els = flowBuild(tree, [], { rootPos: { x: 40, y: 50 } });
  const moved = els.map((e) => (e.id === nodeId("R", "R") ? { ...e, x: 300, y: 200 } : e));
  const plan2 = planMap({ elements: moved, tree, sizes, layout: "flow" });
  assert.deepEqual(plan2.positions.R, { x: 300, y: 200 });
});

test("flow: decision text wraps at 160 and steps at 240", () => {
  const seen = [];
  const spy = (text, fs, uid, maxWidth) => { seen.push([uid, fs, maxWidth]); return sizes(text, fs, uid, maxWidth); };
  planMap({ elements: [], tree: mk(["R", [["d", [["y"]], true, "Is it fine?"], ["s", [], true, "Step"]], true, "Root"]), sizes: spy, layout: "flow" });
  assert.deepEqual(seen.find((x) => x[0] === "d"), ["d", 16, 160]);
  assert.deepEqual(seen.find((x) => x[0] === "s"), ["s", 16, undefined]);
  assert.deepEqual(seen.find((x) => x[0] === "R"), ["R", 20, undefined]);
});

test("flow: right -> flow -> right leaves no lane, chip, merge, loop, stale frameId or arrowhead", () => {
  const tree = FLOW_STRINGS();
  let els = build(tree, [], { layout: "right" });
  els = els.map((e) => (e.id === nodeId("R", "R") ? patchMarker(e, { layout: "flow" }) : e));
  els = build(tree, els);
  assert.ok(idsOf(els).includes(mergeId("R", "q")));
  assert.equal(get(els, nodeId("R", "qa")).type, "diamond");
  assert.ok(isEmptyOps(run(els, tree)));
  els = els.map((e) => (e.id === nodeId("R", "R") ? patchMarker(e, { layout: "right" }) : e));
  els = build(tree, els);
  assert.ok(isEmptyOps(run(els, tree)), "second pass after switching back");
  const ids = idsOf(els);
  for (const id of ids) assert.ok(!id.includes("-lane-") && !/-c-\d/.test(id) && !id.endsWith("-m") && !id.endsWith("-l"), id);
  for (const e of live(els)) {
    if (e.type === "frame") assert.fail("no frames");
    assert.ok(!(typeof e.frameId === "string" && e.frameId.startsWith(lanePrefix("R"))), `${e.id} stale frameId`);
    if (e.type === "arrow") assert.equal(e.endArrowhead, null, e.id);
    if (e.type === "ellipse" || e.type === "diamond") assert.fail(`${e.id} kept its shape`);
  }
  assert.deepEqual(get(els, nodeId("R", "R")).roundness, { type: 3 });
  assert.equal(mmOf(get(els, nodeId("R", "R"))).scheme, undefined);
  assert.equal(mmOf(get(els, nodeId("R", "qa"))).shape, undefined);
  assert.ok(get(els, nodeId("R", "l1")), "the lane block is an ordinary node in right layout");
  // the same tree in right layout from scratch has the same live element ids
  const fresh = idsOf(build(tree, [], { layout: "right" }));
  assert.deepEqual([...ids].sort(), [...fresh].sort());
});

test("flow: switching layouts repaints only fills Plexus set; a native recolour survives", () => {
  const tree = FLOW_STRINGS();
  let els = build(tree, [], { layout: "right" });
  els = els.map((e) => (e.id === nodeId("R", "store") ? { ...e, backgroundColor: "#123456" } : e));
  els = els.map((e) => (e.id === nodeId("R", "R") ? patchMarker(e, { layout: "flow" }) : e));
  els = build(tree, els);
  assert.equal(get(els, nodeId("R", "store")).backgroundColor, "#123456");
  assert.equal(get(els, nodeId("R", "recv")).backgroundColor, BRANCH_COLORS[0], "Plexus fill repainted to the flow colour");
  assert.ok(isEmptyOps(run(els, tree)));
});

test("flow: shape and arrowhead changes are events; user edits after them stand", () => {
  const tree = FLOW_STRINGS();
  let els = flowBuild(tree);
  // user turns the decision into a rectangle natively: no revert while the marker still says diamond
  els = els.map((e) => (e.id === nodeId("R", "qa") ? { ...e, type: "rectangle" } : e));
  assert.ok(isEmptyOps(run(els, tree)));
  // user removes an arrowhead on a flow edge: left alone
  els = els.map((e) => (e.id === edgeId("R", "recv") ? { ...e, endArrowhead: null } : e));
  assert.ok(isEmptyOps(run(els, tree)));
  // removing the question mark turns a diamond into a rectangle, in place under the same id
  const t2 = mk(["R", [["a", [], true, "Ok?"]], true, "P"]);
  let e2 = flowBuild(t2);
  const idA = get(e2, nodeId("R", "a")).id;
  const t3 = mk(["R", [["a", [], true, "Ok"]], true, "P"]);
  const ops = run(e2, t3, { layout: "flow" });
  const patch = ops.update.find((u) => u.id === idA).patch;
  assert.equal(patch.type, "rectangle");
  assert.deepEqual(patch.roundness, { type: 3 });
  e2 = applyOps(e2, ops);
  assert.equal(get(e2, idA).type, "rectangle");
  assert.equal(get(e2, idA).id, idA);
  assert.ok(isEmptyOps(run(e2, t3, { layout: "flow" })));
});

test("flow: stale lane frameIds are cleared, a removed lane leaves no live frame, lane '' keeps a user frame", () => {
  const tree = FLOW_STRINGS();
  let els = flowBuild(tree);
  const noQA = mk(["R", [["recv", [["l1", [], true, "Lane:: Warehouse"]], true, "Receive"], ["store", [], true, "Store"], ["ship", [], true, "Ship"]], true, "Process"]);
  els = els.map((e) => (e.id === nodeId("R", "ship") ? { ...e, frameId: "userframe" } : e));
  const ops = run(els, noQA, { layout: "flow" });
  els = applyOps(els, ops);
  assert.equal(get(els, laneId("R", "QA")).isDeleted, true);
  assert.equal(get(els, laneId("R", "Warehouse")).isDeleted, false);
  assert.ok(isEmptyOps(run(els, noQA, { layout: "flow" })));
  for (const e of live(els)) assert.ok(!(typeof e.frameId === "string" && e.frameId.startsWith(lanePrefix("R")) && e.frameId !== laneId("R", "Warehouse")), `${e.id}: ${e.frameId}`);
  assert.equal(get(els, nodeId("R", "ship")).frameId, laneId("R", "Warehouse"), "ship inherits the Warehouse lane");
  // a lane-'' step keeps whatever non-lane frame it has
  const plain = mk(["R", [["a", [], true, "A"]], true, "P"]);
  let pe = flowBuild(plain);
  pe = pe.map((e) => (e.id === nodeId("R", "a") ? { ...e, frameId: "userframe" } : e));
  assert.ok(isEmptyOps(run(pe, plain, { layout: "flow" })));
  // a step that leaves a still-existing lane for lane '' drops that lane's frameId
  const t1 = mk(["R", [["a", [], true, "A #lane/X"], ["b", [], true, "B #lane/Y"]], true, "P"]);
  let le = flowBuild(t1);
  assert.equal(get(le, nodeId("R", "b")).frameId, laneId("R", "Y"));
  const t2 = mk(["R", [["a", [], true, "A #lane/X"], ["b", [], true, "B"]], true, "P"]);
  le = applyOps(le, run(le, t2, { layout: "flow" }));
  assert.equal(get(le, nodeId("R", "b")).frameId, laneId("R", "X"), "inherits from its predecessor");
});

test("flow: an element undeleted by the pass drops its stale lane frameId in the same pass", () => {
  const spec = (open, tag) => mk(["R", [["p", [["a", [], true, tag ? "A #lane/C" : "A"]], open, "P"]], true, "Root"]);
  let els = flowBuild(spec(true, true));
  assert.equal(get(els, nodeId("R", "a")).frameId, laneId("R", "C"));
  els = applyOps(els, run(els, spec(false, true), { layout: "flow" }));
  assert.equal(get(els, nodeId("R", "a")).isDeleted, true);
  els = applyOps(els, run(els, spec(false, false), { layout: "flow" }));
  els = applyOps(els, run(els, spec(true, false), { layout: "flow" }));
  assert.equal(get(els, nodeId("R", "a")).isDeleted, false);
  assert.ok(isEmptyOps(run(els, spec(true, false), { layout: "flow" })), "second pass is zero-op");
  assert.equal(get(els, nodeId("R", "a")).frameId, null);
});

test("flow: chip containers leave room for Excalidraw's bound-text padding", () => {
  const els = flowBuild(FLOW_STRINGS());
  for (const id of [chipId("R", "qa", 0), chipId("R", "qa", 1)]) {
    const c = get(els, id);
    const t = get(els, id.replace(/-c-(\d)$/, "-c-$1-t")) ?? els.find((e) => e.containerId === id);
    assert.ok(c.height >= t.height + 10, `${id}: ${c.height} vs ${t.height}`);
  }
});

test("flow: copies of lanes, chips, merge and loop arrows lose the marker and are never deleted", () => {
  const els = flowBuild(FLOW_STRINGS());
  const copies = [laneId("R", "QA"), chipId("R", "qa", 0), mergeId("R", "q"), loopId("R", "ref"), edgeId("R", "recv")].map((id, i) => ({ ...get(els, id), id: `copy${i}` }));
  const ops = run([...els, ...copies], FLOW_STRINGS(), { layout: "flow" });
  assert.equal(ops.remove.length, 0);
  for (const c of copies) {
    const u = ops.update.find((x) => x.id === c.id);
    assert.ok(u, c.id);
    assert.equal(u.patch.customData ?? null, null, `${c.id} lost its marker`);
  }
});

test("flow: an existing lane frame is reconciled, undeleted, and keeps user styling and lock state", () => {
  const tree = FLOW_STRINGS();
  let els = flowBuild(tree);
  const id = laneId("R", "QA");
  els = els.map((e) => (e.id === id ? { ...e, strokeColor: "#ff0000", locked: false, isDeleted: true, x: e.x + 30, name: "old" } : e));
  const ops = run(els, tree, { layout: "flow" });
  const p = ops.update.find((u) => u.id === id).patch;
  assert.equal(p.isDeleted, false);
  assert.equal(p.name, "QA");
  assert.ok("x" in p);
  assert.ok(!("locked" in p) && !("strokeColor" in p));
});

test("flow: chip text edits are reverted and a deleted chip is undeleted", () => {
  const tree = FLOW_STRINGS();
  let els = flowBuild(tree);
  els = els.map((e) => (e.id === chipTextId("R", "qa", 0) ? { ...e, text: "hacked", originalText: "hacked" } : e.id === chipId("R", "qa", 1) ? { ...e, isDeleted: true } : e));
  els = applyOps(els, run(els, tree, { layout: "flow" }));
  assert.equal(get(els, chipTextId("R", "qa", 0)).text, "CCP 1");
  assert.equal(get(els, chipId("R", "qa", 1)).isDeleted, false);
  assert.ok(isEmptyOps(run(els, tree, { layout: "flow" })));
  // dropping the tag removes the chip and its text
  const t2 = mk(["R", [["qa", [], true, "Metal detected?"]], true, "P"]);
  const els2 = applyOps(els, run(els, t2, { layout: "flow" }));
  assert.equal(get(els2, chipId("R", "qa", 0)).isDeleted, true);
  assert.equal(get(els2, chipTextId("R", "qa", 0)).isDeleted, true);
});

test("flow: the branch label prefix is drawn on the arrow, not in the node; the block string is never needed by the sync", () => {
  const els = flowBuild(mk(["R", [["d", [["y", [], true, "{{[[TODO]]}} Yes: go on"], ["n", [], true, "No: stop #end"]], true, "Ok?"]], true, "P"]));
  assert.equal(get(els, textId("R", "y")).text, "☐ go on");
  assert.equal(get(els, labelId("R", "y")).text, "Yes");
  assert.equal(get(els, textId("R", "n")).text, "stop");
  assert.equal(get(els, textId("R", "d")).text, "Ok?");
  assert.equal(get(els, nodeId("R", "n")).type, "ellipse");
  assert.equal(mmOf(get(els, nodeId("R", "y"))).done, undefined);
});

test("flow: attribute carriers draw as steps and rootDefaults.attrEdges is ignored", () => {
  const tree = mk(["R", [["a", [["c", [["x"]], true, "Causes::"]]]]]);
  const els = flowBuild(tree, [], { rootDefaults: { attrEdges: true } });
  assert.ok(get(els, nodeId("R", "c")), "the carrier is a step in flow");
  assert.ok(isEmptyOps(run(els, tree, { layout: "flow", rootDefaults: { attrEdges: true } })));
});

test("flow: bench 200-step flow reconcile stays fast and zero-op", () => {
  const kids = [];
  for (let i = 0; i < 50; i++) {
    kids.push([`d${i}`, [[`y${i}`, [[`y${i}a`], [`y${i}b`]], true, `Yes: go ${i}`], [`n${i}`, [], true, `No: stop ${i}`]], true, `Check ${i}? #lane/L${i % 4}`]);
  }
  const tree = mk(["R", kids, true, "Big"]);
  let t0 = performance.now();
  const els = flowBuild(tree);
  const cold = performance.now() - t0;
  t0 = performance.now();
  const ops = run(els, tree, { layout: "flow" });
  const warm = performance.now() - t0;
  assert.ok(isEmptyOps(ops));
  console.log(`[bench] reconcile flow 251 steps: cold add ${cold.toFixed(2)} ms, warm no-op ${warm.toFixed(2)} ms`);
  assert.ok(warm < 50, `warm ${warm}`);
});
