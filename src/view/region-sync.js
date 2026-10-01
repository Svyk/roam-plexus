// GRAPH-11 installer. One plain text inside a region follows that region's caption, and the caption follows the text.
import { stepSync, syncRows } from "../model/region-sync.js";

const PATTERN = "[:block/uid :block/string]";

export function installRegionSync({ app, api, drawingUid, regionsOf, nameRegion, requestFrame = globalThis.requestAnimationFrame, cancelFrame = globalThis.cancelAnimationFrame } = {}) {
  if (!app || !drawingUid || typeof regionsOf !== "function" || typeof nameRegion !== "function") return () => {};
  const state = new Map();
  const watches = new Map();
  let frame = 0;
  let queued = false;
  let alive = true;

  const schedule = () => {
    if (!alive || queued) return;
    queued = true;
    const run = () => { queued = false; pass(); };
    if (requestFrame) frame = requestFrame(run);
    else run();
  };

  const watch = (uid) => {
    if (typeof api?.data?.addPullWatch !== "function") return () => {};
    const ident = `[:block/uid "${String(uid).replace(/["\\]/g, "")}"]`;
    const handler = () => schedule();
    try { api.data.addPullWatch(PATTERN, ident, handler); } catch { return () => {}; }
    let done = false;
    return () => {
      if (done) return;
      done = true;
      try { api.data.removePullWatch(PATTERN, ident, handler); } catch { /* already gone */ }
    };
  };

  const paint = (id, text) => {
    const elements = app.getSceneElementsIncludingDeleted?.() || [];
    let changed = false;
    const next = elements.map((el) => {
      if (!el || el.id !== id || el.isDeleted) return el;
      const current = el.originalText ?? el.text ?? "";
      if (current === text && el.text === text) return el;
      changed = true;
      return {
        ...el,
        text,
        originalText: text,
        version: (el.version || 0) + 1,
        versionNonce: Math.floor(Math.random() * 2147483646) + 1,
        updated: Date.now(),
      };
    });
    if (changed) app.updateScene?.({ elements: next, captureUpdate: "IMMEDIATELY" });
  };

  const pass = () => {
    frame = 0;
    if (!alive) return;
    const st = app.state || {};
    if (st.cursorButton === "down") return;
    const editingId = st.editingTextElement?.id ?? null;
    let regions = [];
    try { regions = regionsOf(drawingUid) || []; } catch { regions = []; }
    const elements = app.scene?.getNonDeletedElements?.() || [];
    const rows = syncRows({ regions, elements, appState: st });
    const live = new Set(rows.map((r) => r.regionUid));
    for (const [uid, off] of watches) {
      if (live.has(uid)) continue;
      try { off(); } catch { /* ignore */ }
      watches.delete(uid);
      state.delete(uid);
    }
    for (const row of rows) {
      if (!watches.has(row.regionUid)) watches.set(row.regionUid, watch(row.regionUid));
      const prev = state.get(row.regionUid) || null;
      const step = stepSync(prev, { ...row, editing: editingId === row.elementId });
      state.set(row.regionUid, step.next);
      if (step.action === "write") {
        const snap = { caption: String(row.caption ?? "").replace(/\s+/g, " ").trim(), text: String(row.text ?? "").replace(/\s+/g, " ").trim() };
        Promise.resolve(nameRegion(row.regionUid, step.caption)).then((ok) => {
          if (ok === false) state.set(row.regionUid, snap);
        }).catch(() => state.set(row.regionUid, snap));
      } else if (step.action === "paint") {
        try { paint(row.elementId, step.text); }
        catch { state.set(row.regionUid, prev); }
      }
    }
  };

  let offChange = null;
  try { offChange = app.onChangeEmitter?.on?.(() => schedule()); } catch { offChange = null; }
  schedule();
  return () => {
    alive = false;
    if (frame && cancelFrame) { try { cancelFrame(frame); } catch { /* ignore */ } }
    if (typeof offChange === "function") { try { offChange(); } catch { /* ignore */ } }
    for (const off of watches.values()) { try { off(); } catch { /* ignore */ } }
    watches.clear();
    state.clear();
  };
}
