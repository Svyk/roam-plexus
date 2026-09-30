import test from "node:test";
import assert from "node:assert/strict";
import { hitToken, elementTokens, installTextLinks, topmostText, createFontMeasurer } from "../src/view/text-links.js";

const measure = (s) => s.length * 10;

let seq = 0;
const textEl = (o = {}) => ({
  id: `t${++seq}`, type: "text", x: 100, y: 100, width: 200, height: 25, angle: 0, fontSize: 20, fontFamily: 5,
  lineHeight: 1.25, textAlign: "left", text: "go to [[Alpha]] now", originalText: "go to [[Alpha]] now", version: 1, ...o,
});

test("hitToken hits the token box and nothing else", () => {
  const el = textEl();
  assert.deepEqual(hitToken({ element: el, point: { x: 200, y: 110 }, measure }), { kind: "page", title: "Alpha", start: 6, end: 15 });
  assert.equal(hitToken({ element: el, point: { x: 130, y: 110 }, measure }), null);
  assert.equal(hitToken({ element: el, point: { x: 200, y: 130 }, measure }), null);
});

test("hitToken rotates about the element's own centre (pi/2)", () => {
  const el = textEl({ angle: Math.PI / 2 });
  // local (205, 112.5) with centre (200, 112.5): dx 5, dy 0 -> screen (200, 117.5)
  assert.equal(hitToken({ element: el, point: { x: 200, y: 117.5 }, measure })?.title, "Alpha");
  assert.equal(hitToken({ element: el, point: { x: 150, y: 112.5 }, measure }), null);
});

test("hitToken honours center and right alignment", () => {
  const right = textEl({ textAlign: "right" });
  assert.equal(hitToken({ element: right, point: { x: 175, y: 110 }, measure })?.title, "Alpha");
  assert.equal(hitToken({ element: right, point: { x: 165, y: 110 }, measure }), null);
  const center = textEl({ textAlign: "center" });
  assert.equal(hitToken({ element: center, point: { x: 168, y: 110 }, measure })?.title, "Alpha");
  assert.equal(hitToken({ element: center, point: { x: 162, y: 110 }, measure }), null);
});

test("a token wrapped over two lines is hit on either part", () => {
  const el = textEl({ text: "aaa [[bb\ncc]] z", originalText: "aaa [[bb cc]] z", height: 50 });
  assert.equal(hitToken({ element: el, point: { x: 160, y: 110 }, measure })?.title, "bb cc");
  assert.equal(hitToken({ element: el, point: { x: 120, y: 135 }, measure })?.title, "bb cc");
  assert.equal(hitToken({ element: el, point: { x: 160, y: 135 }, measure }), null);
});

test("wrapped text with doubled spaces at the wrap point still aligns", () => {
  const el = textEl({ text: "aa\n#tag", originalText: "aa  #tag", height: 50 });
  assert.equal(hitToken({ element: el, point: { x: 120, y: 135 }, measure })?.title, "tag");
});

test("without originalText each stored line is scanned on its own", () => {
  const el = textEl({ text: "x\n[[A]] #b", originalText: undefined, height: 50 });
  assert.equal(hitToken({ element: el, point: { x: 110, y: 135 }, measure })?.title, "A");
  assert.deepEqual(elementTokens({ element: el, measure }).map((t) => t.title), ["A", "b"]);
});

test("innermost nested ref wins", () => {
  const el = textEl({ text: "[[a [[b]] c]]", originalText: "[[a [[b]] c]]" });
  assert.equal(hitToken({ element: el, point: { x: 145, y: 110 }, measure })?.title, "b");
  assert.equal(hitToken({ element: el, point: { x: 105, y: 110 }, measure })?.title, "a [[b]] c");
});

test("layout is memoized per id and version", () => {
  let calls = 0;
  const m = (s) => { calls++; return s.length * 10; };
  const el = textEl();
  hitToken({ element: el, point: { x: 200, y: 110 }, measure: m });
  const first = calls;
  hitToken({ element: el, point: { x: 200, y: 110 }, measure: m });
  assert.equal(calls, first);
  hitToken({ element: { ...el, version: 2, text: "[[B]]", originalText: "[[B]]" }, point: { x: 105, y: 110 }, measure: m });
  assert.ok(calls > first);
});

test("createFontMeasurer memoizes by font and text", () => {
  let measured = 0;
  const doc = { createElement: () => ({ getContext: () => ({ set font(v) {}, measureText: (t) => { measured++; return { width: t.length }; } }) }) };
  const m = createFontMeasurer({ doc });
  assert.equal(m("abc", "20px X"), 3);
  assert.equal(m("abc", "20px X"), 3);
  assert.equal(measured, 1);
  assert.equal(m("abc", "30px X"), 3);
  assert.equal(measured, 2);
});

test("topmostText: text wins, containers use bound text, linear shapes and gaps end the search", () => {
  const box = { id: "c", type: "rectangle", x: 0, y: 0, width: 400, height: 300, angle: 0, boundElements: [{ type: "text", id: "bt" }] };
  const bt = textEl({ id: "bt", containerId: "c", x: 150, y: 140, width: 100, height: 25 });
  const arrow = { id: "a", type: "arrow", x: 0, y: 200, width: 400, height: 10, angle: 0 };
  const plain = { id: "p", type: "rectangle", x: 0, y: 0, width: 50, height: 50, angle: 0 };
  const els = [box, bt, arrow, plain];
  assert.equal(topmostText(els, { x: 160, y: 150 })?.text.id, "bt");
  assert.equal(topmostText(els, { x: 20, y: 20 }), null);
  assert.equal(topmostText(els, { x: 300, y: 205 }), null);
  assert.equal(topmostText([box, bt], { x: 300, y: 50 })?.container.id, "c");
  assert.equal(topmostText([box, bt], { x: 999, y: 999 }), null);
});

// ---- installTextLinks ----

class FakeEl {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase(); this.children = []; this.style = {}; this.attrs = {}; this.handlers = {};
    this.className = ""; this.textContent = ""; this.removed = false; this.focused = 0;
  }
  append(...c) { this.children.push(...c); c.forEach((x) => { x.parent = this; }); }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, f) { (this.handlers[t] ||= []).push(f); }
  removeEventListener(t, f) { this.handlers[t] = (this.handlers[t] || []).filter((x) => x !== f); }
  getBoundingClientRect() { return { width: 100, height: 60 }; }
  focus() { this.focused++; }
  remove() { this.removed = true; }
  contains(n) { return n === this || this.children.some((c) => c.contains?.(n)); }
  fire(t, ev) { for (const f of [...(this.handlers[t] || [])]) f(ev); }
}

function setup({ elements, mac = true, pages = { Alpha: true, Beta: true }, blocks = {}, state = {}, link = null } = {}) {
  const listeners = (o) => ({
    handlers: {}, addEventListener(t, f) { (this.handlers[t] ||= []).push(f); },
    removeEventListener(t, f) { this.handlers[t] = (this.handlers[t] || []).filter((x) => x !== f); }, ...o,
  });
  const classes = new Set();
  const containerEl = Object.assign(listeners(), {
    getBoundingClientRect: () => ({ left: 0, top: 0 }), focused: 0, focus() { this.focused++; },
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
  });
  const win = Object.assign(listeners(), { innerWidth: 1000, innerHeight: 800 });
  const body = new FakeEl("body");
  body.hasAttribute = (k) => k in body.attrs;
  const doc = Object.assign(listeners(), { body, defaultView: win, createElement: (t) => new FakeEl(t) });
  const app = {
    state: { zoom: { value: 1 }, scrollX: 0, scrollY: 0, activeTool: { type: "selection" }, ...state },
    getSceneElements: () => elements,
    getElementLinkAtPosition: () => link,
  };
  const api = { data: { pull: (pat, ident) => {
    if (ident[0] === ":node/title") return pages[ident[1]] ? { ":block/uid": "pg" } : null;
    if (pat === "[:block/string]") return blocks[ident[1]] ? { ":block/string": blocks[ident[1]] } : null;
    return blocks[ident[1]] ? { ":block/uid": ident[1] } : null;
  } } };
  const navs = [];
  const toasts = [];
  let t = 0;
  const frames = [];
  const dispose = installTextLinks({
    doc, api, app, containerEl, mac, measure, zIndex: 100,
    navigate: (n) => navs.push(n), toast: (m) => toasts.push(m), now: () => t,
    raf: (fn) => { frames.push(fn); return frames.length; }, caf: () => {},
  });
  const ev = (o = {}) => ({
    isTrusted: true, button: 0, clientX: 200, clientY: 110, metaKey: true, target: { tagName: "CANVAS" },
    prevented: 0, stopped: 0, preventDefault() { this.prevented++; }, stopImmediatePropagation() { this.stopped++; }, ...o,
  });
  const fire = (o, type, e) => (o.handlers[type] || []).forEach((f) => f(e));
  return { containerEl, doc, win, body, navs, toasts, dispose, ev, fire, classes, frames, setT: (v) => { t = v; }, app };
}

test("cmd-click on a token: claimed on pointerdown, navigates on pointerup", () => {
  const s = setup({ elements: [textEl()] });
  const d = s.ev();
  s.fire(s.containerEl, "pointerdown", d);
  assert.equal(d.prevented, 1);
  assert.equal(d.stopped, 1);
  const u = s.ev();
  s.fire(s.containerEl, "pointerup", u);
  assert.equal(u.stopped, 1);
  assert.deepEqual(s.navs, [{ target: { type: "page", title: "Alpha" }, sidebar: false }]);
});

test("shift opens the sidebar", () => {
  const s = setup({ elements: [textEl()] });
  s.fire(s.containerEl, "pointerdown", s.ev({ shiftKey: true }));
  s.fire(s.containerEl, "pointerup", s.ev({ shiftKey: true }));
  assert.equal(s.navs[0].sidebar, true);
});

test("ctrl is the modifier off macOS; ctrl-click on macOS is ignored", () => {
  const win = setup({ elements: [textEl()], mac: false });
  const d = win.ev({ metaKey: false, ctrlKey: true });
  win.fire(win.containerEl, "pointerdown", d);
  assert.equal(d.prevented, 1);
  const mac = setup({ elements: [textEl()] });
  const m = mac.ev({ metaKey: false, ctrlKey: true });
  mac.fire(mac.containerEl, "pointerdown", m);
  assert.equal(m.prevented, 0);
});

test("unclaimed: no modifier, untrusted, other button, non-canvas, non-selection tool, editing, armed note tool", () => {
  const cases = [
    [{}, { metaKey: false }],
    [{}, { isTrusted: false }],
    [{}, { button: 2 }],
    [{}, { target: { tagName: "DIV" } }],
    [{ state: { activeTool: { type: "rectangle" } } }, {}],
    [{ state: { editingTextElement: {} } }, {}],
    [{ state: { openDialog: {} } }, {}],
    [{ state: { contextMenu: {} } }, {}],
    [{ state: { selectedLinearElement: { isEditing: true } } }, {}],
  ];
  for (const [opts, over] of cases) {
    const s = setup({ elements: [textEl()], ...opts });
    const d = s.ev(over);
    s.fire(s.containerEl, "pointerdown", d);
    assert.equal(d.prevented, 0, JSON.stringify([opts, over]));
  }
  const armed = setup({ elements: [textEl()] });
  armed.body.attrs["data-plexus-note-armed"] = "";
  const a = armed.ev();
  armed.fire(armed.containerEl, "pointerdown", a);
  assert.equal(a.prevented, 0);
});

test("element links outrank tokens", () => {
  const s = setup({ elements: [textEl()], link: "https://x.test" });
  const d = s.ev();
  s.fire(s.containerEl, "pointerdown", d);
  assert.equal(d.prevented, 0);
  const linked = setup({ elements: [textEl({ link: "[[X]]" })] });
  const l = linked.ev();
  linked.fire(linked.containerEl, "pointerdown", l);
  assert.equal(l.prevented, 0);
});

test("cmd-click on text without tokens is never touched", () => {
  const s = setup({ elements: [textEl({ text: "plain", originalText: "plain" })] });
  const d = s.ev();
  s.fire(s.containerEl, "pointerdown", d);
  assert.equal(d.prevented, 0);
});

test("no token under the pointer but exactly one in the element navigates to it", () => {
  const s = setup({ elements: [textEl()] });
  s.fire(s.containerEl, "pointerdown", s.ev({ clientX: 120 }));
  s.fire(s.containerEl, "pointerup", s.ev({ clientX: 120 }));
  assert.equal(s.navs[0].target.title, "Alpha");
});

test("two or more tokens and none under the pointer: chooser", () => {
  const el = textEl({ text: "[[Alpha]] and [[Beta]] x", originalText: "[[Alpha]] and [[Beta]] x", width: 260 });
  const s = setup({ elements: [el], blocks: { abcdefghi: "block text" } });
  s.fire(s.containerEl, "pointerdown", s.ev({ clientX: 330 }));
  s.fire(s.containerEl, "pointerup", s.ev({ clientX: 330 }));
  assert.equal(s.navs.length, 0);
  const chooser = s.body.children[0];
  assert.match(chooser.className, /plexus-token-chooser/);
  assert.equal(chooser.style.zIndex, "103");
  const rows = chooser.children[0].children;
  assert.deepEqual(rows.map((r) => r.children[0].textContent), ["Alpha", "Beta"]);
  // outside pointerdown closes and refocuses the container
  s.fire(s.doc, "pointerdown", { target: {} });
  assert.equal(chooser.removed, true);
  assert.equal(s.containerEl.focused, 1);
});

test("chooser keys: arrows, Enter, Shift+Enter, Escape", () => {
  const el = textEl({ text: "[[Alpha]] [[Beta]] ((abcdefghi)) x", originalText: "[[Alpha]] [[Beta]] ((abcdefghi)) x", width: 400 });
  const open = () => {
    const s = setup({ elements: [el], blocks: { abcdefghi: "hello block" } });
    s.fire(s.containerEl, "pointerdown", s.ev({ clientX: 435 }));
    s.fire(s.containerEl, "pointerup", s.ev({ clientX: 435 }));
    return s;
  };
  const key = (k, o = {}) => ({ key: k, stopped: false, preventDefault() {}, stopPropagation() { this.stopped = true; }, ...o });
  let s = open();
  let chooser = s.body.children[0];
  assert.equal(chooser.children[0].children[2].children[0].textContent, "hello block");
  const down = key("ArrowDown");
  chooser.fire("keydown", down);
  assert.equal(down.stopped, true);
  chooser.fire("keydown", key("Enter"));
  assert.deepEqual(s.navs, [{ target: { type: "page", title: "Beta" }, sidebar: false }]);
  assert.equal(chooser.removed, true);
  assert.equal(s.containerEl.focused, 0);
  s = open();
  chooser = s.body.children[0];
  chooser.fire("keydown", key("ArrowUp"));
  chooser.fire("keydown", key("Enter", { shiftKey: true }));
  assert.deepEqual(s.navs, [{ target: { type: "block", uid: "abcdefghi" }, sidebar: true }]);
  s = open();
  chooser = s.body.children[0];
  chooser.fire("keydown", key("Escape"));
  assert.equal(chooser.removed, true);
  assert.equal(s.containerEl.focused, 1);
});

test("missing targets toast and do not navigate", () => {
  const s = setup({ elements: [textEl({ text: "[[Nope]]", originalText: "[[Nope]]" })] });
  s.fire(s.containerEl, "pointerdown", s.ev({ clientX: 120 }));
  s.fire(s.containerEl, "pointerup", s.ev({ clientX: 120 }));
  assert.deepEqual(s.toasts, ["No page named Nope"]);
  const b = setup({ elements: [textEl({ text: "((abcdefghi))", originalText: "((abcdefghi))" })] });
  b.fire(b.containerEl, "pointerdown", b.ev({ clientX: 120 }));
  b.fire(b.containerEl, "pointerup", b.ev({ clientX: 120 }));
  assert.deepEqual(b.toasts, ["Block not found"]);
  assert.equal(b.navs.length + s.navs.length, 0);
});

test("tags navigate as pages; block refs as blocks", () => {
  const s = setup({ elements: [textEl({ text: "#Beta", originalText: "#Beta" })] });
  s.fire(s.containerEl, "pointerdown", s.ev({ clientX: 110 }));
  s.fire(s.containerEl, "pointerup", s.ev({ clientX: 110 }));
  assert.deepEqual(s.navs[0].target, { type: "page", title: "Beta" });
  const b = setup({ elements: [textEl({ text: "((abcdefghi))", originalText: "((abcdefghi))" })], blocks: { abcdefghi: "x" } });
  b.fire(b.containerEl, "pointerdown", b.ev({ clientX: 120 }));
  b.fire(b.containerEl, "pointerup", b.ev({ clientX: 120 }));
  assert.deepEqual(b.navs[0].target, { type: "block", uid: "abcdefghi" });
});

test("moved or long clicks are swallowed but do not navigate", () => {
  const moved = setup({ elements: [textEl()] });
  moved.fire(moved.containerEl, "pointerdown", moved.ev());
  const u = moved.ev({ clientX: 230 });
  moved.fire(moved.containerEl, "pointerup", u);
  assert.equal(u.stopped, 1);
  assert.equal(moved.navs.length, 0);
  const slow = setup({ elements: [textEl()] });
  slow.fire(slow.containerEl, "pointerdown", slow.ev());
  slow.setT(500);
  slow.fire(slow.containerEl, "pointerup", slow.ev());
  assert.equal(slow.navs.length, 0);
});

test("a pointerup without a claimed pointerdown is left alone", () => {
  const s = setup({ elements: [textEl()] });
  const u = s.ev();
  s.fire(s.containerEl, "pointerup", u);
  assert.equal(u.stopped, 0);
});

test("a pointerup from another pointer, or after a release outside the canvas, is not swallowed", () => {
  const other = setup({ elements: [textEl()] });
  other.fire(other.containerEl, "pointerdown", other.ev({ pointerId: 1 }));
  const foreign = other.ev({ pointerId: 2 });
  other.fire(other.containerEl, "pointerup", foreign);
  assert.equal(foreign.stopped, 0);
  assert.equal(other.navs.length, 0);
  const stale = setup({ elements: [textEl()] });
  stale.fire(stale.containerEl, "pointerdown", stale.ev({ pointerId: 1 }));
  stale.fire(stale.win, "pointerup", { target: { tagName: "DIV" } });
  const later = stale.ev({ pointerId: 1 });
  stale.fire(stale.containerEl, "pointerup", later);
  assert.equal(later.stopped, 0);
});

test("wheel over the chooser keeps it open; wheel elsewhere closes it", () => {
  const el = textEl({ text: "[[Alpha]] and [[Beta]] x", originalText: "[[Alpha]] and [[Beta]] x", width: 260 });
  const s = setup({ elements: [el] });
  s.fire(s.containerEl, "pointerdown", s.ev({ clientX: 330 }));
  s.fire(s.containerEl, "pointerup", s.ev({ clientX: 330 }));
  const chooser = s.body.children[0];
  const row = chooser.children[0].children[0];
  s.fire(s.doc, "wheel", { target: row });
  assert.equal(chooser.removed, false);
  s.fire(s.doc, "wheel", { target: {} });
  assert.equal(chooser.removed, true);
});

test("zoom and scroll are honoured", () => {
  const s = setup({ elements: [textEl()] });
  s.app.state.zoom = { value: 2 };
  s.app.state.scrollX = 10;
  s.app.state.scrollY = 20;
  // scene (200, 110) -> client ((200+10)*2, (110+20)*2)
  const d = s.ev({ clientX: 420, clientY: 260 });
  s.fire(s.containerEl, "pointerdown", d);
  assert.equal(d.prevented, 1);
});

test("hover class follows the modifier and clears on keyup, blur and dispose", () => {
  const s = setup({ elements: [textEl()] });
  s.fire(s.containerEl, "pointermove", s.ev());
  s.frames.shift()();
  assert.equal(s.classes.has("plexus-token-hover"), true);
  s.fire(s.win, "keyup", { key: "Meta" });
  assert.equal(s.classes.has("plexus-token-hover"), false);
  s.fire(s.containerEl, "pointermove", s.ev());
  s.frames.shift()();
  assert.equal(s.classes.has("plexus-token-hover"), true);
  s.fire(s.win, "blur", {});
  assert.equal(s.classes.has("plexus-token-hover"), false);
  s.fire(s.containerEl, "pointermove", s.ev());
  s.frames.shift()();
  s.fire(s.containerEl, "pointermove", s.ev({ metaKey: false }));
  assert.equal(s.classes.has("plexus-token-hover"), false);
});

test("pointermove without the modifier schedules nothing", () => {
  const s = setup({ elements: [textEl()] });
  s.fire(s.containerEl, "pointermove", s.ev({ metaKey: false }));
  assert.equal(s.frames.length, 0);
});

test("hover is off away from tokens", () => {
  const s = setup({ elements: [textEl()] });
  s.fire(s.containerEl, "pointermove", s.ev({ clientX: 120 }));
  s.frames.shift()();
  assert.equal(s.classes.has("plexus-token-hover"), false);
});

test("dispose removes every listener, the chooser and the class", () => {
  const el = textEl({ text: "[[Alpha]] [[Beta]] x", originalText: "[[Alpha]] [[Beta]] x" });
  const s = setup({ elements: [el] });
  s.fire(s.containerEl, "pointermove", s.ev({ clientX: 110 }));
  s.frames.shift()();
  s.fire(s.containerEl, "pointerdown", s.ev({ clientX: 295 }));
  s.fire(s.containerEl, "pointerup", s.ev({ clientX: 295 }));
  const chooser = s.body.children[0];
  s.dispose();
  assert.equal(chooser.removed, true);
  assert.equal(s.classes.size, 0);
  for (const o of [s.containerEl, s.win, s.doc]) {
    for (const list of Object.values(o.handlers)) assert.equal(list.length, 0);
  }
  s.dispose();
});
