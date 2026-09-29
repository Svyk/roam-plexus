# Plexus Phase 4 — mind-map builder with two-way outline sync (binding)

Repo `~/roam-plexus`, HEAD `3b4ffd5` (0.3.1). Earlier contracts still bind whatever this one does not change. Spec §7 row "Mind-map builder" (Plexus Canvas MINDMAP-WORKLIST: Tab child, Enter sibling, Alt+arrows nav, fold, layouts, pin, boundary, cut/copy/paste branch). Roam rules: `~/.claude/skills/roam-plugin-dev/SKILL.md` §(d), rules 1, 2, 4, 10, 11, 13, 20 matter most here. Zero runtime deps, plain JS, `node --test`, no jsdom, log prefix `[plexus]`, never throw into Roam. Version 0.4.0.

## Measured facts (2026-09-28, Readwisenotes)

- A pull watch with pattern `[:block/uid :block/string :block/open :block/order {:block/children ...}]` on a root block fires about 180 ms after ANY change in its subtree: a grandchild string edit, a new grandchild, or an `open` flag change. One recursive watch per root is enough.
- `data.block.update({block: {uid, open: false}})` collapses a block and leaves props untouched. `string`-only updates also leave props intact (§13 S3). Props must never be written.
- In the full-screen editor, keyboard events target the focused `.excalidraw` container (`div.excalidraw.excalidraw-container`). A capture listener on that container runs before Excalidraw's own handlers. Unhandled Tab moves focus to Excalidraw's menu button, so Tab is free to use when a mind-map node is selected.
- The Excalifont font face is loaded in the document when the editor has been opened, and it is Excalidraw 0.18 `fontFamily: 5`. `CanvasRenderingContext2D.measureText` with `${fontSize}px Excalifont` gives usable widths; line height is 1.25.
- The P3 emitters are `app.onChangeEmitter.on(cb)` and `app.onScrollChangeEmitter.on(cb)`. `.on()` returns the unsubscriber.

## Model

- A **mind map** is one Roam root block plus its descendant blocks: the outline itself. It is projected into a drawing as nodes, edges, and optional boundaries. The outline is canonical (rule 10). The canvas is a projection plus layout state: positions of pinned nodes, the layout direction, boundaries.
- **Excluded blocks** are not projected, and neither are their subtrees: strings that start with `{{[[excalidraw]]}}`, `{{excalidraw}}`, or `{{[[plexus-`.
- Element markers (Plexus data lives in `customData.plexus.mm`; always MERGE into existing customData):
  - root node container: `{uid, map: rootUid, root: true, layout: "right"|"down"|"left"|"up"|"radial"}`
  - node container: `{uid, map: rootUid, pinned?: true}`
  - node text: the bound text (`containerId`) of its container; it carries no marker.
  - edge arrow: `{edge: [parentUid, childUid], map: rootUid}`
  - boundary: `{boundary: uid, map: rootUid}`
- **Node look**:
  - The node is a rectangle container, `roundness: {type: 3}`, with bound text at `fontFamily: 5`. `fontSize` is 24 for the root, 20 at depth 1, and 16 deeper.
  - Text wraps at max width 240 scene units, measured with the injected measurer. Padding is 14 horizontal and 10 vertical.
  - Folded nodes (`:block/open false` with children) get the suffix ` (+N)`, where N is the hidden descendant count.
  - Colors: root `backgroundColor #ffec99`; depth-1 nodes cycle through `#a5d8ff #b2f2bb #ffc9c9 #d0bfff #ffd8a8`; deeper nodes inherit their depth-1 ancestor's color.
- **Display text** (`plainText(blockString, resolveRef)`, pure):
  - `[[X]]` becomes X; `#[[X]]` and `#X` become X.
  - `((uid))` becomes the referenced block's plain text, truncated to 60 characters (resolver injected).
  - `**b**`, `__i__`, `^^h^^` and `~~s~~` are unwrapped. `{{…}}` components become `⧉`.
  - `hasMarkup(blockString)` is true when any of these constructs is present.
- **Edges** are straight `arrow` elements with `endArrowhead: null`. They run from the parent's side midpoint to the child's opposite side midpoint, which depends on direction; radial uses the centers. They use `startBinding`/`endBinding` `{elementId, focus: 0, gap: 4}`, and each node's `boundElements` lists its arrows and text.
- **Layout** (pure, `layoutTree`):
  - Directions right/left/down/up use a tidy tree: siblings stacked with gap 18 along the cross axis, each parent centered on its children's span, level gap 70 along the main axis.
  - Radial: depth-1 nodes at equal angles on radius 220, and each deeper level at +180 radius inside its parent's angular wedge.
  - Pinned nodes keep their scene position, and their subtree lays out relative to them. Folded nodes hide their subtree.
  - Output is `{uid → {x, y}}` in scene coordinates, anchored so the root keeps its current position.
  - It must be O(n). The test bench is a 200-node tree; assert < 50 ms in CI and log the actual number. The gate is < 16 ms measured live.
- **Reconcile** (pure, `reconcile({elements, tree, sizes, layout, textOf})` → `{add, update: [{id, patch}], remove: [ids]}`):
  - Idempotent: running it on its own output yields no ops. That is how echoes are absorbed (rule 2): an echo of our own write produces zero ops.
  - A live block with no node gets its node and edge added.
  - A node whose block is gone from the tree, or hidden by a fold, is removed together with its edges and boundary. Deletion in the outline is authoritative.
  - Text, size and position diffs become updates. Pinned nodes' positions are never updated.

## Sync

- **Roam → canvas** (render):
  - Runs on editor mount for every mind-map root found in the scene. It also runs from one recursive pull watch per root while that editor is mounted, and optimistically after each of Plexus's own writes.
  - Ops are applied in ONE `app.updateScene({elements, captureUpdate: "NEVER"})`, so outline-driven changes never enter Excalidraw's undo stack.
- **Canvas → Roam** (writes): every write goes through a per-root serialized queue under the Web Lock `plexus:${graph}:mm:${rootUid}` (rules 4 and 11). After each write: optimistic render, then the watch echo reconciles to zero ops. A write failure toasts "Could not update the outline" and does a full reconcile from a fresh pull.
- **Allowed writes** (a P4 exception to Phase 1's create-only rule, only for blocks inside a projected mind-map tree): `data.block.create`; `data.block.update` with ONLY `string` or ONLY `open` (never props); `data.block.move`; and `data.block.delete`, only for explicit Alt+Backspace. Tests assert that no other write shape is ever called.
- **Native Excalidraw edits to projection elements**, detected on `onChangeEmitter` (coalesced to one rAF):
  - A node deleted with Excalidraw's own Del key, while its block still exists: re-add it through reconcile, and toast ONCE per session "Mind-map nodes follow the outline; Alt+Backspace deletes a branch".
  - A node moved by the user (its position differs from the layout by >2 px after pointerup): mark it `pinned: true` and keep the position.
  - A node's text edited through Excalidraw's own text editing (detected when `appState.editingTextElement` goes from that node's text to null): if `hasMarkup(block string)` is false, write the new text to the block string. Otherwise revert the node text and toast "Edit this node in the outline (it has links or formatting)".

## Hotkeys and inline editing

- Hotkeys are active only while an editor is mounted, EXACTLY one mind-map node is selected, and no text is being edited: neither `appState.editingTextElement` nor the Plexus inline input.
- They use one capture `keydown` listener on the `.excalidraw` container, added on mount and removed on unmount. Only handled combos are `preventDefault` + `stopImmediatePropagation`ed.
- Keys:
  - **Tab**: new LAST child of the selected node.
  - **Enter**: new sibling right after the selected node; on the root it makes a new last child.
  - **F2**: edit the selected node; plain-text blocks only, otherwise it toasts as above.
  - **Alt+Arrow**: select the nearest node in that direction (pure `nearestInDirection`: the center must lie in the 90° cone, lowest distance wins), and scroll it into view if off-screen.
  - **Alt+F**: toggle fold through the block `open` flag. It needs children, else toast "No children to fold".
  - **Alt+L**: cycle the map layout right → down → left → up → radial, stored on the root node marker, then re-layout the unpinned nodes.
  - **Alt+P**: toggle pin; unpinning returns the node to the layout.
  - **Alt+B**: toggle a boundary around the selected branch: a dashed transparent rounded rectangle, padding 12, recomputed on every layout.
  - **Alt+X / Alt+C / Alt+V**: cut or copy the selected branch, then paste under the selected node. Cut+paste is `data.block.move` (LAST child). Copy+paste recreates the strings recursively as new LAST children. You cannot paste into your own subtree (toast).
  - **Alt+Backspace**: the first press toasts "Press Alt+Backspace again to delete N blocks"; a second press within 3 s deletes the branch through `data.block.delete` on the branch root. The root node cannot be deleted this way.
- **New node flow** (Tab/Enter):
  - Create the block with the string "New idea" and render it optimistically.
  - Select it and open the **inline input**: an `input.plexus-portal.plexus-mm-input` over the node's viewport rect, pre-filled and fully selected, so the first keystroke replaces the text.
  - Enter commits (string update). Tab inside the input commits and then acts as Tab on the new node, so you can chain children. Esc cancels: if the block is still "New idea", it is deleted.
  - The input stops key event propagation so Excalidraw and Roam never see those keys. It unmounts on blur (which commits).

## Entry points

- Toolbar **Mind map**, with the editor mounted:
  - A mind-map node selected: toast "Use Tab / Enter to grow this map".
  - Otherwise: create the root block as the LAST child of the drawing block with the string "Central idea", render the root at the viewport center, and open the inline input.
- Block context menu **Plexus: Mind map from outline** on block X (refuse drawing blocks and region blocks):
  - Create `{{[[excalidraw]]}}` as the next sibling of X (same parent, order = X.order + 1).
  - Open it full-screen through the existing open-drawing flow (openBlock → fullscreen icon → wait for the editor).
  - Render X's tree with X as the root at scene (0, 0), select the root, and zoom to fit the map.
  - Nothing is copied: the nodes ARE X and its descendants.
- Command palette **Plexus: Mind map from outline** acts on `roamAlphaAPI.ui.getFocusedBlock()`.

## File ownership (parallel)

| Unit | Files |
|---|---|
| A (model) | `src/model/mindmap.js` (new: `treeFromPull`, `plainText`, `hasMarkup`, `wrapLines(text, maxWidth, measure)`, `nodeSize`, `layoutTree`, `nearestInDirection`, `countHidden`), `src/model/mmsync.js` (new: element builders for node/text/edge/boundary with every Excalidraw base field; `desiredElements`; `reconcile`), `test/mindmap.test.js`, `test/mmsync.test.js` (includes the 200-node layout bench and reconcile idempotence) |
| B (host) | `src/host/mmwrites.js` (new: `createMmWriter({api, withLockFn, graph})` → per-root queue with `createChild`, `createSiblingAfter`, `updateString`, `setOpen`, `moveBranch`, `copyBranch`, `deleteBranch`, `pullTree(rootUid)`, `watchTree(rootUid, cb)` → disposer), `src/host/measure.js` (new: `createMeasurer({doc})` canvas `measureText`, memoized by `font|text`), `test/host-mmwrites.test.js`, `test/host-measure.test.js` |
| C (view + actions + wiring) | `src/view/mindmap.js` (new: per-editor controller for mount/unmount, roots discovery, watch + onChange handling, hotkeys, inline input portal, toasts), `src/view/toolbar.js` (Mind map button), `src/actions.js` (`startMindMap`, `mindMapFromOutline(blockUid)`), `src/extension.js` (wiring, context menu, command, cleanup), `src/extension.css` (inline input), `test/view-mindmap.test.js`, `test/actions.test.js`, `test/toolbar.test.js`, `test/extension.test.js` |

Parallel units: edit only your own row. Do not run git checkout, reset, stash, add, or commit. Report failures in your own files only.

## Gates

- **Reconcile:** idempotent on fixtures; every allowed write shape is asserted and nothing else is ever called.
- **Layout bench:** 200 nodes logged.
- **Live:**
  - Tab and Enter create blocks and nodes; text typed in the inline input lands in the block.
  - Editing a block in the outline updates its node after the echo, with no duplicates.
  - Alt+F folds and unfolds and matches Roam's collapse.
  - Alt+L cycles the layout.
  - A native Del restores the node.
  - A native drag pins the node.
  - Alt+Backspace twice deletes the branch.
  - Mind map from outline creates the drawing next to X and projects X.
  - Unload leaves nothing behind.
- Typing path +0 (every listener lives only while an editor is mounted).
- `npm run check` is green, the version is 0.4.0, and the CHANGELOG has an entry.

## Amendments (critic, binding)

Architecture critic pass, 2026-09-29, against HEAD `3b4ffd5` and the Excalidraw 0.18 source in `~/excalidraw-port-research/excalidraw` (Store, `updateScene`, `Scene.replaceAllElements`, `onKeyDown`, fonts). Each item names its unit. Where an item conflicts with the body above, the item wins.

### Measure before any unit starts (orchestrator, live, Readwisenotes, trusted CDP)

1. **NEVER persists.** Call `updateScene({elements: <one rect moved>, captureUpdate: "NEVER"})` on the spike drawing. `:excalidraw/elements-json` must show the move within 1.5 s, and again after close and reopen. Expected pass: in the 0.18 source, `onChange` fires whenever `!isLoading`, whatever the capture mode. NEVER differs from the default (EVENTUALLY, which S1 proved persists) only in updating the store snapshot. If it fails, use `"EVENTUALLY"` wherever this contract says NEVER, and record that under Measured facts.
2. **Native element fixture.** Draw a rectangle with text inside and a bound arrow natively in Roam's editor, and save the three element objects to `test/fixtures/native-018.json`. Unit A's builders must emit every key of the matching native element with the same value types, including the `startBinding`/`endBinding` key set, and a test asserts it. Do not guess 0.18.0's binding shape.
3. **Empty-drawing open path.** "Mind map from outline" opens a block whose string is exactly `{{[[excalidraw]]}}` with no props (it shows "Click to start editing"). Record whether `.bp3-icon-fullscreen` exists in that state and which trusted click reaches the full-screen editor. The current `openRegion` flow assumes the icon exists. Record the answer under Measured facts before unit C writes the flow.
4. **No remount or stale feedback.** Ten Tab creates within 2 s under a toolbar root (a child of the drawing block) must keep the same `App` instance and the full-screen state. All ten nodes must be in `elements-json` 3 s later and after reopening.

### Element identity and validity (A)

5. **Deterministic ids.** Use charset `[A-Za-z0-9_-]` so P1 `isId` accepts them and area regions over nodes keep working:
   - node `pmm-${root}-${uid}`
   - text `pmm-${root}-${uid}-t`
   - edge `pmm-${root}-${childUid}-e`
   - boundary `pmm-${root}-${uid}-b`

   A node's text is still identified by `containerId`; the text id is used only when creating it.
6. **Copies lose the marker.** A live element that carries `customData.plexus.mm` under a non-canonical id is a copy. Excalidraw paste, Ctrl+D, and Alt-drag all copy `customData` under fresh ids, and Alt-drag moves the originals and leaves the copies behind. Reconcile removes `plexus.mm` from copies and keeps their shapes; it deletes nothing. Test: after a paste and an Alt-drag, each uid has one node.
7. **Delete, never splice.** Removal sets `isDeleted: true` and bumps the version; elements are never spliced out. Re-adding a uid whose canonical element exists in a deleted state un-deletes that element, so its pin and color survive fold and unfold.
8. **New objects only.** Every patch creates a new object: `{...el, ...patch, version: el.version + 1, versionNonce: <random>, updated: Date.now()}`. Never mutate scene objects in place.
9. **Append only.** New elements get `index: null` and go at the end of the array: edge, then container, then text for each node, and boundaries also at the end (a transparent fill is hit-tested only on its stroke). Never reorder existing elements. A reorder invalidates fractional indices, and then `syncInvalidIndices` re-versions every element in the gap.
10. **Owned fields.** Reconcile compares and patches only these: `x y width height angle(0) isDeleted text originalText fontSize fontFamily lineHeight customData.plexus.mm`, plus `points startBinding endBinding` on edges.
    - Other style fields are set only when the element is added.
    - `backgroundColor` is also reset when the node's depth-1 ancestor changes.
    - Tests: a native recolor survives a reconcile, and a move to another depth-1 branch recolors the node.
11. **Merge `boundElements`.** Never replace it. Reconcile adds and removes only its own text and edge entries and keeps foreign entries: user arrows, Excalidraw arrow labels, and flowchart links.
12. **Bound-text geometry matches Excalidraw's `computeBoundTextPosition`:**
    - `text.x = node.x + (node.w - text.w) / 2`
    - `text.y = node.y + (node.h - text.h) / 2`
    - `text.h = lines * fontSize * 1.25`

    Otherwise the text jumps on the first native drag or edit.
13. **Idempotence.** The idempotence check ignores `version versionNonce updated index seed` and compares geometry within ±0.5 px, because Excalidraw re-measures text after fonts load.
14. **Map state lives on markers only.**
    - The root marker holds `layout` and `bounds: [uid, …]`; Alt+B toggles membership of that list.
    - Node markers hold `pinned`.
    - Reconcile is pure over (tree, markers, sizes). It derives boundary elements and re-adds them like nodes, so a boundary survives fold and unfold and a native Del of it.
    - The boundary element's own `{boundary, map}` marker stays, for identification.
15. **The root node is the layout anchor and is never pinned.** Dragging it moves the whole unpinned map.

### Display text (A)

16. **Round-trip invariant (property-tested):** `hasMarkup(s) === (plainText(s, r) !== s)`. Native edits and F2 are allowed exactly when the display text equals the block string, so every write-back round-trips.
17. **More `plainText` rules:**
    - `![alt](url)` becomes `▣ alt`, and `[t](url)` becomes `t`.
    - Explicit `\n` is kept as a line break.
    - Output is capped at 280 characters, ending with `…`.
    - An empty string displays as `·`.
    - `((uid))` resolves one level only: the referenced string goes through `plainText` with a resolver that returns `…`, so reference cycles terminate.
18. **`wrapLines`** splits on `\n` first, then breaks any word wider than maxWidth by character.
19. **Native write-back:**
    - Write `originalText`, never the wrapped `text`.
    - Strip the exact ` (+N)` suffix the projection added. If the user edited inside the suffix, revert.
    - If the result is empty, or is `·` left unchanged, revert instead of blanking the block.

### Measurement (B)

20. **Font string and loading.** Use Excalidraw's own font string for family 5: `${size}px Excalifont, Xiaolai, sans-serif, Segoe UI Emoji`.
    - Excalifont ships as 7 unicode-range chunks that load per glyph. So each pass calls `doc.fonts.load(font, joinedDisplayTexts)` once.
    - Do not memoize widths measured before that promise resolves. If it resolves with faces that were not loaded before, clear the memo and reconcile one more time.
    - The memo is an LRU of 2,000 entries, cleared on unmount.

### Writes (B)

21. **Signatures and failure.** Every writer method takes `rootUid` first. Creates accept a caller-generated uid (`api.util.generateUID()`), so the optimistic node and the inline input appear before `create` resolves. On failure: remove the optimistic node, close the input, toast, and run a fresh reconcile.
22. **Locking.** Locks wait (no `ifAvailable`), with the 5 s timeout. Every write is a user action and must not be dropped, and a timeout counts as a write failure. A move between two maps acquires both root locks in sorted uid order.
23. **Fresh pull inside the lock (rule 11).** Each op re-reads what it needs and never trusts the projection:
    - `createSiblingAfter`: X's parent and order, with `order = X.order + 1` read at write time.
    - Paste: the source still exists, and the target is not inside the source (checked through `:block/parents`).
    - `updateString` is compare-and-set: the current string must equal the base string captured when the edit began. Otherwise toast "Block changed elsewhere; not overwritten" and reconcile.
24. **Watch coalescing.** `watchTree` ignores the callback payload and coalesces fires into one fresh `pullTree` per animation frame. While a root has queued or in-flight ops, watch fires only mark it dirty, and one fresh pull plus reconcile runs when the queue drains. This absorbs echoes without a per-field ledger (rule 2): the optimistic state stands until the drain confirms or corrects it.
25. **Unfold first.** When Tab or Alt+V targets a folded node, or Enter targets a folded root, run `setOpen(true)` first in the same queue. Otherwise the new child is hidden and the inline input has no node to attach to.
26. **`copyBranch`** skips excluded subtrees (copying them would create empty drawings) and toasts how many were skipped. It refuses branches of more than 200 blocks.

### Delete (B, C)

27. **Alt+Backspace on a branch.**
    - N counts ALL descendants from a fresh pull, including folded and excluded blocks.
    - Refuse with a toast when the branch contains an excluded block (drawing, region container, region), or any block referenced from outside the branch (`:block/_refs`).
    - The second press deletes only if the uid, N, and the branch root's string still match the first press, and the selection has not changed.
28. **Esc-cancel delete** is the second allowed `data.block.delete` shape. It is valid only for a uid Plexus created in this session whose fresh string is still exactly its placeholder (`New idea` or `Central idea`) and which has no children. Tests assert both delete paths and that no third path exists.
29. **Alt+Backspace twice on the ROOT detaches the map.** It removes every projection element of that map from the scene and writes nothing to Roam. Without this, a map cannot be removed from a drawing at all, because a native Del gets restored.

### Canvas side: echoes and gestures (C)

30. **Own-write detection is a version snapshot, never an "applying" flag.** After each `updateScene`, synchronously read back `getSceneElementsIncludingDeleted()` and record `id → version` for projection elements; the index sync may already have re-versioned them. `onChange` treats a projection element as natively edited only when its version differs from the snapshot.
31. **Cheap exit and gesture gate.**
    - `onChange` returns at once when `app.scene.getSceneNonce()` and `editingTextElement?.id` are unchanged since the last pass.
    - Detectors run only when no gesture is active: `cursorButton` is not `"down"`, and none of `editingTextElement newElement resizingElement multiElement isResizing isRotating` or linear-element editing is set (probe each field with `in`).
    - They run on the `onPointerUpEmitter` pass and on the next settled `onChange`.
32. **Defer watch-driven reconciles** while a gesture is active. They never patch the element in `editingTextElement`.
33. **Native changes after the detectors.** The pin detector runs first: any non-root node moved natively more than 2 px from its layout position gets pinned, whether by drag or by arrow-key nudge. Any other native change to an owned field (undo or redo, resize, rotate, align, Del of an edge) triggers a reconcile from the cached tree. The outline wins.
34. **Read and write in one task.** Every apply reads the live scene and calls `updateScene` in the same synchronous task, with no await in between, and skips the call when there are no ops. Zero ops ⇒ zero `updateScene` is the loop-termination invariant. Test: a watch fired by a props-only or tail-only change to a drawing inside the tree produces no `updateScene`.
35. **Wait for loading.** Wait for `!app.state.isLoading` (rAF poll, 5 s cap) before the first mount reconcile. Roam could save an `updateScene` made against a still-loading scene over the real drawing.
36. **Roots, missing roots, nested roots.**
    - The roots found on mount are the set of `mm.map` values on live canonical elements, not only root nodes. A missing root node is re-added.
    - If a root uid pulls null, remove that map's elements and dispose its watch.
    - A block that is the root of another map in the same scene is pruned from the outer map, together with its subtree.
37. **Size cap: 500 visible nodes.** "From outline" refuses before creating the drawing, with the toast "Collapse some branches first (N blocks)". Growth from the watch projects the first 500 nodes in DFS order and toasts once.
38. **Guard every canvas apply** with `alive && native.activeEditor(doc)?.app === app`. Writes that are already queued still finish after unmount, but they no longer touch the canvas.

### Keyboard (C)

39. **Key matching.**
    - Match letters on `event.code` (`KeyF KeyL KeyP KeyB KeyX KeyC KeyV`), with exact modifiers `altKey && !ctrlKey && !metaKey && !shiftKey`. On macOS, Option+F gives `key === "ƒ"`; Excalidraw matches its own Alt shortcuts on `code` for the same reason.
    - Ignore `event.repeat` for Tab, Enter, Alt+V, and Alt+Backspace. A held Alt+Backspace would otherwise confirm the delete by key repeat.
    - Ignore `isComposing` and keyCode 229.
40. **Scope.** Act only when `event.target` is the container itself and no Excalidraw UI is open (`openDialog openMenu openPopup contextMenu` all null). Write hotkeys are off in `viewModeEnabled`; Alt+Arrow still works.
41. **Extra swallowed combos while a node is selected.**
    - Cmd/Ctrl+Arrow: toast "Use Tab / Enter to grow this map". Excalidraw's flowchart creator would attach non-outline nodes to the map.
    - Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z: toast "Undo mind-map edits in the outline". NEVER updates are not in Excalidraw's history, so its undo would revert an unrelated earlier edit.
    - Preempting Alt+Arrow, Excalidraw's flowchart navigator, is intended.
42. **Refocus the container.** After any Plexus UI interaction (inline input commit or cancel, toolbar button), call `containerEl.focus({preventScroll: true})` and keep the node selected. Otherwise key events target `body`, never reach the container listener, and Tab chaining stops.

### Inline input (C)

43. **Placement and isolation.**
    - The input lives on `doc.body`, never inside `.excalidraw`, so Excalidraw's paste handler ignores it. Its z-index is `baseZIndex(outer) + 2`.
    - It stops propagation (bubble phase) of `keydown keyup keypress beforeinput input paste copy cut`.
    - It repositions in the same rAF as scroll and zoom changes, and when a layout moves its node.
44. **Commit rules.** Enter and Tab commit only when the user is not composing. A commit equal to the base string writes nothing. An empty commit on a fresh placeholder is an Esc-cancel (item 28).
45. **Teardown.** On dispose or unmount, remove the blur listener first, then close the input without writing. If the node leaves the scene while the input is open (fold, delete), commit if the block still exists, else discard.

### Other

46. **[C] Entry-point guards.** The command palette entry toasts "Click into a block first" when `getFocusedBlock()` is null. "Mind map from outline" refuses every excluded block, not only drawing and region blocks.
47. **[C] Fix a pre-existing bug** in the owned file `src/actions.js:493`. `refreshCropsForOpenDrawing` calls `fail(i)`, which is not in scope there; the ReferenceError gets swallowed as "refresh failed". Replace the call with `continue`.
48. **[Gates] Added live gates:**
    - A native copy/paste and an Alt-drag of a node leave one node per uid.
    - Undo after a native text edit converges to the block string.
    - Holding Alt+Backspace down deletes nothing.
    - Option+F on macOS folds the node.
    - From outline, closing the editor within 300 ms and reopening still shows the map.
    - One full pass on the 200-node map (pull, measure, layout, reconcile, `updateScene`) is timed and logged, gated < 50 ms warm.
