import { Module } from "@nestjs/common";
import { TaxonomyModule } from "../taxonomy/taxonomy.module.js";
import { PointsEngine } from "./engine/points-engine.service.js";
import { PointsEventsPublisher } from "./points-events.js";
import { PointsLedgerService } from "./points-ledger.service.js";
import { PointsMeController } from "./points.me.controller.js";
import { PointsNoShowSweep } from "./points-no-show.sweep.js";
import { PointsPricesAdminController } from "./points-prices.admin.controller.js";
import { PointsPricesService } from "./points-prices.service.js";
import { PointsRulesAdminController } from "./points-rules.admin.controller.js";
import { RuleBookService } from "./rule-book.service.js";

/**
 * 025 attention-points engine (025-design §1, production amendment A). #3807
 * ships the ledger core; #3808 the rule-version table, the in-process
 * `PointsCredited` publisher and the admin rule-version publish route; #3813
 * the consumer read `GET /v1/me/points`; #3838 the universal rule engine —
 * `PointsEngine.record` over the fact-type catalog with rules as data; #3810
 * the spend slice — the price list (`PUT /v1/admin/points/prices/:itemRef`),
 * the hold effects, `quote`, the gating read and the no-show sweep.
 * `TaxonomyModule` is imported for the shared 012 admin problem filter (and
 * the `IdempotencyService` it injects); `DatabaseModule` is global, so
 * `DRIZZLE_DB` needs no import here.
 */
@Module({
  imports: [TaxonomyModule],
  controllers: [
    PointsRulesAdminController,
    PointsPricesAdminController,
    PointsMeController,
  ],
  providers: [
    PointsLedgerService,
    RuleBookService,
    PointsEventsPublisher,
    PointsEngine,
    PointsPricesService,
    PointsNoShowSweep,
  ],
  exports: [
    PointsLedgerService,
    RuleBookService,
    PointsEventsPublisher,
    PointsEngine,
  ],
})
export class PointsModule {}
