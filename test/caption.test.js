import test from "node:test";
import assert from "node:assert/strict";
import { captionFromElements, captionRefsFromElements, captionRefsInfo } from "../src/model/caption.js";

const text = (id, t, extra = {}) => ({ id, type: "text", text: t, ...extra });

test("collects text by id and containerId in scene order", () => {
  const els = [text("t1", "First"), { id: "r", type: "rectangle" }, text("t2", "Boxed", { containerId: "r" }), text("t3", "Other")];
  assert.equal(captionFromElements(els, ["r", "t1"]), "First ; Boxed");
});

test("strips braces and backticks, collapses whitespace", () => {
  const els = [text("t1", "  a {{b}}\n`c`   d ")];
  assert.equal(captionFromElements(els, ["t1"]), "a b c d");
});

test("skips deleted, empty, and non-text elements", () => {
  const els = [text("t1", "gone", { isDeleted: true }), text("t2", "{}"), { id: "t3", type: "rectangle", text: "x" }];
  assert.equal(captionFromElements(els, ["t1", "t2", "t3"]), "");
});

test("caps at 200 characters", () => {
  const out = captionFromElements([text("t1", "x".repeat(500))], ["t1"]);
  assert.equal(out.length, 200);
});

test("bad inputs give empty string", () => {
  assert.equal(captionFromElements(null, ["a"]), "");
  assert.equal(captionFromElements([], null), "");
});

const mm = (id, uid) => ({ id, type: "rectangle", customData: { plexus: { mm: { uid } } } });

test("refs: mind-map node gives its outline uid; bound text is not repeated", () => {
  const els = [mm("pmm-3NChDbxPu-h6dynpr9M", "h6dynpr9M"), text("pmm-3NChDbxPu-h6dynpr9M-t", "Child two", { containerId: "pmm-3NChDbxPu-h6dynpr9M" })];
  assert.equal(captionRefsFromElements(els, ["pmm-3NChDbxPu-h6dynpr9M"]), "((h6dynpr9M))");
});

test("refs: text selected without its container uses the container ref", () => {
  const els = [mm("n1", "abcdefghi"), text("n1-t", "Child", { containerId: "n1" })];
  assert.equal(captionRefsFromElements(els, ["n1-t"]), "((abcdefghi))");
});

test("refs: embed customData and link elements", () => {
  const els = [
    { id: "e1", type: "rectangle", customData: { plexus: { embed: "((embedUid1))" } } },
    { id: "e2", type: "rectangle", customData: { plexus: { embed: "[[My Page]]" } } },
    { id: "l1", type: "rectangle", link: "((linkUid01))" },
    { id: "l2", type: "text", text: "x", link: "[[Other]]" },
    { id: "l3", type: "rectangle", link: "https://example.com" },
  ];
  assert.equal(captionRefsFromElements(els, ["e1", "e2", "l1", "l2", "l3"]), "((embedUid1)) · [[My Page]] · ((linkUid01)) · [[Other]]");
});

test("refs: mixed ordering, plain text, and de-duplication", () => {
  const els = [text("t1", "Plain"), mm("n1", "abcdefghi"), mm("n2", "abcdefghi"), { id: "l", type: "rectangle", link: "((zzzzzzzzz))" }, text("t2", "Plain")];
  assert.equal(captionRefsFromElements(els, ["t1", "n1", "n2", "l", "t2"]), "((abcdefghi)) · ((zzzzzzzzz)) · Plain");
});

test("refs: cap never cuts a ref in half", () => {
  const els = [text("t1", "x".repeat(190)), mm("n1", "abcdefghi")];
  assert.equal(captionRefsFromElements(els, ["t1", "n1"]), `((abcdefghi)) · ${"x".repeat(60)}`);
  const refs = Array.from({ length: 30 }, (_, i) => mm(`n${i}`, `uid${String(i).padStart(6, "0")}`));
  const out = captionRefsFromElements(refs, refs.map((r) => r.id));
  assert.ok(out.length <= 200);
  assert.ok(out.split(" · ").every((p) => /^\(\(uid\d{6}\)\)$/.test(p)));
});

test("refs: no refs behaves like captionFromElements", () => {
  const els = [text("t1", "First"), { id: "r", type: "rectangle" }, text("t2", "Boxed", { containerId: "r" })];
  assert.equal(captionRefsFromElements(els, ["r", "t1"]), "Boxed · First");
  assert.equal(captionFromElements(els, ["r", "t1"]), "First ; Boxed");
  assert.equal(captionRefsFromElements(null, ["a"]), "");
});

const at = (id, t, x, y, extra = {}) => text(id, t, { x, y, width: 80, height: 20, ...extra });

test("REF-15: visual order, rows then x", () => {
  const els = [at("c", "Third", 0, 100), at("b", "Second", 200, 2), at("a", "First", 0, 0)];
  assert.equal(captionRefsFromElements(els, ["a", "b", "c"]), "First · Second · Third");
});

test("REF-15: container labels come before free text; refs before both", () => {
  const els = [
    at("free", "Loose note", 0, 0),
    { id: "box", type: "rectangle", x: 0, y: 200, width: 100, height: 40 },
    at("lab", "Boxed label", 0, 200, { containerId: "box" }),
    mm("n1", "abcdefghi"),
  ];
  const info = captionRefsInfo(els, ["free", "box", "n1"]);
  assert.equal(info.caption, "((abcdefghi)) · Boxed label · Loose note");
  assert.equal(info.hasRef, true);
});

test("REF-15: drops numbers, single characters and arrows; keeps numerics when nothing else remains", () => {
  const els = [at("a", "12", 0, 0), at("b", "A", 0, 30), at("c", "->", 0, 60), at("d", "3.5", 0, 90), at("e", "Drain", 0, 120)];
  assert.equal(captionRefsFromElements(els, ["a", "b", "c", "d", "e"]), "Drain");
  assert.equal(captionRefsFromElements(els.slice(0, 4), ["a", "b", "c", "d"]), "12 · 3.5");
  assert.equal(captionRefsFromElements([at("x", "\u2192", 0, 0), at("y", "Z", 0, 30)], ["x", "y"]), "");
});

test("REF-15: first sentence only", () => {
  assert.equal(captionRefsFromElements([at("a", "Floor drain. Check weekly! Ok", 0, 0)], ["a"]), "Floor drain.");
  assert.equal(captionRefsFromElements([at("a", "Rev 3.5 mm here", 0, 0)], ["a"]), "Rev 3.5 mm here");
});

test("REF-15: 60 character word budget, refs excluded, cut at a word boundary", () => {
  const a = at("a", "alpha ".repeat(6).trim(), 0, 0);
  const b = at("b", "beta gamma delta epsilon zeta eta theta iota kappa", 0, 40);
  const c = at("c", "dropped", 0, 80);
  const out = captionRefsFromElements([mm("n1", "abcdefghi"), a, b, c], ["n1", "a", "b", "c"]);
  const [ref, first, second, ...rest] = out.split(" · ");
  assert.equal(ref, "((abcdefghi))");
  assert.equal(first, a.text);
  assert.equal(rest.length, 0);
  assert.ok(first.length + second.length <= 60);
  assert.ok(!second.endsWith(" "));
  assert.ok("beta gamma delta epsilon zeta eta theta iota kappa".startsWith(second));
  assert.ok(!/dropped/.test(out));
});

test("REF-15: a lone overlong word is hard cut at 60", () => {
  assert.equal(captionRefsFromElements([at("a", "x".repeat(100), 0, 0)], ["a"]), "x".repeat(60));
});

test("REF-15: frame name replaces the words, refs stay first", () => {
  const els = [at("a", "Some text", 0, 0), mm("n1", "abcdefghi")];
  assert.equal(captionRefsFromElements(els, ["a", "n1"], { frameName: "Line 2 map" }), "((abcdefghi)) · Line 2 map");
  assert.equal(captionRefsFromElements(els, ["a"], { frameName: "  " }), "Some text");
});

test("REF-15: words:false keeps refs only", () => {
  const els = [at("a", "Some text", 0, 0), mm("n1", "abcdefghi")];
  assert.equal(captionRefsFromElements(els, ["a", "n1"], { words: false }), "((abcdefghi))");
  assert.deepEqual(captionRefsInfo(els, ["a"], { words: false }), { caption: "", hasRef: false });
  assert.equal(captionRefsFromElements(els, ["a", "n1"], { words: false, frameName: "Frame X" }), "((abcdefghi))");
});

test("REF-15: identical rows are transitive and stable when y-centres are close", () => {
  const els = [at("a", "Right", 300, 4), at("b", "Left", 0, 0), at("c", "Mid", 150, 8)];
  assert.equal(captionRefsFromElements(els, ["a", "b", "c"]), "Left · Mid · Right");
});

test("REF-15: total stays within 200 characters", () => {
  const refs = Array.from({ length: 30 }, (_, i) => mm(`n${i}`, `uid${String(i).padStart(6, "0")}`));
  const words = [at("w", "hello world", 0, 0)];
  const out = captionRefsFromElements([...refs, ...words], [...refs.map((r) => r.id), "w"]);
  assert.ok(out.length <= 200);
  assert.ok(!out.includes("hello"));
});
