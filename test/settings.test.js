import test from "node:test";
import assert from "node:assert/strict";
import { SETTING_IDS, createSettingsPanel, readSettings, setRefOverride, writeSetting } from "../src/settings.js";

const fakeApi = (init = {}) => {
  const store = { ...init };
  return { store, settings: { get: (id) => store[id], set: async (id, v) => { await new Promise((r) => setTimeout(r, 1)); store[id] = v; } } };
};

test("defaults and no maxCropHeight", () => {
  const s = readSettings(fakeApi());
  assert.equal(s.figureHeight, 280);
  assert.equal(s.thumbHeight, 72);
  assert.equal(s.inlineDisplay, "thumbnail");
  assert.equal(s.darkCrops, true);
  assert.deepEqual(s.refOverrides, {});
  assert.equal("maxCropHeight" in s, false);
});

test("number clamping", () => {
  for (const [raw, fig, thumb] of [["", 280, 72], ["abc", 280, 72], ["50", 80, 50], ["5000", 1200, 400], ["300", 300, 300], ["10", 80, 24]]) {
    const s = readSettings(fakeApi({ [SETTING_IDS.figureHeight]: raw, [SETTING_IDS.thumbHeight]: raw }));
    assert.equal(s.figureHeight, fig, `fig ${raw}`);
    assert.equal(s.thumbHeight, thumb, `thumb ${raw}`);
  }
});

test("refOverrides memoized and frozen", () => {
  const api = fakeApi({ [SETTING_IDS.refOverrides]: '{"a|b":"link"}' });
  const a = readSettings(api).refOverrides;
  assert.equal(a, readSettings(api).refOverrides);
  assert.ok(Object.isFrozen(a));
  assert.deepEqual(a, { "a|b": "link" });
});

test("inlineDisplay falls back", () => {
  assert.equal(readSettings(fakeApi({ [SETTING_IDS.inlineDisplay]: "link" })).inlineDisplay, "link");
  assert.equal(readSettings(fakeApi({ [SETTING_IDS.inlineDisplay]: "zzz" })).inlineDisplay, "thumbnail");
});

test("writeSetting swallows errors", async () => {
  const warn = console.warn; console.warn = () => {};
  try { await writeSetting({ settings: { set: async () => { throw new Error("x"); } } }, "id", 1); } finally { console.warn = warn; }
});

test("concurrent setRefOverride both persist", async () => {
  const api = fakeApi();
  await Promise.all([setRefOverride(api, "b1", "r1", "link"), setRefOverride(api, "b2", "r2", "image")]);
  assert.deepEqual(JSON.parse(api.store[SETTING_IDS.refOverrides]), { "b1|r1": "link", "b2|r2": "image" });
  await setRefOverride(api, "b1", "r1", null);
  assert.deepEqual(JSON.parse(api.store[SETTING_IDS.refOverrides]), { "b2|r2": "image" });
});

test("panel onChange wrapper", () => {
  const calls = [];
  const panel = createSettingsPanel({ onChange: (...a) => calls.push(a) });
  const ids = panel.settings.map((s) => s.id);
  assert.equal(ids.includes("max-crop-height"), false);
  assert.equal(ids.includes("ref-overrides"), false);
  const sel = panel.settings.find((s) => s.id === "inline-display");
  assert.deepEqual(sel.action.items, ["thumbnail", "link"]);
  sel.action.onChange({ evt: 1 });
  assert.deepEqual(calls, [[]]);
  const boom = createSettingsPanel({ onChange: () => { throw new Error("x"); } });
  const warn = console.warn; console.warn = () => {};
  try { boom.settings[0].action.onChange(); } finally { console.warn = warn; }
  assert.ok(createSettingsPanel().settings.length > 0);
});

test("showBacklinks defaults on, follows the stored value, and has a panel switch", () => {
  assert.equal(SETTING_IDS.showBacklinks, "show-backlinks");
  assert.equal(readSettings(fakeApi()).showBacklinks, true);
  assert.equal(readSettings(fakeApi({ [SETTING_IDS.showBacklinks]: false })).showBacklinks, false);
  const item = createSettingsPanel().settings.find((x) => x.id === "show-backlinks");
  assert.equal(item.name, "Show backlinks on canvas");
  assert.equal(item.action.type, "switch");
});
