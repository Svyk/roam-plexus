import assert from "node:assert/strict";
import test from "node:test";

import { createPublicApi } from "../src/api.js";
import { nextSceneDetail } from "../src/api.js";
import { createActions } from "../src/actions.js";
import { installLinkInterception, linkClickDecision } from "../src/host/links.js";
import { MERMAID_BLOCK, flowchartElements, flowchartFromCards, parseFlowchart } from "../src/model/flowchart.js";
import { appendExpanded, chooseNeighbours, expandElements } from "../src/model/neighbours.js";
import { plexusCanvasItems } from "../src/view/context-menus.js";

const measure = (text, size) => String(text).length * size * 0.5;

test("parseFlowchart reads TD nodes and an arrow, and rejects other diagrams", () => {
  const parsed = parseFlowchart("flowchart TD\nA[One]\nB[Two]\nA-->B");
  assert.equal(parsed.dir, "TD");
  assert.equal(parsed.layout, "down");
  assert.deepEqual(parsed.nodes.map((n) => n.label), ["One", "Two"]);
  assert.deepEqual(parsed.edges, [{ from: "A", to: "B", label: "" }]);
  const inline = parseFlowchart("flowchart LR\nA[One] -->|yes| B[Two]");
  assert.equal(inline.layout, "right");
  assert.equal(inline.edges[0].label, "yes");
  assert.equal(parseFlowchart("sequenceDiagram\nA->>B: hi"), null);
  assert.equal(parseFlowchart("graph TD\nA-->B"), null);
  assert.equal(parseFlowchart("flowchart TD\nA[One]\nhello"), null);
  assert.equal(parseFlowchart("flowchart TB\nA[One]-->B[Two]"), null);
});

test("flowchart elements lay out down or right and paste is not an importer", () => {
  let n = 0;
  const down = flowchartElements(parseFlowchart("flowchart TD\nA[One]-->B[Two]"), { measure, newId: () => `d${n++}`, origin: { x: 10, y: 20 } });
  const rects = down.filter((el) => el.type === "rectangle");
  assert.equal(rects.length, 2);
  assert.equal(down.filter((el) => el.type === "arrow").length, 1);
  assert.equal(rects[0].y, 20);
  assert.ok(rects[1].y > rects[0].y);
  n = 0;
  const right = flowchartElements(parseFlowchart("flowchart LR\nA[One]-->B[Two]"), { measure, newId: () => `r${n++}`, origin: { x: 0, y: 0 } });
  const wide = right.filter((el) => el.type === "rectangle");
  assert.ok(wide[1].x > wide[0].x);
  const labelled = flowchartElements(parseFlowchart("flowchart TD\nA[One] -->|yes| B[Two]"), { measure, newId: () => `l${n++}` });
  const arrow = labelled.find((el) => el.type === "arrow");
  const label = labelled.find((el) => el.type === "text" && el.containerId === arrow.id);
  assert.equal(label.originalText, "yes");
});

test("export writes flowchart text, LR when the row is wider, TD when the column is taller", () => {
  const card = (id, x, y, w, h, label, uid) => [
    { id, type: "rectangle", x, y, width: w, height: h, isDeleted: false, customData: { plexus: { embed: `((${uid}))` } }, link: `((${uid}))` },
    { id: `${id}t`, type: "text", x, y, width: 10, height: 10, isDeleted: false, containerId: id, text: label, originalText: label },
  ];
  const tall = [
    ...card("a", 0, 0, 40, 40, "Alpha", "aaaaaaaaa"),
    ...card("b", 0, 200, 40, 40, "Beta", "bbbbbbbbb"),
    { id: "arr", type: "arrow", x: 0, y: 0, width: 1, height: 1, isDeleted: false, startBinding: { elementId: "a" }, endBinding: { elementId: "b" }, boundElements: [{ id: "al", type: "text" }] },
    { id: "al", type: "text", containerId: "arr", text: "goes", originalText: "goes", isDeleted: false },
  ];
  const text = flowchartFromCards(tall, []);
  assert.match(text, /^flowchart TD\nn1\[Alpha\]\nn2\[Beta\]\nn1 -->\|goes\| n2$/);
  const wide = [...card("a", 0, 0, 40, 40, "Alpha", "aaaaaaaaa"), ...card("b", 400, 0, 40, 40, "Beta", "bbbbbbbbb")];
  assert.match(flowchartFromCards(wide, []), /^flowchart LR/);
  const selected = flowchartFromCards(tall, ["a"]);
  assert.match(selected, /^flowchart TD\nn1\[Alpha\]$/);
  assert.equal(flowchartFromCards([{ id: "z", type: "rectangle", x: 0, y: 0, width: 10, height: 10, isDeleted: false }], []), null);
  assert.equal(parseFlowchart(text).nodes.length, 2);
});

test("chooseNeighbours skips cards already present, caps at twelve, and keeps both parents", () => {
  const rows = Array.from({ length: 14 }, (_, i) => ({ uid: `u${i}`, label: `L${i}` }));
  rows.push({ uid: "u0", label: "dup" });
  const { picked, total } = chooseNeighbours(rows, new Set(["u1"]), 12);
  assert.equal(total, 13);
  assert.equal(picked.length, 12);
  assert.equal(picked.some((row) => row.uid === "u1"), false);
  assert.equal(picked.filter((row) => row.uid === "u0").length, 1);
  const parents = chooseNeighbours([
    { uid: "pageuid01", title: "Page", label: "Page" },
    { uid: "blockuid1", label: "Block" },
  ], new Set(), 12);
  assert.deepEqual(parents.picked.map((row) => row.uid), ["pageuid01", "blockuid1"]);
});

test("expand places a new card to the right with a labelled arrow", () => {
  let n = 0;
  const added = expandElements({
    source: { id: "src", uid: "sourceuid", x: 0, y: 0, width: 100, height: 40 },
    rows: [{ uid: "childuid1", label: "Kid" }, { uid: "pageuid01", title: "Notes", label: "Notes" }],
    role: "child",
    newId: () => `e${n++}`,
  });
  const rects = added.filter((el) => el.type === "rectangle");
  assert.equal(rects.length, 2);
  for (const rect of rects) assert.ok(rect.x >= 100);
  assert.equal(rects[0].link, "((childuid1))");
  assert.equal(rects[1].link, "[[Notes]]");
  const arrow = added.find((el) => el.type === "arrow" && el.endBinding.elementId === rects[0].id);
  assert.equal(arrow.startBinding.elementId, "src");
  assert.equal(added.find((el) => el.containerId === arrow.id).text, "child");
  const source = { id: "src", type: "rectangle", boundElements: [], version: 1 };
  const next = appendExpanded([source], added);
  assert.ok(next[0].boundElements.some((b) => b.id === arrow.id));
  assert.equal(next[0].version, 2);
});

test("spec, help, and validate describe apiVersion 6 and ignore an unknown listener", () => {
  const bags = new Map();
  const emitter = {
    on(type, cb) {
      if (!bags.has(type)) bags.set(type, new Set());
      bags.get(type).add(cb);
    },
    off(type, cb) { bags.get(type)?.delete(cb); },
    emit(type, detail) {
      const results = [];
      for (const cb of bags.get(type) || []) results.push(cb(detail));
      return results;
    },
  };
  const api = createPublicApi({ host: { graphName: () => "g" }, actions: {}, emitter, version: "0.31.0" });
  assert.equal(api.apiVersion, 6);
  const spec = api.spec();
  assert.equal(spec.apiVersion, 6);
  assert.deepEqual(spec.events, ["change", "editor-open", "editor-close", "scene", "paste", "drop", "link-click"]);
  assert.ok(spec.methods.includes("create"));
  assert.ok(spec.methods.includes("validate"));
  assert.equal(spec.methods.includes("apiVersion"), false);
  assert.match(api.help(), /apiVersion 6/);
  assert.deepEqual(api.validate("apiVersion", 6), { ok: true, data: 6 });
  assert.deepEqual(api.validate("apiVersion", 3), { ok: false, error: "apiVersion must be 6" });
  assert.deepEqual(api.validate("event", "scene"), { ok: true, data: "scene" });
  assert.equal(api.validate("event", "other").ok, false);
  assert.equal(api.validate("nope", 1).ok, false);
  const seen = [];
  const cb = (detail) => seen.push(detail);
  api.addEventListener("change", cb);
  api.addEventListener("change", cb);
  api.addEventListener("scene", cb);
  api.addEventListener("other", cb);
  assert.equal(bags.get("change").size, 1);
  assert.equal(bags.get("scene").size, 1);
  assert.equal(bags.has("other"), false);
  emitter.emit("change", { uid: "x" });
  assert.equal(seen.length, 1);
  emitter.emit("scene", { uid: "x", count: 2 });
  assert.equal(seen.length, 2);
  const detail = { cancelled: false, preventDefault() { this.cancelled = true; } };
  api.addEventListener("link-click", (d) => { d.preventDefault(); return false; });
  const results = emitter.emit("link-click", detail);
  assert.equal(detail.cancelled, true);
  assert.equal(linkClickDecision(results, detail), false);
  api.removeEventListener("scene", cb);
  assert.equal(bags.get("scene").size, 0);
});

test("a scene event fires only when the element signature changes", () => {
  const elements = [{ id: "a", version: 1 }, { id: "b", version: 1, isDeleted: true }];
  const first = nextSceneDetail("", elements, "drawuid01");
  assert.deepEqual(first.detail, { uid: "drawuid01", count: 1 });
  assert.equal(nextSceneDetail(first.signature, elements, "drawuid01").detail, null);
  const moved = [{ id: "a", version: 1, x: 9 }, { id: "b", version: 1, isDeleted: true }];
  assert.equal(nextSceneDetail(first.signature, moved, "drawuid01").detail, null);
  const edited = [{ id: "a", version: 2 }, { id: "b", version: 1, isDeleted: true }];
  assert.deepEqual(nextSceneDetail(first.signature, edited, "drawuid01").detail, { uid: "drawuid01", count: 1 });
});

function clickSetup({ beforeNavigate, setTimer, clearTimer } = {}) {
  const handlers = {};
  const calls = [];
  const containerEl = {
    addEventListener: (t, f) => { handlers[t] = f; },
    removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    closest: () => ({ querySelector: () => null }),
  };
  const api = {
    graph: { name: "g" },
    data: { pull: () => null },
    ui: { mainWindow: { openPage: (a) => calls.push(a) }, rightSidebar: { addWindow() {} } },
  };
  installLinkInterception({
    app: { state: { zoom: { value: 1 }, scrollX: 0, scrollY: 0 }, getElementLinkAtPosition: () => "[[Target]]" },
    containerEl,
    api,
    beforeNavigate,
    setTimer,
    clearTimer,
    parse: () => ({ type: "page", title: "Target" }),
  });
  const ev = () => ({ isTrusted: true, button: 0, clientX: 10, clientY: 10, preventDefault() { ev.prevented = (ev.prevented || 0) + 1; }, stopImmediatePropagation() {} });
  return { handlers, calls, ev };
}

test("sync preventDefault cancels the link click", () => {
  const s = clickSetup({ beforeNavigate: () => false });
  const down = s.ev();
  s.handlers.pointerdown(down);
  const up = s.ev();
  s.handlers.pointerup(up);
  assert.equal(s.calls.length, 0);
});

test("a listener promise that resolves false does not navigate, and a timeout does", async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const held = clickSetup({ beforeNavigate: () => pending, setTimer: () => 1, clearTimer() {} });
  held.handlers.pointerdown(held.ev());
  held.handlers.pointerup(held.ev());
  assert.equal(held.calls.length, 0);
  release(false);
  await pending;
  assert.equal(held.calls.length, 0);

  let fire = null;
  const timed = clickSetup({
    beforeNavigate: () => new Promise(() => {}),
    setTimer: (fn) => { fire = fn; return 1; },
    clearTimer() {},
  });
  timed.handlers.pointerdown(timed.ev());
  timed.handlers.pointerup(timed.ev());
  assert.equal(timed.calls.length, 0);
  fire();
  assert.equal(timed.calls.length, 1);
});

function editor(elements, selected) {
  const app = {
    state: { zoom: { value: 1 }, scrollX: 0, scrollY: 0, width: 800, height: 600 },
    getSceneElements: () => elements.filter((el) => el && !el.isDeleted),
    getSceneElementsIncludingDeleted: () => elements,
    updateScene(update) {
      app.writes.push(update);
      if (update.elements) elements.splice(0, elements.length, ...update.elements);
    },
    writes: [],
  };
  return { app, selected };
}

test("export mermaid writes one block and one flowchart child and leaves the scene empty of new shapes", async () => {
  const created = [];
  const elements = [
    { id: "a", type: "rectangle", x: 0, y: 0, width: 40, height: 80, isDeleted: false, customData: { plexus: { embed: "((aaaaaaaaa))" } }, link: "((aaaaaaaaa))" },
    { id: "at", type: "text", containerId: "a", text: "Alpha", originalText: "Alpha", isDeleted: false },
  ];
  const { app } = editor(elements, []);
  const actions = createActions({
    host: {
      createBlock: async ({ parentUid, string }) => {
        const uid = `b${created.length}`;
        created.push({ uid, parentUid, string });
        return uid;
      },
    },
    native: { activeEditor: () => ({ app, drawingUid: "drawuid01" }), selectedElementIds: () => [] },
    toaster: { show() {} },
    doc: {},
    api: {},
  });
  const parent = await actions.exportMermaid();
  assert.equal(parent, "b0");
  assert.equal(created[0].string, MERMAID_BLOCK);
  assert.equal(created[0].parentUid, "drawuid01");
  assert.equal(created[1].parentUid, "b0");
  assert.match(created[1].string, /^flowchart /);
  assert.equal(app.writes.length, 0);
  assert.equal(elements.length, 2);
});

test("import mermaid lays out the flowchart child and leaves other diagrams alone", async () => {
  const elements = [];
  const { app } = editor(elements, []);
  const toasts = [];
  const blocks = {
    mermaid01: { string: MERMAID_BLOCK, parentString: "page", children: [{ string: "flowchart TD\nA[One]-->B[Two]" }] },
    child0001: { string: "flowchart LR\nA[Left]-->B[Right]", parentString: MERMAID_BLOCK, children: [] },
    seq000001: { string: "sequenceDiagram\nA->>B: hi", parentString: MERMAID_BLOCK, children: [] },
  };
  let reads = 0;
  const actions = createActions({
    host: {
      blockInfo: (uid) => blocks[uid] || null,
      pullBlock: (uid) => blocks[uid] || null,
    },
    native: { activeEditor: () => ({ app, drawingUid: "drawuid01" }), selectedElementIds: () => [] },
    toaster: { show: (message) => toasts.push(message) },
    doc: {},
    api: {},
    clipboard: { readText: async () => { reads += 1; return "flowchart TD\nA-->B"; } },
    measure,
  });
  const ids = await actions.importMermaid("mermaid01");
  assert.equal(ids.length, 2);
  assert.equal(elements.filter((el) => el.type === "rectangle").length, 2);
  assert.equal(elements.filter((el) => el.type === "arrow").length, 1);
  assert.equal(app.writes[0].captureUpdate, "IMMEDIATELY");
  assert.equal(reads, 0);
  const before = elements.length;
  assert.equal(await actions.importMermaid("seq000001"), null);
  assert.equal(elements.length, before);
  assert.ok(toasts.includes("Only a flowchart"));
  const side = await actions.importMermaid("child0001");
  assert.equal(side.length, 2);
});

test("expand adds at most twelve cards, skips one already on the canvas, and toasts the cap", async () => {
  const source = { id: "src", type: "rectangle", x: 0, y: 0, width: 80, height: 40, isDeleted: false, customData: { plexus: { embed: "((sourceuid))" } }, link: "((sourceuid))", boundElements: null, version: 1 };
  const present = { id: "have", type: "rectangle", x: 10, y: 10, width: 80, height: 40, isDeleted: false, customData: { plexus: { embed: "((child0001))" } }, link: "((child0001))" };
  const elements = [source, present];
  const { app } = editor(elements, ["src"]);
  const children = Array.from({ length: 14 }, (_, i) => ({ ":block/uid": `child${String(i).padStart(4, "0")}`, ":block/string": `Kid ${i}` }));
  children[1][":block/uid"] = "child0001";
  const toasts = [];
  const actions = createActions({
    host: { pageUidByTitle: () => null },
    native: { activeEditor: () => ({ app, drawingUid: "drawuid01" }), selectedElementIds: () => ["src"] },
    toaster: { show: (message) => toasts.push(message) },
    doc: {},
    api: { data: { pull: () => ({ ":block/children": children }) } },
  });
  const ids = await actions.expandNeighbours("children");
  assert.equal(ids.length, 12);
  assert.equal(toasts.at(-1), "12 of 13");
  assert.equal(app.writes[0].captureUpdate, "IMMEDIATELY");
  assert.equal(elements.filter((el) => el.type === "rectangle" && el.link === "((child0001))").length, 1);
  const fresh = elements.filter((el) => el.type === "rectangle" && el.id !== "src" && el.id !== "have");
  assert.ok(fresh.every((el) => el.x >= source.x + source.width));
  const labels = elements.filter((el) => el.type === "text" && el.containerId && elements.find((a) => a.id === el.containerId && a.type === "arrow"));
  assert.ok(labels.every((el) => el.text === "child"));
});

test("the canvas menu expands one card and stays quiet otherwise", () => {
  const card = { id: "src", type: "rectangle", customData: { plexus: { embed: "((sourceuid))" } }, isDeleted: false };
  const items = (selected, elements) => plexusCanvasItems({
    app: { getSceneElementsIncludingDeleted: () => elements },
    native: { selectedElementIds: () => selected },
    actions: { expandNeighbours(role) { return role; } },
    openSettings() {},
    drawingUid: "drawuid01",
  }).filter((item) => item.id.startsWith("expand-"));
  assert.deepEqual(items([], [card]).map((item) => item.enabled), [false, false, false, false]);
  const one = items(["src"], [card]);
  assert.deepEqual(one.map((item) => item.enabled), [true, true, true, true]);
  assert.deepEqual(one.map((item) => item.label), ["Plexus: Expand backlinks", "Plexus: Expand children", "Plexus: Expand outgoing refs", "Plexus: Expand parents"]);
  const text = { id: "tx", type: "text", containerId: "src", isDeleted: false };
  assert.equal(items(["tx"], [card, text]).every((item) => item.enabled), true);
  const other = { id: "b", type: "rectangle", customData: { plexus: { embed: "((otheruid1))" } }, isDeleted: false };
  assert.equal(items(["src", "b"], [card, other]).every((item) => item.enabled), false);
});
