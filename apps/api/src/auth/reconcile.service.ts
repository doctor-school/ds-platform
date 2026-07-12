import { Inject, Injectable } from "@nestjs/common";
import {
  DOCTOR_GUEST_ROLE,
  IDP_CLIENT,
  type IdpClient,
} from "./idp/idp.types.js";
import { UserMirrorService } from "./user-mirror.service.js";
import {
  AUTH_AUDIT,
  type AuthAuditLog,
} from "./session/auth-audit.types.js";

/**
 * Reconciliation sweep (EARS-19). The Zitadel Action webhook is the primary,
 * authoritative sync trigger; this sweep is the eventual-consistency backstop
 * that closes a webhook-miss divergence (ADR-0001 Consequences). The periodic
 * trigger is wired (#119): `ReconcileScheduler` registers a config-driven
 * `@nestjs/schedule` interval (`RECONCILE_SWEEP_INTERVAL_MS`) that calls
 * `sweep()`; a manual ops trigger exists as `pnpm --filter @ds/api
 * reconcile:sweep`.
 *
 * The sweep reconciles the full mirror depth (#753, design §11):
 *
 * - **Upsert + grant** every active Zitadel human user, ensuring the
 *   `doctor_guest` grant (identifier-less machine/service accounts are skipped —
 *   they are not `doctor_guest` candidates and the `users_email_or_phone` CHECK
 *   would fail the sweep closed).
 * - **Conflict resolution (Zitadel-wins).** Zitadel is the identity SoT, so the
 *   upsert overwrites the mirror's identity fields; `role`/`id`/`created_at`
 *   stay mirror-owned ({@link UserMirrorService.upsert}). When an upsert
 *   actually changes an identity field on an existing row, the sweep appends an
 *   `auth.reconcile.divergence` audit event naming only the changed field names
 *   (never the values — PII-minimal).
 * - **Soft-delete / deactivation.** A user Zitadel reports **inactive**, or one
 *   **absent** from the enumeration entirely (hard-deleted at the IdP), has its
 *   still-active mirror row soft-deleted (`deactivated_at = now()`); a
 *   deactivated user is not re-granted. The row is never hard-deleted — the
 *   audit trail and FK'd consent/registration/session rows must survive.
 * - **Reactivation.** A soft-deleted user that reappears active in Zitadel is
 *   restored (its `deactivated_at` cleared) on the next upsert — symmetric
 *   convergence in both directions.
 *
 * `deactivated_at` is a projection flag, NOT an authz gate: authz stays
 * Zitadel-token-driven, and a Zitadel-deactivated user already cannot obtain
 * tokens. Hard-purge / GDPR erasure of soft-deleted rows is out of 003 scope.
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
    // The durable audit ledger (EARS-18), shared with the session layer via the
    // `AUTH_AUDIT` binding SessionModule exports — the divergence-event sink.
    @Inject(AUTH_AUDIT) private readonly audit: AuthAuditLog,
  ) {}

  /**
   * Reconcile the mirror against Zitadel. Returns how many active users were
   * reconciled (upserted + granted) and how many mirror rows were soft-deleted
   * this pass (deactivated-in-Zitadel + absent-from-enumeration).
   */
  async sweep(): Promise<{ reconciled: number; deactivated: number }> {
    const idpUsers = await this.idp.listUsers();
    // The set of EVERY enumerated Zitadel sub, built BEFORE the machine-account
    // skip below — an absent mirror row is detected against the *complete*
    // enumeration. A machine account has no mirror row, so including its sub in
    // this set cannot false-positive the absent-row soft-delete pass.
    const enumeratedSubs = new Set(idpUsers.map((u) => u.sub));

    let reconciled = 0;
    let deactivated = 0;

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

      // Deactivated in Zitadel (#753): soft-delete the mirror row and do NOT
      // re-grant — a deactivated account must not be re-authorized.
      if (!u.active) {
        if (await this.mirror.softDelete(u.sub)) deactivated += 1;
        continue;
      }

      const { changedIdentityFields } = await this.mirror.upsert({
        zitadelSub: u.sub,
        email: u.email,
        phone: u.phone,
        emailVerified: u.emailVerified,
        phoneVerified: u.phoneVerified,
      });
      // Zitadel-wins divergence (#753): if the upsert overwrote an identity
      // field on an existing row, record it — names only, never values.
      if (changedIdentityFields.length > 0) {
        await this.audit.record({
          type: "ReconcileDivergence",
          sub: u.sub,
          fields: changedIdentityFields,
        });
      }
      // #157: idempotently ensure the `doctor_guest` grant — the sweep is the
      // eventual-consistency backstop that closes a webhook-miss divergence, so
      // a user whose register/webhook grant never landed becomes authorized here
      // (the OIDC token's project-roles claim is the authz source the guard reads;
      // the mirror row is a downstream projection). Idempotent re-grant.
      await this.idp.grantProjectRole(u.sub, DOCTOR_GUEST_ROLE);
      reconciled += 1;
    }

    // Hard-deleted in Zitadel (#753): a still-active mirror row whose sub is
    // absent from the full enumeration → soft-delete it. Read the active set
    // AFTER the loop so users just deactivated above are not re-counted.
    //
    // Guard: only run the absent-row pass on a NON-EMPTY enumeration. An empty
    // `listUsers()` result almost never means "Zitadel genuinely has zero
    // users" while the mirror holds rows — it is far more likely a failed or
    // blocked enumeration (the real adapter now throws on a non-2xx, but this is
    // belt-and-braces) — and treating it as "everyone was deleted" would wipe
    // the entire mirror. Skip the destructive pass rather than risk that.
    if (idpUsers.length > 0) {
      for (const sub of await this.mirror.listActiveSubs()) {
        if (!enumeratedSubs.has(sub) && (await this.mirror.softDelete(sub))) {
          deactivated += 1;
        }
      }
    }

    // `reconciled` counts the active human doctor identities mirrored;
    // `deactivated` counts the mirror rows soft-deleted this pass.
    return { reconciled, deactivated };
  }
}
