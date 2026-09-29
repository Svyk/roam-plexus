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

function setup({ link }) {
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
      pull: () => ({ ":block/children": [3, 1, 2, 0].map((n) => ({ ":block/string": `c${n}`, ":block/order": n })) }),
    },
    ui: { components: { renderString: (o) => rendered.push(o.string), unmountNode: (o) => unmounted.push(o.el) } },
  };
  const app = { state: { zoom: { value: 1 }, scrollX: 0, scrollY: 0 }, getElementLinkAtPosition: () => link };
  const containerEl = new El();
  const hover = createHoverPreview({ doc, api, raf: (cb) => { queueMicrotask(cb); return 1; }, caf() {}, delayMs: 0 });
  const dispose = hover.attach({ app, containerEl });
  const move = () => containerEl.dispatchEvent(Object.assign(new Event("pointermove"), { clientX: 50, clientY: 60 }));
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
