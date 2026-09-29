import { parseRegion } from "../model/region.js";
import { parseImageRefs } from "../model/image.js";
import { overrideKey } from "../model/refdisplay.js";

const DRAWING_START = /^\s*\{\{(?:\[\[excalidraw\]\]|excalidraw)\}\}/;
const MEMO_MS = 500;
const LINK_LABEL = "Plexus: Link caption to source blocks";

const guard = (label, fn) => (...args) => {
  try {
    const out = fn(...args);
    if (out && typeof out.catch === "function") out.catch((error) => console.warn(`[plexus] ${label} failed`, error));
  } catch (error) {
    console.warn(`[plexus] ${label} failed`, error);
  }
};

const cond = (fn) => (e) => {
  try { return !!fn(e); } catch { return false; }
};

export function installRoamMenus({ api, host, actions, regionref, getSettings = () => ({}), setRefOverride, openSettings, now = () => Date.now() } = {}) {
  const added = [];
  const pullString = (uid) => {
    if (!uid) return null;
    const raw = api.data.pull("[:block/string]", [":block/uid", uid]);
    return raw ? (raw[":block/string"] ?? "") : null;
  };

  // One pull per menu opening: the conditionals of a menu share a short-lived memo.
  const memos = [];
  const clearMemo = () => { for (const m of memos) m.clear(); };
  const memoize = (compute) => {
    const memo = new Map();
    memos.push(memo);
    return (key, ...args) => {
      const t = now();
      const hit = memo.get(key);
      if (hit && t - hit.t < MEMO_MS) return hit.data;
      const data = compute(...args);
      memo.set(key, { t, data });
      if (memo.size > 50) memo.delete(memo.keys().next().value);
      return data;
    };
  };
  const refInfo = memoize((ref, block) => {
    const string = pullString(ref);
    if (string == null) return { supported: false };
    const supported = !!parseRegion(string)?.supported;
    if (!supported) return { supported };
    let mode = null;
    try { mode = regionref.modeOf({ blockUid: block, refUid: ref }); } catch { mode = null; }
    const overrides = getSettings()?.refOverrides || {};
    return { supported, mode, hasOverride: overrideKey(block, ref) in overrides };
  });
  const candidateOf = memoize((uid) => {
    try { return actions.regionCaptionCandidate?.(uid) ?? null; } catch { return null; }
  });
  const blockInfo = memoize((uid) => {
    const string = pullString(uid);
    if (string == null) return {};
    const region = parseRegion(string);
    return {
      images: parseImageRefs(string).length > 0,
      drawing: DRAWING_START.test(string),
      region: !!region?.supported,
    };
  });
  const register = (menuName, label, display, callback) => {
    const menu = api?.ui?.[menuName];
    if (!menu?.addCommand) return;
    added.push([menu, label]);
    try {
      const out = menu.addCommand({ label, "display-conditional": cond(display), callback: guard(label, callback) });
      if (out && typeof out.catch === "function") out.catch((error) => console.warn("[plexus] menu add failed", label, error));
    } catch (error) {
      console.warn("[plexus] menu add failed", label, error);
    }
  };

  const refOf = (e) => ({ ref: e?.["ref-uid"], block: e?.["block-uid"] });
  const refShowLink = (e) => {
    const { ref, block } = refOf(e);
    return refInfo(`${ref}|${block}`, ref, block).supported && candidateOf(ref, ref) != null;
  };
  const refShow = (extra = () => true) => (e) => {
    const { ref, block } = refOf(e);
    const info = refInfo(`${ref}|${block}`, ref, block);
    return info.supported && extra(info);
  };

  register("blockRefContextMenu", "Plexus: Open region", refShow(), (e) => actions.openRegion(refOf(e).ref, { sidebar: false }));
  register("blockRefContextMenu", "Plexus: Open region in sidebar", refShow(), (e) => actions.openRegion(refOf(e).ref, { sidebar: true }));
  for (const [mode, name] of [["image", "image"], ["thumbnail", "thumbnail"], ["link", "link"]]) {
    register("blockRefContextMenu", `Plexus: Show as ${name}`, refShow((i) => i.mode !== mode), async (e) => {
      const { ref, block } = refOf(e);
      await setRefOverride(block, ref, mode);
      clearMemo();
      regionref.refreshBlock(block);
    });
  }
  register("blockRefContextMenu", "Plexus: Use default display", refShow((i) => i.hasOverride), async (e) => {
    const { ref, block } = refOf(e);
    await setRefOverride(block, ref, null);
    clearMemo();
    regionref.refreshBlock(block);
  });
  register("blockRefContextMenu", "Plexus: Refresh crop", refShow(), (e) => regionref.refreshRegion(refOf(e).ref));
  const relink = async (uid) => {
    await actions.relinkRegionCaption(uid);
    clearMemo();
    regionref.refreshRegion?.(uid);
  };
  register("blockRefContextMenu", LINK_LABEL, refShowLink, (e) => relink(refOf(e).ref));
  register("blockRefContextMenu", "Plexus: Region settings…", refShow(), () => openSettings());

  const blockShow = (key) => (e) => !!blockInfo(e?.["block-uid"], e?.["block-uid"])[key];
  register("blockContextMenu", "Plexus: Region on image", blockShow("images"), (e) => actions.createPlainImageRegion(e?.["block-uid"]));
  register("blockContextMenu", "Plexus: Present frames", blockShow("drawing"), (e) => actions.presentDrawing({ drawingUid: e?.["block-uid"] }));
  register("blockContextMenu", "Plexus: Mind map from outline", () => true, (e) => actions.mindMapFromOutline(e?.["block-uid"]));
  register("blockContextMenu", "Plexus: Open region", blockShow("region"), (e) => actions.openRegion(e?.["block-uid"], { sidebar: false }));
  register("blockContextMenu", "Plexus: Refresh crop", blockShow("region"), (e) => regionref.refreshRegion(e?.["block-uid"]));
  register("blockContextMenu", LINK_LABEL, (e) => blockInfo(e?.["block-uid"], e?.["block-uid"]).region && candidateOf(e?.["block-uid"], e?.["block-uid"]) != null, (e) => relink(e?.["block-uid"]));
  register("blockContextMenu", "Plexus: Refresh crops", blockShow("drawing"), (e) => actions.refreshCropsForDrawing(e?.["block-uid"]));
  register("blockContextMenu", "Plexus: Region settings…", blockShow("drawing"), () => openSettings());

  return function dispose() {
    for (const [menu, label] of added.splice(0)) {
      try {
        const out = menu.removeCommand?.({ label });
        if (out && typeof out.catch === "function") out.catch(() => {});
      } catch (error) {
        console.warn("[plexus] menu remove failed", label, error);
      }
    }
  };
}

export function installCanvasMenu({ doc, app, containerEl, getItems, raf, caf } = {}) {
  const win = doc?.defaultView;
  const schedule = raf ?? win?.requestAnimationFrame?.bind(win) ?? ((fn) => setTimeout(fn, 16));
  const cancel = caf ?? win?.cancelAnimationFrame?.bind(win) ?? ((id) => clearTimeout(id));
  let pending = null;
  let disposed = false;

  const removeOurs = (ul) => {
    for (const n of [...(ul.querySelectorAll?.("[data-plexus-item]") ?? [])]) n.remove?.();
  };

  const make = (tag, className, text) => {
    const n = doc.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    n.setAttribute?.("data-plexus-item", "1");
    return n;
  };

  const inject = (ul) => {
    removeOurs(ul);
    let items = [];
    try { items = (getItems() || []).filter((i) => i && i.enabled); } catch (error) { console.warn("[plexus] canvas menu items failed", error); }
    if (!items.length) return;
    ul.append(make("hr", "context-menu-item-separator"));
    for (const item of items) {
      const li = make("li");
      li.setAttribute?.("data-testid", `plexus-${item.id}`);
      const button = make("button", "context-menu-item");
      button.type = "button";
      button.append(make("div", "context-menu-item__label", item.label), make("kbd", "context-menu-item__shortcut", ""));
      button.addEventListener("click", (e) => {
        e?.preventDefault?.();
        e?.stopPropagation?.();
        try { app?.setState?.({ contextMenu: null }); } catch (error) { console.warn("[plexus] close menu failed", error); }
        guard(item.label, () => item.run())();
      });
      li.append(button);
      ul.append(li);
    }
    clamp(ul);
  };

  const clamp = (ul) => {
    try {
      const popover = ul.closest?.(".popover") ?? ul.parentNode;
      if (!popover?.getBoundingClientRect) return;
      const rect = popover.getBoundingClientRect();
      const over = rect.bottom - ((win?.innerHeight ?? 0) - 8);
      if (over > 0) {
        const top = parseFloat(popover.style?.top) || 0;
        popover.style.top = `${top - Math.min(over, Math.max(0, rect.top - 8))}px`;
      }
    } catch (error) {
      console.warn("[plexus] menu clamp failed", error);
    }
  };

  const poll = (n) => {
    pending = schedule(() => {
      pending = null;
      if (disposed) return;
      try {
        const ul = containerEl.querySelector(".popover > ul.context-menu");
        if (ul) inject(ul);
        else if (n < 3) poll(n + 1);
      } catch (error) {
        console.warn("[plexus] canvas menu failed", error);
      }
    });
  };

  const onContext = () => {
    if (pending != null) { cancel(pending); pending = null; }
    poll(1);
  };
  containerEl.addEventListener("contextmenu", onContext, { passive: true });

  return function dispose() {
    disposed = true;
    containerEl.removeEventListener("contextmenu", onContext, { passive: true });
    if (pending != null) { cancel(pending); pending = null; }
    for (const n of [...(containerEl.querySelectorAll?.("[data-plexus-item]") ?? [])]) n.remove?.();
  };
}
