---
"@ds/portal": minor
---

#1640: the public `/webinars` listing no longer 500s on a malformed `?cursor=`.
A cursor the api cannot decode is treated as "start from the first page" (the page
counter and the pagination links reset with it) instead of throwing, via the new
`InvalidEventCursorError` / `fetchEventListingWithCursorFallback` exports in
`apps/portal/lib/public-events.ts`.
