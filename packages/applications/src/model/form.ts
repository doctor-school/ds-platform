import {
  AUTHOR_APPLICATION_ABOUT_MAX,
  AUTHOR_APPLICATION_SPECIALTY_OTHER_MAX,
  AUTHOR_APPLICATION_TOPIC_MAX,
  type ApplicationRefusal,
  ApplicationProblemCodes,
  type AuthorApplicationIntake,
  AuthorApplicationFormatSchema,
} from "@ds/schemas";

import { applicationsCopy } from "../copy";

/** The «Другое» choice of «Специальность» (EARS-4); not a specialty code. */
export const SPECIALTY_OTHER = "__other__";

/**
 * EARS-4 — the form as the expert typed it. `specialty` is `""` (none), a
 * `specialties_minzdrav` code or {@link SPECIALTY_OTHER}; `format` is `""`
 * until one is chosen.
 */
export interface AuthorFormValues {
  topic: string;
  specialty: string;
  specialtyOther: string;
  format: string;
  about: string;
  consent: boolean;
}

/** The form fields in page order — the first invalid one takes focus (EARS-5). */
export const AUTHOR_FORM_FIELDS = [
  "topic",
  "specialty",
  "specialtyOther",
  "format",
  "about",
  "consent",
] as const;
export type AuthorFormField = (typeof AUTHOR_FORM_FIELDS)[number];

export type AuthorFormErrors = Partial<Record<AuthorFormField, string>>;

export type AuthorFormInvalid = {
  ok: false;
  errors: AuthorFormErrors;
  firstInvalid: AuthorFormField;
};
export type AuthorFormCheck =
  { ok: true; body: AuthorApplicationIntake } | AuthorFormInvalid;

export function emptyAuthorForm(): AuthorFormValues {
  return {
    topic: "",
    specialty: "",
    specialtyOther: "",
    format: "",
    about: "",
    consent: false,
  };
}

function invalid(errors: AuthorFormErrors): AuthorFormInvalid | null {
  const firstInvalid = AUTHOR_FORM_FIELDS.find((f) => errors[f] !== undefined);
  return firstInvalid ? { ok: false, errors, firstInvalid } : null;
}

/**
 * EARS-4, EARS-5 — check the form before anything is sent. Every field that
 * fails gets its own message; the values themselves are never touched, so the
 * page keeps what was typed. A valid form becomes the intake body (trimmed,
 * empty optional fields left out) stamped with the consent version tag the
 * page rendered (EARS-6).
 */
export function validateAuthorForm(
  values: AuthorFormValues,
  consentVersion: string,
): AuthorFormCheck {
  const e = applicationsCopy.errors;
  const errors: AuthorFormErrors = {};
  const topic = values.topic.trim();
  const other = values.specialtyOther.trim();
  const about = values.about.trim();
  const isOther = values.specialty === SPECIALTY_OTHER;
  const format = formatOf(values.format);

  if (topic.length === 0) errors.topic = e.topicRequired;
  else if (topic.length > AUTHOR_APPLICATION_TOPIC_MAX)
    errors.topic = e.topicTooLong;
  if (isOther && other.length === 0)
    errors.specialtyOther = e.specialtyOtherRequired;
  else if (isOther && other.length > AUTHOR_APPLICATION_SPECIALTY_OTHER_MAX)
    errors.specialtyOther = e.specialtyOtherTooLong;
  if (!format) errors.format = e.formatRequired;
  if (about.length > AUTHOR_APPLICATION_ABOUT_MAX)
    errors.about = e.aboutTooLong;
  if (!values.consent) errors.consent = e.consentRequired;

  const refused = invalid(errors);
  if (refused) return refused;
  // Unreachable: a missing format is an error above; narrows `format`.
  if (format === null) throw new Error("format checked above");
  return {
    ok: true,
    body: {
      topic,
      ...(isOther
        ? { specialtyOther: other }
        : values.specialty
          ? { specialtyCode: values.specialty }
          : {}),
      format,
      ...(about ? { about } : {}),
      consentVersion,
    },
  };
}

function formatOf(raw: string) {
  const parsed = AuthorApplicationFormatSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * EARS-5 — a `400` refusal's field errors on the same fields, with the same
 * first-invalid rule; `null` when the refusal names no form field.
 */
export function fieldErrorsFromRefusal(
  problems: ApplicationRefusal["problems"],
): AuthorFormInvalid | null {
  const e = applicationsCopy.errors;
  const errors: AuthorFormErrors = {};
  for (const p of problems) {
    if (p.code === ApplicationProblemCodes.specialtyUnknown)
      errors.specialty = e.specialtyUnknown;
    else if (p.code === ApplicationProblemCodes.consentVersionStale)
      errors.consent = e.consentStale;
  }
  return invalid(errors);
}
