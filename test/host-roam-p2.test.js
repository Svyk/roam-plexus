import test from "node:test";
import assert from "node:assert/strict";
import { createRoamHost } from "../src/host/roam.js";

function makeApi({ pages = {}, nodes = {}, rows = [] } = {}) {
  let n = 0;
  const api = {
    graph: { name: "g" },
    util: { generateUID: () => `gen${String(++n).padStart(6, "0")}` },
    creates: [],
    pageCreates: [],
    queries: [],
    data: {
      pull(pattern, ident) {
        if (ident[0] === ":node/title") return pages[ident[1]] ? { ":block/uid": pages[ident[1]] } : null;
        return nodes[ident[1]] ?? null;
      },
      q(query, ...args) { api.queries.push([query, args]); return rows; },
      page: { create: async ({ page }) => { api.pageCreates.push(page); pages[page.title] = page.uid; } },
      block: { create: async (a) => { api.creates.push(a); } },
    },
  };
  return api;
}

test("createDrawing with title creates Drawings/<title> page then a last child", async () => {
  const api = makeApi();
  const host = createRoamHost({ api });
  const r = await host.createDrawing({ title: "Map" });
  assert.equal(api.pageCreates[0].title, "Drawings/Map");
  assert.equal(r.pageUid, api.pageCreates[0].uid);
  assert.deepEqual(api.creates[0].location, { "parent-uid": r.pageUid, order: "last" });
  assert.equal(api.creates[0].block.string, "{{[[excalidraw]]}}");
  assert.equal(api.creates[0].block.uid, r.uid);
});

test("createDrawing reuses an existing Drawings/<title> page", async () => {
  const api = makeApi({ pages: { "Drawings/Map": "existpage" } });
  const host = createRoamHost({ api });
  const r = await host.createDrawing({ title: "Map" });
  assert.equal(api.pageCreates.length, 0);
  assert.equal(r.pageUid, "existpage");
  assert.equal(api.creates[0].location["parent-uid"], "existpage");
});

test("createDrawing without title uses parentUid, then pageUid, else throws", async () => {
  const api = makeApi();
  const host = createRoamHost({ api });
  assert.equal((await host.createDrawing({ pageUid: "P", parentUid: "B" })).pageUid, "P");
  assert.equal(api.creates[0].location["parent-uid"], "B");
  await host.createDrawing({ pageUid: "P" });
  assert.equal(api.creates[1].location["parent-uid"], "P");
  await assert.rejects(host.createDrawing({}));
});

test("drawingsOn is one data.q, filtered, ordered, capped at 50", () => {
  const rows = [];
  for (let i = 0; i < 60; i++) rows.push([`u${i}`, "{{[[excalidraw]]}}", 60 - i]);
  rows.push(["x", "plain text", 0]);
  rows.push(["y", "{{excalidraw}} tail", 100]);
  const api = makeApi({ rows });
  const host = createRoamHost({ api });
  const out = host.drawingsOn("page");
  assert.equal(api.queries.length, 1);
  assert.deepEqual(api.queries[0][1], ["page"]);
  assert.equal(out.length, 50);
  assert.equal(out[0], "u59");
  assert.ok(!out.includes("x"));
  assert.deepEqual(host.drawingsOn(""), []);
});

test("resolveUidKind distinguishes page, block, and unknown", () => {
  const api = makeApi({ nodes: { pg: { ":node/title": "T" }, bl: { ":block/string": "s" }, empty: { ":block/string": "" } } });
  const host = createRoamHost({ api });
  assert.equal(host.resolveUidKind("pg"), "page");
  assert.equal(host.resolveUidKind("bl"), "block");
  assert.equal(host.resolveUidKind("empty"), "block");
  assert.equal(host.resolveUidKind("nope"), null);
});

test("drawingsOn queries both macro forms and keeps the {{excalidraw}} variant", () => {
  const rows = [["a", "{{[[excalidraw]]}}", 1], ["y", "{{excalidraw}} tail", 2], ["x", "plain text", 3]];
  const api = makeApi({ rows });
  const out = createRoamHost({ api }).drawingsOn("page");
  assert.deepEqual(out, ["a", "y"]);
  assert.match(api.queries[0][0], /\{\{\[\[excalidraw\]\]\}\}/);
  assert.match(api.queries[0][0], /\{\{excalidraw\}\}/);
});
