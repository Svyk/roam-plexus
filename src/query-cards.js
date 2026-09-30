import { makeEmbedAnchor, parseEmbedRef } from "./model/embeds.js";
import { liveElements } from "./model/scene.js";

const CAP = 50;
const COLS = 4;
const CARD_W = 360;
const CARD_H = 200;
const GAP = 40;

function resultUid(row) {
  const uid = row?.[":block/uid"];
  return typeof uid === "string" && uid ? uid : null;
}

function resultRows(payload) {
  if (Array.isArray(payload)) return payload;
  const results = payload?.results;
  return Array.isArray(results) ? results : [];
}

function childUid(row) {
  if (!row || typeof row !== "object") return null;
  const uid = row[":block/uid"] ?? row.uid;
  return typeof uid === "string" && uid ? uid : null;
}

function embedUid(el) {
  const parsed = parseEmbedRef(el?.customData?.plexus?.embed);
  return parsed?.kind === "block" ? parsed.uid : null;
}

function takenUids(existing) {
  const taken = new Set();
  for (const el of liveElements(existing)) {
    const uid = embedUid(el);
    if (uid) taken.add(uid);
  }
  return taken;
}

function sourceCount(existing, sourceUid) {
  let n = 0;
  for (const el of liveElements(existing)) {
    if (el.customData?.plexus?.query === sourceUid) n++;
  }
  return n;
}

function layCards(uids, sourceUid, origin) {
  const x0 = Number.isFinite(origin?.x) ? origin.x : 0;
  const y0 = Number.isFinite(origin?.y) ? origin.y : 0;
  const out = [];
  for (let i = 0; i < uids.length; i++) {
    const [rect, text] = makeEmbedAnchor({
      ref: `((${uids[i]}))`,
      x: x0 + (i % COLS) * (CARD_W + GAP),
      y: y0 + Math.floor(i / COLS) * (CARD_H + GAP),
      width: CARD_W,
      height: CARD_H,
    });
    rect.customData.plexus.query = sourceUid;
    out.push(rect, text);
  }
  return out;
}

function cardsFromRows(rows, readUid, sourceUid, existing, origin) {
  const taken = takenUids(existing);
  const room = Math.max(0, CAP - sourceCount(existing, sourceUid));
  const picked = [];
  const list = Array.isArray(rows) ? rows : [];
  for (const row of list) {
    if (picked.length >= room) break;
    const uid = readUid(row);
    if (!uid || taken.has(uid)) continue;
    taken.add(uid);
    picked.push(uid);
  }
  return layCards(picked, sourceUid, origin);
}

export async function cardsFromQuery({ api, sourceUid, existing, origin } = {}) {
  let payload;
  try {
    payload = await api.data.roamQuery({ uid: sourceUid, limit: CAP });
  } catch {
    return [];
  }
  return cardsFromRows(resultRows(payload), resultUid, sourceUid, existing, origin);
}

export function cardsFromChildren({ children, sourceUid, existing, origin } = {}) {
  return cardsFromRows(children, childUid, sourceUid, existing, origin);
}
