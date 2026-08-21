---
"@ds/db": minor
"@ds/schemas": minor
"@ds/api": minor
"@ds/admin": minor
---

012 EARS-7 — explicit expert-to-legacy-speaker matching (#1289)

Additive across four packages, no breaking change to an existing export; the
slice binds the taxonomy `experts` entity to the legacy `event_speakers` rows an
event already carries, so an event's line-up stops being two disconnected lists.

- `@ds/db`: the `event_experts` link table with the `relationship_status`
  (`active|retired`) enum, the composite FK that keeps a matched legacy speaker
  inside its own event, the eligibility-blind partial unique index that reserves
  one `(event_id, position)` slot per active link, and the `event_experts_audit`
  mirror. Rider: nullable `event_speakers.content_removed_at` (additive, no
  backfill).
- `@ds/schemas`: the link DTOs — create/update/list/detail with `role` 1–80
  trimmed, `position` 0–32767 and a nullable `legacySpeakerId`.
- `@ds/api`: `GET/POST /v1/admin/event-experts`, `GET/PATCH
/v1/admin/event-experts/:id` and the `retire`/`restore` transitions — fenced
  idempotency, weak-ETag `If-Match` concurrency, the §2.3 lock protocol over the
  candidate link set, RFC 7807 problems and audit writes. An occupied slot now
  answers 409 `SPEAKER_POSITION_OCCUPIED` on both the application pre-check and
  the constraint edge, never an unclassified 500.
- `@ds/admin`: the «Эксперты» tab on the event card — link an expert with a role
  and a running-order position, point the link at a legacy speaker, and see
  matched/unmatched at a glance; retire hides a link from the line-up without
  deleting it, restore brings it back.
