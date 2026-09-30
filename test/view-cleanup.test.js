import assert from "node:assert/strict";
import test from "node:test";

import { createCleanupDialog } from "../src/view/cleanup-dialog.js";

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
function fakeDoc() {
  const body = { children: [], append(x) { this.children.push(x); } };
  return {
    body,
    createElement: (tag) => {
      const n = node(tag);
      if (tag === "dialog") {
        n.showModal = () => { n.modalShown = true; };
        n.close = () => { n.closedCalled = true; };
      }
      return n;
    },
  };
}
const flat = (n) => [n, ...(n.children || []).flatMap((c) => (typeof c === "object" ? flat(c) : []))];
const report = {
  scanned: 5,
  candidates: [{ uid: "c00000001", kind: "area", caption: "Region", before: "b", after: "a" }],
  skipped: [{ uid: "s00000001", kind: "cframe", caption: "Frame", reason: "frame missing" }],
};

test("cleanup dialog lists candidates and skipped rows with textContent only", () => {
  const doc = fakeDoc();
  const d = createCleanupDialog({ doc });
  d.show({ report });
  const dlg = doc.body.children[0];
  assert.equal(dlg.modalShown, true);
  const texts = flat(dlg).map((n) => n.textContent).filter(Boolean);
  assert.ok(texts.includes("Apply 1"));
  assert.ok(texts.some((t) => /skipped: frame missing/.test(t)));
  assert.ok(texts.some((t) => /1 to clear, 1 skipped, 5 regions scanned/.test(t)));
});

test("Apply and Copy report call their callbacks with the report; Apply is disabled with no candidates", () => {
  const doc = fakeDoc();
  const got = [];
  const d = createCleanupDialog({ doc, onApply: (r) => got.push(["apply", r]), onCopy: (r) => got.push(["copy", r]) });
  d.show({ report });
  const dlg = doc.body.children[0];
  flat(dlg).find((n) => n.textContent === "Apply 1").handlers.click({});
  flat(dlg).find((n) => n.textContent === "Copy report").handlers.click({});
  assert.deepEqual(got.map((g) => g[0]), ["apply", "copy"]);
  assert.equal(got[0][1], report);
  d.show({ report: { candidates: [], skipped: [] } });
  const empty = doc.body.children[1];
  assert.equal(flat(empty).find((n) => n.textContent === "Apply 0").disabled, true);
});

test("Close, a second show, a native close and dispose each leave at most one dialog", () => {
  const doc = fakeDoc();
  const d = createCleanupDialog({ doc });
  d.show({ report });
  const first = doc.body.children[0];
  d.show({ report });
  assert.equal(first.removed, true);
  const second = doc.body.children[1];
  flat(second).find((n) => n.textContent === "Close").handlers.click({});
  assert.equal(second.removed, true);
  assert.equal(d.isOpen(), false);
  d.show({ report });
  const third = doc.body.children[2];
  third.handlers.close();
  assert.equal(third.removed, true);
  d.show({ report });
  d.dispose();
  assert.equal(doc.body.children[3].removed, true);
});
