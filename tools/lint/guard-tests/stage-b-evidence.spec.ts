import { describe, expect, it } from "vitest";
import { validateStageB } from "../lib/stage-b-evidence";
const sha = "a".repeat(40);
const base = `Stage-B: GO\nStage-B-head: ${sha}\nStage-B-recorded-at: 2026-09-06T00:00:00Z\nStage-B-owner-quote: Approved this live room\nStage-B-source: owner-relay:session-123#message-4\nStage-B-live-url: http://localhost:3000/room`;
describe("EARS-1920: Stage-B current approval evidence", () => {
  it("accepts the complete owner-relay record without treating shared login as identity", () =>
    expect(validateStageB([{ body: base }], sha, [], {}).ok).toBe(true));
  it.each([
    "Stage-B-head:",
    "Stage-B-owner-quote:",
    "Stage-B-source:",
    "Stage-B-recorded-at:",
    "Stage-B-live-url:",
  ])("rejects missing %s", (field) =>
    expect(
      validateStageB(
        [
          {
            body: base
              .split("\n")
              .filter((l) => !l.startsWith(field))
              .join("\n"),
          },
        ],
        sha,
        [],
        {},
      ).ok,
    ).toBe(false),
  );
  it("rejects stale heads, contradictory GO text and placeholder provenance", () => {
    for (const body of [
      base.replace(sha, "b".repeat(40)),
      base.replace("Stage-B: GO", "Stage-B: GO pending"),
      base.replace("Approved this live room", "TBD"),
    ])
      expect(validateStageB([{ body }], sha, [], {}).ok).toBe(false);
  });
  it("later refusal invalidates the earlier GO even when the refusal has no affirmative metadata", () =>
    expect(
      validateStageB(
        [
          { body: base },
          { body: "Stage-B: HOLD", createdAt: "2026-09-06T01:00:00Z" },
        ],
        sha,
        [],
        {},
      ).ok,
    ).toBe(false));
  it("a refusal in the same body and an undated contradictory comment fail closed", () => {
    expect(
      validateStageB([{ body: base + "\nStage-B: NO" }], sha, [], {}).ok,
    ).toBe(false);
    expect(
      validateStageB(
        [{ body: base }, { body: "Stage-B: REVOKED" }],
        sha,
        [],
        {},
      ).ok,
    ).toBe(false);
  });
  it("rejects a bare batched or lead-certified marker", () => {
    for (const marker of [
      "batched at #700",
      "N/A (no visual surface) - lead-certified",
    ])
      expect(
        validateStageB(
          [{ body: base.replace("Stage-B: GO", `Stage-B: ${marker}`) }],
          sha,
          ["apps/admin/app/page.tsx"],
          {},
        ).ok,
      ).toBe(false);
  });
});
