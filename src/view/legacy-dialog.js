// Dry-run report for legacy ExcalDATA drawings. Every field is plain text: nothing from a legacy block is ever
// handed to renderString/renderBlock (that would boot the 2021 component, which can write to its own block).
export function createLegacyDialog({ doc, onMigrate = () => {}, onCopy = () => {} } = {}) {
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
        if (out && typeof out.catch === "function") out.catch((error) => console.warn("[plexus] legacy dialog action failed", error));
      } catch (error) {
        console.warn("[plexus] legacy dialog action failed", error);
      }
    });
    return b;
  };

  const typesText = (types) => Object.entries(types || {}).map(([k, n]) => `${k} ${n}`).join(", ");

  const rowNode = (row) => {
    const node = el("div", "plexus-legacy-row");
    node.append(
      el("span", "plexus-legacy-page", row.page),
      el("span", "plexus-legacy-uid", row.uid),
      el("span", "plexus-legacy-count", row.error ? `error: ${row.error}` : `${row.elementCount} elements`),
      el("span", "plexus-legacy-types", typesText(row.types)),
    );
    const flags = [];
    if (row.empty) flags.push("empty");
    if (row.invalid) flags.push(`${row.invalid} invalid`);
    if (row.invisible) flags.push(`${row.invisible} invisible`);
    if (row.macroText) flags.push(`${row.macroText} text with braces`);
    if (row.trailing) flags.push("trailing text");
    if (flags.length) node.append(el("span", "plexus-legacy-flags", flags.join(", ")));
    if (row.links?.length) node.append(el("span", "plexus-legacy-links", `links: ${row.links.join(" ")}`));
    node.append(button("Migrate", () => onMigrate(row.uid), !!row.empty || !!row.error));
    return node;
  };

  const close = () => {
    const d = dialog;
    if (!d) return;
    dialog = null;
    try { if (typeof d.close === "function") d.close(); } catch (error) { console.warn("[plexus] legacy dialog close failed", error); }
    d.remove?.();
  };

  return {
    // A second call replaces the first: only one legacy dialog exists.
    show({ summary, rows }) {
      close();
      const d = el("dialog", "plexus-portal plexus-legacy");
      const excluded = (summary?.excluded || []).map((x) => `${x.page}/${x.uid} (${x.reason})`).join("; ");
      d.append(
        el("div", "plexus-legacy-title", "Legacy drawings (dry run)"),
        el("div", "plexus-legacy-summary",
          `${summary?.mentions ?? 0} mentions, ${summary?.drawings ?? 0} drawings, ${summary?.empty ?? 0} empty, ${summary?.excluded?.length ?? 0} excluded`),
      );
      if (excluded) d.append(el("div", "plexus-legacy-excluded", `Excluded: ${excluded}`));
      const list = el("div", "plexus-legacy-rows");
      for (const row of rows || []) list.append(rowNode(row));
      const actions = el("div", "plexus-legacy-actions");
      actions.append(button("Copy report", () => onCopy({ summary, rows })), button("Close", close));
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
