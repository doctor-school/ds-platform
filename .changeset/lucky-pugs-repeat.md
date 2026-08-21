---
"@ds/db": minor
"@ds/api": patch
---

Retained-row lifecycle: `record_status`/`deleted_at` on events, event speakers, stream config, registrations and users, all cascade FKs turned RESTRICT, and the event-edit/seed write paths now retire and restore rows instead of deleting them.
