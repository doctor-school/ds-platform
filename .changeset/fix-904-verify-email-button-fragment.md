---
"@ds/api": patch
"@ds/portal": patch
---

Fix the verification email's CTA dead-end (#904): the button now points at `/verify#email=<address>` — the identifier rides the URL fragment (never sent to the server, so the #869 mail-scanner-prefetch invariant holds), so a cold email-button open seeds the account and the code submits. The portal `/verify` screen now seeds the email from the fragment (query `?email=` kept as a same-tab/backward-compat fallback) and a validation-blocked submit (e.g. no identifier) surfaces a visible localized error instead of a silent no-op.
