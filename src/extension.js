import { createLifecycle } from "./lifecycle.js";
import { createSettingsPanel, initializeSettings, readSettings, setRefOverride, writeSetting } from "./settings.js";
import { createRoamHost } from "./host/roam.js";
import * as native from "./host/native.js";
import { createCropCache } from "./host/cache.js";
import { createColdRenderer } from "./host/cold-render.js";
import { createToaster } from "./view/toast.js";
import { baseZIndex, createEditorToolbar } from "./view/toolbar.js";
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
import { createMeasurer } from "./host/measure.js";
import { createActions } from "./actions.js";
import { clearImageMemo } from "./host/image-source.js";
import { createLinkSuggest, installSuggestAutoAttach } from "./view/link-suggest.js";
import { installCanvasMenu, installRoamMenus } from "./view/context-menus.js";
import { openCaptionPrompt } from "./view/caption-prompt.js";
import { openSettingsDialog } from "./view/settings-dialog.js";
import { isHostDark, resetThemeMemo } from "./host/theme.js";

let activeLifecycle = null;

const THUMB_WIDTHS = [160, 480];
const THUMB_WARM_DELAY_MS = 1500;
const REFRESH_DEBOUNCE_MS = 300;

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
      });
      lifecycle.add(() => toolbar.dispose());
      const scenes = createSceneRegistry({ native, doc });
      lifecycle.add(() => scenes.dispose());
      let mounted = null;
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
      const mindmap = createMindMap({ doc, api, writer: mmWriter, measurer, native, toaster, zIndexFor: (outer) => (outer ? baseZIndex(doc, outer) : 1000) });
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
      });
      lifecycle.add(() => actions.dispose());

      const publicApi = createPublicApi({ host, actions, emitter, version: extension?.version || "development", scenes, openDrawing: (uid, opts) => actions.openDrawing(uid, opts) });
      installPublicApi(publicApi, { win: flagTarget });
      lifecycle.add(() => uninstallPublicApi(publicApi, { win: flagTarget }));

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
          mounted = { uid: mountUid, app, disposers: [], overlay: null, hash: mountHash };
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
          mounted.disposers.push(mindmap.mount({ app, containerEl: el, outerEl: outer, zIndex: outer ? baseZIndex(doc, outer) : 1000 }));
          mounted.disposers.push(installCanvasMenu({
            doc, app, containerEl: el,
            getItems: () => {
              const guard = (fn) => { try { return !!fn(); } catch { return false; } };
              const call = (name, fn) => () => fn().catch?.((error) => console.warn("[plexus]", name, "failed", error));
              return [
                { id: "region", label: "Plexus: Create region", enabled: guard(() => native.selectedElementIds(app).length > 0), run: call("region", () => actions.createAreaRegion()) },
                { id: "frame", label: "Plexus: Frame region", enabled: guard(() => actions.isFrameSelected()), run: call("frame", () => actions.createFrameRegion()) },
                { id: "crop", label: "Plexus: Region from crop", enabled: guard(() => actions.hasCroppedImageSelected()), run: call("crop", () => actions.regionFromCrop()) },
                { id: "image", label: "Plexus: Image region", enabled: guard(() => actions.hasSingleImageSelected()), run: call("image", () => actions.createImageRegion()) },
                { id: "embed", label: "Plexus: Embed block from clipboard", enabled: true, run: call("embed", () => actions.insertEmbedFromClipboard()) },
                { id: "edit-embed", label: "Plexus: Edit embed", enabled: guard(() => actions.canEditEmbed()), run: call("edit-embed", () => actions.editEmbed()) },
                { id: "present", label: "Plexus: Present", enabled: guard(() => actions.hasFrames()), run: call("present", () => actions.presentDrawing()) },
                { id: "mindmap", label: "Plexus: Mind map", enabled: true, run: call("mindmap", () => actions.startMindMap()) },
                { id: "settings", label: "Plexus: Region settings…", enabled: true, run: () => openSettings() },
              ];
            },
          }));
          if (mounted.uid && getSettings().showBacklinks) {
            const backlinks = createCanvasBacklinks({
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
