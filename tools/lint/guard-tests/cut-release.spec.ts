import { describe, expect, it } from "vitest";

// Pure seams exported from the L1 release-tag cutter (Issue #943, W3/L1 of #927).
// Importing them does NOT fire the script's `cutRelease()` I/O seam — it is guarded
// behind an entry-point check, the same idiom as tools/deploy/release-notes.mjs.
// The tag format `release-YYYY.MM.DD-<n>` (spec §D6) is deterministic and injected:
// `dateStr` is passed by the caller so the pure fn never reads the clock.
import { nextReleaseTag, parseReleaseTag } from "../../release/cut-release.mjs";

// ── parseReleaseTag (pure) ──────────────────────────────────────────────────
describe("cut-release — parseReleaseTag (pure)", () => {
  it("parses a well-formed tag into { date, ordinal }", () => {
    expect(parseReleaseTag("release-2026.07.15-3")).toEqual({
      date: "2026.07.15",
      ordinal: 3,
    });
  });

  it("returns null for a malformed / unrelated tag", () => {
    expect(parseReleaseTag("v1.2.3")).toBeNull();
    expect(parseReleaseTag("release-bogus")).toBeNull();
    expect(parseReleaseTag("release-2026.07.15")).toBeNull();
    expect(parseReleaseTag("release-2026.7.15-1")).toBeNull();
    expect(parseReleaseTag("")).toBeNull();
    expect(parseReleaseTag(undefined as unknown as string)).toBeNull();
  });
});

// ── nextReleaseTag (pure) ───────────────────────────────────────────────────
describe("cut-release — nextReleaseTag (pure)", () => {
  it("first tag of a day (empty tag list) → -1", () => {
    expect(nextReleaseTag([], "2026.07.15")).toBe("release-2026.07.15-1");
  });

  it("same-day increment off the existing tags → max+1", () => {
    expect(
      nextReleaseTag(
        ["release-2026.07.15-1", "release-2026.07.15-2"],
        "2026.07.15",
      ),
    ).toBe("release-2026.07.15-3");
  });

  it("cross-day isolation: yesterday's tags do not raise today's ordinal → -1", () => {
    expect(
      nextReleaseTag(
        ["release-2026.07.14-1", "release-2026.07.14-9"],
        "2026.07.15",
      ),
    ).toBe("release-2026.07.15-1");
  });

  it("malformed / unrelated tags are ignored", () => {
    expect(
      nextReleaseTag(
        ["v1.2.3", "release-bogus", "release-2026.07.15-1", "not-a-tag"],
        "2026.07.15",
      ),
    ).toBe("release-2026.07.15-2");
  });

  it("non-contiguous ordinals → max+1, not count+1", () => {
    expect(
      nextReleaseTag(
        ["release-2026.07.15-1", "release-2026.07.15-4"],
        "2026.07.15",
      ),
    ).toBe("release-2026.07.15-5");
  });

  it("non-array tag input → -1 (defensive)", () => {
    expect(nextReleaseTag(undefined as unknown as string[], "2026.07.15")).toBe(
      "release-2026.07.15-1",
    );
  });
});
