import { parseEmbedRef } from "../model/embeds.js";
import { viewportToScene } from "../model/scene.js";

const PLAIN_WINDOW_MS = 100;

function within(node, root) {
  for (let n = node; n; n = n.parentNode ?? n.parentElement) if (n === root) return true;
  return false;
}

function isEditable(t) {
  if (!t) return false;
  const tag = String(t.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || t.isContentEditable === true;
}

// Only "((uid))" and "[[Title]]" on one line. Bare uids and the today token are refused: a pasted
// nine-letter word such as "Something" would otherwise match the uid pattern.
export function pastedRef(text) {
  const t = typeof text === "string" ? text.trim() : "";
  if (!t || t.includes("\n") || !(t.startsWith("((") || t.startsWith("[["))) return null;
  const parsed = parseEmbedRef(t);
  return parsed && (parsed.kind === "block" || parsed.kind === "page") ? parsed : null;
}

// Capture-phase paste on the mounted editor: a single ref on the canvas becomes an embed or a link node
// (the caller decides from the setting). Everything else passes through untouched.
export function installRefPaste({ doc, containerEl, app, getSettings, exists, onRef, now = () => Date.now() }) {
  let last = null;
  let plainAt = -Infinity;

  const onMove = (e) => { last = { x: e.clientX, y: e.clientY }; };
  // A ClipboardEvent has no shiftKey; Excalidraw's own plain-paste flag is a Ctrl/Cmd+V keydown with Shift.
  const onKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.code === "KeyV" || String(e.key).toLowerCase() === "v")) plainAt = now();
  };

  const onPaste = (e) => {
    try {
      let mode = "text";
      try { mode = getSettings?.()?.pasteRefs ?? "text"; } catch { mode = "text"; }
      if (mode === "text" || (mode !== "embed" && mode !== "link")) return;
      if (isEditable(e.target) || app?.state?.editingTextElement) return;
      if (now() - plainAt <= PLAIN_WINDOW_MS) return;
      if (!last) return;
      const under = doc.elementFromPoint?.(last.x, last.y);
      if (!under || String(under.tagName ?? "").toUpperCase() !== "CANVAS" || !within(under, containerEl)) return;
      const cd = e.clipboardData;
      if (!cd || cd.files?.length || [...(cd.types ?? [])].includes("Files")) return;
      const parsed = pastedRef(cd.getData?.("text/plain"));
      if (!parsed || !exists?.(parsed.ref)) return;
      e.preventDefault?.();
      e.stopPropagation?.();
      const st = app?.state ?? {};
      const scenePoint = viewportToScene({ x: last.x, y: last.y, appState: st });
      Promise.resolve(onRef({ kind: parsed.kind, ref: parsed.ref, scenePoint })).catch((error) => console.warn("[plexus] ref paste failed", error));
    } catch (error) {
      console.warn("[plexus] ref paste failed", error);
    }
  };

  containerEl.addEventListener("pointermove", onMove, { passive: true });
  containerEl.addEventListener("keydown", onKey, true);
  containerEl.addEventListener("paste", onPaste, true);
  return () => {
    containerEl.removeEventListener("pointermove", onMove, { passive: true });
    containerEl.removeEventListener("keydown", onKey, true);
    containerEl.removeEventListener("paste", onPaste, true);
  };
}
