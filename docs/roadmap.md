# Plexus roadmap: phase checklist

Source of truth for the phase loop. Specification: `docs/spec-plexus.md` (§7 feature list, §8 Compass contract, §10 phases, §13 measured Roam facts). Update this file at the end of every phase. Leave phase IDs unchanged. Do not mark a phase done until its gate passes.

Each phase runs in this order:
1. Write `docs/phaseN-contract.md`.
2. Run the build workflow: `sonnet-worker` implementers, review lenses, Opus verify per finding, fix.
3. Run live acceptance with trusted CDP input in the **Readwisenotes graph only**.
4. Fix what live acceptance finds.
5. `npm run check`.
6. Push `main` and wait for Pages.
7. `cmp` the published `extension.js` against the local build.
8. Write a KB session learning (`~/openkb-roam-plugin/raw/session-learnings`).
9. Update this file.

Standing constraints:
- No writes to the Svy graph without the user's explicit approval in that moment.
- Before any A/B test, unload the dev build from any window another session is using (see project memory).
- Re-list CDP targets and match windows by exact title or page uid.

| Phase | Scope | Gate | Status |
|---|---|---|---|
| P0 | Spikes S1-S6 (spec §4, §13) | Unknowns answered | done 2026-09-28 |
| P1 | Region refs `area` + `rect`, crop cache (hot SVG, cold settled PNG), click-to-zoom + spotlight, bottom toolbar | Live acceptance, typing +0, Pages | done 2026-09-28, 0.1.0 (`5c56d59`) |
| P2 | Kinds `group`, `frame`, `cframe`, `poly` (lasso); regions on plain `![](url)` images (child block of the image block, crop from Roam's decrypted `<img>`); Roam-link interception in drawings (`[[page]]` / `((uid))`, shift = sidebar) + hover preview; thumbnails (whole-drawing cache); `window.RoamPlexus` v1 (spec §8); Compass changes in `~/roam-compass` (spec §8 table) | Every kind round-trips and crops within 1 px; link click navigates in-app; Compass shows thumbnails and offers "New drawing"; both repos green and published | done 2026-09-28, Plexus 0.2.1 (`090cd51`), Compass 0.2.1 (`5276d4a`); live: 12/12 cold crops, links, image regions, Compass thumbnails |
| P3 | Read-only block embeds on the canvas (`renderString` overlay tracking pan/zoom); frames as slides (presentation mode, keyboard, Esc); crop-to-region from Excalidraw 0.18 native crop | Overlay tracks pan/zoom within one frame; 5-frame deck; no leaked listeners | done 2026-09-28, 0.3.1 (`c0f5294`); live: crop-aware 140x160, embed tracks scroll/zoom to 0.01 px, 5-frame deck order+keys, edit/time unchanged |
| P4 | Mind-map builder (Tab child, Enter sibling, Alt+arrows, fold, layouts, pin, boundary) with two-way sync against real Roam child blocks | Outline edit updates node after echo; node add creates block; no echo duplicates; 200-node relayout < 16 ms | done 2026-09-29, 0.4.0 (`0321e4c`); live: Tab/Enter/inline input, outline→node, fold=collapse, 5 layouts, native del restore, drag pins, Alt+Backspace x2, outline→map, 10-chain; 200 nodes: Plexus 6-10 ms + Excalidraw updateScene 22-31 ms |
| P5 | Legacy ExcalDATA migration (Svy has 9 legacy drawings; dry run lists them), automation API (`RoamPlexus.scene(uid)`), editable embeds via `renderBlock` (rules 13, 19) | Dry run writes nothing; **STOP: the user reviews the dry run before any apply on Svy** | done 2026-09-29, 0.5.0 (`cd6ca96`); live: synthetic legacy migrated, API v2, editable embed incl. `[[` menu + selection clear. Svy (user-approved 2026-09-29): 6/6 legacy drawings migrated (74 elements, element counts exact, legacy blocks byte-identical with unchanged edit time); 2 empty skipped; component block excluded |

Resolved defaults (spec §12):
- Text-element links do not get automatic region blocks; Roam's tail already makes them refs.
- A cold cache renders through a hidden `renderBlock` (1x); it is not shown as a chip.
- "New related drawing" from Compass creates the page `Drawings/<title>` with a drawing block.

Open items carried forward:
- 200-node relayout: the visible frame is about 35-40 ms, dominated by Excalidraw's `updateScene` of about 600 elements (Plexus's own work is under 10 ms).
- 1x cold crops may be revisited (user, 2026-09-28).
- Opening a drawing in the sidebar restores Roam's stored sidebar windows.
- Embed of a not-yet-existing `[[Title]]` page does not watch for the page to appear (needs a title-keyed watch; unmeasured).
- `createPlainImageRegion` targets image index 0 only (TODO in `src/actions.js`).
- Frame kinds: the hot SVG includes the frame label, and the cold crop now matches it (label top = frame.y - 20.5).
