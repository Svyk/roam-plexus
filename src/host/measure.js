const MEMO_CAP = 2000;

export const fontString = (size) => `${size}px Excalifont, Xiaolai, sans-serif, Segoe UI Emoji`;

// Canvas measureText measurer, LRU-memoized by font|text. measure(text, fontSize) -> width in px.
export function createMeasurer({ doc = globalThis.document } = {}) {
  const memo = new Map();
  let ctx = null;

  function context() {
    if (ctx) return ctx;
    try { ctx = doc?.createElement?.("canvas")?.getContext?.("2d") || null; } catch { ctx = null; }
    return ctx;
  }

  function measure(text, fontSize) {
    const str = String(text ?? "");
    const font = fontString(fontSize);
    const key = `${font}|${str}`;
    if (memo.has(key)) {
      const hit = memo.get(key);
      memo.delete(key);
      memo.set(key, hit);
      return hit;
    }
    const c = context();
    let width;
    if (c) {
      c.font = font;
      width = c.measureText(str).width;
    } else {
      width = str.length * fontSize * 0.6;
    }
    memo.set(key, width);
    if (memo.size > MEMO_CAP) memo.delete(memo.keys().next().value);
    return width;
  }

  // Loads glyph chunks for the given texts; clears the memo when new faces arrived. Resolves true if cleared.
  async function ensureFonts(texts, fontSize = 20) {
    const fonts = doc?.fonts;
    if (!fonts || typeof fonts.load !== "function") return false;
    try {
      const font = fontString(fontSize);
      const text = (texts || []).join("");
      const wasLoaded = typeof fonts.check === "function" ? fonts.check(font, text) : false;
      const loaded = await fonts.load(font, text);
      if (!wasLoaded && loaded && loaded.length) { memo.clear(); return true; }
    } catch (error) { console.warn("[plexus] font load failed", error); }
    return false;
  }

  return { measure, ensureFonts, clear: () => memo.clear(), size: () => memo.size };
}
