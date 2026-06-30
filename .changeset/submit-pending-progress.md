---
"@ds/design-system": minor
"@ds/portal": minor
---

Submit/pending progress visualization across the auth surfaces (#337). Every async
submit now drives the shared `Button.loading` affordance from its in-flight flag
(`loading={isSubmitting}`) instead of a static `disabled={isSubmitting}` — a
determinate spinner + `aria-busy` + disabled-while-loading, so the surface reads as
"working" instead of appearing to hang (the #333 Stage-B owner finding). Covers
login (password + OTP request), register, reset (request + complete), verify, and the
shared `<OtpFocusScreen>` block. `prefers-reduced-motion` and the double-submit guard
are already satisfied by `Button.loading`. The standard is documented in ADR-0013 §7
and enforced by a new `submit-pending` lint guard (WARN).
