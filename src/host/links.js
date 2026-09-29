import { viewportToScene } from "../model/scene.js";
import { parseRoamLink } from "../model/links.js";

const MAX_MOVE_PX = 6;
const MAX_HOLD_MS = 400;

// Capture-phase pointerdown/up on the editor container. Only trusted, short, still clicks on an element whose
// link is a Roam link are taken over; everything else falls through to Excalidraw.
export function installLinkInterception({ app, containerEl, api = globalThis.roamAlphaAPI, getSettings, onNavigate, parse = parseRoamLink, now = () => Date.now() } = {}) {
  if (!app || !containerEl?.addEventListener) return () => {};
  let down = null;

  const kindOf = (uid) => {
    const raw = api.data.pull("[:node/title :block/string]", [":block/uid", uid]);
    if (!raw) return null;
    return raw[":node/title"] != null ? "page" : "block";
  };

  function resolve(event) {
    const el = containerEl.getBoundingClientRect?.() || { left: 0, top: 0 };
    const appState = { ...app.state, offsetLeft: el.left, offsetTop: el.top };
    const point = viewportToScene({ x: event.clientX, y: event.clientY, appState });
    const found = app.getElementLinkAtPosition(point, null);
    const link = typeof found === "string" ? found : found?.link;
    if (!link) return null;
    const target = parse(link, api.graph.name);
    if (!target) return null;
    if (target.type === "block" && target.uid) return target;
    if (target.type === "page" && target.title) return target;
    if (target.uid) {
      const type = kindOf(target.uid);
      return type ? { type, uid: target.uid } : null;
    }
    return null;
  }

  function navigate(target, sidebar) {
    if (sidebar) {
      const window = target.type === "page"
        ? { type: "outline", "block-uid": target.uid ?? pageUidOf(target.title) }
        : { type: "block", "block-uid": target.uid };
      if (window["block-uid"]) api.ui.rightSidebar.addWindow({ window });
      return;
    }
    containerEl.closest?.(".excalidraw-outer-container")?.querySelector?.(".bp3-icon-minimize")?.click?.();
    if (target.type === "page") {
      const uid = target.uid ?? pageUidOf(target.title);
      if (uid) api.ui.mainWindow.openPage({ page: { uid } });
      else api.ui.mainWindow.openPage({ page: { title: target.title } });
    } else api.ui.mainWindow.openBlock({ block: { uid: target.uid } });
  }

  function pageUidOf(title) {
    return api.data.pull("[:block/uid]", [":node/title", title])?.[":block/uid"] || null;
  }

  const onDown = (e) => {
    down = e.isTrusted && (e.button ?? 0) === 0 ? { x: e.clientX, y: e.clientY, t: now() } : null;
  };

  const onUp = (e) => {
    const start = down;
    down = null;
    if (!start || !e.isTrusted) return;
    if (getSettings?.()?.links === false) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > MAX_MOVE_PX || now() - start.t > MAX_HOLD_MS) return;
    try {
      const target = resolve(e);
      if (!target) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const sidebar = !!e.shiftKey;
      navigate(target, sidebar);
      onNavigate?.({ target, sidebar });
    } catch (error) {
      console.warn("[plexus] link interception failed", error);
    }
  };

  containerEl.addEventListener("pointerdown", onDown, true);
  containerEl.addEventListener("pointerup", onUp, true);
  return () => {
    containerEl.removeEventListener("pointerdown", onDown, true);
    containerEl.removeEventListener("pointerup", onUp, true);
  };
}
