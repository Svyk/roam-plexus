import assert from "node:assert/strict";
import test from "node:test";

import extension from "../src/extension.js";

// A permissive fake DOM: enough for the extension to mount an editor and for the real dock to build inside it.
const matchOne = (n, sel) => {
  const m = /^([a-z]+)?((?:\.[\w-]+|:not\(\.[\w-]+\)|\[id\^="[^"]*"\])*)$/i.exec(sel.trim());
  if (!m) return false;
  if (m[1] && n.tagName !== m[1].toUpperCase()) return false;
  for (const part of m[2].match(/\.[\w-]+|:not\(\.[\w-]+\)|\[id\^="[^"]*"\]/g) ?? []) {
    if (part.startsWith(".")) { if (!n.classList.contains(part.slice(1))) return false; }
    else if (part.startsWith(":not")) { if (n.classList.contains(part.slice(6, -1))) return false; }
    else if (!String(n.id).startsWith(/"([^"]*)"/.exec(part)[1])) return false;
  }
  return true;
};
const matches = (n, sel) => sel.split(",").some((s) => matchOne(n, s));

class Listeners {
  constructor() { this.list = []; }
  addEventListener(type, fn, opts) { this.list.push({ type, fn, capture: typeof opts === "object" ? !!opts?.capture : !!opts }); }
  removeEventListener(type, fn, opts) {
    const capture = typeof opts === "object" ? !!opts?.capture : !!opts;
    const i = this.list.findIndex((l) => l.type === type && l.fn === fn && l.capture === capture);
    if (i >= 0) this.list.splice(i, 1);
  }
}

class FakeNode extends Listeners {
  constructor(tag, doc) {
    super();
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = doc;
    this.nodeType = 1;
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.dataset = {};
    this.attrs = {};
    this.id = "";
    this.textContent = "";
    this._classes = new Set();
    this.classList = {
      add: (...c) => c.forEach((x) => this._classes.add(x)),
      remove: (...c) => c.forEach((x) => this._classes.delete(x)),
      contains: (c) => this._classes.has(c),
      toggle: (c, on) => { if (on ?? !this._classes.has(c)) this._classes.add(c); else this._classes.delete(c); },
    };
  }
  get className() { return [...this._classes].join(" "); }
  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get parentElement() { return this.parentNode; }
  get isConnected() { for (let n = this; n; n = n.parentNode) if (n === this.ownerDocument) return true; return false; }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  hasAttribute(k) { return k in this.attrs; }
  removeAttribute(k) { delete this.attrs[k]; }
  append(...c) { for (const n of c) this.insertBefore(n, null); }
  appendChild(n) { this.insertBefore(n, null); return n; }
  insertBefore(n, ref) {
    if (n.parentNode) n.parentNode.children.splice(n.parentNode.children.indexOf(n), 1);
    n.parentNode = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(n); else this.children.splice(i, 0, n);
  }
  remove() {
    if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
    this.parentNode = null;
  }
  all() { const out = []; for (const c of this.children) out.push(c, ...c.all()); return out; }
  querySelectorAll(sel) { return this.all().filter((n) => matches(n, sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  getElementsByClassName(c) { return this.all().filter((n) => n.classList.contains(c)); }
  closest(sel) { for (let n = this; n && n.tagName; n = n.parentNode) if (matches(n, sel)) return n; return null; }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30 }; }
  focus() {}
  blur() {}
  scrollIntoView() {}
  dispatchEvent() { return true; }
}

const UID = "drawing01";
const listenerCount = (...targets) => targets.reduce((n, t) => n + t.list.length, 0);

function build() {
  const warnings = [];
  const view = Object.assign(new Listeners(), {
    innerWidth: 1600,
    dispatchEvent: () => true,
    getComputedStyle: () => ({ zIndex: "auto" }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    MutationObserver: undefined,
  });
  const doc = Object.assign(new FakeNode("#document", null), { defaultView: view });
  doc.ownerDocument = doc;
  doc.nodeType = 9;
  doc.body = new FakeNode("body", doc);
  doc.head = new FakeNode("head", doc);
  doc.documentElement = new FakeNode("html", doc);
  doc.append(doc.head, doc.body);
  doc.createElement = (tag) => new FakeNode(tag, doc);
  doc.activeElement = doc.body;

  const block = new FakeNode("div", doc);
  block.id = `block-input-w-body-outline-pg000001-${UID}`;
  const outer = new FakeNode("div", doc);
  outer.className = "excalidraw-outer-container full-screen";
  const editor = new FakeNode("div", doc);
  editor.className = "excalidraw";
  editor.__reactFiber$x = {
    stateNode: {
      state: { width: 800, theme: "light", selectedElementIds: {}, selectedGroupIds: {}, zoom: { value: 1 }, scrollX: 0, scrollY: 0 },
      updateScene() {},
      getSceneElementsIncludingDeleted: () => [],
      getSceneElements: () => [],
      actionManager: {},
      onChangeEmitter: { on: () => () => {} },
    },
  };
  block.append(outer);
  outer.append(editor);

  const observers = [];
  class FakeMO {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe(target, opts) { this.target = target; this.opts = opts; }
    disconnect() {}
  }
  const mountEditor = () => { doc.body.append(block); doc.body.mounted = true; };
  const realQuery = doc.body.querySelectorAll.bind(doc.body);
  doc.body.querySelectorAll = (sel) => (sel === ".excalidraw-outer-container.full-screen .excalidraw"
    ? (block.isConnected ? [editor] : [])
    : realQuery(sel));
  doc.querySelector = (sel) => (sel === ".excalidraw-outer-container.full-screen .excalidraw" ? (block.isConnected ? editor : null) : doc.body.querySelector(sel));

  const pulls = { children: [{ ":block/uid": "child0001", ":block/order": 0 }] };
  const api = {
    graph: { name: "g", isEncrypted: true },
    util: { generateUID: () => "x" },
    data: {
      pull: (pattern, ident) => {
        if (String(ident).includes(UID) && String(pattern).includes("children")) return { ":block/children": pulls.children };
        return null;
      },
      addPullWatch() {},
      removePullWatch() {},
    },
    ui: {
      components: {
        renderBlock: ({ el, uid }) => { const n = doc.createElement("div"); n.className = "rm-block__input"; n.id = `block-input-w-${uid}`; el.append(n); },
        unmountNode() {},
      },
    },
  };
  return { doc, view, block, outer, editor, observers, mountEditor, api, warnings, FakeMO, pulls };
}

async function withRuntime(fn) {
  const env = build();
  const saved = {};
  const keys = ["document", "roamAlphaAPI", "MutationObserver", "window"];
  for (const k of keys) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
  Object.defineProperty(globalThis, "document", { value: env.doc, configurable: true, writable: true });
  Object.defineProperty(globalThis, "roamAlphaAPI", { value: env.api, configurable: true, writable: true });
  Object.defineProperty(globalThis, "MutationObserver", { value: env.FakeMO, configurable: true, writable: true });
  Object.defineProperty(globalThis, "window", { value: env.view, configurable: true, writable: true });
  const warn = console.warn;
  console.warn = (...args) => { env.warnings.push(args.map(String).join(" ")); };
  const values = new Map();
  const callbacks = new Map();
  const extensionAPI = {
    settings: {
      canSet: true,
      get: (k) => values.get(k) ?? null,
      set: async (k, v) => { values.set(k, v); },
      panel: { create: async () => null },
    },
    ui: { commandPalette: { addCommand: async ({ label, callback }) => { callbacks.set(label, callback); }, removeCommand: async () => null } },
  };
  let captured = null;
  let cleaned = false;
  try {
    const cleanup = await extension.onload({
      extensionAPI,
      extension: { version: "t" },
      openCommandList: (o) => { captured = o; return { close() {} }; },
    });
    const runCommand = (label) => {
      callbacks.get("Plexus: Commands\u2026")();
      return captured.commands.find((c) => c.label === label).run(captured.ctx);
    };
    await fn({ env, runCommand, unload: async () => { cleaned = true; await cleanup(); } });
  } finally {
    if (!cleaned) await extension.onunload();
    console.warn = warn;
    for (const k of keys) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; }
  }
}

const docks = (env) => env.doc.body.all().filter((n) => n.classList.contains("plexus-dock"));
const styles = (env) => env.doc.head.all().filter((n) => n.tagName === "STYLE" && "data-plexus-dock" in n.attrs);
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

test("dock lifecycle: one dock per mount, and unmount, remount and unload leave nothing behind", async () => {
  await withRuntime(async ({ env, runCommand, unload }) => {
    const discovery = () => env.observers.find((o) => o.opts?.childList && o.target === env.doc.body);
    const listeners = () => env.doc.list.length + env.view.list.length + env.doc.body.list.length;
    const before = listeners();
    const mount = () => { env.doc.body.append(env.block); discovery().cb([{ addedNodes: [env.block], removedNodes: [] }]); };
    const unmount = () => { env.block.remove(); discovery().cb([{ addedNodes: [], removedNodes: [env.block] }]); };
    const clean = (label) => {
      assert.equal(docks(env).length, 0, `${label}: no dock`);
      assert.equal(styles(env).length, 0, `${label}: no dock style`);
      assert.equal(env.doc.body.classList.contains("plexus-dock-open"), false, `${label}: body class`);
      assert.equal(env.outer.classList.contains("plexus-dock-narrowed"), false, `${label}: outer class`);
    };

    mount();
    await flush();
    runCommand("Toggle outline dock");
    await flush();
    assert.equal(docks(env).length, 1);
    assert.equal(styles(env).length, 1);
    assert.equal(env.doc.body.classList.contains("plexus-dock-open"), true);
    assert.equal(env.outer.classList.contains("plexus-dock-narrowed"), true);

    unmount();
    await flush();
    clean("after unmount");
    assert.equal(listeners(), before, "unmount removes every document, window and body listener");

    mount();
    await flush();
    assert.equal(docks(env).length, 1, "the dock reopens on remount, exactly once");
    assert.equal(styles(env).length, 1);

    await unload();
    await flush();
    clean("after unload");
    assert.ok(listeners() <= before, "unload leaves no dock listener behind");
    assert.deepEqual(env.warnings.filter((w) => /failed/.test(w)), [], env.warnings.join("\n"));
  });
});
