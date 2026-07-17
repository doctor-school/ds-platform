import { Inject, Injectable } from "@nestjs/common";
import type { DrizzleHandle } from "@ds/db";
import { users } from "@ds/db";
import { eq } from "drizzle-orm";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { withRequestAuditContext } from "../audit/audit-context.tx.js";

type Db = DrizzleHandle["db"];

/**
 * Data access for the 006 self-scoped display name (design §11; ADR-0003). It
 * reads and writes the `users` mirror (003) `display_name` column KEYED ONLY on
 * the authenticated caller's Zitadel `sub` — there is no code path that accepts a
 * target user id, so a caller can only ever touch their OWN row (EARS-16, the
 * structural half of self-only exposure). No update surface exposes another
 * user's name; the read returns the caller's own name (`null` until the JIT
 * prompt runs) and nothing else.
 */
@Injectable()
export class MeRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /**
   * Read the caller's own display name by their authenticated `sub`. Returns
   * `undefined` when no 003 mirror row exists (the caller maps that to a 401 —
   * an authenticated subject with no mirror row is never silently satisfied),
   * `{ displayName: null }` when the row exists but the name is unset. Read-only.
   */
  async findDisplayNameBySub(
    sub: string,
  ): Promise<{ displayName: string | null } | undefined> {
    const [row] = await this.db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.zitadelSub, sub))
      .limit(1);
    return row;
  }

  /**
   * Read the caller's own identity projection for the 003 account-profile v1
   * self-read (EARS-27, design §12) — keyed ONLY on the authenticated `sub`,
   * like every other method here, so another user's identity fields are
   * structurally unreachable. Returns `undefined` when no 003 mirror row exists
   * (the caller maps that to a 401). Read-only: data that already exists — no
   * write on any path.
   */
  async findProfileBySub(sub: string): Promise<
    | {
        email: string | null;
        emailVerified: boolean;
        phone: string | null;
        phoneVerified: boolean;
        displayName: string | null;
      }
    | undefined
  > {
    const [row] = await this.db
      .select({
        email: users.email,
        emailVerified: users.emailVerified,
        phone: users.phone,
        phoneVerified: users.phoneVerified,
        displayName: users.displayName,
      })
      .from(users)
      .where(eq(users.zitadelSub, sub))
      .limit(1);
    return row;
  }

  /**
   * Write (overwrite is idempotent) the caller's own display name, scoped by
   * their authenticated `sub`. Returns the number of rows updated so the service
   * can distinguish "written" from "no mirror row for this subject" (→ 401) —
   * never inventing a row. The `updated_at` bump keeps the mirror's audit column
   * truthful. `displayName` arrives already trimmed + bounded by the Zod SSOT.
   */
  async setDisplayNameBySub(sub: string, displayName: string): Promise<number> {
    // 010 EARS-3/5 — attribute the self-scoped users write to the acting caller
    // (source portal-api) via the audit-context wrapper.
    const updated = await withRequestAuditContext(this.db, (tx) =>
      tx
        .update(users)
        .set({ displayName, updatedAt: new Date() })
        .where(eq(users.zitadelSub, sub))
        .returning({ id: users.id }),
    );
    return updated.length;
  }
}
