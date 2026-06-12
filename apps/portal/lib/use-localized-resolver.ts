"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { zodResolver } from "@hookform/resolvers/zod";
import type { FieldValues, Resolver } from "react-hook-form";
import type { z } from "zod";

/**
 * Localized zod→RHF resolver boundary (#177).
 *
 * The validation schemas live in `@ds/schemas` (the cross-app SSOT) and carry
 * ENGLISH zod messages — and that package is intentionally out of this slice's
 * scope to localize (it is consumed by `apps/api` too, where a Russian DTO error
 * would be wrong). The portal owns the *rendering* of those errors, so this is the
 * clean seam: a portal-side zod error map that translates the schema's structured
 * issues (`code` + shape, NOT the English message text) into the `errors.validation.*`
 * RU catalog. `<FormMessage>` then renders the localized string with no English left.
 *
 * Decision-debt (documented seam, follow-up not in #177): localization keys off the
 * zod issue *code/shape*, not the English message, so it is robust to copy edits in
 * `@ds/schemas` — but a brand-new validation rule there needs a matching key added
 * here. If `@ds/schemas` later adopts a first-class i18n message strategy (zod v4
 * global locale / message keys), this resolver collapses to a thin pass-through. The
 * canonical RU error copy authored here is what #175 (error-display rule) consumes.
 */
export function useLocalizedResolver<TFieldValues extends FieldValues, Out>(
  schema: z.ZodType<Out, TFieldValues>,
): Resolver<TFieldValues, unknown, Out> {
  const t = useTranslations("errors.validation");

  return useMemo(
    () =>
      zodResolver(schema, {
        error: (issue) => translateIssue(issue, t),
      }) as Resolver<TFieldValues, unknown, Out>,
    [schema, t],
  );
}

/** A zod v4 issue, narrowed to the fields we branch on. */
interface ZodIssueLike {
  code: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  format?: string;
  validation?: string;
  path?: PropertyKey[];
  message?: string;
}

type Translator = (key: string) => string;

/**
 * Map a structured zod issue to a RU catalog string. Keys off the issue's `code`
 * and shape (length bound, format, refine identity), never the English text, so
 * copy edits upstream don't silently fall back to English.
 */
function translateIssue(issue: ZodIssueLike, t: Translator): string {
  const field = issue.path?.[issue.path.length - 1];

  switch (issue.code) {
    case "invalid_type":
      // A missing required field surfaces as invalid_type (undefined → string).
      return t("required");

    case "too_small": {
      const min = Number(issue.minimum ?? 0);
      if (min >= 8) return t("passwordTooShort");
      // min 1 — a required scalar; name the field where the copy differs.
      if (field === "code") return t("codeRequired");
      if (field === "identifier") return t("identifierRequired");
      return t("required");
    }

    case "too_big":
      return t("passwordTooLong");

    case "invalid_format":
      // z.email() and the E.164 / complexity regex all surface here in zod v4.
      if (issue.format === "email" || issue.validation === "email") {
        return t("email");
      }
      // The creation-password complexity regex vs the E.164 phone regex: the only
      // regex on a `password`/`newPassword` field is the complexity baseline.
      if (field === "password" || field === "newPassword") {
        return t("passwordComplexity");
      }
      // E.164 phone guard — the `phone` registration field, or the portal-side
      // `identifier` box in the OTP SMS channel (#192). Both surface as a regex
      // format issue and want the same "+79991234567" guidance.
      if (field === "phone" || field === "identifier") return t("phone");
      return t("fallback");

    case "invalid_union":
      // The portal-side password-login identifier guard (#192): `identifier`
      // accepts EITHER a valid email OR an E.164 phone, so a malformed value (a
      // bare numeric string / free text) fails the union. Render the same
      // "email or phone" copy the dual-identifier refine uses.
      return t("identifierRequired");

    case "custom":
      // The dual-identifier `.refine` ("exactly one of email or phone").
      return t("identifierRequired");

    default:
      return t("fallback");
  }
}
