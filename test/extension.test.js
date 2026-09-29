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

  assert.equal(api.calls.filter(([name]) => name === "command:add").length, 4);
  assert.equal(api.calls.filter(([name]) => name === "command:remove").length, 4);
  assert.ok(api.calls.some(([name, label]) => name === "panel:create" && label === "Plexus"));
  assert.ok(api.calls.some(([name, label]) => name === "command:add" && label === "Plexus: Clear crop cache"));
});

test("a second load disposes the previous runtime before registering again", async () => {
  const firstApi = fakeExtensionApi();
  const secondApi = fakeExtensionApi();

  await extension.onload({ extensionAPI: firstApi, extension: { version: "one" } });
  const cleanup = await extension.onload({ extensionAPI: secondApi, extension: { version: "two" } });

  assert.equal(firstApi.calls.filter(([name]) => name === "command:remove").length, 4);
  assert.equal(secondApi.calls.filter(([name]) => name === "command:add").length, 4);
  await cleanup();
});


test("version flag is set on load and cleared on unload", async () => {
  const api = fakeExtensionApi();
  await extension.onload({ extensionAPI: api, extension: { version: "9.9.9" } });
  assert.equal(globalThis.__ROAM_PLEXUS_VERSION, "9.9.9");
  await extension.onunload();
  assert.equal(globalThis.__ROAM_PLEXUS_VERSION, undefined);
});

async function loadWithFakeRoam({ isEncrypted }) {
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
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, append() {}, remove() { removed.push(1); }, addEventListener() {}, setAttribute() {} }),
  };
  globalThis.roamAlphaAPI = { graph: { name: "g", isEncrypted }, util: { generateUID: () => "x" }, data: { pull: () => null }, ui: { components: {} } };
  globalThis.indexedDB = { open: () => { opens.push(1); const r = {}; queueMicrotask(() => r.onerror?.()); return r; } };
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  await extension.onload({ extensionAPI: api, extension: { version: "test" } });
  await callbacks.get("Plexus: Clear crop cache")();
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

test("wired runtime persists crops for an unencrypted graph", async () => {
  try {
    const { opens } = await loadWithFakeRoam({ isEncrypted: false });
    assert.ok(opens.length > 0);
  } finally {
    dropFakeRoam();
  }
});
