import { z } from "zod";

// 025 EARS-43 — the audited starter-bonus run (025-design §J):
// `POST /v1/admin/points/starter-bonus`. Every doctor registered before
// `registeredBefore` whose points account is not closed has the fact
// `person.starter-bonus-eligible` recorded once (event id
// `starter-bonus:<personId>`); a re-run answers `duplicate`.

/** EARS-43 — body of a starter-bonus run. */
export const RunPointsStarterBonusRequestSchema = z.strictObject({
  /** Doctors whose account was created strictly before this instant; never later than now. */
  registeredBefore: z.iso.datetime({ offset: true }),
  /** Why the admin runs the grant — written to the run's audit records. */
  reason: z.string().trim().min(1).max(500),
});
export type RunPointsStarterBonusRequest = z.input<
  typeof RunPointsStarterBonusRequestSchema
>;

const count = z.number().int().min(0);

/**
 * EARS-43 — the counts of a completed run, by the outcome `record` answered
 * per doctor; `skipped` counts closed points accounts (no fact recorded).
 */
export const PointsStarterBonusRunSchema = z.strictObject({
  runId: z.uuid(),
  registeredBefore: z.iso.datetime({ offset: true }),
  applied: count,
  duplicate: count,
  noEffect: count,
  skipped: count,
});
export type PointsStarterBonusRun = z.infer<typeof PointsStarterBonusRunSchema>;
