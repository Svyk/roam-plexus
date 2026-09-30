import assert from "node:assert/strict";
import test from "node:test";

import { arrowLabelRect, arrowLabelWrapWidth } from "../src/model/arrowlabel.js";
import { createBuilder, DEFAULT_STYLE } from "../src/model/build.js";

const counter = () => { let n = 0; return () => `id${++n}`; };
const measure = (s, fs) => s.length * fs * 0.5;
const mk = (extra = {}) => createBuilder({ measure, newId: counter(), ...extra });
const byId = (els) => new Map(els.map((e) => [e.id, e]));

test("arrowLabelRect is the midpoint of the end points minus half the text", () => {
  assert.deepEqual(arrowLabelRect({ x: 100, y: 50, points: [[0, 0], [200, 100]] }, 40, 20), { x: 180, y: 90 });
  assert.deepEqual(arrowLabelRect({ x: 0, y: 0, points: [[0, 0], [10, 10], [40, -20]] }, 10, 10), { x: 15, y: -15 });
});

test("arrowLabelWrapWidth is max(0.7 x arrow width, 11 x font size)", () => {
  assert.equal(arrowLabelWrapWidth(100, 16), 176);
  assert.equal(arrowLabelWrapWidth(1000, 16), 700);
});

test("style defaults and patching", () => {
  const b = mk();
  assert.deepEqual(b.style(), DEFAULT_STYLE);
  assert.equal(b.style({ strokeColor: "#f00", bogus: 1 }).strokeColor, "#f00");
  const id = b.rect(0, 0, 10, 10);
  const el = b.elements()[0];
  assert.equal(el.id, id);
  assert.equal(el.strokeColor, "#f00");
  assert.equal(el.strokeWidth, 2);
  assert.equal(el.roughness, 1);
  assert.equal(el.backgroundColor, "transparent");
  assert.equal(el.index, null);
  assert.deepEqual(el.roundness, { type: 3 });
  assert.equal(el.boundElements, null);
});

test("shapes: roundness per type, text fields, no baseline", () => {
  const b = mk();
  const r = b.rect(0, 0, 10, 10);
  const e = b.ellipse(0, 0, 10, 10);
  const d = b.diamond(0, 0, 10, 10);
  const t = b.text(5, 6, "hi\nthere");
  const m = byId(b.elements());
  assert.deepEqual(m.get(r).roundness, { type: 3 });
  assert.equal(m.get(e).roundness, null);
  assert.deepEqual(m.get(d).roundness, { type: 2 });
  const text = m.get(t);
  assert.equal(text.text, "hi\nthere");
  assert.equal(text.originalText, "hi\nthere");
  assert.equal(text.containerId, null);
  assert.equal(text.autoResize, true);
  assert.equal(text.lineHeight, 1.25);
  assert.equal(text.fontFamily, 5);
  assert.equal(text.fontSize, 20);
  assert.equal(text.height, 2 * 20 * 1.25);
  assert.equal(text.width, "there".length * 20 * 0.5);
  assert.ok(!("baseline" in text));
});

test("non-Excalifont families are estimated at 0.6 x fontSize per character", () => {
  const b = mk();
  const t = b.text(0, 0, "abcd", { fontFamily: 2, fontSize: 10 });
  assert.equal(b.elements().find((e) => e.id === t).width, 24);
});

test("box holds one bound text centred in its container", () => {
  const b = mk();
  const id = b.box("Hello", { x: 100, y: 200 });
  const els = b.elements();
  const c = els.find((e) => e.id === id);
  const t = els.find((e) => e.containerId === id);
  assert.deepEqual(c.boundElements, [{ id: t.id, type: "text" }]);
  assert.equal(t.textAlign, "center");
  assert.equal(t.verticalAlign, "middle");
  assert.equal(t.x + t.width / 2, c.x + c.width / 2);
  assert.equal(t.y + t.height / 2, c.y + c.height / 2);
  assert.equal(els.indexOf(c) + 1, els.indexOf(t));
});

test("box with an explicit width wraps to width minus padding", () => {
  const b = mk();
  const id = b.box("aaaa bbbb cccc dddd", { width: 90, fontSize: 10 });
  const els = b.elements();
  const t = els.find((e) => e.containerId === id);
  assert.ok(t.text.includes("\n"));
  assert.ok(t.width <= 80);
});

test("arrow binds both ends with PointBinding, updates boundElements and never emits fixedPoint", () => {
  const b = mk();
  const a = b.rect(0, 0, 100, 50);
  const c = b.rect(300, 0, 100, 50);
  const ar = b.arrow(a, c);
  const els = b.elements();
  const m = byId(els);
  const arrow = m.get(ar);
  assert.deepEqual(arrow.startBinding, { elementId: a, focus: 0, gap: 4 });
  assert.deepEqual(arrow.endBinding, { elementId: c, focus: 0, gap: 4 });
  assert.equal(arrow.endArrowhead, "arrow");
  assert.equal(arrow.startArrowhead, null);
  assert.equal(arrow.elbowed, false);
  assert.equal(arrow.roundness, null);
  assert.equal(arrow.lastCommittedPoint, null);
  assert.deepEqual(m.get(a).boundElements, [{ id: ar, type: "arrow" }]);
  assert.deepEqual(m.get(c).boundElements, [{ id: ar, type: "arrow" }]);
  const json = JSON.stringify(els);
  assert.ok(!json.includes("fixedPoint"));
  assert.ok(!json.includes('"mode"'));
  assert.ok(!json.includes("polygon"));
  // clipped to the boxes plus the 4 px gap
  assert.equal(arrow.x, 100 + 4);
  assert.equal(arrow.y, 25);
  assert.deepEqual(arrow.points, [[0, 0], [300 - 4 - 104, 0]]);
  assert.equal(arrow.width, 192);
  assert.equal(arrow.height, 0);
});

test("arrow endpoints follow the final positions after layout", () => {
  const b = mk();
  const a = b.rect(0, 0, 100, 50);
  const c = b.rect(0, 0, 100, 50);
  b.arrow(a, c);
  b.place(c, 0, 300);
  const arrow = b.elements().find((e) => e.type === "arrow");
  assert.equal(arrow.x, 50);
  assert.equal(arrow.y, 54);
  assert.deepEqual(arrow.points, [[0, 0], [0, 300 - 4 - 54]]);
});

test("arrow label is bound text placed with arrowLabelRect, font 16 family 5", () => {
  const b = mk();
  const a = b.rect(0, 0, 100, 50);
  const c = b.rect(400, 100, 100, 50);
  const ar = b.arrow(a, c, { label: "why" });
  const els = b.elements();
  const arrow = els.find((e) => e.id === ar);
  const t = els.find((e) => e.containerId === ar);
  assert.deepEqual(arrow.boundElements, [{ id: t.id, type: "text" }]);
  assert.equal(t.fontSize, 16);
  assert.equal(t.fontFamily, 5);
  assert.equal(t.textAlign, "center");
  assert.equal(t.text, "why");
  const want = arrowLabelRect(arrow, t.width, t.height);
  assert.equal(t.x, want.x);
  assert.equal(t.y, want.y);
});

test("arrow to bound text resolves to the container; unknown, arrows, frames and self throw", () => {
  const b = mk();
  const box = b.box("A");
  const other = b.rect(0, 0, 10, 10);
  const label = b.elements().find((e) => e.containerId === box).id;
  const ar = b.arrow(label, other);
  assert.equal(b.elements().find((e) => e.id === ar).startBinding.elementId, box);
  assert.throws(() => b.arrow("nope", other), /Unknown element nope/);
  assert.throws(() => b.arrow(ar, other), /Cannot bind an arrow to arrow/);
  assert.throws(() => b.arrow(other, other), /one element/);
  const f = b.frame(0, 0, 10, 10);
  assert.throws(() => b.arrow(f, other), /Cannot bind an arrow to frame/);
});

test("line has null bindings and arrowheads and no elbowed field", () => {
  const b = mk();
  const l = b.line(10, 20, [[0, 0], [30, 40]]);
  const el = b.elements()[0];
  assert.equal(el.id, l);
  assert.equal(el.startBinding, null);
  assert.equal(el.endArrowhead, null);
  assert.equal(el.width, 30);
  assert.equal(el.height, 40);
  assert.ok(!("elbowed" in el));
  assert.throws(() => b.line(0, 0, [[0, 0]]), /at least two/);
});

test("frame children carry frameId and come before the frame", () => {
  const b = mk();
  const box = b.box("A");
  const free = b.rect(0, 0, 5, 5);
  const f = b.frame(-10, -10, 200, 200, { name: "F", children: [box] });
  const els = b.elements();
  const ids = els.map((e) => e.id);
  const t = els.find((e) => e.containerId === box);
  assert.equal(els.find((e) => e.id === box).frameId, f);
  assert.equal(t.frameId, f);
  assert.equal(els.find((e) => e.id === free).frameId, null);
  assert.ok(ids.indexOf(f) > ids.indexOf(t.id));
  assert.equal(els.find((e) => e.id === f).name, "F");
  assert.throws(() => b.frame(0, 0, 1, 1, { children: ["missing"] }), /Unknown element/);
});

test("layout row and column align centres with gap 40", () => {
  const b = mk();
  const a = b.rect(10, 20, 100, 50);
  const c = b.rect(0, 0, 60, 100);
  b.layout([a, c], "row");
  let m = byId(b.elements());
  assert.equal(m.get(a).x, 0);
  assert.equal(m.get(c).x, 140);
  assert.equal(m.get(a).y + 25, m.get(c).y + 50);
  b.layout([a, c], "column");
  m = byId(b.elements());
  assert.equal(m.get(c).y - (m.get(a).y + 50), 40);
  assert.equal(m.get(a).x + 50, m.get(c).x + 30);
});

test("layout grid uses ceil(sqrt(n)) columns of equal cells", () => {
  const b = mk();
  const ids = [0, 1, 2, 3, 4].map(() => b.rect(0, 0, 100, 50));
  b.layout(ids, "grid");
  const m = byId(b.elements());
  assert.equal(m.get(ids[0]).x, 0);
  assert.equal(m.get(ids[1]).x, 140);
  assert.equal(m.get(ids[2]).x, 280);
  assert.equal(m.get(ids[3]).x, 0);
  assert.equal(m.get(ids[3]).y, 90);
});

test("layout tree puts roots at the left, children to the right, several roots stacked", () => {
  const b = mk();
  const r = b.rect(0, 0, 100, 50);
  const k1 = b.rect(0, 0, 100, 50);
  const k2 = b.rect(0, 0, 100, 50);
  const r2 = b.rect(0, 0, 100, 50);
  b.arrow(r, k1);
  b.arrow(r, k2);
  b.layout([r, k1, k2, r2], "tree");
  const m = byId(b.elements());
  assert.ok(m.get(k1).x > m.get(r).x + 100);
  assert.equal(m.get(k1).x, m.get(k2).x);
  assert.ok(m.get(k2).y > m.get(k1).y);
  assert.equal(m.get(r2).x, m.get(r).x);
  assert.ok(m.get(r2).y > Math.max(m.get(k2).y + 50, m.get(r).y + 50));
});

test("layout refuses foreign ids and unknown kinds and leaves other elements alone", () => {
  const b = mk();
  const a = b.rect(5, 5, 10, 10);
  const c = b.rect(50, 50, 10, 10);
  assert.throws(() => b.layout([a, "x"], "row"), /Unknown element x/);
  assert.throws(() => b.layout([a], "spiral"), /Unknown layout/);
  b.layout([a], "row");
  const m = byId(b.elements());
  assert.equal(m.get(c).x, 50);
});

test("seal blocks further changes; elements() is a clone", () => {
  const b = mk();
  const a = b.rect(0, 0, 10, 10);
  b.elements()[0].x = 999;
  assert.equal(b.elements()[0].x, 0);
  b.seal();
  assert.equal(b.sealed, true);
  assert.throws(() => b.rect(0, 0, 1, 1), /Already committed/);
  assert.throws(() => b.layout([a], "row"), /Already committed/);
  assert.deepEqual(b.ids(), [a]);
});

test("a duplicate id from newId throws", () => {
  const b = createBuilder({ newId: () => "same" });
  b.rect(0, 0, 1, 1);
  assert.throws(() => b.rect(0, 0, 1, 1), /Duplicate id same/);
});
