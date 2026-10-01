const num = (value, fallback, min, max) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

export function createExportDialog({ doc } = {}) {
  let node = null;
  const close = () => {
    const cur = node;
    node = null;
    if (!cur) return;
    try { if (cur.open) cur.close?.(); } catch { /* already closed */ }
    cur.remove?.();
  };
  return {
    isOpen: () => !!node,
    close,
    open({ hasSelection = false, onSubmit } = {}) {
      close();
      const dialog = doc.createElement("dialog");
      dialog.className = "plexus-portal plexus-export";
      dialog.setAttribute?.("aria-label", "Export drawing");
      const scope = doc.createElement("select");
      scope.className = "plexus-export-scope";
      const all = doc.createElement("option");
      all.value = "all";
      all.textContent = "Whole drawing";
      const sel = doc.createElement("option");
      sel.value = "selection";
      sel.textContent = "Selection";
      sel.disabled = !hasSelection;
      scope.append?.(all, sel);
      scope.value = "all";
      const scale = doc.createElement("input");
      scale.className = "plexus-export-scale";
      scale.value = "2";
      const padding = doc.createElement("input");
      padding.className = "plexus-export-padding";
      padding.value = "10";
      const theme = doc.createElement("select");
      theme.className = "plexus-export-theme";
      const light = doc.createElement("option");
      light.value = "light";
      light.textContent = "Light";
      const dark = doc.createElement("option");
      dark.value = "dark";
      dark.textContent = "Dark";
      theme.append?.(light, dark);
      theme.value = "light";
      const read = (output) => ({
        scope: scope.value === "selection" && hasSelection ? "selection" : "all",
        scale: num(scale.value, 2, 1, 4),
        padding: num(padding.value, 10, 0, 80),
        theme: theme.value === "dark" ? "dark" : "light",
        output,
      });
      const button = (label, className, output) => {
        const b = doc.createElement("button");
        b.type = "button";
        b.className = className;
        b.textContent = label;
        b.addEventListener?.("click", () => {
          const choice = read(output);
          close();
          try { onSubmit?.(choice); } catch (error) { console.warn("[plexus] export choice failed", error); }
        });
        return b;
      };
      dialog.append?.(
        scope, scale, padding, theme,
        button("Copy", "plexus-export-copy", "clipboard"),
        button("Download", "plexus-export-download", "download"),
        button("Insert", "plexus-export-insert", "insert"),
      );
      dialog.addEventListener?.("cancel", (e) => { e?.preventDefault?.(); close(); });
      doc.body?.append?.(dialog);
      node = dialog;
      try { dialog.showModal?.(); } catch { /* a non-modal open still works */ }
      return dialog;
    },
  };
}
