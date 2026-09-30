import { CE_LAYOUTS } from "../model/ce.js";

// Paste box for cause-and-effect JSON (P12 MM-11). It never reads the clipboard: the user pastes into the textarea or
// picks a file. Keys are isolated so Excalidraw's document listeners do not see typing.
const ISOLATED = ["keydown", "keyup", "keypress", "paste", "copy", "cut"];
const LAYOUT_LABELS = { tree: "Tree", fishbone: "Fishbone", pentagon: "Pentagon" };

let current = null;

// onInsert({text, layout}) may throw or reject to show the message in the dialog; otherwise the dialog closes.
export function openChartDialog({ doc, zIndex = 100000, onInsert = () => {}, onClose = () => {}, FileReaderCtor = globalThis.FileReader } = {}) {
  if (current) current.close();
  const handle = { done: false, root: null, listeners: [] };
  const mk = (tag, className, text) => {
    const n = doc.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = String(text);
    return n;
  };
  const on = (node, type, fn) => { node.addEventListener(type, fn); handle.listeners.push([node, type, fn]); };

  const root = mk("div", "plexus-portal plexus-chart-dialog");
  root.style.zIndex = String(zIndex + 2);
  handle.root = root;
  const title = mk("div", "plexus-chart-title", "Cause-and-effect from JSON");
  const area = mk("textarea", "plexus-chart-text");
  area.placeholder = '{"nodes": [{"id": "a", "text": "Effect", "role": "primary"}], "edges": []}';
  area.spellcheck = false;
  const fileRow = mk("div", "plexus-chart-row");
  const fileButton = mk("button", "plexus-toolbar-button", "Choose file…");
  fileButton.type = "button";
  const fileInput = mk("input", "plexus-chart-file");
  fileInput.type = "file";
  fileInput.accept = ".json,application/json";
  const layoutSelect = mk("select", "plexus-chart-layout");
  for (const l of CE_LAYOUTS) {
    const o = mk("option", null, LAYOUT_LABELS[l] || l);
    o.value = l;
    layoutSelect.append(o);
  }
  layoutSelect.value = CE_LAYOUTS[0];
  fileRow.append(fileButton, fileInput, layoutSelect);
  const error = mk("div", "plexus-chart-error", "");
  const actions = mk("div", "plexus-chart-actions");
  const insert = mk("button", "plexus-toolbar-button", "Insert");
  insert.type = "button";
  const cancel = mk("button", "plexus-toolbar-button", "Cancel");
  cancel.type = "button";
  actions.append(insert, cancel);
  root.append(title, area, fileRow, error, actions);

  const close = () => {
    if (handle.done) return;
    handle.done = true;
    for (const [node, type, fn] of handle.listeners.splice(0)) node.removeEventListener?.(type, fn);
    try { root.remove?.(); } catch (e) { console.warn("[plexus] chart dialog remove failed", e); }
    if (current === handle) current = null;
    try { onClose(); } catch (e) { console.warn("[plexus] chart dialog onClose failed", e); }
  };
  handle.close = close;

  const submit = async () => {
    if (handle.done) return;
    const text = String(area.value ?? "").trim();
    if (!text) { error.textContent = "Paste the chart JSON or choose a file"; return; }
    error.textContent = "";
    try {
      await onInsert({ text, layout: layoutSelect.value });
      close();
    } catch (e) {
      if (!handle.done) error.textContent = String(e?.message || e);
    }
  };

  for (const type of ISOLATED) on(root, type, (e) => e.stopPropagation?.());
  on(root, "keydown", (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape") { e.preventDefault?.(); close(); }
    else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault?.(); submit(); }
  });
  on(insert, "click", (e) => { e.stopPropagation?.(); submit(); });
  on(cancel, "click", (e) => { e.stopPropagation?.(); close(); });
  on(fileButton, "click", (e) => { e.stopPropagation?.(); fileInput.click?.(); });
  on(fileInput, "change", () => {
    const file = fileInput.files?.[0];
    if (!file || typeof FileReaderCtor !== "function") return;
    const reader = new FileReaderCtor();
    reader.onload = () => { if (!handle.done) { area.value = String(reader.result ?? ""); error.textContent = ""; } };
    reader.onerror = () => { if (!handle.done) error.textContent = "Could not read the file"; };
    reader.readAsText(file);
  });

  try {
    doc.body.append(root);
    area.focus?.();
  } catch (e) {
    console.warn("[plexus] chart dialog failed", e);
    close();
    return null;
  }
  current = handle;
  return { el: root, close, isOpen: () => !handle.done };
}
