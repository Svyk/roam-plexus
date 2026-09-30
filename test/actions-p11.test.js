import assert from "node:assert/strict";
import test from "node:test";

import { createActions } from "../src/actions.js";
import { makeEmbedAnchor, embedLabel } from "../src/model/embeds.js";
import { serializeRegion } from "../src/model/region.js";
import { orderFrames } from "../src/model/slides.js";

const UID = "drw000001";
const svg = '<svg viewBox="0 0 100 60" width="100" height="60"></svg>';

const fr = (id, name, x, y, extra = {}) => ({ id, type: "frame", name, x, y, width: 100, height: 60, angle: 0, isDeleted: false, version: 1, customData: extra.order == null ? undefined : { plexus: { order: extra.order } }, ...extra.el });

function pngBlob(w, h) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, w);
  view.setUint32(20, h);
  return new Blob([bytes], { type: "image/png" });
}

function make(over = {}) {
  const toasts = [];
  const writes = [];
  const opened = [];
  const notices = [];
  const setSlides = [];
  const timers = [];
  const created = [];
  const urlsMade = [];
  const urlsRevoked = [];
  const kitCalls = [];
  const captured = [];
  let closeCb = null;
  const state = { elements: over.elements || [], ids: over.ids || [] };
  const app = {
    state: { width: 1000, height: 600, scrollX: 0, scrollY: 0, zoom: { value: 1 }, offsetLeft: 0, offsetTop: 0, ...(over.appState || {}) },
    getSceneElements: () => state.elements,
    getSceneElementsIncludingDeleted: () => state.elements,
    updateScene: (o) => { if (o.elements) state.elements = o.elements; },
    scrollToContent: (...a) => (over.scrolled || []).push(a),
    actionManager: { actions: { wrapSelectionInFrame: {} }, executeAction: () => over.onWrap?.(state) },
  };
  if (over.action === null) delete app.actionManager;
  const editor = over.editor === undefined ? { app, drawingUid: UID } : over.editor;
  const store = new Map();
  const drawingEls = over.savedElements || state.elements;
  const pulls = over.pulls || {};
  const presenter = {
    open: (o) => {
      opened.push(o);
      closeCb = o.onClose;
      return { isOpen: () => !over.closed, setSlide: (i, p) => { setSlides.push([i, p.url, !!p.error]); if (over.closeAfterFirst) over.closed = true; }, notice: (t) => notices.push(t) };
    },
  };
  const actions = createActions({
    host: {
      createRegion: async (d, s) => { created.push(["region", d, s]); return "reg000009"; },
      createBlock: async (o) => { if (over.failCreate) throw new Error("boom"); created.push(["block", o]); return "blk000009"; },
      regionsOf: over.regionsOf ?? (() => []),
      pullBlock: (uid) => pulls[uid] ?? null,
      drawing: () => ({ hash: "h1", elements: drawingEls, appState: {} }),
      pullEmbedContent: over.pull || (() => ({ kind: "block", uid: "abcdefghi", title: "P", string: "hello" })),
      labelSource: () => ({ string: "My drawing", pageTitle: null }),
      openBlock: async (uid, o) => { created.push(["open", uid, o]); },
    },
    native: {
      activeEditor: () => editor,
      selectedElementIds: () => state.ids,
      captureSelectionSvg: async (a, ids) => { captured.push(ids[0]); return over.svgFor ? over.svgFor(ids[0]) : svg; },
      captureSelectionPng: over.png ? async (a, ids, o) => { captured.push(["png", ids[0], o]); return over.png(ids[0]); } : undefined,
      waitNotLoading: async () => {},
    },
    cache: {
      put: async (k) => { store.set(k, { url: `blob:${k}` }); },
      peek: (k) => (over.anyCache ? { url: `blob:${k}` } : store.get(k) || null),
      get: async (k) => store.get(k) || null,
    },
    cold: over.cold || {},
    toaster: { show: (m, o) => toasts.push([m, o]) },
    spotlight: () => {},
    getSettings: () => over.settings || {},
    doc: {},
    clipboard: {},
    api: { util: { dateToPageTitle: () => "today" } },
    presenter,
    guard: {
      guardedWrite: (a, opts) => {
        writes.push(opts);
        if (over.refuse) return false;
        state.elements = opts.next(state.elements);
        return true;
      },
    },
    frame: async () => {},
    setTimer: (fn, ms) => { const rec = { ms, live: true, fn: () => { rec.live = false; fn(); } }; timers.push(rec); return timers.length - 1; },
    clearTimer: (id) => { if (timers[id]) timers[id].live = false; },
    getEmbedOverlay: () => (over.overlayState ? { editState: () => over.overlayState } : null),
    urls: { createObjectURL: (b) => { const u = `own:${urlsMade.length}`; urlsMade.push([u, b]); return u; }, revokeObjectURL: (u) => urlsRevoked.push(u) },
    fetchBlob: async () => { over.fetches?.push(1); return pngBlob(10, 10); },
    printKit: over.printKit ?? {
      printPages: (o) => { kitCalls.push(["print", o]); return { done: Promise.resolve(), dispose() {} }; },
      downloadPngs: (o) => { kitCalls.push(["png", o]); return { done: Promise.resolve(), dispose() {} }; },
    },
    emit: () => {},
  });
  return { actions, app, state, toasts, writes, opened, notices, setSlides, timers, created, urlsMade, urlsRevoked, kitCalls, captured, store, close: () => closeCb?.() };
}

const anchorScene = (label = "old", extra = {}) => {
  const [rect, text] = makeEmbedAnchor({ ref: "((abcdefghi))", label, x: 0, y: 0, width: 360, height: 200 });
  return [{ ...rect, ...extra.rect }, { ...text, ...extra.text }];
};

// ---- EMB-6 ----

test("refreshEmbedLabels rewrites only a differing label, in one NEVER write, container untouched", () => {
  const els = anchorScene("old");
  const t = make({ elements: els });
  assert.equal(t.actions.refreshEmbedLabels(t.app), 1);
  assert.equal(t.writes.length, 1);
  assert.equal(t.writes[0].captureUpdate, "NEVER");
  const [rect, text] = t.state.elements;
  assert.equal(rect, els[0]);
  assert.equal(text.originalText, "hello");
  assert.equal(text.text, "hello");
  assert.equal(text.version, els[1].version + 1);
  assert.notEqual(text.versionNonce, els[1].versionNonce);
  assert.equal(t.actions.refreshEmbedLabels(t.app), 0);
  assert.equal(t.writes.length, 1);
});

test("refreshEmbedLabels does not rewrite a stored label whose 80-char cut ended in a space", () => {
  const string = "w".repeat(79) + " tail...";
  const els = anchorScene(embedLabel(string));
  const t = make({ elements: els, pull: () => ({ kind: "block", uid: "abcdefghi", title: "P", string }) });
  assert.equal(t.actions.refreshEmbedLabels(t.app), 0);
  assert.equal(t.actions.refreshEmbedLabels(t.app), 0);
  assert.equal(t.writes.length, 0);
});

test("refreshEmbedLabels skips today, null pulls, empty labels, a matching originalText and unbound anchors", () => {
  const today = anchorScene("Today", { rect: { customData: { plexus: { embed: "plexus:today" } } } });
  const t1 = make({ elements: today });
  assert.equal(t1.actions.refreshEmbedLabels(t1.app), 0);
  const t2 = make({ elements: anchorScene("old"), pull: () => null });
  assert.equal(t2.actions.refreshEmbedLabels(t2.app), 0);
  const t3 = make({ elements: anchorScene("Note"), pull: () => ({ kind: "block", uid: "abcdefghi", string: "" }) });
  assert.equal(t3.actions.refreshEmbedLabels(t3.app), 0);
  const t4 = make({ elements: anchorScene("hello", { text: { text: "wrapped copy" } }) });
  assert.equal(t4.actions.refreshEmbedLabels(t4.app), 0);
  const [rect, text] = anchorScene("old");
  const t5 = make({ elements: [{ ...rect, boundElements: [] }, text] });
  assert.equal(t5.actions.refreshEmbedLabels(t5.app), 0);
  const t6 = make({ elements: [rect, { ...text, isDeleted: true }] });
  assert.equal(t6.actions.refreshEmbedLabels(t6.app), 0);
  assert.equal([t1, t2, t3, t4, t5, t6].reduce((n, t) => n + t.writes.length, 0), 0);
});

test("refresh compares against the whole-string creation label, not the first line", () => {
  const t = make({ elements: anchorScene("line one line two"), pull: () => ({ kind: "block", uid: "abcdefghi", string: "line one\nline two" }) });
  assert.equal(t.actions.refreshEmbedLabels(t.app), 0);
});

test("refreshEmbedLabels does nothing when the app is not the active editor", () => {
  const t = make({ elements: anchorScene("old"), editor: null });
  assert.equal(t.actions.refreshEmbedLabels(t.app), 0);
});

test("scheduleEmbedLabels debounces 1500 ms and re-arms after 1 s while a pointer is down", async () => {
  const t = make({ elements: anchorScene("old") });
  t.actions.scheduleEmbedLabels(t.app);
  t.actions.scheduleEmbedLabels(t.app);
  assert.equal(t.timers.filter((x) => x.live).length, 1);
  assert.equal(t.timers.at(-1).ms, 1500);
  t.app.state.cursorButton = "down";
  t.timers.at(-1).fn();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(t.writes.length, 0);
  assert.equal(t.timers.at(-1).ms, 1000);
  t.app.state.cursorButton = "up";
  t.timers.at(-1).fn();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(t.writes.length, 1);
});

test("scheduleEmbedLabels re-arms while the overlay is editing; cancel and dispose clear the timer", async () => {
  const t = make({ elements: anchorScene("old"), overlayState: "editing" });
  t.actions.scheduleEmbedLabels(t.app);
  t.timers.at(-1).fn();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(t.writes.length, 0);
  assert.equal(t.timers.at(-1).ms, 1000);
  t.actions.cancelDrawingTool();
  assert.equal(t.timers.filter((x) => x.live).length, 0);
  const d = make({ elements: anchorScene("old") });
  d.actions.scheduleEmbedLabels(d.app);
  d.actions.dispose();
  assert.equal(d.timers.filter((x) => x.live).length, 0);
});

// ---- frames ----

test("addFrame: one IMMEDIATELY write, valid id, order rewrite of existing frames, selected", () => {
  const t = make({ elements: [fr("a", "B", 0, 0), fr("b", "A", 0, 100, { order: 1 })] });
  const id = t.actions.addFrame({ preset: "16:9" });
  assert.equal(t.writes.length, 1);
  assert.equal(t.writes[0].captureUpdate, "IMMEDIATELY");
  assert.deepEqual(t.writes[0].appState.selectedElementIds, { [id]: true });
  assert.ok(id.startsWith("plexus-frame-"));
  const els = t.state.elements;
  assert.equal(els.at(-1).id, id);
  assert.equal(els.at(-1).customData.plexus.order, 3);
  assert.deepEqual(orderFrames(els).map((f) => f.id), ["b", "a", id]);
  assert.equal(els[0].version, 2);
  assert.equal(els.at(-1).x, 500 - 427);
});

test("addFrame next placement sits right of the rightmost frame and scrolls (no zoom) when out of view", () => {
  const scrolled = [];
  const t = make({ elements: [fr("a", "A", 0, 10, { order: 1 })], scrolled });
  t.actions.addFrame({ preset: "4:3", placement: "next" });
  const f = t.state.elements.at(-1);
  assert.equal(f.x, 140);
  assert.equal(f.y, 10);
  assert.equal(scrolled.length, 1);
  assert.equal(scrolled[0][1].fitToContent, false);
});

test("addFrameLayout writes four frames once, orders continue", () => {
  const t = make({ elements: [] });
  const ids = t.actions.addFrameLayout({ kind: "grid", preset: "16:9" });
  assert.equal(ids.length, 4);
  assert.equal(t.writes.length, 1);
  assert.deepEqual(t.state.elements.map((f) => f.customData.plexus.order), [1, 2, 3, 4]);
  assert.equal(t.actions.addFrameLayout({ kind: "nope" }), null);
});

test("frame actions need an editor", () => {
  const t = make({ editor: null });
  assert.equal(t.actions.addFrame({}), null);
  assert.equal(t.actions.selectedFrameId(), null);
  assert.match(t.toasts[0][0], /Open a drawing/);
});

test("reformatFrame resizes about the centre and releases children left outside", () => {
  const frame = fr("f", "S", 0, 0, { order: 1, el: { width: 200, height: 200 } });
  const inside = { id: "i", type: "rectangle", x: 100, y: 100, width: 10, height: 10, frameId: "f", isDeleted: false, version: 1 };
  const far = { id: "o", type: "rectangle", x: 9000, y: 9000, width: 10, height: 10, frameId: "f", isDeleted: false, version: 1 };
  const t = make({ elements: [frame, inside, far], ids: ["f"] });
  assert.equal(t.actions.selectedFrameId(), "f");
  assert.equal(t.actions.reformatFrame({ preset: "16:9" }), "f");
  const [f, i, o] = t.state.elements;
  assert.equal(f.width, 854);
  assert.equal(f.x, 100 - 427);
  assert.equal(f.name, "S");
  assert.deepEqual(f.customData, { plexus: { order: 1 } });
  assert.equal(i.frameId, "f");
  assert.equal(o.frameId, null);
  assert.equal(o.version, 2);
  assert.equal(t.toasts.at(-1)[0], "1 element left the frame");
  const none = make({ elements: [inside], ids: ["i"] });
  assert.equal(none.actions.reformatFrame({}), null);
});

test("makeSlide: predicate first, then wrapSelectionInFrame, then a named slide with order in one write", () => {
  const a = { id: "a", type: "rectangle", x: 0, y: 0, width: 10, height: 10, frameId: null, isDeleted: false, version: 1 };
  const bad = make({ elements: [a, fr("f", "F", 0, 0)], ids: ["f"] });
  assert.equal(bad.actions.makeSlide(), null);
  assert.equal(bad.toasts.at(-1)[0], "Select elements that are not frames");
  const empty = make({ elements: [a], ids: [] });
  assert.equal(empty.actions.makeSlide(), null);
  const t = make({
    elements: [a], ids: ["a"],
    onWrap: (state) => { state.elements = [...state.elements.map((e) => ({ ...e, frameId: "wrapped" })), { ...fr("wrapped", null, -16, -16), width: 42, height: 42 }]; },
  });
  assert.equal(t.actions.makeSlide(), "wrapped");
  assert.equal(t.writes.length, 1);
  assert.equal(t.writes[0].captureUpdate, "IMMEDIATELY");
  assert.deepEqual(t.writes[0].appState.selectedElementIds, { wrapped: true });
  const f = t.state.elements.find((e) => e.id === "wrapped");
  assert.equal(f.name, "Slide 1");
  assert.equal(f.customData.plexus.order, 1);
  assert.equal(f.width, 42);
  assert.equal(t.state.elements[0].frameId, "wrapped");
});

test("makeSlide fallback (no action) frames the selection plus 16 and adopts it in one write", () => {
  const a = { id: "a", type: "rectangle", x: 10, y: 20, width: 100, height: 50, angle: 0, frameId: null, isDeleted: false, version: 1 };
  const label = { id: "b", type: "text", x: 12, y: 22, width: 10, height: 10, angle: 0, containerId: "a", frameId: null, isDeleted: false, version: 1 };
  const t = make({ elements: [a, label], ids: ["a"], action: null });
  const id = t.actions.makeSlide();
  assert.equal(t.writes.length, 1);
  const f = t.state.elements.find((e) => e.id === id);
  assert.deepEqual([f.x, f.y, f.width, f.height], [-6, 4, 132, 82]);
  assert.equal(f.name, "Slide 1");
  assert.equal(t.state.elements[0].frameId, id);
  assert.equal(t.state.elements[1].frameId, id);
});

test("makeSlide with the action present but no new frame fails instead of adding a second frame", () => {
  const a = { id: "a", type: "rectangle", x: 0, y: 0, width: 10, height: 10, frameId: null, isDeleted: false, version: 1 };
  const t = make({ elements: [a], ids: ["a"] });
  assert.equal(t.actions.makeSlide(), null);
  assert.equal(t.writes.length, 0);
});

// ---- PRES-2 ----

const deck = () => [fr("f1", "One", 0, 0, { order: 1 }), fr("f2", "Two", 200, 0, { order: 2 }), fr("f3", "Three", 400, 0, { order: 3 })];

test("presentDrawing from a frame id starts there and fills from the start index, then the earlier slides", async () => {
  const t = make({ elements: deck() });
  await t.actions.presentDrawing({ drawingUid: UID, from: "f2" });
  assert.equal(t.opened[0].index, 1);
  assert.deepEqual(t.captured, ["f2", "f3", "f1"]);
  assert.deepEqual(t.setSlides.map(([i]) => i), [1, 2, 0]);
  assert.equal(t.opened[0].laser.color, "#e03131");
});

test("presentDrawing from an unknown frame starts at 0 with a notice, never a toast", async () => {
  const t = make({ elements: deck() });
  await t.actions.presentDrawing({ drawingUid: UID, from: "gone" });
  assert.equal(t.opened[0].index, 0);
  assert.equal(t.notices.length, 1);
  assert.equal(t.toasts.length, 0);
});

test("presentDrawing here: frame at the point, else the selected frame, else nearest to the view centre", async () => {
  const at = make({ elements: deck() });
  await at.actions.presentDrawing({ drawingUid: UID, from: "here", at: { x: 250, y: 30 } });
  assert.equal(at.opened[0].index, 1);
  const sel = make({ elements: deck(), ids: ["f3"] });
  await sel.actions.presentDrawing({ drawingUid: UID, from: "here", at: { x: -900, y: -900 } });
  assert.equal(sel.opened[0].index, 2);
  const near = make({ elements: deck(), appState: { scrollX: -390, width: 20, height: 20 } });
  await near.actions.presentDrawing({ drawingUid: UID, from: "here" });
  assert.equal(near.opened[0].index, 2);
});

test("presentDrawing here with the drawing unmounted starts at 0", async () => {
  const t = make({ elements: deck(), editor: null, savedElements: deck(), cold: { renderDrawing: async () => null } });
  await t.actions.presentDrawing({ drawingUid: UID, from: "here", at: { x: 250, y: 30 } });
  assert.equal(t.opened[0].index, 0);
  assert.ok(t.setSlides.every(([, , e]) => e));
  assert.deepEqual(t.notices, ["Could not render this drawing"]);
});

test("a hot capture that returns null marks the slide as an error", async () => {
  const t = make({ elements: deck(), svgFor: (id) => (id === "f2" ? null : svg) });
  await t.actions.presentDrawing({ drawingUid: UID });
  assert.deepEqual(t.setSlides.filter(([, , e]) => e).map(([i]) => i), [1]);
});

test("slides carry notes: cframe before frame, first with children, onAdd only when empty", async () => {
  const regions = [
    { uid: "rgnfrm001", region: { supported: true, kind: "frame", frameId: "f1" } },
    { uid: "rgncfr001", region: { supported: true, kind: "cframe", frameId: "f1" } },
    { uid: "rgncfr002", region: { supported: true, kind: "cframe", frameId: "f2" } },
  ];
  const t = make({ elements: deck(), regionsOf: () => regions, pulls: { rgnfrm001: { children: [{ uid: "k" }] }, rgncfr002: { children: [] } } });
  await t.actions.presentDrawing({ drawingUid: UID });
  const [s1, s2, s3] = t.opened[0].slides.map((s) => s.notes);
  assert.equal(s1.rootUid, "rgnfrm001");
  assert.equal(s1.onAdd, undefined);
  assert.equal(s2.rootUid, "rgncfr002");
  assert.equal(typeof s2.onAdd, "function");
  assert.equal(s3.rootUid, null);
  assert.equal(typeof s3.onAdd, "function");
});

test("Add notes is toast-free and follows up on close with a toast when an editor is mounted", async () => {
  const t = make({ elements: deck() });
  await t.actions.presentDrawing({ drawingUid: UID });
  const r = await t.opened[0].slides[2].notes.onAdd();
  assert.deepEqual(r, { regionUid: "reg000009", childUid: "blk000009" });
  assert.equal(t.created[0][2], serializeRegion({ kind: "cframe", drawingUid: UID, frameId: "f3", caption: "Three" }));
  assert.equal(t.created[1][1].parentUid, "reg000009");
  assert.equal(t.toasts.length, 0);
  t.close();
  assert.equal(t.toasts.at(-1)[0], "Notes added: Outline › regions");
});

test("Add notes with no editor mounted opens the region in the sidebar on close", async () => {
  const t = make({ elements: deck(), editor: null, savedElements: deck() });
  await t.actions.presentDrawing({ drawingUid: UID });
  await t.opened[0].slides[0].notes.onAdd();
  t.close();
  assert.deepEqual(t.created.at(-1), ["open", "reg000009", { sidebar: true }]);
});

test("Add notes reuses an existing childless frame region and never duplicates it", async () => {
  const regions = [{ uid: "rgncfr001", region: { supported: true, kind: "cframe", frameId: "f1" } }];
  const t = make({ elements: deck(), regionsOf: () => regions, pulls: { rgncfr001: { children: [] } } });
  await t.actions.presentDrawing({ drawingUid: UID });
  const r = await t.opened[0].slides[0].notes.onAdd();
  assert.equal(r.regionUid, "rgncfr001");
  assert.equal(t.created.filter(([k]) => k === "region").length, 0);
});

test("presentFromRegion starts at the region's frame; other regions toast", async () => {
  const pulls = {
    rgncfr001: { string: serializeRegion({ kind: "cframe", drawingUid: UID, frameId: "f3", caption: "" }) },
    rgnarea01: { string: serializeRegion({ kind: "area", drawingUid: UID, ids: ["x"], caption: "" }) },
  };
  const t = make({ elements: deck(), pulls });
  await t.actions.presentFromRegion("rgncfr001");
  assert.equal(t.opened[0].index, 2);
  const bad = make({ elements: deck(), pulls });
  assert.equal(await bad.actions.presentFromRegion("rgnarea01"), null);
  assert.equal(bad.toasts.length, 1);
  assert.equal(bad.opened.length, 0);
});

test("a second present while one runs is ignored", async () => {
  const t = make({ elements: deck() });
  const first = t.actions.presentDrawing({ drawingUid: UID });
  assert.equal(await t.actions.presentDrawing({ drawingUid: UID }), null);
  await first;
  assert.equal(t.opened.length, 1);
});

test("Add notes from the canvas toasts on failure and when notes already exist", async () => {
  const regions = [{ uid: "rgncfr001", region: { supported: true, kind: "cframe", frameId: "f1" } }];
  const has = make({ elements: deck(), regionsOf: () => regions, pulls: { rgncfr001: { children: [{ uid: "k" }] } } });
  const r = await has.actions.addNotesForFrame({ drawingUid: UID, frameId: "f1" });
  assert.equal(r.regionUid, "rgncfr001");
  assert.equal(has.toasts.at(-1)[0], "Notes already exist: Outline › regions");
  const t = make({ elements: deck(), failCreate: true });
  assert.equal(await t.actions.addNotesForFrame({ drawingUid: UID, frameId: "f1" }), null);
  assert.deepEqual(t.toasts.at(-1), ["Could not add notes", { kind: "error" }]);
});

// ---- PRES-4 ----

const box = (id) => ({ id, type: "rectangle", x: 0, y: 0, width: 50, height: 50, angle: 0, isDeleted: false, version: 1 });
const area = (id) => serializeRegion({ kind: "area", drawingUid: UID, ids: [id], caption: `cap ${id}` });

function outline(children, regions = {}) {
  const pulls = { outline01: { string: "Deck", children: children.map((string, i) => ({ uid: `child${i}`, string })) } };
  for (const [uid, str] of Object.entries(regions)) pulls[uid] = { string: str };
  return pulls;
}

test("presentOutline accepts bare and alias refs, skips others with a notice, owns and revokes its URLs", async () => {
  const pulls = outline(["((rgnaaa001))", "[Alias](((rgnaaa002)))", "plain text", "((rgnaaa003))"], { rgnaaa001: area("a"), rgnaaa002: area("b"), rgnaaa003: "not a region" });
  const t = make({ pulls, editor: null, savedElements: [box("a"), box("b")], anyCache: true });
  await t.actions.presentOutline("outline01");
  assert.equal(t.opened[0].slides.length, 2);
  assert.deepEqual(t.setSlides.map(([i, url]) => [i, url]), [[0, "own:0"], [1, "own:1"]]);
  assert.equal(t.urlsRevoked.length, 0);
  t.close();
  assert.deepEqual(t.urlsRevoked, ["own:0", "own:1"]);
  assert.equal(t.notices.length, 1);
  assert.equal(t.toasts.length, 0);
});

test("presentOutline counts text children as skipped and gives each slide its child's notes root", async () => {
  const pulls = outline(["just text, skip me", "((rgnaaa001))", "((rgnaaa002))"], { rgnaaa001: area("a"), rgnaaa002: area("b") });
  const t = make({ pulls, editor: null, savedElements: [box("a"), box("b")], anyCache: true });
  await t.actions.presentOutline("outline01");
  assert.equal(t.opened[0].slides.length, 2);
  assert.deepEqual(t.opened[0].slides.map((s) => s.notes), [{ rootUid: "child1" }, { rootUid: "child2" }]);
  assert.deepEqual(t.notices, ["Skipped 1 child that cannot be presented"]);
});

test("presentOutline starts sources lazily: closing after the first slide starts no more jobs", async () => {
  const children = ["((rgnaaa001))", "((rgnaaa002))", "((rgnaaa003))"];
  const regions = { rgnaaa001: area("a"), rgnaaa002: area("b"), rgnaaa003: area("a") };
  const one = []; 
  const solo = make({ pulls: outline(children.slice(0, 1), { rgnaaa001: regions.rgnaaa001 }), editor: null, savedElements: [box("a"), box("b")], anyCache: true, fetches: one });
  await solo.actions.presentOutline("outline01");
  const fetches = [];
  const t = make({ pulls: outline(children, regions), editor: null, savedElements: [box("a"), box("b")], anyCache: true, fetches, closeAfterFirst: true });
  await t.actions.presentOutline("outline01");
  assert.equal(t.setSlides.length, 1);
  assert.equal(fetches.length, one.length);
});

test("presentOutline with no region refs toasts and does not open", async () => {
  const t = make({ pulls: outline(["hello", "((short))"]) });
  assert.equal(await t.actions.presentOutline("outline01"), null);
  assert.equal(t.toasts.at(-1)[0], "No region refs under this block");
  assert.equal(t.opened.length, 0);
});

test("presentOutline caps at 100 children", async () => {
  const kids = Array.from({ length: 130 }, (_, i) => `((rgn${String(i).padStart(6, "0")}))`);
  const regions = Object.fromEntries(kids.map((k) => [k.slice(2, 11), area("a")]));
  const t = make({ pulls: outline(kids, regions), savedElements: [box("a")] });
  await t.actions.presentOutline("outline01");
  assert.equal(t.opened[0].slides.length, 100);
});

// ---- print / PNG ----

test("printFrames without a drawing toasts", async () => {
  const t = make({ editor: null });
  assert.equal(await t.actions.printFrames({}), null);
  assert.equal(t.toasts.at(-1)[0], "Open a drawing or pick a drawing block");
});

test("printFrames mounted takes native 2x light PNGs, gives the kit owned URLs, revokes after", async () => {
  const t = make({ elements: deck(), png: () => pngBlob(200, 120) });
  const res = await t.actions.printFrames({ drawingUid: UID, size: "a4", margin: 12 });
  assert.equal(res.pages, 3);
  assert.deepEqual(t.captured.map((c) => [c[1], c[2].scale, c[2].dark]), [["f1", 2, false], ["f2", 2, false], ["f3", 2, false]]);
  const build = t.kitCalls.find(([k]) => k === "print")[1];
  assert.equal(build.size, "a4");
  assert.equal(build.margin, 12);
  assert.equal(build.drawing, "My drawing");
  assert.deepEqual(build.pages.map((p) => p.name), ["One", "Two", "Three"]);
  assert.deepEqual(build.pages.map((p) => p.url), t.urlsMade.map(([u]) => u));
  assert.deepEqual([...t.urlsRevoked].sort(), t.urlsMade.map(([u]) => u).sort());
  assert.match(t.toasts[0][0], /^Preparing 3 pages/);
});

test("printFrames reads size and margin from settings when not passed, with clamps", async () => {
  const t = make({ elements: deck(), png: () => pngBlob(200, 120), settings: { printSize: "16:9", printMargin: 99 } });
  await t.actions.printFrames({ drawingUid: UID });
  const build = t.kitCalls.find(([k]) => k === "print")[1];
  assert.equal(build.size, "16:9");
  assert.equal(build.margin, 30);
});

test("printFrames rejects a wrong-size native PNG and falls back to the cold 1x crop", async () => {
  const calls = [];
  const cold = { renderDrawing: async (uid) => { calls.push(uid); return null; } };
  const t = make({ elements: deck(), png: () => pngBlob(100, 60), cold, savedElements: deck() });
  const res = await t.actions.printFrames({ drawingUid: UID });
  assert.equal(calls.length, 1);
  assert.equal(res, null);
  assert.equal(t.kitCalls.length, 0);
  assert.equal(t.toasts.at(-1)[1].kind, "error");
});

test("printFrames caps at 50 frames with a toast; png mode goes to downloadPngs", async () => {
  const many = Array.from({ length: 60 }, (_, i) => fr(`f${i}`, `F${i}`, i * 200, 0, { order: i + 1 }));
  const t = make({ elements: many, png: () => pngBlob(200, 120) });
  const res = await t.actions.printFrames({ drawingUid: UID, mode: "png" });
  assert.equal(res.pages, 50);
  assert.ok(t.toasts.some(([m]) => /first 50 of 60/.test(m)));
  assert.equal(t.kitCalls.at(-1)[0], "png");
  assert.equal(t.kitCalls.at(-1)[1].frames.length, 50);
  assert.equal(t.urlsMade.length, 0);
});

test("png export keeps each frame's true number when an earlier frame fails to render", async () => {
  const t = make({ elements: deck(), png: (id) => (id === "f2" ? null : pngBlob(200, 120)), cold: { renderDrawing: async () => null }, savedElements: deck() });
  const res = await t.actions.printFrames({ drawingUid: UID, mode: "png" });
  assert.equal(res.pages, 2);
  const call = t.kitCalls.at(-1)[1];
  assert.deepEqual(call.frames.map((f) => f.index), [0, 2]);
  assert.equal(call.total, 3);
});

test("dispose during a print job disposes the kit job and revokes the URLs", async () => {
  let disposed = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const t = make({
    elements: deck(), png: () => pngBlob(200, 120),
    printKit: { printPages: () => ({ done: gate, dispose: () => { disposed += 1; } }), downloadPngs: () => ({ done: gate, dispose() {} }) },
  });
  const run = t.actions.printFrames({ drawingUid: UID });
  await new Promise((r) => setTimeout(r, 20));
  t.actions.dispose();
  assert.equal(disposed, 1);
  assert.equal(t.urlsRevoked.length, 3);
  release();
  await run;
});
