---
"@ds/design-system": minor
"@ds/doctor": minor
"@ds/showcase": patch
---

021 EARS-10 — a confirmed doctor lands on the return target they came from, with the personal cabinet as the secondary action.

New shared block `RegistrationSuccessCard` (`@ds/design-system/blocks`, composed only from `AuthCard` / `Button` / `Alert`): the post-confirmation success screen with a promise/fact points line, an optional profile-motivation line, an optional degraded-landing reason row (`role="status"`) and a ranked primary/secondary action pair.

`apps/doctor` submits the emailed code to the single storefront command `POST /v1/storefront/doctor/confirm` (which verifies the code and decides the landing in one round trip) instead of the generic `/v1/auth/verify`, and replaces the confirm card with that block. The primary action is the server's `primaryAction.href` when the carried return target is still live or was degraded to the nearest honest destination (`ended` / `full` / `unpublished` / `missing`, each stated in RU above the actions); with nothing carried it is the LD-4 landing the register page computed from the specialty read. `/account` is always secondary, never the default. While the API returns `credited: null` the points line reads as the pending promise it is — no amount, no ledger link — and the profile-motivation line is absent until `profileCompletion` carries a string.
