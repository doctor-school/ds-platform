---
"@ds/design-system": minor
"@ds/portal": patch
"@ds/doctor": patch
---

021 EARS-15 — the doctor storefront signs the doctor in after email confirmation.

The in-flight held-password slot moves out of `apps/portal/lib/` into
`@ds/design-system/blocks` (`pending-registration.ts`), so both storefronts run
ONE post-confirmation sign-in mechanism (003 EARS-39). The doctor host holds the
password after `registerDoctor` succeeds and replays the real 003 EARS-5 login
after `confirmDoctorEmail` succeeds. The Academy's rule is copied whole, not
half: the success state exists ONLY for a doctor who is signed in, and a
confirmation with no held credential or a replay the login refuses routes to
`/login?returnTo=…` carrying the return context instead. The Academy behaviour
is unchanged and only its import path moved.
