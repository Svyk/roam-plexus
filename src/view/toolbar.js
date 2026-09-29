function baseZIndex(doc, outerEl) {
  const view = doc.defaultView;
  for (let el = outerEl; el && el !== doc.body; el = el.parentElement) {
    const z = Number.parseInt(view.getComputedStyle(el).zIndex, 10);
    if (Number.isFinite(z)) return z;
  }
  return 1000;
}

export function createEditorToolbar({ doc, onAreaRegion, onImageRegion, onFrameRegion, canFrame }) {
  const view = doc.defaultView;
  let bar = null;
  let outer = null;
  let frameButton = null;
  let refreshTimer = null;

  const refresh = () => {
    refreshTimer = null;
    if (!frameButton) return;
    let ok = false;
    try { ok = !!canFrame?.(); } catch { ok = false; }
    frameButton.disabled = !ok;
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
    frameButton = null;
  };

  return {
    show(outerEl) {
      hide();
      outer = outerEl;
      bar = doc.createElement("div");
      bar.className = "plexus-portal plexus-toolbar";
      bar.style.zIndex = String(baseZIndex(doc, outerEl) + 1);
      frameButton = button("Frame (with margin)", onFrameRegion);
      bar.append(button("Region", onAreaRegion), button("Image region", onImageRegion), frameButton);
      doc.body.append(bar);
      refresh();
      outerEl.addEventListener?.("pointerup", scheduleRefresh, true);
      outerEl.addEventListener?.("keyup", scheduleRefresh, true);
      place();
      view?.addEventListener("resize", place);
    },
    hide,
    dispose: hide,
  };
}
