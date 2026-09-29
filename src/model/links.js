const URL_RE = /^https:\/\/roamresearch\.com\/#\/app\/([^/?#]+)\/page\/([A-Za-z0-9_-]+)\/?$/;

// Pure. Returns {type:"page", title} | {type:"block", uid} | {type:"page", uid} (same-graph URL; the host resolves page vs block) | null.
export function parseRoamLink(link, graphName) {
  if (typeof link !== "string") return null;
  const s = link.trim();
  if (!s) return null;
  let m = /^\[\[([^\]\n]+)\]\]$/.exec(s) || /^#\[\[([^\]\n]+)\]\]$/.exec(s);
  if (m) return { type: "page", title: m[1] };
  m = /^#([^\s[\]#()]+)$/.exec(s);
  if (m) return { type: "page", title: m[1] };
  m = /^\(\(([A-Za-z0-9_-]+)\)\)$/.exec(s);
  if (m) return { type: "block", uid: m[1] };
  m = URL_RE.exec(s);
  if (m) {
    let graph;
    try { graph = decodeURIComponent(m[1]); } catch { return null; }
    if (graphName && graph === graphName) return { type: "page", uid: m[2] };
  }
  return null;
}
