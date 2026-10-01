import { attachThumbs, galleryRows, readDrawingRows, withHashes } from "../model/drawings.js";

const MIN_Z = 100003;
const openPanels = new WeakMap();

const warn = (what, error) => console.warn(`[plexus] drawing gallery ${what} failed`, error);

function clearNode(node) {
  if (!node) return;
  if (typeof node.replaceChildren === "function") {
    node.replaceChildren();
    return;
  }
  for (const child of [...(node.children || [])]) child.remove?.();
}

export function openDrawingGallery({ doc, api, hashOf, lookup, openDrawing, toast, zIndex = 0 } = {}) {
  if (!doc) return { close() {}, ready: Promise.resolve() };
  const existing = openPanels.get(doc);
  if (existing) return existing.handle;

  let dead = false;
  const root = doc.createElement("div");
  root.className = "rm-autocomplete__results bp3-elevation-3 plexus-portal plexus-picker plexus-gallery";
  root.style.zIndex = String(Math.max(zIndex || 0, MIN_Z));
  const main = doc.createElement("div");
  main.className = "rm-autocomplete__results-main";
  const scroll = doc.createElement("div");
  scroll.className = "rm-autocomplete__results-scroll";
  const footer = doc.createElement("div");
  footer.className = "rm-autocomplete-footer";
  const footerTitle = doc.createElement("div");
  footerTitle.className = "rm-autocomplete-footer__title";
  footerTitle.textContent = "Drawings";
  footer.append(footerTitle);
  main.append(scroll, footer);
  root.append(main);

  const stop = (e) => e.stopPropagation?.();
  root.addEventListener("pointerdown", stop);
  root.addEventListener("mousedown", (e) => { e.preventDefault?.(); stop(e); });
  root.addEventListener("click", stop);

  function close() {
    if (dead) return;
    dead = true;
    doc.removeEventListener?.("pointerdown", onDocPointer, true);
    doc.removeEventListener?.("keydown", onKey, true);
    try { root.remove(); } catch { /* already gone */ }
    if (openPanels.get(doc)?.handle === handle) openPanels.delete(doc);
  }

  function onDocPointer(e) {
    if (!(e?.target && root.contains?.(e.target))) close();
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault?.();
      close();
    }
  }

  function paint(rows) {
    clearNode(scroll);
    if (!rows.length) {
      const empty = doc.createElement("div");
      empty.className = "plexus-gallery-empty";
      empty.textContent = "There are no drawings";
      scroll.append(empty);
      return;
    }
    for (const row of rows) {
      const line = doc.createElement("button");
      line.type = "button";
      line.className = "dont-unfocus-block plexus-gallery-row";
      line.setAttribute("data-testid", `plexus-gallery-${row.uid}`);
      if (row.thumb) {
        const img = doc.createElement("img");
        img.className = "plexus-gallery-tile";
        img.alt = "";
        img.src = row.thumb;
        line.append(img);
      } else {
        const blank = doc.createElement("div");
        blank.className = "plexus-gallery-blank";
        line.append(blank);
      }
      const label = doc.createElement("span");
      label.className = "plexus-gallery-label";
      label.textContent = row.label;
      line.append(label);
      line.addEventListener("click", (e) => {
        stop(e);
        const uid = row.uid;
        close();
        try {
          const out = openDrawing?.(uid);
          if (out && typeof out.catch === "function") out.catch((error) => warn("open", error));
        } catch (error) {
          warn("open", error);
        }
      });
      scroll.append(line);
    }
  }

  const ready = (async () => {
    let raw = [];
    try {
      raw = readDrawingRows(api);
    } catch (error) {
      warn("query", error);
      try { toast?.("Could not list drawings"); } catch { /* toast is best effort */ }
    }
    const labeled = galleryRows(raw);
    const hashed = withHashes(labeled, hashOf);
    let rows = hashed.map((row) => ({ ...row, thumb: null }));
    try {
      rows = await attachThumbs(hashed, { lookup });
    } catch (error) {
      warn("thumbs", error);
    }
    if (!dead) {
      try { paint(rows); } catch (error) { warn("paint", error); }
    }
  })();

  const handle = { close, ready };
  openPanels.set(doc, { handle });
  try {
    doc.body.append(root);
    doc.addEventListener?.("pointerdown", onDocPointer, true);
    doc.addEventListener?.("keydown", onKey, true);
  } catch (error) {
    warn("open", error);
    close();
  }
  return handle;
}
