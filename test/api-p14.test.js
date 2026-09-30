import test from "node:test";
import assert from "node:assert/strict";
import { createPublicApi } from "../src/api.js";
import { linksIn } from "../src/model/links.js";
import { framesIn } from "../src/model/frames.js";

const elements = [
  {
    id: "el-link",
    type: "text",
    text: "see target",
    link: "((target-uid))",
    isDeleted: false,
  },
  {
    id: "el-frame",
    type: "frame",
    name: "Intro",
    x: 0,
    y: 0,
    customData: { plexus: { order: 1 } },
    isDeleted: false,
  },
];

function apiWith(drawing) {
  return createPublicApi({
    host: {
      drawing(uid) {
        if (uid === "missing") return null;
        if (uid === "boom") throw new Error("drawing failed");
        return drawing(uid);
      },
    },
  });
}

test("linksOf and framesOf read host.drawing elements", () => {
  const api = apiWith(() => ({ elements }));
  const links = api.linksOf("draw-1");
  const frames = api.framesOf("draw-1");
  assert.deepEqual(links, linksIn(elements));
  assert.deepEqual(frames, framesIn(elements));
  assert.ok(links.length > 0);
  assert.ok(frames.length > 0);
  assert.deepEqual(api.linksOf("missing"), []);
  assert.deepEqual(api.framesOf("missing"), []);
  assert.deepEqual(api.linksOf("boom"), []);
  assert.deepEqual(api.framesOf("boom"), []);
});

test("open with a frame id calls whenOpen then zoomTo", async () => {
  const zoomed = [];
  const app = { id: "app" };
  const scene = {
    zoomTo(ids) {
      zoomed.push(ids);
      return scene;
    },
  };
  let opened;
  const api = createPublicApi({
    host: {
      drawing() {
        return { elements: [] };
      },
      pullBlock() {
        return { string: "{{[[excalidraw]]}}" };
      },
    },
    scenes: {
      sceneOf() {
        return null;
      },
      activeUid() {
        return null;
      },
      async ready() {
        return true;
      },
      sceneFor() {
        return scene;
      },
    },
    openDrawing(uid, opts) {
      opened = [uid, opts];
      return { app };
    },
  });
  const result = await api.open("block-1", { frame: "el-frame", sidebar: true });
  assert.deepEqual(opened, ["block-1", { sidebar: true }]);
  assert.deepEqual(zoomed, [["el-frame"]]);
  assert.equal(result, scene);
});

test("a non-string frame is not a region flag", () => {
  const calls = [];
  const api = createPublicApi({
    host: {
      openBlock(uid, opts) {
        calls.push(["block", uid, opts]);
        return "block";
      },
    },
    actions: {
      openRegion(uid, opts) {
        calls.push(["region", uid, opts]);
        return "region";
      },
    },
  });
  assert.equal(api.open("uid-2", { frame: true, region: false, sidebar: true }), "block");
  assert.deepEqual(calls, [["block", "uid-2", { sidebar: true }]]);
});
