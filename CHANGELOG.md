# Changelog

All notable changes to this project follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.10.0]

- Outline dock (NAV-7): a toolbar "Outline" toggle, Alt+Shift+O, and command-list rows "Toggle outline dock" and "Outline dock: show parent". The dock lists the drawing block's direct children (or its parent's), each in its own Roam editor, beside the full-screen canvas, which is narrowed by the dock width. Width is dragged from the left edge and kept in the `dock-width` setting (240-640, not in the settings dialog). Open state is remembered like the regions layer: a new mount reopens it, the close button clears it. Esc leaves editing, keeps the canvas selection, and leaves no Roam block selection. A footer "+ Add a block" adds a child.
- Drops onto the canvas (AUTH-2): drag a bullet from the main outline, the dock or (once the editor is closed) the sidebar onto the drawing. No modifier places embeds, Alt links, Shift plain labels ("Placed n labels"); a chip near the pointer names the mode. The dock header drags its page or block ref. Dropping the open drawing on itself is refused. File and library drops are untouched. One undo step, same caps as "Place on drawing".
- Clickable tokens in canvas text (NAV-1): Cmd-click (Ctrl-click off macOS) on `[[page]]`, `#tag`, `((block))` or `[label]([[Page]])` opens it; Shift opens it in the sidebar. Text with one link opens it, with several offers a chooser. Element links win over tokens; code, URLs and `{{...}}` are not scanned. Missing pages or blocks toast instead of navigating.
- Dock behaviour, measured live: a top-level dock block cannot be outdented with Shift+Tab (each top-level bullet is its own Roam render root, like a zoomed page). Esc with a Roam menu open ends editing, as Roam does elsewhere. Plain or Shift clicks on links inside the dock navigate like canvas links (minimize first; Shift opens the sidebar) instead of Roam's raw navigation, which would destroy the editor; Cmd/Ctrl/Alt clicks are left alone. Roam undo and redo (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, Ctrl+Y off macOS) work in dock blocks. With the dock open the toolbar wraps to two rows instead of running past the canvas.
- Tag grammar follows Roam: `word#tag` is a tag, and a trailing dot stays in the tag name (`#tag.` is the page `tag.`).
- No new command-palette entries.
- Not supported: Backspace/Delete on blocks selected in the dock does nothing (the dock swallows keys while it owns a selection, so blocks and canvas elements are never deleted together). Dragging from the right sidebar onto the canvas is not possible while drawing full-screen, because the editor covers the sidebar; the dock is the drag source. The label drag in the dock header may be blocked by its `mousedown` preventDefault in Chrome (unverified).
- Moved to Later: token hover preview.
- Unverified live: the N6 corpus comparison of `findTokens` against Roam's `renderString`; the real-Roam measurements and X5 checks for tokens; which Escape target (`window` or `document`) clears a dock selection (`dock.escapeVia()`) and whether the dock fell back to overlay mode (`dock.mode()`), both still to record in spec section 13.

## [0.9.0]

- New drawings where you are: `Plexus: New drawing here / below` (block menu), `Plexus: New drawing on this page` (page menu), and the slash command `/Sketch here`. The drawing opens at once. On a daily page it is a plain top-level child after the block's top-level ancestor. Locked against a double invoke. Setting "New drawing page name" (`{date}`, `{page}`, `{n}`).
- Embed picker: `Plexus: Embed page or block...` (toolbar "Embed...", canvas menu, Alt+Shift+E) searches pages and blocks, with natural dates ("tomorrow", "next friday", "Sep 30"), a "Today (always today)" row, and a last row "+ Create page" that writes only on an explicit pick. Shift+Enter on a `[[` or `((` pick inside canvas text drops the embed below that text. The "Related" section appears only when Roam semantic search is on; that call is unverified live.
- `[[` picker in canvas text gained the natural-date and "+ Create page" rows (explicit pick only).
- Live "today" embed (`plexus:today`): re-resolves at local midnight and when the tab wakes; `element.link` keeps the creation date.
- Paste refs: setting "Paste refs as" (text / embed / link). A pasted single `((uid))` or `[[Page]]` becomes an embed or a link node when the target exists; Shift keeps text; multi-line pastes pass through. Pasting an outline as nodes is Later.
- Place many blocks: multi-select menu "Plexus: Place on drawing" puts them in a grid as embeds (up to 30) or links (up to 500), one undo step. With no drawing open the list waits (10 minutes) and the canvas menu offers "Place N blocks here".
- Note cards: `Plexus: New note card` (Alt+Shift+N, toolbar "Note", canvas menu) creates a real block (setting "New note cards go": under the drawing, on the page, or on the daily page) and opens it for editing. Esc or Enter on an untouched card deletes only that block and its anchor.
- Default hotkeys: Alt+Shift+R region, I image region, P present, M mind map, E embed, N note. Hints in the canvas menu and toolbar tooltips; a Shortcuts list in the settings dialog.
- EMB-3 (live query node) is dropped: a query rendered through `renderString` is a static snapshot (measured 2026-09-29). It moves to Later.
- Command palette cut from 23 entries to 2 ("Plexus: Commands..." and "Plexus: Mind map"). Roam's own key handler pays about 0.055 ms per keystroke for every registered palette command, which was the whole typing regression (+1.3 ms per key; with palette registration off Plexus measured 12.4 ms against 12.6 ms unloaded). "Plexus: Commands..." opens a searchable list of all 23 actions with their hotkeys. Alt+Shift+R/I/P/E/N now also work through a document-level guard while a drawing editor is open; Alt+Shift+M stays a Roam hotkey.
- Not measured live: slash and multi-select callback arguments, and whether Roam leaves "/Sketch here" in the block. The code accepts either shape.

## [0.8.0]

- Regions layer: a "Regions" toolbar toggle (and `Plexus: Toggle regions layer`) outlines every drawing region in the open editor with a small caption chip. Click selects the region's elements, Shift-click opens the region block in the sidebar. Image kinds are not drawn; the layer is capped at 150 regions.
- `Plexus: Regions for all frames` creates a frame region for each frame that has none (at most 50 per run).
- `Plexus: Audit regions on this page` and `Plexus: Audit regions in graph` list broken regions in an in-page dialog with Open and Repair.
- Block menu: Select on drawing, Update region from selection, Repair region, Copy region link. Canvas menu: Copy drawing ref, Copy drawing embed, Regions for all frames, Restore before last Plexus change, Select text only, Remove element link.
- Write guard: a Plexus scene write that would remove four fifths or more of a drawing of more than 10 elements is refused with an "Apply anyway" toast. `Plexus: Restore before last Plexus change` undoes the last removing write (five per drawing, kept after the editor closes). Mind-map projection writes are guarded but not snapshotted, because the outline is their source of truth.
- Guard exemptions (only add elements, or write no elements): `addViaPaste` (migration, API `add`), `native.insertElements` (embeds), crop-to-region and the refresh paths. The roadmap's list of these as guarded was wrong.
- Automation API v4: `scene(uid).remove(ids, {force})`. Without `force`, a refused removal throws after the toast.
- Opening a region tweens the view (`Animation`: system / on / off; system follows reduced motion), respects a new "Zoom limit" (100 / 150 / 200), and pushes view history. Toolbar Back and Alt+Left (with nothing selected) return to the previous view. The spotlight is two pulses, or static under reduced motion.
- Setting "Open region links in the drawing": a page navigation to a region block opens the region (fresh load, or a push or replace navigation where the browser has the Navigation API; without it only the fresh-load check lands, never on Back or Forward).
- Crops: 2x PNG tier (`png2x`, plus a dark variant) captured natively when the editor is open, used by Copy crop as PNG and download; hovering a region ref shows a source peek from the cached thumbnail.
- Mind map: pending edits flush on `pagehide` and when the tab is hidden; a pass deferred by a gesture runs after 4 s. Limit: an unload with a native node-text edit still in progress can lose that edit, because Roam gives no unload hook that waits.
- Compass 0.4.0 opens drawing and region nodes through `RoamPlexus.open`.
- View history: only region opens push (Open region, region-link landing, Compass). Presenter slide jumps, Roam link jumps, mind-map arrow pans and API zoomTo do not. "Return to source block" is deferred.
- Crop tiers: hot crops already painted crisp from the svg, and 0.7.0 already rasterized a warm svg at 2x for Copy crop as PNG. The new png2x tiers add an exact dark paint (including regions over images) and a PNG when the svg cannot rasterize. The cold 1x path after a reload is unchanged and is the only path on encrypted graphs, so the "1x cold crops" open item stays open.

## [0.7.0]

- Quiet regions: new regions no longer get a placeholder caption. Captions come from the selection (visual order, container labels first, joined with " · ", 60 characters), or stay empty. Setting "Caption under crops" (written / always / never) plus per-ref "Hide caption" / "Show caption"; "Caption mode" (auto / ask / none).
- Caption cleanup: `Plexus: Clear placeholder captions (dry run)` reports old placeholder captions, applies on confirm, and `Plexus: Undo caption cleanup` restores them.
- Name a region from the right-click menu (`Plexus: Name region`).
- Image regions: a whole-image pick copies the image block ref instead of making a region (Alt forces a region); a click drops a pin (size 4/8/12, optional numbering) and asks for a caption.
- Crops: copy as PNG or SVG, download, insert as an image block, copy alias.
- Block aliases `[label](((uid)))` that point at a region show the crop on hover and open the region on a plain click (Shift, Ctrl and Cmd clicks stay Roam's); region cards are keyboard-operable with an accessible name.
- Crops refresh after the full-screen editor closes when the drawing changed.
- Automation API v3: `regionsOf` entries carry `label`. Compass 0.3.0 uses it.
- Deferred to P8: an area region matching the scene bounds is not converted to a drawing ref.

## [0.6.1]

- Region captions link their source blocks: a region made from a mind-map node, a canvas embed, or an element with a `[[Page]]`/`((ref))` link gets `((uid))`/`[[Title]]` in its caption instead of copied text, so the source block gets a backlink and the caption follows renames. Existing regions: right-click > Extensions > "Plexus: Link caption to source blocks".
- Canvas backlinks: regions and mind-map nodes that are referenced elsewhere show a quiet reference count at their top-right corner; clicking it lists the referencing blocks (click opens, Shift opens in the sidebar). Counts update live. Setting: "Show backlinks on canvas".

## [0.6.0]

- Region refs render as tidy cards by mode (image, thumbnail, link); hovering a thumbnail shows the full crop; crops follow the dark theme.
- `[[` and `((` picker in text elements, the mind-map input and the element hyperlink input.
- Right-click menus: Plexus items on region refs and blocks, plus a Plexus section in the canvas menu; per-ref "Show as link" and "Use default display".
- Region settings dialog (`Plexus: Region settings`); image and thumbnail heights, inline display and dark crops settings replace the max crop height.
- Opening a region zooms to at most 100%.
- `Plexus: Refresh crops for open drawing` re-renders the refs; `actions.refreshCropsForDrawing(uid)` added.

## [0.5.0]

- Legacy drawings: dry-run report of old ExcalDATA drawings (`Plexus: Legacy drawings (dry run)`) and migration into native drawings; the legacy block is never written.
- Automation API v2: scene registry, `whenOpen`, `add`/`update`/`remove`/`exportSvg`.
- Editable embeds: edit a drawing in place from an embed (Edit embed button, F2).
- Editable embeds: Roam autocomplete navigation keys (Esc, arrows, Enter, Tab, ...) now reach Roam while a menu is open, so `[[` menus can be closed and navigated.
- Fix: leaving an editable embed clears the Roam block selection left on the edited blocks, so a later Delete/Backspace cannot remove them.

## [0.4.0]

- Mind-map builder: create a mind map from an outline block, with two-way sync between the canvas and the Roam outline (add, edit, move, copy, delete, fold).
- Layouts: right tree and radial (Alt+L), pinned nodes (Alt+P), boundaries (Alt+B).
- Fix: opening several drawings from a region list no longer aborts on a single failure.
- Mind map from outline finds the block's parent through `:block/_children` (Roam has no `:block/parent`); found in live acceptance.

## [0.3.1]

- Fix: presenter no longer leaves "Rendering..." over a loaded slide; the HUD shows only the slide count and frame name.
- Fix: canvas embed overlay follows the Excalidraw editor theme instead of Roam's.
- Fix: block embeds show the containing page title as a muted header instead of repeating the block text.

## [0.3.0]

- Crop-aware regions: regions on cropped images map through the image crop; a region fully outside the crop reports "outside crop".
- Canvas embeds: Roam blocks and pages embedded on the canvas as live overlays, inserted from the clipboard.
- Frames as slides: present a drawing's frames in order from the command palette or block menu.

## [0.2.1]

- Fix: view-PNG bounds now include Excalidraw's frame name labels, so cold crops no longer fail the size guard in drawings with frames. `frame` regions extend up to the label. Crop cache version 3.
- Lasso polygons are simplified (Ramer-Douglas-Peucker, at most 48 points) before they are stored.
- Fix: Excalidraw's link tooltip no longer stays on screen after Plexus follows a link.
- Clicking an image-region crop now spotlights the region on the opened image.

## [0.2.0]

- Region kinds: group, frame, cframe (exact frame), poly, imgrect, imgpoly. "Frame (with margin)" toolbar button.
- Image regions: rect and Alt-lasso polygon crops on images inside drawings, plus a "Plexus: Region on image" block context menu command.
- Drawing links: clicking a Roam link on a drawing element opens the page or block (Shift opens in the sidebar); hover preview of the link target.
- Thumbnails via `actions.thumbnail` and a frozen `window.RoamPlexus` API (create, open, drawingsOn, thumbnail, change events).

### 0.1.0

- Scaffold from roam-extension-template.
- Region refs for native Excalidraw drawings (area and image-rect regions), cropped rendering, click to open zoomed with spotlight.
