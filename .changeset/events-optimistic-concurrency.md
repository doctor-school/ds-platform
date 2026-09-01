---
"@ds/api": major
"@ds/schemas": major
"@ds/db": minor
"@ds/admin": minor
---

007/014 — optimistic concurrency on admin event writes: `events.version` + `ETag` / `If-Match`

The six admin state-changing commands (`publish`, `open`, `close`, `archive`, `mark-ended`, bare `transition`) now REQUIRE an `If-Match` validator. A request without one is refused `428 PRECONDITION_REQUIRED`; an unparseable or stale validator is refused `412 PRECONDITION_FAILED`. Every admin event read/write that returns a detail (`create`, `detail`, `PATCH`, `PUT :id/stream`, all six transitions) emits `ETag: W/"<version>"`, and the detail body carries `version`.

Bump rationale (`repo-conventions.md` → Bump letter, "unsure → major"): `@ds/api` **major** — an existing successful call becomes a `428` for any client that does not send the header, and `412` is a new consumer-visible refusal on endpoints that previously had neither; that is a changed request contract, not an additive one. `@ds/schemas` **major** — `EventAdminDetailSchema` gains a required `version` field, so any producer of that shape must now supply it. `@ds/db` **minor** — `events.version integer not null default 1` is purely additive (migration `0031_events_version`), no existing column changed. `@ds/admin` **minor** — the lifecycle action bar now sends the rendered version as the validator; behaviour of the operator surface is unchanged when nobody else is editing.
