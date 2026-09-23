import { z } from "zod";

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
 * Sorting and per-column filtering are EARS-22/EARS-23 and are deliberately NOT
 * declared here: the query below is exactly the `AdminDataList` baseline state
 * (`page`, `pageSize`, `q`) so that the later pair extends one shape instead of
 * replacing an invented one. The «возможный дубль» marker is EARS-30/EARS-31 and
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
 * The list query, parsed from the raw query string (every value arrives as a
 * string), mirroring `EventAdminListQuerySchema`'s coercion posture.
 */
export const CongressRosterQuerySchema = z.object({
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
});
export type CongressRosterList = z.infer<typeof CongressRosterListSchema>;
