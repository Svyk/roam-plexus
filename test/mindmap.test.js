import test from "node:test";
import assert from "node:assert/strict";
import {
  plainText, hasMarkup, wrapLines, nodeSize, layoutTree, nearestInDirection, treeFromPull, countHidden,
  visibleNodes, SIBLING_GAP, LEVEL_GAP, RADIAL_RADIUS, RADIAL_STEP, MAX_DISPLAY,
} from "../src/model/mindmap.js";

const res = (uid) => ({ abc: "ref **text**", loop: "((loop))", long: "x".repeat(100) }[uid] ?? null);

test("plainText rules", () => {
  assert.equal(plainText("a [[Page]] b", res), "a Page b");
  assert.equal(plainText("#[[Big Tag]] and #tag", res), "Big Tag and tag");
  assert.equal(plainText("**b** __i__ ^^h^^ ~~s~~", res), "b i h s");
  assert.equal(plainText("x {{[[TODO]]}} y {{a {{b}} c}} z", res), "x ⧉ y ⧉ z");
  assert.equal(plainText("see ((abc))", res), "see ref text");
  assert.equal(plainText("((long))", res), `${"x".repeat(59)}…`);
  assert.equal(plainText("((loop))", res), "…");
  assert.equal(plainText("((nope))", res), "…");
  assert.equal(plainText("![pic](http://x/y.png) [t](http://u)", res), "▣ pic t");
  assert.equal(plainText("a\nb", res), "a\nb");
  assert.equal(plainText("", res), "·");
  const long = plainText("y".repeat(400), res);
  assert.equal(long.length, MAX_DISPLAY);
  assert.ok(long.endsWith("…"));
  assert.equal(plainText("plain text", res), "plain text");
  assert.equal(plainText("issue #12 fixed", res), "issue 12 fixed");
});

test("hasMarkup agrees with plainText over random strings (round-trip invariant)", () => {
  const alphabet = ["a", "b", " ", "#", "[", "]", "(", ")", "*", "_", "^", "~", "{", "}", "!", "\n", "x1", "-", "/", "."];
  let seed = 12345;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let n = 0; n < 4000; n++) {
    const len = Math.floor(rand() * 14);
    let s = "";
    for (let i = 0; i < len; i++) s += alphabet[Math.floor(rand() * alphabet.length)];
    assert.equal(hasMarkup(s), plainText(s, res) !== s, JSON.stringify(s));
  }
  for (const s of ["", "plain", "[[a]]", "((abc))", "{{x}}", "y".repeat(300), "**a**", "[a](b)", "![a](b)", "#tag", "a\nb"]) {
    assert.equal(hasMarkup(s), plainText(s, res) !== s, JSON.stringify(s));
  }
  assert.equal(hasMarkup("plain words"), false);
});

const m = (s) => s.length * 10;

test("wrapLines: greedy, newline first, long words break by character", () => {
  assert.deepEqual(wrapLines("aa bb cc", 50, m), ["aa bb", "cc"]);
  assert.deepEqual(wrapLines("a\n\nb", 100, m), ["a", "", "b"]);
  assert.deepEqual(wrapLines("abcdefgh", 30, m), ["abc", "def", "gh"]);
  assert.deepEqual(wrapLines("hi abcdefgh", 30, m), ["hi", "abc", "def", "gh"]);
  assert.deepEqual(wrapLines("", 30, m), [""]);
});

test("nodeSize pads and uses line height 1.25", () => {
  const s = nodeSize("aaaa bbbb", 20, (str, fs) => str.length * fs / 2);
  assert.equal(s.lines.length, 1);
  assert.equal(s.textWidth, 90);
  assert.equal(s.width, 90 + 28);
  assert.equal(s.textHeight, 25);
  assert.equal(s.height, 25 + 20);
  const wrapped = nodeSize("word ".repeat(20).trim(), 16, (str, fs) => str.length * fs);
  assert.ok(wrapped.lines.length > 1);
  assert.ok(wrapped.textWidth <= 240);
  assert.equal(wrapped.text, wrapped.lines.join("\n"));
});

function mk(spec) {
  const [uid, kids = [], open = true] = spec;
  return { uid, string: uid, open, children: kids.map(mk) };
}
const fixedSizes = (tree, w = 100, h = 40) => {
  const s = {};
  for (const v of visibleNodes(tree)) s[v.node.uid] = { width: w, height: h };
  const stack = [tree];
  while (stack.length) { const n = stack.pop(); s[n.uid] = { width: w, height: h }; stack.push(...n.children); }
  return s;
};

test("layout right: stacked siblings, centered parent, level gap", () => {
  const tree = mk(["r", [["a", [["a1"], ["a2"]]], ["b"]]]);
  const p = layoutTree({ tree, sizes: fixedSizes(tree), layout: "right", root: { x: 10, y: 20 } });
  assert.deepEqual(p.r, { x: 10, y: 20 });
  assert.equal(p.a.x, 10 + 100 + LEVEL_GAP);
  assert.equal(p.a1.x, p.a.x + 100 + LEVEL_GAP);
  assert.equal(p.a2.y - p.a1.y, 40 + SIBLING_GAP);
  assert.equal(p.a.y + 20, (p.a1.y + p.a2.y + 40) / 2);
  assert.equal(p.b.y - p.a.y > 0, true);
  assert.equal(p.r.y + 20, ((p.a.y - 29) + (p.b.y + 40)) / 2);
});

test("layout left/down/up mirror the main axis", () => {
  const tree = mk(["r", [["a", [["a1"]]], ["b"]]]);
  const sizes = fixedSizes(tree);
  const l = layoutTree({ tree, sizes, layout: "left" });
  assert.equal(l.a.x, -100 - LEVEL_GAP);
  assert.equal(l.a1.x, l.a.x - 100 - LEVEL_GAP);
  const d = layoutTree({ tree, sizes, layout: "down" });
  assert.equal(d.a.y, 40 + LEVEL_GAP);
  assert.equal(d.b.x - d.a.x, 100 + SIBLING_GAP);
  const u = layoutTree({ tree, sizes, layout: "up" });
  assert.equal(u.a.y, -40 - LEVEL_GAP);
  assert.equal(u.a1.y, u.a.y - 40 - LEVEL_GAP);
});

test("layout radial: depth-1 on radius 220, deeper +180 within wedge", () => {
  const tree = mk(["r", [["a", [["a1"], ["a2"]]], ["b"], ["c"], ["d"]]]);
  const sizes = fixedSizes(tree, 100, 40);
  const p = layoutTree({ tree, sizes, layout: "radial", root: { x: 0, y: 0 } });
  const c = (u) => ({ x: p[u].x + 50, y: p[u].y + 20 });
  const rc = { x: 50, y: 20 };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  for (const u of ["a", "b", "c", "d"]) assert.ok(Math.abs(dist(c(u), rc) - RADIAL_RADIUS) < 1e-6);
  assert.ok(Math.abs(dist(c("a1"), c("a")) - RADIAL_STEP) < 1e-6);
  assert.ok(Math.abs(dist(c("a2"), c("a")) - RADIAL_STEP) < 1e-6);
  const ang = (a, b) => Math.atan2(a.y - b.y, a.x - b.x);
  const wedge = Math.PI / 2;
  const d1 = Math.abs(ang(c("a1"), rc) - ang(c("a"), rc));
  assert.ok(d1 < wedge / 2 + 0.6 * 0 + 1, "a1 stays near a's wedge");
  assert.ok(Math.abs(ang(c("b"), rc) - ang(c("a"), rc) - wedge) < 1e-6);
});

test("pinned subtree keeps position and lays out relative to it; fold hides descendants", () => {
  const tree = mk(["r", [["a", [["a1"], ["a2"]]], ["b", [["b1"]]]]]);
  const sizes = fixedSizes(tree);
  const p = layoutTree({ tree, sizes, layout: "right", pinned: { a: { x: 500, y: 500 } } });
  assert.deepEqual(p.a, { x: 500, y: 500 });
  assert.equal(p.a1.x, 500 + 100 + LEVEL_GAP);
  assert.equal(p.a.y + 20, (p.a1.y + p.a2.y + 40) / 2);
  const free = layoutTree({ tree, sizes, layout: "right", pinned: {} });
  assert.notDeepEqual(p.b, free.b, "pinned sibling no longer takes cross space");
  assert.equal(p.r.y + 20, p.b.y + 20, "root centers on its unpinned child only");
  const folded = mk(["r", [["a", [["a1"]], false], ["b"]]]);
  const f = layoutTree({ tree: folded, sizes: fixedSizes(folded), layout: "right" });
  assert.equal(f.a1, undefined);
  assert.ok(f.a && f.b);
  assert.equal(countHidden(folded.children[0]), 1);
});

test("nearestInDirection cone and distance", () => {
  const from = { id: "f", x: 0, y: 0, width: 10, height: 10 };
  const c = [
    { id: "r1", x: 100, y: 0, width: 10, height: 10 },
    { id: "r2", x: 50, y: 0, width: 10, height: 10 },
    { id: "rdiag", x: 30, y: 60, width: 10, height: 10 },
    { id: "d1", x: 0, y: 40, width: 10, height: 10 },
    { id: "l1", x: -80, y: 5, width: 10, height: 10 },
    { id: "u1", x: 3, y: -70, width: 10, height: 10 },
  ];
  assert.equal(nearestInDirection(from, c, "right"), "r2");
  assert.equal(nearestInDirection(from, c, "down"), "d1");
  assert.equal(nearestInDirection(from, c, "left"), "l1");
  assert.equal(nearestInDirection(from, c, "up"), "u1");
  assert.equal(nearestInDirection(from, [{ id: "rdiag", x: 30, y: 60, width: 10, height: 10 }], "right"), null);
  assert.equal(nearestInDirection(from, [{ id: "f", ...from }], "right"), null);
});

test("treeFromPull sorts by order, reads both key styles, excludes drawings, caps and prunes", () => {
  const pull = {
    ":block/uid": "r", ":block/string": "root", ":block/open": true,
    ":block/children": [
      { ":block/uid": "b", ":block/string": "B", ":block/order": 1 },
      { ":block/uid": "a", ":block/string": "A", ":block/order": 0, ":block/open": false, ":block/children": [{ ":block/uid": "a1", ":block/string": "A1", ":block/order": 0 }] },
      { ":block/uid": "d", ":block/string": "{{[[excalidraw]]}}", ":block/order": 2 },
      { ":block/uid": "r1", ":block/string": "{{[[plexus-regions]]}}", ":block/order": 3 },
      { uid: "e", string: "{{excalidraw}}", order: 4 },
    ],
  };
  const t = treeFromPull(pull);
  assert.deepEqual(t.children.map((c) => c.uid), ["a", "b"]);
  assert.equal(t.children[0].open, false);
  assert.equal(t.children[1].open, true);
  assert.equal(treeFromPull(pull, { prune: new Set(["a"]) }).children.length, 1);
  const c = treeFromPull(pull, { maxVisible: 2 });
  assert.equal(c.truncated, true);
  assert.equal(c.children.length, 1);
  assert.equal(treeFromPull({ ":block/uid": "x", ":block/string": "{{[[excalidraw]]}}" }), null);
  assert.equal(treeFromPull(null), null);
});

test("layout bench: 200 nodes", () => {
  const kids = [];
  let n = 1;
  for (let i = 0; i < 10; i++) {
    const sub = [];
    for (let j = 0; j < 19; j++) sub.push([`n${n++}`]);
    kids.push([`n${n++}`, sub]);
  }
  const tree = mk(["root", kids]);
  const sizes = fixedSizes(tree);
  assert.equal(Object.keys(sizes).length, 201);
  for (const layout of ["right", "radial"]) {
    layoutTree({ tree, sizes, layout });
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) layoutTree({ tree, sizes, layout });
    const ms = (performance.now() - t0) / 5;
    console.log(`[bench] layoutTree ${layout} 201 nodes: ${ms.toFixed(3)} ms`);
    assert.ok(ms < 50);
  }
});
