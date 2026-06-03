---
title: "DS Platform — Endpoint Authorization Matrix (Design)"
description: "Per-endpoint authorization classification metadata, the @Authz decorator SSOT, the DiscoveryService completeness gate, the generated apps/api/docs/endpoint-authz-matrix.md, and the endpoint-authz CI lint. Closes the forward references from ADR-0001 §2.5/§7.1, ADR-0002 §3.2.1, ADR-0010 §6, and engineering-readiness §3."
date: 2026-05-18
status: Draft
authors: Tech Lead (with AI agent, authored 2026-06-02)
---

# DS Platform — Endpoint Authorization Matrix — Design

**Date:** 2026-05-18 (authored 2026-06-02 under GitHub Issue #102)
**Status:** Draft
**Type:** Platform-level design spec (cross-cutting security governance). Referenced by ADR-0001, ADR-0002, ADR-0010, and the engineering-readiness spec; consumed first by E3 (#83).
**Applies (not inherits):** ADR-0001 (Identity & authorization), ADR-0002 (NestJS + Fastify + OpenAPI), ADR-0003 (audit ledger), ADR-0009 (PD lifecycle / 152-FZ), ADR-0010 (dual-LLM), engineering-readiness spec.

---

## 1. Context and problem

ADR-0001 §2.5 mandates an **endpoint authorization matrix** as a pre-pilot artifact: every backend endpoint must carry machine-readable metadata describing who may call it and how strictly that is enforced, validated by a CI gate that fails when an endpoint lacks the metadata. The same artifact is forward-referenced — and promised as the home for specific content — from five pointers across four documents:

| #   | Pointer                                   | What it expects from this spec                                                                                                                |
| --- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **ADR-0001 §2.5**                         | Matrix-row contract, format of `apps/api/docs/endpoint-authz-matrix.md`, the CI gate `tools/lint-endpoint-authz`, pre-pilot sample endpoints. |
| 2   | **ADR-0001 §7.1**                         | The `step_up` matrix flag (per-endpoint `acr=mfa-fresh` requirement).                                                                         |
| 3   | **ADR-0002 §3.2.1**                       | The runtime policy-enforcement guard and the `tools/lint-endpoint-authz` CI gate.                                                             |
| 4   | **ADR-0010 §6**                           | Authz hard-constraints on tool calls (`subject_id == session.subject_id`-style), belt-and-suspenders on top of dual-LLM.                      |
| 5   | **engineering-readiness §3 (+ BLOCKERs)** | Named **pre-pilot security BLOCKER**: "Endpoint authorization matrix as a CI gate … fails on missing metadata."                               |

Until this spec lands, those references dangle and E3 (#83) cannot implement the matrix + lint against a single normative source.

### 1.1 Why this matters (threat model)

DS Platform code is written **primarily by AI agents**. The dominant risk is not a wrong policy — it is a **silently unclassified endpoint**: an agent adds a route handler and forgets to attach an authorization decision, so the route ships either wide-open or with an ad-hoc, unreviewed rule. A NestJS guard only runs where it is attached; the framework does not fail a build because a handler lacks a guard. The matrix exists to make that omission **impossible to merge**: every route the application actually exposes must carry a complete, reviewable authorization classification, or CI fails.

### 1.2 What this spec does NOT do

Authorization **enforcement** (authenticating the caller, checking roles, evaluating object-level policy) is already designed in **ADR-0002 §3.2 (`RbacModule`)**: NestJS global guards + decorators delegating to an `IPolicyEngine` interface, with the concrete engine (Cerbos / OPA / OpenFGA / SQL) deferred to DSO-27 and pluggable without changing the guards. This spec does not re-invent that mechanism. It defines the **governance layer over it**: the metadata contract, the completeness gate, and the generated audit artifact. It also does not author Cerbos policies beyond the authentication needs already covered by 003, and it does not implement the decorator/lint/generator — that is E3 (#83).

---

## 2. Architecture — four layers

The design separates the **source of truth** from its **enforcement**, its **projections**, and a **defense-in-depth** check. The decisive principle: _the completeness gate must observe the same route set that actually serves traffic_ — never a curated artifact that can silently omit a route.

```
                ┌──────────────────────────────────────────────┐
   AUTHOR  ───► │ Layer 1 — SSOT: @Authz({...}) on the handler   │
                │   the single annotation; enforcement guards     │
                │   AND projections AND the gate all read it      │
                └───────────────┬──────────────────────────────┘
                                │ Nest metadata (Reflector)
          ┌─────────────────────┼──────────────────────────────────┐
          ▼                      ▼                                   ▼
 ┌──────────────────┐  ┌────────────────────────┐      ┌────────────────────────┐
 │ RUNTIME enforce  │  │ Layer 2 — completeness  │      │ Layer 3 — projections   │
 │ global AuthzGuard│  │ gate (PRIMARY, BLOCK)   │      │ (generated outputs)     │
 │ fail-closed on   │  │ DiscoveryService scan   │      │ • endpoint-authz-       │
 │ missing metadata │  │ over the real route set │      │   matrix.md (table)     │
 └──────────────────┘  │ → CI fail if incomplete │      │ • OpenAPI x-authz ext.  │
                       └────────────────────────┘      └───────────┬────────────┘
                                                                    │
                                                          ┌─────────▼──────────┐
                                                          │ Layer 4 — defense  │
                                                          │ in depth (WARN):    │
                                                          │ Spectral + OWASP    │
                                                          │ ruleset on the doc  │
                                                          └────────────────────┘
```

**Layer 1 — Source of truth.** A single `@Authz({...})` decorator on each route handler carries the full authorization classification. The enforcement guards, the completeness gate, and the projections all read the _same_ metadata, so there is no second source to drift (§4).

**Layer 2 — Completeness gate (primary, BLOCK).** A CI lint enumerates **every route the NestJS router actually registers** — via Nest's own `DiscoveryService` + `MetadataScanner`, not a static AST parse and not the OpenAPI document — and fails if any route lacks complete, valid `@Authz` metadata (§6). This is the security-critical gate.

**Layer 3 — Projections (generated, never authoritative).** Both `apps/api/docs/endpoint-authz-matrix.md` (the human-readable table) and the `x-authz` extension fields in the OpenAPI document are **generated from the Layer-1 metadata** (§5). They are outputs for review and audit — they are never the source the gate reads.

**Layer 4 — Defense-in-depth (off-the-shelf, WARN).** [Spectral](https://github.com/stoplightio/spectral) with the [`@stoplight/spectral-owasp-ruleset`](https://www.npmjs.com/package/@stoplight/spectral-owasp-ruleset) (OWASP API Security) runs over the generated OpenAPI document and flags any _public-facing_ operation with no security scheme (rule family `owasp:api2:2023-*-restricted` — "this operation is not protected by any security scheme"). This is community-maintained, cheap, and reuses tooling that already fits the OpenAPI-first stack — but it is advisory only, because the OpenAPI document is a curated subset (see §2.1).

**Runtime mirror.** A global `AuthzGuard` (`APP_GUARD`) reads the same metadata and **fails closed** at runtime: a handler reaching the router with no authz metadata is denied, not served. This mirrors the CI gate so a gap can never be exploited even between merge and the next CI run.

### 2.1 Why the OpenAPI document is NOT the gate's source of truth

It is tempting to lint the auto-generated OpenAPI document, since the stack already produces it (Zod → `nestjs-zod` → OpenAPI 3.1, ADR-0002 §4.7). It is rejected as the **authoritative** source for the completeness gate, for one reason: the OpenAPI document is a _curated projection_, and routes can be excluded from it (`@ApiExcludeEndpoint()`, internal routes deliberately kept out of the public spec, raw Fastify routes registered outside the Nest decorator system). The routes most likely to be excluded — internal webhook receivers such as `POST /internal/idp/events` (HMAC-verified, ADR-0001 §3.2) — are exactly the security-sensitive ones. A gate that reads the document would have a blind spot precisely where it hurts most. A completeness check must read the **authoritative runtime route registry**, so the OpenAPI document is used only for the Layer-4 advisory pass and as a Layer-3 projection target.

A static AST scan is likewise rejected as the gate's source: it re-implements route discovery and drifts from runtime reality (dynamic modules, route versioning). Nest's `DiscoveryService`/`MetadataScanner` is the framework-blessed reflection of the real DI container and router, and is reused instead of a bespoke parser.

---

## 3. The row contract

Each endpoint contributes **one row** to the matrix. A row has eight columns; one is derived from the route, the rest are authored in the `@Authz` decorator.

| Column           | Source                     | Values                                                              | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------- | -------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `endpoint`       | **derived** from the route | `METHOD /vN/path`                                                   | Method + versioned path (or RPC name). Not authored — read from Nest route metadata.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `access`         | authored                   | `public` \| `authenticated`                                         | Discriminator. `public` = no authenticated subject is required (the endpoint runs before/without login). `authenticated` = a valid session subject is required. Replaces the ambiguous "guest" wording in the ADR-0001 §2.5 stub.                                                                                                                                                                                                                                                                                                                                                                     |
| `required_roles` | authored                   | a set drawn from the platform role model; `—` when `access: public` | The role vocabulary's SSOT is the platform IdP group model (**ADR-0001 §2.2**: `guest`, `doctor_guest`, `doctor`, `legacy_admin`, `platform_admin`, `expert`, …), mirrored into the backend `users.role` (`packages/db`); the v1 authenticated baseline is `doctor_guest`. The matrix **references** the role model, it does not own it. As groups activate (`expert`, `moderator`, …) the allowed set grows without changing this spec.                                                                                                                                                              |
| `auth_check`     | authored                   | `none` \| `fast-path` \| `policy`                                   | **Engine-neutral.** `none` = no subject/role/policy evaluation (only valid with `access: public`). `fast-path` = JWT/role claim check only (RBAC, in the guard, no external call). `policy` = full evaluation through the `IPolicyEngine` (ADR-0002 §3.2).                                                                                                                                                                                                                                                                                                                                            |
| `object_attrs`   | authored                   | list of object-level predicates; `—` unless `auth_check: policy`    | The attribute-level (ABAC) checks the policy engine evaluates, e.g. `course.author_id == actor.id` for `course.update`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `step_up`        | authored                   | `true` \| `false` (default `false`)                                 | Whether the endpoint requires a fresh step-up authentication (`acr=mfa-fresh`). The matrix carries **only this per-endpoint flag**; the step-up _mechanism_ — `StepUpGuard`, the fresh-MFA TTL, the `401 { error: 'step_up_required', step_up_url }` contract, and the `auth.step_up.*` audit class — is specified in `identity-auth-rbac-design` (forward reference; ADR-0001 §10). The list of step-up endpoints is the matrix projection of the rows where this flag is `true`. v1 has no step-up endpoints; the first arrives with the first high-risk authenticated action (003-design §7 seam). |
| `audit`          | authored                   | `none` \| `low-stakes` \| `high-stakes`                             | Determines whether an entry in `auth_audit` (the `audit_ledger` projection, ADR-0003 §6) is required. `high-stakes` ⇒ a ledger entry is mandatory.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `test_coverage`  | authored                   | one or more EARS ids, e.g. `["EARS-5"]`                             | The handler references its covering scenario(s) by EARS id (keyed to the `it('EARS-N: …')` convention, AGENTS.md §6). The generator (§5) resolves the ids into links in the projected `.md`; the gate verifies the field is non-empty. A raw test-file URL is **not** used — it rots on the first move.                                                                                                                                                                                                                                                                                               |

### 3.1 Field interdependencies (validated by the gate)

- `access: public` ⇒ `auth_check: none`, `required_roles: —`, `object_attrs: —`. (A public endpoint has no subject to authorize; it is protected by rate-limit + bot-protection guards, 003-design §10.1, not by authz.)
- `access: authenticated` ⇒ `required_roles` non-empty and `auth_check ∈ {fast-path, policy}`.
- `object_attrs` non-empty ⇒ `auth_check: policy`.
- `audit` and `test_coverage` are mandatory for **every** row regardless of `access` (a public `login` is still `high-stakes` and still test-covered).

These rules are part of the "complete and valid metadata" definition the gate enforces (§6.2).

### 3.2 Relationship to the ADR-0001 §2.5 stub

ADR-0001 §2.5 describes the row as six fields (`endpoint`, `required_roles`, `auth_check`, `object_attrs`, `audit`, `test_coverage`) with `auth_check ∈ {fast-path, cerbos}` and an illustrative role list `guest/doctor/expert/platform_admin`. This spec is the authoritative contract that stub forward-references; it sharpens that text in three deliberate ways — engine-neutral `auth_check`, an explicit `access` discriminator plus the `step_up` field, and `required_roles` pinned to the §2.2 IdP group model (the §2.5 illustrative list is correct — those are real groups — it just predates the v1 baseline `doctor_guest`). The ADR-0001 stub text should be aligned to match (§8, decision-debt).

---

## 4. The `@Authz` decorator (Layer 1)

`@Authz()` is a **single composite decorator** built with NestJS `applyDecorators()`. It is the only authoring surface; it desugars into the enforcement primitives ADR-0002 already defines, so the runtime mechanism (`RbacModule` guards + `IPolicyEngine` + `AuditInterceptor`) is unchanged.

```ts
// illustrative shape — exact implementation is E3 (#83)
export interface AuthzMeta {
  access: "public" | "authenticated";
  roles?: Role[]; // required when access === "authenticated"
  check: "none" | "fast-path" | "policy";
  objectAttrs?: string[]; // only when check === "policy"
  stepUp?: boolean; // default false
  audit: "none" | "low-stakes" | "high-stakes";
  tests: string[]; // EARS ids, e.g. ["EARS-5"]
}

export const AUTHZ_KEY = "ds:authz";

export function Authz(meta: AuthzMeta): MethodDecorator & ClassDecorator {
  return applyDecorators(
    SetMetadata(AUTHZ_KEY, meta), // read by AuthzGuard, the gate, the generator
    UseInterceptors(AuditInterceptor), // ADR-0002 §4.8 audit primitive
    // OpenAPI x-authz extension is emitted by the generator from the same meta
  );
}
```

```ts
// worked usage — the SSOT lives in one place
@Controller({ path: "auth", version: "1" })
export class AuthController {
  @Post("login")
  @Public() // unauthenticated entry point
  @Authz({
    access: "public",
    check: "none",
    audit: "high-stakes",
    tests: ["EARS-5"],
  })
  async login(/* … */) {}

  @Delete("session")
  @Authz({
    access: "authenticated",
    roles: ["doctor_guest"],
    check: "fast-path",
    audit: "low-stakes",
    tests: ["EARS-10"],
  })
  async logout(/* … */) {}
}
```

- **`@Public()`** marks unauthenticated entry points. The global `AuthzGuard` skips authentication for them, but a `@Public()` handler **still must carry `@Authz({ access: "public", … })`** so it appears in the matrix with its audit classification and test coverage. `@Public()` without `@Authz` is a gate failure.
- **Global `AuthzGuard` (`APP_GUARD`)** reads `AUTHZ_KEY` and enforces: authenticate (unless `@Public`), check `required_roles`, and for `check: "policy"` delegate to `IPolicyEngine`. A handler with **no** `AUTHZ_KEY` metadata is **denied** (fail-closed) — the runtime mirror of the Layer-2 gate.
- **Relationship to ADR-0002 §4.8.** That section illustrates the raw primitives (`@UseGuards`, `@Permission`, `@UseInterceptors(AuditInterceptor)`). `@Authz` is the consolidating wrapper over them: one annotation, one source of truth, mechanically equivalent. ADR-0002 §4.8 should be aligned to show `@Authz` as the authoring surface (§8, decision-debt).

---

## 5. The generated matrix — `apps/api/docs/endpoint-authz-matrix.md`

The aggregated table is **generated** from the Layer-1 metadata (the same `DiscoveryService` scan the gate uses), never hand-maintained.

**Format.** A single Markdown table, rows sorted by `endpoint`, one row per registered route, columns exactly as §3:

```markdown
<!-- GENERATED by tools/lint/endpoint-authz-lint.ts --generate — do not edit by hand -->

| endpoint                | access        | required_roles | auth_check | object_attrs               | step_up | audit       | test_coverage   |
| ----------------------- | ------------- | -------------- | ---------- | -------------------------- | ------- | ----------- | --------------- |
| POST /v1/auth/login     | public        | —              | none       | —                          | false   | high-stakes | EARS-5          |
| DELETE /v1/auth/session | authenticated | doctor_guest   | fast-path  | —                          | false   | low-stakes  | EARS-10         |
| PATCH /v1/courses/:id   | authenticated | doctor_guest   | policy     | course.author_id==actor.id | false   | high-stakes | EARS-N (future) |
```

- `test_coverage` cells render the EARS ids as links to the covering spec/test where resolvable.
- The file carries a generated-header banner and is **committed**. A **drift gate** (the same lint in check mode) fails CI if the committed `.md` does not match a fresh regeneration — identical in spirit to the other generate-drift gates (generated SDK, glossary ids). This keeps the human-readable artifact honest without making it a second source of truth.
- The OpenAPI `x-authz` extension on each operation is emitted from the same scan, so the OpenAPI document and the `.md` table always agree.

---

## 6. The CI lint — `tools/lint/endpoint-authz-lint.ts`

ADR-0001 §2.5 / ADR-0002 §3.2.1 name the gate by its logical name `tools/lint-endpoint-authz`; in the repo it follows the existing `tools/lint/*-lint.ts` convention as **`tools/lint/endpoint-authz-lint.ts`**.

### 6.1 What it does

1. **Enumerate the real route set.** Boot a Nest application _context_ (no network listen) and enumerate every registered route handler via `DiscoveryService` + `MetadataScanner`, reading each handler's route metadata (method, versioned path) and its `AUTHZ_KEY` metadata. This is the authoritative set — internal/excluded-from-OpenAPI routes included.
2. **Validate completeness + validity** of each route's `@Authz` metadata (§6.2).
3. **Modes:** default (check) fails on any violation; `--generate` writes `apps/api/docs/endpoint-authz-matrix.md` + the OpenAPI `x-authz` extensions.

### 6.2 Definition of "missing / incomplete metadata → fail"

A route is a **violation** (CI fail) when any of the following holds:

- **Missing:** the handler has no `AUTHZ_KEY` metadata at all (and is not otherwise exempted — there is no silent exemption; even `@Public()` endpoints must declare `@Authz`).
- **Incomplete:** a required field is absent — `access`, `auth_check`, `audit`, and a non-empty `tests` are mandatory on every row; `required_roles` is mandatory when `access: authenticated`.
- **Invalid:** a field value is outside its enum, or a §3.1 interdependency is violated (e.g. `object_attrs` present with `auth_check: fast-path`; `access: public` with a non-`none` `auth_check`).
- **Drift (in check mode):** the committed `endpoint-authz-matrix.md` does not match a fresh regeneration.

### 6.3 BLOCK vs WARN

The completeness gate (Layer 2) is **BLOCK**. The Spectral/OWASP defense-in-depth pass (Layer 4) is **WARN**.

This is a deliberate exception to ADR-0007 §2.6's general Phase-0 posture ("`spec-link` is BLOCK; others are WARN in Phase 0"). The exception is justified because both authoritative sources for _this specific_ gate mandate hard failure — ADR-0001 §2.5 ("missing metadata → CI fail") and engineering-readiness §3 ("fails on missing metadata") — and the matrix is a named **pre-pilot security BLOCKER**. It is therefore classified BLOCK alongside `spec-link`, not WARN with the stylistic guards.

The BLOCK classification does **not** impede Phase-0 bootstrap: the gate is _vacuously green when there are no routes to classify_. It fails only once a route exists without complete metadata. So the "WARN because the codebase is still empty" rationale does not apply — there is nothing to fail until there is something to protect.

---

## 7. Pre-pilot sample endpoints (worked examples)

The planned 003 authentication endpoints, classified as worked examples. Paths align with 003-design's `/v1/auth/*` BFF surface; 003 / E3 own the final exact paths and EARS mapping — these rows are illustrative of the _classification_, not a frozen route list.

### 7.1 Public (unauthenticated entry points)

| endpoint                         | access | required_roles | auth_check | object_attrs | step_up | audit       | test_coverage                    |
| -------------------------------- | ------ | -------------- | ---------- | ------------ | ------- | ----------- | -------------------------------- |
| `POST /v1/auth/register`         | public | —              | none       | —            | false   | high-stakes | EARS-1, EARS-2, EARS-19, EARS-20 |
| `POST /v1/auth/login`            | public | —              | none       | —            | false   | high-stakes | EARS-5 (+ EARS-6/7 OTP variants) |
| `POST /v1/auth/password-reset/*` | public | —              | none       | —            | false   | high-stakes | EARS-11, EARS-12                 |
| `POST /v1/auth/verify`           | public | —              | none       | —            | false   | high-stakes | EARS-6 (verify step)             |

These are protected by the rate-limit and bot-protection guards (003-design §10.1, EARS-13/17), which are orthogonal to authz and not matrix columns; the matrix records that authorization is intentionally `none` here, and that the events are `high-stakes`-audited.

### 7.2 Authenticated baseline (`doctor_guest`)

| endpoint                           | access        | required_roles | auth_check | object_attrs | step_up | audit      | test_coverage |
| ---------------------------------- | ------------- | -------------- | ---------- | ------------ | ------- | ---------- | ------------- |
| `DELETE /v1/auth/session` (logout) | authenticated | doctor_guest   | fast-path  | —            | false   | low-stakes | EARS-10       |
| `POST /v1/auth/session/refresh`    | authenticated | doctor_guest   | fast-path  | —            | false   | low-stakes | EARS-9        |
| `GET /v1/auth/session` (current)   | authenticated | doctor_guest   | fast-path  | —            | false   | none       | EARS-8        |

Every v1 auth endpoint is `auth_check ∈ {none, fast-path}` and `step_up: false`: 003 needs neither object-level policy nor step-up. The `policy` path and `step_up: true` are therefore not exercised by the 003 set.

### 7.3 Illustrative future `policy` row (not 003)

To show the `policy`/`object_attrs` path that the 003 set does not exercise:

| endpoint                | access        | required_roles | auth_check | object_attrs                   | step_up | audit       | test_coverage   |
| ----------------------- | ------------- | -------------- | ---------- | ------------------------------ | ------- | ----------- | --------------- |
| `PATCH /v1/courses/:id` | authenticated | doctor_guest   | policy     | `course.author_id == actor.id` | false   | high-stakes | EARS-N (future) |

`auth_check: policy` routes the request through `IPolicyEngine` (ADR-0002 §3.2), which evaluates the `object_attrs` predicate; the engine's concrete implementation (Cerbos by default in the dev stand) is a deployment detail, not a matrix value. Future high-risk administrative actions are where `step_up: true` first appears (ADR-0001 §7.1).

### 7.4 Dual-LLM tool calls (ADR-0010 §6)

ADR-0010 §6 forward-references this spec for the rule that PD-accessible tool calls are authorized independently of LLM output (`subject_id` taken from the authenticated session, never from LLM text). Tool-exposing endpoints are ordinary rows in this matrix: an endpoint that backs a P-LLM tool is classified `auth_check: policy` with an `object_attrs` predicate binding the resource to the **session** subject (e.g. `record.subject_id == session.subject_id`), `audit: high-stakes`. The matrix is therefore the enforcement record of ADR-0010's hard-constraint #6: the authz decision is in the endpoint's `@Authz`, evaluated by the guard/`IPolicyEngine`, and is structurally unable to depend on LLM output.

---

## 8. Decision-debt (separate adr-revision follow-ups)

Surfaced per AGENTS.md §6; **not** changed inside this spec-authoring. Each is a paper-architecture alignment (inline rewrite, no amendment block — AGENTS.md §6):

1. **ADR-0001 §2.5** — the stub's six-field row and `auth_check ∈ {fast-path, cerbos}` are superseded by this spec's eight-column row with engine-neutral `auth_check ∈ {none, fast-path, policy}` and the explicit `access` discriminator. Align the stub wording, and point its role list at the §2.2 IdP group model (the SSOT for the role vocabulary; the backend `users.role` is only a mirror) — the `guest/doctor/...` examples are correct, they just predate the v1 baseline `doctor_guest`. (The audit-table name divergence — `auth_audit` in 003-design §5 / this spec vs `auth_audit_events` in ADR-0001 §2.5/§7.3 — is **left unsettled here**; it belongs to the audit-subsystem / `identity-auth-rbac-design` naming, not this reconciliation.)
2. **ADR-0001 §7.1 + §10 (step-up).** Three places name the step-up field three ways — `step_up_required` (design §7.1), `auth: 'step-up'` (narrative §10), and this spec's boolean `step_up` column. Reconcile all to the boolean `step_up` — step-up is **orthogonal** to `auth_check` (a `fast-path` or a `policy` endpoint may equally require it), so it cannot be a value of that enum. Additionally, narrative §10 forward-references "endpoint-authorization-matrix-design §8.1/§8.2" for the step-up endpoint list and the mechanism (`StepUpGuard`, the `401 step_up_url` contract); redirect those: the matrix owns only the per-endpoint **flag** (and the endpoint list as its projection), while the step-up **mechanism** belongs to `identity-auth-rbac-design`. (§7.1's "ADR-0001 §10" reference is itself correct — the _narrative_ §10 step-up section exists; only the _design_ file's §10 is "Risks and open questions".)
3. **ADR-0002 §4.8 / §3.2.1** — align the minimal-endpoint example to show `@Authz` as the single authoring surface (desugaring into the existing primitives), and point §3.2.1's `endpointAuthzGuard` at the global `AuthzGuard` described here.

---

## 9. Forward-reference resolution

| Pointer                                                                  | Resolved by           |
| ------------------------------------------------------------------------ | --------------------- |
| ADR-0001 §2.5 (row contract, `.md` format, CI gate, samples)             | §3, §5, §6, §7        |
| ADR-0001 §7.1 (`step_up` field)                                          | §3 (`step_up` column) |
| ADR-0002 §3.2.1 (`endpointAuthzGuard` + lint)                            | §4 (`AuthzGuard`), §6 |
| ADR-0010 §6 (authz on tool calls)                                        | §7.4                  |
| engineering-readiness §3 + BLOCKERs (CI gate, fails on missing metadata) | §6 (BLOCK, §6.2/§6.3) |

No forward reference to this artifact remains dangling.

---

## 10. Out of scope / deferred

- The implementation (the `@Authz` decorator, `AuthzGuard`, `tools/lint/endpoint-authz-lint.ts`, the generated `.md`, CI wiring) — **E3 (#83)**.
- The concrete `IPolicyEngine` engine selection (Cerbos / OPA / OpenFGA / SQL) — **DSO-27**; this spec is engine-neutral by design.
- Cerbos policy authoring beyond the authentication needs covered by 003.
- The sibling missing pre-pilot specs `2026-05-18-ds-platform-dual-llm-pattern-design` and `2026-05-18-ds-platform-bullmq-queue-contract-design` — separate triage.
