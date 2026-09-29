import {
  CONGRESS_INTAKE_CLOSING_NOT_AFTER_OPENING,
  CONGRESS_INTAKE_OPENING_WITHOUT_CLOSING,
  CONGRESS_SUBMISSION_KINDS,
  type CongressIntakeSettings,
  type CongressIntakeSettingsRequest,
  type CongressSubmissionKind,
} from "@ds/schemas";

/**
 * 046 EARS-2 / EARS-3 (#2432) — the admin projection of one event's congress
 * intake settings (`GET` / `PUT /v1/admin/events/:id/congress-intake-settings`).
 *
 * The form holds what the inputs hold — strings, a boolean — and this module is
 * the one place that turns the read into those strings and the strings back into
 * the PUT body. Validation is the server's (`CongressIntakeSettingsRequestSchema`,
 * the SSOT): the screen maps each refusal the server returns to the field it
 * names, by the issue's path and machine code, never by its message text.
 */

/** The kinds in the reading order of the screen (046-design «Data model»). */
export const INTAKE_KIND_ORDER: readonly CongressSubmissionKind[] =
  CONGRESS_SUBMISSION_KINDS;

export interface IntakeKindFields {
  opensOn: string;
  lastDay: string;
  submitLimit: string;
  maxAgeYears: string;
}

export interface IntakeFormFields {
  registrationUrl: string;
  firstAuthorCounts: boolean;
  kinds: Record<CongressSubmissionKind, IntakeKindFields>;
}

const text = (value: string | number | null): string =>
  value === null ? "" : String(value);

/**
 * The form an event's settings read into. An event without a settings row
 * (`configured: false`) reads as the product defaults the server sends with it,
 * so the prefill is the server's, not a copy kept here (EARS-2).
 */
export function intakeFormFields(
  settings: Pick<
    CongressIntakeSettings,
    "registrationUrl" | "firstAuthorCounts" | "kinds"
  >,
): IntakeFormFields {
  const kinds = {} as Record<CongressSubmissionKind, IntakeKindFields>;
  for (const kind of INTAKE_KIND_ORDER) {
    const k = settings.kinds[kind];
    kinds[kind] = {
      opensOn: text(k.opensOn),
      lastDay: text(k.lastDay),
      submitLimit: text(k.submitLimit),
      maxAgeYears: text(k.maxAgeYears),
    };
  }
  return {
    registrationUrl: text(settings.registrationUrl),
    firstAuthorCounts: settings.firstAuthorCounts,
    kinds,
  };
}

const orNull = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

/**
 * A number field's value: empty is `null` (unlimited / no age limit). A
 * `type="number"` input yields "" for anything that is not a number, so what
 * reaches here is empty or numeric; a fraction or a zero goes to the server as
 * entered and comes back as that field's refusal.
 */
const numberOrNull = (value: string): number | null => {
  const trimmed = value.trim();
  return trimmed === "" ? null : Number(trimmed);
};

/** The PUT body for the entered form. */
export function intakeRequest(
  fields: IntakeFormFields,
): CongressIntakeSettingsRequest {
  const kinds = {} as CongressIntakeSettingsRequest["kinds"];
  for (const kind of INTAKE_KIND_ORDER) {
    const k = fields.kinds[kind];
    kinds[kind] = {
      opensOn: orNull(k.opensOn),
      lastDay: orNull(k.lastDay),
      submitLimit: numberOrNull(k.submitLimit),
      maxAgeYears: numberOrNull(k.maxAgeYears),
    };
  }
  return {
    registrationUrl: orNull(fields.registrationUrl),
    firstAuthorCounts: fields.firstAuthorCounts,
    kinds,
  };
}

/** A form field a refusal can name, in react-hook-form path notation. */
export type IntakeFieldPath =
  | "registrationUrl"
  | `kinds.${CongressSubmissionKind}.${keyof IntakeKindFields}`;

/** Why a field was refused — the key of its RU sentence (`congressIntake.refusals.*`). */
export type IntakeRefusalReason =
  | "openingWithoutClosing"
  | "closingBeforeOpening"
  | "submitLimit"
  | "maxAgeYears"
  | "registrationUrl"
  | "day";

export interface IntakeRefusal {
  field: IntakeFieldPath;
  reason: IntakeRefusalReason;
}

const KIND_FIELDS: readonly (keyof IntakeKindFields)[] = [
  "opensOn",
  "lastDay",
  "submitLimit",
  "maxAgeYears",
];

function refusalOf(issue: unknown): IntakeRefusal | null {
  if (typeof issue !== "object" || issue === null) return null;
  const { path, params } = issue as { path?: unknown; params?: unknown };
  if (!Array.isArray(path)) return null;
  const code =
    typeof params === "object" && params !== null
      ? (params as { code?: unknown }).code
      : undefined;
  if (path.length === 1 && path[0] === "registrationUrl") {
    return { field: "registrationUrl", reason: "registrationUrl" };
  }
  const [root, kind, name] = path as unknown[];
  if (
    path.length !== 3 ||
    root !== "kinds" ||
    !INTAKE_KIND_ORDER.includes(kind as CongressSubmissionKind) ||
    !KIND_FIELDS.includes(name as keyof IntakeKindFields)
  ) {
    return null;
  }
  const field =
    `kinds.${kind as CongressSubmissionKind}.${name as keyof IntakeKindFields}` as const;
  if (code === CONGRESS_INTAKE_OPENING_WITHOUT_CLOSING) {
    return { field, reason: "openingWithoutClosing" };
  }
  if (code === CONGRESS_INTAKE_CLOSING_NOT_AFTER_OPENING) {
    return { field, reason: "closingBeforeOpening" };
  }
  if (name === "submitLimit") return { field, reason: "submitLimit" };
  if (name === "maxAgeYears") return { field, reason: "maxAgeYears" };
  return { field, reason: "day" };
}

/**
 * The field refusals in a `400` body's issue list — one per field, first issue
 * wins. Anything that is not a recognisable field issue is dropped: an empty
 * result tells the caller to show the general refusal instead.
 */
export function intakeRefusals(issues: unknown): IntakeRefusal[] {
  if (!Array.isArray(issues)) return [];
  const seen = new Set<IntakeFieldPath>();
  const refusals: IntakeRefusal[] = [];
  for (const issue of issues) {
    const refusal = refusalOf(issue);
    if (!refusal || seen.has(refusal.field)) continue;
    seen.add(refusal.field);
    refusals.push(refusal);
  }
  return refusals;
}

/**
 * A stored calendar day (`YYYY-MM-DD`, already a Moscow day — EARS-3) as the
 * screen prints it: `20.11.2026`. A string reshuffle, not a `Date`: the value is
 * a calendar day, and no timezone may move it.
 */
export function formatIntakeDay(day: string): string {
  const [year, month, date] = day.split("-");
  return `${date}.${month}.${year}`;
}
