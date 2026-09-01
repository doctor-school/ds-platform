---
"@ds/design-system": minor
"@ds/schemas": minor
---

019 EARS-2 — widen the shared `WebinarCard` to the full doctor-feed vocabulary, built strictly to the approved canvas (`design-source/doctor-events.dc.html`). The format/kind reads from the time-plate kicker («Вебинар», «Разбор», «Doctor Club», «Подкаст», «Конгресс»), and the card's ONE chip row carries the venue with the offline city, НМО, the cost in Pul (a zero cost renders «бесплатно для врача», never a rouble string), the sign-up count in every card state, and the remaining seats — zero seats re-wording that chip to «мест не осталось». A congress date span rides the time-plate sub-label. The format is pure catalog copy, so the primitive holds no format union and takes no dependency on the read contract; `@ds/schemas` gains `DoctorEventFormatSchema` / `DoctorEventCardSchema` as the SoT of that vocabulary and of the card payload. All additive — existing 004/006/014 callers are unchanged.
