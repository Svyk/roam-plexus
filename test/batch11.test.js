import assert from "node:assert/strict";
import test from "node:test";

import { createActions } from "../src/actions.js";
import { drawingName, namePlan } from "../src/model/drawing-name.js";
import { fitSize, filterInsertRows, placedImage, reuseFileId, stageReusedFile } from "../src/model/image-insert.js";
import { blockRef, dropElement, imageMarkdown, pageRef, splitTitleBody, turnBackToText, turnIntoEmbed, turnIntoLink } from "../src/model/turninto.js";
import { plexusCanvasItems } from "../src/view/context-menus.js";

const DRAW = "drw000001";
const URL = "https://example.test/a.png";

function textEl(extra = {}) {
  return {
    id: "txt000001", type: "text", x: 10, y: 20, width: 120, height: 48,
    text: "Plant\nA leaf", originalText: "Plant\nA leaf", isDeleted: false, version: 1,
    customData: { firebaseUrl: URL },
    ...extra,
  };
}

function arrowTo(id) {
  return {
    id: "arr000001", type: "arrow", x: 0, y: 0, width: 30, height: 10,
    isDeleted: false, version: 1,
    startBinding: { elementId: id, focus: 0, gap: 4 },
    endBinding: null,
  };
}

test("title, refs, and image markdown reject a broken address", () => {
  assert.deepEqual(splitTitleBody("Plant\r\nA leaf"), { title: "Plant", body: "A leaf" });
  assert.equal(splitTitleBody("[[Plant]] #x").title, "Plant x");
  assert.equal(pageRef("Plant"), "[[Plant]]");
  assert.equal(pageRef("A [b]"), null);
  assert.equal(blockRef("blk000001"), "((blk000001))");
  assert.equal(blockRef("short"), null);
  assert.equal(imageMarkdown(URL), `![image](${URL})`);
  assert.equal(imageMarkdown("https://example.test/a b.png"), null);
  assert.equal(imageMarkdown("https://example.test/a).png"), null);
});

test("an embed keeps the box data, follows arrows, and leaves the input alone", () => {
  const text = textEl();
  const arrow = arrowTo(text.id);
  const input = [text, arrow];
  const before = structuredClone(input);
  const out = turnIntoEmbed(input, text.id, { ref: "[[Plant]]", label: "Plant" });
  assert.deepEqual(input, before);
  const rect = out.find((el) => el.customData?.plexus?.embed === "[[Plant]]");
  const moved = out.find((el) => el.id === arrow.id);
  assert.equal(rect.customData.firebaseUrl, URL);
  assert.equal(moved.startBinding.elementId, rect.id);
  assert.ok(out.find((el) => el.id === text.id).isDeleted);
  assert.notEqual(rect.id, text.id);
});

test("a link keeps the element id and turn-back restores the text", () => {
  const text = textEl();
  const linked = turnIntoLink([text, arrowTo(text.id)], text.id, "[[Plant]]");
  assert.equal(linked.find((el) => el.id === text.id).link, "[[Plant]]");
  const rect = { id: "emb000001", type: "rectangle", x: 4, y: 6, width: 80, height: 40, isDeleted: false, version: 1, customData: { plexus: { embed: "((blk000001))" } } };
  const back = turnBackToText([rect, arrowTo(rect.id)], rect.id, "Plant\nA leaf");
  const made = back.find((el) => el.type === "text" && !el.isDeleted);
  assert.equal(made.originalText, "Plant\nA leaf");
  assert.equal(back.find((el) => el.id === "arr000001").startBinding.elementId, made.id);
  assert.ok(back.find((el) => el.id === rect.id).isDeleted);
});

test("dropping an image clears the arrow that pointed at it", () => {
  const image = { id: "img000001", type: "image", x: 0, y: 0, width: 10, height: 10, isDeleted: false, version: 1 };
  const out = dropElement([image, arrowTo(image.id)], image.id);
  assert.equal(out.find((el) => el.id === image.id).isDeleted, true);
  assert.equal(out.find((el) => el.id === "arr000001").startBinding, null);
});

test("a name plan writes one child and never a props map", () => {
  const kids = [{ uid: "name00001", string: "Name:: Old" }];
  assert.deepEqual(namePlan(kids, ""), { action: "delete", uid: "name00001" });
  assert.deepEqual(namePlan(kids, "New"), { action: "update", uid: "name00001", string: "Name:: New" });
  assert.deepEqual(namePlan([], "New"), { action: "create", string: "Name:: New" });
  assert.deepEqual(namePlan(kids, "Old"), { action: "none" });
  assert.equal(JSON.stringify(namePlan(kids, "New")).includes("props"), false);
  assert.equal(drawingName(kids).value, "Old");
});

test("fit stays inside 480 by 360 and a reused file does not call addFiles", () => {
  assert.deepEqual(fitSize(100, 50, false), { width: 100, height: 50 });
  assert.deepEqual(fitSize(1000, 1000, false), { width: 360, height: 360 });
  assert.deepEqual(fitSize(1000, 1000, true), { width: 1000, height: 1000 });
  let called = 0;
  const app = { addFiles() { called += 1; throw new Error("addFiles"); } };
  assert.equal(stageReusedFile(app, { fileId: "plximg000001", dataURL: "data:image/png;base64,aa" }), true);
  assert.equal(app.files.plximg000001.dataURL, "data:image/png;base64,aa");
  assert.equal(called, 0);
  const placed = placedImage({ elementId: "plximgabc", fileId: reuseFileId("img000001"), url: URL, link: "((img000001))" });
  assert.notEqual(placed.id, placed.fileId);
  assert.equal(placed.customData.firebaseUrl, URL);
  assert.equal(placed.link, "((img000001))");
});

test("insert rows match a label or a kind", () => {
  const rows = [{ label: "Fern", kind: "drawing" }, { label: "Leaf", kind: "image" }];
  assert.deepEqual(filterInsertRows(rows, "FER").map((row) => row.label), ["Fern"]);
  assert.deepEqual(filterInsertRows(rows, "image").map((row) => row.label), ["Leaf"]);
});

function sceneApp(elements) {
  const app = {
    els: elements,
    state: { width: 800, height: 600, zoom: 1, scrollX: 0, scrollY: 0 },
    files: {},
    addCalls: 0,
    addFiles() { this.addCalls += 1; throw new Error("addFiles"); },
    getSceneElements() { return this.els.filter((el) => el && !el.isDeleted); },
    getSceneElementsIncludingDeleted() { return this.els; },
    updateScene(update) {
      if (Array.isArray(update.elements)) this.els = update.elements;
      if (update.appState) Object.assign(this.state, update.appState);
    },
  };
  return app;
}

function harness({ elements = [], selected = [], blocks = {}, pages = {}, prompt = "Plant", editor = true, guard, openInsert, createBitmap, loadBitmap, fileGet } = {}) {
  const app = sceneApp(elements);
  const toasts = [];
  const updates = [];
  const pageDeletes = [];
  const creates = [];
  const deletes = [];
  const painted = [];
  const uploads = [];
  let made = 0;
  const actions = createActions({
    host: {
      pullBlock: (uid) => blocks[uid] ?? null,
      blockInfo: (uid) => {
        const block = blocks[uid];
        if (!block) return null;
        return { uid, string: block.string ?? "", pageUid: block.pageUid ?? null };
      },
      pageUidByTitle: (title) => pages[title] || null,
      ensurePage: async (title) => {
        if (!pages[title]) pages[title] = "page00001";
        return pages[title];
      },
      createBlock: async (args) => {
        creates.push(args);
        made += 1;
        return `b${String(made).padStart(8, "0")}`;
      },
      deleteBlock: async (uid) => { deletes.push(uid); },
      drawing: (uid) => blocks[uid]?.drawing ?? null,
    },
    native: {
      activeEditor: () => (editor ? { app, drawingUid: DRAW } : null),
      selectedElementIds: () => selected,
    },
    cache: {},
    cold: {},
    toaster: { show: (message, opts) => toasts.push([message, opts?.kind ?? null]) },
    spotlight: () => () => {},
    getSettings: () => ({}),
    doc: {},
    api: {
      data: {
        block: { update: async (payload) => { updates.push(payload); } },
        page: { delete: async (payload) => { pageDeletes.push(payload); } },
      },
      file: {
        get: fileGet || (async () => ({ dataURL: "data:image/png;base64,aa", type: "image/png" })),
        upload: async () => { uploads.push("upload"); },
      },
    },
    openPrompt: () => Promise.resolve(prompt),
    openInsert: openInsert || (() => {}),
    onDrawingName: (uid, value) => painted.push([uid, value]),
    createBitmap,
    loadBitmap,
    guard,
  });
  return { actions, app, toasts, updates, pageDeletes, creates, deletes, painted, uploads, pages };
}

test("setDrawingName updates only the name block string", async () => {
  const blocks = {
    [DRAW]: { string: "{{[[excalidraw]]}}", children: [{ uid: "name00001", string: "Name:: Old", order: 0 }] },
    plain0001: { string: "hello", children: [] },
  };
  const renamed = harness({ blocks, prompt: "New" });
  assert.equal(await renamed.actions.setDrawingName(DRAW), "update");
  assert.deepEqual(renamed.updates, [{ block: { uid: "name00001", string: "Name:: New" } }]);
  assert.deepEqual(Object.keys(renamed.updates[0].block).sort(), ["string", "uid"]);
  assert.deepEqual(renamed.painted, [[DRAW, "New"]]);

  const same = harness({ blocks, prompt: "Old" });
  assert.equal(await same.actions.setDrawingName(DRAW), "none");
  assert.deepEqual(same.updates, []);

  const removed = harness({ blocks, prompt: "" });
  assert.equal(await removed.actions.setDrawingName(DRAW), "delete");
  assert.deepEqual(removed.deletes, ["name00001"]);
  assert.deepEqual(removed.painted, [[DRAW, ""]]);

  const fresh = harness({
    blocks: { [DRAW]: { string: "{{[[excalidraw]]}}", children: [] } },
    prompt: "Hello",
  });
  assert.equal(await fresh.actions.setDrawingName(DRAW), "create");
  assert.equal(fresh.creates[0].parentUid, DRAW);
  assert.equal(fresh.creates[0].string, "Name:: Hello");
  assert.equal(fresh.updates.length, 0);

  const fallback = harness({ blocks, prompt: "Hello" });
  assert.equal(await fallback.actions.setDrawingName("plain0001"), "update");
  assert.equal(fallback.updates[0].block.uid, "name00001");
  assert.equal(fallback.updates[0].block.string, "Name:: Hello");
  assert.ok(fallback.updates.every((row) => row.block.uid !== "plain0001"));
});

test("turn into page reuses a title, writes a new body, and deletes a failed page", async () => {
  const text = textEl();
  const arrow = arrowTo(text.id);
  const input = [text, arrow];
  const before = structuredClone(input);
  const made = harness({ elements: input, selected: [text.id], prompt: "Fern" });
  made.app.state.cursorButton = "down";
  assert.equal(await made.actions.turnInto("page-embed"), "[[Fern]]");
  assert.deepEqual(input, before);
  const rect = made.app.getSceneElements().find((el) => el.customData?.plexus?.embed === "[[Fern]]");
  assert.equal(made.app.els.find((el) => el.id === arrow.id).startBinding.elementId, rect.id);
  assert.equal(made.creates.length, 1);
  assert.equal(made.creates[0].string, "A leaf");
  assert.equal(made.creates[0].parentUid, "page00001");
  assert.deepEqual(made.pageDeletes, []);

  const reused = harness({
    elements: [textEl()],
    selected: ["txt000001"],
    pages: { Plant: "oldpage01" },
    prompt: "Plant",
  });
  assert.equal(await reused.actions.turnInto("page-link"), "[[Plant]]");
  assert.equal(reused.creates.length, 0);
  assert.equal(reused.app.getSceneElements()[0].id, "txt000001");
  assert.equal(reused.app.getSceneElements()[0].link, "[[Plant]]");

  const failed = harness({
    elements: [textEl()],
    selected: ["txt000001"],
    prompt: "Fern",
    guard: { guardedWrite: () => false, restoreLast() {}, restoreTo() {}, list: () => [], hasSnapshot: () => false, dispose() {} },
  });
  assert.equal(await failed.actions.turnInto("page-embed"), null);
  assert.deepEqual(failed.pageDeletes, [{ page: { uid: "page00001" } }]);
  assert.equal(failed.creates.length, 0);

  const blocked = harness({ elements: [textEl()], selected: ["txt000001"], prompt: "Plant" });
  blocked.app.state.editingTextElement = { id: "txt000001" };
  assert.equal(await blocked.actions.turnInto("page-embed"), null);
  assert.equal(blocked.toasts[0][0], "Finish the current edit first");
});

test("an image becomes a collapsed block and leaves the canvas", async () => {
  const image = { id: "img000001", type: "image", x: 1, y: 2, width: 40, height: 20, isDeleted: false, version: 1, customData: { firebaseUrl: URL } };
  const moved = harness({ elements: [image, arrowTo(image.id)], selected: [image.id] });
  const child = await moved.actions.turnInto("image-block");
  assert.equal(child, "b00000001");
  assert.equal(moved.creates[0].string, `![image](${URL})`);
  assert.equal(moved.creates[0].open, false);
  assert.equal(moved.app.els.find((el) => el.id === image.id).isDeleted, true);
  assert.equal(moved.app.els.find((el) => el.id === "arr000001").startBinding, null);
  assert.equal(moved.app.addCalls, 0);
  assert.deepEqual(moved.uploads, []);

  const bare = harness({
    elements: [{ id: "img000001", type: "image", isDeleted: false, version: 1, customData: {} }],
    selected: ["img000001"],
  });
  assert.equal(await bare.actions.turnInto("image-block"), null);
  assert.equal(bare.toasts.at(-1)[0], "This image has no file address");
  assert.equal(bare.creates.length, 0);
});

test("the picker reuses a file address and inserts a drawing as an embed", async () => {
  const page = "page00001";
  const other = "drw000002";
  const image = "img000003";
  const hidden = "img000004";
  const deep = "img000005";
  const buried = "img000006";
  const blocks = {
    [DRAW]: { string: "{{[[excalidraw]]}}", pageUid: page, children: [] },
    [page]: {
      string: "",
      children: [
        { uid: DRAW, string: "{{[[excalidraw]]}}", order: 0 },
        { uid: other, string: "{{[[excalidraw]]}}", order: 1 },
        { uid: image, string: `![Leaf](${URL})`, order: 2 },
        { uid: "box000001", string: "notes", order: 3 },
      ],
    },
    [other]: {
      string: "{{[[excalidraw]]}}",
      drawing: { elements: [{ id: "r", type: "rectangle", x: 0, y: 0, width: 200, height: 100, isDeleted: false }] },
      children: [
        { uid: "name00002", string: "Name:: Fern", order: 0 },
        { uid: hidden, string: "![Hidden](https://example.test/b.png)", order: 1 },
      ],
    },
    box000001: { string: "notes", children: [{ uid: "box000002", string: "inner", order: 0 }] },
    box000002: { string: "inner", children: [{ uid: deep, string: "![Deep](https://example.test/c.png)", order: 0 }] },
    [deep]: { string: "![Deep](https://example.test/c.png)", children: [{ uid: buried, string: "![Buried](https://example.test/d.png)", order: 0 }] },
  };
  let rows = [];
  const fit = harness({
    blocks,
    createBitmap: async () => ({ width: 1000, height: 1000 }),
    openInsert: ({ rows: list, onChoose }) => {
      rows = list;
      onChoose({ row: list.find((row) => row.uid === image), full: false });
    },
  });
  const id = await fit.actions.insertImageOrDrawing();
  assert.deepEqual(rows.map((row) => row.uid), [other, image, deep]);
  assert.equal(rows.find((row) => row.uid === other).label, "Fern");
  const placed = fit.app.getSceneElements().find((el) => el.id === id);
  assert.equal(placed.width, 360);
  assert.equal(placed.height, 360);
  assert.notEqual(placed.id, placed.fileId);
  assert.equal(placed.fileId, reuseFileId(image));
  assert.equal(placed.customData.firebaseUrl, URL);
  assert.equal(placed.link, `((${image}))`);
  assert.equal(fit.app.files[placed.fileId].dataURL, "data:image/png;base64,aa");
  assert.equal(fit.app.addCalls, 0);
  assert.deepEqual(fit.uploads, []);

  const full = harness({
    blocks,
    createBitmap: async () => ({ width: 1000, height: 1000 }),
    openInsert: ({ rows: list, onChoose }) => onChoose({ row: list.find((row) => row.uid === image), full: true }),
  });
  const fullId = await full.actions.insertImageOrDrawing();
  const big = full.app.getSceneElements().find((el) => el.id === fullId);
  assert.equal(big.width, 1000);
  assert.equal(big.height, 1000);
  assert.equal(full.app.addCalls, 0);

  const drawing = harness({
    blocks,
    openInsert: ({ rows: list, onChoose }) => onChoose({ row: list.find((row) => row.uid === other), full: true }),
  });
  await drawing.actions.insertImageOrDrawing();
  const embed = drawing.app.getSceneElements().find((el) => el.customData?.plexus?.embed === `((${other}))`);
  assert.equal(embed.width, 200);
  assert.equal(embed.height, 100);
  assert.equal(drawing.app.addCalls, 0);
  assert.equal(Object.keys(drawing.app.files).length, 0);

  const many = [];
  for (let i = 0; i < 41; i += 1) many.push({ uid: `i${String(i).padStart(8, "0")}`, string: `![n](${URL})`, order: i });
  const capped = harness({
    blocks: {
      [DRAW]: { string: "{{[[excalidraw]]}}", pageUid: page, children: [] },
      [page]: { string: "", children: many },
    },
    openInsert: ({ rows: list, onChoose }) => {
      assert.equal(list.length, 40);
      onChoose(null);
    },
  });
  assert.equal(await capped.actions.insertImageOrDrawing(), null);
});

test("turn into shows only the moves the selection can make", () => {
  const items = (selected, elements, drawingUid = DRAW) => plexusCanvasItems({
    app: { getSceneElementsIncludingDeleted: () => elements, state: {} },
    native: { selectedElementIds: () => selected },
    actions: {},
    openSettings() {},
    drawingUid,
  });
  const enabled = (list) => list.filter((item) => item.enabled).map((item) => item.id);
  const empty = items([], []);
  assert.ok(!enabled(empty).includes("turn-into"));
  assert.ok(enabled(empty).includes("insert-image"));
  assert.ok(enabled(empty).includes("drawing-name"));
  assert.ok(!enabled(items([], [], null)).includes("insert-image"));
  const text = items(["txt000001"], [textEl()]);
  assert.deepEqual(text.find((item) => item.id === "turn-into").children.map((kid) => kid.id), [
    "turn-page-embed", "turn-page-link", "turn-block-embed", "turn-block-link",
  ]);
  const image = items(["img000001"], [{ id: "img000001", type: "image" }]);
  assert.deepEqual(image.find((item) => item.id === "turn-into").children.map((kid) => kid.id), ["turn-image"]);
  const embed = items(["emb000001"], [{ id: "emb000001", type: "rectangle", customData: { plexus: { embed: "((blk000001))" } } }]);
  assert.deepEqual(embed.find((item) => item.id === "turn-into").children.map((kid) => kid.id), ["turn-text"]);
  const bound = items(["txt000001"], [textEl({ containerId: "emb000001" })]);
  assert.ok(!enabled(bound).includes("turn-into"));
});
