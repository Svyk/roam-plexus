import assert from "node:assert/strict";
import test from "node:test";

import { thumbKey } from "../src/host/cache.js";
import { viewportRectOf } from "../src/host/native.js";
import { DRAWING_GALLERY_QUERY, attachThumbs, galleryRows, readDrawingRows, withHashes } from "../src/model/drawings.js";
import { frameRows } from "../src/model/frames.js";
import { openDrawingGallery } from "../src/view/drawing-gallery.js";
import { openFrameList } from "../src/view/frame-list.js";

function fakeNode(tag = "div") {
  return {
    tag,
    children: [],
    listeners: {},
    className: "",
    style: {},
    textContent: "",
    src: "",
    alt: "",
    type: "",
    attrs: {},
    parentNode: null,
    setAttribute(k, v) { this.attrs[k] = String(v); },
    append(...cs) {
      for (const c of cs) {
        c.parentNode = this;
        this.children.push(c);
      }
    },
    remove() {
      const p = this.parentNode;
      if (!p) return;
      p.children = p.children.filter((x) => x !== this);
      this.parentNode = null;
    },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); },
    fire(type, event = {}) {
      const ev = { preventDefault() {}, stopPropagation() {}, target: this, ...event };
      for (const fn of [...(this.listeners[type] || [])]) fn(ev);
      return ev;
    },
    contains(other) {
      if (other === this) return true;
      return this.children.some((c) => c.contains?.(other));
    },
  };
}

function fakeDoc() {
  const body = fakeNode("body");
  const doc = fakeNode("doc");
  doc.body = body;
  doc.createElement = (tag) => fakeNode(tag);
  return doc;
}

function walk(node, acc = []) {
  acc.push(node);
  for (const child of node.children || []) walk(child, acc);
  return acc;
}

test("readDrawingRows asks once and maps uid, edit time, and page title", () => {
  const seen = [];
  const api = {
    q(query) {
      seen.push(query);
      return [["abc", 12, "Alpha"], ["def", null, null]];
    },
  };
  assert.deepEqual(readDrawingRows(api), [
    { uid: "abc", editTime: 12, pageTitle: "Alpha" },
    { uid: "def", editTime: 0, pageTitle: "" },
  ]);
  assert.deepEqual(seen, [DRAWING_GALLERY_QUERY]);
});

test("galleryRows keeps forty newest drawings and numbers a repeated page title", () => {
  const many = Array.from({ length: 41 }, (_, i) => ({ uid: String(i).padStart(2, "0"), editTime: i, pageTitle: "P" }));
  const capped = galleryRows(many);
  assert.equal(capped.length, 40);
  assert.equal(capped[0].uid, "40");
  assert.equal(capped[0].label, "P");
  assert.equal(capped[1].label, "P 2");
  assert.equal(capped.some((row) => row.uid === "00"), false);

  const labeled = galleryRows([
    { uid: "b", editTime: 2, pageTitle: "Same" },
    { uid: "a", editTime: 2, pageTitle: "Same" },
    { uid: "c", editTime: 1, pageTitle: "" },
    { uid: "d", editTime: 1, pageTitle: "  " },
  ]);
  assert.deepEqual(labeled.map((row) => row.label), ["Same", "Same 2", "Drawing", "Drawing 2"]);
  assert.deepEqual(labeled.map((row) => row.uid), ["a", "b", "c", "d"]);
});

test("attachThumbs looks up the crop key only when a row has a hash", async () => {
  const rows = withHashes(
    [{ uid: "hit", label: "Hit" }, { uid: "miss", label: "Miss" }, { uid: "blank", label: "Blank" }],
    (uid) => (uid === "hit" ? "h1" : uid === "miss" ? "h2" : ""),
  );
  const keys = [];
  const out = await attachThumbs(rows, {
    lookup(key) {
      keys.push(key);
      return key.endsWith("|h1|160|png") ? { url: "blob:hit" } : null;
    },
  });
  assert.deepEqual(keys, [
    thumbKey({ uid: "hit", hash: "h1", maxWidth: 160 }),
    thumbKey({ uid: "miss", hash: "h2", maxWidth: 160 }),
  ]);
  assert.equal(out[0].thumb, "blob:hit");
  assert.equal(out[1].thumb, null);
  assert.equal(out[2].thumb, null);
});

test("frameRows lists live frames and leaves the scene elements alone", () => {
  const elements = [
    { id: "r", type: "rectangle", name: "no" },
    { id: "m", type: "magicframe", name: "Magic" },
    { id: "d", type: "frame", isDeleted: true, name: "Gone", x: 1, y: 1, width: 1, height: 1 },
    { id: "f", type: "frame", name: "  One  ", x: 3, y: 4, width: 5, height: 6, opacity: 100 },
    { id: "g", type: "frame", name: "  ", x: 0, y: 0, width: 1, height: 1, opacity: 100 },
  ];
  const before = JSON.stringify(elements);
  assert.deepEqual(frameRows(elements), [
    { id: "f", label: "One", x: 3, y: 4, width: 5, height: 6 },
    { id: "g", label: "Frame 2", x: 0, y: 0, width: 1, height: 1 },
  ]);
  assert.equal(JSON.stringify(elements), before);
  const many = Array.from({ length: 41 }, (_, i) => ({ id: `f${i}`, type: "frame", name: "", x: i, y: 0, width: 1, height: 1 }));
  const capped = frameRows(many);
  assert.equal(capped.length, 40);
  assert.equal(capped[0].label, "Frame 1");
  assert.equal(capped.some((row) => row.id === "f40"), false);
});

test("the gallery shows two rows, a cache tile, a blank miss, and opens the chosen drawing", async () => {
  const seen = [];
  const api = {
    q(query) {
      seen.push(query);
      return [
        ["older0001", 1, "Alpha"],
        ["newer0001", 5, "Beta"],
      ];
    },
  };
  const lookups = [];
  const doc = fakeDoc();
  const opened = [];
  const handle = openDrawingGallery({
    doc,
    api,
    hashOf: (uid) => (uid === "newer0001" ? "h1" : ""),
    lookup(key) {
      lookups.push(key);
      return { url: "blob:tile" };
    },
    openDrawing(uid) { opened.push(uid); },
    toast() {},
    zIndex: 3,
  });
  await handle.ready;
  assert.deepEqual(seen, [DRAWING_GALLERY_QUERY]);
  const rows = walk(doc.body).filter((node) => String(node.className).includes("plexus-gallery-row"));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].children.find((node) => node.className === "plexus-gallery-label").textContent, "Beta");
  assert.equal(rows[1].children.find((node) => node.className === "plexus-gallery-label").textContent, "Alpha");
  assert.equal(rows[0].children.find((node) => node.tag === "img").src, "blob:tile");
  assert.equal(rows[1].children.some((node) => node.className === "plexus-gallery-blank"), true);
  assert.deepEqual(lookups, [thumbKey({ uid: "newer0001", hash: "h1", maxWidth: 160 })]);
  rows[0].fire("click");
  assert.deepEqual(opened, ["newer0001"]);
});

test("hide covers a frame from viewportRectOf and does not write the scene", () => {
  const frame = { id: "f1", type: "frame", name: "One", x: 10, y: 20, width: 100, height: 50, opacity: 100, isDeleted: false };
  const before = JSON.stringify(frame);
  let updates = 0;
  let scrolled = null;
  let onScroll = null;
  const app = {
    state: { scrollX: 0, scrollY: 0, zoom: { value: 2 }, offsetLeft: 5, offsetTop: 7, viewBackgroundColor: "#ffffff", width: 800, height: 600 },
    scene: { getNonDeletedElements: () => [frame] },
    updateScene() { updates += 1; throw new Error("hide must not write the scene"); },
    scrollToContent(el) { scrolled = el; },
    onScrollChangeEmitter: { on(fn) { onScroll = fn; return () => { onScroll = null; }; } },
    onChangeEmitter: { on() { return () => {}; } },
  };
  const doc = fakeDoc();
  const container = fakeNode("div");
  const handle = openFrameList({ doc, app, container, toast() {}, zIndex: 4 });
  const hide = walk(doc.body).find((node) => node.attrs["data-testid"] === "plexus-hide-f1");
  hide.fire("click");
  const cover = container.children.find((node) => node.className === "plexus-frame-cover");
  const box = [frame.x, frame.y, frame.x + frame.width, frame.y + frame.height];
  const expected = viewportRectOf(app, box);
  assert.equal(updates, 0);
  assert.equal(frame.opacity, 100);
  assert.equal(JSON.stringify(frame), before);
  assert.equal(cover.style.left, `${expected.left}px`);
  assert.equal(cover.style.top, `${expected.top}px`);
  assert.equal(cover.style.width, `${expected.width}px`);
  assert.equal(cover.style.height, `${expected.height}px`);
  assert.equal(cover.style.background, "#ffffff");
  app.state.scrollX = 10;
  onScroll();
  const moved = viewportRectOf(app, box);
  assert.equal(cover.style.left, `${moved.left}px`);
  assert.equal(updates, 0);
  assert.equal(frame.opacity, 100);
  walk(doc.body).find((node) => node.attrs["data-testid"] === "plexus-frame-f1").fire("click");
  assert.equal(scrolled, frame);
  assert.equal(updates, 0);
  doc.fire("keydown", { key: "Escape" });
  assert.equal(container.children.some((node) => node.className === "plexus-frame-cover"), false);
  assert.equal(updates, 0);
  assert.equal(JSON.stringify(frame), before);
  handle.close();
});
