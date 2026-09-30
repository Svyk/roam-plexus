import { DEFAULT_DRAWING_NAME, HOTKEYS, SETTING_IDS, drawingNameOf, formatHotkey, laserColorOf } from "../settings.js";

const STOP_EVENTS = ["keydown", "keyup", "keypress", "input", "paste", "copy", "cut", "mousedown", "pointerdown", "wheel", "click"];
const open = new WeakMap();

const clampInt = (value, fallback, min, max) => {
  const n = Number(value);
  const base = value === "" || value == null || !Number.isFinite(n) ? fallback : n;
  return Math.min(max, Math.max(min, Math.round(base)));
};

// A select stores one of its option values as a string; anything else shows the default option (first unless defaultIndex).
const selectValue = (f, v) => {
  const s = v == null ? "" : String(v);
  return f.options.some(([value]) => value === s) ? s : f.options[f.defaultIndex ?? 0][0];
};

const FIELDS = [
  { id: SETTING_IDS.figureHeight, label: "Image height (px)", type: "number", fallback: 280, min: 80, max: 1200 },
  { id: SETTING_IDS.thumbHeight, label: "Thumbnail height (px)", type: "number", fallback: 72, min: 24, max: 400 },
  { id: SETTING_IDS.inlineDisplay, label: "Region refs inside text", type: "select", options: [["thumbnail", "Thumbnail"], ["link", "Link"]] },
  { id: SETTING_IDS.darkCrops, label: "Match dark theme", type: "checkbox", fallback: true },
  { id: SETTING_IDS.openInSidebar, label: "Open regions in sidebar", type: "checkbox", fallback: false },
  { id: SETTING_IDS.showBacklinks, label: "Show backlinks on canvas", type: "checkbox", fallback: true },
  { id: SETTING_IDS.captionDisplay, label: "Caption under crops", type: "select", options: [["written", "When written"], ["always", "Always"], ["never", "Never"]] },
  { id: SETTING_IDS.captionMode, label: "Caption mode", type: "select", options: [["auto", "Auto"], ["ask", "Ask"], ["none", "None"]] },
  { id: SETTING_IDS.pinSize, label: "Pin size", type: "select", defaultIndex: 1, options: [["4", "4%"], ["8", "8%"], ["12", "12%"]] },
  { id: SETTING_IDS.numberPins, label: "Number pins", type: "checkbox", fallback: false },
  { id: SETTING_IDS.zoomCap, label: "Zoom limit", type: "select", options: [["100", "100%"], ["150", "150%"], ["200", "200%"]] },
  { id: SETTING_IDS.animation, label: "Animation", type: "select", options: [["system", "Follow system"], ["on", "On"], ["off", "Off"]] },
  { id: SETTING_IDS.regionLanding, label: "Open region links in the drawing", type: "checkbox", fallback: false },
  { id: SETTING_IDS.pasteRefs, label: "Paste refs as", type: "select", options: [["text", "Text"], ["embed", "Embed"], ["link", "Link"]] },
  { id: SETTING_IDS.cardHome, label: "New note cards go", type: "select", options: [["drawing", "Under the drawing"], ["page", "On the drawing's page"], ["daily", "On today's page"]] },
  { id: SETTING_IDS.drawingName, label: "New drawing page name", type: "text", fallback: DEFAULT_DRAWING_NAME },
  { id: SETTING_IDS.printSize, label: "Print page size", type: "select", options: [["letter", "Letter"], ["a4", "A4"], ["16:9", "16:9 slide"]] },
  { id: SETTING_IDS.printMargin, label: "Print margin (mm)", type: "number", fallback: 10, min: 0, max: 30 },
  { id: SETTING_IDS.laserColor, label: "Laser pointer color", type: "color" },
  { id: SETTING_IDS.laserDecay, label: "Laser fade (ms)", type: "number", fallback: 1000, min: 300, max: 3000 },
];

// Read-only. Native keys are listed only once measured (spec section 13); at present none are.
const NATIVE_SHORTCUTS = [["Back", "Alt+\u2190"], ["Edit embed", "F2"]];

export function openSettingsDialog({ doc, get = () => undefined, set = () => {}, onChanged = () => {}, zIndex = 100000, dark = false, mac } = {}) {
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
    if (f.type === "select") return selectValue(f, v);
    if (f.type === "text") return drawingNameOf(v);
    if (f.type === "color") return laserColorOf(v);
    return v == null ? f.fallback : !!v;
  };
  const current = (f, input) => {
    if (f.type === "number") return String(clampInt(input.value, f.fallback, f.min, f.max));
    if (f.type === "select") return selectValue(f, input.value);
    if (f.type === "text") return drawingNameOf(input.value);
    if (f.type === "color") return laserColorOf(input.value);
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
    } else if (f.type === "text") {
      input = el("input", "plexus-settings-input");
      input.type = "text";
      input.value = stored(f);
    } else if (f.type === "color") {
      input = el("input", "plexus-settings-input");
      input.type = "color";
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

  const isMac = mac ?? /mac|iphone|ipad/i.test(String(doc?.defaultView?.navigator?.platform ?? ""));
  d.append(el("div", "plexus-settings-title plexus-settings-subtitle", "Shortcuts"));
  const shortcuts = [...HOTKEYS.map((h) => [h.label, formatHotkey(h.spec, { mac: isMac })]), ...NATIVE_SHORTCUTS];
  for (const [label, keys] of shortcuts) {
    const row = el("div", "plexus-settings-row plexus-settings-shortcut");
    row.append(el("span", "plexus-settings-label", label), el("kbd", "plexus-settings-kbd", keys));
    d.append(row);
  }
  d.append(el("div", "plexus-settings-note", "Mind map is a Roam hotkey: change it in Roam Settings \u203a Hotkeys. The other keys work while a drawing is open."));

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

  // A text field is committed on Close and Esc only, so a half-typed name is never saved.
  for (const [f, input] of inputs) if (f.type !== "text") input.addEventListener("change", () => { if (f.type === "number") input.value = current(f, input); commit(input); });

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
