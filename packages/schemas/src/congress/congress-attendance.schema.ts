import { z } from "zod";

/**
 * 044 EARS-34 — the contract of the registrar's per-day attendance mark
 * (`PUT /v1/admin/events/:idOrSlug/registrations/:registrationId/attendance/:day`).
 *
 * One verb for both directions: `present: true` marks the participant present
 * on that congress day, `present: false` clears the mark. Writing the value the
 * day already holds is an idempotent no-op (200, no ledger row).
 *
 * The allowed days are deployment configuration (`CONGRESS_SIGNUP_EVENT_DAYS`),
 * so this schema checks only that `day` IS a calendar date; a date outside the
 * configured congress days is refused by the service (422
 * `CONGRESS_DAY_UNKNOWN`).
 */

/** An ISO calendar date (`YYYY-MM-DD`) — a congress day, never an instant. */
export const CongressDaySchema = z.iso.date();

/** Path parameters of the attendance route (the event key is the roster's). */
export const CongressAttendanceParamsSchema = z.object({
  registrationId: z.uuid(),
  day: CongressDaySchema,
});
export type CongressAttendanceParams = z.infer<
  typeof CongressAttendanceParamsSchema
>;

/** Body: the mark's new value. */
export const CongressAttendanceRequestSchema = z.strictObject({
  present: z.boolean(),
});
export type CongressAttendanceRequest = z.infer<
  typeof CongressAttendanceRequestSchema
>;

/** Response: the day's value after the write. */
export const CongressAttendanceResponseSchema = z.object({
  registrationId: z.uuid(),
  day: CongressDaySchema,
  present: z.boolean(),
});
export type CongressAttendanceResponse = z.infer<
  typeof CongressAttendanceResponseSchema
>;

/** One configured congress day's attendance of one roster row. */
export const CongressDayAttendanceSchema = z.object({
  day: CongressDaySchema,
  present: z.boolean(),
});
export type CongressDayAttendance = z.infer<typeof CongressDayAttendanceSchema>;

/** The machine code of the «not a congress day» refusal. */
export const CONGRESS_DAY_UNKNOWN = "CONGRESS_DAY_UNKNOWN" as const;
