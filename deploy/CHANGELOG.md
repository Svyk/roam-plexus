# Changelog

All notable changes to this project follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.29.0]
- A block with several images uses S to pick the next one, in string order. One image ignores S.
- A rotated drawing image keeps its angle. The region is stored in that image's box.
- Two or more links in a region caption open a chooser. One link still opens the region. Links of those links stay out.
- A sticky note is yellow, with bound text. A number stamp writes the next number. Stack places one copy underneath.
- The palette stays two entries. The command list is 78.
- Typing, editor closed, five rounds: +0.086 ms/key. Loaded mean 11.871. Unloaded mean 11.785.

## [0.28.0]
- A mind map node is a rectangle or an ellipse, its edge a line or an arrow, and its palette default, ink, or leaf.
- An indented paste becomes child blocks. A drawing is refused. At most forty.
- A block ref draws a dashed line. At most twelve.
- A plus adds a child. A badge shows the folded count. Tab and fold stay.
- Both sides alternates left and right. Org chart widens the sibling gap. Alt+L keeps five.
- A link opens that outline beside this map.
- Contrast picks black or white ink from the fill.
- One plain text follows the region caption. Markup and conflict write nothing.
- Native keys already add the next shape. No command.
- The palette stays two entries. The command list is 75.
- Typing, editor closed, five rounds: +0.129 ms/key. Loaded mean 12.118. Unloaded mean 11.989.

## [0.27.0]
- A task card embeds a to-do or done block. A checkbox swaps the Roam macro. The rest of the text stays. Better Tasks attribute blocks are shown and not written.
- A live query node renders the query. A pull watch on each named page, at most four, repaints. A query with no page stays a snapshot.
- A page card shows the attributes you name. Enter writes that attribute. An existing page is reused. Better Tasks attributes are shown and not written.
- Hovering an embed draws lines to other embeds on this canvas that mention each other. Lines leave with the pointer. At most twelve.
- The palette stays two entries. The command list is 67.
- Typing, editor closed, five rounds: -0.038 ms/key. Loaded mean 11.903. Unloaded mean 11.941.

## [0.26.0]
- Selected text becomes a page or a block. A prompt confirms the title. An existing title is reused. It becomes an embed or a link, and arrows follow. An image becomes a block and leaves the canvas. Turn back restores the text.
- This page lists images and drawings. Enter fits inside 480 by 360. Shift+Enter is the pixel size or the drawing bounds. The file address is reused and linked to the source. addFiles is not called. A drawing inserts an embed.
- One Name child, written or deleted by a prompt. Props stay. The open drawing shows the name.
- The palette stays two entries. The command list is 64.
- Typing, editor closed, five rounds: -0.201 ms/key. Loaded mean 11.808. Unloaded mean 12.009.

## [0.25.0]
- Scene JSON exports the drawing and imports into a new one. Images are refused. Props are not written.
- A tag is written onto selected text and a child page ref is added when it is missing. Show only that tag dims the rest.
- One export image updates on close when the scene changes. A collapsed linked-from list rewrites only when its refs change, and is deleted when empty.
- The palette stays two entries. The command list is 61.
- Typing, editor closed, five rounds: +0.105 ms/key. Loaded mean 11.989. Unloaded mean 11.883.

## [0.24.0]
- Live present tweens the open drawing between frames. Escape restores the view. The image slideshow stays.
- Slide builds hide later steps. Occlusion covers a region until reveal. Export copies, downloads, or inserts an image.
- The palette stays two entries. The command list is 55.
- Typing, editor closed, five rounds: +0.058 ms/key. Loaded mean 11.968. Unloaded mean 11.910.

## [0.23.0]
- A corner minimap on a large drawing. Click or drag it to pan. The pan does not write elements. A small drawing hides it. The minimap switch is remembered.
- The palette stays two entries. The command list stays 53.
- Typing, editor closed, five rounds: +0.112 ms/key. Loaded mean 11.980. Unloaded mean 11.869.

## [0.22.0]

- `dropSubgraph` appends a neighborhood snapshot to the open drawing. Plain text is the default. Links mode writes a page ref. A closed drawing is refused and is not opened. apiVersion stays 6.
- The palette stays two entries. The command list stays 53.
- Typing, editor closed, five rounds: -0.076 ms/key. Loaded mean 11.671. Unloaded mean 11.747.

## [0.21.0]

- Setting "Preview links only while holding Ctrl/Cmd", off by default. Off keeps the 250 ms link preview. On shows that preview only while Ctrl or Cmd is held, and hides it when the key is released.
- The palette stays two entries. The command list stays 53.
- Typing, editor closed, five rounds: +0.133 ms/key. Loaded mean 11.793. Unloaded mean 11.660.

## [0.20.0]

- Typing `[[` or `((` inserts the closer and leaves the caret inside. Selected words stay the alias, and a page pick writes `[words]([[Title]])`. An empty `[[` lists recent pages. A `#` lists referenced pages. Page rows show the ref count. Related appears only when semantic search is enabled.
- A quiet chip on an open mind map. "Outline update pending" after the queue has been busy for 2.5 s. "Could not update the outline" when the last write failed, until a later write succeeds. No second save control.
- The palette stays two entries. The command list stays 53.
- Typing, editor closed, five rounds: +0.077 ms/key. Loaded mean 11.797. Unloaded mean 11.720.

## [0.19.0]

- One selected embed, frame, or region anchor, and not while editing. Alt+arrows select the nearest anchor in a 90-degree cone. Shift+Tab selects its frame parent. Cmd/Ctrl+L copies `((uid))` when that anchor has a block. Alt+Enter opens the block in the sidebar. Space shows a cached crop in the crop popover and does not load app-excalidraw.js. Five settings, on by default. A key with nothing to do is left alone. Plain arrows still nudge.
- On a drawing or region block: Plexus: Open in graph view, and Plexus: Show mentions. Each opens that block's page. A failure only toasts. Drawing pages are not coloured in the graph. The palette stays two entries. The command list stays 53.
- Typing, editor closed, five rounds: -0.096 ms/key. Loaded mean 11.782. Unloaded mean 11.879.

## [0.18.0]

- A page link gets a badge with that page's reference count. Add to canvas inserts one embed beside the badge and no arrow. The citing block stays.
- Where is this cited? is a command-list item. It opens that popover and writes nothing. The palette stays two entries.
- Remove embed (block untouched) deletes only the anchor, then toasts that the block is unchanged. A region anchor that leaves toasts the same. Native Delete stays.
- Cut: toolbar hint and 900 ms pulse.
- Typing, editor closed, five rounds: -0.054 ms/key. Loaded mean 11.897. Unloaded mean 11.950.

## [0.17.0]

- Show as gallery wraps a regions container. Show as list returns to bullets. The container text stays `{{[[plexus-regions]]}}`.
- A block ref can set card size, alignment, bare, and padding. The region block stays as written.
- Create region from selection asks Frame, Group, or Loose shapes when more than one kind is selected. Escape cancels. The palette stays two entries.
- Typing, editor closed, five rounds: +0.097 ms/key. Loaded mean 12.255. Unloaded mean 12.158.

## [0.16.0]

- Canvas theme follows Roam, on by default, with captureUpdate NEVER. Closing the editor restores the stored theme, so edit time stays put. Fit on open is not called.
- Command list: Lock or unlock selection, Unlock all, Copy diagnostics. The palette stays two entries.
- Crop generation bumps when the extension version changes. Disk keys gain nN| when N is above 0.
- Typing, editor closed, five rounds: +0.131 ms/key. Loaded mean 11.991. Unloaded mean 11.860.

## [0.15.0]

- `apiVersion` stays 6. Command list, before Show in Compass: Focus mode, Todo mode, Embed query results, Embed page children, Link selected, Filter regions by tag. The same two palette entries attach on Cmd/Ctrl+P and drop when the palette closes. Alt+Shift+M still starts a mind map.
- Typing with the editor closed: -0.042 ms/key (five interleaved rounds, 42 keys, 5 s settle). Loaded 12.405, 12.019, 12.071, 12.195, 12.062 (mean 12.150). Unloaded 12.217, 12.088, 12.233, 12.195, 12.229 (mean 12.192).
- Focus cycles 1, 2, 3, all, off. Todo lights open TODOs, including embeds. Escape clears the veil. No scene write.
- At most 50 new cards; no block writes. Link selected adds `relates to::` and `((dest))`, toasts Undo, and skips an existing ref. Tag filter only dims outlines.

## [0.14.0]

- `apiVersion` is 6. `linksOf(uid)` and `framesOf(uid)` read `host.drawing(uid)` and return `[]` when the drawing is missing or the pull throws. They do not open an editor and do not load `app-excalidraw.js`.
- `open(drawingUid, {frame: elementId})` opens the drawing, then zooms to that one element. A non-string `frame` is not a region flag; `open(uid, {region: true, sidebar})` is unchanged.
- `regionsOf` starts its label at `Drawing · region`. The label is never the bare word Region.
- Command list gains "Show in Compass", before Region settings. The block-ref menu uses `ref-uid`; the drawing block menu uses `block-uid`. It calls `RoamCompass.focus` when Compass `isAvailable()` is true, otherwise toasts "Compass is not loaded" and writes nothing. The palette stays "Plexus: Commands…" and "Plexus: Mind map".
- Typing with Plexus 0.14.0 and Compass 0.5.0 loaded measured +0.142 ms/key (five interleaved rounds, 42 keys, 5 s settle, editor closed).

## [0.13.0]

- Process flows (MM-12): a sixth mind-map layout, "Mind map layout: Flow" (command list, canvas menu). It is not in the Alt+L cycle, and Alt+L on a flow map toasts and writes nothing. The outline is the source of truth:
  - The root is a start oval. Its child blocks are the main sequence, with an arrow from each step to the next; a step's own children continue the sequence right after it.
  - A step ending in `?`, or tagged `#decision`, is a diamond. Its children are branches: a `Yes:`, `No:` or any `Label:` prefix (up to 12 characters) becomes the label on the arrow and stays in the block. Each branch ends with an arrow to the step after the decision, unless it ends in a loop or merge reference or in a `#end` step (drawn as an oval).
  - A child block that is exactly `((uid))` and points at another step of the same flow draws a dashed arrow from its parent step (a loop or merge). Anything else is drawn as an ordinary step.
  - `Lane:: Name` or `#lane/Name` puts a step in a lane; steps without one inherit the lane of the previous step. Lanes are columns left to right, each a frame with a deterministic id, and each lane frame gets one cframe region block, created once and never removed. `#CCP` / `#CCP1` and `#hazard` add a chip at the step's top-right corner.
  - F2 edits the text between the prefix and the tags and keeps both. Drag only reparents (drop on a step); other drops and Alt+P do nothing. Attribute-block edges are not used in flow layout. Existing right, cause and fishbone maps are unchanged and reconcile to zero writes (golden tests).
- Templates (AUTH-10): "Insert template...", "New drawing from template..." and "Save selection as template..." (command list only; the palette still holds two entries). Eight built-in starters (HACCP flow, 5-Why, fishbone, Apollo cause map, SIPOC, swimlane, swab-site map, 16:9 slide) are generated in memory. User templates live on the page `Plexus/Templates`, one drawing child per named block (up to 50 listed, names up to 60 characters), shown with cached thumbnails. An insert lands at the viewport centre as one guarded write with fresh ids and one undo step. "Save selection" asks for a name in an in-page prompt, writes the elements into a new template drawing, waits for Roam's save, and reopens the original drawing; on any failure it reopens the original, deletes an empty template block and toasts.
- Arrange (AUTH-9): canvas menu "Plexus: Arrange >" with Arrange as row, column and grid, Equal size, Box around, Grid of images, Lay out frame children, Swap two and Untangle (up to 200 elements, deterministic). Each is one guarded write and one undo step, moves groups and frames with their children as units, keeps bound text with its container and re-routes straight bound arrows. Bent or elbow arrows keep their shape (the toast counts them). Mind-map nodes are skipped with "Map nodes follow the outline".
- Canvas menu: items can now have a flyout submenu, opened on hover or click, flipped left and clamped to the viewport, hidden when no child is enabled, and removed on dispose.
- `openDrawing` passes `placeholder` through and `newDrawing({fresh: true})` skips the reuse memo; both are additive.
- Measured (spec section 13): native align and distribute re-route bound arrows while plain `updateScene` moves do not; a map node's `frameId` survives a reconcile; `host.drawing(uid).elements` reads a closed drawing; the paste path re-ids elements and keeps `customData.firebaseUrl`.
- Limits: flow layout has no radial or up/down variants and no attribute edges; a merge target has no primary edge and takes the lane of the step before it; a ref that resolves outside the flow, or that has children, is a plain step; lane regions are not removed with their lane; the save-as-template flow skips images it cannot persist and reports the count; "New drawing from template" needs the editor closed.
- Verified live in Readwisenotes (spec section 13). Save-as-template polls the persisted element count every 40 ms and treats a closed editor as finished before a late write can count as saved. If the write has already landed, the block is kept and the toast is "Template may be incomplete". The editor toolbar hides while an Excalidraw popover is open by a class set only while that editor is mounted. Unload drops leftover portals after the disposers return. Folding a loop target drops the dashed arrow instead of rebinding it (recorded, not blocking). Typing with the editor closed: +0.04 ms/key.

## [0.12.0]

- Restore an earlier version (DATA-1): command list, canvas menu. An in-page dialog lists "This session" (the in-memory write-guard entries: label, time, element count) and "Saved on this device" (an IndexedDB ring, `plexus-snapshots`: at most 20 per drawing, taken when the editor unmounts and at most every 10 minutes while it is open, deduplicated, 20 MB per drawing and 100 MB overall). A restore is one guarded write with one undo step ("Restored - Cmd+Z brings the current version back"); elements missing from the old version are kept as deleted, mind-map elements keep their current state, and restored images whose file is gone stay as placeholders and are counted in the toast. Nothing is opened or written on an encrypted graph, where the saved list reads "Not kept on encrypted graphs". Before a restore, a chart insert or a builder commit, the current scene is snapshotted. Covered by unit tests only: `isEncrypted: true` opens nothing, and dispose closes the connection after in-progress writes. The live encrypted-graph check is not run.
- Builders (API-1): `RoamPlexus.build({style})` creates rect, ellipse, diamond, text, frame, line, box (container with bound text) and real bound arrows with labels, lays them out (row, column, grid, tree) and commits once with `commit(uid?)`. `apiVersion` is 5. See spec section 8.
- Cause-and-effect from JSON (MM-11): command list and canvas menu open a paste box for the Plexus Canvas chart schema and insert it (tree, fishbone or pentagon) at the viewport centre as one undo step. `RoamPlexus.scene(uid).addChart(json, {layout})` does the same.
- Cause maps from an outline (MM-11): the mind-map layouts "Cause" (a tidy tree growing left from the effect) and "Fishbone" (effect as the head, first-level causes as bones above and below a spine). The effect is red with a star in its label (display only), causes are coloured by depth, `#evidence` children get a dashed stroke, and the edge label is "caused by". Set from the command list ("Mind map layout: Right / Cause / Fishbone") or the canvas menu.
- Attribute blocks as edges (MM-7): a bare `Name::` child block whose children are nodes becomes a labelled edge instead of a node. Maps created by 0.12.0 have it on; older maps keep it off until you turn it on ("Mind map: attribute blocks as edges", command list or canvas menu). Toggling writes only the root element's marker, no blocks. `BT_attr*` blocks are never written.
- Task nodes and tag colours (MM-8): a node whose block starts with a `{{[[TODO]]}}` or `{{[[DONE]]}}` macro shows a checkbox (open or done, done drawn at half opacity). Alt+Enter toggles the macro; F2 edits the rest of the text. New setting "Mind map tag colors" (`urgent=#ffc9c9, done=#b2f2bb`): the first matching `#tag` sets the node fill.
- Drag to reparent and reorder (MM-1): dropping a mind-map node on the inner part of another node makes it that node's last child; dropping in the gap between siblings reorders (right, left, cause, down and up layouts); a drop with Cmd/Ctrl held, or outside every target, pins the node as before. A highlight ring shows the target. Each move is one block move through the map's write queue. Dropping a node into its own branch is refused.
- Mind-map keys (MM-2): Alt+Shift+Up/Down reorders among siblings; Shift+Tab selects the parent; Ctrl/Cmd+Alt+Arrow centres the view on a neighbour; Backspace or Delete removes a just-created empty node.
- Drawing to outline (GRAPH-5): "Drawing to outline..." writes the drawing's text, frames (as headings), embeds and links as a bullet tree under a `{{[[plexus-outline]]}}` child of the drawing block, ordered by arrows and reading order. Re-running replaces that container's children. More than 50 blocks asks first, more than 500 refuses. "Copy as Roam markdown" puts the same markdown on the clipboard. Nothing outside the container is written, and drawing props are untouched.
- The command list gains "Restore an earlier version...", "Cause-and-effect from JSON...", "Drawing to outline...", "Copy as Roam markdown", three "Mind map layout" rows and "Mind map: attribute blocks as edges"; the canvas menu gains the same. The command palette still holds exactly two entries. "Restore before last Plexus change" is unchanged.
- One-time changes to maps made before 0.12.0: task nodes redraw with a checkbox prefix, and Better Tasks attribute blocks (`BT_attr*` children) no longer appear as nodes. Existing maps otherwise reconcile to zero writes.
- Undo notes: a mind-map drag is in Excalidraw's history, so Cmd+Z with nothing selected moves the node back and the next pass pins it; undo map moves in the outline. Layout and attribute toggles are not undoable (they write with `captureUpdate: "NEVER"`); each toast says "choose again to change back".
- Alt-drag on a mind-map node duplicates elements in Excalidraw 0.18.0, so the pin gesture is Cmd/Ctrl-drag, not Alt-drag.
- Measured live: to pin a mind-map node, drag it and hold Cmd/Ctrl as you release. Holding Cmd/Ctrl before the drag starts does not grab the node (Excalidraw).
- Measured live: Roam's `fromMarkdown` turns a bullet starting with `# `, `## ` or `### ` into a heading and drops the hashes. A text item starting with "# " is therefore written block by block, so it is not turned into a heading. "Copy as Roam markdown" is unchanged.
- Measured live: on a 200-node map an outline edit's echo costs about 11 ms of Plexus work. The long task around it (about 170 ms) is Roam compressing and saving the 600-element drawing.
- Cut or moved to Later: the flip-side drop (moving a node to the other side of the root), the "Due" attribute for task nodes (Better Tasks has no due-date call and `BT_attr*` must not be written), and "Project to blocks" (cause map to blocks).
- Not verified live: everything in this entry ran against node fakes only. The Phase 12 live gate and the amendment 39 measurements are still open (the `fromMarkdown` corpus, `block.move` order, whether the star and checkbox glyphs render, image refetch after a restore, Cmd-drag release versus text links, whether the OS captures Ctrl+Alt+Arrow, first edit of a builder text with a non-default font family, the 200-node reconcile timings, the encrypted-graph and unload checks).

## [0.11.0]

- Frames and slides: a toolbar "Frames" flyout with six presets (A4, Letter, 16:9, 4:3, 1:1, Mobile), "Reformat selected frame", "Slide" (wrap the selection in a new frame) and 2x2 or strip layouts. Each action is one write. Frame order is kept in step with new frames.
- Print and PNG: "Print frames..." and "PNG per frame" (command list, drawing block menu) render each frame to a page or a PNG. Settings: print page size (letter, a4, 16:9) and margin (0-40 mm).
- Present from here: canvas menu, command list, and the region or frame ref and block menus start the presenter at a chosen frame. "Present this outline" builds a deck from a block's child refs (capped at 100). The presenter has a progress bar, a notes pane (N; "Add notes" is idempotent) and a laser and pen (settings: laser color and fade).
- Embed labels refresh: an embed anchor's label follows its source block. The refresh is debounced, waits while you edit, and is written with `captureUpdate: "NEVER"` so it adds no undo step and Cmd+Z does not revert it. An undo or redo of an older step can bring back an old label; the next refresh corrects it. Only the first 150 embed anchors in a drawing are watched; the rest refresh when the drawing opens.
- Paste from canvas: pasting Excalidraw elements into a Roam block inserts their text (first line in the block, the rest as sibling blocks, capped at 100 lines). Code blocks are left alone. Siblings are created through the Roam API, so Cmd+Z removes the pasted first line but the siblings survive it.
- The command list gains "Present from here", "Present this outline", "Print frames...", "PNG per frame" and "Make slide". The command palette still holds exactly two entries.
- Measured live: "Make slide" takes two undo steps (the first removes the name and order, the second the frame and the children's frame membership). Frames made by "Slide" keep Excalidraw's own id.
- Unverified live: real Roam Desktop printing (iframe print, CSP on the inline style, multiple-download prompt), undo counts for "Make slide" and a preset, whether the wrap-in-frame action updates the scene synchronously, native 2x frame export size, the `rm-block-input` class used by paste, and gate 1 (label writes) and gate 2 (page size via `Page.printToPDF` with `preferCSSPageSize`).
- Not implemented (measure first): the CSP fallback for the print style, the `body > .plexus-print` fallback, the zip fallback for PNG downloads.

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
