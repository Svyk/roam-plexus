# Plexus Phase 6: tidy region refs, the `[[` / `((` picker, right-click menus (binding)

Repo `~/roam-plexus`, HEAD `dad685f` (code 0.5.0, `cd6ca96`). Earlier contracts still bind anything not changed here. Roam rules: `~/.claude/skills/roam-plugin-dev/SKILL.md` §(d); rules 1, 5, 7, 10, 13, 19 matter most. The usual constraints apply:
- zero runtime deps, plain JS, `node --test` with hand-rolled fakes (no jsdom);
- log prefix `[plexus]`;
- never throw into Roam;
- every listener, observer and portal is removed on unload.

Version 0.6.0.

Source: user feedback 2026-09-29 (screenshot plus a 100 s recording). They said "a lot of the image ref looks messy, typing [[ or (( doesn't show the native picker, we should fix that. We should try to add our own settings in the right click, etc."

The recording shows three problems:
- **Messy region refs.** A 360 px crop sits mid-line in the referencing block, and the caption (`Region A [[Plexus Spike Target]]`) wraps around it. The line box is huge. The white crop glares on the dark theme.
- **Zoom too deep.** Clicking a crop opens the drawing at 333%, and the user has to zoom out by hand.
- **No link picker.** The user types `[[` inside an Excalidraw text element, and no picker appears.

Right-clicking a region ref shows only Roam's native block-ref menu, with nothing from Plexus.

## Measured facts (2026-09-29, Readwisenotes window `1929…`, trusted CDP)

- **Search API.**
  - `roamAlphaAPI.data.async.search({"search-str", "search-pages", "search-blocks", "hide-code-blocks", limit})` exists.
  - Pages come back as `[{":block/uid", ":node/title"}]`. Page search takes about 11 ms.
  - Blocks come back as `[{":block/uid", ":block/string"}]`. Block search takes about 136 ms.
  - A blank `search-str` throws `Input error: 'search-str' cannot be blank`.
  - The sync `data.search` also exists; do not use it on the input path.
- **Roam's native autocomplete markup.** Appended to `body`, positioned by popper, 400×300.

  ```html
  <div class="rm-autocomplete__results bp3-elevation-3" style="position:absolute; …">
    <div class="rm-autocomplete__results-main">
      <div class="rm-autocomplete__results-scroll">
        <div title="Plexus" class="dont-unfocus-block" style="border-radius:2px; padding:6px; cursor:pointer;">
          <div class="rm-autocomplete-result"><span><span class="rm-search-match">Plex</span>us</span><sup class="rm-autocomplete__ref-count">5</sup></div>
        </div>
        …
      </div>
      <div class="rm-autocomplete-footer">
        <div class="rm-autocomplete-footer__title">Page search</div>
        <div class="rm-autocomplete-footer__actions"><span class="rm-autocomplete-footer__action"><span class="rm-autocomplete-footer__action__desc">Insert reference</span><span class="rm-autocomplete-footer__action__hotkey"><span class="bp3-icon bp3-icon-key-enter rm-autocomplete-footer__action__hotkey__icon">…svg…</span></span></span></div>
      </div>
    </div>
  </div>
  ```

  - **Active row.** It gets the inline `background-color: rgb(213, 218, 223)`. The dark theme overrides it with `rgba(138,155,168,.15)`, so the inline style stays theme-correct.
  - **No results.** One row, `title="No pages found."`, with `color: lightgray` added.
  - **Block rows (`((`).** They add `<div class="bp3-text-overflow-ellipsis" style="color: rgb(129, 145, 157);">…</div>` under the result.
- **Excalidraw text editor.**
  - The editor is `textarea.excalidraw-wysiwyg` in `.excalidraw-textEditorContainer`. Its handlers are properties: `oninput`, `onkeydown`, `onblur`, `onpaste`.
  - It carries CSS `transform: matrix(zoom, 0, 0, zoom, …)`. Its computed font is `20px / 25px Excalifont…`, with `white-space: pre`, and its width grows with the text.
  - `onblur` submits the text. Escape submits too.
- **Excalidraw hyperlink editor.** It is `input.excalidraw-hyperlinkContainer-input` (React-controlled).
- **Plexus mind-map input.** It is `input.plexus-portal.plexus-mm-input`, appended to `body`. It has its own non-capture keydown handler: Enter commits, Tab adds a child, Escape cancels. It commits on blur.
- **Excalidraw canvas context menu.**
  - Markup: `.excalidraw .popover` (inline `left/top`) > `ul.context-menu` > `li[data-testid]` > `button.context-menu-item` > `div.context-menu-item__label` plus `kbd.context-menu-item__shortcut`. Separators are `hr.context-menu-item-separator`.
  - State: `app.state.contextMenu` is `{top, left, items}` while the menu is open. `app.setState({contextMenu: null})` closes it.
  - On an empty canvas the menu is Paste, Copy as PNG/SVG, Select all, Toggle grid, Snap, Zen, View mode, Canvas & Shape properties.
- **Roam context menu APIs.**
  - `roamAlphaAPI.ui` exposes `blockRefContextMenu`, `blockContextMenu`, `pageRefContextMenu`, `msContextMenu` and `pageContextMenu`, each with `addCommand` and `removeCommand`.
  - `"display-conditional"` works.
  - The block-ref callback and conditional receive `{"ref-uid", "block-uid", "window-id", indexes: [start, end]}`.
  - Commands appear under the native menu's **Extensions ›** submenu, after Jump to block, Open in sidebar, Open linked references, Replace with, Apply children and Copy this reference.
- **Region-ref DOM inside a block ref.** `span.rm-block-ref[data-uid=<region uid>]` > `span` > `span` (the xparser wrapper holding `button.rm-xparser-default-plexus-region.plexus-hidden` and our `span.plexus-root.plexus-regionref`), followed by the text node ` Region A ` and the page-link span. The caption is Roam's own render of the rest of the region block string.
- **Cut-off text in the test fixture.**
  - The "Region A [[Plexu" crop is a fixture defect. Text element `plx-text-a` in drawing `ITvT3bqaL` stores `width: 160`, but the text needs about 300 px. Excalidraw clips text to its stored width in the editor, so the crop is faithful.
  - The integrator fixes the fixture. No model change is needed.
- **Zoom.** `openRegion` calls `native.zoomTo(app, bbox)` with `fitZoom`'s default `maxZoom = 4`. A 240 px region fits at 333%.

## Shared foundation (unit F, lands before U1–U3)

`src/model/refdisplay.js` (pure):
- `DISPLAY_MODES = ["image", "thumbnail", "link"]`.
- `overrideKey(blockUid, refUid)` returns `` `${blockUid}|${refUid}` ``.
- `refContext(blockString, refUid)`: `"alone"` when the trimmed string is exactly `((refUid))`, otherwise `"inline"`.
- `resolveDisplay({context, override, inlineDisplay})` resolves in this order:
  1. `context === "home"` returns `"image"`.
  2. A valid `override` returns the override.
  3. `"alone"` returns `"image"`.
  4. Otherwise it returns `"link"` when `inlineDisplay === "link"`, else `"thumbnail"`.
- `parseOverrides(json)` returns a plain object and never throws; invalid input gives `{}`, and invalid modes are dropped.
- `withOverride(map, blockUid, refUid, mode | null)` returns a new map; `null` deletes the entry. The map is capped at 500 entries, with the oldest insertion evicted first.

`src/settings.js`: keep the existing ids and add the new ones.

| id | default | readSettings key | panel |
|---|---|---|---|
| `figure-height` | `"280"` | `figureHeight` (number, clamp 80–1200) | input: "Image height (px)" |
| `thumb-height` | `"72"` | `thumbHeight` (number, clamp 24–400) | input: "Thumbnail height (px)" |
| `inline-display` | `"thumbnail"` | `inlineDisplay` (`"thumbnail"` or `"link"`) | select: "Region refs inside text" |
| `dark-crops` | `true` | `darkCrops` | switch: "Match dark theme" |
| `ref-overrides` | `"{}"` | `refOverrides` (object, via `parseOverrides`) | not in the panel |

- `max-crop-height` leaves the panel, and `readSettings` stops returning `maxCropHeight`. Stored values are ignored.
- New export `writeSetting(extensionAPI, id, value)` returns a Promise and swallows errors with a `[plexus]` warning.
- New export `setRefOverride(extensionAPI, blockUid, refUid, mode | null)` does a read, `withOverride`, then a write of the JSON string.
- `createSettingsPanel({onChange} = {})`: every display setting (`figure-height`, `thumb-height`, `inline-display`, `dark-crops`, `open-in-sidebar`) passes `onChange` into its `action` so the integrator can re-render.

`src/extension.css`: add three empty marker comments at the end of the file. Each unit replaces only its own marker:
- `/* == p6:suggest == */`
- `/* == p6:regionref == */`
- `/* == p6:menus == */`

## U1. Link picker (`[[` pages, `((` blocks)

`src/model/suggest.js` (pure):
- `findTrigger(text, caret)` returns `null` or `{kind: "page" | "block", start, query}`.
  - Look back from `caret` on the current line only: stop at `\n`, or 300 chars.
  - Find the nearest `[[` or `((` whose tail up to `caret` contains no `]]`, `))`, `[[` or `((`.
  - `start` is the index of the first bracket. `query` is the tail.
  - A query longer than 100 characters returns null.
- `applyPick(text, caret, trigger, pick)` returns `{text, caret}`.
  - `pick` is `{kind: "page", title}` or `{kind: "block", uid}`.
  - It replaces `text.slice(trigger.start, caret)` with `[[title]]` or `((uid))`.
  - If the characters right after `caret` are the matching closer (`]]` or `))`), they are consumed.
  - The new caret sits after the inserted token.
- `matchSegments(label, query)` returns `[{text, match}]`. Each whitespace-separated query token is highlighted case-insensitively. It returns one unmatched segment when the query is empty.
- `blockSnippet(str, query, max = 120)` returns a single-line snippet around the first match. Newlines become spaces, and `…` is added at cut ends.

`src/view/link-suggest.js`:
- `SUGGEST_SELECTOR = "textarea.excalidraw-wysiwyg, input.excalidraw-hyperlinkContainer-input, input.plexus-mm-input"`.
- `createLinkSuggest({doc, api, zIndexFor = (el) => 1000, debounce = {page: 60, block: 150}, setTimeout, clearTimeout})` returns `{attach(el) → detach, dispose()}`.
- `installSuggestAutoAttach({doc, suggest})` returns a dispose function.
  - One `focusin` capture listener on `doc` attaches `suggest` to targets that match `SUGGEST_SELECTOR` and sit inside `.excalidraw-outer-container`, or are themselves `.plexus-portal`.
  - It detaches on that element's `focusout` (deferred by one tick, and skipped if the element is focused again) and on dispose.
  - At most one element is attached at a time.
- **Listeners on the element, all removed on detach:**
  - `input`: recompute the trigger, then open, update or close the menu.
  - `keydown` in capture phase (`addEventListener("keydown", fn, true)`). At the target, capture listeners run before Excalidraw's `onkeydown` property and the mind map's bubble listener. It acts only while the menu is open and not composing (`e.isComposing` or `keyCode 229`):
    - ArrowDown / ArrowUp, and Ctrl-n / Ctrl-p, move the active row.
    - Enter and Tab pick the active row.
    - Escape closes the menu only.
    - Every key it handles gets `preventDefault()` and `stopImmediatePropagation()`. Nothing else is touched.
  - `keyup` (arrows, Home, End) and `click` re-check the trigger for caret moves.
  - `blur` closes the menu.
- **Search.**
  - Pages: `api.data.async.search({"search-str": q, "search-pages": true, "search-blocks": false, limit: 12})`.
  - Blocks: `{"search-str": q, "search-pages": false, "search-blocks": true, "hide-code-blocks": true, limit: 12}`. Then pull each result's page title with `data.pull("[{:block/page [:node/title]}]", [":block/uid", uid])`.
  - Debounce per kind. A monotonic sequence number drops stale responses.
  - An empty query makes NO call. It shows a single dim row, "Search for a page" or "Search for a block".
  - An error shows the row "Search failed" and logs a `[plexus]` warning.
- **Menu.**
  - It uses Roam's exact markup and classes (see the measured facts), plus the classes `plexus-portal plexus-suggest` on the root.
  - It is fixed-positioned, appended to `doc.body`, with z-index `zIndexFor(el) + 10`.
  - Size: 400 px wide, scroll area max height 300 px, font inherited from Roam.
  - Page rows show the title with match segments. Block rows show `blockSnippet` with match segments, plus the page title in the grey ellipsis line.
  - The footer title is "Page search" or "Block search", and its action is "Insert reference ⏎".
  - The active row is the first one by default and scrolls into view on arrow moves.
- **Mouse.**
  - The menu root's `mousedown` calls `preventDefault()`, so the element never blurs. Excalidraw would otherwise submit the text, and the mind map would commit.
  - `mousemove` over a row makes it active.
  - `click` on a row picks it.
- **Picking.**
  - Compute `applyPick`, then set the value through the prototype setter: `Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, v)`. The hyperlink input is React-controlled.
  - Then call `el.setSelectionRange(c, c)` and dispatch `new InputEvent("input", {bubbles: true, inputType: "insertReplacementText"})`, falling back to `Event` when needed. Then close.
  - No results: a page query inserts `[[query]]` on Enter, and Roam creates the page when the text is saved. A block query closes the menu on Enter.
- **Position.**
  - Mirror-div caret measurement in the element's own untransformed box. The mirror copies font, padding, border, letter-spacing, white-space, line-height and width.
  - `scale = rect.width / el.offsetWidth`, or 1 when that is not finite.
  - `left = rect.left + (x - el.scrollLeft) * scale`, and `top = rect.top + (y + lineHeight - el.scrollTop) * scale + 4`.
  - Flip above the caret line when the menu would overflow the bottom. Clamp to the viewport horizontally.
  - Reposition on every `input`, and on window `resize` or `scroll` (capture) while open.
- **Cost.** When no trigger is present, an `input` event costs one `findTrigger` call on the current line; there is no DOM work and no search.

## U2. Region-ref presentation

`src/host/theme.js`:
- `isHostDark(doc)` returns true if `doc.body` or `doc.documentElement` has the class `bp3-dark`.
- Otherwise it checks the measured luminance of the first non-transparent `background-color`, walking from `body` up to `html`. Roam paints only `body`. Relative luminance below 0.4 counts as dark.
- Otherwise it returns false. There is NO `prefers-color-scheme` fallback (GUARDRAILS: the OS hint is not the host).
- The result is memoized for 1000 ms.

`src/view/crop-popover.js`:
- `createCropPopover({doc, delayMs = 300})` returns `{hoverOn(anchorEl, getEntry), hide(), dispose()}`.
- The portal is `div.plexus-portal.plexus-crop-popover`, fixed-positioned with `pointer-events: none`.
- It shows the crop at up to 480×360, placed below the anchor, flipped above when there is no room, and clamped to the viewport.
- It hides on `mouseleave`, `scroll` or `mousedown`.
- `hoverOn` returns a disposer.

`src/view/regionref.js`:
- **Context of each claimed button:**
  - If the button is inside `span.rm-block-ref`, `refEl` is that span (`btn.closest(".rm-block-ref[data-uid]")`), and `refUid` is the region uid.
    - `blockUid` (the referencing block) is `host.blockUidFromNode(refEl.parentElement)`. Do NOT pass `refEl` itself: `blockUidFromNode` returns the nearest `.rm-block-ref[data-uid]` first, so it would return the region uid. For a ref nested inside another block ref, this yields the outer ref's uid, which is the block whose string holds `((region))`.
    - Measured: the block-ref menu's `block-uid` for a top-level ref equals this value (`IHwMrCb5q` for the ref in `elsewhere: ((a9jeT2IqV))`).
    - The context is `refContext(host.pullBlock(blockUid)?.string ?? "", refUid)`.
  - Otherwise the context is `"home"`. That covers the region block itself and `{{embed: ((uid))}}` renders.
  - `mode = resolveDisplay({context, override: settings.refOverrides[overrideKey(blockUid, refUid)], inlineDisplay: settings.inlineDisplay})`.
- **`image` mode.**
  - The root is `display: block` with `margin: 2px 0 4px`. The crop's max height is `figureHeight`, and its max width is 100%.
  - In a block ref, `refEl` gets the classes `plexus-ref-card plexus-mode-image`. The card is `display: inline-block; vertical-align: top; max-width: 100%; padding: 4px 6px; border: 1px solid <border>; border-radius: 6px`, with `font-size: 0.85em` for the caption and no underline.
  - The caption flows under the crop inside the card, because the block-level root forces the line break.
- **`thumbnail` mode.**
  - Same card, with the class `plexus-mode-thumbnail`.
  - The crop's height is exactly `thumbHeight`, with width auto and max width `4 * thumbHeight`, using `object-fit: contain`.
  - `crop-popover` shows the full crop on hover.
- **`link` mode.**
  - No crop and no card.
  - The root becomes a 14 px inline glyph (`span.plexus-ref-glyph`, an inline SVG of a frame corner, `currentColor`) followed by Roam's caption as it renders.
  - Hovering the ref shows the crop through `crop-popover`, rendered on demand through the existing cache and render path.
- **Dark theme.** Drawing-kind crops (not `imgrect` or `imgpoly`) get the class `plexus-crop--invert` when all of these hold:
  - `settings.darkCrops` is true;
  - `isHostDark(doc)`;
  - the drawing's `appState.theme !== "dark"`;
  - no image element's bounds intersect the region's scene bbox.

  The CSS is `filter: invert(93%) hue-rotate(180deg)`, which is Excalidraw's own dark filter.
- **Placeholder size.** It follows the mode: `image` uses the `figureHeight` cap, `thumbnail` uses `thumbHeight`, and `link` has no placeholder.
- **Clicks.** Unchanged: click opens the region, and Shift toggles the sidebar per setting.
- **New renderer API:**
  - `refreshAll()`: re-evaluate every claimed root in place. Remove the root and the card classes, un-claim, and `claim(btn)` again.
  - `refreshBlock(blockUid)`: the same, only for roots whose `refEl` sits in that block.
  - `refreshRegion(regionUid)`: the same for roots of that region. First delete its `svg` and `png` cache keys for the current drawing hash, and clear its `failed` entry.
  - `modeOf({blockUid, refUid})` returns the mode `claim` would use (for the menus).
  - `releaseAll()` also removes the card classes and disposes the popover hovers.
- **Presence.** All new DOM carries `plexus-` classes. No inline style may set colors; colors live in the CSS, in light and dark variants that follow the existing `.bp3-dark` / `body.bt-theme-dark` rules in `extension.css`.

## U3. Right-click menus and a settings dialog

`src/view/settings-dialog.js`:
- `openSettingsDialog({doc, get, set, onChanged, zIndex})` opens `dialog.plexus-portal.plexus-settings` with `showModal`. If one is already open, it is focused instead.
- Fields, bound to the settings ids above:
  - Image height (number)
  - Thumbnail height (number)
  - Region refs inside text (select: Thumbnail / Link)
  - Match dark theme (checkbox)
  - Open regions in sidebar (checkbox)
- It saves on `change` through `set(id, value)`, then calls `onChanged()`.
- It closes on the Close button or Esc.
- It stops `keydown`, `keyup`, `keypress`, `mousedown`, `pointerdown`, `wheel` and `paste` from propagating to Roam and Excalidraw, the same way as `legacy-dialog`.
- It returns `{close}` and is closed on unload.

`src/view/context-menus.js`:
- `installRoamMenus({api, host, actions, regionref, getSettings, setRefOverride, openSettings})` returns a dispose function that removes every label it added.
  - **`blockRefContextMenu`.** Every entry has `display-conditional` = "`ref-uid` is a supported region" (`parseRegion(host.pullBlock(ref)?.string)?.supported`), plus the extra condition listed:
    - "Plexus: Open region": `actions.openRegion(ref, {sidebar: false})`
    - "Plexus: Open region in sidebar": `{sidebar: true}`
    - "Plexus: Show as image", "Plexus: Show as thumbnail", "Plexus: Show as link": each shown only when it differs from `regionref.modeOf({blockUid, refUid})`. Each calls `setRefOverride(blockUid, refUid, mode)` and then `regionref.refreshBlock(blockUid)`.
    - "Plexus: Use default display": shown only when an override exists. It calls `setRefOverride(…, null)` and refreshes.
    - "Plexus: Refresh crop": `regionref.refreshRegion(ref)`
    - "Plexus: Region settings…": `openSettings()`
  - **`blockContextMenu`.** This moves the existing three registrations here from `extension.js`:
    - "Plexus: Region on image" gains a `display-conditional`: `parseImageRefs(string).length > 0`.
    - "Plexus: Present frames" is unchanged: drawing blocks only.
    - "Plexus: Mind map from outline" is unchanged.
    - New, on region blocks: "Plexus: Open region" and "Plexus: Refresh crop".
    - New, on drawing blocks: "Plexus: Refresh crops" (`actions.refreshCropsForDrawing(uid)`) and "Plexus: Region settings…".
  - Every callback catches errors and logs `[plexus]`. No conditional throws; a throw counts as false.
- `installCanvasMenu({doc, app, containerEl, getItems, raf})` returns a dispose function.
  - `getItems()` returns `[{id, label, run, enabled: bool}]`.
  - It listens for `contextmenu` on `containerEl` (bubble, passive). Up to three `raf` ticks later, it finds `containerEl.querySelector(".popover > ul.context-menu")` that is not yet marked `data-plexus-menu`.
  - It then appends `hr.context-menu-item-separator`, plus one `li[data-testid="plexus-<id>"] > button.context-menu-item[type=button] > div.context-menu-item__label + kbd.context-menu-item__shortcut` (empty) for each enabled item.
  - A click runs `preventDefault`, `stopPropagation`, `app.setState({contextMenu: null})` (guarded), and then `run()`, with errors caught.
  - After appending, if the `.popover`'s bottom is below `innerHeight - 8`, set its `style.top` to `max(8, innerHeight - 8 - height)`.
  - Nothing else in Excalidraw's menu is touched. React owns the `ul` and removes our nodes with it.

## Integration (unit I, after U1–U3)

- **`extension.js`:**
  - Wire `createLinkSuggest` and `installSuggestAutoAttach`. `zIndexFor` returns `baseZIndex(doc, outer)` when the element is inside `.excalidraw-outer-container`; otherwise it returns the parsed z-index of the element, or 1000.
  - Wire `installRoamMenus` and remove the three inline `blockContextMenu` registrations.
  - Wire `openSettings` to `openSettingsDialog`, with `onChanged` calling `regionref.refreshAll()`.
  - Pass `createSettingsPanel({onChange: () => regionref.refreshAll()})`.
  - On each editor mount, run `installCanvasMenu` with these items, reusing the toolbar predicates (disposed with the editor):

    | id | label | enabled when |
    |---|---|---|
    | `region` | Plexus: Create region | the selection is non-empty |
    | `frame` | Plexus: Frame region | `canFrame` |
    | `crop` | Plexus: Region from crop | `canCrop` |
    | `image` | Plexus: Image region | exactly one image element is selected |
    | `embed` | Plexus: Embed block from clipboard | always |
    | `edit-embed` | Plexus: Edit embed | `canEditEmbed` |
    | `present` | Plexus: Present | `canPresent` |
    | `mindmap` | Plexus: Mind map | always |
    | `settings` | Plexus: Region settings… | always |

  - Add a command-palette entry "Plexus: Region settings".
- **`actions.js`:**
  - `openRegion` zooms with `native.zoomTo(app, bbox, {maxZoom: 1})`, which matches Excalidraw's own zoom-to-fit cap.
  - Add `refreshCropsForDrawing(uid)`, the drawing-uid form of the existing open-drawing refresh.
- **CSS.** The three marker sections merge into `extension.css`. Nothing may conflict with the existing `.plexus-root.plexus-regionref` rules; update or remove them where U2 supersedes them.
- **Version.** Bump `package.json` to 0.6.0 and add a CHANGELOG entry.
- **Gate.** `npm run check` passes.

## File ownership (parallel)

| Unit | Owns (create or edit) | Reads only |
|---|---|---|
| F | `src/model/refdisplay.js`, `src/settings.js`, `test/refdisplay.test.js`, `test/settings.test.js` (new or extend), `src/extension.css` (markers only) | everything |
| U1 | `src/model/suggest.js`, `src/view/link-suggest.js`, `test/suggest.test.js`, `test/view-link-suggest.test.js`, CSS marker `p6:suggest` | F |
| U2 | `src/host/theme.js`, `src/view/crop-popover.js`, `src/view/regionref.js`, `test/host-theme.test.js`, `test/view-crop-popover.test.js`, `test/view-regionref.test.js` (extend; keep passing), CSS marker `p6:regionref` | F |
| U3 | `src/view/settings-dialog.js`, `src/view/context-menus.js`, `test/view-settings-dialog.test.js`, `test/view-context-menus.test.js`, CSS marker `p6:menus` | F, the U2 API names above |
| I | `src/extension.js`, `src/actions.js`, `package.json`, `CHANGELOG.md`, `test/extension.test.js`, `test/actions*.test.js`, CSS merge | all |

Units never run `git commit`. The orchestrator commits.

## Gates

- `npm run check` is green at every hand-off. The existing tests stay green, and the new tests cover every pure function and every listener/cleanup path.
- Unload leaves nothing behind:
  - no `.plexus-suggest`, `.plexus-crop-popover` or `.plexus-settings` in the DOM;
  - no `plexus-ref-card` class on any element;
  - every Roam menu label removed;
  - no document or window listeners left.
- **Live acceptance** (orchestrator, Readwisenotes only, trusted CDP input):
  1. On the refs page the ref shows as a tidy card. A standalone ref gives an image card. A ref inside text gives a thumbnail card, and hovering it shows the full crop. The dark theme inverts the drawing crops.
  2. Right-clicking a region ref and opening Extensions › shows the Plexus items. "Show as link" turns the ref into a glyph plus caption, and "Use default display" restores it.
  3. In an open drawing, a text element with `[[plex` shows the picker. Arrows move the active row, Enter inserts `[[Plexus]]`, and the text element keeps editing. `((` shows block results. Escape closes only the menu. A click on a row picks it without ending the text edit.
  4. The same works in the mind-map input and the element hyperlink input.
  5. Right-clicking the canvas shows the Plexus section. "Create region" with a selection makes a region. The menu closes.
  6. Opening a region zooms to at most 100%.
  7. Unloading the dev build leaves nothing behind.

## Amendments (critic, binding)

These override the body where they conflict. Code references are to `dad685f`.

### F

A1. `parseOverrides(value)` accepts a JSON string or a plain object. `readSettings` memoizes the parsed map on the raw stored value (one entry) and returns a frozen object, so a page of claims does not re-parse 500 entries per claim. Test: two `readSettings` calls on the same raw string return the same object.
A2. Number settings: a blank, non-numeric or non-finite stored value falls back to the default before clamping, then rounds to an integer (`""` gives 280, not 80). Test `""`, `"abc"`, `"50"`, `"5000"`, `"300"` for both heights.
A3. `withOverride`: setting an existing key deletes it and re-inserts it, so "oldest insertion" means least recently set; eviction takes keys from the front of `Object.keys`.
A4. `setRefOverride` serializes per `extensionAPI` (promise chain in a `WeakMap`). Each call reads only after the previous write settles, and it resolves after its own write. Test: two concurrent calls on different keys both persist.
A5. `createSettingsPanel({onChange})`: every wrapped `action.onChange` calls `onChange()` with NO arguments, inside try/catch. Depot passes a React event for input/switch and a string for select; nothing may read it. The select's `items` are the stored values `["thumbnail", "link"]`, because Depot shows items verbatim. `createSettingsPanel()` with no argument must keep working, since `extension.js` calls it that way until I lands.
A6. U1, U2 and U3 edit `src/extension.css` at the same time. Each unit changes it only with an exact-string Edit of its own marker line; never Write the whole file; re-read and retry on a conflict.

### U1

A7. Only an `input` event that is not composing (`!e.isComposing`) and yields a trigger can OPEN the menu. `keyup` (ArrowLeft, ArrowRight, Home, End only) and `click` can update the query of an open menu or close it; they never open it, so clicking into an existing `[[link]]` pops nothing. A recheck that returns the same `{kind, start, query}` is a no-op: the active row stays and no search runs.
A8. Arrows, Enter, Tab and Escape are handled only with no modifier (`!metaKey && !ctrlKey && !altKey && !shiftKey`). Ctrl-n and Ctrl-p require `ctrlKey` alone. Cmd-Enter, Shift-Tab and the rest pass through untouched.
A9. A query that is blank after trim makes no search call (Roam throws on blank). With an empty query, "Search failed", or no block results, Enter and Tab close the menu and are consumed. Only a non-empty page query with zero results inserts `[[query]]`. Strike "Roam creates the page when the text is saved": Excalidraw text and link fields live in `:block/props`, not a block string, so no page is created. Only the mind-map input's text becomes a block string. U1 never writes pages.
A10. `applyPick` also replaces the rest of an existing token. If the text after the caret matches `^[^\n\[\]()]*` followed by the kind's closer, replace through that closer. Test: `"[[Plex|us]] x"` picking Plexus gives `"[[Plexus]] x"`, with the caret after `]]`.
A11. The sequence number is bumped on every trigger change, close, detach and dispose, and debounce timers are cleared on close, detach and dispose. A response that arrives after close never reopens the menu. Test this with a deferred search promise.
A12. Liveness. Excalidraw's submit drops `onblur` before it removes the textarea, and the mind map's `removeInput` removes its listeners before `el.remove()`. Whether blur or focusout fires when a focused element is removed depends on the engine. So close and detach whenever `el.isConnected` is false at a debounce fire, a search resolution, a reposition, or a 300 ms timer tick while the menu is open.
A13. Mouse, following the pattern in `toolbar.js:44-47`:
   - Menu root: `pointerdown` calls stopPropagation. `mousedown` calls preventDefault and stopPropagation. `click` calls stopPropagation.
   - Rows keep Roam's `dont-unfocus-block` class.
   - The pick runs synchronously in the row's `click`.
   - `mousemove` activates a row only when `clientX`/`clientY` differ from the last mousemove the menu saw. Chrome sends a synthetic mousemove when the list scrolls under a resting pointer, and that would steal the keyboard selection.
A14. Canvas pan and zoom move the text editor without any DOM scroll event. While the menu is open, a window `wheel` listener (capture, passive) closes the menu when the target is outside it. The `scroll` capture listener ignores targets inside the menu.
A15. Caret mirror:
   - It copies `direction, boxSizing, width, height, overflowX, overflowY, border{Top,Right,Bottom,Left}Width, borderStyle, padding*, fontStyle, fontVariant, fontWeight, fontStretch, fontSize, fontFamily, lineHeight, textAlign, textTransform, textIndent, letterSpacing, wordSpacing, tabSize, whiteSpace, wordBreak, overflowWrap`. Bound text is centered, so `textAlign` matters.
   - Its content is the text before the caret, followed by a `span` holding the rest of the text (or "."). The caret position comes from the span's offsets.
   - It is appended and removed inside one call. `lineHeight: normal` counts as 1.2 × fontSize.
   - For `input` elements, only x comes from the mirror (`white-space: pre`), and `top = rect.bottom + 4`.
   - If `|rect.width/offsetWidth − rect.height/offsetHeight| > 0.02` (rotated text), place the menu at `rect.left, rect.bottom + 4`.
A16. Menu z-index is `Math.max(zIndexFor(el) + 10, 1010)`. An inline, non-full-screen editor can get a tiny base from a Roam ancestor.
A17. Setting the value:
   - Walk the prototype chain from `Object.getPrototypeOf(el)` to find the `value` setter; if there is none, assign `el.value`.
   - Take event constructors from `doc.defaultView` (`InputEvent`, else `Event`). Node 20 has no `InputEvent`.
   - After dispatching, call `setSelectionRange(c, c)` again if `el.value === v`, because Excalidraw's `oninput` may normalize the value.
A18. All window access goes through `doc.defaultView` (listeners, `innerHeight`, `getComputedStyle`), and window listeners exist only while the menu is open. Tests must not rely on Node's `EventTarget` for capture-versus-bubble order: Node runs listeners in insertion order, and the mind-map input registers its keydown before we attach. Assert that handled keys get `preventDefault` and `stopImmediatePropagation` and unhandled keys get neither. Ordering is left to live acceptance steps 3 and 4.

### U2

A19. Nested refs. The menu's `block-uid` for a ref nested in another ref was not measured.
   - At claim time, record both `blockUid` (per the body) and `outerUid = refEl.closest('[id^="block-input-"]')?.id.slice(-9) ?? null`.
   - Override lookup is `overrides[key(blockUid)] ?? overrides[key(outerUid)]`.
   - `refreshBlock(uid)` matches either value.
   - `modeOf({blockUid, refUid})` returns the current mode of a connected root with that `refUid` whose `blockUid` or `outerUid` matches. Otherwise it computes the mode from a pull.
A20. A null `blockUid` (for example `renderString` output in the canvas embed overlay, which has no block-input ancestor) gives context `"inline"` and skips the override lookup. Buttons inside `.plexus-portal.plexus-embed` never resolve to `image`; use `thumbnail` instead.
A21. `test/p2-review.test.js` is not U2's file and must stay green unchanged. It passes `getSettings: () => ({maxCropHeight, openInSidebar})` and a `doc` with no `body` or `defaultView`, and its fakes have no `removeEventListener`.
   - Missing `figureHeight`, `thumbHeight`, `inlineDisplay`, `refOverrides` and `darkCrops` fall back to 280, 72, `"thumbnail"`, `{}` and `true`.
   - `isHostDark` returns false without `body`.
   - The popover portal is created lazily on first show.
   - Every removal uses `removeEventListener?.`.
A22. `refreshAll`, `refreshBlock` and `refreshRegion` iterate a snapshot (`[...roots]`). `claim` inserts into `roots`, so live iteration would re-visit new roots forever. Entries with `btn.isConnected === false` are dropped, not re-claimed. Test: `refreshAll` over 2 roots leaves exactly 2 roots.
A23. `refreshRegion(uid, {purge = true} = {})` is async:
   - It awaits `Promise.all` of the `cache.delete` calls (svg and png; png only for image kinds).
   - It deletes the failed entry `${region.drawingUid}|${hash}`.
   - Then it re-claims. Re-claiming before the IDB delete settles reads the old crop back through `cache.get`.
   - `{purge: false}` only re-claims. It is used after a hot-SVG refresh, which a purge would delete.
A24. Link mode does no crop work at claim: no `cache.get` and no render. Only a hover that outlives `delayMs` runs peek, then get, then `renderRegionCrop`, then `cache.put`, with the same persist rule as claim.
A25. Popover behavior:
   - `getEntry` runs at show time and re-peeks the cache. An entry seen at claim time may since have been LRU-evicted, with its blob URL revoked.
   - A result that arrives after hide or mouseleave is dropped (use a token).
   - `img.onerror` hides the popover.
   - z-index is 100001, the same tier as `.plexus-hover`.
   - The `scroll` listener (window, capture) and the `mousedown` listener (doc, capture) exist only while the popover is shown.
A26. `isHostDark` checks these markers in order: `html.bp3-dark`, `body.bp3-dark`, `body.bt-theme-dark`, `.rm-dark-theme` on html or body, `body.roam-body.dark`. Only after those does it sample luminance. Auto mode stamps no `.bp3-dark` (roam-plugin-dev rule 17).
A27. Invert uses two classes, so a live theme toggle works without a re-claim.
   - JS sets `plexus-crop--invertible` when `darkCrops`, the kind is a drawing kind, the drawing theme is not dark, and no image overlaps the region.
   - JS adds `plexus-crop--invert` when `isHostDark(doc)` is true at paint.
   - CSS applies the filter to `.plexus-crop--invertible.plexus-crop--invert`, and to `.plexus-crop--invertible` under the marker selectors from A26.
A28. Card CSS:
   - Use `span.rm-block-ref.plexus-ref-card` (and `:hover`) so the rules beat Roam's and the theme's `.rm-block-ref` underline and hover fill.
   - The border is `1px solid rgba(138,155,168,.45)` with `background: transparent` in every state, including hover. This neutral grey reads on light and dark, so there is no theme branch and no tinted fill.
   - New rules contain no `@media (prefers-color-scheme)` and no `:has()` (rules 5 and 15).
   - The root also gets `plexus-regionref--image`, `--thumbnail` or `--link`, so image mode's `display: block` beats the existing `.plexus-root.plexus-regionref {display: inline-block}` without waiting for I's cleanup.

### U3

A29. `legacy-dialog` stops no key events (only button clicks), and `present.js` exempts Escape and Tab; neither is the model. The settings dialog adds bubble listeners that call `stopPropagation()` for keydown, keyup, keypress, input, paste, copy, cut, mousedown, pointerdown, wheel and click. That includes Escape: stopPropagation does not block the native `cancel`. All of these listeners are removed on close.
A30. Dialog colors:
   - Add a `dark` parameter to `openSettingsDialog`. When it is true, the dialog gets `plexus-settings--dark`.
   - The CSS sets BOTH color and background in each variant (`#fff`/`#1c2127` and `#252a31`/`#f6f7f9`) plus `color-scheme: light|dark`, so native inputs match.
   - Do not copy `.plexus-legacy`'s `color: inherit` on a white background: on dark it gives light text on white.
A31. Field values and closing:
   - Number fields write `String(clamped integer)`, the same type the panel stores. Checkboxes write booleans. The select writes `"thumbnail"` or `"link"`.
   - Close and Esc first commit any field whose value differs from the stored one; otherwise a number that was typed but not blurred is lost. Then call `onChanged()` once if anything was written.
   - `zIndex` is used only when `showModal` is missing.
A32. Menu conditionals:
   - Each menu keeps one memo keyed by `${ref-uid}|${block-uid}` (by `block-uid` for `blockContextMenu`), with a 500 ms lifetime. It holds `{string, supported, mode, hasOverride}`, so all conditionals in one menu opening share one pull.
   - Pull with `api.data.pull("[:block/string]", …)`, not `host.pullBlock`, which also pulls children.
   - A missing uid gives false.
   - A missing `api.ui.<menu>` is skipped, not thrown.
   - Dispose removes every label even if an `addCommand` rejected.
A33. Override callbacks use the event's `block-uid` verbatim. They `await setRefOverride(...)`, then clear the memo, then call `regionref.refreshBlock(blockUid)`.
A34. Canvas menu:
   - On every `contextmenu`, poll up to three rafs for the menu `ul`. Remove any of our nodes already in it (`[data-plexus-item]`, set on every injected node), then append fresh nodes from a new `getItems()`.
   - Do not skip a `ul` because it is marked. React appends new items after foreign nodes, so a reused `ul` would leave our section stale or mid-list.
   - Take `caf`. Dispose cancels pending rafs and removes injected nodes.
   - `run()` is called synchronously in the click handler, after `setState`, with no await or raf before it. "Embed block from clipboard" needs the user activation for `clipboard.readText`.
A35. The popover clamp is a delta in the popover's own coordinates. Compute `over = rect.bottom − (innerHeight − 8)`. When `over > 0`, set `style.top = parseFloat(style.top) − min(over, rect.top − 8)` in px. Excalidraw's `.popover` top is relative to its container, so assigning a viewport value misplaces the menu whenever the editor is not at the viewport origin.

### I

A36. Pass `createSettingsPanel({onChange: scheduleRefresh})`, where `scheduleRefresh` is a 300 ms trailing debounce of `regionref.refreshAll()`.
   - It is late-bound, because `regionref` is created after the panel, and it is a no-op outside Roam.
   - Its timer is cleared on unload.
   - The debounce absorbs input `onChange` firing on every keystroke, and Depot possibly calling `onChange` before it stores the value.
A37. `refreshCropsForDrawing(uid)`:
   - When `native.activeEditor(doc)?.drawingUid === uid`, run the existing hot-SVG body, then call `refreshRegion(r, {purge: false})` for each refreshed region.
   - Otherwise, await `refreshRegion(r)` for each supported region in `host.regionsOf(uid)`. The hot path needs an open app.
   - Give `createActions` a late-bound `refreshRegion` option, the same pattern as `getEmbedOverlay`.
   - The existing "Refresh crops for open drawing" command also re-claims this way. Today its refs keep the old crop until Roam re-renders them.
A38. Wire `openSettings` with `dark: isHostDark(doc)`, and close the dialog through `lifecycle.add`: a `showModal` dialog left open keeps an inert backdrop over the page (rule 14). The canvas menu's `region` predicate is `native.selectedElementIds(app).length > 0`. `zIndexFor` follows A16.

### Gates

A39. Parallel units must not run `npm run check` or `npm test`. Both run `build.mjs`, which deletes `deploy/` and rewrites the root artifacts, so concurrent runs race, and `verify:generated` sees other units' half-finished edits. Units run `node --test $(ls test/*.test.js | grep -v '/build.test.js$')`. The orchestrator runs `npm run check` only at the serial hand-offs: after F, after U1–U3, and after I. The unload gate also requires no `[data-plexus-item]` in the DOM.
A40. Live acceptance additions:
   - (a) Right-click a region ref nested inside another block ref. Record the menu's `block-uid`, and confirm that "Show as link" changes that ref.
   - (b) With the picker open in a full-screen text element, Escape and Enter neither end the text edit nor close the editor. Capture listeners from Roam and React are invisible to the tests.
   - (c) The card class survives hovering the ref and clicking its caption.
   - (d) Toggling the Roam theme to dark and back flips the crop invert without a reload.
