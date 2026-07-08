---
"@ds/portal": minor
---

005 portal integration + browser-E2E slice (#574). User-facing: a logged-in
doctor now registers for a webinar in ONE action on the event page — the
«Участвовать» CTA becomes a one-tap command that records the registration and
swaps the page to the registered state, instead of routing an already-authenticated
doctor through the guest signup flow (EARS-1). Ships with the all-states
registration JOURNEY translated to `playwright-bdd` (guest → «Участвовать» → 003
auth → returns registered → «мои события» → back to the event page, plus logged-in
one-tap and ended/archived gating — the requirements Verification `all` row), the
surface-wide cross-cutting assertions (EARS-10 `doctor_guest` authz, EARS-11 МСК
no-drift under a non-Moscow browser timezone, EARS-12 no-hardcoded-strings), and an
axe-core WCAG 2 A/AA scan of the touched webinar surfaces.
