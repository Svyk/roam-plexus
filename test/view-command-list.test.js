import assert from "node:assert/strict";
import test from "node:test";

import { openCommandList } from "../src/view/command-list.js";

class Target {
  constructor() { this.listeners = []; }
  addEventListener(type, fn, opts) { this.listeners.push({ type, fn, capture: opts === true || !!opts?.capture }); }
  removeEventListener(type, fn, opts) {
    const capture = opts === true || !!opts?.capture;
    this.listeners = this.listeners.filter((l) => !(l.type === type && l.fn === fn && l.capture === capture));
  }
  fire(type, init = {}) {
    const e = { type, target: this, defaultPrevented: false, propagationStopped: false, ...init };
    e.preventDefault = () => { e.defaultPrevented = true; };
    e.stopPropagation = () => { e.propagationStopped = true; };
    for (const l of [...this.listeners]) if (l.type === type) l.fn(e);
    return e;
  }
}

class Node extends Target {
  constructor(tag, doc) {
    super();
    this.tagName = tag.toUpperCase();
    this.doc = doc;
    this.children = [];
    this.style = {};
    this.className = "";
    this.attrs = {};
    this.textContent = "";
    this.value = "";
  }
  append(...c) { this.children.push(...c); c.forEach((x) => { x.parent = this; }); }
  replaceChildren() { this.children = []; }
  setAttribute(k, v) { this.attrs[k] = v; }
  remove() { this.parent && (this.parent.children = this.parent.children.filter((c) => c !== this)); this.parent = null; }
  contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  focus() { this.doc.activeElement = this; this.focused = (this.focused || 0) + 1; }
}

function* walk(n) { yield n; for (const c of n.children) yield* walk(c); }

function setup() {
  const body = new Node("body");
  const doc = new Target();
  Object.assign(doc, { body, activeElement: null });
  doc.createElement = (t) => new Node(t, doc);
  const timers = new Map();
  let id = 0;
  const setT = (fn, ms) => { timers.set(++id, { fn, ms }); return id; };
  const runTimers = () => { for (const [i, t] of [...timers.entries()]) { timers.delete(i); t.fn(); } };
  const ran = [];
  const commands = [
    { id: "a", label: "New drawing here", hotkey: "Shift+Option+R", run: (ctx) => ran.push(["a", ctx]) },
    { id: "b", label: "Clear crop cache", run: (ctx) => ran.push(["b", ctx]) },
    { id: "c", label: "Audit regions in graph", run: (ctx) => ran.push(["c", ctx]) },
  ];
  const closed = [];
  const ctx = { focusedUid: "focus0001" };
  const open = (extra = {}) => openCommandList({ doc, commands, ctx, zIndex: 5, onClose: () => closed.push(1), setTimeout: setT, ...extra });
  const root = () => body.children.find((c) => /plexus-cmdlist/.test(c.className));
  const input = () => [...walk(root())].find((n) => n.tagName === "INPUT");
  const labels = () => [...walk(root())].filter((n) => /dont-unfocus-block/.test(n.className)).map((n) => n.attrs.title ?? n.children[0].textContent);
  const rows = () => [...walk(root())].filter((n) => /dont-unfocus-block/.test(n.className));
  const type = (text) => { input().value = text; input().fire("input"); };
  const key = (k, extra = {}) => input().fire("keydown", { key: k, ...extra });
  return { doc, body, commands, ran, closed, ctx, open, root, input, labels, rows, type, key, runTimers, timers };
}

test("renders every command with native markup, a kbd, the footer, a high z-index and focuses the input", () => {
  const s = setup();
  s.open();
  assert.match(s.root().className, /rm-autocomplete__results bp3-elevation-3 plexus-portal plexus-picker plexus-cmdlist/);
  assert.equal(s.input().className, "plexus-portal plexus-picker-input");
  assert.equal(s.input().attrs.placeholder, "Plexus command");
  assert.equal(s.root().style.zIndex, "100003");
  assert.deepEqual(s.labels(), ["New drawing here", "Clear crop cache", "Audit regions in graph"]);
  const kbds = [...walk(s.root())].filter((n) => n.tagName === "KBD");
  assert.equal(kbds.length, 1);
  assert.equal(kbds[0].className, "plexus-cmdlist-kbd");
  assert.equal(kbds[0].textContent, "Shift+Option+R");
  assert.ok([...walk(s.root())].some((n) => n.textContent === "Plexus commands"));
  s.runTimers();
  assert.equal(s.doc.activeElement, s.input());
});

test("every whitespace token must be a substring, in original order; empty query shows all", () => {
  const s = setup();
  s.open();
  s.type("cr CACHE");
  assert.deepEqual(s.labels(), ["Clear crop cache"]);
  s.type("re  gra");
  assert.deepEqual(s.labels(), ["Audit regions in graph"]);
  s.type("");
  assert.equal(s.labels().length, 3);
});

test("no match shows one muted non-selectable row and Enter does nothing", () => {
  const s = setup();
  s.open();
  s.type("zzz");
  assert.equal(s.rows().length, 1);
  assert.equal(s.rows()[0].children[0].textContent, "No matching command");
  assert.match(s.rows()[0].className, /plexus-cmdlist-empty/);
  s.key("Enter");
  s.runTimers();
  assert.deepEqual(s.ran, []);
  assert.ok(s.root());
});

test("arrows and Ctrl+N / Ctrl+P move the active row and wrap", () => {
  const s = setup();
  s.open();
  const activeIdx = () => s.rows().findIndex((r) => r.style.backgroundColor);
  assert.equal(activeIdx(), 0);
  s.key("ArrowUp");
  assert.equal(activeIdx(), 2);
  s.key("ArrowDown");
  assert.equal(activeIdx(), 0);
  s.key("n", { ctrlKey: true });
  assert.equal(activeIdx(), 1);
  s.key("p", { ctrlKey: true });
  s.key("p", { ctrlKey: true });
  assert.equal(activeIdx(), 2);
});

test("Enter closes first, then runs the active command with ctx on a timer", () => {
  const s = setup();
  s.open();
  s.key("ArrowDown");
  s.key("Enter");
  assert.equal(s.root(), undefined);
  assert.equal(s.closed.length, 1);
  assert.deepEqual(s.ran, []);
  s.runTimers();
  assert.deepEqual(s.ran, [["b", s.ctx]]);
});

test("click runs a command; hover sets the active row", () => {
  const s = setup();
  s.open();
  s.rows()[2].fire("mousemove", { clientX: 1, clientY: 2 });
  assert.ok(s.rows()[2].style.backgroundColor);
  assert.ok(!s.rows()[0].style.backgroundColor);
  const e = s.rows()[2].fire("click");
  assert.equal(e.propagationStopped, true);
  s.runTimers();
  assert.deepEqual(s.ran, [["c", s.ctx]]);
  assert.equal(s.root(), undefined);
});

test("Escape closes and calls onClose once; close is idempotent and removes listeners", () => {
  const s = setup();
  const h = s.open();
  const e = s.key("Escape");
  assert.equal(e.propagationStopped, true);
  assert.equal(s.root(), undefined);
  h.close();
  h.close();
  assert.equal(s.closed.length, 1);
  assert.equal(s.doc.listeners.length, 0);
});

test("outside pointerdown closes; inside pointerdown does not", () => {
  const s = setup();
  s.open();
  s.doc.fire("pointerdown", { target: s.input() });
  assert.ok(s.root());
  s.doc.fire("pointerdown", { target: new Node("div", s.doc) });
  assert.equal(s.root(), undefined);
});

test("blur that leaves the list closes it; blur into the list keeps it", () => {
  const s = setup();
  s.open();
  s.runTimers();
  s.input().fire("blur");
  s.doc.activeElement = s.input();
  s.runTimers();
  assert.ok(s.root());
  s.input().fire("blur");
  s.doc.activeElement = s.body;
  s.runTimers();
  assert.equal(s.root(), undefined);
});

test("single instance: opening again refocuses and returns the same handle", () => {
  const s = setup();
  const a = s.open();
  s.runTimers();
  const before = s.input().focused;
  const b = s.open();
  assert.equal(a, b);
  assert.equal(s.body.children.filter((c) => /plexus-cmdlist/.test(c.className)).length, 1);
  assert.equal(s.input().focused, before + 1);
  a.close();
  assert.notEqual(s.open(), a);
});

test("root stops pointer and click events; mousedown is prevented; keys never propagate", () => {
  const s = setup();
  s.open();
  for (const t of ["pointerdown", "mousedown", "click"]) assert.equal(s.root().fire(t).propagationStopped, true);
  assert.equal(s.root().fire("mousedown").defaultPrevented, true);
  assert.equal(s.root().fire("mousedown", { target: s.input() }).defaultPrevented, false);
  for (const k of ["a", "Tab", "ArrowDown", "Enter"]) assert.equal(s.key(k).propagationStopped, true, k);
});

test("a throwing or rejecting command is caught and warned", async () => {
  const s = setup();
  const warnings = [];
  const warn = console.warn;
  console.warn = (...a) => warnings.push(a);
  try {
    s.commands[0].run = () => { throw new Error("boom"); };
    s.commands[1].run = () => Promise.reject(new Error("nope"));
    s.open();
    s.key("Enter");
    assert.doesNotThrow(() => s.runTimers());
    s.open();
    s.key("ArrowDown");
    s.key("Enter");
    s.runTimers();
    await new Promise((r) => setImmediate(r));
  } finally {
    console.warn = warn;
  }
  assert.equal(warnings.filter((w) => w[0] === "[plexus] command failed").length, 2);
});
