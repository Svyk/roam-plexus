import assert from "node:assert/strict";
import test from "node:test";

import { elementsToOutline, outlineToMarkdown } from "../src/model/outline.js";

const base = { angle: 0, isDeleted: false, version: 1 };
const txt = (id, text, x, y, extra = {}) => ({ ...base, id, type: "text", x, y, width: 80, height: 20, text, originalText: text, ...extra });
const rect = (id, x, y, extra = {}) => ({ ...base, id, type: "rectangle", x, y, width: 100, height: 40, ...extra });
const arrow = (id, from, to, extra = {}) => ({ ...base, id, type: "arrow", x: 0, y: 0, width: 1, height: 1, startBinding: { elementId: from }, endBinding: { elementId: to }, ...extra });
const frame = (id, name, x, y, extra = {}) => ({ ...base, id, type: "frame", name, x, y, width: 400, height: 300, ...extra });
const strings = (nodes) => nodes.map((n) => (n.children.length ? [n.string, strings(n.children)] : n.string));

test("free text in reading order: rows share y within half the smaller height, then x", () => {
  const out = elementsToOutline([txt("c", "C", 0, 100), txt("b", "B", 200, 5), txt("a", "A", 0, 0)]);
  assert.deepEqual(strings(out.nodes), ["A", "B", "C"]);
  assert.equal(out.count, 3);
});

test("frames become headings in orderFrames order, then outside items; unnamed frames are Frame n", () => {
  const els = [
    frame("f2", "Second", 0, 500, { customData: { plexus: { order: 2 } } }),
    frame("f1", "", 0, 0, { customData: { plexus: { order: 1 } } }),
    txt("t1", "in one", 10, 10, { frameId: "f1" }),
    txt("t2", "in two", 10, 510, { frameId: "f2" }),
    txt("t3", "free", 900, 0),
    txt("t4", "orphan", 900, 50, { frameId: "gone" }),
  ];
  const out = elementsToOutline(els);
  assert.deepEqual(strings(out.nodes), [["Frame 1", ["in one"]], ["Second", ["in two"]], "free", "orphan"]);
  assert.equal(out.nodes[0].heading, 2);
  assert.equal(out.nodes[2].heading, 0);
  assert.equal(out.count, 6);
});

test("Kahn ordering follows arrows; a single incoming arrow nests, two do not", () => {
  const els = [
    txt("a", "A", 0, 200), txt("b", "B", 0, 0), txt("c", "C", 0, 100), txt("d", "D", 200, 100),
    arrow("e1", "a", "b"), arrow("e2", "a", "c"), arrow("e3", "b", "d"), arrow("e4", "c", "d"),
  ];
  const out = elementsToOutline(els);
  assert.deepEqual(strings(out.nodes), [["A", ["B", "C"]], "D"]);
});

test("cycles are broken by reading order", () => {
  const els = [txt("a", "A", 0, 0), txt("b", "B", 0, 100), arrow("e1", "a", "b"), arrow("e2", "b", "a")];
  const out = elementsToOutline(els);
  assert.deepEqual(strings(out.nodes), [["A", ["B"]]]);
});

test("arrows between buckets are ignored; self loops and duplicates are harmless", () => {
  const els = [
    frame("f", "F", 0, 0), txt("a", "A", 10, 10, { frameId: "f" }), txt("b", "B", 900, 10),
    arrow("e1", "a", "b"), arrow("e2", "b", "b"), arrow("e3", "a", "b"),
  ];
  assert.deepEqual(strings(elementsToOutline(els).nodes), [["F", ["A"]], "B"]);
});

test("bound text is never its own item; the container uses originalText; arrow labels are ignored", () => {
  const els = [
    rect("r", 0, 0), txt("rt", "wrapped", 0, 0, { containerId: "r", originalText: "Box text" }),
    arrow("e", "r", "r2"), txt("al", "label", 0, 0, { containerId: "e" }), rect("r2", 0, 100),
  ];
  const out = elementsToOutline(els);
  assert.deepEqual(strings(out.nodes), ["Box text"]);
});

test("shapes without text are skipped; deleted elements ignored", () => {
  assert.equal(elementsToOutline([rect("r", 0, 0), txt("t", "x", 0, 0, { isDeleted: true }), txt("e", "  ", 0, 0)]).count, 0);
});

test("embed anchors give the ref only, today gets the page title; images give markdown", () => {
  const els = [
    rect("e1", 0, 0, { customData: { plexus: { embed: "((abcdefghi))" } } }),
    txt("e1t", "ignored label", 0, 0, { containerId: "e1" }),
    rect("e2", 0, 100, { customData: { plexus: { embed: "[[Some Page]]" } } }),
    rect("e3", 0, 200, { customData: { plexus: { embed: "plexus:today" } } }),
    { ...base, id: "img", type: "image", x: 0, y: 300, width: 10, height: 10, customData: { firebaseUrl: "https://x.test/a.png" } },
    { ...base, id: "img2", type: "image", x: 0, y: 400, width: 10, height: 10 },
  ];
  const out = elementsToOutline(els, { today: "September 30th, 2026" });
  assert.deepEqual(strings(out.nodes), ["((abcdefghi))", "[[Some Page]]", "[[September 30th, 2026]]", "![](https://x.test/a.png)"]);
});

test("links: embed refs append as ((uid)) unless already in the text, other links append as is, [[links]] stay", () => {
  const els = [
    txt("a", "See [[Page]]", 0, 0, { link: "((abcdefghi))" }),
    txt("b", "Has ((abcdefghi)) already", 0, 100, { link: "((abcdefghi))" }),
    txt("c", "Site", 0, 200, { link: "https://x.test" }),
  ];
  assert.deepEqual(strings(elementsToOutline(els).nodes), ["See [[Page]] ((abcdefghi))", "Has ((abcdefghi)) already", "Site https://x.test"]);
});

test("mind-map projections collapse to one ((rootUid)) item per map", () => {
  const els = [
    rect("pmm-m1-root", 0, 0, { customData: { plexus: { mm: { uid: "rootuid01", map: "m1", root: true } } } }),
    txt("pmm-m1-root-t", "Root", 0, 0, { containerId: "pmm-m1-root" }),
    rect("pmm-m1-kid", 0, 100, { customData: { plexus: { mm: { uid: "kiduid001", map: "m1" } } } }),
    arrow("pmm-m1-kid-e", "pmm-m1-root", "pmm-m1-kid"),
  ];
  assert.deepEqual(strings(elementsToOutline(els).nodes), ["((rootuid01))"]);
});

test("selection: bound text maps to its container, a selected frame brings its children, others are left out", () => {
  const els = [
    frame("f", "F", 0, 0), txt("in", "inside", 5, 5, { frameId: "f" }),
    rect("r", 500, 0), txt("rt", "boxed", 500, 0, { containerId: "r" }),
    txt("x", "other", 900, 0),
  ];
  assert.deepEqual(strings(elementsToOutline(els, { selection: ["rt"] }).nodes), ["boxed"]);
  assert.deepEqual(strings(elementsToOutline(els, { selection: new Set(["f"]) }).nodes), [["F", ["inside"]]]);
  assert.deepEqual(strings(elementsToOutline(els, { selection: ["in", "x"] }).nodes), [["F", ["inside"]], "other"]);
  assert.equal(elementsToOutline(els, { selection: [] }).count, 0);
});

test("outlineToMarkdown: bullets, two spaces per level, headings, continuation lines", () => {
  const tree = { nodes: [
    { string: "Frame", heading: 2, children: [{ string: "a\nsecond line", heading: 0, children: [{ string: "deep", heading: 0, children: [] }] }] },
    { string: "free", heading: 0, children: [] },
  ], count: 4 };
  assert.equal(outlineToMarkdown(tree), "- ## Frame\n  - a\n    second line\n    - deep\n- free");
  assert.equal(outlineToMarkdown(tree, { multiline: false }), "- ## Frame\n  - a second line\n    - deep\n- free");
  assert.equal(outlineToMarkdown(tree.nodes), outlineToMarkdown(tree));
  assert.equal(outlineToMarkdown({ nodes: [] }), "");
});
