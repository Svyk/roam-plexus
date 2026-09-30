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

- Plexus: Commands... opens a searchable list of every Plexus action (new drawing, regions, mind map, embed, note card, present, audits, cache, settings).
- Plexus: Mind map (Alt+Shift+M).

The list exists because each palette entry costs every keystroke you type in Roam: Roam's key handler walks all registered commands, about 0.055 ms each, so 23 entries added about 1.3 ms per key.

Hotkeys are Alt+Shift+R (region), I (image region), P (present), M (mind map), E (embed) and N (note card). R, I, P, E and N work while a drawing is open; M works everywhere and can be changed in Roam Settings > Hotkeys.

## Development

```
npm ci --ignore-scripts
npm run check
```

Edit `src/`; `extension.js`, `extension.css`, and `deploy/` are generated. See `docs/spec-plexus.md` and `docs/phase1-contract.md`.

## Licensing

MIT. Obsidian Excalidraw and K-Plex are AGPL; only their ideas were used, no code.
