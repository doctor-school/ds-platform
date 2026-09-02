---
"@ds/db": major
"@ds/schemas": major
"@ds/api-client": major
"@ds/api": major
"@ds/admin": major
"@ds/portal": major
---

007 EARS-28 / #1748 — the hidden broadcast state is renamed `archived` → `hidden`
(«Скрыт»), and its command `ArchiveEvent` → `HideEvent` («Скрыть»).

Breaking on the wire and in the SDK. The `event_lifecycle_state` enum's terminal
value is `hidden` (`@ds/db` migration 0033 relabels the Postgres enum in place,
so every existing row follows and nothing is rewritten); `EventLifecycleState`
and every schema deriving from it (`@ds/schemas`) speak `hidden`; the admin
transition route moves from `POST /v1/admin/events/:id/archive` to
`…/:id/hide` and the audit type from `event.archived` to `event.hidden`
(`@ds/api`), with `@ds/api-client` regenerated against it. `@ds/admin` shows the
status «Скрыт» and the action «Скрыть»; `@ds/portal` renders the hidden event's
notice as «Мероприятие скрыто». No dual-read shim and no compatibility alias —
the old value is gone.

The word «Архив» now denotes only the SHOWN recordings archive (014): the public
archive listing, its badge, «Мои события» and the `/webinars` past tab are
untouched.
