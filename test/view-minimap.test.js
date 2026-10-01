import assert from "node:assert/strict";
import test from "node:test";

import { openSettingsDialog } from "../src/view/settings-dialog.js";
import { SETTING_IDS, createSettingsPanel, readSettings } from "../src/settings.js";
import {
  MINIMAP_H, MINIMAP_W, boundsKey, createBoundsCache, layout, mountMinimap, sceneFits, scrollFor, scrollForPointer, visibleScene,
} from "../src/view/minimap.js";

const rect = (id, x, y, w, h, extra = {}) => ({ id, type: "rectangle", x, y, width: w, height: h, angle: 0, version: 1, isDeleted: false, ...extra });

test("visible scene runs from -scroll through -scroll plus size over zoom", () => {
  const view = visibleScene({ scrollX: 10, scrollY: -4, width: 100, height: 40, zoom: { value: 2 } });
  assert.deepEqual(view, { x0: -10, y0: 4, x1: 40, y1: 24 });
});

test("a scene that sits inside the view is hidden, and a point past it is not", () => {
  const view = visibleScene({ scrollX: 0, scrollY: 0, width: 200, height: 100, zoom: 1 });
  assert.equal(sceneFits([0, 0, 200, 100], view), true);
  assert.equal(sceneFits(null, view), true);
  const small = layout([rect("a", 10, 10, 20, 20)], { scrollX: 0, scrollY: 0, width: 200, height: 100, zoom: 1 });
  assert.equal(small.hidden, true);
  const wide = layout([rect("a", 0, 0, 20, 20), rect("b", 4000, 10, 20, 20)], { scrollX: 0, scrollY: 0, width: 200, height: 100, zoom: 1 });
  assert.equal(wide.hidden, false);
  assert.equal(wide.boxes.length, 2);
  assert.ok(wide.viewport.w > 0 && wide.viewport.h > 0);
});

test("the toggle, an empty scene, and a deleted element hide the map", () => {
  const state = { scrollX: 0, scrollY: 0, width: 100, height: 80, zoom: 1 };
  assert.equal(layout([rect("a", 0, 0, 500, 500)], state, { enabled: false }).hidden, true);
  assert.equal(layout([], state).hidden, true);
  assert.equal(layout([rect("a", 0, 0, 500, 500, { isDeleted: true })], state).hidden, true);
});

test("scroll centers a scene point and does not change zoom", () => {
  const next = scrollFor({ width: 1000, height: 800, zoom: { value: 2 } }, 100, 50);
  assert.deepEqual(next, { scrollX: 150, scrollY: 150 });
  const bounds = [0, 0, MINIMAP_W, MINIMAP_H];
  const fromPointer = scrollForPointer({ width: 200, height: 110, zoom: 1 }, bounds, 80, 55);
  assert.deepEqual(fromPointer, { scrollX: 20, scrollY: 0 });
});

test("the box cache holds still until the live count or version sum changes", () => {
  const cache = createBoundsCache();
  const els = [rect("a", 0, 0, 30, 10), rect("gone", 9, 9, 9, 9, { isDeleted: true, version: 4 })];
  const first = cache.get(els);
  assert.equal(cache.get(els), first);
  assert.deepEqual(boundsKey(els), { count: 1, version: 1 });
  els[0] = { ...els[0], version: 2 };
  assert.notEqual(cache.get(els), first);
});

test("a rotated rectangle uses element bounds, so the portal box is taller than it is wide", () => {
  const turned = layout(
    [rect("a", 0, 0, 40, 10, { angle: Math.PI / 2 })],
    { scrollX: 0, scrollY: 0, width: 1, height: 1, zoom: 1 },
  );
  assert.equal(turned.hidden, false);
  assert.ok(turned.boxes[0].h > turned.boxes[0].w);
});

function fakeDoc() {
  const listen = (node) => {
    node.listeners = {};
    node.addEventListener = (type, fn) => { (node.listeners[type] ||= []).push(fn); };
    node.setPointerCapture = () => { node.captured = true; };
  };
  const body = { children: [], append(node) { this.children.push(node); } };
  return {
    body,
    createElement(tag) {
      const node = {
        tag, className: "", hidden: false, style: {}, children: [], width: 0, height: 0,
        append(...kids) { this.children.push(...kids); },
        getBoundingClientRect() { return { left: 10, top: 20, right: 10 + MINIMAP_W, bottom: 20 + MINIMAP_H, width: MINIMAP_W, height: MINIMAP_H }; },
        getContext() { return { clearRect() {}, strokeRect() {}, lineWidth: 1, strokeStyle: "" }; },
        remove() { node.removed = true; },
      };
      listen(node);
      return node;
    },
  };
}

test("mount subscribes once, draws on one frame, and pans with scroll only", () => {
  const doc = fakeDoc();
  const elements = [rect("a", 0, 0, 40, 20), rect("b", 3000, 2000, 40, 20)];
  const updates = [];
  const app = {
    state: { scrollX: 0, scrollY: 0, zoom: { value: 1 }, width: 800, height: 600 },
    scene: { getNonDeletedElements: () => elements },
    updateScene(payload) { updates.push(payload); },
  };
  const outer = {
    classList: { contains: (name) => name === "full-screen" },
    getBoundingClientRect: () => ({ top: 0, right: 1000, left: 0, bottom: 700, width: 1000, height: 700 }),
  };
  let cb = null;
  let unsubscribed = 0;
  const queued = [];
  let enabled = true;
  const mini = mountMinimap({
    doc, app, outer,
    getEnabled: () => enabled,
    subscribe(fn) { cb = fn; return () => { unsubscribed += 1; }; },
    raf(fn) { queued.push(fn); return queued.length; },
    cancel() { queued.length = 0; },
    zIndex: 4,
  });
  assert.equal(typeof cb, "function");
  cb(); cb(); cb();
  assert.equal(queued.length, 1);
  queued[0]();
  const node = doc.body.children[0];
  assert.equal(node.hidden, false);
  assert.equal(node.className, "plexus-portal plexus-minimap");
  const down = { clientX: 10, clientY: 20, pointerId: 1, stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; } };
  node.listeners.pointerdown[0](down);
  assert.equal(down.stopped, true);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].captureUpdate, "NEVER");
  assert.deepEqual(Object.keys(updates[0].appState).sort(), ["scrollX", "scrollY"]);
  const move = { clientX: 40, clientY: 40, pointerId: 1, stopPropagation() { this.stopped = true; }, preventDefault() {} };
  node.listeners.pointermove[0](move);
  assert.equal(updates.length, 2);
  node.listeners.pointerup[0]({ stopPropagation() {}, preventDefault() {} });
  node.listeners.pointermove[0]({ clientX: 50, clientY: 50, stopPropagation() { this.stopped = true; }, preventDefault() {} });
  assert.equal(updates.length, 2);
  enabled = false;
  mini.refresh();
  assert.equal(unsubscribed, 1);
  assert.equal(node.hidden, true);
  mini.dispose();
  assert.equal(node.removed, true);
});

test("mount draws when the view cannot cancel an animation frame", () => {
  const doc = fakeDoc();
  doc.defaultView = { requestAnimationFrame() { throw new Error("should draw now"); } };
  const mini = mountMinimap({
    doc,
    app: {
      state: { scrollX: 0, scrollY: 0, zoom: { value: 1 }, width: 200, height: 100 },
      scene: { getNonDeletedElements: () => [] },
      updateScene() {},
    },
    outer: {
      classList: { contains: (name) => name === "full-screen" },
      getBoundingClientRect: () => ({ top: 0, right: 400, left: 0, bottom: 300, width: 400, height: 300 }),
    },
    subscribe() { return () => {}; },
  });
  assert.equal(doc.body.children.length, 1);
  assert.equal(doc.body.children[0].hidden, true);
  mini.dispose();
  assert.equal(doc.body.children[0].removed, true);
});

test("a normal editor gets no portal", () => {
  const doc = fakeDoc();
  let subscribed = 0;
  const mini = mountMinimap({
    doc,
    app: { state: {}, scene: { getNonDeletedElements: () => [] }, updateScene() {} },
    outer: { classList: { contains: () => false } },
    subscribe() { subscribed += 1; return () => {}; },
  });
  mini.refresh();
  assert.equal(subscribed, 0);
  assert.equal(doc.body.children.length, 0);
});

test("minimap defaults on, turns off for false, and is the field after preview", () => {
  assert.equal(SETTING_IDS.minimap, "minimap");
  assert.equal(readSettings({ settings: { get: () => null } }).minimap, true);
  assert.equal(readSettings({ settings: { get: (id) => (id === "minimap" ? false : null) } }).minimap, false);
  assert.equal(readSettings({ settings: { get: (id) => (id === "minimap" ? "false" : null) } }).minimap, false);
  const panel = createSettingsPanel().settings;
  assert.equal(panel.at(-1).id, "minimap");
  assert.equal(panel.at(-2).id, "preview-modifier");
  assert.equal(panel.at(-1).action.type, "switch");

  const body = { children: [], append(n) { this.children.push(n); } };
  const doc = {
    body,
    createElement(tag) {
      const n = {
        tag, children: [], className: "", style: {}, value: "", checked: false, textContent: "", parent: null,
        append(...kids) { for (const kid of kids) { if (kid && typeof kid === "object") kid.parent = this; this.children.push(kid); } },
        addEventListener() {},
        setAttribute() {},
      };
      if (tag === "dialog") { n.showModal = () => {}; n.close = () => {}; }
      return n;
    },
  };
  openSettingsDialog({ doc, get: () => undefined, set: () => {} });
  const flat = (n) => [n, ...(n.children || []).flatMap((c) => (c && typeof c === "object" ? flat(c) : []))];
  const controls = flat(body.children[0]).filter((n) => n.tag === "input" || n.tag === "select");
  const labelOf = (input) => input.parent.children.find((c) => c.tag === "span").textContent;
  assert.equal(labelOf(controls[26]), "Preview links only while holding Ctrl/Cmd");
  assert.equal(labelOf(controls[27]), "Minimap");
  assert.equal(controls[27].checked, true);
  assert.equal(controls[26].checked, false);
});
