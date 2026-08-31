---
"@ds/design-system": minor
"@ds/portal": minor
"@ds/showcase": minor
---

Give cursor-paged feeds an honest paging control. `<Pagination>` gains an additive `mode="cursor"` shape — «Назад» / current page / «Вперёд», rendered only where a page actually exists — alongside the unchanged default numbered mode, and `<EventList>` passes it through (`paginationMode="cursor"` with `hasPrevious` / `hasNext`). The portal's webinar archive, a cursor feed with no knowable total, stops fabricating a page count and rendering page numbers that did nothing when clicked; its `?cursorTrail=` is now a bounded window of the cursors «Назад» can use instead of growing with every page forward.
