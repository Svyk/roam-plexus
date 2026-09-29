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
  assert.deepEqual(classifyAddedNode(btn), { regionButtons: [], editors: [] });
  assert.deepEqual(classifyAddedNode({ nodeType: 3 }), { regionButtons: [], editors: [] });
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
