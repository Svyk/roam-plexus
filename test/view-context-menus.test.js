import assert from "node:assert/strict";
import test from "node:test";

import { installRoamMenus, installCanvasMenu, plexusCanvasItems } from "../src/view/context-menus.js";

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
function setup({ strings = {}, mode = "thumbnail", overrides = {}, regionGalleries, openPrompt, ...rest } = {}) {
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
    getSettings: () => ({ refOverrides: overrides, regionGalleries }),
    setRefOverride: async (...a) => { calls.push(["setRefOverride", ...a]); },
    setRegionGallery: async (...a) => { calls.push(["setRegionGallery", ...a]); },
    applyGalleries: () => { calls.push(["applyGalleries"]); },
    openPrompt,
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
    "Plexus: Show as link", "Plexus: Use default display", "Plexus: Hide caption", "Plexus: Show caption",
    "Plexus: Card size small", "Plexus: Card size medium", "Plexus: Card size large",
    "Plexus: Align left", "Plexus: Align center", "Plexus: Align right",
    "Plexus: Bare card", "Plexus: Show card frame", "Plexus: Card padding…",
    "Plexus: Present from here", "Plexus: Refresh crop",
    "Plexus: Link caption to source blocks", "Plexus: Name region", "Plexus: Copy crop as PNG", "Plexus: Copy crop as SVG",
    "Plexus: Download crop", "Plexus: Insert crop as image block", "Plexus: Copy alias", "Plexus: Show in Compass", "Plexus: Region settings…",
    "Plexus: Copy region link",
  ]);
  assert.deepEqual([...api.commands.blockContextMenu.keys()], [
    "Plexus: Show as gallery", "Plexus: Show as list",
    "Plexus: Region on image", "Plexus: Present frames", "Plexus: Show in Compass", "Plexus: Print frames", "Plexus: PNG per frame", "Plexus: Present this outline",
    "Plexus: Present from here", "Plexus: Mind map from outline", "Plexus: Open region",
    "Plexus: Refresh crop", "Plexus: Link caption to source blocks", "Plexus: Name region", "Plexus: Copy crop as PNG",
    "Plexus: Copy crop as SVG", "Plexus: Download crop", "Plexus: Copy alias", "Plexus: Refresh crops", "Plexus: Region settings…",
    "Plexus: Select on drawing", "Plexus: Update region from selection", "Plexus: Repair region", "Plexus: Copy region link",
    "Plexus: New drawing here", "Plexus: New drawing below",
  ]);
  dispose();
  assert.equal(api.commands.blockRefContextMenu.size, 0);
  assert.equal(api.commands.blockContextMenu.size, 0);
});

test("Show in Compass uses ref-uid on a block ref and block-uid on a drawing", () => {
  const seen = [];
  const api = fakeApi({ dra000001: "{{[[excalidraw]]}}", txt000001: "hi" });
  installRoamMenus({
    api, actions: {}, regionref: {}, setRefOverride() {}, openSettings() {},
    showInCompass: (uid) => seen.push(uid),
  });
  const ref = { "ref-uid": "ref000001", "block-uid": "blk000001" };
  assert.equal(show(api, "blockRefContextMenu", "Plexus: Show in Compass", ref), true);
  assert.equal(show(api, "blockRefContextMenu", "Plexus: Show in Compass", { "block-uid": "blk000001" }), false);
  api.commands.blockRefContextMenu.get("Plexus: Show in Compass").callback(ref);
  assert.equal(show(api, "blockContextMenu", "Plexus: Show in Compass", { "block-uid": "dra000001" }), true);
  assert.equal(show(api, "blockContextMenu", "Plexus: Show in Compass", { "block-uid": "txt000001" }), false);
  api.commands.blockContextMenu.get("Plexus: Show in Compass").callback({ "block-uid": "dra000001" });
  assert.deepEqual(seen, ["ref000001", "dra000001"]);
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
    ["setRefOverride", "blk000001", "reg000001", { mode: "link" }],
    ["refreshRegion", "reg000001"],
    ["openSettings"],
    ["refreshBlock", "blk000001"],
  ]);
  calls.length = 0;
  run("Plexus: Use default display");
  await tick();
  assert.deepEqual(calls, [["setRefOverride", "blk000001", "reg000001", { mode: null }], ["refreshBlock", "blk000001"]]);
});

const CONTAINER = "{{[[plexus-regions]]}}";

test("gallery items follow an exact container string and do not write the block", async () => {
  const strings = {
    box000001: CONTAINER,
    extra0001: `${CONTAINER} gallery`,
    reg000001: REGION,
    flag00001: CONTAINER,
  };
  const { api, calls } = setup({ strings, regionGalleries: ["flag00001"] });
  const s = (label, uid) => show(api, "blockContextMenu", label, { "block-uid": uid });
  assert.equal(s("Plexus: Show as gallery", "box000001"), true);
  assert.equal(s("Plexus: Show as list", "box000001"), false);
  assert.equal(s("Plexus: Show as gallery", "extra0001"), false);
  assert.equal(s("Plexus: Show as list", "extra0001"), false);
  assert.equal(s("Plexus: Show as gallery", "reg000001"), false);
  assert.equal(s("Plexus: Show as list", "reg000001"), false);
  assert.equal(s("Plexus: Show as gallery", "flag00001"), false);
  assert.equal(s("Plexus: Show as list", "flag00001"), true);
  const missing = setup({ strings: { box000001: CONTAINER } });
  assert.doesNotThrow(() => show(missing.api, "blockContextMenu", "Plexus: Show as gallery", { "block-uid": "box000001" }));
  api.commands.blockContextMenu.get("Plexus: Show as gallery").callback({ "block-uid": "box000001" });
  await tick();
  api.commands.blockContextMenu.get("Plexus: Show as list").callback({ "block-uid": "flag00001" });
  await tick();
  assert.deepEqual(calls, [
    ["setRegionGallery", "box000001", true],
    ["applyGalleries"],
    ["setRegionGallery", "flag00001", false],
    ["applyGalleries"],
  ]);
  assert.equal(api.data.pull("[:block/string]", [":block/uid", "box000001"])[":block/string"], CONTAINER);
  assert.equal(api.data.pull("[:block/string]", [":block/uid", "flag00001"])[":block/string"], CONTAINER);
});

test("card size large hides for size l and for link mode", () => {
  const e = { "ref-uid": "reg000001", "block-uid": "blk000001" };
  const label = "Plexus: Card size large";
  const thumb = setup({ strings: { reg000001: REGION }, mode: "thumbnail" });
  assert.equal(show(thumb.api, "blockRefContextMenu", label, e), true);
  const sized = setup({ strings: { reg000001: REGION }, mode: "thumbnail", overrides: { "blk000001|reg000001": { size: "s" } } });
  assert.equal(show(sized.api, "blockRefContextMenu", label, e), true);
  const large = setup({ strings: { reg000001: REGION }, mode: "thumbnail", overrides: { "blk000001|reg000001": { size: "l" } } });
  assert.equal(show(large.api, "blockRefContextMenu", label, e), false);
  const link = setup({ strings: { reg000001: REGION }, mode: "link" });
  assert.equal(show(link.api, "blockRefContextMenu", label, e), false);
});

test("card padding writes only an integer 0..48", async () => {
  const e = { "ref-uid": "reg000001", "block-uid": "blk000001" };
  const label = "Plexus: Card padding…";
  const none = setup({ strings: { reg000001: REGION }, mode: "thumbnail", openPrompt: async () => null });
  none.api.commands.blockRefContextMenu.get(label).callback(e);
  await tick();
  assert.equal(none.calls.some((c) => c[0] === "setRefOverride"), false);
  const ok = setup({ strings: { reg000001: REGION }, mode: "thumbnail", openPrompt: async () => "12" });
  ok.api.commands.blockRefContextMenu.get(label).callback(e);
  await tick();
  assert.deepEqual(ok.calls.filter((c) => c[0] === "setRefOverride"), [
    ["setRefOverride", "blk000001", "reg000001", { pad: 12 }],
  ]);
  const bad = setup({ strings: { reg000001: REGION }, mode: "thumbnail", openPrompt: async () => "99" });
  bad.api.commands.blockRefContextMenu.get(label).callback(e);
  await tick();
  assert.equal(bad.calls.some((c) => c[0] === "setRefOverride"), false);
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
function canvas({ rect = { top: 100, bottom: 300 }, innerHeight = 1000, innerWidth = 1000, items } = {}) {
  const container = node("div");
  const ul = node("ul");
  const react = node("li"); // React's own item
  ul.append(react);
  const popover = node("div");
  popover.style.top = "100px";
  popover.getBoundingClientRect = () => rect;
  ul.closest = () => popover;
  const doc = { createElement: node, defaultView: { innerHeight, innerWidth } };
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

const REGION_IMG = "{{[[plexus-region]]: k=imgrect d=abc123XYZ i=0 f=0.1,0.1,0.5,0.5}} Site";
function setup2({ strings, captionState = "written", mode = "thumbnail", overrides = {}, encrypted = false, prompt = async () => "New" } = {}) {
  const api = fakeApi(strings);
  const calls = [];
  const rec = (name) => (...a) => { calls.push([name, ...a]); };
  const actions = {
    nameRegion: async (...a) => { calls.push(["nameRegion", ...a]); },
    copyCropPng: rec("copyCropPng"), copyCropSvg: rec("copyCropSvg"), downloadCrop: rec("downloadCrop"),
    insertCropImage: rec("insertCropImage"), copyAlias: rec("copyAlias"),
  };
  const regionref = { modeOf: () => mode, captionStateOf: () => captionState, refreshBlock: rec("refreshBlock"), refreshRegion: rec("refreshRegion") };
  const prompts = [];
  installRoamMenus({
    api, host: {}, actions, regionref,
    getSettings: () => ({ refOverrides: overrides }),
    setRefOverride: async (...a) => { calls.push(["setRefOverride", ...a]); },
    openSettings() {}, isEncrypted: () => encrypted,
    openPrompt: async (o) => { prompts.push(o); return prompt(o); },
    doc: { querySelectorAll: () => [], defaultView: { innerWidth: 1000 } },
    now: () => 0,
  });
  return { api, calls, prompts };
}
const RE = { "ref-uid": "reg000001", "block-uid": "blk000001" };

test("caption items follow captionStateOf and mode; default display needs a mode override, not a caption one", () => {
  const strings = { reg000001: REGION };
  const has = (o, label) => show(setup2({ strings, ...o }).api, "blockRefContextMenu", label, RE);
  assert.equal(has({}, "Plexus: Hide caption"), true);
  assert.equal(has({}, "Plexus: Show caption"), false);
  assert.equal(has({ captionState: "hide" }, "Plexus: Hide caption"), false);
  assert.equal(has({ captionState: "hide" }, "Plexus: Show caption"), true);
  assert.equal(has({ mode: "link" }, "Plexus: Hide caption"), false);
  assert.equal(has({ overrides: { "blk000001|reg000001": { caption: "hide" } } }, "Plexus: Use default display"), false);
  assert.equal(has({ overrides: { "blk000001|reg000001": { mode: "link", caption: "hide" } } }, "Plexus: Use default display"), true);
});

test("hide and show caption write caption patches then refresh the block", async () => {
  const { api, calls } = setup2({ strings: { reg000001: REGION } });
  api.commands.blockRefContextMenu.get("Plexus: Hide caption").callback(RE);
  api.commands.blockRefContextMenu.get("Plexus: Show caption").callback(RE);
  await tick();
  assert.deepEqual(calls.filter((c) => c[0] === "setRefOverride"), [
    ["setRefOverride", "blk000001", "reg000001", { caption: "hide" }],
    ["setRefOverride", "blk000001", "reg000001", { caption: "show" }],
  ]);
});

test("SVG copy is drawing kinds only; insert is hidden on encrypted graphs and absent from the region-block menu", () => {
  const draw = setup2({ strings: { reg000001: REGION } });
  const img = setup2({ strings: { reg000001: REGION_IMG } });
  assert.equal(show(draw.api, "blockRefContextMenu", "Plexus: Copy crop as SVG", RE), true);
  assert.equal(show(img.api, "blockRefContextMenu", "Plexus: Copy crop as SVG", RE), false);
  assert.equal(show(img.api, "blockRefContextMenu", "Plexus: Copy crop as PNG", RE), true);
  assert.equal(show(draw.api, "blockRefContextMenu", "Plexus: Insert crop as image block", RE), true);
  const enc = setup2({ strings: { reg000001: REGION }, encrypted: true });
  assert.equal(show(enc.api, "blockRefContextMenu", "Plexus: Insert crop as image block", RE), false);
  assert.equal(draw.api.commands.blockContextMenu.has("Plexus: Insert crop as image block"), false);
  assert.equal(show(draw.api, "blockContextMenu", "Plexus: Copy alias", { "block-uid": "reg000001" }), true);
  assert.equal(show(draw.api, "blockContextMenu", "Plexus: Copy alias", { "block-uid": "nope00001" }), false);
});

test("crop and alias callbacks call the injected actions synchronously", () => {
  const { api, calls } = setup2({ strings: { reg000001: REGION } });
  for (const label of ["Plexus: Copy crop as PNG", "Plexus: Copy crop as SVG", "Plexus: Download crop", "Plexus: Insert crop as image block", "Plexus: Copy alias"]) {
    api.commands.blockRefContextMenu.get(label).callback(RE);
  }
  assert.deepEqual(calls, [
    ["copyCropPng", "reg000001"], ["copyCropSvg", "reg000001"], ["downloadCrop", "reg000001"],
    ["insertCropImage", "reg000001", "blk000001"], ["copyAlias", "reg000001"],
  ]);
});

test("Name region prompts with the raw caption and cancel-on-escape, then names and refreshes without purging", async () => {
  const { api, calls, prompts } = setup2({ strings: { reg000001: REGION } });
  api.commands.blockRefContextMenu.get("Plexus: Name region").callback(RE);
  await tick();
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].initial, "Region A");
  assert.equal(prompts[0].escape, "cancel");
  assert.equal(prompts[0].select, true);
  assert.deepEqual(prompts[0].rect, { left: 400, top: 60, width: 200, height: 0 });
  assert.deepEqual(calls, [["nameRegion", "reg000001", "New"], ["refreshRegion", "reg000001", { purge: false }]]);
});

test("Name region does nothing when the prompt is cancelled", async () => {
  const { api, calls } = setup2({ strings: { reg000001: REGION }, prompt: async () => null });
  api.commands.blockContextMenu.get("Plexus: Name region").callback({ "block-uid": "reg000001" });
  await tick();
  assert.deepEqual(calls, []);
});

const FRAME = "{{[[plexus-region]]: k=frame d=abc123XYZ fr=frame1 pad=0}} Slide 1";
const CFRAME = "{{[[plexus-region]]: k=cframe d=abc123XYZ fr=frame2}} Slide 2";

test("Present from here shows for frame and cframe regions only, on refs and blocks, and calls presentFromRegion", async () => {
  const api = fakeApi({ fr0000001: FRAME, cf0000001: CFRAME, reg000001: REGION });
  const calls = [];
  installRoamMenus({
    api, host: {}, actions: { presentFromRegion: (u) => { calls.push(["from", u]); }, regionCaptionCandidate: () => null },
    regionref: { modeOf: () => "thumbnail" }, setRefOverride() {}, openSettings() {}, now: () => 0,
  });
  const ref = (u) => ({ "ref-uid": u, "block-uid": "blk000001" });
  assert.equal(show(api, "blockRefContextMenu", "Plexus: Present from here", ref("fr0000001")), true);
  assert.equal(show(api, "blockRefContextMenu", "Plexus: Present from here", ref("cf0000001")), true);
  assert.equal(show(api, "blockRefContextMenu", "Plexus: Present from here", ref("reg000001")), false);
  assert.equal(show(api, "blockRefContextMenu", "Plexus: Present from here", ref("missing01")), false);
  assert.equal(show(api, "blockContextMenu", "Plexus: Present from here", { "block-uid": "fr0000001" }), true);
  assert.equal(show(api, "blockContextMenu", "Plexus: Present from here", { "block-uid": "reg000001" }), false);
  api.commands.blockRefContextMenu.get("Plexus: Present from here").callback(ref("fr0000001"));
  api.commands.blockContextMenu.get("Plexus: Present from here").callback({ "block-uid": "cf0000001" });
  await tick();
  assert.deepEqual(calls, [["from", "fr0000001"], ["from", "cf0000001"]]);
});

test("Print frames, PNG per frame and Present this outline call their actions", async () => {
  const api = fakeApi({ dr0000001: "{{[[excalidraw]]}} sketch", plain0001: "hello" });
  const calls = [];
  installRoamMenus({
    api, host: {}, actions: { printFrames: (a) => { calls.push(["print", a]); }, presentOutline: (u) => { calls.push(["outline", u]); } },
    regionref: {}, setRefOverride() {}, openSettings() {}, now: () => 0,
  });
  const pull = api.data.pull;
  api.data.pull = (pat, ref) => (String(pat).includes(":block/children") ? { ":block/children": [{ ":block/string": "((abcdefghi))" }] } : pull(pat, ref));
  const e = (u) => ({ "block-uid": u });
  for (const label of ["Plexus: Print frames", "Plexus: PNG per frame"]) {
    assert.equal(show(api, "blockContextMenu", label, e("dr0000001")), true, label);
    assert.equal(show(api, "blockContextMenu", label, e("plain0001")), false, label);
  }
  api.commands.blockContextMenu.get("Plexus: Print frames").callback(e("dr0000001"));
  api.commands.blockContextMenu.get("Plexus: PNG per frame").callback(e("dr0000001"));
  api.commands.blockContextMenu.get("Plexus: Present this outline").callback(e("plain0001"));
  await tick();
  assert.deepEqual(calls, [
    ["print", { drawingUid: "dr0000001", mode: "print" }],
    ["print", { drawingUid: "dr0000001", mode: "png" }],
    ["outline", "plain0001"],
  ]);
});

test("Present this outline: shows for a ((ref)) or alias-link child, not for text; one memoized pull; throw is false", () => {
  const api = fakeApi({});
  installRoamMenus({ api, host: {}, actions: {}, regionref: {}, setRefOverride() {}, openSettings() {}, now: () => 0 });
  let pulls = 0;
  let kids = [{ ":block/string": "notes" }, { ":block/string": "  [slide](((abcdefghi)))  " }];
  api.data.pull = () => { pulls++; return { ":block/children": kids }; };
  const label = "Plexus: Present this outline";
  assert.equal(show(api, "blockContextMenu", label, { "block-uid": "p00000001" }), true);
  assert.equal(show(api, "blockContextMenu", label, { "block-uid": "p00000001" }), true);
  assert.equal(pulls, 1);
  kids = [{ ":block/string": "see ((abcdefghi)) here" }, { ":block/string": "[[Page]]" }, {}];
  assert.equal(show(api, "blockContextMenu", label, { "block-uid": "p00000002" }), false);
  kids = { ":block/string": "((abcdefghi))" };
  assert.equal(show(api, "blockContextMenu", label, { "block-uid": "p00000003" }), true);
  api.data.pull = () => { throw new Error("boom"); };
  assert.equal(show(api, "blockContextMenu", label, { "block-uid": "p00000004" }), false);
});

test("canvas menu: Present from here needs frames and passes the scene point; Add notes needs a selected frame", async () => {
  const calls = [];
  let frames = true;
  let selected = null;
  const actions = {
    hasFrames: () => frames, selectedFrameId: () => selected,
    presentDrawing: (a) => { calls.push(["present", a]); },
    addNotesForFrame: (a) => { calls.push(["notes", a]); },
  };
  const native = { selectedElementIds: () => [] };
  const build = (extra = {}) => plexusCanvasItems({ app: {}, native, actions, openSettings() {}, drawingUid: "drw000001", mac: false, ...extra });
  const item = (items, id) => items.find((i) => i.id === id);
  let items = build({ point: { x: 3, y: 4 }, toScene: (p) => ({ x: p.x * 10, y: p.y * 10 }) });
  assert.equal(item(items, "present-here").label, "Plexus: Present from here");
  assert.equal(item(items, "present-here").enabled, true);
  assert.equal(item(items, "add-notes").label, "Plexus: Add notes");
  assert.equal(item(items, "add-notes").enabled, false);
  item(items, "present-here").run();
  selected = "frameA";
  items = build();
  assert.equal(item(items, "add-notes").enabled, true);
  item(items, "add-notes").run();
  item(items, "present-here").run();
  frames = false;
  assert.equal(item(build(), "present-here").enabled, false);
  actions.selectedFrameId = () => { throw new Error("x"); };
  assert.equal(item(build(), "add-notes").enabled, false);
  await tick();
  assert.deepEqual(calls, [
    ["present", { from: "here", at: { x: 30, y: 40 } }],
    ["notes", { drawingUid: "drw000001", frameId: "frameA" }],
    ["present", { from: "here", at: undefined }],
  ]);
  assert.equal(items.filter((i) => i.id === "present").length, 1, "the plain Present entry stays");
});

test("canvas menu: P12 items call the tools, and the mind-map items follow mapOptions", async () => {
  const calls = [];
  const tools = {
    restore: () => calls.push("restore"),
    chart: () => calls.push("chart"),
    outline: (ctx) => calls.push(["outline", ctx]),
    copyMarkdown: (ctx) => calls.push(["md", ctx]),
  };
  let opts = null;
  const mindmap = {
    mapOptions: () => opts,
    setLayout: (app, layout) => calls.push(["layout", layout]),
    setAttrEdges: (app, on) => calls.push(["attr", on]),
  };
  const native = { selectedElementIds: () => [] };
  const build = (extra = {}) => plexusCanvasItems({ app: {}, native, actions: {}, openSettings() {}, drawingUid: "drw000001", mac: false, tools, mindmap, ...extra });
  const item = (items, id) => items.find((i) => i.id === id);
  let items = build();
  for (const id of ["restore-version", "chart-json", "to-outline", "copy-markdown"]) assert.equal(item(items, id).enabled, true, id);
  assert.equal(item(items, "mm-layout-cause").enabled, false);
  assert.equal(item(items, "mm-attr-edges").enabled, false);
  assert.equal(item(build({ tools: undefined }), "restore-version").enabled, false);
  assert.equal(item(build({ drawingUid: undefined }), "chart-json").enabled, false);
  opts = { root: "r", layout: "cause", attrEdges: false };
  items = build();
  assert.match(item(items, "mm-layout-cause").label, /\(current\)/);
  assert.doesNotMatch(item(items, "mm-layout-right").label, /current/);
  assert.equal(item(items, "mm-attr-edges").label, "Plexus: Attribute blocks as edges: off");
  for (const id of ["restore-version", "chart-json", "to-outline", "copy-markdown", "mm-layout-fishbone", "mm-layout-flow", "mm-attr-edges"]) item(items, id).run();
  await tick();
  assert.deepEqual(calls, ["restore", "chart", ["outline", { focusedUid: "drw000001" }], ["md", { focusedUid: "drw000001" }], ["layout", "fishbone"], ["layout", "flow"], ["attr", true]]);
  assert.equal(item(items, "mm-layout-flow").label, "Plexus: Mind map layout: Flow");
});

test("canvas items: Arrange is a submenu built from ARRANGE_OPS, hidden when nothing can run", async () => {
  const { ARRANGE_OPS } = await import("../src/model/arrange.js");
  const ran = [];
  let allowed = new Set(["row", "swap"]);
  const arrange = { canRun: (op) => allowed.has(op), run: (op) => { ran.push(op); return true; } };
  const build = () => plexusCanvasItems({ app: {}, native: { selectedElementIds: () => [] }, actions: {}, openSettings() {}, drawingUid: "drw000001", mac: false, arrange });
  const arrangeItem = (items) => items.find((i) => i.id === "arrange");
  let item = arrangeItem(build());
  assert.equal(item.label, "Plexus: Arrange \u203a");
  assert.equal(item.enabled, true);
  assert.deepEqual(item.children.map((c) => c.label), ARRANGE_OPS.map((o) => o.label));
  assert.deepEqual(item.children.filter((c) => c.enabled).map((c) => c.id), ["arrange-row", "arrange-swap"]);
  item.children.find((c) => c.id === "arrange-swap").run();
  assert.deepEqual(ran, ["swap"]);
  allowed = new Set();
  assert.equal(arrangeItem(build()).enabled, false);
  assert.equal(plexusCanvasItems({ app: {}, native: { selectedElementIds: () => [] }, actions: {}, openSettings() {}, mac: false }).find((i) => i.id === "arrange").enabled, false);
});

test("canvas menu submenu opens on hover and click, flips left, clamps, skips when no child is enabled, and dies on dispose", () => {
  const ran = [];
  const sub = { id: "arr", label: "Arrange \u203a", enabled: true, children: [
    { id: "a", label: "A", enabled: true, run: () => ran.push("a") },
    { id: "b", label: "B", enabled: false, hint: "Select two", run: () => ran.push("b") },
  ] };
  const c = canvas({ items: [sub, { id: "dead", label: "Dead", enabled: true, children: [{ id: "x", label: "X", enabled: false }] }] });
  c.container.ul = c.ul; c.contextmenu(); c.flush();
  const ours = c.ul.children.filter((n) => n.attrs["data-plexus-item"]);
  assert.deepEqual(ours.map((n) => n.tag), ["hr", "li"], "the all-disabled submenu is not injected");
  const li = ours[1];
  assert.equal(li.attrs["data-testid"], "plexus-arr");
  const [button, flyout] = li.children;
  assert.equal(flyout.tag, "ul");
  assert.equal(flyout.attrs["data-plexus-item"], "1");
  assert.equal(flyout.children.length, 2);
  assert.equal(flyout.children[1].children[0].disabled, true);
  li.removeAttribute = (k) => { delete li.attrs[k]; };
  button.getBoundingClientRect = () => ({ left: 700, right: 900, top: 300, bottom: 324, width: 200, height: 24 });
  flyout.getBoundingClientRect = () => ({ left: 900, right: 1100, top: 300, bottom: 400, width: 200, height: 100 });
  li.listeners.mouseenter[0][0]();
  assert.equal(li.attrs["data-open"], "1");
  assert.equal(flyout.style.position, "fixed");
  assert.equal(flyout.style.left, "500px", "flips to the left when it would leave the viewport");
  assert.equal(flyout.style.top, "300px");
  button.getBoundingClientRect = () => ({ left: 100, right: 300, top: 800, bottom: 824, width: 200, height: 24 });
  flyout.getBoundingClientRect = () => ({ left: 300, right: 500, top: 800, bottom: 1000, width: 200, height: 200 });
  li.listeners.mouseenter[0][0]();
  assert.equal(flyout.style.left, "300px");
  assert.equal(flyout.style.top, "792px", "clamps the flyout to the bottom of the viewport");
  li.listeners.mouseleave[0][0]();
  assert.equal(li.attrs["data-open"], undefined);
  let stopped = 0;
  button.listeners.click[0][0]({ preventDefault() {}, stopPropagation() { stopped++; } });
  assert.equal(li.attrs["data-open"], "1");
  assert.equal(stopped, 1);
  assert.deepEqual(c.states, [], "opening the flyout leaves the canvas menu open");
  flyout.children[0].children[0].listeners.click[0][0]({});
  assert.deepEqual(c.states, [{ contextMenu: null }]);
  assert.deepEqual(ran, ["a"]);
  c.menu();
  assert.equal(c.container.listeners.contextmenu.length, 0);
});
