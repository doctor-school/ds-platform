import { Module } from "@nestjs/common";
import { TaxonomyModule } from "../taxonomy/taxonomy.module.js";
import { PointsEventsPublisher } from "./points-events.js";
import { PointsFactIntake } from "./points-fact-intake.service.js";
import { PointsLedgerService } from "./points-ledger.service.js";
import { PointsMeController } from "./points.me.controller.js";
import { PointsRulesAdminController } from "./points-rules.admin.controller.js";
import { RuleBookService } from "./rule-book.service.js";

/**
 * 025 attention-points engine (025-design §1). #3807 ships the ledger core;
 * #3808 the rule book, the accrual fact intake, the in-process
 * `PointsCredited` publisher and the admin rule-version publish route; #3813
 * the consumer read `GET /v1/me/points`. Later 025 slices add reserves,
 * history and corrections on top of these services.
 * `TaxonomyModule` is imported for the shared 012 admin problem filter (and
 * the `IdempotencyService` it injects); `DatabaseModule` is global, so
 * `DRIZZLE_DB` needs no import here.
 */
@Module({
  imports: [TaxonomyModule],
  controllers: [PointsRulesAdminController, PointsMeController],
  providers: [
    PointsLedgerService,
    RuleBookService,
    PointsEventsPublisher,
    PointsFactIntake,
  ],
  exports: [
    PointsLedgerService,
    RuleBookService,
    PointsEventsPublisher,
    PointsFactIntake,
  ],
})
export class PointsModule {}
