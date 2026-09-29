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
