import assert from "node:assert/strict";
import test from "node:test";

import { openOutlinePreview } from "../src/view/outline-preview.js";

function node(tag) {
  const n = {
    tag, children: [], handlers: {}, attrs: {}, className: "", disabled: false, removed: false, style: {}, focused: false,
    append(...c) { this.children.push(...c); },
    addEventListener(t, f) { this.handlers[t] = f; },
    removeEventListener(t) { delete this.handlers[t]; },
    setAttribute(k, v) { this.attrs[k] = v; },
    remove() { this.removed = true; },
    focus() { this.focused = true; },
  };
  Object.defineProperty(n, "innerHTML", { set() { throw new Error("innerHTML is forbidden"); } });
  return n;
}
function fakeDoc() {
  const body = { children: [], append(x) { this.children.push(x); } };
  const canvas = node("canvas");
  return { body, canvas, activeElement: canvas, createElement: (tag) => node(tag) };
}
const flat = (n) => [n, ...(n.children || []).flatMap((c) => (typeof c === "object" ? flat(c) : []))];
const btn = (root, label) => flat(root).find((n) => n.tag === "button" && n.textContent === label);
const texts = (root) => flat(root).map((n) => n.textContent).filter(Boolean);

test("lists headings and counts with textContent only, above the given z-index", () => {
  const doc = fakeDoc();
  const h = openOutlinePreview({ doc, zIndex: 100, headings: ["Intro", "<b>x</b>"], count: 61, replacing: 0 });
  const root = doc.body.children[0];
  assert.equal(root, h.el);
  assert.equal(root.style.zIndex, "102");
  assert.equal(root.attrs.role, "dialog");
  assert.ok(texts(root).includes("61 blocks will be written."));
  assert.ok(texts(root).includes("<b>x</b>"));
  assert.ok(texts(root).includes("Intro"));
  assert.equal(btn(root, "Write outline").focused, true);
});

test("summary names how many blocks a re-run replaces; no headings shows the flat note", () => {
  const doc = fakeDoc();
  openOutlinePreview({ doc, count: 70, replacing: 12 });
  const root = doc.body.children[0];
  assert.ok(texts(root).includes("70 blocks will replace the 12 in the current outline."));
  assert.ok(texts(root).includes("No frames: one flat outline"));
});

test("Write runs onWrite once, disables itself, then closes", async () => {
  const doc = fakeDoc();
  let writes = 0, closes = 0;
  openOutlinePreview({ doc, count: 60, onWrite: async () => { writes += 1; }, onClose: () => { closes += 1; } });
  const root = doc.body.children[0];
  const w = btn(root, "Write outline");
  const p = w.handlers.click({ stopPropagation() {} });
  w.handlers.click({ stopPropagation() {} });
  await p;
  assert.equal(writes, 1);
  assert.equal(closes, 1);
  assert.equal(root.removed, true);
  assert.equal(w.disabled, true);
});

test("Cancel and Escape close without writing and return focus; keys never escape the dialog", () => {
  const doc = fakeDoc();
  let writes = 0, closes = 0;
  openOutlinePreview({ doc, count: 60, onWrite: () => { writes += 1; }, onClose: () => { closes += 1; } });
  const root = doc.body.children[0];
  const stopped = [];
  for (const type of ["keydown", "keyup", "keypress", "paste", "copy", "cut"]) assert.ok(root.handlers[type], type);
  root.handlers.keyup({ stopPropagation: () => stopped.push("up") });
  assert.deepEqual(stopped, ["up"]);
  let prevented = false;
  root.handlers.keydown({ key: "Escape", preventDefault: () => { prevented = true; }, stopPropagation() {} });
  assert.equal(prevented, true);
  assert.equal(root.removed, true);
  assert.equal(doc.canvas.focused, true);
  assert.equal(closes, 1);
  assert.equal(writes, 0);
  const again = fakeDoc();
  openOutlinePreview({ doc: again, count: 60, onClose: () => { closes += 1; } });
  btn(again.body.children[0], "Cancel").handlers.click({ stopPropagation() {} });
  assert.equal(again.body.children[0].removed, true);
  assert.equal(closes, 2);
});

test("only one preview exists at a time; close is idempotent", () => {
  const doc = fakeDoc();
  let firstCloses = 0;
  const first = openOutlinePreview({ doc, count: 60, onClose: () => { firstCloses += 1; } });
  const second = openOutlinePreview({ doc, count: 60 });
  assert.equal(doc.body.children[0].removed, true);
  assert.equal(firstCloses, 1);
  first.close();
  assert.equal(firstCloses, 1);
  second.close();
  assert.equal(doc.body.children[1].removed, true);
});

test("a throwing onWrite still closes the dialog", async () => {
  const doc = fakeDoc();
  openOutlinePreview({ doc, count: 60, onWrite: () => { throw new Error("x"); } });
  const root = doc.body.children[0];
  await btn(root, "Write outline").handlers.click({ stopPropagation() {} });
  assert.equal(root.removed, true);
});
