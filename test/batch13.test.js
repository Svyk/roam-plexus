import test from "node:test";
import assert from "node:assert/strict";
import { layoutTree, ORG_SIBLING_GAP, SIBLING_GAP, ROOT_COLOR } from "../src/model/mindmap.js";
import { reconcile, applyOps, patchMarker, nodeId, textId, edgeId, mmOf, makeSizer, edgeGeometry } from "../src/model/mmsync.js";
import { parseIndent, crossPairs, linkTarget, inkFor, paletteFill, PALETTES } from "../src/model/mmextra.js";
import { stepSync, singleText, hasMarkup } from "../src/model/region-sync.js";
import { installMmChrome } from "../src/view/mm-chrome.js";
import { installRegionSync } from "../src/view/region-sync.js";
import { openOutlinePrompt } from "../src/view/outline-prompt.js";

const measure = (s, fs) => s.length * fs * 0.5;
const sizes = makeSizer(measure);
const mk = (spec) => {
  const [uid, kids = [], open = true, string] = spec;
  return { uid, string: string ?? `text ${uid}`, open, children: kids.map(mk) };
};
const build = (tree, elements = []) => applyOps(elements, reconcile({ elements, tree, sizes, layout: "right" }));
const get = (els, id) => els.find((e) => e.id === id);

test("both sides splits children and org chart widens the sibling gap by 18", () => {
  const tree = {
    uid: "R", open: true, children: [
      { uid: "a", open: true, children: [{ uid: "a1", open: true, children: [] }] },
      { uid: "b", open: true, children: [] },
    ],
  };
  const sz = { R: { width: 100, height: 40 }, a: { width: 80, height: 30 }, b: { width: 80, height: 30 }, a1: { width: 60, height: 24 } };
  const root = { x: 200, y: 100 };
  const both = layoutTree({ tree, sizes: sz, layout: "both", root });
  assert.deepEqual(both.R, root);
  assert.ok(both.a.x > root.x + sz.R.width);
  assert.ok(both.a1.x > both.a.x + sz.a.width);
  assert.ok(both.b.x + sz.b.width < root.x);
  const down = layoutTree({ tree, sizes: sz, layout: "down", root });
  const org = layoutTree({ tree, sizes: sz, layout: "org", root });
  const gap = (p) => Math.abs(p.a.x - p.b.x);
  assert.equal(gap(org) - gap(down), ORG_SIBLING_GAP - SIBLING_GAP);
  assert.equal(ORG_SIBLING_GAP - SIBLING_GAP, 18);
});

test("edge geometry follows both sides and org without adding points", () => {
  const parent = { x: 0, y: 0, width: 100, height: 40 };
  const right = edgeGeometry(parent, { x: 180, y: 0, width: 80, height: 30 }, "both");
  const left = edgeGeometry(parent, { x: -200, y: 0, width: 80, height: 30 }, "both");
  const org = edgeGeometry(parent, { x: 10, y: 120, width: 80, height: 30 }, "org");
  assert.equal(right.x, 100);
  assert.equal(left.x, 0);
  assert.equal(org.y, 40);
  for (const g of [right, left, org]) assert.equal(g.points.length, 2);
});

test("reconcile keeps the default map still and applies shape, arrow, palette, and contrast", () => {
  const tree = mk(["R", [["a"], ["b"], ["c"], ["d"], ["e"]]]);
  const once = build(tree);
  const twice = build(tree, once);
  assert.equal(get(twice, nodeId("R", "R")).backgroundColor, ROOT_COLOR);
  assert.equal(get(twice, edgeId("R", "a")).endArrowhead, null);
  assert.equal(mmOf(get(twice, nodeId("R", "a"))).fillFrom, undefined);
  assert.equal(mmOf(get(twice, nodeId("R", "a"))).ink, undefined);
  assert.equal(mmOf(get(twice, edgeId("R", "a"))).conn, undefined);

  const withShape = (patch) => {
    const root = get(once, nodeId("R", "R"));
    const marked = once.map((e) => (e.id === root.id ? patchMarker(e, patch) : e));
    return build(tree, marked);
  };
  const ell = withShape({ nodeShape: "ellipse" });
  assert.equal(get(ell, nodeId("R", "a")).type, "ellipse");
  assert.equal(get(ell, edgeId("R", "a")).points.length, 2);

  const arrow = withShape({ connector: "arrow" });
  assert.equal(get(arrow, edgeId("R", "e")).endArrowhead, "arrow");
  assert.equal(mmOf(get(arrow, edgeId("R", "e"))).conn, "arrow");
  const rootArrow = get(arrow, nodeId("R", "R"));
  const cleared = build(tree, arrow.map((e) => (e.id === rootArrow.id ? patchMarker(e, { connector: undefined }) : e)));
  assert.equal(get(cleared, edgeId("R", "e")).endArrowhead, null);
  assert.equal(mmOf(get(cleared, edgeId("R", "e"))).conn, undefined);

  const ink = withShape({ palette: "ink" });
  assert.equal(get(ink, nodeId("R", "R")).backgroundColor, PALETTES.ink.root);
  assert.equal(get(ink, nodeId("R", "a")).backgroundColor, paletteFill("ink", 1, 0));
  assert.equal(mmOf(get(ink, nodeId("R", "a"))).fillFrom, "ink");

  const contrast = withShape({ palette: "ink", contrast: true });
  const dark = get(contrast, nodeId("R", "e"));
  assert.equal(dark.backgroundColor, "#495057");
  assert.equal(inkFor("#495057"), "#ffffff");
  assert.equal(inkFor("#ffffff"), "#1e1e1e");
  assert.equal(inkFor("nope"), "#1e1e1e");
  assert.equal(get(contrast, textId("R", "e")).strokeColor, "#ffffff");
  assert.equal(mmOf(dark).ink, "#ffffff");
});

test("parseIndent, crossPairs, and linkTarget follow the paste and overlay rules", () => {
  const ok = parseIndent("One\n  Two\n\nThree\n\tFour");
  assert.equal(ok.ok, true);
  assert.equal(ok.count, 4);
  assert.equal(ok.tree.children[0].text, "One");
  assert.equal(ok.tree.children[0].children[0].text, "Two");
  assert.equal(ok.tree.children[1].text, "Three");
  assert.equal(ok.tree.children[1].children[0].text, "Four");
  assert.equal(parseIndent("{{[[TODO]]}} ship").ok, true);
  assert.equal(parseIndent("  {{[[excalidraw]]}}").reason, "excluded");
  assert.equal(parseIndent("").reason, "empty");
  assert.equal(parseIndent("a\nb", 1).reason, "cap");

  const nodes = [
    { uid: "a", parent: "R", string: "see ((b)) and ((a))" },
    { uid: "b", parent: "R", string: "((R))" },
    { uid: "R", parent: null, string: "((a))" },
  ];
  assert.deepEqual(crossPairs(nodes), [{ from: "a", to: "b" }]);
  assert.equal(crossPairs(nodes, 0).length, 0);
  assert.equal(linkTarget("((uid_1)) and [[Page]]").uid, "uid_1");
  assert.equal(linkTarget("see [[Other Page]]").title, "Other Page");
  assert.equal(linkTarget("plain"), null);
});

test("stepSync records the first look and writes only the side that changed", () => {
  assert.equal(hasMarkup("item #2"), true);
  const first = stepSync(null, { caption: "Hello", text: "Hello" });
  assert.equal(first.action, "none");
  assert.deepEqual(first.next, { caption: "Hello", text: "Hello" });
  const wrote = stepSync(first.next, { caption: "Hello", text: "Next" });
  assert.equal(wrote.action, "write");
  assert.equal(wrote.caption, "Next");
  const painted = stepSync(first.next, { caption: "There", text: "Hello" });
  assert.equal(painted.action, "paint");
  assert.equal(painted.text, "There");
  const both = stepSync(first.next, { caption: "There", text: "Next" });
  assert.equal(both.action, "none");
  assert.equal(both.next, first.next);
  assert.equal(stepSync(null, { caption: "[[Hi]]", text: "Hi" }).action, "none");
  assert.equal(stepSync(first.next, { caption: "Hello", text: "" }).action, "none");
  assert.equal(stepSync(first.next, { caption: "", text: "Hello" }).action, "paint");
  assert.equal(stepSync(first.next, { caption: "Hello", text: "Next", editing: true }).next, first.next);
  const box = [0, 0, 100, 40];
  const text = { id: "t", type: "text", x: 10, y: 10, width: 20, height: 10, isDeleted: false };
  assert.equal(singleText([text, { ...text, id: "pmm-a" }], box).id, "t");
  assert.equal(singleText([text, { ...text, id: "u" }], box), null);
});

test("mind-map chrome places a plus and a dashed cross line", () => {
  const made = [];
  const el = () => {
    const node = {
      style: {}, className: "", children: [], attrs: {},
      setAttribute(k, v) { node.attrs[k] = v; },
      append(c) { node.children.push(c); },
      remove() {},
      querySelectorAll() { return node.children; },
      addEventListener(type, fn) { (node.listeners ||= []).push([type, fn]); },
    };
    made.push(node);
    return node;
  };
  const container = {
    children: [],
    append(n) { this.children.push(n); },
    getBoundingClientRect: () => ({ left: 5, top: 7 }),
  };
  const added = [];
  const chrome = installMmChrome({
    doc: { createElement: el, createElementNS: (_ns, tag) => Object.assign(el(), { tag }) },
    app: { state: { zoom: { value: 1 }, scrollX: 0, scrollY: 0, offsetLeft: 0, offsetTop: 0 } },
    containerEl: container,
    getModel: () => ({
      boxes: [{ uid: "a", root: "R", x: 10, y: 20, w: 40, h: 16, layout: "right", side: null, hidden: 2 }],
      nodes: [
        { uid: "a", parent: "R", string: "((b))", x: 30, y: 28 },
        { uid: "b", parent: "R", string: "leaf", x: 90, y: 28 },
      ],
    }),
    onAdd: (box) => added.push(box.uid),
  });
  chrome.refresh();
  const host = container.children[0];
  const plus = host.children.find((n) => n.className === "plexus-mm-plus");
  const badge = host.children.find((n) => n.className === "plexus-mm-badge");
  assert.equal(badge.textContent, "2");
  plus.listeners.find(([type]) => type === "click")[1]({ preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(added, ["a"]);
  const line = container.children[1].children[0];
  assert.equal(line.attrs.x1, "25");
  assert.equal(line.attrs.y1, "21");
  chrome.dispose();
});

test("region sync writes after the first look and does not loop when the write fails", async () => {
  let elements = [
    { id: "box", type: "rectangle", x: 0, y: 0, width: 200, height: 80, isDeleted: false },
    { id: "t1", type: "text", x: 20, y: 20, width: 40, height: 16, text: "Hello", originalText: "Hello", isDeleted: false },
  ];
  let onChange = null;
  const frames = [];
  const writes = [];
  const app = {
    state: { cursorButton: "up", zoom: { value: 1 }, scrollX: 0, scrollY: 0, offsetLeft: 0, offsetTop: 0, editingTextElement: null },
    scene: { getNonDeletedElements: () => elements },
    getSceneElementsIncludingDeleted: () => elements,
    updateScene(u) { elements = u.elements; },
    onChangeEmitter: { on(cb) { onChange = cb; return () => {}; } },
  };
  const regions = [{ uid: "reg1", region: { kind: "area", ids: ["box"], caption: "Hello", pad: 0 } }];
  installRegionSync({
    app,
    api: { data: { addPullWatch() {}, removePullWatch() {} } },
    drawingUid: "D",
    regionsOf: () => regions,
    nameRegion: async (uid, text) => { writes.push([uid, text]); return false; },
    requestFrame: (fn) => { frames.push(fn); return frames.length; },
    cancelFrame() {},
  });
  frames.shift()();
  assert.equal(writes.length, 0);
  elements = elements.map((e) => (e.id === "t1" ? { ...e, text: "Next", originalText: "Next" } : e));
  onChange();
  await frames.shift()();
  assert.deepEqual(writes, [["reg1", "Next"]]);
  onChange();
  await frames.shift()();
  assert.equal(writes.length, 1);
});

test("the outline prompt commits on Cmd+Enter and cancels on Escape", async () => {
  const body = { children: [], append(el) { this.children.push(el); } };
  const doc = {
    body,
    createElement() {
      const l = [];
      return {
        className: "", style: {}, value: "",
        addEventListener: (t, fn) => l.push([t, fn]),
        remove() { const i = body.children.indexOf(this); if (i >= 0) body.children.splice(i, 1); },
        focus() {},
        fire(t, ev) {
          const e = { stopPropagation() {}, preventDefault() {}, ...ev };
          for (const [tt, fn] of l) if (tt === t) fn(e);
        },
      };
    },
  };
  const pending = openOutlinePrompt({ doc, zIndex: 3 });
  const prompt = body.children[0];
  assert.match(prompt.className, /plexus-outline-prompt/);
  prompt.value = "One\nTwo";
  prompt.fire("keydown", { key: "Enter" });
  prompt.fire("keydown", { key: "Enter", metaKey: true });
  assert.equal(await pending, "One\nTwo");
  const cancel = openOutlinePrompt({ doc });
  body.children[0].fire("keydown", { key: "Escape" });
  assert.equal(await cancel, null);
});
