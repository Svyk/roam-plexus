import { SETTING_IDS } from "../settings.js";

const STOP_EVENTS = ["keydown", "keyup", "keypress", "input", "paste", "copy", "cut", "mousedown", "pointerdown", "wheel", "click"];
const open = new WeakMap();

const clampInt = (value, fallback, min, max) => {
  const n = Number(value);
  const base = value === "" || value == null || !Number.isFinite(n) ? fallback : n;
  return Math.min(max, Math.max(min, Math.round(base)));
};

const FIELDS = [
  { id: SETTING_IDS.figureHeight, label: "Image height (px)", type: "number", fallback: 280, min: 80, max: 1200 },
  { id: SETTING_IDS.thumbHeight, label: "Thumbnail height (px)", type: "number", fallback: 72, min: 24, max: 400 },
  { id: SETTING_IDS.inlineDisplay, label: "Region refs inside text", type: "select", options: [["thumbnail", "Thumbnail"], ["link", "Link"]] },
  { id: SETTING_IDS.darkCrops, label: "Match dark theme", type: "checkbox", fallback: true },
  { id: SETTING_IDS.openInSidebar, label: "Open regions in sidebar", type: "checkbox", fallback: false },
  { id: SETTING_IDS.showBacklinks, label: "Show backlinks on canvas", type: "checkbox", fallback: true },
];

export function openSettingsDialog({ doc, get = () => undefined, set = () => {}, onChanged = () => {}, zIndex = 100000, dark = false } = {}) {
  const existing = open.get(doc);
  if (existing) {
    try { existing.focus(); } catch (error) { console.warn("[plexus] settings focus failed", error); }
    return existing.handle;
  }

  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  };

  const d = el("dialog", `plexus-portal plexus-settings${dark ? " plexus-settings--dark" : ""}`);
  const stop = (e) => e?.stopPropagation?.();
  for (const type of STOP_EVENTS) d.addEventListener(type, stop);

  const stored = (f) => {
    let v;
    try { v = get(f.id); } catch { v = undefined; }
    if (f.type === "number") return String(clampInt(v, f.fallback, f.min, f.max));
    if (f.type === "select") return v === "link" ? "link" : "thumbnail";
    return v == null ? f.fallback : !!v;
  };
  const current = (f, input) => {
    if (f.type === "number") return String(clampInt(input.value, f.fallback, f.min, f.max));
    if (f.type === "select") return input.value === "link" ? "link" : "thumbnail";
    return !!input.checked;
  };

  const inputs = [];
  d.append(el("div", "plexus-settings-title", "Plexus region settings"));
  for (const f of FIELDS) {
    const row = el("label", "plexus-settings-row");
    row.append(el("span", "plexus-settings-label", f.label));
    let input;
    if (f.type === "select") {
      input = el("select", "plexus-settings-input");
      for (const [value, text] of f.options) {
        const o = el("option", null, text);
        o.value = value;
        input.append(o);
      }
      input.value = stored(f);
    } else if (f.type === "number") {
      input = el("input", "plexus-settings-input");
      input.type = "number";
      input.min = String(f.min);
      input.max = String(f.max);
      input.value = stored(f);
    } else {
      input = el("input", "plexus-settings-input");
      input.type = "checkbox";
      input.checked = stored(f);
    }
    row.append(input);
    d.append(row);
    inputs.push([f, input]);
  }

  // Writes the fields that differ from the stored value; onChanged fires once after all writes settle.
  const commit = (only) => {
    const writes = [];
    for (const [f, input] of inputs) {
      if (only && only !== input) continue;
      try {
        const value = current(f, input);
        if (value === stored(f)) continue;
        writes.push(Promise.resolve(set(f.id, value)).catch((error) => console.warn("[plexus] settings write failed", f.id, error)));
      } catch (error) {
        console.warn("[plexus] settings write failed", f.id, error);
      }
    }
    if (!writes.length) return Promise.resolve();
    return Promise.all(writes).then(() => {
      try { onChanged(); } catch (error) { console.warn("[plexus] settings onChanged failed", error); }
    });
  };

  for (const [f, input] of inputs) input.addEventListener("change", () => { if (f.type === "number") input.value = current(f, input); commit(input); });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    commit();
    open.delete(doc);
    for (const type of STOP_EVENTS) d.removeEventListener?.(type, stop);
    d.removeEventListener?.("cancel", close);
    d.removeEventListener?.("close", close);
    try { if (typeof d.close === "function") d.close(); } catch (error) { console.warn("[plexus] settings close failed", error); }
    d.remove?.();
  };

  const actions = el("div", "plexus-settings-actions");
  const closeButton = el("button", "plexus-toolbar-button", "Close");
  closeButton.type = "button";
  closeButton.addEventListener("click", close);
  actions.append(closeButton);
  d.append(actions);
  d.addEventListener("cancel", close);
  d.addEventListener("close", close);

  doc.body.append(d);
  if (typeof d.showModal === "function") d.showModal();
  else {
    d.setAttribute?.("open", "");
    if (d.style) d.style.zIndex = String(zIndex);
  }

  const handle = { close };
  open.set(doc, { handle, focus: () => (inputs[0][1].focus ?? (() => {})).call(inputs[0][1]) });
  return handle;
}
