import assert from "node:assert/strict";
import test from "node:test";

import { openTemplatePicker } from "../src/view/template-picker.js";

class El extends EventTarget {
  constructor(tag) {
    super();
    this.tag = tag;
    this.children = [];
    this.style = {};
    this.className = "";
    this.textContent = "";
    this.attrs = {};
  }
  append(...nodes) { this.children.push(...nodes); }
  remove() { this.removed = true; }
  focus() { this.focused = true; }
  setAttribute(k, v) { this.attrs[k] = v; }
}
const all = (root, pred, out = []) => { if (pred(root)) out.push(root); for (const c of root.children) all(c, pred, out); return out; };
const byClass = (root, cls) => all(root, (n) => n.className.split(" ").includes(cls));
const key = (k, extra = {}) => Object.assign(new Event("keydown", { cancelable: true, bubbles: true }), { key: k, ...extra });
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 40; i++) await tick(); };

function setup(over = {}) {
  const doc = { body: new El("body"), createElement: (t) => new El(t) };
  const picked = [];
  const closed = [];
  const thumbCalls = [];
  const urlLog = { made: [], revoked: [] };
  const urls = { createObjectURL: (b) => { const u = `blob:${b.name}`; urlLog.made.push(u); return u; }, revokeObjectURL: (u) => urlLog.revoked.push(u) };
  const deferred = [];
  const handle = openTemplatePicker({
    doc,
    zIndex: 1234,
    starters: [{ id: "s1", name: "Starter One" }, { id: "s2", name: "Starter Two" }],
    userTemplates: over.userTemplates ?? [{ uid: "u1", drawingUid: "d1", name: "Mine" }, { uid: "u2", drawingUid: "d2", name: "Other" }],
    thumbnail: over.thumbnail ?? (async (uid, opts) => { thumbCalls.push([uid, opts]); return null; }),
    onPick: (item) => picked.push(item),
    onClose: () => closed.push(1),
    urls,
    defer: (fn) => { deferred.push(fn); return deferred.length; },
    ...(over.extra || {}),
  });
  return { doc, handle, root: doc.body.children[0], picked, closed, thumbCalls, urlLog, deferred };
}

test("opens on body at the given z-index with starters first and no thumbnail work yet", () => {
  const s = setup();
  assert.match(s.root.className, /plexus-portal plexus-template-picker/);
  assert.equal(s.root.style.zIndex, "1234");
  const headings = byClass(s.root, "plexus-template-heading").map((n) => n.textContent);
  assert.deepEqual(headings, ["Starters", "My templates"]);
  const names = byClass(s.root, "plexus-template-name").map((n) => n.textContent);
  assert.deepEqual(names, ["Starter One", "Starter Two", "Mine", "Other"]);
  const tiles = byClass(s.root, "plexus-template-tile");
  assert.deepEqual(tiles.slice(0, 2).map((t) => byClass(t, "plexus-template-thumb").length), [0, 0]);
  assert.deepEqual(tiles.slice(2).map((t) => byClass(t, "plexus-template-thumb").length), [1, 1]);
  assert.equal(s.thumbCalls.length, 0, "nothing renders while it opens");
  assert.equal(s.deferred.length, 1);
  assert.equal(s.handle.isOpen(), true);
});

test("clicking a tile closes the picker first, then picks", () => {
  const s = setup();
  const tiles = byClass(s.root, "plexus-template-tile");
  tiles[3].dispatchEvent(new Event("click"));
  assert.equal(s.root.removed, true);
  assert.deepEqual(s.picked, [{ kind: "user", uid: "u2", drawingUid: "d2", name: "Other" }]);
  assert.equal(s.closed.length, 1);
  const s2 = setup();
  byClass(s2.root, "plexus-template-tile")[0].dispatchEvent(new Event("click"));
  assert.deepEqual(s2.picked, [{ kind: "starter", id: "s1", name: "Starter One" }]);
});

test("Escape and Cancel close once and pick nothing; typing keys do not escape the picker", () => {
  const s = setup();
  const outer = [];
  s.doc.body.addEventListener("keydown", (e) => outer.push(e.key));
  const a = key("a");
  s.root.dispatchEvent(a);
  assert.equal(a.cancelBubble, true);
  const esc = key("Escape");
  s.root.dispatchEvent(esc);
  assert.equal(esc.defaultPrevented, true);
  assert.equal(s.root.removed, true);
  assert.equal(s.closed.length, 1);
  s.root.dispatchEvent(key("Escape"));
  assert.equal(s.closed.length, 1);
  assert.equal(s.picked.length, 0);
  const s2 = setup();
  byClass(s2.root, "plexus-template-cancel")[0].dispatchEvent(new Event("click"));
  assert.equal(s2.closed.length, 1);
  const s3 = setup();
  s3.root.dispatchEvent(key("Escape", { isComposing: true }));
  assert.equal(s3.handle.isOpen(), true);
});

test("thumbnails: cache-only for every template first, then at most 6 serial renders, then object urls are revoked on close", async () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ uid: `u${i}`, drawingUid: `d${i}`, name: `T${i}` }));
  const calls = [];
  let inflight = 0;
  let peak = 0;
  const thumbnail = async (uid, opts) => {
    calls.push([uid, opts.render]);
    inflight += 1;
    peak = Math.max(peak, inflight);
    await tick();
    inflight -= 1;
    if (opts.render && uid === "d1") return { name: "one" };
    if (!opts.render && uid === "d0") return { name: "cached" };
    return null;
  };
  const s = setup({ userTemplates: many, thumbnail });
  assert.equal(calls.length, 0);
  s.deferred[0]();
  await settle();
  const cacheOnly = calls.filter((c) => !c[1]);
  const renders = calls.filter((c) => c[1]);
  assert.equal(cacheOnly.length, 9);
  assert.equal(renders.length, 6);
  assert.deepEqual(renders.map((c) => c[0]), ["d1", "d2", "d3", "d4", "d5", "d6"]);
  assert.ok(calls.slice(0, 9).every((c) => !c[1]), "all cache-only calls come before any render");
  assert.equal(peak, 1, "serial");
  assert.deepEqual(s.urlLog.made, ["blob:cached", "blob:one"]);
  assert.equal(byClass(s.root, "plexus-template-img").length, 2);
  s.handle.close();
  assert.deepEqual(s.urlLog.revoked, ["blob:cached", "blob:one"]);
});

test("closing while thumbnails load stops further calls and makes no urls", async () => {
  let resolveFirst;
  const calls = [];
  const thumbnail = (uid, opts) => { calls.push([uid, opts.render]); return new Promise((r) => { if (calls.length === 1) resolveFirst = r; else r(null); }); };
  const s = setup({ thumbnail });
  s.deferred[0]();
  await tick();
  s.handle.close();
  resolveFirst({ name: "late" });
  await settle();
  assert.equal(calls.length, 1);
  assert.equal(s.urlLog.made.length, 0);
});

test("a failing thumbnail leaves the tile as a name only", async () => {
  const s = setup({ thumbnail: async () => { throw new Error("boom"); } });
  s.deferred[0]();
  await settle();
  assert.equal(byClass(s.root, "plexus-template-img").length, 0);
  assert.equal(s.handle.isOpen(), true);
});

test("no user templates shows a hint and starts no thumbnail work; opening again replaces the first", () => {
  const s = setup({ userTemplates: [] });
  assert.equal(s.deferred.length, 0);
  assert.equal(byClass(s.root, "plexus-template-empty").length, 1);
  assert.equal(byClass(s.root, "plexus-template-heading").length, 1);
  const doc = { body: new El("body"), createElement: (t) => new El(t) };
  const a = openTemplatePicker({ doc, starters: [{ id: "x", name: "X" }] });
  const b = openTemplatePicker({ doc, starters: [{ id: "y", name: "Y" }] });
  assert.equal(a.isOpen(), false);
  assert.equal(b.isOpen(), true);
  assert.equal(doc.body.children[0].removed, true);
  b.close();
});

test("the default defer waits a frame, then a timer, and close cancels both", async () => {
  const frames = [];
  const cancelled = [];
  const saved = [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame];
  globalThis.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
  globalThis.cancelAnimationFrame = (id) => cancelled.push(id);
  try {
    const s = setup({ extra: { defer: undefined } });
    await settle();
    assert.equal(s.thumbCalls.length, 0, "nothing renders before the first frame");
    frames[0]();
    await settle();
    assert.ok(s.thumbCalls.length > 0, "cache pass runs after the frame");
    const t = setup({ extra: { defer: undefined } });
    t.handle.close();
    assert.deepEqual(cancelled, [2]);
    frames[1]?.();
    await settle();
    assert.equal(t.thumbCalls.length, 0);
  } finally {
    [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame] = saved;
  }
});
