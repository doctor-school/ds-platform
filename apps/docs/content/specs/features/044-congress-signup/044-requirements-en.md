---
title: "044 — Congress sign-up"
description: "Requirements for the congress sign-up vertical slice: a public unauthenticated intake endpoint reached same-origin from the congress site, a passwordless account created through the shared 003 engine, typed answers and consent stored on the event registration, a confirmation email whose outcome is recorded, and a restricted event-registrar role with a roster and a printable attendance sheet in apps/admin."
slug: 044-congress-signup
status: Draft
issues: []
surface: user-facing
tracker: https://github.com/doctor-school/ds-platform/milestone/19
prior_decisions:
  - "ADR-0006 §4 — flat EARS numbering, triplet layout"
  - "ADR-0014 §2 — `realizes: US-N` traceability from `044-product.md`"
  - "ADR-0009 §2.1 — consent versioning: publication date + sha256 of the published text"
  - "ADR-0013 — the admin roster and print sheet are built from `@ds/design-system` primitives, tokens only"
  - "ADR-0001 §1 (RBAC = hybrid) and §8 (IdP = Zitadel) — a coarse role is an incremental addition to the IdP group model, mirrored into `users.role`"
  - "ADR-0016 §1 (one person is one entity) and §7 (consents) — the existing-email path never forks a second person"
  - "ADR-0002 — Zod-first REST contract in `packages/schemas`"
lang: en
---

> **EN (this)** · **RU:** [`044-requirements-ru.md`](./044-requirements-ru.md)
>
> PRD source: [`044-product.md`](./044-product.md) (US-1…US-13). The intake form itself is hosted on the congress site, but this feature's own screens — the admin roster and the printable attendance sheet — live in `apps/admin`, so `surface: user-facing`. This supersedes the functional-map registry row's `backend-only` classification for 044.

# 044 — Congress sign-up (Requirements)

## Outcomes

- A congress sign-up submitted on the congress site becomes, in one transaction, a Doctor.School account and a registration on the existing `registrations` table — the participant never registers a second time.
- The intake is indistinguishable from the outside whether the email already had an account, and is idempotent under retry: one account, one registration, no enumeration signal.
- The typed answers and the accepted consent live on the registration row; an existing account's own profile is never rewritten by an unauthenticated form.
- The organizing team sees exactly one thing in `apps/admin` — a view-only roster of that event's registrations and a printable attendance sheet built from the roster as currently filtered — through a new coarse role that is refused everywhere else.

## Scope

- A public, unauthenticated intake endpoint in `apps/api`, bot-protected and throttled, reached same-origin through the congress site's own nginx `/api` proxy.
- A passwordless account-creation variant of the shared 003 account engine (`AuthService.register`, `apps/api/src/auth/auth.service.ts:434`), including the credential-less human-user creation in the IdP port (`apps/api/src/auth/idp/idp.types.ts:279`, `:84`).
- A new answers column on `registrations` (`packages/db/src/schema/registrations.ts:42-93`) plus its Zod shape in `packages/schemas`, and a new mail-outcome record on the same row.
- One `consent_records` row per acceptance (`packages/db/src/schema/consent-records.ts:26-36`) under a new congress personal-data purpose.
- A public read-only specialties-list endpoint over `specialties_minzdrav` (`packages/db/src/schema/specialties.ts:61-108`).
- The confirmation email: a new template family member, sent off the response path, its outcome recorded.
- The `event-registrar` role in `apps/api/src/authz/authz.types.ts:18-27`, an HTTP route over `RegistrationService.eventRoster()` (`apps/api/src/registration/registration.service.ts:178-181` — no route today), role-aware admin nav, the roster screen and the print sheet in `apps/admin`.
- The existing platform registration path for a signed-in doctor (`RegistrationService.register`, `:84`) on a published `participationFormat: offline` event, landing in the same roster.

### Out of scope

- **The intake form's markup, look and client behaviour on the congress site** — owned by `doctor-school/orthobio-site#78` in that repository. Every EARS below whose trigger names the form owns only the platform side of that submission; the form surface itself is deferred to that tracked Issue and is not a deliverable here.
- **Site-side dependencies** — the nginx `/api` proxy and the loosening of the site's `form-action 'none'` CSP are dependencies declared on `doctor-school/orthobio-site#78`, not requirements of this spec.
- **CSV / export** — owner, verbatim: «пока, наверное, этого не делаем». The printable sheet from the filtered roster is the v1 output.
- **Admin edit and delete** — owner, verbatim: «Пока только просмотр. Удаление по запросу будем делать вручную.»
- **A second answers form on the platform** for the signed-in-doctor path in v1 (EARS-16 states what the roster shows instead).
- **A retry queue or outbox for the confirmation email** — EARS-11 names the recovery path instead.
- The congress microsite (feature **026**), the event constructor (feature **041**) and the historical-base migration (feature **043**).
- An email-confirmation step before the sign-up counts — owner, verbatim: «Если ты хочешь прийти на мероприятие, ты укажешь свою почту. Укажешь чужую - не попадёшь.»

## Constraints

- The API has no CORS and keeps none: the only browser path from the congress site is same-origin through that site's nginx `/api` proxy. The proxy's egress address must be in `TRUSTED_PROXIES` (`apps/api/src/config/trust-proxy.ts:97-120`) or every submission throttles against the proxy instead of the client (`rate-limit.types.ts` key = identifier + `request.ip`, `:57-62`, `:32-36`).
- Bot protection is per-route opt-in via the `@BotProtected` decorator (`apps/api/src/bot-protection/bot-protection.guard.ts`) over Yandex SmartCaptcha (`smart-captcha.provider.ts`); it is not active platform-wide and must be declared on the intake route.
- `users.phone` is UNIQUE and is a login identifier (`packages/db/src/schema/users.ts:29-101`); an unverified typed phone must never be written there.
- `registrations` is UNIQUE `(user_id, event_id)` — total, not partial (`registrations.ts:42-93`); it is the idempotency mechanism, no new applications table.
- `consent_records` is append-only and immutable (`consent-records.ts:26-36`); `purpose` is free text in the DB with the closed list living in `@ds/schemas`.
- Successful email-OTP login does **not** flip `email_verified`, and an email-unverified account never receives an `otp_email` code (`apps/api/src/auth/auth.service.ts:216-239`); the only writers of verified state are the dedicated verify path (`:684`) and password-reset completion (`:413`).
- `AdminDataList` (`apps/admin/components/admin-data-list.tsx:62-371`) has pagination, instant search and status filters but **no** sort field in its query state; server-side sort is new.
- No `@media print` stylesheet and no export exists anywhere in `apps/admin` or `packages/design-system` today — the print sheet has no precedent to reuse.

## Prior decisions

- ADR-0006 §4 — flat `EARS-N` numbering; the triplet layout of this directory.
- ADR-0014 §2 — every EARS below carries `realizes: US-N` back to `044-product.md`.
- ADR-0009 §2.1 — the consent version identifier recorded per acceptance is the publication date of the static consent page plus the sha256 of its published text.
- ADR-0013 — the roster and the print sheet are assembled from `@ds/design-system` primitives with tokens-only styling; the roster reuses the owner-approved admin Stage-A baseline recorded at `012-requirements-en.md:203` (EARS-18) — the tabbed Refine compositions and researched design-system blocks, no fresh option round.
- ADR-0001 §1, §8 — `event-registrar` is an incremental coarse role in the IdP group model; the authorization source of truth is the Zitadel project-roles claim `urn:zitadel:iam:org:project:roles` (`zitadel.idp.ts:119`), not the `users.role` mirror.
- ADR-0016 §1, §7 — the existing-email path attaches to the one existing person; consents are versioned records, never flags.
- The medical-worker declaration is a precondition of the doctor-storefront door only (`doctor-register.service.ts:308-341`); no gate anywhere reads `consent_records` on a subsequent request (recon §6). An account without that row is already the normal state for an Academy-origin account, so a congress-origin account needs no new tolerance built anywhere — this is a boundary line, not a requirement.

## Event Model

**Commands** — `SubmitCongressSignUp` (public, unauthenticated), `RegisterForEvent` (existing, authenticated doctor), `ListEventRoster` (registrar), `PrintAttendanceSheet` (registrar, client-side).

**Events** — `CongressAccountCreated` (passwordless), `CongressRegistrationRecorded`, `CongressConsentCaptured`, `ConfirmationEmailDispatched` / `ConfirmationEmailFailed`.

**Read models** — the event roster (registration answers joined to the registration fact), the public specialties list, the printable sheet (a projection of the currently filtered roster).

**Policies** — «a mail failure never rolls back a registration»; «an existing email never rewrites a profile»; «a repeat submission is a no-op that looks like the first success».

## EARS requirements

### Work package #2288 — public intake

- **EARS-1** (`realizes: US-1, US-12`) — THE SYSTEM SHALL expose the congress sign-up intake as a public, unauthenticated endpoint carrying the `@BotProtected` decorator (Yandex SmartCaptcha) and the bespoke fixed-window rate limiter under its own scope, and SHALL NOT add CORS headers to the API: the only browser path is same-origin through the congress site's nginx `/api` proxy.
- **EARS-2** (`realizes: US-12`) — WHERE the congress site's nginx egress address is configured in `TRUSTED_PROXIES`, THE SYSTEM SHALL resolve the throttling key from the forwarded client address rather than the proxy address, so that one participant's retries never throttle every other participant.
- **EARS-3** (`realizes: US-10, US-11`) — THE SYSTEM SHALL validate the submission against a Zod schema in `packages/schemas` requiring surname, first name, contact phone, email, specialty, workplace, city, region and the personal-data consent, with patronymic OPTIONAL, and SHALL accept specialty only as a `specialties_minzdrav` identifier or the explicit «Другое / не медицинский работник» option — never as free text.
- **EARS-4** (`realizes: US-1`) — WHEN the submitted email has no account, THE SYSTEM SHALL create the human user in the IdP WITHOUT a credential through a new passwordless variant beside `AuthService.register`, and SHALL upsert the local `users` row with the default guest role, prefilled from the submitted answers (display name from surname/first name).
- **EARS-5** (`realizes: US-1, US-10`) — THE SYSTEM SHALL store the submitted answers on the `registrations` row in a new typed answers column whose shape is validated by the `packages/schemas` schema of EARS-3, and SHALL NOT write the submitted contact phone into `users.phone`.
- **EARS-6** (`realizes: US-2, US-10`) — WHEN the submitted email already has an account, THE SYSTEM SHALL attach the registration to that account and SHALL NOT write any submitted answer into that account's own profile fields.
- **EARS-7** (`realizes: US-2`) — THE SYSTEM SHALL return a response identical in shape, status code and timing class for the new-account and the existing-account paths, disclosing nothing about whether an account already existed.
- **EARS-8** (`realizes: US-3`) — WHEN a submission arrives for an `(account, event)` pair that is already registered, THE SYSTEM SHALL return that same identical success response without creating a second account, a second registration row or a duplicate consent acceptance beyond the one recorded for the new acceptance.
- **EARS-9** (`realizes: US-7`) — THE SYSTEM SHALL write exactly one `consent_records` row per acceptance under a new congress personal-data purpose, with a server-stamped version identifier composed of the consent page's publication date and the sha256 of its published text (ADR-0009 §2.1).
- **EARS-10** (`realizes: US-7`) — THE SYSTEM SHALL NOT write a `medical-worker-declaration` consent row for a congress sign-up, and SHALL NOT require one on this path.
- **EARS-11** (`realizes: US-4, US-13`) — THE SYSTEM SHALL commit the account, the registration and the consent before dispatching the confirmation email, SHALL dispatch that email off the response path, and SHALL NOT roll back, delay or fail the registration because of a send failure.
- **EARS-12** (`realizes: US-13`) — THE SYSTEM SHALL record the confirmation-email outcome (sent or failed, with its timestamp) on the registration row; WHEN a submission repeats an already-registered pair whose recorded outcome is `failed`, THE SYSTEM SHALL dispatch the confirmation email again and update that outcome; WHERE the recorded outcome is `sent`, THE SYSTEM SHALL NOT send a second email. No retry queue or scheduled sweep is introduced.
- **EARS-13** (`realizes: US-4`) — THE SYSTEM SHALL include in the confirmation email the event's name, date and place, the fact that a Doctor.School account was created for the participant, and the instruction that sign-in is by an emailed one-time code with no password. The exact copy is `PENDING owner Stage-A (#2287)`.
- **EARS-14** (`realizes: US-5`) — WHEN a congress-origin account's holder first enters the platform, THE SYSTEM SHALL take them through the existing email verification-code path, which is what flips `email_verified`, after which the existing email-OTP login succeeds; THE SYSTEM SHALL NOT set a credential on this account and SHALL NOT gate the sign-up itself on any confirmation step.
- **EARS-15** (`realizes: US-11`) — THE SYSTEM SHALL expose a public, read-only, cacheable specialties-list endpoint over `specialties_minzdrav` reachable through the same same-origin proxy, including the reserved «other» row; no build-time snapshot of the list is produced.
- **EARS-16** (`realizes: US-6`) — WHEN a signed-in doctor registers for the congress event through the existing platform registration path on a published event with `participationFormat: offline`, THE SYSTEM SHALL create the registration with no answers column value, and the roster SHALL render that row from the account's own profile values, leaving a cell empty where the profile has no value; no second answers form is added to the platform in v1.

### Work package #2289 — event-registrar role

- **EARS-17** (`realizes: US-8`) — THE SYSTEM SHALL add `event-registrar` as a coarse role to the API role set, sourced like every other role from the Zitadel project-roles claim and mirrored into `users.role`.
- **EARS-18** (`realizes: US-8`) — THE SYSTEM SHALL expose an HTTP route over the existing in-process `eventRoster()` read model, authorized for `event-registrar` and the platform administrator role.
- **EARS-19** (`realizes: US-8`) — THE SYSTEM SHALL refuse a principal holding only `event-registrar` on every API endpoint other than the roster route, the print-sheet data it reads and the session endpoints needed to hold a session — including every create, update and delete endpoint of the admin surface.
- **EARS-20** (`realizes: US-8`) — THE SYSTEM SHALL render the admin navigation from the signed-in principal's role, showing a principal holding only `event-registrar` the roster entry alone and no other section link; the client-side gate is a projection of the server refusal in EARS-19, never its substitute.

### Work package #2290 — admin roster

- **EARS-21** (`realizes: US-8`) — THE SYSTEM SHALL render the congress roster in `apps/admin` on the `AdminDataList` composition reused from the owner-approved admin Stage-A baseline (`012-requirements-en.md:203`), with its pagination, instant search and filter behaviour unchanged.
- **EARS-22** (`realizes: US-8`) — THE SYSTEM SHALL sort the roster server-side, by surname and by registration time, in both directions, with the sort state carried in the list query alongside search, filters and page.
- **EARS-23** (`realizes: US-8`) — THE SYSTEM SHALL offer roster filters on specialty, on city/region and on confirmation-email outcome, applied server-side and composable with search and sort.
- **EARS-24** (`realizes: US-8`) — THE SYSTEM SHALL render the roster view-only: no create, edit or delete affordance appears on the surface for any role, and the API exposes no mutation of a registration through this feature.
- **EARS-25** (`realizes: US-8`) — THE SYSTEM SHALL render the roster's columns in an owner-approved set and order, `PENDING owner Stage-A (#2287)`; the recommended default carried into that decision is № · ФИО · специальность · место работы · город/область · телефон · email · дата регистрации · письмо.

### Work package #2291 — printable attendance sheet

- **EARS-26** (`realizes: US-9`) — WHEN a registrar prints from the roster, THE SYSTEM SHALL produce a printable view containing exactly the rows of the roster as currently searched, filtered and sorted, through the browser's own print path and a print stylesheet; no file export is produced.
- **EARS-27** (`realizes: US-9`) — THE SYSTEM SHALL render the printed sheet in an owner-approved layout, `PENDING owner Stage-A (#2287)`, built from `@ds/design-system` primitives with tokens-only styling (ADR-0013).

## Invariants

- One person is one entity: a submitted email that already has an account never produces a second account (ADR-0016 §1).
- An unauthenticated submission never writes to an existing account's profile — the answers live on the registration row and nowhere else (EARS-5, EARS-6).
- The intake response carries no enumeration signal in body, status or timing class (EARS-7, EARS-8).
- A confirmation-email failure is never visible as a lost registration; the registration is committed first and the outcome is a recorded fact on it (EARS-11, EARS-12).
- `event-registrar` is deny-by-default: the roster route is the allowance, everything else is refused server-side (EARS-19).
- A congress-origin account carries no `medical-worker-declaration` row, and no surface treats that absence as an error (boundary line, Prior decisions).

## Verification

| #    | Kind                       | What it exercises                                                                                                                                                                                                                                                                    |
| ---- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| V-1  | Vitest e2e — `apps/api`    | New email → one account with no credential, one registration, one consent row, answers stored on the registration, `users.phone` untouched (EARS-3…EARS-5, EARS-9).                                                                                                                  |
| V-2  | Vitest e2e — `apps/api`    | Existing email → registration attached, every profile field byte-identical before and after; response body and status identical to V-1 (EARS-6, EARS-7).                                                                                                                             |
| V-3  | Vitest e2e — `apps/api`    | Repeat submission → same success response, no second row, no second email when the recorded outcome is `sent` (EARS-8, EARS-12).                                                                                                                                                     |
| V-4  | Vitest e2e — `apps/api`    | Missing or invalid captcha token → generic refusal disclosing no reason; throttle key derived from the forwarded client address behind a trusted proxy (EARS-1, EARS-2).                                                                                                             |
| V-5  | Vitest e2e — `apps/api`    | Free-text specialty and a missing required field rejected; patronymic omitted accepted (EARS-3).                                                                                                                                                                                     |
| V-6  | Vitest e2e — `apps/api`    | Mailer rejection → registration still present and queryable, outcome recorded `failed`; resubmission re-sends and flips the outcome (EARS-11, EARS-12).                                                                                                                              |
| V-7  | Vitest e2e — dev-stand IdP | The IdP accepts a human user created with no credential in our configuration, and that user is later able to complete the verification-code path (EARS-4, EARS-14).                                                                                                                  |
| V-8  | Vitest e2e — `apps/api`    | Email-OTP login refused before verification; verification-code path flips `email_verified`; OTP login then succeeds (EARS-14).                                                                                                                                                       |
| V-9  | Vitest e2e — `apps/api`    | Public specialties list returns the taxonomy including the «other» row, unauthenticated and cacheable (EARS-15).                                                                                                                                                                     |
| V-10 | Vitest e2e — `apps/api`    | Signed-in doctor registers on a published offline event; the row appears on the same roster with no answers payload (EARS-16).                                                                                                                                                       |
| V-11 | Vitest e2e — `apps/api`    | A principal holding only `event-registrar` reaches the roster route and is refused on every other endpoint, including all mutations (EARS-17…EARS-19, EARS-24). The `endpoint-authz` matrix rows for the roster route and the denial set are an implementation deliverable of #2289. |
| V-12 | Playwright / E2E — admin   | Registrar signs in, sees only the roster nav entry, searches, filters by specialty and by email outcome, sorts by surname and by registration time, pages, then opens the print view and reads back exactly the filtered rows (EARS-20…EARS-23, EARS-25, EARS-26).                   |
| V-13 | Playwright / E2E — admin   | The roster surface exposes no create/edit/delete control for any role (EARS-24).                                                                                                                                                                                                     |
| V-14 | axe                        | `playwright-axe` clean run on the roster screen and the print view (ADR-0013, EARS-21, EARS-27).                                                                                                                                                                                     |

## Work-package map

| EARS            | Work package                                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| EARS-1…EARS-16  | **#2288** — Public congress sign-up intake: passwordless account + consent + event registration + confirmation email |
| EARS-17…EARS-20 | **#2289** — Event-registrar role: refused everywhere else in the API, role-aware admin nav                           |
| EARS-21…EARS-25 | **#2290** — Admin roster of event registrations: search, filters, pagination, server-side sort (view-only)           |
| EARS-26…EARS-27 | **#2291** — Printable attendance sheet from the filtered roster                                                      |
