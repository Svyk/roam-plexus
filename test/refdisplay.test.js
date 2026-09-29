import test from "node:test";
import assert from "node:assert/strict";
import { DISPLAY_MODES, overrideKey, refContext, resolveDisplay, parseOverrides, withOverride } from "../src/model/refdisplay.js";

test("overrideKey and refContext", () => {
  assert.equal(overrideKey("b", "r"), "b|r");
  assert.equal(refContext("  ((abc))\n", "abc"), "alone");
  assert.equal(refContext("see ((abc))", "abc"), "inline");
  assert.equal(refContext(null, "abc"), "inline");
});

test("resolveDisplay order", () => {
  assert.equal(resolveDisplay({ context: "home", override: "link" }), "image");
  assert.equal(resolveDisplay({ context: "alone", override: "link" }), "link");
  assert.equal(resolveDisplay({ context: "alone", override: "bogus" }), "image");
  assert.equal(resolveDisplay({ context: "inline", inlineDisplay: "link" }), "link");
  assert.equal(resolveDisplay({ context: "inline", inlineDisplay: "x" }), "thumbnail");
  assert.deepEqual(DISPLAY_MODES, ["image", "thumbnail", "link"]);
});

test("parseOverrides", () => {
  assert.deepEqual(parseOverrides('{"a|b":"link","c|d":"nope"}'), { "a|b": "link" });
  assert.deepEqual(parseOverrides({ x: "image", y: 3 }), { x: "image" });
  for (const bad of ["{", "[]", "null", "5", undefined, null]) assert.deepEqual(parseOverrides(bad), {});
});

test("withOverride sets, deletes, re-inserts and caps", () => {
  const a = withOverride({}, "b", "r", "link");
  assert.deepEqual(a, { "b|r": "link" });
  assert.deepEqual(withOverride(a, "b", "r", null), {});
  assert.notEqual(withOverride(a, "b", "r", "image"), a);
  let m = {};
  for (let i = 0; i < 505; i++) m = withOverride(m, "b", `r${i}`, "link");
  assert.equal(Object.keys(m).length, 500);
  assert.equal(m["b|r0"], undefined);
  assert.equal(m["b|r504"], "link");
  m = withOverride(m, "b", "r5", "image");
  assert.equal(Object.keys(m).at(-1), "b|r5");
});
