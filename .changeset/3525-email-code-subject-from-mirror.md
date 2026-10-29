---
"@ds/api": patch
---

A correct email code entered right after sign-up is no longer refused (003 EARS-41, #3525). The email-code paths (code submission, resend, login-code and reset requests) resolve their subject from the `users` mirror, written synchronously at registration, and read it from Zitadel by id (`GET /v2/users/{id}`); the eventually consistent Zitadel user search answers only a mirror miss. Every miss and fault stays the one generic failure (EARS-16).
