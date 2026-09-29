# Plexus Phase 3 — implementation contract (binding)

Repo `~/roam-plexus`, HEAD `7da382c` (0.2.1). The Phase 1 and Phase 2 contracts still bind everything not changed here. Spec: `docs/spec-plexus.md` §7 rows "Block embeds on canvas (read-only)", "Frames as slides", "Image crop to region"; §13 lists the measured facts. Roam rules: `~/.claude/skills/roam-plugin-dev/SKILL.md` §(d), rules 1, 2, 5, 10, 11, 13, 14, 20. Zero runtime deps, plain JS, `node --test`, no jsdom (inject `doc`/`api`/`app`), log prefix `[plexus]`, never throw into Roam. Version 0.3.0.

## Measured facts added for Phase 3 (2026-09-28, Readwisenotes, Excalidraw 0.18 in Roam)

- The `App` instance exposes emitters `onChangeEmitter`, `onScrollChangeEmitter`, `onPointerDownEmitter` and `onPointerUpEmitter`. Each has `.on(cb)`, and `.on()` returns an unsubscribe function. `onScrollChangeEmitter` calls `cb(scrollX, scrollY, {value: zoom})`. `onChangeEmitter` fires on scene and appState changes, including element moves.
- A native image crop is `element.crop = {x, y, width, height, naturalWidth, naturalHeight}`, in natural-image pixels, or `null`. Roam persists it in `elements-json`. The element box (`x, y, width, height`) shows only the cropped part, scaled to the box.
- `renderString({string, el})` renders Roam markdown and refs read-only. `unmountNode({el})` must run before an `el` is removed.
- A `<dialog>.showModal()` provides a focus trap, native Esc handling and an inert backdrop (rule 14). If a modal dialog is left open on unload, it blocks the page, so the unload sweep must close it.

## A. Native-crop-aware image regions (fixes the "region survives a native crop change" row)

Definition change, which is backward compatible: `rect` and `poly` fractions (`f`, `p`) on a drawing image element are relative to the **natural (uncropped) image**. With `crop == null` the displayed box equals the natural image, so every existing region keeps its meaning.
- `src/model/scene.js`:
  - `naturalToScene(el, [nx, ny])` maps a natural fraction to scene coordinates through `el.crop`: `sx = el.x + (nx*natW - crop.x) * el.width / crop.width`, same for y. With no crop it is the identity on the box.
  - `sceneToNatural(el, [sx, sy])` is its inverse.
  - `regionSceneBBox` for `rect`/`poly` returns the intersection of the mapped region with the element box. It returns `{error: "outside-crop"}` when the intersection is empty.
- The hot path converts the natural `f` (or the polygon) to displayed-box fractions of the visible intersection before `cropSvgToFraction` / `clipSvgToPolygon`. The cold path already works in scene coordinates.
- The image-region tool still yields displayed-box fractions; actions convert them to natural fractions with `sceneToNatural` before serializing.
- **Region from crop**: when exactly one image with a non-null `crop` is selected, a toolbar button "Region from crop" creates `k=rect … f=<crop.x/natW, crop.y/natH, crop.width/natW, crop.height/natH>` with caption "Image crop".
- Chip text for `outside-crop`: "Region is outside the image's crop".
- Test fixture (measured): element box `(120,300,240,160)`, crop `{x:30,y:20,width:60,height:40,naturalWidth:120,naturalHeight:80}`.
  - Region `f=0.25,0.25,0.5,0.5` → whole box `[120,300,360,460]`.
  - Region `f=0.125,0.1875,0.4167,0.625` (natural 15..65 × 15..65) → visible part `[120,300,260,460]`.
  - A region fully left of `x=30` → `outside-crop`.

## B. Read-only block embeds on the canvas

- Anchor format (`src/model/embeds.js`, pure): a `rectangle` with `customData.plexus = {embed: "((uid))" | "[[Title]]"}`. It MERGES with Roam's existing `customData` (Roam stores `firebaseUrl` there on images; never replace customData). It has `link` set to the same ref, so the P2 link interception opens it, `strokeStyle: "dashed"`, `backgroundColor: "transparent"`, and a bound text element (`containerId` = the rectangle id; `boundElements` on the rectangle lists it). The text is the first 80 chars of the target's plain text (strip `{}`, backticks, and `[[ ]]` brackets). Static exports and the view PNG then still show a meaningful label.
  - Exports: `parseEmbedRef(text)` accepts `((uid))`, `[[Title]]`, or a bare 9-char uid.
  - `makeEmbedAnchor({ref, label, x, y, width = 360, height = 200, idPrefix})` returns `[rect, text]`, full element objects with all required Excalidraw fields and `index: null`.
  - `embedAnchors(elements)` returns the live anchors.
- Insert (actions, toolbar button **Embed block**): read `navigator.clipboard.readText()` (injected). If it parses, resolve it with a pull: a block via uid, a page via title. Insert the anchor centered in the current viewport (scene center from `app.state`), select it, and toast "Embedded <label>". Otherwise toast "Copy a block ref first (right-click a bullet → Copy block ref)". This writes through `app.updateScene` only, and Roam's own save persists it.
- Overlay (`src/view/embeds.js`): exists only while an editor is mounted.
  - For each anchor, one portal `div.plexus-portal.plexus-embed` on `doc.body`, `pointer-events: none` (read-only; Excalidraw keeps full editing).
  - Its box is the anchor's scene size, placed with `transform: translate(vx, vy) scale(zoom) rotate(angle)` from `sceneToViewport`, with `transform-origin` top-left. It is clipped to the editor container rect (`clip-path` inset computed from the container rect).
  - Content: a header with the target title, then `renderString` of the block string, then children to depth 2, capped at 30 blocks total, each child via `renderString`. Page refs: the title plus the first-level children. The background is opaque (theme-aware), so the dashed label underneath is covered in the editor.
  - Subscribe to `app.onScrollChangeEmitter` and `app.onChangeEmitter`. Any event schedules ONE `requestAnimationFrame` reposition; anchors that were added, deleted or moved are diffed by id.
  - One pull watch per embedded uid (`[:block/string {:block/children ...}]`) re-renders that portal's content. On unmount or unload: unsubscribe the emitters, `removePullWatch` for every watch, `unmountNode` every `renderString` host, and remove the portals.
  - Budget: a reposition costs at most one frame; there are no reads besides one container `getBoundingClientRect` per frame; nothing is done when there are no anchors.

## C. Frames as slides (presentation)

- `src/model/slides.js` (pure): `orderFrames(elements)` returns live `frame`/`magicframe` elements. Order: a numeric `customData.plexus.order` ascending first, then natural name compare (`"2 Intro" < "10 End"`, case-insensitive), then `y`, then `x`.
- Entry points:
  - toolbar button **Present**, while the editor is mounted;
  - command palette "Plexus: Present open drawing";
  - block context menu "Plexus: Present frames", when the clicked block is a drawing.
- Slide images:
  - If the drawing's editor is mounted, capture each frame's clipped SVG (`captureSelectionSvg(app, [frameId])`) sequentially, `normalizeSvgSize` each, and cache it under `cropKey({regionUid: "slide:<drawingUid>:<frameId>", geometryKey: "cframe|…", drawingHash, tier: "svg"})`.
  - Otherwise use the cold path: one `renderDrawing(uid)`, then crop each frame's exact bbox (exportBounds mapping, P2) to PNG, tier "png".
  - Present whatever is cached first, then fill the rest.
- UI (`src/view/present.js`): one `dialog.plexus-portal.plexus-present`, opened with `showModal()`, near-black background, the current slide `img` with `object-fit: contain` filling the viewport, and a HUD `n / N · <frame name>`.
  - Next: Right, Space, PageDown, Enter, or a click on the right half.
  - Prev: Left, PageUp, Backspace, or a click on the left half.
  - Home and End jump to the ends. Esc closes (native `cancel`).
  - The keydown listener is on the dialog only.
  - Preload the next slide.
  - Zero frames: toast "No frames in this drawing".
  - Presenting never changes the drawing's appState or elements.
  - Unload closes and removes the dialog.

## D. Toolbar

Bottom-center bar buttons, in order:
- Region
- Image region
- Frame (with margin)
- Region from crop: enabled for exactly one image with `crop`
- Embed block
- Present: enabled when the scene has ≥1 frame

Keep the bottom placement and z-index logic.

## File ownership (parallel)

| Unit | Files |
|---|---|
| A (model) | `src/model/scene.js`, `src/model/embeds.js` (new), `src/model/slides.js` (new), `test/scene.test.js`, `test/embeds.test.js` (new), `test/slides.test.js` (new) |
| B (host) | `src/host/native.js` (`subscribeViewport(app, cb)` → unsubscribe, using the emitters with a guarded fallback; `insertElements(app, elements, {select})`; `readClipboardText({clipboard})`), `src/host/roam.js` (`pullEmbedContent(ref)` → `{kind, uid, title, string, children:[{string, children}]}` depth 2 cap 30; `watchEmbed(uid, cb)` → disposer), `test/host-*.test.js` |
| C (view + actions + wiring) | `src/view/embeds.js` (new), `src/view/present.js` (new), `src/view/toolbar.js`, `src/view/regionref.js` (outside-crop chip; hot crop mapping), `src/actions.js` (natural-fraction conversion in the image tool path, `regionFromCrop`, `insertEmbedFromClipboard`, `presentDrawing({drawingUid})`), `src/extension.js`, `src/extension.css`, `test/actions.test.js`, `test/view-*.test.js`, `test/extension.test.js`, `test/toolbar.test.js` |

Parallel units: edit only your own row. Do not run git checkout, reset, stash, add, or commit. Code against these signatures. Report failures in your own files only.

## Gates

- Crop-mapping fixtures pass exactly (±0.5 px).
- Every existing P1/P2 region renders unchanged when `crop == null`.
- The embed overlay tracks pan and zoom within one frame and leaves no portal, watch or subscription behind after unmount or unload.
- A 5-frame deck: order, keys, Esc; the drawing props are unchanged after presenting (compare `:edit/time`).
- Typing path +0. `npm run check` is green. Version 0.3.0 with a CHANGELOG entry.
