import assert from "node:assert/strict";
import test from "node:test";

import { openChartDialog } from "../src/view/chart-dialog.js";

class El extends EventTarget {
  constructor(tag) {
    super();
    this.tag = tag;
    this.children = [];
    this.style = {};
    this.className = "";
    this.textContent = "";
    this.value = "";
    this.files = [];
  }
  append(...nodes) { this.children.push(...nodes); }
  remove() { this.removed = true; }
  focus() { this.focused = true; }
  click() { this.clicked = true; }
}
const find = (root, cls) => {
  if (root.className.split(" ").includes(cls)) return root;
  for (const c of root.children) { const f = find(c, cls); if (f) return f; }
  return null;
};
const findTag = (root, tag) => (root.tag === tag ? root : root.children.map((c) => findTag(c, tag)).find(Boolean) || null);
const buttons = (root) => { const out = []; const walk = (n) => { if (n.tag === "button") out.push(n); n.children.forEach(walk); }; walk(root); return out; };
const key = (k, extra = {}) => Object.assign(new Event("keydown", { cancelable: true, bubbles: true }), { key: k, ...extra });

function setup(opts = {}) {
  const doc = { body: new El("body"), createElement: (t) => new El(t) };
  const calls = [];
  const closed = [];
  const handle = openChartDialog({ doc, zIndex: 100, onInsert: (v) => { calls.push(v); return opts.onInsert?.(v); }, onClose: () => closed.push(1), FileReaderCtor: opts.FileReaderCtor });
  const root = doc.body.children[0];
  return { doc, handle, root, calls, closed, area: find(root, "plexus-chart-text"), error: find(root, "plexus-chart-error") };
}

test("opens on body at zIndex + 2 with the textarea focused and tree selected", () => {
  const s = setup();
  assert.match(s.root.className, /plexus-portal plexus-chart-dialog/);
  assert.equal(s.root.style.zIndex, "102");
  assert.equal(s.area.focused, true);
  assert.equal(find(s.root, "plexus-chart-layout").value, "tree");
});

test("Insert sends the text and layout, then closes", async () => {
  const s = setup();
  s.area.value = ' {"nodes": []} ';
  find(s.root, "plexus-chart-layout").value = "fishbone";
  buttons(s.root).find((b) => b.textContent === "Insert").dispatchEvent(new Event("click"));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(s.calls, [{ text: '{"nodes": []}', layout: "fishbone" }]);
  assert.equal(s.root.removed, true);
  assert.equal(s.closed.length, 1);
  assert.equal(s.handle.isOpen(), false);
});

test("empty text shows a message and does not call onInsert", async () => {
  const s = setup();
  buttons(s.root).find((b) => b.textContent === "Insert").dispatchEvent(new Event("click"));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(s.calls.length, 0);
  assert.match(s.error.textContent, /Paste the chart JSON/);
  assert.equal(s.root.removed, undefined);
});

test("a throwing onInsert keeps the dialog open and shows the message", async () => {
  const s = setup({ onInsert: () => { throw new Error("Invalid JSON: x"); } });
  s.area.value = "{";
  buttons(s.root).find((b) => b.textContent === "Insert").dispatchEvent(new Event("click"));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(s.error.textContent, "Invalid JSON: x");
  assert.equal(s.handle.isOpen(), true);
  assert.equal(s.closed.length, 0);
});

test("Escape and Cancel close once", () => {
  const s = setup();
  const e = key("Escape");
  s.root.dispatchEvent(e);
  assert.equal(e.defaultPrevented, true);
  assert.equal(s.closed.length, 1);
  s.handle.close();
  assert.equal(s.closed.length, 1);
  const t = setup();
  buttons(t.root).find((b) => b.textContent === "Cancel").dispatchEvent(new Event("click"));
  assert.equal(t.closed.length, 1);
});

test("Cmd+Enter inserts", async () => {
  const s = setup();
  s.area.value = "{}";
  s.root.dispatchEvent(key("Enter", { metaKey: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(s.calls.length, 1);
});

test("key and clipboard events stop at the dialog root", () => {
  const s = setup();
  const seen = [];
  const outer = new EventTarget();
  for (const type of ["keydown", "keyup", "keypress", "paste", "copy", "cut"]) {
    s.area.addEventListener(type, (e) => e.stopPropagation?.(), { once: false });
    outer.addEventListener(type, () => seen.push(type));
  }
  for (const type of ["keydown", "keyup", "keypress", "paste", "copy", "cut"]) {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    let stopped = false;
    ev.stopPropagation = () => { stopped = true; };
    s.root.dispatchEvent(ev);
    assert.equal(stopped, true, type);
  }
  assert.deepEqual(seen, []);
});

test("Choose file reads through FileReader into the textarea", () => {
  class FR { readAsText(f) { this.result = `read:${f.name}`; this.onload(); } }
  const s = setup({ FileReaderCtor: FR });
  const input = findTag(s.root, "input");
  assert.equal(input.accept, ".json,application/json");
  buttons(s.root).find((b) => b.textContent.startsWith("Choose file")).dispatchEvent(new Event("click"));
  assert.equal(input.clicked, true);
  input.files = [{ name: "c.json" }];
  input.dispatchEvent(new Event("change"));
  assert.equal(s.area.value, "read:c.json");
});

test("a second dialog replaces the first; close removes the listeners", () => {
  const s = setup();
  const doc2 = s.doc;
  const second = openChartDialog({ doc: doc2, onInsert: () => {} });
  assert.equal(s.root.removed, true);
  assert.equal(s.closed.length, 1);
  second.close();
  const before = s.calls.length;
  s.root.dispatchEvent(key("Enter", { metaKey: true }));
  assert.equal(s.calls.length, before);
});
