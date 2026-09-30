import { parseRegion } from "../model/region.js";
import { parseImageRefs } from "../model/image.js";
import { overrideKey } from "../model/refdisplay.js";
import { isImageKind } from "../model/label.js";
import { resolveRegionTarget } from "./regionref.js";

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

const overrideMode = (o) => (typeof o === "string" ? o : o?.mode ?? null);

export function installRoamMenus({ api, host, actions, regionref, getSettings = () => ({}), setRefOverride, openSettings, openPrompt, isEncrypted, doc = globalThis.document, now = () => Date.now() } = {}) {
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
    const kind = parseRegion(string)?.kind;
    return { supported, mode, captionState, drawingKind: !isImageKind(kind), hasOverride: overrideMode(overrides[overrideKey(block, ref)]) != null };
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
      drawingKind,
      needsRepair: drawingKind && needsRepair(region),
    };
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
  register("blockRefContextMenu", "Plexus: Region settings…", refShow(), () => openSettings());
  register("blockRefContextMenu", "Plexus: Copy region link", refShow(), (e) => actions.copyRegionLink(refOf(e).ref));

  const blockShow = (key) => (e) => !!blockInfo(e?.["block-uid"], e?.["block-uid"])[key];
  register("blockContextMenu", "Plexus: Region on image", blockShow("images"), (e) => actions.createPlainImageRegion(e?.["block-uid"]));
  register("blockContextMenu", "Plexus: Present frames", blockShow("drawing"), (e) => actions.presentDrawing({ drawingUid: e?.["block-uid"] }));
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

// The canvas-menu items, built fresh on every right-click so each `enabled` reads the current selection.
export function plexusCanvasItems({ app, native, actions, openSettings, drawingUid, guard } = {}) {
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

  return [
    { id: "region", label: "Plexus: Create region", enabled: can(() => selectedIds().length > 0), run: call("region", () => actions.createAreaRegion()) },
    { id: "frame", label: "Plexus: Frame region", enabled: can(() => actions.isFrameSelected()), run: call("frame", () => actions.createFrameRegion()) },
    { id: "crop", label: "Plexus: Region from crop", enabled: can(() => actions.hasCroppedImageSelected()), run: call("crop", () => actions.regionFromCrop()) },
    { id: "image", label: "Plexus: Image region", enabled: can(() => actions.hasSingleImageSelected()), run: call("image", () => actions.createImageRegion()) },
    { id: "embed", label: "Plexus: Embed block from clipboard", enabled: true, run: call("embed", () => actions.insertEmbedFromClipboard()) },
    { id: "edit-embed", label: "Plexus: Edit embed", enabled: can(() => actions.canEditEmbed()), run: call("edit-embed", () => actions.editEmbed()) },
    { id: "present", label: "Plexus: Present", enabled: can(() => actions.hasFrames()), run: call("present", () => actions.presentDrawing()) },
    { id: "mindmap", label: "Plexus: Mind map", enabled: true, run: call("mindmap", () => actions.startMindMap()) },
    { id: "settings", label: "Plexus: Region settings…", enabled: true, run: () => openSettings() },
    { id: "copy-drawing", label: "Plexus: Copy ((drawing))", enabled: can(() => drawingUid && noSelection()), run: call("copy-drawing", () => actions.copyDrawingRef()) },
    { id: "copy-embed", label: "Plexus: Copy drawing embed", enabled: can(() => drawingUid && noSelection()), run: call("copy-embed", () => actions.copyDrawingEmbed()) },
    { id: "frames-regions", label: "Plexus: Regions for all frames", enabled: can(() => noSelection() && actions.hasFrames()), run: call("frames-regions", () => actions.regionsForAllFrames()) },
    { id: "restore", label: "Plexus: Restore before last Plexus change", enabled: can(() => noSelection() && drawingUid && hasSnapshot()), run: call("restore", () => actions.restoreBeforeLastPlexusChange()) },
    { id: "text-only", label: "Plexus: Select text only", enabled: can(() => {
      const els = selectedElements();
      return els.length >= 2 && els.some(freeText);
    }), run: call("text-only", () => actions.selectTextOnly()) },
    { id: "remove-link", label: "Plexus: Remove link", enabled: can(() => selectedElements().some((el) => el.link)), run: call("remove-link", () => actions.removeElementLink()) },
    ...(pend ? [{ id: "apply-pending", label: `Plexus: Update region "${pend.label ?? pend.uid}" from selection`, enabled: can(() => selectedIds().length > 0), run: call("apply-pending", () => actions.applyPendingUpdate()) }] : []),
  ];
}
