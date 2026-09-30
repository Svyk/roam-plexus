import { baseElement, mergePlexusData } from "./embeds.js";
import { elementBounds, liveElements } from "./scene.js";
import { orderFrames } from "./slides.js";

export const FRAME_GAP = 40;
export const FRAME_PRESETS = Object.freeze({
  "A4": Object.freeze({ width: 794, height: 1123 }),
  "Letter": Object.freeze({ width: 816, height: 1056 }),
  "16:9": Object.freeze({ width: 854, height: 480 }),
  "4:3": Object.freeze({ width: 800, height: 600 }),
  "1:1": Object.freeze({ width: 800, height: 800 }),
  "Mobile": Object.freeze({ width: 390, height: 844 }),
});
export const DEFAULT_PRESET = "16:9";
export const LAYOUTS = Object.freeze({ grid: { cols: 2, rows: 2 }, strip: { cols: 4, rows: 1 } });

const rnd = () => Math.floor(Math.random() * 2 ** 31);
const isFrameLike = (el) => !!el && (el.type === "frame" || el.type === "magicframe");
const orderOf = (el) => {
  const o = el?.customData?.plexus?.order;
  return typeof o === "number" && Number.isFinite(o) ? o : null;
};

export const frameId = () => `plexus-frame-${Math.random().toString(36).slice(2, 12)}`;
export const presetSize = (preset) => FRAME_PRESETS[preset] ?? null;

// A complete frame element. x/y is the top-left corner. index stays null: Excalidraw assigns it on updateScene.
export function presetFrame({ preset = DEFAULT_PRESET, x = 0, y = 0, order = null, name = null, id = frameId() } = {}) {
  const size = presetSize(preset);
  if (!size) return null;
  return {
    ...baseElement(id, "frame", x, y, size.width, size.height),
    name,
    customData: { plexus: { order } },
  };
}

// Where the next slide goes: right of the rightmost live frame, same y. null when there are no frames.
export function nextSlideSlot(elements, gap = FRAME_GAP) {
  let best = null;
  for (const f of liveElements(elements).filter(isFrameLike)) {
    const right = (Number(f.x) || 0) + (Number(f.width) || 0);
    if (!best || right > best.right) best = { right, y: Number(f.y) || 0 };
  }
  return best ? { x: best.right + gap, y: best.y } : null;
}

// Rects of a frame layout centred on `centre`, row-major.
export function layoutFrames({ kind = "grid", preset = DEFAULT_PRESET, centre = { x: 0, y: 0 }, gap = FRAME_GAP } = {}) {
  const size = presetSize(preset);
  const shape = LAYOUTS[kind];
  if (!size || !shape) return [];
  const { cols, rows } = shape;
  const totalW = cols * size.width + (cols - 1) * gap;
  const totalH = rows * size.height + (rows - 1) * gap;
  const x0 = centre.x - totalW / 2;
  const y0 = centre.y - totalH / 2;
  const out = [];
  for (let i = 0; i < cols * rows; i++) {
    out.push({ x: x0 + (i % cols) * (size.width + gap), y: y0 + Math.floor(i / cols) * (size.height + gap), width: size.width, height: size.height });
  }
  return out;
}

export function bumped(el, patch) {
  return { ...el, ...patch, version: (el.version || 0) + 1, versionNonce: rnd(), updated: Date.now() };
}

// Orders for `count` new frames (A6). When some live frame has no order, every live frame is numbered 1..n in its
// current orderFrames order and the new ones continue after it; otherwise the new ones continue after the maximum.
// Returns { rewrite: Map(id -> order), orders: number[] }.
export function planOrders(elements, count) {
  const frames = orderFrames(elements);
  const rewrite = new Map();
  let next;
  if (frames.some((f) => orderOf(f) === null)) {
    frames.forEach((f, i) => rewrite.set(f.id, i + 1));
    next = frames.length + 1;
  } else {
    next = frames.reduce((m, f) => Math.max(m, orderOf(f)), 0) + 1;
  }
  return { rewrite, orders: Array.from({ length: count }, (_, i) => next + i) };
}

export function withOrder(el, order) {
  return bumped(el, { customData: mergePlexusData(el.customData, { order }) });
}

// Applies a planOrders rewrite to a scene array; other elements pass through untouched.
export function applyOrderRewrite(elements, rewrite) {
  if (!rewrite.size) return elements;
  return elements.map((el) => (el && rewrite.has(el.id) && orderOf(el) !== rewrite.get(el.id) ? withOrder(el, rewrite.get(el.id)) : el));
}

// A frame resized about its centre to a preset.
export function reformatRect(frame, preset) {
  const size = presetSize(preset);
  if (!size) return null;
  const cx = (Number(frame.x) || 0) + (Number(frame.width) || 0) / 2;
  const cy = (Number(frame.y) || 0) + (Number(frame.height) || 0) / 2;
  return { x: cx - size.width / 2, y: cy - size.height / 2, width: size.width, height: size.height };
}

const intersects = (b, r) => b[0] < r.x + r.width && b[2] > r.x && b[1] < r.y + r.height && b[3] > r.y;

// Live children of the frame that no longer touch `rect`.
export function childrenOutside(elements, frame, rect) {
  return liveElements(elements).filter((el) => el.frameId === frame.id && !intersects(elementBounds(el), rect));
}

// The single selected frame, or the one frame all selected elements belong to, else null.
export function selectedFrameOf(elements, ids) {
  const live = new Map(liveElements(elements).map((el) => [el.id, el]));
  const picked = (ids || []).map((id) => live.get(id)).filter(Boolean);
  if (!picked.length) return null;
  const frames = picked.filter(isFrameLike);
  if (frames.length === 1 && picked.length === 1) return frames[0].id;
  if (frames.length === 1 && picked.every((el) => el === frames[0] || el.frameId === frames[0].id)) return frames[0].id;
  if (frames.length) return null;
  const owners = new Set(picked.map((el) => el.frameId ?? null));
  if (owners.size !== 1) return null;
  const owner = [...owners][0];
  return owner && live.get(owner) && isFrameLike(live.get(owner)) ? owner : null;
}

// Frame containing the scene point (smallest area first), else null.
export function frameAt(frames, point) {
  let best = null;
  for (const f of frames) {
    const x = Number(f.x) || 0, y = Number(f.y) || 0, w = Number(f.width) || 0, h = Number(f.height) || 0;
    if (point.x < x || point.x > x + w || point.y < y || point.y > y + h) continue;
    if (!best || w * h < best.area) best = { f, area: w * h };
  }
  return best?.f ?? null;
}

// Frame nearest a point by distance to its box (0 inside); ties go to the smaller area.
export function nearestFrame(frames, point) {
  let best = null;
  for (const f of frames) {
    const x = Number(f.x) || 0, y = Number(f.y) || 0, w = Number(f.width) || 0, h = Number(f.height) || 0;
    const dx = Math.max(x - point.x, 0, point.x - (x + w));
    const dy = Math.max(y - point.y, 0, point.y - (y + h));
    const d = Math.hypot(dx, dy);
    const area = w * h;
    if (!best || d < best.d || (d === best.d && area < best.area)) best = { f, d, area };
  }
  return best?.f ?? null;
}
