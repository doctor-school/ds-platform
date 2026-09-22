/**
 * 044 EARS-33 — name-answer normalisation (044 design §«Name-answer
 * normalisation»).
 *
 * The congress form is filled by participants on a public site, so the three
 * name answers arrive with leading spaces, doubled spaces and whatever the
 * phone keyboard decided about capitalisation. Those answers are not private
 * bookkeeping: they are what an organiser reads off the event roster and what
 * `users.display_name` is derived from, so «  иван » must become «Иван» before
 * it is stored.
 *
 * Unlike the contact phone (`normaliseContactPhone`), whose normalised form is
 * a derived comparison key kept BESIDE the typed value, only the normalised
 * name is stored — there is no downstream use for the typed casing, and keeping
 * both would give the roster two names to choose between.
 *
 * Server-side rather than an input mask: the site's JavaScript is not part of
 * the trust boundary (the intake endpoint is public and accepts any well-formed
 * body), and a mask would fight the participant mid-word while they type.
 *
 * The rule is deliberately dumb and locale-independent: collapse whitespace,
 * then upper-case the first character of every segment and lower-case the rest,
 * where a segment ends at a space, a hyphen or an apostrophe («Анна-Мария»,
 * «Д'Артаньян», «Салтыков Щедрин»). `toUpperCase`/`toLowerCase` without a
 * locale argument handle Cyrillic and Latin alike, «ё» included. No dictionary
 * of particles («van», «де»): guessing wrong about a participant's own name is
 * worse than the consistent, predictable pass.
 *
 * It is IDEMPOTENT by construction, and it has to be: `answerFields` validates
 * the stored `registrations.answers` column with the same declaration it
 * validates the intake request with, so this transform runs again on every
 * read-back of a row it already normalised.
 */

/** Any run of whitespace, non-breaking space and tab included. */
const WHITESPACE_RUN = /\s+/gu;

/**
 * One name segment: everything up to a space, a hyphen or an apostrophe. Both
 * apostrophe forms are boundaries — a phone keyboard emits the typographic `’`
 * where a desktop emits `'`, and the participant means the same name.
 */
const SEGMENT = /[^ '’-]+/gu;

export function normaliseNameAnswer(typed: string): string {
  const collapsed = typed.replace(WHITESPACE_RUN, " ").trim();

  return collapsed.replace(
    SEGMENT,
    (segment) =>
      segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase(),
  );
}
