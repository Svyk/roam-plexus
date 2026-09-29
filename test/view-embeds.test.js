import assert from "node:assert/strict";
import test from "node:test";

import { createEmbedOverlay, embedPlacement, installEmbedF2 } from "../src/view/embeds.js";

function fakeEl() {
  const el = {
    style: {}, children: [], className: "", textContent: "", removed: false, attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    append(...c) { this.children.push(...c); },
    remove() { this.removed = true; },
  };
  return el;
}

function setup({ elements, content } = {}) {
  const body = fakeEl();
  const frames = [];
  const doc = {
    body,
    defaultView: { requestAnimationFrame: (cb) => { frames.push(cb); return frames.length; }, cancelAnimationFrame() {} },
    createElement: () => fakeEl(),
  };
  const rendered = [];
  const unmounted = [];
  const api = { ui: { components: {
    renderString: ({ el, string }) => rendered.push([el, string]),
    unmountNode: ({ el }) => unmounted.push(el),
  } } };
  const watches = [];
  const host = {
    pullEmbedContent: async (ref) => content ?? { kind: "block", uid: "abcdefghi", title: "Page", string: `s ${ref}`, children: [{ string: "c1", children: [{ string: "c2" }] }] },
    watchEmbed: (uid, cb) => { const w = { uid, cb, off: false }; watches.push(w); return () => { w.off = true; }; },
  };
  const subs = { on: 0, off: 0 };
  const app = {
    state: { scrollX: 0, scrollY: 0, zoom: { value: 2 }, offsetLeft: 0, offsetTop: 0 },
    elements: elements ?? [{ id: "e1", type: "rectangle", x: 10, y: 20, width: 100, height: 50, angle: 0, isDeleted: false, customData: { plexus: { embed: "((abcdefghi))" } } }],
    getSceneElementsIncludingDeleted() { return this.elements; },
  };
  const subscribe = (_app, cb) => { subs.on += 1; subs.cb = cb; return () => { subs.off += 1; }; };
  const containerEl = { getBoundingClientRect: () => ({ left: 0, top: 0, right: 1000, bottom: 800 }) };
  const overlay = createEmbedOverlay({ doc, api, host, app, containerEl, subscribe });
  const flush = async () => { while (frames.length) frames.shift()(); await new Promise((r) => setTimeout(r, 0)); };
  return { overlay, body, frames, rendered, unmounted, watches, subs, app, flush };
}

test("embedPlacement transforms scene to viewport with zoom and clips to the container", () => {
  const appState = { scrollX: 0, scrollY: 0, zoom: { value: 2 } };
  const el = { x: 10, y: 20, width: 100, height: 50, angle: 0 };
  const p = embedPlacement(el, appState, { left: 0, top: 0, right: 1000, bottom: 800 });
  assert.equal(p.transform, "translate(20px, 40px) scale(2) rotate(0rad)");
  assert.equal(p.clip, null);
  const q = embedPlacement(el, appState, { left: 60, top: 0, right: 1000, bottom: 800 });
  assert.equal(q.clip, "inset(0px 0px 0px 20px)");
  const gone = embedPlacement(el, appState, { left: 500, top: 0, right: 1000, bottom: 800 });
  assert.equal(gone.hidden, true);
});

test("overlay creates a portal, renders content, watches the uid, and coalesces frames", async () => {
  const t = setup();
  assert.equal(t.frames.length, 1);
  await t.flush();
  assert.equal(t.overlay.portalCount(), 1);
  assert.equal(t.body.children.length, 1);
  assert.equal(t.body.children[0].style.transform, "translate(20px, 40px) scale(2) rotate(0rad)");
  assert.deepEqual(t.rendered.map((r) => r[1]), ["s ((abcdefghi))", "c1", "c2"]);
  assert.equal(t.watches.length, 1);
  t.subs.cb(); t.subs.cb(); t.subs.cb();
  assert.equal(t.frames.length, 1);
  t.app.state.scrollX = 100;
  await t.flush();
  assert.equal(t.body.children[0].style.transform, "translate(220px, 40px) scale(2) rotate(0rad)");
  t.overlay.dispose();
});

test("render budget is capped at 30 blocks", async () => {
  const children = Array.from({ length: 50 }, (_, i) => ({ string: `k${i}` }));
  const t = setup({ content: { kind: "block", uid: "abcdefghi", title: "T", string: "root", children } });
  await t.flush();
  assert.equal(t.rendered.length, 30);
  t.overlay.dispose();
});

test("a deleted anchor removes its portal and watch; dispose leaves nothing behind", async () => {
  const t = setup();
  await t.flush();
  t.app.elements = [];
  t.subs.cb();
  await t.flush();
  assert.equal(t.overlay.portalCount(), 0);
  assert.equal(t.body.children[0].removed, true);
  assert.equal(t.watches[0].off, true);
  t.app.elements = [{ id: "e2", type: "rectangle", x: 0, y: 0, width: 10, height: 10, isDeleted: false, customData: { plexus: { embed: "((abcdefghi))" } } }];
  t.subs.cb();
  await t.flush();
  assert.equal(t.overlay.portalCount(), 1);
  t.overlay.dispose();
  assert.equal(t.overlay.portalCount(), 0);
  assert.equal(t.subs.off, 1);
  assert.ok(t.watches.every((w) => w.off));
  assert.ok(t.body.children.every((c) => c.removed));
  assert.equal(new Set(t.unmounted).size, t.unmounted.length, "no host unmounted twice");
  for (const [el] of t.rendered) assert.ok(t.unmounted.includes(el), "every renderString host unmounted");
  t.subs.cb();
  assert.equal(t.frames.length, 0);
});

test("a watch callback re-renders that portal on the next frame", async () => {
  const t = setup();
  await t.flush();
  const before = t.rendered.length;
  t.watches[0].cb();
  await t.flush();
  assert.ok(t.rendered.length > before);
  t.overlay.dispose();
});

test("no anchors means no portals and no reads", async () => {
  const t = setup({ elements: [] });
  await t.flush();
  assert.equal(t.body.children.length, 0);
  t.overlay.dispose();
});

test("portal data-theme follows the editor theme and updates on change", async () => {
  const t = setup();
  t.app.state.theme = "light";
  await t.flush();
  const root = t.body.children[0];
  assert.equal(root.attrs["data-theme"], "light");
  t.app.state.theme = "dark";
  t.subs.cb();
  await t.flush();
  assert.equal(root.attrs["data-theme"], "dark");
});

test("CSS keys the embed theme on data-theme, not on Roam classes", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(new URL("../src/extension.css", import.meta.url), "utf8");
  assert.match(css, /\.plexus-portal\.plexus-embed\[data-theme="light"\]/);
  assert.match(css, /\.plexus-portal\.plexus-embed\[data-theme="dark"\]/);
  assert.doesNotMatch(css, /bp3-dark \.plexus-portal\.plexus-embed|bt-theme-dark \.plexus-portal\.plexus-embed|not\(\.bp3-light\) \.plexus-portal\.plexus-embed/);
});

test("block embed header is the containing page title, not the block text; page embed keeps its title", async () => {
  const block = setup({ content: { kind: "block", uid: "abcdefghi", title: "", pageTitle: "Host Page", string: "the block text", children: [] } });
  await block.flush();
  assert.equal(block.body.children[0].children[0].textContent, "Host Page");
  const noPage = setup({ content: { kind: "block", uid: "abcdefghi", title: "", pageTitle: "", string: "the block text", children: [] } });
  await noPage.flush();
  assert.equal(noPage.body.children[0].children[0].textContent, "");
  const page = setup({ content: { kind: "page", uid: "abcdefghi", title: "My Page", string: "", children: [] } });
  await page.flush();
  assert.equal(page.body.children[0].children[0].textContent, "My Page");
});

// ---- edit mode ----

function node(tag, doc) {
  const n = {
    tagName: String(tag).toUpperCase(), style: {}, children: [], className: "", textContent: "", id: "", attrs: {},
    parentNode: null, listeners: {}, value: "", selectionStart: 0, selectionEnd: 0, removed: false,
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; },
    append(...c) { for (const x of c) { x.parentNode = this; this.children.push(x); } },
    remove() {
      this.removed = true;
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((x) => x !== this);
      this.parentNode = null;
    },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); },
    dispatchEvent(ev) { ev.target = this; ev.stopPropagation = () => { ev.stopped = true; }; for (let n = this; n && !ev.stopped; n = n.parentNode) for (const fn of [...(n.listeners[ev.type] || [])]) fn(ev); return true; },
    all() { return this.children.flatMap((c) => [c, ...c.all()]); },
    querySelectorAll(sel) {
      if (sel === ".rm-block__input") return this.all().filter((c) => c.className === "rm-block__input");
      if (sel === "textarea") return this.all().filter((c) => c.tagName === "TEXTAREA");
      return [];
    },
    closest() { return null; },
    focus() { doc.activeElement = this; },
    blur() { doc.log.push("blur"); if (doc.activeElement === this) doc.activeElement = doc.body; },
    setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; },
  };
  return n;
}

// Dispatches a bubbling event; returns the event. Roots stop propagation via ev.stopPropagation().
function bubble(target, type, extra = {}) {
  const ev = { type, target, stopped: false, prevented: false, stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; this.prevented = true; }, ...extra };
  for (let n = target; n && !ev.stopped; n = n.parentNode) for (const fn of [...(n.listeners[type] || [])]) fn(ev);
  return ev;
}

function editSetup({ elements } = {}) {
  const log = [];
  const doc = { log, activeElement: null, menuOpen: false, docListeners: [] };
  doc.body = node("body", doc);
  doc.activeElement = doc.body;
  doc.createElement = (tag) => node(tag, doc);
  doc.querySelector = () => (doc.menuOpen ? {} : null);
  doc.addEventListener = (type, fn, cap) => doc.docListeners.push({ type, fn, cap });
  doc.removeEventListener = (type, fn) => { doc.docListeners = doc.docListeners.filter((l) => !(l.type === type && l.fn === fn)); };
  const winListeners = [];
  const frames = [];
  doc.defaultView = {
    requestAnimationFrame: (cb) => { frames.push(cb); return frames.length; }, cancelAnimationFrame() {},
    addEventListener: (type, fn, cap) => winListeners.push({ type, fn, cap }),
    removeEventListener: (type, fn) => { const i = winListeners.findIndex((l) => l.type === type && l.fn === fn); if (i >= 0) winListeners.splice(i, 1); },
    MouseEvent: class { constructor(type) { this.type = type; } },
  };
  const rendered = [];
  const unmounted = [];
  const blocks = [];
  const api = {
    data: new Proxy({}, { get() { throw new Error("graph access during edit"); } }),
    ui: { components: {
      renderString: ({ el, string }) => rendered.push([el, string]),
      renderBlock: ({ uid, el }) => {
        log.push("renderBlock");
        blocks.push({ uid, el });
        const input = doc.createElement("div");
        input.className = "rm-block__input";
        input.id = `block-input-w-${uid}`;
        const ta = doc.createElement("textarea");
        ta.id = `block-input-w-${uid}`;
        ta.value = "hello";
        input.append(ta);
        input.addEventListener("click", () => ta.focus());
        el.append(input);
      },
      unmountNode: ({ el }) => { log.push("unmount"); unmounted.push(el); },
    } },
  };
  const watches = [];
  const host = {
    pullEmbedContent: async () => { log.push("pull"); return { kind: "block", uid: "abcdefghi", title: "P", string: "s", children: [] }; },
    watchEmbed: (uid, cb) => { const w = { cb }; watches.push(w); return () => {}; },
  };
  const hooks = {};
  const updates = [];
  const anchor = (id, ref) => ({ id, type: "rectangle", x: 10, y: 20, width: 100, height: 50, angle: 0, isDeleted: false, customData: { plexus: { embed: ref } } });
  const app = {
    state: { scrollX: 0, scrollY: 0, zoom: { value: 2 }, offsetLeft: 0, offsetTop: 0, selectedElementIds: { e1: true }, selectedGroupIds: {} },
    elements: elements ?? [anchor("e1", "((abcdefghi))")],
    getSceneElementsIncludingDeleted() { return this.elements; },
    updateScene(u) { updates.push(u); if (u.appState) Object.assign(this.state, u.appState); },
  };
  const containerEl = doc.createElement("div");
  containerEl.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 800, width: 1000 });
  containerEl.focus = () => { log.push("focus-container"); };
  const subs = {};
  const overlay = createEmbedOverlay({
    doc, api, host, app, containerEl, subscribe: (_a, cb) => { subs.cb = cb; return () => {}; },
    sleep: async (ms) => { log.push(`sleep${ms}`); hooks.onSleep?.(ms); },
    waitQuiet: () => (hooks.quiet ? hooks.quiet() : Promise.resolve()),
  });
  const flush = async () => { while (frames.length) frames.shift()(); await new Promise((r) => setTimeout(r, 0)); };
  const key = (target, k, extra = {}) => {
    const ev = { type: "keydown", key: k, target, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...extra };
    for (const l of [...winListeners].filter((x) => x.type === "keydown")) if (!ev.stopped) l.fn(ev);
    return ev;
  };
  const down = (target) => { for (const l of [...doc.docListeners].filter((x) => x.type === "pointerdown")) l.fn({ type: "pointerdown", target }); };
  return { hooks, overlay, doc, api, log, rendered, unmounted, blocks, watches, updates, app, flush, key, down, subs, winListeners, containerEl };
}

async function entered(t) {
  await t.flush();
  const root = t.doc.body.children[0];
  const ok = await t.overlay.edit("e1");
  return { root, ok };
}

test("edit mode mounts renderBlock, focuses the root textarea, and reports state", async () => {
  const t = editSetup();
  const { root, ok } = await entered(t);
  assert.equal(ok, true);
  assert.equal(t.overlay.editState(), "active");
  assert.equal(t.overlay.isEditing(), true);
  assert.deepEqual(t.blocks.map((b) => b.uid), ["abcdefghi"]);
  assert.match(root.className, /plexus-embed--editing/);
  assert.equal(root.style.transform, "");
  assert.equal(root.style.clipPath, "");
  assert.equal(root.style.pointerEvents, "auto");
  assert.equal(t.doc.activeElement.tagName, "TEXTAREA");
  assert.equal(root.attrs["aria-hidden"], undefined);
  assert.deepEqual(t.updates.map((u) => Object.keys(u)), [["appState"]]);
  await t.overlay.dispose();
});

test("edit mode: keys and pointers typed in the editor never reach Excalidraw's document handlers", async () => {
  const t = editSetup();
  const { root } = await entered(t);
  const seen = [];
  t.doc.body.addEventListener("keydown", (e) => seen.push(e.type));
  const ta = t.doc.activeElement;
  // Up events only stop for a gesture that started inside.
  const outsideUp = bubble(ta, "pointerup");
  assert.equal(outsideUp.stopped, false);
  for (const type of ["keydown", "keyup", "keypress", "input", "paste", "copy", "cut", "pointerdown", "mousedown", "dblclick", "wheel"]) bubble(ta, type);
  assert.deepEqual(seen, []);
  bubble(ta, "pointerdown");
  assert.equal(bubble(ta, "pointerup").stopped, true);
  assert.ok(root.listeners.keydown.length >= 1);
  await t.overlay.dispose();
});

test("edit mode makes zero graph writes and no scene element updates", async () => {
  const t = editSetup();
  await entered(t);
  t.watches[0].cb();
  t.subs.cb();
  await t.flush();
  await t.overlay.leave("keyboard");
  assert.ok(t.updates.every((u) => Object.keys(u).length === 1 && "appState" in u), "only selection updates");
  await t.overlay.dispose();
});

test("leave order: blur, container focus (keyboard), 300 ms wait, unmount, then a fresh read-only load", async () => {
  const t = editSetup();
  await entered(t);
  t.log.length = 0;
  await t.overlay.leave("keyboard");
  const at = (x) => t.log.indexOf(x);
  assert.ok(at("blur") >= 0 && at("blur") < at("focus-container"));
  assert.ok(at("focus-container") < at("sleep300"));
  assert.ok(at("sleep300") < at("unmount"));
  assert.ok(at("unmount") < at("pull"));
  assert.equal(t.overlay.editState(), "idle");
  await t.flush();
  assert.ok(t.rendered.length > 0, "read-only content rendered again");
  const root = t.doc.body.children[0];
  assert.equal(root.attrs["aria-hidden"], "true");
  assert.doesNotMatch(root.className, /editing/);
  assert.equal(t.updates.length, 2, "selection cleared on enter, restored on keyboard leave");
  assert.deepEqual(t.updates[1].appState.selectedElementIds, { e1: true });
  await t.overlay.dispose();
});

test("a pointer leave does not restore the selection or move focus to the container", async () => {
  const t = editSetup();
  await entered(t);
  t.log.length = 0;
  t.down(t.doc.body);
  await t.overlay.leave();
  assert.ok(!t.log.includes("focus-container"));
  assert.equal(t.updates.length, 1);
  await t.overlay.dispose();
});

test("watch callbacks mid-edit neither unmount the inner element nor render strings", async () => {
  const t = editSetup();
  await entered(t);
  const inner = t.blocks[0].el;
  const renders = t.rendered.length;
  t.watches[0].cb();
  await t.flush();
  assert.equal(t.unmounted.includes(inner), false);
  assert.equal(t.rendered.length, renders);
  await t.overlay.leave("api");
  await t.flush();
  assert.ok(t.rendered.length > renders, "one fresh load after the leave");
  await t.overlay.dispose();
});

test("edit mode: menu-navigation keys reach the document only while a Roam menu is open", async () => {
  const t = editSetup();
  await entered(t);
  const ta = t.doc.activeElement;
  const seen = [];
  t.doc.body.addEventListener("keydown", (e) => seen.push(e.key));
  t.doc.menuOpen = true;
  for (const k of ["Escape", "ArrowDown", "Enter"]) bubble(ta, "keydown", { key: k });
  bubble(ta, "keydown", { key: "e" });
  assert.deepEqual(seen, ["Escape", "ArrowDown", "Enter"]);
  seen.length = 0;
  t.doc.menuOpen = false;
  for (const k of ["Escape", "ArrowDown", "Enter", "e"]) bubble(ta, "keydown", { key: k });
  assert.deepEqual(seen, []);
  await t.overlay.dispose();
});

test("Esc: with a menu open the key passes through, without one it leaves once", async () => {
  const t = editSetup();
  await entered(t);
  const ta = t.doc.activeElement;
  t.doc.menuOpen = true;
  const passed = t.key(ta, "Escape");
  assert.equal(passed.prevented, undefined);
  assert.equal(t.overlay.editState(), "active");
  t.doc.menuOpen = false;
  const swallowed = t.key(ta, "Escape");
  assert.equal(swallowed.stopped, true);
  t.key(ta, "Escape");
  await t.overlay.leave();
  assert.equal(t.overlay.editState(), "idle");
  assert.equal(t.unmounted.filter((el) => el === t.blocks[0].el).length, 1, "leave is idempotent");
  await t.overlay.dispose();
});

test("Enter on the root leaves; Tab, Backspace at 0 and second Cmd+A are swallowed", async () => {
  const t = editSetup();
  await entered(t);
  const ta = t.doc.activeElement;
  ta.selectionStart = 0; ta.selectionEnd = 0;
  assert.equal(t.key(ta, "Tab").stopped, true);
  assert.equal(t.key(ta, "Backspace").stopped, true);
  ta.selectionStart = 0; ta.selectionEnd = ta.value.length;
  assert.equal(t.key(ta, "a", { metaKey: true }).stopped, true);
  ta.selectionStart = 2; ta.selectionEnd = 2;
  assert.equal(t.key(ta, "x").stopped, undefined);
  assert.equal(t.key(ta, "Enter").stopped, true);
  await t.overlay.leave();
  assert.equal(t.overlay.editState(), "idle");
  await t.overlay.dispose();
});

test("focus falling to body after the click: Delete is swallowed, focus restored, no leave", async () => {
  const t = editSetup();
  await entered(t);
  t.doc.activeElement = t.doc.body;
  const excal = [];
  t.doc.body.addEventListener("keydown", (e) => excal.push(e.key));
  const ev = t.key(t.doc.body, "Delete");
  assert.equal(ev.stopped, true);
  assert.equal(t.doc.activeElement.tagName, "TEXTAREA");
  assert.equal(t.overlay.editState(), "active");
  assert.deepEqual(excal, []);
  await t.overlay.dispose();
});

test("a pointerdown outside leaves; one inside the overlay does not", async () => {
  const t = editSetup();
  const { root } = await entered(t);
  t.down(t.doc.activeElement);
  await Promise.resolve();
  assert.equal(t.overlay.editState(), "active");
  t.down(t.doc.body);
  await t.overlay.leave();
  assert.equal(t.overlay.editState(), "idle");
  assert.ok(root);
  await t.overlay.dispose();
});

test("only one overlay edits at a time and page refs are read-only", async () => {
  const anchor = (id, ref) => ({ id, type: "rectangle", x: 0, y: 0, width: 50, height: 50, angle: 0, isDeleted: false, customData: { plexus: { embed: ref } } });
  const t = editSetup({ elements: [anchor("e1", "((abcdefghi))"), anchor("e2", "((bcdefghij))"), anchor("e3", "[[A Page]]")] });
  await t.flush();
  assert.equal(await t.overlay.edit("e1"), true);
  assert.equal(await t.overlay.edit("e2"), false);
  await t.overlay.leave();
  assert.equal(await t.overlay.edit("e3"), false);
  await t.overlay.dispose();
});

test("an anchor deleted mid-edit leaves first, then its portal is removed", async () => {
  const t = editSetup();
  await entered(t);
  const inner = t.blocks[0].el;
  t.app.elements = [];
  t.subs.cb();
  await t.flush();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(t.overlay.portalCount(), 0);
  assert.equal(t.unmounted.filter((el) => el === inner).length, 1);
  await t.overlay.dispose();
});

test("unload while editing leaves cleanly: one unmount, no portals, no listeners", async () => {
  const t = editSetup();
  await entered(t);
  const inner = t.blocks[0].el;
  const p = t.overlay.dispose();
  assert.ok(p && typeof p.then === "function");
  await p;
  assert.equal(t.overlay.portalCount(), 0);
  assert.equal(t.unmounted.filter((el) => el === inner).length, 1);
  assert.equal(inner.removed, true);
  assert.equal(t.winListeners.length, 0);
  assert.equal(t.doc.docListeners.length, 0);
  assert.equal(t.doc.body.children.length, 0);
});

test("dispose while idle is synchronous in effect and returns a resolved promise", async () => {
  const t = editSetup();
  await t.flush();
  const p = t.overlay.dispose();
  assert.equal(t.overlay.portalCount(), 0);
  await p;
});

test("installEmbedF2 acts only for a plain F2 on the container with an editable selection", async () => {
  const listeners = [];
  const containerEl = { addEventListener: (t, f) => listeners.push(f), removeEventListener() {} };
  let can = false;
  let edits = 0;
  const off = installEmbedF2({ containerEl, app: { state: {} }, canEdit: () => can, onEdit: () => { edits += 1; } });
  const fire = (extra) => { const ev = { key: "F2", target: containerEl, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...extra }; listeners[0](ev); return ev; };
  assert.equal(fire({}).stopped, undefined);
  can = true;
  assert.equal(fire({ repeat: true }).stopped, undefined);
  assert.equal(fire({ shiftKey: true }).stopped, undefined);
  assert.equal(fire({ target: {} }).stopped, undefined);
  assert.equal(fire({}).stopped, true);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(edits, 1);
  assert.equal(typeof off, "function");
});

test("Esc and an outside pointerdown while the editor is still entering cancel the session; other outside keys are swallowed", async () => {
  for (const cancel of ["esc", "pointer"]) {
    const t = editSetup();
    await t.flush();
    let release;
    t.hooks.quiet = () => new Promise((r) => { release = r; });
    const p = t.overlay.edit("e1");
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(t.overlay.editState(), "entering");
    assert.ok(t.winListeners.length > 0 && t.doc.docListeners.length > 0, "capture listeners installed at entry");
    assert.equal(t.key(t.doc.body, "r").stopped, true, "hotkey kept from Excalidraw");
    assert.equal(t.overlay.editState(), "entering");
    if (cancel === "esc") t.key(t.doc.body, "Escape"); else t.down(t.doc.body);
    release();
    assert.equal(await p, false);
    await t.overlay.leave();
    assert.equal(t.overlay.editState(), "idle");
    assert.equal(t.winListeners.length, 0);
    assert.equal(t.doc.docListeners.length, 0);
    await t.overlay.dispose();
  }
});

test("block-select keys are swallowed in a child block textarea too; Tab is left to Roam there", async () => {
  const t = editSetup();
  await entered(t);
  const child = t.doc.createElement("textarea");
  child.id = "block-input-w-childuid01";
  child.value = "kid";
  t.blocks[0].el.append(child);
  child.focus();
  child.selectionStart = 0; child.selectionEnd = 0;
  assert.equal(t.key(child, "ArrowUp", { shiftKey: true }).stopped, true);
  child.selectionStart = 3; child.selectionEnd = 3;
  assert.equal(t.key(child, "ArrowDown", { shiftKey: true }).stopped, true);
  assert.equal(t.key(child, "Tab").stopped, undefined);
  await t.overlay.dispose();
});

test("keyboard leave does not overwrite a selection the user made during the 300 ms wait", async () => {
  const t = editSetup();
  await entered(t);
  t.hooks.onSleep = () => { t.app.state.selectedElementIds = { e2: true }; };
  await t.overlay.leave("keyboard");
  assert.equal(t.updates.length, 1, "only the clear on enter");
  assert.deepEqual(t.app.state.selectedElementIds, { e2: true });
  await t.overlay.dispose();
});

function selectionSetup(t, entries) {
  const state = { entries };
  const events = [];
  t.api.ui.multiselect = { getSelected: async () => state.entries };
  t.doc.dispatchEvent = (ev) => { events.push(ev); state.entries = []; };
  t.doc.defaultView.KeyboardEvent = class { constructor(type, init) { this.type = type; Object.assign(this, init); } };
  return { state, events };
}

test("leave clears Roam block selection that belongs to the mount with one synthetic Escape", async () => {
  const t = editSetup();
  await entered(t);
  const sel = selectionSetup(t, [{ "block-uid": "abcdefghi", "window-id": "render-block-path-abcdefghi-uuid1" }, { "block-uid": "c1", "window-id": "render-block-path-abcdefghi-uuid1" }]);
  await t.overlay.leave("keyboard");
  assert.equal(sel.events.length, 1);
  assert.equal(sel.events[0].type, "keydown");
  assert.equal(sel.events[0].key, "Escape");
  assert.equal(sel.events[0].keyCode, 27);
  assert.equal(sel.events[0].bubbles, true);
  assert.ok(t.log.includes("sleep100"));
  await t.overlay.dispose();
});

test("leave never dispatches Escape for another window's selection", async () => {
  const t = editSetup();
  await entered(t);
  const sel = selectionSetup(t, [{ "block-uid": "zzzzzzzzz", "window-id": "main-window" }]);
  await t.overlay.leave("keyboard");
  assert.equal(sel.events.length, 0);
  await t.overlay.dispose();
});

test("a missing multiselect API leaves without throwing or dispatching", async () => {
  const t = editSetup();
  await entered(t);
  let dispatched = 0;
  t.doc.dispatchEvent = () => { dispatched += 1; };
  await t.overlay.leave("keyboard");
  assert.equal(dispatched, 0);
  await t.overlay.dispose();
});
