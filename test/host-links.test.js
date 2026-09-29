import test from "node:test";
import assert from "node:assert/strict";
import { installLinkInterception } from "../src/host/links.js";

function setup({ link = "[[Target]]", parse, pulls = {} } = {}) {
  const handlers = {};
  const clicked = [];
  const outer = { querySelector: (s) => (s === ".bp3-icon-minimize" ? { click: () => clicked.push("min") } : null) };
  const containerEl = {
    addEventListener: (t, f, c) => { assert.equal(c, true); handlers[t] = f; },
    removeEventListener: (t) => { delete handlers[t]; },
    getBoundingClientRect: () => ({ left: 10, top: 20 }),
    closest: () => outer,
  };
  const seen = [];
  const app = { state: { zoom: { value: 2 }, scrollX: 5, scrollY: 6 }, getElementLinkAtPosition: (p, x) => { seen.push([p, x]); return link; } };
  const calls = [];
  const api = {
    graph: { name: "g" },
    data: { pull: (pat, ident) => pulls[ident[1]] ?? null },
    ui: {
      mainWindow: { openPage: (a) => calls.push(["page", a]), openBlock: (a) => calls.push(["block", a]) },
      rightSidebar: { addWindow: (a) => calls.push(["side", a]) },
    },
  };
  const navs = [];
  let t = 0;
  const dispose = installLinkInterception({
    app, containerEl, api, onNavigate: (n) => navs.push(n), now: () => t,
    parse: parse ?? ((l) => { const m = /^\[\[(.+)\]\]$/.exec(l); return m ? { type: "page", title: m[1] } : null; }),
  });
  const ev = (o = {}) => ({ isTrusted: true, button: 0, clientX: 100, clientY: 100, prevented: 0, stopped: 0, preventDefault() { this.prevented++; }, stopImmediatePropagation() { this.stopped++; }, ...o });
  return { handlers, app, calls, navs, seen, dispose, ev, clicked, setT: (v) => { t = v; } };
}

test("trusted short still click on a Roam link navigates and stops the event", () => {
  const s = setup({ pulls: { "[:block/uid]": null } });
  const d = s.ev();
  s.handlers.pointerdown(d);
  const u = s.ev();
  s.handlers.pointerup(u);
  assert.equal(u.prevented, 1);
  assert.equal(u.stopped, 1);
  assert.deepEqual(s.clicked, ["min"]);
  assert.deepEqual(s.calls, [["page", { page: { title: "Target" } }]]);
  assert.deepEqual(s.navs, [{ target: { type: "page", title: "Target" }, sidebar: false }]);
  // scene point: (100-10)/2-5, (100-20)/2-6
  assert.deepEqual(s.seen[0], [{ x: 40, y: 34 }, null]);
});

test("shift opens sidebar outline/block without leaving the editor", () => {
  const s = setup({ link: "((abcdefghi))", parse: () => ({ type: "block", uid: "abcdefghi" }) });
  s.handlers.pointerdown(s.ev());
  s.handlers.pointerup(s.ev({ shiftKey: true }));
  assert.deepEqual(s.calls, [["side", { window: { type: "block", "block-uid": "abcdefghi" } }]]);
  assert.deepEqual(s.clicked, []);
  assert.equal(s.navs[0].sidebar, true);
});

test("ignores untrusted, moved, and long presses", () => {
  const s = setup();
  s.handlers.pointerdown(s.ev({ isTrusted: false }));
  const u1 = s.ev({ isTrusted: false });
  s.handlers.pointerup(u1);
  s.handlers.pointerdown(s.ev());
  const u2 = s.ev({ clientX: 108 });
  s.handlers.pointerup(u2);
  s.handlers.pointerdown(s.ev());
  s.setT(401);
  const u3 = s.ev();
  s.handlers.pointerup(u3);
  for (const u of [u1, u2, u3]) assert.equal(u.prevented + u.stopped, 0);
  assert.equal(s.calls.length, 0);
  assert.equal(s.seen.length, 0);
});

test("non-Roam link falls through", () => {
  const s = setup({ link: "https://example.com", parse: () => null });
  s.handlers.pointerdown(s.ev());
  const u = s.ev();
  s.handlers.pointerup(u);
  assert.equal(u.prevented, 0);
  assert.equal(s.calls.length, 0);
});

test("roamresearch url uid resolves to page or block; unknown uid falls through", () => {
  const s = setup({ parse: () => ({ uid: "pageuid01" }), pulls: { pageuid01: { ":node/title": "T" } } });
  s.handlers.pointerdown(s.ev());
  s.handlers.pointerup(s.ev());
  assert.deepEqual(s.calls, [["page", { page: { uid: "pageuid01" } }]]);
  const m = setup({ parse: () => ({ uid: "nothere01" }) });
  m.handlers.pointerdown(m.ev());
  const u = m.ev();
  m.handlers.pointerup(u);
  assert.equal(u.prevented, 0);
});

test("disposer removes listeners", () => {
  const s = setup();
  s.dispose();
  assert.deepEqual(Object.keys(s.handlers), []);
});

test("an element object with a link property is resolved (real Excalidraw shape)", () => {
  const s = setup({ link: { link: "[[Target]]" } });
  s.handlers.pointerdown(s.ev());
  const u = s.ev();
  s.handlers.pointerup(u);
  assert.equal(u.prevented, 1);
  assert.deepEqual(s.calls, [["page", { page: { title: "Target" } }]]);
});

test("shift-click on a page that does not exist is left to Excalidraw: no swallow, no toast, no window", () => {
  const s = setup();
  s.handlers.pointerdown(s.ev());
  const u = s.ev({ shiftKey: true });
  s.handlers.pointerup(u);
  assert.equal(u.prevented, 0);
  assert.equal(u.stopped, 0);
  assert.deepEqual(s.calls, []);
  assert.deepEqual(s.navs, []);
});

test("shift-click on an existing page opens an outline window", () => {
  const s = setup({ pulls: { Target: { ":block/uid": "pageuid01" } } });
  s.handlers.pointerdown(s.ev());
  s.handlers.pointerup(s.ev({ shiftKey: true }));
  assert.deepEqual(s.calls, [["side", { window: { type: "outline", "block-uid": "pageuid01" } }]]);
});

test("clicks on Excalidraw UI (non-canvas target) and non-selection tools are ignored", () => {
  const s = setup();
  s.handlers.pointerdown(s.ev());
  const ui = s.ev({ target: { tagName: "BUTTON" } });
  s.handlers.pointerup(ui);
  assert.equal(ui.prevented, 0);
  s.app.state.activeTool = { type: "freedraw" };
  s.handlers.pointerdown(s.ev());
  const draw = s.ev({ target: { tagName: "CANVAS" } });
  s.handlers.pointerup(draw);
  assert.equal(draw.prevented, 0);
  s.app.state.viewModeEnabled = true;
  s.handlers.pointerdown(s.ev());
  const view = s.ev({ target: { tagName: "CANVAS" } });
  s.handlers.pointerup(view);
  assert.equal(view.prevented, 1);
});

test("boundary: exactly 6 px and 400 ms still count; 7 px or 401 ms do not; button 2 is ignored", () => {
  const run = (dx, dt, button = 0) => {
    const s = setup();
    s.handlers.pointerdown(s.ev({ button }));
    s.setT(dt);
    const u = s.ev({ clientX: 100 + dx });
    s.handlers.pointerup(u);
    return u.prevented;
  };
  assert.equal(run(6, 400), 1);
  assert.equal(run(7, 0), 0);
  assert.equal(run(0, 401), 0);
  assert.equal(run(0, 0, 2), 0);
});

test("links:false disables interception", () => {
  const handlers = {};
  const containerEl = { addEventListener: (t, f) => { handlers[t] = f; }, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  installLinkInterception({
    app: { state: { zoom: { value: 1 }, scrollX: 0, scrollY: 0 }, getElementLinkAtPosition: () => "[[T]]" },
    containerEl, api: { graph: { name: "g" } }, getSettings: () => ({ links: false }), parse: () => ({ type: "page", title: "T" }),
  });
  handlers.pointerdown({ isTrusted: true, button: 0, clientX: 1, clientY: 1 });
  const u = { isTrusted: true, clientX: 1, clientY: 1, prevented: 0, preventDefault() { this.prevented++; }, stopImmediatePropagation() {} };
  handlers.pointerup(u);
  assert.equal(u.prevented, 0);
});

test("plain click navigation clears the orphaned Excalidraw link tooltip", () => {
  const removed = [];
  const tips = [{ classList: { remove: (c) => removed.push(c) } }];
  const s = setup({ pulls: { "[:block/uid]": null } });
  const doc = { querySelectorAll: (sel) => (sel === ".excalidraw-tooltip--visible" ? tips : []) };
  s.dispose();
  const handlers = {};
  const containerEl = {
    ownerDocument: doc,
    addEventListener: (t, f) => { handlers[t] = f; },
    removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    closest: () => null,
  };
  installLinkInterception({
    app: { state: { zoom: { value: 1 }, scrollX: 0, scrollY: 0 }, getElementLinkAtPosition: () => "[[T]]" },
    containerEl,
    api: { graph: { name: "g" }, data: { pull: () => null }, ui: { mainWindow: { openPage() {} } } },
    parse: () => ({ type: "page", title: "T" }),
  });
  const ev = { isTrusted: true, button: 0, clientX: 1, clientY: 1, preventDefault() {}, stopImmediatePropagation() {} };
  handlers.pointerdown(ev);
  handlers.pointerup(ev);
  assert.deepEqual(removed, ["excalidraw-tooltip--visible"]);
  removed.length = 0;
  handlers.pointerdown(ev);
  handlers.pointerup({ ...ev, shiftKey: true });
  assert.deepEqual(removed, []);
});
