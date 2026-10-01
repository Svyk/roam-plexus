import { thumbKey } from "../host/cache.js";

export const GALLERY_CAP = 40;
export const THUMB_MAX = 160;

export const DRAWING_GALLERY_QUERY = `[:find ?uid ?t ?page :where [?b :block/uid ?uid] [?b :block/string ?s] [(clojure.string/starts-with? ?s "{{[[excalidraw]]}}")] [?b :edit/time ?t] [?b :block/page ?p] [?p :node/title ?page]]`;

export function readDrawingRows(api) {
  const rows = api.q(DRAWING_GALLERY_QUERY) || [];
  return rows.map((row) => ({
    uid: String(row?.[0] ?? ""),
    editTime: Number(row?.[1]) || 0,
    pageTitle: row?.[2] == null ? "" : String(row[2]),
  }));
}

export function galleryRows(rows, limit = GALLERY_CAP) {
  const sorted = [...(rows || [])].sort((a, b) => {
    const dt = (Number(b?.editTime) || 0) - (Number(a?.editTime) || 0);
    if (dt !== 0) return dt;
    return String(a?.uid ?? "").localeCompare(String(b?.uid ?? ""));
  });
  const capped = sorted.slice(0, Math.max(0, limit));
  const titles = capped.map((row) => String(row?.pageTitle ?? "").trim());
  const counts = new Map();
  for (const title of titles) counts.set(title, (counts.get(title) || 0) + 1);
  const seen = new Map();
  return capped.map((row, i) => {
    const title = titles[i];
    const base = title || "Drawing";
    const n = (seen.get(title) || 0) + 1;
    seen.set(title, n);
    const label = counts.get(title) > 1 && n > 1 ? `${base} ${n}` : base;
    return { uid: String(row?.uid ?? ""), editTime: Number(row?.editTime) || 0, pageTitle: title, label };
  });
}

export function withHashes(rows, hashOf) {
  return (rows || []).map((row) => {
    let hash = "";
    try {
      hash = (typeof hashOf === "function" ? hashOf(row.uid) : "") || "";
    } catch {
      hash = "";
    }
    return { ...row, hash: String(hash) };
  });
}

export async function attachThumbs(rows, { lookup, maxWidth = THUMB_MAX } = {}) {
  const out = [];
  for (const row of rows || []) {
    if (!row?.hash) {
      out.push({ ...row, thumb: null });
      continue;
    }
    const key = thumbKey({ uid: row.uid, hash: row.hash, maxWidth });
    let hit = null;
    try {
      hit = await lookup?.(key);
    } catch {
      hit = null;
    }
    out.push({ ...row, thumb: hit?.url ?? null });
  }
  return out;
}
