import { Inject, Injectable } from "@nestjs/common";
import {
  DOCTOR_GUEST_ROLE,
  IDP_CLIENT,
  type IdpClient,
} from "./idp/idp.types.js";
import { UserMirrorService } from "./user-mirror.service.js";

/**
 * Reconciliation sweep (EARS-19). The Zitadel Action webhook is the primary,
 * authoritative sync trigger; this sweep is the eventual-consistency backstop
 * that closes a webhook-miss divergence (ADR-0001 Consequences) by upserting a
 * mirror row — and ensuring the `doctor_guest` grant — for every Zitadel user.
 *
 * SEAM: the periodic schedule (cron via `@nestjs/schedule`) is not wired in F1;
 * `sweep()` is the unit the scheduler will call. Wiring the trigger + the deeper
 * conflict-resolution/soft-delete reconciliation is deferred (design §11) and
 * surfaced as decision-debt.
 */
@Injectable()
export class ReconcileService {
  constructor(
    @Inject(IDP_CLIENT) private readonly idp: IdpClient,
    private readonly mirror: UserMirrorService,
  ) {}

  /** Upsert every Zitadel user into the mirror; returns how many were reconciled. */
  async sweep(): Promise<{ reconciled: number }> {
    const idpUsers = await this.idp.listUsers();
    for (const u of idpUsers) {
      await this.mirror.upsert({
        zitadelSub: u.sub,
        email: u.email,
        phone: u.phone,
        emailVerified: u.emailVerified,
        phoneVerified: u.phoneVerified,
      });
      // #157: idempotently ensure the `doctor_guest` grant — the sweep is the
      // eventual-consistency backstop that closes a webhook-miss divergence, so
      // a user whose register/webhook grant never landed becomes authorized here
      // (the OIDC token's project-roles claim is the authz source the guard reads;
      // the mirror row is a downstream projection). Idempotent re-grant.
      await this.idp.grantProjectRole(u.sub, DOCTOR_GUEST_ROLE);
    }
    return { reconciled: idpUsers.length };
  }
}
