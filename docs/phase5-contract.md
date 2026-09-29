# Plexus Phase 5 — legacy migration, automation API, editable embeds (binding)

Repo `~/roam-plexus`, HEAD `c573b5d` (0.4.0). Earlier contracts still bind anything not changed here. Spec §7 rows "Legacy ExcalDATA migration", "Automation API", and "Block embeds on canvas" (the editable variant). Roam rules: `~/.claude/skills/roam-plugin-dev/SKILL.md` §(d), rules 10, 11, 13, 14, 19, 20 matter most. Zero runtime deps, plain JS, `node --test`, no jsdom, log prefix `[plexus]`, never throw into Roam. Version 0.5.0.

## Measured facts (2026-09-29)

- **Legacy drawings** (Svy, read-only scan): 9 blocks contain `((ExcalDATA))`.
  - 1 of them is the old component's CODE block (uid `sketching`, page `roam/excalidraw`, 32 KB of ClojureScript). It is NOT a drawing and must be excluded.
  - 8 are legacy drawings whose string is `{{roam/render: ((ExcalDATA)) {…EDN…}}}`. 2 of the 8 are empty (no elements). The EDN map has `:appState {…}`, `:elements [{…} …]`, and usually `:roamExcalidraw {:version 1}`.
  - Element keys are EDN keywords (`:strokeColor "#000000"`, `:points [[0 0] [1 -2]]`, `nil`). Legacy fields include `:strokeSharpness` and `:boundElementIds`, plus the legacy type `"draw"`. There are no `:files` and no `:fileId`: no images anywhere.
- **Import path.** `app.addElementsFromPasteOrLibrary({elements, files: {}, position: "center"})` exists on the Excalidraw 0.18 App. It runs Excalidraw's own `restoreElements`. Verified on synthetic legacy elements:
  - `strokeSharpness: "sharp"` → `roundness: null`; `"round"` → `{type: 2}`.
  - `boundElementIds` → `boundElements`, with remapped new ids.
  - `type: "draw"` → `line`, keeping its points.
  - Text gains `originalText` and `lineHeight: 1.25`.
  - Arrow bindings are remapped.
  - The elements get new ids, are placed centered in the viewport, and Roam's save persists them.
- **renderBlock over the full-screen editor.** A `renderBlock` mounted in a `position: fixed; z-index: 1002` portal above the full-screen editor (z 1000) gives Roam's real editor. A synthetic mousedown/mouseup/click on `.rm-block__input` focuses the textarea.
  - Trusted `[` `[` keydowns auto-pair `]]` and open `.rm-autocomplete__results`. It renders INSIDE the portal's stacking context (its own z-index is 20) and is visible above the editor (a hit test lands on a result row).
  - `Input.insertText("[[")` does NOT open the autocomplete; only keydown does.
- **Pull patterns.** Roam has no `:block/parent`. Use `{:block/_children [:block/uid]}` (P4 learning). `data.pull` returns null when none of the requested attributes exist.

## A. Legacy migration (dry run first; apply only on explicit per-drawing confirmation)

- `src/model/edn.js` (pure) — `parseEdn(text)`:
  - Maps become objects. A keyword key `:a` or `:ns/a` becomes the key "a" or "ns/a".
  - Vectors and lists become arrays. Sets `#{…}` become arrays.
  - Strings keep their escapes (`\"`, `\\`, `\n`, `\t`, `\uXXXX`). Numbers cover ints, floats, negatives and exponents.
  - `nil` becomes null. `true` and `false` become booleans. Keyword and symbol values become strings without the colon.
  - Commas count as whitespace. `;` comments and `#_` discard forms are skipped.
  - Malformed input throws `SyntaxError` with the character position. Keep it iterative or bounded in depth; there must be no stack blowups.
- `src/model/legacy.js` (pure):
  - `isLegacyDrawingString(s)`: after trimming, `s` starts with `{{roam/render: ((ExcalDATA))`, or `{{[[roam/render]]: ((ExcalDATA))`, followed by optional whitespace and `{`.
  - `parseLegacyDrawing(s)` → `{elements, appState, version}` or `{error}`. The EDN map runs from the first `{` after the macro to its matching `}`. Deleted elements are dropped.
  - `legacyToElements(ednElements)` → plain JS element objects for the paste path. Keep every field as is, because Excalidraw's `restoreElements` does the normalizing. Coerce `points` to `[[x, y], …]` numbers. Drop `null` versions.
  - `legacyReport(rows)` → `[{uid, page, elementCount, types: {type: n}, empty, bytes, error?}]`, sorted by page then uid.
- **Dry run** (`actions.legacyDryRun()`, command "Plexus: Legacy drawings (dry run)"):
  - One `data.q` for block strings containing `((ExcalDATA))`, filtered by `isLegacyDrawingString`, plus page titles through `:block/page`. Blocks on page `roam/excalidraw` are excluded.
  - It parses each drawing and shows the report in a `dialog.plexus-portal.plexus-legacy` (showModal; Esc closes; closed on unload). Each row: page, uid, element count, types, empty flag, and a **Migrate** button (disabled for empty or error rows).
  - A **Copy report** button writes the JSON report to the clipboard.
  - It makes ZERO graph writes.
- **Migrate** (`actions.migrateLegacy(uid)`), started only from its row button:
  1. Ask `window.confirm("Create a new native drawing right below this legacy block? The legacy block is not changed.")`. The confirm function is injected, so tests can fake it.
  2. Refuse with "Already migrated" when the next sibling is a native drawing whose elements carry `customData.plexus.migratedFrom === uid`.
  3. Create `{{[[excalidraw]]}}` as the next sibling of the legacy block: the parent comes from `:block/_children`, and order is the legacy block's order + 1.
  4. Open the new drawing full-screen with the existing open flow and wait until `!app.state.isLoading`.
  5. Call `app.addElementsFromPasteOrLibrary({elements, files: {}, position: "center"})`.
  6. Merge `customData.plexus.migratedFrom = uid` into every element just added, found by diffing ids before and after. Use one updateScene that bumps versions and merges customData, never replacing it.
  7. Zoom to fit, then wait (≤3 s) until the drawing's `:excalidraw/elements-json` holds N live elements.
  8. Toast "Migrated N elements. The legacy block is unchanged."
  - It NEVER updates, moves or deletes the legacy block.

## B. Automation API (`window.RoamPlexus`, apiVersion 2; additive)

- `scene(uid)` → `null` if no editor for that drawing uid is mounted. Otherwise it returns a frozen object:
  - `uid`
  - `elements()`: copies of the live elements
  - `appState()`: `{scrollX, scrollY, zoom, selectedElementIds, theme, width, height}`
  - `add(elements, {select = true})`: through `addElementsFromPasteOrLibrary`, returning the new ids by diffing ids before and after
  - `update(id, patch)`: bumps `version`/`versionNonce` and merges `customData`; the `id` and `type` keys are rejected
  - `remove(ids)`: sets `isDeleted: true`
  - `select(ids)`, and `zoomTo(ids)` (fit with a margin)
  - `exportSvg(ids)`: `captureSelectionSvg` plus `normalizeSvgSize`
  - `onChange(cb)` → unsubscribe, through `onChangeEmitter`
  - Every method throws `Error("Scene is no longer open")` after the editor unmounts.
- `whenOpen(uid, {timeoutMs = 10000})` → Promise of the `scene(uid)` object. It opens the drawing through the existing open flow if the drawing is not mounted.
- Bump `apiVersion` to 2. All v1 members are unchanged; Compass checks `>= 1`.

## C. Editable embeds (renderBlock, rules 13 and 19)

- **Enter edit mode:** toolbar button "Edit embed", enabled when EXACTLY one embed anchor is selected, or F2 in that same case. F2 on a mind-map node keeps its P4 meaning.
  - Block refs only. For a page ref, toast "Page embeds are read-only for now".
- **In edit mode, for that one overlay:**
  - Add class `plexus-embed--editing` and `pointer-events: auto`, with z-index = the full-screen container's z + 2.
  - Mount `renderBlock({uid, el: inner})` in an inner element. The outer portal stops the BUBBLE propagation of `keydown`, `keyup`, `keypress`, `input`, `paste`, `copy`, `cut`, `pointerdown`, `pointerup`, `mousedown`, `mouseup`, `click`, `dblclick` and `wheel`. Excalidraw's document-level handlers then never see keys typed into Roam's editor (Delete, arrows, Ctrl+A).
  - Wait for MutationObserver quiet in the inner element (2 frames, capped at 900 ms), then send the synthetic mousedown/mouseup/click to `.rm-block__input` to focus Roam's real editor.
  - Plexus makes ZERO graph writes to that block while it is mounted (rule 19).
  - Only one overlay can be in edit mode at a time. Pan and zoom tracking keeps working in edit mode.
- **Leave edit mode** on any of:
  - Esc, when no `.rm-autocomplete__results` is present in the document;
  - a pointerdown outside the overlay (capture listener on `doc`, only while editing);
  - editor unmount, or extension unload.
- **Leave sequence:**
  1. Blur the textarea.
  2. Wait 300 ms so Roam saves.
  3. `unmountNode({el: inner})`.
  4. Restore read-only mode and re-render the content from a fresh pull.
- **Unload:** first leave edit mode (the same sequence, with the wait capped at 300 ms), then run the existing overlay cleanup.

## D. Toolbar

Add **Edit embed** (enable rule above). Button order: Region, Image region, Frame (with margin), Region from crop, Embed block, Edit embed, Present, Mind map.

## File ownership (parallel)

| Unit | Files |
|---|---|
| A (model) | `src/model/edn.js` (new), `src/model/legacy.js` (new), `test/edn.test.js`, `test/legacy.test.js` (new). Include EDN fixtures shaped like the measured format: `{:appState {…} :elements [{:type "draw" :points [[0 0] [1 -2]] :strokeSharpness "round" …}] :roamExcalidraw {:version 1}}`, escapes, nil, sets, discard, and malformed input. |
| B (host + api) | `src/host/native.js` (`addViaPaste(app, elements)` → new ids by diff; `waitNotLoading(app, timeoutMs)`), `src/api.js` (apiVersion 2: `scene`, `whenOpen`), `test/api.test.js`, `test/host-native.test.js` |
| C (view + actions + wiring) | `src/view/embeds.js` (edit mode), `src/view/legacy-dialog.js` (new), `src/view/toolbar.js`, `src/actions.js` (`legacyDryRun`, `migrateLegacy`, `editEmbed`), `src/extension.js` (commands, API wiring, cleanup), `src/extension.css`, `test/view-embeds.test.js`, `test/view-legacy.test.js` (new), `test/actions-legacy.test.js` (new), `test/toolbar.test.js`, `test/extension.test.js` |

Parallel units edit only their own row. Do not run git checkout, reset, stash, add, or commit.

## Gates

- **EDN and legacy:** parser fixtures and the report are exact. The dry run makes zero writes; tests assert no `block.*` call.
- **migrateLegacy:** the only writes are one `block.create` plus scene operations. It never touches the legacy uid (tested with a strict fake). The already-migrated guard works.
- **API:** `scene()` is null when not mounted, and it throws after unmount. `add` returns the new ids. `update` merges customData.
- **Edit mode:** key events inside the overlay do not reach a fake document-level listener. Leaving uses the order blur → wait → unmount → re-render. There are no graph writes while mounted. Unload while editing leaves nothing behind.
- **Live** (Readwisenotes only):
  - A synthetic legacy block → dry run shows 1 row → Migrate → a native drawing appears below it with N elements, and the legacy block string is unchanged.
  - `RoamPlexus.scene(uid).add/update/remove/exportSvg`.
  - Edit embed: typing (including `[[` autocomplete) edits the real block; Esc exits; Excalidraw did not react to the typed keys.
- **Svy:** only a READ-ONLY dry-run report is generated for the user, through a blob import of the pure `src/model/legacy.js` into the Svy window. The extension is not installed there. **STOP: the user reviews that report before any Migrate on Svy.**
- `npm run check` is green. Version 0.5.0 with a CHANGELOG entry.

## Amendments (critic, binding)

Architecture critic pass, 2026-09-29, against HEAD `c573b5d` (0.4.0) and the Excalidraw 0.18 source in `~/excalidraw-port-research/excalidraw`: `data/restore.ts` `restoreElements`, `element/src/duplicate.ts` `duplicateElements`, and `App.tsx` `addElementsFromPasteOrLibrary` and `addEventListeners`. That tree is zsviczian's fork. Where Roam's 0.18.0 build may differ, the item says to measure. Each item names its unit. Where an item conflicts with the body above, the item wins.

### Measure before any unit starts (orchestrator, live, Readwisenotes, trusted CDP)

1. **Roam's editor under the stoppers.** Mount `renderBlock` in the edit-mode portal with the full §C bubble-stopper list already installed on the outer element. Then check with trusted input:
   - `[[` opens the autocomplete, and ArrowDown + Enter inserts a result.
   - `((` block search works, and `/` opens the slash menu.
   - A text paste lands in the block, and Backspace edits it.

   Record `React.version` and whether the mount element carries a `__reactContainer$*` key. React 17+ delegates events at the root container (the mount element, inside the portal), so bubble stoppers on the outer element are safe. React 16 delegates at `document`, and the same stoppers would silence Roam's editor. The measured fact above was not taken with the stoppers installed. If any check fails, stop and amend §C before unit C starts.
2. **Roam's keyboard listeners and block selection.**
   - Record every keydown listener Roam registers on `window`, `document` and `body`, with its phase (CDP `DOMDebugger.getEventListeners`).
   - Press Esc in a renderBlock textarea. Record whether Roam leaves the block in block-selection state (`roamAlphaAPI.ui.individualMultiselect.getSelectedUids()`, or `.block-highlight-blue`).
   - Then focus the Excalidraw container and press Delete. Record whether that deletes the Roam block.
   - Record whether Excalidraw's `onKeyDown` sits on `document` (`handleKeyboardGlobally`) or on the container.
3. **Roam menu selector.** Record the root class of each popup a block editor can open, and whether it renders inside the mount element or under `<body>`:
   - the `[[`, `((` and `#` autocomplete
   - the `/` slash menu and the `{{` component menu
   - the date picker and the `:` emoji picker
   - the right-click block menu

   The union of those classes is `ROAM_MENU_SELECTOR`, used by items 43 and 44.
4. **Invisible elements on paste.** Paste through `addElementsFromPasteOrLibrary` a legacy set that includes one zero-size rectangle and one empty text.
   - In the 0.18 source, `restoreElements(…, {deleteInvisibleElements: true})` keeps an invisibly small element as `isDeleted: true` rather than dropping it, and `duplicateElements` copies it. An empty text is dropped.
   - A naive before/after id diff therefore counts deleted copies.
   - Record what Roam's build does.
5. **One undo step for paste + strip.** Paste, then run an `updateScene` with no `captureUpdate` key in the same synchronous task (item 32). Record that one Cmd+Z removes every pasted element, and that the elements-json Roam saves holds the stripped values.
6. **Caller uid reuse.** Record what `data.block.create` does with a caller uid that (a) already exists, and (b) belonged to a block deleted earlier in the session. Item 19 depends on both answers.

### EDN reader (A)

7. **Escapes.**
   - Also decode `\r`, `\b` and `\f`; CLJS `pr-str` emits them. Any other escape is a `SyntaxError`.
   - Raw control characters and raw non-ASCII inside strings are kept as they are.
   - A `\uXXXX` surrogate pair combines into one astral character.
8. **Numbers.**
   - A token is a number only if it fully matches `[+-]?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?`. JS prints `1e+21`.
   - `##NaN`, `##Inf` and `##-Inf` read as numbers. So do the bare symbols `NaN`, `Infinity` and `-Infinity`, which older CLJS printers emit.
   - `N` and `M` suffixes and ratios are a `SyntaxError`.
9. **Tags.**
   - `#inst "…"` and `#uuid "…"` read as the string.
   - `#js` and any other `#tag` read as the value of the next form. So `#object[Object …]`, the CLJS print form of an opaque JS object, parses.
   - `#{` is a set, `#_` a discard, and `##` a special number. Any other `#` is a `SyntaxError`.
10. **Map keys.**
    - A keyword becomes its name, including the namespace. A string stays itself. A number, boolean or nil becomes `String(value)`. A collection key is a `SyntaxError`.
    - For duplicate keys, the last one wins.
    - Every key is set with `Object.defineProperty` (enumerable, writable, configurable), so `__proto__`, `constructor` and `prototype` become own data properties.
    - Test: `{:__proto__ {:polluted 1}}` leaves `({}).polluted === undefined` and the parsed object's prototype unchanged.
11. **Reader API.**
    - `readEdn(text, start = 0)` → `{value, end}` reads exactly one form.
    - `parseEdn(text)` requires one top-level form. Only whitespace, commas, comments and discards may follow it.
    - The legacy map's end comes from `readEdn`, never from a separate brace counter, because text elements contain `}` and `}}` inside strings.
12. **Bounds and errors.**
    - Use an explicit stack with a max depth of 512. A 10,000-deep `[[[…` throws `SyntaxError`, never `RangeError`.
    - Every `SyntaxError` message ends with `at <index>` and carries a numeric `position`. Tests pin the position for: an unterminated string, an unterminated map, an odd number of map forms, a bad escape, a stray `}`, and a trailing `#_`.
    - A 1 MB synthetic legacy map parses in under 200 ms in CI; log the number.

### Legacy model (A)

13. **Recognizer.** `isLegacyDrawingString(s)` holds when the trimmed `s` matches `^\{\{\s*(?:\[\[roam\/render\]\]|roam\/render)\s*:\s*\(\(ExcalDATA\)\)\s*(?:\{|\}\})`.
    - The `}}` branch is a legacy drawing that was never drawn. `parseLegacyDrawing` returns `{elements: [], appState: null, version: null}` for it.
    - `mentionsExcalData(s)` is `s.includes("((ExcalDATA))")`.
14. **`parseLegacyDrawing(s)`.**
    - Read the map with `readEdn` at the first `{` after the macro.
    - After the map, optional whitespace and then `}}` are required; otherwise return `{error: "unterminated macro"}`. Text after `}}` is ignored and flagged `trailing: true`.
    - The top level must be a map whose `elements` is an array; otherwise return `{error: "no elements"}`.
    - Deleted elements are dropped.
15. **`legacyToElements(ednElements, {migratedFrom} = {})`** returns `{elements, invalid, invisible}`.
    - **Invalid** (dropped and counted): `type` is not a string; `x`, `y`, `width` or `height` is not a finite number; `angle` is present and not finite; or `points` is present and not pairs of finite numbers. A single `NaN` would otherwise poison `getCommonBounds` and move every pasted element to `NaN`.
    - **Invisible** (dropped and counted), by the 0.18 rule: a linear type (`line`, `arrow`, `draw`, `freedraw`) with fewer than 2 points; any other type with width 0 and height 0; a text whose `text` is empty.
    - With `migratedFrom`, merge `customData.plexus.migratedFrom` into each output element. Use `mergePlexusData` semantics, so other customData keys stay.
    - Inputs are never mutated.
16. **Report row (exact):** `{uid, page, elementCount, types, empty, bytes, invalid, invisible, links, macroText, trailing, error?}`.
    - `elementCount` and `types` count what Migrate will paste: valid, visible, live elements. `empty` is `elementCount === 0`, and Migrate is disabled for it.
    - `bytes` is the UTF-8 length of the block string (`TextEncoder`).
    - `links` holds the sorted distinct `[[…]]`, `#[[…]]`, `#tag` and `((uid))` tokens in text elements. Roam's text tail turns them into refs, and possibly new pages, when the migrated editor closes. The Svy reviewer must see them first.
    - `macroText` counts text elements containing `{{` or `}}`; those would sit inside Roam's `{{-: }}` tail.
    - Sort by page, then uid, with plain code-unit comparison (no `localeCompare`).
17. **Summary.** `legacySummary(queryRows)` returns `{mentions, excluded: [{uid, page, reason}], drawings, empty}`.
    - `reason` is `component-code` on page `roam/excalidraw`, and `not-a-drawing` for any other mention that fails item 13.
    - Nothing is dropped silently.
18. **One code path for the query.** `LEGACY_QUERY` (the `data.q` string) and `rowsFromQuery(results)` live in `src/model/legacy.js`. Both `actions.legacyDryRun` and the Svy probe (item 52) use them.

### Migration (C, with B helpers)

19. **Deterministic target, idempotent retry.** The migrated drawing's uid is `m${fnv1a(legacyUid)}`. Everything in this item runs under the Web Lock `lockName(graph, "migrate:" + legacyUid)` with `ifAvailable` (rule 4); the loser toasts "Migration already running in another window".
    - Pull the target uid fresh. If it holds at least one live element with `customData.plexus.migratedFrom === legacyUid`, refuse with "Already migrated", wherever the user has moved it.
    - Also check every sibling of the legacy block for such an element. That covers the random-uid fallback below.
    - If the target exists with a drawing string and zero live elements, an earlier run failed after the create: reuse it, with no create.
    - If the target exists and its string is not a drawing, refuse with "The block below the legacy drawing changed; nothing was written".
    - Otherwise create it under the legacy block's parent at order + 1. If that create rejects and the uid still pulls null (the deleted-uid case from item 6), create with a random uid.
    - Gate: at most one `block.create` per Migrate.
20. **Preconditions before any write.**
    - No full-screen editor is open; otherwise toast "Close the open drawing first".
    - Single flight across all uids; a second start toasts "A migration is already running".
    - The injected `confirm` returned `true`. A throw counts as `false`.
21. **Close the dialog first.** `dialog.close()` runs before the create. A `showModal` dialog sits in the top layer and makes the editor inert. Test: the dialog is closed when `openDrawing` is called.
22. **Open.**
    - Use the P4 open path, `openDrawingOnce`; the P4 live gate proved it on empty drawings.
    - Then `waitNotLoading(app, 5000)`, then two animation frames.
    - Then re-check that `native.activeEditor(doc)?.app === app`, that its drawing uid is the target, and that `app.state.width` and `height` are > 0.
    - If any check fails, abort with "Drawing closed before migration finished; run Migrate again". Item 19 makes the rerun safe.
23. **Tag before the paste (replaces body step 6).** The pasted elements are `legacyToElements(…, {migratedFrom: legacyUid}).elements`. Excalidraw's `restoreElement` keeps `customData`, and `duplicateElement` deep-copies it. So Roam's first save is already tagged, and a failure after the paste cannot defeat the guard. There is no post-paste customData `updateScene`.
24. **Count.**
    - In the paste's synchronous task, N = the live elements carrying the tag. If N = 0, show an error toast.
    - When N differs from the legacy element count M, the toast reads "Migrated N of M elements (K invalid or invisible skipped)".
25. **Verify, then claim.** Poll `host.drawing(target)` every 100 ms, for up to 3 s, until it holds N live tagged elements. Only then show the success toast. On timeout, toast "Migration not confirmed yet. Reopen the drawing before running Migrate again", with no success wording.
26. **Prove the legacy block is untouched.**
    - Pull the legacy block's `:block/string` and `:edit/time` before step 1 and again after verification.
    - Say "The legacy block is unchanged" only when both match. Otherwise say "The legacy block changed during migration (not by Plexus)".
    - The strict fake throws on: any `block.update`, `block.move` or `block.delete` of the legacy uid; any `block.create` whose `parent-uid` is the legacy uid; any `renderBlock` or `renderString` of the legacy uid.

### Dry-run dialog (C)

27. **Plain text only.**
    - Every field goes in with `textContent`.
    - Nothing from a legacy block goes to `renderString` or `renderBlock`. Rendering `{{roam/render: ((ExcalDATA))}}` would boot the 2021 ClojureScript component, which can write to its own block.
    - Show the item 17 summary above the rows, and `invalid`, `invisible`, `links` and `macroText` on each row.
28. **Clipboard and lifecycle.**
    - Copy report writes `JSON.stringify({summary, rows}, null, 2)` through `native.withClipboard`.
    - Only one legacy dialog exists; a second dry run replaces it.
    - The dialog is registered with the lifecycle, so unload closes and removes it (rule 14 sweep).

### Automation API (B, wiring C)

29. **Interfaces between parallel units.**
    - Unit B exports `createSceneRegistry({native, doc})` from `src/api.js`. It returns `{sceneFor(app, uid), release(app), dispose()}`.
    - `createPublicApi` also takes `{scenes, openDrawing}`.
    - Unit C adds `actions.openDrawing(uid, {sidebar})` → `Promise<{app, drawingUid} | null>`, described in item 36.
    - Unit C calls `scenes.release(app)` in the editor-unmount disposers, and `scenes.dispose()` on unload.
30. **Liveness.**
    - Every scene method first checks three things: the registry is not disposed, `native.activeEditor(doc)?.app === app`, and the drawing uid matches.
    - If any check fails, it throws `Error("Scene is no longer open")`. Async methods reject the same way when the editor goes away mid-call.
    - `scene(uid)` returns the same frozen object for the same App (WeakMap), and a new one after a reopen.
31. **Host helpers.**
    - `addViaPaste(app, elements, {position = "center"})` returns the live new ids in scene order: after minus before, filtered to `!isDeleted` (item 4). The before-snapshot, the paste and the after-snapshot run in one synchronous task, with no await.
    - `waitNotLoading(app, timeoutMs)` polls once per animation frame. It resolves `false` on timeout, or when the App is no longer the active editor.
32. **`add(elements, {select = true, at = "keep"})` returns ids in INPUT order.**
    - It rejects an empty or non-array input. It also rejects `type: "image"` elements; files are out of scope for v2.
    - It works on `structuredClone` copies. It drops invisibly small copies (the item 15 rule) and merges a transient `customData.plexus.addKey = i` into each remaining copy.
    - `at: "keep"` passes `position: {clientX, clientY}` = `sceneToViewport` of the copies' bbox center. That keeps their bounds where the caller put them, exactly when grid mode is off. `at: "center"` passes `"center"`. Without "keep", two `add` calls (boxes, then arrows) do not line up.
    - In the same task as the paste, one `updateScene` with no `captureUpdate` key does three things. It removes `addKey`, restoring each caller's customData exactly, including its absence. It resets `frameId` to null on every element whose input `frameId` was null, because the paste adopts elements into a frame under the target point. When `select` is false, it restores the prior selection.
    - `ids[i]` is the new id of input `i`, or `null` if that input was dropped. Bound-text copies are not listed.
33. **`update(id, patch)`.**
    - `patch` must be a plain object. The keys `id`, `type`, `version`, `versionNonce`, `isDeleted` and `index` are rejected.
    - An unknown id throws `Error("No element <id>")`.
    - The result is a new object: customData merged, `version + 1`, a random `versionNonce`, and `updated: Date.now()`. A `text` given without `originalText` also sets `originalText`.
    - It makes one `updateScene`, read and written in the same task.
34. **`remove`, `elements`, `appState`.**
    - `remove(ids)` also deletes bound text whose `containerId` is removed. It bumps versions, ignores unknown ids, and returns the count.
    - `elements()` returns `structuredClone`s of the live elements.
    - In `appState()`, `zoom` is the number `state.zoom.value`.
35. **`onChange(cb)`.**
    - Calls run at most once per animation frame, outside Excalidraw's commit, never synchronously inside `onChangeEmitter`.
    - Each call gets `{uid}` only. Errors are caught.
    - `release(app)` and `dispose()` remove all subscriptions.
    - Test: a callback that calls `update()` does not re-enter synchronously.
36. **`whenOpen(uid, {timeoutMs = 10000, sidebar = false})`.**
    - Unless the block string starts with `{{[[excalidraw]]}}` or `{{excalidraw}}`, it rejects `Error("Not a drawing")` with no navigation.
    - If the drawing is already mounted, it resolves after `waitNotLoading`.
    - If another drawing is full-screen, it rejects `Error("Another drawing is open")`.
    - When the drawing's fullscreen icon is already in the DOM (main or sidebar), `openDrawing` clicks it without navigating, as `openRegion` does. Only otherwise does it call `openBlock`, because navigating away from a visible drawing destroys the user's view.
    - Concurrent calls for one uid share one promise. A call for another uid while one is pending rejects `Error("Busy opening <uid>")`.
    - It resolves only after `!isLoading`. A timeout rejects `Error("Timed out")`, and an unload rejects `Error("Plexus unloaded")`.

### Editable embeds (C)

37. **Entry guards.**
    - Exactly one live element is selected, not counting bound text. It must be an embed anchor whose block ref points to an existing block.
    - Refuse with the toast "This block cannot be edited on the canvas" when the block is the drawing block, is an ancestor of it (`:block/parents` of the drawing uid), or has a string starting with `{{[[excalidraw]]}}`, `{{excalidraw}}`, `{{roam/render` or `{{[[roam/render]]`. Rendering those would nest a drawing or boot a render component inside the overlay.
    - F2 is a capture listener on the container with the P4 amendment 39–40 guards. It ignores `repeat`, and it swallows F2 only when it acts.
    - Edit embed is disabled while an edit session is entering, active, or leaving.
38. **Entry order.**
    1. Install the pointer and key stoppers (rule 19(1)).
    2. Clear Excalidraw's selection with one `updateScene({appState: {selectedElementIds: {}, selectedGroupIds: {}}})`, and remember the old selection. A leaked Delete or arrow key then cannot touch the anchor.
    3. Suspend repaints (item 40).
    4. Create a fresh inner element for this session.
    5. Call `renderBlock`.
    6. Wait for quiet.
    7. Click.
39. **Edit-mode geometry.**
    - No `transform`, no `clip-path`, `overflow: visible`, and no `aria-hidden`. Any transform makes the portal the containing block for Roam's fixed-position descendants and scales its editor. `clip-path` and `overflow: hidden` cut off the autocomplete.
    - Place the portal with `left`/`top` at the anchor's unrotated viewport rect. Width = max(anchor screen width, 320 px), clamped to the container width. `min-height` = anchor screen height, with height auto and text at 100 %.
    - `sync()` keeps tracking pan and zoom by updating `left`/`top` only. If the anchor becomes fully hidden, leave edit mode.
    - Scope edit-mode CSS under `.plexus-portal.plexus-embed.plexus-embed--editing` (rule 5).
40. **Repaint suspension.**
    - While a session is active or leaving, the portal's watch callback only marks the portal dirty. `load` and `paint` do not run, and they never touch the inner element.
    - After the unmount, one fresh load runs.
    - Test: firing the watch mid-edit calls neither `unmountNode` on the inner element nor `renderString`.
41. **Session token.**
    - Every await in enter and leave checks a per-session token. A leave during the enter cancels the pending click.
    - An enter while a leave is pending on the same portal waits for that leave.
    - Leave is idempotent: Esc, editor unmount and unload together return one promise and unmount once.
42. **Focus the root block.**
    - Click the ROOT block's `.rm-block__input` (its id ends with the uid), not the first one in the mount; children render too. Then put the caret at the end.
    - Within 300 ms, `doc.activeElement` must be a `TEXTAREA` inside the inner element whose id ends with the uid. If not, click once more. If that fails too, leave with "Could not open the block editor".
43. **Keys.** Use one capture listener on `window`, installed only while editing. It acts only on events whose target is inside the overlay, and it ignores `isComposing` and keyCode 229. A `window` capture listener runs before Roam's document-level shortcuts (session-learnings 2026-09-28, overlay pitfall 4).
    - **Esc:** if `ROAM_MENU_SELECTOR` matches anything, let the key through untouched. Otherwise call `preventDefault` + `stopImmediatePropagation`, then leave. The decision is made in the capture phase, before Roam closes its menu, so one Esc never both closes a menu and leaves.
    - **Root textarea, with no menu open:** Enter without Shift leaves; Roam's own save is the commit. Swallow these keys:
      - Tab and Shift+Tab
      - Backspace with the caret at 0 and an empty selection
      - Delete with the caret at the end
      - Alt+Shift+Up/Down and Cmd/Ctrl+Shift+Up/Down
      - Shift+Up when `selectionStart === 0`, and Shift+Down when `selectionEnd === value.length`

      Each of those would move, merge, split or block-select the root, and the result would land outside the mount.
    - **Any textarea in the mount:** swallow Cmd/Ctrl+A when the whole value is already selected. Roam's second Cmd+A selects every block on the page, and a later Delete deletes them.
    - If measure 2 shows that Roam's Esc handler runs before any extension listener can (a `window` capture listener registered first), the leave must also clear Roam's block selection, using the API recorded in measure 2. The live gate in item 49 binds either way.
44. **Pointer.**
    - Always stop the bubble of `pointerdown`, `mousedown`, `dblclick` and `wheel`.
    - Stop `pointerup`, `mouseup` and `click` only for a pointer whose `pointerdown` started inside the overlay. A canvas drag released over the overlay must still reach Excalidraw's `document` `pointerup`, or its gesture sticks.
    - For the pointerdown-outside test, "inside" is the overlay subtree plus anything matching `ROAM_MENU_SELECTOR` or `.bp3-portal`. The Plexus toolbar counts as outside.
45. **Focus drops never trigger a leave.**
    - Nothing leaves on `focusout` or `blur`.
    - While editing, a `window` capture keydown whose target is outside the overlay is swallowed. This covers focus falling to `body` during late hydration (rule 19(3)).
    - Within 1.2 s of the click, such a keydown triggers one refocus and a caret restore. After that, it refocuses if the root textarea exists; otherwise it leaves.
    - Test: focus drops to `body` 50 ms after the click, and then a Delete keydown arrives. The key is swallowed and focus restored, there is no leave, and a fake document-level Excalidraw listener sees nothing.
46. **Leave sequence (replaces the body's).**
    1. Set `pointer-events: none` on the outer element and remove the pointer stoppers. Keep the key stoppers.
    2. Blur `doc.activeElement` if it is inside the inner element.
    3. On a keyboard trigger (Esc or Enter), call `containerEl.focus({preventScroll: true})` right away (P4 amendment 42), so later keys reach Excalidraw, not `body`.
    4. Wait 300 ms, with the same cap on unload.
    5. Call `unmountNode({el: inner})` and remove the inner element.
    6. Remove the key stoppers, restore the read-only geometry and `aria-hidden`, resume the watch, and run one fresh load.
    7. On a keyboard trigger, restore the remembered selection if all of its ids are still live. On a pointer trigger, leave the selection to the user's click.

    The test asserts this order from a call log.
47. **Unmount and unload.**
    - `overlay.dispose()` returns the leave promise, and `unmountEditor` returns it too. The lifecycle awaits it on unload, because `lifecycle.dispose` awaits promise disposers.
    - `remove(id)` on an editing portal runs the leave, never an immediate unmount. This covers an anchor deleted by undo or by a remote change.
    - Test: unload while editing. After the promise settles there are zero portals, zero inner elements, zero window or document listeners, and exactly one `unmountNode` for the inner element.
48. **Zero writes.** During an edit session the fake asserts no `data.block.*` or `data.page.*` call. It also asserts no `updateScene` carrying `elements`; the only allowed updates are the two selection updates of items 38 and 46.

### Gates (added)

49. **Live, editable embeds (Readwisenotes):**
    - With the stoppers installed, `[[` + ArrowDown + Enter inserts a result.
    - With the menu open, one Esc closes only the menu, and a second Esc leaves.
    - After every leave, `getSelectedUids()` is empty. Then, with the anchor selected, Delete removes the anchor in Excalidraw and the Roam block still exists.
    - At zoom 0.5 and at zoom 2, the editor text is at 100 %. The autocomplete of an anchor near the container's bottom edge is fully visible.
    - Enter on the root leaves edit mode and creates no block; the sibling count is unchanged.
    - A selection box dragged on the canvas and released over the editing overlay finishes normally.
    - Unload while editing leaves nothing behind, and the typed text is in the block.
50. **Live, migration:**
    - Close the editor after the create and before the paste, then Migrate again. No second block appears, and the drawing ends with N tagged elements.
    - A second Migrate says "Already migrated". It still does after the migrated drawing is moved to another page.
    - The legacy block's string and `:edit/time` are unchanged.
    - A synthetic legacy block with one `NaN` coordinate, one zero-size rectangle and one empty text migrates the rest and reports the skipped count.
51. **Live, API:**
    - A box `add` and an arrow `add`, made in separate calls, line up.
    - `add` returns ids in input order. One Cmd+Z undoes one `add`, and no `addKey` appears in `:excalidraw/elements-json`.
    - After a close and reopen, the old scene object throws and `scene(uid)` returns a new one.
    - `whenOpen` on a drawing visible on the current page opens it without navigating.
52. **Svy probe (replaces the blob import).** A blob `import()` of `src/model/legacy.js` fails on its relative `./edn.js` import. Use this instead:
    - `npm run build:legacy-probe` bundles `legacy.js` + `edn.js` with esbuild (build-time only) into `.tmp/legacy-probe.js`. That file is an IIFE; it is git-ignored and never shipped.
    - Run it through CDP `Runtime.evaluate` in the Svy window. It calls only `data.q` with `LEGACY_QUERY` (item 18), returns `{summary, rows}`, leaves no global behind, and writes nothing.
    - Expected on Svy: mentions 9, excluded 1 (`sketching`, `component-code`), drawings 8, empty 2. A different count is a finding to report to the user, not something to fix in the parser.
    - The STOP before any Migrate on Svy stands.
