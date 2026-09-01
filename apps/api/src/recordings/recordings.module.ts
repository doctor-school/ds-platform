import { Module } from "@nestjs/common";
import { TaxonomyModule } from "../taxonomy/taxonomy.module.js";
import { RecordingsAdminController } from "./recordings.admin.controller.js";
import { RecordingsPlaybackController } from "./recordings.playback.controller.js";
import { RecordingsPlaybackService } from "./recordings.playback.service.js";
import { RecordingsProjectionService } from "./recordings.projection.js";
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
  // 014 EARS-5 (#1343) adds the AUTHENTICATED playback controller beside the
  // operator's one. Same module, because it reads the same aggregate through the
  // same repository and the same EARS-3 resolver; a separate module would have
  // duplicated both to serve one route.
  controllers: [RecordingsAdminController, RecordingsPlaybackController],
  providers: [
    RecordingsRepository,
    RecordingsService,
    RecordingsProjectionService,
    RecordingsPlaybackService,
  ],
  // 014 EARS-3 (#1340): the derived projection is exported so the four §4
  // consumers (#1341/#1344/#1346/#1347) inject THIS resolver instead of each
  // re-deriving the edited-over-raw rule in its own module.
  exports: [RecordingsProjectionService],
})
export class RecordingsModule {}
