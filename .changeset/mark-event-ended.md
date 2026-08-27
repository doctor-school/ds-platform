---
"@ds/schemas": minor
"@ds/api": minor
"@ds/admin": minor
---

014 EARS-18 — `MarkEventEnded`: a `platform_admin` can move a published event straight to `ended` when the эфир happened off the platform, without opening a room. New `POST /v1/admin/events/:id/mark-ended` (Idempotency-Key required; refuses with `EVENT_NOT_PAST` when the scheduled end is still ahead and `INVALID_TRANSITION` from any other origin or once a room was ever opened), the `published → ended` edge in the `LIFECYCLE_TRANSITIONS` SSOT, and the admin action «Отметить завершённым (трансляция прошла вне платформы)» — offered only when the server's `validTransitions` carries the edge. The lifecycle action table is now keyed on the `(origin, target)` pair, so `live → ended` keeps firing `close` while `published → ended` fires the new command.
