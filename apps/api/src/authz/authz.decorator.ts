import { applyDecorators, SetMetadata } from "@nestjs/common";
import { AUTHZ_KEY, IS_PUBLIC_KEY, type AuthzMeta } from "./authz.types.js";

/**
 * `@Authz({...})` — the single authoring surface (Layer 1 SSOT, spec §4).
 *
 * It attaches the `AuthzMeta` classification under `AUTHZ_KEY`; the runtime
 * `AuthzGuard`, the completeness gate, and the matrix generator all read the
 * SAME metadata, so there is no second source to drift.
 *
 * Audit: the `audit` class records that a route owes a terminal audit row. For
 * auth/security events that row is emitted **explicitly** at the command site
 * (the `AuthAuditLog` port; `auth/session/auth-audit.*`), by design — their
 * subjects/reasons are heterogeneous and a generic per-route interceptor cannot
 * build them uniformly (#135, resolving #90). An `@Authz({ audit })`-driven
 * interceptor (ADR-0002 §4.8) applies only to uniform-subject resource routes.
 * Emission completeness for `high-stakes` routes is enforced by a CI guard, not
 * composed here. See authz/README.md.
 */
export function Authz(meta: AuthzMeta): MethodDecorator & ClassDecorator {
  return applyDecorators(SetMetadata(AUTHZ_KEY, meta));
}

/**
 * `@Public()` — marks an unauthenticated entry point so the guard skips
 * authentication. A `@Public()` handler MUST still carry `@Authz({ access:
 * "public", … })` (the gate fails a `@Public` handler with no `@Authz`).
 */
export function Public(): MethodDecorator & ClassDecorator {
  return SetMetadata(IS_PUBLIC_KEY, true);
}
