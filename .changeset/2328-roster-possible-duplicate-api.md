---
"@ds/schemas": minor
"@ds/api": minor
"@ds/api-client": minor
---

044 EARS-31 — every congress roster row (`GET /v1/admin/events/:idOrSlug/roster`) carries the EARS-30 `possibleDuplicate` marker, and the route takes `possibleDuplicate=yes|no` (absent = any, anything else 400) as one more conjunct composing with the search, the column filters, the sort and the page. The marker is derived over the whole event's participants before any filter applies, so the row, the filter and the participant card never disagree; a staff account's registration never marks a participant (#2456). `CongressRosterQuerySchema` / `CongressRosterRowSchema` declare it; the generated client carries it (#2328).
