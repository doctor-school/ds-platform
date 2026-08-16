import { z } from "zod";

export const ACADEMY_PARTNERSHIP_ROLES = [
  "Эксперт",
  "Партнёр",
  "Участник подкаста",
  "Соавтор направления",
  "Компания",
] as const;

export const ACADEMY_PRIVACY_POLICY_URL =
  "https://doctor.school/index/privacy-pay";
export const ACADEMY_CONSENT_PURPOSE = "academy_partnership_contact";
export const ACADEMY_CONSENT_VERSION_TAG = "academy-partnership-v1";
export const ACADEMY_CONSENT_TEXT =
  "Согласен(а) на обработку персональных данных в соответствии со 152-ФЗ.";
export const ACADEMY_PARTNERSHIP_WRITE_ERROR =
  "Не удалось сохранить заявку. Попробуйте ещё раз.";

const TELEGRAM_HANDLE = /^@[A-Za-z0-9_]{5,32}$/;
const emailSchema = z.email().max(254);

export const AcademyPartnershipSubmissionSchema = z.object({
  idempotencyKey: z.uuid(),
  name: z
    .string()
    .trim()
    .min(1, "Укажите имя.")
    .max(120, "Имя не должно превышать 120 символов."),
  companyOrClinic: z
    .string()
    .trim()
    .max(160, "Название не должно превышать 160 символов.")
    .default(""),
  contact: z
    .string()
    .trim()
    .max(254, "Контакт не должен превышать 254 символа.")
    .refine(
      (value) =>
        emailSchema.safeParse(value).success || TELEGRAM_HANDLE.test(value),
      "Укажите корректный email или Telegram в формате @username.",
    ),
  role: z.enum(ACADEMY_PARTNERSHIP_ROLES, {
    error: "Выберите роль.",
  }),
  consent: z.boolean().refine((value) => value, {
    error: "Подтвердите согласие на обработку персональных данных.",
  }),
});

export type AcademyPartnershipSubmissionInput = z.input<
  typeof AcademyPartnershipSubmissionSchema
>;
export type AcademyPartnershipSubmission = z.output<
  typeof AcademyPartnershipSubmissionSchema
>;

export type AcademyPartnershipActionResult =
  | { status: "success" }
  | {
      status: "invalid";
      fieldErrors: Partial<
        Record<keyof AcademyPartnershipSubmission, string>
      >;
    }
  | { status: "error"; message: typeof ACADEMY_PARTNERSHIP_WRITE_ERROR };
