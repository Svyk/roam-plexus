# Plexus Phase 15: Graph data on the canvas (binding)

Plexus 0.14.0 (`0c2b348`) becomes 0.15.0. apiVersion stays 6. Scope is roadmap-next P15: REF-8, NAV-9, REV-2, GRAPH-7, GRAPH-1.

GRAPH-12 is cut. On 2026-09-30 Readwisenotes had no result corpus. Counts were zero for `Last result::`, `Zone::`, `Result::`, `Site::`, and `CFU::`. The pages EMP Dataset, EMP, EMP Sampling Plan, and environmental monitoring have no blocks. swab, CFU, and EMP text sits in research notes and paper highlights. Do not seed results. Do not read the Svy graph. Do not add a heat-overlay command.

P14 rules still bind. Exactly two palette entries. No `BT_attr*` writes. New commands are command-list rows.

## Decisions

1. **REF-8.** A region ref with children shows `sup.plexus-count`. Hover lists at most 5 children. A `Name:: value` child also renders as `span.plexus-attr`. Read only. Crop geometry is unchanged.
2. **NAV-9.** `showFocusVeil` dims everything except the selection and arrow neighbours at depth 1, 2, 3, or all. Hops use `boundElements`, `startBinding`, and `endBinding`. Escape removes it. No `updateScene`. `pointer-events: none`. `showSpotlight` stays a 1.4 s pulse.
3. **REV-2.** `showTodoVeil` keeps open `{{[[TODO]]}}` elements lit. Done items fade. A cancelled-status task still counts as open. `BT_attrDue` is read only, never written.
4. **GRAPH-7.** `cardsFromQuery` returns at most 50 new element specs. A re-run skips uids already on the canvas. No block writes. Each element sets `customData.plexus.query` to the source uid. Page children use the same cap and skip rule.
5. **GRAPH-1.** `relationPlan` is one new `Label::` block whose only child is `((dest))`. An existing ref makes an empty plan. Writes use the guarded block create, then an undo toast. Never `window.confirm`. Never rewrite a string. Never touch `BT_attr*`.
6. **Commands.** Insert these immediately before "Show in Compass": Focus mode, Todo mode, Embed query results, Embed page children, Link selected, Filter regions by tag. The palette stays two entries.
7. **Filter.** Dim region outlines that lack the chosen tag. No writes. Escape clears the filter.

## Units

| Unit | Owns |
|---|---|
| R | `src/view/regionref.js`, `src/extension.css` chip rules, `src/view/crop-popover.js`, `src/view/regions-layer.js`, `test/view-regionref-p15.test.js` |
| V | `src/view/spotlight.js`, `test/view-spotlight.test.js`. Inline veil styles only |
| Q | `src/query-cards.js`, `test/query-cards.test.js` |
| L | `src/relations.js`, `test/relations.test.js` |
| I | `src/extension.js`, `test/extension.test.js`, `package.json` 0.15.0, `CHANGELOG.md`. Wires the commands. Does not edit the files above |

Amendments below override the decisions above. Parallel units are R, V, Q, L, then I.

## Live gate

Readwisenotes only. A region with child notes shows a plain count, and hover shows at most 5. Focus mode lights the selection and its arrow neighbours; Escape exits. Todo mode keeps open TODOs lit, including a cancelled-status task. Embed query results places at most 50 cards, and a re-run adds only missing uids. Link selected writes one `Label::` plus a ref child, is idempotent, shows an undo toast, and does not touch `BT_attr*`. Typing stays at or under +0.17 ms/key. GRAPH-12 is not built.

## Amendments

8. **Focus veil.** `showFocusVeil` does not call `showSpotlight` and does not reuse its wheel, pointerdown, or any-key listeners. Draw one hole per kept id. Hops are arrows only: `boundElements` of type `arrow`, plus `startBinding` and `endBinding`. Bound text of a kept id stays lit and is not a hop. Move holes with `viewportRectOf` on `subscribeViewport`. `pointer-events: none`. Escape removes the veil. Focus mode cycles depth 1, 2, 3, all, then off. Do not edit `settings.js`.

9. **Todo veil.** The same hole overlay. An element stays lit only when its string contains `{{[[TODO]]}}`, including a following `#[[task-status/Cancelled]]` or `#task-status/Cancelled`. `{{[[DONE]]}}` stays dim. `BT_attrDue` is not a visibility input and is not a chip. Due-date chips are cut. No `updateScene`.

10. **Region notes.** Children are `pullBlock(regionUid).children` (`uid`, `string`, `order` only). The crop popover returns early when `entry.url` is missing, and image mode never calls `hoverOn`. Paint at most five direct child strings on hover, including image mode, and still paint when the only payload is those strings. A `Name:: value` child whose name does not start with `BT_attr` is a sibling `span.plexus-attr`. Crop geometry is unchanged.

11. **Tag filter.** `createRegionsLayer` gains `setTagFilter`. Dim `.plexus-region-outline` when the region string and its direct child strings lack `#Tag` and `[[Tag]]`. Escape clears the dim. No scene write. The listener exists only while a filter is set.

12. **Query cards.** `cardsFromQuery` calls `api.data.roamQuery({ uid, limit: 50 })` and reads each `:block/uid`. Query-block children are not the results. Return `makeEmbedAnchor` specs with `customData.plexus.embed` set to the result ref and `customData.plexus.query` set to the source uid. Skip uids already on the canvas. The cap is 50 cards for that source, not 50 new each run. Page children come from `pullBlock(pageUid).children` and use the same cap. The command commits with `guardedWrite` and writes no blocks.

13. **Link selected.** `relationPlan` does not call `guardedWrite` or `data.undo`. Source is the arrow start, else the first selected embed, `element.link`, or mind-map uid. Dest is the arrow end or the second selection. An existing `((dest))` in the source string, a direct child string, or a child of a bare `relates to::` block makes an empty plan. Under `withLock(lockName(graph, sourceUid))`, `createBlock` writes `relates to::` and then `((dest))`. The toast deletes those new uids. Presets, arrow restyle, and delete-on-arrow-delete are cut. Never `window.confirm`. Never `BT_attr*`.

14. **Names.** V exports `focusKeptIds`, `todoKeptIds`, `showFocusVeil`, and `showTodoVeil`. Q exports `cardsFromQuery` and `cardsFromChildren`. L exports `relationPlan`. R exports `regionMeta` and `regionMatchesTag`. The layer return gains `setTagFilter`. I imports those names. `apiVersion` stays 6.
