---
"@ds/api": patch
---

Fix #709: an IdP-authenticated session whose `zitadel_sub` had no `users` mirror row (webhook miss/lag, or a mirror row lost while the IdP session stayed alive) bounced every mirror-backed authenticated surface into a silent `/login` → `/account` redirect carousel via the generic 401. The session auth hook now lazily self-heals the mirror on an authenticated read (EARS-26): a targeted `IdpClient.getUser(sub)` fetch + the same idempotent `UserMirrorService.upsert` and `doctor_guest` re-grant the Zitadel webhook and reconciliation sweep perform, before the handler runs. EARS-16 generic-401 semantics for genuinely unauthenticated callers are unchanged.
