import test from "node:test";
import assert from "node:assert/strict";
import { chooserRows, commandsWithCompass, compassApi, compassTarget, textLinkAction } from "../src/model/compass.js";
import { SETTING_IDS, createSettingsPanel, readSettings } from "../src/settings.js";

const api = () => ({ open() {}, isAvailable: () => true, isOpen: () => false });

test("compassApi returns the object only when isAvailable is true and open is a function", () => {
  assert.equal(compassApi(undefined), null);
  assert.equal(compassApi({}), null);
  assert.equal(compassApi({ RoamCompass: { isAvailable: () => true } }), null);
  assert.equal(compassApi({ RoamCompass: { open() {}, isAvailable: () => false } }), null);
  assert.equal(compassApi({ RoamCompass: { open: "nope", isAvailable: () => true } }), null);
  assert.equal(compassApi({ RoamCompass: { open() {}, isAvailable() { throw new Error("down"); } } }), null);
  const ready = api();
  assert.equal(compassApi({ RoamCompass: ready }), ready);
  assert.equal(compassApi({}), null);
});

test("compassTarget prefers the open drawing, then the focused block, then the page", () => {
  assert.equal(compassTarget({ drawingUid: "draw00001", focusedUid: "focus0001", pageUid: "page00001" }), "draw00001");
  assert.equal(compassTarget({ drawingUid: "  ", focusedUid: " focus0001 ", pageUid: "page00001" }), "focus0001");
  assert.equal(compassTarget({ focusedUid: "", pageUid: "page00001" }), "page00001");
  assert.equal(compassTarget({ drawingUid: null, focusedUid: null, pageUid: null }), null);
  assert.equal(compassTarget(), null);
  assert.equal(compassTarget({ drawingUid: 12, focusedUid: { uid: "x" }, pageUid: "page00001" }), "page00001");
});

test("textLinkAction sends Alt to Compass only when Compass is on", () => {
  assert.equal(textLinkAction({ alt: true, compass: true }), "compass");
  assert.equal(textLinkAction({ alt: true, shift: true, compass: true }), "compass");
  assert.equal(textLinkAction({ alt: true, compass: false }), "open");
  assert.equal(textLinkAction({ alt: true, shift: true, compass: false }), "sidebar");
  assert.equal(textLinkAction({ shift: true, compass: true }), "sidebar");
  assert.equal(textLinkAction({}), "open");
  assert.equal(textLinkAction({ compass: true }), "open");
});

test("chooserRows marks every row, or none, with a Compass button", () => {
  const tokens = [{ kind: "page", title: "Alpha" }, { kind: "block", uid: "abcdefghi" }];
  const on = chooserRows(tokens, { compass: true });
  assert.equal(on.length, 2);
  assert.equal(on[0].token, tokens[0]);
  assert.equal(on[1].token, tokens[1]);
  assert.deepEqual(on.map((row) => row.compass), [true, true]);
  assert.deepEqual(chooserRows(tokens).map((row) => row.compass), [false, false]);
  assert.deepEqual(chooserRows(tokens, { compass: "yes" }).map((row) => row.compass), [false, false]);
  assert.deepEqual(chooserRows(null, { compass: true }), []);
});

test("commandsWithCompass drops Show in Compass unless Compass is on", () => {
  const commands = [
    { id: "whereCited", label: "Where is this cited?" },
    { id: "showInCompass", label: "Show in Compass" },
    { id: "settings", label: "Region settings" },
  ];
  assert.deepEqual(commandsWithCompass(commands, false).map((c) => c.id), ["whereCited", "settings"]);
  assert.equal(commandsWithCompass(commands, true), commands);
  assert.deepEqual(commandsWithCompass(null, true), []);
});

test("the Compass setting defaults on and is a switch", () => {
  const fake = (value) => ({ settings: { get: (id) => (id === "compass" ? value : undefined) } });
  assert.equal(SETTING_IDS.compass, "compass");
  assert.equal(readSettings({ settings: { get: () => undefined } }).compass, true);
  assert.equal(readSettings(fake(false)).compass, false);
  assert.equal(readSettings(fake("false")).compass, false);
  assert.equal(readSettings(fake(true)).compass, true);
  assert.equal(readSettings(fake("true")).compass, true);
  const panel = createSettingsPanel().settings;
  const item = panel.find((entry) => entry.id === "compass");
  assert.equal(item.name, "Compass");
  assert.equal(item.action.type, "switch");
  assert.equal(panel.at(-1).id, "compass");
  assert.equal(panel.at(-2).id, "minimap");
});
