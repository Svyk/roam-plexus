import { elementBounds, rectToFraction, unrotatedFraction, unrotatedRectFraction, viewportToScene } from "../model/scene.js";
import { viewportRectOf } from "../host/native.js";

const LASSO_STEP_PX = 4;
const PIN_SLOP_PX = 4;
const LINGER_MS = 50;
const SVG_NS = "http://www.w3.org/2000/svg";

// Resolves null, { kind: "rect", f: [rx, ry, rw, rh], altKey } (plain drag), { kind: "lasso", p: [x1,y1,...], altKey } (Alt-drag)
// or { kind: "pin", x, y } (a click that moved under 4 px, Alt or not); all values are displayed-box fractions.
// imageRect (a viewport rect) overrides app/element for images that live in ordinary blocks.
export function startImageRegionTool({ app, element, doc, imageRect: fixedRect, cycle = false, setTimeout: setT = (...a) => globalThis.setTimeout(...a), clearTimeout: clearT = (...a) => globalThis.clearTimeout(...a) }) {
  let cancel = null;
  const promise = new Promise((resolve) => {
    const angled = !fixedRect && !!Number(element?.angle);
    const imageRect = fixedRect || viewportRectOf(app, elementBounds(element));
    const sceneOf = (clientX, clientY) => viewportToScene({ x: clientX, y: clientY, appState: app?.state || {} });
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
    let moved = 0;
    let finished = false;
    let lingerTimer = null;

    const removeOverlay = () => {
      if (lingerTimer != null) { clearT(lingerTimer); lingerTimer = null; }
      overlay.removeEventListener("click", onTrailingClick);
      overlay.remove();
    };
    // After a pin or a drag the overlay keeps swallowing the trailing mouseup/click so they cannot reach Roam
    // (a click on an image block would put it into edit mode and steal focus from the caption prompt).
    const onTrailingClick = () => removeOverlay();
    const finish = (value, { linger = false } = {}) => {
      if (finished) return;
      finished = true;
      doc.removeEventListener("keydown", onKey, true);
      doc.removeEventListener("pointerdown", onOutside, true);
      doc.removeEventListener("wheel", cancelOnMove, true);
      doc.removeEventListener("scroll", cancelOnMove, true);
      doc.defaultView?.removeEventListener?.("resize", cancelOnMove);
      if (linger && value) {
        overlay.addEventListener("click", onTrailingClick);
        lingerTimer = setT(removeOverlay, LINGER_MS);
      } else removeOverlay();
      resolve(value);
    };
    cancel = () => {
      finish(null);
      removeOverlay();
    };
    const onKey = (e) => {
      if (cycle && (e.key === "s" || e.key === "S") && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        finish({ kind: "cycle" });
        return;
      }
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
      if (e.button !== 0) return finish(null);
      if (finished) return;
      moved = 0;
      start = { x: e.clientX, y: e.clientY };
      drag = rectFrom(start, start);
      lasso = e.altKey ? [start] : null;
      overlay.setPointerCapture?.(e.pointerId);
    });
    overlay.addEventListener("pointermove", (e) => {
      e.stopPropagation();
      if (!start || finished) return;
      moved = Math.max(moved, Math.hypot(e.clientX - start.x, e.clientY - start.y));
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
    overlay.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    overlay.addEventListener("pointerup", (e) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      if (!start || finished) return;
      const altKey = !!e.altKey;
      if (angled) {
        if (moved < PIN_SLOP_PX) {
          const hit = unrotatedFraction(element, sceneOf(e.clientX, e.clientY));
          return finish(hit ? { kind: "pin", x: hit.x, y: hit.y } : null, { linger: true });
        }
        if (lasso) {
          const local = [];
          for (const pt of lasso) {
            const hit = unrotatedFraction(element, sceneOf(pt.x, pt.y), { clamp: true });
            if (hit) local.push({ x: hit.x * element.width, y: hit.y * element.height });
          }
          const p = lassoToFraction(local, { left: 0, top: 0, width: element.width, height: element.height });
          return finish(p ? { kind: "lasso", p: p.p, altKey } : null, { linger: true });
        }
        const f = unrotatedRectFraction(element, sceneOf(start.x, start.y), sceneOf(e.clientX, e.clientY));
        if (!f || f[2] * element.width < 4 || f[3] * element.height < 4) return finish(null, { linger: true });
        return finish({ kind: "rect", f, altKey }, { linger: true });
      }
      if (moved < PIN_SLOP_PX) {
        const x = Math.min(1, Math.max(0, (e.clientX - imageRect.left) / imageRect.width));
        const y = Math.min(1, Math.max(0, (e.clientY - imageRect.top) / imageRect.height));
        return finish({ kind: "pin", x, y }, { linger: true });
      }
      if (lasso) {
        const p = lassoToFraction(lasso, imageRect);
        return finish(p ? { kind: "lasso", p: p.p, altKey } : null, { linger: true });
      }
      const f = rectToFraction(drag, imageRect);
      finish(f ? { kind: "rect", f, altKey } : null, { linger: true });
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
