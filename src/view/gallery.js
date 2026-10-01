export const GALLERY_CLASS = "plexus-regions-gallery";

function directChildren(block) {
  const list = block?.children;
  if (!list || typeof list.length !== "number") return null;
  for (let i = 0; i < list.length; i++) {
    const child = list[i];
    if (child?.classList?.contains?.("rm-block-children")) return child;
  }
  return null;
}

function childrenOf(input) {
  const block = input?.closest?.(".rm-block");
  if (!block) return null;
  return directChildren(block) || block.querySelector?.(".rm-block-children") || null;
}

function uidOfMarked(el) {
  const block = el?.closest?.(".rm-block");
  if (!block || typeof block.querySelectorAll !== "function") return "";
  const inputs = block.querySelectorAll('[id^="block-input-"]');
  for (const input of inputs) {
    if (typeof el.contains === "function" && el.contains(input)) continue;
    const id = typeof input?.id === "string" ? input.id : "";
    if (id.startsWith("block-input-")) return id.slice(-9);
  }
  return "";
}

export function applyRegionGalleries(doc, uids) {
  if (typeof doc?.querySelectorAll !== "function") return;
  const list = Array.isArray(uids) ? uids : [];
  const want = new Set(list);
  if (list.length && typeof doc.querySelector === "function") {
    for (const uid of list) {
      const input = doc.querySelector(`[id^="block-input-"][id$="-${uid}"]`);
      const children = input ? childrenOf(input) : null;
      children?.classList?.add?.(GALLERY_CLASS);
    }
  }
  for (const el of doc.querySelectorAll(`.rm-block-children.${GALLERY_CLASS}`)) {
    if (!want.has(uidOfMarked(el))) el.classList?.remove?.(GALLERY_CLASS);
  }
}
