import { describe, expect, it } from "vitest";

import {
  collectReleaseHolds,
  referencingOpenPrs,
  releaseHoldsSearchQuery,
  releaseHoldsWarning,
  renderReleaseHoldsSection,
  type ReleaseHoldRow,
} from "../../agent-bootstrap";

/**
 * #3643: a `Release-requires: #N` hold on a merged-undeployed PR was visible
 * only to the deploy-time release gate. `pnpm bootstrap` prints every open
 * prerequisite with its owner state read from facts (open PR / claim / none).
 */
describe("agent-bootstrap release holds (#3643)", () => {
  const HEAD = "## Release holds";
  const row = (over: Partial<ReleaseHoldRow> = {}): ReleaseHoldRow => ({
    issue: 3493,
    title: "032 EARS-6: an organisation needs an active role",
    state: "OPEN",
    heldBy: [3543],
    prs: [],
    claim: null,
    ownerUnavailable: false,
    ...over,
  });

  it("prints NO OWNER for an open prerequisite with no PR and no claim", () => {
    expect(renderReleaseHoldsSection({ rows: [row()], malformed: [] })).toEqual(
      [
        HEAD,
        "- #3493 032 EARS-6: an organisation needs an active role — held by PR #3543 — NO OWNER (no PR, no claim)",
      ],
    );
  });

  it("names the open PR that works on the prerequisite", () => {
    const body = renderReleaseHoldsSection({
      rows: [row({ prs: [3650] })],
      malformed: [],
    }).join("\n");
    expect(body).toContain("held by PR #3543 — PR #3650");
    expect(body).not.toContain("NO OWNER");
  });

  it("names a claim signal when there is no PR", () => {
    const body = renderReleaseHoldsSection({
      rows: [row({ claim: "IN-FLIGHT-ELSEWHERE (start-comment, age 2h)" })],
      malformed: [],
    }).join("\n");
    expect(body).toContain(
      "held by PR #3543 — IN-FLIGHT-ELSEWHERE (start-comment, age 2h)",
    );
    expect(body).not.toContain("NO OWNER");
  });

  it("omits closed prerequisites; only closed ones read none", () => {
    const lines = renderReleaseHoldsSection({
      rows: [row({ issue: 3494, state: "CLOSED" }), row()],
      malformed: [],
    });
    expect(lines.join("\n")).not.toContain("#3494");
    expect(lines.join("\n")).toContain("#3493");
    expect(
      renderReleaseHoldsSection({
        rows: [row({ issue: 3494, state: "CLOSED" })],
        malformed: [],
      }),
    ).toEqual([HEAD, "(none)"]);
  });

  it("prints unavailable, never none, on a fetch failure", () => {
    expect(renderReleaseHoldsSection(null)).toEqual([
      HEAD,
      "(unavailable — see Warnings)",
    ]);
    expect(releaseHoldsWarning(null)).toBeNull();
  });

  it("renders a malformed declaration as its own row", () => {
    expect(renderReleaseHoldsSection({ rows: [], malformed: [3600] })).toEqual([
      HEAD,
      "- PR #3600 — malformed Release-requires",
    ]);
  });

  it("warns with the count of holds that have no owner", () => {
    expect(
      releaseHoldsWarning({
        rows: [
          row(),
          row({ issue: 3700 }),
          row({ issue: 3701, prs: [3702] }),
          row({ issue: 3494, state: "CLOSED" }),
        ],
        malformed: [],
      }),
    ).toEqual({
      source: "Release holds",
      message:
        "2 open Release-requires prerequisite(s) on main have NO OWNER (no PR, no claim) — see ## Release holds",
    });
    expect(
      releaseHoldsWarning({ rows: [row({ prs: [1] })], malformed: [] }),
    ).toBeNull();
  });

  it("collects holds only from merged-undeployed PRs, reusing the gate parser", () => {
    const collected = collectReleaseHolds(
      [
        { number: 3543, body: "Release-requires: #3494, #3493" },
        { number: 3500, body: "Release-requires: #3400" },
        { number: 3600, body: "Release-requires: soon" },
        { number: 3601, body: "Release-requires: none" },
        { number: 3602, body: "<!-- Release-requires: #1 -->" },
      ],
      new Set([3543, 3600, 3601, 3602]),
    );
    expect(collected.malformed).toEqual([3600]);
    expect([...collected.heldBy.entries()]).toEqual([
      [3494, [3543]],
      [3493, [3543]],
    ]);
  });

  it("finds open PRs that reference the prerequisite by body, title or branch", () => {
    expect(
      referencingOpenPrs(3493, [
        { number: 1, title: "x", body: "Closes #3493", headRefName: "a" },
        { number: 2, title: "fix(3493): y", body: "", headRefName: "b" },
        { number: 3, title: "z", body: null, headRefName: "feat/3493-slug" },
        { number: 4, title: "z", body: "Refs #34930", headRefName: "c" },
        { number: 5, title: "z", body: "Refs #349", headRefName: "d/349-x" },
      ]),
    ).toEqual([1, 2, 3]);
  });

  it("bounds the merged search by the prod commit's UTC date, not its local offset", () => {
    // 05:07 at +07:00 is 22:07 UTC the day before; GitHub's merged: is UTC.
    expect(releaseHoldsSearchQuery("2026-11-04T05:07:04+07:00")).toBe(
      '"Release-requires" in:body merged:>=2026-11-03',
    );
    expect(releaseHoldsSearchQuery("2026-11-04T09:00:00+07:00\n")).toBe(
      '"Release-requires" in:body merged:>=2026-11-04',
    );
    expect(() => releaseHoldsSearchQuery("not a date")).toThrow();
  });

  it("never renders NO OWNER when the claim source could not be read", () => {
    const holds = { rows: [row({ ownerUnavailable: true })], malformed: [] };
    const body = renderReleaseHoldsSection(holds).join("\n");
    expect(body).toContain(
      "held by PR #3543 — owner unavailable (claim fetch failed) — see Warnings",
    );
    expect(body).not.toContain("NO OWNER");
    expect(releaseHoldsWarning(holds)).toBeNull();
  });
});
