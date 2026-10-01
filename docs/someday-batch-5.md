# Batch 5 (0.20.0)

Empty `[[` is a hint. No closer. Selection dies on the first `[`. Semantic flag false. No chip.

UX-8. `[[` and `((` insert the closer, caret inside. Page pick writes `[words]([[Title]])`. Empty `[[`: 12 pages by `:edit/time`, cache 10 s. Bare `#`: referenced pages, cap 12. Empty hash: 12 recent. `#` inside `[[` or `((` stays that query. Hash pick: `#[[Title]]`. Page sup: ref count. Related only if semanticSearchEnabled() is true, after 150 ms.

DATA-7. "Outline update pending" after 2.5 s in queue. "Could not update the outline" on reject or ok false, until success. Hide when idle. No second save UI.

Palette two. List 53.
