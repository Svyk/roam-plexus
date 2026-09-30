// One-line name prompt (P13 save-as-template). Unlike the caption prompt it never submits on blur, and it does not
// use the plexus-mm-input class, so [[ / (( suggestions are not attached to it. Enter submits, Esc and Cancel close.
const ISOLATED = ["keyup", "keypress", "beforeinput", "input", "paste", "copy", "cut"];

let current = null;

// onSubmit(value) may throw or reject to show the message in the prompt; otherwise the prompt closes.
export function openNamePrompt({ doc, zIndex = 1000, title = "Name", initial = "", maxLength = 60, submitLabel = "Save", onSubmit = () => {}, onClose = () => {} } = {}) {
  if (current) current.close();
  const handle = { done: false, root: null, listeners: [], busy: false };
  const mk = (tag, className, text) => {
    const n = doc.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = String(text);
    return n;
  };
  const on = (node, type, fn) => { node.addEventListener(type, fn); handle.listeners.push([node, type, fn]); };

  const root = mk("div", "plexus-portal plexus-name-prompt");
  root.style.zIndex = String(zIndex);
  root.setAttribute?.("role", "dialog");
  handle.root = root;
  const input = mk("input", "plexus-name-input");
  input.type = "text";
  input.value = String(initial ?? "");
  input.maxLength = maxLength;
  const error = mk("div", "plexus-name-error", "");
  const save = mk("button", "plexus-toolbar-button", submitLabel);
  save.type = "button";
  const cancel = mk("button", "plexus-toolbar-button", "Cancel");
  cancel.type = "button";
  const actions = mk("div", "plexus-name-actions");
  actions.append(save, cancel);
  root.append(mk("div", "plexus-name-title", title), input, error, actions);

  const close = () => {
    if (handle.done) return;
    handle.done = true;
    for (const [node, type, fn] of handle.listeners.splice(0)) node.removeEventListener?.(type, fn);
    try { root.remove?.(); } catch (e) { console.warn("[plexus] name prompt remove failed", e); }
    if (current === handle) current = null;
    try { onClose(); } catch (e) { console.warn("[plexus] name prompt onClose failed", e); }
  };
  handle.close = close;

  const submit = async () => {
    if (handle.done || handle.busy) return;
    handle.busy = true;
    error.textContent = "";
    try {
      await onSubmit(String(input.value ?? ""));
      handle.busy = false;
      close();
    } catch (e) {
      handle.busy = false;
      if (!handle.done) error.textContent = String(e?.message || e);
    }
  };

  const keydown = (e) => {
    e.stopPropagation?.();
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter") { if (e.target && e.target !== input) return; e.preventDefault?.(); submit(); }
    else if (e.key === "Escape") { e.preventDefault?.(); close(); }
  };
  on(input, "keydown", keydown);
  for (const type of ISOLATED) on(input, type, (e) => e.stopPropagation?.());
  on(root, "keydown", keydown);
  for (const type of ISOLATED) on(root, type, (e) => e.stopPropagation?.());
  on(save, "click", (e) => { e.stopPropagation?.(); submit(); });
  on(cancel, "click", (e) => { e.stopPropagation?.(); close(); });

  try {
    doc.body.append(root);
    input.focus?.();
    input.select?.();
  } catch (e) {
    console.warn("[plexus] name prompt failed", e);
    close();
    return null;
  }
  current = handle;
  return { el: root, close, isOpen: () => !handle.done };
}
