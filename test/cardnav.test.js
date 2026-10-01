import test from "node:test";
import assert from "node:assert/strict";
import { collectAnchors, nextAnchorId, parentAnchorId } from "../src/model/cardnav.js";
import { parseRegion } from "../src/model/region.js";

function el(id, type, x, y, width, height, extra = {}) {
  return { id, type, x, y, width, height, ...extra };
}

function row(uid, source) {
  const region = parseRegion(source);
  assert.equal(region.supported, true);
  return { uid, region };
}

const index = (rows) => new Map(rows.map((r) => [r.id, r]));

test("embed, page, today, plain rectangle, and deleted frame", () => {
  const elements = [
    el("m-frame", "magicframe", 0, 0, 80, 40),
    el("a-block", "rectangle", 12, 8, 30, 16, { customData: { plexus: { embed: "((abcdefghi))" } } }),
    el("p-page", "rectangle", 50, 8, 30, 16, { customData: { plexus: { embed: "[[Page]]" } } }),
    el("z-today", "rectangle", 90, 8, 30, 16, { customData: { plexus: { embed: "plexus:today" } } }),
    el("plain", "rectangle", 0, 80, 20, 20),
    el("d-frame", "frame", 0, 120, 40, 40, { isDeleted: true }),
  ];
  const rows = collectAnchors(elements, [
    { uid: "zzzzzzzzz", region: { supported: false, kind: "area", ids: ["plain"] } },
  ]);
  assert.deepEqual(rows.map((r) => r.id), ["a-block", "m-frame", "p-page", "z-today"]);
  assert.deepEqual(index(rows).get("a-block"), {
    id: "a-block", x: 12, y: 8, width: 30, height: 16, blockUid: "abcdefghi", regionUid: null,
  });
  assert.deepEqual(index(rows).get("p-page"), {
    id: "p-page", x: 50, y: 8, width: 30, height: 16, blockUid: null, regionUid: null,
  });
  assert.equal(index(rows).get("z-today").blockUid, null);
  assert.equal(index(rows).get("m-frame").blockUid, null);
  assert.equal(index(rows).get("m-frame").regionUid, null);
  assert.equal(index(rows).get("plain"), undefined);
  assert.equal(index(rows).get("d-frame"), undefined);
});

test("area ids share a region uid; a deleted named element is omitted", () => {
  const elements = [
    el("r2", "text", 40, 0, 10, 10),
    el("r1", "rectangle", 0, 5, 12, 8),
    el("gone", "rectangle", 0, 0, 10, 10, { isDeleted: true }),
    el("plain", "rectangle", 80, 0, 10, 10),
  ];
  const rows = collectAnchors(elements, [
    row("areauid01", "{{[[plexus-region]]: k=area d=drawing01 ids=r1,r2,gone,missing pad=0}}"),
  ]);
  assert.deepEqual(rows.map((r) => r.id), ["r1", "r2"]);
  for (const id of ["r1", "r2"]) {
    const rec = index(rows).get(id);
    assert.equal(rec.regionUid, "areauid01");
    assert.equal(rec.blockUid, "areauid01");
  }
  assert.deepEqual(index(rows).get("r1"), {
    id: "r1", x: 0, y: 5, width: 12, height: 8, blockUid: "areauid01", regionUid: "areauid01",
  });
});

test("two regions naming one id keep the lower uid, ahead of an embed block", () => {
  const elements = [
    el("shared", "rectangle", 0, 0, 10, 10),
    el("only-b", "rectangle", 30, 0, 10, 10),
    el("emb", "rectangle", 60, 0, 10, 10, { customData: { plexus: { embed: "((abcdefghi))" } } }),
  ];
  const high = row("bbbbbbbbb", "{{[[plexus-region]]: k=rect d=drawing01 el=shared f=0,0,1,1}}");
  const low = row("aaaaaaaaa", "{{[[plexus-region]]: k=poly d=drawing01 el=shared p=0,0,1,0,1,1}}");
  const only = row("bbbbbbbbb", "{{[[plexus-region]]: k=rect d=drawing01 el=only-b f=0,0,0.5,0.5}}");
  const embHigh = row("zzzzzzzzz", "{{[[plexus-region]]: k=rect d=drawing01 el=emb f=0,0,1,1}}");
  const embLow = row("mmmmmmmmm", "{{[[plexus-region]]: k=poly d=drawing01 el=emb p=0,0,1,0,0,1}}");
  for (const regions of [[high, low, only, embHigh, embLow], [low, high, embLow, embHigh, only]]) {
    const rows = index(collectAnchors(elements, regions));
    assert.equal(rows.get("shared").regionUid, "aaaaaaaaa");
    assert.equal(rows.get("shared").blockUid, "aaaaaaaaa");
    assert.equal(rows.get("only-b").regionUid, "bbbbbbbbb");
    assert.equal(rows.get("emb").regionUid, "mmmmmmmmm");
    assert.equal(rows.get("emb").blockUid, "mmmmmmmmm");
  }
});

test("a frame named by a frame or cframe region uses that region uid", () => {
  const elements = [
    el("frame1", "frame", 0, 0, 200, 100),
    el("cf1", "magicframe", 220, 0, 100, 80),
  ];
  const rows = index(collectAnchors(elements, [
    row("framereg1", "{{[[plexus-region]]: k=frame d=drawing01 fr=frame1 pad=4}}"),
    row("cframereg", "{{[[plexus-region]]: k=cframe d=drawing01 fr=cf1}}"),
  ]));
  assert.deepEqual(rows.get("frame1"), {
    id: "frame1", x: 0, y: 0, width: 200, height: 100, blockUid: "framereg1", regionUid: "framereg1",
  });
  assert.equal(rows.get("cf1").regionUid, "cframereg");
  assert.equal(rows.get("cf1").blockUid, "cframereg");
});

test("non-finite bounds are omitted", () => {
  const rows = collectAnchors([
    el("inf", "frame", Infinity, 0, 10, 10),
    el("ok", "frame", 4, 6, 8, 2),
  ], []);
  assert.deepEqual(rows, [{ id: "ok", x: 4, y: 6, width: 8, height: 2, blockUid: null, regionUid: null }]);
});

test("nextAnchorId picks the cone neighbor and rejects dx 10 dy 40", () => {
  const a = { id: "a", x: 0, y: 0, width: 10, height: 10, blockUid: null, regionUid: null };
  const right = { id: "b", x: 40, y: 0, width: 10, height: 10, blockUid: null, regionUid: null };
  const farther = { id: "far", x: 100, y: 2, width: 10, height: 10, blockUid: null, regionUid: null };
  const diagonal = { id: "c", x: 10, y: 40, width: 10, height: 10, blockUid: null, regionUid: null };
  const up = { id: "u", x: 0, y: -50, width: 10, height: 10, blockUid: null, regionUid: null };
  const anchors = [a, right, farther, diagonal, up];
  assert.equal(nextAnchorId(anchors, "a", "right"), "b");
  assert.equal(nextAnchorId([a, diagonal], "a", "right"), null);
  assert.equal(nextAnchorId(anchors, "a", "up"), "u");
  assert.equal(nextAnchorId(anchors, "missing", "right"), null);
  assert.equal(nextAnchorId(null, "a", "right"), null);
});

test("parentAnchorId returns the frame id only when that frame is an anchor", () => {
  const frame = el("f1", "frame", 0, 0, 200, 100);
  const child = el("c1", "rectangle", 10, 10, 20, 20, { frameId: "f1" });
  const loose = el("c2", "rectangle", 10, 40, 20, 20, { frameId: null });
  const plain = el("p1", "rectangle", 300, 0, 40, 40);
  const childOfPlain = el("c3", "rectangle", 305, 5, 10, 10, { frameId: "p1" });
  const deleted = el("fd", "frame", 0, 200, 50, 50, { isDeleted: true });
  const childOfDeleted = el("c4", "rectangle", 5, 210, 10, 10, { frameId: "fd" });
  const elements = [frame, child, loose, plain, childOfPlain, deleted, childOfDeleted];
  const anchors = collectAnchors(elements, []);
  assert.equal(parentAnchorId(anchors, elements, "c1"), "f1");
  assert.equal(parentAnchorId([], elements, "c1"), null);
  assert.equal(parentAnchorId(anchors, elements, "c2"), null);
  assert.equal(parentAnchorId(anchors, elements, "c3"), null);
  assert.equal(parentAnchorId(anchors, elements, "c4"), null);
  assert.equal(parentAnchorId([{ id: "fd", x: 0, y: 0, width: 50, height: 50 }], elements, "c4"), null);
  assert.equal(parentAnchorId(anchors, elements, "missing"), null);
});
