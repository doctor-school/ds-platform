# `sign-in-host` — the API of the first-party sign-in host (003 amendment, ADR-0015 §4)

The sign-in host (`login.doctor.school`, the Next app of S2 dispatch B) renders the
originating storefront's forms for a Zitadel v2 auth request and reaches these
routes through its own same-origin `/v1` rewrite, so every cookie set here is
host-only on the sign-in host. Every credential step runs the **same**
`AuthService` / `DoctorRegisterService` code, under the same guards, as its
storefront twin; the only difference is where the checked session goes — into
the shared browser-session record and the auth request's finalisation, never
into a storefront session (that is the storefront callback's redeem, S3).

## What's here

| Concern                                                           | File                                   | EARS                          |
| ----------------------------------------------------------------- | -------------------------------------- | ----------------------------- |
| Routes (`/v1/sign-in-host/*`)                                     | `sign-in-host.controller.ts`           | 5, 24, 44, 60, 64, 66–71      |
| Entry decision, form-post check, accept-into-record               | `sign-in-host.service.ts`              | 5, 44, 60, 64, 66, 67, 68, 70 |
| Lifetime / idle / fresh-credential rules (pure)                   | `sign-in-host.policy.ts`               | 5, 64, 68                     |
| Settings block (client map, login URLs, record key) — 404 unset   | `sign-in-host.config.ts`               | 60, 66, 67                    |
| Zitadel v2 auth-request + session-lifetime adapter (+ fake)       | `sign-in-host.idp.ts`, `*.idp.fake.ts` | 5, 60, 64                     |
| Record store (`sign_in_host_records`, sealed at rest)             | `sign-in-host-record.store.ts`         | 64                            |
| Form state, entry intent, subject-revocation fence (Redis/memory) | `sign-in-host-state.store.ts`          | 12, 66, 70, 71                |
| Subject revocation (reset / first verification ends records)      | `sign-in-host-subject-revocation.ts`   | 12, 41                        |
| Retention purge (hourly)                                          | `sign-in-host-record.purge.ts`         | 64                            |
| Cookies (`__Host-ds_login`, `__Host-ds_login_form`)               | `sign-in-host.cookies.ts`              | 64, 70                        |

Contract (SSOT): `packages/schemas/src/auth/sign-in-host.schema.ts`.

## Routes

| Route                                 | Does                                                      | Storefront twin (same guards)             |
| ------------------------------------- | --------------------------------------------------------- | ----------------------------------------- |
| `GET entry?authRequest=`              | render / redirect decision; sets the form-state cookie    | — (own per-IP scope `sign-in-host:entry`) |
| `POST login`                          | password step → record + finalise                         | `POST /v1/auth/login`                     |
| `POST login/otp/request`, `login/otp` | code request / code step → record + finalise              | `POST /v1/auth/login/otp[/request]`       |
| `POST login/otp/handoff`              | redeems the reference the spent intent carried            | `POST /v1/auth/login/otp/handoff`         |
| `POST register`                       | Academy registration (Academy form only)                  | `POST /v1/auth/register`                  |
| `POST verify`                         | Academy code step → record + finalise (Academy form only) | `POST /v1/auth/verify`                    |
| `POST verify/resend`                  | re-issues the registration code (either form)             | `POST /v1/auth/verify/resend`             |
| `POST storefront/doctor/register`     | doctor registration (doctor form only)                    | `POST /v1/storefront/doctor/register`     |
| `POST storefront/doctor/verify`       | doctor code step → record + finalise (doctor form only)   | `POST /v1/storefront/doctor/verify`       |
| `POST password/reset[/complete]`      | reset request / completion → record + finalise            | `POST /v1/auth/password/reset[/complete]` |

Every `POST` is refused with one `403` unless `Origin` is the host's own origin,
`Sec-Fetch-Site` (when sent) is `same-origin`, and the CSRF token equals the one
bound to the pre-existing form-state cookie for that very auth request. No route
sets a CORS header.

## The record and its lifetime

One row per browser behind `__Host-ds_login`; the table holds only
`SHA-256(cookie id)`. The Zitadel session id and token are sealed with
`common/crypto/at-rest.ts` (AES-256-GCM, key `SIGN_IN_RECORD_KEY`, the row key as
bound context). A credential step sets the Zitadel session's explicit 30-day
lifetime once (`acceptInto`), replaces any prior record (old session terminated,
cookie id rotated) and finalises the auth request. A later authorize answered by
the record moves only `last_finalised_at`; nothing ever moves `expires_at` or the
Zitadel lifetime.

Revoking every session of a subject (a completed reset, the first accepted code
of an unverified account) goes through the auth layer's one
`SubjectRevocationHub`: this module fences the revocation instant (a record whose
credential step precedes it is refused on every use), deletes the subject's rows
and terminates their Zitadel sessions — before the step that asked for it mints
its own record. A record is stamped with the instant its credential check
STARTED (the acceptor is built before the check runs), and after the insert
the fence is read again: a revocation at or after that instant deletes the
row, terminates its Zitadel session and refuses the step, so a sign-in with
the old password that races a reset never survives it. A step that itself
revoked the subject is stamped at its own fence and ends only on a later one.

## Retention

The repository keeps no central DB retention registry; this table's retention is
declared here and in the schema file, and enforced by the purge:

| Rule                | Value                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| Absolute lifetime   | 30 days from the credential step (`expires_at`), never extended                                    |
| Idle timeout        | 7 days without a finalised authorize (`last_finalised_at`)                                         |
| Purge cadence       | hourly (`SignInHostRecordPurge`), 500 rows per batch; each purged row's Zitadel session terminated |
| Delete on           | replace, fingerprint mismatch, subject revocation, sign-out (S6)                                   |
| Form state / intent | Redis TTL — form state 24 h; intent = its transaction's lifetime; revocation fence 30 days         |

## Configuration

All six keys set ⇒ enabled; any blank ⇒ every route answers 404 and nothing runs:
`IDP_ACADEMY_CLIENT_ID`, `IDP_DOCTOR_CLIENT_ID` (provision.sh step 3.bis),
`IDP_SIGN_IN_BASE_URI` (the host origin a form post must carry),
`SIGN_IN_ACADEMY_LOGIN_URL`, `SIGN_IN_DOCTOR_LOGIN_URL` (EARS-66/67 returns),
`SIGN_IN_RECORD_KEY` (base64 of 32 bytes; dev/CI values are public, stage/prod
secret provisioning is #3171).

## Not here

The storefront callback / redeem and storefront-session linkage (S3 #3171), the
silent check (S4), back-channel logout and sign-out (S6), the Next app, headers
and CSP (S2 dispatch B).
