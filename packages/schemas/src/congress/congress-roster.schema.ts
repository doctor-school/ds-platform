import { z } from "zod";
import {
  CongressDayAttendanceSchema,
  CongressDaySchema,
} from "./congress-attendance.schema.js";

/**
 * 044 EARS-18 — the contract of the admin roster read
 * (`GET /v1/admin/events/:idOrSlug/roster`).
 *
 * The roster is the SAME in-process `eventRoster()` read model 005 owns, widened
 * from its PII-free `(doctor, event, registeredAt)` fact to the answers the
 * registrar needs at the desk (044-design §«Roster and print projections»). The
 * widening lives here rather than on `EventRosterEntrySchema` (`../events/`)
 * precisely because the two readers differ: feature 006 admits a doctor to a room
 * and must keep seeing no PII at all, while the registrar identifies a person in
 * front of them. One schema serving both would force the room gate to carry
 * participant contact data it has no business holding.
 *
 * The query below is the `AdminDataList` baseline state (`page`, `pageSize`,
 * `q`) extended by the EARS-34 presence filter and the EARS-22 sort (`sort` +
 * `dir`); per-column filtering is EARS-23 and is not declared here yet. The
 * «возможный дубль» marker is EARS-30/EARS-31 and
 * is likewise absent from the row: it already exists on the PII-free
 * `EventRosterEntry` read model, and projecting it onto THIS row is that pair's
 * own handler, not EARS-18's.
 */

/** Upper bound on the instant-search term — the same 160 the 007 admin list uses. */
export const CONGRESS_ROSTER_SEARCH_MAX = 160;

/** Roster page size ceiling: a desk screen, not an export surface. */
export const CONGRESS_ROSTER_PAGE_SIZE_MAX = 100;

/** Default roster page size. */
export const CONGRESS_ROSTER_PAGE_SIZE_DEFAULT = 20;

/**
 * 044 EARS-22 as narrowed by EARS-37 — the roster columns the sort applies to:
 * ФИО, специальность, город, телефон, дата регистрации, and присутствие on a
 * chosen congress day. № is a row counter; workplace, region, email and the
 * mail status left the table for the card and are filterable, never sortable.
 */
export const CONGRESS_ROSTER_SORT_KEYS = [
  "fullName",
  "specialty",
  "city",
  "phone",
  "registeredAt",
  "presence",
] as const;
export const CongressRosterSortKeySchema = z.enum(CONGRESS_ROSTER_SORT_KEYS);
export type CongressRosterSortKey = z.infer<typeof CongressRosterSortKeySchema>;

export const CongressRosterSortDirSchema = z.enum(["asc", "desc"]);
export type CongressRosterSortDir = z.infer<typeof CongressRosterSortDirSchema>;

/**
 * The order a query without `sort` reads — registration date ascending, the
 * order the read model has always had. A screen that shows this state omits
 * `sort`/`dir` from the URL rather than spelling the default out.
 */
export const CONGRESS_ROSTER_SORT_DEFAULT = {
  sort: "registeredAt",
  dir: "asc",
} as const satisfies {
  sort: CongressRosterSortKey;
  dir: CongressRosterSortDir;
};

/**
 * The list query, parsed from the raw query string (every value arrives as a
 * string), mirroring `EventAdminListQuerySchema`'s coercion posture.
 */
export const CongressRosterQuerySchema = z
  .object({
    /**
     * Instant search — a case-insensitive «contains» over the identifying text of
     * the row: ФИО, email, телефон, место работы, город, область, специальность —
     * and the NORMALISED contact phone (EARS-29), which is searched although it is
     * never rendered, so a digits-only term finds a formatted number. One term
     * over several columns rather than a per-column parameter, because that is
     * what the `AdminDataList` search box is (EARS-21); per-column filtering is
     * EARS-23.
     */
    q: z.string().trim().max(CONGRESS_ROSTER_SEARCH_MAX).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(CONGRESS_ROSTER_PAGE_SIZE_MAX)
      .default(CONGRESS_ROSTER_PAGE_SIZE_DEFAULT),
    /**
     * 044 EARS-34 — the presence filter: the congress day it asks about. Must be
     * one of the configured congress days; the service refuses any other date
     * (422 `CONGRESS_DAY_UNKNOWN`), because the configuration lives there.
     */
    attendanceDay: CongressDaySchema.optional(),
    /**
     * 044 EARS-34 — `marked`: rows marked present on `attendanceDay`;
     * `unmarked`: every other row (no mark, or a cleared one). Meaningless
     * without a day, so it is refused without one.
     */
    present: z.enum(["marked", "unmarked"]).optional(),
    /**
     * 044 EARS-22 — the one active sort column; absent = the
     * {@link CONGRESS_ROSTER_SORT_DEFAULT} order. Text columns order by the
     * Russian collation, empty cells last in both directions, the phone by its
     * normalised digits; every order is tie-broken by registration date and id
     * so a page boundary is stable.
     */
    sort: CongressRosterSortKeySchema.optional(),
    /** 044 EARS-22 — the direction of `sort`; absent = ascending. */
    dir: CongressRosterSortDirSchema.optional(),
  })
  .refine((q) => q.present === undefined || q.attendanceDay !== undefined, {
    message: "present requires attendanceDay",
    path: ["present"],
  })
  // EARS-37 — присутствие is a per-day column: without the day there is no
  // mark to order by, so it is refused exactly like `present`.
  .refine((q) => q.sort !== "presence" || q.attendanceDay !== undefined, {
    message: "sort=presence requires attendanceDay",
    path: ["sort"],
  });
export type CongressRosterQuery = z.infer<typeof CongressRosterQuerySchema>;

/**
 * 044 EARS-16 — every answer-derived cell is nullable. A platform-origin
 * registration carries no answers at all, so its cells fall back to the
 * account's own profile values and stay EMPTY where the profile has none; the
 * roster renders that emptiness rather than inventing a placeholder.
 */
export const CongressRosterRowSchema = z.object({
  registrationId: z.uuid(),
  /** Surname + first name + patronymic joined, or the account's display name. */
  fullName: z.string(),
  /**
   * The specialty NAME, resolved through `specialties_minzdrav` by the id the
   * answers carry (EARS-25). The reserved «Другое» row renders its own name like
   * any other, because it IS an ordinary row of that table.
   */
  specialtyName: z.string().nullable(),
  workplace: z.string().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  /** The phone exactly as the participant typed it (EARS-29), never the normalised form. */
  phone: z.string().nullable(),
  email: z.string().nullable(),
  registeredAt: z.iso.datetime(),
  /** 044 EARS-27 — the confirmation-letter outcome; `null` before any attempt. */
  confirmationMailStatus: z.enum(["sent", "failed"]).nullable(),
  /**
   * 044 EARS-34 — one entry per configured congress day, in day order; a day
   * nobody marked reads `present: false`.
   */
  attendance: z.array(CongressDayAttendanceSchema),
});
export type CongressRosterRow = z.infer<typeof CongressRosterRowSchema>;

/** The event header the roster screen and the printed sheet both title themselves with. */
export const CongressRosterEventSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  startsAt: z.iso.datetime(),
});
export type CongressRosterEvent = z.infer<typeof CongressRosterEventSchema>;

/** One roster page: the rows, the page coordinates, the total and the event header. */
export const CongressRosterListSchema = z.object({
  items: z.array(CongressRosterRowSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  /** Rows matching `q` across the WHOLE event — the pager's denominator. */
  total: z.number().int().min(0),
  event: CongressRosterEventSchema,
  /**
   * 044 EARS-34 — the configured congress days (ascending), so the screen can
   * render one attendance box per day without a second call.
   */
  congressDays: z.array(CongressDaySchema),
});
export type CongressRosterList = z.infer<typeof CongressRosterListSchema>;
