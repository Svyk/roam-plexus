// Roam token grammar for NAV-1: page refs, tags, block refs and aliases inside a canvas text. Pure.
// Code, URLs and {{...}} are masked first so `/#/app` is not a tag and `{{[[TODO]]}}` is not a page link.

const MASK = "\u0000";
const UID_RE = /^\(\(([A-Za-z0-9_-]{9})\)\)/;
const ALIAS_HEAD_RE = /^\[[^[\]\n]*\]\(/;
const TAG_CHAR_RE = /[\p{L}\p{N}_\-/.:@]/u;

const blank = (s) => MASK.repeat(s.length);

function maskBraces(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "{" && text[i + 1] === "{") {
      let depth = 0;
      let j = i;
      let end = -1;
      while (j < text.length) {
        if (text[j] === "{" && text[j + 1] === "{") { depth++; j += 2; continue; }
        if (text[j] === "}" && text[j + 1] === "}") {
          depth--;
          j += 2;
          if (depth === 0) { end = j; break; }
          continue;
        }
        j++;
      }
      if (end > 0) {
        out += blank(text.slice(i, end));
        i = end;
        continue;
      }
    }
    out += text[i];
    i++;
  }
  return out;
}

export function maskText(text) {
  return maskBraces(
    String(text ?? "")
      .replace(/```[\s\S]*?```/g, blank)
      .replace(/`[^`\n]*`/g, blank)
      .replace(/https?:\/\/\S+/g, blank),
  );
}

// Index just past the ]] that closes the [[ at `open`, or -1. Nested [[ ]] stay inside.
function closeOf(m, open, limit) {
  let depth = 1;
  let i = open + 2;
  while (i < limit) {
    if (m[i] === "[" && m[i + 1] === "[") { depth++; i += 2; continue; }
    if (m[i] === "]" && m[i + 1] === "]") {
      depth--;
      i += 2;
      if (depth === 0) return i;
      continue;
    }
    i++;
  }
  return -1;
}

function scan(m, from, to, nested, out, inTitle = false) {
  let i = from;
  while (i < to) {
    const c = m[i];
    if (inTitle && c !== "[" && !(c === "#" && m[i + 1] === "[" && m[i + 2] === "[")) { i++; continue; }
    if (c === "[" && m[i + 1] !== "[") {
      if (inTitle) { i++; continue; }
      const head = ALIAS_HEAD_RE.exec(m.slice(i, to));
      if (head) {
        const p = i + head[0].length;
        if (m[p] === "[" && m[p + 1] === "[") {
          const end = closeOf(m, p, to);
          if (end > 0 && m[end] === ")" && end - 2 > p + 2) {
            out.push({ kind: "page", title: m.slice(p + 2, end - 2), start: i, end: end + 1 });
            i = end + 1;
            continue;
          }
        } else if (m[p] === "(" && m[p + 1] === "(") {
          const u = UID_RE.exec(m.slice(p, to));
          if (u && m[p + u[0].length] === ")") {
            out.push({ kind: "block", uid: u[1], start: i, end: p + u[0].length + 1 });
            i = p + u[0].length + 1;
            continue;
          }
        }
      }
      i++;
      continue;
    }
    if (c === "[" && m[i + 1] === "[") {
      const end = closeOf(m, i, to);
      if (end > 0 && end - 2 > i + 2) {
        out.push({ kind: "page", title: m.slice(i + 2, end - 2), start: i, end });
        if (nested) scan(m, i + 2, end - 2, nested, out, true);
        i = end;
        continue;
      }
      i += 2;
      continue;
    }
    if (c === "#" && m[i + 1] === "[" && m[i + 2] === "[") {
      const end = closeOf(m, i + 1, to);
      if (end > 0 && end - 2 > i + 3) {
        out.push({ kind: "tag", title: m.slice(i + 3, end - 2), start: i, end });
        if (nested) scan(m, i + 3, end - 2, nested, out, true);
        i = end;
        continue;
      }
      i++;
      continue;
    }
    if (c === "#") {
      let j = i + 1;
      while (j < to && TAG_CHAR_RE.test(m[j])) j++;
      while (j > i + 1 && m[j - 1] === ":") j--;
      if (j > i + 1) {
        out.push({ kind: "tag", title: m.slice(i + 1, j), start: i, end: j });
        i = j;
        continue;
      }
      i++;
      continue;
    }
    if (c === "(" && m[i + 1] === "(") {
      const u = UID_RE.exec(m.slice(i, to));
      if (u) {
        out.push({ kind: "block", uid: u[1], start: i, end: i + u[0].length });
        i += u[0].length;
        continue;
      }
    }
    i++;
  }
}

// -> [{kind: "page"|"block"|"tag", title?, uid?, start, end}] ordered by start, non-overlapping.
// {nested: true} also lists refs inside a page title (overlapping) so the innermost one can win a hit test.
export function findTokens(text, { nested = false } = {}) {
  const src = String(text ?? "");
  if (!src) return [];
  const m = maskText(src);
  const out = [];
  scan(m, 0, m.length, nested, out);
  // Titles come from the masked copy; take them from the source so masked characters stay intact.
  for (const t of out) if (t.title != null) t.title = titleFrom(src, t);
  return out.sort((a, b) => a.start - b.start || b.end - a.end);
}

function titleFrom(src, t) {
  const raw = src.slice(t.start, t.end);
  if (raw.startsWith("#[[")) return raw.slice(3, -2);
  if (raw.startsWith("[[")) return raw.slice(2, -2);
  if (raw.startsWith("#")) return raw.slice(1);
  const alias = ALIAS_HEAD_RE.exec(raw);
  if (alias) return raw.slice(alias[0].length + 2, -3);
  return t.title;
}

// Map from index in the wrapped `text` to index in `originalText` (length text.length + 1), or null when the two disagree.
export function alignWrapped(text, originalText) {
  const t = String(text ?? "");
  const o = String(originalText ?? "");
  const map = new Int32Array(t.length + 1);
  let i = 0;
  let j = 0;
  while (i < t.length) {
    if (j < o.length && t[i] === o[j]) { map[i++] = j++; continue; }
    if (t[i] === "\n") {
      map[i++] = j;
      if (j < o.length && /\s/.test(o[j])) j++;
      continue;
    }
    if (j < o.length && /\s/.test(o[j])) { j++; continue; }
    return null;
  }
  map[t.length] = o.length;
  return map;
}
