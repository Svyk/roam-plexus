import assert from "node:assert/strict";
import test from "node:test";

import { createActions } from "../src/actions.js";
import { parseRegion, geometryKey } from "../src/model/region.js";
import { cropKey } from "../src/host/cache.js";

const elements = [
  { id: "rect-a", type: "rectangle", x: 100, y: 100, width: 220, height: 140, angle: 0, isDeleted: false },
  { id: "text-a", type: "text", x: 130, y: 150, width: 160, height: 25, angle: 0, isDeleted: false, text: "Hello" },
];
const svg = '<svg viewBox="0 0 240 160" width="240" height="160"></svg>';

function setup({ editor }) {
  const created = [];
  const puts = [];
  const copied = [];
  const toasts = [];
  const app = { getSceneElements: () => elements };
  const actions = createActions({
    host: {
      createRegion: async (d, string) => { created.push([d, string]); return "reg000001"; },
      drawing: () => ({ hash: "abcd1234" }),
    },
    native: {
      activeEditor: () => (editor ? { app, drawingUid: "drw000001" } : null),
      selectedElementIds: () => ["rect-a", "text-a"],
      captureSelectionSvg: async () => svg,
    },
    cache: { put: async (key, blob, dims) => puts.push([key, blob, dims]) },
    cold: {},
    toaster: { show: (m, o) => toasts.push([m, o]) },
    spotlight: () => {},
    getSettings: () => ({}),
    doc: {},
    clipboard: { writeText: async (t) => copied.push(t) },
  });
  return { actions, created, puts, copied, toasts };
}

test("createAreaRegion writes one region with caption, caches the svg, copies the ref", async () => {
  const { actions, created, puts, copied, toasts } = setup({ editor: true });
  const uid = await actions.createAreaRegion();
  assert.equal(uid, "reg000001");
  assert.equal(created.length, 1);
  assert.equal(created[0][0], "drw000001");
  const region = parseRegion(created[0][1]);
  assert.equal(region.kind, "area");
  assert.deepEqual(region.ids, ["rect-a", "text-a"]);
  assert.equal(region.caption, "Hello");
  assert.equal(puts.length, 1);
  assert.equal(puts[0][0], cropKey({ regionUid: uid, geometryKey: geometryKey(region), drawingHash: "abcd1234", tier: "svg" }));
  assert.deepEqual(puts[0][2], { w: 240, h: 160 });
  assert.deepEqual(copied, ["((reg000001))"]);
  assert.match(toasts.at(-1)[0], /reg000001/);
});

test("createAreaRegion without an editor toasts and returns null", async () => {
  const { actions, created, toasts } = setup({ editor: false });
  assert.equal(await actions.createAreaRegion(), null);
  assert.equal(created.length, 0);
  assert.equal(toasts.length, 1);
});
