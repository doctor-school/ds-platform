import { describe, expect, it } from "vitest";
import { LEARNING_SCHOOL_EXPERT_TAKEN } from "@ds/schemas";
import { newSchoolFieldErrorKeys } from "./learning-school-refusal";

/**
 * 023 EARS-26 (#4018) — a refused «Новая школа» names its field: a second
 * school of the same expert in the same direction is the «Ведущий эксперт»
 * field's own error, not only a banner line.
 */
describe("new school refusals", () => {
  it("EARS-26: a duplicate expert+direction is the leading expert field's error", () => {
    expect(
      newSchoolFieldErrorKeys({
        errorCode: "VALIDATION_FAILED",
        fieldErrors: [
          { path: "leadExpertId", message: LEARNING_SCHOOL_EXPERT_TAKEN },
        ],
      }),
    ).toEqual({ leadExpertId: "learning.schools.expertTaken" });
  });

  it("EARS-26: other refusals name no field line", () => {
    expect(newSchoolFieldErrorKeys({ errorCode: "SLUG_CONFLICT" })).toEqual({});
    expect(
      newSchoolFieldErrorKeys({
        errorCode: "VALIDATION_FAILED",
        fieldErrors: [{ path: "leadExpertId", message: "Required" }],
      }),
    ).toEqual({});
    expect(newSchoolFieldErrorKeys(undefined)).toEqual({});
  });
});
