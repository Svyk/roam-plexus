import test from "node:test";
import assert from "node:assert/strict";
import { createRoamHost } from "../src/host/roam.js";
import { fnv1a } from "../src/model/hash.js";

const immediate = async (name, fn) => ({ acquired: true, fallback: false, value: await fn() });

// nodes: uid -> { string, order, parent (uid or page title marker), title }
function fixture({ nodes = {}, pages = {}, util = {}, failCreate = null } = {}) {
  const created = [];
  const deleted = [];
  const pageCreates = [];
  let n = 0;
  const api = {
    graph: { name: "g" },
    util: { generateUID: () => `gen00000${++n}`, ...util },
    data: {
      pull: (pattern, ident) => {
        const [kind, key] = ident;
        if (kind === ":node/title") {
          const uid = pages[key];
          return uid ? { ":block/uid": uid, ":node/title": key } : null;
        }
        const page = Object.entries(pages).find(([, uid]) => uid === key);
        if (page) {
          const kids = Object.entries(nodes).filter(([, v]) => v.parent === key).map(([uid, v]) => ({ ":block/uid": uid, ":block/string": v.string, ":block/order": v.order }));
          return { ":block/uid": key, ":node/title": page[0], ":block/children": kids };
        }
        const node = nodes[key];
        if (!node) return null;
        const parentPage = Object.entries(pages).find(([, uid]) => uid === node.parent);
        const parent = parentPage
          ? { ":block/uid": node.parent, ":node/title": parentPage[0] }
          : { ":block/uid": node.parent, ":block/string": nodes[node.parent]?.string ?? "" };
        const kids = Object.entries(nodes).filter(([, v]) => v.parent === key).map(([uid, v]) => ({ ":block/uid": uid, ":block/string": v.string, ":block/order": v.order }));
        return {
          ":block/uid": key,
          ":block/string": node.string,
          ":block/order": node.order,
          ":block/_children": [parent],
          ":block/page": { ":block/uid": node.page, ":node/title": Object.keys(pages).find((t) => pages[t] === node.page) },
          ":block/children": kids,
        };
      },
      page: { create: async ({ page }) => { pageCreates.push(page); pages[page.title] = page.uid; } },
      block: {
        create: async ({ location, block }) => {
          if (failCreate && failCreate(block)) throw new Error("boom");
          created.push([location, block]);
          nodes[block.uid] = { string: block.string, order: 0, parent: location["parent-uid"], page: "pg0000001" };
        },
        delete: async ({ block }) => { deleted.push(block.uid); },
      },
    },
  };
  const host = createRoamHost({ api, withLockFn: immediate });
  return { host, api, created, deleted, pageCreates, nodes, pages };
}

test("ensurePage gives a daily-note title the daily uid and other titles a generated uid", async () => {
  const f = fixture({ util: { pageTitleToDate: (t) => (t === "September 29th, 2026" ? new Date(2026, 8, 29) : null), dateToPageUid: () => "09-29-2026" } });
  assert.equal(await f.host.ensurePage("September 29th, 2026"), "09-29-2026");
  assert.equal(await f.host.ensurePage("Drawings/x"), "gen000001");
  assert.deepEqual(f.pageCreates.map((p) => p.uid), ["09-29-2026", "gen000001"]);
  assert.equal(await f.host.ensurePage("September 29th, 2026"), "09-29-2026");
  assert.equal(f.pageCreates.length, 2);
});

test("ensurePage survives a throwing pageTitleToDate and a create race", async () => {
  const f = fixture({ util: { pageTitleToDate: () => { throw new Error("x"); } } });
  assert.equal(await f.host.ensurePage("Plain"), "gen000001");
  const g = fixture();
  g.api.data.page.create = async ({ page }) => { g.pages[page.title] = "other0001"; throw new Error("exists"); };
  assert.equal(await g.host.ensurePage("Race"), "other0001");
});

test("createDrawing takes an order option, default last", async () => {
  const f = fixture();
  await f.host.createDrawing({ parentUid: "par000001", order: 0 });
  await f.host.createDrawing({ parentUid: "par000001" });
  assert.deepEqual(f.created.map((c) => c[0]), [{ "parent-uid": "par000001", order: 0 }, { "parent-uid": "par000001", order: "last" }]);
});

test("blockInfo reads the parent, page and order; pages and missing blocks give null", () => {
  const f = fixture({
    pages: { "September 29th, 2026": "09-29-2026" },
    nodes: { top000001: { string: "top", order: 2, parent: "09-29-2026", page: "09-29-2026" }, kid000001: { string: "kid", order: 0, parent: "top000001", page: "09-29-2026" } },
  });
  assert.deepEqual(f.host.blockInfo("top000001"), { uid: "top000001", string: "top", order: 2, parentUid: "09-29-2026", parentString: "", parentIsPage: true, pageUid: "09-29-2026", pageTitle: "September 29th, 2026" });
  const kid = f.host.blockInfo("kid000001");
  assert.equal(kid.parentUid, "top000001");
  assert.equal(kid.parentString, "top");
  assert.equal(kid.parentIsPage, false);
  assert.equal(f.host.blockInfo("09-29-2026"), null);
  assert.equal(f.host.blockInfo("missing001"), null);
});

test("topAncestor walks to the top-level block of a daily page", () => {
  const f = fixture({
    pages: { P: "page00001" },
    nodes: {
      a00000001: { string: "a", order: 3, parent: "page00001", page: "page00001" },
      b00000001: { string: "b", order: 0, parent: "a00000001", page: "page00001" },
      c00000001: { string: "c", order: 1, parent: "b00000001", page: "page00001" },
    },
  });
  assert.deepEqual(f.host.topAncestor("c00000001"), { uid: "a00000001", order: 3, pageUid: "page00001" });
  assert.equal(f.host.topAncestor("nope00001"), null);
});

test("blockPaths returns ancestors and orders from the page down, skipping missing blocks and pages", () => {
  const f = fixture({
    pages: { P: "page00001" },
    nodes: {
      a00000001: { string: "a", order: 3, parent: "page00001", page: "page00001" },
      b00000001: { string: "b", order: 1, parent: "a00000001", page: "page00001" },
    },
  });
  const paths = f.host.blockPaths(["b00000001", "a00000001", "gone00001", "page00001"]);
  assert.deepEqual([...paths.keys()], ["b00000001", "a00000001"]);
  assert.deepEqual(paths.get("b00000001"), { ancestors: ["a00000001"], orders: [3, 1] });
  assert.deepEqual(paths.get("a00000001"), { ancestors: [], orders: [3] });
});

test("firstDrawingChild returns the first drawing-macro child by order", () => {
  const f = fixture({
    pages: { P: "page00001" },
    nodes: {
      s00000001: { string: "Schedule {{[[excalidraw]]}}", order: 0, parent: "page00001" },
      d00000002: { string: "{{[[excalidraw]]}}", order: 5, parent: "page00001" },
      d00000001: { string: "{{excalidraw}} x", order: 2, parent: "page00001" },
    },
  });
  assert.equal(f.host.firstDrawingChild("page00001"), "d00000001");
  assert.equal(fixture({ pages: { P: "page00001" } }).host.firstDrawingChild("page00001"), null);
  assert.equal(f.host.firstDrawingChild(null), null);
});

test("ensureCardsContainer uses the deterministic c-uid, collapsed, and recovers a create race", async () => {
  const f = fixture({ nodes: { drw000001: { string: "{{[[excalidraw]]}}", order: 0, parent: "x", page: "x" } } });
  const uid = await f.host.ensureCardsContainer("drw000001");
  assert.equal(uid, `c${fnv1a("drw000001")}`);
  assert.equal(uid.length, 9);
  assert.deepEqual(f.created[0], [{ "parent-uid": "drw000001", order: "last" }, { uid, string: "{{[[plexus-cards]]}}", open: false }]);
  // Found on the second call without another create.
  assert.equal(await f.host.ensureCardsContainer("drw000001"), uid);
  assert.equal(f.created.length, 1);
});

test("createCard makes an empty last child of the cards container under the drawing lock", async () => {
  const f = fixture({ nodes: { drw000001: { string: "{{[[excalidraw]]}}", order: 0, parent: "x", page: "x" } } });
  const locks = [];
  const host = createRoamHost({ api: f.api, withLockFn: async (name, fn) => { locks.push(name); return immediate(name, fn); } });
  const uid = await host.createCard("drw000001");
  assert.deepEqual(locks, ["plexus:g:drw000001"]);
  const container = `c${fnv1a("drw000001")}`;
  assert.deepEqual(f.created.at(-1), [{ "parent-uid": container, order: "last" }, { uid, string: "" }]);
  const denied = createRoamHost({ api: f.api, withLockFn: async () => ({ acquired: false }) });
  await assert.rejects(denied.createCard("drw000001"));
});

test("createBlock and deleteBlock call the block API", async () => {
  const f = fixture();
  const uid = await f.host.createBlock({ parentUid: "par000001", string: "hi" });
  assert.deepEqual(f.created[0], [{ "parent-uid": "par000001", order: "last" }, { uid, string: "hi" }]);
  await assert.rejects(f.host.createBlock({}));
  assert.equal(await f.host.deleteBlock("del000001"), true);
  assert.deepEqual(f.deleted, ["del000001"]);
});
