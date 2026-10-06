---
"@ds/schemas": minor
"@ds/events-storefront": minor
"@ds/design-system": minor
"@ds/auth-flow": patch
"@ds/admin": patch
"@ds/api": patch
"@ds/portal": patch
"@ds/doctor": patch
---

One event-time formatter (004 EARS-12 as amended): `formatEventTime` in `@ds/schemas` presents an online/hybrid event in the viewer's zone and an offline one in Moscow, with an explicit «МСК» / «GMT±N[:MM]» label and grouping keys of the shown time; `@ds/events-storefront` re-exports it and adds `useViewerZone()` (`./ui`); the design system adds the `min-w-zone-label` token. Every former Moscow-time copy (portal, admin, auth-flow, doctor feed, event page, mailer) now delegates to it pinned to Moscow — output unchanged.
