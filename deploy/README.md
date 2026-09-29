# Plexus

Region refs, crops, and Compass hooks for Roam's native Excalidraw.

Plexus turns part of a `{{[[excalidraw]]}}` drawing into a real Roam block (a "region"). A region renders as a cropped image wherever it appears: inline, in `((uid))` refs, and in embeds. Click the crop to open the drawing full-screen, zoomed to the region with a brief spotlight.

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

- Plexus: Create region from selection
- Plexus: Create image region
- Plexus: Refresh crops for open drawing
- Plexus: Clear crop cache

## Development

```
npm ci --ignore-scripts
npm run check
```

Edit `src/`; `extension.js`, `extension.css`, and `deploy/` are generated. See `docs/spec-plexus.md` and `docs/phase1-contract.md`.

## Licensing

MIT. Obsidian Excalidraw and K-Plex are AGPL; only their ideas were used, no code.
