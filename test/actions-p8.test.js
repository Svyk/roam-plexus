import assert from "node:assert/strict";
import test from "node:test";

import { createActions } from "../src/actions.js";
import { parseRegion, geometryKey } from "../src/model/region.js";
import { cropKey } from "../src/host/cache.js";
import { createWriteGuard } from "../src/host/guard.js";

const D = "drw000001";
const rect = (id, extra = {}) => ({ id, type: "rectangle", x: 0, y: 0, width: 50, height: 50, angle: 0, isDeleted: false, version: 1, ...extra });
const frameEl = (id, name, extra = {}) => ({ id, type: "frame", name, x: 0, y: 0, width: 200, height: 100, angle: 0, isDeleted: false, version: 1, ...extra });
const svg = '<svg viewBox="0 0 240 160" width="240" height="160"></svg>';
const AREA = `{{[[plexus-region]]: k=area d=${D} ids=rect-a,rect-b pad=10 x=1}} Cap`;

function pngBytes(w, h) {
  const b = new Uint8Array(33);
  const v = new DataView(b.buffer);
  v.setUint32(16, w);
  v.setUint32(20, h);
  return b;
}

function build(over = {}) {
  const blocks = { ...(over.blocks || {}) };
  const app = {
    els: over.elements || [rect("rect-a"), rect("rect-b"), rect("rect-c")],
    state: { selectedElementIds: {}, selectedGroupIds: {}, width: 800, height: 600, scrollX: 0, scrollY: 0, zoom: { value: 1 }, ...(over.state || {}) },
    updates: [],
    getSceneElements() { return this.els.filter((e) => !e.isDeleted); },
    getSceneElementsIncludingDeleted() { return this.els; },
    updateScene(u) {
      this.updates.push(u);
      if (u.elements) this.els = u.elements;
      if (u.appState) Object.assign(this.state, u.appState);
    },
  };
  for (const id of over.selected || []) app.state.selectedElementIds[id] = true;
  const ctx = { editor: over.editor === undefined ? { app, drawingUid: D } : over.editor };
  const toasts = [];
  const written = [];
  const emitted = [];
  const refreshes = [];
  const puts = [];
  const copied = [];
  const spots = [];
  const moves = [];
  const pushes = [];
  const created = [];
  const host = {
    pullBlock: (uid) => (uid in blocks ? { uid, string: blocks[uid], children: [] } : null),
    drawing: over.drawing || (() => ({ hash: "hash0001", elements: app.els, appState: app.state })),
    regionsOf: over.regionsOf || (() => []),
    updateRegionString: over.updateRegionString || (async (d, u, s, o) => { written.push([d, u, s, o]); blocks[u] = s; }),
    createRegions: over.createRegions || (async (d, strings) => { created.push(strings); return strings.map((_, i) => `new00000${i + 1}`); }),
    labelSource: () => ({ string: "{{[[excalidraw]]}}", pageTitle: "Plan" }),
    graphName: () => "my graph",
    openPageUid: over.openPageUid,
    regionBlocksForAudit: over.regionBlocksForAudit,
    containersForAudit: over.containersForAudit,
    openBlock: async () => {},
  };
  const native = {
    activeEditor: () => ctx.editor,
    selectedElementIds: (a) => Object.keys(a.state.selectedElementIds).filter((k) => a.state.selectedElementIds[k]),
    captureSelectionSvg: async () => svg,
    captureSelectionPng: over.captureSelectionPng,
    zoomTo: (a, bbox, o) => moves.push(["zoomTo", bbox, o]),
    viewportRectOf: () => ({ left: 1, top: 2, width: 3, height: 4 }),
    waitNotLoading: async () => true,
    withClipboard: (fn) => fn(),
  };
  const guard = over.guard === undefined ? undefined : over.guard;
  const actions = createActions({
    host,
    native,
    cache: { put: async (k, b, d) => puts.push([k, b, d]), peek: over.peek, get: async () => null, clear: async () => {} },
    cold: {},
    toaster: { show: (m, o) => toasts.push([m, o]) },
    spotlight: (o) => { spots.push(o); return () => {}; },
    getSettings: () => over.settings || {},
    doc: over.doc || { querySelectorAll: () => [], defaultView: over.win },
    clipboard: { writeText: async (t) => copied.push(t) },
    emit: (e) => emitted.push(e),
    refreshRegion: async (uid, o) => { refreshes.push([uid, o]); },
    fetchBlob: over.fetchBlob,
    frame: async () => {},
    ...(guard ? { guard } : {}),
    ...(over.camera ? { camera: over.camera(moves) } : {}),
    motionOk: over.motionOk,
    viewHistory: () => ({ push: (a) => pushes.push(a), size: () => pushes.length, discard: () => { pushes.pop(); } }),
  });
  return { actions, app, ctx, blocks, toasts, written, emitted, refreshes, puts, copied, spots, moves, pushes, created };
}

// ---- REG-2 ----

test("regionsForAllFrames creates cframe regions in slide order, skips named frames, names by frame name", async () => {
  const els = [frameEl("frm-b", "Second", { customData: { plexus: { order: 2 } } }), frameEl("frm-a", "First", { customData: { plexus: { order: 1 } } }), frameEl("frm-c", ""), frameEl("frm-d", "Done")];
  const w = build({
    elements: els,
    regionsOf: () => [{ uid: "old000001", region: parseRegion(`{{[[plexus-region]]: k=cframe d=${D} fr=frm-d}}`) }, { uid: "old000002", region: parseRegion(`{{[[plexus-region]]: k=frame d=${D} fr=frm-c pad=5}} x`) }],
  });
  const out = await w.actions.regionsForAllFrames();
  assert.deepEqual(out, { created: 2, uids: ["new000001", "new000002"] });
  assert.equal(w.created.length, 1);
  const parsed = w.created[0].map(parseRegion);
  assert.deepEqual(parsed.map((r) => [r.kind, r.frameId, r.caption]), [["cframe", "frm-a", "First"], ["cframe", "frm-b", "Second"]]);
  assert.deepEqual(w.emitted, [{ uid: "new000001", kind: "region" }, { uid: "new000002", kind: "region" }]);
  assert.equal(w.toasts.at(-1)[0], "Created 2 frame regions");
  assert.deepEqual(w.copied, []);
});

test("regionsForAllFrames is idempotent and caps a run at 50", async () => {
  const many = Array.from({ length: 53 }, (_, i) => frameEl(`frm${String(i).padStart(3, "0")}`, `S${String(i).padStart(2, "0")}`));
  const w = build({ elements: many });
  const out = await w.actions.regionsForAllFrames();
  assert.equal(out.created, 50);
  assert.equal(w.toasts.at(-1)[0], "Created 50; run again for the rest");
  const done = build({ elements: [frameEl("frm-a", "A")], regionsOf: () => [{ uid: "old000001", region: parseRegion(`{{[[plexus-region]]: k=cframe d=${D} fr=frm-a}}`) }] });
  const again = await done.actions.regionsForAllFrames();
  assert.equal(again.created, 0);
  assert.equal(done.created.length, 0);
  assert.equal(done.toasts.at(-1)[0], "Every frame already has a region");
});

test("regionsForAllFrames reports a partial batch and needs an open drawing", async () => {
  const w = build({ elements: [frameEl("frm-a", "A"), frameEl("frm-b", "B")], createRegions: async () => ["new000001"] });
  const out = await w.actions.regionsForAllFrames();
  assert.equal(out.created, 1);
  assert.match(w.toasts.at(-1)[0], /Created 1 of 2/);
  const none = build({ editor: null });
  assert.equal(await none.actions.regionsForAllFrames(), null);
});

// ---- REG-1 ----

test("update from selection rewrites only the ids token, with expect, then refreshes", async () => {
  const w = build({ blocks: { reg000001: AREA }, selected: ["rect-c", "rect-a"] });
  assert.equal(await w.actions.updateRegionFromSelection("reg000001"), true);
  assert.equal(w.written.length, 1);
  const [d, uid, next, opts] = w.written[0];
  assert.equal(d, D);
  assert.equal(uid, "reg000001");
  assert.equal(next, AREA.replace("ids=rect-a,rect-b", "ids=rect-a,rect-c"));
  assert.deepEqual(opts, { expect: AREA });
  assert.deepEqual(w.emitted, [{ uid: "reg000001", kind: "region" }]);
  assert.deepEqual(w.refreshes, [["reg000001", { purge: false }]]);
  assert.equal(w.puts.length, 1);
  assert.match(w.puts[0][0], /\|svg$/);
});

test("update from selection: same geometry, bad selections and a changed block are refused with toasts", async () => {
  const same = build({ blocks: { reg000001: AREA }, selected: ["rect-a", "rect-b"] });
  assert.equal(await same.actions.updateRegionFromSelection("reg000001"), false);
  assert.equal(same.toasts.at(-1)[0], "Region already matches the selection");
  assert.equal(same.written.length, 0);

  const group = build({ blocks: { reg000001: `{{[[plexus-region]]: k=group d=${D} g=G1 pad=10}}` }, selected: ["rect-a"] });
  assert.equal(await group.actions.updateRegionFromSelection("reg000001"), false);
  assert.equal(group.toasts.at(-1)[0], "Select exactly one group");

  const changed = build({ blocks: { reg000001: AREA }, selected: ["rect-c"], updateRegionString: async () => { throw Object.assign(new Error("x"), { code: "changed" }); } });
  assert.equal(await changed.actions.updateRegionFromSelection("reg000001"), false);
  assert.equal(changed.toasts.at(-1)[0], "Region changed elsewhere; not updated");
  assert.equal(changed.emitted.length, 0);

  const img = build({ blocks: { reg000001: `{{[[plexus-region]]: k=imgrect d=img000001 i=0 f=0,0,0.5,0.5}}` } });
  assert.equal(await img.actions.updateRegionFromSelection("reg000001"), false);
});

test("update frame and group swap exactly their own token; rect keeps its fractions", async () => {
  const els = [frameEl("frm-a", "A"), frameEl("frm-b", "B"), rect("g1", { groupIds: ["G2"] })];
  const fr = build({ elements: els, blocks: { reg000001: `{{[[plexus-region]]: k=frame d=${D} fr=frm-a pad=10}} A` }, selected: ["frm-b"] });
  await fr.actions.updateRegionFromSelection("reg000001");
  assert.equal(fr.written[0][2], `{{[[plexus-region]]: k=frame d=${D} fr=frm-b pad=10}} A`);
  const gr = build({ elements: els, blocks: { reg000001: `{{[[plexus-region]]: k=group d=${D} g=G1 pad=4}}` }, selected: ["g1"], state: { selectedGroupIds: { G2: true } } });
  await gr.actions.updateRegionFromSelection("reg000001");
  assert.equal(gr.written[0][2], `{{[[plexus-region]]: k=group d=${D} g=G2 pad=4}}`);
  const img = { id: "img-a", type: "image", x: 0, y: 0, width: 100, height: 80, angle: 0, isDeleted: false };
  const rc = build({ elements: [img, { ...img, id: "img-b" }], blocks: { reg000001: `{{[[plexus-region]]: k=rect d=${D} el=img-a f=0.1,0.1,0.5,0.5}} pin` }, selected: ["img-b"] });
  await rc.actions.updateRegionFromSelection("reg000001");
  assert.equal(rc.written[0][2], `{{[[plexus-region]]: k=rect d=${D} el=img-b f=0.1,0.1,0.5,0.5}} pin`);
});

test("with no selection, update selects the region, arms a pending update, and applies it later", async () => {
  const w = build({ blocks: { reg000001: AREA } });
  assert.equal(await w.actions.updateRegionFromSelection("reg000001"), false);
  assert.deepEqual(w.app.state.selectedElementIds, { "rect-a": true, "rect-b": true });
  assert.match(w.toasts.at(-1)[0], /Select the new elements/);
  const pending = w.actions.pendingRegionUpdate();
  assert.equal(pending.uid, "reg000001");
  assert.equal(pending.label, "Cap");
  w.app.state.selectedElementIds = { "rect-c": true };
  assert.equal(await w.actions.applyPendingUpdate(), true);
  assert.equal(w.written.length, 1);
  assert.equal(w.actions.pendingRegionUpdate(), null);
});

test("cancelDrawingTool, cancelPendingUpdate and dispose clear the pending update", async () => {
  for (const clear of [(a) => a.cancelDrawingTool(), (a) => a.cancelPendingUpdate(), (a) => a.dispose()]) {
    const w = build({ blocks: { reg000001: AREA } });
    await w.actions.updateRegionFromSelection("reg000001");
    assert.ok(w.actions.pendingRegionUpdate());
    clear(w.actions);
    assert.equal(w.actions.pendingRegionUpdate(), null);
  }
});

// ---- repair ----

test("repair drops missing ids of an area region automatically", async () => {
  const w = build({ blocks: { reg000001: `{{[[plexus-region]]: k=area d=${D} ids=rect-a,gone-x pad=10}} Cap` } });
  assert.deepEqual(await w.actions.repairRegion("reg000001"), { fixed: true, reason: "dropped-missing" });
  assert.equal(w.written[0][2], `{{[[plexus-region]]: k=area d=${D} ids=rect-a pad=10}} Cap`);
  assert.equal(w.toasts.at(-1)[0], "Region repaired");
});

test("repair of a region whose elements are all gone asks for a reselect; a healthy one is left alone", async () => {
  const w = build({ blocks: { reg000001: `{{[[plexus-region]]: k=area d=${D} ids=gone-a,gone-b pad=10}}` } });
  assert.deepEqual(await w.actions.repairRegion("reg000001"), { fixed: false, reason: "reselect" });
  assert.equal(w.written.length, 0);
  assert.equal(w.actions.pendingRegionUpdate().uid, "reg000001");
  const ok = build({ blocks: { reg000001: AREA } });
  assert.deepEqual(await ok.actions.repairRegion("reg000001"), { fixed: false, reason: "ok" });
  const bad = build({ blocks: { reg000001: "{{[[plexus-region]]: k=nope d=x}}" } });
  assert.equal((await bad.actions.repairRegion("reg000001")).reason, "unsupported");
});

// ---- select and open ----

test("selectRegionOnDrawing on the open drawing selects only: no camera, no history", async () => {
  const w = build({
    blocks: { reg000001: `{{[[plexus-region]]: k=group d=${D} g=G1 pad=10}}`, reg000002: `{{[[plexus-region]]: k=cframe d=${D} fr=frm-a}}`, reg000003: AREA },
    elements: [rect("g1", { groupIds: ["G1"] }), rect("g2", { groupIds: ["G1"] }), frameEl("frm-a", "A"), rect("rect-a"), rect("rect-b", { isDeleted: true })],
  });
  assert.equal(await w.actions.selectRegionOnDrawing("reg000001"), true);
  assert.deepEqual(w.app.state.selectedElementIds, { g1: true, g2: true });
  assert.deepEqual(w.app.state.selectedGroupIds, { G1: true });
  await w.actions.selectRegionOnDrawing("reg000002");
  assert.deepEqual(w.app.state.selectedElementIds, { "frm-a": true });
  await w.actions.selectRegionOnDrawing("reg000003");
  assert.deepEqual(w.app.state.selectedElementIds, { "rect-a": true });
  assert.equal(w.moves.length, 0);
  assert.equal(w.pushes.length, 0);
});

test("selectRegionOnDrawing toasts when nothing survives", async () => {
  const w = build({ blocks: { reg000001: `{{[[plexus-region]]: k=area d=${D} ids=zzz pad=1}}` } });
  assert.equal(await w.actions.selectRegionOnDrawing("reg000001"), false);
  assert.equal(w.toasts.at(-1)[0], "Region elements are gone; use Repair region");
});

test("openRegion pushes view history, then moves the camera with zoom cap and motion, then spotlights", async () => {
  const order = [];
  const w = build({
    blocks: { reg000001: AREA },
    settings: { zoomCap: 1.5, animation: "on" },
    motionOk: (doc, setting) => { order.push(`motion:${setting}`); return true; },
    camera: (moves) => ({ animateTo: async (app, bbox, o) => { order.push("camera"); moves.push(["animateTo", bbox, o.maxZoom, o.animate]); return { moved: true }; } }),
  });
  assert.equal(await w.actions.openRegion("reg000001"), D);
  assert.deepEqual(w.moves, [["animateTo", [-10, -10, 60, 60], 1.5, true]]);
  assert.equal(w.pushes.length, 1);
  assert.deepEqual(w.spots[0].rect, { left: 1, top: 2, width: 3, height: 4 });
  assert.equal(w.spots[0].motion, true);
  assert.ok(order.indexOf("camera") > order.indexOf("motion:on"));
});

test("openRegion leaves no Back entry when the region is already framed", async () => {
  const w = build({ blocks: { reg000001: AREA }, camera: () => ({ animateTo: async () => ({ moved: false }) }) });
  assert.equal(await w.actions.openRegion("reg000001"), D);
  assert.equal(w.pushes.length, 0);
});

test("auditRegions accepts an async openPageUid", async () => {
  const w = build({ blocks: { [D]: "{{[[excalidraw]]}}" }, openPageUid: async () => "page00001", regionBlocksForAudit: ({ pageUid }) => { assert.equal(pageUid, "page00001"); return []; }, containersForAudit: () => [] });
  const rows = await w.actions.auditRegions({ scope: "page" });
  assert.deepEqual([...rows], []);
});

test("openRegion skips the spotlight when the camera move was aborted, and defaults to the instant zoom at 100%", async () => {
  const aborted = build({ blocks: { reg000001: AREA }, camera: () => ({ animateTo: async () => ({ aborted: true }) }) });
  await aborted.actions.openRegion("reg000001");
  assert.equal(aborted.spots.length, 0);
  const plain = build({ blocks: { reg000001: AREA } });
  await plain.actions.openRegion("reg000001");
  assert.deepEqual(plain.moves, [["zoomTo", [-10, -10, 60, 60], { maxZoom: 1 }]]);
  assert.equal(plain.spots[0].motion, false);
});

// ---- audit ----

test("auditRegions lists each problem kind once with a repair hint, and container problems", async () => {
  const pageRow = (uid, string, parentUid = "cont00001", parentString = "{{[[plexus-regions]]}}") => ({ uid, string, parentUid, parentString, pageTitle: "Plan" });
  const blocks = {
    [D]: "{{[[excalidraw]]}}",
    img000001: "![a](https://x/y.png)",
  };
  const w = build({
    blocks,
    elements: [rect("rect-a"), rect("rect-b"), frameEl("frm-a", "A"), { id: "txt", type: "text", x: 0, y: 0, width: 5, height: 5, isDeleted: false }],
    openPageUid: () => "page00001",
    regionBlocksForAudit: ({ pageUid }) => {
      assert.equal(pageUid, "page00001");
      return [
        pageRow("r0000001", AREA),
        pageRow("r0000002", `{{[[plexus-region]]: k=area d=${D} ids=rect-a,gone pad=10}}`),
        pageRow("r0000003", `{{[[plexus-region]]: k=area d=${D} ids=gone pad=10}}`),
        pageRow("r0000004", `{{[[plexus-region]]: k=frame d=${D} fr=txt pad=10}}`),
        pageRow("r0000005", `{{[[plexus-region]]: k=area d=${D} ids=rect-a pad=10}}`, "pageuid01", ""),
        pageRow("r0000006", "{{[[plexus-region]]: k=zzz d=x}}"),
        pageRow("r0000007", `{{[[plexus-region]]: k=area d=nowhere01 ids=a pad=1}}`, "cont00002"),
        pageRow("r0000008", `{{[[plexus-region]]: k=area d=${D} ids=rect-a pad=10}}`, "cont00003"),
        pageRow("r0000009", `{{[[plexus-region]]: k=imgrect d=img000001 i=3 f=0,0,0.5,0.5}}`, "cont00004"),
        pageRow("r0000010", "not a region"),
      ];
    },
    containersForAudit: () => [
      { uid: "cont00001", ownerUid: D, ownerString: "{{[[excalidraw]]}}", pageTitle: "Plan" },
      { uid: "cont00002", ownerUid: "nowhere01", ownerString: "", pageTitle: "Plan" },
      { uid: "cont00003", ownerUid: "other0001", ownerString: "{{[[excalidraw]]}}", pageTitle: "Plan" },
      { uid: "cont00004", ownerUid: "img000001", ownerString: "![a](https://x/y.png)", pageTitle: "Plan" },
      { uid: "cont00005", ownerUid: D, ownerString: "{{[[excalidraw]]}}", pageTitle: "Plan" },
    ],
  });
  const rows = await w.actions.auditRegions({ scope: "page" });
  const by = Object.fromEntries(rows.map((r) => [r.uid, r]));
  assert.equal(by.r0000001, undefined);
  assert.equal(by.r0000002.problem, "partial");
  assert.equal(by.r0000002.repair, "auto");
  assert.equal(by.r0000003.problem, "no-elements");
  assert.equal(by.r0000003.repair, "reselect");
  assert.equal(by.r0000004.problem, "not-frame");
  assert.equal(by.r0000005.problem, "outside-container");
  assert.equal(by.r0000005.repair, null);
  assert.equal(by.r0000006.problem, "unsupported");
  assert.equal(by.r0000007.problem, "no-owner");
  assert.equal(by.r0000008.problem, "owner-mismatch");
  assert.equal(by.r0000009.problem, "no-image");
  assert.equal(by.r0000010, undefined);
  assert.equal(by.cont00001.problem, "two-containers");
  assert.equal(by.cont00005.problem, "two-containers");
  assert.equal(by.cont00002.problem, "orphan-container");
  assert.equal(by.cont00001.kind, "container");
  assert.equal(by.r0000002.drawingUid, D);
  assert.equal(by.r0000002.pageTitle, "Plan");
  assert.equal(rows.truncated, false);
});

test("auditRegions on a page scope needs an open page; graph scope passes no page and reports the row cap", async () => {
  const none = build({ openPageUid: () => null });
  assert.equal(await none.actions.auditRegions({ scope: "page" }), null);
  assert.equal(none.toasts.at(-1)[0], "Open a page first");
  const seen = [];
  const many = Array.from({ length: 2100 }, (_, i) => ({ uid: `r${String(i).padStart(8, "0")}`, string: "{{[[plexus-region]]: k=zzz d=x}}", parentUid: "c", parentString: "{{[[plexus-regions]]}}", pageTitle: "P" }));
  const graph = build({ regionBlocksForAudit: (o) => { seen.push(o); return many; }, containersForAudit: () => [] });
  const rows = await graph.actions.auditRegions({ scope: "graph" });
  assert.deepEqual(seen, [{}]);
  assert.equal(rows.length, 2000);
  assert.equal(rows.truncated, true);
});

// ---- copy and misc actions ----

test("copy actions write links, refs and embeds through the clipboard helper", async () => {
  const app = build({ win: { location: { hash: "#/app/my%20graph/page/abc" } } });
  await app.actions.copyRegionLink("reg000001");
  const offline = build({ win: { location: { hash: "#/offline/g/page/abc" } } });
  await offline.actions.copyRegionLink("reg000001");
  assert.deepEqual(app.copied, ["https://roamresearch.com/#/app/my%20graph/page/reg000001"]);
  assert.deepEqual(offline.copied, ["https://roamresearch.com/#/offline/my%20graph/page/reg000001"]);
  await app.actions.copyDrawingRef();
  await app.actions.copyDrawingEmbed();
  assert.deepEqual(app.copied.slice(1), [`((${D}))`, `{{[[embed]]: ((${D}))}}`]);
  const closed = build({ editor: null });
  assert.equal(await closed.actions.copyDrawingRef(), false);
});

test("copyRegionLink starts the clipboard write synchronously", () => {
  const w = build();
  const before = w.copied.length;
  w.actions.copyRegionLink("reg000001");
  assert.equal(w.copied.length, before + 1);
});

test("selectTextOnly reduces a selection to free text, or selects all free text", () => {
  const els = [{ id: "t1", type: "text", isDeleted: false }, { id: "t2", type: "text", isDeleted: false, containerId: "rect-a" }, { id: "t3", type: "text", isDeleted: false }, rect("rect-a")];
  const some = build({ elements: els, selected: ["rect-a", "t1", "t2"] });
  assert.equal(some.actions.selectTextOnly(), 1);
  assert.deepEqual(some.app.state.selectedElementIds, { t1: true });
  const all = build({ elements: els });
  assert.equal(all.actions.selectTextOnly(), 2);
  assert.deepEqual(all.app.state.selectedElementIds, { t1: true, t3: true });
  assert.equal(build({ elements: [rect("a")] }).actions.selectTextOnly(), 0);
});

test("removeElementLink clears links on the selection through the guard", async () => {
  const calls = [];
  const guard = { guardedWrite: (app, o) => { calls.push(o); app.updateScene({ elements: o.next(app.getSceneElementsIncludingDeleted()), captureUpdate: o.captureUpdate }); return true; }, restoreLast: () => 0, hasSnapshot: () => false };
  const w = build({ guard, elements: [rect("a", { link: "https://x" }), rect("b", { link: "https://y" }), rect("c")], selected: ["a", "c"] });
  assert.equal(await w.actions.removeElementLink(), 1);
  assert.equal(calls[0].label, "Remove link");
  assert.equal(calls[0].captureUpdate, "IMMEDIATELY");
  assert.equal(calls[0].drawingUid, D);
  assert.equal(w.app.els.find((e) => e.id === "a").link, null);
  assert.equal(w.app.els.find((e) => e.id === "a").version, 2);
  assert.equal(w.app.els.find((e) => e.id === "b").link, "https://y");
  assert.equal(w.toasts.at(-1)[0], "Removed 1 link");
  assert.equal(await build({ selected: ["rect-a"] }).actions.removeElementLink(), 0);
});

test("restoreBeforeLastPlexusChange and hasSnapshot go through the write guard", async () => {
  const toasts = [];
  const guard = createWriteGuard({ toaster: { show: (m) => toasts.push(m) } });
  const w = build({ guard, elements: Array.from({ length: 20 }, (_, i) => rect(`e${i}`)) });
  assert.equal(w.actions.hasSnapshot(), false);
  guard.guardedWrite(w.app, { drawingUid: D, next: (cur) => cur.map((e, i) => (i < 3 ? { ...e, isDeleted: true, version: 2 } : e)) });
  assert.equal(w.actions.hasSnapshot(), true);
  assert.equal(w.actions.restoreBeforeLastPlexusChange(), 3);
  assert.equal(w.app.els.filter((e) => e.isDeleted).length, 0);
  assert.equal(w.actions.restoreBeforeLastPlexusChange(), 0);
  assert.equal(build({ editor: null }).actions.restoreBeforeLastPlexusChange(), 0);
});

// ---- png2x ----

test("hot refresh stores a 2x PNG under png2x with the real size halved, and drops a mismatched one", async () => {
  const region = parseRegion(AREA);
  const good = build({ blocks: {}, regionsOf: () => [{ uid: "reg000001", region }], captureSelectionPng: async (app, ids, o) => { good.args = [ids, o]; return new Blob([pngBytes(480, 320)], { type: "image/png" }); } });
  await good.actions.refreshCropsForDrawing(D);
  const png = good.puts.find(([k]) => /\|png2x$/.test(k));
  assert.ok(png);
  assert.equal(png[0], cropKey({ regionUid: "reg000001", geometryKey: geometryKey(region), drawingHash: "hash0001", tier: "png2x" }));
  assert.deepEqual(png[2], { w: 240, h: 160, persist: false });
  assert.deepEqual(good.args, [["rect-a", "rect-b"], { scale: 2, dark: false }]);

  const bad = build({ regionsOf: () => [{ uid: "reg000001", region }], captureSelectionPng: async () => new Blob([pngBytes(480, 300)], { type: "image/png" }) });
  const warn = console.warn;
  console.warn = () => {};
  await bad.actions.refreshCropsForDrawing(D);
  console.warn = warn;
  assert.equal(bad.puts.filter(([k]) => /png2x/.test(k)).length, 0);
});

test("copyCropPng prefers a warm png2x entry over the svg and is not a low-res copy", async () => {
  const region = parseRegion(AREA);
  const key = cropKey({ regionUid: "reg000001", geometryKey: geometryKey(region), drawingHash: "hash0001", tier: "png2x" });
  const written = [];
  class Item { constructor(data) { this.data = data; } }
  const w = build({
    blocks: { reg000001: AREA },
    peek: (k) => (k === key ? { url: "blob:2x" } : null),
    fetchBlob: async (url) => new Blob([url], { type: "image/png" }),
  });
  const clip = { write: async (items) => { written.push(items); await items[0].data["image/png"]; }, writeText: async () => {} };
  const actions = createActions({
    host: { pullBlock: (uid) => ({ uid, string: AREA }), drawing: () => ({ hash: "hash0001", elements: w.app.els, appState: {} }), labelSource: () => ({ string: "", pageTitle: null }), graphName: () => "g" },
    native: { activeEditor: () => null, clipboardBusy: () => false },
    cache: { peek: (k) => (k === key ? { url: "blob:2x" } : null), get: async () => null },
    cold: {},
    toaster: { show: (m) => written.push(m) },
    spotlight: () => {},
    getSettings: () => ({}),
    doc: {},
    clipboard: clip,
    fetchBlob: async (url) => new Blob([url], { type: "image/png" }),
    ClipboardItemCtor: Item,
    rasterize: async () => { throw new Error("svg path must not run"); },
  });
  assert.equal(await actions.copyCropPng("reg000001"), true);
  assert.equal(written.at(-1), "Crop copied as PNG");
});
