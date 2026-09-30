const MAX_LOOKBACK = 300;
const MAX_QUERY = 100;

export function findTrigger(text, caret) {
  if (typeof text !== "string" || !Number.isInteger(caret) || caret < 2 || caret > text.length) return null;
  const floor = Math.max(0, caret - MAX_LOOKBACK);
  for (let i = caret - 2; i >= floor; i--) {
    const c = text[i];
    if (c === "\n") return null;
    const pair = c + text[i + 1];
    if (pair !== "[[" && pair !== "((") continue;
    const tail = text.slice(i + 2, caret);
    if (tail.includes("\n") || tail.includes("]]") || tail.includes("))") || tail.length > MAX_QUERY) return null;
    return { kind: pair === "[[" ? "page" : "block", start: i, query: tail };
  }
  return null;
}

function replaceTrigger(text, caret, trigger, token) {
  const closer = trigger.kind === "page" ? "]]" : "))";
  const rest = text.slice(caret);
  const lead = /^[^\n[\]()]*/.exec(rest)[0];
  const cut = rest.startsWith(closer, lead.length) ? caret + lead.length + 2 : caret;
  return { text: text.slice(0, trigger.start) + token + text.slice(cut), caret: trigger.start + token.length };
}

export function applyPick(text, caret, trigger, pick) {
  return replaceTrigger(text, caret, trigger, pick.kind === "page" ? `[[${pick.title}]]` : `((${pick.uid}))`);
}

export function stripTrigger(text, caret, trigger) {
  return replaceTrigger(text, caret, trigger, "");
}

const MAX_TITLE = 250;

export function normalizeCreateTitle(query) {
  const t = String(query ?? "").replace(/\s+/g, " ").trim();
  if (!t || t.length > MAX_TITLE || t.includes("[[") || t.includes("]]")) return "";
  return t;
}

const ABBREVS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// Orders page rows: exact title matches, the date row, other results, then "+ Create page".
// results: [{kind: "page", title, uid}]. dateTitle: formatted natural-date page title or "".
// canCreate: caller allows a create row; exists: a case-sensitive pull already found the title.
export function buildPageRows({ query, results = [], dateTitle = "", canCreate = false, exists = false }) {
  const q = String(query ?? "").trim().toLowerCase();
  const list = results.filter((r) => r && r.title != null);
  const exact = list.filter((r) => r.title.toLowerCase() === q);
  const rest = list.filter((r) => r.title.toLowerCase() !== q);
  const dateLower = dateTitle.toLowerCase();
  const dateRow = dateTitle ? { kind: "date", title: dateTitle } : null;
  const dupe = (r) => dateRow && r.title.toLowerCase() === dateLower;
  const abbrevWins = q.length === 3 && ABBREVS.some((n) => n.startsWith(q)) && rest.some((r) => r.title.toLowerCase().startsWith(q));
  const exactRows = exact.filter((r) => !dupe(r));
  const restRows = rest.filter((r) => !dupe(r));
  const rows = [...exactRows];
  if (dateRow && !abbrevWins) rows.push(dateRow);
  rows.push(...restRows);
  if (dateRow && abbrevWins) rows.push(dateRow);
  const title = normalizeCreateTitle(query);
  if (canCreate && title && !exists && !list.some((r) => r.title.toLowerCase() === title.toLowerCase()) && !(dateRow && dateLower === title.toLowerCase())) {
    rows.push({ kind: "create", title });
  }
  return rows;
}

const tokensOf = (query) => String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);

function ranges(label, tokens) {
  const lower = label.toLowerCase();
  const out = [];
  for (const t of tokens) {
    let from = 0;
    for (;;) {
      const at = lower.indexOf(t, from);
      if (at < 0) break;
      out.push([at, at + t.length]);
      from = at + t.length;
    }
  }
  out.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}

export function matchSegments(label, query) {
  const s = String(label ?? "");
  const merged = ranges(s, tokensOf(query));
  if (!merged.length) return [{ text: s, match: false }];
  const segs = [];
  let pos = 0;
  for (const [a, b] of merged) {
    if (a > pos) segs.push({ text: s.slice(pos, a), match: false });
    segs.push({ text: s.slice(a, b), match: true });
    pos = b;
  }
  if (pos < s.length) segs.push({ text: s.slice(pos), match: false });
  return segs;
}

export function blockSnippet(str, query, max = 120) {
  const s = String(str ?? "").replace(/\s*\n\s*/g, " ").trim();
  if (s.length <= max) return s;
  const first = ranges(s, tokensOf(query))[0];
  let start = first ? Math.max(0, first[0] - Math.floor(max / 3)) : 0;
  const end = Math.min(s.length, start + max);
  start = Math.max(0, end - max);
  return (start > 0 ? "…" : "") + s.slice(start, end) + (end < s.length ? "…" : "");
}
