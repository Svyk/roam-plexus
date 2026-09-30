import { baseElement } from "./embeds.js";
import { arrowLabelRect, arrowLabelWrapWidth } from "./arrowlabel.js";
import { layoutTree, wrapLines, MAX_TEXT_WIDTH, PAD_X, PAD_Y } from "./mindmap.js";

// Pure element builder (P12 API-1). Shapes follow Excalidraw 0.18.0: PointBinding {elementId, focus, gap}, no fixedPoint.
// Nothing here touches a scene; api.js commits the finished elements through the write guard.
export const DEFAULT_STYLE = Object.freeze({
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  roughness: 1,
  fontSize: 20,
  fontFamily: 5,
});
export const LAYOUT_KINDS = Object.freeze(["row", "column", "grid", "tree"]);

const STYLE_KEYS = Object.keys(DEFAULT_STYLE);
const GAP = 4;
const LAYOUT_GAP = 40;
const LABEL_FONT = 16;
const LABEL_FAMILY = 5;
const LINE_HEIGHT = 1.25;
const SEALED = "Already committed";
const BINDABLE = new Set(["rectangle", "ellipse", "diamond", "text"]);
const BOX_TYPES = new Set(["rectangle", "ellipse", "diamond"]);

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const need = (v, name) => { if (!isNum(v)) throw new Error(`${name} must be a finite number`); return v; };

export function createBuilder({ style: initial, measure, newId } = {}) {
  const st = { ...DEFAULT_STYLE };
  const setStyle = (patch) => {
    if (!patch || typeof patch !== "object") return;
    for (const k of STYLE_KEYS) if (patch[k] !== undefined) st[k] = patch[k];
  };
  setStyle(initial);
  const genId = typeof newId === "function" ? newId : () => `b${Math.random().toString(36).slice(2, 12)}`;
  const list = [];
  const byId = new Map();
  const textOf = new Map(); // container or arrow id -> bound text id
  const arrows = [];
  const frames = [];
  let sealed = false;

  const open = () => { if (sealed) throw new Error(SEALED); };
  const uniqueId = () => {
    const id = String(genId());
    if (byId.has(id)) throw new Error(`Duplicate id ${id}`);
    return id;
  };
  const measurer = (fontSize, family) => (s) => (family === 5 && typeof measure === "function" ? measure(s, fontSize) : String(s).length * 0.6 * fontSize);
  function fit(text, fontSize, family, maxWidth) {
    const m = measurer(fontSize, family);
    const lines = maxWidth == null ? String(text).split("\n") : wrapLines(text, maxWidth, m);
    let w = 0;
    for (const l of lines) w = Math.max(w, m(l));
    return { text: lines.join("\n"), width: Math.ceil(w), height: lines.length * fontSize * LINE_HEIGHT };
  }

  function make(type, x, y, w, h, o = {}) {
    open();
    const el = baseElement(uniqueId(), type, need(x, "x"), need(y, "y"), w, h);
    el.strokeColor = o.strokeColor ?? st.strokeColor;
    el.backgroundColor = o.backgroundColor ?? st.backgroundColor;
    el.fillStyle = o.fillStyle ?? st.fillStyle;
    el.strokeWidth = o.strokeWidth ?? st.strokeWidth;
    el.roughness = o.roughness ?? st.roughness;
    if (o.strokeStyle) el.strokeStyle = o.strokeStyle;
    if (isNum(o.opacity)) el.opacity = o.opacity;
    if (Array.isArray(o.groupIds)) el.groupIds = [...o.groupIds];
    if (typeof o.link === "string") el.link = o.link;
    if (o.customData && typeof o.customData === "object") el.customData = structuredClone(o.customData);
    list.push(el);
    byId.set(el.id, el);
    return el;
  }

  function makeText(x, y, str, o, container) {
    const fontSize = o.fontSize ?? st.fontSize;
    const fontFamily = o.fontFamily ?? st.fontFamily;
    const f = fit(str, fontSize, fontFamily, o.maxWidth ?? null);
    const el = make("text", x, y, f.width, f.height, { strokeColor: o.textColor ?? o.strokeColor, strokeWidth: 1, roughness: 0 });
    el.backgroundColor = "transparent";
    Object.assign(el, {
      text: f.text, originalText: String(str), fontSize, fontFamily,
      textAlign: container ? "center" : o.textAlign ?? "left",
      verticalAlign: container ? "middle" : "top",
      containerId: container ?? null, autoResize: true, lineHeight: LINE_HEIGHT,
    });
    if (o.customData && !container) el.customData = structuredClone(o.customData);
    return el;
  }

  const resolve = (id) => {
    const el = byId.get(id);
    if (!el) throw new Error(`Unknown element ${id}`);
    return el.type === "text" && el.containerId ? byId.get(el.containerId) : el;
  };
  const bindTo = (container, entry) => { container.boundElements = [...(container.boundElements || []), entry]; };

  function shape(type, x, y, w, h, o = {}) {
    const el = make(type, x, y, need(w, "width"), need(h, "height"), o);
    el.roundness = type === "rectangle" ? { type: 3 } : type === "diamond" ? { type: 2 } : null;
    return el.id;
  }

  const api = {
    style(patch) {
      open();
      setStyle(patch);
      return { ...st };
    },
    rect: (x, y, w, h, o) => shape("rectangle", x, y, w, h, o),
    ellipse: (x, y, w, h, o) => shape("ellipse", x, y, w, h, o),
    diamond: (x, y, w, h, o) => shape("diamond", x, y, w, h, o),
    text: (x, y, str, o = {}) => makeText(x, y, String(str ?? ""), o, null).id,
    box(str, o = {}) {
      const type = o.type ?? "rectangle";
      if (!BOX_TYPES.has(type)) throw new Error(`Unknown box type ${type}`);
      const fontSize = o.fontSize ?? st.fontSize;
      const fontFamily = o.fontFamily ?? st.fontFamily;
      const scale = type === "diamond" ? 2 : type === "ellipse" ? 1.42 : 1;
      let f;
      let W;
      let H;
      if (o.width != null) {
        f = fit(str, fontSize, fontFamily, Math.max(1, o.width - 10));
        W = o.width;
        H = o.height ?? Math.max(f.height + 2 * PAD_Y, o.minHeight ?? 0);
      } else {
        f = fit(str, fontSize, fontFamily, MAX_TEXT_WIDTH);
        W = Math.max((f.width + 2 * PAD_X) * scale, o.minWidth ?? 0);
        H = o.height ?? Math.max((f.height + 2 * PAD_Y) * scale, o.minHeight ?? 0);
      }
      const x = o.x ?? 0;
      const y = o.y ?? 0;
      const c = make(type, x, y, W, H, o);
      c.roundness = type === "rectangle" ? { type: 3 } : type === "diamond" ? { type: 2 } : null;
      const t = makeText(x + W / 2 - f.width / 2, y + H / 2 - f.height / 2, str, { ...o, maxWidth: o.width != null ? Math.max(1, o.width - 10) : MAX_TEXT_WIDTH, textColor: o.textColor ?? st.strokeColor, fontSize, fontFamily }, c.id);
      t.groupIds = [...c.groupIds];
      textOf.set(c.id, t.id);
      c.boundElements = [{ id: t.id, type: "text" }];
      return c.id;
    },
    frame(x, y, w, h, o = {}) {
      const el = make("frame", x, y, need(w, "width"), need(h, "height"), { strokeColor: "#bbbbbb", strokeWidth: 2, roughness: 0, ...o });
      el.name = o.name ?? null;
      const children = [];
      for (const id of o.children || []) {
        const c = resolve(id);
        if (c.type === "frame") throw new Error("A frame cannot hold a frame");
        if (!children.includes(c.id)) children.push(c.id);
      }
      frames.push({ id: el.id, children });
      return el.id;
    },
    line(x, y, points, o = {}) {
      if (!Array.isArray(points) || points.length < 2 || points.some((p) => !Array.isArray(p) || !isNum(p[0]) || !isNum(p[1]))) throw new Error("line needs at least two [x, y] points");
      const xs = points.map((p) => p[0]);
      const ys = points.map((p) => p[1]);
      const el = make("line", x, y, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), o);
      Object.assign(el, { points: points.map((p) => [p[0], p[1]]), lastCommittedPoint: null, startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: null });
      return el.id;
    },
    arrow(a, b, o = {}) {
      open();
      const from = resolve(a);
      const to = resolve(b);
      for (const el of [from, to]) if (!BINDABLE.has(el.type) || el.containerId) throw new Error(`Cannot bind an arrow to ${el.type}`);
      if (from.id === to.id) throw new Error("Cannot bind an arrow to one element");
      const el = make("arrow", from.x, from.y, 0, 0, { ...o, backgroundColor: "transparent" });
      Object.assign(el, {
        points: [[0, 0], [0, 0]], lastCommittedPoint: null,
        startBinding: { elementId: from.id, focus: 0, gap: GAP }, endBinding: { elementId: to.id, focus: 0, gap: GAP },
        startArrowhead: o.startArrowhead ?? null, endArrowhead: o.endArrowhead === undefined ? "arrow" : o.endArrowhead, elbowed: false, roundness: null,
      });
      bindTo(from, { id: el.id, type: "arrow" });
      bindTo(to, { id: el.id, type: "arrow" });
      if (o.label !== undefined && o.label !== null && String(o.label) !== "") {
        const t = makeText(0, 0, String(o.label), { fontSize: LABEL_FONT, fontFamily: LABEL_FAMILY, textColor: o.textColor ?? st.strokeColor }, el.id);
        textOf.set(el.id, t.id);
        el.boundElements = [{ id: t.id, type: "text" }];
      }
      arrows.push({ id: el.id, from: from.id, to: to.id });
      return el.id;
    },
    size(id) {
      const el = resolve(id);
      return { width: el.width, height: el.height };
    },
    place(id, x, y) {
      open();
      const el = resolve(id);
      el.x = need(x, "x");
      el.y = need(y, "y");
    },
    layout(ids, kind, o = {}) {
      open();
      if (!LAYOUT_KINDS.includes(kind)) throw new Error(`Unknown layout ${kind}`);
      if (!Array.isArray(ids)) throw new Error("layout needs an array of ids");
      const items = [];
      for (const id of ids) {
        const el = resolve(id);
        if (el.type === "arrow" || el.type === "frame") continue;
        if (!items.includes(el)) items.push(el);
      }
      if (!items.length) return;
      const gap = isNum(o.gap) ? o.gap : LAYOUT_GAP;
      const ox = Math.min(...items.map((e) => e.x));
      const oy = Math.min(...items.map((e) => e.y));
      const maxW = Math.max(...items.map((e) => e.width));
      const maxH = Math.max(...items.map((e) => e.height));
      if (kind === "row") {
        let x = ox;
        for (const e of items) { e.x = x; e.y = oy + (maxH - e.height) / 2; x += e.width + gap; }
      } else if (kind === "column") {
        let y = oy;
        for (const e of items) { e.y = y; e.x = ox + (maxW - e.width) / 2; y += e.height + gap; }
      } else if (kind === "grid") {
        const cols = Math.ceil(Math.sqrt(items.length));
        items.forEach((e, i) => {
          e.x = ox + (i % cols) * (maxW + gap) + (maxW - e.width) / 2;
          e.y = oy + Math.floor(i / cols) * (maxH + gap) + (maxH - e.height) / 2;
        });
      } else {
        const inSet = new Set(items.map((e) => e.id));
        const kids = new Map(items.map((e) => [e.id, []]));
        const hasIn = new Set();
        for (const a of arrows) {
          if (!inSet.has(a.from) || !inSet.has(a.to)) continue;
          kids.get(a.from).push(a.to);
          hasIn.add(a.to);
        }
        const seen = new Set();
        const grow = (id) => {
          seen.add(id);
          const node = { uid: id, children: [] };
          for (const k of kids.get(id)) if (!seen.has(k)) node.children.push(grow(k));
          return node;
        };
        const roots = [];
        for (const e of items) if (!hasIn.has(e.id) && !seen.has(e.id)) roots.push(grow(e.id));
        for (const e of items) if (!seen.has(e.id)) roots.push(grow(e.id));
        const sizes = Object.fromEntries(items.map((e) => [e.id, { width: e.width, height: e.height }]));
        let cursor = oy;
        for (const tree of roots) {
          const pos = layoutTree({ tree, sizes, layout: "right", root: { x: 0, y: 0 } });
          let minX = Infinity;
          let minY = Infinity;
          let maxY = -Infinity;
          for (const [uid, p] of Object.entries(pos)) {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y + sizes[uid].height);
          }
          for (const [uid, p] of Object.entries(pos)) {
            const e = byId.get(uid);
            e.x = ox + (p.x - minX);
            e.y = cursor + (p.y - minY);
          }
          cursor += maxY - minY + gap;
        }
      }
    },
    // Finished elements: bound text centred, arrow ends clipped to the boxes, labels placed, frame children first.
    elements() {
      const out = new Map(list.map((e) => [e.id, structuredClone(e)]));
      for (const [cid, tid] of textOf) {
        const c = out.get(cid);
        const t = out.get(tid);
        if (c.type === "arrow") continue;
        t.x = c.x + c.width / 2 - t.width / 2;
        t.y = c.y + c.height / 2 - t.height / 2;
      }
      for (const a of arrows) {
        const el = out.get(a.id);
        const A = out.get(a.from);
        const B = out.get(a.to);
        const ca = { x: A.x + A.width / 2, y: A.y + A.height / 2 };
        const cb = { x: B.x + B.width / 2, y: B.y + B.height / 2 };
        const dist = Math.hypot(cb.x - ca.x, cb.y - ca.y);
        let p0 = ca;
        let p1 = cb;
        if (dist > 0) {
          const ux = (cb.x - ca.x) / dist;
          const uy = (cb.y - ca.y) / dist;
          const exit = (b) => Math.min(Math.abs(ux) > 1e-9 ? b.width / 2 / Math.abs(ux) : Infinity, Math.abs(uy) > 1e-9 ? b.height / 2 / Math.abs(uy) : Infinity);
          const s0 = exit(A) + GAP;
          const s1 = exit(B) + GAP;
          if (s0 + s1 < dist) {
            p0 = { x: ca.x + ux * s0, y: ca.y + uy * s0 };
            p1 = { x: cb.x - ux * s1, y: cb.y - uy * s1 };
          }
        }
        el.x = p0.x;
        el.y = p0.y;
        el.points = [[0, 0], [p1.x - p0.x, p1.y - p0.y]];
        el.width = Math.abs(p1.x - p0.x);
        el.height = Math.abs(p1.y - p0.y);
        const tid = textOf.get(a.id);
        if (tid) {
          const t = out.get(tid);
          const f = fit(t.originalText, t.fontSize, t.fontFamily, arrowLabelWrapWidth(el.width, t.fontSize));
          Object.assign(t, { text: f.text, width: f.width, height: f.height });
          Object.assign(t, arrowLabelRect(el, f.width, f.height));
        }
      }
      let order = [...out.values()].filter((e) => e.type !== "frame");
      const frameEls = new Map(frames.map((f) => [f.id, out.get(f.id)]));
      for (const f of frames) {
        const members = new Set();
        for (const c of f.children) { members.add(c); if (textOf.has(c)) members.add(textOf.get(c)); }
        for (const e of order) if (members.has(e.id)) e.frameId = f.id;
        let last = -1;
        order.forEach((e, i) => { if (members.has(e.id)) last = i; });
        order.splice(last + 1, 0, frameEls.get(f.id));
      }
      const placed = new Set(order.map((e) => e.id));
      for (const e of frameEls.values()) if (!placed.has(e.id)) order.push(e);
      return order;
    },
    ids: () => list.map((e) => e.id),
    has: (id) => byId.has(id),
    seal() { sealed = true; },
    get sealed() { return sealed; },
  };
  return Object.freeze(api);
}
