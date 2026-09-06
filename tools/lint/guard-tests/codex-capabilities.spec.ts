import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanHarnessSessions } from "../../agent/session-activity.mjs";
import { diagnoseHooks } from "../../agent/doctor.mjs";
import { hookFingerprint } from "../../hooks/observations.mjs";
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "ds-session-mix-"));
  dirs.push(dir);
  return dir;
}
describe("mixed harness concurrency and capability evidence #1919", () => {
  it("discovers recent Claude plus Codex sessions, including arbitrary linked roots, excluding sibling repos", () => {
    const home = fixture();
    const main = join(home, "repo");
    const wt = join(home, "elsewhere");
    const claude = join(
      home,
      ".claude/projects",
      main.replace(/[^a-zA-Z0-9]/g, "-"),
    );
    mkdirSync(claude, { recursive: true });
    writeFileSync(join(claude, "claude-parent.jsonl"), "{}\n");
    const codex = join(home, ".codex/sessions/2000/01/01");
    mkdirSync(codex, { recursive: true });
    for (const [id, cwd] of [
      ["codex-child", wt],
      ["codex-main", main],
      ["other", main + "-2"],
    ])
      writeFileSync(
        join(codex, id + ".jsonl"),
        JSON.stringify({ type: "session_meta", payload: { id, cwd } }) + "\n",
      );
    const scan = scanHarnessSessions({
      roots: [main, wt],
      home,
      codexHome: join(home, ".codex"),
    });
    expect(scan.logs.map((l) => l.id).sort()).toEqual([
      "claude-parent",
      "codex-child",
      "codex-main",
    ]);
    expect(
      scan.logs.find((l) => l.id === "codex-child")?.inSharedMainTree,
    ).toBe(false);
    expect(scan.logs.filter((l) => l.inSharedMainTree)).toHaveLength(2);
  });
  it("surfaces unreadable/missing metadata and bounded scans instead of declaring full coverage", () => {
    const home = fixture();
    const codex = join(home, ".codex/sessions/2026/09/06");
    mkdirSync(codex, { recursive: true });
    writeFileSync(join(codex, "broken.jsonl"), "unrecognized format\n");
    expect(
      scanHarnessSessions({
        roots: [home],
        home,
        codexHome: join(home, ".codex"),
      }).warnings,
    ).toContain("Recent Codex session metadata unavailable");
    expect(
      scanHarnessSessions({
        roots: [home],
        home,
        codexHome: join(home, ".codex"),
        limit: 1,
      }).warnings.join(" "),
    ).toContain("coverage incomplete");
  });
  it("configuration, host trust, and local observed events remain distinct; old definitions are not current evidence", () => {
    const root = resolve(__dirname, "../../..");
    const fingerprint = hookFingerprint(root);
    const row = {
      at: new Date().toISOString(),
      fingerprint,
      event: "PreToolUse",
      task: "worktree-path-guard",
      tool: "apply_patch",
      status: 0,
      decision: "deny",
    };
    const seen = diagnoseHooks(root, [row]);
    expect(seen.configured.handlers.length).toBeGreaterThan(5);
    expect(seen.observed.denials).toBe(1);
    expect(seen.trusted.status).toBe("unknown");
    expect(
      diagnoseHooks(root, [{ ...row, fingerprint: "old" }]).observed.status,
    ).toBe("not observed");
    expect(diagnoseHooks(root, []).observed.status).toBe("not observed");
  });
});
