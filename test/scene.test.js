import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDrawingProps, liveElements, elementBounds, commonBounds, exportBounds, regionSceneBBox,
  viewPngCropRect, fitZoom, sceneToViewport, viewportToScene, rectToFraction, cropSvgToFraction, normalizeSvgSize,
} from "../src/model/scene.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const nearAll = (a, b, eps) => a.forEach((v, i) => near(v, b[i], eps));

const rect = (id, x, y, width, height, extra = {}) => ({ id, type: "rectangle", x, y, width, height, angle: 0, ...extra });
const fixture = () => [
  rect("rect-a", 100, 100, 220, 140),
  rect("rect-b", 420, 120, 160, 100),
  { id: "text-a", type: "text", x: 130, y: 150, width: 160, height: 25, angle: 0, text: "hi" },
];

test("parseDrawingProps accepts pull, q and bare keys", () => {
  const els = JSON.stringify([rect("a", 0, 0, 1, 1)]);
  const state = JSON.stringify({ zoom: { value: 2 } });
  for (const props of [
    { ":excalidraw/elements-json": els, ":excalidraw/state-json": state, ":excalidraw/version": 3, ":excalidraw/instance-id": "i" },
    { "elements-json": els, "state-json": state, version: 3, "instance-id": "i" },
    { "excalidraw/elements-json": els, "excalidraw/state-json": state, "excalidraw/version": 3, "excalidraw/instance-id": "i" },
  ]) {
    const d = parseDrawingProps(props);
    assert.equal(d.elements.length, 1);
    assert.equal(d.appState.zoom.value, 2);
    assert.equal(d.version, 3);
    assert.equal(d.instanceId, "i");
    assert.equal(d.elementsJson, els);
  }
});

test("parseDrawingProps returns null for non-drawings and bad JSON", () => {
  assert.equal(parseDrawingProps(null), null);
  assert.equal(parseDrawingProps({}), null);
  assert.equal(parseDrawingProps({ ":excalidraw/elements-json": "{oops" }), null);
  assert.equal(parseDrawingProps({ ":excalidraw/elements-json": "{}" }), null);
  const d = parseDrawingProps({ ":excalidraw/elements-json": "[]", ":excalidraw/state-json": "nope" });
  assert.deepEqual(d.appState, {});
});

test("liveElements drops deleted", () => {
  assert.deepEqual(liveElements([{ id: "a" }, { id: "b", isDeleted: true }, null]).map((e) => e.id), ["a"]);
  assert.deepEqual(liveElements(null), []);
});

test("Phase 0 fixture: commonBounds and PNG crop", () => {
  const els = fixture();
  assert.deepEqual(commonBounds(els), [100, 100, 580, 240]);
  const { bbox, missing } = regionSceneBBox({ kind: "area", ids: ["rect-a", "text-a"], pad: 10 }, els);
  assert.deepEqual(missing, []);
  assert.deepEqual(bbox, [90, 90, 330, 250]);
  // The hot SVG is 240x160; in the 500x160 view PNG (origin 90,90) it starts at 0,0.
  assert.deepEqual(viewPngCropRect({ elements: els, bbox, naturalWidth: 500, naturalHeight: 160 }), { sx: 0, sy: 0, sw: 240, sh: 160 });
});

test("viewPngCropRect: unpadded bbox of the fixture lands at 10,10", () => {
  const r = viewPngCropRect({ elements: fixture(), bbox: [100, 100, 320, 240], naturalWidth: 500, naturalHeight: 160 });
  assert.deepEqual(r, { sx: 10, sy: 10, sw: 220, sh: 140 });
});

test("viewPngCropRect: mismatch rule allows +-2 px and reports expected/actual", () => {
  const args = { elements: fixture(), bbox: [100, 100, 320, 240] };
  assert.ok(!viewPngCropRect({ ...args, naturalWidth: 502, naturalHeight: 158 }).error);
  const bad = viewPngCropRect({ ...args, naturalWidth: 503, naturalHeight: 160 });
  assert.deepEqual(bad, { error: "bounds-mismatch", expected: [500, 160], actual: [503, 160] });
  assert.equal(viewPngCropRect({ ...args, naturalWidth: 500, naturalHeight: 157 }).error, "bounds-mismatch");
});

test("viewPngCropRect clamps to the image and ignores deleted elements in bounds", () => {
  const els = [...fixture(), rect("ghost", -500, -500, 10, 10, { isDeleted: true })];
  const r = viewPngCropRect({ elements: els, bbox: [0, 0, 1000, 1000], naturalWidth: 500, naturalHeight: 160 });
  assert.deepEqual(r, { sx: 0, sy: 0, sw: 500, sh: 160 });
  assert.deepEqual(commonBounds(els), [100, 100, 580, 240]);
  assert.equal(commonBounds([]), null);
  assert.equal(commonBounds([rect("x", 0, 0, 1, 1, { isDeleted: true })]), null);
});

test("regionSceneBBox reports missing ids and errors", () => {
  const els = fixture();
  const r = regionSceneBBox({ kind: "area", ids: ["rect-b", "nope"], pad: 0 }, els);
  assert.deepEqual(r, { bbox: [420, 120, 580, 220], missing: ["nope"] });
  assert.equal(regionSceneBBox({ kind: "area", ids: ["nope"], pad: 10 }, els).error, "no-elements");
  assert.equal(regionSceneBBox({ kind: "area", ids: ["a"], pad: 10 }, []).error, "no-elements");
  assert.equal(regionSceneBBox({ kind: "blob" }, els).error, "unsupported-kind");
});

test("regionSceneBBox rect kind", () => {
  const img = { id: "img", type: "image", x: 100, y: 200, width: 400, height: 200, angle: 0 };
  const r = regionSceneBBox({ kind: "rect", el: "img", f: [0.25, 0.5, 0.5, 0.25] }, [img]);
  assert.deepEqual(r, { bbox: [200, 300, 400, 350], missing: [] });
  assert.equal(regionSceneBBox({ kind: "rect", el: "img", f: [0, 0, 1, 1] }, [{ ...img, angle: 0.3 }]).error, "rotated-image");
  assert.equal(regionSceneBBox({ kind: "rect", el: "r", f: [0, 0, 1, 1] }, [rect("r", 0, 0, 1, 1)]).error, "not-image");
  assert.equal(regionSceneBBox({ kind: "rect", el: "zz", f: [0, 0, 1, 1] }, [img]).error, "no-elements");
});

test("elementBounds: rotated rectangle", () => {
  // 100x50 rect rotated 90deg about its center (150,125): becomes 50 wide, 100 tall.
  const b = elementBounds(rect("r", 100, 100, 100, 50, { angle: Math.PI / 2 }));
  nearAll(b, [125, 75, 175, 175]);
  nearAll(elementBounds(rect("r", 0, 0, 10, 20)), [0, 0, 10, 20]);
});

test("elementBounds: diamond uses edge midpoints", () => {
  nearAll(elementBounds({ type: "diamond", x: 0, y: 0, width: 100, height: 50, angle: 0 }), [0, 0, 100, 50]);
  // 45deg rotation about (50,25): midpoints (50,0),(100,25),(50,50),(0,25)
  const c = Math.SQRT1_2;
  const pts = [[0, -25], [50, 0], [0, 25], [-50, 0]].map(([dx, dy]) => [50 + dx * c - dy * c, 25 + dx * c + dy * c]);
  nearAll(elementBounds({ type: "diamond", x: 0, y: 0, width: 100, height: 50, angle: Math.PI / 4 }),
    [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))]);
});

test("elementBounds: rotated ellipse is tighter than rotated corners", () => {
  const el = { type: "ellipse", x: 0, y: 0, width: 200, height: 100, angle: Math.PI / 4 };
  const hx = Math.sqrt((100 * Math.SQRT1_2) ** 2 + (50 * Math.SQRT1_2) ** 2);
  nearAll(elementBounds(el), [100 - hx, 50 - hx, 100 + hx, 50 + hx]);
  const cornersHalf = (200 + 100) * Math.SQRT1_2 / 2;
  assert.ok(hx < cornersHalf);
  nearAll(elementBounds({ ...el, angle: 0 }), [0, 0, 200, 100]);
});

test("elementBounds: straight line/arrow, rotated about the local bbox center", () => {
  const line = { type: "line", x: 10, y: 20, width: 100, height: 0, angle: 0, points: [[0, 0], [100, 0]], roundness: null };
  nearAll(elementBounds(line), [10, 20, 110, 20]);
  // rotated 90deg about the local center (60,20): vertical segment
  nearAll(elementBounds({ ...line, angle: Math.PI / 2 }), [60, -30, 60, 70]);
  nearAll(elementBounds({ type: "freedraw", x: 0, y: 0, angle: 0, points: [[0, 0], [5, -3], [10, 4]] }), [0, -3, 10, 4]);
  nearAll(elementBounds({ type: "arrow", x: 5, y: 5, width: 0, height: 0, angle: 0, points: [] }), [5, 5, 5, 5]);
});

test("elementBounds: curved arrow is at least the straight bbox and bows out", () => {
  const points = [[0, 0], [50, 100], [100, 0]];
  const straight = elementBounds({ type: "arrow", x: 0, y: 0, angle: 0, points, roundness: null });
  const curved = elementBounds({ type: "arrow", x: 0, y: 0, angle: 0, points, roundness: { type: 2 } });
  assert.ok(curved[0] <= straight[0] && curved[1] <= straight[1] && curved[2] >= straight[2] && curved[3] >= straight[3]);
  // 4 points with an overshooting middle: strictly larger on some side
  const pts4 = [[0, 0], [40, 80], [80, -20], [120, 60]];
  const s4 = elementBounds({ type: "line", x: 0, y: 0, angle: 0, points: pts4, roundness: null });
  const c4 = elementBounds({ type: "line", x: 0, y: 0, angle: 0, points: pts4, roundness: { type: 2 } });
  assert.ok(c4[0] <= s4[0] && c4[1] <= s4[1] && c4[2] >= s4[2] && c4[3] >= s4[3]);
  assert.ok(c4[1] < s4[1] || c4[3] > s4[3] || c4[0] < s4[0] || c4[2] > s4[2]);
  // elbowed arrows stay polyline, 2 points stay straight
  assert.deepEqual(elementBounds({ type: "arrow", x: 0, y: 0, angle: 0, points, roundness: { type: 2 }, elbowed: true }), straight);
  const two = [[0, 0], [30, 40]];
  assert.deepEqual(elementBounds({ type: "arrow", x: 0, y: 0, angle: 0, points: two, roundness: { type: 2 } }), [0, 0, 30, 40]);
});

test("elementBounds: unknown types fall back to rotated corners", () => {
  nearAll(elementBounds({ type: "blob", x: 100, y: 100, width: 100, height: 50, angle: Math.PI / 2 }), [125, 75, 175, 175]);
  nearAll(elementBounds({ type: "frame", x: 1, y: 2, width: 3, height: 4 }), [1, 2, 4, 6]);
});

test("fitZoom centers the bbox and clamps zoom", () => {
  const bbox = [100, 100, 300, 200];
  const r = fitZoom({ bbox, viewportWidth: 1000, viewportHeight: 800 });
  near(r.zoom, Math.min(1000 * 0.76 / 200, 800 * 0.76 / 100));
  near((200 + r.scrollX) * r.zoom, 500);
  near((150 + r.scrollY) * r.zoom, 400);
  assert.equal(fitZoom({ bbox: [0, 0, 1, 1], viewportWidth: 1000, viewportHeight: 800 }).zoom, 4);
  assert.equal(fitZoom({ bbox: [0, 0, 1e6, 1e6], viewportWidth: 100, viewportHeight: 100 }).zoom, 0.1);
  assert.ok(Number.isFinite(fitZoom({ bbox: [5, 5, 5, 5], viewportWidth: 100, viewportHeight: 100 }).zoom));
});

test("scene/viewport transforms invert each other", () => {
  const appState = { zoom: { value: 2 }, scrollX: -30, scrollY: 10, offsetLeft: 5, offsetTop: 7 };
  assert.deepEqual(sceneToViewport({ x: 40, y: 50, appState }), { x: (40 - 30) * 2 + 5, y: (50 + 10) * 2 + 7 });
  const v = sceneToViewport({ x: 40, y: 50, appState });
  const s = viewportToScene({ ...v, appState });
  near(s.x, 40); near(s.y, 50);
  assert.deepEqual(sceneToViewport({ x: 1, y: 2, appState: {} }), { x: 1, y: 2 });
});

test("rectToFraction intersects, normalizes and clips", () => {
  const img = { left: 100, top: 100, width: 200, height: 100 };
  assert.deepEqual(rectToFraction({ left: 150, top: 125, width: 100, height: 50 }, img), [0.25, 0.25, 0.5, 0.5]);
  // hangs off the top-left and right edges
  assert.deepEqual(rectToFraction({ left: 50, top: 50, width: 150, height: 100 }, img), [0, 0, 0.5, 0.5]);
  assert.deepEqual(rectToFraction({ left: 200, top: 100, width: 500, height: 100 }, img), [0.5, 0, 0.5, 1]);
  // too small or outside
  assert.equal(rectToFraction({ left: 150, top: 150, width: 3, height: 50 }, img), null);
  assert.equal(rectToFraction({ left: 150, top: 150, width: 50, height: 3.9 }, img), null);
  assert.equal(rectToFraction({ left: 0, top: 0, width: 50, height: 50 }, img), null);
  assert.equal(rectToFraction({ left: 0, top: 0, width: 50, height: 50 }, { left: 0, top: 0, width: 0, height: 0 }), null);
});

const ROOT = '<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 180" width="260" height="180">';
const svgDoc = `${ROOT}<style>.a{stroke-width:2}</style><g transform="translate(10 10)"><rect width="240" height="160"/></g></svg>`;

test("cropSvgToFraction rewrites only the root tag", () => {
  const out = cropSvgToFraction(svgDoc, [0, 0, 0.5, 0.5]);
  assert.ok(out.startsWith('<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="10 10 120 80" width="120" height="80">'));
  assert.equal(out.slice(out.indexOf(">") + 1), svgDoc.slice(svgDoc.indexOf(">") + 1));
});

test("cropSvgToFraction offsets and uses the given pad", () => {
  const out = cropSvgToFraction(svgDoc, [0.25, 0.5, 0.5, 0.25]);
  assert.match(out, /viewBox="70 90 120 40" width="120" height="40"/);
  const out0 = cropSvgToFraction('<svg viewBox="0 0 200 100" width="200" height="100">x</svg>', [0.5, 0, 0.5, 1], 0);
  assert.match(out0, /viewBox="100 0 100 100" width="100" height="100"/);
});

test("cropSvgToFraction scales width/height with an existing ratio and adds missing attrs", () => {
  const out = cropSvgToFraction('<svg viewBox="0 0 220 120" width="440" height="240"></svg>', [0, 0, 1, 0.5]);
  assert.match(out, /viewBox="10 10 200 50" width="400" height="100"/);
  const bare = cropSvgToFraction('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 120"></svg>', [0, 0, 1, 1]);
  assert.match(bare, /viewBox="10 10 200 100"/);
  assert.match(bare, /width="200"/);
  assert.match(bare, /height="100"/);
});

test("cropSvgToFraction rejects bad input", () => {
  assert.throws(() => cropSvgToFraction("<div/>", [0, 0, 1, 1]), TypeError);
  assert.throws(() => cropSvgToFraction("<svg></svg>", [0, 0, 1, 1]), TypeError);
  assert.throws(() => cropSvgToFraction(svgDoc, [0, 0, 0, 1]), TypeError);
});

test("normalizeSvgSize sets width/height from the viewBox, rounded to 2 decimals, touching only the root tag", () => {
  const out = normalizeSvgSize('<svg xmlns="x" viewBox="10 20 180 120.456" width="540" height="361.37"><rect width="9"/></svg>');
  assert.equal(out, '<svg xmlns="x" viewBox="10 20 180 120.456" width="180" height="120.46"><rect width="9"/></svg>');
  assert.equal(normalizeSvgSize('<svg viewBox="0 0 100 100"></svg>'), '<svg viewBox="0 0 100 100" width="100" height="100"></svg>');
  assert.equal(normalizeSvgSize("<svg></svg>"), "<svg></svg>");
});

test("cropSvgToFraction viewBox is independent of an exportScale-inflated width/height", () => {
  const scaled = '<svg viewBox="0 0 260 180" width="780" height="540"><g/></svg>';
  const plain = '<svg viewBox="0 0 260 180" width="260" height="180"><g/></svg>';
  const vb = (s) => /viewBox="([^"]+)"/.exec(s)[1];
  assert.equal(vb(cropSvgToFraction(scaled, [0.25, 0.5, 0.5, 0.25])), vb(cropSvgToFraction(plain, [0.25, 0.5, 0.5, 0.25])));
  assert.match(normalizeSvgSize(cropSvgToFraction(scaled, [0, 0, 0.5, 0.5])), /viewBox="10 10 120 80" width="120" height="80"/);
});

const tri = "0.1,0.2,0.9,0.2,0.5,0.8".split(",").map(Number);

test("regionSceneBBox group: union of members + pad, ignores deleted", () => {
  const els = [
    rect("a", 100, 100, 50, 50, { groupIds: ["g1"] }),
    rect("b", 300, 200, 100, 40, { groupIds: ["g0", "g1"] }),
    rect("c", 900, 900, 10, 10, { groupIds: ["g1"], isDeleted: true }),
    rect("d", 500, 500, 10, 10, { groupIds: ["g2"] }),
  ];
  assert.deepEqual(regionSceneBBox({ kind: "group", groupId: "g1", pad: 10 }, els).bbox, [90, 90, 410, 250]);
  assert.deepEqual(regionSceneBBox({ kind: "group", groupId: "g1", pad: 0 }, els).bbox, [100, 100, 400, 240]);
  assert.equal(regionSceneBBox({ kind: "group", groupId: "nope", pad: 0 }, els).error, "no-elements");
});

test("regionSceneBBox frame adds pad, cframe is exact", () => {
  const els = [
    { id: "fr", type: "frame", x: 50, y: 60, width: 400, height: 300, angle: 0, name: "F" },
    rect("child", 80, 90, 100, 100, { frameId: "fr" }),
    rect("plain", 0, 0, 5, 5),
  ];
  assert.deepEqual(regionSceneBBox({ kind: "frame", frameId: "fr", pad: 10 }, els, { frameRendering: { name: false } }).bbox, [40, 50, 460, 370]);
  assert.deepEqual(regionSceneBBox({ kind: "frame", frameId: "fr", pad: 10 }, els, {}).bbox, [40, 29.5, 460, 370]);
  assert.deepEqual(regionSceneBBox({ kind: "cframe", frameId: "fr" }, els, {}).bbox, [50, 60, 450, 360]);
  assert.equal(regionSceneBBox({ kind: "cframe", frameId: "plain" }, els).error, "not-frame");
  assert.equal(regionSceneBBox({ kind: "cframe", frameId: "zzz" }, els).error, "no-elements");
});

test("regionSceneBBox poly: polygon bbox inside the image element", () => {
  const els = [{ id: "img", type: "image", x: 100, y: 200, width: 400, height: 200, angle: 0 }];
  const { bbox } = regionSceneBBox({ kind: "poly", el: "img", p: tri }, els);
  nearAll(bbox, [140, 240, 460, 360], 1);
  assert.equal(regionSceneBBox({ kind: "poly", el: "img", p: tri }, [{ ...els[0], angle: 0.3 }]).error, "rotated-image");
  assert.equal(regionSceneBBox({ kind: "poly", el: "r", p: tri }, [rect("r", 0, 0, 1, 1)]).error, "not-image");
  assert.equal(regionSceneBBox({ kind: "poly", el: "img", p: [0, 0, 1, 0, 0.5, 0] }, els).error, "no-elements");
});

test("regionSceneBBox: imgrect/imgpoly have no scene geometry", () => {
  assert.equal(regionSceneBBox({ kind: "imgrect", i: 0, f: [0, 0, 1, 1] }, fixture()).error, "unsupported-kind");
  assert.equal(regionSceneBBox({ kind: "imgpoly", i: 0, p: tri }, fixture()).error, "unsupported-kind");
});

const frameFixture = (frameY = 100) => [
  rect("a", 100, 100, 200, 100),
  rect("b", 300, 370, 100, 100),
  { id: "fr", type: "frame", x: 700, y: frameY, width: 300, height: 220, angle: 0, name: "Frame A" },
];

test("exportBounds: frame label extends the top, PNG predicts 920x410 and passes the guard", () => {
  const els = frameFixture();
  assert.deepEqual(commonBounds(els), [100, 100, 1000, 470]);
  assert.deepEqual(exportBounds(els, {}), [100, 79.5, 1000, 470]);
  const r = viewPngCropRect({ elements: els, appState: {}, bbox: [100, 100, 300, 200], naturalWidth: 920, naturalHeight: 410 });
  assert.ok(!r.error, JSON.stringify(r));
  assert.equal(viewPngCropRect({ elements: els, appState: {}, bbox: [100, 100, 300, 200], naturalWidth: 920, naturalHeight: 390 }).error, "bounds-mismatch");
});

test("exportBounds: a frame away from the top boundary does not change the bounds", () => {
  const els = frameFixture(200);
  assert.deepEqual(exportBounds(els, {}), commonBounds(els));
});

test("exportBounds: frameRendering.name false adds no label", () => {
  const els = frameFixture();
  assert.deepEqual(exportBounds(els, { frameRendering: { name: false } }), commonBounds(els));
  assert.deepEqual(exportBounds([], {}), null);
});

import { naturalToScene, sceneToNatural } from "../src/model/scene.js";

const cropImg = () => ({
  id: "ci", type: "image", x: 120, y: 300, width: 240, height: 160, angle: 0,
  crop: { x: 30, y: 20, width: 60, height: 40, naturalWidth: 120, naturalHeight: 80 },
});

test("crop mapping: contract fixture numbers", () => {
  const img = cropImg();
  nearAll(regionSceneBBox({ kind: "rect", el: "ci", f: [0.25, 0.25, 0.5, 0.5] }, [img]).bbox, [120, 300, 360, 460], 0.5);
  nearAll(regionSceneBBox({ kind: "rect", el: "ci", f: [0.125, 0.1875, 0.4167, 0.625] }, [img]).bbox, [120, 300, 260, 460], 0.5);
  assert.equal(regionSceneBBox({ kind: "rect", el: "ci", f: [0, 0, 0.2, 0.5] }, [img]).error, "outside-crop");
  assert.equal(regionSceneBBox({ kind: "rect", el: "ci", f: [0.8, 0, 0.2, 0.5] }, [img]).error, "outside-crop");
  const poly = regionSceneBBox({ kind: "poly", el: "ci", p: [0.25, 0.25, 0.75, 0.25, 0.5, 0.75] }, [img]);
  nearAll(poly.bbox, [120, 300, 360, 460], 0.5);
  assert.equal(regionSceneBBox({ kind: "poly", el: "ci", p: [0, 0, 0.1, 0, 0.05, 0.1] }, [img]).error, "outside-crop");
});

test("naturalToScene / sceneToNatural invert each other and are identity without crop", () => {
  const img = cropImg();
  nearAll(naturalToScene(img, [0.25, 0.25]), [120, 300]);
  nearAll(naturalToScene(img, [0.75, 0.75]), [360, 460]);
  nearAll(sceneToNatural(img, [120, 300]), [0.25, 0.25]);
  nearAll(sceneToNatural(img, naturalToScene(img, [0.6, 0.4])), [0.6, 0.4]);
  const plain = { x: 10, y: 20, width: 100, height: 50 };
  nearAll(naturalToScene(plain, [0.5, 0.5]), [60, 45]);
  nearAll(sceneToNatural(plain, [60, 45]), [0.5, 0.5]);
  const nul = { ...plain, crop: null };
  nearAll(naturalToScene(nul, [0.5, 1]), [60, 70]);
});

test("crop == null keeps rect/poly identical", () => {
  const img = { id: "p", type: "image", x: 10, y: 20, width: 200, height: 100, angle: 0, crop: null };
  nearAll(regionSceneBBox({ kind: "rect", el: "p", f: [0.25, 0.5, 0.5, 0.25] }, [img]).bbox, [60, 70, 160, 95]);
  nearAll(regionSceneBBox({ kind: "poly", el: "p", p: [0.2, 0.2, 0.6, 0.2, 0.4, 0.8] }, [img]).bbox, [50, 40, 130, 100]);
});

test("regionSceneBBox with a shared index matches the unindexed result for every kind", () => {
  const img = { id: "img", type: "image", x: 10, y: 20, width: 200, height: 100, angle: 0, isDeleted: false };
  const els = [
    { id: "a", type: "rectangle", x: 0, y: 0, width: 50, height: 50, angle: 0, isDeleted: false, groupIds: ["g1"] },
    { id: "b", type: "rectangle", x: 100, y: 100, width: 50, height: 50, angle: 0, isDeleted: false, groupIds: ["g1", "g2"] },
    { id: "dead", type: "rectangle", x: 900, y: 900, width: 5, height: 5, angle: 0, isDeleted: true },
    { id: "frm", type: "frame", name: "F", x: 0, y: 0, width: 300, height: 200, angle: 0, isDeleted: false },
    { id: "txt", type: "text", x: 0, y: 0, width: 5, height: 5, angle: 0, isDeleted: false },
    img,
  ];
  const live = els.filter((e) => !e.isDeleted);
  const index = { live, byId: new Map(live.map((e) => [e.id, e])) };
  const regions = [
    { kind: "area", ids: ["a", "b", "nope"], pad: 5 },
    { kind: "area", ids: ["nope"] },
    { kind: "rect", el: "img", f: [0.1, 0.1, 0.5, 0.5] },
    { kind: "rect", el: "a", f: [0, 0, 1, 1] },
    { kind: "rect", el: "nope", f: [0, 0, 1, 1] },
    { kind: "poly", el: "img", p: [0, 0, 1, 0, 1, 1] },
    { kind: "group", groupId: "g1", pad: 2 },
    { kind: "group", groupId: "g2" },
    { kind: "group", groupId: "zzz" },
    { kind: "frame", frameId: "frm", pad: 4 },
    { kind: "cframe", frameId: "frm" },
    { kind: "cframe", frameId: "txt" },
    { kind: "cframe", frameId: "nope" },
    { kind: "imgrect", el: "img" },
  ];
  for (const region of regions) {
    assert.deepEqual(regionSceneBBox(region, els, {}, index), regionSceneBBox(region, els, {}), JSON.stringify(region));
  }
  assert.ok(index.byGroup instanceof Map);
});
