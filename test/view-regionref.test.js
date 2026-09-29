import assert from "node:assert/strict";
import test from "node:test";

import { createRegionRefRenderer } from "../src/view/regionref.js";
import { serializeRegion, geometryKey } from "../src/model/region.js";
import { cropKey } from "../src/host/cache.js";

function makeEl(tag) {
  const el = {
    tag,
    attrs: {},
    classes: new Set(),
    children: [],
    style: {},
    listeners: {},
    parentNode: null,
    nextSibling: null,
    isConnected: true,
    textContent: "",
    set className(v) { this.classes = new Set(v.split(/\s+/).filter(Boolean)); },
    get className() { return [...this.classes].join(" "); },
    classList: {
      add: (c) => el.classes.add(c),
      remove: (c) => el.classes.delete(c),
      contains: (c) => el.classes.has(c),
    },
    getAttribute: (k) => el.attrs[k] ?? null,
    setAttribute: (k, v) => { el.attrs[k] = v; },
    removeAttribute: (k) => { delete el.attrs[k]; },
    addEventListener: (t, fn) => { el.listeners[t] = fn; },
    closest: () => null,
    append: (c) => { el.children.push(c); c.parentNode = el; },
    remove: () => { el.isConnected = false; },
    insertBefore: (n, ref) => { el.children.splice(ref ? el.children.indexOf(ref) : el.children.length, 0, n); n.parentNode = el; },
  };
  return el;
}

const doc = { createElement: makeEl };

const elements = [
  { id: "rect-a", type: "rectangle", x: 100, y: 100, width: 220, height: 140, angle: 0, isDeleted: false },
  { id: "rect-b", type: "rectangle", x: 420, y: 120, width: 160, height: 100, angle: 0, isDeleted: false },
];

function setup({ regionString, hit }) {
  const parent = makeEl("p");
  const btn = makeEl("button");
  parent.append(btn);
  const puts = [];
  const cache = {
    peek: (key) => (hit && key.endsWith("|svg") ? hit : null),
    get: async () => null,
    put: async (...a) => puts.push(a),
  };
  const drawing = { uid: "drw000001", elements, hash: "abcd1234" };
  const host = {
    blockUidFromNode: () => "reg000001",
    pullBlock: () => ({ uid: "reg000001", string: regionString }),
    drawing: () => drawing,
  };
  const r = createRegionRefRenderer({
    host,
    cache,
    cold: { renderDrawing: async () => null },
    getSettings: () => ({ maxCropHeight: 360, openInSidebar: false }),
    onOpen: () => {},
    doc,
  });
  return { r, btn, parent };
}

const areaString = serializeRegion({ kind: "area", drawingUid: "drw000001", ids: ["rect-a"], pad: 10, caption: "Cap" });

test("cache hit sets img.src synchronously and hides the button", () => {
  const { r, btn, parent } = setup({ regionString: areaString, hit: { url: "blob:x", w: 10, h: 10, type: "image/svg+xml" } });
  r.claim(btn);
  const root = parent.children[1];
  assert.ok(btn.classes.has("plexus-hidden"));
  assert.equal(btn.attrs["data-plexus-claimed"], "1");
  assert.equal(root.title, "Cap");
  assert.equal(root.children[0].src, "blob:x");
  r.claim(btn);
  assert.equal(parent.children.length, 2);
});

test("unsupported kind renders a chip", () => {
  const { r, btn, parent } = setup({ regionString: "{{[[plexus-region]]: k=poly d=drw000001 ids=a}}" });
  r.claim(btn);
  assert.match(parent.children[1].textContent, /needs a newer Plexus|Invalid region/);
});

test("non-region blocks are ignored and releaseAll restores the button", () => {
  const ignored = setup({ regionString: "hello" });
  ignored.r.claim(ignored.btn);
  assert.equal(ignored.btn.attrs["data-plexus-claimed"], undefined);

  const { r, btn, parent } = setup({ regionString: areaString, hit: { url: "blob:x", w: 1, h: 1, type: "x" } });
  r.claim(btn);
  r.releaseAll();
  assert.ok(!btn.classes.has("plexus-hidden"));
  assert.equal(btn.attrs["data-plexus-claimed"], undefined);
  assert.equal(parent.children[1].isConnected, false);
});
