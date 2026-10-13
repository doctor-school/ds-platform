# `staff-access` — feature 047 «Доступы» (staff roles)

Spec: [`specs/features/047-staff-access`](../../../docs/content/specs/features/047-staff-access/047-design.md) · ADR-0001 (authz, §10 step-up).

The module owns the `platform_admin` surface that lists and grants the staff roles of `GRANTABLE_STAFF_ROLES` (`@ds/schemas`): `platform_admin`, `event-registrar` and `congress-program-committee`. A grant spans the IdP, Postgres and the ledger, so it is a fixed sequence of idempotent steps (047-design §Completeness and retry, §Grant cascade); the `auth.role.granted` row is the completion mark.

## What is here

| File                               | Role                                                                                                                                                                                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `staff-access.admin.controller.ts` | `GET /v1/admin/staff-access` (EARS-1/2) and `POST /v1/admin/staff-access/grants` (EARS-3…6, 9; `stepUp: true`, `no-store`). Exports the Zod DTOs `StaffAccessGrantRequestDto`, `StaffAccessGrantResponseDto`, `StaffAccessListResponseDto`.                           |
| `staff-access.service.ts`          | `StaffAccessService` — the list projection and the grant cascade, including the unverified-email takeover of EARS-4/EARS-6. `StaffAccessRefusal` carries the EARS-3 `errorCode`s (`EVENT_NOT_FOUND` 422, `REGISTRAR_BOUND_ELSEWHERE` / `GRANT_ALREADY_COMPLETE` 409). |
| `staff-access.repository.ts`       | `StaffAccessRepository` — mirror, event binding and audit reads; `commitGrant` writes mirror, binding and the completion mark in one transaction.                                                                                                                     |
| `temporary-password.ts`            | `generateTemporaryPassword` (EARS-6): 16 characters, unambiguous alphabet, from `crypto.randomInt`. The password lives in the request scope and the `201` body only.                                                                                                  |
| `staff-access.module.ts`           | `StaffAccessModule` — imports the IdP port and the portal / admin session modules (sessions are ended on the unverified-email takeover).                                                                                                                              |

The step-up re-verification the grant relies on (`POST /v1/admin/auth/mfa/reverify`, EARS-8) lives in `auth/admin-session/`, beside the challenge it reuses.
