import assert from "node:assert/strict";
import test from "node:test";

import { isDateAbbrev, parseNaturalDate } from "../src/model/dates.js";

const NOW = new Date(2026, 8, 29, 15, 30); // Tuesday 2026-09-29
const ymd = (d) => (d ? [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours()].join("-") : null);
const p = (t, now = NOW) => ymd(parseNaturalDate(t, now));

test("today, tomorrow, yesterday resolve to local midnight", () => {
  assert.equal(p("today"), "2026-9-29-0");
  assert.equal(p("Tomorrow"), "2026-9-30-0");
  assert.equal(p("  yesterday "), "2026-9-28-0");
});

test("a bare weekday and next weekday mean the next occurrence, never today", () => {
  assert.equal(p("tuesday"), "2026-10-6-0");
  assert.equal(p("next tuesday"), "2026-10-6-0");
  assert.equal(p("wed"), "2026-9-30-0");
  assert.equal(p("Friday"), "2026-10-2-0");
  assert.equal(p("next friday"), "2026-10-2-0");
  assert.equal(p("mon"), "2026-10-5-0");
  assert.equal(p("tues"), "2026-10-6-0");
  assert.equal(p("thur"), "2026-10-1-0");
  assert.equal(p("thurs"), "2026-10-1-0");
  assert.equal(p("sat"), "2026-10-3-0");
});

test("month and day forms with optional ordinals", () => {
  assert.equal(p("Sep 30"), "2026-9-30-0");
  assert.equal(p("30 Sep"), "2026-9-30-0");
  assert.equal(p("September 30"), "2026-9-30-0");
  assert.equal(p("sept 30"), "2026-9-30-0");
  assert.equal(p("oct 1st"), "2026-10-1-0");
  assert.equal(p("2nd dec"), "2026-12-2-0");
  assert.equal(p("DEC 25TH"), "2026-12-25-0");
});

test("invalid or partial input gives null", () => {
  for (const t of ["Feb 30", "sep 0", "sep 32", "tomorrow please", "sep 30 2026", "next", "next next friday", "su", "ma 3", "foo", "", "   ", "31 apr", "2026-09-30", "friday 5"]) {
    assert.equal(parseNaturalDate(t, NOW), null, t);
  }
  assert.equal(parseNaturalDate(null, NOW), null);
  assert.equal(parseNaturalDate("today", new Date("x")), null);
});

test("month-day uses the year of now", () => {
  assert.equal(p("jan 5", new Date(2027, 0, 1)), "2027-1-5-0");
  assert.equal(p("feb 29", new Date(2028, 0, 1)), "2028-2-29-0");
  assert.equal(p("feb 29", new Date(2027, 0, 1)), null);
});

test("calendar arithmetic survives a DST boundary", () => {
  const before = new Date(2026, 10, 1, 12); // Sunday 2026-11-01, US fall-back day
  assert.equal(p("tomorrow", before), "2026-11-2-0");
  assert.equal(p("next sunday", before), "2026-11-8-0");
  assert.equal(p("monday", before), "2026-11-2-0");
  const spring = new Date(2026, 2, 7, 23); // Saturday before spring-forward
  assert.equal(p("tomorrow", spring), "2026-3-8-0");
  assert.equal(p("mon", spring), "2026-3-9-0");
});

test("isDateAbbrev is true only for three-letter weekday or month prefixes", () => {
  assert.equal(isDateAbbrev("sat"), true);
  assert.equal(isDateAbbrev("Sep"), true);
  assert.equal(isDateAbbrev("sept"), false);
  assert.equal(isDateAbbrev("abc"), false);
});
