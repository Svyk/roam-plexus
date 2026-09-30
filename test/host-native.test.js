import test from "node:test";
import assert from "node:assert/strict";
import { findApp, activeEditor, selectedElementIds, captureSelectionSvg, withClipboard, looksLikeSvg, clipboardBusy } from "../src/host/native.js";

function makeApp({ svg = "<svg/>", throwOnExecute = false, silent = false } = {}) {
  const app = {
    state: { selectedElementIds: { keep: true }, selectedGroupIds: { g: true } },
    updates: [],
    updateScene(u) { this.updates.push(u); Object.assign(this.state, u.appState); },
    getSceneElementsIncludingDeleted: () => [{ id: "a" }, { id: "gone", isDeleted: true }],
    actionManager: {
      updater: (r) => { if (r && typeof r.then === "function") r.then((v) => app.updateScene({ appState: v })); },
      actions: { copyAsSvg: { name: "copyAsSvg" } },
      executeAction: async () => {
        if (throwOnExecute) throw new Error("exec failed");
        if (!silent) await app.clipboard.writeText(svg);
      },
    },
  };
  return app;
}

test("findApp walks fiber chain", () => {
  const app = makeApp();
  const el = { "__reactFiber$abc": { stateNode: null, return: { stateNode: {}, return: { stateNode: app } } } };
  assert.equal(findApp(el), app);
  assert.equal(findApp({}), null);
  assert.equal(findApp(null), null);
  let deep = { stateNode: app };
  for (let i = 0; i < 8; i++) deep = { stateNode: null, return: deep };
  assert.equal(findApp({ "__reactFiber$x": deep }), null);
});

test("activeEditor resolves drawing uid from block-input id", () => {
  const app = makeApp();
  const block = { id: "block-input-u-body-outline-page00001-blk000001" };
  const outer = { closest: (s) => (s === '[id^="block-input-"]' ? block : null) };
  const el = { "__reactFiber$q": { stateNode: app }, closest: (s) => (s === ".plexus-offscreen" ? null : outer) };
  const doc = { querySelector: (s) => { assert.match(s, /full-screen/); return el; } };
  const ed = activeEditor(doc);
  assert.equal(ed.drawingUid, "blk000001");
  assert.equal(ed.app, app);
  assert.equal(ed.outer, outer);
  assert.equal(activeEditor({ querySelector: () => null }), null);
});

test("selectedElementIds skips deleted", () => {
  const app = makeApp();
  app.state.selectedElementIds = { a: true, gone: true, off: false };
  assert.deepEqual(selectedElementIds(app), ["a"]);
});

function makeClipboard() {
  const c = { writeText: async () => "orig-text", write: async () => "orig-write" };
  return c;
}

test("captureSelectionSvg returns svg and restores clipboard + selection", async () => {
  const app = makeApp({ svg: "<svg>x</svg>" });
  const clipboard = makeClipboard();
  app.clipboard = clipboard;
  const origText = clipboard.writeText;
  const origWrite = clipboard.write;
  const svg = await captureSelectionSvg(app, ["a"], { clipboard, raf: (cb) => cb(), timeoutMs: 200 });
  assert.equal(svg, "<svg>x</svg>");
  assert.equal(clipboard.writeText, origText);
  assert.equal(clipboard.write, origWrite);
  assert.deepEqual(app.updates[0].appState.selectedElementIds, { a: true });
  assert.deepEqual(app.updates[0].appState.selectedGroupIds, {});
  const last = app.updates.at(-1).appState;
  assert.deepEqual(last.selectedElementIds, { keep: true });
  assert.equal(last.toast, null);
});

test("captureSelectionSvg restores even when executeAction throws", async () => {
  const app = makeApp({ throwOnExecute: true });
  const clipboard = makeClipboard();
  app.clipboard = clipboard;
  const origText = clipboard.writeText;
  await assert.rejects(captureSelectionSvg(app, ["a"], { clipboard, raf: (cb) => cb(), timeoutMs: 200 }), /exec failed/);
  assert.equal(clipboard.writeText, origText);
  assert.deepEqual(app.state.selectedElementIds, { keep: true });
});

test("captureSelectionSvg times out when nothing captured", async () => {
  const app = makeApp({ silent: true });
  const clipboard = makeClipboard();
  app.clipboard = clipboard;
  const origText = clipboard.writeText;
  await assert.rejects(captureSelectionSvg(app, ["a"], { clipboard, raf: (cb) => cb(), timeoutMs: 20, graceMs: 0 }), /no SVG/);
  assert.equal(clipboard.writeText, origText);
});

test("captureSelectionSvg throws without clipboard", async () => {
  await assert.rejects(captureSelectionSvg(makeApp(), ["a"], { clipboard: undefined }), /clipboard/);
});

test("captures are serialized", async () => {
  const order = [];
  const clipboard = makeClipboard();
  const mk = (name) => {
    const app = makeApp();
    app.clipboard = clipboard;
    app.actionManager.executeAction = async () => {
      order.push(`start-${name}`);
      await new Promise((r) => setTimeout(r, 15));
      await clipboard.writeText(`<svg>${name}</svg>`);
      order.push(`end-${name}`);
    };
    return app;
  };
  const opts = { clipboard, raf: (cb) => cb(), timeoutMs: 500 };
  const [a, b] = await Promise.all([captureSelectionSvg(mk("A"), ["a"], opts), captureSelectionSvg(mk("B"), ["a"], opts)]);
  assert.equal(a, "<svg>A</svg>");
  assert.equal(b, "<svg>B</svg>");
  assert.deepEqual(order, ["start-A", "end-A", "start-B", "end-B"]);
});

test("activeEditor ignores the offscreen cold-render host", () => {
  const app = makeApp();
  const el = { "__reactFiber$q": { stateNode: app }, closest: (s) => (s === ".plexus-offscreen" ? {} : null) };
  assert.equal(activeEditor({ querySelector: () => el }), null);
});

test("looksLikeSvg accepts svg markup only", () => {
  assert.ok(looksLikeSvg("<svg viewBox='0 0 1 1'></svg>"));
  assert.ok(looksLikeSvg('<?xml version="1.0"?>\n<svg/>'));
  assert.ok(!looksLikeSvg("((abc123def))"));
  assert.ok(!looksLikeSvg("<svgx>"));
});

test("a non-SVG write during capture is not accepted as the svg", async () => {
  const app = makeApp({ silent: true });
  const clipboard = makeClipboard();
  app.clipboard = clipboard;
  app.actionManager.executeAction = async () => { await clipboard.writeText("((uid000001))"); };
  await assert.rejects(captureSelectionSvg(app, ["a"], { clipboard, raf: (cb) => cb(), timeoutMs: 30, graceMs: 0 }), /no SVG/);
});

test("svg written after executeAction already resolved is still captured", async () => {
  const app = makeApp({ silent: true });
  const clipboard = makeClipboard();
  app.clipboard = clipboard;
  app.actionManager.executeAction = async () => { setTimeout(() => clipboard.writeText("<svg>late</svg>"), 5); };
  const svg = await captureSelectionSvg(app, ["a"], { clipboard, raf: (cb) => cb(), timeoutMs: 200 });
  assert.equal(svg, "<svg>late</svg>");
});

test("a late svg after timeout is swallowed, other writes reach the real clipboard, then originals return", async () => {
  const app = makeApp({ silent: true });
  const written = [];
  const clipboard = { writeText: async (t) => { written.push(t); }, write: async () => {} };
  const origText = clipboard.writeText;
  app.clipboard = clipboard;
  app.actionManager.executeAction = async () => { setTimeout(() => clipboard.writeText("<svg>late</svg>"), 40); };
  const pending = captureSelectionSvg(app, ["a"], { clipboard, raf: (cb) => cb(), timeoutMs: 10, graceMs: 120 });
  await assert.rejects(pending, /no SVG/);
  assert.equal(clipboard.writeText, origText);
  assert.deepEqual(written, []);
});

test("withClipboard runs behind an in-flight capture", async () => {
  const order = [];
  const app = makeApp();
  const clipboard = makeClipboard();
  app.clipboard = clipboard;
  app.actionManager.executeAction = async () => {
    await new Promise((r) => setTimeout(r, 20));
    await clipboard.writeText("<svg>A</svg>");
    order.push("capture-end");
  };
  const cap = captureSelectionSvg(app, ["a"], { clipboard, raf: (cb) => cb(), timeoutMs: 500 });
  const after = withClipboard(async () => { order.push("write"); });
  await Promise.all([cap, after]);
  assert.deepEqual(order, ["capture-end", "write"]);
});

test("F2: toast:null lands after the toast, executeAction returns nothing (Roam contract)", async () => {
  const app = makeApp({ silent: true });
  const clipboard = makeClipboard();
  app.clipboard = clipboard;
  app.actionManager.executeAction = function () {
    // void return; perform promise only reaches this.updater, toast set several ticks after writeText
    this.updater((async () => {
      await clipboard.writeText("<svg>x</svg>");
      for (let i = 0; i < 6; i++) await Promise.resolve();
      await new Promise((r) => setTimeout(r, 30));
      return { toast: { message: "Copied selection to clipboard as SVG" } };
    })());
  };
  const svg = await captureSelectionSvg(app, ["a"], { clipboard, raf: (cb) => cb(), timeoutMs: 200 });
  assert.equal(svg, "<svg>x</svg>");
  assert.equal(app.state.toast, null);
  const last = app.updates.at(-1).appState;
  assert.equal(last.toast, null);
  assert.deepEqual(last.selectedElementIds, { keep: true });
});

test("F2: updater is restored after capture", async () => {
  const app = makeApp();
  const clipboard = makeClipboard();
  app.clipboard = clipboard;
  const orig = app.actionManager.updater;
  await captureSelectionSvg(app, ["a"], { clipboard, raf: (cb) => cb(), timeoutMs: 200 });
  assert.equal(app.actionManager.updater, orig);
});

test("F2: without an updater, polls for the toast before clearing it", async () => {
  const app = makeApp({ silent: true });
  delete app.actionManager.updater;
  const clipboard = makeClipboard();
  app.clipboard = clipboard;
  app.actionManager.executeAction = () => {
    clipboard.writeText("<svg>x</svg>");
    setTimeout(() => app.updateScene({ appState: { toast: { message: "Copied" } } }), 40);
  };
  await captureSelectionSvg(app, ["a"], { clipboard, raf: (cb) => cb(), timeoutMs: 200 });
  assert.equal(app.state.toast, null);
});

test("F2: a never-settling action only delays restore by doneWaitMs", async () => {
  const app = makeApp({ silent: true });
  const clipboard = makeClipboard();
  app.clipboard = clipboard;
  app.actionManager.executeAction = function () { clipboard.writeText("<svg>x</svg>"); this.updater(new Promise(() => {})); };
  const started = Date.now();
  await captureSelectionSvg(app, ["a"], { clipboard, raf: (cb) => cb(), timeoutMs: 200, doneWaitMs: 50 });
  assert.ok(Date.now() - started < 500);
  assert.equal(app.updates.at(-1).appState.toast, null);
});

import { addViaPaste, waitNotLoading } from "../src/host/native.js";

test("addViaPaste returns live new ids by diff, skipping deleted copies", () => {
  const els = [{ id: "a" }];
  const app = {
    getSceneElementsIncludingDeleted: () => els,
    addElementsFromPasteOrLibrary(arg) {
      this.arg = arg;
      els.push({ id: "n1" }, { id: "n2", isDeleted: true }, { id: "n3" });
    },
  };
  assert.deepEqual(addViaPaste(app, [{ id: "x" }]), ["n1", "n3"]);
  assert.equal(app.arg.position, "center");
  assert.deepEqual(app.arg.files, {});
  addViaPaste(app, [], { position: { clientX: 1, clientY: 2 } });
  assert.deepEqual(app.arg.position, { clientX: 1, clientY: 2 });
});

function docFor(app) {
  const el = { closest: (sel) => (sel === ".plexus-offscreen" ? null : { closest: () => null }), "__reactFiber$x": { stateNode: app } };
  return { querySelector: () => el };
}

test("waitNotLoading resolves true when loading ends, false on timeout or non-active app", async () => {
  const app = { state: { isLoading: true }, updateScene() {}, getSceneElementsIncludingDeleted() { return []; }, actionManager: {} };
  const doc = docFor(app);
  let n = 0;
  const raf = (fn) => { if (++n === 3) app.state.isLoading = false; setTimeout(fn, 0); };
  assert.equal(await waitNotLoading(app, 1000, { doc, raf }), true);
  app.state.isLoading = true;
  let t = 0;
  assert.equal(await waitNotLoading(app, 50, { doc, raf: (fn) => setTimeout(fn, 0), now: () => (t += 20) }), false);
  assert.equal(await waitNotLoading({ state: {} }, 50, { doc, raf: (fn) => setTimeout(fn, 0) }), false);
});

test("waitNotLoading ends false as soon as the editor deactivates between polls", async () => {
  const app = { state: { isLoading: true }, updateScene() {}, getSceneElementsIncludingDeleted() { return []; }, actionManager: {} };
  const live = docFor(app);
  let active = true;
  const doc = { querySelector: (sel) => (active ? live.querySelector(sel) : null) };
  let polls = 0;
  const raf = (fn) => { if (++polls === 2) active = false; setTimeout(fn, 0); };
  let t = 0;
  assert.equal(await waitNotLoading(app, 100000, { doc, raf, now: () => (t += 1) }), false);
  assert.ok(polls <= 3, `stopped early, polled ${polls}`);
});

test("clipboardBusy is true from captureSelectionSvg entry until the capture has fully settled", async () => {
  assert.equal(clipboardBusy(), false);
  const clipboard = { writeText: async () => {}, write: async () => {} };
  const app = makeApp();
  app.clipboard = clipboard;
  const run = captureSelectionSvg(app, ["a"], { clipboard, raf: (f) => f(), doneWaitMs: 0 });
  assert.equal(clipboardBusy(), true);
  assert.equal(await run, "<svg/>");
  assert.equal(clipboardBusy(), false);
  const failing = captureSelectionSvg(makeApp({ throwOnExecute: true }), ["a"], { clipboard, raf: (f) => f(), timeoutMs: 20, graceMs: 0, doneWaitMs: 0 });
  assert.equal(clipboardBusy(), true);
  await assert.rejects(failing);
  assert.equal(clipboardBusy(), false);
});
