import assert from "node:assert/strict";
import test from "node:test";

import extension, { attachLazyPalette } from "../src/extension.js";
import { createLifecycle } from "../src/lifecycle.js";
import { cardsFromChildren, cardsFromQuery } from "../src/query-cards.js";
import { relationPlan } from "../src/relations.js";
import { lockName } from "../src/host/locks.js";
import { viewportToScene } from "../src/model/scene.js";
import { focusKeptIds, todoKeptIds } from "../src/view/spotlight.js";

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

test("palette commands leave the scan list on the next turn and come back for Cmd+P", async () => {
  const lifecycle = createLifecycle();
  const added = [];
  const removed = [];
  const palette = {
    addCommand(command) { added.push(command.label); },
    removeCommand(command) { removed.push(command.label); },
  };
  const listeners = [];
  let paletteEl = null;
  const doc = {
    addEventListener(type, fn) { listeners.push({ type, fn }); },
    removeEventListener() {},
    querySelector(sel) { return sel === ".rm-command-palette" ? paletteEl : null; },
  };
  const minds = [];
  attachLazyPalette({
    doc,
    palette,
    lifecycle,
    commands: [
      { label: "Plexus: Commands\u2026", callback() {} },
      { label: "Plexus: Mind map", callback() {}, "default-hotkey": "alt-shift-m" },
    ],
    onMindMap: () => { minds.push(1); return true; },
  });
  assert.deepEqual(added, ["Plexus: Commands\u2026", "Plexus: Mind map"]);
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(removed, ["Plexus: Commands\u2026", "Plexus: Mind map"]);
  const keydown = listeners.find((entry) => entry.type === "keydown").fn;
  keydown({ key: "p", metaKey: true, altKey: false, shiftKey: false, ctrlKey: false });
  assert.equal(added.length, 4);
  let prevented = 0;
  keydown({
    key: "µ", code: "KeyM", altKey: true, shiftKey: true, ctrlKey: false, metaKey: false,
    preventDefault() { prevented += 1; },
    stopImmediatePropagation() {},
  });
  assert.equal(minds.length, 1);
  assert.equal(prevented, 1);
  keydown({ key: "a", code: "KeyA", altKey: false, shiftKey: false });
  assert.equal(minds.length, 1);
  paletteEl = {};
  listeners.find((entry) => entry.type === "keyup").fn();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(removed.length, 2);
  paletteEl = null;
  listeners.find((entry) => entry.type === "pointerup").fn();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(removed.length, 4);
  await lifecycle.dispose();
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

test("the command list carries all 64 labels and hotkeys, and captures the focused block when Commands\u2026 runs", async () => {
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
      "Embed page or block\u2026", "New note card", "Present open drawing", "Present from here", "Present this outline", "Present live", "Export drawing\u2026", "Export scene", "Import scene\u2026", "Tag elements\u2026", "Show only tag\u2026", "Keep export image", "Keep linked references", "Print frames\u2026", "PNG per frame", "Make slide", "Back to previous view", "Toggle regions layer",
      "Toggle outline dock", "Outline dock: show parent",
      "Refresh crops for open drawing", "Clear crop cache", "Audit regions on this page", "Audit regions in graph",
      "Restore before last Plexus change",
      "Restore an earlier version\u2026", "Cause-and-effect from JSON\u2026", "Drawing to outline\u2026", "Copy as Roam markdown",
      "Mind map layout: Right", "Mind map layout: Cause", "Mind map layout: Fishbone", "Mind map layout: Flow",
      "Insert template\u2026", "New drawing from template\u2026", "Save selection as template\u2026", "Mind map: attribute blocks as edges",
      "Clear placeholder captions (dry run)", "Undo caption cleanup", "Legacy drawings (dry run)",
      "Focus mode", "Todo mode", "Embed query results", "Embed page children", "Link selected", "Filter regions by tag",
      "Lock or unlock selection", "Unlock all", "Copy diagnostics", "Where is this cited?",
      "Show in Compass", "Turn into page", "Insert image or drawing\u2026", "Drawing name\u2026", "Region settings",
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

function rawBlock(uid, string = "", children = [], { pageUid = "pageuid01", pageTitle = "Notes", title = null } = {}) {
  return {
    ":block/uid": uid,
    ":block/string": string,
    ":block/order": 0,
    ":edit/time": 1,
    ":block/open": true,
    ...(title == null ? {} : { ":node/title": title }),
    ":block/children": children.map((c, i) => ({
      ":block/uid": c.uid,
      ":block/string": c.string ?? "",
      ":block/order": c.order ?? i,
    })),
    ":block/_children": [{ ":block/uid": "parent001", ":block/string": "Parent" }],
    ":block/page": { ":block/uid": pageUid, ":node/title": pageTitle },
  };
}

function placedShape(el) {
  return {
    type: el.type,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    link: el.link ?? null,
    text: el.text ?? null,
    embed: el.customData?.plexus?.embed ?? null,
    query: el.customData?.plexus?.query ?? null,
  };
}

function holeCount(el) {
  return (String(el?.style?.clipPath || "").match(/px/g) || []).length / 10;
}

function makeNode() {
  const node = {
    style: {},
    className: "",
    textContent: "",
    children: [],
    attrs: {},
    listeners: [],
    removed: false,
    append(...kids) { node.children.push(...kids); },
    appendChild(kid) { node.children.push(kid); return kid; },
    remove() { node.removed = true; },
    addEventListener(type, fn) { node.listeners.push({ type, fn }); },
    removeEventListener(type, fn) { node.listeners = node.listeners.filter((e) => e.type !== type || e.fn !== fn); },
    setAttribute(name, value) { node.attrs[name] = value; if (name === "class") node.className = value; },
    getAttribute(name) { return name in node.attrs ? node.attrs[name] : null; },
    classList: { add() {}, remove() {}, contains: () => false },
    querySelector: () => null,
    querySelectorAll: () => [],
    contains: () => false,
    closest: () => null,
    focus() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 30 }),
  };
  return node;
}

async function withCanvas(run) {
  const g = globalThis;
  const saved = {
    doc: g.document, api: g.roamAlphaAPI, mo: g.MutationObserver,
    idb: g.indexedDB, range: g.IDBKeyRange, confirm: g.confirm,
  };
  const nodes = [];
  const creates = [];
  const deletes = [];
  const undos = [];
  const confirms = [];
  const queries = [];
  const pulls = [];
  const scrollSubs = [];
  const docListeners = [];
  const blocks = new Map();
  let scene = [];
  let sceneWrites = 0;
  let focused = "";
  let queryRows = [];
  let seq = 0;
  const noop = () => {};
  const blockNode = { id: "block-input-draw00001" };
  const outer = {
    closest: (sel) => (String(sel).includes("block-input-") ? blockNode : null),
    classList: { contains: () => false, add() {}, remove() {} },
    style: {},
    addEventListener() {}, removeEventListener() {}, append() {}, appendChild() {}, setAttribute() {},
    querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  };
  const app = {
    state: { isLoading: false, selectedElementIds: {}, zoom: { value: 1 }, scrollX: 0, scrollY: 0, width: 800, height: 600, offsetLeft: 0, offsetTop: 0 },
    actionManager: {},
    files: {},
    scene: { getSceneNonce: () => 1 },
    getSceneElementsIncludingDeleted: () => scene,
    updateScene(patch) { if (patch && Object.prototype.hasOwnProperty.call(patch, "elements")) { sceneWrites += 1; scene = patch.elements; } },
    onChangeEmitter: { on: () => () => {} },
    onScrollChangeEmitter: { on: (cb) => { scrollSubs.push(cb); return () => { const i = scrollSubs.indexOf(cb); if (i >= 0) scrollSubs.splice(i, 1); }; } },
    onPointerDownEmitter: { on: () => () => {} },
    onPointerUpEmitter: { on: () => () => {} },
  };
  const editorEl = {
    __reactFiber$t: { stateNode: app },
    isConnected: true,
    closest: (sel) => {
      const s = String(sel);
      if (s.includes("plexus")) return null;
      if (s.includes("outer-container")) return outer;
      if (s.includes("block-input-")) return blockNode;
      return null;
    },
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, focus() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  };
  const body = {
    append() {}, appendChild() {},
    querySelectorAll: (sel) => {
      const s = String(sel);
      return s.includes("full-screen") && s.includes("excalidraw") ? [editorEl] : [];
    },
  };
  g.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  g.confirm = () => { confirms.push(1); return false; };
  g.document = {
    body,
    defaultView: {
      MutationObserver: undefined,
      addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
      getComputedStyle: () => ({ zIndex: "1000", getPropertyValue: () => "" }),
      requestAnimationFrame: (fn) => setTimeout(fn, 0),
      cancelAnimationFrame: clearTimeout,
      innerWidth: 1000, innerHeight: 800,
      navigator: { platform: "MacIntel" },
    },
    querySelector: (sel) => {
      const s = String(sel);
      return s.includes("full-screen") && s.includes("excalidraw") ? editorEl : null;
    },
    querySelectorAll: () => [],
    addEventListener(type, fn, opts) { docListeners.push({ type, fn, opts }); },
    removeEventListener(type, fn) {
      const i = docListeners.findIndex((e) => e.type === type && e.fn === fn);
      if (i >= 0) docListeners.splice(i, 1);
    },
    createElement: () => { const node = makeNode(); nodes.push(node); return node; },
  };
  g.roamAlphaAPI = {
    graph: { name: "g", isEncrypted: false },
    util: { generateUID: () => `u${String(++seq).padStart(8, "0")}` },
    data: {
      pull: (_pattern, lookup) => {
        const uid = Array.isArray(lookup) ? lookup[1] : null;
        pulls.push(uid);
        return blocks.get(uid) ?? null;
      },
      q: () => [],
      addPullWatch: noop,
      removePullWatch: noop,
      roamQuery: async (args) => { queries.push(args); return queryRows; },
      undo: () => { undos.push(1); },
      block: {
        create: async (o) => { creates.push(o); },
        delete: async (o) => { deletes.push(o?.block?.uid); },
        update: () => { throw new Error("rewrite"); },
      },
    },
    ui: {
      getFocusedBlock: () => (focused ? { "block-uid": focused } : null),
      components: {},
    },
  };
  g.indexedDB = { open: () => { const r = {}; queueMicrotask(() => r.onerror?.()); return r; } };
  g.IDBKeyRange = { bound: (lower, upper) => ({ lower, upper }) };
  const api = fakeExtensionApi();
  const callbacks = new Map();
  api.ui.commandPalette.addCommand = async ({ label, callback }) => { callbacks.set(label, callback); };
  let cleanup = async () => {};
  try {
    const loaded = await loadWithCommands(api, callbacks);
    cleanup = loaded.cleanup;
    await new Promise((r) => setTimeout(r, 30));
    const armed = sceneWrites;
    await run({
      openList: loaded.openList,
      app, nodes, creates, deletes, undos, confirms, queries, pulls, scrollSubs, docListeners, blocks,
      setScene: (els) => { scene = els; },
      getScene: () => scene,
      sceneWrites: () => sceneWrites - armed,
      setFocused: (uid) => { focused = uid; },
      setQueryRows: (rows) => { queryRows = rows; },
    });
  } finally {
    await cleanup();
    if (saved.doc === undefined) delete g.document; else g.document = saved.doc;
    if (saved.mo === undefined) delete g.MutationObserver; else g.MutationObserver = saved.mo;
    if (saved.api === undefined) delete g.roamAlphaAPI; else g.roamAlphaAPI = saved.api;
    if (saved.idb === undefined) delete g.indexedDB; else g.indexedDB = saved.idb;
    if (saved.range === undefined) delete g.IDBKeyRange; else g.IDBKeyRange = saved.range;
    if (saved.confirm === undefined) delete g.confirm; else g.confirm = saved.confirm;
  }
}

function liveVeils(nodes) {
  return nodes.filter((n) => String(n.className).includes("plexus-focus-veil") && !n.removed);
}

function viewOrigin(app) {
  const st = app.state || {};
  return viewportToScene({
    x: (st.offsetLeft || 0) + (st.width || 0) / 2,
    y: (st.offsetTop || 0) + (st.height || 0) / 2,
    appState: st,
  });
}

test("phase 15 commands with no editor toast and write nothing", async () => {
  try {
    await loadWithFakeRoam({
      isEncrypted: false,
      rows: ["Focus mode", "Todo mode", "Embed query results", "Embed page children", "Link selected", "Filter regions by tag"],
    });
  } finally {
    dropFakeRoam();
  }
});

test("focus mode cycles depth, moves holes from the viewport, and Escape resets it", async () => {
  const elements = [
    { id: "A", type: "rectangle", x: 0, y: 0, width: 10, height: 10, boundElements: [{ id: "ab", type: "arrow" }] },
    { id: "ab", type: "arrow", x: 30, y: 0, width: 10, height: 10, points: [[0, 0], [10, 10]], startBinding: { elementId: "A" }, endBinding: { elementId: "B" } },
    { id: "B", type: "rectangle", x: 60, y: 0, width: 10, height: 10, boundElements: [{ id: "ab", type: "arrow" }, { id: "bc", type: "arrow" }] },
    { id: "bc", type: "arrow", x: 90, y: 0, width: 10, height: 10, points: [[0, 0], [10, 10]], startBinding: { elementId: "B" }, endBinding: { elementId: "C" } },
    { id: "C", type: "rectangle", x: 120, y: 0, width: 10, height: 10, boundElements: [{ id: "bc", type: "arrow" }] },
  ];
  const depth1 = focusKeptIds(elements, ["A"], 1);
  const depth2 = focusKeptIds(elements, ["A"], 2);
  await withCanvas(async ({ openList, app, nodes, setScene, scrollSubs, docListeners, sceneWrites, confirms, undos }) => {
    setScene(elements);
    app.state.selectedElementIds = { A: true };
    const list = openList();
    const seen = new Set(docListeners);
    list.get("Focus mode")();
    const veil = liveVeils(nodes).at(-1);
    assert.equal(veil.style.pointerEvents, "none");
    assert.match(veil.className, /plexus-focus-veil/);
    assert.doesNotMatch(veil.className, /spotlight/);
    assert.equal(holeCount(veil), depth1.length);
    const clip = veil.style.clipPath;
    app.state.scrollX = 25;
    assert.ok(scrollSubs.length > 0);
    for (const cb of scrollSubs) cb();
    assert.notEqual(veil.style.clipPath, clip);
    for (const entry of docListeners) {
      if (!seen.has(entry) && entry.type === "keydown") entry.fn({ key: "Escape" });
    }
    assert.equal(veil.removed, true);
    list.get("Focus mode")();
    assert.equal(holeCount(liveVeils(nodes).at(-1)), depth1.length);
    list.get("Focus mode")();
    assert.equal(holeCount(liveVeils(nodes).at(-1)), depth2.length);
    assert.ok(depth2.length > depth1.length);
    list.get("Focus mode")();
    list.get("Focus mode")();
    list.get("Focus mode")();
    assert.equal(liveVeils(nodes).length, 0);
    assert.equal(sceneWrites(), 0);
    assert.equal(confirms.length, 0);
    assert.equal(undos.length, 0);
  });
});

test("todo mode lights open TODOs from element text and embed blocks", async () => {
  const embedUid = "bbbbbbbbb";
  const elements = [
    { id: "t1", type: "rectangle", x: 0, y: 0, width: 10, height: 10, text: "{{[[TODO]]}} write" },
    { id: "e1", type: "rectangle", x: 40, y: 0, width: 10, height: 10, text: "card", customData: { plexus: { embed: `((${embedUid}))` } } },
    { id: "x1", type: "rectangle", x: 80, y: 0, width: 10, height: 10, text: "{{[[TODO]]}} later #[[task-status/Cancelled]]" },
    { id: "d1", type: "rectangle", x: 120, y: 0, width: 10, height: 10, text: "{{[[DONE]]}} wrote" },
  ];
  const textOf = (el) => (el.customData?.plexus?.embed === `((${embedUid}))` ? "{{[[TODO]]}} from block" : (el.text ?? ""));
  const kept = todoKeptIds(elements, textOf);
  await withCanvas(async ({ openList, setScene, blocks, nodes, pulls, sceneWrites, confirms }) => {
    blocks.set(embedUid, rawBlock(embedUid, "{{[[TODO]]}} from block"));
    setScene(elements);
    const list = openList();
    const before = pulls.length;
    list.get("Todo mode")();
    const veil = liveVeils(nodes).at(-1);
    assert.equal(holeCount(veil), kept.length);
    assert.deepEqual([...kept].sort(), ["e1", "t1", "x1"]);
    assert.ok(!kept.includes("d1"));
    assert.ok(pulls.slice(before).includes(embedUid));
    assert.equal(sceneWrites(), 0);
    assert.equal(confirms.length, 0);
  });
});

test("embed query results appends cardsFromQuery and writes no blocks", async () => {
  const rows = [{ ":block/uid": "result001" }, { ":block/uid": "result002" }, { uid: "result003" }];
  const existing = [{
    id: "old", type: "rectangle", isDeleted: false, x: 0, y: 0, width: 10, height: 10,
    customData: { plexus: { embed: "((result001))", query: "queryuid1" } },
  }];
  await withCanvas(async ({ openList, app, setScene, setFocused, setQueryRows, getScene, queries, creates, undos, confirms, sceneWrites }) => {
    setQueryRows(rows);
    setScene(existing);
    setFocused("queryuid1");
    const list = openList();
    const origin = viewOrigin(app);
    const expected = await cardsFromQuery({
      api: { data: { roamQuery: async () => rows.map((row) => ({ ...row })) } },
      sourceUid: "queryuid1",
      existing,
      origin,
    });
    const q0 = queries.length;
    const w0 = sceneWrites();
    await list.get("Embed query results")();
    assert.deepEqual(queries.slice(q0), [{ uid: "queryuid1", limit: 50 }]);
    const written = getScene();
    assert.equal(written[0], existing[0]);
    assert.deepEqual(written.slice(1).map(placedShape), expected.map(placedShape));
    assert.ok(expected.length > 0);
    assert.equal(creates.length, 0);
    assert.equal(undos.length, 0);
    assert.equal(confirms.length, 0);
    assert.equal(sceneWrites(), w0 + 1);
  });
});

test("embed page children appends cardsFromChildren and writes no blocks", async () => {
  const children = [
    { uid: "child0001", string: "one", order: 0 },
    { uid: "child0002", string: "two", order: 1 },
  ];
  await withCanvas(async ({ openList, app, blocks, setFocused, setScene, getScene, queries, creates, undos, confirms }) => {
    blocks.set("focus0001", rawBlock("focus0001", "here", [], { pageUid: "pageuid01" }));
    blocks.set("pageuid01", rawBlock("pageuid01", "", children, { title: "Notes" }));
    setScene([]);
    setFocused("focus0001");
    const list = openList();
    const expected = cardsFromChildren({ children, sourceUid: "pageuid01", existing: [], origin: viewOrigin(app) });
    await list.get("Embed page children")();
    assert.deepEqual(getScene().map(placedShape), expected.map(placedShape));
    assert.equal(queries.length, 0);
    assert.equal(creates.length, 0);
    assert.equal(undos.length, 0);
    assert.equal(confirms.length, 0);
  });
});

async function clickUndo(nodes) {
  const toast = nodes.filter((n) => String(n.className).includes("plexus-toast") && n.textContent === "Linked").at(-1);
  const button = toast.children.find((child) => child.textContent === "Undo");
  button.listeners.find((entry) => entry.type === "click").fn();
  await new Promise((r) => setTimeout(r, 0));
}

test("link selected writes relationPlan under the source lock and undo deletes both blocks", async () => {
  const elements = [
    { id: "m1", type: "rectangle", x: 0, y: 0, width: 20, height: 20, customData: { plexus: { mm: { uid: "srcuid001" } } } },
    { id: "l1", type: "rectangle", x: 50, y: 0, width: 20, height: 20, link: "((dstuid001))" },
  ];
  const hadNav = globalThis.navigator != null;
  if (!hadNav) globalThis.navigator = {};
  const previous = globalThis.navigator.locks;
  const names = [];
  globalThis.navigator.locks = {
    async request(name, opts, cb) {
      names.push(name);
      const fn = typeof opts === "function" ? opts : cb;
      await fn?.({ name });
    },
  };
  try {
    await withCanvas(async ({ openList, app, blocks, setScene, nodes, creates, deletes, undos, confirms, sceneWrites }) => {
      blocks.set("srcuid001", rawBlock("srcuid001", "Note"));
      setScene(elements);
      app.state.selectedElementIds = { m1: true, l1: true };
      const list = openList();
      const plan = relationPlan({ sourceUid: "srcuid001", destUid: "dstuid001", strings: ["Note"] });
      await list.get("Link selected")();
      assert.deepEqual(names, [lockName("g", "srcuid001")]);
      assert.equal(creates.length, 2);
      assert.equal(creates[0].location["parent-uid"], plan.parentUid);
      assert.equal(creates[0].block.string, plan.attribute);
      assert.equal(creates[1].location["parent-uid"], creates[0].block.uid);
      assert.equal(creates[1].block.string, plan.child);
      assert.equal(sceneWrites(), 0);
      assert.equal(undos.length, 0);
      assert.equal(confirms.length, 0);
      await clickUndo(nodes);
      assert.deepEqual(deletes, [creates[1].block.uid, creates[0].block.uid]);
      blocks.set("srcuid001", rawBlock("srcuid001", "Note", [{ uid: "attr00001", string: "relates to::" }]));
      blocks.set("attr00001", rawBlock("attr00001", "relates to::", [{ uid: "ref000001", string: "((dstuid001))" }]));
      const n = creates.length;
      await list.get("Link selected")();
      assert.equal(creates.length, n);
      assert.equal(nodes.filter((node) => node.textContent === "Already linked").length, 1);
      assert.equal(undos.length, 0);
      assert.equal(confirms.length, 0);
    });
  } finally {
    if (!hadNav) delete globalThis.navigator;
    else if (previous === undefined) delete globalThis.navigator.locks;
    else globalThis.navigator.locks = previous;
  }
});

test("link selected uses an arrow's startBinding and endBinding", async () => {
  const elements = [
    { id: "c1", type: "rectangle", x: 0, y: 0, width: 20, height: 20, customData: { plexus: { embed: "((srcuid001))" } } },
    { id: "c2", type: "rectangle", x: 80, y: 0, width: 20, height: 20, customData: { plexus: { embed: "((dstuid001))" } } },
    { id: "ar", type: "arrow", x: 30, y: 0, width: 40, height: 10, points: [[0, 0], [40, 10]], startBinding: { elementId: "c1" }, endBinding: { elementId: "c2" } },
  ];
  await withCanvas(async ({ openList, app, blocks, setScene, creates, undos, confirms, sceneWrites }) => {
    blocks.set("srcuid001", rawBlock("srcuid001", "Note"));
    setScene(elements);
    app.state.selectedElementIds = { ar: true };
    const list = openList();
    const plan = relationPlan({ sourceUid: "srcuid001", destUid: "dstuid001", strings: ["Note"] });
    await list.get("Link selected")();
    assert.equal(creates[0].block.string, plan.attribute);
    assert.equal(creates[1].block.string, plan.child);
    assert.equal(creates[0].location["parent-uid"], plan.parentUid);
    assert.equal(sceneWrites(), 0);
    assert.equal(undos.length, 0);
    assert.equal(confirms.length, 0);
  });
});

test("filter regions by tag calls setTagFilter and does not write the scene", async () => {
  const region = "{{[[plexus-region]]: k=area d=draw00001 ids=elem00001}} #kept";
  await withCanvas(async ({ openList, blocks, setScene, setFocused, nodes, sceneWrites, confirms, undos }) => {
    blocks.set("draw00001", rawBlock("draw00001", "{{[[excalidraw]]}}", [{ uid: "cont00001", string: "{{[[plexus-regions]]}}" }]));
    blocks.set("cont00001", rawBlock("cont00001", "{{[[plexus-regions]]}}", [{ uid: "reg000001", string: region }]));
    blocks.set("tagblock1", rawBlock("tagblock1", "#kept"));
    setScene([{ id: "elem00001", type: "rectangle", x: 10, y: 10, width: 80, height: 40 }]);
    setFocused("tagblock1");
    const list = openList();
    await list.get("Toggle regions layer")();
    const outline = () => nodes.find((n) => String(n.attrs.class || "").split(/\s+/).includes("plexus-region-outline"));
    assert.ok(outline());
    const writes = sceneWrites();
    await list.get("Filter regions by tag")();
    assert.equal(String(outline().attrs.class).includes("plexus-region-dim"), false);
    blocks.set("tagblock1", rawBlock("tagblock1", "[[other]]"));
    const again = openList();
    await again.get("Filter regions by tag")();
    assert.equal(String(outline().attrs.class).includes("plexus-region-dim"), true);
    assert.equal(sceneWrites(), writes);
    assert.equal(confirms.length, 0);
    assert.equal(undos.length, 0);
  });
});
