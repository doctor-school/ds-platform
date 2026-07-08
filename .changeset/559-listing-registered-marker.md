---
"@ds/design-system": minor
"@ds/portal": minor
---

004 portal integration + browser-E2E slice (#559). User-facing: the `/webinars`
listing card of an event the viewer is REGISTERED for now carries the canvas
`registered` variant's «Вы записаны» marker (owner decision on the #559 Stage-B
gate) — composed in the portal layer from the viewer's own 005 `MyEvents` read,
so the public listing projection stays publish-safe (EARS-10) and a guest's
render is unchanged. `WebinarCard` gains the additive `registered` /
`registeredLabel` props (AA remap per the #270 precedent: ink label + a
success-hued decorative ✓ — canvas green.500 is sub-AA on the light card).
Ships with the 004 all-states DISCOVERY journey translated to `playwright-bdd`
(sponsor direct link → read page → open listing → click card → back, across
upcoming/live/ended/archived — the requirements Verification `all` row), the
surface-wide cross-cutting assertions (EARS-11 empty-state on the real route,
EARS-12 МСК no-drift under a non-Moscow browser timezone, EARS-13
no-hardcoded-strings), and a guest-only axe-core WCAG 2 A/AA scan of the public
webinar surfaces.
