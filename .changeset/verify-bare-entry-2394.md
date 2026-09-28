---
"@ds/auth-flow": patch
"@ds/portal": patch
---

003 EARS-40 (#2394): a `/verify` opened with no address — no `?email=` query and no `#email=` fragment — now replaces onto `/register`, carrying a same-origin `returnTo`, instead of rendering the step with «ваш аккаунт». The confirmation step always has an address, so the `fallbackDestination` / `missingIdentifier` copy and the address-less resend/submit branches are gone.
