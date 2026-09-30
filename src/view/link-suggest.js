import { parseNaturalDate } from "../model/dates.js";
import { applyPick, blockSnippet, buildPageRows, findTrigger, matchSegments, normalizeCreateTitle, stripTrigger } from "../model/suggest.js";

export const SUGGEST_SELECTOR = "textarea.excalidraw-wysiwyg, input.excalidraw-hyperlinkContainer-input, input.plexus-mm-input";

const ACTIVE_BG = "rgb(213, 218, 223)";
const ENTER_ICON = '<svg data-icon="key-enter" width="16" height="16" viewBox="0 0 16 16"><path d="M14 2v6c0 .55-.45 1-1 1H4.41l1.3-1.29a1.003 1.003 0 0 0-1.42-1.42l-3 3c-.18.18-.29.43-.29.71s.11.53.29.71l3 3a1.003 1.003 0 0 0 1.42-1.42L4.41 11H13c1.66 0 3-1.34 3-3V2c0-.55-.45-1-1-1s-1 .45-1 1z" fill-rule="evenodd"/></svg>';
const COPY_PROPS = ["direction", "boxSizing", "width", "height", "overflowX", "overflowY", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderStyle", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSize", "fontFamily", "lineHeight", "textAlign", "textTransform", "textIndent", "letterSpacing", "wordSpacing", "tabSize", "whiteSpace", "wordBreak", "overflowWrap"];

const warn = (what, error) => console.warn(`[plexus] link suggest ${what} failed`, error);
const same = (a, b) => !!a && !!b && a.kind === b.kind && a.start === b.start && a.query === b.query;

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
    let dead = false;

    const safe = (what, fn) => (e) => { try { return fn(e); } catch (error) { warn(what, error); } };
    const connected = () => el.isConnected !== false;

    const clearTimers = () => {
      if (timer != null) { clearT(timer); timer = null; }
      if (liveTimer != null) { clearT(liveTimer); liveTimer = null; }
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
      const isPage = trigger.kind === "page";
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
      footerTitle.textContent = isPage ? "Page search" : "Block search";
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
      if (status === "hint") message(isPage ? "Search for a page" : "Search for a block");
      else if (status === "error") message("Search failed");
      else if (!items.length) message(isPage ? "No pages found." : "No blocks found.");
      else {
        items.forEach((item, k) => {
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
        if (trig.kind === "page") {
          const res = await api.data.async.search({ "search-str": q, "search-pages": true, "search-blocks": false, limit: 12 });
          found = (res || []).map((r) => ({ kind: "page", title: r[":node/title"] ?? r.title, uid: r[":block/uid"] ?? r.uid }));
          found = await pageRows(q, found);
        } else {
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

    function setTrigger(next) {
      const kindChanged = !trigger || trigger.kind !== next.kind;
      seq++;
      if (timer != null) { clearT(timer); timer = null; }
      trigger = next;
      active = 0;
      if (kindChanged) { items = []; destroyRoot(); }
      if (!next.query.trim()) {
        items = [];
        status = "hint";
        render();
        return;
      }
      status = "loading";
      const mine = seq;
      timer = setT(() => {
        timer = null;
        if (mine !== seq || dead) return;
        if (!connected()) { detach(); return; }
        search(next, mine);
      }, debounce[next.kind] ?? 60);
    }

    function recheck(canOpen) {
      if (dead) return;
      const trig = findTrigger(el.value ?? "", el.selectionStart);
      if (!trig) { close(); return; }
      if (same(trig, trigger)) return;
      if (!canOpen && !trigger) return;
      setTrigger(trig);
    }

    function pick(item) {
      const text = el.value ?? "";
      const caret = el.selectionStart ?? text.length;
      const trig = findTrigger(text, caret);
      if (!trig) { close(); return; }
      const out = applyPick(text, caret, trig, item.kind === "block" ? { kind: "block", uid: item.uid } : { kind: "page", title: item.title });
      setValue(el, out.text);
      el.setSelectionRange?.(out.caret, out.caret);
      let ev;
      try {
        ev = new (view.InputEvent || view.Event)("input", { bubbles: true, inputType: "insertReplacementText" });
      } catch { ev = new view.Event("input", { bubbles: true }); }
      close();
      el.dispatchEvent(ev);
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
      const item = status === "results" ? items[active] : null;
      if (!item) return;
      const text = el.value ?? "";
      const caret = el.selectionStart ?? text.length;
      const trig = findTrigger(text, caret);
      if (!trig) { close(); return; }
      const isBlock = item.kind === "block";
      try {
        onEmbedPick({ kind: isBlock ? "block" : "page", ref: isBlock ? `((${item.uid}))` : `[[${item.title}]]`, title: isBlock ? item.str : item.title, uid: item.uid, create: item.kind === "create", el });
      } catch (error) { warn("embed pick", error); }
      const out = stripTrigger(text, caret, trig);
      setValue(el, out.text);
      el.setSelectionRange?.(out.caret, out.caret);
      let ev;
      try {
        ev = new (view.InputEvent || view.Event)("input", { bubbles: true, inputType: "insertReplacementText" });
      } catch { ev = new view.Event("input", { bubbles: true }); }
      el.dispatchEvent(ev);
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
    const onKeydown = safe("keydown", (e) => {
      if (!root || e.isComposing || e.keyCode === 229) return;
      const bare = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
      if (e.key === "Enter" && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && typeof onEmbedPick === "function" && isWysiwyg()) { embedPick(e); return; }
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
        if (status === "loading") return;
        if (status === "results" && items[active]) pick(items[active]);
        else if (status === "results" && trigger?.kind === "page" && trigger.query.trim()) pick({ kind: "page", title: trigger.query.trim() });
        else close();
      } else if (esc) close();
    });
    const onBlur = safe("blur", () => close());

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
