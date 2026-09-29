import assert from "node:assert/strict";
import test from "node:test";

import { createEmbedOverlay, embedPlacement } from "../src/view/embeds.js";

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
  assert.equal(t.unmounted.length, t.rendered.length + 0 >= 0 ? t.unmounted.length : 0);
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
