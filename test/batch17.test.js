import assert from "node:assert/strict";
import test from "node:test";

import { createActions } from "../src/actions.js";
import { breadcrumbRows, inboxList, refreshTransclusions, threadRows, transcludePatch } from "../src/model/nesting.js";
import { plexusCanvasItems } from "../src/view/context-menus.js";
import { mountBreadcrumb, openThread, openTray } from "../src/view/tray.js";
import { selectedElementIds } from "../src/host/native.js";

const DRAWING = "{{[[excalidraw]]}}";

function node() {
  return {
    className: "",
    textContent: "",
    type: "",
    value: "",
    style: {},
    attrs: {},
    children: [],
    listeners: {},
    append(...kids) { this.children.push(...kids); },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    setAttribute(key, value) { this.attrs[key] = value; },
    replaceChildren() { this.children = []; },
    remove() { this.removed = true; },
  };
}

function fakeDoc() {
  const body = node();
  return {
    body,
    querySelectorAll: () => [],
    createElement() { return node(); },
  };
}

function appOf(elements) {
  const app = {
    state: {
      width: 800, height: 600, offsetLeft: 0, offsetTop: 0, scrollX: 0, scrollY: 0,
      zoom: { value: 1 }, selectedElementIds: {}, editingTextElement: null,
    },
    getSceneElements: () => elements.filter((el) => el && !el.isDeleted),
    getSceneElementsIncludingDeleted: () => elements,
    updateScene(update) {
      if (update.elements) elements.splice(0, elements.length, ...update.elements);
      app.captures.push(update.captureUpdate || "default");
    },
    captures: [],
  };
  return app;
}

function world() {
  const blocks = new Map();
  let seq = 0;
  const created = [];
  const opened = [];
  const toasts = [];
  const put = (uid, string, parent) => { blocks.set(uid, { uid, string, parent }); return uid; };
  put("page000001", "Maps", null);
  put("draw00001", DRAWING, "page000001");
  put("name00001", "Name:: Plant", "draw00001");
  const host = {
    blockInfo(uid) {
      const row = blocks.get(uid);
      if (!row || row.string === "Maps") return null;
      const parent = blocks.get(row.parent);
      const page = row.parent === "page000001" || parent?.parent == null;
      return {
        uid,
        string: row.string,
        parentUid: row.parent,
        parentIsPage: row.parent === "page000001",
        pageUid: "page000001",
        pageTitle: "Maps",
        parentString: parent?.string || "",
      };
    },
    pageTitleOf(uid) { return uid === "page000001" ? "Maps" : null; },
    pullBlock(uid) {
      const row = blocks.get(uid);
      if (!row) return null;
      const children = [...blocks.values()].filter((child) => child.parent === uid);
      return { uid, string: row.string, children: children.map((child) => ({ uid: child.uid, string: child.string, order: 0 })) };
    },
    createBlock: async ({ parentUid, string }) => {
      const uid = `made${seq++}`;
      put(uid, string, parentUid);
      created.push({ uid, parentUid, string });
      return uid;
    },
    createDrawing: async ({ parentUid }) => {
      const uid = `nest${seq++}`;
      put(uid, DRAWING, parentUid);
      created.push({ uid, parentUid, string: DRAWING });
      return { uid };
    },
    openBlock: async (uid) => { opened.push(uid); },
    blockPaths(uids) {
      return new Map((uids || []).map((uid) => [uid, { orders: [0], ancestors: [] }]));
    },
    labelSource(uid) { return { string: blocks.get(uid)?.string || "" }; },
    pageUidByTitle() { return null; },
  };
  return { blocks, put, created, opened, toasts, host };
}

function walk(node, out = []) {
  out.push(node);
  for (const child of node?.children || []) walk(child, out);
  return out;
}

function actionsFor(world, elements, doc = fakeDoc()) {
  const app = appOf(elements);
  let editor = { app, drawingUid: "draw00001" };
  const actions = createActions({
    host: world.host,
    native: { activeEditor: () => editor, selectedElementIds },
    toaster: { show: (message) => world.toasts.push(message) },
    doc,
    clipboard: {},
    api: {},
  });
  return {
    actions,
    app,
    setEditor(next) { editor = next; },
    select(id) { app.state.selectedElementIds = id ? { [id]: true } : {}; },
  };
}

test("breadcrumb walks the page and named drawings, and stops on an ordinary block", () => {
  const read = (uid) => ({
    drawchild: { string: DRAWING, parentUid: "draw00001", name: "Detail" },
    draw00001: { string: DRAWING, parentUid: "page000001", name: "Plant" },
    page000001: { isPage: true, title: "Maps" },
    loose0001: { string: "A note", parentUid: "page000001" },
  })[uid];
  assert.deepEqual(breadcrumbRows("drawchild", read), [
    { uid: "page000001", label: "Maps", page: true, drawing: false },
    { uid: "draw00001", label: "Plant", page: false, drawing: true },
    { uid: "drawchild", label: "Detail", page: false, drawing: true },
  ]);
  assert.deepEqual(breadcrumbRows("loose0001", read).map((row) => row.label), ["A note"]);
  assert.deepEqual(breadcrumbRows("missing01", () => null), []);
});

test("inbox skips placed blocks, names, mermaid, and region containers, and caps at twenty-four", () => {
  const kids = [
    { uid: "name00001", string: "Name:: Plant" },
    { uid: "merma0001", string: "{{[[mermaid]]}}" },
    { uid: "cards0001", string: "{{[[plexus-cards]]}}" },
    { uid: "regs00001", string: "{{[[plexus-regions]]}}" },
    { uid: "placed001", string: "On the canvas" },
    { uid: "note00001", string: "Loose note" },
    { uid: "drawchild", string: DRAWING, name: "Detail" },
    { uid: "empty0001", string: "" },
  ];
  const elements = [
    { id: "a", type: "rectangle", isDeleted: false, customData: { plexus: { embed: "((placed001))" } } },
  ];
  const list = inboxList(kids, elements);
  assert.deepEqual(list.rows.map((row) => row.label), ["Loose note", "Detail", "(empty)"]);
  const many = Array.from({ length: 25 }, (_, i) => ({ uid: `u${String(i).padStart(8, "0")}`, string: `Row ${i}` }));
  const capped = inboxList(many, []);
  assert.equal(capped.rows.length, 24);
  assert.equal(capped.total, 25);
});

test("transclude copies the block words onto the element and leaves a missing block alone", () => {
  const el = { id: "t", type: "text", text: "((block0001))", originalText: "((block0001))", version: 1 };
  const patch = transcludePatch(el, "The source line");
  assert.equal(patch.text, "The source line");
  assert.equal(patch.customData.plexus.transclude, "block0001");
  assert.equal(transcludePatch(patch, "The source line"), null);
  const bound = { ...el, containerId: "box" };
  assert.equal(transcludePatch(bound, "The source line"), null);
  const elements = [el, { id: "gone", type: "text", text: "((missing01))", originalText: "((missing01))" }];
  const next = refreshTransclusions(elements, (uid) => (uid === "block0001" ? "The source line" : null));
  assert.equal(next[0].text, "The source line");
  assert.equal(next[1].text, "((missing01))");
  assert.equal(refreshTransclusions(next, (uid) => (uid === "block0001" ? "The source line" : null)), null);
});

test("a comment thread is the block's children, capped at twenty", () => {
  const children = Array.from({ length: 21 }, (_, i) => ({ uid: `r${i}`, string: `Reply ${i}` }));
  const thread = threadRows({ uid: "c00000001", string: "First", children });
  assert.equal(thread.text, "First");
  assert.equal(thread.replies.length, 20);
  assert.equal(thread.total, 21);
});

test("nest drawing creates a child of the open drawing and opens it", async () => {
  const graph = world();
  const harness = actionsFor(graph, []);
  graph.host.openBlock = async (uid) => {
    graph.opened.push(uid);
    harness.setEditor({ app: harness.app, drawingUid: uid });
  };
  const uid = await harness.actions.nestDrawing();
  assert.equal(graph.created[0].parentUid, "draw00001");
  assert.equal(graph.created[0].string, DRAWING);
  assert.equal(uid, graph.created[0].uid);
  assert.deepEqual(graph.opened, [uid]);
  assert.equal(graph.toasts.includes("Nested drawing"), true);
});

test("the open drawing's breadcrumb uses the Name child", () => {
  const graph = world();
  const harness = actionsFor(graph, []);
  assert.deepEqual(harness.actions.breadcrumb("draw00001"), [
    { uid: "page000001", label: "Maps", page: true, drawing: false },
    { uid: "draw00001", label: "Plant", page: false, drawing: true },
  ]);
});

test("inbox lists an unplaced child and a chosen row embeds it", async () => {
  const graph = world();
  graph.put("note00001", "Loose note", "draw00001");
  graph.put("placed001", "On the canvas", "draw00001");
  const elements = [{ id: "a", type: "rectangle", isDeleted: false, customData: { plexus: { embed: "((placed001))" } } }];
  const doc = fakeDoc();
  const harness = actionsFor(graph, elements, doc);
  const uids = await harness.actions.openInbox();
  assert.deepEqual(uids, ["note00001"]);
  const button = [...walk(doc.body)].find((child) => child.attrs["data-uid"] === "note00001");
  button.listeners.click[0]({ preventDefault() {}, stopPropagation() {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const embed = elements.find((el) => el.customData?.plexus?.embed === "((note00001))");
  assert.equal(embed.type, "rectangle");
  assert.equal(graph.created.length, 0);
});

test("transclude writes the element and does not write the block", async () => {
  const graph = world();
  graph.put("block0001", "The source line", "page000001");
  const elements = [{ id: "t", type: "text", text: "((block0001))", originalText: "((block0001))", version: 1, isDeleted: false }];
  const harness = actionsFor(graph, elements);
  harness.select("t");
  assert.equal(await harness.actions.transcludeBlock(), "block0001");
  assert.equal(elements[0].text, "The source line");
  assert.equal(elements[0].customData.plexus.transclude, "block0001");
  assert.equal(harness.app.captures[0], "IMMEDIATELY");
  assert.equal(graph.created.length, 0);
  assert.equal(graph.blocks.get("block0001").string, "The source line");
  harness.app.state.editingTextElement = { id: "t" };
  elements[0].text = "local edit";
  elements[0].originalText = "local edit";
  assert.equal(harness.actions.refreshTransclusions(), 0);
  assert.equal(elements[0].text, "local edit");
  harness.app.state.editingTextElement = null;
  assert.equal(harness.actions.refreshTransclusions(), 1);
  assert.equal(elements[0].text, "The source line");
  assert.equal(harness.app.captures.at(-1), "NEVER");
});

test("comment pin stores a child block and a reply adds a child without touching the scene", async () => {
  const graph = world();
  const elements = [{
    id: "emb", type: "rectangle", isDeleted: false,
    customData: { plexus: { embed: "((src000001))" } },
  }];
  graph.put("src000001", "Source", "page000001");
  const harness = actionsFor(graph, elements);
  harness.select("emb");
  const before = elements.length;
  const uid = await harness.actions.commentPin("Check this");
  assert.equal(graph.created[0].parentUid, "src000001");
  assert.equal(graph.created[0].string, "Check this");
  const pin = elements.find((el) => el.customData?.plexus?.comment === uid);
  assert.equal(pin.type, "text");
  assert.equal(pin.originalText, "Check this");
  const reply = await harness.actions.commentReply(uid, "Second");
  assert.equal(graph.blocks.get(reply).parent, uid);
  assert.equal(graph.blocks.get(reply).string, "Second");
  assert.equal(elements.length, before + 1);
  const thread = harness.actions.openCommentThread(uid);
  assert.equal(thread.text, "Check this");
  assert.deepEqual(thread.replies.map((row) => row.text), ["Second"]);
});

test("canvas items open transclusion and the comment thread only for the matching selection", () => {
  const calls = [];
  const text = { id: "t", type: "text", isDeleted: false, text: "((block0001))", originalText: "((block0001))" };
  const pin = { id: "p", type: "text", isDeleted: false, text: "Check", originalText: "Check", customData: { plexus: { comment: "c00000001" } } };
  const actions = {
    transcludeBlock: () => calls.push("transclude"),
    openCommentThread: (uid) => calls.push(["thread", uid]),
  };
  const appFor = (el) => ({
    state: { selectedElementIds: { [el.id]: true } },
    getSceneElements: () => [el],
  });
  const textItems = plexusCanvasItems({
    app: appFor(text), native: { selectedElementIds }, actions, openSettings() {}, drawingUid: "draw00001", mac: false,
  });
  assert.equal(textItems.find((item) => item.id === "transclude").enabled, true);
  assert.equal(textItems.find((item) => item.id === "comment-thread").enabled, false);
  textItems.find((item) => item.id === "transclude").run();
  const pinItems = plexusCanvasItems({
    app: appFor(pin), native: { selectedElementIds }, actions, openSettings() {}, drawingUid: "draw00001", mac: false,
  });
  assert.equal(pinItems.find((item) => item.id === "comment-thread").enabled, true);
  pinItems.find((item) => item.id === "comment-thread").run();
  assert.deepEqual(calls, ["transclude", ["thread", "c00000001"]]);
});

test("a crumb and a tray row call back, and a reply redraws the thread", async () => {
  const doc = fakeDoc();
  const opened = [];
  const bar = mountBreadcrumb({
    doc,
    rows: [
      { uid: "page000001", label: "Maps", page: true },
      { uid: "draw00001", label: "Plant", drawing: true },
    ],
    onOpen: (row) => opened.push(row.uid),
  });
  const buttons = walk(bar.root).filter((child) => child.listeners.click);
  assert.equal(buttons.length, 1);
  buttons[0].listeners.click[0]({ preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(opened, ["page000001"]);
  const picked = [];
  openTray({ doc, rows: [{ uid: "note00001", label: "Loose note" }], onPick: (uid) => picked.push(uid) });
  const trayButton = walk(doc.body).find((child) => child.attrs["data-uid"] === "note00001");
  trayButton.listeners.click[0]({ preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(picked, ["note00001"]);
  let replies = [];
  const thread = openThread({
    doc,
    thread: { text: "Check this", replies: [] },
    onReply: async (text) => {
      replies = [...replies, { uid: "r1", text }];
      return { text: "Check this", replies };
    },
  });
  const input = thread.root.children.find((child) => child.className === "plexus-name-input");
  input.value = "Second";
  const reply = thread.root.children.find((child) => child.textContent === "Reply");
  reply.listeners.click[0]({ preventDefault() {}, stopPropagation() {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const lines = thread.root.children.find((child) => child.className === "rm-autocomplete__results-scroll");
  assert.equal(lines.children.some((child) => child.textContent === "Second"), true);
});
