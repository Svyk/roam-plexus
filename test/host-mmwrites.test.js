import test from "node:test";
import assert from "node:assert/strict";
import { createMmWriter } from "../src/host/mmwrites.js";

const B = (uid, string, children = [], extra = {}) => ({ ":block/uid": uid, ":block/string": string, ":block/order": 0, ":block/children": children.map((c, i) => ({ ...c, ":block/order": i })), ...extra });

function setup({ blocks = {}, trees = {}, parents = {}, refs = {}, sibling = {}, lockLog = [] } = {}) {
  const writes = [];
  const watches = [];
  let n = 0;
  const api = {
    graph: { name: "g" },
    util: { generateUID: () => `gen${++n}` },
    data: {
      pull(pattern, [, uid]) {
        if (pattern.includes(":block/_refs")) return { ":block/uid": uid, ":block/_refs": (refs[uid] || []).map((u) => ({ ":block/uid": u })) };
        if (pattern.includes(":block/_children")) return sibling[uid] || null;
        if (pattern.includes(":block/parents")) return { ":block/uid": uid, ":block/parents": (parents[uid] || []).map((u) => ({ ":block/uid": u })) };
        if (pattern.includes("...")) return trees[uid] || null;
        return blocks[uid] ? { ":block/uid": uid, ...blocks[uid] } : null;
      },
      block: {
        create: async (a) => { writes.push(["create", a]); },
        update: async (a) => { writes.push(["update", a]); },
        move: async (a) => { writes.push(["move", a]); },
        delete: async (a) => { writes.push(["delete", a]); },
      },
      addPullWatch: (p, i, h) => watches.push({ p, i, h }),
      removePullWatch: (p, i, h) => { const k = watches.findIndex((w) => w.h === h && w.i === i); if (k >= 0) watches.splice(k, 1); },
    },
  };
  const withLockFn = async (name, fn) => { lockLog.push(["in", name]); const value = await fn(); lockLog.push(["out", name]); return { acquired: true, value }; };
  const frames = [];
  const raf = (f) => frames.push(f);
  const flush = () => { const f = frames.splice(0); f.forEach((x) => x()); };
  return { api, writes, watches, lockLog, w: createMmWriter({ api, withLockFn, raf }), flush };
}

test("ops on one root serialize under the mm lock name", async () => {
  const s = setup({ blocks: { r: { ":block/open": true, ":block/string": "a" } } });
  const order = [];
  const orig = s.api.data.block.create;
  s.api.data.block.create = async (a) => { order.push(`s:${a.block.uid}`); await new Promise((r) => setTimeout(r, 5)); order.push(`e:${a.block.uid}`); return orig(a); };
  await Promise.all([s.w.createChild("r", "r", { uid: "a1" }), s.w.createChild("r", "r", { uid: "a2" })]);
  assert.deepEqual(order, ["s:a1", "e:a1", "s:a2", "e:a2"]);
  assert.ok(s.lockLog.every(([, n]) => n === "plexus:g:mm:r"));
});

test("createChild writes last-child create only, caller uid, string only", async () => {
  const s = setup({ blocks: { p: { ":block/open": true } } });
  const uid = await s.w.createChild("r", "p", { uid: "u1", string: "New idea" });
  assert.equal(uid, "u1");
  assert.deepEqual(s.writes, [["create", { location: { "parent-uid": "p", order: "last" }, block: { uid: "u1", string: "New idea" } }]]);
});

test("createChild unfolds a folded parent first with an open-only update", async () => {
  const s = setup({ blocks: { p: { ":block/open": false } } });
  await s.w.createChild("r", "p", { uid: "u1", string: "x" });
  assert.deepEqual(s.writes[0], ["update", { block: { uid: "p", open: true } }]);
  assert.equal(s.writes[1][0], "create");
});

test("createSiblingAfter reads order at write time", async () => {
  const s = setup({ sibling: { x: { ":block/uid": "x", ":block/order": 4, ":block/_children": [{ ":block/uid": "par" }] } } });
  await s.w.createSiblingAfter("r", "x", { uid: "n1", string: "New idea" });
  assert.deepEqual(s.writes[0][1].location, { "parent-uid": "par", order: 5 });
});

test("createSiblingAfter on the root makes a last child", async () => {
  const s = setup({ blocks: { r: { ":block/open": true } } });
  await s.w.createSiblingAfter("r", "r", { uid: "n1", string: "x" });
  assert.deepEqual(s.writes[0][1].location, { "parent-uid": "r", order: "last" });
});

test("updateString is string-only compare-and-set", async () => {
  const s = setup({ blocks: { a: { ":block/string": "old" } } });
  assert.deepEqual(await s.w.updateString("r", "a", "new", "old"), { ok: true, written: true });
  assert.deepEqual(s.writes, [["update", { block: { uid: "a", string: "new" } }]]);
  s.writes.length = 0;
  assert.deepEqual(await s.w.updateString("r", "a", "new", "stale"), { ok: false, reason: "changed" });
  assert.deepEqual(await s.w.updateString("r", "a", "old", "old"), { ok: true, written: false });
  assert.equal(s.writes.length, 0);
});

test("setOpen is open-only", async () => {
  const s = setup();
  await s.w.setOpen("r", "a", false);
  assert.deepEqual(s.writes, [["update", { block: { uid: "a", open: false } }]]);
});

test("no write ever carries props", async () => {
  const s = setup({ blocks: { a: { ":block/string": "o", ":block/open": false } }, trees: { a: B("a", "o", [B("c", "k")]) } });
  await s.w.updateString("r", "a", "n", "o");
  await s.w.setOpen("r", "a", true);
  await s.w.copyBranch("r", "a", "a");
  for (const [, arg] of s.writes) assert.ok(!JSON.stringify(arg).includes("props"));
  for (const [kind, arg] of s.writes.filter((x) => x[0] === "update")) assert.equal(Object.keys(arg.block).filter((k) => k !== "uid").length, 1, kind);
});

test("moveBranch moves as last child and refuses own subtree", async () => {
  const s = setup({ blocks: { a: {}, t: {}, d: {} }, parents: { d: ["a", "z"] } });
  assert.deepEqual(await s.w.moveBranch("r", "a", "t"), { ok: true });
  assert.deepEqual(s.writes.at(-1), ["move", { location: { "parent-uid": "t", order: "last" }, block: { uid: "a" } }]);
  const n = s.writes.length;
  assert.deepEqual(await s.w.moveBranch("r", "a", "d"), { ok: false, reason: "inside-source" });
  assert.deepEqual(await s.w.moveBranch("r", "a", "a"), { ok: false, reason: "inside-source" });
  assert.equal(s.writes.length, n);
});

test("move between maps locks both roots in sorted order", async () => {
  const s = setup({ blocks: { a: {}, t: {} } });
  await s.w.moveBranch("zz", "a", "t", { targetRootUid: "aa" });
  assert.deepEqual(s.lockLog.filter(([k]) => k === "in").map(([, n]) => n), ["plexus:g:mm:aa", "plexus:g:mm:zz"]);
});

test("copyBranch recreates parent before children, depth-first, in order", async () => {
  const tree = B("s", "root", [B("c1", "one", [B("g1", "grand")]), B("c2", "two")]);
  const s = setup({ blocks: { t: { ":block/open": true } }, trees: { s: tree } });
  const r = await s.w.copyBranch("r", "s", "t");
  assert.equal(r.ok, true);
  assert.equal(r.created, 4);
  assert.deepEqual(s.writes.map(([, a]) => [a.location["parent-uid"], a.block.string]), [["t", "root"], ["gen1", "one"], ["gen2", "grand"], ["gen1", "two"]]);
  assert.ok(s.writes.every(([k, a]) => k === "create" && a.location.order === "last"));
});

test("copyBranch skips excluded subtrees and reports them; refuses over 200", async () => {
  const tree = B("s", "root", [B("d", "{{[[excalidraw]]}}", [B("dd", "x")]), B("k", "keep")]);
  const s = setup({ blocks: { t: {} }, trees: { s: tree } });
  const r = await s.w.copyBranch("r", "s", "t");
  assert.equal(r.skipped, 2);
  assert.equal(r.created, 2);
  const big = B("big", "b", Array.from({ length: 200 }, (_, i) => B(`k${i}`, "x")));
  const s2 = setup({ blocks: { t: {} }, trees: { big } });
  assert.deepEqual(await s2.w.copyBranch("r", "big", "t"), { ok: false, reason: "too-large", count: 201 });
  assert.equal(s2.writes.length, 0);
});

test("copyBranch refuses pasting into its own subtree", async () => {
  const s = setup({ blocks: { d: {} }, trees: { s: B("s", "x") }, parents: { d: ["s"] } });
  assert.equal((await s.w.copyBranch("r", "s", "d")).reason, "inside-source");
});

test("deleteBranch deletes only on explicit call, only the branch root", async () => {
  const s = setup({ trees: { a: B("a", "x", [B("b", "y")]) } });
  assert.equal(s.writes.length, 0);
  assert.deepEqual(await s.w.deleteBranch("r", "a", { count: 2, string: "x" }), { ok: true, count: 2 });
  assert.deepEqual(s.writes, [["delete", { block: { uid: "a" } }]]);
});

test("deleteBranch refuses root, mismatch, excluded, and externally referenced", async () => {
  const s = setup({ trees: { a: B("a", "x", [B("b", "y")]), e: B("e", "x", [B("d", "{{[[plexus-region]]}}")]) }, refs: { b: ["outside"] } });
  assert.equal((await s.w.deleteBranch("r", "r")).reason, "root");
  assert.equal((await s.w.deleteBranch("r", "a", { count: 3 })).reason, "changed");
  assert.equal((await s.w.deleteBranch("r", "a", { count: 2, string: "nope" })).reason, "changed");
  assert.equal((await s.w.deleteBranch("r", "e")).reason, "excluded");
  assert.equal((await s.w.deleteBranch("r", "a")).reason, "referenced");
  assert.equal(s.writes.length, 0);
});

test("discardPlaceholder deletes only session-created untouched placeholders", async () => {
  const s = setup({ blocks: { p: { ":block/open": true }, gen1: { ":block/string": "New idea" }, other: { ":block/string": "New idea" } } });
  await s.w.createChild("r", "p", { string: "New idea" });
  s.writes.length = 0;
  assert.equal((await s.w.discardPlaceholder("r", "other", "New idea")).reason, "not-created");
  assert.equal((await s.w.discardPlaceholder("r", "gen1", "Changed")).reason, "changed");
  assert.equal(s.writes.length, 0);
  assert.equal((await s.w.discardPlaceholder("r", "gen1", "New idea")).ok, true);
  assert.deepEqual(s.writes, [["delete", { block: { uid: "gen1" } }]]);
});

test("lock timeout is a write failure", async () => {
  const s = setup();
  const w = createMmWriter({ api: s.api, graph: "g", withLockFn: async () => ({ acquired: false }) });
  await assert.rejects(w.setOpen("r", "a", true), /lock/);
  await assert.rejects(w.setOpen("r", "a", true), /lock/);
});

test("watchTree coalesces fires into one fresh pull per frame", () => {
  const s = setup({ trees: { r: B("r", "root") } });
  const got = [];
  s.w.watchTree("r", (t) => got.push(t));
  const h = s.watches[0].h;
  h({}, {}); h({}, {}); h({}, {});
  assert.equal(got.length, 0);
  s.flush();
  assert.equal(got.length, 1);
  assert.equal(got[0][":block/uid"], "r");
});

test("watch fires during queued ops wait for drain", async () => {
  const s = setup({ blocks: { p: { ":block/open": true } }, trees: { r: B("r", "root") } });
  const got = [];
  s.w.watchTree("r", (t) => got.push(t));
  const h = s.watches[0].h;
  const orig = s.api.data.block.create;
  s.api.data.block.create = async (a) => { h({}, {}); s.flush(); assert.equal(got.length, 0); return orig(a); };
  await s.w.createChild("r", "p", { uid: "u" });
  s.flush();
  assert.equal(got.length, 1);
});

test("watch disposer removes exactly its watch, once", () => {
  const s = setup();
  const d1 = s.w.watchTree("r", () => {});
  const d2 = s.w.watchTree("r", () => {});
  assert.equal(s.watches.length, 2);
  const keep = s.watches[1].h;
  d1(); d1();
  assert.equal(s.watches.length, 1);
  assert.equal(s.watches[0].h, keep);
  d2();
  assert.equal(s.watches.length, 0);
});

test("disposed watch never calls back", () => {
  const s = setup({ trees: { r: B("r", "root") } });
  let n = 0;
  const d = s.w.watchTree("r", () => n++);
  const h = s.watches[0].h;
  h({}, {});
  d();
  s.flush();
  assert.equal(n, 0);
});

test("createChild with unfold:false leaves a collapsed parent (the drawing block) alone", async () => {
  const s = setup({ blocks: { d: { ":block/open": false } } });
  await s.w.createChild("r", "d", { uid: "u1", string: "x", unfold: false });
  assert.deepEqual(s.writes.map((w) => w[0]), ["create"]);
});

test("copyBranch and deleteBranch treat a drawing string with leading whitespace as excluded", async () => {
  const tree = B("s", "root", [B("d", " {{[[excalidraw]]}}"), B("k", "keep")]);
  const s = setup({ blocks: { t: { ":block/open": true } }, trees: { s: tree } });
  const copied = await s.w.copyBranch("r", "s", "t");
  assert.equal(copied.ok, true);
  assert.equal(copied.skipped, 1);
  assert.ok(!s.writes.some(([, a]) => a.block?.string?.includes("excalidraw")));
  const del = await s.w.deleteBranch("r", "s");
  assert.equal(del.reason, "excluded");
});

test("a rejected queued op does not stall the next one", async () => {
  const s = setup({ blocks: { p: { ":block/open": true } } });
  let first = true;
  const orig = s.api.data.block.create;
  s.api.data.block.create = async (a) => { if (first) { first = false; throw new Error("boom"); } return orig(a); };
  await assert.rejects(s.w.createChild("r", "p", { uid: "a" }), /boom/);
  await s.w.createChild("r", "p", { uid: "b" });
  assert.equal(s.writes.length, 1);
});

test("watchTree uses the recursive pattern on the root uid and unwatches with the same pattern", () => {
  const s = setup();
  const off = s.w.watchTree("R", () => {});
  assert.ok(s.watches[0].p.includes("{:block/children ...}"));
  assert.equal(s.watches[0].i, '[:block/uid "R"]');
  off();
  assert.equal(s.watches.length, 0);
});

test("onIdle runs now when idle and once after the queue drains when busy", async () => {
  const s = setup({ blocks: { p: { ":block/open": true } } });
  let ran = 0;
  s.w.onIdle("r", () => { ran += 1; });
  assert.equal(ran, 1);
  const job = s.w.createChild("r", "p", { uid: "a" });
  assert.equal(s.w.isBusy("r"), true);
  s.w.onIdle("r", () => { ran += 1; });
  assert.equal(ran, 1);
  await job;
  assert.equal(ran, 2);
});
