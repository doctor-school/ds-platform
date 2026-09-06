import { z } from "zod";

/**
 * Frontmatter contract for a legal document (028 design, "Content package
 * decision"). Local to this package on purpose: it validates authored files,
 * not an API payload, so it does not belong in `@ds/schemas`.
 */

/** Route segment shape — kebab-case, no leading/trailing/double dashes. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar date that actually exists (rejects e.g. `2026-02-30`). */
const isRealCalendarDate = (value: string): boolean => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
};

/**
 * `edition` is authored as a QUOTED string. YAML coerces a bare `2026-01-15`
 * scalar into a `Date` and, worse, silently rolls an impossible date over
 * (`2026-02-30` becomes 2 March), which would let a typo publish a wrong
 * «редакция от» date. Requiring the quotes keeps the authored text the text
 * that is validated; the unquoted form is rejected with that instruction.
 */
const editionSchema = z
  .string({
    error: (issue) =>
      issue.input instanceof Date
        ? 'edition must be quoted in the frontmatter (edition: "YYYY-MM-DD") — an unquoted YAML date is coerced to a timestamp'
        : "edition must be a string",
  })
  .regex(ISO_DATE_PATTERN, "edition must be an ISO date (YYYY-MM-DD)")
  .refine(isRealCalendarDate, "edition must be a real calendar date");

export const legalDocumentKindSchema = z.enum(["policy", "consent"]);

export const legalDocumentFrontmatterSchema = z.object({
  slug: z
    .string()
    .regex(SLUG_PATTERN, "slug must be kebab-case (a-z, 0-9, single dashes)"),
  title: z.string().trim().min(1, "title must not be empty"),
  edition: editionSchema,
  kind: legalDocumentKindSchema,
});

export type LegalDocumentKind = z.infer<typeof legalDocumentKindSchema>;
export type LegalDocumentFrontmatter = z.infer<
  typeof legalDocumentFrontmatterSchema
>;
