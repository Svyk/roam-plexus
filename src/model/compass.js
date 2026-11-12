// Compass (window.RoamCompass) can load after Plexus. Read it on each use; do not cache the object.

function uidOf(value) {
  if (typeof value !== "string") return null;
  const uid = value.trim();
  return uid || null;
}

// The API when it is present and can open a page or block. Otherwise null.
export function compassApi(win) {
  const api = win?.RoamCompass;
  if (!api || typeof api.open !== "function") return null;
  try {
    if (api.isAvailable?.() !== true) return null;
  } catch {
    return null;
  }
  return api;
}

// The drawing open in the full-screen editor, else the focused block, else the page in the main window.
export function compassTarget({ drawingUid = null, focusedUid = null, pageUid = null } = {}) {
  return uidOf(drawingUid) || uidOf(focusedUid) || uidOf(pageUid);
}

// Alt opens in Compass only when Compass is on. Otherwise Alt changes nothing, and Shift still means the sidebar.
export function textLinkAction({ alt = false, shift = false, compass = false } = {}) {
  if (alt && compass) return "compass";
  return shift ? "sidebar" : "open";
}

// One row per token. The Compass button is on every row, or on none.
export function chooserRows(tokens, { compass = false } = {}) {
  if (!Array.isArray(tokens)) return [];
  const show = compass === true;
  return tokens.map((token) => ({ token, compass: show }));
}

// The command list includes Show in Compass only while Compass is on.
export function commandsWithCompass(commands, compass) {
  const list = Array.isArray(commands) ? commands : [];
  if (compass) return list;
  return list.filter((command) => command?.id !== "showInCompass");
}
