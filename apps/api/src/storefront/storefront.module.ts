import { Inject, Logger, Module, type OnModuleInit } from "@nestjs/common";
import { sql } from "drizzle-orm";
import {
  buildSpecialtyBookSeed,
  type DrizzleHandle,
  seedSpecialtiesMinzdrav,
} from "@ds/db";
import { isRouteScan } from "../authz/route-scan.js";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { SpecialtiesPublicController } from "./specialties.public.controller.js";
import { SpecialtyProblemFilter } from "./specialties.problem-filter.js";
import { SpecialtiesRepository } from "./specialties.repository.js";
import { SpecialtiesService } from "./specialties.service.js";
import { StatisticsPublicController } from "./statistics.public.controller.js";
import { StatisticsRepository } from "./statistics.repository.js";
import { StatisticsService } from "./statistics.service.js";

/**
 * 017 — the doctor-storefront module (#1479 opens it with EARS-3: the closed
 * Минздрав specialty reference book and its public read).
 *
 * `DatabaseModule` is `@Global`, so no import list is needed.
 *
 * ## Why the book is seeded at boot, not by a data migration
 *
 * The book's content is owned by the provenance-stamped TS data file
 * (`packages/db/src/seed/specialties-minzdrav.data.ts`), which is what the
 * nomenclature order is transcribed into and what every derived count reads. A
 * hand-written SQL data migration would fork that into a SECOND copy of the same
 * 119 rows, and the two would drift the first time an amended order is
 * transcribed — the migration is immutable once applied, the data file is not.
 * Re-running the idempotent upsert on every boot means the deployed book is,
 * always, exactly the committed data file: 017-design §2's "re-seeded when the
 * order changes" needs no separate deploy step and no drift test.
 *
 * The seed is a boot PRECONDITION, not best-effort: if it cannot run, the
 * process must not start serving a partial book that a doctor would be asked to
 * choose from. So the failure is logged and rethrown.
 */
@Module({
  controllers: [SpecialtiesPublicController, StatisticsPublicController],
  providers: [
    SpecialtiesRepository,
    SpecialtiesService,
    StatisticsRepository,
    StatisticsService,
    // Registered as a provider (not merely referenced in `@UseFilters`) so Nest
    // owns its lifecycle in this module's context.
    SpecialtyProblemFilter,
  ],
  // Exported for the later 017 verticals (#1481/#1482): the choose-specialty
  // handler consumes THIS membership mechanism rather than re-deriving one.
  exports: [SpecialtiesService, StatisticsService],
})
export class StorefrontModule implements OnModuleInit {
  private readonly logger = new Logger(StorefrontModule.name);

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleHandle["db"],
    @Inject(StatisticsService) private readonly statistics: StatisticsService,
  ) {}

  async onModuleInit(): Promise<void> {
    // The endpoint-authz completeness gate boots this exact graph to enumerate
    // routes, with placeholder credentials and no database. Seeding there would
    // make a BLOCK-severity CI gate require a live Postgres — and so would
    // warming the statistics projection, which is why both start below the
    // guard.
    if (isRouteScan()) return;

    // LD-3: the scale counters are refreshed off the request path. Starting the
    // loop at boot means the first home-page visitor is served from a warm
    // snapshot rather than paying for the aggregates.
    this.statistics.start();

    const rows = buildSpecialtyBookSeed();
    try {
      await this.db.transaction(async (tx) => {
        // Every replica boots this same seed. The advisory lock is transaction
        // scoped, so it is released with the commit and no explicit unlock can
        // be missed: concurrent boots serialize on it instead of interleaving
        // their upserts and deadlocking on the `code` unique index. Rows go in
        // as ONE statement in the seed's deterministic order, so the lock is
        // held for a single round trip.
        await tx.execute(
          sql`select pg_advisory_xact_lock(${SPECIALTY_BOOK_SEED_LOCK})`,
        );
        await seedSpecialtiesMinzdrav(tx, rows);
      });
      this.logger.log(
        `specialty reference book seeded (${rows.length} entries)`,
      );
    } catch (error) {
      this.logger.error(
        "specialty reference book seed failed — refusing to serve a partial book",
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }
}

/**
 * The advisory-lock key for the specialty-book seed. An arbitrary but STABLE
 * constant reserved for this seed alone — `pg_advisory_xact_lock` shares one
 * global key space, so it must never collide with another feature's lock.
 */
const SPECIALTY_BOOK_SEED_LOCK = 1_701_017_003;
