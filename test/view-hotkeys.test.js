import assert from "node:assert/strict";
import test from "node:test";

import { createHotkeyRunner, installHotkeyGuard } from "../src/view/hotkeys.js";

test("runOnce dedupes within 300 ms and runs again after", () => {
  let t = 1000;
  const calls = [];
  const run = createHotkeyRunner({ handlers: { note: () => calls.push("note"), embed: () => calls.push("embed") }, now: () => t });
  run("note"); run("note"); run("embed");
  assert.deepEqual(calls, ["note", "embed"]);
  t += 301;
  run("note");
  assert.deepEqual(calls, ["note", "embed", "note"]);
});

test("runOnce does nothing while text is edited in a mounted editor, but works with no editor", () => {
  const calls = [];
  const app = { state: { editingTextElement: { id: "t" } } };
  let mounted = app;
  const doc = { activeElement: { tagName: "DIV" } };
  const run = createHotkeyRunner({ handlers: { note: () => calls.push(1) }, getApp: () => mounted, doc, now: () => Date.now() + calls.length * 1000 });
  run("note");
  assert.equal(calls.length, 0);
  app.state.editingTextElement = null;
  doc.activeElement = { tagName: "TEXTAREA", closest: () => ({}) };
  run("note");
  assert.equal(calls.length, 0);
  mounted = null;
  run("note");
  assert.equal(calls.length, 1);
});

test("runOnce never throws and contains handler rejections", async () => {
  const run = createHotkeyRunner({ handlers: { a: () => { throw new Error("x"); }, b: () => Promise.reject(new Error("y")) } });
  assert.doesNotThrow(() => run("a"));
  await run("b");
  assert.doesNotThrow(() => run("missing"));
});

function fakeContainer() {
  const listeners = [];
  return {
    listeners,
    addEventListener: (t, f, c) => listeners.push([t, f, c]),
    removeEventListener: (t, f, c) => { const i = listeners.findIndex((l) => l[0] === t && l[1] === f && l[2] === c); if (i >= 0) listeners.splice(i, 1); },
  };
}

function key(target, extra = {}) {
  const e = { altKey: true, shiftKey: true, ctrlKey: false, metaKey: false, isComposing: false, code: "KeyR", target, prevented: false, stopped: false, ...extra };
  e.preventDefault = () => { e.prevented = true; };
  e.stopImmediatePropagation = () => { e.stopped = true; };
  return e;
}

test("hotkey guard takes Alt+Shift+letter on the container only and disposes", () => {
  const el = fakeContainer();
  const ran = [];
  const off = installHotkeyGuard({ containerEl: el, run: (id) => ran.push(id) });
  const [, fn, capture] = el.listeners[0];
  assert.equal(capture, true);
  const hit = key(el);
  fn(hit);
  assert.deepEqual(ran, ["region"]);
  assert.ok(hit.prevented && hit.stopped);
  fn(key(el, { code: "KeyN" }));
  assert.deepEqual(ran, ["region", "note"]);
  for (const extra of [{ ctrlKey: true }, { metaKey: true }, { isComposing: true }, { shiftKey: false }, { altKey: false }, { code: "KeyX" }, { target: {} }]) {
    const e = key(el, extra);
    fn(e);
    assert.ok(!e.prevented, JSON.stringify(extra));
  }
  assert.equal(ran.length, 2);
  off();
  assert.equal(el.listeners.length, 0);
});

test("runOnce still runs from a command-palette input inside a mounted editor, but not from a Roam block input or the canvas text box", () => {
  const app = { state: {} };
  const calls = [];
  let t = 0;
  const palette = { tagName: "INPUT", closest: () => null };
  const doc = { activeElement: palette };
  const run = createHotkeyRunner({ handlers: { note: () => calls.push(1) }, getApp: () => app, doc, now: () => (t += 1000) });
  run("note");
  assert.equal(calls.length, 1);
  doc.activeElement = { tagName: "TEXTAREA", closest: (sel) => (sel.includes("textarea.rm-block-input") ? {} : null) };
  run("note");
  assert.equal(calls.length, 1);
  doc.activeElement = { tagName: "INPUT", closest: (sel) => (sel.includes(".plexus-portal") ? {} : null) };
  run("note");
  assert.equal(calls.length, 1);
});

test("hotkey guard also takes the key from a plain button inside the container, but not from text fields", () => {
  const button = { tagName: "BUTTON", dataset: {} };
  const textarea = { tagName: "TEXTAREA", dataset: { type: "wysiwyg" } };
  const outside = { tagName: "BUTTON", dataset: {} };
  const el = fakeContainer();
  el.contains = (n) => n === button || n === textarea;
  const ran = [];
  installHotkeyGuard({ containerEl: el, run: (id) => ran.push(id) });
  const fn = el.listeners[0][1];
  const hit = key(button);
  fn(hit);
  assert.deepEqual(ran, ["region"]);
  assert.ok(hit.prevented);
  fn(key(textarea));
  fn(key(outside));
  assert.equal(ran.length, 1);
});

test("doc-level guard: listens on doc, takes a body-targeted key, ignores a Roam block textarea outside the container, and disposes from doc", () => {
  const el = fakeContainer();
  const body = { tagName: "BODY" };
  const doc = { ...fakeContainer(), body, documentElement: { tagName: "HTML" } };
  const roamBlock = { tagName: "TEXTAREA", dataset: {} };
  el.contains = () => false;
  const ran = [];
  const off = installHotkeyGuard({ containerEl: el, run: (id) => ran.push(id), doc });
  assert.equal(el.listeners.length, 0);
  assert.equal(doc.listeners.length, 1);
  assert.equal(doc.listeners[0][2], true);
  const fn = doc.listeners[0][1];
  const hit = key(body);
  fn(hit);
  assert.deepEqual(ran, ["region"]);
  assert.ok(hit.prevented && hit.stopped);
  fn(key(doc.documentElement, { code: "KeyP" }));
  assert.deepEqual(ran, ["region", "present"]);
  const miss = key(roamBlock);
  fn(miss);
  assert.ok(!miss.prevented);
  assert.equal(ran.length, 2);
  off();
  assert.equal(doc.listeners.length, 0);
});

test("hotkey guard maps Alt+Shift+O to the dock", () => {
  const container = fakeContainer();
  const ran = [];
  installHotkeyGuard({ containerEl: container, run: (id) => ran.push(id) });
  const e = key(container, { code: "KeyO" });
  container.listeners.find((l) => l[0] === "keydown")[1](e);
  assert.deepEqual(ran, ["dock"]);
  assert.equal(e.prevented, true);
});
