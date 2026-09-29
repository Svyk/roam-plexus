import test from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_QUERY, rowsFromQuery, mentionsExcalData, isLegacyDrawingString,
  parseLegacyDrawing, legacyToElements, legacyReport, legacySummary,
} from "../src/model/legacy.js";

const EL = (extra = "") => `{:type "rectangle" :x 1 :y 2 :width 30 :height 40 :strokeSharpness "sharp" ${extra}}`;
const drawing = (elements, tail = "") =>
  `{{roam/render: ((ExcalDATA)) {:appState {:zoom {:value 1}} :elements [${elements}] :roamExcalidraw {:version 1}}}}${tail}`;

test("isLegacyDrawingString positives", () => {
  assert.ok(isLegacyDrawingString(drawing(EL())));
  assert.ok(isLegacyDrawingString("  " + drawing(EL()) + "\n"));
  assert.ok(isLegacyDrawingString("{{[[roam/render]]: ((ExcalDATA)) {:elements []}}}"));
  assert.ok(isLegacyDrawingString("{{roam/render:((ExcalDATA)){:elements []}}}"));
  assert.ok(isLegacyDrawingString("{{roam/render: ((ExcalDATA))}}"));
});

test("isLegacyDrawingString negatives incl. component code block", () => {
  const code = "{{roam/render: ((sketching))}}";
  const codeBlock = "```clojure\n(ns x)\n(def a \"((ExcalDATA))\")\n(fn [b] (str \"{{roam/render: ((ExcalDATA)) \" b))\n```";
  assert.equal(isLegacyDrawingString(code), false);
  assert.equal(isLegacyDrawingString(codeBlock), false);
  assert.equal(isLegacyDrawingString("see ((ExcalDATA)) here"), false);
  assert.equal(isLegacyDrawingString("x {{roam/render: ((ExcalDATA)) {}}}"), false);
  assert.equal(isLegacyDrawingString("{{[[excalidraw]]}}"), false);
  assert.equal(isLegacyDrawingString("{{roam/render: ((ExcalDATA)) nope}}"), false);
  assert.equal(isLegacyDrawingString(null), false);
  assert.equal(isLegacyDrawingString(undefined), false);
  assert.equal(mentionsExcalData(codeBlock), true);
  assert.equal(mentionsExcalData("nothing"), false);
});

test("parseLegacyDrawing: measured shape", () => {
  const s = drawing(`{:type "draw" :points [[0 0] [1 -2]] :strokeSharpness "round" :boundElementIds nil} ${EL(":isDeleted true")} ${EL(":isDeleted false")}`);
  const r = parseLegacyDrawing(s);
  assert.equal(r.error, undefined);
  assert.equal(r.version, 1);
  assert.deepEqual(r.appState, { zoom: { value: 1 } });
  assert.equal(r.elements.length, 2);
  assert.equal(r.elements[0].type, "draw");
  assert.equal(r.trailing, undefined);
});

test("parseLegacyDrawing: braces inside text, trailing, never drawn, errors", () => {
  const t = drawing(`{:type "text" :x 0 :y 0 :width 5 :height 5 :text "a}} b } {{c"}`, " extra");
  const r = parseLegacyDrawing(t);
  assert.equal(r.elements[0].text, "a}} b } {{c");
  assert.equal(r.trailing, true);

  assert.deepEqual(parseLegacyDrawing("{{roam/render: ((ExcalDATA))}}"), { elements: [], appState: null, version: null });
  assert.equal(parseLegacyDrawing("{{roam/render: ((ExcalDATA))}} more").trailing, true);

  assert.equal(parseLegacyDrawing("{{roam/render: ((ExcalDATA)) {:elements []}").error, "unterminated macro");
  assert.equal(parseLegacyDrawing("{{roam/render: ((ExcalDATA)) {:elements []} x}}").error, "unterminated macro");
  assert.equal(parseLegacyDrawing("{{roam/render: ((ExcalDATA)) {:appState {}}}}").error, "no elements");
  assert.equal(parseLegacyDrawing("{{roam/render: ((ExcalDATA)) {:elements 3}}}").error, "no elements");
  assert.match(parseLegacyDrawing("{{roam/render: ((ExcalDATA)) {:elements [}}}").error, /^invalid EDN: .* at \d+$/);
  assert.ok(parseLegacyDrawing("plain text").error);
  assert.equal(parseLegacyDrawing("{{roam/render: ((ExcalDATA)) {:elements []}}}").version, null);
});

test("legacyToElements: keeps fields, coerces points, drops null versions, no mutation", () => {
  const input = [{
    type: "draw", x: 0, y: 0, width: 1, height: 2, points: [[0, 0], [1, -2]],
    strokeSharpness: "round", boundElementIds: ["a"], version: null, versionNonce: null, angle: 0,
  }];
  const snapshot = structuredClone(input);
  const r = legacyToElements(input);
  assert.deepEqual(input, snapshot);
  assert.deepEqual(r.invalid, 0);
  assert.equal(r.invisible, 0);
  const el = r.elements[0];
  assert.equal("version" in el, false);
  assert.equal("versionNonce" in el, false);
  assert.equal(el.strokeSharpness, "round");
  assert.deepEqual(el.boundElementIds, ["a"]);
  assert.deepEqual(el.points, [[0, 0], [1, -2]]);
  assert.notEqual(el, input[0]);
});

test("legacyToElements: invalid and invisible counts", () => {
  const ok = { type: "rectangle", x: 0, y: 0, width: 5, height: 5 };
  const r = legacyToElements([
    ok,
    { ...ok, x: NaN },
    { ...ok, y: "3" },
    { ...ok, width: Infinity },
    { ...ok, height: undefined },
    { ...ok, type: 5 },
    { ...ok, angle: NaN },
    { ...ok, type: "line", points: [[0, 0], [NaN, 1]] },
    { ...ok, type: "line", points: "x" },
    null,
    "str",
    { ...ok, width: 0, height: 0 },
    { ...ok, type: "line", points: [[0, 0]] },
    { ...ok, type: "arrow" },
    { type: "text", x: 0, y: 0, width: 5, height: 5, text: "" },
    { type: "text", x: 0, y: 0, width: 0, height: 0, text: "hi" },
    { ...ok, width: 0, height: 5 },
  ]);
  assert.equal(r.elements.length, 3);
  assert.equal(r.invalid, 10);
  assert.equal(r.invisible, 4);
});

test("legacyToElements: migratedFrom merges customData", () => {
  const input = [
    { type: "rectangle", x: 0, y: 0, width: 5, height: 5, customData: { firebaseUrl: "u", plexus: { k: 1 } } },
    { type: "rectangle", x: 0, y: 0, width: 5, height: 5 },
  ];
  const snap = structuredClone(input);
  const { elements } = legacyToElements(input, { migratedFrom: "abcdefghi" });
  assert.deepEqual(elements[0].customData, { firebaseUrl: "u", plexus: { k: 1, migratedFrom: "abcdefghi" } });
  assert.deepEqual(elements[1].customData, { plexus: { migratedFrom: "abcdefghi" } });
  assert.deepEqual(input, snap);
  assert.equal("customData" in legacyToElements(input).elements[1], false);
});

test("legacyReport: fields, ordering, flags", () => {
  const text = (t) => `{:type "text" :x 0 :y 0 :width 5 :height 5 :text ${JSON.stringify(t)}}`;
  const rich = drawing([
    EL(),
    EL(),
    `{:type "draw" :x 0 :y 0 :width 1 :height 2 :points [[0 0] [1 -2]]}`,
    text("see [[Page B]] #tag #[[Long Tag]] ((abcdefghi)) and [[Page A]] #tag."),
    text("macro {{x}} here"),
    EL(":isDeleted true"),
    `{:type "rectangle" :x ##NaN :y 0 :width 1 :height 1}`,
    `{:type "rectangle" :x 0 :y 0 :width 0 :height 0}`,
  ].join(" "), " tail");
  const rows = [
    { uid: "zzzzzzzzz", page: "B page", string: drawing("") },
    { uid: "bbbbbbbbb", page: "A page", string: rich },
    { uid: "aaaaaaaaa", page: "A page", string: "{{roam/render: ((ExcalDATA)) {:elements [}}}" },
    { uid: "sketching", page: "roam/excalidraw", string: "```(str \"((ExcalDATA))\")```" },
    { uid: "ccccccccc", page: "C", string: "not a drawing ((ExcalDATA))" },
  ];
  const rep = legacyReport(rows);
  assert.deepEqual(rep.map((r) => r.uid), ["aaaaaaaaa", "bbbbbbbbb", "zzzzzzzzz"]);
  const [err, main, empty] = rep;
  assert.match(err.error, /^invalid EDN/);
  assert.equal(err.empty, true);
  assert.equal(err.elementCount, 0);
  assert.equal(main.error, undefined);
  assert.equal(main.elementCount, 5);
  assert.deepEqual(main.types, { draw: 1, rectangle: 2, text: 2 });
  assert.equal(main.empty, false);
  assert.equal(main.invalid, 1);
  assert.equal(main.invisible, 1);
  assert.deepEqual(main.links, ["#[[Long Tag]]", "#tag", "((abcdefghi))", "[[Page A]]", "[[Page B]]"]);
  assert.equal(main.macroText, 1);
  assert.equal(main.trailing, true);
  assert.equal(main.bytes, new TextEncoder().encode(rich).length);
  assert.equal(main.page, "A page");
  assert.deepEqual(Object.keys(main), ["uid", "page", "elementCount", "types", "empty", "bytes", "invalid", "invisible", "links", "macroText", "trailing"]);
  assert.equal(empty.empty, true);
  assert.equal(empty.trailing, false);
  assert.deepEqual(empty.links, []);
});

test("legacyReport: bytes are UTF-8 and sort is by code unit", () => {
  const s = `{{roam/render: ((ExcalDATA)) {:elements [{:type "text" :x 0 :y 0 :width 1 :height 1 :text "é☃"}]}}}`;
  const rep = legacyReport([
    { uid: "b", page: "a", string: s },
    { uid: "a", page: "B", string: s },
    { uid: "a", page: "a", string: s },
  ]);
  assert.deepEqual(rep.map((r) => r.page + r.uid), ["Ba", "aa", "ab"]);
  assert.equal(rep[0].bytes, s.length + 3);
});

test("legacySummary and query helpers", () => {
  const rows = rowsFromQuery([
    ["u1", drawing(EL()), "P1"],
    ["u2", drawing(""), "P2"],
    ["sketching", "```((ExcalDATA))```", "roam/excalidraw"],
    ["u3", "mentions ((ExcalDATA)) only", "P3"],
    ["bad"],
    "junk",
  ]);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], { uid: "u1", string: drawing(EL()), page: "P1" });
  const s = legacySummary(rows);
  assert.deepEqual(s, {
    mentions: 4,
    excluded: [
      { uid: "u3", page: "P3", reason: "not-a-drawing" },
      { uid: "sketching", page: "roam/excalidraw", reason: "component-code" },
    ],
    drawings: 2,
    empty: 1,
  });
  assert.equal(legacyReport(rows).length, 2);
  assert.match(LEGACY_QUERY, /ExcalDATA/);
  assert.deepEqual(rowsFromQuery(null), []);
});
