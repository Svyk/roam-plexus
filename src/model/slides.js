import { liveElements } from "./scene.js";

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

const orderOf = (el) => {
  const o = el?.customData?.plexus?.order;
  return typeof o === "number" && Number.isFinite(o) ? o : null;
};

export function orderFrames(elements) {
  const frames = liveElements(elements).filter((el) => el.type === "frame" || el.type === "magicframe");
  return frames.sort((a, b) => {
    const oa = orderOf(a), ob = orderOf(b);
    if (oa !== null && ob !== null) {
      if (oa !== ob) return oa - ob;
    } else if (oa !== null) return -1;
    else if (ob !== null) return 1;
    const n = collator.compare(String(a.name ?? ""), String(b.name ?? ""));
    if (n) return n;
    return (Number(a.y) || 0) - (Number(b.y) || 0) || (Number(a.x) || 0) - (Number(b.x) || 0);
  });
}
