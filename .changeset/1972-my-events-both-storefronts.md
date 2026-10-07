---
"@ds/events-storefront": minor
"@ds/schemas": minor
"@ds/auth-flow": patch
"@ds/portal": minor
"@ds/doctor": minor
---

«Мои события» on both storefronts (#1972): the page moves into `@ds/events-storefront` (`./my-events`, `MyEventsRoute`) with its row→card projection and copy, and both hosts mount it — the Academy at `/account/events` as before, the doctor storefront at its new `/account/events`, linked from the `/account` hub. Online and hybrid rows now show the viewer's time zone with an explicit label after hydration; offline rows stay МСК. The guest door carry `withReturnTarget` moves into `@ds/schemas` (`@ds/auth-flow` uses it from there).
