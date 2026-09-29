import assert from "node:assert/strict";
import test from "node:test";
import { createActions } from "../src/actions.js";

function setup({ selected = false, info = { string: "Topic", visible: 3, total: 3 }, editor = true } = {}) {
  const toasts = [];
  const started = [];
  const app = {};
  const mindmap = {
    NODE_CAP: 500,
    selectedNode: () => selected,
    startRoot: (a) => { started.push(a); return "root"; },
    outlineInfo: () => info,
    showOutline: async () => true,
  };
  const actions = createActions({
    host: {}, native: { activeEditor: () => (editor ? { app, drawingUid: "drw000001" } : null) }, cache: {}, cold: {},
    toaster: { show: (m) => toasts.push(m) }, spotlight() {}, getSettings: () => ({}), doc: {}, mindmap,
    api: { data: { pull: () => null, block: { create: async () => {} } }, util: { generateUID: () => "newdraw01" } },
  });
  return { actions, toasts, started, app };
}

test("startMindMap with a map node selected only toasts; otherwise starts a root in the drawing", async () => {
  let t = setup({ selected: true });
  await t.actions.startMindMap();
  assert.deepEqual(t.toasts, ["Use Tab / Enter to grow this map"]);
  assert.equal(t.started.length, 0);
  t = setup();
  await t.actions.startMindMap();
  assert.deepEqual(t.started, [{ app: t.app, drawingUid: "drw000001" }]);
  t = setup({ editor: false });
  assert.equal(await t.actions.startMindMap(), null);
});

test("mindMapFromOutline finds the parent through :block/_children (Roam has no :block/parent) and creates the drawing next to the block", async () => {
  const creates = [];
  const app = {};
  const api = {
    data: {
      pull: (pattern) => {
        if (pattern.includes(":block/parent ") || pattern.includes("{:block/parent")) {
          throw new Error("Expected attribute having :db.type/ref, got: :block/parent");
        }
        if (pattern.includes(":block/_children")) return { ":block/order": 3, ":block/_children": [{ ":block/uid": "parent001" }] };
        return null;
      },
      block: { create: async (arg) => { creates.push(arg); } },
    },
    util: { generateUID: () => "newdraw01" },
  };
  const mindmap = { NODE_CAP: 500, selectedNode: () => false, startRoot: () => null, outlineInfo: () => ({ string: "Topic", visible: 3, total: 3 }), showOutline: async () => true };
  const toasts = [];
  const actions = createActions({
    host: { openBlock: async () => {} }, native: { activeEditor: () => ({ app, drawingUid: "newdraw01" }) }, cache: {}, cold: {},
    toaster: { show: (m) => toasts.push(m) }, spotlight() {}, getSettings: () => ({}), doc: { querySelectorAll: () => [] }, mindmap, api,
  });
  assert.equal(await actions.mindMapFromOutline("abcdefghi"), "newdraw01");
  assert.deepEqual(creates, [{ location: { "parent-uid": "parent001", order: 4 }, block: { uid: "newdraw01", string: "{{[[excalidraw]]}}" } }]);
  assert.deepEqual(toasts, []);
});

test("mindMapFromOutline refuses a missing block, an excluded block, and an oversized tree", async () => {
  let t = setup();
  assert.equal(await t.actions.mindMapFromOutline(null), null);
  assert.deepEqual(t.toasts, ["Click into a block first"]);
  t = setup({ info: { string: "{{[[excalidraw]]}}", visible: 1, total: 1 } });
  assert.equal(await t.actions.mindMapFromOutline("abcdefghi"), null);
  assert.match(t.toasts[0], /Drawings cannot/);
  t = setup({ info: { string: "Big", visible: 500, total: 812 } });
  assert.equal(await t.actions.mindMapFromOutline("abcdefghi"), null);
  assert.deepEqual(t.toasts, ["Collapse some branches first (812 blocks)"]);
});
