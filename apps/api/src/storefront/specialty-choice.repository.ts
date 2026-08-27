import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import type { DrizzleHandle } from "@ds/db";
import { doctorSpecialties, specialtiesMinzdrav, users, withAuditContext } from "@ds/db";
import type { SpecialtyRef } from "@ds/schemas";
import { DRIZZLE_DB } from "../database/database.tokens.js";

// 017 EARS-6 / LD-1 (#1482) — Drizzle data access for the doctor ↔ specialty
// link row. Unlike its read-only `SpecialtiesRepository` sibling this repository
// WRITES, so every mutation runs through `withAuditContext`: the 010 capture
// trigger stamps the acting `sub` and the `portal-api` door onto the ledger row.
// A write outside the wrapper would still land, but would surface as
// `db-direct`/actor-NULL — i.e. an unattributed change to a doctor's targeting.

type Db = DrizzleHandle["db"];

@Injectable()
export class SpecialtyChoiceRepository {
  // Explicit @Inject token — the API boots under `tsx`, which emits no
  // `design:paramtypes`.
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /**
   * Resolve the authenticated Zitadel `sub` to the local `users.id` the link row
   * references, or `null` when no 003 mirror row exists yet.
   *
   * `null` is a real answer, not an error, and the caller maps it to a 401: a
   * token whose subject the platform has never mirrored is a caller we cannot
   * write a profile for, and inventing the row here would create a doctor
   * account as a side effect of picking a specialty.
   */
  async findDoctorIdBySub(sub: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.zitadelSub, sub))
      .limit(1);
    return row?.id ?? null;
  }

  /**
   * The doctor's standing primary specialty as a `SpecialtyRef`, or `null` when
   * the profile holds none. Joined to the book so the caller gets the row the
   * reference book actually serves — never a locally cached name that a re-seed
   * against an amended nomenclature order could have moved on from.
   */
  async findPrimary(doctorId: string): Promise<SpecialtyRef | null> {
    const [row] = await this.db
      .select({
        id: specialtiesMinzdrav.id,
        code: specialtiesMinzdrav.code,
        name: specialtiesMinzdrav.name,
        isOther: specialtiesMinzdrav.isOther,
      })
      .from(doctorSpecialties)
      .innerJoin(
        specialtiesMinzdrav,
        eq(doctorSpecialties.specialtyId, specialtiesMinzdrav.id),
      )
      .where(
        and(
          eq(doctorSpecialties.doctorId, doctorId),
          eq(doctorSpecialties.role, "primary"),
          eq(doctorSpecialties.status, "active"),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Set the doctor's primary specialty: retire whatever stands, insert the new
   * link row, in ONE transaction.
   *
   * Retire-then-insert rather than update-in-place is LD-1's history rule (see
   * the schema doc): the retired row records that this doctor WAS targeted on
   * that specialty, which an in-place update would erase. Both statements are in
   * the same transaction because the partial unique index would refuse the
   * insert while the old row is still active — the index is what makes the cap
   * an invariant rather than a promise, and this is the one ordering that
   * satisfies it.
   *
   * Idempotent by contract (017-design §7): re-choosing the SAME specialty
   * short-circuits and touches nothing at all, so a doctor who clicks their own
   * chip twice does not accumulate a retired row per click, and no audit entry
   * claims a change that did not happen.
   */
  async setPrimary(
    actorSub: string,
    doctorId: string,
    specialtyId: string,
  ): Promise<void> {
    const standing = await this.findPrimary(doctorId);
    if (standing?.id === specialtyId) return;

    await withAuditContext(
      this.db,
      { actorSub, source: "portal-api" },
      async (tx) => {
        await tx
          .update(doctorSpecialties)
          .set({
            status: "retired",
            deletedAt: sql`now()`,
            version: sql`${doctorSpecialties.version} + 1`,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(doctorSpecialties.doctorId, doctorId),
              eq(doctorSpecialties.role, "primary"),
              eq(doctorSpecialties.status, "active"),
            ),
          );

        await tx.insert(doctorSpecialties).values({
          doctorId,
          specialtyId,
          role: "primary",
          status: "active",
        });
      },
    );
  }
}
