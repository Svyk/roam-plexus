import { isContainerString, parseRegion } from "../model/region.js";
import { parseImageRefs } from "../model/image.js";
import { overrideKey } from "../model/refdisplay.js";
import { isImageKind } from "../model/label.js";
import { hotkeyFor } from "../settings.js";
import { resolveRegionTarget } from "./regionref.js";
import { ARRANGE_OPS } from "../model/arrange.js";

const DRAWING_START = /^\s*\{\{(?:\[\[excalidraw\]\]|excalidraw)\}\}/;
const PLEXUS_START = /^\s*\{\{\[\[plexus-/;
const MEMO_MS = 500;
const INFRA_START = /^\s*\{\{\[\[plexus-(?:regions|cards)\]\]\}\}/;
const ALIAS_REF = /^(?:\(\(([A-Za-z0-9_-]{9})\)\)|\[[^\]]*\]\(\(\(([A-Za-z0-9_-]{9})\)\)\))$/;
const OUTLINE_CAP = 100;
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

const overrideMode = (o) => (typeof o === "string" ? o : o?.mode ?? null);

export function installRoamMenus({ api, host, actions, regionref, getSettings = () => ({}), setRefOverride, setRegionGallery = async () => {}, applyGalleries = () => {}, openSettings, showInCompass, openPrompt, isEncrypted, native, hasEditor, doc = globalThis.document, now = () => Date.now(), toast = () => {} } = {}) {
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
    let captionState = "written";
    try { captionState = regionref.captionStateOf?.({ blockUid: block, refUid: ref }) ?? "written"; } catch { captionState = "written"; }
    const overrides = getSettings()?.refOverrides || {};
    const raw = overrides[overrideKey(block, ref)];
    const entry = typeof raw === "string" ? { mode: raw } : (raw && typeof raw === "object" ? raw : {});
    const kind = parseRegion(string)?.kind;
    return {
      supported, mode, captionState, kind,
      frameKind: kind === "frame" || kind === "cframe",
      drawingKind: !isImageKind(kind),
      hasOverride: overrideMode(raw) != null,
      size: entry.size,
      align: entry.align,
      bare: entry.bare === true,
      pad: entry.pad,
    };
  });
  const candidateOf = memoize((uid) => {
    try { return actions.regionCaptionCandidate?.(uid) ?? null; } catch { return null; }
  });
  const blockInfo = memoize((uid) => {
    const string = pullString(uid);
    if (string == null) return {};
    const region = parseRegion(string);
    const drawingKind = !!region?.supported && !isImageKind(region.kind);
    return {
      images: parseImageRefs(string).length > 0,
      drawing: DRAWING_START.test(string),
      region: !!region?.supported,
      frameKind: !!region?.supported && (region.kind === "frame" || region.kind === "cframe"),
      drawingKind,
      needsRepair: drawingKind && needsRepair(region),
    };
  });
  // One memoized pull of the child strings: true when some child is a bare ((uid)) or an alias link (A12's pattern).
  const outlineInfo = memoize((uid) => {
    try {
      const raw = api.data.pull("[{:block/children [:block/string]}]", [":block/uid", uid]);
      const kids = raw?.[":block/children"];
      const list = (Array.isArray(kids) ? kids : kids ? [kids] : []).slice(0, OUTLINE_CAP);
      return list.some((k) => typeof k?.[":block/string"] === "string" && ALIAS_REF.test(k[":block/string"].trim()));
    } catch {
      return false;
    }
  });
  const parentString = (uid) => {
    try {
      const raw = api.data.pull("[{:block/_children [:block/string]}]", [":block/uid", uid]);
      const p = raw?.[":block/_children"];
      const parent = Array.isArray(p) ? p[0] : p;
      return typeof parent?.[":block/string"] === "string" ? parent[":block/string"] : null;
    } catch {
      return null;
    }
  };
  // A drawing goes beside ordinary blocks only: never on a drawing, a region, or inside a Plexus container.
  const newDrawingOk = memoize((uid) => {
    const string = pullString(uid);
    if (string == null) return false;
    if (DRAWING_START.test(string) || PLEXUS_START.test(string) || parseRegion(string)?.supported) return false;
    return !PLEXUS_START.test(parentString(uid) ?? "");
  });
  // Repair shows for a region that no longer resolves, or an area that lost some of its elements.
  const needsRepair = (region) => {
    try {
      const target = resolveRegionTarget(host, region);
      if (target.error) return true;
      return region.kind === "area" && (target.sceneBox?.missing?.length ?? 0) > 0;
    } catch {
      return false;
    }
  };
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
      await setRefOverride(block, ref, { mode });
      clearMemo();
      regionref.refreshBlock(block);
    });
  }
  register("blockRefContextMenu", "Plexus: Use default display", refShow((i) => i.hasOverride), async (e) => {
    const { ref, block } = refOf(e);
    await setRefOverride(block, ref, { mode: null });
    clearMemo();
    regionref.refreshBlock(block);
  });
  for (const [caption, label, extra] of [
    ["hide", "Plexus: Hide caption", (i) => i.mode !== "link" && i.captionState !== "hide"],
    ["show", "Plexus: Show caption", (i) => i.captionState === "hide"],
  ]) {
    register("blockRefContextMenu", label, refShow(extra), async (e) => {
      const { ref, block } = refOf(e);
      await setRefOverride(block, ref, { caption });
      clearMemo();
      regionref.refreshBlock(block);
    });
  }
  const currentSize = (i) => (i.size == null ? "m" : i.size);
  for (const [size, label] of [["s", "Plexus: Card size small"], ["m", "Plexus: Card size medium"], ["l", "Plexus: Card size large"]]) {
    register("blockRefContextMenu", label, refShow((i) => i.mode !== "link" && currentSize(i) !== size), async (e) => {
      const { ref, block } = refOf(e);
      await setRefOverride(block, ref, { size });
      clearMemo();
      regionref.refreshBlock(block);
    });
  }
  for (const [align, label] of [["left", "Plexus: Align left"], ["center", "Plexus: Align center"], ["right", "Plexus: Align right"]]) {
    register("blockRefContextMenu", label, refShow((i) => i.mode !== "link" && i.align !== align), async (e) => {
      const { ref, block } = refOf(e);
      await setRefOverride(block, ref, { align });
      clearMemo();
      regionref.refreshBlock(block);
    });
  }
  register("blockRefContextMenu", "Plexus: Bare card", refShow((i) => i.mode !== "link" && i.bare !== true), async (e) => {
    const { ref, block } = refOf(e);
    await setRefOverride(block, ref, { bare: true });
    clearMemo();
    regionref.refreshBlock(block);
  });
  register("blockRefContextMenu", "Plexus: Show card frame", refShow((i) => i.mode !== "link" && i.bare === true), async (e) => {
    const { ref, block } = refOf(e);
    await setRefOverride(block, ref, { bare: null });
    clearMemo();
    regionref.refreshBlock(block);
  });
  register("blockRefContextMenu", "Plexus: Card padding…", refShow((i) => i.mode !== "link"), async (e) => {
    if (typeof openPrompt !== "function") return;
    const { ref, block } = refOf(e);
    const info = refInfo(`${ref}|${block}`, ref, block);
    const initial = Number.isInteger(info.pad) ? String(info.pad) : "";
    const text = await openPrompt({ doc, rect: anchorRect(block), initial, select: true, escape: "cancel" });
    if (text == null) return;
    const raw = String(text).trim();
    if (!/^(?:0|[1-9]\d*)$/.test(raw)) return;
    const n = Number(raw);
    if (n > 48) return;
    await setRefOverride(block, ref, { pad: n });
    clearMemo();
    regionref.refreshBlock(block);
  });
  register("blockRefContextMenu", "Plexus: Present from here", refShow((i) => i.frameKind), (e) => actions.presentFromRegion(refOf(e).ref));
  register("blockRefContextMenu", "Plexus: Refresh crop", refShow(), (e) => regionref.refreshRegion(refOf(e).ref));
  const relink = async (uid) => {
    await actions.relinkRegionCaption(uid);
    clearMemo();
    regionref.refreshRegion?.(uid);
  };
  register("blockRefContextMenu", LINK_LABEL, refShowLink, (e) => relink(refOf(e).ref));
  const encrypted = () => {
    try { return !!(isEncrypted ? isEncrypted() : host?.isEncrypted?.()); } catch { return false; }
  };

  // The prompt anchors to the region's ref under the block, else the block's input, else the top centre of the viewport.
  const anchorRect = (blockUid) => {
    try {
      const blockEl = [...(doc.querySelectorAll?.('[id^="block-input-"]') ?? [])].find((n) => String(n.id).endsWith(`-${blockUid}`));
      const target = blockEl?.querySelector?.("[data-plexus-card-host], .plexus-root") ?? blockEl;
      const r = target?.getBoundingClientRect?.();
      if (r && (r.width || r.height)) return { left: r.left, top: r.top, width: r.width, height: r.height };
    } catch { /* fall through */ }
    const w = doc?.defaultView?.innerWidth ?? 800;
    return { left: Math.max(8, w / 2 - 100), top: 60, width: 200, height: 0 };
  };
  const nameRegion = async (uid, blockUid) => {
    const string = pullString(uid);
    const region = string == null ? null : parseRegion(string);
    if (!region?.supported) return;
    const text = await openPrompt({ doc, rect: anchorRect(blockUid), initial: region.caption ?? "", select: true, escape: "cancel" });
    if (text == null) return;
    await actions.nameRegion(uid, text);
    clearMemo();
    regionref.refreshRegion?.(uid, { purge: false });
  };
  const cropItems = (menuName, show, uidOf, blockOf, { insert }) => {
    const drawingShow = (e) => !!show(e).drawingKind;
    register(menuName, "Plexus: Name region", (e) => show(e).supported, (e) => nameRegion(uidOf(e), blockOf(e)));
    // These callbacks call the action with no await first: clipboard writes need the user gesture.
    register(menuName, "Plexus: Copy crop as PNG", (e) => show(e).supported, (e) => actions.copyCropPng(uidOf(e)));
    register(menuName, "Plexus: Copy crop as SVG", drawingShow, (e) => actions.copyCropSvg(uidOf(e)));
    register(menuName, "Plexus: Download crop", (e) => show(e).supported, (e) => actions.downloadCrop(uidOf(e)));
    if (insert) register(menuName, "Plexus: Insert crop as image block", (e) => show(e).supported && !encrypted(), (e) => actions.insertCropImage(uidOf(e), blockOf(e)));
    register(menuName, "Plexus: Copy alias", (e) => show(e).supported, (e) => actions.copyAlias(uidOf(e)));
  };
  cropItems("blockRefContextMenu", (e) => { const { ref, block } = refOf(e); return refInfo(`${ref}|${block}`, ref, block); }, (e) => refOf(e).ref, (e) => refOf(e).block, { insert: true });
  register("blockRefContextMenu", "Plexus: Show in Compass", (e) => !!e?.["ref-uid"], (e) => showInCompass(e["ref-uid"]));
  register("blockRefContextMenu", "Plexus: Region settings…", refShow(), () => openSettings());
  register("blockRefContextMenu", "Plexus: Copy region link", refShow(), (e) => actions.copyRegionLink(refOf(e).ref));

  const blockShow = (key) => (e) => !!blockInfo(e?.["block-uid"], e?.["block-uid"])[key];
  const galleryOn = (uid) => {
    const list = getSettings()?.regionGalleries;
    return Array.isArray(list) && list.includes(uid);
  };
  register("blockContextMenu", "Plexus: Show as gallery", (e) => {
    const uid = e?.["block-uid"];
    return isContainerString(pullString(uid)) && !galleryOn(uid);
  }, async (e) => {
    await setRegionGallery(e?.["block-uid"], true);
    clearMemo();
    applyGalleries();
  });
  register("blockContextMenu", "Plexus: Show as list", (e) => {
    const uid = e?.["block-uid"];
    return isContainerString(pullString(uid)) && galleryOn(uid);
  }, async (e) => {
    await setRegionGallery(e?.["block-uid"], false);
    clearMemo();
    applyGalleries();
  });
  register("blockContextMenu", "Plexus: Region on image", blockShow("images"), (e) => actions.createPlainImageRegion(e?.["block-uid"]));
  register("blockContextMenu", "Plexus: Present frames", blockShow("drawing"), (e) => actions.presentDrawing({ drawingUid: e?.["block-uid"] }));
  register("blockContextMenu", "Plexus: Show in Compass", blockShow("drawing"), (e) => showInCompass(e["block-uid"]));
  const drawingOrRegion = (e) => {
    const info = blockInfo(e?.["block-uid"], e?.["block-uid"]);
    return !!(info.drawing || info.region);
  };
  const failPage = () => { try { toast("Could not open that page"); } catch { return; } };
  const pageWindow = (type) => (e) => {
    let pageUid;
    try { pageUid = host.blockInfo(e?.["block-uid"]).pageUid; }
    catch { failPage(); return; }
    if (!pageUid) { failPage(); return; }
    try {
      const out = api.ui.rightSidebar.addWindow({ window: { type, "block-uid": pageUid } });
      if (out && typeof out.catch === "function") out.catch(() => failPage());
    } catch { failPage(); }
  };
  register("blockContextMenu", "Plexus: Open in graph view", drawingOrRegion, pageWindow("graph"));
  register("blockContextMenu", "Plexus: Show mentions", drawingOrRegion, pageWindow("mentions"));
  register("blockContextMenu", "Plexus: Print frames", blockShow("drawing"), (e) => actions.printFrames({ drawingUid: e?.["block-uid"], mode: "print" }));
  register("blockContextMenu", "Plexus: PNG per frame", blockShow("drawing"), (e) => actions.printFrames({ drawingUid: e?.["block-uid"], mode: "png" }));
  register("blockContextMenu", "Plexus: Export scene", blockShow("drawing"), (e) => actions.exportScene(e?.["block-uid"]));
  register("blockContextMenu", "Plexus: Drawing name\u2026", blockShow("drawing"), (e) => actions.setDrawingName?.(e?.["block-uid"]));
  register("blockContextMenu", "Plexus: Import scene\u2026", () => true, (e) => actions.importScene(e?.["block-uid"]));
  register("blockContextMenu", "Plexus: Present this outline", (e) => outlineInfo(e?.["block-uid"], e?.["block-uid"]), (e) => actions.presentOutline(e?.["block-uid"]));
  register("blockContextMenu", "Plexus: Present from here", blockShow("frameKind"), (e) => actions.presentFromRegion(e?.["block-uid"]));
  register("blockContextMenu", "Plexus: Mind map from outline", () => true, (e) => actions.mindMapFromOutline(e?.["block-uid"]));
  register("blockContextMenu", "Plexus: Open region", blockShow("region"), (e) => actions.openRegion(e?.["block-uid"], { sidebar: false }));
  register("blockContextMenu", "Plexus: Refresh crop", blockShow("region"), (e) => regionref.refreshRegion(e?.["block-uid"]));
  register("blockContextMenu", LINK_LABEL, (e) => blockInfo(e?.["block-uid"], e?.["block-uid"]).region && candidateOf(e?.["block-uid"], e?.["block-uid"]) != null, (e) => relink(e?.["block-uid"]));
  cropItems("blockContextMenu", (e) => { const b = blockInfo(e?.["block-uid"], e?.["block-uid"]); return { supported: !!b.region, drawingKind: !!b.drawingKind }; }, (e) => e?.["block-uid"], (e) => e?.["block-uid"], { insert: false });
  register("blockContextMenu", "Plexus: Refresh crops", blockShow("drawing"), (e) => actions.refreshCropsForDrawing(e?.["block-uid"]));
  register("blockContextMenu", "Plexus: Region settings…", blockShow("drawing"), () => openSettings());
  register("blockContextMenu", "Plexus: Select on drawing", blockShow("drawingKind"), (e) => actions.selectRegionOnDrawing(e?.["block-uid"]));
  register("blockContextMenu", "Plexus: Update region from selection", blockShow("drawingKind"), (e) => actions.updateRegionFromSelection(e?.["block-uid"]));
  register("blockContextMenu", "Plexus: Repair region", blockShow("needsRepair"), async (e) => {
    const uid = e?.["block-uid"];
    await actions.repairRegion(uid);
    clearMemo();
    regionref.refreshRegion?.(uid, { purge: false });
  });
  register("blockContextMenu", "Plexus: Copy region link", blockShow("region"), (e) => actions.copyRegionLink(e?.["block-uid"]));

  const drawingShow = (e) => !!newDrawingOk(e?.["block-uid"], e?.["block-uid"]);
  register("blockContextMenu", "Plexus: New drawing here", drawingShow, (e) => actions.newDrawing({ where: "here", uid: e?.["block-uid"] }));
  register("blockContextMenu", "Plexus: New drawing below", drawingShow, (e) => actions.newDrawing({ where: "below", uid: e?.["block-uid"] }));

  const pageUid = (title) => {
    if (!title) return null;
    try {
      const raw = api.data.pull("[:block/uid]", [":node/title", title]);
      return raw?.[":block/uid"] ?? null;
    } catch {
      return null;
    }
  };
  register("pageContextMenu", "Plexus: New drawing on this page", () => true, (e) => {
    const uid = e?.["page-uid"] ?? pageUid(e?.["page-title"]);
    if (!uid) { console.warn("[plexus] new drawing: page not found", e?.["page-title"]); return; }
    return actions.newDrawing({ where: "here", uid, order: "last" });
  });

  // One pull per uid, memoized: { order, string, parent }.
  const nodeOf = (uid, memo) => {
    if (memo.has(uid)) return memo.get(uid);
    let value;
    try {
      const raw = api.data.pull("[:block/order :block/string {:block/_children [:block/uid]}]", [":block/uid", uid]);
      const p = raw?.[":block/_children"];
      value = { order: Number(raw?.[":block/order"]) || 0, string: raw?.[":block/string"] ?? "", parent: (Array.isArray(p) ? p[0] : p)?.[":block/uid"] ?? null };
    } catch {
      value = { order: 0, string: "", parent: null };
    }
    memo.set(uid, value);
    return value;
  };
  // Outline order: the path of :block/order values from the page down, compared level by level.
  const orderPath = (uid, memo) => {
    const path = [];
    let cur = uid;
    for (let i = 0; cur && i < 100; i++) {
      const n = nodeOf(cur, memo);
      path.unshift(n.order);
      cur = n.parent;
    }
    return path;
  };
  const inOutlineOrder = (uids, memo) => {
    const keyed = uids.map((uid, i) => ({ uid, i, path: orderPath(uid, memo) }));
    keyed.sort((a, b) => {
      for (let k = 0; k < Math.min(a.path.length, b.path.length); k++) if (a.path[k] !== b.path[k]) return a.path[k] - b.path[k];
      return a.path.length - b.path.length || a.i - b.i;
    });
    return keyed.map((x) => x.uid);
  };
  // Roam highlights descendants of a selected block too; only the top-most blocks are placed, and never Plexus containers.
  const topMost = (uids, memo) => {
    const set = new Set(uids);
    return uids.filter((uid) => {
      if (INFRA_START.test(nodeOf(uid, memo).string)) return false;
      let cur = nodeOf(uid, memo).parent;
      for (let i = 0; cur && i < 100; i++) {
        if (set.has(cur)) return false;
        cur = nodeOf(cur, memo).parent;
      }
      return true;
    });
  };
  const editorOpen = () => { try { return !!(hasEditor ? hasEditor() : native?.activeEditor?.(doc)); } catch { return false; } };
  register("msContextMenu", "Plexus: Place on drawing", () => true, (arg) => {
    // The selection is read first, with no await before it.
    let rows = Array.isArray(arg?.blocks) ? arg.blocks : null;
    if (!rows?.length) {
      try { rows = api.ui.multiselect?.getSelected?.() ?? []; } catch { rows = []; }
    }
    const uids = [...new Set((rows || []).map((r) => (typeof r === "string" ? r : r?.["block-uid"])).filter(Boolean))];
    if (!uids.length) return;
    const memo = new Map();
    const ordered = inOutlineOrder(topMost(uids, memo), memo);
    if (!ordered.length) {
      console.warn("[plexus] place: nothing left to place after dropping descendants and Plexus containers");
      return;
    }
    return editorOpen() ? actions.placeBlocks(ordered) : actions.armPlace(ordered);
  });

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
  let point = null;

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

  const entry = (item) => {
    const button = make("button", "context-menu-item");
    button.type = "button";
    button.append(make("div", "context-menu-item__label", item.label), make("kbd", "context-menu-item__shortcut", item.kbd ?? ""));
    if (item.hint) button.setAttribute?.("title", item.hint);
    if (item.enabled === false) {
      button.disabled = true;
      return button;
    }
    button.addEventListener("click", (e) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      try { app?.setState?.({ contextMenu: null }); } catch (error) { console.warn("[plexus] close menu failed", error); }
      guard(item.label, () => item.run())();
    });
    return button;
  };

  // A flyout opens on hover and on click, flips to the left edge when it would leave the viewport, and dies with its li.
  const submenu = (item, kids) => {
    const li = make("li", "plexus-submenu");
    li.setAttribute?.("data-testid", `plexus-${item.id}`);
    const button = make("button", "context-menu-item");
    button.type = "button";
    button.setAttribute?.("aria-haspopup", "true");
    button.append(make("div", "context-menu-item__label", item.label), make("kbd", "context-menu-item__shortcut", ""));
    const flyout = make("ul", "plexus-flyout");
    for (const kid of kids) {
      const kli = make("li");
      kli.setAttribute?.("data-testid", `plexus-${kid.id}`);
      kli.append(entry(kid));
      flyout.append(kli);
    }
    // Fixed, not absolute: the context menu scrolls inside the editor, and overflow would clip an absolute flyout.
    const place = () => {
      try {
        flyout.style.position = "fixed";
        flyout.style.right = "auto";
        flyout.style.zIndex = "100002";
        const anchor = button.getBoundingClientRect?.();
        if (!anchor || !flyout.getBoundingClientRect) return;
        const rect = flyout.getBoundingClientRect();
        const width = win?.innerWidth ?? 0;
        const height = win?.innerHeight ?? 0;
        const fw = rect.width || 200;
        const fh = rect.height || 0;
        let left = anchor.right;
        let top = anchor.top;
        if (width && left + fw > width - 8) left = Math.max(8, anchor.left - fw);
        if (height && top + fh > height - 8) top = Math.max(8, height - 8 - fh);
        flyout.style.left = `${left}px`;
        flyout.style.top = `${top}px`;
      } catch (error) { console.warn("[plexus] flyout clamp failed", error); }
    };
    const setOpen = (open) => {
      if (open) { li.setAttribute("data-open", "1"); place(); } else li.removeAttribute?.("data-open");
    };
    li.addEventListener("mouseenter", () => setOpen(true));
    li.addEventListener("mouseleave", () => setOpen(false));
    button.addEventListener("click", (e) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      setOpen(true);
    });
    li.append(button, flyout);
    return li;
  };

  const inject = (ul) => {
    removeOurs(ul);
    let items = [];
    try { items = (getItems(point) || []).filter((i) => i && i.enabled); } catch (error) { console.warn("[plexus] canvas menu items failed", error); }
    if (!items.length) return;
    ul.append(make("hr", "context-menu-item-separator"));
    for (const item of items) {
      if (Array.isArray(item.children)) {
        const kids = item.children.filter(Boolean);
        if (kids.some((k) => k.enabled)) ul.append(submenu(item, kids));
        continue;
      }
      const li = make("li");
      li.setAttribute?.("data-testid", `plexus-${item.id}`);
      li.append(entry(item));
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

  const onContext = (e) => {
    point = Number.isFinite(e?.clientX) && Number.isFinite(e?.clientY) ? { x: e.clientX, y: e.clientY } : null;
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

// The canvas-menu items, built fresh on every right-click so each `enabled` reads the current selection.
export function plexusCanvasItems({ app, native, actions, openSettings, drawingUid, guard, point, tools, mindmap, arrange, openPicker, noteAt, toScene, showTag, mac = /mac|iphone|ipad/i.test(String(globalThis.navigator?.platform ?? "")) } = {}) {
  const kbd = (id) => hotkeyFor(id, { mac });
  const can = (fn) => { try { return !!fn(); } catch { return false; } };
  const call = (name, fn) => () => {
    try {
      const out = fn();
      if (out && typeof out.catch === "function") out.catch((error) => console.warn("[plexus]", name, "failed", error));
    } catch (error) {
      console.warn("[plexus]", name, "failed", error);
    }
  };
  const selectedIds = () => native.selectedElementIds(app);
  const selectedElements = () => {
    const ids = new Set(selectedIds());
    const all = app?.getSceneElementsIncludingDeleted?.() ?? app?.getSceneElements?.() ?? [];
    return all.filter((el) => ids.has(el.id) && !el.isDeleted);
  };
  const noSelection = () => selectedIds().length === 0;
  const freeText = (el) => el.type === "text" && !el.containerId;
  const hasSnapshot = () => (actions.hasSnapshot ?? guard?.hasSnapshot)?.(drawingUid);
  const pending = () => { try { return actions.pendingRegionUpdate?.() ?? null; } catch { return null; } };
  const pend = pending();
  const mm = (() => { try { return mindmap?.mapOptions?.(app) ?? null; } catch { return null; } })();
  const layoutItem = (layout, name) => ({ id: `mm-layout-${layout}`, label: `Plexus: Mind map layout: ${name}${mm?.layout === layout ? " (current)" : ""}`, enabled: !!mm, run: call(`mm-layout-${layout}`, () => mindmap.setLayout(app, layout)) });
  const arrangeItem = () => {
    const children = ARRANGE_OPS.map((op) => ({ id: `arrange-${op.op}`, label: op.label, hint: op.hint, enabled: can(() => arrange?.canRun(op.op)), run: call(`arrange-${op.op}`, () => arrange.run(op.op)) }));
    return { id: "arrange", label: "Plexus: Arrange \u203a", enabled: children.some((c) => c.enabled), children };
  };
  const placing = (() => { try { return actions.pendingPlace?.() ?? null; } catch { return null; } })();
  let only = [];
  try { only = selectedElements(); } catch { only = []; }
  const single = only.length === 1 ? only[0] : null;
  const freeOne = !!(single && single.type === "text" && !single.containerId);
  const imageOne = !!(single && single.type === "image");
  const embedOne = !!(single && single.type === "rectangle" && typeof single.customData?.plexus?.embed === "string");
  const turnKids = [
    { id: "turn-page-embed", label: "Plexus: Page embed", enabled: freeOne, run: call("turn-page-embed", () => actions.turnInto("page-embed")) },
    { id: "turn-page-link", label: "Plexus: Page link", enabled: freeOne, run: call("turn-page-link", () => actions.turnInto("page-link")) },
    { id: "turn-block-embed", label: "Plexus: Block embed", enabled: freeOne, run: call("turn-block-embed", () => actions.turnInto("block-embed")) },
    { id: "turn-block-link", label: "Plexus: Block link", enabled: freeOne, run: call("turn-block-link", () => actions.turnInto("block-link")) },
    { id: "turn-image", label: "Plexus: Image block", enabled: imageOne, run: call("turn-image", () => actions.turnInto("image-block")) },
    { id: "turn-text", label: "Plexus: Back to text", enabled: embedOne, run: call("turn-text", () => actions.turnInto("text")) },
  ].filter((kid) => kid.enabled);
  const turnIntoItem = { id: "turn-into", label: "Plexus: Turn into \u203a", enabled: turnKids.length > 0, children: turnKids };

  return [
    { id: "region", label: "Plexus: Create region", enabled: can(() => selectedIds().length > 0), kbd: kbd("region"), run: call("region", () => actions.createAreaRegion()) },
    { id: "frame", label: "Plexus: Frame region", enabled: can(() => actions.isFrameSelected()), run: call("frame", () => actions.createFrameRegion()) },
    { id: "crop", label: "Plexus: Region from crop", enabled: can(() => actions.hasCroppedImageSelected()), run: call("crop", () => actions.regionFromCrop()) },
    { id: "image", label: "Plexus: Image region", enabled: can(() => actions.hasSingleImageSelected()), kbd: kbd("image"), run: call("image", () => actions.createImageRegion()) },
    { id: "embed", label: "Plexus: Embed block from clipboard", enabled: true, run: call("embed", () => actions.insertEmbedFromClipboard()) },
    { id: "embed-picker", label: "Plexus: Embed page or block\u2026", enabled: !!openPicker, kbd: kbd("embed"), run: call("embed-picker", () => openPicker(point)) },
    { id: "note", label: "Plexus: New note card", enabled: !!noteAt, kbd: kbd("note"), run: call("note", () => noteAt(point)) },
    { id: "edit-embed", label: "Plexus: Edit embed", enabled: can(() => actions.canEditEmbed()), run: call("edit-embed", () => actions.editEmbed()) },
    { id: "remove-embed", label: "Plexus: Remove embed (block untouched)", enabled: can(() => actions.canRemoveEmbed()), run: call("remove-embed", () => actions.removeSelectedEmbed()) },
    { id: "present", label: "Plexus: Present", enabled: can(() => actions.hasFrames()), kbd: kbd("present"), run: call("present", () => actions.presentDrawing()) },
    { id: "present-here", label: "Plexus: Present from here", enabled: can(() => actions.hasFrames()), run: call("present-here", () => actions.presentDrawing({ from: "here", at: point && toScene ? toScene(point) : undefined })) },
    { id: "present-live", label: "Plexus: Present live", enabled: can(() => actions.hasFrames()), run: call("present-live", () => actions.presentLive()) },
    { id: "set-step", label: "Plexus: Set reveal step", enabled: can(() => selectedIds().length > 0), run: call("set-step", () => actions.setRevealStep()) },
    { id: "clear-step", label: "Plexus: Clear reveal step", enabled: can(() => selectedIds().length > 0), run: call("clear-step", () => actions.clearRevealStep()) },
    { id: "add-occlusion", label: "Plexus: Add occlusion", enabled: can(() => selectedIds().length > 0), run: call("add-occlusion", () => actions.addOcclusion()) },
    { id: "mark-flashcard", label: "Plexus: Mark flashcard", enabled: can(() => selectedIds().length > 0), run: call("mark-flashcard", () => actions.markFlashcard()) },
    { id: "export", label: "Plexus: Export\u2026", enabled: can(() => !!drawingUid), run: call("export", () => actions.exportDrawing()) },
    { id: "export-scene", label: "Plexus: Export scene", enabled: can(() => !!drawingUid), run: call("export-scene", () => actions.exportScene(drawingUid)) },
    { id: "tag-elements", label: "Plexus: Tag elements\u2026", enabled: can(() => selectedElements().some((el) => el.type === "text")), run: call("tag-elements", () => actions.tagElements()) },
    { id: "show-tag", label: "Plexus: Show only tag\u2026", enabled: can(() => !!drawingUid), run: call("show-tag", () => showTag?.()) },
    { id: "keep-export", label: "Plexus: Keep export image", enabled: can(() => !!drawingUid), run: call("keep-export", () => actions.keepExportImage()) },
    { id: "keep-links", label: "Plexus: Keep linked references", enabled: can(() => !!drawingUid), run: call("keep-links", () => actions.keepLinkedReferences(drawingUid)) },
    turnIntoItem,
    { id: "insert-image", label: "Plexus: Insert image or drawing\u2026", enabled: can(() => !!drawingUid), run: call("insert-image", () => actions.insertImageOrDrawing()) },
    { id: "drawing-name", label: "Plexus: Drawing name\u2026", enabled: can(() => !!drawingUid), run: call("drawing-name", () => actions.setDrawingName(drawingUid)) },
    { id: "task-card", label: "Plexus: Task card\u2026", enabled: can(() => !!drawingUid), run: call("task-card", () => actions.taskCard?.()) },
    { id: "page-card", label: "Plexus: Page card\u2026", enabled: can(() => !!drawingUid), run: call("page-card", () => actions.pageCard?.()) },
    { id: "live-query", label: "Plexus: Live query\u2026", enabled: can(() => !!drawingUid), run: call("live-query", () => actions.liveQuery?.()) },
    { id: "add-notes", label: "Plexus: Add notes", enabled: can(() => actions.selectedFrameId()), run: call("add-notes", () => actions.addNotesForFrame({ drawingUid, frameId: actions.selectedFrameId() })) },
    { id: "mindmap", label: "Plexus: Mind map", enabled: true, kbd: kbd("mindmap"), run: call("mindmap", () => actions.startMindMap()) },
    { id: "settings", label: "Plexus: Region settings…", enabled: true, run: () => openSettings() },
    { id: "copy-drawing", label: "Plexus: Copy ((drawing))", enabled: can(() => drawingUid && noSelection()), run: call("copy-drawing", () => actions.copyDrawingRef()) },
    { id: "copy-embed", label: "Plexus: Copy drawing embed", enabled: can(() => drawingUid && noSelection()), run: call("copy-embed", () => actions.copyDrawingEmbed()) },
    { id: "frames-regions", label: "Plexus: Regions for all frames", enabled: can(() => noSelection() && actions.hasFrames()), run: call("frames-regions", () => actions.regionsForAllFrames()) },
    { id: "restore", label: "Plexus: Restore before last Plexus change", enabled: can(() => noSelection() && drawingUid && hasSnapshot()), run: call("restore", () => actions.restoreBeforeLastPlexusChange()) },
    { id: "restore-version", label: "Plexus: Restore an earlier version\u2026", enabled: !!tools?.restore && !!drawingUid, run: call("restore-version", () => tools.restore()) },
    { id: "chart-json", label: "Plexus: Cause-and-effect from JSON\u2026", enabled: !!tools?.chart && !!drawingUid, run: call("chart-json", () => tools.chart()) },
    { id: "to-outline", label: "Plexus: Drawing to outline\u2026", enabled: !!tools?.outline && !!drawingUid, run: call("to-outline", () => tools.outline({ focusedUid: drawingUid })) },
    { id: "copy-markdown", label: "Plexus: Copy as Roam markdown", enabled: !!tools?.copyMarkdown && !!drawingUid, run: call("copy-markdown", () => tools.copyMarkdown({ focusedUid: drawingUid })) },
    layoutItem("right", "Right"),
    layoutItem("cause", "Cause"),
    layoutItem("fishbone", "Fishbone"),
    layoutItem("flow", "Flow"),
    { id: "mm-attr-edges", label: `Plexus: Attribute blocks as edges${mm ? (mm.attrEdges ? ": on" : ": off") : ""}`, enabled: !!mm, run: call("mm-attr-edges", () => mindmap.setAttrEdges(app, !mm.attrEdges)) },
    arrangeItem(),
    { id: "text-only", label: "Plexus: Select text only", enabled: can(() => {
      const els = selectedElements();
      return els.length >= 2 && els.some(freeText);
    }), run: call("text-only", () => actions.selectTextOnly()) },
    { id: "remove-link", label: "Plexus: Remove link", enabled: can(() => selectedElements().some((el) => el.link)), run: call("remove-link", () => actions.removeElementLink()) },
    ...(placing ? [{ id: "place-pending", label: `Plexus: Place ${placing.count} blocks here`, enabled: true, run: call("place-pending", () => actions.placePending(point && toScene ? toScene(point) : undefined)) }] : []),
    ...(pend ? [{ id: "apply-pending", label: `Plexus: Update region "${pend.label ?? pend.uid}" from selection`, enabled: can(() => selectedIds().length > 0), run: call("apply-pending", () => actions.applyPendingUpdate()) }] : []),
  ];
}
