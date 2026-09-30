import assert from "node:assert/strict";
import test from "node:test";

import { installCanvasMenu, installRoamMenus, plexusCanvasItems } from "../src/view/context-menus.js";
import { createEditorToolbar } from "../src/view/toolbar.js";
import { openSettingsDialog } from "../src/view/settings-dialog.js";
import { HOTKEYS, createSettingsPanel, formatHotkey, readSettings, SETTING_IDS } from "../src/settings.js";

const MENUS = ["blockContextMenu", "pageContextMenu", "msContextMenu", "blockRefContextMenu"];
const tick = () => new Promise((r) => setImmediate(r));

// blocks: uid -> {string, order, parent}. Pull answers the three patterns the menus use.
function menuSetup({ blocks = {}, pages = {}, selected = [], editor = false } = {}) {
  const commands = {};
  const ui = { multiselect: { getSelected: () => selected } };
  for (const m of MENUS) {
    commands[m] = new Map();
    ui[m] = { addCommand: (c) => commands[m].set(c.label, c), removeCommand: ({ label }) => commands[m].delete(label) };
  }
  const api = {
    ui,
    data: {
      pull: (pattern, [attr, key]) => {
        if (attr === ":node/title") return key in pages ? { ":block/uid": pages[key] } : null;
        const b = blocks[key];
        if (!b) return null;
        if (pattern.includes("_children")) {
          const parent = blocks[b.parent];
          const out = {};
          if (pattern.includes(":block/order")) out[":block/order"] = b.order;
          if (pattern.includes("[:block/order :block/string")) out[":block/string"] = b.string;
          if (pattern.includes("[:block/order :block/string")) out[":block/string"] = b.string;
          if (b.parent) out[":block/_children"] = [{ ":block/uid": b.parent, ":block/string": parent?.string ?? "" }];
          return out;
        }
        return { ":block/string": b.string };
      },
    },
  };
  const calls = [];
  const rec = (name) => (...a) => { calls.push([name, ...a]); };
  const actions = { newDrawing: rec("newDrawing"), placeBlocks: rec("placeBlocks"), armPlace: rec("armPlace") };
  const dispose = installRoamMenus({
    api, host: {}, actions, regionref: {}, getSettings: () => ({}), setRefOverride() {}, openSettings() {},
    hasEditor: () => editor, now: () => 0,
  });
  return { api, commands, calls, dispose };
}

test("block menu New drawing here/below call newDrawing with the block uid", async () => {
  const { commands, calls } = menuSetup({ blocks: { aaaaaaaaa: { string: "plain", order: 0, parent: "pppppppp1" }, pppppppp1: { string: "parent", order: 0 } } });
  const e = { "block-uid": "aaaaaaaaa" };
  for (const l of ["Plexus: New drawing here", "Plexus: New drawing below"]) assert.equal(commands.blockContextMenu.get(l)["display-conditional"](e), true);
  commands.blockContextMenu.get("Plexus: New drawing here").callback(e);
  commands.blockContextMenu.get("Plexus: New drawing below").callback(e);
  await tick();
  assert.deepEqual(calls, [["newDrawing", { where: "here", uid: "aaaaaaaaa" }], ["newDrawing", { where: "below", uid: "aaaaaaaaa" }]]);
});

test("new drawing items are hidden on drawings, regions, plexus containers, their children, and unknown uids", () => {
  const { commands } = menuSetup({
    blocks: {
      drawing01: { string: "{{[[excalidraw]]}}", order: 0 },
      region001: { string: "{{[[plexus-region]]: k=area d=abc123XYZ ids=a pad=10}} R", order: 1 },
      contain01: { string: "{{[[plexus-cards]]}}", order: 2 },
      child0001: { string: "child", order: 0, parent: "contain01" },
      plain0001: { string: "hello", order: 3 },
    },
  });
  const show = (uid) => commands.blockContextMenu.get("Plexus: New drawing here")["display-conditional"]({ "block-uid": uid });
  assert.equal(show("drawing01"), false);
  assert.equal(show("region001"), false);
  assert.equal(show("contain01"), false);
  assert.equal(show("child0001"), false);
  assert.equal(show("nothere01"), false);
  assert.equal(show("plain0001"), true);
});

test("page menu uses page-uid, else looks the title up, else warns and does nothing", async () => {
  const { commands, calls } = menuSetup({ pages: { Notes: "pageuid01" } });
  const cb = commands.pageContextMenu.get("Plexus: New drawing on this page").callback;
  cb({ "page-uid": "given0001" });
  cb({ "page-title": "Notes" });
  const warn = console.warn; console.warn = () => {};
  try { cb({ "page-title": "Missing" }); cb({}); } finally { console.warn = warn; }
  await tick();
  assert.deepEqual(calls.map((c) => [c[1].uid, c[1].where]), [["given0001", "here"], ["pageuid01", "here"]]);
});

test("multi-select Place uses arg.blocks in outline order, then the selection fallback; arms without an editor", () => {
  const blocks = {
    aaaaaaaaa: { string: "a", order: 2, parent: "ppppppppp" },
    bbbbbbbbb: { string: "b", order: 0, parent: "ppppppppp" },
    ccccccccc: { string: "c", order: 1, parent: "qqqqqqqqq" },
    ppppppppp: { string: "p", order: 0 },
    qqqqqqqqq: { string: "q", order: 1 },
  };
  const on = menuSetup({ blocks, editor: true, selected: [{ "block-uid": "ccccccccc" }, { "block-uid": "aaaaaaaaa" }] });
  const label = "Plexus: Place on drawing";
  assert.equal(on.commands.msContextMenu.get(label)["display-conditional"](), true);
  on.commands.msContextMenu.get(label).callback({ blocks: [{ "block-uid": "ccccccccc" }, { "block-uid": "aaaaaaaaa" }, { "block-uid": "bbbbbbbbb" }, { "block-uid": "bbbbbbbbb" }] });
  on.commands.msContextMenu.get(label).callback({});
  assert.deepEqual(on.calls, [["placeBlocks", ["bbbbbbbbb", "aaaaaaaaa", "ccccccccc"]], ["placeBlocks", ["aaaaaaaaa", "ccccccccc"]]]);
  const off = menuSetup({ blocks, editor: false });
  off.commands.msContextMenu.get(label).callback({ blocks: [{ "block-uid": "aaaaaaaaa" }] });
  off.commands.msContextMenu.get(label).callback({});
  assert.deepEqual(off.calls, [["armPlace", ["aaaaaaaaa"]]]);
  off.dispose();
  assert.equal(off.commands.msContextMenu.size + off.commands.pageContextMenu.size, 0);
});

test("multi-select Place keeps only top-most blocks in outline order and drops Plexus containers", () => {
  const blocks = {
    k0000001: { string: "K with children", order: 2 },
    cont0001: { string: "{{[[plexus-regions]]}}", order: 0, parent: "k0000001" },
    reg00001: { string: "{{[[plexus-region]]: k=area d=abc123XYZ ids=a pad=10}} R", order: 0, parent: "cont0001" },
    reg00002: { string: "image", order: 1, parent: "cont0001" },
    a0000001: { string: "a", order: 0 },
    b0000001: { string: "b", order: 1 },
    cards001: { string: "{{[[plexus-cards]]}}", order: 3 },
    lone0001: { string: "{{[[plexus-region]]: k=area d=abc123XYZ ids=a pad=10}} lone", order: 4, parent: "cont0001" },
  };
  const label = "Plexus: Place on drawing";
  const pick = (uids) => uids.map((u) => ({ "block-uid": u }));
  const on = menuSetup({ blocks, editor: true, selected: pick(["reg00002", "k0000001", "cont0001", "reg00001", "b0000001", "a0000001"]) });
  on.commands.msContextMenu.get(label).callback({});
  on.commands.msContextMenu.get(label).callback({ blocks: pick(["b0000001", "cards001", "lone0001", "a0000001"]) });
  assert.deepEqual(on.calls, [["placeBlocks", ["a0000001", "b0000001", "k0000001"]], ["placeBlocks", ["a0000001", "b0000001", "lone0001"]]]);
  const off = menuSetup({ blocks, editor: false, selected: pick(["k0000001", "cont0001", "reg00001", "reg00002", "a0000001"]) });
  off.commands.msContextMenu.get(label).callback({});
  assert.deepEqual(off.calls, [["armPlace", ["a0000001", "k0000001"]]]);
});

// Minimal canvas fixture
function node(tag) {
  return {
    tag, children: [], attrs: {}, listeners: {}, className: "", style: {}, textContent: "",
    append(...c) { this.children.push(...c); },
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
    removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); },
    remove() {},
    querySelectorAll() { return this.children.filter((n) => n.attrs?.["data-plexus-item"]); },
  };
}

test("canvas menu passes the right-click point to getItems and prints kbd hints", () => {
  const ul = node("ul");
  const container = node("div");
  container.querySelector = () => ul;
  const popover = node("div");
  ul.closest = () => popover;
  const seen = [];
  const queue = [];
  installCanvasMenu({
    doc: { createElement: node, defaultView: { innerHeight: 1000 } }, app: {}, containerEl: container, raf: (f) => { queue.push(f); return 1; }, caf() {},
    getItems: (point) => { seen.push(point); return [{ id: "embed-picker", label: "Embed", enabled: true, kbd: "Shift+Alt+E", run() {} }]; },
  });
  container.listeners.contextmenu[0]({ clientX: 30, clientY: 40 });
  queue.shift()();
  container.listeners.contextmenu[0]({});
  queue.shift()();
  assert.deepEqual(seen, [{ x: 30, y: 40 }, null]);
  const li = ul.children.filter((n) => n.attrs["data-plexus-item"]).at(-1);
  assert.equal(li.children[0].children[1].textContent, "Shift+Alt+E");
});

test("canvas items add embed picker, note card, kbd hints and the pending place row", () => {
  const calls = [];
  const base = { app: {}, native: { selectedElementIds: () => [] }, actions: { hasFrames: () => false, pendingPlace: () => ({ count: 3 }), placePending: (p) => calls.push(["placePending", p]) }, openSettings() {}, drawingUid: "d", mac: false };
  const items = plexusCanvasItems({ ...base, point: { x: 1, y: 2 }, openPicker: (p) => calls.push(["picker", p]), noteAt: (p) => calls.push(["note", p]), toScene: (p) => ({ x: p.x * 10, y: p.y * 10 }) });
  const by = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.equal(by["embed-picker"].label, "Plexus: Embed page or block…");
  assert.equal(by["embed-picker"].kbd, "Shift+Alt+E");
  assert.equal(by.note.kbd, "Shift+Alt+N");
  assert.equal(by.region.kbd, "Shift+Alt+R");
  assert.equal(by.present.kbd, "Shift+Alt+P");
  assert.equal(by.mindmap.kbd, "Shift+Alt+M");
  assert.equal(by["embed-picker"].enabled, true);
  by["embed-picker"].run(); by.note.run(); by["place-pending"].run();
  assert.equal(by["place-pending"].label, "Plexus: Place 3 blocks here");
  assert.deepEqual(calls, [["picker", { x: 1, y: 2 }], ["note", { x: 1, y: 2 }], ["placePending", { x: 10, y: 20 }]]);
  const bare = plexusCanvasItems({ ...base, actions: { hasFrames: () => false } });
  assert.equal(bare.some((i) => i.id === "place-pending"), false);
  assert.equal(bare.find((i) => i.id === "embed-picker").enabled, false);
  const mac = plexusCanvasItems({ ...base, mac: true, openPicker() {} });
  assert.equal(mac.find((i) => i.id === "embed-picker").kbd, "Shift+Option+E");
});

test("formatHotkey uses Excalidraw wording and HOTKEYS lists the seven Alt+Shift keys", () => {
  assert.equal(formatHotkey("alt-shift-r"), "Shift+Alt+R");
  assert.equal(formatHotkey("alt-shift-r", { mac: true }), "Shift+Option+R");
  assert.deepEqual(HOTKEYS.map((h) => h.spec), ["alt-shift-r", "alt-shift-i", "alt-shift-p", "alt-shift-m", "alt-shift-e", "alt-shift-n", "alt-shift-o"]);
  assert.ok(HOTKEYS.every((h) => /^alt-shift-[a-z]$/.test(h.spec)));
});

test("P9 settings: defaults, normalization and panel entries", () => {
  const api = (init = {}) => ({ settings: { get: (id) => init[id] } });
  const d = readSettings(api());
  assert.deepEqual([d.pasteRefs, d.cardHome, d.drawingName], ["text", "drawing", "Drawing {date}"]);
  const bad = readSettings(api({ "paste-refs": "zz", "card-home": "nope", "drawing-name": "   " }));
  assert.deepEqual([bad.pasteRefs, bad.cardHome, bad.drawingName], ["text", "drawing", "Drawing {date}"]);
  const ok = readSettings(api({ "paste-refs": "link", "card-home": "daily", "drawing-name": "Sketch {n}" }));
  assert.deepEqual([ok.pasteRefs, ok.cardHome, ok.drawingName], ["link", "daily", "Sketch {n}"]);
  assert.equal(SETTING_IDS.pasteRefs, "paste-refs");
  const panel = createSettingsPanel().settings;
  assert.deepEqual(panel.find((s) => s.id === "paste-refs").action.items, ["text", "embed", "link"]);
  assert.deepEqual(panel.find((s) => s.id === "card-home").action.items, ["drawing", "page", "daily"]);
  assert.equal(panel.find((s) => s.id === "drawing-name").action.type, "input");
});

function dialogNode(tag) {
  return {
    tag, children: [], listeners: {}, attrs: {}, className: "", style: {}, value: "", checked: false, textContent: "",
    append(...c) { this.children.push(...c); },
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
    removeEventListener() {},
    fire(t, e = {}) { for (const f of [...(this.listeners[t] || [])]) f(e); },
    setAttribute(k, v) { this.attrs[k] = v; },
    remove() {},
    focus() {},
  };
}
const flat = (n) => [n, ...n.children.flatMap((c) => (typeof c === "object" ? flat(c) : []))];

test("settings dialog: new fields, text field commits on close only, read-only Shortcuts section", async () => {
  const body = dialogNode("body");
  const doc = { body, defaultView: { navigator: { platform: "Win32" } }, createElement: (t) => { const n = dialogNode(t); if (t === "dialog") { n.showModal = () => {}; n.close = () => {}; } return n; } };
  const writes = [];
  openSettingsDialog({ doc, get: () => undefined, set: (id, v) => { writes.push([id, v]); } });
  const dlg = body.children[0];
  const fields = flat(dlg).filter((n) => n.tag === "input" || n.tag === "select");
  const [paste, home, name] = fields.slice(-3);
  assert.deepEqual([paste.value, home.value, name.value], ["text", "drawing", "Drawing {date}"]);
  paste.value = "embed"; paste.fire("change");
  name.value = "Board {n}"; name.fire("change");
  await tick();
  assert.deepEqual(writes, [["paste-refs", "embed"]], "text field waits for close");
  const texts = flat(dlg).map((n) => n.textContent);
  for (const t of ["Paste refs as", "New note cards go", "New drawing page name", "Shortcuts", "Shift+Alt+R", "Shift+Alt+N", "Alt+←", "F2", "Mind map is a Roam hotkey: change it in Roam Settings › Hotkeys. The other keys work while a drawing is open."]) assert.ok(texts.includes(t), t);
  assert.equal(flat(dlg).filter((n) => n.tag === "kbd").length, HOTKEYS.length + 2);
  dlg.fire("cancel");
  await tick();
  assert.deepEqual(writes.at(-1), ["drawing-name", "Board {n}"]);
});

test("toolbar: hotkey titles, Embed… opens the picker, Note button arms", async () => {
  const buttons = [];
  const bar = { style: {}, children: [], append(...c) { this.children.push(...c); }, remove() {}, getBoundingClientRect: () => ({ height: 36 }) };
  const doc = {
    defaultView: { getComputedStyle: () => ({ zIndex: "auto" }), addEventListener() {}, removeEventListener() {}, navigator: { platform: "MacIntel" } },
    body: { append() {} },
    createElement: (tag) => {
      if (tag === "div") return bar;
      const el = { style: {}, handlers: {}, addEventListener(t, f) { this.handlers[t] = f; } };
      buttons.push(el);
      return el;
    },
  };
  const fired = [];
  const tb = createEditorToolbar({
    doc, onAreaRegion() {}, onImageRegion() {}, onFrameRegion() {}, onCropRegion() {}, onEmbed() { fired.push("clip"); },
    onEmbedPicker() { fired.push("picker"); }, onNote() { fired.push("note"); }, onPresent() {}, onMindMap() {},
  });
  tb.show({ parentElement: null, getBoundingClientRect: () => ({ left: 0, width: 1000, bottom: 700 }) });
  const labels = bar.children.map((b) => b.textContent);
  assert.deepEqual(labels, ["Region", "Image region", "Frame (with margin)", "Region from crop", "Embed…", "Note", "Present", "Mind map"]);
  const title = (label) => bar.children.find((b) => b.textContent === label).title;
  assert.equal(title("Region"), "Region (Shift+Option+R)");
  assert.equal(title("Embed…"), "Embed… (Shift+Option+E)");
  assert.equal(title("Note"), "Note (Shift+Option+N)");
  assert.equal(title("Present"), "Present (Shift+Option+P)");
  assert.equal(title("Mind map"), "Mind map (Shift+Option+M)");
  assert.equal(title("Frame (with margin)"), undefined);
  for (const l of ["Embed…", "Note"]) bar.children.find((b) => b.textContent === l).handlers.click({ stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(fired, ["picker", "note"]);
  tb.hide();
});
