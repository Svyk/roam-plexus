// NAV-7: a docked outline over the full-screen editor. It renders every direct child of the drawing block (or of
// its parent block) in its own renderBlock, so Roam's editing stays in the dock and off the canvas.
// Key and pointer ownership follows the editable embed (embeds.js), which this file must not edit.

import { isHostDark, parseColor, resetThemeMemo } from "../host/theme.js";

export const PLEXUS_REF_MIME = "application/x-plexus-ref";
export const DOCK_MIN_WIDTH = 240;
export const DOCK_MAX_WIDTH = 640;
// Roam popups opened from a block editor. Tooltips are not menus; a hover preview's class is measured live.
export const DOCK_MENU_SELECTOR = ".rm-autocomplete__results, .bp3-menu, .bp3-overlay-open:not(.bp3-toast-container), .bp3-popover:not(.bp3-tooltip)";

const LEAVE_WAIT_MS = 300;
const SELECTION_RECHECK_MS = 100;
const REFOCUS_WINDOW_MS = 1200;
const STRAY_FOCUS_MS = 500;
const POLL_MS = 25;
const ADD_POLL_MAX_MS = 1000;
const FOCUS_WAIT_MS = 300;
const LABEL_MAX = 60;
const CHILDREN_PATTERN = "[:block/uid {:block/children [:block/uid :block/order]}]";
const REF_SELECTOR = "[data-link-title], [data-tag], .rm-page-ref, .rm-block-ref[data-uid], .rm-alias[data-link-uid], .rm-alias[data-link-title]";
const POPUP_HOST_SELECTOR = ".bp3-portal";
const BLOCK_SELECTOR = '.rm-block__input, [id^="block-input-"]';
// Duplicated from embeds.js: Roam handles its autocomplete navigation at document level.
const MENU_ESC_SETTLE_MS = 150;
const MENU_KEYS = new Set(["Escape", "Enter", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"]);
const KEY_EVENTS = ["keydown", "keyup", "keypress", "input", "paste", "copy", "cut"];
const POINTER_EVENTS = ["pointerdown", "mousedown", "wheel", "dblclick", "contextmenu"];

// Set while the dock dispatches its own Escape so its capture listeners do not swallow it.
let synthetic = false;

function within(node, root) {
  for (let n = node; n; n = n.parentNode ?? n.parentElement) if (n === root) return true;
  return false;
}

const swallow = (e) => { e.preventDefault?.(); e.stopImmediatePropagation?.(); };
const isTextarea = (n) => n?.tagName === "TEXTAREA";
const hasClass = (n, name) => (n?.classList ? n.classList.contains(name) : String(n?.className ?? "").split(/\s+/).includes(name));
const addClass = (n, name) => { if (n?.classList) n.classList.add(name); else if (n && !hasClass(n, name)) n.className = `${n.className} ${name}`.trim(); };
const removeClass = (n, name) => {
  if (n?.classList) n.classList.remove(name);
  else if (n) n.className = String(n.className).split(/\s+/).filter((c) => c && c !== name).join(" ");
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const uidOfId = (id) => String(id ?? "").slice(-9);
const sameKeys = (a = {}, b = {}) => {
  const ka = Object.keys(a).filter((k) => a[k]);
  const kb = Object.keys(b).filter((k) => b[k]);
  return ka.length === kb.length && ka.every((k) => b[k]);
};

export function createDock({
  doc,
  api = globalThis.roamAlphaAPI,
  app,
  containerEl,
  outerEl,
  drawingUid,
  zIndex = 1000,
  width = 320,
  onWidth = () => {},
  onClose = () => {},
  onNavigate = () => {},
  mac,
  parentOf = () => null,
  addBlock = async () => null,
  toast = () => {},
  raf,
  setTimeout: setTimer = globalThis.setTimeout,
  clearTimeout: clearTimer = globalThis.clearTimeout,
  MutationObserver: MO,
  menuSelector = DOCK_MENU_SELECTOR,
  now = () => Date.now(),
}) {
  const view = doc.defaultView;
  const requestFrame = raf ?? ((cb) => (typeof view?.requestAnimationFrame === "function" ? view.requestAnimationFrame(cb) : setTimer(cb, 16)));
  const isMac = mac ?? /Mac/i.test(String(view?.navigator?.platform ?? ""));
  const MutationObs = MO ?? view?.MutationObserver ?? globalThis.MutationObserver;

  let open = true;
  let rootKind = "drawing";
  let rootUid = drawingUid;
  let childUids = [];
  const hosts = new Map();
  let unwatch = null;
  let editing = false;
  let focusUid = null;
  let lastTa = null;
  let lastCaret = null;
  let lastKeyAt = 0;
  let strayLogged = false;
  let requestedWidth = clamp(Number(width) || 320, DOCK_MIN_WIDTH, DOCK_MAX_WIDTH);
  let applyQueued = false;
  let drag = null;
  let narrowMode = "narrowed";
  let escapeVia = null;
  let focusGen = 0;
  let clearGen = 0;
  let rootGen = 0;
  let closePromise = null;
  let overlayLogged = false;
  const pending = new Set();
  const offs = [];

  const warn = (what, error) => console.warn(`[plexus] dock ${what}`, error);
  const safe = (what, fn) => (...args) => {
    try { return fn(...args); } catch (error) { warn(`${what} failed`, error); return undefined; }
  };
  const on = (target, type, fn, capture = false) => {
    if (!target?.addEventListener) return;
    target.addEventListener(type, fn, capture);
    offs.push(() => target.removeEventListener?.(type, fn, capture));
  };

  // Tracked waits: close() resolves them all with false.
  const wait = (ms) => new Promise((resolve) => {
    let rec = null;
    const t = setTimer(() => { pending.delete(rec); resolve(true); }, ms);
    rec = { cancel: () => { clearTimer(t); resolve(false); } };
    pending.add(rec);
  });
  const frames = (n) => new Promise((resolve) => {
    let left = n;
    const rec = { live: true, cancel: () => { rec.live = false; resolve(false); } };
    pending.add(rec);
    const tick = () => {
      if (!rec.live) return;
      left -= 1;
      if (left <= 0) { pending.delete(rec); resolve(true); } else requestFrame(tick);
    };
    requestFrame(tick);
  });
  const cancelPending = () => { for (const rec of [...pending]) rec.cancel(); pending.clear(); };

  // ---- DOM ----
  const el = doc.createElement("div");
  el.className = "plexus-portal plexus-dock";
  el.style.zIndex = String(zIndex + 2);
  el.setAttribute?.("role", "complementary");
  el.setAttribute?.("aria-label", "Outline");
  const handle = doc.createElement("div");
  handle.className = "plexus-dock-handle";
  const header = doc.createElement("div");
  header.className = "plexus-dock-header";
  const label = doc.createElement("div");
  label.className = "plexus-dock-label";
  const parentBtn = doc.createElement("button");
  parentBtn.className = "plexus-dock-button plexus-dock-parent";
  parentBtn.textContent = "Parent";
  parentBtn.setAttribute?.("type", "button");
  const closeBtn = doc.createElement("button");
  closeBtn.className = "plexus-dock-button plexus-dock-close";
  closeBtn.textContent = "×";
  closeBtn.setAttribute?.("type", "button");
  closeBtn.setAttribute?.("aria-label", "Close outline");
  const body = doc.createElement("div");
  body.className = "plexus-dock-body";
  const footer = doc.createElement("div");
  footer.className = "plexus-dock-footer";
  const addBtn = doc.createElement("button");
  addBtn.className = "plexus-dock-add";
  addBtn.textContent = "+ Add a block";
  addBtn.setAttribute?.("type", "button");
  footer.append(addBtn);
  header.append(label, parentBtn, closeBtn);
  el.append(handle, header, body, footer);

  const styleEl = doc.createElement("style");
  styleEl.setAttribute?.("data-plexus-dock", "");
  const styleHost = doc.head ?? doc.body;

  let parentInfo = null;
  try { parentInfo = parentOf(drawingUid) ?? null; } catch (error) { warn("parentOf failed", error); }
  const hasParent = !!parentInfo && parentInfo.isPage === false && !!parentInfo.uid;
  parentBtn.hidden = !hasParent;
  if (!hasParent) parentBtn.setAttribute?.("hidden", "");

  // ---- geometry ----
  const effectiveWidth = () => {
    const inner = Number(view?.innerWidth) || DOCK_MAX_WIDTH * 2;
    return clamp(requestedWidth, DOCK_MIN_WIDTH, Math.max(DOCK_MIN_WIDTH, Math.min(DOCK_MAX_WIDTH, Math.floor(inner / 2))));
  };
  let theme = null;
  let themeBg = null;
  // The dock renders Roam blocks, so it follows Roam's theme and its painted background, not the canvas theme.
  // Roam paints only body: take the first non-transparent background walking body, then the root element.
  const hostBackground = () => {
    for (const node of [doc.body, doc.documentElement]) {
      if (!node) continue;
      const c = parseColor(view?.getComputedStyle?.(node)?.backgroundColor);
      if (c && c.a > 0) return String(view.getComputedStyle(node).backgroundColor);
    }
    return null;
  };
  const applyTheme = () => {
    const next = isHostDark(doc) ? "dark" : "light";
    if (next !== theme) {
      theme = next;
      el.setAttribute?.("data-theme", next);
    }
    const bg = hostBackground();
    if (bg !== themeBg) {
      themeBg = bg;
      if (bg == null) el.style.removeProperty?.("--plexus-dock-bg");
      else if (typeof el.style.setProperty === "function") el.style.setProperty("--plexus-dock-bg", bg);
      else el.style["--plexus-dock-bg"] = bg;
    }
  };
  const refreshTheme = () => {
    if (!open) return;
    resetThemeMemo();
    applyTheme();
  };
  const applyWidth = () => {
    styleEl.textContent = `.plexus-dock-narrowed, .plexus-dock { --plexus-dock-w: ${effectiveWidth()}px; } body.plexus-dock-open { --plexus-dock-z: ${zIndex + 2}; }`;
    applyTheme();
  };
  const scheduleApply = () => {
    if (applyQueued || !open) return;
    applyQueued = true;
    requestFrame(() => { applyQueued = false; if (open) applyWidth(); });
  };

  const widthOf = () => app?.state?.width;

  async function verifyNarrow(w0) {
    if (typeof w0 !== "number") return;
    if (!(await frames(2))) return;
    if (widthOf() !== w0) return;
    try {
      const Ev = view?.Event ?? globalThis.Event;
      view?.dispatchEvent?.(new Ev("resize"));
    } catch (error) { warn("resize dispatch failed", error); }
    if (!(await frames(2))) return;
    if (widthOf() !== w0) return;
    narrowMode = "overlay";
    removeClass(outerEl, "plexus-dock-narrowed");
    addClass(el, "plexus-dock--overlay");
    try {
      const icon = outerEl?.querySelector?.(".bp3-icon-minimize");
      const rect = icon?.getBoundingClientRect?.();
      if (rect && Number.isFinite(rect.bottom)) el.style.top = `${Math.ceil(rect.bottom)}px`;
    } catch (error) { warn("overlay offset failed", error); }
    if (!overlayLogged) { overlayLogged = true; console.warn("[plexus] dock overlays the canvas: Excalidraw did not follow the narrowed container"); }
  }

  // ---- selection helpers ----
  const highlight = () => !!el.querySelector?.(".block-highlight-blue");
  const dockHasTextarea = () => !!el.querySelector?.("textarea");
  const focusedTa = () => (isTextarea(doc.activeElement) && within(doc.activeElement, el) ? doc.activeElement : null);
  const menuOpen = () => !!doc.querySelector?.(menuSelector);

  const snapSel = () => ({ ids: { ...(app?.state?.selectedElementIds || {}) }, groups: { ...(app?.state?.selectedGroupIds || {}) } });
  const restoreSel = safe("selection restore", (snap) => {
    if (!snap || !app) return;
    const st = app.state || {};
    if (sameKeys(st.selectedElementIds, snap.ids) && sameKeys(st.selectedGroupIds, snap.groups)) return;
    const live = new Set((app.getSceneElements?.() ?? app.getSceneElementsIncludingDeleted?.() ?? []).filter((x) => !x.isDeleted).map((x) => x.id));
    if (!Object.keys(snap.ids).every((id) => live.has(id))) return;
    app.updateScene({ appState: { selectedElementIds: snap.ids, selectedGroupIds: snap.groups } });
  });

  async function ownsSelection() {
    try {
      const get = api?.ui?.multiselect?.getSelected;
      if (typeof get !== "function") return false;
      const list = await get.call(api.ui.multiselect);
      const prefixes = [rootUid, ...childUids].map((u) => `render-block-path-${u}`);
      return Array.isArray(list) && list.some((x) => {
        const id = String(x?.["window-id"] ?? "");
        return prefixes.some((p) => id.startsWith(p));
      });
    } catch (error) {
      warn("selection read failed", error);
      return false;
    }
  }

  function dispatchEscape(via) {
    escapeVia = via;
    const target = via === "document" ? doc : view;
    synthetic = true;
    try {
      const Ctor = view?.KeyboardEvent ?? globalThis.KeyboardEvent;
      target?.dispatchEvent?.(new Ctor("keydown", { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true }));
    } catch (error) {
      warn("synthetic Escape failed", error);
    } finally {
      synthetic = false;
    }
  }

  // Window first (Roam listens there, Excalidraw does not); document only if the selection survived, with the canvas selection restored.
  // Roam turns a trusted Esc into a block selection from its own window capture listener, before the dock sees the key,
  // so the leave always runs these rounds instead of trusting the state at Esc time. Focus returns to the canvas after.
  async function clearSelection({ refocus = false } = {}) {
    const my = ++clearGen;
    try { await clearRounds(my); } finally {
      if (refocus && my === clearGen && open) {
        const a = doc.activeElement;
        if (!a || a === doc.body || a === doc.documentElement) {
          try { containerEl?.focus?.({ preventScroll: true }); } catch (error) { warn("container focus failed", error); }
        }
      }
    }
  }

  async function clearRounds(my) {
    let dispatched = false;
    if (highlight() || (await ownsSelection())) { dispatchEscape("window"); dispatched = true; }
    for (let round = 0; round < 2; round++) {
      if (!(await wait(SELECTION_RECHECK_MS)) || my !== clearGen || !open) return;
      const held = highlight() || (await ownsSelection());
      if (my !== clearGen || !open) return;
      if (!dispatched) {
        // The window Escape from edit mode can itself highlight a block, so look again after it.
        if (!dockHasTextarea() && !held) return;
        dispatchEscape("window");
        dispatched = true;
        continue;
      }
      if (round === 0 ? (dockHasTextarea() || held) : held) {
        const snap = snapSel();
        dispatchEscape("document");
        setTimer(() => restoreSel(snap), 0);
      }
      return;
    }
  }

  function leaveEditing({ refocus = true } = {}) {
    const ta = focusedTa();
    if (ta) { try { ta.blur?.(); } catch (error) { warn("blur failed", error); } }
    editing = false;
    if (refocus) { try { containerEl?.focus?.({ preventScroll: true }); } catch (error) { warn("container focus failed", error); } }
    void clearSelection({ refocus }).catch((error) => warn("selection clear failed", error));
  }

  // ---- focus ----
  const findInput = (uid) => [...(body.querySelectorAll?.(".rm-block__input") ?? [])].find((n) => String(n.id ?? "").endsWith(uid)) ?? null;
  const focusedBlockTa = (uid) => {
    const ta = focusedTa();
    return ta && String(ta.id ?? "").endsWith(uid) ? ta : null;
  };
  const caretToEnd = (ta) => {
    const n = String(ta.value ?? "").length;
    if (typeof ta.setSelectionRange === "function") ta.setSelectionRange(n, n);
    else { ta.selectionStart = n; ta.selectionEnd = n; }
  };
  function clickInput(input) {
    const Mouse = view?.MouseEvent ?? globalThis.MouseEvent;
    for (const type of ["mousedown", "mouseup", "click"]) input.dispatchEvent(new Mouse(type, { bubbles: true, cancelable: true, view }));
  }

  // Click-to-focus, never setBlockFocusAndSelection. Polls for the block's input, then for its textarea.
  async function focusBlock(uid) {
    const my = ++focusGen;
    const stale = () => !open || my !== focusGen;
    let input = null;
    for (let waited = 0; ; waited += POLL_MS) {
      input = findInput(uid);
      if (input || waited >= ADD_POLL_MAX_MS) break;
      if (!(await wait(POLL_MS)) || stale()) return false;
    }
    if (!input) return false;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (stale()) return false;
      try { clickInput(findInput(uid) ?? input); } catch (error) { warn("focus click failed", error); return false; }
      for (let waited = 0; waited <= FOCUS_WAIT_MS; waited += POLL_MS) {
        const ta = focusedBlockTa(uid);
        if (ta) { caretToEnd(ta); return true; }
        if (!(await wait(POLL_MS)) || stale()) return false;
      }
    }
    return false;
  }

  // ---- children ----
  const uidsOf = (pulled) => (Array.isArray(pulled?.[":block/children"]) ? pulled[":block/children"] : [])
    .slice()
    .sort((a, b) => (a?.[":block/order"] ?? 0) - (b?.[":block/order"] ?? 0))
    .map((c) => c?.[":block/uid"])
    .filter(Boolean);

  function unmountHost(h) {
    try { api?.ui?.components?.unmountNode?.({ el: h }); } catch (error) { warn("unmount failed", error); }
    h.remove?.();
  }

  // Diffing keeps a focused block's host in place; moving a focused node in the DOM would blur it.
  function syncList(uids) {
    // Moving a host that holds the focused textarea blurs it: remember it and put focus back after reordering.
    const active = doc.activeElement;
    const held = isTextarea(active) && within(active, el) ? { ta: active, start: active.selectionStart, end: active.selectionEnd } : null;
    for (const [uid, h] of [...hosts]) {
      if (!uids.includes(uid)) { unmountHost(h); hosts.delete(uid); }
    }
    uids.forEach((uid, i) => {
      let h = hosts.get(uid);
      const fresh = !h;
      if (fresh) {
        h = doc.createElement("div");
        h.className = "plexus-dock-child";
        hosts.set(uid, h);
      }
      const at = body.children?.[i] ?? null;
      if (at !== h) body.insertBefore(h, at);
      if (fresh) {
        try { api.ui.components.renderBlock({ uid, el: h, "open?": true }); } catch (error) {
          warn("block render failed", error);
          h.textContent = "Could not render this block";
        }
      }
    });
    childUids = uids;
    if (held && within(held.ta, el) && doc.activeElement !== held.ta) {
      try {
        held.ta.focus?.({ preventScroll: true });
        if (typeof held.ta.setSelectionRange === "function") held.ta.setSelectionRange(held.start, held.end);
        else { held.ta.selectionStart = held.start; held.ta.selectionEnd = held.end; }
      } catch (error) { warn("focus restore failed", error); }
    }
  }

  function blockExists(uid) {
    try { return api.data.pull("[:block/uid]", `[:block/uid "${String(uid).replace(/["\\]/g, "")}"]`) != null; } catch { return true; }
  }

  // A merged or deleted block cannot take focus: follow the block that was drawn above it, else the first remaining one.
  function neighbourInput(prev, uids, goneUid) {
    const before = prev[prev.indexOf(goneUid) - 1];
    const host = hosts.get(before && uids.includes(before) ? before : uids[0]);
    const inputs = host?.querySelectorAll?.(".rm-block__input") ?? [];
    const last = inputs[inputs.length - 1];
    return last ? uidOfId(last.id) : null;
  }

  function onChildren(uids) {
    if (!open) return;
    if (uids.length === childUids.length && uids.every((u, i) => u === childUids[i])) return;
    const prev = childUids;
    const added = uids.filter((u) => !prev.includes(u));
    const removed = prev.filter((u) => !uids.includes(u));
    let follow = null;
    let gone = null;
    if (editing) {
      follow = added.length ? added[added.length - 1] : (focusUid && removed.includes(focusUid) ? focusUid : null);
      if (follow && !added.length && !blockExists(follow)) { gone = follow; follow = null; }
    }
    syncList(uids);
    if (gone) follow = neighbourInput(prev, uids, gone);
    if (gone && !follow) editing = false;
    if (follow) void focusBlock(follow).catch((error) => warn("focus follow failed", error));
  }

  // The open drawing's own row would render a second copy of it, with a live full-screen icon.
  const visible = (uids) => (rootKind === "parent" ? uids.filter((u) => u !== drawingUid) : uids);

  function startWatch(uid) {
    const ident = `[:block/uid "${String(uid).replace(/["\\]/g, "")}"]`;
    let initial = [];
    try { initial = visible(uidsOf(api.data.pull(CHILDREN_PATTERN, ident))); } catch (error) { warn("children pull failed", error); }
    syncList(initial);
    if (typeof api?.data?.addPullWatch !== "function") return;
    const handler = (_before, after) => {
      try { onChildren(visible(uidsOf(after))); } catch (error) { warn("children watch failed", error); }
    };
    try { api.data.addPullWatch(CHILDREN_PATTERN, ident, handler); } catch (error) { warn("children watch failed", error); return; }
    unwatch = () => {
      unwatch = null;
      try { api.data.removePullWatch(CHILDREN_PATTERN, ident, handler); } catch (error) { warn("removePullWatch failed", error); }
    };
  }

  // ---- header ----
  let dragRef = null;
  function updateHeader() {
    let text = "";
    dragRef = null;
    if (rootKind === "parent") {
      text = String(parentInfo?.title ?? "").slice(0, LABEL_MAX);
      if (parentInfo?.uid) dragRef = `((${parentInfo.uid}))`;
    } else {
      text = String(parentInfo?.pageTitle ?? "");
      if (text) dragRef = `[[${text}]]`;
    }
    label.textContent = text || "Outline";
    label.draggable = !!dragRef;
    label.setAttribute?.("draggable", dragRef ? "true" : "false");
    if (rootKind === "parent") addClass(el, "plexus-dock--parent-root");
    else removeClass(el, "plexus-dock--parent-root");
    parentBtn.setAttribute?.("aria-pressed", rootKind === "parent" ? "true" : "false");
  }

  async function setRoot(which) {
    if (!open || (which !== "drawing" && which !== "parent")) return false;
    if (which === rootKind) return true;
    let target = drawingUid;
    if (which === "parent") {
      if (!hasParent) return false;
      target = parentInfo.uid;
    }
    const my = ++rootGen;
    if (focusedTa() || editing) {
      leaveEditing();
      await new Promise((resolve) => setTimer(resolve, LEAVE_WAIT_MS));
      if (!open || my !== rootGen) return false;
    }
    try { unwatch?.(); } catch (error) { warn("unwatch failed", error); }
    unwatch = null;
    for (const h of hosts.values()) unmountHost(h);
    hosts.clear();
    childUids = [];
    rootUid = target;
    rootKind = which;
    updateHeader();
    startWatch(rootUid);
    return true;
  }

  // ---- listeners ----
  function installKeys() {
    // Esc is decided in capture, before Roam's React root sees it: by bubble time a menu that this same Esc closed reads as gone.
    on(el, "keydown", safe("keydown", (e) => {
      if (synthetic || !e.isTrusted || e.isComposing || e.keyCode === 229) return;
      lastKeyAt = now();
      const t = e.target;
      if (isTextarea(t)) lastCaret = { ta: t, start: t.selectionStart, end: t.selectionEnd };
      const mOpen = menuOpen();
      if (e.key === "Escape") {
        if (mOpen) {
          const snap = snapSel();
          setTimer(() => restoreSel(snap), 0);
          // Roam closes the menu and also leaves editing on this Esc (measured in the sidebar); finish it as a leave.
          setTimer(() => {
            if (!open || dockHasTextarea()) return;
            editing = false;
            void clearSelection({ refocus: true }).catch((error) => warn("selection clear failed", error));
          }, MENU_ESC_SETTLE_MS);
          return;
        }
        if (isTextarea(t)) { swallow(e); leaveEditing(); }
        return;
      }
      if (!isTextarea(t)) return;
      const start = t.selectionStart;
      const end = t.selectionEnd;
      const len = String(t.value ?? "").length;
      const key = e.key;
      const mod = e.metaKey || e.ctrlKey;
      const blocks = [...(el.querySelectorAll?.(BLOCK_SELECTOR) ?? [])].map((n) => uidOfId(n.id));
      const mine = uidOfId(t.id);
      const isFirst = !blocks.length || blocks[0] === mine;
      const isLast = !blocks.length || blocks[blocks.length - 1] === mine;
      const direct = childUids.findIndex((u) => String(t.id ?? "").endsWith(u));
      // A menu consumes the navigation keys; the destructive edge keys never navigate one, so they stay guarded.
      let deny = false;
      if (mod && !e.altKey && !e.shiftKey && (e.code === "KeyA" || String(key).toLowerCase() === "a") && start === 0 && end === len) deny = true;
      else if (direct >= 0 && key === "Tab" && e.shiftKey) deny = true;
      else if (direct >= 0 && e.shiftKey && (e.altKey || mod)
        && ((key === "ArrowUp" && direct === 0) || (key === "ArrowDown" && direct === childUids.length - 1))) deny = true;
      else if (e.shiftKey && !e.altKey && !mod && ((key === "ArrowUp" && start === 0) || (key === "ArrowDown" && end === len))) deny = !mOpen;
      else if (isFirst && key === "Backspace" && start === 0 && end === 0) deny = true;
      else if (isFirst && ((key === "ArrowLeft" && start === 0 && end === 0) || (key === "ArrowUp" && start === 0))) deny = !mOpen;
      else if (isLast && key === "Delete" && start === len && end === len) deny = true;
      else if (isLast && ((key === "ArrowRight" && end === len) || (key === "ArrowDown" && end === len))) deny = !mOpen;
      if (deny) swallow(e);
    }), true);

    // Roam's undo and redo live on window/document; Excalidraw's document keydown bails on writable targets (D8).
    const undoChord = (e) => {
      const k = String(e.key).toLowerCase();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.altKey && k === "z") return true;
      return !isMac && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && k === "y";
    };
    const stopKey = (e) => {
      if (MENU_KEYS.has(e.key) && menuOpen()) return;
      if (e.type === "keydown" && isTextarea(e.target) && undoChord(e)) return;
      if (e.key === "Escape" && !isTextarea(e.target)) return;
      e.stopPropagation();
    };
    const stop = (e) => e.stopPropagation();
    for (const type of KEY_EVENTS) on(el, type, type === "keydown" || type === "keyup" ? stopKey : stop);
    for (const type of POINTER_EVENTS) on(el, type, stop);

    // A plain bullet click zooms the main window and would destroy the full-screen editor (D12).
    on(el, "click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (e.target?.closest?.(".rm-bullet")) { e.preventDefault?.(); e.stopPropagation?.(); }
    }, true);

    // A plain click on a Roam ref navigates the main window and would destroy the full-screen editor: navigate like a canvas link.
    const refTarget = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.button ?? 0) !== 0) return null;
      const ref = e.target?.closest?.(REF_SELECTOR);
      if (!ref || !within(ref, el)) return null;
      const attr = (n, name) => n?.getAttribute?.(name) ?? null;
      const uid = attr(ref, "data-uid") ?? attr(ref, "data-link-uid");
      const title = attr(ref, "data-link-title") ?? attr(ref, "data-tag");
      if (title) return { type: "page", title };
      if (uid) {
        try {
          const page = api.data.pull("[:node/title]", `[:block/uid "${String(uid).replace(/["\\]/g, "")}"]`);
          if (page?.[":node/title"]) return { type: "page", title: page[":node/title"] };
        } catch (error) { warn("ref pull failed", error); }
        return { type: "block", uid };
      }
      const text = String(ref.textContent ?? "").replace(/^#?\[*/, "").replace(/\]*$/, "").trim();
      return text ? { type: "page", title: text } : null;
    };
    on(el, "mousedown", safe("ref mousedown", (e) => {
      if (refTarget(e)) swallow(e);
    }), true);
    on(el, "click", safe("ref click", (e) => {
      const target = refTarget(e);
      if (!target) return;
      swallow(e);
      onNavigate({ target, sidebar: !!e.shiftKey });
    }), true);

    on(el, "focusin", safe("focusin", (e) => {
      if (!isTextarea(e.target)) return;
      editing = true;
      focusUid = uidOfId(e.target.id);
      lastTa = e.target;
    }));

    on(doc, "keydown", safe("document keydown", (e) => {
      if (synthetic || !e.isTrusted || e.isComposing || e.keyCode === 229) return;
      const t = e.target;
      if (within(t, el)) return;
      if (t?.closest?.(`${menuSelector}, ${POPUP_HOST_SELECTOR}`)) return;
      if (highlight()) {
        if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && String(e.key).toLowerCase() === "c") return;
        swallow(e);
        if (e.key === "Escape") void clearSelection().catch((error) => warn("selection clear failed", error));
        return;
      }
      if (editing && (!t || t === doc.body) && lastKeyAt && now() - lastKeyAt <= REFOCUS_WINDOW_MS) {
        swallow(e);
        refocusLast();
      }
    }), true);

    on(doc, "focusin", safe("document focusin", (e) => {
      const t = e.target;
      if (!t || t === doc.body || within(t, el)) return;
      if (editing && isTextarea(t) && /^block-input-/.test(String(t.id ?? "")) && lastKeyAt && now() - lastKeyAt <= STRAY_FOCUS_MS) {
        try { t.blur?.(); } catch (error) { warn("stray blur failed", error); }
        refocusLast();
        if (!strayLogged) { strayLogged = true; console.warn("[plexus] dock: focus escaped to a block outside the dock; returned it"); }
        return;
      }
      editing = false;
    }), true);

    on(containerEl, "pointerdown", safe("canvas pointerdown", () => {
      if (focusedTa()) leaveEditing({ refocus: false });
    }), true);
    on(containerEl, "pointerup", safe("canvas pointerup", () => {
      if (highlight()) void clearSelection().catch((error) => warn("selection clear failed", error));
    }), true);
  }

  function refocusLast() {
    const ta = lastTa && within(lastTa, el) ? lastTa : el.querySelector?.("textarea");
    if (!ta) return;
    try {
      ta.focus?.({ preventScroll: true });
      if (lastCaret && lastCaret.ta === ta && typeof ta.setSelectionRange === "function") ta.setSelectionRange(lastCaret.start, lastCaret.end);
    } catch (error) { warn("refocus failed", error); }
  }

  function installHeader() {
    const noFocus = (target) => on(target, "mousedown", (e) => e.preventDefault?.());
    noFocus(parentBtn);
    noFocus(closeBtn);
    noFocus(handle);
    noFocus(addBtn);
    on(label, "dragstart", safe("dragstart", (e) => {
      if (!dragRef || !e.dataTransfer) { e.preventDefault?.(); return; }
      leaveEditing({ refocus: false });
      e.dataTransfer.effectAllowed = "copyLink";
      e.dataTransfer.setData(PLEXUS_REF_MIME, dragRef);
    }));
    on(parentBtn, "click", () => { void setRoot(rootKind === "parent" ? "drawing" : "parent").catch((error) => warn("setRoot failed", error)); });
    on(closeBtn, "click", () => { void shutdown(true); });
    on(addBtn, "click", () => {
      Promise.resolve()
        .then(() => addBlock(rootUid))
        .then((uid) => (uid && open ? focusBlock(uid) : null))
        .catch((error) => { warn("add block failed", error); toast("Could not add a block"); });
    });

    const finishDrag = safe("resize end", () => {
      if (!drag) return;
      drag = null;
      try { onWidth(requestedWidth); } catch (error) { warn("onWidth failed", error); }
    });
    on(handle, "pointerdown", safe("resize start", (e) => {
      e.preventDefault?.();
      try { handle.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
      drag = { startX: e.clientX, startW: effectiveWidth() };
    }));
    on(handle, "pointermove", safe("resize", (e) => {
      if (!drag) return;
      requestedWidth = clamp(Math.round(drag.startW + (drag.startX - e.clientX)), DOCK_MIN_WIDTH, DOCK_MAX_WIDTH);
      scheduleApply();
    }));
    on(handle, "pointerup", finishDrag);
    on(handle, "pointercancel", finishDrag);
    on(handle, "lostpointercapture", finishDrag);
    on(view, "resize", safe("window resize", scheduleApply));
  }

  function installObservers() {
    if (typeof MutationObs !== "function") return;
    // Minimize, or Roam leaving full screen, ends the dock synchronously.
    const outerMo = new MutationObs(safe("outer observer", () => {
      if (open && !hasClass(outerEl, "full-screen")) void shutdown(false);
    }));
    outerMo.observe(outerEl, { attributes: true, attributeFilter: ["class"] });
    offs.push(() => outerMo.disconnect());
    // Keep the [[ autocomplete inside the scrolling body.
    const menuMo = new MutationObs(safe("menu observer", () => {
      const menu = body.querySelector?.(".rm-autocomplete__results");
      if (menu) menu.scrollIntoView?.({ block: "nearest" });
    }));
    menuMo.observe(body, { childList: true, subtree: true });
    offs.push(() => menuMo.disconnect());
  }

  // ---- close ----
  function shutdown(notify) {
    if (!open) return closePromise ?? Promise.resolve();
    open = false;
    const ta = focusedTa();
    const wasEditing = !!ta || editing;
    try {
      if (ta) ta.blur?.();
      if (highlight()) dispatchEscape("window");
    } catch (error) { warn("close blur failed", error); }
    editing = false;
    cancelPending();
    for (const off of offs.splice(0)) { try { off(); } catch (error) { warn("listener removal failed", error); } }
    try { unwatch?.(); } catch (error) { warn("unwatch failed", error); }
    unwatch = null;
    try {
      el.style.display = "none";
      removeClass(outerEl, "plexus-dock-narrowed");
      removeClass(doc.body, "plexus-dock-open");
      styleEl.remove?.();
      containerEl?.focus?.({ preventScroll: true });
    } catch (error) { warn("close restore failed", error); }
    closePromise = (async () => {
      if (wasEditing) await new Promise((resolve) => setTimer(resolve, LEAVE_WAIT_MS));
      for (const h of hosts.values()) unmountHost(h);
      hosts.clear();
      el.remove?.();
    })().catch((error) => warn("close failed", error));
    if (notify) {
      try { onClose(); } catch (error) { warn("onClose failed", error); }
    }
    return closePromise;
  }

  // ---- start ----
  updateHeader();
  applyWidth();
  styleHost.append(styleEl);
  doc.body.append(el);
  addClass(doc.body, "plexus-dock-open");
  addClass(outerEl, "plexus-dock-narrowed");
  const width0 = widthOf();
  installKeys();
  installHeader();
  installObservers();
  try { startWatch(rootUid); } catch (error) { warn("start failed", error); }
  void verifyNarrow(width0).catch((error) => warn("narrowing check failed", error));

  return {
    el,
    isOpen: () => open,
    close: () => shutdown(true),
    dispose: () => shutdown(false),
    setRoot,
    refreshTheme,
    root: () => rootKind,
    rootUid: () => rootUid,
    mode: () => narrowMode,
    escapeVia: () => escapeVia,
  };
}
