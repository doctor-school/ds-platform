import { describe, expect, it } from "vitest";

import {
  checkCoverage,
  checkSkillRequirement,
  extractAcSection,
  extractPathTokens,
  formatSkillRow,
  verifyBrief,
} from "../../gh/dispatch-brief-check.mjs";

/**
 * Unit cover for `tools/gh/dispatch-brief-check.mjs` (#757) — the AC-surface
 * coverage gate for dispatch briefs. Only the pure half (AC extraction, path
 * tokenization, coverage) is tested directly; the `gh` side goes through an
 * injectable runner, so nothing here shells out (same harness pattern as
 * handoff-verify.spec.ts — imports the pure exports, never fires `main()`).
 */

/** Fake gh runner: returns a canned Issue body as `gh issue view --json body`. */
function fakeRunner(bodies: Record<number, string>) {
  const calls: string[][] = [];
  return {
    calls,
    gh(args: string[]) {
      calls.push(["gh", ...args]);
      const [, , n] = args; // "issue", "view", "<n>"
      const body = bodies[Number(n)];
      if (body === undefined)
        return { status: 1, stdout: "", stderr: "GraphQL: not found (404)" };
      return { status: 0, stdout: JSON.stringify({ body }), stderr: "" };
    },
  };
}

describe("dispatch-brief-check extractAcSection()", () => {
  it("returns the text under `## Acceptance criteria` up to the next heading", () => {
    const body = [
      "## Context",
      "some context",
      "## Acceptance criteria",
      "- touch `tools/gh/x.mjs`",
      "- add a test",
      "## Dependencies",
      "- none",
    ].join("\n");
    const ac = extractAcSection(body);
    expect(ac).toContain("tools/gh/x.mjs");
    expect(ac).toContain("add a test");
    expect(ac).not.toContain("Dependencies");
    expect(ac).not.toContain("some context");
  });

  it("is case-insensitive and tolerates ### / # heading levels", () => {
    expect(extractAcSection("### ACCEPTANCE CRITERIA\n- a/b/c.ts")).toContain("a/b/c.ts");
    expect(extractAcSection("# Acceptance Criteria\n- x/y/z.ts")).toContain("x/y/z.ts");
  });

  it("runs to end-of-document when no trailing heading follows", () => {
    const ac = extractAcSection("## Acceptance criteria\n- foo/bar/baz.md\n- last line");
    expect(ac).toContain("foo/bar/baz.md");
    expect(ac).toContain("last line");
  });

  it("returns '' when there is no acceptance-criteria heading", () => {
    expect(extractAcSection("## Context\nno AC here\n## Notes")).toBe("");
  });
});

describe("dispatch-brief-check extractPathTokens()", () => {
  it("keeps an extension-bearing token even with a single slash", () => {
    expect(extractPathTokens("see tools/x.mjs please")).toEqual(["tools/x.mjs"]);
  });

  it("keeps a ≥2-slash directory token with no extension", () => {
    expect(extractPathTokens("under tools/lint/guard-tests here")).toEqual([
      "tools/lint/guard-tests",
    ]);
  });

  it("rejects single-slash prose like `and/or` and a bare `tools/`", () => {
    expect(extractPathTokens("do this and/or that in tools/ dir")).toEqual([]);
  });

  it("strips surrounding backticks and trailing punctuation", () => {
    expect(extractPathTokens("edit `apps/docs/content/skills/run-wrap/SKILL.md`.")).toEqual([
      "apps/docs/content/skills/run-wrap/SKILL.md",
    ]);
  });

  it("dedupes repeated tokens", () => {
    expect(extractPathTokens("tools/gh/a.mjs and again tools/gh/a.mjs")).toEqual([
      "tools/gh/a.mjs",
    ]);
  });
});

describe("dispatch-brief-check checkCoverage()", () => {
  it("marks a path covered when the brief names it verbatim", () => {
    const rows = checkCoverage(["tools/gh/a.mjs"], "we edit tools/gh/a.mjs today");
    expect(rows).toEqual([{ path: "tools/gh/a.mjs", covered: true }]);
  });

  it("covers a directory token when the brief names a file beneath it", () => {
    const rows = checkCoverage(
      ["tools/lint/guard-tests"],
      "add `tools/lint/guard-tests/dispatch-brief-check.spec.ts`",
    );
    expect(rows[0].covered).toBe(true);
  });

  it("marks a path MISSING when the brief never names it", () => {
    const rows = checkCoverage(["tools/gh/a.mjs"], "unrelated brief text");
    expect(rows).toEqual([{ path: "tools/gh/a.mjs", covered: false }]);
  });
});

describe("dispatch-brief-check checkSkillRequirement() — governing-skill gate (#857)", () => {
  // All fixtures below are pure strings fed to a string-matching function and
  // are never resolved against a filesystem — platform-agnostic by construction.
  it("passes when the brief names a catalog-skill path", () => {
    expect(
      checkSkillRequirement(
        "kind: hotfix-pr — run apps/docs/content/skills/do-hotfix-pr/SKILL.md end to end",
      ),
    ).toEqual({
      verdict: "skill",
      skillPath: "apps/docs/content/skills/do-hotfix-pr/SKILL.md",
    });
  });

  it("matches a backticked skill path (backtick-normalized like checkCoverage)", () => {
    expect(
      checkSkillRequirement("per `apps/docs/content/skills/merge-when-green/SKILL.md`"),
    ).toEqual({
      verdict: "skill",
      skillPath: "apps/docs/content/skills/merge-when-green/SKILL.md",
    });
  });

  it("accepts the `kind: engineering-task` escape (case-insensitive, flexible whitespace)", () => {
    expect(checkSkillRequirement("Kind:  Engineering-Task — CI hardening")).toEqual({
      verdict: "engineering-task",
    });
  });

  it("accepts an AGENTS.md §3.8 reference as the escape", () => {
    expect(
      checkSkillRequirement("no governing catalog skill — AGENTS.md §3.8 applies"),
    ).toEqual({ verdict: "engineering-task" });
  });

  it("returns missing when the brief has neither a skill path nor the escape", () => {
    expect(checkSkillRequirement("edit tools/gh/a.mjs and open a PR")).toEqual({
      verdict: "missing",
    });
  });

  it("does not accept a non-SKILL.md file under the catalog dir", () => {
    expect(
      checkSkillRequirement("see apps/docs/content/skills/do-hotfix-pr/README.md"),
    ).toEqual({ verdict: "missing" });
  });

  it("prefers the skill path when both a path and the escape appear", () => {
    const res = checkSkillRequirement(
      "kind: engineering-task, but governed by apps/docs/content/skills/open-ears-issues/SKILL.md",
    );
    expect(res.verdict).toBe("skill");
  });
});

describe("dispatch-brief-check formatSkillRow()", () => {
  it("renders `SKILL <path>` for a named catalog skill", () => {
    expect(
      formatSkillRow({
        verdict: "skill",
        skillPath: "apps/docs/content/skills/do-hotfix-pr/SKILL.md",
      }),
    ).toBe("SKILL apps/docs/content/skills/do-hotfix-pr/SKILL.md");
  });

  it("renders the distinguishable engineering-task PASS row for the escape", () => {
    expect(formatSkillRow({ verdict: "engineering-task" })).toBe(
      "SKILL engineering-task (no catalog skill — AGENTS.md §3.8)",
    );
  });

  it("renders a MISSING-SKILL row naming BOTH remedies (skill path / escape syntax)", () => {
    const row = formatSkillRow({ verdict: "missing" });
    expect(row).toMatch(/^MISSING-SKILL /);
    expect(row).toContain("apps/docs/content/skills/<name>/SKILL.md");
    expect(row).toContain("kind: engineering-task");
    expect(row).toContain("AGENTS.md §3.8");
  });
});

describe("dispatch-brief-check verifyBrief() with an injected gh runner", () => {
  it("reproduces retro F1: AC names run-wrap SKILL.md, brief names only wrap.md → MISSING", () => {
    const body = [
      "## Acceptance criteria",
      "- update the catalog skill `apps/docs/content/skills/run-wrap/SKILL.md`",
    ].join("\n");
    const runner = fakeRunner({ 757: body });
    const { rows, missing } = verifyBrief({
      issueNumber: 757,
      briefText: "edit `.claude/commands/wrap.md` with the new step",
      runner,
    });
    expect(missing).toBeGreaterThanOrEqual(1);
    expect(rows).toContainEqual({
      path: "apps/docs/content/skills/run-wrap/SKILL.md",
      covered: false,
    });
  });

  it("all AC surfaces named in the brief → zero missing", () => {
    const body = "## Acceptance criteria\n- touch `tools/gh/dispatch-brief-check.mjs`";
    const runner = fakeRunner({ 42: body });
    const { missing } = verifyBrief({
      issueNumber: 42,
      briefText: "deliverable: tools/gh/dispatch-brief-check.mjs",
      runner,
    });
    expect(missing).toBe(0);
  });

  it("AC block with no path surfaces → empty rows, zero missing", () => {
    const runner = fakeRunner({ 7: "## Acceptance criteria\n- it should feel fast" });
    const { rows, missing } = verifyBrief({
      issueNumber: 7,
      briefText: "any brief",
      runner,
    });
    expect(rows).toEqual([]);
    expect(missing).toBe(0);
  });

  it("throws on a gh failure (propagates to a usage/input exit)", () => {
    const runner = fakeRunner({});
    expect(() =>
      verifyBrief({ issueNumber: 999, briefText: "x", runner }),
    ).toThrow(/gh issue view 999 failed/);
  });
});
