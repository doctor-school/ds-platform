import { z } from "zod";

import {
  ApplicationKindSchema,
  ApplicationOutcomeSchema,
  ApplicationStatusSchema,
  APPLICATION_RECEIPT_NOTICES,
  APPLICATION_TEAM_NOTICES,
} from "./applications.schema.js";

/**
 * 033 EARS-13…EARS-17, EARS-20 — the admin «Заявки» contract
 * (033-design «Endpoints»): `/v1/admin/applications*`, served only to a
 * `platform_admin` in the dedicated admin session with the second factor.
 */

/** Page bounds of the admin queue list (EARS-13). */
export const ADMIN_APPLICATION_LIST_LIMIT = {
  min: 1,
  default: 20,
  max: 50,
} as const;

/** EARS-13 — `GET /v1/admin/applications?kind&status&cursor&limit`. */
export const AdminApplicationListQuerySchema = z
  .object({
    kind: ApplicationKindSchema.optional(),
    status: ApplicationStatusSchema.optional(),
    /** The previous page's opaque `nextCursor`. */
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(ADMIN_APPLICATION_LIST_LIMIT.min)
      .max(ADMIN_APPLICATION_LIST_LIMIT.max)
      .default(ADMIN_APPLICATION_LIST_LIMIT.default),
  })
  .strict();
export type AdminApplicationListQuery = z.infer<
  typeof AdminApplicationListQuerySchema
>;

export const ApplicationTeamNoticeSchema = z.enum(APPLICATION_TEAM_NOTICES);
export const ApplicationReceiptNoticeSchema = z.enum(
  APPLICATION_RECEIPT_NOTICES,
);

/**
 * EARS-13 — one row of the queue list. `applicant` is the account's current
 * display name (author kind, read live — decision 17) or the contact's name
 * (no-account kinds); `null` once the application's personal data is erased
 * (`erased: true`, «Персональные данные стёрты», EARS-20). `teamNotified` is
 * `false` for a team notice that is not `sent` («Команда не уведомлена»,
 * EARS-11: `pending`, `failed` and `skipped` alike).
 */
export const AdminApplicationListItemSchema = z.strictObject({
  id: z.uuid(),
  kind: ApplicationKindSchema,
  kindLabel: z.string(),
  submittedAt: z.iso.datetime({ offset: true }),
  applicant: z.string().nullable(),
  subjectLine: z.string().nullable(),
  status: ApplicationStatusSchema,
  outcome: ApplicationOutcomeSchema.nullable(),
  teamNotified: z.boolean(),
  erased: z.boolean(),
});
export type AdminApplicationListItem = z.infer<
  typeof AdminApplicationListItemSchema
>;

/**
 * EARS-13 — one kind the «Вид» filter offers, with the label the rows carry:
 * both come from the api's kinds table (033-design «Request kinds»).
 */
export const AdminApplicationKindOptionSchema = z.strictObject({
  kind: ApplicationKindSchema,
  label: z.string(),
});
export type AdminApplicationKindOption = z.infer<
  typeof AdminApplicationKindOptionSchema
>;

/** EARS-13 — one page, newest first by (`submittedAt`, `id`). */
export const AdminApplicationListPageSchema = z.strictObject({
  items: z.array(AdminApplicationListItemSchema),
  /** Opaque cursor of the next (older) page; null on the last page. */
  nextCursor: z.string().nullable(),
  /** Every kind the queue holds, in the kinds table's order. */
  kinds: z.array(AdminApplicationKindOptionSchema),
});
export type AdminApplicationListPage = z.infer<
  typeof AdminApplicationListPageSchema
>;

/** EARS-14 — one field the applicant sent, with its admin label. */
export const AdminApplicationFieldSchema = z.strictObject({
  key: z.string(),
  label: z.string(),
  value: z.string(),
});
export type AdminApplicationField = z.infer<typeof AdminApplicationFieldSchema>;

/**
 * EARS-14 — the applicant. `account`: the author application's account with
 * its CURRENT display name, email and phone (read live, never copied —
 * decision 17). `contact`: the no-account kinds' own contact as sent.
 */
export const AdminApplicationApplicantSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("account"),
    userId: z.uuid(),
    displayName: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
  }),
  z.strictObject({
    type: z.literal("contact"),
    fields: z.array(AdminApplicationFieldSchema),
  }),
]);
export type AdminApplicationApplicant = z.infer<
  typeof AdminApplicationApplicantSchema
>;

/** EARS-16 — one immutable internal note. */
export const AdminApplicationNoteSchema = z.strictObject({
  id: z.uuid(),
  body: z.string(),
  authorAdminId: z.uuid(),
  authorName: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type AdminApplicationNote = z.infer<typeof AdminApplicationNoteSchema>;

/** The subject's other applications, for the erasure on request (033-design «Lifecycle»). */
export const AdminApplicationSiblingSchema = z.strictObject({
  id: z.uuid(),
  kind: ApplicationKindSchema,
  submittedAt: z.iso.datetime({ offset: true }),
  status: ApplicationStatusSchema,
  outcome: ApplicationOutcomeSchema.nullable(),
  erased: z.boolean(),
});

/**
 * EARS-14 — `GET /v1/admin/applications/{id}`; the `ETag` header carries
 * `version` (`W/"<version>"`) for the status move's `If-Match` (EARS-15).
 * An erased application has `fields: []` and `applicant: null` (EARS-20).
 */
export const AdminApplicationDetailSchema = z.strictObject({
  id: z.uuid(),
  kind: ApplicationKindSchema,
  kindLabel: z.string(),
  submittedAt: z.iso.datetime({ offset: true }),
  subjectLine: z.string().nullable(),
  fields: z.array(AdminApplicationFieldSchema),
  applicant: AdminApplicationApplicantSchema.nullable(),
  consent: z.strictObject({
    purpose: z.string(),
    versionTag: z.string(),
    capturedAt: z.iso.datetime({ offset: true }).nullable(),
  }),
  teamNotice: ApplicationTeamNoticeSchema,
  receiptNotice: ApplicationReceiptNoticeSchema,
  status: ApplicationStatusSchema,
  outcome: ApplicationOutcomeSchema.nullable(),
  statusChangedAt: z.iso.datetime({ offset: true }).nullable(),
  statusChangedBy: z.uuid().nullable(),
  closedAt: z.iso.datetime({ offset: true }).nullable(),
  erased: z.boolean(),
  pdErasedAt: z.iso.datetime({ offset: true }).nullable(),
  notes: z.array(AdminApplicationNoteSchema),
  otherApplications: z.array(AdminApplicationSiblingSchema),
  version: z.number().int().positive(),
});
export type AdminApplicationDetail = z.infer<
  typeof AdminApplicationDetailSchema
>;

export const APPLICATION_NOTE_MAX = 2000;

/** EARS-16 — `POST /v1/admin/applications/{id}/notes`; trimmed 1–2000. */
export const AdminApplicationNoteCreateSchema = z.strictObject({
  body: z.string().trim().min(1).max(APPLICATION_NOTE_MAX),
});
export type AdminApplicationNoteCreate = z.infer<
  typeof AdminApplicationNoteCreateSchema
>;

/** The admin queue's own refusal codes (EARS-15, EARS-20, EARS-16). */
export const AdminApplicationErrorCodes = {
  transitionNotAllowed: "APPLICATION_TRANSITION_NOT_ALLOWED",
  alreadyErased: "ALREADY_ERASED",
} as const;
export type AdminApplicationErrorCode =
  (typeof AdminApplicationErrorCodes)[keyof typeof AdminApplicationErrorCodes];
