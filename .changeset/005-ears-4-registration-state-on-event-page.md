---
"@ds/portal": minor
---

feat(events): 005 EARS-4 — per-user EventRegistrationState on the event page (no public-page contamination)

The webinar event page now reflects the **authenticated** doctor's true
registration state (feature 005, EARS-4; realizes US-3). A registered doctor sees
a «вы записаны» confirmation + a join-signpost placeholder **replacing** the
register CTA — never the «Участвовать» CTA as if unregistered; an unregistered
doctor (and a guest) sees the shipped 004 register CTA unchanged.

- `@ds/portal` — the SSR `/webinars/:slug` route composes the per-user state onto
  the 004 page via a **separate authenticated read** (`lib/registration-state` →
  `GET /v1/events/:idOrSlug/registration`), forwarding the request's session
  cookie **and** its fingerprint surface (`user-agent` + `accept-language`, the
  ADR-0001 §6 session binding) so the api resolves the `__Host-` session
  server-side. It is `cache: "no-store"` and never folded into the public
  `GetPublicEventPage` projection or its shared data cache — 004's public page
  stays byte-for-byte content-identical for guest and principal (a guest never
  issues the read). The registered swap replaces only the `register` CTA
  (upcoming), suppressing the footer «Записаться» band too; the `live` room route
  and `ended`/`archived` renders are untouched (the registered `live` onward path
  is EARS-5, #569).

The full join-signposting content is EARS-5 (#569); the live browser E2E for the
end-to-end registered journey is batched at the 005 portal-integration slice
(#574). Verified live on the dev stand (registered doctor: confirmation + no
register CTA; guest: 004 register CTA + public page uncontaminated).
