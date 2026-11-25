import { z } from "zod";

/**
 * 033 — the shared application queue contract (033-design «Data model»,
 * «Request kinds (the 034 seam)»).
 *
 * `ApplicationKind` is CLOSED: a kind exists only once its payload schema, its
 * intake and its entry in the api's `APPLICATION_KINDS` table exist. The queue
 * core (#4028) ships `author`; the interim partnership intake (#4032) and 034's
 * investor intake (#1824) each extend this enum, the api table and the
 * `applications_kind_check` constraint in their own migration.
 */
export const APPLICATION_KINDS = ["author"] as const;
export const ApplicationKindSchema = z.enum(APPLICATION_KINDS);
export type ApplicationKind = z.infer<typeof ApplicationKindSchema>;

/** The lifecycle (033-design «Lifecycle»): `closed` is final in slice 1. */
export const APPLICATION_STATUSES = ["new", "in_review", "closed"] as const;
export const ApplicationStatusSchema = z.enum(APPLICATION_STATUSES);
export type ApplicationStatus = z.infer<typeof ApplicationStatusSchema>;

/**
 * Every outcome a closed application can carry. `expired` is set only by the
 * daily purge (EARS-23); it is deliberately absent from
 * {@link AdminApplicationOutcomeSchema}, so no administrator can choose it.
 */
export const APPLICATION_OUTCOMES = [
  "accepted",
  "declined",
  "expired",
] as const;
export const ApplicationOutcomeSchema = z.enum(APPLICATION_OUTCOMES);
export type ApplicationOutcome = z.infer<typeof ApplicationOutcomeSchema>;

/** EARS-15 / EARS-23 — the outcomes an administrator may close with. */
export const AdminApplicationOutcomeSchema = z.enum(["accepted", "declined"]);
export type AdminApplicationOutcome = z.infer<
  typeof AdminApplicationOutcomeSchema
>;

/**
 * EARS-15 — the admin status-move body. `expired` is not an admin outcome
 * (EARS-23); the outcome is required exactly when the target is `closed`.
 * The endpoint itself is the admin-queue slice's (#4030).
 */
export const AdminApplicationStatusMoveSchema = z
  .object({
    status: z.enum(["in_review", "closed"]),
    outcome: AdminApplicationOutcomeSchema.optional(),
  })
  .strict()
  .refine((b) => (b.status === "closed") === (b.outcome !== undefined), {
    message: "outcome is required exactly when the target status is closed",
    path: ["outcome"],
  });
export type AdminApplicationStatusMove = z.infer<
  typeof AdminApplicationStatusMoveSchema
>;

/** Team-notice outcome (EARS-11); written by the notifications slice (#4029). */
export const APPLICATION_TEAM_NOTICES = [
  "pending",
  "sent",
  "failed",
  "skipped",
] as const;
/** Receipt outcome (EARS-12); written by the notifications slice (#4029). */
export const APPLICATION_RECEIPT_NOTICES = [
  "pending",
  "sent",
  "failed",
  "not_applicable",
] as const;

/**
 * EARS-6 — the consent purpose of an author application (152-ФЗ, separate
 * purpose, ADR-0016 §7) and the `@ds/legal-content` document its text and its
 * version stamp come from (`<edition>.sha256-<hex>`, the 046 precedent).
 */
export const AUTHOR_APPLICATION_PERSONAL_DATA_PURPOSE =
  "author-application-personal-data";
export const AUTHOR_APPLICATION_CONSENT_DOCUMENT_SLUG =
  "consent-author-application";

/** EARS-4 — «курс-сериал», «отдельный урок», «подкаст», «выступление». */
export const AUTHOR_APPLICATION_FORMATS = [
  "course_series",
  "single_lesson",
  "podcast",
  "talk",
] as const;
export const AuthorApplicationFormatSchema = z.enum(AUTHOR_APPLICATION_FORMATS);

export const AUTHOR_APPLICATION_TOPIC_MAX = 200;
export const AUTHOR_APPLICATION_SPECIALTY_OTHER_MAX = 120;
export const AUTHOR_APPLICATION_ABOUT_MAX = 2000;

const authorPayloadShape = {
  topic: z.string().trim().min(1).max(AUTHOR_APPLICATION_TOPIC_MAX),
  /** FK-by-value to `specialties_minzdrav.code`; checked by the api (EARS-7). */
  specialtyCode: z.string().min(1).max(128).optional(),
  /** The «Другое» text (EARS-4). */
  specialtyOther: z
    .string()
    .trim()
    .min(1)
    .max(AUTHOR_APPLICATION_SPECIALTY_OTHER_MAX)
    .optional(),
  format: AuthorApplicationFormatSchema,
  about: z.string().trim().max(AUTHOR_APPLICATION_ABOUT_MAX).optional(),
};

const oneSpecialtyForm = {
  message: "carry a specialty code or the «Другое» text, not both",
  path: ["specialtyOther"],
};

/** EARS-7 — the stored `author` payload: one specialty form or neither. */
export const AuthorApplicationPayloadSchema = z
  .object(authorPayloadShape)
  .strict()
  .refine(
    (p) => p.specialtyCode === undefined || p.specialtyOther === undefined,
    oneSpecialtyForm,
  );
export type AuthorApplicationPayload = z.infer<
  typeof AuthorApplicationPayloadSchema
>;

/**
 * EARS-6, EARS-7 — `POST /v1/me/applications/author` body: the payload plus
 * the version tag of the consent text the expert ticked. A tag that is not
 * the current one is refused `400` with a field error on `consent`.
 */
export const AuthorApplicationIntakeSchema = z
  .object({ ...authorPayloadShape, consentVersion: z.string().min(1).max(200) })
  .strict()
  .refine(
    (p) => p.specialtyCode === undefined || p.specialtyOther === undefined,
    oneSpecialtyForm,
  );
export type AuthorApplicationIntake = z.infer<
  typeof AuthorApplicationIntakeSchema
>;

/** EARS-7 — `201 { id, submittedAt }`, also the idempotent replay's answer. */
export const AuthorApplicationIntakeResultSchema = z
  .object({ id: z.uuid(), submittedAt: z.iso.datetime({ offset: true }) })
  .strict();
export type AuthorApplicationIntakeResult = z.infer<
  typeof AuthorApplicationIntakeResultSchema
>;

/**
 * EARS-20 — the erasure tombstone: the one payload form besides each kind's
 * own, admitted only together with `pd_erased_at` (the DB check).
 */
export const ApplicationErasedPayloadSchema = z
  .object({ erased: z.literal(true) })
  .strict();

/** EARS-20 — the body every note of an erased application is replaced with. */
export const APPLICATION_NOTE_ERASED_SENTINEL = "[стёрто]";

/** Problem codes of the queue's intakes (EARS-6, EARS-7). */
export const ApplicationProblemCodes = {
  idempotencyKeyRequired: "IDEMPOTENCY_KEY_REQUIRED",
  idempotencyKeyInvalid: "IDEMPOTENCY_KEY_INVALID",
  idempotencyKeyReused: "IDEMPOTENCY_KEY_REUSED",
  consentVersionStale: "CONSENT_VERSION_NOT_CURRENT",
  consentUnavailable: "CONSENT_DOCUMENT_UNAVAILABLE",
  specialtyUnknown: "SPECIALTY_UNKNOWN",
} as const;
export type ApplicationProblemCode =
  (typeof ApplicationProblemCodes)[keyof typeof ApplicationProblemCodes];

export const ApplicationRefusalSchema = z.object({
  problems: z
    .array(
      z.object({
        code: z.enum(
          Object.values(ApplicationProblemCodes) as [
            ApplicationProblemCode,
            ...ApplicationProblemCode[],
          ],
        ),
        field: z.string().optional(),
      }),
    )
    .min(1),
});
export type ApplicationRefusal = z.infer<typeof ApplicationRefusalSchema>;
