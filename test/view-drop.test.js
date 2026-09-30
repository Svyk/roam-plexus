import assert from "node:assert/strict";
import test from "node:test";

import { claimableTypes, installRoamDrop, parseRoamDrop } from "../src/view/drop.js";

// Spike A capture (real bullet drag, Readwisenotes).
const SPIKE_A = {"items":[{"type":"text/plain","data":" "},{"type":"text/uri-list","data":"https://roamresearch.com/#/app/Readwisenotes/page/plxDS0002\r\nhttps://roamresearch.com/#/app/Readwisenotes/page/plxDS0004"},{"type":"roam/roam-uri-list","data":"roam://#/app/Readwisenotes/page/plxDS0002\r\nroam://#/app/Readwisenotes/page/plxDS0004"},{"type":"roam/block-uid-list","data":"plxDS0002\r\nplxDS0004"},{"type":"roam/block-uid-list-only-parents","data":"plxDS0002"}]};

const payload = (items) => Object.fromEntries(items.map((i) => [i.type, i.data]));
const dt = (data, { protectedMode = false, effectAllowed = "uninitialized" } = {}) => ({
  types: Object.keys(data),
  effectAllowed,
  dropEffect: "none",
  getData: (t) => (protectedMode ? "" : data[t] ?? ""),
});
const known = { plxDS0002: { kind: "block" }, plxDS0004: { kind: "block" } };
const resolve = async (uid) => known[uid] ?? null;

test("claimableTypes claims by types only", () => {
  assert.equal(claimableTypes(["roam/block-uid-list-only-parents"]), true);
  assert.equal(claimableTypes(["text/plain", "roam/block-uid-list"]), true);
  assert.equal(claimableTypes({ 0: "application/x-plexus-ref", length: 1 }), true);
  assert.equal(claimableTypes(["text/uri-list"]), false);
  assert.equal(claimableTypes(["Files"]), false);
  assert.equal(claimableTypes(["text/plain"]), false);
  assert.equal(claimableTypes(null), false);
});

test("parseRoamDrop uses only-parents first, with refs", async () => {
  const r = await parseRoamDrop(dt(payload(SPIKE_A.items)), { resolve });
  assert.deepEqual(r, { items: [{ kind: "block", uid: "plxDS0002", ref: "((plxDS0002))" }], excluded: 0 });
});

test("parseRoamDrop falls back to block-uid-list then uri list, de-duplicated in order", async () => {
  const all = payload(SPIKE_A.items);
  delete all["roam/block-uid-list-only-parents"];
  const r = await parseRoamDrop(dt(all), { resolve });
  assert.deepEqual(r.items.map((i) => i.ref), ["((plxDS0002))", "((plxDS0004))"]);
  delete all["roam/block-uid-list"];
  const r2 = await parseRoamDrop(dt(all), { resolve });
  assert.deepEqual(r2.items.map((i) => i.uid), ["plxDS0002", "plxDS0004"]);
  const r3 = await parseRoamDrop(dt({ "roam/block-uid-list": "plxDS0002\nplxDS0002 plxDS0004" }), { resolve });
  assert.deepEqual(r3.items.map((i) => i.uid), ["plxDS0002", "plxDS0004"]);
});

test("page uids become titles; unknown uids and bad tokens are dropped", async () => {
  const res = async (uid) => ({ p1234abcd: { kind: "page", title: "My Page" }, plxDS0002: { kind: "block" } })[uid] ?? null;
  const r = await parseRoamDrop(dt({ "roam/block-uid-list": "p1234abcd plxDS0002 nope short ghost0001" }), { resolve: res });
  assert.deepEqual(r.items, [
    { kind: "page", title: "My Page", ref: "[[My Page]]" },
    { kind: "block", uid: "plxDS0002", ref: "((plxDS0002))" },
  ]);
  assert.equal(await parseRoamDrop(dt({ "roam/block-uid-list": "ghost0001" }), { resolve: res }), null);
  assert.equal(await parseRoamDrop(dt({}), { resolve }), null);
});

test("the plexus MIME wins; a page ref needs no resolve, a resolve throw is skipped", async () => {
  const r = await parseRoamDrop(dt({ "application/x-plexus-ref": "[[Some Page]]", "roam/block-uid-list": "plxDS0002" }), { resolve });
  assert.deepEqual(r.items, [{ kind: "page", title: "Some Page", ref: "[[Some Page]]" }]);
  const r2 = await parseRoamDrop(dt({ "application/x-plexus-ref": "((plxDS0004))" }), { resolve });
  assert.equal(r2.items[0].ref, "((plxDS0004))");
  const bad = async () => { throw new Error("x"); };
  const w = console.warn; console.warn = () => {};
  try { assert.equal(await parseRoamDrop(dt({ "roam/block-uid-list": "plxDS0002" }), { resolve: bad }), null); } finally { console.warn = w; }
});

test("exclude removes the open drawing; only-excluded reports zero items", async () => {
  const both = dt({ "roam/block-uid-list": "plxDS0002 plxDS0004" });
  assert.deepEqual((await parseRoamDrop(both, { resolve, exclude: "plxDS0002" })).items.map((i) => i.uid), ["plxDS0004"]);
  const only = await parseRoamDrop(dt({ "roam/block-uid-list": "plxDS0002" }), { resolve, exclude: "plxDS0002" });
  assert.deepEqual(only, { items: [], excluded: 1 });
});

test("caps at 500 items", async () => {
  const uids = Array.from({ length: 600 }, (_, i) => `u${String(i).padStart(8, "0")}`);
  const r = await parseRoamDrop(dt({ "roam/block-uid-list": uids.join("\n") }), { resolve: async () => ({ kind: "block" }) });
  assert.equal(r.items.length, 500);
});

function setup({ resolveFn = resolve, exclude } = {}) {
  const listeners = {};
  const docL = {};
  const winL = {};
  const ghosts = [];
  const containerEl = {
    addEventListener(t, f, c) { (listeners[t] ||= []).push({ f, c }); },
    removeEventListener(t, f, c) { listeners[t] = (listeners[t] || []).filter((x) => x.f !== f || x.c !== c); },
    getBoundingClientRect: () => ({ left: 10, top: 20 }),
  };
  const win = {
    innerWidth: 800, innerHeight: 600,
    addEventListener(t, f) { (winL[t] ||= []).push(f); },
    removeEventListener(t, f) { winL[t] = (winL[t] || []).filter((x) => x !== f); },
  };
  const doc = {
    defaultView: win,
    createElement: () => { const el = { className: "", style: {}, textContent: "", removed: false, remove() { this.removed = true; } }; ghosts.push(el); return el; },
    body: { append() {} },
    addEventListener(t, f) { (docL[t] ||= []).push(f); },
    removeEventListener(t, f) { docL[t] = (docL[t] || []).filter((x) => x !== f); },
  };
  const timers = [];
  const setTimeout = (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length; };
  const clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1].live = false; };
  const drops = [];
  const toasts = [];
  const app = { state: { scrollX: 0, scrollY: 0, zoom: { value: 2 } } };
  const off = installRoamDrop({ doc, containerEl, app, zIndex: 1000, resolve: resolveFn, exclude, onDrop: (d) => drops.push(d), toast: (m) => toasts.push(m), setTimeout, clearTimeout });
  const ev = (type, data, extra = {}) => {
    const e = { type, dataTransfer: dt(data, { protectedMode: type !== "drop" }), clientX: 110, clientY: 70, prevented: false, stopped: false, immediate: false,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, stopImmediatePropagation() { this.immediate = true; }, ...extra };
    for (const l of listeners[type] || []) l.f(e);
    return e;
  };
  return { listeners, docL, winL, ghosts, timers, drops, toasts, off, ev };
}

const roam = payload(SPIKE_A.items);
const flush = () => new Promise((r) => setImmediate(r));

test("claimed dragover: preventDefault, immediate stop, copy effect, ghost with mode label", () => {
  const t = setup();
  const e = t.ev("dragover", roam);
  assert.equal(e.prevented, true);
  assert.equal(e.immediate, true);
  assert.equal(e.dataTransfer.dropEffect, "copy");
  assert.equal(t.ghosts.length, 1);
  assert.equal(t.ghosts[0].textContent, "Embed");
  assert.equal(t.ghosts[0].style.zIndex, "1003");
  assert.equal(t.ghosts[0].style.left, "122px");
  assert.equal(t.ghosts[0].style.top, "82px");
  t.ev("dragover", roam, { altKey: true });
  assert.equal(t.ghosts[0].textContent, "Link");
  t.ev("dragover", roam, { altKey: true, shiftKey: true });
  assert.equal(t.ghosts[0].textContent, "Label");
  assert.equal(t.ghosts.length, 1, "one chip reused");
});

test("effectAllowed decides the dropEffect", () => {
  const t = setup();
  const mk = (effectAllowed) => t.ev("dragover", roam, { dataTransfer: dt(roam, { protectedMode: true, effectAllowed }) }).dataTransfer.dropEffect;
  assert.equal(mk("all"), "copy");
  assert.equal(mk("move"), "move");
  assert.equal(mk("linkMove"), "link");
  assert.equal(mk("copyMove"), "copy");
});

test("unclaimable drags are untouched", () => {
  const t = setup();
  for (const types of [{ "text/uri-list": "x" }, { Files: "" }, {}]) {
    const e = t.ev("dragover", types);
    assert.equal(e.prevented, false);
    assert.equal(e.immediate, false);
  }
  assert.equal(t.ghosts.length, 0);
  assert.equal(t.ev("drop", { "text/uri-list": "x" }).prevented, false);
  assert.equal(t.drops.length, 0);
});

test("ghost clamps to the viewport", () => {
  const t = setup();
  t.ev("dragover", roam, { clientX: 790, clientY: 595 });
  assert.equal(t.ghosts[0].style.left, "736px");
  assert.equal(t.ghosts[0].style.top, "576px");
});

test("watchdog hides the ghost after 250 ms without dragover and restarts on each dragover", () => {
  const t = setup();
  t.ev("dragover", roam);
  assert.equal(t.timers[0].ms, 250);
  t.ev("dragover", roam);
  assert.equal(t.timers[0].live, false);
  assert.equal(t.timers[1].live, true);
  t.timers[1].fn();
  assert.equal(t.ghosts[0].removed, true);
  t.ev("dragover", roam);
  assert.equal(t.ghosts.length, 2, "a new chip after the watchdog fired");
});

test("document dragend / drop and window blur hide the ghost", () => {
  for (const [bag, type] of [["docL", "dragend"], ["docL", "drop"], ["winL", "blur"]]) {
    const t = setup();
    t.ev("dragover", roam);
    for (const f of t[bag][type]) f({});
    assert.equal(t.ghosts[0].removed, true, type);
  }
});

test("drop places items with the mode from the drop event and the container-relative scene point", async () => {
  const t = setup();
  t.ev("dragover", roam);
  const e = t.ev("drop", roam, { shiftKey: true });
  assert.equal(e.prevented, true);
  assert.equal(e.immediate, true);
  assert.equal(t.ghosts[0].removed, true);
  await flush();
  assert.equal(t.drops.length, 1);
  assert.equal(t.drops[0].mode, "label");
  assert.deepEqual(t.drops[0].scenePoint, { x: 50, y: 25 });
  assert.deepEqual(t.drops[0].items, [{ kind: "block", uid: "plxDS0002", ref: "((plxDS0002))" }]);
  t.ev("drop", roam, { altKey: true });
  t.ev("drop", roam);
  await flush();
  assert.deepEqual(t.drops.map((d) => d.mode), ["label", "link", "embed"]);
});

test("empty parse toasts 'Nothing to place'; a self-drop toasts the exclusion message", async () => {
  const t = setup({ resolveFn: async () => null });
  t.ev("drop", roam);
  await flush();
  assert.deepEqual(t.toasts, ["Nothing to place"]);
  assert.equal(t.drops.length, 0);
  const s = setup({ exclude: "plxDS0002", resolveFn: resolve });
  s.ev("drop", { "roam/block-uid-list-only-parents": "plxDS0002" });
  await flush();
  assert.deepEqual(s.toasts, ["The drawing can't contain itself"]);
});

test("dispose removes every listener and the ghost, and is idempotent", () => {
  const t = setup();
  t.ev("dragover", roam);
  t.off(); t.off();
  assert.equal(t.ghosts[0].removed, true);
  for (const list of Object.values(t.listeners)) assert.equal(list.length, 0);
  for (const list of Object.values(t.docL)) assert.equal(list.length, 0);
  for (const list of Object.values(t.winL)) assert.equal(list.length, 0);
  assert.equal(t.timers.every((x) => !x.live), true);
});

test("a drop whose parse finishes after dispose places nothing", async () => {
  const t = setup();
  t.ev("drop", roam);
  t.off();
  await flush();
  assert.equal(t.drops.length, 0);
});
