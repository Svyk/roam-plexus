import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRegion, serializeRegion, normalizeFrac, isContainerString, geometryKey,
  CONTAINER_STRING, DEFAULT_PAD,
} from "../src/model/region.js";

test("parses an area region", () => {
  const r = parseRegion("{{[[plexus-region]]: k=area d=abc123XYZ ids=rect-a,text_a pad=10}} My caption");
  assert.deepEqual(r, {
    kind: "area", drawingUid: "abc123XYZ", ids: ["rect-a", "text_a"], pad: 10,
    caption: "My caption", extra: [], supported: true,
  });
});

test("pad defaults to 10 and parse is order-insensitive", () => {
  const r = parseRegion("{{[[plexus-region]]: ids=a d=u1 k=area}}");
  assert.equal(r.pad, DEFAULT_PAD);
  assert.equal(r.caption, "");
  assert.equal(r.supported, true);
});

test("parses a rect region and clamps fractions", () => {
  const r = parseRegion("{{[[plexus-region]]: k=rect d=u1 el=img1 f=-0.5,0.25,2,0.5}}");
  assert.deepEqual(r.f, [0, 0.25, 1, 0.5]);
  assert.equal(r.el, "img1");
  assert.equal(r.supported, true);
});

test("round-trips canonical strings", () => {
  for (const s of [
    "{{[[plexus-region]]: k=area d=u1 ids=a,b pad=10}} Caption text",
    "{{[[plexus-region]]: k=area d=u1 ids=a pad=0}}",
    "{{[[plexus-region]]: k=rect d=u1 el=e1 f=0.25,0.5,0.5,0.125}} x",
  ]) assert.equal(serializeRegion(parseRegion(s)), s);
});

test("non-canonical order is normalized, unknown tokens preserved in order", () => {
  const s = "{{[[plexus-region]]: pad=5 zz=1 ids=a d=u1 k=area yy=two}} cap";
  const r = parseRegion(s);
  assert.deepEqual(r.extra, [["zz", "1"], ["yy", "two"]]);
  assert.equal(serializeRegion(r), "{{[[plexus-region]]: k=area d=u1 ids=a pad=5 zz=1 yy=two}} cap");
});

test("reserved kinds parse as unsupported without error and round-trip", () => {
  for (const kind of ["group", "frame", "cframe", "poly"]) {
    const s = `{{[[plexus-region]]: k=${kind} d=u1 ids=a,b pad=3}} c`;
    const r = parseRegion(s);
    assert.equal(r.supported, false);
    assert.equal(r.error, undefined);
    assert.equal(r.kind, kind);
    assert.equal(serializeRegion(r), s);
  }
});

test("malformed regions carry an error and supported=false", () => {
  const cases = {
    "{{[[plexus-region]]: k=area ids=a}}": /missing d/,
    "{{[[plexus-region]]: k=area d=u1}}": /missing ids/,
    "{{[[plexus-region]]: k=area d=u1 ids=a,,b}}": /bad ids/,
    "{{[[plexus-region]]: k=area d=u1 ids=a pad=999}}": /bad pad/,
    "{{[[plexus-region]]: k=area d=u1 ids=a pad=x}}": /bad pad/,
    "{{[[plexus-region]]: k=rect d=u1 f=0,0,1,1}}": /missing el/,
    "{{[[plexus-region]]: k=rect d=u1 el=e}}": /missing f/,
    "{{[[plexus-region]]: k=rect d=u1 el=e f=0,0,0,1}}": /bad f/,
    "{{[[plexus-region]]: k=rect d=u1 el=e f=a,b,c,d}}": /bad f/,
    "{{[[plexus-region]]: k=rect d=u1 el=e f=0,0,1}}": /bad f/,
    "{{[[plexus-region]]: k=blob d=u1}}": /unknown kind/,
    "{{[[plexus-region]]: d=u1}}": /missing k/,
    "{{[[plexus-region]]: k=area d=u 1 ids=a}}": /./,
  };
  for (const [s, re] of Object.entries(cases)) {
    const r = parseRegion(s);
    assert.ok(r, s);
    assert.equal(r.supported, false, s);
    assert.match(r.error, re, s);
  }
});

test("non-region strings give null", () => {
  for (const s of ["", "hello", "{{[[plexus-regions]]}}", "{{[[excalidraw]]}}", null, undefined, 5]) {
    assert.equal(parseRegion(s), null);
  }
});

test("serialize throws TypeError on invalid input", () => {
  assert.throws(() => serializeRegion(null), TypeError);
  assert.throws(() => serializeRegion({ kind: "area", drawingUid: "u", ids: [] }), TypeError);
  assert.throws(() => serializeRegion({ kind: "area", drawingUid: "u", ids: ["a b"] }), TypeError);
  assert.throws(() => serializeRegion({ kind: "area", drawingUid: "u", ids: ["a"], pad: 1.5 }), TypeError);
  assert.throws(() => serializeRegion({ kind: "rect", drawingUid: "u", el: "e", f: [0, 0, 0, 1] }), TypeError);
  assert.throws(() => serializeRegion({ kind: "nope", drawingUid: "u" }), TypeError);
  assert.throws(() => serializeRegion({ kind: "area", drawingUid: "bad uid", ids: ["a"] }), TypeError);
});

test("serialize defaults pad and collapses caption whitespace", () => {
  assert.equal(
    serializeRegion({ kind: "area", drawingUid: "u", ids: ["a"], caption: "  two\n lines " }),
    "{{[[plexus-region]]: k=area d=u ids=a pad=10}} two lines",
  );
});

test("normalizeFrac accepts arrays and both object shapes, 4dp, no trailing zeros", () => {
  assert.deepEqual(normalizeFrac([0.25, 0.5, 0.5, 0.5]), [0.25, 0.5, 0.5, 0.5]);
  assert.deepEqual(normalizeFrac({ rx: 0, ry: 0, rw: 1, rh: 1 }), [0, 0, 1, 1]);
  assert.deepEqual(normalizeFrac({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }), [0.1, 0.2, 0.3, 0.4]);
  assert.deepEqual(normalizeFrac([1 / 3, 1 / 3, 1 / 3, 1 / 3]), [0.3333, 0.3333, 0.3333, 0.3333]);
  assert.equal(normalizeFrac([0, 0, 0, 1]), null);
  assert.equal(normalizeFrac([0, 0, 1]), null);
  assert.equal(normalizeFrac([0, 0, NaN, 1]), null);
  assert.equal(normalizeFrac(null), null);
  const s = serializeRegion({ kind: "rect", drawingUid: "u", el: "e", f: [0.25, 0.5, 0.5, 0.5] });
  assert.ok(s.includes("f=0.25,0.5,0.5,0.5"));
});

test("isContainerString", () => {
  assert.equal(isContainerString(CONTAINER_STRING), true);
  assert.equal(isContainerString(" {{[[plexus-regions]]}} "), true);
  assert.equal(isContainerString("{{[[plexus-region]]: k=area}}"), false);
  assert.equal(isContainerString(null), false);
});

test("geometryKey is stable and sorts ids", () => {
  assert.equal(geometryKey(parseRegion("{{[[plexus-region]]: k=area d=u1 ids=b,a pad=10}}")), "area|u1|a,b|10");
  assert.equal(geometryKey(parseRegion("{{[[plexus-region]]: k=area d=u1 ids=a,b}} cap")), "area|u1|a,b|10");
  assert.equal(geometryKey(parseRegion("{{[[plexus-region]]: k=rect d=u1 el=e f=0.5,0,0.5,1}}")), "rect|u1|e|0.5,0,0.5,1");
});
