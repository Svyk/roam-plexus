import { embedAnchors, parseEmbedRef } from "../model/embeds.js";
import { sceneToViewport } from "../model/scene.js";
import { subscribeViewport } from "../host/native.js";

export const EMBED_BLOCK_CAP = 30;
const CHILD_DEPTH = 2;

// Screen placement of an anchor: top-left corner after rotation about the element center, zoom, and a clip inset
// (local px, pre-transform) against the container rect. Rotated anchors skip the clip.
export function embedPlacement(el, appState, containerRect) {
  const zoom = appState?.zoom?.value || 1;
  const angle = Number(el.angle) || 0;
  let sx = el.x;
  let sy = el.y;
  if (angle) {
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    const dx = -el.width / 2;
    const dy = -el.height / 2;
    sx = cx + dx * Math.cos(angle) - dy * Math.sin(angle);
    sy = cy + dx * Math.sin(angle) + dy * Math.cos(angle);
  }
  const p = sceneToViewport({ x: sx, y: sy, appState });
  const transform = `translate(${p.x}px, ${p.y}px) scale(${zoom}) rotate(${angle}rad)`;
  let clip = null;
  let hidden = false;
  if (!angle && containerRect) {
    const right = p.x + el.width * zoom;
    const bottom = p.y + el.height * zoom;
    if (right <= containerRect.left || bottom <= containerRect.top || p.x >= containerRect.right || p.y >= containerRect.bottom) {
      hidden = true;
    } else {
      const inset = [
        (containerRect.top - p.y) / zoom,
        (right - containerRect.right) / zoom,
        (bottom - containerRect.bottom) / zoom,
        (containerRect.left - p.x) / zoom,
      ].map((v) => Math.max(0, v));
      if (inset.some((v) => v > 0)) clip = `inset(${inset.map((v) => `${v}px`).join(" ")})`;
    }
  }
  return { transform, clip, hidden, width: el.width, height: el.height };
}

// Read-only overlay of Roam blocks over their Excalidraw anchors. Lives only while an editor is mounted.
export function createEmbedOverlay({
  doc,
  api = globalThis.roamAlphaAPI,
  host,
  app,
  containerEl,
  zIndex = 1000,
  subscribe = subscribeViewport,
}) {
  const view = doc.defaultView;
  const portals = new Map();
  const watches = new Map();
  const dirty = new Set();
  let raf = null;
  let disposed = false;
  let unsubscribe = null;

  const requestFrame = (cb) => (typeof view?.requestAnimationFrame === "function" ? view.requestAnimationFrame(cb) : setTimeout(cb, 16));
  const cancelFrame = (id) => (typeof view?.cancelAnimationFrame === "function" ? view.cancelAnimationFrame(id) : clearTimeout(id));

  const unmountHosts = (portal) => {
    for (const el of portal.hosts) {
      try { api?.ui?.components?.unmountNode?.({ el }); } catch (error) { console.warn("[plexus] unmount failed", error); }
      el.remove?.();
    }
    portal.hosts.clear();
  };

  const renderInto = (portal, parent, string, className) => {
    const el = doc.createElement("div");
    el.className = className;
    parent.append(el);
    portal.hosts.add(el);
    try {
      api.ui.components.renderString({ el, string });
    } catch (error) {
      console.warn("[plexus] embed render failed", error);
      el.textContent = string;
    }
    return el;
  };

  const paint = (portal, content) => {
    unmountHosts(portal);
    portal.body.textContent = "";
    portal.title.textContent = content ? content.title || content.string || "" : "Block not found";
    if (!content) return;
    let budget = EMBED_BLOCK_CAP;
    if (content.kind !== "page" && content.string) {
      renderInto(portal, portal.body, content.string, "plexus-embed-block");
      budget -= 1;
    }
    const walk = (children, depth, parent) => {
      for (const child of children || []) {
        if (budget <= 0) return;
        budget -= 1;
        const row = doc.createElement("div");
        row.className = "plexus-embed-child";
        parent.append(row);
        portal.hosts.add(row);
        renderInto(portal, row, child.string ?? "", "plexus-embed-block");
        if (depth < CHILD_DEPTH && content.kind !== "page") walk(child.children, depth + 1, row);
      }
    };
    walk(content.children, 1, portal.body);
  };

  const watchUid = (portal, uid) => {
    if (!uid || !host.watchEmbed || portal.uid === uid) return;
    releaseWatch(portal);
    portal.uid = uid;
    let entry = watches.get(uid);
    if (!entry) {
      entry = { portals: new Set(), dispose: null };
      entry.dispose = host.watchEmbed(uid, () => {
        for (const p of entry.portals) dirty.add(p);
        schedule();
      });
      watches.set(uid, entry);
    }
    entry.portals.add(portal);
  };

  function releaseWatch(portal) {
    const uid = portal.uid;
    portal.uid = null;
    const entry = uid ? watches.get(uid) : null;
    if (!entry) return;
    entry.portals.delete(portal);
    if (entry.portals.size) return;
    watches.delete(uid);
    try { entry.dispose?.(); } catch (error) { console.warn("[plexus] unwatch failed", error); }
  }

  const load = async (portal) => {
    const gen = ++portal.gen;
    let content = null;
    try {
      content = await host.pullEmbedContent(portal.ref);
    } catch (error) {
      console.warn("[plexus] embed pull failed", error);
    }
    if (disposed || portal.dead || gen !== portal.gen) return;
    paint(portal, content);
    const uid = content?.uid ?? parseEmbedRef(portal.ref)?.uid;
    if (uid) watchUid(portal, uid);
  };

  const create = (el) => {
    const root = doc.createElement("div");
    root.className = "plexus-portal plexus-embed";
    root.setAttribute?.("aria-hidden", "true");
    root.style.zIndex = String(zIndex);
    const title = doc.createElement("div");
    title.className = "plexus-embed-title";
    const body = doc.createElement("div");
    body.className = "plexus-embed-body";
    root.append(title, body);
    doc.body.append(root);
    const portal = { root, title, body, hosts: new Set(), ref: el.customData.plexus.embed, uid: null, gen: 0, dead: false };
    portals.set(el.id, portal);
    void load(portal);
    return portal;
  };

  const remove = (id) => {
    const portal = portals.get(id);
    if (!portal) return;
    portals.delete(id);
    portal.dead = true;
    dirty.delete(portal);
    releaseWatch(portal);
    unmountHosts(portal);
    portal.root.remove();
  };

  let lastNonce;
  const sync = () => {
    // Nothing mounted and the scene has not changed since the last scan: a pure pan/zoom needs no work.
    const nonce = app.scene?.getSceneNonce?.();
    if (!portals.size && nonce !== undefined && nonce === lastNonce) return;
    lastNonce = nonce;
    const anchors = embedAnchors(app.getSceneElementsIncludingDeleted?.() ?? app.getSceneElements?.() ?? []);
    const ids = new Set(anchors.map((el) => el.id));
    for (const id of [...portals.keys()]) if (!ids.has(id)) remove(id);
    if (!anchors.length) return;
    const containerRect = containerEl.getBoundingClientRect();
    for (const el of anchors) {
      let portal = portals.get(el.id);
      const ref = el.customData.plexus.embed;
      if (portal && portal.ref !== ref) {
        portal.ref = ref;
        releaseWatch(portal);
        void load(portal);
      }
      if (!portal) portal = create(el);
      const place = embedPlacement(el, app.state, containerRect);
      const s = portal.root.style;
      s.width = `${place.width}px`;
      s.height = `${place.height}px`;
      s.transform = place.transform;
      s.clipPath = place.clip || "";
      s.display = place.hidden ? "none" : "";
    }
  };

  function schedule() {
    if (disposed || raf != null) return;
    raf = requestFrame(() => {
      raf = null;
      if (disposed) return;
      try {
        for (const portal of [...dirty]) {
          dirty.delete(portal);
          if (!portal.dead) void load(portal);
        }
        sync();
      } catch (error) {
        console.warn("[plexus] embed reposition failed", error);
      }
    });
  }

  unsubscribe = subscribe(app, schedule);
  schedule();

  return {
    portalCount: () => portals.size,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (raf != null) cancelFrame(raf);
      raf = null;
      try { unsubscribe?.(); } catch (error) { console.warn("[plexus] unsubscribe failed", error); }
      unsubscribe = null;
      for (const id of [...portals.keys()]) remove(id);
      for (const entry of [...watches.values()]) {
        try { entry.dispose?.(); } catch (error) { console.warn("[plexus] unwatch failed", error); }
      }
      watches.clear();
      dirty.clear();
    },
  };
}
