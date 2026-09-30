import assert from "node:assert/strict";
import test from "node:test";

import { STARTERS, buildStarter, pickCurrentItem, remapForInsert, selectionToTemplate, withTemplateFrames } from "../src/model/templates.js";
import { commonBounds } from "../src/model/scene.js";
import { baseElement } from "../src/model/embeds.js";

const measure = (s, size) => String(s).length * 0.6 * size;
const geometry = (els) => els.map((e) => [e.id, e.type, e.x, e.y, e.width, e.height, e.text ?? null, e.containerId ?? null, e.frameId ?? null]);

const COUNTS = { "haccp-flow": 30, "five-why": 20, fishbone: 21, apollo: 17, sipoc: 19, swimlane: 20, "swab-site-map": 21, "slide-16x9": 3 };

test("the starters are the eight named ones, in order", () => {
  assert.deepEqual(STARTERS.map((s) => s.name), ["HACCP flow", "5-Why", "Fishbone", "Apollo cause map", "SIPOC", "Swimlane", "Swab-site map", "16:9 slide"]);
  assert.deepEqual(STARTERS.map((s) => s.id), Object.keys(COUNTS));
});

for (const starter of STARTERS) {
  test(`starter ${starter.id}: element count, unique ids, two-sided bindings, frame after children`, () => {
    const els = buildStarter(starter, { measure });
    assert.equal(els.length, COUNTS[starter.id]);
    const ids = els.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length);
    const byId = new Map(els.map((e) => [e.id, e]));
    for (const a of els.filter((e) => e.type === "arrow")) {
      const s = a.startBinding?.elementId;
      const t = a.endBinding?.elementId;
      assert.ok(byId.has(s) && byId.has(t), "both ends exist");
      assert.notEqual(s, t, "no self arrow");
      for (const end of [s, t]) assert.ok(byId.get(end).boundElements.some((b) => b.id === a.id && b.type === "arrow"), "bound on both sides");
    }
    for (const e of els.filter((x) => x.type === "text" && x.containerId)) {
      assert.ok(byId.get(e.containerId).boundElements.some((b) => b.id === e.id && b.type === "text"));
    }
    for (const f of els.filter((e) => e.type === "frame")) {
      const at = els.indexOf(f);
      const kids = els.filter((e) => e.frameId === f.id);
      assert.ok(kids.length > 0);
      for (const k of kids) assert.ok(els.indexOf(k) < at, "children come before their frame");
    }
    for (const e of els) assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y));
  });

  test(`starter ${starter.id} is deterministic in ids and geometry`, () => {
    assert.deepEqual(geometry(buildStarter(starter, { measure })), geometry(buildStarter(starter, { measure })));
  });
}

test("the HACCP flow has a decision diamond with Yes and No labels and a CCP 1 chip", () => {
  const els = buildStarter(STARTERS[0], { measure });
  assert.equal(els.filter((e) => e.type === "diamond").length, 1);
  const texts = els.filter((e) => e.type === "text").map((e) => e.originalText);
  for (const t of ["Metal detected?", "Yes", "No", "CCP 1", "Hold & investigate", "Receive ingredients", "Ship"]) assert.ok(texts.includes(t), t);
});

test("the slide starter is one 854x480 frame named Slide holding its title and body", () => {
  const els = buildStarter(STARTERS.find((s) => s.id === "slide-16x9"), { measure });
  const frame = els.find((e) => e.type === "frame");
  assert.deepEqual([frame.name, frame.width, frame.height], ["Slide", 854, 480]);
  assert.equal(els.filter((e) => e.frameId === frame.id).length, 2);
});

test("the swab-site map has four nested zones, six numbered sites and a legend", () => {
  const els = buildStarter(STARTERS.find((s) => s.id === "swab-site-map"), { measure });
  const zones = els.filter((e) => e.type === "rectangle");
  assert.equal(zones.length, 4);
  const inside = (a, b) => a.x > b.x && a.y > b.y && a.x + a.width < b.x + b.width && a.y + a.height < b.y + b.height;
  const sorted = [...zones].sort((a, b) => b.width - a.width);
  for (let i = 1; i < 4; i++) assert.ok(inside(sorted[i], sorted[i - 1]));
  const sites = els.filter((e) => e.type === "ellipse");
  assert.equal(sites.length, 6);
  const labels = els.filter((e) => e.type === "text").map((e) => e.originalText);
  for (let i = 1; i <= 6; i++) assert.ok(labels.includes(`S${i}`));
  assert.ok(labels.some((t) => t.startsWith("Legend")));
  assert.ok(labels.some((t) => t === "Zone 1: product contact"));
  assert.ok(labels.some((t) => t === "Zone 4: outside production"));
});

// ---- remap ----

const box = (id, x, y, extra = {}) => ({ ...baseElement(id, "rectangle", x, y, 100, 50), ...extra });
let ctr = 0;
const newId = () => `new${++ctr}`;

function sample() {
  const a = box("a", 0, 0, { groupIds: ["g1"], boundElements: [{ id: "ta", type: "text" }, { id: "arr", type: "arrow" }, { id: "outside", type: "arrow" }], frameId: "fr", customData: { plexus: { mm: { uid: "x" }, addKey: "k", note: 1 }, other: 2 } });
  const ta = { ...baseElement("ta", "text", 10, 10, 50, 20), containerId: "a", text: "A", originalText: "A", groupIds: ["g1"], frameId: "fr" };
  const b = box("b", 300, 0, { groupIds: ["g1", "g2"], boundElements: [{ id: "arr", type: "arrow" }], frameId: "fr" });
  const arr = { ...baseElement("arr", "arrow", 100, 25, 200, 0), points: [[0, 0], [200, 0]], startBinding: { elementId: "a", focus: 0, gap: 4 }, endBinding: { elementId: "b", focus: 0, gap: 4 } };
  const fr = { ...baseElement("fr", "frame", -20, -20, 500, 200), name: "F", customData: { plexus: { order: 3 } } };
  const dead = { ...box("dead", 0, 0), isDeleted: true };
  return [a, ta, b, arr, fr, dead];
}

test("remapForInsert gives new ids, groups and seeds, and remaps every reference", () => {
  ctr = 0;
  const src = sample();
  const copy = structuredClone(src);
  const out = remapForInsert(src, { newId, now: 999 });
  assert.deepEqual(src, copy, "input untouched");
  assert.equal(out.length, 5, "deleted dropped");
  const ids = out.map((e) => e.id);
  assert.equal(new Set(ids).size, 5);
  for (const old of ["a", "ta", "b", "arr", "fr"]) assert.ok(!ids.includes(old));
  const [a, ta, b, arr, fr] = out;
  assert.equal(ta.containerId, a.id);
  assert.deepEqual(a.boundElements, [{ id: ta.id, type: "text" }, { id: arr.id, type: "arrow" }], "outside entry dropped");
  assert.equal(arr.startBinding.elementId, a.id);
  assert.equal(arr.endBinding.elementId, b.id);
  assert.equal(a.frameId, fr.id);
  assert.equal(b.groupIds.length, 2);
  assert.equal(a.groupIds[0], b.groupIds[0], "same old group, same new group");
  assert.notEqual(a.groupIds[0], "g1");
  assert.notEqual(b.groupIds[1], b.groupIds[0]);
  for (const e of out) { assert.equal(e.index, null); assert.equal(e.updated, 999); assert.equal(e.version, 1); assert.equal(e.isDeleted, false); }
  assert.notEqual(a.seed, src[0].seed);
});

test("remapForInsert drops map and add markers and the old frame order, and keeps other data", () => {
  const out = remapForInsert(sample(), { newId });
  assert.deepEqual(out[0].customData, { plexus: { note: 1 }, other: 2 });
  assert.equal(out[4].customData, undefined);
  const img = { ...baseElement("i", "image", 0, 0, 10, 10), fileId: "f1", customData: { firebaseUrl: "https://x/y.enc", plexus: { mm: { uid: "z" } } } };
  const [copy] = remapForInsert([img], { newId });
  assert.deepEqual(copy.customData, { firebaseUrl: "https://x/y.enc" });
  assert.equal(copy.fileId, "f1");
});

test("remapForInsert drops a binding to an element outside the set and keeps the arrow's points", () => {
  const arr = { ...baseElement("arr", "arrow", 5, 5, 100, 0), points: [[0, 0], [100, 0]], startBinding: { elementId: "gone", focus: 0, gap: 4 }, endBinding: null };
  const [out] = remapForInsert([arr], { newId });
  assert.equal(out.startBinding, null);
  assert.deepEqual(out.points, [[0, 0], [100, 0]]);
  const t = { ...baseElement("t", "text", 0, 0, 10, 10), containerId: "gone", frameId: "gone2" };
  const [tt] = remapForInsert([t], { newId });
  assert.equal(tt.containerId, null);
  assert.equal(tt.frameId, null);
});

test("remapForInsert centres the common bounds on the given point", () => {
  const out = remapForInsert(sample(), { centre: { x: 1000, y: 500 }, newId });
  const [x1, y1, x2, y2] = commonBounds(out);
  assert.ok(Math.abs((x1 + x2) / 2 - 1000) < 1e-6);
  assert.ok(Math.abs((y1 + y2) / 2 - 500) < 1e-6);
  const src = sample();
  assert.equal(src[3].x, 100, "arrow x moved with the group, points are relative");
  assert.equal(out[3].points[1][0], 200);
});

test("withTemplateFrames orders new frames after the existing ones and leaves other elements alone", () => {
  const f = (id, order) => ({ ...baseElement(id, "frame", 0, 0, 10, 10), customData: { plexus: { order } } });
  const current = [f("f1", 1), f("f2", 2), box("x", 0, 0)];
  const added = remapForInsert([{ ...baseElement("nf", "frame", 0, 0, 10, 10), name: "N" }, box("k", 1, 1)], { newId });
  const next = withTemplateFrames(current, added);
  assert.equal(next.length, 5);
  assert.equal(next[0], current[0]);
  assert.equal(next.find((e) => e.name === "N").customData.plexus.order, 3);
  const noFrames = withTemplateFrames(current, [added[1]]);
  assert.deepEqual(noFrames, [...current, added[1]]);
});

// ---- selection capture ----

function scene() {
  const n1 = box("n1", 0, 0, { boundElements: [{ id: "t1", type: "text" }, { id: "ar", type: "arrow" }, { id: "ar2", type: "arrow" }], customData: { plexus: { mm: { uid: "u" } } } });
  const t1 = { ...baseElement("t1", "text", 5, 5, 20, 10), containerId: "n1", text: "N1", originalText: "N1" };
  const n2 = box("n2", 200, 0, { boundElements: [{ id: "ar", type: "arrow" }] });
  const n3 = box("n3", 500, 0, { boundElements: [{ id: "ar2", type: "arrow" }] });
  const ar = { ...baseElement("ar", "arrow", 100, 25, 100, 0), points: [[0, 0], [100, 0]], startBinding: { elementId: "n1", focus: 0, gap: 4 }, endBinding: { elementId: "n2", focus: 0, gap: 4 }, boundElements: [{ id: "lab", type: "text" }] };
  const lab = { ...baseElement("lab", "text", 120, 10, 20, 10), containerId: "ar", text: "L", originalText: "L" };
  const ar2 = { ...baseElement("ar2", "arrow", 100, 25, 400, 0), points: [[0, 0], [400, 0]], startBinding: { elementId: "n1", focus: 0, gap: 4 }, endBinding: { elementId: "n3", focus: 0, gap: 4 } };
  return [n1, t1, n2, n3, ar, lab, ar2];
}

test("selection capture takes bound text and the arrows between selected elements, not arrows leaving the set", () => {
  const els = scene();
  const { elements, skippedImages } = selectionToTemplate(els, ["n1", "n2"]);
  assert.equal(skippedImages, 0);
  assert.deepEqual(elements.map((e) => e.id), ["n1", "t1", "n2", "ar", "lab"]);
  const n1 = elements[0];
  assert.deepEqual(n1.boundElements, [{ id: "t1", type: "text" }, { id: "ar", type: "arrow" }], "the arrow to n3 is not in the set");
  assert.equal(n1.customData, undefined, "mm marker removed, empty containers pruned");
  assert.notEqual(elements[0], els[0], "deep copy");
});

test("a selected arrow with one end outside keeps its points and loses that binding", () => {
  const { elements } = selectionToTemplate(scene(), ["ar2", "n1"]);
  const ar2 = elements.find((e) => e.id === "ar2");
  assert.equal(ar2.startBinding.elementId, "n1");
  assert.equal(ar2.endBinding, null);
  assert.deepEqual(ar2.points, [[0, 0], [400, 0]]);
});

test("a selected frame takes its children and their bound text; children of an unselected frame lose the frame id", () => {
  const fr = { ...baseElement("fr", "frame", -10, -10, 500, 200), name: "F" };
  const c1 = box("c1", 0, 0, { frameId: "fr", boundElements: [{ id: "ct", type: "text" }] });
  const ct = { ...baseElement("ct", "text", 5, 5, 10, 10), containerId: "c1", frameId: "fr" };
  const loose = box("loose", 600, 0);
  const inOther = box("io", 700, 0, { frameId: "fr" });
  const all = [c1, ct, inOther, fr, loose];
  const framed = selectionToTemplate(all, ["fr"]);
  assert.deepEqual(framed.elements.map((e) => e.id), ["c1", "ct", "io", "fr"]);
  assert.equal(framed.elements[0].frameId, "fr");
  const child = selectionToTemplate(all, ["c1"]);
  assert.deepEqual(child.elements.map((e) => e.id), ["c1", "ct"]);
  assert.equal(child.elements[0].frameId, null);
  assert.equal(child.elements[1].frameId, null);
});

test("deleted elements, images without an upload and bindings to them are left out and counted", () => {
  const up = { ...baseElement("up", "image", 0, 0, 10, 10), fileId: "f1", customData: { firebaseUrl: "https://x/1.enc" } };
  const no = { ...baseElement("no", "image", 20, 0, 10, 10), fileId: "f2" };
  const dead = { ...box("dead", 40, 0), isDeleted: true };
  const arr = { ...baseElement("arr", "arrow", 0, 0, 20, 0), points: [[0, 0], [20, 0]], startBinding: { elementId: "up", focus: 0, gap: 4 }, endBinding: { elementId: "no", focus: 0, gap: 4 } };
  const { elements, skippedImages } = selectionToTemplate([up, no, dead, arr], ["up", "no", "dead", "arr"]);
  assert.equal(skippedImages, 1);
  assert.deepEqual(elements.map((e) => e.id), ["up", "arr"]);
  assert.equal(elements[1].endBinding, null);
});

test("locked and link survive capture; an empty selection gives an empty result", () => {
  const l = box("l", 0, 0, { locked: true, link: "https://example.com" });
  assert.deepEqual(selectionToTemplate([l], ["l"]).elements.map((e) => [e.locked, e.link]), [[true, "https://example.com"]]);
  assert.deepEqual(selectionToTemplate([l], []).elements, []);
});

test("pickCurrentItem keeps only the currentItem keys", () => {
  assert.deepEqual(pickCurrentItem({ currentItemStrokeColor: "#f00", currentItemFontSize: 20, zoom: 1, scrollX: 4 }), { currentItemStrokeColor: "#f00", currentItemFontSize: 20 });
  assert.deepEqual(pickCurrentItem(null), {});
});
