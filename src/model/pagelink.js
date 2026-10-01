export function roamPageUrl(graph, uid) {
  if (!graph || !uid) return null;
  return `https://roamresearch.com/#/app/${encodeURIComponent(graph)}/page/${uid}`;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

export function rewriteSvgTitles(svg, lookup) {
  if (typeof svg !== "string" || typeof lookup !== "function" || !svg.includes("[[")) return svg;
  return svg.replace(/>([^<]*)</g, (full, text) => {
    if (!text.includes("[[")) return full;
    const next = text.replace(/\[\[([^[\]]+)\]\]/g, (token, title) => {
      let url = null;
      try { url = lookup(String(title)); } catch { url = null; }
      if (!url) return token;
      return `<a href="${esc(url)}">${esc(title)}</a>`;
    });
    return `>${next}<`;
  });
}
