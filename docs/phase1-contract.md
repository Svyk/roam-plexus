# Plexus Phase 1 — implementation contract (binding)

Repo: `~/roam-plexus` (created by the scaffold stage from `~/roam-extension-template`).
Spec: `docs/spec-plexus.md` in the repo (copy of `~/system-setup/roam-excalidraw-plugin/spec-plexus.md`). Section 13 "Phase 0 results" is measured ground truth; where section 13 and earlier sections disagree, section 13 wins.
Reference implementations to imitate (read, do not copy blindly): `~/roam-compass/src` (host/model/view split, `withLock`, pull patterns, tests with fakes), `~/roam-extension-template/src/lifecycle.js`, `~/roam-grid/src/extension.js` (discovery, image handling, IndexedDB).
Roam rules: `~/.claude/skills/roam-plugin-dev/SKILL.md` section (d), rules 1, 2, 4, 5, 7, 10, 11, 14, 20 are binding.

Zero runtime dependencies. ES modules, plain JavaScript, Node 20 `node --test`. No jsdom: DOM-touching code must take `doc`/`api`/`clipboard` as injected parameters so tests pass fakes. Log prefix `[plexus]`. Never throw into Roam from an event handler or observer: catch and `console.warn("[plexus] …", error)`.

## Product in one paragraph

Roam's native `{{[[excalidraw]]}}` drawing is canonical (data in `:block/props` keys `:excalidraw/elements-json`, `:excalidraw/state-json`, `:excalidraw/version`, `:excalidraw/instance-id`). Plexus lets the user turn part of a drawing into a real Roam block ("region"). The region block renders as a cropped image wherever it appears: inline, in `((uid))` refs, and in embeds. Clicking the crop opens the drawing full-screen, zoomed to the region with a brief spotlight. Region blocks live as children of one collapsed container block `{{[[plexus-regions]]}}` that is the last child of the drawing block.

## Data formats (model/region.js owns these)

Region block string:

```
{{[[plexus-region]]: k=area d=<drawingUid> ids=<id>,<id> pad=10}} <caption>
{{[[plexus-region]]: k=rect d=<drawingUid> el=<imageElementId> f=<rx>,<ry>,<rw>,<rh>}} <caption>
```

- Args are space-separated `key=value` tokens between `: ` and the first `}}`. Parse is order-insensitive. Serialize emits the canonical order `k d ids pad`, or `k d el f`, followed by unknown tokens in their original order, then `}}`, then ` <caption>` if the caption is non-empty.
- Element ids and uids match `[A-Za-z0-9_-]+`. Fractions are clamped to [0,1] and written with at most 4 decimals, no trailing zeros (`0.25`, not `0.2500`). `pad` is an integer 0..200, default 10.
- Kinds `group`, `frame`, `cframe`, and `poly` are reserved for Phase 2. They parse successfully with `supported:false`, so the UI shows "needs a newer Plexus" instead of failing.
- Container block string is exactly `{{[[plexus-regions]]}}`.
- Roam renders `{{[[plexus-region]]: …}}` as `<button class="bp3-button bp3-small dont-focus-block rm-xparser-default-plexus-region">plexus-region</button>`, and the same button appears inside `.rm-block-ref[data-uid]` refs. That button is the discovery hook.

## File ownership (parallel stages must stay inside their files)

| Owner | Files |
|---|---|
| Scaffold | `package.json`, `package-lock.json`, `build.mjs` (banner `/* Plexus v${version} | MIT | generated; edit src/ */`), `build.sh`, `scripts/*`, `.github/*`, `.gitignore`, `.system-sync-include`, `LICENSE` (MIT, 2026 Svyatoslav Kleshchev), `README.md`, `CHANGELOG.md`, `docs/spec-plexus.md`, `src/lifecycle.js`, `test/build.test.js`, `test/lifecycle.test.js`, `test/secret-scan.test.js`, and a STUB for every file below whose exports match this contract (functions may throw `new Error("not implemented")`) |
| A (model) | `src/model/region.js`, `src/model/scene.js`, `src/model/caption.js`, `src/model/hash.js`, `test/region.test.js`, `test/scene.test.js`, `test/caption.test.js`, `test/hash.test.js` |
| B (host) | `src/host/locks.js`, `src/host/roam.js`, `src/host/native.js`, `src/host/cache.js`, `src/host/cold-render.js`, `test/host-locks.test.js`, `test/host-roam.test.js`, `test/host-native.test.js`, `test/host-cache.test.js`, `test/host-cold-render.test.js` |
| C (view + wiring) | `src/view/discover.js`, `src/view/regionref.js`, `src/view/spotlight.js`, `src/view/toolbar.js`, `src/view/image-region-tool.js`, `src/view/toast.js`, `src/actions.js`, `src/extension.js`, `src/settings.js`, `src/extension.css`, `test/extension.test.js`, `test/view-discover.test.js`, `test/view-regionref.test.js`, `test/actions.test.js`, `tools/live-load.mjs` |

Parallel stages: do not edit files outside your row, do not run `git checkout`, `git reset`, `git stash`, or `git commit`. Run `npm run check` only at the end, and only report failures that are in your own files. The integration stage fixes cross-module breaks and commits.

## A — model (pure, no DOM, no Roam)

`src/model/region.js`
```js
export const REGION_COMPONENT = "plexus-region";
export const CONTAINER_STRING = "{{[[plexus-regions]]}}";
export const REGION_BUTTON_CLASS = "rm-xparser-default-plexus-region";
export const DEFAULT_PAD = 10;
export const SUPPORTED_KINDS = Object.freeze(["area", "rect"]);
export const RESERVED_KINDS = Object.freeze(["group", "frame", "cframe", "poly"]);
// null when the string is not a region. Otherwise:
// {kind, drawingUid, ids?:string[], el?:string, f?:[rx,ry,rw,rh], pad?:number, caption:string,
//  extra:Array<[key,value]>, supported:boolean, error?:string}
// error is set (and supported false) for missing d, missing ids/el/f, bad fractions, unknown kind.
export function parseRegion(blockString) {}
export function serializeRegion(region) {}           // canonical string; throws TypeError on invalid input
export function normalizeFrac(f) {}                   // accepts [4 numbers] | {rx,ry,rw,rh} | {x,y,w,h}; returns clamped 4dp array or null if rw<=0||rh<=0
export function isContainerString(s) {}
export function geometryKey(region) {}                // stable string, e.g. "area|<d>|<sorted ids>|10" or "rect|<d>|<el>|<f joined>"
```

`src/model/scene.js`
```js
export const VIEW_EXPORT_PADDING = 10;
// props from data.pull (keys ":excalidraw/elements-json") OR data.q (keys "elements-json") OR "excalidraw/elements-json".
// Returns {elements, appState, version, instanceId, elementsJson} or null when not a drawing / unparseable.
export function parseDrawingProps(props) {}
export function liveElements(elements) {}             // !isDeleted
export function elementBounds(el) {}                  // [x1,y1,x2,y2] absolute scene coords, rules below
export function commonBounds(elements) {}             // over liveElements; null if none
// {bbox:[x1,y1,x2,y2], missing:string[]} or {error:"no-elements"|"not-image"|"rotated-image"|"unsupported-kind"}
export function regionSceneBBox(region, elements) {}
// Map a scene bbox into Roam's view-mode PNG. The PNG is commonBounds(live) + padding on each side at scale 1.
// Returns {sx,sy,sw,sh} (integers, clamped to the image) or {error:"bounds-mismatch", expected:[w,h], actual:[w,h]} when
// |naturalWidth - round(bw + 2*padding)| > 2 or the same for height.
export function viewPngCropRect({elements, bbox, naturalWidth, naturalHeight, padding = VIEW_EXPORT_PADDING}) {}
export function fitZoom({bbox, viewportWidth, viewportHeight, margin = 0.12, minZoom = 0.1, maxZoom = 4}) {} // {zoom, scrollX, scrollY}; Excalidraw: viewportX = (sceneX + scrollX) * zoom
export function sceneToViewport({x, y, appState}) {}  // {x: (x + scrollX) * zoom.value + offsetLeft, y: …}
export function viewportToScene({x, y, appState}) {}
export function rectToFraction(dragRect, imageRect) {} // both {left,top,width,height} in the same space; intersect, normalize, normalizeFrac; null if < 4px either side
// Rewrite the root <svg> of an Excalidraw export (viewBox "0 0 W H", width, height, exported with padding `pad`)
// so it shows only fraction f of the element box. Pure string work on the root tag.
export function cropSvgToFraction(svgString, f, pad = VIEW_EXPORT_PADDING) {}
```

`elementBounds` rules (Excalidraw is MIT; its geometry may be reimplemented):
- `rectangle`, `text`, `image`, `frame`, `magicframe`, `embeddable`, `iframe`: the 4 corners of (x,y,width,height), rotated by `angle` about the center; min/max.
- `diamond`: the 4 edge midpoints rotated about the center.
- `ellipse`: the exact extent of a rotated ellipse: `hx = sqrt((a cosθ)^2 + (b sinθ)^2)`, `hy = sqrt((a sinθ)^2 + (b cosθ)^2)`, where a = width/2 and b = height/2.
- `line`, `arrow`, `freedraw`: points are relative to (x,y). The point bbox gives a local center; each point is rotated about `(x + cxLocal, y + cyLocal)`. For `line`/`arrow` with `roundness` non-null and `elbowed !== true` and ≥3 points, bound the Catmull-Rom curve instead: roughjs `curveToBezier` with tightness 0; sample each cubic 24 times.
- Unknown types fall back to rotated corners.

`src/model/caption.js`
```js
// Text of text elements whose id is in ids OR whose containerId is in ids, in scene order.
// Strip "{", "}" and backticks (as Roam does for its tail), collapse whitespace, join " ; ", cap at 200 chars. "" if none.
export function captionFromElements(elements, ids) {}
```

`src/model/hash.js`: `export function fnv1a(str) {}` (32-bit FNV-1a, 8-char lowercase hex).

Tests must include the Phase 0 fixture: elements `rect(100,100,220,140)`, `rect(420,120,160,100)`, `text(130,150,160,25)`. `commonBounds` must be `[100,100,580,240]`, so the view PNG is 500×160. The crop for area `ids=rect-a,text-a pad=10` must be `{sx:10, sy:10, sw:240, sh:160}`. Also cover: parse/serialize round-trips, unknown-token preservation, reserved kinds, malformed strings, rotated rect/ellipse/diamond bounds, curved arrow ≥ straight bbox, `rectToFraction` clipping, `cropSvgToFraction` on a real-looking root tag, and `captionFromElements` stripping.

## B — host (Roam, DOM, browser APIs; every dependency injected)

`src/host/locks.js`
```js
// Web Locks with graceful fallback. Returns {acquired:boolean, fallback:boolean, value}.
export async function withLock(name, fn, {ifAvailable = false, locks = globalThis.navigator?.locks, timeoutMs = 5000} = {}) {}
export function lockName(graph, uid) {}               // `plexus:${graph}:${uid}`
```

`src/host/roam.js`
```js
export function createRoamHost({api = globalThis.roamAlphaAPI, withLockFn = withLock} = {}) {
  return {
    graphName(),                     // api.graph.name
    isEncrypted(),                   // !!api.graph.isEncrypted
    pullBlock(uid),                  // {uid, string, editTime, open, props, children:[{uid,string,order}] sorted by order} | null
    drawing(uid),                    // parseDrawingProps + {uid, editTime, hash: fnv1a(elementsJson)}; memo by uid+editTime (Map, cap 64)
    regionsOf(drawingUid),           // [{uid, string, region}] from the container's children; [] if none
    async ensureRegionContainer(drawingUid),   // existing child whose string isContainerString, else create as LAST child with open:false; returns uid
    async createRegion(drawingUid, regionString), // withLock(lockName(graph, drawingUid)) around ensure + create LAST child of container; returns new uid
    async openBlock(uid, {sidebar = false} = {}), // mainWindow.openBlock / rightSidebar.addWindow({window:{type:"block","block-uid":uid}})
    blockUidFromNode(node),          // nearest `.rm-block-ref[data-uid]` → dataset.uid; else nearest element whose id starts "block-input-" → last 9 chars; else null
  };
}
```
Writes allowed: `data.block.create` only (container + region). NEVER call `data.block.update` on any block. NEVER pass `props` anywhere. (S3: a props write replaces the whole map and would wipe the drawing.)

`src/host/native.js`
```js
// From an `.excalidraw` element: read the key starting "__reactFiber$", walk .return up to 6 levels, return the first
// stateNode with functions updateScene and getSceneElementsIncludingDeleted and an object actionManager. Else null.
export function findApp(excalidrawEl) {}
// {el, app, outer, drawingUid} for `.excalidraw-outer-container.full-screen .excalidraw`, or null.
// drawingUid: outer.closest('[id^="block-input-"]').id last 9 chars; sidebar blocks also use block-input ids.
export function activeEditor(doc = globalThis.document) {}
export function selectedElementIds(app) {}            // non-deleted ids where app.state.selectedElementIds[id]
// Vector SVG of exactly `ids`: remember selection, set appState.selectedElementIds to ids (selectedGroupIds {}),
// wait one animation frame, temporarily replace clipboard.writeText AND clipboard.write with capturers, run
// app.actionManager.executeAction(app.actionManager.actions.copyAsSvg, "api"), resolve with the captured string
// (timeoutMs), and in `finally` restore both clipboard functions, the previous selection, and clear appState.toast.
// A module-level mutex serializes captures. Throws if clipboard is unavailable or nothing was captured.
export async function captureSelectionSvg(app, ids, {clipboard = globalThis.navigator?.clipboard, raf = globalThis.requestAnimationFrame, timeoutMs = 3000} = {}) {}
export function zoomTo(app, bbox, opts = {}) {}        // fitZoom with app.state.width/height; app.updateScene({appState:{zoom:{value}, scrollX, scrollY}}); returns the result
export function viewportRectOf(app, bbox) {}           // screen {left, top, width, height} via sceneToViewport
```

`src/host/cache.js`
```js
export function cropKey({regionUid, geometryKey, drawingHash, tier}) {} // `${regionUid}|${geometryKey}|${drawingHash}|${tier}`, tier "svg"|"png"
export function createCropCache({graph, persist = true, limitBytes = 100 * 2 ** 20, memoryEntries = 300, idb = globalThis.indexedDB, urls = globalThis.URL} = {}) {
  return {
    peek(key),          // sync memory hit {url,w,h,type} | null (the same-frame paint path)
    async get(key),     // memory, then IndexedDB when persist && idb; hydrates memory
    async put(key, blob, {w, h}),  // memory + IndexedDB (db "plexus-cache", store "crops", keyPath "key", index "ts"); evict LRU to limitBytes
    async clear(),
    dispose(),          // revoke every object URL, close the db
  };
}
```
IndexedDB keys are prefixed with the graph name. When `idb` is missing, the cache is memory-only, and that must also work in Node tests. Memory is an LRU of `memoryEntries`; evicted object URLs are revoked.

`src/host/cold-render.js`
```js
// Serialized queue (one render at a time), concurrent requests for the same uid share one promise.
// Offscreen host: div.plexus-offscreen (position:fixed; left:-10000px; top:0; width:1200px; visibility:hidden; pointer-events:none; aria-hidden)
// appended to doc.body; api.ui.components.renderBlock({uid, el: host}); wait (MutationObserver + img "load", timeoutMs)
// for img.rm-inline-img--excalidraw with complete && naturalWidth > 0; copy it to a canvas BEFORE unmount;
// api.ui.components.unmountNode({el: host}); host.remove(). Resolve {canvas, naturalWidth, naturalHeight} or null.
export function createColdRenderer({api = globalThis.roamAlphaAPI, doc = globalThis.document, timeoutMs = 8000} = {}) {
  return { async renderDrawing(drawingUid), dispose() };
}
export async function cropCanvasToBlob(canvas, {sx, sy, sw, sh}, {doc = globalThis.document} = {}) {} // PNG Blob
```

## C — view, actions, wiring

`src/view/discover.js`
```js
// One MutationObserver on root (childList, subtree). Fast path per added element node only:
//  - node or descendants with class REGION_BUTTON_CLASS (use node.classList + node.getElementsByClassName) → onRegionButton(btn)
//  - node itself has class "excalidraw" or contains one (getElementsByClassName) and it sits under ".excalidraw-outer-container.full-screen" → onEditorMount(el)
//  - removed nodes: if the tracked editor el is no longer connected → onEditorUnmount(el)
//  Skip anything inside ".plexus-offscreen" or ".plexus-root". No querySelectorAll on document except scanExisting().
export function classifyAddedNode(node) {}   // pure-ish helper for tests: returns {regionButtons:[], editors:[]}
export function createDiscovery({root, onRegionButton, onEditorMount, onEditorUnmount, MutationObserverImpl = globalThis.MutationObserver}) {
  return { scanExisting(), dispose() };
}
```

`src/view/regionref.js` — claims a region button and paints the crop.
1. Skip if inside `.plexus-offscreen` or if already claimed (`data-plexus-claimed`).
2. uid = host.blockUidFromNode(btn); block = host.pullBlock(uid); region = parseRegion(block.string). Return if null.
3. Mark the button claimed, add class `plexus-hidden`, and insert `span.plexus-root.plexus-regionref` right after it with `title` = caption. Unsupported kind → chip "Region kind <k> needs a newer Plexus".
4. drawing = host.drawing(region.drawingUid) (null → chip "Drawing not found"); bbox via regionSceneBBox (error → chip).
5. svgKey/pngKey via cropKey + geometryKey + drawing.hash. `cache.peek(svg) || cache.peek(png)` → set `img.src` in the same task (rule 1).
6. Else placeholder sized to the bbox aspect ratio (max height from settings) → async `cache.get(svg) || cache.get(png)` → else cold path: cold.renderDrawing(d) → viewPngCropRect → cropCanvasToBlob → cache.put(pngKey) → set src. Mismatch or failure → chip "Open the drawing to render this region".
7. Drop results for detached nodes. `mousedown` (capture) stopPropagation + preventDefault so Roam does not enter edit mode; `click` → onOpen(uid, {sidebar: settings.openInSidebar !== e.shiftKey}).
8. `releaseAll()`: remove every `.plexus-regionref`, remove `plexus-hidden` + `data-plexus-claimed`.
```js
export function createRegionRefRenderer({host, cache, cold, getSettings, onOpen, doc}) { return { claim(btn), releaseAll() }; }
```

`src/view/spotlight.js`: `showSpotlight({rect, doc, durationMs = 1400})` → fixed `div.plexus-portal.plexus-spotlight` whose box-shadow `0 0 0 100vmax rgba(0,0,0,.45)` leaves the rect lit. Removed after durationMs or on the first wheel/pointerdown/keydown (capture, passive). Returns a remover; all listeners are removed.

`src/view/toolbar.js`: `createEditorToolbar({doc, onAreaRegion, onImageRegion})` → `{show(outerEl), hide(), dispose()}`. A fixed `div.plexus-portal.plexus-toolbar` on `doc.body`, top-centered over outerEl's rect, with z-index = (numeric computed z-index of outerEl or its nearest positioned ancestor, else 1000) + 1. Buttons "Region" and "Image region". Reposition on window resize while shown.

`src/view/image-region-tool.js`: `startImageRegionTool({app, element, doc})` → Promise<[rx,ry,rw,rh] | null>. A fixed overlay exactly over the image's viewport rect (viewportRectOf), crosshair cursor, pointer drag draws a marquee, pointerup → rectToFraction. Esc or a click outside cancels (null). All pointer events are stopped at the overlay. Rotated image → resolve null (caller shows notice).

`src/view/toast.js`: `createToaster({doc})` → `{show(message, {kind = "info", ms = 2600} = {}), dispose()}` using one `div.plexus-portal.plexus-toast`.

`src/actions.js`
```js
export function createActions({host, native, cache, cold, toaster, spotlight, getSettings, doc, clipboard}) {
  return {
    async createAreaRegion(),      // needs activeEditor; ids = selectedElementIds; caption = captionFromElements || "Region";
                                   // svg = captureSelectionSvg (failure is non-fatal: no hot crop); uid = host.createRegion(d, serializeRegion({kind:"area", drawingUid:d, ids, pad:DEFAULT_PAD, caption}));
                                   // if svg: cache.put(cropKey({regionUid:uid, geometryKey, drawingHash: host.drawing(d).hash, tier:"svg"}), new Blob([svg],{type:"image/svg+xml"}), {w,h});
                                   // then clipboard.writeText(`((${uid}))`) and toast "Region ((uid)) copied". Returns uid or null.
    async createImageRegion(),     // exactly one selected non-deleted image element with angle 0; startImageRegionTool → f; svg = captureSelectionSvg(app,[el.id]) → cropSvgToFraction(svg, f); same write/cache/clipboard.
    async openRegion(regionUid, {sidebar = false} = {}),
                                   // parse; host.openBlock(drawingUid, {sidebar}); wait ≤3 s for that block's
                                   // `.excalidraw-outer-container .bp3-icon-fullscreen` and click it (dispatch mousedown, mouseup, click);
                                   // wait ≤10 s for activeEditor().drawingUid === drawingUid; bbox from app.getSceneElements();
                                   // native.zoomTo; spotlight(viewportRectOf(app, bbox)).
    async refreshCropsForOpenDrawing(), // for each region of the open drawing: captureSelectionSvg → cache.put svg tier
    async clearCache(),
  };
}
```

`src/settings.js` ids: `open-in-sidebar` (switch, default false), `max-crop-height` (input, default "360"), `cache-on-disk` (switch, default true; ignored and treated as false on encrypted graphs, because crops of an encrypted graph must not be written unencrypted to IndexedDB), `cache-limit-mb` (input, default "100"), `debug` (switch, default false). Export `SETTING_IDS`, `initializeSettings(extensionAPI)`, `createSettingsPanel()`, `readSettings(extensionAPI)`.

`src/extension.js`: template lifecycle shape (one idempotent lifecycle). onload sets `window.__ROAM_PLEXUS_VERSION` from the injected build constant or `extension.version`. It builds host, cache (persist = cache-on-disk && !encrypted), cold renderer, toaster, toolbar, regionref renderer, actions, and discovery (root `document.body`), calls `scanExisting()`, and registers commands through `extensionAPI.ui.commandPalette`:
`Plexus: Create region from selection`, `Plexus: Create image region`, `Plexus: Refresh crops for open drawing`, `Plexus: Clear crop cache`.
onEditorMount → toolbar.show(outer); onEditorUnmount → toolbar.hide(). onunload disposes everything in reverse: discovery, regionref.releaseAll, toolbar, toaster, cold, cache; deletes the version flag. With no `document` (Node tests), skip all DOM wiring and still register commands.

`src/extension.css`: only selectors rooted at `.plexus-root`, `.plexus-portal`, `.plexus-offscreen`, `.plexus-hidden` (`.plexus-hidden{display:none !important}` is allowed because the class is only ever added by Plexus). Styling: region crop `max-width:100%; max-height:var(--plexus-max-h,360px); border-radius:4px; cursor:zoom-in; vertical-align:middle`; chip is a small muted inline label. Dark mode via `:root.bp3-dark` / `body.bt-theme-dark` / `@media (prefers-color-scheme: dark) { :root:not(.bp3-light) … }` for the chip, toolbar, and toast only.

`tools/live-load.mjs` (Node dev tool, not bundled): `node tools/live-load.mjs "<target title substring>" [--unload]`. It connects to CDP `http://127.0.0.1:${CDP_PORT||9223}/json`. It awaits `window.__plexusDev?.cleanup?.()`, then (unless `--unload`) injects `extension.css` as `<style id="plexus-dev-css">`, imports `extension.js` from a blob URL, and calls `mod.default.onload({extensionAPI: devApi, extension: {version: "dev"}})`. `devApi.settings` is backed by `localStorage["plexus-dev-settings"]`, `settings.panel.create` is a no-op, and `devApi.ui.commandPalette` maps to `roamAlphaAPI.ui.commandPalette`. It stores `window.__plexusDev = {cleanup}` (cleanup = onunload + remove style + remove any dev-registered commands) and prints `window.__ROAM_PLEXUS_VERSION`.

## Performance budgets (reviewers check these)

- Typing path: no listeners on input/keydown/selectionchange/keyup anywhere. The MutationObserver callback does O(added nodes) cheap checks; it makes no layout reads and no Roam pulls for nodes that are not region buttons.
- Cache hit paints in the same task as the claim. IndexedDB, cold render, and hashing are off the synchronous path.
- The Excalidraw module loads only via Roam itself (cold renderBlock or the user opening a drawing), never to paint a cached crop.
- Pull watches: none in Phase 1 (block re-render re-triggers discovery).
- The cold render queue is serialized. One renderBlock per drawing serves all its pending regions.
