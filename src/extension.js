import { createLifecycle } from "./lifecycle.js";
import { createSettingsPanel, initializeSettings, readSettings } from "./settings.js";
import { createRoamHost } from "./host/roam.js";
import * as native from "./host/native.js";
import { createCropCache } from "./host/cache.js";
import { createColdRenderer } from "./host/cold-render.js";
import { createToaster } from "./view/toast.js";
import { createEditorToolbar } from "./view/toolbar.js";
import { createRegionRefRenderer } from "./view/regionref.js";
import { createDiscovery } from "./view/discover.js";
import { showSpotlight } from "./view/spotlight.js";
import { createHoverPreview } from "./view/hover-preview.js";
import { installLinkInterception } from "./host/links.js";
import { createPublicApi, installPublicApi, uninstallPublicApi } from "./api.js";
import { createActions } from "./actions.js";

let activeLifecycle = null;

const CONTEXT_MENU_LABEL = "Plexus: Region on image";

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
    await lifecycle.settingsPanel(extensionAPI, createSettingsPanel());
    const getSettings = () => readSettings(extensionAPI);

    let actions = null;
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
      });
      lifecycle.add(() => toolbar.dispose());
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
      });
      lifecycle.add(() => actions.dispose());

      const publicApi = createPublicApi({ host, actions, emitter, version: extension?.version || "development" });
      installPublicApi(publicApi, { win: flagTarget });
      lifecycle.add(() => uninstallPublicApi(publicApi, { win: flagTarget }));

      if (api.ui?.blockContextMenu?.addCommand) {
        api.ui.blockContextMenu.addCommand({
          label: CONTEXT_MENU_LABEL,
          callback: (e) => actions.createPlainImageRegion(e?.["block-uid"]).catch((error) => console.warn("[plexus] image region failed", error)),
        });
        lifecycle.add(() => api.ui.blockContextMenu.removeCommand?.({ label: CONTEXT_MENU_LABEL }));
      }

      const regionref = createRegionRefRenderer({
        host,
        cache,
        cold,
        getSettings,
        doc,
        onOpen: (uid, opts) => actions.openRegion(uid, opts).catch((error) => console.warn("[plexus] open failed", error)),
      });
      lifecycle.add(() => regionref.releaseAll());
      const hover = createHoverPreview({ doc, api });
      lifecycle.add(() => hover.dispose());
      // Link interception and hover preview live only while an editor is mounted.
      let mounted = null;
      const unmountEditor = () => {
        const current = mounted;
        mounted = null;
        if (!current) return;
        for (const dispose of current.disposers) {
          try { dispose(); } catch (error) { console.warn("[plexus] editor cleanup failed", error); }
        }
        if (current.uid) emitter.emit({ uid: current.uid, kind: "drawing" });
      };
      lifecycle.add(unmountEditor);
      const discovery = createDiscovery({
        root: doc.body,
        onRegionButton: (btn) => regionref.claim(btn),
        onEditorMount: (el) => {
          const outer = el.closest(".excalidraw-outer-container");
          if (outer) toolbar.show(outer);
          unmountEditor();
          const app = native.findApp(el);
          if (!app) return;
          mounted = { uid: host.blockUidFromNode(el), disposers: [] };
          mounted.disposers.push(hover.attach({ app, containerEl: el }));
          mounted.disposers.push(installLinkInterception({ app, containerEl: el, api, getSettings, onNavigate: ({ sidebar } = {}) => {
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
      ["Plexus: Refresh crops for open drawing", "refreshCropsForOpenDrawing"],
      ["Plexus: Clear crop cache", "clearCache"],
    ];
    for (const [label, name] of commands) {
      await lifecycle.command(extensionAPI.ui.commandPalette, { label, callback: run(name) });
    }
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
