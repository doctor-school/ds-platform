import type { RecordingProjection } from "@ds/schemas";
import { describe, expect, it } from "vitest";
import { resolveRecordingSignal } from "./recording-signal";

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

  it("014 EARS-4.6: the readiness date is never formatted here — the «запись готовится» plaque carrying it is #1344 (EARS-7), and a stand-in would be a stub", () => {
    const signal = resolveRecordingSignal(
      projection({ expectedBy: "2026-07-18T09:00:00.000Z" }),
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
