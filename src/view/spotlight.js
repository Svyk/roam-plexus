export function showSpotlight({ rect, doc, durationMs = 1400, motion = true }) {
  const el = doc.createElement("div");
  el.className = `plexus-portal plexus-spotlight ${motion ? "plexus-spotlight--pulse" : "plexus-spotlight--static"}`;
  el.style.left = `${rect.left}px`;
  el.style.top = `${rect.top}px`;
  el.style.width = `${rect.width}px`;
  el.style.height = `${rect.height}px`;
  doc.body.append(el);

  const events = ["wheel", "pointerdown", "keydown"];
  let done = false;
  let timer = null;
  const remove = () => {
    if (done) return;
    done = true;
    if (timer != null) clearTimeout(timer);
    for (const type of events) doc.removeEventListener(type, remove, { capture: true });
    el.remove();
  };
  for (const type of events) doc.addEventListener(type, remove, { capture: true, passive: true });
  timer = setTimeout(remove, durationMs);
  return remove;
}

function selectedList(selectedIds) {
  if (Array.isArray(selectedIds)) return selectedIds;
  if (selectedIds instanceof Set) return [...selectedIds];
  if (selectedIds && typeof selectedIds === "object") return Object.keys(selectedIds).filter((id) => selectedIds[id]);
  return [];
}

function indexElements(elements) {
  const byId = new Map();
  if (!Array.isArray(elements)) return byId;
  for (const el of elements) {
    if (el && typeof el.id === "string" && !byId.has(el.id)) byId.set(el.id, el);
  }
  return byId;
}

function isLive(el) {
  return !!el && typeof el.id === "string" && el.isDeleted !== true;
}

function bindingIds(el) {
  const out = [];
  const start = el.startBinding && typeof el.startBinding.elementId === "string" ? el.startBinding.elementId : "";
  const end = el.endBinding && typeof el.endBinding.elementId === "string" ? el.endBinding.elementId : "";
  if (start) out.push(start);
  if (end && end !== start) out.push(end);
  return out;
}

function hopTargets(el, byId) {
  const out = [];
  const pushArrow = (arrow) => {
    if (!isLive(arrow) || arrow.type !== "arrow") return;
    out.push(arrow.id, ...bindingIds(arrow));
  };
  if (el.type === "arrow") pushArrow(el);
  const bound = Array.isArray(el.boundElements) ? el.boundElements : [];
  for (const entry of bound) {
    if (!entry || entry.type !== "arrow" || typeof entry.id !== "string") continue;
    pushArrow(byId.get(entry.id));
  }
  return out;
}

function appendBoundText(kept, seen, byId) {
  const hopCount = kept.length;
  for (let i = 0; i < hopCount; i++) {
    const el = byId.get(kept[i]);
    const bound = el && Array.isArray(el.boundElements) ? el.boundElements : [];
    for (const entry of bound) {
      if (!entry || entry.type !== "text" || typeof entry.id !== "string" || seen.has(entry.id)) continue;
      const text = byId.get(entry.id);
      if (!isLive(text)) continue;
      seen.add(text.id);
      kept.push(text.id);
    }
  }
}

export function focusKeptIds(elements, selectedIds, depth) {
  const byId = indexElements(elements);
  const max = depth === "all" ? Infinity : Number.isFinite(depth) ? depth : 0;
  const kept = [];
  const seen = new Set();
  const queue = [];
  const enqueue = (id, dist) => {
    if (typeof id !== "string" || seen.has(id)) return;
    if (!isLive(byId.get(id))) return;
    seen.add(id);
    kept.push(id);
    queue.push(dist);
  };
  for (const id of selectedList(selectedIds)) enqueue(id, 0);
  for (let i = 0; i < queue.length; i++) {
    if (queue[i] >= max) continue;
    const el = byId.get(kept[i]);
    if (!el) continue;
    for (const id of hopTargets(el, byId)) enqueue(id, queue[i] + 1);
  }
  appendBoundText(kept, seen, byId);
  return kept;
}

const TODO_MACRO = "{{[[TODO]]}}";

function elementString(el, textOf) {
  if (typeof textOf === "function") {
    const supplied = textOf(el);
    if (typeof supplied === "string") return supplied;
  }
  return typeof el.text === "string" ? el.text : "";
}

export function todoKeptIds(elements, textOf) {
  const byId = indexElements(elements);
  const kept = [];
  const seen = new Set();
  for (const el of Array.isArray(elements) ? elements : []) {
    if (!isLive(el) || seen.has(el.id)) continue;
    if (!elementString(el, textOf).includes(TODO_MACRO)) continue;
    seen.add(el.id);
    kept.push(el.id);
  }
  appendBoundText(kept, seen, byId);
  return kept;
}

function finiteRect(raw) {
  if (!raw || typeof raw !== "object") return null;
  const x = Number(raw.left ?? raw.x);
  const y = Number(raw.top ?? raw.y);
  const w = Number(raw.width);
  const h = Number(raw.height);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function near(a, b) {
  return Math.abs(a - b) < 1e-6;
}

function gridUnion(rects) {
  const xs = [...new Set(rects.flatMap((r) => [r.x, r.x + r.w]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((r) => [r.y, r.y + r.h]))].sort((a, b) => a - b);
  const rows = [];
  for (let j = 0; j < ys.length - 1; j++) {
    const y = ys[j];
    const h = ys[j + 1] - y;
    if (!(h > 0)) continue;
    const row = [];
    let run = null;
    for (let i = 0; i < xs.length - 1; i++) {
      const x = xs[i];
      const w = xs[i + 1] - x;
      if (!(w > 0)) continue;
      const cx = x + w / 2;
      const cy = y + h / 2;
      const hit = rects.some((r) => cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h);
      if (!hit) {
        if (run) row.push(run);
        run = null;
        continue;
      }
      if (run) run.w += w;
      else run = { x, y, w, h };
    }
    if (run) row.push(run);
    if (row.length) rows.push(row);
  }
  const out = [];
  let prev = [];
  for (const row of rows) {
    const next = [];
    const used = new Array(row.length).fill(false);
    for (const seg of prev) {
      let merged = false;
      for (let i = 0; i < row.length; i++) {
        const r = row[i];
        if (used[i] || !near(r.x, seg.x) || !near(r.w, seg.w) || !near(r.y, seg.y + seg.h)) continue;
        used[i] = true;
        next.push({ x: seg.x, y: seg.y, w: seg.w, h: seg.h + r.h });
        merged = true;
        break;
      }
      if (!merged) out.push(seg);
    }
    for (let i = 0; i < row.length; i++) if (!used[i]) next.push({ x: row[i].x, y: row[i].y, w: row[i].w, h: row[i].h });
    prev = next;
  }
  out.push(...prev);
  return out;
}

function unionRects(rects) {
  if (rects.length <= 1) return rects;
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (rectsOverlap(rects[i], rects[j])) return gridUnion(rects);
    }
  }
  return rects;
}

function veilClip(holes) {
  const raw = Array.isArray(holes) ? holes : [];
  const rects = unionRects(raw.map(finiteRect).filter(Boolean));
  const pts = ["0% 0%", "100% 0%", "100% 100%", "0% 100%", "0% 0%"];
  for (const r of rects) {
    const x2 = r.x + r.w;
    const y2 = r.y + r.h;
    pts.push(`${r.x}px ${r.y}px`, `${x2}px ${r.y}px`, `${x2}px ${y2}px`, `${r.x}px ${y2}px`, `${r.x}px ${r.y}px`, "0% 0%");
  }
  return `polygon(evenodd, ${pts.join(", ")})`;
}

export function showFocusVeil({ doc, getHoles, subscribe }) {
  const el = doc.createElement("div");
  el.className = "plexus-portal plexus-focus-veil";
  el.style.position = "fixed";
  el.style.left = "0";
  el.style.top = "0";
  el.style.right = "0";
  el.style.bottom = "0";
  el.style.zIndex = "100000";
  el.style.pointerEvents = "none";
  el.style.background = "rgba(0, 0, 0, 0.45)";
  const place = () => {
    el.style.clipPath = veilClip(typeof getHoles === "function" ? getHoles() : []);
  };
  let done = false;
  let unsub = () => {};
  const onKey = (ev) => {
    if (ev && ev.key === "Escape") remove();
  };
  const remove = () => {
    if (done) return;
    done = true;
    doc.removeEventListener("keydown", onKey, { capture: true });
    unsub();
    unsub = () => {};
    el.remove();
  };
  place();
  const off = typeof subscribe === "function" ? subscribe(place) : null;
  if (typeof off === "function") unsub = off;
  doc.addEventListener("keydown", onKey, { capture: true });
  doc.body.append(el);
  return remove;
}

export function showTodoVeil({ doc, elements, textOf, rectOf, subscribe }) {
  const getHoles = () => {
    const holes = [];
    for (const id of todoKeptIds(elements, textOf)) {
      const rect = typeof rectOf === "function" ? rectOf(id) : null;
      if (rect) holes.push(rect);
    }
    return holes;
  };
  return showFocusVeil({ doc, getHoles, subscribe });
}
