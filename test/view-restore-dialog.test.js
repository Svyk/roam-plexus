import assert from "node:assert/strict";
import test from "node:test";

import { formatWhen, openRestoreDialog } from "../src/view/restore-dialog.js";

function node(tag) {
  const n = {
    tag, children: [], listeners: {}, attrs: {}, className: "", style: {}, text: "", parent: null,
    set textContent(v) { this.text = String(v); },
    get textContent() { return this.text; },
    append(...c) { for (const x of c) { if (typeof x === "object") x.parent = this; this.children.push(x); } },
    replaceChildren(...c) { this.children = []; this.append(...c); },
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
    fire(t, e = {}) {
      let stopped = false;
      const ev = { stopPropagation() { stopped = true; }, preventDefault() { ev.prevented = true; }, ...e };
      for (const f of [...(this.listeners[t] || [])]) f(ev);
      return { ev, stopped };
    },
    setAttribute(k, v) { this.attrs[k] = v; },
    remove() { this.removed = true; if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); },
    focus() { this.focused = true; },
  };
  return n;
}
function fakeDoc() {
  const body = node("body");
  const canvas = node("canvas");
  return { body, canvas, activeElement: canvas, createElement: (tag) => node(tag) };
}
const flat = (n) => [n, ...(n.children || []).flatMap((c) => (typeof c === "object" ? flat(c) : []))];
const texts = (root) => flat(root).map((n) => n.text).filter(Boolean);
const buttons = (root, cls) => flat(root).filter((n) => n.tag === "button" && n.className.includes(cls));
const tick = () => new Promise((r) => setImmediate(r));
const T = new Date(2026, 8, 30, 14, 5).getTime();

test("lists session entries with label, time and element count; saved entries after loading", async () => {
  const doc = fakeDoc();
  let resolve;
  const loadSaved = () => new Promise((r) => { resolve = r; });
  const h = openRestoreDialog({ doc, zIndex: 100, session: [{ index: 0, label: "Remove", time: Date.now(), count: 12 }, { index: 1, label: "Mind map", time: Date.now(), count: 1 }], loadSaved });
  const root = doc.body.children[0];
  assert.equal(root, h.node);
  assert.equal(root.style.zIndex, "102");
  assert.ok(texts(root).includes("This session"));
  assert.ok(texts(root).includes("Saved on this device"));
  assert.ok(texts(root).includes("Remove"));
  assert.ok(texts(root).some((t) => t.endsWith("12 elements")));
  assert.ok(texts(root).some((t) => t.endsWith("1 element")));
  assert.ok(texts(root).includes("Loading…"));
  await tick();
  resolve([{ key: ["g", "d", T], t: T, count: 7 }, { key: ["g", "d", T - 1], t: T - 86400000, count: 3 }]);
  await tick();
  assert.ok(!texts(root).includes("Loading…"));
  assert.ok(texts(root).includes("14:05"));
  assert.ok(texts(root).includes("7 elements"));
  assert.ok(texts(root).some((t) => /^2026-09-29 14:05$/.test(t)));
});

test("empty and failing loads show a message; encrypted graphs say so", async () => {
  const a = fakeDoc();
  openRestoreDialog({ doc: a, loadSaved: async () => [] });
  await tick();
  assert.ok(texts(a.body.children[0]).includes("No saved versions yet"));
  assert.ok(texts(a.body.children[0]).includes("Nothing yet this session"));
  const b = fakeDoc();
  openRestoreDialog({ doc: b, loadSaved: async () => { throw new Error("x"); } });
  await tick();
  assert.ok(texts(b.body.children[0]).includes("Could not load saved versions"));
  const c = fakeDoc();
  openRestoreDialog({ doc: c });
  assert.ok(texts(c.body.children[0]).includes("Not kept on encrypted graphs"));
  const d = fakeDoc();
  openRestoreDialog({ doc: d, loadSaved: async () => ({ encrypted: true }) });
  await tick();
  assert.ok(texts(d.body.children[0]).includes("Not kept on encrypted graphs"));
});

test("Restore closes the dialog first, then calls onRestore with the entry", async () => {
  const doc = fakeDoc();
  const log = [];
  const h = openRestoreDialog({
    doc,
    session: [{ index: 2, label: "Remove", time: T, count: 4 }],
    loadSaved: async () => [{ key: ["g", "d", 5], t: 5, count: 9 }],
    onRestore: (e) => log.push(["restore", e, h.isOpen()]),
    onClose: () => log.push(["close"]),
  });
  await tick();
  const root = doc.body.children[0];
  const [first, second] = buttons(root, "plexus-restore-pick");
  first.fire("click");
  assert.deepEqual(log[0], ["close"]);
  assert.deepEqual(log[1], ["restore", { kind: "session", index: 2, label: "Remove" }, false]);
  assert.equal(doc.body.children.length, 0);
  assert.equal(second.tag, "button");
  const doc2 = fakeDoc();
  const got = [];
  openRestoreDialog({ doc: doc2, loadSaved: async () => [{ key: ["g", "d", 5], t: 5, count: 9 }], onRestore: (e) => got.push(e) });
  await tick();
  buttons(doc2.body.children[0], "plexus-restore-pick")[0].fire("click");
  assert.deepEqual(got, [{ kind: "saved", key: ["g", "d", 5], t: 5, count: 9 }]);
});

test("keys are isolated from the host and Excalidraw; Esc and Cancel close and return focus", () => {
  const doc = fakeDoc();
  let closed = 0;
  openRestoreDialog({ doc, onClose: () => { closed += 1; } });
  const root = doc.body.children[0];
  for (const type of ["keydown", "keyup", "keypress", "paste", "copy", "cut"]) {
    assert.equal(root.fire(type, { key: "r" }).stopped, true, type);
  }
  doc.canvas.focused = false;
  const { ev } = root.fire("keydown", { key: "Escape" });
  assert.equal(ev.prevented, true);
  assert.equal(closed, 1);
  assert.equal(doc.canvas.focused, true);
  assert.equal(doc.body.children.length, 0);

  const doc2 = fakeDoc();
  openRestoreDialog({ doc: doc2 });
  buttons(doc2.body.children[0], "plexus-restore-cancel")[0].fire("click");
  assert.equal(doc2.body.children.length, 0);
});

test("only one dialog per document: a second open closes the first; close is idempotent", () => {
  const doc = fakeDoc();
  let closed = 0;
  const first = openRestoreDialog({ doc, onClose: () => { closed += 1; } });
  const second = openRestoreDialog({ doc });
  assert.equal(first.isOpen(), false);
  assert.equal(closed, 1);
  assert.equal(doc.body.children.length, 1);
  second.close();
  second.close();
  assert.equal(doc.body.children.length, 0);
});

test("a saved list that resolves after close changes nothing and the hint names the platform key", async () => {
  const doc = fakeDoc();
  let resolve;
  const h = openRestoreDialog({ doc, loadSaved: () => new Promise((r) => { resolve = r; }), mac: true });
  assert.ok(texts(h.node).includes("Restoring is one undo step (Cmd+Z)."));
  h.close();
  await tick();
  resolve([{ key: ["g", "d", 1], t: 1, count: 1 }]);
  await tick();
  assert.equal(buttons(h.node, "plexus-restore-pick").length, 0);
  const other = openRestoreDialog({ doc: fakeDoc() });
  assert.ok(texts(other.node).includes("Restoring is one undo step (Ctrl+Z)."));
});

test("formatWhen is 24-hour time, with the date when not today", () => {
  const now = new Date(2026, 0, 5, 9, 0).getTime();
  assert.equal(formatWhen(new Date(2026, 0, 5, 18, 7).getTime(), now), "18:07");
  assert.equal(formatWhen(new Date(2026, 0, 4, 0, 3).getTime(), now), "2026-01-04 00:03");
});
