import assert from "node:assert/strict";
import test from "node:test";

import { openEmbedPicker } from "../src/view/embed-picker.js";

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
  getBoundingClientRect() { return { height: 200 }; }
}

function* walk(n) { yield n; for (const c of n.children) yield* walk(c); }

function setup({ search, pull, util, semanticSearch, opts = {} } = {}) {
  const view = new Target();
  view.innerHeight = 800;
  view.innerWidth = 1200;
  const body = new Node("body");
  const doc = new Target();
  Object.assign(doc, { defaultView: view, body, activeElement: null });
  doc.createElement = (t) => new Node(t, doc);
  const timers = new Map();
  let id = 0;
  const setT = (fn, ms) => { timers.set(++id, { fn, ms }); return id; };
  const clearT = (i) => timers.delete(i);
  const runTimers = (maxMs = Infinity) => { for (const [i, t] of [...timers.entries()]) { if (t.ms > maxMs) continue; timers.delete(i); t.fn(); } };
  const frames = [];
  const calls = [];
  const api = {
    data: {
      async: { search: (a) => { calls.push(a); return (search || (async () => []))(a); } },
      pull: pull || (async () => null),
    },
  };
  if (semanticSearch) api.data.async.semanticSearch = semanticSearch;
  if (util) api.util = util;
  const picks = [];
  const creates = [];
  const open = (extra = {}) => openEmbedPicker({
    doc, api, anchorRect: { left: 50, top: 60, bottom: 80 }, zIndex: 5, semantic: false,
    onPick: (p) => picks.push(p), onCreate: (t) => creates.push(t),
    now: () => new Date(2026, 8, 29), setTimeout: setT, clearTimeout: clearT, requestFrame: (fn) => frames.push(fn),
    ...opts, ...extra,
  });
  const frame = () => { while (frames.length) frames.shift()(); };
  const root = () => body.children.find((c) => /plexus-picker/.test(c.className));
  const input = () => [...walk(root())].find((n) => n.tagName === "INPUT");
  return { doc, view, body, api, calls, picks, creates, open, frame, root, input, runTimers, timers };
}

const flush = () => new Promise((r) => setImmediate(r));
const rowTitles = (root) => [...walk(root)].filter((n) => /dont-unfocus-block/.test(n.className)).map((n) => n.attrs.title);
const type = async (s, text) => { const i = s.input(); i.value = text; i.fire("input"); s.runTimers(); await flush(); await flush(); };
const key = (s, k, extra = {}) => s.input().fire("keydown", { key: k, ...extra });
const page = (title) => ({ ":node/title": title, ":block/uid": `u-${title}` });

test("opens on the next frame with native markup, focused, high z-index, and no search on a blank query", async () => {
  const s = setup();
  const h = s.open();
  assert.equal(s.root(), undefined);
  s.frame();
  assert.match(s.root().className, /rm-autocomplete__results bp3-elevation-3 plexus-portal plexus-picker/);
  assert.equal(s.input().className, "plexus-portal plexus-picker-input");
  assert.equal(s.root().style.zIndex, "100003");
  assert.equal(s.doc.activeElement, s.input());
  assert.equal(s.calls.length, 0);
  assert.equal(rowTitles(s.root()).length, 1);
  h.close();
  assert.equal(s.root(), undefined);
  assert.equal(s.view.listeners.length, 0);
});

test("single instance: opening again refocuses and returns the same handle", () => {
  const s = setup();
  const a = s.open();
  s.frame();
  const before = s.input().focused;
  const b = s.open();
  assert.equal(a, b);
  assert.equal(s.body.children.filter((c) => /plexus-picker/.test(c.className)).length, 1);
  assert.equal(s.input().focused, before + 1);
  a.close();
  const c = s.open();
  assert.notEqual(c, a);
  c.close();
});

test("root stops pointer and click events; mousedown is prevented", () => {
  const s = setup();
  s.open();
  s.frame();
  for (const t of ["pointerdown", "mousedown", "click"]) assert.equal(s.root().fire(t).propagationStopped, true);
  assert.equal(s.root().fire("mousedown").defaultPrevented, true);
});

test("input keydown never propagates; Escape closes", () => {
  const s = setup();
  s.open();
  s.frame();
  assert.equal(key(s, "a").propagationStopped, true);
  const e = key(s, "Escape");
  assert.equal(e.propagationStopped, true);
  assert.equal(s.root(), undefined);
});

test("searches pages and blocks in parallel with limit 8; Enter picks the first page", async () => {
  const s = setup({
    search: async (a) => (a["search-pages"] ? [page("Plexus"), page("Plex two")] : [{ ":block/uid": "abcdefghi", ":block/string": "plex block" }]),
    pull: async (q) => (/node\/title/.test(q) && !/block\/page/.test(q) ? null : { ":block/page": { ":node/title": "Home" } }),
  });
  s.open();
  s.frame();
  await type(s, "plex");
  assert.deepEqual(s.calls.map((c) => [c["search-pages"], c["search-blocks"], c.limit]), [[true, false, 8], [false, true, 8]]);
  assert.deepEqual(rowTitles(s.root()), ["Plexus", "Plex two", "plex block", "plex"]);
  key(s, "Enter");
  assert.deepEqual(s.picks, [{ kind: "page", ref: "[[Plexus]]", title: "Plexus", uid: "u-Plexus" }]);
  assert.equal(s.root(), undefined);
  assert.deepEqual(s.creates, []);
});

test("prefixes restrict the search kind", async () => {
  const s = setup({ search: async () => [] });
  s.open();
  s.frame();
  await type(s, "((abc");
  assert.deepEqual(s.calls.map((c) => [c["search-pages"], c["search-blocks"], c["search-str"]]), [[false, true, "abc"]]);
  await type(s, "[[abc");
  assert.deepEqual(s.calls.slice(1).map((c) => [c["search-pages"], c["search-blocks"], c["search-str"]]), [[true, false, "abc"]]);
  await type(s, "[[");
  assert.equal(s.calls.length, 2);
});

test("stale responses are dropped by sequence number", async () => {
  const pending = [];
  const s = setup({ search: (a) => new Promise((res) => pending.push({ a, res })) });
  s.open();
  s.frame();
  s.input().value = "aa";
  s.input().fire("input");
  s.runTimers();
  const first = pending.splice(0);
  s.input().value = "bb";
  s.input().fire("input");
  s.runTimers();
  const second = pending.splice(0);
  second.forEach((p) => p.res(p.a["search-pages"] ? [page("Second")] : []));
  await flush(); await flush();
  first.forEach((p) => p.res(p.a["search-pages"] ? [page("First")] : []));
  await flush(); await flush();
  assert.ok(rowTitles(s.root()).includes("Second"));
  assert.ok(!rowTitles(s.root()).includes("First"));
});

test("a Today row shows for blank or a 2+ letter prefix and picks the plexus:today token", async () => {
  const s = setup({ search: async () => [] });
  s.open();
  s.frame();
  key(s, "Enter");
  assert.deepEqual(s.picks, [{ kind: "today", ref: "plexus:today", title: "Today" }]);
  const t = setup({ search: async () => [] });
  t.open();
  t.frame();
  await type(t, "to");
  const labels = () => [...walk(t.root())].filter((n) => n.textContent).map((n) => n.textContent);
  assert.ok(labels().includes("Today (always today)"));
  await type(t, "t");
  assert.equal(labels().includes("Today (always today)"), false);
});

test("create row: last, not default, explicit only; picks call onCreate after closing", async () => {
  const s = setup({ search: async (a) => (a["search-pages"] ? [page("New thing two")] : []) });
  s.open();
  s.frame();
  await type(s, "New thing");
  assert.deepEqual(rowTitles(s.root()), ["New thing two", "New thing"]);
  assert.deepEqual(s.creates, []);
  key(s, "ArrowUp");
  key(s, "Enter");
  assert.deepEqual(s.creates, ["New thing"]);
  assert.deepEqual(s.picks, []);
  assert.equal(s.root(), undefined);
});

test("create row hidden when the title exists (results or pull) and for block-only queries", async () => {
  const s = setup({ search: async (a) => (a["search-pages"] ? [page("Exact")] : []) });
  s.open();
  s.frame();
  await type(s, "exact");
  assert.deepEqual(rowTitles(s.root()), ["Exact"]);
  const t = setup({ search: async () => [], pull: async (q, [, title]) => (title === "hidden" ? { ":node/title": "hidden" } : null) });
  t.open();
  t.frame();
  await type(t, "hidden");
  assert.equal(rowTitles(t.root()).some((x) => /Create/.test(x)), false);
  await type(t, "((blocky");
  assert.equal(rowTitles(t.root()).includes("blocky"), false);
});

test("natural-date row uses dateToPageTitle and is absent without util", async () => {
  const s = setup({ util: { dateToPageTitle: (d) => `D${d.getDate()}` }, search: async () => [] });
  s.open();
  s.frame();
  await type(s, "tomorrow");
  assert.ok(rowTitles(s.root()).includes("D30"));
  key(s, "Enter");
  assert.deepEqual(s.picks[0], { kind: "page", ref: "[[D30]]", title: "D30", uid: undefined });
  const t = setup({ search: async () => [] });
  t.open();
  t.frame();
  await type(t, "tomorrow");
  assert.equal(rowTitles(t.root()).includes("D30"), false);
});

test("a bare or wrapped uid that resolves adds a direct row; an unresolved word does not", async () => {
  const s = setup({
    search: async () => [],
    pull: async (q, [attr, v]) => (attr === ":block/uid" && v === "abcdefghi" && /block\/string/.test(q) ? { ":block/uid": v, ":block/string": "direct hit" } : null),
  });
  s.open();
  s.frame();
  await type(s, "((abcdefghi))");
  assert.ok(rowTitles(s.root()).includes("direct hit"));
  key(s, "Enter");
  assert.deepEqual(s.picks[0], { kind: "block", ref: "((abcdefghi))", title: "direct hit", uid: "abcdefghi" });
  const t = setup({ search: async () => [], pull: async () => null });
  t.open();
  t.frame();
  await type(t, "Something");
  assert.deepEqual(rowTitles(t.root()), ["Something"]);
  key(t, "Enter");
  assert.deepEqual(t.picks, []);
  assert.deepEqual(t.creates, ["Something"]);
});

test("Related section only when semantic is true and the API works; failures and timeouts hide it", async () => {
  const sem = async () => [{ ":block/uid": "rel000001", ":block/string": "related text" }];
  const on = setup({ search: async () => [], semanticSearch: sem, opts: { semantic: true } });
  on.open();
  on.frame();
  await type(on, "idea");
  await flush();
  assert.ok(rowTitles(on.root()).includes("related text"));
  assert.ok([...walk(on.root())].some((n) => n.textContent === "Related"));
  key(on, "ArrowDown");
  const off = setup({ search: async () => [], semanticSearch: sem, opts: { semantic: false } });
  off.open();
  off.frame();
  await type(off, "idea");
  await flush();
  assert.equal(rowTitles(off.root()).includes("related text"), false);
  const bad = setup({ search: async () => [], semanticSearch: async () => { throw new Error("disabled"); }, opts: { semantic: true } });
  bad.open();
  bad.frame();
  await type(bad, "idea");
  await flush();
  assert.equal([...walk(bad.root())].some((n) => n.textContent === "Related"), false);
  const slow = setup({ search: async () => [], semanticSearch: () => new Promise(() => {}), opts: { semantic: true } });
  slow.open();
  slow.frame();
  await type(slow, "idea");
  slow.runTimers();
  await flush();
  assert.equal([...walk(slow.root())].some((n) => n.textContent === "Related"), false);
});

test("focus is retaken once inside the grace window; a later blur closes; listeners go away", () => {
  const s = setup();
  s.open();
  s.frame();
  const i = s.input();
  s.doc.activeElement = null;
  i.fire("blur");
  assert.ok(s.root());
  assert.equal(s.doc.activeElement, i);
  i.fire("blur");
  assert.equal(s.root(), undefined);
  assert.equal(s.view.listeners.length, 0);
});

test("outside pointerdown closes; inside does not", () => {
  const s = setup();
  s.open();
  s.frame();
  s.view.fire("pointerdown", { target: s.input() });
  assert.ok(s.root());
  s.view.fire("pointerdown", { target: new Node("div", s.doc) });
  assert.equal(s.root(), undefined);
});

test("close before the frame fires leaves nothing behind; callback errors are caught", async () => {
  const s = setup();
  const h = s.open();
  h.close();
  s.frame();
  assert.equal(s.root(), undefined);
  const t = setup({ search: async () => [], opts: { onPick: () => { throw new Error("x"); } } });
  t.open();
  t.frame();
  key(t, "Enter");
  assert.equal(t.root(), undefined);
});

test("onClose reports picked false on Escape and true after a commit; mousedown in the input keeps its default", async () => {
  const s = setup();
  const closes = [];
  s.open({ onClose: (o) => closes.push(o) });
  s.frame();
  assert.equal(s.input().fire("mousedown").defaultPrevented, false);
  assert.equal(s.root().fire("mousedown", { target: s.root() }).defaultPrevented, true);
  key(s, "Escape");
  assert.deepEqual(closes, [{ picked: false }]);
  const p = setup({ search: async (a) => (a["search-pages"] ? [page("Plexus")] : []) });
  const pcloses = [];
  p.open({ onClose: (o) => pcloses.push(o) });
  p.frame();
  await type(p, "plex");
  key(p, "Enter");
  assert.deepEqual(pcloses, [{ picked: true }]);
  assert.equal(p.picks.length, 1);
});
