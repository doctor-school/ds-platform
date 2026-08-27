---
"@ds/schemas": minor
"@ds/api": minor
"@ds/admin": minor
---

Curated event↔topic relationships (012 EARS-11). An event is filed under topics the catalogue already holds — the new «Темы» tab on the event detail links, retires and restores them through the §3.1 preview→confirm gate, with no inline topic creation and no delete. The admin surface is served by `/v1/admin/event-topics` (list filtered by either endpoint, create, transition-specific lifecycle-impact/retire/restore) and the public reads by `/v1/public/events/:idOrSlug/topics` and `/v1/public/topics/:idOrSlug/events`. The event's own `specialties[]` free-text axis is left untouched by every one of these paths.
