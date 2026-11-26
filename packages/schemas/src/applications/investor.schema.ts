import { z } from "zod";

/**
 * 034 EARS-4, EARS-6 — the `investor` kind of the 033 application queue: the
 * «Инвесторам» page's «Обсудить проект» form (034-design «Placement»).
 *
 * No account stands behind the request, so — like the 033 `partnership` kind
 * — the consent is recorded on the row itself (purpose, version tag, time),
 * never as a `consent_records` row. The consent text and its current version
 * tag live here so the page and the intake read one value.
 */
export const INVESTOR_REQUEST_CONSENT_PURPOSE =
  "investor-request-personal-data";
export const INVESTOR_REQUEST_CONSENT_VERSION_TAG = "investor-request-v1";

/** EARS-4 — the consent row of the form, as the page renders it. */
export const INVESTOR_REQUEST_CONSENT = {
  purpose: INVESTOR_REQUEST_CONSENT_PURPOSE,
  versionTag: INVESTOR_REQUEST_CONSENT_VERSION_TAG,
  label: "Согласие на обработку персональных данных из заявки",
  line: "Данные нужны, чтобы команда Академии связалась с вами по заявке.",
  policyLinkLabel: "Политика персональных данных и согласия",
  policyHref: "/documents/privacy-policy",
} as const;

export const INVESTOR_ORGANISATION_MAX = 200;
export const INVESTOR_FULL_NAME_MAX = 200;
export const INVESTOR_ROLE_MAX = 120;
export const INVESTOR_EMAIL_MAX = 254;
export const INVESTOR_PHONE_MAX = 32;
export const INVESTOR_TASK_MAX = 2000;

const required = (max: number) => z.string().trim().min(1).max(max);
/** A stored optional value: absent, never `""`. */
const storedOptional = (max: number) =>
  z.string().trim().min(1).max(max).optional();
/** A form's optional value: the form sends an empty field as `""`. */
const formOptional = (max: number) => z.string().trim().max(max).optional();
const workEmail = z.email().max(INVESTOR_EMAIL_MAX);

/** The stored `contact` of an `investor` row (no account behind it). */
export const InvestorRequestContactSchema = z
  .object({
    organisation: required(INVESTOR_ORGANISATION_MAX),
    fullName: required(INVESTOR_FULL_NAME_MAX),
    role: storedOptional(INVESTOR_ROLE_MAX),
    email: workEmail,
    phone: storedOptional(INVESTOR_PHONE_MAX),
  })
  .strict();
export type InvestorRequestContact = z.infer<
  typeof InvestorRequestContactSchema
>;

/** The stored `payload` of an `investor` row; an empty task is absent. */
export const InvestorRequestPayloadSchema = z
  .object({ task: storedOptional(INVESTOR_TASK_MAX) })
  .strict();
export type InvestorRequestPayload = z.infer<
  typeof InvestorRequestPayloadSchema
>;

/**
 * EARS-6 — `POST /v1/public/applications/investor` body: contact + payload +
 * the ticked consent. An empty optional field may come as `""`; the intake
 * stores it absent. A missing or unticked consent is a `400` on `consent`
 * here; a `versionTag` other than {@link INVESTOR_REQUEST_CONSENT_VERSION_TAG}
 * is refused `400` on `consent` by the intake (EARS-4).
 */
export const InvestorRequestIntakeSchema = z
  .object({
    contact: z
      .object({
        organisation: required(INVESTOR_ORGANISATION_MAX),
        fullName: required(INVESTOR_FULL_NAME_MAX),
        role: formOptional(INVESTOR_ROLE_MAX),
        email: workEmail,
        phone: formOptional(INVESTOR_PHONE_MAX),
      })
      .strict(),
    payload: z.object({ task: formOptional(INVESTOR_TASK_MAX) }).strict(),
    consent: z
      .object({
        accepted: z.literal(true),
        versionTag: z.string().min(1).max(200),
      })
      .strict(),
  })
  .strict();
export type InvestorRequestIntake = z.infer<typeof InvestorRequestIntakeSchema>;

/** EARS-6 — `201 { id }`, also the idempotent replay's answer. */
export const InvestorRequestIntakeResultSchema = z
  .object({ id: z.uuid() })
  .strict();
export type InvestorRequestIntakeResult = z.infer<
  typeof InvestorRequestIntakeResultSchema
>;
