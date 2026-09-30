// Dry-run report for placeholder-caption cleanup. Every field is plain text; nothing here writes to the graph: Apply and
// Copy report are callbacks owned by the caller.
export function createCleanupDialog({ doc, onApply = () => {}, onCopy = () => {} } = {}) {
  let dialog = null;

  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  };

  const button = (label, handler, disabled = false) => {
    const b = el("button", "plexus-toolbar-button", label);
    b.type = "button";
    b.disabled = disabled;
    b.addEventListener("click", (e) => {
      e.stopPropagation?.();
      try {
        const out = handler();
        if (out && typeof out.catch === "function") out.catch((error) => console.warn("[plexus] cleanup dialog action failed", error));
      } catch (error) {
        console.warn("[plexus] cleanup dialog action failed", error);
      }
    });
    return b;
  };

  const rowNode = (row, skipped) => {
    const node = el("div", "plexus-legacy-row");
    node.append(
      el("span", "plexus-legacy-uid", row.uid),
      el("span", "plexus-legacy-types", row.kind),
      el("span", "plexus-legacy-count", skipped ? `skipped: ${row.reason}` : `"${row.caption}" -> (empty)`),
    );
    return node;
  };

  const close = () => {
    const d = dialog;
    if (!d) return;
    dialog = null;
    try { if (typeof d.close === "function") d.close(); } catch (error) { console.warn("[plexus] cleanup dialog close failed", error); }
    d.remove?.();
  };

  return {
    // A second call replaces the first: only one cleanup dialog exists.
    show({ report }) {
      close();
      const candidates = report?.candidates || [];
      const skipped = report?.skipped || [];
      const d = el("dialog", "plexus-portal plexus-legacy plexus-cleanup");
      d.append(
        el("div", "plexus-legacy-title", "Placeholder captions (dry run)"),
        el("div", "plexus-legacy-summary", `${candidates.length} to clear, ${skipped.length} skipped, ${report?.scanned ?? 0} regions scanned`),
      );
      const list = el("div", "plexus-legacy-rows");
      for (const row of candidates) list.append(rowNode(row, false));
      for (const row of skipped) list.append(rowNode(row, true));
      const actions = el("div", "plexus-legacy-actions");
      actions.append(
        button("Copy report", () => onCopy(report)),
        button(`Apply ${candidates.length}`, () => onApply(report), candidates.length === 0),
        button("Close", close),
      );
      d.append(list, actions);
      d.addEventListener("close", () => {
        if (dialog !== d) return;
        dialog = null;
        d.remove?.();
      });
      doc.body.append(d);
      dialog = d;
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute?.("open", "");
      return d;
    },
    close,
    isOpen: () => !!dialog,
    dispose: close,
  };
}
