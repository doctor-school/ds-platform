import { describe, expect, it } from "vitest";
import { mskLocalToInstant } from "@ds/schemas";
import { formatMskDateTime, instantToMskInput } from "./msk";

/**
 * 007 EARS-10 — the admin МСК presentation. Every absolute date/time renders in
 * `Europe/Moscow` from the stored canonical instant and never drifts to the
 * operator's local timezone. The formatter pins `timeZone: "Europe/Moscow"`, so
 * these assertions hold regardless of the machine's TZ (the same property the
 * Playwright `timezoneId` override asserts in the browser).
 */
describe("007 EARS-10 admin МСК formatting", () => {
  it("EARS-10: renders a canonical instant in Europe/Moscow (UTC+3), not UTC", () => {
    // 19:00 МСК on 2026-07-17 == 16:00Z; the label must read 19:00, not 16:00.
    const label = formatMskDateTime("2026-07-17T16:00:00.000Z");
    expect(label).toContain("19:00");
    expect(label).toContain("2026");
    expect(label).not.toContain("16:00");
  });

  it("EARS-10: instant → datetime-local pre-fill round-trips through the МСК wall-clock SSOT", () => {
    // The edit form pre-fill is the inverse of the write path's fold; a МСК entry
    // that folds to an instant must fold back to the same wall-clock string.
    const entry = "2026-07-17T19:00";
    const instant = mskLocalToInstant(entry).toISOString();
    expect(instantToMskInput(instant)).toBe(entry);
  });

  it("EARS-10: the pre-fill is МСК, not the machine-local rendering of the instant", () => {
    // Midnight МСК on 2026-01-01 is 21:00Z on 2025-12-31 — the input must show the
    // МСК wall-clock (00:00 on 2026-01-01), never the UTC/local date.
    expect(instantToMskInput("2025-12-31T21:00:00.000Z")).toBe(
      "2026-01-01T00:00",
    );
  });
});
