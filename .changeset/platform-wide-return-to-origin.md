---
"@ds/portal": minor
"@ds/schemas": minor
---

Platform-wide post-login return-to-origin (014 EARS-6): a visitor who authenticates from a login-gated page is landed back on the page they were trying to consume — through registration, email verification and sign-in alike — and the target is consumed exactly once. Hostile targets (absolute, protocol-relative and backslash-escaped hosts) are dropped to the surface default landing rather than followed.
