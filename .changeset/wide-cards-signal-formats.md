---
"@ds/design-system": minor
"@ds/schemas": minor
---

019 EARS-2 — widen the shared `WebinarCard` to the full doctor-feed format vocabulary. The one shared card now carries the five formats (webinar, online meeting, offline colleagues' meet-up, congress, podcast broadcast), each with its own glyph and surface so they are distinguishable without reading the text; the event kind and НМО as a badge only; the cost in Pul with a zero cost rendering «бесплатно для врача» and never a rouble string; the sign-up count in every card state; and, for an offline event, its city and remaining seats, with zero seats rendering «мест не осталось». `@ds/schemas` gains `DoctorEventFormatSchema` / `DoctorEventCardSchema` as the SoT of that vocabulary and of the card payload. All additive — existing 004/006/014 callers are unchanged.
