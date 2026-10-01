# Batch 8 (0.23.0)

NAV-8. Fullscreen onEditorMount only. Top-right, 160 by 110. Dispose unsubscribes subscribeViewport. Do not edit camera.js or change zoom.

elementBounds of live elements. One frame via subscribeViewport. Cache until count or version sum changes.

Visible x is -scrollX through -scrollX + width/zoom, same for y. Hide if off, empty, or every box fits.

Pan is updateScene scroll only, captureUpdate NEVER. No elements. No zoom. Uniform centered fit. scrollX = width / (2 * zoom) - sceneX, same for y. Pointer stops on the portal.

id minimap, default true. Off for false or "false". Append after preview-modifier in the panel and FIELDS. It stays FIELDS index 26.

No thumbnail. Palette two. List 53. apiVersion 6.
