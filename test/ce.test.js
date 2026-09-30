import assert from "node:assert/strict";
import test from "node:test";

import { CE_MAX_CONNECTIONS, CE_MAX_EDGES, CE_MAX_NODES, chartToElements, parseChart, tintColor } from "../src/model/ce.js";

const counter = () => { let n = 0; return () => `id${++n}`; };
const measure = (s, fs) => s.length * fs * 0.5;
const seq = () => { let n = 0; return () => ((n++ % 16) / 16); };
const run = (chart, opts = {}) => chartToElements(chart, { measure, newId: counter(), random: seq(), ...opts });
const ce = (el) => el.customData?.plexus?.ce;

const CHART = {
  nodes: [
    { id: "e", text: "Pump failed", role: "primary" },
    { id: "c1", text: "Seal: worn out", role: "condition" },
    { id: "c2", text: "No maintenance", role: "action", terminator: "end" },
    { id: "c3", text: "Unknown budget", role: "weird", terminator: "question" },
  ],
  edges: [{ effect: "e", cause: "c1" }, { effect: "e", cause: "c2" }, { effect: "c1", cause: "c3" }],
  connections: [{ from: "c2", to: "c3", label: "" }],
};

test("parseChart accepts a string, drops bad entries and counts them", () => {
  const p = parseChart(JSON.stringify({
    nodes: [{ id: 1, text: "a" }, { id: 1, text: "dup" }, { text: "no id" }, { id: 2, role: "nope" }],
    edges: [{ effect: 1, cause: 2 }, { effect: 1, cause: 9 }, { effect: 1, cause: 1 }],
    connections: [{ from: 1, to: 7 }],
  }));
  assert.deepEqual(p.nodes.map((n) => [n.id, n.role]), [["1", "neutral"], ["2", "neutral"]]);
  assert.equal(p.edges.length, 1);
  assert.equal(p.connections.length, 0);
  assert.equal(p.skipped, 5);
  assert.equal(p.root, "1");
});

test("parseChart picks the first primary as root and refuses bad input", () => {
  assert.equal(parseChart({ nodes: [{ id: "a" }, { id: "b", role: "primary" }] }).root, "b");
  assert.throws(() => parseChart("{nope"), /Invalid JSON/);
  assert.throws(() => parseChart({}), /nodes array/);
  assert.throws(() => parseChart({ nodes: [] }), /nodes array/);
  assert.throws(() => parseChart([]), /object/);
  const many = { nodes: Array.from({ length: CE_MAX_NODES + 1 }, (_, i) => ({ id: i })) };
  assert.throws(() => parseChart(many), /limit is 300/);
  assert.equal(parseChart({ nodes: Array.from({ length: CE_MAX_NODES }, (_, i) => ({ id: i })) }).nodes.length, CE_MAX_NODES);
});

test("tintColor mixes toward white", () => {
  assert.equal(tintColor("#000000"), "#c7c7c7");
  assert.equal(tintColor("#fff"), "#ffffff");
});

test("tree: boxes with bound text, star on the primary, category split, role colours", () => {
  const r = run(CHART);
  assert.match(r.chart, /^ce-[0-9a-f]{8}$/);
  assert.equal(r.skipped, 0);
  const boxes = r.elements.filter((e) => ce(e)?.node);
  assert.equal(boxes.length, 4);
  const byNode = Object.fromEntries(boxes.map((e) => [ce(e).node, e]));
  const textOf = (id) => r.elements.find((e) => e.containerId === id.id);
  assert.equal(textOf(byNode.e).originalText, "★ Pump failed");
  assert.equal(textOf(byNode.c1).originalText, "Seal:\nworn out");
  assert.equal(byNode.e.strokeColor, "#7c5cff");
  assert.equal(byNode.e.backgroundColor, tintColor("#7c5cff"));
  assert.equal(byNode.c3.strokeColor, "#64748b");
  for (const b of boxes) { assert.ok(b.width >= 152); assert.ok(b.height >= 50); assert.equal(ce(b).chart, r.chart); }
});

test("tree: effect to cause arrows are bound both ends and labelled 'caused by'", () => {
  const r = run(CHART);
  const edges = r.elements.filter((e) => ce(e)?.edge);
  assert.deepEqual(edges.map((e) => ce(e).edge), [["e", "c1"], ["e", "c2"], ["c1", "c3"]]);
  const idOf = Object.fromEntries(r.elements.filter((e) => ce(e)?.node).map((e) => [ce(e).node, e.id]));
  for (const a of edges) {
    assert.equal(a.type, "arrow");
    assert.equal(a.strokeColor, "#94a3b8");
    assert.equal(a.startBinding.elementId, idOf[ce(a).edge[0]]);
    assert.equal(a.endBinding.elementId, idOf[ce(a).edge[1]]);
    assert.equal(a.endArrowhead, "arrow");
    const label = r.elements.find((e) => e.containerId === a.id);
    assert.equal(label.text, "caused by");
    assert.equal(a.boundElements[0].id, label.id);
  }
  const eEl = r.elements.find((e) => e.id === idOf.e);
  const c1El = r.elements.find((e) => e.id === idOf.c1);
  assert.ok(c1El.x > eEl.x + eEl.width);
  assert.equal(eEl.boundElements.filter((b) => b.type === "arrow").length, 2);
});

test("connections are dashed orange bound arrows labelled, default 'Connects to'", () => {
  const r = run(CHART);
  const conn = r.elements.find((e) => ce(e)?.conn);
  assert.deepEqual(ce(conn).conn, ["c2", "c3"]);
  assert.equal(conn.strokeStyle, "dashed");
  assert.equal(conn.strokeColor, "#f97316");
  assert.equal(r.elements.find((e) => e.containerId === conn.id).text, "Connects to");
  const custom = run({ ...CHART, connections: [{ from: "c2", to: "c3", label: "shares" }] });
  assert.equal(custom.elements.find((e) => e.containerId === custom.elements.find((e) => ce(e)?.conn).id).text, "shares");
});

test("terminators: end is a plain 22 px ellipse, question holds '?'; none on effect nodes", () => {
  const r = run({ ...CHART, nodes: [{ id: "e", text: "E", role: "primary", terminator: "end" }, { id: "c1", text: "w", terminator: "end" }, { id: "c2", text: "x", terminator: "end" }, { id: "c3", text: "y", terminator: "question" }] });
  const terms = r.elements.filter((e) => ce(e)?.terminator);
  assert.deepEqual(terms.map((e) => ce(e).terminator).sort(), ["c2", "c3"]);
  for (const t of terms) { assert.equal(t.type, "ellipse"); assert.equal(t.width, 22); }
  const q = terms.find((e) => ce(e).terminator === "c3");
  assert.equal(r.elements.find((e) => e.containerId === q.id).text, "?");
  const e = terms.find((t) => ce(t).terminator === "c2");
  assert.equal(r.elements.some((x) => x.containerId === e.id), false);
});

test("shared causes are placed once and cycles terminate", () => {
  const r = run({ nodes: [{ id: "a", role: "primary" }, { id: "b" }, { id: "c" }], edges: [{ effect: "a", cause: "b" }, { effect: "a", cause: "c" }, { effect: "b", cause: "c" }, { effect: "c", cause: "a" }] });
  assert.equal(r.elements.filter((e) => ce(e)?.node).length, 3);
  assert.equal(r.elements.filter((e) => ce(e)?.edge).length, 4);
});

test("a shared cause sits right of every effect that lists it, whatever the edge order", () => {
  const r = run({ nodes: [{ id: "E", role: "primary" }, { id: "B" }, { id: "A" }], edges: [{ effect: "E", cause: "B" }, { effect: "E", cause: "A" }, { effect: "A", cause: "B" }] });
  const n = Object.fromEntries(r.elements.filter((e) => ce(e)?.node).map((e) => [ce(e).node, e]));
  const hit = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  for (const [p, q] of [["E", "A"], ["E", "B"], ["A", "B"]]) assert.equal(hit(n[p], n[q]), false, `${p} ${q}`);
  assert.ok(n.B.x > n.A.x);
  for (const a of r.elements.filter((e) => ce(e)?.edge)) assert.ok(a.width > 0 || a.height > 0);
});

test("edges and connections are capped, and many duplicate edges stay fast", () => {
  const nodes = Array.from({ length: 300 }, (_, i) => ({ id: `n${i}` }));
  const edges = [];
  for (let i = 0; i < 300 && edges.length <= CE_MAX_EDGES; i++) for (let j = 0; j < 300 && edges.length <= CE_MAX_EDGES; j++) if (i !== j) edges.push({ effect: `n${i}`, cause: `n${j}` });
  assert.throws(() => parseChart({ nodes, edges }), /edges/);
  const conns = Array.from({ length: CE_MAX_CONNECTIONS + 1 }, (_, i) => ({ from: `n${i % 299}`, to: `n${(i % 299) + 1}` }));
  assert.throws(() => parseChart({ nodes, connections: conns }), /connections/);
  const dup = Array.from({ length: 30000 }, () => ({ effect: "n0", cause: "n1" }));
  const t0 = Date.now();
  assert.equal(parseChart({ nodes, edges: dup }).edges.length, 1);
  assert.ok(Date.now() - t0 < 500);
});

test("unreachable nodes stack at the left column", () => {
  const r = run({ nodes: [{ id: "a", role: "primary" }, { id: "b" }, { id: "lone" }], edges: [{ effect: "a", cause: "b" }] });
  const n = Object.fromEntries(r.elements.filter((e) => ce(e)?.node).map((e) => [ce(e).node, e]));
  assert.equal(n.lone.x, n.a.x);
  assert.notEqual(n.lone.y, n.a.y);
});

test("origin lands on the centre of the bounding box; layout does not change ids' markers", () => {
  const r = run(CHART, { origin: { x: 1000, y: -500 } });
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const e of r.elements) {
    const xs = e.points ? e.points.map((p) => e.x + p[0]) : [e.x, e.x + e.width];
    const ys = e.points ? e.points.map((p) => e.y + p[1]) : [e.y, e.y + e.height];
    x1 = Math.min(x1, ...xs); x2 = Math.max(x2, ...xs); y1 = Math.min(y1, ...ys); y2 = Math.max(y2, ...ys);
  }
  assert.ok(Math.abs((x1 + x2) / 2 - 1000) < 1e-6);
  assert.ok(Math.abs((y1 + y2) / 2 + 500) < 1e-6);
  assert.equal(new Set(r.ids).size, r.ids.length);
});

test("fishbone: head at the right, unbound spine and bone lines, alternating sides, no effect arrows", () => {
  const r = run(CHART, { layout: "fishbone" });
  const lines = r.elements.filter((e) => ce(e)?.line);
  assert.equal(lines.filter((l) => ce(l).line === "spine").length, 1);
  assert.equal(lines.filter((l) => ce(l).line === "bone").length, 3);
  for (const l of lines) { assert.equal(l.type, "line"); assert.equal(l.startBinding, null); assert.equal(l.endBinding, null); }
  assert.equal(r.elements.filter((e) => ce(e)?.edge).length, 0);
  const n = Object.fromEntries(r.elements.filter((e) => ce(e)?.node).map((e) => [ce(e).node, e]));
  assert.ok(n.e.x > n.c1.x && n.e.x > n.c2.x);
  assert.ok(n.c1.y < n.e.y);
  assert.ok(n.c2.y > n.e.y);
  const spine = lines.find((l) => ce(l).line === "spine");
  assert.ok(spine.strokeWidth === 3);
  assert.ok(r.elements.some((e) => ce(e)?.conn));
});

test("pentagon: head is a transparent bound container grouped with a closed line; spine behind", () => {
  const r = run(CHART, { layout: "pentagon" });
  const head = r.elements.find((e) => ce(e)?.node === "e");
  const pent = r.elements.find((e) => ce(e)?.line === "pentagon");
  assert.equal(head.strokeColor, "transparent");
  assert.equal(head.type, "rectangle");
  assert.equal(pent.type, "line");
  assert.equal(pent.points.length, 6);
  assert.deepEqual(pent.points[0], pent.points[5]);
  assert.equal(pent.groupIds.length, 1);
  assert.deepEqual(pent.groupIds, head.groupIds);
  assert.deepEqual(r.elements.find((e) => e.containerId === head.id).groupIds, head.groupIds);
  assert.ok(r.elements.findIndex((e) => e.id === pent.id) < r.elements.findIndex((e) => e.id === head.id));
  const spine = r.elements.find((e) => ce(e)?.line === "spine");
  assert.ok(r.elements.indexOf(spine) < r.elements.indexOf(pent));
  const arrow = r.elements.find((e) => ce(e)?.edge?.[0] === "e");
  assert.equal(arrow.startBinding.elementId, head.id);
});

test("every element is a v0.18.0 shape: no fixedPoint, index null, unique ids", () => {
  for (const layout of ["tree", "fishbone", "pentagon"]) {
    const r = run(CHART, { layout });
    const json = JSON.stringify(r.elements);
    assert.ok(!json.includes("fixedPoint"));
    assert.ok(r.elements.every((e) => e.index === null));
    assert.equal(new Set(r.ids).size, r.ids.length);
    assert.equal(r.layout, layout);
  }
});

test("chart ids differ per insert and unknown layouts throw", () => {
  const a = chartToElements(CHART, { measure });
  const b = chartToElements(CHART, { measure });
  assert.notEqual(a.chart, b.chart);
  assert.throws(() => chartToElements(CHART, { layout: "spiral" }), /Unknown layout/);
});
