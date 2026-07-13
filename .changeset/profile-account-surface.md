---
"@ds/schemas": minor
"@ds/api": minor
"@ds/portal": minor
---

feat: #770 account profile v1 — `GET /v1/me/profile` (EARS-27: session-scoped self-read of `{email, emailVerified, phone, phoneVerified, displayName}`, nullable-and-present wire shape) + the real `/account` profile surface (EARS-28: canvas «Разделы» render — avatar initials + inline display-name edit, email row with verified badge, read-only phone with explicit empty state, password-reset handoff, «Мои события» link, sign-out; raw session claims removed from the DOM)
