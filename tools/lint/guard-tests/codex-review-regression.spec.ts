import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const dirs: string[] = [];
function temporaryRoot() {
  const dir = mkdtempSync(join(tmpdir(), "ds-hook-review-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("PR #1922 Mode (a) blockers", () => {
  it.each(["redirect", "array"])(
    "P1 rejects a supported writer with a hidden %s destination before execution",
    (kind) => {
      const dir = temporaryRoot();
      const main = join(dir, "main");
      const worktree = join(dir, "isolated");
      execFileSync("git", ["init", main], { stdio: "ignore" });
      execFileSync(
        "git",
        [
          "-C",
          main,
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.test",
          "commit",
          "--allow-empty",
          "-m",
          "fixture",
        ],
        { stdio: "ignore" },
      );
      execFileSync(
        "git",
        ["-C", main, "worktree", "add", "-b", "isolated", worktree],
        { stdio: "ignore" },
      );
      const escaped = join(main, "never-written.txt");
      const command =
        kind === "redirect"
          ? `Set-Content -LiteralPath own.txt -Value bad > '${escaped}'`
          : `Set-Content -Path own.txt,'${escaped}' -Value bad`;
      // Only invoke the guard. Never execute the requested PowerShell mutation.
      const result = spawnSync(
        process.execPath,
        [resolve(ROOT, "tools/hooks/worktree-path-guard.mjs")],
        {
          input: JSON.stringify({
            cwd: worktree,
            tool_name: "Bash",
            tool_input: { command },
          }),
          encoding: "utf8",
        },
      );
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("BLOCKED");
      expect(existsSync(escaped)).toBe(false);
      expect(existsSync(join(worktree, "own.txt"))).toBe(false);
    },
  );

  it.each([false, true])(
    "P2 project smoke keeps all reports outside source (pre-existing report: %s)",
    (existing) => {
      const dir = temporaryRoot();
      const project = join(dir, "project");
      const evidenceRoot = join(dir, "evidence");
      const appData = join(dir, "appdata");
      mkdirSync(evidenceRoot, { recursive: true });
      cpSync(resolve(ROOT, "tools/agent"), join(project, "tools/agent"), {
        recursive: true,
      });
      cpSync(resolve(ROOT, "tools/hooks"), join(project, "tools/hooks"), {
        recursive: true,
      });
      cpSync(resolve(ROOT, ".codex"), join(project, ".codex"), {
        recursive: true,
      });
      const fakeCli = join(
        appData,
        "npm/node_modules/@openai/codex/bin/codex.js",
      );
      mkdirSync(resolve(fakeCli, ".."), { recursive: true });
      writeFileSync(
        fakeCli,
        "process.stdout.write('stubbed CLI - no model or tool call\\n');\n",
      );
      const sourceReport = join(project, "runtime-report.json");
      const sentinel = "existing owner report - preserve exactly\n";
      if (existing) writeFileSync(sourceReport, sentinel);
      const result = spawnSync(
        process.execPath,
        [join(project, "tools/agent/smoke.mjs"), "--project"],
        {
          cwd: project,
          encoding: "utf8",
          env: {
            ...process.env,
            APPDATA: appData,
            TMPDIR: evidenceRoot,
            TMP: evidenceRoot,
            TEMP: evidenceRoot,
          },
        },
      );
      expect(result.status).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.evidenceDir).not.toBe(project);
      expect(
        readFileSync(join(report.evidenceDir, "runtime.stdout.jsonl"), "utf8"),
      ).toContain("stubbed CLI");
      if (existing) expect(readFileSync(sourceReport, "utf8")).toBe(sentinel);
      else expect(existsSync(sourceReport)).toBe(false);
      expect(
        JSON.parse(
          readFileSync(join(report.evidenceDir, "runtime-report.json"), "utf8"),
        ),
      ).toEqual(report);
    },
  );
});
