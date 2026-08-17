import { Module } from "@nestjs/common";
import { IdempotencyService } from "./idempotency.service.js";
import { MediaCleanupService } from "./media/media-cleanup.service.js";
import { StillImageNormalizer } from "./media/still-image-normalizer.js";
import { ProjectsAdminController } from "./projects.admin.controller.js";
import { ProjectsRepository } from "./projects.repository.js";
import { ProjectsService } from "./projects.service.js";

/**
 * 012 — Content taxonomy (#1283 EARS-1 opens it with the project vertical).
 *
 * The three shared services are deliberately module-level, not project-level:
 * `IdempotencyService` is the §6 retained-record contract, `StillImageNormalizer`
 * the §2.2 shared media component and `MediaCleanupService` the §5.1 durable
 * cleanup obligation. #1284–#1286 add their controllers/services here and consume
 * all three unchanged — there is no second normalizer and no second record shape.
 *
 * `DatabaseModule` and `StorageModule` are `@Global`, so no import list is needed.
 */
@Module({
  // No `ScheduleModule.forRoot()` here: @nestjs/schedule's explorer scans the
  // WHOLE application for @Cron providers, and `AuthModule` already registers it
  // once. A second registration installs a second explorer, which re-registers
  // every cron name and aborts the boot — verified while wiring this module.
  controllers: [ProjectsAdminController],
  providers: [
    IdempotencyService,
    StillImageNormalizer,
    MediaCleanupService,
    ProjectsRepository,
    ProjectsService,
  ],
  exports: [IdempotencyService, StillImageNormalizer, MediaCleanupService],
})
export class TaxonomyModule {}
