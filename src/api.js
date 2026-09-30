import { drawingTitleOf, imageAltAt, isImageKind, regionLabel } from "./model/label.js";
import { parseRegion } from "./model/region.js";
import { commonBounds, liveElements, normalizeSvgSize, sceneToViewport } from "./model/scene.js";

export const API_VERSION = 3;

const GONE = "Scene is no longer open";
const FORBIDDEN_PATCH_KEYS = ["id", "type", "version", "versionNonce", "isDeleted", "index"];
const DRAWING_RE = /^\s*\{\{(\[\[excalidraw\]\]|excalidraw)\}\}/;
const isPlain = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const nonce = () => Math.floor(Math.random() * 2 ** 31);
const bump = (el, extra = {}) => ({ ...el, ...extra, version: (el.version || 0) + 1, versionNonce: nonce(), updated: Date.now() });

// Elements that Excalidraw's restore would keep as isDeleted (phase 5 item 15 rule).
function invisible(el) {
  if (el.isDeleted) return true;
  if (["line", "arrow", "draw", "freedraw"].includes(el.type)) return !Array.isArray(el.points) || el.points.length < 2;
  if (el.type === "text") return !el.text;
  return el.width === 0 && el.height === 0;
}

// Per-editor scene objects for window.RoamPlexus.scene(uid). native supplies activeEditor, addViaPaste,
// waitNotLoading, captureSelectionSvg and zoomTo.
export function createSceneRegistry({ native, doc = globalThis.document, raf = globalThis.requestAnimationFrame } = {}) {
  let disposed = false;
  const scenes = new WeakMap();
  const subs = new Map();
  const disposeHooks = new Set();
  const frame = typeof raf === "function" ? (fn) => raf(fn) : (fn) => setTimeout(fn, 16);

  function build(app, uid) {
    let released = false;
    const live = () => !released && !disposed && native.activeEditor(doc)?.app === app && native.activeEditor(doc)?.drawingUid === uid;
    const guard = () => { if (!live()) throw new Error(GONE); };
    const all = () => app.getSceneElementsIncludingDeleted?.() || [];
    const write = (elements, appState) => {
      const u = { elements };
      if (appState) u.appState = appState;
      app.updateScene({ ...u, captureUpdate: "IMMEDIATELY" });
    };

    const scene = {
      uid,
      elements() { guard(); return structuredClone(liveElements(all())); },
      appState() {
        guard();
        const s = app.state || {};
        return { scrollX: s.scrollX, scrollY: s.scrollY, zoom: s.zoom?.value ?? s.zoom, selectedElementIds: { ...(s.selectedElementIds || {}) }, theme: s.theme, width: s.width, height: s.height };
      },
      add(elements, { select = true, at = "keep" } = {}) {
        guard();
        if (!Array.isArray(elements) || !elements.length) throw new Error("add needs a non-empty array");
        if (elements.some((e) => e?.type === "image")) throw new Error("image elements are not supported");
        const inputs = elements.map((e) => structuredClone(e));
        const kept = [];
        const copies = [];
        inputs.forEach((el, i) => {
          if (invisible(el)) return;
          const cd = isPlain(el.customData) ? el.customData : {};
          copies.push({ ...el, customData: { ...cd, plexus: { ...(isPlain(cd.plexus) ? cd.plexus : {}), addKey: i } } });
          kept.push(i);
        });
        const ids = inputs.map(() => null);
        if (!copies.length) return ids;
        const prevSel = { ...(app.state?.selectedElementIds || {}) };
        const prevGroups = { ...(app.state?.selectedGroupIds || {}) };
        let position = "center";
        if (at === "keep") {
          const bounds = commonBounds(copies);
          if (bounds) {
            const [x1, y1, x2, y2] = bounds;
            const p = sceneToViewport({ x: (x1 + x2) / 2, y: (y1 + y2) / 2, appState: app.state });
            position = { clientX: p.x, clientY: p.y };
          }
        }
        native.addViaPaste(app, copies, { position });
        const byKey = new Map();
        for (const el of all()) {
          const k = el.customData?.plexus?.addKey;
          if (!el.isDeleted && Number.isInteger(k) && kept.includes(k) && !byKey.has(k)) byKey.set(k, el.id);
        }
        const keyOf = new Map([...byKey].map(([k, id]) => [id, k]));
        const next = all().map((el) => {
          const k = keyOf.get(el.id);
          if (k === undefined) return el;
          const orig = elements[k];
          const out = { ...el };
          if (orig.customData === undefined) delete out.customData; else out.customData = structuredClone(orig.customData);
          if (orig.frameId == null) out.frameId = null;
          return bump(out);
        });
        let selection = prevSel;
        let groups = prevGroups;
        if (select) {
          selection = {};
          groups = {};
          for (const el of next) if (keyOf.has(el.id) && !el.containerId) selection[el.id] = true;
        }
        app.updateScene({ elements: next, appState: { selectedElementIds: selection, selectedGroupIds: groups } });
        for (const [k, id] of byKey) ids[k] = id;
        return ids;
      },
      update(id, patch) {
        guard();
        if (!isPlain(patch)) throw new Error("patch must be an object");
        for (const key of FORBIDDEN_PATCH_KEYS) if (key in patch) throw new Error(`Cannot patch ${key}`);
        const el = all().find((e) => e.id === id);
        if (!el) throw new Error(`No element ${id}`);
        const extra = { ...patch };
        if (patch.customData !== undefined) {
          const merged = { ...(el.customData || {}), ...patch.customData };
          if (isPlain(patch.customData.plexus) && isPlain(el.customData?.plexus)) merged.plexus = { ...el.customData.plexus, ...patch.customData.plexus };
          extra.customData = merged;
        }
        if (typeof patch.text === "string" && patch.originalText === undefined) extra.originalText = patch.text;
        const updated = bump(el, extra);
        write(all().map((e) => (e.id === id ? updated : e)));
        return structuredClone(updated);
      },
      remove(ids) {
        guard();
        const set = new Set(Array.isArray(ids) ? ids : [ids]);
        const els = all();
        const hit = new Set(els.filter((e) => set.has(e.id)).map((e) => e.id));
        const doomed = new Set([...hit, ...els.filter((e) => e.containerId && hit.has(e.containerId)).map((e) => e.id)]);
        if (!doomed.size) return 0;
        write(els.map((e) => (doomed.has(e.id) && !e.isDeleted ? bump(e, { isDeleted: true }) : e)));
        return hit.size;
      },
      select(ids) {
        guard();
        const selection = {};
        for (const id of ids || []) selection[id] = true;
        app.updateScene({ appState: { selectedElementIds: selection, selectedGroupIds: {} } });
      },
      zoomTo(ids) {
        guard();
        const set = new Set(ids || []);
        const els = liveElements(all()).filter((e) => set.has(e.id));
        if (!els.length) throw new Error("No elements to zoom to");
        native.zoomTo(app, commonBounds(els));
      },
      async exportSvg(ids) {
        guard();
        const list = ids?.length ? ids : liveElements(all()).map((e) => e.id);
        const svg = await native.captureSelectionSvg(app, list);
        guard();
        return normalizeSvgSize(svg);
      },
      onChange(cb) {
        guard();
        if (typeof cb !== "function") throw new Error("callback required");
        const emitter = app.onChangeEmitter;
        let pending = false;
        let off = null;
        let closed = false;
        const close = () => {
          if (closed) return;
          closed = true;
          try { off?.(); } catch (error) { console.warn("[plexus] unsubscribe failed", error); }
          subs.get(app)?.delete(close);
        };
        off = emitter?.on?.(() => {
          if (pending || closed) return;
          pending = true;
          frame(() => {
            pending = false;
            if (closed || !live()) return;
            try { cb({ uid }); } catch (error) { console.error("[plexus] onChange failed", error); }
          });
        });
        if (!subs.has(app)) subs.set(app, new Set());
        subs.get(app).add(close);
        return close;
      },
    };
    const frozen = Object.freeze(scene);
    return { scene: frozen, release() { released = true; } };
  }

  const registry = {
    sceneFor(app, uid) {
      if (disposed || !app || !uid) return null;
      const cur = scenes.get(app);
      if (cur && cur.uid === uid && !cur.released) return cur.scene;
      cur?.release();
      const made = build(app, uid);
      const entry = { uid, scene: made.scene, release: made.release, released: false };
      const rel = made.release;
      entry.release = () => { entry.released = true; rel(); };
      scenes.set(app, entry);
      return entry.scene;
    },
    sceneOf(uid) {
      if (disposed) return null;
      const ed = native.activeEditor(doc);
      return ed?.app && ed.drawingUid === uid ? registry.sceneFor(ed.app, uid) : null;
    },
    activeApp() { return native.activeEditor(doc)?.app ?? null; },
    activeUid() { return native.activeEditor(doc)?.drawingUid ?? null; },
    ready(app, timeoutMs) { return native.waitNotLoading(app, timeoutMs, { doc }); },
    release(app) {
      scenes.get(app)?.release();
      scenes.delete(app);
      for (const close of [...(subs.get(app) || [])]) close();
      subs.delete(app);
    },
    onDispose(cb) { disposeHooks.add(cb); return () => disposeHooks.delete(cb); },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const set of subs.values()) for (const close of [...set]) close();
      subs.clear();
      for (const cb of [...disposeHooks]) { try { cb(); } catch (error) { console.warn("[plexus] dispose hook failed", error); } }
      disposeHooks.clear();
    },
  };
  return registry;
}

function subscribe(emitter, type, cb) {
  if (typeof emitter?.on === "function") return emitter.on(type, cb);
  if (typeof emitter?.addEventListener === "function") return emitter.addEventListener(type, cb);
  return undefined;
}

function unsubscribe(emitter, type, cb) {
  if (typeof emitter?.off === "function") return emitter.off(type, cb);
  if (typeof emitter?.removeEventListener === "function") return emitter.removeEventListener(type, cb);
  return undefined;
}

// Wraps host + actions into the frozen window.RoamPlexus object. Nothing here throws into a caller's event loop
// for listener errors; API calls themselves reject/throw normally.
export function createPublicApi({ host, actions, emitter, version, scenes, openDrawing } = {}) {
  const listeners = new Map();
  const opening = new Map();

  const api = {
    apiVersion: API_VERSION,
    version: String(version ?? ""),
    isAvailable() {
      try { return !!host?.graphName?.(); } catch { return false; }
    },
    async create(args) {
      const result = await host.createDrawing(args || {});
      try { emitter?.emit?.({ uid: result?.uid, kind: "drawing" }); } catch (error) { console.warn("[plexus] change emit failed", error); }
      return result;
    },
    open(uid, { region, sidebar = false } = {}) {
      let isRegion = region;
      if (isRegion == null) isRegion = !!parseRegion(host.pullBlock?.(uid)?.string);
      return isRegion ? actions.openRegion(uid, { sidebar }) : host.openBlock(uid, { sidebar });
    },
    thumbnail(uid, opts) { return actions.thumbnail(uid, opts || {}); },
    regionsOf(uid) {
      const entries = host.regionsOf(uid);
      let src = { string: "", pageTitle: null };
      try { src = host.labelSource?.(uid) ?? src; } catch (error) { console.warn("[plexus] labelSource failed", error); }
      return entries.map(({ uid: regionUid, region }) => {
        let label = "Region";
        try {
          label = regionLabel({
            kind: region.kind,
            caption: region.caption ?? "",
            drawingTitle: drawingTitleOf(src.string, src.pageTitle),
            imageAlt: isImageKind(region.kind) ? imageAltAt(src.string, region.i) : null,
            resolveBlock: (u) => host.pullBlock?.(u)?.string,
          });
        } catch (error) { console.warn("[plexus] region label failed", error); }
        return { uid: regionUid, kind: region.kind, caption: region.caption ?? "", label };
      });
    },
    drawingsOn(pageUid) { return host.drawingsOn(pageUid); },
    scene(uid) { return scenes?.sceneOf?.(uid) ?? null; },
    whenOpen(uid, { timeoutMs = 10000, sidebar = false } = {}) {
      if (opening.has(uid)) return opening.get(uid).promise;
      if (opening.size) return Promise.reject(new Error(`Busy opening ${[...opening.keys()][0]}`));
      let timer = null;
      let offDispose = null;
      const promise = new Promise((resolve, reject) => {
        const fail = (message) => reject(new Error(message));
        timer = setTimeout(() => fail("Timed out"), timeoutMs);
        offDispose = scenes?.onDispose?.(() => fail("Plexus unloaded"));
        (async () => {
          if (!scenes) throw new Error("Scenes unavailable");
          if (!DRAWING_RE.test(String(host.pullBlock?.(uid)?.string ?? ""))) throw new Error("Not a drawing");
          let app = scenes.sceneOf(uid) ? scenes.activeApp() : null;
          if (!app) {
            const active = scenes.activeUid?.();
            if (active && active !== uid) throw new Error("Another drawing is open");
            const opened = await openDrawing?.(uid, { sidebar });
            if (!opened?.app) throw new Error("Could not open drawing");
            app = opened.app;
          }
          if (!(await scenes.ready(app, timeoutMs))) throw new Error("Timed out");
          const scene = scenes.sceneFor(app, uid);
          if (!scene) throw new Error("Plexus unloaded");
          return scene;
        })().then(resolve, reject);
      });
      const entry = { promise };
      opening.set(uid, entry);
      const done = () => { clearTimeout(timer); offDispose?.(); if (opening.get(uid) === entry) opening.delete(uid); };
      promise.then(done, done);
      return promise;
    },
    addEventListener(type, cb) {
      if (type !== "change" || typeof cb !== "function" || listeners.has(cb)) return;
      const wrapped = (detail) => {
        try { cb(detail); } catch (error) { console.error("[plexus] listener failed", error); }
      };
      listeners.set(cb, wrapped);
      subscribe(emitter, "change", wrapped);
    },
    removeEventListener(type, cb) {
      if (type !== "change") return;
      const wrapped = listeners.get(cb);
      if (!wrapped) return;
      listeners.delete(cb);
      unsubscribe(emitter, "change", wrapped);
    },
  };
  return Object.freeze(api);
}

const fire = (win, type, detail, Ctor) => {
  try {
    const C = Ctor ?? win.CustomEvent ?? globalThis.CustomEvent;
    if (C) win.dispatchEvent(new C(type, { detail }));
  } catch (error) {
    console.warn("[plexus] event dispatch failed", error);
  }
};

export function installPublicApi(api, { win = globalThis.window ?? globalThis, CustomEventCtor } = {}) {
  win.RoamPlexus = api;
  fire(win, "roam-plexus:ready", { apiVersion: API_VERSION }, CustomEventCtor);
}

// Deletes window.RoamPlexus only if it is still ours; always announces unload.
export function uninstallPublicApi(api, { win = globalThis.window ?? globalThis, CustomEventCtor } = {}) {
  const ours = win.RoamPlexus === api;
  if (ours) delete win.RoamPlexus;
  fire(win, "roam-plexus:unload", { apiVersion: API_VERSION }, CustomEventCtor);
  return ours;
}
