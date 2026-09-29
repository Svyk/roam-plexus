import { withLock, lockName } from "./locks.js";
import { isContainerString, parseRegion, CONTAINER_STRING } from "../model/region.js";
import { parseDrawingProps } from "../model/scene.js";
import { fnv1a } from "../model/hash.js";

const PULL_PATTERN = "[:block/uid :block/string :edit/time :block/open :block/props {:block/children [:block/uid :block/string :block/order]}]";
const DRAWING_MEMO_CAP = 64;

function normalizeProps(props) {
  if (typeof props === "string") {
    try { return JSON.parse(props); } catch { return null; }
  }
  return props && typeof props === "object" ? props : null;
}

// parseProps and hashFn are optional test seams; production uses the model modules.
export function createRoamHost({ api = globalThis.roamAlphaAPI, withLockFn = withLock, parseProps = parseDrawingProps, hashFn = fnv1a } = {}) {
  const memo = new Map();

  function pullBlock(uid) {
    if (!uid) return null;
    const raw = api.data.pull(PULL_PATTERN, [":block/uid", uid]);
    if (!raw || !raw[":block/uid"]) return null;
    const children = (raw[":block/children"] || [])
      .map((c) => ({ uid: c[":block/uid"], string: c[":block/string"] ?? "", order: c[":block/order"] ?? 0 }))
      .sort((a, b) => a.order - b.order);
    return {
      uid: raw[":block/uid"],
      string: raw[":block/string"] ?? "",
      editTime: raw[":edit/time"] ?? 0,
      open: raw[":block/open"] !== false,
      props: normalizeProps(raw[":block/props"]),
      children,
    };
  }

  function drawing(uid) {
    const block = pullBlock(uid);
    if (!block) return null;
    const cached = memo.get(uid);
    if (cached && cached.editTime === block.editTime) {
      memo.delete(uid);
      memo.set(uid, cached);
      return cached.value;
    }
    const parsed = block.props ? parseProps(block.props) : null;
    const value = parsed ? { ...parsed, uid, editTime: block.editTime, hash: hashFn(parsed.elementsJson ?? "") } : null;
    memo.delete(uid);
    memo.set(uid, { editTime: block.editTime, value });
    while (memo.size > DRAWING_MEMO_CAP) memo.delete(memo.keys().next().value);
    return value;
  }

  function findContainer(block) {
    return block?.children.find((c) => isContainerString(c.string)) || null;
  }

  function regionsOf(drawingUid) {
    const container = findContainer(pullBlock(drawingUid));
    if (!container) return [];
    const full = pullBlock(container.uid);
    if (!full) return [];
    const out = [];
    for (const child of full.children) {
      const region = parseRegion(child.string);
      if (region) out.push({ uid: child.uid, string: child.string, region });
    }
    return out;
  }

  async function ensureRegionContainer(drawingUid) {
    const existing = findContainer(pullBlock(drawingUid));
    if (existing) return existing.uid;
    const uid = api.util.generateUID();
    await api.data.block.create({
      location: { "parent-uid": drawingUid, order: "last" },
      block: { uid, string: CONTAINER_STRING, open: false },
    });
    return uid;
  }

  async function createRegion(drawingUid, regionString) {
    const graph = api.graph.name;
    const lock = await withLockFn(lockName(graph, drawingUid), async () => {
      const containerUid = await ensureRegionContainer(drawingUid);
      const uid = api.util.generateUID();
      await api.data.block.create({
        location: { "parent-uid": containerUid, order: "last" },
        block: { uid, string: regionString },
      });
      return uid;
    });
    if (!lock.acquired) throw new Error("[plexus] could not acquire drawing lock");
    return lock.value;
  }

  async function openBlock(uid, { sidebar = false } = {}) {
    if (sidebar) {
      return api.ui.rightSidebar.addWindow({ window: { type: "block", "block-uid": uid } });
    }
    return api.ui.mainWindow.openBlock({ block: { uid } });
  }

  function blockUidFromNode(node) {
    const el = node && typeof node.closest === "function" ? node : node?.parentElement;
    if (!el || typeof el.closest !== "function") return null;
    const ref = el.closest(".rm-block-ref[data-uid]");
    if (ref?.dataset?.uid) return ref.dataset.uid;
    const input = el.closest('[id^="block-input-"]');
    if (input?.id) return input.id.slice(-9);
    return null;
  }

  return {
    graphName() { return api.graph.name; },
    isEncrypted() { return !!api.graph.isEncrypted; },
    pullBlock,
    drawing,
    regionsOf,
    ensureRegionContainer,
    createRegion,
    openBlock,
    blockUidFromNode,
  };
}
