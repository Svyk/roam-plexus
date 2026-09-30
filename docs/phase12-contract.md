# Plexus Phase 12: Diagrams from outlines (binding)

Repo `~/roam-plexus`, HEAD `173753d` (code 0.11.0, `4b5b8a0`). Target 0.12.0. Compass is unchanged, but must keep reading `Name::` attribute blocks as relations; no Compass code changes.

Scope and designs: [`roadmap-next.md`](roadmap-next.md) §5 P12: DATA-1, API-1, MM-7, MM-11, MM-8, MM-1, MM-2, GRAPH-5, and the P12 live gate. This contract adds the measured facts (spec §13 "Phase 12 measured facts"), names, file ownership and decisions. The P6-P11 contracts and amendments still bind:
- zero dependencies, plain JS, `node --test` fakes, `[plexus]` log prefix;
- never throw into Roam; remove everything on unload;
- no `confirm`, `alert` or `print`;
- scene writes go through the P8 write guard (`guardedWrite`), which is also the in-memory snapshot layer;
- no drawing props writes except through Excalidraw;
- no new command-palette entries: new actions go into the command list and the menus;
- Roam's `.bp3-toast-container` is never a menu;
- the P4 mind-map sync rules (the per-root `mmwrites` queue, echo handling, the relayout budget) stay intact;
- **never rewrite `BT_attr*` children.**

## Measured facts (spec §13)

- **`fromMarkdown`.** `roamAlphaAPI.data.block.fromMarkdown({location: {"parent-uid", order}, "markdown-string"})` returns `{uids: [top-level uids]}` and keeps nesting and `((refs))`.
- **Encryption and IndexedDB.** `roamAlphaAPI.graph.isEncrypted` is a boolean property (`false` in Readwisenotes). IndexedDB is available.
- **Better Tasks.** `window.betterTasks.v2` has `classifyBlock`, `requestDelete`, `createSubtask` and `requestStatusTag`, and no due-date call.
- **Mind-map customData.**
  - Root: `customData.plexus.mm = {uid, map, root: true, layout: "right", bounds}`.
  - Edge arrows: `{edge: [parent, child], map}`.
  - Ids: `pmm-<map>-<uid>`, `-e` for the edge, `-t` for the bound text.
- **Cause-and-effect JSON** (Plexus Canvas, `~/excalidraw-port-research/thymer-canvas-plugin/plugin.js:2734-2840`): `{nodes: [{id, text, role, category}], edges: [{effect, cause}], connections}`. `role: "primary"` marks the effect. Layouts: tree, fishbone, pentagon.

## Decisions

1. **DATA-1 snapshots.**
   - **Ring.**
     - A new IndexedDB database `plexus-snapshots`, opened without a version number first. It is upgraded only if the store is missing: close, then reopen at the current version + 1, so a blocked upgrade never wedges it.
     - Store `snapshots`, key `graph|drawingUid|t`. Value: `{graph, drawingUid, t, count, hash, elements}`, where `elements` is the live, non-deleted element array as a JSON string.
     - At most 20 per drawing. Deduped by hash. Taken when the editor unmounts, and at most every 10 minutes while mounted if the hash changed.
   - **Encrypted graphs.** Off entirely while `roamAlphaAPI.graph.isEncrypted` is true: nothing is opened or written.
   - **Restore dialog** ("Restore an earlier version…", in-page, not `confirm`). It lists the P8 in-memory guard ring entries for this drawing (label, time, element count) and the ring entries (time, count), newest first.
   - **Restore.** One `guardedWrite` with `captureUpdate: "IMMEDIATELY"`, which keeps the current elements deleted rather than dropped. Then the toast "Restored · Cmd+Z brings the current version back".
   - **Missing files.** Elements whose image files are missing stay as placeholders, and the toast counts them.
   - **Coverage.** P12's bulk operations (cause map from JSON, drawing to outline doesn't touch the scene, template apply in P13) go through `guardedWrite`, so the in-memory layer covers them.
2. **API-1 builders.**
   - `RoamPlexus.build()` returns a builder with a style state (`strokeColor`, `backgroundColor`, `fillStyle`, `strokeWidth`, `roughness`, `fontSize`, `fontFamily`).
   - It creates `rect`, `ellipse`, `diamond`, `text`, `frame`, a container with bound text (`box(text, {…})`), and `arrow(a, b, {label})`: a real bound arrow with `startBinding`/`endBinding`, both ends' `boundElements` updated, and an optional bound label.
   - `layout(ids, "row" | "column" | "grid" | "tree")` positions elements.
   - `commit(uid?)` writes once through `scene.add` or `guardedWrite` into the open drawing, or into `uid` when it is mounted, and returns the ids.
   - Elements come from the model's `baseElement`.
   - `apiVersion` becomes 5 and spec §8 documents `build` and `scene(uid).addChart(json, {layout})`.
3. **MM-7 attribute edges** (opt-in per map).
   - A child block whose whole string is `Name::`, a bare attribute with nothing after it, is an edge carrier when the map's toggle is on. Each of its children renders as a node attached to the carrier's parent. The edge between them is labelled `Name` (bound text on the arrow). The carrier itself is not drawn.
   - Toggle: `customData.plexus.mm.attrEdges` on the root element.
     - Absent means off, which covers every map made before 0.12.0.
     - Maps created by 0.12.0 set it true.
     - It is flipped from the mind-map canvas menu ("Plexus: Attribute blocks as edges"), which writes only the root's customData.
   - Turning it off restores the carrier as a node with no block writes.
   - Compass keeps reading these as harcs (no change there).
4. **MM-11 cause maps.**
   - **(a) Outline route.** `customData.plexus.mm.layout` gains `"cause"` and `"fishbone"`, set from the map menu ("Layout: Right / Cause / Fishbone").
     - `cause` is a tidy tree growing left from the effect root.
     - `fishbone` draws the effect as the head at the right. First-level causes become bones alternating above and below a spine; deeper causes become ribs on their bone.
     - Role colours: the effect is red, with a ★ prefix in its label (display only; the block text is untouched). Causes are coloured by depth.
     - `#evidence` children get a dashed stroke.
     - Open `{{[[TODO]]}}` causes show the MM-8 checkbox.
     - The edge label on cause maps is "caused by" unless an MM-7 attribute label applies.
   - **(b) JSON route.**
     - A pure `src/model/ce.js` maps the Plexus Canvas schema to elements (rect, bound text, bound arrows labelled "caused by", `customData.plexus.ce = {chart, node}`) for tree, fishbone and pentagon.
     - "Cause-and-effect from JSON…" opens a paste box dialog and inserts the chart at the viewport centre through `guardedWrite` (one undo step).
     - `RoamPlexus.scene(uid).addChart(json, {layout})` does the same.
     - "Project to blocks" is not built in P12; it goes to Later.
5. **MM-8 task nodes.**
   - A node whose block starts with `{{[[TODO]]}}` or `{{[[DONE]]}}` shows ☐ or ☑ before its text; DONE nodes are drawn at opacity 50.
   - The prefix is kept out of `hasMarkup`, so F2 edits the rest of the text, and the writer puts the prefix back.
   - Alt+Enter on the selected node toggles TODO → DONE → TODO. It is a string-only update that replaces only the macro prefix, and it goes through the `mmwrites` queue.
   - "Due" is not built (Better Tasks has no due API, and `BT_attr*` must not be written).
   - Tag colours: setting `mm-tag-colors` (default empty), for example `urgent=#ffc9c9, done=#b2f2bb`. The first matching `#tag` in a node's text sets its `backgroundColor`.
6. **MM-1 drag.**
   - When a node is released after a drag without Alt, the drop point is hit-tested against the other nodes of the same map:
     - over a node's box (inset 20%): reparent, as the target's last child;
     - in the gap between two siblings along the layout axis: reorder, taking the index between them;
     - past the root's centre line in a right/left layout: flip the node to the other side.
   - Each move is one `block.move` through the `mmwrites` queue. The echo redraws.
   - During the drag a highlight ring shows the target. The ring is a DOM overlay, not a scene element.
   - Alt-drag keeps today's pin-only behaviour.
   - Never drop a node into its own subtree.
7. **MM-2 keys** (scoped to the mounted editor, with a mind-map node selected, and not while editing text):
   - Alt+Shift+Up/Down reorders the node among its siblings.
   - Shift+Tab selects its parent.
   - Backspace on an empty node created in this session within the last 30 s deletes it without the double press.
   - Ctrl/Cmd+Alt+Arrow centres the camera on the node, using `captureUpdate: "NEVER"`.
   - Alt+X/C/V keep working.
8. **GRAPH-5 drawing to outline.**
   - A pure `src/model/outline.js` builds an outline from the live elements (a selection, or the whole drawing):
     - frames become headings, in `orderFrames` order;
     - inside each frame, then for elements outside any frame, items are ordered by a topological sort of bound arrows, falling back to reading order (y, then x). Cycles are broken by reading order;
     - arrows also nest: a single incoming arrow from a text node makes the target its child;
     - text elements contribute `originalText`, keeping `[[links]]`;
     - embed anchors and linked elements contribute their `((uid))` or `[[Title]]`.
   - "Drawing to outline…" writes with `fromMarkdown` under a Plexus-owned `{{[[plexus-outline]]}}` child of the drawing block. The child is created collapsed, and its uid is stored in the drawing root customData? **No:** it is located by string, as the first child equal to `{{[[plexus-outline]]}}`. Drawing props are never written for this.
   - A re-run replaces that container's children: delete, then insert, under the drawing's lock. A preview dialog lists the headings and counts first when more than 50 blocks would be written.
   - "Copy as Roam markdown" puts the same markdown on the clipboard.
   - Nothing outside the container is written.

## Shared names

- `src/host/snapshots.js` (new, S): `createSnapshotStore({idb, graphName, isEncrypted, now})` → `{put(drawingUid, elements), list(drawingUid), get(key), dispose()}`, and `createSnapshotScheduler({store, getElements, intervalMs})`.
- `src/view/restore-dialog.js` (new, S): `openRestoreDialog({doc, entries, onRestore, zIndex})`.
- `src/model/build.js` (new, B): `createBuilder({style})`; `src/model/ce.js` (new, B): `chartToElements(chart, {layout, origin})`.
- `src/model/mindmap.js` and `src/model/mmsync.js` (M1): attribute-edge carriers, the `cause` and `fishbone` layouts, and task and tag detection (`taskState(string)`, `tagColor(string, map)`).
- `src/view/mindmap.js` and `src/host/mmwrites.js` (M2): drag reparent and reorder, the MM-2 keys, the Alt+Enter toggle, the map menu toggles.
- `src/model/outline.js` (new, G): `elementsToOutline(elements, {frames})` → tree; `outlineToMarkdown(tree)`. `src/actions-outline.js` (new, G): `createOutlineActions({host, native, toaster, clipboard})` → `{drawingToOutline(drawingUid, {selection}), copyMarkdown(drawingUid, {selection})}`.
- Settings (I): `mm-tag-colors` (text, default "") → `mmTagColors`.

## Units and ownership (parallel; only targeted `node --test <files> < /dev/null`; never `npm run check` / `npm test` / build)

| Unit | Owns | Items |
|---|---|---|
| S | `src/host/snapshots.js`, `src/view/restore-dialog.js`, their tests, CSS snippet `/tmp/wo/p12-css-restore.css` | DATA-1 |
| B | `src/model/build.js`, `src/model/ce.js`, `src/api.js`, `test/build-api.test.js`, `test/ce.test.js`, `test/api-p12.test.js` | API-1, MM-11 JSON route |
| M1 | `src/model/mindmap.js`, `src/model/mmsync.js`, `test/mindmap.test.js`, `test/mmsync.test.js` | MM-7 carriers, MM-11 outline layouts, MM-8 detection and colours |
| M2 | `src/view/mindmap.js`, `src/host/mmwrites.js`, `test/view-mindmap*.test.js` (existing and new), `test/host-mmwrites.test.js`, CSS snippet `/tmp/wo/p12-css-mm.css` | MM-1, MM-2, MM-8 toggle, the map menu toggles |
| G | `src/model/outline.js`, `src/actions-outline.js`, `test/outline.test.js`, `test/actions-outline.test.js` | GRAPH-5 |
| I | `src/extension.js`, `src/actions.js` (only wiring hooks such as `restoreSnapshot` and `addChart`), `src/view/context-menus.js`, `src/settings.js`, `src/view/settings-dialog.js`, `src/extension.css`, their tests, `package.json` 0.12.0, `CHANGELOG.md`, `README.md`, `test/build.test.js`, `docs/spec-plexus.md` §8 | wiring, menu items, command-list rows ("Restore an earlier version…", "Cause-and-effect from JSON…", "Drawing to outline…", "Copy as Roam markdown", map layout and attribute-edge toggles), settings; runs last with `npm run check` |

## Gate

The roadmap-next P12 live gate, items 1-6, in Readwisenotes. Plus:
- typing +0 with the editor closed;
- unload leaves no dialog, overlay ring or open IndexedDB connection;
- the encrypted-graph check (the ring is off there, and the in-memory restore works) is read-only on svy, and only if the user re-approves it. Otherwise it is covered by a unit test with `isEncrypted: true`, and the CHANGELOG says so.

## Amendments (critic, binding)

These amendments override the contract body wherever the two conflict. Code references are to `~/roam-plexus` at `173753d`. "v0.18.0" means `git -C ~/excalidraw-port-research/excalidraw show v0.18.0:packages/excalidraw/<path>`. The fork's working tree is 0.18.105, which is not Roam's build (amendment 10).

### S

**1. The snapshot database opens lazily, without a version number, and cannot get stuck.**
- Nothing opens at extension load. The first `put` (the mount snapshot) or the first `list` opens the database.
- Call `idb.open("plexus-snapshots")` with no version number.
  - On a fresh database this fires `onupgradeneeded` (old version 0). Create both stores there (amendment 2).
  - Only when an existing database is missing a store: close it and reopen once at `db.version + 1`.
- For every open request:
  - `onblocked` resolves null.
  - A 3 s timeout resolves null.
  - A null result turns the ring off for 60 s.
- The working reference is `thymer-whiteboard/plugin.js:59-83`. The roadmap's citation of `thymer-canvas-plugin/plugin.js:64-108` is out of date.
- Every connection sets `onversionchange = () => { db.close(); dbPromise = null; }`. A previous extension instance or another Roam window then cannot block an upgrade.
- S never opens or changes `plexus-cache` (cache.js:58-81, fixed at version 1).

**2. Metadata and data live in separate stores, with array keys and hard caps.**
- Store `snapshots` holds metadata: `{key: [graph, drawingUid, t], graph, drawingUid, t, count, hash, bytes}`.
- Store `snapshotData` holds `{key, elements}`, where `elements` is the non-deleted elements as a JSON string.
- `list` reads metadata only, over the key range `[graph, uid, 0]`..`[graph, uid, Infinity]`. Opening the dialog therefore never loads megabytes. `get(key)` reads one data row.
- The contract's string key `graph|drawingUid|t` is replaced by the array key.
- `put`:
  - Skip when `hash` equals that drawing's newest hash.
  - In the same readwrite transaction over both stores, delete that drawing's rows beyond 20.
- Caps:
  - A snapshot whose JSON is over 20 MB is skipped, with one `[plexus]` warning per drawing per session.
  - When this graph's total `bytes` passes 100 MB, delete the oldest rows across drawings, but never a drawing's newest row.
  - On `QuotaExceededError`, delete the oldest quarter, retry once, then warn.
- `hash` is `fnv1a` of the JSON (model/hash.js). Before stringifying, compare the cheap signature `liveCount|versionSum` (guard.js:5-7) with the last one taken, and skip when they are equal.
- Seams: `createSnapshotStore({idb, keyRange = globalThis.IDBKeyRange, graphName, isEncrypted, now})`. Node has no `IDBKeyRange`, so tests inject a fake (host-cache.test.js:61-100 shows the pattern).

**3. The unmount snapshot uses the last captured scene, because the App is empty by then.**
- In 0.18.0, `componentWillUnmount` destroys and replaces the scene, empties `files` and clears `onChangeEmitter` (App.tsx:2519-2534).
- Discovery reports the unmount after that has happened (extension.js:641-644), so `getSceneElementsIncludingDeleted()` already returns `[]`.
- The scheduler's signature changes to `createSnapshotScheduler({store, app, drawingUid, intervalMs = 600000, timers, requestIdle})`, returning `{snapshotNow(reason), dispose({final})}`. It works as follows:
  - It subscribes to `app.onChangeEmitter` and keeps only a reference to the first argument (the scene array). The cost per change is O(1).
  - It takes a mount snapshot in an idle callback once `!app.state.isLoading` (polling for at most 5 s). Deduplication makes this free when nothing changed since the last close.
  - It takes the interval snapshot in an idle callback. If a gesture or text edit is active (`cursorButton === "down"`, `editingTextElement`, `newElement`, `resizingElement`, `isResizing` or `isRotating`), it retries in 30 s.
  - `dispose({final: true})` stores the last captured array. It never stores a snapshot with 0 elements when the previous one had elements.
- No timer or listener exists while no editor is mounted.

**4. Dispose closes the connection after writes in progress finish.**
- Lifecycle disposal runs last-in, first-out and is awaited (lifecycle.js:85-96).
- Create the store before `lifecycle.add(() => unmountEditor({unloading: true}))` (extension.js:491). The store's dispose then runs after the final unmount put.
- `store.dispose()` returns a promise:
  - New puts become no-ops.
  - Puts already in progress get at most 1 s.
  - Then it calls `db.close()` and sets `dbPromise = null`.
  - A put still waiting on `openDb()` is dropped silently.

**5. S owns `src/host/guard.js` and `test/host-guard.test.js`, and adds `list` and `restoreTo`.**
- Today's guard ring:
  - It stores deltas (`before`, `added`).
  - It records only writes that remove at least one element and are not `NEVER` (guard.js:78-80).
  - It keeps 5 entries per drawing (guard.js:25) and has no list call (guard.js:162-171).
- Add `list(drawingUid)`. It returns entries newest first as `[{index, label, time, count: before.length}]`.
- Add `restoreTo(app, drawingUid, index)`:
  - It composes entries `0..index` from newest to oldest. Where entries overlap, the older `before` wins, and every `added` id is deleted.
  - It applies the result in one `updateScene({elements, captureUpdate: "IMMEDIATELY"})`, verifies and toasts as `restoreLast` does (guard.js:116-160), and pops the entries.
- `restoreLast` becomes `restoreTo(app, uid, 0)`, and its existing tests stay unchanged.
- The "Coverage" item in decision 1 is wrong and is replaced by this:
  - Writes that only add elements (the JSON chart, `build().commit`) leave no guard entry. Cmd+Z and the ring snapshot taken before them cover them (amendment 7).
  - Mind-map writes use `NEVER` (view/mindmap.js:133) and never reach the guard ring.

**6. Restoring a ring snapshot is a pure plan plus one forced guarded write.**
- S exports `planRestore({current, snapshot, files})` from snapshots.js. It returns `{next, restored, deleted, missingFiles}`:
  - `next` lists the snapshot elements in snapshot order, each with `version = max(current, snapshot) + 1`, a new `versionNonce` and a new `updated`. Current elements that are missing from the snapshot follow, bumped with `isDeleted: true`. Elements that were already deleted stay as they are.
  - Elements whose id starts with `pmm-` keep their current state on both sides. The outline owns mind maps, and restoring old positions would make the pin detector (view/mindmap.js:358-375) pin every restored node.
  - `missingFiles` counts restored `image` elements whose `fileId` is not in `app.files`.
- I's `restoreSnapshot(key)`:
  - It requires that drawing's editor to be open, with no gesture or text edit in progress.
  - It calls `snapshotNow("before restore")` first.
  - It then calls `guardedWrite(app, {drawingUid, label: "Restore", next, captureUpdate: "IMMEDIATELY", force: true, appState: {selectedElementIds: {}, selectedGroupIds: {}}})`.
- `force: true` is needed because restoring an older, smaller version trips the shrink refusal (guard.js:74).
- The empty selection keeps the mind-map Cmd+Z interception (view/mindmap.js:533) away from the undo.
- The toast reads "Restored · Cmd+Z brings the current version back" (Ctrl+Z outside macOS). When `missingFiles` is non-zero, " · N images missing" is appended.
- Measure live whether Roam refetches a restored image from `customData.firebaseUrl`. If it does not, the fallback is the placeholder plus the count.

**7. Each P12 bulk operation takes a ring snapshot first.**
- The bulk operations are:
  - the JSON chart insert (dialog and `addChart`);
  - `build().commit()`;
  - restore.
- Each one calls `snapshotNow("before <label>")` on the open drawing before it writes. This is a no-op on encrypted graphs, and deduplication still applies.
- These are not bulk operations:
  - Mind-map layout and attribute toggles, which are driven by the outline and can be reversed.
  - GRAPH-5, which writes nothing to the scene.
- Plumbing: B adds `beforeBulk(app, uid)` to `createSceneRegistry` and `createPublicApi` (B chooses which). I wires it to the mounted scheduler.

**8. The restore dialog shows both kinds of entry and keeps keys away from Excalidraw.**
- Signature: `openRestoreDialog({doc, zIndex, session, loadSaved, onRestore, onClose, mac})`.
- Section "This session" lists guard entries: label, time, and "N elements".
- Section "Saved on this device" lists ring entries: time and element count.
  - It shows "Loading…" until `loadSaved()` resolves.
  - On encrypted graphs it reads "Not kept on encrypted graphs".
- The dialog lives on `doc.body` at `zIndex + 2`.
- Its root stops propagation of `keydown keyup keypress paste copy cut`. Excalidraw listens on `document` (App.tsx:2584) and would otherwise switch tools when letters are typed.
- Esc and Cancel close it, and focus returns to the canvas.
- Only one dialog exists at a time. It closes on editor unmount and on unload.

**9. Encryption and graph identity are read once from the host.**
- Read `host.isEncrypted()` and `host.graphName()` (roam.js:487-488) once at load.
- On an encrypted graph:
  - `put`, `list` and `get` resolve empty without calling `idb.open`.
  - No scheduler is created.
  - The dialog still lists and restores guard entries.
- A unit test covers this with `isEncrypted: true`.

### B

**10. Element shapes come from tag v0.18.0, not from the fork's working tree.**
- The fork's HEAD is 0.18.105. There, every binding is `{elementId, fixedPoint, mode}` (`packages/element/src/types.ts:310-323, 363-364`).
- Roam's build is 0.18.0 (spec §13, Phase 7). There, non-elbow arrows use `PointBinding {elementId, focus, gap}`, and `fixedPoint` exists only on elbow arrows (v0.18.0 `element/types.ts:279-293, 316-317, 338-339`).
- Fields beyond `baseElement` (embeds.js:39-48):
  - Rectangle: `roundness: {type: 3}`. Diamond: `{type: 2}`. Ellipse: `null`.
  - `boundElements` is `[]` when anything binds to the element, otherwise `null`.
  - Text: `text` (wrapped), `originalText`, `fontSize`, `fontFamily`, `textAlign`, `verticalAlign`, `containerId` (null when free), `autoResize: true`, `lineHeight: 1.25`. There is no `baseline`.
  - Arrow: `points: [[0,0],[dx,dy]]`, `lastCommittedPoint: null`, `startBinding` and `endBinding` as `{elementId, focus: 0, gap: 4}` or null, `startArrowhead: null`, `endArrowhead: "arrow"`, `elbowed: false`, `roundness: null`, `width: |dx|`, `height: |dy|`.
  - Line: the same as an arrow, without `elbowed`, with null bindings and null arrowheads.
  - Frame: `name`. Children carry `frameId` and come before the frame in the array (as on the P11 `presetFrame` path).
  - `index: null` on every element.
  - Never emit `fixedPoint`, `mode`, `polygon` or `fixedSegments`.
- Style defaults replace `baseElement`'s `strokeWidth: 1` and `roughness: 0`: `{strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 2, roughness: 1, fontSize: 20, fontFamily: 5}`.

**11. Labels and bindings use 0.18.0's formulas from one shared helper, which B owns.**
- New file `src/model/arrowlabel.js` (B), tested in `test/build-api.test.js`:
  - `arrowLabelRect({x, y, points}, w, h)` returns the midpoint of the two global points minus half the text size: `{x: x + (p0x + p1x)/2 - w/2, y: y + (p0y + p1y)/2 - h/2}` (v0.18.0 `element/linearElementEditor.ts:1510-1555`).
  - `arrowLabelWrapWidth(arrowWidth, fontSize)` returns `max(0.7 × arrowWidth, 11 × fontSize)` (`element/textElement.ts:456-465`, `constants.ts:326-327`).
  - M1 imports both and does not re-implement them.
- Label text uses fontSize 16 and fontFamily 5, centred, with `containerId` set to the arrow id. The arrow's `boundElements` is `[{id, type: "text"}]`. A container holds at most one bound text.
- `arrow(a, b)` binds to containers only:
  - A bound-text id resolves to its container.
  - An unknown id throws.
  - Both ends' `boundElements` gain `{id, type: "arrow"}`.
- Endpoints are computed at commit time from the final positions: take the centre-to-centre line, clip it to each bounding box, and push it out by the 4 px gap. Excalidraw re-routes the arrow on the first move; the acceptance test is "stays bound".

**12. The model builder is pure, and `commit` writes through the guard, never through `scene.add`, and never into a closed drawing.**
- `scene.add` pastes (api.js:73 → native.js:252-256 → `addElementsFromPasteOrLibrary`). That path runs `restoreElements` and then `duplicateElements`, which gives every element a new id, and it grid-snaps the offset (v0.18.0 App.tsx:3195-3232). The builder's returned ids and the `ce` markers would not survive it.
- `createBuilder({style, measure, newId})` (model/build.js) returns elements and never touches a scene.
- api.js's `build()` wraps the builder and adds `commit(uid?)`:
  - It uses `native.activeEditor(doc)`.
  - It throws `Error("Drawing is not open; call RoamPlexus.whenOpen(uid) first")` when no editor is open, or when `uid` differs from the open editor's `drawingUid`. It never opens a drawing.
  - It calls `beforeBulk`, then makes one `guardedWrite(app, {drawingUid, label: "Build", captureUpdate: "IMMEDIATELY", next: (c) => [...c, ...els], appState: {selectedElementIds: <top-level new ids>, selectedGroupIds: {}}})`. This is the `insertGuarded` shape (actions.js:479-489).
  - It throws when an id already exists in the scene.
  - After a commit the builder is sealed: a second `commit` throws "Already committed".
  - It returns the ids in creation order.
- I passes `measurer.measure`, which measures Excalifont only (host/measure.js:3, 16-36). For other font families, width is estimated as `0.6 × fontSize` per character, and spec §8 says so.

**13. The `layout` kinds are defined.**
- `row` and `column`: elements in the given order, centres aligned, gap 40.
- `grid`: `cols = ceil(sqrt(n))`, filled row by row, each cell as large as the largest element, gap 40.
- `tree`:
  - Roots are the ids that have no incoming builder arrow among `ids`, in `ids` order.
  - Place them with `layoutTree({layout: "right"})` (model/mindmap.js:248), using the builder's sizes.
  - Several roots stack vertically with gap 40.
- `layout` moves only this builder's elements; a foreign id throws. Arrows are re-routed at commit.
- M1 keeps `layoutTree`'s signature and its P4 output unchanged. The optional `gapOf` from amendment 21 defaults to today's behaviour.

**14. The cause-and-effect JSON route follows Plexus Canvas and handles every field.**
- Input is an object or a JSON string: `{nodes: [{id, text, role, category?, terminator?}], edges: [{effect, cause}], connections: [{from, to, label}]}` (plugin.js:2764-2821).
  - Unknown roles count as neutral.
  - When two nodes share an id, the first wins.
  - Edges and connections that name unknown nodes are skipped and counted.
  - Input with more than 300 nodes is refused.
- The root is the first node with `role: "primary"`, otherwise the first node.
  - A cause shared by several effects is placed once.
  - Cycles stop at the visited set.
  - Nodes that cannot be reached from the root stack at the left.
- Each node is a rectangle with bound text:
  - The primary node's text gets `★ ` in front.
  - `Category: rest` becomes two lines, `Category:\nrest`, in the single bound text.
  - The box is at least 152×50 and grows to fit the wrapped text (maximum text width 240).
  - The stroke is the role colour and the fill is its tint (`CE_ROLE_COLOR`, `tintColor`, plugin.js:556, 739-741).
- `terminator: end | question` adds an unbound 22 px ellipse to the right of the node. For `question` it holds a "?" as bound text.
- `tree` layout: effect → cause arrows, bound at both ends, with `endArrowhead: "arrow"`, stroke `#94a3b8`, and the bound label "caused by".
- `fishbone` layout: the spine and bones are unbound `line` elements with no labels (ceFishbonePositions, plugin.js:2743-2763).
- `pentagon` layout:
  - A closed `line` can neither be bound to nor hold text.
  - So the head is a rectangle container (transparent stroke, bound text, arrows bind to it) plus the pentagon `line`, sharing one `groupIds` entry.
  - Everything else is laid out as `tree`.
- Connections are arrows bound at both ends, stroke `#f97316`, dashed, with the bound label `label || "Connects to"`.
- Markers are merged into `customData.plexus.ce`:
  - nodes: `{chart, node: String(id)}`
  - edges: `{chart, edge: [effect, cause]}`
  - connections: `{chart, conn: [from, to]}`
  - lines: `{chart, line: "spine" | "bone" | "pentagon"}`
  - `chart` is `ce-` plus 8 random hex characters, new for each insert.
- Placement: the centre of the chart's bounding box goes to `viewCentre` (actions.js:473-476), or to `{at: {x, y}}` when the API supplies it.
- `scene(uid).addChart(json, {layout = "tree", at})` returns `{chart, ids, skipped}` and throws on invalid input. The dialog shows a toast instead of throwing.

**15. B owns the paste dialog and the API-version tests.**
- New file `src/view/chart-dialog.js`: `openChartDialog({doc, zIndex, onInsert, onClose})`. It contains:
  - a textarea;
  - "Choose file…", an `<input type="file" accept=".json,application/json">` read through `FileReader`;
  - a layout selector (tree, fishbone, pentagon);
  - Insert and Cancel buttons.
- The dialog never reads the clipboard, and it isolates keys as in amendment 8.
- B also owns `test/view-chart-dialog.test.js` and the CSS snippet `/tmp/wo/p12-css-chart.css`.
- Setting `API_VERSION = 5` (api.js:6) breaks `test/api.test.js:28, 78, 188` and `test/api-p8.test.js:24`. B owns those two files for this change only.
- I documents the following in spec §8:
  - `apiVersion: 5`;
  - `build()`: style, shapes, `box`, `arrow`, `layout`, and `commit` with its refusal;
  - `scene(uid).addChart`;
  - the font-family measuring caveat.

### M1

**16. Existing maps reconcile to zero ops, and M1's exports are fixed.**
- Take a map made by 0.11.0 (no `attrEdges`, a P4 layout, no tasks, no tag setting). Reconciling it against its own 0.11.0 output must give `isEmptyOps`, and a fixture test checks this.
- New marker fields are written only where the feature applies; an absent field means the default.
- These one-time changes go in the CHANGELOG:
  - Task nodes redraw with `☐`/`☑` (amendment 19).
  - Better Tasks attribute nodes disappear (amendment 18).
- Extend the bench (mmsync.test.js:307-325):
  - Add a 200-node `cause` map with a label on every edge.
  - Add a 200-node map with 20 carriers.
  - Log both. A warm no-op must stay under 50 ms.
- M2 and B code against these exports:
  - model/mindmap.js: `CAUSE_LAYOUTS`, `isHiddenString`, `taskParts`, `taskState`, `tagColor`, `editableText`, `visualTree`, and `layoutTree({…, gapOf})`.
  - mmsync.js: the `planMap` and `reconcile` options `{tagColors, rootDefaults}`.

**17. Attribute carriers are a pure transform applied inside `planMap`.**
- `trees` stays the raw block tree, which the view edits optimistically (view/mindmap.js:396-421, 493-504).
- `planMap` applies `visualTree(tree, {attrEdges: rootMM.attrEdges === true})` before sizing. Reconcile, the pin detector (view/mindmap.js:362) and drop hit-testing then all see the same geometry.
- A block is a carrier only when all of these hold:
  - Its trimmed string is `Name::`, where Name is 1-60 characters with no `:`, newline, backtick or `{`, and does not start with `BT_attr`.
  - It is not the root.
  - Its parent is drawn, which means the parent is not itself a carrier.
  - `open !== false`.
  - It has at least one child that can be drawn.
- A block that fails any condition is drawn as an ordinary node. An empty or collapsed carrier therefore stays visible and usable.
- The carrier's children are spliced into its parent's children at the carrier's position. Each gets `edgeLabel = plainText(Name)` and `via = carrierUid`.
- Ids do not change:
  - Children keep their `nodeId`.
  - Each child's edge keeps `edgeId(map, child)`. Its start is rebound to the drawn parent (mmsync.js:326), and it gets the marker `{edge: [drawnParent, child], via, map}`.
  - The carrier's node, text and edge are swept to `isDeleted`. They are un-deleted when the toggle turns off (mmsync.js:284).
- Labels:
  - The label id is `${edgeId(map, child)}-t`, with marker `{label: child, map}`.
  - Roam uids are 9 characters long, so the `-e-t` suffix cannot collide with a node's `-t`.
  - The copy rule (mmsync.js:227-236) gets this label's canonical id.
  - An edge's `boundElements` merge under the P4 prefix rule.
  - An edge that already carries a live bound text from someone else (a user's label) gets no Plexus label.
- Reconcile owns label text and geometry, so a native edit of a label is reverted on the next pass. The view shows the toast "Edit the attribute block in the outline" once per session.
- Carrier children that become depth-1 nodes change branch. The P4 rule (mmsync.js:287) repaints them once.

**18. Better Tasks attribute blocks are never drawn.**
- `treeFromPull` drops blocks that match `^\s*BT_attr[A-Za-z0-9_]*::`, through a new `isHiddenString` used for rendering only.
- `isExcludedString` does not change. The writer still moves, copies and deletes these blocks together with their task (mmwrites.js:142, 172).
- The reason: today `BT_attrGTD:: Someday` draws as a node with no markup. F2, native edits, Alt+X/V, Alt+Backspace, and the new drag and reorder could all rewrite or move it.

**19. Task prefixes show through `plainText`, split apart for editing, and leave P4 invariant 16 intact.**
- `taskParts(s)` returns `{state: "TODO" | "DONE" | null, prefix, rest}`.
  - It matches exactly `^\{\{\[\[(TODO|DONE)\]\]\}\}` plus at most one following space.
  - That space belongs to `prefix`.
- `plainText` shows a task as `☐ ` or `☑ ` followed by `plainText(rest)`. When `rest` is empty it shows the glyph alone.
- `hasMarkup` does not change. P4 amendment 16 (`hasMarkup(s) === (plainText(s) !== s)`, property-tested) stays true. Callers check `hasMarkup(rest)`.
- `editableText(node, displayed, {star})` returns the new block string or null:
  - It strips the folded suffix (the logic now at view/mindmap.js:336-340), a leading `★ `, and a leading `☐ ` or `☑ `.
  - It puts `prefix` back in front.
  - It returns null when `rest` contains markup or nothing changed.
- Measure live that `☐ ☑ ★` render in Roam's font stack. If they do not, fall back to `[ ] `, `[x] ` and `* `.

**20. Style fields get a written ownership rule (amends P4 amendment 10).**
- P4 behaviour stays:
  - Styles are set when the element is created.
  - `backgroundColor` is repainted when a node's depth-1 branch changes (mmsync.js:287).
  - A native recolour survives.
- The target fill, in priority order:
  1. a tag colour;
  2. on cause and fishbone maps: effect `#ffc9c9`, depth 1 `#ffd8a8`, depth 2 `#ffec99`, depth 3 and deeper `#e9ecef`;
  3. otherwise `colorFor(v)` (mmsync.js:165).
- Repaints happen only on an event, and only to elements still showing the fill Plexus last set:
  - Scheme event: `rootMM.scheme` (absent means `"branch"`) differs from the layout family. The family is `branch` for the five P4 layouts and `cause` for cause and fishbone. Repaint the nodes whose fill equals the old scheme's fill for them, then set `scheme`.
  - Tag event: the node marker `tag` (absent means none) differs from the current tag colour. Repaint when the fill equals the old expected fill, then set or delete `tag`.
- DONE:
  - The rectangle and its bound text get `opacity: 50`, and the marker gets `done: true`.
  - When the node is no longer DONE, opacity goes back to 100 and the marker is removed, but only while the opacity is still 50.
- Evidence:
  - On cause and fishbone maps, `#evidence` or `#[[evidence]]` (any case) gives `strokeStyle: "dashed"` and the marker `dash: true`.
  - This is reverted the same way.
- Tests:
  - A native recolour survives both a reconcile and a tag change.
  - Switching cause ↔ right repaints only nodes Plexus coloured.
  - A second pass gives zero ops.

**21. `cause` and `fishbone` have specified geometry, and `LAYOUTS` stays at five.**
- `LAYOUTS` (mindmap.js:15) does not change, so Alt+L still cycles the five P4 layouts.
  - From cause or fishbone, Alt+L goes to "right" (index −1 becomes 0, view/mindmap.js:617-618).
  - Export `CAUSE_LAYOUTS = ["cause", "fishbone"]`.
- `layoutTree` and `edgeGeometry` handle both new layouts explicitly. Today an unknown layout takes the `up` branch (mindmap.js:280-283) and gets centre-to-centre edges (mmsync.js:127).
- `cause` uses the `left` geometry, plus:
  - the root displayed as `★ ` + text;
  - the label "caused by" on every edge that has no MM-7 label;
  - the cause palette and the evidence dash.
- `layoutTree` takes an optional `gapOf(uid)`, which defaults to `LEVEL_GAP`. A labelled edge uses `max(LEVEL_GAP, labelWidth + 24)` along the layout axis.
- `fishbone`:
  - The head is the root, placed at the anchor.
  - The spine is an unbound `line` with id `pmm-<map>-<map>-s` and marker `{spine: map, map}`. It runs left from the middle of the head's left edge.
  - Level-1 cause `i` takes slot `floor(i/2)`. Even causes go above the spine, odd causes below.
  - Each level-1 subtree is laid out as `left`. It sits entirely above the spine (its bottom at spineY − 50) or entirely below it (its top at spineY + 50).
  - The subtree's right edge sits at the slot's spine x − 40.
  - A slot is as wide as the wider of its two subtrees, plus 60.
  - Level-1 edges start on the spine at the slot's x with `startBinding: null` and end bound to the cause. They are left out of the root's `boundElements`.
  - Deeper edges are ordinary `left` edges.
  - Labels work as for `cause`.
- Leaving fishbone restores the start bindings through the normal rebinding rule.

**22. Tag colours are a parsed Map plus a pure matcher.**
- I parses the `mm-tag-colors` setting into `mmTagColors: Map<lowercase tag, colour>`:
  - Entries are split on `,` and read as `tag=colour`.
  - A `#` before the tag is optional.
  - Only `#rgb` and `#rrggbb` colours are kept; other entries are dropped silently.
- `tagColor(string, map)` scans the raw block string (plainText has already removed the `#`) in text order.
  - It looks for `#tag`, `#[[tag]]` and the task macro, which counts as the tag `todo` or `done`. This is what makes the contract's `done=#b2f2bb` example work.
  - Matching ignores case.
  - The first match that has a colour wins.
- `planMap` and `reconcile` take `tagColors` (default: an empty Map).
- The view reads the setting through a getter at each commit. A changed setting applies at each map's next reconcile.

### M2

**23. Alt-drag duplicates elements in 0.18.0, so the pin-only gesture uses Cmd/Ctrl.**
- With Alt held, Excalidraw duplicates the selection and moves the originals (v0.18.0 App.tsx:8413-8526).
- Today that pins the node and leaves behind a copy with no marker (P4 amendment 6). The contract's "Alt-drag keeps pin-only behaviour" is therefore false.
- New rule:
  - A drop with Cmd/Ctrl held at release pins the node, and so does a drop outside every target zone. This is today's pin behaviour.
  - Cmd held during a drag only turns off grid snapping (App.tsx:8390).
  - When `pointerDownState.hit.hasBeenDuplicated` is set, MM-1 does nothing.
- Measure live that P10 text-links does not treat the release of a Cmd-drag as a Cmd-click.
- Undo:
  - The drag is in Excalidraw's history.
  - Cmd+Z with nothing selected moves the node back, and the next pass pins it, as with any P4 drag.
  - Cmd+Z with the node selected keeps showing the outline hint (view/mindmap.js:533).
  - The CHANGELOG says "undo map moves in the outline".

**24. The drop is decided at pointer-up and applied in the next pass.**
- Subscribe to `app.onPointerDownEmitter`. Read the arguments of `onPointerUpEmitter`, which are `(activeTool, pointerDownState, event)` (v0.18.0 App.tsx:648-662, 8960; `PointerDownState` at types.ts:700-758). Today `onPointerUp` ignores them (view/mindmap.js:287).
- MM-1 applies only when all of these hold:
  - `activeTool.type === "selection"` and `drag.hasOccurred`;
  - neither `resize.isResizing` nor `viewModeEnabled`;
  - exactly one element is selected (bound text aside), and it is a non-root node of a tree in this session;
  - `hit.element` is that node or its text.
- The drop point is `viewportToScene({x: event.clientX, y: event.clientY, appState})`, falling back to `pointerDownState.lastCoords`.
- The handler only records `pendingDrop`. After the emitter fires, Excalidraw still updates frame membership and calls `store.shouldCaptureIncrement()` (App.tsx:9273-9279, 9613). A scene write inside the handler could therefore end up in the user's undo step.
- The next `pass()` handles `pendingDrop` before `nativeChanges`:
  1. Move the node in the local tree (the optimistic pattern `newNode` uses), clear its `pinned`, call `commit(…, [root])`, and keep the node out of `pinPatch`.
  2. Queue the write. Once it settles, call `refreshRoot`, as paste does (view/mindmap.js:664).
  3. On failure, toast and call `refreshRoot`. The outline wins and the node is not pinned.
- Refused drops (into the node's own subtree, onto the root, into another map) snap back without pinning. The own-subtree case toasts "Cannot move a branch into itself".

**25. Drop zones come from a pure resolver in a new M2 file, and flip-side is cut.**
- New files `src/model/mmdrop.js` and `test/mmdrop.test.js` (M2).
- `resolveDrop({plan, tree, dragged, point, layout})` returns one of:
  - `reparent {parentUid}`
  - `reorder {parentUid, beforeUid | afterUid}`
  - `pin`
  - `refuse {reason}`
- Candidates are every drawn node except the dragged node and its visible subtree.
- Reparent zone: the inner 60 % of a node's box, inset 20 % from each side.
- Reorder zones exist for right, left, cause, down and up, but not for radial or fishbone:
  - For each drawn parent, sort its children along the cross axis.
  - The band between siblings `a` and `b` runs from `a`'s 80 % line to `b`'s 20 % line.
  - One extra band sits before the first child and one after the last, each `0.5 × h + SIBLING_GAP` deep.
  - Across the axis, bands span the siblings' extent ± 20.
- Where zones overlap, reparent wins.
- A reorder next to a carrier's child resolves to that child's block parent (`via`).
- Flip-side is cut from MM-1 and MM-2:
  - `layoutTree` puts every child on one side (mindmap.js:280-283), and no layout is two-sided.
  - Flip-side moves to Later, together with a two-sided layout.

**26. The writer gets one positioned move and never guesses Roam's order.**
- `moveTo(rootUid, uid, {parentUid, beforeUid | afterUid})` runs in `rootUid`'s queue, under its lock, with fresh pulls inside the job:
  - It refuses when the block is missing or when the target is inside the block's own branch (`insideBranch`, mmwrites.js:115-119).
  - It calls `unfold(parentUid)`.
  - Same parent: it calls `data.block.reorderBlocks({location: {"parent-uid"}, blocks})` with the full fresh child list, the uid moved next to its neighbour. `reorderBlocks` is present (spec §13, P12).
  - Different parent: it calls `block.move` with `order` set to the neighbour's index in the fresh child list (+1 for `afterUid`). The count includes excluded and hidden children.
  - If `reorderBlocks` is missing: it does a same-parent `block.move`, then verifies the result with a pull and corrects it once. Measure that call's index semantics live.
- `moveTo` never writes a string, and never writes `open` except through the unfold.
- Update the write-shape comment (mmwrites.js:16-18) and its test.
- Alt+Shift+Up and Alt+Shift+Down call `moveTo` with the previous or next drawn block sibling as the neighbour. At either end they write nothing. `e.repeat` is ignored.

**27. The drag highlight ring exists only while a node is being dragged.**
- A pointer-down on a map node adds a passive `pointermove` listener on `doc`, because the drag can leave the container.
  - The listener is throttled to one run per animation frame.
  - It runs `resolveDrop` against positions captured when the drag started.
- The ring is `.plexus-portal.plexus-mm-ring`, with pointer-events none, at `zIndex + 1`.
  - It is positioned with `native.viewportRectOf`.
  - It outlines the target node, or shows a 3 px bar on a reorder band.
- The listener and the ring are removed on pointer-up, `pointercancel`, window blur, Esc, session dispose and unload.
- Nothing listens outside a drag.

**28. MM-2 keys match exactly, and each conflict is named.**
- All keys go in the existing container capture handler (view/mindmap.js:522-560). It runs before Excalidraw's `document` keydown (App.tsx:2584) and before Roam's bubble-phase handlers.
- Alt+Shift+ArrowUp/Down (`altKey && shiftKey && !ctrlKey && !metaKey`):
  - Swallow the event, then reorder (amendment 26).
  - Swallowing is required: Excalidraw's Alt branch runs the flowchart navigator and changes the selection (App.tsx:4151-4165).
  - `HOTKEY_CODES` has no arrow codes (hotkeys.js:1-9), so the hotkey guard is unaffected.
- Shift+Tab:
  - Selects the nearest drawn ancestor, skipping carriers.
  - On the root, it swallows the event and does nothing.
  - Check it before the plain-Tab branch (view/mindmap.js:540).
- Ctrl/Cmd+Alt+Arrow:
  - Navigates as Alt+Arrow does, then always centres the target (`scrollX`/`scrollY`, `captureUpdate: "NEVER"`).
  - Today this chord returns early (view/mindmap.js:531) and reaches Excalidraw's flowchart creator. That branch checks `CTRL_OR_CMD && arrow && !shift` and ignores Alt (App.tsx:4106), so stray flowchart nodes get bound to map nodes.
  - Measure live that the operating system does not take Ctrl+Alt+Arrow.
- The existing Cmd/Ctrl+Arrow hint and Cmd+Z interception stay.

**29. Backspace deletes only a placeholder from this session, through the existing safe path.**
- A plain Backspace or Delete on a non-root node qualifies only when all of these hold:
  - The node was created in this session within the last 30 s (`createdAt`, recorded in `newNode`).
  - Its tree string is still `PLACEHOLDER_CHILD`.
  - It has no children.
- For a qualifying key:
  - Swallow it and call `discard(root, uid, PLACEHOLDER_CHILD)` (view/mindmap.js:493-504).
  - `writer.discardPlaceholder` re-checks, inside the queue, that the block was created this session, still holds that string and has no children (mmwrites.js:186-196).
  - `e.repeat` is ignored.
- Every other Backspace is left alone. Excalidraw deletes the element, and P4's restore and hint apply (view/mindmap.js:357).
- This path never calls `deleteBranch`.

**30. Alt+Enter and F2 keep the task prefix in the view.**
- Alt+Enter must be swallowed. With a container selected, Excalidraw starts text editing on Enter whether or not Alt is held (App.tsx:4391-4410). Repeats are ignored, and the key does nothing in view mode.
- The new string replaces only the macro: `{{[[TODO]]}}` ↔ `{{[[DONE]]}}`.
- A node that is not a task gains `{{[[TODO]]}} `, like the first step of Roam's Cmd+Enter. This is still a prefix-only change.
- The write goes through `writeString(root, uid, next, node.string)`: optimistic update, compare-and-set in `updateString`, and the "changed" toast (view/mindmap.js:384-394).
- The writer stays a compare-and-set on the full string. The contract's "the writer puts the prefix back" means the view builds the full string.
- F2:
  - `editSelected` opens the input with `rest`, and refuses only when `hasMarkup(rest)`.
  - The input handle keeps `prefix`.
  - `finishInput` writes `prefix + value`, compared against the full base string.
  - For a task, an empty value writes nothing.
- `nativeTextEdit` uses `editableText` (amendment 19).

**31. The controller exposes map options, and I renders the menus.**
- Add to the object `createMindMap` returns:
  - `mapOptions(app)`, returning `{root, layout, attrEdges}` for the selected node's map, or null;
  - `setLayout(app, layout)`;
  - `setAttrEdges(app, on)`.
- Each setter is one `commit(patchMarker(…), [root])`, with the reconcile in the same `updateScene` (the `cycleLayout` shape, view/mindmap.js:614-622).
- `NEVER` writes cannot be undone, so each setter toasts the new state and "choose again to change back".
- `createMindMap` takes a new parameter: `createMindMap({…, getTagColors})`.
- `startRoot` and `showOutline` pass `rootDefaults: {attrEdges: true}`. Reconcile applies it only when it creates the root element; nothing else sets `attrEdges`.
- When a new map has at least one carrier, toast once: "Attribute blocks show as labelled edges (Plexus menu to turn off)".

### G

**32. The container rule is rewritten; this replaces the sentence "stored in root customData? No".**
- Replacement text: "The container is the first direct child of the drawing block whose trimmed string is exactly `{{[[plexus-outline]]}}`. If none exists, it is created as the last child of the drawing, collapsed, with the deterministic uid `o${fnv1a(drawingUid)}`, so that two tabs collide instead of creating duplicates. This follows the `p…` regions and `c…` cards containers (roam.js:110-126, 372-388); the `m…` prefix is taken by legacy migration (actions.js:3553). Nothing is stored in element `customData` or in drawing props."
- The roadmap's `customData.plexus.outlineUid` stamp is not built.
- All container work runs under `withLock(lockName(graph, drawingUid))`, the same lock regions use (roam.js:129-141). If the lock is not acquired, toast and write nothing.
- G implements this in `actions-outline.js` through the injected `host.pullBlock` and `host.createBlock`. `src/host/roam.js` is not edited.

**33. A re-run inserts first, deletes second, and refuses blocks that are referenced elsewhere.**
- Inside the lock:
  1. Pull the container's current children (`old`).
  2. If any block under `old` is referenced (`:block/_refs`) from outside the container, refuse with "The previous outline is referenced elsewhere; move those blocks out first". The mind-map delete uses the same rule (mmwrites.js:176-179).
  3. Call `fromMarkdown` at `order = old.length`.
  4. Delete each top-level block of `old`.
- If the insert throws:
  - Pull again.
  - Delete only the children that are not in `old`, and keep `old`.
  - Toast.
- If a delete throws, toast "The previous outline could not be fully removed".
- Gate 5 wording:
  - "A re-run updates in place" means the container keeps its uid and holds only the new outline.
  - "Under the chosen parent" means the container, because P12 has no parent picker.

**34. The elements that become outline items are listed.**
- Mind-map projections (ids starting `pmm-`) are skipped. Each map adds one item, `((rootUid))`.
- Bound text is never an item on its own. Its container is the item, using the text's `originalText`.
- Arrow labels are ignored.
- These elements become items:
  - free text;
  - shapes with bound text;
  - embed anchors (`customData.plexus.embed`), as the ref only; `plexus:today` becomes `[[<dateToPageTitle(today)>]]`;
  - images with `customData.firebaseUrl`, as `![](url)` (P11 EXP-5).
- Links:
  - An element `link` that `parseEmbedRef` accepts is appended (`text ((uid))`) unless the text already contains it.
  - Other links are appended as they are.
- Shapes without text are skipped.
- A frame heading is `frame.name`, or `Frame <n>` by `orderFrames` position when the frame has no name (slides.js:10-22).
- An element whose `frameId` names a frame that no longer exists counts as outside any frame.
- Selection mode works only with the editor open:
  - It uses the selected elements.
  - A bound text maps to its container.
  - A selected frame brings its children.
- With no editor open, `drawingToOutline(drawingUid)` reads the persisted elements through `host.drawing(uid).elements` (scene.js:21-34).
- Size limits:
  - More than 500 blocks: refuse with a toast.
  - More than 50 blocks: show the preview first.

**35. Ordering and nesting are deterministic.**
- Reading order sorts by top y. Items whose vertical centres lie within half the smaller height of each other share a row and sort by x.
- Each bucket runs Kahn's algorithm (a topological sort) over arrows whose two bound ends are items in that bucket. The buckets are each frame, then everything outside frames.
  - Among items with no remaining incoming edges, take the first in reading order.
  - If none are left (a cycle), take the first remaining item in reading order and drop its remaining incoming edges.
- Nesting uses only the kept edges:
  - An item with exactly one kept incoming edge becomes the child of that edge's source.
  - Children keep the topological order.
  - Arrows between buckets are ignored.
- The signature is `elementsToOutline(elements, {selection, today})`, returning `{nodes: [{string, heading, children}], count}`.
- The contract's `{frames}` argument is dropped, because frames come from `elements`.

**36. Markdown, `fromMarkdown` and the clipboard have written rules and a measured fallback.**
- `outlineToMarkdown` writes `- ` bullets with two spaces per level (the shape measured in spec §13, P12). Frame headings are `- ## Name`.
- Measure live one corpus through `fromMarkdown`, reading back `:block/string` and `:block/heading`. The corpus contains:
  - `## Name`;
  - lines starting `# `, `- `, `1. ` and `> `, and a code fence;
  - `**b**`, `Attr:: v` and `[[a]] ((uid))`;
  - a two-line string written as an indented continuation.
- Fallbacks:
  - If headings do not stick, call `block.update({block: {uid, heading: 2}})` on the top-level uids returned.
  - If any other string does not round-trip, write the whole tree with sequential `block.create` calls, under the same lock and into the same container.
  - Multi-line items stay multi-line only if the continuation test passes. Otherwise their lines are joined with spaces.
- "Copy as Roam markdown" builds the markdown synchronously. It writes through `native.withClipboard(() => clipboard.writeText(md))` inside the user gesture (the `copyText` shape, actions.js:1523-1541), so it waits its turn behind crop capture.
- Dependencies: `createOutlineActions({host, native, api, toaster, clipboard, withLockFn, openPreview, doc, getApp})`.
- The preview is G's new `src/view/outline-preview.js`:
  - `openOutlinePreview({doc, zIndex, headings, count, replacing, onWrite, onClose})`;
  - with its test and the CSS snippet `/tmp/wo/p12-css-outline.css`;
  - keys isolated as in amendment 8.

### I

**37. Wiring, order and cleanup.**
- Create the snapshot store before extension.js:491, unless the graph is encrypted (amendment 4).
- In `onEditorMount`, when `mountUid` is set, create the scheduler and push its dispose into `mounted.disposers`.
- Wire:
  - `beforeBulk` into the scene registry and public API;
  - the builder's `measure`;
  - `createMindMap({…, getTagColors: () => getSettings().mmTagColors})`.
- Command-list rows:
  - "Restore an earlier version…" needs the editor open; otherwise it toasts "Open a drawing full-screen first".
  - "Cause-and-effect from JSON…".
  - "Drawing to outline…" needs the editor open or a focused drawing block.
  - "Copy as Roam markdown".
  - "Mind map layout: Right / Cause / Fishbone".
  - "Mind map: attribute blocks as edges".
  - Keep "Restore before last Plexus change" (extension.js:725).
- Canvas menu (context-menus.js:452-477):
  - The layout and attribute items are enabled only when `mindmap.mapOptions(app)` is not null, and their labels show the current state.
  - Add restore, chart and outline items as well.
- Add no `commandPalette` entries. Each entry costs +0.055 ms per keystroke (spec §13, P9).
- On unload and on editor unmount, close the restore dialog, the chart dialog, the outline preview and the drag ring.
- Merge the S, M2, B and G CSS snippets into `extension.css`.
- I may edit these tests, for the new wiring only: `test/extension.test.js`, `test/view-context-menus.test.js`, `test/settings.test.js`, `test/view-settings-dialog.test.js` and `test/actions*.test.js`.

### Gate

**38. The encrypted-graph and unload checks test only what the code can actually show.**
- A restore writes the scene, so the svy check cannot be read-only and also exercise restore.
- With the owner's re-approval, use a drawing that has already been opened once since migration (the Phase 7 gate 11 re-save). Open and close it without edits, then check that:
  - `:edit/time` is unchanged;
  - `indexedDB.databases()` either has no `plexus-snapshots` or it has no row with graph `svy`;
  - the dialog shows "Not kept on encrypted graphs".
- A unit test with `isEncrypted: true` covers restore on an encrypted graph.
- "No open IndexedDB connection after unload" is checked two ways:
  - A unit test shows that dispose closes the connection after in-progress puts.
  - Live: unload and reload the extension three times; a snapshot then still lands and is listed, so no upgrade got stuck.

**39. The gate 4 thresholds and the list of live measurements are fixed.**
- "No duplicate": after a drag-reparent on a 200-node map and its echo, the projection count is `3 × visible − 1` plus the labels, and a second reconcile gives zero ops.
- "Holds the P4 budget":
  - Reconcile stays under 16 ms live (the P4 gate).
  - Record the visible frame against the 35-40 ms baseline (roadmap-next.md:974). It must be no more than 10 % above that baseline.
- Record these measurements in spec §13, each with the fallback its amendment names:
  - the `fromMarkdown` corpus (amendment 36);
  - `block.move` order within the same parent, and `reorderBlocks` (26);
  - whether `☐ ☑ ★` render (19);
  - whether images are refetched after a restore (6);
  - a Cmd-drag release versus text-links (23);
  - whether the operating system captures Ctrl+Alt+Arrow (28);
  - how Excalidraw handles the first edit of a builder text with `fontFamily ≠ 5` (12).
- Gate 2 runs on two maps:
  - one created by 0.12.0, where `attrEdges` defaults to on;
  - one from the 0.4.0 era, with the toggle off and then on.
- Gate 3 compares `:block/string`, `:block/order` and `:edit/time` of every `BT_attr*` child before and after two Alt+Enter presses.
