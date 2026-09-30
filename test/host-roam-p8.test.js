import test from "node:test";
import assert from "node:assert/strict";
import { createRoamHost } from "../src/host/roam.js";

const immediate = async (name, fn) => ({ acquired: true, fallback: false, value: await fn() });

function fixture({ blocks = {}, fail = null } = {}) {
  const created = [];
  const updated = [];
  const locks = [];
  let n = 0;
  const api = {
    graph: { name: "g" },
    util: { generateUID: () => `gen00000${++n}` },
    data: {
      pull: (pattern, ident) => {
        const b = blocks[ident[1]];
        return b ? { ":block/uid": ident[1], ":block/string": b.string, ":block/children": (b.children || []).map((c, i) => ({ ":block/uid": c.uid, ":block/string": c.string, ":block/order": i })) } : null;
      },
      block: {
        create: async ({ location, block }) => {
          if (fail && created.length >= fail) throw new Error("boom");
          created.push([location, block]);
        },
        update: async ({ block }) => { updated.push(block); },
      },
    },
  };
  const host = createRoamHost({ api, withLockFn: async (name, fn, o) => { locks.push(name); return immediate(name, fn); } });
  return { host, api, created, updated, locks };
}

test("createRegions holds one lock, ensures the container once, and creates in order", async () => {
  const w = fixture({ blocks: { drw000001: { string: "{{[[excalidraw]]}}", children: [] } } });
  const uids = await w.host.createRegions("drw000001", ["s1", "s2", "s3"]);
  assert.deepEqual(uids, ["gen000001", "gen000002", "gen000003"]);
  assert.equal(w.locks.length, 1);
  const containers = w.created.filter(([, b]) => b.string === "{{[[plexus-regions]]}}");
  assert.equal(containers.length, 1);
  const regions = w.created.filter(([, b]) => /^s\d$/.test(b.string));
  assert.deepEqual(regions.map(([loc]) => loc.order), ["last", "last", "last"]);
  assert.ok(regions.every(([loc]) => loc["parent-uid"] === containers[0][1].uid));
});

test("createRegions stops at the first failure and returns what it made; a lock miss throws", async () => {
  const container = { uid: "cont00001", string: "{{[[plexus-regions]]}}" };
  const w = fixture({ blocks: { drw000001: { string: "{{[[excalidraw]]}}", children: [container] } }, fail: 2 });
  const warn = console.warn;
  console.warn = () => {};
  const uids = await w.host.createRegions("drw000001", ["s1", "s2", "s3"]);
  console.warn = warn;
  assert.deepEqual(uids, ["gen000001", "gen000002"]);
  const host = createRoamHost({ api: { graph: { name: "g" }, data: { pull: () => null } }, withLockFn: async () => ({ acquired: false }) });
  await assert.rejects(host.createRegions("drw000001", ["x"]), /could not acquire/);
});

test("updateRegionString with expect re-pulls inside the lock and refuses a changed block", async () => {
  const w = fixture({ blocks: { reg000001: { string: "now" } } });
  await w.host.updateRegionString("drw000001", "reg000001", "next", { expect: "now" });
  assert.deepEqual(w.updated, [{ uid: "reg000001", string: "next" }]);
  await assert.rejects(w.host.updateRegionString("drw000001", "reg000001", "next", { expect: "before" }), (e) => e.code === "changed" && /changed elsewhere/.test(e.message));
  assert.equal(w.updated.length, 1);
  await w.host.updateRegionString("drw000001", "reg000001", "plain");
  assert.equal(w.updated.length, 2);
});

test("openPageUid resolves a page directly and a block to its page", async () => {
  const pulls = {
    pageuid001: { ":node/title": "P" },
    blockuid01: { ":block/page": { ":block/uid": "pageuid002" } },
  };
  let open = "pageuid001";
  const host = createRoamHost({ api: { ui: { mainWindow: { getOpenPageOrBlockUid: async () => open } }, data: { pull: (p, ident) => pulls[ident[1]] ?? null } } });
  assert.equal(await host.openPageUid(), "pageuid001");
  open = "blockuid01";
  assert.equal(await host.openPageUid(), "pageuid002");
  open = null;
  assert.equal(await host.openPageUid(), null);
  open = "missing001";
  assert.equal(await host.openPageUid(), null);
});

test("audit queries map rows, sort by uid, and scope by page", () => {
  const queries = [];
  const host = createRoamHost({
    api: {
      data: {
        q: (query, ...args) => {
          queries.push([query, args]);
          if (/plexus-regions/.test(query)) return [["cont00002", "own000002", "{{[[excalidraw]]}}", "P"], ["cont00001", "own000001", null, "Q"]];
          return [["reg000002", "b", "cont00001", "{{[[plexus-regions]]}}", "P"], ["reg000001", "a", "pageuid01", null, "P"]];
        },
      },
    },
  });
  assert.deepEqual(host.regionBlocksForAudit({ pageUid: "pageuid01" }).map((r) => [r.uid, r.parentString, r.pageTitle]), [
    ["reg000001", "", "P"],
    ["reg000002", "{{[[plexus-regions]]}}", "P"],
  ]);
  assert.deepEqual(host.containersForAudit({}).map((c) => [c.uid, c.ownerUid, c.ownerString]), [
    ["cont00001", "own000001", ""],
    ["cont00002", "own000002", "{{[[excalidraw]]}}"],
  ]);
  assert.match(queries[0][0], /:in \$ \?pg/);
  assert.match(queries[0][0], /"plexus-region"/);
  assert.deepEqual(queries[0][1], ["pageuid01"]);
  assert.doesNotMatch(queries[1][0], /:in \$/);
});
