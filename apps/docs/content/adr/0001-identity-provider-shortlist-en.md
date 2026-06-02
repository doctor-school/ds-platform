---
title: "ADR-0001 — Identity / Auth / RBAC for DS Platform [EN]"
description: "DS Platform is a standalone platform replacing the current Bubble + Directual + Supabase stack. It requires an identity infrastructure that supports:"
lang: en
---

> **EN (this)** · **RU:** [`0001-identity-provider-shortlist-ru.md`](./0001-identity-provider-shortlist-ru.md)

# ADR-0001 — Identity / Auth / RBAC for DS Platform

**Date:** 2026-06-02 (current revision; full evolution history in `git log`).
**Status:** Accepted — IdP = Zitadel
**Related to:** Plane DSO-25 (`0a8f2276-956f-4f4e-9134-2f197ff4bab8`), milestone DSO-24, DSO-63 (external validation), DSP-209 (final IdP selection)
**Design spec:** `apps/docs/content/adr/0001-identity-provider-shortlist-design-en.md`

---

## Context

DS Platform is a standalone platform replacing the current Bubble + Directual + Supabase stack. It requires an identity infrastructure that supports:

- ~10–65k existing doctors (migration from Directual) + growth to 1M MAU in v3.
- 9 product roles (PRD §13) + admin/operational roles (target model is a product task, **not a 1:1 migration** of 7 roles from Directual), multi-role per user.
- email + phone + magic-link + 2FA (TOTP/SMS).
- RF (Russian Federation) OAuth (VK ID, Yandex ID, Telegram) from v2; Apple Sign-In from v3 with iOS App Store distribution.
- Headless UI on our domain (not IdP-hosted login pages).
- Federal Law 152-FZ — hosting in RF, doctor personal data (PD) does not leave the RF zone.
- AI-agent driven development — the stack must be LLM-friendly.
- Operated by a team of 1–2 people.

## Decision

### 1. RBAC = hybrid

- IdP stores coarse roles in v1: `guest`, `doctor_guest`, `doctor`, `legacy_admin`, `platform_admin` (minimized — remaining groups from the 9 product roles are added incrementally as features arrive: `expert/moderator/support/investor` in v2, `clinic_admin` in v3).
- The target admin/operational role model is a parallel product track (not a blocker for the identity layer).
- Backend stores fine-grained and object-level permissions + domain audit log (append-only, 3-year retention).
- JWT claims are minimal: `sub`, `roles[]`, `mfa`, `sid`, `iat`, `exp`, `jti`. No `permissions[]` in the token.
- PD lifecycle, consent, retention, erasure — see ADR-0009.

### 2. UI — headless for credentials, near-headless for social

- Credentials (login/register/reset/MFA/magic-link) — forms on `doctor.school` via IdP headless API.
- Social — classic OAuth Authorization Code Flow + PKCE with redirect via `auth.doctor.school` (our subdomain). ~1-second visible hop under our brand.
- **Zitadel Login v2 — considered and rejected for credentials.** Zitadel ships a self-hostable MIT Login v2 (Next.js on the Session API) that would cut custom UI code, but it requires a redirect hop to an auth subdomain — contradicting the seamless inline-forms choice above for _credentials_ (the redirect model is accepted only for _social_). The headless inline forms keep the chosen UX, and the auth primitives stay native either way. Recorded so the choice is not re-litigated; reopening it would revise this section.

### 3. Identifiers = dual + UUID PK

- UUID is the sole FK key.
- Phone and email are both unique and both login methods.
- Phone-first UX on mobile/doctor-flow, email-first on admin/expert-flow.
- CHECK constraint `phone OR email NOT NULL`.

### 4. Auth methods v1

email+password, email+magic-link, phone+SMS-OTP, biometric unlock (mobile, local):

- **MFA TOTP mandatory** for `expert / clinic_admin / investor / platform_admin`.
- **MFA SMS acceptable trade-off** for `moderator / support` in v1 (low-cardinality, low ops-capacity); upgrade to TOTP in v2.

### 5. OAuth — phased rollout

| Phase     | Providers                          |
| --------- | ---------------------------------- |
| v1        | — (no social)                      |
| v2        | VK ID, Yandex ID, Telegram Login   |
| v3 mobile | + Apple Sign-In (if iOS App Store) |
| On demand | Max ID, Google                     |

Rationale for deferral: v1 user base ≤200 from the existing Doctor.School database — all already have email accounts, social login provides no incremental conversion. The decision remains reopenable if the product team provides evidence from an A/B prototype.

**Account linking requires a verified email on both sides** (protection against pre-auth account takeover, CVSS 9.0+). See spec §6.2.

### 6. Tokens — OAuth 2.0 BCP (RFC 9700)

- Access: JWT 15 min, RS256/ES256.
- Refresh: opaque, rotating single-use, **30d web / 14d mobile** (revised from 90d).
- **PKCE mandatory** for public clients (mobile + SPA web).
- **Sender-constrained refresh for mobile:** device-id binding in v1, DPoP (RFC 9449) — in v2.
- Session store: Redis, server-side. Force-logout = DELETE session.
- **Two-tier validation:** JWT fast-path for ≥99% of requests (read + low-stakes write); IdP `/introspect` (RFC 7662) for <1% high-stakes endpoints (payments, AU withdrawal, role-change, admin mutations, PD export).
- **Step-up authentication** for elevated-risk actions (admin user-management writes, account/erasure execution, payment-method change, MFA change, role grant/revoke, logout-all) — a separate elevated session with fresh MFA, TTL 30 min, claim `acr=mfa-fresh`. Full policy — §10.
- Mobile storage — Keychain/Keystore; web — HttpOnly + Secure + SameSite=Lax cookie with `__Host-` prefix (NOT localStorage). **Each app (portal, admin, promo) holds its own host-only session cookie**, scoped to that app's origin; cross-app SSO continuity is achieved via OIDC silent re-auth (`prompt=none`) at the IdP. A shared cookie spanning trust-zone boundaries (e.g. `__Secure-ds_session` on `.doctor.school`) is rejected: same-origin XSS or subdomain takeover under any subdomain would compromise the admin session, and the usual mitigations (fingerprint binding, CSRF double-submit) are bypassed by same-origin XSS.
- **Fingerprint binding (mandatory):** session metadata MUST include a stable client fingerprint = hash(UA + IP /24 + accept-language); on mismatch the session is invalidated and the user is forced through re-auth via the IdP. Not a defence against same-origin XSS (see above), but a baseline against cookie theft replayed from a different network/UA.
- JWKS rotation — graceful overlap window 24h.

### 7. Security baseline (mandatory for v1)

- Rate limiting: per-user (5 attempts / 15 min), per-IP (20 / 15 min), per-ASN (100 / hour).
- SMS toll-fraud protection: per-phone (3/hour) + per-IP (10/hour) + per-ASN (100/hour) + **global daily budget circuit-breaker** (≤2000 SMS/day).
- Account lockout: 10 failed logins / 30 min → soft-lock + email notification.
- Refresh token theft detection: re-use → invalidate the chain (RFC 6819).
- Email/phone enumeration protection: idempotent responses on login/reset/register with timing delta ≤50ms. This (plus the rate limits above) is **our** backstop, not the only line of defence — Zitadel has shipped repeated login-UI enumeration bypasses where its own "ignore unknown usernames" guard failed: the flag not consistently honoured (CVE-2024-41952), the "select account" page (CVE-2025-57770), and the password-reset endpoints + Login UI V2 (CVE-2026-23511). **Definition of Done for any Zitadel deployment: pin a release patched against all three — ≥ 4.9.1 (v4 line) or ≥ 3.4.6 (v3 line).**
- CAPTCHA: **Yandex SmartCaptcha** (RF-accessible; hCaptcha/reCAPTCHA deprecated in RF).
- CSRF protection + cookie security profile (`__Host-` per app, no shared cookies across subdomains — see §6; full security profile described here, not duplicated in the frontend spec).
- **Content Security Policy (CSP) profile-per-zone** — mandatory protection against XSS/clickjacking, differentiated by zone sensitivity level:

| Zone                          | Profile              | Notes                                                                                                                                                           |
| ----------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin.doctor.school`         | strictest            | `default-src 'self'`; no `unsafe-inline`, no `unsafe-eval`, no 3rd-party origins (including analytics); strict nonce-based script-src; `frame-ancestors 'none'` |
| `portal.doctor.school` (app)  | standard             | `default-src 'self'`; allow Centrifugo WS endpoint, Timeweb CDN, Sentry, permitted embed origins (video providers from CMS); nonce-based scripts                |
| `doctor.school` (promo SSG)   | relaxed              | allows analytics (Plausible self-hosted), pixel-marketing endpoints (if any); still no `unsafe-eval`; `frame-ancestors 'none'`                                  |
| `docs.doctor.school`          | Fumadocs default     | plus our `report-uri`; no exceptions for admin/portal/promo                                                                                                     |
| `cms.doctor.school` (Payload) | strict (admin-level) | analogous to admin; editors inside VPN/IdP only                                                                                                                 |

Cross-zone constraints: all profiles ship `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`. CSP violations from every zone go to a unified `csp-report-collector` endpoint (`apps/api/`-level), written to `audit_log` + Sentry alerting on pattern-spikes. Admin zone additionally ships `Permissions-Policy: geolocation=(), microphone=(), camera=()`. Specific `default-src` / `script-src` / `style-src` / `img-src` / `connect-src` / `frame-ancestors` / `form-action` / `report-uri` directives live in frontend design spec §3.2 + §3.2.2 — they may evolve as an operational change, but changing zone profiles or relaxation levels requires a new ADR revision.

- PD in logs is masked; full values only in encrypted audit log with RF-resident KMS.
- Full list of mandatory auth audit events — spec §7.3.

### 8. IdP — Zitadel

**Decision.** The DS Platform IdP is **Zitadel** (2026-05-25, DSP-209).

**License discipline (AGPL 3.0).** Zitadel relicensed Apache 2.0 → AGPL 3.0 in 2025. The source-disclosure obligation (AGPL §13) triggers ONLY when patching Zitadel source with network access for users. For self-host without modifications the practical difference vs MIT = 0. Rule:

- ✅ Allowed: deploy, configure, integrate via API/gRPC/REST, custom Actions (JS hooks inside Zitadel — application code, not source modification), custom frontend, branding.
- ⚠️ AGPL §13 trigger: patching Zitadel src → obligation to offer modified source to users interacting over the network (a public git mirror covers this).
- 🛡 Discipline: fix bugs via upstream PR or work around via Action/config; do not patch src. This is part of the Definition of Done for any Zitadel-related PR.

**Known trade-offs.**

- Magic-link: only the clickable-link transport is a custom build over the session API — the one-time secret itself is native (`otp_email`); the custom part is the link wrapper and its email delivery (not a Zitadel core feature, GitHub #2075). Mandatory security review for the link form.
- Zitadel self-hosted base ~13.4k★ — does not bite in v1 ≤200 users; re-evaluation triggers only if v2+ uncovers production maturity issues.

**Operational fallback.** Keycloak if Zitadel hits critical issues in v1 (most mature OSS alternative).

**Consequences.** DSP-157 (local-dev compose IDP) is unblocked.

### 9. Migration from Directual — hard domain cutover (changed 2026-05-18, DSO-63 #4)

**Model:** a hard DNS / auth-redirect switch from Directual to the new stack. Users physically have no access to Directual after the switch. **There is no dual-system PD perimeter** — the database is migrated once, legal access is only on the new system.

- **Pre-cutover** (Phase 0 discovery, 2–3 weeks): count + hash format + consent re-acquisition strategy. PD export from Directual → staging on the new system (encrypted at rest, restricted access).
- **Hash compatibility decision:** old bcrypt cost compatibility check → choose "use-as-is" (silent first-login) or "forced password reset" (magic link on first login). Decided before cutover.
- **Notification campaign:** three-step (T-14d / T-3d / T-0) email + SMS announcements about the domain switch and first-login requirements.
- **Cutover window** (hours): DNS / auth redirects flip to the new stack. Directual blocks user access (read-only or off). Final delta sync if applicable.
- **First-login flow** on the new stack: magic link / SMS-OTP → consent re-capture (per-purpose, v1 versions, see ADR-0009) → optional password set.
- **Sunset criteria:** Directual is fully turned off when X% of active users have moved to the new stack (target ≥50%) OR after 120 days from cutover (whichever first). Signed data deletion certificate with legal sign-off.

**Operational artifact:** `Directual hard cutover runbook + first-login spec` — DSO task (see DSO-63 finding #4), prepared by the time the new stack is near-ready.

**MFA bootstrap for legacy admin** — a separate elevated-session magic-link flow → mandatory TOTP/SMS enrollment within a 7-day window, otherwise manual unlock via support (spec §8.5).

### 10. Step-up authentication for high-risk actions

The base session issued after primary login (§6) carries a single security level, uniform across read and write operations of any kind. For elevated-risk actions — destructive admin operations against users (role grant/revoke, lock, erasure-execute), account-level deletion / erasure-request by the subject, payment-method change, MFA changes, initiating PD export, logout-all — that uniform level is insufficient: an attacker holding a stolen long-lived session MUST NOT be able to execute a catastrophic action immediately without fresh re-authentication.

The list of endpoint classes that require step-up is normatively fixed in **endpoint-authorization-matrix-design §8.1** (`auth: 'step-up'` declaration on `@Authz`). The step-up trigger is OIDC `prompt=login` + `acr_values=urn:ds:acr:mfa-fresh` at the IdP. After successful step-up, the IdP MUST issue an access token with an additional claim `acr=mfa-fresh` and a `mfa_fresh_at` timestamp; the fresh step-up TTL is **30 minutes** (see identity-auth-rbac-design §7.1).

The backend MUST verify `acr=mfa-fresh` AND `mfa_fresh_at ≥ now − 30 min` on every endpoint with `auth: 'step-up'` via a single `StepUpGuard` middleware (see endpoint-authorization-matrix-design §8.2 + backend-core middleware checklist). On failure — `401 Unauthorized` with body `{ error: 'step_up_required', step_up_url: '<IdP authorize URL with prompt=login + acr_values + redirect_uri + state>' }`. This error contract is normative (endpoint-authz-matrix-design §8.2); frontend and mobile MUST handle it.

**Session lifetime after step-up.** The elevated state is a **separate claim in the access token**, not a separate session. The base session (refresh token web 30d / mobile 14d, §6) continues to exist independently: the elevated TTL of 30 min expires faster than the access-token TTL (15 min), but refreshing an access token via refresh token does NOT re-issue `acr=mfa-fresh` automatically — once the elevated window expires, the next high-risk action requires step-up again. Step-up does not extend the base session expiration.

**IdP requirements.** `prompt=login` + custom `acr_values` are supported by Zitadel (§8).

**UX implications.** Frontend (portal/admin/cms) MUST intercept `401 step_up_required`, redirect to `step_up_url` without losing the current context (preserved via the `state` parameter + client-side route restoration after returning with an auth code), exchange the code for a refreshed access token, and retry the original request. Mobile follows the same flow via `ASWebAuthenticationSession` (iOS) / `Custom Tabs` (Android). A series of step-up operations within the 30-minute window does not require repeated authentication (UX-critical for the admin console).

**Audit.** Every step-up attempt (success + fail) MUST be written to `audit_ledger` (ADR-0003 §6, ADR-0009 §2.4 — audit class `auth.step_up.{requested,succeeded,failed}`) with fields `user_id`, `endpoint`, `acr_before`, `acr_after`, `mfa_method`, `ip`, `ua`. The full list of auth audit events — identity-auth-rbac-design §7.3.

**Forward references:**

- **endpoint-authorization-matrix-design §8** — step-up policy, endpoint list, 401-response mechanics, `StepUpGuard` checklist.
- **backend-core-design** — middleware stack for `auth: 'step-up'` (CI rule asserting `StepUpGuard` is present on every endpoint with an `auth: 'step-up'` declaration).
- **identity-auth-rbac-design §7.1** — `acr=mfa-fresh` claim, TTL, MFA-elevated session.
- **ADR-0009 §2.4** — audit class registration for step-up events.

## Consequences

### Positive

- Changing the IdP in the future is cheaper — backend RBAC is isolated behind a thin SSO layer.
- Object-level and fine-grained permissions scale without cardinality explosion in IdP groups.
- Audit log lives alongside domain objects — Federal Law 152-FZ compliance by default.
- Phased OAuth rollout saves ~one week of development in v1.
- UUID PK protects against FK breakage when a user changes their phone/email.
- Two-tier JWT/introspection model gives stateless speed for 99% of requests + statefulness where it matters.
- Minimizing IdP groups in v1 (5 instead of 9) reduces migration complexity.

### Negative

- Users table duplication (IdP + backend mirror via webhook + reconciliation cron). Requires eventual-consistency handling (spec §3.2).
- Two-tier validation: backend must correctly classify high-stakes endpoints; misclassification → security gap or performance hit.
- Hard cutover from Directual (see §9): pre-cutover PD export requires encrypted-at-rest staging + restricted access; Directual sunset after 50% migration or 120 days.
- MFA SMS for `moderator`/`support` in v1 — a known downgrade against NIST SP 800-63B; mitigation planned for v2.

## Open questions (deferred)

1. Session store: inside IdP or shared backend Redis — Phase 0 implementation.
2. Policy engine for backend RBAC (Cerbos / OPA / OpenFGA / SQL) — DSO-26.
3. RF SMS provider + failover scheme — DSO-26.
4. Apple Developer Program registration for an RF legal entity — parallel legal track.
5. Actual count + hash format in Directual + consent re-acquisition plan — Phase 0 discovery.
6. **Target admin/operational role model for DS Platform** — parallel product track (outside DSO-25).
7. Bot-protection provider in RF — default Yandex SmartCaptcha, alternatives — DSO-26.

## Deferred gaps (known)

| Gap                                          | Owner                           | When                        | Status (as of 2026-05-18, DSO-63)                                                             |
| -------------------------------------------- | ------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------- |
| Consent management subsystem                 | ADR-0009 + DSO-X (PD lifecycle) | Pre-pilot launch gate       | **Closed by ADR-0009** — design spec covers versioning, capture, withdrawal                   |
| Right-to-erasure flow                        | ADR-0009                        | Pre-pilot launch gate       | **Closed by ADR-0009 §2.3 + §2.4** — three erasure levels + crypto-shred                      |
| Federal Law 187-FZ (CII) compliance analysis | —                               | —                           | **N/A** — DS Platform is not a CII subject (DSO-63 #7)                                        |
| FSTEC-21 + ISPDn classification (УЗ-3)       | DSO-X (legal track)             | Pre-pilot launch gate       | **In progress** — DSO task created; architecture designed for УЗ-3 (engineering-readiness §5) |
| RKN notification of PD processing            | DSO-X (legal track)             | Pre-pilot launch gate       | **In progress** — parallel legal track                                                        |
| HIBP Pwned Passwords check                   | DSO-26                          | v2                          | (unchanged)                                                                                   |
| Anomaly detection / impossible travel        | DSO-26 + DSO-30                 | v3                          | (unchanged)                                                                                   |
| OWASP ASVS L2/3 audit + MASVS L2 mobile      | External pen-test               | Before v2 release           | (unchanged)                                                                                   |
| DPoP / sender-constrained refresh for mobile | DSO-26                          | v2 (v1 — device-id binding) | (unchanged)                                                                                   |
| WebAuthn / Passkeys                          | DSO-26                          | v2                          | (unchanged)                                                                                   |
| MFA upgrade `moderator`/`support` SMS→TOTP   | DSO-26                          | v2                          | (unchanged)                                                                                   |
