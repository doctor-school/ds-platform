---
"@ds/schemas": minor
"@ds/api": minor
"@ds/admin": minor
---

#3740 (049 EARS-3…EARS-5): «Доступы» belongs to the superadministrator. The three staff-access endpoints require `superadmin` (live revalidation, step-up unchanged); a platform administrator no longer sees the section and `/access` shows the refusal page. The grant form offers «Режиссёр трансляций» (`broadcast_director`, no event); `superadmin` is listed («Суперадминистратор») but refused `400` on grant and revoke. Each list row carries `revocable`, and «Отозвать» is drawn only on revocable rows; revoking `platform_admin` from a holder of `superadmin` is refused `409 STAFF_REVOKE_SUPERADMIN_HOLDER` with nothing changed.
