# `staff-access` — feature 047 «Доступы» (staff roles)

Spec: [`specs/features/047-staff-access`](../../../docs/content/specs/features/047-staff-access/047-design.md) · ADR-0001 (authz, §10 step-up).

The module owns the `platform_admin` surface that lists and grants the staff roles of `GRANTABLE_STAFF_ROLES` (`@ds/schemas`): `platform_admin`, `event-registrar` and `congress-program-committee`. A grant spans the IdP, Postgres and the ledger, so it is a fixed sequence of idempotent steps (047-design §Completeness and retry, §Grant cascade); the `auth.role.granted` row is the completion mark.

## What is here

| File                               | Role                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `staff-access.admin.controller.ts` | `GET /v1/admin/staff-access` (EARS-1/2) and `POST /v1/admin/staff-access/grants` (EARS-3…6, 9; `stepUp: true`, `no-store`). Exports the Zod DTOs `StaffAccessGrantRequestDto`, `StaffAccessGrantResponseDto`, `StaffAccessListResponseDto`.                                                                               |
| `staff-access.service.ts`          | `StaffAccessService` — the list projection and the grant cascade. `StaffAccessRefusal` carries the EARS-3 `errorCode`s (`EVENT_NOT_FOUND` 422, `REGISTRAR_BOUND_ELSEWHERE` / `GRANT_ALREADY_COMPLETE` / `STAFF_GRANT_EMAIL_UNVERIFIED` 409); an existing account whose email is not verified is refused before any write. |
| `staff-access.repository.ts`       | `StaffAccessRepository` — mirror, event binding and audit reads; `withGrantLock` runs a grant under a per-email `pg_advisory_xact_lock`; `commitGrant` writes mirror, binding and the completion mark in one transaction, relying on the `event_role_grants` unique indexes (`isRegistrarBindingConflict`).               |
| `temporary-password.ts`            | `generateTemporaryPassword` (EARS-6): 16 characters, unambiguous alphabet, from `crypto.randomInt`. The password lives in the request scope and the `201` body only.                                                                                                                                                      |
| `staff-access.module.ts`           | `StaffAccessModule` — imports the IdP port; Postgres comes through the global `DRIZZLE_DB`.                                                                                                                                                                                                                               |

The step-up re-verification the grant relies on (`POST /v1/admin/auth/mfa/reverify`, EARS-8) lives in `auth/admin-session/`, beside the challenge it reuses.
