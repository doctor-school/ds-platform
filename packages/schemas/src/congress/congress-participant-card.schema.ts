import { z } from "zod";
import { CongressDaySchema } from "./congress-attendance.schema.js";

/**
 * 044 EARS-36 — the contract of the participant card
 * (`GET /v1/admin/events/:idOrSlug/registrations/:registrationId`).
 *
 * The card is a separate read model from the roster row: the roster shows the
 * columns the desk scans (EARS-37), the card carries EVERY stored answer of one
 * registration, plus the facts around it — how the registration arrived
 * (`registrations.intake_origin`), the accepted consent, the confirmation-mail
 * outcome, the read-time «возможный дубль» derivation (EARS-30) and the per-day
 * attendance with its 010 audit history (who changed the mark, and when).
 *
 * Every object is STRICT on purpose: the card must never carry whether the
 * email already had a Doctor.School account before this registration
 * (`registrations.account_created_by_intake`, EARS-35/EARS-36), and a strict
 * schema makes an extra key a contract failure rather than a silent leak.
 *
 * Answer fields are nullable for the same reason as on the roster row (EARS-16):
 * a platform-origin registration carries no answers, so a field falls back to
 * the account's own profile value and stays EMPTY where there is none.
 */

/** 044 EARS-35/EARS-36 — how the registration arrived. */
export const CongressIntakeOriginSchema = z.enum(["site", "desk", "platform"]);
export type CongressIntakeOrigin = z.infer<typeof CongressIntakeOriginSchema>;

/** One accepted consent row of the participant (`consent_records`). */
export const CongressParticipantConsentSchema = z.strictObject({
  purpose: z.string(),
  version: z.string(),
  capturedAt: z.iso.datetime(),
  /** `paper` for a consent the registrar recorded at the desk; `null` online. */
  origin: z.enum(["paper"]).nullable(),
});
export type CongressParticipantConsent = z.infer<
  typeof CongressParticipantConsentSchema
>;

/** The confirmation-letter outcome (EARS-11…EARS-13, EARS-27); both `null` before any attempt. */
export const CongressParticipantMailSchema = z.strictObject({
  status: z.enum(["sent", "failed"]).nullable(),
  at: z.iso.datetime().nullable(),
});
export type CongressParticipantMail = z.infer<
  typeof CongressParticipantMailSchema
>;

/** One change of a day's mark, read from the 010 change audit. */
export const CongressAttendanceHistoryEntrySchema = z.strictObject({
  /** The mark's value after the change. */
  present: z.boolean(),
  at: z.iso.datetime(),
  /**
   * The acting principal: its `users` display name where the ledger's actor
   * `sub` resolves to one, else the raw `sub`; `null` for an un-attributed
   * (`db-direct`) change.
   */
  actor: z.string().nullable(),
  /** The ledger's `source` label as stored (`admin-ui`, `db-direct`, …). */
  source: z.string(),
});
export type CongressAttendanceHistoryEntry = z.infer<
  typeof CongressAttendanceHistoryEntrySchema
>;

/**
 * One configured congress day: its current mark (`null` = never marked) and
 * the history of changes, oldest first.
 */
export const CongressParticipantDaySchema = z.strictObject({
  day: CongressDaySchema,
  present: z.boolean().nullable(),
  history: z.array(CongressAttendanceHistoryEntrySchema),
});
export type CongressParticipantDay = z.infer<
  typeof CongressParticipantDaySchema
>;

export const CongressParticipantCardSchema = z.strictObject({
  registrationId: z.uuid(),
  surname: z.string().nullable(),
  firstName: z.string().nullable(),
  patronymic: z.string().nullable(),
  /** Surname + first name + patronymic joined, or the account's display name. */
  fullName: z.string(),
  /** The specialty NAME resolved through `specialties_minzdrav`. */
  specialtyName: z.string().nullable(),
  workplace: z.string().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  /** The phone exactly as typed (EARS-29), never the normalised form. */
  phone: z.string().nullable(),
  email: z.string().nullable(),
  registeredAt: z.iso.datetime(),
  intakeOrigin: CongressIntakeOriginSchema,
  consents: z.array(CongressParticipantConsentSchema),
  confirmationMail: CongressParticipantMailSchema,
  possibleDuplicate: z.boolean(),
  /** One entry per configured congress day, in day order. */
  attendance: z.array(CongressParticipantDaySchema),
});
export type CongressParticipantCard = z.infer<
  typeof CongressParticipantCardSchema
>;

/** Path parameter of the card route (the event key is the roster's). */
export const CongressParticipantCardParamsSchema = z.object({
  registrationId: z.uuid(),
});
