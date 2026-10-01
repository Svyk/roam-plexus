import { parseNaturalDate } from "../model/dates.js";
import { applyPick, blockSnippet, buildPageRows, findTrigger, matchSegments, normalizeCreateTitle, stripTrigger } from "../model/suggest.js";

export const SUGGEST_SELECTOR = "textarea.excalidraw-wysiwyg, input.excalidraw-hyperlinkContainer-input, input.plexus-mm-input";

const ACTIVE_BG = "rgb(213, 218, 223)";
const ENTER_ICON = '<svg data-icon="key-enter" width="16" height="16" viewBox="0 0 16 16"><path d="M14 2v6c0 .55-.45 1-1 1H4.41l1.3-1.29a1.003 1.003 0 0 0-1.42-1.42l-3 3c-.18.18-.29.43-.29.71s.11.53.29.71l3 3a1.003 1.003 0 0 0 1.42-1.42L4.41 11H13c1.66 0 3-1.34 3-3V2c0-.55-.45-1-1-1s-1 .45-1 1z" fill-rule="evenodd"/></svg>';
const COPY_PROPS = ["direction", "boxSizing", "width", "height", "overflowX", "overflowY", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderStyle", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSize", "fontFamily", "lineHeight", "textAlign", "textTransform", "textIndent", "letterSpacing", "wordSpacing", "tabSize", "whiteSpace", "wordBreak", "overflowWrap"];

const warn = (what, error) => console.warn(`[plexus] link suggest ${what} failed`, error);
const same = (a, b) => !!a && !!b && a.kind === b.kind && a.start === b.start && a.query === b.query;
const PAGE_RECENT_Q = "[:find ?title ?time :where [?p :node/title ?title] [?p :edit/time ?time]]";
const HASH_RECENT_Q = "[:find ?title ?time :where [?p :node/title ?title] [?p :edit/time ?time] [?b :block/refs ?p]]";
const REF_COUNT_Q = "[:find (count ?b) :in $ ?title :where [?p :node/title ?title] [?b :block/refs ?p]]";
const RELATED_MS = 150;
const RECENT_MS = 10_000;

function rankRecent(raw) {
  const ranked = [];
  const list = Array.isArray(raw) ? raw : [];
  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    if (!Array.isArray(row) || typeof row[0] !== "string" || !row[0]) continue;
    const time = typeof row[1] === "number" && Number.isFinite(row[1]) ? row[1] : 0;
    ranked.push({ title: row[0], time, i });
  }
  ranked.sort((a, b) => b.time - a.time || a.i - b.i);
  const seen = new Set();
  const out = [];
  for (const row of ranked) {
    if (seen.has(row.title)) continue;
    seen.add(row.title);
    out.push({ kind: "page", title: row.title });
    if (out.length >= 12) break;
  }
  return out;
}

function positiveCount(raw) {
  let found = 0;
  const walk = (v) => {
    if (typeof v === "number") { if (Number.isInteger(v) && v > found) found = v; }
    else if (Array.isArray(v)) for (const x of v) walk(x);
  };
  walk(raw);
  return found;
}

function setValue(el, v) {
  for (let p = Object.getPrototypeOf(el); p; p = Object.getPrototypeOf(p)) {
    const d = Object.getOwnPropertyDescriptor(p, "value");
    if (d?.set) { d.set.call(el, v); return; }
  }
  el.value = v;
}

function measureCaret(doc, el, caret) {
  const cs = doc.defaultView.getComputedStyle(el);
  const isInput = String(el.tagName).toUpperCase() === "INPUT";
  const mirror = doc.createElement("div");
  for (const p of COPY_PROPS) mirror.style[p] = cs[p];
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.top = "0px";
  mirror.style.left = "-9999px";
  mirror.style.whiteSpace = isInput ? "pre" : cs.whiteSpace || "pre-wrap";
  const value = el.value ?? "";
  mirror.textContent = value.slice(0, caret);
  const marker = doc.createElement("span");
  marker.textContent = value.slice(caret) || ".";
  mirror.append(marker);
  doc.body.append(mirror);
  try {
    const fontSize = Number.parseFloat(cs.fontSize) || 16;
    const lh = Number.parseFloat(cs.lineHeight);
    return { x: marker.offsetLeft || 0, y: marker.offsetTop || 0, lineHeight: Number.isFinite(lh) ? lh : fontSize * 1.2 };
  } finally {
    mirror.remove();
  }
}

export function createLinkSuggest({ doc, api, createPage, onEmbedPick, now = () => new Date(), zIndexFor = () => 1000, debounce = { page: 60, block: 150 }, setTimeout: setT = (...a) => globalThis.setTimeout(...a), clearTimeout: clearT = (...a) => globalThis.clearTimeout(...a) } = {}) {
  const view = doc.defaultView;
  const attached = new Set();
  let pageCache = null;
  let hashCache = null;

  function refCount(title) {
    if (typeof api.data?.q !== "function" || typeof title !== "string" || !title) return 0;
    try { return positiveCount(api.data.q(REF_COUNT_Q, title)); }
    catch { return 0; }
  }

  function recentItems(kind) {
    const hash = kind === "hash";
    const t = now().getTime();
    const hit = hash ? hashCache : pageCache;
    if (hit && t - hit.at < RECENT_MS) return hit.rows.slice();
    if (typeof api.data?.q !== "function") return [];
    let rows;
    try { rows = rankRecent(api.data.q(hash ? HASH_RECENT_Q : PAGE_RECENT_Q)); }
    catch (error) { warn("recent", error); return []; }
    const entry = { at: t, rows };
    if (hash) hashCache = entry;
    else pageCache = entry;
    return rows.slice();
  }

  function attach(el) {
    let trigger = null;
    let items = [];
    let status = "hint";
    let active = 0;
    let seq = 0;
    let timer = null;
    let liveTimer = null;
    let root = null;
    let scroll = null;
    let footerTitle = null;
    let lastMouse = null;
    let rows = [];
    let related = [];
    let relatedTimer = null;
    let stash = "";
    let stashArmed = false;
    let semanticOn = null;
    let dead = false;

    const safe = (what, fn) => (e) => { try { return fn(e); } catch (error) { warn(what, error); } };
    const connected = () => el.isConnected !== false;

    const clearTimers = () => {
      if (timer != null) { clearT(timer); timer = null; }
      if (liveTimer != null) { clearT(liveTimer); liveTimer = null; }
      if (relatedTimer != null) { clearT(relatedTimer); relatedTimer = null; }
    };

    const onWinScroll = safe("scroll", (e) => { if (root && !(e?.target && root.contains?.(e.target))) place(); });
    const onWinResize = safe("resize", () => { if (root) place(); });
    const onWinWheel = safe("wheel", (e) => { if (root && !(e?.target && root.contains?.(e.target))) close(); });

    function destroyRoot() {
      if (!root) return;
      view?.removeEventListener?.("resize", onWinResize);
      view?.removeEventListener?.("scroll", onWinScroll, true);
      view?.removeEventListener?.("wheel", onWinWheel, true);
      if (liveTimer != null) { clearT(liveTimer); liveTimer = null; }
      root.remove();
      root = scroll = footerTitle = null;
      rows = [];
    }

    function close() {
      seq++;
      clearTimers();
      trigger = null;
      items = [];
      related = [];
      if (!stashArmed) stash = "";
      destroyRoot();
    }

    function place() {
      if (!root || !connected()) return;
      const rect = el.getBoundingClientRect();
      const sx = rect.width / el.offsetWidth;
      const sy = rect.height / el.offsetHeight;
      const scale = Number.isFinite(sx) && sx > 0 ? sx : 1;
      const isInput = String(el.tagName).toUpperCase() === "INPUT";
      let left = rect.left;
      let top = rect.bottom + 4;
      let lineTop = rect.top;
      const rotated = Number.isFinite(sx) && Number.isFinite(sy) && Math.abs(sx - sy) > 0.02;
      if (!rotated) {
        const caret = measureCaret(doc, el, el.selectionStart ?? (el.value ?? "").length);
        left = rect.left + (caret.x - (el.scrollLeft || 0)) * scale;
        if (!isInput) {
          lineTop = rect.top + (caret.y - (el.scrollTop || 0)) * scale;
          top = lineTop + caret.lineHeight * scale + 4;
        }
      }
      const h = root.getBoundingClientRect?.().height || root.offsetHeight || 300;
      const vh = view.innerHeight || 0;
      const vw = view.innerWidth || 0;
      if (vh && top + h > vh - 8) top = Math.max(8, lineTop - h - 4);
      if (vw) left = Math.min(left, vw - 400 - 8);
      left = Math.max(8, left);
      root.style.left = `${left}px`;
      root.style.top = `${top}px`;
    }

    function setActive(i, scrollTo) {
      active = i;
      rows.forEach((r, k) => { r.style.backgroundColor = k === i ? ACTIVE_BG : ""; });
      if (scrollTo) rows[i]?.scrollIntoView?.({ block: "nearest" });
    }

    function segs(parent, text, query) {
      for (const s of matchSegments(text, query)) {
        const span = doc.createElement("span");
        if (s.match) span.className = "rm-search-match";
        span.textContent = s.text;
        parent.append(span);
      }
    }

    function render() {
      if (dead || !trigger) return;
      const kind = trigger.kind;
      const created = !root;
      if (created) {
        root = doc.createElement("div");
        root.className = "rm-autocomplete__results bp3-elevation-3 plexus-portal plexus-suggest";
        root.style.zIndex = String(Math.max((zIndexFor(el) || 0) + 10, 1010));
        root.addEventListener("pointerdown", (e) => e.stopPropagation());
        root.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
        root.addEventListener("click", (e) => e.stopPropagation());
        const main = doc.createElement("div");
        main.className = "rm-autocomplete__results-main";
        scroll = doc.createElement("div");
        scroll.className = "rm-autocomplete__results-scroll";
        const footer = doc.createElement("div");
        footer.className = "rm-autocomplete-footer";
        footerTitle = doc.createElement("div");
        footerTitle.className = "rm-autocomplete-footer__title";
        const actions = doc.createElement("div");
        actions.className = "rm-autocomplete-footer__actions";
        const action = doc.createElement("span");
        action.className = "rm-autocomplete-footer__action";
        const desc = doc.createElement("span");
        desc.className = "rm-autocomplete-footer__action__desc";
        desc.textContent = "Insert reference";
        const hotkey = doc.createElement("span");
        hotkey.className = "rm-autocomplete-footer__action__hotkey";
        const icon = doc.createElement("span");
        icon.className = "bp3-icon bp3-icon-key-enter rm-autocomplete-footer__action__hotkey__icon";
        icon.innerHTML = ENTER_ICON;
        hotkey.append(icon);
        action.append(desc, hotkey);
        actions.append(action);
        footer.append(footerTitle, actions);
        main.append(scroll, footer);
        root.append(main);
        doc.body.append(root);
        view?.addEventListener?.("resize", onWinResize);
        view?.addEventListener?.("scroll", onWinScroll, true);
        view?.addEventListener?.("wheel", onWinWheel, { capture: true, passive: true });
        scheduleLive();
      }
      footerTitle.textContent = kind === "hash" ? "Tag search" : kind === "page" ? "Page search" : "Block search";
      scroll.replaceChildren?.();
      rows = [];
      const message = (text, title) => {
        const row = doc.createElement("div");
        row.setAttribute("title", title ?? text);
        row.className = "dont-unfocus-block";
        Object.assign(row.style, { borderRadius: "2px", padding: "6px", color: "lightgray" });
        const inner = doc.createElement("div");
        inner.className = "rm-autocomplete-result";
        inner.textContent = text;
        row.append(inner);
        scroll.append(row);
      };
      const all = [...items, ...related];
      const hintText = kind === "block" ? "Search for a block" : "Search for a page";
      const noneText = kind === "block" ? "No blocks found." : "No pages found.";
      if (status === "hint") message(hintText);
      else if (status === "error") message("Search failed");
      else if (!all.length) message(noneText);
      else {
        all.forEach((item, k) => {
          if (k === items.length && related.length) {
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
          else segs(label, item.kind === "block" ? blockSnippet(item.str, trigger.query) : item.title, trigger.query);
          inner.append(label);
          if (item.kind === "page" || item.kind === "date") {
            const n = Number.isInteger(item.refs) ? item.refs : refCount(item.title);
            if (Number.isInteger(n) && n > 0) {
              const sup = doc.createElement("sup");
              sup.textContent = String(n);
              inner.append(sup);
            }
          }
          row.append(inner);
          if (item.kind === "date") {
            const sub = doc.createElement("div");
            sub.className = "bp3-text-overflow-ellipsis";
            sub.style.color = "rgb(129, 145, 157)";
            sub.textContent = "Daily note";
            row.append(sub);
          }
          if (item.kind === "block" && item.pageTitle) {
            const sub = doc.createElement("div");
            sub.className = "bp3-text-overflow-ellipsis";
            sub.style.color = "rgb(129, 145, 157)";
            sub.textContent = item.pageTitle;
            row.append(sub);
          }
          row.addEventListener("mousemove", safe("mousemove", (e) => {
            if (lastMouse && lastMouse[0] === e.clientX && lastMouse[1] === e.clientY) return;
            lastMouse = [e.clientX, e.clientY];
            setActive(k, false);
          }));
          row.addEventListener("click", safe("pick", (e) => { e.stopPropagation(); pick(item); }));
          scroll.append(row);
          rows.push(row);
        });
      }
      setActive(Math.min(active, Math.max(rows.length - 1, 0)), false);
      place();
    }

    function scheduleLive() {
      liveTimer = setT(() => {
        liveTimer = null;
        if (dead || !root) return;
        if (!connected()) { detach(); return; }
        scheduleLive();
      }, 300);
    }

    async function pageRows(q, found) {
      let dateTitle = "";
      try {
        const date = parseNaturalDate(q, now());
        if (date && typeof api.util?.dateToPageTitle === "function") dateTitle = api.util.dateToPageTitle(date) || "";
      } catch (error) { warn("date row", error); }
      const canCreate = typeof createPage === "function";
      const title = normalizeCreateTitle(q);
      let exists = false;
      if (canCreate && title && !found.some((r) => r.title?.toLowerCase() === title.toLowerCase())) {
        try {
          const pulled = await api.data.pull("[:node/title]", [":node/title", title]);
          exists = !!pulled?.[":node/title"];
        } catch { /* a missing check only leaves the create row visible */ }
      }
      return buildPageRows({ query: q, results: found, dateTitle, canCreate, exists });
    }

    async function search(trig, mine) {
      const q = trig.query.trim();
      try {
        let found;
        if (trig.kind === "block") {
          const res = await api.data.async.search({ "search-str": q, "search-pages": false, "search-blocks": true, "hide-code-blocks": true, limit: 12 });
          found = await Promise.all((res || []).map(async (r) => {
            const uid = r[":block/uid"] ?? r.uid;
            let pageTitle = "";
            try {
              const pulled = await api.data.pull("[{:block/page [:node/title]}]", [":block/uid", uid]);
              pageTitle = pulled?.[":block/page"]?.[":node/title"] ?? "";
            } catch { /* page title is decoration */ }
            return { kind: "block", uid, str: r[":block/string"] ?? r.string ?? "", pageTitle };
          }));
        } else if (trig.kind === "hash") {
          const res = await api.data.async.search({ "search-str": q, "search-pages": true, "search-blocks": false, limit: 12 });
          found = [];
          for (const r of res || []) {
            if (!r || typeof r !== "object") continue;
            const title = r[":node/title"] ?? r.title;
            if (typeof title !== "string" || !title) continue;
            const n = refCount(title);
            if (n > 0) found.push({ kind: "page", title, uid: r[":block/uid"] ?? r.uid, refs: n });
            if (found.length >= 12) break;
          }
        } else {
          const res = await api.data.async.search({ "search-str": q, "search-pages": true, "search-blocks": false, limit: 12 });
          found = (res || []).map((r) => ({ kind: "page", title: r[":node/title"] ?? r.title, uid: r[":block/uid"] ?? r.uid }));
          found = await pageRows(q, found);
        }
        if (mine !== seq || dead) return;
        if (!connected()) { detach(); return; }
        items = found;
        status = "results";
        active = 0;
        render();
      } catch (error) {
        if (mine !== seq || dead) return;
        warn("search", error);
        items = [];
        status = "error";
        render();
      }
    }

    function semanticEnabled() {
      if (semanticOn !== null && typeof semanticOn.then !== "function") return semanticOn;
      if (semanticOn && typeof semanticOn.then === "function") return semanticOn;
      try {
        const fn = api.data?.semanticSearchEnabled;
        const value = typeof fn === "function" ? fn.call(api.data) : false;
        if (value && typeof value.then === "function") {
          semanticOn = Promise.resolve(value).then(
            (v) => { semanticOn = v === true; return semanticOn; },
            () => { semanticOn = false; return false; },
          );
          return semanticOn;
        }
        semanticOn = value === true;
      } catch { semanticOn = false; }
      return semanticOn;
    }

    async function relatedSearch(q, mine) {
      try {
        const fn = api.data?.async?.semanticSearch;
        if (typeof fn !== "function") return;
        const res = await fn.call(api.data.async, { "search-str": q, limit: 5 });
        if (mine !== seq || dead) return;
        if (!connected()) { detach(); return; }
        const shown = new Set(items.map((it) => it.uid).filter(Boolean));
        const out = [];
        for (const r of res || []) {
          if (!r || typeof r !== "object") continue;
          const uid = r[":block/uid"] ?? r.uid;
          if (!uid || shown.has(uid)) continue;
          shown.add(uid);
          out.push({ kind: "block", uid, str: r[":block/string"] ?? r.string ?? r[":node/title"] ?? "", pageTitle: "", related: true });
        }
        if (!out.length) return;
        related = out;
        render();
      } catch (error) { warn("related", error); }
    }

    function setTrigger(next) {
      const kindChanged = !trigger || trigger.kind !== next.kind;
      seq++;
      if (timer != null) { clearT(timer); timer = null; }
      if (relatedTimer != null) { clearT(relatedTimer); relatedTimer = null; }
      related = [];
      trigger = next;
      active = 0;
      if (kindChanged) { items = []; destroyRoot(); }
      const mine = seq;
      const trimmed = next.query.trim();
      const delay = next.kind === "block" ? (debounce.block ?? 150) : (debounce.page ?? 60);
      if (!trimmed) {
        if (next.kind === "block") {
          items = [];
          status = "hint";
          render();
          return;
        }
        items = recentItems(next.kind);
        status = "results";
        render();
        return;
      }
      status = "loading";
      timer = setT(() => {
        timer = null;
        if (mine !== seq || dead) return;
        if (!connected()) { detach(); return; }
        search(next, mine);
      }, delay);
      if (next.kind === "page") {
        const arm = (on) => {
          if (!on || mine !== seq || dead || relatedTimer != null) return;
          relatedTimer = setT(() => {
            relatedTimer = null;
            if (mine !== seq || dead) return;
            relatedSearch(trimmed, mine);
          }, RELATED_MS);
        };
        const gate = semanticEnabled();
        if (gate && typeof gate.then === "function") gate.then(arm);
        else if (gate === true) arm(true);
      }
    }

    function recheck(canOpen) {
      if (dead) return;
      const trig = findTrigger(el.value ?? "", el.selectionStart);
      if (!trig) { close(); return; }
      if (same(trig, trigger)) return;
      if (!canOpen && !trigger) return;
      setTrigger(trig);
    }

    function dispatchInput() {
      let ev;
      try {
        ev = new (view.InputEvent || view.Event)("input", { bubbles: true, inputType: "insertReplacementText" });
      } catch { ev = new view.Event("input", { bubbles: true }); }
      el.dispatchEvent(ev);
    }

    function pick(item) {
      const text = el.value ?? "";
      const caret = el.selectionStart ?? text.length;
      const trig = findTrigger(text, caret);
      if (!trig) { close(); return; }
      const picked = item.kind === "block" ? { kind: "block", uid: item.uid } : { kind: "page", title: item.title };
      const out = applyPick(text, caret, trig, picked, stash);
      stashArmed = false;
      setValue(el, out.text);
      el.setSelectionRange?.(out.caret, out.caret);
      close();
      dispatchInput();
      if (el.value === out.text) el.setSelectionRange?.(out.caret, out.caret);
      if (item.kind === "create") {
        try {
          Promise.resolve(createPage(item.title)).catch((error) => warn("create page", error));
        } catch (error) { warn("create page", error); }
      }
    }

    const isWysiwyg = () => String(el.tagName).toUpperCase() === "TEXTAREA" && (el.classList?.contains?.("excalidraw-wysiwyg") || /(^|\s)excalidraw-wysiwyg(\s|$)/.test(el.className || ""));

    function embedPick(e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const item = status === "results" ? [...items, ...related][active] : null;
      if (!item) return;
      const text = el.value ?? "";
      const caret = el.selectionStart ?? text.length;
      const trig = findTrigger(text, caret);
      if (!trig) { close(); return; }
      const isBlock = item.kind === "block";
      const picked = isBlock ? { kind: "block", uid: item.uid } : { kind: "page", title: item.title };
      const applied = applyPick(text, caret, trig, picked, stash);
      const ref = applied.text.slice(trig.start, applied.caret);
      try {
        onEmbedPick({ kind: isBlock ? "block" : "page", ref, title: isBlock ? item.str : item.title, uid: item.uid, create: item.kind === "create", el });
      } catch (error) { warn("embed pick", error); }
      const out = stripTrigger(text, caret, trig);
      setValue(el, out.text);
      el.setSelectionRange?.(out.caret, out.caret);
      dispatchInput();
      close();
      el.blur?.();
    }

    const onInput = safe("input", (e) => {
      if (e?.isComposing) return;
      recheck(true);
    });
    const onRecheck = safe("recheck", (e) => {
      if (e?.type === "keyup" && !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      if (trigger) recheck(false);
    });
    const completesPair = (text, caret, key) => {
      if ((key !== "[" && key !== "(") || caret < 1 || text[caret - 1] !== key) return false;
      return !(caret >= 2 && text[caret - 2] === key);
    };
    // A second [ or ( closes the pair. A selection stashes an alias until close().
    const onKeydown = safe("keydown", (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      const text = el.value ?? "";
      const caret = Number.isInteger(el.selectionStart) ? el.selectionStart : text.length;
      const end = Number.isInteger(el.selectionEnd) ? el.selectionEnd : caret;
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
      if (plain && (e.key === "[" || e.key === "(") && caret !== end) { stash = text.slice(Math.min(caret, end), Math.max(caret, end)); stashArmed = true; }
      else if (plain && caret === end && completesPair(text, caret, e.key)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const closer = e.key === "[" ? "]" : ")";
        // The opener is already before the caret; the key plus both closers makes [[]] or (()).
        const next = text.slice(0, caret) + e.key + closer + closer + text.slice(caret);
        const pos = caret + 1;
        setValue(el, next);
        el.setSelectionRange?.(pos, pos);
        dispatchInput();
        if (el.value === next) el.setSelectionRange?.(pos, pos);
        return;
      } else if (plain && typeof e.key === "string" && e.key.length === 1) { stash = ""; stashArmed = false; }
      else if (e.key === "Backspace" || e.key === "Delete") { stash = ""; stashArmed = false; }
      if (!root) return;
      const bare = plain && !e.shiftKey;
      if (e.key === "Enter" && e.shiftKey && plain && typeof onEmbedPick === "function" && isWysiwyg()) { embedPick(e); return; }
      const ctrlOnly = e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
      let move = 0;
      let commit = false;
      let esc = false;
      if (bare && e.key === "ArrowDown") move = 1;
      else if (bare && e.key === "ArrowUp") move = -1;
      else if (ctrlOnly && e.key === "n") move = 1;
      else if (ctrlOnly && e.key === "p") move = -1;
      else if (bare && (e.key === "Enter" || e.key === "Tab")) commit = true;
      else if (bare && e.key === "Escape") esc = true;
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (move) {
        if (rows.length) setActive((active + move + rows.length) % rows.length, true);
      } else if (commit) {
        const choice = [...items, ...related][active];
        if (status === "loading") return;
        if (status === "results" && choice) pick(choice);
        else if (status === "results" && trigger?.kind === "page" && trigger.query.trim()) pick({ kind: "page", title: trigger.query.trim() });
        else close();
      } else if (esc) { stashArmed = false; close(); }
    });
    const onBlur = safe("blur", () => { stashArmed = false; close(); });

    el.addEventListener("input", onInput);
    el.addEventListener("keydown", onKeydown, true);
    el.addEventListener("keyup", onRecheck);
    el.addEventListener("click", onRecheck);
    el.addEventListener("blur", onBlur);

    function detach() {
      if (dead) return;
      close();
      dead = true;
      el.removeEventListener("input", onInput);
      el.removeEventListener("keydown", onKeydown, true);
      el.removeEventListener("keyup", onRecheck);
      el.removeEventListener("click", onRecheck);
      el.removeEventListener("blur", onBlur);
      attached.delete(detach);
    }
    attached.add(detach);
    return detach;
  }

  return {
    attach,
    dispose() { for (const d of [...attached]) d(); },
  };
}

export function installSuggestAutoAttach({ doc, suggest, setTimeout: setT = (...a) => globalThis.setTimeout(...a), clearTimeout: clearT = (...a) => globalThis.clearTimeout(...a) }) {
  let current = null;
  let currentEl = null;
  let offBlur = null;
  let pending = null;

  const release = () => {
    if (pending != null) { clearT(pending); pending = null; }
    offBlur?.();
    offBlur = null;
    current?.();
    current = null;
    currentEl = null;
  };

  const onFocusIn = (e) => {
    try {
      const t = e.target;
      if (!t || t === currentEl || !t.matches?.(SUGGEST_SELECTOR)) return;
      if (!t.closest?.(".excalidraw-outer-container") && !t.classList?.contains("plexus-portal")) return;
      release();
      currentEl = t;
      current = suggest.attach(t);
      const onOut = () => {
        if (pending != null) clearT(pending);
        pending = setT(() => {
          pending = null;
          if (doc.activeElement === t) return;
          if (currentEl === t) release();
        }, 0);
      };
      t.addEventListener("focusout", onOut);
      offBlur = () => t.removeEventListener("focusout", onOut);
    } catch (error) {
      console.warn("[plexus] link suggest attach failed", error);
    }
  };

  doc.addEventListener("focusin", onFocusIn, true);
  return () => {
    doc.removeEventListener("focusin", onFocusIn, true);
    release();
  };
}
