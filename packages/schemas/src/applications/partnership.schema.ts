import { z } from "zod";

/**
 * 033 EARS-18, EARS-19 — the `partnership` kind of the application queue: the
 * Academy home's partnership form (033-design «Request kinds», «Import of the
 * interim records»).
 *
 * The consent is the form's fixed 152-ФЗ tick, not a `@ds/legal-content`
 * document: its purpose and version tag are the ones every interim record
 * already carries, so an imported row and a new one are stamped alike.
 */
export const PARTNERSHIP_CONSENT_PURPOSE = "academy_partnership_contact";
export const PARTNERSHIP_CONSENT_VERSION_TAG = "academy-partnership-v1";

/** The form's closed role list (its select, unchanged since the interim form). */
export const PARTNERSHIP_ROLES = [
  "Эксперт",
  "Партнёр",
  "Участник подкаста",
  "Соавтор направления",
  "Компания",
] as const;
export const PartnershipRoleSchema = z.enum(PARTNERSHIP_ROLES);

export const PARTNERSHIP_NAME_MAX = 120;
export const PARTNERSHIP_COMPANY_MAX = 160;
export const PARTNERSHIP_CONTACT_MAX = 254;

const TELEGRAM_HANDLE = /^@[A-Za-z0-9_]{5,32}$/;
const emailSchema = z.email().max(PARTNERSHIP_CONTACT_MAX);

/** An email address or a Telegram handle `@username` (the form's one field). */
export const PartnershipContactValueSchema = z
  .string()
  .trim()
  .min(1)
  .max(PARTNERSHIP_CONTACT_MAX)
  .refine(
    (value) =>
      emailSchema.safeParse(value).success || TELEGRAM_HANDLE.test(value),
    "an email address or a Telegram handle @username",
  );

/** The stored `partnership` payload; an empty company is absent, never `""`. */
export const PartnershipRequestPayloadSchema = z
  .object({
    name: z.string().trim().min(1).max(PARTNERSHIP_NAME_MAX),
    companyOrClinic: z
      .string()
      .trim()
      .min(1)
      .max(PARTNERSHIP_COMPANY_MAX)
      .optional(),
    role: PartnershipRoleSchema,
  })
  .strict();
export type PartnershipRequestPayload = z.infer<
  typeof PartnershipRequestPayloadSchema
>;

/** The stored `contact` of a `partnership` row (no account behind it). */
export const PartnershipRequestContactSchema = z
  .object({ emailOrTelegram: PartnershipContactValueSchema })
  .strict();
export type PartnershipRequestContact = z.infer<
  typeof PartnershipRequestContactSchema
>;

/**
 * EARS-18 — `POST /v1/public/applications/partnership` body. The form sends
 * an empty company as `""`; the intake stores it as absent. `consentVersion`
 * is the tag of the consent the guest ticked: anything but
 * {@link PARTNERSHIP_CONSENT_VERSION_TAG} is refused `400` on `consent`.
 */
export const PartnershipRequestIntakeSchema = z
  .object({
    name: z.string().trim().min(1).max(PARTNERSHIP_NAME_MAX),
    companyOrClinic: z.string().trim().max(PARTNERSHIP_COMPANY_MAX).optional(),
    contact: PartnershipContactValueSchema,
    role: PartnershipRoleSchema,
    consentVersion: z.string().min(1).max(200),
  })
  .strict();
export type PartnershipRequestIntake = z.infer<
  typeof PartnershipRequestIntakeSchema
>;

/** EARS-18 — `201 { id }`, also the idempotent replay's answer. */
export const PartnershipRequestIntakeResultSchema = z
  .object({ id: z.uuid() })
  .strict();
export type PartnershipRequestIntakeResult = z.infer<
  typeof PartnershipRequestIntakeResultSchema
>;

/** EARS-19 — the one-off import's report. */
export interface PartnershipImportReport {
  imported: number;
  alreadyPresent: number;
  invalid: string[];
}
