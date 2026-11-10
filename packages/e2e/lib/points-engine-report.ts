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

export const pointsReferralBoundaries = [
  "Pul amounts never read as money",
  "Referral awards stop for the inviter above the monthly cap",
  "The invitee's first completed lesson counts itself for the referral",
] as const;

export const pointsRulebookBoundaries = [
  "An admin attaches a new reward to an existing fact type without a release",
  "A rule reading an undeclared or ill-typed operand is refused at publish",
  "Publishing a second stacking credit rule warns the admin",
] as const;

export const pointsEngineOriginals = [
  "An offline lesson earns Bre only and never a second Bre",
  "A producer fact carrying an amount is refused and writes nothing",
  "A fact no rule applies to is journaled with no effect",
  ...pointsRecordBoundaries,
  ...pointsReserveBoundaries,
  ...pointsAdvanceBoundaries,
  ...pointsReferralBoundaries,
  ...pointsRulebookBoundaries,
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

export function assertPointsReferralBoundariesReport(value: unknown): void {
  assertOperationalReport(value, pointsReferralBoundaries, "admin");
}

export function assertPointsRulebookBoundariesReport(value: unknown): void {
  assertOperationalReport(value, pointsRulebookBoundaries, "admin");
}
