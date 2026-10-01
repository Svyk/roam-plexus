import { createLifecycle, sweepExtensionDom } from "./lifecycle.js";
import { HOTKEYS, SETTING_IDS, createSettingsPanel, hotkeyFor, initializeSettings, readSettings, setRefOverride, writeSetting } from "./settings.js";
import { createRoamHost } from "./host/roam.js";
import * as native from "./host/native.js";
import { createCropCache } from "./host/cache.js";
import { createColdRenderer } from "./host/cold-render.js";
import { createToaster } from "./view/toast.js";
import { baseZIndex, createEditorToolbar, installBackKey } from "./view/toolbar.js";
import { createEmbedOverlay, installEmbedF2 } from "./view/embeds.js";
import { createCanvasBacklinks } from "./view/backlinks.js";
import { createPresenter } from "./view/present.js";
import { installCanvasPaste } from "./view/canvas-paste.js";
import { createRegionRefRenderer } from "./view/regionref.js";
import { createDiscovery } from "./view/discover.js";
import { focusKeptIds, todoKeptIds, showFocusVeil, showTodoVeil, showSpotlight } from "./view/spotlight.js";
import { cardsFromQuery, cardsFromChildren } from "./query-cards.js";
import { relationPlan } from "./relations.js";
import { lockName, withLock } from "./host/locks.js";
import { createHoverPreview } from "./view/hover-preview.js";
import { clearLinkTooltip, installLinkInterception, navigateToTarget } from "./host/links.js";
import { createPublicApi, createSceneRegistry, installPublicApi, uninstallPublicApi } from "./api.js";
import { createMindMap } from "./view/mindmap.js";
import { createMmWriter } from "./host/mmwrites.js";
import { createWriteGuard } from "./host/guard.js";
import { createSnapshotScheduler, createSnapshotStore, planRestore } from "./host/snapshots.js";
import { openRestoreDialog } from "./view/restore-dialog.js";
import { openChartDialog } from "./view/chart-dialog.js";
import { createOutlineActions } from "./actions-outline.js";
import { createTemplateActions } from "./actions-templates.js";
import { createArrangeActions } from "./actions-arrange.js";
import { createLaneRegionMaker } from "./lane-regions.js";
import * as camera from "./host/camera.js";
import { createRegionsLayer } from "./view/regions-layer.js";
import { installRegionLanding } from "./view/landing.js";
import { auditOpenTarget, openAuditDialog } from "./view/audit-dialog.js";
import { createMeasurer } from "./host/measure.js";
import { createActions } from "./actions.js";
import { clearImageMemo } from "./host/image-source.js";
import { createLinkSuggest, installSuggestAutoAttach } from "./view/link-suggest.js";
import { installCanvasMenu, installRoamMenus, plexusCanvasItems } from "./view/context-menus.js";
import { openCaptionPrompt } from "./view/caption-prompt.js";
import { openSettingsDialog } from "./view/settings-dialog.js";
import { openEmbedPicker } from "./view/embed-picker.js";
import { openCommandList } from "./view/command-list.js";
import { installRefPaste } from "./view/paste.js";
import { installNoteTool } from "./view/note-tool.js";
import { createHotkeyRunner, installHotkeyGuard } from "./view/hotkeys.js";
import { createDock } from "./view/dock.js";
import { installRoamDrop } from "./view/drop.js";
import { installTextLinks } from "./view/text-links.js";
import { parseEmbedRef } from "./model/embeds.js";
import { elementBounds, viewportToScene } from "./model/scene.js";
import { isHostDark, motionOk, resetThemeMemo } from "./host/theme.js";
import { LOCK_ACTION_NAMES, applyCanvasPrefs, captureView, copyText, diagnosticsText, restoreAutomaticView, runNamedAction, shouldReapplyTheme, syncGeneration } from "./host/canvas-prefs.js";
import { regionLabel, drawingTitleOf, imageAltAt, isImageKind } from "./model/label.js";

let activeLifecycle = null;

const THUMB_WIDTHS = [160, 480];
const THUMB_WARM_DELAY_MS = 1500;
const REFRESH_DEBOUNCE_MS = 300;
const LAYER_REFRESH_MS = 200;
const DOCK_SETTLE_MS = 150;
// Toolbar preset ids -> model/frames.js preset keys; toolbar layout kinds -> LAYOUTS keys.
const TOOLBAR_PRESETS = { a4: "A4", letter: "Letter", "16:9": "16:9", "4:3": "4:3", "1:1": "1:1", mobile: "Mobile" };
const presetOf = (id) => TOOLBAR_PRESETS[id] ?? id;
const LAYOUT_KINDS = { "2x2": "grid", strip: "strip" };

function createEmitter() {
  const listeners = new Map();
  return {
    on(type, cb) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(cb);
    },
    off(type, cb) { listeners.get(type)?.delete(cb); },
    emit(detail) {
      for (const cb of [...(listeners.get("change") ?? [])]) cb(detail);
    },
    clear() { listeners.clear(); },
  };
}

function versionFlagTarget() {
  return globalThis.window ?? globalThis;
}

function isPaletteChord(event) {
  const key = event?.key;
  if (typeof key !== "string" || key.toLowerCase() !== "p") return false;
  return (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;
}

function isMindMapChord(event) {
  if (!event || event.isComposing || event.repeat) return false;
  if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return false;
  return event.code === "KeyM";
}

// Roam's keydown walk costs about 0.055 ms per palette entry. Register for the open palette, then drop.
export function attachLazyPalette({ doc, palette, lifecycle, commands, onMindMap }) {
  if (!palette?.addCommand || !palette?.removeCommand) throw new TypeError("A command palette is required");
  let paletteOn = false;
  const enable = () => {
    if (paletteOn || lifecycle.disposed) return [];
    paletteOn = true;
    return commands.map((command) => {
      try {
        const added = palette.addCommand(command);
        if (added?.then) added.catch((error) => console.warn("[plexus] command", error));
        return added;
      } catch (error) {
        console.warn("[plexus] command", error);
        return null;
      }
    });
  };
  const disable = () => {
    if (!paletteOn) return;
    paletteOn = false;
    for (const command of commands) {
      try { palette.removeCommand({ label: command.label }); } catch { /* already gone */ }
    }
  };
  const releaseIfClosed = () => {
    if (!paletteOn || doc?.querySelector?.(".rm-command-palette")) return;
    disable();
  };
  const first = enable();
  if (typeof doc?.addEventListener === "function") {
    lifecycle.event(doc, "keydown", (event) => {
      if (isPaletteChord(event)) enable();
      else if (isMindMapChord(event) && onMindMap?.(event) !== false) {
        event.preventDefault?.();
        event.stopImmediatePropagation?.();
      }
    }, true);
    lifecycle.event(doc, "keyup", () => { if (paletteOn) setTimeout(releaseIfClosed, 0); }, true);
    lifecycle.event(doc, "pointerup", () => { if (paletteOn) setTimeout(releaseIfClosed, 0); }, true);
    const timerBox = { id: 0 };
    let cancelled = false;
    lifecycle.add(() => { cancelled = true; clearTimeout(timerBox.id); });
    Promise.all(first.map((item) => Promise.resolve(item))).then(() => {
      if (cancelled || lifecycle.disposed) return;
      timerBox.id = setTimeout(releaseIfClosed, 0);
    });
  }
  lifecycle.add(disable);
}

export async function onload({ extensionAPI, extension, openCommandList: openList = openCommandList }) {
  if (!extensionAPI) throw new TypeError("Roam did not provide extensionAPI");
  if (activeLifecycle) await activeLifecycle.dispose();

  const lifecycle = createLifecycle();
  activeLifecycle = lifecycle;
  try {
    const flagTarget = versionFlagTarget();
    flagTarget.__ROAM_PLEXUS_VERSION = extension?.version || "development";
    lifecycle.add(() => { delete flagTarget.__ROAM_PLEXUS_VERSION; });

    await initializeSettings(extensionAPI);
    let refreshTimer = null;
    let refreshAll = () => {};
    const scheduleRefresh = () => {
      if (refreshTimer != null) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        try { refreshAll(); } catch (error) { console.warn("[plexus] refresh failed", error); }
      }, REFRESH_DEBOUNCE_MS);
    };
    lifecycle.add(() => { if (refreshTimer != null) clearTimeout(refreshTimer); refreshTimer = null; refreshAll = () => {}; });
    await lifecycle.settingsPanel(extensionAPI, createSettingsPanel({ onChange: scheduleRefresh }));
    const getSettings = () => readSettings(extensionAPI);

    let actions = null;
    let audit = null;
    let toggleLayer = null;
    let backCommand = null;
    let showDockParent = null;
    let tools = null;
    let mountedApp = null;
    const hotkeyHandlers = {};
    const runHotkey = createHotkeyRunner({ handlers: hotkeyHandlers, getApp: () => mountedApp?.() ?? null });
    let commandZ = () => 0;
    let openSettings = () => console.warn("[plexus] unavailable outside Roam: settings");
    let showInCompass = () => console.warn("[plexus] unavailable outside Roam: showInCompass");
    let runFocusMode = () => console.warn("[plexus] unavailable outside Roam: focusMode");
    let runTodoMode = () => console.warn("[plexus] unavailable outside Roam: todoMode");
    let runEmbedQuery = () => console.warn("[plexus] unavailable outside Roam: embedQuery");
    let runEmbedChildren = () => console.warn("[plexus] unavailable outside Roam: embedChildren");
    let runLinkSelected = () => console.warn("[plexus] unavailable outside Roam: linkSelected");
    let runFilterTag = () => console.warn("[plexus] unavailable outside Roam: filterTag");
    let runLockAction = () => console.warn("[plexus] unavailable outside Roam: lock");
    let runDiagnostics = () => console.warn("[plexus] unavailable outside Roam: diagnostics");
    const doc = globalThis.document;
    const api = globalThis.roamAlphaAPI;
    if (doc && api) {
      const host = createRoamHost({ api });
      const settings = getSettings();
      const generationState = syncGeneration(doc.defaultView?.localStorage, extension?.version || "development");
      const cache = createCropCache({
        graph: host.graphName(),
        persist: settings.cacheOnDisk && !host.isEncrypted(),
        limitBytes: settings.cacheLimitMb * 2 ** 20,
        generation: generationState.generation,
      });
      lifecycle.add(() => cache.dispose());
      const cold = createColdRenderer({ api, doc });
      lifecycle.add(() => cold.dispose());
      const toaster = createToaster({ doc });
      lifecycle.add(() => toaster.dispose());
      showInCompass = (uid) => {
        const compass = globalThis.window?.RoamCompass;
        let available = false;
        try { available = compass?.isAvailable?.() === true; } catch (error) { console.warn("[plexus] compass unavailable", error); }
        if (!available) return void toaster.show("Compass is not loaded");
        compass.focus(uid);
      };
      const emitter = createEmitter();
      lifecycle.add(() => emitter.clear());
      const toolbar = createEditorToolbar({
        doc,
        onAreaRegion: () => actions.createAreaRegion(),
        onImageRegion: () => actions.createImageRegion(),
        onFrameRegion: () => actions.createFrameRegion(),
        canFrame: () => actions.isFrameSelected(),
        onCropRegion: () => actions.regionFromCrop(),
        canCrop: () => actions.hasCroppedImageSelected(),
        onEmbed: () => actions.insertEmbedFromClipboard(),
        onEmbedPicker: () => openPicker(),
        onNote: () => mounted?.noteTool?.arm(),
        onPresent: () => actions.presentDrawing(),
        canPresent: () => actions.hasFrames(),
        onAddFrame: (preset) => actions.addFrame({ preset: presetOf(preset) }),
        onReformatFrame: (preset) => actions.reformatFrame({ preset: presetOf(preset) }),
        canReformat: () => !!actions.selectedFrameId(),
        onMakeSlide: () => actions.makeSlide(),
        onLayout: (kind, preset) => actions.addFrameLayout({ kind: LAYOUT_KINDS[kind] ?? kind, preset: presetOf(preset) }),
        onMindMap: () => actions.startMindMap().catch((error) => console.warn("[plexus] mind map failed", error)),
        onEditEmbed: () => actions.editEmbed(),
        canEditEmbed: () => actions.canEditEmbed(),
        onToggleRegions: () => toggleRegionsLayer(),
        regionsVisible: () => !!mounted?.layer?.visible(),
        onToggleDock: () => toggleDock(),
        dockOpen: () => !!mounted?.dock?.isOpen(),
        dockInset: () => {
          const dock = mounted?.dock;
          return dock?.isOpen() && dock.mode() === "overlay" ? dock.el.getBoundingClientRect().width : 0;
        },
        onBack: () => goBack(),
        canBack: () => (mounted?.history?.size() ?? 0) > 0,
      });
      lifecycle.add(() => toolbar.dispose());
      const guard = createWriteGuard({
        toaster,
        isActive: (app, uid) => {
          const editor = native.activeEditor(doc);
          return editor?.app === app && editor.drawingUid === uid;
        },
      });
      lifecycle.add(() => guard.dispose());
      const measurer = createMeasurer({ doc });
      // The snapshot store is created before the unmount lifecycle entry, so its dispose runs after the final unmount put.
      const snapshotStore = createSnapshotStore({
        idb: doc.defaultView?.indexedDB ?? globalThis.indexedDB,
        keyRange: doc.defaultView?.IDBKeyRange ?? globalThis.IDBKeyRange,
        graphName: host.graphName(),
        isEncrypted: host.isEncrypted(),
      });
      lifecycle.add(() => snapshotStore.dispose());
      let mounted = null;
      const scenes = createSceneRegistry({
        native,
        doc,
        guard,
        measure: measurer.measure,
        beforeBulk: (app, uid, label) => { if (mounted?.app === app && mounted.uid === uid) mounted.scheduler?.snapshotNow(label); },
      });
      lifecycle.add(() => scenes.dispose());
      mountedApp = () => mounted?.app ?? null;
      let layerOn = false;
      const toggleRegionsLayer = () => {
        layerOn = !layerOn;
        const layer = mounted?.layer;
        if (layer) { if (layerOn) layer.show(); else layer.hide(); }
        toolbar.refresh();
        return layerOn;
      };
      // The dock is remembered like layerOn: a new mount reopens it, the close button clears it, unmount keeps it.
      let dockOn = false;
      const placeToolbar = () => { toolbar.refresh(); toolbar.place(); later(() => toolbar.place(), DOCK_SETTLE_MS); };
      const openDock = () => {
        const current = mounted;
        if (!current?.uid || !current.outer || current.dock?.isOpen()) return null;
        const dock = createDock({
          doc, api, app: current.app, containerEl: current.el, outerEl: current.outer, drawingUid: current.uid, zIndex: current.z,
          width: getSettings().dockWidth,
          onWidth: (w) => { writeSetting(extensionAPI, SETTING_IDS.dockWidth, String(w)); placeToolbar(); },
          onClose: () => {
            if (current.dock === dock) current.dock = null;
            dockOn = false;
            placeToolbar();
          },
          parentOf: (uid) => host.parentOf(uid),
          onNavigate: ({ target, sidebar } = {}) => {
            if (!navigateToTarget({ api, containerEl: current.el, target, sidebar: !!sidebar })) return;
            if (!sidebar) navigatedAt = Date.now();
            hover.hide();
            if (sidebar) toaster.show("Opened in sidebar");
          },
          addBlock: (rootUid) => actions.addOutlineBlock(rootUid),
          toast: (message) => toaster.show(message, { kind: "error" }),
        });
        current.dock = dock;
        dockOn = true;
        placeToolbar();
        return dock;
      };
      const toggleDock = () => {
        const dock = mounted?.dock;
        if (dock?.isOpen()) { dock.close(); return false; }
        return !!openDock();
      };
      const goBack = async () => {
        const current = mounted;
        if (!current?.history) return false;
        return current.history.back(current.app, { animate: motionOk(doc, getSettings().animation), doc });
      };
      let regionref = null;
      const zIndexFor = (el) => {
        const outer = el?.closest?.(".excalidraw-outer-container");
        if (outer) return baseZIndex(doc, outer);
        const z = Number.parseInt(doc.defaultView?.getComputedStyle?.(el)?.zIndex, 10);
        return Number.isFinite(z) ? z : 1000;
      };
      commandZ = () => { const editor = native.activeEditor(doc); return editor ? zIndexFor(editor.el) : 0; };
      const presenter = createPresenter({ doc, api, host });
      lifecycle.add(() => presenter.dispose());
      const mmWriter = createMmWriter({ api, graph: host.graphName() });
      const createLaneRegions = createLaneRegionMaker({ host, emit: (detail) => emitter.emit(detail) });
      const mindmap = createMindMap({ doc, api, writer: mmWriter, measurer, native, toaster, guardedWrite: guard.guardedWrite, getTagColors: () => getSettings().mmTagColors, zIndexFor: (outer) => (outer ? baseZIndex(doc, outer) : 1000), createLaneRegions });
      lifecycle.add(() => mindmap.dispose());
      actions = createActions({
        host,
        native,
        cache,
        cold,
        toaster,
        spotlight: showSpotlight,
        getSettings,
        doc,
        api,
        emit: (detail) => emitter.emit(detail),
        clipboard: globalThis.navigator?.clipboard,
        openPrompt: openCaptionPrompt,
        presenter,
        mindmap,
        getEmbedOverlay: () => mounted?.overlay ?? null,
        measure: measurer.measure,
        ensureFonts: measurer.ensureFonts,
        refreshRegion: (uid, opts) => regionref?.refreshRegion(uid, opts),
        guard,
        camera,
        motionOk,
        viewHistory: (app) => (mounted?.app === app ? mounted.history : null),
      });
      lifecycle.add(() => actions.dispose());
      const templates = createTemplateActions({
        doc, host, native, api, toaster,
        guardedWrite: guard.guardedWrite,
        beforeBulk: (app, uid, label) => scenes.beforeBulk(app, uid, label),
        measure: scenes.measure,
        openDrawing: (uid, opts) => actions.openDrawing(uid, opts),
        newDrawing: (opts) => actions.newDrawing(opts),
        thumbnail: (uid, opts) => actions.thumbnail(uid, opts),
        zIndexFor: (editor) => (editor ? zIndexFor(editor.el) + 2 : 1000),
      });
      lifecycle.add(() => templates.dispose());
      const arrange = createArrangeActions({ doc, native, toaster, guardedWrite: guard.guardedWrite, beforeBulk: (app, uid, label) => scenes.beforeBulk(app, uid, label) });
      lifecycle.add(installCanvasPaste({
        win: doc.defaultView,
        doc,
        toast: (message) => toaster.show(message),
        blockUid: (node) => host.blockUidFromNode(node),
        createSibling: async ({ uid, strings }) => {
          const info = host.blockInfo(uid);
          if (!info?.parentUid) { toaster.show("Could not add the remaining lines", { kind: "error" }); return; }
          for (let i = 0; i < strings.length; i += 1) {
            await host.createBlock({ parentUid: info.parentUid, order: info.order + 1 + i, string: strings[i] });
          }
        },
      }));

      const timers = new Set();
      let closed = false;
      lifecycle.add(() => { closed = true; for (const t of timers) clearTimeout(t); timers.clear(); });
      const later = (fn, ms) => {
        const t = setTimeout(() => { timers.delete(t); try { fn(); } catch (error) { console.warn("[plexus] timer failed", error); } }, ms);
        timers.add(t);
      };
      const sceneAt = (app, point) => (point ? viewportToScene({ x: point.x, y: point.y, appState: app.state }) : undefined);
      const refocus = (el) => { try { el?.focus?.({ preventScroll: true }); } catch { /* focus is best effort */ } };
      let pickerHandle = null;
      lifecycle.add(() => { pickerHandle?.close?.(); pickerHandle = null; });
      const openPicker = async (point) => {
        try {
          const editor = native.activeEditor(doc);
          if (!editor) return void toaster.show("Open a drawing first", { kind: "error" });
          const { app, el } = editor;
          let semantic = false;
          try { semantic = (await api.data?.semanticSearchEnabled?.()) === true; } catch { semantic = false; }
          if (closed || native.activeEditor(doc)?.app !== app) return;
          const rect = el.getBoundingClientRect?.() ?? { left: 100, top: 100, width: 0 };
          const anchorRect = point ? { left: point.x, top: point.y, bottom: point.y } : { left: rect.left + Math.max(0, (rect.width - 400) / 2), top: rect.top + 80, bottom: rect.top + 80 };
          const scenePoint = sceneAt(app, point);
          const finish = (out) => Promise.resolve(out).catch((error) => console.warn("[plexus] embed pick failed", error)).then(() => refocus(el));
          pickerHandle = openEmbedPicker({
            doc, api, anchorRect, zIndex: zIndexFor(el), semantic,
            onPick: ({ ref }) => finish(actions.embedFromPick({ ref, scenePoint, app })),
            onCreate: (title) => finish(actions.createPageAndEmbed(title, scenePoint, { app })),
            onClose: ({ picked }) => { if (!picked && (doc.activeElement == null || doc.activeElement === doc.body)) refocus(el); },
          });
        } catch (error) { console.warn("[plexus] embed picker failed", error); }
      };
      // Shift+Enter in a text edit: read the text box now, drop the embed just below it once Excalidraw has committed.
      const onEmbedPick = ({ ref, title, create }) => {
        const editor = native.activeEditor(doc);
        if (!editor) return;
        const { app, el } = editor;
        const text = app.state?.editingTextElement;
        if (!text) return;
        const elements = app.getSceneElementsIncludingDeleted?.() ?? [];
        const box = (text.containerId && elements.find((e) => e.id === text.containerId)) || text;
        const scenePoint = { x: (box.x ?? 0) + (box.width ?? 0) / 2, y: (box.y ?? 0) + (box.height ?? 0) + 124 };
        const started = Date.now();
        const run = () => {
          if (closed) return;
          if (app.state?.editingTextElement && Date.now() - started < 500) return later(run, 25);
          const out = create ? actions.createPageAndEmbed(title, scenePoint, { app }) : actions.embedFromPick({ ref, scenePoint, app });
          Promise.resolve(out).catch((error) => console.warn("[plexus] embed pick failed", error)).then(() => refocus(el));
        };
        later(run, 25);
      };
      const createPage = (title) => Promise.resolve().then(() => host.ensurePage(title)).catch((error) => {
        console.warn("[plexus] create page failed", error);
        toaster.show("Could not create the page", { kind: "error" });
      });
      const runAction = (name) => () => actions[name]();
      hotkeyHandlers.region = runAction("createAreaRegion");
      hotkeyHandlers.image = runAction("createImageRegion");
      hotkeyHandlers.present = runAction("presentDrawing");
      hotkeyHandlers.mindmap = () => (mounted
        ? actions.startMindMap()
        : actions.mindMapFromOutline(api.ui?.getFocusedBlock?.()?.["block-uid"]));
      hotkeyHandlers.embed = () => openPicker();
      hotkeyHandlers.dock = () => {
        if (!mounted?.uid) return void toaster.show("Open a drawing first", { kind: "error" });
        toggleDock();
      };
      showDockParent = () => {
        if (!mounted?.uid) return void toaster.show("Open a drawing first", { kind: "error" });
        const parent = host.parentOf(mounted.uid);
        if (!parent || parent.isPage) return void toaster.show("This drawing sits directly on its page", { kind: "error" });
        const dock = mounted.dock?.isOpen() ? mounted.dock : openDock();
        void Promise.resolve(dock?.setRoot("parent")).catch((error) => console.warn("[plexus] dock parent failed", error));
      };
      hotkeyHandlers.note = () => {
        if (!mounted?.noteTool) return void toaster.show("Open a drawing first", { kind: "error" });
        mounted.noteTool.arm();
      };

      // Phase 12 dialogs and their commands. Each handle is closed on editor unmount and on unload.
      const mac = /mac|iphone|ipad/i.test(String(doc.defaultView?.navigator?.platform ?? ""));
      const outline = createOutlineActions({ host, native, api, toaster, clipboard: globalThis.navigator?.clipboard, doc });
      lifecycle.add(() => outline.dispose());
      let restoreHandle = null;
      let chartHandle = null;
      const closeDialogs = () => {
        for (const handle of [restoreHandle, chartHandle]) {
          try { handle?.close?.(); } catch (error) { console.warn("[plexus] dialog close failed", error); }
        }
        restoreHandle = null;
        chartHandle = null;
        try { outline.closePreview(); } catch (error) { console.warn("[plexus] outline preview close failed", error); }
        try { templates.closeDialogs(); } catch (error) { console.warn("[plexus] template dialogs close failed", error); }
      };
      lifecycle.add(closeDialogs);
      const openEditor = () => {
        const editor = native.activeEditor(doc);
        if (!editor?.drawingUid) { toaster.show("Open a drawing full-screen first", { kind: "error" }); return null; }
        return editor;
      };
      const restoreEntry = async (editor, entry) => {
        const { app, drawingUid } = editor;
        const live = () => native.activeEditor(doc)?.app === app && native.activeEditor(doc)?.drawingUid === drawingUid;
        const st = app.state ?? {};
        if (st.editingTextElement || st.newElement || st.cursorButton === "down") return void toaster.show("Finish the current edit first", { kind: "error" });
        const scheduler = mounted?.app === app ? mounted.scheduler : null;
        if (entry.kind === "session") {
          scheduler?.snapshotNow("before restore");
          guard.restoreTo(app, drawingUid, entry.id !== undefined ? { id: entry.id } : entry.index);
          return;
        }
        const snapshot = await snapshotStore.get(entry.key);
        if (!snapshot) return void toaster.show("That version could not be read", { kind: "error" });
        if (!live()) return void toaster.show("Drawing is no longer open", { kind: "error" });
        scheduler?.snapshotNow("before restore");
        const plan = planRestore({ current: app.getSceneElementsIncludingDeleted?.() ?? [], snapshot, files: app.files ?? app.getFiles?.() });
        const ok = guard.guardedWrite(app, {
          drawingUid, label: "Restore", next: plan.next, captureUpdate: "IMMEDIATELY", force: true,
          appState: { selectedElementIds: {}, selectedGroupIds: {} },
        });
        if (!ok) return void toaster.show("Could not restore the drawing", { kind: "error" });
        toaster.show(`Restored \u00b7 ${mac ? "Cmd" : "Ctrl"}+Z brings the current version back${plan.missingFiles ? ` \u00b7 ${plan.missingFiles} images missing` : ""}`);
      };
      const restoreDialog = () => {
        const editor = openEditor();
        if (!editor) return null;
        closeDialogs();
        restoreHandle = openRestoreDialog({
          doc, zIndex: zIndexFor(editor.el), mac,
          session: guard.list(editor.drawingUid),
          loadSaved: () => (snapshotStore.isEnabled() ? snapshotStore.list(editor.drawingUid) : Promise.resolve(host.isEncrypted() ? { encrypted: true } : [])),
          onRestore: (entry) => restoreEntry(editor, entry).catch((error) => {
            console.warn("[plexus] restore failed", error);
            toaster.show("Could not restore the drawing", { kind: "error" });
          }),
          onClose: () => { restoreHandle = null; refocus(editor.el); },
        });
        return restoreHandle;
      };
      const chartDialog = () => {
        const editor = openEditor();
        if (!editor) return null;
        closeDialogs();
        const { drawingUid } = editor;
        chartHandle = openChartDialog({
          doc, zIndex: zIndexFor(editor.el),
          onInsert: ({ text, layout }) => {
            const scene = scenes.sceneOf(drawingUid);
            if (!scene) throw new Error("Drawing is not open");
            const out = scene.addChart(text, { layout });
            toaster.show(`Chart inserted \u00b7 ${out.ids.length} elements${out.skipped ? ` \u00b7 ${out.skipped} skipped` : ""}`);
          },
          onClose: () => { chartHandle = null; refocus(editor.el); },
        });
        return chartHandle;
      };
      const outlineTarget = (ctx) => native.activeEditor(doc)?.drawingUid ?? ctx?.focusedUid ?? null;
      const withTarget = (ctx, fn) => {
        const uid = outlineTarget(ctx);
        if (!uid) return void toaster.show("Open a drawing full-screen first", { kind: "error" });
        return Promise.resolve(fn(uid)).catch((error) => console.warn("[plexus] outline failed", error));
      };
      const mmEditor = () => {
        const editor = openEditor();
        if (!editor) return null;
        if (!mindmap.mapOptions(editor.app)) { toaster.show("Select a mind-map node first", { kind: "error" }); return null; }
        return editor;
      };
      tools = {
        restore: restoreDialog,
        chart: chartDialog,
        outline: (ctx) => withTarget(ctx, (uid) => outline.drawingToOutline(uid, { selection: !!native.activeEditor(doc) && native.selectedElementIds(native.activeEditor(doc).app).length > 0 })),
        copyMarkdown: (ctx) => withTarget(ctx, (uid) => outline.copyMarkdown(uid, { selection: !!native.activeEditor(doc) && native.selectedElementIds(native.activeEditor(doc).app).length > 0 })),
        insertTemplate: () => templates.insertTemplate(),
        newFromTemplate: (ctx) => templates.newFromTemplate(ctx),
        saveTemplate: () => templates.saveSelectionAsTemplate(),
        setLayout: (layout) => { const editor = mmEditor(); return editor ? mindmap.setLayout(editor.app, layout) : false; },
        toggleAttrEdges: () => {
          const editor = mmEditor();
          if (!editor) return false;
          return mindmap.setAttrEdges(editor.app, !mindmap.mapOptions(editor.app).attrEdges);
        },
      };

      const publicApi = createPublicApi({ host, actions, emitter, version: extension?.version || "development", scenes, measure: measurer.measure, openDrawing: (uid, opts) => actions.openDrawing(uid, opts) });
      installPublicApi(publicApi, { win: flagTarget });
      lifecycle.add(() => uninstallPublicApi(publicApi, { win: flagTarget }));

      lifecycle.add(installRegionLanding({
        doc,
        api,
        host,
        getSettings,
        openRegion: (uid) => actions.openRegion(uid).catch((error) => console.warn("[plexus] open failed", error)),
      }));
      const labelOf = (region) => {
        try {
          const src = host.labelSource?.(region.drawingUid) ?? { string: "", pageTitle: null };
          return regionLabel({
            kind: region.kind,
            caption: region.caption ?? "",
            drawingTitle: drawingTitleOf(src.string, src.pageTitle),
            imageAlt: isImageKind(region.kind) ? imageAltAt(src.string, region.i) : null,
            resolveBlock: (u) => host.labelSource?.(u)?.string ?? "",
          });
        } catch { return "Region"; }
      };
      let auditHandle = null;
      lifecycle.add(() => auditHandle?.close?.());
      const openAudit = async (scope) => {
        const rows = await actions.auditRegions({ scope });
        if (!rows) return;
        const previous = auditHandle;
        auditHandle = openAuditDialog({
          doc,
          rows,
          dark: isHostDark(doc),
          onOpen: (row) => {
            const target = auditOpenTarget(row);
            return target.via === "region" ? actions.openRegion(target.uid) : host.openBlock(target.uid);
          },
          onRepair: (row) => actions.repairRegion(row.uid),
        });
        previous?.close?.();
      };
      audit = openAudit;
      toggleLayer = toggleRegionsLayer;
      backCommand = goBack;

      regionref = createRegionRefRenderer({
        host,
        cache,
        cold,
        getSettings,
        doc,
        onOpen: (uid, opts) => actions.openRegion(uid, opts).catch((error) => console.warn("[plexus] open failed", error)),
      });
      lifecycle.add(() => regionref.releaseAll());
      refreshAll = () => regionref.refreshAll();
      const ThemeMO = doc.defaultView?.MutationObserver ?? globalThis.MutationObserver;
      if (ThemeMO && doc.documentElement && doc.body) {
        let wasDark = isHostDark(doc);
        const themeObserver = new ThemeMO(() => {
          try {
            resetThemeMemo();
            const now = isHostDark(doc);
            if (mounted?.dock?.isOpen()) mounted.dock.refreshTheme();
            if (now !== wasDark) { wasDark = now; scheduleRefresh(); }
          } catch (error) { console.warn("[plexus] theme observer failed", error); }
        });
        lifecycle.observer(themeObserver, doc.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
        themeObserver.observe(doc.body, { attributes: true, attributeFilter: ["class", "style"] });
      }
      let settingsHandle = null;
      lifecycle.add(() => settingsHandle?.close());
      openSettings = () => (settingsHandle = openSettingsDialog({
        doc,
        get: (id) => extensionAPI.settings.get(id),
        set: (id, value) => writeSetting(extensionAPI, id, value),
        onChanged: () => regionref.refreshAll(),
        dark: isHostDark(doc),
      }));
      lifecycle.add(installRoamMenus({
        api,
        host,
        actions,
        regionref,
        getSettings,
        setRefOverride: (blockUid, refUid, patch) => setRefOverride(extensionAPI, blockUid, refUid, patch),
        openSettings,
        showInCompass,
        openPrompt: openCaptionPrompt,
        isEncrypted: () => host.isEncrypted(),
        native,
        hasEditor: () => !!native.activeEditor(doc),
        doc,
      }));
      const suggest = createLinkSuggest({ doc, api, zIndexFor, createPage, onEmbedPick });
      lifecycle.add(() => suggest.dispose());
      lifecycle.add(installSuggestAutoAttach({ doc, suggest }));
      const hover = createHoverPreview({ doc, api });
      lifecycle.add(() => hover.dispose());
      // Compass reads thumbnails cache-only, so warm them once a visit ends (after Roam has saved the scene).
      const thumbTimers = new Set();
      let thumbsOff = false;
      lifecycle.add(() => { thumbsOff = true; for (const t of thumbTimers) clearTimeout(t); thumbTimers.clear(); });
      lifecycle.add(clearImageMemo);
      const warmThumbnails = (uid) => {
        if (thumbsOff) return;
        const timer = setTimeout(async () => {
          thumbTimers.delete(timer);
          for (const maxWidth of THUMB_WIDTHS) {
            if (thumbsOff) return;
            try { await actions.thumbnail(uid, { maxWidth, render: true }); } catch (error) { console.warn("[plexus] thumbnail warm failed", error); }
          }
        }, THUMB_WARM_DELAY_MS);
        thumbTimers.add(timer);
      };
      // Link interception and hover preview live only while an editor is mounted.
      let navigatedAt = -Infinity;
      let focusVeil = null;
      let focusIndex = -1;
      let todoVeil = null;
      const FOCUS_DEPTHS = [1, 2, 3, "all"];
      const sceneElements = (app) => {
        const list = app?.getSceneElementsIncludingDeleted?.();
        return Array.isArray(list) ? list : [];
      };
      const indexScene = (elements) => {
        const byId = new Map();
        for (const el of elements) {
          if (el && typeof el.id === "string" && !byId.has(el.id)) byId.set(el.id, el);
        }
        return byId;
      };
      const viewOrigin = (app) => {
        const st = app?.state || {};
        return viewportToScene({
          x: (st.offsetLeft || 0) + (st.width || 0) / 2,
          y: (st.offsetTop || 0) + (st.height || 0) / 2,
          appState: st,
        });
      };
      const holesFor = (app, ids) => {
        const byId = indexScene(sceneElements(app));
        const holes = [];
        for (const id of ids) {
          const el = byId.get(id);
          if (!el || el.isDeleted) continue;
          try {
            const rect = native.viewportRectOf(app, elementBounds(el));
            if (rect) holes.push(rect);
          } catch (error) { console.warn("[plexus] veil rect failed", error); }
        }
        return holes;
      };
      const subscribeViewport = (app, place) => {
        try { return native.subscribeViewport(app, place); }
        catch (error) { console.warn("[plexus] veil subscribe failed", error); return () => {}; }
      };
      function openVeil(show) {
        let alive = true;
        const orig = typeof doc.createElement === "function" ? doc.createElement : null;
        if (orig) {
          doc.createElement = (...args) => {
            const el = orig.apply(doc, args);
            if (el && typeof el.remove === "function") {
              const base = el.remove.bind(el);
              el.remove = () => { alive = false; base(); };
            }
            return el;
          };
        }
        try {
          const off = show();
          const close = typeof off === "function" ? off : () => {};
          return {
            get alive() { return alive; },
            close() {
              alive = false;
              try { close(); } catch (error) { console.warn("[plexus] veil close failed", error); }
            },
          };
        } finally {
          if (orig) {
            try { doc.createElement = orig; } catch (error) { console.warn("[plexus] veil restore failed", error); }
          }
        }
      }
      function endFocus() {
        focusIndex = -1;
        const cur = focusVeil;
        focusVeil = null;
        cur?.close();
      }
      function endTodo() {
        const cur = todoVeil;
        todoVeil = null;
        cur?.close();
      }
      function todoText(el) {
        const parsed = parseEmbedRef(el?.customData?.plexus?.embed);
        if (parsed?.kind === "block") {
          try {
            const block = host.pullBlock(parsed.uid);
            return typeof block?.string === "string" ? block.string : "";
          } catch (error) {
            console.warn("[plexus] todo text failed", error);
            return "";
          }
        }
        if (typeof el?.text === "string") return el.text;
        if (typeof el?.originalText === "string") return el.originalText;
        return "";
      }
      function cardUid(el) {
        if (!el || el.isDeleted) return "";
        const mm = el.customData?.plexus?.mm;
        if (mm && typeof mm === "object") {
          if (mm.edge || mm.boundary) return "";
          if (typeof mm.uid === "string" && mm.uid) return mm.uid;
        }
        const embed = parseEmbedRef(el.customData?.plexus?.embed);
        if (embed?.kind === "block" && embed.uid) return embed.uid;
        const link = parseEmbedRef(el.link);
        if (link?.kind === "block" && link.uid) return link.uid;
        return "";
      }
      function refUid(el, byId) {
        const own = cardUid(el);
        if (own) return own;
        const parent = el?.containerId ? byId.get(el.containerId) : null;
        return parent ? cardUid(parent) : "";
      }
      function relationStrings(uid) {
        let block = null;
        try { block = host.pullBlock(uid); } catch (error) { console.warn("[plexus] relation pull failed", error); }
        const strings = [];
        if (typeof block?.string === "string") strings.push(block.string);
        const children = Array.isArray(block?.children) ? block.children : [];
        for (const child of children) {
          if (typeof child?.string !== "string") continue;
          strings.push(child.string);
          if (child.string.trim() !== "relates to::" || !child.uid) continue;
          let attr = null;
          try { attr = host.pullBlock(child.uid); } catch (error) { console.warn("[plexus] relation pull failed", error); }
          const grands = Array.isArray(attr?.children) ? attr.children : [];
          for (const grand of grands) if (typeof grand?.string === "string") strings.push(grand.string);
        }
        return strings;
      }
      function tagIn(text) {
        const m = /#\[\[([^\]\n]+)\]\]|\[\[([^\]\n]+)\]\]|#([^\s#\[\](){}]+)/.exec(String(text ?? ""));
        if (!m) return "";
        return (m[1] || m[2] || m[3] || "").trim();
      }
      const focusedUid = (ctx) => ctx?.focusedUid || api.ui?.getFocusedBlock?.()?.["block-uid"] || "";
      function placeCards(app, drawingUid, cards, label) {
        if (!Array.isArray(cards) || cards.length === 0) return void toaster.show("Nothing new to place");
        const ok = guard.guardedWrite(app, {
          drawingUid,
          label,
          captureUpdate: "IMMEDIATELY",
          next: (current) => [...(Array.isArray(current) ? current : []), ...cards],
        });
        if (!ok) toaster.show("Could not place the cards", { kind: "error" });
      }
      runFocusMode = () => {
        if (typeof showFocusVeil !== "function" || typeof focusKeptIds !== "function") return void toaster.show("Focus mode is unavailable");
        const editor = native.activeEditor(doc);
        if (!editor?.app) return void toaster.show("Open a drawing first", { kind: "error" });
        if (!native.selectedElementIds(editor.app).length) return void toaster.show("Select some elements first", { kind: "error" });
        endTodo();
        const next = focusVeil?.alive === true ? focusIndex + 1 : 0;
        endFocus();
        if (next >= FOCUS_DEPTHS.length) return;
        const depth = FOCUS_DEPTHS[next];
        const app = editor.app;
        let veil = null;
        try {
          veil = openVeil(() => showFocusVeil({
            doc,
            getHoles: () => holesFor(app, focusKeptIds(sceneElements(app), native.selectedElementIds(app), depth)),
            subscribe: (place) => subscribeViewport(app, place),
          }));
        } catch (error) {
          console.warn("[plexus] focus mode failed", error);
          toaster.show("Focus mode is unavailable");
          return;
        }
        focusIndex = next;
        focusVeil = veil;
      };
      runTodoMode = () => {
        if (typeof showTodoVeil !== "function" || typeof todoKeptIds !== "function") return void toaster.show("Todo mode is unavailable");
        const editor = native.activeEditor(doc);
        if (!editor?.app) return void toaster.show("Open a drawing first", { kind: "error" });
        endFocus();
        endTodo();
        const app = editor.app;
        try {
          todoVeil = openVeil(() => showTodoVeil({
            doc,
            elements: sceneElements(app),
            textOf: todoText,
            rectOf: (id) => {
              const el = indexScene(sceneElements(app)).get(id);
              if (!el || el.isDeleted) return null;
              try { return native.viewportRectOf(app, elementBounds(el)); }
              catch (error) { console.warn("[plexus] veil rect failed", error); return null; }
            },
            subscribe: (place) => subscribeViewport(app, place),
          }));
        } catch (error) {
          console.warn("[plexus] todo mode failed", error);
          toaster.show("Todo mode is unavailable");
        }
      };
      runEmbedQuery = async (ctx) => {
        if (typeof cardsFromQuery !== "function") return void toaster.show("Embed query results is unavailable");
        const editor = native.activeEditor(doc);
        if (!editor?.app) return void toaster.show("Open a drawing first", { kind: "error" });
        const sourceUid = focusedUid(ctx);
        if (!sourceUid) return void toaster.show("Click into a block first", { kind: "error" });
        const app = editor.app;
        let cards = [];
        try {
          cards = await cardsFromQuery({ api, sourceUid, existing: sceneElements(app), origin: viewOrigin(app) });
        } catch (error) {
          console.warn("[plexus] embed query failed", error);
          toaster.show("Could not place the cards", { kind: "error" });
          return;
        }
        if (native.activeEditor(doc)?.app !== app) return void toaster.show("Drawing is no longer open", { kind: "error" });
        placeCards(app, editor.drawingUid, cards, "Embed query results");
      };
      runEmbedChildren = (ctx) => {
        if (typeof cardsFromChildren !== "function") return void toaster.show("Embed page children is unavailable");
        const editor = native.activeEditor(doc);
        if (!editor?.app) return void toaster.show("Open a drawing first", { kind: "error" });
        const uid = focusedUid(ctx);
        if (!uid) return void toaster.show("Click into a block first", { kind: "error" });
        const pageUid = host.blockInfo(uid)?.pageUid;
        if (!pageUid) return void toaster.show("Could not find that page", { kind: "error" });
        let children = [];
        try { children = host.pullBlock(pageUid)?.children ?? []; }
        catch (error) {
          console.warn("[plexus] embed children failed", error);
          toaster.show("Could not place the cards", { kind: "error" });
          return;
        }
        let cards = [];
        try { cards = cardsFromChildren({ children, sourceUid: pageUid, existing: sceneElements(editor.app), origin: viewOrigin(editor.app) }); }
        catch (error) {
          console.warn("[plexus] embed children failed", error);
          toaster.show("Could not place the cards", { kind: "error" });
          return;
        }
        placeCards(editor.app, editor.drawingUid, cards, "Embed page children");
      };
      runLinkSelected = async () => {
        if (typeof relationPlan !== "function" || typeof withLock !== "function" || typeof lockName !== "function") {
          toaster.show("Link selected is unavailable");
          return;
        }
        const editor = native.activeEditor(doc);
        if (!editor?.app) return void toaster.show("Open a drawing first", { kind: "error" });
        const byId = indexScene(sceneElements(editor.app));
        const selected = native.selectedElementIds(editor.app).map((id) => byId.get(id)).filter((el) => el && !el.isDeleted);
        const arrow = selected.find((el) => el.type === "arrow" && el.startBinding?.elementId && el.endBinding?.elementId);
        let sourceUid = "";
        let destUid = "";
        if (arrow) {
          sourceUid = refUid(byId.get(arrow.startBinding.elementId), byId);
          destUid = refUid(byId.get(arrow.endBinding.elementId), byId);
        } else {
          const ids = [];
          for (const el of selected) {
            const uid = refUid(el, byId);
            if (!uid || ids.includes(uid)) continue;
            ids.push(uid);
            if (ids.length === 2) break;
          }
          sourceUid = ids[0] || "";
          destUid = ids[1] || "";
        }
        if (!sourceUid || !destUid) return void toaster.show("Select two cards, or an arrow between them", { kind: "error" });
        const plan = relationPlan({ sourceUid, destUid, strings: relationStrings(sourceUid) });
        if (!plan) return void toaster.show("Already linked");
        try {
          const held = await withLock(lockName(host.graphName(), sourceUid), async () => {
            const attrUid = await host.createBlock({ parentUid: plan.parentUid, order: "last", string: plan.attribute });
            try {
              const childUid = await host.createBlock({ parentUid: attrUid, order: "last", string: plan.child });
              return { attrUid, childUid };
            } catch (error) {
              try { await host.deleteBlock(attrUid); } catch (cleanup) { console.warn("[plexus] link cleanup failed", cleanup); }
              throw error;
            }
          });
          if (!held?.acquired || !held.value) return void toaster.show("Could not link those cards", { kind: "error" });
          const { attrUid, childUid } = held.value;
          toaster.show("Linked", {
            action: {
              label: "Undo",
              run: () => {
                void (async () => {
                  try { await host.deleteBlock(childUid); } catch (error) { console.warn("[plexus] undo link failed", error); }
                  try { await host.deleteBlock(attrUid); } catch (error) { console.warn("[plexus] undo link failed", error); }
                })();
              },
            },
          });
        } catch (error) {
          console.warn("[plexus] link selected failed", error);
          toaster.show("Could not link those cards", { kind: "error" });
        }
      };
      runLockAction = (name) => {
        const app = mountedApp?.();
        if (!app) return void toaster.show("Open a drawing full-screen first", { kind: "error" });
        if (!runNamedAction(app, name)) toaster.show("That action is not in this Excalidraw build", { kind: "error" });
      };
      runDiagnostics = async () => {
        const app = mountedApp?.();
        const prefs = getSettings();
        const names = LOCK_ACTION_NAMES.filter((name) => app?.actionManager?.actions?.[name]);
        const text = diagnosticsText({
          version: extension?.version || "development",
          generation: generationState.generation,
          themeFollow: prefs.themeFollow,
          fitOnOpen: prefs.fitOnOpen,
          editorOpen: !!app,
          lockActions: names,
        });
        const how = await copyText(text, { clipboard: globalThis.navigator?.clipboard, doc });
        toaster.show(how === "none" ? "Could not copy diagnostics" : "Diagnostics copied", { kind: how === "none" ? "error" : undefined });
      };
      runFilterTag = (ctx) => {
        const uid = focusedUid(ctx);
        if (!uid) return void toaster.show("Click into a block first", { kind: "error" });
        const setTagFilter = mounted?.layer?.setTagFilter;
        if (typeof setTagFilter !== "function") return void toaster.show("Open a drawing first", { kind: "error" });
        let text = "";
        try { text = host.pullBlock(uid)?.string ?? ""; }
        catch (error) { console.warn("[plexus] tag filter failed", error); }
        const tag = tagIn(text);
        if (!tag) return void toaster.show("No tag in this block");
        try { setTagFilter(tag); }
        catch (error) {
          console.warn("[plexus] tag filter failed", error);
          toaster.show("Could not filter regions", { kind: "error" });
        }
      };
      const unmountEditor = ({ unloading = false } = {}) => {
        try { endFocus(); } catch (error) { console.warn("[plexus] focus veil failed", error); }
        try { endTodo(); } catch (error) { console.warn("[plexus] todo veil failed", error); }
        const current = mounted;
        mounted = null;
        closeDialogs();
        if (!current) return Promise.resolve();
        if (Date.now() - navigatedAt <= 2000) clearLinkTooltip(doc);
        const pending = [];
        for (const dispose of current.disposers) {
          try {
            const out = dispose();
            if (out && typeof out.then === "function") pending.push(out.catch((error) => console.warn("[plexus] editor cleanup failed", error)));
          } catch (error) { console.warn("[plexus] editor cleanup failed", error); }
        }
        if (current.app) scenes.release(current.app);
        actions.cancelDrawingTool();
        if (current.uid) {
          emitter.emit({ uid: current.uid, kind: "drawing" });
          warmThumbnails(current.uid);
          if (!unloading) {
            Promise.resolve(actions.refreshAfterClose(current.uid, current.hash)).catch((error) => console.warn("[plexus] refresh after close failed", error));
          }
        }
        return Promise.all(pending).then(() => undefined);
      };
      lifecycle.add(() => unmountEditor({ unloading: true }));
      const discovery = createDiscovery({
        root: doc.body,
        onRegionButton: (btn) => regionref.claim(btn),
        onAlias: (a) => regionref.claimAlias(a),
        onEditorMount: (el) => {
          const outer = el.closest(".excalidraw-outer-container");
          // show() replaces any previous bar. The unmount below clears the previous editor and must leave this bar up.
          if (outer) toolbar.show(outer);
          unmountEditor();
          const app = native.findApp(el);
          if (!app) return;
          const mountUid = host.blockUidFromNode(el);
          let mountHash = "";
          try { mountHash = (mountUid && host.drawing(mountUid)?.hash) || ""; } catch (error) { console.warn("[plexus] mount hash failed", error); }
          const history = camera.createViewHistory({ onChange: () => toolbar.refresh() });
          const mountZ = outer ? baseZIndex(doc, outer) : 1000;
          mounted = { uid: mountUid, app, el, outer, z: mountZ, disposers: [], overlay: null, hash: mountHash, history, layer: null, dock: null };
          try {
            const prefs = getSettings();
            const before = captureView(app);
            const box = {
              applied: applyCanvasPrefs(app, { themeFollow: prefs.themeFollow, hostDark: isHostDark(doc), fitOnOpen: false }),
            };
            box.after = captureView(app);
            const retry = setTimeout(() => {
              try {
                if (shouldReapplyTheme(before, captureView(app), box.applied)) {
                  const again = applyCanvasPrefs(app, { themeFollow: prefs.themeFollow, hostDark: isHostDark(doc), fitOnOpen: false });
                  if (again.theme) box.applied = { ...box.applied, theme: again.theme };
                }
                const landed = captureView(app);
                if (box.applied.fit && (landed.scrollX !== before.scrollX || landed.scrollY !== before.scrollY || landed.zoom !== before.zoom)) {
                  box.after = landed;
                } else if (box.applied.theme && landed.theme === box.applied.theme) {
                  box.after = landed;
                }
              } catch (error) { console.warn("[plexus] canvas prefs failed", error); }
            }, 400);
            mounted.disposers.push(() => clearTimeout(retry));
            const applied = box.applied;
            const after = () => box.after;
            if (outer && (applied.theme || applied.fit)) {
              const onClose = (event) => {
                const hit = event.target?.closest?.(".bp3-icon-minimize, .bp3-button");
                if (!hit || !outer.contains(hit)) return;
                const minimize = hit.classList?.contains("bp3-icon-minimize") || hit.querySelector?.(".bp3-icon-minimize");
                if (!minimize) return;
                try { restoreAutomaticView(app, { before, after: after(), applied: box.applied }); }
                catch (error) { console.warn("[plexus] canvas restore failed", error); }
              };
              outer.addEventListener("pointerdown", onClose, true);
              outer.addEventListener("mousedown", onClose, true);
              outer.addEventListener("click", onClose, true);
              mounted.disposers.push(() => {
                outer.removeEventListener("pointerdown", onClose, true);
                outer.removeEventListener("mousedown", onClose, true);
                outer.removeEventListener("click", onClose, true);
              });
            }
          } catch (error) { console.warn("[plexus] canvas prefs failed", error); }
          try {
            const off = app.onChangeEmitter?.on?.(() => toolbar.refresh());
            if (typeof off === "function") mounted.disposers.push(off);
          } catch (error) { console.warn("[plexus] toolbar refresh subscribe failed", error); }
          toolbar.refresh();
          mounted.disposers.push(hover.attach({ app, containerEl: el }));
          const overlay = createEmbedOverlay({
            doc, api, host, app, containerEl: el, zIndex: outer ? baseZIndex(doc, outer) : 1000,
            toast: (message) => toaster.show(message, { kind: "error" }),
            onStateChange: () => toolbar.refresh(),
            onLoaded: () => actions.scheduleEmbedLabels(app),
          });
          mounted.overlay = overlay;
          mounted.disposers.push(() => overlay.dispose());
          mounted.disposers.push(installEmbedF2({ containerEl: el, app, canEdit: () => actions.canEditEmbed(), onEdit: () => actions.editEmbed() }));
          mounted.disposers.push(mindmap.mount({ app, containerEl: el, outerEl: outer, zIndex: outer ? baseZIndex(doc, outer) : 1000, drawingUid: mountUid }));
          mounted.disposers.push(installBackKey({ containerEl: el, app, canBack: () => history.size() > 0, onBack: () => goBack() }));
          mounted.disposers.push(installHotkeyGuard({ containerEl: el, run: runHotkey, doc }));
          const refExists = (ref) => {
            const parsed = parseEmbedRef(ref);
            if (parsed?.kind === "block") return !!api.data.pull("[:db/id]", [":block/uid", parsed.uid]);
            if (parsed?.kind === "page") return !!api.data.pull("[:db/id]", [":node/title", parsed.title]);
            return false;
          };
          mounted.disposers.push(installRefPaste({
            doc, containerEl: el, app, getSettings, exists: refExists,
            onRef: ({ ref, scenePoint }) => {
              const out = getSettings().pasteRefs === "link"
                ? actions.placeBlocks([ref], { mode: "link", scenePoint, app })
                : actions.embedFromPick({ ref, scenePoint, app });
              Promise.resolve(out).catch((error) => console.warn("[plexus] ref paste failed", error));
            },
          }));
          const noteTool = installNoteTool({
            doc, containerEl: el, app,
            canArm: () => !!mountUid,
            onPlace: (scenePoint) => Promise.resolve(actions.newNoteCard(scenePoint)).catch((error) => console.warn("[plexus] note failed", error)),
          });
          mounted.noteTool = noteTool;
          mounted.disposers.push(() => noteTool.dispose());
          mounted.disposers.push(() => pickerHandle?.close?.());
          mounted.disposers.push(() => history.clear());
          let backlinks = null;
          if (mountUid && snapshotStore.isEnabled()) {
            const scheduler = createSnapshotScheduler({ store: snapshotStore, app, drawingUid: mountUid });
            mounted.scheduler = scheduler;
            mounted.disposers.push(() => scheduler.dispose({ final: true }));
          }
          if (mountUid) {
            const layer = createRegionsLayer({
              doc, app, containerEl: el, host, drawingUid: mountUid, native,
              zIndex: outer ? baseZIndex(doc, outer) : 1000,
              labelOf,
              debug: () => getSettings().debug,
              onSelect: (regionUid) => actions.selectRegionOnDrawing(regionUid),
              onOpenSidebar: (regionUid) => {
                Promise.resolve(host.openBlock(regionUid, { sidebar: true }))
                  .then(() => toaster.show("Opened in sidebar"))
                  .catch((error) => console.warn("[plexus] open in sidebar failed", error));
              },
            });
            mounted.layer = layer;
            mounted.disposers.push(() => { layer.dispose(); if (mounted?.layer === layer) mounted.layer = null; });
            if (layerOn) layer.show();
            let layerTimer = null;
            const onChange = (detail) => {
              if (detail?.kind !== "region") return;
              if (layerTimer != null) clearTimeout(layerTimer);
              layerTimer = setTimeout(() => {
                layerTimer = null;
                try { layer.refresh(); backlinks?.refresh(); } catch (error) { console.warn("[plexus] layer refresh failed", error); }
              }, LAYER_REFRESH_MS);
            };
            emitter.on("change", onChange);
            mounted.disposers.push(() => { emitter.off("change", onChange); if (layerTimer != null) clearTimeout(layerTimer); layerTimer = null; });
          }
          mounted.disposers.push(installRoamDrop({
            doc, containerEl: el, app, zIndex: mountZ,
            exclude: mountUid,
            resolve: (uid) => {
              const raw = api.data.pull("[:node/title :block/string]", [":block/uid", uid]);
              if (raw?.[":node/title"] != null) return { kind: "page", title: raw[":node/title"] };
              return raw?.[":block/string"] != null ? { kind: "block" } : null;
            },
            toast: (message) => toaster.show(message, { kind: "error" }),
            onDrop: ({ items, mode, scenePoint }) => {
              Promise.resolve(actions.placeBlocks(items, { mode, scenePoint, app }))
                .catch((error) => console.warn("[plexus] drop failed", error));
            },
          }));
          mounted.disposers.push(installTextLinks({
            doc, api, app, containerEl: el, zIndex: mountZ,
            toast: (message) => toaster.show(message, { kind: "error" }),
            navigate: ({ target, sidebar } = {}) => {
              if (!navigateToTarget({ api, containerEl: el, target, sidebar: !!sidebar })) return;
              if (!sidebar) navigatedAt = Date.now();
              hover.hide();
              if (sidebar) toaster.show("Opened in sidebar");
            },
          }));
          // unmountEditor nulls `mounted` before it runs the disposers, so close over this mount's own record.
          const own = mounted;
          mounted.disposers.push(() => {
            const dock = own.dock;
            if (!dock) return undefined;
            own.dock = null;
            return dock.dispose();
          });
          if (dockOn && mountUid) {
            try { openDock(); } catch (error) { console.warn("[plexus] dock open failed", error); }
          }
          mounted.disposers.push(installCanvasMenu({
            doc, app, containerEl: el,
            getItems: (point) => plexusCanvasItems({
              app, native, actions, openSettings, drawingUid: mountUid, guard, point, tools, mindmap, arrange,
              openPicker: (p) => openPicker(p),
              noteAt: (p) => actions.newNoteCard(sceneAt(app, p)),
              toScene: (p) => sceneAt(app, p),
            }),
          }));
          if (mounted.uid && getSettings().showBacklinks) {
            backlinks = createCanvasBacklinks({
              doc, api, host, app, containerEl: el, drawingUid: mounted.uid, zIndex: outer ? baseZIndex(doc, outer) : 1000, native,
              openTarget: (target, { sidebar } = {}) => {
                if (!navigateToTarget({ api, containerEl: el, target, sidebar: !!sidebar })) return;
                if (!sidebar) navigatedAt = Date.now();
                hover.hide();
                if (sidebar) toaster.show("Opened in sidebar");
              },
            });
            mounted.disposers.push(() => backlinks.dispose());
          }
          mounted.disposers.push(installLinkInterception({ app, containerEl: el, api, getSettings, onNavigate: ({ sidebar } = {}) => {
            if (!sidebar) navigatedAt = Date.now();
            hover.hide();
            if (sidebar) toaster.show("Opened in sidebar");
          } }));
        },
        onEditorUnmount: () => {
          toolbar.hide();
          unmountEditor();
        },
      });
      lifecycle.add(() => discovery.dispose());
      discovery.scanExisting();
    }

    const unavailable = (name) => console.warn("[plexus] unavailable outside Roam:", name);
    const run = (name) => () => {
      if (!actions) return unavailable(name);
      return actions[name]().catch((error) => console.warn("[plexus]", name, "failed", error));
    };
    const guarded = (name, fn) => () => {
      if (!fn()) return unavailable(name);
      try {
        const out = fn()();
        if (out && typeof out.catch === "function") return out.catch((error) => console.warn("[plexus]", name, "failed", error));
        return out;
      } catch (error) { console.warn("[plexus]", name, "failed", error); }
    };
    const printMode = (ctx, mode) => {
      if (!actions) return unavailable("printFrames");
      const drawingUid = native.activeEditor(doc)?.drawingUid ?? ctx?.focusedUid;
      return Promise.resolve(actions.printFrames({ drawingUid, mode })).catch((error) => console.warn("[plexus] print failed", error));
    };
    const specOf = (id) => HOTKEYS.find((h) => h.id === id)?.spec;
    const newDrawing = (where, useFocus) => (ctx) => {
      if (!actions) return unavailable("newDrawing");
      const args = useFocus === false ? { where } : { where, uid: ctx?.focusedUid };
      Promise.resolve(actions.newDrawing(args)).catch((error) => console.warn("[plexus] new drawing failed", error));
    };
    // The palette holds two entries. They attach for Cmd/Ctrl+P and drop when it closes, so typing does not scan them.
    const isMac = /mac|iphone|ipad/i.test(String(doc?.defaultView?.navigator?.platform ?? ""));
    const hk = (id) => hotkeyFor(id, { mac: isMac });
    const commandList = [
      { id: "newDrawingHere", label: "New drawing here", run: newDrawing("here") },
      { id: "newDrawingBelow", label: "New drawing below", run: newDrawing("below") },
      { id: "newDrawingPage", label: "New drawing on page", run: newDrawing("page") },
      { id: "newDrawingToday", label: "New drawing on today", run: newDrawing("today", false) },
      { id: "region", label: "Create region from selection", hotkey: hk("region"), run: () => runHotkey("region") },
      { id: "image", label: "Create image region", hotkey: hk("image"), run: () => runHotkey("image") },
      { id: "framesRegions", label: "Regions for all frames", run: guarded("regionsForAllFrames", () => actions && (() => actions.regionsForAllFrames())) },
      { id: "mindmap", label: "Mind map", hotkey: hk("mindmap"), run: () => runHotkey("mindmap") },
      {
        id: "mindMapFromOutline",
        label: "Mind map from outline",
        run: (ctx) => {
          if (!actions) return unavailable("mindMapFromOutline");
          return actions.mindMapFromOutline(ctx?.focusedUid).catch((error) => console.warn("[plexus] mind map failed", error));
        },
      },
      { id: "embed", label: "Embed page or block\u2026", hotkey: hk("embed"), run: () => runHotkey("embed") },
      { id: "note", label: "New note card", hotkey: hk("note"), run: () => runHotkey("note") },
      { id: "present", label: "Present open drawing", hotkey: hk("present"), run: () => runHotkey("present") },
      {
        id: "presentHere",
        label: "Present from here",
        run: (ctx) => {
          if (!actions) return unavailable("presentHere");
          const out = native.activeEditor(doc) ? actions.presentDrawing({ from: "here" }) : actions.presentFromRegion(ctx?.focusedUid);
          return Promise.resolve(out).catch((error) => console.warn("[plexus] present failed", error));
        },
      },
      {
        id: "presentOutline",
        label: "Present this outline",
        run: (ctx) => {
          if (!actions) return unavailable("presentOutline");
          return Promise.resolve(actions.presentOutline(ctx?.focusedUid)).catch((error) => console.warn("[plexus] present outline failed", error));
        },
      },
      { id: "printFrames", label: "Print frames\u2026", run: (ctx) => printMode(ctx, "print") },
      { id: "pngFrames", label: "PNG per frame", run: (ctx) => printMode(ctx, "png") },
      { id: "makeSlide", label: "Make slide", run: () => (actions ? Promise.resolve(actions.makeSlide()).catch((error) => console.warn("[plexus] make slide failed", error)) : unavailable("makeSlide")) },
      { id: "back", label: "Back to previous view", run: guarded("back", () => backCommand && (() => backCommand())) },
      { id: "toggleLayer", label: "Toggle regions layer", run: guarded("toggleLayer", () => toggleLayer && (() => toggleLayer())) },
      { id: "dock", label: "Toggle outline dock", hotkey: hk("dock"), run: () => runHotkey("dock") },
      { id: "dockParent", label: "Outline dock: show parent", run: () => (showDockParent ? showDockParent() : unavailable("dockParent")) },
      { id: "refreshCrops", label: "Refresh crops for open drawing", run: run("refreshCropsForOpenDrawing") },
      { id: "clearCache", label: "Clear crop cache", run: run("clearCache") },
      { id: "auditPage", label: "Audit regions on this page", run: guarded("auditPage", () => audit && (() => audit("page"))) },
      { id: "auditGraph", label: "Audit regions in graph", run: guarded("auditGraph", () => audit && (() => audit("graph"))) },
      { id: "restore", label: "Restore before last Plexus change", run: guarded("restore", () => actions && (() => actions.restoreBeforeLastPlexusChange())) },
      { id: "restoreVersion", label: "Restore an earlier version\u2026", run: () => (tools ? tools.restore() : unavailable("restoreVersion")) },
      { id: "chartFromJson", label: "Cause-and-effect from JSON\u2026", run: () => (tools ? tools.chart() : unavailable("chartFromJson")) },
      { id: "drawingToOutline", label: "Drawing to outline\u2026", run: (ctx) => (tools ? tools.outline(ctx) : unavailable("drawingToOutline")) },
      { id: "copyMarkdown", label: "Copy as Roam markdown", run: (ctx) => (tools ? tools.copyMarkdown(ctx) : unavailable("copyMarkdown")) },
      { id: "mmLayoutRight", label: "Mind map layout: Right", run: () => (tools ? tools.setLayout("right") : unavailable("mmLayout")) },
      { id: "mmLayoutCause", label: "Mind map layout: Cause", run: () => (tools ? tools.setLayout("cause") : unavailable("mmLayout")) },
      { id: "mmLayoutFishbone", label: "Mind map layout: Fishbone", run: () => (tools ? tools.setLayout("fishbone") : unavailable("mmLayout")) },
      { id: "mmLayoutFlow", label: "Mind map layout: Flow", run: () => (tools ? tools.setLayout("flow") : unavailable("mmLayout")) },
      { id: "insertTemplate", label: "Insert template\u2026", run: () => (tools ? tools.insertTemplate() : unavailable("insertTemplate")) },
      { id: "newFromTemplate", label: "New drawing from template\u2026", run: (ctx) => (tools ? tools.newFromTemplate(ctx) : unavailable("newFromTemplate")) },
      { id: "saveTemplate", label: "Save selection as template\u2026", run: () => (tools ? tools.saveTemplate() : unavailable("saveTemplate")) },
      { id: "mmAttrEdges", label: "Mind map: attribute blocks as edges", run: () => (tools ? tools.toggleAttrEdges() : unavailable("mmAttrEdges")) },
      { id: "captionCleanupDryRun", label: "Clear placeholder captions (dry run)", run: run("captionCleanupDryRun") },
      { id: "undoCaptionCleanup", label: "Undo caption cleanup", run: run("undoCaptionCleanup") },
      { id: "legacyDryRun", label: "Legacy drawings (dry run)", run: run("legacyDryRun") },
      { id: "focusMode", label: "Focus mode", run: () => runFocusMode() },
      { id: "todoMode", label: "Todo mode", run: () => runTodoMode() },
      { id: "embedQuery", label: "Embed query results", run: (ctx) => runEmbedQuery(ctx) },
      { id: "embedChildren", label: "Embed page children", run: (ctx) => runEmbedChildren(ctx) },
      { id: "linkSelected", label: "Link selected", run: () => runLinkSelected() },
      { id: "filterRegions", label: "Filter regions by tag", run: (ctx) => runFilterTag(ctx) },
      { id: "lockSelection", label: "Lock or unlock selection", run: () => runLockAction("toggleElementLock") },
      { id: "unlockAll", label: "Unlock all", run: () => runLockAction("unlockAllElements") },
      { id: "copyDiagnostics", label: "Copy diagnostics", run: () => Promise.resolve(runDiagnostics()).catch((error) => console.warn("[plexus] diagnostics failed", error)) },
      { id: "showInCompass", label: "Show in Compass", run: (ctx) => showInCompass(ctx?.focusedUid) },
      { id: "settings", label: "Region settings", run: () => openSettings() },
    ];
    let commandListHandle = null;
    lifecycle.add(() => { commandListHandle?.close?.(); commandListHandle = null; });
    attachLazyPalette({
      doc,
      palette: extensionAPI.ui.commandPalette,
      lifecycle,
      onMindMap: (event) => {
        const app = mountedApp?.();
        const target = event?.target;
        const tag = String(target?.tagName ?? "").toLowerCase();
        const typing = tag === "textarea" || tag === "input" || target?.isContentEditable === true;
        if (app && (app.state?.editingTextElement || (typing && target.closest?.(".excalidraw-outer-container, .plexus-portal")))) return false;
        runHotkey("mindmap");
        return true;
      },
      commands: [
        {
          label: "Plexus: Commands\u2026",
          callback: () => {
            try {
              const focusedUid = globalThis.roamAlphaAPI?.ui?.getFocusedBlock?.()?.["block-uid"];
              commandListHandle = openList({ doc, commands: commandList, ctx: { focusedUid }, zIndex: commandZ(), mac: isMac });
            } catch (error) { console.warn("[plexus] command list failed", error); }
          },
        },
        { label: "Plexus: Mind map", callback: () => runHotkey("mindmap"), "default-hotkey": specOf("mindmap") },
      ],
    });
    try {
      const slash = extensionAPI.ui?.slashCommand ?? globalThis.roamAlphaAPI?.ui?.slashCommand;
      await lifecycle.command(slash, {
        label: "Sketch here",
        callback: (ctx) => {
          const uid = ctx?.["block-uid"] ?? globalThis.roamAlphaAPI?.ui?.getFocusedBlock?.()?.["block-uid"];
          if (!actions) { unavailable("newDrawing"); return ""; }
          Promise.resolve(actions.newDrawing({ where: "here", uid })).catch((error) => console.warn("[plexus] new drawing failed", error));
          return "";
        },
      });
    } catch (error) { console.warn("[plexus] slash command unavailable", error); }
    console.info(`[plexus] Loaded v${extension?.version || "development"}`);
  } catch (error) {
    if (activeLifecycle === lifecycle) activeLifecycle = null;
    await lifecycle.dispose().catch((cleanupError) => console.error(cleanupError));
    throw error;
  }

  // Roam invokes this cleanup immediately before onunload.
  return async () => {
    if (activeLifecycle === lifecycle) activeLifecycle = null;
    await lifecycle.dispose();
    await new Promise((r) => setTimeout(r, 0));
    sweepExtensionDom(globalThis.document);
  };
}

export async function onunload() {
  const lifecycle = activeLifecycle;
  activeLifecycle = null;
  if (lifecycle) await lifecycle.dispose();
  await new Promise((r) => setTimeout(r, 0));
  sweepExtensionDom(globalThis.document);
  console.info("[plexus] Unloaded");
}

export default { onload, onunload };
