---
title: "047 — Staff access: the platform administrator grants and revokes staff roles in the admin"
description: "Requirements for the «Доступы» admin section: a platform-administrator-only list of staff members with their role and event, a grant form (email, full name, role, event) that adds the role to an existing account or creates the staff account with a one-time temporary password, a revoke action that closes access at once including open admin sessions, a current authenticator code in the same session when the second factor is older than 30 minutes, retry of a grant or revocation that failed part-way, and the auth.role.granted / auth.role.revoked and auth.step_up.* audit."
slug: 047-staff-access
status: Draft
issues: [2378, 2901, 2902]
surface: user-facing
tracker: https://github.com/doctor-school/ds-platform/issues/2378
prior_decisions:
  - "ADR-0001 §1 (RBAC = hybrid: coarse role in the IdP grant, event binding in platform data), §4 (TOTP for staff roles), §8 (IdP = Zitadel; public self-registration disabled, staff accounts are created by the operator)"
  - "ADR-0001 §6 + §10 — role grant/revoke is a step-up action: live revalidation, fresh MFA within 30 minutes, `401 STEP_UP_REQUIRED` with `stepUpUrl`"
  - "ADR-0001 design §7.3 — audit events `auth.role.granted` / `auth.role.revoked` (user_id, role, by_admin, ts)"
  - "ADR-0006 §4 — flat EARS numbering, triplet layout"
  - "ADR-0013 — admin screens from `@ds/design-system`; Stage-A design gate before UI implementation"
  - "011 — admin session, TOTP enrolment at the first admin sign-in, force-logout primitive"
  - "044 EARS-38 — `event-registrar` bound to exactly one event; 046 EARS-26 — `congress-program-committee` bound to one or more events"
lang: en
---

> **EN (this)** · **RU:** [`047-requirements-ru.md`](./047-requirements-ru.md)
>
> Product source: the product owner's decisions of 2026-10-13 recorded on the parent Issue #2378 ([re-scope comment](https://github.com/doctor-school/ds-platform/issues/2378#issuecomment-6140839159)). The feature's screen is the «Доступы» section of `apps/admin` — hence `surface: user-facing`.

# 047 — Staff access (Requirements)

## Outcomes

- A platform administrator gives a staff member access to the admin from the admin itself — no IdP console, no database insert, no shell runbook.
- A staff member who has no account receives one with a temporary password the granting administrator hands over; the second factor is enrolled at the first admin sign-in as today.
- Revoking access takes effect at once: the person's open admin sessions end and the next request is refused.
- Every grant and revocation is made with a second factor verified in the last 30 minutes — otherwise the administrator enters a current authenticator code without leaving the session and the action goes through — and is recorded in the audit.
- A grant or revocation that failed part-way is finished by repeating it.

## Scope

- The admin section «Доступы» in `apps/admin`: the staff list, the grant form and the revoke action, built from `@ds/design-system`.
- The staff-access endpoints in `apps/api` and their Zod contract in `packages/schemas`.
- Grantable roles: `platform_admin`, `event-registrar` («Администратор Конгресса»), `congress-program-committee` («Программный комитет»). The two event-bound roles keep their binding rules over `event_role_grants` (044 EARS-38, 046 EARS-26).
- Staff account creation in Zitadel and its `users` mirror row, with a system-generated temporary password.
- A fresh second factor for grant and revoke (ADR-0001 §10) through the production step-up check: a stale factor refuses the action with `401 STEP_UP_REQUIRED`, the admin keeps the entered form, sends the administrator to the existing admin code screen to enter a current authenticator code for the same session, and repeats the action afterwards; `auth.step_up.*` audit rows. The code screen gains a re-verify mode and its endpoint a re-verify route; no new dialog or page.
- Revocation closes access at once, open admin sessions included. This supersedes #2420 for these roles; the offboarding section of `apps/docs/content/operations/admin-onboarding.md` is rewritten to the section.

### Out of scope

- `congress-partner` — retired (#2438).
- `pd_officer` — not grantable until the personal-data screens (ADR-0009) exist; it then joins this section as a change to the grantable-role list, without a new spec for the section.
- Roles from the ADR-0001 catalogue that do not exist yet (`expert`, `moderator`, `support`, …): each joins the section when it exists, as a change to the grantable-role list.
- A set-password link, a forced password change, a password-reset feature for staff, or delivery of the temporary password by the system (email, chat): the administrator hands it over.
- Editing a staff member's name or email, deactivating or deleting an account, resetting a second factor (011 EARS-13 stays the factor-reset path).
- Search, filters and paging of the list beyond what `AdminDataList` gives by default: the staff list is a few dozen rows.

## Constraints

- The coarse role is a Zitadel project-role grant; Zitadel keeps one grant per user and project carrying a `roleKeys` array. A second create on an account that already holds a grant answers `409` (proven on stage 2026-10-13), so a role is added by updating the existing grant (`PUT /management/v1/users/{userId}/grants/{grantId}`), never by creating a second one.
- The event binding is a row of `event_role_grants` (`packages/db/src/schema/event-role-grants.ts`): one `event-registrar` row per user (partial unique index), one `congress-program-committee` row per user and event.
- The admin origin admits a principal only through the `role → mfa_required` policy (`apps/api/src/auth/admin-session/mfa-policy.ts`); every grantable role is in it.
- An admin session copies the roles into a server-side record at sign-in (`admin-session.service.ts`); a pending sign-in holds a role snapshot for 5 minutes. Revocation must end both.
- Staff accounts are not doctor registrations: 021 EARS-4/EARS-5 (consents and declarations) do not apply to them.
- The staff account keeps the visitor role `doctor_guest` as its base grant (the onboarding runbook, step 5; `apps/api/src/auth/staff-role.ts`).

## Prior decisions

- Product-owner decisions (chat 2026-10-13, Issue #2378), binding for this spec:
  - One section «Доступы» for every staff role; the three roles above are granted now; `pd_officer` waits for the personal-data screens: «Да, убираем».
  - A new account gets a temporary password, no new set-password function: «новых функций не надо мудрить, упрощаем тут. Можно просто временный пароль задавать. С учётом наличия 2FA это норм».
- Lead decisions (from ADR-0001 and the live mechanism, recorded on #2378): only `platform_admin` sees and uses the section; the form is email, full name, role and the event for an event-bound role; an existing account gets the role added, otherwise the account is created without doctor-registration consents; «Отозвать» closes access at once, open sessions included.
- ADR-0001 §1, §8 — the coarse role lives in the IdP grant, the resource binding in platform data; staff accounts are created by the operator, never self-registered.
- ADR-0001 §4 — TOTP for staff roles; 011 — enrolment at the first admin sign-in.
- ADR-0001 §6, §10 — role grant/revoke is a step-up action under live revalidation; the operator re-elevates the current session at `stepUpUrl`, the admin console keeps the context and retries the original request, and every step-up attempt is audited as `auth.step_up.{requested,succeeded,failed}`.
- ADR-0001 design §7.3 — `auth.role.granted` / `auth.role.revoked`.
- ADR-0006 §4 — flat `EARS-N`. ADR-0013 — admin UI from `@ds/design-system`, Stage A before implementation.

## Event Model

**Commands** — `ListStaffAccess`, `GrantStaffRole`, `RevokeStaffRole`, `ReverifySecondFactor` (platform administrator).

**Events** — `StaffAccountCreated`, `StaffRoleGranted` (`auth.role.granted`), `StaffRoleRevoked` (`auth.role.revoked`), `AdminSessionEnded` (`auth.session.terminated`, reason `force`), `StepUpRequested` / `StepUpSucceeded` / `StepUpFailed` (`auth.step_up.*`).

**Read models** — the staff list: one row per person, role and event.

**Policies** — «only a platform administrator reaches the section»; «a role is added to the existing account, never a second account or a second grant»; «the temporary password is shown once and never stored by the platform»; «revocation ends every admin session of the person»; «grant and revoke need a fresh second factor, re-verified in the same session»; «a grant or revocation that failed part-way is finished by repeating it, and its audit row is written once».

## EARS requirements

- **EARS-1** — THE SYSTEM SHALL show the section «Доступы» in the admin navigation and serve it, and its endpoints, only to a principal holding `platform_admin`; every staff-access endpoint SHALL declare `roles: [platform_admin]` with `revalidate: "live"`, and a principal without `platform_admin` SHALL be refused server-side.
- **EARS-2** — WHEN a platform administrator opens «Доступы», THE SYSTEM SHALL list every account holding a grantable role, one row per person, role and event, with the columns ФИО, email, роль and мероприятие (empty for `platform_admin`), and a «Отозвать» action on each row, on the `AdminDataList` composition.
- **EARS-3** — WHEN a platform administrator submits the grant form — email, ФИО, role, and the event when the role is `event-registrar` or `congress-program-committee` — THE SYSTEM SHALL refuse, with the reason shown at the form and nothing changed: a missing or malformed field; an event for a role that takes none; an `event-registrar` grant for a person already bound to another event (044 EARS-38); a grant of a role, or a role and event, that is already complete — the person holds the role (and the binding to that event), has a password and a `users` row, and the grant is recorded (EARS-9). A grant that is not complete SHALL NOT be refused as held: the same form SHALL finish its missing steps.
- **EARS-4** — WHEN the grant names the email of an existing account, THE SYSTEM SHALL add the role to that account's existing project grant, keeping `doctor_guest` and every other role it holds and leaving its name unchanged, SHALL leave its password unchanged only when the account's email is verified, and SHALL write the event binding row for an event-bound role; WHEN the existing account's email is not verified, THE SYSTEM SHALL, before the role reaches the account, replace any password it has and end every session of the account, and SHALL treat it under EARS-6.
- **EARS-5** — WHEN the grant names an email no account holds, THE SYSTEM SHALL create the staff account — a Zitadel human user with the email marked verified and the name from ФИО, a project grant of `doctor_guest` and the granted role, and its `users` mirror row — and SHALL write the event binding row for an event-bound role, recording no doctor-registration consent or declaration.
- **EARS-6** — WHEN a grant creates an account, or names an existing account that has no password or whose email is not verified, THE SYSTEM SHALL generate a temporary password, set it on the account without a forced change, and show it once to the granting administrator with a copy action, and SHALL mark an unverified existing account's email verified once the password is set; THE SYSTEM SHALL NOT store, log, audit, email or show the password again, and the person enrols the second factor at the first admin sign-in (011).
- **EARS-7** — WHEN a platform administrator confirms «Отозвать» on a row, THE SYSTEM SHALL remove that event binding — and the role from the project grant when the person holds no other binding of it — keeping `doctor_guest` and every other role, and SHALL end every admin session and pending admin sign-in of the person, so that the person's next admin request is refused; a platform administrator SHALL NOT revoke their own `platform_admin`. WHEN the IdP change of a revocation fails, THE SYSTEM SHALL still end the person's admin sessions and pending admin sign-ins, answer a retryable refusal, and record no revocation; repeating the same revocation SHALL finish it.
- **EARS-8** — WHILE the caller's last verified second factor is older than 30 minutes, THE SYSTEM SHALL refuse a grant or a revocation with `401 STEP_UP_REQUIRED`, the `stepUpUrl` of the admin code screen, and no change; the admin SHALL keep the entered form, send the administrator to that screen to enter a current authenticator code for the same session — which refreshes the session's second-factor time and nothing else — and afterwards return to «Доступы» and send the original request again. Further grants and revocations within 30 minutes of that code SHALL ask for no code. THE SYSTEM SHALL record each step-up refusal as `auth.step_up.requested` and each code attempt as `auth.step_up.succeeded` or `auth.step_up.failed`.
- **EARS-9** — WHEN a grant or a revocation completes, THE SYSTEM SHALL record `auth.role.granted` or `auth.role.revoked` with the person, the role, the event when bound and the acting administrator — once, after the IdP change succeeded — and the binding row change in the 010 change audit under the request's actor.

## Invariants

- One account per email: a grant never creates a second account or a second project grant for an existing person (EARS-4).
- `doctor_guest` survives every grant and revocation (EARS-4, EARS-5, EARS-7).
- An `event-registrar` is bound to at most one event; a committee member at most once per event (EARS-3).
- The temporary password exists only in the grant response the administrator sees once (EARS-6).
- After a revocation no admin session or pending sign-in of the person carries the revoked role (EARS-7).
- Every grant and revocation is preceded by a second factor no older than 30 minutes and followed by exactly one audit row, written after the IdP change (EARS-8, EARS-9).
- Repeating a grant or revocation that failed part-way finishes it; nothing is recorded as granted or revoked before the IdP holds that state (EARS-3, EARS-7, EARS-9).
- A step-up re-verification keeps the session: same session id, same expiry, only the second-factor time refreshed (EARS-8).
- Only `platform_admin` reaches the section; no administrator can remove their own `platform_admin` (EARS-1, EARS-7).

## Verification

| #    | Type                     | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V-1  | Vitest e2e — `apps/api`  | A `platform_admin` reads the list; a registrar and a committee member are refused on every staff-access endpoint; the matrix rows carry `revalidate: live` and the writes `step_up: true` (EARS-1, EARS-2).                                                                                                                                                                                                                                                                                                                                                 |
| V-2  | Vitest e2e — `apps/api`  | Grant refusals: missing email, event on `platform_admin`, no event on `event-registrar`, a registrar already bound elsewhere, a complete duplicate role and a complete duplicate committee event — each refused, no IdP write, no row; a `platform_admin` grant failed after the IdP role add (DB fault) and one failed at the password step are each finished by the same grant, with one `auth.role.granted` row and the password shown by the finishing request (EARS-3, EARS-6, EARS-9).                                                                |
| V-3  | Vitest e2e — `apps/api`  | Existing account with `doctor_guest`: the grant updates its existing grant to `doctor_guest` + the role (no create call), writes the binding, leaves the password of an account with a verified email untouched and returns no password; an existing account without a password gets one; an existing account whose email is unverified gets a new temporary password, its email verified and every session ended — its old password no longer signs in (EARS-4, EARS-6).                                                                                   |
| V-4  | Vitest e2e — `apps/api`  | Unknown email: a verified human user with the ФИО name, a grant of `doctor_guest` + the role and a `users` row are created, no `consent_records` row; the response carries the temporary password once, the audit and logs do not (EARS-5, EARS-6).                                                                                                                                                                                                                                                                                                         |
| V-5  | Vitest e2e — `apps/api`  | Revocation of a committee member bound to two events removes one binding and keeps the role; revoking the last removes the role and keeps `doctor_guest`; the person's admin sessions and pending sign-in are gone and the next admin request is refused; revoking one's own `platform_admin` is refused; with the IdP failing on the role removal the answer is `503`, the sessions and pending sign-in are still ended, no `auth.role.revoked` is written, and the repeated revocation finishes it with one row (EARS-7).                                 |
| V-6  | Vitest e2e — `apps/api`  | With the second factor verified 31 minutes ago a grant and a revocation answer `401 STEP_UP_REQUIRED` with `stepUpUrl` `/mfa/challenge?mode=reverify` and nothing changes; `POST /v1/admin/auth/mfa/reverify` with a wrong code is the uniform `401`, with a current code refreshes the same session (same id and expiry), and the same grant then passes; a second grant within 30 minutes asks for no code; `auth.step_up.requested`, `.failed` and `.succeeded` carry user, endpoint, method, IP and UA (EARS-8).                                        |
| V-7  | Vitest e2e — `apps/api`  | Grant and revocation write `auth.role.granted` / `auth.role.revoked` with person, role, event and actor, and the `event_role_grants` change carries the administrator as the 010 actor (EARS-9).                                                                                                                                                                                                                                                                                                                                                            |
| V-8  | Vitest — `apps/api`      | The Zitadel adapter's grant read, grant update and grant search are pinned to the live wire shape proven on the dev-stand (`047-design.md`, «IdP calls»).                                                                                                                                                                                                                                                                                                                                                                                                   |
| V-9  | Playwright / E2E — admin | A platform administrator opens «Доступы», grants «Программный комитет» for an event to a new email, sees the temporary password once, signs in as that person with it and enrols TOTP, lands on the bound event's «Заявки»; the administrator revokes the row and the person's next admin request returns to the login; with the administrator's second factor 31 minutes old, a submitted grant opens the code screen, and after the code the grant completes with the entered values and shows its result; a registrar sees no «Доступы» (EARS-1…EARS-8). |
| V-10 | axe                      | Clean `playwright-axe` runs on the list, the grant form, the password dialog and the code screen in re-verify mode (ADR-0013).                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Work-package map

Each Issue is a sub-issue of #2378 and ships its UI with its backend; slices and dependencies: `047-design.md` («Delivery slices»).

| EARS                                  | Issue | Work package                                                                                          |
| ------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------- |
| EARS-1…EARS-6, EARS-8, EARS-9 (grant) | #2901 | **Section, list and grant** — section and nav, list, grant form, account creation, temporary password |
| EARS-7, EARS-8, EARS-9 (revoke)       | #2902 | **Revoke** — «Отозвать», session closure, runbook rewrite, #2420 closed                               |
