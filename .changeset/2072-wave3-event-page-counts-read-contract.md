---
"@ds/schemas": major
"@ds/api": minor
"@ds/api-client": minor
---

Event page wave 3 (#2072), the read contract of the social proof and the viewers count, on both hosts at once: `GET /v1/public/events/:idOrSlug` and `GET /v1/storefront/doctor/events/:idOrSlug` carry `signUps: { total, sameSpecialty, adjacentSpecialties } | null` and `viewers: number | null`. `signUps.total` is the same colleagues' count the feed and listing cards carry as `signUpCount`; `sameSpecialty` counts registrants whose profile specialty owns one of the event's directions and `adjacentSpecialties` those who reach one through the managed direction adjacency instead. `signUps` is `null` at zero colleague sign-ups and while the event's «Скрыть число записавшихся» option is on. `viewers` is the number of distinct doctors who were in the event's room, `null` unless the event has ended and that number is above zero. Both are the same for a guest and a signed-in reader.

**Breaking:**

- `@ds/schemas`: `EventPageViewSchema` (and `EventPageViewBaseSchema`) require `signUps` (`SignUpProofSchema`, whose `total` is positive) and `viewers` (a positive whole number); each is `null` when absent, never omitted.
