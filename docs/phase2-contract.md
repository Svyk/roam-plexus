# Plexus Phase 2 — implementation contract (binding)

Repo `~/roam-plexus`, HEAD `3e204af` (0.1.0 + roadmap). Compass repo `~/roam-compass`, HEAD `fdd575a`. The Phase 1 contract (`docs/phase1-contract.md`) still binds everything this document does not change. Spec: `docs/spec-plexus.md` (§7 features, §8 Compass contract, §13 measured facts). Roadmap: `docs/roadmap.md`. Roam rules: `~/.claude/skills/roam-plugin-dev/SKILL.md` §(d), rules 1, 2, 4, 5, 7, 10, 11, 13, 14, 20. Zero runtime deps, plain JS, `node --test`, no jsdom (inject `doc`/`api`/`clipboard`), log prefix `[plexus]`, never throw into Roam.

## Measured facts added for Phase 2 (2026-09-28, Readwisenotes)

- Roam-hosted images (`https://firebasestorage.googleapis.com/...`) answer CORS: `fetch(url, {mode:"cors"})` is readable. `new Image()` with `crossOrigin="anonymous"` draws to a canvas without tainting it. `roamAlphaAPI.file.get({url})` resolves a `File` whose `type` is `""` (sniff it, or just `createImageBitmap(file)`). On encrypted graphs, `file.get` decrypts `.enc` (rule 14). Use `file.get` for EVERY plain-image crop so encrypted and plain graphs take one path.
- Excalidraw 0.18 `copyAsSvg` prepares export elements with `(elements, appState, selectionOnly=true)`. When exactly one frame is selected, it exports with `exportingFrame`, which clips to that frame. Frame children render clipped when `appState.frameRendering.clip` is true, including in Roam's view PNG.
- A block whose string is exactly `{{[[excalidraw]]}}` is a valid empty native drawing; it shows "Click to start editing" until first edited.
- Roam element links (S6): a capture-phase `pointerdown`/`pointerup` pair on the editor container, plus `app.getElementLinkAtPosition({x, y}, null)` in scene coordinates, resolves the element link from a trusted click. In view mode the whole element body is the hotspot; in edit mode only the link icon at the element's top-right is. Wrapping `app.redirectToLink` did NOT fire for trusted clicks, so do not use it.

## New region kinds (model/region.js + model/scene.js + model/image.js)

| kind | tokens (canonical order) | geometry | hot crop | cold crop |
|---|---|---|---|---|
| `group` | `k d g pad` (g = groupId) | union of live elements whose `groupIds` includes g, + pad | copyAsSvg with those ids selected | view PNG crop |
| `frame` | `k d fr pad` (fr = frame element id) | frame bbox + pad | copyAsSvg with the frame + its live children selected | view PNG crop |
| `cframe` | `k d fr` | frame bbox exactly (pad 0) | copyAsSvg with ONLY the frame selected (clipped export) | view PNG crop of the frame bbox |
| `poly` | `k d el p` (el = image element id; p = x1,y1,x2,y2,… fractions of the image element box, ≥3 points, 4 dp) | bbox of the polygon inside the image element; pixels outside the polygon are transparent | copyAsSvg of the image → crop to the polygon's bbox fraction → add an SVG `<clipPath>` polygon (pure string op) | view PNG crop, then canvas polygon clip |
| `imgrect` | `k d i f` (d = uid of an ordinary block with `![](url)`; i = 0-based image index in that block string) | fraction rect of the image's natural size | n/a | `file.get(url)` → `createImageBitmap` → canvas crop |
| `imgpoly` | `k d i p` | polygon bbox inside the natural image; outside is transparent | n/a | same as imgrect + canvas polygon clip |

- `RESERVED_KINDS` becomes empty; `SUPPORTED_KINDS` covers all 8 kinds. Unknown kinds still parse as `supported:false`.
- Region blocks for `imgrect`/`imgpoly` live under a collapsed `{{[[plexus-regions]]}}` last child of the IMAGE block, the same pattern as drawings. `host.createRegion(parentUid, string)` already takes any parent uid, so keep it generic.
- New pure `src/model/image.js`: `parseImageRefs(blockString)` → `[{alt, url, index}]` for `![alt](url)` in order (ignore images inside backticks or code fences); `imageCropRect({naturalWidth, naturalHeight, f})`; `polyBBox(p)`; `normalizePoly(p)` (clamp, 4 dp, ≥3 points, else null); `polyToLocal(p, bboxFrac)` (points relative to the bbox, for clipping); `clipSvgToPolygon(svgString, localPoints)` (insert `<defs><clipPath id="plexus-clip-<hash>">` and wrap the root content in `<g clip-path="url(#…)">`; string ops only); `thumbnailSize({width, height, maxWidth})`.
- `geometryKey` extends to every kind, stays stable, and sorts where order does not matter. `CACHE_VERSION` stays 2 unless a key format changes (then bump it, with a test).

## Plain-image regions (UX)

- Register the block context menu command `Plexus: Region on image` through `roamAlphaAPI.ui.blockContextMenu.addCommand({label, callback})`, and remove it on unload via the lifecycle. The callback receives `{"block-uid", …}`.
- The target is the first `![](url)` in that block (P2 targets only index 0 when there is more than one; add a TODO in the code) that is RENDERED in the DOM inside that block (`img.rm-inline-img:not(.rm-inline-img--excalidraw)`). If none is rendered, toast "Show the image on screen first".
- Overlay the rendered `<img>` rect with the image-region tool. Drag = rect. Holding **Alt** while pressing starts lasso mode (freehand points sampled every ≥4 px; release closes the polygon). Esc cancels. Output fractions relative to the rendered image box (identical to natural fractions because the box preserves the aspect ratio; assert it in a test and handle `object-fit` by using the rendered content box).
- Create `{{[[plexus-region]]: k=imgrect d=<blockUid> i=0 f=…}} Image region` (or `k=imgpoly … p=…`), cache the crop (png tier, key uses `fnv1a(url)` in place of the drawing hash), and copy `((uid))`.
- The drawing image tool (`createImageRegion`) gains the same Alt-lasso → `k=poly`.

## Region button kind detection (actions.createAreaRegion)

Selection (non-deleted), then:
1. Exactly one frame element selected, optionally with some of its own children → `cframe`.
2. Selection equals ALL live members of exactly one group (use `app.state.selectedGroupIds`; there must be exactly one) → `group`.
3. Otherwise → `area` (Phase 1 behavior).

The toolbar also gets **Frame (with margin)**, enabled when rule 1 matches → `frame`. Captions come from `captionFromElements` over the geometry's element set (frame: its children; group: its members). A frame with no text uses the frame's `name` if set, else "Frame".

## Links inside drawings (host/links.js)

- `parseRoamLink(link, graphName)` (pure; put it in `model/links.js`, owned by A) returns one of:
  - `{type:"page", title}` for `[[Title]]`, `#Title`, or `#[[Title]]`
  - `{type:"block", uid}` for `((uid))`
  - `{type:"page"|"block", uid}` for `https://roamresearch.com/#/app/<graph>/page/<uid>` when `<graph> === graphName` (resolve whether the uid is a page or a block in the host)
  - `null` otherwise, which leaves Excalidraw's default in charge
- `installLinkInterception({app, containerEl, api, getSettings, onNavigate})` is called on editor mount, and its disposer on unmount/unload. It uses capture `pointerdown` and `pointerup` on containerEl and acts only on trusted events with movement ≤6 px and duration ≤400 ms. It resolves the scene point from `app.state` (offsetLeft/offsetTop/zoom/scroll), calls `app.getElementLinkAtPosition(point, null)`, and `parseRoamLink`. When the result is non-null it runs `preventDefault` + `stopImmediatePropagation`, then navigates:
  - plain click → exit full-screen (click `.bp3-icon-minimize` in the outer container), then `mainWindow.openPage`/`openBlock`
  - shift → `rightSidebar.addWindow` (page uses `type:"outline"`, block uses `type:"block"`) with the editor left open, plus toast "Opened in sidebar"
- Hover preview (`view/hover-preview.js`) wires on editor mount only. A `pointermove` listener on containerEl is rAF-throttled. When the pointer is over an element whose link parses as a Roam link, it shows ONE portal `.plexus-portal.plexus-hover` near the pointer, rendering `renderString({string: "((uid))" | "[[Title]]", el})` plus, for pages, the first 3 child block strings as plain text. It hides on leave, pointerdown, or wheel, and unmounts via `unmountNode`. There is zero work when the pointer is not over a linked element. There are no listeners outside containerEl.

## Thumbnails + public API (src/api.js, owned by B; thumbnail action owned by C)

- `actions.thumbnail(uid, {maxWidth = 480, render = false})` → `Promise<Blob|null>`. `uid` may be a drawing uid (whole-scene thumbnail) or a region uid (that region's crop). It reads the cache only unless `render`. Cache key `${uid}|thumb|${hash}|${maxWidth}`, png tier. Rendering uses the cold path (view PNG, downscaled to maxWidth) for drawings, and the region pipeline for regions. It never loads the Excalidraw module when `render=false`.
- `window.RoamPlexus` (Object.freeze, installed on load, deleted on unload only if it is still ours):
  `apiVersion: 1`, `version`, `isAvailable()`,
  `create({pageUid, parentUid, title})` → `{uid, pageUid}`: with `title`, ensure the page `Drawings/<title>` exists (reuse it if present), then add a LAST child `{{[[excalidraw]]}}`; otherwise add a LAST child to `parentUid || pageUid`,
  `open(uid, {region, sidebar})` (drawing uid, or a region uid via `actions.openRegion`),
  `thumbnail(uid, opts)`,
  `regionsOf(uid)` → `[{uid, kind, caption}]`,
  `drawingsOn(pageUid)` → `[uid]`: blocks on that page whose string starts with `{{[[excalidraw]]}}` or `{{excalidraw}}`, capped at 50, from one `data.q`,
  `addEventListener("change", cb)` / `removeEventListener`.
  `change` fires `{uid, kind: "drawing"|"region"}` after Plexus's own writes and on editor unmount (the drawing may have changed).
- On load, dispatch `window.dispatchEvent(new CustomEvent("roam-plexus:ready", {detail: {apiVersion: 1}}))`; on unload, dispatch `roam-plexus:unload`.

## Compass changes (unit D, repo ~/roam-compass; spec §8 adapted to Compass's current code)

- Read the current code first. The spec §8 line numbers predate `fdd575a`.
- Settings: add a `drawings` switch (default on), wired through Compass's existing settings pattern.
- Model (pure): `isDrawingLike(node)`, true when the node's block string starts with `{{[[excalidraw]]}}`, `{{excalidraw}}`, or `{{[[plexus-region]]`, with a test.
- View: when `drawings` is on AND `window.RoamPlexus?.apiVersion >= 1` AND the node is drawing-like, the node builder asynchronously calls `RoamPlexus.thumbnail(uid, {maxWidth: 160})` (cache-only). If it returns a Blob, it inserts `img.compass-node-thumb` from an object URL. Revoke the URL on repaint and on unload. Never block paint. Scope CSS under `.compass-root`.
- Search: when RoamPlexus is available, the result list gains a footer row "New drawing: <query>". It calls `RoamPlexus.create({title: query})`, then Compass's EXISTING new-page link path, exactly as it would for a new page.
- Extension: listen for `roam-plexus:ready` / `roam-plexus:unload` on window, and subscribe to `RoamPlexus` `change` to trigger Compass's existing repull (debounce to one per frame). Clean up everything on unload.
- Compass writes nothing new to the graph except through its existing paths. Bump Compass to its next minor version and update its CHANGELOG. Its `npm run check` must pass.

## File ownership (parallel)

| Unit | Files |
|---|---|
| A (model) | `src/model/region.js`, `src/model/scene.js`, `src/model/image.js` (new), `src/model/links.js` (new), `test/region.test.js`, `test/scene.test.js`, `test/image.test.js` (new), `test/links.test.js` (new) |
| B (host + api) | `src/host/native.js`, `src/host/roam.js`, `src/host/cold-render.js`, `src/host/image-source.js` (new: `loadImageBitmap(url, {api})` via file.get, memo by url; `cropBitmapToBlob(bitmap, rect, {poly})` with polygon clip), `src/host/links.js` (new), `src/api.js` (new), `test/host-*.test.js`, `test/api.test.js` (new) |
| C (view + actions + wiring) | `src/view/regionref.js`, `src/view/image-region-tool.js` (lasso), `src/view/hover-preview.js` (new), `src/view/toolbar.js`, `src/actions.js`, `src/extension.js`, `src/extension.css`, `src/settings.js`, `test/actions.test.js`, `test/view-*.test.js`, `test/extension.test.js`, `test/toolbar.test.js` |
| D (Compass) | everything in `~/roam-compass` |

Parallel units: edit only your own files. Do not run git checkout, reset, stash, add, or commit. Code against these signatures (other units may still be stubs). At the end, run `npm test` and report failures in your own files only.

## Budgets and gates

- Typing path +0 (no new document-level input/keydown listeners). The hover preview and link interception exist only while an editor is mounted.
- Every kind: parse/serialize round-trip; crop bbox within ±1 px on fixtures; cold and hot paths both tested with fakes.
- Unload: `window.RoamPlexus` removed, context-menu command removed, all portals/listeners gone (live check: zero `.plexus-*` nodes).
- Compass: `npm run check` green; with Plexus absent, behavior is byte-for-byte the old behavior (feature-detected at call time).
