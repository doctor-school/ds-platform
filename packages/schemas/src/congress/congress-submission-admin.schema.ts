import { z } from "zod";

import {
  CongressSubmissionKindSchema,
  MskCalendarDaySchema,
} from "./congress-intake-settings.schema.js";
import {
  CONGRESS_SUBMISSION_STATEMENTS,
  CongressSubmissionDraftAuthorSchema,
  CongressSubmissionStatusSchema,
  type CongressSubmissionStatus,
} from "./congress-submission.schema.js";

/**
 * 046 EARS-26…EARS-28, EARS-34, EARS-35 (#2437) — the programme committee's
 * admin surface over congress submissions:
 *
 * - `GET  /v1/admin/events/:idOrSlug/congress-submissions` — the registry;
 * - `GET  /v1/admin/events/:idOrSlug/congress-submissions/:submissionId` — the card;
 * - `POST …/:submissionId/status` — the committee's status change;
 * - `POST …/:submissionId/revision-deadline` — the administrator's extension.
 *
 * Drafts never reach any of these (EARS-27): a draft is its author's alone.
 */

// ---------------------------------------------------------------------------
// The committee transitions (046-design «Status machine»)
// ---------------------------------------------------------------------------

/** The statuses the committee and the platform administrator may set (EARS-28). */
export const CONGRESS_COMMITTEE_STATUSES = [
  "in_review",
  "accepted",
  "rejected",
  "needs_revision",
] as const;
export const CongressCommitteeStatusSchema = z.enum(
  CONGRESS_COMMITTEE_STATUSES,
);
export type CongressCommitteeStatus = z.infer<
  typeof CongressCommitteeStatusSchema
>;

/**
 * The committee edges of the status machine, `from → allowed targets`. The
 * author's own moves (send, take back, withdraw, resend) are not here; a
 * `withdrawn` submission is final and offers nothing (EARS-28).
 */
export const CONGRESS_COMMITTEE_TRANSITIONS: Readonly<
  Partial<
    Record<CongressSubmissionStatus, readonly CongressCommitteeStatus[]>
  >
> = {
  submitted: ["in_review", "accepted", "rejected", "needs_revision"],
  in_review: ["accepted", "rejected", "needs_revision"],
  needs_revision: ["accepted", "rejected"],
  accepted: ["in_review"],
  rejected: ["in_review"],
};

/** Whether the committee may move a submission from `from` to `to` (EARS-28). */
export function isCongressCommitteeTransition(
  from: CongressSubmissionStatus,
  to: CongressCommitteeStatus,
): boolean {
  return CONGRESS_COMMITTEE_TRANSITIONS[from]?.includes(to) ?? false;
}

/** The statuses whose change carries the committee comment (EARS-28). */
export function congressStatusNeedsComment(
  status: CongressCommitteeStatus,
): boolean {
  return status === "rejected" || status === "needs_revision";
}

/** The committee comment bound: 1–2000 characters (EARS-28). */
export const CONGRESS_COMMITTEE_COMMENT_MAX = 2000;

/**
 * `POST …/:submissionId/status`. `expectedStatus` is the status the committee
 * member saw: the write is conditional on it, so a concurrent withdrawal is
 * never overwritten (046-design, «Withdraw races the committee»).
 */
export const CongressSubmissionStatusChangeRequestSchema = z
  .strictObject({
    status: CongressCommitteeStatusSchema,
    expectedStatus: CongressSubmissionStatusSchema,
    comment: z
      .string()
      .trim()
      .min(1)
      .max(CONGRESS_COMMITTEE_COMMENT_MAX)
      .optional(),
  })
  .refine(
    (r) => !congressStatusNeedsComment(r.status) || r.comment !== undefined,
    {
      message: "a comment of 1–2000 characters is required",
      path: ["comment"],
    },
  );
export type CongressSubmissionStatusChangeRequest = z.infer<
  typeof CongressSubmissionStatusChangeRequestSchema
>;

/**
 * `POST …/:submissionId/revision-deadline` — the new last day, a Moscow
 * calendar date (EARS-35); stored as 00:00 Moscow of the following day.
 */
export const CongressRevisionDeadlineRequestSchema = z.strictObject({
  lastDay: MskCalendarDaySchema,
});
export type CongressRevisionDeadlineRequest = z.infer<
  typeof CongressRevisionDeadlineRequestSchema
>;

/** Why a committee write was refused — each a stable code for the card's copy. */
export const CONGRESS_COMMITTEE_PROBLEM_CODES = [
  /** The status is not the one the member saw (a concurrent change won). */
  "status-conflict",
  /** The status machine has no such edge (a `withdrawn` row, for example). */
  "transition-not-allowed",
  /** EARS-35 — the submission is not `needs_revision`. */
  "not-needs-revision",
  /** EARS-35 — the new last day is not after the current one. */
  "revision-day-not-later",
  /** EARS-35 — the new last day is before today (Moscow). */
  "revision-day-in-past",
] as const;
export const CongressCommitteeProblemSchema = z.object({
  code: z.enum(CONGRESS_COMMITTEE_PROBLEM_CODES),
  params: z.record(z.string(), z.unknown()).optional(),
});
export type CongressCommitteeProblem = z.infer<
  typeof CongressCommitteeProblemSchema
>;

// ---------------------------------------------------------------------------
// The registry (EARS-27)
// ---------------------------------------------------------------------------

/** Upper bound on a search term — the roster's 160. */
export const CONGRESS_SUBMISSION_REGISTRY_SEARCH_MAX = 160;
export const CONGRESS_SUBMISSION_REGISTRY_PAGE_SIZE_MAX = 100;
export const CONGRESS_SUBMISSION_REGISTRY_PAGE_SIZE_DEFAULT = 20;

/** The sortable columns: every column except № (EARS-27). */
export const CONGRESS_SUBMISSION_REGISTRY_SORTS = [
  "kind",
  "title",
  "submitter",
  "status",
  "submittedAt",
  "updatedAt",
] as const;
export type CongressSubmissionRegistrySort =
  (typeof CONGRESS_SUBMISSION_REGISTRY_SORTS)[number];

/** The statuses the registry can list — every one but `draft` (EARS-27). */
export const CongressRegistryStatusSchema = CongressSubmissionStatusSchema.exclude(
  ["draft"],
);

/**
 * The registry query, parsed from the raw query string. Every filter composes
 * with every other and with the page (EARS-27).
 */
export const CongressSubmissionRegistryQuerySchema = z
  .object({
    /** A contains-search over the title and the author names. */
    q: z.string().trim().max(CONGRESS_SUBMISSION_REGISTRY_SEARCH_MAX).optional(),
    /** A contains-search over the submitter's full name and email. */
    submitter: z
      .string()
      .trim()
      .max(CONGRESS_SUBMISSION_REGISTRY_SEARCH_MAX)
      .optional(),
    kind: CongressSubmissionKindSchema.optional(),
    status: CongressRegistryStatusSchema.optional(),
    /** The send-date range, Moscow calendar days, both inclusive. */
    sentFrom: MskCalendarDaySchema.optional(),
    sentTo: MskCalendarDaySchema.optional(),
    sort: z.enum(CONGRESS_SUBMISSION_REGISTRY_SORTS).default("submittedAt"),
    order: z.enum(["asc", "desc"]).default("desc"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(CONGRESS_SUBMISSION_REGISTRY_PAGE_SIZE_MAX)
      .default(CONGRESS_SUBMISSION_REGISTRY_PAGE_SIZE_DEFAULT),
  })
  .refine(
    (q) =>
      q.sentFrom === undefined ||
      q.sentTo === undefined ||
      q.sentFrom <= q.sentTo,
    { message: "sentFrom must not be after sentTo", path: ["sentTo"] },
  );
export type CongressSubmissionRegistryQuery = z.infer<
  typeof CongressSubmissionRegistryQuerySchema
>;

/** The submitter as the registry and the card name them. */
export const CongressSubmitterSchema = z.object({
  /** ФИО from the 044 answers, else the account's display name. */
  fullName: z.string(),
  email: z.string().nullable(),
});

/** One registry row: №, вид, тема, подающий, статус, отправлена, изменена. */
export const CongressSubmissionRegistryRowSchema = z.object({
  id: z.uuid(),
  /** № — the row's 1-based position in the sorted, filtered listing. */
  position: z.number().int().positive(),
  kind: CongressSubmissionKindSchema,
  title: z.string(),
  submitter: CongressSubmitterSchema,
  status: CongressRegistryStatusSchema,
  submittedAt: z.iso.datetime({ offset: true }).nullable(),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type CongressSubmissionRegistryRow = z.infer<
  typeof CongressSubmissionRegistryRowSchema
>;

/** The event the registry and the card title themselves with. */
export const CongressSubmissionAdminEventSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  startsAt: z.iso.datetime({ offset: true }),
});

export const CongressSubmissionRegistrySchema = z.object({
  event: CongressSubmissionAdminEventSchema,
  rows: z.array(CongressSubmissionRegistryRowSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type CongressSubmissionRegistry = z.infer<
  typeof CongressSubmissionRegistrySchema
>;

// ---------------------------------------------------------------------------
// The card (EARS-28)
// ---------------------------------------------------------------------------

/** One status change, from the 010 change audit: who and when. */
export const CongressSubmissionHistoryEntrySchema = z.object({
  from: CongressSubmissionStatusSchema.nullable(),
  to: CongressSubmissionStatusSchema,
  at: z.iso.datetime({ offset: true }),
  /** The actor's display name, else email, else the raw IdP subject. */
  actor: z.string().nullable(),
  /** The write door the ledger recorded (`admin-ui`, `doctor-ui`, `db-direct`…). */
  source: z.string(),
});
export type CongressSubmissionHistoryEntry = z.infer<
  typeof CongressSubmissionHistoryEntrySchema
>;

export const CongressSubmissionCardSchema = z.object({
  id: z.uuid(),
  event: CongressSubmissionAdminEventSchema,
  kind: CongressSubmissionKindSchema,
  status: CongressRegistryStatusSchema,
  title: z.string(),
  authors: z.array(CongressSubmissionDraftAuthorSchema),
  body: z.record(z.string(), z.string()),
  statements: z
    .partialRecord(
      z.enum(CONGRESS_SUBMISSION_STATEMENTS),
      z.iso.datetime({ offset: true }),
    )
    .nullable(),
  /** The linked source work an abstract was created from (EARS-25). */
  derivedFrom: z
    .object({
      id: z.uuid(),
      kind: CongressSubmissionKindSchema,
      title: z.string(),
      status: CongressSubmissionStatusSchema,
    })
    .nullable(),
  committeeComment: z.string().nullable(),
  submitter: CongressSubmitterSchema.extend({
    /** The contact phone from the 044 answers, else the account's own. */
    phone: z.string().nullable(),
    /**
     * A poster's submitter age in whole years on the event start date — never
     * the birth date (EARS-19, EARS-28); `null` for other kinds or when unknown.
     */
    ageOnEventStart: z.number().int().nonnegative().nullable(),
  }),
  submittedAt: z.iso.datetime({ offset: true }).nullable(),
  statusChangedAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  /** The stored revision deadline instant (EARS-34), exclusive. */
  revisionDueAt: z.iso.datetime({ offset: true }).nullable(),
  /** Its last day, Moscow, inclusive — «до {дата}, 23:59 МСК». */
  revisionLastDay: MskCalendarDaySchema.nullable(),
  /** The outcome of the last letter (EARS-14, EARS-29, EARS-35). */
  lastLetter: z
    .object({
      kind: z.string(),
      status: z.enum(["sent", "failed"]),
      at: z.iso.datetime({ offset: true }),
    })
    .nullable(),
  /** Oldest first. */
  history: z.array(CongressSubmissionHistoryEntrySchema),
});
export type CongressSubmissionCard = z.infer<
  typeof CongressSubmissionCardSchema
>;
