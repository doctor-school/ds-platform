import { describe, expect, it } from "vitest";

import { renderCurrentBranchSummary } from "../../agent-bootstrap";

describe("agent-bootstrap git subject labels (#1243)", () => {
  it("names the current checkout branch, not local main", () => {
    const line = renderCurrentBranchSummary({
      branch: "tooling/1243-codex-agent-mode-parity-hooks-skills",
      clean: true,
      recent: [],
      aheadOfMain: "0",
      behindMain: "0",
    });
    expect(line).toContain("Current checkout branch");
    expect(line).toContain("current branch in sync with origin/main");
    expect(line).not.toContain("local `main`");
  });

  it("keeps ahead and unknown relations scoped to the current branch", () => {
    expect(
      renderCurrentBranchSummary({
        branch: "feat/1-x",
        clean: false,
        recent: [],
        aheadOfMain: "2",
        behindMain: "0",
      }),
    ).toContain("current branch 2 ahead of origin/main");
    expect(
      renderCurrentBranchSummary({
        branch: "feat/1-x",
        clean: true,
        recent: [],
        aheadOfMain: "?",
        behindMain: "?",
      }),
    ).toContain("origin/main relation unknown");
  });

  it("distinguishes behind and diverged current branches", () => {
    expect(
      renderCurrentBranchSummary({
        branch: "feat/1-x",
        clean: true,
        recent: [],
        aheadOfMain: "0",
        behindMain: "3",
      }),
    ).toContain("current branch 3 behind origin/main");
    expect(
      renderCurrentBranchSummary({
        branch: "feat/1-x",
        clean: true,
        recent: [],
        aheadOfMain: "2",
        behindMain: "3",
      }),
    ).toContain("current branch diverged from origin/main (2 ahead, 3 behind)");
  });
});
