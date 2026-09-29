function baseZIndex(doc, outerEl) {
  const view = doc.defaultView;
  for (let el = outerEl; el && el !== doc.body; el = el.parentElement) {
    const z = Number.parseInt(view.getComputedStyle(el).zIndex, 10);
    if (Number.isFinite(z)) return z;
  }
  return 1000;
}

export function createEditorToolbar({ doc, onAreaRegion, onImageRegion }) {
  const view = doc.defaultView;
  let bar = null;
  let outer = null;

  const place = () => {
    if (!bar || !outer) return;
    const rect = outer.getBoundingClientRect();
    bar.style.left = `${rect.left + rect.width / 2}px`;
    bar.style.top = `${rect.top + 8}px`;
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
    bar?.remove();
    bar = null;
    outer = null;
  };

  return {
    show(outerEl) {
      hide();
      outer = outerEl;
      bar = doc.createElement("div");
      bar.className = "plexus-portal plexus-toolbar";
      bar.style.zIndex = String(baseZIndex(doc, outerEl) + 1);
      bar.append(button("Region", onAreaRegion), button("Image region", onImageRegion));
      doc.body.append(bar);
      place();
      view?.addEventListener("resize", place);
    },
    hide,
    dispose: hide,
  };
}
