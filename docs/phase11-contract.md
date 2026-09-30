

## Amendments (critic, binding)

These amendments override the body wherever the two conflict. Code references point to `b355c81`. "Source" marks Excalidraw behaviour read from the 0.18 research fork at `~/excalidraw-port-research/excalidraw/packages`; those items have not been measured on Roam's build unless the amendment says so.

### A

**A1. The EMB-6 label is the creation label, compared on `originalText` only.**
- Every creation path labels the anchor with the whole block string, whitespace collapsed and cut to 80: `embedLabel(content.string || content.title || ref)` (`actions.js:640`, `:1224`). `placeBlocks` passes `labelSource(uid).string` (`:755`). `embedLabel` collapses `\s+`, newlines included (`model/embeds.js:24-27`).
- So spec §13's "first line" does not describe the code. With `embedLabel(firstLine)`, every existing multi-line anchor would be rewritten on its first open, and gate 1 would fail.
- The target label is `embedLabel(content.string || content.title)`, taken from `host.pullEmbedContent(ref)` (synchronous, `roam.js:439-469`).
- Compare it with the bound text's `originalText ?? text`. Never compare `text` (the wrapped copy), `width`, `height`, `x` or `y`: Excalidraw may re-derive them, and comparing them would rewrite the label on every open.
- Skip the anchor, with no write, when:
  - `parseEmbedRef` gives kind `today`. The label is the constant "Today" (`actions.js:612`).
  - The pull returns null. This covers deleted blocks, and renamed pages whose `[[Old]]` ref in `customData` no longer resolves.
  - The target label is empty. A new note card is labelled "Note" while its block is empty (`:829`). The `makeEmbedAnchor` fallback would churn that label to "((uid))".
  - The anchor has no live bound text whose `containerId` is the anchor and whose id is in the anchor's `boundElements`. Never create one.

**A2. Creation and refresh share one layout function.**
- A owns `src/model/embeds.js` and `test/embeds.test.js`.
- Export `layoutAnchorLabel({label, x, y, width, height, fontSize, lineHeight})`, returning `{text, originalText, x, y, width, height}`. `makeEmbedAnchor` (`:68-94`) calls it, so the two cannot drift.
- Export the private `base()` (`:39-48`) as `baseElement` for `frames.js`.
- Refresh inputs:
  - the anchor's current `x`, `y`, `width` and `height` (users resize anchors);
  - the text element's own `fontSize` and `lineHeight`.
- Keep the text element's `fontFamily`, `angle`, `frameId`, `groupIds` and `customData`. Centre the text exactly as `makeEmbedAnchor` does; this stays correct under rotation because both centres coincide.
- Clamp to the lines that fit: `maxLines = max(1, floor((height − 8) / (fontSize × lineHeight)))`, and end the last line with "…". Without this, a 100-wide anchor gets about 10 lines and overflows its box.
- The patch is those six fields plus `version + 1`, a new `versionNonce` and `updated: Date.now()`. The container element is never touched.

**A3. EMB-6 writes once, coalesced, with `NEVER`, and only when the user is idle.**
- `captureUpdate` accepts `"IMMEDIATELY"`, `"EVENTUALLY"` and `"NEVER"` (Source `element/src/store.ts:38-68`). Use `"NEVER"` only.
  - `"EVENTUALLY"` would fold the label into the user's next undoable step, so their next Cmd+Z would also revert the label.
  - `NEVER` also skips the guard ring (`guard.js:78`), which is correct here.
  - Consequence to document: an undo or redo of an older step can bring back an old label. The next refresh corrects it.
- Two functions:
  - `refreshEmbedLabels(app)`: one synchronous scan that writes every changed anchor in a single `guardedWrite` and returns the count.
  - `scheduleEmbedLabels(app)`: owned by A, a 1500 ms trailing debounce.
  - Writing per anchor would mean N Roam saves. Without the debounce, a dock edit of an embedded block would rewrite the drawing on every Roam save of that block.
- At flush time, all of these must hold:
  - `native.activeEditor(doc)?.app === app` and `isId(drawingUid)`.
  - The first flush after mount waits for `native.waitNotLoading(app, 5000)` plus two frames.
- Otherwise skip and re-arm after 1 s. This applies while any of these is true:
  - `app.state` has `editingTextElement`, `newElement`, `resizingElement` or `multiElement` set;
  - `app.state` has `selectedElementsAreBeingDragged`, `isResizing` or `isRotating` true;
  - `app.state.cursorButton === "down"`;
  - `overlay.editState() !== "idle"`.
- `cancelDrawingTool()` and `dispose()` clear the timer.

**A4. EMB-6 reuses the overlay's watch through a hook, and A owns that file.**
- `src/view/embeds.js` has to change but has no owner. Assign it and `test/view-embeds.test.js` to A, for the hook only.
- Add `createEmbedOverlay({…, onLoaded})`. Call it at the end of `load()` (`:227-258`), after `paint`, with `{anchorId, ref, content}`.
  - It never fires while editing: the early return at `:228` covers that.
  - `runLeave` reloads the portal (`:733`), so leaving edit mode also triggers a refresh.
- This covers the first load at mount, every watched change (`:188-191`) and leaving edit mode, with no second pull watch.
- Anchors beyond `WATCH_CAP` (150, `:6`) refresh on mount only. Say so in the CHANGELOG.

**A5. Frame elements have complete fields and go in with one guarded write.**
- `presetFrame` returns `{...baseElement(id, "frame", x, y, w, h), name, customData: {plexus: {order}}}` with:
  - `frameId: null`;
  - `index: null` (Excalidraw assigns fractional indices on `updateScene`; the P9 embed inserts rely on this);
  - `boundElements: null`, `link: null`, `locked: false`, `roundness: null`;
  - `version: 1`, a fresh `seed` and `versionNonce`, and `updated`.
- Ids are `plexus-frame-<base36>` so that `isId` (`region.js:8-9`) accepts them. Otherwise "Regions for all frames" silently skips them (`actions.js:1778`).
- New frames are appended at the end of the array and adopt nothing. Elements they overlap keep their `frameId`. Slides export everything that overlaps the frame anyway (Source `data/index.ts:71-80`), and the cold crop uses the frame's bounding box.
- Each frame operation is one `guardedWrite` with `"IMMEDIATELY"`, which is one undo step (history recording measured in P8, spec §13 l.258). The same write selects the new frames.
- Placement:
  - Centre uses `viewCentre(app)` (`:456-459`), which stays correct when the dock narrows the canvas.
  - Layouts: centred on that point, frames in row-major order.
  - `nextSlideSlot`: x = the right edge of the rightmost live frame + 40; y = that frame's y. With no frames, centre on the viewport.
- If the result is not fully in view, call `app.scrollToContent(frame, {fitToContent: false, animate})`, which scrolls without changing zoom.

**A6. `orderFrames` does not change; frame orders are written out instead.**
- `orderFrames` already sorts `customData.plexus.order` first (`slides.js:13-17`), and frames that have an order sort before frames that do not. So a lone "Slide 4" with order 1 would become the first slide.
- Changing the tie-break to "array order" would reorder every existing deck, `regionsForAllFrames` (`actions.js:1778`) and `test/slides.test.js`.
- Rule: any operation that adds frames (preset, Slide, layout), when some live frame has no order:
  - in the same write, gives all live frames orders 1..n in their current `orderFrames` order (merged with `mergePlexusData`, `model/embeds.js:30-34`, versions bumped);
  - gives the new frames n+1 onwards.
- "Slide N" uses N = the new frame's order. Preset frames also get an order and keep `name: null`.

**A7. "Make slide" runs `wrapSelectionInFrame`, checks its predicate first, and finds the new frame by id.**
- `executeAction` does not run the predicate (Source `actions/manager.tsx:132-143`). Check it first: at least one element selected and no frame-like element in the selection (Source `actionFrame.ts:167-173`). Otherwise toast "Select elements that are not frames".
- Call `app.actionManager.executeAction(app.actionManager.actions.wrapSelectionInFrame, "api")`. In Roam's build it returns nothing (`native.js:121`).
- The new frame is the frame id present after the call and absent before it. Do not use "the selected element".
- The frame is the selection's bounding box plus 16 of padding (Source `actionFrame.ts:180-186`), not 16:9.
- In the same synchronous task, an `"IMMEDIATELY"` `guardedWrite` sets `name: "Slide N"` and the order. If both writes land in one store commit, Excalidraw records a single undo entry (Source `store.ts:391-396`).
- Measure live that one Cmd+Z removes the named frame and restores the children's `frameId`. If it takes two undos, accept it and document it.
- If the action is missing, build the frame around the selection box plus 16 and set `frameId` on the selected non-frame elements and their bound text, all in one write.

**A8. "Reformat frame" releases children it leaves fully outside.**
- Add `selectedFrameId()` (new, in A). It returns the single selected frame, or the one frame that all selected elements belong to, else `null`.
- Resize about the centre. Keep the id, name, `customData` and order.
- In the same write, set `frameId: null` (with a version bump) on children that no longer intersect the new frame. Frame clipping would otherwise hide them for good.
- Adopt nothing, move nothing. Toast "N elements left the frame" when N > 0.

**A9. PRES-2: how the start index is chosen, fill order, and compatibility.**
- The call is `presentDrawing({drawingUid, from = "start", at})`. Every existing caller keeps "start": the toolbar (`extension.js:135`), Alt+Shift+P (`:309`), canvas "Present" (`context-menus.js:442`) and "Present frames" (`:207`).
- `"here"` applies only when the drawing is mounted; unmounted, it starts at 0. It picks, in order:
  - the frame containing `at` (the right-click point in scene coordinates), smallest area first;
  - else `selectedFrameId()`;
  - else the frame nearest `viewCentre(app)`: distance to its box, 0 when inside, ties go to the smaller area.
- An unknown frameId starts at 0 and shows a notice in the dialog (A11).
- Fill order: from the start index forward, then the earlier slides. Today the fill runs from index 0 (`actions.js:2593-2606`).
- A hot capture that returns null sets `{error: true}` on the slide. Today it `continue`s and the slide shows "Rendering..." forever (`:2601-2602`).
- Keep `onClose`, which releases `presentOwner` (`:1238-1247`, `:2592`), and keep `setSlide`. `presentOutline` uses the same owner token.
- Add `presentFromRegion(regionUid)`:
  - a `frame` or `cframe` region → `presentDrawing({drawingUid: region.drawingUid, from: region.frameId})`;
  - anything else → a toast.

**A10. Notes data is loaded lazily, never throws, and "Add notes" is idempotent.**
- Each slide gets `notes: {rootUid, onAdd?}`.
- Read regions once per presentation with `safe(() => host.regionsOf?.(uid)) ?? []`. The fake host in `test/actions-p3.test.js:33-37` has no `regionsOf`. That file is now A's and must pass unchanged.
- `notesForFrame`: `cframe` before `frame`, then the first region that has children, else the first region.
- `addNotesForFrame`:
  - runs inside `once("notes:<drawing>:<frame>")`;
  - re-reads the notes first;
  - creates the region with `host.createRegion`, using the same string `regionsForAllFrames` builds (`:1784`), plus one empty child via `host.createBlock`;
  - calls `emitChange`;
  - returns `{regionUid, childUid}`.
- The pane is read-only, so the user cannot type notes during the presentation. On presenter close, if notes were added:
  - with no editor mounted, open the region in the right sidebar;
  - otherwise toast "Notes added: Outline › regions". The full-screen editor covers the sidebar (spec §13 l.290).

**A11. Nothing that happens while the presenter is open may rely on a toast.**
- Toasts are appended to `body` (`toast.js:38`). The modal `<dialog>` sits in the top layer, above them.
- Errors known before opening (no frames, no refs) toast and do not open the presenter.
- Anything later goes through `handle.notice(text)` (P1): skipped outline children, a missing start frame, render failures.

**A12. PRES-4 accepts alias refs, owns its URLs, and toasts nothing from the source chain.**
- A child counts when its trimmed string is exactly `((uid))` or `[label](((uid)))` and the ref is a supported region. The second form is what `copyAlias` writes (`actions.js:2484`).
- Cap at 100 children. With none, toast "No region refs under this block" and do not open.
- Sources:
  - Split `startPng` (`:2263-2300`) into a toast-free `cropSource(regionUid)`. `cropPrep` toasts "Region cannot be copied" (`:2197-2208`), which is wrong here.
  - The chain is png2x → svg → png → cold.
  - Image kinds have no hot tier (`:2216-2217`); they render at the source image's full resolution through `renderRegionCrop`.
- Cached slides open first; the rest fill in bullet order from the start index.
- Each blob gets an object URL owned by the deck, revoked on `onClose` and in `dispose()`. Never pass cache URLs: the LRU revokes them on eviction (`cache.js:43-56`).

**A13. Print and PNG sources: one pipeline, light only, 2x checked, own URLs, capped.**
- Factor the frame-image loop out of `presentOnce` (`:2597-2633`) and use it for presenting, printing and PNG export.
- Mounted drawing: `native.captureSelectionPng(app, [frame.id], {scale: 2, dark: false})`, one frame at a time. A single selected frame exports exactly the frame box (Source `data/index.ts:71-80`).
  - Accept the PNG only if it is 2× the frame size ±4 px, as `warmPng2x` checks (`:1505-1512`). The cframe 2x path was never measured (spec §13 l.254).
  - Otherwise fall back to the cold 1x crop.
- Not mounted: one `cold.renderDrawing`, then crop each frame.
- Never dark: ignore `darkCrops`.
- `printFrames({drawingUid, size, margin, mode})`:
  - `drawingUid` comes from the caller, else the mounted editor, else toast "Open a drawing or pick a drawing block". Without this parameter the contract's 1x cold path is unreachable.
  - `once("print")`, shared by both modes.
  - Toast "Preparing N pages…" before starting.
  - Cap at 50 frames (`:1783`), with a toast when capped.
- Every blob gets a job-owned object URL, revoked after the job. `dispose()` also disposes the active print job.
- Read settings through `settingsNow()` with A's own defaults and clamps. Tests pass `getSettings: () => ({})`.

### P

**P1. `open()` keeps its contract and gets its dependencies.**
- Construct with `createPresenter({doc, api, host})`.
- The call is `open({slides: [{name, url, notes?: {rootUid, onAdd?}}], index, onClose, laser: {color, decay}})`. `onClose` stays because `presentOnce` needs it (A9).
- It returns `{setSlide, isOpen, close, notice}`.
- P owns `test/view-present.test.js`, and its existing cases must still pass.

**P2. The notes pane is live, read-only and light, with inert links.**
- On show, call `host.pullEmbedContent("((rootUid))")` and render its `children`: depth 2, capped at 30 (`view/embeds.js:5,10`). Each block gets its own fresh host element rendered with `api.ui.components.renderString`.
- While the pane shows that slide, `host.watchEmbed(rootUid, rerender)` keeps it current. `renderString` alone is a static snapshot (spec §13 l.265).
- On slide change, pane hide or close:
  - dispose the watch;
  - `unmountNode({el})` every host, as `unmountHosts` does (`:119-125`);
  - do this before `dialog.remove()`.
- A generation counter discards renders that arrive late.
- A click listener on the pane, in the capture phase, swallows clicks on links and refs. A ref click would navigate Roam and destroy the mounted editor (spec §13 l.308).
- Fixed light theme: `#fff` background, `#1c2127` text. Roam's rendered colours are unreadable on `#0b0d0f`.
- Empty state shows "No notes", plus an "Add notes" button when `onAdd` exists.
- A status line inside the dialog shows `notice()` for 4 s.

**P3. Click and key routing.**
- Advance on click only when no tool is active and the click is outside the pane, its controls and the tool canvas.
- A click event with no target keeps the current left-half/right-half rule (`present.js:84-89`). The existing tests dispatch `{clientX}` only (`test/view-present.test.js:50-52`).
- N, L and P act only with no Meta, Ctrl or Alt held, and not on `repeat` or `isComposing`, so Cmd+P still reaches the browser.
- A key whose target is inside the pane never navigates and is not `preventDefault`ed, so the pane scrolls.
- The progress bar is `role="progressbar"` with `pointer-events: none`.

**P4. The laser/pen canvas covers the slide area only, is DPR-correct, and runs no idle animation frames.**
- Size and resize:
  - The canvas covers the slide area, not the pane.
  - Backing size is `round(css × devicePixelRatio)`, with `setTransform(dpr, 0, 0, dpr, 0, 0)`.
  - It resizes on window `resize` (listener added in `open`, removed in `close`) and when the pane toggles. A resize clears the pen.
- `pointer-events: none` unless L or P is active; `touch-action: none` while one is.
- Laser:
  - records `{x, y, t}` on every `pointermove`, no press needed;
  - requests animation frames while any point is younger than `decay`, then stops.
  - The contract's "rAF only while the pointer moves" would leave a half-faded trail frozen on screen.
- Pen:
  - draws while the pointer is pressed, using `setPointerCapture`;
  - redraws only when a stroke changes.
- A slide change clears both. Turning P off clears the pen. L and P are mutually exclusive.
- `raf`, `now` and `devicePixelRatio` are injectable. Nothing is persisted.

**P5. `buildPrintDocument` uses CSS that actually paginates.**
- `size: 16:9` is not valid CSS. The 16:9 page is `254mm 142.875mm`.
- Letter and A4 use named pages:
  - `@page plx-l { size: <letter|A4> landscape; margin: Mmm }` and `@page plx-p` for portrait;
  - each page uses `plx-l` when its image is wider than tall.
  - Measure live that mixed orientations come out right. Fallback: one orientation for the whole document, chosen by majority.
- Each page `div` is the content box in mm, W − 2M − 0.5 wide and H − 2M − 0.5 tall; the 0.5 mm stops a rounding overflow that adds blank pages. The image inside is `display: block`, `max-width` and `max-height` 100%, `object-fit: contain`.
- `break-after: page` on every page except `:last-child`. A blanket `page-break-after` adds a trailing blank page.
- `body` has `margin: 0`; set `print-color-adjust: exact`.
- The document `<title>` is "<drawing> frames"; Chrome uses it as the default PDF file name.
- Escape all names. No scripts; the only external URLs are the `blob:` images.

**P6. `printPages`: iframe lifecycle and image readiness.**
- The iframe is `position: fixed`, 0×0, no border, `opacity: 0`, `pointer-events: none`. Never `display: none`.
- Write the document with `open()`, `write()`, `close()` on `about:blank`, which inherits Roam's origin so `blob:` URLs load. If Roam's CSP blocks the inline `<style>` (measure live), fall back to `sheet.insertRule`.
- Ready means every image is `complete && naturalWidth > 0`, checked through `load`/`error` events with a 15 s cap. On failure, reject and do not print.
- Do not call `decode()` on every page: that would decode up to 50 2x bitmaps at once.
- Then `focus()` and `print(win)` (injected).
- Remove the iframe on `afterprint` or when `print()` returns, whichever comes first, with a 60 s fallback.
- The function returns `{done, dispose}`.
- Measure live in Roam Desktop that printing from the iframe prints the iframe and not the Roam window. Fallback:
  - put the pages in a Plexus-owned `body > .plexus-print` container;
  - add a temporary `@media print` rule that hides every other child of `body`;
  - call `window.print()`, then remove both.

**P7. `downloadPngs`: spaced clicks, owned URLs, safe names.**
- One `<a download>` click every 250 ms. Each URL is revoked 5 s after its click, and all of them on dispose.
- File name: `<drawing> - <nn> <frame name>.png`:
  - `nn` is zero-padded to the width of the total count;
  - an unnamed frame is "Frame n";
  - replace `[\\/:*?"<>|\u0000-\u001f]` with "-";
  - cap at 120 characters.
- Measure live Chrome's multiple-download prompt and Roam Desktop's per-file save behaviour. If Roam Desktop asks once per file, fall back to one store-only zip written in `print.js`, with no dependency.

### E

**E1. Listen on `window` in the capture phase, and bail out cheaply.**
- Roam uses `window` capture listeners (spec §13 l.306). A paste listener on `document` could run after them.
- Install at load: `win.addEventListener("paste", h, true)`.
- Bail in this order:
  1. `e.defaultPrevented`;
  2. the target is not a `TEXTAREA.rm-block-input` (also accept an `id` starting `block-input-`; measure the class live);
  3. `clipboardData.types` includes `"Files"`;
  4. `getData("text/plain").trimStart()` does not start with the prefix `{"type":"excalidraw/clipboard"`;
  5. the caret is in code (E4);
  6. `JSON.parse` fails (inside `try`).
- The whole handler is wrapped in try/catch.
- No `keydown` listener. The code-block rule is the only escape hatch.

**E2. When it acts, it stops Roam too, and it never dumps raw JSON.**
- On success, call both `preventDefault()` and `stopImmediatePropagation()`. With `preventDefault` alone, Roam's React paste handler still inserts the JSON.
- An Excalidraw payload that yields nothing, outside code, is also swallowed, with the toast "Nothing to paste as text; paste inside a code block to keep the JSON". The measured alternative is 729 characters of JSON in the block (spec §13 l.321). This overrides the contract's rule to call `preventDefault` only when something was produced.

**E3. One result type and complete per-element rules.**
- `excalidrawClipboardToText(json)` returns `{lines: string[]}` or `null`. The contract's single-kind union cannot represent a mixed selection.
- Reading order: sort by top y. Elements whose vertical centres differ by less than half the smaller height share a row and sort by x.
- Per element:
  - An embed anchor (`customData.plexus.embed`) gives its ref, and its bound text is skipped. Otherwise the ref is lost.
  - A text element, bound text included, gives `originalText ?? text`.
  - An image gives `![](firebaseUrl)`, only when the URL starts with `https://`.
  - A non-text element whose link is `((uid))` or `[[Title]]` gives that link.
  - Frames, bare shapes, arrows, freedraw and deleted elements give nothing.
- Cap at 100 lines, with a toast when capped.

**E4. Code context comes from the live textarea.**
- Read `ta.value` and `selectionStart`, not the saved block string. Leave the paste to Roam when:
  - the text before the caret contains an odd number of triple-backtick fences;
  - the value starts with a fence;
  - there is an odd number of single backticks before the caret once the fences are removed (inline code).

**E5. Inserting the text and adding siblings.**
- The first line goes in through `insertText(ta, text)`, which is injectable. The default is `doc.execCommand("insertText", false, text)`, kept because it gives native undo and fires React's `input` event.
  - If it returns false: use the native `value` setter at the selection, then dispatch `new Event("input", {bubbles: true})`.
- The remaining lines go to `createSibling({uid, strings})`:
  - `uid` comes from `host.blockUidFromNode(ta)` (`roam.js:428-436`);
  - I implements it as `host.blockInfo` (`:273-290`), then awaits `host.createBlock({parentUid, order: order + 1 + i})` for each line in turn.
- Measure live:
  - the caret stays in the first block;
  - no autocomplete menu is left open;
  - Cmd+Z removes only the inserted text. The siblings stay, and the CHANGELOG says so.

### K

**K1. The frame flyout does not collide with the region button and adds no hotkeys.**
- The toolbar already has a "Frame (with margin)" button (`toolbar.js:92`), so the flyout button is "Frames ▾".
- The popover lives in `body` at the toolbar's z + 1. It stops key and pointer propagation (as `toolbar.js:62-65` does). It closes on an outside `pointerdown`, on Esc, after an action, and in `hide()`.
- Rows:
  - the six presets;
  - a "Reformat selected frame" group with the same six, enabled only when `actions.selectedFrameId()` returns a frame;
  - "Slide";
  - "2x2 · <preset>" and "Strip · <preset>", where the preset is the last one clicked this session (default 16:9).
- `HOTKEYS` (`settings.js:60-68`) is unchanged.

**K2. New menu entries use cheap display conditionals.**
- Canvas menu:
  - "Plexus: Present from here", enabled when `hasFrames()`. It runs `presentDrawing({from: "here", at: toScene(point)})`.
  - "Plexus: Add notes", enabled when `selectedFrameId()` returns a frame.
- Block menu:
  - "Plexus: Present this outline". Its conditional is one memoized pull of the child strings, true when some child matches A12's pattern.
  - "Plexus: Present from here" on `frame` and `cframe` region blocks, and in `blockRefContextMenu` on refs to them. Add the region kind to `refInfo` (`:53-65`). Both call `presentFromRegion`.
  - "Plexus: Print frames" and "Plexus: PNG per frame" on drawing blocks, next to "Present frames" (`:207`). They are the entry point for A13's cold path.
- Menu registrations measured +0 ms per keystroke (spec §13 l.275).

**K3. Settings get their own field types instead of the drawing-name path.**
- `settings-dialog.js` runs every `"text"` field through `drawingNameOf` (`:63`, `:69`), so an empty colour would show "Drawing {date}".
- Add a `"color"` field (`<input type="color">`), validated against `^#[0-9a-f]{6}$` (case-insensitive), falling back to `#e03131`.
- `print-size` is a select: Letter, A4, "16:9 slide".
- `readSettings` clamps the new settings the same way, and `DEFAULTS` gains the four keys.
- K owns `test/toolbar.test.js`, `test/view-context-menus.test.js`, `test/settings.test.js` and `test/view-settings-dialog.test.js`.

### I

**I1. Wiring the contract leaves out.**
- `createPresenter({doc, api, host})` (`extension.js:220`).
- `createEmbedOverlay({…, onLoaded: () => actions.scheduleEmbedLabels(app)})` (`:491-497`), plus a disposer that cancels the pending schedule on unmount.
- New toolbar callbacks, passed at `:124-150`: `onAddFrame`, `onReformatFrame`, `canReformat`, `onMakeSlide`, `onLayout`.
- `installCanvasPaste({win, doc, toast, createSibling})` registered through `lifecycle.add` at load.
- Command-list rows:
  - "Present from here": `presentDrawing({from: "here"})` when an editor is mounted, else `presentFromRegion(ctx.focusedUid)`;
  - "Present this outline": `presentOutline(ctx.focusedUid)`;
  - "Print frames…" and "PNG per frame": `printFrames({drawingUid: activeEditor?.drawingUid ?? ctx.focusedUid, mode})`.
- The palette keeps exactly two entries (`:684-693`).

**I2. Ownership fixes, binding on the unit table.**
- A adds: `src/model/embeds.js`, `test/embeds.test.js`, `src/view/embeds.js` (the hook only), `test/view-embeds.test.js`, `test/actions-p3.test.js`.
- P adds: `test/view-present.test.js`, `test/view-print.test.js`.
- `src/host/roam.js` needs no change. The work reuses `pullEmbedContent`, `watchEmbed`, `regionsOf`, `createRegion`, `createBlock`, `blockInfo`, `blockUidFromNode` and `labelSource`.
  - A new host method is allowed only if it is listed here, with `test/host-roam-p11.test.js`.
- Nobody edits `native.js`, `api.js`, `hotkeys.js` or `command-list.js`.
- Units that write snippets run `mkdir -p /tmp/wo` first.

### Gate

**G1. Gate 1 procedure.**
- Use a drawing that has been opened at least once since migration: migrated drawings re-save on their first open (spec §13 l.243).
- (a) Labels current: open, wait 5 s, close. `:edit/time` and `elements-json` are unchanged.
- (b) Edit the block outside the drawing, then open. Expect exactly one save within 5 s, with `originalText` equal to `embedLabel` of the new string.
  - Reopen: no save.
  - The hot slide and the cold print both show the new label.
- (c) Cmd+Z right after (b) does not revert the label.
- (d) Record the undo count for "Make slide" (A7) and for a preset (expected 1).

**G2. Print verification route.**
- `Page.printToPDF` must be called with `preferCSSPageSize: true`; without it `@page size` is ignored.
- Check:
  - page count equals frame count (5), with no trailing blank page;
  - each page's size matches P5, including 254 × 142.875 mm for 16:9.
- With `print()` stubbed in Roam Desktop, check that the stub received the iframe's window and that the iframe is gone afterwards.
- The real Roam Desktop print remains the user check.

**G3. Presenter checks.**
- A notes child edited in another window shows up in the pane within 1 s.
- A `[[link]]` click in the pane navigates nowhere, and the editor survives.
- Arrow keys in the pane scroll instead of changing slides.
- Laser and pen leave `:edit/time` unchanged.
- A canvas right-click on a frame starts the presentation at that frame.
- An alias-ref child in an outline deck presents.

**G4. Paste checks.**
- Inline code and fenced code: the paste is untouched.
- Plain multi-line text is still split into blocks by Roam.
- The dock's blocks convert pasted elements.
- After unload, `getEventListeners` paste counts on `window` and `document` are back to baseline.
- Typing costs +0 ms with the editor closed, on the P10 bench.
