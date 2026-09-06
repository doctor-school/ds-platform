---
"@ds/design-system": minor
"@ds/portal": patch
"@ds/doctor": minor
---

Bot protection is one implementation for both storefronts (021 EARS-19). The
SmartCaptcha adapter, the resume-one-action orchestration and the error
predicates move out of `apps/portal/components/bot-protection/` into
`@ds/design-system/blocks`, app-agnostic: the site key is a prop, the failure
copy is the host's, and the predicates read the stable `@ds/schemas` code off
any error shape instead of a portal-local class. The Academy pages become thin
projections with no behaviour change.

The doctor registration door is wired: the submit runs the invisible challenge
and sends the real `RegisterDoctor` command with the minted token on the
`x-smartcaptcha-token` header, so the «Защита от ботов подключается» reason is
gone and the button is live once both access conditions are granted. A
challenge failure is stated at form level, never on a field. A successful
submission opens the shared `EmailConfirmCard` confirmation state, whose code
confirm and captcha-protected resend run against the shipped 003 routes.
