---
"@ds/db": major
"@ds/schemas": major
"@ds/api-client": major
"@ds/api": major
"@ds/admin": major
"@ds/portal": major
---

014 EARS-23…27 / #1741 (slice 1 of 3) — an эфир held BEFORE the platform existed
gets its own lifecycle, and the `MarkEventEnded` fork leaves feature 007's machine.

Breaking on the wire, in the SDK and in the database. `events.origin`
(`platform | legacy`, `@ds/db` migration 0035, NOT NULL, default `platform`) is a
server-assigned discriminator that picks the state machine and is rejected by
every update path; `event_lifecycle_state` gains `in_archive`, reachable only on
the legacy machine (`hidden ↔ in_archive`). Feature 007's machine loses its
`published → ended` edge and the `POST /v1/admin/events/:id/mark-ended` route
with it; `validTransitions(state)` / `canTransition(from, to)` become
origin-aware (`validTransitions(state, origin)`), so every caller passes the
machine explicitly. Three routes are added: `POST /v1/admin/legacy-broadcasts`
(create, born `hidden`, carrying its recording), `POST …/:id/archive-legacy`
(«Архивировать», requires a published non-retired recording — 409
`EVENT_NOT_FINISHED` otherwise) and `POST …/:id/hide-legacy` («Скрыть»). Every
broadcast command on a `legacy` event and every legacy command on a `platform`
event is refused 409 `INVALID_TRANSITION` with no mutation. Recording
publication is now gated per machine: `ended` on the platform machine as before,
either legacy state on the legacy one — an эфир that never passed through the
platform room can never be `ended`, and without this its recording could never be
published at all.

The archive projection is unchanged for readers: an `in_archive` legacy эфир is
the same `recorded` card a platform `ended` broadcast with a published recording
already was. `@ds/admin` loses the «Отметить завершённым» action, `@ds/portal`
renders `in_archive` exactly as `ended`; the full admin lifecycle bar and the
«Архивный эфир» creation form land in slices 2 and 3.
