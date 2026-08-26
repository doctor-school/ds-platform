import { z } from "zod";

// 017 EARS-2 / LD-3 (#1480) — the scale-statistics contract (API SSOT,
// ADR-0002 §3; 017-requirements LD-3 + EARS-2, 017-design §6 row 1 + §7).
//
// ONE read returns already-computed figures plus the instant they were computed
// at. Three properties are contract, not implementation detail:
//
//   1. **Computed, never operator-typed.** Every counter is derived from a
//      platform source. No settings screen writes one of these numbers, so the
//      shape carries no provenance/override field an operator could reach.
//   2. **Bounded staleness, stated.** `computedAt` is REQUIRED — a consumer can
//      always say how old the figures are. A response that could not say would
//      let a stale number pass as fresh.
//   3. **Omission, never a placeholder zero.** Each counter is OPTIONAL. An
//      ABSENT key means "this counter has no available source right now"; its
//      neighbours still render (017-design §6, row «Hero + statistics»). `0` is
//      therefore a real, measured zero and nothing else — the two cases are
//      distinguishable on the wire, which a zero-as-placeholder would destroy.
//
// The refresh mechanism behind this contract is deliberately unspecified here
// (LD-3): a change of refresh strategy is not a change of this schema.
//
// NOTHING commercial appears in this shape. 017 forbids stating who finances a
// doctor's learning and forbids any price, cart, subscription or payment
// affordance on any 017 surface (EARS-2), so there is no rouble amount, no
// currency, no plan and no financing field here — and `strictObject` means one
// cannot be smuggled in by a producer later.

/**
 * A single scale counter: a whole, non-negative count of real things.
 *
 * Non-negative and integral because every counter is a cardinality (doctors,
 * book entries, lessons, events); a fractional or negative "scale" figure would
 * be a computation bug reaching a doctor's screen rather than a number.
 */
export const ScaleCounterSchema = z.number().int().nonnegative();
export type ScaleCounter = z.infer<typeof ScaleCounterSchema>;

/**
 * The four counters the hero renders, in the order EARS-2 names them. Exported
 * so a consumer can iterate the contract instead of re-typing the key list —
 * the same reason `SpecialtyBook.total` is the only specialty count in the
 * codebase: no surface carries its own copy of a platform figure.
 */
export const SCALE_STATISTICS_COUNTERS = [
  "doctors",
  "specialties",
  "lessons",
  "eventsPerYear",
] as const;
export type ScaleStatisticsCounter = (typeof SCALE_STATISTICS_COUNTERS)[number];

/**
 * `ScaleStatistics` — LD-3's single computed read (017-requirements §Read
 * models). Served public; identical for a guest and a signed-in doctor.
 */
export const ScaleStatisticsSchema = z.strictObject({
  /** Doctors on the platform. Omitted when the source is unavailable. */
  doctors: ScaleCounterSchema.optional(),
  /**
   * Specialties. Bound to the size of the closed Минздрав book actually served
   * by the specialty read (`SpecialtyBook.total`) — never a literal, never a
   * second count of the same table (017-design §7).
   */
  specialties: ScaleCounterSchema.optional(),
  /** Lessons. Omitted while no lesson source exists on the platform. */
  lessons: ScaleCounterSchema.optional(),
  /** Events over the trailing year. Omitted when the source is unavailable. */
  eventsPerYear: ScaleCounterSchema.optional(),
  /**
   * When the figures above were computed, ISO-8601 with an offset. Required:
   * the staleness window is part of the contract, not an optional courtesy.
   */
  computedAt: z.string().datetime({ offset: true }),
});
export type ScaleStatistics = z.infer<typeof ScaleStatisticsSchema>;

/**
 * Build the wire body from a per-counter map, DROPPING every counter that has
 * no value.
 *
 * This is the one place the omission rule is implemented, so no producer can
 * accidentally serialize `doctors: 0` for "we could not read the doctors".
 * A key whose value is `undefined` (or not a finite number) is left out of the
 * object entirely rather than emitted as `null` — `null` would be a third state
 * consumers would have to interpret, and 017-design §6 knows only two: a
 * counter renders, or it is absent.
 */
export function buildScaleStatistics(
  counters: Partial<Record<ScaleStatisticsCounter, number | undefined>>,
  computedAt: Date | string,
): ScaleStatistics {
  const body: Record<string, number | string> = {
    computedAt:
      computedAt instanceof Date ? computedAt.toISOString() : computedAt,
  };
  for (const key of SCALE_STATISTICS_COUNTERS) {
    const value = counters[key];
    if (typeof value === "number" && Number.isFinite(value)) body[key] = value;
  }
  return ScaleStatisticsSchema.parse(body);
}
