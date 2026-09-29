const MAX_CAPTION = 200;

function cleanText(text) {
  return String(text ?? "")
    .replace(/[{}`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Text of text elements whose id is in ids OR whose containerId is in ids, in scene order.
export function captionFromElements(elements, ids) {
  if (!Array.isArray(elements) || !ids) return "";
  const wanted = new Set(Array.isArray(ids) ? ids : [...ids]);
  const parts = [];
  for (const el of elements) {
    if (!el || el.isDeleted || el.type !== "text") continue;
    if (!wanted.has(el.id) && !(el.containerId && wanted.has(el.containerId))) continue;
    const text = cleanText(el.originalText ?? el.text);
    if (text) parts.push(text);
  }
  return parts.join(" ; ").slice(0, MAX_CAPTION).trim();
}
