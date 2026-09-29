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
