import test from "node:test";
import assert from "node:assert/strict";
import { captionFromElements } from "../src/model/caption.js";

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
