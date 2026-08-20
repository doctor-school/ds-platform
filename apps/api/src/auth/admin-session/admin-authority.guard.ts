import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  AUTHZ_KEY,
  STEP_UP_MAX_AGE_MS,
  STEP_UP_URL,
  type AuthzMeta,
} from "../../authz/authz.types.js";
import {
  IDP_CLIENT,
  type AdminAuthorityRole,
  type IdpClient,
} from "../idp/idp.types.js";
import { AdminAuthorityException } from "./admin-authority.problem.js";
import { AdminSessionService, type AdminSessionPrincipal } from "./admin-session.service.js";

/**
 * #1304 — live IdP authority revalidation and step-up freshness for the
 * high-stakes admin tier (ADR-0001 §10).
 *
 * **Why a second global guard rather than a decorator on each handler.** The AC
 * is that *no handler can bypass* revalidation. A per-controller interceptor or
 * a `await this.authority.check(req)` line at the top of each command would make
 * that a convention someone can forget on the twenty-first mutation; registered
 * as an `APP_GUARD`, it runs on every route in the app and decides from the ONE
 * `@Authz` registry the matrix, the generated evidence and `AuthzGuard` already
 * read. `admin-revalidation-coverage.spec.ts` then asserts over every discovered
 * route that no admin mutation is missing `revalidate: "live"` — so the claim is
 * structural on both halves: the metadata cannot be missing, and given the
 * metadata the check cannot be skipped.
 *
 * **Where it runs in the request.** Guards run before pipes, interceptors and the
 * handler body, so every refusal here precedes validation, the idempotency
 * reservation, any object-storage upload and any audit row — which is what makes
 * "all refusals precede claim/domain/media/audit work" a property of the
 * position rather than of twenty careful early-returns.
 *
 * **Order inside the guard is deliberate: authority outranks elevation.** The
 * live IdP verdict is taken FIRST and the step-up freshness check second, so an
 * operator whose account was disabled or whose grant was revoked is told the
 * truth (401 `ADMIN_SESSION_REQUIRED` / 403 `…_REQUIRED`) instead of being sent
 * to re-elevate a credential that no longer stands. The reverse order would end
 * in a revoked admin successfully re-doing MFA and only then being refused.
 *
 * **It reads no token.** The 011 admin session holds no IdP access or refresh
 * token by design (011 design §8), so the question "is this principal still
 * good?" is asked with the adapter's SERVICE credential over the wrapped
 * `zitadelSessionId`. Nothing new is stored, and the token-free property of the
 * session record is preserved.
 *
 * **An outage is never a denial.** {@link IdpClient.revalidateAdminAuthority}
 * never throws; a transport fault, timeout, 429, 5xx, rejected service token,
 * missing config or malformed payload arrives as `unavailable` and becomes 503
 * `IDP_REVALIDATION_UNAVAILABLE`. A `catch` that turned those into 401 would
 * silently convert a Zitadel blip into "your session expired" for every admin.
 */
@Injectable()
export class AdminAuthorityGuard implements CanActivate {
  // The `@Inject`-annotated parameter comes FIRST deliberately: tsx/esbuild (the
  // endpoint-authz lint gate's runtime) mis-emits `design:paramtypes` when a
  // type-inferred parameter precedes an `@Inject` one, which breaks DI for the
  // whole class under that runtime — the hazard `AdminSessionAuthHook` documents.
  constructor(
    @Inject(IDP_CLIENT) private readonly idp: IdpClient,
    private readonly reflector: Reflector,
    private readonly adminSessions: AdminSessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<AuthzMeta | undefined>(
      AUTHZ_KEY,
      [context.getHandler(), context.getClass()],
    );

    // An unclassified handler is not this guard's refusal to make: `AuthzGuard`
    // already denies it fail-closed. Answering here too would only make which of
    // the two guards ran first observable in the error body.
    if (!meta) return true;

    const needsRevalidation = meta.revalidate === "live";
    const needsStepUp = meta.stepUp === true;
    if (!needsRevalidation && !needsStepUp) return true;

    const request = context.switchToHttp().getRequest<{
      user?: AdminSessionPrincipal;
    }>();
    const principal = request?.user;
    // No admin principal ⇒ no session record to revalidate. `AuthzGuard` would
    // refuse this too, but the guard order between two `APP_GUARD`s is not a
    // contract, so this guard states its own precondition rather than assuming
    // the other one ran first.
    if (!principal?.sid) {
      throw new AdminAuthorityException("ADMIN_SESSION_REQUIRED");
    }

    const record = await this.adminSessions.getBySid(principal.sid);
    // The record is what carries the wrapped `zitadelSessionId` and the elevation
    // timestamp; its disappearance between the hook and here (a force-logout
    // landing mid-request) is exactly the race this tier exists to lose safely.
    if (!record) {
      throw new AdminAuthorityException("ADMIN_SESSION_REQUIRED");
    }

    if (needsRevalidation) {
      const requiredRole = requiredAuthorityRole(meta);
      const verdict = await this.idp.revalidateAdminAuthority({
        zitadelSessionId: record.zitadelSessionId,
        sub: record.sub,
        requiredRole,
      });

      switch (verdict.outcome) {
        case "inactive":
          // Session gone/expired, bound to another subject, or the account was
          // disabled — the credential itself no longer stands.
          throw new AdminAuthorityException("ADMIN_SESSION_REQUIRED");
        case "role_revoked":
          throw new AdminAuthorityException(
            requiredRole === "pd_officer"
              ? "PD_OFFICER_REQUIRED"
              : "PLATFORM_ADMIN_REQUIRED",
          );
        case "unavailable":
          throw new AdminAuthorityException("IDP_REVALIDATION_UNAVAILABLE");
        case "active":
          break;
      }
    }

    if (needsStepUp) {
      // Fail-closed on a record written before this field existed: an absent
      // elevation timestamp reads as STALE, never as "assume it was recent".
      const verifiedAtMs = record.mfaVerifiedAtMs;
      const stale =
        typeof verifiedAtMs !== "number" ||
        Date.now() - verifiedAtMs > STEP_UP_MAX_AGE_MS;
      if (stale) {
        throw new AdminAuthorityException("STEP_UP_REQUIRED", STEP_UP_URL);
      }
    }

    return true;
  }
}

/**
 * Which grant the IdP is asked about. `pd_officer` wins when the row names it,
 * because a row naming both roles is an ADR-0009 approval route whose whole
 * point is the dedicated officer grant — revalidating the broader
 * `platform_admin` there would let a stripped officer through on the strength of
 * a role the route does not actually rely on.
 *
 * The matrix validator already refuses a `revalidate: "live"` row that names
 * neither role, so the `platform_admin` fallback is reached only by rows that
 * genuinely require it.
 */
function requiredAuthorityRole(meta: AuthzMeta): AdminAuthorityRole {
  return meta.roles?.includes("pd_officer") ? "pd_officer" : "platform_admin";
}
