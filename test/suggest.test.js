import assert from "node:assert/strict";
import test from "node:test";

import { applyPick, blockSnippet, findTrigger, matchSegments } from "../src/model/suggest.js";

test("findTrigger finds page and block triggers at the caret", () => {
  assert.deepEqual(findTrigger("see [[Plex", 10), { kind: "page", start: 4, query: "Plex" });
  assert.deepEqual(findTrigger("x ((ab", 6), { kind: "block", start: 2, query: "ab" });
  assert.deepEqual(findTrigger("[[", 2), { kind: "page", start: 0, query: "" });
});

test("findTrigger uses the caret, not the end of text", () => {
  assert.deepEqual(findTrigger("[[abc]] tail", 4), { kind: "page", start: 0, query: "ab" });
});

test("findTrigger returns null after a closer, a newer opener, or across lines", () => {
  assert.equal(findTrigger("[[a]] b", 7), null);
  assert.equal(findTrigger("((a)) b", 7), null);
  assert.equal(findTrigger("[[a\nb", 5), null);
  assert.equal(findTrigger("[[a [[b", 7).start, 4);
  assert.equal(findTrigger("no trigger", 10), null);
  assert.equal(findTrigger("[", 1), null);
  assert.equal(findTrigger("[[a", 99), null);
  assert.equal(findTrigger(null, 0), null);
});

test("findTrigger caps query length and lookback", () => {
  assert.equal(findTrigger(`[[${"a".repeat(101)}`, 103), null);
  assert.equal(findTrigger(`[[${"a".repeat(100)}`, 102).query.length, 100);
  assert.equal(findTrigger(`[[${"a ".repeat(200)}`, 402), null);
});

test("findTrigger treats a bare hash as a hash trigger", () => {
  assert.deepEqual(findTrigger("#", 1), { kind: "hash", start: 0, query: "" });
  assert.deepEqual(findTrigger("#tag", 4), { kind: "hash", start: 0, query: "tag" });
  assert.deepEqual(findTrigger("see #tag", 8), { kind: "hash", start: 4, query: "tag" });
  assert.deepEqual(findTrigger("ab#", 3), { kind: "hash", start: 2, query: "" });
  assert.equal(findTrigger("#ab c", 5), null);
  assert.equal(findTrigger("#ab ", 4), null);
  assert.equal(findTrigger("[", 1), null);
  assert.equal(findTrigger("#a]]b", 5), null);
  assert.equal(findTrigger("#a))b", 5), null);
  assert.equal(findTrigger(`#${"a".repeat(101)}`, 102), null);
  assert.equal(findTrigger(`#${"a".repeat(100)}`, 101).query.length, 100);
});

test("findTrigger keeps a hash inside an open pair and stops at a newline", () => {
  assert.deepEqual(findTrigger("[[#x", 4), { kind: "page", start: 0, query: "#x" });
  assert.deepEqual(findTrigger("((#x", 4), { kind: "block", start: 0, query: "#x" });
  assert.equal(findTrigger("[[a\nb", 5), null);
  assert.equal(findTrigger("#tag\n", 5), null);
  assert.deepEqual(findTrigger("[[a\n#b", 6), { kind: "hash", start: 4, query: "b" });
  assert.deepEqual(findTrigger("[[a]] #tag", 10), { kind: "hash", start: 6, query: "tag" });
  assert.deepEqual(findTrigger("((a)) #z", 8), { kind: "hash", start: 6, query: "z" });
  assert.equal(findTrigger(`[[${"a".repeat(99)}#z`, 103), null);
});

test("applyPick replaces the token for pages and blocks", () => {
  const t = findTrigger("see [[Plex", 10);
  assert.deepEqual(applyPick("see [[Plex", 10, t, { kind: "page", title: "Plexus" }), { text: "see [[Plexus]]", caret: 14 });
  const b = findTrigger("x ((ab", 6);
  assert.deepEqual(applyPick("x ((ab", 6, b, { kind: "block", uid: "AbC123xyz" }), { text: "x ((AbC123xyz))", caret: 15 });
});

test("applyPick consumes an existing closer directly after the caret", () => {
  const t = findTrigger("[[Plex]]", 6);
  assert.deepEqual(applyPick("[[Plex]]", 6, t, { kind: "page", title: "Plexus" }), { text: "[[Plexus]]", caret: 10 });
});

test("applyPick replaces the rest of an existing token (A10)", () => {
  const text = "[[Plexus]] x";
  const t = findTrigger(text, 6);
  assert.deepEqual(applyPick(text, 6, t, { kind: "page", title: "Plexus" }), { text: "[[Plexus]] x", caret: 10 });
  const t2 = findTrigger("[[Plex|us]] x".replace("|", ""), 6);
  assert.equal(applyPick("[[Plexus]] x", 6, t2, { kind: "page", title: "Other" }).text, "[[Other]] x");
});

test("applyPick keeps text when the closer is of the other kind or absent", () => {
  const t = findTrigger("[[ab", 4);
  assert.equal(applyPick("[[ab)) z", 4, t, { kind: "page", title: "P" }).text, "[[P]])) z");
  assert.equal(applyPick("[[ab z", 4, t, { kind: "page", title: "P" }).text, "[[P]] z");
  assert.equal(applyPick("[[ab\nrest]]", 4, t, { kind: "page", title: "P" }).text, "[[P]]\nrest]]");
});

test("applyPick writes a page alias and ignores it for hash and block picks", () => {
  const paired = findTrigger("[[]]", 2);
  assert.deepEqual(applyPick("[[]]", 2, paired, { kind: "page", title: "Title" }), { text: "[[Title]]", caret: 9 });
  assert.deepEqual(applyPick("[[]]", 2, paired, { kind: "page", title: "Title" }, "words"), { text: "[words]([[Title]])", caret: 18 });
  assert.deepEqual(applyPick("[[]]", 2, paired, { kind: "page", title: "Title" }, "  wo  rds "), { text: "[wo rds]([[Title]])", caret: 19 });
  assert.equal(applyPick("[[]]", 2, paired, { kind: "page", title: "Title" }, "word]s").text, "[[Title]]");
  assert.equal(applyPick("[[]]", 2, paired, { kind: "page", title: "Title" }, "  [x").text, "[[Title]]");
  assert.equal(applyPick("[[]]", 2, paired, { kind: "page", title: "Title" }, "").text, "[[Title]]");
  assert.equal(applyPick("[[]]", 2, paired, { kind: "page", title: "Title" }, "   ").text, "[[Title]]");
  const typed = findTrigger("see [[Plex", 10);
  assert.deepEqual(applyPick("see [[Plex", 10, typed, { kind: "page", title: "Plexus" }, "words"), { text: "see [words]([[Plexus]])", caret: 23 });
  const hash = findTrigger("#Plex", 5);
  assert.equal(applyPick("#Plex", 5, hash, { kind: "page", title: "Plexus" }, "words").text, "#[[Plexus]]");
  const block = findTrigger("x ((ab", 6);
  assert.equal(applyPick("x ((ab", 6, block, { kind: "block", uid: "AbC123xyz" }, "words").text, "x ((AbC123xyz))");
});

test("applyPick does not let a hash trigger eat a closer", () => {
  const brackets = findTrigger("#tag]]", 4);
  assert.deepEqual(applyPick("#tag]]", 4, brackets, { kind: "page", title: "Title" }), { text: "#[[Title]]]]", caret: 10 });
  const parens = findTrigger("#tag))", 4);
  assert.equal(applyPick("#tag))", 4, parens, { kind: "page", title: "Title" }).text, "#[[Title]]))");
  assert.equal(applyPick("#Plex more]]", 5, findTrigger("#Plex more]]", 5), { kind: "page", title: "Plexus" }).text, "#[[Plexus]] more]]");
});

test("matchSegments highlights each token case-insensitively", () => {
  assert.deepEqual(matchSegments("Plexus Spike", "plex spi"), [
    { text: "Plex", match: true }, { text: "us ", match: false }, { text: "Spi", match: true }, { text: "ke", match: false },
  ]);
  assert.deepEqual(matchSegments("abc", ""), [{ text: "abc", match: false }]);
  assert.deepEqual(matchSegments("abc", "zzz"), [{ text: "abc", match: false }]);
  assert.deepEqual(matchSegments("", "a"), [{ text: "", match: false }]);
});

test("matchSegments merges overlapping and repeated matches", () => {
  assert.deepEqual(matchSegments("abcabc", "abc bc"), [{ text: "abcabc", match: true }]);
  assert.deepEqual(matchSegments("aXa", "a"), [{ text: "a", match: true }, { text: "X", match: false }, { text: "a", match: true }]);
});

test("blockSnippet flattens newlines and trims around the first match", () => {
  assert.equal(blockSnippet("one\ntwo\n  three", "x"), "one two three");
  assert.equal(blockSnippet("short", "s"), "short");
  const long = `${"a".repeat(200)}NEEDLE${"b".repeat(200)}`;
  const s = blockSnippet(long, "needle", 60);
  assert.ok(s.startsWith("…") && s.endsWith("…"));
  assert.ok(s.includes("NEEDLE"));
  assert.equal(s.length, 62);
});

test("blockSnippet with no match keeps the head, and the tail match keeps the tail", () => {
  const long = "x".repeat(300);
  const head = blockSnippet(long, "zzz", 50);
  assert.ok(!head.startsWith("…") && head.endsWith("…"));
  const tail = blockSnippet(`${"y".repeat(300)}END`, "end", 50);
  assert.ok(tail.startsWith("…") && !tail.endsWith("…") && tail.endsWith("END"));
});

import { buildPageRows, normalizeCreateTitle, stripTrigger } from "../src/model/suggest.js";

test("stripTrigger removes the trigger, query and closer tail", () => {
  assert.deepEqual(stripTrigger("see [[Plex", 10, { kind: "page", start: 4, query: "Plex" }), { text: "see ", caret: 4 });
  assert.deepEqual(stripTrigger("a [[Pl]] b", 6, { kind: "page", start: 2, query: "Pl" }), { text: "a  b", caret: 2 });
  assert.deepEqual(stripTrigger("x ((ab)) y", 6, { kind: "block", start: 2, query: "ab" }), { text: "x  y", caret: 2 });
});

test("normalizeCreateTitle trims, collapses spaces and rejects unsafe titles", () => {
  assert.equal(normalizeCreateTitle("  a   b "), "a b");
  assert.equal(normalizeCreateTitle("a [[b"), "");
  assert.equal(normalizeCreateTitle("a]]"), "");
  assert.equal(normalizeCreateTitle("x".repeat(251)), "");
  assert.equal(normalizeCreateTitle("x".repeat(250)).length, 250);
  assert.equal(normalizeCreateTitle("   "), "");
});

const P = (title, uid = title) => ({ kind: "page", title, uid });
const titles = (rows) => rows.map((r) => `${r.kind}:${r.title}`);

test("buildPageRows orders exact, date, results, create", () => {
  const rows = buildPageRows({ query: "tomorrow", results: [P("Tomorrow plans"), P("tomorrow")], dateTitle: "September 30th, 2026", canCreate: true });
  assert.deepEqual(titles(rows), ["page:tomorrow", "date:September 30th, 2026", "page:Tomorrow plans"]);
});

test("buildPageRows adds a create row last, never when the title exists", () => {
  assert.deepEqual(titles(buildPageRows({ query: "New  thing", results: [P("New thing two")], canCreate: true })), ["page:New thing two", "create:New thing"]);
  assert.deepEqual(titles(buildPageRows({ query: "new thing", results: [P("New Thing")], canCreate: true })), ["page:New Thing"]);
  assert.deepEqual(titles(buildPageRows({ query: "new thing", results: [], canCreate: true, exists: true })), []);
  assert.deepEqual(titles(buildPageRows({ query: "a[[b", results: [], canCreate: true })), []);
  assert.deepEqual(titles(buildPageRows({ query: "solo", results: [], canCreate: false })), []);
  assert.deepEqual(titles(buildPageRows({ query: "solo", results: [], canCreate: true })), ["create:solo"]);
});

test("buildPageRows puts a three-letter abbreviation date row after results that prefix it", () => {
  const rows = buildPageRows({ query: "sat", results: [P("Saturn notes")], dateTitle: "October 3rd, 2026", canCreate: true });
  assert.deepEqual(titles(rows), ["page:Saturn notes", "date:October 3rd, 2026", "create:sat"]);
  const other = buildPageRows({ query: "sat", results: [P("Weekend")], dateTitle: "October 3rd, 2026" });
  assert.deepEqual(titles(other), ["date:October 3rd, 2026", "page:Weekend"]);
});

test("buildPageRows drops a result that duplicates the date row", () => {
  const rows = buildPageRows({ query: "today", results: [P("September 29th, 2026")], dateTitle: "September 29th, 2026", canCreate: true });
  assert.deepEqual(titles(rows), ["date:September 29th, 2026", "create:today"]);
});
