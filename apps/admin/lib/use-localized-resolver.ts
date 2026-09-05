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
  namespace:
    | "events.validation"
    | "login.validation"
    | "projects.validation"
    | "experts.validation"
    | "partners.validation"
    | "directions.validation"
    | "directionSpecialties.validation"
    | "directionAdjacency.validation"
    | "recordings.validation"
    | "eventExperts.validation" = "events.validation",
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

  // 012 project authoring (#1283). The slug box carries two DISTINCT refusals —
  // wrong grammar vs the forbidden id namespace (a canonical UUID slug would make
  // `/:idOrSlug` ambiguous) — and an operator can only fix what the message names,
  // so they are separate strings rather than one "invalid slug".
  if (has("slug")) {
    if (issue.code === "custom") return t("slugReserved");
    if (issue.code === "invalid_format") return t("slugPattern");
    if (issue.code === "too_big") return t("maxLength");
    return t("required");
  }
  if (has("kind")) return t("kind");

  // 012 partner authoring (#1286, EARS-4). The website box is an ABSOLUTE https
  // address (the SSOT regex — the exact twin of the DB CHECK), so a malformed
  // value arrives as `invalid_format` and would otherwise reach `fallback`
  // («проверьте значение») — a sentence that does not tell the operator the one
  // thing they need to know, that the address must start with https://.
  if (has("websiteUrl")) {
    if (issue.code === "too_big") return t("maxLength");
    return t("pattern");
  }

  // 012 expert authoring (#1284): name / professional role / credentials /
  // affiliation / bio all fail on exactly two shapes — empty (`too_small` on the
  // SSOT min-1) and over-long (`too_big`) — which the generic tail below already
  // maps to `required` / `maxLength`. No per-field branch is added for them: a
  // branch that only repeats the default would be dead code pretending to be a
  // rule. The drift guard in `use-localized-resolver.test.ts` drives the real
  // ExpertFormSchema rules and fails if any of them ever reaches `fallback`.
  // 014 recordings (#1339). The poster box is a bounded free-text reference;
  // the duration box is a TEXT box holding seconds, so an empty/garbage/zero
  // value and an over-24h value are two different fixes and get two sentences.
  // The readiness date box: every refusal it can produce — an empty-but-not-empty
  // buffer, the wrong shape, and a day that is not on the calendar — has the same
  // fix, «type ГГГГ-ММ-ДД», so it is one sentence rather than three near-identical
  // ones. It arrives as a `custom` issue (the form schema folds the SSOT day check
  // into one refinement), which the generic tail below would send to `fallback`.
  // 012 EARS-7 event↔expert link (#1289). The expert box is a SELECTOR, so its
  // only refusal is «nothing chosen» — and «обязательное поле» under a dropdown
  // does not say what to do, while «выберите эксперта из списка» does. The place
  // box is a TEXT box holding an integer slot: empty / non-numeric / negative all
  // share one fix (type a whole number in range), while an over-cap value is its
  // own sentence. The role box falls through to required/maxLength below.
  if (has("expertId")) return t("expert");
  if (has("positionText")) {
    return issue.code === "too_big" ? t("positionMax") : t("position");
  }

  // #1483 direction relations. Every box here is a SELECTOR (`kind` included —
  // it is a Combobox over the closed SSOT vocabulary), and «обязательное поле»
  // under a dropdown does not say what to do —
  // so each endpoint gets its own «выберите … из списка». The two ids arrive as
  // `invalid_format` on an empty string (the SSOT id is a `z.uuid()`), which the
  // generic tail below maps to `fallback`, so the branches are load-bearing
  // rather than cosmetic. The self-edge refusal is a `custom` issue on the
  // ADJACENT box and reads as its own sentence: «выберите смежное направление»
  // would be advice the operator has already followed.
  if (has("specialtyMinzdravId")) return t("specialty");
  if (has("adjacentDirectionId")) {
    return issue.code === "custom" ? t("selfEdge") : t("adjacentDirection");
  }
  if (has("directionId")) return t("direction");
  if (has("expectedBy")) return t("expectedBy");
  // 014 EARS-24 (#1741): the recording block the «Это архивный эфир» checkbox
  // opens INSIDE the event form arrives nested (`recording.*`) and needs no
  // branch of its own — it asks for a provider and an embed reference only, and
  // every branch above already keys off those leaf names. Poster and duration
  // are the attach dialog's own boxes (and, from #1611, an upload and a metadata
  // read), so their sentences stay where the dialog's flat paths hit them.
  if (has("posterRef")) return t("maxLength");
  if (has("durationSecText")) {
    return issue.code === "too_big" ? t("durationMax") : t("duration");
  }

  // Duration (minutes) — a positive integer, ≤ 24h. An empty/NaN/zero/negative
  // value all resolve to the same "≥ 1 minute" guidance; an over-cap value to its own.
  if (has("durationMin")) {
    return issue.code === "too_big" ? t("durationMax") : t("duration");
  }

  // МСК wall-clock — an empty or malformed datetime both surface here (regex).
  if (has("startsAtMsk")) return t("dateTime");

  // 012 EARS-24 (#1607): the event form carries no free-text speaker list any
  // more — speakers are `event_experts` links — so no `speakers.*` issue path
  // can reach this resolver and there is no speaker-specific message.

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
