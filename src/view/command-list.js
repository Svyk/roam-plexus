const ACTIVE_BG = "rgb(213, 218, 223)";
const MIN_Z = 100003;

const warn = (what, ...rest) => console.warn(`[plexus] ${what}`, ...rest);
const open = new WeakMap();

export function filterCommands(commands, query) {
  const tokens = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [...commands];
  return commands.filter((c) => {
    const label = String(c.label ?? "").toLowerCase();
    return tokens.every((t) => label.includes(t));
  });
}

// The single Plexus palette entry opens this list, so Roam's keydown handler pays for two palette commands instead of 23.
export function openCommandList({
  doc, commands = [], ctx = {}, zIndex = 0, onClose,
  setTimeout: setT = (...a) => globalThis.setTimeout(...a),
} = {}) {
  const existing = open.get(doc);
  if (existing) { existing.focus(); return existing.handle; }

  let dead = false;
  let active = 0;
  let rows = [];
  let matches = [];
  let lastMouse = null;

  const root = doc.createElement("div");
  root.className = "rm-autocomplete__results bp3-elevation-3 plexus-portal plexus-picker plexus-cmdlist";
  root.style.zIndex = String(Math.max(zIndex || 0, MIN_Z));
  const input = doc.createElement("input");
  input.className = "plexus-portal plexus-picker-input";
  input.setAttribute("type", "text");
  input.setAttribute("placeholder", "Plexus command");
  input.setAttribute("spellcheck", "false");
  input.setAttribute("autocomplete", "off");
  const main = doc.createElement("div");
  main.className = "rm-autocomplete__results-main";
  const scroll = doc.createElement("div");
  scroll.className = "rm-autocomplete__results-scroll";
  const footer = doc.createElement("div");
  footer.className = "rm-autocomplete-footer";
  const footerTitle = doc.createElement("div");
  footerTitle.className = "rm-autocomplete-footer__title";
  footerTitle.textContent = "Plexus commands";
  footer.append(footerTitle);
  main.append(scroll, footer);
  root.append(input, main);

  const stop = (e) => e.stopPropagation();
  root.addEventListener("pointerdown", stop);
  root.addEventListener("mousedown", (e) => { if (e.target !== input) e.preventDefault(); e.stopPropagation(); });
  root.addEventListener("click", stop);

  const onDocPointer = (e) => { if (!(e?.target && root.contains?.(e.target))) close(); };

  function close() {
    if (dead) return;
    dead = true;
    doc.removeEventListener?.("pointerdown", onDocPointer, true);
    root.remove();
    if (open.get(doc)?.handle === handle) open.delete(doc);
    try { onClose?.(); } catch (error) { warn("command list close callback failed", error); }
  }
  const focus = () => { try { input.focus?.({ preventScroll: true }); } catch { /* focus is best effort */ } };
  const handle = { close, focus };

  function setActive(i, scrollTo) {
    active = i;
    rows.forEach((r, k) => { r.style.backgroundColor = k === i ? ACTIVE_BG : ""; });
    if (scrollTo) rows[i]?.scrollIntoView?.({ block: "nearest" });
  }

  function run(cmd) {
    if (dead || !cmd) return;
    close();
    setT(() => {
      try {
        const out = cmd.run(ctx);
        if (out && typeof out.catch === "function") out.catch((error) => warn("command failed", cmd.id, error));
      } catch (error) { warn("command failed", cmd.id, error); }
    }, 0);
  }

  function render() {
    if (dead) return;
    scroll.replaceChildren?.();
    rows = [];
    matches = filterCommands(commands, input.value);
    if (!matches.length) {
      const row = doc.createElement("div");
      row.className = "dont-unfocus-block plexus-cmdlist-empty";
      Object.assign(row.style, { borderRadius: "2px", padding: "6px" });
      const inner = doc.createElement("div");
      inner.className = "rm-autocomplete-result";
      inner.textContent = "No matching command";
      row.append(inner);
      scroll.append(row);
    }
    matches.forEach((cmd, k) => {
      const row = doc.createElement("div");
      row.setAttribute("title", cmd.label);
      row.className = "dont-unfocus-block";
      Object.assign(row.style, { borderRadius: "2px", padding: "6px", cursor: "pointer" });
      const inner = doc.createElement("div");
      inner.className = "rm-autocomplete-result";
      const label = doc.createElement("span");
      label.textContent = cmd.label;
      inner.append(label);
      if (cmd.hotkey) {
        const kbd = doc.createElement("kbd");
        kbd.className = "plexus-cmdlist-kbd";
        kbd.textContent = cmd.hotkey;
        inner.append(kbd);
      }
      row.append(inner);
      row.addEventListener("mousemove", (e) => {
        if (lastMouse && lastMouse[0] === e.clientX && lastMouse[1] === e.clientY) return;
        lastMouse = [e.clientX, e.clientY];
        setActive(k, false);
      });
      row.addEventListener("click", (e) => { e.stopPropagation(); run(cmd); });
      scroll.append(row);
      rows.push(row);
    });
    setActive(Math.min(active, Math.max(rows.length - 1, 0)), false);
  }

  function onInput() {
    if (dead) return;
    active = 0;
    render();
  }

  function onKeydown(e) {
    e.stopPropagation();
    if (dead || e.isComposing || e.keyCode === 229) return;
    const ctrlOnly = e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
    const bare = plain && !e.shiftKey;
    let move = 0;
    let doRun = false;
    if (bare && e.key === "ArrowDown") move = 1;
    else if (bare && e.key === "ArrowUp") move = -1;
    else if (ctrlOnly && e.key === "n") move = 1;
    else if (ctrlOnly && e.key === "p") move = -1;
    else if (plain && e.key === "Enter") doRun = true;
    else if (e.key === "Escape") { e.preventDefault(); close(); return; }
    else return;
    e.preventDefault();
    if (move) {
      if (rows.length) setActive((active + move + rows.length) % rows.length, true);
    } else if (doRun) run(matches[active]);
  }

  function onBlur() {
    if (dead) return;
    setT(() => {
      if (dead) return;
      const a = doc.activeElement;
      if (!a || !root.contains?.(a)) close();
    }, 0);
  }

  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onKeydown);
  input.addEventListener("keyup", stop);
  input.addEventListener("keypress", stop);
  input.addEventListener("blur", onBlur);

  open.set(doc, { handle, focus });
  try {
    doc.body.append(root);
    doc.addEventListener?.("pointerdown", onDocPointer, true);
    render();
    setT(() => { if (!dead) focus(); }, 0);
  } catch (error) { warn("command list open failed", error); close(); }
  return handle;
}
