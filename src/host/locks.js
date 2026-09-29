export function lockName(graph, uid) { return `plexus:${graph}:${uid}`; }

// Web Locks with graceful fallback. Returns {acquired, fallback, value}.
export async function withLock(name, fn, { ifAvailable = false, locks = globalThis.navigator?.locks, timeoutMs = 5000 } = {}) {
  if (!locks || typeof locks.request !== "function") {
    return { acquired: true, fallback: true, value: await fn() };
  }
  const result = { acquired: false, fallback: false, value: undefined };
  const body = async (lock) => {
    if (!lock) return;
    result.acquired = true;
    result.value = await fn();
  };
  if (ifAvailable) {
    await locks.request(name, { ifAvailable: true }, body);
    return result;
  }
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    await locks.request(name, controller ? { signal: controller.signal } : {}, async (lock) => {
      if (timer) clearTimeout(timer);
      await body(lock);
    });
  } catch (error) {
    if (error?.name === "AbortError" && !result.acquired) return result;
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
  return result;
}
