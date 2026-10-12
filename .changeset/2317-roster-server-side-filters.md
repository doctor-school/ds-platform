---
"@ds/schemas": minor
"@ds/api": minor
"@ds/api-client": minor
---

044 EARS-23 — the congress roster route (`GET /v1/admin/events/:idOrSlug/roster`) takes server-side per-column filters, each composable with the search, the presence filter, the sort and the page: `name`, `workplace`, `email` (case-insensitive contains), `phone` (contains on digits against the normalised number, `8 …` finds `+7 …`), `city` and `region` (case-insensitive equality with the directory value), `specialtyId` (directory id), `mailStatus` (`sent` / `failed` / `none`) and `registeredFrom` / `registeredTo` (inclusive Moscow calendar days). `CongressRosterQuerySchema` declares them; the generated client carries them (#2317).
