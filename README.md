# Plexus

Region refs and crops for Roam's native Excalidraw.

Plexus turns part of a `{{[[excalidraw]]}}` drawing into a real Roam block (a "region"). A region renders as a cropped image wherever it appears: inline, in `((uid))` refs, and in embeds. Click the crop to open the drawing full-screen, zoomed to the region with a brief spotlight. Shift-click opens it in the right sidebar. Links in a region's caption are real Roam refs, so the region shows up in those pages' linked references.

## Create a region

1. Open a drawing full-screen (the expand icon on the drawing).
2. Select the elements you want, then press **Region** in the Plexus bar at the bottom of the editor. For part of a picture, select one image, press **Image region**, and drag a rectangle over it.
3. Plexus adds the region block under the drawing and copies `((uid))` to your clipboard. Paste it anywhere.

The caption defaults to the text inside the selection. Edit it like any block.

## Install

Roam Depot, Developer Extension URL:

```
https://svyk.github.io/roam-plexus
```

## Region syntax

Regions live as children of one collapsed `{{[[plexus-regions]]}}` block, the last child of the drawing block.

```
{{[[plexus-region]]: k=area d=<drawingUid> ids=<id>,<id> pad=10}} caption
{{[[plexus-region]]: k=rect d=<drawingUid> el=<imageElementId> f=<rx>,<ry>,<rw>,<rh>}} caption
```

`area` crops to the bounds of the listed elements plus padding. `rect` crops an image element to a fractional rectangle.

## Commands

The command palette holds two Plexus entries:

- Plexus: Commands... opens a searchable list of every Plexus action (new drawing, regions, mind map, embed, note card, present, present from here or an outline, print frames, PNG per frame, make slide, audits, restore, chart from JSON, drawing to outline, mind-map layouts, cache, settings).
- Plexus: Mind map (Alt+Shift+M).

The list exists because each palette entry costs every keystroke you type in Roam: Roam's key handler walks all registered commands, about 0.055 ms each, so 23 entries added about 1.3 ms per key.

Hotkeys are Alt+Shift+R (region), I (image region), P (present), M (mind map), E (embed), N (note card) and O (outline dock). R, I, P, E, N and O work while a drawing is open; M works everywhere and can be changed in Roam Settings > Hotkeys.

## Outline dock, drops and links in text

- Outline dock: the toolbar "Outline" button, Alt+Shift+O, or "Toggle outline dock" in the command list docks the drawing block's children beside the full-screen canvas, so you can type bullets while drawing. "Outline dock: show parent" (command list) shows the parent block's children instead. The dock width is dragged from its left edge and remembered.
- Drag a bullet from the dock onto the canvas to place it: no modifier embeds it, Alt links it, Shift places a plain label. Dragging the dock header places the page or block itself.
- Cmd-click (Ctrl-click off macOS) a `[[page]]`, `#tag` or `((block))` written in canvas text to open it; add Shift for the sidebar. Text with several links offers a chooser.

## Frames, slides and printing

- Toolbar "Frames": add a frame (A4, Letter, 16:9, 4:3, 1:1, Mobile), reformat the selected frame, "Slide" (wrap the selection), or add a 2x2 grid or a strip of four.
- Present from here (canvas menu, command list, region and frame refs) starts at a chosen frame. "Present this outline" turns a block's child refs into a deck. Press N for speaker notes ("Add notes" creates the notes block). The laser pointer and pen follow the laser color and fade settings.
- "Print frames..." prints one page per frame; "PNG per frame" downloads one PNG per frame. Page size and margin are in the settings dialog. Real printing in Roam Desktop is worth a check on your machine.
- Embed labels on the canvas follow the source block after a short delay. Pasting canvas elements into a Roam block pastes their text, one bullet per line.

## Diagrams from outlines

- Mind map layouts "Cause" and "Fishbone" turn an outline into a cause map; "Mind map: attribute blocks as edges" draws `Name::` blocks as labelled edges. Drag a node onto another to reparent it, or between siblings to reorder. Alt+Enter toggles a task node; the "Mind map tag colors" setting fills nodes by `#tag`.
- "Cause-and-effect from JSON..." inserts a chart from the Plexus Canvas schema. "Drawing to outline..." writes a drawing's text as an outline under a Plexus block; "Copy as Roam markdown" copies it.
- "Restore an earlier version..." lists this session's changes and versions saved on this device (not kept on encrypted graphs).
- `RoamPlexus.build()` and `scene(uid).addChart()` script the same from other extensions (`apiVersion` 5).

## Development

```
npm ci --ignore-scripts
npm run check
```

Edit `src/`; `extension.js`, `extension.css`, and `deploy/` are generated. See `docs/spec-plexus.md` and `docs/phase1-contract.md`.

## Licensing

MIT. Obsidian Excalidraw and K-Plex are AGPL; only their ideas were used, no code.
