"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { zodResolver } from "@hookform/resolvers/zod";
import type { FieldValues, Resolver } from "react-hook-form";
import type { z } from "zod";

/**
 * Localized zod→RHF resolver boundary for the admin forms (#665).
 *
 * The validation schemas are DERIVED from `@ds/schemas` (the cross-app SSOT,
 * ADR-0002) and carry ENGLISH zod messages — that package is consumed by `apps/api`
 * too, where a Russian DTO error would be wrong, so it is deliberately out of scope
 * to localize. The admin app owns the *rendering* of those errors, so this is the
 * clean seam (the same pattern the portal auth forms use, #177/#188): a client-side
 * zod error map that translates the schema's structured issues (`code` + shape +
 * field path, NOT the English message text) into the `events.validation.*` RU
 * catalog (EARS-10). The design-system `<FormMessage>` then renders the localized
 * string inline under its control with no English left, on blur (`mode: onTouched`).
 *
 * Keying off the issue *code/shape* (never the English message) keeps it robust to
 * copy edits upstream: a `@ds/schemas` message rewrite cannot silently degrade a
 * field to the generic fallback. A brand-new rule that this map does not handle is
 * caught by `use-localized-resolver.test.ts`, which drives every admin-form schema's
 * real rules through `translateIssue` and asserts none resolves to `fallback`.
 */
export function useLocalizedResolver<TFieldValues extends FieldValues, Out>(
  schema: z.ZodType<Out, TFieldValues>,
  namespace: "events.validation" | "login.validation" = "events.validation",
): Resolver<TFieldValues, unknown, Out> {
  const t = useTranslations(namespace);

  return useMemo(
    () =>
      zodResolver(schema, {
        error: (issue) => translateIssue(issue, t),
      }) as Resolver<TFieldValues, unknown, Out>,
    [schema, t],
  );
}

/** A zod v4 issue, narrowed to the fields we branch on. */
export interface ZodIssueLike {
  code: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  format?: string;
  path?: PropertyKey[];
  message?: string;
  /** `custom`-issue params (e.g. the SSOT `EMBED_REF_SHAPES` provider tag). */
  params?: Record<string, unknown>;
}

export type Translator = (key: string) => string;

/**
 * Map a structured zod issue to a RU catalog string. Keys off the issue's `code`,
 * shape (length bound, format, custom refine), and field path — never the English
 * text — so a copy edit in `@ds/schemas` never silently falls back to English.
 * Exported for the drift-guard test; production code reaches it via the resolver.
 */
export function translateIssue(issue: ZodIssueLike, t: Translator): string {
  const path = issue.path ?? [];
  const has = (key: string) => path.includes(key);

  // Stream `embedRef` (EARS-3, #1134): a `custom` issue is either the SSOT
  // per-provider shape refinement (`EMBED_REF_SHAPES`, tagged `params.shape` —
  // the Stage-B «ччсапп» garbage-id class #665, incl. vk's malformed triple and
  // cdnvideo's non-allowlisted URL) or the URL guard (untagged) — "paste the whole
  // share link" gets its own actionable copy (never fired for cdnvideo, whose
  // reference IS a URL).
  if (has("embedRef")) {
    if (issue.code === "custom") {
      const shape = issue.params?.shape;
      if (shape === "rutube") return t("embedRefRutube");
      if (shape === "youtube") return t("embedRefYoutube");
      if (shape === "vk") return t("embedRefVk");
      if (shape === "cdnvideo") return t("embedRefCdnvideo");
      return t("embedRefUrl");
    }
    if (issue.code === "too_big") return t("maxLength");
    return t("required");
  }

  // Admin login (007 EARS-8 surface, #665 rework): the email box renders the
  // email-shape guidance for any violation (empty or malformed — `z.email()`
  // reports both as `invalid_format`); the current-password box mirrors the
  // portal copy: too short (incl. empty, the SSOT min-8 login guard) vs too long.
  if (has("email")) return t("email");
  if (has("password")) {
    return issue.code === "too_big" ? t("maxLength") : t("passwordTooShort");
  }

  // Duration (minutes) — a positive integer, ≤ 24h. An empty/NaN/zero/negative
  // value all resolve to the same "≥ 1 minute" guidance; an over-cap value to its own.
  if (has("durationMin")) {
    return issue.code === "too_big" ? t("durationMax") : t("duration");
  }

  // МСК wall-clock — an empty or malformed datetime both surface here (regex).
  if (has("startsAtMsk")) return t("dateTime");

  // Speaker name — required when a speaker row is present.
  if (has("speakers")) {
    if (has("name") && issue.code === "too_small") return t("speakerName");
    return t("maxLength");
  }

  // Target specialties (the parsed comma list) — a `custom` issue flags "too many
  // specialties" (list-count cap); any other issue flags a per-token length problem.
  if (has("specialtiesText")) {
    return issue.code === "custom" ? t("specialtyCount") : t("specialty");
  }

  switch (issue.code) {
    // A missing required field surfaces as invalid_type (undefined → string) or a
    // too_small on the min-1 bound — both are the required-field message.
    case "invalid_type":
    case "too_small":
      return t("required");
    case "too_big":
      return t("maxLength");
    default:
      return t("fallback");
  }
}
