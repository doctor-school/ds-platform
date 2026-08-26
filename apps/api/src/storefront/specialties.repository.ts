import { Inject, Injectable } from "@nestjs/common";
import { asc, eq, isNotNull, or, sql } from "drizzle-orm";
import type { DrizzleHandle, SpecialtyMinzdrav } from "@ds/db";
import { specialtiesMinzdrav } from "@ds/db";
import { CANONICAL_UUID_REGEX } from "@ds/schemas";
import { DRIZZLE_DB } from "../database/database.tokens.js";

// 017 EARS-3 (#1479) — Drizzle data access for the closed Минздрав specialty
// reference book. READ-ONLY by construction: the book is written by the
// provenance-stamped seed alone (`seedSpecialtiesMinzdrav`), so this repository
// declares no insert/update/delete path at all and needs no audit-attributed
// transaction wrapper — there is no mutating storefront path to attribute.

type Db = DrizzleHandle["db"];

@Injectable()
export class SpecialtiesRepository {
  // Explicit @Inject token — the API boots under `tsx`, which emits no
  // `design:paramtypes` (same reason as `TopicsRepository`).
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /**
   * The whole book in its catalog order: the frequent entries first in their
   * curated rank, then everything else alphabetically by the verbatim
   * nomenclature name. Ordering in SQL (not in the service) keeps the order a
   * property of the read rather than of whichever caller happens to consume it.
   */
  findAll(): Promise<SpecialtyMinzdrav[]> {
    return this.db
      .select()
      .from(specialtiesMinzdrav)
      .orderBy(
        sql`${specialtiesMinzdrav.frequentRank} asc nulls last`,
        asc(specialtiesMinzdrav.name),
      );
  }

  /** The frequent set — the ranked rows only, in rank order. */
  findFrequent(): Promise<SpecialtyMinzdrav[]> {
    return this.db
      .select()
      .from(specialtiesMinzdrav)
      .where(isNotNull(specialtiesMinzdrav.frequentRank))
      .orderBy(asc(specialtiesMinzdrav.frequentRank));
  }

  /**
   * Resolve one reference — a canonical UUID `id` or a `code` — to its row, or
   * `null` when it names no member.
   *
   * The `id` predicate is added ONLY for a reference that is a canonical UUID:
   * comparing the `uuid` column against arbitrary text is a Postgres type error,
   * and a malformed reference must produce the ordinary closed-book refusal, not
   * a 500 that would tell a caller its input reached the database.
   */
  async findByIdOrCode(reference: string): Promise<SpecialtyMinzdrav | null> {
    const byCode = eq(specialtiesMinzdrav.code, reference);
    const where = CANONICAL_UUID_REGEX.test(reference)
      ? or(eq(specialtiesMinzdrav.id, reference), byCode)
      : byCode;

    const [row] = await this.db
      .select()
      .from(specialtiesMinzdrav)
      .where(where)
      .limit(1);
    return row ?? null;
  }
}
