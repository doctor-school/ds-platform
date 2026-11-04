import { describe, expect, it } from "vitest";
import { formatMaterialDate } from "./material-dates";

describe("formatMaterialDate — the first-publication date (048 EARS-7)", () => {
  it("048 EARS-7: renders the МСК calendar day as ДД.ММ.ГГГГ", () => {
    expect(formatMaterialDate("2026-10-27T09:00:00.000Z")).toBe("27.10.2026");
  });

  it("048 EARS-7: an instant after midnight МСК is the МСК day, not the UTC one", () => {
    expect(formatMaterialDate("2026-10-26T21:30:00.000Z")).toBe("27.10.2026");
  });
});
