import assert from "node:assert/strict";
import test from "node:test";

import { createPresenter } from "../src/view/present.js";

function fakeNode() {
  const n = {
    style: {}, children: [], listeners: {}, hidden: false, textContent: "", open: false, removed: false,
    setAttribute() {}, removeAttribute() {},
    append(...c) { this.children.push(...c); },
    remove() { this.removed = true; },
    addEventListener(t, f) { this.listeners[t] = f; },
    removeEventListener(t) { delete this.listeners[t]; },
    getBoundingClientRect: () => ({ left: 0, width: 1000 }),
    showModal() { this.open = true; },
    close() { this.open = false; },
    focus() {},
  };
  return n;
}

function setup() {
  const nodes = [];
  const doc = { body: fakeNode(), defaultView: {}, createElement: (tag) => { const n = fakeNode(); n.tag = tag; nodes.push(n); return n; } };
  const presenter = createPresenter({ doc });
  const dialog = () => nodes.find((n) => n.tag === "dialog");
  const hud = () => dialog().children.find((c) => c.className === "plexus-present-hud");
  const img = () => dialog().children.find((c) => c.className === "plexus-present-slide");
  return { presenter, dialog, hud, img, doc, nodes };
}
const key = (k) => ({ key: k, preventDefault() {}, stopPropagation() {} });
const slides = [{ name: "A", url: "u1" }, { name: "B", url: "u2" }, { name: "C", url: null }];

test("keys, click halves, and preload navigate slides", () => {
  const t = setup();
  t.presenter.open({ slides });
  const d = t.dialog();
  assert.equal(d.open, true);
  assert.equal(t.hud().textContent, "1 / 3 · A");
  d.listeners.keydown(key("ArrowRight"));
  assert.equal(t.hud().textContent, "2 / 3 · B");
  assert.equal(t.img().src, "u2");
  d.listeners.keydown(key(" "));
  assert.equal(t.hud().textContent, "3 / 3 · C");
  assert.equal(t.img().hidden, true);
  d.listeners.keydown(key("Enter"));
  assert.equal(t.hud().textContent, "3 / 3 · C");
  d.listeners.keydown(key("Home"));
  assert.equal(t.hud().textContent, "1 / 3 · A");
  d.listeners.click({ clientX: 900 });
  assert.equal(t.hud().textContent, "2 / 3 · B");
  d.listeners.click({ clientX: 100 });
  assert.equal(t.hud().textContent, "1 / 3 · A");
  d.listeners.keydown(key("End"));
  d.listeners.keydown(key("Backspace"));
  assert.equal(t.hud().textContent, "2 / 3 · B");
  d.listeners.keydown(key("PageUp"));
  assert.equal(t.hud().textContent, "1 / 3 · A");
});

test("setSlide fills a pending slide; cancel closes and removes the dialog", () => {
  const t = setup();
  const h = t.presenter.open({ slides, index: 2 });
  assert.equal(t.img().hidden, true);
  h.setSlide(2, { url: "u3" });
  assert.equal(t.img().src, "u3");
  assert.equal(t.img().hidden, false);
  const d = t.dialog();
  let prevented = false;
  d.listeners.cancel({ preventDefault() { prevented = true; } });
  assert.ok(prevented);
  assert.equal(d.removed, true);
  assert.equal(d.open, false);
  assert.equal(t.presenter.isOpen(), false);
  assert.equal(h.isOpen(), false);
});

test("dispose closes an open dialog", () => {
  const t = setup();
  t.presenter.open({ slides });
  t.presenter.dispose();
  assert.equal(t.dialog().removed, true);
});

test("Cmd+Z, Delete and keyups never leave the dialog; failed slides say so", () => {
  const t = setup();
  const seen = [];
  const ev = (k) => ({ key: k, preventDefault() {}, stopPropagation() { seen.push(k); } });
  const h = t.presenter.open({ slides });
  const d = t.dialog();
  d.listeners.keydown(ev("z"));
  d.listeners.keydown(ev("Delete"));
  d.listeners.keyup(ev("ArrowRight"));
  d.listeners.keydown(ev("Escape"));
  assert.deepEqual(seen, ["z", "Delete", "ArrowRight"]);
  d.listeners.keydown(key("End"));
  const wait = d.children.find((c) => c.className === "plexus-present-wait");
  assert.equal(wait.textContent, "Rendering...");
  h.setSlide(2, { error: true });
  assert.equal(wait.textContent, "Could not render this slide");
  assert.equal(wait.hidden, false);
});

test("Enter, PageDown, Spacebar advance and ArrowLeft goes back", () => {
  const t = setup();
  t.presenter.open({ slides });
  const d = t.dialog();
  for (const k of ["Enter", "PageDown", "Spacebar"]) {
    d.listeners.keydown(key("Home"));
    d.listeners.keydown(key(k));
    assert.equal(t.hud().textContent, "2 / 3 · B", k);
  }
  d.listeners.keydown(key("ArrowLeft"));
  assert.equal(t.hud().textContent, "1 / 3 · A");
});

test("loading text is hidden once a slide has an image, and the HUD carries only the count and name", () => {
  const t = setup();
  t.presenter.open({ slides: [{ name: "A", url: "u1" }, { name: "B", url: null }] });
  const wait = () => t.dialog().children.find((c) => c.className === "plexus-present-wait");
  assert.equal(wait().hidden, true);
  assert.equal(t.hud().textContent, "1 / 2 · A");
  t.dialog().listeners.keydown(key("ArrowRight"));
  assert.equal(wait().hidden, false);
  assert.equal(wait().textContent, "Rendering...");
  assert.equal(t.hud().textContent, "2 / 2 · B");
  const handle = t.presenter.isOpen();
  assert.equal(handle, true);
});

test("setSlide with a url hides loading; img load also hides it; error keeps its message", () => {
  const t = setup();
  const h = t.presenter.open({ slides: [{ name: "A", url: null }] });
  const wait = t.dialog().children.find((c) => c.className === "plexus-present-wait");
  h.setSlide(0, { error: true });
  assert.equal(wait.hidden, false);
  assert.equal(wait.textContent, "Could not render this slide");
  h.setSlide(0, { url: "u", error: false });
  assert.equal(wait.hidden, true);
  wait.hidden = false;
  t.img().listeners.load();
  assert.equal(wait.hidden, true);
});

test("CSS lets [hidden] beat the flex/block display on the loading text and slide", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(new URL("../src/extension.css", import.meta.url), "utf8");
  assert.match(css, /\.plexus-present-wait\[hidden\][\s\S]*?display:\s*none/);
});

// ---- P11: notes pane, routing, laser/pen, progress, notice ----

function richNode(tag, log) {
  const n = {
    tag, style: {}, children: [], listeners: {}, attrs: {}, hidden: false, open: false, removed: false, className: "", parentNode: null,
    _text: "",
    get textContent() { return this._text; },
    set textContent(v) { this._text = v; if (v === "") { for (const c of this.children) c.parentNode = null; this.children = []; } },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    removeAttribute(k) { delete this.attrs[k]; },
    append(...c) { for (const x of c) { x.parentNode = this; this.children.push(x); } },
    remove() { this.removed = true; log?.push(`remove:${this.className || this.tag}`); },
    addEventListener(t, f, cap) { this.listeners[cap ? `${t}:capture` : t] = f; },
    removeEventListener(t, f, cap) { delete this.listeners[cap ? `${t}:capture` : t]; },
    getBoundingClientRect() { return { left: 10, top: 20, width: 800, height: 450 }; },
    showModal() { this.open = true; },
    close() { this.open = false; },
    focus() {},
  };
  if (tag === "canvas") {
    n.calls = [];
    n.ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { n.calls.push([k, ...a]); }), set: (t, k, v) => { t[k] = v; return true; } });
    n.getContext = () => n.ctx;
    n.setPointerCapture = (id) => n.calls.push(["capture", id]);
  }
  return n;
}

function rich({ children = [{ string: "note one", children: [{ string: "sub", children: [] }] }], hostOverrides = {} } = {}) {
  const log = [];
  const nodes = [];
  const winListeners = {};
  const rafQueue = [];
  const timers = [];
  let clock = 0;
  const win = { devicePixelRatio: 2, addEventListener: (t, f) => { winListeners[t] = f; }, removeEventListener: (t) => { delete winListeners[t]; } };
  const doc = { body: richNode("body", log), defaultView: win, createElement: (tag) => { const n = richNode(tag, log); nodes.push(n); return n; } };
  const rendered = [];
  const unmounted = [];
  const watches = [];
  const state = { children };
  const api = { ui: { components: {
    renderString: ({ el, string }) => rendered.push({ el, string }),
    unmountNode: ({ el }) => { unmounted.push(el); log.push("unmount"); },
  } } };
  const host = {
    pullEmbedContent: (ref) => { log.push(`pull:${ref}`); return { children: state.children }; },
    watchEmbed: (uid, cb) => { const w = { uid, cb, disposed: false }; watches.push(w); return () => { w.disposed = true; log.push("watch-off"); }; },
    ...hostOverrides,
  };
  const presenter = createPresenter({
    doc, api, host,
    raf: (cb) => { rafQueue.push(cb); return rafQueue.length; },
    caf: (id) => { rafQueue[id - 1] = null; },
    now: () => clock,
    dpr: () => 2,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimer: (id) => { timers[id - 1] = null; },
  });
  const by = (cls) => nodes.find((n) => n.className.split(" ").includes(cls));
  const flush = () => { const q = rafQueue.splice(0); for (const cb of q) cb?.(); return q.filter(Boolean).length; };
  return {
    presenter, doc, nodes, log, rendered, unmounted, watches, state, win, winListeners, rafQueue, timers, by, flush,
    dialog: () => nodes.find((n) => n.tag === "dialog"),
    tick: (ms) => { clock += ms; },
    key: (k, extra = {}) => ({ key: k, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extra }),
  };
}
const three = [{ name: "A", url: "u1", notes: { rootUid: "root1" } }, { name: "B", url: "u2", notes: { rootUid: "root2" } }, { name: "C", url: "u3" }];

test("progress bar is a progressbar with the slide position", () => {
  const t = rich();
  t.presenter.open({ slides: three });
  const bar = t.by("plexus-present-progress");
  assert.equal(bar.attrs.role, "progressbar");
  assert.equal(bar.attrs["aria-valuenow"], "1");
  assert.equal(bar.attrs["aria-valuemax"], "3");
  t.dialog().listeners.keydown(t.key("ArrowRight"));
  assert.equal(bar.attrs["aria-valuenow"], "2");
  assert.equal(t.by("plexus-present-progress-fill").style.width, `${(2 / 3) * 100}%`);
});

test("N shows the notes pane with one host per block; watch repaints; slide change unmounts and disposes", () => {
  const t = rich();
  t.presenter.open({ slides: three });
  const pane = t.by("plexus-present-notes");
  assert.equal(pane.hidden, true);
  assert.equal(t.rendered.length, 0);
  t.dialog().listeners.keydown(t.key("n"));
  assert.equal(pane.hidden, false);
  assert.equal(t.dialog().attrs["data-notes"], "1");
  assert.deepEqual(t.rendered.map((r) => r.string), ["note one", "sub"]);
  assert.notEqual(t.rendered[0].el, t.rendered[1].el);
  assert.equal(t.watches.length, 1);
  assert.equal(t.watches[0].uid, "root1");
  assert.ok(t.log.includes("pull:((root1))"));
  t.state.children = [{ string: "changed", children: [] }];
  t.watches[0].cb();
  assert.equal(t.rendered.at(-1).string, "changed");
  assert.equal(t.unmounted.length, 2);
  t.dialog().listeners.keydown(t.key("ArrowRight"));
  assert.equal(t.watches[0].disposed, true);
  assert.equal(t.watches.length, 2);
  assert.equal(t.watches[1].uid, "root2");
  // a late callback of the old watch is discarded
  const before = t.rendered.length;
  t.watches[0].cb();
  assert.equal(t.rendered.length, before);
});

test("close unmounts note hosts and disposes the watch before the dialog is removed", () => {
  const t = rich();
  t.presenter.open({ slides: three });
  t.dialog().listeners.keydown(t.key("n"));
  t.log.length = 0;
  t.presenter.close();
  const i = t.log.indexOf("watch-off");
  const u = t.log.indexOf("unmount");
  const r = t.log.indexOf("remove:dialog");
  const r2 = t.log.findIndex((x) => x.startsWith("remove:") && x.includes("plexus-present"));
  assert.ok(i >= 0 && u >= 0);
  assert.ok(i < r2 && u < r2, t.log.join(","));
  assert.equal(t.winListeners.resize, undefined);
});

test("empty notes show No notes and Add notes, which calls onAdd and repaints once notes exist", async () => {
  const t = rich({ children: [] });
  let added = 0;
  const slides = [{ name: "A", url: "u", notes: { rootUid: "r", onAdd: async () => { added += 1; t.state.children = [{ string: "fresh", children: [] }]; } } }];
  t.presenter.open({ slides });
  t.dialog().listeners.keydown(t.key("N"));
  const pane = t.by("plexus-present-notes");
  assert.equal(t.by("plexus-present-notes-empty").textContent, "No notes");
  const add = t.by("plexus-present-notes-add");
  assert.equal(add.textContent, "Add notes");
  await add.listeners.click({ stopPropagation() {} });
  assert.equal(added, 1);
  assert.equal(t.rendered.at(-1).string, "fresh");
  assert.ok(pane);
});

test("Add notes adopts the created region: watch armed, button gone, notice shown; a null result says so", async () => {
  const t = rich({ children: [] });
  const slides = [{ name: "A", url: "u", notes: { rootUid: null, onAdd: async () => ({ regionUid: "reg000009", childUid: "blk000009" }) } }];
  const h = t.presenter.open({ slides });
  t.dialog().listeners.keydown(t.key("N"));
  await t.by("plexus-present-notes-add").listeners.click({ stopPropagation() {} });
  assert.equal(t.by("plexus-present-status").textContent, "Notes added. Write them after the presentation");
  assert.ok(!t.nodes.some((n) => n.className === "plexus-present-notes-add" && n.disabled === false));
  assert.ok(t.watches.some((w) => w.uid === "reg000009" && !w.disposed));
  const t2 = rich({ children: [] });
  t2.presenter.open({ slides: [{ name: "A", url: "u", notes: { rootUid: null, onAdd: async () => null } }] });
  t2.dialog().listeners.keydown(t2.key("N"));
  await t2.by("plexus-present-notes-add").listeners.click({ stopPropagation() {} });
  assert.ok(t2.by("plexus-present-notes-add"));
  assert.equal(t2.by("plexus-present-status").textContent, "Could not add notes");
  assert.ok(h);
});

test("no onAdd means no Add notes button; blank children count as empty", () => {
  const t = rich({ children: [{ string: "  ", children: [] }] });
  t.presenter.open({ slides: [{ name: "A", url: "u", notes: { rootUid: "r" } }] });
  t.dialog().listeners.keydown(t.key("n"));
  assert.equal(t.by("plexus-present-notes-empty").textContent, "No notes");
  assert.equal(t.by("plexus-present-notes-add"), undefined);
});

test("notes are capped at 30 blocks and rendering never throws", () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ string: `n${i}`, children: [] }));
  const t = rich({ children: many, hostOverrides: {} });
  t.presenter.open({ slides: [{ name: "A", url: "u", notes: { rootUid: "r" } }] });
  t.dialog().listeners.keydown(t.key("n"));
  assert.equal(t.rendered.length, 30);
  const t2 = rich({ hostOverrides: { pullEmbedContent: () => { throw new Error("boom"); } } });
  t2.presenter.open({ slides: three });
  t2.dialog().listeners.keydown(t2.key("n"));
  assert.equal(t2.by("plexus-present-notes-empty").textContent, "No notes");
});

test("pane captures link clicks so Roam never sees them", () => {
  const t = rich();
  t.presenter.open({ slides: three });
  const pane = t.by("plexus-present-notes");
  const seen = {};
  const link = { closest: () => ({}) };
  pane.listeners["click:capture"]({ target: link, preventDefault: () => { seen.prevented = true; }, stopPropagation: () => { seen.stopped = true; } });
  assert.deepEqual(seen, { prevented: true, stopped: true });
  const plain = {};
  const seen2 = {};
  pane.listeners["click:capture"]({ target: { closest: () => null }, preventDefault: () => { seen2.p = true; }, stopPropagation: () => { seen2.s = true; } });
  assert.deepEqual(seen2, {});
  void plain;
});

test("clicks advance only outside the pane, controls and canvas, and never while a tool is on", () => {
  const t = rich();
  t.presenter.open({ slides: three });
  const d = t.dialog();
  const hud = t.by("plexus-present-hud");
  const pane = t.by("plexus-present-notes");
  const canvas = t.by("plexus-present-canvas");
  const controls = t.by("plexus-present-controls");
  d.listeners.click({ clientX: 900, target: pane.children[0] ?? pane, stopPropagation() {} });
  assert.equal(hud.textContent, "1 / 3 · A");
  d.listeners.click({ clientX: 900, target: canvas, stopPropagation() {} });
  d.listeners.click({ clientX: 900, target: controls, stopPropagation() {} });
  assert.equal(hud.textContent, "1 / 3 · A");
  d.listeners.click({ clientX: 900, target: t.by("plexus-present-slide"), stopPropagation() {} });
  assert.equal(hud.textContent, "2 / 3 · B");
  d.listeners.keydown(t.key("l"));
  d.listeners.click({ clientX: 900, target: t.by("plexus-present-slide"), stopPropagation() {} });
  assert.equal(hud.textContent, "2 / 3 · B");
});

test("keys from inside the pane scroll: no navigation, no preventDefault; modified N/L/P and repeats are ignored", () => {
  const t = rich();
  t.presenter.open({ slides: three });
  const d = t.dialog();
  const pane = t.by("plexus-present-notes");
  const inner = { parentNode: pane };
  const e = t.key("ArrowRight", { target: inner });
  d.listeners.keydown(e);
  assert.equal(t.by("plexus-present-hud").textContent, "1 / 3 · A");
  assert.equal(e.prevented, undefined);
  for (const extra of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { repeat: true }, { isComposing: true }]) {
    d.listeners.keydown(t.key("p", extra));
    d.listeners.keydown(t.key("l", extra));
    d.listeners.keydown(t.key("n", extra));
  }
  assert.equal(pane.hidden, true);
  assert.equal(t.by("plexus-present-canvas").style.pointerEvents, "none");
  const cmdP = t.key("p", { metaKey: true });
  d.listeners.keydown(cmdP);
  assert.equal(cmdP.prevented, undefined);
});

test("Enter on a focused tool button is left to the button", () => {
  const t = rich();
  t.presenter.open({ slides: three });
  const e = t.key("Enter", { target: { tagName: "BUTTON", parentNode: t.by("plexus-present-controls") } });
  t.dialog().listeners.keydown(e);
  assert.equal(t.by("plexus-present-hud").textContent, "1 / 3 · A");
  assert.equal(e.prevented, undefined);
});

test("canvas backing store follows devicePixelRatio and resize; listener removed on close", () => {
  const t = rich();
  t.presenter.open({ slides: three });
  const c = t.by("plexus-present-canvas");
  assert.equal(c.width, 1600);
  assert.equal(c.height, 900);
  assert.ok(c.calls.some((x) => x[0] === "setTransform" && x[1] === 2 && x[4] === 2));
  assert.equal(typeof t.winListeners.resize, "function");
  t.presenter.close();
  assert.equal(t.winListeners.resize, undefined);
});

test("laser records moves, animates only while the trail is alive, then stops; clears on slide change", () => {
  const t = rich();
  t.presenter.open({ slides: three, laser: { color: "#00ff00", decay: 1000 } });
  const c = t.by("plexus-present-canvas");
  t.dialog().listeners.keydown(t.key("l"));
  assert.equal(c.style.pointerEvents, "auto");
  assert.equal(c.style.touchAction, "none");
  assert.equal(t.rafQueue.length, 0);
  c.listeners.pointermove({ clientX: 110, clientY: 120 });
  assert.equal(t.rafQueue.length, 1);
  c.listeners.pointermove({ clientX: 120, clientY: 130 });
  assert.equal(t.rafQueue.length, 1, "one pending frame at most");
  t.tick(500);
  assert.equal(t.flush(), 1);
  assert.equal(t.rafQueue.length, 1, "trail still alive schedules another frame");
  assert.equal(c.ctx.strokeStyle, "#00ff00");
  t.tick(600);
  t.flush();
  assert.equal(t.rafQueue.length, 0, "trail decayed, no idle frames");
  c.listeners.pointermove({ clientX: 1, clientY: 1 });
  t.dialog().listeners.keydown(t.key("ArrowRight"));
  assert.equal(t.rafQueue.filter(Boolean).length, 0, "slide change cancels the frame");
});

test("pen draws only while pressed, captures the pointer, clears when turned off and on slide change; L and P are exclusive", () => {
  const t = rich();
  t.presenter.open({ slides: three });
  const c = t.by("plexus-present-canvas");
  const d = t.dialog();
  d.listeners.keydown(t.key("p"));
  c.listeners.pointermove({ clientX: 30, clientY: 40 });
  assert.equal(c.calls.filter((x) => x[0] === "lineTo").length, 0);
  c.listeners.pointerdown({ pointerId: 7, clientX: 30, clientY: 40 });
  assert.ok(c.calls.some((x) => x[0] === "capture" && x[1] === 7));
  c.listeners.pointermove({ clientX: 50, clientY: 60 });
  c.listeners.pointerup({});
  const lines = c.calls.filter((x) => x[0] === "lineTo").length;
  assert.ok(lines > 0);
  c.listeners.pointermove({ clientX: 70, clientY: 80 });
  assert.equal(c.calls.filter((x) => x[0] === "lineTo").length, lines, "no drawing after release");
  assert.equal(t.rafQueue.length, 0, "pen never runs frames");
  d.listeners.keydown(t.key("l"));
  assert.equal(t.dialog().attrs["data-tool"], "laser");
  d.listeners.keydown(t.key("l"));
  assert.equal(c.style.pointerEvents, "none");
  d.listeners.keydown(t.key("p"));
  c.calls.length = 0;
  d.listeners.keydown(t.key("p"));
  assert.ok(c.calls.some((x) => x[0] === "clearRect"));
});

test("notice shows in the dialog and clears after 4 s; setSlide with notes repaints", () => {
  const t = rich();
  const h = t.presenter.open({ slides: three });
  const status = t.by("plexus-present-status");
  assert.equal(status.hidden, true);
  h.notice("Skipped 2 children");
  assert.equal(status.textContent, "Skipped 2 children");
  assert.equal(status.hidden, false);
  const timer = t.timers.at(-1);
  assert.equal(timer.ms, 4000);
  timer.fn();
  assert.equal(status.hidden, true);
  t.dialog().listeners.keydown(t.key("n"));
  const before = t.rendered.length;
  h.setSlide(0, { notes: { rootUid: "root9" } });
  assert.ok(t.rendered.length > before);
  assert.equal(t.watches.at(-1).uid, "root9");
  h.close();
  h.notice("late");
  assert.equal(status.textContent, "");
});
