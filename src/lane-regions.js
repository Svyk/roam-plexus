import { serializeRegion } from "./model/region.js";

// Lane frames of a flow map each get one cframe region. host.createRegions already takes the drawing lock,
// and Web Locks are not reentrant, so nothing here may wrap it in withLock.
export function createLaneRegionMaker({ host, emit }) {
  return async function createLaneRegions(drawingUid, frames) {
    const named = new Set();
    for (const { region } of host.regionsOf(drawingUid) || []) {
      if (region?.supported && (region.kind === "frame" || region.kind === "cframe")) named.add(region.frameId);
    }
    const todo = (frames || []).filter((f) => f?.id && !named.has(f.id));
    if (!todo.length) return [];
    const strings = todo.map((f) => serializeRegion({ kind: "cframe", drawingUid, frameId: f.id, caption: String(f.name ?? "").trim() }));
    const uids = await host.createRegions(drawingUid, strings);
    for (const uid of uids) emit({ uid, kind: "region" });
    return uids;
  };
}
