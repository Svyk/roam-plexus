# Plexus roadmap: P7 onward

Forward plan after P6. Companion to [`roadmap.md`](roadmap.md) (phase ledger and loop) and [`spec-plexus.md`](spec-plexus.md). Written 2026-09-29 against `main` at `95c2f6d` (0.6.1). Line numbers cite that commit unless marked otherwise.

## 1. Summary

Plexus extends Roam's native `{{[[excalidraw]]}}` (Excalidraw 0.18, reached through the React fiber) and never replaces the canvas. P0-P6 are done and 0.6.1 is current: region refs as real Roam blocks under `{{[[plexus-regions]]}}` (area, rect, group, frame, cframe, poly, imgrect, imgpoly), crop cache, click-to-zoom and spotlight, region-ref cards, the `[[` / `((` picker in canvas text, right-click menus, element links with hover preview, read-only and editable block embeds, frames as slides, mind maps with two-way outline sync, legacy migration, `window.RoamPlexus` v2, Roam Compass integration, and (0.6.1) captions that ref their source blocks plus canvas backlink counts.

This plan places 166 candidate features from six research passes, scored by two judges: Fable (weighted, product fit) and Opus (feasibility). 64 land in nine phases (P7-P15), 8 sit in a pull-forward pool (P16), 59 wait in Later, 17 are parked and 18 rejected. Nothing from P7 onward has shipped; every phase below is future work. P7 makes regions quiet (captions only when real, labels derived, alias refs, fresh crops, copy crop as PNG) and probes Roam's Excalidraw build once. P8 makes regions visible, crops crisp and write paths safe. P9-P10 bring Roam onto the canvas without the clipboard and keep the outline visible while drawing. P11 gets work out (PDF pages, outline-driven decks, embed text on slides). P12-P13 turn outlines into cause maps, process flows and templates. P14 wires Compass; P15 reads graph data back onto the canvas. The main use case throughout is QA work: HACCP process flows, swab-site maps, CAPA photo markup and SOP training decks.

## 2. Decision: region captions

**Question.** Every region block carries caption text: auto text from the region, or else a generic fallback ("Region", "Image region", "Image crop", "Frame"). Is that text necessary, or is it cleaner to just block-ref the image?

**Answer (both judges, all six sources).** Caption text is not necessary, and the generic fallbacks stop now. The crop is the content: a bare `((regionUid))` should render the crop alone, the way an image block renders an image. For a whole image or a whole drawing, just block-ref it; Plexus creates no region at all (REF-2). A region block is only needed for a *part*, because the crop geometry lives in its string.

The tail is still kept when it carries information, because in Roam it does three jobs the crop cannot (Fable): it is the readable bullet when the collapsed `{{[[plexus-regions]]}}` list is expanded, it is what the `((` picker and Roam search show, and it is where `[[Page]]` / `((uid))` refs live so the region appears in Linked References (0.6.1 already writes source refs there).

*Image regions need text least (added in review).* An `imgrect` / `imgpoly` region is a child of an image block whose `![alt](url)` alt text is already a human-written label, and Roam's Linked References breadcrumb already shows that parent block. So for image kinds the derived label uses the parent image's alt text (read at render time, never copied into the tail), and an empty tail costs less than it does for area regions. For drawing kinds, the derived label's drawing name is the drawing page title, else the first text of the drawing block's `Text elements in drawing:` tail, the same source Compass uses (`~/roam-compass/src/model/text.js:204-206`).

| Case | Stored tail | What a bare `((uid))` shows |
|---|---|---|
| Region with text or source refs | Short auto text or the 0.6.1 refs | Crop, plus caption per the display setting |
| Frame or cframe region | Frame name | Crop, plus caption per the display setting |
| Nothing real to say | Empty (string ends at `}}`) | Crop alone |
| Whole image or whole drawing | No region block | `((imageBlockUid))` / `((drawingUid))` |
| One reference needs its own wording | Nothing stored | Roam alias `[Site 12 drain](((uid)))` (REF-3) |

**Exact changes (all in P7):**

1. `src/actions.js`, 10 fallback sites: 312, 315, 318, 386, 422, 426, 458, 547, 551, 677. Area, group and frame sites become `captionRefsFromElements(...) || frame?.name || ""`; the image sites (422, 426, 458, 547, 551) become `""`. `serializeRegion` already omits an empty tail (`src/model/region.js:198-199`).
2. New pure module `src/model/label.js`: `regionLabel({kind, caption, drawingTitle, imageAlt})` returns, for example, "Sanitation map · frame" (image kinds prefer `imageAlt`). It feeds link-mode text (after the glyph), `root.title`, `aria-label`, `img alt` (UX-4) and a new `label` field on `RoamPlexus.regionsOf()` entries. Never stored. `regionsOf()` today returns `[{uid, kind, caption}]` (spec §8, `src/api.js:255-256`); `label` is additive and moves `apiVersion` from 2 to 3 (section 3, API versioning). Compass cannot import the module: `drawingTitle` (`~/roam-compass/src/model/text.js:200-206`) is a pure string function with no Plexus dependency. At node-build time Compass feature-detects `window.RoamPlexus.regionsOf`, resolves the region's owner block (the parent of its `{{[[plexus-regions]]}}` container), and uses the matching entry's `label`; with Plexus unloaded or no `label` field on the entry it keeps "Region". That is a small Compass change plus a Compass release in P7, not a one-line edit.
3. Auto-caption quality (REF-15): visual order, container labels first, no numbers or arrows, 60 characters, 0.6.1 source refs first.
4. Setting "Caption under crops": *when written* (default: show the stored tail if any) / *always* (stored tail, else the derived label) / *never*. Implemented as one class on `span.rm-block-ref.plexus-ref-card` (font-size 0, restored on `.plexus-root`), no DOM surgery. Per-ref "Plexus: Hide caption / Show caption" in the block-ref menu. `refOverrides` becomes an object (`{mode, caption}`) now, so REF-5 can extend it later (Opus). This needs a read-side migration: the persisted `ref-overrides` setting (`src/settings.js:9, 22, 84, 106-107`) is a JSON map of mode strings (`image` / `thumbnail` / `link`) written by 0.6.0's per-ref "Show as link / Use default display", and today's `parseOverrides` (`src/model/refdisplay.js:19-31`) keeps only string values. The new parser accepts both shapes, maps a string such as `"link"` to `{mode: "link"}`, keeps caption-only entries (`{caption: "hide"}` with no mode), and the next write stores the object form. Known cost: rolling back to 0.6.x after an object write drops those overrides, because the old parser discards objects.
5. Setting "Caption mode": *auto* (default) / *ask* / *none*. *ask* opens the REF-17 one-line prompt, pre-filled with the auto text, with the `[[` picker attached; Esc writes an empty tail.
6. Whole-image or whole-drawing pick: no block, copy the block's own ref, toast (REF-2). Holding Alt when the pick finishes forces a region anyway, so a whole-image region with click-to-zoom and spotlight can still be made.
7. Alias refs `[label](((uid)))` get the crop hover and click-to-open when the target is a region (REF-3).
8. Command "Plexus: Clear placeholder captions": dry run first; exact matches of the four strings only; string-only `data.block.update` under the drawing Web Lock, props untouched; on a production graph, apply only with the owner's explicit approval at that moment. Roam undo is not guaranteed for API string rewrites, so the report is the before/after string of every changed block (copyable), and "Plexus: Undo caption cleanup" restores those strings from memory for the rest of the session (added in review).
9. Block menu "Plexus: Name region" on any region block reuses the REF-17 prompt and `[[` picker to set or replace the tail after creation (added in review). It is the Plexus-native fix for the accepted cost below.

**Not doing:**

- *Caption moved to the region's first child* (whiteboard, landscape): doubles the block count, changes Linked References breadcrumbs, moves the words one level away from the thing they describe, and needs `relinkCaption` / `captionRefsInfo` rework plus an order-stable fingerprint (M). Available later as an opt-in "Move caption to child" if asked.
- *Muted DOM hint in the home context* ("area · 3 elements"): deferred. Opus: the crop is the hint. Revisit if the expanded regions list proves hard to scan.

**Accepted cost.** An empty-tail region reads as the raw `{{[[plexus-region]]: ...}}` macro in Roam's `((` picker, in search, in unlinked refs, and whenever Plexus is not loaded. Real text, frame names and alias refs cover the cases where that matters, and "Plexus: Name region" (change 9) adds a tail after the fact without hand-editing the macro.

## 3. Principles and licensing

### Licensing

| Source | License | What Plexus may take |
|---|---|---|
| thymer-whiteboard (Parham Shafti) | MIT, (c) 2026 | Code, with the copyright and permission notice kept in the file header. Useful pure pieces: `fitSticky`, `wbContrastText` / `wbHexHsl`, mind-map layouts and `mmDropReorder`, `wbMergeScene` (has tests), the IndexedDB backup ring, `wbWayPath` / `wbEdgePath`, the pinch handler. |
| Excalidraw (upstream) | MIT | APIs and behavior. Roam bundles 0.18.x (patch version unmeasured; spec and phase contracts say only "0.18"); the research checkout is a fork at 0.18.105, so the DATA-5 probe (P7) records Roam's version and which actions exist before anything relies on them. |
| ExcaliBrain | MIT (not AGPL) | Legal to reuse, but the code is bound to Obsidian and ExcalidrawAutomate, so in practice behavior only. |
| RoamJS query-builder | MIT | If ever needed. |
| Plexus Canvas (the owner's Thymer plugin) | Owner's code, no LICENSE file | Borrowable after stripping Thymer SDK calls (for example `pxcGraphLayout`, `pxcMiniFit`, `pxcParseNaturalDate`, the cause-effect functions, the mind-map paste parser). |
| Roam Compass, Plexus Diagram | MIT, owner's | Direct reuse. |
| Obsidian Excalidraw plugin | AGPL-3.0 (LICENSE since 2026-05-13, `8df4364b`; `package.json` still says MIT, the LICENSE governs) | Behavior only. |
| K-Plex | AGPL-3.0 | Behavior only. Compass is a clean-room rewrite and must not import K-Plex text or code. |
| Logseq (AGPL-3.0), Advanced Canvas (GPL-3.0), Kinopio client (PolyForm Noncommercial 1.0.0), tldraw (custom, not OSI) | Copyleft or restrictive | Behavior only. |
| Discourse Graph | Apache-2.0 | Behavior (code borrowable with notice; not needed). |
| Heptabase, Muse/Allume, Scrintal, FigJam, Miro, Napkin, Excalidraw+ | Proprietary | Behavior only. |

Rule for AGPL and GPL sources: implementers work from the behavior descriptions in this document and do not open the source while writing Plexus code.

### Roam rules (every phase)

1. **Extend, never replace.** Plexus reaches the Excalidraw App through the React fiber and uses no fork-only API. Before building anything Excalidraw 0.18.x may already ship (flowchart keys, search menu, Copy as PNG/SVG, laser, `wrapSelectionInFrame`), check the DATA-5 native-feature probe (P7), which covers all of them in one session.
2. **Roam data is canonical.** Blocks, `Name::` attributes and refs. No shadow database (spec rule 10). Attribute relations follow the harc convention: a bare `Name::` block with ref children. No typed tag classes.
3. **No props writes on drawing blocks** except through Excalidraw. Plexus-owned containers (`{{[[plexus-regions]]}}`, the new `{{[[plexus-cards]]}}`, ...) are created on first use only.
4. **Graph writes only on explicit action**, under the drawing Web Lock and through the echo ledger. Never write Better Tasks `BT_attr*` children. On a daily page, add plain children; never nest inside another extension's container (for example a schedule block).
5. **Speed.** Typing bench +0. No heavy global CSS, no MutationObserver storms, listeners only while a surface is open, pull watches capped (150) because they bill the host. Counts are plain numbers, never pills.
6. **Zero runtime dependencies.** Plain JS, esbuild bundle. The Depot forbids dynamically loaded scripts, so no jsPDF, pdf.js or mermaid bundles.
7. **Encrypted graphs.** Images through `roamAlphaAPI.file.get`; caches and snapshots stay in memory; rendered content is never persisted to IndexedDB. Anything "cache-only" is cold after a reload on an encrypted graph.
8. **View state stays out of the drawing.** Scroll, zoom, theme and export scale must not move `:edit/time`. DATA-5 measures this in P7.
9. **Acceptance.** Live checks in the Readwisenotes test graph over trusted CDP input; production graphs only with the owner's explicit approval. Every release: `npm run check`, unload clean, and the published `extension.js` compared byte-for-byte with the local build. Encrypted graphs are the main production case, but Readwisenotes is the only standing acceptance graph; encrypted behavior is inferred unless a phase gate names an owner-approved, read-only encrypted-graph check (P7 does).
10. **API versioning.** `apiVersion` is 2 today (`src/api.js:4`; spec §8 still says 1 and is corrected in P7). Changes to `window.RoamPlexus` are additive only. Each release that adds a member or a field bumps `apiVersion` by one: P7 makes it 3 (`regionsOf()[].label`); API-1, CMP-2 and CMP-7 each take the next number in the release that ships them. Consumers (Compass, scripts) feature-detect the member or field (`typeof RoamPlexus.linksOf === "function"`, `"label" in entry`) and keep a fallback; the number is for diagnostics, not gating. Spec §8 records each bump.

## 4. Quick wins

Shortlist of small, high-leverage items. Each row's full entry lives in its home phase; the ID index (section 9) lists one home per item.

| ID | Quick win | Why it is quick | Home |
|---|---|---|---|
| REF-1 | Stop writing placeholder captions; derive labels at render time | 10 call sites; the serializer already omits an empty tail | P7 |
| REF-2 | Whole image or drawing: copy its own ref, create no region | One coverage check | P7 |
| REF-6 | Refresh on-screen crops when the editor closes | `refreshCropsForDrawing` exists; only the trigger is missing | P7 |
| REF-17 | Pin-drop region with an inline caption prompt | Reuses the mind-map input and the picker | P7 |
| REF-15 | Auto-caption quality | One pure function | P7 |
| REF-3 | Alias `[label](((uid)))` as a region ref (Opus shortlist) | Claim one more anchor type | P7 |
| EXP-1 | Copy region crop as PNG for Word, Excel, Slack | The cache already holds the blobs | P7 |
| DATA-5 | Measure whether view changes dirty `:edit/time`; probe Roam's Excalidraw build for native features | One CDP session; gates REF-7, NAV-3, UX-5, PRES-5 and every "may be native" item | P7 |
| CMP-1 | Compass opens drawing and region nodes through `RoamPlexus.open` | One branch in Compass | P8 |
| DATA-2 | Shrink guard on Plexus-initiated scene writes, with an in-memory pre-write snapshot | Count before and after; keep the old elements in memory | P8 |
| DATA-3 | Flush the outline write queue on `pagehide` | One listener pair | P8 |
| REG-2 | Regions for all frames, in slide order, idempotent | Loop over `orderFrames` | P8 |
| NAV-4 | Back to the previous view after a programmatic zoom | In-memory stack | P8 |
| AUTH-11 | New drawing here / below / on page / on today, `/Sketch here` | `RoamPlexus.create` exists; no create command today | P9 |
| AUTH-1 | Embed picker instead of clipboard-only embeds | Suggest infra measured at 11 ms pages, 136 ms blocks | P9 |
| EMB-3 | Live `{{query}}` node | `renderString` already renders any string (liveness spike first) | Later (spike failed 2026-09-29) |
| UX-1 | Default hotkeys and kbd hints | `default-hotkey` is supported and unused | P9 |
| PRES-2 | Present from the selected frame | Index math | P11 |
| PRES-6 | Laser and temporary pen in the presenter (Opus shortlist) | Dialog-local overlay, nothing persisted | P11 |

## 5. Phases

Backbone: the Fable judge's phasing. Where the Opus judge disagreed or flagged a risk, the entry says so and the plan moves, splits or annotates the item.

**How to read an entry.** Header line: effort (S/M/L/XL), value, dependencies, then each judge's verdict with value/Roam-fit scores (1-5). *Sources* use the tags in section 8. *Accept* is the item's own check; the phase gate adds the live checks.

**Standing gate (every phase, not repeated below):** Readwisenotes over trusted CDP; typing bench +0; unload leaves no nodes, listeners or watches; `npm run check`; published `extension.js` matches the local build (`cmp`); no production-graph writes without the owner's approval at that moment; view operations leave `:edit/time` unchanged (per DATA-5). A phase that changes Compass also builds, publishes and `cmp`s Compass, as the roadmap.md P2 precedent did ("both repos green and published"). Release paperwork (README, CHANGELOG, Depot listing, the KB session learning and the roadmap.md phase row) follows the loop in [`roadmap.md`](roadmap.md) steps 8-9, so there is one release checklist, not two.

### P7: Quiet regions — done 2026-09-29, v0.7.0 (`8bb54f2`)

**Goal.** Captions are honest (real text or nothing, never a placeholder), labels derive at render time, alias refs carry per-reference wording, whole images need no region, crops refresh when the editor closes, pins drop with an inline caption, and crops copy out as PNG. Plexus plus a small Compass release (Compass reads the derived label through `RoamPlexus.regionsOf()` when present and keeps "Region" otherwise; section 2, change 2).

**Judges.** Fable's P7 plus EXP-1, moved up from Fable's P11 because both judges scored it "now". Crisp 2x crops follow in P8 with REF-7.

#### DATA-5 Measure Roam's Excalidraw build: view-state writes and native features
S · value low (gate for others) · depends: none · Fable now 3/5 · Opus now 2/5
- **Gets:** a recorded answer to whether panning, Plexus zoom-to-region, spotlight, the presenter, theme sync, export scale or `frameRendering` change `:block/props` or `:edit/time`. Plus (added in review) one native-feature table for Roam's build, so later items stop carrying "may be missing in Roam's build" risks.
- **Sources:** whiteboard, fable. Thymer Whiteboard once uploaded 2,412 scene files (51 MB) from panning (plugin.js:916-919, 1196-1197). The roadmap already checks edit-time invariance for P3. Already measured, so the probe only confirms: Roam's canvas menu has Copy as PNG/SVG, grid, snap, zen and view mode (`phase6-contract.md:59`); the Cmd/Ctrl+Arrow flowchart creator and the Alt+Arrow flowchart navigator are live in Roam's build (`phase4-contract.md:230-232`); `copyAsSvg` with a selected frame clips to it (`phase2-contract.md:8`).
- **Design:** one CDP session in Readwisenotes. Part 1: one row per view operation in spec §13. Part 2 (added in review): read Roam's Excalidraw version from the App (patch level is unmeasured today) and record present/absent for `scrollToContent` with `animate`, `wrapSelectionInFrame`, `actions.searchMenu` / `searchMatches`, the laser tool, `copyAsPng` / `copyAsSvg`, flowchart keys, `frameRendering` persistence through Roam's save, and the UX-12 action names (stats, element lock, shape switch).
- **Accept:** spec §13 lists before/after `:edit/time` for each operation, Roam's Excalidraw version, and one present/absent row per probed feature.
- **Risks:** none. Opus: crop hashes cover `elements-json` only (`host/roam.js:64`), so view writes would not invalidate crops, but they would churn `:edit/time` and sync traffic.
- **Unblocks:** REF-7, NAV-3, NAV-4, NAV-8, UX-5, PRES-5; the native-feature table unblocks AUTH-7, AUTH-8 ("Make slide"), NAV-5, EXP-2, PRES-3, PRES-6, UX-1 (native keys list) and UX-12.

#### REF-1 Caption-optional regions
S · value high · depends: none · Fable now 5/5 · Opus now 5/5
- **Gets:** region blocks store text only when it is real; `((uid))` without text renders the crop alone; every label is derived at render time.
- **Sources:** whiteboard, obsidian, canvas, brain, landscape, fable. Fallbacks at `src/actions.js` 312-677 (section 2). `region.js:49` parses without a tail; `regionref.js:310` uses the caption only for `root.title`. `phase6-contract.md:11-14`: the wrapped caption read as messy. Thymer Whiteboard has no caption concept (0 hits); it stores image file names (1786) and never shows them (1334-1339). Plexus Canvas added a caption line in v1.73 and removed it in v1.74 as redundant (BUILD-STATUS.md:2093-2120). Obsidian `#^area=` refs carry no label (README.md:270-289). Muse and Heptabase crops have no text. Compass `text.js:204` falls back to "Region".
- **Design:** section 2, changes 1, 2, 4, 5, 8 and 9, plus the image-alt label source above the table.
- **Accept:** new regions with no text store a string ending at `}}`; image and thumbnail modes paint only the crop; link mode shows the glyph plus "drawing title · kind" (image kinds: the parent image's alt text when it has one); a 0.6.x `ref-overrides` map of mode strings still applies after upgrade (unit test on the string-to-object migration); the cleanup dry run lists exact matches only and writes nothing; after an apply, "Undo caption cleanup" restores every changed string; "Name region" writes a tail with a working `[[` pick.
- **Risks:** empty tails read as the raw macro (accepted; "Name region" is the remedy); `font-size:0` also hides caption links in image and thumbnail modes and must be checked against Roam's `.bp3-popover-target` wrappers; link mode needs the derived label in the same change or it shows a bare glyph; a rollback to 0.6.x drops object-form overrides.

#### REF-15 Auto-caption quality
S · value medium · depends: REF-1 · Fable now 3/4 · Opus now 3/5
- **Gets:** auto captions read in visual order, prefer container and frame labels, skip noise, and stay short.
- **Sources:** fable. `caption.js:11-22` joins all text in scene order with " ; " up to 200 characters.
- **Design:** sort by y then x; bound-container labels first; drop numeric, single-character and arrow tokens; cut at the first sentence or 60 characters; join with " · ". 0.6.1 source refs stay first (Opus). Pure function with round-trip tests; new regions only. Image kinds store no auto text: their derived label reads the parent image's alt text at render time (section 2, added in review).
- **Accept:** unit tests for ordering and truncation; a region over three labelled boxes gets their labels left to right.
- **Risks:** changed defaults only.

#### REF-2 Whole image or drawing: use the block's own ref
S · value medium · depends: none · Fable now 4/5 · Opus now 3/5
- **Gets:** a pick that covers the whole image or drawing creates no region; Plexus copies `((imageBlockUid))` or `((drawingUid))` and says so.
- **Sources:** brain, whiteboard, obsidian, canvas, landscape. `spec-plexus.md:64-70` (geometry lives in the region string), :207 (S3). `createPlainImageRegion` (`actions.js` ~520-560). All five sources note that a whole-image ref already renders natively.
- **Design:** in "Region on image" and "Image region", if the rect or polygon bbox is at least 0.98 of the image, skip creation, copy the image block ref and toast "Whole image: use the image block reference (hold Alt to make a region anyway)". An area bbox within a few pixels of the scene bounds offers `((drawingUid))`. Override (added in review): Alt held when the pick finishes creates the region as today, so a whole-image region with click-to-zoom and spotlight stays possible.
- **Accept:** a 98% pick creates no block and the clipboard holds `((imageUid))`; the same pick with Alt held creates one region.
- **Risks:** whole-image refs lose click-to-zoom and spotlight (the Alt override keeps the old path); the threshold needs tuning after a crop-then-rect flow.

#### REF-17 Pin-drop annotation with inline caption prompt
S · value high · depends: REF-1 · Fable now 5/5 · Opus now 4/5
- **Gets:** click a spot on a photo or floor plan to drop a fixed-size region and type its caption straight away (swab points, CAPA photo callouts). Enter writes; Esc leaves the caption empty.
- **Sources:** fable, canvas. The image-region tool is drag-only and writes a placeholder (`image-region-tool.js`; `actions.js:422-458`). The mind-map input with the picker exists (`input.plexus-mm-input`). Plexus Canvas prompts for a label at cite time (plugin.js:11241).
- **Design:** a click with less than 4 px movement makes a rect centred on the point (default 8% of the image). Open `plexus-mm-input` over it with `installSuggestAutoAttach`; Enter calls `finishCreate` with the text. The same prompt serves REF-1 *ask* mode and the "Plexus: Name region" block-menu item (section 2, change 9). Added in review for the swab-site use case, where sites are numbered: a "Pin size" setting (4 / 8 / 12%) and a "Number pins" setting that pre-fills the prompt with the next number (highest numeric caption among that image's regions, plus one). This pulls the useful part of AUTH-6's number stamps forward; AUTH-6's canvas stamps stay in Later.
- **Accept:** click, type with a `[[` pick, Enter: the caption holds a working ref; Esc writes an empty tail; with "Number pins" on, three pins on one photo pre-fill 1, 2 and 3.
- **Risks:** focus leaves the canvas; reuse the mind-map input's blur and commit rules; a pre-filled number the user deletes must leave an empty tail, not a stale number.

#### REF-3 Alias refs as region refs
S · value high · depends: REF-1 · Fable now 4/5 · Opus now 4/5
- **Gets:** per-reference wording through Roam's own alias syntax, `[Site 12 drain](((uid)))`: hover shows the crop, click opens the region zoomed. The region itself needs no caption.
- **Sources:** fable. `discover.js:19-22` and `region.js:3` claim only `.rm-xparser-default-plexus-region`; alias anchors are never claimed. `crop-popover.js` and `regionref.js:344-358` (link-mode hover) are reusable.
- **Design:** extend `classifyAddedNode` to Roam's block-alias element (measure the selector live; likely `a.rm-alias.rm-alias-block` carrying the uid). If the target parses as a supported region, attach `hoverOn` plus a capture click that calls `onOpen(uid, {sidebar})`; leave Shift to Roam. Block menu item "Plexus: Copy alias".
- **Accept:** an alias to a region hovers the crop and opens zoomed; aliases to other blocks behave natively.
- **Risks:** alias DOM is unmeasured; `preventDefault` only for verified region uids; Roam may show its own alias hover, which would compete with the crop hover (Opus).
- **Judges:** Opus corrected the syntax. The merged item wrote `[label]((uid))`; Roam's block alias is `[label](((uid)))` with three parentheses.

#### REF-6 Crop refresh when the editor closes
S · value high · depends: none · Fable now 5/5 · Opus now 4/5
- **Gets:** after editing a drawing, its on-screen crops re-render without the manual "Refresh crops" command.
- **Sources:** fable. `unmountEditor` only emits change and warms thumbnails (`extension.js:215-234`); refresh is manual (`refreshCropsForDrawing`); cache keys include the drawing hash (`regionref.js:235-241`) but nothing re-claims.
- **Design:** on unmount, poll `host.drawing(uid).hash` for up to 3 s, then call `refreshCropsForDrawing(uid)` for connected roots of that drawing only (cold render ~57 ms). Optionally capture hot SVGs just before close, best effort.
- **Accept:** edit, close: on-screen crops of that drawing repaint within 3 s.
- **Risks:** hot capture races Excalidraw's unmount (cold fallback); on encrypted graphs every refresh is a cold render because the cache is memory-only.

#### UX-4 Accessible region refs
S · value low · depends: REF-1 · Fable now 2/4 · Opus now 2/5
- **Gets:** region refs announce a label and open from the keyboard.
- **Sources:** brain, fable, landscape. `regionref.js:310` sets only `title`; :330 is click-only; the `img` has no `alt` (:206-224). K-Plex aria labels.
- **Design:** `role=img`, `aria-label` and `img alt` from `regionLabel`, `tabindex`; Enter or Space opens, Shift+Enter opens the sidebar. Fall back to `tabindex=-1` with roving focus if it steals Roam's editing focus.
- **Accept:** inspected ref shows `alt` and `aria-label` equal to the derived label; Enter opens.
- **Risks:** focus stealing inside block text.

#### EXP-1 Copy or save a region crop as PNG/SVG
S · value high · depends: none · Fable now 5/4 · Opus now 5/5
- **Gets:** ref and region menus gain "Copy crop as PNG" (paste into Word, Excel, Slack), "Copy as SVG", "Download", and "Insert crop as image block" (a real `![](url)` that survives export and print).
- **Sources:** canvas, brain, landscape, fable. No `ClipboardItem` in `src` (grep 2026-09-29); `actions.js` copies only `((uid))` text; `host/cache.js` holds PNG blobs and hot SVG. Plexus Canvas copy-as-PNG (plugin.js:12142, 3948-3985). Muse, Heptabase and Advanced Canvas export crops.
- **Design:** `cache.peek`, else `renderRegionCrop`. Rasterize SVG to a 2x canvas for PNG (`ClipboardItem` rejects SVG); `navigator.clipboard.write` synchronously inside the menu callback. Insert: `file.upload`, then `block.create` a sibling. Light by default; "as shown" keeps the dark invert.
- **Accept:** a crop pastes into a Word document; the cold path pastes at 1x with a toast; insert creates exactly one sibling.
- **Risks:** needs user activation and focus; cold crops stay soft until REF-7; uploads duplicate bytes, so insert is explicit only and careful on encrypted graphs.

**P7 live gate**
1. Area, group, frame, cframe, image, imgrect and pin regions created with no text store a string ending at `}}`. Regions with text get a short caption in visual order, 0.6.1 source refs first.
2. A bare `((uid))` paints only the crop in image and thumbnail modes. Link mode, `title`, `aria-label` and `img alt` show the derived label (parent alt text for image kinds). `RoamPlexus.regionsOf()[].label` is present, `apiVersion` is 3, spec §8 is updated, and Compass shows the label instead of "Region"; with Plexus unloaded Compass still shows "Region".
3. A pick covering at least 98% of an image creates no block and copies `((imageUid))`; with Alt held it creates one region.
4. Pin-drop: Enter writes the caption with a working `[[` pick; Esc writes an empty tail; "Number pins" pre-fills the next number. "Name region" on an existing empty-tail region writes a tail.
5. `[Site 12](((uid)))` to a region hovers the crop and opens zoomed; Shift is left to Roam; aliases to other blocks are unchanged.
6. Edit a drawing and close it: on-screen crops of that drawing repaint within 3 s with no command.
7. "Copy crop as PNG" pastes into a Word document.
8. "Clear placeholder captions" dry run lists exact matches only and writes nothing; in Readwisenotes, an apply followed by "Undo caption cleanup" restores every string byte-for-byte.
9. A 0.6.1 `ref-overrides` map set before the upgrade still applies after it.
10. DATA-5 results recorded in spec §13: view-operation rows, Roam's Excalidraw version, and the native-feature table.
11. Encrypted graph (owner-approved at that moment, read-only: open and close an existing drawing without editing; no region creation, no cleanup): after a reload, existing region refs and thumbnails paint through the cold path, `:edit/time` is unchanged, and IndexedDB holds no rendered content. If approval is not given, the release notes say encrypted behavior is inferred from Readwisenotes.
12. Compass: both repos green and published; the published `extension.js` of each matches its local build.

### P8: Regions you can see and manage — done 2026-09-29, v0.8.0 (`e933104`)

**Goal.** A regions layer on the open drawing, geometry edits instead of recreation, batch regions per frame, an audit list, copyable region links, animated zoom with Back, crisp 2x crops while the editor is open, Compass opening regions properly, and cheap write guards (shrink guard with a pre-write snapshot, queue flush).

**Judges.** Opus rates REG-1, REG-3, REF-4, NAV-3 and NAV-4 as "later". They stay here per Fable because REF-8, REG-3, REV-1 and GRAPH-12 build on the layer, and animated zoom plus Back make region navigation usable on large plant maps. CMP-1 moved here from Fable's P14 (Fable scored it "now"; Opus placed it in P8). REF-7 moved here from P11 in review: it depends only on DATA-5 (P7), and EXP-1 (P7), REF-4 (P8), PRES-4 (P11) and the user's open item "1x cold crops may be revisited (2026-09-28)" all run into soft crops. DATA-2 also carries DATA-1's in-memory snapshot layer (review: destructive Plexus scene writes already ship).

Implementer order where items depend on each other: UX-3 before NAV-3; REG-1 before REG-3; DATA-2 before any new bulk write path.

#### REG-2 Regions for all frames
S · value high · depends: REF-1 · Fable next 4/5 · Opus next 4/5
- **Gets:** one command makes a cframe region for every frame (or group) that lacks one, in slide order. A deck becomes an outline of embeddable slide refs.
- **Sources:** fable, canvas, landscape. Frame regions are made one at a time (`createFrameRegion`). Plexus Canvas `_framesToSlides` (plugin.js:8062-8080). `slides.js` `orderFrames`.
- **Design:** iterate `orderFrames`; skip frames already named by an `fr=` token (`host.regionsOf`); caption is the frame name only; dedupe by `geometryKey`; all creates under one `withLock`, cap 50.
- **Accept:** a 5-frame drawing gets 5 regions in slide order; a re-run creates none.
- **Risks:** idempotence.
- **Judges:** Fable listed an optional "keep a region per frame" that runs on editor close; Opus drops it because automatic writes on close are the echo risk. Adopted: explicit command only.

#### REG-1 Regions layer and region geometry editing
M · value high · depends: REF-1 · Fable next 4/4 · Opus later 4/4
- **Gets:** a toolbar toggle outlines every region on the open drawing with its label; clicking a chip selects its elements, Shift-click opens the block in the sidebar. "Update region from selection" and "Repair region" change geometry and keep the uid and its backlinks. Block menu "Select on drawing".
- **Sources:** landscape, fable. Regions only flash in a 1.4 s spotlight (`spotlight.js`); a broken ref shows a per-ref "Region unavailable (...)" chip (`regionref.js:76`, painted at :341), and an unsupported one an "Invalid region" / "needs a newer Plexus" chip (:322). Overlay primitives `viewportRectOf` (`native.js:163`), `subscribeViewport` (:171). Logseq ref-count badge (PR 7395). Discourse Graph canvas drawer.
- **Design:** a `backlinks.js`-style overlay: for `host.regionsOf(uid)` draw `regionSceneBBox` as a `pointer-events:none` rect with a small clickable chip; viewport-culled; cap about 150; skip image kinds. Geometry edits rewrite `ids=` / `g=` / `fr=` / `pad=` with a string-only update under the drawing lock, then `refreshRegion`.
- **Accept:** at 50 regions the layer costs under 2 ms per pan frame; after "Update region from selection" a string diff shows only geometry tokens changed, same uid.
- **Risks:** outlines invite accidental clicks (rect inert, chip hit-testable only); cost while panning.

#### REG-3 Region audit and repair list
M · value medium · depends: REG-1 · Fable next 3/4 · Opus later 3/4
- **Gets:** a list of regions on the page (graph-wide opt-in) whose target is missing, outside the crop or unsupported, with Open and Repair. Also flags drawings with two containers and orphan containers.
- **Sources:** fable. Errors surface only as per-ref chips (`regionref.js:321-323, 340-341, 403-407`). The `plexus-region` component page indexes all regions (spec §13 S5b).
- **Design:** `data.q` for blocks referencing page `plexus-region` (default: current page); run `parseRegion`, `resolveRegionTarget`, `regionSceneBBox`; show results in a `dialog.plexus-portal`. Repair reuses REG-1.
- **Accept:** a deliberately broken region is listed and Repair fixes it.
- **Risks:** graph-wide query cost, hence opt-in.

#### REG-5 Copy links and optional URL landing
S · value medium · depends: none · Fable next 3/5 · Opus later 2/3
- **Gets:** "Copy region link" (Roam URL). With nothing selected, the canvas menu offers "Copy ((drawing))", "Copy embed", "Select text only" and "Remove link". Optional: opening a region URL lands in the drawing at the region.
- **Sources:** fable, obsidian. No hash or route handling in `src`. Obsidian ExcalidrawView.ts:7416-7427 (selection vs drawing link), :7165-7190.
- **Design:** menu items use `withClipboard`. Landing: on load and `hashchange`, if `/page/<uid>` parses as a supported region, `openRegion` once (`data-plexus-landed` guard). Setting, default off.
- **Accept:** copy items work; with landing off, zooming into a region block stays in the outline; with landing on, a region URL lands zoomed once.
- **Judges:** split. Fable wanted landing on by default; Opus: it would open the full-screen editor whenever you zoom into a region block, which hijacks outline navigation. Shipped: copy items, landing opt-in.

#### REF-4 Source peek
S · value medium · depends: none · Fable next 3/4 · Opus later 2/4
- **Gets:** the crop popover shows a small whole-drawing thumbnail with the region outlined, plus the drawing title and region kind.
- **Sources:** landscape, fable, canvas. Muse source-peek (allume.com memo). Plexus Canvas `_showBrefHover` breadcrumb (plugin.js:12705). `crop-popover.js` shows the crop only. Thumbnails cached at 160/480 (`THUMB_WIDTHS`). `viewPngCropRect` (`scene.js:264`).
- **Design:** `hoverEntry` resolves `actions.thumbnail(drawingUid, {maxWidth: 160})` from cache only (never renders on hover); draw it on a small canvas and stroke the region rect with `viewPngCropRect` and the S2b export-bounds and 10 px padding rule. Header: page title and kind. Skip image kinds and cold thumbnails.
- **Accept:** the outline matches the crop on three drawings at different scales; a cold cache shows the crop alone without error.
- **Risks:** bounds drift if the validated math is not reused. Opus: on encrypted graphs the cache is memory-only, so the peek is usually absent after a reload. Kept as a cheap addition that degrades silently.

#### UX-3 Reduced motion and an animation setting
S · value low · depends: none · Fable next 2/3 · Opus later 1/4
- **Gets:** spotlight, animated zoom and transitions respect `prefers-reduced-motion`; setting system/on/off.
- **Sources:** brain. K-Plex PlexGraph.tsx:1194-1198. No "reduce" handling in `src`; `spotlight.js` is a fixed 1400 ms.
- **Design:** `motionOk(doc)` helper in `host/theme.js`. Lands before NAV-3, which calls it.
- **Accept:** with reduced motion emulated over CDP, zoom jumps instantly.
- **Risks:** none.

#### NAV-3 Animated zoom and a better spotlight
S · value medium · depends: DATA-5, UX-3 · Fable next 3/3 · Opus later 3/4
- **Gets:** a short eased pan and zoom to targets (skipped when already framed, aborted on input), then a double-pulse spotlight; Esc ends it; zoom cap setting 100/150/200%.
- **Sources:** brain, canvas, fable. `native.js` `zoomTo` is one instant `updateScene`; `actions.js` hard-codes `maxZoom: 1`; no `scrollToContent` in `src`. Excalidraw `App.scrollToContent({animate, duration, fitToViewport, viewportZoomFactor, maxZoom})` (App.tsx:4553-4600). Plexus Canvas `_animateCameraTo` / `_flashAnchor` (plugin.js:3768-3843).
- **Design:** use `app.scrollToContent` with `animate` (~400 ms) if the DATA-5 probe found it; else an rAF tween of appState only (`captureUpdate: NEVER`). Keep a runtime feature check either way. The spotlight waits for the view to settle.
- **Accept:** opening a region animates; pointer or key input aborts; `:edit/time` unchanged.
- **Risks:** the DATA-5 probe decides between native `animate` and the tween; the tween's per-frame `updateScene` on 600 elements costs 22-31 ms and would stutter.

#### NAV-4 Back to the previous view
S · value medium · depends: DATA-5 · Fable next 3/4 · Opus later 3/4
- **Gets:** after open-region, a slide jump or a link jump, a toolbar Back (Alt+Left) restores the previous scroll and zoom; "Return to source block".
- **Sources:** brain. ExcaliBrain `NavigationHistory.ts` (cap 50), `HistoryPanel.ts`. `zoomTo` keeps no history.
- **Design:** in-memory stack per mounted editor; push before any Plexus `zoomTo`; restore with `updateScene`.
- **Accept:** Back restores exact scroll and zoom; `:edit/time` unchanged.
- **Risks:** scroll and zoom persist in state JSON (DATA-5 decides); collision with mind-map Alt keys.

#### REF-7 Crisp 2x/3x hot crops and exact dark export
M · value medium · depends: DATA-5 · Fable next 3/4 · Opus next 3/4
- **Gets:** while the editor is mounted, crops are captured at export scale 2-3 and with `exportWithDarkMode`, instead of the soft 1x cold PNG and the CSS invert.
- **Sources:** brain. Excalidraw appState.ts:66-69, data/index.ts:129-132, `ImageExportDialog` `EXPORT_SCALES [1, 2, 3]`, `actionClipboard` `copyAsPng`. Roadmap open item "1x cold crops may be revisited (user, 2026-09-28)". Measured: an `exportScale` set through `updateScene` does not survive Roam's save.
- **Design:** `captureSelectionPng(app, ids, {scale, dark})`: set `exportScale` / `exportWithDarkMode` in the same `updateScene` that selects, stub `clipboard.write` to capture the blob, restore in `finally` (the `native.js` `captureOnce` pattern). New `png2x` cache tier; the cold path stays 1x. EXP-1's "Copy crop as PNG" uses the 2x tier when it is warm.
- **Accept:** a 2x crop pasted via EXP-1 is visibly sharper; `:edit/time` unchanged after capture.
- **Risks:** verify `exportWithDarkMode` does not persist either (Opus); cache size about 4x per crop; frame kinds must keep the cold-crop frame-label offset (label top = `frame.y - 20.5`, roadmap.md open item) consistent at 2x.
- **Judges:** placed in P11 by Fable; moved to P8 in review because its only dependency ships in P7.

#### DATA-2 Shrink guard and pre-write snapshot for Plexus-initiated scene writes
S · value medium · depends: none · Fable now 4/5 · Opus next 3/4
- **Gets:** a Plexus-driven change (mind-map reconcile, API remove, migration, crop-to-region, refresh) that would drop 5x or more of more than 10 elements aborts with "Not applied: would remove N of M" and an "Apply anyway" action. Native user deletes are untouched. Added in review: DATA-1's in-memory snapshot layer lands here, so every Plexus bulk or destructive scene write (the ones above, plus AUTH-5's batch insert in P9) keeps the pre-write elements in memory and "Plexus: Restore before last Plexus change" puts them back.
- **Sources:** whiteboard. Thymer save guard (plugin.js:2118-2121, 2617-2620), added after a stale client overwrote 417 items with 179. Plexus `NODE_CAP` 500 (`src/view/mindmap.js:4`) and "Block changed elsewhere; not overwritten" (`CHANGED_ELSEWHERE`, `src/view/mindmap.js:13`). Destructive Plexus scene writes already ship: mind-map reconcile (P4), migration (P5), crop-to-region (P3), refresh.
- **Design:** compare element counts before and after in the Plexus write paths only. Before each such write, keep `{drawingUid, elements, time}` in a per-drawing in-memory ring (last 5, dropped on unload; works on encrypted graphs because nothing is persisted). Restore is `updateScene({elements}, captureUpdate: IMMEDIATELY)` plus an "Undo brings it back" toast. DATA-1 (P12) adds the IndexedDB ring and the "Restore an earlier version..." list on top.
- **Accept:** a synthetic write dropping 40 of 50 elements is refused; "Apply anyway" applies it; "Restore before last Plexus change" brings the 50 back and Excalidraw undo reverses the restore.
- **Risks:** must not block a deliberate branch delete; memory held per mounted drawing (cap the ring).

#### DATA-3 Flush pending outline writes on hide and unload
S · value medium · depends: none · Fable now 3/5 · Opus next 3/4
- **Gets:** the mind-map write queue drains on `pagehide` or `visibilitychange` to hidden; sync debounces get a maximum wait.
- **Sources:** whiteboard. No `visibilitychange` or `pagehide` in `src` (grep 2026-09-29). Serialized queue in `mmwrites.js:20-51`. Thymer flush plus `WB_SAVE_MAX` 4000 ms (plugin.js:1432, 2083-2093).
- **Design:** one listener pair per mounted session, removed on unmount; skip rAF batching while flushing.
- **Accept:** queue a write, fire `pagehide`: the write lands.
- **Risks:** async writes may not finish during unload.

#### CMP-1 Compass opens drawings and regions through Plexus
S · value high · depends: none · Fable now 4/5 · Opus next 4/5
- **Gets:** double-click, Open in sidebar or Open in main on a drawing or region node in Compass opens the editor (a region zoomed with spotlight) instead of the plain block.
- **Sources:** brain. Compass `overlay.js:901-908` calls only `host.openInSidebar` / `openInMain`; Plexus `api.js` `open(uid, {region, sidebar})`.
- **Design:** in Compass, if `isDrawingLike(node)` and `RoamPlexus` is present, call `RoamPlexus.open(node.uid, {sidebar})`; else fall back. Close the overlay before a main-window open.
- **Accept:** a region node opens zoomed with spotlight after the overlay closes; Compass still works with Plexus unloaded.
- **Risks:** overlay must close or dim before the full-screen editor opens; "Open in sidebar" runs into the roadmap.md open item "Opening a drawing in the sidebar restores Roam's stored sidebar windows", so the gate checks the sidebar window list before and after.

**P8 live gate**
1. The layer outlines every region on the open drawing with derived labels, image kinds skipped, cap 150; pan cost under 2 ms per frame at 50 regions.
2. "Update region from selection" changes only geometry tokens (string diff), keeps the uid, and the ref refreshes.
3. "Regions for all frames" run twice creates no duplicates.
4. The audit finds a deliberately broken region and Repair fixes it.
5. Copy-link items work. With landing off (default), zooming into a region block stays in the outline; with it on, a region URL lands zoomed once. Back restores scroll and zoom; `:edit/time` unchanged.
6. A synthetic Plexus write dropping 40 of 50 elements is refused with "Apply anyway"; "Restore before last Plexus change" brings them back and is undoable; `pagehide` drains the mind-map queue.
7. Reduced motion skips the tween.
8. Compass double-click on a region node opens the drawing zoomed with spotlight; the overlay closes first. Compass "Open in sidebar" on a drawing node leaves the other sidebar windows as they were, or the open item is re-recorded with what Roam does.
9. Source peek outlines align on three drawings; a cold cache shows the crop alone.
10. With the editor mounted, "Copy crop as PNG" pastes a 2x crop into a Word document; with the editor closed, 1x with a toast. `:edit/time` unchanged after hot capture; a frame-kind crop keeps its label at 2x.
11. Compass: both repos green and published; the published `extension.js` of each matches its local build.

### P9: Roam onto the canvas — done 2026-09-29, v0.9.0 (`64cd0e9`)

**Goal.** Create drawings where you are, drop blocks and pages by search or paste instead of the clipboard, place many bullets at once, create note cards as real blocks, and add a live today card.

**Judges.** Opus rates AUTH-5, AUTH-3, EMB-3 and EMB-4 as "later". AUTH-5, AUTH-3 and EMB-4 stay per Fable. EMB-3 opened with a liveness spike and was dropped by its stop rule (section 6.1).

#### AUTH-11 New drawing commands
S · value high · depends: none · Fable now 5/5 · Opus next 5/5
- **Gets:** palette, slash and menu commands create a drawing where you are and open it: child of the focused block, sibling below, page `Drawings/<name>`, or on today's daily page (reusing a drawing already there). Name template. Always creates new; locked against double creation.
- **Sources:** whiteboard, obsidian, canvas, landscape, fable. No create command and no `slashCommand` usage in `src` (grep 2026-09-29). `RoamPlexus.create` exists (`api.js`; `host/roam.js:151-170`). Plexus Diagram uses `slashCommand.addCommand` (`feature.js:573`). Thymer `addBoardForActivePage` (2703-2710); Obsidian CommandManager.ts:594-700; Plexus Canvas `_openTodayWhiteboard` (12521); Discourse Graph canvas shortcut.
- **Design:** commands "Plexus: New drawing here / below / on page / on today" and slash "/Sketch here"; `getFocusedBlock` plus `host.createDrawing`; today resolves `util.dateToPageUid` and `drawingsOn`. Page and block context-menu items. Static palette entries toast when used out of context. Web lock.
- **Accept:** each command creates one drawing in the right place and opens it; a double invoke creates one; on a daily page the drawing is a plain child, never inside another extension's container.
- **Risks:** writes only on an explicit command.

#### AUTH-1 Embed picker: search a page or block and drop it
S · value high · depends: none · Fable now 5/5 · Opus next 4/5
- **Gets:** "Embed page or block..." opens a Roam-style search at the click point or from the toolbar; Enter drops a live embed; a last row "Create page X" creates a page only when chosen; an optional "Related" section when Roam semantic search is on.
- **Sources:** whiteboard, canvas, landscape, obsidian. The toolbar "Embed block" reads the clipboard only (`insertEmbedFromClipboard`, `actions.js` ~472). `suggest.js` and `link-suggest.js` exist (pages ~11 ms, blocks ~136 ms). Thymer `openCardPicker` (plugin.js:3406-3431); Plexus Canvas "Insert record card" (12100); Discourse Graph node autocomplete; Obsidian universal insert modal; roamdocs `data.async.semanticSearch`.
- **Design:** `createLinkSuggest` as a standalone portal; a pick calls `makeEmbedAnchor({ref})` at the scene point (page picks take the page-embed path). The create row calls `data.page.create` only on explicit Enter. Command "Plexus: Embed page or block...". Clipboard stays as fallback. Feature-detect `semanticSearchEnabled`.
- **Accept:** drops a live embed at the click point with no clipboard read; the create row writes only on Enter.
- **Risks:** focus and z-index against Excalidraw's hidden textarea; listeners exist only while open; `semanticSearch` throws when disabled. Open item from roadmap.md: a page embed of a not-yet-existing `[[Title]]` does not watch for the page to appear (needs a title-keyed watch; unmeasured). The "Create page X" row creates the page before the embed, so it avoids the case; the gate re-checks it.

#### AUTH-4 Shift+Enter in the picker embeds instead of inserting a ref
S · value medium · depends: AUTH-1 · Fable next 3/4 · Opus next 3/5
- **Gets:** any picker row can drop a live embed beside the text element.
- **Sources:** canvas. Plexus Canvas `_applyTranscludeRow` (plugin.js:5601, 5643). `link-suggest.js:334-335` lets Shift chords pass (contract A8).
- **Design:** handle Shift+Enter only while the menu is open: strip the trigger via `applyPick` with an empty replacement, commit the text, then `makeEmbedAnchor` below the edited element. Whitelist just this chord.
- **Accept:** Shift+Enter drops an embed and leaves the text without the trigger.
- **Risks:** Excalidraw text-editor commit and blur timing.

#### AUTH-18 Paste a ref onto the canvas as an embed or link node
S · value medium · depends: AUTH-1 · Fable next 3/5 · Opus next 3/4
- **Gets:** pasting `((uid))` or `[[Page]]` creates an embed card or a link node instead of raw text. Shift+paste keeps text.
- **Sources:** obsidian. Obsidian ExcalidrawView.ts:6077-6420 (paste post-processing). The toolbar button reads the clipboard (`actions.js` ~472).
- **Design:** capture-phase paste on the mounted editor; if the text parses with `parseEmbedRef`, act per setting (text / embed / link node, where a link node is text with `element.link`). Off by default.
- **Accept:** with the setting on, a pasted ref becomes an embed and Shift keeps text; with it off, paste is unchanged.
- **Risks:** changes default paste; clipboard permission differences.

#### AUTH-5 Place many at once
M · value high · depends: AUTH-1 · Fable next 4/5 · Opus later 4/5
- **Gets:** multi-select bullets and run "Plexus: Place on open drawing", or paste a multi-line list: each item becomes a note (text or embed) in a grid, linked to its block, all selected. An indented paste can build a mind map instead.
- **Sources:** fable, whiteboard, landscape, obsidian. Only one-at-a-time clipboard embeds exist. `msContextMenu` is measured (`phase6-contract.md:61`). Thymer `pasteStickies` (plugin.js:1827-1843, grid `ceil(sqrt n)`). Miro Bulk mode. Obsidian "Split text by lines".
- **Design:** `msContextMenu` gives block uids; build text elements (fontFamily 5, sized with `nodeSize`) with link `((uid))` or embed anchors; one `insertElements` at the viewport centre, behind the DATA-2 pre-write snapshot (P8). Optional one area region per note (empty caption), all under one lock. Outline paste strips list markers or hands indentation to the mind-map builder. `NODE_CAP` 500; confirm above 30.
- **Accept:** 5 selected bullets become 5 embeds in a grid, all selected, one lock.
- **Risks:** batch `block.create` under one lock; tabs vs 4-space indentation.

#### AUTH-3 New note card: create a real block and embed it
M · value high · depends: none · Fable next 4/4 · Opus later 4/4
- **Gets:** press N (or use the toolbar tool) and click: a new Roam block is created, embedded there and opened editable so typing starts at once. Esc on an untouched card deletes the block. Later, "Move card to page".
- **Sources:** obsidian, canvas, landscape. Obsidian universal card and convert-card-to-file (CommandManager.ts:2454, 1485). Plexus Canvas `_newRecordCardAt` / `_quickCapture` (plugin.js:7580-7601). Heptabase N tool, Scrintal D, Kinopio tap-and-type. Plexus embeds need an existing block.
- **Design:** create the child under a collapsed `{{[[plexus-cards]]}}` container of the drawing block (the `ensureRegionContainer` pattern, `withLock`); anchor with `customData.plexus.embed`; run the P5 editable flow. Setting "card home": under drawing / on the page / daily page. Deleting the anchor leaves the block.
- **Accept:** N plus click creates a block under `plexus-cards`, editable immediately; Esc on an untouched card deletes only that block.
- **Risks:** double-click is Excalidraw text edit, so use a key or tool; orphan "New card" blocks if focus is lost; these blocks are content, not derived data.

#### EMB-4 Live "today" embed
S · value medium · depends: none · Fable next 3/5 · Opus later 2/4
- **Gets:** an embed whose target is always today's daily page.
- **Sources:** landscape. Obsidian Canvas Daily Note plugin. `parseEmbedRef` takes a fixed ref.
- **Design:** token `plexus:today`, resolved with `util.dateToPageTitle` at render and again at local midnight; keep a normal `[[date]]` in `element.link`.
- **Accept:** a simulated midnight re-resolves the card.
- **Risks:** must not collide with a page named "today". Opus: low value where daily pages mostly hold a schedule; kept because it is S and safe.

#### UX-7 Picker rows: natural dates and "Create page"
S · value medium · depends: AUTH-1 · Fable next 3/5 · Opus next 3/5
- **Gets:** typing "tomorrow", "next friday" or "Sep 30" in the `[[` picker adds a daily-page row in the graph's title format; with no exact match, a last row "+ Create page <query>" really creates the page.
- **Sources:** whiteboard, canvas. Thymer `parseJournalDate` (plugin.js:5788), "New page" row (3420). Plexus Canvas `pxcParseNaturalDate` (1285-1300), `_applyCreateRef` (5716). `phase6-contract.md` A9 (no-result Enter inserts `[[query]]`).
- **Design:** small pure parser plus `util.dateToPageTitle` (ordinal format); the create row calls `data.page.create` only on explicit pick and is skipped if the title exists case-insensitively.
- **Accept:** "next friday" inserts the right daily-page link; the create row writes only on pick.
- **Risks:** locale and ambiguity ("sat"); typos create junk pages.

#### UX-1 Default hotkeys, shortcut hints and a shortcuts list
S · value medium · depends: none · Fable next 3/4 · Opus next 3/4
- **Gets:** default hotkeys (Alt+Shift+R region, Alt+Shift+I image region, Alt+Shift+P present, Alt+Shift+M mind map); kbd hints in the canvas menu; toolbar tooltips with key caps; a shortcuts list in the settings dialog covering Plexus keys and native keys Roam does not advertise (only those the DATA-5 probe confirms).
- **Sources:** fable, whiteboard, canvas, brain. No `default-hotkey` in `src`; `roam-alpha-api.d.ts:161` supports it. Canvas-menu kbd is empty (`phase6-contract.md:252`). `toolbar.js` `button()` sets `textContent` only. Thymer tips (plugin.js:1079-1116); Plexus Canvas `_wireToolbarTips` (3136); Excalidraw help dialog flowchart keys.
- **Design:** pass `default-hotkey` in `commandPalette.addCommand`, labels into `installCanvasMenu`, `title` attributes on buttons. No single-letter keys.
- **Accept:** hotkeys appear in the palette and the canvas menu; Alt+Shift+R creates a region.
- **Risks:** collisions with Excalidraw Alt shortcuts and mind-map Alt+F/L/P/B/X/C/V; stay on Alt+Shift.

**P9 live gate**
1. "/Sketch here" and the four palette commands create a drawing at the right place and open it; on a daily page the drawing is a plain child, never inside another extension's container; a double invoke creates one.
2. "Embed page or block..." drops a live embed at the click point with no clipboard read; "Create page X" creates only on Enter, and the new page's embed fills in without a reload.
3. Multi-select 5 bullets, "Place on open drawing": 5 embeds in a grid, all selected, under one lock.
4. Pasting `((uid))` makes an embed when the setting is on, Shift keeps text; Shift+Enter in the picker embeds.
5. N plus click creates a block under `{{[[plexus-cards]]}}`, editable immediately; Esc on an untouched card deletes only it.
6. The today card re-resolves at a simulated midnight. (The query-node part was dropped with EMB-3.)
7. Hotkeys appear in the palette and canvas menu; typing bench +0 with the editor closed and the picker closed.

### P10: Think in bullets while drawing — done 2026-09-30, v0.10.0 (`55cf9bf`)

**Goal.** Keep the Roam outline visible while drawing full-screen, drag bullets from it (or the sidebar) onto the canvas, and make `[[page]]` / `((uid))` tokens inside text elements clickable. The owner's words: region blocks as collapsed children "is the way Roam thinking happens"; this phase keeps that view on screen.

**Judges.** Fable ranks this the biggest gap for a Roam thinker. Opus rates all three items "later" with high risk (two Roam editors plus Excalidraw in one window, React drag-and-drop moving the source block, character-offset hit testing). Resolution: **the phase opens with two spikes and a stop rule.** Spike A: what Roam puts in `dataTransfer` for bullets and titles, and whether a cancelled drop leaves the source outline byte-identical. Spike B: the dock's keyboard-ownership matrix. If either fails, NAV-7 and AUTH-2 stop and P11 moves up. NAV-1 is exempt: it depends on neither the drag payload nor the dock, so it ships in P10 (or alongside P11) whatever the spikes find.

#### NAV-7 Docked Roam outline inside the full-screen editor
L · value high · depends: none · Fable next 5/5 · Opus later 4/5
- **Gets:** while drawing full-screen, a right panel renders the drawing's parent block (with its regions container), editable. Click a crop in it to zoom the canvas; drag from it onto the canvas (AUTH-2).
- **Sources:** fable. Full-screen hides the outline (spec §13 S5). Editable-embed key and pointer gating is solved (`embeds.js:14-20`; phase 5 contract, `renderBlock` over the full-screen editor).
- **Design:** toolbar toggle "Outline"; `div.plexus-portal.plexus-dock` at `baseZIndex + 2`, width persisted; `renderBlock` of the parent via `:block/_children`; same key gating as the editable embed; Esc returns focus to the canvas; `unmountNode` on close. Default to the parent block, not the whole page.
- **Accept:** keyboard matrix: typing, Enter, Tab, Esc and arrows in the dock never reach Excalidraw, and canvas keys never reach Roam; the 0.5.0 block-selection leak test stays green.
- **Risks:** two Roam editors plus Excalidraw in one window; block-selection leaks; `renderBlock` of a large page is heavy.
- **Judges:** both judges prefer NAV-7 to NAV-6 (a Plexus-made regions panel); Fable: "the regions container is the panel".

#### AUTH-2 Drag a bullet, page or sidebar item onto the canvas
M · value high · depends: NAV-7 · Fable next 5/5 · Opus later 4/4
- **Gets:** drop a Roam block or page from the dock or the right sidebar onto the open drawing: plain drop makes a live embed, Alt makes a link text node, Shift makes plain label text. A ghost chip shows what the drop will do.
- **Sources:** whiteboard, obsidian, landscape, fable. No drop handling in Plexus. Thymer plugin.js:3666-3701 (ghost, 8 px threshold, listeners only while the board is open). Obsidian DropManager.ts:40-260, 760-800 (modifier hint). Logseq PR 8753. Discourse Graph `dragstart` uid read. Plexus Diagram already supports the gesture ("Drag from Roam").
- **Design:** after spike A: while mounted, capture `dragover` / `drop` on the editor container; claim only payloads that parse as `((uid))` / `[[Title]]` so Excalidraw's own file and library drops still work; `viewportToScene`, then `insertElements(makeEmbedAnchor)`. Alt drop: text with link `((uid))`. Borrow the Plexus Diagram drop parser (owner's MIT). Fallback: pointer-simulated drag from `.rm-bullet`.
- **Accept:** the source outline is byte-identical after 20 drops including cancelled ones; Excalidraw file drops still work.
- **Risks:** Roam's block drag could move the source block if the drop is not fully cancelled; Roam DOM selectors churn. The full-screen editor covers the main outline, so the dock or sidebar is the only source.

#### NAV-1 Clickable link tokens inside text elements
M · value high · depends: none · Fable next 4/5 · Opus later 4/4
- **Gets:** modifier-click (or click on an already-selected text box) on a `[[page]]`, `((uid))` or `#tag` token inside a text element navigates; Shift opens the sidebar; several links open a chooser; hover previews and a pointer cursor.
- **Sources:** obsidian, canvas. `host/links.js:37-111` and `model/links.js` resolve only a whole `element.link`. Obsidian ExcalidrawView.ts:6701-6770 (link chooser), ViewLinkNavigationManager.ts:179-200. Plexus Canvas `measureRuns` / `hitInlineRef` (plugin.js:1381-1424), `buildRefBar` (5480-5497).
- **Design:** a second resolver in `installLinkInterception`: hit-test text elements (`containerId` for bound text), map the pointer to a character offset with `createMeasurer` (font, line height, alignment, wrap width), regex the tokens, then `navigateToTarget`. Reuse hover-preview classify/show and the rAF pointer-move probe. A container or arrow link outranks a text link. No writes.
- **Accept:** modifier-click on a token navigates; Shift opens the sidebar; double-click still edits.
- **Risks:** offset hit testing must match Excalidraw wrapping, font fallbacks and rotation; tokens do not look like links (plain text).

**P10 live gate**
1. Spikes A and B passed and are recorded in spec §13. (If either failed, only item 5 applies and the failure is recorded instead.)
2. The dock shows the parent block with its `{{[[plexus-regions]]}}` container, editable; the keyboard matrix passes; the 0.5.0 block-selection leak test stays green.
3. Clicking a crop in the dock zooms the canvas.
4. Dragging a bullet from the dock and from the right sidebar: plain drop makes an embed, Alt a link text node, Shift a label; the source outline is byte-identical after 20 drops including cancelled ones; Excalidraw file drops still work.
5. Modifier-click on a `[[token]]` navigates, Shift opens the sidebar, several links show a chooser; double-click still edits.
6. Unload leaves no dock and no listeners.

### P11: Out the door — done 2026-09-30, v0.11.0 (`4b5b8a0`)

**Goal.** Frames to PDF pages, frame presets, embed text on slides, and decks driven by the outline, with speaker notes from blocks, a laser, and clean paste from canvas to block.

**Judges.** EXP-1 is placed in P7 (moved per Opus) and REF-7 in P8 (moved in review), so crisp crops exist before this phase. Opus rates EXP-3, AUTH-8 and EXP-5 as "later"; they stay per Fable. EXP-5 is constrained to a type-check-only paste listener (Opus). EMB-6's cheap Option C moved here from P16 in review, ahead of EXP-3 and PRES-4, which otherwise print and present embeds as bare labels.

#### EMB-6 Embed text in exports, slides and crops (Option C)
S for Option C (L for the whole item) · value high · depends: none · Fable next 4/3 · Opus later 3/3
- **Gets:** frames and regions containing block embeds export, print and present the block's first line instead of a dashed label.
- **Sources:** landscape, canvas, obsidian. Phase 3 contract, B: embeds are DOM overlays, so view PNGs and exports show only a label. Plexus Canvas `_drawCardEl` rasterizes cards (BUILD-STATUS.md:1468-1487). Obsidian MarkdownImage.ts:306-586.
- **Design:** Option C: the embed anchor draws the first N characters of the block as its own label (plain text from the pulled string, refreshed when the block's `:edit/time` changes while mounted). Option A, presenting on the live canvas, stays with PRES-5 in Later. Option B (rasterize via SVG `foreignObject`) contradicts spec §5.3 and is not planned.
- **Accept:** a slide and a printed page containing an embed show the block's first line; editing the block and reopening the drawing updates it.
- **Risks:** the anchor label is a scene write, so update it only while the editor is mounted and only when the text changed (no churn of `:edit/time` on open).
- **Judges:** Fable: decide after P11 shows the size of the gap. Opus: C now, A via PRES-5, never B. Adopted Opus's ordering; placed in P11 in review so EXP-3 and PRES-4 do not ship with label-only embeds.

#### AUTH-8 Frame presets and slide frames
S · value medium · depends: none · Fable next 3/4 · Opus later 2/3
- **Gets:** a Frame flyout with presets (A4, Letter, 16:9 at 854x480, 4:3, 1:1, mobile) and "Reformat frame"; a "Slide" button adds "Slide N" in the next free slot; frame-set layouts (2x2, strip).
- **Sources:** whiteboard, landscape, canvas, brain. Thymer `WB_FRAME_FORMATS` (plugin.js:183-194, 1750-1757, 2446-2448). Excalidraw+ default slide 854x480. Plexus Canvas `PXC_PANEL_PRESETS` (2230-2250). `wrapSelectionInFrame` is reported present in Roam's App by session learnings but not probed; the DATA-5 table (P7) confirms it.
- **Design:** `updateScene` with a complete frame element (copy the `embeds.js` base fields) plus `customData.plexus.order = next`. "Make slide" is `executeAction(wrapSelectionInFrame)` if the DATA-5 probe found it (else build the frame around the selection bbox the same way as the presets), then name and order. No fold or auto-grow (element writes, data-loss risk; both judges).
- **Accept:** each preset produces its exact size; "Slide" gets the next order number.
- **Risks:** frame field completeness (`index`, `seed`, `version`).

#### EXP-3 Print frames as PDF pages or PNG per frame
M · value high · depends: AUTH-8 · Fable next 4/4 · Opus later 3/3
- **Gets:** each frame becomes a page (A4, Letter, 16:9, margins) through the print dialog, or a PNG per frame. For controlled documents, swab maps and handouts.
- **Sources:** obsidian, canvas, landscape. Obsidian Printable Layout Wizard. Plexus Canvas `_printFrames` (plugin.js:4033-4046). Excalidraw+ and Napkin PDF export. The Depot forbids dynamically loaded scripts (roam-depot PR 97), so no jsPDF.
- **Design:** after EMB-6 Option C; reuse the presenter slide pipeline: a hidden iframe with `@page` CSS, one image per page, then `iframe.contentWindow.print()`. True-scale millimetres need calibration. PPTX only if a zero-dependency writer proves cheap.
- **Accept:** 5 frames print as 5 Letter pages in order in Roam Desktop and in Chrome.
- **Risks:** Electron print differs; cold slides are soft (REF-7, P8, sharpens hot ones); embeds print their first line only (EMB-6 Option C, this phase), not full content.

#### PRES-2 Present from here
S · value medium · depends: none · Fable next 3/4 · Opus next 3/4
- **Gets:** Present starts at the selected frame, the frame nearest the viewport centre, or from a frame region ref ("Plexus: Present from here"); "from start" stays; a progress bar under the HUD.
- **Sources:** landscape, fable. `presenter.open` always uses index 0 (`actions.js`). Excalidraw+ start from a slide.
- **Design:** compute the index from `selectedElementIds` or appState against frame bboxes (`orderFrames` plus `elementBounds`); `blockRefContextMenu` passes the index.
- **Accept:** presenting with a frame selected starts at that frame.
- **Risks:** none material.

#### PRES-1 Speaker notes from Roam blocks
M · value high · depends: REG-2 · Fable next 4/5 · Opus next 4/5
- **Gets:** N in the presenter shows the current frame's notes: the child blocks of that frame's cframe region, rendered live with working links. "Add notes" creates the region on demand. Nothing goes into `customData`.
- **Sources:** obsidian, landscape, fable. `present.js` HUD shows only count and name. Obsidian Slideshow presenter notes. Excalidraw+ presenter notes.
- **Design:** resolve cframe regions via `host.regionsOf`; a notes-pane portal inside the dialog (top layer) rendered with `renderString`, unmounted on slide change. Keys inside the pane do not advance slides.
- **Accept:** notes show live; arrow keys inside the pane do not advance.
- **Risks:** the portal must live inside the modal or it is hidden; the first use writes a region block.

#### PRES-4 Outline-driven deck
M · value high · depends: REF-6, REF-1 · Fable next 5/5 · Opus next 4/5
- **Gets:** "Present this outline" on any block whose children are `((region))` refs, across drawings and image regions. Reordering bullets reorders slides; each child's children are its notes. SOP training decks straight from photo regions.
- **Sources:** landscape. `present.js` takes `[{name, url}]`, but `actions.js` builds slides only from one drawing's frames.
- **Design:** pull the children, keep those that resolve to supported regions; crops from the region-ref cache or the cold path; `presenter.open`. Present cached slides first. Text-only children are skipped.
- **Accept:** an outline of 6 refs across two drawings and one photo presents as 6 slides in bullet order; reordering bullets reorders slides.
- **Risks:** cold crops are 1x until REF-7; mixed children need the skip rule.

#### PRES-6 Laser pointer and temporary pen in the presenter
S · value medium · depends: none · Fable next 3/3 · Opus next 3/4
- **Gets:** L toggles a fading laser trail; P toggles a pen whose strokes vanish on slide change. Colour and decay are settings.
- **Sources:** brain, landscape, obsidian, fable. `present.js` has no pointer. Excalidraw `laserTrails.ts` (`DECAY_TIME` 1000). Excalidraw+ laser. Obsidian en.ts:918-927.
- **Design:** a fixed overlay canvas inside the dialog; rAF only while the pointer moves; nothing persisted; tool clicks do not advance slides. Own trail code, so it works whether or not Roam's build has Excalidraw's laser tool (DATA-5 records which; the native tool matters only for the live editor).
- **Accept:** laser and pen leave nothing in the scene; `:edit/time` unchanged.
- **Risks:** click-zone conflicts.

#### EXP-5 Paste canvas elements into a block as text, image or link
S · value medium · depends: none · Fable next 3/4 · Opus later 2/3
- **Gets:** copying a text or image element and pasting into an outline block inserts its text, image markdown or link instead of Excalidraw JSON; several text elements paste as an outline.
- **Sources:** obsidian. Obsidian EventManager.ts:208-272.
- **Design:** one document paste listener that acts only when the clipboard text is Excalidraw clipboard JSON and the target is a block textarea; insert through the normal input path; images use `firebaseUrl`.
- **Accept:** a copied text element pastes into a block as text; a JSON paste into a code block is untouched.
- **Risks:** Opus: a document-level paste listener is a global hook, so it must be a cheap type check and never swallow a deliberate code-block paste.

**P11 live gate**
1. A frame containing a block embed prints and presents the block's first line, not a dashed label; opening the drawing without editing leaves `:edit/time` unchanged.
2. 5 frames print as 5 Letter pages in order in Roam Desktop and Chrome; frame presets produce exact sizes; "Make slide" is used only if the DATA-5 probe found `wrapSelectionInFrame`.
3. "Present from here" starts at the selected frame. N shows the cframe region's child blocks live; arrow keys inside the notes pane do not advance.
4. An outline of 6 `((region))` refs across two drawings and one photo presents as 6 slides in bullet order; reordering bullets reorders slides.
5. Laser leaves `:edit/time` unchanged.
6. Copying a text element and pasting into a block inserts its text; a JSON paste into a code block is untouched.

### P12: Diagrams from outlines — done 2026-09-30, v0.12.0 (`554116a`)

**Goal.** Cause-and-effect maps inside the two-way mind-map sync, attribute blocks as labelled edges, task nodes, drag-to-reparent, canvas to outline, builder helpers, and durable snapshots with a restore list before the bulk operations of P12-P13.

**Judges.** Opus agrees on the mind-map items (its own P10) and would move GRAPH-5 later. DATA-1 is redesigned per Opus (below); its in-memory layer moved to P8 with DATA-2 in review.

#### DATA-1 Drawing snapshots and restore
M · value high · depends: none · Fable next 4/4 · Opus later 3/3
- **Gets:** durable local snapshots of each drawing and "Restore an earlier version..." listing them by time and element count, on top of the P8 in-memory pre-write snapshot. Restore is undoable.
- **Sources:** whiteboard, canvas, obsidian, landscape. Thymer IndexedDB ring (plugin.js:64-108, opened without a version number to avoid a blocked-upgrade wedge), `restoreMenu` (1693-1699), `wbMergeScene` (3706-3750). Plexus Canvas milestones (8210-8230). Obsidian backups (en.ts:363-371). Heptabase version history. Roam keeps no props history.
- **Design (revised per Opus; split in review):** two layers. (1) In-memory snapshot before every Plexus bulk write, on every graph: ships in P8 inside DATA-2, because mind-map reconcile, migration and crop-to-region already write the scene; P12 extends its coverage to template apply and cause-map generation and lists its entries in the restore dialog. (2) Here: a local IndexedDB ring (last ~20, on editor close and at most every N minutes, hash-deduped, elements only) on unencrypted graphs only. Restore is `updateScene({elements}, captureUpdate: IMMEDIATELY)` plus an "Undo brings it back" toast. On encrypted graphs the durable backup is the EXP-4 export (Later). No in-graph revisions (rule 10, graph bloat); no three-way merge.
- **Accept:** a snapshot lands before each bulk op; restore is undoable; the ring is off on an encrypted graph while the in-memory layer still works.
- **Risks:** storage size; restored elements may reference missing files.
- **Judges:** Opus: the ring alone would be off on encrypted graphs, which are the main production case. Fable: land it here, right before the P12-P13 bulk operations, not in a separate safety phase. Review: the cheap in-memory layer cannot wait for P12, since destructive Plexus writes ship today and AUTH-5 (P9) adds a batch insert; it moved to P8, and the ring stays here.

#### API-1 Builder helpers on RoamPlexus
S · value medium · depends: none · Fable next 3/4 · Opus next 3/4
- **Gets:** `RoamPlexus.build` makes valid elements with a style state: rect, ellipse, text, arrow, frame, bound-text containers, arrows with bindings, `connect(a, b, {label})`, `layout(ids, kind)`.
- **Sources:** obsidian, canvas, landscape. Obsidian ExcalidrawAutomate `addRect` / `addText` / `connectObjects` / `addFrame`. Plexus Canvas `window.__plexusCanvas.automate` (13471-13497). Excalidraw+ MCP prefers rectangle labels and 854x480 slides. `api.js` `add()` takes raw elements.
- **Design:** wrap the `embeds.js` `base()` and `mmsync` element builders plus `layoutTree`; one commit via `scene.add`; additive, so it takes the next `apiVersion` in its release (section 3, rule 10).
- **Accept:** `build` makes a connected 3-box diagram whose arrows stay bound after moving a box.
- **Risks:** schema drift across Excalidraw versions; bound-element arrays must be exact.

#### MM-7 Attribute blocks as labelled edges
M · value high · depends: none · Fable next 4/5 · Opus next 4/5
- **Gets:** a child block ending in `::` (for example `Causes::`) renders as a labelled edge from its parent to each of its ref or text children, not as a node. Typing `label:` in the map input creates one.
- **Sources:** obsidian. Obsidian Mindmap Builder ontology (:234; MindMapBuilderAPI.md:106-120). Matches the harc convention (bare `Name::` plus ref children).
- **Design:** `mmsync` treats these blocks as edge carriers (bound text on the arrow). Compass keeps reading them as harcs. Added in review: maps built since 0.4.0 may already hold user `Name::` child blocks rendered as nodes, so this is a rendering change on live maps. It is opt-in per map (a map-level toggle stored in the root's `customData.plexus.mm`, default off for existing maps, on for maps created after the release) and the CHANGELOG says so.
- **Accept:** `Causes::` children render as labelled edges and Compass still shows them as relations; an existing 0.4.0-era map with a `Name::` child keeps rendering it as a node until the toggle is turned on, and turning it off restores the node with no block writes.
- **Risks:** attribute pages appear in All Pages; user-authored `::` blocks change appearance (hence opt-in); avoid double rendering.

#### MM-11 Cause-and-effect / RCA chart builder
M · value high · depends: MM-7, API-1 · Fable next 5/5 · Opus next 5/5
- **Gets:** Apollo-style cause maps as tree, Ishikawa fishbone or pentagon, from a problem block with nested causes or from a cause-and-effect JSON schema produced by external RCA tooling. Role colours, a star on the primary effect, "caused by" labels, AND brackets for joint causes, `#evidence` as dashed notes, open causes as tasks.
- **Sources:** canvas, fable. Plexus Canvas `elementsFromCauseEffect` / `ceFishbonePositions` / `cePentagon` (plugin.js:2733-2840, 9987-10043), BUILD-STATUS.md:3025-3044, 2909-2945. `layoutTree` has no cause layout.
- **Design:** (a) outline route first (both judges): a "cause" layout on the left tidy tree inside the two-way mind-map sync, so causes stay real blocks. (b) JSON route: pure `src/model/ce.js` emitting rect, text and bound arrows with `customData.plexus.ce`, via "Cause-and-effect from JSON..." and `RoamPlexus.scene(uid).addChart(json)`; optional "Project to blocks" under a `{{[[plexus-ce]]}}` container, idempotent by node id.
- **Accept:** a problem block with nested causes renders as a tree and as a fishbone; a JSON file becomes a chart through the builders.
- **Risks:** the JSON route does not relayout after edits; projection writes the graph (confirm, lock); deep chains widen fast.

#### MM-8 Mind-map task nodes and tag colours
S · value high · depends: none · Fable next 4/5 · Opus next 4/4
- **Gets:** nodes whose block starts with `{{[[TODO]]}}` / `{{[[DONE]]}}` show a checkbox glyph, DONE nodes greyed; Alt+Enter toggles through a string-only update; "Due" uses Better Tasks' in-place due path; a `#tag` to colour map.
- **Sources:** obsidian, fable. `plainText` turns components into a placeholder glyph and `hasMarkup` makes them read-only (phase 4 contract). Colours are depth-only (`mindmap.js:13-14`). Obsidian Mindmap Builder checkbox and calendar (:193, :366-380).
- **Design:** detect the macro prefix in `plainText`, keep it out of `hasMarkup` so F2 edits the remainder, and have the writer re-prepend it. Tag colour goes to `backgroundColor`. Feature-detect Better Tasks; off without it.
- **Accept:** a toggle changes only the macro prefix; a pull proves `BT_attr*` children byte-identical.
- **Risks:** never rewrite `BT_attr*` children.

#### MM-1 Drag onto a node to reparent, between siblings to reorder
M · value high · depends: none · Fable next 4/5 · Opus next 4/5
- **Gets:** dropping a bubble on another reparents it; dropping between siblings reorders (axis-aware); dragging across the root flips side. Alt-drag keeps today's pin-only behavior.
- **Sources:** whiteboard. Thymer `onUp` / `mmDropReorder` / `mmReparent` (plugin.js:4527-4545, 4317-4360). Plexus drag only pins (`mindmap.js:326-346`); `mmwrites.js` has `block.move` (127).
- **Design:** hit-test on drop, then `data.block.move` under the target or at a computed sibling index through the per-root `mmwrites` queue; the echo redraws; a ring highlights the target. `mmDropReorder` is MIT and portable with attribution.
- **Accept:** a node dropped on a node moves the block; a 200-node echo creates no duplicates.
- **Risks:** Roam vs Excalidraw undo semantics; folded subtrees; cross-map moves.

#### MM-2 Mind-map keyboard extras
S · value medium · depends: none · Fable next 3/4 · Opus next 3/4
- **Gets:** Alt+Shift+Up/Down reorders siblings; Shift+Tab selects the parent; move to the other side of the root; Backspace on an empty new node removes it; Ctrl/Cmd+Alt+Arrow centres the camera.
- **Sources:** whiteboard, canvas, landscape, obsidian. Thymer plugin.js:4513-4522, 4362-4367, 4399. Plexus Canvas Shift+Tab (5267-5273). Heptabase Shift+Tab. Obsidian Mindmap Builder hotkeys. Existing keys at `src/view/mindmap.js:504-567`; today's keydown handles only `alt && !shiftKey` chords and plain keys. Dropped from the merged item because it already shipped in 0.4.0 (`CHANGELOG.md:31`, "move, copy"): Alt+X / Alt+C / Alt+V cut, copy and paste (graft) a branch (`letterAction`, `src/view/mindmap.js:560-567`; `paste` at :615-630 calls `writer.moveBranch` for a cut and `writer.copyBranch` for a copy).
- **Design:** keys scoped inside the editor; sibling reorder is `block.move` within the parent through the `mmwrites` queue; centring is an `updateScene` scroll with `captureUpdate: NEVER`; only an empty, just-created node deletes without the double press.
- **Accept:** each key works inside the editor and does nothing outside it.
- **Risks:** collisions with Roam and Excalidraw (Ctrl+Arrow is currently swallowed with a hint).

#### GRAPH-5 Drawing or selection to outline
M · value high · depends: none · Fable next 4/5 · Opus later 4/5
- **Gets:** canvas content becomes Roam blocks or copyable Roam markdown: frames become headings in slide order; text and embeds become bullets and `((refs))` in reading or arrow order; arrows become order or nesting. Re-runs update instead of duplicating. The inverse of the P4 sync.
- **Sources:** obsidian, canvas, landscape. Obsidian "Excalidraw Writing Machine" and Mindmap Builder `exportMarkdown`. Plexus Canvas `pxcConnectionGraphMd` / `_copyConnectionGraph` (871, 6260). Obsidian Canvas2Document.
- **Design:** read live elements (`originalText` keeps `[[links]]`); bucket by frame or container; order by a topological sort of bound arrows, then y/x; embeds become `((uid))`, regions `((regionUid))`. Insert with `data.block.fromMarkdown` under a chosen parent or a Plexus-owned `{{[[plexus-outline]]}}` child in one call; stamp `customData.plexus.outlineUid` for idempotence. Also "Copy as Roam markdown".
- **Accept:** a 3-frame board writes headings and refs under the chosen parent; a re-run updates in place; preview above 50 blocks.
- **Risks:** ordering heuristics on messy boards; cycles need a documented rule; writes only where the user points.

**P12 live gate**
1. A snapshot lands before each bulk op; "Restore an earlier version" is undoable; the IndexedDB ring is off on an encrypted graph and the in-memory layer still restores.
2. An outline with `Causes::` children renders the cause layout with labelled edges, as a tree and as a fishbone; a cause-and-effect JSON file becomes a chart through the builders. On an existing 0.4.0-era map (not only a new one) that holds a user `Name::` child, the child still renders as a node until the MM-7 toggle is on.
3. A `{{[[TODO]]}}` node shows a checkbox; Alt+Enter changes only the macro prefix and a pull proves `BT_attr*` children untouched.
4. Dropping a node on a node moves the block; a 200-node echo creates no duplicate and holds the P4 relayout budget; Shift+Tab selects the parent; Alt+Shift+Up/Down reorders siblings and the existing Alt+X/C/V still cut, copy and paste.
5. "Drawing to outline" on a 3-frame board writes headings and refs under the chosen parent; a re-run updates in place; preview shown above 50 blocks.
6. `RoamPlexus.build` makes a connected 3-box diagram; `apiVersion` and spec §8 are bumped.

### P13: Process flows and templates — done 2026-09-30, v0.13.0 (`b33dbd3`)

**Status (2026-09-30).** Contract and 32 critic amendments: `docs/phase13-contract.md` (`1771663`). Shipped in `b33dbd3`. Spec §13 has the live table. Tile colour uses `.plexus-portal .plexus-template-tile`. Thumbs exist only on user templates. Gate c is a recorded miss: folding a loop target drops the dashed arrow. The save poll is 40 ms (the contract step said 250). Typing +0.04 ms/key. Named Readwisenotes test blocks are removed at the end of the phase.

**Goal.** HACCP-style process flows with swimlanes from an ordered outline, drawing templates stored as Roam blocks, and arrange helpers.

**Judges.** Opus rates all three "later" and wants MM-12 only after a second layout has proven itself on the sync; placing it after MM-11 in P12 does that. Both judges prefer templates stored as drawing blocks over JSON code blocks.

#### MM-12 Process-flow / swimlane diagram from an outline
L · value high · depends: MM-7, MM-11 · Fable next 5/5 · Opus later 4/4
- **Gets:** ordered children become steps; a `?` or `#decision` step becomes a diamond with Yes/No arrows; a `Lane::` attribute or `#lane` tag places a step in a lane frame; CCP and hazard tags show as chips; loops and merges use `((ref))` children. Two-way like the mind map; each lane frame gets a cframe region.
- **Sources:** fable, landscape. Only mind-map layouts exist (`mindmap.js` `LAYOUTS`). Napkin text-to-flow, FigJam generated flowcharts, Roam `{{mermaid}}` for the same need.
- **Design:** a "flow" layout in `layoutTree` plus diamond styling in `mmsync`; arrow labels from child prefixes (`Yes:`, `No:`); lanes are stacked frames; same reconcile and echo machinery; markers in `customData.plexus.mm`. Write down the `((ref))` convention for loops and merges before any code (Fable).
- **Accept:** an ordered outline with decision steps and `Lane::` attributes renders lanes, diamonds and Yes/No arrows; edits round-trip both ways; the loop convention round-trips.
- **Risks:** a process is a DAG while the sync is a tree; cross-lane routing (start straight, allow pins); markup blocks stay read-only on the canvas.

#### AUTH-10 Drawing templates stored as Roam blocks
M · value high · depends: API-1 · Fable next 4/5 · Opus later 4/5
- **Gets:** "New drawing from template..." and "Save selection as template". Starters: HACCP flow, 5-Why, fishbone, Apollo cause map, SIPOC, swimlane, swab-site map, 16:9 slide. A template carries elements plus default styles.
- **Sources:** obsidian, landscape, fable. Obsidian README.md:176-190, en.ts:532-541. Scrintal, Kinopio and FigJam templates. Shortcode Embeds keeps Excalidraw JSON in blocks. The migration paste path exists (`addViaPaste`).
- **Design:** a page `Plexus/Templates` holding one drawing child per template (both judges; not JSON code blocks). Pick with cached thumbnails; open, then `addViaPaste` of `host.drawing(templateUid).elements`; remap ids; apply selected appState `currentItem*` fields.
- **Accept:** a template opens with remapped ids; "Save selection as template" round-trips; no props write outside Excalidraw.
- **Risks:** `scene.add` rejects images (`addViaPaste` keeps `firebaseUrl`); image templates re-upload on each apply (spec S4).

#### AUTH-9 Arrange and tidy
M · value medium · depends: none · Fable next 3/3 · Opus later 2/3
- **Gets:** "Arrange" lays out the selection as a row, column or grid with fixed spacing, equal size, a box around, or a grid of images; lays out a frame's children; swaps two elements; untangles nodes with a deterministic force layout.
- **Sources:** whiteboard, obsidian, landscape, canvas. Thymer `alignPop` (plugin.js:2276-2307). Obsidian layout scripts. Heptabase Tidy Up. Advanced Canvas Swap Nodes. Plexus Canvas `_layoutSection` (4672-4700), `pxcGraphLayout` (633-657, owner's code). Native align and distribute exist.
- **Design:** canvas-menu section "Plexus: Arrange >" calling `updateScene` in one undo step; bound text follows its container; recompute arrows with `edgeGeometry` or use app actions so they re-route.
- **Accept:** "Arrange as row" re-routes bound arrows in one undo step.
- **Risks:** `updateScene` does not re-route bound arrows, so stale or detached arrows otherwise. Kept despite Opus's "later" because P9 and P15 drop many cards at once.

**P13 live gate**
1. An ordered outline with `?` / `#decision` steps and `Lane::` attributes renders lane frames, diamonds and Yes/No arrows; editing a step on the canvas updates the block and vice versa; each lane frame gets a cframe region; the `((ref))` loop convention is documented and round-trips.
2. "New drawing from template" (HACCP flow, fishbone, swab-site map, 16:9 slide) opens with remapped ids; "Save selection as template" round-trips; no props write outside Excalidraw.
3. "Arrange as row" re-routes bound arrows in one undo step.

### P14: Compass hookup — done 2026-09-30, v0.14.0 (`0c2b348`), Compass 0.5.0 (`6420aca`)

**Goal.** Compass and Plexus call each other: "Show in Compass", larger hover thumbnails, element links as graph edges, related drawings, a drawing centre that lists frames and regions, and follow mode.

**Judges.** Opus rates everything here except CMP-6 as "later". If time is short, the phase shrinks to CMP-6 plus CMP-2 and the rest wait. CMP-1 is placed in P8.

#### CMP-6 window.RoamCompass API and "Show in Compass"
S · value medium · depends: none · Fable next 3/4 · Opus next 3/4
- **Gets:** Compass exposes `focus(uid)`, `isAvailable()` and ready events; Plexus adds "Show in Compass" on region refs, drawing blocks and linked canvas elements.
- **Sources:** brain. Compass `extension.js` exposes only `__ROAM_COMPASS_VERSION`. K-Plex "Focus active note".
- **Design:** a frozen API object, feature-detected in both directions at click time.
- **Accept:** "Show in Compass" focuses the node; either extension alone still works.
- **Risks:** contract versioning between two extensions.

#### CMP-15 Larger thumbnail on hover; thumbnails for image blocks
S · value medium · depends: none · Fable next 3/4 · Opus later 2/3
- **Gets:** hovering a drawing or region node in Compass shows the 480 px cached thumbnail; later, `thumbnail()` also covers plain image blocks and an optional `Thumbnail::` attribute.
- **Sources:** brain. K-Plex thumbnail hover. Compass `THUMB_WIDTH` 160; Plexus caches 480.
- **Design:** cache-only popover with `pointer-events:none`; extend `thumbnail()` through `host/image-source.js`.
- **Accept:** hover shows the 480 px image without a render request.
- **Risks:** blob URLs only on encrypted graphs; cold until the drawing has been opened in the session (Opus).

#### CMP-2 RoamPlexus.linksOf(uid): element links as graph edges
M · value high · depends: none · Fable next 4/4 · Opus later 3/4
- **Gets:** Compass draws dashed "drawing-link" edges for non-text element links, embed targets and mind-map uids, labelled with the element text.
- **Sources:** brain. `spec-plexus.md:75-77` (non-text links are not refs), :190-194. Compass `neighborhood.js:307-313` edge kinds. ExcaliBrain turns every node link into an edge.
- **Design:** `linksOf` (additive; next `apiVersion`, section 3 rule 10) reads `:excalidraw/elements-json` from props without an editor, plus `customData.plexus.embed` and `mm.uid`; cached by drawing hash and refreshed on "change". Compass adds a dashed read-only edge kind.
- **Accept:** `linksOf` returns element links, embed targets and mind-map uids without requesting `app-excalidraw.js` (network log).
- **Risks:** props are internal, so parse defensively; Compass amends its "edges are harcs and refs only" rule; cap and dedupe.

#### CMP-3 Related drawings in Compass
M · value high · depends: CMP-2 · Fable next 3/4 · Opus later 3/4
- **Gets:** for a page, block or drawing centre, other drawings ranked by shared refs, project attribute or namespace (weighted by recency), with cached thumbnails.
- **Sources:** brain. ExcaliBrain `getSiblings` (Page.ts:739-751). Compass far-east siblings. Plexus `drawingsOn`.
- **Design:** one `data.q` for `{{[[excalidraw]]}}` blocks whose refs intersect the centre's, cap 50; a "Related drawings" group; setting `compass-related-drawings`.
- **Accept:** drawings sharing more refs rank higher.
- **Risks:** drawings with only non-text links score low until CMP-2; query cost.

#### CMP-7 Drawing centre expands into frames and regions
M · value medium · depends: CMP-2 · Fable next 3/4 · Opus later 2/3
- **Gets:** when the Compass centre is a drawing, its outline lists frames in slide order, then region blocks, with thumbnails and kind glyphs; a click opens the drawing zoomed there.
- **Sources:** brain. K-Plex heading sections. Plexus `regionsOf`, `slides.js` `orderFrames`.
- **Design:** `framesOf(uid)` (additive; next `apiVersion`) from props, plus `open(uid, {frame})`; frame thumbnails from a temporary cframe crop key.
- **Accept:** a drawing centre lists frames in slide order, then regions.
- **Risks:** frame thumbnails without region blocks; props parsing.

#### CMP-9 Compass follow vs pinned mode
S · value medium · depends: CMP-6 · Fable later 2/4 · Opus later 2/3
- **Gets:** a "Follow main window" toggle recentres on route change without stealing focus; Pin stops it; "Show linked window" flashes the main pane.
- **Sources:** brain. ExcaliBrain `PIN_LEAF` / `AUTO_OPEN` (ToolsPanel.ts:176-231). K-Plex sync modes.
- **Design:** one `hashchange` listener, no polling; skip while typing or when Compass itself navigated.
- **Accept:** Compass follows a route change and does not loop with the sidecar.
- **Risks:** feedback loops with the sidecar.

**P14 live gate**
1. "Show in Compass" on a region ref focuses the node; Compass builds and runs with Plexus unloaded and vice versa.
2. Compass node labels use the derived label, never "Region".
3. `linksOf` returns element links, embed targets and mind-map uids without requesting `app-excalidraw.js`; `apiVersion` and spec §8 are bumped, and Compass feature-detects `linksOf`.
4. "Related drawings" ranks by shared refs.
5. A drawing centre lists frames in slide order, then regions, with thumbnails.
6. Both repos green and published; published `extension.js` of each matches its local build.

### P15: Graph data on the canvas — done 2026-09-30, v0.15.0 (`6d80929`)

Shipped 0.15.0. Link label is `relates to::`. Cut: GRAPH-12, due-date chips, presets, arrow restyle, delete-sync. Typing -0.042 ms/key.

**Goal.** Read Roam data back onto the drawing: region metadata chips, a persistent focus veil, todo mode, cards from a query, typed relations as harcs, and a site-map heat overlay once its data source exists in Roam.

**Judges.** Both judges rate these "later" or "park"; Fable phases them last as the long-horizon payoff. Opus would park REV-2 and GRAPH-12. GRAPH-12 carries a hard precondition below.

#### REF-8 Region metadata: notes, attribute chips and tag chips
M · value medium · depends: REF-1, REG-1 · Fable later 3/5 · Opus later 3/5
- **Gets:** a region block's children (notes, `Attr::` values, `#tags`) show as a quiet count and chips on the ref card and on the regions layer; hover shows the notes; a filter dims regions that do not match a tag.
- **Sources:** fable, landscape. `pullBlock` already fetches children (`roam.js` `PULL_PATTERN`) but `regionref.js:291-401` ignores them. Kinopio filters. Obsidian Canvas Filter plugin. Heptabase tags.
- **Design:** at claim, if children exist, append `sup.plexus-count` (a plain number); hover renders up to 5 children with `renderString` in the crop popover; children matching `^Name::\s*value` render as `span.plexus-attr` chips; on the REG-1 layer, chips from `:block/refs` with a stable-hash colour; "Filter by tag" dims other outlines. Read-only; harcs read tolerantly.
- **Accept:** a region with child notes shows a plain-number count; hover renders up to 5 children.
- **Risks:** extra DOM per ref, so keep it off the first-paint path; attribute conventions vary.

#### NAV-9 Focus mode: dim all but the selection and its connections
M · value medium · depends: none · Fable later 3/4 · Opus later 2/3
- **Gets:** a persistent toggle dims everything except the selection and elements within 1, 2, 3 or all arrow hops (optionally ref-linked embeds). Esc exits. The same veil serves tag filters and todo mode.
- **Sources:** whiteboard, landscape, canvas. Thymer `applyFocus` BFS (plugin.js:1236-1244, 1123-1129). Advanced Canvas Focus Mode. Heptabase focus. Plexus Canvas spotlight neighbourhood (9492-9505). `spotlight.js` is a 1.4 s timed veil.
- **Design:** extend `spotlight.js` into a persistent veil with holes at the viewport rects of kept ids, computed from `boundElements` / `startBinding` / `endBinding`; reposition on scroll; never change element opacity through `updateScene`. Depth is a setting.
- **Accept:** only the selection and its neighbours at the chosen depth stay lit; Esc exits; no element writes.
- **Risks:** holes are approximate for rotated or curved elements; cap at a few hundred elements; `pointer-events:none`.

#### REV-2 Todo mode on the canvas
M · value medium · depends: NAV-9 · Fable later 3/4 · Opus park 2/3
- **Gets:** a toggle dims everything except open TODO cards, nodes and regions; DONE items fade; due dates show as chips.
- **Sources:** landscape. Kinopio Todo Mode. P5 embeds already show Roam checkboxes.
- **Design:** read `{{[[TODO]]}}` / `{{[[DONE]]}}` and `BT_attrDue` read-only (a cancelled-status task still counts as a TODO); uses the NAV-9 veil.
- **Accept:** only open TODOs stay lit; cancelled-status tasks count as open.
- **Risks:** the veil cannot dim native shapes per element without writes. Opus: Better Tasks views already cover open work.

#### GRAPH-7 Populate the canvas from a query, page or namespace
M · value medium · depends: AUTH-5 · Fable later 3/5 · Opus later 3/4
- **Gets:** "Embed query results..." and "Embed page children..." place results as cards in a grid, one frame per source page; "Diagram from query" lays pages and ref edges out as an editable snapshot. Never auto-populates.
- **Sources:** landscape, obsidian, canvas. Discourse Graph "Send to Page". Obsidian Canvas Bases / Folder Canvas; Obsidian dataviewjs mind-map examples. Plexus Canvas `_queryPinboard` (7965). roamdocs `data.roamQuery({uid})`.
- **Design:** pick a `{{query}}` block and run `data.roamQuery`, or a page or namespace via `data.q`; cap 50; elements only, no block writes; "Re-run" adds missing uids only; generated nodes marked in `customData`.
- **Accept:** at most 50 cards; a re-run adds only missing uids.
- **Risks:** the snapshot goes stale against the live query (EMB-3 is the live alternative).

#### GRAPH-1 Arrows as typed Roam relations
L · value high · depends: MM-7 · Fable later 4/4 · Opus later 4/4
- **Gets:** an arrow between two embeds or link nodes (or "Link selected", or dropping one card on another) can be promoted to a real Roam relation. Presets (relates to, causes, contributes to, prevents, detects, part of) set colour, dash, arrowheads and label. Deleting the arrow offers to remove the relation.
- **Sources:** whiteboard, canvas, landscape, obsidian. Thymer Smart Links (plugin.js:3533-3660). Plexus Canvas `_linkSelectedCards` / `_confirmDropLink` (9192-9204, 8178-8215; append-only and idempotent invariants in BUILD-STATUS.md:1527-1546), `PXC_REL_PRESETS` (820-828). Scrintal arrows as links. Discourse Graph relation arrows. Obsidian typed links.
- **Design:** default: append to the source block a bare `Label::` child with a `((B))` / `[[B]]` ref child (harc convention); dedupe against `:block/refs`; never rewrite existing strings; confirm plus undo toast; web lock and echo ledger; mark the arrow `customData.plexus.rel = {src, dst, label}`. If touching user blocks feels wrong: a Plexus-owned `{{[[plexus-links]]}}` child of the drawing holding `((A)) [[label]] ((B))`.
- **Accept:** "Link selected" writes one bare `Label::` with a ref child; a re-run is idempotent; undo toast; never `BT_attr*`.
- **Risks:** two sources of truth after later block edits (verify on open, badge if stale); page-targeted embeds need a target-block choice; no automatic sync on retarget or delete.

#### GRAPH-12 Site-map heat overlay
L · value high · depends: REF-1, REG-1 · Fable later 4/4 · Opus park 3/2
- **Gets:** on a plant layout where each swab point or zone is a region linked to its site page, a toggle colours the regions from graph data (latest result, hit count in a date window, zone class). A read-only live map with a legend.
- **Sources:** fable. Captions carry real refs (spec §5.1, 0.6.1). Overlays exist (`spotlight.js`, `embeds.js`). Nothing reads data back onto the canvas today.
- **Design:** for each region, pull the caption's refs and a configured attribute (`Zone::`, `Last result::`) from the site page, or count referencing blocks in a date range via `data.q`; map to a configurable ColorBrewer scale; translucent divs over `viewportRectOf`. Zero writes; fail to grey.
- **Precondition:** environmental-monitoring results must live in Roam. This item does not start until the data lives in Roam (Fable: confirm first; Opus: park until then).
- **Accept:** 20 site regions colour within 500 ms from a configured attribute; missing data shows grey; zero writes.
- **Risks:** the data model varies per graph (configurable); query cost bounded by region count.

**P15 live gate**
1. A region with child notes shows a plain-number count; hover renders up to 5 children.
2. Focus mode dims all but the selection and its arrow neighbours at the chosen depth; Esc exits. Todo mode keeps only open TODOs lit (cancelled-status tasks count as TODO).
3. "Embed query results" places at most 50 cards; a re-run adds only missing uids.
4. "Link selected" writes one bare `Label::` with a ref child; idempotent on re-run; undo toast; never `BT_attr*`.
5. If the GRAPH-12 precondition is met: a plant map with 20 site regions colours from a configured attribute within 500 ms, greys on missing data, zero writes.

### P16: Pull-forward pool

Items Fable scored "next" but left unphased. Each ships on its own when use shows the gap, under the standing gate plus its own acceptance check, but never before its dependencies. Opus rates all eight "later". (EMB-6 was in this pool; its Option C moved to P11 in review.)

| Item | Depends on | Earliest |
|---|---|---|
| NAV-5, AUTH-15, EMB-1 | none (NAV-5 reads the DATA-5 probe) | after P7 |
| REF-12, NAV-2 | REF-1 | after P7 |
| PRES-3 | REG-2 | after P8 |
| API-3 | API-1 | after P12 |
| AUTH-12 | AUTH-10 | after P13 |

#### REF-12 Send a region to a page
M · value high · depends: REF-1 · Fable next 4/5 · Opus later 3/4
- **Gets:** region menu "Send to page...": pick a page and append a child there holding `((regionUid))`, an optional `Verb::` and the date, so the page carries the crop and Linked References show the origin. Also "Create context region" for text holding a `[[Page]]`.
- **Sources:** obsidian. Obsidian `ea-scripts/Capture Note.md:1-60` (dual-note injection with a `verb::` link), Release-notes.md:1440.
- **Design:** the P6 picker chooses the target; `data.block.create` on explicit action only.
- **Accept:** one child is created on the chosen page and appears in the region's Linked References.
- **Risks:** writes to a user page; attribute pages proliferate. Opus: Alt-dragging the region bullet onto a page already makes a ref natively, so the added value is the `Verb::` relation.

#### NAV-2 Region-aware element links ("Link to object")
M · value medium · depends: REF-1 · Fable next 3/4 · Opus later 3/4
- **Gets:** clicking a `((regionUid))` element link inside a drawing opens that region (same drawing: pan, zoom, spotlight; other drawing: open zoomed) instead of the region block. "Link to object..." creates or reuses an area region for the target and sets `element.link`.
- **Sources:** brain. `links.js` `navigate()` calls `mainWindow.openBlock` for any `((uid))`. Excalidraw `elementLink.ts:14-25` builds `window.location` plus `?element=`, which Roam cannot route; `linkToElement` / `copyElementLink` exist in Roam's App.
- **Design:** in `navigate()`, if `parseRegion(target).supported`, call `actions.openRegion(uid)`. The canvas menu writes `element.link` via `updateScene`, merging `customData`.
- **Accept:** a region element link opens the region, not the block.
- **Risks:** each object link adds a region block, so create on request only; clear Roam's link tooltip.

#### NAV-5 Find in drawing
M · value high · depends: none · Fable next 4/4 · Opus later 3/4
- **Gets:** search across text, frame names, links, image names, region captions and mind-map node text; zooms to and selects matches; results can be copied.
- **Sources:** obsidian, brain. Excalidraw `actionToggleSearchMenu.ts`, `SearchMenu.tsx`; `searchMatches` exists in Roam's appState. Obsidian `selectElementsMatchingQuery` (ExcalidrawView.ts:8052-8105).
- **Design:** read the DATA-5 probe row for `actions.searchMenu` / `searchMatches` (P7); if present, a palette command plus a button opens the native search. Else a picker-styled portal that filters live elements and calls `scrollToContent` / select. A distinct shortcut, because Roam owns Ctrl+F.
- **Accept:** a query zooms to and selects its matches, through the native menu or the own portal per the DATA-5 row.
- **Risks:** shortcut capture; an own UI is about 200 lines.

#### AUTH-12 Stencil / icon library stored in the graph
M · value high · depends: AUTH-10 · Fable next 4/4 · Opus later 3/3
- **Gets:** a shared library of reusable shapes and flow symbols (CCP diamond, hazard, swab point, zone boundary, terminal, decision, document) that syncs with the graph; searchable panel, one-click insert; a starter process-flow set.
- **Sources:** obsidian, fable, canvas, landscape, brain. Obsidian `StencilLibraryManager.ts:1-60`, Icon Library script. Plexus Canvas `_openIconLibrary` (13205). Advanced Canvas flowchart shapes. Excalidraw `updateLibrary` / `onLibraryChange` (types.ts:697, 1026). Library persistence inside Roam is unmeasured.
- **Design (per Opus):** reuse AUTH-10 storage: stencils are drawings on a `Plexus/Stencils` page, not JSON in code blocks (which drifts toward a shadow database). A toolbar "Stencils" grid inserts via `addViaPaste` with cached thumbnails. Spike first whether Excalidraw's library sidebar persists in Roam; if it does, optionally sync to `app.library.updateLibrary`.
- **Accept:** an inserted stencil matches its source; the persistence spike is recorded.
- **Risks:** sync loops if bound to `onLibraryChange`.

#### AUTH-15 Annotate a Roam image in a drawing
L · value high · depends: none · Fable next 4/4 · Opus later 3/4
- **Gets:** block menu "Plexus: Annotate image" creates a drawing with that image locked at natural size, optionally with an imgrect region pre-created. For CAPA and deviation photo markup.
- **Sources:** obsidian. Obsidian CommandManager.ts:1923-2216 (annotate image), carveout.ts:17-107.
- **Design:** `parseImageRefs`, the create-native-drawing path, mount; bytes via `loadImageBitmap`, then `app.addFiles` plus `updateScene` with a locked image, then zoom to fit. The original image block stays as it is.
- **Accept:** the original image block is byte-identical; the drawing shows the image locked at natural size.
- **Risks:** `addFiles` on encrypted graphs and duplicate uploads (spec S4) need a spike before committing. REF-17 plus imgrect regions already cover much of the need.

#### EMB-1 Embed display modes, auto-fit and card polish
M · value medium · depends: none · Fable next 3/4 · Opus later 2/3
- **Gets:** per-embed mode (title only, snippet, full with child depth) plus attribute chips; "Fit to content" height; an idle snapshot so 30 embeds cost nothing until scrolled into view; a header open arrow; a muted "Block not found. Re-link" state.
- **Sources:** whiteboard, landscape, canvas. Anchors are fixed 360x200, depth 2, 30-block cap (phase 3 contract, B). Thymer idle snapshot and `noteGrow` (plugin.js:5060-5140, 5318-5329). Scrintal compact/snippet/full. Logseq collapse and auto-resize toggles. Plexus Canvas glow (BUILD-STATUS.md:2459-2472).
- **Design:** store mode, depth and fields in `customData.plexus`; cache rendered HTML keyed by `:edit/time` plus hash (memory only on encrypted graphs) and paint it until visible; auto-fit via one `ResizeObserver` per overlay, writing the size once on editor close or explicit action. CSS scoped to `.plexus-embed`.
- **Accept:** 30 embeds with typing bench +0; "Fit to content" writes the size once.
- **Risks:** a size write-back must not fight Excalidraw resize or loop; `renderBlock` ownership rules 13 and 19.

#### PRES-3 Slide authoring: overview grid, make slide, clean frame labels
M · value medium · depends: REG-2 · Fable next 3/3 · Opus later 3/3
- **Gets:** G in the presenter shows a slide thumbnail grid; "Make slide" wraps the selection in a named, ordered frame; frame names and outlines are hidden in captures; "Move slide up/down" in the canvas menu.
- **Sources:** obsidian, landscape, brain, fable. `slides.js` reads `customData.plexus.order`, but nothing writes it. Obsidian Slideshow sorter and marker frames (en.ts:252-255, 1721-1725). Excalidraw `wrapSelectionInFrame` / `updateFrameRendering` (actionFrame.ts).
- **Design:** the grid uses the presenter's slide URLs; `frameRendering {name: false, outline: false}` is set during hot capture and restored in `finally`; move up/down writes order through one `updateScene`. PRES-4 already makes the outline the sorter, so a drag-sorter panel (which would need NAV-6) is not planned.
- **Accept:** `frameRendering` is restored after capture (state diff); moving a slide changes the presenter order.
- **Risks:** Roam may persist `frameRendering` (the DATA-5 probe records whether), so always restore.

#### API-3 Agent surface: Roam MCP tools and scene.describe()
M · value high · depends: API-1 · Fable next 4/4 · Opus later 3/3
- **Gets:** Plexus tools registered with Roam's extension-tool MCP (list drawings, describe scene, add diagram, create region, export SVG), and a compact scene description (frames, labels, embed refs, captions, arrows) with `((uid))` citations that grounds AI extensions and Claude.
- **Sources:** landscape. roam-tools CHANGELOG (`extensionTools`, `call_extension_tool`). Excalidraw+ MCP tools. tldraw agent shape summaries. Heptabase chat with whiteboards. Plexus `api.js` scene v2 and `whenOpen`.
- **Design:** ship the pure `scene.describe()` first (Opus); then probe `roamAlphaAPI.ai` at load; tools wrap the existing API and tell the user that `whenOpen` opens the drawing visibly. No provider code in Plexus.
- **Accept:** `describe()` returns frames, labels, embed refs, captions and arrows for a test drawing.
- **Risks:** unstable API surface; agent writes need Roam-level confirmation; `scene.add` rejects images; size limits on big scenes.

## 6. Later, parked, rejected

Opus column: shown only where the Opus judge differed from Fable's verdict.

### 6.1 Later (55)

| ID | Item | Why later | Revisit when | Opus |
|---|---|---|---|---|
| REF-5 | Per-ref size, alignment, bare style, padding | Knobs; the ask was tidy, not options. `refOverrides` becomes an object in P7, so this stays cheap | A real layout need appears | |
| REF-9 | Region click chooser and second-order links | Adds a click to every region open; second-order links are Compass's job | Regions with many links become common | |
| REF-10 | Region kind chooser and drill-down targets | Auto-detection works | An ambiguous selection bites | park |
| REF-13 | Multi-image blocks and rotated images | Rare; inverse rotation needs a 90-degree test | The image-index pick (S) can ship alone if needed | |
| REF-14 | Gallery layout for the regions container | Horizontal-outline width rules vs 280 px cards unknown | Cheap opt-in experiment | park |
| REF-16 | Image occlusion study cards | Reveal needs the hot path | After REF-7 | park |
| REG-4 | Backlink residuals (page badges, add to canvas, "Where is this cited?") | Let the 0.6.1 counts settle; pull watches bill the host | After a fresh typing bench | |
| AUTH-6 | Sticky notes, number stamps, stack | Text elements already work as stamps; sticky paper is aesthetic. Numbered pins on images moved into REF-17 (P7) in review | Canvas number stamps (S) if numbering free-standing points gets tedious | |
| AUTH-7 | Spawn next connected element | Excalidraw's native Cmd/Ctrl+Arrow flowchart creator is live in Roam's build (`phase4-contract.md:230-232`) and may already do it; MM-12 covers process flows | After the DATA-5 probe (P7) records what the native keys do | |
| AUTH-13 | Styling helpers | Menu weight for marginal wins | The contrast rule can ride with mind-map colours | park |
| AUTH-14 | Insert a Roam image or drawing from a picker | `addFiles` re-uploads every file (spec S4); regions on plain images cover partial refs | Storage duplication is solved | |
| AUTH-16 | Nested drawings with breadcrumb | Hierarchy already lives in the outline; slow editor switching; soft cold tiles | A nesting workflow appears | park |
| AUTH-20 | Inbox tray of unplaced blocks | The NAV-7 dock with "already embedded" marks does the same | The dock proves too heavy | |
| AUTH-21 | Layer manager | Frames plus NAV-9 approximate it; emulated hide leaks into exports | Layered plant maps become frequent | park |
| EMB-3 | Live `{{query}}` or component node | Spike failed 2026-09-29 (Readwisenotes, trusted CDP): a query rendered through `renderString` is a static snapshot. It showed 0 results, still 0 after a matching TODO was created and after 3 s, and still 0 after the TODO was marked DONE; a fresh `renderString` of the same string then showed 1 result. The P9 stop rule dropped it | A way to re-render on change (a pull watch on the query's refs, at the cost of watches the host bills for), or Roam ships live query components | |
| EMB-2 | Page cards with chosen attributes, editable | Inline edits write the graph; `BT_attr*` display-only | After EMB-1 | |
| EMB-5 | Task cards and checkboxes on the canvas | Better Tasks rules and glyph-swap risks; MM-8 and P5 embeds cover it | | |
| EMB-7 | Text-element transclusion of `((uid))` | Two writers on one element | After a spike on which field Roam serializes into the tail | park |
| NAV-6 | Canvas outline / regions panel | Duplicates the outline; NAV-7 is the Roam-native answer | Only as a host for a slide sorter | park |
| NAV-8 | Minimap | Work during pan; most scenes are small | After DATA-5 | |
| NAV-10 | Keyboard navigation on selected cards | Space pans, Alt+arrows nudge, Roam hotkeys: large collision surface | | |
| NAV-11 | Drawings finder and gallery | Compass already shows drawing thumbnails in search; tiles are cold on encrypted graphs | A plain "Open drawing..." command may be enough | park |
| NAV-13 | Open in graph view / mentions | Trivial but not a driver | Window types confirmed at runtime | park |
| GRAPH-2 | Expand neighbours around a card | Compass owns neighbourhoods; needs caps and culling | | |
| GRAPH-3 | Ref lines between embeds | Rated the biggest perf risk in the source plugin; duplicates Compass | A hovered-only minimal version | park |
| GRAPH-6 | Turn text into a page or block (and back) | AUTH-3 covers most of the need | After AUTH-3 | |
| GRAPH-10 | Managed "Linked from this drawing" list | Contradicts spec §5.2; CMP-2 is the read-only alternative | Backlinks for non-text links become a felt gap | park |
| GRAPH-11 | Two-way text sync for single-text regions | The full phase-4 echo matrix again; links cannot round-trip; little text left after REF-1 | | park |
| CMP-4 | Add related drawing from a Compass zone | Graph write with duplicate-title and placement questions; "New drawing" exists | After CMP-6 | |
| CMP-5 | Snapshot a Compass neighbourhood into a drawing | Needs a mounted editor; every text ref adds backlinks | After API-1 | |
| CMP-8 | Compass type chips and quick filter | Lenses were removed on purpose in Compass 0.2.0 | Chips only, if asked | park |
| CMP-11 | Compass display settings | Settings sprawl | Only settings a user will notice | park |
| CMP-13 | Compass cross-links among neighbours | Edge clutter | If asked | park |
| CMP-14 | Hover highlight and modifier-gated previews | Cosmetic | If the 250 ms link preview annoys | |
| CMP-17 | Empty (ghost) pages and URL nodes | Noise on link-heavy pages; the "Empty page" hover hint is the useful part | | park |
| CMP-19 | Compass home entries in an empty search | Pleasant, marginal; graph-wide query | | park |
| PRES-5 | Live-canvas slideshow with camera transitions (also EMB-6 Option A) | appState writes persist through Roam's save; the dialog presenter is robust | EMB-6 Option C (P11) proves too thin; after DATA-5 | |
| PRES-7 | Stepwise reveal (builds) | One SVG export per build; needs the hot path | After REF-7 | |
| MM-3 | On-canvas "+" buttons and collapse badge | Keyboard already covers it | The "(+N)" suffix is judged ugly | |
| MM-4 | More mind-map layouts and a chooser | Five layouts exist | A map asks for both-sides or org chart | |
| MM-5 | Mind-map styling (shape, connector, palettes) | Arrow type changes rewrite points; styling is not the gap | | park |
| MM-6 | Mind-map conversions and bulk input | Paste-indented-list-as-branch is the useful piece; the rest is heuristic | | |
| MM-9 | Mind-map cross-links from block refs | Derived arrows ignore layout and cross badly | | |
| MM-10 | Import a linked page's outline, submaps | Many writes; embed cap | After MM-1, MM-7, MM-8 settle | |
| EXP-2 | Export dialog (scale, padding, theme, selection) | EXP-1 and EXP-3 cover daily needs; the native canvas menu has Copy as PNG/SVG (`phase6-contract.md:59`) | After REF-7 (P8) | |
| EXP-4 | Scene JSON export and import | Good hygiene; DATA-1 covers restore | Opus: it is the durable backup on encrypted graphs, so first in line | |
| EXP-6 | Mermaid import/export | The native converter is probably absent in Roam's bundle; a parser creeps | Export to `{{mermaid}}` is the easy half | park |
| EXP-9 | Auto-synced export image block | Upload churn and orphan files | Mobile viewing becomes a habit | park |
| API-2 | Event hooks and a self-describing API | Only "change" exists; an unfiltered scene hook runs on every pointer move | Compass or a script needs a hook | |
| DATA-7 | Outline write-queue status chip | Toasts work | Failed outline writes occur | |
| UX-6 | Per-drawing attributes | Attribute pages clutter All Pages; settings cover current needs | | |
| UX-8 | Picker triggers (alias on selection, #tag, auto-pair, recents) | IME and auto-pair on the input path | | |
| UX-10 | Feedback polish | Onboarding is not needed; the "Removed from the drawing, block unchanged" toast is the useful bit | A delete confuses someone | |
| REV-1 | Comment pins with threads | Single reviewer today; Roam's native comment on the region block is the cheap route | Multiple reviewers; after REG-1 | |
| REV-4 | Tags on elements and a tag filter | Typing `#tags` already makes refs; the filter needs the veil | After NAV-9 | park |
### Shipped from Later

| ID | Version | Sha | What shipped |
|---|---|---|---|
| UX-5 | 0.16.0 | `a5ee31d` | Theme follows Roam. Restored on close. Fit on open, grid color, default font, and presenter on open cut |
| UX-12 | 0.16.0 | `a5ee31d` | Lock or unlock selection, and Unlock all, on the command list |
| DATA-4 | 0.16.0 | `a5ee31d` | Copy diagnostics, on the command list |
| PERF-2 | 0.16.0 | `a5ee31d` | Crop generation prefix `nN|` when the extension version changes |

### 6.2 Parked (17)

| ID | Item | Reason | Opus |
|---|---|---|---|
| REF-11 | New region kinds (text, section, frame by name, composite, freehand loop) | String-format growth with round-trip risk and no use case; composite is two regions; spec §5.1 rejects absolute polygons | |
| AUTH-17 | Extract selection or frame to a new drawing | Two editors in sequence, `add()` rejects images, regions pointing at moved ids break, partial failure leaves two copies | |
| EMB-8 | Link / bookmark cards for URLs | Every URL would leave the machine; CORS blocks the useful part; a `[title](url)` block embed already works | |
| EMB-9 | Website embeddables capability probe | `renderEmbeddable` is undefined in Roam; CSP and encrypted-graph trust; no demand | reject |
| NAV-12 | Floating pins | No compare workflow; the sidebar already holds crops side by side | |
| GRAPH-8 | Lanes and timelines by attribute | Position vs attribute is two sources of truth; Better Tasks is off limits; far from the region mission | |
| GRAPH-13 | Connected margins | Large UI for one workflow; Linked References already list the notes | |
| CMP-10 | Compass centre as a live embed or sidecar pane | Keyboard ownership inside an overlay; the right sidebar already works | |
| CMP-16 | Compass node styling by attribute | Drifts toward typed tag classes; kind glyphs ride on CMP-7 | |
| CMP-18 | Compass relation editing from menus | Destructive writes from a menu | |
| PRES-8 | Presenter view in a second window | Popup blockers, Electron, CSP, large data URLs | |
| PRES-9 | Slide timer and auto-advance | No kiosk use | |
| DATA-6 | Edit-conflict guard for shared graphs | Single-user graphs; a second tab would false-positive | |
| UX-2 | Drawing-only palette commands on mount | Command churn and leak risk; the palette already toasts out of context | |
| UX-9 | Preferences bundle (modifiers, reuse window, changelog toast) | More test surface; Shift = sidebar is enough | |
| UX-11 | Floating mini-toolbar near the selection | Overlaps Excalidraw's selection UI; the bottom bar is already selection-gated | |
| PERF-1 | Touch and long-press parity | Whether Depot extensions run on Roam mobile is unknown and untestable here | |

### 6.3 Rejected (18)

| ID | Item | Reason | Opus |
|---|---|---|---|
| AUTH-19 | Image paste helpers (URL to image, downscale) | Downscaling discards originals, and evidence photos must stay unaltered; URL fetches hit CORS; HEIC needs a dependency | |
| EMB-10 | LaTeX on the canvas | Spec §1 non-goal; overlay-only, never reaches exports | |
| GRAPH-4 | Shortest path, hub badges, clustering | Compass already offers paths; overlay cost for no QA outcome | park |
| GRAPH-9 | Bulk attribute brush and date-delta labels | Bulk graph mutation that could flatten harcs and touch attributes other extensions own | |
| CMP-12 | Compass expanded two-level view | Query fan-out per node for unwanted density | park |
| PRES-10 | Narrated walkthrough per slide | Storage growth, encrypted upload behavior, permission prompts; no use | |
| EXP-7 | Chart from a pasted table | Dedicated analysis tools do real charts; synthetic paste needs activation and the dialog may be absent | |
| EXP-8 | PDF pages into the canvas | Spec §1 non-goal; pdf.js breaks zero-deps; the `{{pdf}}` iframe is cross-origin. Page image plus Image region stands | |
| API-4 | Script engine on Roam blocks, command links | Arbitrary code, consent prompts, lifecycle leaks. Fable: Claude through API-3 is the script engine. Opus: roam/js and SmartBlocks already exist | |
| REV-3 | Stamps, reactions, dot voting | Undocumented reaction API; voting needs multiple users and presence | |
| OUT-1 | AI features in core | Provider keys in a public extension, metered billing, privacy; enable from outside through API-3 | |
| OUT-2 | OCR for handwriting and image text | External service or heavy dependency; spec non-goal | |
| OUT-3 | Live cursors, follow mode, shared laser | Needs a relay; servers are out of scope; graph writes cannot carry presence | |
| OUT-4 | Rich text inside notes | Excalidraw text is single-style and Roam's tail flattens markup; use Roam formatting in embedded blocks | |
| OUT-5 | Shape generators and geometry ops | Mostly library-dependent; low demand. Freedraw-to-line could return as a one-off | |
| OUT-6 | Thymer sync plumbing | Roam's save path is not interceptable and has no shortcut store; DATA-2 keeps the lesson | |
| OUT-7 | Obsidian platform-only features | No Roam equivalent; Roam owns storage, sync and history | |
| OUT-8 | Arrow endpoints on groups or sub-regions | Excalidraw binds arrows to single elements; proxy rectangles pollute the scene | |

### 6.4 Dropped as already shipped (not counted)

Source ideas that Plexus already has, each shipped or measured: captions as real refs to source blocks and canvas backlink counts (0.6.1; residuals kept as REG-4); no implicit graph writes at load; whole-drawing previews (thumbnail cache); image-part references with all region kinds and `pad=` (P1-P2; padding UI is REF-5); element links, hover preview and the inline picker (P2, P6); read-only and editable embeds and non-destructive image crops (P3, P5); mind-map core, including Alt+X/C/V cut, copy and paste of branches, and legacy conversion (P4, P5); editable card bodies (P5 embeds); concurrency rev-check (not applicable; nearest ideas are DATA-1 and DATA-6); click-to-zoom with spotlight, frames as slides, dark crops, `window.RoamPlexus` for Compass, legacy migration.

Excalidraw-native features measured in Roam's build, so no Plexus item rebuilds them: Copy as PNG/SVG, grid, snap, zen and view mode in the canvas menu (`phase6-contract.md:59`); frames with clipping (`phase2-contract.md:8`); native crop (P3 crop-to-region); the Cmd/Ctrl+Arrow flowchart creator and Alt+Arrow navigator (`phase4-contract.md:230-232`); pan and zoom.

Moved out of this bucket in review because nobody has measured them in Roam's build: laser, search UI, elbow arrows, `wrapSelectionInFrame`, `scrollToContent` with `animate`, and `frameRendering` persistence. They are rows in the DATA-5 native-feature probe (P7), and PRES-6, NAV-5, NAV-3, AUTH-7, AUTH-8 and PRES-3 read that table.

### 6.5 Open items carried from roadmap.md (not counted)

The P0-P6 ledger in [`roadmap.md`](roadmap.md) carries six open items. Where each is checked:

| Open item | Checked in |
|---|---|
| 200-node relayout: the visible frame is about 35-40 ms, dominated by Excalidraw's `updateScene` | P12 gate item 4 (MM-1 must hold the P4 budget) |
| 1x cold crops may be revisited (user, 2026-09-28) | REF-7, P8 |
| Opening a drawing in the sidebar restores Roam's stored sidebar windows | CMP-1 risk and P8 gate item 8 (Compass "Open in sidebar"); re-recorded if Roam's behavior is unchanged |
| Embed of a not-yet-existing `[[Title]]` page does not watch for the page to appear (needs a title-keyed watch) | AUTH-1 risk and P9 gate item 2 ("Create page X" then embed) |
| `createPlainImageRegion` targets image index 0 only | REF-13, Later |
| Frame kinds: cold-crop frame label at `frame.y - 20.5` must match the hot SVG | REF-7 risk and P8 gate item 10 (2x capture); PRES-3's `frameRendering {name: false}` must hide the same label in both paths |

## 7. Fable's view

Fable weighed every item for fit with how a Roam outline thinker works, and its phasing is the backbone above. Its distinctive calls:

- **On captions:** "stop inventing text". The fallbacks write words into the outline as if the user had written them. Keep the tail as the Roam-native home for real text and refs, and give per-reference wording to Roam's own alias syntax rather than to more stored text. A region that crops nothing "is a second block for something `((imageUid))` already renders".
- **Ideas no other source proposed:** alias refs as region refs (REF-3), crop refresh on editor close as the fix for the daily "Refresh crops" chore (REF-6), pin-drop with an inline caption (REF-17), the docked outline (NAV-7), process flows and swimlanes from an ordered outline (MM-12), task nodes in mind maps (MM-8), the site-map heat overlay (GRAPH-12, "the one thing no other tool gives"), stepwise slide builds (PRES-7) and image occlusion (REF-16).
- **NAV-7 over NAV-6:** a Plexus-made regions panel duplicates the outline; "the regions container is the panel". The outline should come into the editor, not be rebuilt beside it. Dragging a bullet onto the canvas is "the gesture", and the dock is its source.
- **Sequencing:** finish the region story first (P7), make regions visible and safe (P8), close the biggest gap for a Roam thinker (getting blocks onto the canvas without clipboard gymnastics and keeping the outline in view, P9-P10), get work out of Roam (P11), turn outlines into RCA and HACCP diagrams (P12-P13), then Compass (P14) and graph data on the canvas (P15).
- **Safety lands where it is needed:** DATA-1 sits in P12 right before the bulk operations it protects; DATA-2 and DATA-3 are small and ride in P8, not a separate safety phase. (Review moved DATA-1's in-memory layer into DATA-2 in P8, because destructive Plexus writes already ship; the IndexedDB ring stays in P12.)
- **What to leave alone:** AUTH-7 waits for a probe of Excalidraw's native flowchart keys (now part of DATA-5, P7); API-4 is rejected because Claude through API-3 is the script engine; GRAPH-12 waits until its data exists in Roam.

**Where Opus disagreed, and what this plan did:**

| Item | Fable | Opus | Resolution |
|---|---|---|---|
| EXP-1 | now, placed in P11 | now, P7 | Moved to P7 |
| CMP-1 | now, placed in P14 | next, P8 | Moved to P8 |
| REF-3 | `[label]((uid))` as merged | Syntax is `[label](((uid)))`; Roam's own alias hover may compete | Corrected; hover conflict listed as a risk |
| REF-1 | Setting when written / always / never | Skip the home hint; make `refOverrides` an object now | Hint deferred; object adopted |
| REF-4 | next | later: cold on encrypted graphs | Kept in P8; silent degradation accepted |
| REG-1, REG-3, NAV-3, NAV-4, UX-3 | next | later | Kept in P8 |
| REG-2 | Optional auto region per frame on close | Drop the auto variant (echo risk) | Explicit command only |
| REG-5 | URL landing on by default | Landing hijacks outline navigation | Split: copy items on, landing opt-in |
| AUTH-5, AUTH-3, EMB-4 | next | later | Kept in P9 |
| EMB-3 | next | later: liveness unmeasured | Kept in P9 behind a liveness spike |
| NAV-7, AUTH-2, NAV-1 | next | later, spike first | Kept in P10; phase opens with two spikes and a stop rule |
| AUTH-8, EXP-3, EXP-5 | next | later; EXP-5 is a global hook | Kept in P11; EXP-5 limited to a type check |
| DATA-1 | IndexedDB ring, off on encrypted graphs | Ring does nothing on the main graph; snapshot in memory before bulk writes | Redesigned with an in-memory layer; that layer ships in P8 with DATA-2 (review), the ring in P12 |
| GRAPH-5 | next | later | Kept in P12 |
| MM-12 | next | later, after MM-11 proves a second layout | P13, after MM-11 in P12 |
| AUTH-10, AUTH-12 | Code-block JSON as one option | Templates and stencils as drawing blocks; merge storage | Drawing-block storage for both |
| CMP-2, CMP-3, CMP-7, CMP-15 | next | later | Kept in P14; phase may shrink to CMP-6 plus CMP-2 |
| REV-2, GRAPH-12 | later | park | Kept in P15; GRAPH-12 behind a data-source precondition |
| EMB-6 | Decide after P11 | Option C now, A via PRES-5, never B | Opus's ordering; Option C placed in P11 before EXP-3 and PRES-4 (review), Option A with PRES-5 in Later |
| REF-7 | next, placed in P11 | next | Moved to P8 in review: its only dependency (DATA-5) ships in P7 |
| DATA-4 | later | next | Later |
| AUTH-19 | reject (dependency, paste interception) | reject (originals are evidence) | Rejected; both reasons listed |
| Native overlap | | AUTH-7, NAV-5, EXP-2 may be native in 0.18 | One native-feature probe folded into DATA-5 (P7, review) replaces the per-item probes |
| Park vs later | | Opus parks 22 items Fable keeps in Later, and parks GRAPH-4 and CMP-12 where Fable rejects | Fable's verdict used; Opus's shown in section 6 |

Opus also surfaced two costs the item texts understated: every "cache-only" feature is cold after a reload on an encrypted graph, and `addFiles` re-uploads bytes on every insert (spec S4), which quietly duplicates storage for image inserts and image templates.

## 8. Sources appendix

Local clones live under `~/excalidraw-port-research/` unless noted. All sources were read-only; nothing was written to any graph.

| Tag | Source | Location | License | What was read |
|---|---|---|---|---|
| plexus | Plexus (baseline) | `~/roam-plexus`, [Svyk/roam-plexus](https://github.com/Svyk/roam-plexus) at `95c2f6d` (0.6.1) | MIT | `docs/roadmap.md`, `spec-plexus.md` (§1, 2, 5, 7, 8, 13), `CHANGELOG.md`, phase 2-6 contracts; `src/` (actions, api, extension, settings, model/region, caption, refdisplay, slides, embeds, mindmap, mmsync; view/regionref, toolbar, present, hover-preview, backlinks, context-menus, discover, embeds; host/links, native, roam) |
| whiteboard | thymer-whiteboard v1.0.3 (Parham Shafti) | `thymer-whiteboard`, [parham-shafti/thymer-whiteboard](https://github.com/parham-shafti/thymer-whiteboard) at `84307f0` | MIT, (c) 2026 | README, CHANGELOG, plugin.json, LICENSE, `tools/test-merge.mjs` header, 5 screenshots; `plugin.js` (6,633 lines) read line by line at 1-4860, 5060-5352, 5898-6633; skimmed the generated menu and picker regions, note-range internals and CSS strings |
| obsidian | Obsidian Excalidraw plugin 2.28.0-rc.0 | `obsidian-excalidraw-plugin`, [zsviczian/obsidian-excalidraw-plugin](https://github.com/zsviczian/obsidian-excalidraw-plugin) at `bd40308a` | AGPL-3.0 (LICENSE `8df4364b`, 2026-05-13; `package.json` still MIT) | README, docs, `ea-scripting.md`, `ExcalidrawScriptsEngine.md`, `MindMapBuilderAPI.md`, all of `src/lang/locale/en.ts`, CommandManager (about 70 commands), `FRONTMATTER_KEYS`, settings defaults, ExcalidrawView (context menu, link open and hover, paste, zoom, search), DropManager, EventManager, ViewLinkNavigationManager, InlineLinkSuggester, ExcalidrawData, copyLinkToSelectedElement, MarkdownImage, StencilLibraryManager, EA hooks, release notes (about 580 bullets), `script-store.json` (85 scripts) and about 20 script headers. Not read: RefactorPlan.md, most of Slideshow, minified Mindmap Builder, AI provider code, non-English locales |
| canvas | Plexus Canvas v1.222.0 (the owner's Thymer plugin) | `thymer-canvas-plugin`, [Svyk/thymer-canvas-plugin](https://github.com/Svyk/thymer-canvas-plugin) at `be13bfa` | Owner's code, no LICENSE file | README, MINDMAP-WORKLIST, NESTED-TARGET-DESIGN, SCALE-ARCHITECTURE, SPIKE-RESULTS, TIER-AB-WORKLIST, all 3,336 lines of BUILD-STATUS; `plugin.js` (14,542 lines) indexed by grep (141 commands, 15 tools, settings, pure functions) and read at about 30 feature sites; `tests/` listed only |
| brain | ExcaliBrain | `excalibrain`, [zsviczian/excalibrain](https://github.com/zsviczian/excalibrain) at `1486a50` | MIT, (c) 2022 Zsolt Viczian | README, 1,213-line spec, Scene, Node, Layout, Link, Page, ToolsPanel, HistoryPanel, NavigationHistory, LinkTagFilter, PageSuggester, OntologySuggester, main, Settings, en.ts, styles |
| brain | K-Plex | `~/kplex-reference`, [zsviczian/kplex](https://github.com/zsviczian/kplex) at `8b53ef4` | AGPL-3.0 | README, `docs/GRAPH_LENSES.md`, `UI_COMPONENTS.md`, ThoughtNode, PlexGraph, CentralNodeEditor, RelationPopover, NewRelatedNoteModal, LongPressTooltip, settings, locale keys. Behavior only; Compass stays clean-room |
| brain | Excalidraw | `excalidraw` (fork [zsviczian/excalidraw](https://github.com/zsviczian/excalidraw) at `5a806fb1`, 0.18.105); upstream [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw); Roam bundles 0.18.x (patch unmeasured; DATA-5 records it) | MIT | `actions/*`, App.tsx (paste, flowchart keys, `scrollToContent`, laser), `types.ts` (imperative API, props), `mermaid.ts`, TTDDialog, SearchMenu, Stats, `flowchart.ts`, `elementLink.ts`, ImageExportDialog, CHANGELOG. Roam runtime facts come from Plexus session learnings, not a live probe |
| brain | Roam Compass | `~/roam-compass`, [Svyk/roam-compass](https://github.com/Svyk/roam-compass) at `5276d4a` | MIT, owner's | README, CHANGELOG, `spec-compass.md`, grep-level reads of `overlay.js`, `neighborhood.js`, `text.js`, `host.js` |
| fable | Fable 5.1 first-principles proposal | none (no external product) | Original | Plexus docs and `src/` as listed for plexus; `~/plexus-Diagram/README.md` to avoid duplicating board features; `roam-alpha-api.d.ts` (`default-hotkey`, line 161) |
| (diagram) | Plexus Diagram | `~/plexus-Diagram`, [Svyk/plexus-diagram](https://github.com/Svyk/plexus-diagram) at `781280a` | MIT, owner's | README ("Drag from Roam"), `feature.js:573` (`slashCommand`) |
| landscape | Web landscape survey | Public docs only | Per product (see section 3) | Heptabase wiki (version one, changelog, fundamental elements, shortcuts, roadmap, collaborate, UI logic, PDF annotation, 2025-07-23 newsletter); Obsidian Canvas help, [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/), Advanced Canvas README (GPL-3.0), Obsidian canvas plugin listings and roadmap; tldraw docs (shapes, bindings, snapping, drawing, agent and workflow kits, AI docs, make-real starter); Logseq (whiteboards docs, PRs 7395, 8753, 8797, 0.9.1 blog); Allume/Muse (site, Mac memo, updates); Kinopio (help pages on selecting, filters, minimap, backlinks, checkbox cards; API); Scrintal (features, docs, Oct 2024 blog); FigJam (guide, stamps, AI); Miro (sticky notes, AI, Talktrack, Intelligent Canvas); Napkin (site, help, API); Excalidraw+ (changelog, presentations, education, API/MCP doc); Roam (Discourse Graph docs, roamdocs Alpha API and data model, roam-excalidraw 2021 changelog, Shortcode Embeds, roam-tools changelog, community digest). Licenses checked through the GitHub API. Not obtained: Heptabase backlog page and two Muse memos (404) |
| judges | Fable 5.1 (weighted) and Opus 5.5 (feasibility) | this document | n/a | Both re-read Plexus at `95c2f6d`; Opus re-ran source greps on 2026-09-29 (absent from `src`: `slashCommand`, `default-hotkey`, `visibilitychange`/`pagehide`, `scrollToContent`, `ClipboardItem`, `rm-alias`, `prefers-reduced-motion`, `semanticSearch`) |

Two research passes (brain, landscape) read an uncommitted working tree that later became 0.6.1 (`95c2f6d`); evidence here cites the committed lines.

## 9. ID index

One home per item. "QW" marks items also shortlisted in section 4. Totals: P7 9, P8 12, P9 9, P10 3, P11 8, P12 8, P13 3, P14 6, P15 6 (64 in P7-P15), P16 8 (72 placed), Later 59, Parked 17, Rejected 18: **166 items**. Review moves: REF-7 P11 → P8, EMB-6 P16 → P11 (Option C). Review additions (Name region, number pins, REF-2 Alt override, caption-cleanup undo, native-feature probe) extend existing items and add no IDs.

| ID | Name | Home |
|---|---|---|
| REF-1 | Caption-optional regions | P7 (QW) |
| REF-2 | Whole image or drawing: own ref | P7 (QW) |
| REF-3 | Alias refs as region refs | P7 (QW) |
| REF-4 | Source peek | P8 |
| REF-5 | Per-ref size, alignment, bare, padding | Later |
| REF-6 | Crop refresh on editor close | P7 (QW) |
| REF-7 | Crisp 2x/3x hot crops, dark export | P8 |
| REF-8 | Region metadata chips | P15 |
| REF-9 | Region click chooser | Later |
| REF-10 | Region kind chooser | Later |
| REF-11 | New region kinds | Parked |
| REF-12 | Send a region to a page | P16 |
| REF-13 | Multi-image blocks, rotated images | Later |
| REF-14 | Gallery layout for regions container | Later |
| REF-15 | Auto-caption quality | P7 (QW) |
| REF-16 | Image occlusion study cards | Later |
| REF-17 | Pin-drop with caption prompt | P7 (QW) |
| REG-1 | Regions layer and geometry editing | P8 |
| REG-2 | Regions for all frames | P8 (QW) |
| REG-3 | Region audit and repair | P8 |
| REG-4 | Backlink residuals | Later |
| REG-5 | Copy links, optional URL landing | P8 |
| AUTH-1 | Embed picker | P9 (QW) |
| AUTH-2 | Drag bullets onto the canvas | P10 |
| AUTH-3 | New note card | P9 |
| AUTH-4 | Shift+Enter embeds from picker | P9 |
| AUTH-5 | Place many at once | P9 |
| AUTH-6 | Sticky notes and stamps | Later |
| AUTH-7 | Spawn next connected element | Later |
| AUTH-8 | Frame presets and slide frames | P11 |
| AUTH-9 | Arrange and tidy | P13 |
| AUTH-10 | Drawing templates as blocks | P13 |
| AUTH-11 | New drawing commands | P9 (QW) |
| AUTH-12 | Stencil library in the graph | P16 |
| AUTH-13 | Styling helpers | Later |
| AUTH-14 | Insert image or drawing from picker | Later |
| AUTH-15 | Annotate a Roam image | P16 |
| AUTH-16 | Nested drawings | Later |
| AUTH-17 | Extract selection to new drawing | Parked |
| AUTH-18 | Paste a ref as embed or link node | P9 |
| AUTH-19 | Image paste helpers | Rejected |
| AUTH-20 | Inbox tray | Later |
| AUTH-21 | Layer manager | Later |
| EMB-1 | Embed display modes and polish | P16 |
| EMB-2 | Page cards with attributes | Later |
| EMB-3 | Live query node | Later (P9 spike failed) |
| EMB-4 | Live "today" embed | P9 |
| EMB-5 | Task cards on the canvas | Later |
| EMB-6 | Embed text in exports and slides (Option C) | P11 |
| EMB-7 | Text-element transclusion | Later |
| EMB-8 | Link / bookmark cards | Parked |
| EMB-9 | Website embeddables probe | Parked |
| EMB-10 | LaTeX on the canvas | Rejected |
| NAV-1 | Clickable link tokens in text | P10 |
| NAV-2 | Region-aware element links | P16 |
| NAV-3 | Animated zoom, better spotlight | P8 |
| NAV-4 | Back after programmatic zoom | P8 (QW) |
| NAV-5 | Find in drawing | P16 |
| NAV-6 | Canvas outline / regions panel | Later |
| NAV-7 | Docked Roam outline | P10 |
| NAV-8 | Minimap | Later |
| NAV-9 | Focus mode veil | P15 |
| NAV-10 | Keyboard navigation on cards | Later |
| NAV-11 | Drawings finder and gallery | Later |
| NAV-12 | Floating pins | Parked |
| NAV-13 | Open in graph / mentions view | Later |
| GRAPH-1 | Arrows as typed relations | P15 |
| GRAPH-2 | Expand neighbours | Later |
| GRAPH-3 | Ref lines between embeds | Later |
| GRAPH-4 | Graph analysis helpers | Rejected |
| GRAPH-5 | Drawing to outline | P12 |
| GRAPH-6 | Turn into page or block | Later |
| GRAPH-7 | Populate from query or page | P15 |
| GRAPH-8 | Lanes and timelines by attribute | Parked |
| GRAPH-9 | Bulk attribute brush | Rejected |
| GRAPH-10 | Managed "Linked from this drawing" list | Later |
| GRAPH-11 | Two-way sync for single-text regions | Later |
| GRAPH-12 | Site-map heat overlay | P15 |
| GRAPH-13 | Connected margins | Parked |
| CMP-1 | Compass opens via RoamPlexus.open | P8 (QW) |
| CMP-2 | RoamPlexus.linksOf | P14 |
| CMP-3 | Related drawings | P14 |
| CMP-4 | Add related drawing from a zone | Later |
| CMP-5 | Snapshot neighbourhood into a drawing | Later |
| CMP-6 | RoamCompass API, "Show in Compass" | P14 |
| CMP-7 | Drawing centre: frames and regions | P14 |
| CMP-8 | Type chips and quick filter | Later |
| CMP-9 | Follow vs pinned | P14 |
| CMP-10 | Centre as live embed / sidecar pane | Parked |
| CMP-11 | Compass display settings | Later |
| CMP-12 | Two-level view | Rejected |
| CMP-13 | Cross-links among neighbours | Later |
| CMP-14 | Hover highlight, gated previews | Later |
| CMP-15 | Larger hover thumbnail | P14 |
| CMP-16 | Node styling by attribute | Parked |
| CMP-17 | Ghost pages and URL nodes | Later |
| CMP-18 | Relation editing from menus | Parked |
| CMP-19 | Home entries in empty search | Later |
| PRES-1 | Speaker notes from blocks | P11 |
| PRES-2 | Present from here | P11 (QW) |
| PRES-3 | Slide authoring | P16 |
| PRES-4 | Outline-driven deck | P11 |
| PRES-5 | Live-canvas slideshow | Later |
| PRES-6 | Laser and temporary pen | P11 (QW) |
| PRES-7 | Stepwise reveal | Later |
| PRES-8 | Presenter second window | Parked |
| PRES-9 | Slide timer and auto-advance | Parked |
| PRES-10 | Narrated walkthrough | Rejected |
| MM-1 | Drag to reparent and reorder | P12 |
| MM-2 | Mind-map keyboard extras | P12 |
| MM-3 | "+" buttons and collapse badge | Later |
| MM-4 | More layouts and a chooser | Later |
| MM-5 | Mind-map styling | Later |
| MM-6 | Conversions and bulk input | Later |
| MM-7 | Attribute blocks as labelled edges | P12 |
| MM-8 | Task nodes and tag colours | P12 |
| MM-9 | Cross-links from block refs | Later |
| MM-10 | Linked page import, submaps | Later |
| MM-11 | Cause-and-effect / RCA builder | P12 |
| MM-12 | Process flow / swimlane | P13 |
| EXP-1 | Copy crop as PNG/SVG | P7 (QW) |
| EXP-2 | Export dialog | Later |
| EXP-3 | Frames as PDF pages | P11 |
| EXP-4 | Scene JSON export/import | Later |
| EXP-5 | Paste canvas elements into a block | P11 |
| EXP-6 | Mermaid import/export | Later |
| EXP-7 | Chart from a table | Rejected |
| EXP-8 | PDF pages into the canvas | Rejected |
| EXP-9 | Auto-synced export image block | Later |
| API-1 | Builder helpers | P12 |
| API-2 | Event hooks, self-describing API | Later |
| API-3 | Agent surface, scene.describe() | P16 |
| API-4 | Script engine | Rejected |
| DATA-1 | Snapshots and restore | P12 |
| DATA-2 | Shrink guard, in-memory pre-write snapshot | P8 (QW) |
| DATA-3 | Flush writes on hide/unload | P8 (QW) |
| DATA-4 | Copy diagnostics | 0.16.0 |
| DATA-5 | View-state measurement and native-feature probe | P7 (QW) |
| DATA-6 | Edit-conflict guard | Parked |
| DATA-7 | Write-queue status chip | Later |
| UX-1 | Default hotkeys and hints | P9 (QW) |
| UX-2 | Context-only palette commands | Parked |
| UX-3 | Reduced motion | P8 |
| UX-4 | Accessible region refs | P7 |
| UX-5 | Canvas preferences | 0.16.0 |
| UX-6 | Per-drawing attributes | Later |
| UX-7 | Picker: natural dates, create page | P9 |
| UX-8 | Picker triggers | Later |
| UX-9 | Preferences bundle | Parked |
| UX-10 | Feedback polish | Later |
| UX-11 | Floating mini-toolbar | Parked |
| UX-12 | Expose hidden native actions | 0.16.0 |
| REV-1 | Comment pins | Later |
| REV-2 | Todo mode | P15 |
| REV-3 | Stamps and voting | Rejected |
| REV-4 | Tags on elements, tag filter | Later |
| PERF-1 | Touch and long-press parity | Parked |
| PERF-2 | Hot-path audit | 0.16.0 |
| OUT-1 | AI features in core | Rejected |
| OUT-2 | OCR | Rejected |
| OUT-3 | Live cursors and presence | Rejected |
| OUT-4 | Rich text inside notes | Rejected |
| OUT-5 | Shape generators | Rejected |
| OUT-6 | Thymer sync plumbing | Rejected |
| OUT-7 | Obsidian platform-only features | Rejected |
| OUT-8 | Arrow endpoints on groups | Rejected |
