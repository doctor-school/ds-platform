import { Module } from "@nestjs/common";
import { TaxonomyModule } from "../taxonomy/taxonomy.module.js";
import { FeedEntriesRepository } from "./feed-entries.repository.js";
import { MaterialsAdminController } from "./materials.admin.controller.js";
import { MaterialsRepository } from "./materials.repository.js";
import { MaterialsService } from "./materials.service.js";
import { OwnMaterialsFeedSource } from "./own-materials.feed-source.js";

/**
 * 048 — the materials feed, slice 1 (#3512 opens it with the admin authoring
 * surface; the public feed and material reads follow in #3513).
 *
 * `TaxonomyModule` is imported for the SHARED 012 mechanisms, never copied
 * (Lead decision 11): `IdempotencyService` (one `idempotency_keys` record) and
 * `TaxonomyProblemFilter` (one RFC 7807 shape and deterministic-refusal store).
 * `DatabaseModule` is `@Global`, so the repositories' `DRIZZLE_DB` needs no import.
 */
@Module({
  imports: [TaxonomyModule],
  controllers: [MaterialsAdminController],
  providers: [
    MaterialsRepository,
    MaterialsService,
    FeedEntriesRepository,
    OwnMaterialsFeedSource,
  ],
})
export class MaterialsModule {}
