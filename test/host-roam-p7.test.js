import test from "node:test";
import assert from "node:assert/strict";
import { createRoamHost } from "../src/host/roam.js";

test("labelSource returns the string and the page title only for a direct page child", () => {
  const pulls = {
    onpage001: { ":block/uid": "onpage001", ":block/string": "{{[[excalidraw]]}}", ":block/_children": [{ ":node/title": "Kitchen" }] },
    nested001: { ":block/uid": "nested001", ":block/string": "![a](u)", ":block/_children": [{}] },
    single001: { ":block/uid": "single001", ":block/string": "x", ":block/_children": { ":node/title": "One" } },
    empty0001: { ":block/uid": "empty0001" },
  };
  const seen = [];
  const host = createRoamHost({ api: { data: { pull: (pattern, ident) => { seen.push(pattern); return pulls[ident[1]] ?? null; } } } });
  assert.deepEqual(host.labelSource("onpage001"), { string: "{{[[excalidraw]]}}", pageTitle: "Kitchen" });
  assert.deepEqual(host.labelSource("nested001"), { string: "![a](u)", pageTitle: null });
  assert.deepEqual(host.labelSource("single001"), { string: "x", pageTitle: "One" });
  assert.deepEqual(host.labelSource("empty0001"), { string: "", pageTitle: null });
  assert.equal(host.labelSource("missing001"), null);
  assert.equal(host.labelSource(""), null);
  assert.match(seen[0], /:block\/_children \[:node\/title\]/);
});

test("allRegionBlocks maps the container query rows and sorts them by uid", () => {
  const queries = [];
  const host = createRoamHost({
    api: {
      data: {
        q: (query) => {
          queries.push(query);
          return [["bbb000001", "{{[[plexus-region]]: k=x}}", "cont00001"], ["aaa000001", null, "cont00002"]];
        },
      },
    },
  });
  assert.deepEqual(host.allRegionBlocks(), [
    { uid: "aaa000001", string: "", containerUid: "cont00002" },
    { uid: "bbb000001", string: "{{[[plexus-region]]: k=x}}", containerUid: "cont00001" },
  ]);
  assert.match(queries[0], /:block\/string "\{\{\[\[plexus-regions\]\]\}\}"/);
  assert.deepEqual(createRoamHost({ api: { data: { q: () => null } } }).allRegionBlocks(), []);
});
