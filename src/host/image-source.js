const BITMAP_MEMO_CAP = 16;
const memo = new Map();

// Accepts flat [x1,y1,x2,y2,...], [[x,y],...], or [{x,y},...]; returns [[x,y],...] or null.
export function polyPoints(poly) {
  if (!Array.isArray(poly) || !poly.length) return null;
  let pts;
  if (typeof poly[0] === "number") {
    pts = [];
    for (let i = 0; i + 1 < poly.length; i += 2) pts.push([poly[i], poly[i + 1]]);
  } else pts = poly.map((p) => (Array.isArray(p) ? [p[0], p[1]] : [p?.x, p?.y]));
  if (pts.length < 3 || pts.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return null;
  return pts;
}

// Draws src (cropped by rect) onto a new canvas of rect size; poly (fractions of the crop box) clips the result.
export function cropToBlob(src, { sx, sy, sw, sh }, { poly, doc = globalThis.document } = {}) {
  const out = doc.createElement("canvas");
  out.width = sw;
  out.height = sh;
  const ctx = out.getContext("2d");
  const pts = polyPoints(poly);
  if (pts) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * sw, y * sh) : ctx.moveTo(x * sw, y * sh)));
    ctx.closePath();
    ctx.clip();
  }
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
  return new Promise((resolve, reject) => {
    out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("[plexus] toBlob failed"))), "image/png");
  });
}

// file.get decrypts .enc on encrypted graphs, so every plain-image crop takes this one path.
export function loadImageBitmap(url, { api = globalThis.roamAlphaAPI, createBitmap = globalThis.createImageBitmap } = {}) {
  if (!url) return Promise.reject(new Error("[plexus] image url required"));
  const hit = memo.get(url);
  if (hit) {
    memo.delete(url);
    memo.set(url, hit);
    return hit;
  }
  const p = (async () => {
    const file = await api.file.get({ url });
    if (!file) throw new Error("[plexus] image not available");
    return createBitmap(file);
  })();
  memo.set(url, p);
  p.catch(() => { if (memo.get(url) === p) memo.delete(url); });
  while (memo.size > BITMAP_MEMO_CAP) memo.delete(memo.keys().next().value);
  return p;
}

export function clearImageMemo() { memo.clear(); }

export function cropBitmapToBlob(bitmap, rect, opts) {
  return cropToBlob(bitmap, rect, opts);
}
