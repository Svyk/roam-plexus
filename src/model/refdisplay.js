export const DISPLAY_MODES = ["image", "thumbnail", "link"];
const MAX_OVERRIDES = 500;

export function overrideKey(blockUid, refUid) {
  return `${blockUid}|${refUid}`;
}

export function refContext(blockString, refUid) {
  return String(blockString ?? "").trim() === `((${refUid}))` ? "alone" : "inline";
}

export function resolveDisplay({ context, override, inlineDisplay } = {}) {
  if (context === "home") return "image";
  if (DISPLAY_MODES.includes(override)) return override;
  if (context === "alone") return "image";
  return inlineDisplay === "link" ? "link" : "thumbnail";
}

export function parseOverrides(value) {
  let raw = value;
  if (typeof value === "string") {
    try { raw = JSON.parse(value); } catch { return {}; }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, mode] of Object.entries(raw)) {
    if (DISPLAY_MODES.includes(mode)) out[key] = mode;
  }
  return out;
}

export function withOverride(map, blockUid, refUid, mode) {
  const out = { ...(map && typeof map === "object" ? map : {}) };
  const key = overrideKey(blockUid, refUid);
  delete out[key];
  if (mode == null) return out;
  if (!DISPLAY_MODES.includes(mode)) return out;
  out[key] = mode;
  const keys = Object.keys(out);
  for (let i = 0; i < keys.length - MAX_OVERRIDES; i++) delete out[keys[i]];
  return out;
}
