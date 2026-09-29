import test from "node:test";
import assert from "node:assert/strict";
import { subscribeViewport, insertElements, readClipboardText } from "../src/host/native.js";
import { createRoamHost } from "../src/host/roam.js";

function emitter() {
  const e = { subs: new Set(), on(cb) { e.subs.add(cb); return () => e.subs.delete(cb); } };
  return e;
}

test("subscribeViewport forwards both emitters and unsubscribes once", () => {
  const app = { onScrollChangeEmitter: emitter(), onChangeEmitter: emitter() };
  const seen = [];
  const off = subscribeViewport(app, (...a) => seen.push(a));
  app.onScrollChangeEmitter.subs.forEach((cb) => cb(1, 2, { value: 3 }));
  app.onChangeEmitter.subs.forEach((cb) => cb());
  assert.equal(seen.length, 2);
  off(); off();
  assert.equal(app.onScrollChangeEmitter.subs.size, 0);
  assert.equal(app.onChangeEmitter.subs.size, 0);
});

test("subscribeViewport is a safe no-op without emitters", () => {
  const off = subscribeViewport({}, () => {});
  assert.equal(typeof off, "function");
  off();
  assert.equal(typeof subscribeViewport(null, () => {}), "function");
});

test("insertElements appends, selects non-bound elements, captures immediately", () => {
  const calls = [];
  const app = { getSceneElementsIncludingDeleted: () => [{ id: "old" }], updateScene: (u) => calls.push(u) };
  assert.equal(insertElements(app, [{ id: "r" }, { id: "t", containerId: "r" }], { select: true }), true);
  assert.equal(calls[0].captureUpdate, "IMMEDIATELY");
  assert.deepEqual(calls[0].elements.map((e) => e.id), ["old", "r", "t"]);
  assert.deepEqual(calls[0].appState.selectedElementIds, { r: true });
  insertElements(app, [{ id: "x" }], { select: false });
  assert.equal(calls[1].appState, undefined);
  assert.equal(insertElements(app, []), false);
});

test("readClipboardText returns text, null, or rejects on denial", async () => {
  assert.equal(await readClipboardText({ clipboard: { readText: async () => "((abc123456))" } }), "((abc123456))");
  await assert.rejects(readClipboardText({ clipboard: { readText: async () => { throw new Error("denied"); } } }), /denied/);
  assert.equal(await readClipboardText({ clipboard: null }), null);
});

const kid = (s, o, children) => ({ ":block/string": s, ":block/order": o, ...(children ? { ":block/children": children } : {}) });

function embedApi(raw) {
  const api = { graph: { name: "g" }, pulls: [], watches: [], removed: [], data: {
    pull(pattern, ident) { api.pulls.push(ident); return raw(ident); },
    addPullWatch: (p, id, cb) => api.watches.push([p, id, cb]),
    removePullWatch: (p, id, cb) => api.removed.push([p, id, cb]),
  } };
  return api;
}

test("pullEmbedContent block: depth 2, sorted, capped at 30", () => {
  const many = Array.from({ length: 40 }, (_, i) => kid(`c${i}`, i));
  const api = embedApi(() => ({ ":block/uid": "blk000001", ":block/string": "root", ":block/page": { ":node/title": "Host Page" }, ":block/children": [kid("b", 2), kid("a", 1, [kid("a1", 0, [kid("deep", 0)])]), ...many.slice(3)] }));
  const host = createRoamHost({ api });
  const r = host.pullEmbedContent("((blk000001))");
  assert.deepEqual(api.pulls[0], [":block/uid", "blk000001"]);
  assert.equal(r.kind, "block");
  assert.equal(r.string, "root");
  assert.equal(r.title, "");
  assert.equal(r.pageTitle, "Host Page");
  assert.equal(r.children[0].string, "a");
  assert.equal(r.children[0].children[0].string, "a1");
  assert.deepEqual(r.children[0].children[0].children, []);
  const count = (l) => l.reduce((n, c) => n + 1 + count(c.children), 0);
  assert.equal(count(r.children), 30);
});

test("pullEmbedContent page: title and first level only; bare uid; bad ref", () => {
  const api = embedApi((id) => (id[0] === ":node/title" ? { ":block/uid": "pg0000001", ":node/title": "My Page", ":block/children": [kid("x", 0, [kid("y", 0)])] } : null));
  const host = createRoamHost({ api });
  const r = host.pullEmbedContent("[[My Page]]");
  assert.deepEqual(api.pulls[0], [":node/title", "My Page"]);
  assert.equal(r.kind, "page");
  assert.equal(r.title, "My Page");
  assert.deepEqual(r.children, [{ string: "x", children: [] }]);
  assert.equal(host.pullEmbedContent("abcdefghi"), null);
  assert.deepEqual(api.pulls[1], [":block/uid", "abcdefghi"]);
  assert.equal(host.pullEmbedContent("nonsense"), null);
});

test("watchEmbed disposer removes exactly the watch it added, once", () => {
  const api = embedApi(() => null);
  const host = createRoamHost({ api });
  const fired = [];
  const a = host.watchEmbed("blk000001", (b, c) => fired.push(c));
  const b = host.watchEmbed("blk000002", () => {});
  assert.equal(api.watches.length, 2);
  api.watches[0][2](null, "after");
  assert.deepEqual(fired, ["after"]);
  a(); a();
  assert.equal(api.removed.length, 1);
  assert.deepEqual(api.removed[0], api.watches[0]);
  b();
  assert.deepEqual(api.removed[1], api.watches[1]);
});
