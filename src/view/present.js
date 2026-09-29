// Full-screen slide presenter on a modal <dialog>. Keys are handled on the dialog only.
const NEXT_KEYS = new Set(["ArrowRight", "PageDown", " ", "Spacebar", "Enter"]);
const PREV_KEYS = new Set(["ArrowLeft", "PageUp", "Backspace"]);

export function createPresenter({ doc }) {
  let current = null;

  const close = () => {
    const state = current;
    if (!state) return;
    current = null;
    state.dialog.removeEventListener?.("keydown", state.onKey);
    state.dialog.removeEventListener?.("keyup", state.onKeyUp);
    state.dialog.removeEventListener?.("click", state.onClick);
    state.dialog.removeEventListener?.("cancel", state.onCancel);
    state.dialog.removeEventListener?.("close", state.onClosed);
    try { if (state.dialog.open) state.dialog.close?.(); } catch (error) { console.warn("[plexus] dialog close failed", error); }
    state.preload.src = "";
    state.dialog.remove();
    try { state.onClose?.(); } catch (error) { console.warn("[plexus] present close hook failed", error); }
  };

  return {
    isOpen: () => !!current,
    close,
    dispose: close,
    // slides: [{ name, url|null }]. Returns a handle; setSlide fills a slide that was not ready yet.
    open({ slides, index = 0, onClose } = {}) {
      close();
      const list = slides.map((s) => ({ name: s.name ?? "", url: s.url ?? null }));
      const dialog = doc.createElement("dialog");
      dialog.className = "plexus-portal plexus-present";
      dialog.setAttribute("aria-label", "Presentation");
      dialog.tabIndex = -1;
      const img = doc.createElement("img");
      img.className = "plexus-present-slide";
      img.draggable = false;
      img.alt = "";
      const wait = doc.createElement("div");
      wait.className = "plexus-present-wait";
      wait.textContent = "Rendering...";
      const hud = doc.createElement("div");
      hud.className = "plexus-present-hud";
      dialog.append(img, wait, hud);
      const preload = doc.createElement("img");
      let at = Math.min(Math.max(0, index), list.length - 1);

      const show = () => {
        const slide = list[at];
        hud.textContent = `${at + 1} / ${list.length} · ${slide.name}`;
        if (slide.url) {
          img.src = slide.url;
          img.hidden = false;
          wait.hidden = true;
        } else {
          wait.textContent = slide.error ? "Could not render this slide" : "Rendering...";
          img.removeAttribute?.("src");
          img.hidden = true;
          wait.hidden = false;
        }
        const next = list[at + 1];
        if (next?.url) preload.src = next.url;
      };
      const go = (to) => {
        const clamped = Math.min(list.length - 1, Math.max(0, to));
        if (clamped === at) return;
        at = clamped;
        show();
      };
      const onKey = (e) => {
        let handled = true;
        if (NEXT_KEYS.has(e.key)) go(at + 1);
        else if (PREV_KEYS.has(e.key)) go(at - 1);
        else if (e.key === "Home") go(0);
        else if (e.key === "End") go(list.length - 1);
        else handled = false;
        if (handled) e.preventDefault?.();
        // Nothing typed in the dialog may reach Roam or Excalidraw document handlers; Esc/Tab stay native.
        if (e.key !== "Escape" && e.key !== "Tab") e.stopPropagation?.();
      };
      const onKeyUp = (e) => e.stopPropagation?.();
      const onClick = (e) => {
        const width = dialog.getBoundingClientRect?.().width || doc.defaultView?.innerWidth || 0;
        const left = dialog.getBoundingClientRect?.().left || 0;
        e.stopPropagation?.();
        go(e.clientX - left < width / 2 ? at - 1 : at + 1);
      };
      const onCancel = (e) => {
        e.preventDefault?.();
        close();
      };
      const onClosed = () => close();
      dialog.addEventListener("keydown", onKey);
      dialog.addEventListener("keyup", onKeyUp);
      dialog.addEventListener("click", onClick);
      dialog.addEventListener("cancel", onCancel);
      dialog.addEventListener("close", onClosed);
      current = { dialog, preload, onKey, onKeyUp, onClick, onCancel, onClosed, onClose };
      doc.body.append(dialog);
      show();
      dialog.showModal();
      dialog.focus?.();
      const state = current;
      return {
        setSlide(i, patch) {
          if (current !== state || !list[i]) return;
          Object.assign(list[i], patch);
          if (i === at || i === at + 1) show();
        },
        isOpen: () => current === state,
        close: () => { if (current === state) close(); },
      };
    },
  };
}
