import { assertOperationalReport } from "../api-probes/operational-report.js";

export const pointsEngineOriginals = [
  "An offline lesson earns Bre only and never a second Bre",
  "A producer fact carrying an amount is refused and writes nothing",
  "A fact no rule applies to is journaled with no effect",
] as const;

export function assertPointsEngineReport(value: unknown): void {
  assertOperationalReport(value, pointsEngineOriginals, "admin");
}
