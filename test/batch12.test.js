import assert from "node:assert/strict";
import test from "node:test";

import { createActions } from "../src/actions.js";
import { QUERY_REF, parseEmbedRef } from "../src/model/embeds.js";
import { attrRows, attrWrite, chosenAttrs, parseAttr } from "../src/model/page-card.js";
import { queryPageTitles } from "../src/model/query-live.js";
import { cardTexts, embedAtPoint, hoveredRefLines } from "../src/model/ref-lines.js";
import { taskLabel, toggleTaskString } from "../src/model/task-card.js";
import { createRoamHost } from "../src/host/roam.js";
import { createEmbedOverlay } from "../src/view/embeds.js";
import { installRefLines } from "../src/view/ref-lines.js";

const DRAW = "drw000001";

test("a task swap keeps the words after the macro", () => {
  assert.equal(toggleTaskString("{{[[TODO]]}} water the plant"), "{{[[DONE]]}} water the plant");
  assert.equal(toggleTaskString("{{[[DONE]]}}water"), "{{[[TODO]]}}water");
  assert.equal(toggleTaskString("plain"), null);
  assert.equal(taskLabel("{{[[TODO]]}} water"), "water");
  assert.equal(taskLabel("plain"), null);
});

test("attribute rows edit plain names and lock Better Tasks", () => {
  assert.deepEqual(chosenAttrs(" Status, Status, BT_attrDue, [[No]], a::b "), ["Status", "BT_attrDue"]);
  assert.equal(chosenAttrs(Array.from({ length: 12 }, (_, i) => `N${i}`).join(",")).length, 8);
  assert.deepEqual(parseAttr("Status:: open"), { name: "Status", value: "open", bt: false });
  assert.equal(parseAttr("[[Page]]:: x"), null);
  const rows = attrRows(
    [{ uid: "st0000001", string: "Status:: open" }, { uid: "bt0000001", string: "BT_attrDue:: [[today]]" }],
    ["Status", "BT_attrDue", "Owner"],
  );
  assert.deepEqual(rows, [
    { name: "Status", value: "open", uid: "st0000001", editable: true },
    { name: "BT_attrDue", value: "[[today]]", uid: "bt0000001", editable: false },
    { name: "Owner", value: "", uid: null, editable: true },
  ]);
  assert.deepEqual(attrWrite("Status", " shut "), { action: "write", string: "Status:: shut" });
  assert.deepEqual(attrWrite("Status", "  "), { action: "delete" });
  assert.deepEqual(attrWrite("BT_attrDue", "no"), { action: "none" });
});

test("a query names at most four pages and skips components", () => {
  assert.deepEqual(queryPageTitles("{{[[query]]: {and: [[TODO]] [[Plant]] [[query]] [[Plant]]}}}"), ["Plant"]);
  assert.deepEqual(queryPageTitles("[[A]] [[B]] [[C]] [[D]] [[E]]"), ["A", "B", "C", "D"]);
  assert.deepEqual(queryPageTitles("{{[[query]]: {and: [[TODO]]}}}"), []);
  assert.equal(parseEmbedRef("plexus:query").kind, "query");
  assert.equal(parseEmbedRef(QUERY_REF).ref, QUERY_REF);
});

test("hover lines stay on the hovered card and stop at twelve", () => {
  const cards = [
    { id: "a", ref: "[[Plant]]", texts: ["see ((blk000001))"], x: 0, y: 0, width: 100, height: 40 },
    { id: "b", ref: "((blk000001))", texts: ["[[Plant]]"], x: 200, y: 0, width: 80, height: 40 },
    { id: "c", ref: "[[Other]]", texts: ["alone"], x: 0, y: 80, width: 40, height: 40 },
  ];
  const lines = hoveredRefLines({ hoveredId: "a", cards });
  assert.deepEqual(lines.map((line) => line.toId), ["b"]);
  assert.equal(lines[0].x1, 50);
  assert.equal(lines[0].x2, 240);
  assert.deepEqual(hoveredRefLines({ hoveredId: "c", cards }), []);
  const many = [{ id: "h", ref: "[[H]]", texts: [], x: 0, y: 0, width: 10, height: 10 }];
  for (let i = 0; i < 20; i += 1) {
    many.push({ id: `o${i}`, ref: `[[P${i}]]`, texts: ["[[H]]"], x: i, y: 0, width: 10, height: 10 });
    many[0].texts.push(`[[P${i}]]`);
  }
  assert.equal(hoveredRefLines({ hoveredId: "h", cards: many }).length, 12);
  assert.deepEqual(cardTexts({ string: "s", title: "Plant", children: [{ string: "c" }] }), ["s", "[[Plant]]", "c"]);
  const state = { zoom: 1, scrollX: 0, scrollY: 0, offsetLeft: 0, offsetTop: 0 };
  const elements = [{ id: "a", type: "rectangle", x: 0, y: 0, width: 10, height: 10, isDeleted: false, customData: { plexus: { embed: "[[Plant]]" } } }];
  assert.equal(embedAtPoint(elements, state, 5, 5), "a");
  assert.equal(embedAtPoint(elements, state, 30, 5), null);
});

test("pull keeps a child uid and a ref watch is its own pattern", () => {
  const api = {
    graph: { name: "g" },
    watches: [],
    removed: [],
    data: {
      pull: () => ({
        ":block/uid": "pg0000001",
        ":node/title": "Plant",
        ":block/children": [{ ":block/uid": "st0000001", ":block/string": "Status:: open", ":block/order": 0 }],
      }),
      addPullWatch: (pattern, ident, cb) => api.watches.push([pattern, ident, cb]),
      removePullWatch: (pattern, ident, cb) => api.removed.push([pattern, ident, cb]),
    },
  };
  const host = createRoamHost({ api });
  const pulled = host.pullEmbedContent("[[Plant]]");
  assert.equal(pulled.children[0].uid, "st0000001");
  const off = host.watchPageRefs("pg0000001", () => {});
  assert.match(api.watches[0][0], /:block\/_refs/);
  assert.equal(api.watches[0][1], '[:block/uid "pg0000001"]');
  off();
  off();
  assert.equal(api.removed.length, 1);
});

function sceneApp(elements) {
  return {
    els: elements,
    state: { width: 800, height: 600, zoom: 1, scrollX: 0, scrollY: 0 },
    getSceneElements() { return this.els.filter((el) => el && !el.isDeleted); },
    getSceneElementsIncludingDeleted() { return this.els; },
    updateScene(update) {
      if (Array.isArray(update.elements)) this.els = update.elements;
      if (update.appState) Object.assign(this.state, update.appState);
    },
  };
}

function harness({ blocks = {}, pages = {}, prompts = [], editor = true } = {}) {
  const app = sceneApp([]);
  const toasts = [];
  const updates = [];
  const pageDeletes = [];
  const creates = [];
  const deletes = [];
  const queue = [...prompts];
  let made = 0;
  const actions = createActions({
    host: {
      pullBlock: (uid) => blocks[uid] ?? null,
      blockInfo: (uid) => (blocks[uid] ? { uid, string: blocks[uid].string ?? "", pageUid: blocks[uid].pageUid ?? null } : null),
      pageUidByTitle: (title) => pages[title] || null,
      ensurePage: async (title) => {
        if (!pages[title]) pages[title] = "page00001";
        return pages[title];
      },
      createBlock: async (args) => {
        creates.push(args);
        made += 1;
        const uid = `b${String(made).padStart(8, "0")}`;
        blocks[uid] = { string: args.string, children: [] };
        return uid;
      },
      deleteBlock: async (uid) => { deletes.push(uid); },
    },
    native: { activeEditor: () => (editor ? { app, drawingUid: DRAW } : null), selectedElementIds: () => [] },
    cache: {},
    cold: {},
    toaster: { show: (message, opts) => toasts.push([message, opts?.kind ?? null]) },
    spotlight: () => () => {},
    getSettings: () => ({}),
    doc: {},
    api: {
      data: {
        block: { update: async (payload) => { updates.push(payload); if (blocks[payload.block.uid]) blocks[payload.block.uid].string = payload.block.string; } },
        page: { delete: async (payload) => { pageDeletes.push(payload); } },
      },
    },
    openPrompt: () => Promise.resolve(queue.shift()),
    guard: {
      guardedWrite(target, spec) {
        target.updateScene({ elements: spec.next(target.getSceneElementsIncludingDeleted()), appState: spec.appState });
        return true;
      },
    },
  });
  return { actions, app, toasts, updates, pageDeletes, creates, deletes, pages };
}

test("a task card writes a to-do child and a checkbox swaps only that string", async () => {
  const made = harness({ prompts: ["water the plant"] });
  const uid = await made.actions.taskCard(null);
  assert.equal(uid, "b00000001");
  assert.equal(made.creates[0].parentUid, DRAW);
  assert.equal(made.creates[0].string, "{{[[TODO]]}} water the plant");
  assert.equal(made.creates[0].props, undefined);
  const card = made.app.getSceneElements().find((el) => el.customData?.plexus?.embed === "((b00000001))");
  assert.ok(card);

  const blocks = { task00001: { string: "{{[[TODO]]}} water", children: [] } };
  const again = harness({ blocks, prompts: [] });
  assert.equal(await again.actions.taskCard("task00001"), "task00001");
  assert.equal(again.creates.length, 0);
  assert.equal(await again.actions.toggleTask("task00001"), "{{[[DONE]]}} water");
  assert.deepEqual(Object.keys(again.updates[0].block).sort(), ["string", "uid"]);
  assert.equal(await again.actions.toggleTask("task00001"), "{{[[TODO]]}} water");
  assert.equal(await again.actions.toggleTask("plain0001"), null);
});

test("a page card reuses a page, stores the chosen names, and does not write a locked attribute", async () => {
  const fresh = harness({ prompts: ["Plant", "Status, BT_attrDue"] });
  assert.equal(await fresh.actions.pageCard(), "page00001");
  const card = fresh.app.getSceneElements().find((el) => el.type === "rectangle");
  assert.equal(card.customData.plexus.embed, "[[Plant]]");
  assert.deepEqual(card.customData.plexus.attrs, ["Status", "BT_attrDue"]);
  assert.equal(fresh.creates.length, 0);
  assert.deepEqual(fresh.pageDeletes, []);

  const reused = harness({ pages: { Plant: "oldpage01" }, prompts: ["Plant", "Owner"] });
  assert.equal(await reused.actions.pageCard(), "oldpage01");
  assert.deepEqual(reused.pageDeletes, []);

  const cancelled = harness({ prompts: ["New Page", null] });
  assert.equal(await cancelled.actions.pageCard(), null);
  assert.deepEqual(cancelled.pageDeletes, [{ page: { uid: "page00001" } }]);
  assert.equal(cancelled.app.getSceneElements().length, 0);

  const blocks = { st0000001: { string: "Status:: open", children: [] }, bt0000001: { string: "BT_attrDue:: [[x]]", children: [] } };
  const edit = harness({ blocks });
  assert.equal(await edit.actions.setPageAttr({ pageUid: "page00001", name: "BT_attrDue", value: "no", uid: "bt0000001" }), "locked");
  assert.equal(edit.updates.length, 0);
  assert.equal(await edit.actions.setPageAttr({ pageUid: "page00001", name: "Status", value: "shut", uid: "st0000001" }), "update");
  assert.equal(edit.updates[0].block.string, "Status:: shut");
  assert.equal(edit.updates[0].block.props, undefined);
  assert.equal(await edit.actions.setPageAttr({ pageUid: "page00001", name: "Owner", value: "Ada" }), "create");
  assert.equal(edit.creates[0].string, "Owner:: Ada");
  assert.equal(edit.creates[0].parentUid, "page00001");
});

test("a live query stores the string and does not create a block", async () => {
  const live = harness({ prompts: ["{{[[query]]: {and: [[TODO]] [[Plant]]}}}"] });
  const id = await live.actions.liveQuery();
  const card = live.app.getSceneElements().find((el) => el.id === id);
  assert.equal(card.customData.plexus.embed, QUERY_REF);
  assert.match(card.customData.plexus.liveQuery, /\[\[Plant\]\]/);
  assert.equal(live.creates.length, 0);
  assert.match(live.toasts.at(-1)[0], /Live query/);

  const snap = harness({ prompts: ["{{[[query]]: {and: [[TODO]]}}}"] });
  assert.ok(await snap.actions.liveQuery());
  assert.match(snap.toasts.at(-1)[0], /No page to watch/);
});

function el() {
  const node = {
    style: {}, children: [], className: "", textContent: "", value: "", type: "", checked: false, attrs: {}, listeners: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    append(...kids) { this.children.push(...kids); },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    remove() { this.removed = true; },
  };
  return node;
}

function overlay({ elements, content, onToggleTask, onAttrEdit, hostExtra = {} }) {
  const body = el();
  const frames = [];
  const doc = {
    body,
    defaultView: { requestAnimationFrame: (cb) => { frames.push(cb); return frames.length; }, cancelAnimationFrame() {} },
    createElement: () => el(),
  };
  const rendered = [];
  const api = { ui: { components: { renderString: ({ string }) => rendered.push(string), unmountNode() {} } } };
  const watches = [];
  const host = {
    pullEmbedContent: async () => content,
    watchEmbed: () => () => {},
    ...hostExtra,
  };
  const app = {
    state: { scrollX: 0, scrollY: 0, zoom: { value: 1 }, offsetLeft: 0, offsetTop: 0 },
    elements,
    getSceneElementsIncludingDeleted() { return this.elements; },
  };
  const view = createEmbedOverlay({
    doc, api, host, app,
    containerEl: { getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600 }) },
    subscribe: () => () => {},
    onToggleTask, onAttrEdit,
  });
  const flush = async () => { while (frames.length) frames.shift()(); await new Promise((r) => setTimeout(r, 0)); };
  return { view, body, rendered, watches, frames, flush, app };
}

test("a task embed paints a checkbox for the words and not the macro", async () => {
  const toggles = [];
  const t = overlay({
    elements: [{ id: "e1", type: "rectangle", x: 0, y: 0, width: 100, height: 40, isDeleted: false, customData: { plexus: { embed: "((task00001))" } } }],
    content: { kind: "block", uid: "task00001", string: "{{[[TODO]]}} water", children: [{ string: "BT_attrDue:: [[x]]" }] },
    onToggleTask: (uid) => { toggles.push(uid); return "{{[[DONE]]}} water"; },
  });
  await t.flush();
  assert.deepEqual(t.rendered, ["water", "BT_attrDue:: [[x]]"]);
  const box = t.body.children[0].children.find((node) => node.className === "plexus-embed-body").children.find((node) => node.type === "checkbox");
  box.checked = true;
  box.listeners.click[0]({ stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(toggles, ["task00001"]);
  t.view.dispose();
});

test("a page card paints an editor for a plain attribute and text for a locked one", async () => {
  const edits = [];
  const t = overlay({
    elements: [{ id: "e1", type: "rectangle", x: 0, y: 0, width: 100, height: 80, isDeleted: false, customData: { plexus: { embed: "[[Plant]]", attrs: ["Status", "BT_attrDue"] } } }],
    content: { kind: "page", uid: "page00001", title: "Plant", children: [{ uid: "st0000001", string: "Status:: open" }, { uid: "bt0000001", string: "BT_attrDue:: soon" }] },
    onAttrEdit: (row) => { edits.push(row); },
  });
  await t.flush();
  const body = t.body.children[0].children.find((node) => node.className === "plexus-embed-body");
  const inputs = body.children.flatMap((row) => row.children).filter((node) => node.className === "plexus-attr-value");
  const locked = body.children.flatMap((row) => row.children).filter((node) => node.className.includes("plexus-attr-locked"));
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].value, "open");
  assert.equal(locked.length, 1);
  assert.equal(locked[0].textContent, "soon");
  inputs[0].value = "shut";
  inputs[0].listeners.keydown[0]({ key: "Enter", stopPropagation() {}, preventDefault() {} });
  assert.deepEqual(edits, [{ pageUid: "page00001", name: "Status", value: "shut", uid: "st0000001" }]);
  t.view.dispose();
});

test("a query watch paints the string again", async () => {
  const refs = [];
  const t = overlay({
    elements: [{ id: "e1", type: "rectangle", x: 0, y: 0, width: 100, height: 80, isDeleted: false, customData: { plexus: { embed: QUERY_REF, liveQuery: "{{[[query]]: {and: [[TODO]] [[Plant]]}}}" } } }],
    content: null,
    hostExtra: {
      pageUidByTitle: (title) => (title === "Plant" ? "pgplant01" : null),
      watchPageRefs: (uid, cb) => { refs.push({ uid, cb }); return () => {}; },
    },
  });
  await t.flush();
  assert.deepEqual(t.rendered, ["{{[[query]]: {and: [[TODO]] [[Plant]]}}}"]);
  assert.equal(refs[0].uid, "pgplant01");
  refs[0].cb();
  await t.flush();
  assert.equal(t.rendered.length, 2);
  assert.equal(t.rendered[1], t.rendered[0]);
  t.view.dispose();
});

test("moving onto an embed draws one line and leaving removes it", () => {
  const elements = [
    { id: "a", type: "rectangle", x: 0, y: 0, width: 10, height: 10, isDeleted: false, customData: { plexus: { embed: "[[Plant]]" } } },
    { id: "b", type: "rectangle", x: 40, y: 0, width: 10, height: 10, isDeleted: false, customData: { plexus: { embed: "((blk000001))" } } },
  ];
  const app = { state: { zoom: 1, scrollX: 0, scrollY: 0, offsetLeft: 0, offsetTop: 0 }, getSceneElementsIncludingDeleted: () => elements };
  const svg = {
    children: [],
    setAttribute() {},
    append(node) { this.children.push(node); },
    querySelectorAll() { return this.children.slice(); },
  };
  const node = () => ({
    setAttribute() {},
    remove() { svg.children = svg.children.filter((item) => item !== this); },
  });
  const listeners = {};
  const container = {
    children: [],
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    append(child) { this.children.push(child); },
    addEventListener(type, fn) { listeners[type] = fn; },
    removeEventListener() {},
  };
  const doc = { createElementNS: (_ns, tag) => (tag === "svg" ? svg : node()), createElement: node };
  const texts = new Map([
    ["a", { texts: ["((blk000001))"] }],
    ["b", { texts: [] }],
  ]);
  const off = installRefLines({ doc, app, containerEl: container, texts, requestFrame: (cb) => { cb(); return 1; }, cancelFrame() {} });
  listeners.pointermove({ clientX: 5, clientY: 5 });
  assert.equal(svg.children.length, 1);
  listeners.pointerleave();
  assert.equal(svg.children.length, 0);
  off();
});
