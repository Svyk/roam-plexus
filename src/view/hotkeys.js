export const HOTKEY_CODES = Object.freeze({
  KeyR: "region",
  KeyI: "image",
  KeyP: "present",
  KeyM: "mindmap",
  KeyE: "embed",
  KeyN: "note",
  KeyO: "dock",
});

const DEDUPE_MS = 300;

const isTextTarget = (el) => {
  if (!el) return false;
  const tag = String(el.tagName ?? "").toLowerCase();
  return tag === "input" || tag === "textarea" || el.isContentEditable === true;
};

// runOnce(id): one hotkey callback per 300 ms, and nothing while text is being typed in a mounted editor.
export function createHotkeyRunner({ handlers, getApp = () => null, doc = () => globalThis.document, now = () => Date.now(), dedupeMs = DEDUPE_MS } = {}) {
  const lastAt = new Map();
  return function runOnce(id) {
    try {
      const t = now();
      const prev = lastAt.get(id);
      if (prev != null && t - prev < dedupeMs) return undefined;
      const app = getApp();
      if (app) {
        const d = typeof doc === "function" ? doc() : doc;
        const a = d?.activeElement;
        const guarded = isTextTarget(a) && !!a.closest?.(".excalidraw-outer-container, .plexus-portal, textarea.rm-block-input, .rm-block__input");
        if (app.state?.editingTextElement || guarded) return undefined;
      }
      lastAt.set(id, t);
      const handler = handlers?.[id];
      if (!handler) { console.warn("[plexus] unavailable outside Roam:", id); return undefined; }
      const out = handler();
      if (out && typeof out.catch === "function") return out.catch((error) => console.warn("[plexus] hotkey", id, "failed", error));
      return out;
    } catch (error) {
      console.warn("[plexus] hotkey", id, "failed", error);
      return undefined;
    }
  };
}

// Excalidraw's view-mode keyTest ignores Shift, so Alt+Shift+R would also fire its own action. Take the key first.
export function installHotkeyGuard({ containerEl, run, doc } = {}) {
  const target = doc?.addEventListener ? doc : containerEl;
  if (!containerEl?.addEventListener || !target?.addEventListener) return () => {};
  const onKey = (e) => {
    try {
      if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey || e.isComposing) return;
      const id = HOTKEY_CODES[e.code];
      if (!id) return;
      const t = e.target;
      const inside = t === containerEl || t === doc?.body || t === doc?.documentElement || (containerEl.contains?.(t) && !isTextTarget(t) && t?.dataset?.type !== "wysiwyg");
      if (!inside) return;
      e.preventDefault?.();
      e.stopImmediatePropagation?.();
      run(id);
    } catch (error) { console.warn("[plexus] hotkey guard failed", error); }
  };
  target.addEventListener("keydown", onKey, true);
  return () => target.removeEventListener("keydown", onKey, true);
}
