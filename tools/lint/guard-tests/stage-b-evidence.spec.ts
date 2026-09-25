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
describe("#2373: Stage-B head carry-over across a patch-id-identical head", () => {
  const recorded = "b".repeat(40);
  const carried = base.replace(sha, recorded);
  it("accepts a record whose head is patch-id-identical to the current head, with an audit line", () => {
    const calls: string[][] = [];
    const verdict = validateStageB([{ body: carried }], sha, [], {}, (r, h) => {
      calls.push([r, h]);
      return { accepted: true, reason: "pure rebase", equal: 2, total: 2 };
    });
    expect(calls).toEqual([[recorded, sha]]);
    expect(verdict.ok).toBe(true);
    expect(verdict.reason).toContain("carried");
    expect(verdict.reason).toContain(recorded.slice(0, 12));
    expect(verdict.reason).toContain(sha.slice(0, 12));
    expect(verdict.reason).toContain("2/2");
  });
  it("a rework push (range-diff not all `=`) keeps the stale refusal and names why", () => {
    const verdict = validateStageB([{ body: carried }], sha, [], {}, () => ({
      accepted: false,
      reason: "git range-diff shows 1/2 commit(s) differing",
    }));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("stale");
    expect(verdict.reason).toContain("1/2 commit(s) differing");
  });
  it("without an equivalence probe a different head stays stale", () =>
    expect(validateStageB([{ body: carried }], sha, [], {}).ok).toBe(false));
  it("a missing or malformed recorded head is never probed", () => {
    let probed = false;
    const probe = () => {
      probed = true;
      return { accepted: true, reason: "pure rebase" };
    };
    for (const body of [
      base.replace(`Stage-B-head: ${sha}\n`, ""),
      base.replace(sha, "not-a-sha"),
    ])
      expect(validateStageB([{ body }], sha, [], {}, probe).ok).toBe(false);
    expect(probed).toBe(false);
  });
  it("a lead-certified record never carries over (its report pins the tested head)", () => {
    let probed = false;
    const lead = carried.replace(
      "Stage-B: GO",
      "Stage-B: N/A (no visual surface) - lead-certified; run UTC: 2026-09-06T00:00:00Z; harness: x; report: https://example.test/r",
    );
    expect(
      validateStageB([{ body: lead }], sha, [], {}, () => {
        probed = true;
        return { accepted: true, reason: "pure rebase" };
      }).ok,
    ).toBe(false);
    expect(probed).toBe(false);
  });
});
