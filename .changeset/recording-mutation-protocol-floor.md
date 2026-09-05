---
"@ds/api": patch
---

`POST /v1/admin/legacy-broadcasts` now requires a canonical `Idempotency-Key` (014 EARS-17.1): a retried create replays the original 201 instead of authoring a second эфир
