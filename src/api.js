import { parseRegion } from "./model/region.js";

export const API_VERSION = 1;

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
export function createPublicApi({ host, actions, emitter, version } = {}) {
  const listeners = new Map();

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
      return host.regionsOf(uid).map(({ uid: regionUid, region }) => ({ uid: regionUid, kind: region.kind, caption: region.caption ?? "" }));
    },
    drawingsOn(pageUid) { return host.drawingsOn(pageUid); },
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
