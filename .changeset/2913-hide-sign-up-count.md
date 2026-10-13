---
"@ds/db": minor
"@ds/schemas": major
"@ds/api": major
"@ds/api-client": major
"@ds/events-storefront": major
"@ds/admin": minor
---

An event can hide its registrant count (007 EARS-12, 019 EARS-19, #2913). Migration `0048` adds `events.hide_sign_up_count boolean not null default false` (every existing event keeps showing its count). `CreateEvent` accepts `hideSignUpCount` (default `false`), `UpdateEvent` sets it only when the key is present, and `EventAdminDetail` returns its state — no admin read carries the count itself. While it is on, every public card read serves `signUpCount: null` and does not count the event at all: the Academy listing (`UpcomingBroadcastCardSchema`, upcoming and past, and the bare `/v1/public/events` read) and the doctor feed that the 018 nearest-events block also reads (`DoctorEventCardSchema`). Breaking: both `signUpCount` fields are now `number | null`; the `events-storefront` card model follows, and a `null` count hands the shared card no count line and no label.
