import { describe, expect, it } from "vitest";

import { DEFAULT_AUTH_FLOW_COPY, consentStatementOf } from "./index";

/**
 * 021 EARS-5 / EARS-7 — the sentence a consent RECORD stores is the sentence
 * the door RENDERED.
 *
 * Before #2027 the two were separate literals: the door drew the package copy
 * and the host carried a second, older sentence that the record stamped. A row
 * written that way claims wording no doctor ever read, which is exactly what
 * ADR-0009's versioned per-purpose record exists to prevent. `consentStatementOf`
 * is the one composition both halves go through.
 */
describe("021 EARS-7: the recorded consent statement is the rendered one", () => {
  it("021 EARS-7.1: a statement is the row's label followed by its help line, in the order the canvas draws them", () => {
    expect(consentStatementOf({ label: "Подпись", help: "Пояснение." })).toBe(
      "Подпись Пояснение.",
    );
  });

  it("021 EARS-7.2: the partner-data statement is the rendered copy and names no data composition", () => {
    const row = DEFAULT_AUTH_FLOW_COPY.consents.partnerDataItem;

    expect(consentStatementOf(row)).toBe(`${row.label} ${row.help}`);
    // 021 EARS-5 (owner decision 2026-09-22): the item states the exchange; the
    // composition of the shared data is disclosed in the policy text and by the
    // platform manager, never enumerated inside the consent row.
    for (const field of ["ФИО", "специальность", "город", "место работы"]) {
      expect(consentStatementOf(row)).not.toContain(field);
    }
  });

  it("021 EARS-7.3: a row with no help line records its label alone", () => {
    // `help` is required on every row the door draws today; the composition must
    // still not invent a trailing space if a future row states none.
    expect(consentStatementOf({ label: "Подпись", help: "" })).toBe("Подпись");
  });
});
