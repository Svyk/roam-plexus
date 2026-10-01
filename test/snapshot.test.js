import assert from "node:assert/strict";
import test from "node:test";

import { API_VERSION, createPublicApi, createSceneRegistry } from "../src/api.js";
import { createWriteGuard } from "../src/host/guard.js";
import { snapshotElements } from "../src/model/snapshot.js";

const measure = (s, fs) => s.length * fs * 0.5;

function fixture({ open = true } = {}) {
  const app = {
    state: { selectedElementIds: {}, selectedGroupIds: {}, scrollX: 0, scrollY: 0, zoom: { value: 1 }, width: 800, height: 600, offsetLeft: 0, offsetTop: 0 },
    els: [{ id: "old", type: "rectangle", x: 0, y: 0, width: 5, height: 5, version: 1, isDeleted: false }],
    updates: [],
    getSceneElementsIncludingDeleted() { return this.els; },
    updateScene(u) { this.updates.push(u); if (u.elements) this.els = u.elements; if (u.appState) Object.assign(this.state, u.appState); },
  };
  const ctx = { drawingUid: "d1", app };
  const native = { activeEditor: () => (open ? ctx : null) };
  const guard = createWriteGuard({ toaster: { show() {} } });
  const bulk = [];
  const reg = createSceneRegistry({ native, doc: {}, raf: () => {}, guard, measure, beforeBulk: (a, uid, label) => bulk.push([a, uid, label]) });
  const api = createPublicApi({ host: { pullBlock: () => ({ string: "" }), graphName: () => "g" }, actions: {}, emitter: null, version: "0.12.0", scenes: reg });
  return { app, reg, api, bulk };
}

const COMPASS = [
  { uid: "c", title: "Center", zone: "center" },
  { uid: "n", title: "North", zone: "north" },
  { uid: "s", title: "South", zone: "south" },
  { uid: "w", title: "West", zone: "west" },
  { uid: "e", title: "East", zone: "east" },
  { uid: "sib", title: "Sib", zone: "siblings" },
];

function pair(els, title) {
  const text = els.find((el) => el.type === "text" && el.text === title);
  const rect = els.find((el) => el.id === text.containerId);
  return { text, rect };
}

test("plain mode has no [[ in any text", () => {
  const nodes = [
    { uid: "c", title: "Center", zone: "center" },
    { uid: "n", title: "North", zone: "north" },
  ];
  for (const payload of [{ nodes, mode: "plain" }, { nodes, mode: "other" }, { nodes }]) {
    const els = snapshotElements(payload);
    const texts = els.filter((el) => el.type === "text");
    assert.equal(texts.length, 2);
    for (const text of texts) {
      assert.equal(text.text.includes("[["), false);
      assert.equal(text.originalText.includes("[["), false);
    }
    assert.deepEqual(texts.map((text) => text.text).sort(), ["Center", "North"]);
  }
});

test("links mode text is [[Title]]", () => {
  const els = snapshotElements({ nodes: [{ uid: "t", title: "Title", zone: "center" }], mode: "links" });
  const text = els.find((el) => el.type === "text");
  assert.equal(text.text, "[[Title]]");
  assert.equal(text.originalText, "[[Title]]");
});

test("a bracket title stays plain even in links mode", () => {
  for (const title of ["A [note]", "Has]", "[[Page]]"]) {
    const els = snapshotElements({ nodes: [{ uid: "c", title, zone: "center" }], mode: "links" });
    const text = els.find((el) => el.type === "text");
    assert.equal(text.text, title);
    assert.equal(text.originalText, title);
  }
});

test("empty input returns []", () => {
  assert.deepEqual(snapshotElements(), []);
  assert.deepEqual(snapshotElements({ nodes: [] }), []);
  assert.deepEqual(snapshotElements({ nodes: [], edges: [{ from: "a", to: "b" }], mode: "links" }), []);
});

test("north y is negative, south y is positive, and snapshot is true", () => {
  const els = snapshotElements({ nodes: COMPASS });
  assert.ok(els.length > 0);
  const group = els[0].groupIds[0];
  assert.equal(typeof group, "string");
  assert.ok(group.length > 0);
  assert.ok(els.every((el) => el.customData.plexus.snapshot === true && el.groupIds[0] === group));

  const center = pair(els, "Center");
  const north = pair(els, "North");
  const south = pair(els, "South");
  const west = pair(els, "West");
  const east = pair(els, "East");
  const sib = pair(els, "Sib");
  assert.equal(center.rect.x, 0);
  assert.equal(center.rect.y, 0);
  assert.ok(north.rect.y < 0 && north.text.y < 0);
  assert.ok(south.rect.y > 0 && south.text.y > 0);
  assert.ok(west.rect.x < 0 && west.text.x < 0);
  assert.ok(east.rect.x > 0 && east.text.x > 0);
  assert.equal(center.rect.backgroundColor, "#f1f3f5");
  assert.equal(north.rect.backgroundColor, "#d0ebff");
  assert.equal(south.rect.backgroundColor, "#d3f9d8");
  assert.equal(west.rect.backgroundColor, "#fff3bf");
  assert.equal(east.rect.backgroundColor, "#ffd8a8");
  assert.equal(sib.rect.backgroundColor, "#e9ecef");

  for (const { text, rect } of [center, north, south, west, east, sib]) {
    assert.equal(text.containerId, rect.id);
    assert.ok(rect.boundElements.some((entry) => entry.id === text.id && entry.type === "text"));
    for (const el of [text, rect]) {
      assert.equal(el.angle, 0);
      assert.equal(el.fillStyle, "solid");
      assert.equal(el.strokeStyle, "solid");
      assert.equal(el.roughness, 1);
      assert.equal(el.opacity, 100);
      assert.equal(el.version, 1);
      assert.equal(el.isDeleted, false);
      assert.equal(el.link, null);
      assert.equal(el.locked, false);
      assert.equal(el.frameId, null);
      assert.equal(el.index, null);
      assert.equal(el.roundness, null);
      assert.equal(typeof el.strokeColor, "string");
      assert.equal(typeof el.strokeWidth, "number");
      assert.equal(typeof el.seed, "number");
      assert.equal(typeof el.versionNonce, "number");
      assert.equal(typeof el.updated, "number");
      assert.ok(el.width > 0 && el.height > 0);
    }
    assert.equal(text.fontSize, 20);
    assert.equal(text.fontFamily, 5);
    assert.equal(text.textAlign, "center");
    assert.equal(text.verticalAlign, "middle");
    assert.equal(text.autoResize, true);
    assert.equal(text.lineHeight, 1.25);
  }

  const arrows = els.filter((el) => el.type === "arrow");
  assert.equal(arrows.length, COMPASS.length - 1);
  const targets = new Set(arrows.map((arrow) => arrow.endBinding.elementId));
  assert.equal(targets.size, arrows.length);
  for (const arrow of arrows) {
    assert.equal(arrow.endArrowhead, "arrow");
    assert.equal(arrow.startBinding.elementId, center.rect.id);
    assert.notEqual(arrow.endBinding.elementId, center.rect.id);
    assert.equal(arrow.points.length, 2);
  }
  assert.ok(targets.has(north.rect.id));
  assert.ok(targets.has(south.rect.id));

  const noCenter = snapshotElements({
    nodes: [
      { uid: "w", title: "West", zone: "west" },
      { uid: "e", title: "East", zone: "east" },
    ],
  });
  const from = pair(noCenter, "West");
  const to = pair(noCenter, "East");
  const arrow = noCenter.find((el) => el.type === "arrow");
  assert.equal(arrow.startBinding.elementId, from.rect.id);
  assert.equal(arrow.endBinding.elementId, to.rect.id);
  assert.ok(from.rect.x < 0);
  assert.ok(to.rect.x > 0);
});

test("dropSubgraph on an open drawing appends elements and the label is Snapshot", () => {
  const { app, api, bulk } = fixture();
  const n = api.dropSubgraph({
    nodes: [
      { uid: "c", title: "Center", zone: "center" },
      { uid: "n", title: "North", zone: "north" },
    ],
  });
  assert.equal(app.updates.length, 1);
  assert.equal(app.updates[0].captureUpdate, "IMMEDIATELY");
  assert.equal(app.els[0].id, "old");
  assert.equal(app.els.length, 1 + n);
  assert.ok(n > 1);
  assert.ok(app.els.slice(1).every((el) => el.customData.plexus.snapshot === true));
  assert.equal(bulk.length, 1);
  assert.equal(bulk[0][1], "d1");
  assert.equal(bulk[0][2], "before Snapshot");
});

test("a closed drawing throws /Drawing is not open/ and writes nothing", () => {
  const closed = fixture({ open: false });
  assert.throws(
    () => closed.api.dropSubgraph({ nodes: [{ uid: "c", title: "Center", zone: "center" }] }),
    /Drawing is not open/,
  );
  assert.equal(closed.app.updates.length, 0);
  assert.equal(closed.app.els.length, 1);
  assert.equal(closed.bulk.length, 0);
});

test("api.apiVersion stays 6", () => {
  assert.equal(API_VERSION, 6);
  assert.equal(fixture().api.apiVersion, 6);
});
