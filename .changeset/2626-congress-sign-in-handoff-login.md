---
"@ds/auth-flow": minor
"@ds/design-system": patch
"@ds/doctor": minor
"@ds/portal": minor
---

Congress sign-in hand-off on `/login` (003 EARS-44): `/login?method=code&handoff=<ref>` on both storefronts redeems the reference once per page load and opens straight on the code step «Мы отправили код на <address>»; a refused reference falls back to «По коду» with an empty field, a throttled one shows the usual «Слишком много попыток» line; `handoff` leaves the address bar by history replace in every case, and `/login` is served with `Referrer-Policy: no-referrer`. The sign-in code step no longer shows «Мы отправили новый код» on its first open under React StrictMode.
