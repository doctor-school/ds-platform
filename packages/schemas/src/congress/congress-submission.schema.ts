import { z } from "zod";

import { CONGRESS_SUBMISSION_CONSENT_PURPOSES } from "./congress-consent.js";
import {
  CongressSubmissionKindSchema,
  type CongressSubmissionKind,
  isCongressKindIntakeOpen,
  MskCalendarDaySchema,
} from "./congress-intake-settings.schema.js";
import { normaliseNameAnswer } from "./name-answer.js";

/**
 * 046 EARS-4…EARS-17 (#2433) — the author's congress submissions:
 * `/v1/me/congress-submissions*`.
 *
 * One contract for the API, the cabinet section (`@ds/congress-submissions`)
 * and the letters: the field limits, the length rule, the status set, the
 * counted statuses of the limit and the refusal problem codes live here once
 * (046-design «Field set and limits», «Status machine», «Send cascade»).
 */

// ---------------------------------------------------------------------------
// Statuses (046-design «Status machine»)
// ---------------------------------------------------------------------------

export const CONGRESS_SUBMISSION_STATUSES = [
  "draft",
  "submitted",
  "in_review",
  "accepted",
  "rejected",
  "needs_revision",
  "withdrawn",
] as const;
export const CongressSubmissionStatusSchema = z.enum(
  CONGRESS_SUBMISSION_STATUSES,
);
export type CongressSubmissionStatus = z.infer<
  typeof CongressSubmissionStatusSchema
>;

/**
 * EARS-17 — every submission ever sent and not back in `draft` counts toward
 * its kind's limit, `rejected` and `withdrawn` included.
 */
export function countsTowardCongressLimit(
  status: CongressSubmissionStatus,
): boolean {
  return status !== "draft";
}

// ---------------------------------------------------------------------------
// Field limits and the length rule (046-design «Field set and limits»)
// ---------------------------------------------------------------------------

export const CONGRESS_SUBMISSION_LIMITS = {
  title: 300,
  authorsMax: 20,
  name: 100,
  workplace: 300,
  oralGoal: 1000,
  oralSummary: 3000,
  posterGoal: 1000,
  posterContent: 3000,
} as const;

/**
 * The one length rule: Unicode code points after trimming surrounding
 * whitespace, with `\r\n` counted as one line break.
 */
export function congressTextLength(value: string): number {
  return [...normaliseText(value)].length;
}

function normaliseText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

/** Draft text: type and maximum length only (EARS-7). */
const draftText = (max: number) =>
  z
    .string()
    .refine((v) => congressTextLength(v) <= max, { message: `max ${max}` });

/** Send text: 1…max after trimming, stored trimmed (EARS-8). */
const requiredText = (max: number) =>
  z
    .string()
    .refine(
      (v) => {
        const n = congressTextLength(v);
        return n >= 1 && n <= max;
      },
      { message: `1…${max}` },
    )
    .transform(normaliseText);

/** A name part at send: 1…100, normalised by the 044 EARS-33 rule (EARS-8). */
const requiredName = requiredText(CONGRESS_SUBMISSION_LIMITS.name).transform(
  normaliseNameAnswer,
);

// ---------------------------------------------------------------------------
// Authors
// ---------------------------------------------------------------------------

/** An author as a draft holds it — every part optional (EARS-7). */
export const CongressSubmissionDraftAuthorSchema = z.strictObject({
  surname: draftText(CONGRESS_SUBMISSION_LIMITS.name).optional(),
  firstName: draftText(CONGRESS_SUBMISSION_LIMITS.name).optional(),
  patronymic: draftText(CONGRESS_SUBMISSION_LIMITS.name).optional(),
  workplace: draftText(CONGRESS_SUBMISSION_LIMITS.workplace).optional(),
  presenting: z.boolean().optional(),
});
export type CongressSubmissionDraftAuthor = z.infer<
  typeof CongressSubmissionDraftAuthorSchema
>;

/** A complete author at send (EARS-8). */
const SendAuthorSchema = z.object({
  surname: requiredName,
  firstName: requiredName,
  patronymic: z
    .string()
    .optional()
    .refine(
      (v) =>
        v === undefined ||
        congressTextLength(v) <= CONGRESS_SUBMISSION_LIMITS.name,
      { message: `max ${CONGRESS_SUBMISSION_LIMITS.name}` },
    )
    .transform((v) => {
      const n = v === undefined ? "" : normaliseNameAnswer(normaliseText(v));
      return n === "" ? undefined : n;
    }),
  workplace: requiredText(CONGRESS_SUBMISSION_LIMITS.workplace),
  presenting: z.boolean().default(false),
});

/** 1…20 ordered authors (EARS-8). */
const orderedAuthors = z
  .array(SendAuthorSchema)
  .min(1)
  .max(CONGRESS_SUBMISSION_LIMITS.authorsMax);

/** An oral talk's authors: exactly one of them presents (EARS-8). */
const presentingAuthors = orderedAuthors.refine(
  (as) => as.filter((a) => a.presenting).length === 1,
  { message: "exactly one presenting author" },
);

/**
 * A poster's authors (EARS-18): in publication order, with no presenting
 * mark — a stray mark is dropped, never stored.
 */
const unmarkedAuthors = orderedAuthors.transform((as) =>
  as.map((a) => ({ ...a, presenting: false })),
);

/** Whether the kind's authors carry a presenting mark — oral only (EARS-8, EARS-18). */
export function congressKindMarksPresenting(
  kind: CongressSubmissionKind,
): boolean {
  return kind === "oral";
}

// ---------------------------------------------------------------------------
// Per-kind forms — a kind joins by adding its entry (posters S3, abstracts S4)
// ---------------------------------------------------------------------------

const OralDraftBodySchema = z.strictObject({
  goal: draftText(CONGRESS_SUBMISSION_LIMITS.oralGoal).optional(),
  summary: draftText(CONGRESS_SUBMISSION_LIMITS.oralSummary).optional(),
});

const OralSendSchema = z.object({
  title: requiredText(CONGRESS_SUBMISSION_LIMITS.title),
  authors: presentingAuthors,
  body: z.object({
    goal: requiredText(CONGRESS_SUBMISSION_LIMITS.oralGoal),
    summary: requiredText(CONGRESS_SUBMISSION_LIMITS.oralSummary),
  }),
});

/** A poster's body (EARS-18): the goal and the content — no file field. */
const PosterDraftBodySchema = z.strictObject({
  goal: draftText(CONGRESS_SUBMISSION_LIMITS.posterGoal).optional(),
  content: draftText(CONGRESS_SUBMISSION_LIMITS.posterContent).optional(),
});

const PosterSendSchema = z.object({
  title: requiredText(CONGRESS_SUBMISSION_LIMITS.title),
  authors: unmarkedAuthors,
  body: z.object({
    goal: requiredText(CONGRESS_SUBMISSION_LIMITS.posterGoal),
    content: requiredText(CONGRESS_SUBMISSION_LIMITS.posterContent),
  }),
});

interface CongressSubmissionForm {
  /** The kind's body as a draft may hold it (EARS-7). */
  readonly draftBody: z.ZodType<Record<string, string | undefined>>;
  /** The complete send content of the kind. */
  readonly send: z.ZodType<CongressSubmissionSendContent>;
}

/**
 * The kinds whose forms exist, keyed by kind. The table, the status machine and
 * the send cascade are kind-generic; a kind is offered once its form is here.
 */
export const CONGRESS_SUBMISSION_FORMS: Partial<
  Record<CongressSubmissionKind, CongressSubmissionForm>
> = {
  oral: { draftBody: OralDraftBodySchema, send: OralSendSchema },
  poster: { draftBody: PosterDraftBodySchema, send: PosterSendSchema },
};

export function hasCongressSubmissionForm(
  kind: CongressSubmissionKind,
): boolean {
  return CONGRESS_SUBMISSION_FORMS[kind] !== undefined;
}

// ---------------------------------------------------------------------------
// Draft content (autosave — EARS-7)
// ---------------------------------------------------------------------------

/**
 * The autosaved draft content: every part optional, only types and maximum
 * lengths enforced. The body is checked against the kind's own draft body by
 * {@link parseCongressDraftBody}; this envelope bounds every body text at the
 * largest per-field limit.
 */
export const CongressSubmissionDraftContentSchema = z.strictObject({
  title: draftText(CONGRESS_SUBMISSION_LIMITS.title).optional(),
  authors: z
    .array(CongressSubmissionDraftAuthorSchema)
    .max(CONGRESS_SUBMISSION_LIMITS.authorsMax)
    .optional(),
  body: z
    .record(z.string(), draftText(CONGRESS_SUBMISSION_LIMITS.oralSummary))
    .optional(),
});
export type CongressSubmissionDraftContent = z.infer<
  typeof CongressSubmissionDraftContentSchema
>;

/** The kind's draft body, or `null` when it does not fit the kind. */
export function parseCongressDraftBody(
  kind: CongressSubmissionKind,
  body: unknown,
): Record<string, string> | null {
  const form = CONGRESS_SUBMISSION_FORMS[kind];
  if (!form) return null;
  const parsed = form.draftBody.safeParse(body ?? {});
  if (!parsed.success) return null;
  return Object.fromEntries(
    Object.entries(parsed.data).filter(
      (e): e is [string, string] => e[1] !== undefined,
    ),
  );
}

// ---------------------------------------------------------------------------
// Refusal problems (046-design «Send cascade»)
// ---------------------------------------------------------------------------

export const CONGRESS_SUBMISSION_PROBLEM_CODES = [
  "registration-required",
  "kind-not-available",
  "kind-not-open",
  "kind-closed",
  "revision-closed",
  "status-conflict",
  "withdraw-not-allowed",
  "limit-reached",
  "first-author-limit-reached",
  "age-limit",
  "consent-required",
  "statement-required",
  "field-invalid",
] as const;

export const CongressSubmissionProblemSchema = z.object({
  code: z.enum(CONGRESS_SUBMISSION_PROBLEM_CODES),
  /** The form field the problem sits next to (`title`, `authors.0.surname`…). */
  field: z.string().optional(),
  params: z
    .record(z.string(), z.union([z.string(), z.number(), z.null()]))
    .optional(),
});
export type CongressSubmissionProblem = z.infer<
  typeof CongressSubmissionProblemSchema
>;

/**
 * The params of an `age-limit` refusal (EARS-20): the kind's limit, the
 * event's start day in Europe/Moscow and the holder's age on that day.
 */
export const CongressAgeLimitParamsSchema = z.object({
  maxAgeYears: z.number().int().positive(),
  eventStartDate: MskCalendarDaySchema,
  age: z.number().int().nonnegative(),
});
export type CongressAgeLimitParams = z.infer<
  typeof CongressAgeLimitParamsSchema
>;

/** The typed `age-limit` params, or `null` when a refusal carries none. */
export function congressAgeLimitParams(
  params: CongressSubmissionProblem["params"],
): CongressAgeLimitParams | null {
  const parsed = CongressAgeLimitParamsSchema.safeParse(params);
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// Birth date and the age rule (EARS-19, EARS-20; 046-design «Age rule»)
// ---------------------------------------------------------------------------

/** The earliest birth date the account accepts. */
export const CONGRESS_BIRTH_DATE_MIN = "1900-01-01";

/** A birth date: a real calendar day `YYYY-MM-DD`, not before 1900. */
export const CongressBirthDateSchema = z.iso
  .date()
  .refine((d) => d >= CONGRESS_BIRTH_DATE_MIN, {
    message: `not before ${CONGRESS_BIRTH_DATE_MIN}`,
  });

/** `PUT /v1/me/birth-date` — the holder writes their own birth date (EARS-19). */
export const CongressBirthDateRequestSchema = z.strictObject({
  birthDate: CongressBirthDateSchema,
});
export type CongressBirthDateRequest = z.infer<
  typeof CongressBirthDateRequestSchema
>;

/** The account's birth date as its holder reads it back. */
export const CongressBirthDateResponseSchema = z.object({
  birthDate: z.iso.date(),
});
export type CongressBirthDateResponse = z.infer<
  typeof CongressBirthDateResponseSchema
>;

/**
 * Full years between two calendar days — the age rule counts the holder's age
 * on the event's start day in Europe/Moscow, so a birthday on that day counts.
 */
export function congressAgeOnDay(birthDate: string, onDay: string): number {
  const [by, bm, bd] = birthDate.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const [y, m, d] = onDay.split("-").map(Number) as [number, number, number];
  const beforeBirthday = m < bm || (m === bm && d < bd);
  return y - by - (beforeBirthday ? 1 : 0);
}

/**
 * Whether starting or sending a submission of the kind needs the account's
 * birth date: a poster always asks for it (EARS-19), and any kind with an age
 * limit needs it to apply the rule (EARS-20).
 */
export function congressKindNeedsBirthDate(
  kind: CongressSubmissionKind,
  maxAgeYears: number | null,
): boolean {
  return kind === "poster" || maxAgeYears !== null;
}

/** The body of every refusal: each unmet condition, named (EARS-9). */
export const CongressSubmissionRefusalSchema = z.object({
  problems: z.array(CongressSubmissionProblemSchema).min(1),
});
export type CongressSubmissionRefusal = z.infer<
  typeof CongressSubmissionRefusalSchema
>;

// ---------------------------------------------------------------------------
// Send content (EARS-8, EARS-9)
// ---------------------------------------------------------------------------

export interface CongressSubmissionSendContent {
  title: string;
  authors: {
    surname: string;
    firstName: string;
    patronymic?: string | undefined;
    workplace: string;
    presenting: boolean;
  }[];
  body: Record<string, string>;
}

export type CongressSendParseResult =
  | { ok: true; content: CongressSubmissionSendContent }
  | { ok: false; problems: CongressSubmissionProblem[] };

/**
 * Check a stored draft against the complete field set of its kind. Each unmet
 * field is its own `field-invalid` problem, so the form marks every one.
 */
export function parseCongressSendContent(
  kind: CongressSubmissionKind,
  content: unknown,
): CongressSendParseResult {
  const form = CONGRESS_SUBMISSION_FORMS[kind];
  if (!form) {
    return { ok: false, problems: [{ code: "field-invalid", field: "kind" }] };
  }
  const parsed = form.send.safeParse(content);
  if (parsed.success) return { ok: true, content: parsed.data };
  const seen = new Set<string>();
  const problems: CongressSubmissionProblem[] = [];
  for (const issue of parsed.error.issues) {
    const field = issue.path.map(String).join(".");
    if (seen.has(field)) continue;
    seen.add(field);
    problems.push({ code: "field-invalid", field });
  }
  return { ok: false, problems };
}

// ---------------------------------------------------------------------------
// Kind intake state (EARS-1, EARS-10)
// ---------------------------------------------------------------------------

export const CONGRESS_KIND_INTAKE_STATES = [
  "not-announced",
  "not-yet-open",
  "open",
  "closed",
] as const;
export type CongressKindIntakeState =
  (typeof CONGRESS_KIND_INTAKE_STATES)[number];

/** Where a kind's window stands at `now` — the four EARS-10 lines. */
export function congressKindIntakeState(
  window: { opensAt: Date | null; closesAt: Date | null },
  now: Date,
): CongressKindIntakeState {
  if (isCongressKindIntakeOpen(window, now)) return "open";
  if (window.opensAt === null) return "not-announced";
  if (now.getTime() < window.opensAt.getTime()) return "not-yet-open";
  return "closed";
}

// ---------------------------------------------------------------------------
// Wire contract
// ---------------------------------------------------------------------------

/** `POST /v1/me/congress-submissions` — create a draft (EARS-6). */
export const CongressSubmissionCreateRequestSchema = z.strictObject({
  eventId: z.uuid(),
  kind: CongressSubmissionKindSchema,
});
export type CongressSubmissionCreateRequest = z.infer<
  typeof CongressSubmissionCreateRequestSchema
>;

/** `POST …/:id/send` — the consents the author accepts with this send (EARS-16). */
export const CongressSubmissionSendRequestSchema = z.strictObject({
  acceptedConsents: z
    .array(z.enum(CONGRESS_SUBMISSION_CONSENT_PURPOSES))
    .default([]),
});
export type CongressSubmissionSendRequest = z.infer<
  typeof CongressSubmissionSendRequestSchema
>;

/** `POST …/:id/withdraw` — the status the author saw (EARS-12). */
export const CongressSubmissionWithdrawRequestSchema = z.strictObject({
  expectedStatus: CongressSubmissionStatusSchema,
});
export type CongressSubmissionWithdrawRequest = z.infer<
  typeof CongressSubmissionWithdrawRequestSchema
>;

/** One of the author's submissions (EARS-11). */
export const CongressSubmissionSchema = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  kind: CongressSubmissionKindSchema,
  status: CongressSubmissionStatusSchema,
  title: z.string(),
  authors: z.array(CongressSubmissionDraftAuthorSchema),
  body: z.record(z.string(), z.string()),
  /** The committee comment — carried for `rejected` and `needs_revision` only. */
  committeeComment: z.string().nullable(),
  submittedAt: z.iso.datetime({ offset: true }).nullable(),
  /** The submission's own revision deadline (EARS-34), exclusive instant. */
  revisionDueAt: z.iso.datetime({ offset: true }).nullable(),
  /**
   * The last status change — the committee comment is dated by the change
   * that carried it (EARS-11).
   */
  statusChangedAt: z.iso.datetime({ offset: true }),
  /** The last change of content or status (EARS-11). */
  updatedAt: z.iso.datetime({ offset: true }),
  createdAt: z.iso.datetime({ offset: true }),
});
export type CongressSubmission = z.infer<typeof CongressSubmissionSchema>;

/** One kind's intake as the section shows it (EARS-10, EARS-17). */
export const CongressSubmissionKindIntakeSchema = z.object({
  kind: CongressSubmissionKindSchema,
  state: z.enum(CONGRESS_KIND_INTAKE_STATES),
  opensAt: z.iso.datetime({ offset: true }).nullable(),
  closesAt: z.iso.datetime({ offset: true }).nullable(),
  /** The last day of acceptance, inclusive, Moscow (EARS-3). */
  lastDay: MskCalendarDaySchema.nullable(),
  submitLimit: z.number().int().positive().nullable(),
  /** The account's counted submissions of this kind (EARS-17). */
  used: z.number().int().nonnegative(),
  /** Whether the cabinet offers this kind yet. */
  offered: z.boolean(),
  /** The kind's age limit in whole years; `null` = no age rule (EARS-20). */
  maxAgeYears: z.number().int().positive().nullable(),
});
export type CongressSubmissionKindIntake = z.infer<
  typeof CongressSubmissionKindIntakeSchema
>;

/** The event the section is for, as its heading names it (EARS-4). */
export const CongressSubmissionSectionEventSchema = z.object({
  slug: z.string(),
  title: z.string(),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
});
export type CongressSubmissionSectionEvent = z.infer<
  typeof CongressSubmissionSectionEventSchema
>;

/**
 * `GET /v1/me/congress-submissions[?event=]` — the author's section (EARS-4,
 * EARS-5, EARS-10, EARS-11). Without `event` it is the section of the congress
 * event — the event with intake settings that starts latest (046-design
 * «Entry and return»), so `/account/congress` needs no event in its URL.
 */
export const CongressSubmissionSectionSchema = z.object({
  eventId: z.uuid(),
  event: CongressSubmissionSectionEventSchema,
  /** An active registration of the account for the event exists (EARS-5). */
  registered: z.boolean(),
  registrationUrl: z.string().nullable(),
  /** The next send asks for the submission consent (EARS-16). */
  consentRequired: z.boolean(),
  /**
   * The account's birth date, shown to its holder for correction in the
   * poster flow (EARS-19); `null` until they give it.
   */
  birthDate: z.iso.date().nullable(),
  kinds: z.array(CongressSubmissionKindIntakeSchema),
  submissions: z.array(CongressSubmissionSchema),
});
export type CongressSubmissionSection = z.infer<
  typeof CongressSubmissionSectionSchema
>;
