import assert from "node:assert/strict";
import test from "node:test";

import { classifyAddedNode, createDiscovery } from "../src/view/discover.js";
import { REGION_BUTTON_CLASS } from "../src/model/region.js";

function fakeNode({ classes = [], children = [], closest = {} } = {}) {
  const node = {
    nodeType: 1,
    isConnected: true,
    classList: { contains: (c) => classes.includes(c) },
    getElementsByClassName: (c) => children.filter((ch) => ch.classes?.includes(c)).map((ch) => ch.node),
    closest: (sel) => (Object.keys(closest).some((k) => sel.includes(k)) ? {} : null),
  };
  return node;
}

test("classifies region buttons on the node and its descendants", () => {
  const inner = fakeNode({ classes: [REGION_BUTTON_CLASS] });
  const self = fakeNode({ classes: [REGION_BUTTON_CLASS], children: [{ classes: [REGION_BUTTON_CLASS], node: inner }] });
  const out = classifyAddedNode(self);
  assert.deepEqual(out.regionButtons, [self, inner]);
  assert.deepEqual(out.editors, []);
  assert.deepEqual(out.aliases, []);
});

test("classifies block aliases on the node and its descendants, skipping plexus output", () => {
  const inner = fakeNode({ classes: ["rm-alias--block"] });
  const self = fakeNode({ classes: ["rm-alias--block"], children: [{ classes: ["rm-alias--block"], node: inner }] });
  assert.deepEqual(classifyAddedNode(self).aliases, [self, inner]);
  const own = fakeNode({ classes: ["rm-alias--block"], closest: { "plexus-root": 1 } });
  assert.deepEqual(classifyAddedNode(own).aliases, []);
});

test("observer and scanExisting dispatch aliases to onAlias", () => {
  let callback;
  class FakeMO {
    constructor(cb) { callback = cb; }
    observe() {}
    disconnect() {}
  }
  const seen = [];
  const alias = fakeNode({ classes: ["rm-alias--block"] });
  const queries = [];
  const root = { querySelectorAll: (sel) => { queries.push(sel); return sel.startsWith("a.") ? [alias] : []; } };
  const discovery = createDiscovery({ root, onAlias: (a) => seen.push(a), MutationObserverImpl: FakeMO });
  callback([{ addedNodes: [alias], removedNodes: [] }]);
  discovery.scanExisting();
  assert.deepEqual(seen, [alias, alias]);
  assert.ok(queries.includes("a.rm-alias--block"));
  const throwing = createDiscovery({ root, onAlias: () => { throw new Error("x"); }, MutationObserverImpl: FakeMO });
  assert.doesNotThrow(() => throwing.scanExisting());
});

test("editors count only under a full-screen outer container", () => {
  const full = fakeNode({ classes: ["excalidraw"], closest: { "full-screen": 1 } });
  const inline = fakeNode({ classes: ["excalidraw"] });
  const wrapper = fakeNode({ children: [{ classes: ["excalidraw"], node: full }, { classes: ["excalidraw"], node: inline }] });
  assert.deepEqual(classifyAddedNode(wrapper).editors, [full]);
  assert.deepEqual(classifyAddedNode(full).editors, [full]);
  assert.deepEqual(classifyAddedNode(inline).editors, []);
});

test("skips nodes inside plexus-offscreen and ignores non-elements", () => {
  const btn = fakeNode({ classes: [REGION_BUTTON_CLASS], closest: { "plexus-offscreen": 1 } });
  assert.deepEqual(classifyAddedNode(btn), { regionButtons: [], editors: [], aliases: [] });
  assert.deepEqual(classifyAddedNode({ nodeType: 3 }), { regionButtons: [], editors: [], aliases: [] });
});

test("observer dispatches added buttons and editor unmount, and disconnects on dispose", () => {
  let callback;
  let disconnected = false;
  class FakeMO {
    constructor(cb) { callback = cb; }
    observe() {}
    disconnect() { disconnected = true; }
  }
  const buttons = [];
  const mounts = [];
  const unmounts = [];
  const discovery = createDiscovery({
    root: {},
    onRegionButton: (b) => buttons.push(b),
    onEditorMount: (e) => mounts.push(e),
    onEditorUnmount: (e) => unmounts.push(e),
    MutationObserverImpl: FakeMO,
  });
  const btn = fakeNode({ classes: [REGION_BUTTON_CLASS] });
  const editor = fakeNode({ classes: ["excalidraw"], closest: { "full-screen": 1 } });
  callback([{ addedNodes: [btn, editor], removedNodes: [] }]);
  assert.deepEqual(buttons, [btn]);
  assert.deepEqual(mounts, [editor]);
  editor.isConnected = false;
  callback([{ addedNodes: [], removedNodes: [{}] }]);
  assert.deepEqual(unmounts, [editor]);
  discovery.dispose();
  assert.equal(disconnected, true);
});

test("scanExisting claims buttons and editors already on the page and skips plexus output", () => {
  const queries = [];
  const btn = fakeNode({ classes: [REGION_BUTTON_CLASS] });
  const own = fakeNode({ classes: [REGION_BUTTON_CLASS], closest: { "plexus-root": 1 } });
  const editor = fakeNode({ classes: ["excalidraw"] });
  const root = {
    querySelectorAll: (sel) => {
      queries.push(sel);
      return sel.includes("excalidraw-outer-container.full-screen") ? [editor] : [btn, own];
    },
  };
  class FakeMO { observe() {} disconnect() {} }
  const buttons = [];
  const mounts = [];
  const discovery = createDiscovery({ root, onRegionButton: (b) => buttons.push(b), onEditorMount: (e) => mounts.push(e), MutationObserverImpl: FakeMO });
  discovery.scanExisting();
  assert.deepEqual(buttons, [btn]);
  assert.deepEqual(mounts, [editor]);
  assert.ok(queries.includes(`.${REGION_BUTTON_CLASS}`));
  assert.ok(queries.includes(".excalidraw-outer-container.full-screen .excalidraw"));
});

test("classifyAddedNode skips output inside .plexus-root", () => {
  const own = fakeNode({ classes: [REGION_BUTTON_CLASS], closest: { "plexus-root": 1 } });
  assert.deepEqual(classifyAddedNode(own), { regionButtons: [], editors: [], aliases: [] });
});

test("an editor rendered inside the outline dock is not an editor mount", () => {
  const inDock = fakeNode({ classes: ["excalidraw"], closest: { "full-screen": 1, "plexus-dock": 1 } });
  const wrapper = fakeNode({ children: [{ classes: ["excalidraw"], node: inDock }] });
  assert.deepEqual(classifyAddedNode(inDock).editors, []);
  assert.deepEqual(classifyAddedNode(wrapper).editors, []);
  const alias = fakeNode({ classes: ["rm-alias--block"], closest: { "plexus-dock": 1 } });
  assert.deepEqual(classifyAddedNode(alias).aliases, [alias]);
  const button = fakeNode({ classes: [REGION_BUTTON_CLASS], closest: { "plexus-dock": 1 } });
  assert.deepEqual(classifyAddedNode(button).regionButtons, [button]);
});

test("onScan runs from scanExisting and once per mutation batch", () => {
  let callback;
  class FakeMO {
    constructor(cb) { callback = cb; }
    observe() {}
    disconnect() {}
  }
  let n = 0;
  const root = { querySelectorAll: () => [] };
  const discovery = createDiscovery({ root, onScan: () => { n += 1; }, MutationObserverImpl: FakeMO });
  discovery.scanExisting();
  callback([{ addedNodes: [], removedNodes: [] }, { addedNodes: [], removedNodes: [] }]);
  assert.equal(n, 2);
});

test("scanExisting skips an editor rendered inside the outline dock", () => {
  const inDock = fakeNode({ classes: ["excalidraw"], closest: { "full-screen": 1, "plexus-dock": 1 } });
  const root = { querySelectorAll: (sel) => (sel.includes("excalidraw-outer-container.full-screen") ? [inDock] : []) };
  class FakeMO { observe() {} disconnect() {} }
  const mounts = [];
  createDiscovery({ root, onEditorMount: (e) => mounts.push(e), MutationObserverImpl: FakeMO }).scanExisting();
  assert.deepEqual(mounts, []);
});
