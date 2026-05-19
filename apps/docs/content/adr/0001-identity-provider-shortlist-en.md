---
title: "ADR-0001 — Identity / Auth / RBAC for DS Platform [EN]"
description: "DS Platform is a standalone platform replacing the current Bubble + Directual + Supabase stack. It requires an identity infrastructure that supports:"
lang: en
---

> **EN (this)** · **RU:** [`0001-identity-provider-shortlist-ru.md`](./0001-identity-provider-shortlist-ru.md)

# ADR-0001 — Identity / Auth / RBAC for DS Platform

**Date:** 2026-05-12 (v2 — after independent architecture review); last amended 2026-05-18 (Amendment A2, DSO-63 #2/#4; Amendment A3 (2026-05-18, DSO-63 #5/#6 — PD lifecycle → ADR-0009); Amendment A4 (2026-05-18, DSO-63 follow-up — step-up auth))
**Status:** Accepted (shortlist), final IdP selection — spike ~3 days in Phase 0 implementation
**Related to:** Plane DSO-25 (`0a8f2276-956f-4f4e-9134-2f197ff4bab8`), milestone DSO-24, DSO-63 (external validation)
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

### 2. UI — headless for credentials, near-headless for social

- Credentials (login/register/reset/MFA/magic-link) — forms on `doctor.school` via IdP headless API.
- Social — classic OAuth Authorization Code Flow + PKCE with redirect via `auth.doctor.school` (our subdomain). ~1-second visible hop under our brand.

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
- **Step-up authentication** for elevated-risk actions (admin user-management writes, account/erasure execution, payment-method change, MFA change, role grant/revoke, logout-all) — a separate elevated session with fresh MFA, TTL 30 min, claim `acr=mfa-fresh`. See Amendment A4.
- Mobile storage — Keychain/Keystore; web — HttpOnly + Secure + SameSite=Lax cookie with `__Host-` prefix (NOT localStorage). **Each app (portal, admin, promo) holds its own host-only session cookie**; cross-app SSO continuity is achieved via OIDC silent re-auth (`prompt=none`) at the IdP — see Amendment A2 (which supersedes the earlier Amendment A1.1 about a shared `__Secure-ds_session` cookie on `.doctor.school`).
- JWKS rotation — graceful overlap window 24h.

### 7. Security baseline (mandatory for v1)

- Rate limiting: per-user (5 attempts / 15 min), per-IP (20 / 15 min), per-ASN (100 / hour).
- SMS toll-fraud protection: per-phone (3/hour) + per-IP (10/hour) + per-ASN (100/hour) + **global daily budget circuit-breaker** (≤2000 SMS/day).
- Account lockout: 10 failed logins / 30 min → soft-lock + email notification.
- Refresh token theft detection: re-use → invalidate the chain (RFC 6819).
- Email/phone enumeration protection: idempotent responses on login/reset/register with timing delta ≤50ms.
- CAPTCHA: **Yandex SmartCaptcha** (RF-accessible; hCaptcha/reCAPTCHA deprecated in RF).
- CSRF protection + cookie security profile (`__Host-` per app, no shared cookies across subdomains — see Amendment A2; full security profile described here, not duplicated in the frontend spec).
- **Content Security Policy (CSP) profile-per-zone** — mandatory protection against XSS/clickjacking, differentiated by zone sensitivity level: admin (strictest, no inline, no unsafe-eval), portal (standard, allow specific 3rd-party origins), promo (relaxed, allow analytics/marketing pixels), docs (default Fumadocs profile). Specific directives — Amendment A1 + frontend design spec §3.2.
- PD in logs is masked; full values only in encrypted audit log with RF-resident KMS.
- Full list of mandatory auth audit events — spec §7.3.

### 8. IdP shortlist — **Authentik** or **Zitadel**

Final selection is deferred to the Phase 0 implementation spike. Budget: **~3 working days** (1.5 per candidate). Criteria — headless API ergonomics, RF SMS-provider integration, Telegram HMAC, bulk-import dry-run, **webhook outbox-pattern run**, **account-linking PKCE-flow with pre-auth takeover scenario**, ops ergonomics on Timeweb.

#### Rejected candidates

- **Keycloak.** Enormous maturity, RedHat-backed, significant local expertise in the RF sector. However: magic-link and SMS-OTP are not out-of-the-box — only via Java SPI extensions; JVM operation (2GB+ heap, GC tuning) is more resource-intensive for a 1–2 person team than Python/Go IdPs; admin API ergonomics are heavier. This is not a disqualification, but a trade-off against Authentik/Zitadel: in our scenario (headless-first, magic-link OOB, low ops budget) Authentik/Zitadel win. If both fail the spike — Keycloak is the fallback.
- **Ory Kratos.** Best-in-class headless-first API. However: **no built-in admin UI** — for a 1–2 person team this means writing admin tooling from scratch; multi-service deployment (Kratos + optional Hydra/Oathkeeper/Keto) complicates ops; vendor (Ory Inc) actively pushes managed Ory Network, self-hosted remains but the direction is commercial.
- **Authelia.** Wrong category — this is a forward-auth proxy for protecting services behind nginx/Traefik, not a full IdP. No self-signup, magic-link, SMS-OTP, social OAuth client, or admin UI for users. May be used separately to protect internal BBM tooling (Plane / Grafana / GlitchTip), but not for user-facing DS Platform identity.
- **Logto** (rejected after explicit review per architecture review). TS/Node, headless-first, MIT, lightweight self-host. A strong candidate on paper. Rejected because: (a) less battle-tested in self-hosted production (project is younger than Authentik/Zitadel/Keycloak); (b) SMS-OTP support is less mature — requires a custom connector; (c) admin UI is claimed but less feature-rich than Authentik's. Possible reconsideration in v2 if both Authentik and Zitadel fail the spike.
- **FusionAuth** (rejected after explicit review per architecture review). One of the best headless APIs, single-binary deploy, free self-hosted edition. Rejected because: (a) free edition has limits on advanced policy features (multi-tenancy, advanced threat detection) — may become a blocker in v2/v3; (b) Java/JVM stack with the same ops costs as Keycloak; (c) commercial vendor (FusionAuth Inc, US) — higher sanctions exposure than EU-based Authentik/Zitadel.
- **SuperTokens.** Headless, MIT, but a fragmented SDK approach (auth-core separate from per-language SDK) — adds complexity to our custom form-flows. Less mature admin UI.

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
- Hard cutover from Directual (amendment per DSO-63 #4): pre-cutover PD export requires encrypted-at-rest staging + restricted access; Directual sunset after 50% migration or 120 days (see §9).
- Final IdP selection deferred to ~3 days of spike → milestone DSO-24 closure shifts by the duration of the spike.
- MFA SMS for `moderator`/`support` in v1 — a known downgrade against NIST SP 800-63B; mitigation planned for v2.

## Open questions (deferred)

1. Final choice of Authentik vs Zitadel — Phase 0 spike (~3 days).
2. Session store: inside IdP or shared backend Redis — Phase 0 implementation.
3. Policy engine for backend RBAC (Cerbos / OPA / OpenFGA / SQL) — DSO-26.
4. RF SMS provider + failover scheme — DSO-26.
5. Apple Developer Program registration for an RF legal entity — parallel legal track.
6. Actual count + hash format in Directual + consent re-acquisition plan — Phase 0 discovery.
7. **Target admin/operational role model for DS Platform** — parallel product track (outside DSO-25).
8. Bot-protection provider in RF — default Yandex SmartCaptcha, alternatives — DSO-26.

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

---

## Amendments

### A1 (2026-05-15, DSO-61) — SSO cookie carve-out + CSP profile-per-zone

This amendment consolidates two related security baseline clarifications identified during the cross-spec consistency analysis (DSO-61).

#### A1.1 — `__Secure-` carve-out for cross-subdomain SSO cookie [SUPERSEDED 2026-05-18 by Amendment A2]

> **Status: Superseded by Amendment A2 (DSO-63 #2).** The decision to use a shared `__Secure-ds_session` cookie on `.doctor.school` for cross-app SSO is revoked following the external architecture validation. The current model is host-only `__Host-` cookies per app + OIDC silent re-auth for cross-app continuity. See Amendment A2.

**Historical content (for context):** Amendment A1.1 previously introduced a carve-out — for the SSO cookie between portal and promo a `__Secure-` prefix was allowed instead of `__Host-`. Mitigations included: SameSite=Lax, fingerprint binding, CSRF double-submit, subdomain takeover protection.

**Reason for reversal (DSO-63 #2):** a shared cookie spanning trust-zone boundaries (admin/portal vs promo/marketing) makes admin security depend on the quality of the weakest subdomain. XSS or subdomain takeover under promo/docs compromises the admin session. The mitigations (fingerprint binding, CSRF) are bypassed by same-origin XSS. For a medical platform under 152-FZ this is a structural defect, not an acceptable compromise.

#### A1.2 — CSP profile-per-zone (new requirement §7)

**What is added:** §7 Security baseline did not previously include Content Security Policy. ADR-0004 §Context referenced "ADR-0001 §7 CSP profile-per-zone" — which reflected intent, but CSP was not actually present in §7. This amendment closes the gap.

**Profiles (minimum baseline; specific `default-src`, `script-src`, `style-src`, `img-src`, `connect-src`, `frame-ancestors`, `form-action`, `report-uri` directives — frontend design spec §3.2):**

| Zone                          | Profile              | Notes                                                                                                                                                           |
| ----------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin.doctor.school`         | strictest            | `default-src 'self'`; no `unsafe-inline`, no `unsafe-eval`, no 3rd-party origins (including analytics); strict nonce-based script-src; `frame-ancestors 'none'` |
| `portal.doctor.school` (app)  | standard             | `default-src 'self'`; allow Centrifugo WS endpoint, Timeweb CDN, Sentry, permitted embed origins (video providers from CMS); nonce-based scripts                |
| `doctor.school` (promo SSG)   | relaxed              | allows analytics (Plausible self-hosted), pixel-marketing endpoints (if any); still no `unsafe-eval`; `frame-ancestors 'none'`                                  |
| `docs.doctor.school`          | Fumadocs default     | plus our `report-uri`; no exceptions for admin/portal/promo                                                                                                     |
| `cms.doctor.school` (Payload) | strict (admin-level) | analogous to admin; editors inside VPN/IdP only                                                                                                                 |

**Cross-zone constraints:**

- All profiles: `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
- All profiles: CSP violations are sent to a unified `csp-report-collector` endpoint (`apps/api/`-level), written to `audit_log` + alerting in Sentry on pattern-spikes.
- Admin zone: additionally `Permissions-Policy: geolocation=(), microphone=(), camera=()` (lock down browser API surface).

**Authoritative implementation reference:** frontend design spec §3.2 + §3.2.2 (new sub-section); specific CSP directives may evolve without an amendment to this ADR (operational change), but changing zone profiles or relaxation levels requires a new amendment.

**Closes:** B5 + B7 from DSO-61 consistency report.

### A2 (2026-05-18, DSO-63 #2) — Host-only sessions + OIDC silent re-auth

This amendment reverses A1.1 and fixes the architecturally correct model of cross-app SSO following the external validation (DSO-63).

#### Context

The external reviewer (Claude) raised the following High-severity finding #2: the shared `__Secure-ds_session` cookie on `.doctor.school` is incompatible with zero-trust principles between trust zones:

> "Cross-subdomain `__Secure-ds_session` is an accepted downgrade. XSS or subdomain takeover anywhere under `.doctor.school` can threaten the shared session."

On analysis it became clear that:

- The UX rationale of A1.1 ("login state continuity between portal and promo") is solved by standard OIDC SSO (silent re-auth with `prompt=none`), without a shared cookie.
- The A1.1 mitigations (fingerprint binding, CSRF double-submit, short TTL) do not close the root threat — same-origin XSS uses the victim's browser (matching fingerprint) and reads the cookie directly.
- The architecture already provides two-tier JWT + IdP (§1, §6) — the base for OIDC silent re-auth is already there.

#### Decision

**Each app holds its own host-only session cookie:**

- `portal.doctor.school` — its own `__Host-` cookie, scoped to the portal origin.
- `admin.doctor.school` — its own `__Host-` cookie.
- `promo.doctor.school` / root `doctor.school` — its own `__Host-` cookie (if authenticated state is required for lead forms).
- `docs.doctor.school`, `cms.doctor.school` — their own `__Host-` cookies.
- IdP (`auth.doctor.school`) — its own host-only session (the IdP's own DB, see ADR-0002 §3).

**Cross-app login continuity is achieved via OIDC silent re-auth:**

- When a user lands on subdomain X without a valid local session, app X performs a silent redirect → IdP with `prompt=none`.
- If the user has an active IdP session (cookie on `auth.doctor.school` host-only) — IdP immediately issues an authorization code → app X exchanges it for its own app-specific session token.
- Without an active IdP session — normal login flow.
- UX: the user sees an instantaneous transparent redirect (≤300ms), no explicit login.

**Mandatory IdP requirements** (for DSO-25 spike):

- Support `prompt=none` (silent re-auth).
- Allow multiple `redirect_uri` per OAuth client (or multiple clients, one per subdomain).
- Cookie configured as host-only (not SameSite=None cross-site).

**Authentik / Zitadel / Keycloak** all support these requirements. Amendment A2 does not narrow the IdP shortlist.

#### Session security profile (consolidated — single source of truth)

All cookie-based session rules live **here, in §6 + Amendment A2**. Frontend / mobile / API specs forward-reference ADR-0001 §6 instead of duplicating:

- **Prefix:** `__Host-` mandatory. No `Domain` attribute. `Path=/`, `Secure`, `HttpOnly`, `SameSite=Lax` (minimum; `Strict` for admin/cms).
- **TTL:** matches refresh-token web TTL §6 (30d web, 14d mobile).
- **Rotation:** based on refresh-token rotation (RFC 9700), §6.
- **CSRF protection:** double-submit pattern (cookie + header) on every state-changing API endpoint.
- **Fingerprint binding:** UA + IP /24 + accept-language hash in session metadata; mismatch → re-auth via IdP.
- **Force-logout:** session-store DELETE → cookie invalidated on next request.

#### Frontend / mobile alignment

- **frontend-stack-design §3.2.1** — rewritten under the "host-only per app + OIDC silent re-auth" model. Contains the silent-redirect UX flow.
- **identity-auth-rbac-design §3.2** — adds a "Cross-app SSO via OIDC silent re-auth" subsection with a flow diagram.
- **mobile-stack-design** — unchanged (mobile already uses token-based auth + Keychain/Keystore, not cookies).

#### Closes

- DSO-63 finding #2 (cross-subdomain `__Secure-ds_session`).
- DSO-63 finding #3 (cookie security profile split between ADR-0001 §6 and frontend-design §3.2.1 — now single source of truth in ADR-0001 §6).
- DSO-63 mini-F (domain naming normalization — all subdomains used as config constants).

### A3 (2026-05-18, DSO-63 #5+#6) — PD lifecycle moved to ADR-0009

PD lifecycle, consent management, retention, right-to-erasure — previously spread across §134-141 of this ADR + engineering-readiness §5 + data-layer-design §2.5 — are now architecturally consolidated in **ADR-0009 "PD Lifecycle, Consent, Retention, Erasure"** + the associated design spec.

**Forward references:** the consent capture flow at first-login (see §9 hard cutover) uses `consent_versions` v1 from ADR-0009 §2.1. Right-to-erasure endpoints under `/me/*` — from ADR-0009 §2.2. Audit-log tombstoning compatibility — ADR-0009 §2.4.

**Closes:** DSO-63 finding #5 (separate ADR for PD lifecycle), #6 (retention matrix).

### A4 (2026-05-18, DSO-63 follow-up) — Step-up authentication for high-risk actions

**Status:** Accepted (2026-05-18, DSO-63 follow-up / DSO-67).

#### Context

The base session issued after primary login (§6 + Amendment A2) carries a single security level, uniform across read and write operations of any kind. For elevated-risk actions — destructive admin operations against users (role grant/revoke, lock, erasure-execute), account-level deletion / erasure-request by the subject, payment-method change, MFA changes, initiating PD export, logout-all — that uniform level is insufficient: an attacker holding a stolen long-lived session MUST NOT be able to execute a catastrophic action immediately without fresh re-authentication.

#### Decision

The list of endpoint classes that require step-up is normatively fixed in **endpoint-authorization-matrix-design §8.1** (`auth: 'step-up'` declaration on `@Authz`). The step-up trigger is OIDC `prompt=login` + `acr_values=urn:ds:acr:mfa-fresh` at the IdP. After successful step-up, the IdP MUST issue an access token with an additional claim `acr=mfa-fresh` and a `mfa_fresh_at` timestamp; the fresh step-up TTL is **30 minutes** (see identity-auth-rbac-design §7.1).

The backend MUST verify `acr=mfa-fresh` AND `mfa_fresh_at ≥ now − 30 min` on every endpoint with `auth: 'step-up'` via a single `StepUpGuard` middleware (see endpoint-authorization-matrix-design §8.2 + backend-core middleware checklist). On failure — `401 Unauthorized` with body `{ error: 'step_up_required', step_up_url: '<IdP authorize URL with prompt=login + acr_values + redirect_uri + state>' }`. This error contract is normative (endpoint-authz-matrix-design §8.2); frontend and mobile MUST handle it.

#### Session lifetime after step-up

The elevated state is a **separate claim in the access token**, not a separate session. The base session (refresh token web 30d / mobile 14d, §6) continues to exist independently: the elevated TTL of 30 min expires faster than the access-token TTL (15 min), but refreshing an access token via refresh token does NOT re-issue `acr=mfa-fresh` automatically — once the elevated window expires, the next high-risk action requires step-up again. Step-up does not extend the base session expiration.

#### IdP requirements

`prompt=login` + custom `acr_values` are supported by **Authentik, Zitadel, and Keycloak** — all three candidates from §8. Amendment A4 does not narrow the IdP shortlist; the requirement is added to the Phase 0 spike checklist (DSO-25).

#### UX implications

Frontend (portal/admin/cms) MUST intercept `401 step_up_required`, redirect to `step_up_url` without losing the current context (preserved via the `state` parameter + client-side route restoration after returning with an auth code), exchange the code for a refreshed access token, and retry the original request. Mobile follows the same flow via `ASWebAuthenticationSession` (iOS) / `Custom Tabs` (Android). A series of step-up operations within the 30-minute window does not require repeated authentication (UX-critical for the admin console).

#### Audit

Every step-up attempt (success + fail) MUST be written to `audit_ledger` (ADR-0003 §6, ADR-0009 §2.4 — audit class `auth.step_up.{requested,succeeded,failed}`) with fields `user_id`, `endpoint`, `acr_before`, `acr_after`, `mfa_method`, `ip`, `ua`. The full list of auth audit events — identity-auth-rbac-design §7.3.

#### Forward references

- **endpoint-authorization-matrix-design §8** — step-up policy, endpoint list, 401-response mechanics, `StepUpGuard` checklist.
- **backend-core-design** — middleware stack for `auth: 'step-up'` (CI rule asserting `StepUpGuard` is present on every endpoint with an `auth: 'step-up'` declaration).
- **identity-auth-rbac-design §7.1** — `acr=mfa-fresh` claim, TTL, MFA-elevated session.
- **ADR-0009 §2.4** — audit class registration for step-up events.

#### Closes

- DSO-63 follow-up / DSO-67 — normative anchoring of step-up auth at the ADR level (previously lived in design specs only).
