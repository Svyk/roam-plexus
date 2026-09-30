import assert from "node:assert/strict";
import test from "node:test";

import extension from "../src/extension.js";

function fakeExtensionApi() {
  const values = new Map();
  const calls = [];
  return {
    calls,
    settings: {
      canSet: true,
      get: (key) => values.get(key) ?? null,
      set: async (key, value) => { values.set(key, value); calls.push(["setting:set", key, value]); return null; },
      panel: {
        create: async (config) => { calls.push(["panel:create", config.tabTitle]); return null; },
      },
    },
    ui: {
      commandPalette: {
        addCommand: async ({ label }) => { calls.push(["command:add", label]); return null; },
        removeCommand: async ({ label }) => { calls.push(["command:remove", label]); return null; },
      },
    },
  };
}

test("extension exports the Roam lifecycle contract and survives repeated unload", async () => {
  assert.equal(typeof extension.onload, "function");
  assert.equal(typeof extension.onunload, "function");

  const api = fakeExtensionApi();
  const cleanup = await extension.onload({ extensionAPI: api, extension: { version: "test" } });
  assert.equal(typeof cleanup, "function");
  await cleanup();
  await extension.onunload();
  await extension.onunload();

  assert.equal(api.calls.filter(([name]) => name === "command:add").length, 2);
  assert.equal(api.calls.filter(([name]) => name === "command:remove").length, 2);
  assert.ok(api.calls.some(([name, label]) => name === "panel:create" && label === "Plexus"));
  assert.deepEqual(api.calls.filter(([name]) => name === "command:add").map(([, label]) => label), ["Plexus: Commands\u2026", "Plexus: Mind map"]);
});

test("a second load disposes the previous runtime before registering again", async () => {
  const firstApi = fakeExtensionApi();
  const secondApi = fakeExtensionApi();

  await extension.onload({ extensionAPI: firstApi, extension: { version: "one" } });
  const cleanup = await extension.onload({ extensionAPI: secondApi, extension: { version: "two" } });

  assert.equal(firstApi.calls.filter(([name]) => name === "command:remove").length, 2);
  assert.equal(secondApi.calls.filter(([name]) => name === "command:add").length, 2);
  await cleanup();
});


test("version flag is set on load and cleared on unload", async () => {
  const api = fakeExtensionApi();
  await extension.onload({ extensionAPI: api, extension: { version: "9.9.9" } });
  assert.equal(globalThis.__ROAM_PLEXUS_VERSION, "9.9.9");
  await extension.onunload();
  assert.equal(globalThis.__ROAM_PLEXUS_VERSION, undefined);
});

// Loads the extension with the command list stubbed; returns the list's commands as captured when "Plexus: Commands\u2026" runs.
async function loadWithCommands(api, callbacks) {
  let captured = null;
  const cleanup = await extension.onload({ extensionAPI: api, extension: { version: "t" }, openCommandList: (o) => { captured = o; return { close() {} }; } });
  const openList = () => {
    callbacks.get("Plexus: Commands\u2026")();
    return new Map(captured.commands.map((c) => [c.label, (...a) => c.run(captured.ctx, ...a)]));
  };
  return { cleanup, openList, captured: () => captured };
}

async function loadWithFakeRoam({ isEncrypted, rows = [] }) {
  const opens = [];
  const removed = [];
  const api = fakeExtensionApi();
  const callbacks = new Map();
  api.ui.commandPalette.addCommand = async ({ label, callback }) => { callbacks.set(label, callback); };
  const body = { append() {}, appendChild() {}, querySelectorAll: () => [] };
  globalThis.document = {
    body,
    defaultView: { MutationObserver: undefined, addEventListener() {}, removeEventListener() {} },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, append() {}, remove() { removed.push(1); }, addEventListener() {}, setAttribute() {} }),
  };
  globalThis.roamAlphaAPI = { graph: { name: "g", isEncrypted }, util: { generateUID: () => "x" }, data: { pull: () => null }, ui: { components: {} } };
  globalThis.indexedDB = { open: () => { opens.push(1); const r = {}; queueMicrotask(() => r.onerror?.()); return r; } };
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  const { openList } = await loadWithCommands(api, callbacks);
  const list = openList();
  await list.get("Clear crop cache")();
  for (const label of rows) await list.get(label)();
  await extension.onunload();
  return { opens };
}

function dropFakeRoam() {
  for (const key of ["document", "roamAlphaAPI", "indexedDB", "MutationObserver"]) delete globalThis[key];
}

test("wired runtime never opens IndexedDB for an encrypted graph", async () => {
  try {
    const { opens } = await loadWithFakeRoam({ isEncrypted: true });
    assert.equal(opens.length, 0);
  } finally {
    dropFakeRoam();
  }
});

test("wired runtime: the P12 rows with no editor open do nothing, leave the snapshot store closed and unload cleanly", async () => {
  try {
    const base = await loadWithFakeRoam({ isEncrypted: false });
    dropFakeRoam();
    const { opens } = await loadWithFakeRoam({
      isEncrypted: false,
      rows: ["Restore an earlier version\u2026", "Cause-and-effect from JSON\u2026", "Mind map layout: Cause", "Mind map: attribute blocks as edges"],
    });
    assert.equal(opens.length, base.opens.length, "only the crop cache opens IndexedDB, not the snapshot store");
  } finally {
    dropFakeRoam();
  }
});

test("wired runtime persists crops for an unencrypted graph", async () => {
  try {
    const { opens } = await loadWithFakeRoam({ isEncrypted: false });
    assert.ok(opens.length > 0);
  } finally {
    dropFakeRoam();
  }
});

test("load registers the block context menu command and RoamPlexus; unload removes both", async () => {
  const menu = [];
  const g = globalThis;
  const saved = { doc: g.document, api: g.roamAlphaAPI, mo: g.MutationObserver };
  g.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  const noop = () => {};
  const docListeners = new Set();
  g.document = {
    body: { append: noop },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, append: noop, addEventListener: noop, removeEventListener: noop, setAttribute: noop }),
    addEventListener: (t, f) => docListeners.add(f),
    removeEventListener: (t, f) => docListeners.delete(f),
    defaultView: { addEventListener: noop, removeEventListener: noop, getComputedStyle: () => ({}) },
  };
  g.roamAlphaAPI = {
    graph: { name: "g" },
    data: { pull: () => null, q: () => [], addPullWatch: noop, removePullWatch: noop },
    ui: { blockContextMenu: {
      addCommand: (c) => menu.push(["add", c.label]),
      removeCommand: (c) => menu.push(["remove", c?.label]),
    } },
  };
  try {
    const cleanup = await extension.onload({ extensionAPI: fakeExtensionApi(), extension: { version: "t" } });
    assert.ok(menu.some(([k, l]) => k === "add" && l === "Plexus: Region on image"));
    assert.ok(docListeners.size > 0, "suggest auto-attach registered");
    assert.ok(g.RoamPlexus || g.window?.RoamPlexus, "RoamPlexus installed");
    await cleanup();
    assert.ok(menu.some(([k, l]) => k === "remove" && l === "Plexus: Region on image"));
    assert.ok(!g.RoamPlexus && !g.window?.RoamPlexus);
    assert.equal(docListeners.size, 0, "no document listeners left");
  } finally {
    if (saved.doc === undefined) delete g.document; else g.document = saved.doc;
    if (saved.mo === undefined) delete g.MutationObserver; else g.MutationObserver = saved.mo;
    if (saved.api === undefined) delete g.roamAlphaAPI; else g.roamAlphaAPI = saved.api;
  }
});

test("the palette holds two commands and only Mind map carries a default hotkey; the slash command registers and unregisters", async () => {
  const api = fakeExtensionApi();
  const added = new Map();
  const slash = [];
  api.ui.commandPalette.addCommand = async (config) => { added.set(config.label, config); };
  api.ui.slashCommand = {
    addCommand: async ({ label }) => { slash.push(["add", label]); },
    removeCommand: async ({ label }) => { slash.push(["remove", label]); },
  };
  const cleanup = await extension.onload({ extensionAPI: api, extension: { version: "t" } });
  assert.deepEqual([...added.keys()], ["Plexus: Commands\u2026", "Plexus: Mind map"]);
  assert.equal(added.get("Plexus: Mind map")["default-hotkey"], "alt-shift-m");
  assert.equal([...added.values()].filter((c) => c["default-hotkey"]).length, 1);
  assert.deepEqual(slash, [["add", "Sketch here"]]);
  await cleanup();
  assert.deepEqual(slash, [["add", "Sketch here"], ["remove", "Sketch here"]]);
});

test("a missing slash command API only warns; load still succeeds", async () => {
  const api = fakeExtensionApi();
  const warnings = [];
  const warn = console.warn;
  console.warn = (...a) => warnings.push(a.join(" "));
  try {
    const cleanup = await extension.onload({ extensionAPI: api, extension: { version: "t" } });
    await cleanup();
  } finally {
    console.warn = warn;
  }
  assert.ok(warnings.some((w) => w.includes("[plexus] slash command unavailable")));
});

test("the four New drawing list commands reach newDrawing with here, below, page and today", async () => {
  const g = globalThis;
  const saved = { doc: g.document, api: g.roamAlphaAPI, mo: g.MutationObserver };
  g.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  const noop = () => {};
  g.document = {
    body: { append: noop },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, append: noop, remove: noop, addEventListener: noop, removeEventListener: noop, setAttribute: noop }),
    addEventListener: noop,
    removeEventListener: noop,
    defaultView: { addEventListener: noop, removeEventListener: noop, getComputedStyle: () => ({}) },
  };
  const creates = [];
  const pages = [];
  let n = 0;
  const pull = (pattern, [, key]) => {
    if (key === "focus0001") return { ":block/uid": "focus0001", ":block/string": "text", ":block/order": 2, ":block/_children": [{ ":block/uid": "parent001", ":block/string": "p" }], ":block/page": { ":block/uid": "pageuid01", ":node/title": "Notes" } };
    return null;
  };
  g.roamAlphaAPI = {
    graph: { name: "g" },
    util: {
      generateUID: () => `gen00000${++n}`,
      dateToPageTitle: () => "September 29th, 2026",
      dateToPageUid: () => "09-29-2026",
      pageTitleToDate: () => null,
    },
    data: {
      pull, q: () => [], addPullWatch: noop, removePullWatch: noop,
      page: { create: async ({ page }) => { pages.push(page.title); } },
      block: { create: async (o) => { creates.push(o.location); } },
    },
    ui: { getFocusedBlock: () => ({ "block-uid": "focus0001" }), blockContextMenu: { addCommand: noop, removeCommand: noop } },
  };
  const api = fakeExtensionApi();
  const callbacks = new Map();
  api.ui.commandPalette.addCommand = async ({ label, callback }) => { callbacks.set(label, callback); };
  try {
    const { cleanup, openList } = await loadWithCommands(api, callbacks);
    const list = openList();
    const settle = () => new Promise((r) => setTimeout(r, 1700));
    list.get("New drawing here")();
    await settle();
    assert.deepEqual(creates.at(-1), { "parent-uid": "focus0001", order: 0 });
    list.get("New drawing below")();
    await settle();
    assert.deepEqual(creates.at(-1), { "parent-uid": "parent001", order: 3 });
    list.get("New drawing on page")();
    await settle();
    assert.ok(pages.some((t) => t.startsWith("Drawings/")), "page drawing is titled under Drawings/");
    list.get("New drawing on today")();
    await settle();
    assert.ok(pages.includes("September 29th, 2026"), "today ensures the daily page");
    await cleanup();
  } finally {
    if (saved.doc === undefined) delete g.document; else g.document = saved.doc;
    if (saved.mo === undefined) delete g.MutationObserver; else g.MutationObserver = saved.mo;
    if (saved.api === undefined) delete g.roamAlphaAPI; else g.roamAlphaAPI = saved.api;
  }
});

test("Sketch here returns an empty string so Roam removes the typed slash text", async () => {
  const api = fakeExtensionApi();
  let cb;
  api.ui.slashCommand = { addCommand: async (c) => { cb = c.callback; }, removeCommand: async () => {} };
  const cleanup = await extension.onload({ extensionAPI: api, extension: { version: "t" } });
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(cb({ "block-uid": "abcdefghi" }), "");
  } finally {
    console.warn = warn;
  }
  await cleanup();
});

test("the command list carries all 39 labels and hotkeys, and captures the focused block when Commands\u2026 runs", async () => {
  const g = globalThis;
  const saved = g.roamAlphaAPI;
  let focused = "first0001";
  g.roamAlphaAPI = { ui: { getFocusedBlock: () => ({ "block-uid": focused }) } };
  const api = fakeExtensionApi();
  const callbacks = new Map();
  api.ui.commandPalette.addCommand = async ({ label, callback }) => { callbacks.set(label, callback); };
  try {
    const { cleanup, openList, captured } = await loadWithCommands(api, callbacks);
    openList();
    focused = "second001";
    const { commands, ctx, doc } = captured();
    assert.deepEqual(ctx, { focusedUid: "first0001" });
    assert.equal(doc, undefined);
    assert.deepEqual(commands.map((c) => c.label), [
      "New drawing here", "New drawing below", "New drawing on page", "New drawing on today",
      "Create region from selection", "Create image region", "Regions for all frames", "Mind map", "Mind map from outline",
      "Embed page or block\u2026", "New note card", "Present open drawing", "Present from here", "Present this outline", "Print frames\u2026", "PNG per frame", "Make slide", "Back to previous view", "Toggle regions layer",
      "Toggle outline dock", "Outline dock: show parent",
      "Refresh crops for open drawing", "Clear crop cache", "Audit regions on this page", "Audit regions in graph",
      "Restore before last Plexus change",
      "Restore an earlier version\u2026", "Cause-and-effect from JSON\u2026", "Drawing to outline\u2026", "Copy as Roam markdown",
      "Mind map layout: Right", "Mind map layout: Cause", "Mind map layout: Fishbone", "Mind map layout: Flow",
      "Insert template\u2026", "New drawing from template\u2026", "Save selection as template\u2026", "Mind map: attribute blocks as edges",
      "Clear placeholder captions (dry run)", "Undo caption cleanup", "Legacy drawings (dry run)", "Show in Compass", "Region settings",
    ]);
    assert.deepEqual(Object.fromEntries(commands.filter((c) => c.hotkey).map((c) => [c.label, c.hotkey])), {
      "Create region from selection": "Shift+Alt+R",
      "Create image region": "Shift+Alt+I",
      "Mind map": "Shift+Alt+M",
      "Embed page or block\u2026": "Shift+Alt+E",
      "New note card": "Shift+Alt+N",
      "Present open drawing": "Shift+Alt+P",
      "Toggle outline dock": "Shift+Alt+O",
    });
    await cleanup();
  } finally {
    if (saved === undefined) delete g.roamAlphaAPI; else g.roamAlphaAPI = saved;
  }
});

async function mountFakeEditor({ isEncrypted }) {
  const subs = { count: 0 };
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...a) => warns.push(a.map(String).join(" "));
  const api = fakeExtensionApi();
  const app = {
    state: { isLoading: false, selectedElementIds: {}, zoom: { value: 1 }, scrollX: 0, scrollY: 0, width: 800, height: 600, offsetLeft: 0, offsetTop: 0 },
    actionManager: {},
    files: {},
    scene: { getSceneNonce: () => 1 },
    getSceneElementsIncludingDeleted: () => [],
    updateScene() {},
    onChangeEmitter: { on: () => { subs.count += 1; return () => { subs.count -= 1; }; } },
    onScrollChangeEmitter: { on: () => () => {} },
    onPointerDownEmitter: { on: () => () => {} },
    onPointerUpEmitter: { on: () => () => {} },
  };
  const outer = {
    closest: () => null, classList: { contains: () => false, add() {}, remove() {} }, style: {},
    addEventListener() {}, removeEventListener() {}, append() {}, appendChild() {}, setAttribute() {}, querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  };
  const editorEl = {
    __reactFiber$t: { stateNode: app },
    isConnected: true,
    closest: (sel) => (sel.includes("outer-container") && !sel.includes("plexus") ? outer : sel.includes("block-input-") ? { id: "block-input-abcdefghi" } : null),
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, focus() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  };
  const fakeNode = () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 30 }), querySelector: () => null, querySelectorAll: () => [], contains: () => false, style: {}, classList: { add() {}, remove() {} }, append() {}, appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {}, setAttribute() {} });
  const body = { append() {}, appendChild() {}, querySelectorAll: (sel) => (String(sel).includes(".excalidraw-outer-container.full-screen .excalidraw") ? [editorEl] : []) };
  globalThis.document = {
    body,
    defaultView: { MutationObserver: undefined, addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, getComputedStyle: () => ({ zIndex: "1000", getPropertyValue: () => "" }), requestAnimationFrame: (fn) => setTimeout(fn, 0), cancelAnimationFrame: clearTimeout, innerWidth: 1000, innerHeight: 800 },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
    createElement: fakeNode,
  };
  globalThis.roamAlphaAPI = { graph: { name: "g", isEncrypted }, util: { generateUID: () => "x" }, data: { pull: () => null }, ui: { components: {} } };
  globalThis.indexedDB = { open: () => { const r = {}; queueMicrotask(() => r.onerror?.()); return r; } };
  globalThis.IDBKeyRange = { bound: (lower, upper) => ({ lower, upper }) };
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  try {
    await extension.onload({ extensionAPI: api, extension: { version: "t" } });
    await new Promise((r) => setTimeout(r, 20));
    const during = subs.count;
    await extension.onunload();
    return { during, after: subs.count, warns };
  } finally {
    console.warn = origWarn;
    delete globalThis.IDBKeyRange;
  }
}

test("wired runtime with a mounted editor: a snapshot scheduler subscribes only on an unencrypted graph and unsubscribes on unload", async () => {
  try {
    const open = await mountFakeEditor({ isEncrypted: false });
    dropFakeRoam();
    const locked = await mountFakeEditor({ isEncrypted: true });
    assert.ok(open.during > locked.during, `open ${open.during} locked ${locked.during} ${open.warns.join("|")}`);
    assert.equal(open.after, 0);
    assert.equal(locked.after, 0);
  } finally {
    dropFakeRoam();
  }
});
