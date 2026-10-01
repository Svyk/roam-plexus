import { nextAnchorId, parentAnchorId } from "../model/cardnav.js";

const ARROW_DIR = {
  ArrowRight: "right",
  ArrowLeft: "left",
  ArrowUp: "up",
  ArrowDown: "down",
};

const isTextTarget = (el) => {
  if (!el) return false;
  const tag = String(el.tagName ?? "").toLowerCase();
  return tag === "input" || tag === "textarea" || el.isContentEditable === true;
};

const settingOn = (settings, field) => settings?.[field] !== false;

function oneAnchor(sel, anchors) {
  const byId = new Map();
  for (const a of anchors) if (a?.id) byId.set(a.id, a);
  const ids = [];
  if (Array.isArray(sel)) {
    for (const id of sel) if (id) ids.push(id);
  } else if (sel && typeof sel === "object") {
    for (const id of Object.keys(sel)) if (id && sel[id]) ids.push(id);
  }
  if (ids.length !== 1) return null;
  return byId.get(ids[0]) ?? null;
}

const claim = (e) => {
  e.preventDefault?.();
  e.stopImmediatePropagation?.();
};

export function installCardKeys({ containerEl, doc, getApp, getAnchors, getElements, getSettings, onSelect, onCopy, onOpen, onQuickLook } = {}) {
  const target = doc?.addEventListener ? doc : containerEl;
  if (!containerEl?.addEventListener || !target?.addEventListener) return () => {};
  const onKey = (e) => {
    try {
      if (!e || e.isComposing) return;
      const t = e.target;
      const inside = t === containerEl || t === doc?.body || t === doc?.documentElement || (containerEl.contains?.(t) && !isTextTarget(t) && t?.dataset?.type !== "wysiwyg");
      if (!inside) return;
      const app = typeof getApp === "function" ? getApp() : null;
      if (!app || app.state?.editingTextElement) return;
      const raw = typeof getAnchors === "function" ? getAnchors() : [];
      const anchors = Array.isArray(raw) ? raw : [];
      const anchor = oneAnchor(app.state?.selectedElementIds, anchors);
      if (!anchor) return;
      const settings = typeof getSettings === "function" ? getSettings() : undefined;
      const dir = ARROW_DIR[e.key] || ARROW_DIR[e.code];
      if (dir && e.altKey && !e.shiftKey && !e.metaKey && !e.ctrlKey && settingOn(settings, "cardAltArrows")) {
        const next = nextAnchorId(anchors, anchor.id, dir);
        if (!next) return;
        claim(e);
        onSelect?.(next);
        return;
      }
      if ((e.key === "Tab" || e.code === "Tab") && e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey && settingOn(settings, "cardParent")) {
        const elements = typeof getElements === "function" ? getElements() : [];
        const parent = parentAnchorId(anchors, elements, anchor.id);
        if (!parent) return;
        claim(e);
        onSelect?.(parent);
        return;
      }
      if ((e.key === "l" || e.key === "L") && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && settingOn(settings, "cardCopy")) {
        if (!anchor.blockUid) return;
        claim(e);
        onCopy?.(`((${anchor.blockUid}))`);
        return;
      }
      if ((e.key === "Enter" || e.code === "Enter") && e.altKey && !e.shiftKey && !e.metaKey && !e.ctrlKey && settingOn(settings, "cardSidebar")) {
        if (!anchor.blockUid) return;
        claim(e);
        onOpen?.(anchor.blockUid);
        return;
      }
      if (e.code === "Space" && !e.altKey && !e.shiftKey && !e.metaKey && !e.ctrlKey && settingOn(settings, "cardQuickLook")) {
        if (onQuickLook?.(anchor) !== true) return;
        claim(e);
      }
    } catch (error) {
      console.warn("[plexus] card keys failed", error);
    }
  };
  target.addEventListener("keydown", onKey, true);
  return () => target.removeEventListener("keydown", onKey, true);
}
