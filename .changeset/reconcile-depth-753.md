---
"@ds/api": minor
"@ds/db": minor
---

Reconcile depth (EARS-19, #753): the mirror-sync sweep now closes the full reconciliation depth deferred by 003. It resolves mirror-vs-Zitadel divergence **Zitadel-wins** on the identity fields (`email`/`phone`/`email_verified`/`phone_verified`) while preserving the mirror-owned `role`/`id`/`created_at`, and emits an `auth.reconcile.divergence` audit event naming only the changed field names (never the values). Users removed or deactivated in Zitadel have their mirror row **soft-deleted** (new nullable `users.deactivated_at`; rows are never hard-deleted so the audit trail survives) and are not re-granted `doctor_guest`; a user that reappears active is reactivated. `deactivated_at` is a projection flag, not an authz gate. The real `listUsers()` adapter now paginates in full and throws on failure so a partial/failed enumeration can never wipe the mirror.
