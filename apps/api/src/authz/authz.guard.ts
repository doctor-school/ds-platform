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
 * SEAM — authentication & policy: populating the request subject (session/JWT)
 * is the 003 BFF work (F2, #86) and object-level `policy` evaluation is the
 * `IPolicyEngine` (ADR-0002 §3.2 / DSO-27). Until those land, the guard enforces
 * what it can fail-closed: deny unclassified, allow `public`, require a subject
 * with a matching role for `fast-path`, and deny `policy` outright. No v1 auth
 * endpoint uses `policy` (spec §7.2), so nothing is blocked that should serve.
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

    if (meta.check === "policy") {
      // Object-level evaluation via IPolicyEngine is wired in DSO-27. Fail-closed
      // until then; the v1 auth set never reaches this branch (spec §7.2).
      throw new ForbiddenException(
        "policy-engine evaluation is not yet wired (DSO-27)",
      );
    }

    // fast-path — in-guard RBAC role check.
    const held = new Set(subject.roles ?? []);
    const required = (meta.roles ?? []) as Role[];
    if (!required.some((r) => held.has(r))) {
      throw new ForbiddenException("insufficient role");
    }
    return true;
  }
}
