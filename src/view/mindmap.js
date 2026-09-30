import { LAYOUTS, allUids, isExcludedString, plainText, hasMarkup, treeFromPull, visibleNodes, countHidden, nearestInDirection, isFolded } from "../model/mindmap.js";
import { applyOps, boundaryId, bump, edgeId, isEmptyOps, makeSizer, mmOf, nodeId, patchMarker, planMap, projectionIds, reconcile, textId } from "../model/mmsync.js";

const NODE_CAP = 500;
const DELETE_WINDOW_MS = 3000;
const LOAD_WAIT_MS = 5000;
const MAX_WAIT_MS = 4000;
const FORCE_MARK_MS = 5000;
const PLACEHOLDER_CHILD = "New idea";
const PLACEHOLDER_ROOT = "Central idea";
const GROW_HINT = "Use Tab / Enter to grow this map";
const FOLLOW_HINT = "Mind-map nodes follow the outline; Alt+Backspace deletes a branch";
const MARKUP_HINT = "Edit this node in the outline (it has links or formatting)";
const WRITE_FAILED = "Could not update the outline";
const CHANGED_ELSEWHERE = "Block changed elsewhere; not overwritten";
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
export function createMindMap({ doc, api = globalThis.roamAlphaAPI, writer, measurer, native, toaster, raf = defaultRaf, caf = defaultCaf, now = () => Date.now(), zIndexFor = () => 1000, guardedWrite = defaultGuardedWrite }) {
  const sessions = new Map();
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
      for (const root of roots) {
        const tree = trees.get(root);
        if (!tree) continue;
        const ops = reconcile({ elements: next, tree, sizes: sizer, textOf, rootPos: rootPos.get(root) });
        if (!isEmptyOps(ops)) { next = applyOps(next, ops); changed = true; }
        staged.push(tree);
      }
      if (!changed) return false;
      const marked = roots.some((r) => (forceMarks.get(r) ?? 0) > now());
      const written = guardedWrite(app, { drawingUid, next, label: "Mind map", captureUpdate: "NEVER", force: force || marked, onApplyAnyway: () => commit(mutate, roots, { force: true }) });
      if (!written) return false;
      for (const root of roots) forceMarks.delete(root);
      takeSnapshot();
      afterApply(roots);
      return true;
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

    function onPointerUp() { dirty = true; onChange(); }

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
        nativeChanges();
      } catch (error) { warn("change pass", error); }
      for (const root of refreshRoots) if (trees.has(root)) refreshRoot(root);
      if (input) placeInput();
    }

    // rAF does not run in a hidden page, so a pending pass is run now and synchronously.
    function flush({ unloading = false } = {}) {
      if (!alive) return;
      if (unloading) closeInput({ write: true });
      if (scheduled != null) { caf(scheduled); scheduled = null; }
      try { pass(true); } catch (error) { warn("flush", error); }
    }

    function nativeTextEdit(textId) {
      const txt = els().find((e) => e.id === textId);
      if (!txt || typeof txt.containerId !== "string" || !txt.containerId.startsWith("pmm-")) return;
      if (snapshot.get(txt.id) === txt.version) return;
      const container = els().find((e) => e.id === txt.containerId);
      const mm = mmOf(container);
      if (!mm || !mm.uid) return;
      const tree = trees.get(mm.map);
      const found = tree ? findNode(tree, mm.uid) : null;
      if (!found) return;
      const node = found.node;
      if (hasMarkup(node.string)) { toast(MARKUP_HINT); return; }
      let text = typeof txt.originalText === "string" ? txt.originalText : txt.text;
      if (isFolded(node)) {
        const suffix = ` (+${countHidden(node)})`;
        if (!text.endsWith(suffix)) return;
        text = text.slice(0, -suffix.length);
      }
      if (text === "" || text === "·" || text === node.string) return;
      writeString(mm.map, mm.uid, text, node.string);
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
        if (!tree) continue;
        const plan = planMap({ elements: live, tree, sizes: sizer, textOf });
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

    function openInput({ root, uid, base, placeholder = null }) {
      closeInput({ write: true });
      const el = doc.createElement("input");
      el.type = "text";
      el.className = "plexus-portal plexus-mm-input";
      el.value = base;
      el.style.zIndex = String((zIndex ?? zIndexFor(outerEl)) + 2);
      const handle = { el, rootUid: root, uid, base, placeholder, composing: false, listeners: [], done: false };
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
      const { rootUid, uid, base, placeholder } = handle;
      if (value === "") { if (placeholder) discard(rootUid, uid, placeholder); return; }
      if (value === base) return;
      writeString(rootUid, uid, value, base);
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
        if (e.altKey) return;
        if (e.key in ARROWS) { swallow(); toast(GROW_HINT); }
        else if (e.code === "KeyZ") { swallow(); toast("Undo mind-map edits in the outline"); }
        return;
      }
      const alt = e.altKey && !e.shiftKey;
      const plain = !e.altKey && !e.shiftKey;
      let action = null;
      let repeatSafe = true;
      if (plain && e.key === "Tab") { action = () => newNode(sel.root, sel.uid, "child"); repeatSafe = false; }
      else if (plain && e.key === "Enter") { action = () => newNode(sel.root, sel.uid, sel.isRoot ? "child" : "sibling"); repeatSafe = false; }
      else if (plain && e.key === "F2") action = () => editSelected(sel);
      else if (alt && e.key in ARROWS) { swallow(); moveSelection(sel, ARROWS[e.key]); return; }
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
      if (hasMarkup(node.string)) { toast(MARKUP_HINT); return; }
      openInput({ root: sel.root, uid: sel.uid, base: node.string });
    }

    function moveSelection(sel, dir) {
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
      if (off) {
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
      const next = LAYOUTS[(LAYOUTS.indexOf(cur) + 1) % LAYOUTS.length];
      commit((list) => list.map((e) => (e.id === rootEl.id ? patchMarker(e, { layout: next }) : e)), [sel.root]);
      toast(`Layout: ${next}`);
      return null;
    }

    function togglePin(sel) {
      if (sel.isRoot) return null;
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
      trees.set(root, null);
      ensureRoot(root);
      refreshRoot(root);
      if (!trees.get(root)) return false;
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
    const view = doc.defaultView;
    if (view?.addEventListener) listen(view, "pagehide", () => flush({ unloading: true }));
    if (doc.addEventListener) listen(doc, "visibilitychange", () => { if (doc.visibilityState === "hidden") flush(); });
    start();

    return {
      app,
      selectedNode,
      startRoot,
      showOutline,
      flush,
      dispose() {
        flush();
        alive = false;
        if (loadedTimer != null) caf(loadedTimer);
        if (scheduled != null) caf(scheduled);
        loadedTimer = null;
        scheduled = null;
        if (input) removeInput(input);
        for (const off of offs.splice(0)) { try { off(); } catch (error) { warn("cleanup", error); } }
        for (const off of watches.values()) { try { off(); } catch (error) { warn("cleanup", error); } }
        watches.clear();
        trees.clear();
        clip = null;
        pendingDelete = null;
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
