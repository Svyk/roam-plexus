import { parseEmbedRef } from "../model/embeds.js";
import { viewportToScene } from "../model/scene.js";

const PLEXUS_MIME = "application/x-plexus-ref";
const PARENTS = "roam/block-uid-list-only-parents";
const BLOCKS = "roam/block-uid-list";
const URIS = "roam/roam-uri-list";
const CLAIM = [PARENTS, BLOCKS, PLEXUS_MIME];
const UID_RE = /^[\w-]{9}$/;
const CAP = 500;
const WATCHDOG_MS = 250;
const OFFSET = 12;
const LABELS = { embed: "Embed", link: "Link", label: "Label" };

// During dragover only `types` is readable (protected mode), so claiming goes by types alone.
export function claimableTypes(types) {
  let list;
  try { list = Array.from(types ?? []); } catch { return false; }
  return CLAIM.some((t) => list.includes(t));
}

export function dropMode(e) {
  return e?.shiftKey ? "label" : e?.altKey ? "link" : "embed";
}

const uidsOf = (text) => String(text ?? "").split(/[^A-Za-z0-9_-]+/).filter((s) => UID_RE.test(s));

function uriUids(text) {
  const out = [];
  for (const line of String(text ?? "").split(/[\r\n]+/)) {
    const m = /\/page\/([\w-]{9})\s*$/.exec(line.trim());
    if (m) out.push(m[1]);
  }
  return out;
}

// Reads every payload synchronously (a DataTransfer is only readable during the event), then resolves uids
// (a page uid becomes its title). Returns null when nothing usable was dropped, otherwise
// { items: [{kind, uid?, title?, ref}], excluded } where `excluded` counts uids removed by `exclude`.
export async function parseRoamDrop(dataTransfer, { resolve, exclude } = {}) {
  let candidates = [];
  try {
    const get = (t) => { try { return dataTransfer.getData(t) || ""; } catch { return ""; } };
    const plexus = parseEmbedRef(get(PLEXUS_MIME));
    if (plexus && (plexus.kind === "block" || plexus.kind === "page")) candidates = [plexus];
    if (!candidates.length) candidates = uidsOf(get(PARENTS)).map((uid) => ({ kind: "block", uid }));
    if (!candidates.length) candidates = uidsOf(get(BLOCKS)).map((uid) => ({ kind: "block", uid }));
    if (!candidates.length) candidates = uriUids(get(URIS)).map((uid) => ({ kind: "block", uid }));
  } catch (error) {
    console.warn("[plexus] drop parse failed", error);
    return null;
  }
  const skip = new Set([].concat(typeof exclude === "function" ? exclude() : exclude ?? []).filter(Boolean));
  const seen = new Set();
  const items = [];
  let excluded = 0;
  for (const c of candidates) {
    if (items.length >= CAP) break;
    let item = null;
    if (c.kind === "page") {
      item = { kind: "page", title: c.title, ref: c.ref };
    } else {
      if (skip.has(c.uid)) { excluded++; continue; }
      let info = null;
      try { info = await resolve?.(c.uid); } catch (error) { console.warn("[plexus] drop resolve failed", error); }
      if (!info) continue;
      item = info.kind === "page" && info.title
        ? { kind: "page", title: info.title, ref: `[[${info.title}]]` }
        : { kind: "block", uid: c.uid, ref: `((${c.uid}))` };
    }
    if (seen.has(item.ref)) continue;
    seen.add(item.ref);
    items.push(item);
  }
  if (!items.length && !excluded) return null;
  return { items, excluded };
}

function effectFor(allowed) {
  const a = String(allowed ?? "").toLowerCase();
  if (!a || a === "all" || a === "uninitialized" || a === "none") return "copy";
  for (const e of ["copy", "link", "move"]) if (a.includes(e)) return e;
  return "copy";
}

export function installRoamDrop({ doc, containerEl, app, zIndex = 1000, resolve, exclude, onDrop, toast, setTimeout: setT = globalThis.setTimeout.bind(globalThis), clearTimeout: clearT = globalThis.clearTimeout.bind(globalThis) }) {
  const win = doc.defaultView ?? null;
  let ghost = null;
  let timer = null;
  let disposed = false;

  const say = (message) => { try { toast?.(message); } catch { /* toast is best effort */ } };

  const hideGhost = () => {
    if (timer != null) clearT(timer);
    timer = null;
    ghost?.remove();
    ghost = null;
  };

  const showGhost = (e) => {
    if (!ghost) {
      ghost = doc.createElement("div");
      ghost.className = "plexus-portal plexus-drop-ghost";
      ghost.style.zIndex = String(Number(zIndex) + 3);
      doc.body.append(ghost);
    }
    ghost.textContent = LABELS[dropMode(e)];
    const w = ghost.offsetWidth || 64;
    const h = ghost.offsetHeight || 24;
    const maxX = (win?.innerWidth ?? Infinity) - w;
    const maxY = (win?.innerHeight ?? Infinity) - h;
    ghost.style.left = `${Math.max(0, Math.min(e.clientX + OFFSET, maxX))}px`;
    ghost.style.top = `${Math.max(0, Math.min(e.clientY + OFFSET, maxY))}px`;
    if (timer != null) clearT(timer);
    timer = setT(hideGhost, WATCHDOG_MS);
  };

  const claimed = (e) => claimableTypes(e?.dataTransfer?.types);

  const onOver = (e) => {
    try {
      if (disposed || !claimed(e)) return;
      e.preventDefault?.();
      e.stopImmediatePropagation?.();
      e.stopPropagation?.();
      try { e.dataTransfer.dropEffect = effectFor(e.dataTransfer.effectAllowed); } catch { /* read-only in some states */ }
      showGhost(e);
    } catch (error) {
      console.warn("[plexus] drag over failed", error);
    }
  };

  const onDropEvent = (e) => {
    try {
      if (disposed || !claimed(e)) return;
      e.preventDefault?.();
      e.stopImmediatePropagation?.();
      e.stopPropagation?.();
      hideGhost();
      const mode = dropMode(e);
      const rect = containerEl.getBoundingClientRect?.() ?? { left: 0, top: 0 };
      const point = { x: e.clientX, y: e.clientY };
      const appState = { ...(app?.state ?? {}), offsetLeft: rect.left, offsetTop: rect.top };
      const parsed = parseRoamDrop(e.dataTransfer, { resolve, exclude });
      Promise.resolve(parsed).then(async (result) => {
        if (disposed) return;
        if (!result) return say("Nothing to place");
        if (!result.items.length) return say("The drawing can't contain itself");
        const scenePoint = viewportToScene({ x: point.x, y: point.y, appState });
        await onDrop?.({ items: result.items, mode, scenePoint });
      }).catch((error) => console.warn("[plexus] drop failed", error));
    } catch (error) {
      console.warn("[plexus] drop failed", error);
    }
  };

  const docEnd = () => hideGhost();
  const onBlur = () => hideGhost();

  containerEl.addEventListener("dragenter", onOver, true);
  containerEl.addEventListener("dragover", onOver, true);
  containerEl.addEventListener("drop", onDropEvent, true);
  doc.addEventListener("dragend", docEnd, true);
  doc.addEventListener("drop", docEnd, true);
  win?.addEventListener("blur", onBlur);

  return () => {
    if (disposed) return;
    disposed = true;
    hideGhost();
    containerEl.removeEventListener("dragenter", onOver, true);
    containerEl.removeEventListener("dragover", onOver, true);
    containerEl.removeEventListener("drop", onDropEvent, true);
    doc.removeEventListener("dragend", docEnd, true);
    doc.removeEventListener("drop", docEnd, true);
    win?.removeEventListener("blur", onBlur);
  };
}
