import test from "node:test";
import assert from "node:assert/strict";
import { cardsFromQuery, cardsFromChildren } from "../src/query-cards.js";
import { makeEmbedAnchor } from "../src/model/embeds.js";

const uid = (n) => `u${String(n).padStart(8, "0")}`;
const STRIDE_X = 400;
const STRIDE_Y = 240;

function rects(elements) {
  return elements.filter((el) => el.type === "rectangle");
}

function queryCard(n, sourceUid, deleted = false) {
  const [rect] = makeEmbedAnchor({ ref: `((${uid(n)}))`, x: 0, y: 0 });
  rect.customData.plexus.query = sourceUid;
  if (deleted) rect.isDeleted = true;
  return rect;
}

test("cardsFromQuery reads roamQuery :block/uid and ignores child shapes", async () => {
  const calls = [];
  const writes = [];
  const api = {
    data: {
      roamQuery: async (args) => {
        calls.push(args);
        return {
          total: 4,
          results: [
            { ":block/uid": uid(1), ":block/children": [{ ":block/uid": uid(9) }], children: [{ uid: uid(8) }] },
            { uid: uid(7) },
            { ":block/uid": uid(2) },
            { ":block/uid": uid(1) },
          ],
        };
      },
      pull: () => { writes.push("pull"); return { children: [{ uid: uid(6) }] }; },
      block: { create: (args) => { writes.push(args); } },
    },
  };
  const els = await cardsFromQuery({ api, sourceUid: "srcuid001", existing: [], origin: { x: 10, y: 20 } });
  assert.deepEqual(calls, [{ uid: "srcuid001", limit: 50 }]);
  assert.deepEqual(writes, []);
  const cards = rects(els);
  assert.equal(els.length, 4);
  assert.deepEqual(cards.map((c) => c.customData.plexus.embed), [`((${uid(1)}))`, `((${uid(2)}))`]);
  assert.ok(cards.every((c) => c.customData.plexus.query === "srcuid001"));
  assert.equal(cards[0].link, `((${uid(1)}))`);
  assert.equal(cards[0].strokeStyle, "dashed");
  assert.equal(cards[0].width, 360);
  assert.equal(cards[0].height, 200);
  assert.equal(cards[0].x, 10);
  assert.equal(cards[0].y, 20);
  assert.equal(cards[1].x, 10 + STRIDE_X);
  assert.equal(cards[1].y, 20);
  assert.equal(els[1].type, "text");
  assert.equal(els[1].containerId, cards[0].id);
  assert.equal(els[1].customData, undefined);
  assert.equal(cards[0].boundElements[0].id, els[1].id);
  assert.equal(els[1].text, `((${uid(1)}))`);
});

test("cardsFromQuery returns [] when roamQuery throws or is not a list", async () => {
  const boom = { data: { roamQuery: async () => { throw new Error("query failed"); } } };
  assert.deepEqual(await cardsFromQuery({ api: boom, sourceUid: "srcuid001", existing: [], origin: { x: 0, y: 0 } }), []);
  const sync = { data: { roamQuery: () => { throw new Error("sync"); } } };
  assert.deepEqual(await cardsFromQuery({ api: sync, sourceUid: "srcuid001", existing: [] }), []);
  const bad = { data: { roamQuery: async () => ({ ":block/uid": uid(1) }) } };
  assert.deepEqual(await cardsFromQuery({ api: bad, sourceUid: "srcuid001", existing: [] }), []);
  assert.deepEqual(await cardsFromQuery({ api: {}, sourceUid: "srcuid001" }), []);
});

test("cardsFromChildren reads uid or :block/uid and does not call roamQuery", () => {
  let called = false;
  const api = { data: { roamQuery: () => { called = true; } } };
  const els = cardsFromChildren({
    children: [{ uid: uid(1) }, { ":block/uid": uid(2) }, { uid: uid(1) }, null, { uid: "" }],
    sourceUid: "pageuid01",
    existing: [],
    origin: { x: 0, y: 0 },
    api,
  });
  assert.equal(called, false);
  const cards = rects(els);
  assert.deepEqual(cards.map((c) => c.customData.plexus.embed), [`((${uid(1)}))`, `((${uid(2)}))`]);
  assert.ok(cards.every((c) => c.customData.plexus.query === "pageuid01" && c.customData.plexus.embed.startsWith("((")));
  assert.equal(cards[0].type, "rectangle");
  assert.equal(els[1].containerId, cards[0].id);
});

test("a uid already embedded on any live element is skipped", async () => {
  const [plain] = makeEmbedAnchor({ ref: `((${uid(1)}))`, x: 0, y: 0 });
  const [other] = makeEmbedAnchor({ ref: `((${uid(3)}))`, x: 0, y: 0 });
  other.customData.plexus.query = "othersrc1";
  const deleted = queryCard(4, "srcuid001", true);
  const api = {
    data: {
      roamQuery: async () => ({
        total: 4,
        results: [uid(1), uid(3), uid(4), uid(2)].map((id) => ({ ":block/uid": id })),
      }),
    },
  };
  const els = await cardsFromQuery({
    api,
    sourceUid: "srcuid001",
    existing: [plain, other, deleted, { customData: { plexus: { embed: "[[A Page]]" } } }],
    origin: { x: 0, y: 0 },
  });
  assert.deepEqual(rects(els).map((c) => c.customData.plexus.embed), [`((${uid(4)}))`, `((${uid(2)}))`]);
});

test("a second run that already has 50 cards for the source returns []", async () => {
  const existing = Array.from({ length: 50 }, (_, i) => queryCard(i, "srcuid001"));
  let calls = 0;
  const api = {
    data: {
      roamQuery: async () => {
        calls += 1;
        return [{ ":block/uid": uid(90) }];
      },
    },
  };
  assert.deepEqual(await cardsFromQuery({ api, sourceUid: "srcuid001", existing, origin: { x: 0, y: 0 } }), []);
  assert.equal(calls, 1);
  assert.deepEqual(cardsFromChildren({
    children: [{ uid: uid(90) }],
    sourceUid: "srcuid001",
    existing,
    origin: { x: 0, y: 0 },
  }), []);
});

test("forty cards for the source add at most ten, on a 4-column grid from origin", async () => {
  const existing = Array.from({ length: 40 }, (_, i) => queryCard(i, "srcuid001"));
  for (let i = 0; i < 50; i++) existing.push(queryCard(100 + i, "othersrc1"));
  const results = Array.from({ length: 15 }, (_, i) => ({ ":block/uid": uid(40 + i) }));
  const api = { data: { roamQuery: async () => results } };
  const els = await cardsFromQuery({ api, sourceUid: "srcuid001", existing, origin: { x: 5, y: 6 } });
  const cards = rects(els);
  assert.equal(cards.length, 10);
  assert.equal(els.length, 20);
  cards.forEach((card, i) => {
    assert.equal(card.customData.plexus.embed, `((${uid(40 + i)}))`);
    assert.equal(card.customData.plexus.query, "srcuid001");
    assert.equal(card.x, 5 + (i % 4) * STRIDE_X);
    assert.equal(card.y, 6 + Math.floor(i / 4) * STRIDE_Y);
  });
  const fromChildren = cardsFromChildren({
    children: results,
    sourceUid: "srcuid001",
    existing,
    origin: { x: 5, y: 6 },
  });
  assert.deepEqual(rects(fromChildren).map((c) => c.customData.plexus.embed), cards.map((c) => c.customData.plexus.embed));
});

test("cards for another source do not use this source cap", async () => {
  const existing = Array.from({ length: 50 }, (_, i) => queryCard(i, "othersrc1"));
  const results = Array.from({ length: 3 }, (_, i) => ({ ":block/uid": uid(200 + i) }));
  const api = { data: { roamQuery: async () => results } };
  const cards = rects(await cardsFromQuery({ api, sourceUid: "srcuid001", existing, origin: { x: 1, y: 2 } }));
  assert.equal(cards.length, 3);
  assert.equal(cards[2].x, 1 + 2 * STRIDE_X);
  assert.equal(cards[2].y, 2);
});

test("the fifth new card wraps to the next row", () => {
  const children = Array.from({ length: 5 }, (_, i) => ({ uid: uid(i) }));
  const cards = rects(cardsFromChildren({ children, sourceUid: "pageuid01", existing: [], origin: { x: 8, y: 9 } }));
  assert.equal(cards.length, 5);
  assert.equal(cards[3].x, 8 + 3 * STRIDE_X);
  assert.equal(cards[3].y, 9);
  assert.equal(cards[4].x, 8);
  assert.equal(cards[4].y, 9 + STRIDE_Y);
});
