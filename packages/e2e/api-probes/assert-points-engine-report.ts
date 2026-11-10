import { readFileSync } from "node:fs";
import {
  assertPointsEngineReport,
  assertPointsRecordBoundariesReport,
  assertPointsReserveBoundariesReport,
  assertPointsAdvanceBoundariesReport,
} from "../lib/points-engine-report.js";

const file = process.argv[2];
if (!file) throw new Error("Expected the 025 originals JSON report path");
const scope = process.argv[3];
if (
  scope &&
  scope !== "--record-boundaries" &&
  scope !== "--reserve-boundaries" &&
  scope !== "--advance-boundaries"
) {
  throw new Error("Unknown 025 report scope");
}
const assertReport =
  scope === "--advance-boundaries"
    ? assertPointsAdvanceBoundariesReport
    : scope === "--reserve-boundaries"
      ? assertPointsReserveBoundariesReport
      : scope === "--record-boundaries"
        ? assertPointsRecordBoundariesReport
        : assertPointsEngineReport;
assertReport(JSON.parse(readFileSync(file, "utf8")));
console.log(
  `025: exactly ${scope ? 3 : 12} originals passed; failures/skips/flakes/retries=0/0/0/0`,
);
