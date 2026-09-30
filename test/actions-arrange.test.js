import assert from "node:assert/strict";
import test from "node:test";

import { createArrangeActions } from "../src/actions-arrange.js";

const base = { angle: 0, isDeleted: false, version: 1, groupIds: [], frameId: null, boundElements: null, locked: false };
const box = (id, x, y, w = 100, h = 50) => ({ ...base, id, type: "rectangle", x, y, width: w, height: h });

function make({ elements, selected, editor = true, guardOk = true } = {}) {
  const calls = [];
  const toasts = [];
  const app = { getSceneElementsIncludingDeleted: () => elements };
  const native = {
    activeEditor: () => (editor ? { app, drawingUid: "drw000001" } : null),
    selectedElementIds: () => selected,
  };
  const actions = createArrangeActions({
    doc: {},
    native,
    toaster: { show: (m, o) => toasts.push([m, o]) },
    beforeBulk: (a, uid, label) => calls.push(["before", uid, label]),
    guardedWrite: (a, opts) => { calls.push(["write", opts]); return guardOk; },
  });
  return { actions, calls, toasts };
}

test("canRun follows the selection and the ARRANGE_OPS rules", () => {
  const els = [box("a", 0, 0), box("b", 200, 0), box("c", 400, 0)];
  const one = make({ elements: els, selected: ["a"] });
  assert.equal(one.actions.canRun("row"), false);
  assert.equal(one.actions.canRun("box"), true);
  const two = make({ elements: els, selected: ["a", "b"] });
  assert.equal(two.actions.canRun("row"), true);
  assert.equal(two.actions.canRun("swap"), true);
  assert.equal(two.actions.canRun("nope"), false);
  assert.equal(make({ elements: els, selected: ["a", "b"], editor: false }).actions.canRun("row"), false);
  const three = make({ elements: els, selected: ["a", "b", "c"] });
  assert.equal(three.actions.canRun("swap"), false);
});

test("run: one beforeBulk then one immediate guarded write, selection untouched", () => {
  const els = [box("a", 0, 0), box("b", 300, 40)];
  const { actions, calls, toasts } = make({ elements: els, selected: ["a", "b"] });
  assert.equal(actions.run("row"), true);
  assert.deepEqual(calls.map((c) => c[0]), ["before", "write"]);
  assert.deepEqual(calls[0], ["before", "drw000001", "before Arrange"]);
  const w = calls[1][1];
  assert.equal(w.captureUpdate, "IMMEDIATELY");
  assert.equal(w.label, "Arrange");
  assert.equal(w.drawingUid, "drw000001");
  assert.equal("appState" in w, false);
  assert.equal(w.next.find((e) => e.id === "b").y, 0);
  assert.equal(toasts.length, 0);
});

test("run: refusals toast and write nothing", () => {
  const els = [box("pmm-m-1", 0, 0), box("pmm-m-2", 200, 0), box("a", 0, 300)];
  const { actions, calls, toasts } = make({ elements: els, selected: ["pmm-m-1", "pmm-m-2"] });
  assert.equal(actions.run("row"), false);
  assert.deepEqual(calls, []);
  assert.equal(toasts[0][0], "Map nodes follow the outline");
  const none = make({ elements: els, selected: ["a"], editor: false });
  assert.equal(none.actions.run("box"), false);
  assert.deepEqual(none.calls, []);
});

test("run: bent arrows and skipped map nodes toast after the write", () => {
  const arrow = { ...base, id: "ar", type: "arrow", x: 104, y: 25, width: 292, height: 60, points: [[0, 0], [146, 60], [292, 0]], elbowed: false, startBinding: { elementId: "a", focus: 0, gap: 4 }, endBinding: { elementId: "b", focus: 0, gap: 4 } };
  const els = [box("a", 0, 0), box("b", 400, 0), box("c", 0, 500), arrow, box("pmm-m-1", 900, 0)];
  const { actions, calls, toasts } = make({ elements: els, selected: ["a", "c", "pmm-m-1"] });
  assert.equal(actions.run("swap"), true);
  assert.equal(calls[1][0], "write");
  assert.deepEqual(toasts.map((t) => t[0]), ["1 bent or elbow arrows kept their shape", "Map nodes follow the outline"]);
});

test("run: a refused guarded write returns false and never throws", () => {
  const els = [box("a", 0, 0), box("b", 300, 40)];
  assert.equal(make({ elements: els, selected: ["a", "b"], guardOk: false }).actions.run("row"), false);
  const broken = createArrangeActions({ doc: {}, native: { activeEditor: () => { throw new Error("x"); } }, toaster: { show() {} }, guardedWrite: () => true });
  assert.equal(broken.run("row"), false);
  assert.equal(broken.canRun("row"), false);
});
