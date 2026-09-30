import assert from "node:assert/strict";
import test from "node:test";

import { createLaneRegionMaker } from "../src/lane-regions.js";
import { parseRegion } from "../src/model/region.js";

const DRAWING = "drw000001";

function setup({ existing = [] } = {}) {
  const created = [];
  const emitted = [];
  const host = {
    regionsOf: () => existing,
    createRegions: async (uid, strings) => { created.push([uid, strings]); return strings.map((_, i) => `reg00000${i + 1}`); },
  };
  return { make: createLaneRegionMaker({ host, emit: (d) => emitted.push(d) }), created, emitted };
}

test("lane regions: one cframe region per new lane frame, then a region change per uid", async () => {
  const { make, created, emitted } = setup();
  const uids = await make(DRAWING, [{ id: "pmm-a-lane-1", name: "Receiving" }, { id: "pmm-a-lane-2", name: " Mixing " }]);
  assert.deepEqual(uids, ["reg000001", "reg000002"]);
  assert.equal(created.length, 1);
  const parsed = created[0][1].map((s) => parseRegion(s));
  assert.deepEqual(parsed.map((r) => [r.kind, r.frameId, r.caption]), [["cframe", "pmm-a-lane-1", "Receiving"], ["cframe", "pmm-a-lane-2", "Mixing"]]);
  assert.deepEqual(emitted, [{ uid: "reg000001", kind: "region" }, { uid: "reg000002", kind: "region" }]);
});

test("lane regions: frames that already have a frame or cframe region are skipped (idempotent on reopen)", async () => {
  const existing = [{ uid: "r1", region: { supported: true, kind: "cframe", frameId: "pmm-a-lane-1" } }, { uid: "r2", region: { supported: true, kind: "frame", frameId: "pmm-a-lane-2" } }, { uid: "r3", region: { supported: false, kind: "cframe", frameId: "pmm-a-lane-3" } }];
  const { make, created } = setup({ existing });
  const uids = await make(DRAWING, [{ id: "pmm-a-lane-1", name: "A" }, { id: "pmm-a-lane-2", name: "B" }, { id: "pmm-a-lane-3", name: "C" }]);
  assert.equal(created.length, 1);
  assert.equal(created[0][1].length, 1);
  assert.equal(parseRegion(created[0][1][0]).frameId, "pmm-a-lane-3");
  assert.equal(uids.length, 1);
  const again = setup({ existing: existing.slice(0, 2) });
  assert.deepEqual(await again.make(DRAWING, [{ id: "pmm-a-lane-1", name: "A" }]), []);
  assert.equal(again.created.length, 0);
});
