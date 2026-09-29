import assert from "node:assert/strict";
import test from "node:test";

import { createPresenter } from "../src/view/present.js";

function fakeNode() {
  const n = {
    style: {}, children: [], listeners: {}, hidden: false, textContent: "", open: false, removed: false,
    setAttribute() {}, removeAttribute() {},
    append(...c) { this.children.push(...c); },
    remove() { this.removed = true; },
    addEventListener(t, f) { this.listeners[t] = f; },
    removeEventListener(t) { delete this.listeners[t]; },
    getBoundingClientRect: () => ({ left: 0, width: 1000 }),
    showModal() { this.open = true; },
    close() { this.open = false; },
    focus() {},
  };
  return n;
}

function setup() {
  const nodes = [];
  const doc = { body: fakeNode(), defaultView: {}, createElement: (tag) => { const n = fakeNode(); n.tag = tag; nodes.push(n); return n; } };
  const presenter = createPresenter({ doc });
  const dialog = () => nodes.find((n) => n.tag === "dialog");
  const hud = () => dialog().children.find((c) => c.className === "plexus-present-hud");
  const img = () => dialog().children.find((c) => c.className === "plexus-present-slide");
  return { presenter, dialog, hud, img, doc, nodes };
}
const key = (k) => ({ key: k, preventDefault() {}, stopPropagation() {} });
const slides = [{ name: "A", url: "u1" }, { name: "B", url: "u2" }, { name: "C", url: null }];

test("keys, click halves, and preload navigate slides", () => {
  const t = setup();
  t.presenter.open({ slides });
  const d = t.dialog();
  assert.equal(d.open, true);
  assert.equal(t.hud().textContent, "1 / 3 · A");
  d.listeners.keydown(key("ArrowRight"));
  assert.equal(t.hud().textContent, "2 / 3 · B");
  assert.equal(t.img().src, "u2");
  d.listeners.keydown(key(" "));
  assert.equal(t.hud().textContent, "3 / 3 · C");
  assert.equal(t.img().hidden, true);
  d.listeners.keydown(key("Enter"));
  assert.equal(t.hud().textContent, "3 / 3 · C");
  d.listeners.keydown(key("Home"));
  assert.equal(t.hud().textContent, "1 / 3 · A");
  d.listeners.click({ clientX: 900 });
  assert.equal(t.hud().textContent, "2 / 3 · B");
  d.listeners.click({ clientX: 100 });
  assert.equal(t.hud().textContent, "1 / 3 · A");
  d.listeners.keydown(key("End"));
  d.listeners.keydown(key("Backspace"));
  assert.equal(t.hud().textContent, "2 / 3 · B");
  d.listeners.keydown(key("PageUp"));
  assert.equal(t.hud().textContent, "1 / 3 · A");
});

test("setSlide fills a pending slide; cancel closes and removes the dialog", () => {
  const t = setup();
  const h = t.presenter.open({ slides, index: 2 });
  assert.equal(t.img().hidden, true);
  h.setSlide(2, { url: "u3" });
  assert.equal(t.img().src, "u3");
  assert.equal(t.img().hidden, false);
  const d = t.dialog();
  let prevented = false;
  d.listeners.cancel({ preventDefault() { prevented = true; } });
  assert.ok(prevented);
  assert.equal(d.removed, true);
  assert.equal(d.open, false);
  assert.equal(t.presenter.isOpen(), false);
  assert.equal(h.isOpen(), false);
});

test("dispose closes an open dialog", () => {
  const t = setup();
  t.presenter.open({ slides });
  t.presenter.dispose();
  assert.equal(t.dialog().removed, true);
});
