export function baseZIndex(doc, outerEl) {
  const view = doc.defaultView;
  for (let el = outerEl; el && el !== doc.body; el = el.parentElement) {
    const z = Number.parseInt(view.getComputedStyle(el).zIndex, 10);
    if (Number.isFinite(z)) return z;
  }
  return 1000;
}

export function createEditorToolbar({ doc, onAreaRegion, onImageRegion, onFrameRegion, canFrame, onCropRegion, canCrop, onEmbed, onPresent, canPresent, onMindMap, onEditEmbed, canEditEmbed, onToggleRegions, regionsVisible, onBack, canBack }) {
  const view = doc.defaultView;
  let bar = null;
  let outer = null;
  let gated = [];
  let pressed = [];
  let refreshTimer = null;

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
    bar.style.left = `${rect.left + rect.width / 2}px`;
    const height = bar.getBoundingClientRect().height || 40;
    bar.style.top = `${rect.bottom - 16 - height}px`;
  };

  const button = (label, handler) => {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "plexus-toolbar-button";
    b.textContent = label;
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

  const hide = () => {
    view?.removeEventListener("resize", place);
    if (refreshTimer != null) { clearTimeout(refreshTimer); refreshTimer = null; }
    outer?.removeEventListener?.("pointerup", scheduleRefresh, true);
    outer?.removeEventListener?.("keyup", scheduleRefresh, true);
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
      bar = doc.createElement("div");
      bar.className = "plexus-portal plexus-toolbar";
      bar.style.zIndex = String(baseZIndex(doc, outerEl) + 1);
      const frameButton = button("Frame (with margin)", onFrameRegion);
      const cropButton = button("Region from crop", onCropRegion);
      const presentButton = button("Present", onPresent);
      gated = [[frameButton, canFrame], [cropButton, canCrop], [presentButton, canPresent]];
      const controls = [button("Region", onAreaRegion), button("Image region", onImageRegion), frameButton, cropButton, button("Embed block", onEmbed)];
      if (onEditEmbed) {
        const editButton = button("Edit embed", onEditEmbed);
        gated.push([editButton, canEditEmbed]);
        controls.push(editButton);
      }
      controls.push(presentButton);
      if (onMindMap) controls.push(button("Mind map", onMindMap));
      pressed = [];
      if (onToggleRegions) {
        const regionsButton = button("Regions", async () => {
          await onToggleRegions();
          refresh();
        });
        pressed.push([regionsButton, regionsVisible]);
        controls.push(regionsButton);
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
