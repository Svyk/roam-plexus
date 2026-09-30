# Plexus for Roam Excalidraw: implementation spec (draft 1, 2026-09-28)


## Context

Roam's native `{{[[excalidraw]]}}` component stores drawings in `:block/props` and rewrites the block string tail on save. The user wants the extra features of Obsidian Excalidraw and their own Thymer Plexus Canvas on top of that native component, with region refs (block-reference part of an image) as the flagship, and a Compass hookup that mirrors K-Plex + Obsidian Excalidraw. Speed is first-class: nothing on the typing path, nothing heavy until a drawing is used.

Proposed repo: `~/roam-plexus` from `~/roam-extension-template` (own `.git`, never under `~/system-setup`). Depot name "Plexus" (the user's own brand; avoids the Excalidraw+ trademark). Pages URL `https://svyk.github.io/roam-plexus`. Version flag `window.__ROAM_PLEXUS_VERSION` (mirrors Compass `src/extension.js:6`).

## 1. Goals / non-goals

| Goals | Non-goals (deliberately out) |
|---|---|
| Extend NATIVE `{{[[excalidraw]]}}` drawings; never replace the native component | Own Excalidraw build, CDN load, or bundling `@excalidraw/excalidraw` (rule 7, SKILL.md:291) |
| **Region refs**: a part of a drawing or image is a real Roam block, so `((uid))`, `{{embed}}`, backlinks work | AI providers, OCR, LaTeX, script store, PDF import (Obsidian README.md:256, 330-341) |
| Element links, hover preview, thumbnails, block embeds on canvas, mind-map builder, frames as slides, legacy ExcalDATA migration, small automation API | Own canvas renderer (Plexus had one; here Roam's Excalidraw is the renderer) |
| Compass contract: thumbnails and regions as nodes, "new related drawing", sidecar | New Compass write paths; Compass keeps reading harcs and refs only |
| Zero cost on the typing path; nothing heavy until a drawing is used | Shadow database of drawing data (rule 10, SKILL.md:317); writing to the `{{-: }}` tail (Roam owns it) |

## 2. Licensing boundary

| Source | License | What we take | What we never take |
|---|---|---|---|
| Obsidian Excalidraw (`~/excalidraw-port-research/obsidian-excalidraw-plugin`) | AGPL-3.0 since 8df4364b 2026-05-13 | Behaviors only: `#^area=`/`group=`/`frame=`/`clippedframe=` + `,padding=N` (README.md:270-289; MarkdownPostProcessor.ts:1168-1173; src/utils/embeddedFilenameParts.ts:20-69), render cache keyed by ref + dark + type + scale (MarkdownPostProcessor.ts:144-149), md embeds (README.md:309-329), Automate surface names (ExcalidrawAutomate.ts:1459 create, 2320 addFrame, 2351 addRect, 2596 addText, 2782 addArrow, 2956 addImage, 3175 connectObjects, 4063 viewZoomToElements), ea-scripts "Mindmap Builder", "Slideshow" | Any code, CSS, regex, asset |
| K-Plex (`~/kplex-reference`) | AGPL | Behaviors: availability probe (src/main.ts:3048-3055), create-drawing-and-link flow (3584-3639), modal note/drawing choice (src/ui/NewRelatedNoteModal.tsx:40-119), sidecar semantics (README.md:208-233) | Code |
| zsviczian roam-excalidraw 2021 (legacy ExcalDATA) | none | Format understanding for migration only | Code |
| Plexus Canvas (`~/excalidraw-port-research/thymer-canvas-plugin`) | user's own | Anything: `pointInPoly` plugin.js:981, `pxcNormFrac` :1595, `_imgRegionFrac`/`_imgRegionWorld` :3302-3311, `_showRegionChoice` :3405, `_flashAnchor` :3768, `_navToCanvasAnchor` :12943, mind-map model (MINDMAP-WORKLIST.md:18-27), nested target design (NESTED-TARGET-DESIGN.md:8-24), `tests/pxc_frac.test.js` | Thymer SDK calls |
| Compass (`~/roam-compass`) | MIT, user's | Model/host/view split, `withLock` host.js:302-311, sidecar host.js:469-487, pull-watch discipline host.js:32-35, 346-362 | n/a |
| Roam Grid, template | MIT, user's | Discovery (roam-grid src/extension.js:13845-13898), echo absorption (:3499-3546), `.enc` handling (:7256-7321), IndexedDB cache (:4514), metadata page (:9), `renderBlock` mount (:9028); template `build.mjs:9-31`, `src/lifecycle.js:10`, `.github/workflows/pages.yml` | n/a |

## 3. Measured facts and unknowns

Facts 1-7 of the work order are ground truth, recorded in `~/openkb-roam-plugin/raw/session-learnings/2026-09-28-native-excalidraw-storage-and-module.md:4-14`. KB correction: `raw/data-model.md:114` only calls props "internal"; the "data is in the block string" claim was an agent inference, not KB text. `references/roam-alpha-api.d.ts:71-80` shows `UpdateBlockArgs` has **no `props` field**; props are pull-only through the public API today. `registerComponent` / `unregisterComponent` are untyped (d.ts:363-365).

| # | Unknown | Resolved by |
|---|---|---|
| U1 | Any public or semi-public call that writes `:block/props`? | S3 |
| U2 | Where image bytes live (no `files` map in `state-json`) and whether they are `.enc` | S4 |
| U3 | Is `exportToSvg` reachable without a mounted drawing? | S2 |
| U4 | Does the native save fire after an external `updateScene`? | S1 |
| U5 | Does `registerComponent` let us own rendering of `{{[[plexus-region]]}}`? | S5b |
| U6 | Do element `link` clicks reach a handler we can intercept? | S6 |
| U7 | Echo shape and latency of props changes on a pull watch | S3 |

## 4. Phase 0 spikes

All on a disposable page `Plexus Spike 2026-MM-DD` in `Readwisenotes`. CDP :9223, trusted events only (rule 13, SKILL.md:343). Never touch the 11 Svy drawings.

| Spike | Method | Pass | Fail fallback |
|---|---|---|---|
| S1 imperative API | From the `.excalidraw` container walk `__reactFiber$*` upward to the fiber whose state or props hold `updateScene`, `getSceneElements`, `getAppState` (fact 4: API kept in an atom; find the ref). `updateScene({elements: [...+1 rect]})`, blur, pull `:block/props` | New element in `elements-json` within 2 s, no gesture beyond blur | Dispatch a trusted no-op pointer on the canvas to trigger save; else element-id region kinds stay read-only, no automation API, no migration |
| S2 `exportToSvg` off-mount | After `app-excalidraw.js` loaded once, inspect the shadow-cljs registry (`shadow.esm`, `$APP`, `goog.global`, `shadow$provide`) for the npm namespace; call `exportToSvg({elements, appState, files})` | SVG for a fixture in < 200 ms | **Canvas snapshot**: while a drawing is mounted, `drawImage` the region of its static `<canvas>` (scene→screen from `getAppState().scrollX/Y/zoom`) into an offscreen canvas; cache PNG. Own minimal SVG painter only as last resort |
| S3 props write | Try `data.block.update({block:{uid, props}})` and variants; attach `addPullWatch("[:block/props]", …)` and time the echo | Path exists or not; echo latency known | Geometry lives in the region block **string** (section 5); props read-only |
| S4 image bytes | Add an image to the spike drawing, save, pull props; grep `elements-json` for `fileId`, other props for `files`; watch network for upload URL and `.enc` | Location found and one decrypt path proven (`file.get` → `Blob`, d.ts:497, or canvas snapshot already decrypted) | Crops containing images render only from the canvas snapshot path, never from raw `.enc` (rule 14, SKILL.md:364) |
| S5 DOM selectors | Record inline view-mode and fullscreen subtrees; test `registerComponent("plexus-region", fn)` and `{{[[plexus-region]]: x}}` rendering | Stable selectors and either owned rendering (S5b) or known fallback | Decorate the render node via added-node discovery (rule 1, SKILL.md:200), as Roam Grid claims `.rm-block-ref[data-uid]` (roam-grid extension.js:13534) |
| S6 element links | Set `link` to `[[Page]]`, `((uid))`, `https://`; click in view mode; inspect listeners | A capture-phase listener on our root pre-empts navigation for `[[`/`((` links | Links stay Excalidraw-native; hover affordance lives on the block instead |

Budget: 2 sessions. S1 and S2 decide Phase 1 shape; S3 decides only where geometry is stored.

## 5. Data model decisions

### 5.1 Region = real block

| Decision | Recommendation | Rejected alternative |
|---|---|---|
| Identity | Each region is a **Roam block with its own uid** | Region ids in props or on a metadata page: no `((uid))`, no linked refs, no embeds |
| Location | Child of the drawing block, under one collapsed container child whose string is `{{[[plexus-regions]]}}` (plain `Plexus regions` if S5b fails). Drawing block string untouched | Metadata page: linked refs land on the metadata page and the region loses page context |
| Geometry storage | **Inline component string**: `{{[[plexus-region]]: k=area ids=Ab12,Cd34 pad=16}} caption with [[links]]`. Readable, echo-checkable, survives export | `:block/props`: not writable (d.ts:71-80). Revisit only if S3 passes; even then the string stays canonical |
| Kinds | `area` (bbox of element ids + pad; Obsidian), `group` (groupId), `frame` (frameId), `cframe` (frame clipped to bounds; Obsidian clippedframe), `rect` (image element id + `rx ry rw rh` fractions; Plexus `_imgRegionFrac`), `poly` (image element id + fraction polygon; Plexus lasso, `pointInPoly`) | Absolute scene coordinates: break on move/resize. Fractions and ids follow the element |
| Plain `![](url)` images | Same `plexus-region` block as child of the image block; fractions relative to the image; crop from Roam's decrypted `<img>` (rule 14) | Uploading a cropped copy: duplicates bytes, loses the link |
| Caption | Text after the component is free Roam text; `[[links]]` there are real refs | Caption in props |

Parser and serializer are pure functions with round-trip tests; unknown keys preserved.

### 5.2 Element links to `[[page]]` / `((block))`

Roam rewrites the tail with text-element content and keeps `[[page]]` links (fact 3), so text links are real refs for free. For non-text `link` fields we write **one `((uid))`/`[[page]]` per linked element into the caption of an auto-managed `area` region block**, only on request ("Link element to block", block context menu, d.ts:376). Rejected: appending to the `{{-: }}` tail (overwritten every save).

### 5.3 Blocks embedded into drawings

| Phase | Approach | Why |
|---|---|---|
| P3 | **Read-only overlay**: `renderString` (d.ts:438) into an absolutely positioned div over the canvas, repositioned from `getAppState()` scroll/zoom on `wheel`/`pointerup` of the mounted drawing. Anchor is a native `rectangle` with `customData.plexus = {embed: uid}` | No upload, no Roam-owned data touched, encrypted-safe |
| P5 | Editable overlay via `renderBlock` (rule 13 and 19 disciplines) | Keyboard ownership explicit and reversible |
| never | Snapshot-to-image inside the drawing (Obsidian) | Depends on U2, duplicates content |

## 6. Architecture

Compass split (`~/roam-compass/src`: `host.js`, `model/*`, `view/*`, `lifecycle.js`); template lifecycle `createLifecycle()` (`~/roam-extension-template/src/lifecycle.js:10`).

| Module | Pure? | Responsibility |
|---|---|---|
| `model/region.js` | yes | parse/serialize `plexus-region`; resolve each kind to a scene bbox; `pointInPoly`; fraction normalizer (`pxcNormFrac`) |
| `model/scene.js` | yes | typed access to `elements-json`/`state-json`; content hash (FNV-1a of `elements-json`); scene→screen transforms |
| `model/mindmap.js` | yes | add child/sibling, fold, layouts (right/down/up/left/radial), pin, boundary; outline diff ↔ element diff |
| `model/edn.js` | yes | minimal EDN reader for legacy ExcalDATA |
| `host/roam.js` | no | pulls; one pull watch per mounted drawing; echo ledger (rule 2, SKILL.md:212); write queue with tree-fingerprint compare (rule 11, :327); `navigator.locks` `plexus:${graph}:${uid}` with `ifAvailable` (rule 4, :233) |
| `host/native.js` | no | S1 fiber walk, capability probe, `updateScene`/`getAppState` wrappers, save trigger |
| `host/cache.js` | no | IndexedDB `plexus-cache`: `{key: uid+hash+kind+geom+dark, blob, w, h, ts}`; disposable; LRU 200 MB |
| `view/discover.js` | no | one `MutationObserver` on `.roam-app`, added nodes only, synchronous claim of `.excalidraw` mounts and `plexus-region` nodes (rule 1) |
| `view/regionref.js` | no | paints crop from cache into a `.plexus-root` node; click → open drawing, zoom, spotlight |
| `view/overlay.js` | no | canvas overlay: spotlight, region tools, embed overlays |
| `view/present.js` | no | frames as slides |
| `api.js` | no | `window.RoamPlexus` (section 8) |

Lifecycle: `onload` registers settings, commands, context-menu entries, observer, API; `onunload` disposes in reverse, removes every pull watch, unmounts every rendered node (`unmountNode`, d.ts:449), closes dialogs (rule 14 portal sweep). CSS roots `.plexus-root`, `.plexus-portal` only (rule 5, SKILL.md:244). Metadata page `[[roam/plexus/metadata]]` holds a cache manifest and the scratch host block (rule 19) as plain marker blocks, no `Name::` syntax (rule 20).

## 7. Feature matrix

| Feature | Origin | Roam design | Phase | Acceptance |
|---|---|---|---|---|
| Region refs (area, rect) | Obsidian, Plexus | Section 5.1; draw region on mounted drawing → child block created, `((uid))` copied | P1 | `((uid))` on another page shows the crop; region appears in Linked References of pages in its caption |
| Crop render from cache | new | Key uid+hash; paint from IndexedDB; cold cache shows chip "Open drawing to render" | P1 | `app-excalidraw.js` never requested while painting 20 cached crops (CDP network log) |
| Click-to-zoom + spotlight | Plexus `_flashAnchor` | Open drawing (main or sidebar), `updateScene({appState:{scrollX,scrollY,zoom}})`, 1.2 s dim overlay with a hole | P1 | Trusted click lands zoomed within 1 s after module load |
| group / frame / cframe / poly | Obsidian, Plexus | Same block, more kinds; lasso tool | P2 | Round-trip tests per kind; crop bbox ±1 px |
| Regions on plain images | Plexus | Child of image block; crop from Roam's `<img>` | P2 | Works on a Svy `.enc` image |
| Element links + hover preview | Obsidian README.md:218-238 | S6 intercept; hover shows `renderString` preview | P2 | `[[Page]]` link navigates in-app |
| Thumbnail/SVG cache | Obsidian | Thumbnail = whole-scene crop; SVG only if S2 passes | P2 | Thumbnails for all 11 Svy drawings after one visit each |
| Compass API v1 | K-Plex | Section 8 | P2 | Compass shows crop badges on drawing and region mention nodes |
| Block embeds on canvas (read-only) | Obsidian md embeds, Plexus cards | Section 5.3 | P3 | Overlay tracks pan/zoom within one frame |
| Frames as slides | Obsidian Slideshow, Plexus Present | Frames ordered by name or `customData.order`; fullscreen; arrows step | P3 | 5-frame deck steps by keyboard, Esc exits, no leaked listeners |
| Image crop to region | Excalidraw 0.18 native `isCropping` | "Crop to region" creates a `rect` region; native crop untouched | P3 | Region survives a native crop change |
| Mind-map builder | Plexus MINDMAP-WORKLIST.md:19-27 | Tab child, Enter sibling, Alt+arrows nav, fold, layout cycle, pin, Alt+B boundary; **two-way**: nodes are real child blocks of a root block, `customData.plexus.uid` on each node | P4 | Edit block in outline → node updates on echo; add node → block created; no duplicates on echo |
| Legacy ExcalDATA migration | zsviczian | Dry run lists the 9 drawings and element counts; apply = create native block, mount, `updateScene`, save (S1) | P5 | Dry run writes nothing; legacy block kept as collapsed sibling until user deletes |
| Automation API | Obsidian Automate | `RoamPlexus.scene(uid)` → `{elements, appState, add(elements), zoomTo(ids), exportSvg()}`; needs mounted drawing | P5 | Script builds a 3-box diagram on the spike page |

## 8. Compass integration contract

`window.RoamPlexus` (frozen, `apiVersion: 3`; v2 callers are unaffected, since every change is additive):

| Member | Returns | Notes |
|---|---|---|
| `isAvailable()` | boolean | K-Plex probe idea |
| `create({pageUid?, parentUid?, title?})` | `Promise<{uid, pageUid}>` | creates `{{[[excalidraw]]}}` block; with `title` creates page `Drawings/<title>` first |
| `open(uid, {region?, sidebar?})` | Promise | sidebar via `rightSidebar.addWindow` (d.ts:343; Compass host.js:483) |
| `thumbnail(uid, {maxWidth, render=false})` | `Promise<Blob|null>` | cache only unless `render`; never loads the module when `render=false` |
| `regionsOf(uid)` | `[{uid, kind, caption, label}]` | one pull, no watch. `label` (v3, additive) is a plain one-line name of at most 80 characters: the caption with markup stripped, else the image alt text (image kinds), else `<drawing title> · <kind word>`. `"Region"` if it cannot be computed. Callers should use it only when it is a non-empty string, so v2 entries still work |
| `drawingsOn(pageUid)` | `[uid]` | `data.q` over blocks with `:block/props`, capped 50 |
| `addEventListener('change', cb)` / `removeEventListener` | | `{uid, kind: 'drawing' | 'region'}` after own writes and absorbed echoes |

Compass changes (`~/roam-compass`), all graph-read-only:

| File | Change |
|---|---|
| `src/settings.js:1-60` | add `drawings` switch (default on) to `SETTING_IDS`, `ROWS`, `readCompassSettings` |
| `src/model/neighborhood.js` | no new edge kind. Drawings and regions already reach Compass as `mention` nodes through `:block/_refs` (host.js:23-25) because the text tail and captions are real refs. Add pure `isDrawingLike(node)` keyed on `:block/string` prefix `{{[[excalidraw]]}}` / `{{[[plexus-region]]}}` |
| `src/view/overlay.js:459-470` | node builder: if `window.RoamPlexus?.thumbnail(uid)` resolves a Blob, render an `<img>` from an object URL inside `.compass-node`, revoked on repaint. This narrows the "no thumbnails" cut (spec-compass.md:47) to "no `.enc` `<img>`" |
| `src/view/overlay.js:151-160` | search results footer gains "New drawing: <query>" when `RoamPlexus.isAvailable()`; calls `create({title})`, then the existing page-link write path exactly as for a new page |
| `src/host.js:469-487` | `syncSidecar` unchanged; `open(uid, {sidebar: true})` reuses it by centering the drawing's page |
| `src/extension.js` | subscribe to `RoamPlexus` `change` and call the existing repull |

Compass learns nothing about props or geometry. Edges stay harcs and refs.

## 9. Performance budgets and bench

| Path | Budget | Measure |
|---|---|---|
| Typing, no drawing on page | +0 ms median; zero listeners on `input`/`keydown`/`selectionchange` | `~/svy-theme/tools/typing-bench.mjs --arm off --arm live` on the Svy daily page, `--blocks 6`, bootstrap CI must overlap (typing-bench.mjs:35-70, 531-583) |
| Typing, page with 3 cached crops | ≤ +1 ms median | same bench on the spike page |
| Discovery | added nodes only; ≤ 0.2 ms p95 per mutation record | `performance.measure` around the observer callback |
| Region-ref paint from cache | ≤ 1 frame after node added; IndexedDB read off the paint path behind an aspect-correct placeholder | frame sampling as in rule 1 (zero native flashes) |
| Module | `app-excalidraw.js` loaded only when a drawing mounts or user clicks render | CDP `Network.requestWillBeSent` log per test |
| Pull watches | exactly one per mounted drawing, zero when none | lifecycle registry count asserted in the `onunload` test |
| Popup path | zero new global selectors | `roam-theme` `bucket_check.mjs --strict` on `extension.css` |
| Cache | ≤ 200 MB, LRU, disposable | eviction unit test |

## 10. Phases and gates

| Phase | Slice | Gate |
|---|---|---|
| P0 | Spikes S1-S6; `session-learnings` file (rule 12) | U1-U7 answered or marked blocked |
| P1 | Repo, lifecycle, discovery, `plexus-region` (area, rect), crop cache from canvas snapshot, click-to-zoom + spotlight, settings | P1 matrix rows; typing budget; `npm run check`; installed by Pages URL in Readwisenotes; zero writes on Svy |
| P2 | Remaining kinds, plain images, element links, thumbnails, `RoamPlexus` v1, Compass changes | Compass shows drawing badges; `/local-ultrareview` on both repos |
| P3 | Read-only embeds, presentation, crop-to-region | Overlay budget; Esc cleanup |
| P4 | Mind map with two-way outline | Echo tests; 200-node map re-layout under 16 ms |
| P5 | Legacy migration (dry run first), automation API, editable embeds | Dry run on Svy reviewed by the user before apply |

## 11. Risks

| Risk | Mitigation |
|---|---|
| Roam upgrades Excalidraw (0.14 and 0.18 already mixed) or changes fiber shape | Capability probe at mount; every S1 feature degrades to read-only when the probe fails; version banner logs probe results |
| Fiber walk breaks in minified builds | Duck-type method names, not fiber depth; tests on recorded fiber fixtures per version |
| Encrypted images (U2) | Crops only from the decrypted canvas or Roam's renderer; never raw `.enc` |
| Roam rewrites the drawing block string on save | We never write that string; regions are child blocks |
| Cache staleness after external edits | Key includes content hash; pull watch invalidates |
| Two tabs both create the container block | Web Lock per uid, `ifAvailable` (rule 4) |
| Compass coupling | Optional `window` API feature-detected at call time; Compass builds and runs without Plexus |

## 12. Open questions (recommended defaults)

1. Repo and Depot name `roam-plexus` / "Plexus"? Default: yes.
2. Region blocks as children of the drawing block (visible when expanded) vs a metadata page? Default: children under one collapsed container.
3. Should text-element links also get their own region blocks automatically? Default: no, only on request; Roam's tail already gives backlinks.
4. Cold-cache crop: chip and wait, or auto-mount the drawing hidden (loads 7.7 MB)? Default: chip; mount only on click.
5. New related drawing from Compass: new page `Drawings/<title>` with the drawing as first block, or a child block on the center page? Default: new page (K-Plex behavior; Compass edges stay page edges).

## 13. Phase 0 results (live, 2026-09-28, Readwisenotes page `Plexus Spike 2026-09-28`, uid `8eai6ikkw`)

Spike drawing `ITvT3bqaL`; region block `eyjMKi1DA`; ref block `N4AykqSVu`. Trusted CDP input only (a local CDP input helper).

| Spike | Result | Consequence for the design |
|---|---|---|
| S1 imperative API | **Pass.** `.excalidraw[__reactFiber$*].return.stateNode` is the Excalidraw `App`: `updateScene`, `getSceneElements(IncludingDeleted)`, `scrollToContent`, `setActiveTool`, `addFiles`, `files`, `state`, `actionManager`, `getElementLinkAtPosition`. An `updateScene` of 3 elements reached `:block/props` via Roam's own save in **754 ms** with no gesture. The `{{-: }}` text tail is written on editor close, and `[[links]]` in text became `:block/refs` | Automation, mind map, migration, zoom-to-region are all feasible while the editor is mounted. Probe by duck-typing method names, not fiber depth |
| S2 `exportToSvg` off-mount | **Fail.** Module-private (`un(type, elements, appState, files, opts)`); `$APP` has 3,721 keys and none of them is Excalidraw; `shadow$provide` holds only leftovers | Two-tier crops. **Hot (editor mounted):** select the region's elements, run `actionManager.actions.copyAsSvg` with `navigator.clipboard.writeText` captured for that one call and restored in `finally` → a vector SVG of exactly the selection (240×160 for a 220×140 rect + 10 pad), fonts embedded. **Cold:** hidden `renderBlock` of the drawing uid into an offscreen host yields Roam's view PNG in **57 ms** (module warm); same-origin `blob:`, so canvas crop is untainted |
| S2b view-mode image | Roam renders view mode as `img.rm-inline-img.rm-inline-img--excalidraw[src=blob:]`, a **PNG at scale 1**: bounds of non-deleted elements + 10 px padding (500×160 for 480×140). `exportScale` set through `updateScene` does **not** persist (stays 1) | Cold crops are 1× (soft on retina). Validate the mapping per drawing: `naturalWidth/Height` must equal computed bounds + 20, else show the chip instead of a wrong crop |
| S3 props write | `data.block.update({block:{uid, props}})` **works** (undocumented; typings stale). It **replaces the whole props map**, keywordizes nested keys, and a string-only update keeps props. Pull-watch echo **106 ms** | **Never write props on a drawing block** (it would wipe `:excalidraw/*`). Region geometry stays in the block string. Region-block props may hold derived hints only, always written as a full map |
| S4 image bytes | Roam auto-uploads every file (even `addFiles`) and stores the URL in **`element.customData.firebaseUrl`**. Svy URLs end `.png.enc` | Any `customData.plexus` must merge into Roam's `customData`. Cold crops come from Roam's own PNG, so `.enc` is already decrypted there |
| S5 DOM | Empty: `.excalidraw-container > div` "Click to start editing". View: `.excalidraw-outer-container > .excalidraw-container > .rm-inline-img__resize > .react-resizable > img.rm-inline-img--excalidraw`. The editor opens **only** from `.bp3-icon-fullscreen` (clicking the image does nothing) into `.excalidraw-outer-container.full-screen` with `canvas.excalidraw__canvas.static` / `.interactive`; close is `.bp3-icon-minimize` | Discovery claims `img.rm-inline-img--excalidraw` (view) and `.excalidraw-outer-container.full-screen .excalidraw` (editor mount) |
| S5b `registerComponent` | **Does not exist at runtime.** `ui.components` = `renderBlock, renderPage, renderString, renderSearch, unmountNode` (plus undocumented `ui.react`) | Region rendering is decoration. Roam renders `{{[[plexus-region]]: …}}` as **`button.rm-xparser-default-plexus-region`**, the same inside `.rm-block-ref[data-uid]`. One added-node selector covers inline, refs, embeds, sidebar. The region block refs page `plexus-region` (free index of all regions) and its caption links |
| S6 element links | Stored as-is (`link: "[[Page]]"`). Roam passes no `onLinkOpen`. In view mode the whole element body is a link hotspot. Wrapping `app.redirectToLink` did not fire for CDP clicks (`hitLinkElement` null at pointer-up). A **capture-phase `pointerdown`/`pointerup` listener on the container** + `app.getElementLinkAtPosition(sceneXY)` caught `[[Plexus Spike Target]]` from a trusted click | Intercept only `[[…]]` / `((…))` links (shift → sidebar), let every other link fall through to Excalidraw. Native 0.18 also ships `linkToElement` / `copyElementLink` (element-to-element) and `cropEditor` (image crop): reuse them, do not rebuild |

Decisions changed by Phase 0: section 5.1 geometry stays in the string (confirmed, and now required by the S3 replace semantics). The section 7 "Crop render from cache" cold path becomes "hidden `renderBlock` → Roam PNG → canvas crop", not a chip. The chip remains only when the bounds check fails. Section 6 `view/discover.js` claims the S5 selectors above. The `registerComponent` path is dropped.

### Phase 7 results: DATA-5 (live, 2026-09-29, Readwisenotes, trusted CDP)

Roam's `app-excalidraw.js` (7.7 MB) embeds `PKG_VERSION:"0.18.0"`. With the drawing open, each row below was watched for 3 s against `:edit/time`, `:excalidraw/state-json` and `:excalidraw/elements-json` of the drawing block.

| Probe | Result | Consequence |
|---|---|---|
| Pan (`scrollX` +200) | No change | View operations are write-free |
| Zoom (x0.8) | No change | Same |
| Selection | No change | Same |
| Theme dark/light | No change | Same |
| `frameRendering.name` toggle | No change to `:edit/time` or the state | Same. Persistence of `frameRendering` through Roam's save: not re-measured in P7 (earlier source: `phase2-contract.md:8`) |
| `exportScale` 3 | No change | Same |
| Close the full-screen editor with no edits | `:edit/time` unchanged | An unchanged mount hash means no work after close (REF-6) |
| Roam's action table | 93 actions in 0.18.0 | See the next row |
| Native actions present | `searchMenu`, `stats`, `wrapSelectionInFrame`, `copyAsPng`, `copyAsSvg`, `copyElementLink`, `linkToElement`, `cropEditor`, `changeExportScale`, `exportWithDarkMode`, `toggleElementLock`, `unlockAllElements`, `gridMode`, `objectsSnapMode`, `zenMode`, `viewMode`, `changeArrowType` (elbow arrows), `setEmbeddableAsActiveTool`, `setFrameAsActiveTool`, `selectAllElementsInFrame`, `removeAllElementsFromFrame`, `updateFrameRendering`, `zoomToFit`, `zoomToFitSelection`, `zoomToFitSelectionInViewport`, `toggleTheme`, `toggleShortcuts`, `hyperlink` | Reuse these before building anything. There is no shape-switch action |
| Laser tool | `app.setActiveTool({type: "laser"})` reads back `"laser"` | Works |
| `scrollToContent(target, {fitToContent, animate})` | Present. `animate` defaults to true for element-link targets | Animated zoom needs no tween of our own |
| `searchMatches` in appState | Not re-measured in P7 (earlier source: `roadmap-next.md`, search item) | Runtime feature check stays |
| Flowchart keys | Not re-measured in P7 (earlier source: `phase4-contract.md:230-232`, live in Roam's build) | Same |

## Verification (when implementation starts)

- P0: spike results recorded per row of section 4 with CDP evidence on the Readwisenotes spike page; a `session-learnings` file in `~/openkb-roam-plugin/raw/session-learnings/`.
- P1: `npm run check` green; `typing-bench.mjs` off vs live CI overlap; network log shows no `app-excalidraw.js` request while painting cached crops; `((uid))` of a region renders the crop on a second page.
