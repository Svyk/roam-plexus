import test from "node:test";
import assert from "node:assert/strict";
import { FRAME_PRESETS, framesIn, presetFrame, nextSlideSlot, layoutFrames, planOrders, applyOrderRewrite, reformatRect, childrenOutside, selectedFrameOf, frameAt, nearestFrame } from "../src/model/frames.js";
import { isId } from "../src/model/region.js";
import { orderFrames } from "../src/model/slides.js";

const fr = (id, x, y, order, extra = {}) => ({ id, type: "frame", x, y, width: 100, height: 50, angle: 0, isDeleted: false, version: 1, name: null, customData: order == null ? undefined : { plexus: { order } }, ...extra });

test("framesIn follows orderFrames: 1 Intro, 2 Middle, 3 Details, 5 Frame A, 6 Slide, 10 End", () => {
  const els = [
    fr("end", 0, 40, 10, { name: "End" }),
    fr("slide", 0, 50, 6, { name: "Slide" }),
    { id: "region", type: "rectangle", name: "Region", x: 0, y: 0, customData: { plexus: { order: 0 } } },
    { kind: "frame", frameId: "intro", caption: "Region" },
    fr("intro", 0, 0, 1, { name: "Intro" }),
    fr("frame-a", 0, 30, 5, { name: "Frame A" }),
    fr("gone", 0, 0, 4, { name: "Gone", isDeleted: true }),
    fr("details", 0, 20, 3, { name: "Details" }),
    fr("middle", 0, 10, 2, { name: "Middle" }),
  ];
  assert.deepEqual(framesIn(els), [
    { elementId: "intro", name: "Intro", order: 1 },
    { elementId: "middle", name: "Middle", order: 2 },
    { elementId: "details", name: "Details", order: 3 },
    { elementId: "frame-a", name: "Frame A", order: 5 },
    { elementId: "slide", name: "Slide", order: 6 },
    { elementId: "end", name: "End", order: 10 },
  ]);
});

test("framesIn: empty input is [], non-finite order stays null, empty name stays empty", () => {
  assert.deepEqual(framesIn([]), []);
  assert.deepEqual(framesIn(null), []);
  assert.deepEqual(framesIn(undefined), []);
  const blank = fr("blank", 0, 0, null, { name: "" });
  const missing = fr("missing", 0, 1, 0);
  const nan = fr("nan", 0, 2, Number.NaN, { name: "Nan" });
  const inf = fr("inf", 0, 3, Number.POSITIVE_INFINITY, { name: "Inf" });
  const text = fr("text", 0, 4, null, { name: "Text", customData: { plexus: { order: "6" } } });
  assert.deepEqual(framesIn([text, inf, nan, blank, missing]), [
    { elementId: "missing", name: "", order: 0 },
    { elementId: "blank", name: "", order: null },
    { elementId: "inf", name: "Inf", order: null },
    { elementId: "nan", name: "Nan", order: null },
    { elementId: "text", name: "Text", order: null },
  ]);
});

test("six presets, complete frame elements with valid ids", () => {
  assert.equal(Object.keys(FRAME_PRESETS).length, 6);
  const f = presetFrame({ preset: "16:9", x: 5, y: 6, order: 3 });
  assert.equal(f.type, "frame");
  assert.equal(f.width, 854);
  assert.equal(f.height, 480);
  assert.ok(isId(f.id) && f.id.startsWith("plexus-frame-"));
  assert.equal(f.name, null);
  assert.equal(f.frameId, null);
  assert.equal(f.index, null);
  assert.equal(f.boundElements, null);
  assert.equal(f.link, null);
  assert.equal(f.locked, false);
  assert.equal(f.roundness, null);
  assert.equal(f.version, 1);
  assert.deepEqual(f.customData, { plexus: { order: 3 } });
  assert.equal(presetFrame({ preset: "nope" }), null);
  assert.notEqual(presetFrame().id, presetFrame().id);
});

test("nextSlideSlot sits right of the rightmost live frame", () => {
  assert.equal(nextSlideSlot([]), null);
  const els = [fr("a", 0, 10), fr("b", 300, 20), fr("c", 900, 30, null, { isDeleted: true })];
  assert.deepEqual(nextSlideSlot(els), { x: 440, y: 20 });
});

test("layoutFrames: 2x2 grid and strip are centred, row-major", () => {
  const g = layoutFrames({ kind: "grid", preset: "16:9", centre: { x: 0, y: 0 } });
  assert.equal(g.length, 4);
  assert.equal(g[0].x, -(854 + 20));
  assert.equal(g[1].x, 20);
  assert.equal(g[2].y, g[0].y + 480 + 40);
  const s = layoutFrames({ kind: "strip", preset: "1:1", centre: { x: 100, y: 100 } });
  assert.equal(s.length, 4);
  assert.ok(new Set(s.map((r) => r.y)).size === 1);
  assert.equal((s[0].x + s[3].x + 800) / 2, 100);
  assert.deepEqual(layoutFrames({ kind: "bad" }), []);
});

test("planOrders rewrites 1..n in orderFrames order when some frame has none", () => {
  const els = [fr("b", 0, 0, null, { name: "B" }), fr("a", 0, 0, 1, { name: "A" }), fr("c", 0, 0, null, { name: "C" })];
  const plan = planOrders(els, 2);
  assert.deepEqual([...plan.rewrite], [["a", 1], ["b", 2], ["c", 3]]);
  assert.deepEqual(plan.orders, [4, 5]);
  const out = applyOrderRewrite(els, plan.rewrite);
  assert.equal(out[0].version, 2);
  assert.equal(out[1], els[1]);
  assert.deepEqual(orderFrames(out).map((f) => f.id), ["a", "b", "c"]);
  const all = planOrders([fr("a", 0, 0, 1), fr("b", 0, 0, 7)], 1);
  assert.equal(all.rewrite.size, 0);
  assert.deepEqual(all.orders, [8]);
  assert.deepEqual(planOrders([], 2).orders, [1, 2]);
});

test("reformatRect resizes about the centre; childrenOutside finds released children", () => {
  const f = { id: "f", type: "frame", x: 0, y: 0, width: 200, height: 200 };
  const r = reformatRect(f, "16:9");
  assert.deepEqual(r, { x: 100 - 427, y: 100 - 240, width: 854, height: 480 });
  const inside = { id: "i", type: "rectangle", x: 10, y: 10, width: 10, height: 10, frameId: "f", isDeleted: false };
  const out = { id: "o", type: "rectangle", x: 5000, y: 5000, width: 10, height: 10, frameId: "f", isDeleted: false };
  const other = { id: "z", type: "rectangle", x: 5000, y: 5000, width: 10, height: 10, frameId: "g", isDeleted: false };
  assert.deepEqual(childrenOutside([f, inside, out, other], f, r).map((e) => e.id), ["o"]);
});

test("selectedFrameOf", () => {
  const f = fr("f", 0, 0, 1);
  const a = { id: "a", type: "rectangle", frameId: "f", isDeleted: false };
  const b = { id: "b", type: "rectangle", frameId: "f", isDeleted: false };
  const c = { id: "c", type: "rectangle", frameId: null, isDeleted: false };
  const els = [f, a, b, c];
  assert.equal(selectedFrameOf(els, ["f"]), "f");
  assert.equal(selectedFrameOf(els, ["a", "b"]), "f");
  assert.equal(selectedFrameOf(els, ["f", "a", "b"]), "f");
  assert.equal(selectedFrameOf(els, ["f", "c"]), null);
  assert.equal(selectedFrameOf(els, ["a", "c"]), null);
  assert.equal(selectedFrameOf(els, ["c"]), null);
  assert.equal(selectedFrameOf(els, []), null);
});

test("frameAt prefers the smallest containing frame; nearestFrame breaks ties by area", () => {
  const big = { id: "big", x: 0, y: 0, width: 1000, height: 1000 };
  const small = { id: "small", x: 10, y: 10, width: 100, height: 100 };
  assert.equal(frameAt([big, small], { x: 50, y: 50 }).id, "small");
  assert.equal(frameAt([big, small], { x: 500, y: 500 }).id, "big");
  assert.equal(frameAt([small], { x: 500, y: 500 }), null);
  assert.equal(nearestFrame([big, small], { x: 50, y: 50 }).id, "small");
  const far = { id: "far", x: 2000, y: 0, width: 10, height: 10 };
  assert.equal(nearestFrame([far, small], { x: 300, y: 50 }).id, "small");
});
