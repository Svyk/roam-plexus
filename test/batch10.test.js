import assert from "node:assert/strict";
import test from "node:test";

import { createActions } from "../src/actions.js";
import { holdMinimizeClose } from "../src/extension.js";
import { insertElements } from "../src/host/native.js";
import {
  EXPORT_MARK,
  LINKS_MARK,
  appendTagText,
  collectTargets,
  elementsToAdd,
  exportPlan,
  linkPlan,
  parseSceneDocument,
  sceneDocument,
  tagToken,
  taggedElementIds,
} from "../src/model/carry.js";

const text = (id, value, extra = {}) => ({
  id, type: "text", x: 0, y: 0, width: 20, height: 10, isDeleted: false, originalText: value, text: value, ...extra,
});

test("scene document keeps elements and a short appState list", () => {
  const doc = sceneDocument({
    elements: [{ id: "a", type: "rectangle", isDeleted: false }, { id: "gone", type: "rectangle", isDeleted: true }],
    appState: { viewBackgroundColor: "#fff", gridSize: 20, scrollX: 40, zoom: { value: 2 } },
    files: { img: { id: "img" } },
  });
  assert.equal(doc.type, "excalidraw");
  assert.equal(doc.version, 2);
  assert.equal(doc.source, "roam-plexus");
  assert.deepEqual(doc.elements.map((el) => el.id), ["a"]);
  assert.deepEqual(doc.appState, { viewBackgroundColor: "#fff", gridSize: 20 });
  assert.deepEqual(doc.files, { img: { id: "img" } });
  assert.equal(parseSceneDocument(JSON.stringify(doc))?.type, "excalidraw");
  assert.equal(parseSceneDocument("{"), null);
  assert.equal(parseSceneDocument({ type: "other", elements: [] }), null);
});

test("import drops image elements", () => {
  const kept = elementsToAdd([
    { id: "a", type: "rectangle", isDeleted: false },
    { id: "b", type: "image", isDeleted: false },
    { id: "c", type: "text", isDeleted: true },
  ]);
  assert.deepEqual(kept.map((el) => el.id), ["a"]);
});

test("tag text is appended once and only text elements match", () => {
  assert.equal(appendTagText("Hello", "Plant"), "Hello #[[Plant]]");
  assert.equal(appendTagText("Hello #[[Plant]]", "Plant"), "Hello #[[Plant]]");
  assert.equal(appendTagText("", "  "), "");
  assert.equal(tagToken("Plant"), "#[[Plant]]");
  const ids = taggedElementIds([
    text("t", "Hello #[[Plant]]"),
    text("u", "Other"),
    { id: "r", type: "rectangle", isDeleted: false, text: "#[[Plant]]" },
  ], "Plant");
  assert.deepEqual(ids, ["t"]);
});

test("link plan creates, skips an equal set, updates, and deletes when empty", () => {
  const elements = [
    { id: "e", type: "rectangle", isDeleted: false, customData: { plexus: { embed: "((blk000001))" } } },
    text("t", "See [[Plant]] and ((blk000002))"),
    { id: "gone", type: "text", isDeleted: true, originalText: "[[Hidden]]" },
  ];
  const targets = collectTargets({
    elements,
    regions: [{ uid: "reg000001", string: "{{[[plexus]]}} [[Cited]]" }],
    drawingUid: "drw000001",
  });
  assert.deepEqual(targets, ["((blk000001))", "[[Plant]]", "((blk000002))", "((reg000001))", "[[Cited]]"]);
  assert.deepEqual(linkPlan({ children: [], targets }), { action: "create", refs: targets });
  const same = linkPlan({
    children: [{ uid: "mark", string: LINKS_MARK }],
    markChildren: targets.map((string, i) => ({ uid: `c${i}`, string })),
    targets,
  });
  assert.equal(same.action, "none");
  const changed = linkPlan({
    children: [{ uid: "mark", string: LINKS_MARK }],
    markChildren: [{ uid: "old", string: "((other000))" }],
    targets,
  });
  assert.equal(changed.action, "update");
  assert.equal(changed.markUid, "mark");
  assert.deepEqual(linkPlan({ children: [{ uid: "mark", string: LINKS_MARK }], targets: [] }), { action: "delete", markUid: "mark" });
  assert.deepEqual(linkPlan({ children: [], targets: [] }), { action: "none" });
});

test("export plan skips a matching hash and names the image to replace", () => {
  assert.deepEqual(exportPlan({ children: [], hash: "abc" }), { action: "skip" });
  const children = [{ uid: "mark", string: EXPORT_MARK }];
  const held = exportPlan({
    children,
    markChildren: [
      { uid: "img", string: "![drawing](https://files.example/old.png)" },
      { uid: "hash", string: "`abc`" },
    ],
    hash: "abc",
  });
  assert.equal(held.action, "skip");
  const next = exportPlan({
    children,
    markChildren: [
      { uid: "img", string: "![drawing](https://files.example/old.png)" },
      { uid: "hash", string: "`abc`" },
    ],
    hash: "def",
  });
  assert.equal(next.action, "update");
  assert.equal(next.imageUid, "img");
  assert.equal(next.hashUid, "hash");
  assert.equal(next.oldUrl, "https://files.example/old.png");
  assert.equal(next.hash, "def");
});

const DRAWING = "draw00001";
const MACRO = "{{[[excalidraw]]}}";

function graph(seed = []) {
  let n = 0;
  const blocks = new Map();
  const put = (uid, string, parentUid, order) => {
    const rec = { uid, string, order: typeof order === "number" ? order : 0, children: [] };
    blocks.set(uid, rec);
    const parent = parentUid ? blocks.get(parentUid) : null;
    if (parent) {
      parent.children.push(rec);
      parent.children.sort((a, b) => a.order - b.order);
    }
    return rec;
  };
  put(DRAWING, MACRO, null, 0);
  for (const row of seed) put(row.uid, row.string, row.parent ?? DRAWING, row.order);
  const pull = (uid) => {
    const rec = blocks.get(uid);
    if (!rec) return null;
    return { uid: rec.uid, string: rec.string, children: rec.children.map((c) => ({ uid: c.uid, string: c.string })) };
  };
  const updates = [];
  const deleted = [];
  const regions = [{ uid: "reg000001", string: "{{[[plexus-region]]:k=area}} [[Cited]]" }];
  return {
    blocks,
    updates,
    deleted,
    regions,
    pull,
    host: {
      pullBlock: pull,
      createBlock: async ({ parentUid, order, string, open }) => {
        n += 1;
        const rec = put(`made${n}`, string, parentUid, order);
        rec.open = open;
        return `made${n}`;
      },
      deleteBlock: async (uid) => {
        const rec = blocks.get(uid);
        if (!rec) return false;
        for (const child of [...rec.children]) await thisDelete(child.uid);
        for (const parent of blocks.values()) parent.children = parent.children.filter((c) => c.uid !== uid);
        blocks.delete(uid);
        return true;
      },
      drawing: () => ({ elements: [], appState: { viewBackgroundColor: "#111", scrollX: 9 }, hash: "stored" }),
      regionsOf: () => regions,
      graphName: () => "notes",
      blockInfo: (uid) => ({ uid, string: "hello", order: 2, parentUid: "page00001", parentString: "", pageUid: "page00001" }),
      pageUidByTitle: () => null,
    },
    api: {
      data: {
        block: {
          update: async ({ block }) => {
            if (block.uid === DRAWING) throw new Error("drawing string write");
            updates.push(block);
            const rec = blocks.get(block.uid);
            if (rec) rec.string = block.string;
          },
        },
      },
      file: { delete: async (arg) => { deleted.push(arg); } },
      util: { dateToPageTitle: () => "October 1st, 2026" },
    },
  };
  function thisDelete(uid) {
    const rec = blocks.get(uid);
    if (!rec) return;
    for (const child of [...rec.children]) thisDelete(child.uid);
    for (const parent of blocks.values()) parent.children = parent.children.filter((c) => c.uid !== uid);
    blocks.delete(uid);
  }
}

function appOf(elements, { theme = "light", files = {} } = {}) {
  const app = {
    state: { theme, editingTextElement: null },
    files,
    getSceneElements: () => elements.filter((el) => el && !el.isDeleted),
    getSceneElementsIncludingDeleted: () => elements,
    updateScene(update) {
      if (update.elements) {
        elements.splice(0, elements.length, ...update.elements);
      }
    },
  };
  return app;
}

test("export scene downloads one JSON file and does not write the drawing", async () => {
  const g = graph();
  const rect = { id: "rect1", type: "rectangle", isDeleted: false, version: 1 };
  const gone = { id: "gone", type: "text", isDeleted: true, text: "no" };
  const elements = [rect, gone];
  const app = appOf(elements, { files: { img: { id: "img" } }, theme: "dark" });
  app.state.viewBackgroundColor = "#abc";
  app.state.gridSize = 20;
  app.state.scrollX = 40;
  let blob = null;
  const actions = createActions({
    host: g.host,
    native: { activeEditor: () => ({ app, drawingUid: DRAWING }), selectedElementIds: () => [] },
    toaster: { show() {} },
    doc: { createElement: () => ({ click() {}, remove() {} }), body: { append() {} } },
    clipboard: {},
    api: g.api,
    urls: { createObjectURL: (value) => { blob = value; return "blob:scene"; }, revokeObjectURL() {} },
  });
  assert.equal(await actions.exportScene(DRAWING), DRAWING);
  const saved = JSON.parse(await blob.text());
  assert.equal(saved.type, "excalidraw");
  assert.equal(saved.source, "roam-plexus");
  assert.deepEqual(saved.elements.map((el) => el.id), ["rect1"]);
  assert.deepEqual(saved.appState, { viewBackgroundColor: "#abc", gridSize: 20 });
  assert.deepEqual(saved.files, { img: { id: "img" } });
  assert.equal(g.updates.length, 0);
  assert.equal(elements.length, 2);
});

test("import refuses a bad file and images, and adds the rest through the open drawing", { timeout: 4000 }, async () => {
  const created = [];
  let editor = null;
  let parentString = "hello";
  let payload = "";
  const app = appOf([]);
  const toasts = [];
  const base = graph();
  const scene = JSON.stringify({
    type: "excalidraw",
    version: 2,
    elements: [
      { id: "rect1", type: "rectangle", isDeleted: false },
      { id: "img1", type: "image", isDeleted: false },
    ],
  });
  const actions = createActions({
    host: {
      ...base.host,
      pullBlock: (uid) => (uid === "parent01" ? { uid, string: parentString, children: [] } : base.pull(uid)),
      createDrawing: async ({ parentUid, order, title }) => {
        created.push({ parentUid, order, title });
        editor = { app, drawingUid: "newdraw01" };
        return { uid: "newdraw01" };
      },
      openBlock: async () => { throw new Error("should already be open"); },
    },
    native: {
      activeEditor: () => editor,
      selectedElementIds: () => [],
      insertElements,
    },
    toaster: { show: (message) => toasts.push(message) },
    getSettings: () => ({}),
    doc: {
      createElement(tag) {
        if (tag === "input") {
          return {
            files: [{ text: async () => payload }],
            addEventListener(type, fn) { if (type === "change") this.onChange = fn; },
            click() { return this.onChange?.(); },
            remove() {},
          };
        }
        return { click() {}, remove() {} };
      },
      body: { append() {} },
      querySelectorAll: () => [{ id: "block-input-newdraw01", closest: () => null, querySelector: () => ({ isConnected: true }) }],
    },
    clipboard: {},
    api: base.api,
    withLockFn: async (_name, fn) => ({ acquired: true, value: await fn() }),
  });

  payload = "{";
  assert.equal(await actions.importScene("parent01"), null);
  assert.ok(toasts.includes("That file is not a scene"));
  assert.equal(created.length, 0);

  payload = JSON.stringify({ type: "excalidraw", version: 2, elements: [{ id: "img1", type: "image", isDeleted: false }] });
  assert.equal(await actions.importScene("parent01"), null);
  assert.ok(toasts.includes("Images are not imported"));
  assert.equal(created.length, 0);

  editor = { app, drawingUid: DRAWING };
  payload = scene;
  assert.equal(await actions.importScene("parent01"), null);
  assert.ok(toasts.includes("Close the open drawing first"));
  assert.equal(created.length, 0);

  editor = null;
  assert.equal(await actions.importScene("parent01"), "newdraw01");
  assert.deepEqual(created, [{ parentUid: "page00001", order: 3, title: undefined }]);
  assert.deepEqual(app.getSceneElements().map((el) => el.id), ["rect1"]);
  assert.equal(app.getSceneElements().some((el) => el.type === "image"), false);

  editor = null;
  parentString = MACRO;
  app.getSceneElementsIncludingDeleted().splice(0);
  assert.equal(await actions.importScene("parent01"), "newdraw01");
  assert.equal(created[1].parentUid, undefined);
  assert.match(created[1].title, /^Drawing /);
});

test("tag writes the page ref onto selected text and adds one child ref", async () => {
  const g = graph();
  const text = { id: "t1", type: "text", isDeleted: false, text: "Hello", originalText: "Hello", version: 3 };
  const rect = { id: "r1", type: "rectangle", isDeleted: false, version: 1 };
  const elements = [text, rect];
  const app = appOf(elements);
  let selected = ["t1", "r1"];
  const toasts = [];
  const actions = createActions({
    host: g.host,
    native: { activeEditor: () => ({ app, drawingUid: DRAWING }), selectedElementIds: () => selected },
    toaster: { show: (message) => toasts.push(message) },
    doc: {},
    clipboard: {},
    api: g.api,
    openPrompt: async () => "Alpha",
  });
  app.state.editingTextElement = { id: "t1" };
  assert.equal(await actions.tagElements(), null);
  assert.equal(text.originalText, "Hello");
  assert.equal(g.blocks.get(DRAWING).children.length, 0);

  app.state.editingTextElement = null;
  app.state.cursorButton = "down";
  assert.equal(await actions.tagElements(), "#[[Alpha]]");
  app.state.cursorButton = "up";
  const tagged = app.getSceneElements().find((el) => el.id === "t1");
  assert.equal(tagged.originalText, "Hello #[[Alpha]]");
  assert.equal(tagged.text, "Hello #[[Alpha]]");
  assert.equal(tagged.version, 4);
  assert.equal(rect.version, 1);
  const child = g.pull(DRAWING).children.find((c) => c.string === "#[[Alpha]]");
  assert.ok(child);
  assert.equal(await actions.tagElements(), "#[[Alpha]]");
  assert.equal(g.pull(DRAWING).children.filter((c) => c.string.includes("#[[Alpha]]")).length, 1);
  assert.equal(app.getSceneElements().find((el) => el.id === "t1").originalText, "Hello #[[Alpha]]");
  assert.ok(toasts.includes("Tag added"));
  assert.equal(g.updates.length, 0);
  selected = [];
});

test("close keeps one export image and rewrites linked refs only when they change", async () => {
  const g = graph();
  const text = { id: "t1", type: "text", isDeleted: false, originalText: "See [[Plant]]", text: "See [[Plant]]", link: "((blk000002))" };
  const embed = { id: "e1", type: "rectangle", isDeleted: false, customData: { plexus: { embed: "((blk000001))" } } };
  const elements = [text, embed];
  const app = appOf(elements, { theme: "dark" });
  const captures = [];
  let hrefs = ["https://files.example/one.png", "https://files.example/two.png", "https://files.example/three.png"];
  const toasts = [];
  const actions = createActions({
    host: g.host,
    native: {
      activeEditor: () => ({ app, drawingUid: DRAWING }),
      selectedElementIds: () => [],
      captureSelectionPng: async (_app, ids, opts) => {
        captures.push({ ids, opts });
        return new Blob(["png"], { type: "image/png" });
      },
    },
    toaster: { show: (message) => toasts.push(message) },
    doc: {},
    clipboard: { write() {} },
    api: g.api,
    upload: async () => `![drawing](${hrefs.shift()})`,
  });

  await actions.syncOnClose(app, DRAWING);
  assert.equal(captures.length, 0);
  assert.equal(g.pull(DRAWING).children.some((c) => c.string === LINKS_MARK), false);

  assert.equal(await actions.keepLinkedReferences(DRAWING), DRAWING);
  const mark = g.pull(DRAWING).children.find((c) => c.string === LINKS_MARK);
  assert.equal(g.blocks.get(mark.uid).open, false);
  assert.deepEqual(g.pull(mark.uid).children.map((c) => c.string), ["[[Plant]]", "((blk000002))", "((blk000001))", "((reg000001))", "[[Cited]]"]);
  const before = g.pull(DRAWING).children.length;
  await actions.syncOnClose(app, DRAWING);
  assert.equal(g.pull(DRAWING).children.length, before);

  g.regions.length = 0;
  elements.splice(0, elements.length, { id: "t1", type: "rectangle", isDeleted: false });
  await actions.syncOnClose(app, DRAWING);
  assert.equal(g.blocks.has(mark.uid), false);
  assert.equal(toasts.includes("Nothing to list"), false);

  assert.equal(await actions.keepExportImage(), DRAWING);
  assert.equal(captures.length, 1);
  assert.equal(captures[0].opts.scale, 2);
  assert.equal(captures[0].opts.dark, true);
  assert.deepEqual(captures[0].ids, ["t1"]);
  const exportMark = g.pull(DRAWING).children.find((c) => c.string === EXPORT_MARK);
  assert.equal(g.blocks.get(exportMark.uid).open, false);
  const image = g.pull(exportMark.uid).children.find((c) => c.string.startsWith("!["));
  assert.equal(image.string, "![drawing](https://files.example/one.png)");
  assert.equal(g.deleted.length, 0);
  const firstHash = g.pull(exportMark.uid).children.find((c) => c.string.startsWith("`")).string;

  await actions.syncOnClose(app, DRAWING);
  assert.equal(captures.length, 1);
  assert.equal(g.pull(exportMark.uid).children.find((c) => c.string.startsWith("`")).string, firstHash);

  elements[0] = { ...elements[0], version: 2 };
  await actions.syncOnClose(app, DRAWING);
  assert.equal(captures.length, 2);
  assert.equal(g.pull(exportMark.uid).children.find((c) => c.string.startsWith("![")).string, "![drawing](https://files.example/two.png)");
  assert.deepEqual(g.deleted, [{ url: "https://files.example/one.png" }]);
  assert.equal(g.updates.some((block) => block.uid === DRAWING), false);
  assert.equal(g.blocks.get(DRAWING).string, MACRO);

  const kept = [{ id: "t9", type: "rectangle", isDeleted: false, version: 9 }];
  app.getSceneElements = () => [];
  app.scene = { getNonDeletedElements: () => kept };
  await actions.syncOnClose(app, DRAWING);
  assert.equal(captures.length, 3);
  assert.deepEqual(captures[2].ids, ["t9"]);
  assert.equal(g.pull(exportMark.uid).children.find((c) => c.string.startsWith("![")).string, "![drawing](https://files.example/three.png)");

  app.scene = { getNonDeletedElements: () => [] };
  const toasted = toasts.length;
  const caps = captures.length;
  await actions.syncOnClose(app, DRAWING);
  assert.equal(captures.length, caps);
  assert.equal(toasts.length, toasted);
});

test("minimize syncs while the scene is still on screen, then the click closes", async () => {
  const listeners = [];
  const outer = {
    className: "full-screen",
    isConnected: true,
    classList: { contains: (name) => name === "full-screen" && outer.className.includes("full-screen") },
    contains: (node) => node === hit || node === outer,
    addEventListener(type, fn, capture) { listeners.push({ type, fn, capture }); },
    removeEventListener(type, fn) {
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
  };
  const hit = {
    className: "bp3-icon-minimize",
    closest: (sel) => (sel === ".bp3-icon-minimize" ? hit : null),
    click() { clicks += 1; deliver("click"); },
  };
  let clicks = 0;
  let seen = null;
  let scene = [150];
  const deliver = (type) => {
    const event = {
      type,
      target: hit,
      pointerId: 1,
      prevented: 0,
      stopped: 0,
      preventDefault() { this.prevented += 1; },
      stopPropagation() { this.stopped += 1; },
    };
    for (const listener of listeners.filter((l) => l.type === type && l.capture)) listener.fn(event);
    return event;
  };
  const release = holdMinimizeClose({
    outer,
    sync: async () => { seen = scene.slice(); },
  });
  const down = deliver("pointerdown");
  const click = deliver("click");
  assert.equal(down.prevented, 1);
  assert.equal(down.stopped, 1);
  assert.equal(click.prevented, 1);
  assert.equal(click.stopped, 1);
  assert.equal(clicks, 0);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(seen, [150]);
  assert.equal(clicks, 1);
  scene = [];
  const up = deliver("mouseup");
  assert.equal(up.prevented, 1);
  assert.equal(clicks, 1);
  assert.deepEqual(seen, [150]);
  outer.className = "";
  const again = deliver("pointerdown");
  assert.equal(again.prevented, 1);
  assert.equal(clicks, 1);
  assert.deepEqual(seen, [150]);
  release();
  assert.equal(listeners.length, 0);
});
