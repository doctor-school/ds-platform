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
  "pd_officer",
  "expert",
] as const;
export type Role = (typeof ROLES)[number];

/**
 * Access class (spec §3):
 * - `public`        — no authenticated subject required.
 * - `authenticated` — a valid session subject is required.
 * - `pending-auth`  — 011 EARS-4: reachable **only** by a principal that has
 *   completed primary authentication and owes a second factor. It is neither of
 *   the other two, and collapsing it into one of them would be a lie in a
 *   security artifact: `public` would advertise the enrollment/challenge
 *   endpoints as open to anyone, and `authenticated` would claim the guard
 *   resolves an `AdminSessionPrincipal` there — it cannot, because the whole
 *   point of the state is that no session exists yet. The pending reference is
 *   verified by the classified handler against the server-side pending-auth
 *   record (its fingerprint and its required next step); the guard's job on these
 *   rows is to NOT wave through a session-based subject.
 */
export type AuthzAccess = "public" | "authenticated" | "pending-auth";

/**
 * Engine-neutral enforcement strength (spec §3):
 * - `none`      — no subject/role/policy evaluation (only valid with `public`).
 * - `fast-path` — JWT/role claim check only (RBAC, in the guard, no external call).
 * - `policy`    — the role alone is not sufficient (two sub-modes, spec §3):
 *                 with `objectAttrs`, the ABAC predicate is evaluated through
 *                 the `IPolicyEngine` (ADR-0002 §3.2 / DSO-27; the guard fails
 *                 closed until it is wired); without `objectAttrs`, the guard
 *                 enforces the role and the classified handler/service
 *                 evaluates the resource-scoped domain rule in-service (e.g.
 *                 the 006 room gate, `registered ∧ live`).
 */
export type AuthzCheck = "none" | "fast-path" | "policy";

/**
 * Audit requirement (spec §3). `high-stakes` ⇒ the route's audit posture is
 * accounted for in the emission-coverage registry
 * (`audit-emission-coverage.ts`): normally a mandatory terminal `auth_audit`
 * ledger entry, emitted explicitly at the command site (the `AuthAuditLog`
 * port) by design (#135), and — where the governing spec says the command emits
 * nothing durable — an explicit, spec-citing `noneBySpec` entry instead. A CI
 * guard enforces that accounting over the whole `high-stakes` route set, so
 * "owes no row" is a reviewed statement rather than an under-classification —
 * see authz/README.md.
 */
export type AuthzAudit = "none" | "low-stakes" | "high-stakes";

/** The authored classification — the eight-column row contract minus the derived `endpoint` (spec §3). */
export interface AuthzMeta {
  access: AuthzAccess;
  /**
   * required when `access: "authenticated"`; omitted/`—` when `public`. On a
   * `pending-auth` row it records the role the pending principal was admitted
   * under (`platform_admin`) — the policy fork that created the pending record
   * already checked it, so the row states the truth rather than an em-dash.
   */
  roles?: Role[];
  check: AuthzCheck;
  /** object-level (ABAC) predicates; only valid when `check: "policy"`. */
  objectAttrs?: string[];
  /**
   * Fresh step-up requirement (ADR-0001 §10). Default false.
   *
   * #1304 gives it a runtime mechanism on the token-free admin tier: a `stepUp`
   * row additionally requires a server-verified MFA elevation no older than
   * {@link STEP_UP_MAX_AGE_MS} recorded on the admin session record itself — no
   * `acr` claim is read, because the 011 admin session holds no IdP token to read
   * one from. `AdminAuthorityGuard` enforces it; a missing or stale elevation is
   * 401 `STEP_UP_REQUIRED` carrying the `stepUpUrl` the operator re-elevates at.
   */
  stepUp?: boolean;
  /**
   * #1304: live IdP authority revalidation before the handler runs.
   *
   * `"live"` — this route is high-stakes (every 012 admin mutation; every
   * ADR-0009 erasure-plan approval): after the local 011 checks (dedicated
   * session, fingerprint, MFA invariant, CSRF) the guard asks the IdP whether the
   * wrapped Zitadel session, the account and the role grant are STILL good, and
   * refuses before any validation, idempotency record or upload happens. Absent /
   * `"none"` — the local session checks are the whole authorization story, which
   * is the correct posture for reads and for the auth-tier routes themselves.
   *
   * It is metadata rather than a per-controller decorator so the ONE registry the
   * matrix, the generated evidence and the runtime guard all read stays single —
   * and so `admin-revalidation-coverage.spec.ts` can assert over every discovered
   * route that no admin mutation is missing it.
   */
  revalidate?: "none" | "live";
  audit: AuthzAudit;
  /** covering EARS id(s), e.g. `["EARS-5"]` — keyed to the `it('EARS-N: …')` convention. */
  tests: string[];
}

/**
 * #1304: how fresh a server-verified MFA elevation must be for a `stepUp` route —
 * 30 minutes (ADR-0001 §10). Beyond it the elevation is stale and the operator
 * re-elevates; it is deliberately shorter than the admin session lifetime,
 * because the point of a step-up is that it is close in time to the action.
 */
export const STEP_UP_MAX_AGE_MS = 30 * 60 * 1000;

/** #1304: where an operator re-elevates when a `stepUp` route finds no fresh MFA. */
export const STEP_UP_URL = "/v1/admin/auth/mfa/verify";

/** Nest metadata key the decorator writes and the guard/gate/generator read. */
export const AUTHZ_KEY = "ds:authz";

/** Marks an unauthenticated entry point (still requires `@Authz({ access: "public", … })`). */
export const IS_PUBLIC_KEY = "ds:public";
