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
  if (!el || el.closest?.(".plexus-offscreen") || el.closest?.(".plexus-dock")) return null;
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
let capturing = 0;

// True from captureSelectionSvg entry until its finally has restored the clipboard (grace period included).
export const clipboardBusy = () => capturing > 0;

export function captureSelectionSvg(app, ids, opts = {}) {
  capturing += 1;
  const run = captureTail.then(() => captureOnce(app, ids, opts));
  const done = () => { capturing -= 1; };
  run.then(done, done);
  captureTail = run.catch(() => {});
  return run;
}

// Native "Copy as PNG" of the given elements at scale x, optionally the dark export. Queues behind other captures on
// the same tail (so clipboardBusy/withClipboard cover it) and resolves a Blob, or null on any failure. Never throws.
export function captureSelectionPng(app, ids, opts = {}) {
  capturing += 1;
  const run = captureTail.then(() => capturePngOnce(app, ids, opts).catch((error) => {
    console.warn("[plexus] png capture failed", error);
    return null;
  }));
  const done = () => { capturing -= 1; };
  run.then(done, done);
  captureTail = run.catch(() => {});
  return run;
}

// PNG size in pixels from the IHDR chunk (bytes 16-23), or null when the blob is not a PNG.
export async function readPngSize(blob) {
  try {
    const bytes = new Uint8Array(await blob.slice(0, 24).arrayBuffer());
    if (bytes.length < 24 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, 24);
    return { w: view.getUint32(16), h: view.getUint32(20) };
  } catch {
    return null;
  }
}

// Runs fn behind any capture in flight, so nothing else writes to the clipboard while a capture stub is installed.
export function withClipboard(fn) {
  const run = captureTail.then(fn);
  captureTail = run.catch(() => {});
  return run;
}

const SVG_RE = /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>/]/;
export const looksLikeSvg = (text) => SVG_RE.test(String(text));

async function pollToast(app, ms) {
  const end = Date.now() + ms;
  while (app.state?.toast == null && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => setTimeout(r, 0));
}

async function captureOnce(app, ids, { clipboard = globalThis.navigator?.clipboard, raf = globalThis.requestAnimationFrame, timeoutMs = 3000, graceMs = 1500, doneWaitMs = 1000 } = {}) {
  if (!clipboard) throw new Error("[plexus] clipboard unavailable");
  const prevIds = { ...(app.state?.selectedElementIds || {}) };
  const prevGroups = { ...(app.state?.selectedGroupIds || {}) };
  const origWriteText = clipboard.writeText;
  const origWrite = clipboard.write;
  let timer = null;
  let timedOut = false;
  let performed = null;
  const am = app.actionManager;
  const origUpdater = am?.updater;
  let wrapped = false;
  try {
    const selection = {};
    for (const id of ids) selection[id] = true;
    app.updateScene({ appState: { selectedElementIds: selection, selectedGroupIds: {} } });
    await new Promise((resolve) => (typeof raf === "function" ? raf(() => resolve()) : setTimeout(resolve, 16)));

    let settle;
    const captured = new Promise((resolve) => { settle = resolve; });
    const offer = (text) => { if (looksLikeSvg(text)) settle(String(text)); };
    clipboard.writeText = async (text) => { offer(text); };
    clipboard.write = async (items) => {
      for (const item of items || []) {
        const type = item?.types?.find?.((t) => t === "text/plain" || t === "image/svg+xml");
        if (type) { offer(await (await item.getType(type)).text()); return; }
      }
    };
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
    const action = app.actionManager.actions.copyAsSvg;
    // Roam's executeAction returns nothing; the promise from action.perform only surfaces via am.updater.
    if (typeof origUpdater === "function") {
      wrapped = true;
      am.updater = function (result) {
        if (result && typeof result.then === "function") { performed = Promise.resolve(result); performed.catch(() => {}); }
        return origUpdater.apply(this, arguments);
      };
    }
    const ret = am.executeAction(action, "api");
    if (!performed && ret && typeof ret.then === "function") { performed = Promise.resolve(ret); performed.catch(() => {}); }
    const svg = await Promise.race([captured, timeout, ...(performed ? [performed.then(() => timeout)] : [])]);
    if (!svg) { timedOut = true; throw new Error("[plexus] no SVG captured"); }
    return svg;
  } finally {
    if (timer) clearTimeout(timer);
    if (timedOut && graceMs > 0) {
      // The export may still finish: swallow only its SVG write for a short grace period, pass everything else through.
      clipboard.writeText = async (text) => (looksLikeSvg(text) ? undefined : origWriteText.call(clipboard, text));
      clipboard.write = async (items) => {
        for (const item of items || []) {
          const type = item?.types?.find?.((t) => t === "text/plain" || t === "image/svg+xml");
          if (type && looksLikeSvg(await (await item.getType(type)).text())) return undefined;
        }
        return origWrite.call(clipboard, items);
      };
      await new Promise((resolve) => setTimeout(resolve, graceMs));
    }
    if (wrapped) am.updater = origUpdater;
    {
      // copyAsSvg sets its own toast after writeText; let it land so our toast:null is the last write.
      let settleTimer = null;
      const wait = new Promise((resolve) => { settleTimer = setTimeout(resolve, doneWaitMs); });
      if (performed) await Promise.race([performed.catch(() => {}), wait]);
      else if (!wrapped && app.state?.toast == null) await pollToast(app, doneWaitMs);
      clearTimeout(settleTimer);
    }
    clipboard.writeText = origWriteText;
    clipboard.write = origWrite;
    try {
      app.updateScene({ appState: { selectedElementIds: prevIds, selectedGroupIds: prevGroups, toast: null } });
    } catch (error) {
      console.warn("[plexus] could not restore selection", error);
    }
  }
}

const pngItemType = (item) => item?.types?.find?.((t) => t === "image/png");

async function capturePngOnce(app, ids, { scale = 2, dark = false, padding = null, clipboard = globalThis.navigator?.clipboard, raf = globalThis.requestAnimationFrame, timeoutMs = 3000, graceMs = 1500, doneWaitMs = 1000 } = {}) {
  if (!clipboard) throw new Error("clipboard unavailable");
  const action = app?.actionManager?.actions?.copyAsPng;
  if (!action || typeof app.actionManager.executeAction !== "function") throw new Error("copyAsPng unavailable");
  // Read inside the queued run: an earlier capture in the queue has restored these by now.
  const pad = Number.isFinite(padding) ? padding : null;
  const prev = {
    exportScale: app.state?.exportScale ?? 1,
    exportWithDarkMode: app.state?.exportWithDarkMode ?? false,
    ...(pad != null ? { exportPadding: app.state?.exportPadding } : {}),
  };
  const prevIds = { ...(app.state?.selectedElementIds || {}) };
  const prevGroups = { ...(app.state?.selectedGroupIds || {}) };
  const origWrite = clipboard.write;
  let timer = null;
  let timedOut = false;
  let performed = null;
  const am = app.actionManager;
  const origUpdater = am.updater;
  let wrapped = false;
  const restoreExport = () => {
    try { app.updateScene({ appState: { ...prev } }); } catch (error) { console.warn("[plexus] could not restore export settings", error); }
  };
  try {
    const selection = {};
    for (const id of ids) selection[id] = true;
    app.updateScene({ appState: {
      selectedElementIds: selection,
      selectedGroupIds: {},
      exportScale: scale,
      exportWithDarkMode: !!dark,
      ...(pad != null ? { exportPadding: pad } : {}),
    } });
    await new Promise((resolve) => (typeof raf === "function" ? raf(() => resolve()) : setTimeout(resolve, 16)));

    let settle;
    const captured = new Promise((resolve) => { settle = resolve; });
    clipboard.write = async (items) => {
      for (const item of items || []) {
        const type = pngItemType(item);
        if (!type) continue;
        // The canvas exists once write is called: put the export keys back before anything else can save them.
        restoreExport();
        settle(await item.getType(type));
        return;
      }
    };
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
    // The perform promise only surfaces via am.updater; its late appState would re-apply the temporary selection and export keys.
    if (typeof origUpdater === "function") {
      wrapped = true;
      am.updater = function (result) {
        if (result && typeof result.then === "function") { performed = Promise.resolve(result); performed.catch(() => {}); }
        return origUpdater.apply(this, arguments);
      };
    }
    const ret = am.executeAction(action, "contextMenu");
    if (ret && typeof ret.catch === "function") ret.catch(() => {});
    if (!performed && ret && typeof ret.then === "function") { performed = Promise.resolve(ret); performed.catch(() => {}); }
    const blob = await Promise.race([captured, timeout]);
    if (!blob) { timedOut = true; throw new Error("no PNG captured"); }
    return blob;
  } finally {
    if (timer) clearTimeout(timer);
    if (timedOut) restoreExport();
    if (timedOut && graceMs > 0) {
      // The export may still finish: swallow only its PNG write for a short grace period, pass everything else through.
      clipboard.write = async (items) => {
        for (const item of items || []) if (pngItemType(item)) return undefined;
        return origWrite.call(clipboard, items);
      };
      await new Promise((resolve) => setTimeout(resolve, graceMs));
    }
    if (wrapped) am.updater = origUpdater;
    if (performed) {
      let settleTimer = null;
      const wait = new Promise((resolve) => { settleTimer = setTimeout(resolve, doneWaitMs); });
      await Promise.race([performed.catch(() => {}), wait]);
      clearTimeout(settleTimer);
    }
    clipboard.write = origWrite;
    try {
      app.updateScene({ appState: { selectedElementIds: prevIds, selectedGroupIds: prevGroups, ...prev, toast: null } });
    } catch (error) {
      console.warn("[plexus] could not restore selection", error);
    }
  }
}

// Before-snapshot, paste and after-snapshot run in one synchronous task. Deleted copies (invisibly small elements
// that restoreElements keeps as isDeleted) are not counted.
export function addViaPaste(app, elements, { position = "center" } = {}) {
  const before = new Set((app.getSceneElementsIncludingDeleted?.() || []).map((e) => e.id));
  app.addElementsFromPasteOrLibrary({ elements, files: {}, position });
  return (app.getSceneElementsIncludingDeleted?.() || []).filter((e) => !before.has(e.id) && !e.isDeleted).map((e) => e.id);
}

// Polls once per animation frame. Resolves false on timeout or when the App is no longer the active editor.
export function waitNotLoading(app, timeoutMs, { doc = globalThis.document, raf = globalThis.requestAnimationFrame, now = () => Date.now() } = {}) {
  const tick = typeof raf === "function" ? (fn) => raf(fn) : (fn) => setTimeout(fn, 16);
  const end = now() + timeoutMs;
  return new Promise((resolve) => {
    const step = () => {
      if (activeEditor(doc)?.app !== app) return resolve(false);
      if (!app.state?.isLoading) return resolve(true);
      if (now() >= end) return resolve(false);
      tick(step);
    };
    step();
  });
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

// Emitters on the Excalidraw App return their own unsubscribe from .on(). Missing emitters degrade to a no-op.
export function subscribeViewport(app, cb) {
  const offs = [];
  for (const name of ["onScrollChangeEmitter", "onChangeEmitter"]) {
    const emitter = app?.[name];
    if (!emitter || typeof emitter.on !== "function") continue;
    try {
      const off = emitter.on((...args) => {
        try { cb(...args); } catch (error) { console.warn("[plexus] viewport listener failed", error); }
      });
      if (typeof off === "function") offs.push(off);
    } catch (error) {
      console.warn("[plexus] could not subscribe to", name, error);
    }
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    for (const off of offs) {
      try { off(); } catch (error) { console.warn("[plexus] unsubscribe failed", error); }
    }
  };
}

export function insertElements(app, elements, { select = true } = {}) {
  const list = Array.isArray(elements) ? elements : [];
  if (!app || typeof app.updateScene !== "function" || !list.length) return false;
  const existing = app.getSceneElementsIncludingDeleted?.() || [];
  const update = { elements: [...existing, ...list], captureUpdate: "IMMEDIATELY" };
  if (select) {
    const selection = {};
    for (const el of list) if (!el.containerId) selection[el.id] = true;
    update.appState = { selectedElementIds: selection, selectedGroupIds: {} };
  }
  app.updateScene(update);
  return true;
}

export async function readClipboardText({ clipboard = globalThis.navigator?.clipboard } = {}) {
  if (!clipboard || typeof clipboard.readText !== "function") return null;
  return clipboard.readText();
}
