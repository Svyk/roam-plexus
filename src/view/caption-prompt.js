const ISOLATED = ["keyup", "keypress", "beforeinput", "input", "paste", "copy", "cut"];
const BLUR_GRACE_MS = 200;
const MIN_WIDTH = 200;

let current = null;

// One-line caption input in the plexus-mm-input style; installSuggestAutoAttach attaches [[ / (( suggest to it on focus.
// Resolves the raw value (Enter, blur) or, for Esc, "" (escape: "empty") or null (escape: "cancel"). promise.cancel() resolves null.
// rect is the anchor in viewport px; the input sits just under it.
export function openCaptionPrompt({ doc, rect, initial = "", select = false, escape = "empty", zIndex = 100002, raf, now = () => Date.now() } = {}) {
  if (current) current.commit();
  let resolveOuter;
  const promise = new Promise((resolve) => { resolveOuter = resolve; });
  const handle = { el: null, done: false, openedAt: 0, listeners: [], frame: null, cancelFrame: null };
  const win = doc?.defaultView;
  const schedule = raf ?? win?.requestAnimationFrame?.bind(win) ?? ((fn) => setTimeout(fn, 0));
  const unschedule = win?.cancelAnimationFrame?.bind(win) ?? ((id) => clearTimeout(id));

  const finish = (value) => {
    if (handle.done) return;
    handle.done = true;
    if (handle.frame != null && !handle.el) {
      try { unschedule(handle.frame); } catch { /* ignore */ }
    }
    const el = handle.el;
    if (el) {
      for (const [type, fn] of handle.listeners.splice(0)) el.removeEventListener?.(type, fn);
      try { el.remove?.(); } catch (error) { console.warn("[plexus] caption prompt remove failed", error); }
    }
    if (current === handle) current = null;
    resolveOuter(value);
  };
  handle.commit = () => finish(handle.el ? String(handle.el.value ?? "") : String(initial ?? ""));
  promise.cancel = () => finish(null);

  const place = (el) => {
    const vw = win?.innerWidth;
    const vh = win?.innerHeight;
    const r = rect || { left: Number.isFinite(vw) ? Math.max(0, (vw - 480) / 2) : 0, top: 0, width: 0, height: 0 };
    const width = Math.min(Math.max(MIN_WIDTH, r.width || 0), 480, (Number.isFinite(vw) ? vw : Infinity) - 16);
    let left = Number.isFinite(r.left) ? r.left : 0;
    let top = (Number.isFinite(r.top) ? r.top : 0) + (r.height || 0) + 6;
    if (Number.isFinite(vw)) left = Math.max(8, Math.min(left, vw - width - 8));
    if (Number.isFinite(vh)) top = Math.max(8, Math.min(top, vh - 40));
    const s = el.style;
    s.left = `${left}px`;
    s.top = `${top}px`;
    s.width = `${width}px`;
    s.height = "30px";
    s.zIndex = String(zIndex);
  };

  const open = () => {
    handle.frame = null;
    if (handle.done) return;
    try {
      const el = doc.createElement("input");
      el.type = "text";
      el.className = "plexus-portal plexus-mm-input plexus-caption-prompt";
      el.value = String(initial ?? "");
      handle.el = el;
      const on = (type, fn) => { el.addEventListener(type, fn); handle.listeners.push([type, fn]); };
      on("keydown", (e) => {
        e.stopPropagation();
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === "Enter") { e.preventDefault(); handle.commit(); }
        else if (e.key === "Escape") { e.preventDefault(); finish(escape === "cancel" ? null : ""); }
      });
      for (const type of ISOLATED) on(type, (e) => e.stopPropagation());
      on("blur", (e) => {
        if (handle.done) return;
        if (e?.relatedTarget?.closest?.(".plexus-suggest")) return;
        if (now() - handle.openedAt < BLUR_GRACE_MS) {
          // Roam's menu close or the tool's trailing click took focus; keep the prompt alive.
          try { el.focus?.(); } catch { /* ignore */ }
          return;
        }
        handle.commit();
      });
      place(el);
      doc.body.append(el);
      handle.openedAt = now();
      el.focus?.();
      if (select) el.select?.();
      else if (typeof el.setSelectionRange === "function") {
        const n = el.value.length;
        el.setSelectionRange(n, n);
      }
    } catch (error) {
      console.warn("[plexus] caption prompt failed", error);
      finish(null);
    }
  };

  current = handle;
  handle.frame = schedule(open);
  return promise;
}
