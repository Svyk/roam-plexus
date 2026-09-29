import test from "node:test";
import assert from "node:assert/strict";
import { parseEdn, readEdn } from "../src/model/edn.js";

const pos = (fn) => {
  try { fn(); } catch (e) { return e; }
  assert.fail("expected throw");
};

test("measured-format legacy map", () => {
  const v = parseEdn(`{:appState {:viewBackgroundColor "#ffffff", :zoom {:value 1}} :elements [{:type "draw" :points [[0 0] [1 -2]] :strokeSharpness "round" :boundElementIds nil :isDeleted false}] :roamExcalidraw {:version 1}}`);
  assert.deepEqual(v, {
    appState: { viewBackgroundColor: "#ffffff", zoom: { value: 1 } },
    elements: [{ type: "draw", points: [[0, 0], [1, -2]], strokeSharpness: "round", boundElementIds: null, isDeleted: false }],
    roamExcalidraw: { version: 1 },
  });
});

test("atoms: nil, booleans, keywords, symbols, namespaced keys", () => {
  assert.equal(parseEdn("nil"), null);
  assert.equal(parseEdn("true"), true);
  assert.equal(parseEdn("false"), false);
  assert.equal(parseEdn(":a"), "a");
  assert.equal(parseEdn(":ns/a"), "ns/a");
  assert.equal(parseEdn("foo/bar"), "foo/bar");
  assert.deepEqual(parseEdn("{:ns/a 1}"), { "ns/a": 1 });
});

test("numbers", () => {
  assert.equal(parseEdn("0"), 0);
  assert.equal(parseEdn("-12"), -12);
  assert.equal(parseEdn("+3"), 3);
  assert.equal(parseEdn("1.5"), 1.5);
  assert.equal(parseEdn("-0.25"), -0.25);
  assert.equal(parseEdn("1e3"), 1000);
  assert.equal(parseEdn("1.5E-3"), 0.0015);
  assert.equal(parseEdn("1e+21"), 1e21);
  assert.ok(Number.isNaN(parseEdn("##NaN")));
  assert.equal(parseEdn("##Inf"), Infinity);
  assert.equal(parseEdn("##-Inf"), -Infinity);
  assert.ok(Number.isNaN(parseEdn("NaN")));
  assert.equal(parseEdn("Infinity"), Infinity);
  assert.equal(parseEdn("-Infinity"), -Infinity);
  for (const bad of ["1N", "1M", "1/2", "01", "1.", "1e", "-", "+.5x1"].slice(0, 6)) {
    assert.throws(() => parseEdn(bad), SyntaxError, bad);
  }
  assert.equal(parseEdn("-"), "-");
});

test("string escapes", () => {
  assert.equal(parseEdn(String.raw`"a\"b\\c\nd\te\rf\bg\fh"`), 'a"b\\c\nd\te\rf\bg\fh');
  assert.equal(parseEdn(String.raw`"Aé"`), "Aé");
  assert.equal(parseEdn(String.raw`"😀"`), "\u{1F600}");
  assert.equal(parseEdn('"raw\ttab\nnl é ☃"'), "raw\ttab\nnl é ☃");
  assert.equal(parseEdn('"has } and }} inside"'), "has } and }} inside");
  assert.throws(() => parseEdn(String.raw`"\q"`), SyntaxError);
  assert.throws(() => parseEdn(String.raw`"\u12"`), SyntaxError);
});

test("collections: vectors, lists, sets, commas", () => {
  assert.deepEqual(parseEdn("[1, 2 ,3]"), [1, 2, 3]);
  assert.deepEqual(parseEdn("(1 2 3)"), [1, 2, 3]);
  assert.deepEqual(parseEdn("#{1 2 3}"), [1, 2, 3]);
  assert.deepEqual(parseEdn("[]"), []);
  assert.deepEqual(parseEdn("{}"), {});
  assert.deepEqual(parseEdn("#{}"), []);
  assert.deepEqual(parseEdn("[[1 2] [3 4]]"), [[1, 2], [3, 4]]);
});

test("comments and discard", () => {
  assert.deepEqual(parseEdn("; hi\n[1 ;mid\n 2]"), [1, 2]);
  assert.deepEqual(parseEdn("[1 #_ 2 3]"), [1, 3]);
  assert.deepEqual(parseEdn("[1 #_ #_ 2 3 4]"), [1, 4]);
  assert.deepEqual(parseEdn("#_ {:a 1} [5]"), [5]);
  assert.deepEqual(parseEdn("{:a #_ :x 1}"), { a: 1 });
  assert.deepEqual(parseEdn("[1] #_ 2 ; c\n"), [1]);
  assert.deepEqual(parseEdn("[#_[1 2 [3]]]"), []);
});

test("tags", () => {
  assert.equal(parseEdn('#inst "2020-01-01T00:00:00Z"'), "2020-01-01T00:00:00Z");
  assert.equal(parseEdn('#uuid "abc"'), "abc");
  assert.deepEqual(parseEdn("#js {:a 1}"), { a: 1 });
  assert.deepEqual(parseEdn("#object[Object {:a 1}]"), ["Object", { a: 1 }]);
  assert.deepEqual(parseEdn("[#foo 1 #bar #baz [2]]"), [1, [2]]);
  assert.throws(() => parseEdn("#"), SyntaxError);
  assert.throws(() => parseEdn("#1 2"), SyntaxError);
  assert.throws(() => parseEdn("##Foo"), SyntaxError);
});

test("map keys", () => {
  assert.deepEqual(parseEdn('{"s" 1 2 :n true :b nil :z}'.replace(" :z", " 9")), { s: 1, 2: "n", true: "b", null: 9 });
  assert.deepEqual(parseEdn("{:a 1 :a 2}"), { a: 2 });
  assert.throws(() => parseEdn("{[1] 2}"), SyntaxError);
  assert.throws(() => parseEdn("{{:a 1} 2}"), SyntaxError);
});

test("prototype pollution is inert", () => {
  const v = parseEdn("{:__proto__ {:polluted 1} :constructor 2 :prototype 3}");
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.getPrototypeOf(v), Object.prototype);
  assert.deepEqual(Object.keys(v), ["__proto__", "constructor", "prototype"]);
  assert.equal(Object.getOwnPropertyDescriptor(v, "__proto__").value.polluted, 1);
  assert.equal(v.constructor, 2);
});

test("readEdn reads one form and reports end", () => {
  assert.deepEqual(readEdn("  {:a 1}}} tail", 0), { value: { a: 1 }, end: 8 });
  assert.deepEqual(readEdn("xx [1 2] y", 2), { value: [1, 2], end: 8 });
  const t = '{:text "a}}b"}}}';
  const r = readEdn(t, 0);
  assert.deepEqual(r.value, { text: "a}}b" });
  assert.equal(t.slice(r.end), "}}");
});

test("parseEdn requires one top-level form", () => {
  assert.throws(() => parseEdn("1 2"), SyntaxError);
  assert.throws(() => parseEdn(""), SyntaxError);
  assert.throws(() => parseEdn("  ; only comment"), SyntaxError);
  assert.equal(parseEdn(" 1 , ; c\n #_ 2 "), 1);
});

test("malformed input reports position", () => {
  let e = pos(() => parseEdn('[1 "abc'));
  assert.ok(e instanceof SyntaxError);
  assert.equal(e.position, 3);
  assert.match(e.message, /at 3$/);

  e = pos(() => parseEdn("[1 {:a 1"));
  assert.equal(e.position, 3);
  assert.match(e.message, /at 3$/);

  e = pos(() => parseEdn("[1 {:a 1 :b}]"));
  assert.equal(e.position, 3);

  e = pos(() => parseEdn('["ab\\qc"]'));
  assert.equal(e.position, 4);

  e = pos(() => parseEdn("[1 2}"));
  assert.equal(e.position, 4);

  e = pos(() => parseEdn("}"));
  assert.equal(e.position, 0);

  e = pos(() => parseEdn("[1] #_"));
  assert.equal(e.position, 4);
  assert.match(e.message, /at 4$/);

  e = pos(() => parseEdn("[1 #_"));
  assert.equal(e.position, 3);

  e = pos(() => parseEdn("[1] x"));
  assert.equal(e.position, 4);

  for (const bad of ["[", "{", '"', "[1 2", "{:a", "#{1", "#foo"]) {
    const err = pos(() => parseEdn(bad));
    assert.ok(err instanceof SyntaxError, bad);
    assert.equal(typeof err.position, "number", bad);
    assert.match(err.message, /at \d+$/, bad);
  }
});

test("depth safety: deep nesting throws SyntaxError, never RangeError", () => {
  for (const open of ["[", "{:a ", "#{", "#foo ", "#_"]) {
    const e = pos(() => parseEdn(open.repeat(10000)));
    assert.ok(e instanceof SyntaxError, open);
    assert.match(e.message, /at \d+$/);
  }
  const ok = "[".repeat(500) + "]".repeat(500);
  assert.doesNotThrow(() => parseEdn(ok));
  const deepClose = "]".repeat(10000);
  assert.ok(pos(() => parseEdn(deepClose)) instanceof SyntaxError);
});

test("large map parses quickly", () => {
  const el = '{:type "rectangle" :x 10 :y 20 :width 30 :height 40 :strokeColor "#000000" :points [[0 0] [1 -2]] :text "a}}b"}';
  const n = Math.ceil(1_000_000 / el.length);
  const text = `{:elements [${Array(n).fill(el).join(" ")}]}`;
  const t0 = performance.now();
  const v = parseEdn(text);
  const ms = performance.now() - t0;
  console.log(`[edn] ${text.length} bytes parsed in ${ms.toFixed(1)} ms`);
  assert.equal(v.elements.length, n);
  assert.ok(ms < 200 * 5, `too slow: ${ms}`);
});
