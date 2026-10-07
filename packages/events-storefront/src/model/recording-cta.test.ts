import { describe, expect, it } from "vitest";

import { isRecordingPlayable } from "./recording-cta";

// 014 EARS-9 / 019 EARS-10 — a past card offers the recording action only when a
// cut is published (wave-2 entry gate §2.1 row 10). `preparing` means nothing is
// published yet; an absent recording is likewise not playable.
describe("014 EARS-9 isRecordingPlayable — the one past-card playability rule", () => {
  it("EARS-9: a published montage and a raw-only recording are playable", () => {
    expect(isRecordingPlayable({ state: "montage" })).toBe(true);
    expect(isRecordingPlayable({ state: "raw-only" })).toBe(true);
  });

  it("EARS-9: a preparing recording and an absent one are not playable", () => {
    expect(isRecordingPlayable({ state: "preparing" })).toBe(false);
    expect(isRecordingPlayable(null)).toBe(false);
    expect(isRecordingPlayable(undefined)).toBe(false);
  });
});
