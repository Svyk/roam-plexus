import assert from "node:assert/strict";
import test from "node:test";

import { createDock, PLEXUS_REF_MIME } from "../src/view/dock.js";

// ---- a small DOM with capture/bubble dispatch ----

function matchOne(n, sel) {
  const PART = /\.[\w-]+|:not\(\.[\w-]+\)|\[id\^="[^"]*"\]|\[[\w-]+\]/g;
  const m = /^([a-z]+)?((?:\.[\w-]+|:not\(\.[\w-]+\)|\[id\^="[^"]*"\]|\[[\w-]+\])*)$/i.exec(sel.trim());
  if (!m) return false;
  if (m[1] && n.tagName !== m[1].toUpperCase()) return false;
  for (const part of m[2].match(PART) ?? []) {
    if (part.startsWith(".")) { if (!n.classList.contains(part.slice(1))) return false; }
    else if (part.startsWith(":not")) { if (n.classList.contains(part.slice(6, -1))) return false; }
    else if (part.startsWith("[id")) { if (!String(n.id).startsWith(/"([^"]*)"/.exec(part)[1])) return false; }
    else if (n.attrs?.[part.slice(1, -1)] == null) return false;
  }
  return true;
}
const matches = (n, sel) => sel.split(",").some((s) => matchOne(n, s));

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = true;
    this.isTrusted = true;
    Object.assign(this, init);
    this.defaultPrevented = false;
    this.stopped = false;
    this.immediate = false;
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.stopped = true; }
  stopImmediatePropagation() { this.stopped = true; this.immediate = true; }
}

class FakeNode {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase();
    this.ownerDoc = doc;
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.attrs = {};
    this.id = "";
    this.value = "";
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.textContent = "";
    this.listeners = [];
    this.removed = false;
    this._classes = new Set();
    const self = this;
    this.classList = {
      add: (c) => self._classes.add(c),
      remove: (c) => self._classes.delete(c),
      contains: (c) => self._classes.has(c),
    };
  }
  get className() { return [...this._classes].join(" "); }
  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  append(...c) { for (const n of c) this.insertBefore(n, null); }
  insertBefore(n, ref) {
    if (n.parentNode) n.parentNode.children.splice(n.parentNode.children.indexOf(n), 1);
    n.parentNode = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(n); else this.children.splice(i, 0, n);
    n.removed = false;
  }
  remove() {
    if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
    this.parentNode = null;
    this.removed = true;
  }
  addEventListener(type, fn, capture = false) { this.listeners.push({ type, fn, capture: !!capture }); }
  removeEventListener(type, fn, capture = false) {
    const i = this.listeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === !!capture);
    if (i >= 0) this.listeners.splice(i, 1);
  }
  all() { const out = []; for (const c of this.children) { out.push(c, ...c.all()); } return out; }
  querySelectorAll(sel) { return this.all().filter((n) => matches(n, sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  closest(sel) { for (let n = this; n; n = n.parentNode) if (n.tagName && matches(n, sel)) return n; return null; }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 30 }; }
  focus() {
    const doc = this.ownerDoc;
    if (doc.activeElement === this) return;
    doc.activeElement = this;
    doc.dispatchEvent(new FakeEvent("focusin", { target: this }), this);
  }
  blur() { if (this.ownerDoc.activeElement === this) this.ownerDoc.activeElement = this.ownerDoc.body; }
  dispatchEvent(ev) { return dispatchOn(this, ev); }
}

function pathOf(target) {
  const path = [];
  for (let n = target; n; n = n.parentNode) path.push(n);
  return path;
}

function runListeners(node, ev, capture) {
  for (const l of [...node.listeners]) {
    if (l.type !== ev.type || l.capture !== capture) continue;
    ev.currentTarget = node;
    l.fn(ev);
    if (ev.immediate) return true;
  }
  return false;
}

function dispatchOn(target, ev) {
  ev.target = ev.target ?? target;
  const path = pathOf(ev.target);
  const rev = path.slice().reverse();
  for (const n of rev) {
    if (runListeners(n, ev, true) || ev.stopped) return !ev.defaultPrevented;
  }
  if (ev.bubbles) {
    for (const n of path) {
      if (runListeners(n, ev, false) || ev.stopped) break;
    }
  }
  return !ev.defaultPrevented;
}

function makeDoc() {
  const doc = new FakeNode("#document", null);
  doc.ownerDoc = doc;
  doc.body = new FakeNode("body", doc);
  doc.head = new FakeNode("head", doc);
  doc.append(doc.head, doc.body);
  doc.activeElement = doc.body;
  doc.createElement = (tag) => new FakeNode(tag, doc);
  doc.dispatchEvent = (ev) => dispatchOn(ev.target ?? doc, ev);
  doc.defaultView = {
    innerWidth: 1600,
    listeners: [],
    addEventListener(type, fn) { this.listeners.push({ type, fn }); },
    removeEventListener(type, fn) { this.listeners = this.listeners.filter((l) => !(l.type === type && l.fn === fn)); },
    dispatched: [],
    dispatchEvent(ev) { this.dispatched.push(ev); return true; },
    KeyboardEvent: FakeEvent,
    MouseEvent: FakeEvent,
    Event: FakeEvent,
  };
  return doc;
}

// ---- setup ----

const DRAWING = "drawing01";
const PARENT = "parentuid";

function setup({ children = ["child0001", "child0002", "child0003"], parent = { uid: PARENT, isPage: false, title: "P".repeat(80), pageTitle: "My Page" }, width0, state = {} } = {}) {
  const doc = makeDoc();
  const view = doc.defaultView;
  const outerEl = new FakeNode("div", doc);
  outerEl.className = "excalidraw-outer-container full-screen";
  outerEl.moListeners = [];
  const containerEl = new FakeNode("div", doc);
  outerEl.append(containerEl);
  doc.body.append(outerEl);
  containerEl.focus = () => { doc.activeElement = containerEl; };
  const timers = [];
  const frameQueue = [];
  const log = { rendered: [], unmounted: [], watches: [], unwatched: 0, pulls: 0, closed: 0, widths: [], toasts: [], added: [], escapes: [] };
  const tree = { children: children.map((uid, order) => ({ ":block/uid": uid, ":block/order": order })) };
  const roots = { [DRAWING]: tree, [PARENT]: { children: [{ ":block/uid": DRAWING, ":block/order": 0 }, { ":block/uid": "sibling01", ":block/order": 1 }] } };
  const api = {
    data: {
      pull: (_p, ident) => { log.pulls += 1; const uid = /"([^"]+)"/.exec(ident)[1]; return { ":block/children": roots[uid]?.children ?? [] }; },
      addPullWatch: (p, ident, cb) => log.watches.push({ ident, cb, off: false }),
      removePullWatch: (p, ident, cb) => { log.unwatched += 1; const w = log.watches.find((x) => x.cb === cb); if (w) w.off = true; },
    },
    ui: {
      components: {
        renderBlock: (args) => {
          log.rendered.push(args);
          const input = args.el.ownerDoc.createElement("div");
          input.className = "rm-block__input";
          input.id = `block-input-win-${args.uid}`;
          args.el.append(input);
        },
        unmountNode: ({ el }) => log.unmounted.push(el),
      },
      multiselect: { getSelected: async () => log.selected ?? [] },
    },
  };
  const app = {
    state: { width: width0, selectedElementIds: { a: true }, selectedGroupIds: {}, theme: "dark", ...state },
    getSceneElements: () => [{ id: "a", isDeleted: false }],
    updated: [],
    updateScene(u) { this.updated.push(u); Object.assign(this.state, u.appState); },
  };
  const mos = [];
  class FakeMO {
    constructor(cb) { this.cb = cb; this.disconnected = false; mos.push(this); }
    observe(target, opts) { this.target = target; this.opts = opts; }
    disconnect() { this.disconnected = true; }
  }
  const dock = createDock({
    doc, api, app, containerEl, outerEl, drawingUid: DRAWING, zIndex: 1000, width: 320,
    onWidth: (w) => log.widths.push(w),
    onClose: () => { log.closed += 1; },
    parentOf: () => parent,
    addBlock: async (root) => { log.added.push(root); return "newblock01"; },
    toast: (m) => log.toasts.push(m),
    raf: (cb) => { frameQueue.push(cb); return frameQueue.length; },
    setTimeout: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.cleared = true; },
    MutationObserver: FakeMO,
    now: () => clock.t,
  });
  const clock = { t: 10000 };
  const runFrames = async (n = 1) => {
    for (let i = 0; i < n; i++) { const q = frameQueue.splice(0); for (const cb of q) cb(); await Promise.resolve(); await Promise.resolve(); }
  };
  const fire = async (ms) => {
    const due = timers.filter((t) => !t.cleared && t.ms <= ms);
    for (const t of due) { t.cleared = true; t.fn(); }
    for (let i = 0; i < 4; i++) await Promise.resolve();
  };
  const flushAll = async () => { for (let i = 0; i < 6; i++) { await runFrames(1); await fire(1e9); } };
  return { doc, view, outerEl, containerEl, dock, api, app, log, mos, timers, frameQueue, runFrames, fire, flushAll, clock, tree, roots };
}

const textarea = (t, uid, { value = "hello", start = 3, end = 3 } = {}) => {
  const host = t.dock.el.querySelectorAll(".plexus-dock-child").find((h) => h.querySelector(`.rm-block__input`)?.id.endsWith(uid));
  const ta = t.doc.createElement("textarea");
  ta.id = `block-input-win-${uid}`;
  ta.value = value;
  ta.selectionStart = start;
  ta.selectionEnd = end;
  (host ?? t.dock.el).append(ta);
  return ta;
};
const key = (target, k, init = {}) => {
  const ev = new FakeEvent("keydown", { key: k, ...init });
  ev.target = target;
  target.dispatchEvent(ev);
  return ev;
};

// ---- tests ----

test("opens: renders each direct child with open? true, no root row, narrows via class and owned style", () => {
  const t = setup();
  assert.deepEqual(t.log.rendered.map((r) => r.uid), ["child0001", "child0002", "child0003"]);
  assert.ok(t.log.rendered.every((r) => r["open?"] === true));
  assert.ok(!t.log.rendered.some((r) => r.uid === DRAWING));
  assert.ok(t.dock.isOpen());
  assert.equal(t.dock.root(), "drawing");
  assert.ok(t.outerEl.classList.contains("plexus-dock-narrowed"));
  assert.deepEqual(t.outerEl.style, {}, "no inline style on Roam's container");
  assert.ok(t.doc.body.classList.contains("plexus-dock-open"));
  const style = t.doc.head.children.find((n) => n.tagName === "STYLE");
  assert.match(style.textContent, /--plexus-dock-w: 320px/);
  assert.match(style.textContent, /--plexus-dock-z: 1002;/);
  assert.equal(t.dock.el.style.zIndex, "1002");
  assert.equal(t.dock.el.attrs["data-theme"], "light");
  assert.equal(t.dock.el.parentNode, t.doc.body);
  assert.equal(t.log.watches.length, 1);
  assert.match(t.log.watches[0].ident, /drawing01/);
});

test("effective width is clamped to innerWidth/2 and 240-640, and follows window resize without persisting", async () => {
  const t = setup();
  t.view.innerWidth = 500;
  t.view.listeners.find((l) => l.type === "resize").fn();
  await t.runFrames();
  const style = t.doc.head.children.find((n) => n.tagName === "STYLE");
  assert.match(style.textContent, /--plexus-dock-w: 250px/);
  assert.deepEqual(t.log.widths, []);
  t.view.innerWidth = 1600;
  t.view.listeners.find((l) => l.type === "resize").fn();
  await t.runFrames();
  assert.match(style.textContent, /--plexus-dock-w: 320px/);
});

test("resize handle: once per frame while dragging, onWidth once on pointerup, clamped", async () => {
  const t = setup();
  const handle = t.dock.el.children[0];
  const down = new FakeEvent("pointerdown", { clientX: 1000, pointerId: 1 });
  down.target = handle;
  handle.dispatchEvent(down);
  assert.ok(down.defaultPrevented);
  for (const x of [900, 800, 700]) { const m = new FakeEvent("pointermove", { clientX: x }); m.target = handle; handle.dispatchEvent(m); }
  assert.equal(t.frameQueue.length, 1, "one apply queued for three moves");
  await t.runFrames();
  const style = t.doc.head.children.find((n) => n.tagName === "STYLE");
  assert.match(style.textContent, /--plexus-dock-w: 620px/);
  const far = new FakeEvent("pointermove", { clientX: -5000 });
  far.target = handle;
  handle.dispatchEvent(far);
  await t.runFrames();
  assert.match(style.textContent, /--plexus-dock-w: 640px/);
  const up = new FakeEvent("pointerup");
  up.target = handle;
  handle.dispatchEvent(up);
  const lost = new FakeEvent("lostpointercapture");
  lost.target = handle;
  handle.dispatchEvent(lost);
  assert.deepEqual(t.log.widths, [640]);
});

test("narrowing check: unchanged width after 2 frames dispatches one resize, then falls back to overlay below the minimize button", async () => {
  const t = setup({ width0: 800 });
  const icon = new FakeNode("span", t.doc);
  icon.className = "bp3-icon-minimize";
  icon.getBoundingClientRect = () => ({ bottom: 41.2 });
  t.outerEl.append(icon);
  await t.runFrames(2);
  assert.equal(t.view.dispatched.length, 1);
  assert.equal(t.view.dispatched[0].type, "resize");
  assert.equal(t.dock.mode(), "narrowed", "still deciding");
  await t.runFrames(2);
  assert.equal(t.dock.mode(), "overlay");
  assert.ok(!t.outerEl.classList.contains("plexus-dock-narrowed"));
  assert.ok(t.dock.el.classList.contains("plexus-dock--overlay"));
  assert.equal(t.dock.el.style.top, "42px");
});

test("narrowing check: a changed width keeps the narrowed mode with no extra resize", async () => {
  const t = setup({ width0: 800 });
  t.app.state.width = 480;
  await t.runFrames(2);
  assert.equal(t.dock.mode(), "narrowed");
  assert.equal(t.view.dispatched.length, 0);
  assert.ok(t.outerEl.classList.contains("plexus-dock-narrowed"));
});

test("header: label is the page title with a [[ref]] drag payload and copyLink", () => {
  const t = setup();
  const label = t.dock.el.children[1].children[0];
  assert.equal(label.textContent, "My Page");
  assert.equal(label.draggable, true);
  const data = {};
  const dt = { setData: (k, v) => { data[k] = v; }, effectAllowed: "" };
  const ev = new FakeEvent("dragstart", { dataTransfer: dt });
  ev.target = label;
  label.dispatchEvent(ev);
  assert.deepEqual(data, { [PLEXUS_REF_MIME]: "[[My Page]]" });
  assert.equal(dt.effectAllowed, "copyLink");
  const md = new FakeEvent("mousedown");
  md.target = label;
  label.dispatchEvent(md);
  assert.ok(!md.defaultPrevented, "a cancelled mousedown would suppress the native drag");
});

test("header: starting a label drag leaves editing without taking container focus", () => {
  const t = setup();
  const ta = textarea(t, "child0002");
  ta.focus();
  assert.equal(t.doc.activeElement, ta);
  const label = t.dock.el.children[1].children[0];
  const ev = new FakeEvent("dragstart", { dataTransfer: { setData() {}, effectAllowed: "" } });
  ev.target = label;
  label.dispatchEvent(ev);
  assert.notEqual(t.doc.activeElement, ta);
  assert.notEqual(t.doc.activeElement, t.containerEl);
});

test("Parent toggle: hidden when the drawing sits on a page; re-renders the parent's children, label is 60 chars with a ((ref))", async () => {
  const page = setup({ parent: { uid: "pageuid01", isPage: true, title: "T", pageTitle: "T" } });
  assert.equal(page.dock.el.children[1].children[1].hidden, true);
  assert.equal(await page.dock.setRoot("parent"), false);

  const t = setup();
  const parentBtn = t.dock.el.children[1].children[1];
  assert.equal(parentBtn.hidden, false);
  parentBtn.dispatchEvent(Object.assign(new FakeEvent("click"), { target: parentBtn }));
  await t.flushAll();
  assert.equal(t.dock.root(), "parent");
  assert.equal(t.dock.rootUid(), PARENT);
  assert.ok(t.log.unwatched >= 1, "old watch removed");
  assert.equal(t.log.rendered.at(-1).uid, "sibling01");
  assert.ok(!t.log.rendered.some((r) => r.uid === DRAWING), "the open drawing is never rendered inside its own dock");
  assert.deepEqual(t.dock.el.querySelectorAll(".plexus-dock-child").map((h) => h.children[0].id.slice(-9)), ["sibling01"]);
  assert.ok(t.dock.el.classList.contains("plexus-dock--parent-root"));
  const label = t.dock.el.children[1].children[0];
  assert.equal(label.textContent.length, 60);
  const data = {};
  const ev = new FakeEvent("dragstart", { dataTransfer: { setData: (k, v) => { data[k] = v; } } });
  ev.target = label;
  label.dispatchEvent(ev);
  assert.equal(data[PLEXUS_REF_MIME], `((${PARENT}))`);
  assert.equal(parentBtn.attrs["aria-pressed"], "true");
  parentBtn.dispatchEvent(Object.assign(new FakeEvent("click"), { target: parentBtn }));
  await t.flushAll();
  assert.equal(t.dock.root(), "drawing");
  assert.equal(t.dock.el.classList.contains("plexus-dock--parent-root"), false);
});

test("child watch: add, remove and reorder diff the hosts and keep untouched hosts mounted", () => {
  const t = setup();
  const before = new Map(t.dock.el.querySelectorAll(".plexus-dock-child").map((h) => [h.children[0].id, h]));
  const cb = t.log.watches[0].cb;
  const mk = (uids) => ({ ":block/children": uids.map((u, i) => ({ ":block/uid": u, ":block/order": i })) });
  cb(null, mk(["child0001", "child0002", "child0003", "child0004"]));
  let hosts = t.dock.el.querySelectorAll(".plexus-dock-child");
  assert.equal(hosts.length, 4);
  assert.equal(t.log.rendered.at(-1).uid, "child0004");
  assert.equal(t.log.unmounted.length, 0);
  cb(null, mk(["child0001", "child0003", "child0004"]));
  assert.equal(t.log.unmounted.length, 1);
  assert.equal(t.log.unmounted[0], before.get("block-input-win-child0002"));
  cb(null, mk(["child0004", "child0001", "child0003"]));
  hosts = t.dock.el.querySelectorAll(".plexus-dock-child");
  assert.deepEqual(hosts.map((h) => h.children[0].id.slice(-9)), ["child0004", "child0001", "child0003"]);
  assert.equal(t.log.unmounted.length, 1, "reorder does not remount");
  const renders = t.log.rendered.length;
  cb(null, mk(["child0004", "child0001", "child0003"]));
  assert.equal(t.log.rendered.length, renders, "same list is a no-op");
  cb(null, null);
  assert.equal(t.dock.el.querySelectorAll(".plexus-dock-child").length, 0);
});

test("focus follows a new block after Enter (click-to-focus on its .rm-block__input)", async () => {
  const t = setup();
  const ta = textarea(t, "child0003");
  ta.focus();
  assert.ok(ta.ownerDoc.activeElement === ta);
  const cb = t.log.watches[0].cb;
  const seen = [];
  const render = t.api.ui.components.renderBlock;
  t.api.ui.components.renderBlock = (args) => {
    render(args);
    if (args.uid !== "newblock01") return;
    const input = args.el.children[0];
    for (const type of ["mousedown", "mouseup", "click"]) input.addEventListener(type, () => seen.push(type));
    input.addEventListener("click", () => {
      const next = t.doc.createElement("textarea");
      next.id = "block-input-win-newblock01";
      input.parentNode.append(next);
      next.focus();
    });
  };
  cb(null, { ":block/children": ["child0001", "child0002", "child0003", "newblock01"].map((u, i) => ({ ":block/uid": u, ":block/order": i })) });
  await t.flushAll();
  assert.deepEqual(seen, ["mousedown", "mouseup", "click"]);
  assert.ok(t.doc.activeElement.id.endsWith("newblock01"));
});

test("focus follows a moved block (Tab nests it): its focused uid leaves the direct list and is refocused", async () => {
  const t = setup();
  const ta = textarea(t, "child0002");
  ta.focus();
  t.log.watches[0].cb(null, { ":block/children": ["child0001", "child0003"].map((u, i) => ({ ":block/uid": u, ":block/order": i })) });
  // Roam now renders child0002 nested inside child0001's dock copy
  const nested = t.doc.createElement("div");
  nested.className = "rm-block__input";
  nested.id = "block-input-win-child0002";
  t.dock.el.querySelectorAll(".plexus-dock-child")[0].append(nested);
  let clicked = 0;
  nested.addEventListener("click", () => { clicked += 1; });
  await t.flushAll();
  assert.equal(clicked, 1);
});

test("focus follow: a deleted or merged focused block hands focus to the block drawn above it", async () => {
  const t = setup();
  const ta = textarea(t, "child0002");
  ta.focus();
  const pull = t.api.data.pull;
  t.api.data.pull = (p, ident) => (p === "[:block/uid]" && /child0002/.test(ident) ? null : pull(p, ident));
  let clicked = [];
  for (const h of t.dock.el.querySelectorAll(".plexus-dock-child")) {
    const input = h.querySelector(".rm-block__input");
    input.addEventListener("click", () => clicked.push(input.id.slice(-9)));
  }
  t.log.watches[0].cb(null, { ":block/children": ["child0001", "child0003"].map((u, i) => ({ ":block/uid": u, ":block/order": i })) });
  await t.flushAll();
  assert.deepEqual(clicked, ["child0001"], "focus follows the previous sibling, not the dead uid");
});

test("focus follow: with nothing to follow, editing ends so the focus-lost rule stops swallowing keys", async () => {
  const t = setup({ children: ["child0001"] });
  const ta = textarea(t, "child0001");
  ta.focus();
  const pull = t.api.data.pull;
  t.api.data.pull = (p, ident) => (p === "[:block/uid]" ? null : pull(p, ident));
  t.log.watches[0].cb(null, { ":block/children": [] });
  await t.flushAll();
  ta.remove();
  t.doc.activeElement = t.doc.body;
  t.clock.t += 50;
  const outside = new FakeEvent("keydown", { key: "x" });
  outside.target = t.doc.body;
  t.doc.body.dispatchEvent(outside);
  assert.equal(outside.defaultPrevented, false);
});

test("typing in a dock block reads nothing from Roam", async () => {
  const t = setup();
  const ta = textarea(t, "child0002", { value: "abcdef", start: 3, end: 3 });
  ta.focus();
  const pulls = t.log.pulls;
  const rendered = t.log.rendered.length;
  for (let i = 0; i < 50; i++) {
    key(ta, i % 5 === 0 ? "Backspace" : i % 7 === 0 ? "ArrowLeft" : "x");
    const input = new FakeEvent("input");
    input.target = ta;
    ta.dispatchEvent(input);
  }
  await t.flushAll();
  assert.equal(t.log.pulls, pulls);
  assert.equal(t.log.rendered.length, rendered);
});

test("stopKey: dock keys stop at the root; menu keys bubble while a Roam menu is open", () => {
  const t = setup();
  const ta = textarea(t, "child0002", { value: "abc", start: 1, end: 1 });
  const seen = [];
  t.doc.body.addEventListener("keydown", (e) => seen.push(e.key));
  key(ta, "x");
  key(ta, "ArrowDown");
  assert.deepEqual(seen, []);
  const menu = t.doc.createElement("div");
  menu.className = "rm-autocomplete__results";
  t.doc.body.append(menu);
  key(ta, "ArrowDown");
  key(ta, "x");
  assert.deepEqual(seen, ["ArrowDown"]);
  for (const type of ["keyup", "keypress", "input", "paste", "copy", "cut", "pointerdown", "mousedown", "wheel", "dblclick", "contextmenu"]) {
    const ev = new FakeEvent(type);
    ev.target = ta;
    let reached = false;
    t.doc.body.addEventListener(type, () => { reached = true; });
    ta.dispatchEvent(ev);
    assert.equal(reached, false, type);
    assert.equal(ev.defaultPrevented, false, `${type} is never preventDefault-ed`);
  }
  const click = new FakeEvent("click");
  click.target = ta;
  let clickReached = false;
  t.doc.body.addEventListener("click", () => { clickReached = true; });
  ta.dispatchEvent(click);
  assert.ok(clickReached, "click is not stopped");
});

test("Esc in a dock textarea with no menu: decided in capture, blur, container focus, selection recheck, canvas untouched", async () => {
  const t = setup();
  const ta = textarea(t, "child0002");
  ta.focus();
  const reached = [];
  t.doc.body.addEventListener("keydown", (e) => reached.push(e.key));
  t.view.addEventListener("keydown", (e) => reached.push(`w:${e.key}`));
  const ev = key(ta, "Escape");
  assert.ok(ev.defaultPrevented);
  assert.deepEqual(reached, []);
  assert.notEqual(t.doc.activeElement, ta);
  assert.equal(t.doc.activeElement, t.containerEl);
  assert.deepEqual(t.app.updated, []);
});

test("Esc with a Roam menu open passes through and the canvas selection is restored if it changed", async () => {
  const t = setup();
  const ta = textarea(t, "child0002");
  ta.focus();
  const menu = t.doc.createElement("div");
  menu.className = "rm-autocomplete__results";
  t.doc.body.append(menu);
  const reached = [];
  t.doc.body.addEventListener("keydown", (e) => reached.push(e.key));
  const ev = key(ta, "Escape");
  assert.equal(ev.defaultPrevented, false);
  assert.deepEqual(reached, ["Escape"]);
  assert.equal(t.doc.activeElement, ta, "still editing");
  // Excalidraw's document Escape handler clears the selection
  t.app.state.selectedElementIds = {};
  await t.fire(0);
  assert.equal(t.app.updated.length, 1);
  assert.deepEqual(t.app.updated[0].appState.selectedElementIds, { a: true });
});

test("selection restore is skipped when a snapshot id no longer exists", async () => {
  const t = setup();
  const ta = textarea(t, "child0002");
  ta.focus();
  const menu = t.doc.createElement("div");
  menu.className = "rm-autocomplete__results";
  t.doc.body.append(menu);
  key(ta, "Escape");
  t.app.getSceneElements = () => [];
  t.app.state.selectedElementIds = {};
  await t.fire(0);
  assert.deepEqual(t.app.updated, []);
});

test("Esc leaving edit dispatches the synthetic Escape on window when the dock owns a selection, then re-checks once at 100 ms", async () => {
  const t = setup();
  const ta = textarea(t, "child0002");
  ta.focus();
  t.log.selected = [{ "window-id": "render-block-path-child0002-uuid" }];
  const events = [];
  t.view.dispatchEvent = (ev) => { events.push(["window", ev]); t.log.selected = []; return true; };
  t.doc.dispatchEvent = (ev) => { events.push(["document", ev]); return true; };
  key(ta, "Escape");
  ta.remove();
  await t.flushAll();
  assert.equal(events.length, 1);
  assert.equal(events[0][0], "window");
  assert.equal(events[0][1].key, "Escape");
  assert.equal(events[0][1].keyCode, 27);
  assert.equal(t.dock.escapeVia(), "window");
  assert.ok(t.timers.some((x) => x.ms === 100), "100 ms recheck armed");
});

test("if the selection survives the window Escape, document gets one more, wrapped in the canvas snapshot/restore", async () => {
  const t = setup();
  const ta = textarea(t, "child0002");
  ta.focus();
  t.log.selected = [{ "window-id": "render-block-path-child0002-uuid" }];
  const events = [];
  t.view.dispatchEvent = (ev) => { events.push("window"); return true; };
  t.doc.dispatchEvent = (ev) => { events.push("document"); t.app.state.selectedElementIds = {}; t.log.selected = []; return true; };
  key(ta, "Escape");
  await t.flushAll();
  assert.deepEqual(events, ["window", "document"]);
  assert.equal(t.dock.escapeVia(), "document");
  assert.deepEqual(t.app.updated.at(-1).appState.selectedElementIds, { a: true });
});

test("a textarea still rendered after the blur gets one synthetic Escape even with no selection", async () => {
  const t = setup();
  const ta = textarea(t, "child0002");
  ta.focus();
  const events = [];
  t.view.dispatchEvent = () => { events.push("window"); return true; };
  key(ta, "Escape");
  await t.flushAll();
  assert.deepEqual(events, ["window"]);
});

test("the highlight that the recheck's own window Escape leaves behind is cleared with a document Escape", async () => {
  const t = setup();
  const ta = textarea(t, "child0002");
  ta.focus();
  const events = [];
  let mark = null;
  t.view.dispatchEvent = () => {
    events.push("window");
    mark = t.doc.createElement("div");
    mark.className = "block-highlight-blue";
    t.dock.el.append(mark);
    return true;
  };
  t.doc.dispatchEvent = () => { events.push("document"); mark?.remove(); return true; };
  key(ta, "Escape");
  await t.flushAll();
  assert.deepEqual(events, ["window", "document"]);
  assert.equal(t.dock.el.querySelector(".block-highlight-blue"), null);
  assert.equal(t.dock.escapeVia(), "document");
});

test("the dock ignores its own synthetic Escape and untrusted keydowns", async () => {
  const t = setup();
  const ta = textarea(t, "child0002");
  t.dock.el.querySelectorAll(".plexus-dock-child")[0].append(Object.assign(t.doc.createElement("div"), { className: "block-highlight-blue" }));
  t.log.selected = [];
  let swallowed = null;
  t.view.dispatchEvent = (ev) => {
    const probe = new FakeEvent("keydown", { key: "Escape", isTrusted: false });
    probe.target = t.doc.body;
    t.doc.body.dispatchEvent(probe);
    swallowed = probe.defaultPrevented;
    return true;
  };
  // trusted Escape outside the dock while the dock owns a highlight: swallowed and cleared
  const outside = new FakeEvent("keydown", { key: "Escape" });
  outside.target = t.doc.body;
  t.doc.body.dispatchEvent(outside);
  assert.ok(outside.defaultPrevented);
  await t.flushAll();
  assert.equal(swallowed, false, "untrusted/synthetic event passes the dock's document rule");
  ta.remove();
});

test("D7 boundary guards: first block, last block, direct child Shift+Tab, move chords, Cmd+A twice", () => {
  const t = setup();
  const first = textarea(t, "child0001", { value: "abc", start: 0, end: 0 });
  const swallowed = (ta, k, init) => key(ta, k, init).defaultPrevented;
  assert.ok(swallowed(first, "Backspace"));
  assert.ok(swallowed(first, "ArrowLeft"));
  assert.ok(swallowed(first, "ArrowUp"));
  first.selectionStart = 1; first.selectionEnd = 1;
  assert.ok(!swallowed(first, "Backspace"), "caret not at 0 is Roam's");
  assert.ok(!swallowed(first, "ArrowDown"), "first block is not the last");
  first.selectionStart = 0; first.selectionEnd = 3;
  assert.ok(swallowed(first, "a", { metaKey: true, code: "KeyA" }), "Cmd+A when fully selected");
  first.selectionStart = 1; first.selectionEnd = 2;
  assert.ok(!swallowed(first, "a", { metaKey: true, code: "KeyA" }), "first Cmd+A is Roam's");
  assert.ok(swallowed(first, "Tab", { shiftKey: true }), "Shift+Tab in a direct child");
  assert.ok(!swallowed(first, "Tab"), "Tab is allowed");
  assert.ok(swallowed(first, "ArrowUp", { shiftKey: true, altKey: true }), "move chord up on the first direct child");
  assert.ok(!swallowed(first, "ArrowDown", { shiftKey: true, altKey: true }), "move down on the first is allowed");
  first.remove();

  const last = textarea(t, "child0003", { value: "abc", start: 3, end: 3 });
  assert.ok(swallowed(last, "Delete"));
  assert.ok(swallowed(last, "ArrowRight"));
  assert.ok(swallowed(last, "ArrowDown"));
  assert.ok(swallowed(last, "ArrowDown", { shiftKey: true, metaKey: true }), "move chord down on the last");
  last.selectionStart = 1; last.selectionEnd = 1;
  assert.ok(!swallowed(last, "Delete"));
  const mid = textarea(t, "child0002", { value: "abc", start: 3, end: 3 });
  assert.ok(!swallowed(mid, "ArrowDown"), "a middle block may move down");
  assert.ok(!swallowed(mid, "ArrowRight"));
  assert.ok(swallowed(mid, "ArrowDown", { shiftKey: true }), "Shift+Down at the end would select blocks");
});

test("D7 navigation guards are off while a Roam menu is open; the destructive edge keys stay guarded", () => {
  const t = setup();
  const first = textarea(t, "child0001", { value: "abc", start: 0, end: 0 });
  const menu = t.doc.createElement("div");
  menu.className = "rm-autocomplete__results";
  t.doc.body.append(menu);
  assert.equal(key(first, "ArrowUp").defaultPrevented, false);
  assert.equal(key(first, "Backspace").defaultPrevented, true, "Backspace at caret 0 would merge into the drawing block");
  assert.equal(key(first, "Tab", { shiftKey: true }).defaultPrevented, true);
  const last = textarea(t, "child0003", { value: "abc", start: 3, end: 3 });
  assert.equal(key(last, "Delete").defaultPrevented, true);
  assert.equal(key(last, "ArrowDown", { shiftKey: true, metaKey: true }).defaultPrevented, true);
});

test("D7 guards stay on while a plain Blueprint popover (a hover preview) is open", () => {
  const t = setup();
  const first = textarea(t, "child0001", { value: "abc", start: 0, end: 0 });
  const preview = t.doc.createElement("div");
  preview.className = "bp3-popover";
  t.doc.body.append(preview);
  assert.equal(key(first, "Backspace").defaultPrevented, true);
  first.selectionStart = 0; first.selectionEnd = 3;
  assert.equal(key(first, "a", { metaKey: true, code: "KeyA" }).defaultPrevented, true);
  assert.equal(key(first, "Tab", { shiftKey: true }).defaultPrevented, true);
});

test("D5: with a dock-owned highlight every outside key is swallowed except Cmd/Ctrl+C", async () => {
  const t = setup();
  const mark = t.doc.createElement("div");
  mark.className = "block-highlight-blue";
  t.dock.el.querySelectorAll(".plexus-dock-child")[0].append(mark);
  t.log.selected = [];
  const outside = (k, init) => { const e = new FakeEvent("keydown", { key: k, ...init }); e.target = t.doc.body; t.doc.body.dispatchEvent(e); return e.defaultPrevented; };
  assert.ok(outside("Backspace"));
  assert.ok(outside("r"));
  assert.ok(outside("Delete"));
  assert.ok(!outside("c", { metaKey: true }));
  assert.ok(!outside("c", { ctrlKey: true }));
  assert.ok(outside("c", { metaKey: true, shiftKey: true }));
  await t.flushAll();
  mark.remove();
  assert.ok(!outside("Backspace"), "no highlight, no swallow");
  const menu = t.doc.createElement("div");
  menu.className = "bp3-menu";
  t.doc.body.append(menu);
  t.dock.el.querySelectorAll(".plexus-dock-child")[0].append(Object.assign(t.doc.createElement("div"), { className: "block-highlight-blue" }));
  const inMenu = new FakeEvent("keydown", { key: "ArrowDown" });
  inMenu.target = menu;
  menu.dispatchEvent(inMenu);
  assert.ok(!inMenu.defaultPrevented, "keys inside a Roam menu pass");
});

test("D5: no async selection read inside keydown", () => {
  const t = setup();
  let reads = 0;
  t.api.ui.multiselect.getSelected = async () => { reads += 1; return []; };
  const e = new FakeEvent("keydown", { key: "r" });
  e.target = t.doc.body;
  t.doc.body.dispatchEvent(e);
  assert.equal(reads, 0);
});

test("a canvas pointerup while the dock owns a highlight clears it with a synthetic Escape", async () => {
  const t = setup();
  const mark = t.doc.createElement("div");
  mark.className = "block-highlight-blue";
  t.dock.el.querySelectorAll(".plexus-dock-child")[0].append(mark);
  const events = [];
  t.view.dispatchEvent = () => { events.push("window"); mark.remove(); return true; };
  const up = new FakeEvent("pointerup");
  up.target = t.containerEl;
  t.containerEl.dispatchEvent(up);
  await t.flushAll();
  assert.deepEqual(events, ["window"]);
});

test("canvas pointerdown while a dock textarea is focused leaves editing without taking container focus", () => {
  const t = setup();
  const ta = textarea(t, "child0002");
  ta.focus();
  const down = new FakeEvent("pointerdown");
  down.target = t.containerEl;
  t.containerEl.dispatchEvent(down);
  assert.notEqual(t.doc.activeElement, ta);
  assert.notEqual(t.doc.activeElement, t.containerEl);
  assert.equal(down.defaultPrevented, false);
});

test("focus lost to body within 1200 ms of a dock key: swallow once and refocus the textarea; not after that window or after focus left", () => {
  const t = setup();
  const ta = textarea(t, "child0002", { value: "abcd", start: 2, end: 2 });
  ta.focus();
  key(ta, "x");
  t.doc.activeElement = t.doc.body;
  t.clock.t += 500;
  const e = new FakeEvent("keydown", { key: "y" });
  e.target = t.doc.body;
  t.doc.body.dispatchEvent(e);
  assert.ok(e.defaultPrevented);
  assert.equal(t.doc.activeElement, ta);
  assert.equal(ta.selectionStart, 2);
  t.doc.activeElement = t.doc.body;
  t.clock.t += 2000;
  const late = new FakeEvent("keydown", { key: "z" });
  late.target = t.doc.body;
  t.doc.body.dispatchEvent(late);
  assert.equal(late.defaultPrevented, false, "beyond the window a key belongs to the canvas");
  // focus moved elsewhere: editing is over
  key(ta, "x");
  const other = t.doc.createElement("input");
  t.doc.body.append(other);
  t.clock.t += 900;
  other.focus();
  t.doc.activeElement = t.doc.body;
  const after = new FakeEvent("keydown", { key: "q" });
  after.target = t.doc.body;
  t.doc.body.dispatchEvent(after);
  assert.equal(after.defaultPrevented, false);
});

test("stray focus: a Roam textarea outside the dock gaining focus right after a dock key is blurred and the dock textarea refocused", () => {
  const t = setup();
  const ta = textarea(t, "child0002", { value: "abcd", start: 4, end: 4 });
  ta.focus();
  key(ta, "Backspace");
  const stray = t.doc.createElement("textarea");
  stray.id = "block-input-main-abcdefghi";
  t.doc.body.append(stray);
  t.clock.t += 100;
  stray.focus();
  assert.equal(t.doc.activeElement, ta);
  assert.equal(ta.selectionStart, 4);
});

test("stray focus: Excalidraw's text editor and a focus outside editing are left alone", () => {
  const t = setup();
  const ta = textarea(t, "child0002", { value: "abcd", start: 4, end: 4 });
  ta.focus();
  key(ta, "Escape");
  const wysiwyg = t.doc.createElement("textarea");
  wysiwyg.className = "excalidraw-wysiwyg";
  t.doc.body.append(wysiwyg);
  t.clock.t += 100;
  wysiwyg.focus();
  assert.equal(t.doc.activeElement, wysiwyg);
  const block = t.doc.createElement("textarea");
  block.id = "block-input-main-abcdefghi";
  t.doc.body.append(block);
  block.focus();
  assert.equal(t.doc.activeElement, block, "after Esc the dock is not editing, so nothing is pulled back");
});

test("bullet clicks are swallowed; modified clicks and other clicks pass", () => {
  const t = setup();
  const host = t.dock.el.querySelectorAll(".plexus-dock-child")[0];
  const bullet = t.doc.createElement("span");
  bullet.className = "rm-bullet";
  host.append(bullet);
  const reached = [];
  bullet.addEventListener("click", () => reached.push("bullet"));
  t.doc.body.addEventListener("click", () => reached.push("body"));
  const plain = new FakeEvent("click");
  plain.target = bullet;
  bullet.dispatchEvent(plain);
  assert.deepEqual(reached, []);
  const mod = new FakeEvent("click", { shiftKey: true });
  mod.target = bullet;
  bullet.dispatchEvent(mod);
  assert.deepEqual(reached, ["bullet", "body"]);
});

test("empty root and footer: + Add a block calls addBlock(root), polls for the input, then click-to-focuses it", async () => {
  const t = setup({ children: [] });
  assert.equal(t.dock.el.querySelectorAll(".plexus-dock-child").length, 0);
  const footer = t.dock.el.children[3];
  const add = footer.children[0];
  assert.equal(add.textContent, "+ Add a block");
  add.dispatchEvent(Object.assign(new FakeEvent("click"), { target: add }));
  await t.runFrames();
  for (let i = 0; i < 3; i++) await Promise.resolve();
  assert.deepEqual(t.log.added, [DRAWING]);
  // the watch delivers the new child a moment later
  await t.fire(1e9);
  t.log.watches[0].cb(null, { ":block/children": [{ ":block/uid": "newblock01", ":block/order": 0 }] });
  const input = t.dock.el.querySelector(".rm-block__input");
  input.addEventListener("click", () => {
    const next = t.doc.createElement("textarea");
    next.id = "block-input-win-newblock01";
    input.parentNode.append(next);
    next.focus();
  });
  for (let i = 0; i < 12; i++) { await t.fire(1e9); await t.runFrames(); }
  assert.ok(t.doc.activeElement.id?.endsWith("newblock01"));
  const mds = new FakeEvent("mousedown");
  mds.target = add;
  add.dispatchEvent(mds);
  assert.ok(mds.defaultPrevented);
});

test("close(): hides at once, removes narrowing and listeners, waits 300 ms when editing, then unmounts; onClose once; idempotent", async () => {
  const t = setup();
  const ta = textarea(t, "child0002");
  ta.focus();
  const p = t.dock.close();
  assert.equal(t.dock.isOpen(), false);
  assert.equal(t.dock.el.style.display, "none");
  assert.ok(!t.outerEl.classList.contains("plexus-dock-narrowed"));
  assert.ok(!t.doc.body.classList.contains("plexus-dock-open"));
  assert.equal(t.doc.head.children.some((n) => n.tagName === "STYLE"), false);
  assert.equal(t.log.unmounted.length, 0, "not unmounted before the save wait");
  assert.equal(t.log.closed, 1);
  assert.equal(t.log.unwatched, 1);
  assert.equal(t.doc.listeners.length, 0);
  assert.equal(t.containerEl.listeners.length, 0);
  assert.equal(t.view.listeners.length, 0);
  assert.equal(t.doc.activeElement, t.containerEl);
  const wait = t.timers.find((x) => x.ms === 300 && !x.cleared);
  assert.ok(wait, "300 ms save wait armed");
  wait.cleared = true; wait.fn();
  await p;
  assert.equal(t.log.unmounted.length, 3);
  assert.equal(t.dock.el.removed, true);
  assert.equal(t.dock.close(), p, "same promise");
  assert.equal(t.log.closed, 1);
  assert.equal(t.dock.dispose(), p);
  assert.deepEqual(t.mos.map((m) => m.disconnected), [true, true]);
  assert.equal(t.doc.body.all().filter((n) => n.listeners.length).length, 0, "no listeners left on body descendants outside the removed dock");
});

test("close() without editing does not wait; dispose() does not call onClose", async () => {
  const t = setup();
  const p = t.dock.dispose();
  await p;
  assert.equal(t.log.closed, 0);
  assert.equal(t.log.unmounted.length, 3);
  assert.ok(!t.timers.some((x) => x.ms === 300));
  assert.equal(t.containerEl.listeners.length, 0);
  assert.equal(t.doc.listeners.length, 0);
  assert.equal(t.view.listeners.length, 0);
});

test("close cancels pending polls, frames and rechecks", async () => {
  const t = setup({ children: [] });
  const add = t.dock.el.children[3].children[0];
  add.dispatchEvent(Object.assign(new FakeEvent("click"), { target: add }));
  await t.runFrames();
  for (let i = 0; i < 4; i++) await Promise.resolve();
  await t.dock.close();
  const rendered = t.log.rendered.length;
  await t.fire(1e9);
  await t.runFrames(3);
  assert.equal(t.log.rendered.length, rendered);
  assert.equal(t.view.dispatched.length, 0);
});

test("the MutationObserver on outerEl disposes synchronously when full-screen goes away, without onClose", () => {
  const t = setup();
  const mo = t.mos.find((m) => m.target === t.outerEl);
  assert.deepEqual(mo.opts, { attributes: true, attributeFilter: ["class"] });
  mo.cb();
  assert.equal(t.dock.isOpen(), true, "still full-screen");
  t.outerEl.classList.remove("full-screen");
  mo.cb();
  assert.equal(t.dock.isOpen(), false);
  assert.equal(t.log.closed, 0);
  assert.ok(!t.outerEl.classList.contains("plexus-dock-narrowed"));
});

test("setRoot while editing goes through leave-and-wait", async () => {
  const t = setup();
  const ta = textarea(t, "child0002");
  ta.focus();
  const p = t.dock.setRoot("parent");
  assert.notEqual(t.doc.activeElement, ta);
  assert.equal(t.dock.root(), "drawing", "not switched before the wait");
  const wait = t.timers.find((x) => x.ms === 300 && !x.cleared);
  wait.cleared = true; wait.fn();
  assert.equal(await p, true);
  assert.equal(t.dock.root(), "parent");
});

test("menu observer scrolls the autocomplete into view", () => {
  const t = setup();
  const mo = t.mos.find((m) => m.target !== t.outerEl);
  const menu = t.doc.createElement("div");
  menu.className = "rm-autocomplete__results";
  let scrolled = null;
  menu.scrollIntoView = (o) => { scrolled = o; };
  t.dock.el.children[2].append(menu);
  mo.cb();
  assert.deepEqual(scrolled, { block: "nearest" });
});

test("a failing renderBlock or throwing listener never throws into the caller", () => {
  const t = setup();
  t.api.ui.components.renderBlock = () => { throw new Error("boom"); };
  const warnings = [];
  const orig = console.warn;
  console.warn = (...a) => warnings.push(a);
  try {
    t.log.watches[0].cb(null, { ":block/children": [{ ":block/uid": "zzzzzzzzz", ":block/order": 0 }] });
    assert.ok(warnings.some((w) => String(w[0]).includes("[plexus]")));
  } finally { console.warn = orig; }
});

// ---- live acceptance fixes ----

const mkMenu = (t, cls) => { const m = t.doc.createElement("div"); m.className = cls; t.doc.body.append(m); return m; };

test("Roam's permanent empty toast container is not a menu: Esc in a dock textarea still leaves", async () => {
  const t = setup();
  mkMenu(t, "bp3-overlay bp3-overlay-open bp3-toast-container");
  const ta = textarea(t, "child0002");
  ta.focus();
  const ev = key(ta, "Escape");
  assert.ok(ev.defaultPrevented, "swallowed, not passed as a menu Esc");
  assert.notEqual(t.doc.activeElement, ta);
  assert.equal(t.doc.activeElement, t.containerEl);
  // while a real overlay is open the Esc passes
  mkMenu(t, "bp3-overlay bp3-overlay-open");
  ta.focus();
  assert.equal(key(ta, "Escape").defaultPrevented, false);
});

test("Esc when Roam removes the textarea itself and selects the block ~50 ms later: still a synthetic Escape, selection cleared, container focused", async () => {
  const t = setup();
  const ta = textarea(t, "child0002");
  ta.focus();
  const events = [];
  let mark = null;
  // Roam's window-capture listener runs first: the textarea is gone, the highlight arrives 50 ms later.
  t.doc.body.addEventListener("keydown", () => { ta.remove(); t.doc.activeElement = t.doc.body; }, true);
  t.log.selected = [];
  setTimeout(() => {
    mark = t.doc.createElement("div");
    mark.className = "block-highlight-blue";
    t.dock.el.append(mark);
    t.log.selected = [{ "window-id": "render-block-path-child0002-uuid" }];
  }, 50);
  t.view.dispatchEvent = () => { events.push("window"); mark?.remove(); t.log.selected = []; return true; };
  const ev = key(ta, "Escape");
  assert.ok(ev.defaultPrevented);
  await new Promise((r) => setTimeout(r, 60));
  await t.flushAll();
  assert.ok(events.length >= 1, "a synthetic Escape was dispatched");
  assert.equal(t.dock.el.querySelector(".block-highlight-blue"), null);
  assert.deepEqual(t.log.selected, []);
  assert.equal(t.doc.activeElement, t.containerEl);
});

test("Esc with a Roam menu open: after the settle time, if Roam left editing the dock finishes the leave", async () => {
  const t = setup();
  const ta = textarea(t, "child0002");
  ta.focus();
  mkMenu(t, "rm-autocomplete__results");
  const ev = key(ta, "Escape");
  assert.equal(ev.defaultPrevented, false, "the Esc passes so Roam closes the menu");
  assert.ok(t.timers.some((x) => x.ms === 150), "settle timer armed");
  // Roam closes the menu and leaves editing
  ta.remove();
  t.doc.activeElement = t.doc.body;
  await t.fire(150);
  await t.flushAll();
  assert.equal(t.doc.activeElement, t.containerEl);
});

test("Esc with a Roam menu open: a textarea still in the dock after the settle time is left alone", async () => {
  const t = setup();
  const ta = textarea(t, "child0002");
  ta.focus();
  mkMenu(t, "rm-autocomplete__results");
  key(ta, "Escape");
  await t.fire(150);
  await t.flushAll();
  assert.equal(t.doc.activeElement, ta);
});

function refNode(t, cls, attrs, text = "x") {
  const host = t.dock.el.querySelectorAll(".plexus-dock-child")[0];
  const n = t.doc.createElement("span");
  n.className = cls;
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.textContent = text;
  host.append(n);
  return n;
}
const click = (target, init = {}, type = "click") => {
  const ev = new FakeEvent(type, { button: 0, ...init });
  ev.target = target;
  target.dispatchEvent(ev);
  return ev;
};

test("ref clicks: plain click on each ref kind navigates and is swallowed (mousedown too)", () => {
  const calls = [];
  const t = setup();
  // rebuild with onNavigate: setup does not take it, so re-create the dock on the same fixtures
  t.dock.dispose();
  const dock = createDock({
    doc: t.doc, api: { ...t.api, data: { ...t.api.data, pull: (p, ident) => (/pageuid01/.test(ident) ? { ":node/title": "Resolved Page" } : t.api.data.pull(p, ident)) } },
    app: t.app, containerEl: t.containerEl, outerEl: t.outerEl, drawingUid: DRAWING,
    onNavigate: (a) => calls.push(a), raf: (cb) => cb(), MutationObserver: undefined,
  });
  const host = dock.el.querySelectorAll(".plexus-dock-child")[0] ?? dock.el;
  const mk = (cls, attrs) => {
    const n = t.doc.createElement("span");
    n.className = cls;
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    host.append(n);
    return n;
  };
  const cases = [
    [mk("rm-page-ref", { "data-link-title": "Plexus Spike Target" }), { type: "page", title: "Plexus Spike Target" }],
    [mk("rm-page-ref--tag", { "data-tag": "mytag" }), { type: "page", title: "mytag" }],
    [mk("rm-block-ref", { "data-uid": "blockuid1" }), { type: "block", uid: "blockuid1" }],
    [mk("rm-alias", { "data-link-uid": "blockuid2" }), { type: "block", uid: "blockuid2" }],
    [mk("rm-alias", { "data-link-uid": "pageuid01" }), { type: "page", title: "Resolved Page" }],
    [mk("rm-alias", { "data-link-title": "Aliased" }), { type: "page", title: "Aliased" }],
  ];
  const reached = [];
  t.doc.body.addEventListener("click", () => reached.push("click"));
  t.doc.body.addEventListener("mousedown", () => reached.push("mousedown"));
  for (const [node, expected] of cases) {
    const down = click(node, {}, "mousedown");
    assert.ok(down.defaultPrevented && down.immediate, "mousedown swallowed");
    const before = calls.length;
    const ev = click(node);
    assert.ok(ev.defaultPrevented && ev.immediate, "click swallowed");
    assert.deepEqual(calls[before], { target: expected, sidebar: false });
  }
  assert.deepEqual(reached, []);
  assert.equal(calls.length, cases.length);
  dock.dispose();
});

test("ref clicks: Shift opens the sidebar; Cmd/Ctrl/Alt and non-refs are untouched", () => {
  const calls = [];
  const t = setup();
  t.dock.dispose();
  const dock = createDock({
    doc: t.doc, api: t.api, app: t.app, containerEl: t.containerEl, outerEl: t.outerEl, drawingUid: DRAWING,
    onNavigate: (a) => calls.push(a), raf: (cb) => cb(), MutationObserver: undefined,
  });
  const host = dock.el.querySelectorAll(".plexus-dock-child")[0] ?? dock.el;
  const ref = t.doc.createElement("span");
  ref.className = "rm-page-ref";
  ref.setAttribute("data-link-title", "Target");
  const text = t.doc.createElement("span");
  text.className = "rm-block-text";
  host.append(ref, text);
  const shift = click(ref, { shiftKey: true });
  assert.ok(shift.defaultPrevented);
  assert.deepEqual(calls, [{ target: { type: "page", title: "Target" }, sidebar: true }]);
  const reached = [];
  t.doc.body.addEventListener("click", () => reached.push("click"));
  for (const init of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
    const ev = click(ref, init);
    assert.equal(ev.defaultPrevented, false);
  }
  assert.equal(calls.length, 1);
  assert.equal(reached.length, 3, "modified clicks bubble on");
  const plain = click(text);
  assert.equal(plain.defaultPrevented, false);
  assert.equal(calls.length, 1);
  assert.equal(reached.length, 4);
  dock.dispose();
});

test("undo and redo chords bubble from a dock textarea; other chords stay stopped", () => {
  const t = setup();
  const ta = textarea(t, "child0002", { value: "abc", start: 1, end: 1 });
  const seen = [];
  t.doc.body.addEventListener("keydown", (e) => seen.push(`${e.key}${e.metaKey ? "+meta" : ""}${e.ctrlKey ? "+ctrl" : ""}${e.shiftKey ? "+shift" : ""}`));
  key(ta, "z", { metaKey: true });
  key(ta, "Z", { metaKey: true, shiftKey: true });
  key(ta, "z", { ctrlKey: true });
  key(ta, "y", { ctrlKey: true });
  assert.deepEqual(seen, ["z+meta", "Z+meta+shift", "z+ctrl", "y+ctrl"]);
  seen.length = 0;
  key(ta, "x", { metaKey: true });
  key(ta, "y", { metaKey: true });
  key(ta, "z", { metaKey: true, altKey: true });
  key(ta, "Enter");
  key(ta, "ArrowUp", { metaKey: true, shiftKey: true });
  assert.deepEqual(seen, []);
  // the canvas is untouched
  assert.deepEqual(t.app.updated, []);
});

test("Ctrl+Y is not redo on macOS", () => {
  const t = setup();
  t.dock.dispose();
  const dock = createDock({
    doc: t.doc, api: t.api, app: t.app, containerEl: t.containerEl, outerEl: t.outerEl, drawingUid: DRAWING,
    mac: true, raf: (cb) => cb(), MutationObserver: undefined,
  });
  const host = dock.el.querySelectorAll(".plexus-dock-child")[0] ?? dock.el;
  const ta = t.doc.createElement("textarea");
  ta.id = "block-input-win-child0001";
  host.append(ta);
  const seen = [];
  t.doc.body.addEventListener("keydown", (e) => seen.push(e.key));
  key(ta, "y", { ctrlKey: true });
  key(ta, "z", { metaKey: true });
  assert.deepEqual(seen, ["z"]);
  dock.dispose();
});

function hostTheme(t, { dark, bodyBg, htmlBg = "rgba(0, 0, 0, 0)" }) {
  t.doc.documentElement = new FakeNode("html", t.doc);
  if (dark) t.doc.documentElement.classList.add("bp3-dark");
  const bg = new Map([[t.doc.body, bodyBg], [t.doc.documentElement, htmlBg]]);
  t.view.getComputedStyle = (n) => ({ backgroundColor: bg.get(n) ?? "rgba(0, 0, 0, 0)" });
  t.bg = bg;
}

test("theme: a dark host with a light canvas gives a dark dock with the body background", () => {
  const t = setup({ state: { theme: "light" } });
  hostTheme(t, { dark: true, bodyBg: "rgb(32, 43, 51)" });
  t.dock.refreshTheme();
  assert.equal(t.dock.el.attrs["data-theme"], "dark");
  assert.equal(t.dock.el.style["--plexus-dock-bg"], "rgb(32, 43, 51)");
});

test("theme: a light host with a dark canvas gives a light dock; refreshTheme follows host changes", () => {
  const t = setup({ state: { theme: "dark" } });
  hostTheme(t, { dark: false, bodyBg: "rgba(0, 0, 0, 0)", htmlBg: "rgb(255, 255, 255)" });
  t.dock.refreshTheme();
  assert.equal(t.dock.el.attrs["data-theme"], "light");
  assert.equal(t.dock.el.style["--plexus-dock-bg"], "rgb(255, 255, 255)", "transparent body falls through to the root element");
  t.doc.documentElement.classList.add("bp3-dark");
  t.bg.set(t.doc.body, "rgb(32, 43, 51)");
  t.dock.refreshTheme();
  assert.equal(t.dock.el.attrs["data-theme"], "dark");
  assert.equal(t.dock.el.style["--plexus-dock-bg"], "rgb(32, 43, 51)");
});

test("reorder while a textarea in a moved host is focused keeps focus and caret", () => {
  const t = setup();
  const ta = textarea(t, "child0003", { value: "hello world", start: 2, end: 7 });
  ta.focus();
  assert.equal(t.doc.activeElement, ta);
  const ownerHost = ta.parentNode;
  const orig = t.dock.el.querySelector(".plexus-dock-body").insertBefore;
  const bodyEl = t.dock.el.querySelector(".plexus-dock-body");
  bodyEl.insertBefore = function (n, ref) {
    orig.call(this, n, ref);
    if (n === ownerHost) { t.doc.activeElement = t.doc.body; ta.selectionStart = 0; ta.selectionEnd = 0; }
  };
  const mk = (uids) => ({ ":block/children": uids.map((u, i) => ({ ":block/uid": u, ":block/order": i })) });
  t.log.watches[0].cb(null, mk(["child0003", "child0001", "child0002"]));
  assert.deepEqual(t.dock.el.querySelectorAll(".plexus-dock-child").map((h) => h.querySelector(".rm-block__input").id.slice(-9)), ["child0003", "child0001", "child0002"]);
  assert.equal(t.doc.activeElement, ta);
  assert.equal(ta.selectionStart, 2);
  assert.equal(ta.selectionEnd, 7);
});
