const ACTION_MS = 10000;
const MAX_DRAWINGS = 10;

const nonce = () => Math.floor(Math.random() * 2 ** 31);
const liveCount = (els) => (els || []).reduce((n, e) => n + (e && !e.isDeleted ? 1 : 0), 0);
const versionSum = (els) => (els || []).reduce((n, e) => n + (e?.version || 0), 0);
export const signature = (els) => `${liveCount(els)}|${versionSum(els)}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// A write with no protection, for callers that run without a guard (tests, or before the extension wires one).
export const directGuard = Object.freeze({
  guardedWrite(app, { next, captureUpdate, appState } = {}) {
    const elements = typeof next === "function" ? next(app.getSceneElementsIncludingDeleted?.() ?? []) : next;
    app.updateScene({ elements, ...(appState ? { appState } : {}), ...(captureUpdate !== undefined ? { captureUpdate } : {}) });
    return true;
  },
  restoreLast: () => 0,
  restoreTo: () => 0,
  list: () => [],
  hasSnapshot: () => false,
  dispose() {},
});

// Shrink guard plus a per-drawing ring of pre-write deltas for Plexus-initiated scene writes.
// isActive(app, drawingUid) says whether app is still the open editor of that drawing; the default only
// checks that the Excalidraw App has not unmounted.
export function createWriteGuard({ toaster, ringSize = 5, maxDrawings = MAX_DRAWINGS, isActive = (app) => !!app && app.unmounted !== true, now = () => Date.now() } = {}) {
  let disposed = false;
  const rings = new Map();
  let pending = null;

  const toast = (message, opts) => {
    try { toaster?.show?.(message, opts); } catch (error) { console.warn("[plexus] guard toast failed", error); }
  };

  const dropPending = (token) => {
    if (!token || pending === token) pending = null;
  };

  let nextId = 1;
  function push(drawingUid, entry) {
    const ring = rings.get(drawingUid) ?? [];
    ring.push({ ...entry, id: nextId++ });
    while (ring.length > ringSize) ring.shift();
    rings.delete(drawingUid);
    rings.set(drawingUid, ring);
    while (rings.size > maxDrawings) rings.delete(rings.keys().next().value);
  }

  // Delta of a write: clones of the elements it removes or changes, plus the ids it creates.
  function deltaOf(current, nextEls) {
    const nextById = new Map(nextEls.map((e) => [e?.id, e]));
    const curIds = new Set();
    const before = [];
    let removed = 0;
    for (const el of current) {
      if (!el) continue;
      curIds.add(el.id);
      if (el.isDeleted) continue;
      const nx = nextById.get(el.id);
      const gone = !nx || nx.isDeleted;
      if (gone) removed += 1;
      if (gone || (nx !== el && nx.version !== el.version)) before.push(structuredClone(el));
    }
    const added = nextEls.filter((e) => e && !curIds.has(e.id)).map((e) => e.id);
    return { removed, before, added };
  }

  function guardedWrite(app, opts = {}) {
    if (disposed || !app) return false;
    const { drawingUid, next, label = "Change", captureUpdate, appState, force = false } = opts;
    const current = app.getSceneElementsIncludingDeleted?.() ?? [];
    const nextEls = typeof next === "function" ? next(current) : next;
    if (!Array.isArray(nextEls)) return false;
    const before = liveCount(current);
    const after = liveCount(nextEls);
    if (!force && before > 10 && after * 5 <= before) {
      refuse(app, opts, before - after, before, current);
      return false;
    }
    const delta = captureUpdate !== "NEVER" ? deltaOf(current, nextEls) : null;
    app.updateScene({ elements: nextEls, ...(appState ? { appState } : {}), ...(captureUpdate !== undefined ? { captureUpdate } : {}) });
    if (delta && delta.removed > 0 && drawingUid) push(drawingUid, { drawingUid, time: now(), label, before: delta.before, added: delta.added });
    return true;
  }

  function refuse(app, opts, n, m, current) {
    const { drawingUid, next, label = "Change", captureUpdate, appState, onApplyAnyway } = opts;
    const key = `${drawingUid}|${label}|${n}|${m}`;
    if (pending && pending.key === key && now() < pending.until) return;
    const token = { key, until: now() + ACTION_MS };
    const sig = signature(current);
    const run = () => {
      dropPending(token);
      if (disposed) return;
      if (!isActive(app, drawingUid)) {
        toast("Drawing is no longer open");
        return;
      }
      try {
        if (typeof onApplyAnyway === "function") {
          onApplyAnyway();
        } else if (typeof next === "function") {
          guardedWrite(app, { ...opts, force: true });
        } else if (signature(app.getSceneElementsIncludingDeleted?.() ?? []) === sig) {
          guardedWrite(app, { drawingUid, next, label, captureUpdate, appState, force: true });
        } else {
          toast("The drawing changed; run it again");
        }
      } catch (error) {
        console.warn("[plexus] apply anyway failed", error);
        toast("Could not apply the change", { kind: "error" });
      }
    };
    pending = token;
    toast(`Not applied: would remove ${n} of ${m}`, { kind: "error", action: { label: "Apply anyway", run }, onHide: () => dropPending(token) });
  }

  // Entries newest first; index 0 is what restoreLast undoes.
  function list(drawingUid) {
    const ring = rings.get(drawingUid) ?? [];
    return ring.map((entry, i) => ({ id: entry.id, index: ring.length - 1 - i, label: entry.label, time: entry.time, count: entry.before.length })).reverse();
  }

  // Undo entries 0..index (newest to oldest) in one write. Where entries overlap the older "before" wins, and every
  // element any of them added is deleted again.
  function restoreTo(app, drawingUid, index = 0) {
    if (disposed) return 0;
    if (!app || !isActive(app, drawingUid)) {
      toast("Drawing is no longer open");
      return 0;
    }
    const ring = rings.get(drawingUid);
    let at = Number.isInteger(index) && index >= 0 ? index : 0;
    if (index && typeof index === "object") {
      const found = ring ? ring.findIndex((e) => e.id === index.id) : -1;
      if (found === -1) {
        toast("The list changed; reopen it");
        return 0;
      }
      at = ring.length - 1 - found;
    }
    const entries = ring && ring.length > at ? ring.slice(ring.length - 1 - at).reverse() : [];
    if (!entries.length) {
      toast("Nothing to restore");
      return 0;
    }
    const before = new Map();
    const added = new Set();
    for (const entry of entries) {
      for (const old of entry.before) before.set(old.id, old);
      for (const id of entry.added) added.add(id);
    }
    for (const id of added) before.delete(id);
    const current = app.getSceneElementsIncludingDeleted?.() ?? [];
    const byId = new Map(current.map((e) => [e?.id, e]));
    const stamp = Date.now();
    const elements = current.map((el) => {
      const old = before.get(el?.id);
      if (old) return { ...old, version: (el.version || 0) + 1, versionNonce: nonce(), updated: stamp };
      if (el && added.has(el.id) && !el.isDeleted) return { ...el, isDeleted: true, version: (el.version || 0) + 1, versionNonce: nonce(), updated: stamp };
      return el;
    });
    for (const old of before.values()) {
      if (!byId.has(old.id)) elements.push({ ...old, version: (old.version || 0) + 1, versionNonce: nonce(), updated: stamp });
    }
    try {
      app.updateScene({ elements, captureUpdate: "IMMEDIATELY" });
    } catch (error) {
      console.warn("[plexus] restore failed", error);
      toast("Could not restore the drawing", { kind: "error" });
      return 0;
    }
    const after = new Map((app.getSceneElementsIncludingDeleted?.() ?? []).map((e) => [e?.id, e]));
    if ([...before.values()].some((old) => after.get(old.id)?.isDeleted !== false)) {
      console.warn("[plexus] restore was not applied by the drawing", before.size);
      toast("Could not restore the drawing", { kind: "error" });
      return 0;
    }
    ring.splice(ring.length - 1 - at, at + 1);
    if (!ring.length) rings.delete(drawingUid);
    const n = before.size;
    toast(`Restored ${plural(n, "element")}; Undo reverses this`);
    return n;
  }

  const restoreLast = (app, drawingUid) => restoreTo(app, drawingUid, 0);

  return {
    guardedWrite,
    restoreLast,
    restoreTo,
    list,
    hasSnapshot: (drawingUid) => (rings.get(drawingUid)?.length ?? 0) > 0,
    dispose() {
      disposed = true;
      pending = null;
      rings.clear();
    },
  };
}
