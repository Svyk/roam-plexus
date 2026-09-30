import test from "node:test";
import assert from "node:assert/strict";
import {
  IMAGE_KINDS, PLACEHOLDER_CAPTIONS, drawingTitleOf, imageAltAt, isPlaceholderCaption, plainCaption, regionLabel,
} from "../src/model/label.js";

test("placeholder constants", () => {
  assert.deepEqual([...PLACEHOLDER_CAPTIONS], ["Region", "Image region", "Image crop", "Frame"]);
  assert.equal(isPlaceholderCaption(" Region ", "area"), true);
  assert.equal(isPlaceholderCaption("Region", "rect"), false);
  assert.equal(isPlaceholderCaption("Frame", "frame"), true);
  assert.equal(isPlaceholderCaption("Frame", "area"), false);
  assert.equal(isPlaceholderCaption("Image crop", "rect"), true);
  assert.equal(isPlaceholderCaption("Image crop", "imgrect"), false);
  assert.equal(isPlaceholderCaption("Image region", "imgpoly"), true);
  assert.equal(isPlaceholderCaption("toString", "area"), false);
  assert.deepEqual([...IMAGE_KINDS].sort(), ["imgpoly", "imgrect"]);
});

test("caption wins and is plain text", () => {
  assert.equal(regionLabel({ kind: "area", caption: "Line 2 drain", drawingTitle: "Map" }), "Line 2 drain");
  assert.equal(regionLabel({ kind: "area", caption: "[[Site 12]] #[[hot spot]] #cold **bold**" }), "Site 12 hot spot cold bold");
  assert.equal(regionLabel({ kind: "area", caption: "[Site](((abcdefghi))) and ![pic](https://x/y.png) end" }), "Site and pic end");
  assert.equal(regionLabel({ kind: "area", caption: "keep {{[[TODO]]}} {{a: {{b}}}} this" }), "keep this");
});

test("block refs resolve to 40 plain characters or are dropped", () => {
  const blocks = { aaaaaaaaa: "The **floor** drain near [[Line 2]] with a very long description that goes on", mmmmmmmmm: "{{[[plexus-region]]: d=x}}", nnnnnnnnn: "see ((aaaaaaaaa))" };
  const resolveBlock = (u) => blocks[u];
  const out = regionLabel({ kind: "area", caption: "((aaaaaaaaa))", resolveBlock });
  assert.equal(out, "The floor drain near Line 2 with a very");
  assert.equal(regionLabel({ kind: "area", caption: "((mmmmmmmmm)) · ((zzzzzzzzz))", drawingTitle: "Map", resolveBlock }), "Map · area");
  assert.equal(regionLabel({ kind: "area", caption: "((aaaaaaaaa))", drawingTitle: "Map" }), "Map · area");
  assert.equal(regionLabel({ kind: "area", caption: "((nnnnnnnnn))", drawingTitle: "Map", resolveBlock }), "see");
  assert.equal(regionLabel({ kind: "area", caption: "((aaaaaaaaa))", drawingTitle: "Map", resolveBlock: () => { throw new Error("x"); } }), "Map · area");
  assert.equal(regionLabel({ kind: "area", caption: "((a)) ; ((b))", drawingTitle: "Map" }).includes("(("), false);
});

test("separators collapse and trim", () => {
  assert.equal(regionLabel({ kind: "area", caption: " ; a ; ; b ;" }), "a · b");
  assert.equal(regionLabel({ kind: "area", caption: "a · b ; c" }), "a · b · c");
  assert.equal(regionLabel({ kind: "area", caption: "a;b" }), "a;b");
  assert.equal(plainCaption("((x)) ; ((y))"), "");
});

test("image kinds prefer alt text, other kinds do not", () => {
  assert.equal(regionLabel({ kind: "imgrect", caption: "", imageAlt: "Rinse station", drawingTitle: "Photo" }), "Rinse station");
  assert.equal(regionLabel({ kind: "imgpoly", caption: "", imageAlt: "  ", drawingTitle: "Photo" }), "Photo · image lasso");
  assert.equal(regionLabel({ kind: "rect", caption: "", imageAlt: "Alt", drawingTitle: "Map" }), "Map · crop");
  assert.equal(regionLabel({ kind: "imgrect", caption: "Own", imageAlt: "Alt" }), "Own");
});

test("derived form for each kind", () => {
  const words = { area: "area", group: "group", frame: "frame", cframe: "clipped frame", rect: "crop", poly: "lasso", imgrect: "image area", imgpoly: "image lasso", weird: "region", undefined: "region" };
  for (const [kind, word] of Object.entries(words)) {
    assert.equal(regionLabel({ kind: kind === "undefined" ? undefined : kind, drawingTitle: "Sanitation map" }), `Sanitation map · ${word}`);
  }
  assert.equal(regionLabel({ kind: "frame" }), "Drawing · frame");
  assert.equal(regionLabel({ kind: "imgrect" }), "Image · image area");
});

test("cap at 80 characters on a word boundary", () => {
  const long = "word ".repeat(40).trim();
  const out = regionLabel({ kind: "area", caption: long });
  assert.ok(out.length <= 80);
  assert.ok(out.endsWith("…"));
  assert.ok(!out.endsWith(" …"));
  assert.match(out.slice(0, -1), /^(word )*word$/);
  const noSpace = regionLabel({ kind: "area", caption: "x".repeat(200) });
  assert.equal(noSpace.length, 80);
});

test("never throws; bad input gives Region", () => {
  assert.equal(regionLabel(), "Drawing · region");
  assert.equal(regionLabel(null), "Drawing · region");
  const hostile = { get caption() { throw new Error("x"); } };
  assert.equal(regionLabel(hostile), "Region");
  assert.equal(regionLabel({ kind: "area", caption: 5, drawingTitle: {} }).length > 0, true);
});

test("drawingTitleOf", () => {
  assert.equal(drawingTitleOf("{{[[excalidraw]]}}", "  Sanitation map "), "Sanitation map");
  const drawing = "{{[[excalidraw]]}} {{-: Text elements in drawing: [[Line 2]] drain; second; third}}";
  assert.equal(drawingTitleOf(drawing, null), "Line 2 drain");
  assert.equal(drawingTitleOf("{{[[excalidraw]]}}", ""), "Drawing");
  assert.equal(drawingTitleOf("{{[[excalidraw]]}} {{-: Text elements in drawing: }}", undefined), "Drawing");
  assert.equal(drawingTitleOf("![](https://x/y.png)", null), "Image");
  assert.equal(drawingTitleOf("Photo of **rig** ![a](https://x/y.png)", null), "Photo of rig");
  assert.equal(drawingTitleOf(null, null), "Image");
  const capped = drawingTitleOf("", "t".repeat(10) + " " + "u".repeat(60));
  assert.ok(capped.length <= 40);
  assert.equal(drawingTitleOf(drawing, "Page").startsWith("Drawing:"), false);
});

test("imageAltAt", () => {
  const s = "![first](https://a/1.png) text ![ second ](https://a/2.png) ![](https://a/3.png)";
  assert.equal(imageAltAt(s, 0), "first");
  assert.equal(imageAltAt(s, 1), "second");
  assert.equal(imageAltAt(s, 2), null);
  assert.equal(imageAltAt(s, 9), null);
  assert.equal(imageAltAt(null, 0), null);
});
