import { withLock, lockName } from "./locks.js";
import { isExcludedString } from "../model/mindmap.js";

const TREE_PATTERN = "[:block/uid :block/string :block/open :block/order {:block/children ...}]";
const COPY_CAP = 200;

const byOrder = (a, b) => (a[":block/order"] ?? 0) - (b[":block/order"] ?? 0);
const kids = (node) => (node?.[":block/children"] || []).slice().sort(byOrder);
const quote = (uid) => String(uid).replace(/["\\]/g, "");

function walk(node, fn) {
  fn(node);
  for (const child of kids(node)) walk(child, fn);
}

// Per-root serialized writer for mind-map trees. Only these write shapes are ever issued:
// block.create, block.update with ONLY string or ONLY open, block.move (moveBranch, moveTo), block.reorderBlocks
// (moveTo), block.delete (deleteBranch and discardPlaceholder). Props are never written.
export function createMmWriter({ api = globalThis.roamAlphaAPI, withLockFn = withLock, graph, raf } = {}) {
  const queues = new Map(); // rootUid -> { tail, pending }
  const drainHooks = new Map(); // rootUid -> Set<fn>
  const created = new Set();
  const schedule = raf || ((fn) => (typeof globalThis.requestAnimationFrame === "function" ? globalThis.requestAnimationFrame(fn) : setTimeout(fn, 16)));

  const graphName = () => graph ?? api.graph?.name;
  const state = (root) => {
    let s = queues.get(root);
    if (!s) { s = { tail: Promise.resolve(), pending: 0 }; queues.set(root, s); }
    return s;
  };
  const busy = (root) => (queues.get(root)?.pending || 0) > 0;

  function pullRaw(pattern, uid) {
    if (!uid) return null;
    const raw = api.data.pull(pattern, [":block/uid", uid]);
    return raw && raw[":block/uid"] ? raw : null;
  }
  const pullTree = (rootUid) => pullRaw(TREE_PATTERN, rootUid);

  async function underLocks(roots, fn) {
    const sorted = [...new Set(roots)].sort();
    const step = async (i) => {
      if (i >= sorted.length) return fn();
      const lock = await withLockFn(lockName(graphName(), `mm:${sorted[i]}`), () => step(i + 1));
      if (!lock.acquired) throw new Error("[plexus] could not acquire mind-map lock");
      return lock.value;
    };
    return step(0);
  }

  // Serialized per root (queue) and cross-tab (Web Lock). A move between maps queues on the first root.
  function run(rootUid, fn, extraRoots = []) {
    const s = state(rootUid);
    s.pending += 1;
    const job = s.tail.then(() => underLocks([rootUid, ...extraRoots], fn));
    s.tail = job.then(() => {}, () => {});
    return job.finally(() => {
      s.pending -= 1;
      if (s.pending === 0) for (const hook of [...(drainHooks.get(rootUid) || [])]) hook();
    });
  }

  async function createAt(parentUid, order, uid, string) {
    await api.data.block.create({ location: { "parent-uid": parentUid, order }, block: { uid, string } });
    created.add(uid);
  }

  async function unfold(uid) {
    const raw = pullRaw("[:block/uid :block/open]", uid);
    if (raw && raw[":block/open"] === false) await api.data.block.update({ block: { uid, open: true } });
  }

  function createChild(rootUid, parentUid, { uid = api.util.generateUID(), string = "", unfold: doUnfold = true } = {}) {
    return run(rootUid, async () => {
      if (doUnfold) await unfold(parentUid);
      await createAt(parentUid, "last", uid, string);
      return uid;
    });
  }

  function createSiblingAfter(rootUid, siblingUid, { uid = api.util.generateUID(), string = "" } = {}) {
    return run(rootUid, async () => {
      if (siblingUid === rootUid) {
        await unfold(rootUid);
        await createAt(rootUid, "last", uid, string);
        return uid;
      }
      const raw = api.data.pull("[:block/uid :block/order {:block/_children [:block/uid]}]", [":block/uid", siblingUid]);
      const parent = raw?.[":block/_children"]?.[0]?.[":block/uid"];
      if (!raw?.[":block/uid"] || !parent) throw new Error("[plexus] sibling block not found");
      await createAt(parent, (raw[":block/order"] ?? 0) + 1, uid, string);
      return uid;
    });
  }

  // Compare-and-set: writes only when the block still holds baseString.
  function updateString(rootUid, uid, string, baseString) {
    return run(rootUid, async () => {
      const raw = pullRaw("[:block/uid :block/string]", uid);
      if (!raw) return { ok: false, reason: "missing" };
      if ((raw[":block/string"] ?? "") !== baseString) return { ok: false, reason: "changed" };
      if (string === baseString) return { ok: true, written: false };
      await api.data.block.update({ block: { uid, string } });
      return { ok: true, written: true };
    });
  }

  function setOpen(rootUid, uid, open) {
    return run(rootUid, async () => {
      await api.data.block.update({ block: { uid, open: !!open } });
      return { ok: true };
    });
  }

  async function insideBranch(sourceUid, targetUid) {
    if (sourceUid === targetUid) return true;
    const raw = api.data.pull("[:block/uid {:block/parents [:block/uid]}]", [":block/uid", targetUid]);
    return (raw?.[":block/parents"] || []).some((p) => p[":block/uid"] === sourceUid);
  }

  function moveBranch(rootUid, uid, targetParentUid, { targetRootUid } = {}) {
    return run(rootUid, async () => {
      if (!pullRaw("[:block/uid]", uid)) return { ok: false, reason: "missing" };
      if (!pullRaw("[:block/uid]", targetParentUid)) return { ok: false, reason: "missing-target" };
      if (await insideBranch(uid, targetParentUid)) return { ok: false, reason: "inside-source" };
      await unfold(targetParentUid);
      await api.data.block.move({ location: { "parent-uid": targetParentUid, order: "last" }, block: { uid } });
      return { ok: true };
    }, targetRootUid && targetRootUid !== rootUid ? [targetRootUid] : []);
  }

  const childUids = (raw) => kids(raw).map((c) => c[":block/uid"]);
  const CHILDREN = "[:block/uid :block/order {:block/children [:block/uid :block/order]}]";

  // Positioned move (MM-1 drag, MM-2 reorder). Fresh pulls inside the job; never writes a string.
  // {parentUid} alone is a last child; beforeUid / afterUid place it next to that sibling.
  function moveTo(rootUid, uid, { parentUid, beforeUid, afterUid } = {}) {
    return run(rootUid, async () => {
      const neighbour = beforeUid ?? afterUid ?? null;
      if (!pullRaw("[:block/uid]", uid)) return { ok: false, reason: "missing" };
      if (!pullRaw("[:block/uid]", parentUid)) return { ok: false, reason: "missing-target" };
      if (neighbour === uid) return { ok: false, reason: "self" };
      if (await insideBranch(uid, parentUid)) return { ok: false, reason: "inside-source" };
      const current = childUids(pullRaw(CHILDREN, parentUid));
      if (neighbour != null && !current.includes(neighbour)) return { ok: false, reason: "missing-neighbour" };
      await unfold(parentUid);
      const same = current.includes(uid);
      const rest = current.filter((u) => u !== uid);
      const at = neighbour == null ? rest.length : rest.indexOf(neighbour) + (afterUid != null && beforeUid == null ? 1 : 0);
      if (same) {
        const blocks = [...rest.slice(0, at), uid, ...rest.slice(at)];
        if (blocks.every((u, i) => u === current[i])) return { ok: true, written: false };
        if (typeof api.data.block.reorderBlocks === "function") {
          await api.data.block.reorderBlocks({ location: { "parent-uid": parentUid }, blocks });
          return { ok: true, written: true };
        }
        await api.data.block.move({ location: { "parent-uid": parentUid, order: at }, block: { uid } });
        const actual = childUids(pullRaw(CHILDREN, parentUid)).indexOf(uid);
        if (actual !== -1 && actual !== at) await api.data.block.move({ location: { "parent-uid": parentUid, order: at + (at - actual) }, block: { uid } });
        return { ok: true, written: true };
      }
      await api.data.block.move({ location: { "parent-uid": parentUid, order: neighbour == null ? "last" : at }, block: { uid } });
      return { ok: true, written: true };
    });
  }

  function copyBranch(rootUid, sourceUid, targetParentUid, { targetRootUid, cap = COPY_CAP } = {}) {
    return run(rootUid, async () => {
      const source = pullTree(sourceUid);
      if (!source) return { ok: false, reason: "missing" };
      if (!pullRaw("[:block/uid]", targetParentUid)) return { ok: false, reason: "missing-target" };
      if (await insideBranch(sourceUid, targetParentUid)) return { ok: false, reason: "inside-source" };
      let total = 0;
      let skipped = 0;
      const plan = (node) => {
        const string = node[":block/string"] ?? "";
        if (isExcludedString(string)) { walk(node, () => { skipped += 1; }); return null; }
        total += 1;
        return { string, open: node[":block/open"], children: kids(node).map(plan).filter(Boolean) };
      };
      const tree = plan(source);
      if (!tree) return { ok: false, reason: "excluded", skipped };
      if (total > cap) return { ok: false, reason: "too-large", count: total };
      await unfold(targetParentUid);
      let made = 0;
      const emit = async (node, parent) => {
        const uid = api.util.generateUID();
        await createAt(parent, "last", uid, node.string);
        made += 1;
        for (const child of node.children) await emit(child, uid);
        if (node.children.length && node.open === false) await api.data.block.update({ block: { uid, open: false } });
        return uid;
      };
      const uid = await emit(tree, targetParentUid);
      return { ok: true, uid, created: made, skipped };
    }, targetRootUid && targetRootUid !== rootUid ? [targetRootUid] : []);
  }

  // Explicit Alt+Backspace only. expect = {count, string} from the first press; a mismatch aborts.
  function deleteBranch(rootUid, uid, expect = {}) {
    return run(rootUid, async () => {
      if (uid === rootUid) return { ok: false, reason: "root" };
      const tree = pullTree(uid);
      if (!tree) return { ok: false, reason: "missing" };
      const uids = new Set();
      let excluded = false;
      walk(tree, (n) => { uids.add(n[":block/uid"]); if (isExcludedString(n[":block/string"] ?? "")) excluded = true; });
      if (excluded) return { ok: false, reason: "excluded", count: uids.size };
      if (expect.count != null && expect.count !== uids.size) return { ok: false, reason: "changed", count: uids.size };
      if (expect.string != null && expect.string !== (tree[":block/string"] ?? "")) return { ok: false, reason: "changed", count: uids.size };
      for (const id of uids) {
        const raw = api.data.pull("[:block/uid {:block/_refs [:block/uid]}]", [":block/uid", id]);
        if ((raw?.[":block/_refs"] || []).some((r) => !uids.has(r[":block/uid"]))) return { ok: false, reason: "referenced", count: uids.size };
      }
      await api.data.block.delete({ block: { uid } });
      return { ok: true, count: uids.size };
    });
  }

  // Esc-cancel: only a block this session created, still holding its placeholder, with no children.
  function discardPlaceholder(rootUid, uid, placeholder) {
    return run(rootUid, async () => {
      if (!created.has(uid)) return { ok: false, reason: "not-created" };
      const raw = pullRaw("[:block/uid :block/string {:block/children [:block/uid]}]", uid);
      if (!raw) return { ok: false, reason: "missing" };
      if ((raw[":block/string"] ?? "") !== placeholder || (raw[":block/children"] || []).length) return { ok: false, reason: "changed" };
      await api.data.block.delete({ block: { uid } });
      created.delete(uid);
      return { ok: true };
    });
  }

  // cb(tree) gets one fresh pull per frame. Fires while ops are queued only mark dirty; one pull runs on drain.
  function watchTree(rootUid, cb) {
    if (!rootUid || typeof api.data?.addPullWatch !== "function") return () => {};
    const ident = `[:block/uid "${quote(rootUid)}"]`;
    let dirty = false;
    let scheduled = false;
    let done = false;
    const flush = () => {
      scheduled = false;
      if (done || !dirty) return;
      if (busy(rootUid)) return;
      dirty = false;
      try { cb(pullTree(rootUid)); } catch (error) { console.warn("[plexus] mind-map watch callback failed", error); }
    };
    const mark = () => {
      dirty = true;
      if (busy(rootUid) || scheduled) return;
      scheduled = true;
      schedule(flush);
    };
    const handler = () => { if (!done) mark(); };
    const onDrain = () => { if (dirty && !done && !scheduled) { scheduled = true; schedule(flush); } };
    let hooks = drainHooks.get(rootUid);
    if (!hooks) { hooks = new Set(); drainHooks.set(rootUid, hooks); }
    hooks.add(onDrain);
    api.data.addPullWatch(TREE_PATTERN, ident, handler);
    return () => {
      if (done) return;
      done = true;
      hooks.delete(onDrain);
      if (!hooks.size) drainHooks.delete(rootUid);
      try { api.data.removePullWatch(TREE_PATTERN, ident, handler); } catch (error) { console.warn("[plexus] removePullWatch failed", error); }
    };
  }

  // Runs fn now if the root's queue is idle, else once after it drains.
  function onIdle(rootUid, fn) {
    if (!busy(rootUid)) { fn(); return; }
    let hooks = drainHooks.get(rootUid);
    if (!hooks) { hooks = new Set(); drainHooks.set(rootUid, hooks); }
    const hook = () => { hooks.delete(hook); if (!hooks.size && drainHooks.get(rootUid) === hooks) drainHooks.delete(rootUid); fn(); };
    hooks.add(hook);
  }

  return { isBusy: busy, onIdle, createChild, createSiblingAfter, updateString, setOpen, moveBranch, moveTo, copyBranch, deleteBranch, discardPlaceholder, pullTree, watchTree };
}
