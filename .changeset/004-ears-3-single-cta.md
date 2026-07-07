---
"@ds/portal": minor
---

feat(events): 004 EARS-3 — single «Участвовать» CTA + event-context handoff to 005/003

The public event page (`/webinars/:slug`) now carries exactly **one** primary
«Участвовать» CTA that routes the visitor into the registration flow (feature 005) through auth (feature 003), carrying the event context so it survives the
round-trip (feature 004, EARS-3; realizes US-3).

- `@ds/portal` — the CTA is the adopted `@ds/design-system` `Button` (filled
  blue.700 primary action, #270) linking to a same-origin registration href
  (`lib/registration-handoff`): `/register?returnTo=/webinars/:slug`. The event
  context rides as a **safe, same-origin** `returnTo` (no PII, no credential, no
  open-redirect — the slug is escaped and always anchored under `/webinars/`),
  matching the intent contract 005's design pins (§3.2). The CTA is present for a
  participable event (`published` / `live`) and **absent** for `ended` (never a
  dead link, EARS-3 invariant). Copy resolves through the 003 message catalog
  (EARS-13); DS tokens only (EARS-14).

004 owns the CTA and the context handoff only — the registration mechanics and
the guest→auth→registered round-trip are owned by 005/003 (a tracked seam, parent
#549; the handoff target is stubbed in 004's E2E). The full per-state affordance
swap (badge / time plate / room-routing / footer band) is EARS-4; the archived
notice EARS-5.
