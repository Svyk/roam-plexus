import { createBuilder } from "./build.js";
import { FRAME_PRESETS, applyOrderRewrite, planOrders, withOrder } from "./frames.js";
import { commonBounds, liveElements } from "./scene.js";

// Templates (P13 AUTH-10). Pure: the starters are drawn through the P12 builder, and inserting or saving works on
// plain element arrays. Nothing here touches a scene, Roam or the DOM.
const rnd = () => Math.floor(Math.random() * 2 ** 31);
const rid = () => `${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 13)}`.padEnd(21, "0").slice(0, 21);
const isFrameLike = (el) => !!el && (el.type === "frame" || el.type === "magicframe");

const SLIDE = FRAME_PRESETS["16:9"];
const ZONE = "#adb5bd";

// Top-to-bottom stack of boxes, each centred on cx. Returns [{id, x, y, width, height}].
function stack(b, ids, cx, y, gap) {
  const out = [];
  let cur = y;
  for (const id of ids) {
    const { width, height } = b.size(id);
    const x = cx - width / 2;
    b.place(id, x, cur);
    out.push({ id, x, y: cur, width, height });
    cur += height + gap;
  }
  return out;
}

function centreOn(b, id, cx, cy) {
  const { width, height } = b.size(id);
  b.place(id, cx - width / 2, cy - height / 2);
}

function haccpFlow(b, { origin }) {
  const cx = origin.x + 220;
  const mk = (text, o) => b.box(text, { minWidth: 180, ...o });
  const chain = ["Receive ingredients", "Store", "Weigh", "Blend"].map((t) => mk(t));
  const decision = mk("Metal detected?", { type: "diamond", minWidth: 200 });
  const rest = ["Fill & seal", "Code and label", "Ship"].map((t) => mk(t));
  const hold = mk("Hold & investigate", { backgroundColor: "#ffe3e3" });
  const col = stack(b, [...chain, decision, ...rest], cx, origin.y, 50);
  const d = col[chain.length];
  const h = b.size(hold);
  b.place(hold, d.x + d.width + 90, d.y + (d.height - h.height) / 2);
  const chip = b.box("CCP 1", { fontSize: 12, backgroundColor: "#fff3bf", strokeColor: "#e67700", x: d.x + d.width - 34, y: d.y - 8 });
  for (let i = 0; i < col.length - 1; i++) {
    b.arrow(col[i].id, col[i + 1].id, col[i].id === decision ? { label: "No" } : {});
  }
  b.arrow(decision, hold, { label: "Yes" });
  return chip;
}

function fiveWhy(b, { origin }) {
  const cx = origin.x + 150;
  const ids = [b.box("Problem", { minWidth: 220, backgroundColor: "#ffe3e3" })];
  for (let i = 1; i <= 5; i++) ids.push(b.box(`Why ${i}?`, { minWidth: 220 }));
  ids.push(b.box("Root cause", { minWidth: 220, backgroundColor: "#d3f9d8" }));
  stack(b, ids, cx, origin.y, 44);
  for (let i = 0; i < ids.length - 1; i++) b.arrow(ids[i], ids[i + 1]);
}

function fishbone(b, { origin }) {
  const spineY = origin.y;
  const length = 720;
  b.line(origin.x, spineY, [[0, 0], [length, 0]], { strokeWidth: 3 });
  const head = b.box("Effect", { minWidth: 120, backgroundColor: "#ffe3e3" });
  const hs = b.size(head);
  b.place(head, origin.x + length + 12, spineY - hs.height / 2);
  const top = ["Method", "Machine", "Materials"];
  const bottom = ["People", "Measurement", "Environment"];
  const at = (label, i, above) => {
    const id = b.box(label, { minWidth: 130 });
    const s = b.size(id);
    const cx = origin.x + 120 + i * 220;
    const y = above ? spineY - 230 - s.height : spineY + 230;
    b.place(id, cx - s.width / 2, y);
    const from = above ? y + s.height : y;
    b.line(cx, from, [[0, 0], [70, spineY - from]]);
  };
  top.forEach((t, i) => at(t, i, true));
  bottom.forEach((t, i) => at(t, i, false));
}

function apolloCauseMap(b, { origin }) {
  const cx = (n) => origin.x + n * 320;
  const cy = (n) => origin.y + n;
  const problem = b.box("Problem", { minWidth: 180, backgroundColor: "#ffe3e3" });
  centreOn(b, problem, cx(0), cy(0));
  const causes = [["Cause 1", -110], ["Cause 2", 110]].map(([t, y]) => {
    const id = b.box(t, { minWidth: 160 });
    centreOn(b, id, cx(1), cy(y));
    b.arrow(id, problem);
    return id;
  });
  [["Cause 1a", -170, 0], ["Cause 1b", -50, 0], ["Cause 2a", 110, 1]].forEach(([t, y, parent]) => {
    const id = b.box(t, { minWidth: 160 });
    centreOn(b, id, cx(2), cy(y));
    b.arrow(id, causes[parent]);
  });
}

function sipoc(b, { origin }) {
  const names = ["Suppliers", "Inputs", "Process", "Outputs", "Customers"];
  const width = 170;
  const gap = 60;
  const headers = names.map((name, i) => {
    const id = b.box(name, { width, height: 48, x: origin.x + i * (width + gap), y: origin.y, backgroundColor: "#e7f5ff" });
    return id;
  });
  names.forEach((_, i) => b.rect(origin.x + i * (width + gap), origin.y + 48 + 24, width, 320, { strokeColor: ZONE, strokeStyle: "dashed" }));
  for (let i = 0; i < headers.length - 1; i++) b.arrow(headers[i], headers[i + 1]);
}

function swimlane(b, { origin }) {
  const laneH = 140;
  const laneW = 1000;
  const lanes = ["Lane 1", "Lane 2", "Lane 3"];
  lanes.forEach((_, i) => b.rect(origin.x, origin.y + i * laneH, laneW, laneH, { strokeColor: ZONE }));
  lanes.forEach((name, i) => b.text(origin.x + 12, origin.y + i * laneH + 8, name, { fontSize: 16 }));
  const step = (text, col, lane, type) => {
    const id = b.box(text, { type, minWidth: 100 });
    centreOn(b, id, origin.x + 150 + col * 185, origin.y + lane * laneH + laneH / 2 + 10);
    return id;
  };
  const ids = [
    step("Start", 0, 0, "ellipse"),
    step("Step 1", 1, 0),
    step("Step 2", 2, 1),
    step("Step 3", 3, 2),
    step("End", 4, 2, "ellipse"),
  ];
  for (let i = 0; i < ids.length - 1; i++) b.arrow(ids[i], ids[i + 1]);
}

function swabSiteMap(b, { origin }) {
  const { x: ox, y: oy } = origin;
  const zones = [
    ["Zone 4: outside production", 0, 0, 840, 640],
    ["Zone 3: remote from product contact", 70, 70, 700, 500],
    ["Zone 2: adjacent to product contact", 140, 140, 560, 360],
    ["Zone 1: product contact", 210, 210, 420, 220],
  ];
  for (const [, x, y, w, h] of zones) b.rect(ox + x, oy + y, w, h, { strokeColor: "#868e96" });
  for (const [name, x, y] of zones) b.text(ox + x + 12, oy + y + 10, name, { fontSize: 16 });
  const sites = [["S1", 320, 330], ["S2", 520, 330], ["S3", 250, 465], ["S4", 600, 465], ["S5", 420, 535], ["S6", 420, 605]];
  for (const [label, x, y] of sites) {
    const id = b.box(label, { type: "ellipse", fontSize: 16, backgroundColor: "#fff3bf" });
    centreOn(b, id, ox + x, oy + y);
  }
  b.text(ox + 880, oy, "Legend\nS1, S2: Zone 1\nS3, S4: Zone 2\nS5: Zone 3\nS6: Zone 4", { fontSize: 16 });
}

function slide16x9(b, { origin }) {
  const { x, y } = origin;
  const title = b.text(x + 40, y + 40, "Title", { fontSize: 36 });
  const body = b.text(x + 40, y + 140, "Click to add text", { fontSize: 24 });
  b.frame(x, y, SLIDE.width, SLIDE.height, { name: "Slide", children: [title, body] });
}

// The built-in starters. build(builder, {origin}) draws into a builder; buildStarter runs it.
export const STARTERS = Object.freeze([
  { id: "haccp-flow", name: "HACCP flow", build: haccpFlow },
  { id: "five-why", name: "5-Why", build: fiveWhy },
  { id: "fishbone", name: "Fishbone", build: fishbone },
  { id: "apollo", name: "Apollo cause map", build: apolloCauseMap },
  { id: "sipoc", name: "SIPOC", build: sipoc },
  { id: "swimlane", name: "Swimlane", build: swimlane },
  { id: "swab-site-map", name: "Swab-site map", build: swabSiteMap },
  { id: "slide-16x9", name: "16:9 slide", build: slide16x9 },
].map((s) => Object.freeze(s)));

// Elements of a starter. Ids come from a counter, so the same starter and measure always give the same elements.
export function buildStarter(starter, { measure = null, origin = { x: 0, y: 0 } } = {}) {
  let n = 0;
  const builder = createBuilder({ measure, newId: () => `tpl-${starter.id}-${++n}` });
  starter.build(builder, { origin });
  return builder.elements();
}

function cleanData(customData) {
  if (!customData || typeof customData !== "object") return undefined;
  const out = structuredClone(customData);
  if (out.plexus && typeof out.plexus === "object") {
    delete out.plexus.mm;
    delete out.plexus.addKey;
    delete out.plexus.order;
    if (!Object.keys(out.plexus).length) delete out.plexus;
  }
  return Object.keys(out).length ? out : undefined;
}

// Fresh copies of `elements` for a scene write: new ids, group ids and seeds; containers, bound elements, bindings and
// frames remapped (a reference to something outside the set is dropped and the arrow keeps its points); plexus map and
// add markers removed; the common bounds centred on `centre`. Deleted elements are left out.
export function remapForInsert(elements, { centre = null, newId = rid, now = Date.now() } = {}) {
  const src = liveElements(elements);
  const ids = new Map();
  for (const el of src) ids.set(el.id, String(newId()));
  const groups = new Map();
  const mapGroup = (g) => {
    if (!groups.has(g)) groups.set(g, `g${rid()}`);
    return groups.get(g);
  };
  const out = src.map((el) => {
    const c = structuredClone(el);
    c.id = ids.get(el.id);
    c.groupIds = (el.groupIds || []).map(mapGroup);
    c.frameId = el.frameId && ids.has(el.frameId) ? ids.get(el.frameId) : null;
    c.containerId = el.containerId && ids.has(el.containerId) ? ids.get(el.containerId) : null;
    if (!("containerId" in el)) delete c.containerId;
    if (Array.isArray(el.boundElements)) {
      const kept = el.boundElements.filter((e) => e && ids.has(e.id)).map((e) => ({ ...e, id: ids.get(e.id) }));
      c.boundElements = kept.length ? kept : null;
    }
    for (const key of ["startBinding", "endBinding"]) {
      const bind = el[key];
      if (bind && typeof bind === "object") c[key] = ids.has(bind.elementId) ? { ...bind, elementId: ids.get(bind.elementId) } : null;
    }
    const data = cleanData(el.customData);
    if (data) c.customData = data;
    else delete c.customData;
    c.index = null;
    c.seed = rnd();
    c.version = 1;
    c.versionNonce = rnd();
    c.updated = now;
    c.isDeleted = false;
    return c;
  });
  if (centre) {
    const bounds = commonBounds(out);
    if (bounds) {
      const dx = centre.x - (bounds[0] + bounds[2]) / 2;
      const dy = centre.y - (bounds[1] + bounds[3]) / 2;
      for (const el of out) { el.x += dx; el.y += dy; }
    }
  }
  return out;
}

// The scene array with the new elements appended and every new frame given an order after the existing ones.
export function withTemplateFrames(current, added) {
  const frames = added.filter(isFrameLike);
  if (!frames.length) return [...current, ...added];
  const { rewrite, orders } = planOrders(current, frames.length);
  let k = 0;
  const ordered = added.map((el) => (isFrameLike(el) ? withOrder(el, orders[k++]) : el));
  return [...applyOrderRewrite(current, rewrite), ...ordered];
}

const isImage = (el) => el.type === "image";

// The closed set of a selection to save (amendment 17): the selected elements, the bound text of every included
// container or arrow, the children of every selected frame, and the arrows with both ends inside. Deleted elements and
// images without an upload (customData.firebaseUrl) are left out. Returns {elements, skippedImages}, deep copies in scene
// order with plexus map markers removed; a selected arrow with one end outside keeps its points and loses that binding,
// and children whose frame is not included lose their frame.
export function selectionToTemplate(elements, selectedIds) {
  const live = liveElements(elements);
  const byId = new Map(live.map((el) => [el.id, el]));
  const set = new Set();
  for (const id of selectedIds || []) if (byId.has(id)) set.add(id);
  for (const id of [...set]) {
    const el = byId.get(id);
    if (isFrameLike(el)) for (const child of live) if (child.frameId === id && child.type !== "text") set.add(child.id);
  }
  for (const el of live) {
    if ((el.type === "arrow" || el.type === "line") && !set.has(el.id)) {
      const a = el.startBinding?.elementId;
      const z = el.endBinding?.elementId;
      if (a && z && set.has(a) && set.has(z)) set.add(el.id);
    }
  }
  let skippedImages = 0;
  for (const id of [...set]) {
    const el = byId.get(id);
    if (isImage(el) && !el.customData?.firebaseUrl) { set.delete(id); skippedImages += 1; }
  }
  // Bound text last, so a dropped container takes its text with it.
  for (const el of live) {
    if (el.type !== "text") continue;
    if (el.containerId && set.has(el.containerId)) set.add(el.id);
    else if (set.has(el.id) && el.containerId && !set.has(el.containerId)) set.delete(el.id);
  }
  for (const el of live) {
    if (el.type === "text" && !el.containerId && el.frameId && set.has(el.frameId)) set.add(el.id);
  }
  const out = [];
  for (const el of live) {
    if (!set.has(el.id)) continue;
    const c = structuredClone(el);
    if (c.customData?.plexus && typeof c.customData.plexus === "object") {
      delete c.customData.plexus.mm;
      if (!Object.keys(c.customData.plexus).length) delete c.customData.plexus;
      if (!Object.keys(c.customData).length) delete c.customData;
    }
    if (c.frameId && !set.has(c.frameId)) c.frameId = null;
    if (Array.isArray(c.boundElements)) {
      const kept = c.boundElements.filter((e) => e && set.has(e.id));
      c.boundElements = kept.length ? kept : null;
    }
    for (const key of ["startBinding", "endBinding"]) {
      if (c[key] && !set.has(c[key].elementId)) c[key] = null;
    }
    out.push(c);
  }
  return { elements: out, skippedImages };
}

// Drawing appState keys that carry the current item style (the roadmap asks templates to keep them).
export function pickCurrentItem(appState) {
  const out = {};
  if (!appState || typeof appState !== "object") return out;
  for (const [k, v] of Object.entries(appState)) if (k.startsWith("currentItem") && v !== undefined) out[k] = v;
  return out;
}
