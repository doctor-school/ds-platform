---
"@ds/portal": minor
---

#1640: the public `/webinars` listing no longer 500s on a malformed `?cursor=`.
A cursor the api rejects (the published `CURSOR_INVALID` code) is treated as "start
from the first page" instead of throwing, via the new `InvalidEventCursorError` /
`fetchEventListingWithCursorFallback` exports in `apps/portal/lib/public-events.ts`.
The listing then redirects to the canonical `/webinars` URL, so `cursor`,
`cursorTrail` and `page` all clear together and the visitor is left on a clean,
shareable link rather than a stale deep link.
