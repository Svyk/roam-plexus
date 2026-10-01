// One chip on the open editor. A later call replaces it. Empty clears it.
export function paintDrawingName(outer, name) {
  if (!outer?.querySelector) return () => {};
  for (const node of [...outer.querySelectorAll(".plexus-drawing-name")]) node.remove?.();
  const value = String(name ?? "").trim();
  if (!value) return () => {};
  const doc = outer.ownerDocument;
  const el = doc.createElement("div");
  el.className = "plexus-drawing-name";
  el.textContent = value;
  outer.append(el);
  return () => el.remove?.();
}
