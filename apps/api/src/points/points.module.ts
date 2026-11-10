import { Module } from "@nestjs/common";
import { TaxonomyModule } from "../taxonomy/taxonomy.module.js";
import { PointsEngine } from "./engine/points-engine.service.js";
import { PointsEventsPublisher } from "./points-events.js";
import { PointsLedgerService } from "./points-ledger.service.js";
import { PointsMeController } from "./points.me.controller.js";
import { PointsNoShowSweep } from "./points-no-show.sweep.js";
import { PointsPricesAdminController } from "./points-prices.admin.controller.js";
import { PointsPricesService } from "./points-prices.service.js";
import { PointsReadAdminController } from "./points-read.admin.controller.js";
import { PointsAdminReadService } from "./points-admin-read.service.js";
import { PointsRulesAdminController } from "./points-rules.admin.controller.js";
import { PointsStarterBonusAdminController } from "./points-starter-bonus.admin.controller.js";
import { PointsStarterBonusService } from "./points-starter-bonus.service.js";
import { RuleBookService } from "./rule-book.service.js";

/**
 * 025 attention-points engine (025-design §1, production amendment A). #3807
 * ships the ledger core; #3808 the rule-version table, the in-process
 * `PointsCredited` publisher and the admin rule-version publish route; #3813
 * the consumer read `GET /v1/me/points`; #3838 the universal rule engine —
 * `PointsEngine.record` over the fact-type catalog with rules as data; #3810
 * the spend slice — the price list (`PUT /v1/admin/points/prices/:itemRef`),
 * the hold effects, `quote`, the gating read and the no-show sweep; #3841 the admin read API
 * (`GET /v1/admin/points/{fact-types,rules,facts}`); #3840 the starter-bonus
 * run (`POST /v1/admin/points/starter-bonus`).
 * `TaxonomyModule` is imported for the shared 012 admin problem filter (and
 * the `IdempotencyService` it injects); `DatabaseModule` is global, so
 * `DRIZZLE_DB` needs no import here.
 */
@Module({
  imports: [TaxonomyModule],
  controllers: [
    PointsRulesAdminController,
    PointsPricesAdminController,
    PointsReadAdminController,
    PointsStarterBonusAdminController,
    PointsMeController,
  ],
  providers: [
    PointsLedgerService,
    RuleBookService,
    PointsEventsPublisher,
    PointsEngine,
    PointsPricesService,
    PointsNoShowSweep,
    PointsAdminReadService,
    PointsStarterBonusService,
  ],
  exports: [
    PointsLedgerService,
    RuleBookService,
    PointsEventsPublisher,
    PointsEngine,
  ],
})
export class PointsModule {}
