import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import {
  type DrizzleHandle,
  type EventGrantBinding,
  findEventGrant,
  listEventGrantsBySub,
  users,
} from "@ds/db";
import { eq } from "drizzle-orm";
import { DRIZZLE_DB } from "../database/database.tokens.js";

type Db = DrizzleHandle["db"];

/** The principal shape the admin session hook attaches (`AdminSessionPrincipal`'s authz half). */
export interface EventGrantSubject {
  sub: string;
  roles: string[];
}

/**
 * 044 EARS-38 (#2384) — the event-binding step of every desk route.
 *
 * `@Authz` (Layer 1) keeps the ROLE check: a desk route is a
 * `check: "policy"` row without `objectAttrs`, so `AuthzGuard` admits
 * `platform_admin` or `event-registrar` and the classified handler calls
 * {@link assertEventAccess} as the resource-scoped domain rule (044-design
 * «Authorization boundary», amendment 2026-09-25; authz/README.md «policy»).
 *
 * - `platform_admin` is not limited by any binding.
 * - `event-registrar` without an `event_role_grants` row is refused — that
 *   principal reaches nothing but the session endpoints.
 * - `event-registrar` WITH a binding is admitted only when the path's event is
 *   the bound one (by id or slug). Anything else — another event, an event that
 *   does not exist — is the same 403, so the desk learns nothing about which
 *   other events exist.
 *
 * The binding is platform data read in the request (ADR-0001 §1 hybrid RBAC):
 * the role comes from the IdP claim on the session, the event from the table.
 */
@Injectable()
export class EventGrantPolicy {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /**
   * Refuses (403) unless `subject` may work the desk of `idOrSlug`. Returns the
   * key the handler should resolve the event by: the bound event's id for a
   * registrar (so the read cannot resolve to a different row than the one the
   * check admitted), the path value unchanged for the administrator.
   */
  async assertEventAccess(
    subject: EventGrantSubject | undefined,
    idOrSlug: string,
  ): Promise<string> {
    const roles = subject?.roles ?? [];
    if (roles.includes("platform_admin")) return idOrSlug;
    if (!subject || !roles.includes("event-registrar")) {
      throw new ForbiddenException("insufficient role");
    }
    const grant = await this.registrarGrant(subject.sub);
    if (!grant) {
      throw new ForbiddenException("no event binding");
    }
    if (idOrSlug !== grant.eventId && idOrSlug !== grant.eventSlug) {
      throw new ForbiddenException("event outside the binding");
    }
    return grant.eventId;
  }

  /** Every binding the subject holds — the admin session projection (EARS-38 → EARS-20). */
  async bindingsOf(sub: string): Promise<EventGrantBinding[]> {
    return listEventGrantsBySub(this.db, sub);
  }

  private async registrarGrant(sub: string): Promise<EventGrantBinding | null> {
    const [user] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.zitadelSub, sub))
      .limit(1);
    if (!user) return null;
    return findEventGrant(this.db, user.id, "event-registrar");
  }
}
