import test from "node:test";
import assert from "node:assert/strict";
import { parseEmbedRef, makeEmbedAnchor, embedAnchors, embedLabel, mergePlexusData } from "../src/model/embeds.js";

const BASE = ["id", "type", "x", "y", "width", "height", "angle", "strokeColor", "backgroundColor", "fillStyle", "strokeWidth", "strokeStyle",
  "roughness", "opacity", "groupIds", "frameId", "roundness", "seed", "version", "versionNonce", "isDeleted", "boundElements", "updated", "link", "locked", "index"];

test("parseEmbedRef", () => {
  assert.deepEqual(parseEmbedRef(" ((abc123XYZ)) "), { kind: "block", uid: "abc123XYZ", ref: "((abc123XYZ))" });
  assert.equal(parseEmbedRef("abc123XYZ").uid, "abc123XYZ");
  assert.deepEqual(parseEmbedRef("[[My Page]]"), { kind: "page", title: "My Page", ref: "[[My Page]]" });
  for (const bad of ["", "hello world", "((short))", "[[]]", null, 5]) assert.equal(parseEmbedRef(bad), null);
});

test("embedLabel strips markup and truncates to 80", () => {
  assert.equal(embedLabel("{{[[TODO]]}} see `code` [[Page]]"), "TODO see code Page");
  assert.equal(embedLabel("x".repeat(200)).length, 80);
});

test("makeEmbedAnchor returns a complete bound rect/text pair", () => {
  const [rect, text] = makeEmbedAnchor({ ref: "((abc123XYZ))", label: "Hello [[World]]", x: 10, y: 20 });
  for (const k of BASE) { assert.ok(k in rect, `rect ${k}`); assert.ok(k in text, `text ${k}`); }
  assert.equal(rect.type, "rectangle");
  assert.equal(rect.width, 360);
  assert.equal(rect.height, 200);
  assert.equal(rect.index, null);
  assert.equal(rect.strokeStyle, "dashed");
  assert.equal(rect.backgroundColor, "transparent");
  assert.equal(rect.link, "((abc123XYZ))");
  assert.deepEqual(rect.customData, { plexus: { embed: "((abc123XYZ))" } });
  assert.deepEqual(rect.boundElements, [{ id: text.id, type: "text" }]);
  assert.equal(text.containerId, rect.id);
  assert.equal(text.text, "Hello World");
  assert.equal(text.originalText, text.text);
  for (const k of ["fontSize", "fontFamily", "textAlign", "verticalAlign", "lineHeight", "autoResize"]) assert.ok(k in text, k);
  assert.notEqual(rect.id, text.id);
  assert.ok(rect.id.startsWith("plexus-embed-"));
  assert.ok(makeEmbedAnchor({ ref: "[[P]]", idPrefix: "zz-" })[0].id.startsWith("zz-"));
});

test("mergePlexusData preserves firebaseUrl and other plexus keys", () => {
  const merged = mergePlexusData({ firebaseUrl: "u", plexus: { order: 2 } }, { embed: "((abc123XYZ))" });
  assert.deepEqual(merged, { firebaseUrl: "u", plexus: { order: 2, embed: "((abc123XYZ))" } });
  assert.deepEqual(mergePlexusData(null, { a: 1 }), { plexus: { a: 1 } });
});

test("embedAnchors finds live anchors only", () => {
  const [a] = makeEmbedAnchor({ ref: "((abc123XYZ))", label: "a" });
  const [b] = makeEmbedAnchor({ ref: "[[P]]", label: "b" });
  const plain = { id: "p", type: "rectangle", customData: { plexus: { region: 1 } } };
  assert.deepEqual(embedAnchors([a, { ...b, isDeleted: true }, plain, { id: "i", type: "image" }]).map((e) => e.id), [a.id]);
  assert.deepEqual(embedAnchors(null), []);
});

test("makeEmbedAnchor wraps a long label inside the anchor width", () => {
  const label = "word ".repeat(16).trim();
  const [rect, text] = makeEmbedAnchor({ ref: "((abc123XYZ))", label, width: 360, height: 200 });
  const lines = text.text.split("\n");
  assert.ok(lines.length > 1);
  assert.ok(Math.max(...lines.map((l) => l.length)) * 16 * 0.6 <= 360 - 16 + 1);
  assert.equal(text.originalText, embedLabel(label));
  assert.equal(text.height, Math.ceil(lines.length * 16 * 1.25));
  assert.ok(text.height < rect.height);
});
