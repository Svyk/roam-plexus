export const QUERY_PAGE_CAP = 4;

const SKIP = new Set(["TODO", "DONE", "query"]);

// Page titles named in a query string. Component titles are not pages. Capped.
export function queryPageTitles(string) {
  if (typeof string !== "string" || !string) return [];
  const out = [];
  const re = /\[\[([^[\]]+)\]\]/g;
  let match;
  while ((match = re.exec(string))) {
    const title = match[1].trim();
    if (!title || SKIP.has(title) || out.includes(title)) continue;
    out.push(title);
    if (out.length >= QUERY_PAGE_CAP) break;
  }
  return out;
}
