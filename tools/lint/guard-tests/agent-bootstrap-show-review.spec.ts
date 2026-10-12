import { describe, expect, it } from "vitest";

import {
  SHOW_REVIEW_LIMIT,
  SHOW_REVIEW_SINCE,
  renderShowReviewSection,
  showReviewSearchQuery,
  showReviewWarning,
} from "../../agent-bootstrap";

/**
 * #2808: a verified Show PR merges on green CI and owes a post-merge Mode (a)
 * review. `pnpm bootstrap` lists every merged Show PR since the rule took
 * effect until its verdict exists, so the review cannot be silently forgotten.
 */
describe("agent-bootstrap post-merge Show review (#2808)", () => {
  const show = "Change-tier: show — a new state in the feed";
  const pr = (number: number, over: Record<string, unknown> = {}) => ({
    number,
    title: `feat: pr ${number}`,
    body: show,
    mergedAt: "2026-10-20T10:00:00Z",
    headRefOid: "c".repeat(40),
    reviews: [],
    comments: [],
    ...over,
  });

  it("lists every merged show PR without a post-merge Mode (a) verdict", () => {
    const lines = renderShowReviewSection([
      pr(11),
      pr(12, {
        comments: [
          {
            body: "## Mode (a) Review\n\nVERDICT: APPROVE",
            createdAt: "2026-10-21T10:00:00Z",
          },
        ],
      }),
      pr(13, { body: "Change-tier: ask — tooling" }),
    ]);
    expect(lines[0]).toBe("## Show PRs awaiting post-merge Mode (a)");
    const body = lines.join("\n");
    expect(body).toContain("#11 feat: pr 11 — merged 2026-10-20");
    expect(body).not.toContain("#12");
    expect(body).not.toContain("#13");
  });

  it("never lists a show PR merged before the rule took effect", () => {
    const before = new Date(Date.parse(SHOW_REVIEW_SINCE) - 1000).toISOString();
    expect(
      renderShowReviewSection([
        pr(2763, { mergedAt: "2026-10-09T08:00:00Z" }),
        pr(2677, { mergedAt: "2026-10-07T08:00:00Z" }),
        pr(14, { mergedAt: before }),
      ]),
    ).toEqual([
      "## Show PRs awaiting post-merge Mode (a)",
      `(none merged since ${SHOW_REVIEW_SINCE})`,
    ]);
  });

  it("keeps an old unreviewed show PR listed — no rolling window", () => {
    const body = renderShowReviewSection([
      pr(15, { mergedAt: "2027-01-01T00:00:00Z" }),
      pr(16, { mergedAt: SHOW_REVIEW_SINCE }),
    ]).join("\n");
    expect(body).toContain("#15");
    expect(body).toContain("#16");
  });

  it("renders an unreadable source as unavailable, never as none", () => {
    expect(renderShowReviewSection(null)).toEqual([
      "## Show PRs awaiting post-merge Mode (a)",
      "(unavailable — gh pr list failed; see Warnings)",
    ]);
  });

  it("searches from the rule's effective date, not a rolling window", () => {
    expect(showReviewSearchQuery()).toBe(
      `"Change-tier: show" in:body merged:>=${SHOW_REVIEW_SINCE.slice(0, 10)}`,
    );
  });

  it("warns when the search hits its page limit instead of truncating silently", () => {
    const full = Array.from({ length: SHOW_REVIEW_LIMIT }, (_, i) => pr(i));
    expect(showReviewWarning(full)?.message).toContain(
      `${SHOW_REVIEW_LIMIT}-row limit`,
    );
    expect(showReviewWarning(full.slice(1))).toBeNull();
    expect(showReviewWarning(null)).toBeNull();
  });
});
