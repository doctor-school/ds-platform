---
"@ds/design-system": minor
"@ds/portal": patch
---

Add the `LoginCard` block to `@ds/design-system/blocks` — the whole sign-in
composition (AuthCard frame, password / one-time-code tabs, both forms, and the
code-entry stage on `OtpFocusScreen`) as one canonical unit both storefronts
project. The portal `/login` page becomes a thin projection that supplies copy,
resolvers, transport and routing; no visible change.
