---
"@ds/schemas": minor
"@ds/api": minor
"@ds/portal": minor
---

feat(events): 004 EARS-7 — upcoming-broadcasts listing endpoint + day-grouped portal route

Adds the listing side of the Webinars public surface: `GET /v1/public/events?upcoming`
(NestJS, classified **public** in the endpoint-authz matrix — no auth, no cookie)
returning the thin publish-safe `UpcomingBroadcastCard[]` projection (an allow-list —
name-only speakers, no operator/commercial fields, no registrant PII) filtered to
`published`/`live` events at or after the air-window cutoff, ordered nearest air date
first; an empty result is a valid `200 []` (EARS-11). Plus the server-rendered portal
`/webinars` route — a day-grouped nearest-first list built to the §09 canvas rhythm
(full-bleed day band on mobile, label + rule on desktop) with the canvas empty-state
when the projection is empty. Wave-1 minimal cut — no facets, week-paging, month view,
or search. Cards are the minimal shell (time · МСК · live signal · school · title,
linking to the event page); the full webinar-card choose-set is sibling EARS-8 (#557).
Read against seeded fixture events until feature 007 delivers authoring/transitions
(tracked seam, parent #549).
