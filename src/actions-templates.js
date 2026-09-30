import { withLock, lockName } from "./host/locks.js";
import { plainText } from "./model/mindmap.js";
import { commonBounds, liveElements, viewportToScene } from "./model/scene.js";
import { STARTERS, buildStarter, pickCurrentItem, remapForInsert, selectionToTemplate, withTemplateFrames } from "./model/templates.js";
import { openNamePrompt } from "./view/name-prompt.js";
import { openTemplatePicker } from "./view/template-picker.js";

export const TEMPLATES_PAGE = "Plexus/Templates";
export const TEMPLATE_CAP = 50;
export const NAME_MAX = 60;

const DRAWING_RE = /^\s*\{\{(?:\[\[excalidraw\]\]|excalidraw)\}\}/;
const CLOSE_WAIT_MS = 3000;
const VERIFY_POLL_MS = 40;
const VERIFY_TIMEOUT_MS = 8000;
const LOADING_MS = 5000;

const liveCount = (els) => (Array.isArray(els) ? els.reduce((n, e) => n + (e && !e.isDeleted ? 1 : 0), 0) : 0);
const cleanName = (text) => String(text ?? "").replace(/\[\[|\]\]|#/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX).trim();
const blobToDataURL = (blob) => new Promise((resolve, reject) => {
  const reader = new globalThis.FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error("[plexus] could not read the image"));
  reader.readAsDataURL(blob);
});
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

class Stop extends Error {}

// Insert template / New drawing from template / Save selection as template (P13 AUTH-10).
// host: Roam host; native: Excalidraw host helpers; guardedWrite(app, opts) and beforeBulk(app, uid, label) come from the
// write guard; openDrawing / newDrawing / thumbnail are the createActions methods. Everything else is a test seam.
export function createTemplateActions({
  doc,
  host,
  native,
  api = globalThis.roamAlphaAPI,
  toaster,
  guardedWrite,
  beforeBulk = () => {},
  measure = null,
  openDrawing,
  newDrawing,
  thumbnail = null,
  openPicker = openTemplatePicker,
  openPrompt = openNamePrompt,
  withLockFn = withLock,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  zIndexFor = null,
  toDataURL = blobToDataURL,
  closeEditor: closeEditorOverride = null,
} = {}) {
  let disposed = false;
  let saving = false;
  let picker = null;
  let prompt = null;

  const toast = (message, opts) => { try { toaster?.show?.(message, opts); } catch { /* ignore */ } };
  const fail = (message) => toast(message, { kind: "error" });
  const stopped = () => disposed;

  const zIndex = (editor) => {
    try {
      if (typeof zIndexFor === "function") return zIndexFor(editor);
      if (!editor) return 1000;
      const z = parseInt(doc.defaultView?.getComputedStyle?.(editor.outer)?.zIndex, 10);
      return Number.isFinite(z) ? z + 2 : 1000;
    } catch { return 1000; }
  };

  const refocus = (editor) => {
    try { if (editor && native.activeEditor(doc)?.app === editor.app) editor.el?.focus?.({ preventScroll: true }); } catch { /* ignore */ }
  };

  function viewCentre(app) {
    const st = app.state || {};
    return viewportToScene({ x: (st.offsetLeft || 0) + (st.width || 0) / 2, y: (st.offsetTop || 0) + (st.height || 0) / 2, appState: st });
  }
  const sceneLive = (app) => liveCount(app.getSceneElements?.() ?? app.getSceneElementsIncludingDeleted?.() ?? []);

  // ---- user templates on Plexus/Templates ----

  function templateRows() {
    let pageUid = null;
    try { pageUid = host.pageUidByTitle?.(TEMPLATES_PAGE) ?? null; } catch { pageUid = null; }
    if (!pageUid) return [];
    const page = host.pullBlock(pageUid);
    return (page?.children || []).map((c) => ({ uid: c.uid, name: plainText(c.string) }));
  }

  function userTemplates() {
    const out = [];
    for (const row of templateRows()) {
      if (out.length >= TEMPLATE_CAP) break;
      let drawingUid = null;
      try { drawingUid = host.pullBlock(row.uid)?.children.find((k) => DRAWING_RE.test(k.string))?.uid ?? null; } catch { drawingUid = null; }
      if (!drawingUid) continue;
      let count = 0;
      try { count = liveCount(host.drawing(drawingUid)?.elements); } catch { count = 0; }
      if (count > 0) out.push({ uid: row.uid, drawingUid, name: row.name });
    }
    return out;
  }

  // ---- inserting ----

  // Fetches images that have an upload but no file in the open drawing, so they show without a reopen (amendment 16).
  async function ensureImageFiles(app, els) {
    const files = app.files ?? {};
    const add = [];
    const seen = new Set();
    let missing = 0;
    for (const el of els) {
      if (el.type !== "image" || !el.fileId || files[el.fileId] || seen.has(el.fileId)) continue;
      seen.add(el.fileId);
      const url = el.customData?.firebaseUrl;
      if (!url) { missing += 1; continue; }
      try {
        const blob = await api.file.get({ url });
        if (!blob) throw new Error("no file");
        add.push({ id: el.fileId, mimeType: blob.type || "image/png", dataURL: await toDataURL(blob), created: now() });
      } catch (error) {
        console.warn("[plexus] template image fetch failed", error);
        missing += 1;
      }
    }
    if (add.length) {
      try { app.addFiles?.(add); } catch (error) { console.warn("[plexus] template addFiles failed", error); missing += add.length; }
    }
    return missing;
  }

  // Remaps `source`, centres it on the viewport and appends it in one guarded write (one undo step).
  // Returns { ids, bounds, count } or null when nothing was written.
  async function insertInto(app, drawingUid, source, { bulk = true, label = "Template" } = {}) {
    const elements = remapForInsert(source, { centre: viewCentre(app), now: now() });
    if (!elements.length) { toast("That template is empty"); return null; }
    const missing = await ensureImageFiles(app, elements);
    if (disposed || native.activeEditor(doc)?.app !== app) { if (!disposed) toast("Drawing closed"); return null; }
    if (missing) fail(`${plural(missing, "image")} missing`);
    if (bulk) { try { beforeBulk(app, drawingUid, `before ${label}`); } catch (error) { console.warn("[plexus] beforeBulk failed", error); } }
    const selectedElementIds = {};
    for (const el of elements) if (!el.containerId) selectedElementIds[el.id] = true;
    const ok = guardedWrite(app, {
      drawingUid,
      label,
      captureUpdate: "IMMEDIATELY",
      next: (current) => withTemplateFrames(current, elements),
      appState: { selectedElementIds, selectedGroupIds: {} },
    });
    if (!ok) return null;
    return { ids: elements.map((e) => e.id), bounds: commonBounds(elements), count: elements.length };
  }

  // The elements of a picked starter or user template, or null (after a toast).
  function sourceOf(item) {
    if (item.kind === "starter") {
      const starter = STARTERS.find((s) => s.id === item.id);
      if (!starter) { fail("That starter is gone"); return null; }
      return { elements: buildStarter(starter, { measure }), appState: null };
    }
    const drawing = host.drawing(item.drawingUid);
    const elements = liveElements(drawing?.elements);
    if (!elements.length) { fail("That template could not be read"); return null; }
    return { elements, appState: drawing.appState ?? null };
  }

  const closeDialogs = () => {
    try { picker?.close?.(); } catch { /* ignore */ }
    try { prompt?.close?.(); } catch { /* ignore */ }
    picker = null;
    prompt = null;
  };

  function showPicker(editor, onPick) {
    try { picker?.close?.(); } catch { /* ignore */ }
    let handle = null;
    handle = openPicker({
      doc,
      zIndex: zIndex(editor),
      starters: STARTERS.map((s) => ({ id: s.id, name: s.name })),
      userTemplates: userTemplates(),
      thumbnail,
      onPick,
      onClose: () => {
        if (picker === handle) picker = null;
        refocus(editor);
      },
    });
    picker = handle || null;
    return picker;
  }

  function insertTemplate() {
    if (disposed) return null;
    const editor = native.activeEditor(doc);
    if (!editor) { fail("Open a drawing first"); return null; }
    return showPicker(editor, async (item) => {
      if (disposed) return;
      try {
        const source = sourceOf(item);
        if (!source) return;
        if (native.activeEditor(doc)?.app !== editor.app) { fail("Drawing closed"); return; }
        await insertInto(editor.app, editor.drawingUid, source.elements);
      } catch (error) {
        console.warn("[plexus] insert template failed", error);
        fail("Could not insert the template");
      } finally {
        refocus(editor);
      }
    });
  }

  function newFromTemplate(ctx = {}) {
    if (disposed) return null;
    if (native.activeEditor(doc)) { fail("Use Insert template… in an open drawing"); return null; }
    const focused = ctx?.focusedUid ?? null;
    return showPicker(null, async (item) => {
      if (disposed) return;
      try {
        const source = sourceOf(item);
        if (!source) return;
        const made = await newDrawing(focused ? { where: "below", uid: focused, fresh: true } : { where: "today", fresh: true });
        if (!made || disposed) return;
        const editor = made.opened ? native.activeEditor(doc) : null;
        if (!editor || editor.drawingUid !== made.uid) { toast("Drawing created; insert the template from its menu"); return; }
        if (!(await native.waitNotLoading(editor.app, LOADING_MS, { doc })) || disposed) { toast("Drawing created; insert the template from its menu"); return; }
        const wrote = await insertInto(editor.app, made.uid, source.elements, { bulk: false });
        if (!wrote || disposed) return;
        const style = pickCurrentItem(source.appState);
        if (Object.keys(style).length) {
          try { editor.app.updateScene({ appState: style }); } catch (error) { console.warn("[plexus] template style failed", error); }
        }
        if (wrote.bounds) {
          try { native.zoomTo(editor.app, wrote.bounds); } catch (error) { console.warn("[plexus] template zoom failed", error); }
        }
      } catch (error) {
        console.warn("[plexus] new drawing from template failed", error);
        fail("Could not create the drawing from the template");
      }
    });
  }

  // ---- saving ----

  async function closeEditor() {
    if (closeEditorOverride) return closeEditorOverride();
    const editor = native.activeEditor(doc);
    if (!editor) return true;
    try { editor.outer?.querySelector?.(".bp3-icon-minimize")?.click?.(); } catch (error) { console.warn("[plexus] minimize failed", error); }
    const end = now() + CLOSE_WAIT_MS;
    while (!disposed && native.activeEditor(doc)) {
      if (now() >= end) return false;
      await sleep(50);
    }
    return !native.activeEditor(doc);
  }

  function removeSidebarWindow(uid) {
    try { api?.ui?.rightSidebar?.removeWindow?.({ window: { type: "block", "block-uid": uid } }); } catch (error) { console.warn("[plexus] sidebar remove failed", error); }
  }

  // The whole save, run under one lock. cap: the closed selection captured before the prompt.
  async function saveFlow(name, cap, originalUid) {
    let blockUid = null;
    let tUid = null;
    let closed = false;
    let sidebar = false;
    let message = null;
    let outcome = "failed";
    try {
      toast("Saving template…", { ms: 15000 });
      const pageUid = await host.ensurePage(TEMPLATES_PAGE);
      if (stopped()) return;
      blockUid = await host.createBlock({ parentUid: pageUid, order: "last", string: name });
      if (stopped()) return;
      tUid = (await host.createDrawing({ parentUid: blockUid, order: "last" })).uid;
      if (stopped()) return;
      closed = await closeEditor();
      if (stopped()) return;
      if (!closed) throw new Stop("Could not close the drawing");
      sidebar = true;
      const opened = await openDrawing(tUid, { sidebar: true, placeholder: true });
      if (stopped()) return;
      if (!opened) throw new Stop("Could not open the template drawing");
      await native.waitNotLoading(opened.app, LOADING_MS, { doc });
      if (stopped()) return;
      const here = native.activeEditor(doc);
      if (!here || here.drawingUid !== tUid) throw new Stop("The template drawing did not open");
      const wrote = await insertInto(here.app, tUid, cap.elements, { bulk: false, label: "Template" });
      if (stopped()) return;
      if (!wrote) throw new Stop("Could not write the template");
      const want = sceneLive(here.app) || wrote.count;
      const end = now() + VERIFY_TIMEOUT_MS;
      for (;;) {
        // A close during the save wins over a block write that lands in the same gap.
        if (native.activeEditor(doc)?.drawingUid !== tUid) { outcome = "closed"; break; }
        if (liveCount(host.drawing(tUid)?.elements) === want) { outcome = "ok"; break; }
        if (now() >= end) { outcome = "timeout"; break; }
        await sleep(VERIFY_POLL_MS);
        if (stopped()) return;
      }
    } catch (error) {
      if (!(error instanceof Stop)) console.warn("[plexus] save template failed", error);
      message = error instanceof Stop ? error.message : "Could not save the template";
    }
    if (stopped()) return;

    if (tUid) {
      try { if (native.activeEditor(doc)?.drawingUid === tUid) await closeEditor(); } catch (error) { console.warn("[plexus] close template failed", error); }
      if (sidebar) removeSidebarWindow(tUid);
      if (stopped()) return;
    }
    let persisted = 0;
    try { persisted = tUid ? liveCount(host.drawing(tUid)?.elements) : 0; } catch { persisted = 0; }
    let summary;
    if (outcome === "ok") summary = null;
    else if (persisted === 0) {
      if (blockUid) { try { await host.deleteBlock(blockUid); } catch (error) { console.warn("[plexus] template cleanup failed", error); } }
      summary = message || (outcome === "closed" ? "Template not saved: the drawing was closed" : "Template not saved");
    } else summary = "Template may be incomplete";
    if (stopped()) return;

    let reopened = true;
    if (closed) {
      const editor = await openDrawing(originalUid, { placeholder: false });
      reopened = !!editor;
      if (stopped()) return;
    }
    if (summary) fail(reopened ? summary : `${summary}. Reopen the drawing from the outline`);
    else toast(reopened ? `Template saved: ${name}` : "Template saved; reopen the drawing from the outline");
  }

  function saveSelectionAsTemplate() {
    if (disposed) return null;
    if (saving) { toast("A template is being saved"); return null; }
    const editor = native.activeEditor(doc);
    if (!editor) { fail("Open a drawing first"); return null; }
    const ids = native.selectedElementIds(editor.app);
    if (!ids.length) { fail("Select something to save as a template"); return null; }
    const cap = selectionToTemplate(editor.app.getSceneElementsIncludingDeleted?.() ?? [], ids);
    if (cap.skippedImages) toast(`${plural(cap.skippedImages, "image")} without an upload ${cap.skippedImages === 1 ? "was" : "were"} skipped`);
    if (!cap.elements.length) { fail("Nothing to save"); return null; }
    const originalUid = editor.drawingUid;
    let chosen = null;
    try { prompt?.close?.(); } catch { /* ignore */ }
    let handle = null;
    handle = openPrompt({
      doc,
      zIndex: zIndex(editor),
      title: "Save selection as template",
      maxLength: NAME_MAX,
      onSubmit: (value) => {
        const name = cleanName(value);
        if (!name) throw new Error("Enter a name");
        const lower = name.toLowerCase();
        if (templateRows().some((r) => cleanName(r.name).toLowerCase() === lower)) throw new Error("A template with that name exists");
        chosen = name;
      },
      onClose: () => {
        if (prompt === handle) prompt = null;
        const name = chosen;
        chosen = null;
        if (!name && !disposed) refocus(editor);
        if (!name || disposed) return;
        saving = true;
        (async () => {
          try {
            const graph = host.graphName();
            const lock = await withLockFn(lockName(graph, "plexus-templates"), () => saveFlow(name, cap, originalUid));
            if (!lock.acquired && !disposed) fail("A template is being saved elsewhere");
          } catch (error) {
            console.warn("[plexus] save template failed", error);
            if (!disposed) fail("Could not save the template");
          } finally {
            saving = false;
          }
        })();
      },
    });
    prompt = handle || null;
    return prompt;
  }

  return {
    insertTemplate,
    newFromTemplate,
    saveSelectionAsTemplate,
    closeDialogs,
    dispose() {
      disposed = true;
      closeDialogs();
    },
  };
}
