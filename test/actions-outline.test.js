import assert from "node:assert/strict";
import test from "node:test";

import { createOutlineActions, OUTLINE_CONTAINER } from "../src/actions-outline.js";
import { fnv1a } from "../src/model/hash.js";

const DRAW = "drw000001";
const base = { angle: 0, isDeleted: false, version: 1 };
const txt = (id, text, x, y, extra = {}) => ({ ...base, id, type: "text", x, y, width: 80, height: 20, text, originalText: text, ...extra });
const frameEl = (id, name, x, y) => ({ ...base, id, type: "frame", name, x, y, width: 400, height: 300 });

// In-memory blocks plus the slice of roamAlphaAPI and host the actions touch.
function make(over = {}) {
  const blocks = new Map();
  let seq = 0;
  const put = (uid, string, parent, extra = {}) => {
    blocks.set(uid, { uid, string, heading: 0, parent, children: [], refs: [], ...extra });
    if (parent) {
      const p = blocks.get(parent);
      const at = extra.order === "last" || extra.order == null ? p.children.length : Math.min(extra.order, p.children.length);
      p.children.splice(at, 0, uid);
    }
  };
  put(DRAW, "{{[[plexus-drawing]]}}", null);
  for (const [uid, string, parent] of over.blocks || []) put(uid, string, parent);
  const toasts = [];
  const log = [];
  const tree = (uid) => {
    const b = blocks.get(uid);
    return {
      ":block/uid": b.uid, ":block/string": b.string, ":block/heading": b.heading || undefined,
      ":block/order": blocks.get(b.parent)?.children.indexOf(uid) ?? 0,
      ":block/children": b.children.map(tree),
    };
  };
  const removeBlock = (uid) => {
    const b = blocks.get(uid);
    if (!b) return;
    b.children.slice().forEach(removeBlock);
    const p = blocks.get(b.parent);
    if (p) p.children.splice(p.children.indexOf(uid), 1);
    blocks.delete(uid);
  };
  const parseMd = (md) => {
    const roots = [];
    const stack = [];
    for (const line of md.split("\n")) {
      const m = /^( *)- (.*)$/.exec(line);
      if (!m) {
        const last = stack[stack.length - 1];
        last.string += `\n${line.trim()}`;
        continue;
      }
      const depth = m[1].length / 2;
      let s = m[2];
      let heading = 0;
      const h = /^(#{1,3}) (.*)$/.exec(s);
      if (h) { s = h[2]; if (!over.dropHeadings) heading = h[1].length; }
      const node = { string: over.mangle ? s.toUpperCase() : s, heading, children: [] };
      stack.length = depth;
      (depth ? stack[depth - 1].children : roots).push(node);
      stack[depth] = node;
    }
    return roots;
  };
  const api = {
    graph: { name: "g" },
    util: { generateUID: () => `gen${String(++seq).padStart(6, "0")}`, dateToPageTitle: () => "September 30th, 2026" },
    data: {
      pull: (pattern, [, uid]) => {
        const b = blocks.get(uid);
        if (!b) return null;
        if (pattern.includes("_refs")) return { ":block/uid": uid, ":block/_refs": b.refs.map((r) => ({ ":block/uid": r })) };
        return tree(uid);
      },
      block: {
        async fromMarkdown({ location, "markdown-string": md }) {
          log.push(["fromMarkdown", location["parent-uid"], location.order]);
          if (over.failInsert) throw new Error("boom");
          const uids = [];
          const add = (node, parent, order) => {
            const uid = api.util.generateUID();
            put(uid, node.string, parent, { order, heading: node.heading });
            node.children.forEach((c, i) => add(c, uid, i));
            return uid;
          };
          parseMd(md).forEach((n, i) => uids.push(add(n, location["parent-uid"], location.order + i)));
          return { uids };
        },
        async create({ location, block }) {
          log.push(["create", block.string]);
          if (blocks.has(block.uid)) throw new Error("exists");
          put(block.uid, block.string, location["parent-uid"], { order: location.order, heading: block.heading || 0 });
        },
        async update({ block }) { log.push(["update", block.uid, block.heading]); blocks.get(block.uid).heading = block.heading; },
        async delete({ block }) {
          log.push(["delete", block.uid]);
          if (over.failDelete && over.failDelete(block.uid)) throw new Error("nope");
          removeBlock(block.uid);
        },
      },
    },
  };
  const host = {
    pullBlock: (uid) => {
      const b = blocks.get(uid);
      return b ? { uid, string: b.string, children: b.children.map((c) => ({ uid: c, string: blocks.get(c).string })) } : null;
    },
    async createBlock({ parentUid, order = "last", string, uid }) {
      log.push(["createBlock", uid, string]);
      if (over.createRace) { over.createRace(put); }
      if (blocks.has(uid)) throw new Error("exists");
      put(uid, string, parentUid, { order });
      return uid;
    },
    drawing: (uid) => (uid === DRAW ? { elements: over.persisted ?? [] } : null),
  };
  const editorApp = over.elements
    ? { getSceneElements: () => over.elements, state: { selectedElementIds: over.selected || {} } }
    : null;
  const native = {
    activeEditor: () => (editorApp ? { app: editorApp, drawingUid: DRAW } : null),
    selectedElementIds: (a) => Object.keys(a.state.selectedElementIds),
    withClipboard: (fn) => fn(),
  };
  const written = [];
  const clipboard = { writeText: async (t) => { if (over.clipFail) throw new Error("blocked"); written.push(t); } };
  const toaster = { show: (m, o) => toasts.push([m, o?.kind]) };
  const previews = [];
  const openPreview = over.openPreview || ((opts) => { previews.push(opts); return { close() { opts.onClose(); } }; });
  const locks = [];
  const withLockFn = over.withLockFn || (async (name, fn) => { locks.push(name); return { acquired: true, value: await fn() }; });
  const actions = createOutlineActions({ host, native, api, toaster, clipboard, withLockFn, openPreview, doc: {} });
  return { actions, blocks, log, toasts, written, previews, locks, put, api };
}

const kidsOf = (t, uid) => t.blocks.get(uid).children.map((u) => t.blocks.get(u));
const els = [frameEl("f", "Plan", 0, 0), txt("a", "One", 10, 10, { frameId: "f" }), txt("b", "Two", 10, 60, { frameId: "f" }), txt("c", "Free", 900, 0)];

test("first run creates the collapsed deterministic container and writes headings", async () => {
  const t = make({ elements: els });
  const r = await t.actions.drawingToOutline(DRAW);
  const uid = `o${fnv1a(DRAW)}`;
  assert.equal(r.ok, true);
  assert.equal(r.containerUid, uid);
  assert.equal(uid.length, 9);
  assert.equal(t.blocks.get(uid).string, OUTLINE_CONTAINER);
  assert.deepEqual(t.locks, [`plexus:g:${DRAW}`]);
  const tops = kidsOf(t, uid);
  assert.deepEqual(tops.map((b) => [b.string, b.heading]), [["Plan", 2], ["Free", 0]]);
  assert.deepEqual(kidsOf(t, tops[0].uid).map((b) => b.string), ["One", "Two"]);
  assert.equal(t.toasts.at(-1)[0], "Outline written · 4 blocks");
});

test("re-run inserts first, deletes second, keeps the container uid and uses an existing container", async () => {
  const t = make({ elements: els, blocks: [["oldcont01", ` ${OUTLINE_CONTAINER} `, DRAW], ["oldkid001", "stale", "oldcont01"]] });
  await t.actions.drawingToOutline(DRAW);
  const ops = t.log.map((l) => l[0]);
  assert.ok(ops.indexOf("fromMarkdown") < ops.indexOf("delete"));
  assert.deepEqual(t.log.find((l) => l[0] === "fromMarkdown").slice(1), ["oldcont01", 1]);
  assert.equal(t.log.some((l) => l[0] === "createBlock"), false);
  assert.deepEqual(kidsOf(t, "oldcont01").map((b) => b.string), ["Plan", "Free"]);
  assert.equal(t.blocks.has("oldkid001"), false);
});

test("a container race is resolved by re-finding it", async () => {
  const uid = `o${fnv1a(DRAW)}`;
  const t = make({ elements: els, createRace: (put) => put(uid, OUTLINE_CONTAINER, DRAW) });
  const r = await t.actions.drawingToOutline(DRAW);
  assert.equal(r.ok, true);
  assert.equal(r.containerUid, uid);
});

test("a previous outline referenced from outside is refused; nothing is written", async () => {
  const t = make({ elements: els, blocks: [["cont00001", OUTLINE_CONTAINER, DRAW], ["kid000001", "old", "cont00001"]] });
  t.blocks.get("kid000001").refs.push("elsewhere1");
  const r = await t.actions.drawingToOutline(DRAW);
  assert.equal(r.ok, false);
  assert.equal(t.log.some((l) => l[0] === "fromMarkdown" || l[0] === "delete"), false);
  assert.match(t.toasts.at(-1)[0], /referenced elsewhere/);
  // a ref from inside the outline itself is fine
  const u = make({ elements: els, blocks: [["cont00001", OUTLINE_CONTAINER, DRAW], ["kid000001", "old", "cont00001"], ["kid000002", "old2", "cont00001"]] });
  u.blocks.get("kid000001").refs.push("kid000002");
  assert.equal((await u.actions.drawingToOutline(DRAW)).ok, true);
});

test("an insert that throws keeps the old outline and deletes nothing old", async () => {
  const t = make({ elements: els, failInsert: true, blocks: [["cont00001", OUTLINE_CONTAINER, DRAW], ["kid000001", "old", "cont00001"]] });
  const r = await t.actions.drawingToOutline(DRAW);
  assert.equal(r.ok, false);
  assert.equal(t.blocks.has("kid000001"), true);
  assert.deepEqual(kidsOf(t, "cont00001").map((b) => b.string), ["old"]);
  assert.equal(t.toasts.at(-1)[1], "error");
});

test("a failing delete of the old outline toasts and reports removedAll false", async () => {
  const t = make({ elements: els, failDelete: (u) => u === "kid000001", blocks: [["cont00001", OUTLINE_CONTAINER, DRAW], ["kid000001", "old", "cont00001"]] });
  const r = await t.actions.drawingToOutline(DRAW);
  assert.equal(r.ok, true);
  assert.equal(r.removedAll, false);
  assert.equal(t.toasts.at(-1)[0], "The previous outline could not be fully removed");
});

test("headings that do not stick are set with block.update", async () => {
  const t = make({ elements: els, dropHeadings: true });
  const r = await t.actions.drawingToOutline(DRAW);
  assert.equal(r.ok, true);
  const tops = kidsOf(t, r.containerUid);
  assert.deepEqual(tops.map((b) => [b.string, b.heading]), [["Plan", 2], ["Free", 0]]);
  assert.deepEqual(t.log.filter((l) => l[0] === "update").map((l) => l[2]), [2]);
  assert.equal(t.log.some((l) => l[0] === "create"), false);
});

test("strings that do not round-trip fall back to sequential creates in the same container", async () => {
  const t = make({ elements: els, mangle: true });
  const r = await t.actions.drawingToOutline(DRAW);
  assert.equal(r.ok, true);
  const tops = kidsOf(t, r.containerUid);
  assert.deepEqual(tops.map((b) => [b.string, b.heading]), [["Plan", 2], ["Free", 0]]);
  assert.deepEqual(kidsOf(t, tops[0].uid).map((b) => b.string), ["One", "Two"]);
  assert.equal(t.log.filter((l) => l[0] === "create").length, 4);
});

test("a text item that looks like a heading is written block by block and keeps its hash", async () => {
  const t = make({ elements: [frameEl("f", "Plan", 0, 0), txt("h", "# not a heading", 10, 10)] });
  const r = await t.actions.drawingToOutline(DRAW);
  assert.equal(r.ok, true);
  assert.equal(t.log.some((l) => l[0] === "fromMarkdown"), false);
  const tops = kidsOf(t, r.containerUid);
  assert.deepEqual(tops.map((b) => [b.string, b.heading]), [["Plan", 2], ["# not a heading", 0]]);
});

test("lock not acquired: toast and write nothing", async () => {
  const t = make({ elements: els, withLockFn: async () => ({ acquired: false }) });
  const r = await t.actions.drawingToOutline(DRAW);
  assert.equal(r.ok, false);
  assert.equal(t.log.length, 0);
  assert.equal(t.toasts.at(-1)[1], "error");
});

test("nothing to outline, nothing selected and no editor for a selection", async () => {
  const empty = make({ elements: [] });
  assert.equal((await empty.actions.drawingToOutline(DRAW)).ok, false);
  assert.equal(empty.toasts.at(-1)[0], "Nothing to outline");
  const none = make({ elements: els, selected: {} });
  await none.actions.drawingToOutline(DRAW, { selection: true });
  assert.equal(none.toasts.at(-1)[0], "Nothing is selected");
  const closed = make({ persisted: els });
  await closed.actions.drawingToOutline(DRAW, { selection: true });
  assert.match(closed.toasts.at(-1)[0], /Open the drawing/);
});

test("selection uses the selected element ids; a closed drawing reads the persisted elements", async () => {
  const t = make({ elements: els, selected: { c: true } });
  const r = await t.actions.drawingToOutline(DRAW, { selection: true });
  assert.deepEqual(kidsOf(t, r.containerUid).map((b) => b.string), ["Free"]);
  const closed = make({ persisted: els });
  const r2 = await closed.actions.drawingToOutline(DRAW);
  assert.equal(r2.count, 4);
});

const many = (n) => Array.from({ length: n }, (_, i) => txt(`t${i}`, `Item ${i}`, 0, i * 30));

test("above 50 blocks the preview opens first and nothing is written until Write", async () => {
  const t = make({ elements: [frameEl("f", "Big", 0, 0), ...many(60)] });
  const p = t.actions.drawingToOutline(DRAW);
  assert.equal(t.previews.length, 1);
  assert.equal(t.log.length, 0);
  assert.deepEqual(t.previews[0].headings, ["Big"]);
  assert.equal(t.previews[0].count, 61);
  assert.equal(t.previews[0].replacing, 0);
  const r = await t.previews[0].onWrite().then(() => p);
  assert.equal(r.ok, true);
  assert.equal(r.count, 61);
});

test("closing the preview cancels; exactly 50 blocks write directly", async () => {
  const t = make({ elements: many(60).map((e, i) => (i < 55 ? e : { ...e, isDeleted: true })).concat([frameEl("f", "F", 900, 0)]) });
  const p = t.actions.drawingToOutline(DRAW);
  t.previews[0].onClose();
  assert.equal((await p).reason, "cancelled");
  const fifty = make({ elements: many(50) });
  assert.equal((await fifty.actions.drawingToOutline(DRAW)).ok, true);
  assert.equal(fifty.previews.length, 0);
});

test("above 500 blocks is refused with a toast", async () => {
  const t = make({ elements: many(501) });
  const r = await t.actions.drawingToOutline(DRAW);
  assert.equal(r.reason, "too-many");
  assert.equal(t.previews.length, 0);
  assert.equal(t.log.length, 0);
  assert.equal(t.toasts.at(-1)[1], "error");
});

test("the preview reports how many blocks a re-run replaces", async () => {
  const t = make({ elements: many(60), blocks: [["cont00001", OUTLINE_CONTAINER, DRAW], ["kid000001", "old", "cont00001"], ["kid000002", "child", "kid000001"]] });
  t.actions.drawingToOutline(DRAW);
  assert.equal(t.previews[0].replacing, 2);
});

test("copyMarkdown writes through withClipboard and never touches the graph", async () => {
  const t = make({ elements: els });
  assert.equal(await t.actions.copyMarkdown(DRAW), true);
  assert.deepEqual(t.written, ["- ## Plan\n  - One\n  - Two\n- Free"]);
  assert.equal(t.log.length, 0);
  assert.equal(t.toasts.at(-1)[0], "Copied as Roam markdown");
  const bad = make({ elements: els, clipFail: true });
  assert.equal(await bad.actions.copyMarkdown(DRAW), false);
  assert.equal(bad.toasts.at(-1)[1], "error");
  const empty = make({ elements: [] });
  assert.equal(await empty.actions.copyMarkdown(DRAW), false);
});

test("copyMarkdown starts the clipboard write synchronously", () => {
  const t = make({ elements: els });
  t.actions.copyMarkdown(DRAW);
  assert.equal(t.written.length, 1);
});

test("dispose closes an open preview and refuses new work", async () => {
  const t = make({ elements: many(60) });
  const p = t.actions.drawingToOutline(DRAW);
  t.actions.dispose();
  assert.equal((await p).reason, "cancelled");
  assert.equal((await t.actions.drawingToOutline(DRAW)).reason, "disposed");
});
