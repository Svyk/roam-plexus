const ISOLATED = ["keydown", "keyup", "keypress", "paste", "copy", "cut"];

let current = null;

// A non-modal in-page dialog listing the headings and block counts before a large outline is written.
// Keys are isolated from Excalidraw (it listens on document). Esc and Cancel close it and return focus.
// Returns { close, el }. Only one preview exists at a time.
export function openOutlinePreview({ doc, zIndex = 100000, headings = [], count = 0, replacing = 0, onWrite = () => {}, onClose = () => {} } = {}) {
  if (current) current.close();
  const el = (tag, className, text) => {
    const n = doc.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = String(text);
    return n;
  };
  const prior = doc.activeElement ?? null;
  const root = el("div", "plexus-portal plexus-outline-preview");
  root.setAttribute?.("role", "dialog");
  root.setAttribute?.("aria-label", "Drawing to outline");
  root.style.zIndex = String(Number(zIndex) + 2);

  let closed = false;
  let busy = false;
  const stop = (e) => e?.stopPropagation?.();
  const close = () => {
    if (closed) return;
    closed = true;
    if (current === handle) current = null;
    for (const type of ISOLATED) root.removeEventListener?.(type, stop);
    root.removeEventListener?.("keydown", onKey);
    root.remove?.();
    try { prior?.focus?.(); } catch { /* ignore */ }
    try { onClose(); } catch (error) { console.warn("[plexus] outline preview onClose failed", error); }
  };
  const onKey = (e) => {
    if (e?.key === "Escape") {
      e.preventDefault?.();
      close();
    }
  };
  for (const type of ISOLATED) root.addEventListener(type, stop);
  root.addEventListener("keydown", onKey);

  const button = (label, handler) => {
    const b = el("button", "plexus-toolbar-button", label);
    b.type = "button";
    b.addEventListener("click", (e) => { e?.stopPropagation?.(); handler(b); });
    return b;
  };

  root.append(el("div", "plexus-outline-preview-title", "Drawing to outline"));
  const blocks = `${count} block${count === 1 ? "" : "s"}`;
  root.append(el("div", "plexus-outline-preview-summary", replacing > 0
    ? `${blocks} will replace the ${replacing} in the current outline.`
    : `${blocks} will be written.`));
  const list = el("div", "plexus-outline-preview-list");
  if (headings.length) for (const h of headings) list.append(el("div", "plexus-outline-preview-heading", h));
  else list.append(el("div", "plexus-outline-preview-heading", "No frames: one flat outline"));
  root.append(list);

  const actions = el("div", "plexus-outline-preview-actions");
  const write = button("Write outline", async (b) => {
    if (busy || closed) return;
    busy = true;
    b.disabled = true;
    try { await onWrite(); } catch (error) { console.warn("[plexus] outline write failed", error); }
    close();
  });
  actions.append(button("Cancel", () => close()), write);
  root.append(actions);
  doc.body.append(root);
  try { write.focus?.(); } catch { /* ignore */ }

  const handle = { el: root, close };
  current = handle;
  return handle;
}
