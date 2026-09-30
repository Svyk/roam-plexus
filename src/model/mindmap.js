// Mind-map model (Phase 4, unit A): pure functions over the outline tree. No DOM, no Roam calls.

export const MAX_TEXT_WIDTH = 240;
export const PAD_X = 14;
export const PAD_Y = 10;
export const LINE_HEIGHT = 1.25;
export const SIBLING_GAP = 18;
export const LEVEL_GAP = 70;
export const RADIAL_RADIUS = 220;
export const RADIAL_STEP = 180;
export const MAX_DISPLAY = 280;
export const REF_MAX = 60;
export const ROOT_COLOR = "#ffec99";
export const BRANCH_COLORS = Object.freeze(["#a5d8ff", "#b2f2bb", "#ffc9c9", "#d0bfff", "#ffd8a8"]);
export const LAYOUTS = Object.freeze(["right", "down", "left", "up", "radial"]);
export const CAUSE_LAYOUTS = Object.freeze(["cause", "fishbone"]);
export const isCauseLayout = (layout) => layout === "cause" || layout === "fishbone";
// Phase 13: the flow layout is not in LAYOUTS (no Alt+L cycle) and never reaches layoutTree; flow.js owns it.
export { FLOW_LAYOUT, FLOW_DECISION_WRAP, drawnTree, flowParts, flowEditable, isDecision, laneOf, branchLabel } from "./flow.js";

const EXCLUDED_RE = /^\s*(?:\{\{\[\[excalidraw\]\]\}\}|\{\{excalidraw\}\}|\{\{\[\[plexus-)/;
export const isExcludedString = (s) => typeof s === "string" && EXCLUDED_RE.test(s);

// Better Tasks attribute blocks: never drawn (rendering only; the writer still moves and deletes them with their task).
const HIDDEN_RE = /^\s*BT_attr[A-Za-z0-9_]*::/;
export const isHiddenString = (s) => typeof s === "string" && HIDDEN_RE.test(s);

const TASK_RE = /^\{\{\[\[(TODO|DONE)\]\]\}\} ?/;
/** `{state: "TODO"|"DONE"|null, prefix, rest}`; the prefix is the macro plus at most one following space. */
export function taskParts(s) {
  if (typeof s !== "string") return { state: null, prefix: "", rest: "" };
  const m = TASK_RE.exec(s);
  if (!m) return { state: null, prefix: "", rest: s };
  return { state: m[1], prefix: m[0], rest: s.slice(m[0].length) };
}
export const taskState = (s) => taskParts(s).state;

export const fontSizeForDepth = (depth) => (depth === 0 ? 24 : depth === 1 ? 20 : 16);

function pick(obj, name) {
  if (!obj || typeof obj !== "object") return undefined;
  const v = obj[`:block/${name}`];
  return v !== undefined ? v : obj[name];
}

/**
 * Roam pull result -> `{uid, string, open, children}` (children sorted by order, excluded subtrees dropped).
 * opts.prune: Set of uids to drop with their subtrees; opts.maxVisible: cap on visible nodes in DFS order
 * (sets `truncated: true` on the root when the cap cut something).
 */
export function treeFromPull(pull, opts = {}) {
  const prune = opts.prune instanceof Set ? opts.prune : null;
  const cap = Number.isFinite(opts.maxVisible) ? opts.maxVisible : Infinity;
  let visible = 0;
  let truncated = false;
  function conv(p, isRoot) {
    const uid = pick(p, "uid");
    if (typeof uid !== "string") return null;
    const string = pick(p, "string");
    const str = typeof string === "string" ? string : "";
    if (isExcludedString(str)) return null;
    if (!isRoot && isHiddenString(str)) return null;
    if (!isRoot && prune && prune.has(uid)) return null;
    if (visible >= cap) { truncated = true; return null; }
    visible += 1;
    const open = pick(p, "open") !== false;
    const raw = pick(p, "children");
    const kids = Array.isArray(raw) ? raw.slice() : [];
    kids.sort((a, b) => (pick(a, "order") ?? 0) - (pick(b, "order") ?? 0));
    const node = { uid, string: str, open, children: [] };
    for (const k of kids) {
      const c = conv(k, false);
      if (c) node.children.push(c);
    }
    return node;
  }
  if (!pull || typeof pull !== "object") return null;
  const tree = conv(pull, true);
  if (tree && truncated) tree.truncated = true;
  return tree;
}

export const isFolded = (node) => node.open === false && node.children.length > 0;

/** Descendant count of a node (all levels, folded or not). */
export function countHidden(node) {
  let n = 0;
  const stack = [...node.children];
  while (stack.length) {
    const c = stack.pop();
    n += 1;
    for (const k of c.children) stack.push(k);
  }
  return n;
}

export const visibleChildren = (node) => (node.open === false ? [] : node.children);

/** DFS list of visible nodes: {node, parent, depth, branch (depth-1 ancestor uid or null), branchIndex}. */
export function visibleNodes(tree) {
  const out = [];
  function walk(node, parent, depth, branch, branchIndex) {
    out.push({ node, parent, depth, branch, branchIndex });
    const kids = visibleChildren(node);
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (depth === 0) walk(k, node, 1, k.uid, i);
      else walk(k, node, depth + 1, branch, branchIndex);
    }
  }
  if (tree) walk(tree, null, 0, null, -1);
  return out;
}

export const allUids = (tree) => {
  const set = new Set();
  const stack = tree ? [tree] : [];
  while (stack.length) {
    const n = stack.pop();
    set.add(n.uid);
    for (const c of n.children) stack.push(c);
  }
  return set;
};

// ---- display text ----

const RE_IMG = /!\[([^\]]*)\]\([^)]*\)/g;
const RE_LINK = /\[([^\]]*)\]\([^)]*\)/g;
const RE_REF = /\(\(([^()\s]+)\)\)/g;
const RE_TAG_BR = /#\[\[([^\]]+)\]\]/g;
const RE_PAGE = /\[\[([^\]]+)\]\]/g;
const RE_TAG = /(^|[\s(])#([\p{L}\p{N}_/-]+(?:[.:][\p{L}\p{N}_/-]+)*)/gu;
const RE_BOLD = /\*\*(.+?)\*\*/g;
const RE_ITAL = /__(.+?)__/g;
const RE_HL = /\^\^(.+?)\^\^/g;
const RE_STRIKE = /~~(.+?)~~/g;

function hasComponent(s) {
  return s.indexOf("{{") !== -1 && s.indexOf("}}", s.indexOf("{{")) !== -1;
}

// Replace balanced {{...}} (nesting allowed) with the component glyph.
function replaceComponents(s) {
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] === "{" && s[i + 1] === "{") {
      let depth = 0;
      let j = i;
      let end = -1;
      while (j < s.length) {
        if (s[j] === "{" && s[j + 1] === "{") { depth += 1; j += 2; continue; }
        if (s[j] === "}" && s[j + 1] === "}") {
          depth -= 1;
          j += 2;
          if (depth === 0) { end = j; break; }
          continue;
        }
        j += 1;
      }
      if (end === -1) { out += s.slice(i); break; }
      out += "⧉";
      i = end;
    } else {
      out += s[i];
      i += 1;
    }
  }
  return out;
}

function fresh(re) { re.lastIndex = 0; return re; }

/** True when the string contains any construct that plainText rewrites (or is empty / over the cap). */
export function hasMarkup(s) {
  if (typeof s !== "string" || s === "" || s.length > MAX_DISPLAY) return true;
  if (hasComponent(s) && replaceComponents(s) !== s) return true;
  for (const re of [RE_IMG, RE_LINK, RE_REF, RE_TAG_BR, RE_PAGE, RE_TAG, RE_BOLD, RE_ITAL, RE_HL, RE_STRIKE]) {
    if (fresh(re).test(s)) return true;
  }
  return false;
}

function rewrite(s, resolveRef, depthLimit) {
  let t = s;
  if (hasComponent(t)) t = replaceComponents(t);
  t = t.replace(RE_IMG, (_, alt) => `▣ ${alt}`);
  t = t.replace(RE_LINK, (_, txt) => txt);
  t = t.replace(RE_REF, (_, uid) => {
    if (depthLimit <= 0) return "…";
    let ref;
    try { ref = resolveRef ? resolveRef(uid) : null; } catch { ref = null; }
    if (typeof ref !== "string") return "…";
    let r = rewrite(ref, () => "…", 0);
    if (r.length > REF_MAX) r = `${r.slice(0, REF_MAX - 1)}…`;
    return r;
  });
  t = t.replace(RE_TAG_BR, (_, x) => x);
  t = t.replace(RE_PAGE, (_, x) => x);
  t = t.replace(RE_TAG, (_, pre, x) => pre + x);
  t = t.replace(RE_BOLD, (_, x) => x);
  t = t.replace(RE_ITAL, (_, x) => x);
  t = t.replace(RE_HL, (_, x) => x);
  t = t.replace(RE_STRIKE, (_, x) => x);
  return t;
}

/** Block string -> display text. Pure; resolveRef(uid) returns the referenced block's string or null. */
export function plainText(s, resolveRef) {
  if (typeof s !== "string" || s === "") return "·";
  const tp = taskParts(s);
  let t;
  if (tp.state) {
    const glyph = tp.state === "DONE" ? "☑" : "☐";
    t = tp.rest === "" ? glyph : `${glyph} ${rewrite(tp.rest, resolveRef, 1)}`;
  } else t = rewrite(s, resolveRef, 1);
  if (t.length > MAX_DISPLAY) t = `${t.slice(0, MAX_DISPLAY - 1)}…`;
  if (t === "") return "·";
  return t;
}

// ---- tags, editing, attribute carriers (Phase 12) ----

const RE_TAG_SCAN = /#\[\[([^\]]+)\]\]|(^|[\s(])#([\p{L}\p{N}_/-]+(?:[.:][\p{L}\p{N}_/-]+)*)/gu;

/** First `#tag`, `#[[tag]]` or task macro (tag todo / done) in text order that has a colour in `map` (lowercase keys). */
export function tagColor(s, map) {
  if (typeof s !== "string" || !map || typeof map.get !== "function" || map.size === 0) return undefined;
  const tp = taskParts(s);
  if (tp.state) {
    const c = map.get(tp.state.toLowerCase());
    if (c) return c;
  }
  const re = new RegExp(RE_TAG_SCAN.source, "gu");
  let m;
  while ((m = re.exec(s)) !== null) {
    const name = (m[1] !== undefined ? m[1] : m[3]).toLowerCase();
    const c = map.get(name);
    if (c) return c;
  }
  return undefined;
}

/**
 * New block string for a node whose bound text now shows `displayed`, or null when it cannot be written back
 * (markup in the block, empty text, unchanged). Strips the fold suffix, a leading star and a task glyph; puts the
 * task prefix back.
 */
export function editableText(node, displayed, { star = false } = {}) {
  if (!node || typeof displayed !== "string") return null;
  let text = displayed;
  if (isFolded(node)) {
    const suffix = ` (+${countHidden(node)})`;
    if (!text.endsWith(suffix)) return null;
    text = text.slice(0, -suffix.length);
  }
  if (star && text.startsWith("★ ")) text = text.slice(2);
  const tp = taskParts(node.string);
  if (tp.state) {
    if (text.startsWith("☐ ") || text.startsWith("☑ ")) text = text.slice(2);
    else if (text === "☐" || text === "☑") text = "";
  }
  if (hasMarkup(tp.rest)) return null;
  if (text === "" || text === "·") return null;
  const next = tp.prefix + text;
  return next === node.string ? null : next;
}

const CARRIER_RE = /^([^:\n`{]{1,60})::$/;
const carrierName = (s) => {
  if (typeof s !== "string") return null;
  const m = CARRIER_RE.exec(s.trim());
  if (!m) return null;
  const name = m[1].trim();
  return name === "" || name.startsWith("BT_attr") ? null : name;
};

/**
 * Attribute-edge transform (MM-7): a `Name::` child with drawable children and an open state is not drawn; its
 * children are spliced into its parent's children at its position with `edgeLabel` and `via`. Pure; returns the
 * input tree itself when off. Folded nodes keep their raw children.
 */
export function visualTree(tree, { attrEdges = false } = {}) {
  if (!tree || !attrEdges) return tree;
  function conv(node) {
    if (node.open === false || node.children.length === 0) return node;
    const out = [];
    let changed = false;
    for (const c of node.children) {
      const name = c.open !== false && c.children.length > 0 ? carrierName(c.string) : null;
      if (name !== null) {
        changed = true;
        const label = plainText(name);
        for (const k of c.children) {
          const kk = conv(k);
          out.push({ ...kk, edgeLabel: label, via: c.uid });
        }
      } else {
        const cc = conv(c);
        if (cc !== c) changed = true;
        out.push(cc);
      }
    }
    return changed ? { ...node, children: out } : node;
  }
  return conv(tree);
}

// ---- wrapping and sizing ----

/** Split on \n, wrap greedily on spaces, break words wider than maxWidth by character. measure(str) -> width. */
export function wrapLines(text, maxWidth, measure) {
  const out = [];
  for (const para of String(text).split("\n")) {
    if (para === "") { out.push(""); continue; }
    let line = "";
    const flush = () => { out.push(line); line = ""; };
    for (const word of para.split(" ")) {
      const cand = line === "" ? word : `${line} ${word}`;
      if (measure(cand) <= maxWidth) { line = cand; continue; }
      if (line !== "") flush();
      if (measure(word) <= maxWidth) { line = word; continue; }
      let chunk = "";
      for (const ch of Array.from(word)) {
        if (chunk !== "" && measure(chunk + ch) > maxWidth) { out.push(chunk); chunk = ch; } else chunk += ch;
      }
      line = chunk;
    }
    out.push(line);
  }
  return out;
}

/** measure(str, fontSize) -> width. Returns container and bound-text geometry. */
export function nodeSize(text, fontSize, measure, maxWidth = MAX_TEXT_WIDTH) {
  const m = (s) => measure(s, fontSize);
  const lines = wrapLines(text, maxWidth, m);
  let tw = 0;
  for (const l of lines) tw = Math.max(tw, m(l));
  const textWidth = Math.max(1, Math.ceil(tw));
  const textHeight = lines.length * fontSize * LINE_HEIGHT;
  return {
    width: textWidth + 2 * PAD_X,
    height: textHeight + 2 * PAD_Y,
    textWidth,
    textHeight,
    lines,
    text: lines.join("\n"),
  };
}

// ---- layout ----

/**
 * Pure O(n) layout. sizes: uid -> {width, height}; pinned: uid -> {x, y} (subtrees lay out relative to them);
 * root: top-left the root keeps. Returns uid -> {x, y} (top-left, scene coordinates) for visible nodes only.
 */
export function layoutTree({ tree, sizes, layout = "right", pinned = {}, root = { x: 0, y: 0 }, gapOf = () => LEVEL_GAP }) {
  const pos = {};
  if (!tree) return pos;
  const sz = (n) => sizes[n.uid] || { width: 0, height: 0 };
  const isPinned = (n) => n.uid !== tree.uid && pinned[n.uid] && Number.isFinite(pinned[n.uid].x) && Number.isFinite(pinned[n.uid].y);
  if (layout === "radial") return radial(tree, sz, isPinned, pinned, root, pos);
  if (layout === "fishbone") return fishboneLayout({ tree, sizes, pinned, root, gapOf }).positions;
  const dirL = layout === "cause" ? "left" : layout;

  const horizontal = dirL === "right" || dirL === "left";
  const cross = (n) => (horizontal ? sz(n).height : sz(n).width);
  const ext = new Map();
  const free = (n) => visibleChildren(n).filter((k) => !isPinned(k));
  function extent(n) {
    let span = 0;
    const kids = free(n);
    for (let i = 0; i < kids.length; i++) span += extent(kids[i]) + (i ? SIBLING_GAP : 0);
    for (const k of visibleChildren(n)) if (isPinned(k)) extent(k);
    const e = Math.max(cross(n), span);
    ext.set(n, { e, span });
    return e;
  }
  function place(n, x, y) {
    pos[n.uid] = { x, y };
    const s = sz(n);
    const { span } = ext.get(n);
    const kids = free(n);
    let cursor = (horizontal ? y + s.height / 2 : x + s.width / 2) - span / 2;
    for (const k of kids) {
      const ks = sz(k);
      const e = ext.get(k).e;
      const c = cursor + (e - cross(k)) / 2;
      const gap = gapOf(k.uid);
      let kx;
      let ky;
      if (dirL === "right") { kx = x + s.width + gap; ky = c; }
      else if (dirL === "left") { kx = x - gap - ks.width; ky = c; }
      else if (dirL === "down") { kx = c; ky = y + s.height + gap; }
      else { kx = c; ky = y - gap - ks.height; }
      place(k, kx, ky);
      cursor += e + SIBLING_GAP;
    }
    for (const k of visibleChildren(n)) if (isPinned(k)) place(k, pinned[k.uid].x, pinned[k.uid].y);
  }
  extent(tree);
  place(tree, root.x, root.y);
  return pos;
}

export const FISH_BONE_OFFSET = 50;
export const FISH_SLOT_PAD = 60;
export const FISH_RIB_GAP = 40;

/**
 * Fishbone (MM-11): the root is the head at `root`; the spine runs left from the middle of its left edge. Level-1
 * causes alternate above (even) and below (odd); each subtree lays out as `left` and sits wholly on one side.
 * Returns {positions, spine: {x1, x2, y} | null, slotX: uid -> spine x of that bone}.
 */
export function fishboneLayout({ tree, sizes, pinned = {}, root = { x: 0, y: 0 }, gapOf = () => LEVEL_GAP }) {
  const positions = {};
  const slotX = {};
  if (!tree) return { positions, spine: null, slotX };
  const sz = (uid) => sizes[uid] || { width: 0, height: 0 };
  const rs = sz(tree.uid);
  positions[tree.uid] = { x: root.x, y: root.y };
  const spineY = root.y + rs.height / 2;
  const kids = visibleChildren(tree);
  if (kids.length === 0) return { positions, spine: null, slotX };
  const isPinned = (k) => pinned[k.uid] && Number.isFinite(pinned[k.uid].x) && Number.isFinite(pinned[k.uid].y);
  const free = kids.filter((k) => !isPinned(k));
  const parts = free.map((k) => {
    const rel = layoutTree({ tree: k, sizes, layout: "left", pinned, gapOf, root: { x: 0, y: 0 } });
    const abs = new Set();
    const mark = (n, inside) => {
      for (const c of visibleChildren(n)) {
        const p = inside || isPinned(c);
        if (p) abs.add(c.uid);
        mark(c, p);
      }
    };
    mark(k, false);
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
    for (const uid of Object.keys(rel)) {
      if (abs.has(uid)) continue;
      const s = sz(uid);
      minX = Math.min(minX, rel[uid].x); maxX = Math.max(maxX, rel[uid].x + s.width);
      minY = Math.min(minY, rel[uid].y); maxY = Math.max(maxY, rel[uid].y + s.height);
    }
    return { k, rel, abs, minX, maxX, minY, maxY, width: maxX - minX };
  });
  let cursor = root.x;
  for (let j = 0; j * 2 < parts.length; j++) {
    const above = parts[2 * j];
    const below = parts[2 * j + 1];
    const maxw = Math.max(above.width, below ? below.width : 0);
    const spineX = cursor - 20;
    const right = spineX - FISH_RIB_GAP;
    for (const part of [above, below]) {
      if (!part) continue;
      const dx = right - part.maxX;
      const dy = part === above ? spineY - FISH_BONE_OFFSET - part.maxY : spineY + FISH_BONE_OFFSET - part.minY;
      for (const uid of Object.keys(part.rel)) positions[uid] = part.abs.has(uid) ? { ...part.rel[uid] } : { x: part.rel[uid].x + dx, y: part.rel[uid].y + dy };
      slotX[part.k.uid] = spineX;
    }
    cursor -= maxw + FISH_SLOT_PAD;
  }
  const x1 = free.length ? cursor : root.x - 80;
  for (const k of kids) {
    if (!isPinned(k)) continue;
    const rel = layoutTree({ tree: k, sizes, layout: "left", pinned, gapOf, root: pinned[k.uid] });
    for (const uid of Object.keys(rel)) positions[uid] = rel[uid];
    slotX[k.uid] = Math.min(root.x, Math.max(x1, pinned[k.uid].x + sz(k.uid).width));
  }
  return { positions, spine: { x1, x2: root.x, y: spineY }, slotX };
}

function radial(tree, sz, isPinned, pinned, rootPos, pos) {
  const rs = sz(tree);
  const cx = rootPos.x + rs.width / 2;
  const cy = rootPos.y + rs.height / 2;
  pos[tree.uid] = { x: rootPos.x, y: rootPos.y };
  // n placed with center (ncx, ncy); its children fan out inside the wedge [angle - width/2, angle + width/2].
  function fan(n, ncx, ncy, angle, width, first) {
    const kids = visibleChildren(n);
    const m = kids.length;
    for (let i = 0; i < m; i++) {
      const k = kids[i];
      const ks = sz(k);
      const a = first ? -Math.PI / 2 + (2 * Math.PI * i) / m : angle - width / 2 + (width * (i + 0.5)) / m;
      const w = first ? (2 * Math.PI) / m : width / m;
      let kcx;
      let kcy;
      let dirA = a;
      if (isPinned(k)) {
        kcx = pinned[k.uid].x + ks.width / 2;
        kcy = pinned[k.uid].y + ks.height / 2;
        dirA = Math.atan2(kcy - cy, kcx - cx);
        pos[k.uid] = { x: pinned[k.uid].x, y: pinned[k.uid].y };
        fan(k, kcx, kcy, dirA, w, false);
        continue;
      }
      const r = first ? RADIAL_RADIUS : RADIAL_STEP;
      kcx = ncx + r * Math.cos(a);
      kcy = ncy + r * Math.sin(a);
      pos[k.uid] = { x: kcx - ks.width / 2, y: kcy - ks.height / 2 };
      fan(k, kcx, kcy, a, w, false);
    }
  }
  fan(tree, cx, cy, 0, 2 * Math.PI, true);
  return pos;
}

/**
 * Nearest candidate whose center lies in the 90-degree cone of `dir` from `from`'s center; lowest distance wins.
 * from/candidates: {id, x, y, width, height}. Returns the id or null.
 */
export function nearestInDirection(from, candidates, dir) {
  const fx = from.x + from.width / 2;
  const fy = from.y + from.height / 2;
  let best = null;
  let bestD = Infinity;
  for (const c of candidates) {
    if (c.id === from.id) continue;
    const dx = c.x + c.width / 2 - fx;
    const dy = c.y + c.height / 2 - fy;
    const inCone =
      dir === "right" ? dx > 0 && Math.abs(dy) <= dx
      : dir === "left" ? dx < 0 && Math.abs(dy) <= -dx
      : dir === "down" ? dy > 0 && Math.abs(dx) <= dy
      : dir === "up" ? dy < 0 && Math.abs(dx) <= -dy
      : false;
    if (!inCone) continue;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = c.id; }
  }
  return best;
}
