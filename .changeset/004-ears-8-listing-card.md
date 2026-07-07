---
"@ds/design-system": minor
"@ds/portal": minor
---

feat(events): 004 EARS-8 — full webinar-card listing unit + event-page link

Replaces the wave-1 minimal listing card with the full `webinar-card.dc.html`
unit and links each card to its event page (feature 004, EARS-8; carries
EARS-12/13/14 on the card).

- `@ds/design-system` — new `WebinarCard` listing primitive
  (`@ds/design-system/webinar-card`): the tinted 196px time plate (56px display
  time, explicit МСК label, day·weekday sub-label), school kicker, title,
  specialty chips, and speakers, rendered as a single block-level link. Off-scale
  canvas geometry lives in the design-system SoT (the app-scoped arbitrary-value +
  rhythm gates forbid it in `apps/*`); colour + type flow through tokens, both
  themes, desktop grid / mobile flat full-bleed per the canvas.
- `@ds/portal` — the `/webinars` listing now renders each card as the `WebinarCard`
  unit (МСК times, no local drift; RU copy via the message catalog), each linking
  to `/webinars/:slug`.
