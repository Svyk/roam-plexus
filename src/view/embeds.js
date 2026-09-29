import { embedAnchors, parseEmbedRef } from "../model/embeds.js";
import { sceneToViewport } from "../model/scene.js";
import { subscribeViewport } from "../host/native.js";

export const EMBED_BLOCK_CAP = 30;
const CHILD_DEPTH = 2;
const LEAVE_WAIT_MS = 300;
const SELECTION_RECHECK_MS = 100;
const QUIET_CAP_MS = 900;
const FOCUS_WAIT_MS = 300;
const REFOCUS_WINDOW_MS = 1200;
// Popups Roam opens from a block editor. Measured only for the [[ autocomplete so far; extend after the live menu survey.
export const ROAM_MENU_SELECTOR = ".rm-autocomplete__results, .bp3-popover, .bp3-menu, .bp3-overlay-open";
const POPUP_HOST_SELECTOR = ".bp3-portal";
const MENU_KEYS = new Set(["Escape", "Enter", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"]);
const KEY_EVENTS = ["keydown", "keyup", "keypress", "input", "paste", "copy", "cut"];
const POINTER_ALWAYS = ["pointerdown", "mousedown", "dblclick", "wheel"];
const POINTER_GATED = ["pointerup", "mouseup", "click"];

function within(node, root) {
  for (let n = node; n; n = n.parentNode ?? n.parentElement) if (n === root) return true;
  return false;
}

const swallow = (e) => { e.preventDefault?.(); e.stopImmediatePropagation?.(); };

// F2 on the container starts edit mode for a selected embed anchor. Swallows F2 only when it acts.
export function installEmbedF2({ containerEl, app, canEdit, onEdit }) {
  const handler = (e) => {
    if (e.key !== "F2" || e.repeat || e.isComposing || e.keyCode === 229) return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.target !== containerEl) return;
    const st = app?.state || {};
    if (st.editingTextElement || st.openDialog || st.openMenu || st.openPopup || st.contextMenu) return;
    let ok = false;
    try { ok = !!canEdit(); } catch { ok = false; }
    if (!ok) return;
    swallow(e);
    Promise.resolve().then(onEdit).catch((error) => console.warn("[plexus] edit embed failed", error));
  };
  containerEl.addEventListener("keydown", handler, true);
  return () => containerEl.removeEventListener("keydown", handler, true);
}

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
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  waitQuiet = null,
  toast = () => {},
  onStateChange = () => {},
  menuSelector = ROAM_MENU_SELECTOR,
}) {
  const view = doc.defaultView;
  const portals = new Map();
  const watches = new Map();
  const dirty = new Set();
  let raf = null;
  let disposed = false;
  let unsubscribe = null;
  let session = null;
  let disposePromise = null;

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
    portal.title.textContent = content ? (content.kind === "page" ? content.title : content.pageTitle) || "" : "Block not found";
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
    if (portal.editing) { portal.stale = true; return; }
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

  // The overlay follows the editor's theme, not Roam's.
  const applyTheme = (portal) => {
    const theme = app.state?.theme === "dark" ? "dark" : "light";
    if (portal.theme === theme) return;
    portal.theme = theme;
    portal.root.setAttribute?.("data-theme", theme);
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
    const portal = { root, title, body, hosts: new Set(), ref: el.customData.plexus.embed, uid: null, gen: 0, dead: false, theme: null, editing: false, stale: false, removing: false, session: null };
    applyTheme(portal);
    portals.set(el.id, portal);
    void load(portal);
    return portal;
  };

  const remove = (id) => {
    const portal = portals.get(id);
    if (!portal) return;
    if (portal.session) {
      // An anchor that vanishes mid-edit (undo, remote change) leaves edit mode first, never unmounts under the editor.
      if (portal.removing) return;
      portal.removing = true;
      void leave("removed").then(() => { if (portals.get(id) === portal) remove(id); });
      return;
    }
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
        if (!portal.editing) releaseWatch(portal);
        void load(portal);
      }
      if (!portal) portal = create(el);
      const place = embedPlacement(el, app.state, containerRect);
      if (portal.editing) {
        const s = portal.session;
        if (s && s.phase !== "leaving") {
          if (place.hidden) void leave("hidden");
          else placeEditing(portal, el);
        }
        applyTheme(portal);
        continue;
      }
      const s = portal.root.style;
      s.width = `${place.width}px`;
      s.height = `${place.height}px`;
      s.transform = place.transform;
      s.clipPath = place.clip || "";
      s.display = place.hidden ? "none" : "";
      applyTheme(portal);
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
          if (portal.editing) portal.stale = true;
          else if (!portal.dead) void load(portal);
        }
        sync();
      } catch (error) {
        console.warn("[plexus] embed reposition failed", error);
      }
    });
  }

  // ---- edit mode: one live Roam block editor over one anchor ----

  const notify = () => { try { onStateChange(); } catch (error) { console.warn("[plexus] state listener failed", error); } };

  const anchorOf = (id) => embedAnchors(app.getSceneElementsIncludingDeleted?.() ?? app.getSceneElements?.() ?? []).find((el) => el.id === id) ?? null;

  const updateSelection = (ids, groups) => {
    try { app.updateScene({ appState: { selectedElementIds: ids, selectedGroupIds: groups } }); } catch (error) { console.warn("[plexus] selection update failed", error); }
  };

  function placeEditing(portal, el) {
    const p = sceneToViewport({ x: el.x, y: el.y, appState: app.state });
    portal.root.style.left = `${p.x}px`;
    portal.root.style.top = `${p.y}px`;
  }

  function applyEditGeometry(portal, el) {
    const zoom = app.state?.zoom?.value || 1;
    const rect = containerEl.getBoundingClientRect();
    const cw = rect.width ?? (rect.right - rect.left);
    const s = portal.root.style;
    s.transform = "";
    s.clipPath = "";
    s.display = "";
    s.width = `${Math.min(Math.max(el.width * zoom, 320), cw > 0 ? cw : Infinity)}px`;
    s.height = "auto";
    s.minHeight = `${el.height * zoom}px`;
    s.pointerEvents = "auto";
    s.zIndex = String(zIndex + 2);
    placeEditing(portal, el);
  }

  const defaultQuiet = (el) => new Promise((resolve) => {
    const MO = view?.MutationObserver ?? globalThis.MutationObserver;
    let frames = 0;
    let done = false;
    let mo = null;
    let cap = null;
    const finish = () => {
      if (done) return;
      done = true;
      try { mo?.disconnect(); } catch { /* already gone */ }
      clearTimeout(cap);
      resolve();
    };
    cap = setTimeout(finish, QUIET_CAP_MS);
    if (typeof MO === "function") {
      mo = new MO(() => { frames = 0; });
      mo.observe(el, { childList: true, subtree: true, attributes: true, characterData: true });
    }
    const tick = () => {
      if (done) return;
      frames += 1;
      if (frames >= 2) finish();
      else requestFrame(tick);
    };
    requestFrame(tick);
  });

  const rootInputOf = (s) => {
    const list = s.inner.querySelectorAll?.(".rm-block__input");
    if (!list) return null;
    return [...list].find((n) => String(n.id ?? "").endsWith(s.uid)) ?? null;
  };
  const isRootTextarea = (s, t) => !!t && t.tagName === "TEXTAREA" && within(t, s.inner) && String(t.id ?? "").endsWith(s.uid);
  const rootTextarea = (s) => {
    const list = s.inner.querySelectorAll?.("textarea");
    return list ? [...list].find((t) => isRootTextarea(s, t)) ?? null : null;
  };
  const caretToEnd = (ta) => {
    const n = String(ta.value ?? "").length;
    if (typeof ta.setSelectionRange === "function") ta.setSelectionRange(n, n);
    else { ta.selectionStart = n; ta.selectionEnd = n; }
  };

  function clickRoot(s) {
    const input = rootInputOf(s);
    if (!input) return false;
    const Mouse = view?.MouseEvent ?? globalThis.MouseEvent;
    for (const type of ["mousedown", "mouseup", "click"]) {
      input.dispatchEvent(new Mouse(type, { bubbles: true, cancelable: true, view }));
    }
    return true;
  }

  const focusedRoot = (s) => (isRootTextarea(s, doc.activeElement) ? doc.activeElement : null);

  async function focusRoot(s) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (s.phase !== "entering") return false;
      clickRoot(s);
      const end = Date.now() + FOCUS_WAIT_MS;
      for (;;) {
        const ta = focusedRoot(s);
        if (ta) { caretToEnd(ta); return true; }
        if (Date.now() >= end) break;
        await sleep(25);
        if (s.phase !== "entering") return false;
      }
    }
    return false;
  }

  function installGlobals(s) {
    const { portal } = s;
    const onKey = (e) => {
      if ((s.phase !== "active" && s.phase !== "entering") || e.isComposing || e.keyCode === 229) return;
      const t = e.target;
      if (s.phase === "entering") {
        // The editor is still mounting: Esc cancels, and keys outside the overlay must not reach Excalidraw's hotkeys.
        if (within(t, portal.root) || t?.closest?.(`${menuSelector}, ${POPUP_HOST_SELECTOR}`)) return;
        swallow(e);
        if (e.key === "Escape") void leave("keyboard");
        return;
      }
      if (!within(t, portal.root)) {
        if (t?.closest?.(`${menuSelector}, ${POPUP_HOST_SELECTOR}`)) return;
        // Focus fell to body (late hydration): keep the key away from Excalidraw and take focus back.
        swallow(e);
        const ta = rootTextarea(s);
        if (ta) {
          try { ta.focus?.({ preventScroll: true }); caretToEnd(ta); } catch (error) { console.warn("[plexus] refocus failed", error); }
        } else if (Date.now() - s.clickedAt > REFOCUS_WINDOW_MS) void leave("keyboard");
        else clickRoot(s);
        return;
      }
      const menuOpen = !!doc.querySelector?.(menuSelector);
      if (e.key === "Escape") {
        if (menuOpen) return;
        swallow(e);
        void leave("keyboard");
        return;
      }
      if (!t || t.tagName !== "TEXTAREA") return;
      const start = t.selectionStart;
      const end = t.selectionEnd;
      const len = String(t.value ?? "").length;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.altKey && !e.shiftKey && (e.code === "KeyA" || String(e.key).toLowerCase() === "a") && start === 0 && end === len) {
        swallow(e);
        return;
      }
      const key = e.key;
      // Block selection would leave the mount from any textarea in it, child blocks included.
      if (!menuOpen && ((key === "ArrowUp" && e.shiftKey && !e.altKey && !mod && start === 0) || (key === "ArrowDown" && e.shiftKey && !e.altKey && !mod && end === len))) { swallow(e); return; }
      if (menuOpen || !isRootTextarea(s, t)) return;
      if (key === "Enter" && !e.shiftKey && !mod && !e.altKey) { swallow(e); void leave("keyboard"); return; }
      const arrow = key === "ArrowUp" || key === "ArrowDown";
      if (key === "Tab"
        || (key === "Backspace" && start === 0 && end === 0)
        || (key === "Delete" && start === len && end === len)
        || (arrow && e.shiftKey && (e.altKey || mod))
        || (key === "ArrowUp" && e.shiftKey && start === 0)
        || (key === "ArrowDown" && e.shiftKey && end === len)) swallow(e);
    };
    const onDown = (e) => {
      if (s.phase !== "active" && s.phase !== "entering") return;
      const t = e.target;
      if (within(t, portal.root) || t?.closest?.(`${menuSelector}, ${POPUP_HOST_SELECTOR}`)) return;
      void leave("pointer");
    };
    const onUp = () => { s.downInside = false; };
    view.addEventListener("keydown", onKey, true);
    doc.addEventListener("pointerdown", onDown, true);
    doc.addEventListener("pointerup", onUp);
    s.globalOffs.push(
      () => view.removeEventListener("keydown", onKey, true),
      () => doc.removeEventListener("pointerdown", onDown, true),
      () => doc.removeEventListener("pointerup", onUp),
    );
  }

  function installStoppers(s) {
    const root = s.portal.root;
    const stop = (e) => e.stopPropagation();
    const on = (list, type, fn) => {
      root.addEventListener(type, fn);
      list.push(() => root.removeEventListener(type, fn));
    };
    // Roam handles its autocomplete navigation keys at document level, so while
    // a menu is open those keys must bubble; Excalidraw's selection is cleared
    // in edit mode, so its document handlers ignore them.
    const stopKey = (e) => {
      if (MENU_KEYS.has(e.key) && doc.querySelector?.(menuSelector)) return;
      e.stopPropagation();
    };
    for (const type of KEY_EVENTS) on(s.keyOffs, type, type === "keydown" || type === "keyup" ? stopKey : stop);
    for (const type of POINTER_ALWAYS) {
      on(s.pointerOffs, type, (e) => {
        if (type === "pointerdown" || type === "mousedown") s.downInside = true;
        e.stopPropagation();
      });
    }
    // A canvas drag released over the overlay must still reach Excalidraw's document pointerup.
    for (const type of POINTER_GATED) {
      on(s.pointerOffs, type, (e) => {
        if (s.downInside) e.stopPropagation();
        if (type === "click") s.downInside = false;
      });
    }
  }

  async function edit(id) {
    if (disposed) return false;
    if (session) {
      if (session.phase !== "leaving") return false;
      await session.leavePromise;
      if (disposed || session) return false;
    }
    const portal = portals.get(id);
    const target = portal && !portal.dead ? parseEmbedRef(portal.ref) : null;
    const anchor = target?.kind === "block" ? anchorOf(id) : null;
    if (!anchor) return false;
    const s = {
      id, portal, uid: target.uid, inner: doc.createElement("div"), phase: "entering", clickedAt: 0,
      leavePromise: null, keyOffs: [], pointerOffs: [], globalOffs: [], downInside: false, prev: null,
    };
    session = s;
    portal.session = s;
    portal.editing = true;
    portal.gen += 1;
    dirty.delete(portal);
    notify();
    installStoppers(s);
    installGlobals(s);
    s.prev = { ids: { ...(app.state?.selectedElementIds || {}) }, groups: { ...(app.state?.selectedGroupIds || {}) } };
    updateSelection({}, {});
    unmountHosts(portal);
    portal.body.textContent = "";
    s.inner.className = "plexus-embed-editor";
    portal.body.append(s.inner);
    portal.root.className = "plexus-portal plexus-embed plexus-embed--editing";
    portal.root.removeAttribute?.("aria-hidden");
    applyEditGeometry(portal, anchor);
    try {
      api.ui.components.renderBlock({ uid: s.uid, el: s.inner });
    } catch (error) {
      console.warn("[plexus] editable embed render failed", error);
      toast("Could not open the block editor");
      await leave("error");
      return false;
    }
    await (waitQuiet ?? defaultQuiet)(s.inner);
    if (s.phase !== "entering") return false;
    if (!(await focusRoot(s))) {
      if (s.phase === "entering") {
        toast("Could not open the block editor");
        await leave("error");
      }
      return false;
    }
    s.clickedAt = Date.now();
    s.phase = "active";
    notify();
    return true;
  }

  function leave(trigger = "api") {
    const s = session;
    if (!s) return Promise.resolve();
    if (s.leavePromise) return s.leavePromise;
    s.phase = "leaving";
    s.leavePromise = runLeave(s, trigger);
    return s.leavePromise;
  }

  async function ownsSelection(s) {
    try {
      const get = api?.ui?.multiselect?.getSelected;
      if (typeof get !== "function") return false;
      const list = await get.call(api.ui.multiselect);
      const prefix = `render-block-path-${s.uid}`;
      return Array.isArray(list) && list.some((x) => String(x?.["window-id"] ?? "").startsWith(prefix));
    } catch (error) {
      console.warn("[plexus] selection read failed", error);
      return false;
    }
  }

  async function clearMountSelection(s) {
    if (!(await ownsSelection(s))) return;
    dispatchEscape();
    await sleep(SELECTION_RECHECK_MS);
    if (await ownsSelection(s)) dispatchEscape();
  }

  function dispatchEscape() {
    try {
      const View = doc.defaultView;
      const Ctor = View?.KeyboardEvent ?? globalThis.KeyboardEvent;
      doc.dispatchEvent(new Ctor("keydown", { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true }));
    } catch (error) {
      console.warn("[plexus] selection clear failed", error);
    }
  }

  async function runLeave(s, trigger) {
    const { portal, inner } = s;
    // 1. no more pointer traffic, no more window/document capture listeners
    for (const off of s.globalOffs.splice(0)) off();
    for (const off of s.pointerOffs.splice(0)) off();
    portal.root.style.pointerEvents = "none";
    notify();
    // 2. blur
    const active = doc.activeElement;
    if (active && within(active, inner)) { try { active.blur?.(); } catch (error) { console.warn("[plexus] blur failed", error); } }
    // 3. keys must reach Excalidraw, not body
    const keyboard = trigger === "keyboard";
    if (keyboard) { try { containerEl.focus?.({ preventScroll: true }); } catch (error) { console.warn("[plexus] container focus failed", error); } }
    // 4. let Roam save
    await sleep(LEAVE_WAIT_MS);
    // 5. unmount
    try { api?.ui?.components?.unmountNode?.({ el: inner }); } catch (error) { console.warn("[plexus] unmount failed", error); }
    inner.remove?.();
    // 6. restore read-only mode
    for (const off of s.keyOffs.splice(0)) off();
    portal.root.className = "plexus-portal plexus-embed";
    portal.root.setAttribute?.("aria-hidden", "true");
    const st = portal.root.style;
    st.pointerEvents = "";
    st.zIndex = String(zIndex);
    st.left = "";
    st.top = "";
    st.minHeight = "";
    portal.editing = false;
    portal.stale = false;
    portal.session = null;
    session = null;
    if (!disposed && !portal.dead && !portal.removing) {
      void load(portal);
      try { sync(); } catch (error) { console.warn("[plexus] embed reposition failed", error); }
    }
    // 6b. Roam's block selection can outlive the mount; its Delete would remove the edited blocks
    await clearMountSelection(s);
    // 7. keyboard leave: give the selection back if the anchors are all still there
    if (keyboard && !disposed && s.prev) {
      const live = new Set((app.getSceneElements?.() ?? app.getSceneElementsIncludingDeleted?.() ?? []).filter((e) => !e.isDeleted).map((e) => e.id));
      const now = app.state || {};
      const untouched = !Object.keys(now.selectedElementIds || {}).length && !Object.keys(now.selectedGroupIds || {}).length;
      if (untouched && Object.keys(s.prev.ids).every((id) => live.has(id))) updateSelection(s.prev.ids, s.prev.groups);
    }
    notify();
  }

  unsubscribe = subscribe(app, schedule);
  schedule();

  return {
    portalCount: () => portals.size,
    isEditing: () => !!session,
    editState: () => session?.phase ?? "idle",
    editingId: () => session?.id ?? null,
    edit,
    leave,
    dispose() {
      if (disposed) return disposePromise;
      disposed = true;
      if (raf != null) cancelFrame(raf);
      raf = null;
      try { unsubscribe?.(); } catch (error) { console.warn("[plexus] unsubscribe failed", error); }
      unsubscribe = null;
      const finish = () => {
        for (const id of [...portals.keys()]) remove(id);
        for (const entry of [...watches.values()]) {
          try { entry.dispose?.(); } catch (error) { console.warn("[plexus] unwatch failed", error); }
        }
        watches.clear();
        dirty.clear();
      };
      if (session) {
        disposePromise = leave("unload").then(finish, (error) => { console.warn("[plexus] leave failed", error); finish(); });
      } else {
        finish();
        disposePromise = Promise.resolve();
      }
      return disposePromise;
    },
  };
}
