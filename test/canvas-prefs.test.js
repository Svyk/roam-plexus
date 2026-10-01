import assert from "node:assert/strict";
import test from "node:test";
import { applyCanvasPrefs, captureView, copyText, diagnosticsText, restoreAutomaticView, runNamedAction, shouldReapplyTheme, syncGeneration, themeToApply } from "../src/host/canvas-prefs.js";

test("theme follows the host only when the setting is on and the canvas differs", () => {
  assert.equal(themeToApply({ enabled: false, hostDark: true, currentTheme: "light" }), null);
  assert.equal(themeToApply({ enabled: true, hostDark: true, currentTheme: "dark" }), null);
  assert.equal(themeToApply({ enabled: true, hostDark: true, currentTheme: "light" }), "dark");
  assert.equal(themeToApply({ enabled: true, hostDark: false, currentTheme: "dark" }), "light");
});

test("applyCanvasPrefs writes the theme with captureUpdate NEVER and fits once", () => {
  const scenes = [];
  const fits = [];
  const app = {
    state: { theme: "light" },
    updateScene: (patch) => scenes.push(patch),
    scrollToContent: (target, opts) => fits.push({ target, opts }),
  };
  const applied = applyCanvasPrefs(app, { themeFollow: true, hostDark: true, fitOnOpen: true });
  assert.deepEqual(applied, { theme: "dark", fit: true });
  assert.deepEqual(scenes, [{ appState: { theme: "dark" }, captureUpdate: "NEVER" }]);
  assert.deepEqual(fits, [{ target: undefined, opts: { fitToContent: true, animate: false } }]);
  const again = applyCanvasPrefs({ ...app, state: { theme: "dark" } }, { themeFollow: true, hostDark: true, fitOnOpen: false });
  assert.equal(again.theme, null);
  assert.equal(scenes.length, 1);
});

test("shouldReapplyTheme is only when hydration restored the opening theme", () => {
  const before = { theme: "light" };
  const applied = { theme: "dark", fit: false };
  assert.equal(shouldReapplyTheme(before, { theme: "light" }, applied), true);
  assert.equal(shouldReapplyTheme(before, { theme: "dark" }, applied), false);
  assert.equal(shouldReapplyTheme(before, { theme: "light" }, { theme: null, fit: false }), false);
});

test("restoreAutomaticView reverts an automatic theme and an unmoved fit", () => {
  const scenes = [];
  const app = {
    state: { theme: "light", scrollX: 10, scrollY: 20, zoom: { value: 1 } },
    updateScene(patch) {
      scenes.push(patch);
      if (patch.appState.theme) this.state.theme = patch.appState.theme;
      if ("scrollX" in patch.appState) this.state.scrollX = patch.appState.scrollX;
      if ("scrollY" in patch.appState) this.state.scrollY = patch.appState.scrollY;
      if (patch.appState.zoom) this.state.zoom = patch.appState.zoom;
    },
    scrollToContent() {
      this.state.scrollX = 40;
      this.state.scrollY = 50;
      this.state.zoom = { value: 0.4 };
    },
  };
  const before = captureView(app);
  const applied = applyCanvasPrefs(app, { themeFollow: true, hostDark: true, fitOnOpen: true });
  const after = captureView(app);
  const restored = restoreAutomaticView(app, { before, after, applied });
  assert.deepEqual(restored, { theme: true, camera: true });
  assert.equal(app.state.theme, "light");
  assert.equal(app.state.scrollX, 10);
  assert.equal(app.state.zoom.value, 1);
  assert.equal(scenes.at(-1).captureUpdate, "NEVER");
  applyCanvasPrefs(app, { themeFollow: true, hostDark: true, fitOnOpen: true });
  app.state.scrollX = 99;
  const panned = restoreAutomaticView(app, { before, after, applied });
  assert.equal(panned.camera, false);
  assert.equal(panned.theme, true);
  assert.equal(app.state.scrollX, 99);
  const toggled = restoreAutomaticView(app, { before, after, applied });
  assert.equal(toggled.theme, false);
});

test("runNamedAction executes only a named action that exists", () => {
  const calls = [];
  const app = {
    actionManager: {
      actions: { unlockAllElements: { name: "unlockAllElements" } },
      executeAction: (action, source) => calls.push([action.name, source]),
    },
  };
  assert.equal(runNamedAction(app, "unlockAllElements"), true);
  assert.deepEqual(calls, [["unlockAllElements", "api"]]);
  assert.equal(runNamedAction(app, "toggleElementLock"), false);
  assert.equal(runNamedAction({}, "unlockAllElements"), false);
});

test("syncGeneration bumps when the installed version changes and stays on a repeat", () => {
  const store = new Map();
  const storage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  };
  const first = syncGeneration(storage, "0.16.0");
  assert.deepEqual(first, { generation: 1, bumped: true });
  const second = syncGeneration(storage, "0.16.0");
  assert.deepEqual(second, { generation: 1, bumped: false });
  const third = syncGeneration(storage, "0.17.0");
  assert.deepEqual(third, { generation: 2, bumped: true });
  assert.deepEqual(syncGeneration(null, "0.16.0"), { generation: 0, bumped: false });
});

test("diagnostics text names the generation and copy falls back to a textarea", async () => {
  const text = diagnosticsText({
    version: "0.16.0", generation: 2, themeFollow: true, fitOnOpen: false, editorOpen: true,
    lockActions: ["unlockAllElements"],
  });
  assert.match(text, /generation 2/);
  assert.match(text, /themeFollow on/);
  assert.match(text, /lockActions unlockAllElements/);
  let removed = false;
  const doc = {
    execCommand: () => true,
    body: { append() {} },
    createElement: () => ({ value: "", select() {}, remove() { removed = true; } }),
  };
  assert.equal(await copyText(text, { clipboard: { writeText: async () => { throw new Error("denied"); } }, doc }), "textarea");
  assert.equal(removed, true);
  let written = "";
  assert.equal(await copyText(text, { clipboard: { writeText: async (v) => { written = v; } } }), "clipboard");
  assert.equal(written, text);
});
