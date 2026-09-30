import { withClipboard } from "../host/native.js";

const STOP_EVENTS = ["keydown", "keyup", "keypress", "input", "paste", "copy", "cut", "mousedown", "pointerdown", "wheel", "click"];
const MAX_ROWS = 500;

export const PROBLEM_TEXT = {
  unsupported: "Unsupported region string",
  "no-owner": "No drawing named in the region",
  partial: "Some elements are missing",
  "no-elements": "The region's elements are gone",
  "outside-crop": "Outside the image crop",
  "not-image": "The element is not an image",
  rotated: "The image is rotated",
  "not-frame": "The element is not a frame",
  "no-image": "The image is missing",
  "outside-container": "Not under a region container",
  "owner-mismatch": "Names a different drawing than its container",
  "two-containers": "More than one region container",
  "orphan-container": "Region container without a drawing",
};

// A modal report of region problems. Everything is textContent; nothing here touches the graph: Open, Repair and
// Copy report are callbacks or the clipboard. Open closes the dialog first, because a modal left open would make the
// full-screen editor inert.
const VIA_REGION = new Set(["partial", "no-elements", "outside-crop", "not-image", "rotated", "not-frame", "no-image", "outside-container", "owner-mismatch"]);

// Rows whose region block still parses and has a drawing to frame open through the region; the rest land on the block itself.
export function auditOpenTarget(row) {
  if (row?.kind === "container") return { via: "block", uid: row.drawingUid ?? row.uid };
  if (VIA_REGION.has(row?.problem) && row?.uid) return { via: "region", uid: row.uid };
  return { via: "block", uid: row?.uid };
}

export function openAuditDialog({ doc, rows = [], onOpen = () => {}, onRepair = () => {}, onClose = () => {}, dark = false } = {}) {
  const statuses = new Map();
  let current = Array.isArray(rows) ? rows : [];
  let closed = false;

  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  };
  const warn = (what) => (error) => console.warn(`[plexus] audit dialog ${what} failed`, error);
  const run = (what, fn) => {
    try {
      const out = fn();
      if (out && typeof out.catch === "function") out.catch(warn(what));
      return out;
    } catch (error) {
      warn(what)(error);
      return undefined;
    }
  };
  const button = (label, handler) => {
    const b = el("button", "plexus-toolbar-button", label);
    b.type = "button";
    b.addEventListener("click", (e) => {
      e?.stopPropagation?.();
      run(label, handler);
    });
    return b;
  };

  const d = el("dialog", `plexus-portal plexus-legacy plexus-audit${dark ? " plexus-audit--dark" : ""}`);
  const summary = el("div", "plexus-legacy-summary");
  const list = el("div", "plexus-legacy-rows plexus-audit-rows");
  const stop = (e) => e?.stopPropagation?.();
  for (const type of STOP_EVENTS) d.addEventListener(type, stop);

  const close = () => {
    if (closed) return;
    closed = true;
    for (const type of STOP_EVENTS) d.removeEventListener?.(type, stop);
    d.removeEventListener?.("cancel", close);
    d.removeEventListener?.("close", close);
    try { if (typeof d.close === "function") d.close(); } catch (error) { console.warn("[plexus] audit dialog close failed", error); }
    d.remove?.();
    run("onClose", () => onClose());
  };

  const rowNode = (row) => {
    const node = el("div", "plexus-legacy-row plexus-audit-row");
    const status = el("span", "plexus-audit-status", statuses.get(row.uid) ?? "");
    node.append(
      el("span", "plexus-audit-label", row.label || row.uid),
      el("span", "plexus-audit-problem", PROBLEM_TEXT[row.problem] ?? row.problem ?? ""),
    );
    if (row.detail) node.append(el("span", "plexus-legacy-uid plexus-audit-detail", row.detail));
    node.append(button("Open", () => {
      close();
      return onOpen(row);
    }));
    if (row.repair) {
      node.append(button("Repair", async () => {
        const result = await onRepair(row);
        if (row.repair === "reselect" || result?.reason === "reselect") { close(); return; }
        const text = result === true || result?.fixed ? "Fixed" : `Not fixed${result?.reason ? `: ${result.reason}` : ""}`;
        statuses.set(row.uid, text);
        status.textContent = text;
      }));
    }
    node.append(status);
    return node;
  };

  const render = () => {
    const shown = current.slice(0, MAX_ROWS);
    summary.textContent = current.length ? `${current.length} problem${current.length === 1 ? "" : "s"}` : "No problems found";
    if (current.truncated) summary.textContent += " (scan stopped at 2000 rows; some regions were not checked)";
    const nodes = [];
    const pages = new Map();
    for (const row of shown) {
      const page = row.pageTitle || "(no page)";
      if (!pages.has(page)) pages.set(page, new Map());
      const drawings = pages.get(page);
      const key = row.drawingUid || "";
      if (!drawings.has(key)) drawings.set(key, []);
      drawings.get(key).push(row);
    }
    for (const [page, drawings] of pages) {
      nodes.push(el("div", "plexus-audit-page", page));
      for (const [uid, group] of drawings) {
        if (uid) nodes.push(el("div", "plexus-legacy-uid plexus-audit-drawing", `Drawing ${uid}`));
        for (const row of group) nodes.push(rowNode(row));
      }
    }
    if (current.length > MAX_ROWS) nodes.push(el("div", "plexus-legacy-uid", `+${current.length - MAX_ROWS} more`));
    if (typeof list.replaceChildren === "function") list.replaceChildren(...nodes);
    else {
      list.textContent = "";
      list.append(...nodes);
    }
  };

  const actions = el("div", "plexus-legacy-actions");
  actions.append(
    button("Copy report", () => {
      const json = JSON.stringify(current, null, 2);
      const clipboard = doc.defaultView?.navigator?.clipboard;
      return withClipboard(() => clipboard.writeText(json));
    }),
    button("Close", close),
  );
  d.append(el("div", "plexus-legacy-title", "Region audit"), summary, list, actions);
  d.addEventListener("cancel", close);
  d.addEventListener("close", close);
  render();
  doc.body.append(d);
  if (typeof d.showModal === "function") d.showModal();
  else d.setAttribute?.("open", "");

  return {
    close,
    update(next) {
      if (closed) return;
      current = Array.isArray(next) ? next : [];
      render();
    },
  };
}
