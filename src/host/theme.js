const MEMO_MS = 1000;
let memo = null;

const has = (el, cls) => !!el?.classList?.contains?.(cls);

function markerDark(doc) {
  const html = doc.documentElement;
  const body = doc.body;
  return has(html, "bp3-dark") || has(body, "bp3-dark") || has(body, "bt-theme-dark") || has(html, "rm-dark-theme") || has(body, "rm-dark-theme") || (has(body, "roam-body") && has(body, "dark"));
}

export function hostDarkMarker(doc) {
  try {
    return !!doc?.body && markerDark(doc);
  } catch {
    return false;
  }
}

export function parseColor(value) {
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(String(value ?? "").trim());
  if (!m) return null;
  let a = m[4] == null ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  if (!Number.isFinite(a)) a = 1;
  return { r: +m[1], g: +m[2], b: +m[3], a };
}

export function luminance({ r, g, b }) {
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function measure(doc) {
  const view = doc.defaultView;
  if (!doc.body || !view?.getComputedStyle) return false;
  for (const el of [doc.body, doc.documentElement]) {
    if (!el) continue;
    const c = parseColor(view.getComputedStyle(el).backgroundColor);
    if (c && c.a > 0) return luminance(c) < 0.4;
  }
  return false;
}

export function isHostDark(doc) {
  try {
    const now = Date.now();
    if (memo && memo.doc === doc && now - memo.at < MEMO_MS) return memo.value;
    const value = !!doc?.body && (markerDark(doc) || measure(doc));
    memo = { doc, at: now, value };
    return value;
  } catch (error) {
    console.warn("[plexus] theme probe failed", error);
    return false;
  }
}

export function resetThemeMemo() {
  memo = null;
}

export function motionOk(doc, animationSetting) {
  if (animationSetting === "off") return false;
  if (animationSetting === "on") return true;
  try {
    const mq = doc?.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)");
    return mq ? !mq.matches : true;
  } catch {
    return true;
  }
}
