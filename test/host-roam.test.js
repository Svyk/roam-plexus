import test from "node:test";
import assert from "node:assert/strict";
import { createRoamHost } from "../src/host/roam.js";

function makeApi(blocks) {
  const creates = [];
  let n = 0;
  const api = {
    graph: { name: "g", isEncrypted: false },
    util: { generateUID: () => `gen${String(++n).padStart(6, "0")}` },
    data: {
      pull(pattern, ident) {
        const b = blocks[ident[1]];
        if (!b) return null;
        return {
          ":block/uid": ident[1],
          ":block/string": b.string,
          ":edit/time": b.editTime ?? 1,
          ":block/open": b.open,
          ":block/props": b.props,
          ":block/children": (b.children || []).map((u) => ({ ":block/uid": u, ":block/string": blocks[u].string, ":block/order": blocks[u].order })),
        };
      },
      block: {
        create: async (args) => {
          creates.push(args);
          const parent = blocks[args.location["parent-uid"]];
          const uid = args.block.uid;
          blocks[uid] = { string: args.block.string, order: parent.children.length, open: args.block.open, children: [] };
          parent.children.push(uid);
        },
        update: () => { throw new Error("update must never be called"); },
      },
    },
    ui: {
      mainWindow: { openBlock: (a) => { api.opened = a; } },
      rightSidebar: { addWindow: (a) => { api.sidebar = a; } },
    },
  };
  api.creates = creates;
  return api;
}

const passLock = async (name, fn) => ({ acquired: true, fallback: false, value: await fn() });

test("ensureRegionContainer is idempotent and creates last child closed", async () => {
  const blocks = { drawing1: { string: "{{[[excalidraw]]}}", children: ["c1"] }, c1: { string: "child", order: 0, children: [] } };
  const api = makeApi(blocks);
  const host = createRoamHost({ api, withLockFn: passLock });
  const u1 = await host.ensureRegionContainer("drawing1");
  const u2 = await host.ensureRegionContainer("drawing1");
  assert.equal(u1, u2);
  assert.equal(api.creates.length, 1);
  assert.equal(api.creates[0].location.order, "last");
  assert.equal(api.creates[0].location["parent-uid"], "drawing1");
  assert.equal(api.creates[0].block.open, false);
  assert.equal(api.creates[0].block.string, "{{[[plexus-regions]]}}");
  assert.equal("props" in api.creates[0].block, false);
});

test("createRegion runs under lock and appends to container", async () => {
  const blocks = { drawing1: { string: "x", children: [] } };
  const api = makeApi(blocks);
  const names = [];
  const host = createRoamHost({ api, withLockFn: async (name, fn) => { names.push(name); return passLock(name, fn); } });
  const s = "{{[[plexus-region]]: k=area d=drawing1 ids=a pad=10}} cap";
  const uid = await host.createRegion("drawing1", s);
  assert.deepEqual(names, ["plexus:g:drawing1"]);
  assert.equal(blocks[uid].string, s);
  const container = blocks.drawing1.children[0];
  assert.equal(blocks[container].string, "{{[[plexus-regions]]}}");
  assert.deepEqual(blocks[container].children, [uid]);
  assert.equal(api.creates.at(-1).location.order, "last");
  const regions = host.regionsOf("drawing1");
  assert.equal(regions.length, 1);
  assert.equal(regions[0].uid, uid);
  assert.equal(regions[0].region.kind, "area");
});

test("createRegion throws when lock not acquired", async () => {
  const api = makeApi({ d: { string: "x", children: [] } });
  const host = createRoamHost({ api, withLockFn: async () => ({ acquired: false, fallback: false }) });
  await assert.rejects(host.createRegion("d", "s"), /lock/);
});

test("regionsOf empty without container; pullBlock null for missing", () => {
  const api = makeApi({ d: { string: "x", children: [] } });
  const host = createRoamHost({ api, withLockFn: passLock });
  assert.deepEqual(host.regionsOf("d"), []);
  assert.equal(host.pullBlock("nope"), null);
  assert.equal(host.graphName(), "g");
  assert.equal(host.isEncrypted(), false);
});

test("pullBlock sorts children by order", () => {
  const api = makeApi({
    p: { string: "p", children: ["b", "a"] },
    a: { string: "a", order: 0, children: [] },
    b: { string: "b", order: 1, children: [] },
  });
  const host = createRoamHost({ api });
  assert.deepEqual(host.pullBlock("p").children.map((c) => c.uid), ["a", "b"]);
});

test("drawing memoized by uid+editTime", () => {
  const blocks = { d: { string: "x", editTime: 5, props: { ":excalidraw/elements-json": "[]" }, children: [] } };
  const api = makeApi(blocks);
  let parses = 0;
  const host = createRoamHost({
    api,
    parseProps: (props) => { parses++; return { elements: [], elementsJson: props[":excalidraw/elements-json"] }; },
    hashFn: (s) => `h${s.length}`,
  });
  const a = host.drawing("d");
  const b = host.drawing("d");
  assert.equal(parses, 1);
  assert.equal(a, b);
  assert.equal(a.hash, "h2");
  assert.equal(a.editTime, 5);
  blocks.d.editTime = 6;
  host.drawing("d");
  assert.equal(parses, 2);
  assert.equal(host.drawing("missing"), null);
});

test("openBlock main and sidebar", async () => {
  const api = makeApi({});
  const host = createRoamHost({ api });
  await host.openBlock("u1");
  assert.deepEqual(api.opened, { block: { uid: "u1" } });
  await host.openBlock("u2", { sidebar: true });
  assert.deepEqual(api.sidebar, { window: { type: "block", "block-uid": "u2" } });
});

test("blockUidFromNode: ref, input, none", () => {
  const host = createRoamHost({ api: makeApi({}) });
  const mk = (map) => ({ closest: (sel) => map[sel] ?? null });
  const ref = mk({ ".rm-block-ref[data-uid]": { dataset: { uid: "refuid123" } }, '[id^="block-input-"]': { id: "block-input-u-body-outline-page00001-blk000001" } });
  assert.equal(host.blockUidFromNode(ref), "refuid123");
  const input = mk({ '[id^="block-input-"]': { id: "block-input-u-body-outline-page00001-blk000001" } });
  assert.equal(host.blockUidFromNode(input), "blk000001");
  assert.equal(host.blockUidFromNode(mk({})), null);
  assert.equal(host.blockUidFromNode(null), null);
});
