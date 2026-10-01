import assert from "node:assert/strict";
import test from "node:test";

import { createHoverPreview } from "../src/view/hover-preview.js";

class El extends EventTarget {
  constructor() {
    super();
    this.style = {};
    this.children = [];
    this.className = "";
  }
  append(...c) { this.children.push(...c); }
  remove() { this.removed = true; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 100 }; }
}

function setup({ link, state = { zoom: { value: 1 }, scrollX: 0, scrollY: 0 }, onLookup, onPull, requireModifier, keyTarget }) {
  const created = [];
  const rendered = [];
  const unmounted = [];
  const doc = {
    body: new El(),
    defaultView: { innerWidth: 1000, innerHeight: 800 },
    createElement: () => { const el = new El(); created.push(el); return el; },
  };
  const api = {
    graph: { name: "g" },
    data: {
      pull: () => (onPull?.(), { ":block/children": [3, 1, 2, 0].map((n) => ({ ":block/string": `c${n}`, ":block/order": n })) }),
    },
    ui: { components: { renderString: (o) => rendered.push(o.string), unmountNode: (o) => unmounted.push(o.el) } },
  };
  const app = { state, getElementLinkAtPosition: (p) => { onLookup?.(p); return link; } };
  const containerEl = new El();
  const hover = createHoverPreview({ doc, api, raf: (cb) => { queueMicrotask(cb); return 1; }, caf() {}, delayMs: 0, requireModifier, keyTarget });
  const dispose = hover.attach({ app, containerEl });
  const move = (extra = {}) => containerEl.dispatchEvent(Object.assign(new Event("pointermove"), { clientX: 50, clientY: 60 }, extra));
  return { doc, containerEl, rendered, unmounted, created, dispose, move, hover };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

test("does nothing when the pointer is not over a linked element", async () => {
  const s = setup({ link: null });
  s.move();
  await tick();
  assert.equal(s.created.length, 0);
  assert.equal(s.doc.body.children.length, 0);
  assert.deepEqual(s.rendered, []);
});

test("a non-Roam link renders nothing", async () => {
  const s = setup({ link: "https://example.com/x" });
  s.move();
  await tick();
  assert.equal(s.doc.body.children.length, 0);
});

test("a page link shows one portal with the page and its first three children, then hides on pointerdown", async () => {
  const s = setup({ link: "[[Foo]]" });
  s.move();
  s.move();
  await tick();
  assert.equal(s.doc.body.children.length, 1);
  const portal = s.doc.body.children[0];
  assert.match(portal.className, /plexus-hover/);
  assert.deepEqual(s.rendered, ["[[Foo]]"]);
  assert.deepEqual(portal.children.slice(1).map((c) => c.textContent), ["c0", "c1", "c2"]);
  s.containerEl.dispatchEvent(new Event("pointerdown"));
  assert.equal(portal.removed, true);
  assert.equal(s.unmounted.length, 1);
});

test("a block link renders ((uid)); dispose removes listeners and the portal", async () => {
  const s = setup({ link: "((abcdefghi))" });
  s.move();
  await tick();
  assert.deepEqual(s.rendered, ["((abcdefghi))"]);
  const portal = s.doc.body.children[0];
  s.dispose();
  assert.equal(portal.removed, true);
  const before = s.doc.body.children.length;
  s.move();
  await tick();
  assert.equal(s.doc.body.children.length, before);
});

test("the scene point passed to the hit test honours zoom and scroll", async () => {
  const seen = [];
  const s = setup({ link: null, state: { zoom: { value: 2 }, scrollX: 5, scrollY: 6 }, onLookup: (p) => seen.push(p) });
  s.move();
  await tick();
  // viewport (50,60), container at 0,0: 50/2-5, 60/2-6
  assert.deepEqual(seen[0], { x: 20, y: 24 });
});

test("pointermove with a button held (drag/pan) does no hit test and shows nothing", async () => {
  const seen = [];
  const s = setup({ link: "((abcdefghi))", onLookup: (p) => seen.push(p) });
  s.move({ buttons: 1 });
  await tick();
  assert.equal(seen.length, 0);
  assert.equal(s.doc.body.children.length, 0);
});

test("a stable hover on a URL link pulls once, not once per frame; leave hides; wheel hides", async () => {
  let pulls = 0;
  const s = setup({ link: "https://roamresearch.com/#/app/g/page/abcdefghi", onPull: () => { pulls++; } });
  for (let i = 0; i < 4; i++) { s.move(); await tick(); }
  const first = pulls;
  assert.ok(first >= 1);
  const portal = s.doc.body.children[0];
  assert.ok(portal);
  for (let i = 0; i < 4; i++) { s.move(); await tick(); }
  assert.equal(pulls, first);
  s.containerEl.dispatchEvent(new Event("pointerleave"));
  assert.equal(portal.removed, true);
  s.move();
  await tick();
  assert.equal(s.doc.body.children.length, 2);
  s.containerEl.dispatchEvent(new Event("wheel"));
  assert.equal(s.doc.body.children[1].removed, true);
});

test("requireModifier blocks a plain move, allows metaKey, and Meta keyup hides", async () => {
  const keyTarget = new EventTarget();
  const s = setup({ link: "[[Foo]]", requireModifier: () => true, keyTarget });
  s.move();
  await tick();
  assert.equal(s.doc.body.children.length, 0);
  s.move({ metaKey: true });
  await tick();
  assert.equal(s.doc.body.children.length, 1);
  const portal = s.doc.body.children[0];
  assert.match(portal.className, /plexus-hover/);
  keyTarget.dispatchEvent(Object.assign(new Event("keyup"), { key: "Meta" }));
  assert.equal(portal.removed, true);
});
