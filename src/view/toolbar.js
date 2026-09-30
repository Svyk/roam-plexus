import { hotkeyFor } from "../settings.js";

export function baseZIndex(doc, outerEl) {
  const view = doc.defaultView;
  for (let el = outerEl; el && el !== doc.body; el = el.parentElement) {
    const z = Number.parseInt(view.getComputedStyle(el).zIndex, 10);
    if (Number.isFinite(z)) return z;
  }
  return 1000;
}

export const FRAME_PRESETS = Object.freeze([
  Object.freeze({ id: "a4", label: "A4" }),
  Object.freeze({ id: "letter", label: "Letter" }),
  Object.freeze({ id: "16:9", label: "16:9" }),
  Object.freeze({ id: "4:3", label: "4:3" }),
  Object.freeze({ id: "1:1", label: "1:1" }),
  Object.freeze({ id: "mobile", label: "Mobile" }),
]);
const DEFAULT_PRESET = "16:9";
const presetLabel = (id) => (FRAME_PRESETS.find((p) => p.id === id) ?? FRAME_PRESETS[2]).label;
const POPOVER_STOP = ["keydown", "keyup", "keypress", "pointerdown", "pointerup", "mousedown", "click", "wheel"];
export const EXCAL_POPOVER_CLASS = "plexus-excal-popover";

// body:has() is checked on every Roam keystroke. A class set only while the editor is mounted is not.
export function syncExcalPopoverClass(outerEl, body) {
  const open = !!outerEl?.querySelector?.(".popover");
  body?.classList?.toggle?.(EXCAL_POPOVER_CLASS, open);
  return open;
}

// Frame flyout callbacks (wired by unit I): onAddFrame(presetId), onReformatFrame(presetId), canReformat(), onMakeSlide(),
// onLayout(kind, presetId) with kind "2x2" or "strip". Preset ids are FRAME_PRESETS ids.
export function createEditorToolbar({ onAddFrame, onReformatFrame, canReformat, onMakeSlide, onLayout, doc, onAreaRegion, onImageRegion, onFrameRegion, canFrame, onCropRegion, canCrop, onEmbed, onEmbedPicker, onNote, onPresent, canPresent, onMindMap, onEditEmbed, canEditEmbed, onToggleRegions, regionsVisible, onToggleDock, dockOpen, dockInset, onBack, canBack, MutationObserverImpl = globalThis.MutationObserver }) {
  const view = doc.defaultView;
  const mac = /mac|iphone|ipad/i.test(String(view?.navigator?.platform ?? ""));
  const withKey = (name, id) => {
    const keys = hotkeyFor(id, { mac });
    return keys ? `${name} (${keys})` : name;
  };
  let bar = null;
  let outer = null;
  let gated = [];
  let pressed = [];
  let refreshTimer = null;
  let popover = null;
  let popoverButton = null;
  let popoverWatch = null;
  let lastPreset = DEFAULT_PRESET;
  const stopPopoverWatch = () => {
    try { popoverWatch?.disconnect?.(); } catch { /* already gone */ }
    popoverWatch = null;
    doc.body?.classList?.remove?.(EXCAL_POPOVER_CLASS);
  };
  const inside = (root, t) => !!root && !!t && (root === t || !!root.contains?.(t));
  const onDocPointerDown = (e) => {
    if (inside(popover, e?.target) || inside(popoverButton, e?.target)) return;
    closePopover();
  };
  const onDocKeyDown = (e) => {
    if (e?.key !== "Escape") return;
    e.preventDefault?.();
    e.stopPropagation?.();
    closePopover();
  };
  function closePopover() {
    if (!popover) return;
    doc.removeEventListener?.("pointerdown", onDocPointerDown, true);
    doc.removeEventListener?.("keydown", onDocKeyDown, true);
    popover.remove?.();
    popover = null;
    popoverButton?.setAttribute?.("aria-expanded", "false");
  }

  const refresh = () => {
    refreshTimer = null;
    for (const [b, visible] of pressed) {
      let on = false;
      try { on = !!visible?.(); } catch { on = false; }
      b.setAttribute?.("aria-pressed", String(on));
    }
    for (const [b, can] of gated) {
      let ok = false;
      try { ok = !!can?.(); } catch { ok = false; }
      b.disabled = !ok;
    }
  };
  // Selection changes land after the pointer/key event, so read it on the next tick. Scoped to the editor only.
  const scheduleRefresh = () => {
    if (refreshTimer != null) return;
    refreshTimer = setTimeout(refresh, 0);
  };

  const place = () => {
    if (!bar || !outer) return;
    const rect = outer.getBoundingClientRect();
    let inset = 0;
    try { inset = Math.max(0, Number(dockInset?.()) || 0); } catch { inset = 0; }
    const visible = Math.max(0, rect.width - inset);
    bar.style.maxWidth = `${Math.max(0, visible - 24)}px`;
    bar.style.left = `${rect.left + visible / 2}px`;
    const height = bar.getBoundingClientRect().height || 40;
    bar.style.top = `${rect.bottom - 16 - height}px`;
  };

  const button = (label, handler, hotkey) => {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "plexus-toolbar-button";
    b.textContent = label;
    if (hotkey) b.title = withKey(label, hotkey);
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      Promise.resolve()
        .then(handler)
        .catch((error) => console.warn("[plexus] toolbar action failed", error));
    });
    return b;
  };

  const openPopover = (anchor) => {
    const row = (label, run, { disabled = false, title } = {}) => {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = "plexus-toolbar-button plexus-frames-row";
      b.textContent = label;
      if (title) b.title = title;
      b.disabled = disabled;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        if (b.disabled) return;
        closePopover();
        Promise.resolve()
          .then(run)
          .catch((error) => console.warn("[plexus] frame action failed", error));
      });
      return b;
    };
    const heading = (text) => {
      const h = doc.createElement("div");
      h.className = "plexus-frames-heading";
      h.textContent = text;
      return h;
    };
    const rows = [heading("Add frame")];
    for (const p of FRAME_PRESETS) rows.push(row(p.label, () => { lastPreset = p.id; return onAddFrame?.(p.id); }));
    if (onReformatFrame) {
      let can = false;
      try { can = !!canReformat?.(); } catch { can = false; }
      rows.push(heading("Reformat selected frame"));
      for (const p of FRAME_PRESETS) rows.push(row(p.label, () => { lastPreset = p.id; return onReformatFrame(p.id); }, { disabled: !can }));
    }
    if (onMakeSlide || onLayout) rows.push(heading("Slides"));
    if (onMakeSlide) rows.push(row("Slide", () => onMakeSlide()));
    if (onLayout) {
      const name = presetLabel(lastPreset);
      const preset = lastPreset;
      rows.push(row(`2x2 \u00b7 ${name}`, () => onLayout("2x2", preset)));
      rows.push(row(`Strip \u00b7 ${name}`, () => onLayout("strip", preset)));
    }
    const pop = doc.createElement("div");
    pop.className = "plexus-portal plexus-frames-popover";
    pop.setAttribute?.("role", "menu");
    pop.style.zIndex = String((Number.parseInt(bar?.style?.zIndex, 10) || 1000) + 1);
    for (const type of POPOVER_STOP) pop.addEventListener(type, (e) => e?.stopPropagation?.());
    pop.addEventListener("mousedown", (e) => e?.preventDefault?.());
    pop.append(...rows);
    doc.body.append(pop);
    popover = pop;
    popoverButton = anchor;
    anchor.setAttribute?.("aria-expanded", "true");
    try {
      const r = anchor.getBoundingClientRect();
      const h = pop.getBoundingClientRect().height || 0;
      const vw = view?.innerWidth ?? 0;
      pop.style.left = `${Math.max(8, vw ? Math.min(r.left, vw - 220) : r.left)}px`;
      pop.style.top = `${Math.max(8, r.top - h - 6)}px`;
    } catch { /* placed by CSS */ }
    doc.addEventListener?.("pointerdown", onDocPointerDown, true);
    doc.addEventListener?.("keydown", onDocKeyDown, true);
  };

  const hide = () => {
    closePopover();
    stopPopoverWatch();
    popoverButton = null;
    view?.removeEventListener("resize", place);
    if (refreshTimer != null) { clearTimeout(refreshTimer); refreshTimer = null; }
    outer?.removeEventListener?.("pointerup", scheduleRefresh, true);
    outer?.removeEventListener?.("keyup", scheduleRefresh, true);
    // A second mount can leave the previous bar attached if this closure no longer points at it.
    for (const el of doc.body?.querySelectorAll?.(".plexus-portal.plexus-toolbar") || []) el.remove?.();
    bar?.remove();
    bar = null;
    outer = null;
    gated = [];
    pressed = [];
  };

  return {
    show(outerEl) {
      hide();
      outer = outerEl;
      if (typeof MutationObserverImpl === "function") {
        try {
          popoverWatch = new MutationObserverImpl(() => syncExcalPopoverClass(outer, doc.body));
          popoverWatch.observe(outerEl, { childList: true, subtree: true });
        } catch { popoverWatch = null; }
      }
      syncExcalPopoverClass(outerEl, doc.body);
      bar = doc.createElement("div");
      bar.className = "plexus-portal plexus-toolbar";
      bar.style.zIndex = String(baseZIndex(doc, outerEl) + 1);
      const frameButton = button("Frame (with margin)", onFrameRegion);
      const cropButton = button("Region from crop", onCropRegion);
      const presentButton = button("Present", onPresent, "present");
      gated = [[frameButton, canFrame], [cropButton, canCrop], [presentButton, canPresent]];
      const controls = [button("Region", onAreaRegion, "region"), button("Image region", onImageRegion, "image"), frameButton, cropButton];
      if (onAddFrame) {
        const framesButton = button("Frames \u25be", () => (popover ? closePopover() : openPopover(framesButton)));
        framesButton.setAttribute?.("aria-haspopup", "menu");
        framesButton.setAttribute?.("aria-expanded", "false");
        controls.push(framesButton);
      }
      controls.push(onEmbedPicker ? button("Embed\u2026", onEmbedPicker, "embed") : button("Embed block", onEmbed));
      if (onNote) controls.push(button("Note", onNote, "note"));
      if (onEditEmbed) {
        const editButton = button("Edit embed", onEditEmbed);
        editButton.title = "Edit embed (F2)";
        gated.push([editButton, canEditEmbed]);
        controls.push(editButton);
      }
      controls.push(presentButton);
      if (onMindMap) controls.push(button("Mind map", onMindMap, "mindmap"));
      pressed = [];
      if (onToggleRegions) {
        const regionsButton = button("Regions", async () => {
          await onToggleRegions();
          refresh();
        });
        pressed.push([regionsButton, regionsVisible]);
        controls.push(regionsButton);
      }
      if (onToggleDock) {
        const dockButton = button("Outline", async () => {
          await onToggleDock();
          refresh();
        }, "dock");
        pressed.push([dockButton, dockOpen]);
        controls.push(dockButton);
      }
      if (onBack) {
        const backButton = button("Back", async () => {
          await onBack();
          refresh();
        });
        backButton.title = "Back (Alt+\u2190)";
        gated.push([backButton, canBack]);
        controls.push(backButton);
      }
      bar.append(...controls);
      doc.body.append(bar);
      refresh();
      outerEl.addEventListener?.("pointerup", scheduleRefresh, true);
      outerEl.addEventListener?.("keyup", scheduleRefresh, true);
      place();
      view?.addEventListener("resize", place);
    },
    refresh: scheduleRefresh,
    place,
    hide,
    dispose: hide,
  };
}

const hasSelection = (app) => {
  const sel = app?.state?.selectedElementIds;
  return !!sel && Object.keys(sel).some((id) => sel[id]);
};

// Alt+Left goes back one view. The mind map uses Alt+arrows on a selected node and Excalidraw uses them for flowchart
// navigation on a selected element, so this acts only with nothing selected and something to go back to.
export function installBackKey({ containerEl, app, canBack, onBack } = {}) {
  if (!containerEl?.addEventListener) return () => {};
  const onKeyDown = (e) => {
    try {
      if (e.key !== "ArrowLeft" || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.isComposing || e.keyCode === 229 || e.target !== containerEl) return;
      const st = app?.state || {};
      if (st.editingTextElement || st.openDialog || st.openMenu || st.contextMenu) return;
      if (hasSelection(app)) return;
      if (!canBack?.()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      Promise.resolve(onBack()).catch((error) => console.warn("[plexus] back failed", error));
    } catch (error) {
      console.warn("[plexus] back key failed", error);
    }
  };
  containerEl.addEventListener("keydown", onKeyDown, true);
  return function dispose() {
    containerEl.removeEventListener?.("keydown", onKeyDown, true);
  };
}
