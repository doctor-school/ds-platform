import { Module } from "@nestjs/common";
import { PointsLedgerService } from "./points-ledger.service.js";

/**
 * 025 attention-points engine (025-design §1). This slice (#3807) ships the
 * ledger core only — no HTTP controller; later 025 slices add the rule book,
 * reserves, reads and corrections on top of `PointsLedgerService`.
 * `DatabaseModule` is global, so `DRIZZLE_DB` needs no import here.
 */
@Module({
  providers: [PointsLedgerService],
  exports: [PointsLedgerService],
})
export class PointsModule {}
