import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ghDir, runGuard } from "./run-guard";

const GUARD = "pr-evidence-lint.ts";

function prEnv(prNumber: string, ghCase: string): Record<string, string> {
  return {
    GITHUB_EVENT_NAME: "pull_request",
    PR_NUMBER: prNumber,
    LINT_GH_FIXTURE_DIR: ghDir("pr-evidence", ghCase),
  };
}

describe("pr-evidence-lint (#1637)", () => {
  it("passes the completed PR template while retaining its HTML comments", () => {
    const body = readFileSync(
      new URL("../../../.github/pull_request_template.md", import.meta.url),
      "utf8",
    )
      .replace(
        '- Closes #<issue-number> (or "Relates #N" if partial)',
        "- Closes #1637",
      )
      .replace(
        "- Spec: <link to apps/docs/content/specs/features/NNN-<slug>/ if feature-PR>",
        "- Spec: N/A - internal tooling",
      )
      .replace(
        "- ADR: <link to apps/docs/content/adr/NNNN-*.md if architectural decision>",
        "- ADR: N/A - no architectural decision",
      )
      .replace(
        /^Stage-B:.*$/m,
        "Stage-B: N/A - internal tooling-only change with no visual surface",
      )
      .replace(
        /^Changeset:.*$/m,
        "Changeset: N/A - internal process tooling only",
      )
      .replace(
        /^Behavior change:.*$/m,
        "Behavior change: N/A - no product behavior changes",
      )
      .replace(
        /^Local touched-suite verification:.*$/m,
        "Local touched-suite verification: `pnpm test` - PASS",
      )
      .replace(
        /^Deviations:.*$/m,
        "Deviations: N/A - no ADR or spec deviations",
      );
    const { code, stderr } = runGuard(GUARD, ".", {
      env: { ...prEnv("16371", "green-reasoned-na"), PR_BODY: body },
    });
    expect(stderr).toBe("");
    expect(code).toBe(0);
  });

  it("passes complete, non-placeholder evidence and absent Deviations", () => {
    const { code } = runGuard(GUARD, ".", {
      env: prEnv("16370", "green-complete"),
    });
    expect(code).toBe(0);
  });

  it("passes reasoned N/A evidence and Deviations: N/A", () => {
    const { code } = runGuard(GUARD, ".", {
      env: prEnv("16371", "green-reasoned-na"),
    });
    expect(code).toBe(0);
  });

  it("passes a tracked deviation with an Issue reference", () => {
    const { code } = runGuard(GUARD, ".", {
      env: prEnv("16372", "green-deviation-issue"),
    });
    expect(code).toBe(0);
  });

  it("passes a tracked deviation with a DEBT.md anchor", () => {
    const { code } = runGuard(GUARD, ".", {
      env: prEnv("16373", "green-deviation-debt"),
    });
    expect(code).toBe(0);
  });

  it("blocks an ADR/spec-clause deviation without Issue or DEBT.md tracking", () => {
    const { code, stderr } = runGuard(GUARD, ".", {
      env: prEnv("16374", "red-untracked-deviation"),
    });
    expect(code).toBe(1);
    expect(stderr).toContain("Deviations");
    expect(stderr).toMatch(/#<issue>|DEBT\.md/);
  });

  it("blocks an untracked bullet in a multiline ## Deviations section", () => {
    const { code, stderr } = runGuard(GUARD, ".", {
      env: prEnv("16375", "red-multiline-deviations"),
    });
    expect(code).toBe(1);
    expect(stderr).toContain("ADR/spec clause");
  });

  it("passes individually tracked bullets in a multiline ## Deviations section", () => {
    const { code } = runGuard(GUARD, ".", {
      env: prEnv("16376", "green-multiline-deviations"),
    });
    expect(code).toBe(0);
  });

  it.each(["Stage-B", "Changeset", "Behavior change"])(
    "blocks a missing or placeholder %s marker",
    (label) => {
      const { code, stderr } = runGuard(GUARD, ".", {
        env: {
          ...prEnv("16370", "green-complete"),
          PR_BODY: readFileSync(
            new URL("fixtures/pr-evidence/bodies/base.md", import.meta.url),
            "utf8",
          ).replace(new RegExp(`^${label}:.*$`, "m"), `${label}: TBD`),
        },
      });
      expect(code).toBe(1);
      expect(stderr).toContain(label);
    },
  );

  it.each([
    "Stage-B",
    "Changeset",
    "Behavior change",
    "Local touched-suite verification",
  ])("blocks a missing %s marker", (label) => {
    const { code, stderr } = runGuard(GUARD, ".", {
      env: {
        ...prEnv("16370", "green-complete"),
        PR_BODY: readFileSync(
          new URL("fixtures/pr-evidence/bodies/base.md", import.meta.url),
          "utf8",
        ).replace(new RegExp(`^${label}:.*\\n?`, "m"), ""),
      },
    });
    expect(code).toBe(1);
    expect(stderr).toContain(label);
  });

  it("blocks an unreasoned N/A", () => {
    const { code, stderr } = runGuard(GUARD, ".", {
      env: {
        ...prEnv("16370", "green-complete"),
        PR_BODY: readFileSync(
          new URL("fixtures/pr-evidence/bodies/base.md", import.meta.url),
          "utf8",
        ).replace(/^Changeset:.*$/m, "Changeset: N/A"),
      },
    });
    expect(code).toBe(1);
    expect(stderr).toContain("Changeset");
  });

  it("accepts a reasoned Stage-B N/A for an internal no-visual PR", () => {
    const { code } = runGuard(GUARD, ".", {
      env: {
        ...prEnv("16370", "green-complete"),
        PR_BODY: readFileSync(
          new URL("fixtures/pr-evidence/bodies/base.md", import.meta.url),
          "utf8",
        ).replace(
          /^Stage-B:.*$/m,
          "Stage-B: N/A — internal tooling-only change with no visual surface",
        ),
      },
    });
    expect(code).toBe(0);
  });

  it("blocks Changeset: N/A when Behavior change declares a change", () => {
    const { code, stderr } = runGuard(GUARD, ".", {
      env: {
        ...prEnv("16370", "green-complete"),
        PR_BODY: readFileSync(
          new URL("fixtures/pr-evidence/bodies/base.md", import.meta.url),
          "utf8",
        ).replace(
          /^Changeset:.*$/m,
          "Changeset: N/A — internal tooling package",
        ),
      },
    });
    expect(code).toBe(1);
    expect(stderr).toContain("Behavior change");
    expect(stderr).toContain(".changeset/");
  });

  it("passes behavior-change coupling when the declared changeset is changed", () => {
    const { code } = runGuard(GUARD, ".", {
      env: prEnv("16379", "green-changed-changeset"),
    });
    expect(code).toBe(0);
  });

  it("blocks a body-only changeset path absent from the changed files", () => {
    const { code, stderr } = runGuard(GUARD, ".", {
      env: prEnv("16380", "red-body-only-changeset"),
    });
    expect(code).toBe(1);
    expect(stderr).toContain(".changeset/missing.md");
    expect(stderr).toContain("changed files");
  });

  it.each([
    ["16377", "green-changeset-release-bot", "changeset-release/main"],
    ["16378", "green-dependabot", "dependabot/npm_and_yarn/tooling"],
  ])("exempts automated PR %s on %s", (pr, fixture, branch) => {
    const { code, stdout } = runGuard(GUARD, ".", {
      env: prEnv(pr, fixture),
    });
    expect(code).toBe(0);
    expect(stdout).toContain(branch);
    expect(stdout).toContain("automated PR");
  });

  it.each([
    ["16381", "red-human-changeset-branch", "changeset-release/main"],
    ["16382", "red-human-dependabot-branch", "dependabot/npm_and_yarn/tooling"],
  ])("does not exempt human PR %s on bot-shaped branch %s", (pr, fixture) => {
    const { code, stderr } = runGuard(GUARD, ".", {
      env: prEnv(pr, fixture),
    });
    expect(code).toBe(1);
    expect(stderr).toContain("delivery evidence is incomplete");
  });

  it("blocks deviation tracking that names PR #1653 instead of an Issue", () => {
    const { code, stderr } = runGuard(GUARD, ".", {
      env: prEnv("16383", "red-deviation-pr"),
    });
    expect(code).toBe(1);
    expect(stderr).toContain("#1653");
    expect(stderr).toContain("GitHub Issue");
  });

  it.each(["known red", "pnpm test -- failed", "N/A — not run"])(
    "blocks failed or absent local touched-suite evidence: %s",
    (evidence) => {
      const { code, stderr } = runGuard(GUARD, ".", {
        env: {
          ...prEnv("16370", "green-complete"),
          PR_BODY: readFileSync(
            new URL("fixtures/pr-evidence/bodies/base.md", import.meta.url),
            "utf8",
          ).replace(
            /^Local touched-suite verification:.*$/m,
            `Local touched-suite verification: ${evidence}`,
          ),
        },
      });
      expect(code).toBe(1);
      expect(stderr).toContain("Local touched-suite verification");
    },
  );

  it("is wired as a BLOCK step in Actions and a live preflight guard", () => {
    const workflow = readFileSync(
      new URL("../../../.github/workflows/pr-body-guards.yml", import.meta.url),
      "utf8",
    );
    const step = workflow.slice(workflow.indexOf("name: pr-evidence (BLOCK)"));
    expect(step).toContain("tools/lint/pr-evidence-lint.ts");
    expect(step.split("- name:", 2)[0]).not.toContain("continue-on-error");
  });
});
