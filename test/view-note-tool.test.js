import assert from "node:assert/strict";
import test from "node:test";

import { installNoteTool } from "../src/view/note-tool.js";

function setup({ canArm = () => true } = {}) {
  const listeners = {};
  const dl = {};
  const attrs = {};
  const containerEl = {
    addEventListener(t, f) { (listeners[t] ||= []).push(f); },
    removeEventListener(t, f) { listeners[t] = (listeners[t] || []).filter((x) => x !== f); },
  };
  const doc = {
    body: { setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } },
    addEventListener(t, f) { (dl[t] ||= []).push(f); },
    removeEventListener(t, f) { dl[t] = (dl[t] || []).filter((x) => x !== f); },
  };
  const app = { state: { scrollX: 0, scrollY: 0, zoom: { value: 2 }, offsetLeft: 0, offsetTop: 0 } };
  const placed = [];
  const timers = [];
  const tool = installNoteTool({
    doc, containerEl, app, canArm, onPlace: (p) => placed.push(p),
    setTimeout: (fn, ms) => { const x = { fn, ms, cleared: false }; timers.push(x); return x; },
    clearTimeout: (x) => { x.cleared = true; },
  });
  const canvas = { matches: (sel) => sel === "canvas.excalidraw__canvas.interactive" };
  const other = { matches: () => false };
  const fire = (type, target, extra = {}) => {
    const ev = { type, target, button: 0, clientX: 100, clientY: 60, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...extra };
    for (const f of [...(listeners[type] || [])]) f(ev);
    return ev;
  };
  const key = (k) => { const ev = { type: "keydown", key: k, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } }; for (const f of [...(dl.keydown || [])]) f(ev); return ev; };
  return { tool, listeners, dl, attrs, placed, timers, canvas, other, fire, key, app };
}

const count = (t) => Object.values(t.listeners).reduce((n, l) => n + l.length, 0) + Object.values(t.dl).reduce((n, l) => n + l.length, 0);

test("no listeners and no body marker until armed", () => {
  const t = setup();
  assert.equal(count(t), 0);
  assert.equal(t.tool.armed(), false);
  assert.deepEqual(t.attrs, {});
});

test("arm, then a click places the note at the scene point and disarms", () => {
  const t = setup();
  assert.equal(t.tool.arm(), true);
  assert.ok("data-plexus-note-armed" in t.attrs);
  const d = t.fire("pointerdown", t.canvas);
  assert.equal(d.stopped, true);
  assert.equal(t.fire("mousedown", t.canvas).stopped, true);
  const u = t.fire("pointerup", t.canvas);
  assert.equal(u.stopped, true);
  assert.deepEqual(t.placed, [{ x: 50, y: 30 }]);
  assert.equal(t.tool.armed(), false);
  assert.equal(count(t), 0);
  assert.deepEqual(t.attrs, {});
  assert.equal(t.timers[0].cleared, true);
});

test("a drag of 4 px or more keeps the tool armed and places nothing", () => {
  const t = setup();
  t.tool.arm();
  t.fire("pointerdown", t.canvas);
  t.fire("pointerup", t.canvas, { clientX: 110 });
  assert.deepEqual(t.placed, []);
  assert.equal(t.tool.armed(), true);
  t.tool.dispose();
});

test("Esc disarms and is swallowed; other keys are untouched", () => {
  const t = setup();
  t.tool.arm();
  assert.equal(t.key("a").stopped, false);
  const esc = t.key("Escape");
  assert.equal(esc.stopped, true);
  assert.equal(t.tool.armed(), false);
  assert.equal(count(t), 0);
});

test("a non-canvas target passes through and disarms; modifiers and secondary buttons pass through and stay armed", () => {
  const t = setup();
  t.tool.arm();
  assert.equal(t.fire("pointerdown", t.canvas, { shiftKey: true }).stopped, false);
  assert.equal(t.fire("pointerdown", t.canvas, { button: 2 }).stopped, false);
  assert.equal(t.tool.armed(), true);
  const ev = t.fire("pointerdown", t.other);
  assert.equal(ev.stopped, false);
  assert.equal(t.tool.armed(), false);
  assert.deepEqual(t.placed, []);
});

test("refuses to arm when canArm is false or a text element is being edited; disarms when editing starts", () => {
  const no = setup({ canArm: () => false });
  assert.equal(no.tool.arm(), false);
  assert.equal(count(no), 0);
  const t = setup();
  t.app.state.editingTextElement = {};
  assert.equal(t.tool.arm(), false);
  t.app.state.editingTextElement = null;
  t.tool.arm();
  t.app.state.editingTextElement = {};
  assert.equal(t.fire("pointerdown", t.canvas).stopped, false);
  assert.equal(t.tool.armed(), false);
});

test("arming twice does not double-bind; the 30 s timeout and dispose both disarm", () => {
  const t = setup();
  t.tool.arm();
  const n = count(t);
  t.tool.arm();
  assert.equal(count(t), n);
  assert.equal(t.timers[0].ms, 30000);
  t.timers[0].fn();
  assert.equal(t.tool.armed(), false);
  assert.equal(count(t), 0);
  t.tool.arm();
  t.tool.dispose();
  assert.equal(count(t), 0);
  assert.deepEqual(t.attrs, {});
});
