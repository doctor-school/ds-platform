import { z } from "zod";

import { E164 } from "../auth/auth.schema.js";
import { normaliseContactPhone } from "./contact-phone.js";
import { normaliseNameAnswer } from "./name-answer.js";

/**
 * Maximum length of a single free-text answer (surname … region).
 *
 * One ceiling for every text answer rather than a per-field table: none of
 * these fields has a meaningful natural limit, and the bound exists only so a
 * submission cannot carry an essay into a jsonb column. 200 characters is well
 * past any real workplace or region name.
 */
export const CONGRESS_SIGN_UP_ANSWER_MAX = 200;

/** A required free-text answer: trimmed, non-empty, bounded. */
const answer = () => z.string().trim().min(1).max(CONGRESS_SIGN_UP_ANSWER_MAX);

/**
 * 044 EARS-33 — a name answer: an ordinary answer, stored normalised.
 *
 * The bounds are checked on what the participant typed and then AGAIN on the
 * normalised value: `.min(1)` so that an answer of nothing but whitespace is
 * still a refusal rather than an empty string, `.max` so that the stored value
 * can never fall outside the shape the same declaration validates it against
 * when the answers column is read back.
 */
const nameAnswer = () =>
  answer()
    .transform(normaliseNameAnswer)
    .pipe(z.string().min(1).max(CONGRESS_SIGN_UP_ANSWER_MAX));

/**
 * The answer fields shared by the intake request and the stored answers shape.
 *
 * Declared once so the two can never drift: the column is validated by the same
 * contract that validates the submission, which is the property 044 design
 * §«Data model» relies on — «the column can never hold a shape the API would
 * reject».
 */
const answerFields = {
  surname: nameAnswer(),
  firstName: nameAnswer(),
  /**
   * 044 EARS-3 — the ONE optional answer. A patronymic is not universal (and
   * not universal among Russian names either), so a participant who has none
   * must be able to submit, not to type a placeholder.
   *
   * 044 EARS-33 — the three name answers, and only they, are normalised.
   * `workplace`, `city` and `region` are institution and place names whose own
   * capitalisation is not a two-rule affair («НМИЦ им. В. А. Алмазова»,
   * «Ростов-на-Дону»), so a blind title-case pass would corrupt them.
   */
  patronymic: nameAnswer().optional(),
  email: z.email().max(CONGRESS_SIGN_UP_ANSWER_MAX),
  /**
   * 044 EARS-3 — specialty as a `specialties_minzdrav` identifier, and nothing
   * else. The reserved «Другое / не медицинский работник» option is an ordinary
   * row of that table flagged `is_other`
   * (`packages/db/src/schema/specialties.ts`), so «an identifier OR the explicit
   * other option» is ONE field carrying one uuid. That is why there is no
   * companion free-text field and no discriminated union here: free text is
   * structurally unrepresentable rather than merely refused, which is the
   * strongest available reading of «never as free text». Whether the uuid names
   * a row that actually exists is the endpoint's check — the contract owns the
   * shape, the database owns existence.
   */
  specialtyId: z.uuid(),
  workplace: answer(),
  city: answer(),
  region: answer(),
} as const;

/**
 * 044 EARS-3 — the public congress sign-up submission (044 requirements
 * EARS-3; validated by the intake endpoint of #2298).
 *
 * Non-strict (`z.object`, like `DoctorRegisterRequestSchema`): an unknown key is
 * stripped, not a refusal, so a stale congress-site build that still posts a
 * retired field does not take every submission down with it. Two things the
 * client must NOT be able to send therefore fall out of the declaration itself
 * — a free-text specialty and a consent version. The consent version is
 * server-stamped from the published text (EARS-9, ADR-0009 §2.1); accepting a
 * caller-supplied one would let the submitter choose which version they are
 * recorded as having accepted.
 */
export const CongressSignUpRequestSchema = z.object({
  ...answerFields,
  /**
   * 044 EARS-29. Kept exactly as typed — the normalised form is derived, never
   * substituted (`toCongressSignUpAnswers`). The refusal is expressed on the
   * NORMALISED value rather than on the typed one: `+7 (999) 123-45-67` is a
   * perfectly good phone that no E.164 pattern matches, so validating the raw
   * string would reject the shape the form's own placeholder invites.
   */
  contactPhone: z
    .string()
    .trim()
    .min(1)
    .max(CONGRESS_SIGN_UP_ANSWER_MAX)
    .refine((typed) => E164.test(normaliseContactPhone(typed)), {
      message: "contactPhone must normalise to an E.164 phone number",
    }),
  /**
   * 044 EARS-3 — the personal-data consent, `z.literal(true)` rather than
   * `z.boolean()` for the reason the doctor-storefront declaration is
   * (`DoctorRegisterRequestSchema`): the acceptance is a PRECONDITION of the
   * command, so a payload carrying `false` is not a valid submission that later
   * fails a rule — it is not a congress sign-up at all. The VERSION accepted is
   * stamped server-side (EARS-9), so the client sends the acceptance and never
   * names what it accepted.
   */
  personalDataConsent: z.literal(true),
  /**
   * 044 EARS-1 bot-protection widget token. Optional at the contract layer,
   * mirroring `DoctorRegisterRequestSchema`: `BotProtectionGuard`
   * (`apps/api/src/bot-protection/bot-protection.guard.ts`) reads the
   * `x-smartcaptcha-token` header FIRST and falls back to this body field, and
   * it no-ops entirely when the provider is disabled (the dev-stand default).
   * Requiring it here would break the disabled-provider path and would refuse
   * the header-only caller before the guard ever ran.
   */
  captchaToken: z.string().optional(),
});
export type CongressSignUpRequest = z.infer<typeof CongressSignUpRequestSchema>;

/**
 * 044 EARS-5 — the STORED shape of `registrations.answers` (044 design
 * §«Data model»).
 *
 * Strict, unlike the request: the column is ours end to end, so an unknown key
 * in it is a writer bug and not a stale client. It differs from the request in
 * exactly three ways, each of them a decision:
 *
 *  - the phone is kept TWICE (EARS-29) — as typed, and normalised for the
 *    read-time «возможный дубль» derivation of EARS-30;
 *  - the consent acceptance is absent: consent is evidenced by its own
 *    append-only `consent_records` row with the server-stamped version
 *    (EARS-9), and a boolean copy here would be a second, weaker record of the
 *    same fact;
 *  - the captcha token is absent: it authorises one request and is meaningless
 *    afterwards.
 *
 * `null` in the column is the platform-origin registration (EARS-16) — a
 * signed-in doctor registering from the feed submits no answers at all.
 */
export const CongressSignUpAnswersSchema = z.strictObject({
  ...answerFields,
  /** The contact phone exactly as the participant typed it (EARS-29). */
  contactPhone: z.string().min(1).max(CONGRESS_SIGN_UP_ANSWER_MAX),
  /** The comparison key derived from it — E.164-shaped (EARS-29, EARS-30). */
  contactPhoneNormalised: z.string().regex(E164),
});
export type CongressSignUpAnswers = z.infer<typeof CongressSignUpAnswersSchema>;

/**
 * The ONLY assembler of the stored answers shape (044 EARS-5).
 *
 * It exists so no call site can hand-build the column value: hand-assembly is
 * where the normalised phone would quietly be written as the typed one, or the
 * captcha token would ride into storage. The endpoint slice parses the request
 * and hands the result here.
 */
export function toCongressSignUpAnswers(
  request: CongressSignUpRequest,
): CongressSignUpAnswers {
  return {
    surname: request.surname,
    firstName: request.firstName,
    ...(request.patronymic === undefined
      ? {}
      : { patronymic: request.patronymic }),
    email: request.email,
    specialtyId: request.specialtyId,
    workplace: request.workplace,
    city: request.city,
    region: request.region,
    contactPhone: request.contactPhone,
    contactPhoneNormalised: normaliseContactPhone(request.contactPhone),
  };
}
