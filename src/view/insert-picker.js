import { filterInsertRows } from "../model/image-insert.js";

const open = new WeakMap();

// Enter fits. Shift+Enter is the pixel size. Escape cancels. onChoose receives { row, full } or null.
export function openInsertPicker({ doc, rows = [], onChoose, zIndex = 100003 } = {}) {
  const existing = open.get(doc);
  if (existing) existing.close();
  let dead = false;
  let active = 0;
  let lastMouse = null;
  const root = doc.createElement("div");
  root.className = "rm-autocomplete__results bp3-elevation-3 plexus-portal plexus-picker plexus-cmdlist plexus-insert-picker";
  root.style.zIndex = String(zIndex);
  const input = doc.createElement("input");
  input.className = "plexus-portal plexus-picker-input";
  input.setAttribute("type", "text");
  input.setAttribute("placeholder", "Image or drawing");
  input.setAttribute("spellcheck", "false");
  const hint = doc.createElement("div");
  hint.className = "plexus-picker-header";
  hint.textContent = "Enter fits. Shift+Enter is pixel size.";
  const scroll = doc.createElement("div");
  scroll.className = "rm-autocomplete__results-scroll";
  root.append(input, hint, scroll);

  const finish = (value) => {
    if (dead) return;
    dead = true;
    open.delete(doc);
    try { root.remove(); } catch { /* already gone */ }
    try { onChoose?.(value); } catch (error) { console.warn("[plexus] insert pick failed", error); }
  };

  const paint = () => {
    if (dead) return;
    const matches = filterInsertRows(rows, input.value);
    if (matches.length) active = Math.max(0, Math.min(active, matches.length - 1));
    scroll.replaceChildren?.();
    if (!scroll.replaceChildren) while (scroll.firstChild) scroll.removeChild(scroll.firstChild);
    if (!matches.length) {
      const empty = doc.createElement("div");
      empty.className = "plexus-cmdlist-empty";
      empty.textContent = "Nothing on this page";
      scroll.append(empty);
      return;
    }
    if (active >= matches.length) active = matches.length - 1;
    matches.forEach((row, index) => {
      const line = doc.createElement("div");
      line.className = "dont-unfocus-block";
      line.style.padding = "6px";
      line.style.cursor = "pointer";
      if (index === active) line.style.background = "rgb(213, 218, 223)";
      const inner = doc.createElement("div");
      inner.className = "rm-autocomplete-result";
      const label = doc.createElement("span");
      label.textContent = row.label || (row.kind === "drawing" ? "Drawing" : "Image");
      inner.append(label);
      line.append(inner);
      line.addEventListener("mousemove", (event) => {
        if (lastMouse && lastMouse[0] === event.clientX && lastMouse[1] === event.clientY) return;
        lastMouse = [event.clientX, event.clientY];
        active = index;
        paint();
      });
      line.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        finish({ row, full: !!event.shiftKey });
      });
      scroll.append(line);
    });
  };

  input.addEventListener("input", () => { active = 0; paint(); });
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (dead || event.isComposing) return;
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
    if (plain && event.key === "ArrowDown") { event.preventDefault(); active += 1; paint(); return; }
    if (plain && event.key === "ArrowUp") { event.preventDefault(); active = Math.max(0, active - 1); paint(); return; }
    if (event.key === "Escape") { event.preventDefault(); finish(null); return; }
    if (plain && event.key === "Enter") {
      event.preventDefault();
      const matches = filterInsertRows(rows, input.value);
      const row = matches[Math.max(0, Math.min(active, matches.length - 1))];
      if (row) finish({ row, full: !!event.shiftKey });
    }
  });
  root.addEventListener("pointerdown", (event) => event.stopPropagation());
  doc.body?.append?.(root);
  paint();
  try { input.focus(); } catch { /* the menu already closed */ }
  const handle = { close: () => finish(null) };
  open.set(doc, handle);
  return handle;
}
