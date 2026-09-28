---
"@ds/api": minor
"@ds/db": minor
"@ds/schemas": minor
"@ds/api-client": minor
---

A congress registrar can mark a participant present per congress day (044
EARS-34, #2381, backend layer). New route
`PUT /v1/admin/events/:idOrSlug/registrations/:registrationId/attendance/:day`
with body `{ present: boolean }` (`check: policy`, bound to the registrar's event
per EARS-38, live revalidation): an idempotent mark/clear whose no-op writes no
ledger row; a day outside the new REQUIRED `CONGRESS_SIGNUP_EVENT_DAYS` setting is
422 `CONGRESS_DAY_UNKNOWN`. Migration 0041 adds the audited
`registration_attendance(registration_id, day, present)` table (no author/time
columns — the 010 ledger holds who and when). The roster read gains
`congressDays`, per-row `attendance`, and the `attendanceDay` + `present`
(`marked` | `unmarked`) filter. `@ds/db` exports `registrationAttendance`;
`@ds/schemas` exports the `CongressAttendance*` schemas; `@ds/api-client` is the
regenerated SDK.
