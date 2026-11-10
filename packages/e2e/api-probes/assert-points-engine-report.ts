import { readFileSync } from "node:fs";
import {
  assertPointsEngineReport,
  assertPointsRecordBoundariesReport,
  assertPointsReserveBoundariesReport,
  assertPointsAdvanceBoundariesReport,
  assertPointsReferralBoundariesReport,
  assertPointsRulebookBoundariesReport,
} from "../lib/points-engine-report.js";

const file = process.argv[2];
if (!file) throw new Error("Expected the 025 originals JSON report path");
const scope = process.argv[3];
if (
  scope &&
  scope !== "--record-boundaries" &&
  scope !== "--reserve-boundaries" &&
  scope !== "--advance-boundaries" &&
  scope !== "--referral-boundaries" &&
  scope !== "--rulebook-boundaries"
) {
  throw new Error("Unknown 025 report scope");
}
const assertReport =
  scope === "--rulebook-boundaries"
    ? assertPointsRulebookBoundariesReport
    : scope === "--referral-boundaries"
      ? assertPointsReferralBoundariesReport
      : scope === "--advance-boundaries"
        ? assertPointsAdvanceBoundariesReport
        : scope === "--reserve-boundaries"
          ? assertPointsReserveBoundariesReport
          : scope === "--record-boundaries"
            ? assertPointsRecordBoundariesReport
            : assertPointsEngineReport;
assertReport(JSON.parse(readFileSync(file, "utf8")));
console.log(
  `025: exactly ${scope ? 3 : 18} originals passed; failures/skips/flakes/retries=0/0/0/0`,
);
