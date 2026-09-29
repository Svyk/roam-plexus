import test from "node:test";
import assert from "node:assert/strict";
import { createPublicApi, installPublicApi, uninstallPublicApi } from "../src/api.js";

function makeEmitter() {
  const l = new Set();
  return { on: (t, f) => l.add(f), off: (t, f) => l.delete(f), emit: (t, d) => [...l].forEach((f) => f(d)), size: () => l.size };
}

function build() {
  const emitter = makeEmitter();
  const calls = [];
  const host = {
    graphName: () => "g",
    createDrawing: async (a) => { calls.push(["create", a]); return { uid: "u", pageUid: "p" }; },
    drawingsOn: (p) => ["d1"],
    regionsOf: () => [{ uid: "r1", string: "s", region: { kind: "area", caption: "cap" } }],
    pullBlock: (uid) => ({ string: uid === "r1" ? "{{[[plexus-region]]: k=area d=abcdefghi}}" : "{{[[excalidraw]]}}" }),
    openBlock: async (uid, o) => calls.push(["openBlock", uid, o]),
  };
  const actions = { openRegion: async (uid, o) => calls.push(["openRegion", uid, o]), thumbnail: async (uid, o) => { calls.push(["thumb", uid, o]); return null; } };
  return { api: createPublicApi({ host, actions, emitter, version: "0.2.0" }), emitter, calls };
}

test("public api is frozen and delegates", async () => {
  const { api, calls } = build();
  assert.ok(Object.isFrozen(api));
  assert.equal(api.apiVersion, 1);
  assert.equal(api.version, "0.2.0");
  assert.equal(api.isAvailable(), true);
  assert.deepEqual(await api.create({ title: "T" }), { uid: "u", pageUid: "p" });
  assert.deepEqual(api.regionsOf("d"), [{ uid: "r1", kind: "area", caption: "cap" }]);
  assert.deepEqual(api.drawingsOn("p"), ["d1"]);
  await api.open("r1", { sidebar: true });
  await api.open("d");
  await api.open("d", { region: true });
  await api.thumbnail("d", { maxWidth: 100 });
  assert.deepEqual(calls.slice(1), [
    ["openRegion", "r1", { sidebar: true }],
    ["openBlock", "d", { sidebar: false }],
    ["openRegion", "d", { sidebar: false }],
    ["thumb", "d", { maxWidth: 100 }],
  ]);
});

test("change listeners add, dedupe, remove, and survive throwing callbacks", () => {
  const { api, emitter } = build();
  const got = [];
  const cb = (d) => got.push(d);
  api.addEventListener("change", cb);
  api.addEventListener("change", cb);
  api.addEventListener("change", () => { throw new Error("boom"); });
  api.addEventListener("other", cb);
  assert.equal(emitter.size(), 2);
  const origError = console.error;
  console.error = () => {};
  emitter.emit("change", { uid: "x", kind: "drawing" });
  console.error = origError;
  assert.deepEqual(got, [{ uid: "x", kind: "drawing" }]);
  api.removeEventListener("change", cb);
  assert.equal(emitter.size(), 1);
});

test("install dispatches ready; uninstall dispatches unload and deletes only when ours", () => {
  const { api } = build();
  const events = [];
  const win = { dispatchEvent: (e) => events.push([e.type, e.detail]) };
  class CE { constructor(type, init) { this.type = type; this.detail = init.detail; } }
  installPublicApi(api, { win, CustomEventCtor: CE });
  assert.equal(win.RoamPlexus, api);
  assert.equal(uninstallPublicApi(api, { win, CustomEventCtor: CE }), true);
  assert.equal("RoamPlexus" in win, false);
  const foreign = { mine: false };
  win.RoamPlexus = foreign;
  assert.equal(uninstallPublicApi(api, { win, CustomEventCtor: CE }), false);
  assert.equal(win.RoamPlexus, foreign);
  assert.deepEqual(events.map((e) => e[0]), ["roam-plexus:ready", "roam-plexus:unload", "roam-plexus:unload"]);
  assert.deepEqual(events[0][1], { apiVersion: 1 });
});
