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
const CARDS_STRING = "{{[[plexus-cards]]}}";
const PATH_CAP = 100;

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

  // { string, pageTitle } of a block; pageTitle is set only when its direct parent is a page. Null for a missing block.
  function labelSource(uid) {
    if (!uid) return null;
    const raw = api.data.pull("[:block/uid :block/string {:block/_children [:node/title]}]", [":block/uid", uid]);
    if (!raw || !raw[":block/uid"]) return null;
    const parents = raw[":block/_children"];
    const parent = Array.isArray(parents) ? parents[0] : parents;
    return { string: raw[":block/string"] ?? "", pageTitle: parent?.[":node/title"] ?? null };
  }

  const REGION_ROWS_QUERY = `[:find ?u ?s ?cu :where [?c :block/string "${CONTAINER_STRING}"] [?c :block/uid ?cu] [?c :block/children ?b] [?b :block/uid ?u] [?b :block/string ?s]]`;

  // Every child of a region container in the graph: [{ uid, string, containerUid }], stable by uid.
  function allRegionBlocks() {
    const rows = api.data.q(REGION_ROWS_QUERY) || [];
    return rows
      .map((r) => ({ uid: r[0], string: String(r[1] ?? ""), containerUid: r[2] }))
      .sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
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

  // Creates several region blocks under one lock and one container. Stops at the first failure and returns the uids made.
  async function createRegions(drawingUid, regionStrings) {
    const graph = api.graph.name;
    const made = [];
    const lock = await withLockFn(lockName(graph, drawingUid), async () => {
      const containerUid = await ensureRegionContainer(drawingUid);
      for (const string of regionStrings || []) {
        const uid = api.util.generateUID();
        try {
          await api.data.block.create({
            location: { "parent-uid": containerUid, order: "last" },
            block: { uid, string },
          });
        } catch (error) {
          console.warn("[plexus] create regions stopped", error);
          break;
        }
        made.push(uid);
      }
      return made;
    });
    if (!lock.acquired) throw new Error("[plexus] could not acquire drawing lock");
    return lock.value;
  }

  // With { expect }, the block is re-pulled inside the lock and the write throws (code "changed") when its string differs.
  async function updateRegionString(drawingUid, regionUid, regionString, { expect } = {}) {
    const graph = api.graph.name;
    const lock = await withLockFn(lockName(graph, drawingUid), async () => {
      if (expect !== undefined && pullBlock(regionUid)?.string !== expect) {
        throw Object.assign(new Error("[plexus] region changed elsewhere"), { code: "changed" });
      }
      await api.data.block.update({ block: { uid: regionUid, string: regionString } });
      return regionUid;
    });
    if (!lock.acquired) throw new Error("[plexus] could not acquire drawing lock");
    return lock.value;
  }

  const AUDIT_REGION_QUERY = (page) => `[:find ?u ?s ?pu ?ps ?pt ${page ? ":in $ ?pg" : ""} :where [?r :node/title "plexus-region"] [?b :block/refs ?r] [?b :block/uid ?u] [?b :block/string ?s] [?b :block/page ?p] [?p :block/uid ?pg2] [?p :node/title ?pt] ${page ? "[(= ?pg2 ?pg)]" : ""} [?par :block/children ?b] [?par :block/uid ?pu] [(get-else $ ?par :block/string "") ?ps]]`;
  const AUDIT_CONTAINER_QUERY = (page) => `[:find ?cu ?pu ?ps ?pt ${page ? ":in $ ?pg" : ""} :where [?c :block/string "${CONTAINER_STRING}"] [?c :block/uid ?cu] [?c :block/page ?p] [?p :block/uid ?pg2] [?p :node/title ?pt] ${page ? "[(= ?pg2 ?pg)]" : ""} [?par :block/children ?c] [?par :block/uid ?pu] [(get-else $ ?par :block/string "") ?ps]]`;
  const byUid = (a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0);

  // Uid of the page the main window shows (a block resolves to its page); null when nothing is open.
  async function openPageUid() {
    let uid;
    try { uid = await api.ui?.mainWindow?.getOpenPageOrBlockUid?.(); } catch { uid = null; }
    if (!uid) return null;
    let raw;
    try { raw = api.data.pull("[:node/title {:block/page [:block/uid]}]", [":block/uid", uid]); } catch { raw = null; }
    if (!raw) return null;
    if (raw[":node/title"] != null) return uid;
    const page = raw[":block/page"];
    return (Array.isArray(page) ? page[0] : page)?.[":block/uid"] ?? null;
  }

  // Blocks that reference page plexus-region, each with its parent: [{ uid, string, parentUid, parentString, pageTitle }].
  // { pageUid } limits the query to one page.
  function regionBlocksForAudit({ pageUid } = {}) {
    const rows = (pageUid ? api.data.q(AUDIT_REGION_QUERY(true), pageUid) : api.data.q(AUDIT_REGION_QUERY(false))) || [];
    return rows
      .map((r) => ({ uid: r[0], string: String(r[1] ?? ""), parentUid: r[2], parentString: String(r[3] ?? ""), pageTitle: r[4] ?? null }))
      .sort(byUid);
  }

  // Region containers with the block that owns each: [{ uid, ownerUid, ownerString, pageTitle }].
  function containersForAudit({ pageUid } = {}) {
    const rows = (pageUid ? api.data.q(AUDIT_CONTAINER_QUERY(true), pageUid) : api.data.q(AUDIT_CONTAINER_QUERY(false))) || [];
    return rows
      .map((r) => ({ uid: r[0], ownerUid: r[1], ownerString: String(r[2] ?? ""), pageTitle: r[3] ?? null }))
      .sort(byUid);
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

  // A page whose title is a daily-note title keeps Roam's daily uid (MM-DD-YYYY), so the native daily page is never duplicated.
  async function ensurePage(title) {
    const existing = pageUidByTitle(title);
    if (existing) return existing;
    let uid;
    try {
      const date = api.util?.pageTitleToDate?.(title);
      if (date instanceof Date && !Number.isNaN(date.getTime()) && typeof api.util.dateToPageUid === "function") uid = api.util.dateToPageUid(date);
    } catch { uid = undefined; }
    uid = uid || api.util.generateUID();
    try {
      await api.data.page.create({ page: { title, uid } });
    } catch (error) {
      const found = pageUidByTitle(title);
      if (found) return found;
      throw error;
    }
    return pageUidByTitle(title) || uid;
  }

  // create({pageUid, parentUid, title, order}): with a title the drawing goes under page "Drawings/<title>" (reused if present).
  // order is "last" (default) or a number.
  async function createDrawing({ pageUid, parentUid, title, order = "last" } = {}) {
    let page = pageUid;
    let parent = parentUid || pageUid;
    if (title) {
      page = await ensurePage(`Drawings/${title}`);
      parent = page;
    }
    if (!parent) throw new Error("[plexus] createDrawing needs pageUid, parentUid, or title");
    const uid = api.util.generateUID();
    await api.data.block.create({
      location: { "parent-uid": parent, order },
      block: { uid, string: DRAWING_STRING },
    });
    return { uid, pageUid: page || null };
  }

  const BLOCK_INFO_PATTERN = "[:block/uid :block/string :block/order :node/title {:block/_children [:block/uid :block/string :node/title]} {:block/page [:block/uid :node/title]}]";
  const one = (v) => (Array.isArray(v) ? v[0] : v);

  // Where a block sits: { uid, string, order, parentUid, parentString, parentIsPage, pageUid, pageTitle }. Null for a missing block or a page.
  function blockInfo(uid) {
    if (!uid) return null;
    let raw;
    try { raw = api.data.pull(BLOCK_INFO_PATTERN, [":block/uid", uid]); } catch { raw = null; }
    if (!raw || !raw[":block/uid"] || raw[":node/title"] != null) return null;
    const parent = one(raw[":block/_children"]);
    const page = one(raw[":block/page"]);
    return {
      uid: raw[":block/uid"],
      string: raw[":block/string"] ?? "",
      order: raw[":block/order"] ?? 0,
      parentUid: parent?.[":block/uid"] ?? null,
      parentString: parent?.[":block/string"] ?? "",
      parentIsPage: parent?.[":node/title"] != null,
      pageUid: page?.[":block/uid"] ?? null,
      pageTitle: page?.[":node/title"] ?? null,
    };
  }

  // The top-level block above (or equal to) uid: { uid, order, pageUid }. Null when the chain cannot be read.
  function topAncestor(uid) {
    let cur = uid;
    for (let i = 0; i < PATH_CAP && cur; i++) {
      const info = blockInfo(cur);
      if (!info) return null;
      if (info.parentIsPage) return { uid: info.uid, order: info.order, pageUid: info.parentUid };
      cur = info.parentUid;
    }
    return null;
  }

  // For each existing block uid: { ancestors: [uid...], orders: [order...] } from the page down to the block (own order last).
  // Missing blocks and pages are absent from the map. Parent lookups are memoized across the call.
  function blockPaths(uids) {
    const nodes = new Map();
    const node = (uid) => {
      if (nodes.has(uid)) return nodes.get(uid);
      let value = null;
      try {
        const raw = api.data.pull("[:block/uid :block/order :node/title {:block/_children [:block/uid :node/title]}]", [":block/uid", uid]);
        if (raw && raw[":block/uid"]) {
          const parent = one(raw[":block/_children"]);
          value = { order: raw[":block/order"] ?? 0, isPage: raw[":node/title"] != null, parentUid: parent?.[":block/uid"] ?? null, parentIsPage: parent?.[":node/title"] != null };
        }
      } catch { value = null; }
      nodes.set(uid, value);
      return value;
    };
    const out = new Map();
    for (const uid of uids || []) {
      const own = node(uid);
      if (!own || own.isPage) continue;
      const ancestors = [];
      const orders = [own.order];
      let cur = own;
      for (let i = 0; i < PATH_CAP && cur && !cur.parentIsPage && cur.parentUid; i++) {
        ancestors.unshift(cur.parentUid);
        cur = node(cur.parentUid);
        if (cur) orders.unshift(cur.order);
      }
      out.set(uid, { ancestors, orders });
    }
    return out;
  }

  function pageTitleOf(pageUid) {
    if (!pageUid) return null;
    try { return api.data.pull("[:node/title]", [":block/uid", pageUid])?.[":node/title"] ?? null; } catch { return null; }
  }

  // Generic block create. Returns the uid.
  async function createBlock({ parentUid, order = "last", string = "", uid, open } = {}) {
    if (!parentUid) throw new Error("[plexus] createBlock needs parentUid");
    const id = uid || api.util.generateUID();
    await api.data.block.create({
      location: { "parent-uid": parentUid, order },
      block: { uid: id, string, ...(open === undefined ? {} : { open }) },
    });
    return id;
  }

  async function deleteBlock(uid) {
    await api.data.block.delete({ block: { uid } });
    return true;
  }

  // The {{[[plexus-cards]]}} container of a drawing (collapsed, deterministic uid distinct from the regions container's).
  async function ensureCardsContainer(drawingUid) {
    const find = () => pullBlock(drawingUid)?.children.find((c) => c.string.trim() === CARDS_STRING) || null;
    const existing = find();
    if (existing) return existing.uid;
    const uid = `c${hashFn(drawingUid)}`;
    try {
      await api.data.block.create({
        location: { "parent-uid": drawingUid, order: "last" },
        block: { uid, string: CARDS_STRING, open: false },
      });
    } catch (error) {
      const found = find();
      if (found) return found.uid;
      if (!pullBlock(uid)) throw error;
    }
    return uid;
  }

  // A new empty block under the drawing's cards container, made under the drawing lock. Returns the uid.
  async function createCard(drawingUid) {
    const lock = await withLockFn(lockName(api.graph.name, drawingUid), async () => {
      const containerUid = await ensureCardsContainer(drawingUid);
      return createBlock({ parentUid: containerUid, order: "last", string: "" });
    });
    if (!lock.acquired) throw new Error("[plexus] could not acquire drawing lock");
    return lock.value;
  }

  const DRAWINGS_QUERY = `[:find ?u ?s ?o :in $ ?pu :where [?p :block/uid ?pu] [?b :block/page ?p] [?b :block/uid ?u] [?b :block/string ?s] [?b :block/order ?o] (or [(clojure.string/starts-with? ?s "{{[[excalidraw]]}}")] [(clojure.string/starts-with? ?s "{{excalidraw}}")])]`;

  // First (by order) direct child of a page whose string starts with a drawing macro. Null when there is none.
  function firstDrawingChild(pageUid) {
    if (!pageUid) return null;
    let raw;
    try { raw = api.data.pull("[:block/uid {:block/children [:block/uid :block/string :block/order]}]", [":block/uid", pageUid]); } catch { raw = null; }
    const hit = [...(raw?.[":block/children"] || [])].sort(byOrder).find((c) => DRAWING_START.test(String(c[":block/string"] ?? "")));
    return hit?.[":block/uid"] ?? null;
  }

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
    labelSource,
    allRegionBlocks,
    ensureRegionContainer,
    createRegion,
    createRegions,
    updateRegionString,
    openPageUid,
    regionBlocksForAudit,
    containersForAudit,
    createDrawing,
    ensurePage,
    pageUidByTitle,
    pageTitleOf,
    blockInfo,
    topAncestor,
    blockPaths,
    createBlock,
    deleteBlock,
    ensureCardsContainer,
    createCard,
    firstDrawingChild,
    drawingsOn,
    resolveUidKind,
    openBlock,
    blockUidFromNode,
    pullEmbedContent,
    watchEmbed,
  };
}
