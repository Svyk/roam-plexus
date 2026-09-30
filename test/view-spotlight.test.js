import assert from "node:assert/strict";
import test from "node:test";

import { focusKeptIds, showFocusVeil, showSpotlight, showTodoVeil, todoKeptIds } from "../src/view/spotlight.js";

const mkDoc = () => {
  const listeners = {};
  const added = [];
  return {
    listeners, added,
    createElement: () => ({ className: "", style: {}, removed: false, remove() { this.removed = true; } }),
    body: { append: (e) => added.push(e) },
    addEventListener(t, f) { (listeners[t] ||= []).push(f); },
    removeEventListener(t, f) { listeners[t] = (listeners[t] || []).filter((x) => x !== f); },
  };
};
const rect = { left: 1, top: 2, width: 3, height: 4 };

test("motion picks the pulse class, no motion the static one", () => {
  const a = mkDoc(); const offA = showSpotlight({ rect, doc: a });
  assert.match(a.added[0].className, /plexus-spotlight--pulse/);
  assert.equal(a.added[0].style.width, "3px");
  offA();
  const b = mkDoc(); const offB = showSpotlight({ rect, doc: b, motion: false });
  assert.match(b.added[0].className, /plexus-spotlight--static/);
  assert.doesNotMatch(b.added[0].className, /pulse/);
  offB();
});

test("keydown (Esc), wheel and pointerdown end it and clean up; disposer is idempotent", () => {
  for (const type of ["keydown", "wheel", "pointerdown"]) {
    const doc = mkDoc();
    const off = showSpotlight({ rect, doc, durationMs: 100000 });
    doc.listeners[type][0]({ key: "Escape" });
    assert.equal(doc.added[0].removed, true);
    for (const list of Object.values(doc.listeners)) assert.equal(list.length, 0);
    off(); off();
  }
});

test("times out after durationMs", async () => {
  const doc = mkDoc();
  showSpotlight({ rect, doc, durationMs: 5 });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(doc.added[0].removed, true);
});

const sorted = (ids) => [...ids].sort();
const bind = (id, type) => ({ id, type });
const chain = [
  { id: "A", type: "rectangle", boundElements: [bind("ab", "arrow"), bind("ag", "arrow"), bind("aghost", "arrow"), bind("aText", "text"), bind("ax", "line")] },
  { id: "aText", type: "text", text: "A", boundElements: [bind("secret", "arrow")] },
  { id: "ax", type: "line", startBinding: { elementId: "A" }, endBinding: { elementId: "X" } },
  { id: "X", type: "rectangle", boundElements: [bind("ax", "line")] },
  { id: "ab", type: "arrow", startBinding: { elementId: "A" }, endBinding: { elementId: "B" }, boundElements: [bind("abText", "text")] },
  { id: "abText", type: "text", text: "ab" },
  { id: "B", type: "rectangle", boundElements: [bind("ab", "arrow"), bind("bc", "arrow"), bind("bText", "text")] },
  { id: "bText", type: "text", text: "B" },
  { id: "bc", type: "arrow", startBinding: { elementId: "B" }, endBinding: { elementId: "C" } },
  { id: "C", type: "rectangle", boundElements: [bind("bc", "arrow"), bind("cd", "arrow"), bind("cText", "text")] },
  { id: "cText", type: "text", text: "C" },
  { id: "cd", type: "arrow", startBinding: { elementId: "C" }, endBinding: { elementId: "D" } },
  { id: "D", type: "rectangle", boundElements: [bind("cd", "arrow"), bind("dText", "text")] },
  { id: "dText", type: "text", text: "D" },
  { id: "secret", type: "arrow", startBinding: { elementId: "aText" }, endBinding: { elementId: "S" } },
  { id: "S", type: "rectangle", boundElements: [bind("secret", "arrow")] },
  { id: "ag", type: "arrow", isDeleted: true, startBinding: { elementId: "A" }, endBinding: { elementId: "gone" }, boundElements: [bind("goneText", "text")] },
  { id: "gone", type: "rectangle", isDeleted: true, boundElements: [bind("ag", "arrow")] },
  { id: "goneText", type: "text", text: "gone" },
  { id: "aghost", type: "arrow", startBinding: { elementId: "A" }, endBinding: { elementId: "ghost" } },
  { id: "ghost", type: "rectangle", isDeleted: true, boundElements: [bind("aghost", "arrow"), bind("gs", "arrow")] },
  { id: "gs", type: "arrow", startBinding: { elementId: "ghost" }, endBinding: { elementId: "S" } },
  { id: "Z", type: "rectangle" },
];

test("depth 1 keeps the next arrow neighbour and all keeps the far node", () => {
  const near = ["A", "ab", "B", "aghost", "aText", "abText", "bText"];
  assert.deepEqual(sorted(focusKeptIds(chain, ["A"], 1)), sorted(near));
  assert.deepEqual(sorted(focusKeptIds(chain, ["A"], 2)), sorted([...near, "bc", "C", "cText"]));
  const far = focusKeptIds(chain, ["A"], "all");
  assert.deepEqual(sorted(far), sorted([...near, "bc", "C", "cText", "cd", "D", "dText"]));
  assert.ok(far.includes("D"));
  assert.ok(!focusKeptIds(chain, ["A"], 1).includes("D"));
  assert.deepEqual(sorted(focusKeptIds(chain, ["ab"], 1)), sorted(["ab", "A", "B", "abText", "aText", "bText"]));
  assert.deepEqual(sorted(focusKeptIds(chain, ["Z"], "all")), ["Z"]);
  assert.deepEqual(sorted(focusKeptIds(chain, { Z: true, gone: true }, 1)), ["Z"]);
});

test("bound text stays lit and is not a hop", () => {
  const kept = focusKeptIds(chain, ["A"], "all");
  assert.ok(kept.includes("aText"));
  assert.ok(kept.includes("abText"));
  for (const id of ["secret", "S", "ax", "X", "ghost", "gs", "gone", "ag", "goneText"]) assert.ok(!kept.includes(id), id);
});

const todos = [
  { id: "open", type: "rectangle", text: "x", string: "{{[[TODO]]}} write", boundElements: [bind("cap", "text")] },
  { id: "cap", type: "text", text: "note" },
  { id: "done", type: "rectangle", text: "{{[[DONE]]}} wrote", string: "{{[[DONE]]}} wrote", boundElements: [bind("doneCap", "text")] },
  { id: "doneCap", type: "text", text: "old" },
  { id: "bracket", type: "text", text: "{{[[TODO]]}} drop #[[task-status/Cancelled]]" },
  { id: "plain", type: "text", text: "{{[[TODO]]}} drop #task-status/Cancelled" },
  { id: "doneTag", type: "text", text: "{{[[DONE]]}} drop #[[task-status/Cancelled]]" },
  { id: "due", type: "text", text: "BT_attrDue:: 2026-10-01", BT_attrDue: "2026-10-01" },
  { id: "fallback", type: "rectangle", text: "{{[[TODO]]}} from element" },
  { id: "dead", type: "text", text: "{{[[TODO]]}} gone", isDeleted: true, boundElements: [bind("deadCap", "text")] },
  { id: "deadCap", type: "text", text: "still" },
];
const textOf = (el) => el.string;

test("open TODOs stay lit, including cancelled, and DONE stays out", () => {
  assert.deepEqual(
    sorted(todoKeptIds(todos, textOf)),
    sorted(["open", "cap", "bracket", "plain", "fallback"]),
  );
  assert.deepEqual(sorted(todoKeptIds(todos)), sorted(["bracket", "plain", "fallback"]));
  const doc = mkDoc();
  const rects = {
    open: { left: 11, top: 110, width: 8, height: 8 },
    cap: { left: 22, top: 220, width: 8, height: 8 },
    bracket: { left: 33, top: 330, width: 8, height: 8 },
    plain: { left: 44, top: 440, width: 8, height: 8 },
    fallback: { left: 55, top: 550, width: 8, height: 8 },
    done: { left: 99, top: 990, width: 8, height: 8 },
    due: { left: 97, top: 970, width: 8, height: 8 },
  };
  let sceneWrites = 0;
  let sub = null;
  let unsubs = 0;
  const off = showTodoVeil({
    doc,
    elements: todos,
    textOf,
    rectOf: (id) => rects[id] || null,
    subscribe: (fn) => { sub = fn; return () => { unsubs += 1; }; },
    updateScene: () => { sceneWrites += 1; },
  });
  const el = doc.added[0];
  assert.equal(doc.added.length, 1);
  assert.equal(el.className, "plexus-portal plexus-focus-veil");
  assert.equal(sceneWrites, 0);
  for (const snippet of ["11px 110px", "22px 220px", "33px 330px", "44px 440px", "55px 550px"]) {
    assert.match(el.style.clipPath, new RegExp(snippet));
  }
  assert.doesNotMatch(el.style.clipPath, /99px 990px/);
  assert.doesNotMatch(el.style.clipPath, /97px 970px/);
  todos[0].string = "{{[[DONE]]}} write";
  sub();
  assert.doesNotMatch(el.style.clipPath, /11px 110px/);
  assert.doesNotMatch(el.style.clipPath, /22px 220px/);
  assert.match(el.style.clipPath, /33px 330px/);
  doc.listeners.keydown[0]({ key: "a" });
  assert.equal(el.removed, false);
  doc.listeners.keydown[0]({ key: "Escape" });
  assert.equal(el.removed, true);
  assert.equal(unsubs, 1);
  off();
  assert.equal(unsubs, 1);
  todos[0].string = "{{[[TODO]]}} write";
});

test("the focus veil survives the key a and leaves on Escape", () => {
  const doc = mkDoc();
  let holes = [
    { left: 10, top: 20, width: 30, height: 40 },
    { left: 70, top: 80, width: 15, height: 25 },
  ];
  let calls = 0;
  let sub = null;
  let unsubs = 0;
  const off = showFocusVeil({
    doc,
    getHoles: () => { calls += 1; return holes; },
    subscribe: (fn) => { sub = fn; return () => { unsubs += 1; }; },
  });
  const el = doc.added[0];
  assert.equal(doc.added.length, 1);
  assert.equal(el.className, "plexus-portal plexus-focus-veil");
  assert.equal(el.style.pointerEvents, "none");
  assert.equal(el.style.boxShadow || "", "");
  assert.match(el.style.clipPath, /evenodd/);
  assert.match(el.style.clipPath, /10px 20px/);
  assert.match(el.style.clipPath, /70px 80px/);
  const before = calls;
  holes = [
    { left: 0, top: 0, width: 100, height: 100 },
    { left: 10, top: 10, width: 20, height: 20 },
  ];
  sub();
  assert.ok(calls > before);
  assert.match(el.style.clipPath, /evenodd/);
  assert.match(el.style.clipPath, /0px 0px/);
  assert.match(el.style.clipPath, /100px 100px/);
  assert.doesNotMatch(el.style.clipPath, /10px 10px/);
  assert.equal(doc.listeners.wheel, undefined);
  assert.equal(doc.listeners.pointerdown, undefined);
  doc.listeners.keydown[0]({ key: "a" });
  assert.equal(el.removed, false);
  assert.equal(doc.listeners.keydown.length, 1);
  doc.listeners.keydown[0]({ key: "Escape" });
  assert.equal(el.removed, true);
  assert.equal(doc.listeners.keydown.length, 0);
  assert.equal(unsubs, 1);
  off();
  off();
  assert.equal(unsubs, 1);
});
