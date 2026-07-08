---
"@ds/schemas": minor
"@ds/api": minor
"@ds/portal": minor
---

feat(events): 005 EARS-6 — «мои события» Предстоящие tab + `MyEvents` read model

The portal account gains a «мои события» surface (the **Предстоящие** tab of
`my-events.dc.html`) listing the authenticated doctor's registered **upcoming**
events, closing the legacy "registered but can't find it" gap (feature 005,
EARS-6; realizes US-4). Carries the EARS-10 (authz), EARS-11 (МСК), EARS-13
(canvas fidelity) cross-cutting ACs.

- `@ds/schemas` — the `MyEventItem` / `MyEvents` DTOs: the caller's registered
  upcoming events, each `{ eventId, slug, title, school, startsAt, state }`,
  `state` constrained to the `published`/`live` registrable set.
- `@ds/api` — the `MyEvents` read model: `GET /v1/me/events`,
  **`doctor_guest`-authenticated** (EARS-10), returning the caller's registered
  `published`/`live` events (future or currently airing, `starts_at ≥ now −
AIR_WINDOW_MS` — mirroring the 004 upcoming listing), ordered **nearest
  `startsAt` first**. Returns ONLY the caller's own registrations; `ended`/
  `archived` and other doctors' registrations are absent. An empty result is a
  valid `[]`. The endpoint-authz matrix carries the new classified route.
- `@ds/portal` — the «мои события» page at `/account/events` (SSR, authenticated;
  a guest is redirected to login). Day-grouped, nearest-first, each row the
  reused `@ds/design-system` `WebinarCard` unit (built to the canvas geometry:
  2px borders, `6px 6px 0` shadow, time plate) linking to `/webinars/:slug`, with
  date/time in `Europe/Moscow` labeled **МСК** (EARS-11) and the canvas
  empty-state when the list is empty. Copy resolves through the message catalog
  (EARS-12); DS tokens only (EARS-13). Wave-1 cut: the Записи / Сертификаты tabs
  and the specialty filter are a named deferral — not built.
