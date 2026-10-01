export const LOCK_ACTION_NAMES = Object.freeze(["toggleElementLock", "unlockAllElements"]);
const STORAGE_KEY = "plexus-generation";

export function themeToApply({ enabled, hostDark, currentTheme }) {
  if (!enabled) return null;
  const want = hostDark ? "dark" : "light";
  return currentTheme === want ? null : want;
}

export function applyCanvasPrefs(app, { themeFollow, hostDark, fitOnOpen } = {}) {
  const applied = { theme: null, fit: false };
  if (!app) return applied;
  const theme = themeToApply({ enabled: !!themeFollow, hostDark: !!hostDark, currentTheme: app.state?.theme });
  if (theme && typeof app.updateScene === "function") {
    app.updateScene({ appState: { theme }, captureUpdate: "NEVER" });
    applied.theme = theme;
  }
  if (fitOnOpen && typeof app.scrollToContent === "function") {
    app.scrollToContent(undefined, { fitToContent: true, animate: false });
    applied.fit = true;
  }
  return applied;
}

// True when a theme we just applied was replaced by the theme the editor opened with.
export function shouldReapplyTheme(before, now, applied) {
  return !!(applied?.theme && before && now && now.theme === before.theme && now.theme !== applied.theme);
}

export function captureView(app) {
  const state = app?.state || {};
  const zoom = state.zoom;
  return {
    theme: state.theme ?? null,
    scrollX: state.scrollX ?? null,
    scrollY: state.scrollY ?? null,
    zoom: zoom && typeof zoom === "object" ? (zoom.value ?? null) : (zoom ?? null),
  };
}

// Roam writes appState when the full-screen editor closes. Put back a theme or a fit we applied,
// and leave a theme or a camera the user changed after that.
export function restoreAutomaticView(app, { before, after, applied } = {}) {
  const result = { theme: false, camera: false };
  if (!app || typeof app.updateScene !== "function" || !before || !after || !applied) return result;
  const now = captureView(app);
  const patch = {};
  if (applied.theme && now.theme === applied.theme && before.theme && before.theme !== now.theme) {
    patch.theme = before.theme;
    result.theme = true;
  }
  const moved = before.scrollX !== after.scrollX || before.scrollY !== after.scrollY || before.zoom !== after.zoom;
  const stillThere = now.scrollX === after.scrollX && now.scrollY === after.scrollY && now.zoom === after.zoom;
  if (applied.fit && moved && stillThere) {
    patch.scrollX = before.scrollX;
    patch.scrollY = before.scrollY;
    if (before.zoom != null) patch.zoom = { value: before.zoom };
    result.camera = true;
  }
  if (result.theme || result.camera) app.updateScene({ appState: patch, captureUpdate: "NEVER" });
  return result;
}

export function runNamedAction(app, name) {
  const action = app?.actionManager?.actions?.[name];
  if (!action || typeof app.actionManager.executeAction !== "function") return false;
  app.actionManager.executeAction(action, "api");
  return true;
}

export function syncGeneration(storage, version) {
  if (!storage || typeof storage.getItem !== "function") return { generation: 0, bumped: false };
  let parsed = null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  const previous = Number.isInteger(parsed?.generation) && parsed.generation >= 0 ? parsed.generation : 0;
  const same = parsed?.version === version && Number.isInteger(parsed?.generation);
  const generation = same ? previous : previous + 1;
  if (!same && typeof storage.setItem === "function") {
    try { storage.setItem(STORAGE_KEY, JSON.stringify({ version, generation })); } catch { /* private mode */ }
  }
  return { generation, bumped: !same };
}

export function diagnosticsText({ version, generation, themeFollow, fitOnOpen, editorOpen, lockActions }) {
  const locks = Array.isArray(lockActions) ? lockActions.join(",") : "";
  return [
    `plexus ${version || "development"}`,
    `generation ${Number.isInteger(generation) ? generation : 0}`,
    `themeFollow ${themeFollow ? "on" : "off"}`,
    `fitOnOpen ${fitOnOpen ? "on" : "off"}`,
    `editor ${editorOpen ? "open" : "closed"}`,
    `lockActions ${locks}`,
  ].join("\n");
}

export async function copyText(text, { clipboard, doc } = {}) {
  try {
    if (clipboard?.writeText) {
      await clipboard.writeText(text);
      return "clipboard";
    }
  } catch { /* fall through */ }
  const body = doc?.body;
  const ta = doc?.createElement?.("textarea");
  if (!ta || !body?.append) return "none";
  ta.value = text;
  body.append(ta);
  try { ta.select?.(); } catch { /* ignore */ }
  let ok = false;
  try { ok = doc.execCommand?.("copy") === true; } catch { ok = false; }
  try { ta.remove?.(); } catch { /* ignore */ }
  return ok ? "textarea" : "none";
}
