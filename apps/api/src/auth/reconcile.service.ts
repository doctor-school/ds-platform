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
    // Explicit `@Inject(UserMirrorService)`: under tsx/esbuild (the standalone
    // application-context boot the manual reconcile CLI uses, and the
    // endpoint-authz lint gate) the emitted `design:paramtypes` for a
    // type-inferred parameter following an `@Inject` one is unreliable, so the
    // mirror is named rather than inferred (the constraint documented in the
    // module README / auth.service.ts).
    @Inject(UserMirrorService) private readonly mirror: UserMirrorService,
  ) {}

  /** Upsert every Zitadel user into the mirror; returns how many were reconciled. */
  async sweep(): Promise<{ reconciled: number }> {
    const idpUsers = await this.idp.listUsers();
    let reconciled = 0;
    for (const u of idpUsers) {
      // `idp.listUsers()` enumerates EVERY Zitadel user, including machine /
      // service accounts (e.g. the BFF's own service user) that have neither
      // email nor phone. The `users` mirror models human doctor identities
      // (design §5) and the DB enforces a `users_email_or_phone` CHECK
      // constraint — a machine account is not a `doctor_guest` candidate, and
      // upserting one fails the whole sweep closed. Skip the identifier-less
      // rows so the human users still reconcile (#119, surfaced live the first
      // time the sweep ran against real Zitadel via the manual trigger).
      if (!u.email && !u.phone) continue;

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
      reconciled += 1;
    }
    // `reconciled` counts the human doctor identities actually mirrored —
    // machine/service accounts skipped above are not counted.
    return { reconciled };
  }
}
