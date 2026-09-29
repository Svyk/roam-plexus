import { normalizeFrac, normalizePoly } from "./region.js";
import { fnv1a } from "./hash.js";

export { normalizePoly };

const blank = (m) => " ".repeat(m.length);

// `![alt](url)` in order; images inside fenced blocks or inline code spans do not count.
export function parseImageRefs(blockString) {
  if (typeof blockString !== "string") return [];
  const masked = blockString
    .replace(/```[\s\S]*?(?:```|$)/g, blank)
    .replace(/(`+)[\s\S]*?\1/g, blank);
  const out = [];
  const re = /!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
  let m;
  while ((m = re.exec(masked))) out.push({ alt: m[1], url: m[2], index: out.length });
  return out;
}

export function imageCropRect({ naturalWidth, naturalHeight, f }) {
  const frac = normalizeFrac(f);
  if (!frac || !(naturalWidth > 0) || !(naturalHeight > 0)) return null;
  const [rx, ry, rw, rh] = frac;
  const x1 = Math.min(naturalWidth - 1, Math.max(0, Math.round(rx * naturalWidth)));
  const y1 = Math.min(naturalHeight - 1, Math.max(0, Math.round(ry * naturalHeight)));
  const x2 = Math.min(naturalWidth, Math.max(x1 + 1, Math.round((rx + rw) * naturalWidth)));
  const y2 = Math.min(naturalHeight, Math.max(y1 + 1, Math.round((ry + rh) * naturalHeight)));
  return { sx: x1, sy: y1, sw: x2 - x1, sh: y2 - y1 };
}

// Bounding box of a polygon as a fraction rect [rx, ry, rw, rh] (same shape as `f`); null if invalid or degenerate.
export function polyBBox(p) {
  const poly = normalizePoly(p);
  if (!poly) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (let i = 0; i < poly.length; i += 2) {
    x1 = Math.min(x1, poly[i]); x2 = Math.max(x2, poly[i]);
    y1 = Math.min(y1, poly[i + 1]); y2 = Math.max(y2, poly[i + 1]);
  }
  return normalizeFrac([x1, y1, x2 - x1, y2 - y1]);
}

// Sutherland-Hodgman clip of a flat polygon (unclamped fractions) to the unit box.
// Returns the clipped flat polygon, or null when fewer than 3 vertices or ~zero area remain.
export function clipPolyToUnit(flat) {
  let pts = [];
  for (let i = 0; i + 1 < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
  const edges = [
    [(q) => q[0], 0, true],
    [(q) => q[0], 1, false],
    [(q) => q[1], 0, true],
    [(q) => q[1], 1, false],
  ];
  for (const [get, lim, keepAbove] of edges) {
    const inside = (q) => (keepAbove ? get(q) >= lim : get(q) <= lim);
    const next = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const ia = inside(a);
      const ib = inside(b);
      if (ia !== ib) {
        const t = (lim - get(a)) / (get(b) - get(a));
        next.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      }
      if (ib) next.push(b);
    }
    pts = next;
    if (!pts.length) return null;
  }
  if (pts.length < 3) return null;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  if (Math.abs(area) / 2 < 1e-9) return null;
  return pts.flat();
}

function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0];
  const [bx, by] = pts[pts.length - 1];
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  let idx = -1, max = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = len > 0 ? Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len : Math.hypot(pts[i][0] - ax, pts[i][1] - ay);
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [pts[0], pts[pts.length - 1]];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}

// Ramer-Douglas-Peucker on a closed polygon in fraction space; at least 3 points, at most maxPoints.
export function simplifyPoly(p, epsilon = 0.003, maxPoints = 48) {
  const poly = normalizePoly(p);
  if (!poly) return null;
  const pts = [];
  for (let i = 0; i < poly.length; i += 2) pts.push([poly[i], poly[i + 1]]);
  if (pts.length <= 3) return poly;
  // Split the ring at point 0 and the point farthest from it so each chain has distinct endpoints.
  let far = 1, best = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > best) { best = d; far = i; }
  }
  const chainA = pts.slice(0, far + 1);
  const chainB = [...pts.slice(far), pts[0]];
  let eps = epsilon;
  let result = pts;
  for (let guard = 0; guard < 60; guard++) {
    const a = rdp(chainA, eps);
    const b = rdp(chainB, eps);
    const ring = [...a.slice(0, -1), ...b.slice(0, -1)];
    if (ring.length < 3) break;
    result = ring;
    if (ring.length <= maxPoints) break;
    eps *= 1.3;
  }
  if (result.length > maxPoints) {
    const step = result.length / maxPoints;
    result = Array.from({ length: maxPoints }, (_, i) => result[Math.floor(i * step)]);
  }
  return result.flat().map((n) => Math.round(n * 1000) / 1000);
}

// Polygon points as 0..1 fractions of the bbox (flat array). null if invalid.
export function polyToLocal(p, bboxFrac) {
  const poly = normalizePoly(p);
  const bb = normalizeFrac(bboxFrac);
  if (!poly || !bb) return null;
  const out = [];
  for (let i = 0; i < poly.length; i += 2) {
    out.push(Math.round(((poly[i] - bb[0]) / bb[2]) * 1e6) / 1e6, Math.round(((poly[i + 1] - bb[1]) / bb[3]) * 1e6) / 1e6);
  }
  return out;
}

const num = (n) => String(Math.round(n * 1000) / 1000);

// Pure string op: adds <defs><clipPath id="plexus-clip-<hash>"> and wraps the root content in a clipped <g>.
// localPoints are fractions of the SVG's own viewBox (or width/height when there is no viewBox).
export function clipSvgToPolygon(svgString, localPoints) {
  const pts = normalizePoly(localPoints);
  if (!pts) throw new TypeError("clipSvgToPolygon: bad polygon");
  const open = /<svg\b[^>]*>/.exec(svgString);
  const closeIdx = svgString.lastIndexOf("</svg>");
  if (!open || closeIdx < open.index + open[0].length) throw new TypeError("clipSvgToPolygon: no <svg> root");
  const tag = open[0];
  const vb = /\sviewBox\s*=\s*["']\s*(-?[\d.eE+-]+)[\s,]+(-?[\d.eE+-]+)[\s,]+([\d.eE+-]+)[\s,]+([\d.eE+-]+)\s*["']/.exec(tag);
  let minX = 0, minY = 0, w, h;
  if (vb) [minX, minY, w, h] = vb.slice(1).map(Number);
  else {
    w = Number(/\swidth\s*=\s*["']([\d.]+)/.exec(tag)?.[1]);
    h = Number(/\sheight\s*=\s*["']([\d.]+)/.exec(tag)?.[1]);
  }
  if (!(w > 0) || !(h > 0)) throw new TypeError("clipSvgToPolygon: no size");
  const coords = [];
  for (let i = 0; i < pts.length; i += 2) coords.push(`${num(minX + pts[i] * w)},${num(minY + pts[i + 1] * h)}`);
  const attr = coords.join(" ");
  const id = `plexus-clip-${fnv1a(attr)}`;
  const head = svgString.slice(0, open.index + tag.length);
  const body = svgString.slice(open.index + tag.length, closeIdx);
  return `${head}<defs><clipPath id="${id}"><polygon points="${attr}"/></clipPath></defs><g clip-path="url(#${id})">${body}</g>${svgString.slice(closeIdx)}`;
}

// Scale down to maxWidth (never up); integer size, at least 1.
export function thumbnailSize({ width, height, maxWidth }) {
  if (!(width > 0) || !(height > 0)) return { width: 1, height: 1 };
  const scale = maxWidth > 0 ? Math.min(1, maxWidth / width) : 1;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
