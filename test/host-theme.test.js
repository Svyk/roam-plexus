import assert from "node:assert/strict";
import test from "node:test";

import { isHostDark, luminance, parseColor, resetThemeMemo } from "../src/host/theme.js";

const el = (classes = [], bg = "rgba(0, 0, 0, 0)") => ({ classList: { contains: (c) => classes.includes(c) }, bg });
const mk = ({ html = [], body = [], htmlBg, bodyBg } = {}) => {
  const documentElement = el(html, htmlBg);
  const b = el(body, bodyBg);
  return {
    documentElement,
    body: b,
    defaultView: { getComputedStyle: (e) => ({ backgroundColor: e.bg ?? "rgba(0, 0, 0, 0)" }) },
  };
};

test("parseColor and luminance", () => {
  assert.deepEqual(parseColor("rgb(10, 20, 30)"), { r: 10, g: 20, b: 30, a: 1 });
  assert.equal(parseColor("rgba(0, 0, 0, 0)").a, 0);
  assert.equal(parseColor("transparent"), null);
  assert.ok(luminance({ r: 255, g: 255, b: 255 }) > 0.99);
});

test("class markers win, in any of the A26 places", () => {
  for (const d of [mk({ html: ["bp3-dark"] }), mk({ body: ["bp3-dark"] }), mk({ body: ["bt-theme-dark"] }), mk({ html: ["rm-dark-theme"] }), mk({ body: ["rm-dark-theme"] }), mk({ body: ["roam-body", "dark"] })]) {
    resetThemeMemo();
    assert.equal(isHostDark(d), true);
  }
});

test("luminance sampling walks body then html; transparent is skipped", () => {
  resetThemeMemo();
  assert.equal(isHostDark(mk({ bodyBg: "rgb(30, 30, 30)" })), true);
  resetThemeMemo();
  assert.equal(isHostDark(mk({ bodyBg: "rgb(250, 250, 250)" })), false);
  resetThemeMemo();
  assert.equal(isHostDark(mk({ htmlBg: "rgb(20, 20, 20)" })), true);
  resetThemeMemo();
  assert.equal(isHostDark(mk()), false);
});

test("no body gives false; the result is memoized for a second", () => {
  resetThemeMemo();
  assert.equal(isHostDark({}), false);
  resetThemeMemo();
  const d = mk({ bodyBg: "rgb(0, 0, 0)" });
  assert.equal(isHostDark(d), true);
  d.body.bg = "rgb(255, 255, 255)";
  assert.equal(isHostDark(d), true);
});
