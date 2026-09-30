const STOP_EVENTS = ["keydown", "keyup", "keypress", "paste", "copy", "cut"];
const open = new WeakMap();

const pad = (n) => String(n).padStart(2, "0");

// 24-hour time; the date is added when the entry is not from today.
export function formatWhen(t, nowMs = Date.now()) {
  const d = new Date(t);
  const n = new Date(nowMs);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()) return hm;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// In-page "Restore an earlier version" list. session: [{index, label, time, count}] from the write guard, newest first.
// loadSaved() resolves the saved ring entries [{key, t, count}] newest first, or {encrypted: true}; omit it (or resolve
// null) when the graph keeps none. onRestore receives {kind: "session", index, label} or {kind: "saved", key, t, count}
// after the dialog has closed.
export function openRestoreDialog({ doc, zIndex = 100000, session = [], loadSaved, onRestore = () => {}, onClose = () => {}, mac = false } = {}) {
  const existing = open.get(doc);
  if (existing) existing.close();

  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  };

  const root = el("div", "plexus-portal plexus-restore");
  root.setAttribute?.("role", "dialog");
  root.setAttribute?.("aria-modal", "true");
  root.setAttribute?.("aria-label", "Restore an earlier version");
  root.setAttribute?.("tabindex", "-1");
  root.style.zIndex = String(Number(zIndex) + 2);

  const previous = doc.activeElement ?? null;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    if (open.get(doc) === handle) open.delete(doc);
    root.remove?.();
    try { previous?.focus?.(); } catch { /* ignore */ }
    try { onClose(); } catch (error) { console.warn("[plexus] restore dialog close failed", error); }
  };

  const stop = (e) => e?.stopPropagation?.();
  for (const type of STOP_EVENTS) root.addEventListener(type, stop);
  root.addEventListener("keydown", (e) => {
    if (e?.key === "Escape") {
      e.preventDefault?.();
      close();
    }
  });

  const pick = (entry) => {
    close();
    try { onRestore(entry); } catch (error) { console.warn("[plexus] restore failed", error); }
  };

  const row = (main, meta, entry) => {
    const line = el("div", "plexus-restore-row");
    const button = el("button", "plexus-toolbar-button plexus-restore-pick", "Restore");
    button.type = "button";
    button.addEventListener("click", (e) => {
      e.stopPropagation?.();
      pick(entry);
    });
    line.append(el("span", "plexus-restore-main", main), el("span", "plexus-restore-meta", meta), button);
    return line;
  };

  const section = (title) => {
    const box = el("div", "plexus-restore-section");
    box.append(el("div", "plexus-restore-heading", title));
    const list = el("div", "plexus-restore-list");
    box.append(list);
    return { box, list };
  };

  const note = (text) => el("div", "plexus-restore-empty", text);

  const sessionSection = section("This session");
  if (!session.length) sessionSection.list.append(note("Nothing yet this session"));
  for (const s of session) {
    sessionSection.list.append(row(s.label || "Change", `${formatWhen(s.time)} · ${plural(s.count, "element")}`, { kind: "session", index: s.index, label: s.label, ...(s.id !== undefined ? { id: s.id } : {}) }));
  }

  const savedSection = section("Saved on this device");
  savedSection.list.append(note(typeof loadSaved === "function" ? "Loading…" : "Not kept on encrypted graphs"));
  if (typeof loadSaved === "function") {
    Promise.resolve()
      .then(loadSaved)
      .then((saved) => {
        if (closed) return;
        savedSection.list.replaceChildren();
        if (!saved || saved.encrypted === true) {
          savedSection.list.append(note("Not kept on encrypted graphs"));
          return;
        }
        if (!saved.length) savedSection.list.append(note("No saved versions yet"));
        for (const s of saved) savedSection.list.append(row(formatWhen(s.t), plural(s.count, "element"), { kind: "saved", key: s.key, t: s.t, count: s.count }));
      })
      .catch((error) => {
        console.warn("[plexus] restore dialog list failed", error);
        if (closed) return;
        savedSection.list.replaceChildren();
        savedSection.list.append(note("Could not load saved versions"));
      });
  }

  const cancel = el("button", "plexus-toolbar-button plexus-restore-cancel", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", (e) => {
    e.stopPropagation?.();
    close();
  });
  const actions = el("div", "plexus-restore-actions");
  actions.append(cancel);

  root.append(
    el("div", "plexus-restore-title", "Restore an earlier version"),
    el("div", "plexus-restore-hint", `Restoring is one undo step (${mac ? "Cmd" : "Ctrl"}+Z).`),
    sessionSection.box,
    savedSection.box,
    actions,
  );

  const handle = { close, isOpen: () => !closed, node: root };
  open.set(doc, handle);
  doc.body.append(root);
  try { root.focus?.(); } catch { /* ignore */ }
  return handle;
}
