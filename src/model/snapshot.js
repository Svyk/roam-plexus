// Subgraph snapshot as Excalidraw elements. Pure: nothing here writes a scene.
// `edges` is part of the payload. Arrows always radiate from the center (or the first node).

const FILLS = Object.freeze({
  center: "#f1f3f5",
  north: "#d0ebff",
  south: "#d3f9d8",
  west: "#fff3bf",
  east: "#ffd8a8",
  siblings: "#e9ecef",
});

const FONT_SIZE = 20;
const LINE_HEIGHT = 1.25;
const CHAR_W = 0.6;
const PAD_X = 16;
const PAD_Y = 10;
const GAP = 80;
const BIND_GAP = 4;

const rnd = () => Math.floor(Math.random() * 2 ** 31);
let seq = 0;
const nid = (prefix) => `${prefix}${Math.random().toString(36).slice(2, 10)}${(seq++).toString(36)}`;

function shownText(title, mode) {
  const text = title == null ? "" : String(title);
  if (mode === "links" && !text.includes("[") && !text.includes("]")) return `[[${text}]]`;
  return text;
}

function measure(text) {
  const lines = String(text).split("\n");
  let textWidth = 1;
  for (const line of lines) textWidth = Math.max(textWidth, Math.ceil(line.length * FONT_SIZE * CHAR_W) || 1);
  const textHeight = Math.ceil(lines.length * FONT_SIZE * LINE_HEIGHT) || 1;
  return { textWidth, textHeight, width: textWidth + PAD_X * 2, height: textHeight + PAD_Y * 2 };
}

function zoneOf(zone) {
  return Object.hasOwn(FILLS, zone) ? zone : "siblings";
}

function shell(id, type, x, y, width, height, groupId) {
  return {
    id, type, x, y, width, height,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [groupId],
    seed: rnd(),
    version: 1,
    versionNonce: rnd(),
    isDeleted: false,
    updated: Date.now(),
    link: null,
    locked: false,
    frameId: null,
    index: null,
    roundness: null,
    customData: { plexus: { snapshot: true } },
  };
}

function centeredLeft(items, midX) {
  const total = items.reduce((sum, item) => sum + item.width, 0) + GAP * Math.max(0, items.length - 1);
  return midX - total / 2;
}

function placeRow(items, pos, left, y) {
  let x = left;
  for (const item of items) {
    pos.set(item, { x, y });
    x += item.width + GAP;
  }
}

function placeCol(items, pos, midY, xOf) {
  const total = items.reduce((sum, item) => sum + item.height, 0) + GAP * Math.max(0, items.length - 1);
  let y = midY - total / 2;
  for (const item of items) {
    pos.set(item, { x: xOf(item), y });
    y += item.height + GAP;
  }
}

function placeAll(items) {
  const byZone = { center: [], north: [], south: [], west: [], east: [], siblings: [] };
  for (const item of items) byZone[item.zone].push(item);
  const pos = new Map();
  let anchor = { x: 0, y: 0, width: 0, height: 0 };
  let below = 0;
  if (byZone.center.length) {
    const first = byZone.center[0];
    pos.set(first, { x: 0, y: 0 });
    anchor = { x: 0, y: 0, width: first.width, height: first.height };
    below = first.height;
    let y = first.height + GAP;
    for (const extra of byZone.center.slice(1)) {
      pos.set(extra, { x: 0, y });
      below = y + extra.height;
      y += extra.height + GAP;
    }
  }
  const midX = anchor.x + anchor.width / 2;
  const midY = anchor.y + anchor.height / 2;
  if (byZone.north.length) {
    const h = byZone.north.reduce((m, item) => Math.max(m, item.height), 0);
    const top = anchor.y - GAP - h;
    let x = centeredLeft(byZone.north, midX);
    for (const item of byZone.north) {
      pos.set(item, { x, y: top + (h - item.height) });
      x += item.width + GAP;
    }
  }
  if (byZone.south.length) placeRow(byZone.south, pos, centeredLeft(byZone.south, midX), below + GAP);
  if (byZone.west.length) placeCol(byZone.west, pos, midY, (item) => anchor.x - GAP - item.width);
  if (byZone.east.length) placeCol(byZone.east, pos, midY, () => anchor.x + anchor.width + GAP);
  if (byZone.siblings.length) {
    let floor = below;
    for (const [item, at] of pos) floor = Math.max(floor, at.y + item.height);
    placeRow(byZone.siblings, pos, anchor.x, floor + GAP);
  }
  return pos;
}

function arrowGeometry(from, to) {
  const ax = from.x + from.width / 2;
  const ay = from.y + from.height / 2;
  const bx = to.x + to.width / 2;
  const by = to.y + to.height / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const dist = Math.hypot(dx, dy);
  let p0 = { x: ax, y: ay };
  let p1 = { x: bx, y: by };
  if (dist > 0) {
    const ux = dx / dist;
    const uy = dy / dist;
    const exit = (box) => Math.min(
      Math.abs(ux) > 1e-9 ? box.width / 2 / Math.abs(ux) : Infinity,
      Math.abs(uy) > 1e-9 ? box.height / 2 / Math.abs(uy) : Infinity,
    );
    const s0 = exit(from) + BIND_GAP;
    const s1 = exit(to) + BIND_GAP;
    if (s0 + s1 < dist) {
      p0 = { x: ax + ux * s0, y: ay + uy * s0 };
      p1 = { x: bx - ux * s1, y: by - uy * s1 };
    }
  }
  return {
    x: p0.x,
    y: p0.y,
    width: Math.abs(p1.x - p0.x),
    height: Math.abs(p1.y - p0.y),
    points: [[0, 0], [p1.x - p0.x, p1.y - p0.y]],
  };
}

export function snapshotElements({ nodes = [], edges = [], mode = "plain" } = {}) {
  void edges;
  if (!Array.isArray(nodes) || nodes.length === 0) return [];
  const prepared = [];
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const shown = shownText(node.title, mode);
    prepared.push({ zone: zoneOf(node.zone), shown, ...measure(shown) });
  }
  if (!prepared.length) return [];
  const sourceAt = Math.max(0, prepared.findIndex((item) => item.zone === "center"));
  const pos = placeAll(prepared);
  const groupId = nid("g");
  const built = prepared.map((item) => {
    const at = pos.get(item);
    const rectId = nid("r");
    const textId = nid("t");
    const rect = shell(rectId, "rectangle", at.x, at.y, item.width, item.height, groupId);
    rect.backgroundColor = FILLS[item.zone];
    rect.boundElements = [{ id: textId, type: "text" }];
    const text = shell(
      textId,
      "text",
      at.x + (item.width - item.textWidth) / 2,
      at.y + (item.height - item.textHeight) / 2,
      item.textWidth,
      item.textHeight,
      groupId,
    );
    text.strokeWidth = 1;
    Object.assign(text, {
      text: item.shown,
      originalText: item.shown,
      fontSize: FONT_SIZE,
      fontFamily: 5,
      textAlign: "center",
      verticalAlign: "middle",
      autoResize: true,
      lineHeight: LINE_HEIGHT,
      containerId: rectId,
    });
    return { rect, text };
  });
  const elements = [];
  for (const item of built) elements.push(item.rect, item.text);
  const source = built[sourceAt];
  for (let i = 0; i < built.length; i++) {
    if (i === sourceAt) continue;
    const target = built[i];
    const geom = arrowGeometry(source.rect, target.rect);
    const arrow = shell(nid("a"), "arrow", geom.x, geom.y, geom.width, geom.height, groupId);
    Object.assign(arrow, {
      points: geom.points,
      lastCommittedPoint: null,
      startBinding: { elementId: source.rect.id, focus: 0, gap: BIND_GAP },
      endBinding: { elementId: target.rect.id, focus: 0, gap: BIND_GAP },
      startArrowhead: null,
      endArrowhead: "arrow",
      elbowed: false,
    });
    source.rect.boundElements.push({ id: arrow.id, type: "arrow" });
    target.rect.boundElements.push({ id: arrow.id, type: "arrow" });
    elements.push(arrow);
  }
  return elements;
}
