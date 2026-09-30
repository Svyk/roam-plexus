import assert from "node:assert/strict";
import test from "node:test";

import { openNamePrompt } from "../src/view/name-prompt.js";

class El extends EventTarget {
  constructor(tag) {
    super();
    this.tag = tag;
    this.children = [];
    this.style = {};
    this.className = "";
    this.textContent = "";
    this.value = "";
    this.attrs = {};
  }
  append(...nodes) { this.children.push(...nodes); }
  remove() { this.removed = true; }
  focus() { this.focused = true; }
  select() { this.selected = true; }
  setAttribute(k, v) { this.attrs[k] = v; }
}
const find = (root, cls) => {
  if (root.className.split(" ").includes(cls)) return root;
  for (const c of root.children) { const f = find(c, cls); if (f) return f; }
  return null;
};
const buttons = (root) => { const out = []; const walk = (n) => { if (n.tag === "button") out.push(n); n.children.forEach(walk); }; walk(root); return out; };
const key = (k, extra = {}) => Object.assign(new Event("keydown", { cancelable: true, bubbles: true }), { key: k, ...extra });
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(opts = {}) {
  const doc = { body: new El("body"), createElement: (t) => new El(t) };
  const submitted = [];
  const closed = [];
  const handle = openNamePrompt({ doc, zIndex: 555, title: "Save selection as template", onSubmit: (v) => { submitted.push(v); return opts.onSubmit?.(v); }, onClose: () => closed.push(1) });
  const root = doc.body.children[0];
  return { doc, handle, root, input: find(root, "plexus-name-input"), error: find(root, "plexus-name-error"), submitted, closed };
}

test("opens at the z-index with the input focused and selected, and never with the caption-prompt class", () => {
  const s = setup();
  assert.match(s.root.className, /plexus-portal plexus-name-prompt/);
  assert.equal(s.root.style.zIndex, "555");
  assert.equal(s.input.focused, true);
  assert.equal(s.input.maxLength, 60);
  assert.ok(!s.input.className.includes("plexus-mm-input"));
  assert.ok(!s.root.className.includes("plexus-mm-input"));
  assert.equal(find(s.root, "plexus-name-title").textContent, "Save selection as template");
});

test("Enter submits the raw value and closes", async () => {
  const s = setup();
  s.input.value = "  My flow ";
  const e = key("Enter");
  s.input.dispatchEvent(e);
  await tick();
  assert.deepEqual(s.submitted, ["  My flow "]);
  assert.equal(e.defaultPrevented, true);
  assert.equal(s.root.removed, true);
  assert.equal(s.closed.length, 1);
});

test("blur does nothing: the prompt stays open and submits nothing", async () => {
  const s = setup();
  s.input.value = "half typed";
  s.input.dispatchEvent(new Event("blur"));
  s.input.dispatchEvent(new Event("focusout"));
  await tick();
  assert.equal(s.submitted.length, 0);
  assert.equal(s.handle.isOpen(), true);
});

test("Escape and Cancel close without submitting", async () => {
  const s = setup();
  s.input.value = "x";
  s.input.dispatchEvent(key("Escape"));
  assert.equal(s.closed.length, 1);
  assert.equal(s.submitted.length, 0);
  s.input.dispatchEvent(key("Escape"));
  assert.equal(s.closed.length, 1);
  const s2 = setup();
  buttons(s2.root).find((b) => b.textContent === "Cancel").dispatchEvent(new Event("click"));
  assert.equal(s2.closed.length, 1);
  assert.equal(s2.submitted.length, 0);
});

test("Save button submits; a throwing onSubmit keeps the prompt open with the message, then a retry works", async () => {
  let fail = true;
  const s = setup({ onSubmit: () => { if (fail) throw new Error("A template with that name exists"); } });
  s.input.value = "Dup";
  buttons(s.root).find((b) => b.textContent === "Save").dispatchEvent(new Event("click"));
  await tick();
  assert.equal(s.error.textContent, "A template with that name exists");
  assert.equal(s.handle.isOpen(), true);
  assert.equal(s.closed.length, 0);
  fail = false;
  s.input.value = "Unique";
  s.input.dispatchEvent(key("Enter"));
  await tick();
  assert.deepEqual(s.submitted, ["Dup", "Unique"]);
  assert.equal(s.closed.length, 1);
  assert.equal(s.error.textContent, "");
});

test("an async rejection is shown too, and a second Enter while it runs does not submit twice", async () => {
  let release;
  const s = setup({ onSubmit: () => new Promise((_, reject) => { release = () => reject(new Error("slow no")); }) });
  s.input.value = "a";
  s.input.dispatchEvent(key("Enter"));
  s.input.dispatchEvent(key("Enter"));
  assert.equal(s.submitted.length, 1);
  release();
  await tick();
  assert.equal(s.error.textContent, "slow no");
  assert.equal(s.handle.isOpen(), true);
});

test("IME composition Enter and Escape are ignored; key events do not escape to the page", () => {
  const s = setup();
  const outer = [];
  for (const t of ["keydown", "keyup", "keypress", "paste", "input"]) s.doc.body.addEventListener(t, () => outer.push(t));
  s.input.dispatchEvent(key("Enter", { isComposing: true }));
  s.input.dispatchEvent(key("Escape", { keyCode: 229 }));
  assert.equal(s.submitted.length, 0);
  assert.equal(s.handle.isOpen(), true);
  for (const t of ["keydown", "keyup", "keypress", "paste", "input"]) {
    const e = new Event(t, { bubbles: true, cancelable: true });
    s.input.dispatchEvent(e);
    assert.equal(e.cancelBubble, true, t);
  }
});

test("opening a second prompt closes the first; close removes the listeners", () => {
  const doc = { body: new El("body"), createElement: (t) => new El(t) };
  const a = openNamePrompt({ doc });
  const b = openNamePrompt({ doc });
  assert.equal(a.isOpen(), false);
  assert.equal(b.isOpen(), true);
  b.close();
  assert.equal(b.isOpen(), false);
  assert.equal(doc.body.children[1].removed, true);
});

test("Enter on the focused Cancel button does not save", async () => {
  const s = setup();
  s.input.value = "Mine";
  const cancel = buttons(s.root).find((b) => b.textContent === "Cancel");
  assert.ok(cancel);
  const e = key("Enter");
  Object.defineProperty(e, "target", { value: cancel });
  s.root.dispatchEvent(e);
  await tick();
  assert.deepEqual(s.submitted, []);
  assert.equal(e.defaultPrevented, false, "the button keeps its native click");
});
