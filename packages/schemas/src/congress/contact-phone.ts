/**
 * 044 EARS-29 — contact-phone normalisation (044 design §«Contact-phone
 * normalisation and the possible-duplicate derivation»).
 *
 * The congress form is filled by participants, not by the platform, so the same
 * number arrives written five different ways. The normalised form exists for
 * ONE job: letting two submissions of the same event be compared, which is what
 * the read-time «возможный дубль» marker of EARS-30 is derived from. It is a
 * comparison key, never a replacement for what the participant typed — the
 * answers keep both (`CongressSignUpAnswersSchema`), and neither value ever
 * reaches `users.phone` (UNIQUE, a login identifier).
 *
 * The rule is deliberately the SAME one the client-side input mask already
 * applies (`maskPhoneInput`,
 * `packages/design-system/src/primitives/fields/phone-mask.ts`): strip
 * everything that is not a digit, rewrite a domestic-length (11-digit) leading
 * `8` to the `7` country code, cap at the E.164 maximum of 15 digits, prefix
 * `+`. Two implementations rather than an import because this function is a
 * pure `@ds/schemas` primitive and `@ds/schemas` depends on `zod` alone — a
 * design-system import would drag a React package into the API contract SSOT.
 * The rules agreeing is the point, and the spec above states it once for both.
 *
 * The `8 → 7` rewrite is gated to 11 digits for the same reason the mask gates
 * it: a pasted international number that merely starts with `8` (a 12-digit
 * `+81 90…` Japan mobile) must not be corrupted into `+71…`.
 */
export function normaliseContactPhone(typed: string): string {
  const digits = typed.replace(/\D/g, "");
  // No digits at all is the empty string, never a bare `+`: a lone plus would
  // read as a phone to anything that checks only the prefix, and the intake
  // schema's E.164 refusal depends on this staying empty.
  if (digits === "") return "";

  const domestic =
    digits.length === 11 && digits.startsWith("8")
      ? `7${digits.slice(1)}`
      : digits;

  return `+${domestic.slice(0, 15)}`;
}

/**
 * 044 EARS-36 — the ONE display format of a congress contact phone in the admin
 * (roster, participant card, 046 submission card).
 *
 * Built from the normalised value, never from what was typed, so one number
 * written two ways reads identically side by side (the possible-duplicate pair
 * of EARS-30 is exactly that case). A Russian `+7` number of 10 national digits
 * groups as `+7 (XXX) XXX-XX-XX`; any other number renders as its plain
 * normalised E.164 `+<digits>` — per-country grouping is out of scope.
 *
 * The input goes through `normaliseContactPhone` first, so a value that is not
 * yet E.164 (the `users.phone` fallback of a platform-origin row) formats the
 * same way. No digits → the empty string.
 *
 * Not to be confused with `maskPhoneInput` (design-system): that is the input
 * mask of the form field and is intentionally ungrouped.
 */
export function formatContactPhone(value: string): string {
  const normalised = normaliseContactPhone(value);
  const russian = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(normalised);
  if (russian === null) return normalised;
  const [, area, first, second, third] = russian;
  return `+7 (${area}) ${first}-${second}-${third}`;
}
