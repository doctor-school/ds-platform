# `sign-in-host` — the API of the first-party sign-in host (003 amendment, ADR-0015 §4)

The sign-in host (`login.doctor.school`, the Next app of S2 dispatch B) renders the
originating storefront's forms for a Zitadel v2 auth request and reaches these
routes through its own same-origin `/v1` rewrite, so every cookie set here is
host-only on the sign-in host. Every credential step runs the **same**
`AuthService` / `DoctorRegisterService` code, under the same guards, as its
storefront twin; the only difference is where the checked session goes — into
the shared browser-session record and the auth request's finalisation, never
into a storefront session (that is the storefront callback's redeem, below).

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
| Internal storefront routes (`/v1/internal/oidc/*`)                | `storefront-oidc.controller.ts`        | 8, 62, 63, 71                 |
| Transaction, redeem, linked-session refresh                       | `storefront-oidc.service.ts`           | 8, 62, 64, 71                 |
| Storefront clients' token calls, `private_key_jwt` (+ fake)       | `storefront-oidc.idp.ts`, `*.jwt.ts`   | 8, 62                         |
| Internal credential (bearer `INTERNAL_API_TOKEN`, 404 without it) | `internal-api.middleware.ts`           | 62                            |
| Back-channel logout (`POST /v1/auth/back-channel-logout`)         | `back-channel-logout.controller.ts`    | 65                            |

Contract (SSOT): `packages/schemas/src/auth/sign-in-host.schema.ts`; the
internal routes: `packages/schemas/src/auth/storefront-oidc.schema.ts`.

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

A registration that creates an account records `{sub, email, authRequestId}` in
that form state; the code step of the same form state, address and auth request
keeps the password typed at registration (the warm step, 003 EARS-39 amended) and
spends the marker. Without it the code step is cold: the code signs in and the
pre-verification password is invalidated (EARS-41). No password is stored.

### Internal routes (storefront servers only)

`/v1/internal/oidc/*` (`INTERNAL_API_PREFIX`) is not public API surface: every
public edge and BFF rewrite refuses the prefix, the routes are excluded from the
OpenAPI document and the generated client (`access: internal` in the matrix), and
`InternalApiMiddleware` answers 404 to a request without
`Authorization: Bearer <INTERNAL_API_TOKEN>`. The storefront Next server calls
them on the compose network (`api:3000`) with a typed fetch over the Zod schemas,
forwarding the browser's `user-agent`, `accept-language` and `x-forwarded-for`
exactly as its BFF rewrite does (they make the fingerprint and the per-IP limit).

| Route                   | Body → answer                                                                                         | Does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST oidc/transaction` | `StorefrontTransactionRequest` → `StorefrontTransactionResponse` `{txId, authorizeUrl}`               | EARS-61/71: generates `state`, `nonce` and the PKCE verifier, stores the transaction `{client, door, state, nonce, verifier, returnPath?, completeRegistration?, intentId?}` sealed at rest for its kind's life (interactive 60 min, silent 60 s), binds the entry intent (its id is the authorize `login_hint`), and builds the whole authorize URL — issuer, the storefront's `client_id`, its one `redirect_uri` `<storefront>/auth/callback`, `S256`, `response_mode=query`, `prompt=create` for registration. The verifier never leaves the API                                                                                                                                                                                                                                                                                      |
| `POST oidc/redeem`      | `StorefrontRedeemRequest` `{client, txId?, state, code?}` → `StorefrontRedeemResponse` + `Set-Cookie` | EARS-62/8: takes the transaction single-use and checks `state`; the code at Zitadel's token endpoint with the client's `private_key_jwt` + the held verifier; the ID token verified (JWKS, `iss`, `aud`, `exp`, the held `nonce`); its `sid` must be a usable record — live and the same browser fingerprint (`recordVerdict`). Mints a fresh linked session; one generic 401 `{returnPath, door}` otherwise. A `state` that is not the browser's own transaction (no `txId`, or another one) still takes the transaction that `state` names (found by `SHA-256(state)`), spends its code once with that transaction's verifier, discards the tokens, mints nothing and appends `auth.session.rejected` (`state_mismatch`, storefront tier); an unknown `state` runs no exchange (no held verifier can satisfy the code's PKCE challenge) |

The redeem answers `Set-Cookie: __Host-ds_session=…` (host-only, `HttpOnly`,
`Secure`, `SameSite=Lax`, `Max-Age` ≤ the record's remaining life) and
`Cache-Control: no-store`; the body carries `{sub, roles, mfa, returnPath, door,
completeRegistration}` — the transaction's return path and door, and the эфир
slug whose registration the callback completes (005 EARS-2). The storefront
server relays that `Set-Cookie` header unchanged on its callback response.
Limits: per forwarded client IP, own scopes `oidc:entry` (the transaction) and
`oidc:redeem`, 1200 / 15 min each.

**Silent check** (003 EARS-63, ADR-0015 §4 req. 9). `POST oidc/silent-check`
(`StorefrontSilentCheckRequest` `{client, returnPath?, replaces?}` →
`{txId, authorizeUrl}`) creates a `kind: silent` transaction (60 s, authorize
`prompt=none`) and deletes the interactive transaction it `replaces`;
`POST oidc/transaction` refuses `kind: silent` with 400. The silent path has its
own per-IP bucket `oidc:silent-check`, 1200 / 15 min, counting each start, each
sign-in-host entry of a `prompt=none` auth request (limited → finalised with
`login_required`) and each silent redeem (limited → nothing redeemed, the
transaction deleted, a refusal). Refusal and success bodies carry the
transaction's `kind`; a silent redeem without `txId` whose `state` names a live
silent transaction burns it and answers the refusal with its return path and
kind.

**Linked sessions.** A redeemed session carries `zitadelSessionId` and
`oidcClient`. Its refresh (`POST /v1/auth/refresh`) rotates through that
storefront client's `private_key_jwt`, never the BFF client, and keeps its
bounded expiry. Its sign-out (`POST /v1/auth/logout`) terminates the Zitadel
session, deletes the record and revokes every session linked to it on both
storefronts; a fresh credential step that replaces a record revokes the
sessions linked to the old one (EARS-64). Legacy sessions keep their paths.

### Back-channel logout (003 EARS-65)

`POST /v1/auth/back-channel-logout` is the `back_channel_logout_uri` both
storefront clients register at Zitadel (OIDC Back-Channel Logout 1.0). Zitadel
posts a form-encoded `logout_token` when it ends a session outside a storefront
sign-out (the IdP console, «sign out on all devices»). The token is verified
before anything is revoked — RS256 against the issuer JWKS, `iss`, `aud` one
of the two storefront clients, a fresh `iat`/`exp`, the back-channel
`events` member, a `sid`, no `nonce` (`verifyLogoutToken`,
`storefront-oidc.jwt.ts`); then every storefront session linked to that `sid`
is revoked on both storefronts (`SessionRevoked` each, reason `force`) and,
when the token carries the `sub` (Zitadel always sends it), the record holding
it deleted. `200` on success, `400 {"error":"invalid_request"}` on any invalid
or non-form request, both `Cache-Control: no-store`; public (the signature is
the credential), own per-IP bucket `oidc:back-channel-logout` (1200 / 15 min —
the caller is Zitadel's one address), excluded from the OpenAPI document.

A reset (EARS-12) ends every session of the person through the one subject
revocation (`SessionService.revokeSubject` → this module's records and their
Zitadel sessions). An automatic lockout (EARS-15, native Zitadel) ends every
session of the person inside Zitadel: the session projection deletes their
Zitadel sessions and the token endpoint refuses their refresh
(`invalid_request` `Errors.User.NotActive`, proved live in
`test/auth/zitadel-lock-ends-sessions.e2e-spec.ts`), so each linked storefront
session ends alone at its next refresh; this module adds no revocation for it.
Only a refresh Zitadel refuses as `invalid_grant` is reuse: it revokes the
whole linked set (`SessionRevoked` reason `theft_detected`). Any other refused
refresh — an IdP outage, a locked person — ends only the presenting session
(reason `force`), with no theft verdict.

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
| Delete on           | replace, fingerprint mismatch, subject revocation, sign-out (EARS-10)                              |
| Form state / intent | Redis TTL — form state 24 h; intent = its transaction's lifetime; revocation fence 30 days         |

## Configuration

All six keys set ⇒ enabled; any blank ⇒ every route answers 404 and nothing runs:
`IDP_ACADEMY_CLIENT_ID`, `IDP_DOCTOR_CLIENT_ID` (provision.sh step 3.bis),
`IDP_SIGN_IN_BASE_URI` (the host origin a form post must carry),
`SIGN_IN_ACADEMY_LOGIN_URL`, `SIGN_IN_DOCTOR_LOGIN_URL` (EARS-66/67 returns),
`SIGN_IN_RECORD_KEY` (base64 of 32 bytes; dev/CI values are public, stage/prod
secret provisioning is #3171).

The internal routes additionally need `INTERNAL_API_TOKEN` (≥ 32 bytes; unset ⇒
they answer 404) and, wherever `IDP_ISSUER` is set, `IDP_ACADEMY_CLIENT_KEY` /
`IDP_DOCTOR_CLIENT_KEY` — the Zitadel application key JSON, base64 on one line,
parsed at boot and never logged (a client without its key fails closed).

## Not here

The storefront routes themselves (entry, callback, sign-out, cookie relay — the
storefront Next servers), the silent check (#3173), the Next app,
headers and CSP of the sign-in host.
