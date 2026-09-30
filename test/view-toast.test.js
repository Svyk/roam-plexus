import assert from "node:assert/strict";
import test from "node:test";

import { createToaster } from "../src/view/toast.js";

function fakeDoc() {
  const nodes = [];
  const mk = (tag) => {
    const n = {
      tag, children: [], listeners: {}, attrs: {}, className: "", removed: false, _text: "",
      setAttribute(k, v) { this.attrs[k] = v; },
      append(c) { this.children.push(c); },
      addEventListener(t, f) { this.listeners[t] = f; },
      remove() { this.removed = true; },
      get textContent() { return this._text; },
      set textContent(v) { this._text = v; this.children = []; },
    };
    nodes.push(n);
    return n;
  };
  const body = { children: [], append(c) { this.children.push(c); } };
  return { nodes, body, createElement: mk };
}

const shown = (doc) => doc.body.children.filter((n) => !n.removed);

test("a plain toast lasts 2600 ms and is removed", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const doc = fakeDoc();
  const toaster = createToaster({ doc });
  toaster.show("hi");
  assert.equal(shown(doc).length, 1);
  assert.equal(shown(doc)[0].className, "plexus-portal plexus-toast plexus-toast-info");
  t.mock.timers.tick(2599);
  assert.equal(shown(doc).length, 1);
  t.mock.timers.tick(1);
  assert.equal(shown(doc).length, 0);
});

test("an action toast renders one button, stays 10 s, runs once and hides", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const doc = fakeDoc();
  const toaster = createToaster({ doc });
  const runs = [];
  toaster.show("Not applied", { kind: "error", action: { label: "Apply anyway", run: () => runs.push(1) } });
  const el = shown(doc)[0];
  const button = el.children[0];
  assert.equal(button.className, "plexus-toast-action");
  assert.equal(button.textContent, "Apply anyway");
  let prevented = 0;
  button.listeners.mousedown({ preventDefault() { prevented += 1; } });
  assert.equal(prevented, 1);
  t.mock.timers.tick(9999);
  assert.equal(el.removed, false);
  button.listeners.click();
  button.listeners.click();
  assert.deepEqual(runs, [1]);
  assert.equal(el.removed, true);
});

test("onHide fires when the toast times out, is replaced, or is disposed; a replaced action is dropped", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const doc = fakeDoc();
  const toaster = createToaster({ doc });
  const log = [];
  toaster.show("a", { action: { label: "A", run: () => log.push("runA") }, onHide: () => log.push("hideA") });
  toaster.show("b", { action: { label: "B", run: () => log.push("runB") }, onHide: () => log.push("hideB") });
  assert.deepEqual(log, ["hideA"]);
  t.mock.timers.tick(10000);
  assert.deepEqual(log, ["hideA", "hideB"]);
  toaster.show("c", { action: { label: "C", run: () => log.push("runC") }, onHide: () => log.push("hideC") });
  toaster.dispose();
  assert.deepEqual(log, ["hideA", "hideB"]);
});

test("a plain show while an action toast is visible is held, latest wins, and shows after it closes", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const doc = fakeDoc();
  const toaster = createToaster({ doc });
  toaster.show("act", { action: { label: "Go", run() {} } });
  toaster.show("one");
  toaster.show("two", { kind: "error" });
  const el = shown(doc)[0];
  assert.equal(el.textContent, "act");
  t.mock.timers.tick(10000);
  const next = shown(doc)[0];
  assert.equal(next.textContent, "two");
  assert.match(next.className, /plexus-toast-error/);
  t.mock.timers.tick(2600);
  assert.equal(shown(doc).length, 0);
});

test("a throwing action does not escape, and dispose clears a held toast", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const doc = fakeDoc();
  const toaster = createToaster({ doc });
  const warn = console.warn;
  console.warn = () => {};
  toaster.show("act", { action: { label: "Go", run() { throw new Error("boom"); } } });
  toaster.show("held");
  assert.doesNotThrow(() => shown(doc)[0].children[0].listeners.click());
  console.warn = warn;
  assert.equal(shown(doc)[0].textContent, "held");
  toaster.show("x", { action: { label: "Go", run() {} } });
  toaster.show("y");
  toaster.dispose();
  t.mock.timers.tick(20000);
  assert.equal(shown(doc).length, 0);
  toaster.show("after");
  assert.equal(shown(doc).length, 0);
});
