import { withLock, lockName } from "./locks.js";
import { isContainerString, parseRegion, CONTAINER_STRING } from "../model/region.js";
import { parseDrawingProps } from "../model/scene.js";
import { fnv1a } from "../model/hash.js";

const PULL_PATTERN = "[:block/uid :block/string :edit/time :block/open :block/props {:block/children [:block/uid :block/string :block/order]}]";
const DRAWING_MEMO_CAP = 64;
const DRAWING_STRING = "{{[[excalidraw]]}}";
const DRAWING_START = /^(\{\{\[\[excalidraw\]\]\}\}|\{\{excalidraw\}\})/;
const DRAWINGS_CAP = 50;
const EMBED_CAP = 30;
const EMBED_PATTERN = "[:block/uid :block/string :node/title {:block/page [:node/title]} {:block/children [:block/uid :block/string :block/order {:block/children [:block/uid :block/string :block/order]}]}]";
const EMBED_UID = /^[A-Za-z0-9_-]{9}$/;

function parseEmbedTarget(ref) {
  const text = String(ref ?? "").trim();
  let m = /^\(\(([^()]+)\)\)$/.exec(text);
  if (m) return { uid: m[1] };
  m = /^\[\[([\s\S]+)\]\]$/.exec(text);
  if (m) return { title: m[1] };
  return EMBED_UID.test(text) ? { uid: text } : null;
}

const byOrder = (a, b) => (a[":block/order"] ?? 0) - (b[":block/order"] ?? 0);

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
    // Deterministic uid: a second tab whose replica has not seen the container yet collides on
    // this uid instead of creating a duplicate container.
    const uid = `p${hashFn(drawingUid)}`;
    try {
      await api.data.block.create({
        location: { "parent-uid": drawingUid, order: "last" },
        block: { uid, string: CONTAINER_STRING, open: false },
      });
    } catch (error) {
      const found = findContainer(pullBlock(drawingUid));
      if (found) return found.uid;
      if (!pullBlock(uid)) throw error;
    }
    return uid;
  }

  async function createRegion(parentUid, regionString) {
    const graph = api.graph.name;
    const lock = await withLockFn(lockName(graph, parentUid), async () => {
      const containerUid = await ensureRegionContainer(parentUid);
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

  function pageUidByTitle(title) {
    const raw = api.data.pull("[:block/uid]", [":node/title", title]);
    return raw?.[":block/uid"] || null;
  }

  function resolveUidKind(uid) {
    if (!uid) return null;
    const raw = api.data.pull("[:node/title :block/string]", [":block/uid", uid]);
    if (!raw) return null;
    if (raw[":node/title"] != null) return "page";
    if (raw[":block/string"] != null) return "block";
    return null;
  }

  async function ensurePage(title) {
    const existing = pageUidByTitle(title);
    if (existing) return existing;
    const uid = api.util.generateUID();
    try {
      await api.data.page.create({ page: { title, uid } });
    } catch (error) {
      const found = pageUidByTitle(title);
      if (found) return found;
      throw error;
    }
    return pageUidByTitle(title) || uid;
  }

  // create({pageUid, parentUid, title}): with a title the drawing goes under page "Drawings/<title>" (reused if present).
  async function createDrawing({ pageUid, parentUid, title } = {}) {
    let page = pageUid;
    let parent = parentUid || pageUid;
    if (title) {
      page = await ensurePage(`Drawings/${title}`);
      parent = page;
    }
    if (!parent) throw new Error("[plexus] createDrawing needs pageUid, parentUid, or title");
    const uid = api.util.generateUID();
    await api.data.block.create({
      location: { "parent-uid": parent, order: "last" },
      block: { uid, string: DRAWING_STRING },
    });
    return { uid, pageUid: page || null };
  }

  const DRAWINGS_QUERY = `[:find ?u ?s ?o :in $ ?pu :where [?p :block/uid ?pu] [?b :block/page ?p] [?b :block/uid ?u] [?b :block/string ?s] [?b :block/order ?o] (or [(clojure.string/starts-with? ?s "{{[[excalidraw]]}}")] [(clojure.string/starts-with? ?s "{{excalidraw}}")])]`;

  function drawingsOn(pageUid) {
    if (!pageUid) return [];
    const rows = api.data.q(DRAWINGS_QUERY, pageUid) || [];
    return rows
      .filter((r) => DRAWING_START.test(String(r[1])))
      .sort((a, b) => (a[2] ?? 0) - (b[2] ?? 0))
      .slice(0, DRAWINGS_CAP)
      .map((r) => r[0]);
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

  // Block: string + children to depth 2. Page: title + first-level children. At most EMBED_CAP child blocks in total.
  function pullEmbedContent(ref) {
    const target = parseEmbedTarget(ref);
    if (!target) return null;
    let raw;
    try {
      raw = api.data.pull(EMBED_PATTERN, target.title != null ? [":node/title", target.title] : [":block/uid", target.uid]);
    } catch (error) {
      console.warn("[plexus] embed pull failed", error);
      return null;
    }
    if (!raw || !raw[":block/uid"]) return null;
    const isPage = raw[":node/title"] != null;
    let budget = EMBED_CAP;
    const take = (nodes, depth) => {
      const out = [];
      for (const n of [...(nodes || [])].sort(byOrder)) {
        if (budget <= 0) break;
        budget--;
        out.push({ string: n[":block/string"] ?? "", children: depth > 1 ? take(n[":block/children"], depth - 1) : [] });
      }
      return out;
    };
    return {
      kind: isPage ? "page" : "block",
      uid: raw[":block/uid"],
      title: isPage ? raw[":node/title"] : "",
      pageTitle: isPage ? "" : (raw[":block/page"]?.[":node/title"] ?? ""),
      string: isPage ? "" : (raw[":block/string"] ?? ""),
      children: take(raw[":block/children"], isPage ? 1 : 2),
    };
  }

  function watchEmbed(uid, cb) {
    if (!uid || typeof api.data?.addPullWatch !== "function") return () => {};
    const ident = `[:block/uid "${String(uid).replace(/["\\]/g, "")}"]`;
    const handler = (before, after) => {
      try { cb(before, after); } catch (error) { console.warn("[plexus] embed watch callback failed", error); }
    };
    api.data.addPullWatch(EMBED_PATTERN, ident, handler);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      try { api.data.removePullWatch(EMBED_PATTERN, ident, handler); } catch (error) { console.warn("[plexus] removePullWatch failed", error); }
    };
  }

  return {
    graphName() { return api.graph.name; },
    isEncrypted() { return !!api.graph.isEncrypted; },
    pullBlock,
    drawing,
    regionsOf,
    ensureRegionContainer,
    createRegion,
    createDrawing,
    drawingsOn,
    resolveUidKind,
    openBlock,
    blockUidFromNode,
    pullEmbedContent,
    watchEmbed,
  };
}
