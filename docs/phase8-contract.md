# Plexus Phase 8: Regions you can see and manage (binding)

Repo `~/roam-plexus`, HEAD `4cc4b11` (code 0.7.0, `8bb54f2`). Target 0.8.0, plus Compass 0.4.0 (`~/roam-compass`, HEAD `51be821`, 0.3.0).

Scope and designs: [`roadmap-next.md`](roadmap-next.md) §5 P8. That covers REG-2, REG-1, REG-3, REG-5, REF-4, UX-3, NAV-3, NAV-4, REF-7, DATA-2, DATA-3, CMP-1, and the P8 live gate. That section is binding; this contract adds the measured facts, the shared names and the file ownership.

P7's contract and its amendments still bind anything not changed here. The usual rules apply:
- zero dependencies, plain JS, and `node --test` fakes;
- log prefix `[plexus]`;
- never throw into Roam;
- everything is removed on unload;
- no writes to drawing props except through Excalidraw.

## Measured facts (2026-09-29, Readwisenotes `1929…`, trusted CDP)

- **REF-7, native PNG capture.**
  - Select element `plx-rect-b`, set `appState.exportScale` / `exportWithDarkMode` in the same `updateScene`, then run `app.actionManager.executeAction(actions.copyAsPng, "contextMenu")` with `navigator.clipboard.write` stubbed.
  - It captures one `ClipboardItem` with `image/png`: 180×120 at scale 1, 360×240 at scale 2, 540×360 at scale 3 with dark export (1.5 KB, 3.8 KB, 7.0 KB).
  - Restoring the selection, `exportScale` and `exportWithDarkMode` right away (with `toast: null`) left `:edit/time` unchanged after 3 s.
  - Roam's stored `state-json` DOES contain the `exportScale` and `exportWithDarkMode` keys. The capture must restore them in `finally` in the same task, so a save cannot catch them.
- **DATA-5 (P7).** Roam's Excalidraw is 0.18.0. `app.scrollToContent(target, {fitToContent, animate, …})` exists. View operations write nothing, and closing the editor writes nothing.
- **Other facts.**
  - `RoamPlexus.open(uid)` navigates to a drawing block by design; regions open full screen.
  - Roam re-saves P5-migrated drawings once on first open, with or without Plexus.
  - Electron `window.confirm` blocks the renderer (use an in-page dialog for anything new).
- **Existing overlay primitives** (`src/view/backlinks.js`, P6.1): a fixed layer, rAF-throttled repositioning through `native.subscribeViewport`, `native.viewportRectOf(app, bbox)`, and a cap of 150.

## Shared names (all units code against these)

- **Settings** (unit N owns `src/settings.js` and `src/view/settings-dialog.js`):
  - `zoom-cap`: `"100"` / `"150"` / `"200"`, default `"100"` → `zoomCap` (number)
  - `animation`: `"system"` / `"on"` / `"off"`, default `"system"` → `animation`
  - `region-landing`: default `false` → `regionLanding`
- **`src/host/theme.js`** (N): `motionOk(doc, animationSetting)`. It returns false for `"off"`, true for `"on"`, and for `"system"` it returns `!matchMedia("(prefers-reduced-motion: reduce)").matches`.
- **`src/host/camera.js`** (new, N):
  - `animateTo(app, bbox, {maxZoom, animate, doc})` uses `scrollToContent` with `animate` when present and `motionOk`, else an instant `zoomTo`. It aborts on pointer, wheel or key input.
  - `createViewHistory({cap = 50})` → `{push(app), back(app) → boolean, size(), clear()}`. It stores `{scrollX, scrollY, zoom}`, and `back` restores through `updateScene({appState})` with `captureUpdate: "NEVER"`.
- **`src/view/spotlight.js`** (N): a double pulse that waits for the view to settle. Esc ends it. It respects `motionOk`.
- **`src/host/native.js`** (R): `captureSelectionPng(app, ids, {scale = 2, dark = false, clipboard}) → Promise<Blob|null>`.
  - It follows the `captureSelectionSvg` / `captureOnce` pattern, with all restores in `finally`.
  - It refuses while `clipboardBusy()`.
- **`src/host/cache.js`** (R): tier `"png2x"` in `cropKey`. The regionref paint order is `svg` > `png2x` > `png`.
- **`src/host/guard.js`** (new, G): `createWriteGuard({toaster, ringSize = 5})` returns:
  - `guardedWrite(app, {drawingUid, next, label, captureUpdate})`: refuses when `before > 10 && after * 5 <= before` (a drop to a fifth or less). On refusal it toasts "Not applied: would remove N of M" with an "Apply anyway" action, and returns `false`. Before any write it snapshots the pre-write elements into a per-drawing ring. On success it returns `true`.
  - `restoreLast(app, drawingUid)`
  - `hasSnapshot(drawingUid)`
  - `dispose()`
- **`src/view/toast.js`** (G): `show(message, {kind, action: {label, run}})` supports one action button.
- **`src/view/regions-layer.js`** (new, L): `createRegionsLayer({doc, app, containerEl, host, drawingUid, native, zIndex, labelOf, onSelect, onOpenSidebar})` returns `{show, hide, toggle, visible, refresh, dispose}`.
  - It draws an inert outline rect plus a clickable chip for each drawing-kind region. The chip label is `labelOf(region)`.
  - Clicking a chip calls `onSelect(regionUid)`. Shift-click calls `onOpenSidebar(regionUid)`.
  - It is culled to the viewport, capped at 150, and skips image kinds.
- **`src/view/landing.js`** (new, U): `installRegionLanding({doc, win, api, host, getSettings, openRegion})` returns a disposer.
  - It is active only when `regionLanding` is on.
  - On load and on `hashchange`, if the URL is `#/app/<graph>/page/<uid>` and the uid parses as a supported region, it calls `openRegion(uid)` once per uid (`data-plexus-landed`-style guard in memory).
- **`src/view/audit-dialog.js`** (new, U): `openAuditDialog({doc, rows, onOpen, onRepair, onClose, dark})` opens an in-page dialog (no `confirm`).
- **Actions** (G owns `src/actions.js` and `src/api.js`):
  - `regionsForAllFrames()`
  - `updateRegionFromSelection(regionUid)`
  - `repairRegion(regionUid)`
  - `selectRegionOnDrawing(regionUid)`
  - `auditRegions({scope: "page" | "graph"})` → rows `{uid, kind, problem, drawingUid}`
  - `copyRegionLink(uid)`, `copyDrawingRef()`, `copyDrawingEmbed()`, `selectTextOnly()`, `removeElementLink()`
  - `restoreBeforeLastPlexusChange()`

  Geometry rewrites keep the head format and only change the geometry tokens, under the drawing lock (A11 of P7). Every Plexus scene write in `actions.js` and `api.js` (API `remove`, migration, crop-to-region, refresh paths) goes through `guard.guardedWrite`. Region opening uses `camera.animateTo` and pushes view history. The Region settings command also opens the new settings.

## Units and file ownership (parallel; only targeted `node --test <files> < /dev/null`; never `npm run check`/`npm test`/build)

| Unit | Owns | Items |
|---|---|---|
| L | `src/view/regions-layer.js`, `test/view-regions-layer.test.js`, CSS marker `/* == p8:layer == */` | REG-1 layer |
| G | `src/actions.js`, `src/api.js`, `src/host/guard.js`, `src/host/roam.js`, `src/view/toast.js`, their tests | REG-1 geometry edits, REG-2, REG-3 action side, REG-5 copy actions, DATA-2, wiring camera/history/guard calls |
| N | `src/host/camera.js`, `src/host/theme.js`, `src/view/spotlight.js`, `src/settings.js`, `src/view/settings-dialog.js`, their tests | UX-3, NAV-3, NAV-4 core, the three settings |
| R | `src/host/native.js`, `src/host/cache.js`, `src/view/regionref.js`, `src/view/crop-popover.js`, their tests | REF-7 (captureSelectionPng, png2x tier, EXP-1 using the warm 2x), REF-4 source peek (cache-only thumbnail at 160, `viewPngCropRect` outline) |
| M | `src/view/mindmap.js`, `src/host/mmwrites.js`, their tests | DATA-2 hook in mind-map reconcile writes (calls an injected `guardedWrite`), DATA-3 flush on `pagehide` / `visibilitychange` |
| U | `src/view/context-menus.js`, `src/view/toolbar.js`, `src/view/landing.js`, `src/view/audit-dialog.js`, their tests, CSS marker `/* == p8:ui == */` | REG-5 menu items and landing, REG-1 toolbar toggle plus block-menu "Select on drawing" / "Update region from selection" / "Repair region", REG-3 dialog, NAV-4 toolbar Back plus Alt+Left, "Restore before last Plexus change" |
| C | all of `~/roam-compass` | CMP-1: open drawing and region nodes through `RoamPlexus.open(uid, {sidebar})` when present, closing the overlay before a main-window open; the sidebar window list is kept |
| I | `src/extension.js`, `test/extension.test.js`, `package.json`, `CHANGELOG.md`, `test/build.test.js`, CSS merge, `docs/spec-plexus.md` §8 | wire everything, 0.8.0, both repos green |

## Gate

The roadmap-next P8 live gate, items 1-11. There is no STOP gate in P8: all tests run in Readwisenotes, and svy is not touched.

## Amendments (critic, binding)

These override the body where they conflict. Code references are to `4cc4b11` (roam-plexus) and `51be821` (Compass). "Source" marks Excalidraw behavior read from its source and not re-measured on Roam's 0.18.0; A33 measures those items.

### L

A1. Geometry and cost.
   - The outline box is `regionSceneBBox(region, elements, app.state)` with the region's own pad, which is the crop's bounds (frame label included). It is not backlinks' pad-0 content box (`backlinks.js:128`).
   - Kinds drawn: area, group, frame, cframe, rect, poly. Unsupported or unresolvable regions draw nothing.
   - Scene boxes are recomputed only when the scene signature changes (`app.scene.getSceneNonce?.()`, else the backlinks version sum) and no element gesture is active (`newElement`, `resizingElement`, `isResizing`, `isRotating`, `editingTextElement`, `selectedElementsAreBeingDragged`). One live-element `Map` is built per recompute and shared by every region; `regionSceneBBox` rebuilds it per call otherwise. A pan changes only scroll and zoom, so a pan frame does `viewportRectOf` plus style writes and nothing else.
   - Per frame, read the container rect once. Write `transform: translate(x, y)` and width/height only when they change. A culled item gets `display: none` only on a state change. No per-item layout reads.
   - With `debug` on, log `[plexus] regions layer p95 N ms` every 120 layout frames. Gate 1 reads it.
A2. Chips and input.
   - Chip text is `plainCaption(region.caption, resolveBlock)` when non-empty. Otherwise it is `${KIND_WORDS[kind]} ${n}`, where n is the 1-based position in container order. Cut it at 32 characters with `…`. `title` and `aria-label` are `labelOf(region)`. The full label alone would print "Drawing · area" on every uncaptioned chip. `plainCaption` and `KIND_WORDS` come from `model/label.js`, which already exists.
   - The chip sits above the outline's top-left corner, flipped inside when it would leave the container rect. Backlink badges own the top-right corner.
   - Chips: `mousedown` preventDefault (no focus steal, so Excalidraw shortcuts keep working), `pointerdown` stopPropagation, click → `onSelect(uid)`, Shift-click → `onOpenSidebar(uid)`, Enter/Space like click. The root and outlines are `pointer-events: none`.
   - Layer z-index is the passed `zIndex` exactly (not +1), so the toolbar, badges (+1), the mind-map input (+2) and embed overlays paint above chips. A body portal at the editor's z covers Excalidraw's own menus, so the whole layer hides while `app.state.contextMenu`, `openDialog`, `openMenu` or `openPopup` is set.
A3. Lifecycle.
   - The layer is created hidden. `show()` fetches `host.regionsOf(drawingUid)` and subscribes `native.subscribeViewport`. `hide()` unsubscribes and drops the DOM, so nothing listens while hidden.
   - Refetch on `show()`, on `refresh()`, and every 3 s while visible (the backlinks cadence). Cap at 150 in container order, with one console warn.
   - With a null `drawingUid`, `show()` is a no-op and `visible()` is false. `dispose()` hides and removes the root, and is idempotent.

### G

A4. Guard contract (replaces the body's signature). `guardedWrite(app, {drawingUid, next, label, captureUpdate, force = false, onApplyAnyway})` is synchronous, because the mind map must read and write in one task (P4 amendment 34).
   - `next` is an element array or `(current) => array`, evaluated against `app.getSceneElementsIncludingDeleted()` in the same task. `captureUpdate` is forwarded only when given, so writes keep today's undo behavior.
   - `before` and `after` count `!isDeleted` elements in current and next. Refuse iff `!force && before > 10 && after * 5 <= before`.
   - A refusal writes nothing and returns false. It toasts "Not applied: would remove N of M" (N = before − after) with "Apply anyway". An identical refusal (same drawing, label, N and M) while that toast is visible does not toast again.
   - Apply anyway: when the app is no longer the active editor of that drawing, toast "Drawing is no longer open". Otherwise call `onApplyAnyway()` when given (the caller re-runs with `force`). Failing that, re-evaluate a function `next` with `force`. An array `next` is applied only if the scene signature (live count + version sum) still matches the one at refusal; otherwise toast "The drawing changed; run it again".
   - The pending closure is dropped when its toast hides and on `dispose()`.
A5. Snapshots (replaces "before any write it snapshots").
   - A ring entry is pushed only for an applied write that removes at least one live element and whose `captureUpdate` is not `"NEVER"`. Additions and modifications push nothing, so a stream of small writes cannot evict the entry that matters.
   - Mind-map projection writes are guarded but never snapshotted. The outline is their source of truth, and the next reconcile would undo a restore.
   - An entry is `{drawingUid, time, label, before, added}`. `before` is a `structuredClone` of the pre-write versions of the elements the write removed or changed. `added` lists the ids the write created. That is a delta, not the scene. The clone is required: Excalidraw's `mutateElement` mutates elements in place, so a snapshot of references would be rewritten by later edits.
   - Ring of 5 per drawing, at most 10 drawings (LRU by write time). The ring survives editor unmount and is cleared by `dispose()`.
   - `restoreLast(app, drawingUid)` runs only when `app` is the active editor of that drawing. Each `before` element whose current copy exists becomes `{...before, version: current.version + 1, versionNonce: random, updated: Date.now()}`. A missing one is appended with `version + 1`. Each `added` id that is still live gets `isDeleted: true`, bumped. Every other element stays as it is now, so user edits made after the write survive.
   - The restore is one `updateScene({elements, captureUpdate: "IMMEDIATELY"})`. It skips the shrink check, pushes no entry and pops the one it used. It toasts "Restored N elements; Undo reverses this" and returns N. With no entry it returns 0 and toasts "Nothing to restore".
A6. Which writes are guarded.
   - Every `updateScene` that carries `elements` in `api.js` goes through `guardedWrite`: `add`'s post-paste write (:99), `update` (:117) and `remove` (:127). So do the mind map's writes (A22) and the new `removeElementLink`.
   - Exempt, with the reason in the CHANGELOG:
     - `addViaPaste` (migration :1883, API `add`) and `native.insertElements` (embeds) only add elements.
     - Crop-to-region (`regionFromCrop`) and the refresh paths write no scene elements at all. The roadmap's list is wrong about them.
   - API `remove(ids, {force} = {})`: a refusal throws `Error("Not applied: would remove N of M")` after the toast, and Apply anyway still works for the person at the screen. `force: true` bypasses the check. This is a new API option, so `API_VERSION` becomes 4 (I updates spec §8).
A7. Toast. `show(message, {kind, ms, action: {label, run}})`.
   - An action toast renders `button.plexus-toast-action` (mousedown preventDefault; click runs once, then hides) and stays 10 s. Without an action the default is still 2600 ms.
   - A plain `show` while an action toast is visible is held and shown after it closes (latest wins). A new action toast replaces the old one and drops its closure. `dispose()` clears both.
   - CSS goes under a new `/* == p8:toast == */` marker.
A8. REG-2 `regionsForAllFrames()` works in the active editor only.
   - Frames are `orderFrames(sceneElements(app))`, frame and magicframe. Skip a frame that the `fr=` token of any existing `frame` or `cframe` region in `host.regionsOf` already names.
   - Create `cframe` regions in slide order. The caption is the trimmed `frame.name`, empty when unnamed, in every caption mode (no prompts in a batch). At most 50 per run; beyond that, toast "Created 50; run again for the rest".
   - `host.createRegion` takes the drawing lock itself (`roam.js:127-140`), and Web Locks are not re-entrant, so an outer `withLock` would deadlock. Add `host.createRegions(drawingUid, strings) → uids`. It holds one lock, ensures the container once, creates sequentially with `order: "last"`, stops at the first failure and returns what it made.
   - No clipboard write, no per-region toast, no hot capture. One final toast: "Created N frame regions" or "Every frame already has a region". Emit `{uid, kind: "region"}` per created region; I debounces the layer refresh.
A9. REG-1 `updateRegionFromSelection(regionUid)` and pending updates.
   - The block menu cannot see a selection: the full-screen editor covers the outline, and closing it drops the selection.
     - If the active editor is the region's drawing and has a non-empty selection, apply now.
     - Otherwise call `selectRegionOnDrawing(regionUid)`, arm `pending = regionUid`, and toast "Select the new elements, then right-click → Plexus: Update region from selection".
   - New exports: `pendingRegionUpdate() → {uid, label} | null`, `applyPendingUpdate()` and `cancelPendingUpdate()`. Pending clears on apply, on `cancelDrawingTool()` (editor unmount) and on `dispose()`.
   - The kind never changes:
     - area: `ids=` becomes the selection in scene order, the same set `createAreaRegion` stores;
     - group: the selection must be exactly one group per `detectRegionKind`, which sets `g=`;
     - frame or cframe: exactly one frame, which sets `fr=`;
     - rect or poly: exactly one unrotated image, which sets `el=`; the fractions are kept, and the update is refused when `displayedRect`/`displayedPoly` returns null;
     - image kinds: refused.
   - Replace only that one token's value inside the current head. Token order, `pad`, extras and the tail stay byte-identical.
   - Before writing, check that `parseRegion(next)` is supported, with the same kind, `drawingUid` and caption, and that `geometryKey` changed. Otherwise toast "Region already matches the selection".
   - Write through `host.updateRegionString(d, uid, next, {expect: before})`. G adds `expect`: the block is re-pulled inside the lock, and a mismatch throws, toasting "Region changed elsewhere; not updated".
   - After the write: `putSvg(uid, region, await hotSvg(app, region))`, the png2x warm (A14), `emit({uid, kind: "region"})`, then `refreshRegion(uid, {purge: false})`.
A10. `repairRegion(uid)` resolves `{fixed, reason}`.
   - Only one repair is automatic: an area region that `regionSceneBBox` reports with `missing` ids while at least one id is live. The missing ids are dropped, with the same one-token rewrite and compare-and-set as A9.
   - Every other drawing-target problem arms a pending update (A9) and returns `{fixed: false, reason: "reselect"}`. These are: all elements gone, group or frame missing, image missing, rotated or not an image, and outside the crop.
   - Listed but never repaired: unsupported strings, a region outside any container, an owner mismatch (`d=` is not the container's owner), and duplicate or orphan containers.
A11. `auditRegions({scope})` returns rows `{uid, kind, problem, detail, drawingUid, label, pageTitle, repair: "auto" | "reselect" | null}`.
   - Problem codes:
     - region rows: `unsupported`, `no-owner`, `partial` (area with some ids missing), `no-elements`, `outside-crop`, `not-image`, `rotated`, `not-frame`, `no-image`, `outside-container`, `owner-mismatch`;
     - container rows (the container's uid, `kind: "container"`): `two-containers`, `orphan-container`.
   - Queries live in `roam.js`. Page scope uses the page of `mainWindow.getOpenPageOrBlockUid()`; a block resolves to its `:block/page`, and none toasts "Open a page first". It finds refs to page `plexus-region` whose `:block/page` is that page, with their parents, plus the containers on that page with their parents. Graph scope runs the same queries without the page clause.
   - Blocks that ref `[[plexus-region]]` without parsing as a region are skipped.
   - Cost:
     - Group rows by `d=` and call `host.drawing` once per drawing. Its memo holds 64, so a walk in uid order would thrash it.
     - In graph scope, yield (`await sleep(0)`) after every 20 drawings and stop at 2000 rows; the dialog says when rows were cut.
     - Stop when disposed.
A12. Copy items. All clipboard writes go through `native.withClipboard`, with no `await` before them.
   - `copyRegionLink(uid)` writes `https://roamresearch.com/#/${route}/${encodeURIComponent(graph)}/page/${uid}`, where `route` is `offline` when the current hash starts with `#/offline/`, else `app`.
   - `copyDrawingRef()` writes `((drawingUid))`. `copyDrawingEmbed()` writes `{{[[embed]]: ((drawingUid))}}`.
   - `selectTextOnly()` reduces the selection to free text elements (no `containerId`). With nothing selected it selects all free text elements. It writes appState only.
   - `removeElementLink()` sets `link: null` (bumped) on selected live elements that have a link, through `guardedWrite` with `IMMEDIATELY`, and toasts the count.
A13. Region opening (NAV-3 and NAV-4 wiring).
   - Once `openRegionOnce` has the editor: `await native.waitNotLoading(app, 5000, {doc})` plus two frames, because Excalidraw's own initial view lands after load. Then `viewHistory(app)?.push(app)`. Then `await camera.animateTo(app, box.bbox, {maxZoom: settings.zoomCap, animate: motionOk(doc, settings.animation), doc})`. This replaces the instant `zoomTo(…, {maxZoom: 1})` at `:2056` and the `sleep(60)`.
   - The spotlight runs only if the camera did not abort. Its rect is recomputed after the move settles, and `motion` is passed through.
   - `selectRegionOnDrawing(uid)`: if the drawing is the active editor, select only (no camera, no history). Otherwise open it as above, then select.
     - Selection sets: area, its live ids; group, its members plus `selectedGroupIds {g: true}`; frame and cframe, `[frameId]`; rect and poly, `[el]`.
     - When nothing is live, toast "Region elements are gone; use Repair region".
   - These are injected with inert defaults, so G's tests need no other unit: `guard` (default: a direct write with no ring), `camera` (default: `native.zoomTo`, resolving `{moved: true}`), `motionOk` (default `() => false`) and `viewHistory` (default `() => null`). G imports nothing new from N, R, L or U.
A14. png2x in actions. EXP-1 and the hot refresh live in `actions.js`, which R does not own, so G makes these calls.
   - In the `refreshCrops` hot path and in A9, for area, group, frame and cframe only, after `putSvg`: `native.captureSelectionPng?.(app, hotIds(region), {scale: 2, dark})`, with `dark = isHostDark(doc) && settings.darkCrops`.
   - Store the result under the tier literal `"png2x-dark"` when dark, else `"png2x"`, with `persist: false`. `{w, h}` is the PNG's pixel size divided by 2, read from the IHDR (bytes 16-23).
   - Drop the capture with a `[plexus]` warning when its size differs from the hot SVG's viewBox × 2 by more than 4 px. That catches a frame label lost at 2×.
   - No capture at region creation, so creation latency stays as it is.
   - `startPng` checks memory `png2x` first, then follows P7's order. It never uses `png2x-dark`, because Word pastes are light, and a png2x source is not `lowRes`.

### N

A15. Settings.
   - `zoom-cap` has items `["100","150","200"]`. `readSettings().zoomCap` is the Excalidraw zoom factor 1, 1.5 or 2, passed as `maxZoom`; it is not a percent.
   - `animation` has items `["system","on","off"]`; an unknown value reads as `"system"`.
   - `region-landing` is a switch read as `regionLanding`.
   - All three go in the Depot panel (no repaint) and in the dialog: "Zoom limit" (100% / 150% / 200%), "Animation" (Follow system / On / Off) and "Open region links in the drawing" (checkbox).
   - `motionOk(doc, setting)` uses `doc.defaultView?.matchMedia`. A missing `matchMedia` or a throw counts as true for `"system"`. Callers read the setting on every call.
A16. The camera is Plexus's own tween, not `scrollToContent`.
   - Per the source, `scrollToContent` takes elements, not a box. Its `fitToContent` zoom is capped at 1 and floored to 10% steps, and `maxZoom` support in 0.18.0 is unmeasured. It could not honor zoom-cap 150/200 or land exactly where Back and the spotlight expect.
   - API: `animateView(app, {scrollX, scrollY, zoom}, {animate, doc, raf, now, duration = 400})` and `animateTo(app, bbox, {maxZoom, animate, doc})`. `animateTo` computes the target with `fitZoom` (margin 0.12, like `zoomTo`) and resolves `{moved, aborted, rect}`.
   - Already framed: if the bbox lies inside the canvas and the current zoom is between 0.6× and 1.25× the target, resolve `{moved: false}`.
   - With `animate` false, write the exact target in one `updateScene`.
   - With `animate` true, run a tween:
     - Each frame calls `updateScene({appState: {scrollX, scrollY, zoom: {value}}, captureUpdate: "NEVER"})`, with cubic ease-out. Zoom is interpolated geometrically and the bbox centre stays on the path. The last frame writes the exact target.
     - Set `shouldCacheIgnoreZoom: true` at the start and false in `finally`, only if the key exists in `app.state`. Excalidraw's own animation does the same.
     - Two frames whose `updateScene` takes more than 32 ms jump straight to the target.
   - Abort on a document-capture `pointerdown`, `wheel` or `keydown`, when the app is no longer the active editor, or on a newer `animateView`. An abort stops in place (no snap), resolves `{aborted: true}` and removes its listeners.
A17. History.
   - `createViewHistory({cap = 50, onChange})`:
     - `push(app)` stores `{scrollX, scrollY, zoom}` unless it equals the top entry (|Δscroll| < 0.5 and |Δzoom| < 0.001). It drops the oldest entry over the cap and calls `onChange`.
     - `back(app, {animate = false, doc})` pops the top entry and returns through `animateView`, so the final write is exactly the stored values, with `captureUpdate: "NEVER"`. It resolves false when the history is empty.
   - There is one history per mounted editor (I wires it), never shared across apps.
   - In P8, only region opens push: `openRegion`, landing and Compass. There is nothing to record for presenter slide jumps (they happen in a dialog of images) or Roam link jumps (they leave the editor). Mind-map arrow pans and API `zoomTo` do not push. "Return to source block" is deferred, and the CHANGELOG says so.
A18. Spotlight: `showSpotlight({rect, doc, durationMs = 1400, motion = true})`.
   - With `motion`, the element gets `plexus-spotlight--pulse`: two 450 ms pulses, then a fade. Without it, `plexus-spotlight--static` stays still for the same duration.
   - Any `keydown`, `wheel` or `pointerdown` still ends it.
   - It does not wait on its own; callers pass the settled rect.
   - CSS goes under a new `/* == p8:motion == */` marker, including a `prefers-reduced-motion: reduce` rule that drops the pulse animation.

### R

A19. `captureSelectionPng(app, ids, {scale = 2, dark = false, clipboard, raf, timeoutMs = 3000, graceMs = 1500})` returns `Promise<Blob|null>` and never throws.
   - It chains on the same `captureTail` and `capturing` counter as the SVG capture, so `clipboardBusy()` and `withClipboard` cover it. It queues rather than refuses; refusing belongs to the EXP-1 callers. The body's "refuses while busy" is withdrawn.
   - Read `prev = {exportScale, exportWithDarkMode}` from `app.state` inside the queued run, not at call time, because a queued capture may have changed them.
   - Set the selection, `exportScale` and `exportWithDarkMode` in one `updateScene`, wait one frame, then `executeAction(actions.copyAsPng, "contextMenu")` as measured.
   - Stub only `clipboard.write`: take the first item with type `image/png` and `await getType`. `writeText` passes through.
   - Restoring "in the same task" is impossible, because the export awaits a canvas render. Restore `prev` synchronously inside the stub as soon as it is called (the canvas exists by then), and again in `finally` together with the selection and `toast: null`. This keeps short the window in which an unrelated element change could make Roam save the export keys into `state-json`.
   - On timeout, the grace stub swallows only `image/png` items.
A20. Tiers and paint.
   - `cache.js` exports:
     - `TIER_PNG2X = "png2x"` and `TIER_PNG2X_DARK = "png2x-dark"`;
     - `thumbKey({uid, hash, maxWidth})`, which a test asserts equals `cropKey({regionUid: uid, geometryKey: "thumb", drawingHash: `${hash}|${maxWidth}`, tier: "png"})`. G may switch `thumbnailRun` to it.
   - `CACHE_VERSION` is unchanged. The png2x tiers are read with `peek` only, never `get`.
   - `keysFor` gains both png2x keys for drawing kinds.
   - Paint and hover order:
     - A warm `png2x-dark` comes first when the host is dark, `darkCrops` is on, and the drawing's own theme is not dark.
     - Then the svg, then `png2x`, then `png`.
   - The invert decision is made per entry: a `png2x-dark` entry never gets `plexus-crop--invert`.
   - Scope for the CHANGELOG:
     - The svg already paints hot crops crisp, and P7's EXP-1 already rasterizes a warm svg at 2×.
     - P8's real gains are an exact dark paint, including regions over images that today stay light in a dark host, and a PNG for SVGs that cannot rasterize.
     - The cold 1× path after a reload is unchanged, and it is the only path on encrypted graphs. The "1x cold crops" open item stays open.
A21. REF-4 source peek.
   - For drawing kinds, the hover entry gains `peek: {url, w, h, rect, title, kind}`:
     - The thumbnail is `cache.peek(thumbKey(...)) ?? await cache.get(...)` at maxWidth 160 with `hash = target.hash`. `actions.thumbnail` is not used: it returns a Blob and is G's file.
     - `rect` is `viewPngCropRect({elements, appState, bbox: target.sceneBox.bbox, naturalWidth: ew, naturalHeight: eh})`, scaled by `thumb.w / ew`, at least 4 px per side. `ew` and `eh` come from `exportBounds` plus 2 × 10; the thumbnail's own size would fail the mismatch check.
     - `title` is `drawingTitleOf` via `host.labelSource`, and `kind` comes from `KIND_WORDS`.
   - A cold thumbnail or any error means no peek: the crop alone, logged once.
   - Layout:
     - A header line (title · kind) sits above.
     - The crop goes left, within today's 480×360 limit.
     - The 160 px thumbnail goes right, with an absolutely positioned outline `div` (no canvas, no decode). It follows the crop's invert rule.
     - Flip and clamp use the combined size.
   - Aliases get the same peek. CSS goes under a new `/* == p8:peek == */` marker.

### M

A22. Guard hook.
   - `createMindMap({…, guardedWrite})` defaults to a direct `updateScene` that returns true. `mount({…, drawingUid})` gains the drawing uid.
   - `commit` and `detach` call `guardedWrite(app, {drawingUid, next, label: "Mind map", captureUpdate: "NEVER", force, onApplyAnyway})` in the same task as today's read.
   - A refusal counts as "no change": no `takeSnapshot`, no `afterApply`, and the tree is kept. `onApplyAnyway` re-runs `commit(null, roots, {force: true})` or `detach(root, {force: true})`.
   - The reconcile after a user-confirmed `deleteBranch` (Alt+Backspace pressed twice) passes `force: true`. The root stays marked until its next commit or 5 s. The roadmap's "must not block a deliberate branch delete" depends on this.
   - Toast dedupe is the guard's job (A4), so repeated reconciles do not spam.
A23. DATA-3 flush.
   - Each session adds `pagehide` on `doc.defaultView` and `visibilitychange` on `doc` at mount, and removes them at dispose.
   - `flush({unloading})` cancels the pending rAF `pass`, since rAF does not run in a hidden page, and runs `pass({force: true})` synchronously. `force` ignores `gestureActive()`, whose fields can stay stale after the window loses the pointer.
   - Only on `pagehide`, first call `closeInput({write: true})`. `visibilitychange` must not close an open node input.
   - `dispose()` runs `flush` before teardown. Today a pass pending when the editor closes is cancelled, and its outline write is lost.
   - Maximum wait: a pass deferred by a gesture for more than 4000 ms runs forced on the next `onChange` or pointerup.
   - The `mmwrites` queue already issues writes at once, so it has nothing to drain. A write still in flight at unload is out of Plexus's control (CHANGELOG).
   - Test: with a fake raf that never fires, a native text edit, then `pagehide`, `writer.updateString` is called synchronously.

### U

A24. Roam menus.
   - Region-block menu: "Plexus: Select on drawing", "Plexus: Update region from selection", "Plexus: Repair region" and "Plexus: Copy region link". "Repair region" shows only when `resolveRegionTarget` errors or an area has missing ids, memoized like `blockInfo`.
   - Block-ref menu: "Plexus: Copy region link".
   - Callbacks call actions with no `await` before them.
A25. The canvas items leave `extension.js`. `context-menus.js` exports `plexusCanvasItems({app, native, actions, openSettings, drawingUid})`.
   - It returns today's nine items unchanged, plus:
     - with nothing selected: "Plexus: Copy ((drawing))", "Plexus: Copy drawing embed", "Plexus: Regions for all frames" (when `hasFrames`) and "Plexus: Restore before last Plexus change" (when `hasSnapshot`);
     - with a selection: "Plexus: Select text only" (at least 2 selected, at least 1 free text), "Plexus: Remove link" (a selected element has a `link`), and `Plexus: Update region "‹label›" from selection` while `pendingRegionUpdate()` is set.
   - I replaces the inline list with this call. Tests cover each condition.
A26. Toolbar and Alt+Left.
   - `createEditorToolbar` gains `onToggleRegions`/`regionsVisible` (a "Regions" button with `aria-pressed`) and `onBack`/`canBack` (a "Back" button, gated like Frame, titled "Back (Alt+←)").
   - New `installBackKey({containerEl, app, canBack, onBack})` returns a disposer. It listens to capture-phase `keydown` on the container and acts only when all of these hold:
     - the key is Alt+ArrowLeft with no Ctrl, Meta or Shift, and not composing;
     - the target is the container (the same check as `mindmap.js:491`);
     - no `editingTextElement`, `openDialog`, `openMenu` or `contextMenu`;
     - nothing is selected;
     - `canBack()` is true.
   - When it acts, it calls preventDefault, stopImmediatePropagation, then `onBack()`.
   - With a selection it passes the key through untouched. The mind map uses Alt+arrows on a selected node (`mindmap.js:511`), and per the source, Excalidraw 0.18 uses them for flowchart navigation on a selected element. With an empty history it also passes through. The toolbar Back works either way.
A27. Landing (`installRegionLanding`).
   - Route: `^#/(app|offline)/<graph>/page/<uid>$`, where the graph equals `api.graph.name` (decoded) and the uid is a supported region per `host.pullBlock` + `parseRegion`.
   - `regionLanding` is read on each event.
   - The initial check runs only when `win.performance.now() < 30000`, meaning a fresh page load, not a Depot re-enable.
   - Later navigations:
     - If `win.navigation` exists, note its `navigate` event's `navigationType` and act on the following `hashchange` only for `"push"` or `"replace"`.
     - A traverse (Back or Forward) never lands. Landing moves the main window to the drawing block, so Back would otherwise re-land forever.
     - Without the Navigation API, use `hashchange` alone with the same dedupe.
   - Remember the last handled hash; the same hash never lands twice in a row. A later push back to it lands again, which is what "once" means.
   - Never land while `native.activeEditor(doc)` is open. Log `openRegion` failures; never throw.
A28. Audit dialog.
   - `openAuditDialog({doc, rows, onOpen, onRepair, onClose, dark})` returns `{close, update(rows)}`. It is modelled on `cleanup-dialog.js`: a modal `<dialog>` that stops the settings dialog's event set, with Esc and Close.
   - Rows are grouped by page, then drawing, and show label, problem text and detail.
   - Open closes the dialog first, then calls `onOpen(row)`. A modal left open would make the full-screen editor inert.
   - Repair shows only when `row.repair` is set. It keeps the dialog open and sets the row status from `onRepair(row)`: "Fixed", or, for `"reselect"`, it closes the dialog because A9 opens the drawing.
   - Copy report (JSON). At most 500 rows are rendered, plus a "+N more" line. The empty state reads "No problems found". CSS goes under `/* == p8:ui == */`.

### C

A29. Compass.
   - Route through `RoamPlexus.open` only when `typeof api.open === "function"` and the node or outline row is drawing-like. This covers double-click (which opens in the sidebar in Compass, `overlay.js:1180-1190`), "Open in sidebar" and "Open in main window", each passing its `{sidebar}`.
   - When to close the overlay:
     - before any region open, sidebar or main, because `openRegion` goes full-screen even from the sidebar;
     - before a main-window drawing open, as today;
     - not for a drawing opened in the sidebar, which Plexus opens as a plain block by design.
   - `close()` already calls `releaseSidecar()`, not `closeSidecar`, so the sidecar window stays. Gate 8 compares the sidebar window list before and after, apart from the one window added.
   - Fall back to `host.openInSidebar` / `openInMain` when Plexus is absent or `open` throws synchronously. A rejected promise is logged only. The log prefix stays `[compass]` in that repo.
   - Tests:
     - region double-click: close, then `open(uid, {sidebar: true})`;
     - drawing opened in the sidebar: no close;
     - Plexus absent: the old path.
   - Version 0.4.0 plus its CHANGELOG. C runs only Compass's `npm run check`.

### I

A30. Wiring in `extension.js`.
   - Create one `createWriteGuard({toaster})` and inject it:
     - `createActions({guard, camera, motionOk, viewHistory: (app) => (mounted?.app === app ? mounted.history : null)})`;
     - `createSceneRegistry({guard})`;
     - `createMindMap({guardedWrite: guard.guardedWrite})`, with `mindmap.mount({…, drawingUid: mountUid})`.
   - Per mount:
     - `history = createViewHistory({onChange: toolbar.refresh})`;
     - `createRegionsLayer`, shown when the session flag `layerOn` is set;
     - `installBackKey`;
     - `plexusCanvasItems`.
   - A `region` emit triggers a debounced `layer.refresh()` and a backlinks refresh. `installRegionLanding` is installed at load.
   - Commands:
     - "Plexus: Regions for all frames";
     - "Plexus: Audit regions on this page" and "Plexus: Audit regions in graph". Both open the dialog with `onOpen` → `actions.openRegion` for resolvable rows, else `host.openBlock(row.drawingUid ?? row.uid)`, and with `onRepair` → `actions.repairRegion`;
     - "Plexus: Restore before last Plexus change";
     - "Plexus: Toggle regions layer";
     - "Plexus: Back to previous view".
   - `unmountEditor` disposes every per-mount piece.
A31. CSS and docs.
   - Before fan-out, the orchestrator appends empty markers `p8:layer` (L), `p8:ui` (U), `p8:motion` (N), `p8:peek` (R) and `p8:toast` (G). Units edit only under their own marker, with exact-string Edits (P6 A6).
   - Spec §8: `apiVersion` 4 and `remove(ids, {force})`.
   - CHANGELOG notes: the A6 exemptions, the A17 scope, the A20 scope and the A23 unload limit.
   - Version 0.8.0.

### Gate

A32. Isolation.
   - All units run in parallel and fake one another.
   - Cross-unit imports are limited to modules that already exist at `4cc4b11`. A missing named ESM export fails the importing test file at link time.
   - New cross-unit names reach code only by injection (A13, A22, A30).
   - I runs last.
A33. Measure before relying on it. The orchestrator runs these in Readwisenotes over trusted CDP, with the Roam window focused, and records them in spec §13:
   - (a) The tween's frame cost on the 600-element drawing with `shouldCacheIgnoreZoom`. If p95 exceeds 32 ms, report it before the gate, since the A16 guard would turn every animated open into a jump.
   - (b) Alt+Left in the editor with and without a selected element, including whether Roam Desktop navigates back on it.
   - (c) `copyAsPng` at 2× against the svg viewBox × 2, for a frame region and a cframe (a single-frame selection, which exports with no padding and no label per the source). Also check that images keep their colors in a `png2x-dark` capture.
   - (d) `typeof navigation` in Roam Desktop.
   - (e) Whether the full-screen editor covers the right sidebar. If it does, Shift-click on a chip toasts "Opened in sidebar", as the backlinks popover does.
A34. Gate clarifications.
   - 5: Landing is exercised by a push navigation (clicking the region block's bullet) and must not re-land on Back. Back is checked by comparing `app.state.scrollX`, `scrollY` and `zoom.value` exactly against the values before the open.
   - 6: The synthetic write is `RoamPlexus.scene(uid).remove(ids40)` on a 50-element drawing. It throws and the toast offers Apply anyway. After Apply anyway, Restore brings the 40 back and Ctrl+Z removes them again. The mind-map `pagehide` check fires `pagehide` with a native node-text edit pending.
   - 7: `Emulation.setEmulatedMedia` with reduce and animation "system" gives an instant move and a static spotlight. Animation "on" still animates.
   - 10: "Editor mounted" means after a hot "Refresh crops" in the open drawing; the ref menus cannot be reached under the full-screen editor.
     - With the editor then closed, Copy crop as PNG pastes 2×, from png2x or the rasterized svg.
     - After "Clear crop cache", with no warm svg, it pastes 1× with the toast.
     - The frame region's png2x passes the A14 size check.
A35. New live checks.
   - (a) With the layer on, chips never cover the Excalidraw context menu or the Plexus toolbar, and after a chip click, Delete still acts on the selection.
   - (b) Update region from selection from the block menu opens the drawing and shows the pending item in the canvas menu. The string diff shows exactly one token changed.
   - (c) A mind-map branch deleted with Alt+Backspace twice is never refused. Deleting the root block in the outline of a drawing that holds only a map is refused, with Apply anyway.
   - (d) Three seconds after a png2x capture, `:edit/time` is unchanged and `state-json` does not hold `exportScale: 2`, including when the capture overlaps a mind-map reconcile.
