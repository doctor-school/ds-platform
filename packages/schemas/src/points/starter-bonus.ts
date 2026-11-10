import { z } from "zod";

// 025 EARS-43 — body and answer of the audited starter-bonus run
// `POST /v1/admin/points/starter-bonus` (025-design §J).

/** EARS-43 — body of a starter-bonus run. */
export const RunPointsStarterBonusRequestSchema = z.strictObject({
  /** The cut-over instant of 025 EARS-43; never later than now. */
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
