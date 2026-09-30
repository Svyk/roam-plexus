import { parseNaturalDate } from "../model/dates.js";
import { blockSnippet, buildPageRows, matchSegments, normalizeCreateTitle } from "../model/suggest.js";

export const TODAY_REF = "plexus:today";

const ACTIVE_BG = "rgb(213, 218, 223)";
const MIN_Z = 100003;
const WIDTH = 400;
const UID_RE = /^[A-Za-z0-9_-]{9}$/;
const SEMANTIC_TIMEOUT = 1500;

const warn = (what, error) => console.warn(`[plexus] embed picker ${what} failed`, error);
const open = new WeakMap();

// Standalone Roam-style search portal. The caller gets exactly one of onPick / onCreate, after the picker closed.
export function openEmbedPicker({
  doc, api, anchorRect, zIndex = 0, onPick, onCreate, onClose, semantic = false,
  now = () => new Date(),
  setTimeout: setT = (...a) => globalThis.setTimeout(...a),
  clearTimeout: clearT = (...a) => globalThis.clearTimeout(...a),
  requestFrame,
  debounce = { page: 60, block: 150 },
} = {}) {
  const existing = open.get(doc);
  if (existing) { existing.focus(); return existing.handle; }

  const view = doc.defaultView;
  const frame = requestFrame || ((fn) => (view?.requestAnimationFrame ? view.requestAnimationFrame(fn) : setT(fn, 0)));
  let items = [];
  let status = "hint";
  let active = 0;
  let seq = 0;
  let timer = null;
  let retakeTimer = null;
  let related = [];
  let query = "";
  let lastMouse = null;
  let rows = [];
  let dead = false;
  let retaken = false;
  let picked = false;

  const root = doc.createElement("div");
  root.className = "rm-autocomplete__results bp3-elevation-3 plexus-portal plexus-picker";
  root.style.zIndex = String(Math.max(zIndex || 0, MIN_Z));
  const input = doc.createElement("input");
  input.className = "plexus-portal plexus-picker-input";
  input.setAttribute("type", "text");
  input.setAttribute("placeholder", "Embed page or block");
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
  footerTitle.textContent = "Embed page or block";
  footer.append(footerTitle);
  main.append(scroll, footer);
  root.append(input, main);

  const stop = (e) => e.stopPropagation();
  root.addEventListener("pointerdown", stop);
  root.addEventListener("mousedown", (e) => { if (e.target !== input) e.preventDefault(); e.stopPropagation(); });
  root.addEventListener("click", stop);

  function place() {
    const a = anchorRect || { left: 100, top: 100 };
    let left = a.left ?? 100;
    let top = (a.bottom ?? a.top ?? 100) + 4;
    const h = root.getBoundingClientRect?.().height || root.offsetHeight || 300;
    const vh = view?.innerHeight || 0;
    const vw = view?.innerWidth || 0;
    if (vh && top + h > vh - 8) top = Math.max(8, (a.top ?? top) - h - 4);
    if (vw) left = Math.min(left, vw - WIDTH - 8);
    root.style.left = `${Math.max(8, left)}px`;
    root.style.top = `${top}px`;
  }

  const onWinPointer = (e) => { if (!(e?.target && root.contains?.(e.target))) close(); };
  const onWinResize = () => { try { place(); } catch (error) { warn("resize", error); } };

  function close() {
    if (dead) return;
    dead = true;
    seq++;
    if (timer != null) clearT(timer);
    if (retakeTimer != null) clearT(retakeTimer);
    timer = retakeTimer = null;
    view?.removeEventListener?.("pointerdown", onWinPointer, true);
    view?.removeEventListener?.("resize", onWinResize);
    root.remove();
    if (open.get(doc)?.handle === handle) open.delete(doc);
    try { onClose?.({ picked }); } catch (error) { warn("close callback", error); }
  }
  const handle = { close };

  function setActive(i, scrollTo) {
    active = i;
    rows.forEach((r, k) => { r.style.backgroundColor = k === i ? ACTIVE_BG : ""; });
    if (scrollTo) rows[i]?.scrollIntoView?.({ block: "nearest" });
  }

  function segs(parent, text) {
    for (const s of matchSegments(text, query)) {
      const span = doc.createElement("span");
      if (s.match) span.className = "rm-search-match";
      span.textContent = s.text;
      parent.append(span);
    }
  }

  function render() {
    if (dead) return;
    scroll.replaceChildren?.();
    rows = [];
    const message = (text) => {
      const row = doc.createElement("div");
      row.setAttribute("title", text);
      row.className = "dont-unfocus-block";
      Object.assign(row.style, { borderRadius: "2px", padding: "6px", color: "lightgray" });
      const inner = doc.createElement("div");
      inner.className = "rm-autocomplete-result";
      inner.textContent = text;
      row.append(inner);
      scroll.append(row);
    };
    const all = [...items, ...related];
    if (status === "hint") message("Search for a page or block");
    else if (status === "loading") message("Searching");
    else if (status === "error") message("Search failed");
    else if (!all.length) message("Nothing found.");
    else {
      all.forEach((item, k) => {
        if (item.kind === "block" && item.related && !all[k - 1]?.related) {
          const head = doc.createElement("div");
          head.className = "plexus-picker-header";
          head.textContent = "Related";
          scroll.append(head);
        }
        const row = doc.createElement("div");
        row.setAttribute("title", item.kind === "block" ? item.str : item.title);
        row.className = "dont-unfocus-block";
        Object.assign(row.style, { borderRadius: "2px", padding: "6px", cursor: "pointer" });
        const inner = doc.createElement("div");
        inner.className = "rm-autocomplete-result";
        const label = doc.createElement("span");
        if (item.kind === "create") label.textContent = `+ Create page ${item.title}`;
        else if (item.kind === "today") label.textContent = "Today (always today)";
        else segs(label, item.kind === "block" ? blockSnippet(item.str, query) : item.title);
        inner.append(label);
        row.append(inner);
        const subText = item.kind === "date" ? "Daily note" : item.kind === "block" ? item.pageTitle : "";
        if (subText) {
          const sub = doc.createElement("div");
          sub.className = "bp3-text-overflow-ellipsis";
          sub.style.color = "rgb(129, 145, 157)";
          sub.textContent = subText;
          row.append(sub);
        }
        row.addEventListener("mousemove", (e) => {
          if (lastMouse && lastMouse[0] === e.clientX && lastMouse[1] === e.clientY) return;
          lastMouse = [e.clientX, e.clientY];
          setActive(k, false);
        });
        row.addEventListener("click", (e) => { e.stopPropagation(); commit(item); });
        scroll.append(row);
        rows.push(row);
      });
    }
    setActive(Math.min(active, Math.max(rows.length - 1, 0)), false);
    place();
  }

  function commit(item) {
    if (dead || !item) return;
    picked = true;
    close();
    try {
      if (item.kind === "create") onCreate?.(item.title);
      else if (item.kind === "today") onPick?.({ kind: "today", ref: TODAY_REF, title: "Today" });
      else if (item.kind === "block") onPick?.({ kind: "block", ref: `((${item.uid}))`, title: item.str, uid: item.uid });
      else onPick?.({ kind: "page", ref: `[[${item.title}]]`, title: item.title, uid: item.uid });
    } catch (error) { warn("callback", error); }
  }

  const pageOf = (r) => ({ kind: "page", title: r[":node/title"] ?? r.title, uid: r[":block/uid"] ?? r.uid });
  const blockOf = async (r) => {
    const uid = r[":block/uid"] ?? r.uid;
    let pageTitle = "";
    try {
      const pulled = await api.data.pull("[{:block/page [:node/title]}]", [":block/uid", uid]);
      pageTitle = pulled?.[":block/page"]?.[":node/title"] ?? "";
    } catch { /* page title is decoration */ }
    return { kind: "block", uid, str: r[":block/string"] ?? r.string ?? "", pageTitle };
  };

  async function direct(q) {
    const m = /^(?:\(\()?([A-Za-z0-9_-]{9})(?:\)\))?$/.exec(q);
    if (!m || !UID_RE.test(m[1])) return null;
    try {
      const pulled = await api.data.pull("[:block/uid :block/string :node/title]", [":block/uid", m[1]]);
      if (!pulled) return null;
      if (pulled[":node/title"] != null) return { kind: "page", title: pulled[":node/title"], uid: m[1] };
      if (pulled[":block/string"] == null && pulled[":block/uid"] == null) return null;
      return { kind: "block", uid: m[1], str: pulled[":block/string"] ?? "", pageTitle: "" };
    } catch { return null; }
  }

  const todayRow = (q) => {
    const t = q.trim().toLowerCase();
    return !t || (t.length >= 2 && "today".startsWith(t));
  };

  async function withTimeout(promise) {
    let t;
    try {
      return await Promise.race([promise, new Promise((_, reject) => { t = setT(() => reject(new Error("timeout")), SEMANTIC_TIMEOUT); })]);
    } finally { if (t != null) clearT(t); }
  }

  async function search(raw, mine) {
    const blocksOnly = raw.startsWith("((");
    const pagesOnly = raw.startsWith("[[");
    const q = raw.replace(/^\(\(|^\[\[/, "").replace(/\)\)$|\]\]$/, "").trim();
    try {
      const wantPages = !blocksOnly;
      const wantBlocks = !pagesOnly;
      const [pageRes, blockRes, hit] = await Promise.all([
        wantPages ? api.data.async.search({ "search-str": q, "search-pages": true, "search-blocks": false, limit: 8 }) : [],
        wantBlocks ? api.data.async.search({ "search-str": q, "search-pages": false, "search-blocks": true, "hide-code-blocks": true, limit: 8 }) : [],
        direct(raw.replace(/\s+/g, "")),
      ]);
      const foundPages = (pageRes || []).map(pageOf);
      const foundBlocks = await Promise.all((blockRes || []).map(blockOf));
      let dateTitle = "";
      if (wantPages && !blocksOnly) {
        try {
          const date = parseNaturalDate(q, now());
          if (date && typeof api.util?.dateToPageTitle === "function") dateTitle = api.util.dateToPageTitle(date) || "";
        } catch (error) { warn("date row", error); }
      }
      const canCreate = wantPages && typeof onCreate === "function";
      const title = normalizeCreateTitle(q);
      let exists = false;
      if (canCreate && title && !foundPages.some((r) => r.title?.toLowerCase() === title.toLowerCase())) {
        try {
          const pulled = await api.data.pull("[:node/title]", [":node/title", title]);
          exists = !!pulled?.[":node/title"];
        } catch { /* a missing check only leaves the create row visible */ }
      }
      if (mine !== seq || dead) return;
      const pageRows = wantPages ? buildPageRows({ query: q, results: foundPages, dateTitle, canCreate: false, exists }) : [];
      const list = [];
      if (wantPages && todayRow(q)) list.push({ kind: "today" });
      if (hit && !list.some((r) => r.uid === hit.uid)) list.push(hit);
      const seen = new Set(list.map((r) => r.uid).filter(Boolean));
      for (const r of pageRows) if (!r.uid || !seen.has(r.uid)) list.push(r);
      for (const b of foundBlocks) if (!seen.has(b.uid)) list.push(b);
      if (canCreate && title && !exists && !pageRows.some((r) => r.title?.toLowerCase() === title.toLowerCase()) && !list.some((r) => r.kind === "date" && r.title.toLowerCase() === title.toLowerCase())) list.push({ kind: "create", title });
      items = list;
      related = [];
      status = "results";
      active = 0;
      query = q;
      render();
      if (semantic === true && wantBlocks) semanticSection(q, mine, new Set([...seen, ...foundBlocks.map((b) => b.uid)]));
    } catch (error) {
      if (mine !== seq || dead) return;
      warn("search", error);
      items = [];
      related = [];
      status = "error";
      render();
    }
  }

  async function semanticSection(q, mine, skip) {
    try {
      const fn = api.data?.async?.semanticSearch;
      if (typeof fn !== "function") return;
      const res = await withTimeout(Promise.resolve(fn.call(api.data.async, { "search-str": q, limit: 5 })));
      if (mine !== seq || dead) return;
      const out = [];
      for (const r of res || []) {
        const uid = r[":block/uid"] ?? r.uid;
        if (!uid || skip.has(uid)) continue;
        out.push({ kind: "block", uid, str: r[":block/string"] ?? r.string ?? r[":node/title"] ?? "", pageTitle: "", related: true });
      }
      if (!out.length) return;
      related = out;
      render();
    } catch { /* section stays hidden */ }
  }

  function onInput() {
    if (dead) return;
    const raw = String(input.value ?? "").trim();
    const q = raw.replace(/^\(\(|^\[\[/, "").replace(/\)\)$|\]\]$/, "").trim();
    seq++;
    if (timer != null) { clearT(timer); timer = null; }
    active = 0;
    related = [];
    query = q;
    if (!q) {
      items = raw ? [] : [{ kind: "today" }];
      status = raw ? "hint" : "results";
      render();
      return;
    }
    items = !raw.startsWith("((") && !raw.startsWith("[[") && todayRow(raw) ? [{ kind: "today" }] : [];
    status = items.length ? "results" : "loading";
    render();
    const mine = seq;
    timer = setT(() => {
      timer = null;
      if (mine !== seq || dead) return;
      search(raw, mine);
    }, raw.startsWith("[[") ? debounce.page ?? 60 : debounce.block ?? 150);
  }

  function onKeydown(e) {
    e.stopPropagation();
    if (dead || e.isComposing || e.keyCode === 229) return;
    const ctrlOnly = e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
    const bare = plain && !e.shiftKey;
    let move = 0;
    let doCommit = false;
    if (bare && e.key === "ArrowDown") move = 1;
    else if (bare && e.key === "ArrowUp") move = -1;
    else if (ctrlOnly && e.key === "n") move = 1;
    else if (ctrlOnly && e.key === "p") move = -1;
    else if (plain && (e.key === "Enter" || (bare && e.key === "Tab"))) doCommit = true;
    else if (e.key === "Escape") { e.preventDefault(); close(); return; }
    else return;
    e.preventDefault();
    if (move) {
      if (rows.length) setActive((active + move + rows.length) % rows.length, true);
    } else if (doCommit) {
      if (status === "loading") return;
      const all = [...items, ...related];
      if (status === "results" && all[active]) commit(all[active]);
    }
  }

  function onBlur() {
    if (dead) return;
    if (retakeTimer != null && !retaken) {
      retaken = true;
      input.focus?.({ preventScroll: true });
      return;
    }
    close();
  }

  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onKeydown);
  input.addEventListener("blur", onBlur);

  open.set(doc, { handle, focus: () => { try { input.focus?.({ preventScroll: true }); } catch { /* ignore */ } } });
  frame(() => {
    if (dead) return;
    try {
      doc.body.append(root);
      view?.addEventListener?.("pointerdown", onWinPointer, true);
      view?.addEventListener?.("resize", onWinResize);
      place();
      onInput();
      input.focus?.({ preventScroll: true });
      retakeTimer = setT(() => {
        retakeTimer = null;
        if (dead) return;
        if (!retaken && doc.activeElement !== input) { retaken = true; input.focus?.({ preventScroll: true }); }
      }, 200);
    } catch (error) { warn("open", error); close(); }
  });
  return handle;
}
