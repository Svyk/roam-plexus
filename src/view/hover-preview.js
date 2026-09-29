import { viewportToScene } from "../model/scene.js";
import { parseRoamLink } from "../model/links.js";
import { isCanvasEvent } from "../host/links.js";

const OFFSET_PX = 14;
const MAX_CHILDREN = 3;

// Hover preview for Roam links inside an open drawing. It exists only between attach() and its disposer, listens
// only on the editor container, and does no work unless the pointer is over an element carrying a Roam link.
export function createHoverPreview({
  doc,
  api = globalThis.roamAlphaAPI,
  raf = globalThis.requestAnimationFrame?.bind(globalThis),
  caf = globalThis.cancelAnimationFrame?.bind(globalThis),
  delayMs = 250,
  parse = parseRoamLink,
} = {}) {
  let portal = null;
  let body = null;
  let shownKey = null;
  let timer = null;
  let memoLink = null;
  let memoTarget = null;
  let detachCurrent = null;

  const hide = () => {
    if (timer != null) { clearTimeout(timer); timer = null; }
    shownKey = null;
    memoLink = null;
    memoTarget = null;
    if (!portal) return;
    try { api.ui.components.unmountNode({ el: body }); } catch (error) { console.warn("[plexus] unmount failed", error); }
    portal.remove();
    portal = null;
    body = null;
  };

  function classify(link) {
    if (link === memoLink) return memoTarget;
    memoTarget = classifyUncached(link);
    memoLink = link;
    return memoTarget;
  }

  function classifyUncached(link) {
    const target = parse(link, api.graph.name);
    if (!target) return null;
    if (target.title) return { type: "page", title: target.title };
    if (!target.uid) return null;
    if (target.type === "block") return { type: "block", uid: target.uid };
    const raw = api.data.pull("[:node/title :block/string]", [":block/uid", target.uid]);
    if (!raw) return null;
    return raw[":node/title"] != null ? { type: "page", title: raw[":node/title"] } : { type: "block", uid: target.uid };
  }

  function childStrings(title) {
    const raw = api.data.pull("[{:block/children [:block/string :block/order]}]", [":node/title", title]);
    return (raw?.[":block/children"] || [])
      .slice()
      .sort((a, b) => (a[":block/order"] ?? 0) - (b[":block/order"] ?? 0))
      .slice(0, MAX_CHILDREN)
      .map((c) => c[":block/string"] ?? "");
  }

  function place(x, y) {
    if (!portal) return;
    const view = doc.defaultView;
    const w = view?.innerWidth || 1280;
    const h = view?.innerHeight || 800;
    const rect = portal.getBoundingClientRect?.() || { width: 320, height: 160 };
    portal.style.left = `${Math.max(4, Math.min(x + OFFSET_PX, w - (rect.width || 320) - 4))}px`;
    portal.style.top = `${Math.max(4, Math.min(y + OFFSET_PX, h - (rect.height || 160) - 4))}px`;
  }

  function show(target, x, y) {
    const key = target.type === "page" ? `p:${target.title}` : `b:${target.uid}`;
    if (portal && shownKey === key) return place(x, y);
    hide();
    shownKey = key;
    portal = doc.createElement("div");
    portal.className = "plexus-portal plexus-hover";
    body = doc.createElement("div");
    body.className = "plexus-hover-body";
    portal.append(body);
    doc.body.append(portal);
    place(x, y);
    try {
      api.ui.components.renderString({ el: body, string: target.type === "page" ? `[[${target.title}]]` : `((${target.uid}))` });
      if (target.type === "page") {
        for (const text of childStrings(target.title)) {
          const line = doc.createElement("div");
          line.className = "plexus-hover-line";
          line.textContent = text;
          portal.append(line);
        }
      }
    } catch (error) {
      console.warn("[plexus] hover render failed", error);
    }
    place(x, y);
  }

  return {
    hide,
    // Returns the disposer for this editor mount.
    attach({ app, containerEl }) {
      detachCurrent?.();
      if (!app || !containerEl?.addEventListener) return () => {};
      let last = null;
      let frame = null;

      const probe = () => {
        frame = null;
        if (!last) return;
        const { x, y } = last;
        try {
          const box = containerEl.getBoundingClientRect?.() || { left: 0, top: 0 };
          const point = viewportToScene({ x, y, appState: { ...app.state, offsetLeft: box.left, offsetTop: box.top } });
          const found = app.getElementLinkAtPosition?.(point, null);
          const link = typeof found === "string" ? found : found?.link;
          const target = link ? classify(link) : null;
          if (!target) return hide();
          const key = target.type === "page" ? `p:${target.title}` : `b:${target.uid}`;
          if (portal && shownKey === key) return place(x, y);
          if (timer != null) clearTimeout(timer);
          timer = setTimeout(() => { timer = null; show(target, x, y); }, delayMs);
        } catch (error) {
          console.warn("[plexus] hover probe failed", error);
        }
      };

      const onMove = (e) => {
        // A held button is a drag or pan, not a hover; stray targets are Excalidraw's own panels.
        if (e.buttons || !isCanvasEvent(e)) {
          if (last || portal) onHide();
          return;
        }
        last = { x: e.clientX, y: e.clientY };
        if (frame != null) return;
        frame = raf ? raf(probe) : (probe(), null);
      };
      const onHide = () => { last = null; hide(); };

      containerEl.addEventListener("pointermove", onMove, { capture: true });
      containerEl.addEventListener("pointerleave", onHide);
      containerEl.addEventListener("pointerdown", onHide, { capture: true });
      containerEl.addEventListener("wheel", onHide, { capture: true, passive: true });
      const dispose = () => {
        if (detachCurrent !== dispose) return;
        detachCurrent = null;
        containerEl.removeEventListener("pointermove", onMove, { capture: true });
        containerEl.removeEventListener("pointerleave", onHide);
        containerEl.removeEventListener("pointerdown", onHide, { capture: true });
        containerEl.removeEventListener("wheel", onHide, { capture: true });
        if (frame != null && caf) caf(frame);
        frame = null;
        last = null;
        hide();
      };
      detachCurrent = dispose;
      return dispose;
    },
    dispose() {
      detachCurrent?.();
      hide();
    },
  };
}
