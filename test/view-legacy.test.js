import assert from "node:assert/strict";
import test from "node:test";

import { createLegacyDialog } from "../src/view/legacy-dialog.js";

function node(tag) {
  const n = {
    tag, children: [], handlers: {}, attrs: {}, className: "", disabled: false, removed: false,
    append(...c) { this.children.push(...c); },
    addEventListener(t, f) { this.handlers[t] = f; },
    setAttribute(k, v) { this.attrs[k] = v; },
    remove() { this.removed = true; },
  };
  Object.defineProperty(n, "innerHTML", { set() { throw new Error("innerHTML is forbidden"); } });
  return n;
}
function fakeDoc({ modal = true } = {}) {
  const made = [];
  const body = { children: [], append(x) { this.children.push(x); } };
  return {
    made, body,
    createElement: (tag) => {
      const n = node(tag);
      if (tag === "dialog") {
        if (modal) n.showModal = () => { n.modalShown = true; };
        n.close = () => { n.closedCalled = true; };
      }
      made.push(n);
      return n;
    },
  };
}
const flat = (n) => [n, ...(n.children || []).flatMap((c) => (typeof c === "object" ? flat(c) : []))];
const summary = { mentions: 2, drawings: 2, empty: 1, excluded: [] };
const rows = [
  { uid: "ok0000001", page: "P", elementCount: 3, types: { rectangle: 3 } },
  { uid: "empty0001", page: "P", elementCount: 0, empty: true, types: {} },
  { uid: "err000001", page: "P", elementCount: 0, error: "bad", types: {} },
];

test("legacy dialog uses textContent only, shows modally, and disables Migrate for empty and error rows", () => {
  const doc = fakeDoc();
  const migrated = [];
  const d = createLegacyDialog({ doc, onMigrate: (u) => migrated.push(u) });
  d.show({ summary, rows });
  const dlg = doc.body.children[0];
  assert.equal(dlg.modalShown, true);
  assert.match(dlg.className, /plexus-legacy/);
  const migrates = flat(dlg).filter((n) => n.tag === "button" && n.textContent === "Migrate");
  assert.deepEqual(migrates.map((b) => b.disabled), [false, true, true]);
  migrates[0].handlers.click({ stopPropagation() {} });
  assert.deepEqual(migrated, ["ok0000001"]);
  assert.ok(d.isOpen());
});

test("falls back to the open attribute without showModal", () => {
  const doc = fakeDoc({ modal: false });
  createLegacyDialog({ doc }).show({ summary, rows: [] });
  assert.equal(doc.body.children[0].attrs.open, "");
});

test("Copy report calls onCopy with the data; Close and dispose remove the dialog; a second show replaces the first", () => {
  const doc = fakeDoc();
  const copies = [];
  const d = createLegacyDialog({ doc, onCopy: (x) => copies.push(x) });
  d.show({ summary, rows });
  const first = doc.body.children[0];
  flat(first).find((n) => n.textContent === "Copy report").handlers.click({});
  assert.equal(copies.length, 1);
  assert.equal(copies[0].rows, rows);
  d.show({ summary, rows: [] });
  assert.equal(first.removed, true);
  const second = doc.body.children[1];
  flat(second).find((n) => n.textContent === "Close").handlers.click({});
  assert.equal(second.removed, true);
  assert.equal(d.isOpen(), false);
  d.show({ summary, rows });
  d.dispose();
  assert.equal(doc.body.children[2].removed, true);
  assert.equal(d.isOpen(), false);
});

test("a native close event removes the dialog", () => {
  const doc = fakeDoc();
  const d = createLegacyDialog({ doc });
  d.show({ summary, rows });
  const dlg = doc.body.children[0];
  dlg.handlers.close();
  assert.equal(dlg.removed, true);
  assert.equal(d.isOpen(), false);
});
