/**
 * Endpoint-authorization classification contract (Layer 1 SSOT).
 *
 * Spec: apps/docs/content/specs/tech/2026-05-18-ds-platform-endpoint-authorization-matrix-design-en.md §3, §4.
 * The `@Authz({...})` decorator (authz.decorator.ts) attaches one `AuthzMeta`
 * per route handler under `AUTHZ_KEY`. The runtime guard (authz.guard.ts), the
 * completeness gate, and the generated matrix all read the SAME metadata — there
 * is no second source to drift (§2).
 */

/**
 * Role vocabulary. SSOT is the platform IdP group model (ADR-0001 §2.2),
 * mirrored into the backend `users.role` column (packages/db). The matrix
 * *references* this vocabulary, it does not own it — as IdP groups activate
 * (`moderator`, …) the allowed set grows by extending this list, without a spec
 * change. The v1 authenticated baseline is `doctor_guest` (spec §3).
 */
export const ROLES = [
  "guest",
  "doctor_guest",
  "doctor",
  "legacy_admin",
  "platform_admin",
  "expert",
] as const;
export type Role = (typeof ROLES)[number];

/** `public` = no authenticated subject required; `authenticated` = valid session subject required (spec §3). */
export type AuthzAccess = "public" | "authenticated";

/**
 * Engine-neutral enforcement strength (spec §3):
 * - `none`      — no subject/role/policy evaluation (only valid with `public`).
 * - `fast-path` — JWT/role claim check only (RBAC, in the guard, no external call).
 * - `policy`    — full evaluation through the `IPolicyEngine` (ADR-0002 §3.2).
 */
export type AuthzCheck = "none" | "fast-path" | "policy";

/**
 * Audit requirement (spec §3). `high-stakes` ⇒ a terminal `auth_audit` ledger
 * entry is mandatory. For auth/security routes that entry is emitted explicitly
 * at the command site (the `AuthAuditLog` port), by design (#135); a CI guard
 * enforces emission completeness over the `high-stakes` route set — see
 * authz/README.md.
 */
export type AuthzAudit = "none" | "low-stakes" | "high-stakes";

/** The authored classification — the eight-column row contract minus the derived `endpoint` (spec §3). */
export interface AuthzMeta {
  access: AuthzAccess;
  /** required when `access: "authenticated"`; omitted/`—` when `public`. */
  roles?: Role[];
  check: AuthzCheck;
  /** object-level (ABAC) predicates; only valid when `check: "policy"`. */
  objectAttrs?: string[];
  /** fresh step-up (`acr=mfa-fresh`) requirement; mechanism lives in identity-auth-rbac-design. Default false. */
  stepUp?: boolean;
  audit: AuthzAudit;
  /** covering EARS id(s), e.g. `["EARS-5"]` — keyed to the `it('EARS-N: …')` convention. */
  tests: string[];
}

/** Nest metadata key the decorator writes and the guard/gate/generator read. */
export const AUTHZ_KEY = "ds:authz";

/** Marks an unauthenticated entry point (still requires `@Authz({ access: "public", … })`). */
export const IS_PUBLIC_KEY = "ds:public";
