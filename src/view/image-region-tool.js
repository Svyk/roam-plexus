import { elementBounds, rectToFraction } from "../model/scene.js";
import { viewportRectOf } from "../host/native.js";

const LASSO_STEP_PX = 4;
const SVG_NS = "http://www.w3.org/2000/svg";

// Resolves a rect fraction array [rx, ry, rw, rh] (plain drag), { p: [x1,y1,...] } (Alt-drag lasso), or null.
// imageRect (a viewport rect) overrides app/element for images that live in ordinary blocks.
export function startImageRegionTool({ app, element, doc, imageRect: fixedRect }) {
  let cancel = null;
  const promise = new Promise((resolve) => {
    if (!fixedRect && element?.angle) return resolve(null);
    const imageRect = fixedRect || viewportRectOf(app, elementBounds(element));
    const overlay = doc.createElement("div");
    overlay.className = "plexus-portal plexus-image-tool";
    overlay.style.left = `${imageRect.left}px`;
    overlay.style.top = `${imageRect.top}px`;
    overlay.style.width = `${imageRect.width}px`;
    overlay.style.height = `${imageRect.height}px`;
    const marquee = doc.createElement("div");
    marquee.className = "plexus-marquee";
    marquee.hidden = true;
    overlay.append(marquee);
    let lassoPath = null;
    if (doc.createElementNS) {
      const svg = doc.createElementNS(SVG_NS, "svg");
      svg.setAttribute("class", "plexus-lasso");
      lassoPath = doc.createElementNS(SVG_NS, "path");
      svg.append(lassoPath);
      overlay.append(svg);
    }
    doc.body.append(overlay);

    let lasso = null;
    let start = null;
    let drag = null;
    let finished = false;

    const finish = (value) => {
      if (finished) return;
      finished = true;
      doc.removeEventListener("keydown", onKey, true);
      doc.removeEventListener("pointerdown", onOutside, true);
      doc.removeEventListener("wheel", cancelOnMove, true);
      doc.removeEventListener("scroll", cancelOnMove, true);
      doc.defaultView?.removeEventListener?.("resize", cancelOnMove);
      overlay.remove();
      resolve(value);
    };
    cancel = () => finish(null);
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      finish(null);
    };
    const onOutside = (e) => {
      if (!overlay.contains(e.target)) finish(null);
    };
    // The overlay rect is measured once; any scroll, wheel or resize could leave it off the image.
    const cancelOnMove = () => finish(null);
    const rectFrom = (a, b) => ({
      left: Math.min(a.x, b.x),
      top: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y),
    });

    overlay.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      start = { x: e.clientX, y: e.clientY };
      drag = rectFrom(start, start);
      lasso = e.altKey ? [start] : null;
      overlay.setPointerCapture?.(e.pointerId);
    });
    overlay.addEventListener("pointermove", (e) => {
      e.stopPropagation();
      if (!start) return;
      if (lasso) {
        const last = lasso[lasso.length - 1];
        if (Math.hypot(e.clientX - last.x, e.clientY - last.y) >= LASSO_STEP_PX) {
          lasso.push({ x: e.clientX, y: e.clientY });
          lassoPath?.setAttribute("d", `M${lasso.map((pt) => `${pt.x - imageRect.left},${pt.y - imageRect.top}`).join(" L")}`);
        }
        return;
      }
      drag = rectFrom(start, { x: e.clientX, y: e.clientY });
      marquee.hidden = false;
      marquee.style.left = `${drag.left - imageRect.left}px`;
      marquee.style.top = `${drag.top - imageRect.top}px`;
      marquee.style.width = `${drag.width}px`;
      marquee.style.height = `${drag.height}px`;
    });
    overlay.addEventListener("pointerup", (e) => {
      e.stopPropagation();
      if (!start) return;
      finish(lasso ? lassoToFraction(lasso, imageRect) : rectToFraction(drag, imageRect));
    });
    const reset = () => {
      start = null;
      drag = null;
      lasso = null;
      lassoPath?.setAttribute("d", "");
      marquee.hidden = true;
    };
    overlay.addEventListener("pointercancel", reset);
    overlay.addEventListener("lostpointercapture", (e) => {
      if (start && e.buttons === 0 && !finished) reset();
    });
    for (const type of ["click", "mousedown", "mouseup"]) overlay.addEventListener(type, (e) => e.stopPropagation());
    doc.addEventListener("keydown", onKey, true);
    doc.addEventListener("pointerdown", onOutside, true);
    doc.addEventListener("wheel", cancelOnMove, true);
    doc.addEventListener("scroll", cancelOnMove, true);
    doc.defaultView?.addEventListener?.("resize", cancelOnMove);
  });
  promise.cancel = () => cancel?.();
  return promise;
}

// Lasso points (viewport px) clamped to the image box and expressed as flat fractions; null when the loop is
// too small to be a region (fewer than 3 points, or a bbox under 4 px either way).
export function lassoToFraction(points, imageRect) {
  if (!Array.isArray(points) || points.length < 3 || !(imageRect?.width > 0) || !(imageRect?.height > 0)) return null;
  const xs = [];
  const ys = [];
  const p = [];
  for (const pt of points) {
    const x = Math.min(imageRect.left + imageRect.width, Math.max(imageRect.left, pt.x));
    const y = Math.min(imageRect.top + imageRect.height, Math.max(imageRect.top, pt.y));
    xs.push(x);
    ys.push(y);
    p.push((x - imageRect.left) / imageRect.width, (y - imageRect.top) / imageRect.height);
  }
  if (Math.max(...xs) - Math.min(...xs) < 4 || Math.max(...ys) - Math.min(...ys) < 4) return null;
  return { p };
}
