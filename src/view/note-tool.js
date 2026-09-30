import { viewportToScene } from "../model/scene.js";

const DRAG_PX = 4;
const ARM_TIMEOUT_MS = 30000;
const ATTR = "data-plexus-note-armed";
const CLICK_EVENTS = ["pointerdown", "pointerup", "mousedown", "mouseup", "click"];

const swallow = (e) => { e.preventDefault?.(); e.stopImmediatePropagation?.(); };

// Arm-then-click tool for AUTH-3. The palette hotkey is the only key path (the caller invokes arm()); Esc disarms.
// While armed a plain primary click on the canvas places a note; nothing else is intercepted.
export function installNoteTool({ doc, containerEl, app, canArm = () => true, onPlace, setTimeout: setTimer = globalThis.setTimeout, clearTimeout: clearTimer = globalThis.clearTimeout }) {
  let armed = false;
  let timer = null;
  let down = null;

  const isCanvas = (t) => !!t && (typeof t.matches === "function"
    ? t.matches("canvas.excalidraw__canvas.interactive")
    : String(t.tagName ?? "").toUpperCase() === "CANVAS");
  const plain = (e) => (e.button ?? 0) === 0 && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;

  function disarm() {
    if (!armed) return;
    armed = false;
    down = null;
    if (timer != null) { clearTimer(timer); timer = null; }
    for (const t of CLICK_EVENTS) containerEl.removeEventListener(t, onPointer, true);
    doc.removeEventListener?.("keydown", onKey, true);
    doc.body?.removeAttribute?.(ATTR);
  }

  function onKey(e) {
    if (e.key !== "Escape" || e.isComposing) return;
    swallow(e);
    disarm();
  }

  function onPointer(e) {
    if (!armed) return;
    if (app?.state?.editingTextElement) { disarm(); return; }
    if (!isCanvas(e.target)) {
      if (e.type === "pointerdown" || e.type === "mousedown") disarm();
      return;
    }
    if (!plain(e)) return;
    swallow(e);
    if (e.type === "pointerdown") {
      down = { x: e.clientX, y: e.clientY };
    } else if (e.type === "pointerup" && down) {
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved >= DRAG_PX) return;
      const scenePoint = viewportToScene({ x: e.clientX, y: e.clientY, appState: app?.state ?? {} });
      disarm();
      try {
        Promise.resolve(onPlace(scenePoint)).catch((error) => console.warn("[plexus] note place failed", error));
      } catch (error) {
        console.warn("[plexus] note place failed", error);
      }
    }
  }

  function arm() {
    if (armed) return true;
    let ok = false;
    try { ok = !!canArm(); } catch { ok = false; }
    if (!ok || app?.state?.editingTextElement) return false;
    armed = true;
    for (const t of CLICK_EVENTS) containerEl.addEventListener(t, onPointer, true);
    doc.addEventListener?.("keydown", onKey, true);
    doc.body?.setAttribute?.(ATTR, "");
    timer = setTimer(disarm, ARM_TIMEOUT_MS);
    return true;
  }

  return { arm, disarm, armed: () => armed, dispose: disarm };
}
