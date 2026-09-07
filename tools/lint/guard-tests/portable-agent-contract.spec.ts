import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "./run-guard";

const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");
const skill = (name: string) => read(`apps/docs/content/skills/${name}/SKILL.md`);

describe("portable agent procedure regressions (#1918)", () => {
  it("provides all four Codex roles without unsupported provider model pins", () => {
    for (const role of ["ds-explorer", "ds-implementer", "ds-reviewer", "ds-lander"]) {
      const path = `.codex/agents/${role}.toml`;
      expect(existsSync(join(REPO_ROOT, path)), path).toBe(true);
      const source = read(path);
      expect(source).toContain(`name = "${role}"`);
      expect(source).toContain("developer_instructions =");
      expect(source).not.toMatch(/^model(?:_reasoning_effort)?\s*=/m);
    }
  });

  it("routes every project skill through the shared capability contract", () => {
    const dir = join(REPO_ROOT, "apps/docs/content/skills");
    for (const name of readdirSync(dir)) {
      if (!existsSync(join(dir, name, "SKILL.md"))) continue;
      const source = skill(name);
      expect(source, name).toContain("../../agent-discipline.md");
      expect(source, name).not.toMatch(/\b(?:Opus|Sonnet)\s+subagent|`\/(?:design-sync)`|`frontend-design` skill pass/);
    }
  });

  it("requires Stage A before implementation in both feature and hotfix recipes", () => {
    for (const [name, implementation] of [["do-feature-iteration", "4. **GREEN**"], ["do-hotfix-pr", "2. **Fix**"]]) {
      const source = skill(name!);
      const approval = source.indexOf("**Stage-A precondition");
      expect(approval, name).toBeGreaterThan(-1);
      expect(approval, name).toBeLessThan(source.indexOf(implementation!));
    }
  });

  it("uses valid review CI queries and the canonical gate after head movement", () => {
    expect(skill("request-mode-a-review")).not.toMatch(/gh run list[^\n`]*--json[^\n`]*\bjobs\b/);
    expect(skill("request-mode-a-review")).toContain("gh run view <run-id> --json");
    const merge = skill("merge-when-green");
    const blocks = [...merge.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n");
    expect(blocks).not.toContain("pnpm ci:wait");
    expect(blocks).not.toContain("&& echo fresh");
    expect(merge).not.toContain("`git commit --no-verify` is the expected path");
    expect(merge).toContain("pnpm install");
  });

  it("never creates technical dependencies merely to serialize the queue", () => {
    const source = skill("open-ears-issues");
    expect(source).not.toContain("at most one");
    expect(source).not.toContain("Every child except the intended head lands blocked");
    expect(source).toContain("technical dependency");
  });

  it("keeps owner UI gates and Codex direct-request memory routing in lifecycle recipes", () => {
    expect(skill("run-task-lifecycle")).not.toContain("The **only** human-gated path is **Mode (c)**");
    expect(skill("run-task-lifecycle")).toContain("Stage B");
    expect(skill("run-wrap")).toContain("direct owner request");
    expect(skill("run-wrap")).toContain("extensions/ad_hoc/notes/");
    expect(skill("report-task-outcome")).not.toContain("A prod deploy is its own owner-gated step");
  });
});
