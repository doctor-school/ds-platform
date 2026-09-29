import { z } from "zod";

import { MSK_UTC_OFFSET } from "../events/events.schema.js";

/**
 * 046 EARS-1…EARS-3 (#2432) — the congress intake settings of one event:
 * `GET` / `PUT /v1/admin/events/:id/congress-intake-settings`.
 *
 * The platform administrator edits the dates as **calendar days in
 * Europe/Moscow** (EARS-3); the platform stores instants. The conversion lives
 * here, once, so the API write path, the read projection and every later
 * surface (the cabinet section, the send check, the letters) agree on the day:
 *
 * - the opening day `D` is stored as 00:00 Moscow of `D`;
 * - a kind's last day of acceptance `L` is stored as 00:00 Moscow of `L + 1`,
 *   so the window is open through 23:59:59 Moscow time of `L`.
 */

/** The three kinds of congress material (046-design §«Data model»). */
export const CONGRESS_SUBMISSION_KINDS = [
  "oral",
  "poster",
  "abstract",
] as const;
export const CongressSubmissionKindSchema = z.enum(CONGRESS_SUBMISSION_KINDS);
export type CongressSubmissionKind = z.infer<
  typeof CongressSubmissionKindSchema
>;

/** The age-limit range the administrator may set (EARS-2). */
export const CONGRESS_MIN_AGE_LIMIT = 18;
export const CONGRESS_MAX_AGE_LIMIT = 99;

// ---------------------------------------------------------------------------
// Moscow calendar day ↔ stored instant (EARS-3)
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/** `MSK_UTC_OFFSET` (`±HH:MM`) as milliseconds — the one Moscow offset. */
const MSK_OFFSET_MS = (() => {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(MSK_UTC_OFFSET);
  if (!m) throw new RangeError(`malformed MSK_UTC_OFFSET: ${MSK_UTC_OFFSET}`);
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3])) * 60 * 1000;
})();

/** An ISO calendar date (`YYYY-MM-DD`) understood as a Moscow calendar day. */
export const MskCalendarDaySchema = z.iso.date();

/** 00:00 Moscow time of `day` — the stored opening instant of an opening day. */
export function mskDayStartInstant(day: string): Date {
  const instant = new Date(`${day}T00:00:00${MSK_UTC_OFFSET}`);
  if (
    !MskCalendarDaySchema.safeParse(day).success ||
    Number.isNaN(instant.getTime())
  ) {
    throw new RangeError(`not a calendar day: ${day}`);
  }
  return instant;
}

/**
 * 00:00 Moscow time of the day AFTER `lastDay` — the stored closing instant of a
 * last day, so the window stays open through 23:59:59 Moscow of `lastDay`.
 * Moscow keeps no seasonal time, so a day is always exactly 24 hours.
 */
export function mskClosingInstantAfterLastDay(lastDay: string): Date {
  return new Date(mskDayStartInstant(lastDay).getTime() + DAY_MS);
}

/** The Moscow calendar day an instant falls on. */
export function instantToMskDay(instant: Date): string {
  return new Date(instant.getTime() + MSK_OFFSET_MS).toISOString().slice(0, 10);
}

/** The last day a stored closing instant keeps open (the inverse of {@link mskClosingInstantAfterLastDay}). */
export function lastDayOfClosingInstant(closesAt: Date): string {
  return instantToMskDay(new Date(closesAt.getTime() - 1));
}

// ---------------------------------------------------------------------------
// The intake rules every surface shares (EARS-1)
// ---------------------------------------------------------------------------

/**
 * A kind's intake is open exactly when its opening instant is set, `now` is at
 * or after it, and `now` is before its closing instant (EARS-1).
 */
export function isCongressKindIntakeOpen(
  window: { opensAt: Date | null; closesAt: Date | null },
  now: Date,
): boolean {
  if (window.opensAt === null || window.closesAt === null) return false;
  const t = now.getTime();
  return t >= window.opensAt.getTime() && t < window.closesAt.getTime();
}

// ---------------------------------------------------------------------------
// Wire contract
// ---------------------------------------------------------------------------

/** One kind's settings as the administrator enters them (EARS-2, EARS-3). */
export const CongressKindSettingsInputSchema = z.strictObject({
  /** First day of acceptance (Moscow); `null` = not announced. */
  opensOn: MskCalendarDaySchema.nullable(),
  /** Last day of acceptance, inclusive (Moscow). */
  lastDay: MskCalendarDaySchema.nullable(),
  /** Submissions per participant; `null` = unlimited. */
  submitLimit: z.number().int().positive().nullable(),
  /** Age limit in whole years; `null` = none. */
  maxAgeYears: z
    .number()
    .int()
    .min(CONGRESS_MIN_AGE_LIMIT)
    .max(CONGRESS_MAX_AGE_LIMIT)
    .nullable(),
});
export type CongressKindSettingsInput = z.infer<
  typeof CongressKindSettingsInputSchema
>;

/** The machine codes of the two date refusals (EARS-2). */
export const CONGRESS_INTAKE_OPENING_WITHOUT_CLOSING =
  "CONGRESS_INTAKE_OPENING_WITHOUT_CLOSING" as const;
export const CONGRESS_INTAKE_CLOSING_NOT_AFTER_OPENING =
  "CONGRESS_INTAKE_CLOSING_NOT_AFTER_OPENING" as const;

/** Body of `PUT …/congress-intake-settings`: the whole settings of one event. */
export const CongressIntakeSettingsRequestSchema = z
  .strictObject({
    /** The external registration address (EARS-5 link); `null` = not set. */
    registrationUrl: z
      .url({ protocol: /^https?$/ })
      .max(2048)
      .nullable(),
    /** The first-author counting rule (EARS-24); off by default. */
    firstAuthorCounts: z.boolean(),
    kinds: z.strictObject({
      oral: CongressKindSettingsInputSchema,
      poster: CongressKindSettingsInputSchema,
      abstract: CongressKindSettingsInputSchema,
    }),
  })
  .superRefine((body, ctx) => {
    for (const kind of CONGRESS_SUBMISSION_KINDS) {
      const { opensOn, lastDay } = body.kinds[kind];
      if (opensOn !== null && lastDay === null) {
        ctx.addIssue({
          code: "custom",
          path: ["kinds", kind, "lastDay"],
          message: "Укажите последний день приёма вместе с датой открытия.",
          params: { code: CONGRESS_INTAKE_OPENING_WITHOUT_CLOSING },
        });
      }
      // Closing (lastDay + 1, 00:00) is after opening (opensOn, 00:00) exactly
      // when lastDay >= opensOn — ISO dates compare lexicographically.
      if (opensOn !== null && lastDay !== null && lastDay < opensOn) {
        ctx.addIssue({
          code: "custom",
          path: ["kinds", kind, "lastDay"],
          message: "Последний день приёма не может быть раньше даты открытия.",
          params: { code: CONGRESS_INTAKE_CLOSING_NOT_AFTER_OPENING },
        });
      }
    }
  });
export type CongressIntakeSettingsRequest = z.infer<
  typeof CongressIntakeSettingsRequestSchema
>;

/** One kind's settings as read back: the entered days plus the stored instants. */
export const CongressKindSettingsSchema =
  CongressKindSettingsInputSchema.extend({
    kind: CongressSubmissionKindSchema,
    opensAt: z.iso.datetime().nullable(),
    closesAt: z.iso.datetime().nullable(),
  });
export type CongressKindSettings = z.infer<typeof CongressKindSettingsSchema>;

/** Response of `GET` / `PUT …/congress-intake-settings`. */
export const CongressIntakeSettingsSchema = z.object({
  eventId: z.uuid(),
  /**
   * Whether the event has a settings row. `false` = the event has no congress
   * section and accepts no submission (EARS-1); the rest of the body is then
   * the product defaults the screen is prefilled with (EARS-2).
   */
  configured: z.boolean(),
  registrationUrl: z.string().nullable(),
  firstAuthorCounts: z.boolean(),
  kinds: z.object({
    oral: CongressKindSettingsSchema,
    poster: CongressKindSettingsSchema,
    abstract: CongressKindSettingsSchema,
  }),
});
export type CongressIntakeSettings = z.infer<
  typeof CongressIntakeSettingsSchema
>;

/**
 * The product defaults an event without settings is prefilled with (EARS-2):
 * abstracts limited to 3, oral and poster unlimited, poster age limit 40,
 * first-author rule off, no dates.
 */
export const CONGRESS_INTAKE_DEFAULTS: CongressIntakeSettingsRequest = {
  registrationUrl: null,
  firstAuthorCounts: false,
  kinds: {
    oral: {
      opensOn: null,
      lastDay: null,
      submitLimit: null,
      maxAgeYears: null,
    },
    poster: {
      opensOn: null,
      lastDay: null,
      submitLimit: null,
      maxAgeYears: 40,
    },
    abstract: {
      opensOn: null,
      lastDay: null,
      submitLimit: 3,
      maxAgeYears: null,
    },
  },
};
