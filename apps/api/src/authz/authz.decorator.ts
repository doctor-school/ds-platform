import { applyDecorators, SetMetadata } from "@nestjs/common";
import { AUTHZ_KEY, IS_PUBLIC_KEY, type AuthzMeta } from "./authz.types.js";

/**
 * `@Authz({...})` — the single authoring surface (Layer 1 SSOT, spec §4).
 *
 * It attaches the `AuthzMeta` classification under `AUTHZ_KEY`; the runtime
 * `AuthzGuard`, the completeness gate, and the matrix generator all read the
 * SAME metadata, so there is no second source to drift.
 *
 * SEAM — audit: ADR-0002 §4.8 shows `@Authz` also composing `UseInterceptors(
 * AuditInterceptor)`. The audit subsystem (`auth_audit`) lands with 003; the
 * `audit` field already records the intent, and the interceptor is wired in here
 * when that subsystem exists. See authz/README.md.
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
