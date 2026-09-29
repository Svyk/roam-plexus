import assert from "node:assert/strict";
import test from "node:test";

import { createActions, cropToFraction } from "../src/actions.js";
import { parseRegion } from "../src/model/region.js";
import { regionSceneBBox } from "../src/model/scene.js";
import { displayedPoly, displayedRect, displayedToNatural } from "../src/view/regionref.js";

const crop = { x: 30, y: 20, width: 60, height: 40, naturalWidth: 120, naturalHeight: 80 };
const img = { id: "img-a", type: "image", x: 120, y: 300, width: 240, height: 160, angle: 0, isDeleted: false, crop };
const svg = '<svg viewBox="0 0 240 160" width="240" height="160"></svg>';

function frame(id, name, y) {
  return { id, type: "frame", name, x: 0, y, width: 100, height: 60, angle: 0, isDeleted: false };
}

function make(over = {}) {
  const toasts = [];
  const created = [];
  const puts = [];
  const opened = [];
  const setSlides = [];
  const captures = [];
  const inserted = [];
  const elements = over.elements || [];
  const app = { state: { width: 1000, height: 600, scrollX: 0, scrollY: 0, zoom: { value: 1 } }, getSceneElements: () => elements };
  const editor = over.editor === undefined ? { app, drawingUid: "drw000001" } : over.editor;
  const store = new Map();
  const presenter = {
    open: (o) => { opened.push(o); return { isOpen: () => true, setSlide: (i, p) => setSlides.push([i, p.url]) }; },
  };
  const actions = createActions({
    host: {
      createRegion: async (d, s) => { created.push([d, s]); return "reg000001"; },
      drawing: () => ({ hash: "h1", elements: over.savedElements || elements, appState: {} }),
      pullEmbedContent: over.pull || (async () => ({ kind: "block", uid: "abcdefghi", title: "P", string: "hello [[x]]" })),
    },
    native: {
      activeEditor: () => editor,
      selectedElementIds: () => over.ids || [],
      captureSelectionSvg: async (a, ids) => { captures.push(ids[0]); return svg; },
      readClipboardText: async () => over.clip ?? null,
      insertElements: (a, els, o) => { inserted.push([els, o]); return true; },
    },
    cache: {
      put: async (k, b, d) => { puts.push(k); store.set(k, { url: `blob:${k}` }); },
      peek: (k) => store.get(k) || null,
      get: async (k) => store.get(k) || null,
    },
    cold: {},
    toaster: { show: (m, o) => toasts.push([m, o]) },
    spotlight: () => {},
    getSettings: () => ({}),
    doc: {},
    clipboard: { writeText: async () => {} },
    presenter,
  });
  return { actions, toasts, created, puts, opened, setSlides, captures, inserted, store };
}

test("cropToFraction and regionFromCrop use natural fractions", async () => {
  assert.deepEqual(cropToFraction(crop), [0.25, 0.25, 0.5, 0.5]);
  const t = make({ elements: [img], ids: ["img-a"] });
  assert.equal(t.actions.hasCroppedImageSelected(), true);
  await t.actions.regionFromCrop();
  const region = parseRegion(t.created[0][1]);
  assert.equal(region.kind, "rect");
  assert.deepEqual(region.f, [0.25, 0.25, 0.5, 0.5]);
  assert.equal(region.caption, "Image crop");
});

test("regionFromCrop toasts for an uncropped image", async () => {
  const t = make({ elements: [{ ...img, crop: null }], ids: ["img-a"] });
  assert.equal(t.actions.hasCroppedImageSelected(), false);
  assert.equal(await t.actions.regionFromCrop(), null);
  assert.equal(t.created.length, 0);
});

test("crop mapping fixtures", () => {
  const whole = displayedRect(img, [0.25, 0.25, 0.5, 0.5]);
  assert.deepEqual(whole.map((v) => Math.round(v * 1e6) / 1e6), [0, 0, 1, 1]);
  const part = displayedRect(img, [0.125, 0.1875, 0.4167, 0.625]);
  assert.ok(Math.abs(part[2] * 240 - 140) < 0.5 && part[0] === 0 && part[3] === 1);
  assert.equal(displayedRect(img, [0, 0, 0.1, 0.1]), null);
  assert.deepEqual(displayedRect({ ...img, crop: null }, [0.1, 0.2, 0.3, 0.4]), [0.1, 0.2, 0.3, 0.4]);
  assert.equal(displayedPoly(img, [0, 0, 0.1, 0, 0.1, 0.1]), null);
  const nat = displayedToNatural(img, [0, 0, 1, 1]);
  assert.deepEqual(nat.map((v) => Math.round(v * 1e6) / 1e6), [0.25, 0.25, 0.5, 0.5]);
});

test("presentDrawing with no frames toasts and never opens the presenter", async () => {
  const t = make({ elements: [img] });
  assert.equal(await t.actions.presentDrawing({ drawingUid: "drw000001" }), null);
  assert.equal(t.toasts.at(-1)[0], "No frames in this drawing");
  assert.equal(t.opened.length, 0);
});

test("hot presentDrawing opens in frame order, then fills captured slides sequentially", async () => {
  const elements = [frame("f-b", "10 End", 0), frame("f-a", "2 Intro", 100)];
  const t = make({ elements });
  assert.equal(await t.actions.presentDrawing({ drawingUid: "drw000001" }), "drw000001");
  assert.deepEqual(t.opened[0].slides.map((s) => s.name), ["2 Intro", "10 End"]);
  assert.deepEqual(t.opened[0].slides.map((s) => s.url), [null, null]);
  assert.deepEqual(t.captures, ["f-a", "f-b"]);
  assert.deepEqual(t.setSlides.map(([i]) => i), [0, 1]);
  assert.equal(t.puts.length, 2);
  // cached the second time: opens with urls and captures nothing
  const before = t.captures.length;
  await t.actions.presentDrawing({ drawingUid: "drw000001" });
  assert.equal(t.captures.length, before);
  assert.ok(t.opened[1].slides.every((s) => s.url));
});

test("insertEmbedFromClipboard: parse, resolve, insert centered, toast", async () => {
  const t = make({ clip: "((abcdefghi))" });
  const id = await t.actions.insertEmbedFromClipboard();
  assert.ok(id);
  const [els, opts] = t.inserted[0];
  assert.equal(opts.select, true);
  assert.equal(els[0].customData.plexus.embed, "((abcdefghi))");
  assert.equal(els[0].x + els[0].width / 2, 500);
  assert.equal(els[0].y + els[0].height / 2, 300);
  assert.equal(t.toasts.at(-1)[0], "Embedded hello x");
});

test("insertEmbedFromClipboard toasts a hint on junk and an error on an unresolved ref", async () => {
  const junk = make({ clip: "hello" });
  assert.equal(await junk.actions.insertEmbedFromClipboard(), null);
  assert.match(junk.toasts.at(-1)[0], /^Copy a block ref first/);
  assert.equal(junk.inserted.length, 0);
  const miss = make({ clip: "((abcdefghi))", pull: async () => null });
  assert.equal(await miss.actions.insertEmbedFromClipboard(), null);
  assert.equal(miss.toasts.at(-1)[1].kind, "error");
  assert.equal(miss.inserted.length, 0);
});

test("displayedPoly clips to the crop box instead of clamping vertices", () => {
  const q = displayedPoly(img, [0.1, 0.5, 0.6, 0.3, 0.6, 0.7]);
  const pts = [];
  for (let i = 0; i < q.length; i += 2) pts.push([Math.round(q[i] * 1e4) / 1e4, Math.round(q[i + 1] * 1e4) / 1e4]);
  assert.equal(pts.length, 4);
  for (const want of [[0, 0.38], [0.7, 0.1], [0.7, 0.9], [0, 0.62]]) {
    assert.ok(pts.some(([x, y]) => Math.abs(x - want[0]) < 1e-3 && Math.abs(y - want[1]) < 1e-3), `missing ${want}`);
  }
});

test("a poly whose bbox overlaps the crop but whose shape does not is outside-crop", () => {
  const p = [0.9, 0.6, 0.9, 0.9, 0.6, 0.9];
  assert.equal(displayedPoly(img, p), null);
  const box = regionSceneBBox({ kind: "poly", el: "img-a", p }, [img], {});
  assert.equal(box.error, "outside-crop");
});

test("displayedToNatural and cropToFraction use an asymmetric crop", () => {
  const c2 = { x: 30, y: 10, width: 60, height: 40, naturalWidth: 120, naturalHeight: 80 };
  const el = { ...img, crop: c2 };
  assert.deepEqual(cropToFraction(c2), [0.25, 0.125, 0.5, 0.5]);
  const r = displayedToNatural(el, [0.5, 0.25, 0.25, 0.5]);
  [0.5, 0.25, 0.125, 0.25].forEach((v, i) => assert.ok(Math.abs(r[i] - v) < 1e-9, `rect[${i}]=${r[i]}`));
  const poly = displayedToNatural(el, { p: [0.5, 0.25, 1, 0.25, 1, 1] }).p;
  [0.5, 0.25, 0.75, 0.25, 0.75, 0.625].forEach((v, i) => assert.ok(Math.abs(poly[i] - v) < 1e-9, `poly[${i}]=${poly[i]}`));
});

test("slide cache keys follow the live scene when mounted", async () => {
  const elements = [frame("f-a", "1", 0)];
  const t = make({ elements });
  await t.actions.presentDrawing({ drawingUid: "drw000001" });
  elements.push({ ...frame("f-a", "1", 0), name: "edited" });
  elements.pop();
  elements[0] = { ...elements[0], name: "edited" };
  await t.actions.presentDrawing({ drawingUid: "drw000001" });
  assert.equal(t.captures.length, 2);
});

test("clipboard denial toasts the real cause", async () => {
  const toasts = [];
  const elements = [];
  const app = { state: {}, getSceneElements: () => elements };
  const actions = createActions({
    host: {}, native: {
      activeEditor: () => ({ app, drawingUid: "drw000001" }),
      readClipboardText: async () => { throw new Error("denied"); },
    },
    cache: {}, cold: {}, toaster: { show: (m) => toasts.push(m) }, spotlight: () => {}, getSettings: () => ({}), doc: {}, clipboard: {},
  });
  assert.equal(await actions.insertEmbedFromClipboard(), null);
  assert.match(toasts[0], /Clipboard access was blocked/);
});
