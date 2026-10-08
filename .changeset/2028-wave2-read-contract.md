---
"@ds/schemas": major
"@ds/api": major
"@ds/api-client": major
---

Events storefront wave 2 (#2028), the read contract of the one feed view on both hosts: `GET /v1/public/events?timeframe=…` accepts the horizon `from`/`to` of the one listing codec and echoes `horizon { from, to, nextTo, nextFrom, remaining, nextBatch }`; a read stating neither a bound nor a cursor page (`cursor` / `limit`) is the horizon read of the tense's default extent, so the bare «Будущие» and «Прошедшие» reads offer «Показать ещё». The cursor page stays for a read that states `cursor` or `limit` and never combines with a horizon. Every Academy listing card carries its event `kind`, attendance `format` and the colleagues' `signUpCount`; the listing `counts` gain `upcomingSchools`, the distinct schools among the upcoming listing-eligible events («N эфиров · M школ»). The new `GET /v1/public/events/live` serves the Academy «Идёт сейчас» from the one live resolution the doctor host uses.

The doctor feed `GET /v1/storefront/doctor/events` selects each tense by lifecycle, as the Academy listing does: «Будущие» = published and live events, soonest first; «Прошедшие» = ended and archived events, newest first. Both feed reads carry `nextFrom` («Прошедшие» widens backward), `remaining` (the M of «Показать ещё N из M») and `nextBatch` (the N — the events the next widening step adds). A doctor feed card of an ended event carries the same 014 `recording` projection as the Academy past card, and the projection gains `durationSec`, the primary cut's length.

**Breaking:**

- `@ds/api` / `@ds/api-client`: `GET /v1/storefront/doctor/events/live` returns a list of strips (`[]` when nothing is live) instead of one strip or `null`; `GET /v1/storefront/doctor/events` no longer returns today's ended events under «Будущие» or today's not-yet-ended ones under «Прошедшие»; a bare `GET /v1/public/events?timeframe=…` returns the horizon page, not the first 20-card cursor page (send `limit` for a cursor page).
- `@ds/schemas`: `DoctorEventsLiveStripSchema`, `DoctorEventsLiveReadSchema`, the `DoctorEventsLive*` types and `DOCTOR_EVENTS_LIVE_REFRESH_SECONDS` are removed; `UpcomingBroadcastCardSchema` requires `kind`, `format` and `signUpCount`; `DoctorEventsFeedSchema` and the listing `horizon` require `nextBatch`; `RecordingProjectionSchema` requires `durationSec`; `PublicEventListingQuerySchema.limit` has no default.
