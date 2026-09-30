import test from "node:test";
import assert from "node:assert/strict";
import { captureSelectionPng, captureSelectionSvg, clipboardBusy, readPngSize } from "../src/host/native.js";

function makeApp({ blob = { type: "image/png", size: 4 }, silent = false, throwOnExecute = false, extra = {} } = {}) {
  const app = {
    state: { selectedElementIds: { keep: true }, selectedGroupIds: { g: true }, exportScale: 1, exportWithDarkMode: false, ...extra },
    updates: [],
    updateScene(u) { this.updates.push(u); Object.assign(this.state, u.appState); },
    getSceneElementsIncludingDeleted: () => [{ id: "a" }],
    actionManager: {
      actions: { copyAsPng: { name: "copyAsPng" }, copyAsSvg: { name: "copyAsSvg" } },
      executeAction: async (action, source) => {
        app.executed = [action.name, source, { scale: app.state.exportScale, dark: app.state.exportWithDarkMode }];
        if (throwOnExecute) throw new Error("exec failed");
        if (!silent) await app.clipboard.write([{ types: ["image/png"], getType: async () => blob }]);
      },
    },
  };
  return app;
}

const makeClipboard = () => ({ writeText: async () => "orig-text", write: async () => "orig-write" });
const opts = (clipboard, more = {}) => ({ clipboard, raf: (cb) => cb(), timeoutMs: 200, graceMs: 0, ...more });

test("captureSelectionPng sets scale/dark with the selection in one updateScene and returns the png blob", async () => {
  const blob = { type: "image/png", size: 9 };
  const app = makeApp({ blob });
  const clipboard = makeClipboard();
  app.clipboard = clipboard;
  const out = await captureSelectionPng(app, ["a", "b"], opts(clipboard, { scale: 3, dark: true }));
  assert.equal(out, blob);
  assert.deepEqual(app.executed, ["copyAsPng", "contextMenu", { scale: 3, dark: true }]);
  assert.deepEqual(app.updates[0].appState, { selectedElementIds: { a: true, b: true }, selectedGroupIds: {}, exportScale: 3, exportWithDarkMode: true });
});

test("captureSelectionPng restores export keys inside the clipboard stub, then selection and toast in finally", async () => {
  const app = makeApp();
  const clipboard = makeClipboard();
  app.clipboard = clipboard;
  await captureSelectionPng(app, ["a"], opts(clipboard));
  assert.equal(app.state.exportScale, 1);
  assert.equal(app.state.exportWithDarkMode, false);
  assert.deepEqual(app.state.selectedElementIds, { keep: true });
  assert.deepEqual(app.state.selectedGroupIds, { g: true });
  assert.equal(app.state.toast, null);
  assert.equal(await clipboard.write(), "orig-write");
  // the stub's own restore is the second update, before the finally one
  assert.deepEqual(app.updates[1].appState, { exportScale: 1, exportWithDarkMode: false });
});

test("captureSelectionPng leaves writeText alone and reads prev from state at run time", async () => {
  const app = makeApp({ extra: { exportScale: 2, exportWithDarkMode: true } });
  const clipboard = makeClipboard();
  app.clipboard = clipboard;
  const text = clipboard.writeText;
  await captureSelectionPng(app, ["a"], opts(clipboard, { scale: 3 }));
  assert.equal(clipboard.writeText, text);
  assert.equal(app.state.exportScale, 2);
  assert.equal(app.state.exportWithDarkMode, true);
});

test("captureSelectionPng resolves null (never throws) on missing clipboard, exec failure and timeout, restoring state", async () => {
  assert.equal(await captureSelectionPng(makeApp(), ["a"], { clipboard: undefined }), null);
  const failing = makeApp({ throwOnExecute: true });
  const c1 = makeClipboard();
  failing.clipboard = c1;
  assert.equal(await captureSelectionPng(failing, ["a"], opts(c1)), null);
  assert.equal(failing.state.exportScale, 1);
  assert.deepEqual(failing.state.selectedElementIds, { keep: true });
  assert.equal(await c1.write(), "orig-write");
  const silent = makeApp({ silent: true });
  const c2 = makeClipboard();
  silent.clipboard = c2;
  assert.equal(await captureSelectionPng(silent, ["a"], opts(c2, { timeoutMs: 20 })), null);
  assert.equal(silent.state.exportScale, 1);
  assert.equal(await c2.write(), "orig-write");
});

test("after a timeout the grace stub swallows only image/png writes", async () => {
  const app = makeApp({ silent: true });
  const clipboard = makeClipboard();
  app.clipboard = clipboard;
  const p = captureSelectionPng(app, ["a"], opts(clipboard, { timeoutMs: 10, graceMs: 60 }));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(await clipboard.write([{ types: ["image/png"], getType: async () => ({}) }]), undefined);
  assert.equal(await clipboard.write([{ types: ["text/plain"] }]), "orig-write");
  assert.equal(await p, null);
  assert.equal(await clipboard.write([{ types: ["image/png"] }]), "orig-write");
});

test("png captures queue behind svg captures, set clipboardBusy and never overlap", async () => {
  const order = [];
  const clipboard = makeClipboard();
  const svgApp = makeApp();
  svgApp.clipboard = clipboard;
  svgApp.actionManager.executeAction = async () => {
    order.push("svg-start");
    await new Promise((r) => setTimeout(r, 15));
    await clipboard.writeText("<svg/>");
    order.push("svg-end");
  };
  const pngApp = makeApp();
  pngApp.clipboard = clipboard;
  const base = pngApp.actionManager.executeAction;
  pngApp.actionManager.executeAction = async (...a) => { order.push("png-start"); await base(...a); order.push("png-end"); };
  const o = opts(clipboard, { timeoutMs: 500 });
  const a = captureSelectionSvg(svgApp, ["a"], o);
  const b = captureSelectionPng(pngApp, ["a"], o);
  assert.equal(clipboardBusy(), true);
  await Promise.all([a, b]);
  assert.deepEqual(order, ["svg-start", "svg-end", "png-start", "png-end"]);
  assert.equal(clipboardBusy(), false);
});

test("readPngSize reads width and height from the IHDR chunk and rejects non-PNG", async () => {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 360);
  view.setUint32(20, 240);
  assert.deepEqual(await readPngSize(new Blob([bytes])), { w: 360, h: 240 });
  assert.equal(await readPngSize(new Blob(["nope"])), null);
  assert.equal(await readPngSize(null), null);
});

test("captureSelectionPng waits for the late action result so its stale appState cannot re-apply the temporary state", async () => {
  const app = makeApp();
  const clipboard = makeClipboard();
  app.clipboard = clipboard;
  const tick = () => Promise.resolve();
  const origUpdater = function (r) { if (r?.then) r.then((v) => v?.appState && app.updateScene({ appState: v.appState })); };
  app.actionManager.updater = origUpdater;
  app.actionManager.executeAction = function (action) {
    const snap = { ...app.state };
    this.updater((async () => {
      await clipboard.write([{ types: ["image/png"], getType: async () => ({ type: "image/png" }) }]);
      await tick(); await tick(); await tick();
      return { appState: { ...snap, toast: { message: "Copied" } } };
    })());
  };
  app.actionManager.executeAction = app.actionManager.executeAction.bind(app.actionManager);
  app.state.selectedElementIds = { keep: true };
  await captureSelectionPng(app, ["a"], opts(clipboard, { scale: 2, dark: true }));
  assert.equal(app.state.exportScale, 1);
  assert.equal(app.state.exportWithDarkMode, false);
  assert.deepEqual(app.state.selectedElementIds, { keep: true });
  assert.equal(app.state.toast, null);
  assert.equal(app.actionManager.updater, origUpdater);
});
