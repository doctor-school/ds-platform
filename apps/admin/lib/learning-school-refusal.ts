import { LEARNING_SCHOOL_EXPERT_TAKEN } from "@ds/schemas";

/** A refused learning admin write as the transport throws it. */
export interface LearningSchoolRefusal {
  errorCode?: string;
  fieldErrors?: { path: string; message: string }[];
}

/** The leading expert already leads a school in this direction (023 EARS-26). */
export function isSchoolExpertTaken(entry: {
  path: string;
  message: string;
}): boolean {
  return (
    entry.path === "leadExpertId" &&
    entry.message === LEARNING_SCHOOL_EXPERT_TAKEN
  );
}

/**
 * 023 EARS-26 (#4018) — the catalog keys of the field errors a refused
 * «Новая школа» shows at its fields, by request path. A second school of the
 * same expert in the same direction is the «Ведущий эксперт» field's error;
 * the banner keeps the summary of every refusal.
 */
export function newSchoolFieldErrorKeys(
  error: unknown,
): Record<string, string> {
  const refusal = (error ?? {}) as LearningSchoolRefusal;
  const keys: Record<string, string> = {};
  for (const entry of refusal.fieldErrors ?? []) {
    if (isSchoolExpertTaken(entry))
      keys.leadExpertId = "learning.schools.expertTaken";
  }
  return keys;
}
