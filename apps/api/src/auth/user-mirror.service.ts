import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull, ne } from "drizzle-orm";
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
 * 003 EARS-58: the phone columns a mirror upsert writes. A phone is an account
 * phone only while the IdP holds it verified, so an unverified or absent IdP
 * phone clears both columns rather than leaving a stale confirmed number.
 * `undefined` when the source carries no phone field at all (a partial
 * webhook payload): the columns are then left as they are.
 */
export function mirrorPhoneFields(
  input: MirrorUpsert,
): { phone: string | null; phoneVerified: boolean } | undefined {
  if (input.phone === undefined && input.phoneVerified === undefined) {
    return undefined;
  }
  return input.phone && input.phoneVerified === true
    ? { phone: input.phone, phoneVerified: true }
    : { phone: null, phoneVerified: false };
}

/** The `users.phone` UNIQUE constraint (migration 0001). */
const USERS_PHONE_UNIQUE = "users_phone_unique";

/**
 * 003 EARS-48/51: whether `err` (or a `cause` up its chain — drizzle wraps the
 * pg error) is a UNIQUE violation of `users.phone`, as opposed to any other
 * unique key (an email clash stays a real error).
 */
export function isPhoneUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e != null && depth < 5; depth++) {
    if (
      typeof e === "object" &&
      (e as { code?: unknown }).code === "23505" &&
      (e as { constraint?: unknown }).constraint === USERS_PHONE_UNIQUE
    ) {
      return true;
    }
    e = (e as { cause?: unknown }).cause;
  }
  return false;
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
function divergedIdentityFields(
  existing: User,
  input: MirrorUpsert,
  phone: PhoneColumns | undefined,
): string[] {
  const changed: string[] = [];
  if (
    input.email !== undefined &&
    (existing.email ?? "").toLowerCase() !== input.email.toLowerCase()
  )
    changed.push("email");
  if (phone !== undefined && (existing.phone ?? null) !== phone.phone)
    changed.push("phone");
  if (
    input.emailVerified !== undefined &&
    existing.emailVerified !== input.emailVerified
  )
    changed.push("email_verified");
  if (phone !== undefined && existing.phoneVerified !== phone.phoneVerified)
    changed.push("phone_verified");
  return changed;
}

/** The `users.phone` / `users.phone_verified` pair a mirror write sets. */
type PhoneColumns = { phone: string | null; phoneVerified: boolean };

/**
 * The phone columns a mirror write may actually set, given the row's email
 * after the write. The `users_email_or_phone` CHECK keeps an identifier on
 * every row (rows are retained, never deleted), so clearing the phone of a row
 * without an email would erase its only identifier: such a row keeps its
 * current number, unconfirmed (`phone_verified = false`, so it resolves no
 * sign-in or reset — 003 EARS-58). A row that does not exist yet and would
 * carry neither an email nor a confirmed phone has no identifier to mirror:
 * `"skip"` — it is not a mirror candidate (as the identifier-less self-heal
 * skip). `undefined` leaves the columns untouched.
 */
function retainedPhoneColumns(
  existing: User | undefined,
  email: string | null,
  phone: PhoneColumns | undefined,
): PhoneColumns | undefined | "skip" {
  if (phone === undefined || phone.phone !== null || email !== null) {
    return phone;
  }
  if (existing?.phone) return { phone: existing.phone, phoneVerified: false };
  return "skip";
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
   * `phone_verified`) are overwritten **Zitadel-wins** (the phone only as
   * {@link mirrorPhoneFields} projects it, 003 EARS-58); `role` (the local authz
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

    // `role` is intentionally NOT in the conflict `set`: a new row is granted
    // `doctor_guest` (via `values` below), but an existing row's role is
    // preserved on update so a reconcile/webhook pass never downgrades a staff
    // row back to `doctor_guest`. The staff marker is owned by the session
    // path (`setRole`, #2456), which reads the project-roles claim.
    const set: Record<string, unknown> = {
      updatedAt: new Date(),
      // Reactivation (#753): an upsert is only issued for an active Zitadel
      // user, so clearing `deactivated_at` restores a previously soft-deleted
      // row — the symmetric counterpart of `softDelete`.
      deactivatedAt: null,
    };
    if (input.email !== undefined) set["email"] = input.email;
    if (input.emailVerified !== undefined)
      set["emailVerified"] = input.emailVerified;
    const phone = mirrorPhoneFields(input);

    // The row's email after this write — the identifier the CHECK falls back on.
    const email = input.email ?? existing?.email ?? null;

    // 010 EARS-3/5 — attribute the mirror upsert to the request context when
    // present (an authenticated self-heal); a background reconcile/webhook pass
    // carries none and honestly degrades to db-direct (EARS-4).
    //
    // An existing row is UPDATEd in place: a partial payload (no email) must
    // not be proposed as an INSERT tuple, because Postgres checks that tuple
    // against `users_email_or_phone` before ON CONFLICT routes it to the
    // update. Only a row that does not exist yet goes through INSERT … ON
    // CONFLICT, which stays safe against a concurrent first insert.
    const write = async (
      wanted: PhoneColumns | undefined,
    ): Promise<{ changedIdentityFields: string[] }> => {
      const p = retainedPhoneColumns(existing, email, wanted);
      if (p === "skip") return { changedIdentityFields: [] };
      const values = p
        ? { ...set, phone: p.phone, phoneVerified: p.phoneVerified }
        : set;
      await withRequestAuditContext(this.db, (tx) =>
        existing
          ? tx
              .update(users)
              .set(values)
              .where(eq(users.zitadelSub, input.zitadelSub))
          : tx
              .insert(users)
              .values({
                zitadelSub: input.zitadelSub,
                email: input.email,
                phone: p?.phone ?? null,
                emailVerified: input.emailVerified ?? false,
                phoneVerified: p?.phoneVerified ?? false,
                role: "doctor_guest",
              })
              .onConflictDoUpdate({ target: users.zitadelSub, set: values }),
      );
      return {
        changedIdentityFields: existing
          ? divergedIdentityFields(existing, input, p)
          : [],
      };
    };
    try {
      return await write(phone);
    } catch (err) {
      // 003 EARS-48/51: a verified IdP phone another account already holds
      // confirmed (a confirmation-race loser whose IdP clean-up did not land)
      // is not this account's confirmed phone — clear it, never throw, so one
      // conflicting number cannot stall the webhook or the sweep.
      if (!phone?.phone || !isPhoneUniqueViolation(err)) throw err;
      return await write({ phone: null, phoneVerified: false });
    }
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
   * The mirror row's `role` for `zitadel_sub`, or `undefined` when there is no
   * row — one indexed probe that answers both «is it mirrored?» (EARS-26) and
   * «does the staff marker match the session?» (#2456).
   */
  async findRoleBySub(zitadelSub: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.zitadelSub, zitadelSub))
      .limit(1);
    return row?.role;
  }

  /**
   * #2456 — project the session's project-roles claim onto `users.role` (the
   * staff marker the participant counts read; see `staff-role.ts`). Written only
   * when it differs, so the steady state is write-free.
   */
  async setRole(zitadelSub: string, role: string): Promise<void> {
    await withRequestAuditContext(this.db, (tx) =>
      tx
        .update(users)
        .set({ role, updatedAt: new Date() })
        .where(and(eq(users.zitadelSub, zitadelSub), ne(users.role, role))),
    );
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
