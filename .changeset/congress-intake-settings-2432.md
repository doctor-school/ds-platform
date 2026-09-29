---
"@ds/api": minor
"@ds/db": minor
"@ds/schemas": minor
"@ds/api-client": minor
---

A platform administrator can read and save the congress intake settings of an
event (046 EARS-1…EARS-3, #2432, backend layer). New routes
`GET` / `PUT /v1/admin/events/:id/congress-intake-settings` (`platform_admin`,
fast-path; the `PUT` revalidates live): per event the registration address, the
first-author rule; per kind (`oral`, `poster`,
`abstract`) the opening day, the last day, the submit limit and the age limit.
Days are Moscow calendar days, stored as 00:00 Moscow of the opening day and of
the day after each last day. An event without settings reads
`configured: false` with the product defaults. An opening without a last day, a
last day before the opening, a limit below 1 and an age limit outside 18…99 are 400. Migration 0042 adds the audited `congress_submission_settings` and
`congress_submission_kind_settings` tables. `@ds/schemas` exports the
`CongressIntakeSettings*` contract, the Moscow day↔instant helpers,
`isCongressKindIntakeOpen`; `@ds/api-client` is
the regenerated SDK.
