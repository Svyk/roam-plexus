import test from "node:test";
import assert from "node:assert/strict";
import { findTokens, alignWrapped } from "../src/model/tokens.js";

const brief = (text, opts) => findTokens(text, opts).map((t) => [t.kind, t.title ?? t.uid, t.start, t.end]);

test("page refs, tags and block refs in order", () => {
  const s = "see [[Alpha]] and #beta then ((abcdefghi)) #[[Gamma Delta]]";
  assert.deepEqual(brief(s), [
    ["page", "Alpha", 4, 13],
    ["tag", "beta", 18, 23],
    ["block", "abcdefghi", 29, 42],
    ["tag", "Gamma Delta", 43, 59],
  ]);
});

test("nested page refs stay in the outer title; nested option lists the inner one", () => {
  const s = "[[a [[b]] c]]";
  assert.deepEqual(brief(s), [["page", "a [[b]] c", 0, 13]]);
  assert.deepEqual(brief(s, { nested: true }), [["page", "a [[b]] c", 0, 13], ["page", "b", 4, 9]]);
});

test("tags and block refs inside a page title are literal text, even with nested", () => {
  assert.deepEqual(brief("[[Issue #42 fix]]", { nested: true }), [["page", "Issue #42 fix", 0, 17]]);
  assert.deepEqual(brief("[[See ((abcdefghi)) x]]", { nested: true }), [["page", "See ((abcdefghi)) x", 0, 23]]);
  assert.deepEqual(brief("#[[a #b [[c]]]]", { nested: true }).map((t) => t[1]), ["a #b [[c]]", "c"]);
});

test("tag characters: unicode and slash; a trailing dot stays, a trailing colon is excluded", () => {
  assert.deepEqual(brief("#проект/сегодня. и #naïve: x #a-b.c"), [
    ["tag", "проект/сегодня.", 0, 16],
    ["tag", "naïve", 19, 25],
    ["tag", "a-b.c", 29, 35],
  ]);
});

test("Roam corpus: a tag may follow a word character; trailing dot kept", () => {
  assert.deepEqual(brief("word#notag").map((t) => t[1]), ["notag"]);
  assert.deepEqual(brief("abc#def x#y (#ok)").map((t) => t[1]), ["def", "y", "ok"]);
  assert.deepEqual(brief("#tag.").map((t) => t[1]), ["tag."]);
  assert.deepEqual(brief("#tag:with").map((t) => t[1]), ["tag:with"]);
  assert.deepEqual(brief("(#tag)").map((t) => t[1]), ["tag"]);
  assert.deepEqual(brief("#a/b").map((t) => t[1]), ["a/b"]);
  assert.deepEqual(brief("#Ünïcode").map((t) => t[1]), ["Ünïcode"]);
  assert.deepEqual(brief("#123").map((t) => t[1]), ["123"]);
});

test("an email address is not a token", () => {
  assert.deepEqual(findTokens("email a@b.com"), []);
});

test("code, URLs and {{...}} are masked", () => {
  assert.deepEqual(brief("`[[no]]` https://roamresearch.com/#/app/x {{[[TODO]]}} ```\n#code\n``` [[yes]]").map((t) => t[1]), ["yes"]);
});

test("alias forms target the inner ref", () => {
  assert.deepEqual(brief("[go]([[Page One]]) and [ref](((abcdefghi))) end"), [
    ["page", "Page One", 0, 18],
    ["block", "abcdefghi", 23, 43],
  ]);
});

test("tokens never overlap", () => {
  const toks = findTokens("[[a #b]] #c ((abcdefghi)) [x]([[y]]) #[[z]]");
  for (let i = 1; i < toks.length; i++) assert.ok(toks[i].start >= toks[i - 1].end);
});

test("unbalanced and empty refs produce nothing", () => {
  assert.deepEqual(findTokens("[[open and ((short)) [[]] ##"), []);
  assert.deepEqual(findTokens(""), []);
  assert.deepEqual(findTokens(null), []);
});

test("alignWrapped maps wrapped text back to the original", () => {
  const map = alignWrapped("hello\nworld", "hello world");
  assert.equal(map[5], 5);
  assert.equal(map[6], 6);
  assert.equal(map[10], 10);
  assert.equal(map[11], 11);
});

test("alignWrapped: newline against a non-space advances text only (long word break)", () => {
  const map = alignWrapped("abc\ndef", "abcdef");
  assert.equal(map[3], 3);
  assert.equal(map[4], 3);
  assert.equal(map[6], 5);
});

test("alignWrapped skips doubled spaces at a wrap point", () => {
  const map = alignWrapped("aa\nbb", "aa  bb");
  assert.equal(map[3], 4);
  assert.equal(map[4], 5);
});

test("alignWrapped returns null on a real mismatch", () => {
  assert.equal(alignWrapped("abc", "xyz"), null);
  assert.equal(alignWrapped("abcd", "abc"), null);
});
