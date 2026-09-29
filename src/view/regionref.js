import { parseRegion, geometryKey } from "../model/region.js";
import { regionSceneBBox, viewPngCropRect } from "../model/scene.js";
import { cropKey } from "../host/cache.js";
import { cropCanvasToBlob } from "../host/cold-render.js";

const CLAIMED = "data-plexus-claimed";

export function createRegionRefRenderer({ host, cache, cold, getSettings, onOpen, doc }) {
  const roots = new Map();

  const chip = (root, text) => {
    root.className = "plexus-root plexus-regionref plexus-chip";
    root.textContent = text;
  };

  const paint = (root, entry) => {
    if (!root.isConnected) return;
    const img = doc.createElement("img");
    img.className = "plexus-crop";
    img.draggable = false;
    img.style.maxHeight = `${getSettings().maxCropHeight}px`;
    img.src = entry.url;
    root.className = "plexus-root plexus-regionref";
    root.textContent = "";
    root.append(img);
  };

  const claim = (btn) => {
    try {
      if (btn.closest?.(".plexus-offscreen")) return;
      if (btn.getAttribute(CLAIMED)) return;
      const uid = host.blockUidFromNode(btn);
      if (!uid) return;
      const block = host.pullBlock(uid);
      const region = block ? parseRegion(block.string) : null;
      if (!region) return;

      btn.setAttribute(CLAIMED, "1");
      btn.classList.add("plexus-hidden");
      const root = doc.createElement("span");
      root.className = "plexus-root plexus-regionref";
      if (region.caption) root.title = region.caption;
      btn.parentNode.insertBefore(root, btn.nextSibling);
      roots.set(root, btn);

      if (!region.supported) {
        chip(root, region.error ? `Invalid region: ${region.error}` : `Region kind ${region.kind} needs a newer Plexus`);
        return;
      }

      root.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        e.preventDefault();
      }, true);
      root.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        try {
          onOpen(uid, { sidebar: !!getSettings().openInSidebar !== !!e.shiftKey });
        } catch (error) {
          console.warn("[plexus] open failed", error);
        }
      }, true);

      const drawing = host.drawing(region.drawingUid);
      if (!drawing) return chip(root, "Drawing not found");
      const sceneBox = regionSceneBBox(region, drawing.elements);
      if (sceneBox.error) return chip(root, `Region unavailable (${sceneBox.error})`);

      const gk = geometryKey(region);
      const svgKey = cropKey({ regionUid: uid, geometryKey: gk, drawingHash: drawing.hash, tier: "svg" });
      const pngKey = cropKey({ regionUid: uid, geometryKey: gk, drawingHash: drawing.hash, tier: "png" });

      const hot = cache.peek(svgKey) || cache.peek(pngKey);
      if (hot) return paint(root, hot);

      const [x1, y1, x2, y2] = sceneBox.bbox;
      const bw = Math.max(1, x2 - x1);
      const bh = Math.max(1, y2 - y1);
      const maxH = getSettings().maxCropHeight;
      const h = Math.min(maxH, bh);
      root.className = "plexus-root plexus-regionref plexus-placeholder";
      root.style.height = `${h}px`;
      root.style.width = `${Math.round((h * bw) / bh)}px`;

      void (async () => {
        try {
          let entry = (await cache.get(svgKey)) || (await cache.get(pngKey));
          if (!entry) {
            const rendered = await cold.renderDrawing(region.drawingUid);
            if (!root.isConnected) return;
            const crop = rendered
              ? viewPngCropRect({
                  elements: drawing.elements,
                  bbox: sceneBox.bbox,
                  naturalWidth: rendered.naturalWidth,
                  naturalHeight: rendered.naturalHeight,
                })
              : { error: "no-render" };
            if (crop.error) return finishChip(root);
            const blob = await cropCanvasToBlob(rendered.canvas, crop, { doc });
            await cache.put(pngKey, blob, { w: crop.sw, h: crop.sh });
            entry = cache.peek(pngKey) || (await cache.get(pngKey));
          }
          if (!root.isConnected) return;
          if (!entry) return finishChip(root);
          root.style.height = "";
          root.style.width = "";
          paint(root, entry);
        } catch (error) {
          console.warn("[plexus] crop failed", error);
          finishChip(root);
        }
      })();
    } catch (error) {
      console.warn("[plexus] claim failed", error);
    }
  };

  function finishChip(root) {
    root.style.height = "";
    root.style.width = "";
    chip(root, "Open the drawing to render this region");
  }

  return {
    claim,
    releaseAll() {
      for (const [root, btn] of roots) {
        btn.classList.remove("plexus-hidden");
        btn.removeAttribute(CLAIMED);
        root.remove();
      }
      roots.clear();
    },
  };
}
