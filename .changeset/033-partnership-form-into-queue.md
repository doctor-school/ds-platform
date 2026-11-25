---
"@ds/portal": minor
"@ds/e2e": patch
---

033 EARS-18: the Academy home's partnership form posts into the application queue (`POST /v1/public/applications/partnership`) with an idempotency key per attempt and the invisible SmartCaptcha token; the portal no longer writes the interim file store. The stage observer reads the queue row instead of a portal file.
