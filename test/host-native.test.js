import test from "node:test";
import assert from "node:assert/strict";
import { findApp, activeEditor, selectedElementIds, captureSelectionSvg } from "../src/host/native.js";

function makeApp({ svg = "<svg/>", throwOnExecute = false, silent = false } = {}) {
  const app = {
    state: { selectedElementIds: { keep: true }, selectedGroupIds: { g: true } },
    updates: [],
    updateScene(u) { this.updates.push(u); Object.assign(this.state, u.appState); },
    getSceneElementsIncludingDeleted: () => [{ id: "a" }, { id: "gone", isDeleted: true }],
    actionManager: {
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
  const el = { "__reactFiber$q": { stateNode: app }, closest: () => outer };
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
  await assert.rejects(captureSelectionSvg(app, ["a"], { clipboard, raf: (cb) => cb(), timeoutMs: 20 }), /no SVG/);
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
      await clipboard.writeText(name);
      order.push(`end-${name}`);
    };
    return app;
  };
  const opts = { clipboard, raf: (cb) => cb(), timeoutMs: 500 };
  const [a, b] = await Promise.all([captureSelectionSvg(mk("A"), ["a"], opts), captureSelectionSvg(mk("B"), ["a"], opts)]);
  assert.equal(a, "A");
  assert.equal(b, "B");
  assert.deepEqual(order, ["start-A", "end-A", "start-B", "end-B"]);
});
