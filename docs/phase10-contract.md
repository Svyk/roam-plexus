# Plexus Phase 10: Think in bullets while drawing (binding)

Repo `~/roam-plexus`, HEAD `a5d6a97` (code 0.9.0, `64cd0e9`). Target 0.10.0. No Compass change.

Scope and designs: [`roadmap-next.md`](roadmap-next.md) §5 P10: NAV-7 (docked outline), AUTH-2 (drag onto the canvas), NAV-1 (clickable tokens in text), and the P10 live gate. This contract adds the measured facts, names, file ownership and the decisions below. The P6-P9 contracts and amendments still bind:
- zero dependencies, plain JS, `node --test` fakes, `[plexus]` log prefix;
- never throw into Roam; everything is removed on unload;
- no `window.confirm` / `alert` (Electron native dialogs block the renderer);
- scene writes go through the P8 write guard (`guardedWrite`);
- no drawing props writes except through Excalidraw;
- **no new command-palette entries** (P9 L1: each costs every keystroke). New actions go into the "Plexus: Commands…" list and the canvas/toolbar surfaces; new hotkeys go through the per-mount document guard.

## Spikes and measured facts (2026-09-29, Readwisenotes `1929…`, trusted CDP; spec §13 "Phase 10 spikes")

- **Spike A passed.**
  - A real `.rm-bullet` drag (main outline or right sidebar) carries `text/plain` " ", `text/uri-list` and `roam/roam-uri-list` (one `…/page/<uid>` line per dragged block and descendant), `roam/block-uid-list` (block + descendants) and `roam/block-uid-list-only-parents` (top-level dragged blocks).
  - Sidebar window headers drag with no data. Page titles are not draggable.
  - 20 drags (10 claimed drops, 10 cancels) left the source outline byte-identical including `:edit/time`; `dragend` fired each time; no block selection left.
  - A replayed Roam payload on the full-screen canvas: Excalidraw calls preventDefault on dragover and drop and adds nothing.
- **Editing is full-screen only.** `.excalidraw-outer-container.full-screen` is `position: fixed`, z 1000, and covers the whole window including the right sidebar. The inline block is a static preview (no Excalidraw app). **While drawing, the right sidebar cannot be a drag source; the dock is the only one.**
- **Spike B passed.**
  - A hand-built dock (fixed right panel, z 1002, `renderBlock`, bubble-phase `stopPropagation` of key and pointer events on the dock root) over the full-screen editor: typing, arrows, Enter, Tab, Shift+Tab stayed in Roam; `document` saw no keydown; the Excalidraw tool and a selected element were untouched.
  - Esc was swallowed by the stop, so Roam stayed in edit mode. After leaving to the canvas, Backspace deleted only the canvas element and "r" switched the tool; Roam blocks intact.
  - A plain `blur()` leaves `getFocusedBlock()` pointing at the dock block.
- **`renderBlock({uid, el, "open?": true})`** on a collapsed block renders its children and writes nothing (`:block/open`, `:edit/time` unchanged).
- **Key listeners with the editor open.** Roam hotkeys: `window` and `document` keydown, bubble (`route-app.js`, `main.js`). React roots: `body` and `#app`. Nothing on the full-screen container.
- **NAV-1 facts.**
  - Text elements store wrapped lines in `text` (newlines inserted) and unwrapped `originalText`; bound text has `containerId`; `fontFamily` 5 = Excalifont, 1 = Virgil; `lineHeight` 1.25; `textAlign`, `verticalAlign`.
  - Canvas `measureText` matches element widths within 0.5 px.
  - Cmd+click on a text element only selects it (no edit, no navigation).
- **Existing pieces to reuse.**
  - `actions.placeBlocks(items, {mode, scenePoint, app})` already places embeds or links at a scene point, one undo step.
  - `actions.openRegion(uid)` zooms in place when its drawing is the open editor.
  - `navigateToTarget({api, containerEl, target, sidebar})` in `src/host/links.js`.
  - `viewportToScene` / `sceneToViewport` in `src/model/scene.js`; `baseZIndex(doc, outerEl)` in `src/view/toolbar.js`.
  - The editable embed's leave in `src/view/embeds.js` (`ownsSelection` by `window-id` prefix `render-block-path-<uid>`, synthetic document Escape, container focus).

## Decisions

1. **Dock root.** The dock renders the **drawing block itself** with `"open?": true` and hides its own row (`.rm-block-main` of the root) and every `.excalidraw-outer-container` inside the dock, so the panel shows the drawing's children: the `{{[[plexus-regions]]}}` container, mind-map outline, note cards, notes. When the drawing's parent is a block (not a page), a header button "Parent" re-renders with the parent as root (same hiding rules). Never `renderPage`.
2. **The dock takes space, not the canvas's UI.** While open, the full-screen container is narrowed by the dock width (its previous inline `width`/`right` restored exactly on close), so Excalidraw's own right-edge UI is not covered. If Excalidraw does not pick up the new size (its `state.width` unchanged after 2 frames), fall back to overlaying and record it.
3. **Sidebar drops.** The drop handler accepts sidebar-format payloads (identical to the dock's), but the sidebar is covered while drawing. Gate item 4's sidebar part is tested with a payload captured from a real sidebar drag and replayed onto the canvas.
4. **NAV-1 trigger.** Cmd-click (macOS) / Ctrl-click (others) only. The roadmap's "click on an already-selected text box" is dropped: it would delay or break double-click editing. Cmd/Ctrl+Shift opens the sidebar.
5. **Hover.** Pointer cursor over a token only while Cmd/Ctrl is held. A token hover preview is optional (N may add it through an injected resolver in `hover-preview.js` only if that stays a small change; otherwise it moves to Later and the CHANGELOG says so).

## Shared names

- **Plexus ref MIME** `application/x-plexus-ref`: a single `((uid))` or `[[Title]]`. The dock's header label is draggable with it.
- **Settings** (unit I, `src/settings.js`): `dock-width` number, default 320, clamp 240-640 → `dockWidth`. Not in the settings dialog (the resize handle persists it).
- **Hotkey** (unit I): `alt-shift-o` "Outline dock" in `HOTKEYS`, `KeyO → "dock"` in `src/view/hotkeys.js` (document guard only; not a palette entry).
- **`src/view/dock.js`** (new, D): `createDock({doc, api, containerEl, outerEl, drawingUid, zIndex, width, onWidth(w), onClose(), parentOf(uid), addBlock(rootUid), toast})` → `{ el, isOpen(), close(), dispose(), setRoot("drawing" | "parent"), root() }`.
- **`src/view/drop.js`** (new, G): `parseRoamDrop(dataTransfer, {exists})` → `{ items: [{kind: "block", uid} | {kind: "page", title}] } | null`; `claimableTypes(types)` → boolean; `installRoamDrop({doc, containerEl, app, zIndex, onDrop({items, mode, scenePoint})})` → dispose.
- **`src/model/tokens.js`** (new, N): `findTokens(text)` → `[{kind: "page" | "block" | "tag", title?, uid?, start, end}]`; `alignWrapped(text, originalText)` → `Int32Array` map from `text` index to `originalText` index.
- **`src/view/text-links.js`** (new, N): `hitToken({element, point, measure})` → token | null; `installTextLinks({doc, api, app, containerEl, navigate({target, sidebar}), toast, zIndex})` → dispose.
- **Actions / host** (A): `placeBlocks(items, {mode: "embed" | "link" | "label", scenePoint, app})` gains `"label"`; `host.parentOf(uid)` → `{uid, isPage, title}` | null; `actions.addOutlineBlock(rootUid)` → new child uid (order "last", empty string).

## Designs

### D: `src/view/dock.js`
- DOM: `div.plexus-portal.plexus-dock` (z = `zIndex + 2`), fixed to the right edge of the full-screen container, full height. Header: label (drawing page title, or the parent block's text trimmed to 60 chars; `draggable=true`, carries the Plexus ref MIME), "Parent" toggle (only when `parentOf(drawingUid)?.isPage === false`), close button. A 6 px resize handle on the left edge (pointer capture; `onWidth` once on pointerup; clamp 240-640). Body host gets `renderBlock({uid: root, el: host, "open?": true})`; class `plexus-dock--hide-root` on the body while root is the drawing, `plexus-dock--parent-root` while root is the parent.
- Empty state: when the root has no children, a button "+ Add a block" calls `addBlock(root)`, then focuses the new block's textarea with the embeds' click-to-focus pattern (synthesized mousedown/mouseup/click on its `.rm-block__input`, 300 ms wait, never `setBlockFocusAndSelection`).
- Key and pointer ownership (Spike B):
  - On the dock root, bubble phase, `stopPropagation` (never `preventDefault`) for `keydown keyup keypress input paste copy cut pointerdown mousedown wheel dblclick contextmenu`.
  - Esc in a dock textarea with no Roam menu open (`ROAM_MENU_SELECTOR` from `embeds.js`, imported): `leaveEditing()` = blur the textarea; if the dock owns a Roam selection (`multiselect.getSelected()` rows with `window-id` starting `render-block-path-<root>`, or `.block-highlight-blue` inside the dock), dispatch one synthetic `document` Escape and re-check once after 100 ms; then `containerEl.focus({preventScroll: true})`. The dock stays open. A second Esc with nothing focused in the dock does nothing special (Excalidraw gets it).
  - No keyboard block selection from the dock: swallow Shift+ArrowUp at caret 0 and Shift+ArrowDown at the end (as the editable embed does).
  - `document` capture keydown while the dock is open: if the dock owns a Roam block selection and the target is outside the dock, swallow the key (preventDefault + stopImmediatePropagation) and clear the selection (synthetic Escape). This stops a Backspace from deleting Roam blocks and canvas elements together.
  - `containerEl` capture pointerdown while a dock textarea is focused → `leaveEditing()` without refocusing the container (the pointer does that).
  - Focus lost: `document` capture keydown with target `body` while Roam's focused block is in the dock → swallow and refocus that textarea once.
- Regions in the dock: region crops are claimed by the existing discovery/regionref path; activating one calls `openRegion`, which zooms in place. D adds nothing for this beyond making sure the dock does not stop `click` (only the events listed above).
- `close()`: leave editing, `unmountNode({el: host})`, remove listeners and DOM, restore the container's inline style, `onClose()`. `dispose()` = `close()` without `onClose`. Idempotent. Never throws.

### G: `src/view/drop.js`
- `claimableTypes(types)`: true when `types` includes `roam/block-uid-list-only-parents`, `roam/block-uid-list` or `application/x-plexus-ref`. (During dragover only `types` is readable.) `text/uri-list` alone, files and plain text are never claimed.
- `parseRoamDrop`: Plexus MIME first (`parseEmbedRef`), then `roam/block-uid-list-only-parents`, then `roam/block-uid-list` (drop uids that are descendants listed after their parent is present is not possible here without the tree: take the list as is; `placeBlocks` already skips descendants of listed blocks), then `roam/roam-uri-list` (`/page/<uid>` lines). Uids must match `^[\w-]{9}$` and `exists(uid)`; de-duplicate, keep order, cap 500. Returns null when nothing survives.
- `installRoamDrop`: capture `dragenter` / `dragover` / `dragleave` / `drop` on `containerEl`.
  - dragenter/dragover with claimable types: `preventDefault`, `stopPropagation`, `dropEffect = "copy"`, show a ghost chip near the pointer: "Embed" (no modifier), "Link" (Alt), "Label" (Shift). Update it on every dragover (DragEvent carries `altKey` / `shiftKey`).
  - Not claimable: do nothing (Excalidraw keeps file and library drops).
  - dragleave out of `containerEl` (relatedTarget outside) and `document` `dragend`/`drop`: hide the ghost.
  - drop with claimable types: `preventDefault` + `stopPropagation`; parse; empty → toast "Nothing to place"; else `scenePoint = viewportToScene({x: clientX, y: clientY, appState: {...app.state, offsetLeft, offsetTop}})` (offsets from the container rect, as `host/links.js` does) and `onDrop({items, mode, scenePoint})`.
  - Ghost: `div.plexus-portal.plexus-drop-ghost` at z `zIndex + 3`, `pointer-events: none`, removed on dispose.

### N: tokens and text links
- `findTokens(text)` on the unwrapped text: `[[Title]]` (outermost balanced; nested inner links stay part of the title), `#[[Title]]`, `#tag` (Roam tag chars `[\w\-/.:@]`, not after a word character, trailing `.:` excluded), `((uid))` (`[\w-]{9}`). Tokens never overlap; order by `start`.
- `alignWrapped(text, originalText)`: walk both; equal chars advance both; `text` "\n" against `originalText` " " advances both; `text` "\n" against anything else advances `text` only.
- `hitToken`: rotate the scene point into the element's frame about its centre (`angle`); lines = `text.split("\n")`; line height `fontSize * lineHeight`; line top `y + i * lineHeightPx`; line left by `textAlign` (left: `x`; center: `x + (width - lineWidth) / 2`; right: `x + width - lineWidth`); widths from `measure(str, font)` with the font map `{1: Virgil, 2: Helvetica, 3: Cascadia, 5: Excalifont, 6: Nunito, 7: "Lilita One", 8: "Comic Shanns", 9: "Liberation Sans"}` plus `, Xiaolai, sans-serif, Segoe UI Emoji`. A token wrapped over two lines is hit on either part.
- `installTextLinks`: capture `pointerdown` / `pointerup` on `containerEl`, same still-click limits as `installLinkInterception` (duplicate its two constants). Act only when trusted, left button, `metaKey` (macOS) or `ctrlKey` (others), no `editingTextElement`, and `app.getElementLinkAtPosition(point)` is empty (element links outrank tokens). Topmost hit: scene elements in reverse order; a text element whose rotated box contains the point, or a container whose bound text element (`boundElements` type "text") has tokens.
  - Token under the pointer → navigate (Shift → sidebar).
  - No token under the pointer but the element has exactly one → navigate to it; two or more → a chooser (`div.plexus-portal.plexus-token-chooser` at the pointer, `rm-autocomplete` row markup like the command list; Enter/click navigate, Shift+Enter/Shift+click sidebar, Esc or outside pointerdown closes).
  - Pages must exist (`:node/title` pull); blocks must exist; a missing target toasts "No page named …" / "Block not found" and does not navigate. Tags are pages.
  - On act: `preventDefault` + `stopImmediatePropagation` on pointerup.
  - Cursor: while Cmd/Ctrl is held and the pointer is over a token (passive `pointermove`, rAF-throttled, early return without the modifier), add `plexus-token-hover` to `containerEl` (CSS sets `cursor: pointer` on the interactive canvas); remove it otherwise and on keyup of the modifier.

### A: actions and host
- `placeBlocks` mode `"label"`: like `"link"` but the text element has no `link`; label text = the same `linkLabel(...)` text. One undo step, same caps.
- `host.parentOf(uid)`: pull `[{:block/_children [:block/uid :node/title :block/string]}]`; `{uid, isPage: title != null, title: title ?? string}` or null.
- `actions.addOutlineBlock(rootUid)`: create an empty child at order "last" through the existing write queue; return its uid; toast on failure.

### I: integration
- Per editor mount (`onEditorMount`): `installRoamDrop` → `actions.placeBlocks(items, {mode, scenePoint, app})`; `installTextLinks` with `navigateToTarget`; the dock controller (created on first open, disposed on unmount/unload). Dock open state is per session (not persisted); width persists in `dock-width`.
- Toolbar (`src/view/toolbar.js`): "Outline" toggle button with `aria-pressed`, hint from `hotkeyFor("dock")`.
- Command list: "Toggle outline dock" (hotkey hint) and "Outline dock: show parent".
- `src/view/discover.js`: ignore `.excalidraw` / `.excalidraw-outer-container` inside `.plexus-dock` (defensive).
- CSS merge from the units' snippets (`/tmp/wo/p10-css-<unit>.css`) into `src/extension.css` under `/* == p10:<unit> == */` markers.
- 0.10.0: `package.json`, `CHANGELOG.md`, README Commands/hotkeys, `test/build.test.js` version expectations.

## Units and ownership (parallel; only targeted `node --test <files> < /dev/null`; never `npm run check` / `npm test` / build)

| Unit | Owns | Items |
|---|---|---|
| D | `src/view/dock.js`, `test/view-dock.test.js`, CSS snippet `/tmp/wo/p10-css-dock.css` | NAV-7 |
| G | `src/view/drop.js`, `test/view-drop.test.js`, CSS snippet `/tmp/wo/p10-css-drop.css` | AUTH-2 drop side |
| N | `src/model/tokens.js`, `src/view/text-links.js`, `test/tokens.test.js`, `test/view-text-links.test.js`, CSS snippet `/tmp/wo/p10-css-links.css`; optionally `src/view/hover-preview.js` + its test (Decision 5) | NAV-1 |
| A | `src/actions.js`, `src/host/roam.js`, `test/actions-p10.test.js`, `test/host-roam-p10.test.js` | label mode, `parentOf`, `addOutlineBlock` |
| I | `src/extension.js`, `src/view/toolbar.js`, `src/view/hotkeys.js`, `src/settings.js`, `src/view/discover.js`, `src/extension.css`, their tests, `package.json`, `CHANGELOG.md`, `README.md`, `test/build.test.js` | wiring, settings, hotkey, toolbar, CSS merge, 0.10.0 (runs after D, G, N, A) |

## Gate

The roadmap-next P10 live gate, items 1-6, with Decision 3 for item 4's sidebar part. Plus:
- Typing +0 with the editor closed (P9 bench, 5 interleaved rounds).
- With the dock open: Esc in a dock block leaves no Roam editing and no block selection; a following Backspace on the canvas deletes only the selected canvas element (the 0.5.0 leak test, live).
- `test/view-embeds.test.js` "leave clears Roam block selection…" stays green.
- No STOP gate: all tests run in Readwisenotes.

## Amendments (critic, binding)

These amendments override the body wherever the two conflict. Code references point to `a5d6a97`. "Source" marks Excalidraw behavior read from the research checkout (`~/excalidraw-port-research/excalidraw/packages/excalidraw/components/App.tsx`, a 0.18 fork). Those items were not re-measured on Roam's build, and X1 measures them.

### D

**D1. Measure the dock's second copy of the drawing block before D starts.**
- Decision 1 renders the open drawing's own block a second time. Nothing measured says Roam's full-screen state belongs to one component instance. After `renderBlock({uid: drawingUid, "open?": true})` into a dock host, record three things:
  - how many `.excalidraw-outer-container.full-screen` exist (must stay 1);
  - whether any `.excalidraw` inside the dock has an App (`native.findApp`);
  - how long the hidden preview spends re-rendering across 10 strokes and one Roam save of the open drawing.
- If a second full-screen container or App appears, or the preview costs more than 5 ms per save, use the fallback. The fallback renders each direct child of the root with its own `renderBlock` and no root row. A `:block/children` pull watch re-renders the list. When Enter creates a new direct child, the watch re-renders and focuses the new block's dock copy with the click-to-focus pattern. Record the choice in spec §13. D2–D12 apply in both modes.

**D2. The `createDock` signature, header and controls.**
- The signature is `createDock({doc, api, app, containerEl, outerEl, drawingUid, zIndex, width, onWidth, onClose, parentOf, addBlock, toast, raf, setTimeout, clearTimeout, MutationObserver})`.
  - `app` is needed for the Decision 2 width check and for the canvas-selection snapshot (D3, D4).
  - Every timer and observer is injected so `node --test` can drive them.
- Header label and drag ref:
  - Drawing root: label = `parentOf(drawingUid).pageTitle` (A2); ref = `[[pageTitle]]`.
  - Parent root: label = the parent's text, cut to 60 characters; ref = `((parentUid))`.
  - `dragstart` sets `effectAllowed = "copyLink"`.
- Empty state: no watch and no pull per render.
  - A footer "+ Add a block" button is always present.
  - After `addBlock(root)` resolves, poll every 25 ms, for up to 1 s, for the `.rm-block__input` whose id ends with the new uid. Search inside the dock host only, then use the click-to-focus pattern.
- Header buttons, the label and the resize handle call `preventDefault` on `mousedown` (`toolbar.js:59`). A dock button that keeps focus receives the next canvas key, and the root stop eats it (for example "r" or Backspace).

**D3. Keys: keep Roam's menus usable and decide Esc in the capture phase.**
- The keydown/keyup stop on the dock root must be the editable embed's `stopKey` (`embeds.js:581-584`). Duplicate `MENU_KEYS` (`embeds.js:19`); do not edit `embeds.js`. Roam handles autocomplete navigation at `document`, so the contract's plain stop would leave the `[[`, `((` and `/` menus with no working keys.
- Take the "is a menu open?" snapshot for Esc in a **capture** listener on the dock root, before the host's React root runs. The embed does the same from `window` capture (`embeds.js:504-531`). A check at bubble time can find the menu already closed by that same Esc, and would then leave editing when the user only meant to close the menu.
- The menu test excludes tooltips and Roam's page/block hover previews. Blueprint tooltips also carry `bp3-popover`, and the hover preview's class must be measured live. Use `.rm-autocomplete__results, .bp3-menu, .bp3-overlay-open` plus `.bp3-popover` that is not `.bp3-tooltip` and not the hover preview.
- An Esc that bubbles because a menu is open reaches Excalidraw's `document` keydown: its writable-target bail exempts Escape (Source App.tsx:5465-5475). Unlike the embed (`embeds.js:624-625`), the dock keeps the canvas selection. So:
  - snapshot `selectedElementIds` and `selectedGroupIds` in capture;
  - if they changed by the next microtask and every id is still live, restore them with one `updateScene` (the pattern at `embeds.js:739-744`).

**D4. Leaving the dock must really end Roam's editing, and the dock must not eat its own synthetic Escape.**
- "No Roam editing" means no `textarea` inside the dock, and `getFocusedBlock()` does not name a dock block. A plain blur leaves it set (Spike B).
- Measure after the blur. If a textarea is still rendered, `leaveEditing` dispatches one synthetic Escape even when there is no selection. It then clears the resulting selection with the 100 ms recheck.
- Set a module flag while dispatching. The dock's own capture listeners ignore flagged events and untrusted keydowns. Without this, the D5 rule swallows the dock's own Escape and the selection never clears.
- Try dispatching on `window` first. Roam has `window` keydown listeners, and Excalidraw's listener is on `document` (Source App.tsx:3457-3460). If that clears the dock's selection, use `window`. Otherwise dispatch on `document`, wrapped in the D3 canvas snapshot/restore. Record which one in spec §13.

**D5. The selection rule must be synchronous and cheap.**
- The `document` capture keydown returns early when:
  - the target is inside the dock;
  - the event is untrusted or flagged (D4);
  - the target is inside a Roam menu or a `.bp3-portal`.
- It never calls `multiselect.getSelected()`, which is async (`embeds.js:669`). Inside keydown, "the dock owns a selection" means `dockEl.querySelector(".block-highlight-blue")`. The async window-id check (`render-block-path-<current root>`, re-read after `setRoot`) runs only in `leaveEditing`'s recheck.
- With a dock-owned block selection, focus is on `body`, so every key counts as "outside the dock". Swallow every key except Cmd/Ctrl+C. Excalidraw's copy handler ignores the event when its container is not active (Source App.tsx:3804-3810). Measure that the canvas clipboard stays untouched; if it does not, swallow Cmd/Ctrl+C too. Backspace/Delete on blocks selected in the dock are not supported in P10, and the CHANGELOG says so.
- A canvas `pointerup` while the dock owns a selection clears it with one synthetic Escape (D4). Otherwise the first canvas key after a drag-select is eaten.

**D6. Track editing in the dock with focus events, not `getFocusedBlock`.**
- `editing` is true after a dock `textarea` receives `focusin` and until focus moves to anything other than `body`. `leaveEditing` clears it.
- The "focus lost" rule (key with target `body` → refocus the dock textarea) applies only while `editing` is true and within 1200 ms (`embeds.js:15`) of the last trusted keydown in the dock. The stale `getFocusedBlock()` (Spike B) would pull canvas keys back into the dock after every Esc.

**D7. Boundary guards: no merging into, focusing, or moving blocks across the hidden root.**
- Swallow these keys (`preventDefault` + `stopImmediatePropagation`):
  - In the first rendered child: Backspace at caret 0 (Roam merges into the previous block, which is the hidden drawing/parent row, and would append text to `{{[[excalidraw]]}}`), ArrowLeft at 0, and ArrowUp at 0.
  - In the last textarea in the dock (DOM order): Delete at the end, and ArrowRight/ArrowDown at the end.
  - In any direct child of the root: Shift+Tab.
  - Alt+Shift, Cmd+Shift or Ctrl+Shift with ArrowUp on the first direct child, or with ArrowDown on the last direct child (`embeds.js:550`).
  - Cmd/Ctrl+A when the textarea is already fully selected (`embeds.js:537`).
- Safety net, a `document` capture `focusin`: if a textarea in the hidden root row, or a Roam block textarea outside the dock, gains focus within 500 ms of a trusted keydown in the dock:
  - blur it;
  - refocus the previous dock textarea at its old caret;
  - log once.
- Measure which keys Roam actually routes across the render root, and record the results.

**D8. Roam's editing hotkeys in the dock: measure, then let through only what is safe.**
- Spike B covered typing, arrows, Enter and Tab. Roam's global hotkeys sit on `window`/`document` in the bubble phase (spec §13), and the root stop silences them.
- Measure in a dock block: Cmd/Ctrl+Z, Cmd+Shift+Z, Cmd+Enter, Cmd+Up/Down, and the block-move chords.
- A chord that fails only because of the root stop bubbles when the target is a dock `TEXTAREA`. Excalidraw bails on writable targets for any key except Escape (Source App.tsx:5465-5475). Verify that the canvas selection, tool and undo history are unchanged.
- Record the matrix in spec §13. The CHANGELOG lists anything that cannot pass.

**D9. `close()`/`dispose()`: save before unmounting, cancel everything, return a promise.**
- If a dock textarea was focused: blur it, hide the dock, and remove the D10 narrowing immediately. Then wait `LEAVE_WAIT_MS` (300 ms) before `unmountNode` so Roam saves (`embeds.js:708-711`).
- `dispose()` returns that promise; `unmountEditor` collects promises (`extension.js:393-397`).
- `isOpen()` turns false at once. Cancel the focus polls, the add-block poll, the resize rAF, the D10 observer and the recheck timer.
- Reopening during a pending unmount uses a new host. `setRoot` while editing goes through the same leave-and-wait.

**D10. Narrowing: an owned class, a real resize, and restore by construction.**
- First record Roam's computed `left/right/width/inset` for `.full-screen` in spec §13.
- Narrow with an owned class `plexus-dock-narrowed` plus a `--plexus-dock-w` property on `outerEl`. The CSS rule is written against the recorded properties, with `!important` only if Roam sets them inline.
- Close removes only the class and the property. Never snapshot or write Roam's own inline styles. This replaces the contract's "restored exactly", which a Roam re-render in between would break.
- Excalidraw tracks container size through a ResizeObserver and a `window` resize listener (Source App.tsx:3293-3297, :3547). If `app.state.width` has not changed after 2 frames, dispatch one `resize` on `view` and wait 2 more frames. Only then fall back to overlaying.
- In overlay mode, the dock's top starts below `outerEl`'s `.bp3-icon-minimize` rect so the minimize button stays clickable.
- Effective width = clamp(setting, 240, min(640, innerWidth/2)). The clamped value is not persisted and is re-applied on `window` resize. A live drag applies at most once per rAF. `onWidth` fires once, on `pointerup` or `lostpointercapture`.
- A `MutationObserver` on `outerEl`'s `class` attribute disposes the dock synchronously when `full-screen` disappears. That covers the minimize click in `host/links.js:41` and Roam's own minimize.

**D11. Roam popups opened from dock blocks must be visible.**
- The `[[` autocomplete renders inside the mount's stacking context, and `overflow` cuts it off (phase5-contract.md:19, :300). The dock body scrolls, so:
  - when a `.rm-autocomplete__results` appears in the dock, scroll the body so its rect fits (`scrollIntoView({block: "nearest"})`); the body gets `padding-bottom: 320px` to make that possible;
  - if the live check at 240 px shows the menu running past the right edge, a scoped `.plexus-dock .rm-autocomplete__results { max-width: 100%; left: 0 !important }` applies.
- Measure where the `/` menu, `((` search, date picker, `{{` menu and bullet right-click menu render. Any popup in a `body > .bp3-portal` sits below z 1000. Raise those with `body.plexus-dock-open > .bp3-portal { z-index: calc(var(--plexus-dock-z) + 1) }`. The class and the variable exist on `body` only while the dock is open.

**D12. A bullet click in the dock must not close the drawing.**
- Measure whether a plain `click` on `.rm-bullet` in the dock zooms the main window, which destroys the full-screen editor.
- If it does, swallow plain bullet clicks in a capture listener on the dock root. Modified clicks and `dragstart` still pass.

### G

**G1. Items carry `ref`, and page uids become titles.**
- `parseRoamDrop` returns `{kind, uid?, title?, ref}`, where `ref` is `((uid))` or `[[Title]]`. `placeBlocks` reads `item.ref` from objects (`actions.js:452`). The contract's items have no `ref`, so every drop would toast "Nothing to place".
- Resolve each uid once with a `[:node/title :block/string]` pull. A page uid, possible in `roam/roam-uri-list`, becomes `{kind: "page", title, ref: "[[title]]"}`, because `blockPaths` silently drops pages (`host/roam.js:305, :324`). `exists` becomes `resolve(uid)` → `{kind, title?} | null`.
- Save the Spike A uid-list captures as test fixtures. The parser splits on any run of characters outside `[A-Za-z0-9_-]`.
- Remove the open drawing's own uid (`exclude` option). If that empties the list, toast "The drawing can't contain itself".

**G2. `dropEffect` must be allowed by the source, and the claim must win.**
- On dragenter, read `effectAllowed` (it is readable in protected mode). Set `dropEffect` to the first of copy, link or move that it allows; `all` or `uninitialized` → copy. If Roam allows only `move`, "copy" makes Chrome refuse the drop and `drop` never fires.
- Record Roam's value in spec §13, and re-run the 20-drop byte-identical check with the `dropEffect` that ships.
- A claimed dragover or drop calls `preventDefault` + `stopImmediatePropagation`. Excalidraw adds non-capture `dragover`/`drop` listeners on the same element as `containerEl`, plus a React `onDrop` (Source App.tsx:2238, :3556-3566). The capture stop covers drops on descendants; the immediate stop covers a drop whose target is `containerEl` itself.

**G3. Ghost cleanup uses a watchdog, not `relatedTarget`.**
- Show the ghost on the first claimable dragover, 12 px right and below the pointer, clamped to the viewport.
- Hide it when:
  - no dragover has arrived for 250 ms;
  - `document` `dragend` or `drop` fires (capture);
  - `window` fires `blur`;
  - the drop handler is disposed.
- Never rely on `dragleave.relatedTarget`. All listeners exist per mount only.

**G4. The mode comes from the drop event, and Shift beats Alt.**
- `mode = shiftKey ? "label" : altKey ? "link" : "embed"`, read from `drop`. The chip applies the same rule on dragover.
- Measure on macOS whether Option and Shift are reported on dragover and drop during a bullet drag in Roam's Electron.
  - If dragover lacks them, the chip shows static text: "Embed · ⌥ Link · ⇧ Label".
  - If drop lacks them too, macOS ships embed-only and the CHANGELOG says so.

**G5. The signature includes `toast`.**
- The signature is `installRoamDrop({doc, containerEl, app, zIndex, resolve, exclude, onDrop, toast, setTimeout, clearTimeout})`. The contract uses a toast but never passes one in.
- `claimableTypes` takes any array-like (`Array.from`).
- Tests use a fake DataTransfer whose `getData` returns "" during dragenter/dragover (protected mode).

### N

**N1. Claim the gesture on `pointerdown`, navigate on `pointerup`.**
- On `pointerdown` (capture on `containerEl`), if N2 holds and N3 finds tokened text: call `preventDefault` + `stopImmediatePropagation` and remember the hit.
- On the matching `pointerup`: swallow it, and navigate only on a still click (6 px, 400 ms).
- The reason: an Excalidraw that sees the pointerdown selects the element (measured) and opens a gesture. Stopping only the `pointerup` (the `host/links.js:106-107` pattern) leaves that gesture open. P1 gets away with it because navigating closes the editor. With Shift, the editor stays open and the next mouse move drags the text.
- A Cmd/Ctrl-click that hits no tokened text is never touched, so Excalidraw's deep select keeps working.

**N2. Every one of these conditions is required.**
- `isTrusted`, `button === 0`, `isCanvasEvent(e)` and `linksActive(app)` (`host/links.js:8-17`).
- The platform modifier comes from an injected `mac` flag, computed as in `extension.js:552`:
  - macOS: `metaKey && !ctrlKey` (Ctrl-click on macOS is the context menu);
  - others: `ctrlKey && !metaKey`.
- None of these is set: `editingTextElement`, `newElement`, `multiElement`, `selectedLinearElement?.isEditing`, `openDialog`, `openMenu`, `contextMenu`.
- The note tool is not armed (`note-tool.js:7`).

**N3. Topmost hit, and element links outrank tokens.**
- Walk `app.getSceneElements()` from the top, skipping frames. The first element whose rotated box contains the point decides:
  - a text element, or a non-linear container with bound text, is a candidate;
  - anything else ends the search with no action.
- An arrow label counts through its own text box only.
- If the hit text or its container has a non-empty `link`, NAV-1 does not act. Outside view mode, `getElementLinkAtPosition` reports only the link-icon hit, and nothing for a selected element (Source `hyperlink/helpers.ts:82-105`). So the contract's check is not enough on its own. This also rules out Plexus embed anchors.

**N4. N needs its own font-aware measurer.**
- `createMeasurer().measure(text, fontSize)` always measures Excalifont (`host/measure.js:3, :16`). Passing it a font string produces `NaNpx`.
- `text-links.js` has its own LRU (cap 2000, key `font|text`): `measure(str, font)` with ``font = `${fontSize}px ${FAMILY[fontFamily] ?? "Excalifont"}, Xiaolai, sans-serif, Segoe UI Emoji` ``. Line layouts are memoized per `id` + `version`.
- `host/measure.js` is not edited.

**N5. Geometry and wrapping.**
- Rotate the point by **−angle** about the text element's own centre. The bound text's own `x/y/width/height/angle` are authoritative, and `verticalAlign` is already baked into `y`.
- Tests: angle π/2, centre and right alignment, a wrapped token hit on both lines, and zoom independence.
- `alignWrapped`: when characters differ and the `text` character is not "\n", skip an `originalText` whitespace character. Any other mismatch returns `null`. On `null`, or when `originalText` is missing, run `findTokens` per stored line, and keep the single-token rule. Test doubled spaces at a wrap point.

**N6. Token grammar: Roam is the oracle.**
- Mask these before scanning: inline code, code blocks, URLs (`https?://\S+`) and `{{…}}`. Otherwise `…/#/app` becomes a tag and `{{[[TODO]]}}` a page link.
- `[label]([[Page]])` and `[label](((uid)))` are each one token, targeting the inner ref.
- Tag characters: Unicode letters and digits plus `_-/.:@`, using the `u` flag. `\w` is ASCII-only in JS.
- Nested refs: the innermost token under the pointer wins.
- Acceptance: render a corpus of at least 25 cases with `renderString` and compare the `.rm-page-ref`/`.rm-block-ref` targets with `findTokens`. Record differences, including against `parseRoamLink`'s tag rule (`model/links.js:10`), which is not edited.

**N7. The navigation target shape; hover moves out of P10.**
- Map each token to `{type: "page", title}` or `{type: "block", uid}` before calling `navigate`. `navigateToTarget` reads `target.type` (`host/links.js:31, :42`). A tag is a page.
- Decision 5's token hover preview moves to Later. N does not touch `hover-preview.js`, and the CHANGELOG says so.

**N8. The chooser and the cursor.**
- Chooser:
  - z is `zIndex + 3`, clamped to the viewport;
  - it takes focus and stops `keydown/keyup/keypress` at its root (`command-list.js:137-138`);
  - rows show the title, `#tag`, or the block's first 60 characters;
  - it closes on Esc, a `document`-capture outside pointerdown, wheel, or dispose;
  - closing without navigating refocuses `containerEl`.
- Cursor: `.excalidraw.plexus-token-hover canvas.excalidraw__canvas.interactive { cursor: pointer !important }`. Excalidraw sets the cursor inline (Source `cursor.ts:33`); the same pattern is at `extension.css:804-805`.
- Listen for the modifier `keyup` in `window` capture, because the dock root stops bubbling keyup. Also clear the class on `blur` and `pointerleave`.

### A

**A1. Label mode must pass through every link branch.**
- `placeBlocksInner` tests `mode === "link"` in five places (`actions.js:736, 741, 749, 755, 782`). Simply adding "label" would send it down the embed path at 741 and 755.
- Use `const textMode = mode === "link" || mode === "label"` at 736, 741, 749 and 755.
- Label nodes get `link = null`.
- The embed-cap toast action stays "Place n as links".
- Toasts read "Placed 1 label" and "Placed n labels".
- Any other mode string → `placeRefuse("Could not place")`.
- The embed and link toasts stay byte-identical; `test/actions-p9.test.js` is not A's file.

**A2. `parentOf` wraps `blockInfo`.**
- `host.parentOf(uid)` returns `{uid: parentUid, isPage: parentIsPage, title: parentIsPage ? pageTitle : parentString, pageTitle}`, built from `blockInfo` (`host/roam.js:273-289`).
- It returns null for a page uid or a missing block.
- It adds no new pull pattern.

**A3. `addOutlineBlock` uses `host.createBlock`.**
- `createBlock` has no write queue behind it (`host/roam.js:344-352`). Call `host.createBlock({parentUid: rootUid, order: "last", string: ""})`.
- If the root does not pull, toast "Could not add a block" and return null.

**A4. DOM scans skip the dock.**
- The `[id^="block-input-"]` scans at `actions.js:589, 2626, 3002, 3083` skip `.plexus-dock`, as they already skip `.plexus-offscreen`.
- In Parent mode the dock renders other drawings. Without this, `openRegionOnce` could click a full-screen icon inside the dock.

### I

**I1. Discovery and `activeEditor` ignore the dock. This is binding, not defensive.**
- In `discover.js`, filter `.plexus-dock` only in the editor branches (`:28-37`) and in `scanExisting` (`:86`).
- Do not add it to `SKIP_SELECTOR` (`:3`). That would stop region crops and aliases inside the dock from being claimed, which gate item 3 needs.
- `native.activeEditor` (`host/native.js:19-20`) also skips `.plexus-dock`. `src/host/native.js` and `test/host-native.test.js` are assigned to I.

**I2. The toolbar follows the dock.**
- `createEditorToolbar` gains `onToggleDock` and `dockOpen` (pressed state, as for Regions), and it exports `place`. Today only `show` and the window resize handler call it (`toolbar.js:126-127`).
- I calls `place()` after every dock open, close or width change, once the D10 resize has settled.
- In overlay mode, the toolbar centres on the canvas width minus the dock width.

**I3. Wiring.**
- Remember whether the dock is open the same way `layerOn` is remembered (`extension.js:153`). A new mount reopens the dock; `onClose` clears the flag; a dispose on unmount keeps it.
- `hotkeyHandlers.dock` toasts "Open a drawing first" when there is no mount.
- "Outline dock: show parent" toasts "This drawing sits directly on its page" when `parentOf` reports a page.
- Drop: call `actions.placeBlocks(items, {mode, scenePoint, app})` with `exclude: mountUid`.
- NAV-1's `navigate` repeats the backlinks `openTarget` body (`extension.js:508-513`): navigate, set `navigatedAt`, call `hover.hide()`, and show "Opened in sidebar".

**I4. I owns the tests that pin today's counts.**
- Update `test/view-p9-ui.test.js:190-194` (six hotkeys → seven) and `test/extension.test.js:274` (23 labels → 25). Both belong to I.
- The settings dialog lists `HOTKEYS` automatically (`settings-dialog.js:109`); that is intended.
- `dock-width` goes into `DEFAULTS` as the string `"320"`. `readSettings` reads it as `clampNumber(…, 320, 240, 640)`. It is not added to `createSettingsPanel`.

**I5. CSS stays off the typing path.**
- Every P10 rule is rooted at one of:
  - `.plexus-dock`;
  - `.plexus-drop-ghost`;
  - `.plexus-token-chooser`;
  - `.plexus-token-hover`;
  - `.plexus-dock-narrowed`;
  - a `body` class that exists only while an editor is mounted.
- No `:has()`, and no unscoped `.rm-*` or `.roam-block` selectors. Those are re-matched on every main-outline DOM mutation.

### Gate

**X1. Measure before D, G and I start.**
- Measure D1, D10 (Roam's `.full-screen` geometry), G2 (`effectAllowed`), G4 (modifiers on macOS) and D11 (where each popup renders).
- Record the results in spec §13 "Phase 10 spikes". Any fallback chosen there binds the units.

**X2. The keyboard matrix, extended.** Run it with a canvas element selected and the dock open.
- `[[`, then ArrowDown, then Enter works in a dock block.
- One Esc closes only the menu, and the canvas selection is unchanged.
- The D7 keys in the first and last dock blocks leave `{{[[excalidraw]]}}` and the main outline byte-identical, with focus still in the dock.
- Pressing Cmd+A twice selects no blocks.
- After typing in the dock and pressing Esc, Cmd+Z on the canvas undoes only the canvas.
- The D8 matrix is recorded.
- A drag-select across two dock blocks follows D5.
- Clicking from one dock block to another saves the first.

**X3. Narrowing.**
- `app.state.width` equals the container's width after open and after close.
- The toolbar is centred on the canvas.
- Embeds, the regions layer and backlink badges clip at the dock's edge.
- A region opened from the dock is framed inside the narrowed canvas.
- After close, and after minimizing with the dock open, `outerEl` has no P10 class or property, and its inline style is byte-identical to before.

**X4. Drops.**
- Dropping 31 blocks with no modifier shows the embed-cap toast.
- Esc during a drag, and dragging out of the window, both leave no ghost.
- File drops and library drops still work.
- Dragging the dock header places the ref.
- Dropping the drawing block itself is refused.
- The 20-drop byte-identical check uses the `dropEffect` that ships.

**X5. NAV-1.**
- Cmd+Shift-click a token: the sidebar window opens, the editor stays open, the selection is unchanged, and moving the mouse afterwards moves nothing.
- Cmd-click works on text rotated 30° and on a wrapped token.
- The N6 corpus comparison is recorded.
- Double-click still edits.
- Cmd-click on an embed anchor changes nothing.

**X6. Performance and unload.**
- Typing cost is +0 with the editor closed.
- 50 keystrokes in a dock block cause zero Plexus `data.pull` or `data.q` calls.
- Unload with the dock open and unsaved dock text:
  - the text is saved;
  - no dock, ghost or chooser remains;
  - no P10 classes remain on `body` or on the container;
  - `getEventListeners` on `window`, `document` and `containerEl` match the counts from before the dock opened.

## X1 results (measured 2026-09-29, binding; spec §13)

- **D1 → fallback.** The drawing-root copy costs about 15-22 ms of CPU per save (static `<img>` preview regenerated). The dock renders **each direct child of the root in its own `renderBlock` (`"open?": true`)**, with a `:block/children` pull watch on the root that re-renders the list (add, remove, reorder, Tab/Shift+Tab moving a block in or out). Decision 1's "hide the root row" CSS is dropped. When Enter or Tab changes the list, focus follows the moved or new block into its dock copy with the click-to-focus pattern. "Parent" mode renders the parent's direct children the same way.
- **D10 → owned class and owned `<style>`.** Narrowing works with `.plexus-dock-narrowed { right: var(--plexus-dock-w) !important; width: auto !important; }` on the full-screen container; Excalidraw's width follows within 2 frames. The variables live in a Plexus-owned `<style>` element, not in any inline style (an inline custom property leaves `style=""` behind).
- **G2.** Roam leaves `effectAllowed` uninitialized; `dropEffect = "copy"` is accepted.
- **G4.** Modifiers arrive on dragover and drop (CDP). The chip follows dragover; the mode comes from drop.
- **D3, D11, D12 confirmed.** Menu keys must pass while a Roam menu is open (Esc did not close the autocomplete under a plain stop). The bullet context menu (`body > .bp3-portal`, z 20) is hidden behind the editor unless raised. A plain bullet click blanks the dock's render root: swallow it.
