---
title: "003 — User authentication (net-new web → doctor_guest)"
description: "Requirements: net-new self-service web authentication for the doctor portal — registration, email/phone verification, password + passwordless (email-OTP / SMS-OTP) login, BFF session over a __Host- cookie, token rotation, logout, and password reset. Produces a backend doctor_guest mirror over Zitadel as the IdP. First product feature-spec."
slug: 003-user-authentication
status: Draft
tracker: https://github.com/doctor-school/ds-platform/milestone/3
parent_issue: https://github.com/doctor-school/ds-platform/issues/80
issues: [81, 82, 83, 84, 85, 86, 87, 88, 89, 90]
prior_decisions:
  - ADR-0001 — Identity / Auth / RBAC (IdP = Zitadel; §1 hybrid RBAC, §3 dual identifiers, §4 auth methods, §6 tokens, §7 security baseline, §7.3 audit)
  - ADR-0002 — Backend Core Stack (§3 nestjs-zod + URI versioning + Vitest)
  - ADR-0003 — Data Layer (§5 idempotency_keys, §6 audit_ledger)
  - ADR-0009 — PD lifecycle & consent (per-purpose versioned consent capture)
  - ADR-0006 — Documentation & SSOT (§4 feature-spec triplet + flat EARS)
lang: en
---

> **EN (this)** · **RU:** [`003-requirements-ru.md`](./003-requirements-ru.md)

# 003 — User authentication (Requirements)

## Outcomes

- A net-new visitor can self-register on the doctor portal and obtain a backend identity in the `doctor_guest` role (ADR-0001 §1), authenticated against **Zitadel as the IdP** (ADR-0001 §8).
- Credentials, sessions, tokens, OTP delivery, and password storage are **owned by Zitadel** and consumed through its Session / User v2 API — `apps/api` never reimplements an auth primitive (see Constraints and design §2).
- The doctor portal presents **headless inline forms on its own origin** (ADR-0001 §2 — Variant B; no redirect to an IdP-hosted login app). The browser holds only a `__Host-` session cookie; access/refresh tokens never reach client JavaScript (BFF pattern, design §3).
- Every authenticated principal produced by this feature is a `doctor_guest` mirror row in the backend (`users`), keyed by UUID with the dual-identifier invariant `phone OR email NOT NULL` (ADR-0001 §3), synced from Zitadel.
- Per-purpose, versioned **consent is captured at registration** before any personal-data (PD) row is created (ADR-0009).
- The mandatory v1 **security baseline** (ADR-0001 §7) — rate limiting, account lockout, enumeration resistance, SMS toll-fraud circuit-breaker, CAPTCHA — is enforced on the auth surface.

## Scope

**In:**

- Self-service registration on the portal with **email + password** and with **phone + password** (dual identifier, ADR-0001 §3).
- **Email verification** (Zitadel email OTP code) and **phone verification** (Zitadel SMS OTP code).
- **Password login** by email or phone.
- **Passwordless email login via OTP code** (Zitadel `otp_email`; the user types the code — _not_ a magic link, see Out).
- **Phone login via SMS-OTP** (Zitadel `otp_sms`).
- **BFF session establishment**: `apps/api` completes the OIDC exchange against the Zitadel session, stores the rotating refresh token server-side in Redis, and sets a per-origin `__Host-` session cookie (ADR-0001 §6).
- **Token refresh / rotation** (opaque, single-use; refresh-reuse invalidates the chain — ADR-0001 §6, §7).
- **Logout** (server-side session DELETE → cookie cleared).
- **Password reset** (Zitadel forgot-password code flow): initiate + complete.
- **Backend user-mirror** of the `doctor_guest` user, created/updated from a Zitadel Action webhook, with a minimal reconciliation sweep.
- **Consent capture** at registration via the ADR-0009 mechanism (records the per-purpose consent versions the registrant accepted).
- **Security baseline** (ADR-0001 §7): rate limits (per-user / per-IP / per-ASN), account lockout (native Zitadel lockout policy + our notification email), enumeration-resistant responses, SMS toll-fraud per-phone/IP/ASN limits + a global daily SMS-budget circuit-breaker.
- **Bot-protection bootstrap.** 003 is the platform's first consumer of bot-protection, so it bootstraps the mechanism behind a `BotProtection` provider interface — a Yandex SmartCaptcha adapter (server-side token verification in `apps/api`) + the widget on the portal auth forms. The provider stays swappable per ADR-0001 open-q #7; 003 owns the policy of _where_ it applies (EARS-17).
- **Auth audit events** written to `audit_ledger` (this section is the "spec §7.3" forward-referenced from ADR-0001 §7, §10).

**Explicitly out** (each is a documented seam consumed by a later vertical — design §7):

- **Legacy-doctor reactivation** (the ~10k Directual hard cutover, hash-compat vs forced reset, first-login flow). Stays an operational artifact + later spec per ADR-0001 §9. 003 only exposes the primitives it will reuse (email-OTP, SMS-OTP, consent capture, mirror sync).
- **MFA enrollment / enforcement.** `doctor_guest` carries no MFA mandate (ADR-0001 §4). 003 ships the `mfa` claim in the session (ADR-0001 §1) and a documented `role → mfa_required` policy seam, but builds **no** TOTP enrollment/verification and populates the policy with **no** elevated roles. The first vertical with a mandatory-MFA role (admin/ops → `platform_admin`; v2 `expert` etc.) builds the mechanism.
- **Magic-link** (clickable login URL). Superseded for v1 by native email-OTP. A thin transport over the native one-time secret + the ADR-0001 §8 security review remains a seam.
- **Authentication of `platform_admin` / `legacy_admin`.** Those are provisioned/ops principals (admin-console vertical) or cutover-owned (ADR-0001 §9), not self-registration outputs.
- **Mobile auth** (device-id-bound refresh, Keychain/Keystore, biometric unlock, native OAuth hop — ADR-0001 §6, ADR-0005). Separate iteration over the same backend primitives.
- **Social OAuth** (VK ID / Yandex ID / Telegram) — v2 per ADR-0001 §5; **account linking** — ADR-0001 §6.2.
- **Step-up authentication** for high-risk actions (ADR-0001 §10) — no high-risk `doctor_guest` endpoints exist yet.
- Full **consent subsystem** (withdrawal, version migration, consent audit) — owned by the ADR-0009 vertical; 003 only captures at registration.
- WebAuthn / Passkeys, HIBP pwned-password check, anomaly/impossible-travel detection — deferred per ADR-0001 deferred-gaps table.

## Constraints

- **IdP boundary (hard).** Credential verification, session lifecycle, token issuance/rotation, JWKS/OIDC, OTP delivery (email + SMS), password storage, and account-lockout counting are **native Zitadel** features — consumed via the Session / User v2 API, never reimplemented in `apps/api`. The native-vs-custom split is fixed in design §2 (table). AGPL §13 discipline applies: integrate via API/Actions/config only; **do not patch Zitadel source** (ADR-0001 §8).
- **UI model = Variant B (headless inline).** Forms live on the portal origin; the BFF brokers Zitadel calls. No IdP-hosted login app, no auth-subdomain redirect for credentials (ADR-0001 §2). Zitadel Login v2 was considered and rejected for v1 (design §8 — recorded so it is not re-litigated).
- **No hardcoded origin.** The portal origin / cookie domain are read from configuration, never hardcoded in code or spec (mirrors AGENTS.md §9.1). `__Host-` cookies are origin-bound by construction.
- **Tokens** (ADR-0001 §6): access JWT 15 min (RS256/ES256); refresh opaque, rotating, single-use, 30 d web; refresh stored server-side in Redis on the BFF; `__Host-` cookie HttpOnly + Secure + SameSite=Lax, per-app origin (no cross-subdomain shared cookie). JWT claims minimal: `sub, roles[], mfa, sid, iat, exp, jti` — no `permissions[]`.
- **Identifiers** (ADR-0001 §3): UUID is the sole FK key; `phone` and `email` both unique, both login methods; CHECK `phone OR email NOT NULL`.
- **Consent before PD** (ADR-0009): no PD-bearing `users` row is committed before the registrant's per-purpose consent versions are recorded.
- **Pinned Zitadel version.** The deployed Zitadel must be a release patched against the known enumeration / lockout-bypass advisories (e.g. CVE-2025-57770 and the "ignore unknown usernames" reset-flow bypass). Pinning a patched version is part of the Definition of Done; our rate-limit + enumeration-resistant responses are the defense-in-depth backstop (ADR-0001 §7).
- **Stack** (ADR-0002): Node 22 LTS, TS strict, ESM-only; NestJS 11 + Fastify + `nestjs-zod`; schema SSOT in `packages/schemas/`; URI versioning `/v1/...`; Vitest + supertest. Service-dependent tests `skipIf` their dependency env (`DATABASE_URL`, `IDP_ISSUER`) is absent, so they do not redden `main` in the shared CI unit job.
- **Audit** (ADR-0003 §6): auth events are appended to `audit_ledger` (append-only, 3-year retention); PD is masked in logs.

## Prior decisions

- **ADR-0001** Identity / Auth / RBAC — IdP = Zitadel (§8); hybrid RBAC with coarse v1 roles incl. `doctor_guest` (§1); headless credentials UI (§2); dual identifiers + UUID PK (§3); v1 auth methods email+password / email-magic-link / phone-SMS-OTP (§4 — magic-link realised here as native email-OTP, design §8); OAuth 2.0 BCP token model (§6); mandatory v1 security baseline (§7); auth audit events (§7.3, authored here); Directual cutover (§9, out of scope); step-up (§10, out of scope).
- **ADR-0002 §3** Backend Core Stack — `nestjs-zod`, URI versioning, Vitest + supertest, `packages/schemas/` SSOT.
- **ADR-0003 §5/§6** Data Layer — `idempotency_keys` for idempotent command replay; `audit_ledger` for the auth audit trail.
- **ADR-0009** PD lifecycle & consent — per-purpose versioned consent; capture mechanism consumed at registration.
- **ADR-0006 §4** Documentation & SSOT — feature-spec triplet structure + flat EARS numbering.

## Event Model

The auth vertical is the platform's first real aggregate cluster (unlike the query-only 001/002). Ownership is split across the IdP boundary: **Zitadel** owns credential/session/token state; **`apps/api`** owns the domain mirror, consent, RBAC role grant, audit, and the abuse-prevention guards.

### Commands (handled by `apps/api` BFF, delegating credential work to Zitadel)

`RegisterWithEmailPassword` · `RegisterWithPhonePassword` · `VerifyEmail` · `VerifyPhone` · `LoginWithPassword` · `RequestEmailOtp` · `LoginWithEmailOtp` · `RequestSmsOtp` · `LoginWithSmsOtp` · `RefreshSession` · `Logout` · `RequestPasswordReset` · `CompletePasswordReset`

### Events

| Event                                                        | Owner                                  | Notes                                                             |
| ------------------------------------------------------------ | -------------------------------------- | ----------------------------------------------------------------- |
| `UserRegistered`                                             | Zitadel → mirror                       | Triggers the registration policy below.                           |
| `ConsentCaptured`                                            | `apps/api`                             | Per-purpose versions recorded before the mirror row is activated. |
| `MirrorSynced`                                               | `apps/api`                             | `doctor_guest` row upserted from the Zitadel Action webhook.      |
| `EmailVerified` / `PhoneVerified`                            | Zitadel → mirror                       | Verification state mirrored.                                      |
| `SessionEstablished` / `SessionRefreshed` / `SessionRevoked` | `apps/api` (over Zitadel session)      | Cookie set / rotated / cleared.                                   |
| `PasswordResetRequested` / `PasswordResetCompleted`          | Zitadel → audit                        |                                                                   |
| `AccountLocked`                                              | Zitadel (policy) → `apps/api` (notify) | Lockout reached → notification email.                             |
| `RefreshReuseDetected`                                       | `apps/api`                             | Single-use violation → chain invalidation.                        |

### Read models

- **`UserMirror`** — backend `users` row: `id` (UUID PK), `zitadel_sub`, `email?`, `phone?`, `email_verified`, `phone_verified`, `role = doctor_guest`, timestamps. Invariant `phone OR email NOT NULL`.
- **`ActiveSession`** — Redis-backed BFF session: `sid`, `zitadel_session_id`, refresh token (opaque), fingerprint, `__Host-` cookie binding.

### Policies

- **On `UserRegistered`** → record `ConsentCaptured`, grant `doctor_guest`, upsert `UserMirror` (`MirrorSynced`). PD activation gated on consent.
- **On failed-login threshold (Zitadel lockout policy)** → `AccountLocked` → notification email (`apps/api`).
- **On `RefreshReuseDetected`** → revoke the whole refresh chain (RFC 6819) + audit.

## EARS requirements

> **Numbering convention:** flat (`EARS-1`, `EARS-2`, …) per ADR-0006 §4. EARS-1…12 are the functional handlers (each becomes a child Issue); EARS-13…20 are cross-cutting ubiquitous / unwanted-behavior requirements enforced across the surface. The `ears-tests` CI guard is content-match WARN in Phase 0.

**Registration & verification**

- **EARS-1:** When a visitor submits the registration form with a valid email and a policy-conforming password, the system shall create a Zitadel user, record the accepted per-purpose consent versions (ADR-0009), upsert a `doctor_guest` `UserMirror` row, trigger an email verification code, and respond without disclosing whether the email pre-existed (enumeration-resistant, EARS-16).
- **EARS-2:** When a visitor submits the registration form with a valid phone and a policy-conforming password, the system shall create a Zitadel user, record consent, upsert a `doctor_guest` `UserMirror` row, trigger an SMS verification code, and respond enumeration-resistantly.
- **EARS-3:** When a registrant submits the email verification code, the system shall verify it via Zitadel `otp_email`, mark `email_verified` on the mirror, and emit `EmailVerified` to `audit_ledger`; an invalid/expired code shall return a generic failure and count against the OTP attempt limit.
- **EARS-4:** When a registrant submits the SMS verification code, the system shall verify it via Zitadel `otp_sms`, mark `phone_verified`, and emit `PhoneVerified`; invalid/expired codes behave as in EARS-3.

**Login**

- **EARS-5:** When a user submits identifier (email or phone) + password, the system shall create a Zitadel session with a password check; on success it shall establish a BFF session (EARS-8); on failure it shall return an enumeration-resistant generic error and increment the lockout counter.
- **EARS-6:** When a user requests an email login code and then submits it, the system shall verify it via Zitadel `otp_email` and, on success, establish a BFF session (EARS-8). (This is the v1 passwordless email path; no magic link.)
- **EARS-7:** When a user requests an SMS login code and then submits it, the system shall verify it via Zitadel `otp_sms` and, on success, establish a BFF session (EARS-8), subject to the SMS toll-fraud guard (EARS-14).
- **EARS-8:** When a Zitadel session has passed its required check, the system shall complete the OIDC exchange, store the rotating refresh token server-side in Redis, mint the access JWT (claims `sub, roles[], mfa, sid, iat, exp, jti`), and set a per-origin `__Host-` HttpOnly+Secure+SameSite=Lax session cookie; the browser shall never receive a token in a response body.

**Session**

- **EARS-9:** When a client presents a valid session cookie whose access token is expired, the system shall rotate the refresh token single-use and issue a new access token; if a refresh token is replayed after rotation, the system shall invalidate the entire chain, revoke the session, and emit `RefreshReuseDetected` (ADR-0001 §6/§7, RFC 6819).
- **EARS-10:** When an authenticated user requests logout, the system shall DELETE the server-side session (invalidating its refresh chain), clear the `__Host-` cookie, and emit `SessionRevoked`.

**Password reset**

- **EARS-11:** When a user requests a password reset for an identifier, the system shall trigger the Zitadel forgot-password code flow and respond enumeration-resistantly regardless of whether the identifier exists (ADR-0001 §7; backstops the Zitadel reset-flow enumeration advisory).
- **EARS-12:** When a user submits a valid reset code and a policy-conforming new password, the system shall set the new password via Zitadel, revoke all of that user's existing sessions, and emit `PasswordResetCompleted`.

**Cross-cutting (ubiquitous / unwanted-behavior)**

- **EARS-13:** The system shall rate-limit auth endpoints per ADR-0001 §7 — per-user (5 / 15 min), per-IP (20 / 15 min), per-ASN (100 / h) — returning a generic throttled response without revealing account existence.
- **EARS-14:** While issuing SMS (verification or login OTP), the system shall enforce per-phone (3/h), per-IP (10/h), per-ASN (100/h) limits and a global daily SMS-budget circuit-breaker (≤ 2000/day), refusing further sends when any threshold is exceeded.
- **EARS-15:** When a user reaches 10 failed password attempts within 30 min, the system shall soft-lock the account (native Zitadel lockout policy) and send a notification email; the account unlocks per policy.
- **EARS-16:** The system shall return idempotent, enumeration-resistant responses on register / login / reset with a timing delta ≤ 50 ms between the existing-account and unknown-account paths (ADR-0001 §7).
- **EARS-17:** When a request originates from an unauthenticated abuse-prone surface (registration, password reset, or login after N failures), the system shall require a valid bot-protection token — verified through the `BotProtection` provider interface (Yandex SmartCaptcha is the v1 adapter) — before processing.
- **EARS-18:** The system shall append every auth event — `auth.{register, login.succeeded, login.failed, logout, token.refresh, token.reuse_detected, password.reset.requested, password.reset.completed, otp.sent, otp.verified, otp.failed, lockout, consent.captured}` — to `audit_ledger` (ADR-0003 §6) with PD masked.
- **EARS-19:** When Zitadel emits a user create/update Action webhook, the system shall upsert the corresponding `UserMirror` row, ensure the `doctor_guest` role grant, and reconcile divergence on a periodic sweep (eventual consistency, ADR-0001 Consequences).
- **EARS-20:** When a registration is processed, the system shall record the registrant's accepted per-purpose consent versions (ADR-0009) and shall refuse to activate the PD-bearing mirror row if consent is absent.

## Invariants

- Every `UserMirror` row satisfies `phone OR email NOT NULL` and carries exactly one `zitadel_sub`.
- No PD-bearing `users` row is committed without a corresponding `ConsentCaptured` record (EARS-20).
- A refresh token is valid for exactly one rotation; any reuse invalidates the chain (EARS-9).
- No access or refresh token ever appears in a client-readable response body or in non-`__Host-` storage (EARS-8).
- Register / login / reset responses are indistinguishable (status + body + timing ≤ 50 ms) between existing and unknown identifiers (EARS-16).
- Every state-changing auth command emits exactly one terminal `audit_ledger` entry (EARS-18).
- `apps/api` contains no password hashing, no token signing, and no OTP generation — all delegated to Zitadel (Constraints, design §2).
- The session JWT carries the `mfa` claim even though no `doctor_guest` flow requires MFA (seam for future enforcement).

## Verification

| EARS  | Test type         | File (indicative)                               | Notes                                                                                                                                                                                                                              |
| ----- | ----------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---------------- |
| 1–2   | Vitest e2e        | `apps/api/test/auth/register.e2e-spec.ts`       | `it('EARS-1: ...')` / `it('EARS-2: ...')`; against dev-stand Zitadel + Postgres; asserts Zitadel user created, mirror row `doctor_guest`, consent recorded, verification triggered, enumeration-safe response. `skipIf(!IDP_ISSUER |     | !DATABASE_URL)`. |
| 3–4   | Vitest e2e        | `apps/api/test/auth/verify.e2e-spec.ts`         | Valid + invalid/expired code paths; mirror `*_verified` flips.                                                                                                                                                                     |
| 5     | Vitest e2e        | `apps/api/test/auth/login-password.e2e-spec.ts` | Success → cookie set; wrong password → generic error + counter++.                                                                                                                                                                  |
| 6–7   | Vitest e2e        | `apps/api/test/auth/login-otp.e2e-spec.ts`      | Email-OTP + SMS-OTP login; SMS path asserts toll-fraud guard interplay (EARS-14).                                                                                                                                                  |
| 8     | Vitest e2e        | `apps/api/test/auth/session.e2e-spec.ts`        | Asserts `__Host-` cookie attributes, no token in body, JWT claim set.                                                                                                                                                              |
| 9     | Vitest e2e + unit | `apps/api/test/auth/refresh.e2e-spec.ts`        | Rotation happy path; reuse → chain invalidation + `RefreshReuseDetected`.                                                                                                                                                          |
| 10    | Vitest e2e        | `apps/api/test/auth/logout.e2e-spec.ts`         | Session DELETE + cookie cleared.                                                                                                                                                                                                   |
| 11–12 | Vitest e2e        | `apps/api/test/auth/password-reset.e2e-spec.ts` | Enumeration-safe initiate; complete revokes sessions.                                                                                                                                                                              |
| 13,16 | Vitest e2e + unit | `apps/api/test/auth/abuse-limits.e2e-spec.ts`   | Rate-limit thresholds; timing-delta assertion for enumeration.                                                                                                                                                                     |
| 14    | Vitest unit       | `apps/api/src/auth/sms-budget.spec.ts`          | Per-phone/IP/ASN counters + daily circuit-breaker (mocked clock + SMS client).                                                                                                                                                     |
| 15    | Vitest e2e        | `apps/api/test/auth/lockout.e2e-spec.ts`        | 10 fails → lock + notification email (Mailpit assertion in dev-stand).                                                                                                                                                             |
| 17    | Vitest unit       | `apps/api/src/auth/captcha.guard.spec.ts`       | Missing/invalid SmartCaptcha token → rejected.                                                                                                                                                                                     |
| 18    | Vitest unit       | `apps/api/src/auth/audit.spec.ts`               | Each command emits exactly one `audit_ledger` entry; PD masked.                                                                                                                                                                    |
| 19    | Vitest e2e        | `apps/api/test/auth/mirror-sync.e2e-spec.ts`    | Webhook upsert + role grant; reconciliation sweep closes injected divergence.                                                                                                                                                      |
| 20    | Vitest e2e        | `apps/api/test/auth/consent.e2e-spec.ts`        | Registration without consent refused; with consent → versions recorded.                                                                                                                                                            |
| all   | Gherkin (e2e)     | `003-scenarios.feature`                         | Happy paths + failure branches; translated to Playwright via `playwright-bdd` once that runner exists (out of scope here).                                                                                                         |

## Dependencies & sequencing

- **Frontend scaffold (first consumer).** The Variant-B auth forms live in `apps/portal`, built from `packages/design-system` — **both are currently stubs** (only `package.json`). 003's frontend work graduates them: scaffold `apps/portal` (Tailwind 4 + shadcn/ui, ADR-0004 §5–7) and graduate `packages/design-system` with the design tokens (theme CSS variables incl. `--radius`) + only the auth-form component set the forms need (Input, Button, Form, Label, OTP input, Card), per the incremental stub-graduation pattern of 001/002. Sequenced before the form-facing EARS; the full design system grows with later verticals.
- **Endpoint-authorization matrix (ADR-0001 §2.5 — "mandatory artifact" + CI gate `tools/lint-endpoint-authz`).** This infrastructure does **not yet exist** in `tools/`. 003 introduces the first real classified endpoints (public: register / login / reset / verify; `doctor_guest`-protected: logout / refresh / session). 003 therefore either bootstraps the minimal endpoint-authz metadata convention + lint, or it is gated on a preceding engineering-task that does. **Decision for the lead agent before child-Issue planning.**
- **Consent mechanism (ADR-0009).** EARS-20 needs a capture API. If the ADR-0009 capture primitive is not yet implemented, 003 builds the minimal registration-time capture (record accepted versions) and leaves withdrawal/version-migration to the ADR-0009 vertical.
- **Dev-stand Zitadel + Mailpit + Redis.** Integration tests run against the dev-stand `idp`, `mailpit`, and Redis services (AGENTS.md §9); endpoints/ports are read from `.env.local`.
- **Decision-debt → ADR-0001 revision (separate adr-revision task).** Three research findings touch ADR-0001 and are recorded in design §9 for a follow-up revision — not changed inside this spec-authoring: §8 (magic-link wording now that native email-OTP exists), §7 (Zitadel enumeration/lockout CVEs + patched-version pin), §2 (Login v2 considered & rejected).
