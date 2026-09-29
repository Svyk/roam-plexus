import assert from "node:assert/strict";
import test from "node:test";

import { createCropPopover } from "../src/view/crop-popover.js";
import { resetThemeMemo } from "../src/host/theme.js";

const flush = () => new Promise((r) => setTimeout(r, 5));

function setup() {
  resetThemeMemo();
  const docL = {};
  const winL = {};
  const body = { kids: [], append(n) { this.kids.push(n); n.isConnected = true; } };
  const doc = {
    body,
    createElement: () => ({ style: {}, classes: "", set className(v) { this.classes = v; }, get className() { return this.classes; }, append(n) { this.child = n; }, remove() { this.isConnected = false; } }),
    addEventListener: (t, f) => { docL[t] = f; },
    removeEventListener: (t) => { delete docL[t]; },
    defaultView: { innerWidth: 1000, innerHeight: 800, addEventListener: (t, f) => { winL[t] = f; }, removeEventListener: (t) => { delete winL[t]; } },
  };
  const al = {};
  const anchor = { isConnected: true, addEventListener: (t, f) => { al[t] = f; }, removeEventListener: (t) => { delete al[t]; }, getBoundingClientRect: () => ({ left: 100, top: 100, bottom: 120 }) };
  return { doc, docL, winL, body, anchor, al };
}

test("hover shows a portal below the anchor and hides on leave; listeners exist only while shown", async () => {
  const { doc, docL, winL, body, anchor, al } = setup();
  const p = createCropPopover({ doc, delayMs: 1 });
  p.hoverOn(anchor, async () => ({ url: "blob:x", w: 960, h: 720, invertible: true }));
  assert.equal(body.kids.length, 0);
  al.mouseenter();
  await flush();
  const portal = body.kids[0];
  assert.equal(portal.className, "plexus-portal plexus-crop-popover");
  assert.equal(portal.style.top, "126px");
  assert.equal(portal.child.style.width, "480px");
  assert.equal(portal.child.style.height, "360px");
  assert.ok(docL.mousedown && winL.scroll);
  al.mouseleave();
  assert.equal(portal.isConnected, false);
  assert.deepEqual([Object.keys(docL), Object.keys(winL)], [[], []]);
});

test("flips above when there is no room and a late result after leave is dropped", async () => {
  const { doc, body, anchor, al } = setup();
  anchor.getBoundingClientRect = () => ({ left: 990, top: 700, bottom: 790 });
  const p = createCropPopover({ doc, delayMs: 1 });
  p.hoverOn(anchor, async () => ({ url: "blob:x", w: 200, h: 100 }));
  al.mouseenter();
  await flush();
  assert.equal(body.kids[0].style.top, `${700 - 6 - 100}px`);
  assert.equal(body.kids[0].style.left, "796px");
  p.hide();
  let release;
  p.hoverOn(anchor, () => new Promise((r) => { release = r; }));
  al.mouseenter();
  await flush();
  al.mouseleave();
  release({ url: "blob:late", w: 10, h: 10 });
  await flush();
  assert.equal(body.kids.length, 1);
});

test("dispose removes hover listeners and a shown portal", async () => {
  const { doc, docL, body, anchor, al } = setup();
  const p = createCropPopover({ doc, delayMs: 1 });
  p.hoverOn(anchor, async () => ({ url: "blob:x", w: 10, h: 10 }));
  al.mouseenter();
  await flush();
  p.dispose();
  assert.equal(body.kids[0].isConnected, false);
  assert.deepEqual([Object.keys(al), Object.keys(docL)], [[], []]);
});
