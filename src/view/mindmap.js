import { CAUSE_LAYOUTS, FLOW_LAYOUT, LAYOUTS, allUids, drawnTree, editableText, flowEditable, flowParts, isExcludedString, plainText, hasMarkup, taskParts, treeFromPull, visibleNodes, countHidden, nearestInDirection } from "../model/mindmap.js";
import { flowStructure } from "../model/flow.js";
import { resolveDrop } from "../model/mmdrop.js";
import { viewportToScene } from "../model/scene.js";
import { applyOps, boundaryId, bump, edgeId, isEmptyOps, makeSizer, mmOf, nodeId, patchMarker, planMap, projectionIds, reconcile, textId } from "../model/mmsync.js";

const NODE_CAP = 500;
const DELETE_WINDOW_MS = 3000;
const LOAD_WAIT_MS = 5000;
const MAX_WAIT_MS = 4000;
const FORCE_MARK_MS = 5000;
const PLACEHOLDER_WINDOW_MS = 30000;
const DRAG_START_PX = 4;
const TASK_MACRO_LEN = "{{[[TODO]]}}".length;
const PLACEHOLDER_CHILD = "New idea";
const PLACEHOLDER_ROOT = "Central idea";
const GROW_HINT = "Use Tab / Enter to grow this map";
const FOLLOW_HINT = "Mind-map nodes follow the outline; Alt+Backspace deletes a branch";
const MARKUP_HINT = "Edit this node in the outline (it has links or formatting)";
const WRITE_FAILED = "Could not update the outline";
const CHANGED_ELSEWHERE = "Block changed elsewhere; not overwritten";
const LABEL_HINT = "Edit the attribute block in the outline";
const FLOW_LABEL_HINT = "Edit the Yes:/No: prefix in the outline";
const FLOW_LAYOUT_HINT = "Flow layout: change it from the map menu";
const FLOW_STEPS_HINT = "Flow steps follow the outline";
const FLOW_ATTR_HINT = "Not used in flow layout";
const LANE_ID_RE = /^pmm-.+-lane-/;
const SELF_MOVE = "Cannot move a branch into itself";
const CHANGE_BACK = "choose again to change back";
const ATTR_HINT = "Attribute blocks show as labelled edges (Plexus menu to turn off)";
const GESTURE_FIELDS = ["editingTextElement", "newElement", "resizingElement", "multiElement", "editingLinearElement"];
const INPUT_ISOLATED = ["keyup", "keypress", "beforeinput", "input", "paste", "copy", "cut"];
const ARROWS = { ArrowRight: "right", ArrowLeft: "left", ArrowDown: "down", ArrowUp: "up" };
const LETTERS = new Set(["KeyF", "KeyL", "KeyP", "KeyB", "KeyX", "KeyC", "KeyV"]);

const defaultRaf = (fn) => (typeof globalThis.requestAnimationFrame === "function" ? globalThis.requestAnimationFrame(fn) : setTimeout(fn, 16));
const defaultGuardedWrite = (app, { next, captureUpdate } = {}) => {
  const current = app.getSceneElementsIncludingDeleted?.() ?? [];
  app.updateScene({ elements: typeof next === "function" ? next(current) : next, ...(captureUpdate ? { captureUpdate } : {}) });
  return true;
};
const defaultCaf = (id) => (typeof globalThis.cancelAnimationFrame === "function" ? globalThis.cancelAnimationFrame(id) : clearTimeout(id));

function findNode(tree, uid) {
  if (!tree) return null;
  const stack = [{ node: tree, parent: null }];
  while (stack.length) {
    const { node, parent } = stack.pop();
    if (node.uid === uid) return { node, parent };
    for (const c of node.children) stack.push({ node: c, parent: node });
  }
  return null;
}

function rawWalk(raw, fn) {
  const stack = raw ? [raw] : [];
  while (stack.length) {
    const n = stack.pop();
    fn(n);
    for (const c of n[":block/children"] || []) stack.push(c);
  }
}

// Controller for mind maps. Nothing is registered until mount(); every listener, watch and portal dies with the editor.
export function createMindMap({ doc, api = globalThis.roamAlphaAPI, writer, measurer, native, toaster, raf = defaultRaf, caf = defaultCaf, now = () => Date.now(), zIndexFor = () => 1000, guardedWrite = defaultGuardedWrite, getTagColors = () => new Map(), createLaneRegions = async () => [] }) {
  const sessions = new Map();
  const laneFlights = new Map();
  let disposed = false;

  const warn = (what, error) => console.warn(`[plexus] mind map ${what} failed`, error);
  const toast = (message, opts) => { try { toaster.show(message, opts); } catch (error) { warn("toast", error); } };
  const failToast = () => toast(WRITE_FAILED, { kind: "error" });

  function blockString(uid) {
    try {
      const raw = api.data.pull("[:block/string]", [":block/uid", uid]);
      return typeof raw?.[":block/string"] === "string" ? raw[":block/string"] : null;
    } catch { return null; }
  }
  const textOf = (uid, node) => plainText(node.string, blockString);
  const sizer = makeSizer((text, size) => measurer.measure(text, size));
  const tagColors = () => { try { return getTagColors() || new Map(); } catch (error) { warn("tag colours", error); return new Map(); } };

  // One lane-region request in flight per drawing; frames asked for while it runs are merged into one queued re-run.
  function requestLaneRegions(drawingUid, frames) {
    if (disposed || !drawingUid || !frames.length) return;
    const flight = laneFlights.get(drawingUid);
    if (flight) {
      for (const f of frames) flight.queued.set(f.id, f);
      return;
    }
    const state = { queued: new Map() };
    laneFlights.set(drawingUid, state);
    (async () => {
      let batch = frames;
      while (batch.length && !disposed) {
        try { await createLaneRegions(drawingUid, batch); } catch (error) { warn("lane regions", error); }
        batch = [...state.queued.values()];
        state.queued.clear();
      }
    })().finally(() => { laneFlights.delete(drawingUid); });
  }

  function mount({ app, containerEl, outerEl, zIndex, drawingUid = null } = {}) {
    if (disposed || !app || !containerEl) return () => {};
    const s = createSession({ app, containerEl, outerEl, zIndex, drawingUid });
    sessions.set(app, s);
    return () => { s.dispose(); if (sessions.get(app) === s) sessions.delete(app); };
  }

  function createSession({ app, containerEl, outerEl, zIndex, drawingUid }) {
    let alive = true;
    const trees = new Map();
    const watches = new Map();
    const rootPos = new Map();
    const pendingRefresh = new Set();
    const pendingFinished = new Set();
    const idleRefresh = new Set();
    const lastRoot = new Map();
    const truncatedToast = new Set();
    const offs = [];
    let snapshot = new Map();
    let lastNonce = null;
    let prevEditingId = null;
    let dirty = false;
    let scheduled = null;
    let deleteToasted = false;
    let clip = null;
    let pendingDelete = null;
    let input = null;
    const fontSig = new Map();
    let loadedTimer = null;
    let deferredSince = null;
    const forceMarks = new Map();
    const rootDefaults = new Map();
    const createdAt = new Map();
    let pendingDrop = null;
    let drag = null;
    let dragCancelled = false;
    let labelToasted = false;
    let flowLabelToasted = false;

    const els = () => app.getSceneElementsIncludingDeleted?.() ?? [];
    const guard = () => alive && !disposed && native.activeEditor(doc)?.app === app;
    const state = () => app.state || {};

    function takeSnapshot() {
      snapshot = new Map();
      for (const el of els()) if (typeof el.id === "string" && el.id.startsWith("pmm-")) snapshot.set(el.id, el.version);
      recordRoots();
    }

    function recordRoots() {
      const live = els();
      for (const root of trees.keys()) {
        const el = live.find((e) => e.id === nodeId(root, root));
        if (el && Number.isFinite(el.x)) lastRoot.set(root, { x: el.x, y: el.y });
      }
    }

    // One updateScene per apply; read and write happen in the same synchronous task (amendment 34).
    function commit(mutate, roots, { force = false } = {}) {
      if (!guard()) return false;
      let next = els();
      if (mutate) next = mutate(next);
      let changed = next !== els();
      const staged = [];
      const laneIds = new Set();
      for (const root of roots) {
        const tree = trees.get(root);
        if (!tree) continue;
        const ops = reconcile({ elements: next, tree, sizes: sizer, textOf, rootPos: rootPos.get(root), ...mapOpts(root) });
        if (!isEmptyOps(ops)) {
          for (const a of ops.add) if (isLaneFrame(a)) laneIds.add(a.id);
          for (const u of ops.update) if (u.patch?.isDeleted === false && typeof u.id === "string" && LANE_ID_RE.test(u.id)) laneIds.add(u.id);
          next = applyOps(next, ops);
          changed = true;
        }
        staged.push(tree);
      }
      if (!changed) return false;
      const marked = roots.some((r) => (forceMarks.get(r) ?? 0) > now());
      const written = guardedWrite(app, { drawingUid, next, label: "Mind map", captureUpdate: "NEVER", force: force || marked, onApplyAnyway: () => commit(mutate, roots, { force: true }) });
      if (!written) return false;
      for (const root of roots) forceMarks.delete(root);
      takeSnapshot();
      if (laneIds.size) askLaneRegions(next.filter((e) => laneIds.has(e.id)));
      afterApply(roots);
      return true;
    }

    const isLaneFrame = (el) => !!el && el.type === "frame" && typeof el.id === "string" && LANE_ID_RE.test(el.id);
    const isFlow = (root) => mmOf(rootElement(root))?.layout === FLOW_LAYOUT;

    function askLaneRegions(frames) {
      const list = [];
      for (const el of frames) {
        if (!isLaneFrame(el) || el.isDeleted || typeof el.name !== "string" || el.name === "") continue;
        list.push({ id: el.id, name: el.name });
      }
      requestLaneRegions(drawingUid, list);
    }

    function mapOpts(root) {
      const defaults = rootDefaults.get(root);
      return { tagColors: tagColors(), ...(defaults ? { rootDefaults: defaults } : {}) };
    }

    function afterApply(roots) {
      for (const root of roots) {
        const tree = trees.get(root);
        if (!tree) continue;
        if (tree.truncated && !truncatedToast.has(root)) {
          truncatedToast.add(root);
          toast(`Showing the first ${NODE_CAP} nodes of this map`);
        }
        const texts = visibleNodes(tree).map((v) => textOf(v.node.uid, v.node));
        const sig = texts.join("\n");
        if (sig !== fontSig.get(root) && typeof measurer.ensureFonts === "function") {
          fontSig.set(root, sig);
          Promise.resolve(measurer.ensureFonts(texts)).then((cleared) => { if (cleared && alive) commit(null, [root]); }).catch((error) => warn("fonts", error));
        }
      }
      if (input) {
        if (liveNode(input.rootUid, input.uid)) placeInput(); else commitInput();
      }
    }

    function liveNode(root, uid) {
      const el = els().find((e) => e.id === nodeId(root, uid));
      return !!el && !el.isDeleted;
    }

    function buildTree(root, raw) {
      const prune = new Set(trees.keys());
      prune.delete(root);
      return treeFromPull(raw, { prune, maxVisible: NODE_CAP });
    }

    function detach(root, { force = false } = {}) {
      const ids = new Set(projectionIds(els(), root));
      if (ids.size && guard()) {
        const written = guardedWrite(app, { drawingUid, next: (list) => list.map((el) => (ids.has(el.id) ? bump(el, { isDeleted: true }) : el)), label: "Mind map", captureUpdate: "NEVER", force, onApplyAnyway: () => detach(root, { force: true }) });
        if (!written) return;
        takeSnapshot();
      }
      watches.get(root)?.();
      watches.delete(root);
      trees.delete(root);
      rootPos.delete(root);
      rootDefaults.delete(root);
      lastRoot.delete(root);
      fontSig.delete(root);
      pendingRefresh.delete(root);
      forceMarks.delete(root);
    }

    function onRaw(root, raw) {
      if (!alive) return;
      if (!raw) { detach(root); return; }
      if (gestureActive()) { pendingRefresh.add(root); dirty = true; deferredSince ??= now(); return; }
      const prevTree = trees.get(root);
      const nextTree = buildTree(root, raw);
      // No block vanished: a shrink can only come from folded (hidden) nodes, so it is a deliberate fold, not a delete.
      const foldOnly = !!prevTree && !prevTree.truncated && !nextTree.truncated && (() => {
        const now = allUids(nextTree);
        for (const u of allUids(prevTree)) if (!now.has(u)) return false;
        return true;
      })();
      trees.set(root, nextTree);
      commit(null, [root], { force: foldOnly });
    }

    function refreshRoot(root) {
      if (writer.isBusy?.(root)) {
        // Optimistic state stands until the queue drains (amendment 24).
        if (idleRefresh.has(root)) return;
        idleRefresh.add(root);
        writer.onIdle(root, () => { idleRefresh.delete(root); if (alive) refreshRoot(root); });
        return;
      }
      let raw = null;
      try { raw = writer.pullTree(root); } catch (error) { warn("pull", error); return; }
      onRaw(root, raw);
    }

    function ensureRoot(root) {
      if (watches.has(root)) return;
      watches.set(root, writer.watchTree(root, (raw) => onRaw(root, raw)));
      if (!trees.has(root)) trees.set(root, null);
    }

    function discoverRoots() {
      const found = new Set();
      for (const el of els()) {
        const mm = mmOf(el);
        if (el.isDeleted || !mm || typeof mm.map !== "string") continue;
        const ok = (mm.uid && el.id === nodeId(mm.map, mm.uid))
          || (mm.boundary && el.id === boundaryId(mm.map, mm.boundary))
          || (Array.isArray(mm.edge) && el.id === edgeId(mm.map, mm.edge[1]));
        if (ok) found.add(mm.map);
      }
      return found;
    }

    function start() {
      const deadline = now() + LOAD_WAIT_MS;
      const poll = () => {
        loadedTimer = null;
        if (!alive) return;
        if (state().isLoading && now() < deadline) { loadedTimer = raf(poll); return; }
        const roots = discoverRoots();
        for (const root of roots) if (!trees.has(root)) trees.set(root, null);
        for (const root of roots) { ensureRoot(root); refreshRoot(root); }
        takeSnapshot();
        askLaneRegions(els().filter((e) => isLaneFrame(e) && !e.isDeleted && [...roots].some((r) => e.id.startsWith(`pmm-${r}-lane-`))));
      };
      poll();
    }

    // ---- selection helpers ----

    function selectedNode() {
      const ids = native.selectedElementIds(app);
      if (ids.length !== 1) return null;
      const el = els().find((e) => e.id === ids[0]);
      const mm = mmOf(el);
      if (!el || el.isDeleted || !mm || !mm.uid || mm.edge || mm.boundary) return null;
      if (el.id !== nodeId(mm.map, mm.uid) || !trees.get(mm.map) || !findNode(trees.get(mm.map), mm.uid)) return null;
      return { el, uid: mm.uid, root: mm.map, isRoot: mm.root === true };
    }

    const selectedId = (root, uid) => !!state().selectedElementIds?.[nodeId(root, uid)];

    function select(root, uid) {
      app.updateScene({ appState: { selectedElementIds: { [nodeId(root, uid)]: true }, selectedGroupIds: {} }, captureUpdate: "NEVER" });
    }

    const refocus = () => { try { containerEl.focus({ preventScroll: true }); } catch { /* detached */ } };

    // ---- gesture gating ----

    function gestureActive() {
      const st = state();
      if (st.cursorButton === "down") return true;
      for (const key of GESTURE_FIELDS) if (key in st && st[key]) return true;
      return !!(st.isResizing || st.isRotating);
    }

    // ---- canvas -> outline detectors ----

    function onChange() {
      if (!alive || scheduled != null) return;
      scheduled = raf(() => pass());
    }

    function onPointerUp(activeTool, pds, event) {
      dirty = true;
      try { recordDrop(activeTool, pds, event); } catch (error) { warn("drop", error); }
      endDrag();
      onChange();
    }

    // ---- MM-1: drag to reparent or reorder ----

    const pointOf = (event, pds) => {
      const src = event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY) ? { x: event.clientX, y: event.clientY } : pds?.lastCoords;
      return src && Number.isFinite(src.x) && Number.isFinite(src.y) ? viewportToScene({ x: src.x, y: src.y, appState: state() }) : null;
    };

    // Decided here, applied in the next pass: a scene write inside the emitter could land in the user's undo step.
    function recordDrop(activeTool, pds, event) {
      const cancelled = dragCancelled;
      dragCancelled = false;
      if (cancelled || !pds || activeTool?.type !== "selection" || !pds.drag?.hasOccurred) return;
      if (pds.resize?.isResizing || state().viewModeEnabled || pds.hit?.hasBeenDuplicated) return;
      const modified = !!(event && (event.metaKey || event.ctrlKey));
      const sel = selectedNode();
      if (!sel || sel.isRoot) return;
      const flow = isFlow(sel.root);
      if (modified && !flow) return;
      const hitId = pds.hit?.element?.id;
      if (hitId !== nodeId(sel.root, sel.uid) && hitId !== textId(sel.root, sel.uid)) return;
      if (modified) { pendingDrop = { root: sel.root, uid: sel.uid, snap: true }; return; }
      const point = pointOf(event, pds);
      const seen = drag && drag.active && drag.root === sel.root && drag.uid === sel.uid && drag.plan && drag.tree;
      if (point) pendingDrop = { root: sel.root, uid: sel.uid, point, ...(seen ? { plan: drag.plan, tree: drag.tree } : {}) };
    }

    function planOf(root) {
      const tree = trees.get(root);
      return tree ? { tree, plan: planMap({ elements: els(), tree, sizes: sizer, textOf, ...mapOpts(root) }) } : null;
    }

    function otherMapAt(root, point) {
      for (const el of els()) {
        if (el.isDeleted || typeof el.id !== "string" || !el.id.startsWith("pmm-") || el.type === "text" || el.type === "arrow") continue;
        const mm = mmOf(el);
        if (!mm || mm.map === root || !mm.uid || el.id !== nodeId(mm.map, mm.uid)) continue;
        if (point.x >= el.x && point.x <= el.x + el.width && point.y >= el.y && point.y <= el.y + el.height) return true;
      }
      return false;
    }

    function handleDrop() {
      const d = pendingDrop;
      pendingDrop = null;
      if (!d || !trees.get(d.root) || !findNode(trees.get(d.root), d.uid)) return;
      const snapBack = () => commit(null, [d.root]);
      if (d.snap) { snapBack(); return; }
      const flow = isFlow(d.root);
      if (otherMapAt(d.root, d.point)) { snapBack(); return; }
      const ctx = d.plan && d.tree ? { plan: d.plan, tree: d.tree } : planOf(d.root);
      const res = resolveDrop({ plan: ctx.plan, tree: ctx.tree, dragged: d.uid, point: d.point, layout: ctx.plan.dir });
      if (flow && res.type !== "reparent" && res.type !== "refuse") { snapBack(); return; }
      if (res.type === "pin") return;
      if (res.type === "refuse") {
        if (res.reason === "own-subtree") toast(SELF_MOVE);
        snapBack();
        return;
      }
      const spec = { parentUid: res.parentUid, ...(res.beforeUid ? { beforeUid: res.beforeUid } : {}), ...(res.afterUid ? { afterUid: res.afterUid } : {}) };
      if (!moveNode(d.root, d.uid, spec)) snapBack();
    }

    // Optimistic move in the local block tree, then one queued moveTo; the echo redraws. False = nothing moved.
    function moveNode(root, uid, spec) {
      const tree = trees.get(root);
      const found = tree ? findNode(tree, uid) : null;
      const target = tree ? findNode(tree, spec.parentUid) : null;
      if (!found || !found.parent || !target) return false;
      if (findNode(found.node, spec.parentUid)) { toast(SELF_MOVE); return false; }
      const neighbour = spec.beforeUid ?? spec.afterUid ?? null;
      const list = target.node.children.filter((c) => c !== found.node);
      const ni = neighbour == null ? list.length : list.findIndex((c) => c.uid === neighbour);
      if (ni === -1 || neighbour === uid) return false;
      const at = neighbour == null ? ni : ni + (spec.afterUid != null && spec.beforeUid == null ? 1 : 0);
      const from = found.parent.children.indexOf(found.node);
      if (found.parent === target.node && at === from) return false;
      found.parent.children = found.parent.children.filter((c) => c !== found.node);
      target.node.children = [...list.slice(0, at), found.node, ...list.slice(at)];
      if (target.node !== found.parent) target.node.open = true;
      const id = nodeId(root, uid);
      const pinned = mmOf(els().find((e) => e.id === id))?.pinned === true;
      commit(pinned ? (l) => l.map((e) => (e.id === id ? patchMarker(e, { pinned: undefined }) : e)) : null, [root]);
      Promise.resolve(writer.moveTo(root, uid, spec)).then((result) => {
        if (result && result.ok === false) {
          if (result.reason === "inside-source") toast(SELF_MOVE);
          else if (result.reason !== "self") failToast();
        }
        refreshRoot(root);
      }).catch((error) => { warn("move", error); failToast(); refreshRoot(root); });
      return true;
    }

    let dragOffs = [];
    let dragFrame = null;
    let ring = null;

    function endDrag() {
      for (const off of dragOffs.splice(0)) { try { off(); } catch (error) { warn("cleanup", error); } }
      if (dragFrame != null) { caf(dragFrame); dragFrame = null; }
      if (ring) { try { ring.remove?.(); } catch { /* detached */ } ring = null; }
      drag = null;
    }

    function cancelDrag() {
      if (drag) dragCancelled = true;
      endDrag();
    }

    function onPointerDown(activeTool, pds, event) {
      if (!alive) return;
      endDrag();
      dragCancelled = false;
      if (activeTool?.type !== "selection" || state().viewModeEnabled || !doc.addEventListener) return;
      const el = pds?.hit?.element;
      const container = el && el.type === "text" && typeof el.containerId === "string" ? els().find((e) => e.id === el.containerId) : el;
      const mm = mmOf(container);
      if (!mm || !mm.uid || mm.root || mm.edge || mm.boundary || container.id !== nodeId(mm.map, mm.uid) || !trees.get(mm.map)) return;
      drag = { root: mm.map, uid: mm.uid, x0: event?.clientX ?? 0, y0: event?.clientY ?? 0, active: false, plan: null, tree: null, ev: null };
      const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); dragOffs.push(() => target.removeEventListener?.(type, fn, opts)); };
      on(doc, "pointermove", (e) => {
        if (!drag) return;
        drag.ev = e;
        if (dragFrame == null) dragFrame = raf(() => {
          dragFrame = null;
          try { updateRing(); } catch (error) { warn("ring", error); endDrag(); }
        });
      }, { passive: true });
      on(doc, "pointercancel", cancelDrag);
      on(doc, "keydown", (e) => { if (e.key === "Escape") cancelDrag(); }, true);
      if (doc.defaultView?.addEventListener) on(doc.defaultView, "blur", cancelDrag);
    }

    function hideRing() {
      if (ring) { try { ring.remove?.(); } catch { /* detached */ } ring = null; }
    }

    function updateRing() {
      const d = drag;
      if (!d || !d.ev || !alive) return;
      const e = d.ev;
      if (!d.active) {
        if (Math.abs((e.clientX ?? 0) - d.x0) < DRAG_START_PX && Math.abs((e.clientY ?? 0) - d.y0) < DRAG_START_PX) return;
        const ctx = planOf(d.root);
        if (!ctx) { endDrag(); return; }
        d.active = true;
        d.plan = ctx.plan;
        d.tree = ctx.tree;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) { hideRing(); return; }
      const point = pointOf(e, null);
      const res = point ? resolveDrop({ plan: d.plan, tree: d.tree, dragged: d.uid, point, layout: d.plan.dir }) : null;
      if (!res || !res.ring) { hideRing(); return; }
      const r = native.viewportRectOf(app, [res.ring.x, res.ring.y, res.ring.x + res.ring.width, res.ring.y + res.ring.height]);
      if (!r) { hideRing(); return; }
      if (!ring) {
        ring = doc.createElement("div");
        ring.style.pointerEvents = "none";
        ring.style.zIndex = String((zIndex ?? zIndexFor(outerEl)) + 1);
        doc.body.append(ring);
      }
      const bar = res.type === "reorder";
      ring.className = `plexus-portal plexus-mm-ring${bar ? " plexus-mm-ring-bar" : ""}`;
      ring.style.left = `${r.left - (bar && !r.width ? 1.5 : 0)}px`;
      ring.style.top = `${r.top - (bar && !r.height ? 1.5 : 0)}px`;
      ring.style.width = `${bar ? Math.max(3, r.width) : r.width}px`;
      ring.style.height = `${bar ? Math.max(3, r.height) : r.height}px`;
    }

    function pass(force = false) {
      scheduled = null;
      if (!alive) return;
      force = force === true || (deferredSince != null && now() - deferredSince > MAX_WAIT_MS);
      const st = state();
      const editingId = st.editingTextElement?.id ?? null;
      if (prevEditingId && !editingId) pendingFinished.add(prevEditingId);
      prevEditingId = editingId;
      const nonce = app.scene?.getSceneNonce?.();
      if (!pendingFinished.size && !pendingRefresh.size && !dirty && nonce !== undefined && nonce === lastNonce) { if (input) placeInput(); return; }
      if (!force && gestureActive()) { dirty = true; deferredSince ??= now(); if (input) placeInput(); return; }
      deferredSince = null;
      dirty = false;
      lastNonce = nonce;
      const finishedIds = [...pendingFinished];
      pendingFinished.clear();
      const refreshRoots = [...pendingRefresh];
      pendingRefresh.clear();
      try {
        for (const id of finishedIds) nativeTextEdit(id);
        handleDrop();
        nativeChanges();
      } catch (error) { warn("change pass", error); }
      for (const root of refreshRoots) if (trees.has(root)) refreshRoot(root);
      if (input) placeInput();
    }

    // rAF does not run in a hidden page, so a pending pass is run now and synchronously.
    function flush({ unloading = false } = {}) {
      if (!alive) return;
      if (unloading) { endDrag(); closeInput({ write: true }); }
      if (scheduled != null) { caf(scheduled); scheduled = null; }
      try { pass(true); } catch (error) { warn("flush", error); }
    }

    function nativeTextEdit(textId) {
      const txt = els().find((e) => e.id === textId);
      if (!txt || typeof txt.containerId !== "string" || !txt.containerId.startsWith("pmm-")) return;
      if (snapshot.get(txt.id) === txt.version) return;
      const container = els().find((e) => e.id === txt.containerId);
      const mm = mmOf(container);
      if (mm && Array.isArray(mm.edge) && mm.via && !labelToasted) { labelToasted = true; toast(LABEL_HINT); return; }
      if (mm && (mm.flow === "branch" || (mm.flow && typeof mm.flow === "object")) && container?.type === "arrow") {
        if (!flowLabelToasted) { flowLabelToasted = true; toast(FLOW_LABEL_HINT); }
        return;
      }
      if (!mm || !mm.uid) return;
      const tree = trees.get(mm.map);
      const found = tree ? findNode(tree, mm.uid) : null;
      if (!found) return;
      const node = found.node;
      const flow = isFlow(mm.map);
      const branch = flow && isBranch(tree, mm.uid);
      if (hasMarkup(flow ? flowParts(node.string, { branch }).body : taskParts(node.string).rest)) { toast(MARKUP_HINT); return; }
      const text = typeof txt.originalText === "string" ? txt.originalText : txt.text;
      if (text === "" || text === "·") return;
      const next = flow ? flowEditable(findNode(drawnTree(tree, { layout: FLOW_LAYOUT }), mm.uid)?.node ?? node, text, { branch }) : editableText(node, text, { star: starFor(mm.map, mm.uid) });
      if (next === null || next === undefined || next === node.string) return;
      writeString(mm.map, mm.uid, next, node.string);
    }

    // A branch head (its `Yes:` prefix is a label, not text): same source as planMap.
    function isBranch(tree, uid) {
      return !!tree && !!flowStructure(tree).byUid.get(uid)?.branchHead;
    }

    function starFor(root, uid) {
      return uid === root && CAUSE_LAYOUTS.includes(mmOf(rootElement(root))?.layout);
    }

    function nativeChanges() {
      const live = els();
      const liveById = new Map(live.map((e) => [e.id, e]));
      let restored = false;
      for (const root of trees.keys()) {
        const tree = trees.get(root);
        if (!tree) continue;
        for (const v of visibleNodes(tree)) {
          const el = liveById.get(nodeId(root, v.node.uid));
          if (el && el.isDeleted && snapshot.get(el.id) !== el.version) restored = true;
        }
      }
      if (restored && !deleteToasted) { deleteToasted = true; toast(FOLLOW_HINT); }
      const pinPatch = new Map();
      for (const root of trees.keys()) {
        const tree = trees.get(root);
        if (!tree || isFlow(root)) continue;
        const plan = planMap({ elements: live, tree, sizes: sizer, textOf, ...mapOpts(root) });
        // A root-only drag shifts every planned position; unmoved children then sit at plan - delta.
        const rootEl = plan.info.get(root)?.el;
        const was = lastRoot.get(root);
        const dx = rootEl && was ? rootEl.x - was.x : 0;
        const dy = rootEl && was ? rootEl.y - was.y : 0;
        for (const v of plan.nodes) {
          if (v.depth === 0) continue;
          const info = plan.info.get(v.node.uid);
          const pos = plan.positions[v.node.uid];
          if (!info.el || info.el.isDeleted || (info.mm && info.mm.pinned === true) || !pos) continue;
          const off = (ox, oy) => Math.abs(info.el.x - (pos.x - ox)) > 2 || Math.abs(info.el.y - (pos.y - oy)) > 2;
          if (off(0, 0) && off(dx, dy)) pinPatch.set(info.el.id, true);
        }
      }
      const roots = [...trees.keys()].filter((r) => trees.get(r));
      const wasCommitted = commit(pinPatch.size ? (list) => list.map((el) => (pinPatch.has(el.id) ? patchMarker(el, { pinned: true }) : el)) : null, roots);
      if (!wasCommitted) recordRoots();
    }

    // ---- outline writes ----

    function writeString(root, uid, value, base) {
      const tree = trees.get(root);
      const found = tree ? findNode(tree, uid) : null;
      if (found) { found.node.string = value; commit(null, [root]); }
      writer.updateString(root, uid, value, base).then((result) => {
        if (result && result.ok === false) {
          if (result.reason === "changed") toast(CHANGED_ELSEWHERE, { kind: "error" });
          refreshRoot(root);
        }
      }).catch((error) => { warn("write", error); failToast(); refreshRoot(root); });
    }

    function newNode(root, anchorUid, kind) {
      const tree = trees.get(root);
      const found = tree ? findNode(tree, anchorUid) : null;
      if (!found) return;
      const uid = api.util.generateUID();
      const node = { uid, string: PLACEHOLDER_CHILD, open: true, children: [] };
      createdAt.set(uid, now());
      let job;
      if (kind === "sibling" && found.parent) {
        const at = found.parent.children.indexOf(found.node);
        found.parent.children.splice(at + 1, 0, node);
        job = writer.createSiblingAfter(root, anchorUid, { uid, string: PLACEHOLDER_CHILD });
      } else {
        found.node.open = true;
        found.node.children.push(node);
        job = writer.createChild(root, anchorUid, { uid, string: PLACEHOLDER_CHILD });
      }
      commit(null, [root]);
      select(root, uid);
      openInput({ root, uid, base: PLACEHOLDER_CHILD, placeholder: PLACEHOLDER_CHILD });
      Promise.resolve(job).catch((error) => {
        warn("create", error);
        closeInput({ write: false });
        failToast();
        refreshRoot(root);
      });
    }

    // ---- inline input ----

    function inputRect() {
      const el = els().find((e) => e.id === nodeId(input.rootUid, input.uid));
      if (!el) return null;
      return native.viewportRectOf(app, [el.x, el.y, el.x + el.width, el.y + el.height]);
    }

    function placeInput() {
      if (!input) return;
      const r = inputRect();
      if (!r) return;
      const st = state();
      const zoom = st.zoom?.value || 1;
      const s = input.el.style;
      s.left = `${r.left}px`;
      s.top = `${r.top}px`;
      s.width = `${Math.max(r.width, 80 * zoom)}px`;
      s.height = `${r.height}px`;
      const txt = els().find((e) => e.id === textId(input.rootUid, input.uid));
      s.fontSize = `${(txt && Number.isFinite(txt.fontSize) ? txt.fontSize : 16) * zoom}px`;
    }

    function openInput({ root, uid, base, placeholder = null, prefix = "", suffix = "" }) {
      closeInput({ write: true });
      const el = doc.createElement("input");
      el.type = "text";
      el.className = "plexus-portal plexus-mm-input";
      el.value = base.slice(prefix.length, base.length - suffix.length);
      el.style.zIndex = String((zIndex ?? zIndexFor(outerEl)) + 2);
      const handle = { el, rootUid: root, uid, base, prefix, suffix, placeholder, composing: false, listeners: [], done: false };
      const on = (type, fn) => { el.addEventListener(type, fn); handle.listeners.push([type, fn]); };
      on("keydown", (e) => {
        e.stopPropagation();
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === "Enter") { e.preventDefault(); commitInput(); }
        else if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); const target = { root: handle.rootUid, uid: handle.uid }; commitInput(); newNode(target.root, target.uid, "child"); }
        else if (e.key === "Escape") { e.preventDefault(); cancelInput(); }
      });
      for (const type of INPUT_ISOLATED) on(type, (e) => e.stopPropagation());
      on("blur", () => commitInput());
      input = handle;
      doc.body.append(el);
      placeInput();
      el.focus?.();
      el.select?.();
    }

    function removeInput(handle) {
      handle.done = true;
      for (const [type, fn] of handle.listeners.splice(0)) handle.el.removeEventListener?.(type, fn);
      handle.el.remove?.();
      if (input === handle) input = null;
    }

    function closeInput({ write }) {
      const handle = input;
      if (!handle) return;
      const value = handle.el.value;
      removeInput(handle);
      if (write) finishInput(handle, value);
    }

    function finishInput(handle, value) {
      const { rootUid, uid, base, placeholder, prefix, suffix } = handle;
      if (value === "") { if (placeholder) discard(rootUid, uid, placeholder); return; }
      const next = prefix + value + suffix;
      if (next === base) return;
      writeString(rootUid, uid, next, base);
    }

    function discard(root, uid, placeholder) {
      const tree = trees.get(root);
      const found = tree ? findNode(tree, uid) : null;
      if (found?.parent) {
        const at = found.parent.children.indexOf(found.node);
        const anchor = at > 0 ? found.parent.children[at - 1] : found.parent;
        found.parent.children = found.parent.children.filter((c) => c.uid !== uid);
        commit(null, [root]);
        if (selectedId(root, uid)) select(root, anchor.uid);
      }
      writer.discardPlaceholder(root, uid, placeholder).then(() => refreshRoot(root)).catch((error) => { warn("discard", error); refreshRoot(root); });
    }

    function commitInput() {
      if (!input) return;
      closeInput({ write: true });
      refocus();
    }

    function cancelInput() {
      const handle = input;
      if (!handle) return;
      removeInput(handle);
      if (handle.placeholder) discard(handle.rootUid, handle.uid, handle.placeholder);
      refocus();
    }

    // ---- hotkeys ----

    function onKeyDown(e) {
      if (!alive || e.isComposing || e.keyCode === 229 || e.target !== containerEl || input) return;
      const st = state();
      if (st.editingTextElement) return;
      if (st.openDialog || st.openMenu || st.openPopup || st.contextMenu) return;
      const sel = selectedNode();
      if (!sel) return;
      const swallow = () => { e.preventDefault(); e.stopImmediatePropagation(); };
      if (e.metaKey || e.ctrlKey) {
        if (e.altKey) {
          if (e.key in ARROWS && !e.shiftKey) { swallow(); if (!e.repeat) moveSelection(sel, ARROWS[e.key], { center: true }); }
          return;
        }
        if (e.key in ARROWS) { swallow(); toast(GROW_HINT); }
        else if (e.code === "KeyZ") { swallow(); toast("Undo mind-map edits in the outline"); }
        return;
      }
      const alt = e.altKey && !e.shiftKey;
      const plain = !e.altKey && !e.shiftKey;
      let action = null;
      let repeatSafe = true;
      if (e.shiftKey && !e.altKey && e.key === "Tab") { swallow(); if (!e.repeat) selectParent(sel); return; }
      if (e.altKey && e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        swallow();
        if (!e.repeat && !st.viewModeEnabled) { try { reorderSelected(sel, e.key === "ArrowUp" ? -1 : 1); } catch (error) { warn("hotkey", error); } }
        return;
      }
      if (plain && e.key === "Tab") { action = () => newNode(sel.root, sel.uid, "child"); repeatSafe = false; }
      else if (plain && e.key === "Enter") { action = () => newNode(sel.root, sel.uid, sel.isRoot ? "child" : "sibling"); repeatSafe = false; }
      else if (plain && e.key === "F2") action = () => editSelected(sel);
      else if (alt && e.key in ARROWS) { swallow(); moveSelection(sel, ARROWS[e.key]); return; }
      else if (alt && e.key === "Enter") { action = () => toggleTask(sel); repeatSafe = false; }
      else if (plain && (e.key === "Backspace" || e.key === "Delete") && placeholderDeletable(sel)) { action = () => discard(sel.root, sel.uid, PLACEHOLDER_CHILD); repeatSafe = false; }
      else if (alt && e.key === "Backspace") { action = () => deleteBranch(sel); repeatSafe = false; }
      else if (alt && LETTERS.has(e.code)) {
        const letter = e.code.slice(3);
        action = () => letterAction(letter, sel);
        repeatSafe = letter !== "V";
      }
      if (!action) return;
      swallow();
      if (e.repeat && !repeatSafe) return;
      if (e.altKey && e.key !== "Backspace") pendingDelete = null;
      else if (!(e.key === "Backspace")) pendingDelete = null;
      if (st.viewModeEnabled) return;
      try {
        const out = action();
        if (out && typeof out.catch === "function") out.catch((error) => { warn("hotkey", error); failToast(); });
      } catch (error) { warn("hotkey", error); }
    }

    function editSelected(sel) {
      const node = findNode(trees.get(sel.root), sel.uid)?.node;
      if (!node) return;
      if (isFlow(sel.root)) {
        const parts = flowParts(node.string, { branch: isBranch(trees.get(sel.root), sel.uid) });
        if (hasMarkup(parts.body)) { toast(MARKUP_HINT); return; }
        const suffix = parts.suffix || "";
        const prefix = node.string.slice(0, node.string.length - parts.body.length - suffix.length);
        if (prefix + parts.body + suffix !== node.string) { toast(MARKUP_HINT); return; }
        openInput({ root: sel.root, uid: sel.uid, base: node.string, prefix, suffix });
        return;
      }
      const parts = taskParts(node.string);
      if (hasMarkup(parts.rest)) { toast(MARKUP_HINT); return; }
      openInput({ root: sel.root, uid: sel.uid, base: node.string, prefix: parts.prefix });
    }

    // Alt+Enter: only the macro changes, TODO <-> DONE; a plain node gains a TODO prefix.
    function toggleTask(sel) {
      const node = findNode(trees.get(sel.root), sel.uid)?.node;
      if (!node) return null;
      const state = taskParts(node.string).state;
      const next = state === null ? `{{[[TODO]]}} ${node.string}` : `{{[[${state === "TODO" ? "DONE" : "TODO"}]]}}${node.string.slice(TASK_MACRO_LEN)}`;
      writeString(sel.root, sel.uid, next, node.string);
      return null;
    }

    // ---- MM-2 ----

    function drawnNodes(root) {
      const tree = trees.get(root);
      if (!tree) return [];
      const mm = mmOf(rootElement(root));
      return visibleNodes(drawnTree(tree, { layout: mm?.layout || "right", attrEdges: mm?.attrEdges === true }));
    }

    function reorderSelected(sel, dir) {
      if (sel.isRoot) return null;
      const list = drawnNodes(sel.root);
      const v = list.find((x) => x.node.uid === sel.uid);
      if (!v || !v.parent) return null;
      const via = v.node.via ?? null;
      const sibs = list.filter((x) => x.parent && x.parent.uid === v.parent.uid && (x.node.via ?? null) === via).map((x) => x.node.uid);
      const i = sibs.indexOf(sel.uid);
      const parentUid = via ?? v.parent.uid;
      if (dir < 0 && i > 0) moveNode(sel.root, sel.uid, { parentUid, beforeUid: sibs[i - 1] });
      else if (dir > 0 && i !== -1 && i < sibs.length - 1) moveNode(sel.root, sel.uid, { parentUid, afterUid: sibs[i + 1] });
      return null;
    }

    function selectParent(sel) {
      const list = drawnNodes(sel.root);
      const v = list.find((x) => x.node.uid === sel.uid);
      if (!v || !v.parent) return;
      if (!isFlow(sel.root)) { select(sel.root, v.parent.uid); return; }
      // Primary predecessor: the decision for a branch head, else the tail of the previous sibling's continuation, or the parent for a first child.
      const pred = flowStructure(trees.get(sel.root)).byUid.get(sel.uid)?.pred;
      if (pred) { select(sel.root, pred); return; }
      const kids = new Map();
      for (const x of list) if (x.parent) kids.set(x.parent.uid, [...(kids.get(x.parent.uid) || []), x.node]);
      const tail = (node) => { const k = kids.get(node.uid); return k && k.length ? tail(k[k.length - 1]) : node; };
      const sibs = kids.get(v.parent.uid) || [];
      const i = sibs.findIndex((n) => n.uid === sel.uid);
      select(sel.root, i > 0 ? tail(sibs[i - 1]).uid : v.parent.uid);
    }

    function placeholderDeletable(sel) {
      if (sel.isRoot) return false;
      const node = findNode(trees.get(sel.root), sel.uid)?.node;
      const at = createdAt.get(sel.uid);
      return !!node && at !== undefined && now() - at <= PLACEHOLDER_WINDOW_MS && node.string === PLACEHOLDER_CHILD && node.children.length === 0;
    }

    function moveSelection(sel, dir, { center = false } = {}) {
      const tree = trees.get(sel.root);
      const rects = [];
      for (const v of visibleNodes(tree)) {
        const el = els().find((e) => e.id === nodeId(sel.root, v.node.uid));
        if (el && !el.isDeleted) rects.push({ id: v.node.uid, x: el.x, y: el.y, width: el.width, height: el.height });
      }
      const from = rects.find((r) => r.id === sel.uid);
      if (!from) return;
      const target = nearestInDirection(from, rects, dir);
      if (!target) return;
      const to = rects.find((r) => r.id === target);
      select(sel.root, target);
      const st = state();
      const zoom = st.zoom?.value || 1;
      const vr = native.viewportRectOf(app, [to.x, to.y, to.x + to.width, to.y + to.height]);
      const left = st.offsetLeft || 0;
      const top = st.offsetTop || 0;
      const off = vr.left < left || vr.top < top || vr.left + vr.width > left + (st.width || 0) || vr.top + vr.height > top + (st.height || 0);
      if (off || center) {
        app.updateScene({ appState: { scrollX: (st.width || 0) / (2 * zoom) - (to.x + to.width / 2), scrollY: (st.height || 0) / (2 * zoom) - (to.y + to.height / 2) }, captureUpdate: "NEVER" });
      }
    }

    function letterAction(letter, sel) {
      if (letter === "F") return toggleFold(sel);
      if (letter === "L") return cycleLayout(sel);
      if (letter === "P") return togglePin(sel);
      if (letter === "B") return toggleBoundary(sel);
      if (letter === "X" || letter === "C") return copyOrCut(letter === "X" ? "cut" : "copy", sel);
      return paste(sel);
    }

    function toggleFold(sel) {
      const node = findNode(trees.get(sel.root), sel.uid)?.node;
      if (!node) return null;
      if (!node.children.length) { toast("No children to fold"); return null; }
      const open = node.open === false;
      node.open = open;
      commit(null, [sel.root], { force: true });
      return writer.setOpen(sel.root, sel.uid, open).catch((error) => { warn("fold", error); failToast(); refreshRoot(sel.root); });
    }

    function rootElement(root) { return els().find((e) => e.id === nodeId(root, root)); }

    function cycleLayout(sel) {
      const rootEl = rootElement(sel.root);
      if (!rootEl) return null;
      const cur = mmOf(rootEl)?.layout || "right";
      if (cur === FLOW_LAYOUT) { toast(FLOW_LAYOUT_HINT); return null; }
      const next = LAYOUTS[(LAYOUTS.indexOf(cur) + 1) % LAYOUTS.length];
      commit((list) => list.map((e) => (e.id === rootEl.id ? patchMarker(e, { layout: next }) : e)), [sel.root]);
      toast(`Layout: ${next}`);
      return null;
    }

    function mapOptions() {
      const sel = selectedNode();
      const rootEl = sel ? rootElement(sel.root) : null;
      if (!sel || !rootEl) return null;
      const mm = mmOf(rootEl) || {};
      return { root: sel.root, layout: mm.layout || "right", attrEdges: mm.attrEdges === true };
    }

    function setLayout(layout) {
      const sel = selectedNode();
      const rootEl = sel ? rootElement(sel.root) : null;
      if (!rootEl || ![...LAYOUTS, ...CAUSE_LAYOUTS, FLOW_LAYOUT].includes(layout)) return false;
      const done = commit((list) => list.map((e) => (e.id === rootEl.id ? patchMarker(e, { layout }) : e)), [sel.root]);
      if (done) toast(`Layout: ${layout} (${CHANGE_BACK})`);
      return done;
    }

    function setAttrEdges(on) {
      const sel = selectedNode();
      const rootEl = sel ? rootElement(sel.root) : null;
      if (!rootEl) return false;
      if (mmOf(rootEl)?.layout === FLOW_LAYOUT) { toast(FLOW_ATTR_HINT); return false; }
      const done = commit((list) => list.map((e) => (e.id === rootEl.id ? patchMarker(e, { attrEdges: on ? true : undefined }) : e)), [sel.root]);
      if (done) toast(`Attribute blocks as edges: ${on ? "on" : "off"} (${CHANGE_BACK})`);
      return done;
    }

    function togglePin(sel) {
      if (sel.isRoot) return null;
      if (isFlow(sel.root)) { toast(FLOW_STEPS_HINT); return null; }
      const pinned = mmOf(sel.el)?.pinned === true;
      commit((list) => list.map((e) => (e.id === sel.el.id ? patchMarker(e, { pinned: pinned ? undefined : true }) : e)), [sel.root]);
      return null;
    }

    function toggleBoundary(sel) {
      const rootEl = rootElement(sel.root);
      if (!rootEl) return null;
      const bounds = new Set(mmOf(rootEl)?.bounds || []);
      if (bounds.has(sel.uid)) bounds.delete(sel.uid); else bounds.add(sel.uid);
      commit((list) => list.map((e) => (e.id === rootEl.id ? patchMarker(e, { bounds: [...bounds] }) : e)), [sel.root]);
      return null;
    }

    function copyOrCut(mode, sel) {
      if (mode === "cut" && sel.isRoot) { toast("The root cannot be cut"); return null; }
      clip = { mode, uid: sel.uid, root: sel.root };
      toast(mode === "cut" ? "Branch cut" : "Branch copied");
      return null;
    }

    async function paste(sel) {
      if (!clip) { toast("Cut or copy a branch first"); return null; }
      const source = clip;
      const opts = source.root !== sel.root ? { targetRootUid: sel.root } : {};
      const result = source.mode === "cut"
        ? await writer.moveBranch(source.root, source.uid, sel.uid, opts)
        : await writer.copyBranch(source.root, source.uid, sel.uid, opts);
      if (!result || result.ok === false) {
        const reason = result?.reason;
        if (reason === "inside-source") toast("Cannot paste a branch into itself");
        else if (reason === "too-large") toast(`That branch is too large to copy (${result.count} blocks)`);
        else if (reason === "excluded") toast("Drawings cannot be copied here");
        else toast(WRITE_FAILED, { kind: "error" });
      } else {
        if (source.mode === "cut") clip = null;
        if (result.skipped) toast(`Skipped ${result.skipped} drawing block${result.skipped === 1 ? "" : "s"}`);
      }
      refreshRoot(sel.root);
      if (source.root !== sel.root && trees.has(source.root)) refreshRoot(source.root);
      return null;
    }

    function branchCheck(uid) {
      const raw = writer.pullTree(uid);
      if (!raw) return null;
      const uids = new Set();
      let excluded = false;
      rawWalk(raw, (n) => { uids.add(n[":block/uid"]); if (isExcludedString(n[":block/string"] ?? "")) excluded = true; });
      let referenced = false;
      for (const id of uids) {
        const r = api.data.pull("[:block/uid {:block/_refs [:block/uid]}]", [":block/uid", id]);
        if ((r?.[":block/_refs"] || []).some((x) => !uids.has(x[":block/uid"]))) { referenced = true; break; }
      }
      return { count: uids.size, excluded, referenced, string: raw[":block/string"] ?? "" };
    }

    async function deleteBranch(sel) {
      const t = now();
      const armed = pendingDelete && pendingDelete.uid === sel.uid && t - pendingDelete.at <= DELETE_WINDOW_MS ? pendingDelete : null;
      if (sel.isRoot) {
        if (!armed) {
          pendingDelete = { uid: sel.uid, at: t };
          toast("Press Alt+Backspace again to detach this mind map (the outline stays)");
          return;
        }
        pendingDelete = null;
        detach(sel.root, { force: true });
        return;
      }
      const info = branchCheck(sel.uid);
      if (!info) { refreshRoot(sel.root); return; }
      if (!armed) {
        if (info.excluded) { toast("This branch contains drawings; delete it in the outline", { kind: "error" }); return; }
        if (info.referenced) { toast("A block in this branch is referenced elsewhere; delete it in the outline", { kind: "error" }); return; }
        pendingDelete = { uid: sel.uid, at: t, count: info.count, string: info.string };
        toast(`Press Alt+Backspace again to delete ${info.count} block${info.count === 1 ? "" : "s"}`);
        return;
      }
      pendingDelete = null;
      if (armed.count !== info.count || armed.string !== info.string) { toast("The branch changed; press Alt+Backspace again", { kind: "error" }); return; }
      const result = await writer.deleteBranch(sel.root, sel.uid, { count: armed.count, string: armed.string });
      if (!result || result.ok === false) toast(WRITE_FAILED, { kind: "error" });
      else forceMarks.set(sel.root, now() + FORCE_MARK_MS);
      refreshRoot(sel.root);
    }

    // ---- entry points (per editor) ----

    function startRoot({ drawingUid }) {
      const root = api.util.generateUID();
      const st = state();
      const zoom = st.zoom?.value || 1;
      const cx = (st.width || 0) / (2 * zoom) - (st.scrollX || 0);
      const cy = (st.height || 0) / (2 * zoom) - (st.scrollY || 0);
      rootPos.set(root, { x: cx - 70, y: cy - 24 });
      rootDefaults.set(root, { attrEdges: true });
      trees.set(root, { uid: root, string: PLACEHOLDER_ROOT, open: true, children: [] });
      const job = writer.createChild(root, drawingUid, { uid: root, string: PLACEHOLDER_ROOT, unfold: false });
      ensureRoot(root);
      commit(null, [root]);
      select(root, root);
      openInput({ root, uid: root, base: PLACEHOLDER_ROOT, placeholder: PLACEHOLDER_ROOT });
      Promise.resolve(job).catch((error) => {
        warn("start", error);
        closeInput({ write: false });
        detach(root);
        failToast();
      });
      return root;
    }

    function showOutline(root) {
      rootPos.set(root, { x: 0, y: 0 });
      rootDefaults.set(root, { attrEdges: true });
      trees.set(root, null);
      ensureRoot(root);
      refreshRoot(root);
      if (!trees.get(root)) return false;
      if (drawnNodes(root).some((v) => v.node.via)) toast(ATTR_HINT);
      select(root, root);
      const rect = els().filter((e) => !e.isDeleted && e.id.startsWith(`pmm-${root}-`) && !e.containerId);
      if (rect.length) {
        const box = [Math.min(...rect.map((e) => e.x)), Math.min(...rect.map((e) => e.y)), Math.max(...rect.map((e) => e.x + e.width)), Math.max(...rect.map((e) => e.y + e.height))];
        native.zoomTo(app, box);
      }
      return true;
    }

    // ---- wiring ----

    const listen = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      offs.push(() => target.removeEventListener(type, fn, opts));
    };
    listen(containerEl, "keydown", onKeyDown, true);
    for (const name of ["onChangeEmitter", "onScrollChangeEmitter"]) {
      try {
        const off = app[name]?.on?.(() => onChange());
        if (typeof off === "function") offs.push(off);
      } catch (error) { warn("subscribe", error); }
    }
    try {
      const off = app.onPointerUpEmitter?.on?.(onPointerUp);
      if (typeof off === "function") offs.push(off);
    } catch (error) { warn("subscribe", error); }
    try {
      const off = app.onPointerDownEmitter?.on?.(onPointerDown);
      if (typeof off === "function") offs.push(off);
    } catch (error) { warn("subscribe", error); }
    const view = doc.defaultView;
    if (view?.addEventListener) listen(view, "pagehide", () => flush({ unloading: true }));
    if (doc.addEventListener) listen(doc, "visibilitychange", () => { if (doc.visibilityState === "hidden") flush(); });
    start();

    return {
      app,
      selectedNode,
      startRoot,
      showOutline,
      mapOptions,
      setLayout,
      setAttrEdges,
      flush,
      dispose() {
        flush();
        alive = false;
        if (loadedTimer != null) caf(loadedTimer);
        if (scheduled != null) caf(scheduled);
        loadedTimer = null;
        scheduled = null;
        if (input) removeInput(input);
        endDrag();
        pendingDrop = null;
        for (const off of offs.splice(0)) { try { off(); } catch (error) { warn("cleanup", error); } }
        for (const off of watches.values()) { try { off(); } catch (error) { warn("cleanup", error); } }
        watches.clear();
        trees.clear();
        clip = null;
        pendingDelete = null;
        createdAt.clear();
        rootDefaults.clear();
        measurer.clear?.();
      },
    };
  }

  const sessionFor = (app) => sessions.get(app) || null;

  async function waitForSession(app, ms = 2000) {
    const end = now() + ms;
    for (;;) {
      const s = sessionFor(app);
      if (s || disposed || now() >= end) return s;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  function outlineInfo(blockUid) {
    const raw = writer.pullTree(blockUid);
    if (!raw) return null;
    const full = treeFromPull(raw);
    return { string: raw[":block/string"] ?? "", visible: full ? visibleNodes(full).length : 0, total: full ? countHidden(full) + 1 : 0 };
  }

  return {
    mount,
    selectedNode: (app) => sessionFor(app)?.selectedNode() ?? null,
    startRoot: ({ app, drawingUid }) => sessionFor(app)?.startRoot({ drawingUid }) ?? null,
    async showOutline({ app, rootUid }) {
      const s = await waitForSession(app);
      return s ? s.showOutline(rootUid) : false;
    },
    mapOptions: (app) => sessionFor(app)?.mapOptions() ?? null,
    setLayout: (app, layout) => sessionFor(app)?.setLayout(layout) ?? false,
    setAttrEdges: (app, on) => sessionFor(app)?.setAttrEdges(on) ?? false,
    outlineInfo,
    NODE_CAP,
    hasSession: (app) => sessions.has(app),
    dispose() {
      disposed = true;
      for (const s of [...sessions.values()]) s.dispose();
      sessions.clear();
    },
  };
}
