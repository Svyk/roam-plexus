// On-canvas plus, fold badge, and dashed cross-links. Overlay only: the outline stays the source.
import { sceneToViewport } from "../model/scene.js";
import { crossPairs } from "../model/mmextra.js";

function plusPoint(box) {
  const { x, y, w, h, layout, side } = box;
  if (side === "left" || layout === "left") return { x, y: y + h / 2 };
  if (layout === "down" || layout === "org") return { x: x + w / 2, y: y + h };
  if (layout === "up") return { x: x + w / 2, y };
  return { x: x + w, y: y + h / 2 };
}

export function installMmChrome({ doc, app, containerEl, getModel, onAdd, onFold } = {}) {
  if (!containerEl || typeof containerEl.append !== "function" || typeof doc?.createElement !== "function") {
    return { refresh() {}, dispose() {} };
  }
  const host = doc.createElement("div");
  host.className = "plexus-mm-chrome";
  containerEl.append(host);
  const svg = typeof doc.createElementNS === "function"
    ? doc.createElementNS("http://www.w3.org/2000/svg", "svg")
    : doc.createElement("svg");
  svg.setAttribute?.("class", "plexus-mm-cross");
  if ("className" in svg && typeof svg.className === "string") svg.className = "plexus-mm-cross";
  containerEl.append(svg);

  const local = (x, y) => {
    const rect = containerEl.getBoundingClientRect?.() || { left: 0, top: 0 };
    const v = sceneToViewport({ x, y, appState: app?.state });
    return { x: v.x - rect.left, y: v.y - rect.top };
  };
  const button = (className, text, x, y, run) => {
    const el = doc.createElement("button");
    el.type = "button";
    el.className = className;
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    const stop = (e) => { e.preventDefault?.(); e.stopPropagation?.(); };
    el.addEventListener?.("pointerdown", stop);
    el.addEventListener?.("click", (e) => { stop(e); run(); });
    host.append(el);
  };

  const refresh = () => {
    const kids = typeof host.querySelectorAll === "function" ? [...host.querySelectorAll("button")] : [...(host.children || [])];
    for (const node of kids) node.remove?.();
    const lines = typeof svg.querySelectorAll === "function" ? [...svg.querySelectorAll("line")] : [];
    for (const node of lines) node.remove?.();
    const model = typeof getModel === "function" ? (getModel() || {}) : {};
    for (const box of model.boxes || []) {
      const at = plusPoint(box);
      const p = local(at.x, at.y);
      button("plexus-mm-plus", "+", p.x - 9, p.y - 9, () => onAdd?.(box));
      if (box.hidden > 0) {
        const c = local(box.x + box.w, box.y);
        button("plexus-mm-badge", String(box.hidden), c.x - 8, c.y - 8, () => onFold?.(box));
      }
    }
    const by = new Map();
    for (const n of model.nodes || []) if (n?.uid) by.set(n.uid, n);
    for (const pair of crossPairs(model.nodes || [])) {
      const a = by.get(pair.from);
      const b = by.get(pair.to);
      if (!a || !b) continue;
      const p1 = local(a.x, a.y);
      const p2 = local(b.x, b.y);
      const line = typeof doc.createElementNS === "function"
        ? doc.createElementNS("http://www.w3.org/2000/svg", "line")
        : doc.createElement("line");
      line.setAttribute?.("x1", String(p1.x));
      line.setAttribute?.("y1", String(p1.y));
      line.setAttribute?.("x2", String(p2.x));
      line.setAttribute?.("y2", String(p2.y));
      svg.append?.(line);
    }
  };

  return {
    refresh,
    dispose() {
      try { host.remove?.(); } catch { /* detached */ }
      try { svg.remove?.(); } catch { /* detached */ }
    },
  };
}
