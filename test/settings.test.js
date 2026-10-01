import test from "node:test";
import assert from "node:assert/strict";
import { SETTING_IDS, createSettingsPanel, parseRegionGalleries, readSettings, setRefOverride, setRegionGallery, withRegionGallery, writeSetting } from "../src/settings.js";

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
  assert.equal(s.themeFollow, true);
  assert.equal(s.fitOnOpen, false);
  assert.equal(readSettings(fakeApi({ "theme-follow": false, "fit-on-open": true })).themeFollow, false);
  assert.equal(readSettings(fakeApi({ "fit-on-open": true })).fitOnOpen, true);
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
  assert.deepEqual(a, { "a|b": { mode: "link" } });
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

test("caption settings: defaults, normalization, panel", () => {
  const d = readSettings(fakeApi());
  assert.equal(d.captionDisplay, "written");
  assert.equal(d.captionMode, "auto");
  assert.equal(d.pinSize, 8);
  assert.equal(d.numberPins, false);
  const s = readSettings(fakeApi({ "caption-display": "never", "caption-mode": "none", "pin-size": "12", "number-pins": true }));
  assert.deepEqual([s.captionDisplay, s.captionMode, s.pinSize, s.numberPins], ["never", "none", 12, true]);
  assert.equal(readSettings(fakeApi({ "pin-size": 4 })).pinSize, 4);
  for (const bad of ["zzz", "", 5, null]) {
    const n = readSettings(fakeApi({ "caption-display": bad, "caption-mode": bad, "pin-size": bad }));
    assert.deepEqual([n.captionDisplay, n.captionMode, n.pinSize], ["written", "auto", 8]);
  }
  const calls = [];
  const items = createSettingsPanel({ onChange: () => calls.push(1) }).settings;
  const byId = (id) => items.find((x) => x.id === id);
  assert.deepEqual(byId("caption-display").action.items, ["written", "always", "never"]);
  assert.deepEqual(byId("caption-mode").action.items, ["auto", "ask", "none"]);
  assert.deepEqual(byId("pin-size").action.items, ["4", "8", "12"]);
  assert.equal(byId("number-pins").action.type, "switch");
  assert.match(byId("caption-mode").description, /stores no words; links to source blocks are still stored/);
  byId("caption-display").action.onChange();
  assert.equal(calls.length, 1);
  for (const id of ["caption-mode", "pin-size", "number-pins"]) assert.equal(byId(id).action.onChange, undefined);
  assert.equal(SETTING_IDS.captionDisplay, "caption-display");
  assert.equal(SETTING_IDS.captionMode, "caption-mode");
  assert.equal(SETTING_IDS.pinSize, "pin-size");
  assert.equal(SETTING_IDS.numberPins, "number-pins");
});

test("setRefOverride patches merge, string and null shorthands keep caption", async () => {
  const api = fakeApi();
  await setRefOverride(api, "b", "r", { caption: "hide" });
  await setRefOverride(api, "b", "r", "link");
  assert.deepEqual(JSON.parse(api.store[SETTING_IDS.refOverrides]), { "b|r": { mode: "link", caption: "hide" } });
  await setRefOverride(api, "b", "r", null);
  assert.deepEqual(JSON.parse(api.store[SETTING_IDS.refOverrides]), { "b|r": { caption: "hide" } });
  await setRefOverride(api, "b", "r", { caption: null });
  assert.deepEqual(JSON.parse(api.store[SETTING_IDS.refOverrides]), {});
  await setRefOverride(api, "b", "r", "image");
  assert.deepEqual(JSON.parse(api.store[SETTING_IDS.refOverrides]), { "b|r": "image" });
});

test("0.6.x string overrides migrate on read and round-trip on write", async () => {
  const api = fakeApi({ [SETTING_IDS.refOverrides]: '{"a|b":"link"}' });
  assert.deepEqual(readSettings(api).refOverrides, { "a|b": { mode: "link" } });
  await setRefOverride(api, "c", "d", { caption: "show" });
  assert.deepEqual(JSON.parse(api.store[SETTING_IDS.refOverrides]), { "a|b": "link", "c|d": { caption: "show" } });
});

test("P8 settings: defaults, normalization, panel", () => {
  const d = readSettings(fakeApi());
  assert.deepEqual([d.zoomCap, d.animation, d.regionLanding], [1, "system", false]);
  const s = readSettings(fakeApi({ "zoom-cap": "150", animation: "off", "region-landing": true }));
  assert.deepEqual([s.zoomCap, s.animation, s.regionLanding], [1.5, "off", true]);
  assert.equal(readSettings(fakeApi({ "zoom-cap": "200" })).zoomCap, 2);
  for (const bad of ["zzz", "", 5, null, "175"]) {
    const n = readSettings(fakeApi({ "zoom-cap": bad, animation: bad }));
    assert.deepEqual([n.zoomCap, n.animation], [1, "system"]);
  }
  const items = createSettingsPanel({ onChange: () => {} }).settings;
  const byId = (id) => items.find((x) => x.id === id);
  assert.deepEqual(byId("zoom-cap").action.items, ["100", "150", "200"]);
  assert.deepEqual(byId("animation").action.items, ["system", "on", "off"]);
  assert.equal(byId("region-landing").action.type, "switch");
  assert.equal(SETTING_IDS.zoomCap, "zoom-cap");
  assert.equal(SETTING_IDS.animation, "animation");
  assert.equal(SETTING_IDS.regionLanding, "region-landing");
});

test("dock-width defaults to 320, clamps to 240-640 and is not in the settings panel", () => {
  const api = (init = {}) => ({ settings: { get: (id) => init[id] } });
  assert.equal(readSettings(api()).dockWidth, 320);
  assert.equal(readSettings(api({ "dock-width": "100" })).dockWidth, 240);
  assert.equal(readSettings(api({ "dock-width": 900 })).dockWidth, 640);
  assert.equal(readSettings(api({ "dock-width": "abc" })).dockWidth, 320);
  assert.equal(readSettings(api({ "dock-width": "400" })).dockWidth, 400);
  assert.equal(createSettingsPanel().settings.some((s) => s.id === "dock-width"), false);
});

test("P11 settings: defaults and clamps", () => {
  const d = readSettings(fakeApi());
  assert.equal(d.printSize, "letter");
  assert.equal(d.printMargin, 10);
  assert.equal(d.laserColor, "#e03131");
  assert.equal(d.laserDecay, 1000);
  const bad = readSettings(fakeApi({ "print-size": "tabloid", "print-margin": "-4", "laser-color": "red", "laser-decay": "5" }));
  assert.deepEqual([bad.printSize, bad.printMargin, bad.laserColor, bad.laserDecay], ["letter", 0, "#e03131", 300]);
  const hi = readSettings(fakeApi({ "print-size": "16:9", "print-margin": "99", "laser-color": "#00AaFF", "laser-decay": "99999" }));
  assert.deepEqual([hi.printSize, hi.printMargin, hi.laserColor, hi.laserDecay], ["16:9", 30, "#00aaff", 3000]);
  assert.equal(readSettings(fakeApi({ "print-size": "a4" })).printSize, "a4");
  assert.equal(readSettings(fakeApi({ "laser-color": "#12345" })).laserColor, "#e03131");
  assert.equal(readSettings(fakeApi({ "laser-decay": "" })).laserDecay, 1000);
});

test("P11 settings ids exist and HOTKEYS is unchanged", async () => {
  const { SETTING_IDS: ids, HOTKEYS, initializeSettings } = await import("../src/settings.js");
  assert.deepEqual([ids.printSize, ids.printMargin, ids.laserColor, ids.laserDecay], ["print-size", "print-margin", "laser-color", "laser-decay"]);
  assert.deepEqual(HOTKEYS.map((h) => h.id), ["region", "image", "present", "mindmap", "embed", "note", "dock"]);
  const api = fakeApi();
  await initializeSettings(api);
  assert.equal(api.store["laser-color"], "#e03131");
  assert.equal(api.store["print-size"], "letter");
});

test("mm-tag-colors parses into a lowercase Map and drops bad colours", async () => {
  const { parseTagColors, readSettings } = await import("../src/settings.js");
  const m = parseTagColors("Urgent=#FFC9C9, #done=#b2f, bad=red, =#fff, nocolour, x=#12345");
  assert.deepEqual([...m], [["urgent", "#FFC9C9"], ["done", "#b2f"]]);
  assert.equal(parseTagColors(undefined).size, 0);
  const api = { settings: { get: (id) => (id === "mm-tag-colors" ? "a=#000" : undefined) } };
  assert.equal(readSettings(api).mmTagColors.get("a"), "#000");
  assert.equal(readSettings({ settings: { get: () => undefined } }).mmTagColors.size, 0);
});

test("regionGalleries defaults to [] and round-trips a stored JSON array", () => {
  assert.equal(SETTING_IDS.regionGalleries, "region-galleries");
  assert.deepEqual(readSettings(fakeApi()).regionGalleries, []);
  const stored = '["ccccccccc","nope","ccccccccc","ddddddddd"]';
  assert.deepEqual(readSettings(fakeApi({ [SETTING_IDS.regionGalleries]: stored })).regionGalleries, ["ccccccccc", "ddddddddd"]);
  assert.deepEqual(parseRegionGalleries(["aaaaaaaaa", "bad", "aaaaaaaaa", "bbbbbbbbb"]), ["aaaaaaaaa", "bbbbbbbbb"]);
  assert.deepEqual(parseRegionGalleries("nope"), []);
});

test("withRegionGallery moves the uid to the end, drops a bad uid, and caps at 200", () => {
  assert.deepEqual(withRegionGallery(["aaaaaaaaa", "bbbbbbbbb"], "aaaaaaaaa", true), ["bbbbbbbbb", "aaaaaaaaa"]);
  assert.deepEqual(withRegionGallery(["aaaaaaaaa"], "bad-uid", true), ["aaaaaaaaa"]);
  assert.deepEqual(withRegionGallery(["aaaaaaaaa"], "aaaaaaaaa", false), []);
  const many = Array.from({ length: 200 }, (_, i) => `u${String(i).padStart(8, "0")}`);
  const capped = withRegionGallery(many, "zzzzzzzzz", true);
  assert.equal(capped.length, 200);
  assert.equal(capped.at(-1), "zzzzzzzzz");
  assert.equal(capped.includes(many[0]), false);
  assert.equal(capped[0], many[1]);
});

test("setRegionGallery persists JSON through settings.set", async () => {
  const api = fakeApi();
  await Promise.all([setRegionGallery(api, "aaaaaaaaa", true), setRegionGallery(api, "bbbbbbbbb", true)]);
  assert.deepEqual(JSON.parse(api.store[SETTING_IDS.regionGalleries]), ["aaaaaaaaa", "bbbbbbbbb"]);
  await setRegionGallery(api, "nope", true);
  assert.deepEqual(JSON.parse(api.store[SETTING_IDS.regionGalleries]), ["aaaaaaaaa", "bbbbbbbbb"]);
  await setRegionGallery(api, "aaaaaaaaa", false);
  assert.deepEqual(JSON.parse(api.store[SETTING_IDS.regionGalleries]), ["bbbbbbbbb"]);
});
