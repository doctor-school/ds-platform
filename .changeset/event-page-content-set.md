---
"@ds/design-system": minor
"@ds/portal": minor
---

feat(events): 004 EARS-2 — event-page content set from PublicEventPage projection

Builds the public event page's complete decision set (feature 004, EARS-2;
carries EARS-12/13/14 on the surface), laid out to `webinar-page.dc.html`.

- `@ds/design-system` — new `WebinarPageContent` primitive
  (`@ds/design-system/webinar-page-content`): the two-column event-page body —
  the «О чём эфир» description, the downloadable program-PDF affordance, the
  sponsor plate (backing partners), and the «Спикеры» aside cards (64px tint
  initials square, name + credentials). The program affordance and the sponsor
  plate are omitted (not null-broken) when absent. Off-scale canvas geometry (the
  `1fr 380px` split, the 64px avatar) lives in the design-system SoT — the
  app-scoped arbitrary-value gate forbids it in `apps/*`; colour + type flow
  through tokens, both themes, desktop grid / mobile stacked per the canvas.
- `@ds/portal` — the `/webinars/:slug` event page now renders the target
  specialty chips in the poster header and the full content set below it via
  `WebinarPageContent` (МСК times, no local drift; RU copy via the 003 message
  catalog).
