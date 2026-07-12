---
"@ds/api": minor
"@ds/schemas": minor
"@ds/db": minor
---

Display-name SSOT + self-scoped `SetDisplayName` endpoint (006 EARS-14/16, #705): the `users` mirror gains a nullable `display_name` column (no backfill), the SSOT for a doctor's «Имя и фамилия» collected just-in-time at first webinar-room entry — never at registration. A new `me` module serves two `authenticated` / `doctor_guest` / `fast-path` routes: `PUT /v1/me/display-name` (`SetDisplayName` — writes the trimmed, non-empty-after-trim, ≤100-char name via the `packages/schemas` `SetDisplayNameRequest` SSOT to the caller's OWN row) and `GET /v1/me/display-name` (the caller's own `{ displayName: string | null }`). Self-only by construction — no endpoint takes a target user id, so no caller reaches another doctor's name — and the display name never enters chat payloads (chat identity stays the non-PII author tag). New schema exports: `SetDisplayNameRequestSchema`, `MyDisplayNameSchema`, `DisplayNameSchema`.
