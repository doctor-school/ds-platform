---
"@ds/auth-flow": minor
"@ds/doctor": minor
"@ds/e2e": minor
---

Entry into the specialty feed (018 entry, 017 EARS-1 / EARS-6 / EARS-7, 021 LD-4, #3674): a direct arrival with a remembered specialty lands on that specialty's feed `/feed/<code>` (the doctor host's `landing.specialtyFeed` is now the route template `/feed/:code`), and the home when nothing is chosen. Choosing a specialty in the home catalog opens its feed. The doctor header gains «Моя лента» → `/feed`, a server redirect to the remembered specialty's feed, or to the home specialty catalog (`/#specialties`) when none is chosen. `@ds/e2e`'s navigation model lets an item declare the pages its href redirects to (`landing.redirectsTo`), and the derived walk accepts only those, each with its own evidence (`landingEvidenceAt`, replacing `landingEvidence`).
