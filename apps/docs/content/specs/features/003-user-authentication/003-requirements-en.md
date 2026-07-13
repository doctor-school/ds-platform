---
title: "003 — User authentication (net-new web → doctor_guest)"
description: "Requirements: net-new self-service web authentication for the doctor portal — registration, email/phone verification, password + passwordless (email-OTP / SMS-OTP) login, BFF session over a __Host- cookie, token rotation, logout, and password reset. Produces a backend doctor_guest mirror over Zitadel as the IdP. First product feature-spec."
slug: 003-user-authentication
status: Shipped
surface: user-facing
tracker: https://github.com/doctor-school/ds-platform/milestone/3
parent_issue: https://github.com/doctor-school/ds-platform/issues/80
issues: [81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 131, 207, 709, 770]
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
- Every authenticated principal produced by this feature is a `doctor_guest` mirror row in the backend (`users`), keyed by UUID. **Email is the primary registration identifier** (every registrant has an email); phone is a secondary identifier added/verified after registration. The mirror invariant `phone OR email NOT NULL` (ADR-0001 §3) therefore always holds via the email column. Rationale: Zitadel cannot create a login-capable human user without an email — the constraint is invariant across `AddHumanUser` v1/v2 and the newer `CreateUser` `/v2/users/new` (confirmed in `main`, proto `email … [(validate.rules).message.required = true]`), so a phone-only registration is unbuildable on this IdP (GH #202).
- Per-purpose, versioned **consent is captured at registration** before any personal-data (PD) row is created (ADR-0009).
- The mandatory v1 **security baseline** (ADR-0001 §7) — rate limiting, account lockout, enumeration resistance, SMS toll-fraud circuit-breaker, CAPTCHA — is enforced on the auth surface.

## Scope

**In:**

- Self-service registration on the portal with **email + password** (email is the primary registration identifier — Zitadel hard-requires an email on human-user creation, GH #202).
- **Email verification** (Zitadel email OTP code) at registration. Phone verification is a post-registration secondary-identifier concern (future), not a registration step.
- **Password login** by email or phone (phone is a valid login identifier once attached to the account).
- **Passwordless email login via OTP code** (Zitadel `otp_email`; the user types the code — _not_ a magic link, see Out).
- **Phone login via SMS-OTP** (Zitadel `otp_sms`).
- **BFF session establishment**: `apps/api` completes the OIDC exchange against the Zitadel session, stores the rotating refresh token server-side in Redis, and sets a per-origin `__Host-` session cookie (ADR-0001 §6).
- **Token refresh / rotation** (opaque, single-use; refresh-reuse invalidates the chain — ADR-0001 §6, §7).
- **Logout** (server-side session DELETE → cookie cleared).
- **Password reset** (Zitadel forgot-password code flow): initiate + complete.
- **Backend user-mirror** of the `doctor_guest` user, created/updated from a Zitadel Action webhook, with a minimal reconciliation sweep and a read-path self-heal for an orphaned session (EARS-26).
- **Consent capture** at registration via the ADR-0009 mechanism (records the per-purpose consent versions the registrant accepted).
- **Security baseline** (ADR-0001 §7): rate limits (per-user / per-IP / per-ASN), account lockout (native Zitadel lockout policy + our notification email), enumeration-resistant responses, SMS toll-fraud per-phone/IP/ASN limits + a global daily SMS-budget circuit-breaker.
- **Bot-protection bootstrap.** 003 is the platform's first consumer of bot-protection, so it bootstraps the mechanism behind a `BotProtection` provider interface — a Yandex SmartCaptcha adapter (server-side token verification in `apps/api`) + the widget on the portal auth forms. The provider stays swappable per ADR-0001 open-q #7; 003 owns the policy of _where_ it applies (EARS-17).
- **Auth audit events** written to `audit_ledger` (this section is the "spec §7.3" forward-referenced from ADR-0001 §7, §10).
- **Account profile v1 (GH #770 increment).** A session-scoped **profile self-read** `GET /v1/me/profile` over the existing `users` mirror (read-only — no writes, no new columns), and the portal **`/account` profile surface** that renders it: avatar initials + inline-editable display name (via the existing `PUT /v1/me/display-name`), email with verified state, phone row, a change-password handoff to the existing `/reset` flow, a link to «Мои события», and sign-out (EARS-27/28, design §12).

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
- **PD-lifecycle actions on the profile surface** (152-ФЗ personal-data export / deletion / consent withdrawal). No backend for these exists — the ADR-0009 vertical owns them; they are tracked as a separate follow-up Issue, **not** silently implied by `/account` (F-22: no untracked seam).
- **MFA management from `/account`** (enroll / disable / factor list) — follows the MFA seam above; the v1 profile surface shows no MFA controls.
- **Phone editing from `/account`** (attach / change / verify a phone) — the post-registration secondary-identifier increment (EARS-2/4); v1 renders the phone read-only.

## Constraints

- **IdP boundary (hard).** Credential verification, session lifecycle, token issuance/rotation, JWKS/OIDC, OTP delivery (email + SMS), password storage, and account-lockout counting are **native Zitadel** features — consumed via the Session / User v2 API, never reimplemented in `apps/api`. The native-vs-custom split is fixed in design §2 (table). AGPL §13 discipline applies: integrate via API/Actions/config only; **do not patch Zitadel source** (ADR-0001 §8).
- **UI model = Variant B (headless inline).** Forms live on the portal origin; the BFF brokers Zitadel calls. No IdP-hosted login app, no auth-subdomain redirect for credentials (ADR-0001 §2). Zitadel Login v2 was considered and rejected for v1 (design §8 — recorded so it is not re-litigated).
- **No hardcoded origin.** The portal origin / cookie domain are read from configuration, never hardcoded in code or spec (mirrors AGENTS.md §9.1). `__Host-` cookies are origin-bound by construction.
- **Tokens** (ADR-0001 §6): access JWT 15 min (RS256/ES256); refresh opaque, rotating, single-use, 30 d web; refresh stored server-side in Redis on the BFF; `__Host-` cookie HttpOnly + Secure + SameSite=Lax, per-app origin (no cross-subdomain shared cookie). JWT claims minimal: `sub, roles[], mfa, sid, iat, exp, jti` — no `permissions[]`.
- **Identifiers** (ADR-0001 §3): UUID is the sole FK key; `phone` and `email` both unique, both login methods; CHECK `phone OR email NOT NULL`.
- **Consent before PD** (ADR-0009): no PD-bearing `users` row is committed before the registrant's per-purpose consent versions are recorded.
- **Pinned Zitadel version.** The deployed Zitadel must be a release patched against the known login-UI enumeration bypasses — CVE-2024-41952 ("ignore unknown usernames" flag not honoured), CVE-2025-57770 ("select account" page), and CVE-2026-23511 (password-reset endpoints + Login UI V2) — i.e. **≥ 4.9.1 (v4) or ≥ 3.4.6 (v3)**. Pinning a patched version is part of the Definition of Done; our rate-limit + enumeration-resistant responses are the defense-in-depth backstop (ADR-0001 §7).
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

> **Numbering convention:** flat (`EARS-1`, `EARS-2`, …) per ADR-0006 §4. EARS-1…12 are the functional handlers (each becomes a child Issue); EARS-13…22 are cross-cutting ubiquitous / unwanted-behavior requirements enforced across the surface. The `ears-tests` CI guard is content-match WARN in Phase 0.

**Registration & verification**

- **EARS-1:** When a visitor submits the registration form with a valid email and a policy-conforming password, the system shall create a Zitadel user, record the accepted per-purpose consent versions (ADR-0009), upsert a `doctor_guest` `UserMirror` row, trigger an email verification code, and respond without disclosing whether the email pre-existed (enumeration-resistant, EARS-16).
- **EARS-2:** Email is the **primary registration identifier** (per EARS-1); phone is a **post-registration secondary identifier** (added/verified after the account exists), **not** a registration channel. There is no phone-only registration — Zitadel cannot create a login-capable human without an email (invariant across `AddHumanUser` v1/v2 and `CreateUser` `/v2/users/new`, confirmed in `main`; GH #202). Phone as a _login_ identifier (EARS-5) and SMS-OTP login (EARS-7) are unaffected — they operate on an already-attached, verified phone. (The post-registration "attach + verify a secondary phone" surface is a future increment, not built here.)
- **EARS-3:** When a registrant submits the email verification code, the system shall verify it via Zitadel `otp_email`, mark `email_verified` on the mirror, and emit one terminal `auth.account.verified` (channel `email`) row to `audit_ledger`; an invalid/expired code shall return a generic failure, emit no terminal row, and count against the OTP attempt limit.
- **EARS-4:** Registration verification is **email-only** (EARS-3). Phone verification (`phone_verified` via Zitadel `otp_sms`) is a post-registration secondary-identifier concern (future), not a registration step — there is no phone to verify _at registration_ because registration is email-primary (EARS-2). The verify port/handler still distinguishes channels for the future secondary-phone path; the SMS-OTP _login_ code path (EARS-7) is unaffected.

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
- **EARS-12:** When a user submits a valid reset code and a policy-conforming new password, the system shall set the new password via Zitadel, revoke all of that user's existing sessions, emit `PasswordResetCompleted`, and establish a new authenticated session for the subject (auto-login — setting the `__Host-` session cookie, with no token in the response body per EARS-8).

**Cross-cutting (ubiquitous / unwanted-behavior)**

- **EARS-13:** The system shall rate-limit auth endpoints per ADR-0001 §7 — per-user (10 / 15 min), per-IP (20 / 15 min), per-ASN (100 / h) — returning a generic throttled response without revealing account existence; a successful login or password-reset-complete clears (forgives) the per-user window for that identifier (the per-IP / per-ASN windows are not forgiven).
- **EARS-14:** While issuing SMS (verification or login OTP), the system shall enforce per-phone (3/h), per-IP (10/h), per-ASN (100/h) limits and a global daily SMS-budget circuit-breaker (≤ 2000/day), refusing further sends when any threshold is exceeded.
- **EARS-15:** When a user reaches 10 failed password attempts within 30 min, the system shall soft-lock the account (native Zitadel lockout policy) and send a notification email; the account unlocks per policy.
- **EARS-16:** The system shall return idempotent, enumeration-resistant responses on register / login / reset with a timing delta ≤ 50 ms between the existing-account and unknown-account paths (ADR-0001 §7).
- **EARS-17:** When a request originates from an unauthenticated abuse-prone surface (registration, password reset, or login after N failures), the system shall require a valid bot-protection token — verified through the `BotProtection` provider interface (Yandex SmartCaptcha is the v1 adapter) — before processing.
- **EARS-18:** The system shall append every auth event — `auth.{register, account.verified, login.succeeded, login.failed, logout, token.refresh, token.reuse_detected, password.reset.requested, password.reset.completed, otp.sent, otp.verified, otp.failed, lockout, consent.captured}` — to `audit_ledger` (ADR-0003 §6) with PD masked.
- **EARS-19:** When Zitadel emits a user create/update Action webhook, the system shall upsert the corresponding `UserMirror` row, ensure the `doctor_guest` role grant, and reconcile divergence on a periodic sweep (eventual consistency, ADR-0001 Consequences).
- **EARS-20:** When a registration is processed, the system shall record the registrant's accepted per-purpose consent versions (ADR-0009) and shall refuse to activate the PD-bearing mirror row if consent is absent.
- **EARS-21:** The portal auth UI shall render in **Russian (primary)** with **no hardcoded user-facing strings** — all copy (labels, descriptions, buttons, placeholders, the consent line, and error messages) sourced from a typed message catalog over an i18n-ready structure, so a future locale can be added without re-touching components; **RU-only ships now with no user-facing language switcher** (the i18n infrastructure is present for a later locale). (Design §8.1.)
- **EARS-22:** Each portal user-input field shall apply the client-side validation rule and input mask relevant to its data type — email shape, E.164 phone with mask, fixed-length numeric OTP, password policy — before submit, surfacing obviously-malformed input with localized (RU) copy from the message catalog (EARS-21); this is a UX affordance only — the BFF/IdP remains the credential authority (Constraints) and the request schemas stay loose, so a field that declares no relevant rule states "none" with a one-line reason. (Defects #192 (`/login` identifier) and #196 (`/reset` identifier) motivate this; enforcement — semantic field primitives + an ESLint gate — is tracked in #197. Design §8.2.)
- **EARS-23:** When a registration request targets an **already-registered** email, the system shall send an _account-exists notice_ email to that address — a sign-in / password-reset prompt carrying **no** verification code, login code, token, or new account/PD — so the legitimate owner is never stranded, while the API response, status, and timing stay **identical** to the never-registered case (EARS-16). The notice send is **fire-and-forget** (off the response path, so SMTP latency cannot leak as a timing oracle) and **throttled per-address** (an ephemeral, HMAC-keyed Redis marker with a short TTL — never a persistent, queryable per-email record), so the registration form cannot be turned into an inbox-flooding tool; a send failure is logged only and never alters the response. The already-existed branch still creates no account, writes no `users`/consent row, and appends no `auth.register` ledger entry. The BFF gains its own transactional-email channel (`MailerModule`), **distinct** from Zitadel's identity-credential notifications (codes / OTP / reset). (Defect #207. Design §4.)
- **EARS-24:** The post-registration portal screen (`/verify`) shall present a **single, existence-agnostic** view that serves the new and the already-registered visitor without the client ever learning which it is: it frames the step as "check your email" and offers, as co-equal affordances, **(a)** entering the email code (the new registrant's path — unchanged auto-submit + post-verify auto-login, #175/#194) and **(b)** prominent **Sign in** / **Reset password** actions (the already-registered owner's path). The screen shall never branch on account existence — the BFF deliberately does not disclose it (EARS-16) — and the existing owner's correct path is also delivered privately in the EARS-23 notice email. Copy is sourced from the message catalog (EARS-21). (Resolves the duplicate-registration dead-end where an existing user was routed to an imperative "enter your code" screen for a code that never arrives; defect #207. Design §8.3.)
- **EARS-25:** When a visitor on the existence-agnostic `/verify` screen (EARS-24) requests that the registration email verification code be **re-sent**, the system shall re-trigger the Zitadel `otp_email` verification code for that identifier and respond **enumeration-resistantly** regardless of whether the identifier exists or is already verified (mirroring EARS-11/EARS-16) — a code is re-issued only for an existing, unverified registrant, while the response, status, and timing stay identical to the unknown / already-verified case. The resend resolves the identifier → Zitadel `sub` without disclosing existence (the same enumeration-safe wrapper as `RequestPasswordReset`/`RequestEmailOtp`) and is subject to the EARS-13 rate limits; it creates no `users`/consent row and appends an `otp.sent` ledger row only when a code is actually issued. (The new registrant whose first code did not arrive can re-request it without re-typing the password; the already-registered owner's co-equal Sign in / Reset password affordances and the EARS-23 notice email are unaffected. Design §4.)

- **EARS-26:** When an authenticated request's session subject resolves (a valid IdP session) but no `users` mirror row exists for its `zitadel_sub` — a webhook miss/lag the sweep has not yet closed, or a mirror row lost while IdP sessions for that sub stay alive — the system shall lazily re-materialize the mirror row from the IdP **before the handler runs**, performing the same idempotent upsert + `doctor_guest` re-grant the EARS-19 webhook/sweep perform, and serve the request as normal, so the orphaned-session state can never bounce authenticated surfaces into the silent `/login` → `/account` redirect carousel. A sub the IdP no longer knows (or an identifier-less machine account, not a `doctor_guest` mirror candidate) heals nothing, and the mirror-backed handler keeps its fail-closed generic 401; responses to genuinely unauthenticated callers (EARS-16) are unchanged. (GH #709 — the third mirror-sync layer: webhook primary, sweep backstop, read-path self-heal lazy. Design §4.)

**Account profile v1 (GH #770)**

- **EARS-27:** When an authenticated user requests `GET /v1/me/profile`, the system shall return the session subject's **own** identity fields from the `users` mirror — `{ email: string, emailVerified: boolean, phone: string|null, phoneVerified: boolean|null, displayName: string|null }` — performing no writes; the read is strictly session-scoped (self-only — no parameterized lookup of another subject exists on this route). An unauthenticated request shall receive the same generic auth outcome as the other `/v1/me/*` reads (the fail-closed generic 401, EARS-16-consistent; an orphaned-session subject heals per EARS-26 like any other mirror-backed read). (Design §12.)
- **EARS-28:** When an authenticated user opens the portal `/account` page, the portal shall render a profile surface composed of: avatar initials + the display name with **inline edit** (persisted via the existing `PUT /v1/me/display-name`), the email with its verified state, a phone row that renders an explicit «не указан» state when no phone is attached (read-only — no phone editing, Scope), a **change-password action that hands off to the existing `/reset` flow** (no in-page password form and no new backend), a link to «Мои события» (`/account/events`), and sign-out (EARS-10). The surface shall **not** render raw session claims — no `sub`, no roles array, no raw `mfa` boolean — replacing the prior claims dump entirely. Copy comes from the message catalog (EARS-21); field validation follows EARS-22. The visual design is canvas-driven (Stage-A pick in claude.ai/design, vendored into `design-source/` before implementation) — this clause pins **behavior**, not pixels. (Design §12.)

## Invariants

- Every `UserMirror` row satisfies `phone OR email NOT NULL` and carries exactly one `zitadel_sub`. Since registration is email-primary (EARS-1/2; Zitadel hard-requires email, GH #202), every registered row carries an email, so the invariant always holds via the email column; phone is the optional secondary identifier.
- No PD-bearing `users` row is committed without a corresponding `ConsentCaptured` record (EARS-20).
- A refresh token is valid for exactly one rotation; any reuse invalidates the chain (EARS-9).
- No access or refresh token ever appears in a client-readable response body or in non-`__Host-` storage (EARS-8).
- Register / login / reset / verify-code-resend responses are indistinguishable (status + body + timing ≤ 50 ms) between existing and unknown identifiers (EARS-16). A registration on an already-registered email triggers no account/consent/ledger write; any owner-directed account-exists notice is delivered out-of-band by email (EARS-23), never via the API response, and the post-register screen is existence-agnostic (EARS-24). A verification-code resend (EARS-25) re-issues a code only for an existing, unverified registrant and writes an `otp.sent` ledger row only then, so neither the response nor the ledger discloses existence.
- Every state-changing auth command emits exactly one terminal `audit_ledger` entry (EARS-18).
- `apps/api` contains no password hashing, no token signing, and no OTP generation — all delegated to Zitadel (Constraints, design §2).
- The session JWT carries the `mfa` claim even though no `doctor_guest` flow requires MFA (seam for future enforcement).
- `GET /v1/me/profile` performs no write on any path (EARS-27), and no product surface renders raw session claims (`sub`, roles array, raw `mfa`) — the `/account` profile surface shows only product-shaped identity fields (EARS-28).

## Verification

| EARS | Test type | File (indicative) | Notes |
| ----- | ----------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---------------- |
| 1–2 | Vitest e2e | `apps/api/test/auth/register.e2e-spec.ts` | `it('EARS-1: ...')` email-primary register; asserts Zitadel user created, mirror row `doctor_guest`, consent recorded, email verification triggered, enumeration-safe response. EARS-2: there is no phone-only registration (Zitadel hard-requires email, GH #202) — the suite asserts a phone-only register attempt is a handled, enumeration-safe failure, **never a 500** (robustness fix + fake/real parity). `skipIf(!IDP_ISSUER |     | !DATABASE_URL)`. |
| 3–4 | Vitest e2e | `apps/api/test/auth/verify.e2e-spec.ts` | EARS-3 email verify: valid + invalid/expired code paths; `email_verified` flips. EARS-4: registration verify is email-only — phone verification is a future post-registration secondary-identifier path (GH #202). |
| 5 | Vitest e2e | `apps/api/test/auth/login-password.e2e-spec.ts` | Success → cookie set; wrong password → generic error + counter++. |
| 6–7 | Vitest e2e | `apps/api/test/auth/login-otp.e2e-spec.ts` | Email-OTP + SMS-OTP login; SMS path asserts toll-fraud guard interplay (EARS-14). |
| 8 | Vitest e2e | `apps/api/test/auth/session.e2e-spec.ts` | Asserts `__Host-` cookie attributes, no token in body, JWT claim set. |
| 9 | Vitest e2e + unit | `apps/api/test/auth/refresh.e2e-spec.ts` | Rotation happy path; reuse → chain invalidation + `RefreshReuseDetected`. |
| 10 | Vitest e2e | `apps/api/test/auth/logout.e2e-spec.ts` | Session DELETE + cookie cleared. |
| 11–12 | Vitest e2e | `apps/api/test/auth/password-reset.e2e-spec.ts` | Enumeration-safe initiate; complete revokes sessions. |
| 13,16 | Vitest e2e + unit | `apps/api/test/auth/abuse-limits.e2e-spec.ts` | Rate-limit thresholds; timing-delta assertion for enumeration. |
| 14 | Vitest unit | `apps/api/src/auth/sms-budget.spec.ts` | Per-phone/IP/ASN counters + daily circuit-breaker (mocked clock + SMS client). |
| 15 | Vitest e2e | `apps/api/test/auth/lockout.e2e-spec.ts` | 10 fails → lock + notification email (Mailpit assertion in dev-stand). |
| 17 | Vitest unit | `apps/api/src/auth/captcha.guard.spec.ts` | Missing/invalid SmartCaptcha token → rejected. |
| 18 | Vitest unit | `apps/api/src/auth/audit.spec.ts` | Each command emits exactly one `audit_ledger` entry; PD masked. |
| 19 | Vitest e2e | `apps/api/test/auth/mirror-sync.e2e-spec.ts` | Webhook upsert + role grant; reconciliation sweep closes injected divergence. |
| 20 | Vitest e2e | `apps/api/test/auth/consent.e2e-spec.ts` | Registration without consent refused; with consent → versions recorded. |
| all | Gherkin (e2e) → browser | `003-scenarios.feature` | Happy paths + failure branches, translated to Playwright via `playwright-bdd`. This is a `user-facing` spec, so an end-to-end browser run (register→verify→login→logout in the portal) is a required deliverable — owned and tracked by **#131 (F7: portal auth integration + E2E)**, not a bare footnote. F1–F5 shipped the BFF handlers; #131 wires the portal forms and lands the browser E2E. |
| 23 | Vitest unit + e2e | `apps/api/src/mailer/*.spec.ts` + register e2e | An already-registered register dispatches exactly one account-exists notice (`FakeMailer` records it); a second within the throttle window is suppressed; the API response stays identical (status + body + timing) to the never-registered case; the duplicate branch writes no account/consent/`auth.register` row. `FakeMailer` rejects what the real `SmtpMailer` rejects (fake/real parity). #207. |
| 24 | Gherkin (e2e) → browser | `003-scenarios.feature` | Existing-email register lands on the uniform "check your email" `/verify` screen offering prominent Sign in / Reset password; fresh-email register still auto-submits the code and auto-logs-in. Neither path dead-ends. #207. |
| 25 | Vitest e2e | `apps/api/test/auth/verify.e2e-spec.ts` | `it('EARS-25: ...')` resend: an existing, unverified registrant re-receives an `otp_email` code and exactly one `otp.sent` ledger row; an unknown / already-verified identifier yields the identical status + body + timing (≤ 50 ms, EARS-16) with no code issued and no ledger row; the resend is rate-limited (EARS-13) and writes no `users`/consent row. #318. |
| 26 | Vitest e2e + unit | `apps/api/test/auth/mirror-self-heal.e2e-spec.ts` + `apps/api/src/auth/mirror-self-heal.service.spec.ts` | An authenticated read whose sub has no mirror row self-heals (the row is re-materialized with the IdP's identifiers + `doctor_guest`) and serves 200 — no generic 401, idempotent on repeat; a genuinely unauthenticated read stays the generic 401 and heals nothing (EARS-16 unchanged). The unit spec pins the skip paths: present row (no IdP call), unknown-at-IdP sub, identifier-less machine account, and fail-soft on a heal fault. #709. |
| 27 | Vitest e2e | `apps/api/test/me/profile.e2e-spec.ts` | `it('EARS-27: ...')` authenticated read returns the subject's own `{email, emailVerified, phone, phoneVerified, displayName}` (null phone/displayName paths included); unauthenticated → the same generic 401 as the other `/v1/me/*` reads; no write is performed on any path. #770. |
| 28 | Gherkin (e2e) → browser | `003-scenarios.feature` + live-stand Playwright drive | `/account` renders avatar initials, editable display name (inline edit persists via `PUT /v1/me/display-name`), email + verified state, the «не указан» phone state, the `/reset` change-password handoff, the «Мои события» link, and sign-out; the DOM carries no raw `sub`/roles/`mfa` claim. Browser verification owned by the #770 implementation slice (Stage-B live drive per AGENTS.md §6). #770. |

## Dependencies & sequencing

- **Frontend scaffold (first consumer).** The Variant-B auth forms live in `apps/portal`, built from `packages/design-system` — **both are currently stubs** (only `package.json`). 003's frontend work graduates them: scaffold `apps/portal` (Tailwind 4 + shadcn/ui, ADR-0004 §5–7) and graduate `packages/design-system` with the design tokens (theme CSS variables incl. `--radius`) + only the auth-form component set the forms need (Input, Button, Form, Label, OTP input, Card), per the incremental stub-graduation pattern of 001/002. Sequenced before the form-facing EARS; the full design system grows with later verticals.
- **Endpoint-authorization matrix (ADR-0001 design §2.5 — "mandatory artifact" + CI gate `tools/lint-endpoint-authz`).** This infrastructure does **not yet exist** in `tools/`. 003 introduces the first real classified endpoints (public: register / login / reset / verify; `doctor_guest`-protected: logout / refresh / session). 003 therefore either bootstraps the minimal endpoint-authz metadata convention + lint, or it is gated on a preceding engineering-task that does. **Decision for the lead agent before child-Issue planning.**
- **Consent mechanism (ADR-0009).** EARS-20 needs a capture API. If the ADR-0009 capture primitive is not yet implemented, 003 builds the minimal registration-time capture (record accepted versions) and leaves withdrawal/version-migration to the ADR-0009 vertical.
- **Dev-stand Zitadel + Mailpit + Redis.** Integration tests run against the dev-stand `idp`, `mailpit`, and Redis services (AGENTS.md §9); endpoints/ports are read from `.env.local`.
- **Decision-debt → ADR-0001 revision (separate adr-revision task).** Three research findings touch ADR-0001 and are recorded in design §9 for a follow-up revision — not changed inside this spec-authoring: §8 (magic-link wording now that native email-OTP exists), §7 (Zitadel enumeration/lockout CVEs + patched-version pin), §2 (Login v2 considered & rejected).
