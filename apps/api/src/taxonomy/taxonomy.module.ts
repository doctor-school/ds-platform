import { Module } from "@nestjs/common";
import { ExpertsAdminController } from "./experts.admin.controller.js";
import { ExpertsRepository } from "./experts.repository.js";
import { ExpertsService } from "./experts.service.js";
import { IdempotencyService } from "./idempotency.service.js";
import { MediaCleanupService } from "./media/media-cleanup.service.js";
import { StillImageNormalizer } from "./media/still-image-normalizer.js";
import { UploadReconcileService } from "./media/upload-reconcile.service.js";
import { ProjectsAdminController } from "./projects.admin.controller.js";
import { ProjectsRepository } from "./projects.repository.js";
import { ProjectsService } from "./projects.service.js";
import { TaxonomyProblemFilter } from "./taxonomy.problem-filter.js";
import { TopicsAdminController } from "./topics.admin.controller.js";
import { TopicsRepository } from "./topics.repository.js";
import { TopicsService } from "./topics.service.js";

/**
 * 012 — Content taxonomy (#1283 EARS-1 opens it with the project vertical).
 *
 * The three shared services are deliberately module-level, not project-level:
 * `IdempotencyService` is the §6 retained-record contract, `StillImageNormalizer`
 * the §2.2 shared media component, `MediaCleanupService` the §5.1 durable cleanup
 * obligation and `UploadReconcileService` its §6 counterpart for objects a
 * never-committed request uploaded. #1284 (experts) and #1285 (topics) are wired here alongside
 * them; #1286 follows and consumes them unchanged — there is no second
 * normalizer and no second record shape. A topic touches only the idempotency
 * record: it has no media slot at all (012-design §2 ER), so the three media
 * services are simply not among its dependencies.
 *
 * `DatabaseModule` and `StorageModule` are `@Global`, so no import list is needed.
 */
@Module({
  // No `ScheduleModule.forRoot()` here: @nestjs/schedule's explorer scans the
  // WHOLE application for @Cron providers, and `AuthModule` already registers it
  // once. A second registration installs a second explorer, which re-registers
  // every cron name and aborts the boot — verified while wiring this module.
  controllers: [
    ProjectsAdminController,
    ExpertsAdminController,
    TopicsAdminController,
  ],
  providers: [
    IdempotencyService,
    StillImageNormalizer,
    MediaCleanupService,
    UploadReconcileService,
    ProjectsRepository,
    ProjectsService,
    ExpertsRepository,
    ExpertsService,
    TopicsRepository,
    TopicsService,
    // Registered as a provider (not just referenced by class in `@UseFilters`)
    // so Nest resolves its IdempotencyService dependency: the filter is what
    // fenced-stores a deterministic refusal for replay (§6 bullet 3).
    TaxonomyProblemFilter,
  ],
  exports: [
    IdempotencyService,
    StillImageNormalizer,
    MediaCleanupService,
    UploadReconcileService,
  ],
})
export class TaxonomyModule {}
