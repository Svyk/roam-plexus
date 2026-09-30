import test from "node:test";
import assert from "node:assert/strict";
import { createRoamHost } from "../src/host/roam.js";
import { fnv1a } from "../src/model/hash.js";

const immediate = async (name, fn) => ({ acquired: true, fallback: false, value: await fn() });

// nodes: uid -> { string, order, parent (uid or page title marker), title }
function fixture({ nodes = {}, pages = {}, util = {}, failCreate = null } = {}) {
  const created = [];
  const deleted = [];
  const pageCreates = [];
  let n = 0;
  const api = {
    graph: { name: "g" },
    util: { generateUID: () => `gen00000${++n}`, ...util },
    data: {
      pull: (pattern, ident) => {
        const [kind, key] = ident;
        if (kind === ":node/title") {
          const uid = pages[key];
          return uid ? { ":block/uid": uid, ":node/title": key } : null;
        }
        const page = Object.entries(pages).find(([, uid]) => uid === key);
        if (page) {
          const kids = Object.entries(nodes).filter(([, v]) => v.parent === key).map(([uid, v]) => ({ ":block/uid": uid, ":block/string": v.string, ":block/order": v.order }));
          return { ":block/uid": key, ":node/title": page[0], ":block/children": kids };
        }
        const node = nodes[key];
        if (!node) return null;
        const parentPage = Object.entries(pages).find(([, uid]) => uid === node.parent);
        const parent = parentPage
          ? { ":block/uid": node.parent, ":node/title": parentPage[0] }
          : { ":block/uid": node.parent, ":block/string": nodes[node.parent]?.string ?? "" };
        const kids = Object.entries(nodes).filter(([, v]) => v.parent === key).map(([uid, v]) => ({ ":block/uid": uid, ":block/string": v.string, ":block/order": v.order }));
        return {
          ":block/uid": key,
          ":block/string": node.string,
          ":block/order": node.order,
          ":block/_children": [parent],
          ":block/page": { ":block/uid": node.page, ":node/title": Object.keys(pages).find((t) => pages[t] === node.page) },
          ":block/children": kids,
        };
      },
      page: { create: async ({ page }) => { pageCreates.push(page); pages[page.title] = page.uid; } },
      block: {
        create: async ({ location, block }) => {
          if (failCreate && failCreate(block)) throw new Error("boom");
          created.push([location, block]);
          nodes[block.uid] = { string: block.string, order: 0, parent: location["parent-uid"], page: "pg0000001" };
        },
        delete: async ({ block }) => { deleted.push(block.uid); },
      },
    },
  };
  const host = createRoamHost({ api, withLockFn: immediate });
  return { host, api, created, deleted, pageCreates, nodes, pages };
}

test("parentOf wraps blockInfo for a page parent and a block parent", () => {
  const f = fixture({
    pages: { "September 29th, 2026": "09-29-2026" },
    nodes: { top000001: { string: "top", order: 2, parent: "09-29-2026", page: "09-29-2026" }, kid000001: { string: "kid", order: 0, parent: "top000001", page: "09-29-2026" } },
  });
  assert.deepEqual(f.host.parentOf("top000001"), { uid: "09-29-2026", isPage: true, title: "September 29th, 2026", pageTitle: "September 29th, 2026" });
  assert.deepEqual(f.host.parentOf("kid000001"), { uid: "top000001", isPage: false, title: "top", pageTitle: "September 29th, 2026" });
});

test("parentOf gives null for a page uid and a missing block", () => {
  const f = fixture({ pages: { P: "page00001" } });
  assert.equal(f.host.parentOf("page00001"), null);
  assert.equal(f.host.parentOf("missing001"), null);
  assert.equal(f.host.parentOf(""), null);
});
