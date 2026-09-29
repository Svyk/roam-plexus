import assert from "node:assert/strict";
import test from "node:test";

import { openSettingsDialog } from "../src/view/settings-dialog.js";

function node(tag) {
  const n = {
    tag, children: [], listeners: {}, attrs: {}, className: "", style: {}, value: "", checked: false, parent: null,
    append(...c) { for (const x of c) { if (typeof x === "object") x.parent = this; this.children.push(x); } },
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
    removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); },
    fire(t, e = {}) { for (const f of [...(this.listeners[t] || [])]) f(e); },
    setAttribute(k, v) { this.attrs[k] = v; },
    remove() { this.removed = true; if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); },
    focus() { this.focused = true; },
  };
  return n;
}
function fakeDoc({ modal = true } = {}) {
  const body = node("body");
  return {
    body,
    createElement: (tag) => {
      const n = node(tag);
      if (tag === "dialog") {
        if (modal) n.showModal = () => { n.modalShown = true; };
        n.close = () => { n.closedCalled = true; };
      }
      return n;
    },
  };
}
const flat = (n) => [n, ...(n.children || []).flatMap((c) => (typeof c === "object" ? flat(c) : []))];
const inputs = (dlg) => flat(dlg).filter((n) => n.tag === "input" || n.tag === "select");
const tick = () => new Promise((r) => setImmediate(r));

function setup(stored = {}, opts = {}) {
  const doc = fakeDoc(opts);
  const writes = [];
  let changed = 0;
  const handle = openSettingsDialog({
    doc,
    get: (id) => stored[id],
    set: (id, v) => { writes.push([id, v]); stored[id] = v; },
    onChanged: () => { changed++; },
    ...opts,
  });
  return { doc, dlg: doc.body.children[0], handle, writes, stored, changed: () => changed };
}

test("opens a modal dialog with five fields bound to stored values", () => {
  const { dlg } = setup({ "figure-height": "300", "inline-display": "link", "dark-crops": false, "open-in-sidebar": true });
  assert.equal(dlg.modalShown, true);
  assert.match(dlg.className, /plexus-portal plexus-settings/);
  const [fig, thumb, inline, dark, side] = inputs(dlg);
  assert.equal(fig.value, "300");
  assert.equal(thumb.value, "72");
  assert.equal(inline.value, "link");
  assert.equal(dark.checked, false);
  assert.equal(side.checked, true);
});

test("dark option adds the dark class; zIndex applies only without showModal", () => {
  assert.match(setup({}, { dark: true }).dlg.className, /plexus-settings--dark/);
  const { dlg } = setup({}, { modal: false, zIndex: 555 });
  assert.equal(dlg.attrs.open, "");
  assert.equal(dlg.style.zIndex, "555");
  assert.equal(setup({}).dlg.style.zIndex, undefined);
});

test("change saves clamped integer strings, booleans, and select values, then calls onChanged", async () => {
  const { dlg, writes, changed } = setup();
  const [fig, thumb, inline, dark] = inputs(dlg);
  fig.value = "5000"; fig.fire("change");
  thumb.value = "abc"; thumb.fire("change");
  inline.value = "link"; inline.fire("change");
  dark.checked = false; dark.fire("change");
  await tick();
  assert.deepEqual(writes, [["figure-height", "1200"], ["inline-display", "link"], ["dark-crops", false]]);
  assert.equal(changed(), 3);
});

test("second open focuses the existing dialog instead of opening another", () => {
  const doc = fakeDoc();
  const a = openSettingsDialog({ doc });
  const b = openSettingsDialog({ doc });
  assert.equal(doc.body.children.length, 1);
  assert.equal(a, b);
  assert.equal(inputs(doc.body.children[0])[0].focused, true);
});

test("close commits unsaved edits once, removes the dialog and its listeners, and allows reopening", async () => {
  const { doc, dlg, handle, writes, changed } = setup();
  inputs(dlg)[0].value = "400";
  handle.close();
  handle.close();
  await tick();
  assert.deepEqual(writes, [["figure-height", "400"]]);
  assert.equal(changed(), 1);
  assert.equal(dlg.closedCalled, true);
  assert.equal(dlg.removed, true);
  assert.equal(doc.body.children.length, 0);
  for (const list of Object.values(dlg.listeners)) assert.equal(list.length, 0);
  openSettingsDialog({ doc });
  assert.equal(doc.body.children.length, 1);
});

test("Esc (cancel event) and the Close button commit and close; no write when nothing changed", async () => {
  const a = setup();
  a.dlg.fire("cancel");
  await tick();
  assert.equal(a.dlg.removed, true);
  assert.equal(a.writes.length, 0);
  assert.equal(a.changed(), 0);
  const b = setup();
  inputs(b.dlg)[3].checked = false;
  flat(b.dlg).find((n) => n.tag === "button").fire("click", { stopPropagation() {} });
  await tick();
  assert.deepEqual(b.writes, [["dark-crops", false]]);
});

test("keyboard, pointer, wheel, paste and click events stop propagating", () => {
  const { dlg } = setup();
  for (const type of ["keydown", "keyup", "keypress", "input", "paste", "copy", "cut", "mousedown", "pointerdown", "wheel", "click"]) {
    let stopped = false;
    dlg.fire(type, { stopPropagation() { stopped = true; } });
    assert.ok(stopped, type);
  }
});

test("a throwing set does not break close", async () => {
  const doc = fakeDoc();
  const h = openSettingsDialog({ doc, get: () => undefined, set: () => { throw new Error("boom"); } });
  inputs(doc.body.children[0])[0].value = "333";
  const warn = console.warn; console.warn = () => {};
  try { h.close(); await tick(); } finally { console.warn = warn; }
  assert.equal(doc.body.children.length, 0);
});

test("an out-of-range number is rewritten on screen to the stored clamped value", async () => {
  const { dlg, writes } = setup();
  const [fig, thumb] = inputs(dlg);
  fig.value = "9999"; fig.fire("change");
  assert.equal(fig.value, "1200");
  thumb.value = ""; thumb.fire("change");
  assert.equal(thumb.value, "72");
  await tick();
  assert.deepEqual(writes, [["figure-height", "1200"]]);
});
