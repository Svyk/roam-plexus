export const DISPLAY_MODES = ["image", "thumbnail", "link"];
export const CAPTION_OVERRIDES = ["hide", "show"];
export const CAPTION_DISPLAYS = ["written", "always", "never"];
const MAX_OVERRIDES = 500;

export function overrideKey(blockUid, refUid) {
  return `${blockUid}|${refUid}`;
}

export function refContext(blockString, refUid) {
  return String(blockString ?? "").trim() === `((${refUid}))` ? "alone" : "inline";
}

export function resolveDisplay({ context, override, inlineDisplay } = {}) {
  if (context === "home") return "image";
  const mode = typeof override === "string" ? override : override?.mode;
  if (DISPLAY_MODES.includes(mode)) return mode;
  if (context === "alone") return "image";
  return inlineDisplay === "link" ? "link" : "thumbnail";
}

function cleanEntry(value) {
  if (typeof value === "string") return DISPLAY_MODES.includes(value) ? { mode: value } : null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = {};
  if (DISPLAY_MODES.includes(value.mode)) entry.mode = value.mode;
  if (CAPTION_OVERRIDES.includes(value.caption)) entry.caption = value.caption;
  return entry.mode || entry.caption ? entry : null;
}

// Accepts the 0.6.x form ({key: "link"}) and the object form ({key: {mode?, caption?}}); invalid entries are dropped.
export function parseOverrides(value) {
  let raw = value;
  if (typeof value === "string") {
    try { raw = JSON.parse(value); } catch { return {}; }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, entry] of Object.entries(raw)) {
    const clean = cleanEntry(entry);
    if (clean) out[key] = clean;
  }
  return out;
}

// Merge patch ({mode?, caption?}) into the entry; a null field removes it, an empty entry is deleted, null patch deletes it.
// A bare mode string is shorthand for {mode}. The touched key moves to the end (recency for the cap).
export function withOverride(map, blockUid, refUid, patch) {
  const out = {};
  for (const [key, entry] of Object.entries(map && typeof map === "object" ? map : {})) {
    const clean = cleanEntry(entry);
    if (clean) out[key] = clean;
  }
  const key = overrideKey(blockUid, refUid);
  const prev = out[key];
  delete out[key];
  if (patch == null) return out;
  const fields = typeof patch === "string" ? { mode: patch } : patch;
  if (typeof fields !== "object" || Array.isArray(fields)) return out;
  const next = { ...prev };
  for (const field of ["mode", "caption"]) {
    if (!(field in fields)) continue;
    if (fields[field] == null) delete next[field];
    else next[field] = fields[field];
  }
  const clean = cleanEntry(next);
  if (!clean) return out;
  out[key] = clean;
  const keys = Object.keys(out);
  for (let i = 0; i < keys.length - MAX_OVERRIDES; i++) delete out[keys[i]];
  return out;
}

// Persisted shape: a mode-only entry stays a bare string so a 0.6.x rollback keeps it.
export function serializeOverrides(map) {
  const out = {};
  for (const [key, entry] of Object.entries(parseOverrides(map))) {
    out[key] = entry.caption ? entry : entry.mode;
  }
  return out;
}

// "hide" | "show" | "written". Home context never changes the region's own bullet.
export function resolveCaption({ captionDisplay, override, context } = {}) {
  if (context === "home") return "written";
  const caption = override && typeof override === "object" ? override.caption : null;
  if (CAPTION_OVERRIDES.includes(caption)) return caption;
  if (captionDisplay === "never") return "hide";
  if (captionDisplay === "always") return "show";
  return "written";
}
