---
"@ds/portal": minor
---

feat(events): 004 EARS-5 — archived direct-link public «в архиве» notice (no CTA)

A previously-distributed direct link to an event that has since been `archived`
now degrades gracefully in place instead of dead-ending (feature 004, EARS-5;
realizes US-6, US-5; owner decision, variant «а»).

- `@ds/portal` — the public event page (`/webinars/:slug`) renders the archived
  «мероприятие в архиве» notice as the **fourth** render mode on the same
  `WebinarStatusCard` shell (beyond the canvas's `upcoming | live | ended`): a
  plain text notice replaces the status card's CTA column — **no** participation
  CTA, **no** dead link, **no** new geometry (design §5.1). The hero badge reads
  «В архиве» and the footer conversion band is absent. All copy resolves through
  the 003 message catalog (`statusCard.archived.*`, EARS-13); DS tokens only, the
  notice using the card-safe `text-primary-action` (blue.700) on `bg-card`
  (the #270 precedent), never `text-primary` (EARS-14).

The API side is unchanged: `GET /v1/public/events/:idOrSlug` already resolves an
`archived` event to a `200 PublicEventPage {state: archived}` (never a 404, never
a redirect) — the archived-link contract is now pinned by a dedicated Vitest e2e
(`archived.e2e-spec.ts`) and driven end-to-end on the live stand by the portal
Playwright coverage. Event authoring / lifecycle transitions remain feature 007
(a tracked seam, parent #549; archived events are seeded until 007 lands).
