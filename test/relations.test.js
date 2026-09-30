import test from "node:test";
import assert from "node:assert/strict";
import { relationPlan } from "../src/relations.js";

const SRC = "srcuid001";
const DST = "dstuid001";

test("default plan is a bare relates to attribute and a ref child", () => {
  assert.deepEqual(relationPlan({ sourceUid: SRC, destUid: DST }), {
    parentUid: SRC,
    attribute: "relates to::",
    child: `((${DST}))`,
  });
  assert.deepEqual(relationPlan({ sourceUid: SRC, destUid: DST, strings: [] }), {
    parentUid: SRC,
    attribute: "relates to::",
    child: `((${DST}))`,
  });
});

test("label is the attribute name plus :: with no value", () => {
  assert.deepEqual(relationPlan({ sourceUid: SRC, destUid: DST, label: "causes" }), {
    parentUid: SRC,
    attribute: "causes::",
    child: `((${DST}))`,
  });
  assert.equal(relationPlan({ sourceUid: SRC, destUid: DST, label: "part of" }).attribute, "part of::");
  assert.equal(relationPlan({ sourceUid: SRC, destUid: DST, label: "" }).attribute, "relates to::");
  assert.equal(relationPlan({ sourceUid: SRC, destUid: DST, label: null }).attribute, "relates to::");
});

test("missing or equal uids return null", () => {
  assert.equal(relationPlan({ destUid: DST }), null);
  assert.equal(relationPlan({ sourceUid: SRC }), null);
  assert.equal(relationPlan({ sourceUid: "", destUid: DST }), null);
  assert.equal(relationPlan({ sourceUid: SRC, destUid: "" }), null);
  assert.equal(relationPlan({ sourceUid: null, destUid: DST }), null);
  assert.equal(relationPlan({ sourceUid: SRC, destUid: null }), null);
  assert.equal(relationPlan({}), null);
  assert.equal(relationPlan(), null);
  assert.equal(relationPlan({ sourceUid: SRC, destUid: SRC }), null);
  assert.equal(relationPlan({ sourceUid: SRC, destUid: SRC, strings: ["unrelated"] }), null);
});

test("any string that contains the dest ref returns null", () => {
  assert.equal(relationPlan({ sourceUid: SRC, destUid: DST, strings: [`((${DST}))`] }), null);
  assert.equal(relationPlan({ sourceUid: SRC, destUid: DST, strings: ["note", `see ((${DST})) here`] }), null);
  assert.equal(relationPlan({
    sourceUid: SRC,
    destUid: DST,
    label: "causes",
    strings: ["causes::", `((${DST}))`],
  }), null);
  assert.equal(relationPlan({ sourceUid: SRC, destUid: DST, strings: [null, 1, { string: `((${DST}))` }, `((${DST}))`] }), null);
});

test("other text still returns a plan", () => {
  assert.deepEqual(relationPlan({
    sourceUid: SRC,
    destUid: DST,
    strings: ["", "((otheruid1))", "relates to::", `((${DST.slice(0, -1)}))`, DST],
  }), {
    parentUid: SRC,
    attribute: "relates to::",
    child: `((${DST}))`,
  });
});
