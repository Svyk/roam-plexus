import test from "node:test";
import assert from "node:assert/strict";
import { createMeasurer, fontString } from "../src/host/measure.js";

function fakeDoc({ fonts } = {}) {
  const calls = [];
  const ctx = { font: "", measureText(t) { calls.push([this.font, t]); return { width: t.length * 10 }; } };
  return { calls, createElement: () => ({ getContext: () => ctx }), fonts };
}

test("font string matches Excalidraw family 5", () => {
  assert.equal(fontString(20), "20px Excalifont, Xiaolai, sans-serif, Segoe UI Emoji");
});

test("measure memoizes by font|text", () => {
  const doc = fakeDoc();
  const m = createMeasurer({ doc });
  assert.equal(m.measure("abc", 20), 30);
  assert.equal(m.measure("abc", 20), 30);
  assert.equal(doc.calls.length, 1);
  m.measure("abc", 16);
  assert.equal(doc.calls.length, 2);
  assert.equal(doc.calls[0][0], fontString(20));
});

test("memo is an LRU capped at 2000", () => {
  const doc = fakeDoc();
  const m = createMeasurer({ doc });
  for (let i = 0; i < 2100; i++) m.measure(`t${i}`, 16);
  assert.equal(m.size(), 2000);
  const before = doc.calls.length;
  m.measure("t2099", 16);
  assert.equal(doc.calls.length, before);
  m.measure("t0", 16);
  assert.equal(doc.calls.length, before + 1);
});

test("no canvas falls back to an estimate", () => {
  const m = createMeasurer({ doc: { createElement: () => ({ getContext: () => null }) } });
  assert.equal(m.measure("abcd", 10), 24);
});

test("ensureFonts clears memo only when new faces loaded", async () => {
  let loaded = false;
  const loads = [];
  const fonts = { check: () => loaded, load: async (f, t) => { loads.push([f, t]); const r = loaded ? [] : [{}]; loaded = true; return r; } };
  const doc = fakeDoc({ fonts });
  const m = createMeasurer({ doc });
  m.measure("x", 20);
  assert.equal(await m.ensureFonts(["ab", "cd"], 20), true);
  assert.deepEqual(loads[0], [fontString(20), "abcd"]);
  assert.equal(m.size(), 0);
  m.measure("x", 20);
  assert.equal(await m.ensureFonts(["ab"], 20), false);
  assert.equal(m.size(), 1);
});
