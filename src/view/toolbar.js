export function baseZIndex(doc, outerEl) {
  const view = doc.defaultView;
  for (let el = outerEl; el && el !== doc.body; el = el.parentElement) {
    const z = Number.parseInt(view.getComputedStyle(el).zIndex, 10);
    if (Number.isFinite(z)) return z;
  }
  return 1000;
}

export function createEditorToolbar({ doc, onAreaRegion, onImageRegion, onFrameRegion, canFrame, onCropRegion, canCrop, onEmbed, onPresent, canPresent }) {
  const view = doc.defaultView;
  let bar = null;
  let outer = null;
  let gated = [];
  let refreshTimer = null;

  const refresh = () => {
    refreshTimer = null;
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
      bar.append(button("Region", onAreaRegion), button("Image region", onImageRegion), frameButton, cropButton, button("Embed block", onEmbed), presentButton);
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
