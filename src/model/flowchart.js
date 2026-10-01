// Flowchart TD/LR only. No mermaid library. A line that does not match rejects the whole diagram.
import { createBuilder } from "./build.js";
import { cardElement } from "./neighbours.js";
import { layoutTree } from "./mindmap.js";

export const MERMAID_BLOCK = "{{[[mermaid]]}}";

const ID = "([A-Za-z][A-Za-z0-9_]*)";
const NODE = `${ID}(?:\\[([^\\]\\n]+)\\])?`;
const NODE_ONLY = new RegExp(`^${ID}\\[([^\\]\\n]+)\\]$`);
const EDGE = new RegExp(`^${NODE}\\s*-->\\s*(?:\\|([^|\\n]+)\\|\\s*)?${NODE}$`);

function addNode(nodes, order, id, label) {
  if (!id) return;
  if (!nodes.has(id)) {
    nodes.set(id, label || id);
    order.push(id);
    return;
  }
  if (label && nodes.get(id) === id) nodes.set(id, label);
}

function parseLine(line) {
  const edge = EDGE.exec(line);
  if (edge) {
    return {
      kind: "edge",
      from: edge[1],
      fromLabel: edge[2] || null,
      label: edge[3] ? edge[3].trim() : "",
      to: edge[4],
      toLabel: edge[5] || null,
    };
  }
  const node = NODE_ONLY.exec(line);
  if (node) return { kind: "node", id: node[1], label: node[2] };
  return null;
}

export function parseFlowchart(text) {
  const lines = String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return null;
  const head = /^flowchart\s+(TD|LR)$/i.exec(lines[0]);
  if (!head) return null;
  const dir = head[1].toUpperCase();
  const nodes = new Map();
  const order = [];
  const edges = [];
  for (const line of lines.slice(1)) {
    const parsed = parseLine(line);
    if (!parsed) return null;
    if (parsed.kind === "node") addNode(nodes, order, parsed.id, parsed.label);
    else {
      addNode(nodes, order, parsed.from, parsed.fromLabel);
      addNode(nodes, order, parsed.to, parsed.toLabel);
      if (parsed.from !== parsed.to) edges.push({ from: parsed.from, to: parsed.to, label: parsed.label });
    }
  }
  if (!order.length) return null;
  return {
    dir,
    layout: dir === "LR" ? "right" : "down",
    nodes: order.map((id) => ({ id, label: nodes.get(id) })),
    edges,
  };
}

function flowchartTree(parsed) {
  const ids = parsed.nodes.map((node) => node.id);
  const kids = new Map(ids.map((id) => [id, []]));
  const incoming = new Map(ids.map((id) => [id, 0]));
  for (const edge of parsed.edges) {
    if (!kids.has(edge.from) || !kids.has(edge.to) || edge.from === edge.to) continue;
    if (kids.get(edge.from).includes(edge.to)) continue;
    kids.get(edge.from).push(edge.to);
    incoming.set(edge.to, incoming.get(edge.to) + 1);
  }
  const seen = new Set();
  const build = (id) => {
    if (seen.has(id)) return { uid: id, open: true, children: [] };
    seen.add(id);
    const node = { uid: id, open: true, children: [] };
    for (const child of kids.get(id)) {
      if (seen.has(child)) continue;
      node.children.push(build(child));
    }
    return node;
  };
  const roots = ids.filter((id) => incoming.get(id) === 0);
  const tree = build(roots[0] || ids[0]);
  for (const id of ids) if (!seen.has(id)) tree.children.push(build(id));
  return tree;
}

export function flowchartElements(parsed, { measure, newId, origin = { x: 0, y: 0 } } = {}) {
  if (!parsed?.nodes?.length) return [];
  const builder = createBuilder({ measure, newId });
  const ids = new Map();
  for (const node of parsed.nodes) ids.set(node.id, builder.box(node.label || node.id, { x: 0, y: 0 }));
  for (const edge of parsed.edges) {
    const from = ids.get(edge.from);
    const to = ids.get(edge.to);
    if (!from || !to || edge.from === edge.to) continue;
    builder.arrow(from, to, edge.label ? { label: edge.label } : {});
  }
  const sizes = {};
  for (const node of parsed.nodes) sizes[node.id] = builder.size(ids.get(node.id));
  const pos = layoutTree({ tree: flowchartTree(parsed), sizes, layout: parsed.layout, root: origin });
  for (const node of parsed.nodes) {
    const at = pos[node.id];
    if (at) builder.place(ids.get(node.id), at.x, at.y);
  }
  return builder.elements();
}

function cleanLabel(value, fallback) {
  const text = String(value ?? "").replace(/[\r\n|[\]]/g, " ").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function cardLabel(el, byId) {
  for (const child of byId.values()) {
    if (!child || child.isDeleted || child.type !== "text" || child.containerId !== el.id) continue;
    const text = child.originalText || child.text;
    if (text && String(text).trim()) return String(text);
  }
  const embed = el.customData?.plexus?.embed;
  if (typeof embed === "string" && embed.trim()) return embed;
  if (typeof el.link === "string" && el.link.trim()) return el.link;
  return "card";
}

function pickCards(elements, selectedIds) {
  const live = (elements || []).filter((el) => el && !el.isDeleted);
  const byId = new Map(live.map((el) => [el.id, el]));
  const selected = new Set(selectedIds || []);
  const take = (ids) => {
    const out = [];
    const seen = new Set();
    for (const el of live) {
      if (ids && !ids.has(el.id)) continue;
      const card = cardElement(el, byId);
      if (!card || seen.has(card.id)) continue;
      seen.add(card.id);
      out.push(card);
    }
    return out;
  };
  const picked = selected.size ? take(selected) : [];
  const cards = picked.length ? picked : take(null);
  cards.sort((a, b) => a.y - b.y || a.x - b.x || String(a.id).localeCompare(String(b.id)));
  return { cards, byId };
}

function boundEnds(arrow, byId, index) {
  const endOf = (binding) => {
    const el = binding?.elementId ? byId.get(binding.elementId) : null;
    const card = cardElement(el, byId);
    return card ? index.get(card.id) || null : null;
  };
  return { from: endOf(arrow.startBinding), to: endOf(arrow.endBinding) };
}

export function flowchartFromCards(elements, selectedIds) {
  const { cards, byId } = pickCards(elements, selectedIds);
  if (!cards.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const card of cards) {
    minX = Math.min(minX, card.x);
    minY = Math.min(minY, card.y);
    maxX = Math.max(maxX, card.x + (card.width || 0));
    maxY = Math.max(maxY, card.y + (card.height || 0));
  }
  const dir = maxX - minX > maxY - minY ? "LR" : "TD";
  const index = new Map();
  const lines = [`flowchart ${dir}`];
  cards.forEach((card, i) => {
    const nodeId = `n${i + 1}`;
    index.set(card.id, nodeId);
    lines.push(`${nodeId}[${cleanLabel(cardLabel(card, byId), "card")}]`);
  });
  const seen = new Set();
  for (const el of byId.values()) {
    if (el.type !== "arrow") continue;
    const ends = boundEnds(el, byId, index);
    if (!ends.from || !ends.to || ends.from === ends.to) continue;
    const key = `${ends.from}>${ends.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let label = "";
    for (const child of byId.values()) {
      if (child.type === "text" && child.containerId === el.id && !child.isDeleted) {
        label = cleanLabel(child.originalText || child.text, "");
        if (label) break;
      }
    }
    lines.push(label ? `${ends.from} -->|${label}| ${ends.to}` : `${ends.from}-->${ends.to}`);
  }
  return lines.join("\n");
}
