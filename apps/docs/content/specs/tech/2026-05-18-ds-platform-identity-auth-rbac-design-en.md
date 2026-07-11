---
title: "DS Platform — Identity, Auth & RBAC Mechanisms (Design)"
description: "Normative home for the auth mechanisms forward-referenced across the corpus: the SMS provider circuit-breaker (§5), the request-path guard pipeline (§6), the acr=mfa-fresh elevated claim + step-up mechanism (§7.1/§7.2), the canonical auth audit-event taxonomy (§7.3), and the CSRF double-submit middleware (§7.5). Closes the dangling references from ADR-0001 §10, ADR-0004 (CSRF), and engineering-readiness §5.bis; pins the auth_audit table name deferred by endpoint-authorization-matrix-design §8."
date: 2026-05-18
status: Draft
authors: Tech Lead (with AI agent, authored 2026-06-03)
---

# DS Platform — Identity, Auth & RBAC Mechanisms — Design

**Date:** 2026-05-18 (authored 2026-06-03 under GitHub Issue #106)
**Status:** Draft
**Type:** Platform-level design spec (cross-cutting identity/auth mechanisms). Referenced by ADR-0001, ADR-0004, the engineering-readiness spec, and `endpoint-authorization-matrix-design`.
**Applies (not inherits):** ADR-0001 (Identity & authorization), ADR-0002 (NestJS + Fastify + OpenAPI — RbacModule, `AuditModule` / explicit auth-audit emission §4.8), ADR-0003 (data layer — append-only ledger), ADR-0004 (frontend stack — CSRF), ADR-0009 (PD lifecycle / 152-FZ — audit-class registration, retention), engineering-readiness spec (§5.bis comms providers).

---

## 1. Context and problem

Several accepted documents forward-reference a design spec **`identity-auth-rbac-design`** as the normative home for specific auth _mechanisms_, but the spec did not exist — the references dangled. The mechanisms are decided (in ADR-0001, ADR-0004, and the engineering-readiness spec); what was missing is a single place that pins each contract so the citing docs resolve to one source instead of re-deriving it.

| #   | Pointer                                     | What it expects from this spec                                                                                                                  |
| --- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **ADR-0001 §10**                            | The step-up _mechanism_: `StepUpGuard`, the OIDC `prompt=login` + `acr_values` trigger, the `401 { error:'step_up_required', … }` contract.     |
| 2   | **ADR-0001 §10 → §7.1**                     | The `acr=mfa-fresh` claim semantics, the `mfa_fresh_at` timestamp, the 30-min fresh-MFA TTL, the "elevated claim, not a separate session" rule. |
| 3   | **ADR-0001 §10 → §7.3**                     | The canonical list of mandatory auth audit events (including the `auth.step_up.*` class).                                                       |
| 4   | **ADR-0004 design (CSRF) → §7.5**           | The double-submit CSRF middleware contract (cookie + header) on state-changing endpoints.                                                       |
| 5   | **engineering-readiness §5.bis → §5**       | The SMS provider circuit-breaker / failover pattern (toll-fraud budget guard, EARS-14).                                                         |
| 6   | **endpoint-authorization-matrix-design §8** | The deferred `auth_audit` vs `auth_audit_events` table-name decision (this spec is named as its home).                                          |

Until this spec landed, those pointers resolved to nothing, and `endpoint-authorization-matrix-design §8` carried two open items waiting on it.

### 1.1 What this spec does — and does NOT — do

This is a **consolidation** spec. It is the normative home for the six contracts above and nothing more. It deliberately does **not** re-document what other documents already own, because a second copy of a contract drifts from the first (the failure mode that #104/#105 spent effort _removing_ from the corpus):

- **Role / group model** → ADR-0001 design §2.2 (IdP groups, mirrored to `users.role`). Referenced in §3, not redefined.
- **Authorization enforcement** (guards, `IPolicyEngine`, object-level policy) → ADR-0002 §3.2 (`RbacModule`) and `endpoint-authorization-matrix-design` (the `@Authz` SSOT, the completeness gate, the per-endpoint `step_up` flag). This spec owns the step-up _mechanism_; the matrix owns the per-endpoint _flag_.
- **Session & token parameters** (TTLs, `__Host-` cookies, refresh rotation, JWKS) → ADR-0001 §6 / design §7.1. Referenced in §4, not restated.
- **Authentication flows** (register/login/OTP/reset) → `003-user-authentication` design. This spec specifies the cross-cutting guards those flows pass through, not the flows.

The line is simple: **if another doc already pins it, this spec links to it; if a forward reference points _here_, this spec pins it.**

---

## 2. Placement in the auth stack

The mechanisms this spec owns are **cross-cutting guards and contracts** that sit around the per-feature flows, not inside them. They attach at three points:

```
   pre-auth (public)             authenticated request              audited outcome
 ┌───────────────────┐        ┌──────────────────────────┐       ┌──────────────────┐
 │ SMS budget breaker│        │ CSRF double-submit (§7.5) │       │ auth_audit (§7.3)│
 │ (§5) on OTP-send  │        │ AuthzGuard  (matrix §4)   │       │  projection of   │
 │ toll-fraud guard  │        │ StepUpGuard (§7.2)        │       │  audit_ledger    │
 └───────────────────┘        │   ↳ acr=mfa-fresh (§7.1)  │       └──────────────────┘
                              └──────────────────────────┘
                              full ordered pipeline → §6
```

Each is engine-neutral and additive: a feature vertical inherits these guards by classification (`@Authz` metadata, cookie-borne auth, audit stakes) rather than re-implementing them.

---

## 3. Identity & RBAC model — references

This spec does not own the identity or RBAC model; it records where each part lives so the "identity/RBAC" surface is navigable from one place:

- **IdP group model (role vocabulary SSOT):** ADR-0001 design §2.2 — `guest`, `doctor_guest`, `doctor`, `legacy_admin`, `platform_admin`, then `expert` / `moderator` / `support` / `investor` / `clinic_admin` as features activate. The backend `users.role` (`packages/db`) is a **mirror**, not the source.
- **Object-level relations & fine-grained permissions** (not IdP claims): ADR-0001 design §2.3 — evaluated by the policy engine from (role, resource, context).
- **Enforcement primitives:** ADR-0002 §3.2 `RbacModule` (global guards + `IPolicyEngine`), surfaced through the single `@Authz` decorator (`endpoint-authorization-matrix-design §4`). The concrete policy engine (Cerbos / OPA / OpenFGA / SQL) is deferred to DSO-27 and is not a contract of this spec.

---

## 4. Session & token model — references

The base session and token parameters are owned by **ADR-0001 §6 / design §7.1** and are not restated here. The two facts this spec _depends on_:

- **Access token:** JWT, RS256/ES256, **15-min** TTL; claims `sub`, `roles[]`, `mfa`, `sid`, `iat`, `exp`, `jti` (ADR-0001 design §7.1).
- **Base session:** opaque rotating refresh token, **30d web / 14d mobile**, server-side in Redis; web carries a `__Host-`-prefixed per-app `HttpOnly + Secure + SameSite=Lax` cookie (ADR-0001 §6). Cross-app continuity is OIDC silent re-auth (`prompt=none`), **not** a shared cookie (ADR-0001 design §7.5).

The elevated MFA-fresh state (§7.1) is layered **on top of** this base session as an additional claim — it never replaces or extends it.

---

## 5. SMS provider circuit-breaker & failover

Resolves engineering-readiness §5.bis (SMS row: "Circuit-breaker pattern in identity-auth-rbac-design §5"); links 003 EARS-14 (SMS toll-fraud guard) and 003-design §10 (the budget-breaker error path).

### 5.1 What this spec owns

The **four-layer toll-fraud rate-limit** is owned by ADR-0001 §7 (narrative) / design §5.5 (security baseline) and is referenced, not redefined: per-phone **3/hour**, per-IP **10/hour**, per-ASN **100/hour**, plus a **global daily budget of ≤2000 SMS/day** at launch. This spec owns the **circuit-breaker mechanism** that enforces the global budget and the **provider failover** that sits in front of it.

### 5.2 Two distinct breakers

The SMS-send service path composes two independent breakers before any SMS leaves the platform:

| Breaker                     | Trip condition                                                                                      | Open behavior                                                                                      | Reset                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Budget breaker**          | Global daily counter ≥ 2000 (across all providers)                                                  | OPEN for the remainder of the UTC day; SMS-OTP send is refused (see §5.4) and an alert is fired    | Rolls automatically at UTC midnight (counter key expires)  |
| **Provider-health breaker** | Consecutive provider errors/timeouts over a short window (standard breaker; e.g. ≥5 failures / 30s) | OPEN with a short cooldown; the failover provider is tried (§5.3); HALF-OPEN probe on cooldown end | HALF-OPEN success → CLOSED; HALF-OPEN failure → OPEN again |

The **budget breaker is global and provider-agnostic** — failing over to a second provider does not reset it; the budget is the platform's total toll-fraud exposure, not a per-provider quota.

### 5.3 Failover (provider chain)

The primary → secondary SMS provider chain is the engineering-readiness §5.bis registry: the **primary is SMS-Aero** (smsaero.ru Gate API v2 — HTTP Basic `email:api_key`, `POST https://gate.smsaero.ru/v2/sms/send`, params `number`/`text`/`sign`, default sign `SMS Aero`; env `SMSAERO_EMAIL`/`SMSAERO_API_KEY`/`SMSAERO_SIGN`), with SMSC.ru / SMS.ru as the interchangeable RF fallback (all RF, all 152-FZ-compliant). Failover is driven by the **provider-health breaker**: when the primary's breaker is OPEN, sends route to the secondary; the budget breaker (§5.2) still gates the combined volume. The provider is now **decided** (SMS-Aero — supersedes the prior "implementation moment"; Plane DSO-26/57/58 are cross-tracker references only). **Dev-stand note:** the local dev-stand never reaches SMS-Aero — Zitadel's generic HTTP SMS provider posts to a local `sms-sink` catcher (the SMS analogue of Mailpit; `infra/dev-stand`), so the SMS-OTP login round-trip (003 EARS-7) is proven against real Zitadel without a real send.

### 5.4 State store and OPEN behavior

- **Counter store:** Redis, key `sms:budget:<UTC-date>`, atomic `INCR` on each _accepted_ send, TTL ~48h (covers the day plus a margin for skew). The check-then-increment is atomic so concurrent sends cannot overshoot the budget.
- **On budget-breaker OPEN:** the SMS-OTP request endpoint returns the **generic, timing-equalized "try later" response** (003-design §10, EARS-16) — it MUST NOT reveal that the cap was hit, to avoid leaking platform state. The **email-OTP path (EARS-6) remains available** as an alternative passwordless channel.
- **Alerting:** breaker OPEN (either kind) emits an alert through the platform observability stack (GlitchTip / Prometheus, per the engineering-readiness spec) so an operator can distinguish a legitimate spike from an attack and lift or keep the cap.

### 5.5 Off-the-shelf

The **provider-health breaker** is a standard circuit-breaker — use an existing implementation (the `opossum` pattern) rather than a bespoke state machine. The **budget breaker** is a single atomic Redis counter, not a library; it is intentionally simple because it must be correct under concurrency and survive a process restart (Redis-backed, not in-memory).

---

## 6. Request-path guard pipeline

ADR-0001 §10 forward-references a "backend-core middleware checklist" owned by `backend-core-design`. This section pins the **auth-relevant ordering** of the cross-cutting guards so the contracts in §5/§7 have a defined relative position; the full middleware chain (logging, body limits, etc.) is owned by `backend-core-design` and is not duplicated here.

For an authenticated, state-changing request the auth guards run in this order:

1. **Edge rate-limit / WAF** — per-user/IP/ASN limits (ADR-0001 §7); may live on the WAF or the gateway (engineering-readiness §5.bis). Orthogonal to authz.
2. **Bot protection** (Yandex SmartCaptcha) — on register / reset / post-failure login only (003-design §10.1, EARS-17).
3. **CSRF double-submit** (§7.5) — only for cookie-borne, state-changing requests; skipped for token-auth (mobile) and HMAC webhooks.
4. **Authentication** — JWT fast-path via JWKS cache for ≥99% of requests; IdP `/introspect` for the <1% high-stakes set (ADR-0001 design §7.2). Populates the session subject.
5. **`AuthzGuard`** (`endpoint-authorization-matrix-design §4`) — fail-closed on missing `@Authz`; checks `required_roles`; delegates an object-level `auth_check: policy` (`object_attrs` present) to `IPolicyEngine`, while a resource-scoped `policy` row's domain rule is evaluated in-service by the classified handler (matrix-design §3).
6. **`StepUpGuard`** (§7.2) — only on routes flagged `@Authz({ step_up: true })`; verifies the fresh-MFA claim (§7.1).
7. **Handler.**
8. **Terminal audit emission** (§7.3) — the auth/security command emits its terminal `auth_audit` row **explicitly**, at the command site (the `AuthAuditLog` port; `auth/session/auth-audit.*`), not via a generic interceptor: these events are heterogeneous (a `login.failure` has no subject and a masked identifier; a `lockout` fires once on the tripping transition; an `otp.sent` has no subject yet) and cannot be built uniformly from the response. The `@Authz` `audit` class records that the route owes a row; emission completeness over the `high-stakes` set is enforced by a CI guard. The `@Authz({ audit })`-driven `AuditInterceptor` (ADR-0002 §4.8) applies to uniform-subject resource routes elsewhere, not to this domain.

For the **public SMS-OTP-send** endpoint the chain is shorter (no authn/authz — it is `access: public`), and the **SMS budget breaker (§5)** sits inside the send-service path after the toll-fraud rate-limit (step 1) and before the provider call.

A CI invariant (owned by `backend-core-design`, per ADR-0001 §10) asserts that `StepUpGuard` is present on every endpoint flagged `step_up: true`; this spec defines the guard's behavior, the CI rule enforces its presence.

---

## 7. Session & auth-flow security contracts

### 7.1 The `acr=mfa-fresh` elevated claim

Resolves ADR-0001 §10's "see identity-auth-rbac-design §7.1" and aligns with ADR-0001 design §7.1 ("MFA-elevated session").

- **Claim:** after a successful step-up re-authentication the IdP (Zitadel) issues an access token carrying `acr=urn:ds:acr:mfa-fresh` and a custom `mfa_fresh_at` claim (epoch seconds of the re-auth). `acr` is the OIDC-standard authentication-context-class; `mfa_fresh_at` is a custom claim emitted by a Zitadel Action.
- **Distinct from the base `mfa` claim:** the `mfa` claim (ADR-0001 design §7.1) records that MFA was used _at login_; `acr=mfa-fresh` records that the subject _recently re-verified_. They are orthogonal — a long-lived session can be `mfa: true` yet not fresh.
- **Fresh TTL = 30 minutes** (ADR-0001 §10 / design §7.1). The elevated state is considered present iff `acr == urn:ds:acr:mfa-fresh` **and** `now − mfa_fresh_at ≤ 30 min`.
- **It is a claim, not a session** (ADR-0001 §10, normative): the base session (refresh 30d web / 14d mobile) exists independently and is unaffected. The access-token TTL (15 min) and the elevated window (30 min) are independent clocks; **refreshing an access token does NOT re-mint `acr=mfa-fresh`** — once the 30-min window lapses, the next high-risk action triggers step-up again. Step-up never extends the base-session expiry.

### 7.2 Step-up mechanism

Resolves ADR-0001 §10's step-up _mechanism_ reference. The per-endpoint `step_up` flag is owned by `endpoint-authorization-matrix-design §3`; this section owns how the flag is _enforced_.

- **`StepUpGuard`** (NestJS guard, position 6 in §6): runs on every route carrying `@Authz({ step_up: true })`, after authentication. It verifies the §7.1 condition (`acr=mfa-fresh ∧ mfa_fresh_at ≥ now − 30 min`). On success the request proceeds; on failure it returns the contract below.
- **Trigger:** OIDC `prompt=login` + `acr_values=urn:ds:acr:mfa-fresh` at the IdP authorize endpoint (supported by Zitadel, ADR-0001 §8). This forces fresh re-authentication regardless of the existing IdP session.
- **Failure contract (normative):**

  ```http
  HTTP/1.1 401 Unauthorized
  Content-Type: application/json

  {
    "error": "step_up_required",
    "step_up_url": "<IdP authorize URL: prompt=login + acr_values=urn:ds:acr:mfa-fresh + redirect_uri + state>"
  }
  ```

  Frontend (portal / admin / cms) and mobile **MUST** handle this response — intercept, redirect to `step_up_url` preserving context via `state`, exchange the returned code for a refreshed access token, and retry the original request. The UX detail is owned by ADR-0001 §10 (intercept/redirect/retry, `ASWebAuthenticationSession` / Custom Tabs on mobile) and is not duplicated here; this spec pins only the wire contract.

- **High-stakes validation:** because step-up endpoints are by definition high-risk, their authentication step uses IdP `/introspect` (the <1% path, ADR-0001 design §7.2), so a token force-logged-out within its 15-min life is rejected before `StepUpGuard` even evaluates freshness. See §7.4.

### 7.3 Canonical auth audit-event taxonomy

Resolves ADR-0001 §10's "full list of auth audit events — identity-auth-rbac-design §7.3" and the §10 `auth.step_up.*` audit class. This is the canonical superset; ADR-0001 design §7.3 mirrors the v1-mandatory subset of it (see the corpus-alignment note below).

**Two-level model.** Every auditable auth event has an **audit class** (a dotted namespace, the unit registered per ADR-0009 §2.4) and an **event** within it. The **canonical wire identifier is `<class>.<event>`**, where `<event>` is the outcome segment. This aligns with the form ADR-0001 §10 already publishes (`auth.step_up.{requested,succeeded,failed}`) and extends it across the whole list. ADR-0001 design §7.3's flat names (`login_success`, `mfa_used`, …) map 1:1 onto these ids (`auth.login.success`, `auth.mfa.used`) — the same events, normalized spelling.

| Class               | Events (wire id `<class>.<event>`)            | Key fields                                                               |
| ------------------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| `auth.login`        | `success`, `failure`                          | user_id / identifier_hash, method, reason, ip, user_agent, geo, ts       |
| `auth.account`      | `verified`                                    | user_id, channel (email/sms), ts                                         |
| `auth.mfa`          | `enrolled`, `used`, `failure`, `reset`        | user_id, method (totp/sms), reason, by_admin, ts                         |
| `auth.password`     | `changed`, `reset_requested`                  | user_id (or null), identifier_hash, by_self/by_admin, ip, ts             |
| `auth.magic_link`   | `sent`, `used`                                | user_id, channel, ts                                                     |
| `auth.session`      | `created`, `terminated`                       | user_id, sid, device_id, reason (logout/force/expiry/theft_detected), ts |
| `auth.token`        | `rotated`, `theft_detected`                   | user_id, sid, ts                                                         |
| `auth.account_link` | `linked_auto`, `attempt_rejected`, `unlinked` | user_id, provider, reason, by_self/by_admin, ts                          |
| `auth.role`         | `granted`, `revoked`                          | user_id, role, by_admin, ts                                              |
| `auth.lockout`      | `triggered`, `released`                       | user_id, reason, by_admin/auto, ts                                       |
| `auth.step_up`      | `requested`, `succeeded`, `failed`            | user_id, endpoint, acr_before, acr_after, mfa_method, ip, ua, ts         |
| `auth.sms`          | `budget_breaker_open`                         | scope (global), count, provider, ts                                      |
| `auth.sync`         | `drift_detected`                              | user_id, diff, ts                                                        |
| `auth.erasure`      | `executed`                                    | user_id, scope, ts                                                       |

- **Storage:** the `auth_audit` table (§8) is the auth-domain **projection of the append-only `audit_ledger`** (ADR-0003 §6); PD columns store masked values, full values only in the encrypted ledger (003-design §5). Append-only — `INSERT` only, `UPDATE`/`DELETE` blocked at the DB level (ADR-0003 §2.7 ledger pattern). Read access: `platform_admin` + DPO only; deletion is impossible even for them.
- **Retention:** ≥3 years (ADR-0001 design §7.3 / PRD §31); the platform retention matrix sets the audit ledger at **5 years** with crypto-shred at term (ADR-0009 §2.6, OQ-D3 CLOSED). (ADR-0003's OQ-D3 spells this table `audit_log`; ADR-0009 §2.6 spells the same table `audit_ledger` — one table, two corpus spellings.)
- **Audit-class registration:** each class above is registered per ADR-0009 §2.4; the `@Authz({ audit: 'low-stakes' | 'high-stakes' })` classification (matrix §3) determines whether a given route's outcome _must_ produce a row, while this taxonomy fixes the event's identity and fields.
- **Corpus alignment:** the `auth_audit` table name and these class-qualified ids are used consistently across ADR-0001 design §2.5/§7.3, the endpoint-authorization-matrix spec, and 003-design §5 (ADR-0001 reconciled to this taxonomy in #111). This §7.3 is the canonical taxonomy of record; ADR-0001 §7.3 mirrors the v1-mandatory subset.

### 7.4 JWT fast-path vs introspection for step-up

No new contract — a pointer so the §7.2 "high-stakes" claim is unambiguous. Step-up endpoints fall in the <1% high-stakes set, so their authentication step (pipeline position 4, §6) uses IdP `/introspect` (RFC 7662) with a 60-second local cache, per ADR-0001 design §7.2 — not the stateless JWT fast-path. `StepUpGuard`'s freshness check (§7.1) therefore runs on a token that has already been confirmed not-revoked.

### 7.5 CSRF double-submit middleware

Resolves ADR-0004 design (CSRF): "double-submit pattern (cookie + header) on all state-changing endpoints. Implemented via NestJS middleware on the API side (see identity-auth-rbac-design §7.5)."

- **Scope:** all state-changing methods (`POST` / `PUT` / `PATCH` / `DELETE`) served under **cookie-borne** authentication (the `__Host-` per-app session cookie, ADR-0001 §6). Safe methods (`GET` / `HEAD` / `OPTIONS`) are exempt.
- **Mechanism:** the server issues a CSRF token in a **non-`HttpOnly`** cookie (JS-readable) alongside the session cookie; the client echoes it in an `X-CSRF-Token` header on each state-changing request; the NestJS middleware (pipeline position 3, §6) rejects a missing/mismatched token with **`403 Forbidden`**. Use a **signed (HMAC) double-submit** (the `csrf-csrf` pattern) rather than naive double-submit, so a cookie injected via a sibling subdomain cannot forge a valid pair.
- **Relationship to `SameSite=Lax`:** `SameSite=Lax` already blocks the cross-site form-POST vector; double-submit is **defense-in-depth** on top of it. It is explicitly **not** a defense against same-origin XSS — consistent with ADR-0001 §6, which rejects shared cross-zone cookies for exactly that reason. The `__Host-` + per-app-cookie isolation is the primary control; CSRF double-submit is the second layer.
- **Exemptions:**
  - **Mobile native** (RN+Expo) uses token-based auth against the API, not cookies (ADR-0004 §3.2) — no ambient cookie credential, so CSRF middleware does not apply.
  - **HMAC-verified webhook receivers** (e.g. `POST /internal/idp/events`, ADR-0001 §3.2) authenticate by request signature, not the session cookie — CSRF middleware is skipped for them; their integrity is the HMAC, not a double-submit token.

---

## 8. Naming resolution

- **Audit table name — `auth_audit` (pinned).** **This spec pins `auth_audit`** as canonical: it is the spelling the implementation-facing specs (`endpoint-authorization-matrix-design §3`, 003-design §5) build against, and the `_events` suffix is redundant for a table whose every row is an event. `auth_audit` is the auth-domain projection of the append-only `audit_ledger` (ADR-0003 §6); the matrix `audit` column's semantics (none/low-stakes/high-stakes) are unchanged by the name. ADR-0001 design §2.5/§7.3 were reconciled to this name + the class-qualified event ids (§7.3) in #111, so the corpus is consistent end-to-end.

---

## 9. Forward-reference resolution

| Pointer                                                                 | Resolved by              |
| ----------------------------------------------------------------------- | ------------------------ |
| ADR-0001 §10 (step-up mechanism: `StepUpGuard`, trigger, 401 contract)  | §7.2                     |
| ADR-0001 §10 → §7.1 (`acr=mfa-fresh` claim, `mfa_fresh_at`, 30-min TTL) | §7.1                     |
| ADR-0001 §10 → §7.3 (full auth audit-event list, `auth.step_up.*`)      | §7.3                     |
| ADR-0004 design (CSRF) → §7.5 (double-submit middleware)                | §7.5                     |
| engineering-readiness §5.bis → §5 (SMS circuit-breaker / failover)      | §5                       |
| endpoint-authorization-matrix-design §8 (`auth_audit` table name)       | §8 (pinned `auth_audit`) |
| ADR-0001 §10 ("backend-core middleware checklist" — step-up ordering)   | §6 (auth-relevant slice) |

No forward reference to `identity-auth-rbac-design` remains dangling.

---

## 10. Out of scope / deferred

- **Implementation** of any contract here (the `StepUpGuard`, the CSRF middleware, the SMS breaker service, the `auth_audit` projection, the audit-class registrations) — owned by the consuming verticals (003 / backend-core / E3), not this spec.
- **The role model, RBAC enforcement engine, and session/token parameters** — owned by ADR-0001 / ADR-0002 / `endpoint-authorization-matrix-design`; referenced in §3/§4, never redefined.
- **The full backend-core middleware chain** beyond the auth-relevant ordering in §6 — owned by `backend-core-design`.
- **Concrete SMS / email provider selection** — owned by engineering-readiness §5.bis (an implementation moment).
