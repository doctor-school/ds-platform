---
"@ds/admin": minor
---

The congress roster gains the attendance mark per congress day (#2381, 044
EARS-34). A new last column «Присутствие» carries one checkbox per congress day
(«23.04», «24.04»): a click marks or clears the participant's presence at once
through `PUT /v1/admin/events/:idOrSlug/registrations/:registrationId/attendance/:day`,
the box is disabled while the write is in flight, and a refused write reverts
the box and says why (withdrawn grant — never retried; outage — retry; other).
The filter bar gains a day select and a presence select («Все» /
«Присутствовал» / «Не отмечен») sent to the roster GET as `attendanceDay` /
`present`, composing with search and paging.
