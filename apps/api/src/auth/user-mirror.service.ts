import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { users, type DrizzleHandle, type User } from "@ds/db";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { withRequestAuditContext } from "../audit/audit-context.tx.js";

type Db = DrizzleHandle["db"];

/** Fields a mirror upsert may set; identifiers/flags are optional per source. */
export interface MirrorUpsert {
  zitadelSub: string;
  email?: string | undefined;
  phone?: string | undefined;
  emailVerified?: boolean | undefined;
  phoneVerified?: boolean | undefined;
}

/**
 * Which Zitadel-owned identity fields (`email`, `phone`, `email_verified`,
 * `phone_verified` — design §5, ADR-0001) the incoming upsert changes relative
 * to the current mirror row: the reconcile-divergence signal (#753). `role`,
 * `id`, `created_at`, and `deactivated_at` are mirror-owned and are NOT compared.
 * Only fields the source actually provides are compared; email is compared
 * case-insensitively (the column is `citext`, so a case-only delta is not a real
 * divergence). Returns the canonical column names (not the values — PII-minimal).
 */
function divergedIdentityFields(existing: User, input: MirrorUpsert): string[] {
  const changed: string[] = [];
  if (
    input.email !== undefined &&
    (existing.email ?? "").toLowerCase() !== input.email.toLowerCase()
  )
    changed.push("email");
  if (input.phone !== undefined && (existing.phone ?? null) !== input.phone)
    changed.push("phone");
  if (
    input.emailVerified !== undefined &&
    existing.emailVerified !== input.emailVerified
  )
    changed.push("email_verified");
  if (
    input.phoneVerified !== undefined &&
    existing.phoneVerified !== input.phoneVerified
  )
    changed.push("phone_verified");
  return changed;
}

/**
 * Owns the backend `doctor_guest` mirror row (design §5). Zitadel owns the
 * credential; this service owns the domain projection keyed by `zitadel_sub`.
 *
 * Used by the webhook and the reconciliation sweep (EARS-19) for idempotent
 * upserts, and by verification (EARS-3/4) to flip the verified flags. The
 * registration cascade (EARS-1/2) inserts its row inside its own transaction
 * (AuthService) because it must be atomic with consent capture (EARS-20).
 */
@Injectable()
export class UserMirrorService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /**
   * Idempotently upsert a mirror row by `zitadel_sub`, always ensuring the
   * `doctor_guest` grant. Verified flags are only written when the source
   * provides them, so a reconcile/webhook pass never clobbers a true flag with
   * a default false.
   *
   * **Conflict-resolution policy (#753, design §11).** Zitadel is the identity
   * SoT, so the identity fields (`email`, `phone`, `email_verified`,
   * `phone_verified`) are overwritten **Zitadel-wins**; `role` (the local authz
   * projection), `id`, and `created_at` are **mirror-owned** and preserved.
   * `deactivated_at` is cleared to null on every upsert — the caller only
   * upserts a user Zitadel currently reports **active**, so an upsert is the
   * reactivation of any prior soft-delete (symmetric with {@link softDelete}).
   *
   * Returns the identity fields that actually **diverged** (changed on an
   * existing row): the caller (the reconcile sweep) audits a non-empty result
   * as `auth.reconcile.divergence`. A brand-new row and a no-op pass both return
   * `[]` — no divergence event.
   */
  async upsert(
    input: MirrorUpsert,
  ): Promise<{ changedIdentityFields: string[] }> {
    // Read the current row FIRST so we can (a) detect identity divergence and
    // (b) distinguish a brand-new row (no event) from an updated one.
    const [existing] = await this.db
      .select()
      .from(users)
      .where(eq(users.zitadelSub, input.zitadelSub))
      .limit(1);

    const changedIdentityFields = existing
      ? divergedIdentityFields(existing, input)
      : [];

    // `role` is intentionally NOT in the conflict `set`: a new row is granted
    // `doctor_guest` (via `values` below), but an existing row's role is
    // preserved on update so a reconcile/webhook pass never downgrades a future
    // elevated role back to `doctor_guest`. F1 only has `doctor_guest`, so this
    // is a forward-looking seam, not a behaviour change today.
    const set: Record<string, unknown> = {
      updatedAt: new Date(),
      // Reactivation (#753): an upsert is only issued for an active Zitadel
      // user, so clearing `deactivated_at` restores a previously soft-deleted
      // row — the symmetric counterpart of `softDelete`.
      deactivatedAt: null,
    };
    if (input.email !== undefined) set["email"] = input.email;
    if (input.phone !== undefined) set["phone"] = input.phone;
    if (input.emailVerified !== undefined)
      set["emailVerified"] = input.emailVerified;
    if (input.phoneVerified !== undefined)
      set["phoneVerified"] = input.phoneVerified;

    // 010 EARS-3/5 — attribute the mirror upsert to the request context when
    // present (an authenticated self-heal); a background reconcile/webhook pass
    // carries none and honestly degrades to db-direct (EARS-4).
    await withRequestAuditContext(this.db, (tx) =>
      tx
        .insert(users)
        .values({
          zitadelSub: input.zitadelSub,
          email: input.email,
          phone: input.phone,
          emailVerified: input.emailVerified ?? false,
          phoneVerified: input.phoneVerified ?? false,
          role: "doctor_guest",
        })
        .onConflictDoUpdate({ target: users.zitadelSub, set }),
    );

    return { changedIdentityFields };
  }

  /**
   * Soft-delete the mirror row for `zitadel_sub` (#753): set `deactivated_at =
   * now()`. The row is NEVER hard-deleted (the audit trail and the FK'd consent/
   * registration/session rows must survive, and the `users_email_or_phone` CHECK
   * requires identifiers to persist). Idempotent and count-safe: only a
   * currently-active row (`deactivated_at IS NULL`) is touched, so re-sweeping an
   * already-deactivated user is a no-op. Resolves `true` iff a row was actually
   * deactivated by this call.
   */
  async softDelete(zitadelSub: string): Promise<boolean> {
    // 010 EARS-3/5 — the reconcile sweep runs context-less (db-direct); wrapped
    // for uniformity so a request-context caller would be attributed.
    const rows = await withRequestAuditContext(this.db, (tx) =>
      tx
        .update(users)
        .set({ deactivatedAt: new Date(), updatedAt: new Date() })
        .where(
          and(eq(users.zitadelSub, zitadelSub), isNull(users.deactivatedAt)),
        )
        .returning({ id: users.id }),
    );
    return rows.length > 0;
  }

  /**
   * The `zitadel_sub` of every **active** mirror row (`deactivated_at IS NULL`)
   * — the reconcile sweep intersects this with the current Zitadel enumeration
   * to find rows for users that were hard-deleted at the IdP (present in the
   * mirror, absent from Zitadel) and soft-deletes them (#753).
   */
  async listActiveSubs(): Promise<string[]> {
    const rows = await this.db
      .select({ sub: users.zitadelSub })
      .from(users)
      .where(isNull(users.deactivatedAt));
    return rows.map((r) => r.sub);
  }

  /**
   * EARS-26 (#709): does a mirror row exist for `zitadel_sub`? The read-path
   * self-heal's presence probe — a single indexed lookup on the unique
   * `zitadel_sub` key, run per authenticated request by the session auth hook.
   */
  async existsBySub(zitadelSub: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.zitadelSub, zitadelSub))
      .limit(1);
    return row !== undefined;
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return row;
  }

  async findByPhone(phone: string): Promise<User | undefined> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.phone, phone))
      .limit(1);
    return row;
  }

  async markEmailVerified(zitadelSub: string): Promise<void> {
    // 010 EARS-3/5 — attribute the verified-flag flip to the request context.
    await withRequestAuditContext(this.db, (tx) =>
      tx
        .update(users)
        .set({ emailVerified: true, updatedAt: new Date() })
        .where(eq(users.zitadelSub, zitadelSub)),
    );
  }

  async markPhoneVerified(zitadelSub: string): Promise<void> {
    // 010 EARS-3/5 — attribute the verified-flag flip to the request context.
    await withRequestAuditContext(this.db, (tx) =>
      tx
        .update(users)
        .set({ phoneVerified: true, updatedAt: new Date() })
        .where(eq(users.zitadelSub, zitadelSub)),
    );
  }
}
