import * as defaultNative from "../host/native.js";
import { parseRoamLink } from "../model/links.js";
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
  onAddToCanvas,
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
  const refsByTitle = new Map();
  const watches = new Map();
  let regions = [];
  let regionsAt = -Infinity;
  let regionSig = "";
  let targets = [];
  let pageLinks = [];
  let sceneSig = null;
  let pendingFrame = null;
  let unsubscribe = null;
  let disposed = false;
  let capLogged = false;
  let popover = null;

  const warn = (message, error) => console.warn("[plexus]", message, error);

  const excludedUids = () => new Set([drawingUid, ...regions.map((r) => r.uid)]);

  function loadRefs(lookup) {
    let raw;
    try {
      raw = api.data.pull(REFS_PATTERN, lookup);
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

  // One badge per live element whose link is a page title. Not merged by title or bbox.
  function collectPageLinks() {
    const elements = app.getSceneElementsIncludingDeleted?.() ?? [];
    const out = [];
    const seen = new Set();
    for (const el of liveElements(elements)) {
      if (el.id == null || seen.has(el.id)) continue;
      const parsed = parseRoamLink(el.link);
      if (!parsed || parsed.type !== "page" || typeof parsed.title !== "string" || !parsed.title) continue;
      let bbox;
      try { bbox = elementBounds(el); } catch (error) { warn("backlinks page bbox failed", error); continue; }
      if (!bbox) continue;
      seen.add(el.id);
      out.push({ elementId: el.id, title: parsed.title, bbox });
    }
    return out;
  }

  function blockSpec(uid) {
    return { key: `b:${uid}`, refKey: uid, kind: "block", lookup: [":block/uid", uid], eid: `[:block/uid "${uid}"]` };
  }

  function pageSpec(title) {
    return { key: `p:${title}`, refKey: title, kind: "page", lookup: [":node/title", title], eid: `[:node/title ${JSON.stringify(title)}]` };
  }

  function watchSpecs() {
    const specs = [];
    const seen = new Set();
    for (const uid of targets.flatMap((t) => t.uids)) {
      if (seen.has(`b:${uid}`)) continue;
      seen.add(`b:${uid}`);
      specs.push(blockSpec(uid));
    }
    for (const { title } of pageLinks) {
      if (seen.has(`p:${title}`)) continue;
      seen.add(`p:${title}`);
      specs.push(pageSpec(title));
    }
    return specs;
  }

  function storeRefs(spec, rows) {
    if (spec.kind === "page") refsByTitle.set(spec.refKey, rows);
    else refsByUid.set(spec.refKey, rows);
  }

  function syncWatches(specs) {
    const wanted = new Set(specs.map((spec) => spec.key));
    for (const [key, entry] of [...watches]) {
      if (wanted.has(key)) continue;
      removeWatch(key, entry);
    }
    for (const spec of specs) {
      if (watches.has(spec.key)) continue;
      if (watches.size >= BACKLINK_WATCH_CAP) {
        if (!capLogged) { capLogged = true; console.warn(`[plexus] backlinks: more than ${BACKLINK_WATCH_CAP} targets, extra badges are not live`); }
        continue;
      }
      const cb = () => {
        if (disposed) return;
        try {
          storeRefs(spec, loadRefs(spec.lookup));
          render();
          layout();
        } catch (error) { warn("backlinks watch failed", error); }
      };
      try {
        api.data.addPullWatch(WATCH_PATTERN, spec.eid, cb);
        watches.set(spec.key, { eid: spec.eid, cb });
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
      key, el, uids: [], elementId: null, bbox: null, refs: [], x: 0, y: 0, hidden: false,
      detach() {
        el.removeEventListener("pointerdown", stop);
        el.removeEventListener("mousedown", stop);
        el.removeEventListener("click", onClick);
        el.remove();
      },
    };
  }

  function putBadge(key, { refs, bbox, uids, elementId }) {
    let badge = badges.get(key);
    if (!badge) { badge = makeBadge(key); badges.set(key, badge); }
    const changed = badge.refs.length !== refs.length || badge.refs.some((r, i) => r.uid !== refs[i].uid || r.string !== refs[i].string);
    badge.uids = uids;
    badge.elementId = elementId ?? null;
    badge.bbox = bbox;
    badge.refs = refs;
    if (badge.count !== refs.length) {
      badge.count = refs.length;
      badge.el.textContent = String(refs.length);
      badge.el.title = `${refs.length} ${refs.length === 1 ? "reference" : "references"}`;
    }
    if (changed && popover?.key === key) repaintPopover();
    return key;
  }

  function render() {
    const live = new Set();
    for (const g of groups()) {
      const refs = refsOf(g.uids);
      if (!refs.length) continue;
      live.add(putBadge(g.uids.join("|"), { refs, bbox: g.bbox, uids: g.uids, elementId: null }));
    }
    for (const p of pageLinks) {
      const refs = refsByTitle.get(p.title) ?? [];
      if (!refs.length) continue;
      live.add(putBadge(`el:${p.elementId}`, { refs, bbox: p.bbox, uids: [], elementId: p.elementId }));
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
      pageLinks = collectPageLinks();
      const specs = watchSpecs();
      syncWatches(specs);
      for (const spec of specs) if ((spec.kind === "page" ? !refsByTitle.has(spec.refKey) : !refsByUid.has(spec.refKey)) || regionsChanged) storeRefs(spec, loadRefs(spec.lookup));
      const uidSet = new Set(targets.flatMap((t) => t.uids));
      for (const uid of [...refsByUid.keys()]) if (!uidSet.has(uid)) refsByUid.delete(uid);
      const titleSet = new Set(pageLinks.map((p) => p.title));
      for (const title of [...refsByTitle.keys()]) if (!titleSet.has(title)) refsByTitle.delete(title);
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
      let addButton = null;
      if (typeof onAddToCanvas === "function") {
        addButton = doc.createElement("button");
        addButton.type = "button";
        addButton.className = "plexus-backlink-add";
        addButton.textContent = "Add to canvas";
        const onAdd = (e) => {
          e?.stopPropagation?.();
          e?.stopImmediatePropagation?.();
          e?.preventDefault?.();
          const current = badges.get(key) ?? badge;
          try {
            onAddToCanvas({
              elementId: current.elementId ?? null,
              bbox: current.bbox ? [...current.bbox] : null,
              ref: { uid: ref.uid, string: ref.string, page: ref.page },
            });
          } catch (error) { warn("backlinks add failed", error); }
        };
        addButton.addEventListener("click", onAdd);
        row.append(addButton);
        rowHandlers.push([addButton, onAdd]);
      }
      el.append(row);
      hosts.push(body);
      try {
        api.ui.components.renderString({ el: body, string: ref.string });
      } catch (error) {
        warn("backlinks render failed", error);
        body.textContent = ref.string;
      }
      const onClick = (e) => {
        for (let n = e?.target; n; n = n.parentNode ?? n.parentElement) {
          if (n === addButton) return;
          if (n === row) break;
        }
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
      refsByTitle.clear();
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
    refsByTitle.clear();
    layer.remove();
  }

  function selectionIds(value) {
    if (typeof value === "string") return value ? [value] : [];
    if (!Array.isArray(value)) return [];
    return value.filter((id) => typeof id === "string" && id);
  }

  function regionCovers(region, id, el) {
    if (!region || IMAGE_KINDS.has(region.kind)) return false;
    if (Array.isArray(region.ids) && region.ids.includes(id)) return true;
    const frame = region.frameId ?? region.fr;
    if (frame && id === frame) return true;
    const group = region.groupId ?? region.g;
    if (group && (id === group || (Array.isArray(el?.groupIds) && el.groupIds.includes(group)))) return true;
    return false;
  }

  // Opens the popover for a selected page link, mind-map node, or region member. Writes nothing.
  function cite(elementIds) {
    if (disposed) return false;
    const ids = selectionIds(elementIds);
    if (!ids.length) return false;
    const live = liveElements(app.getSceneElementsIncludingDeleted?.() ?? []);
    const byId = new Map(live.map((el) => [el.id, el]));
    const list = [...badges.values()];
    const hit = list.find((b) => b.elementId && ids.includes(b.elementId))
      ?? list.find((b) => ids.some((id) => {
        const uid = byId.get(id)?.customData?.plexus?.mm?.uid;
        return !!uid && b.uids.includes(uid);
      }))
      ?? list.find((b) => ids.some((id) => regions.some((entry) => b.uids.includes(entry.uid) && regionCovers(entry.region, id, byId.get(id)))));
    if (!hit) return false;
    openPopover(hit.key);
    return true;
  }

  try {
    unsubscribe = native.subscribeViewport(app, schedule);
  } catch (error) { warn("backlinks subscribe failed", error); }
  refresh();

  return { refresh, dispose, cite };
}
