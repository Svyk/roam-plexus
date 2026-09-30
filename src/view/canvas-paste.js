const PREFIX = '{"type":"excalidraw/clipboard"';
const MAX_LINES = 100;
const NOTHING = "Nothing to paste as text; paste inside a code block to keep the JSON";

function live(el) {
  return el && typeof el === "object" && el.isDeleted !== true;
}

function centerY(el) {
  return (Number(el.y) || 0) + (Number(el.height) || 0) / 2;
}

function isLink(link) {
  return typeof link === "string" && (/^\(\([^()\s]+\)\)$/.test(link) || /^\[\[.+\]\]$/.test(link));
}

function readingOrder(els) {
  const sorted = els.slice().sort((a, b) => (Number(a.y) || 0) - (Number(b.y) || 0));
  const rows = [];
  for (const el of sorted) {
    const row = rows[rows.length - 1];
    const head = row?.[0];
    const smaller = head ? Math.min(Math.abs(Number(head.height) || 0), Math.abs(Number(el.height) || 0)) : 0;
    if (head && Math.abs(centerY(head) - centerY(el)) < smaller / 2) row.push(el);
    else rows.push([el]);
  }
  return rows.flatMap((row) => row.sort((a, b) => (Number(a.x) || 0) - (Number(b.x) || 0)));
}

// Clipboard JSON text -> {lines} in reading order, or null when the JSON is not an Excalidraw clipboard
// payload. An empty `lines` means the payload held nothing pasteable as text.
export function excalidrawClipboardToText(json) {
  let data = json;
  if (typeof json === "string") {
    try { data = JSON.parse(json); } catch { return null; }
  }
  if (!data || typeof data !== "object" || data.type !== "excalidraw/clipboard" || !Array.isArray(data.elements)) return null;
  const els = data.elements.filter(live);
  const anchors = new Set(els.filter((el) => typeof el.customData?.plexus?.embed === "string").map((el) => el.id));
  const lines = [];
  for (const el of readingOrder(els)) {
    if (typeof el.customData?.plexus?.embed === "string") {
      lines.push(el.customData.plexus.embed);
    } else if (el.type === "text") {
      if (el.containerId && anchors.has(el.containerId)) continue;
      const text = String(el.originalText ?? el.text ?? "").trim();
      if (text) lines.push(text);
    } else if (el.type === "image") {
      const url = el.customData?.firebaseUrl;
      if (typeof url === "string" && url.startsWith("https://")) lines.push(`![](${url})`);
    } else if (isLink(el.link)) {
      lines.push(el.link);
    }
  }
  return { lines };
}

function inCode(value, caret) {
  const v = String(value ?? "");
  if (v.startsWith("```")) return true;
  const before = v.slice(0, Math.max(0, Math.min(Number(caret) || 0, v.length)));
  if ((before.match(/```/g) || []).length % 2 === 1) return true;
  return (before.replace(/```/g, "").match(/`/g) || []).length % 2 === 1;
}

function isBlockInput(t) {
  if (!t || String(t.tagName ?? "").toUpperCase() !== "TEXTAREA") return false;
  const cls = t.classList?.contains ? t.classList.contains("rm-block-input") : String(t.className ?? "").split(/\s+/).includes("rm-block-input");
  return cls || String(t.id ?? "").startsWith("block-input-");
}

function uidFromNode(ta) {
  const id = String(ta?.id ?? "");
  return id.startsWith("block-input-") && id.length >= 9 ? id.slice(-9) : null;
}

function defaultInsert(doc, win) {
  return (ta, text) => {
    let ok = false;
    try { ok = doc.execCommand?.("insertText", false, text) === true; } catch { ok = false; }
    if (ok) return true;
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? start;
    const next = ta.value.slice(0, start) + text + ta.value.slice(end);
    const proto = win?.HTMLTextAreaElement?.prototype ?? Object.getPrototypeOf(ta);
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(ta, next); else ta.value = next;
    const caret = start + text.length;
    try { ta.setSelectionRange?.(caret, caret); } catch { /* not selectable */ }
    const Ev = win?.Event ?? globalThis.Event;
    ta.dispatchEvent?.(new Ev("input", { bubbles: true }));
    return true;
  };
}

// Window capture paste: an Excalidraw clipboard payload pasted into a Roam block becomes text
// (first line in the block, the rest as new sibling blocks) instead of raw JSON. Code contexts and
// everything else are left to Roam.
export function installCanvasPaste({ win, doc, toast, createSibling, insertText, blockUid }) {
  const insert = insertText ?? defaultInsert(doc, win);
  const say = (msg) => { try { toast?.(msg); } catch { /* toast is best effort */ } };

  const onPaste = (e) => {
    try {
      if (e.defaultPrevented) return;
      const ta = e.target;
      if (!isBlockInput(ta)) return;
      const cd = e.clipboardData;
      if (!cd || [...(cd.types ?? [])].includes("Files")) return;
      const raw = String(cd.getData?.("text/plain") ?? "");
      if (!raw.trimStart().startsWith(PREFIX)) return;
      if (inCode(ta.value, ta.selectionStart)) return;
      let parsed;
      try { parsed = JSON.parse(raw); } catch { return; }
      const result = excalidrawClipboardToText(parsed);
      if (!result) return;
      e.preventDefault?.();
      e.stopImmediatePropagation?.();
      if (!result.lines.length) { say(NOTHING); return; }
      let lines = result.lines;
      if (lines.length > MAX_LINES) {
        lines = lines.slice(0, MAX_LINES);
        say(`Pasted the first ${MAX_LINES} lines`);
      }
      const [first, ...rest] = lines;
      insert(ta, first);
      if (rest.length) {
        let uid = null;
        try { uid = blockUid ? blockUid(ta) : uidFromNode(ta); } catch { uid = null; }
        if (!uid || !createSibling) { say("Could not add the remaining lines"); return; }
        Promise.resolve(createSibling({ uid, strings: rest })).catch((error) => console.warn("[plexus] canvas paste siblings failed", error));
      }
    } catch (error) {
      console.warn("[plexus] canvas paste failed", error);
    }
  };

  win.addEventListener("paste", onPaste, true);
  return () => win.removeEventListener("paste", onPaste, true);
}
