import assert from "node:assert/strict";
import test from "node:test";

import { createActions } from "../src/actions.js";
import { serializeRegion } from "../src/model/region.js";
import { directGuard } from "../src/host/guard.js";
import { elementBounds } from "../src/model/scene.js";
import { containingRegion, coverBoxes, idsForBuild, idsWithoutOccluders, patchPlexus } from "../src/model/slides.js";
import { rewriteSvgTitles } from "../src/model/pagelink.js";
import { createLiveShow, viewPatch } from "../src/view/live-present.js";

const D = "drw000001";

const frame = (id, extra = {}) => ({ id, type: "frame", x: 0, y: 0, width: 200, height: 120, name: "One", isDeleted: false, version: 1, ...extra });
const box = (id, extra = {}) => ({ id, type: "rectangle", x: 10, y: 10, width: 40, height: 20, isDeleted: false, version: 1, ...extra });

test("idsForBuild omits the frame while a later step remains, and bound text follows its container", () => {
  const f = frame("f");
  const late = box("a", { frameId: "f", customData: { plexus: { step: 1 } } });
  const label = { id: "t", type: "text", x: 12, y: 12, width: 20, height: 10, frameId: "f", containerId: "a", isDeleted: false, version: 1 };
  const early = box("b", { frameId: "f" });
  const at0 = idsForBuild([f, late, label, early], f, 0);
  assert.deepEqual(at0, ["b"]);
  const at1 = idsForBuild([f, late, label, early], f, 1);
  assert.deepEqual(at1, ["f", "a", "t", "b"]);
  const plain = idsForBuild([f, early], f, 0);
  assert.deepEqual(plain, ["f", "b"]);
});

test("containingRegion picks the smaller box and coverBoxes are fractions of the crop", () => {
  const big = box("big", { x: 0, y: 0, width: 400, height: 300 });
  const small = box("small", { x: 10, y: 10, width: 40, height: 40 });
  const mark = box("m", { x: 12, y: 12, width: 10, height: 10 });
  const elements = [big, small, mark];
  const wide = { uid: "wide00001", region: { kind: "area", supported: true, ids: ["big"], pad: 0 } };
  const tight = { uid: "tight0001", region: { kind: "area", supported: true, ids: ["small"], pad: 0 } };
  const hit = containingRegion([wide, tight], elements, {}, elementBounds(mark));
  assert.equal(hit.uid, "tight0001");
  const outside = box("out", { x: 500, y: 500, width: 10, height: 10 });
  assert.equal(containingRegion([wide, tight], [...elements, outside], {}, elementBounds(outside)), null);
  const covers = coverBoxes([mark], ["m"], [0, 0, 100, 50]);
  assert.deepEqual(covers, [{ x: 0.12, y: 0.24, w: 0.1, h: 0.2 }]);
});

test("viewPatch writes only scroll and zoom, captureUpdate NEVER", () => {
  const patch = viewPatch({ scrollX: 3, scrollY: 4, zoom: 1.5 });
  assert.equal(patch.captureUpdate, "NEVER");
  assert.equal("elements" in patch, false);
  assert.deepEqual(patch.appState, { scrollX: 3, scrollY: 4, zoom: { value: 1.5 } });
});

test("a build step does not move the camera, and exit restores the entry view", () => {
  const f = frame("f");
  const late = box("a", { frameId: "f", customData: { plexus: { step: 1 } } });
  const writes = [];
  const chrome = [];
  let view = { scrollX: 5, scrollY: 6, zoom: 1 };
  const queue = [];
  const show = createLiveShow({
    frames: [f],
    elements: [f, late],
    viewport: { width: 800, height: 600 },
    readView: () => ({ ...view }),
    writeView: (next) => { writes.push({ ...next }); view = { ...next }; },
    onChrome: (on) => chrome.push(on),
    raf: (fn) => { queue.push(fn); return queue.length; },
    caf() {},
    now: () => 0,
  });
  show.start(0);
  assert.equal(writes.length, 1);
  assert.equal(chrome[0], true);
  show.next();
  assert.equal(show.build(), 1);
  assert.equal(writes.length, 1);
  show.exit();
  assert.deepEqual(writes.at(-1), { scrollX: 5, scrollY: 6, zoom: 1 });
  assert.equal(chrome.at(-1), false);
  show.exit();
  assert.equal(writes.length, 2);
});

test("rewriteSvgTitles turns a known page title into a Roam url and leaves unknown titles", () => {
  const svg = "<svg><text>See [[Alpha]] and [[Missing]]</text><g data-x=\"[[Alpha]]\"></g></svg>";
  const out = rewriteSvgTitles(svg, (title) => (title === "Alpha" ? "https://roamresearch.com/#/app/Readwisenotes/page/pgAlpha001" : null));
  assert.match(out, /<a href="https:\/\/roamresearch\.com\/#\/app\/Readwisenotes\/page\/pgAlpha001">Alpha<\/a>/);
  assert.match(out, /\[\[Missing\]\]/);
  assert.match(out, /data-x="\[\[Alpha\]\]"/);
});

function sceneApp(elements) {
  const app = {
    els: elements.map((el) => ({ ...el })),
    state: { scrollX: 11, scrollY: 22, zoom: { value: 1 }, width: 800, height: 600 },
    getSceneElements() { return this.els.filter((el) => el && !el.isDeleted); },
    getSceneElementsIncludingDeleted() { return this.els; },
    updateScene(update) {
      if (update.elements) this.els = update.elements;
      if (update.appState) {
        if (update.appState.scrollX != null) this.state.scrollX = update.appState.scrollX;
        if (update.appState.scrollY != null) this.state.scrollY = update.appState.scrollY;
        if (update.appState.zoom) this.state.zoom = update.appState.zoom;
      }
      this.updates.push(update);
    },
    updates: [],
  };
  return app;
}

function actionsFor({ elements, selected, editor = true, regions = () => [], blocks = {}, captureSvg, onWrite, upload, graph = "Readwisenotes" } = {}) {
  const app = sceneApp(elements);
  const classes = new Set();
  const outer = { classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); return on; } }, clientWidth: 800, clientHeight: 600 };
  const keys = [];
  let dialog = null;
  const doc = {
    createElement(tag) {
      const node = {
        tag, className: "", value: "", disabled: false, textContent: "", type: "", hidden: false, children: [], listeners: {}, style: {},
        append(...nodes) { this.children.push(...nodes); },
        addEventListener(type, fn) { this.listeners[type] = fn; },
        setAttribute() {},
        remove() {},
        close() { this.open = false; },
        showModal() { this.open = true; },
      };
      return node;
    },
    body: { append(node) { dialog = node; } },
    addEventListener(type, fn) { if (type === "keydown") keys.push(fn); },
    removeEventListener() {},
    defaultView: {},
  };
  const toasts = [];
  const blocksMade = [];
  let copied = null;
  const captured = [];
  const actions = createActions({
    host: {
      regionsOf: (uid) => regions(uid),
      pullBlock: (uid) => blocks[uid] ?? null,
      createBlock: async (block) => { blocksMade.push(block); return { uid: "newblock1" }; },
      graphName: () => graph,
      drawing: () => ({ uid: D, elements: app.els, hash: "abcd1234", appState: {} }),
    },
    native: {
      activeEditor: () => (editor ? { app, outer, drawingUid: D } : null),
      selectedElementIds: () => selected.slice(),
      captureSelectionSvg: async (live, ids) => { captured.push(ids); return captureSvg ?? null; },
      captureSelectionPng: async () => new Blob(["png"], { type: "image/png" }),
    },
    cache: { peek: () => null, get: async () => null, put: async () => {} },
    cold: {},
    toaster: { show: (message, opts) => toasts.push([message, opts?.kind]) },
    getSettings: () => ({}),
    doc,
    clipboard: { writeText: async (text) => { copied = text; } },
    api: {
      data: { pull: (_sel, eid) => (eid?.[1] === "Alpha" ? { ":block/uid": "pgAlpha001" } : null) },
      file: { upload: upload || (async () => { throw new Error("no upload"); }) },
    },
    guard: directGuard,
    upload: upload || null,
  });
  const clickExport = (className) => {
    const button = dialog?.children?.find((child) => child.className === className);
    button?.listeners?.click?.();
  };
  return { actions, app, keys, classes, toasts, blocksMade, captured, clickExport, readCopied: () => copied, wrote: onWrite };
}

test("presentLive pans with captureUpdate NEVER and Escape restores the entry view", () => {
  const f = frame("f");
  const { actions, app, keys, classes } = actionsFor({ elements: [f], selected: [] });
  assert.equal(actions.presentLive(), D);
  assert.equal(app.updates[0].captureUpdate, "NEVER");
  assert.equal("elements" in app.updates[0], false);
  assert.ok(classes.has("plexus-live"));
  assert.notEqual(app.state.scrollX, 11);
  keys[0]({ key: "Escape", preventDefault() {}, stopPropagation() {} });
  const last = app.updates.at(-1);
  assert.equal(last.captureUpdate, "NEVER");
  assert.equal("elements" in last, false);
  assert.equal(last.appState.scrollX, 11);
  assert.equal(last.appState.scrollY, 22);
  assert.deepEqual(last.appState.zoom, { value: 1 });
  assert.ok(!classes.has("plexus-live"));
});

test("setRevealStep stamps the next step, and clear removes it", () => {
  const f = frame("f");
  const rect = box("rectA", { frameId: "f" });
  const { actions, app, toasts } = actionsFor({ elements: [f, rect], selected: ["rectA"] });
  assert.equal(actions.setRevealStep(), true);
  const stepped = app.els.find((el) => el.id === "rectA");
  assert.equal(stepped.customData.plexus.step, 1);
  assert.equal(actions.clearRevealStep(), true);
  const cleared = app.els.find((el) => el.id === "rectA");
  assert.equal(cleared.customData?.plexus, undefined);
  assert.equal(toasts.length, 0);
  const loose = actionsFor({ elements: [box("free")], selected: ["free"] });
  assert.equal(loose.actions.setRevealStep(), false);
  assert.equal(loose.toasts.at(-1)[0], "Select elements inside a frame");
});

test("addOcclusion stamps the smallest region, and reveal capture omits those ids", async () => {
  const big = box("big", { x: 0, y: 0, width: 200, height: 160 });
  const cover = box("cover", { x: 20, y: 20, width: 30, height: 30 });
  const text = { id: "cap", type: "text", x: 22, y: 22, width: 10, height: 10, containerId: "cover", isDeleted: false, version: 1 };
  const region = { kind: "area", supported: true, drawingUid: D, ids: ["big", "cover", "cap"], pad: 0 };
  const uid = "regABCDEF";
  const { actions, app, captured } = actionsFor({
    elements: [big, cover, text],
    selected: ["cover"],
    regions: () => [{ uid, region }],
    blocks: { [uid]: { uid, string: serializeRegion({ kind: "area", drawingUid: D, ids: ["big", "cover", "cap"], pad: 0, caption: "" }) } },
    captureSvg: "<svg></svg>",
  });
  assert.equal(actions.addOcclusion(), uid);
  assert.equal(app.els.find((el) => el.id === "cover").customData.plexus.occlude, uid);
  const omitted = idsWithoutOccluders(["big", "cover", "cap"], app.els, uid);
  assert.deepEqual(omitted, ["big"]);
  await actions.revealRegion(uid);
  assert.deepEqual(captured.at(-1), ["big"]);
  assert.equal(patchPlexus(cover, { occlude: uid }).customData.plexus.occlude, uid);
});

test("export copies a rewritten svg and insert uploads a child image", async () => {
  const svg = "<svg><text>See [[Alpha]] and [[Missing]]</text></svg>";
  const copied = actionsFor({
    elements: [box("a")],
    selected: [],
    captureSvg: svg,
  });
  assert.equal(copied.actions.exportDrawing(), true);
  copied.clickExport("plexus-export-copy");
  await new Promise((resolve) => setTimeout(resolve, 10));
  const text = copied.readCopied();
  assert.match(text, /page\/pgAlpha001/);
  assert.match(text, /\[\[Missing\]\]/);
  assert.doesNotMatch(text, /\[\[Alpha\]\]/);

  const uploads = [];
  const inserted = actionsFor({
    elements: [box("a")],
    selected: ["a"],
    captureSvg: svg,
    upload: async (file) => { uploads.push(file.name); return "https://files.example/drawing.png"; },
  });
  inserted.actions.exportDrawing();
  inserted.clickExport("plexus-export-insert");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(uploads, ["drawing.png"]);
  assert.equal(inserted.blocksMade[0].parentUid, D);
  assert.equal(inserted.blocksMade[0].string, "![drawing](https://files.example/drawing.png)");
});
