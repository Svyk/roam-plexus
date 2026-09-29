import { normalizeFrac } from "./region.js";
import { clipPolyToUnit, polyBBox } from "./image.js";

export const VIEW_EXPORT_PADDING = 10;

const CURVE_SAMPLES = 24;

function pick(props, name) {
  if (!props || typeof props !== "object") return undefined;
  for (const key of [`:excalidraw/${name}`, `excalidraw/${name}`, name]) {
    if (props[key] !== undefined && props[key] !== null) return props[key];
  }
  return undefined;
}

function parseJson(value) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return undefined; }
}

export function parseDrawingProps(props) {
  const raw = pick(props, "elements-json");
  if (raw === undefined) return null;
  const elements = parseJson(raw);
  if (!Array.isArray(elements)) return null;
  const state = parseJson(pick(props, "state-json"));
  return {
    elements,
    appState: state && typeof state === "object" && !Array.isArray(state) ? state : {},
    version: pick(props, "version") ?? null,
    instanceId: pick(props, "instance-id") ?? null,
    elementsJson: typeof raw === "string" ? raw : JSON.stringify(raw),
  };
}

export function liveElements(elements) {
  return Array.isArray(elements) ? elements.filter((el) => el && !el.isDeleted) : [];
}

function rotate(px, py, cx, cy, angle) {
  if (!angle) return [px, py];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = px - cx;
  const dy = py - cy;
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
}

function boundsOf(points) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const [x, y] of points) {
    if (x < x1) x1 = x;
    if (y < y1) y1 = y;
    if (x > x2) x2 = x;
    if (y > y2) y2 = y;
  }
  return [x1, y1, x2, y2];
}

// roughjs / points-on-curve curveToBezier with tightness 0.
// The 3-point case is a single cubic that does not reach the middle point, so elementBounds also unions the raw points (never crop too small).
function curveToBezier(pointsIn) {
  const len = pointsIn.length;
  if (len === 3) return [pointsIn[0], pointsIn[1], pointsIn[2], pointsIn[2]];
  const pts = [pointsIn[0], pointsIn[0]];
  for (let i = 1; i < len; i++) {
    pts.push(pointsIn[i]);
    if (i === len - 1) pts.push(pointsIn[i]);
  }
  const s = 1;
  const b = [[pts[0][0], pts[0][1]]];
  for (let i = 1; i + 2 < pts.length; i++) {
    const p = pts[i];
    b.push([p[0] + (s * pts[i + 1][0] - s * pts[i - 1][0]) / 6, p[1] + (s * pts[i + 1][1] - s * pts[i - 1][1]) / 6]);
    b.push([pts[i + 1][0] + (s * pts[i][0] - s * pts[i + 2][0]) / 6, pts[i + 1][1] + (s * pts[i][1] - s * pts[i + 2][1]) / 6]);
    b.push([pts[i + 1][0], pts[i + 1][1]]);
  }
  return b;
}

function sampleCurve(points) {
  const b = curveToBezier(points);
  const out = [];
  for (let i = 0; i + 3 < b.length; i += 3) {
    const [p0, p1, p2, p3] = [b[i], b[i + 1], b[i + 2], b[i + 3]];
    for (let k = 0; k <= CURVE_SAMPLES; k++) {
      const t = k / CURVE_SAMPLES;
      const u = 1 - t;
      const a = u * u * u, bb = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
      out.push([a * p0[0] + bb * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + bb * p1[1] + c * p2[1] + d * p3[1]]);
    }
  }
  return out;
}

export function elementBounds(el) {
  const x = Number(el.x) || 0;
  const y = Number(el.y) || 0;
  const w = Number(el.width) || 0;
  const h = Number(el.height) || 0;
  const angle = Number(el.angle) || 0;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rot = (px, py) => rotate(px, py, cx, cy, angle);
  const corners = () => boundsOf([rot(x, y), rot(x + w, y), rot(x + w, y + h), rot(x, y + h)]);

  switch (el.type) {
    case "diamond":
      return boundsOf([rot(cx, y), rot(x + w, cy), rot(cx, y + h), rot(x, cy)]);
    case "ellipse": {
      const a = w / 2, b = h / 2;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const hx = Math.sqrt((a * cos) ** 2 + (b * sin) ** 2);
      const hy = Math.sqrt((a * sin) ** 2 + (b * cos) ** 2);
      return [cx - hx, cy - hy, cx + hx, cy + hy];
    }
    case "line":
    case "arrow":
    case "freedraw": {
      const pts = Array.isArray(el.points) ? el.points.filter((p) => Array.isArray(p) && p.length >= 2) : [];
      if (!pts.length) return corners();
      const [lx1, ly1, lx2, ly2] = boundsOf(pts);
      const pcx = x + (lx1 + lx2) / 2;
      const pcy = y + (ly1 + ly2) / 2;
      const curved = (el.type === "line" || el.type === "arrow") && el.roundness != null && el.elbowed !== true && pts.length >= 3;
      const source = curved ? [...pts, ...sampleCurve(pts)] : pts;
      return boundsOf(source.map(([px, py]) => rotate(x + px, y + py, pcx, pcy, angle)));
    }
    default:
      return corners();
  }
}

export function commonBounds(elements) {
  const live = liveElements(elements);
  if (!live.length) return null;
  const all = live.map(elementBounds);
  return [
    Math.min(...all.map((b) => b[0])),
    Math.min(...all.map((b) => b[1])),
    Math.max(...all.map((b) => b[2])),
    Math.max(...all.map((b) => b[3])),
  ];
}

export const FRAME_LABEL_HEIGHT = 20.5;

const showsFrameLabel = (appState) => appState?.frameRendering?.name !== false;

// Bounds of Roam's view PNG: commonBounds plus each frame's exported name label above it.
export function exportBounds(elements, appState) {
  const cb = commonBounds(elements);
  if (!cb || !showsFrameLabel(appState)) return cb;
  let [x1, y1, x2, y2] = cb;
  for (const el of liveElements(elements)) {
    if (el.type !== "frame" && el.type !== "magicframe") continue;
    const b = elementBounds(el);
    x1 = Math.min(x1, b[0]);
    y1 = Math.min(y1, b[1] - FRAME_LABEL_HEIGHT);
    x2 = Math.max(x2, b[2]);
  }
  return [x1, y1, x2, y2];
}

function validCrop(c) {
  return !!c && c.width > 0 && c.height > 0 && c.naturalWidth > 0 && c.naturalHeight > 0;
}

// Region fractions are relative to the natural (uncropped) image; el.crop is in natural pixels.
export function naturalToScene(el, [nx, ny]) {
  const c = el.crop;
  if (!validCrop(c)) return [el.x + nx * el.width, el.y + ny * el.height];
  return [
    el.x + (nx * c.naturalWidth - c.x) * el.width / c.width,
    el.y + (ny * c.naturalHeight - c.y) * el.height / c.height,
  ];
}

export function sceneToNatural(el, [sx, sy]) {
  const c = el.crop;
  if (!validCrop(c)) return [(sx - el.x) / el.width, (sy - el.y) / el.height];
  return [
    (c.x + (sx - el.x) * c.width / el.width) / c.naturalWidth,
    (c.y + (sy - el.y) * c.height / el.height) / c.naturalHeight,
  ];
}

// area: union of the listed live elements plus region.pad on each side (matches the hot SVG export).
// rect/poly: the fraction (poly: its bbox fraction) of an unrotated image element.
// group: union of live members + pad. frame: frame bbox + pad. cframe: frame bbox exactly.
// imgrect/imgpoly have no scene geometry (unsupported-kind).
export function regionSceneBBox(region, elements, appState) {
  const live = liveElements(elements);
  if (!region || !live.length) return { error: "no-elements" };
  if (region.kind === "area") {
    const byId = new Map(live.map((el) => [el.id, el]));
    const found = [];
    const missing = [];
    for (const id of region.ids ?? []) {
      if (byId.has(id)) found.push(byId.get(id)); else missing.push(id);
    }
    if (!found.length) return { error: "no-elements" };
    const b = commonBounds(found);
    const pad = region.pad ?? 10;
    return { bbox: [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad], missing };
  }
  if (region.kind === "rect" || region.kind === "poly") {
    const el = live.find((e) => e.id === region.el);
    if (!el) return { error: "no-elements" };
    if (el.type !== "image") return { error: "not-image" };
    if (Number(el.angle) || 0) return { error: "rotated-image" };
    const [rx, ry, rw, rh] = region.kind === "rect" ? region.f : (polyBBox(region.p) ?? [0, 0, 0, 0]);
    if (!(rw > 0) || !(rh > 0)) return { error: "no-elements" };
    if (!validCrop(el.crop)) {
      return {
        bbox: [el.x + rx * el.width, el.y + ry * el.height, el.x + (rx + rw) * el.width, el.y + (ry + rh) * el.height],
        missing: [],
      };
    }
    if (region.kind === "poly") {
      const disp = [];
      for (let i = 0; i + 1 < region.p.length; i += 2) {
        const [sx, sy] = naturalToScene(el, [region.p[i], region.p[i + 1]]);
        disp.push((sx - el.x) / el.width, (sy - el.y) / el.height);
      }
      const clipped = clipPolyToUnit(disp);
      if (!clipped) return { error: "outside-crop" };
      let cx1 = Infinity, cy1 = Infinity, cx2 = -Infinity, cy2 = -Infinity;
      for (let i = 0; i < clipped.length; i += 2) {
        cx1 = Math.min(cx1, clipped[i]); cx2 = Math.max(cx2, clipped[i]);
        cy1 = Math.min(cy1, clipped[i + 1]); cy2 = Math.max(cy2, clipped[i + 1]);
      }
      return { bbox: [el.x + cx1 * el.width, el.y + cy1 * el.height, el.x + cx2 * el.width, el.y + cy2 * el.height], missing: [] };
    }
    const [ax, ay] = naturalToScene(el, [rx, ry]);
    const [bx, by] = naturalToScene(el, [rx + rw, ry + rh]);
    const x1 = Math.max(ax, el.x), y1 = Math.max(ay, el.y);
    const x2 = Math.min(bx, el.x + el.width), y2 = Math.min(by, el.y + el.height);
    if (!(x2 > x1) || !(y2 > y1)) return { error: "outside-crop" };
    return { bbox: [x1, y1, x2, y2], missing: [] };
  }
  if (region.kind === "group") {
    const g = region.groupId ?? region.g;
    const members = live.filter((el) => Array.isArray(el.groupIds) && el.groupIds.includes(g));
    if (!members.length) return { error: "no-elements" };
    const b = commonBounds(members);
    const pad = region.pad ?? 10;
    return { bbox: [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad], missing: [] };
  }
  if (region.kind === "frame" || region.kind === "cframe") {
    const id = region.frameId ?? region.fr;
    const frame = live.find((el) => el.id === id);
    if (!frame) return { error: "no-elements" };
    if (frame.type !== "frame" && frame.type !== "magicframe") return { error: "not-frame" };
    const b = elementBounds(frame);
    const pad = region.kind === "cframe" ? 0 : (region.pad ?? 10);
    let top = b[1] - pad;
    if (region.kind === "frame" && showsFrameLabel(appState)) top = b[1] - pad - FRAME_LABEL_HEIGHT;
    return { bbox: [b[0] - pad, top, b[2] + pad, b[3] + pad], missing: [] };
  }
  return { error: "unsupported-kind" };
}

export function viewPngCropRect({ elements, appState, bbox, naturalWidth, naturalHeight, padding = VIEW_EXPORT_PADDING }) {
  const cb = exportBounds(elements, appState);
  if (!cb || !bbox) return { error: "bounds-mismatch", expected: [0, 0], actual: [naturalWidth, naturalHeight] };
  const ew = Math.round(cb[2] - cb[0] + 2 * padding);
  const eh = Math.round(cb[3] - cb[1] + 2 * padding);
  if (Math.abs(naturalWidth - ew) > 2 || Math.abs(naturalHeight - eh) > 2) {
    return { error: "bounds-mismatch", expected: [ew, eh], actual: [naturalWidth, naturalHeight] };
  }
  const ox = cb[0] - padding;
  const oy = cb[1] - padding;
  const x1 = Math.min(naturalWidth - 1, Math.max(0, Math.round(bbox[0] - ox)));
  const y1 = Math.min(naturalHeight - 1, Math.max(0, Math.round(bbox[1] - oy)));
  const x2 = Math.min(naturalWidth, Math.max(x1 + 1, Math.round(bbox[2] - ox)));
  const y2 = Math.min(naturalHeight, Math.max(y1 + 1, Math.round(bbox[3] - oy)));
  return { sx: x1, sy: y1, sw: x2 - x1, sh: y2 - y1 };
}

export function fitZoom({ bbox, viewportWidth, viewportHeight, margin = 0.12, minZoom = 0.1, maxZoom = 4 }) {
  const bw = Math.max(bbox[2] - bbox[0], 1);
  const bh = Math.max(bbox[3] - bbox[1], 1);
  const raw = Math.min((viewportWidth * (1 - 2 * margin)) / bw, (viewportHeight * (1 - 2 * margin)) / bh);
  const zoom = Math.min(maxZoom, Math.max(minZoom, raw));
  const cx = (bbox[0] + bbox[2]) / 2;
  const cy = (bbox[1] + bbox[3]) / 2;
  return { zoom, scrollX: viewportWidth / (2 * zoom) - cx, scrollY: viewportHeight / (2 * zoom) - cy };
}

function view(appState) {
  const z = appState?.zoom;
  return {
    zoom: (typeof z === "number" ? z : z?.value) || 1,
    scrollX: appState?.scrollX || 0,
    scrollY: appState?.scrollY || 0,
    left: appState?.offsetLeft || 0,
    top: appState?.offsetTop || 0,
  };
}

export function sceneToViewport({ x, y, appState }) {
  const v = view(appState);
  return { x: (x + v.scrollX) * v.zoom + v.left, y: (y + v.scrollY) * v.zoom + v.top };
}

export function viewportToScene({ x, y, appState }) {
  const v = view(appState);
  return { x: (x - v.left) / v.zoom - v.scrollX, y: (y - v.top) / v.zoom - v.scrollY };
}

export function rectToFraction(dragRect, imageRect) {
  if (!dragRect || !imageRect || !(imageRect.width > 0) || !(imageRect.height > 0)) return null;
  const x1 = Math.max(dragRect.left, imageRect.left);
  const y1 = Math.max(dragRect.top, imageRect.top);
  const x2 = Math.min(dragRect.left + dragRect.width, imageRect.left + imageRect.width);
  const y2 = Math.min(dragRect.top + dragRect.height, imageRect.top + imageRect.height);
  if (x2 - x1 < 4 || y2 - y1 < 4) return null;
  return normalizeFrac({
    rx: (x1 - imageRect.left) / imageRect.width,
    ry: (y1 - imageRect.top) / imageRect.height,
    rw: (x2 - x1) / imageRect.width,
    rh: (y2 - y1) / imageRect.height,
  });
}

const fmt = (n) => String(Math.round(n * 1000) / 1000);

function setAttr(tag, name, value) {
  const re = new RegExp(`(\\s${name}\\s*=\\s*)(["'])[^"']*\\2`);
  if (re.test(tag)) return tag.replace(re, `$1"${value}"`);
  return tag.replace(/\s*(\/?)>$/, ` ${name}="${value}"$1>`);
}

export function cropSvgToFraction(svgString, f, pad = VIEW_EXPORT_PADDING) {
  const frac = normalizeFrac(f);
  if (!frac) throw new TypeError("cropSvgToFraction: bad fraction");
  const m = /<svg\b[^>]*>/.exec(svgString);
  if (!m) throw new TypeError("cropSvgToFraction: no <svg> root");
  const tag = m[0];
  const vb = /\sviewBox\s*=\s*["']\s*(-?[\d.eE+-]+)[\s,]+(-?[\d.eE+-]+)[\s,]+([\d.eE+-]+)[\s,]+([\d.eE+-]+)\s*["']/.exec(tag);
  if (!vb) throw new TypeError("cropSvgToFraction: no viewBox");
  const [minX, minY, vw, vh] = vb.slice(1).map(Number);
  const wAttr = /\swidth\s*=\s*["']([\d.]+)(?:px)?["']/.exec(tag);
  const hAttr = /\sheight\s*=\s*["']([\d.]+)(?:px)?["']/.exec(tag);
  const sx = wAttr && vw > 0 ? Number(wAttr[1]) / vw : 1;
  const sy = hAttr && vh > 0 ? Number(hAttr[1]) / vh : 1;
  const ew = vw - 2 * pad;
  const eh = vh - 2 * pad;
  const [rx, ry, rw, rh] = frac;
  const nx = minX + pad + rx * ew;
  const ny = minY + pad + ry * eh;
  const nw = rw * ew;
  const nh = rh * eh;
  let next = setAttr(tag, "viewBox", `${fmt(nx)} ${fmt(ny)} ${fmt(nw)} ${fmt(nh)}`);
  next = setAttr(next, "width", fmt(nw * sx));
  next = setAttr(next, "height", fmt(nh * sy));
  return svgString.slice(0, m.index) + next + svgString.slice(m.index + tag.length);
}

const fmt2 = (n) => String(Math.round(n * 100) / 100);

// Excalidraw sizes exported SVGs by its in-memory exportScale; the displayed size must not depend on it.
export function normalizeSvgSize(svgString) {
  const m = /<svg\b[^>]*>/.exec(svgString);
  if (!m) return svgString;
  const tag = m[0];
  const vb = /\sviewBox\s*=\s*["']\s*(-?[\d.eE+-]+)[\s,]+(-?[\d.eE+-]+)[\s,]+([\d.eE+-]+)[\s,]+([\d.eE+-]+)\s*["']/.exec(tag);
  if (!vb) return svgString;
  const vw = Number(vb[3]);
  const vh = Number(vb[4]);
  if (!(vw > 0) || !(vh > 0)) return svgString;
  let next = setAttr(tag, "width", fmt2(vw));
  next = setAttr(next, "height", fmt2(vh));
  return svgString.slice(0, m.index) + next + svgString.slice(m.index + tag.length);
}
