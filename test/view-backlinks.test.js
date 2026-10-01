import assert from "node:assert/strict";
import test from "node:test";

import { BACKLINK_ROW_CAP, BACKLINK_WATCH_CAP, createCanvasBacklinks } from "../src/view/backlinks.js";
import { viewportRectOf } from "../src/host/native.js";

function fakeNode(tag = "div") {
  const n = {
    tag, children: [], listeners: {}, className: "", style: {}, textContent: "", title: "", parentNode: null, removed: false,
    append(...c) { for (const x of c) { x.parentNode = this; x.removed = false; this.children.push(x); } },
    remove() { this.removed = true; if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((x) => x !== this); this.parentNode = null; },
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
    removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); },
    fire(t, e = {}) { for (const f of [...(this.listeners[t] || [])]) f({ stopPropagation() {}, preventDefault() {}, ...e }); },
  };
  return n;
}
const flat = (n) => [n, ...n.children.flatMap(flat)];
const listenerCount = (n) => Object.values(n.listeners).reduce((a, l) => a + l.length, 0);

const REG = "REG000001";
const NODE = "NODE00001";
const DRAWING = "DRAWING01";

function setup({ elements, regions, refs = {}, openTarget = () => {}, onAddToCanvas } = {}) {
  const body = fakeNode("body");
  const doc = Object.assign(fakeNode("doc"), {
    body,
    defaultView: { innerWidth: 1200 },
    createElement: (tag) => fakeNode(tag),
  });
  const frames = [];
  const raf = (cb) => { frames.push(cb); return frames.length; };
  const flush = () => { while (frames.length) frames.shift()(); };
  const watches = [];
  const removed = [];
  const rendered = [];
  const unmounted = [];
  const store = { ...refs };
  const pulls = [];
  const api = {
    data: {
      pull: (pattern, lookup) => {
        pulls.push(lookup);
        const key = lookup?.[1];
        return store[key] ? { ":block/_refs": store[key].map(([u, s, p]) => ({ ":block/uid": u, ":block/string": s, ":block/page": { ":node/title": p, ":block/uid": "pg" } })) } : {};
      },
      addPullWatch: (pattern, eid, cb) => watches.push({ pattern, eid, cb }),
      removePullWatch: (pattern, eid, cb) => removed.push({ pattern, eid, cb }),
    },
    ui: { components: {
      renderString: ({ el, string }) => rendered.push([el, string]),
      unmountNode: ({ el }) => unmounted.push(el),
    } },
  };
  const app = {
    state: { scrollX: 0, scrollY: 0, zoom: { value: 1 }, offsetLeft: 0, offsetTop: 0 },
    elements: elements ?? [{ id: "a", type: "rectangle", x: 100, y: 100, width: 50, height: 40, angle: 0, version: 1, isDeleted: false }],
    getSceneElementsIncludingDeleted() { return this.elements; },
  };
  const subs = { on: 0, off: 0 };
  const native = { viewportRectOf, subscribeViewport: (_a, cb) => { subs.on++; subs.cb = cb; return () => { subs.off++; }; } };
  const host = { regionsOf: () => regions ?? [{ uid: REG, string: "s", region: { kind: "area", ids: ["a"], pad: 0 } }] };
  const containerEl = { getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600 }) };
  const opened = [];
  const bl = createCanvasBacklinks({
    doc, api, host, app, containerEl, drawingUid: DRAWING, zIndex: 50, native, raf, caf() {},
    openTarget: (t, o) => { opened.push([t, o]); openTarget(t, o); },
    onAddToCanvas,
  });
  const layer = () => body.children.find((c) => /plexus-backlinks(\s|$)/.test(c.className));
  const badges = () => (layer() ? layer().children : []);
  const popover = () => body.children.find((c) => /plexus-backlink-popover/.test(c.className));
  return { bl, doc, body, app, api, store, pulls, watches, removed, rendered, unmounted, subs, flush, frames, layer, badges, popover, opened };
}

const mm = (id, uid, x, y, w = 20, h = 20) => ({ id, type: "rectangle", x, y, width: w, height: h, angle: 0, version: 1, isDeleted: false, customData: { plexus: { mm: { uid } } } });

test("badges for regions and mind-map nodes only when referenced; layer z-index and title", () => {
  const s = setup({
    elements: [{ id: "a", type: "rectangle", x: 100, y: 100, width: 50, height: 40, angle: 0, version: 1 }, mm("n1", NODE, 300, 300), mm("n2", "NODE00002", 500, 500)],
    refs: { [REG]: [["R1", "see ((x))", "Daily"], ["R2", "other", "Other"]], [NODE]: [["R3", "n", "P"]] },
  });
  assert.match(s.layer().className, /plexus-portal plexus-backlinks/);
  assert.equal(s.layer().style.zIndex, "51");
  assert.equal(s.badges().length, 2);
  const texts = s.badges().map((b) => b.textContent).sort();
  assert.deepEqual(texts, ["1", "2"]);
  assert.ok(s.badges().every((b) => b.tag === "button" && b.className === "plexus-backlink-badge"));
  assert.ok(s.badges().some((b) => b.title === "2 references"));
  assert.ok(s.badges().some((b) => b.title === "1 reference"));
});

test("image region kinds are skipped", () => {
  const s = setup({
    regions: [{ uid: REG, string: "s", region: { kind: "imgrect", el: "a", f: [0, 0, 1, 1] } }],
    refs: { [REG]: [["R1", "x", "P"]] },
  });
  assert.equal(s.badges().length, 0);
  assert.equal(s.watches.length, 0);
});

test("targets with the same bbox merge into one badge and union refs by referencing uid", () => {
  const s = setup({
    elements: [{ id: "a", type: "rectangle", x: 100, y: 100, width: 50, height: 40, angle: 0, version: 1 }, mm("n1", NODE, 100, 100, 50, 40)],
    refs: { [REG]: [["R1", "x", "P"], ["R2", "y", "P"]], [NODE]: [["R2", "y", "P"], ["R3", "z", "P"]] },
  });
  assert.equal(s.badges().length, 1);
  assert.equal(s.badges()[0].textContent, "3");
  assert.equal(s.watches.length, 2);
});

test("self references are excluded: own region blocks, the drawing block, and the regions holder", () => {
  const s = setup({
    elements: [{ id: "a", type: "rectangle", x: 100, y: 100, width: 50, height: 40, angle: 0, version: 1 }, mm("n1", NODE, 300, 300)],
    regions: [
      { uid: REG, string: "s", region: { kind: "area", ids: ["a"], pad: 0 } },
      { uid: "REG000002", string: "s", region: { kind: "area", ids: ["n1"], pad: 0 } },
    ],
    refs: {
      [NODE]: [["REG000002", "cap ((NODE00001))", "P"], [DRAWING, "d", "P"], ["HOLDER001", "{{[[plexus-regions]]}}", "P"]],
      [REG]: [["REG000002", "x", "P"]],
    },
  });
  assert.equal(s.badges().length, 0);
});

test("glyph bottom-left sits at (right + 3, top + 3) of the bbox and and follows pan and zoom", () => {
  const s = setup({ refs: { [REG]: [["R1", "x", "P"]] } });
  const b = s.badges()[0];
  assert.equal(b.style.left, "153px");
  assert.equal(b.style.top, "103px");
  s.app.state.scrollX = 10;
  s.app.state.zoom = { value: 2 };
  s.subs.cb();
  assert.equal(s.frames.length, 1);
  s.subs.cb();
  assert.equal(s.frames.length, 1, "one rAF per burst");
  s.flush();
  assert.equal(b.style.left, `${(150 + 10) * 2 + 3}px`);
  assert.equal(b.style.top, `${100 * 2 + 3}px`);
});

test("badge is hidden when its corner is outside the editor container", () => {
  const s = setup({ refs: { [REG]: [["R1", "x", "P"]] } });
  const b = s.badges()[0];
  assert.equal(b.style.display, "");
  s.app.state.scrollX = 2000;
  s.subs.cb();
  s.flush();
  assert.equal(b.style.display, "none");
  s.app.state.scrollX = 0;
  s.subs.cb();
  s.flush();
  assert.equal(b.style.display, "");
  assert.equal(s.badges()[0], b, "DOM node reused");
});

test("one pull watch per uid; removed when the target disappears and on dispose", () => {
  const s = setup({
    elements: [{ id: "a", type: "rectangle", x: 100, y: 100, width: 50, height: 40, angle: 0, version: 1 }, mm("n1", NODE, 300, 300)],
    refs: { [REG]: [["R1", "x", "P"]], [NODE]: [["R2", "y", "P"]] },
  });
  assert.equal(s.watches.length, 2);
  assert.deepEqual(s.watches.map((w) => w.eid).sort(), [`[:block/uid "${NODE}"]`, `[:block/uid "${REG}"]`]);
  assert.equal(s.watches[0].pattern, "[{:block/_refs [:block/uid]}]");
  const node = s.app.elements[1];
  node.isDeleted = true;
  node.version = 2;
  s.subs.cb();
  s.flush();
  assert.equal(s.removed.length, 1);
  assert.equal(s.removed[0].eid, `[:block/uid "${NODE}"]`);
  assert.equal(s.badges().length, 1);
  s.bl.dispose();
  assert.equal(s.removed.length, 2);
  assert.equal(s.removed[1].eid, `[:block/uid "${REG}"]`);
});

test("watch cap: extra targets still get badges but no watch, logged once", () => {
  const elements = [];
  const refs = {};
  for (let i = 0; i < BACKLINK_WATCH_CAP + 5; i++) {
    const uid = `N${String(i).padStart(8, "0")}`;
    elements.push(mm(`n${i}`, uid, i * 100, 0));
    refs[uid] = [["R1", "x", "P"]];
  }
  const warns = [];
  const warn = console.warn;
  console.warn = (...a) => warns.push(a.join(" "));
  let s;
  try { s = setup({ elements, regions: [], refs }); s.subs.cb(); s.flush(); } finally { console.warn = warn; }
  assert.equal(s.watches.length, BACKLINK_WATCH_CAP);
  assert.equal(s.badges().length, BACKLINK_WATCH_CAP + 5);
  assert.equal(warns.filter((w) => /not live/.test(w)).length, 1);
});

test("a watch callback recomputes refs and updates the badge; count 0 removes it", () => {
  const s = setup({ refs: { [REG]: [["R1", "x", "P"]] } });
  assert.equal(s.badges()[0].textContent, "1");
  s.store[REG] = [["R1", "x", "P"], ["R2", "y", "P"], ["R3", "z", "P"]];
  s.watches[0].cb({}, {});
  assert.equal(s.badges()[0].textContent, "3");
  s.store[REG] = [];
  s.watches[0].cb({}, {});
  assert.equal(s.badges().length, 0);
  s.store[REG] = [["R9", "n", "P"]];
  s.watches[0].cb({}, {});
  assert.equal(s.badges().length, 1);
});

test("click opens a popover with page title and rendered block per row; second click closes and unmounts", () => {
  const s = setup({ refs: { [REG]: [["R1", "first ((x))", "Daily"], ["R2", "second", "Other"]] } });
  const badge = s.badges()[0];
  let stopped = 0;
  badge.fire("mousedown", { stopPropagation() { stopped++; } });
  badge.fire("pointerdown", { stopPropagation() { stopped++; } });
  assert.equal(stopped, 2);
  assert.equal(s.popover(), undefined);
  badge.fire("click");
  const pop = s.popover();
  assert.equal(pop.style.zIndex, "53");
  const rows = pop.children.filter((c) => c.className === "plexus-backlink-row");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].children[0].textContent, "Daily");
  assert.deepEqual(s.rendered.map(([, str]) => str), ["first ((x))", "second"]);
  assert.equal(s.rendered[0][0], rows[0].children[1]);
  badge.fire("click");
  assert.equal(s.popover(), undefined);
  assert.equal(s.unmounted.length, 2);
});

test("popover caps rows at 20 and shows +N more", () => {
  const list = Array.from({ length: 23 }, (_, i) => [`R${i}`, `s${i}`, "P"]);
  const s = setup({ refs: { [REG]: list } });
  s.badges()[0].fire("click");
  const pop = s.popover();
  assert.equal(pop.children.filter((c) => c.className === "plexus-backlink-row").length, BACKLINK_ROW_CAP);
  assert.equal(pop.children.at(-1).textContent, "+3 more");
});

test("row click opens the block (Shift for the sidebar), stops propagation and closes", () => {
  const s = setup({ refs: { [REG]: [["R1", "a", "P"], ["R2", "b", "P"]] } });
  s.badges()[0].fire("click");
  let stopped = false;
  const rows = () => s.popover().children.filter((c) => c.className === "plexus-backlink-row");
  rows()[1].fire("click", { stopPropagation() { stopped = true; }, shiftKey: false });
  assert.ok(stopped);
  assert.deepEqual(s.opened[0], [{ type: "block", uid: "R2" }, { sidebar: false }]);
  assert.equal(s.popover(), undefined);
  s.badges()[0].fire("click");
  rows()[0].fire("click", { shiftKey: true });
  assert.deepEqual(s.opened[1], [{ type: "block", uid: "R1" }, { sidebar: true }]);
});

test("Escape and outside mousedown close the popover; inside mousedown does not", () => {
  const s = setup({ refs: { [REG]: [["R1", "a", "P"]] } });
  s.badges()[0].fire("click");
  s.doc.fire("keydown", { key: "a" });
  assert.ok(s.popover());
  s.doc.fire("mousedown", { target: s.popover().children[0] });
  assert.ok(s.popover());
  s.doc.fire("keydown", { key: "Escape" });
  assert.equal(s.popover(), undefined);
  s.badges()[0].fire("click");
  s.doc.fire("mousedown", { target: fakeNode("canvas") });
  assert.equal(s.popover(), undefined);
  s.badges()[0].fire("click");
  s.doc.fire("wheel", { target: fakeNode("canvas") });
  assert.equal(s.popover(), undefined);
});

test("dispose removes all DOM and listeners and stops reacting to scene changes", () => {
  const s = setup({ refs: { [REG]: [["R1", "a", "P"]] } });
  const layer = s.layer();
  const badge = s.badges()[0];
  badge.fire("click");
  s.subs.cb();
  s.bl.dispose();
  s.bl.dispose();
  assert.equal(s.body.children.length, 0);
  assert.equal(listenerCount(badge), 0);
  assert.equal(listenerCount(s.doc), 0);
  assert.equal(layer.removed, true);
  assert.equal(s.subs.off, 1);
  s.flush();
  assert.equal(s.body.children.length, 0);
  assert.equal(flat(s.body).length, 1);
});

test("a padded region with a single mind-map node merges into the node badge, anchored on the node box", () => {
  const node = mm("n1", NODE, 200, 400, 100, 40);
  const text = { id: "t1", type: "text", x: 210, y: 410, width: 60, height: 20, angle: 0, version: 1, containerId: "n1" };
  const s = setup({
    elements: [node, text],
    regions: [{ uid: REG, string: "s", region: { kind: "area", ids: ["n1", "t1"], pad: 10 } }],
    refs: { [REG]: [["R1", "daily", "Daily"]], [NODE]: [["REG000001", "cap", "P"]] },
  });
  assert.equal(s.badges().length, 1);
  assert.equal(s.badges()[0].textContent, "1");
  assert.equal(s.badges()[0].style.left, "303px");
  assert.equal(s.badges()[0].style.top, "403px");
  assert.equal(s.watches.length, 2);
});

test("a region of several nodes keeps its own badge", () => {
  const s = setup({
    elements: [mm("n1", NODE, 0, 0), mm("n2", "NODE00002", 100, 0)],
    regions: [{ uid: REG, string: "s", region: { kind: "area", ids: ["n1", "n2"], pad: 10 } }],
    refs: { [REG]: [["R1", "x", "P"]] },
  });
  assert.equal(s.badges().length, 1);
  assert.equal(s.badges()[0].style.left, "123px");
});

const rect = (id, extra = {}) => ({ id, type: "rectangle", x: 0, y: 0, width: 40, height: 20, angle: 0, version: 1, isDeleted: false, ...extra });

test("a page link badge shows that page's ref count and watches the title", () => {
  const title = 'A "B"';
  const s = setup({
    elements: [
      rect("e1", { link: `[[${title}]]`, x: 10, y: 20, width: 30, height: 16 }),
      rect("gone", { link: "[[Ghost]]", x: 200, isDeleted: true }),
      rect("blk", { link: "((BLOCK0001))", x: 300 }),
    ],
    regions: [{ uid: REG, string: "s", region: { kind: "area", ids: ["missing"], pad: 0 } }],
    refs: {
      [title]: [
        ["R1", "keep", "Daily"],
        ["R2", "also", "Other"],
        [DRAWING, "d", "P"],
        [REG, "region block", "P"],
        ["HOLD0001", "{{[[plexus-regions]]}}", "P"],
      ],
      Ghost: [["R9", "nope", "P"]],
    },
  });
  assert.equal(s.badges().length, 1);
  assert.equal(s.badges()[0].textContent, "2");
  assert.equal(s.badges()[0].style.left, "43px");
  assert.equal(s.badges()[0].style.top, "23px");
  assert.equal(s.watches.length, 1);
  assert.equal(s.watches[0].eid, `[:node/title ${JSON.stringify(title)}]`);
  assert.ok(s.watches[0].eid.startsWith("[:node/title"));
  assert.equal(s.watches[0].pattern, "[{:block/_refs [:block/uid]}]");
  assert.ok(s.pulls.some((lookup) => lookup?.[0] === ":node/title" && lookup?.[1] === title));
  assert.ok(!s.pulls.some((lookup) => lookup?.[0] === ":block/uid" && lookup?.[1] === title));
  assert.ok(!s.watches.some((w) => w.eid.includes("Ghost")));
});

test("two elements linking one page get two badges and one title watch", () => {
  const s = setup({
    elements: [
      rect("e1", { link: "[[Same]]", x: 0 }),
      rect("e2", { link: "[[Same]]", x: 200 }),
    ],
    regions: [],
    refs: { Same: [["R1", "a", "P"]] },
  });
  assert.equal(s.badges().length, 2);
  assert.deepEqual(s.badges().map((b) => b.textContent).sort(), ["1", "1"]);
  assert.equal(s.watches.length, 1);
  assert.equal(s.watches[0].eid, '[:node/title "Same"]');
  s.store.Same = [["R1", "a", "P"], ["R2", "b", "P"]];
  s.watches[0].cb({}, {});
  assert.deepEqual(s.badges().map((b) => b.textContent).sort(), ["2", "2"]);
});

test("page title watches share the cap and a further title is not watched", () => {
  const elements = [];
  const refs = {};
  for (let i = 0; i < BACKLINK_WATCH_CAP - 1; i++) {
    const uid = `N${String(i).padStart(8, "0")}`;
    elements.push(mm(`n${i}`, uid, i * 30, 0, 10, 10));
    refs[uid] = [["R1", "x", "P"]];
  }
  elements.push(rect("p1", { link: "[[Alpha]]", x: 0, y: 200 }));
  elements.push(rect("p2", { link: "[[Beta]]", x: 80, y: 200 }));
  refs.Alpha = [["R2", "a", "P"]];
  refs.Beta = [["R3", "b", "P"]];
  const warns = [];
  const warn = console.warn;
  console.warn = (...a) => warns.push(a.join(" "));
  let s;
  try { s = setup({ elements, regions: [], refs }); } finally { console.warn = warn; }
  assert.equal(s.watches.length, BACKLINK_WATCH_CAP);
  assert.deepEqual(s.watches.filter((w) => w.eid.startsWith("[:node/title")).map((w) => w.eid), ['[:node/title "Alpha"]']);
  assert.equal(s.badges().length, BACKLINK_WATCH_CAP + 1);
  assert.ok(s.badges().some((b) => b.style.left === "123px" && b.textContent === "1"));
  assert.equal(warns.filter((w) => /not live/.test(w)).length, 1);
});

test("Add to canvas calls onAddToCanvas with the row and does not navigate", () => {
  const added = [];
  const s = setup({
    elements: [
      rect("e1", { link: "[[Pg]]", x: 0, y: 0, width: 40, height: 20 }),
      rect("a", { x: 100, y: 100, width: 50, height: 40 }),
    ],
    refs: {
      Pg: [["R1", "body text", "Daily"]],
      [REG]: [["R2", "region body", "Other"]],
    },
    onAddToCanvas: (arg) => added.push(arg),
  });
  const pageBadge = s.badges().find((b) => b.style.left === "43px");
  const regionBadge = s.badges().find((b) => b.style.left === "153px");
  let stopped = false;
  pageBadge.fire("click");
  const pageRow = s.popover().children.find((c) => c.className === "plexus-backlink-row");
  const pageButton = pageRow.children.find((c) => c.textContent === "Add to canvas");
  assert.equal(pageButton.tag, "button");
  pageButton.fire("click", { stopPropagation() { stopped = true; }, preventDefault() {} });
  assert.equal(stopped, true);
  assert.equal(s.opened.length, 0);
  assert.deepEqual(added, [{
    elementId: "e1",
    bbox: [0, 0, 40, 20],
    ref: { uid: "R1", string: "body text", page: "Daily" },
  }]);
  assert.ok(s.popover());
  pageRow.fire("click", { shiftKey: false });
  assert.deepEqual(s.opened, [[{ type: "block", uid: "R1" }, { sidebar: false }]]);
  assert.equal(added.length, 1);

  regionBadge.fire("click");
  const regionRow = s.popover().children.find((c) => c.className === "plexus-backlink-row");
  regionRow.children.find((c) => c.textContent === "Add to canvas").fire("click");
  assert.equal(s.opened.length, 1);
  assert.deepEqual(added[1], {
    elementId: null,
    bbox: [100, 100, 150, 140],
    ref: { uid: "R2", string: "region body", page: "Other" },
  });

  const plain = setup({ refs: { [REG]: [["R1", "a", "P"]] } });
  plain.badges()[0].fire("click");
  const plainRow = plain.popover().children.find((c) => c.className === "plexus-backlink-row");
  assert.equal(plainRow.children.some((c) => c.textContent === "Add to canvas"), false);
});

test("cite opens the matching popover and cite([]) returns false", () => {
  const s = setup({
    elements: [
      rect("e1", { link: "[[Cited]]", x: 10, y: 10, width: 20, height: 20 }),
      mm("n1", NODE, 300, 300),
      rect("a", { x: 100, y: 100, width: 50, height: 40 }),
    ],
    refs: {
      Cited: [["Rp", "page ref", "Daily"]],
      [NODE]: [["Rn", "node ref", "Nodes"]],
      [REG]: [["Rr", "region ref", "Regions"]],
    },
  });
  assert.equal(s.bl.cite([]), false);
  assert.equal(s.popover(), undefined);
  assert.equal(s.opened.length, 0);
  assert.equal(s.bl.cite("e1"), true);
  assert.ok(s.popover());
  assert.equal(s.rendered.at(-1)[1], "page ref");
  assert.equal(s.opened.length, 0);
  assert.equal(s.bl.cite(["n1"]), true);
  assert.equal(s.rendered.at(-1)[1], "node ref");
  assert.equal(s.bl.cite("a"), true);
  assert.equal(s.rendered.at(-1)[1], "region ref");
  assert.equal(s.bl.cite(["nope"]), false);
  assert.equal(s.opened.length, 0);
});

test("cite matches a group member, the group id, and a frame id", () => {
  const s = setup({
    elements: [
      rect("g1", { x: 0, y: 0, width: 20, height: 20, groupIds: ["GRP1"] }),
      { id: "fr1", type: "frame", x: 400, y: 0, width: 80, height: 60, angle: 0, version: 1 },
    ],
    regions: [
      { uid: REG, string: "s", region: { kind: "group", groupId: "GRP1", pad: 0 } },
      { uid: "REG000002", string: "s", region: { kind: "frame", frameId: "fr1", pad: 0 } },
    ],
    refs: {
      [REG]: [["R1", "group ref", "P"]],
      REG000002: [["R2", "frame ref", "P"]],
    },
  });
  assert.equal(s.badges().length, 2);
  assert.equal(s.bl.cite("g1"), true);
  assert.equal(s.rendered.at(-1)[1], "group ref");
  assert.equal(s.bl.cite("GRP1"), true);
  assert.equal(s.rendered.at(-1)[1], "group ref");
  assert.equal(s.bl.cite("fr1"), true);
  assert.equal(s.rendered.at(-1)[1], "frame ref");
  assert.equal(s.opened.length, 0);
});

test("theme class follows app.state.theme on the layer and popover, re-checked on reposition", () => {
  const s = setup({ refs: { [REG]: [["R1", "x", "P"]] } });
  assert.doesNotMatch(s.layer().className, /plexus-backlinks--dark/);
  s.app.state.theme = "dark";
  s.subs.cb();
  s.flush();
  assert.match(s.layer().className, /plexus-backlinks--dark/);
  s.badges()[0].fire("click");
  assert.match(s.popover().className, /plexus-backlink-popover plexus-backlinks--dark/);
  s.app.state.theme = "light";
  s.subs.cb();
  s.flush();
  assert.doesNotMatch(s.layer().className, /plexus-backlinks--dark/);
  assert.doesNotMatch(s.popover().className, /--dark/);
});
