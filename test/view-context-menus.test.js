import assert from "node:assert/strict";
import test from "node:test";

import { installRoamMenus, installCanvasMenu } from "../src/view/context-menus.js";

const REGION = "{{[[plexus-region]]: k=area d=abc123XYZ ids=rect-a,text_a pad=10}} Region A";

function fakeApi(strings, { menus = ["blockRefContextMenu", "blockContextMenu"] } = {}) {
  const ui = {};
  const commands = {};
  let pulls = 0;
  for (const m of menus) {
    commands[m] = new Map();
    ui[m] = {
      addCommand: (c) => { commands[m].set(c.label, c); },
      removeCommand: ({ label }) => { commands[m].delete(label); },
    };
  }
  return {
    ui, commands, pulls: () => pulls,
    data: { pull: (_p, [, uid]) => { pulls++; return uid in strings ? { ":block/string": strings[uid] } : null; } },
  };
}
function setup({ strings = {}, mode = "thumbnail", overrides = {}, ...rest } = {}) {
  const api = fakeApi(strings, rest);
  const calls = [];
  const rec = (name) => (...a) => { calls.push([name, ...a]); };
  const actions = {
    openRegion: rec("openRegion"), createPlainImageRegion: rec("createPlainImageRegion"), presentDrawing: rec("presentDrawing"),
    mindMapFromOutline: rec("mindMapFromOutline"), refreshCropsForDrawing: rec("refreshCropsForDrawing"),
    regionCaptionCandidate: rest.candidate || (() => null), relinkRegionCaption: async (uid) => { calls.push(["relinkRegionCaption", uid]); },
  };
  const regionref = { modeOf: () => mode, refreshBlock: rec("refreshBlock"), refreshRegion: rec("refreshRegion"), refreshAll: rec("refreshAll") };
  let t = 0;
  const dispose = installRoamMenus({
    api, host: {}, actions, regionref,
    getSettings: () => ({ refOverrides: overrides }),
    setRefOverride: async (...a) => { calls.push(["setRefOverride", ...a]); },
    openSettings: rec("openSettings"),
    now: () => t,
  });
  return { api, calls, dispose, advance: (ms) => { t += ms; } };
}
const show = (api, menu, label, e) => api.commands[menu].get(label)["display-conditional"](e);
const tick = () => new Promise((r) => setImmediate(r));

test("every label is registered and removed on dispose", () => {
  const { api, dispose } = setup();
  assert.deepEqual([...api.commands.blockRefContextMenu.keys()], [
    "Plexus: Open region", "Plexus: Open region in sidebar", "Plexus: Show as image", "Plexus: Show as thumbnail",
    "Plexus: Show as link", "Plexus: Use default display", "Plexus: Refresh crop", "Plexus: Link caption to source blocks", "Plexus: Region settings…",
  ]);
  assert.deepEqual([...api.commands.blockContextMenu.keys()], [
    "Plexus: Region on image", "Plexus: Present frames", "Plexus: Mind map from outline", "Plexus: Open region",
    "Plexus: Refresh crop", "Plexus: Link caption to source blocks", "Plexus: Refresh crops", "Plexus: Region settings…",
  ]);
  dispose();
  assert.equal(api.commands.blockRefContextMenu.size, 0);
  assert.equal(api.commands.blockContextMenu.size, 0);
});

test("missing menus are skipped and dispose survives a throwing removeCommand", () => {
  const api = fakeApi({}, { menus: ["blockRefContextMenu"] });
  api.ui.blockRefContextMenu.removeCommand = () => { throw new Error("x"); };
  const warn = console.warn; console.warn = () => {};
  try {
    const dispose = installRoamMenus({ api, actions: {}, regionref: {}, setRefOverride() {}, openSettings() {} });
    assert.doesNotThrow(dispose);
  } finally { console.warn = warn; }
});

test("ref menu items show only for supported regions; unknown uid and throwing pulls are false", () => {
  const { api } = setup({ strings: { reg000001: REGION, plain0001: "hello" } });
  const e = (ref) => ({ "ref-uid": ref, "block-uid": "blk000001" });
  assert.equal(show(api, "blockRefContextMenu", "Plexus: Open region", e("reg000001")), true);
  assert.equal(show(api, "blockRefContextMenu", "Plexus: Open region", e("plain0001")), false);
  assert.equal(show(api, "blockRefContextMenu", "Plexus: Open region", e("missing01")), false);
  api.data.pull = () => { throw new Error("boom"); };
  assert.equal(show(api, "blockRefContextMenu", "Plexus: Open region", e("other0001")), false);
});

test("show-as items hide the current mode; default display needs an override", () => {
  const e = { "ref-uid": "reg000001", "block-uid": "blk000001" };
  const a = setup({ strings: { reg000001: REGION }, mode: "thumbnail" });
  const shows = (api) => ["image", "thumbnail", "link"].map((m) => show(api, "blockRefContextMenu", `Plexus: Show as ${m}`, e));
  assert.deepEqual(shows(a.api), [true, false, true]);
  assert.equal(show(a.api, "blockRefContextMenu", "Plexus: Use default display", e), false);
  const b = setup({ strings: { reg000001: REGION }, mode: "link", overrides: { "blk000001|reg000001": "link" } });
  assert.deepEqual(shows(b.api), [true, true, false]);
  assert.equal(show(b.api, "blockRefContextMenu", "Plexus: Use default display", e), true);
});

test("one pull is shared by all conditionals of a menu opening, then expires", () => {
  const { api, advance } = setup({ strings: { reg000001: REGION } });
  const e = { "ref-uid": "reg000001", "block-uid": "blk000001" };
  for (const label of api.commands.blockRefContextMenu.keys()) show(api, "blockRefContextMenu", label, e);
  assert.equal(api.pulls(), 1);
  advance(600);
  show(api, "blockRefContextMenu", "Plexus: Open region", e);
  assert.equal(api.pulls(), 2);
});

test("ref callbacks call actions; show-as sets the override then refreshes the block", async () => {
  const { api, calls } = setup({ strings: { reg000001: REGION } });
  const e = { "ref-uid": "reg000001", "block-uid": "blk000001" };
  const run = (label) => api.commands.blockRefContextMenu.get(label).callback(e);
  run("Plexus: Open region");
  run("Plexus: Open region in sidebar");
  run("Plexus: Show as link");
  run("Plexus: Refresh crop");
  run("Plexus: Region settings…");
  await tick();
  assert.deepEqual(calls, [
    ["openRegion", "reg000001", { sidebar: false }],
    ["openRegion", "reg000001", { sidebar: true }],
    ["setRefOverride", "blk000001", "reg000001", "link"],
    ["refreshRegion", "reg000001"],
    ["openSettings"],
    ["refreshBlock", "blk000001"],
  ]);
  calls.length = 0;
  run("Plexus: Use default display");
  await tick();
  assert.deepEqual(calls, [["setRefOverride", "blk000001", "reg000001", null], ["refreshBlock", "blk000001"]]);
});

test("block menu conditionals by content", () => {
  const { api } = setup({ strings: { img000001: "see ![a](https://x/y.png)", dra000001: "{{[[excalidraw]]}}", reg000001: REGION, txt000001: "hi" } });
  const e = (u) => ({ "block-uid": u });
  const s = (label, u) => show(api, "blockContextMenu", label, e(u));
  assert.equal(s("Plexus: Region on image", "img000001"), true);
  assert.equal(s("Plexus: Region on image", "txt000001"), false);
  assert.equal(s("Plexus: Present frames", "dra000001"), true);
  assert.equal(s("Plexus: Present frames", "img000001"), false);
  assert.equal(s("Plexus: Open region", "reg000001"), true);
  assert.equal(s("Plexus: Refresh crop", "txt000001"), false);
  assert.equal(s("Plexus: Refresh crops", "dra000001"), true);
  assert.equal(s("Plexus: Region settings…", "dra000001"), true);
  assert.equal(s("Plexus: Mind map from outline", "txt000001"), true);
});

test("block callbacks call actions and swallow errors", async () => {
  const { api, calls } = setup({ strings: {} });
  const e = { "block-uid": "blk000001" };
  api.commands.blockContextMenu.get("Plexus: Refresh crops").callback(e);
  api.commands.blockContextMenu.get("Plexus: Present frames").callback(e);
  api.commands.blockContextMenu.get("Plexus: Mind map from outline").callback(e);
  api.commands.blockContextMenu.get("Plexus: Region on image").callback(e);
  assert.deepEqual(calls, [
    ["refreshCropsForDrawing", "blk000001"], ["presentDrawing", { drawingUid: "blk000001" }],
    ["mindMapFromOutline", "blk000001"], ["createPlainImageRegion", "blk000001"],
  ]);
  const warn = console.warn; const seen = []; console.warn = (...a) => seen.push(a);
  try {
    const api2 = fakeApi({});
    installRoamMenus({ api: api2, actions: { mindMapFromOutline: async () => { throw new Error("x"); } }, regionref: {}, setRefOverride() {}, openSettings() {} });
    api2.commands.blockContextMenu.get("Plexus: Mind map from outline").callback(e);
    await tick();
  } finally { console.warn = warn; }
  assert.ok(seen.some((a) => String(a[0]).startsWith("[plexus]")));
});

// canvas menu
function node(tag) {
  const n = {
    tag, children: [], listeners: {}, attrs: {}, className: "", style: {}, parent: null, textContent: "",
    append(...c) { for (const x of c) { x.parent = this; this.children.push(x); } },
    addEventListener(t, f, o) { (this.listeners[t] ||= []).push([f, o]); },
    removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter(([x]) => x !== f); },
    setAttribute(k, v) { this.attrs[k] = v; },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; },
    querySelectorAll(sel) {
      const out = [];
      const walk = (x) => { for (const c of x.children) { if (sel === "[data-plexus-item]" && c.attrs["data-plexus-item"]) out.push(c); walk(c); } };
      walk(this);
      return out;
    },
    querySelector(sel) { return sel === ".popover > ul.context-menu" ? this.ul ?? null : null; },
  };
  return n;
}
function canvas({ rect = { top: 100, bottom: 300 }, innerHeight = 1000, items } = {}) {
  const container = node("div");
  const ul = node("ul");
  const react = node("li"); // React's own item
  ul.append(react);
  const popover = node("div");
  popover.style.top = "100px";
  popover.getBoundingClientRect = () => rect;
  ul.closest = () => popover;
  const doc = { createElement: node, defaultView: { innerHeight } };
  const queue = [];
  let id = 0;
  const raf = (fn) => { queue.push([++id, fn]); return id; };
  const caf = (i) => { const k = queue.findIndex(([x]) => x === i); if (k >= 0) queue.splice(k, 1); };
  const flush = () => { const q = queue.splice(0); for (const [, fn] of q) fn(); };
  const states = [];
  const ran = [];
  const menu = installCanvasMenu({
    doc, app: { setState: (s) => states.push(s) }, containerEl: container, raf, caf,
    getItems: () => items ?? [
      { id: "region", label: "Plexus: Create region", enabled: true, run: () => ran.push("region") },
      { id: "off", label: "Off", enabled: false, run: () => ran.push("off") },
    ],
  });
  return { container, ul, popover, queue, flush, menu, states, ran, react, contextmenu: () => container.listeners.contextmenu.forEach(([f]) => f({})) };
}

test("canvas menu appends separator plus enabled items once per menu and click closes then runs", () => {
  const c = canvas();
  c.contextmenu(); c.flush();
  assert.equal(c.queue.length, 1, "menu not yet present: polling continues");
  c.container.ul = c.ul;
  c.contextmenu(); c.flush();
  const ours = c.ul.children.filter((n) => n.attrs["data-plexus-item"]);
  assert.deepEqual(ours.map((n) => n.tag), ["hr", "li"]);
  assert.equal(ours[1].attrs["data-testid"], "plexus-region");
  const button = ours[1].children[0];
  assert.equal(button.className, "context-menu-item");
  assert.equal(button.children[0].textContent, "Plexus: Create region");
  assert.equal(button.children[1].tag, "kbd");
  // second contextmenu on the same ul replaces, never duplicates
  c.contextmenu(); c.flush();
  assert.equal(c.ul.children.filter((n) => n.attrs["data-plexus-item"]).length, 2);
  const order = [];
  const c2 = canvas({ items: [{ id: "x", label: "X", enabled: true, run: () => order.push(c2.states.length) }] });
  c2.container.ul = c2.ul; c2.contextmenu(); c2.flush();
  let prevented = 0, stopped = 0;
  c2.ul.children.at(-1).children[0].listeners.click[0][0]({ preventDefault() { prevented++; }, stopPropagation() { stopped++; } });
  assert.deepEqual(c2.states, [{ contextMenu: null }]);
  assert.deepEqual(order, [1], "run happens after setState");
  assert.equal(prevented + stopped, 2);
});

test("canvas menu polls at most three ticks and a throwing run is swallowed", () => {
  const c = canvas();
  c.contextmenu();
  for (let i = 0; i < 5; i++) c.flush();
  assert.equal(c.queue.length, 0);
  const t = canvas({ items: [{ id: "x", label: "X", enabled: true, run: () => { throw new Error("no"); } }] });
  t.container.ul = t.ul; t.contextmenu(); t.flush();
  const warn = console.warn; console.warn = () => {};
  try { assert.doesNotThrow(() => t.ul.children.at(-1).children[0].listeners.click[0][0]({})); } finally { console.warn = warn; }
});

test("canvas menu viewport clamp moves the popover up by the overflow in its own coordinates", () => {
  const c = canvas({ rect: { top: 700, bottom: 1100 }, innerHeight: 1000 });
  c.container.ul = c.ul; c.contextmenu(); c.flush();
  assert.equal(c.popover.style.top, "-8px"); // 100 - (1100 - 992)
  const d = canvas({ rect: { top: 20, bottom: 1100 }, innerHeight: 1000 });
  d.container.ul = d.ul; d.contextmenu(); d.flush();
  assert.equal(d.popover.style.top, "88px"); // limited by rect.top - 8 = 12
  const ok = canvas({ rect: { top: 100, bottom: 300 } });
  ok.container.ul = ok.ul; ok.contextmenu(); ok.flush();
  assert.equal(ok.popover.style.top, "100px");
});

test("canvas dispose removes the listener, pending rafs and injected nodes", () => {
  const c = canvas();
  c.container.ul = c.ul; c.contextmenu(); c.flush();
  c.contextmenu();
  assert.equal(c.queue.length, 1);
  c.menu();
  assert.equal(c.container.listeners.contextmenu.length, 0);
  assert.equal(c.queue.length, 0);
});

test("link caption item shows only when a different candidate exists and never throws", () => {
  const LINK = "Plexus: Link caption to source blocks";
  const e = { "ref-uid": "reg000001", "block-uid": "blk000001" };
  const be = { "block-uid": "reg000001" };
  let candidate = "((h6dynpr9M))";
  const { api } = setup({ strings: { reg000001: REGION, plain0001: "hello" }, candidate: () => candidate });
  assert.equal(show(api, "blockRefContextMenu", LINK, e), true);
  assert.equal(show(api, "blockContextMenu", LINK, be), true);
  assert.equal(show(api, "blockContextMenu", LINK, { "block-uid": "plain0001" }), false);
  assert.equal(show(api, "blockRefContextMenu", LINK, { "ref-uid": "plain0001", "block-uid": "b" }), false);
  const none = setup({ strings: { reg000001: REGION }, candidate: () => null });
  assert.equal(show(none.api, "blockRefContextMenu", LINK, e), false);
  assert.equal(show(none.api, "blockContextMenu", LINK, be), false);
  const boom = setup({ strings: { reg000001: REGION }, candidate: () => { throw new Error("x"); } });
  assert.equal(show(boom.api, "blockRefContextMenu", LINK, e), false);
  assert.equal(show(boom.api, "blockContextMenu", LINK, be), false);
});

test("link caption callback relinks then refreshes the region", async () => {
  const LINK = "Plexus: Link caption to source blocks";
  const { api, calls } = setup({ strings: { reg000001: REGION }, candidate: () => "((x))" });
  api.commands.blockRefContextMenu.get(LINK).callback({ "ref-uid": "reg000001", "block-uid": "b" });
  await tick();
  assert.deepEqual(calls, [["relinkRegionCaption", "reg000001"], ["refreshRegion", "reg000001"]]);
});
