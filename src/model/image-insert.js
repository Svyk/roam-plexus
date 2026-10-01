const IMAGE_RE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;

export function imageParts(string) {
  const match = IMAGE_RE.exec(String(string ?? "").trim());
  if (!match) return null;
  return { alt: match[1].trim(), url: match[2] };
}

export function filterInsertRows(rows, query) {
  const list = Array.isArray(rows) ? rows : [];
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return list.slice();
  return list.filter((row) => {
    const label = String(row?.label ?? "").toLowerCase();
    const kind = String(row?.kind ?? "").toLowerCase();
    return label.includes(q) || kind.includes(q);
  });
}

// Fit inside 480 by 360, or the natural pixel size when full is set. Never scales up.
export function fitSize(width, height, full = false) {
  const w = Math.max(1, Math.round(Number(width) || 1));
  const h = Math.max(1, Math.round(Number(height) || 1));
  if (full) return { width: w, height: h };
  const scale = Math.min(480 / w, 360 / h, 1);
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

// Drawing bounds for Shift+Enter, capped so a huge map does not fill the page.
export function cappedBounds(elements) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of elements || []) {
    if (!el || el.isDeleted) continue;
    const x = Number(el.x) || 0;
    const y = Number(el.y) || 0;
    const w = Number(el.width) || 0;
    const h = Number(el.height) || 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }
  if (!Number.isFinite(minX)) return null;
  return {
    width: Math.max(80, Math.min(1200, Math.round(maxX - minX))),
    height: Math.max(40, Math.min(900, Math.round(maxY - minY))),
  };
}

export function reuseFileId(uid) {
  const clean = String(uid ?? "").replace(/[^A-Za-z0-9]/g, "");
  if (!clean) return null;
  return `plx${clean.slice(0, 16)}`;
}

// Puts decrypted bytes on the open drawing's file map. Does not call addFiles.
export function stageReusedFile(app, { fileId, dataURL, mimeType = "image/png", created = Date.now() } = {}) {
  if (!app || !fileId || !dataURL) return false;
  if (!app.files || typeof app.files !== "object") app.files = {};
  app.files[fileId] = { id: fileId, mimeType, dataURL, created };
  return true;
}

export function placedImage({ elementId, fileId, url, link = null, x = 0, y = 0, width = 480, height = 360 } = {}) {
  if (!elementId || !fileId || !url) return null;
  return {
    id: elementId,
    type: "image",
    x, y, width, height,
    angle: 0,
    strokeColor: "transparent",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: Math.floor(Math.random() * 2147483647),
    version: 1,
    versionNonce: Math.floor(Math.random() * 2147483647),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: link || null,
    locked: false,
    status: "saved",
    scale: [1, 1],
    fileId,
    customData: { firebaseUrl: url },
  };
}
