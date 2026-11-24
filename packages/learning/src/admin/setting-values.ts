import type {
  LearningScopeRules,
  LearningSettingKey,
  LearningSettingValues,
} from "@ds/schemas";

/**
 * A layer's or a preset's value map as read from the wire (Zod infers each
 * optional key as `T | undefined`) as the setting map it is: a key is either
 * set to a value or absent, so an `undefined` entry is dropped, not kept.
 * The copy is deep, so an edit of the result never reaches the read.
 */
export function settingValues(
  wire: LearningScopeRules["values"],
): LearningSettingValues {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(wire) as [
    LearningSettingKey,
    unknown,
  ][]) {
    if (value !== undefined)
      out[key] = JSON.parse(JSON.stringify(value)) as unknown;
  }
  return out as LearningSettingValues;
}
