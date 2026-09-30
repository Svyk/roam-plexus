// Template picker (P13 AUTH-10): built-in starters first, then the user's templates. Nothing renders while it opens:
// thumbnails are cache-only first, then at most MAX_RENDERS serial renders after the picker is painted. Keys are
// isolated so Excalidraw's document listeners do not see typing.
const ISOLATED = ["keydown", "keyup", "keypress", "paste", "copy", "cut"];
const MAX_RENDERS = 6;
const THUMB_WIDTH = 160;

let current = null;

// starters: [{id, name}]. userTemplates: [{uid, drawingUid, name}]. thumbnail(uid, {maxWidth, render}) resolves a Blob or null.
// onPick({kind: "starter", id, name} | {kind: "user", uid, drawingUid, name}) runs after the picker has closed.
export function openTemplatePicker({
  doc,
  zIndex = 1000,
  starters = [],
  userTemplates = [],
  thumbnail = null,
  onPick = () => {},
  onClose = () => {},
  urls = globalThis.URL,
  defer = (fn) => {
    let t = null;
    const r = (globalThis.requestAnimationFrame ?? ((f) => setTimeout(f, 16)))(() => { t = setTimeout(fn, 0); });
    return { cancel() { globalThis.cancelAnimationFrame?.(r); if (t != null) clearTimeout(t); } };
  },
  maxRenders = MAX_RENDERS,
} = {}) {
  if (current) current.close();
  const handle = { done: false, root: null, listeners: [], objectUrls: [], timer: null };
  const mk = (tag, className, text) => {
    const n = doc.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = String(text);
    return n;
  };
  const on = (node, type, fn) => { node.addEventListener(type, fn); handle.listeners.push([node, type, fn]); };

  const root = mk("div", "plexus-portal plexus-template-picker");
  root.style.zIndex = String(zIndex);
  root.setAttribute?.("role", "dialog");
  handle.root = root;
  root.append(mk("div", "plexus-template-title", "Insert template"));

  const close = () => {
    if (handle.done) return;
    handle.done = true;
    if (handle.timer != null) {
      try { if (typeof handle.timer.cancel === "function") handle.timer.cancel(); else clearTimeout(handle.timer); } catch { /* ignore */ }
      handle.timer = null;
    }
    for (const [node, type, fn] of handle.listeners.splice(0)) node.removeEventListener?.(type, fn);
    for (const url of handle.objectUrls.splice(0)) {
      try { urls?.revokeObjectURL?.(url); } catch (error) { console.warn("[plexus] template picker revoke failed", error); }
    }
    try { root.remove?.(); } catch (error) { console.warn("[plexus] template picker remove failed", error); }
    if (current === handle) current = null;
    try { onClose(); } catch (error) { console.warn("[plexus] template picker onClose failed", error); }
  };
  handle.close = close;

  const pick = (item) => {
    if (handle.done) return;
    close();
    try {
      const out = onPick(item);
      if (out && typeof out.catch === "function") out.catch((error) => console.warn("[plexus] template pick failed", error));
    } catch (error) {
      console.warn("[plexus] template pick failed", error);
    }
  };

  const tile = (name, item, withThumb) => {
    const button = mk("button", "plexus-template-tile");
    button.type = "button";
    const thumb = withThumb ? mk("span", "plexus-template-thumb") : null;
    if (thumb) button.append(thumb);
    button.append(mk("span", "plexus-template-name", name));
    on(button, "click", (e) => { e.stopPropagation?.(); pick(item); });
    return { button, thumb, item, withThumb };
  };

  const tiles = [];
  const section = (title, list) => {
    root.append(mk("div", "plexus-template-heading", title));
    const grid = mk("div", "plexus-template-grid");
    for (const t of list) { grid.append(t.button); tiles.push(t); }
    root.append(grid);
  };
  if (starters.length) section("Starters", starters.map((s) => tile(s.name, { kind: "starter", id: s.id, name: s.name }, false)));
  const users = userTemplates.map((t) => tile(t.name, { kind: "user", uid: t.uid, drawingUid: t.drawingUid, name: t.name }, true));
  if (users.length) section("My templates", users);
  else root.append(mk("div", "plexus-template-empty", "Save a selection as a template to see it here."));

  const cancel = mk("button", "plexus-toolbar-button plexus-template-cancel", "Cancel");
  cancel.type = "button";
  const actions = mk("div", "plexus-template-actions");
  actions.append(cancel);
  root.append(actions);
  on(cancel, "click", (e) => { e.stopPropagation?.(); close(); });

  for (const type of ISOLATED) on(root, type, (e) => e.stopPropagation?.());
  on(root, "keydown", (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape") { e.preventDefault?.(); close(); }
  });

  const setThumb = (t, blob) => {
    if (handle.done || !blob || !urls?.createObjectURL) return;
    try {
      const url = urls.createObjectURL(blob);
      handle.objectUrls.push(url);
      const img = mk("img", "plexus-template-img");
      img.src = url;
      img.alt = "";
      t.thumb.append(img);
    } catch (error) {
      console.warn("[plexus] template thumbnail failed", error);
    }
  };
  const fetchThumb = async (t, render) => {
    try { return await thumbnail(t.item.drawingUid, { maxWidth: THUMB_WIDTH, render }); } catch (error) {
      console.warn("[plexus] template thumbnail failed", error);
      return null;
    }
  };
  const loadThumbs = async () => {
    handle.timer = null;
    if (handle.done || typeof thumbnail !== "function") return;
    const misses = [];
    for (const t of tiles) {
      if (!t.withThumb) continue;
      if (handle.done) return;
      const blob = await fetchThumb(t, false);
      if (handle.done) return;
      if (blob) setThumb(t, blob); else misses.push(t);
    }
    for (const t of misses.slice(0, maxRenders)) {
      if (handle.done) return;
      const blob = await fetchThumb(t, true);
      if (handle.done) return;
      if (blob) setThumb(t, blob);
    }
  };

  try {
    doc.body.append(root);
    tiles[0]?.button.focus?.();
  } catch (error) {
    console.warn("[plexus] template picker failed", error);
    close();
    return null;
  }
  current = handle;
  if (users.length) handle.timer = defer(() => { loadThumbs().catch((error) => console.warn("[plexus] template thumbnails failed", error)); });
  return { el: root, close, isOpen: () => !handle.done };
}
