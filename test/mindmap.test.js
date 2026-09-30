import test from "node:test";
import assert from "node:assert/strict";
import {
  plainText, hasMarkup, wrapLines, nodeSize, layoutTree, nearestInDirection, treeFromPull, countHidden,
  visibleNodes, SIBLING_GAP, LEVEL_GAP, RADIAL_RADIUS, RADIAL_STEP, MAX_DISPLAY,
  LAYOUTS, CAUSE_LAYOUTS, isHiddenString, isExcludedString, taskParts, taskState, tagColor, editableText, visualTree,
  fishboneLayout, FLOW_LAYOUT, drawnTree, flowParts, flowEditable, isDecision, laneOf, branchLabel, isFolded,
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

// ---- Phase 12 ----

test("LAYOUTS stays five; CAUSE_LAYOUTS lists cause and fishbone", () => {
  assert.deepEqual([...LAYOUTS], ["right", "down", "left", "up", "radial"]);
  assert.deepEqual([...CAUSE_LAYOUTS], ["cause", "fishbone"]);
});

test("taskParts / taskState: exact macro plus at most one space", () => {
  assert.deepEqual(taskParts("{{[[TODO]]}} buy milk"), { state: "TODO", prefix: "{{[[TODO]]}} ", rest: "buy milk" });
  assert.deepEqual(taskParts("{{[[DONE]]}}"), { state: "DONE", prefix: "{{[[DONE]]}}", rest: "" });
  assert.deepEqual(taskParts("{{[[TODO]]}}  two"), { state: "TODO", prefix: "{{[[TODO]]}} ", rest: " two" });
  assert.equal(taskState("x {{[[TODO]]}}"), null);
  assert.equal(taskState("{{[[todo]]}} x"), null);
  assert.equal(taskState("plain"), null);
  assert.equal(taskState("{{[[DONE]]}} a"), "DONE");
});

test("plainText shows task glyphs; hasMarkup stays in step with plainText (P4 invariant 16)", () => {
  assert.equal(plainText("{{[[TODO]]}} buy [[milk]]", res), "☐ buy milk");
  assert.equal(plainText("{{[[DONE]]}} done", res), "☑ done");
  assert.equal(plainText("{{[[TODO]]}}", res), "☐");
  assert.equal(plainText("a {{[[TODO]]}}", res), "a ⧉");
  for (const s of ["{{[[TODO]]}} x", "{{[[DONE]]}}", "{{[[TODO]]}} {{[[DONE]]}} y", "{{[[TODO]]}} #t", "{{[[TODO]]}}x"]) {
    assert.equal(hasMarkup(s), plainText(s, res) !== s, s);
    assert.equal(hasMarkup(s), true);
  }
  assert.equal(hasMarkup(taskParts("{{[[TODO]]}} plain words").rest), false);
});

test("isHiddenString hides BT_attr blocks from the tree, but isExcludedString is unchanged", () => {
  assert.equal(isHiddenString("BT_attrDue:: [[Sept 1st, 2026]]"), true);
  assert.equal(isHiddenString("  BT_attrGTD:: Someday"), true);
  assert.equal(isHiddenString("BT_attr"), false);
  assert.equal(isHiddenString("my BT_attrX:: y"), false);
  assert.equal(isExcludedString("BT_attrDue:: x"), false);
  const pull = {
    ":block/uid": "r", ":block/string": "root",
    ":block/children": [
      { ":block/uid": "t", ":block/string": "{{[[TODO]]}} task", ":block/order": 0, ":block/children": [
        { ":block/uid": "d", ":block/string": "BT_attrDue:: [[x]]", ":block/order": 0 },
        { ":block/uid": "k", ":block/string": "kid", ":block/order": 1 },
      ] },
    ],
  };
  const t = treeFromPull(pull);
  assert.deepEqual(t.children[0].children.map((c) => c.uid), ["k"]);
  assert.equal(treeFromPull({ ":block/uid": "r", ":block/string": "BT_attrX:: root" }).uid, "r");
});

test("tagColor: first coloured tag in text order; macro counts as todo / done; case-insensitive", () => {
  const map = new Map([["urgent", "#ffc9c9"], ["done", "#b2f2bb"], ["todo", "#eee"], ["big tag", "#123456"]]);
  assert.equal(tagColor("fix #Urgent now", map), "#ffc9c9");
  assert.equal(tagColor("#[[Big Tag]] x", map), "#123456");
  assert.equal(tagColor("#plain #urgent", map), "#ffc9c9");
  assert.equal(tagColor("{{[[DONE]]}} ship", map), "#b2f2bb");
  assert.equal(tagColor("{{[[TODO]]}} ship #urgent", map), "#eee");
  assert.equal(tagColor("issue#urgent", map), undefined);
  assert.equal(tagColor("nothing", map), undefined);
  assert.equal(tagColor("#urgent", new Map()), undefined);
  assert.equal(tagColor("#urgent", undefined), undefined);
});

test("editableText: strips fold suffix, star and glyph; puts the task prefix back; null for markup and no-ops", () => {
  const plain = { uid: "a", string: "alpha", open: true, children: [] };
  assert.equal(editableText(plain, "beta"), "beta");
  assert.equal(editableText(plain, "alpha"), null);
  assert.equal(editableText(plain, ""), null);
  assert.equal(editableText(plain, "·"), null);
  const folded = { uid: "a", string: "alpha", open: false, children: [{ uid: "b", string: "b", open: true, children: [] }] };
  assert.equal(editableText(folded, "beta (+1)"), "beta");
  assert.equal(editableText(folded, "beta"), null);
  const task = { uid: "t", string: "{{[[TODO]]}} buy", open: true, children: [] };
  assert.equal(editableText(task, "☐ buy milk"), "{{[[TODO]]}} buy milk");
  assert.equal(editableText(task, "buy"), null);
  assert.equal(editableText(task, "☐"), null);
  const done = { uid: "t", string: "{{[[DONE]]}} buy", open: true, children: [] };
  assert.equal(editableText(done, "☑ sell"), "{{[[DONE]]}} sell");
  const root = { uid: "r", string: "why", open: true, children: [] };
  assert.equal(editableText(root, "★ because", { star: true }), "because");
  assert.equal(editableText(root, "★ because"), "★ because");
  assert.equal(editableText({ uid: "m", string: "a [[b]]", open: true, children: [] }, "a b c"), null);
  assert.equal(editableText({ uid: "m", string: "{{[[TODO]]}} a [[b]]", open: true, children: [] }, "☐ a b c"), null);
});

const S = (uid, kids = [], string, open = true) => ({ uid, string: string ?? uid, open, children: kids });
const paths = (t) => visibleNodes(t).map((v) => `${v.parent ? v.parent.uid : "-"}>${v.node.uid}${v.node.edgeLabel ? `[${v.node.edgeLabel}|${v.node.via}]` : ""}`);

test("visualTree: off returns the same tree; on splices carrier children with edgeLabel and via", () => {
  const tree = S("r", [S("a", [S("c", [S("x"), S("y")], "Causes::"), S("z")]), S("b")]);
  assert.equal(visualTree(tree, { attrEdges: false }), tree);
  assert.equal(visualTree(tree), tree);
  const v = visualTree(tree, { attrEdges: true });
  assert.deepEqual(paths(v), ["->r", "r>a", "a>x[Causes|c]", "a>y[Causes|c]", "a>z", "r>b"]);
  assert.equal(tree.children[0].children.length, 2, "input not mutated");
  assert.equal(v.children[1], tree.children[1], "untouched subtrees are shared");
});

test("visualTree: carrier conditions", () => {
  const t = (kids) => S("r", [S("a", kids)]);
  const drawn = (tree) => paths(visualTree(tree, { attrEdges: true })).join(",");
  // empty carrier, collapsed carrier, BT_attr, colon in name, long name, text after :: stay ordinary nodes
  assert.match(drawn(t([S("c", [], "Empty::")])), /a>c/);
  assert.match(drawn(t([S("c", [S("x")], "Folded::", false)])), /a>c/);
  assert.match(drawn(t([S("c", [S("x")], "BT_attrDue::")])), /a>c/);
  assert.match(drawn(t([S("c", [S("x")], "A:B::")])), /a>c/);
  assert.match(drawn(t([S("c", [S("x")], `${"n".repeat(61)}::`)])), /a>c/);
  assert.match(drawn(t([S("c", [S("x")], "Name:: value")])), /a>c/);
  assert.match(drawn(t([S("c", [S("x")], "`code`::")])), /a>c/);
  assert.match(drawn(t([S("c", [S("x")], "{{x}}::")])), /a>c/);
  assert.equal(drawn(t([S("c", [S("x")], `${"n".repeat(60)}::`)])).includes("a>c"), false);
  assert.equal(drawn(t([S("c", [S("x")], "  Spaced ::  ")])).includes("a>c"), false);
  // root is never a carrier; nested carrier under a carrier is an ordinary node
  const rootCarrier = S("r", [S("x")], "Root::");
  assert.equal(visualTree(rootCarrier, { attrEdges: true }), rootCarrier);
  const nested = paths(visualTree(t([S("c", [S("d", [S("x")], "Inner::")], "Outer::")]), { attrEdges: true })).join(",");
  assert.match(nested, /a>d\[Outer\|c\]/);
  assert.match(nested, /d>x/);
  // folded parents keep their raw children (fold count is the raw count)
  const foldedParent = S("r", [S("a", [S("c", [S("x")], "K::")], "a", false)]);
  const fv = visualTree(foldedParent, { attrEdges: true });
  assert.equal(countHidden(fv.children[0]), 2);
});

test("visualTree keeps truncated and labels are plain text", () => {
  const tree = { ...S("r", [S("c", [S("x")], "[[Caused]] by::")]), truncated: true };
  const v = visualTree(tree, { attrEdges: true });
  assert.equal(v.truncated, true);
  assert.equal(v.children[0].edgeLabel, "Caused by");
});

test("layoutTree gapOf: default unchanged, per-child gap along the axis", () => {
  const tree = mk(["r", [["a", [["a1"]]], ["b"]]]);
  const sizes = fixedSizes(tree);
  assert.deepEqual(layoutTree({ tree, sizes, layout: "right", gapOf: () => LEVEL_GAP }), layoutTree({ tree, sizes, layout: "right" }));
  const wide = layoutTree({ tree, sizes, layout: "right", gapOf: (uid) => (uid === "a1" ? 200 : LEVEL_GAP) });
  assert.equal(wide.a1.x, wide.a.x + 100 + 200);
  const l = layoutTree({ tree, sizes, layout: "left", gapOf: () => 120 });
  assert.equal(l.a.x, -100 - 120);
  const d = layoutTree({ tree, sizes, layout: "down", gapOf: () => 90 });
  assert.equal(d.a.y, 40 + 90);
});

test("layout cause is the left layout", () => {
  const tree = mk(["r", [["a", [["a1"]]], ["b"]]]);
  const sizes = fixedSizes(tree);
  assert.deepEqual(layoutTree({ tree, sizes, layout: "cause", root: { x: 5, y: 7 } }), layoutTree({ tree, sizes, layout: "left", root: { x: 5, y: 7 } }));
});

test("fishbone: a pinned rib keeps its pin, its bones do not move, and a second pass is identical", () => {
  const tree = mk(["r", [["a", [["a1", [["a1x"]]], ["a2"]]], ["b", [["b1"]]], ["c"]]]);
  const sizes = fixedSizes(tree);
  const base = fishboneLayout({ tree, sizes, root: { x: 1000, y: 500 } });
  const pin = { x: 695, y: 397 };
  const fb = fishboneLayout({ tree, sizes, root: { x: 1000, y: 500 }, pinned: { a1: pin } });
  assert.deepEqual(fb.positions.a1, pin);
  for (const u of ["b", "b1"]) assert.deepEqual(fb.positions[u], base.positions[u], u);
  assert.ok(fb.positions.a1x.x < pin.x);
  const again = fishboneLayout({ tree, sizes, root: { x: 1000, y: 500 }, pinned: fb.positions });
  assert.deepEqual(again.positions, fb.positions);
});

test("fishbone: head at the anchor, bones alternate, subtrees clear the spine, slots do not overlap", () => {
  const tree = mk(["r", [["a", [["a1"], ["a2"]]], ["b", [["b1"]]], ["c"], ["d", [["d1"], ["d2"], ["d3"]]], ["e"]]]);
  const sizes = fixedSizes(tree);
  const fb = fishboneLayout({ tree, sizes, root: { x: 1000, y: 500 } });
  assert.deepEqual(fb.positions.r, { x: 1000, y: 500 });
  assert.equal(fb.spine.y, 520);
  assert.equal(fb.spine.x2, 1000);
  assert.equal(fb.spine.x1, fb.positions.e.x);
  const above = ["a", "c", "e"];
  const below = ["b", "d"];
  for (const u of above) assert.ok(fb.positions[u].y + 40 <= 520 - 50 + 1e-9, `${u} above`);
  for (const u of below) assert.ok(fb.positions[u].y >= 520 + 50 - 1e-9, `${u} below`);
  for (const u of ["a", "b", "c", "d", "e"]) assert.equal(fb.positions[u].x + 100, fb.slotX[u] - 40, `${u} right edge`);
  assert.equal(fb.slotX.a, fb.slotX.b);
  assert.ok(fb.slotX.c < fb.slotX.a && fb.slotX.e < fb.slotX.c);
  // ribs are left of their bone
  assert.ok(fb.positions.a1.x < fb.positions.a.x);
  assert.deepEqual(layoutTree({ tree, sizes, layout: "fishbone", root: { x: 1000, y: 500 } }), fb.positions);
  // no causes: no spine
  const lone = mk(["r"]);
  assert.equal(fishboneLayout({ tree: lone, sizes: fixedSizes(lone) }).spine, null);
});

// ---- P13: the flow names are reachable from mindmap.js and leave the other layouts alone ----

test("flow exports live on mindmap.js; FLOW_LAYOUT is not in LAYOUTS or CAUSE_LAYOUTS", () => {
  assert.equal(FLOW_LAYOUT, "flow");
  assert.ok(!LAYOUTS.includes(FLOW_LAYOUT) && !CAUSE_LAYOUTS.includes(FLOW_LAYOUT));
  for (const f of [drawnTree, flowParts, flowEditable, isDecision, laneOf, branchLabel]) assert.equal(typeof f, "function");
});

test("drawnTree: non-flow layouts return exactly visualTree; the raw pull tree keeps Lane:: blocks", () => {
  const pull = { ":block/uid": "R", ":block/string": "Root", ":block/children": [
    { ":block/uid": "a", ":block/string": "A", ":block/order": 0, ":block/children": [{ ":block/uid": "l", ":block/string": "Lane:: QA", ":block/order": 0 }] },
  ] };
  const tree = treeFromPull(pull);
  assert.equal(tree.children[0].children.length, 1, "treeFromPull does not hide Lane::");
  for (const layout of ["right", "cause", "fishbone", "radial"]) assert.equal(drawnTree(tree, { layout }), tree);
  assert.deepEqual(drawnTree(tree, { layout: "right", attrEdges: true }), visualTree(tree, { attrEdges: true }));
  assert.equal(drawnTree(tree, { layout: "flow" }).children[0].children.length, 0);
});

test("editableText is unchanged for a folded node (raw descendant count) while flow counts drawn descendants", () => {
  const node = { uid: "f", string: "Fold", open: false, children: [{ uid: "l", string: "Lane:: X", open: true, children: [] }, { uid: "k", string: "k", open: true, children: [] }] };
  assert.ok(isFolded(node));
  assert.equal(editableText(node, "Fold two (+2)"), "Fold two");
  const drawn = drawnTree({ uid: "R", string: "R", open: true, children: [node] }, { layout: "flow" }).children[0];
  assert.equal(flowEditable(drawn, "Fold two (+1)"), "Fold two");
  assert.equal(flowEditable(drawn, "Fold two (+2)"), null);
});
