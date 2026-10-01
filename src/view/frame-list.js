import { frameRows } from "../model/frames.js";
import { subscribeViewport, viewportRectOf } from "../host/native.js";

const MIN_Z = 100003;
const openPanels = new WeakMap();

const warn = (what, error) => console.warn(`[plexus] frame list ${what} failed`, error);

function clearNode(node) {
  if (!node) return;
  if (typeof node.replaceChildren === "function") {
    node.replaceChildren();
    return;
  }
  for (const child of [...(node.children || [])]) child.remove?.();
}

export function openFrameList({ doc, app, container, toast, zIndex = 0 } = {}) {
  if (!doc || !app) return { close() {} };
  const existing = openPanels.get(doc);
  if (existing) return existing.handle;

  let dead = false;
  const hidden = new Set();
  const covers = new Map();
  let unsubscribe = () => {};
  const parent = container || doc.body;

  const root = doc.createElement("div");
  root.className = "rm-autocomplete__results bp3-elevation-3 plexus-portal plexus-picker plexus-framelist";
  root.style.zIndex = String(Math.max(zIndex || 0, MIN_Z));
  const main = doc.createElement("div");
  main.className = "rm-autocomplete__results-main";
  const scroll = doc.createElement("div");
  scroll.className = "rm-autocomplete__results-scroll";
  const footer = doc.createElement("div");
  footer.className = "rm-autocomplete-footer";
  const footerTitle = doc.createElement("div");
  footerTitle.className = "rm-autocomplete-footer__title";
  footerTitle.textContent = "Frames";
  footer.append(footerTitle);
  main.append(scroll, footer);
  root.append(main);

  const stop = (e) => e.stopPropagation?.();
  root.addEventListener("pointerdown", stop);
  root.addEventListener("mousedown", (e) => { e.preventDefault?.(); stop(e); });
  root.addEventListener("click", stop);

  function sceneElements() {
    try {
      return app.scene?.getNonDeletedElements?.() || [];
    } catch (error) {
      warn("read", error);
      return [];
    }
  }

  function dropCover(id) {
    const cover = covers.get(id);
    if (!cover) return;
    try { cover.remove(); } catch { /* already gone */ }
    covers.delete(id);
  }

  function placeCovers() {
    if (dead) return;
    const byId = new Map();
    for (const el of sceneElements()) if (el?.id) byId.set(el.id, el);
    for (const id of [...covers.keys()]) {
      if (!hidden.has(id) || !byId.has(id)) dropCover(id);
    }
    const bg = app.state?.viewBackgroundColor;
    const background = bg ? String(bg) : "Canvas";
    for (const id of hidden) {
      const el = byId.get(id);
      if (!el) continue;
      const x = Number(el.x) || 0;
      const y = Number(el.y) || 0;
      const w = Number(el.width) || 0;
      const h = Number(el.height) || 0;
      const rect = viewportRectOf(app, [x, y, x + w, y + h]);
      let cover = covers.get(id);
      if (!cover) {
        cover = doc.createElement("div");
        cover.className = "plexus-frame-cover";
        cover.style.position = "absolute";
        cover.style.pointerEvents = "none";
        parent.append(cover);
        covers.set(id, cover);
      }
      cover.style.left = `${rect.left}px`;
      cover.style.top = `${rect.top}px`;
      cover.style.width = `${rect.width}px`;
      cover.style.height = `${rect.height}px`;
      cover.style.background = background;
    }
  }

  function close() {
    if (dead) return;
    dead = true;
    try { unsubscribe(); } catch (error) { warn("unsubscribe", error); }
    unsubscribe = () => {};
    for (const id of [...covers.keys()]) dropCover(id);
    hidden.clear();
    doc.removeEventListener?.("pointerdown", onDocPointer, true);
    doc.removeEventListener?.("keydown", onKey, true);
    try { root.remove(); } catch { /* already gone */ }
    if (openPanels.get(doc)?.handle === handle) openPanels.delete(doc);
  }

  function onDocPointer(e) {
    if (!(e?.target && root.contains?.(e.target))) close();
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault?.();
      close();
    }
  }

  function render() {
    if (dead) return;
    clearNode(scroll);
    const rows = frameRows(sceneElements());
    if (!rows.length) {
      const empty = doc.createElement("div");
      empty.className = "plexus-framelist-empty";
      empty.textContent = "No frames";
      scroll.append(empty);
      return;
    }
    for (const frame of rows) {
      const row = doc.createElement("div");
      row.className = "dont-unfocus-block plexus-framelist-row";
      const jump = doc.createElement("button");
      jump.type = "button";
      jump.className = "plexus-framelist-jump";
      jump.textContent = frame.label;
      jump.setAttribute("data-testid", `plexus-frame-${frame.id}`);
      jump.addEventListener("click", (e) => {
        stop(e);
        const el = sceneElements().find((item) => item.id === frame.id);
        if (!el || typeof app.scrollToContent !== "function") {
          try { toast?.("Could not scroll to that frame"); } catch { /* toast is best effort */ }
          return;
        }
        try {
          app.scrollToContent(el);
        } catch (error) {
          warn("scroll", error);
          try { toast?.("Could not scroll to that frame"); } catch { /* toast is best effort */ }
        }
      });
      const hide = doc.createElement("button");
      hide.type = "button";
      hide.className = "plexus-framelist-hide";
      hide.textContent = hidden.has(frame.id) ? "Show" : "Hide";
      hide.setAttribute("data-testid", `plexus-hide-${frame.id}`);
      hide.addEventListener("click", (e) => {
        stop(e);
        if (hidden.has(frame.id)) hidden.delete(frame.id);
        else hidden.add(frame.id);
        placeCovers();
        render();
      });
      row.append(jump, hide);
      scroll.append(row);
    }
  }

  const handle = { close };
  try {
    unsubscribe = subscribeViewport(app, () => placeCovers()) || (() => {});
  } catch (error) {
    warn("subscribe", error);
    unsubscribe = () => {};
  }
  openPanels.set(doc, { handle });
  try {
    doc.body.append(root);
    doc.addEventListener?.("pointerdown", onDocPointer, true);
    doc.addEventListener?.("keydown", onKey, true);
    render();
  } catch (error) {
    warn("open", error);
    close();
  }
  return handle;
}
