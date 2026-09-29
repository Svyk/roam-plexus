import * as defaultNative from "../host/native.js";
import { elementBounds, liveElements, regionSceneBBox } from "../model/scene.js";
import { isContainerString } from "../model/region.js";

export const BACKLINK_WATCH_CAP = 150;
export const BACKLINK_ROW_CAP = 20;
const MERGE_TOLERANCE = 2;
const REGION_REFETCH_MS = 3000;
const REFS_PATTERN = "[{:block/_refs [:block/uid :block/string {:block/page [:node/title :block/uid]}]}]";
const WATCH_PATTERN = "[{:block/_refs [:block/uid]}]";
const IMAGE_KINDS = new Set(["imgrect", "imgpoly"]);

const union = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
const themed = (base, dark) => (dark ? `${base} plexus-backlinks--dark` : base);
const sameBox = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= MERGE_TOLERANCE);

export function createCanvasBacklinks({
  doc,
  api = globalThis.roamAlphaAPI,
  host,
  app,
  containerEl,
  drawingUid,
  zIndex = 1000,
  native = defaultNative,
  openTarget = () => {},
  raf,
  caf,
  now = () => Date.now(),
}) {
  const view = doc.defaultView;
  const requestFrame = raf ?? ((cb) => (typeof view?.requestAnimationFrame === "function" ? view.requestAnimationFrame(cb) : setTimeout(cb, 16)));
  const cancelFrame = caf ?? ((id) => (typeof view?.cancelAnimationFrame === "function" ? view.cancelAnimationFrame(id) : clearTimeout(id)));

  const layer = doc.createElement("div");
  layer.className = "plexus-portal plexus-backlinks";
  layer.style.zIndex = String(zIndex + 1);
  doc.body.append(layer);

  const badges = new Map();
  const refsByUid = new Map();
  const watches = new Map();
  let regions = [];
  let regionsAt = -Infinity;
  let regionSig = "";
  let targets = [];
  let sceneSig = null;
  let pendingFrame = null;
  let unsubscribe = null;
  let disposed = false;
  let capLogged = false;
  let popover = null;

  const warn = (message, error) => console.warn("[plexus]", message, error);

  const excludedUids = () => new Set([drawingUid, ...regions.map((r) => r.uid)]);

  function loadRefs(uid) {
    let raw;
    try {
      raw = api.data.pull(REFS_PATTERN, [":block/uid", uid]);
    } catch (error) {
      warn("backlinks pull failed", error);
      return [];
    }
    const excluded = excludedUids();
    const rows = [];
    for (const r of raw?.[":block/_refs"] ?? []) {
      const refUid = r?.[":block/uid"];
      if (!refUid || excluded.has(refUid)) continue;
      const string = r[":block/string"] ?? "";
      if (isContainerString(string)) continue;
      rows.push({ uid: refUid, string, page: r[":block/page"]?.[":node/title"] ?? "" });
    }
    return rows;
  }

  function fetchRegions() {
    try {
      regions = host.regionsOf(drawingUid) ?? [];
    } catch (error) {
      warn("backlinks regions failed", error);
      regions = [];
    }
    regionsAt = now();
    const sig = regions.map((r) => r.uid).join(",");
    const changed = sig !== regionSig;
    regionSig = sig;
    return changed;
  }

  // Element -> mind-map node uid. A bound text resolves through its container.
  function nodeUidOf(el, byId) {
    const own = el?.customData?.plexus?.mm?.uid;
    if (own) return own;
    const container = el?.containerId ? byId.get(el.containerId) : null;
    return container?.customData?.plexus?.mm?.uid ?? null;
  }

  // A region whose elements all belong to exactly one mind-map node shares that node's badge.
  function regionNodeUid(region, live, byId) {
    let members = [];
    if (region.kind === "area") members = (region.ids ?? []).map((id) => byId.get(id)).filter(Boolean);
    else if (region.kind === "group") {
      const g = region.groupId ?? region.g;
      members = live.filter((el) => Array.isArray(el.groupIds) && el.groupIds.includes(g));
    }
    if (!members.length) return null;
    const uids = new Set(members.map((el) => nodeUidOf(el, byId)));
    return uids.size === 1 && !uids.has(null) ? [...uids][0] : null;
  }

  function collectTargets() {
    const elements = app.getSceneElementsIncludingDeleted?.() ?? [];
    const appState = app.state;
    const live = liveElements(elements);
    const byId = new Map(live.map((el) => [el.id, el]));
    const byAnchor = new Map();
    const add = (anchor, uid, bbox) => {
      const prev = byAnchor.get(anchor);
      if (!prev) byAnchor.set(anchor, { uids: new Set([uid]), bbox });
      else { prev.uids.add(uid); prev.bbox = union(prev.bbox, bbox); }
    };
    for (const { uid, region } of regions) {
      if (!region || IMAGE_KINDS.has(region.kind)) continue;
      try {
        // Content box: the padding around a region is not part of what is being referenced.
        const out = regionSceneBBox({ ...region, pad: 0 }, elements, appState);
        if (out?.bbox) add(regionNodeUid(region, live, byId) ?? uid, uid, out.bbox);
      } catch (error) {
        warn("backlinks region bbox failed", error);
      }
    }
    for (const el of live) {
      const uid = el?.customData?.plexus?.mm?.uid;
      if (!uid) continue;
      try { add(uid, uid, elementBounds(el)); } catch (error) { warn("backlinks node bbox failed", error); }
    }
    return [...byAnchor.values()].map((t) => ({ uids: [...t.uids], bbox: t.bbox }));
  }

  function syncWatches(uids) {
    const wanted = new Set(uids);
    for (const [uid, entry] of [...watches]) {
      if (wanted.has(uid)) continue;
      removeWatch(uid, entry);
    }
    for (const uid of uids) {
      if (watches.has(uid)) continue;
      if (watches.size >= BACKLINK_WATCH_CAP) {
        if (!capLogged) { capLogged = true; console.warn(`[plexus] backlinks: more than ${BACKLINK_WATCH_CAP} targets, extra badges are not live`); }
        continue;
      }
      const eid = `[:block/uid "${uid}"]`;
      const cb = () => {
        if (disposed) return;
        try {
          refsByUid.set(uid, loadRefs(uid));
          render();
          layout();
        } catch (error) { warn("backlinks watch failed", error); }
      };
      try {
        api.data.addPullWatch(WATCH_PATTERN, eid, cb);
        watches.set(uid, { eid, cb });
      } catch (error) { warn("backlinks watch failed", error); }
    }
  }

  function removeWatch(uid, entry) {
    watches.delete(uid);
    try { api.data.removePullWatch(WATCH_PATTERN, entry.eid, entry.cb); } catch (error) { warn("backlinks unwatch failed", error); }
  }

  function groups() {
    const out = [];
    const sorted = [...targets].sort((a, b) => (a.uids[0] < b.uids[0] ? -1 : 1));
    for (const t of sorted) {
      const g = out.find((x) => sameBox(x.bbox, t.bbox));
      if (g) { g.uids.push(...t.uids.filter((u) => !g.uids.includes(u))); g.bbox = union(g.bbox, t.bbox); } else out.push({ uids: [...t.uids], bbox: [...t.bbox] });
    }
    for (const g of out) g.uids.sort();
    return out;
  }

  function refsOf(uids) {
    const seen = new Set();
    const rows = [];
    for (const uid of uids) {
      for (const row of refsByUid.get(uid) ?? []) {
        if (seen.has(row.uid)) continue;
        seen.add(row.uid);
        rows.push(row);
      }
    }
    return rows;
  }

  function makeBadge(key) {
    const el = doc.createElement("button");
    el.className = "plexus-backlink-badge";
    el.type = "button";
    const stop = (e) => e?.stopPropagation?.();
    const onClick = (e) => {
      e?.stopPropagation?.();
      e?.preventDefault?.();
      if (popover?.key === key) closePopover(); else openPopover(key);
    };
    el.addEventListener("pointerdown", stop);
    el.addEventListener("mousedown", stop);
    el.addEventListener("click", onClick);
    layer.append(el);
    return {
      key, el, uids: [], bbox: null, refs: [], x: 0, y: 0, hidden: false,
      detach() {
        el.removeEventListener("pointerdown", stop);
        el.removeEventListener("mousedown", stop);
        el.removeEventListener("click", onClick);
        el.remove();
      },
    };
  }

  function render() {
    const live = new Map();
    for (const g of groups()) {
      const refs = refsOf(g.uids);
      if (!refs.length) continue;
      const key = g.uids.join("|");
      let badge = badges.get(key);
      if (!badge) { badge = makeBadge(key); badges.set(key, badge); }
      const changed = badge.refs.length !== refs.length || badge.refs.some((r, i) => r.uid !== refs[i].uid || r.string !== refs[i].string);
      badge.uids = g.uids;
      badge.bbox = g.bbox;
      badge.refs = refs;
      if (badge.count !== refs.length) {
        badge.count = refs.length;
        badge.el.textContent = String(refs.length);
        badge.el.title = `${refs.length} ${refs.length === 1 ? "reference" : "references"}`;
      }
      live.set(key, badge);
      if (changed && popover?.key === key) repaintPopover();
    }
    for (const [key, badge] of [...badges]) {
      if (live.has(key)) continue;
      badges.delete(key);
      if (popover?.key === key) closePopover();
      badge.detach();
    }
  }

  function layout() {
    if (disposed || !badges.size) return;
    const dark = app.state?.theme === "dark";
    layer.className = themed("plexus-portal plexus-backlinks", dark);
    if (popover) popover.el.className = themed("plexus-portal plexus-backlink-popover", dark);
    const box = containerEl?.getBoundingClientRect?.() ?? { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
    for (const badge of badges.values()) {
      const rect = native.viewportRectOf(app, badge.bbox);
      const cx = rect.left + rect.width;
      const cy = rect.top;
      const hidden = !(cx >= box.left && cx <= box.right && cy >= box.top && cy <= box.bottom);
      badge.x = cx + 3;
      badge.y = cy + 3;
      badge.hidden = hidden;
      badge.el.style.left = `${badge.x}px`;
      badge.el.style.top = `${badge.y}px`;
      badge.el.style.display = hidden ? "none" : "";
      if (hidden && popover?.key === badge.key) closePopover();
    }
    if (popover) placePopover();
  }

  function update() {
    if (disposed) return;
    let regionsChanged = false;
    if (now() - regionsAt > REGION_REFETCH_MS) regionsChanged = fetchRegions();
    const elements = app.getSceneElementsIncludingDeleted?.() ?? [];
    let sum = elements.length;
    for (const el of elements) sum += Number(el?.version) || 0;
    const sig = `${sum}:${elements.length}`;
    if (regionsChanged || sig !== sceneSig) {
      sceneSig = sig;
      targets = collectTargets();
      const uids = targets.flatMap((t) => t.uids);
      syncWatches(uids);
      for (const uid of uids) if (!refsByUid.has(uid) || regionsChanged) refsByUid.set(uid, loadRefs(uid));
      for (const uid of [...refsByUid.keys()]) if (!uids.includes(uid)) refsByUid.delete(uid);
      render();
    }
    layout();
  }

  function schedule() {
    if (disposed || pendingFrame != null) return;
    pendingFrame = requestFrame(() => {
      pendingFrame = null;
      try { update(); } catch (error) { warn("backlinks update failed", error); }
    });
  }

  // Popover
  function placePopover() {
    const badge = badges.get(popover?.key);
    if (!badge) return;
    const width = view?.innerWidth;
    const left = Number.isFinite(width) ? Math.max(0, Math.min(badge.x, width - 340)) : badge.x;
    popover.el.style.left = `${left}px`;
    popover.el.style.top = `${badge.y + 24}px`;
  }

  function onKey(e) {
    if (e?.key === "Escape") closePopover();
  }

  const inside = (target) => {
    for (let n = target; n; n = n.parentNode ?? n.parentElement) {
      if (n === popover?.el) return true;
      if (n?.classList?.contains?.("plexus-backlink-badge") || n?.className === "plexus-backlink-badge") return true;
    }
    return false;
  };
  const onOutside = (e) => { if (!inside(e?.target)) closePopover(); };

  function openPopover(key) {
    closePopover();
    const badge = badges.get(key);
    if (!badge) return;
    const el = doc.createElement("div");
    el.className = themed("plexus-portal plexus-backlink-popover", app.state?.theme === "dark");
    el.style.zIndex = String(zIndex + 3);
    const stop = (e) => e?.stopPropagation?.();
    el.addEventListener("mousedown", stop);
    el.addEventListener("pointerdown", stop);
    const hosts = [];
    const rowHandlers = [];
    for (const ref of badge.refs.slice(0, BACKLINK_ROW_CAP)) {
      const row = doc.createElement("div");
      row.className = "plexus-backlink-row";
      const page = doc.createElement("div");
      page.className = "plexus-backlink-page";
      page.textContent = ref.page;
      const body = doc.createElement("div");
      body.className = "plexus-backlink-block";
      row.append(page, body);
      el.append(row);
      hosts.push(body);
      try {
        api.ui.components.renderString({ el: body, string: ref.string });
      } catch (error) {
        warn("backlinks render failed", error);
        body.textContent = ref.string;
      }
      const onClick = (e) => {
        e?.stopPropagation?.();
        e?.preventDefault?.();
        closePopover();
        try { openTarget({ type: "block", uid: ref.uid }, { sidebar: !!e?.shiftKey }); } catch (error) { warn("backlinks open failed", error); }
      };
      row.addEventListener("click", onClick);
      rowHandlers.push([row, onClick]);
    }
    if (badge.refs.length > BACKLINK_ROW_CAP) {
      const more = doc.createElement("div");
      more.className = "plexus-backlink-more";
      more.textContent = `+${badge.refs.length - BACKLINK_ROW_CAP} more`;
      el.append(more);
    }
    doc.body.append(el);
    popover = { key, el, hosts, stop, rowHandlers };
    doc.addEventListener("keydown", onKey, true);
    doc.addEventListener("mousedown", onOutside, true);
    doc.addEventListener("wheel", onOutside, true);
    doc.addEventListener("scroll", onOutside, true);
    placePopover();
  }

  function closePopover() {
    const p = popover;
    if (!p) return;
    popover = null;
    doc.removeEventListener("keydown", onKey, true);
    doc.removeEventListener("mousedown", onOutside, true);
    doc.removeEventListener("wheel", onOutside, true);
    doc.removeEventListener("scroll", onOutside, true);
    for (const host_ of p.hosts) {
      try { api.ui.components.unmountNode({ el: host_ }); } catch (error) { warn("backlinks unmount failed", error); }
    }
    for (const [row, fn] of p.rowHandlers) row.removeEventListener("click", fn);
    p.el.removeEventListener("mousedown", p.stop);
    p.el.removeEventListener("pointerdown", p.stop);
    p.el.remove();
  }

  function repaintPopover() {
    const key = popover?.key;
    if (key) openPopover(key);
  }

  function refresh() {
    if (disposed) return;
    try {
      fetchRegions();
      sceneSig = null;
      targets = [];
      for (const uid of [...refsByUid.keys()]) refsByUid.delete(uid);
      update();
    } catch (error) { warn("backlinks refresh failed", error); }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (pendingFrame != null) { cancelFrame(pendingFrame); pendingFrame = null; }
    try { unsubscribe?.(); } catch (error) { warn("backlinks unsubscribe failed", error); }
    unsubscribe = null;
    closePopover();
    for (const [uid, entry] of [...watches]) removeWatch(uid, entry);
    for (const badge of badges.values()) badge.detach();
    badges.clear();
    refsByUid.clear();
    layer.remove();
  }

  try {
    unsubscribe = native.subscribeViewport(app, schedule);
  } catch (error) { warn("backlinks subscribe failed", error); }
  refresh();

  return { refresh, dispose };
}
