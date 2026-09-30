import assert from "node:assert/strict";
import test from "node:test";

import { showSpotlight } from "../src/view/spotlight.js";

const mkDoc = () => {
  const listeners = {};
  const added = [];
  return {
    listeners, added,
    createElement: () => ({ className: "", style: {}, removed: false, remove() { this.removed = true; } }),
    body: { append: (e) => added.push(e) },
    addEventListener(t, f) { (listeners[t] ||= []).push(f); },
    removeEventListener(t, f) { listeners[t] = (listeners[t] || []).filter((x) => x !== f); },
  };
};
const rect = { left: 1, top: 2, width: 3, height: 4 };

test("motion picks the pulse class, no motion the static one", () => {
  const a = mkDoc(); const offA = showSpotlight({ rect, doc: a });
  assert.match(a.added[0].className, /plexus-spotlight--pulse/);
  assert.equal(a.added[0].style.width, "3px");
  offA();
  const b = mkDoc(); const offB = showSpotlight({ rect, doc: b, motion: false });
  assert.match(b.added[0].className, /plexus-spotlight--static/);
  assert.doesNotMatch(b.added[0].className, /pulse/);
  offB();
});

test("keydown (Esc), wheel and pointerdown end it and clean up; disposer is idempotent", () => {
  for (const type of ["keydown", "wheel", "pointerdown"]) {
    const doc = mkDoc();
    const off = showSpotlight({ rect, doc, durationMs: 100000 });
    doc.listeners[type][0]({ key: "Escape" });
    assert.equal(doc.added[0].removed, true);
    for (const list of Object.values(doc.listeners)) assert.equal(list.length, 0);
    off(); off();
  }
});

test("times out after durationMs", async () => {
  const doc = mkDoc();
  showSpotlight({ rect, doc, durationMs: 5 });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(doc.added[0].removed, true);
});
