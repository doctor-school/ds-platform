import { Module } from "@nestjs/common";
import { TaxonomyModule } from "../taxonomy/taxonomy.module.js";
import { RecordingsAdminController } from "./recordings.admin.controller.js";
import { RecordingsRepository } from "./recordings.repository.js";
import { RecordingsService } from "./recordings.service.js";

/**
 * 014 — retained event recordings (#1339 opens it with EARS-1/EARS-2).
 *
 * Its own module rather than a fold into `EventsModule`: 014 owns a separate
 * aggregate with a separate lifecycle, and the 007 module stays the event's own
 * authoring surface. The recording routes still hang under `/v1/admin/events/:id`
 * because that is where the operator finds them, but the code boundary follows
 * the aggregate, not the URL.
 *
 * `TaxonomyModule` is imported for the SHARED EARS-17 protocol mechanism —
 * `IdempotencyService` (one `idempotency_keys` table, one fenced record) and
 * `TaxonomyProblemFilter` (one RFC 7807 shape, one deterministic-refusal store).
 * 014 introduces neither a second idempotency service nor a second filter.
 *
 * `DatabaseModule` is `@Global`, so the repository's `DRIZZLE_DB` needs no import.
 */
@Module({
  imports: [TaxonomyModule],
  controllers: [RecordingsAdminController],
  providers: [RecordingsRepository, RecordingsService],
})
export class RecordingsModule {}
