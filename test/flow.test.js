import test from "node:test";
import assert from "node:assert/strict";
import {
  FLOW_LAYOUT, flowParts, isDecision, branchLabel, laneOf, drawnTree, flowEditable, flowControls, flowStructure, flowLayout, flowRoute, flowPlan, chipsOf,
} from "../src/model/flow.js";
import { LAYOUTS, visualTree, visibleNodes } from "../src/model/mindmap.js";

const n = (uid, string, kids = [], open = true) => ({ uid, string, open, children: kids });
const edgesOf = (st) => st.edges.map((e) => `${e.from}>${e.to}:${e.kind}${e.label ? `:${e.label}` : ""}`);
const stepOf = (st, uid) => st.byUid.get(uid);

test("FLOW_LAYOUT is not one of the cycled layouts", () => {
  assert.equal(FLOW_LAYOUT, "flow");
  assert.ok(!LAYOUTS.includes("flow"));
});

test("flowParts: task, branch label, body and tag suffix", () => {
  assert.deepEqual(flowParts("{{[[TODO]]}} Yes: check #CCP1", { branch: true }), { task: "{{[[TODO]]}} ", label: "Yes", body: "check", suffix: " #CCP1" });
  assert.deepEqual(flowParts("Yes: check", { branch: false }), { task: "", label: "", body: "Yes: check", suffix: "" });
  assert.equal(flowParts("Not OK: stop", { branch: true }).label, "Not OK");
  for (const s of ["Lane:: QA", "Owner:: Bob", "http://x.y", "10:30 meeting", "A very long label that is too long: x", "Yes:no space"]) {
    assert.equal(branchLabel(s), "", s);
  }
  const p = flowParts("Fill #hazard #lane/QA #[[CCP 2]]");
  assert.equal(p.body, "Fill");
  assert.equal(p.suffix, " #hazard #lane/QA #[[CCP 2]]");
  assert.equal(p.task + p.label + p.body + p.suffix, "Fill #hazard #lane/QA #[[CCP 2]]");
  assert.equal(flowParts("mid #end tag more").suffix, "", "only a trailing run is the suffix");
  assert.equal(flowParts("x #CCPx").suffix, "", "tag boundary");
  assert.equal(flowParts("#end").body, "");
  // canonical form: the label is still read after a misplaced macro, but the node is markup then
  const odd = flowParts("Yes: {{[[TODO]]}} text", { branch: true });
  assert.equal(odd.task, "");
  assert.equal(odd.label, "Yes");
  assert.equal(odd.body, "{{[[TODO]]}} text");
});

test("isDecision: question mark or #decision in the suffix", () => {
  assert.ok(isDecision("Metal detected?"));
  assert.ok(isDecision("Metal detected? #CCP1"));
  assert.ok(isDecision("Check #decision"));
  assert.ok(isDecision("No: Is it fine?", { branch: true }));
  assert.ok(!isDecision("Why? because"));
  assert.ok(!isDecision("Check"));
  assert.ok(!isDecision("Check #decisions"));
});

test("chipsOf: one CCP chip and one hazard chip from the trailing tags", () => {
  assert.deepEqual(chipsOf("Fill #CCP1 #hazard"), [{ kind: "ccp", text: "CCP 1" }, { kind: "hazard", text: "Hazard" }]);
  assert.deepEqual(chipsOf("Fill #hazard #CCP"), [{ kind: "ccp", text: "CCP" }, { kind: "hazard", text: "Hazard" }]);
  assert.deepEqual(chipsOf("Fill #[[CCP 3]]"), [{ kind: "ccp", text: "CCP 3" }]);
  assert.deepEqual(chipsOf("Fill #[[hazard]]"), [{ kind: "hazard", text: "Hazard" }]);
  assert.deepEqual(chipsOf("Fill"), []);
});

test("laneOf: Lane:: child wins over an inline tag, first inline tag counts, raw children even when folded", () => {
  assert.equal(laneOf(n("a", "Step #lane/QA")), "QA");
  assert.equal(laneOf(n("a", "Step #[[lane/Quality Lab]]")), "Quality Lab");
  assert.equal(laneOf(n("a", "Step #lane/A #lane/B")), "A");
  assert.equal(laneOf(n("a", "Step #lane/QA", [n("l", "Lane:: [[Warehouse]]")])), "Warehouse");
  assert.equal(laneOf(n("a", "Step", [n("l", "Lane::  Big   Room ")])), "Big Room");
  assert.equal(laneOf(n("a", "Step", [n("l", "Lane::")])), null);
  assert.equal(laneOf(n("a", "Step", [n("k", "kid"), n("l", "Lane:: QA")], false)), "QA", "folded node keeps its lane");
  assert.equal(laneOf(n("a", "Step")), null);
});

test("flowControls: refs qualify only with no drawable children and a target step of the flow", () => {
  const tree = n("R", "Root", [
    n("a", "A", [n("r1", "((b))"), n("r2", "((a))"), n("r3", "((zz))"), n("r4", "((b))", [n("k", "kid")]), n("r5", "((l))"), n("r6", "((r1))")]),
    n("b", "B", [n("r7", "((R))")]),
    n("l", "Lane:: X"),
    n("r8", "((b))"),
  ]);
  const { controls, refs } = flowControls(tree);
  assert.deepEqual([...refs.keys()].sort(), ["r1", "r7", "r8"], "r2 targets its parent, r3 unknown, r4 has a child, r5 targets a control, r6 targets a ref");
  assert.ok(!controls.has("r2") && !controls.has("r6"));
  assert.ok(controls.has("l") && controls.has("r1") && controls.has("r7"));
  assert.ok(!controls.has("r2") && !controls.has("r4"));
  assert.deepEqual(refs.get("r7"), { uid: "r7", parent: "b", target: "R" }, "a loop back to the root qualifies");
});

test("drawnTree: flow drops control blocks, other layouts are exactly visualTree", () => {
  const tree = n("R", "Root", [n("a", "A", [n("l", "Lane:: QA"), n("x", "X"), n("r", "((b))")]), n("b", "B")]);
  const snap = JSON.stringify(tree);
  const d = drawnTree(tree, { layout: "flow", attrEdges: true });
  assert.equal(JSON.stringify(tree), snap);
  assert.deepEqual(visibleNodes(d).map((v) => v.node.uid), ["R", "a", "x", "b"]);
  assert.equal(drawnTree(tree, { layout: "right" }), tree);
  assert.deepEqual(drawnTree(tree, { layout: "right", attrEdges: true }), visualTree(tree, { attrEdges: true }));
  assert.equal(drawnTree(null, { layout: "flow" }), null);
});

test("structure: main sequence, depth-first continuation, primary predecessor and ranks", () => {
  const tree = n("R", "Start", [n("a", "A", [n("a1", "a1"), n("a2", "a2")]), n("b", "B"), n("c", "C")]);
  const st = flowStructure(tree);
  assert.deepEqual(st.steps.map((s) => s.uid), ["R", "a", "a1", "a2", "b", "c"]);
  assert.deepEqual(edgesOf(st), ["R>a:seq", "a>a1:seq", "a1>a2:seq", "a2>b:seq", "b>c:seq"]);
  assert.deepEqual(st.steps.map((s) => s.rank), [0, 1, 2, 3, 4, 5]);
  assert.equal(stepOf(st, "b").pred, "a2");
  assert.equal(stepOf(st, "R").type, "root");
  assert.deepEqual(st.lanes, [""]);
  assert.equal(st.hasLanes, false);
});

test("structure: decision branches, labels, no direct arrow, merge to the next step, rank = largest tail + 1", () => {
  const tree = n("R", "Start", [
    n("d", "Ok?", [n("y", "Yes: go", [n("y1", "y1"), n("y2", "y2")]), n("no", "No: stop")]),
    n("z", "Z"),
  ]);
  const st = flowStructure(tree);
  assert.deepEqual(edgesOf(st), ["R>d:seq", "d>y:branch:Yes", "y>y1:seq", "y1>y2:seq", "d>no:branch:No", "y2>z:merge", "no>z:merge"]);
  assert.equal(stepOf(st, "d").type, "decision");
  assert.equal(stepOf(st, "y").branchHead, true);
  assert.equal(stepOf(st, "y").label, "Yes");
  assert.equal(stepOf(st, "z").pred, null, "a merge target has no primary predecessor");
  assert.equal(stepOf(st, "y2").rank, 4);
  assert.equal(stepOf(st, "z").rank, 5);
  assert.equal(stepOf(st, "no").rank, 2);
});

test("structure: nested decisions merge outward; #end and refs stop the merge; top level draws nothing", () => {
  const tree = n("R", "Start", [
    n("d1", "A?", [
      n("p", "P", [n("d2", "B?", [n("q", "Q"), n("s", "S #end")])]),
      n("t", "T", [n("u", "U"), n("rf", "((d1))")]),
    ]),
    n("last", "Last"),
  ]);
  const st = flowStructure(tree);
  const ed = edgesOf(st);
  assert.ok(ed.includes("q>last:merge"), "inner tail merges past the outer decision");
  assert.ok(!ed.some((e) => e.startsWith("s>")), "#end has no outgoing arrow");
  assert.ok(ed.includes("u>last:merge"), "u is the tail of t's continuation");
  assert.deepEqual(st.edges.filter((e) => e.kind === "loop").map((e) => `${e.from}>${e.to}:${e.via}`), ["t>d1:rf"]);
  const top = flowStructure(n("R", "Start", [n("d", "X?", [n("y", "y"), n("no", "no")])]));
  assert.deepEqual(edgesOf(top), ["R>d:seq", "d>y:branch", "d>no:branch"]);
});

test("structure: a branch that ends in a ref has no merge, and the ref arrow is a loop from its parent", () => {
  const tree = n("R", "Start", [
    n("a", "A"),
    n("d", "Retry?", [n("y", "Yes: again", [n("rf", "((a))")]), n("no", "No: go on")]),
    n("z", "Z"),
  ]);
  const st = flowStructure(tree);
  assert.deepEqual(edgesOf(st).filter((e) => /:(merge|loop)$/.test(e)), ["no>z:merge", "y>a:loop"]);
  assert.equal(st.edges.find((e) => e.kind === "loop").via, "rf");
  assert.equal(stepOf(st, "rf"), undefined, "a ref block is not a step");
});

test("structure: #end on a plain step stops sequence and merge arrows", () => {
  const st = flowStructure(n("R", "Start", [n("a", "A #end"), n("b", "B")]));
  assert.deepEqual(edgesOf(st), ["R>a:seq"]);
  assert.equal(stepOf(st, "a").type, "end");
  assert.equal(stepOf(st, "b").rank, 2, "b has nothing arriving and follows its previous step");
});

test("structure: a decision whose branches are folded or empty behaves as a plain step", () => {
  const st = flowStructure(n("R", "Start", [n("d", "Ok?", [n("y", "y")], false), n("e", "Empty?"), n("z", "Z")]));
  assert.deepEqual(edgesOf(st), ["R>d:seq", "d>e:seq", "e>z:seq"]);
  assert.equal(stepOf(st, "d").type, "decision");
  assert.equal(stepOf(st, "y"), undefined);
});

test("structure: a loop to a step hidden by a fold points at the nearest drawn ancestor", () => {
  const tree = n("R", "Start", [
    n("a", "A", [n("a1", "a1")], false),
    n("b", "B", [n("rf", "((a1))")]),
  ]);
  const st = flowStructure(tree);
  assert.deepEqual(st.edges.filter((e) => e.kind === "loop").map((e) => `${e.from}>${e.to}`), ["b>a"]);
  const folded = flowStructure(n("R", "Start", [n("a", "A"), n("b", "B", [n("rf", "((a))")], false)]));
  assert.equal(folded.edges.filter((e) => e.kind === "loop").length, 0, "a folded parent hides its ref");
});

test("structure: lanes inherit from the primary predecessor; columns by first appearance, lane '' first", () => {
  const tree = n("R", "Start", [
    n("a", "Receive", [n("l", "Lane:: Warehouse")]),
    n("b", "Store"),
    n("c", "Test #lane/QA"),
    n("d", "Pack #lane/Warehouse"),
    n("e", "Ship"),
  ]);
  const st = flowStructure(tree);
  assert.deepEqual(st.steps.map((s) => s.lane), ["", "Warehouse", "Warehouse", "QA", "Warehouse", "Warehouse"]);
  assert.deepEqual(st.lanes, ["", "Warehouse", "QA"]);
  assert.equal(st.hasLanes, true);
  const merge = flowStructure(n("R", "S", [n("a", "A", [n("l", "Lane:: X")]), n("d", "Q? #lane/Y", [n("y", "y"), n("no", "no")]), n("z", "Z")]));
  assert.equal(stepOf(merge, "z").lane, "Y", "a merge target inherits the lane of the decision before it");
  const folded = flowStructure(n("R", "S", [n("a", "A", [n("k", "kid"), n("l", "Lane:: X")], false), n("b", "B")]));
  assert.equal(stepOf(folded, "a").lane, "X");
  assert.equal(stepOf(folded, "b").lane, "X", "a folded step does not fall back to its parent's lane");
});

test("layout: lanes are columns, equal-height frames enclose members and chips, root keeps the anchor", () => {
  const tree = n("R", "Start", [
    n("a", "Receive #lane/W #CCP1"),
    n("d", "Ok? #lane/Q", [n("y", "Yes: ship"), n("no", "No: hold")]),
  ]);
  const sizes = { R: { width: 60, height: 40 }, a: { width: 100, height: 40 }, d: { width: 120, height: 80 }, y: { width: 80, height: 40 }, no: { width: 80, height: 40 } };
  const st = flowStructure(tree);
  const lay = flowLayout(st, { sizes, chipSize: () => ({ width: 40, height: 20 }), labelWidth: (u) => (u === "y" || u === "no" ? 30 : 0), anchor: { x: 500, y: 300 } });
  assert.deepEqual(lay.positions.R, { x: 500, y: 300 });
  assert.deepEqual(lay.frames.map((f) => f.name), ["W", "Q"]);
  assert.equal(lay.frames[0].height, lay.frames[1].height);
  assert.ok(lay.frames[0].x < lay.frames[1].x && lay.frames[0].x > lay.positions.R.x, "lane 1 sits right of the root's column");
  for (const s of st.steps) {
    const f = lay.frames.find((fr) => fr.name === s.lane);
    if (!f) continue;
    const p = lay.positions[s.uid];
    assert.ok(p.x >= f.x && p.x + sizes[s.uid].width <= f.x + f.width, `${s.uid} inside its lane`);
    assert.ok(p.y >= f.y && p.y + sizes[s.uid].height <= f.y + f.height);
  }
  const chip = lay.chips.get("a")[0];
  const fa = lay.frames[0];
  assert.ok(chip.x >= fa.x && chip.x + chip.width <= fa.x + fa.width, "chip inside the frame");
  assert.ok(chip.y >= fa.y);
  // yes/no sit side by side in one cell, at least label width + 24 apart
  const y = lay.positions.y;
  const no = lay.positions.no;
  assert.equal(y.y, no.y);
  assert.ok(no.x - (y.x + 80) >= 54);
  const rows = [lay.positions.R.y, lay.positions.a.y, lay.positions.d.y, lay.positions.y.y];
  assert.deepEqual([...rows].sort((p, q) => p - q), rows, "rows follow rank, top to bottom");
});

test("layout: without lanes there are no frames", () => {
  const st = flowStructure(n("R", "S", [n("a", "A"), n("b", "B")]));
  const lay = flowLayout(st, { sizes: { R: { width: 50, height: 30 }, a: { width: 50, height: 30 }, b: { width: 50, height: 30 } } });
  assert.deepEqual(lay.frames, []);
  assert.ok(lay.positions.a.y > lay.positions.R.y && lay.positions.b.y > lay.positions.a.y);
});

test("flowRoute: same-lane edges run bottom to top, others are clipped by the outline plus the gap", () => {
  const a = { x: 0, y: 0, width: 100, height: 40, type: "rectangle" };
  const b = { x: 0, y: 100, width: 100, height: 40, type: "rectangle" };
  const adj = flowRoute(a, b, true, 4);
  assert.deepEqual([adj.x, adj.y, adj.points[1]], [50, 40, [0, 60]]);
  const side = flowRoute(a, { x: 300, y: 0, width: 100, height: 40, type: "rectangle" }, false, 4);
  assert.deepEqual([side.x, side.y, side.points[1]], [104, 20, [192, 0]]);
  const dia = flowRoute({ x: 0, y: 0, width: 100, height: 100, type: "diamond" }, { x: 300, y: 0, width: 100, height: 100, type: "ellipse" }, false, 0);
  assert.equal(dia.x, 100);
  assert.equal(dia.x + dia.points[1][0], 300);
});

test("flowEditable: label and suffix survive, markup and fold suffix rules", () => {
  const node = n("y", "{{[[TODO]]}} Yes: check #CCP1");
  assert.equal(flowEditable(node, "☐ check twice", { branch: true }), "{{[[TODO]]}} Yes: check twice #CCP1");
  assert.equal(flowEditable(node, "☐ check", { branch: true }), null, "unchanged");
  assert.equal(flowEditable(n("s", "Fill #lane/QA #CCP1"), "Fill more"), "Fill more #lane/QA #CCP1", "suffix tags never make a step read-only");
  assert.equal(flowEditable(n("s", "Fill [[Page]]"), "Fill more"), null, "markup in the body");
  assert.equal(flowEditable(n("s", "Yes: {{[[TODO]]}} x"), "x y", { branch: true }), null);
  assert.equal(flowEditable(n("s", "Fill"), "·"), null);
  const dn = (root, uid) => { const f = (x) => (x.uid === uid ? x : x.children.map(f).find(Boolean)); return f(drawnTree(root, { layout: FLOW_LAYOUT })); };
  const foldedRoot = n("R", "R", [n("f", "Fold", [n("k1", "k1", [n("k2", "k2")]), n("l", "Lane:: X"), n("r", "((f))")], false)]);
  assert.equal(flowEditable(dn(foldedRoot, "f"), "Fold (+4)"), null, "raw count would include the Lane block: the drawn count is 3");
  assert.equal(flowEditable(dn(foldedRoot, "f"), "Fold two (+3)"), "Fold two");
  const lane = n("R", "R", [n("f", "Fold", [n("l", "Lane:: X")], false)]);
  assert.equal(flowEditable(dn(lane, "f"), "Fold two"), "Fold two", "control children alone do not fold");
  const unres = n("R", "R", [n("w", "Weighing", [n("z", "((zzzzzzzzz))")], false)]);
  assert.equal(flowEditable(dn(unres, "w"), "Weighing2 (+1)"), "Weighing2", "unqualified ref child counts like planMap");
  const mixed = n("R", "R", [n("m", "Mixer", [n("z", "((zzzzzzzzz))"), n("c", "child")], false)]);
  assert.equal(flowEditable(dn(mixed, "m"), "Mixer2 (+2)"), "Mixer2");
});

test("structure: #end on a decision-looking step without branches stops seq and merge arrows", () => {
  const st = flowStructure(n("R", "Start", [n("a", "Anything else? #end"), n("b", "B")]));
  assert.ok(!edgesOf(st).some((e) => e.startsWith("a>")), edgesOf(st).join());
  assert.equal(stepOf(st, "a").type, "decision");
  const f = flowStructure(n("R", "Start", [n("a", "Anything else? #end", [n("k", "K")], false), n("b", "B")]));
  assert.ok(!edgesOf(f).some((e) => e.startsWith("a>")), edgesOf(f).join());
});

test("flowPlan: contract shape", () => {
  const tree = n("R", "S", [n("a", "A #lane/W")]);
  const p = flowPlan(tree, { sizes: { R: { width: 10, height: 10 }, a: { width: 10, height: 10 } } });
  assert.deepEqual(Object.keys(p).sort(), ["chips", "edges", "frames", "lanes", "positions", "steps"]);
  assert.deepEqual(p.lanes, ["", "W"]);
  assert.equal(flowPlan(tree).steps.length, 2);
});
