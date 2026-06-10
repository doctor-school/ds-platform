---
title: "DS Platform — Identity / Auth / RBAC design [EN]"
description: "1. RBAC = hybrid — IdP knows 9 product roles (PRD §13) as groups + temporary legacy_admin group for the migration window + MFA-policy per group;..."
lang: en
---

> **EN (this)** · **RU:** [`0001-identity-provider-shortlist-design-ru.md`](./0001-identity-provider-shortlist-design-ru.md)

# DS Platform — Identity / Auth / RBAC design

**Date:** 2026-05-12 (v2 — after independent architecture review, thorough revision of security baseline + migration)
**Author:** Tech Lead
**Related to:** Plane DSO-25 (`0a8f2276-956f-4f4e-9134-2f197ff4bab8`), milestone DSO-24
**Inputs:** `outputs/2026-05-12-ds-platform-tech-requirements-digest.md` §8.1/§1.1/§9.3, `outputs/2026-05-12-ds-platform-inventory.md`, `outputs/2026-05-12-tech-stack-brainstorm-prep.md`
**Output:** `apps/docs/content/adr/0001-identity-provider-shortlist-en.md` + input for DSO-26..31

---

## 0. TL;DR

1. **RBAC = hybrid** — IdP knows 9 product roles (PRD §13) as groups + temporary `legacy_admin` group for the migration window + MFA-policy per group; fine-grained and object-level permissions + audit log live in the backend. The target admin/operational role model is a product task (not a 1:1 migration of 7 Directual roles).
2. **UI — headless for credentials, near-headless for social.** All credential forms (login/register/reset/MFA/magic-link) — on `doctor.school` via IdP headless API; IdP UI is never shown to the user. Social login — classic OAuth redirect through our subdomain `auth.doctor.school`, ~1-second visible hop.
3. **Identifiers — dual + UUID PK.** Phone and email are both unique and both login methods; UUID is the sole FK key. Phone-first UX on mobile/doctor-flow, email-first on admin/expert-flow.
4. **Auth methods v1:** email+password, email+magic-link, phone+SMS-OTP, biometric unlock (mobile, local), MFA TOTP — mandatory for `expert / clinic_admin / investor / platform_admin`; MFA SMS as an acceptable trade-off for `moderator / support` in v1 (planned downgrade, see §5).
5. **OAuth — phased rollout.** v1: no social. v2: VK ID + Yandex ID + Telegram Login. v3: Apple Sign-In if iOS App Store. Max / Google — on demand. **Account linking requires a verified email on both sides** (protection against pre-auth account takeover).
6. **Tokens:** OAuth 2.0 BCP (RFC 9700). Access JWT 15min + opaque refresh 30d (web) / 14d (mobile), rotating single-use. PKCE for public clients. Sender-constrained refresh for mobile (DPoP / device-id binding). Server-side session store (Redis). Force-logout via DELETE session. IdP introspection — only for high-stakes endpoints (admin/payments/AU withdrawal/role-change), not on the hot path.
7. **Security baseline (§5.5):** rate limiting per-user/IP/ASN, enumeration protection (idempotent responses on login/reset), SMS toll-fraud protection (global budget circuit-breaker + IP/ASN limits), RF-accessible CAPTCHA (Yandex SmartCaptcha), account-lockout policy, refresh token theft detection. **Cookie default — `__Host-` prefix per app**; cross-app SSO continuity via OIDC silent re-auth (ADR-0001 §6).
8. **IdP selection** — closed in §9 (Zitadel; ADR-0001 §8, DSP-209).
9. **Directual migration:** Phase 0 discovery (hash format + actual count + consent re-acquisition plan) → bulk import (hash-compatible → as-is; otherwise magic-link reset) → **90-day** soft-migration window (not 30) with a realistic target reactivation rate of 50–70% (not 95%) → sunset Directual auth.
10. **Deferred gaps** (§10.3) — an explicit registry of what is not closed in DSO-25 and must go in the backlog: consent management, right-to-erasure, Federal Law 187-FZ/FSTEC-17, anomaly detection, HIBP credential check, OWASP ASVS pen-test gates.

---

## 1. Scope and non-goals

### In scope of DSO-25

- IdP selection architecturally (shortlist), interface model, token format, set of auth methods, RBAC layering, migration strategy from Directual, **security baseline for the auth layer**.

### Not in scope of DSO-25 (deferred)

- **Final IdP selection** — closed in §9 (Zitadel; ADR-0001 §8, DSP-209).
- Specific RF SMS provider — **decided: SMS-Aero** (smsaero.ru Gate API v2; SMSC.ru / SMS.ru as the failover-2-provider per digest §2). Wiring + circuit-breaker contract in identity-auth-rbac-design §5 and engineering-readiness §5.bis. (Plane DSO-26/57/58 are cross-tracker references only — superseded by this decision.)
- Policy engine for backend RBAC (Cerbos / OPA / OpenFGA / SQL-based) — DSO-26.
- Where the session store lives (inside IdP or shared backend Redis) — Phase 0 implementation (see §7.4).
- EGRUL API verification for clinics (v3) — DSO-26.
- Business flow "diploma upload + manual moderation" — product task.
- Consent management subsystem (`consent_history`) — DSO-26 (see §10.3).
- Right-to-erasure flow — DSO-26 (see §10.3).
- Federal Law 187-FZ (CII (Critical Information Infrastructure)) and FSTEC-17/21 protection classes — parallel compliance track (see §10.3).
- Anomaly detection / impossible travel — v3 feature.
- HIBP credential check on registration — v2 enhancement.
- Pen-test gates per OWASP ASVS / MASVS levels — DSO-26 + before v2 release.

---

## 2. RBAC architecture (decision: hybrid)

### 2.1. Layering

```
┌────────────────────────────────────────────────────────────┐
│ IdP (Zitadel)                                              │
│ — Stores: users, credentials, groups (coarse roles),       │
│   MFA-policy per group, sessions, auth audit log.          │
│ — Issues: OIDC tokens with claims {sub, roles[], mfa, sid}.│
└─────────────────────┬──────────────────────────────────────┘
                      │ JWT (fast path) + introspection (high-stakes)
                      ▼
┌────────────────────────────────────────────────────────────┐
│ Backend                                                    │
│ — Stores: user_roles (mapping), object-level relations     │
│   (course_authorships, clinic_memberships, expert_links),  │
│   fine-grained permissions, domain audit log               │
│   (append-only ledger-style).                              │
│ — Decides: "can actor X perform action A on resource R"    │
│   via policy engine (TBD in DSO-26).                       │
└────────────────────────────────────────────────────────────┘
```

### 2.2. Groups in IdP — minimized in v1

Reviewer note accepted: 9 groups from the very start is excessive for phase 0. **v1 includes only active groups; the rest are added incrementally as features arrive.**

| Group            | Active from                          | Access                                               | MFA required                        |
| ---------------- | ------------------------------------ | ---------------------------------------------------- | ----------------------------------- |
| `guest`          | v1                                   | public content                                       | ❌                                  |
| `doctor_guest`   | v1                                   | mini-app QR, limited mobile preview                  | ❌                                  |
| `doctor`         | v1                                   | full mobile, web doctor cabinet                      | ❌                                  |
| `legacy_admin`   | v1 (migration)                       | temporary fallback for legacy admin-users, read-only | ✅ (see §8.5 bootstrap)             |
| `platform_admin` | v1                                   | admin/CMS                                            | ✅ TOTP                             |
| `expert`         | v2 (when expert cabinet is launched) | expert cabinet, AI tools                             | ✅ TOTP                             |
| `moderator`      | v2                                   | content moderation                                   | ✅ SMS (v1-acceptable; TOTP in v2+) |
| `support`        | v2                                   | technical support via Plane                          | ✅ SMS (v1-acceptable; TOTP in v2+) |
| `investor`       | v2                                   | investor cabinet                                     | ✅ TOTP                             |
| `clinic_admin`   | v3                                   | clinic cabinet                                       | ✅ TOTP                             |

**MFA trade-off:** TOTP enrollment for all 6 roles in one cutover — operational overload for a 1–2 person team. For low-density roles (`moderator`, `support` — 1–2 people) SMS-MFA is acceptable in v1 (despite NIST SP 800-63B deprecation for high-assurance); upgrade to TOTP as the team grows. For roles with access to payments/AU/identity operations (`expert`, `platform_admin`, `investor`, `clinic_admin`) — TOTP is mandatory immediately.

Admin/operational roles for DS Platform — **a parallel product task**, not a 1:1 migration from Directual.

**Manager hierarchy** (`manager1_user` from Directual) — backend table `manager_hierarchy` (structural data, not a permission model).

**Multi-group membership** — a native pattern in both IdP candidates. A doctor-expert-in-a-clinic = three groups simultaneously.

### 2.3. What is NOT in the IdP (lives in the backend)

- **Object-level relations:** `course_authorships`, `clinic_memberships`, `expert_course_links`, `manager_hierarchy`.
- **Fine-grained permissions:** `course.create`, `lesson.publish`, `user.verify`, `withdraw_au_for_user`, `transfer_event_manager`, etc. — computed based on (role, resource, context) by the policy engine, NOT stored as IdP claims.
- **Domain audit log:** append-only `audit_events` table, 3-year retention, non-deletable even by `platform_admin` (PRD §31). See §7.3 for the list of mandatory events.

### 2.4. Principles

- JWT claims are minimal: `sub`, `roles[]`, `mfa: bool`, `sid`, `iat`, `exp`, `jti`. `roles[]` — coarse-grained labels (4–10 strings), not permission lists; token size stays <1KB. No `permissions[]`, `resources[]`, attribute lists.
- One canonical actor ID — UUID from IdP `sub`. All backend FKs reference this UUID.
- Changing the IdP must not break backend RBAC — isolation behind a thin SSO layer.

### 2.5. Endpoint authorization matrix (DSO-63 #A, mandatory artifact)

> **Forward reference:** the detailed matrix-row contract, format of `apps/api/docs/endpoint-authz-matrix.md`, CI gate `tools/lint-endpoint-authz`, and pre-pilot sample endpoints are specified in **`2026-05-18-ds-platform-endpoint-authorization-matrix-design`**. The text below is a normative stub; the full specification lives in that design spec.

**Requirement:** every REST/RPC endpoint of the backend carries classification metadata — required role(s), the policy-check kind (engine-neutral: role-only fast-path vs full policy evaluation), audit requirement, test coverage. The source of truth is TS annotations on NestJS controllers + an aggregated table in `apps/api/docs/endpoint-authz-matrix.md`. CI gate `tools/lint-endpoint-authz` validates that every decorated endpoint has full metadata; missing metadata → CI fail.

**Matrix row structure:**

| Field            | Description                                                                                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `endpoint`       | HTTP method + path, or RPC name (derived from the route)                                                                                                                                     |
| `access`         | `public` (no authenticated subject) or `authenticated`                                                                                                                                       |
| `required_roles` | Minimum role(s) for access, from the §2.2 IdP group model (`guest`, `doctor_guest`, `doctor`, `platform_admin`, …); `—` when `access: public`                                                |
| `auth_check`     | `none` (public), `fast-path` (JWT/role only), or `policy` (full policy-engine eval — **engine-neutral**; the concrete engine, Cerbos by default, sits behind `IPolicyEngine`, ADR-0002 §3.2) |
| `object_attrs`   | object-level checks (e.g. `course.author_id == actor.id`); only with `auth_check: policy`                                                                                                    |
| `step_up`        | boolean — requires fresh step-up authentication (`acr=mfa-fresh`); the step-up _mechanism_ lives in `identity-auth-rbac-design` (§10), the matrix carries only the flag                      |
| `audit`          | `none` / `low-stakes` / `high-stakes` — determines whether an entry in `auth_audit` is required                                                                                              |
| `test_coverage`  | covering EARS id(s); the generator resolves them to test links                                                                                                                               |

**Pre-pilot scope:** the matrix is created **before the first endpoint**; AI agents generating new endpoints must fill in the row. Mismatch (endpoint without metadata) — blocking CI gate. DSO task (DSO-X4) for initial setup + tooling.

**Why this matters:** Two-tier validation (§7.2) only works when the backend correctly classifies high-stakes endpoints. Classification error = security gap. Without an enforced matrix, this classification is done ad-hoc, which is a major risk in AI-driven dev.

---

## 3. Identifiers and data model

### 3.1. User identity table (backend mirror)

```
users:
  id              UUID PK                  -- canonical, = IdP sub
  phone           TEXT UNIQUE NULL          -- E.164
  email           TEXT UNIQUE NULL
  email_verified  TIMESTAMP NULL
  phone_verified  TIMESTAMP NULL
  display_name    TEXT
  primary_locale  TEXT DEFAULT 'ru'
  status          ENUM('active', 'pending_migration', 'dormant', 'suspended', 'deleted')
  source          ENUM('new', 'migrated_directual', 'oauth_provisioned')
  created_at      TIMESTAMP
  CONSTRAINT email_or_phone_required CHECK (phone IS NOT NULL OR email IS NOT NULL)
```

Backend `users` — **mirror** based on IdP user-events. **This handshake is a critical design point and requires an explicit consistency strategy:**

### 3.2. IdP → backend user sync (outbox + reconcile)

- **Primary channel — webhook** (IdP → backend `POST /internal/idp/events`). Events: `user.created`, `user.updated`, `user.deleted`, `user.group_changed`. Delivery — HMAC-signed payload.
- **Idempotency** — webhook-receiver stores a `processed_events` table with `(event_id, processed_at)`; duplicates are no-ops.
- **Outbox in IdP** — Zitadel does not support a built-in outbox; compensated via retry on the webhook-receiver side: 5xx response = Zitadel retries with exponential backoff (Zitadel actions).
- **Reconciliation cron** — once per hour the backend polls the Zitadel admin API (user list with `?last_modified__gte=` filter), compares with the `users` mirror, fixes drift. Any drift event is written to `audit_events` as `idp_sync_drift_detected`.
- **On webhook loss** — reconciliation cron closes the gap within ≤1 hour. This is an acceptable trade-off for a medical platform (≠ fintech, where <1 minute is required).

### 3.3. UX priorities for identifiers

| Surface                                                    | Primary registration                    | Secondary login                    |
| ---------------------------------------------------------- | --------------------------------------- | ---------------------------------- |
| Mobile app (#15) — doctor                                  | Phone + SMS-OTP, passwordless           | email + password, email magic-link |
| Mini-app QR (#16, prototype)                               | Phone-first (as implemented)            | —                                  |
| Web doctor cabinet (#17)                                   | "Phone or email" field with auto-detect | password / SMS-OTP / magic-link    |
| Web expert / clinic_admin / investor / admin (#14, #18–20) | Email + password mandatory              | + 2FA                              |
| Legacy migration users                                     | Email (as in Directual)                 | + dialog "add your phone"          |

---

## 4. UI model — terminology clarification

### 4.1. Principles

- **Headless for credentials:** all login/register/reset/MFA/magic-link forms — on our domain (`doctor.school`, `app.doctor.school`, mobile native), sending JSON to the IdP headless API and receiving a next-step JSON response. The user never sees the IdP UI.
- **Near-headless for social:** social login is a **classic OAuth Authorization Code Flow with PKCE** (RFC 7636), which by specification requires a browser redirect to the provider. The visible hop through our subdomain `auth.doctor.school` under our brand — ~1 second. Not "headless" in the strict sense, but also not "third-party IdP UI".
- **Zitadel Login v2 — considered and rejected for credentials** (ADR-0001 §2): it would cut custom UI code but forces a redirect hop to an auth subdomain, contradicting the headless-inline choice for credentials (redirect is accepted only for social). Recorded so it is not re-litigated.

### 4.2. By provider

Zitadel exposes a native headless-first **v2 Session API** (gRPC + REST) — explicit, resource-oriented session creation and step transitions. Covers login / register / password reset / magic-link / SMS-OTP / MFA prompts (only the clickable-link transport of magic-link is a custom build over the session API — the one-time secret is native; see ADR-0001 §8 known trade-offs).

### 4.3. Social login flow

```
[doctor.school login form]
   │ click "Sign in with VK"
   ▼
[auth.doctor.school/source/oauth/login/vk/?code_challenge=...]   ← PKCE
   │ redirect to VK
   ▼
[vk.com/oauth/authorize]
   │ user consent, callback with code
   ▼
[auth.doctor.school/source/oauth/callback/vk/]
   │ IdP verifies PKCE verifier, creates/links user (see §6.2 guards), issues auth code
   ▼
[doctor.school/auth/callback]                  ← our frontend
   │ exchanges code for session
   ▼
[doctor.school/app]                            ← logged in
```

### 4.4. Native mobile

- First login: phone+OTP / email via headless API; tokens are stored in iOS Keychain / Android Keystore.
- Subsequent: biometric unlock removes the local lock, **not an auth-flow** — tokens remain the same, IdP is not called.
- Token refresh: refresh-token rotation on each app launch with an expired access token; refresh sender-constrained (see §7.2).
- Social login on mobile: ASWebAuthenticationSession (iOS) / Custom Tabs (Android) with the same `auth.doctor.school` redirect flow, PKCE mandatory.

---

## 5. Auth methods (v1)

| Method             | Surface                                                                    | Implementation                                                                                                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email + password   | All web frontends                                                          | bcrypt/argon2 (IdP-managed), policy: ≥12 chars / mixed case / digit; **enumeration protection** on login (idempotent response, see §5.5)                                                                                     |
| Email + magic-link | All surfaces for returning users                                           | TTL 15 min, single-use, **invalidate prior pending tokens on new request** (protection against token-flood), rate-limit 3 requests / hour / email, bound to user-agent at first-click (protection against link interception) |
| Phone + SMS-OTP    | Mobile, web (option), mini-app                                             | 6-digit code, TTL 5 min, **multi-layer rate-limit** (see §5.5: 3/hour/phone + 10/hour/IP + global circuit-breaker)                                                                                                           |
| Biometric unlock   | Mobile only                                                                | Local session unlock (TouchID/FaceID/Android biometric), not an auth-flow                                                                                                                                                    |
| MFA TOTP           | `expert` / `clinic_admin` / `investor` / `platform_admin` (digest §8.1)    | Mandatory for listed groups; set up at first login                                                                                                                                                                           |
| MFA SMS            | `moderator` / `support` v1 (downgrade), backup channel for TOTP for others | v1 trade-off for low-cardinality roles with low ops-capacity; upgrade to TOTP in v2                                                                                                                                          |

WebAuthn / Passkeys — **out of scope v1**, added in v2 as an additional method (both IdP candidates support this).

### 5.5. Security baseline for the auth layer

Minimum set of protections for production launch. Implementation — partly IdP, partly reverse-proxy / API gateway / backend (exact split — DSO-26).

| Protection                         | Where             | Details                                                                                                                                                                                                                    |
| ---------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rate limiting — per-user           | IdP / API gateway | Login: 5 attempts / 15 min / `(email \| phone)`, then lock for 30 min or CAPTCHA                                                                                                                                           |
| Rate limiting — per-IP             | API gateway       | Login + register: 20 attempts / 15 min / IP; SMS-OTP request: 10 / hour / IP                                                                                                                                               |
| Rate limiting — per-ASN            | API gateway       | Anti-distributed: 100 attempts / hour / ASN on login + register endpoints (blocks coordinated bot networks)                                                                                                                |
| SMS toll-fraud protection          | API gateway + IdP | (1) per-phone 3/hour, (2) per-IP 10/hour, (3) per-ASN 100/hour, (4) **global daily budget circuit-breaker** (≤2000 SMS/day at launch; exceeded → alert + pause SMS endpoint)                                               |
| Account lockout policy             | IdP               | After 10 failed logins in 30 min — soft-lock 30 min + email notification to owner; admin roles — longer lock + manual unlock via support                                                                                   |
| Refresh token theft detection      | IdP               | Re-use of an already-used refresh token (RFC 6819) → **invalidate the ENTIRE refresh token chain for that session** + alert + force re-auth                                                                                |
| Email/phone enumeration protection | IdP + backend     | Login + reset + register endpoints return **identical response** regardless of user existence ("if such an email exists, we sent a message"). Timing difference ≤50ms                                                      |
| CAPTCHA after N attempts           | API gateway       | **Yandex SmartCaptcha** (RF-accessible) — hCaptcha/reCAPTCHA deprecated in RF. Trigger: 3+ failed logins / IP over 5 min                                                                                                   |
| Compromised credentials check      | IdP / backend     | **Deferred to v2:** HIBP Pwned Passwords k-anonymity API on registration + password change                                                                                                                                 |
| CSRF protection                    | Backend           | CSRF tokens on mutating endpoints; SameSite=Lax cookie + `__Host-` prefix per app (no shared cross-subdomain cookies)                                                                                                      |
| Cookie security                    | Backend           | `Secure; HttpOnly; SameSite=Lax; __Host-` prefix per app; **no tokens in localStorage**. Cross-app continuity via OIDC silent re-auth (ADR-0001 §6). Full session security profile — ADR-0001 §6 (single source of truth). |
| Session fixation protection        | IdP               | Regenerate session-id on login and on MFA elevation                                                                                                                                                                        |
| PD in logs                         | Backend           | Email/phone masked in logs (`a***@example.com`, `+7***1234`); full values only in encrypted audit log with RF-resident KMS                                                                                                 |

> **Zitadel enumeration bypasses — operational note.** Zitadel's own "ignore unknown usernames" protection has been bypassed repeatedly (CVE-2024-41952 — flag not consistently honoured; CVE-2025-57770 — "select account" page; CVE-2026-23511 — password-reset endpoints + Login UI V2). The idempotent-response + rate-limit rows above are our backstop; in addition, **pin a Zitadel release patched against all three (≥ 4.9.1 / ≥ 3.4.6)** as part of the Definition of Done (ADR-0001 §7–§8).

---

## 6. OAuth social — phased rollout

| Phase           | Providers                        | Activation condition                                                                                                     |
| --------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| v1 (MVP launch) | —                                | No social                                                                                                                |
| v2              | VK ID, Yandex ID, Telegram Login | After the funnel is working and new doctor registration via social networks shows real conversion uplift                 |
| v3 mobile       | + Apple Sign-In                  | Only if we launch on the iOS App Store with social login (App Store policy forces SIWA when any social login is present) |
| On demand       | Max ID, Google                   | After product-validated use case                                                                                         |

> **Rationale for deferring social in v1:** v1 user base ≤200 users from the existing Doctor.School database (digest §0). All of them already have email accounts in Directual → magic-link/password covers 100%. The reviewer argues "VK will give +15-25% conversion in the medical audience" — this is valid for the **growth phase (v2)**, when mass-funnel acquisition is connected. In v1 social = pure cost without benefit. If the product team provides evidence (A/B on the landing pages of the `doctor-school-mobile-app-proto/` prototype showed uplift) — VK ID/Telegram may be forced into v1; the decision remains reopenable.

### 6.1. Implementation (Zitadel)

- VK ID, Yandex ID, Max — generic OAuth2 source via config + **PKCE mandatory** (RFC 7636).
- Telegram Login — NOT OAuth2, requires a custom Zitadel Action that validates the HMAC-signed callback from the Telegram Login Widget. ~50 lines of Go + webhook.
- Apple Sign-In — Apple Developer Program registration ($99/year) + Services ID + JWT signing key. Standard provider config in IdP.

### 6.2. Account linking — protection against pre-auth account takeover

**Critical vulnerability that must not be allowed:** an attacker registers a VK account with the victim's email (VK does not verify email on registration) → automatic link → attacker gains access to the victim's DS account. This is a CVSS 9.0+ pre-auth account takeover.

**Linking rules:**

| Scenario                                                                                           | Action                                                                                                                |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Social account email **not verified** by the provider                                              | No auto-link. Create a new DS account OR offer manual link via an owned channel (see below).                          |
| Social email verified by provider **AND** a DS account with the same verified email already exists | Auto-link permitted.                                                                                                  |
| Social email verified, but the DS account with that email is **unverified**                        | No auto-link. Request email verification from the DS account (send magic-link). After successful verification — link. |
| Phone match (Telegram Login returns phone)                                                         | Same: both phones must be verified.                                                                                   |
| Match on both sides (verified-verified)                                                            | Link is automatic, audit event `account_linked_auto`.                                                                 |
| Manual link (from the "Linked accounts" cabinet)                                                   | User is already logged in to DS, adds social. Confirm via email/SMS on the current channel before linking.            |

**Additionally:** Audit event `account_link_attempt_rejected` is written in rejected scenarios to detect targeted attacks on specific users.

In UI: "Linked accounts" cabinet — add/remove provider.

---

## 7. Sessions and tokens

OAuth 2.0 BCP (RFC 9700) reference implementation.

### 7.1. Parameters

| Parameter                          | Value                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Access token                       | JWT, RS256/ES256, TTL **15 min**                                                                                                                                                                                                                                                                                                                       |
| Access claims                      | `sub`, `roles[]`, `mfa`, `sid`, `iat`, `exp`, `jti`                                                                                                                                                                                                                                                                                                    |
| Refresh token                      | Opaque, rotating single-use                                                                                                                                                                                                                                                                                                                            |
| Refresh TTL (web)                  | 30d                                                                                                                                                                                                                                                                                                                                                    |
| Refresh TTL (mobile)               | **14d** (reduced from 90d per reviewer note — sender-constrained refresh without proof-of-possession at 90d gives too long a compromise window)                                                                                                                                                                                                        |
| Refresh sender-constraint (mobile) | Device-id binding: at refresh issuance, `device_fingerprint` is stored (combination of installation_id, platform, model); at exchange, match is verified. Mismatch → reject + alert. **DPoP (RFC 9449)** considered for v2 as stricter protection.                                                                                                     |
| Mobile storage                     | iOS Keychain / Android Keystore                                                                                                                                                                                                                                                                                                                        |
| Web storage                        | HttpOnly + Secure + SameSite=Lax cookie with `__Host-` prefix. **Not localStorage.** **Every app (portal, admin, promo, docs, cms) holds its own host-only cookie**; cross-app continuity via OIDC silent re-auth (see §7.5). Full security profile — ADR-0001 §6 (single source of truth).                                                            |
| Session store                      | Redis, server-side, bound to refresh token                                                                                                                                                                                                                                                                                                             |
| Force-logout                       | DELETE session record → invalidates refresh; access expires within 15 min. For admin accounts critical endpoints call introspection (see §7.2).                                                                                                                                                                                                        |
| List active sessions               | IdP admin API                                                                                                                                                                                                                                                                                                                                          |
| MFA-elevated session               | Separate claim `acr=mfa-fresh`, TTL 30 min (reduced from 1h); admin actions require fresh MFA. Forward reference: the formal step-up authentication contract (when re-MFA is required, which endpoints, TTL) — **ADR-0001 §10 (step-up authentication)** + the `step_up` matrix flag in `2026-05-18-ds-platform-endpoint-authorization-matrix-design`. |
| PKCE for public clients            | **Mandatory** for mobile + SPA web frontends (RFC 7636)                                                                                                                                                                                                                                                                                                |
| JWKS caching                       | Backend caches JWKS with TTL 10 min; on rotation — **graceful overlap window** 24h (old and new keys are both valid)                                                                                                                                                                                                                                   |

### 7.2. JWT vs introspection — explicit trade-off

Reviewer note: "JWT 15min + introspection — internally contradictory". Accepted and explicitly justified:

- **Fast path (≥99% of requests):** JWT signature validation locally via JWKS cache. ~0ms latency, stateless. Applied to all read-flow doctor/expert + most write operations.
- **High-stakes path (<1% of requests):** IdP `/introspect` (RFC 7662) is called for:
- Payment endpoints (create order, withdraw AU, refund).
- Role-change / permission-grant operations.
- Admin / `platform_admin` mutations.
- User-PD export / right-to-erasure operations.
- Any operations where a compromised access token within the 15-min window can cause material damage.
- **Local introspection cache** — 60 seconds per `jti`. Reduces latency of repeated checks without significant security delta (a compromised token lives ≤60s in cache after force-logout).
- **Trade-off:** stateless for scale + statefulness where it materially matters. Not a "contradiction", but an explicit two-tier model.

### 7.3. Audit log of auth events (mandatory)

3-year retention (PRD §31). Events that **must** be written to `auth_audit` (the auth-domain projection of the append-only ledger). The **canonical event taxonomy is owned by `identity-auth-rbac-design §7.3`** — the two-level `<class>.<event>` scheme, plus the `auth.step_up.*` and `auth.sms.*` classes not listed here; this table mirrors it for the events mandatory at v1, with the canonical wire id in each row:

| Event (`<class>.<event>`)            | Fields                                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------- |
| `auth.login.success`                 | user_id, method (password/magic-link/SMS-OTP/social/biometric), ip, user_agent, geo, ts |
| `auth.login.failure`                 | identifier_hash, reason (wrong_password, no_user, lock, captcha_failed), ip, ts         |
| `auth.account.verified`              | user_id, channel (email/sms), ts                                                        |
| `auth.mfa.enrolled`                  | user_id, method (totp/sms), ts                                                          |
| `auth.mfa.used`                      | user_id, method, ts                                                                     |
| `auth.mfa.failure`                   | user_id, method, reason, ts                                                             |
| `auth.mfa.reset`                     | user_id, by_admin (uuid or null), ts                                                    |
| `auth.password.changed`              | user_id, by_self/by_admin, ts                                                           |
| `auth.password.reset_requested`      | user_id (or null), identifier_hash, ip, ts                                              |
| `auth.magic_link.sent`               | user_id, channel (email), ts                                                            |
| `auth.magic_link.used`               | user_id, ts                                                                             |
| `auth.session.created`               | user_id, sid, device_id, ts                                                             |
| `auth.session.terminated`            | user_id, sid, reason (logout/force/expiry/theft_detected), ts                           |
| `auth.token.rotated`                 | user_id, sid, ts                                                                        |
| `auth.token.theft_detected`          | user_id, sid, ts                                                                        |
| `auth.account_link.linked_auto`      | user_id, provider, ts                                                                   |
| `auth.account_link.attempt_rejected` | user_id, provider, reason, ts                                                           |
| `auth.account_link.unlinked`         | user_id, provider, by_self/by_admin, ts                                                 |
| `auth.role.granted`                  | user_id, role, by_admin, ts                                                             |
| `auth.role.revoked`                  | user_id, role, by_admin, ts                                                             |
| `auth.lockout.triggered`             | user_id, reason, ts                                                                     |
| `auth.lockout.released`              | user_id, by_admin/auto, ts                                                              |
| `auth.sync.drift_detected`           | user_id, diff, ts                                                                       |
| `auth.erasure.executed`              | user_id, scope, ts                                                                      |

Storage — append-only Postgres table or event-store (if IdP = Zitadel — natively event-sourced). Read access — only `platform_admin` + DPO; deletion is not permitted even for them (enforced at the DB level).

### 7.4. Open question (Phase 0 implementation)

Where the session store lives — inside the IdP or shared backend Redis. Default — inside the IdP. The decision depends on the headless API ergonomics of both candidates (determined during Phase 0 implementation). This is **not a design blocker** — the force-logout guarantee is the same in both cases (15-min window for access + introspection for high-stakes).

### 7.5. Cross-app SSO via OIDC silent re-auth (DSO-63 #2)

Cross-app login continuity between portal, admin, promo, docs, cms is **not a shared cookie on `.doctor.school`** (a shared cookie spanning trust-zone boundaries was rejected per ADR-0001 §6 — same-origin XSS or subdomain takeover would compromise the admin session), but **OIDC silent re-auth at the IdP**.

**Flow for a user already logged into portal, opening admin:**

1. Browser → `admin.doctor.school`.
2. Admin Next.js middleware checks the local host-only cookie `__Host-ds_admin_session`. Missing / expired.
3. Middleware issues `302 → auth.doctor.school/oauth/authorize?client_id=admin&prompt=none&redirect_uri=https://admin.doctor.school/auth/callback&state=...`.
4. IdP checks its own host-only session (cookie on `auth.doctor.school`). Session active.
5. IdP returns an `authorization_code` → redirect back to `admin.doctor.school/auth/callback?code=...`.
6. Admin server exchanges the code for an app-specific token and sets its own `__Host-ds_admin_session` cookie.
7. The user sees the admin UI. **Visible delay ≤300ms**, no explicit login screen.

**If there is no IdP session** (user not logged in anywhere): IdP returns `error=login_required` → admin Next.js redirects to the standard login flow (auth.doctor.school/login).

**IdP requirements:**

- `prompt=none` supported (silent re-auth).
- Multiple `redirect_uri` allowed per OAuth client, **or** multiple OAuth clients (one per subdomain). Multiple clients cleaner for blast-radius isolation.
- IdP session cookie — host-only (no `Domain=`), `SameSite=Lax` or `Strict`.

Zitadel supports these natively (`prompt=none` silent re-auth, multiple redirect_uri/clients, host-only session cookie).

**Logout:**

- App-level logout: DELETE cookie on one subdomain → user is logged out only on that app, others continue via silent re-auth.
- Global logout: IdP endpoint `/oidc/logout` invalidates the IdP session → silent re-auth on other apps returns `login_required` → they log out locally.
- "Logout from all devices" — IdP admin API revoke all sessions for user.

---

## 8. Identity migration from Directual

### 8.1. Phases

```
Phase 0: Discovery (2–3 weeks — revised)
  - Direct API call to Directual: actual count of App users (closes open question §9.10/1 inventory)
  - Schema dump of user objects: password hash format, fields, role structure
  - Inventory of roles and manager relations (manager1_user → backend hierarchy table)
  - Legal review: does the current 152-FZ consent cover migration to new infrastructure and a new operator?
    If not — re-acquisition plan (see §8.4).
  - Artifact: discovery-report in outputs/

Phase 1: Test migration (1–2 weeks)
  - Dry-run import of 100 users into staging IdP
  - Password verification check on bcrypt-hash in transit (if compatible)
  - Mapping legacy admin-users → temporary `legacy_admin` group
  - MFA bootstrap flow for legacy admin (see §8.5)
  - Contract tests for login flow

Phase 2: Bulk migration (cutover weekend)
  - Production Directual → read-only freeze (including manager_hierarchy — freeze structural data)
  - Bulk import of all users into production IdP:
    - Hash-compatible → as-is (zero friction)
    - Hash-incompatible → flag `pending_migration`, no password
  - Product roles (active v1: `doctor`, `doctor_guest`, `guest`) → IdP groups
  - Legacy admin-users → temporary `legacy_admin` group with read-only permissions
  - Manager hierarchy (`manager1_user`) → backend table `manager_hierarchy`
  - Auth audit log freeze + new stream into new audit log
  - Switch traffic to new platform

Phase 3: Soft migration window (90 days — revised from 30)
  - Hash-compatible — normal login
  - Hash-incompatible — three waves of email campaign: day 0, day 14, day 45
  - Tracking: reactivated vs dormant
  - Consent re-acquisition (if required by Phase 0 legal review) — on first doctor login,
    updated consent is shown; refusal → block with recovery-flow

Phase 4: Sunset (after 95% or 120 days — revised from 60)
  - Directual full shutdown
  - Dormant users (~30–50% of base — realistic, not optimistic, target) remain with `dormant` flag,
    recovery via magic-link forever
  - Bubble + Directual + sync cronTasks shut down
```

### 8.2. Hash-format compatibility

| Hash in Directual             | Zitadel                               |
| ----------------------------- | ------------------------------------- |
| bcrypt                        | ✅ Native                             |
| argon2                        | ✅ Native                             |
| PBKDF2                        | ✅ Native                             |
| scrypt                        | ⚠️ Migration plugin                   |
| SHA-256 without salt / custom | ❌ — "magic-link reset" option forced |

Share of "zero-friction" migration = determined in Phase 0. **Reviewer note accepted: the optimistic scenario of 90%+ bcrypt is not guaranteed. The pessimistic scenario (everything via magic-link reset) gives a reactivation rate of ~20–40% in the first 30-day window, which is why the base plan is a 90-day window + three email waves.**

### 8.3. What does NOT migrate

- **Directual audit log** → archived with 3-year retention, new events go into the new audit log; continuity is ensured by reference to the actor's UUID.
- **In-flight magic-link tokens** → invalidated at cutover moment; user must request a new one.
- **Bubble shadow `id + role + is_speaker`** → does not migrate (this is derivative of Directual identity).
- **Bubble `Log the user in` race condition** (inventory §F1) — not reproduced as a bug-parity issue; in the new system the headless API has atomic session-creation.

### 8.4. Federal Law 152-FZ compliance during migration

- All scripts are executed **in RF** (Timeweb VPS or locally in RF).
- Directual API → new IdP — both endpoints are RF-hosted.
- During the migration window, PD is present in both systems; encryption at rest is mandatory in both places.
- Migration scripts are logged in a separate audit trail with 3-year retention (part of the new ledger).
- **Consent re-acquisition** (Phase 0 legal review closes this): if the doctor's existing consent does not cover migration to new infrastructure/a new operator, the updated consent is displayed at first login after cutover. Consent refusal → user status `consent_revoked`, access closed until resolved via support.
- **Ledger balances** (`dsCoinsTransaction`, `NmoPointsTrasaction`, `Crypto*`) — migrate on a separate track (DSO-30), not identity. For the identity layer they are read-only metadata for the user, and do not block migration.

### 8.5. MFA bootstrap for legacy admin

**Bootstrap problem (reviewer note):** legacy admin-users in Directual logged in with email+password, no MFA. In the new system the `legacy_admin` group requires MFA. **How do they log in for the first time to complete enrollment?**

Flow:

1. Cutover → admin receives an email with a magic-link + instructions.
2. Magic-link grants a **single-use elevated session with TTL 1 hour**, specifically for MFA enrollment. This flow is marked `mfa_pending_enrollment=true`.
3. Within this session the admin must enroll TOTP (or SMS for `moderator`/`support`); the UI does not allow continuing without enrollment.
4. After enrollment — the session is terminated, re-login with MFA is required.
5. If admin did not complete enrollment within the window (e.g., 7 days) — status → `mfa_enrollment_required`, manual unlock via support / Tech Lead is required.

This is a closed flow with audit events `mfa_enrolled` + `lockout_triggered (mfa_enrollment_expired)`.

---

## 9. IdP — Zitadel (closed 2026-05-25, DSP-209)

**Decision:** IdP for DS Platform is **Zitadel** (closed 2026-05-25, DSP-209). See ADR-0001 §8 for decision body, AGPL discipline and known trade-offs.

---

## 10. Risks and open questions

### 10.1. Risks

| Risk                                                             | Impact                                              | Mitigation                                                                         |
| ---------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Directual password hash format is custom / SHA-256               | Forced reset, reactivation 20–40% in 30 days        | 90-day window + three email waves; explicit expectation of 30–50% dormant          |
| Telegram Login Widget HMAC custom — bug in implementation        | Telegram auth does not work / security hole         | Phase 0 implementation includes Telegram flow + reference implementations          |
| Apple Developer Program registration for an RF legal entity      | Blocks v3 mobile SIWA                               | Parallel legal track                                                               |
| RF SMS provider rate-limited / failure                           | Phone-OTP login unavailable                         | Failover 2 SMS providers (digest §2) + global circuit-breaker (§5.5)               |
| Actual doctor count in Directual turns out to be 65k+            | Migration logistics larger                          | Phase 0 discovery gives exact count                                                |
| Webhook IdP → backend missed → audit-actor mismatch              | Compliance incident                                 | Reconciliation cron §3.2 + audit `idp_sync_drift_detected`                         |
| SMS toll-fraud attack (compromised IP × mass numbers)            | Budget losses up to tens of thousands ₽/hour        | Multi-layer rate limit + global budget circuit-breaker (§5.5)                      |
| Pre-auth account takeover via OAuth email-claim                  | CVSS 9.0+, hijacking 10k+ accounts                  | §6.2 guards (verified-verified requirement), audit `account_link_attempt_rejected` |
| MFA bootstrap for legacy admin stuck (7 days without enrollment) | Broken cutover for critical operators               | §8.5 manual unlock flow via support / Tech Lead                                    |
| Consent re-acquisition refusals at first login                   | Loss of access for compliant pool                   | Legal review in Phase 0; UI-flow with recovery option                              |
| Yandex SmartCaptcha rate limit / downtime                        | Login without bot-protection                        | Fallback: temporary login endpoint block when captcha is unavailable + alert       |
| Sanctions tightening → Zitadel commercial support revoked        | Self-host remains (OSS), but without vendor support | Recorded in ADR as known risk; fork-ready strategy                                 |

### 10.2. Open questions (closed outside DSO-25)

1. Final IdP choice — closed in §9 (Zitadel; ADR-0001 §8, DSP-209).
2. Specific RF SMS provider + failover scheme — **decided: SMS-Aero primary** (smsaero.ru Gate API v2), SMSC.ru / SMS.ru failover; contract in identity-auth-rbac-design §5 / engineering-readiness §5.bis. (Plane DSO-26/57/58 cross-tracker only.)
3. Session store: inside IdP or shared backend Redis — Phase 0 implementation.
4. Policy engine for backend RBAC (Cerbos / OPA / OpenFGA / SQL) — DSO-26.
5. Actual count + hash format in Directual — Phase 0 discovery.
6. Apple Developer Program registration for a legal entity — parallel legal track.
7. **Target admin/operational role model for DS Platform** — product task (DSO-26 + ops), separate from the identity layer.
8. Bot-protection provider in RF — default Yandex SmartCaptcha, alternatives (ru-cap, self-hosted invisible CAPTCHA) — DSO-26.

### 10.3. Deferred gaps (not a blocker for DSO-25, but mandatory before v2)

| Gap                                                                                               | Owner                   | When                                                      |
| ------------------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------- |
| Consent management subsystem (`consent_history`, policy versioning)                               | DSO-26                  | Before v2                                                 |
| Right-to-erasure flow (PRD §31, digest §3.3)                                                      | DSO-26                  | Before v2                                                 |
| Federal Law 187-FZ (CII) compliance analysis                                                      | Compliance track        | Before v2 when significant PD volume is reached           |
| FSTEC-17/21 protection classes + certified cryptography (GOST 28147 / Grasshopper) for PD at rest | Compliance track        | Upon Roszdravnadzor integration (digest §2/integration 1) |
| HIBP Pwned Passwords k-anonymity check on registration                                            | DSO-26                  | v2                                                        |
| Anomaly detection / impossible travel                                                             | DSO-26 + DSO-30 (AI/ML) | v3                                                        |
| OWASP ASVS Level 2/3 audit + MASVS Level 2 for mobile                                             | External pen-test       | Before v2 release (PRD §31.4)                             |
| DPoP (RFC 9449) / sender-constrained refresh tokens for mobile                                    | DSO-26                  | v2 (v1 — device-id binding)                               |
| WebAuthn / Passkeys                                                                               | DSO-26                  | v2                                                        |

---

## 11. Artifacts and relations

| Artifact           | Location                                                                               |
| ------------------ | -------------------------------------------------------------------------------------- |
| This design spec   | `apps/docs/content/adr/0001-identity-provider-shortlist-design-en.md`                  |
| ADR                | `apps/docs/content/adr/0001-identity-provider-shortlist-en.md`                         |
| Plane DSO-25       | `0a8f2276-956f-4f4e-9134-2f197ff4bab8`, project `6ff068e6-c73a-4a5e-923d-90b7dae1daac` |
| Inputs (digest v2) | `outputs/2026-05-12-ds-platform-tech-requirements-digest.md`                           |
| Inputs (inventory) | `outputs/2026-05-12-ds-platform-inventory.md`                                          |
| Brainstorm prep    | `outputs/2026-05-12-tech-stack-brainstorm-prep.md`                                     |

### 11.1. What is unblocked

- **DSO-26 (backend core)** — now knows: RBAC layering hybrid; backend owns policy engine + object-level + domain audit log; backend mirror users-table with outbox/reconcile (§3.2); auth integration via JWT fast-path + introspection for high-stakes (§7.2); list of mandatory audit events (§7.3); security baseline (§5.5) implemented in API gateway + backend; deferred gaps (§10.3) — consent management, right-to-erasure, HIBP, pen-test gates.
- **DSO-28 (frontend)** — now knows: all auth forms are ours, headless pattern (§4.1); social — IdP-managed sources with PKCE; auth subdomain `auth.doctor.school`; cookie security profile (`__Host-` + SameSite=Lax + HttpOnly).
- **DSO-29 (mobile)** — now knows: phone-OTP primary + biometric unlock + secure token storage; refresh 14d with device-id binding; OAuth flow via ASWebAuthenticationSession/Custom Tabs with PKCE; DPoP — in v2.
