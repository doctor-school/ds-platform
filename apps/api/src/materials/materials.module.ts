import { Inject, Module, type OnModuleInit } from "@nestjs/common";
import { feedEntries, materials } from "@ds/db";
import { MediaSlotRegistry } from "../taxonomy/index.js";
import { TaxonomyModule } from "../taxonomy/taxonomy.module.js";
import { FeedEntriesRepository } from "./feed-entries.repository.js";
import { MaterialsAdminController } from "./materials.admin.controller.js";
import { MaterialsRepository } from "./materials.repository.js";
import { MaterialsService } from "./materials.service.js";
import { PublicFeedController } from "./public-feed.controller.js";
import { PublicMaterialsController } from "./public-materials.controller.js";
import { MaterialsPublicReadsService } from "./public-reads.service.js";
import { OwnMaterialsFeedSource } from "./own-materials.feed-source.js";

/**
 * 048 — the materials feed, slice 1 (#3512 opens it with the admin authoring
 * surface; #3513 adds the anonymous feed and material reads).
 *
 * `TaxonomyModule` is imported for the SHARED 012 mechanisms, never copied
 * (Lead decision 11): `IdempotencyService` (one `idempotency_keys` record),
 * `TaxonomyProblemFilter` (one RFC 7807 shape and deterministic-refusal store)
 * and the 012 media pipeline the cover rides (`StillImageNormalizer`,
 * `MediaCleanupService`, `MediaSlotRegistry`). `DatabaseModule` is `@Global`,
 * so the repositories' `DRIZZLE_DB` needs no import.
 */
@Module({
  imports: [TaxonomyModule],
  controllers: [
    MaterialsAdminController,
    PublicFeedController,
    PublicMaterialsController,
  ],
  providers: [
    MaterialsRepository,
    MaterialsService,
    FeedEntriesRepository,
    OwnMaterialsFeedSource,
    MaterialsPublicReadsService,
  ],
})
export class MaterialsModule implements OnModuleInit {
  constructor(
    @Inject(MediaSlotRegistry) private readonly slots: MediaSlotRegistry,
  ) {}

  /**
   * `materials.cover_ref` and `feed_entries.image_ref` (the card's copy of the
   * same cover key) are media slots of both 012 sweeps: registered before any
   * cron runs (crons start after every `onModuleInit`), so neither the cleanup
   * worker nor the upload reconciler ever deletes a cover a row still
   * references (#3572).
   */
  onModuleInit(): void {
    this.slots.register(materials.coverRef, feedEntries.imageRef);
  }
}
