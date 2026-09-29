import { DEFAULT_PAD, geometryKey, parseRegion, serializeRegion } from "./model/region.js";
import { regionSceneBBox, cropSvgToFraction } from "./model/scene.js";
import { captionFromElements } from "./model/caption.js";
import { cropKey } from "./host/cache.js";
import { startImageRegionTool } from "./view/image-region-tool.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(fn, timeoutMs, stepMs = 50) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = fn();
    if (value) return value;
    if (Date.now() >= end) return null;
    await sleep(stepMs);
  }
}

function svgSize(svg) {
  const vb = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(svg);
  if (vb) return { w: Math.round(Number(vb[1])), h: Math.round(Number(vb[2])) };
  return { w: 0, h: 0 };
}

export function createActions({ host, native, cache, cold, toaster, spotlight, getSettings, doc, clipboard }) {
  const sceneElements = (app) => app.getSceneElements?.() ?? app.getSceneElementsIncludingDeleted?.() ?? [];

  async function putSvg(uid, region, svg) {
    const drawing = host.drawing(region.drawingUid);
    if (!svg || !drawing) return;
    const key = cropKey({ regionUid: uid, geometryKey: geometryKey(region), drawingHash: drawing.hash, tier: "svg" });
    await cache.put(key, new Blob([svg], { type: "image/svg+xml" }), svgSize(svg));
  }

  async function finishCreate(region, svg) {
    const uid = await host.createRegion(region.drawingUid, serializeRegion(region));
    try {
      await putSvg(uid, region, svg);
    } catch (error) {
      console.warn("[plexus] cache put failed", error);
    }
    try {
      await clipboard.writeText(`((${uid}))`);
      toaster.show(`Region ((${uid})) copied`);
    } catch (error) {
      console.warn("[plexus] clipboard failed", error);
      toaster.show(`Region ((${uid})) created`);
    }
    return uid;
  }

  async function captureSafe(app, ids) {
    try {
      return await native.captureSelectionSvg(app, ids, { clipboard });
    } catch (error) {
      console.warn("[plexus] svg capture failed", error);
      return null;
    }
  }

  return {
    async createAreaRegion() {
      const editor = native.activeEditor(doc);
      if (!editor) {
        toaster.show("Open a drawing full-screen first", { kind: "error" });
        return null;
      }
      const { app, drawingUid } = editor;
      const ids = native.selectedElementIds(app);
      if (!ids.length) {
        toaster.show("Select some elements first", { kind: "error" });
        return null;
      }
      const caption = captionFromElements(sceneElements(app), ids) || "Region";
      const region = { kind: "area", drawingUid, ids, pad: DEFAULT_PAD, caption };
      const svg = await captureSafe(app, ids);
      return finishCreate(region, svg);
    },

    async createImageRegion() {
      const editor = native.activeEditor(doc);
      if (!editor) {
        toaster.show("Open a drawing full-screen first", { kind: "error" });
        return null;
      }
      const { app, drawingUid } = editor;
      const ids = native.selectedElementIds(app);
      const element = ids.length === 1 ? sceneElements(app).find((el) => el.id === ids[0] && !el.isDeleted) : null;
      if (!element || element.type !== "image") {
        toaster.show("Select exactly one image", { kind: "error" });
        return null;
      }
      if (element.angle) {
        toaster.show("Rotated images are not supported", { kind: "error" });
        return null;
      }
      const f = await startImageRegionTool({ app, element, doc });
      if (!f) return null;
      const region = { kind: "rect", drawingUid, el: element.id, f, caption: "Image region" };
      let svg = await captureSafe(app, [element.id]);
      if (svg) {
        try {
          svg = cropSvgToFraction(svg, f);
        } catch (error) {
          console.warn("[plexus] svg crop failed", error);
          svg = null;
        }
      }
      return finishCreate(region, svg);
    },

    async openRegion(regionUid, { sidebar = false } = {}) {
      const block = host.pullBlock(regionUid);
      const region = block ? parseRegion(block.string) : null;
      if (!region || !region.supported) {
        toaster.show("Region cannot be opened", { kind: "error" });
        return null;
      }
      const uid = region.drawingUid;
      const matches = () => {
        const ed = native.activeEditor(doc);
        return ed && ed.drawingUid === uid ? ed : null;
      };
      if (!matches()) {
        await host.openBlock(uid, { sidebar });
        const icon = await waitFor(() => {
          for (const el of doc.querySelectorAll('[id^="block-input-"]')) {
            if (!el.id.endsWith(uid)) continue;
            const found = el.querySelector(".excalidraw-outer-container .bp3-icon-fullscreen");
            if (found) return found;
          }
          return null;
        }, 3000);
        if (!icon) {
          toaster.show("Could not find the drawing", { kind: "error" });
          return null;
        }
        const View = doc.defaultView;
        for (const type of ["mousedown", "mouseup", "click"]) {
          icon.dispatchEvent(new View.MouseEvent(type, { bubbles: true, cancelable: true, view: View }));
        }
      }
      const editor = await waitFor(matches, 10000);
      if (!editor) {
        toaster.show("Drawing did not open", { kind: "error" });
        return null;
      }
      const { app } = editor;
      const box = regionSceneBBox(region, sceneElements(app));
      if (box.error) {
        toaster.show(`Region unavailable (${box.error})`, { kind: "error" });
        return null;
      }
      native.zoomTo(app, box.bbox);
      await sleep(60);
      spotlight({ rect: native.viewportRectOf(app, box.bbox), doc });
      return uid;
    },

    async refreshCropsForOpenDrawing() {
      const editor = native.activeEditor(doc);
      if (!editor) {
        toaster.show("Open a drawing full-screen first", { kind: "error" });
        return 0;
      }
      let count = 0;
      for (const { uid, region } of host.regionsOf(editor.drawingUid)) {
        if (!region?.supported) continue;
        try {
          const ids = region.kind === "area" ? region.ids : [region.el];
          let svg = await native.captureSelectionSvg(editor.app, ids, { clipboard });
          if (region.kind === "rect") svg = cropSvgToFraction(svg, region.f);
          await putSvg(uid, region, svg);
          count += 1;
        } catch (error) {
          console.warn("[plexus] refresh failed", uid, error);
        }
      }
      toaster.show(`Refreshed ${count} crop${count === 1 ? "" : "s"}`);
      return count;
    },

    async clearCache() {
      await cache.clear();
      toaster.show("Crop cache cleared");
    },
  };
}
