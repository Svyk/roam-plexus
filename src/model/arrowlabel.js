// Excalidraw 0.18.0 arrow-label geometry (linearElementEditor.ts:1510-1555, textElement.ts:456-465).
export function arrowLabelRect({ x, y, points }, w, h) {
  const p0 = points[0];
  const p1 = points[points.length - 1];
  return { x: x + (p0[0] + p1[0]) / 2 - w / 2, y: y + (p0[1] + p1[1]) / 2 - h / 2 };
}

export function arrowLabelWrapWidth(arrowWidth, fontSize) {
  return Math.max(0.7 * arrowWidth, 11 * fontSize);
}
