---
"@ds/schemas": minor
"@ds/api": minor
---

Add the public month-calendar read side for the webinar listing (004 EARS-15/EARS-16): `GET /v1/public/events?month=YYYY-MM` returns the month's publish-visible events (`published`/`live`/`ended`, the month's already-past events included) as the thin publish-safe `MonthBroadcastEntry` allow-list, and `GET /v1/public/events/month-counts?year=YYYY` returns exactly 12 per-month event counts for the picker. Both endpoints are public (no auth), cacheable, and group by МСК (fixed UTC+3) month boundaries. Adds the `MonthBroadcastEntry` / `MonthlyEventCount` projections plus the `mskMonthRange` / `mskYearRange` SSOT helpers to `@ds/schemas`.
