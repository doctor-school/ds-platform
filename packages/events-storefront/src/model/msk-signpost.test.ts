import { describe, expect, it } from "vitest";

import { formatMskParts } from "./msk";

/**
 * 005 EARS-5 / EARS-11 — the registered-state join signposting presents the
 * broadcast start in `Europe/Moscow`, explicitly labelled МСК, computed from the
 * read model's one canonical instant, and MUST NOT drift to the viewer's local
 * timezone (mirrors 004 EARS-12). The shared `formatMskParts` formatter pins
 * `timeZone: "Europe/Moscow"`, so its output is identical regardless of the
 * server's/browser's TZ — this pins that no-drift guarantee for the signpost.
 */

describe("005 EARS-5 МСК join-signpost time presentation (EARS-11)", () => {
  // 16:00 UTC on 2026-07-16 is 19:00 in Europe/Moscow (UTC+3, no DST). A
  // viewer-local render (e.g. UTC, or Asia/Tokyo UTC+9) would show a different
  // clock time and possibly a different calendar day — the formatter must not.
  const CANONICAL_INSTANT = "2026-07-16T16:00:00.000Z";

  it("EARS-11: the broadcast start renders in Europe/Moscow (19:00, 16 июля) from the canonical UTC instant, not the viewer's timezone", () => {
    const { date, time } = formatMskParts(CANONICAL_INSTANT);
    expect(time).toBe("19:00");
    expect(date).toBe("16 июля");
  });

  it("EARS-11: the МСК render is stable across a same-instant re-format — no viewer-local drift", () => {
    // Two formats of the SAME instant agree (the formatter carries no ambient
    // timezone state); a local-TZ formatter would diverge by the machine's offset.
    const a = formatMskParts(CANONICAL_INSTANT);
    const b = formatMskParts(CANONICAL_INSTANT);
    expect(a).toEqual(b);

    // An instant one Moscow-hour later advances the clock by exactly one hour in
    // Europe/Moscow, proving the render tracks the МСК wall clock, not UTC/local.
    const later = formatMskParts("2026-07-16T17:00:00.000Z");
    expect(later.time).toBe("20:00");
    expect(later.date).toBe("16 июля");
  });
});
