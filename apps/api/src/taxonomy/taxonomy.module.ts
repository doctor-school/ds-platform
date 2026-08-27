import { Module } from "@nestjs/common";
import { EventExpertsAdminController } from "./event-experts.admin.controller.js";
import { EventExpertsRepository } from "./event-experts.repository.js";
import { EventExpertsService } from "./event-experts.service.js";
import { EventProjectsAdminController } from "./event-projects.admin.controller.js";
import {
  EventProjectsPublicController,
  ProjectEventsPublicController,
} from "./event-projects.public.controller.js";
import { EventProjectsRepository } from "./event-projects.repository.js";
import { EventProjectsService } from "./event-projects.service.js";
import { EventTopicsAdminController } from "./event-topics.admin.controller.js";
import {
  EventTopicsPublicController,
  TopicEventsPublicController,
} from "./event-topics.public.controller.js";
import { EventTopicsRepository } from "./event-topics.repository.js";
import { EventTopicsService } from "./event-topics.service.js";
import { ExpertsAdminController } from "./experts.admin.controller.js";
import { ExpertsRepository } from "./experts.repository.js";
import { ExpertsService } from "./experts.service.js";
import { IdempotencyService } from "./idempotency.service.js";
import { LifecycleImpactService } from "./lifecycle-impact.service.js";
import { MediaCleanupService } from "./media/media-cleanup.service.js";
import { StillImageNormalizer } from "./media/still-image-normalizer.js";
import { UploadReconcileService } from "./media/upload-reconcile.service.js";
import { PartnersAdminController } from "./partners.admin.controller.js";
import { PartnersRepository } from "./partners.repository.js";
import { PartnersService } from "./partners.service.js";
import {
  ProjectCuratorAdminController,
  ProjectExpertsAdminController,
} from "./project-experts.admin.controller.js";
import {
  ExpertProjectsPublicController,
  ProjectExpertsPublicController,
} from "./project-experts.public.controller.js";
import { ProjectExpertsRepository } from "./project-experts.repository.js";
import { ProjectExpertsService } from "./project-experts.service.js";
import { ProjectPartnersAdminController } from "./project-partners.admin.controller.js";
import {
  PartnerProjectsPublicController,
  ProjectPartnersPublicController,
} from "./project-partners.public.controller.js";
import { ProjectPartnersRepository } from "./project-partners.repository.js";
import { ProjectPartnersService } from "./project-partners.service.js";
import { ProjectsAdminController } from "./projects.admin.controller.js";
import { ProjectsRepository } from "./projects.repository.js";
import { ProjectsService } from "./projects.service.js";
import { PublicProjectSummaryService } from "./public-project-summary.service.js";
import { EventSpeakersPublicController } from "./speaker-projection.public.controller.js";
import { SpeakerProjectionRepository } from "./speaker-projection.repository.js";
import { SpeakerProjectionService } from "./speaker-projection.service.js";
import { TaxonomyProblemFilter } from "./taxonomy.problem-filter.js";
import { DirectionsAdminController } from "./directions.admin.controller.js";
import { DirectionsRepository } from "./directions.repository.js";
import { DirectionsService } from "./directions.service.js";

/**
 * 012 — Content taxonomy (#1283 EARS-1 opens it with the project vertical).
 *
 * The three shared services are deliberately module-level, not project-level:
 * `IdempotencyService` is the §6 retained-record contract, `StillImageNormalizer`
 * the §2.2 shared media component, `MediaCleanupService` the §5.1 durable cleanup
 * obligation and `UploadReconcileService` its §6 counterpart for objects a
 * never-committed request uploaded. #1284 (experts) and #1285 (directions) are wired here alongside
 * them; #1286 follows and consumes them unchanged — there is no second
 * normalizer and no second record shape. A direction touches only the idempotency
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
    DirectionsAdminController,
    PartnersAdminController,
    // #1289 EARS-7 — the expert↔event JOIN surface. It lives in this module
    // rather than in `events` because its whole contract (retained lifecycle,
    // idempotency record, RFC 7807 filter) is the taxonomy one; the event side
    // contributes only the parent row it locks.
    EventExpertsAdminController,
    EventProjectsAdminController,
    // #1293 EARS-11 — the topic↔event JOIN surface, same reasoning as the two
    // above: the relationship contract is the taxonomy's, the event side
    // contributes only the parent row it locks.
    EventTopicsAdminController,
    // The §5.2 public traversals. They mount here, not in the events
    // module, because the relationship is what they read (see the file header).
    EventProjectsPublicController,
    ProjectEventsPublicController,
    // #1291 EARS-9 — the expert↔project JOIN surface, plus the curator handover
    // which sits on `admin/projects` because its subject is the PROJECT (§3.2).
    ProjectExpertsAdminController,
    ProjectCuratorAdminController,
    ProjectExpertsPublicController,
    ExpertProjectsPublicController,
    // #1292 EARS-10 — the partner↔project JOIN surface and its two §5.2 reads.
    ProjectPartnersAdminController,
    ProjectPartnersPublicController,
    PartnerProjectsPublicController,
    EventTopicsPublicController,
    TopicEventsPublicController,
    // #1290 EARS-8 — the standalone half of the canonical merged speaker
    // projection. Same reasoning: the merge policy is the taxonomy's, the
    // event contributes only the parent key.
    EventSpeakersPublicController,
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
    DirectionsRepository,
    DirectionsService,
    PartnersRepository,
    PartnersService,
    EventExpertsRepository,
    EventExpertsService,
    EventProjectsRepository,
    EventProjectsService,
    ProjectExpertsRepository,
    ProjectExpertsService,
    ProjectPartnersRepository,
    ProjectPartnersService,
    // The ONE `PublicProjectSummary` builder (#1292). Module-level rather than
    // per-vertical because EARS-6, EARS-9 and EARS-10 all emit that DTO, and a
    // copy per vertical is how `primaryPartner` goes back to being null on one
    // route while being populated on another.
    PublicProjectSummaryService,
    EventTopicsRepository,
    EventTopicsService,
    SpeakerProjectionRepository,
    SpeakerProjectionService,
    // The §3.1 preview/confirmation seam, authored once for every 012 resource
    // with a retire/restore pair (#1288 is the first adopter, #1295/#1296 next).
    LifecycleImpactService,
    // Registered as a provider (not just referenced by class in `@UseFilters`)
    // so Nest resolves its IdempotencyService dependency: the filter is what
    // fenced-stores a deterministic refusal for replay (§6 bullet 3).
    TaxonomyProblemFilter,
  ],
  exports: [
    IdempotencyService,
    // #1290 EARS-8 — exported so the 004 event page and the upcoming-broadcast
    // listing (events module) read speakers through THIS resolver. Exporting it
    // is what makes «one canonical resolver» enforceable rather than aspirational.
    SpeakerProjectionService,
    // Exported for the sibling relationship verticals (#1295 / #1296): they
    // adopt this exact envelope rather than re-deriving a token format.
    LifecycleImpactService,
    // Exported for 014's recordings module (#1339): it declares its own
    // controller, and a controller-level `@UseFilters(TaxonomyProblemFilter)`
    // is resolved from the DECLARING module's context. Exporting the existing
    // provider is what keeps 014 on ONE RFC 7807 filter instead of a copy.
    TaxonomyProblemFilter,
    StillImageNormalizer,
    MediaCleanupService,
    UploadReconcileService,
  ],
})
export class TaxonomyModule {}
