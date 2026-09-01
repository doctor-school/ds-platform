import type { EventPlayback, RecordingProjection } from "@ds/schemas";
import { describe, expect, it } from "vitest";
import {
  formatReadinessDay,
  resolveRecordingPlaque,
  resolvePlayerCard,
  resolveRecordingSignal,
} from "./recording-signal";

/** The api's projection shape, with only the field under test varied. */
function projection(
  over: Partial<RecordingProjection> = {},
): RecordingProjection {
  return {
    state: "preparing",
    primaryKind: null,
    secondaryKind: null,
    posterUrl: null,
    expectedBy: null,
    ...over,
  } as RecordingProjection;
}

describe("014 EARS-4 — the post-live recording signal", () => {
  it("014 EARS-4.1: a published montage on an ended event reads as available, labelled by the kind a viewer would actually get", () => {
    expect(
      resolveRecordingSignal(
        projection({ state: "montage", primaryKind: "edited", secondaryKind: "raw" }),
        "ended",
      ),
    ).toEqual({ badgeKey: "available", available: true, kindKey: "edited" });
  });

  it("014 EARS-4.2: a raw-only recording is still AVAILABLE — it is labelled «оригинал», never downgraded to «готовится»", () => {
    expect(
      resolveRecordingSignal(
        projection({ state: "raw-only", primaryKind: "raw" }),
        "ended",
      ),
    ).toEqual({ badgeKey: "available", available: true, kindKey: "raw" });
  });

  it("014 EARS-4.3: nothing published yet reads as preparing, and prints NO kind label (there is no recording to name)", () => {
    expect(resolveRecordingSignal(projection(), "ended")).toEqual({
      badgeKey: "preparing",
      available: false,
      kindKey: null,
    });
  });

  it("014 EARS-4.4: an upcoming or live event stays silent — a recording signal would contradict the lifecycle the rest of the page reads", () => {
    const published = projection({ state: "montage", primaryKind: "edited" });
    expect(resolveRecordingSignal(published, "upcoming")).toBeNull();
    expect(resolveRecordingSignal(published, "live")).toBeNull();
  });

  it("014 EARS-4.5: an archived event stays silent — 004 EARS-5's «в архиве» notice owns that render alone, with no competing second message", () => {
    expect(
      resolveRecordingSignal(
        projection({ state: "montage", primaryKind: "edited" }),
        "archived",
      ),
    ).toBeNull();
  });

  it("014 EARS-4.6: the readiness date never rides the BADGE signal — the hero badge says «Запись готовится» and nothing more; the date belongs to the EARS-7 plaque", () => {
    const signal = resolveRecordingSignal(
      projection({ expectedBy: "2026-07-18" }),
      "ended",
    );
    expect(signal).toEqual({
      badgeKey: "preparing",
      available: false,
      kindKey: null,
    });
    expect(JSON.stringify(signal)).not.toContain("2026");
  });
});

describe("014 EARS-7 — the «запись готовится» plaque projection", () => {
  /** A fixed reading moment, so «is it the current year» is not clock-dependent. */
  const NOW = new Date("2026-07-16T18:30:00.000Z");

  it("014 EARS-7.1: an ended event with nothing published yet and a committed day carries that day, formatted for a Russian reader", () => {
    expect(
      resolveRecordingPlaque(projection({ expectedBy: "2026-07-18" }), "ended", NOW),
    ).toEqual({ expectedByLabel: "18 июля" });
  });

  it("014 EARS-7.2: no committed day yields NO label — the page then speaks the date-free line instead of inventing an estimate", () => {
    expect(
      resolveRecordingPlaque(projection({ expectedBy: null }), "ended", NOW),
    ).toEqual({ expectedByLabel: null });
  });

  it("014 EARS-7.3: publishing CLEARS the plaque — a montage and a raw-only recording both end the promise, with no timer or cached flag to go stale", () => {
    expect(
      resolveRecordingPlaque(
        projection({ state: "montage", primaryKind: "edited", expectedBy: "2026-07-18" }),
        "ended",
        NOW,
      ),
    ).toBeNull();
    expect(
      resolveRecordingPlaque(
        projection({ state: "raw-only", primaryKind: "raw" }),
        "ended",
        NOW,
      ),
    ).toBeNull();
  });

  it("014 EARS-7.4: the plaque exists only on an ENDED event — an upcoming, live, or archived page never promises a recording", () => {
    const preparing = projection({ expectedBy: "2026-07-18" });
    for (const status of ["upcoming", "live", "archived"] as const) {
      expect(resolveRecordingPlaque(preparing, status, NOW)).toBeNull();
    }
  });

  it("014 EARS-7.5: a day in another year keeps its year — «18 июля» read in 2026 is noise, «18 июля 2027» is the whole point", () => {
    expect(formatReadinessDay("2027-07-18", NOW)).toBe("18 июля 2027");
    expect(formatReadinessDay("2026-01-09", NOW)).toBe("9 января");
    expect(formatReadinessDay("2026-12-31", NOW)).toBe("31 декабря");
  });

  it("014 EARS-7.6: the day is read as CALENDAR FIELDS — a day near either edge of UTC keeps the day the operator committed to, never shifted by a timezone", () => {
    // Parsed through `new Date()` in a westward zone these would render as the
    // previous day — a silently wrong promise, which is worse than none.
    expect(formatReadinessDay("2026-07-01", NOW)).toBe("1 июля");
    expect(formatReadinessDay("2026-08-31", NOW)).toBe("31 августа");
  });

  it("014 EARS-7.7: an absent or malformed day yields no label rather than a broken string on the page", () => {
    expect(formatReadinessDay(null, NOW)).toBeNull();
    expect(formatReadinessDay("", NOW)).toBeNull();
    expect(formatReadinessDay("скоро", NOW)).toBeNull();
    expect(formatReadinessDay("2026-13-01", NOW)).toBeNull();
  });
});

describe("014 EARS-5 — which of the four things the player card holds", () => {
  /** A fixed reading moment, so the plaque's year suffix is not clock-dependent. */
  const NOW = new Date("2026-07-16T18:30:00.000Z");
  const montage = projection({
    state: "montage",
    primaryKind: "edited",
    secondaryKind: "raw",
  });
  const source = {
    primary: {
      kind: "edited",
      provider: "rutube",
      embedRef: "abc123",
      posterRef: null,
      durationSec: null,
    },
    secondary: null,
  } satisfies EventPlayback;

  it("014 EARS-5.1: a GUEST on a published recording gets the login gate — never a source, never an empty card", () => {
    expect(resolvePlayerCard(montage, "ended", false, null)).toEqual({
      mode: "gate",
      kindKey: "edited",
    });
  });

  it("014 EARS-5.2: a signed-in doctor gets the player, fed the provider + ref from the AUTHENTICATED read", () => {
    expect(resolvePlayerCard(montage, "ended", true, source)).toEqual({
      mode: "player",
      kindKey: "edited",
      provider: "rutube",
      embedRef: "abc123",
    });
  });

  it("014 EARS-5.3: `preparing` is the plaque for guest AND doctor alike — the gate must not promise a recording that does not exist", () => {
    const preparing = projection({ state: "preparing", expectedBy: "2026-07-18" });
    const nulls = { primary: null, secondary: null } as EventPlayback;
    expect(resolvePlayerCard(preparing, "ended", false, null, NOW)).toEqual({
      mode: "plaque",
      expectedByLabel: "18 июля",
    });
    expect(resolvePlayerCard(preparing, "ended", true, nulls, NOW)).toEqual({
      mode: "plaque",
      expectedByLabel: "18 июля",
    });
  });

  it("014 EARS-5.4: a signed-in doctor whose authenticated read carries no playable source gets the honest unavailability message, never a frame with nothing behind it", () => {
    expect(
      resolvePlayerCard(montage, "ended", true, {
        primary: null,
        secondary: null,
      } as EventPlayback),
    ).toEqual({ mode: "unavailable", kindKey: "edited" });
    // The read itself failing (401 after an expired session, a 404) collapses to
    // the same honest message rather than a blank card.
    expect(resolvePlayerCard(montage, "ended", true, null)).toEqual({
      mode: "unavailable",
      kindKey: "edited",
    });
  });

  it("014 EARS-5.5: the player card exists only on an ENDED event — upcoming, live and archived render no card at all", () => {
    for (const status of ["upcoming", "live", "archived"] as const) {
      expect(resolvePlayerCard(montage, status, true, source)).toBeNull();
      expect(resolvePlayerCard(montage, status, false, null)).toBeNull();
    }
  });
});
