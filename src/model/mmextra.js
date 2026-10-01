// Batch 13 mind-map helpers. Pure. No DOM and no Roam calls.

export const PASTE_CAP = 40;
export const CROSS_CAP = 12;

export const PALETTES = Object.freeze({
  ink: Object.freeze({ root: "#e9ecef", branch: Object.freeze(["#dee2e6", "#ced4da", "#adb5bd", "#868e96", "#495057"]) }),
  leaf: Object.freeze({ root: "#d3f9d8", branch: Object.freeze(["#b2f2bb", "#8ce99a", "#69db7c", "#51cf66", "#37b24d"]) }),
});

const PAGE_RE = /\[\[([^\[\]\n]+)\]\]/;
const BLOCK_RE = /\(\(([A-Za-z0-9_-]+)\)\)/g;
const DRAWING_RE = /\{\{\[\[excalidraw\]\]\}\}|\{\{excalidraw\}\}/;

export function paletteFill(id, depth, branchIndex) {
  const pal = PALETTES[id];
  if (!pal) return null;
  if (depth === 0) return pal.root;
  const i = Number.isFinite(branchIndex) ? branchIndex : 0;
  return pal.branch[((i % pal.branch.length) + pal.branch.length) % pal.branch.length];
}

/** Black or white ink from a #rrggbb fill. Unknown fills stay black. */
export function inkFor(fill) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(fill || "").trim());
  if (!m) return "#1e1e1e";
  const n = parseInt(m[1], 16);
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.45 ? "#1e1e1e" : "#ffffff";
}

/**
 * Indented lines become a branch. Tabs count as two spaces. Blank lines are skipped.
 * A drawing macro refuses the whole paste. More than PASTE_CAP blocks refuses it.
 */
export function parseIndent(text, cap = PASTE_CAP) {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  const root = { text: "", children: [] };
  const stack = [{ indent: -1, node: root }];
  let count = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    const m = /^([ \t]*)(.*)$/.exec(line);
    const indent = m[1].replace(/\t/g, "  ").length;
    const body = m[2].trim();
    if (!body) continue;
    if (DRAWING_RE.test(body)) return { ok: false, reason: "excluded" };
    count += 1;
    if (count > cap) return { ok: false, reason: "cap", count };
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const node = { text: body, children: [] };
    stack[stack.length - 1].node.children.push(node);
    stack.push({ indent, node });
  }
  if (!count) return { ok: false, reason: "empty" };
  return { ok: true, tree: root, count };
}

/** One dashed pair per block ref that names another node. Tree parents are not repeated. */
export function crossPairs(nodes, cap = CROSS_CAP) {
  const ids = new Set();
  const parentOf = new Map();
  for (const n of nodes || []) {
    if (!n?.uid) continue;
    ids.add(n.uid);
    if (n.parent) parentOf.set(n.uid, n.parent);
  }
  const out = [];
  const seen = new Set();
  for (const n of nodes || []) {
    if (!n?.uid) continue;
    const s = String(n.string || "");
    for (const m of s.matchAll(BLOCK_RE)) {
      const other = m[1];
      if (!ids.has(other) || other === n.uid) continue;
      if (parentOf.get(n.uid) === other || parentOf.get(other) === n.uid) continue;
      const key = n.uid < other ? `${n.uid}|${other}` : `${other}|${n.uid}`;
      if (seen.has(key)) continue;
      if (out.length >= cap) return out;
      seen.add(key);
      out.push({ from: n.uid, to: other });
    }
  }
  return out;
}

/** A block ref wins over a page link. Titles stay as written, without the brackets. */
export function linkTarget(string) {
  const s = String(string || "");
  const block = /\(\(([A-Za-z0-9_-]+)\)\)/.exec(s);
  if (block) return { kind: "block", uid: block[1] };
  const page = PAGE_RE.exec(s);
  if (page) {
    const title = page[1].trim();
    if (title) return { kind: "page", title };
  }
  return null;
}
