export async function withLock(name, fn, { ifAvailable = false, locks = globalThis.navigator?.locks, timeoutMs = 5000 } = {}) { throw new Error("not implemented"); }
export function lockName(graph, uid) { return `plexus:${graph}:${uid}`; }
