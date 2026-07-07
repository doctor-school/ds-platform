---
"@ds/schemas": minor
"@ds/api": minor
"@ds/portal": minor
---

feat(events): 004 EARS-1 — public event-page read endpoint + portal SSR shell

Adds the read side of the Webinars public surface: `GET /v1/public/events/:idOrSlug`
(NestJS, classified **public** in the endpoint-authz matrix — no auth, no cookie)
returning the publish-safe `PublicEventPage` projection (an allow-list — no
operator/commercial fields, no registrant PII), resolving by slug or id;
`published`/`live`/`ended`/`archived` → 200, `draft`/unknown → 404. Plus the
server-rendered portal `/webinars/:slug` route shell (complete HTML for an
unauthenticated recipient, no client soft-wall) and a shared МСК time formatter.
Read against seeded fixture events until feature 007 delivers authoring/transitions
(tracked seam, parent #549). Full content layout, CTA, listing, and lifecycle swap
are sibling handlers.
