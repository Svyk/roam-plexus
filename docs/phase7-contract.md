# Plexus Phase 7: Quiet regions (binding)

Repo `~/roam-plexus`, HEAD `c515b3d` (code 0.6.1, `95c2f6d`). Target 0.7.0, plus Compass 0.3.0 in `~/roam-compass` (HEAD `5276d4a`, 0.2.1).

Scope and designs: [`roadmap-next.md`](roadmap-next.md) §2 (the caption decision, changes 1-9) and §5 P7 (DATA-5, REF-1, REF-15, REF-2, REF-17, REF-3, REF-6, UX-4, EXP-1, plus the P7 live gate). Those sections are binding; this contract adds the measured facts, the exact names, and the file ownership.

Earlier contracts still bind anything not changed here. Roam rules: `~/.claude/skills/roam-plugin-dev/SKILL.md` §(d). The usual constraints apply:
- zero runtime deps, plain JS, `node --test` with hand-rolled fakes (no jsdom);
- log prefix `[plexus]`;
- never throw into Roam;
- everything added is removed on unload.

## Measured facts (2026-09-29, Readwisenotes window `1929…`, trusted CDP)

- **DATA-5, Excalidraw version.** Roam's `app-excalidraw.js` embeds `PKG_VERSION:"0.18.0"` (7.7 MB bundle).
- **DATA-5, view state.** With the drawing open, none of these changed `:edit/time`, `:excalidraw/state-json` or `:excalidraw/elements-json` of the drawing block after a 3 s wait: pan (`scrollX` +200), zoom (×0.8), selection, theme dark/light, `frameRendering.name` toggle, `exportScale` 3. Closing the full-screen editor with no edits also leaves `:edit/time` unchanged. View operations are therefore write-free.
- **DATA-5, native actions.** Roam's 0.18.0 has 93 actions. Present:
  - `searchMenu`, `stats`, `wrapSelectionInFrame`
  - `copyAsPng`, `copyAsSvg`, `copyElementLink`, `linkToElement`
  - `cropEditor`, `changeExportScale`, `exportWithDarkMode`
  - `toggleElementLock`, `unlockAllElements`
  - `gridMode`, `objectsSnapMode`, `zenMode`, `viewMode`
  - `changeArrowType` (elbow arrows)
  - `setEmbeddableAsActiveTool`, `setFrameAsActiveTool`
  - `selectAllElementsInFrame`, `removeAllElementsFromFrame`, `updateFrameRendering`
  - `zoomToFit`, `zoomToFitSelection`, `zoomToFitSelectionInViewport`
  - `toggleTheme`, `toggleShortcuts`, `hyperlink`

  The laser tool works: `app.setActiveTool({type: "laser"})` then reads back `"laser"`. `scrollToContent(target, {fitToContent, animate})` exists; `animate` defaults to true for element-link targets. There is no shape-switch action.
- **REF-3, alias DOM.**
  - `[Site 12](((a9jeT2IqV)))` renders `span.bp3-popover-wrapper > span.bp3-popover-target > a.rm-alias.rm-alias--block[data-link-uid="a9jeT2IqV"]`, followed by Roam's footnote ref count, `span.rm-reference-footnote > sup.rm-block__ref-count-footnote`.
  - A page alias is `a.rm-alias.rm-alias--page[data-link-uid]`.
  - Roam wraps block aliases in its own hover popover target, so a region alias must stop `mouseover`/`mouseout` propagation on the anchor (the 0.6.0 tooltip lesson) to keep Roam's alias popover from competing with the crop hover.
- **Caption fallbacks.** They sit at `src/actions.js` lines 312, 315, 318, 386 (`"Frame"` / `"Region"` after `captionRefsFromElements`), 422, 426 (`"Image region"`), 458 (`"Image crop"`), 547, 551 (`"Image region"`) and 677 (`frame.name || "Frame"`). `serializeRegion` omits an empty tail (`src/model/region.js:198-199`).
- **Compass.** `drawingTitle` (`~/roam-compass/src/model/text.js:201-211`) returns the region caption or "Region". Its `view/overlay.js:14` already reads `window.RoamPlexus`.

## Names (shared by all units)

- **Settings** (src/settings.js, owned by M):

  | id | default | `readSettings` key | values |
  |---|---|---|---|
  | `caption-display` | `"written"` | `captionDisplay` | `written` / `always` / `never` |
  | `caption-mode` | `"auto"` | `captionMode` | `auto` / `ask` / `none` |
  | `pin-size` | `"8"` | `pinSize` | `4` / `8` / `12` |
  | `number-pins` | `false` | `numberPins` | boolean |

  All four go in the Depot panel and the Region settings dialog.
- **`ref-overrides`** becomes an object map `{"blockUid|refUid": {mode?, caption?: "hide"|"show"}}`.
  - `parseOverrides` accepts the 0.6.x string form (`"link"` → `{mode: "link"}`) and the object form, and drops invalid entries.
  - `withOverride(map, blockUid, refUid, patch|null)` merges `patch` into the entry. A `null` field removes that field, and an empty entry is deleted.
  - `resolveDisplay` reads `override?.mode ?? override` (the string form).
  - Add `resolveCaption({captionDisplay, override, context})`: `"hide"`, `"show"` or `"written"`.
- **`src/model/label.js`** (new, owned by M): `regionLabel({kind, caption, drawingTitle, imageAlt})`.
  - It returns the plain caption text if it is non-empty, with refs and markup stripped the way Compass `plainText` does.
  - For image kinds with an `imageAlt`, it returns the alt text.
  - Otherwise it returns `${drawingTitle} · ${kindWord}`, where `kindWord` is `area`, `group`, `frame`, `clipped frame`, `lasso`, `image area`, `image lasso` or `crop`.
  - `drawingTitleOf(drawingBlockString, pageTitle)` returns the page title when the drawing is a top-level block on a page, else the first text of the `Text elements in drawing:` tail, else "Drawing".
  - Also export `imageAltAt(blockString, index)`.
- **Placeholder captions:** exactly `Region`, `Image region`, `Image crop`, `Frame`. For cleanup only: `Frame` counts as a placeholder only when the frame has no name.
- **API:** `RoamPlexus.apiVersion` becomes 3. `regionsOf(uid)` entries become `{uid, kind, caption, label}`. `label` is additive.

## Units and file ownership (parallel; nobody runs `npm run check`/`npm test`/build, only targeted `node --test` files)

| Unit | Owns | Items |
|---|---|---|
| M (model) | `src/model/label.js` (new), `src/model/caption.js`, `src/model/refdisplay.js`, `src/settings.js`, their tests | REF-1 labels + override migration, REF-15 (visual order, container labels first, drop numeric/single-char/arrow tokens, 60 chars, " · ", 0.6.1 source refs first), the new settings |
| A (actions) | `src/actions.js`, `src/host/roam.js`, `test/actions*.test.js`, `test/host-roam*.test.js` | REF-1: fallbacks become `""` (or the frame name). Cleanup: `captionCleanupDryRun()`, `applyCaptionCleanup(report)` and `undoCaptionCleanup()`, with an in-memory before/after string report, string-only `updateRegionString` under the drawing lock, and exact matches only. `nameRegion(regionUid, text)`. REF-2: whole-image (≥ 0.98 of the image area) makes no region, copies `((imageBlockUid))` and toasts; Alt forces a region; a drawing image element picked whole becomes an `area` region of that element. REF-17 action side: `createPinRegion({...point})` feeds `finishCreate` with the prompt text. EXP-1 action side: `copyCropPng(regionUid)` (`ClipboardItem` with a Promise-valued blob, created synchronously), `copyCropSvg`, `downloadCrop`, `insertCropImage` (`file.upload`, then one sibling block). REF-6: `refreshAfterClose(drawingUid, mountHash)` polls `host.drawing(uid).hash` for 3 s and re-claims only when it changed. |
| V (view) | `src/view/regionref.js`, `src/view/discover.js`, `src/view/crop-popover.js`, `test/view-regionref*.test.js`, `test/view-discover.test.js`, the `/* == p7:view == */` CSS marker | Caption display: a `plexus-caption-hidden` class on the card (font-size 0 on the ref, restored on `.plexus-root`; checked against the popover-target host marker). Link-mode derived label. UX-4: `role=img`, `aria-label`/`alt`, `tabindex`, Enter/Space opens, Shift+Enter opens the sidebar. REF-3: claim `a.rm-alias.rm-alias--block[data-link-uid]` whose target is a supported region, with crop hover, capture click opening the region, Shift left to Roam, and `mouseover`/`mouseout` stoppers on the anchor. |
| P (prompt + tool) | `src/view/caption-prompt.js` (new), `src/view/image-region-tool.js`, `src/view/context-menus.js`, `src/view/settings-dialog.js`, their tests, the `/* == p7:prompt == */` CSS marker | REF-17: a click (< 4 px) in the image tool drops a pin sized by `pinSize` and opens the caption prompt (the plexus-mm-input style input with the suggest auto-attach). Enter writes, Esc writes an empty tail, and `numberPins` pre-fills the next number. Menu items: "Plexus: Name region", "Plexus: Hide caption" / "Show caption", "Plexus: Copy crop as PNG" / "Copy crop as SVG" / "Download crop" / "Insert crop as image block", "Plexus: Copy alias" (on block-ref and region-block menus). `caption-mode: ask` uses the same prompt. The dialog gains the four settings. |
| C (API + Compass) | `src/api.js`, `test/api.test.js`, `docs/spec-plexus.md` §8 and §13, and all of `~/roam-compass` | `regionsOf` gains `label` (via `regionLabel`), `apiVersion` goes to 3, and spec §8 is updated. The DATA-5 results above go into spec §13. Compass: when `window.RoamPlexus?.regionsOf` exists, a region node's text is the matching entry's `label`, with the owner drawing resolved through the region's parent container. Otherwise it is "Region" as today. Compass tests, its version to 0.3.0, and its CHANGELOG. |
| I (integration, after the others) | `src/extension.js`, `test/extension.test.js`, `package.json`, `CHANGELOG.md`, CSS merge | Wire REF-6 (remember the mount hash, call `refreshAfterClose` on unmount), the alias discovery, the command-palette entries ("Plexus: Clear placeholder captions (dry run)" and "Plexus: Undo caption cleanup"), and the settings panel. Version 0.7.0. `npm run check` green in both repos. |

## Gate

The roadmap-next P7 live gate, items 1-12. Item 11 (encrypted graph) is a **STOP gate**: the orchestrator asks the owner before any read-only check. Without approval, the release notes say encrypted behavior is inferred.

## Amendments (critic, binding)

These override the body where they conflict. Code references are to `c515b3d`.

### M

A1. `regionLabel({kind, caption, drawingTitle, imageAlt, resolveBlock})`. Caption to plain text: `[[T]]`, `#[[T]]` and `#T` become `T`; an alias `[x](…)` becomes `x`; `![alt](url)` becomes `alt`; `{{…}}` macros are dropped; `((uid))` becomes the first 40 characters of the plain text of `resolveBlock(uid)`, or is dropped when there is no resolver, the block is missing or it is itself a macro. Never emit Compass's `(( ))` placeholder: a 0.6.1 caption made only of refs would otherwise label as `(( )) ; (( ))`. Collapse the separators ` ; ` and ` · ` and trim them from both ends. An empty result falls through to `imageAlt` and then to the derived form. Output is capped at 80 characters, cut at a word boundary with `…` (display only). The function never throws; bad input returns `"Region"`. Kind words: area→`area`, group→`group`, frame→`frame`, cframe→`clipped frame`, rect→`crop`, poly→`lasso`, imgrect→`image area`, imgpoly→`image lasso`, anything else→`region`. `imageAlt` applies to imgrect and imgpoly only (the `IMAGE_KINDS` set). rect and poly live in drawings and have no alt text.
A2. `drawingTitleOf(ownerString, pageTitle)`. The caller passes `pageTitle` only when the owner is a direct child of a page (see A12, `host.labelSource`). Order: the trimmed `pageTitle`; else, for an `{{[[excalidraw]]}}` owner, the plain text of the first `;` item of `{{-: Text elements in drawing: …}}`; else, for a non-drawing owner (the image block of an imgrect), its plain text with image markdown removed, falling back to `"Image"`. A drawing with nothing falls back to `"Drawing"`. Max 40 characters, and no `Drawing: ` prefix (that prefix stays Compass's). `imageAltAt(s, i)` is `parseImageRefs(s).find((r) => r.index === i)?.alt.trim() || null`.
A3. REF-15 changes `captionRefsInfo(elements, ids, {frameName, words = true} = {})` and `captionRefsFromElements(elements, ids, opts)` in place, with the same names and return shape, so the creators and relink share one algorithm. `captionFromElements` is unchanged.
   - Parts, in order: source refs; then, for frame and cframe, the frame name. A non-empty `frameName` means the caption is the refs plus that name only, matching §2's table ("Frame or cframe: frame name"). With no frame name, bound-text labels follow, then free text.
   - Visual order within each group: sort by y-centre. A new row starts when the y-centre exceeds the row's first y-centre by more than half the median part height. Within a row, sort by x. Bound text uses its container's box. Use no pairwise "same row" comparator, because it would not be transitive.
   - A text part is cut at its first sentence end (`. `, `? `, `! `).
   - Drop parts that are only digits and punctuation, a single character, or only arrow glyphs (`→ ← ↑ ↓ ↔ ⇒ -> =>`). Exception: if every text part would drop, keep the numeric ones, so a swab site labelled "12" is not lost.
   - Refs are never cut and do not count toward the 60-character word budget. Word parts are appended while the words alone total ≤ 60 characters. The first word part that does not fit is cut at a word boundary, with no ellipsis stored; later parts are dropped. Join with ` · `. The 200-character total cap and the dedupe stay.
   - `words: false` returns the refs only (used by caption-mode `none`, A15).
A4. Overrides.
   - `parseOverrides` maps a string holding a valid mode to `{mode}`. An object keeps only `mode ∈ DISPLAY_MODES` and `caption ∈ {"hide","show"}`, and an entry with no valid field is dropped.
   - `withOverride(map, b, r, patch|null)`: `null` deletes the whole entry. A patch field set to `null` deletes that field, and an entry left empty is deleted. The touched key is re-inserted at the end, keeping the P6 recency rule.
   - New `serializeOverrides(map)`: a mode-only entry is written back as its bare string and the object form is used only when `caption` is set. A rollback to 0.6.x then loses caption overrides only, not the mode overrides, which is better than the §2 "known cost".
   - `resolveDisplay` reads `typeof override === "string" ? override : override?.mode`, so a caption-only object never reaches `DISPLAY_MODES.includes`.
A5. `resolveCaption({captionDisplay, override, context})`: context `"home"` returns `"written"`, meaning never hide or add text on the region's own bullet. Otherwise `override.caption` wins (`"hide"` / `"show"`). Otherwise `never`→`"hide"`, `always`→`"show"`, and `written` or anything invalid→`"written"`. The function does not look at the display mode; link mode is handled in V (A20).
A6. `settings.js`.
   - `SETTING_IDS` gains `captionDisplay: "caption-display"`, `captionMode: "caption-mode"`, `pinSize: "pin-size"` and `numberPins: "number-pins"`.
   - `readSettings` normalizes unknown values to the defaults. `pinSize` is the Number 4, 8 or 12, else 8.
   - Depot panel: selects with the items `["written","always","never"]`, `["auto","ask","none"]` and `["4","8","12"]`, and a switch for `number-pins`. Only `caption-display` uses `wrap` (repaint); the other three need no repaint. The caption-mode description says `none` "stores no words; links to source blocks are still stored".
   - `setRefOverride(extensionAPI, b, r, patch)`: a string `m` means `{mode: m}` and `null` means `{mode: null}`, so the existing "Use default display" call keeps a caption override. Writes go through `serializeOverrides`.

### A

A7. Image-tool result, shared with P (A24). The tool resolves one of:
   - `null`;
   - `{kind: "rect", f, altKey}`;
   - `{kind: "lasso", p, altKey}`;
   - `{kind: "pin", x, y}`.

   All values are displayed-box fractions, and `altKey` means Alt was held at `pointerup`. A converts rect and lasso through `displayedToNatural`, and every `Array.isArray(picked)` branch goes.
A8. REF-2. A pick is "whole" only for `kind: "rect"` with `f[2] * f[3] >= 0.98` and `!altKey`. Alt already starts a lasso at `pointerdown` (`image-region-tool.js:73`), so a lasso or a pin never counts as whole.
   - Image block: create no block; call `clipboard.writeText("((imageBlockUid))")` through `withClipboard`; toast "Whole image: copied the image block ref. Hold Alt while releasing to make a region."
   - Drawing image element: create an `area` region `{ids: [element.id], pad: 0}` with its auto caption.
   - The roadmap's "area ≈ scene bounds → `((drawingUid))`" case is deferred to P8. It has no gate item, and toolbar or palette clicks carry no Alt. The CHANGELOG says so.
A9. The caption prompt is injected as `createActions({openPrompt})`, which is P's `openCaptionPrompt` wired by I. `actions.js` never imports `caption-prompt.js`, so A's tests do not depend on P's file existing.
   - `openPrompt` resolves a string (write) or `null` (create nothing).
   - The open prompt is held like `activeTool`: `cancelDrawingTool()` and `dispose()` cancel it, with no write.
   - The prompt runs before `hotSvg`, because the capture changes the Excalidraw selection.
A10. Pins. `createPinRegion({element | imageRect, point, drawingUid, …})` builds a square whose side is `pinSize`% of the shorter displayed side, centred on the point and shifted (not shrunk) to stay inside the image. The kind is `rect` in a drawing and `imgrect` on an image block.
   - Pins always prompt, whatever the caption mode.
   - With `numberPins` on, `initial` is 1 + the largest leading integer (`/^\s*(\d+)\b/` on the plain caption) among the same image's regions. That means rect and poly regions with the same `el`, or imgrect and imgpoly regions with the same `i`. The caret goes at the end with nothing selected, so typing appends. Enter on a deleted number writes an empty tail.
A11. Head-preserving writes. `nameRegion`, `applyCaptionCleanup` and the undo never re-serialize. The new string is the exact current `{{[[plexus-region]]: …}}` head plus `" " + tail`, or the bare head when the tail is empty. Before writing, check that `parseRegion(next)` is supported, `geometryKey` is unchanged, and `caption` equals the tail with whitespace collapsed and trimmed.
   - `nameRegion(uid, text)` refuses unsupported regions and does nothing when the text is unchanged. After a write it emits `change` and calls `refreshRegion(uid, {purge: false})`.
   - A `serializeRegion` round trip (the relink approach) would reject or reorder heads whose tokens are not in canonical order.
A12. `host.labelSource(uid)` returns `{string, pageTitle}`, where `pageTitle` is non-null only when the direct parent is a page (pull `[:block/string {:block/_children [:node/title]}]`). It returns `null` for a missing block. V and C call it as `host.labelSource?.(…)`.
A13. Cleanup candidates. A region qualifies when it is supported and its trimmed caption is a placeholder for its kind:

   | Placeholder | Kinds |
   |---|---|
   | `Region` | area, group, frame, cframe |
   | `Frame` | frame, cframe |
   | `Image region` | rect, poly, imgrect, imgpoly |
   | `Image crop` | rect |

   Skipped rows are listed with a reason:
   - frame kinds whose frame element is missing;
   - frame kinds whose current `frame.name` equals the caption (a frame really named "Frame" or "Region");
   - drawing kinds whose current auto caption over the region's ids equals the caption (a real text element that reads "Region").

   Candidates are found container-first: the children of blocks whose string is exactly `{{[[plexus-regions]]}}`.
A14. Cleanup apply and undo.
   - Apply re-pulls each block and writes only if its string still equals `before`. Writes are sequential through `updateRegionString` (the lock is the region's `d`) and stop at the first failure. The result is `{changed, skipped, failed}` with before and after strings, and one `change` is emitted per changed region.
   - Undo restores `before` only where the current string equals `after`. There is one undo slot (the last apply), cleared after an undo; with none, toast "Nothing to undo".
   - UI: new `src/view/cleanup-dialog.js` plus a test, owned by A and modelled on `legacy-dialog.js`. It has Copy report (JSON), Apply N behind `confirm()` naming the graph and N, and Close. No unit owned this surface.
A15. Creator captions by mode:
   - `auto`: `captionRefsFromElements(…, {frameName})` for drawing kinds and `""` for image kinds.
   - `ask`: the prompt pre-filled with that text, fully selected; escape is "empty".
   - `none`: `captionRefsFromElements(…, {words: false})`.
   - "Plexus: Create image region", "Region on image" and "Region from crop" follow the same modes (their auto text is `""`).
A16. Relink. `regionCaptionCandidate` offers the item only when the planned ref set (`((uid))` and `[[title]]` tokens) contains a ref missing from the current caption. Format-only differences (0.6.1 ` ; ` against REF-15 ` · `) never re-offer "Link caption" on already-linked regions.
A17. EXP-1.
   - Synchronous up to the write: `copyCropPng` and `copyCropSvg` do only synchronous work (`pullBlock`, `parseRegion`, `resolveRegionTarget`, key computation) and then call `clipboard.write([new ClipboardItem({type: promise})])` before any `await`. They are not wrapped in `native.withClipboard`, which queues behind captures. `once()` is fine because it calls `fn` synchronously.
   - Busy guard: while a hot capture is installed, its stub (`native.js:78-84`) silently swallows a PNG item and treats an SVG text item as the capture result. So refuse with the toast "Busy capturing a crop, try again". A gets one new export, `clipboardBusy()`, in `src/host/native.js` (plus `test/host-native.test.js`). It is true from `captureSelectionSvg` entry until its `finally` restores the clipboard, including the grace period.
   - No `ClipboardItem` or `clipboard.write`: toast that copying is not supported here.
   - Test seams: `ClipboardItemCtor`, `rasterize`, `urls` and `upload`. Tests assert the write happened synchronously, with no awaits.
   - PNG source order:
     1. a memory SVG rasterized at 2×;
     2. a memory or IndexedDB PNG;
     3. an IndexedDB SVG;
     4. `renderRegionCrop` at 1×, with the toast "Copied at 1×; open the drawing for a sharper copy".

     Keys are exactly regionref's `keysFor` (an SVG key only when `!target.url`).
   - Rasterize with `<img>` + `decode()` + a canvas at 2× `svgSize`, not `createImageBitmap`, which cannot decode SVG blobs in Chrome.
   - An SVG that has any `href` other than `data:` or `#…` goes to the PNG path, because SVG-as-image loads no external resources and would paste blank images.
   - Read the blob from the entry URL at once, since the LRU can revoke it, and fall through on failure. The copy is the cached pixels with no dark invert; "as shown" is out of P7.
A18. `copyCropSvg`, `downloadCrop`, `insertCropImage`, `copyAlias`.
   - `copyCropSvg`: writes `text/plain` (the markup), plus `image/svg+xml` only when `ClipboardItem.supports?.("image/svg+xml")`. Drawing kinds only. With no SVG anywhere, toast "Open the drawing to copy as SVG".
   - `downloadCrop`: the A17 PNG; the file name is the label with `[^\w .-]` removed, at most 60 characters, falling back to `plexus-crop`, plus `.png`. The object URL is revoked after the click.
   - `insertCropImage(regionUid, blockUid)`: `file.upload({file: new File([png], name, {type: "image/png"})})`, accepting either a returned URL or markdown. Then exactly one `block.create` under blockUid's parent at its order + 1, with `![label](url)` where the label has `[]()` stripped. It refuses a blockUid inside a `{{[[plexus-regions]]}}` container. On `host.isEncrypted()` it refuses with the toast "Insert crop is not available on encrypted graphs yet": `file.upload` on encrypted graphs is unverified and could upload plaintext, and gate 11 is read-only.
   - `copyAlias(uid)`: writes `[label](((uid)))` with `writeText`; the label has `[]()` stripped and falls back to `Region`.
A19. `refreshAfterClose(drawingUid, mountHash)`.
   - Poll `host.drawing(uid)?.hash ?? ""` every 150 ms for up to 3 s, tracking the last hash refreshed.
   - One poll per drawing: a newer call replaces the older one. Stop when disposed, or when that drawing's editor mounts again (the hot path owns it then).
   - On each new hash within the window, call `refreshRegion(r, {purge: false})` for each `host.regionsOf(uid)` region; the poll runs the whole window and returns the total count. Roam saves props about 754 ms after a change, so the first hash change can be an intermediate save. A new hash means new keys, and the default purge would only delete fresh entries rendered meanwhile. An unchanged hash means no work, which DATA-5 shows is the no-edit close.
   - No hot capture before close in P7.

### V

A20. Caption display.
   - Image and thumbnail modes, with a `refEl`: `"hide"` adds `plexus-caption-hidden` to the card. `"show"` with an empty tail appends `span.plexus-root.plexus-caption-derived` holding the label after the root, inside the card. `"written"` adds nothing.
   - Link mode never hides. An empty tail appends `span.plexus-root.plexus-ref-label` holding the label after the glyph; a non-empty tail is Roam's text as today.
   - Home context: nothing.
   - Override lookup is per field: `mode` and `caption` each come from the first of the blockUid and outerUid entries that has that field. Today's `??` lets a caption-only entry shadow an outer mode.
   - Every added span or class lives in `info` and is removed by `unclaim` and `releaseAll`.
   - Export `captionStateOf({blockUid, refUid})` → `"hide" | "show" | "written"`, shaped like `modeOf`, for P's menus.
A21. Hiding CSS (under `/* == p7:view == */`). Before adding the class, read `getComputedStyle(refEl).fontSize`, guarding a missing `defaultView`, and set it inline on the root and on any derived span. The card's `0.85em` cannot be restored from inside a `font-size: 0` parent.
   - `.plexus-caption-hidden { font-size: 0 }`.
   - `.plexus-caption-hidden .plexus-root { font-size: 14px }` as the fallback.
   - Zero `padding`, `margin`, `border` and `background` for `.rm-page-ref`, `.rm-block-ref`, `.rm-page-ref--tag`, `.rm-reference-footnote` and `sup` inside `.plexus-caption-hidden`. `img:not(.plexus-crop)` there gets `display: none`.

   Otherwise the nested 0.6.1 `((ref))` spans, tags and footnotes of a hidden caption leave padded or underlined stubs.
A22. Label and UX-4.
   - Per claim, `label = regionLabel({kind, caption, drawingTitle: drawingTitleOf(src.string, src.pageTitle), imageAlt: isImageKind(kind) ? imageAltAt(src.string, region.i) : null, resolveBlock: (u) => host.pullBlock(u)?.string})`, where `src = host.labelSource?.(region.drawingUid) ?? {string: "", pageTitle: null}`. Wrap it in try/catch with the fallback `"Region"`.
   - `root.title` = label.
   - For supported regions: `role="img"`, `aria-label` = label and `tabindex="0"`; `img alt` = label. Chips get none of these, because their text is already readable.
   - Keydown on the root: Enter or Space with no Ctrl, Meta or Alt, and not composing, calls `preventDefault` and `stopPropagation`, then `onOpen(uid, {sidebar: openInSidebar !== shiftKey})`, the same XOR as the click. Other keys pass. No roving focus in P7.
A23. Aliases.
   - `classifyAddedNode` adds `aliases` (a class check, then `getElementsByClassName("rm-alias--block")`); `scanExisting` includes them; the new option is `createDiscovery({onAlias})`.
   - Renderer: `claimAlias(anchor)` skips `.plexus-offscreen` and `.plexus-root`, page aliases, and anchors already marked `data-plexus-alias`. The uid is `anchor.dataset.linkUid`.
   - Non-region targets are remembered in a `WeakSet`, with no attribute written on Roam's anchor.
   - Region targets get `data-plexus-alias="1"` and `hoverOn` with target and keys resolved at hover time, not claim time, so a REF-6 hash change never shows a stale memory crop. They also get the `mouseover`/`mouseout` stoppers.
   - Capture `mousedown` and `click` act only for the primary button with no Shift, Ctrl, Meta or Alt. Each first re-checks that the uid is still a supported region (if not, Roam keeps the event), then calls `preventDefault` and `stopPropagation` and `onOpen(uid, {sidebar: openInSidebar})`.
   - Alias claims join the prune and `releaseAll` path (which removes the attribute and listeners), and `refreshRegion(uid)` also reclaims them.

### P

A24. Image tool (`image-region-tool.js`).
   - Emit the A7 shapes. Check for a pin first: total movement under 4 px is a pin, even with Alt held.
   - Do not remove the overlay in `finish()`. Keep it swallowing `mouseup` and `click`, and remove it on the trailing `click` or 50 ms after `pointerup`, whichever comes first. Otherwise a pin click on an image block can fall through to Roam, which puts the block into edit mode, steals focus and commits the prompt at once.
A25. `src/view/caption-prompt.js` exports `openCaptionPrompt({doc, rect, initial = "", select = false, escape, zIndex}) → Promise<string|null>`, with `promise.cancel()`. `escape` is `"empty"` or `"cancel"`.
   - The input has the classes `plexus-portal plexus-mm-input plexus-caption-prompt`, which the suggest auto-attach selector needs.
   - It opens on the next frame, then focuses.
   - Enter (not composing) resolves the raw value. The suggest's capture keydown handles its own Enter and Esc first.
   - Esc resolves `""` or `null` according to `escape`.
   - Blur resolves the value, except that blurs in the first 200 ms after open and blurs into `.plexus-suggest` are ignored. Roam's menu close and the tool's trailing click would otherwise commit an empty prompt.
   - `cancel()` resolves `null`. Only one prompt is open at a time: opening another commits the first, as on blur.
   - Stop propagation of the mind map's isolated event set. Copy the list; do not edit `mindmap.js`.
   - Escape per use: pins and ask mode use `"empty"`. Name region uses `"cancel"`, so Esc never erases an existing caption; clearing a caption is an empty input plus Enter.
A26. Menus.
   - Overrides are written as patches:
     - Show as X → `{mode: X}`.
     - Use default display → `{mode: null}`, shown only when `overrides[key]?.mode` is set; today's `key in overrides` would show it for caption-only entries.
     - Hide caption → `{caption: "hide"}`, shown when the mode is not link and `captionStateOf` is not `"hide"`.
     - Show caption → `{caption: "show"}`, shown when `captionStateOf` is `"hide"`.
   - The EXP-1 callbacks call the action with no `await` before it (A17).
   - Block-ref menu: Name region, Hide or Show caption, Copy crop as PNG, Copy crop as SVG (drawing kinds only), Download crop, Insert crop as image block, and Copy alias.
   - Region-block menu: the same without Hide/Show caption and without Insert, whose sibling would land inside the regions container.
   - Insert is hidden when `host.isEncrypted()`.
   - Name region: the prompt anchors to the ref element under the block, else the block's `[id^="block-input-"]` element, else the top centre of the viewport. `initial` is the current raw caption and `escape` is `"cancel"`. Then call `actions.nameRegion` and `refreshRegion(uid, {purge: false})`.
A27. Settings dialog.
   - Generalize `select` to option lists (today `stored()` coerces every select to link or thumbnail).
   - Add Caption under crops (When written / Always / Never), Caption mode (Auto / Ask / None), Pin size (4% / 8% / 12%, stored as `"4"` / `"8"` / `"12"`) and Number pins (a checkbox).
   - Unknown stored values show the default.

### C

A28. `api.regionsOf(uid)` calls `host.labelSource?.(uid)` once per call and computes each `label` with the A22 formula. A throw gives `label: "Region"`; unsupported kinds use the kind word `region`. The existing fields are unchanged. `apiVersion` and the `roam-plexus:ready` / `unload` event details are 3.
A29. Compass.
   - Owner lookup: take the owner uid from the region string's `d=` token, which is what `host.regionsOf` keys on, not from parent pulls. A region moved out of its container is not in `regionsOf` either way.
   - Call `RoamPlexus.regionsOf` at most once per owner per neighbourhood build, through an optional pure-model resolver `regionLabel(uid, string) → string|null` used by the node titles, the outline rows and the centre title.
   - Accept only `typeof entry.label === "string" && entry.label.trim()`. A throw, a missing entry or a v2 entry falls back to `drawingTitle` unchanged. Truncate to that call site's `max`.
   - With Plexus unloaded, the existing unload repull already runs after `delete window.RoamPlexus`.
   - Tests: loaded → label, unloaded → "Region", and a v2 entry without `label` → "Region".
A30. C is the only unit in `~/roam-compass` and may run its `npm run check` there, never in roam-plexus. In spec §13, DATA-5 probes the contract did not re-measure (`frameRendering` persistence through Roam's save, `searchMatches`, flowchart keys) are recorded as "not re-measured in P7" with their earlier source, not guessed.

### I

A31. REF-6 wiring. At mount, set `mounted.hash = host.drawing(uid)?.hash ?? ""`. `unmountEditor({unloading})` calls `actions.refreshAfterClose(uid, hash)` only when not unloading. The lifecycle-registered disposer passes `unloading: true`, because LIFO disposal runs `unmountEditor` (`extension.js:236`) before `actions.dispose` (`:146`), which would start a 3 s poll during unload.
A32. Wiring:
   - `openPrompt: openCaptionPrompt` into both `createActions` and `installRoamMenus`, along with `clipboard` and `isEncrypted`;
   - `onAlias: (a) => regionref.claimAlias(a)` into discovery;
   - "Plexus: Clear placeholder captions (dry run)" → `actions.captionCleanupDryRun`;
   - "Plexus: Undo caption cleanup" → `actions.undoCaptionCleanup`.

   The Depot panel entries come from M; `extension.js` adds none.
A33. CSS. Before fan-out the orchestrator appends the empty `/* == p7:view == */` and `/* == p7:prompt == */` markers to `src/extension.css`. V and P edit only with an exact-string Edit under their own marker and never Write the file (P6 A6). I builds and confirms that the root `extension.css` carries both blocks.

### Gate

A34. Order: M lands first with its tests green. A, V, P and C then run in parallel, coding against the names above and faking one another in tests. I runs last. Only M's modules are imported across units; A gets P's prompt by injection (A9).
A35. Added live checks (Readwisenotes; CDP with the Roam window focused, since `clipboard.write` rejects an unfocused document):
   - (a) A plain click on a region alias opens it zoomed and does not also navigate Roam; the URL and main-window block are unchanged. Shift-click and Ctrl/Cmd-click are Roam's.
   - (b) A pin on an image in a Roam block does not enter block edit mode, and the prompt keeps focus.
   - (c) Name region from both menus keeps focus after the menu closes, and Esc leaves the caption byte-for-byte unchanged.
   - (d) A hidden caption holding `((ref))`, `[[page]]` and `#tag` leaves no visible stubs.
   - (e) Copy crop as PNG of a hot text crop pastes in Excalidraw's hand-drawn font, and a region over a drawing image pastes with the image, not blank.
   - (f) Download crop saves a file in Roam Desktop.
   - (g) On the encrypted graph during gate 11 (read-only observation), Insert crop is absent. The release notes say so.
   - (h) The typing bench stays +0 with 20 region aliases on the page.
