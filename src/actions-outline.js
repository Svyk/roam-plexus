import { withLock, lockName } from "./host/locks.js";
import { fnv1a } from "./model/hash.js";
import { elementsToOutline, outlineToMarkdown } from "./model/outline.js";
import { openOutlinePreview } from "./view/outline-preview.js";

export const OUTLINE_CONTAINER = "{{[[plexus-outline]]}}";
export const OUTLINE_PREVIEW_ABOVE = 50;
export const OUTLINE_MAX = 500;

const TREE_PATTERN = "[:block/uid :block/string :block/heading :block/order {:block/children ...}]";

const normTree = (raw) => ({
  uid: raw?.[":block/uid"],
  string: raw?.[":block/string"] ?? "",
  heading: raw?.[":block/heading"] || 0,
  children: (raw?.[":block/children"] || []).map(normTree).sort((a, b) => a.order - b.order),
  order: raw?.[":block/order"] ?? 0,
});
const flatUids = (t) => [t.uid, ...t.children.flatMap(flatUids)];
// fromMarkdown turns a bullet whose text starts with "# " into a heading, so such trees are written block by block.
const looksLikeHeading = (nodes) => nodes.some((n) => (!(n.heading > 0) && /^#{1,6}\s/.test(n.string)) || looksLikeHeading(n.children || []));

// The drawing to outline actions. host: pullBlock/createBlock/drawing; api: roamAlphaAPI; openPreview: the dialog opener.
export function createOutlineActions({
  host,
  native,
  api = globalThis.roamAlphaAPI,
  toaster,
  clipboard,
  withLockFn = withLock,
  openPreview = openOutlinePreview,
  doc,
  getApp = null,
} = {}) {
  let preview = null;
  let disposed = false;

  const toast = (message, opts) => { try { toaster?.show?.(message, opts); } catch { /* ignore */ } };
  const error = (message) => toast(message, { kind: "error" });
  const app = (drawingUid) => {
    try {
      if (getApp) return getApp(drawingUid) || null;
      const editor = native?.activeEditor?.(doc);
      return editor && (!drawingUid || !editor.drawingUid || editor.drawingUid === drawingUid) ? editor.app : null;
    } catch { return null; }
  };
  const today = () => { try { return api.util.dateToPageTitle(new Date()); } catch { return undefined; } };

  // { outline, message } - message is set when there is nothing to build.
  function build(drawingUid, selection) {
    const editor = app(drawingUid);
    let ids = null;
    let elements;
    if (selection) {
      if (Array.isArray(selection) || selection instanceof Set) ids = [...selection];
      else if (editor) ids = native.selectedElementIds(editor);
      else return { message: "Open the drawing to outline a selection" };
      if (!ids.length) return { message: "Nothing is selected" };
    }
    if (editor) elements = editor.getSceneElements?.() ?? editor.getSceneElementsIncludingDeleted?.() ?? [];
    else elements = host.drawing?.(drawingUid)?.elements ?? null;
    if (!Array.isArray(elements)) return { message: "That drawing could not be read" };
    const outline = elementsToOutline(elements, { selection: ids, today: today() });
    if (!outline.count) return { message: "Nothing to outline" };
    return { outline };
  }

  const findContainer = (drawingUid) => host.pullBlock(drawingUid)?.children.find((c) => c.string.trim() === OUTLINE_CONTAINER) || null;

  async function ensureContainer(drawingUid) {
    const existing = findContainer(drawingUid);
    if (existing) return existing.uid;
    const uid = `o${fnv1a(drawingUid)}`;
    try {
      await host.createBlock({ parentUid: drawingUid, order: "last", string: OUTLINE_CONTAINER, uid, open: false });
    } catch (err) {
      const found = findContainer(drawingUid);
      if (found) return found.uid;
      if (!host.pullBlock(uid)) throw err;
    }
    return uid;
  }

  const pullTree = (uid) => {
    const raw = api.data.pull(TREE_PATTERN, [":block/uid", uid]);
    return raw && raw[":block/uid"] ? normTree(raw) : null;
  };

  function referencedElsewhere(oldTops) {
    const uids = new Set(oldTops.flatMap(flatUids));
    for (const id of uids) {
      const raw = api.data.pull("[:block/uid {:block/_refs [:block/uid]}]", [":block/uid", id]);
      if ((raw?.[":block/_refs"] || []).some((r) => !uids.has(r[":block/uid"]))) return true;
    }
    return false;
  }

  // Walks expected nodes against pulled blocks. Returns { strings, headings, fixes: [{uid, heading}] }.
  function compare(nodes, actual) {
    const out = { strings: true, headings: true, fixes: [] };
    const walk = (exp, act) => {
      if (exp.length !== act.length) { out.strings = false; return; }
      exp.forEach((node, i) => {
        const a = act[i];
        if (String(a.string).trim() !== String(node.string).trim()) out.strings = false;
        if ((a.heading || 0) !== (node.heading || 0)) { out.headings = false; out.fixes.push({ uid: a.uid, heading: node.heading || 0 }); }
        walk(node.children || [], a.children);
      });
    };
    walk(nodes, actual);
    return out;
  }

  async function createSequential(nodes, parentUid) {
    for (const node of nodes) {
      const uid = api.util.generateUID();
      await api.data.block.create({
        location: { "parent-uid": parentUid, order: "last" },
        block: { uid, string: node.string, ...(node.heading > 0 ? { heading: node.heading } : {}) },
      });
      await createSequential(node.children || [], uid);
    }
  }

  async function deleteQuiet(uids) {
    let all = true;
    for (const uid of uids) {
      try { await api.data.block.delete({ block: { uid } }); } catch (err) { all = false; console.warn("[plexus] outline delete failed", err); }
    }
    return all;
  }

  // Insert first, delete second; must run inside the drawing lock. Returns { ok, reason?, removedAll? }.
  async function replaceContainer(containerUid, outline, markdown) {
    const before = pullTree(containerUid);
    const old = before ? before.children : [];
    const oldSet = new Set(old.map((c) => c.uid));
    if (old.length && referencedElsewhere(old)) return { ok: false, reason: "referenced" };
    const newTops = () => (pullTree(containerUid)?.children || []).filter((c) => !oldSet.has(c.uid));
    try {
      let fresh;
      let cmp;
      if (looksLikeHeading(outline.nodes)) {
        await createSequential(outline.nodes, containerUid);
        fresh = newTops();
        cmp = compare(outline.nodes, fresh);
        if (!cmp.strings) throw new Error("[plexus] outline did not round-trip");
      } else {
        await api.data.block.fromMarkdown({ location: { "parent-uid": containerUid, order: old.length }, "markdown-string": markdown });
        fresh = newTops();
        cmp = compare(outline.nodes, fresh);
      }
      if (!cmp.strings) {
        // Strings did not round-trip: rewrite the whole tree block by block into the same container.
        await deleteQuiet(fresh.map((c) => c.uid));
        await createSequential(outline.nodes, containerUid);
        fresh = newTops();
        cmp = compare(outline.nodes, fresh);
        if (!cmp.strings) throw new Error("[plexus] outline did not round-trip");
      }
      if (!cmp.headings) {
        for (const fix of cmp.fixes) await api.data.block.update({ block: { uid: fix.uid, heading: fix.heading } });
      }
    } catch (err) {
      console.warn("[plexus] outline write failed", err);
      try { await deleteQuiet(newTops().map((c) => c.uid)); } catch { /* ignore */ }
      return { ok: false, reason: "insert" };
    }
    const removedAll = old.length ? await deleteQuiet(old.map((c) => c.uid)) : true;
    return { ok: true, removedAll };
  }

  async function write(drawingUid, outline) {
    const markdown = outlineToMarkdown(outline);
    try {
      const lock = await withLockFn(lockName(api.graph.name, drawingUid), async () => {
        const containerUid = await ensureContainer(drawingUid);
        return { containerUid, ...(await replaceContainer(containerUid, outline, markdown)) };
      });
      if (!lock.acquired) {
        error("Could not lock the drawing; nothing was written");
        return { ok: false, reason: "lock" };
      }
      const r = lock.value;
      if (!r.ok) {
        error(r.reason === "referenced"
          ? "The previous outline is referenced elsewhere; move those blocks out first"
          : "The outline could not be written; the previous one was kept");
        return r;
      }
      if (!r.removedAll) error("The previous outline could not be fully removed");
      else toast(`Outline written · ${outline.count} block${outline.count === 1 ? "" : "s"}`);
      return { ok: true, count: outline.count, containerUid: r.containerUid, removedAll: r.removedAll };
    } catch (err) {
      console.warn("[plexus] drawing to outline failed", err);
      error("The outline could not be written");
      return { ok: false, reason: "error" };
    }
  }

  function closePreview() {
    const p = preview;
    preview = null;
    try { p?.close?.(); } catch { /* ignore */ }
  }

  // The count of blocks a re-run will replace (0 before the first run).
  function replacingCount(drawingUid) {
    try {
      const c = findContainer(drawingUid);
      const tree = c ? pullTree(c.uid) : null;
      return tree ? flatUids(tree).length - 1 : 0;
    } catch { return 0; }
  }

  function copyText(text, done) {
    let pending;
    try {
      const writeText = () => clipboard.writeText(text);
      pending = native.withClipboard ? native.withClipboard(writeText) : writeText();
    } catch (err) {
      pending = Promise.reject(err);
    }
    return Promise.resolve(pending).then(
      () => { toast(done); return true; },
      (err) => { console.warn("[plexus] clipboard failed", err); error("Clipboard access was blocked"); return false; },
    );
  }

  return {
    async drawingToOutline(drawingUid, { selection = null } = {}) {
      if (disposed) return { ok: false, reason: "disposed" };
      if (!drawingUid) return { ok: false, reason: "no-drawing" };
      const built = build(drawingUid, selection);
      if (!built.outline) { toast(built.message); return { ok: false, reason: "empty" }; }
      const { outline } = built;
      if (outline.count > OUTLINE_MAX) {
        error(`That outline has ${outline.count} blocks; the limit is ${OUTLINE_MAX}. Select fewer elements`);
        return { ok: false, reason: "too-many", count: outline.count };
      }
      if (outline.count <= OUTLINE_PREVIEW_ABOVE) return write(drawingUid, outline);
      closePreview();
      return new Promise((resolve) => {
        let settled = false;
        const settle = (v) => { if (!settled) { settled = true; resolve(v); } };
        try {
          preview = openPreview({
            doc,
            headings: outline.nodes.filter((n) => n.heading > 0).map((n) => n.string),
            count: outline.count,
            replacing: replacingCount(drawingUid),
            onWrite: async () => {
              const r = await write(drawingUid, outline);
              settle(r);
              return r;
            },
            onClose: () => { preview = null; settle({ ok: false, reason: "cancelled" }); },
          });
        } catch (err) {
          console.warn("[plexus] outline preview failed", err);
          error("The outline preview could not open");
          settle({ ok: false, reason: "error" });
        }
      });
    },

    // Builds synchronously so the clipboard write still counts as the user's gesture.
    copyMarkdown(drawingUid, { selection = null } = {}) {
      if (disposed || !drawingUid) return Promise.resolve(false);
      const built = build(drawingUid, selection);
      if (!built.outline) { toast(built.message); return Promise.resolve(false); }
      return copyText(outlineToMarkdown(built.outline), "Copied as Roam markdown");
    },

    closePreview,

    dispose() {
      disposed = true;
      closePreview();
    },
  };
}
