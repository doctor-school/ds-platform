import { readFileSync } from "node:fs";
import {
  assertPointsEngineReport,
  assertPointsFirstReleaseReport,
  assertPointsFirstReleaseResources,
  pointsFirstRelease,
  assertPointsLifecycleBoundariesReport,
  assertPointsBackgrounds,
  pointsEngineOriginals,
  pointsLifecycleBoundaries,
  pointsRecordBoundaries,
  pointsReserveBoundaries,
  pointsAdvanceBoundaries,
  pointsReferralBoundaries,
  pointsRulebookBoundaries,
  assertPointsRecordBoundariesReport,
  assertPointsReserveBoundariesReport,
  assertPointsAdvanceBoundariesReport,
  assertPointsReferralBoundariesReport,
  assertPointsRulebookBoundariesReport,
  assertPointsRuleChangesReport,
  assertPointsRuleChangeResources,
  assertPointsEngineResources,
  pointsRuleChanges,
} from "../lib/points-engine-report.js";
import { seedChange } from "../lib/points-engine-originals.js";

const file = process.argv[2];
if (!file) throw new Error("Expected the 025 originals JSON report path");
const scope = process.argv[3];
if (
  scope &&
  scope !== "--record-boundaries" &&
  scope !== "--reserve-boundaries" &&
  scope !== "--advance-boundaries" &&
  scope !== "--referral-boundaries" &&
  scope !== "--rulebook-boundaries" &&
  scope !== "--lifecycle-boundaries" &&
  scope !== "--first-release" &&
  scope !== "--rule-changes"
) {
  throw new Error("Unknown 025 report scope");
}
const assertReport =
  scope === "--rule-changes"
    ? assertPointsRuleChangesReport
    : scope === "--first-release"
      ? assertPointsFirstReleaseReport
      : scope === "--lifecycle-boundaries"
        ? assertPointsLifecycleBoundariesReport
        : scope === "--rulebook-boundaries"
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
const titles =
  scope === "--rule-changes"
    ? pointsRuleChanges
    : scope === "--first-release"
      ? pointsFirstRelease
      : scope === "--lifecycle-boundaries"
        ? pointsLifecycleBoundaries
        : scope === "--rulebook-boundaries"
          ? pointsRulebookBoundaries
          : scope === "--referral-boundaries"
            ? pointsReferralBoundaries
            : scope === "--advance-boundaries"
              ? pointsAdvanceBoundaries
              : scope === "--reserve-boundaries"
                ? pointsReserveBoundaries
                : scope === "--record-boundaries"
                  ? pointsRecordBoundaries
                  : pointsEngineOriginals;
const log = process.env.E2E_POINTS_OPS_LOG;
if (!log)
  throw new Error("E2E_POINTS_OPS_LOG is required for Background proof");
assertPointsBackgrounds(readFileSync(log, "utf8"), titles);
if (!scope || scope === "--first-release" || scope === "--rule-changes") {
  const resources = process.env.E2E_POINTS_RESOURCE_REPORT;
  if (!resources)
    throw new Error("E2E_POINTS_RESOURCE_REPORT is required for cleanup proof");
  const resourceLog = readFileSync(resources, "utf8");
  const seeds = [
    "accrual.lesson",
    "setting.presence.share",
    "accrual.starter-bonus",
  ].map(seedChange);
  if (scope === "--first-release")
    assertPointsFirstReleaseResources(resourceLog);
  else if (scope === "--rule-changes")
    assertPointsRuleChangeResources(resourceLog, seeds);
  else assertPointsEngineResources(resourceLog, seeds);
}
console.log(
  `025: exactly ${scope ? 3 : 27} originals passed; failures/skips/flakes/retries=0/0/0/0`,
);
