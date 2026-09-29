import test from "node:test";
import assert from "node:assert/strict";
import {
  parseImageRefs, imageCropRect, polyBBox, normalizePoly, polyToLocal, clipSvgToPolygon, thumbnailSize,
} from "../src/model/image.js";

test("parseImageRefs finds images in order with alt and url", () => {
  const s = "a ![one](https://x.test/a.png) b ![](https://x.test/b.jpg \"title\") c [link](https://x.test) ![](u3)";
  assert.deepEqual(parseImageRefs(s), [
    { alt: "one", url: "https://x.test/a.png", index: 0 },
    { alt: "", url: "https://x.test/b.jpg", index: 1 },
    { alt: "", url: "u3", index: 2 },
  ]);
});

test("parseImageRefs skips code spans and fences and re-indexes", () => {
  const s = "`![no](c1)` ![yes](u1)\n```\n![no](c2)\n```\n``![no](c3)`` ![yes2](u2)";
  assert.deepEqual(parseImageRefs(s).map((r) => [r.url, r.index]), [["u1", 0], ["u2", 1]]);
  assert.deepEqual(parseImageRefs("```\n![x](u)"), []);
});

test("parseImageRefs edge cases", () => {
  assert.deepEqual(parseImageRefs(""), []);
  assert.deepEqual(parseImageRefs(null), []);
  assert.deepEqual(parseImageRefs("![broken](  )"), []);
  assert.deepEqual(parseImageRefs("plain text [x](y)"), []);
});

test("imageCropRect maps fractions to pixels within 1 px and clamps", () => {
  assert.deepEqual(imageCropRect({ naturalWidth: 800, naturalHeight: 600, f: [0.25, 0.5, 0.5, 0.25] }), { sx: 200, sy: 300, sw: 400, sh: 150 });
  assert.deepEqual(imageCropRect({ naturalWidth: 100, naturalHeight: 100, f: [0.999, 0.999, 0.001, 0.001] }), { sx: 99, sy: 99, sw: 1, sh: 1 });
  const r = imageCropRect({ naturalWidth: 1000, naturalHeight: 500, f: [0, 0, 1, 1] });
  assert.deepEqual(r, { sx: 0, sy: 0, sw: 1000, sh: 500 });
  assert.equal(imageCropRect({ naturalWidth: 0, naturalHeight: 10, f: [0, 0, 1, 1] }), null);
  assert.equal(imageCropRect({ naturalWidth: 10, naturalHeight: 10, f: [0, 0, 0, 1] }), null);
});

test("polyBBox and polyToLocal", () => {
  const p = [0.1, 0.2, 0.9, 0.2, 0.5, 0.8];
  const bb = polyBBox(p);
  assert.deepEqual(bb, [0.1, 0.2, 0.8, 0.6]);
  assert.deepEqual(polyToLocal(p, bb), [0, 0, 1, 0, 0.5, 1]);
  assert.equal(polyBBox([0, 0, 1, 0, 0.5, 0]), null);
  assert.equal(polyBBox([0, 0, 1, 1]), null);
  assert.equal(polyToLocal([0, 0, 1, 1], [0, 0, 1, 1]), null);
});

test("normalizePoly clamps, rounds, and enforces >=3 points", () => {
  assert.deepEqual(normalizePoly([-1, 0.33333, 2, 0.5, 0.5, 0.5]), [0, 0.3333, 1, 0.5, 0.5, 0.5]);
  assert.equal(normalizePoly([0, 0, 1, 1]), null);
  assert.equal(normalizePoly([0, 0, 1, NaN, 1, 1]), null);
  assert.equal(normalizePoly("x"), null);
});

const ROOT = '<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100"><defs><style>a{}</style></defs><rect width="200" height="100"/></svg>';

test("clipSvgToPolygon on a realistic root tag", () => {
  const out = clipSvgToPolygon(ROOT, [0, 0, 1, 0, 0.5, 1]);
  const id = /clipPath id="(plexus-clip-[0-9a-f]{8})"/.exec(out)[1];
  assert.ok(out.startsWith('<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100"><defs><clipPath'));
  assert.ok(out.includes('<polygon points="0,0 200,0 100,100"/>'));
  assert.ok(out.includes(`<g clip-path="url(#${id})"><defs><style>a{}</style></defs><rect width="200" height="100"/></g></svg>`));
  assert.equal(out, clipSvgToPolygon(ROOT, [0, 0, 1, 0, 0.5, 1]));
  assert.notEqual(out, clipSvgToPolygon(ROOT, [0, 0, 1, 0, 0.4, 1]));
});

test("clipSvgToPolygon honors viewBox origin, falls back to width/height, and rejects bad input", () => {
  const off = '<svg viewBox="-10 20 100 50" width="100" height="50"><g/></svg>\n';
  assert.ok(clipSvgToPolygon(off, [0, 0, 1, 0, 1, 1]).includes('points="-10,20 90,20 90,70"'));
  const nb = '<svg width="80" height="40"><g/></svg>';
  assert.ok(clipSvgToPolygon(nb, [0, 0, 1, 0, 1, 1]).includes('points="0,0 80,0 80,40"'));
  assert.throws(() => clipSvgToPolygon("<div/>", [0, 0, 1, 0, 1, 1]), TypeError);
  assert.throws(() => clipSvgToPolygon(ROOT, [0, 0, 1, 1]), TypeError);
  assert.throws(() => clipSvgToPolygon("<svg><g/></svg>", [0, 0, 1, 0, 1, 1]), TypeError);
});

test("thumbnailSize scales down only", () => {
  assert.deepEqual(thumbnailSize({ width: 960, height: 480, maxWidth: 480 }), { width: 480, height: 240 });
  assert.deepEqual(thumbnailSize({ width: 300, height: 100, maxWidth: 480 }), { width: 300, height: 100 });
  assert.deepEqual(thumbnailSize({ width: 1000, height: 1, maxWidth: 10 }), { width: 10, height: 1 });
  assert.deepEqual(thumbnailSize({ width: 0, height: 5, maxWidth: 10 }), { width: 1, height: 1 });
});
