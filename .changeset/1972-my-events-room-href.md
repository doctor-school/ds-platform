---
"@ds/api": minor
"@ds/schemas": minor
"@ds/api-client": minor
---

«Мои события» on both hosts (#1972): every `MyEventItem` now carries `roomHref` — the calling host's room path for a registered row on a live event, otherwise `null` — and `participationFormat`, the event's attendance mode. `GET /v1/me/events` resolves the Academy room (`/webinars/<slug>/room`); the new `GET /v1/storefront/doctor/me/events` serves the same read for the doctor storefront (`/events/<slug>/room`), with the same `doctor_guest` posture.
