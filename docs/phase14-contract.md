# Plexus Phase 14: Compass hookup (binding)

Plexus 0.13.0 (`b33dbd3`) becomes 0.14.0. Compass 0.4.0 becomes 0.5.0 if it changes. Scope is roadmap-next P14: CMP-6, CMP-15, CMP-2, CMP-3, CMP-7, CMP-9.

P13 rules still bind. No new Plexus command-palette entry. Drawing props are read, not written, on the linksOf path. No `BT_attr*` writes.

## Measured facts

Readwisenotes, window title `Readwisenotes - plx typing bench`, 2026-09-30. Plexus and Compass were both unloaded.

Pulling `:excalidraw/elements-json` for drawing `ITvT3bqaL` requested no `app-excalidraw.js`. The drawing had 31 live elements.

Frames carry `customData.plexus.order`: 1 Intro, 2 Middle, 3 Details, 10 End, Frame A, Slide. `orderFrames` already sorts on that field, then name, then y.

`element.link` is a string, `[[Page]]` or `((uid))`. That drawing had two such links, one `customData.plexus.embed`, and five mind-map nodes whose `mm` object includes `uid`.

Several region captions are the single word Region. Compass `drawingTitle` returns that word, and the same word when a caption is empty. `regionsOf` may also return the label Region.

## Decisions

1. **apiVersion 6.** `linksOf(uid)` and `framesOf(uid)` are additive. They read the existing drawing pull. They do not open an editor and do not request `app-excalidraw.js`. A missing drawing returns `[]`.
2. **linksOf.** `linksIn(elements)` returns `{elementId, kind, ref, text}`. `kind` is `link`, `embed`, or `mindmap`. `ref` is the raw `[[Page]]` or `((uid))`. Dedupe by kind plus ref. Cap 200. Mind-map arrows are not rows. Text is at most 80 characters.
3. **framesOf.** `framesIn(elements)` uses `orderFrames` and returns `{elementId, name, order}` in that order. Regions stay on `regionsOf`.
4. **Label.** A caption whose plain text is exactly Region counts as empty. The label is then the drawing title, a middle dot, and the kind word. It is never the bare word Region. Spec section 8 records apiVersion 6 and this label rule.
5. **Show in Compass.** One command-list row, plus the region-ref menu. It calls `RoamCompass.focus(uid)` when `isAvailable()` is true. Otherwise a toast, and no write. Compass exposes a frozen `{focus, isAvailable}` and a ready event. No new Compass palette command.
6. **Hover.** Compass asks `thumbnail(uid, {maxWidth: 480})` with render left false. The popover is cache-only. A miss shows nothing and does not render.
7. **Related drawings.** `rankDrawings(centreRefs, rows)` sorts by shared ref count, then newer edit time. Cap 50. Compass shows them only when `linksOf` exists, and also counts block refs.
8. **Drawing centre.** When the centre is a drawing, list `framesOf` first, then `regionsOf`, with the derived label and a thumbnail. A click calls `open(uid, {frame})` or `open(uid, {region})`.
9. **Follow.** One `hashchange` listener. Pin stops it. Ignore the change when Compass itself navigated, and while an input is focused. Do not call `syncSidecar` from that listener.
10. **Edges.** If `linksOf` exists, Compass draws a dashed read-only edge per row. If it does not, Compass behaves as in 0.4.0.

## Units

| Unit | Owns |
|---|---|
| L | Plexus `src/model/links.js`, `test/links.test.js` |
| F | Plexus `src/model/frames.js`, `test/frames.test.js` |
| Lb | Plexus `src/model/label.js`, `test/label.test.js` |
| I | Plexus `src/api.js`, `src/extension.js`, `src/view/context-menus.js`, `test/extension.test.js`, `test/api.test.js`, `test/api-p8.test.js`, `test/api-p12.test.js`, `test/api-p14.test.js`, spec section 8, `package.json`, `CHANGELOG.md` |
| R | Compass `src/model/related.js`, `test/related.test.js` |
| C | Compass `src/model/neighborhood.js`, `test/neighborhood.test.js`. No `text.js` edit |
| V | Compass `src/view/overlay.js`, `src/extension.js`, `src/host.js`, `src/settings.js`, `package.json`, `CHANGELOG.md` |

## Gate

Readwisenotes only. Show in Compass focuses a region. Each extension runs with the other unloaded. Labels are never the bare word Region. linksOf makes no app-excalidraw.js request. Related drawings rank by shared refs. A drawing centre lists frames in slide order, then regions. Hover uses the 480 cache and does not render. Follow tracks a route change and does not loop the sidecar. Typing bench, five rounds, five second settle. Palette still two Plexus entries.

## Amendments

These override the decisions above on conflict. Each unit edits only its files. `node --test` on those tests only. No `npm run check` inside a unit.

11. `linksIn` is Plexus `src/model/links.js`. `framesIn` is `src/model/frames.js` and calls `orderFrames`. `rankDrawings` is Compass `src/model/related.js`. Compass does not import the Plexus tree. `linksOf` and `framesOf` call `host.drawing(uid)`. A missing drawing returns `[]`. No editor and no `app-excalidraw.js`.

12. `linksIn` skips deleted elements. `element.link` is a row only when the string is `[[...]]` or `((uid))`. Embed is `customData.plexus.embed` in that shape. Mind-map is `customData.plexus.mm.uid` when `mm.edge` and `mm.boundary` are unset; `ref` is `((uid))`. Dedupe is kind plus ref, first wins, then cap 200. `text` is element text or name, trimmed, at most 80 characters.

13. Keep `open(uid, {region: true, sidebar})` as "uid is a region block". A frame click is `open(drawingUid, {frame: elementId})`: open, then zoom to that element. A region row calls `open(regionUid)`. Do not pass a region uid in `region` while uid is the drawing.

14. `regionLabel` treats plain text Region as empty. Its catch returns `Drawing · region`. `regionsOf` uses that fallback. Update the hostile-input assertion in `test/label.test.js`. Compass `drawingTitle` returns `Untitled region` when the caption is empty or exactly Region. Update `test/text.test.js`.

15. Node thumbs stay width 160 and may still render on a miss. The hover popover is separate: `thumbnail(uid, {maxWidth: 480})` with render false and `pointer-events: none`. A miss shows nothing. Centre-list thumbs are cache-only. A frame element id is not a block uid, so a frame row shows an image only when a cached blob exists. A miss still lists the name.

16. Follow recentres and does not call `syncSidecar`. Skip when pinned, when Compass caused the hash change, or when an input, textarea, or contenteditable is focused. Show linked window is an overlay button, not a palette command. Drawing-link nodes use zone east, `drawingLink: true`, `writable: false`. If that uid is already placed, mark it instead of adding a second node. Overlay dashes that stroke. No `layout.js` edit. These nodes exist only when `typeof linksOf === "function"`.

17. Show the related group only when `linksOf` exists. Shared count includes block refs and resolved link refs. Setting `compass-related-drawings` defaults on. Cap 50. Newer edit time wins ties. Command list gains `Show in Compass` (39 labels). Same action on the region-ref menu, a drawing block menu, and a linked element. Palette stays two Plexus entries and three Compass entries.

18. `window.RoamCompass` is frozen `{focus, isAvailable}`. `isAvailable` is true while the extension is loaded, so `focus` may open the overlay. Fire `roam-compass:ready` on install and `roam-compass:unload` on unload. If Compass is missing, Plexus toasts and writes nothing. Plexus becomes 0.14.0 and `API_VERSION` 6. Update the version assertions in the three api tests. Compass becomes 0.5.0. Spec section 8 records `linksOf`, `framesOf`, frame `open`, and the label rule. Image-block thumbnails stay later.

19. V may add Compass `test/compass-p14.test.js` and may edit Compass `test/extension.test.js` when a command assertion changes. Palette commands stay the existing three. C may edit Compass `test/neighborhood.test.js`.

20. `src/model/links.js` already exports `parseRoamLink`. Add `linksIn` beside it. Do not replace that file or `test/links.test.js`. One row per live element, in `sourceRefOf` order: `mm.uid`, else embed, else `element.link`. Do not also emit `link` when embed is set. Skip `mm` with no uid. Text is the element's own text, or its bound text child when that text is empty, then cut at 80. Do not import `caption.js`.

21. `framesIn` does not sort again. `orderFrames` already did. `name` is `element.name` and may be empty. `order` stays null when it is not a finite number. Do not treat null as 0.

22. Do not edit Compass `text.js`. An unloaded Compass may still show Region for an empty region caption. With Plexus loaded, `regionsOf` never returns that bare word. The label gate is the loaded path. Lb already changed `regionLabel` and its test passes.

23. Show in Compass on `blockRefContextMenu` uses `e["ref-uid"]`. `block-uid` is the block that contains the reference. Do not add a palette entry.

24. Do not change `THUMB_WIDTH` or `attachThumb`. The 480 hover is a separate popover. A 160 cache hit is not a 480 hit. A null blob shows nothing.

25. The drawing-centre list is not the block outline. Show it when the centre is a drawing even if `compass-outline` is off. A region click is `open(regionUid)`. A frame click is `open(drawingUid, {frame: elementId})`. A frame element id is not a block uid, so it has no thumbnail. Do not call `focusUid` for those clicks.

26. Follow does not call `focusUid`, `load`, or `syncSidecar`. `load` always syncs the sidecar. Wait until `mainWindow.getOpenPageOrBlockUid()` equals the new uid. Do not use `openPageUid`; it substitutes today. Follow pauses while the current centre uid is in `settings.pins`. Skip while an input, textarea, or contenteditable is focused, and when Compass itself navigated.

27. Dashed edges are not neighborhood nodes. `maxPerZone` is 12 and would drop them. Draw them in the overlay with `data-style` `link` so the existing dash rule applies. Leave `writable` null. Resolve `[[Title]]` with a page-title pull before using it as a uid. Cap the drawn set at 50.

