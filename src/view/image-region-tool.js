import { elementBounds, rectToFraction } from "../model/scene.js";
import { viewportRectOf } from "../host/native.js";

export function startImageRegionTool({ app, element, doc }) {
  let cancel = null;
  const promise = new Promise((resolve) => {
    if (element?.angle) return resolve(null);
    const imageRect = viewportRectOf(app, elementBounds(element));
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
    doc.body.append(overlay);

    let start = null;
    let drag = null;
    let finished = false;

    const finish = (value) => {
      if (finished) return;
      finished = true;
      doc.removeEventListener("keydown", onKey, true);
      doc.removeEventListener("pointerdown", onOutside, true);
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
      overlay.setPointerCapture?.(e.pointerId);
    });
    overlay.addEventListener("pointermove", (e) => {
      e.stopPropagation();
      if (!start) return;
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
      finish(rectToFraction(drag, imageRect));
    });
    const reset = () => {
      start = null;
      drag = null;
      marquee.hidden = true;
    };
    overlay.addEventListener("pointercancel", reset);
    overlay.addEventListener("lostpointercapture", (e) => {
      if (start && e.buttons === 0 && !finished) reset();
    });
    for (const type of ["click", "mousedown", "mouseup"]) overlay.addEventListener(type, (e) => e.stopPropagation());
    doc.addEventListener("keydown", onKey, true);
    doc.addEventListener("pointerdown", onOutside, true);
  });
  promise.cancel = () => cancel?.();
  return promise;
}
