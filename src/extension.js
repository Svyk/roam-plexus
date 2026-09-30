import { createLifecycle } from "./lifecycle.js";
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
import { createRegionRefRenderer } from "./view/regionref.js";
import { createDiscovery } from "./view/discover.js";
import { showSpotlight } from "./view/spotlight.js";
import { createHoverPreview } from "./view/hover-preview.js";
import { clearLinkTooltip, installLinkInterception, navigateToTarget } from "./host/links.js";
import { createPublicApi, createSceneRegistry, installPublicApi, uninstallPublicApi } from "./api.js";
import { createMindMap } from "./view/mindmap.js";
import { createMmWriter } from "./host/mmwrites.js";
import { createWriteGuard } from "./host/guard.js";
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
import { viewportToScene } from "./model/scene.js";
import { isHostDark, motionOk, resetThemeMemo } from "./host/theme.js";
import { regionLabel, drawingTitleOf, imageAltAt, isImageKind } from "./model/label.js";

let activeLifecycle = null;

const THUMB_WIDTHS = [160, 480];
const THUMB_WARM_DELAY_MS = 1500;
const REFRESH_DEBOUNCE_MS = 300;
const LAYER_REFRESH_MS = 200;
const DOCK_SETTLE_MS = 150;

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
    let mountedApp = null;
    const hotkeyHandlers = {};
    const runHotkey = createHotkeyRunner({ handlers: hotkeyHandlers, getApp: () => mountedApp?.() ?? null });
    let commandZ = () => 0;
    let openSettings = () => console.warn("[plexus] unavailable outside Roam: settings");
    const doc = globalThis.document;
    const api = globalThis.roamAlphaAPI;
    if (doc && api) {
      const host = createRoamHost({ api });
      const settings = getSettings();
      const cache = createCropCache({
        graph: host.graphName(),
        persist: settings.cacheOnDisk && !host.isEncrypted(),
        limitBytes: settings.cacheLimitMb * 2 ** 20,
      });
      lifecycle.add(() => cache.dispose());
      const cold = createColdRenderer({ api, doc });
      lifecycle.add(() => cold.dispose());
      const toaster = createToaster({ doc });
      lifecycle.add(() => toaster.dispose());
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
      const scenes = createSceneRegistry({ native, doc, guard });
      lifecycle.add(() => scenes.dispose());
      let mounted = null;
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
      const presenter = createPresenter({ doc });
      lifecycle.add(() => presenter.dispose());
      const mmWriter = createMmWriter({ api, graph: host.graphName() });
      const measurer = createMeasurer({ doc });
      const mindmap = createMindMap({ doc, api, writer: mmWriter, measurer, native, toaster, guardedWrite: guard.guardedWrite, zIndexFor: (outer) => (outer ? baseZIndex(doc, outer) : 1000) });
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

      const publicApi = createPublicApi({ host, actions, emitter, version: extension?.version || "development", scenes, openDrawing: (uid, opts) => actions.openDrawing(uid, opts) });
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
      const unmountEditor = ({ unloading = false } = {}) => {
        const current = mounted;
        mounted = null;
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
            const off = app.onChangeEmitter?.on?.(() => toolbar.refresh());
            if (typeof off === "function") mounted.disposers.push(off);
          } catch (error) { console.warn("[plexus] toolbar refresh subscribe failed", error); }
          toolbar.refresh();
          mounted.disposers.push(hover.attach({ app, containerEl: el }));
          const overlay = createEmbedOverlay({
            doc, api, host, app, containerEl: el, zIndex: outer ? baseZIndex(doc, outer) : 1000,
            toast: (message) => toaster.show(message, { kind: "error" }),
            onStateChange: () => toolbar.refresh(),
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
              app, native, actions, openSettings, drawingUid: mountUid, guard, point,
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
    const specOf = (id) => HOTKEYS.find((h) => h.id === id)?.spec;
    const newDrawing = (where, useFocus) => (ctx) => {
      if (!actions) return unavailable("newDrawing");
      const args = useFocus === false ? { where } : { where, uid: ctx?.focusedUid };
      Promise.resolve(actions.newDrawing(args)).catch((error) => console.warn("[plexus] new drawing failed", error));
    };
    // Every palette entry costs Roam's keydown handler ~0.055 ms per keystroke, so the palette holds two entries and this list holds the rest.
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
      { id: "back", label: "Back to previous view", run: guarded("back", () => backCommand && (() => backCommand())) },
      { id: "toggleLayer", label: "Toggle regions layer", run: guarded("toggleLayer", () => toggleLayer && (() => toggleLayer())) },
      { id: "dock", label: "Toggle outline dock", hotkey: hk("dock"), run: () => runHotkey("dock") },
      { id: "dockParent", label: "Outline dock: show parent", run: () => (showDockParent ? showDockParent() : unavailable("dockParent")) },
      { id: "refreshCrops", label: "Refresh crops for open drawing", run: run("refreshCropsForOpenDrawing") },
      { id: "clearCache", label: "Clear crop cache", run: run("clearCache") },
      { id: "auditPage", label: "Audit regions on this page", run: guarded("auditPage", () => audit && (() => audit("page"))) },
      { id: "auditGraph", label: "Audit regions in graph", run: guarded("auditGraph", () => audit && (() => audit("graph"))) },
      { id: "restore", label: "Restore before last Plexus change", run: guarded("restore", () => actions && (() => actions.restoreBeforeLastPlexusChange())) },
      { id: "captionCleanupDryRun", label: "Clear placeholder captions (dry run)", run: run("captionCleanupDryRun") },
      { id: "undoCaptionCleanup", label: "Undo caption cleanup", run: run("undoCaptionCleanup") },
      { id: "legacyDryRun", label: "Legacy drawings (dry run)", run: run("legacyDryRun") },
      { id: "settings", label: "Region settings", run: () => openSettings() },
    ];
    let commandListHandle = null;
    lifecycle.add(() => { commandListHandle?.close?.(); commandListHandle = null; });
    await lifecycle.command(extensionAPI.ui.commandPalette, {
      label: "Plexus: Commands\u2026",
      callback: () => {
        try {
          const focusedUid = globalThis.roamAlphaAPI?.ui?.getFocusedBlock?.()?.["block-uid"];
          commandListHandle = openList({ doc, commands: commandList, ctx: { focusedUid }, zIndex: commandZ(), mac: isMac });
        } catch (error) { console.warn("[plexus] command list failed", error); }
      },
    });
    await lifecycle.command(extensionAPI.ui.commandPalette, { label: "Plexus: Mind map", callback: () => runHotkey("mindmap"), "default-hotkey": specOf("mindmap") });
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
  };
}

export async function onunload() {
  const lifecycle = activeLifecycle;
  activeLifecycle = null;
  if (lifecycle) await lifecycle.dispose();
  console.info("[plexus] Unloaded");
}

export default { onload, onunload };
