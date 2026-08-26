---
"@ds/doctor": minor
---

017 EARS-2 — the doctor storefront home page gains its hero: the kicker, the
headline, the sub-line stating that learning is free for the doctor, and the
evolutionary goal rendered verbatim with no gloss and no readiness marker. Copy
is transcribed from the vendored canvas, not written for the page.

Beneath it the four scale counters — doctors, specialties, lessons and events per
year — render from ONE computed read (`GET /v1/public/statistics`, LD-3), with
all four states of the design's `dataState` matrix real: counters, a skeleton
while the read is in flight, a counter whose source is unavailable OMITTED with
its neighbours still rendering, and — when the read fails — the counters gone
with the hero copy untouched. No zero ever stands in for a missing figure.

The page states nothing about who finances a doctor's learning, and carries no
price, cart, subscription or payment affordance.
