# Plexus Phase 13: Process flows and templates (binding)

Repo `~/roam-plexus`, HEAD `b47ad09` (code 0.12.0, `554116a`). Target 0.13.0. No Compass change.

Scope: [`roadmap-next.md`](roadmap-next.md) §5 P13, covering MM-12, AUTH-10, AUTH-9 and the P13 live gate. This contract adds the measured facts (spec §13 "Phase 13 measured facts"), the names, the file ownership and the decisions below. The P6-P12 contracts and their amendments still bind:
- Code style: zero dependencies, plain JS, `node --test` fakes, the `[plexus]` log prefix.
- Never throw into Roam; remove everything on unload.
- No `confirm`, `alert` or `print`.
- Scene writes go through `guardedWrite`, and each bulk operation first calls the P12 `beforeBulk` snapshot.
- Drawing props are never written except through Excalidraw.
- No new command-palette entries.
- Roam's `.bp3-toast-container` is never treated as a menu.
- The P4/P12 mind-map sync invariants hold: a zero-op reconcile for existing maps, id stability, the `mmwrites` queue.
- `BT_attr*` children are never rewritten.

## Measured facts (spec §13)

- **Native align/distribute re-route arrows.**
  - `executeAction(alignTop, "api")` re-routes bound arrows. The actions `alignTop`, `alignBottom`, `alignLeft`, `alignRight`, `alignVerticallyCentered`, `alignHorizontallyCentered`, `distributeHorizontally` and `distributeVertically` exist.
  - Plain `updateScene` moves do not re-route.
- **Frames.** A map node's `frameId` survives reconcile.
- **Writing into another drawing.** `newDrawing` refuses while another editor is open. `openDrawingOnce` opens a drawing full-screen. Pasting elements into a freshly opened drawing saves (P5 migration).
- **Reading and pasting.**
  - `host.drawing(uid).elements` reads persisted elements without opening the drawing.
  - The paste path (`addElementsFromPasteOrLibrary`) re-ids elements and keeps `customData.firebaseUrl` for images.

## Decisions

1. **MM-12 flow layout.** It is a sixth kind of mind-map layout, set from the map menu ("Layout: Flow") and stored in `customData.plexus.mm.layout = "flow"`. It is not added to the Alt+L cycle. It uses the same reconcile, echo and writer machinery.
   - **Steps.** The flow root's direct children are the main sequence, in outline order. Each step gets a sequence arrow to the next one. The root is drawn as a start oval.
   - **Decision steps.** A step whose text ends with `?`, or that carries `#decision`, is drawn as a diamond. Its children are branches:
     - A branch child's `Yes:` or `No:` prefix (or any `Label:` prefix up to 12 characters) becomes the label on the arrow from the decision. The node shows the text without the prefix; the block keeps it, and F2 round-trips it like the P12 task prefix.
     - The branch child's own children continue that branch as a sequence.
     - The last step of a branch gets an arrow to the step after the decision in the parent sequence (a merge), unless the branch ends in a loop or merge reference, or in a step tagged `#end`.
   - **Loops and merges.** A child block whose whole string is exactly `((uid))`, pointing at a step of the same flow, is not a node. It draws a dashed arrow from its parent step to the referenced step. The ref block is written and edited in the outline only.
     - An unresolvable ref, or a ref outside the flow, is drawn as a plain node.
     - This convention is written into the README before any code.
   - **Lanes.**
     - A `Lane:: Name` child (a hidden attribute block, like the P12 `BT_attr` hiding, and not an edge carrier) or an inline `#[[lane/Name]]` / `#lane/Name` puts a step in lane *Name*.
     - Steps without a lane inherit their parent step's lane. The root's lane is "".
     - Lanes are columns left to right, in order of first appearance. Each lane is a frame named after the lane, with the deterministic id `pmm-<map>-lane-<fnv1a(name)>`.
     - Steps flow top to bottom inside their lane's column. Cross-lane arrows are straight.
   - **Chips.** A step carrying `#CCP` (optionally followed by a number, for example `#CCP1`) or `#hazard` gets a small chip, a rectangle with bound text showing "CCP 1" / "Hazard", at its top-right corner. The chip is grouped with the node and reconciled like the node.
   - **Regions.** Each lane frame gets a `cframe` region block under the drawing's regions container, created once per lane frame (idempotent by `frameId`) through the existing `host.createRegions` path, after the map's first reconcile that creates the lane. Removing a lane leaves its region block (regions are user data).
2. **AUTH-10 templates.**
   - **Built-in starters.** HACCP flow, 5-Why, fishbone, Apollo cause map, SIPOC, swimlane, swab-site map and 16:9 slide. They are generated in memory by `src/model/templates.js` through the P12 builder (`createBuilder`). They are not stored anywhere.
   - **User templates.** These live on the page `Plexus/Templates`. Each is a parent block holding the template name, with one drawing child.
   - **"Insert template…"** (editor open) opens a picker and inserts into the open drawing at the viewport centre, in one guarded write with ids remapped:
     - The picker lists the starters first, then the user templates with cached thumbnails from `actions.thumbnail`.
     - Starters come from the builder.
     - User templates come from `host.drawing(uid).elements`, re-id'd through the paste path.
   - **"New drawing from template…"** (editor closed) creates a drawing below the focused block, or on today's page when nothing is focused, through the P9 `newDrawing`. It opens the drawing and inserts the template.
   - **"Save selection as template…"** (editor open, selection non-empty):
     1. Ask for a name in an in-page prompt (not `prompt()`).
     2. Ensure `Plexus/Templates` exists and create `<name>` with a drawing child.
     3. Remember the selection's elements and close the current editor.
     4. Open the template drawing, insert the elements (the selection plus the bound text and arrows between them), wait for Roam's save (a pull-watch echo of the drawing's props, or 3 s), close it.
     5. Reopen the original drawing.
     - While this runs, a toast "Saving template…" shows. On failure, reopen the original and show a toast.
3. **AUTH-9 arrange.** This is a canvas-menu submenu "Plexus: Arrange ›" acting on the selection. Each operation is one undoable guarded write that also recomputes the endpoints of every arrow bound to a moved element: a straight re-route from centre to centre, clipped to each box plus the 4-unit gap, keeping the bindings. The operations:
   - **Row, Column, Grid:** gap 40, top-aligned for rows, left-aligned for columns, grid columns `ceil(sqrt(n))`.
   - **Equal size:** each element takes the largest width and height; bound text re-centres.
   - **Box around:** a frame around the selection's bounding box plus 24, named "Group"; children get its `frameId`.
   - **Grid of images:** images only, cell 240 wide, aspect ratio kept.
   - **Lay out frame children:** a grid inside the selected frame.
   - **Swap two:** exactly two elements swap positions.
   - **Untangle:** a deterministic force layout. It is seeded by element order, runs 200 iterations, moves only unlocked elements, and never moves map nodes (`pmm-`).
   - Bound text always follows its container. Map nodes (`pmm-`) are skipped, with the toast "Map nodes follow the outline".

## Shared names

- `src/model/flow.js` (new, F1): `flowPlan(tree, {sizes})` → `{steps, edges, lanes, chips}`, where `edges` are `[{from, to, label, kind: "seq" | "branch" | "loop"}]`. Also `isDecision(string)`, `laneOf(node)`, `branchLabel(string)`.
- `src/model/mindmap.js` and `src/model/mmsync.js` (F1): the `"flow"` layout (`FLOW_LAYOUT = "flow"`, not in `LAYOUTS`), with diamond, oval and chip styling and lane frames. Lane frames are reconciled like nodes, with the marker `{lane: name, map}`.
- `src/view/mindmap.js` and `src/host/mmwrites.js` (F2): the flow layout choice through `setLayout(app, "flow")`; prefix round-trips for branch labels; lane region creation after reconcile, through an injected `createLaneRegions(drawingUid, frames)`.
- `src/model/templates.js` (new, T): `STARTERS` → `[{id, name, build(builder)}]`.
- `src/actions-templates.js` (new, T): `createTemplateActions({host, native, api, toaster, guardedWrite, beforeBulk, openDrawing, closeEditor, newDrawing, thumbnail, prompt})` → `{insertTemplate(), newFromTemplate(ctx), saveSelectionAsTemplate()}`.
- `src/view/template-picker.js` (new, T): `openTemplatePicker({doc, zIndex, starters, userTemplates, thumbnail, onPick, onClose})`. `src/view/name-prompt.js` (new, T): `openNamePrompt({doc, zIndex, title, onSubmit, onClose})`.
- `src/model/arrange.js` (new, A): pure `arrange(elements, selectionIds, op, opts)` → `{next}` and `routeArrow(arrow, startEl, endEl)`. `src/actions-arrange.js` (new, A): `createArrangeActions({native, toaster, guardedWrite, beforeBulk})`.

## Units and ownership (parallel; only targeted `node --test <files> < /dev/null`; never `npm run check` / `npm test` / build)

| Unit | Owns | Items |
|---|---|---|
| F1 | `src/model/flow.js`, `src/model/mindmap.js`, `src/model/mmsync.js`, `test/flow.test.js`, `test/mindmap.test.js`, `test/mmsync.test.js` | MM-12 model and layout |
| F2 | `src/view/mindmap.js`, `src/host/mmwrites.js`, `test/view-mindmap*.test.js`, `test/host-mmwrites.test.js`, `README.md` (the loop convention section only) | MM-12 view, writes, lane regions |
| T | `src/model/templates.js`, `src/actions-templates.js`, `src/view/template-picker.js`, `src/view/name-prompt.js`, their tests, CSS snippet `/tmp/wo/p13-css-templates.css` | AUTH-10 |
| A | `src/model/arrange.js`, `src/actions-arrange.js`, their tests | AUTH-9 |
| I | `src/extension.js`, `src/view/context-menus.js`, `src/settings.js`, `src/extension.css`, their tests, `package.json` 0.13.0, `CHANGELOG.md`, `README.md` (other sections), `test/build.test.js` | wiring, command-list rows ("Insert template…", "New drawing from template…", "Save selection as template…", "Mind map layout: Flow"), the canvas menu "Plexus: Arrange ›" submenu, CSS merge; runs last with `npm run check` |

## Gate

The roadmap-next P13 live gate, items 1-3, in Readwisenotes. Plus:
- typing +0 with the editor closed;
- an existing right, cause or fishbone map reconciles to zero ops;
- unload leaves no picker, prompt or listener.

## Amendments (critic, binding)

These amendments override the contract body wherever the two conflict. Code references are to `~/roam-plexus` at `b47ad09`. "v0.18.0" means `git -C ~/excalidraw-port-research/excalidraw show v0.18.0:packages/excalidraw/<path>`.

### F1

**1. The flow grammar is fully defined, and layout uses only primary edges.**
- **Control blocks** are never steps in flow:
  - `Lane::` blocks;
  - whole-string `((uid))` blocks that qualify as refs (amendment 4);
  - `BT_attr*` blocks (already dropped by `treeFromPull`, mindmap.js:60).
- **Steps.** A block's steps are its drawable, non-control children, in outline order.
- **Non-decision steps.** A non-decision step's steps continue its sequence depth-first, before its next sibling: `A`, `a1`, `a2`, then `B`. This is the same rule as a branch child's continuation. The contract left this case undefined.
- **Primary predecessor.** Every non-root step has at most one primary predecessor:
  - the previous step (or the tail of that step's continuation);
  - or the decision, for a branch head;
  - or the root, for the first main step.
- **Merges.**
  - A decision with at least one visible branch draws no arrow to the next step.
  - Each branch tail that is not `#end` and does not end in a ref gets a merge arrow.
  - The merge target is the next step after the decision in the enclosing sequence. If there is none, search outward through the enclosing decisions. At top level with no target, draw no arrow.
  - A decision whose branches are all folded or empty behaves as a plain step.
- **`#end`** suppresses every outgoing seq or merge arrow from that step.
- **Loop and merge refs are drawn after layout and never traversed**, so cycles cannot recurse.
- **Rank.** `rank(root) = 0`. A step's rank is its primary predecessor's rank + 1. A merge target's rank is the largest tail rank + 1.

**2. Primary and secondary flow edges have separate ids and markers. The `edge` key on a secondary edge oscillates.**
- **Primary edges** (seq and branch, including root → first step) reuse `edgeId(root, to)`. Their marker is `{edge: [from, to], map, flow: "seq" | "branch"}`.
- **Merge edges** are `pmm-<map>-<tailUid>-m`. **Loop edges** are `pmm-<map>-<refBlockUid>-l`.
  - Their marker is `{flow: {from, to, kind: "merge" | "loop", via?}, map}`.
  - They never carry an `edge` key.
- Why: the copy-strip loop (mmsync.js:325-335) maps any `mm.edge` to `edgeId(root, mm.edge[1])`. A merge or loop edge marked with `edge` would have its marker stripped on every pass and re-added on the next, so no reconcile would ever be zero-op.
- Extend that canon switch, before the `mm.uid` fallback, with:
  - `lane` → `laneId`;
  - `chip` → `chipId`;
  - `flow` → the merge or loop id.
- **`boundElements`.** Flow nodes list every arrow bound to them: primary in and out, merge in and out, loop in and out. The tree-only `kidEdges` (mmsync.js:337-348) is wrong for flow and must not be used there.

**3. Control blocks are hidden only in flow, through one shared function that the view also uses.**
- `treeFromPull` does not change. Hiding `Lane::` there would add or drop nodes on existing right, cause and fishbone maps.
- Export `drawnTree(tree, {layout, attrEdges})` from mindmap.js:
  - Flow: remove control blocks and ignore `attrEdges`. Carriers draw as steps, and the "Attribute blocks as edges" item toasts "Not used in flow layout".
  - Other layouts: exactly `visualTree(tree, {attrEdges})`.
- `planMap` and the view's `drawnNodes` both call `drawnTree`.
- `laneOf(node)` reads **raw** `node.children`, so it still works when the node is folded. `visibleChildren` returns `[]` for folded nodes, which would move a folded step into its parent's lane.
- In flow, the fold suffix `(+n)` counts drawn descendants. The display side and `editableText` must use the same count, or edits of folded nodes return null (mindmap.js:251-254).

**4. Flow text has a prefix and a suffix, both owned by F1 and consumed by F2.**
- **Parsing.** Export `flowParts(string, {branch}) → {task, label, body, suffix}`:
  - `task` is `taskParts` first.
  - `label` is taken from the rest, and only when `branch` is true (a direct child of a decision). It matches `^([^:\s\[\]{}()#][^:\n\[\]{}()#]{0,11}):[ \t]+` and rejects a second `:`, so `Lane::`, `Owner::`, `http://` and `10:30` never become labels.
  - `suffix` is the trailing run of flow tags: `#decision`, `#end`, `#CCP\d*`, `#hazard`, `#lane/X`, `#[[lane/X]]`, `#[[CCP…]]`, `#[[hazard]]`.
- **Display.** In flow, `planMap` calls `textOf(uid, {...node, string: task + body})`, so refs still resolve.
- **Decisions.** `isDecision` tests `body.trimEnd().endsWith("?")` or a `#decision` in the suffix.
- **Refs.** A ref block qualifies only when:
  - it has no drawable children;
  - its target is a drawn step of the same flow, or the root;
  - it is not a self-ref.
  - A ref to a step hidden by a fold points at the nearest drawn ancestor.
  - A ref to a control block or to a block outside the tree draws as a plain node.
- **Lane source.** A `Lane::` child wins over an inline lane tag. With several inline tags, the first one counts.
- **Editing.** Export `flowEditable(node, displayed, {branch})`:
  - It returns `task + (label ? label + ": " : "") + newBody + suffix`, or null.
  - It checks markup on `body` only. Otherwise every `#CCP1` or `#lane/X` step would be read-only on the canvas (`hasMarkup(parts.rest)`, view/mindmap.js:525/771).
- **Canonical form.** `{{[[TODO]]}} Yes: text`. For `Yes: {{[[TODO]]}} text`, the label is still read, but the node is markup (not editable on the canvas) and is not a task.

**5. Node shapes change in place and are sized with Excalidraw's own formulas.**
- `buildNode` gains a `type` parameter:
  - root: `ellipse` with `roundness: null`;
  - decision: `diamond` with `{type: 2}`;
  - `#end`: `ellipse`;
  - everything else: `rectangle` with `{type: 3}`.
- Reconcile patches `type` and `roundness` in place under the same `nodeId`. On a non-flow map every node wants `rectangle`, so the patch is a no-op there.
- Measure live in acceptance that patching `type` in `updateScene` repaints, and that the node stays selectable and bound. Fallback: draw decisions as rectangles with a `◆ ` display prefix.
- **Sizing.** Diamond and ellipse sizes use `computeContainerDimensionForBoundText(textWidth + 4, type)` for both width and height (v0.18.0 `element/textElement.ts:437-455`).
  - Without this, `redrawTextBoundingBox` re-wraps text at `round(w/2) - 10` (diamond) or `round(w/2·√2) - 10` (ellipse) (textElement.ts:456-500) and grows the container. Reconcile then fights it on every font load.
  - The 4 px slack covers the 0.5 px measure drift (spec §13 NAV-1).
- **Text sizes.** Decision text wraps at `FLOW_DECISION_WRAP = 160`. Font sizes are 20 for the root and 16 for every step; depth means nothing in a flow.
- **Text position.** Centred bound text stays within `TOL` of `computeBoundTextPosition` for diamonds and ellipses (textElement.ts:233-275, 349-366).

**6. Lanes: inheritance, columns and frame ownership.**
- **Inheritance.** A step without a lane takes its primary predecessor's lane, not its tree parent's. Under the contract, `Storage` after `Receiving (Lane:: Warehouse)` would fall back into lane "".
- **Lane "" has no frame.** When no named lane exists, no frames exist.
- **Lane names** are `plainText(value)` of `Lane:: [[QA]]` or of the tag, trimmed, with whitespace collapsed. They are case-sensitive, and the frame name is that normalized string.
- **Layout.**
  - Columns go left to right in DFS pre-order of first appearance; lane "" (which holds the root) comes first.
  - Rows are by rank (amendment 1). Steps that share a (lane, rank) cell sit side by side in DFS order.
  - All lane frames have the same height.
  - Lane width is the widest row plus 2 × 24 padding plus the chip overhang, so that no member or chip crosses the frame. Frame clipping and hit-testing cut anything outside the frame (v0.18.0 `renderer/staticScene.ts` `frameClip`; `App.tsx` `getElementsAtPosition`, "hitting a frame's element from outside the frame is not considered a hit").
- **`frameId`.** Reconcile writes `frameId` only on flow maps:
  - steps in named lanes, plus their text and chips, get `frameId = laneId`;
  - lane-"" steps keep whatever `frameId` they have (a user frame survives);
  - arrows keep `frameId: null`.
- **Stale lane ids.** On every layout, a map element whose `frameId` starts with `pmm-<map>-lane-` and names a lane that is not wanted gets `frameId: null`. `getContainingFrame` does not check `isDeleted` (v0.18.0 `frame.ts:426-435`), and cframe regions, Present and Print count members by `frameId`. On maps that were never flow this is a no-op.
- **Frame creation.**
  - A new lane frame is appended after its member nodes in `ops.add`. This follows the invariant "children come right before their frame" (v0.18.0 `frame.ts:494-500`) and build.js:309-318.
  - Reconcile never reorders existing elements.
  - Lane frames are created with `locked: true`, which stops dragging a lane (which drags its children) and stops frame-delete (which deletes its children). Reconcile does not patch `locked` afterwards.
  - Measure live that locked frames still clip their members and render cframe crops. Fallback: unlocked, relying on amendment 12's snap-back.
- **Ownership.** `name`, x, y, width, height, `isDeleted` and the `{lane, map}` marker are outline-owned. Stroke and other styling stay user-owned.

**7. Chips are not grouped with their node.**
- `selectedNode()` requires `ids.length === 1` (view/mindmap.js:277). Clicking a grouped node selects the whole group, so Tab, Enter, F2, Alt+Enter and drag would all die on every CCP step.
- `onPointerDown` also requires the hit container to be the node (view/mindmap.js:426).
- Chips stay attached because reconcile places them.
- **Ids:** `pmm-<map>-<uid>-c-<n>` (n = 0 for CCP, 1 for hazard) and `…-c-<n>-t`. **Marker:** `{chip: uid, kind, map}`.
- Chip text is outline-owned. A canvas edit is reverted by the next reconcile.

**8. Flow arrows get arrowheads, and only flow-marked edges are ever patched for them.**
- Flow edges have `endArrowhead: "arrow"`. `buildEdge` hard-codes `null` (mmsync.js:113-114).
- Loops have `strokeStyle: "dashed"`.
- Reconcile patches `endArrowhead` only on an edge that is, or was, marked `flow`. Switching back to right sets `null` only where the marker says Plexus set it. Unmarked P4/P12 edges are never touched.
- **Geometry.**
  - Same-lane primary edges between adjacent ranks run from bottom-centre to top-centre.
  - Other edges are straight from centre to centre, clipped with shape-aware exits (ellipse and diamond vertices), plus `EDGE_GAP`.
  - Branch labels use `labelId(root, branchHead)`. The horizontal gap between a diamond and its branch heads must be at least the label width + 24 (compare `gapOf`, mmsync.js:296-301).

**9. The flow plan lives inside `planMap`, and the gate is proven by regression tests.**
- `planMap` returns flow `positions` for every step. The pin detector compares element positions with `plan.positions` (view/mindmap.js:554-566).
- `layoutTree` must never receive `"flow"`: it falls through to the "up" branch (mindmap.js:364, 395).
- The root marker gets `scheme: "flow"` while the layout is flow, so the fill-ownership repaint (mmsync.js:399-404) works in both directions.
- **Tests:**
  - (a) Every existing `test/mmsync.test.js` and `test/mindmap.test.js` case passes unchanged.
  - (b) A right, a cause and a fishbone fixture give ops byte-identical to `b47ad09`, and a second pass is zero-op.
  - (c) A flow fixture with lanes, a nested decision, a loop to another branch, a self-ref, `#end`, a folded decision and a CCP chip reconciles twice to zero ops.
  - (d) right → flow → right leaves no lane, chip, merge or loop element, no stale lane `frameId`, and no arrowheads.

### F2

**10. The view accepts flow, and Alt+L leaves it alone.**
- `setLayout` accepts `FLOW_LAYOUT` (the check at view/mindmap.js:885 rejects it today).
- `cycleLayout` computes `LAYOUTS.indexOf("flow") === -1` and silently switches to `right` (view/mindmap.js:867-868). On a flow map, Alt+L toasts "Flow layout: change it from the map menu" and writes nothing.
- `starFor` stays cause-only.

**11. Drag and pins on flow maps snap back.**
- `resolveDrop` returns `pin` for any layout outside `HORIZONTAL` and `VERTICAL` (mmdrop.js:7-8, 55), and `handleDrop` then returns without snapping back (view/mindmap.js:362).
- **Drops.** On flow maps:
  - a drop onto a node's inner rect reparents;
  - every other result, including Cmd-release, calls `snapBack()`.
- **Pins.** `nativeChanges` skips pin detection for flow roots (view/mindmap.js:550-567), and Alt+P toasts "Flow steps follow the outline".
- mmdrop.js does not change.

**12. Keys on flow maps follow the drawn graph.**
- **Drawn nodes.** `drawnNodes` uses F1's `drawnTree`. Otherwise Alt+Shift+Up/Down counts hidden `Lane::` and ref blocks as siblings (view/mindmap.js:787-805).
- **Shift+Tab** selects the primary predecessor.
- **Tab** adds a child: under a decision that is a new branch; otherwise it continues the sub-sequence.
- **Enter** adds the next sibling.
- **F2 input.** `editSelected` and `openInput` gain a `suffix`: `el.value = base.slice(prefix.length, base.length - suffix.length)`, and on commit the value is `prefix + value + suffix`, with the prefix and suffix taken from `flowParts`.
- **Canvas text edits.** `nativeTextEdit` calls `flowEditable` for flow maps. With `editableText` the branch label would be dropped (view/mindmap.js:528).
- **Branch-label arrow text.** An edit toasts "Edit the Yes:/No: prefix in the outline" once per session, the way `LABEL_HINT` does at view/mindmap.js:519. Reconcile restores the text.

**13. F2 asks for lane regions through an injected function, with no nested lock.**
- **Seam.** `createMindMap({…, createLaneRegions = async () => []})`.
- **When it runs.** After each successful `commit` whose ops added or undeleted a `-lane-` frame, and once per session start for existing lanes:
  - it calls `createLaneRegions(drawingUid, [{id, name}])` for named lanes only;
  - it skips when `drawingUid` is null;
  - it runs single-flight per drawing, with at most one queued re-run;
  - errors are logged with `[plexus]` and never toasted.
- **Implementation (I).** It follows the `regionsForAllFrames` pattern (actions.js:1822-1835):
  - read `host.regionsOf`;
  - drop frames that already have a `cframe` or `frame` region;
  - call `host.createRegions` with `serializeRegion({kind: "cframe", drawingUid, frameId, caption: name})`;
  - emit `{kind: "region"}` so the regions layer refreshes (extension.js:694-703).
- **No nested lock.** It must not wrap `host.createRegions` in `withLock(lockName(graph, drawingUid))`. `createRegions` already takes that lock (roam.js:148), and Web Locks are not reentrant (locks.js:13-31). The inner request would wait 5 s and then throw.
- The cross-tab race is accepted, as in `regionsForAllFrames`.

**14. F2 leaves mmwrites.js alone and writes the README convention first.**
- F2 makes no change to `src/host/mmwrites.js`. No block write may run from the reconcile path; the lane region write goes through amendment 13.
- F2 writes README section "Process flows (MM-12)" before any code. It holds amendments 1, 4 and 6 in user words:
  - the grammar;
  - the prefix and suffix tokens;
  - the ref conditions;
  - lane inheritance;
  - that copying a branch copies its refs pointing at the original steps (mmwrites.js:167-197);
  - that Alt+Backspace refuses a step targeted by a ref (mmwrites.js:211-214).
- I edits README only after F2 has landed.

### T

**15. Templates are inserted with a pure remap and one guarded write, not the paste path.**
- **Why not paste:**
  - `addElementsFromPasteOrLibrary` puts pasted elements into the frame under the viewport centre (v0.18.0 `App.tsx`, `topLayerFrame` → `addElementsToFrame`).
  - It is not a guarded write and skips `beforeBulk`.
  - `addViaPaste` passes `files: {}` (native.js:254).
  - `scene.add` needs a second write to undo the frame capture and the `addKey` tags (api.js:98-121).
- **The remap** (T, in `src/model/templates.js`, pure):
  - new ids;
  - new `groupIds` (one per old group);
  - remapped `containerId`, `boundElements[].id` and `start`/`endBinding.elementId`. A binding to an element outside the set is dropped, and the arrow's points are kept;
  - `frameId` remapped when the frame is in the set, otherwise `null`;
  - `index: null`, a new `seed`, `versionNonce` and `updated`;
  - `customData.plexus.mm` and `plexus.addKey` removed;
  - translated so that the common bounds centre on `viewCentre(app)` (actions.js:473-476).
- **Frames** in a template get `customData.plexus.order` from `planOrders` and `withOrder` (frames.js:72-87).
- **The write:** `beforeBulk(app, uid, "before Template")`, then one `guardedWrite(app, {drawingUid, label: "Template", captureUpdate: "IMMEDIATELY", next: (c) => [...c, ...els], appState: {selectedElementIds, selectedGroupIds: {}}})`. That is one undo step. Starters and user templates share this path.

**16. Images need `firebaseUrl`, and the live behaviour decides the fallback.**
- **Saving.** Image elements without `customData.firebaseUrl` are left out of a saved template, with the toast "N images without an upload were skipped".
- **Inserting.** Measure live in acceptance whether Roam shows an inserted image that has only `firebaseUrl`, without reopening the drawing. P12's "image refetch after a restore" is still unmeasured (spec §13, P12 live table).
- **Fallback:**
  - `api.file.get({url})` (the decrypt path at image-source.js:45, which works for `.enc`);
  - convert to a data URL;
  - `app.addFiles([{id: fileId, mimeType, dataURL, created}])` before the write.
  - The README notes that Roam re-uploads on each apply (spec §13 S4).
- If the fetch fails, insert anyway and toast "N images missing".

**17. Saving captures a closed selection at command time.**
- The selection is captured and cloned **before** the name prompt opens.
- **Included:**
  - the selected ids, where `native.selectedElementIds` already expands groups;
  - the bound text of every included container or arrow;
  - the children, and their bound text, of every selected frame;
  - arrows with both ends inside the set.
- **Adjusted:**
  - A selected arrow with one end outside keeps its points and loses that binding.
  - Children whose frame is not included get `frameId: null`.
- **Removed:** deleted elements and `plexus.mm` markers. Map elements become plain shapes.
- `locked` and `link` are kept.
- An empty result toasts and stops.

**18. Saving opens the template drawing in the sidebar and trusts only the persisted count.**
- **Steps:**
  1. Run single-flight (`once("templates")`) under `withLock(lockName(graph, "plexus-templates"))`.
  2. Clean the name as `cleanTitle` does (actions.js:491-493), cap it at 60 characters, and refuse a case-insensitive duplicate inline in the prompt.
  3. `ensurePage("Plexus/Templates")`, then `createBlock(name)`, then `createDrawing({parentUid})`.
  4. Close the source editor (amendment 19).
  5. Open the template with `openDrawing(uid, {sidebar: true, placeholder: true})`, so the main window never navigates away.
  6. Wait with `waitNotLoading`.
  7. Check that `activeEditor.drawingUid === templateUid`, else abort.
  8. Insert through amendment 15, without `beforeBulk`, since the drawing is new.
  9. Poll `host.drawing(templateUid)` until its live count equals the scene's live count, every 250 ms for up to 8 s. This follows the migration's verify loop (actions.js:3639-3650).
  10. Only after that, close the editor and remove the sidebar window.
  11. Reopen the original with `reuseIcon: true`.
- **Timing.** The "echo or 3 s" rule is replaced: a pull-watch echo can come from Roam's earlier empty save, and P11 measured a save 2.5 s after opening.
- **On failure:**
  - If the template drawing has 0 live elements, delete the template block.
  - Otherwise keep it and toast "Template may be incomplete".
  - Always try to reopen the original. If that fails, toast "Template saved; reopen the drawing from the outline".
- **On unload mid-flow:** stop with no further navigation and no toasts.

**19. Closing the source editor waits for Roam's save.**
- There is no close helper today. T implements `closeEditor` in actions-templates.js by clicking the full-screen container's `.bp3-icon-minimize` (the links.js:41 pattern), then waiting until `activeEditor(doc)` is null (up to 3 s).
- Measure live in acceptance whether minimize flushes a pending Roam save (edit, then save-as-template within 1 s, then reopen: the edit is there).
- Fallback: before closing, wait until `onChangeEmitter` has been quiet for 3 s, capped at 8 s.

**20. T owns two pass-throughs in actions.js.**
- `actions.openDrawing(uid, {sidebar, placeholder})` passes `placeholder` through to `openDrawingOnce`. Today it drops it (actions.js:1393), and an empty drawing has no full-screen icon (actions.js:3659).
- `actions.newDrawing({…, fresh: true})`:
  - bypasses the 2 s reuse memo (actions.js:580-585);
  - with `where: "today"`, always creates a drawing instead of reusing the first one (actions.js:546-550);
  - returns `{uid, reused, opened}`.
- Tests for both go in `test/actions-templates.test.js`.

**21. "New drawing from template…" creates a fresh drawing and checks it opened.**
- It opens the picker first, then:
  - with a focused block: `newDrawing({where: "below", uid, fresh: true})`;
  - without one: `newDrawing({where: "today", fresh: true})`.
- `newDrawingRun` returns the uid even when the editor did not open (actions.js:611-614). Before inserting, T requires `activeEditor(doc)?.drawingUid === uid` and `waitNotLoading(app, 5000)`; otherwise it toasts "Drawing created; insert the template from its menu".
- After inserting, it zooms to the inserted bounds.
- A user template's `appState` `currentItem*` keys (from `host.drawing(uid).appState`) are applied through `updateScene({appState})`, as the roadmap asks. `appState` is not props.

**22. Starters are deterministic and have fixed content.**
- `build(builder, {origin})` uses `createBuilder({measure, newId: counter})` with no randomness in geometry. `measure` is injected and is missing from the contract's `createTemplateActions` signature.
- Builder limits apply: no self-arrow (build.js:171) and no frame inside a frame (build.js:152).
- **Content:**
  - **HACCP flow:**
    - steps: receive, store, weigh, blend, "Metal detected?" (diamond, Yes → "Hold & investigate", No → fill), fill & seal, code/label, ship;
    - "CCP 1" chip on metal detection;
    - no real site data.
  - **Swab-site map:**
    - four nested zone rectangles, "Zone 1: product contact" through "Zone 4: outside production";
    - numbered site ellipses S1-S6;
    - a legend.
  - **16:9 slide:** frame 854×480 (`FRAME_PRESETS["16:9"]`, frames.js:9), named "Slide", with a title and a body text. Its order comes from amendment 15.
- **Tests:** each starter's element count, bindings on both sides, frame after its children, and no duplicate ids.

**23. The picker never cold-renders while it opens.**
- **Listing:**
  - The children of `Plexus/Templates` in order, each using its first `{{[[excalidraw]]}}` child.
  - Skip templates whose drawing has 0 live elements; cap the list at 50.
  - Names come from `plainText`.
- **Thumbnails:**
  - `thumbnail(uid, {maxWidth: 160, render: false})` only. It is cache-only, and templates are warmed when their editor closes (extension.js:575-605).
  - Tiles that miss show the name, and at most 6 serial `render: true` calls start after the picker is painted. They are cancelled when it closes.
  - Object URLs are revoked on close.
- **Starters** show no thumbnail.
- **Keys and stacking:**
  - The root isolates `keydown`, `keyup`, `keypress`, `paste`, `copy` and `cut`, as chart-dialog.js does.
  - z-index is the editor's z + 2 when an editor is open, else 1000.
  - It closes on editor unmount (`closeDialogs`) and on unload.

**24. The name prompt is not the caption prompt.**
- No submit on blur: `caption-prompt.js:70-78` commits on blur, and here that would start the close-and-reopen dance by accident. Blur does nothing.
- Enter submits. Esc and the Cancel button close it.
- It must not use the class `plexus-mm-input`. `SUGGEST_SELECTOR` would attach `[[` / `((` suggestions to it (link-suggest.js:4, 465-466).
- It uses the input isolation from caption-prompt.js (`ISOLATED` plus `keydown` `stopPropagation`) and the IME guard (`isComposing` / 229).
- Measure live that Esc in the prompt and in the picker leaves the full-screen editor open, since Roam's window-capture Esc runs first (spec §13, P10 Esc row). Fallback: accept the result if it is harmless, and rely on the Cancel button.

**25. The `createTemplateActions` seams are complete.**
- The signature becomes `createTemplateActions({doc, host, native, api, toaster, guardedWrite, beforeBulk, measure, openDrawing, newDrawing, thumbnail, openPicker = openTemplatePicker, openPrompt = openNamePrompt, withLockFn = withLock, now, sleep, zIndexFor})`.
- `closeEditor` is internal (amendment 19) and overridable only in tests.
- Tests use fakes to cover: success, verify timeout, the editor closed by the user mid-flow, the reopen failing, and unload mid-flow. Each asserts that no props are written.

### A

**26. Arrange works on units, and some elements are never units.**
- **A unit is:**
  - an outermost selected group;
  - a selected frame together with its children (`frameId`) and their bound text;
  - or a single element.
- **Never units:**
  - bound text, which follows its container;
  - arrows or lines with any binding, which are re-routed instead;
  - locked elements;
  - any `pmm-` element, including lanes and chips, with the toast "Map nodes follow the outline".
- **Operation rules:**
  - Equal size skips text, linear elements and frames. Images scale uniformly into the largest box.
  - Grid of images uses images only.
  - Lay out frame children takes exactly one non-`pmm` frame with at least one child, and grows the frame when the grid does not fit, since clipping would hide children.
  - Box around refuses a selection that contains a frame ("A frame cannot hold a frame", build.js:152). It places the frame right after its last child in array order, gives the children and their bound text its `frameId`, and sets its order with `planOrders`.
- **Frame membership after a move.** A moved unit that no longer overlaps its old frame gets `frameId: null`, mirroring `updateFrameMembershipOfSelectedElements` (v0.18.0 `frame.ts:644-692`). Units are never added to a frame they land in.

**27. Arrow re-routing depends on the arrow's shape.**
- When both ends' elements moved by the same delta, translate the whole arrow. This is exact for every kind of arrow, elbowed or bent.
- Otherwise:
  - **2-point, non-elbowed:** re-route straight from centre to centre, clipped to the shape (bounding box for rectangles, text and images; exact intersection for ellipses and diamonds) plus the existing gap (default 4). Set `focus: 0` and keep both bindings.
  - **Multi-point, elbowed or rotated (`angle ≠ 0`) endpoints:** translate only the bound endpoint, and toast "N bent or elbow arrows kept their shape".
- Arrow labels are re-placed with `arrowLabelRect` (arrowlabel.js).
- Container text is re-placed with a port of `computeBoundTextPosition` and `getContainerCoords` (textElement.ts:233-275, 349-366). The port covers `verticalAlign` and `textAlign`; the text is not simply centred.

**28. Untangle is capped and fully deterministic.**
- A Fruchterman-Reingold layout with springs along arrows bound between units, and repulsion between all pairs.
- Linear cooling over 200 iterations, with the centroid pinned.
- No `Math.random`. Units at the same position are offset by a golden-angle step indexed by element order. Results are rounded to 0.5.
- At most 200 units; above that, toast "Untangle works on up to 200 elements".
- A node test asserts identical output across runs, and under 150 ms at 200 units.
- Swap two swaps the units' centres.

**29. Each operation is one undo step, and the menu is driven by A's list.**
- Each operation runs `beforeBulk`, then one `guardedWrite({captureUpdate: "IMMEDIATELY", label: "Arrange"})`, keeping the current selection.
- Native align and distribute actions are not called.
- A exports `ARRANGE_OPS = [{op, label, enabled(units, elements)}]`:
  - two or more units for Row, Column, Grid, Equal size and Untangle;
  - exactly two for Swap;
  - two or more images for Grid of images;
  - the frame rule above for Lay out frame children.
- `createArrangeActions({doc, native, toaster, guardedWrite, beforeBulk})` returns `{canRun(op), run(op)}`. I renders the menu from this, with no copy of the logic.

### I

**30. The canvas menu gains submenu support.**
- `installCanvasMenu` injects only flat `li > button` items (context-menus.js:359-381).
- Add `{children: [...]}` items:
  - a nested `ul` flyout marked `data-plexus-item`;
  - opened on hover and on click;
  - flipped left and clamped to the viewport, like the `clamp` at 383-396;
  - hidden when no child is enabled;
  - removed on dispose.
- "Plexus: Arrange ›" is built from `ARRANGE_OPS`.
- Add `layoutItem("flow", "Flow")` next to the items at 476-478.

**31. Wiring.**
- **Mind map:** pass `createLaneRegions` (amendment 13) to `createMindMap` (extension.js:253).
- **Templates:** pass amendment 25's dependencies to `createTemplateActions`:
  - `scenes.measure` as `measure`;
  - `(app, uid, label) => scenes.beforeBulk(app, uid, label)` as `beforeBulk`.
  - Close its picker and prompt in `closeDialogs` and in the lifecycle.
- **Command-list rows:**
  - "Insert template…" needs an open editor;
  - "New drawing from template…" runs only with the editor closed, uses `ctx.focusedUid`, and otherwise toasts "Use Insert template… in an open drawing";
  - "Save selection as template…";
  - "Mind map layout: Flow" through `tools.setLayout("flow")`.
- **Constraints:**
  - no new palette entry;
  - the T CSS snippet is merged into extension.css, together with the flyout CSS;
  - README edits start only after F2 has landed.

### Gate

**32. Live acceptance adds these checks (Readwisenotes, trusted CDP).**
- **Flow:**
  - (a) Lanes created with `locked: true` still clip members and render cframe crops, and an in-place `type` patch repaints (amendments 5 and 6).
  - (b) F2 on a `#CCP1` step keeps the suffix; F2 on a `Yes:` branch keeps the label; removing `?` in a diamond turns it into a rectangle.
  - (c) A loop ref into another branch draws dashed, and folding its target moves the arrow to the drawn ancestor.
  - (d) Reopening the flow drawing twice leaves exactly one cframe region per named lane.
  - (e) An existing right, cause and fishbone map each show zero writes over 10 s (`version` sums unchanged).
- **Templates:**
  - (f) "Save selection as template" with a container, arrow, frame, group and `firebaseUrl` image leaves the main window's page unchanged and reopens the original.
  - (g) Closing the template editor by hand mid-save leaves no empty template block and gives a toast.
  - (h) An insert is one Cmd+Z, and the image shows or falls back as in amendment 16.
  - (i) Esc in the picker does not close the editor.
- **Arrange:**
  - (j) "Arrange as row" re-routes straight bound arrows in one undo step.
  - (k) An elbow arrow keeps its shape and the toast appears.
- **Performance and lifecycle:**
  - (l) Typing with the editor closed, in 4 interleaved rounds, adds under 0.05 ms per key.
  - (m) Unloading mid-save and with the picker open leaves no `.plexus-portal`, pull watch or listener, and the `window`/`document` listener counts return to baseline.
