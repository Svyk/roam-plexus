// Multiline outline paste. Enter inserts a line. Cmd or Ctrl+Enter commits. Esc cancels.

let current = null;

export function openOutlinePrompt({ doc, zIndex = 100002 } = {}) {
  if (current) current.cancel();
  let resolveOuter;
  const promise = new Promise((resolve) => { resolveOuter = resolve; });
  const el = doc.createElement("textarea");
  el.className = "plexus-portal plexus-mm-input plexus-outline-prompt";
  el.style.zIndex = String(zIndex);
  const finish = (value) => {
    if (!current || current.el !== el) return;
    current = null;
    try { el.remove?.(); } catch { /* detached */ }
    resolveOuter(value);
  };
  current = { el, cancel: () => finish(null) };
  promise.cancel = () => finish(null);
  el.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape") { e.preventDefault(); finish(null); }
    else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); finish(String(el.value ?? "")); }
  });
  for (const type of ["keyup", "keypress", "beforeinput", "input", "paste", "copy", "cut"]) {
    el.addEventListener(type, (e) => e.stopPropagation());
  }
  doc.body?.append?.(el);
  try { el.focus?.(); } catch { /* ignore */ }
  return promise;
}
