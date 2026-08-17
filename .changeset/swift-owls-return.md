---
"@ds/portal": patch
---

013 EARS-15 — post-login landing is the visitor's return target, `/webinars` by default. Fixes the live US-10 regression: `/` now serves the Academy landing instead of redirecting to the discovery listing, so a doctor completing login, registration or verification with no valid return target was stranded on marketing copy. A captured safe same-origin target still wins; a cross-origin or protocol-relative target is rejected in favour of the default.
