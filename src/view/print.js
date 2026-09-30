// Print view and PNG downloads for frame images. No dependencies; everything the browser touches is injectable.
const READY_MS = 15000;
const FALLBACK_MS = 60000;
const CLICK_GAP_MS = 250;
const REVOKE_MS = 5000;
const NAME_CAP = 120;
const BLEED_MM = 0.5;
// [width, height] in mm, portrait for paper sizes.
const PAPER = { letter: [215.9, 279.4], a4: [210, 297] };
const SLIDE_MM = [254, 142.875];

const warn = (msg, error) => console.warn(`[plexus] ${msg}`, error);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const mm = (n) => `${Number(n.toFixed(3))}mm`;

// size: "letter" | "a4" | "16:9". margin is in mm (default 10 for paper, 0 for 16:9).
export function buildPrintDocument({ drawing = "", pages = [], size = "letter", margin } = {}) {
  const slide = size === "16:9";
  const paper = PAPER[size] ?? PAPER.letter;
  const m = Number.isFinite(Number(margin)) && margin !== null && margin !== "" ? Math.max(0, Number(margin)) : (slide ? 0 : 10);
  const box = (w, h) => `width:${mm(w - 2 * m - BLEED_MM)};height:${mm(h - 2 * m - BLEED_MM)}`;
  const rules = [];
  if (slide) {
    rules.push(`@page{size:${SLIDE_MM[0]}mm ${SLIDE_MM[1]}mm;margin:${mm(m)}}`);
    rules.push(`.pg{${box(SLIDE_MM[0], SLIDE_MM[1])}}`);
  } else {
    const [pw, ph] = paper;
    const label = size === "a4" ? "A4" : "letter";
    rules.push(`@page plx-l{size:${label} landscape;margin:${mm(m)}}`);
    rules.push(`@page plx-p{size:${label} portrait;margin:${mm(m)}}`);
    rules.push(`.pg.l{page:plx-l;${box(ph, pw)}}`);
    rules.push(`.pg.p{page:plx-p;${box(pw, ph)}}`);
  }
  const css = [
    "html,body{margin:0;padding:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}",
    ...rules,
    ".pg{display:flex;align-items:center;justify-content:center;overflow:hidden;box-sizing:content-box}",
    ".pg:not(:last-child){break-after:page}",
    ".pg img{display:block;max-width:100%;max-height:100%;object-fit:contain}",
  ].join("\n");
  const body = pages.map((p) => {
    const landscape = slide || !(p.width > 0 && p.height > 0) || p.width > p.height;
    return `<div class="pg ${slide ? "s" : landscape ? "l" : "p"}"><img src="${esc(p.url)}" alt="${esc(p.name)}"></div>`;
  }).join("\n");
  return `<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>${esc(`${drawing} frames`)}</title><style>\n${css}\n</style></head><body>\n${body}\n</body></html>`;
}

// Prints the pages from a hidden same-origin iframe. Resolves {printed: true} after print() returns or afterprint;
// rejects (and never prints) when an image fails to load. dispose() removes everything and settles done.
export function printPages({
  doc, drawing = "", pages = [], size, margin, print,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id),
  readyMs = READY_MS, fallbackMs = FALLBACK_MS,
} = {}) {
  let iframe = null;
  let win = null;
  let disposed = false;
  let printed = false;
  const timers = new Set();
  const cleanups = [];
  let settle = () => {};
  let fail = () => {};
  const done = new Promise((resolve, reject) => { settle = resolve; fail = reject; });
  done.catch(() => {});
  const timer = (fn, ms) => {
    const id = setTimer(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
    return id;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const id of timers) clearTimer(id);
    timers.clear();
    for (const fn of cleanups.splice(0)) { try { fn(); } catch (error) { warn("print cleanup failed", error); } }
    try { iframe?.remove?.(); } catch (error) { warn("print iframe remove failed", error); }
    iframe = null;
    settle({ printed });
  };
  const abort = (error) => {
    warn("print aborted", error);
    if (!disposed) fail(error);
    dispose();
  };

  const run = async () => {
    iframe = doc.createElement("iframe");
    iframe.setAttribute?.("aria-hidden", "true");
    iframe.tabIndex = -1;
    Object.assign(iframe.style, { position: "fixed", left: "0", top: "0", width: "0", height: "0", border: "0", opacity: "0", pointerEvents: "none" });
    doc.body.append(iframe);
    win = iframe.contentWindow;
    const idoc = iframe.contentDocument ?? win?.document;
    if (!idoc) throw new Error("print frame unavailable");
    idoc.open();
    idoc.write(buildPrintDocument({ drawing, pages, size, margin }));
    idoc.close();
    const images = [...(idoc.images ?? idoc.querySelectorAll?.("img") ?? [])];
    await new Promise((resolve, reject) => {
      let pending = 0;
      let over = false;
      const finish = (error) => {
        if (over) return;
        over = true;
        if (error) reject(error);
        else resolve();
      };
      for (const img of images) {
        if (img.complete && img.naturalWidth > 0) continue;
        if (img.complete && img.naturalWidth === 0 && img.src) { finish(new Error("a page image failed to load")); return; }
        pending += 1;
        img.addEventListener("load", () => { if (img.naturalWidth > 0) { pending -= 1; if (pending === 0) finish(); } else finish(new Error("a page image is empty")); });
        img.addEventListener("error", () => finish(new Error("a page image failed to load")));
      }
      if (pending === 0) { finish(); return; }
      timer(() => finish(new Error("page images did not load in time")), readyMs);
    });
    if (disposed) return;
    let finished = false;
    const finishPrint = () => {
      if (finished) return;
      finished = true;
      dispose();
    };
    win.addEventListener?.("afterprint", finishPrint);
    cleanups.push(() => win?.removeEventListener?.("afterprint", finishPrint));
    timer(finishPrint, fallbackMs);
    win.focus?.();
    printed = true;
    try {
      await print(win);
    } finally {
      finishPrint();
    }
  };
  run().catch(abort);
  return { done, dispose };
}

const safeName = (s) => String(s ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-");

export function pngFileName(drawing, index, total, name) {
  const width = String(total).length;
  const nn = String(index + 1).padStart(width, "0");
  const frame = String(name ?? "").trim() || `Frame ${index + 1}`;
  const base = safeName(`${String(drawing ?? "").trim() || "Drawing"} - ${nn} ${frame}`);
  return `${base.slice(0, NAME_CAP - 4)}.png`;
}

// frames: [{ blob, name }]. One <a download> click per gap; each object URL is revoked shortly after its click.
export function downloadPngs({
  doc, drawing = "", frames = [], total,
  createUrl = (blob) => URL.createObjectURL(blob), revokeUrl = (url) => URL.revokeObjectURL(url),
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id),
  gapMs = CLICK_GAP_MS, revokeMs = REVOKE_MS,
} = {}) {
  const timers = new Set();
  const urls = new Set();
  let clicked = 0;
  let disposed = false;
  let settle = () => {};
  const done = new Promise((resolve) => { settle = resolve; });
  const timer = (fn, ms) => {
    const id = setTimer(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
  };
  const revoke = (url) => {
    if (!urls.delete(url)) return;
    try { revokeUrl(url); } catch (error) { warn("revoke failed", error); }
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const id of timers) clearTimer(id);
    timers.clear();
    for (const url of [...urls]) revoke(url);
    settle(clicked);
  };
  const step = (i) => {
    if (disposed) return;
    if (i >= frames.length) { settle(clicked); return; }
    const frame = frames[i];
    try {
      const url = createUrl(frame.blob);
      urls.add(url);
      const a = doc.createElement("a");
      a.href = url;
      a.download = pngFileName(drawing, frame.index ?? i, total ?? frames.length, frame.name);
      a.style.display = "none";
      doc.body.append(a);
      a.click();
      a.remove?.();
      clicked += 1;
      timer(() => revoke(url), revokeMs);
    } catch (error) {
      warn("png download failed", error);
    }
    if (i + 1 < frames.length) timer(() => step(i + 1), gapMs);
    else settle(clicked);
  };
  step(0);
  return { done, dispose };
}
