---
"@ds/schemas": patch
"@ds/api": minor
"@ds/api-client": minor
---

Events storefront wave 2 (#2028), the read contract of the one feed view on both hosts: `GET /v1/public/events?timeframe=…` accepts the horizon `from`/`to` of the one listing codec (the cursor stays for other callers and never combines with it) and echoes `horizon { from, to, nextTo }`; every Academy listing card carries its event `kind`, attendance `format` and the colleagues' `signUpCount`; the new `GET /v1/public/events/live` serves the Academy «Идёт сейчас», and `GET /v1/storefront/doctor/events/live` now returns a list of strips (`[]` when nothing is live) instead of one strip or `null` — both from one live resolution parameterised by audience.
