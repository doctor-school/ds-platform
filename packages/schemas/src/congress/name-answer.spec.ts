import { describe, expect, it } from "vitest";

import { normaliseNameAnswer } from "./name-answer.js";

/**
 * 044 EARS-33 — the name-answer normaliser (044 design §«Name-answer
 * normalisation»).
 *
 * Unlike the contact phone, whose normalised form is a derived comparison key
 * kept BESIDE the typed value, the name answers are stored normalised and only
 * normalised: the roster and the account display name are read by organisers
 * and by the participant, so the typed casing is noise rather than evidence.
 * What is pinned here is therefore the rule itself plus idempotency — the same
 * `answerFields` declaration validates the intake request AND the stored
 * column, so this transform runs again on every read-back of the answers.
 *
 * The end-to-end write on a registration row and on `users.display_name` is
 * V-24, an `apps/api` e2e landing with the intake endpoint.
 */
describe("044 EARS-33: name-answer normalisation", () => {
  it("044 EARS-33.1: surrounding whitespace is stripped and the name is capitalised", () => {
    expect(normaliseNameAnswer("  иван ")).toBe("Иван");
  });

  it("044 EARS-33.2: a hyphenated compound capitalises both parts", () => {
    expect(normaliseNameAnswer("анна-мария")).toBe("Анна-Мария");
  });

  it("044 EARS-33.3: an all-caps answer is lower-cased past the first letter", () => {
    expect(normaliseNameAnswer("ПЕТРОВ")).toBe("Петров");
  });

  it("044 EARS-33.4: an internal whitespace run collapses to a single space", () => {
    expect(normaliseNameAnswer("салтыков   щедрин")).toBe("Салтыков Щедрин");
  });

  it("044 EARS-33.5: an apostrophe is a segment boundary, both typographic forms", () => {
    expect(normaliseNameAnswer("д'артаньян")).toBe("Д'Артаньян");
    expect(normaliseNameAnswer("д’артаньян")).toBe("Д’Артаньян");
  });

  it("044 EARS-33.6: a non-breaking space and a tab are whitespace like any other", () => {
    expect(normaliseNameAnswer("\u00a0салтыков\u00a0\tщедрин\u00a0")).toBe(
      "Салтыков Щедрин",
    );
  });

  it("044 EARS-33.7: «ё» survives the case pass in both positions", () => {
    expect(normaliseNameAnswer("  ЁЖИКОВ  пётр ")).toBe("Ёжиков Пётр");
  });

  it("044 EARS-33.8: a Latin name normalises by the same rule", () => {
    expect(normaliseNameAnswer("  jOHN  o'NEILL ")).toBe("John O'Neill");
  });

  it("044 EARS-33.9: the transform is idempotent — the answers column is re-parsed on every read", () => {
    for (const typed of [
      "  иван ",
      "анна-мария",
      "ПЕТРОВ",
      "салтыков   щедрин",
      "д'артаньян",
      "jOHN  o'NEILL",
    ]) {
      const once = normaliseNameAnswer(typed);
      expect(normaliseNameAnswer(once)).toBe(once);
    }
  });

  it("044 EARS-33.10: the normalised value is never longer than the input, so the bound still holds", () => {
    for (const typed of ["  иван ", "салтыков   щедрин", "ПЕТРОВ"]) {
      expect(normaliseNameAnswer(typed).length).toBeLessThanOrEqual(
        typed.length,
      );
    }
  });

  it("044 EARS-33.11: a whitespace-only answer normalises to the empty string, which `.min(1)` refuses", () => {
    expect(normaliseNameAnswer("   \u00a0 ")).toBe("");
  });
});
