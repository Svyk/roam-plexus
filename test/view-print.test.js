import assert from "node:assert/strict";
import test from "node:test";

import { buildPrintDocument, downloadPngs, pngFileName, printPages } from "../src/view/print.js";

const pages = [
  { url: "blob:a", name: "One <b>", width: 1600, height: 900 },
  { url: "blob:b", name: "Two", width: 900, height: 1600 },
  { url: "blob:c", name: "Three", width: 1600, height: 900 },
];

test("16:9 document uses a valid @page size, content boxes minus 0.5 mm, and no blanket page-break", () => {
  const html = buildPrintDocument({ drawing: "My <Deck> & \"x\"", pages, size: "16:9" });
  assert.match(html, /@page\{size:254mm 142\.875mm;margin:0mm\}/);
  assert.doesNotMatch(html, /size:16:9/);
  assert.match(html, /\.pg\{width:253\.5mm;height:142\.375mm\}/);
  assert.match(html, /<title>My &lt;Deck&gt; &amp; &quot;x&quot; frames<\/title>/);
  assert.match(html, /\.pg:not\(:last-child\)\{break-after:page\}/);
  assert.doesNotMatch(html, /page-break-after/);
  assert.match(html, /print-color-adjust:exact/);
  assert.match(html, /body\{margin:0|html,body\{margin:0/);
  assert.match(html, /alt="One &lt;b&gt;"/);
  assert.equal((html.match(/<img /g) || []).length, 3);
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /max-width:100%;max-height:100%;object-fit:contain/);
  assert.match(html, /display:block/);
});

test("letter and A4 use named landscape and portrait pages chosen per image", () => {
  const html = buildPrintDocument({ drawing: "D", pages, size: "letter", margin: 10 });
  assert.match(html, /@page plx-l\{size:letter landscape;margin:10mm\}/);
  assert.match(html, /@page plx-p\{size:letter portrait;margin:10mm\}/);
  // landscape box: 279.4 - 20 - 0.5 by 215.9 - 20 - 0.5
  assert.match(html, /\.pg\.l\{page:plx-l;width:258\.9mm;height:195\.4mm\}/);
  assert.match(html, /\.pg\.p\{page:plx-p;width:195\.4mm;height:258\.9mm\}/);
  assert.deepEqual([...html.matchAll(/<div class="pg (\w)">/g)].map((m) => m[1]), ["l", "p", "l"]);
  const a4 = buildPrintDocument({ drawing: "D", pages: [], size: "a4", margin: 5 });
  assert.match(a4, /size:A4 landscape;margin:5mm/);
  assert.match(a4, /\.pg\.l\{page:plx-l;width:286\.5mm;height:199\.5mm\}/);
});

function fakePrintDoc({ imageStates } = {}) {
  const log = [];
  const iframe = {
    tag: "iframe", style: {}, removed: false,
    setAttribute() {}, remove() { this.removed = true; log.push("iframe-removed"); },
  };
  const winListeners = {};
  const imgs = (imageStates ?? pages.map(() => "loaded")).map((s) => {
    const l = {};
    return {
      src: "blob:x", complete: s === "loaded", naturalWidth: s === "loaded" ? 10 : 0, l,
      addEventListener(t, f) { l[t] = f; },
    };
  });
  const written = [];
  iframe.contentWindow = { focus() { log.push("focus"); }, addEventListener(t, f) { winListeners[t] = f; }, removeEventListener(t) { delete winListeners[t]; } };
  iframe.contentDocument = { open() { log.push("open"); }, write(h) { written.push(h); }, close() { log.push("close"); }, images: imgs };
  const doc = { body: { append(n) { log.push(`append:${n.tag}`); } }, createElement: () => iframe };
  const timers = [];
  const opts = { setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: (id) => { timers[id - 1] = null; } };
  return { doc, iframe, imgs, log, written, winListeners, timers, opts };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("printPages writes the document into a hidden iframe, prints its window, removes it after print returns", async () => {
  const f = fakePrintDoc();
  const printed = [];
  const job = printPages({ doc: f.doc, drawing: "D", pages, size: "16:9", print: (win) => { printed.push(win); }, ...f.opts });
  const r = await job.done;
  assert.deepEqual(r, { printed: true });
  assert.equal(printed[0], f.iframe.contentWindow);
  assert.equal(f.iframe.removed, true);
  assert.deepEqual(f.log.slice(0, 4), ["append:iframe", "open", "close", "focus"].slice(0, 1).concat(["open", "close"]).concat(["focus"]).slice(0, 4));
  assert.match(f.written[0], /<title>D frames<\/title>/);
  assert.equal(f.iframe.style.position, "fixed");
  assert.equal(f.iframe.style.width, "0");
  assert.equal(f.iframe.style.opacity, "0");
  assert.equal(f.iframe.style.pointerEvents, "none");
  assert.notEqual(f.iframe.style.display, "none");
  assert.equal(f.winListeners.afterprint, undefined);
});

test("printPages waits for images to load, and afterprint removes the iframe while print is still pending", async () => {
  const f = fakePrintDoc({ imageStates: ["loaded", "pending", "pending"] });
  let release;
  let started = false;
  const job = printPages({ doc: f.doc, drawing: "D", pages, print: () => { started = true; return new Promise((r) => { release = r; }); }, ...f.opts });
  await tick();
  assert.equal(started, false);
  for (const i of [1, 2]) { f.imgs[i].complete = true; f.imgs[i].naturalWidth = 5; f.imgs[i].l.load(); }
  await tick();
  assert.equal(started, true);
  f.winListeners.afterprint();
  assert.equal(f.iframe.removed, true);
  assert.deepEqual(await job.done, { printed: true });
  release();
});

test("an image error or the 15 s cap rejects without printing and removes the iframe", async () => {
  const f = fakePrintDoc({ imageStates: ["loaded", "pending", "loaded"] });
  let started = false;
  const job = printPages({ doc: f.doc, drawing: "D", pages, print: () => { started = true; }, ...f.opts });
  await tick();
  f.imgs[1].l.error();
  await assert.rejects(job.done, /failed to load/);
  assert.equal(started, false);
  assert.equal(f.iframe.removed, true);

  const g = fakePrintDoc({ imageStates: ["pending", "loaded", "loaded"] });
  const job2 = printPages({ doc: g.doc, drawing: "D", pages, print: () => { started = true; }, ...g.opts });
  await tick();
  const cap = g.timers.find((x) => x && x.ms === 15000);
  assert.ok(cap);
  cap.fn();
  await assert.rejects(job2.done, /in time/);
  assert.equal(started, false);
  assert.equal(g.iframe.removed, true);
});

test("dispose before ready removes the iframe, settles done, and never prints", async () => {
  const f = fakePrintDoc({ imageStates: ["pending", "pending", "pending"] });
  let started = false;
  const job = printPages({ doc: f.doc, drawing: "D", pages, print: () => { started = true; }, ...f.opts });
  await tick();
  job.dispose();
  assert.deepEqual(await job.done, { printed: false });
  assert.equal(f.iframe.removed, true);
  assert.equal(started, false);
});

test("the 60 s fallback removes a lingering iframe", async () => {
  const f = fakePrintDoc();
  const job = printPages({ doc: f.doc, drawing: "D", pages, print: () => new Promise(() => {}), ...f.opts });
  await tick();
  const fb = f.timers.find((x) => x && x.ms === 60000);
  assert.ok(fb);
  fb.fn();
  assert.deepEqual(await job.done, { printed: true });
  assert.equal(f.iframe.removed, true);
});

test("file names: zero-padded, unnamed frames, unsafe characters, 120 cap", () => {
  assert.equal(pngFileName("Deck", 0, 12, "Intro"), "Deck - 01 Intro.png");
  assert.equal(pngFileName("Deck", 2, 3, ""), "Deck - 3 Frame 3.png");
  assert.equal(pngFileName("Deck", 0, 100, "  "), "Deck - 001 Frame 1.png");
  assert.equal(pngFileName('a/b:c', 0, 1, 'x*y?"z<>|\\'), "a-b-c - 1 x-y--z----.png");
  assert.equal(pngFileName("", 0, 1, "F"), "Drawing - 1 F.png");
  const long = pngFileName("D", 0, 1, "x".repeat(300));
  assert.equal(long.length, 120);
  assert.ok(long.endsWith(".png"));
});

test("downloadPngs numbers by the frame's own index and the total when some frames are missing", () => {
  const names = [];
  const doc = { body: { append() {} }, createElement: () => ({ style: {}, click() { names.push(this.download); }, remove() {} }) };
  downloadPngs({
    doc, drawing: "D", total: 5, frames: [{ blob: "b1", name: "", index: 0 }, { blob: "b3", name: "", index: 2 }],
    createUrl: (b) => b, revokeUrl: () => {}, setTimer: () => 1, clearTimer: () => {},
  });
  assert.equal(names[0], "D - 1 Frame 1.png");
});

test("downloadPngs clicks one link per 250 ms, revokes 5 s after each click, and disposes the rest", async () => {
  const clicks = [];
  const created = [];
  const revoked = [];
  const timers = [];
  const doc = {
    body: { append() {} },
    createElement: () => ({ style: {}, click() { clicks.push({ href: this.href, download: this.download }); }, remove() {} }),
  };
  const frames = [{ blob: "b1", name: "One" }, { blob: "b2", name: "" }, { blob: "b3", name: "Three" }];
  const job = downloadPngs({
    doc, drawing: "D", frames,
    createUrl: (b) => { const u = `blob:${b}`; created.push(u); return u; },
    revokeUrl: (u) => revoked.push(u),
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimer: (id) => { timers[id - 1] = null; },
  });
  assert.equal(clicks.length, 1);
  assert.equal(clicks[0].download, "D - 1 One.png");
  const gap = () => timers.filter((x) => x && x.ms === 250);
  assert.equal(gap().length, 1);
  gap()[0].fn();
  assert.equal(clicks.length, 2);
  assert.equal(clicks[1].download, "D - 2 Frame 2.png");
  // fire the revoke timer of the first click
  const revokeTimer = timers.find((x) => x && x.ms === 5000);
  revokeTimer.fn();
  assert.deepEqual(revoked, ["blob:b1"]);
  job.dispose();
  assert.deepEqual(revoked.sort(), ["blob:b1", "blob:b2"]);
  assert.equal(await job.done, 2);
  assert.equal(clicks.length, 2);
  assert.equal(timers.filter((x) => x && x.ms === 250).length, 1, "only the already-fired gap timer remains; the pending one was cleared");
});

test("downloadPngs resolves with the count after the last click", async () => {
  const doc = { body: { append() {} }, createElement: () => ({ style: {}, click() {}, remove() {} }) };
  const timers = [];
  const job = downloadPngs({
    doc, drawing: "D", frames: [{ blob: 1, name: "a" }, { blob: 2, name: "b" }],
    createUrl: (b) => `blob:${b}`, revokeUrl() {},
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer() {},
  });
  timers.find((x) => x.ms === 250).fn();
  assert.equal(await job.done, 2);
});
