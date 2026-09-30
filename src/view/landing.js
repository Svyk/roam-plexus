import { parseRegion } from "../model/region.js";
import { activeEditor } from "../host/native.js";

const ROUTE = /^#\/(app|offline)\/([^/]+)\/page\/([^/?#]+)$/;
const FRESH_LOAD_MS = 30000;
const SETTLE_TRIES = 30;
const SETTLE_STEP_MS = 100;

// Opens a supported region in the drawing when its page is the destination of a fresh navigation. Off unless the
// regionLanding setting is on (read on every event). A traverse (Back/Forward) never lands: landing moves the main
// window to the drawing block, so Back would otherwise land again forever.
export function installRegionLanding({ doc, win = doc?.defaultView, api, host, getSettings = () => ({}), openRegion } = {}) {
  let disposed = false;
  let lastHash = null;
  let navType = null;
  let seq = 0;

  const enabled = () => {
    try { return !!getSettings()?.regionLanding; } catch { return false; }
  };
  const graphName = () => {
    try { return api?.graph?.name ?? null; } catch { return null; }
  };

  const frame = () => new Promise((resolve) => {
    const raf = win?.requestAnimationFrame;
    if (typeof raf === "function") raf.call(win, () => resolve()); else setTimeout(resolve, 16);
  });
  const settled = async (uid) => {
    const current = api?.ui?.mainWindow?.getOpenPageOrBlockUid;
    if (typeof current !== "function") return true;
    for (let i = 0; i < SETTLE_TRIES; i++) {
      let open = null;
      try { open = await current.call(api.ui.mainWindow); } catch { open = null; }
      if (disposed) return false;
      if (open === uid) { await frame(); await frame(); return true; }
      await new Promise((resolve) => setTimeout(resolve, SETTLE_STEP_MS));
    }
    return false;
  };

  const consider = async (hash) => {
    if (disposed || !hash || hash === lastHash) return;
    lastHash = hash;
    if (!enabled()) return;
    const m = ROUTE.exec(hash);
    if (!m) return;
    let graph = m[2];
    try { graph = decodeURIComponent(graph); } catch { /* keep the raw segment */ }
    const name = graphName();
    if (!name || graph !== name) return;
    const uid = m[3];
    const mine = ++seq;
    try {
      const block = await host.pullBlock(uid);
      if (disposed || mine !== seq || !parseRegion(block?.string ?? "")?.supported) return;
      // Roam is still routing when hashchange fires; opening now loses to Roam's own navigation. Wait until the
      // main window shows this uid, then two frames, and give up if the user navigated elsewhere meanwhile.
      if (!(await settled(uid)) || disposed || mine !== seq || (win?.location?.hash ?? "") !== hash) return;
      if (activeEditor(doc)) return;
      await openRegion(uid);
    } catch (error) {
      console.warn("[plexus] region landing failed", error);
    }
  };

  const nav = win?.navigation;
  const hasNav = typeof nav?.addEventListener === "function";
  const onNavigate = (e) => { navType = e?.navigationType ?? null; };
  const onHashChange = () => {
    const type = navType;
    navType = null;
    const hash = win?.location?.hash ?? "";
    // Without the Navigation API a traverse cannot be told from a push: only the fresh-load check lands.
    if (!hasNav || (type !== "push" && type !== "replace")) {
      lastHash = hash;
      return;
    }
    consider(hash);
  };
  if (hasNav) nav.addEventListener("navigate", onNavigate);
  win?.addEventListener?.("hashchange", onHashChange);

  let fresh = false;
  try { fresh = (win?.performance?.now?.() ?? Infinity) < FRESH_LOAD_MS; } catch { fresh = false; }
  if (fresh) consider(win?.location?.hash ?? "");
  else lastHash = win?.location?.hash ?? null;

  return function dispose() {
    if (disposed) return;
    disposed = true;
    if (hasNav) nav.removeEventListener?.("navigate", onNavigate);
    win?.removeEventListener?.("hashchange", onHashChange);
  };
}
