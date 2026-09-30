import test from "node:test";
import assert from "node:assert/strict";
import { orderFrames } from "../src/model/slides.js";

const fr = (id, name, x, y, extra = {}) => ({ id, type: "frame", name, x, y, width: 10, height: 10, ...extra });
const ids = (l) => l.map((e) => e.id);

test("orderFrames: natural name order, case-insensitive", () => {
  assert.deepEqual(ids(orderFrames([fr("c", "10 End", 0, 0), fr("a", "2 Intro", 0, 0), fr("b", "abc", 0, 0), fr("d", "ABD", 0, 0)])), ["a", "c", "b", "d"]);
});

test("orderFrames: explicit order first, then name, y, x", () => {
  const els = [
    fr("n1", "b", 0, 0),
    fr("o2", "z", 0, 0, { customData: { plexus: { order: 2 } } }),
    fr("o1", "y", 0, 0, { customData: { plexus: { order: 1 } } }),
    fr("n2", "a", 0, 0),
  ];
  assert.deepEqual(ids(orderFrames(els)), ["o1", "o2", "n2", "n1"]);
});

test("orderFrames: ties by y then x; skips deleted and non-frames; magicframe kept", () => {
  const els = [
    fr("r", "s", 50, 10), fr("l", "s", 0, 10), fr("t", "s", 90, 0),
    fr("gone", "a", 0, 0, { isDeleted: true }),
    { id: "rect", type: "rectangle", x: 0, y: 0 },
    { ...fr("m", "s", 0, 20), type: "magicframe" },
  ];
  assert.deepEqual(ids(orderFrames(els)), ["t", "l", "r", "m"]);
  assert.deepEqual(orderFrames(null), []);
});

test("orderFrames is unchanged: a lone ordered frame sorts before unordered ones (frame ops rewrite orders instead)", async () => {
  const { orderFrames } = await import("../src/model/slides.js");
  const mk = (id, name, order) => ({ id, type: "frame", name, x: 0, y: 0, isDeleted: false, ...(order == null ? {} : { customData: { plexus: { order } } }) });
  assert.deepEqual(orderFrames([mk("a", "A"), mk("b", "B"), mk("c", "Slide 4", 1)]).map((f) => f.id), ["c", "a", "b"]);
});
