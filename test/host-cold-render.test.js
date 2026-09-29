import test from "node:test";
import assert from "node:assert/strict";
import { createColdRenderer, cropCanvasToBlob } from "../src/host/cold-render.js";

function makeEnv({ ready = true } = {}) {
  const log = [];
  const doc = {
    body: { appendChild: (el) => log.push(`append:${el.uid ?? "?"}`) },
    defaultView: {},
    createElement: (tag) => {
      if (tag === "canvas") return { width: 0, height: 0, getContext: () => ({ drawImage: (...a) => log.push(`draw:${a.length}`) }), toBlob: (cb, type) => cb({ type }) };
      return {
        tag, style: {}, img: null,
        setAttribute() {}, addEventListener() {}, removeEventListener() {},
        querySelector(sel) { assert.equal(sel, "img.rm-inline-img--excalidraw"); return this.img; },
        remove() { log.push("remove"); },
      };
    },
  };
  let active = 0;
  let maxActive = 0;
  const api = {
    ui: {
      components: {
        renderBlock: ({ uid, el }) => {
          active++; maxActive = Math.max(maxActive, active);
          el.uid = uid;
          log.push(`render:${uid}`);
          if (ready) el.img = { complete: true, naturalWidth: 500, naturalHeight: 160 };
        },
        unmountNode: ({ el }) => { active--; log.push(`unmount:${el.uid}`); },
      },
    },
  };
  return { api, doc, log, stats: () => ({ maxActive }) };
}

test("renders, copies to canvas before unmount, cleans up", async () => {
  const { api, doc, log } = makeEnv();
  const r = createColdRenderer({ api, doc, timeoutMs: 100 });
  const out = await r.renderDrawing("d1");
  assert.equal(out.naturalWidth, 500);
  assert.equal(out.naturalHeight, 160);
  assert.equal(out.canvas.width, 500);
  assert.ok(log.indexOf("draw:3") < log.indexOf("unmount:d1"));
  assert.ok(log.indexOf("unmount:d1") < log.indexOf("remove"));
});

test("same uid concurrent requests share one promise and one render", async () => {
  const { api, doc, log } = makeEnv();
  const r = createColdRenderer({ api, doc });
  const a = r.renderDrawing("d1");
  const b = r.renderDrawing("d1");
  assert.equal(a, b);
  await a;
  assert.equal(log.filter((l) => l === "render:d1").length, 1);
  await r.renderDrawing("d1");
  assert.equal(log.filter((l) => l === "render:d1").length, 2);
});

test("different uids are serialized", async () => {
  const { api, doc, log, stats } = makeEnv();
  const r = createColdRenderer({ api, doc });
  await Promise.all([r.renderDrawing("d1"), r.renderDrawing("d2"), r.renderDrawing("d3")]);
  assert.equal(stats().maxActive, 1);
  assert.deepEqual(log.filter((l) => l.startsWith("render:")), ["render:d1", "render:d2", "render:d3"]);
});

test("timeout resolves null and still unmounts", async () => {
  const { api, doc, log } = makeEnv({ ready: false });
  const r = createColdRenderer({ api, doc, timeoutMs: 20 });
  assert.equal(await r.renderDrawing("d1"), null);
  assert.ok(log.includes("unmount:d1"));
  assert.ok(log.includes("remove"));
});

test("renderBlock throwing resolves null; dispose then null", async () => {
  const { api, doc } = makeEnv();
  api.ui.components.renderBlock = () => { throw new Error("nope"); };
  const r = createColdRenderer({ api, doc });
  assert.equal(await r.renderDrawing("d1"), null);
  r.dispose();
  assert.equal(await r.renderDrawing("d2"), null);
});

test("cropCanvasToBlob crops to png blob", async () => {
  const { doc } = makeEnv();
  const blob = await cropCanvasToBlob({}, { sx: 10, sy: 10, sw: 240, sh: 160 }, { doc });
  assert.equal(blob.type, "image/png");
});

test("dispose cancels an in-flight render: unmounts and removes the host at once", async () => {
  const { api, doc, log } = makeEnv({ ready: false });
  const r = createColdRenderer({ api, doc, timeoutMs: 5000 });
  const p = r.renderDrawing("d1");
  await new Promise((res) => setTimeout(res, 10));
  assert.ok(!log.includes("unmount:d1"));
  r.dispose();
  assert.equal(await p, null);
  assert.ok(log.includes("unmount:d1"));
  assert.ok(log.includes("remove"));
});

test("image that becomes ready after renderBlock returns is picked up by the poll and cleans up", async () => {
  const { api, doc, log } = makeEnv({ ready: false });
  const render = api.ui.components.renderBlock;
  api.ui.components.renderBlock = (args) => {
    render(args);
    setTimeout(() => { args.el.img = { complete: true, naturalWidth: 0, naturalHeight: 0 }; }, 20);
    setTimeout(() => { args.el.img = { complete: true, naturalWidth: 320, naturalHeight: 90 }; }, 150);
  };
  const r = createColdRenderer({ api, doc, timeoutMs: 2000 });
  const out = await r.renderDrawing("d1");
  assert.equal(out.naturalWidth, 320);
  assert.equal(log.filter((l) => l === "unmount:d1").length, 1);
});

test("image ready via an injected MutationObserver", async () => {
  const { api, doc, log } = makeEnv({ ready: false });
  let observed = null;
  let disconnected = false;
  doc.defaultView.MutationObserver = class {
    constructor(cb) { this.cb = cb; observed = this; }
    observe() {}
    disconnect() { disconnected = true; }
  };
  const render = api.ui.components.renderBlock;
  api.ui.components.renderBlock = (args) => {
    render(args);
    setTimeout(() => { args.el.img = { complete: true, naturalWidth: 200, naturalHeight: 80 }; observed.cb(); }, 10);
  };
  const r = createColdRenderer({ api, doc, timeoutMs: 2000 });
  const out = await r.renderDrawing("d1");
  assert.equal(out.naturalWidth, 200);
  assert.ok(disconnected);
  assert.ok(log.includes("unmount:d1"));
});
