import assert from "node:assert/strict";
import test from "node:test";

import { createLinkSuggest, installSuggestAutoAttach, SUGGEST_SELECTOR } from "../src/view/link-suggest.js";

class Target {
  constructor() { this.listeners = []; }
  addEventListener(type, fn, opts) { this.listeners.push({ type, fn, capture: opts === true || !!opts?.capture }); }
  removeEventListener(type, fn, opts) {
    const capture = opts === true || !!opts?.capture;
    this.listeners = this.listeners.filter((l) => !(l.type === type && l.fn === fn && l.capture === capture));
  }
  fire(type, init = {}) {
    const e = { type, target: this, defaultPrevented: false, stopped: false, propagationStopped: false, ...init };
    e.preventDefault = () => { e.defaultPrevented = true; };
    e.stopImmediatePropagation = () => { e.stopped = true; };
    e.stopPropagation = () => { e.propagationStopped = true; };
    for (const l of [...this.listeners]) {
      if (l.type !== type) continue;
      l.fn(e);
      if (e.stopped) break;
    }
    return e;
  }
  count() { return this.listeners.length; }
}

class Node extends Target {
  constructor(tag) {
    super();
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.style = {};
    this.className = "";
    this.attrs = {};
    this.textContent = "";
    this.removed = false;
  }
  append(...c) { this.children.push(...c); c.forEach((x) => { x.parent = this; }); }
  replaceChildren() { this.children = []; }
  setAttribute(k, v) { this.attrs[k] = v; }
  remove() { this.removed = true; if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
  contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  getBoundingClientRect() { return { left: 100, top: 100, width: 200, height: 30, right: 300, bottom: 130 }; }
  get offsetWidth() { return 200; }
  get offsetHeight() { return 30; }
}

function* walk(n) { yield n; for (const c of n.children) yield* walk(c); }

class ValueBase extends Node {
  set value(v) { this.setterCalls.push(v); this._v = v; }
  get value() { return this._v; }
}
class Field extends ValueBase {}

function makeInput(value = "", caret = value.length) {
  const el = new Field("textarea");
  el.setterCalls = [];
  el._v = value;
  el.selectionStart = caret;
  el.isConnected = true;
  el.scrollLeft = 0;
  el.scrollTop = 0;
  el.setSelectionRange = (a) => { el.selectionStart = a; el.selRanges = [...(el.selRanges || []), a]; };
  el.dispatchEvent = (ev) => { el.dispatched = [...(el.dispatched || []), ev]; el.fire("input", { isComposing: false }); return true; };
  return el;
}

function setup({ search, pull } = {}) {
  const view = new Target();
  view.innerHeight = 800;
  view.innerWidth = 1200;
  view.getComputedStyle = () => ({ fontSize: "20px", lineHeight: "normal", whiteSpace: "pre" });
  view.Event = class { constructor(type, init) { this.type = type; Object.assign(this, init); } };
  view.InputEvent = class extends view.Event {};
  const body = new Node("body");
  const doc = new Target();
  Object.assign(doc, { defaultView: view, body, createElement: (t) => new Node(t) });
  const timers = new Map();
  let id = 0;
  const setT = (fn, ms) => { timers.set(++id, { fn, ms }); return id; };
  const clearT = (i) => timers.delete(i);
  const tick = () => { const now = [...timers.entries()]; for (const [i, t] of now) { timers.delete(i); t.fn(); } };
  const calls = [];
  const api = {
    data: {
      async: { search: (args) => { calls.push(args); return (search || (async () => []))(args); } },
      pull: pull || (async () => ({ ":block/page": { ":node/title": "Home" } })),
    },
  };
  const suggest = createLinkSuggest({ doc, api, setTimeout: setT, clearTimeout: clearT });
  const roots = () => body.children.filter((c) => /plexus-suggest/.test(c.className));
  return { suggest, doc, view, body, timers, tick, calls, roots, setT, clearT };
}

const flush = () => new Promise((r) => setImmediate(r));
const typeText = (el, value, caret = value.length) => { el._v = value; el.selectionStart = caret; el.fire("input", { isComposing: false }); };
const rowsOf = (root) => [...walk(root)].filter((n) => /dont-unfocus-block/.test(n.className));
const key = (el, k, extra = {}) => el.fire("keydown", { key: k, ...extra });

test("empty query shows a hint row and makes no search call", async () => {
  const s = setup();
  const el = makeInput("");
  s.suggest.attach(el);
  typeText(el, "[[");
  await flush();
  s.tick();
  assert.equal(s.calls.length, 0);
  const [root] = s.roots();
  assert.ok(root);
  assert.match(root.className, /rm-autocomplete__results bp3-elevation-3 plexus-portal plexus-suggest/);
  assert.equal(rowsOf(root)[0].attrs.title, "Search for a page");
  typeText(el, "((");
  assert.equal(rowsOf(s.roots()[0])[0].attrs.title, "Search for a block");
  typeText(el, "[[   ");
  assert.equal(s.calls.length, 0);
});

test("page query debounces, searches pages, and renders native markup", async () => {
  const s = setup({ search: async () => [{ ":block/uid": "u1", ":node/title": "Plexus" }, { ":block/uid": "u2", ":node/title": "Plexus Spike" }] });
  const el = makeInput("");
  s.suggest.attach(el);
  typeText(el, "[[plex");
  assert.equal(s.roots().length, 0);
  assert.equal([...s.timers.values()][0].ms, 60);
  s.tick();
  await flush();
  assert.deepEqual(s.calls[0], { "search-str": "plex", "search-pages": true, "search-blocks": false, limit: 12 });
  const [root] = s.roots();
  assert.equal(root.style.position, undefined);
  assert.ok(Number(root.style.zIndex) >= 1010);
  const rows = rowsOf(root);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].style.backgroundColor, "rgb(213, 218, 223)");
  assert.equal(rows[1].style.backgroundColor, "");
  const all = [...walk(root)];
  assert.ok(all.some((n) => n.className === "rm-search-match" && n.textContent === "Plex"));
  assert.equal(all.find((n) => n.className === "rm-autocomplete-footer__title").textContent, "Page search");
  assert.equal(all.find((n) => n.className === "rm-autocomplete-footer__action__desc").textContent, "Insert reference");
  assert.ok(root.style.left !== undefined && root.style.top !== undefined);
});

test("block search passes hide-code-blocks, pulls page titles, uses the 150ms debounce", async () => {
  const pulls = [];
  const s = setup({
    search: async () => [{ ":block/uid": "b1", ":block/string": "hello world" }],
    pull: async (sel, ref) => { pulls.push([sel, ref]); return { ":block/page": { ":node/title": "Daily" } }; },
  });
  const el = makeInput("");
  s.suggest.attach(el);
  typeText(el, "((hel");
  assert.equal([...s.timers.values()][0].ms, 150);
  s.tick();
  await flush();
  assert.deepEqual(s.calls[0], { "search-str": "hel", "search-pages": false, "search-blocks": true, "hide-code-blocks": true, limit: 12 });
  assert.deepEqual(pulls[0], ["[{:block/page [:node/title]}]", [":block/uid", "b1"]]);
  const all = [...walk(s.roots()[0])];
  assert.equal(all.find((n) => n.className === "bp3-text-overflow-ellipsis").textContent, "Daily");
  assert.equal(all.find((n) => n.className === "rm-autocomplete-footer__title").textContent, "Block search");
});

test("stale responses are dropped and a late response after close never reopens", async () => {
  const pending = [];
  const s = setup({ search: () => new Promise((res) => pending.push(res)) });
  const el = makeInput("");
  s.suggest.attach(el);
  typeText(el, "[[a");
  s.tick();
  typeText(el, "[[ab");
  s.tick();
  assert.equal(pending.length, 2);
  pending[1]([{ ":block/uid": "n", ":node/title": "New" }]);
  await flush();
  pending[0]([{ ":block/uid": "o", ":node/title": "Old" }]);
  await flush();
  const titles = rowsOf(s.roots()[0]).map((r) => r.attrs.title);
  assert.deepEqual(titles, ["New"]);
  typeText(el, "[[abc");
  s.tick();
  key(el, "Escape");
  pending[2]([{ ":block/uid": "z", ":node/title": "Late" }]);
  await flush();
  assert.equal(s.roots().length, 0);
});

test("a timer pending at close is cleared", () => {
  const s = setup();
  const el = makeInput("");
  s.suggest.attach(el);
  typeText(el, "[[abc");
  assert.equal(s.timers.size, 1);
  typeText(el, "no trigger");
  assert.equal(s.timers.size, 0);
  assert.equal(s.calls.length, 0);
});

test("search error shows Search failed and warns", async () => {
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a);
  try {
    const s = setup({ search: async () => { throw new Error("boom"); } });
    const el = makeInput("");
    s.suggest.attach(el);
    typeText(el, "[[abc");
    s.tick();
    await flush();
    assert.equal(rowsOf(s.roots()[0])[0].attrs.title, "Search failed");
    assert.match(String(warns[0][0]), /^\[plexus\]/);
    const e = key(el, "Enter");
    assert.equal(e.defaultPrevented, true);
    assert.equal(s.roots().length, 0);
    assert.equal(el.setterCalls.length, 0);
  } finally { console.warn = orig; }
});

async function openWithResults(titles = ["Plexus", "Plex Two", "Plex Three"]) {
  const s = setup({ search: async () => titles.map((t, i) => ({ ":block/uid": `u${i}`, ":node/title": t })) });
  const el = makeInput("");
  s.suggest.attach(el);
  typeText(el, "see [[plex");
  s.tick();
  await flush();
  return { s, el };
}

test("keys are ignored (not prevented) while the menu is closed", () => {
  const s = setup();
  const el = makeInput("plain");
  s.suggest.attach(el);
  for (const k of ["ArrowDown", "Enter", "Escape", "Tab"]) {
    const e = key(el, k);
    assert.equal(e.defaultPrevented, false, k);
    assert.equal(e.stopped, false, k);
  }
});

test("ArrowDown/ArrowUp/Ctrl-n/Ctrl-p move the active row and wrap; handled keys are stopped", async () => {
  const { s, el } = await openWithResults();
  const active = () => rowsOf(s.roots()[0]).findIndex((r) => r.style.backgroundColor);
  let e = key(el, "ArrowDown");
  assert.equal(active(), 1);
  assert.equal(e.defaultPrevented && e.stopped, true);
  key(el, "n", { ctrlKey: true });
  assert.equal(active(), 2);
  key(el, "ArrowDown");
  assert.equal(active(), 0);
  key(el, "ArrowUp");
  assert.equal(active(), 2);
  key(el, "p", { ctrlKey: true });
  assert.equal(active(), 1);
});

test("unhandled keys and modified keys pass through untouched", async () => {
  const { s, el } = await openWithResults();
  for (const [k, extra] of [["a", {}], ["Tab", { shiftKey: true }], ["Enter", { metaKey: true }], ["Enter", { shiftKey: true }], ["ArrowDown", { altKey: true }], ["n", {}], ["n", { ctrlKey: true, shiftKey: true }], ["Escape", { ctrlKey: true }]]) {
    const e = key(el, k, extra);
    assert.equal(e.defaultPrevented, false, `${k} ${JSON.stringify(extra)}`);
    assert.equal(e.stopped, false);
  }
  assert.equal(s.roots().length, 1);
  const composing = key(el, "Enter", { isComposing: true });
  const ime = key(el, "Enter", { keyCode: 229 });
  assert.equal(composing.defaultPrevented || ime.defaultPrevented, false);
  assert.equal(s.roots().length, 1);
});

test("Escape closes only the menu and consumes the key; a second Escape passes through", async () => {
  const { s, el } = await openWithResults();
  const e = key(el, "Escape");
  assert.equal(e.defaultPrevented && e.stopped, true);
  assert.equal(s.roots().length, 0);
  assert.equal(key(el, "Escape").defaultPrevented, false);
});

test("Enter picks through the prototype value setter, sets the caret, dispatches input, and closes", async () => {
  const { s, el } = await openWithResults();
  key(el, "ArrowDown");
  const e = key(el, "Enter");
  assert.equal(e.defaultPrevented && e.stopped, true);
  assert.deepEqual(el.setterCalls, ["see [[Plex Two]]"]);
  assert.equal(el.value, "see [[Plex Two]]");
  assert.equal(el.selectionStart, "see [[Plex Two]]".length);
  assert.equal(el.dispatched.length, 1);
  assert.equal(el.dispatched[0].type, "input");
  assert.equal(el.dispatched[0].bubbles, true);
  assert.equal(el.dispatched[0].inputType, "insertReplacementText");
  assert.equal(s.roots().length, 0);
});

test("Tab picks; caret is restored after a normalizing input handler", async () => {
  const { el } = await openWithResults();
  el.dispatchEvent = () => { el.selectionStart = 0; return true; };
  key(el, "Tab");
  assert.equal(el.value, "see [[Plexus]]");
  assert.equal(el.selRanges.at(-1), "see [[Plexus]]".length);
});

test("pick falls back to a plain assignment when there is no prototype setter", async () => {
  const s = setup({ search: async () => [{ ":block/uid": "u", ":node/title": "Plexus" }] });
  const plain = new Node("input");
  plain.value = "[[pl";
  plain.selectionStart = 4;
  plain.isConnected = true;
  plain.setSelectionRange = (a) => { plain.selectionStart = a; };
  plain.dispatchEvent = () => true;
  s.suggest.attach(plain);
  plain.fire("input", {});
  s.tick();
  await flush();
  key(plain, "Enter");
  assert.equal(plain.value, "[[Plexus]]");
});

test("Enter with a non-empty page query and no results inserts [[query]]", async () => {
  const s = setup({ search: async () => [] });
  const el = makeInput("");
  s.suggest.attach(el);
  typeText(el, "[[New Page");
  s.tick();
  await flush();
  assert.equal(rowsOf(s.roots()[0])[0].attrs.title, "No pages found.");
  key(el, "Enter");
  assert.equal(el.value, "[[New Page]]");
});

test("Enter with no block results, or an empty query, closes and consumes without inserting", async () => {
  const s = setup({ search: async () => [] });
  const el = makeInput("");
  s.suggest.attach(el);
  typeText(el, "((nothing");
  s.tick();
  await flush();
  let e = key(el, "Enter");
  assert.equal(e.defaultPrevented, true);
  assert.equal(el.setterCalls.length, 0);
  assert.equal(s.roots().length, 0);
  typeText(el, "[[");
  e = key(el, "Tab");
  assert.equal(e.defaultPrevented, true);
  assert.equal(el.setterCalls.length, 0);
  assert.equal(s.roots().length, 0);
});

test("mousedown is prevented so the element never blurs; pointerdown and click do not propagate", async () => {
  const { s, el } = await openWithResults();
  const root = s.roots()[0];
  const md = root.fire("mousedown");
  assert.equal(md.defaultPrevented, true);
  assert.equal(md.propagationStopped, true);
  assert.equal(root.fire("pointerdown").propagationStopped, true);
  assert.equal(root.fire("click").propagationStopped, true);
  assert.equal(s.roots().length, 1);
  assert.ok(el);
});

test("row click picks synchronously; mousemove activates only on real movement", async () => {
  const { s, el } = await openWithResults();
  const rows = rowsOf(s.roots()[0]);
  rows[1].fire("mousemove", { clientX: 5, clientY: 5 });
  assert.equal(rows[1].style.backgroundColor, "rgb(213, 218, 223)");
  key(el, "ArrowDown");
  assert.equal(rows[2].style.backgroundColor, "rgb(213, 218, 223)");
  rows[1].fire("mousemove", { clientX: 5, clientY: 5 });
  assert.equal(rows[2].style.backgroundColor, "rgb(213, 218, 223)", "synthetic mousemove ignored");
  rows[1].fire("mousemove", { clientX: 6, clientY: 5 });
  assert.equal(rows[1].style.backgroundColor, "rgb(213, 218, 223)");
  const c = rows[0].fire("click");
  assert.equal(c.propagationStopped, true);
  assert.equal(el.value, "see [[Plexus]]");
  assert.equal(s.roots().length, 0);
});

test("keyup and click never open the menu, but update or close an open one", async () => {
  const s = setup({ search: async () => [{ ":block/uid": "u", ":node/title": "Plexus" }] });
  const el = makeInput("[[abc]] x", 4);
  s.suggest.attach(el);
  el.fire("click");
  el.fire("keyup", { key: "ArrowLeft" });
  assert.equal(s.timers.size, 0);
  assert.equal(s.roots().length, 0);
  typeText(el, "[[abc", 5);
  s.tick();
  await flush();
  assert.equal(s.roots().length, 1);
  el.fire("keyup", { key: "a" });
  assert.equal(s.timers.size, 1, "only the liveness timer");
  const before = s.calls.length;
  el.fire("keyup", { key: "ArrowLeft" });
  assert.equal(s.timers.size, 1);
  assert.equal(s.calls.length, before);
  el._v = "[[abc]] x";
  el.selectionStart = 9;
  el.fire("click");
  assert.equal(s.roots().length, 0);
});

test("an unchanged trigger recheck is a no-op that keeps the active row", async () => {
  const { s, el } = await openWithResults();
  key(el, "ArrowDown");
  const calls = s.calls.length;
  el.fire("input", { isComposing: false });
  el.fire("keyup", { key: "End" });
  assert.equal(s.calls.length, calls);
  assert.equal(s.timers.size, 1);
  assert.equal(rowsOf(s.roots()[0])[1].style.backgroundColor, "rgb(213, 218, 223)");
});

test("composing input never opens the menu", () => {
  const s = setup();
  const el = makeInput("");
  s.suggest.attach(el);
  el._v = "[[a";
  el.selectionStart = 3;
  el.fire("input", { isComposing: true });
  assert.equal(s.timers.size, 0);
  assert.equal(s.roots().length, 0);
});

test("blur closes the menu; window listeners exist only while open", async () => {
  const { s, el } = await openWithResults();
  assert.equal(s.view.count(), 3);
  el.fire("blur");
  assert.equal(s.roots().length, 0);
  assert.equal(s.view.count(), 0);
});

test("window wheel outside the menu closes it; inside does not; scroll repositions", async () => {
  const { s } = await openWithResults();
  const root = s.roots()[0];
  const wheel = s.view.listeners.find((l) => l.type === "wheel");
  assert.equal(wheel.capture, true);
  wheel.fn({ target: root.children[0] });
  assert.equal(s.roots().length, 1);
  const scrollL = s.view.listeners.find((l) => l.type === "scroll");
  root.style.top = "x";
  scrollL.fn({ target: root.children[0] });
  assert.equal(root.style.top, "x");
  scrollL.fn({ target: s.body });
  assert.notEqual(root.style.top, "x");
  wheel.fn({ target: s.body });
  assert.equal(s.roots().length, 0);
});

test("menu flips above the caret near the bottom and clamps horizontally", async () => {
  const { s } = await openWithResults();
  const root = s.roots()[0];
  root.getBoundingClientRect = () => ({ height: 300 });
  s.view.innerHeight = 250;
  s.view.innerWidth = 350;
  s.view.fire("resize");
  assert.ok(parseFloat(root.style.top) >= 8);
  assert.ok(parseFloat(root.style.top) < 100);
  assert.equal(root.style.left, "8px");
});

test("a disconnected element closes and detaches on the next liveness tick", async () => {
  const { s, el } = await openWithResults();
  el.isConnected = false;
  s.tick();
  assert.equal(s.roots().length, 0);
  assert.equal(el.count(), 0);
  assert.equal(s.timers.size, 0);
});

test("a disconnected element at a debounce fire detaches without searching", () => {
  const s = setup();
  const el = makeInput("");
  s.suggest.attach(el);
  typeText(el, "[[abc");
  el.isConnected = false;
  s.tick();
  assert.equal(s.calls.length, 0);
  assert.equal(el.count(), 0);
});

test("detach removes every element listener, the menu, window listeners and timers", async () => {
  const s = setup({ search: async () => [{ ":block/uid": "u", ":node/title": "P" }] });
  const el = makeInput("");
  const detach = s.suggest.attach(el);
  assert.equal(el.count(), 5);
  typeText(el, "[[p");
  s.tick();
  await flush();
  assert.equal(s.roots().length, 1);
  typeText(el, "[[pl");
  detach();
  assert.equal(el.count(), 0);
  assert.equal(s.roots().length, 0);
  assert.equal(s.view.count(), 0);
  assert.equal(s.timers.size, 0);
  detach();
});

test("dispose detaches every attachment", () => {
  const s = setup();
  const a = makeInput("");
  const b = makeInput("");
  s.suggest.attach(a);
  s.suggest.attach(b);
  s.suggest.dispose();
  assert.equal(a.count() + b.count(), 0);
});

test("keydown is registered in the capture phase", () => {
  const s = setup();
  const el = makeInput("");
  s.suggest.attach(el);
  assert.equal(el.listeners.find((l) => l.type === "keydown").capture, true);
});

test("listener errors are swallowed with a [plexus] warning", () => {
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a);
  try {
    const s = setup();
    const el = makeInput("");
    s.suggest.attach(el);
    Object.defineProperty(el, "selectionStart", { get() { throw new Error("nope"); } });
    assert.doesNotThrow(() => el.fire("input", { isComposing: false }));
    assert.match(String(warns[0][0]), /^\[plexus\]/);
  } finally { console.warn = orig; }
});

function autoSetup() {
  const attached = [];
  const suggest = { attach: (el) => { const rec = { el, detached: false }; attached.push(rec); return () => { rec.detached = true; }; } };
  const doc = new Target();
  doc.activeElement = null;
  const timers = [];
  const disposer = installSuggestAutoAttach({ doc, suggest, setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {} });
  const field = (matches = true, inside = true, portal = false) => {
    const t = new Target();
    t.matches = (sel) => matches && sel === SUGGEST_SELECTOR;
    t.closest = (sel) => (inside && sel === ".excalidraw-outer-container" ? {} : null);
    t.classList = { contains: (c) => portal && c === "plexus-portal" };
    return t;
  };
  return { doc, attached, timers, disposer, field };
}

test("auto-attach attaches matching fields inside the editor or plexus portals only", () => {
  const a = autoSetup();
  a.doc.fire("focusin", { target: a.field(false) });
  a.doc.fire("focusin", { target: a.field(true, false) });
  assert.equal(a.attached.length, 0);
  a.doc.fire("focusin", { target: a.field(true, true) });
  a.doc.fire("focusin", { target: a.field(true, false, true) });
  assert.equal(a.attached.length, 2);
  assert.equal(a.attached[0].detached, true, "only one element attached at a time");
});

test("auto-attach detaches on a deferred focusout unless focus returned; dispose cleans up", () => {
  const a = autoSetup();
  const f = a.field();
  a.doc.fire("focusin", { target: f });
  a.doc.fire("focusin", { target: f });
  assert.equal(a.attached.length, 1);
  f.fire("focusout");
  a.doc.activeElement = f;
  a.timers.shift()();
  assert.equal(a.attached[0].detached, false);
  f.fire("focusout");
  a.doc.activeElement = null;
  a.timers.shift()();
  assert.equal(a.attached[0].detached, true);
  assert.equal(f.count(), 0);
  a.doc.fire("focusin", { target: f });
  a.disposer();
  assert.equal(a.attached[1].detached, true);
  assert.equal(a.doc.count(), 0);
  assert.equal(f.count(), 0);
});

test("setValue skips React's own-instance value accessor and uses the prototype setter", async () => {
  const s = setup({ search: async () => [{ ":block/uid": "u", ":node/title": "Plexus" }] });
  const el = makeInput("[[pl");
  const own = [];
  Object.defineProperty(el, "value", { configurable: true, get: () => el._v, set: (v) => { own.push(v); } });
  s.suggest.attach(el);
  typeText(el, "[[pl");
  s.tick();
  await flush();
  key(el, "Enter");
  assert.deepEqual(own, []);
  assert.deepEqual(el.setterCalls, ["[[Plexus]]"]);
});

test("Enter while a new search is loading is consumed but neither picks nor closes; then picks the new first row", async () => {
  const pending = [];
  const s = setup({ search: (args) => new Promise((res) => { pending.push({ args, res }); }) });
  const el = makeInput("");
  s.suggest.attach(el);
  const rows = (q) => ["A", "B", "C"].map((t, i) => ({ ":block/uid": `${q}${i}`, ":node/title": `${q}${t}` }));
  typeText(el, "[[x");
  s.tick();
  pending[0].res(rows("x"));
  await flush();
  key(el, "ArrowDown");
  key(el, "ArrowDown");
  typeText(el, "[[xy");
  const e = key(el, "Enter");
  assert.equal(e.defaultPrevented, true);
  assert.equal(el.setterCalls.length, 0);
  assert.equal(s.roots().length, 1);
  s.tick();
  pending[1].res(rows("y"));
  await flush();
  key(el, "Enter");
  assert.deepEqual(el.setterCalls, ["[[yA]]"]);
});
