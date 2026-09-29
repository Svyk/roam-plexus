import test from "node:test";
import assert from "node:assert/strict";
import { parseRoamLink } from "../src/model/links.js";

test("page links: [[Title]], #Title, #[[Title]]", () => {
  assert.deepEqual(parseRoamLink("[[My Page]]", "g"), { type: "page", title: "My Page" });
  assert.deepEqual(parseRoamLink("#tag", "g"), { type: "page", title: "tag" });
  assert.deepEqual(parseRoamLink("#[[multi word]]", "g"), { type: "page", title: "multi word" });
  assert.deepEqual(parseRoamLink("  [[Trim]]  ", "g"), { type: "page", title: "Trim" });
});

test("block refs", () => {
  assert.deepEqual(parseRoamLink("((abc_123-XYZ))", "g"), { type: "block", uid: "abc_123-XYZ" });
  assert.equal(parseRoamLink("((bad uid))", "g"), null);
});

test("same-graph roamresearch URLs resolve by uid, other graphs do not", () => {
  assert.deepEqual(parseRoamLink("https://roamresearch.com/#/app/Readwisenotes/page/AbC123xyz", "Readwisenotes"), { type: "page", uid: "AbC123xyz" });
  assert.deepEqual(parseRoamLink("https://roamresearch.com/#/app/Readwisenotes/page/AbC123xyz/", "Readwisenotes"), { type: "page", uid: "AbC123xyz" });
  assert.equal(parseRoamLink("https://roamresearch.com/#/app/other/page/AbC123xyz", "Readwisenotes"), null);
  assert.equal(parseRoamLink("https://roamresearch.com/#/app/Readwisenotes/page/AbC123xyz", undefined), null);
  assert.equal(parseRoamLink("https://roamresearch.com/#/app/Readwisenotes", "Readwisenotes"), null);
});

test("everything else is null", () => {
  for (const s of ["https://example.com/x", "http://example.com", "", "   ", "plain text", "#", "[[]]", "[[a]] trailing", "#two words", null, undefined, 5]) {
    assert.equal(parseRoamLink(s, "g"), null, String(s));
  }
});
