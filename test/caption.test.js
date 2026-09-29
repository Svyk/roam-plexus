import test from "node:test";
import assert from "node:assert/strict";
import { captionFromElements, captionRefsFromElements } from "../src/model/caption.js";

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
  assert.equal(captionRefsFromElements(els, ["e1", "e2", "l1", "l2", "l3"]), "((embedUid1)) ; [[My Page]] ; ((linkUid01)) ; [[Other]]");
});

test("refs: mixed ordering, plain text, and de-duplication", () => {
  const els = [text("t1", "Plain"), mm("n1", "abcdefghi"), mm("n2", "abcdefghi"), { id: "l", type: "rectangle", link: "((zzzzzzzzz))" }, text("t2", "Plain")];
  assert.equal(captionRefsFromElements(els, ["t1", "n1", "n2", "l", "t2"]), "Plain ; ((abcdefghi)) ; ((zzzzzzzzz))");
});

test("refs: cap never cuts a ref in half", () => {
  const els = [text("t1", "x".repeat(190)), mm("n1", "abcdefghi")];
  assert.equal(captionRefsFromElements(els, ["t1", "n1"]), "x".repeat(190));
  const refs = Array.from({ length: 30 }, (_, i) => mm(`n${i}`, `uid${String(i).padStart(6, "0")}`));
  const out = captionRefsFromElements(refs, refs.map((r) => r.id));
  assert.ok(out.length <= 200);
  assert.ok(out.split(" ; ").every((p) => /^\(\(uid\d{6}\)\)$/.test(p)));
});

test("refs: no refs behaves like captionFromElements", () => {
  const els = [text("t1", "First"), { id: "r", type: "rectangle" }, text("t2", "Boxed", { containerId: "r" })];
  assert.equal(captionRefsFromElements(els, ["r", "t1"]), captionFromElements(els, ["r", "t1"]));
  assert.equal(captionRefsFromElements(null, ["a"]), "");
});
