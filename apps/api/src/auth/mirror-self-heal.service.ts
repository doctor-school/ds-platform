import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  DOCTOR_GUEST_ROLE,
  IDP_CLIENT,
  type IdpClient,
} from "./idp/idp.types.js";
import { UserMirrorService } from "./user-mirror.service.js";

/**
 * Read-path mirror self-heal (EARS-26, GH #709) — the third mirror-sync layer
 * (design §5): the Zitadel Action webhook is primary, the reconciliation sweep
 * (EARS-19) is the periodic backstop, and this service lazily re-materializes
 * the mirror row for a single sub **at the moment an authenticated request
 * arrives** for it. It closes the orphaned-session window the first two layers
 * leave open (webhook miss/lag with the sweep schedule unwired — #119/#220 — or
 * a mirror row lost while IdP sessions for the sub stay alive), which used to
 * bounce every mirror-backed authenticated surface into the silent
 * `/login` → `/account` carousel via the generic 401 (EARS-16) + the #697
 * auth-surface redirect.
 *
 * Invoked by `SessionAuthHook` after the session subject resolves. Semantics
 * mirror the webhook/sweep exactly: the same idempotent
 * {@link UserMirrorService.upsert} plus the idempotent `doctor_guest` re-grant
 * (#157). Enumeration safety (EARS-16) is untouched — the heal fires only for a
 * subject whose session the IdP already vouched for, never for an
 * unauthenticated caller. Fail-soft: a sub the IdP no longer knows (or an
 * identifier-less machine account — not a `doctor_guest` candidate, and the
 * `users_email_or_phone` CHECK would refuse it) heals nothing and the request
 * proceeds to today's fail-closed 401 at the mirror-backed handler; a heal
 * failure is logged, never thrown, so it cannot 500 a valid request.
 */
@Injectable()
export class MirrorSelfHealService {
  private readonly logger = new Logger(MirrorSelfHealService.name);

  // Both deps named explicitly (`@Inject`): under tsx/esbuild the emitted
  // `design:paramtypes` for a type-inferred parameter following an `@Inject`
  // one is unreliable (the constraint documented in reconcile.service.ts).
  constructor(
    @Inject(IDP_CLIENT) private readonly idp: IdpClient,
    @Inject(UserMirrorService) private readonly mirror: UserMirrorService,
  ) {}

  /**
   * Ensure a mirror row exists for the authenticated `sub`; lazily heal it from
   * the IdP when absent. Never throws.
   */
  async ensureMirrored(sub: string): Promise<void> {
    try {
      if (await this.mirror.existsBySub(sub)) return;

      const idpUser = await this.idp.getUser(sub);
      // Unknown at the IdP, or identifier-less (machine account / no
      // doctor_guest candidate — same skip as the sweep): nothing to heal.
      if (!idpUser || (!idpUser.email && !idpUser.phone)) return;

      await this.mirror.upsert({
        zitadelSub: idpUser.sub,
        email: idpUser.email,
        phone: idpUser.phone,
        emailVerified: idpUser.emailVerified,
        phoneVerified: idpUser.phoneVerified,
      });
      // #157: idempotently ensure the doctor_guest grant, exactly as the
      // webhook and the sweep do on their passes.
      await this.idp.grantProjectRole(idpUser.sub, DOCTOR_GUEST_ROLE);
      this.logger.warn(
        `mirror self-healed for orphaned session sub=${sub} (EARS-26)`,
      );
    } catch (err) {
      // Fail-soft: the request proceeds; mirror-backed handlers keep their
      // fail-closed 401 (EARS-16 semantics unchanged).
      this.logger.error(
        `mirror self-heal failed for sub=${sub}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
