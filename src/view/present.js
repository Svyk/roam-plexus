// Full-screen slide presenter on a modal <dialog>. Keys are handled on the dialog only.
const NEXT_KEYS = new Set(["ArrowRight", "PageDown", " ", "Spacebar", "Enter"]);
const PREV_KEYS = new Set(["ArrowLeft", "PageUp", "Backspace"]);
const NOTES_CHILD_CAP = 30;
const NOTES_DEPTH = 2;
const NOTICE_MS = 4000;
const DEFAULT_COLOR = "#e03131";
const DEFAULT_DECAY_MS = 1000;
const PEN_WIDTH = 3;
const LASER_WIDTH = 5;
// Roam renders links, refs and checkboxes as live controls; in the pane they must do nothing.
const INERT_SELECTOR = "a, .rm-page-ref, .rm-block-ref, .rm-alias, [data-link-title], [data-link-uid], input, label, .check-container";

const warn = (msg, error) => console.warn(`[plexus] ${msg}`, error);
const safe = (fn) => { try { return fn(); } catch (error) { warn("present read failed", error); return null; } };
const within = (node, root) => {
  for (let n = node; n; n = n.parentNode) if (n === root) return true;
  return false;
};
const hasText = (children) => (children || []).some((c) => String(c?.string ?? "").trim() || hasText(c?.children));

export function createPresenter({ doc, api, host, raf, caf, now, dpr, setTimer, clearTimer }) {
  let current = null;
  const view = doc.defaultView;
  const requestFrame = raf ?? ((cb) => (typeof view?.requestAnimationFrame === "function" ? view.requestAnimationFrame(cb) : setTimeout(cb, 16)));
  const cancelFrame = caf ?? ((id) => (typeof view?.cancelAnimationFrame === "function" ? view.cancelAnimationFrame(id) : clearTimeout(id)));
  const clock = now ?? (() => globalThis.performance?.now?.() ?? Date.now());
  const ratio = dpr ?? (() => Number(view?.devicePixelRatio) || 1);
  const later = setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const unlater = clearTimer ?? ((id) => clearTimeout(id));

  const close = () => {
    const state = current;
    if (!state) return;
    current = null;
    state.teardown();
    state.dialog.removeEventListener?.("keydown", state.onKey);
    state.dialog.removeEventListener?.("keyup", state.onKeyUp);
    state.dialog.removeEventListener?.("click", state.onClick);
    state.dialog.removeEventListener?.("cancel", state.onCancel);
    state.dialog.removeEventListener?.("close", state.onClosed);
    try { if (state.dialog.open) state.dialog.close?.(); } catch (error) { console.warn("[plexus] dialog close failed", error); }
    state.preload.src = "";
    state.dialog.remove();
    try { state.onClose?.(); } catch (error) { console.warn("[plexus] present close hook failed", error); }
  };

  return {
    isOpen: () => !!current,
    close,
    dispose: close,
    // slides: [{ name, url|null, notes?: { rootUid, onAdd? } }]. Returns a handle; setSlide fills a slide that was not ready yet.
    open({ slides, index = 0, onClose, laser } = {}) {
      close();
      const list = slides.map((s) => ({ name: s.name ?? "", url: s.url ?? null, notes: s.notes }));
      const color = /^#[0-9a-f]{6}$/i.test(laser?.color ?? "") ? laser.color : DEFAULT_COLOR;
      const decay = Number(laser?.decay) > 0 ? Number(laser.decay) : DEFAULT_DECAY_MS;

      const dialog = doc.createElement("dialog");
      dialog.className = "plexus-portal plexus-present";
      dialog.setAttribute("aria-label", "Presentation");
      dialog.tabIndex = -1;
      const img = doc.createElement("img");
      img.className = "plexus-present-slide";
      img.draggable = false;
      img.alt = "";
      const wait = doc.createElement("div");
      wait.className = "plexus-present-wait";
      wait.textContent = "Rendering...";
      const hud = doc.createElement("div");
      hud.className = "plexus-present-hud";
      const canvas = doc.createElement("canvas");
      canvas.className = "plexus-present-canvas";
      const bar = doc.createElement("div");
      bar.className = "plexus-present-progress";
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-label", "Slide progress");
      bar.setAttribute("aria-valuemin", "1");
      bar.setAttribute("aria-valuemax", String(list.length));
      const fill = doc.createElement("div");
      fill.className = "plexus-present-progress-fill";
      bar.append(fill);
      const controls = doc.createElement("div");
      controls.className = "plexus-present-controls";
      const pane = doc.createElement("div");
      pane.className = "plexus-present-notes";
      pane.tabIndex = 0;
      pane.hidden = true;
      pane.setAttribute("aria-label", "Speaker notes");
      const status = doc.createElement("div");
      status.className = "plexus-present-status";
      status.setAttribute("role", "status");
      status.hidden = true;
      const button = (label, name, title) => {
        const b = doc.createElement("button");
        b.type = "button";
        b.className = `plexus-present-tool plexus-present-tool-${name}`;
        b.textContent = label;
        b.title = title;
        b.setAttribute("aria-pressed", "false");
        controls.append(b);
        return b;
      };
      const notesBtn = button("Notes", "notes", "Notes (N)");
      const laserBtn = button("Laser", "laser", "Laser (L)");
      const penBtn = button("Pen", "pen", "Pen (P)");
      // Loading text shows only while the current slide has no image; a loaded image always clears it.
      img.addEventListener?.("load", () => { if (list[at]?.url) wait.hidden = true; });
      dialog.append(img, wait, canvas, hud, bar, controls, pane, status);
      const preload = doc.createElement("img");
      let at = Math.min(Math.max(0, index), list.length - 1);
      let notesOpen = false;
      let tool = null;
      let gen = 0;
      let watchOff = null;
      const noteHosts = new Set();
      let noticeTimer = null;
      let frame = null;
      let trail = [];
      let strokes = [];
      let stroke = null;
      let cssW = 0;
      let cssH = 0;
      const ctx = safe(() => canvas.getContext?.("2d")) ?? null;
      const live = () => current?.dialog === dialog;

      // ----- notes pane -----
      const unmountNotes = () => {
        for (const el of noteHosts) {
          try { api?.ui?.components?.unmountNode?.({ el }); } catch (error) { warn("unmount failed", error); }
          el.remove?.();
        }
        noteHosts.clear();
      };
      const stopNotes = () => {
        gen += 1;
        const off = watchOff;
        watchOff = null;
        if (off) { try { off(); } catch (error) { warn("notes watch dispose failed", error); } }
        unmountNotes();
      };
      const notice = (text) => {
        if (!live()) return;
        status.textContent = String(text ?? "");
        status.hidden = !status.textContent;
        if (noticeTimer != null) unlater(noticeTimer);
        noticeTimer = later(() => { noticeTimer = null; status.textContent = ""; status.hidden = true; }, NOTICE_MS);
      };
      const paintNotes = (slide) => {
        unmountNotes();
        pane.textContent = "";
        const rootUid = slide.notes?.rootUid;
        const content = rootUid && host?.pullEmbedContent ? safe(() => host.pullEmbedContent(`((${rootUid}))`)) : null;
        const children = content?.children ?? [];
        if (!hasText(children)) {
          const empty = doc.createElement("div");
          empty.className = "plexus-present-notes-empty";
          empty.textContent = "No notes";
          pane.append(empty);
          if (slide.notes?.onAdd) {
            const add = doc.createElement("button");
            add.type = "button";
            add.className = "plexus-present-notes-add";
            add.textContent = "Add notes";
            add.addEventListener("click", async (e) => {
              e?.stopPropagation?.();
              add.disabled = true;
              try {
                const out = await slide.notes.onAdd();
                if (out?.regionUid) {
                  slide.notes = { rootUid: out.regionUid };
                  notice("Notes added. Write them after the presentation");
                } else notice("Could not add notes");
              } catch (error) {
                warn("add notes failed", error);
                notice("Could not add notes");
              }
              if (live() && notesOpen && list[at] === slide) renderNotes();
            });
            pane.append(add);
          }
          return;
        }
        let budget = NOTES_CHILD_CAP;
        const walk = (nodes, depth) => {
          for (const child of nodes || []) {
            if (budget <= 0) return;
            budget -= 1;
            const el = doc.createElement("div");
            el.className = `plexus-present-note plexus-present-note-d${depth}`;
            pane.append(el);
            noteHosts.add(el);
            try {
              api.ui.components.renderString({ el, string: child.string ?? "" });
            } catch (error) {
              warn("notes render failed", error);
              el.textContent = child.string ?? "";
            }
            if (depth < NOTES_DEPTH) walk(child.children, depth + 1);
          }
        };
        walk(children, 1);
      };
      function renderNotes() {
        stopNotes();
        if (!notesOpen) return;
        const myGen = gen;
        const slide = list[at];
        paintNotes(slide);
        const rootUid = slide.notes?.rootUid;
        if (rootUid && host?.watchEmbed) {
          watchOff = host.watchEmbed(rootUid, () => {
            if (gen !== myGen || !live() || list[at] !== slide) return;
            paintNotes(slide);
          });
        }
      }
      // Capture phase on the pane: a ref or link click must never reach Roam, which would navigate and destroy the editor.
      const onPaneClick = (e) => {
        const t = e.target;
        if (t?.closest?.(INERT_SELECTOR)) {
          e.preventDefault?.();
          e.stopPropagation?.();
        }
      };
      pane.addEventListener("click", onPaneClick, true);

      // ----- laser and pen canvas -----
      const clearCanvas = () => { ctx?.clearRect?.(0, 0, cssW, cssH); };
      const draw = (t) => {
        if (!ctx) return;
        clearCanvas();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = PEN_WIDTH;
        ctx.globalAlpha = 1;
        for (const s of strokes) {
          if (!s.length) continue;
          ctx.beginPath();
          ctx.moveTo(s[0].x, s[0].y);
          if (s.length === 1) ctx.lineTo(s[0].x + 0.01, s[0].y);
          for (let i = 1; i < s.length; i++) ctx.lineTo(s[i].x, s[i].y);
          ctx.stroke();
        }
        ctx.lineWidth = LASER_WIDTH;
        for (let i = 1; i < trail.length; i++) {
          ctx.globalAlpha = Math.max(0, 1 - (t - trail[i].t) / decay);
          ctx.beginPath();
          ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
          ctx.lineTo(trail[i].x, trail[i].y);
          ctx.stroke();
        }
        const last = trail[trail.length - 1];
        if (last) {
          ctx.globalAlpha = Math.max(0, 1 - (t - last.t) / decay);
          ctx.beginPath();
          ctx.arc(last.x, last.y, LASER_WIDTH * 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      };
      const stopFrame = () => {
        if (frame != null) { cancelFrame(frame); frame = null; }
      };
      const tickFrame = () => {
        frame = null;
        if (!live()) return;
        const t = clock();
        while (trail.length && t - trail[0].t >= decay) trail.shift();
        draw(t);
        if (trail.length) frame = requestFrame(tickFrame);
      };
      const wipe = () => {
        stopFrame();
        trail = [];
        strokes = [];
        stroke = null;
        clearCanvas();
      };
      const sizeCanvas = () => {
        const rect = safe(() => canvas.getBoundingClientRect?.()) ?? {};
        cssW = rect.width || 0;
        cssH = rect.height || 0;
        const d = ratio();
        canvas.width = Math.round(cssW * d);
        canvas.height = Math.round(cssH * d);
        ctx?.setTransform?.(d, 0, 0, d, 0, 0);
        // A resize wipes the backing store, so the pen is gone with it.
        wipe();
      };
      const setTool = (name) => {
        tool = tool === name ? null : name;
        wipe();
        canvas.style.pointerEvents = tool ? "auto" : "none";
        canvas.style.touchAction = tool ? "none" : "";
        laserBtn.setAttribute("aria-pressed", String(tool === "laser"));
        penBtn.setAttribute("aria-pressed", String(tool === "pen"));
        dialog.setAttribute("data-tool", tool ?? "");
      };
      const point = (e) => {
        const rect = safe(() => canvas.getBoundingClientRect?.()) ?? {};
        return { x: (e.clientX ?? 0) - (rect.left || 0), y: (e.clientY ?? 0) - (rect.top || 0) };
      };
      const onPointerMove = (e) => {
        if (tool === "laser") {
          trail.push({ ...point(e), t: clock() });
          if (frame == null) frame = requestFrame(tickFrame);
        } else if (tool === "pen" && stroke) {
          stroke.push(point(e));
          draw(clock());
        }
      };
      const onPointerDown = (e) => {
        if (tool !== "pen") return;
        try { canvas.setPointerCapture?.(e.pointerId); } catch (error) { warn("pointer capture failed", error); }
        stroke = [point(e)];
        strokes.push(stroke);
        draw(clock());
      };
      const onPointerUp = () => { stroke = null; };
      canvas.style.pointerEvents = "none";
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointerup", onPointerUp);
      canvas.addEventListener("pointercancel", onPointerUp);
      const onResize = () => { if (live()) sizeCanvas(); };
      view?.addEventListener?.("resize", onResize);

      const setNotes = (open) => {
        notesOpen = open;
        pane.hidden = !open;
        notesBtn.setAttribute("aria-pressed", String(open));
        if (open) dialog.setAttribute("data-notes", "1");
        else dialog.removeAttribute("data-notes");
        sizeCanvas();
        renderNotes();
      };

      // ----- slides -----
      const show = () => {
        const slide = list[at];
        hud.textContent = `${at + 1} / ${list.length} · ${slide.name}`;
        bar.setAttribute("aria-valuenow", String(at + 1));
        fill.style.width = `${((at + 1) / list.length) * 100}%`;
        if (slide.url) {
          img.src = slide.url;
          img.hidden = false;
          wait.hidden = true;
        } else {
          wait.textContent = slide.error ? "Could not render this slide" : "Rendering...";
          img.removeAttribute?.("src");
          img.hidden = true;
          wait.hidden = false;
        }
        const next = list[at + 1];
        if (next?.url) preload.src = next.url;
      };
      const go = (to) => {
        const clamped = Math.min(list.length - 1, Math.max(0, to));
        if (clamped === at) return;
        at = clamped;
        wipe();
        show();
        renderNotes();
      };
      const onKey = (e) => {
        const inPane = within(e.target, pane);
        let handled = false;
        if (!inPane) {
          const plain = !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat && !e.isComposing;
          const onButton = e.target?.tagName === "BUTTON" && (e.key === "Enter" || e.key === " " || e.key === "Spacebar");
          const k = typeof e.key === "string" ? e.key.toLowerCase() : "";
          handled = true;
          if (onButton) handled = false;
          else if (NEXT_KEYS.has(e.key)) go(at + 1);
          else if (PREV_KEYS.has(e.key)) go(at - 1);
          else if (e.key === "Home") go(0);
          else if (e.key === "End") go(list.length - 1);
          else if (plain && k === "n") setNotes(!notesOpen);
          else if (plain && k === "l") setTool("laser");
          else if (plain && k === "p") setTool("pen");
          else handled = false;
        }
        if (handled) e.preventDefault?.();
        // Nothing typed in the dialog may reach Roam or Excalidraw document handlers; Esc/Tab stay native.
        if (e.key !== "Escape" && e.key !== "Tab") e.stopPropagation?.();
      };
      const onKeyUp = (e) => e.stopPropagation?.();
      const onClick = (e) => {
        e.stopPropagation?.();
        const t = e.target;
        if (tool || within(t, pane) || within(t, controls) || within(t, canvas)) return;
        const width = dialog.getBoundingClientRect?.().width || doc.defaultView?.innerWidth || 0;
        const left = dialog.getBoundingClientRect?.().left || 0;
        go(e.clientX - left < width / 2 ? at - 1 : at + 1);
      };
      const onCancel = (e) => {
        e.preventDefault?.();
        close();
      };
      const onClosed = () => close();
      notesBtn.addEventListener("click", () => setNotes(!notesOpen));
      laserBtn.addEventListener("click", () => setTool("laser"));
      penBtn.addEventListener("click", () => setTool("pen"));
      dialog.addEventListener("keydown", onKey);
      dialog.addEventListener("keyup", onKeyUp);
      dialog.addEventListener("click", onClick);
      dialog.addEventListener("cancel", onCancel);
      dialog.addEventListener("close", onClosed);
      const teardown = () => {
        stopNotes();
        stopFrame();
        if (noticeTimer != null) { unlater(noticeTimer); noticeTimer = null; }
        view?.removeEventListener?.("resize", onResize);
      };
      current = { dialog, preload, onKey, onKeyUp, onClick, onCancel, onClosed, onClose, teardown };
      doc.body.append(dialog);
      show();
      dialog.showModal();
      sizeCanvas();
      dialog.focus?.();
      const state = current;
      return {
        setSlide(i, patch) {
          if (current !== state || !list[i]) return;
          Object.assign(list[i], patch);
          if (i === at || i === at + 1) show();
          if (i === at && patch && "notes" in patch) renderNotes();
        },
        isOpen: () => current === state,
        close: () => { if (current === state) close(); },
        notice: (text) => { if (current === state) notice(text); },
      };
    },
  };
}
