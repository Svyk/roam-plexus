import test from "node:test";
import assert from "node:assert/strict";
import { DISPLAY_MODES, overrideKey, refContext, resolveCaption, resolveDisplay, parseOverrides, serializeOverrides, withOverride } from "../src/model/refdisplay.js";

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
  assert.deepEqual(parseOverrides('{"a|b":"link","c|d":"nope"}'), { "a|b": { mode: "link" } });
  assert.deepEqual(parseOverrides({ x: "image", y: 3 }), { x: { mode: "image" } });
  for (const bad of ["{", "[]", "null", "5", undefined, null]) assert.deepEqual(parseOverrides(bad), {});
});

test("withOverride sets, deletes, re-inserts and caps", () => {
  const a = withOverride({}, "b", "r", "link");
  assert.deepEqual(a, { "b|r": { mode: "link" } });
  assert.deepEqual(withOverride(a, "b", "r", null), {});
  assert.notEqual(withOverride(a, "b", "r", "image"), a);
  let m = {};
  for (let i = 0; i < 505; i++) m = withOverride(m, "b", `r${i}`, "link");
  assert.equal(Object.keys(m).length, 500);
  assert.equal(m["b|r0"], undefined);
  assert.deepEqual(m["b|r504"], { mode: "link" });
  m = withOverride(m, "b", "r5", "image");
  assert.equal(Object.keys(m).at(-1), "b|r5");
});

test("parseOverrides: object form, invalid fields and entries", () => {
  const raw = {
    a: { mode: "link", caption: "hide" },
    b: { caption: "show" },
    c: { mode: "bogus", caption: "nope" },
    d: {},
    e: [],
    f: null,
    g: { mode: "image", caption: 3 },
    h: "bogus",
  };
  assert.deepEqual(parseOverrides(JSON.stringify(raw)), {
    a: { mode: "link", caption: "hide" },
    b: { caption: "show" },
    g: { mode: "image" },
  });
});

test("withOverride merges patches, null field removes, empty entry is deleted", () => {
  let m = withOverride({}, "b", "r", { caption: "hide" });
  assert.deepEqual(m, { "b|r": { caption: "hide" } });
  m = withOverride(m, "b", "r", { mode: "link" });
  assert.deepEqual(m, { "b|r": { caption: "hide", mode: "link" } });
  m = withOverride(m, "b", "r", { mode: null });
  assert.deepEqual(m, { "b|r": { caption: "hide" } });
  m = withOverride(m, "b", "r", { caption: null });
  assert.deepEqual(m, {});
  m = withOverride({ "b|r": { mode: "link" } }, "b", "r", null);
  assert.deepEqual(m, {});
  assert.deepEqual(withOverride({ "b|r": { mode: "link" } }, "b", "r", { caption: "bogus" }), { "b|r": { mode: "link" } });
  assert.deepEqual(withOverride({ "b|r": "link" }, "b", "r", { caption: "show" }), { "b|r": { mode: "link", caption: "show" } });
});

test("withOverride re-inserts the touched key at the end", () => {
  let m = withOverride({}, "a", "1", { mode: "link" });
  m = withOverride(m, "b", "2", { mode: "link" });
  m = withOverride(m, "a", "1", { caption: "hide" });
  assert.deepEqual(Object.keys(m), ["b|2", "a|1"]);
});

test("serializeOverrides keeps mode-only entries as bare strings", () => {
  assert.deepEqual(
    serializeOverrides({ a: { mode: "link" }, b: { caption: "hide" }, c: { mode: "image", caption: "show" } }),
    { a: "link", b: { caption: "hide" }, c: { mode: "image", caption: "show" } },
  );
  assert.deepEqual(serializeOverrides(serializeOverrides({ a: { mode: "link" } })), { a: "link" });
});

test("resolveDisplay reads string or object overrides", () => {
  assert.equal(resolveDisplay({ context: "alone", override: { mode: "link" } }), "link");
  assert.equal(resolveDisplay({ context: "inline", override: { caption: "hide" }, inlineDisplay: "link" }), "link");
  assert.equal(resolveDisplay({ context: "alone", override: { caption: "hide" } }), "image");
  assert.equal(resolveDisplay({ context: "home", override: { mode: "link" } }), "image");
});

test("resolveCaption", () => {
  assert.equal(resolveCaption({ captionDisplay: "never", override: { caption: "show" }, context: "home" }), "written");
  assert.equal(resolveCaption({ captionDisplay: "never", override: { caption: "show" }, context: "alone" }), "show");
  assert.equal(resolveCaption({ captionDisplay: "always", override: { caption: "hide" }, context: "inline" }), "hide");
  assert.equal(resolveCaption({ captionDisplay: "never", context: "alone" }), "hide");
  assert.equal(resolveCaption({ captionDisplay: "always", override: { mode: "link" } }), "show");
  assert.equal(resolveCaption({ captionDisplay: "written" }), "written");
  assert.equal(resolveCaption({ captionDisplay: "bogus", override: { caption: "x" } }), "written");
  assert.equal(resolveCaption(), "written");
});
