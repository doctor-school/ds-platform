---
title: "044 — Congress sign-up (Design)"
description: "Intake cascade over the shared 003 account engine, passwordless IdP user creation, answers and mail-outcome storage on the registration row, consent versioning, the event-registrar authorization boundary, and the roster/print projections."
slug: 044-congress-signup
lang: en
---

# 044 — Congress sign-up (Design)

Requirements: [`044-requirements-en.md`](./044-requirements-en.md) · PRD: [`044-product.md`](./044-product.md).

## Transport boundary

The API has no CORS and gains none. The congress site's own nginx terminates the participant's request and proxies `/api` to the platform API, so the browser only ever talks same-origin to the site. Two consequences the implementation must honour:

- The site's nginx egress address enters `TRUSTED_PROXIES` (`apps/api/src/config/trust-proxy.ts:97-120`). Fastify's `trustProxy` walks `X-Forwarded-For` right-to-left and stops at the first untrusted hop; without this entry the rate-limit key (`apps/api/src/auth/rate-limit/rate-limit.types.ts:57-62`) collapses to the proxy address and the per-IP window becomes a global cap on the whole congress site. The intake scope raises that window from the platform default of 20 submissions per 15 minutes (`DEFAULT_RATE_LIMIT_THRESHOLDS.perIpPer15Min`, `apps/api/src/auth/rate-limit/rate-limit.types.ts:34`) to **60 per 15 minutes per client address**: congress participants register in bursts from a shared clinic or venue NAT address, and every one of those submissions still has to pass the captcha, so the captcha — not the window — is the bot bound here.
- Bot protection is per-route opt-in: the global guard no-ops unless the handler carries `@BotProtected` (`apps/api/src/bot-protection/bot-protection.guard.ts`), and the SmartCaptcha provider reads the token from the `x-smartcaptcha-token` header or the `captchaToken` body field. The intake route declares the decorator explicitly; a rejection throws the generic exception that discloses no reason.

## Registration window

The window is two instants — an opening and a closing one — held as constants of this congress in the API's own code or configuration. There is deliberately no settings row and no admin screen: a second event needing its own window is the point at which the constant becomes data, and until then a stored window would be a schema, a migration and an admin surface carrying exactly one value (`DEBT.md`, 2026-09-21). The opening instant is 2026-10-01 00:00 Europe/Moscow. The closing instant is provisionally 2027-01-01 00:00 Europe/Moscow: a placeholder the product owner replaces with the real closing date-time before the launch work package (#2292), which is why the window is a constant rather than a guessed permanent date.

The check is the first thing the intake handler does once the endpoint's guards (`@BotProtected` captcha verification, the rate limiter) and request validation have let the submission through — before the account lookup and before any write — so that a submission outside the window cannot create an account, a registration, a consent row or an email under any branch. Its refusal carries a machine-readable state, `not-yet-open` (with the opening instant, so the caller can render the date) or `closed`, and that refusal is identical for every submitter: it is a property of the clock, never of the submitted email, so it opens no enumeration channel.

Enforcement lives in the API; the congress site only displays the two states. Before the opening instant it renders «Регистрация откроется ДД.ММ в ЧЧ:ММ (мск)» and after the closing instant «Регистрация на конгресс закрыта», in both cases with no form at all — the API refusal is the backstop for a stale page or a direct call, not the participant's normal experience. The dates the site displays and the API constant are the same instants; keeping them equal is a launch check on #2292, because they live in two repositories.

Scope is decided, not open: the window governs the public congress-site intake endpoint only. The signed-in platform path (EARS-16) is deliberately not bound by it and continues to follow the event's own registration rules. The window is also the only bound on intake: no capacity cap, no seat count, no waiting list.

## Contact-phone normalisation and the possible-duplicate derivation

The submitted contact phone is kept twice on the registration's answers: exactly as the participant typed it, and in a normalised form used only for comparison — a leading `+7` or `8` unified to one form, spaces, brackets and dashes stripped. Neither value ever reaches `users.phone`, which is UNIQUE and a login identifier (`packages/db/src/schema/users.ts:29-101`); an unverified typed phone there would either refuse the registration or attach it to the wrong account.

The «возможный дубль» marker is **derived at read time**, not stored: the roster query groups the event's registrations by the normalised phone and marks every registration whose normalised phone is shared by at least one other registration of the same event. Two consequences follow, and both are the reason for the choice. When the team removes one of the sharing registrations through its manual deletion-on-request, the survivor stops being marked with no write and no sweep — a stored flag would have to be recomputed by someone. And a registration with no answers payload (the platform-origin path, EARS-16) has no contact phone at all, so it falls out of the grouping and is never marked.

The marker changes nothing about intake: submissions sharing a phone are accepted exactly like any other, with the same identical success response of EARS-7. A refusal or any hint of a shared phone would both break that response identity and leak that some other person registered with that number.

## Intake cascade — new account

```mermaid
sequenceDiagram
    autonumber
    participant V as Participant browser
    participant N as Congress-site nginx (/api proxy)
    participant A as apps/api intake handler
    participant C as SmartCaptcha
    participant I as IdP (Zitadel)
    participant D as Postgres
    participant M as Mailer

    V->>N: POST /api/... (answers + consent + captcha token)
    N->>A: same-origin proxy, X-Forwarded-For = participant
    A->>A: registration window check (before any side effect; refuses not-yet-open / closed)
    A->>C: verify(token, action, forwarded ip)
    C-->>A: ok
    A->>A: Zod validate (packages/schemas), specialty = taxonomy id | other
    A->>D: lookup account by email
    D-->>A: none
    A->>I: create human user WITHOUT credential
    I-->>A: subject id
    A->>D: BEGIN
    A->>D: upsert users (sub, email, guest role, prefilled display name)
    A->>D: insert registrations (user, event, answers)
    A->>D: insert consent_records (congress personal-data purpose, version)
    A->>D: COMMIT
    A-->>V: generic success (shape/status/timing identical to existing-account path)
    A-)M: dispatch confirmation email (off the response path)
    M-->>A: sent
    A->>D: update registration mail outcome = sent, at = now
```

## Intake cascade — existing account

```mermaid
sequenceDiagram
    autonumber
    participant V as Participant browser
    participant A as apps/api intake handler
    participant D as Postgres
    participant M as Mailer

    V->>A: POST intake (same shape)
    A->>D: lookup account by email
    D-->>A: existing user id
    Note over A,D: no profile field of the existing account is written
    A->>D: BEGIN
    A->>D: insert registrations (user, event, answers) ON CONFLICT (user_id,event_id) DO NOTHING
    alt published consent version differs from the recorded one
        A->>D: insert consent_records (new acceptance row)
    else same version already recorded
        Note over A,D: no second consent row
    end
    A->>D: COMMIT
    A-->>V: the SAME generic success body and status
    alt registration was newly inserted, or its recorded outcome is failed
        A-)M: dispatch confirmation email
    else outcome already sent
        Note over A,M: no second email
    end
```

The two diagrams differ only in the branch the server takes; the response the participant observes is byte-identical in shape and status, and the account-creation hop is kept off the latency difference that would otherwise leak existence (the same isolation the 003 engine already applies to its account-exists notice, `apps/api/src/auth/auth.service.ts:596-628`).

## Mail failure

```mermaid
sequenceDiagram
    autonumber
    participant A as apps/api intake handler
    participant D as Postgres
    participant M as Mailer

    A->>D: COMMIT (account + registration + consent)
    A-->>A: HTTP response already returned
    A-)M: dispatch confirmation email
    M--xA: ChannelRejection after failover
    A->>D: update registration mail outcome = failed, at = now
    Note over A,D: the registration is NOT rolled back and NOT retried on a schedule
    Note over A: recovery = the participant resubmits the form; the idempotent path re-sends
```

The existing mailer throws a typed rejection only to a caller that awaits it (`apps/api/src/mailer/smtp-mailer.ts:207-244`); the 003 auth callers deliberately never await on the response path (`auth.service.ts:550-556`, `:618-628`). 044 keeps that isolation but, unlike 003, does not merely log: the outcome becomes a column on the registration row so the registrar sees it in the roster and the resubmission path has something to decide on. No outbox, no scheduled sweep — the recovery mechanism is the participant resubmitting, which the `(user_id, event_id)` uniqueness already makes safe.

## Registration and mail state

```mermaid
stateDiagram-v2
    [*] --> Absent
    Absent --> Registered: intake committed (account + registration + consent)
    Registered --> Registered: repeat submission (ON CONFLICT DO NOTHING)

    state Registered {
        [*] --> MailPending
        MailPending --> MailSent: dispatch succeeded
        MailPending --> MailFailed: dispatch rejected after failover
        MailFailed --> MailSent: resubmission re-dispatch succeeded
        MailFailed --> MailFailed: resubmission re-dispatch rejected again
        MailSent --> MailSent: resubmission (no second email)
    }

    note right of Registered
        Registered is terminal for this feature:
        no edit, no delete surface (owner decision).
        Deletion on request is a manual, out-of-band action.
    end note
```

## IdP acceptance of a credential-less human user

`IdpClient.createUser` types `password: string` as mandatory (`apps/api/src/auth/idp/idp.types.ts:84`, port at `:279`), and the Zitadel adapter always nests a `password` inside the `human` body of `POST /v2/users/new` (`apps/api/src/auth/idp/zitadel.idp.ts:302`, body at `:316-341`). No code path constructs the human without it, and no bulk-import or Academy path creates a credential-less user today — so 044 adds the first one: the input type gains a passwordless variant and the adapter omits the `password` member entirely (not an empty string) for that variant. The adapter's existing placeholder `givenName`/`familyName` fabrication (`:325-341`) is replaced on this path by the submitted surname and first name, which 044 actually collects.

Whether our Zitadel configuration accepts a human user created with no credential — and whether such a user can subsequently complete the verification-code path and then log in by one-time code — is an environment fact, not a code fact, and is settled by a live check against the dev-stand IdP rather than assumed.

Evidence: live dev-stand check 2026-09-21 — `POST /v2/users/new` with the adapter body minus `human.password` → 200, user `USER_STATE_ACTIVE`; probe user deleted. The vendor API reference marks the `password` oneof as required in error (zitadel/zitadel#12699).

## First platform entry

Email-OTP login is not a verification mechanism. For an email-unverified account the port silently re-issues the verification code instead of an `otp_email` login code, and the synchronous acknowledgement is identical for verified, unverified and nonexistent addresses (`apps/api/src/auth/auth.service.ts:216-239`); a successful OTP login never flips `email_verified` — the only writers are the dedicated verify path (`:684`) and password-reset completion (`:413`).

So the congress account's first entry is the existing verification-code path: the participant requests a code for the email they typed, enters it, `email_verified` flips, and from then on the existing email-OTP login works. This is exactly the owner's «Укажешь чужую — не попадёшь»: address ownership is proven the first time the platform is actually used, and nothing gates the sign-up itself. 044 introduces no parallel verification flow — the endpoints are the ones 003 already ships.

## Data model

```mermaid
erDiagram
    users ||--o{ registrations : "has"
    users ||--o{ consent_records : "granted"
    events ||--o{ registrations : "collects"
    specialties_minzdrav ||--o{ registrations : "referenced by answers.specialtyId"

    users {
        uuid id PK
        citext email UK
        text zitadel_sub UK
        text phone UK "never written by 044"
        text display_name "prefilled on a NEW account only"
        bool email_verified "flipped by the verify path, not by OTP login"
        text role
    }

    registrations {
        uuid id PK
        uuid user_id FK
        uuid event_id FK
        timestamptz registered_at
        jsonb answers "NEW - null for platform-origin rows; carries the phone as typed and normalised"
        text confirmation_mail_status "NEW - pending | sent | failed"
        timestamptz confirmation_mail_at "NEW"
        text record_status
    }

    consent_records {
        uuid id PK
        uuid user_id FK
        text purpose "NEW value: congress personal-data"
        text version "publication date + sha256 of the published text"
        timestamptz captured_at
    }

    specialties_minzdrav {
        uuid id PK
        text code UK
        text name UK
        bool is_other "the «Другое / не медицинский работник» row"
    }
```

**`registrations.answers`** (`packages/db/src/schema/registrations.ts:42-93` gains the column) holds surname, first name, optional patronymic, the contact phone both as typed and normalised, email, specialty reference (a `specialties_minzdrav` id or the `is_other` row), workplace, city and region. The shape is owned by a Zod schema in `packages/schemas` — the same schema validates the intake request, so the column can never hold a shape the API would reject. The column is nullable because the platform-origin path (a signed-in doctor registering from the feed) writes no answers; the roster renders those rows from the account's profile and leaves a cell empty where the profile has no value.

**`registrations.confirmation_mail_status` / `_at`** make the send outcome a queryable fact rather than a log line, which is what lets the roster show it, the roster filter on it and the resubmission path decide whether to re-send.

**`consent_records`** stays append-only and immutable (`packages/db/src/schema/consent-records.ts:26-36`): every acceptance is its own row, and the version is server-stamped exactly as the doctor-storefront door stamps its own purposes (`doctor-register.service.ts:38-63`), never taken from the caller. The new purpose constant joins the closed list in `@ds/schemas`; the DB column stays free text.

## Specialties list endpoint

The only public specialty-related endpoint today is the per-browser choice cookie (`apps/api/src/storefront/specialty-choice.public.controller.ts:84-97`, `:136-194`) — it remembers one selection, it does not enumerate the book. 044 adds a public, unauthenticated, read-only list over `specialties_minzdrav`, cacheable at the HTTP layer, reached through the same same-origin proxy as the intake. No build-time snapshot is produced: a snapshot baked into the congress site would drift from the taxonomy silently and would make a taxonomy correction require a site redeploy.

## Authorization boundary

The role set in `apps/api/src/authz/authz.types.ts:18-27` gains `event-registrar`. Authorization reads the Zitadel project-roles claim (`zitadel.idp.ts:119`), not the `users.role` mirror, which stays a downstream projection. The `Authz` decorator on each endpoint remains the Layer-1 single source of truth, so the role's reach is expressed as matrix rows, not as scattered checks:

- the roster route and the data the print view reads → allowed for `event-registrar` and the platform administrator;
- every other endpoint → explicitly refused for a principal holding only `event-registrar`, including all mutations of the admin surface.

`apps/admin`'s access gate is binary today — one trusted role, and the nav renders seven static links with no filtering (`apps/admin/providers/access-control-provider.ts:6-41`, `apps/admin/components/app-shell.tsx:64-117`). 044 makes both role-aware. The client-side gate is a projection: it decides what to draw, never what is permitted. A registrar who types another section's URL is refused by the server, and the admin simply has nothing to render.

## Roster and print projections

The roster is an HTTP route over the existing in-process `eventRoster()` read model (`apps/api/src/registration/registration.service.ts:178-181`), widened from its current PII-free `(doctor, event, registeredAt)` fact to the answers the registrar needs. It renders on `AdminDataList` (`apps/admin/components/admin-data-list.tsx:62-371`), whose query state today carries `q`, `status`, `includeRetired`, `page` and `pageSize` and no sort field at all. 044 adds sort and filter to that query state and to the server query, one pair per roster column: contains-search on the text columns (ФИО, место работы, город, область, телефон, email), a select on специальность and on статус письма, and a range on дата регистрации; sort accepts any of the same columns, in both directions. № is a row counter and carries neither sort nor filter. The «возможный дубль» marker joins that query state as one more server-side filter — a yes/no predicate over the read-time derivation above, composable with the search, the column filters, the sort and the page like any other. It is not an eleventh column: it is an indicator on the row, so the column order stays exactly the one EARS-25 fixes; where the indicator sits on the row is settled at implementation through the admin Stage-A design gate rather than guessed here. Because sort and filter are server-side, the printed sheet and the screen agree on ordering and scope across pages (owner-approved scope, #2287 issuecomment-5756369423: «Сортировка и фильтрация должна быть по всем полям вообще»).

The print view is the same filtered, sorted query rendered for paper: the browser's own print path plus a print stylesheet, which is the first `@media print` rule anywhere in `apps/admin` or `packages/design-system`. Nothing is exported to a file. Per the owner's approved variant «Б, без подписи и статуса письма» (#2287 issuecomment-5756369423), the sheet is a full copy of the currently filtered and sorted roster with every roster column except `статус письма`, no signature column, and a header carrying the event's name and date. The «возможный дубль» marker prints on the affected rows too: the registrar works the desk from the sheet, and a duplicate that is only visible on screen would be invisible exactly where it matters.
