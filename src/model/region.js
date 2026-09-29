export const REGION_COMPONENT = "plexus-region";
export const CONTAINER_STRING = "{{[[plexus-regions]]}}";
export const REGION_BUTTON_CLASS = "rm-xparser-default-plexus-region";
export const DEFAULT_PAD = 10;
export const SUPPORTED_KINDS = Object.freeze(["area", "rect"]);
export const RESERVED_KINDS = Object.freeze(["group", "frame", "cframe", "poly"]);

export function parseRegion(blockString) { throw new Error("not implemented"); }
export function serializeRegion(region) { throw new Error("not implemented"); }
export function normalizeFrac(f) { throw new Error("not implemented"); }
export function isContainerString(s) { throw new Error("not implemented"); }
export function geometryKey(region) { throw new Error("not implemented"); }
