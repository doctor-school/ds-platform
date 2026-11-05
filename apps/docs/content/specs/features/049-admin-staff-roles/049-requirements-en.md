---
title: "049 — Admin staff roles: the superadministrator owns staff access, and a global broadcast director runs events"
description: "Requirements for two new staff roles in the admin: `superadmin` («Суперадминистратор»), the only role that sees and uses «Доступы» (047) and grants there every staff role but its own, given to its first holder by an audited operator step; and `broadcast_director` («Режиссёр трансляций»), a global role that sees the admin event list, creates and edits events and switches the broadcast status, with every other admin section closed to it server-side and absent from its navigation. Both roles sign in with TOTP and count as staff, not participants."
slug: 049-admin-staff-roles
status: In dev
issues: [3737, 3739, 3740, 3742, 3743, 3744]
surface: user-facing
storefronts: none
storefronts_reason: "Only apps/admin roles, navigation and authorization, plus an operator CLI step; no storefront page."
tracker: https://github.com/doctor-school/ds-platform/issues/3737
prior_decisions:
  - "ADR-0001 §1 (RBAC = hybrid: coarse role in the IdP grant, resource binding in platform data), §4 (TOTP for staff roles), §8 (IdP = Zitadel; staff accounts are created by the operator)"
  - "ADR-0001 §10 + A1/A3 — live revalidation asks the IdP about the grant the caller acts under; role grant/revoke is a step-up action"
  - "ADR-0001 design §7.3 — audit events `auth.role.granted` / `auth.role.revoked` (user_id, role, by_admin, ts)"
  - "ADR-0006 §4 — flat EARS numbering, triplet layout"
  - "ADR-0013 — admin screens from `@ds/design-system`"
  - "047 — the «Доступы» section, its grant and revoke cascades and step-up; amended by this spec"
  - "007 — event authoring and the broadcast lifecycle commands the director reaches"
  - "011 — admin session, TOTP enrolment at the first admin sign-in; LD-2 break-glass operator CLI precedent"
lang: en
---

> **EN (this)** · **RU:** [`049-requirements-ru.md`](./049-requirements-ru.md)
>
> Product source: the product owner's request of 2026-11-05 and the answers given in the same session, recorded verbatim on the parent Issue #3737. The feature's screens are the admin navigation and «Доступы» in `apps/admin` — hence `surface: user-facing`. Design: [`049-design.md`](./049-design.md) · Scenarios: [`049-scenarios.feature`](./049-scenarios.feature).

# 049 — Admin staff roles (Requirements)

## Outcomes

- One role, the superadministrator, decides who works in the admin: only it sees «Доступы» and grants there every staff role except its own. A platform administrator keeps every other admin right and loses «Доступы».
- The first superadministrator is made by an audited operator step after the release, and that step is the only way the role is given or taken.
- A broadcast director opens the admin, sees every event, creates and edits events and switches the broadcast status; nothing else in the admin is offered to it or served to it.
- Both roles sign in with an authenticator code like every staff role, and neither inflates participant counts.

## Scope

- Role keys `superadmin` and `broadcast_director` as Zitadel project roles, seeded by the existing IdP provisioning (`infra/dev-stand/idp/provision.sh`).
- Both roles in the API role vocabulary, the staff-role precedence, the `role → mfa_required` policy and every admin-session endpoint that lists the admitted roles.
- «Доступы» (047) moves from `platform_admin` to `superadmin`: its navigation entry, its route and its three endpoints. The grant form gains «Режиссёр трансляций»; superadministrator rows are listed and carry no «Отозвать».
- An operator command in `apps/api` that grants and removes `superadmin`, audited like a grant in «Доступы», and its runbook entry in `apps/docs/content/operations/admin-onboarding.md`.
- The broadcast director's reach: the admin endpoints listed in `049-design.md` «Director reach» admit `broadcast_director` beside `platform_admin`; the admin navigation, routes and event card show the director only what those endpoints serve.
- Live revalidation for both roles (ADR-0001 §10): the IdP is asked about `superadmin` on a superadministrator row and about `broadcast_director` for a director-only session, with their own `403` codes. The rule ships as ADR-0001 amendment A4 with the code that runs it, as A1 and A3 did.
- 047 is amended (`047-requirements-en.md` → «Amendment — 2026-11-05»); 007 EARS-8 is amended for the director (`007-requirements-en.md` → «Amendment — 2026-11-05»).

### Out of scope

- An event-bound director grant: the director is global, every event.
- Recording management (014 recordings, the «Архивный эфир» legacy machine), congress intake, roster, registrations, submissions, materials, projects, experts, organisations, directions, specialties, event kinds and every other dictionary edit for the director.
- Any implicit role hierarchy: holding `superadmin` grants nothing but «Доступы» and the operator-visible row; every other admin right comes from the explicit `platform_admin` grant beside it.
- Granting or revoking `superadmin` in «Доступы»; a «last superadministrator» recovery path other than the operator command.
- Any doctor-facing or storefront change.

## Constraints

- About 109 admin endpoints declare `roles: [platform_admin]` today. They stay as they are; nothing in the guard treats `superadmin` as implying `platform_admin`. A superadministrator holds both roles as two keys of one Zitadel project grant.
- Zitadel keeps one project grant per user carrying a `roleKeys` array; a role is added or removed by updating that grant (047 Constraints).
- The admin origin admits a principal only through `MFA_REQUIRED_BY_ROLE` (`apps/api/src/auth/admin-session/mfa-policy.ts`); a role absent from it cannot sign in to the admin.
- The `users.role` mirror records the highest-precedence staff role of the claim (`apps/api/src/auth/staff-role.ts`); `users.role` is free text, so no migration.
- The endpoint-authz matrix validator refuses a `revalidate: "live"` or `step_up` row whose roles name neither `platform_admin` nor `pd_officer` (`apps/api/src/authz/authz.matrix.ts`); a `[superadmin]` row needs the validator to know `superadmin`.
- The event form posts the event's project link right after create (`event-projects`), and the event card edits the event's experts, projects and directions links; the director needs those writes to create and edit an event.

## Prior decisions

- Product-owner request and answers (2026-11-05, Issue #3737), binding for this spec:
  - The broadcast director: «Это человек, который будет заходить в мероприятие и, в общем-то, нажимать на кнопки изменения статуса этой трансляции. Там, в принципе, можно же ему дать и роль создания этих мероприятий и там, редактирования их. … но все остальные пункты ему должны быть недоступны.» It is a GLOBAL role (all events), not event-bound.
  - A NEW role `superadmin`: only it sees «Доступы» and grants there any staff role except `superadmin`; `platform_admin` keeps its other rights but loses «Доступы»; the owner's account receives `superadmin`.
- Lead decisions (recorded on #3737): the role keys `superadmin` and `broadcast_director` (global roles use an underscore); a superadministrator also holds `platform_admin` as an explicit second grant and the guard has no role hierarchy; the first holder is made by an operator command after the release, audited with the operator as actor (011 LD-2 break-glass precedent); the director is not event-bound and does not reach the legacy-broadcast machine or recordings; both roles require TOTP; admin screens reuse the existing admin compositions, so there is no new look and no Stage A.
- ADR-0001 §1, §8 — the coarse role lives in the IdP grant; staff accounts are created by the operator.
- ADR-0001 §4 — TOTP for staff roles.
- ADR-0001 §10, A1, A3 — live revalidation asks the IdP about the grant the caller acts under and never widens reach; each revalidated role answers its own `403` once the IdP withdrew it.
- ADR-0001 design §7.3 — `auth.role.granted` / `auth.role.revoked`.
- ADR-0006 §4 — flat `EARS-N`. ADR-0013 — admin UI from `@ds/design-system`.

## Event Model

**Commands** — `GrantSuperadmin`, `RemoveSuperadmin` (operator command); `GrantStaffRole`, `RevokeStaffRole` (047, now superadministrator); the 007 event commands and the event-link commands (now also the broadcast director).

**Events** — `StaffRoleGranted` (`auth.role.granted`), `StaffRoleRevoked` (`auth.role.revoked`), `AdminSessionEnded` (`auth.session.terminated`), the 007 lifecycle `audit_ledger` rows with the director as actor.

**Read models** — the «Доступы» list, now carrying superadministrator and director rows; the admin session read (`roles`), from which the admin draws the navigation.

**Policies** — «only a superadministrator reaches «Доступы»»; «`superadmin` is given and taken only by the operator command»; «no one revokes their own `platform_admin`»; «a holder of `superadmin` always also holds `platform_admin`»; «the broadcast director reaches exactly the director endpoints, everything else is refused server-side»; «a role implies no other role».

## EARS requirements

- **EARS-1** — WHEN a principal holding `superadmin` or `broadcast_director` signs in to the admin, THE SYSTEM SHALL admit it through the second-factor flow every staff role takes — TOTP enrolment at the first sign-in, a TOTP challenge afterwards — and every admin-session endpoint (login, factor enrolment, challenge, re-verification, session read, sign-out) SHALL admit both roles; the session read SHALL return them in `roles`.
- **EARS-2** — THE SYSTEM SHALL treat `superadmin` and `broadcast_director` as staff roles: the `users.role` mirror SHALL record `superadmin` before every other staff role and `broadcast_director` after the congress roles, and a holder of either SHALL NOT count as a participant in any participant count or roster population.
- **EARS-3** — THE SYSTEM SHALL show «Доступы» in the admin navigation and serve its route only to a principal holding `superadmin`, and every staff-access endpoint SHALL declare `roles: [superadmin]` with `revalidate: "live"`; a principal without `superadmin` — a platform administrator included — SHALL be refused server-side with `403`, and opening the route directly SHALL show the admin refusal page. WHILE a session holds `superadmin`, live revalidation on these endpoints SHALL ask the IdP about `superadmin` and answer `403 SUPERADMIN_REQUIRED` once the IdP has withdrawn it. Step-up (047 EARS-8) stays as it is.
- **EARS-4** — WHEN a superadministrator opens the grant form, THE SYSTEM SHALL offer `platform_admin`, `event-registrar`, `congress-program-committee` and `broadcast_director` («Режиссёр трансляций», no event field), and grant each by the 047 cascade; a grant request naming `superadmin` or any other role SHALL be refused at validation with nothing changed.
- **EARS-5** — WHEN a superadministrator opens «Доступы», THE SYSTEM SHALL list every holder of `superadmin` as a row «Суперадминистратор» with an empty event and no «Отозвать», and every holder of `broadcast_director` as a row «Режиссёр трансляций» with an empty event and «Отозвать»; a revocation request naming `superadmin` SHALL be refused at validation with nothing changed, and a superadministrator SHALL NOT revoke their own `platform_admin`. WHEN a superadministrator revokes `platform_admin` from an account that still holds `superadmin`, THE SYSTEM SHALL refuse with `409 STAFF_REVOKE_SUPERADMIN_HOLDER` and the reason shown at the row, with nothing changed at the IdP, in the account's sessions or in the audit; that row SHALL carry no «Отозвать» for its `platform_admin`.
- **EARS-6** — WHEN an operator runs the superadmin command with the email of an existing account whose email is verified and, as `--by-admin`, the subject of an existing IdP account, THE SYSTEM SHALL add `superadmin` and `platform_admin` to that account's existing project grant, keeping every other role, and SHALL record `auth.role.granted` for each role it added with the operator as `by_admin`; a repeat SHALL change nothing and record nothing. WHEN the operator runs its removal with such an email, THE SYSTEM SHALL remove `superadmin` only, leaving `platform_admin` as it is, end every admin session and pending admin sign-in of the person and record `auth.role.revoked`, and SHALL refuse with nothing changed when the person is the last holder of `superadmin`. An unknown email, an unverified email, an email more than one IdP account holds, or a `--by-admin` subject that is missing or resolves to no IdP account SHALL be refused with a reason and nothing changed; the command SHALL create no account and print no secret.
- **EARS-7** — WHILE a principal holds `broadcast_director`, THE SYSTEM SHALL admit it on exactly the endpoints of `049-design.md` «Director reach» — the admin event list and detail, event create and edit, the stream config, the 007 lifecycle commands (`publish`, `open`, `close`, `hide`, `transition`), the event's experts, projects and directions links, the list reads of event kinds, projects, experts and directions, and the detail reads of a project and of an expert — and SHALL refuse it with `403` on every other admin endpoint; every 007 lifecycle transition it makes SHALL record the director as the actor of its `audit_ledger` row. WHILE a session holds `broadcast_director` and not `platform_admin`, live revalidation on a director row SHALL ask the IdP about `broadcast_director` and answer `403 BROADCAST_DIRECTOR_REQUIRED` once the IdP has withdrawn it.
- **EARS-8** — WHEN a principal holding `broadcast_director` and no `platform_admin` uses the admin, THE SYSTEM SHALL draw only «Мероприятия» in the admin navigation and land every sign-in on the event list; the event list, the create form and the event card SHALL offer the director everything a platform administrator has there except the «Архивный эфир» create option, the legacy actions «Архивировать» / «Скрыть» of a legacy эфир, the recordings panel and the links to «Регистрации», «Приём заявок» and «Заявки»; any other admin route opened directly SHALL show the admin refusal page. A director who also holds an event-bound role SHALL see the union of both navigations.

## Invariants

- Only `superadmin` reaches «Доступы»; `platform_admin` alone never does (EARS-3).
- `superadmin` changes only through the operator command; «Доступы» never grants or revokes it (EARS-4, EARS-5, EARS-6).
- At least one account holds `superadmin` once the first holder is made; the command never removes the last one (EARS-6).
- No one revokes their own `platform_admin` (EARS-5).
- A holder of `superadmin` always also holds `platform_admin`: the operator command grants both, its removal leaves `platform_admin` as it is, and «Доступы» refuses to revoke `platform_admin` from a holder of `superadmin`. There is no superadmin-only session (EARS-5, EARS-6).
- A role implies no other role: every admin endpoint admits exactly the roles its `@Authz` row names (EARS-3, EARS-7).
- A broadcast director reaches only the director endpoints, and its navigation offers nothing those endpoints do not serve (EARS-7, EARS-8).
- Every grant and removal of either role leaves exactly one audit row per role changed, written after the IdP holds the new state (EARS-4, EARS-5, EARS-6; 047 EARS-9).
- Neither role counts as a participant (EARS-2).

## Verification

| #   | Type                     | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V-1 | Vitest — `apps/api`      | `requiresMfa` is true for both roles; `mirrorRoleFromClaims` puts `superadmin` first and `broadcast_director` after the congress roles; `holdsStaffRole` is true for both; the matrix validator accepts a live `[superadmin]` row and a live row naming `broadcast_director` beside `platform_admin` (EARS-1, EARS-2).                                                                                                                                                                                                                                            |
| V-2 | Vitest e2e — `apps/api`  | A director-only account and a superadministrator account (`superadmin` + `platform_admin`) each sign in, enrol TOTP, read the session with their role in `roles` and sign out; a director is not counted in a participant count (EARS-1, EARS-2).                                                                                                                                                                                                                                                                                                                 |
| V-3 | Vitest e2e — `apps/api`  | A superadministrator lists, grants and revokes; a platform administrator, a registrar, a committee member and a director are refused `403` on every staff-access endpoint; with the IdP withdrawing `superadmin` the list answers `403 SUPERADMIN_REQUIRED`; the matrix rows carry `[superadmin]`, `revalidate: live`, writes `step_up: true` (EARS-3).                                                                                                                                                                                                           |
| V-4 | Vitest e2e — `apps/api`  | A director grant adds `broadcast_director` with no binding row and writes `auth.role.granted`; a grant naming `superadmin` is `400` with no IdP write; superadministrator rows are listed; a revocation naming `superadmin` is `400`; revoking one's own `platform_admin` is refused; revoking `platform_admin` from another holder of `superadmin` is `409 STAFF_REVOKE_SUPERADMIN_HOLDER` with no IdP write, no session ended and no ledger row, and that row is `revocable: false`; a director revocation ends the director's admin sessions (EARS-4, EARS-5). |
| V-5 | Vitest — `apps/api`      | The operator command against the IdP fake: adds both roles to the existing grant keeping `doctor_guest`, writes two `auth.role.granted` rows with the operator actor, a repeat writes none; removal drops `superadmin` only, keeps `platform_admin`, ends sessions and pending sign-ins, writes `auth.role.revoked`; the last holder, an unknown, unverified or ambiguous email, and a missing or unknown `--by-admin` subject are refused unchanged (EARS-6).                                                                                                    |
| V-6 | Vitest e2e — `apps/api`  | A director creates, edits, configures the stream of, publishes, opens, closes and hides an event, and edits its experts, projects and directions links; it reads a project's detail and an expert's detail; the lifecycle `audit_ledger` rows carry the director's subject; it is `403` on every other admin endpoint of the design table, the legacy-broadcast, recordings and dictionary writes included; with the IdP withdrawing the director grant a director-only live write answers `403 BROADCAST_DIRECTOR_REQUIRED` (EARS-7).                            |
| V-7 | Vitest — `apps/admin`    | `adminAccess` / `adminNavItems` / `canAccessPath` / `canAccessResource`: «Доступы» only with `superadmin`, and a superadministrator session is `full`; a director-only session gets «Мероприятия» alone, `/events`, `/events/create` and `/events/<id>` and nothing else; director + registrar gets the union (EARS-3, EARS-8).                                                                                                                                                                                                                                   |
| V-8 | Playwright / E2E — admin | A superadministrator opens «Доступы», grants «Режиссёр трансляций» to a new email; the director signs in with the temporary password, enrols TOTP, lands on the event list, sees only «Мероприятия», creates an event, configures the stream, publishes, opens and closes the room; `/projects` shows the refusal page; a platform administrator sees no «Доступы» and `/access` shows the refusal page (EARS-1, EARS-3, EARS-4, EARS-5, EARS-8).                                                                                                                 |
| V-9 | axe                      | Clean `playwright-axe` runs on the director's event list and event card and on «Доступы» with superadministrator and director rows (ADR-0013).                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Work-package map

Each Issue is a sub-issue of #3737 and ships its UI with its backend; slices and dependencies: `049-design.md` («Delivery slices»).

| EARS                               | Issue | Work package                                                                                                          |
| ---------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------- |
| EARS-1, EARS-2 (+ A4 revalidation) | #3739 | **Roles and admission** — IdP keys, role vocabulary, staff precedence, MFA admission, live revalidation (ADR-0001 A4) |
| EARS-3, EARS-4, EARS-5             | #3740 | **«Доступы» to the superadministrator** — endpoints, grantable roles, list rows, admin entry                          |
| EARS-6                             | #3742 | **Superadmin operator command** — grant / remove, audit, runbook                                                      |
| EARS-7, EARS-8                     | #3743 | **Broadcast director reach** — director endpoints, admin navigation and event card                                    |
| EARS-6 (prod)                      | #3744 | **Post-release step** — the owner's prod account receives `superadmin`                                                |
