import { viewportToScene } from "../model/scene.js";
import { parseRoamLink } from "../model/links.js";

const MAX_MOVE_PX = 6;
const MAX_HOLD_MS = 400;

// Only the interactive canvas is a link surface; Excalidraw's toolbars and panels sit inside the same container.
export function isCanvasEvent(event) {
  const tag = event?.target?.tagName;
  return !tag || String(tag).toUpperCase() === "CANVAS";
}

// Excalidraw follows links only with the selection tool (or in view mode); other tools own the gesture.
export function linksActive(app) {
  const tool = app?.state?.activeTool?.type;
  return !tool || tool === "selection" || !!app.state.viewModeEnabled;
}

// Excalidraw's link tooltip is orphaned on <body> when Plexus navigates away from under it.
export function clearLinkTooltip(doc) {
  for (const el of doc?.querySelectorAll?.(".excalidraw-tooltip--visible") ?? []) {
    el.classList.remove("excalidraw-tooltip--visible");
  }
}

function pageUidOf(api, title) {
  return api.data.pull("[:block/uid]", [":node/title", title])?.[":block/uid"] || null;
}

function sidebarWindow(api, target) {
  return target.type === "page"
    ? { type: "outline", "block-uid": target.uid ?? pageUidOf(api, target.title) }
    : { type: "block", "block-uid": target.uid };
}

function navigate(api, containerEl, target, sidebar, window) {
  if (sidebar) {
    api.ui.rightSidebar.addWindow({ window });
    return;
  }
  containerEl.closest?.(".excalidraw-outer-container")?.querySelector?.(".bp3-icon-minimize")?.click?.();
  if (target.type === "page") {
    const uid = target.uid ?? pageUidOf(api, target.title);
    if (uid) api.ui.mainWindow.openPage({ page: { uid } });
    else api.ui.mainWindow.openPage({ page: { title: target.title } });
  } else api.ui.mainWindow.openBlock({ block: { uid: target.uid } });
  clearLinkTooltip(containerEl.ownerDocument);
}

// Same navigation as link interception: minimize the full-screen editor, then open; sidebar opens a window instead.
export function navigateToTarget({ api, containerEl, target, sidebar = false }) {
  const window = sidebar ? sidebarWindow(api, target) : null;
  if (sidebar && !window["block-uid"]) return false;
  navigate(api, containerEl, target, sidebar, window);
  return true;
}

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

  const onDown = (e) => {
    down = e.isTrusted && (e.button ?? 0) === 0 ? { x: e.clientX, y: e.clientY, t: now() } : null;
  };

  const onUp = (e) => {
    const start = down;
    down = null;
    if (!start || !e.isTrusted) return;
    if (getSettings?.()?.links === false) return;
    if (!isCanvasEvent(e) || !linksActive(app)) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > MAX_MOVE_PX || now() - start.t > MAX_HOLD_MS) return;
    try {
      const target = resolve(e);
      if (!target) return;
      const sidebar = !!e.shiftKey;
      const window = sidebar ? sidebarWindow(api, target) : null;
      // Nothing to open in the sidebar (page does not exist): leave the click to Excalidraw, no false toast.
      if (sidebar && !window["block-uid"]) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      navigate(api, containerEl, target, sidebar, window);
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
