# Plexus Phase 9: Roam onto the canvas (binding)

Repo `~/roam-plexus`, HEAD `3de96cd` (code 0.8.0, `e933104`). Target 0.9.0. No Compass change.

Scope and designs: [`roadmap-next.md`](roadmap-next.md) §5 P9. That covers AUTH-11, AUTH-1, AUTH-4, AUTH-18, AUTH-5, AUTH-3, EMB-4, UX-7, UX-1, and the P9 live gate.

**EMB-3 is dropped from P9 by its own stop rule** (spike below); it moves to Later. That section is binding except EMB-3. This contract adds the measured facts, names and file ownership.

The P6-P8 contracts and amendments still bind. The usual rules apply:
- zero dependencies, plain JS, `node --test` fakes, `[plexus]`;
- never throw into Roam; everything is removed on unload;
- no `window.confirm`/`alert` (Electron native dialogs block the renderer);
- scene writes go through the P8 write guard (`guardedWrite`);
- no drawing props writes except through Excalidraw.

## Measured facts (2026-09-29, Readwisenotes `1929…`, trusted CDP)

- **EMB-3 spike, FAILED.**
  - The test: `roamAlphaAPI.ui.components.renderString({el, string: "{{[[query]]: {and: [[TODO]] [[plx-q-spike]]}}}"})` in a visible host.
  - It showed "0 results". After creating a TODO that matched, it still showed 0 after 3 s. After marking it DONE, still 0.
  - A fresh `renderString` of the same string then showed "1 results".
  - Conclusion: queries rendered through `renderString` are a static snapshot, so EMB-3 does not ship in P9.
- **Utilities.** `roamAlphaAPI.util` has `generateUID`, `pageTitleToDate`, `dateToPageTitle` ("September 29th, 2026"), `dateToPageUid` ("09-29-2026") and `uploadFile`.
- **Slash commands.** `roamAlphaAPI.ui.slashCommand` has `addCommand` and `removeCommand`.
- **Default hotkeys.** `roamAlphaAPI.ui.commandPalette.addCommand({label, callback, "default-hotkey": "alt-shift-y"})`: Alt+Shift+Y fired the callback (trusted key). The `extensionAPI.ui.commandPalette` passes the same option.
- **Multi-select menu.** `roamAlphaAPI.ui.msContextMenu` has `addCommand` and `removeCommand`. Its items appear under the multi-select menu's **Plugins ›** submenu. The callback argument shape was not captured. Use `arg?.blocks` when it is an array of `{"block-uid"}`, else `roamAlphaAPI.ui.multiselect.getSelected()`, whose rows carry `block-uid`. Order by outline order (`:block/order` within parent), not by selection order.
- **Semantic search.** `roamAlphaAPI.data.semanticSearchEnabled()` returns `false` in Readwisenotes, so AUTH-1's "Related" section must be feature-detected and hidden.
- **Earlier facts.**
  - The command palette works over the full-screen editor; it renders behind it.
  - `mainWindow.getOpenPageOrBlockUid()` settles after routing.
  - `captureUpdate: "IMMEDIATELY"` records undo.
  - Roam's Excalidraw is 0.18.0.

## Shared names

- **Settings** (unit K owns `src/settings.js` and `src/view/settings-dialog.js`):
  - `paste-refs`: `"text"` / `"embed"` / `"link"`, default `"text"` → `pasteRefs`
  - `card-home`: `"drawing"` / `"page"` / `"daily"`, default `"drawing"` → `cardHome`
  - `drawing-name`: default `"Drawing {date}"` → `drawingName` (tokens `{date}`, `{page}`, `{n}`)
  - The dialog gains a read-only "Shortcuts" section (UX-1). It lists Plexus hotkeys and the native keys confirmed in spec §13.
- **Hotkeys** (Alt+Shift only, never a single letter): `alt-shift-r` region, `alt-shift-i` image region, `alt-shift-p` present, `alt-shift-m` mind map, `alt-shift-e` embed page or block, `alt-shift-n` new note card.
- **Actions** (unit A owns `src/actions.js` and `src/host/roam.js`):
  - `newDrawing({where: "here" | "below" | "page" | "today"})` → uid. It holds a web lock per target and reuses an existing drawing for "today" (via `drawingsOn`). On a daily page the drawing is a plain child, never inside another extension's container.
  - `embedFromPick({ref, scenePoint})` drops a live embed anchor (`makeEmbedAnchor`); page refs take the page-embed path.
  - `createPageAndEmbed(title, scenePoint)`
  - `placeBlocks(uids, {mode: "embed" | "link"})`: a grid at the viewport centre, all selected, one `insertElements` behind the guard snapshot. It asks in-page (not `confirm`) above 30 and caps at `NODE_CAP` 500.
  - `newNoteCard(scenePoint)` creates a block under a collapsed `{{[[plexus-cards]]}}` container of the drawing (lock plus deterministic container uid, the `ensureRegionContainer` pattern) or under `cardHome`. It embeds the block and opens the P5 editable flow. `discardIfUntouched(cardUid)` deletes only that block when its string is still empty.
- **`src/model/dates.js`** (new, P): `parseNaturalDate(text, now)` → `Date | null` for today, tomorrow, yesterday, weekday names, "next <weekday>", "Sep 30" and "30 Sep". It is pure, and the caller formats the result with `util.dateToPageTitle`.
- **`src/view/embed-picker.js`** (new, P): `openEmbedPicker({doc, api, anchorRect, zIndex, onPick({kind, ref, title}), onCreate(title), semantic})` returns `{close}`. It is a standalone Roam-style search portal built on the `link-suggest` markup and search. Its last row, "+ Create page <query>", runs only on explicit Enter or click. A "Related" section appears only when `semantic` is true.
- **`link-suggest`** (P):
  - UX-7: natural-date rows and the "+ Create page" row (explicit pick only; skipped if the title exists case-insensitively).
  - AUTH-4: `onEmbedPick(pick)` fires on Shift+Enter while the menu is open. The link-suggest side strips the trigger (`applyPick` with an empty replacement) and commits the text. The caller drops the embed below the edited element.
- **`src/view/paste.js`** (new, E): `installRefPaste({containerEl, app, getSettings, onRef({kind, ref, scenePoint, shift})})` is a capture-phase paste on the mounted editor.
  - It acts only when `pasteRefs !== "text"`, the clipboard text is a single `((uid))` or `[[Page]]` (`parseEmbedRef`), no text element is being edited, and Shift is not held.
  - Everything else passes through untouched.
- **`src/view/note-tool.js`** (new, E): `installNoteTool({containerEl, app, onPlace(scenePoint)})`. Alt+Shift+N arms the tool, the next canvas click calls `onPlace`, and Esc disarms it.
- **EMB-4, today embed** (E, in `src/model/embeds.js` and `src/view/embeds.js`):
  - `parseEmbedRef` accepts `plexus:today`.
  - The overlay resolves it with `util.dateToPageTitle(new Date())` at render and again at local midnight (one timer per overlay), and it never collides with a page titled "today".
  - The anchor's `element.link` keeps a real `[[date]]` ref.

## Units and ownership (parallel; only targeted `node --test <files> < /dev/null`; never `npm run check`/`npm test`/build)

| Unit | Owns | Items |
|---|---|---|
| A | `src/actions.js`, `src/host/roam.js`, their tests | AUTH-11, AUTH-1 action side, AUTH-5, AUTH-3 action side |
| P | `src/view/embed-picker.js`, `src/view/link-suggest.js`, `src/model/suggest.js`, `src/model/dates.js`, their tests, CSS marker `/* == p9:picker == */` | AUTH-1 picker, AUTH-4, UX-7 |
| E | `src/view/embeds.js`, `src/model/embeds.js`, `src/view/paste.js`, `src/view/note-tool.js`, their tests, CSS marker `/* == p9:embeds == */` | EMB-4, AUTH-18, AUTH-3 tool |
| K | `src/view/context-menus.js`, `src/view/toolbar.js`, `src/settings.js`, `src/view/settings-dialog.js`, their tests | UX-1 hints and shortcuts list; menu items: page and block menu "New drawing here / below", multi-select menu "Place on open drawing", canvas menu "Embed page or block…"; settings |
| I | `src/extension.js`, `test/extension.test.js`, `package.json`, `CHANGELOG.md`, `test/build.test.js`, CSS merge, `docs/spec-plexus.md` §13 (spike results), `docs/roadmap-next.md` (EMB-3 moved to §6.1 Later with the spike evidence) | palette commands with `default-hotkey`, the "/Sketch here" slash command, paste and note-tool install per editor, wiring; 0.9.0 |

## Gate

The roadmap-next P9 live gate, items 1-5 and 7. Item 6 becomes: the today card re-resolves at a simulated midnight (the query-node part is dropped with EMB-3). There is no STOP gate: all tests run in Readwisenotes.

## Amendments (critic, binding)

These override the body where they conflict. Code references are to `3de96cd`. "Source" marks Excalidraw behavior read from the research checkout (`~/excalidraw-port-research/excalidraw`, 0.18.105) and not re-measured on Roam's 0.18.0; A26 measures those items.

### A

A1. `newDrawing({where, uid, open = true})`.
   - `uid` comes from the menu or slash event. Otherwise read `api.ui.getFocusedBlock()?.["block-uid"]` synchronously, before any `await`.
   - "here" is the first child (order 0) of the target. "below" is a sibling at the target's `:block/order` + 1 under the same parent (a top-level block's parent is its page). "page" and "today" are A2 and A4.
   - Refuse with a toast and no write in these cases:
     - here or below with no target: "Click into a block first";
     - an editor is mounted: "Close the open drawing first";
     - the target or its parent string starts with `{{[[plexus-`, or the target is a region block.
   - Never write the target block: not its string, not `:block/open`.
   - `host.createDrawing` gains an additive `order` option (default `"last"`). Its `{title}` behavior, where an existing `Drawings/<title>` page is reused, stays for the public `create` (`test/p2-review.test.js` is not A's file).
   - Emit `{uid, kind: "drawing"}`.
   - Open with `openDrawing(uid, {reuseIcon: true})`. The opener must also open an empty drawing: S5 shows "Click to start editing" (`.excalidraw-container > div`), which may have no `.bp3-icon-fullscreen`. When there is no icon, click that placeholder. When the new block has not rendered within 1.5 s (for example under a collapsed parent), navigate with `openBlock`. If it still fails to open, keep the block and toast "Drawing created; open it from the outline".
A2. Daily pages.
   - When the target's page is a daily page (uid `^\d{2}-\d{2}-\d{4}$`), here and below place the drawing as a top-level child directly after the target's top-level ancestor. That applies roadmap Roam rule 4 to every mode.
   - "today" is a top-level child with order `"last"`. Reuse applies only to a direct child of today's page whose string starts with a drawing macro, the first one by order. `drawingsOn` does not count, because it matches nested blocks (for example a drawing inside a schedule block).
   - A missing daily page is created as `{title: util.dateToPageTitle(d), uid: util.dateToPageUid(d)}`, never with `generateUID`.
   - Export `host.ensurePage(title)`. When `util.pageTitleToDate(title)` (guarded) returns a date, it uses that daily uid. It backs `createPageAndEmbed`, every create row (P2, P3) and the `card-home` daily option.
A3. Double invoke.
   - Only one `newDrawing` runs at a time: `once("new-drawing")`.
   - It holds the Web Lock `lockName(graph, "new:" + key)`, where the key is the parent uid, `today:<dateUid>` or `page:<title>`. It is never the drawing lock of a block, because Web Locks are not re-entrant.
   - "today" re-checks for reuse inside the lock.
   - For 2 s after a completion, the same where and key returns the earlier uid and only opens it.
   - A lock that is not acquired toasts and writes nothing.
A4. Page mode. The title is `Drawings/<name>`, built from `drawingName`:
   - `{date}` is `dateToPageTitle(now)`. `{page}` is the title of the main window's page (`host.openPageUid`), or empty. `{n}` is the smallest n ≥ 1 whose title is unused.
   - Strip `[[`, `]]`, `#` and newlines, then collapse spaces. A blank result falls back to `Drawing {date}`.
   - Without `{n}`, an existing title gets " 2", " 3", and so on. Page mode always makes a new page.
   - Existence is an exact `[:node/title]` pull inside the A3 lock.
A5. Cross-unit safety and single embeds.
   - A must not rely on E's new `parseEmbedRef` kind or a `makeEmbedAnchor({link})` parameter (P8 A32). Match `ref === "plexus:today"` literally and set `elements[0].link` itself. `editEmbedOnce` refuses any `ref?.kind !== "block"` as read-only.
   - `embedFromPick({ref, scenePoint, app})` and `createPageAndEmbed(title, scenePoint, {app})`:
     - `scenePoint` is the anchor's centre, defaulting to the viewport centre.
     - `app` is captured when the picker opens. If `native.activeEditor(doc)?.app !== app`, toast "Drawing closed" and write nothing.
     - A block ref must resolve with a pull.
     - A today anchor uses the label "Today", `customData.plexus.embed: "plexus:today"` and `link: [[<today's title now>]]`.
   - `createPageAndEmbed` calls `host.ensurePage`, then polls `pageUidByTitle` for up to 2 s before inserting, so the overlay's first pull finds the page.
   - Every P9 scene write goes through `guard.guardedWrite` with a function `next`, `captureUpdate: "IMMEDIATELY"` and the selection in `appState`. It does not use `native.insertElements`. Adds push no snapshot (P8 A5), so Ctrl+Z is the undo.
A6. `placeBlocks(items, {mode = "embed", scenePoint})`.
   - Items are uids or refs (`((uid))`, `[[Title]]`). The link-mode paste (E) needs refs.
   - Dedupe, and drop an item whose ancestor is also in the list. Order by document order: the path of `:block/order` values from the page down, with parents memoized. Drop blocks that do not exist.
   - Embed mode is capped at 30. Each anchor is a live portal with up to 30 `renderString` roots plus a pull watch, and rule 5 caps watches at 150. Above 30, show the P8 toast action "Place N as links".
   - Link mode is capped at `mindmap?.NODE_CAP ?? 500`. Above that, place the first 500 and toast.
   - Link nodes are free text elements:
     - `fontFamily` 5, `fontSize` 20, `lineHeight` 1.25;
     - the text is the plain label (refs and brackets stripped, at most 60 characters);
     - the width comes from an injected `measure` after an injected `ensureFonts` (at most 500 ms);
     - `link` is the ref.
   - The grid has `ceil(sqrt n)` columns. The cell is the largest item plus a 40 px gap, and the grid is centred on `scenePoint`.
   - One guarded write, everything selected, one undo step. No graph writes, no lock, and never the injected `confirm`.
A7. Multi-select without an open editor (the full-screen editor covers the outline).
   - `armPlace(uids, {mode})` stores the ordered list and toasts "Open a drawing, then right-click the canvas: Place N blocks here".
   - Also `pendingPlace() → {count} | null`, `placePending(scenePoint)` and `cancelPendingPlace()`.
   - Pending clears on apply, on a new arm, on `dispose` and after 10 minutes. It survives editor unmount.
   - With an editor mounted, the menu places at once.
A8. `newNoteCard(scenePoint)`.
   - Refuse when there is no editor, `drawingUid` is null, the overlay is not idle, or `editingTextElement` is set.
   - `card-home` "drawing":
     - `host.ensureCardsContainer(drawingUid)` runs under the drawing lock. The container gets the deterministic uid `c${hash(drawingUid)}`, distinct from the regions container's `p…`, with the string `{{[[plexus-cards]]}}` and `open: false`. It is recovered on a create error like `ensureRegionContainer`.
     - The card is created in the same lock with the string `""` and order `"last"`.
     - Never call `createRegion` inside that lock.
   - `card-home` "page" is a top-level last child of the drawing's `:block/page`. "daily" follows A2.
   - Remember each created uid in memory. Insert the anchor (label "Note") through the guard.
   - Wait for E's `overlay.hasPortal(id)` (poll for up to 1 s), then `overlay.edit(id, {onLeave})`.
A9. `discardIfUntouched(cardUid)`.
   - It acts only on uids this session's `newNoteCard` created. It runs from `onLeave`, which is after Roam's save wait (E3).
   - It re-pulls the block. The card is untouched when its trimmed string is `""` and it has no children.
   - When untouched:
     - delete the block with `data.block.delete({block: {uid}})`;
     - remove its rect and bound text through the guard (`NEVER`, so the discard adds no undo step or restore-ring entry; deviation from the original `IMMEDIATELY`), and only when the same app is still the active editor.
   - Triggers `escape`, `enter`, `pointer`, `focus-lost` and `error` discard. `removed` deletes only the block. `unload`, `hidden` and `api` keep the card.
   - An editor unmount keeps both the block and the anchor, which is a consistent state.

### P

A10. `parseNaturalDate(text, now)`.
   - Case-insensitive, whole-string only; any trailing text gives `null`. Never `Date.parse` (Chrome reads "sep 30" as 2001).
   - Forms:
     - `today`, `tomorrow`, `yesterday`;
     - weekdays, full or a prefix of at least 3 letters (`mon`, `tues`, `thur`, `thurs`);
     - `next <weekday>`;
     - `Sep 30`, `30 Sep`, `September 30`, `sept 30`, each with an optional `st`/`nd`/`rd`/`th`.
   - A bare weekday and `next <weekday>` both mean the next occurrence 1-7 days ahead, never today. That is the owner's Plexus Canvas meaning (`pxcParseNaturalDate`).
   - Month-day uses the year of `now`. An invalid day (`Feb 30`) gives null.
   - The result is `new Date(y, m, d)` at local midnight.
   - Tests pin `now` = Tuesday 2026-09-29 and cover a DST boundary.
A11. Rows in both pickers. Order:
   1. exact case-insensitive title matches;
   2. the date row (page queries only), titled `api.util.dateToPageTitle(date)` and absent when `util` is;
   3. the other results;
   4. "+ Create page".

   A 3-letter weekday or month abbreviation that also prefixes a result title puts the date row after the results ("sat" must not beat "Saturn notes").

   Create row:
   - It is never the default active row, unless it is the only row.
   - It is hidden when a result or `pull [:node/title q]` matches q case-insensitively. There is no full-graph lowercase query on the input path.
   - The title is trimmed with spaces collapsed. It may not contain `[[`, `]]` or a newline, or exceed 250 characters.

   In link-suggest, this supersedes P6 A9's "U1 never writes pages":
   - `createLinkSuggest({createPage, onEmbedPick})`.
   - Picking the create row inserts `[[title]]` synchronously through the P6 pick path, then calls `createPage(title)` without awaiting in the key handler.
   - `((` gets no date or create rows.
A12. AUTH-4 Shift+Enter is handled only when all of these hold: the menu is open, not composing, `onEmbedPick` is set, the target is `textarea.excalidraw-wysiwyg`, and the active row is a result, date or create row. In the hint, loading or error state it is consumed as a no-op. Everywhere else it passes (P6 A8). Order:
   1. Call `onEmbedPick({kind, ref, title, uid, create, el})` synchronously, so the caller reads `editingTextElement` before the commit. A throw is caught.
   2. Strip with the new pure `stripTrigger(text, caret, trigger)` in `suggest.js`. It removes the trigger and query plus the closer tail from P6 A10.
   3. Set the value and dispatch `input` as in `pick`.
   4. Close, then call `el.blur()`: Excalidraw's `onblur` submits.

   Never dispatch a synthetic Escape. It bubbles to Roam, which can close the full-screen editor.
A13. Embed picker.
   - The input class is `plexus-portal plexus-picker-input`, not `plexus-mm-input`, because `SUGGEST_SELECTOR` would attach link-suggest on top of it. The root has the rm-autocomplete classes plus `plexus-portal plexus-picker`.
   - Single instance: opening while open refocuses it.
   - It opens on the next frame and focuses. If focus is lost within 200 ms (the palette or Excalidraw refocusing), it retakes focus once. A later blur closes it.
   - The root stops pointerdown, mousedown (also preventDefault) and click, as in P6 A13.
   - The input stops keydown propagation for every key, Escape included. Per the source, Excalidraw's document keydown still handles Escape from writable targets. Esc closes the picker.
   - Search:
     - a blank query makes no call;
     - a `((` prefix searches blocks only and a `[[` prefix pages only;
     - otherwise pages and blocks run in parallel (limit 8 each);
     - stale responses are dropped by sequence number;
     - a `((uid))` or bare uid query that resolves adds a direct row.
   - A "Today (always today)" row (kind `today`, ref `plexus:today`) shows when the query is empty or a prefix of "today" of at least 2 characters.
   - It closes before calling `onPick` or `onCreate`. z-index is `max(zIndex, 100003)`. Window listeners exist only while it is open.
   - `semantic` is evaluated by I on each open: `await api.data.semanticSearchEnabled?.() === true`. Only then does P call `api.data.async.semanticSearch?.()`, in try/catch with a 1500 ms timeout. A failure hides the section. It is unverified live, and the CHANGELOG says so.

### E

A14. The today token.
   - `parseEmbedRef` returns `{kind: "today", ref: "plexus:today"}` only for an exact trimmed `plexus:today`, so `[[today]]` stays a page ref. Export `TODAY_REF`.
   - `makeEmbedAnchor({link})` is optional and defaults to `ref`.
   - `host.pullEmbedContent` (A's file) does not know the token. The overlay's `load()` resolves it to `[[${util.dateToPageTitle(now())}]]` before calling it.
   - A missing page paints "Today · <date>" with "No notes yet", never "Block not found", and creates nothing.
   - Re-resolving releases the old watch.
A15. Midnight.
   - One timer per overlay, armed only while at least one today portal exists. Its delay is the smaller of 60 minutes and the time to the next local midnight (`new Date(y, m, d + 1)`).
   - When it fires, compare the resolved title and reload today portals only when it changed, then re-arm.
   - A `visibilitychange` listener (on doc, only while a today portal exists) re-checks, covering sleep and background throttling.
   - Inject `now`, `setTimeout` and `clearTimeout`. Dispose clears the timer and the listener.
   - Nothing writes the scene: `element.link` keeps the creation date.
A16. Overlay hooks.
   - `edit(id, {onLeave})`. Split today's `"keyboard"` trigger into `escape`, `enter` and `focus-lost` (the body-focus fallback). All three keep the keyboard-leave steps 3 and 7.
   - `onLeave({trigger})` runs once, after step 5 (after the 300 ms save wait), with errors caught.
   - Add `hasPortal(id)`.
   - A page ref whose pull returns null retries at 300 ms, 1 s and 3 s before painting not-found.
   - Pull watches are capped at 150 (rule 5). Beyond that, a portal renders once without a watch, and the cap is logged once.
A17. `installRefPaste({doc, containerEl, app, getSettings, exists, onRef})`: a capture `paste` listener on `containerEl`.
   - It acts only when all of these hold (the first four mirror Excalidraw's own paste gate, per the source):
     - `pasteRefs !== "text"`, read on every event;
     - the target is not an input, textarea or contenteditable, and `editingTextElement` is not set;
     - `doc.elementFromPoint` at the last pointer position is a canvas inside `containerEl`. The listener tracks that position with its own passive `pointermove`.
     - there are no files;
     - trimmed `text/plain` is exactly `((uid))` or `[[Title]]`. Bare uids and `plexus:today` are refused, because a pasted 9-letter word such as "Something" matches the uid pattern.
     - `exists(ref)` (a synchronous pull) is true;
     - it is not a plain paste.
   - Plain means Shift was held on a Ctrl/Cmd+V keydown seen in capture on `containerEl` within the last 100 ms. That is Excalidraw's `IS_PLAIN_PASTE` window; a `ClipboardEvent` carries no `shiftKey`. Excalidraw's context-menu Paste dispatches no DOM paste event and is untouched.
   - Acting means preventDefault and stopPropagation, then `onRef({kind, ref, scenePoint})`, where `scenePoint` is the last pointer position in scene coordinates.
   - Multi-line pastes pass through. The AUTH-5 outline paste is Later, and the CHANGELOG says so.
A18. `installNoteTool({doc, containerEl, app, canArm, onPlace})` returns `{arm, disarm, armed, dispose}`.
   - It binds no Alt+Shift+N. The palette `default-hotkey` is the only key path; I calls `arm()`. This rules out double arming.
   - While armed, capture pointerdown, pointerup, mousedown, mouseup and click on `containerEl` when the target is `canvas.excalidraw__canvas.interactive`, it is the primary button, and there are no modifiers. Call preventDefault and stopImmediatePropagation.
   - Movement under 4 px places the note on pointerup and disarms. A longer drag keeps the tool armed. A non-canvas target passes through and disarms.
   - Esc disarms and is swallowed.
   - The cursor comes from `body[data-plexus-note-armed]` with an `!important` rule under `p9:embeds`. Never add a class to Excalidraw's React-owned nodes.
   - Disarm on `editingTextElement`, after 30 s, on unmount and on dispose. Listeners exist only while armed.

### K

A19. Settings and shortcuts.
   - `paste-refs` items are `["text","embed","link"]`, `card-home` items `["drawing","page","daily"]`, and `drawing-name` is an input. Unknown or blank values fall back to the defaults.
   - Dialog fields: "Paste refs as", "New note cards go" and "New drawing page name". The last is a new `text` field type, committed on Close and Esc (P6 A31).
   - `settings.js` exports `HOTKEYS` (id, spec, label) and `formatHotkey(spec, {mac})`. It uses Excalidraw's own kbd wording: "Shift+Alt+R", and "Shift+Option+R" on macOS.
   - The Shortcuts section lists `HOTKEYS`, Alt+← (Back) and F2 (Edit embed). Native keys appear only from a measured spec §13 row; at `3de96cd` there are none. Add the line "Defaults. Change them in Roam Settings › Hotkeys."
A20. Roam menus.
   - blockContextMenu:
     - "Plexus: New drawing here" and "Plexus: New drawing below" call `actions.newDrawing({where, uid: e["block-uid"]})`.
     - They are hidden on drawing, region and `{{[[plexus-` strings, and on children of a Plexus container. The parent string comes from a memoized pull, as in P6 A32.
   - pageContextMenu: "Plexus: New drawing on this page" uses `e["page-uid"] ?? pageUid(e["page-title"])` and `where: "here"` with order `"last"`. It is a no-op with a warning when neither exists.
   - msContextMenu: "Plexus: Place on drawing" has no display-conditional.
     - Use `arg?.blocks` (an array of `{"block-uid"}`). Otherwise call `multiselect.getSelected()` as the first statement, with no await before it.
     - Then `actions.placeBlocks(uids)` with an editor mounted, else `actions.armPlace(uids)`.
A21. Canvas menu and toolbar.
   - `installCanvasMenu` records the `contextmenu` event's `clientX`/`clientY` and passes them to `getItems(point)`.
   - `plexusCanvasItems` gains `point`, `openPicker(point)` and `noteAt(point)`. New items:
     - `embed-picker`: "Plexus: Embed page or block…";
     - `note`: "Plexus: New note card", placed at the click point with no arming;
     - `place-pending`: "Plexus: Place N blocks here", while `pendingPlace()` is set.
   - `kbd` comes from `HOTKEYS`.
   - Toolbar:
     - "Embed block" becomes "Embed…" and opens the picker. The clipboard path stays in the canvas menu.
     - Add a "Note" button that arms the tool.
     - Every button with a hotkey gets it in `title`.
   - CSS goes under a new `/* == p9:ui == */` marker.

### I

A22. Hotkeys.
   - `"default-hotkey"` goes on these commands:
     - `alt-shift-r` on "Plexus: Create region from selection";
     - `alt-shift-i` on "Plexus: Create image region";
     - `alt-shift-p` on "Plexus: Present open drawing";
     - `alt-shift-m` on a new "Plexus: Mind map" (editor mounted: `startMindMap`; otherwise the focused block: `mindMapFromOutline`);
     - `alt-shift-e` on a new "Plexus: Embed page or block…";
     - `alt-shift-n` on a new "Plexus: New note card" (`arm()`).
   - Existing labels do not change.
   - Every hotkey callback goes through `runOnce(id)`, a 300 ms dedupe. With an editor mounted, it does nothing while `editingTextElement` is set or focus is in an input, textarea or contenteditable.
   - Per the source, Excalidraw's `viewMode` keyTest is `altKey && code === "KeyR"` with no Shift check. So per mount, install a capture keydown on `containerEl` for Alt+Shift+R/I/P/M/E/N. It matches by `code`, with no Ctrl or Meta, not composing, and the target must be `containerEl`. It calls preventDefault and stopImmediatePropagation, then `runOnce(id)`. The action runs once whichever listener Roam's hotkey uses.
   - I owns the new `src/view/hotkeys.js` and `test/view-hotkeys.test.js`.
A23. Slash command.
   - Get the API from `extensionAPI.ui.slashCommand ?? api.ui.slashCommand`. `lifecycle.command` throws without `addCommand` and `removeCommand`, so wrap the registration and skip it with a `[plexus]` warning; onload never fails on it.
   - The label is "Sketch here".
   - The callback reads `ctx?.["block-uid"] ?? getFocusedBlock()?.["block-uid"]` before any await, returns `undefined`, and calls `newDrawing({where: "here", uid})`.
   - If A26(a) shows that Roam leaves "/Sketch here" in the block, strip it through the focused `textarea.rm-block-input` (prototype setter plus an input event), never with `block.update`.
A24. Wiring.
   - Per mount, add paste, the note tool, the hotkey guard and the picker handle to `mounted.disposers`.
   - `createActions({measure, ensureFonts})` come from the existing measurer.
   - `onEmbedPick`:
     - Synchronously read `editingTextElement`, using its container's box when the text is bound.
     - After the commit (`editingTextElement` becomes null, waiting at most 500 ms), call `embedFromPick` or, when `create` is set, `createPageAndEmbed`, centred at (cx, maxY + 124).
     - Then call `containerEl.focus({preventScroll: true})`.
   - `createPage` is `host.ensurePage` with a failure toast.
   - `onRef` sends embed mode to `embedFromPick` and link mode to `placeBlocks([ref], {mode: "link", scenePoint})`.
   - P9 adds no `window.RoamPlexus` member; `apiVersion` stays 4.

### Gate

A25. Isolation.
   - New names reach other units only by injection.
   - Cross-unit imports are limited to modules as they exist at `3de96cd` (P8 A32).
   - New test files: `test/actions-p9.test.js` and `test/host-roam-p9.test.js` (A); `test/dates.test.js` and `test/view-embed-picker.test.js` (P); `test/view-paste.test.js` and `test/view-note-tool.test.js` (E).
   - Before fan-out, the orchestrator appends the `p9:picker`, `p9:embeds` and `p9:ui` markers. Edits are exact-string only (P6 A6).
A26. The orchestrator measures these before I lands and records them in spec §13 (Readwisenotes, trusted CDP, window focused):
   - (a) the slash callback's argument, and whether Roam removes "/Sketch here";
   - (b) the msContextMenu argument and the order of `getSelected`;
   - (c) an empty `{{[[excalidraw]]}}` block's DOM and how it opens;
   - (d) Alt+Shift+R with the canvas focused: exactly one region and `viewModeEnabled` unchanged. Also whether an Alt+Shift hotkey typed in a Roam block or an Excalidraw text inserts "‰" or "˜";
   - (e) the pageContextMenu argument;
   - (f) whether the full-screen editor covers the right sidebar (P8 A33(e) is still open).
   - Also for the live gate: the slash callback now returns "" so Roam removes the typed text (if it stays, fall back to the A23 strip); `getFocusedBlock` from the command palette (if it is null, "New drawing here / below" always toasts); all six hotkeyed commands from the palette with an editor mounted.
A27. Gate clarifications.
   - 1 adds two checks. "/Sketch here" in a daily-page block puts the drawing top-level, below that block's ancestor. A daily page created by "on today" has the uid `MM-DD-YYYY`.
   - 3: "under one lock" becomes "one guarded write, one undo step". It adds the pending path from the outline.
   - 4 adds three checks. A pasted "Something" and a pasted `((missing01))` stay text. Excalidraw's context-menu Paste is unchanged.
   - 5 uses Alt+Shift+N or toolbar Note, then a click. Esc and Enter on an untouched card each delete the block and its anchor. A card with typed text survives Esc.
   - 6 applies `Emulation.setTimezoneOverride` to a zone whose local date is tomorrow, then dispatches `visibilitychange`. The card retitles and `:edit/time` is unchanged.
   - 7 adds the unload checks. After unload there is no `.plexus-picker` and no `body[data-plexus-note-armed]`. The slash, page-menu and multi-select labels are removed.

## Live amendment L1 (2026-09-29, typing gate 7)

Gate 7 (typing +0 with the editor and picker closed) failed at +1.3 ms/key. Cause: Roam's keydown handler charges about 0.055 ms per keystroke for every palette command, and Plexus had 23 (spec §13, "Palette command cost"). This supersedes A22's palette list:
- The palette holds two entries: "Plexus: Commands…" (opens `src/view/command-list.js` with the focused block captured at invocation) and "Plexus: Mind map" (`alt-shift-m`, still rebindable in Roam Settings › Hotkeys).
- Every other former palette action lives in the command list, with the same callbacks.
- `installHotkeyGuard` listens on `doc` (capture) per editor mount, so Alt+Shift+R / I / P / E / N work while a drawing is open, including when focus fell back to `body`. `runOnce` absorbs the double path for Alt+Shift+M.
- The Shortcuts note reads: "Mind map is a Roam hotkey: change it in Roam Settings › Hotkeys. The other keys work while a drawing is open."
