import { describe, expect, it } from "vitest";
import { summarize } from "../pr-preflight.mjs";
import {
  classifyModeAVerdict,
  classifyModeAExemption,
  flattenApiPages,
} from "../../gh/merge-gate.mjs";
import { isUiSourcePath } from "../lib/ui-surface";
import { classifyDisciplineChanges } from "../../ci/discipline-changes.mjs";
import { readFileSync } from "node:fs";
import { latestModeAReview } from "../ui-parity-lint";

describe("EARS-1920: discipline gate regressions", () => {
  it("accepts UTF-8 BOM review files and never hides a later BOM refusal", () => {
    const approval = {
      body: "\uFEFF## Mode (a) Review\nVERDICT: APPROVE",
      commit_id: "abc",
      submitted_at: "2026-09-06T00:00:00Z",
      state: "COMMENTED",
    };
    expect(classifyModeAVerdict([approval], "abc").state).toBe("fresh-approve");
    const refusal = {
      ...approval,
      body: "\uFEFF## Mode (a) Review\nVERDICT: REQUEST_CHANGES",
      submitted_at: "2026-09-06T01:00:00Z",
    };
    expect(
      classifyModeAVerdict(
        [{ ...approval, body: approval.body.slice(1) }, refusal],
        "abc",
      ).state,
    ).toBe("request-changes");
    expect(
      latestModeAReview([
        { body: approval.body.slice(1), submittedAt: approval.submitted_at },
        { body: refusal.body, submittedAt: refusal.submitted_at },
      ])?.body,
    ).toContain("REQUEST_CHANGES");
  });
  it("preserves WARN findings locally while blocking BLOCK and execution errors", () => {
    expect(
      summarize([
        { name: "no-stub", status: 1 },
        { name: "migration-index", status: 1 },
      ]).ok,
    ).toBe(true);
    expect(summarize([{ name: "no-stub", status: -1 }]).ok).toBe(false);
    expect(summarize([{ name: "spec-link", status: 1 }]).ok).toBe(false);
  });
  it("a dismissed newest review cannot resurrect an earlier approval; COMMENT remains valid", () => {
    const approval = {
      body: "## Mode (a) Review\nVERDICT: APPROVE",
      commit_id: "abc",
      submitted_at: "2026-09-06T00:00:00Z",
      state: "COMMENTED",
    };
    expect(classifyModeAVerdict([approval], "abc").state).toBe("fresh-approve");
    expect(
      classifyModeAVerdict(
        [
          approval,
          {
            ...approval,
            state: "DISMISSED",
            submitted_at: "2026-09-06T01:00:00Z",
          },
        ],
        "abc",
      ).state,
    ).not.toBe("fresh-approve");
  });
  it.each([
    "apps/api/src/main.ts",
    "tools/lint/foo.ts",
    ".github/workflows/ci.yml",
    "apps/docs/content/specs/features/001-x/001-product.md",
    "infra/README.md",
  ])("cannot exempt %s with an arbitrary reason", (path) => {
    expect(classifyModeAExemption([{ filename: path }], "", "abc").ok).toBe(
      false,
    );
  });
  it("allows prose and tests but requires recorded verification for procedures", () => {
    expect(
      classifyModeAExemption([{ filename: "README.md" }], "", "abc").ok,
    ).toBe(true);
    expect(
      classifyModeAExemption(
        [{ filename: "tools/lint/guard-tests/x.spec.ts" }],
        "",
        "abc",
      ).ok,
    ).toBe(true);
    expect(
      classifyModeAExemption([{ filename: "AGENTS.md" }], "", "abc").ok,
    ).toBe(false);
  });
  it("preserves recorded procedure verification and canonical generated artifacts, rejects renamed runtime files", () => {
    const head = "a".repeat(40);
    const proof = `mode-a-exempt-head: ${head}\nmode-a-exempt-command: pnpm pr:preflight 1920\nmode-a-exempt-live-verification: https://github.com/acme/repo/pull/1920#issuecomment-1`;
    expect(
      classifyModeAExemption([{ filename: "AGENTS.md" }], proof, head).ok,
    ).toBe(true);
    expect(
      classifyModeAExemption(
        [{ filename: "packages/api-client/src/types.generated.ts" }],
        "",
        head,
      ).ok,
    ).toBe(true);
    expect(
      classifyModeAExemption(
        [{ filename: "packages/api-client/src/index.ts" }],
        "",
        head,
      ).ok,
    ).toBe(false);
    expect(
      classifyModeAExemption(
        [{ filename: "README.md", previous_filename: "apps/api/src/main.ts" }],
        "",
        head,
      ).ok,
    ).toBe(false);
  });
  it("keeps Nest e2e-spec tests within the test-only exemption", () => {
    expect(
      classifyModeAExemption(
        [{ filename: "apps/api/test/auth.e2e-spec.ts" }],
        "",
        "a".repeat(40),
      ).ok,
    ).toBe(true);
  });
  it("CI actually runs tool and guard suites for instruction-only diffs", () => {
    const ci = readFileSync(
      new URL("../../../.github/workflows/ci.yml", import.meta.url),
      "utf8",
    );
    expect(ci).toContain("run: node tools/ci/discipline-changes.mjs");
    expect(ci).toMatch(
      /name: discipline guards[^\n]*\n\s+if: .*outputs\.discipline == 'true'\n\s+run: pnpm --filter @ds\/lint-guard-tests test/,
    );
    expect(ci).toMatch(
      /name: unit \(tools\)\n\s+if: .*outputs\.discipline == 'true'\n\s+run: pnpm test:tools/,
    );
  });
  it("flattens all GitHub pages, preserving late failing checks and refusals", () => {
    expect(flattenApiPages([[{ id: 1 }], [{ id: 101 }]])).toEqual([
      { id: 1 },
      { id: 101 },
    ]);
    expect(
      flattenApiPages(
        [{ check_runs: [{ id: 1 }] }, { check_runs: [{ id: 101 }] }],
        "check_runs",
      ),
    ).toEqual([{ id: 1 }, { id: 101 }]);
  });
  it("includes shared room UI and previously skipped rendered surfaces", () => {
    for (const path of [
      "packages/room/src/header.tsx",
      "packages/room/src/use-room.ts",
      "apps/portal/app/global.css",
      "apps/showcase/app/page.tsx",
      "apps/mobile/app/home.tsx",
      "apps/admin/messages/ru.json",
    ])
      expect(isUiSourcePath(path)).toBe(true);
  });
  it("instruction-only diffs select guard tests and ordinary documentation stays cheap", () => {
    for (const path of [
      "AGENTS.md",
      "CLAUDE.md",
      ".claude/rules/dev-stand.md",
      "apps/docs/content/skills/merge-when-green/SKILL.md",
      ".codex/agents/reviewer.toml",
    ])
      expect(classifyDisciplineChanges([path])).toBe(true);
    expect(
      classifyDisciplineChanges(["apps/docs/content/guide.md", "README.md"]),
    ).toBe(false);
  });
});
