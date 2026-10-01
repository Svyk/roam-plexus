import assert from "node:assert/strict";
import test from "node:test";

import { createActions } from "../src/actions.js";
import { CAPTION_LINK_CAP, captionLinks } from "../src/model/links.js";
import { serializeRegion } from "../src/model/region.js";
import { commonBounds, regionSceneBBox, unrotatedFraction, unrotatedRectFraction } from "../src/model/scene.js";
import { STICKY_FILL, nextStampNumber, stackCopies, stampElements, stickyElements } from "../src/model/stamps.js";
import { createRegionRefRenderer } from "../src/view/regionref.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test("nextStampNumber is one more than the largest whole number already on the canvas", () => {
  assert.equal(nextStampNumber([]), 1);
  assert.equal(nextStampNumber(null), 1);
  const els = [
    { type: "text", text: "Note", originalText: "Note" },
    { type: "text", text: "01", originalText: "01" },
    { type: "text", text: "0", originalText: "0" },
    { type: "text", text: "1.5", originalText: "1.5" },
    { type: "text", text: "1", originalText: "12" },
    { type: "text", text: "3", originalText: " 3 " },
    { type: "text", text: "9", originalText: "9", isDeleted: true },
    { type: "rectangle", text: "8", originalText: "8" },
    { type: "text", text: "4", originalText: "9".repeat(20) },
    null,
  ];
  assert.equal(nextStampNumber(els), 13);
});

test("stickyElements is a yellow rounded rectangle with bound text Note", () => {
  let n = 0;
  const els = stickyElements({ x: 30, y: 40, newId: () => `s${n++}` });
  const box = els.find((el) => el.type === "rectangle");
  const text = els.find((el) => el.type === "text");
  assert.equal(box.backgroundColor, STICKY_FILL);
  assert.equal(box.fillStyle, "solid");
  assert.equal(box.strokeColor, "#1e1e1e");
  assert.equal(box.roughness, 0);
  assert.deepEqual(box.roundness, { type: 3 });
  assert.equal(box.x, 30);
  assert.equal(box.y, 40);
  assert.ok(box.width >= 200);
  assert.ok(box.height >= 140);
  assert.equal(text.originalText, "Note");
  assert.equal(text.containerId, box.id);
  assert.deepEqual(box.boundElements, [{ id: text.id, type: "text" }]);
});

test("stampElements writes the number as text", () => {
  const [text] = stampElements({ x: 5, y: 6, n: 4, newId: () => "stamp1" });
  assert.equal(text.type, "text");
  assert.equal(text.originalText, "4");
  assert.equal(text.x, 5);
  assert.equal(text.y, 6);
});

test("stackCopies places one copy underneath and drops arrows that leave the selection", () => {
  const rect = {
    id: "r1", type: "rectangle", x: 10, y: 20, width: 100, height: 40, angle: 0, version: 2,
    groupIds: ["gA"], frameId: "frame1", boundElements: [{ id: "t1", type: "text" }], isDeleted: false,
  };
  const text = {
    id: "t1", type: "text", x: 40, y: 30, width: 20, height: 12, angle: 0, containerId: "r1",
    text: "Hi", originalText: "Hi", version: 1, groupIds: ["gA"], isDeleted: false,
  };
  const other = { id: "r2", type: "rectangle", x: 10, y: 80, width: 40, height: 20, angle: 0, version: 1, isDeleted: false };
  const leaving = {
    id: "aOut", type: "arrow", x: 10, y: 20, width: 40, height: 10, angle: 0, version: 1, isDeleted: false,
    startBinding: { elementId: "r1", focus: 0, gap: 4 }, endBinding: { elementId: "gone", focus: 0, gap: 4 },
  };
  const inner = {
    id: "aIn", type: "arrow", x: 10, y: 60, width: 4, height: 10, angle: 0, version: 1, isDeleted: false,
    startBinding: { elementId: "r1", focus: 0, gap: 4 }, endBinding: { elementId: "r2", focus: 0, gap: 4 },
  };
  const free = {
    id: "aFree", type: "arrow", x: 12, y: 22, width: 30, height: 8, angle: 0, version: 4, isDeleted: false,
    startBinding: null, endBinding: null,
  };
  const elements = [rect, text, other, leaving, inner, free];
  let n = 0;
  const copies = stackCopies(elements, ["r1", "t1", "aOut", "aFree"], { newId: () => `c${n++}` });
  const keep = [rect, text, free];
  const dy = (commonBounds(keep)[3] - commonBounds(keep)[1]) + 16;
  const copyRect = copies.find((el) => el.type === "rectangle");
  const copyText = copies.find((el) => el.type === "text");
  const copyFree = copies.find((el) => el.type === "arrow");
  assert.equal(copies.length, 3);
  assert.equal(copyRect.y, rect.y + dy);
  assert.equal(copyText.y, text.y + dy);
  assert.equal(copyFree.y, free.y + dy);
  assert.notEqual(copyRect.id, rect.id);
  assert.equal(copyRect.frameId, "frame1");
  assert.equal(copyRect.version, 3);
  assert.equal(copyRect.groupIds.length, 1);
  assert.notEqual(copyRect.groupIds[0], "gA");
  assert.deepEqual(copyText.groupIds, copyRect.groupIds);
  assert.equal(copyText.containerId, copyRect.id);
  assert.deepEqual(copyRect.boundElements, [{ id: copyText.id, type: "text" }]);
  assert.equal(copyFree.startBinding, null);
  assert.equal(rect.y, 20);
  assert.equal(rect.boundElements[0].id, "t1");

  const alone = stackCopies(elements, ["r1"], { newId: () => `z${n++}` });
  assert.equal(alone.length, 1);
  assert.equal(alone[0].type, "rectangle");
  assert.deepEqual(alone[0].boundElements, []);

  let m = 0;
  const linked = stackCopies(elements, ["r1", "r2", "aIn"], { newId: () => `k${m++}` });
  const arrow = linked.find((el) => el.type === "arrow");
  const ids = new Set(linked.map((el) => el.id));
  assert.ok(ids.has(arrow.startBinding.elementId));
  assert.ok(ids.has(arrow.endBinding.elementId));
  assert.notEqual(arrow.startBinding.elementId, "r1");

  assert.equal(stackCopies(elements, ["aOut"], { newId: () => "x" }), null);
  assert.equal(stackCopies(elements, [], { newId: () => "x" }), null);
  assert.equal(stackCopies(elements, ["r1"], {}), null);
});

test("a rotated image maps fractions through its own box", () => {
  const el = { id: "img", type: "image", x: 0, y: 0, width: 200, height: 100, angle: Math.PI / 2 };
  const pin = unrotatedFraction(el, { x: 100, y: 150 });
  near(pin.x, 1);
  near(pin.y, 0.5);

  const angle = Math.PI / 4;
  const tilted = { x: 0, y: 0, width: 200, height: 100, angle };
  const cx = 100;
  const cy = 50;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = -10 - cx;
  const dy = 50 - cy;
  const outside = { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  assert.equal(unrotatedFraction(tilted, outside), null);
  const clamped = unrotatedFraction(tilted, outside, { clamp: true });
  assert.equal(clamped.x, 0);
  near(clamped.y, 0.5);

  const flat = { x: 0, y: 0, width: 200, height: 100, angle: 0 };
  const mid = unrotatedFraction(flat, { x: 100, y: 50 });
  near(mid.x, 0.5);
  near(mid.y, 0.5);
  assert.equal(unrotatedRectFraction(flat, { x: -50, y: -40 }, { x: -10, y: -5 }), null);

  const img = { id: "img", type: "image", x: 100, y: 200, width: 400, height: 200, angle: Math.PI / 2 };
  const quarter = regionSceneBBox({ kind: "rect", el: "img", f: [0, 0, 0.5, 0.5] }, [img]);
  quarter.bbox.forEach((v, i) => near(v, [300, 100, 400, 300][i]));
  assert.deepEqual(quarter.missing, []);
});

test("captionLinks keeps first-order block and page links only", () => {
  assert.deepEqual(captionLinks("See ((abcdefgh1)) and [[Other Page]]"), [
    { type: "block", uid: "abcdefgh1" },
    { type: "page", title: "Other Page" },
  ]);
  assert.deepEqual(captionLinks("[[Same]] ((abcdefgh1)) [[Same]] ((abcdefgh1))"), [
    { type: "page", title: "Same" },
    { type: "block", uid: "abcdefgh1" },
  ]);
  assert.deepEqual(captionLinks("#solo ((b00000001)) [[Kept]] #[[Dropped]]"), [
    { type: "block", uid: "b00000001" },
    { type: "page", title: "Kept" },
  ]);
  assert.deepEqual(captionLinks("{{((abcdefgh1))}} ((bbbbbbbbb))"), [
    { type: "block", uid: "bbbbbbbbb" },
  ]);
  const many = Array.from({ length: CAPTION_LINK_CAP + 1 }, (_, i) => `[[Page ${i}]]`).join(" ");
  const capped = captionLinks(many);
  assert.equal(capped.length, CAPTION_LINK_CAP);
  assert.equal(capped[0].title, "Page 0");
  assert.equal(capped.at(-1).title, `Page ${CAPTION_LINK_CAP - 1}`);
  assert.deepEqual(captionLinks(""), []);
  assert.deepEqual(captionLinks("plain words"), []);
});

function makeEl(tag) {
  const el = {
    tag,
    attrs: {},
    classes: new Set(),
    children: [],
    style: {},
    listeners: {},
    parentNode: null,
    isConnected: true,
    textContent: "",
    dataset: {},
    set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
    get className() { return [...this.classes].join(" "); },
    classList: {
      add: (c) => el.classes.add(c),
      remove: (c) => el.classes.delete(c),
      contains: (c) => el.classes.has(c),
    },
    getAttribute: (k) => el.attrs[k] ?? null,
    setAttribute: (k, v) => { el.attrs[k] = String(v); },
    removeAttribute: (k) => { delete el.attrs[k]; },
    addEventListener: (t, fn) => { el.listeners[t] = fn; },
    removeEventListener: (t, fn) => { if (el.listeners[t] === fn) delete el.listeners[t]; },
    closest: () => null,
    contains(t) {
      if (t === el) return true;
      return el.children.some((child) => child.contains?.(t));
    },
    getBoundingClientRect: () => ({ left: 12, top: 24, bottom: 48, width: 80, height: 24 }),
    focus() { el.focused = true; },
    append(...nodes) {
      for (const node of nodes) {
        el.children.push(node);
        node.parentNode = el;
      }
    },
    remove() {
      el.isConnected = false;
      const parent = el.parentNode;
      if (parent) {
        const at = parent.children.indexOf(el);
        if (at >= 0) parent.children.splice(at, 1);
        el.parentNode = null;
      }
    },
    insertBefore(node, ref) {
      const at = ref ? el.children.indexOf(ref) : el.children.length;
      el.children.splice(at < 0 ? el.children.length : at, 0, node);
      node.parentNode = el;
    },
  };
  return el;
}

function chooserDoc() {
  const doc = {
    body: null,
    listeners: [],
    createElement(tag) {
      if (tag === "canvas") return { width: 0, height: 0, getContext: () => ({ drawImage() {} }), toBlob: (cb) => cb({ size: 1 }) };
      return makeEl(tag);
    },
    addEventListener(type, fn, capture) { this.listeners.push({ type, fn, capture }); },
    removeEventListener(type, fn) {
      const at = this.listeners.findIndex((entry) => entry.type === type && entry.fn === fn);
      if (at >= 0) this.listeners.splice(at, 1);
    },
    querySelectorAll: () => [],
  };
  doc.body = makeEl("body");
  return doc;
}

function fireDoc(doc, type, event) {
  for (const entry of [...doc.listeners]) if (entry.type === type) entry.fn(event);
}

const elements = [
  { id: "rect-a", type: "rectangle", x: 100, y: 100, width: 220, height: 140, angle: 0, isDeleted: false },
];

function regionCard(caption) {
  const regionString = serializeRegion({
    kind: "area", drawingUid: "drw000001", ids: ["rect-a"], pad: 10, caption,
  });
  const doc = chooserDoc();
  const parent = makeEl("p");
  const btn = makeEl("button");
  parent.append(btn);
  const opened = [];
  const api = {
    ui: {
      mainWindow: {
        openBlock: (arg) => opened.push(["block", arg]),
        openPage: (arg) => opened.push(["page", arg]),
      },
      rightSidebar: { addWindow() {} },
    },
    data: { pull: () => null },
  };
  const calls = [];
  const host = {
    blockUidFromNode: () => "reg000001",
    pullBlock: (uid) => {
      if (uid === "reg000001") return { uid, string: regionString, children: [] };
      if (uid === "abcdefgh1") return { uid, string: "Target line" };
      return null;
    },
    drawing: () => ({ uid: "drw000001", elements, hash: "abcd1234" }),
  };
  const cache = {
    peek: (key) => (String(key).endsWith("|svg") ? { url: "blob:x", w: 10, h: 10, type: "image/svg+xml" } : null),
    get: async () => null,
    put: async () => {},
    delete: async () => {},
  };
  const r = createRegionRefRenderer({
    host,
    cache,
    cold: { renderDrawing: async () => null },
    getSettings: () => ({ figureHeight: 360, openInSidebar: false }),
    onOpen: (uid, opts) => calls.push([uid, opts]),
    doc,
    api,
  });
  r.claim(btn);
  return { r, doc, root: parent.children[1], calls, opened };
}

const click = (el, extra = {}) => {
  const event = { shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, stopPropagation() {}, preventDefault() { event.prevented = true; }, ...extra };
  el.listeners.click(event);
  return event;
};

test("two caption links open a chooser and one link still opens the region", () => {
  const many = regionCard("See ((abcdefgh1)) and [[Other Page]]");
  const event = click(many.root);
  assert.equal(event.prevented, true);
  assert.deepEqual(many.calls, []);
  const chooser = many.doc.body.children.find((el) => el.className.includes("plexus-token-chooser"));
  assert.ok(chooser);
  assert.equal(chooser.children.length, 2);
  assert.equal(chooser.children[0].children[0].textContent, "Target line");
  assert.equal(chooser.children[1].children[0].textContent, "Other Page");
  const inner = chooser.children[0].children[0];
  fireDoc(many.doc, "pointerdown", { target: inner });
  assert.equal(chooser.isConnected, true);
  chooser.children[0].listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(many.opened, [["block", { block: { uid: "abcdefgh1" } }]]);
  assert.equal(chooser.isConnected, false);
  assert.deepEqual(many.calls, []);

  const page = regionCard("See ((abcdefgh1)) and [[Other Page]]");
  click(page.root);
  const rows = page.doc.body.children[0].children;
  rows[1].listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(page.opened, [["page", { page: { title: "Other Page" } }]]);

  const one = regionCard("Only ((abcdefgh1))");
  click(one.root);
  assert.deepEqual(one.calls, [["reg000001", { sidebar: false }]]);
  assert.equal(one.doc.body.children.length, 0);
});

test("a caption that gains a second link after the card is drawn opens the chooser", () => {
  let caption = "Only ((abcdefgh1))";
  const doc = chooserDoc();
  const parent = makeEl("p");
  const btn = makeEl("button");
  parent.append(btn);
  const calls = [];
  const host = {
    blockUidFromNode: () => "reg000001",
    pullBlock: (uid) => (uid === "reg000001"
      ? { uid, string: serializeRegion({ kind: "area", drawingUid: "drw000001", ids: ["rect-a"], pad: 10, caption }), children: [] }
      : { uid, string: "Target line" }),
    drawing: () => ({ uid: "drw000001", elements, hash: "abcd1234" }),
  };
  const r = createRegionRefRenderer({
    host,
    cache: { peek: () => ({ url: "blob:x", w: 10, h: 10, type: "image/svg+xml" }), get: async () => null, put: async () => {}, delete: async () => {} },
    cold: { renderDrawing: async () => null },
    getSettings: () => ({ figureHeight: 360, openInSidebar: false }),
    onOpen: (uid, opts) => calls.push([uid, opts]),
    doc,
    api: { ui: { mainWindow: { openBlock() {}, openPage() {} }, rightSidebar: { addWindow() {} } }, data: { pull: () => null } },
  });
  r.claim(btn);
  caption = "See ((abcdefgh1)) and [[Other Page]]";
  click(parent.children[1]);
  assert.deepEqual(calls, []);
  const chooser = doc.body.children.find((el) => el.className.includes("plexus-token-chooser"));
  assert.ok(chooser);
  assert.equal(chooser.children.length, 2);
});

test("Escape cancels the chooser and shift still opens the region", () => {
  const card = regionCard("See ((abcdefgh1)) and [[Other Page]]");
  card.root.listeners.keydown({ key: "Enter", shiftKey: false, preventDefault() {}, stopPropagation() {} });
  const chooser = card.doc.body.children[0];
  assert.match(chooser.className, /plexus-token-chooser/);
  fireDoc(card.doc, "keydown", { key: "Escape", stopPropagation() {} });
  assert.equal(chooser.isConnected, false);
  assert.deepEqual(card.calls, []);

  const again = regionCard("See ((abcdefgh1)) and [[Other Page]]");
  click(again.root);
  assert.equal(again.doc.body.children.length, 1);
  again.r.releaseAll();
  assert.equal(again.doc.body.children.length, 0);

  const shifted = regionCard("See ((abcdefgh1)) and [[Other Page]]");
  click(shifted.root, { shiftKey: true });
  assert.deepEqual(shifted.calls, [["reg000001", { sidebar: true }]]);
  assert.equal(shifted.doc.body.children.length, 0);

  const modified = regionCard("See ((abcdefgh1)) and [[Other Page]]");
  const ctrl = click(modified.root, { ctrlKey: true });
  assert.equal(ctrl.prevented, undefined);
  assert.deepEqual(modified.calls, []);
  assert.equal(modified.doc.body.children.length, 0);
  fireDoc(modified.doc, "pointerdown", { target: makeEl("div") });
});

test("an alias with two caption links opens the chooser and a modified click stays with Roam", () => {
  const regionString = serializeRegion({
    kind: "area", drawingUid: "drw000001", ids: ["rect-a"], pad: 10,
    caption: "See ((abcdefgh1)) and [[Other Page]]",
  });
  const doc = chooserDoc();
  const calls = [];
  const host = {
    blockUidFromNode: () => "reg000001",
    pullBlock: (uid) => (uid === "reg000001" ? { uid, string: regionString, children: [] } : { uid, string: "Target line" }),
    drawing: () => ({ uid: "drw000001", elements, hash: "abcd1234" }),
  };
  const r = createRegionRefRenderer({
    host,
    cache: { peek: () => null, get: async () => null, put: async () => {}, delete: async () => {} },
    cold: { renderDrawing: async () => null },
    getSettings: () => ({ openInSidebar: false }),
    onOpen: (uid, opts) => calls.push([uid, opts]),
    doc,
    api: { ui: { mainWindow: { openBlock() {}, openPage() {} }, rightSidebar: { addWindow() {} } }, data: { pull: () => null } },
  });
  const anchor = makeEl("a");
  anchor.classList.add("rm-alias--block");
  anchor.dataset.linkUid = "reg000001";
  r.claimAlias(anchor);
  const event = click(anchor);
  assert.equal(event.prevented, true);
  assert.deepEqual(calls, []);
  assert.match(doc.body.children[0].className, /plexus-token-chooser/);
  const shift = click(anchor, { shiftKey: true });
  assert.equal(shift.prevented, undefined);
  assert.deepEqual(calls, []);
});

function sceneApp(elements) {
  let scene = elements.map((el) => ({ ...el }));
  const writes = [];
  const app = {
    state: { width: 800, height: 600, offsetLeft: 0, offsetTop: 0, zoom: { value: 1 }, scrollX: 0, scrollY: 0 },
    getSceneElements: () => scene.filter((el) => el && !el.isDeleted),
    getSceneElementsIncludingDeleted: () => scene,
    updateScene(patch) {
      writes.push(patch);
      if (Array.isArray(patch.elements)) scene = patch.elements;
    },
  };
  return { app, writes };
}

function actionHarness({ elements = [], ids = [], editor } = {}) {
  const { app, writes } = sceneApp(elements);
  const toasts = [];
  const actions = createActions({
    host: {
      createRegion: async () => "reg000001",
      drawing: () => ({ hash: "abcd1234" }),
      pullBlock: () => null,
      openBlock: async () => {},
      regionsOf: () => [],
    },
    native: {
      activeEditor: () => (editor === undefined ? { app, drawingUid: "drw000001" } : editor),
      selectedElementIds: () => ids,
    },
    cache: { put: async () => {} },
    cold: {},
    toaster: { show: (message, opts) => toasts.push([message, opts]) },
    spotlight: () => () => {},
    getSettings: () => ({}),
    doc: {},
    clipboard: { writeText: async () => {} },
  });
  return { actions, writes, toasts };
}

test("sticky, number stamp, and stack write through the drawing commands", async () => {
  const sticky = actionHarness();
  const stickyId = await sticky.actions.stickyNote();
  assert.equal(sticky.writes.length, 1);
  assert.equal(sticky.writes[0].captureUpdate, "IMMEDIATELY");
  const added = sticky.writes[0].elements;
  const box = added.find((el) => el.type === "rectangle");
  const note = added.find((el) => el.type === "text");
  assert.equal(box.id, stickyId);
  assert.equal(box.backgroundColor, STICKY_FILL);
  assert.equal(box.x, 300);
  assert.equal(box.y, 230);
  assert.equal(note.originalText, "Note");
  assert.equal(note.containerId, box.id);
  assert.equal(sticky.writes[0].appState.selectedElementIds[box.id], true);
  assert.equal(sticky.writes[0].appState.selectedElementIds[note.id], undefined);

  const stamp = actionHarness({
    elements: [
      { id: "n1", type: "text", x: 0, y: 0, width: 10, height: 10, text: "12", originalText: "12", isDeleted: false },
      { id: "n2", type: "text", x: 0, y: 20, width: 10, height: 10, text: "3", originalText: "3", isDeleted: false },
    ],
  });
  const stampId = await stamp.actions.numberStamp();
  assert.equal(stamp.toasts.at(-1)[0], "13");
  const stamped = stamp.writes[0].elements.find((el) => el.id === stampId);
  assert.equal(stamped.originalText, "13");
  assert.equal(stamped.x, 400);
  assert.equal(stamped.y, 300);

  const closed = actionHarness({ editor: null });
  assert.equal(await closed.actions.numberStamp(), null);
  assert.equal(closed.toasts.at(-1)[0], "Open a drawing full-screen first");
  assert.equal(closed.writes.length, 0);

  const empty = actionHarness({ ids: [] });
  assert.equal(await empty.actions.stackSelection(), null);
  assert.equal(empty.toasts.at(-1)[0], "Select something first");
  assert.equal(empty.writes.length, 0);

  const rect = { id: "r1", type: "rectangle", x: 10, y: 20, width: 80, height: 40, angle: 0, version: 1, isDeleted: false };
  const leaving = {
    id: "aOut", type: "arrow", x: 10, y: 20, width: 20, height: 10, angle: 0, version: 1, isDeleted: false,
    startBinding: { elementId: "r1" }, endBinding: { elementId: "gone" },
  };
  const onlyArrow = actionHarness({ elements: [rect, leaving], ids: ["aOut"] });
  assert.equal(await onlyArrow.actions.stackSelection(), null);
  assert.equal(onlyArrow.toasts.at(-1)[0], "Nothing to stack");

  const stacked = actionHarness({ elements: [rect], ids: ["r1"] });
  const ids = await stacked.actions.stackSelection();
  assert.equal(stacked.writes[0].captureUpdate, "IMMEDIATELY");
  const copy = stacked.writes[0].elements.find((el) => el.id === ids[0]);
  assert.equal(copy.type, "rectangle");
  assert.equal(copy.y, rect.y + 40 + 16);
  assert.notEqual(copy.id, "r1");
  assert.equal(stacked.writes[0].elements.some((el) => el.id === "r1"), true);
});
