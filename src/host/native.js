import { fitZoom, sceneToViewport } from "../model/scene.js";

export function findApp(excalidrawEl) {
  if (!excalidrawEl) return null;
  const key = Object.keys(excalidrawEl).find((k) => k.startsWith("__reactFiber$"));
  if (!key) return null;
  let fiber = excalidrawEl[key];
  for (let i = 0; fiber && i <= 6; i++) {
    const node = fiber.stateNode;
    if (node && typeof node.updateScene === "function"
      && typeof node.getSceneElementsIncludingDeleted === "function"
      && node.actionManager && typeof node.actionManager === "object") return node;
    fiber = fiber.return;
  }
  return null;
}

export function activeEditor(doc = globalThis.document) {
  const el = doc?.querySelector?.(".excalidraw-outer-container.full-screen .excalidraw");
  if (!el) return null;
  const outer = el.closest(".excalidraw-outer-container");
  const app = findApp(el);
  if (!app) return null;
  const block = outer?.closest?.('[id^="block-input-"]');
  return { el, app, outer, drawingUid: block?.id ? block.id.slice(-9) : null };
}

export function selectedElementIds(app) {
  const sel = app?.state?.selectedElementIds || {};
  const deleted = new Set((app.getSceneElementsIncludingDeleted?.() || []).filter((e) => e.isDeleted).map((e) => e.id));
  return Object.keys(sel).filter((id) => sel[id] && !deleted.has(id));
}

let captureTail = Promise.resolve();

export function captureSelectionSvg(app, ids, opts = {}) {
  const run = captureTail.then(() => captureOnce(app, ids, opts));
  captureTail = run.catch(() => {});
  return run;
}

async function captureOnce(app, ids, { clipboard = globalThis.navigator?.clipboard, raf = globalThis.requestAnimationFrame, timeoutMs = 3000 } = {}) {
  if (!clipboard) throw new Error("[plexus] clipboard unavailable");
  const prevIds = { ...(app.state?.selectedElementIds || {}) };
  const prevGroups = { ...(app.state?.selectedGroupIds || {}) };
  const origWriteText = clipboard.writeText;
  const origWrite = clipboard.write;
  let timer = null;
  try {
    const selection = {};
    for (const id of ids) selection[id] = true;
    app.updateScene({ appState: { selectedElementIds: selection, selectedGroupIds: {} } });
    await new Promise((resolve) => (typeof raf === "function" ? raf(() => resolve()) : setTimeout(resolve, 16)));

    let settle;
    const captured = new Promise((resolve) => { settle = resolve; });
    clipboard.writeText = async (text) => { settle(String(text)); };
    clipboard.write = async (items) => {
      for (const item of items || []) {
        const type = item?.types?.find?.((t) => t === "text/plain" || t === "image/svg+xml");
        if (type) { settle(await (await item.getType(type)).text()); return; }
      }
    };
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
    const action = app.actionManager.actions.copyAsSvg;
    const done = Promise.resolve(app.actionManager.executeAction(action, "api"));
    done.catch(() => {});
    const svg = await Promise.race([captured, timeout, done.then(() => timeout)]);
    if (!svg) throw new Error("[plexus] no SVG captured");
    return svg;
  } finally {
    if (timer) clearTimeout(timer);
    clipboard.writeText = origWriteText;
    clipboard.write = origWrite;
    try {
      app.updateScene({ appState: { selectedElementIds: prevIds, selectedGroupIds: prevGroups, toast: null } });
    } catch (error) {
      console.warn("[plexus] could not restore selection", error);
    }
  }
}

export function zoomTo(app, bbox, opts = {}) {
  const result = fitZoom({ bbox, viewportWidth: app.state.width, viewportHeight: app.state.height, ...opts });
  app.updateScene({ appState: { zoom: { value: result.zoom }, scrollX: result.scrollX, scrollY: result.scrollY } });
  return result;
}

export function viewportRectOf(app, bbox) {
  const appState = app.state;
  const a = sceneToViewport({ x: bbox[0], y: bbox[1], appState });
  const b = sceneToViewport({ x: bbox[2], y: bbox[3], appState });
  return { left: a.x, top: a.y, width: b.x - a.x, height: b.y - a.y };
}
