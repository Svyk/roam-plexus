# Changelog

All notable changes to this project follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0]

- Legacy drawings: dry-run report of old ExcalDATA drawings (`Plexus: Legacy drawings (dry run)`) and migration into native drawings; the legacy block is never written.
- Automation API v2: scene registry, `whenOpen`, `add`/`update`/`remove`/`exportSvg`.
- Editable embeds: edit a drawing in place from an embed (Edit embed button, F2).
- Editable embeds: Roam autocomplete navigation keys (Esc, arrows, Enter, Tab, ...) now reach Roam while a menu is open, so `[[` menus can be closed and navigated.

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
