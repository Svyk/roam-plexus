import { embedAnchors } from "../model/embeds.js";
import { embedAtPoint, hoveredRefLines } from "../model/ref-lines.js";
import { sceneToViewport } from "../model/scene.js";

// Hovered-only lines between embeds already on this canvas. Nothing is drawn until the pointer is over a card.
export function installRefLines({ doc, app, containerEl, texts, requestFrame = globalThis.requestAnimationFrame, cancelFrame = globalThis.cancelAnimationFrame } = {}) {
  if (!containerEl || typeof containerEl.addEventListener !== "function") return () => {};
  const svg = typeof doc?.createElementNS === "function"
    ? doc.createElementNS("http://www.w3.org/2000/svg", "svg")
    : doc.createElement("svg");
  svg.setAttribute?.("class", "plexus-ref-lines");
  if ("className" in svg && typeof svg.className === "string") svg.className = "plexus-ref-lines";
  containerEl.append?.(svg);
  let frame = 0;
  let queued = false;
  let hoverId = null;

  const clear = () => {
    const nodes = typeof svg.querySelectorAll === "function" ? [...svg.querySelectorAll("line")] : [];
    for (const node of nodes) node.remove?.();
  };

  const paint = () => {
    frame = 0;
    clear();
    if (!hoverId) return;
    const elements = app?.getSceneElementsIncludingDeleted?.() ?? app?.getSceneElements?.() ?? [];
    const saved = texts instanceof Map ? texts : new Map();
    const cards = embedAnchors(elements).map((el) => {
      const row = saved.get(el.id);
      return {
        id: el.id,
        ref: el.customData?.plexus?.embed,
        texts: row?.texts || [],
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
      };
    });
    const lines = hoveredRefLines({ hoveredId: hoverId, cards });
    const rect = containerEl.getBoundingClientRect?.() || { left: 0, top: 0 };
    for (const line of lines) {
      const a = sceneToViewport({ x: line.x1, y: line.y1, appState: app?.state });
      const b = sceneToViewport({ x: line.x2, y: line.y2, appState: app?.state });
      const node = typeof doc.createElementNS === "function"
        ? doc.createElementNS("http://www.w3.org/2000/svg", "line")
        : doc.createElement("line");
      node.setAttribute?.("x1", String(a.x - rect.left));
      node.setAttribute?.("y1", String(a.y - rect.top));
      node.setAttribute?.("x2", String(b.x - rect.left));
      node.setAttribute?.("y2", String(b.y - rect.top));
      svg.append?.(node);
    }
  };

  const schedule = () => {
    if (queued) return;
    queued = true;
    const run = () => {
      queued = false;
      paint();
    };
    if (requestFrame) frame = requestFrame(run);
    else run();
  };

  const onMove = (event) => {
    const elements = app?.getSceneElementsIncludingDeleted?.() ?? app?.getSceneElements?.() ?? [];
    hoverId = embedAtPoint(elements, app?.state, event?.clientX, event?.clientY);
    schedule();
  };
  const onLeave = () => {
    hoverId = null;
    schedule();
  };
  containerEl.addEventListener("pointermove", onMove);
  containerEl.addEventListener("pointerleave", onLeave);
  return () => {
    containerEl.removeEventListener?.("pointermove", onMove);
    containerEl.removeEventListener?.("pointerleave", onLeave);
    if (frame && cancelFrame) cancelFrame(frame);
    svg.remove?.();
  };
}
