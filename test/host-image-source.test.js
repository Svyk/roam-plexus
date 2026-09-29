import test from "node:test";
import assert from "node:assert/strict";
import { loadImageBitmap, cropBitmapToBlob, clearImageMemo, polyPoints } from "../src/host/image-source.js";
import { cropCanvasToBlob } from "../src/host/cold-render.js";

function makeDoc() {
  const calls = [];
  return {
    calls,
    createElement() {
      const ctx = {
        beginPath: () => calls.push(["begin"]),
        moveTo: (x, y) => calls.push(["move", x, y]),
        lineTo: (x, y) => calls.push(["line", x, y]),
        closePath: () => calls.push(["close"]),
        clip: () => calls.push(["clip"]),
        drawImage: (...a) => calls.push(["draw", ...a.slice(1)]),
      };
      return { getContext: () => ctx, toBlob(cb) { cb({ blob: true }); } };
    },
  };
}

test("loadImageBitmap uses file.get once per url and memoizes", async () => {
  clearImageMemo();
  let gets = 0;
  const api = { file: { get: async ({ url }) => { gets++; return { url }; } } };
  const cb = async (f) => ({ from: f.url });
  const a = await loadImageBitmap("u1", { api, createBitmap: cb });
  const b = await loadImageBitmap("u1", { api, createBitmap: cb });
  assert.equal(a, b);
  assert.equal(gets, 1);
});

test("loadImageBitmap failure is not memoized", async () => {
  clearImageMemo();
  let n = 0;
  const api = { file: { get: async () => { if (++n === 1) throw new Error("x"); return {}; } } };
  await assert.rejects(loadImageBitmap("u2", { api, createBitmap: async () => 1 }));
  assert.equal(await loadImageBitmap("u2", { api, createBitmap: async () => 1 }), 1);
});

test("cropBitmapToBlob without poly does not clip; with poly clips before drawing", async () => {
  const doc = makeDoc();
  await cropBitmapToBlob({}, { sx: 1, sy: 2, sw: 10, sh: 20 }, { doc });
  assert.deepEqual(doc.calls.map((c) => c[0]), ["draw"]);
  doc.calls.length = 0;
  await cropBitmapToBlob({}, { sx: 1, sy: 2, sw: 10, sh: 20 }, { doc, poly: [0, 0, 1, 0, 0.5, 1] });
  assert.deepEqual(doc.calls.map((c) => c[0]), ["begin", "move", "line", "line", "close", "clip", "draw"]);
  assert.deepEqual(doc.calls[2], ["line", 10, 0]);
  assert.deepEqual(doc.calls[3], ["line", 5, 20]);
});

test("cropCanvasToBlob gains optional poly clip", async () => {
  const doc = makeDoc();
  await cropCanvasToBlob({}, { sx: 0, sy: 0, sw: 4, sh: 4 }, { doc, poly: [[0, 0], [1, 0], [1, 1]] });
  assert.ok(doc.calls.some((c) => c[0] === "clip"));
});

test("polyPoints rejects short or non-finite input", () => {
  assert.equal(polyPoints([0, 0, 1, 1]), null);
  assert.equal(polyPoints([0, 0, 1, 1, NaN, 2]), null);
  assert.equal(polyPoints([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]).length, 3);
});
