import { createLifecycle } from "./lifecycle.js";
import { createSettingsPanel, initializeSettings, readSettings, setRefOverride, writeSetting } from "./settings.js";
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
import { isHostDark, motionOk, resetThemeMemo } from "./host/theme.js";
import { regionLabel, drawingTitleOf, imageAltAt, isImageKind } from "./model/label.js";

let activeLifecycle = null;

const THUMB_WIDTHS = [160, 480];
const THUMB_WARM_DELAY_MS = 1500;
const REFRESH_DEBOUNCE_MS = 300;
const LAYER_REFRESH_MS = 200;

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

export async function onload({ extensionAPI, extension }) {
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
        onPresent: () => actions.presentDrawing(),
        canPresent: () => actions.hasFrames(),
        onMindMap: () => actions.startMindMap().catch((error) => console.warn("[plexus] mind map failed", error)),
        onEditEmbed: () => actions.editEmbed(),
        canEditEmbed: () => actions.canEditEmbed(),
        onToggleRegions: () => toggleRegionsLayer(),
        regionsVisible: () => !!mounted?.layer?.visible(),
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
      let layerOn = false;
      const toggleRegionsLayer = () => {
        layerOn = !layerOn;
        const layer = mounted?.layer;
        if (layer) { if (layerOn) layer.show(); else layer.hide(); }
        toolbar.refresh();
        return layerOn;
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
        refreshRegion: (uid, opts) => regionref?.refreshRegion(uid, opts),
        guard,
        camera,
        motionOk,
        viewHistory: (app) => (mounted?.app === app ? mounted.history : null),
      });
      lifecycle.add(() => actions.dispose());

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
        doc,
      }));
      const suggest = createLinkSuggest({ doc, api, zIndexFor });
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
          mounted = { uid: mountUid, app, disposers: [], overlay: null, hash: mountHash, history, layer: null };
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
          mounted.disposers.push(installCanvasMenu({
            doc, app, containerEl: el,
            getItems: () => plexusCanvasItems({ app, native, actions, openSettings, drawingUid: mountUid, guard }),
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

    const run = (name) => () => {
      if (!actions) return console.warn("[plexus] unavailable outside Roam:", name);
      return actions[name]().catch((error) => console.warn("[plexus]", name, "failed", error));
    };
    const commands = [
      ["Plexus: Create region from selection", "createAreaRegion"],
      ["Plexus: Create image region", "createImageRegion"],
      ["Plexus: Present open drawing", "presentDrawing"],
      ["Plexus: Refresh crops for open drawing", "refreshCropsForOpenDrawing"],
      ["Plexus: Clear crop cache", "clearCache"],
      ["Plexus: Legacy drawings (dry run)", "legacyDryRun"],
      ["Plexus: Clear placeholder captions (dry run)", "captionCleanupDryRun"],
      ["Plexus: Undo caption cleanup", "undoCaptionCleanup"],
    ];
    for (const [label, name] of commands) {
      await lifecycle.command(extensionAPI.ui.commandPalette, { label, callback: run(name) });
    }
    await lifecycle.command(extensionAPI.ui.commandPalette, { label: "Plexus: Region settings", callback: () => openSettings() });
    const unavailable = (name) => console.warn("[plexus] unavailable outside Roam:", name);
    const guarded = (name, fn) => () => {
      if (!fn()) return unavailable(name);
      try {
        const out = fn()();
        if (out && typeof out.catch === "function") return out.catch((error) => console.warn("[plexus]", name, "failed", error));
        return out;
      } catch (error) { console.warn("[plexus]", name, "failed", error); }
    };
    const extraCommands = [
      ["Plexus: Regions for all frames", "regionsForAllFrames", () => actions && (() => actions.regionsForAllFrames())],
      ["Plexus: Audit regions on this page", "auditPage", () => audit && (() => audit("page"))],
      ["Plexus: Audit regions in graph", "auditGraph", () => audit && (() => audit("graph"))],
      ["Plexus: Restore before last Plexus change", "restore", () => actions && (() => actions.restoreBeforeLastPlexusChange())],
      ["Plexus: Toggle regions layer", "toggleLayer", () => toggleLayer && (() => toggleLayer())],
      ["Plexus: Back to previous view", "back", () => backCommand && (() => backCommand())],
    ];
    for (const [label, name, resolve] of extraCommands) {
      await lifecycle.command(extensionAPI.ui.commandPalette, { label, callback: guarded(name, resolve) });
    }
    await lifecycle.command(extensionAPI.ui.commandPalette, {
      label: "Plexus: Mind map from outline",
      callback: () => {
        if (!actions) return console.warn("[plexus] unavailable outside Roam: mindMapFromOutline");
        const uid = globalThis.roamAlphaAPI?.ui?.getFocusedBlock?.()?.["block-uid"];
        return actions.mindMapFromOutline(uid).catch((error) => console.warn("[plexus] mind map failed", error));
      },
    });
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
