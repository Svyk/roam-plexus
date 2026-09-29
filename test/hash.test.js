import test from "node:test";
import assert from "node:assert/strict";
import { fnv1a } from "../src/model/hash.js";

test("fnv1a matches published vectors", () => {
  assert.equal(fnv1a(""), "811c9dc5");
  assert.equal(fnv1a("a"), "e40c292c");
  assert.equal(fnv1a("foobar"), "bf9cf968");
});

test("fnv1a is 8 lowercase hex chars and sensitive to input", () => {
  const h = fnv1a('[{"id":"a"}]');
  assert.match(h, /^[0-9a-f]{8}$/);
  assert.notEqual(h, fnv1a('[{"id":"b"}]'));
  assert.match(fnv1a("héllo ☃"), /^[0-9a-f]{8}$/);
});
