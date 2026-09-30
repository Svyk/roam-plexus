import test from "node:test";
import assert from "node:assert/strict";
import { linksIn, parseRoamLink } from "../src/model/links.js";

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

test("linksIn emits one row per live element, mind-map then embed then link", () => {
  const long = "x".repeat(90);
  const rows = linksIn([
    { id: "m", type: "rectangle", text: "Map node", link: "[[Page]]", customData: { plexus: { mm: { uid: "nodeuid01" }, embed: "((emb000001))" } } },
    { id: "e", type: "rectangle", text: "", link: "((other0001))", customData: { plexus: { embed: "((emb000001))" } } },
    { id: "et", type: "text", containerId: "e", text: "Embed label" },
    { id: "l", type: "rectangle", text: "  Link   text ", link: "[[Other]]" },
    { id: "b", type: "rectangle", link: "((blk000001))" },
    { id: "d", type: "rectangle", isDeleted: true, link: "[[Gone]]" },
    { id: "a", type: "arrow", link: "[[Arrow]]", customData: { plexus: { mm: { edge: true, uid: "edgeuid01" } } } },
    { id: "n", type: "rectangle", link: "[[FromMm]]", customData: { plexus: { mm: { layout: "right" } } } },
    { id: "c", type: "rectangle", text: long, link: "[[Long]]" },
    { id: "dup", type: "rectangle", text: "second", link: "[[Other]]" },
    { id: "url", type: "rectangle", link: "https://example.com" },
  ]);
  assert.deepEqual(rows.map((r) => [r.elementId, r.kind, r.ref, r.text]), [
    ["m", "mindmap", "((nodeuid01))", "Map node"],
    ["e", "embed", "((emb000001))", "Embed label"],
    ["l", "link", "[[Other]]", "Link text"],
    ["b", "link", "((blk000001))", ""],
    ["n", "link", "[[FromMm]]", ""],
    ["c", "link", "[[Long]]", "x".repeat(80)],
  ]);
});

test("linksIn caps at 200 and rejects a non-array", () => {
  const elements = Array.from({ length: 210 }, (_, i) => ({ id: `e${i}`, type: "rectangle", link: `[[P${i}]]` }));
  assert.equal(linksIn(elements).length, 200);
  assert.equal(linksIn(elements)[0].ref, "[[P0]]");
  assert.deepEqual(linksIn(null), []);
});
