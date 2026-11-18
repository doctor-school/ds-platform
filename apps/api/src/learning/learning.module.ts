import { Inject, Module, type OnModuleInit } from "@nestjs/common";
import { type DrizzleHandle, learningSteps } from "@ds/db";
import {
  LearningAdminService,
  LearningDoctorService,
  LearningEventBus,
  type LearningServerDeps,
} from "@ds/learning/server";
import { withRequestAuditContext } from "../audit/audit-context.tx.js";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { PointsEngine } from "../points/engine/points-engine.service.js";
import { PointsModule } from "../points/points.module.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../storage/storage.types.js";
import { MediaSlotRegistry } from "../taxonomy/index.js";
import { TaxonomyModule } from "../taxonomy/taxonomy.module.js";
import { LearningAdminController } from "./learning.admin.controller.js";
import { LearningProblemFilter } from "./learning.errors.js";
import { LearningMeController } from "./learning.me.controller.js";
import { LearningPublicController } from "./learning.public.controller.js";

/** The `@ds/learning/server` seams wired once per process (024-design §1). */
export const LEARNING_DEPS = Symbol("LEARNING_DEPS");

/**
 * 024 — the learning path host. The logic lives in `@ds/learning/server`
 * (framework-free); this module only supplies its seams: the database, the
 * audit-attributed transaction (010), the 025 `PointsEngine` (facts recorded
 * inside the causing transaction), the 012 media signer for `download` files
 * and the in-process event bus. `TaxonomyModule` gives the shared 012
 * idempotency record, problem filter and media pipeline.
 */
@Module({
  imports: [TaxonomyModule, PointsModule],
  controllers: [
    LearningAdminController,
    LearningPublicController,
    LearningMeController,
  ],
  providers: [
    LearningProblemFilter,
    {
      provide: LEARNING_DEPS,
      inject: [DRIZZLE_DB, PointsEngine, OBJECT_STORAGE],
      useFactory: (
        db: DrizzleHandle["db"],
        points: PointsEngine,
        storage: ObjectStorage,
      ): LearningServerDeps => ({
        db,
        transaction: (fn) => withRequestAuditContext(db, fn),
        points: { record: (tx, fact) => points.record(tx, fact) },
        media: { signedUrl: (key) => storage.urlFor(key) },
        events: new LearningEventBus(),
      }),
    },
    {
      provide: LearningAdminService,
      inject: [LEARNING_DEPS],
      useFactory: (deps: LearningServerDeps) => new LearningAdminService(deps),
    },
    {
      provide: LearningDoctorService,
      inject: [LEARNING_DEPS],
      useFactory: (deps: LearningServerDeps) => new LearningDoctorService(deps),
    },
  ],
  exports: [LearningDoctorService],
})
export class LearningModule implements OnModuleInit {
  constructor(
    @Inject(MediaSlotRegistry) private readonly slots: MediaSlotRegistry,
  ) {}

  /** `learning_steps.media_ref` is a 012 media slot: both sweeps must see it before any cron runs (#3572). */
  onModuleInit(): void {
    this.slots.register(learningSteps.mediaRef);
  }
}
