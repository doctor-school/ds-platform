import { assertOperationalReport } from "../api-probes/operational-report.js";

export const pointsRecordBoundaries = [
  "The same lesson reported from two storefronts and an offline sync accrues once",
  "A closed account accepts no posting",
  "A completed module accrues all three units once",
] as const;

export const pointsReserveBoundaries = [
  "A fourth concurrent limited-seat reserve is refused",
  "A quote equals the enforced decision and writes nothing",
  "Concurrent reserves never overdraw the balance",
] as const;

export const pointsAdvanceBoundaries = [
  "Advance covers the shortfall and later earnings settle it",
  "A doctor who arrived on a medical representative's link gets the same conditions",
  "Beyond the advance cap the event behaves as threshold",
] as const;

export const pointsEngineOriginals = [
  "An offline lesson earns Bre only and never a second Bre",
  "A producer fact carrying an amount is refused and writes nothing",
  "A fact no rule applies to is journaled with no effect",
  ...pointsRecordBoundaries,
  ...pointsReserveBoundaries,
  ...pointsAdvanceBoundaries,
] as const;

export function assertPointsEngineReport(value: unknown): void {
  assertOperationalReport(value, pointsEngineOriginals, "admin");
}

export function assertPointsRecordBoundariesReport(value: unknown): void {
  assertOperationalReport(value, pointsRecordBoundaries, "admin");
}

export function assertPointsReserveBoundariesReport(value: unknown): void {
  assertOperationalReport(value, pointsReserveBoundaries, "admin");
}

export function assertPointsAdvanceBoundariesReport(value: unknown): void {
  assertOperationalReport(value, pointsAdvanceBoundaries, "admin");
}
