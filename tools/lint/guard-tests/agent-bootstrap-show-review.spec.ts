import { describe, expect, it } from "vitest";

import {
  renderShowReviewSection,
  showReviewSearchSince,
} from "../../agent-bootstrap";

/**
 * #2808: a verified Show PR merges on green CI and owes a post-merge Mode (a)
 * review. `pnpm bootstrap` lists the merged Show PRs still owing it, so the
 * review cannot be silently forgotten.
 */
describe("agent-bootstrap post-merge Show review (#2808)", () => {
  const show = "Change-tier: show — a new state in the feed";
  const pr = (number: number, over: Record<string, unknown> = {}) => ({
    number,
    title: `feat: pr ${number}`,
    body: show,
    mergedAt: "2026-10-10T10:00:00Z",
    headRefOid: "c".repeat(40),
    reviews: [],
    comments: [],
    ...over,
  });

  it("lists every merged show PR without a post-merge Mode (a) verdict", () => {
    const lines = renderShowReviewSection(
      [
        pr(11),
        pr(12, {
          comments: [
            {
              body: "## Mode (a) Review\n\nVERDICT: APPROVE",
              createdAt: "2026-10-11T10:00:00Z",
            },
          ],
        }),
        pr(13, { body: "Change-tier: ask — tooling" }),
      ],
      14,
    );
    expect(lines[0]).toBe("## Show PRs awaiting post-merge Mode (a)");
    const body = lines.join("\n");
    expect(body).toContain("#11 feat: pr 11 — merged 2026-10-10");
    expect(body).not.toContain("#12");
    expect(body).not.toContain("#13");
  });

  it("says none when every merged show PR in the window was reviewed", () => {
    expect(renderShowReviewSection([], 14)).toEqual([
      "## Show PRs awaiting post-merge Mode (a)",
      "(none merged in the last 14 days)",
    ]);
  });

  it("renders an unreadable source as unavailable, never as none", () => {
    expect(renderShowReviewSection(null, 14)).toEqual([
      "## Show PRs awaiting post-merge Mode (a)",
      "(unavailable — gh pr list failed; see Warnings)",
    ]);
  });

  it("bounds the search window by merge date", () => {
    expect(showReviewSearchSince(Date.parse("2026-10-12T05:00:00Z"), 14)).toBe(
      "2026-09-28",
    );
  });
});
