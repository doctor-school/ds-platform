import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AUTHZ_KEY, type AuthzMeta, type Role } from "./authz.types.js";

/** Minimal session-subject shape the guard reads off the request (populated by the 003 session guard). */
interface AuthzSubject {
  roles?: string[];
}

/**
 * Global runtime mirror of the completeness gate (spec §2 "Runtime mirror", §4).
 *
 * It reads the same `AUTHZ_KEY` metadata the gate reads and **fails closed**: a
 * handler that reaches the router with no `@Authz` metadata is denied, not
 * served — so a classification gap can never be exploited between merge and the
 * next CI run.
 *
 * SEAM — authentication & object-level policy: populating the request subject
 * (session/JWT) is the 003 BFF work (F2, #86), and OBJECT-LEVEL (ABAC) `policy`
 * evaluation — a `policy` route that declares `objectAttrs` (e.g.
 * `course.author_id == actor.id`) — is delegated to the `IPolicyEngine`
 * (ADR-0002 §3.2 / DSO-27), which is not yet wired; such a route stays
 * fail-closed until it lands.
 *
 * A `policy` route WITHOUT `objectAttrs` is a **resource-scoped domain policy**:
 * the authorization decision depends on the resource (e.g. the 006 room gate —
 * is this doctor registered for this event, is the event `live`) and is
 * evaluated by the classified handler/service against its read models, refusing
 * server-side. `policy` (not `fast-path`) records that the role alone is not
 * sufficient; the guard still enforces the role as the necessary precondition
 * and lets the handler evaluate the resource-scoped rule. The guard enforces
 * what it can fail-closed: deny unclassified, allow `public`, require a subject
 * with a matching role for `fast-path` and resource-scoped `policy`, and deny an
 * object-level `policy` (objectAttrs present) outright until DSO-27.
 */
@Injectable()
export class AuthzGuard implements CanActivate {
  constructor(private readonly reflector: Reflector = new Reflector()) {}

  canActivate(context: ExecutionContext): boolean {
    const meta = this.reflector.getAllAndOverride<AuthzMeta | undefined>(
      AUTHZ_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Fail-closed: an unclassified handler is denied.
    if (!meta) {
      throw new ForbiddenException(
        "endpoint is not classified with @Authz (fail-closed)",
      );
    }

    // `access: "public"` is the SSOT for skipping authorization here. The
    // separate `@Public()` / IS_PUBLIC_KEY flag is read by the 003 (F2)
    // authentication layer to skip the *authentication* step it adds; it is not
    // a second source for the authz decision, so it is intentionally not read
    // in this guard.
    if (meta.access === "public") return true;

    // access: authenticated — a valid session subject is required.
    const request = context.switchToHttp().getRequest<{
      user?: AuthzSubject;
      authzSubject?: AuthzSubject;
    }>();
    const subject = request?.user ?? request?.authzSubject;
    if (!subject) {
      throw new UnauthorizedException("authentication required");
    }

    if (meta.check === "policy" && (meta.objectAttrs?.length ?? 0) > 0) {
      // Object-level (ABAC) evaluation via IPolicyEngine is wired in DSO-27.
      // Fail-closed until then. A resource-scoped `policy` WITHOUT objectAttrs
      // (e.g. the 006 room gate) does not reach here — it falls through to the
      // role check below, then its handler evaluates the domain rule.
      throw new ForbiddenException(
        "object-level policy evaluation is not yet wired (DSO-27)",
      );
    }

    // fast-path (and resource-scoped `policy` without objectAttrs) — in-guard
    // RBAC role check; the role is the necessary precondition. For a
    // resource-scoped `policy` the classified handler then evaluates the domain
    // rule (registered ∧ live, …) and refuses server-side.
    const held = new Set(subject.roles ?? []);
    const required = (meta.roles ?? []) as Role[];
    if (!required.some((r) => held.has(r))) {
      throw new ForbiddenException("insufficient role");
    }
    return true;
  }
}
