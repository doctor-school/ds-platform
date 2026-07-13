import { describe, expect, it } from "vitest";

import {
  classifyHolders,
  classifyTeardownTarget,
  collectProtectedPids,
  commandLineReferencesPath,
  DEV_TOOLING_IMAGES,
  isDevToolingImage,
  pathIsUnder,
  resolveWorktreePath,
  selectWorktreeProcesses,
} from "../../dev/worktree-teardown.mjs";

/**
 * Unit cover for `tools/dev/worktree-teardown.mjs`'s pure name-resolution helper
 * (#598). The impure half (`git worktree remove`, the long-path purge) is
 * exercised live; only the bare-name → `.claude/worktrees/<name>` resolution is
 * unit-tested here, on the established guard-test harness (imports the pure
 * export, never fires `main()` — the IS_ENTRY guard blocks it).
 *
 * `exists` is injected so no real filesystem is touched; `root` is a POSIX
 * fixture path. Assertions normalize separators (Windows `path.join` yields
 * `\`) so the test is platform-agnostic.
 */
const ROOT = "/repo";
const norm = (p: string) => p.replace(/\\/g, "/");

describe("worktree-teardown resolveWorktreePath()", () => {
  it("resolves a bare name against the primary tree's .claude/worktrees/<name>", () => {
    // Mirrors the retro scenario: a bare slug fired from inside another worktree
    // must target the primary tree, not the current cwd.
    const existsUnderRoot = (p: string) =>
      norm(p) === "/repo/.claude/worktrees/spec-006";
    expect(norm(resolveWorktreePath("spec-006", ROOT, existsUnderRoot))).toBe(
      "/repo/.claude/worktrees/spec-006",
    );
  });

  it("resolves a bare numeric name the same way", () => {
    const existsUnderRoot = (p: string) =>
      norm(p) === "/repo/.claude/worktrees/598";
    expect(norm(resolveWorktreePath("598", ROOT, existsUnderRoot))).toBe(
      "/repo/.claude/worktrees/598",
    );
  });

  it("honors an explicit relative path as-given (never rewrites .claude/worktrees paths)", () => {
    // Contains a separator → treated as a path, resolved against cwd, and the
    // `.claude/worktrees/<name>` candidate is never consulted.
    const never = () => {
      throw new Error("exists() must not be called for an explicit path");
    };
    const resolved = norm(
      resolveWorktreePath(".claude/worktrees/598", ROOT, never),
    );
    expect(resolved.endsWith("/.claude/worktrees/598")).toBe(true);
  });

  it("honors an absolute path as-given", () => {
    const never = () => {
      throw new Error("exists() must not be called for an absolute path");
    };
    // endsWith (not toBe) so a Windows drive-letter prefix from resolve() is ok.
    const abs = "/some/other/tree/wt";
    expect(norm(resolveWorktreePath(abs, ROOT, never)).endsWith(abs)).toBe(
      true,
    );
  });

  it("falls back to path-as-given when a bare name has nothing under .claude/worktrees", () => {
    const resolved = norm(resolveWorktreePath("ghost", ROOT, () => false));
    // Resolved against cwd, NOT the /repo/.claude/worktrees candidate.
    expect(resolved).not.toBe("/repo/.claude/worktrees/ghost");
    expect(resolved.endsWith("/ghost")).toBe(true);
  });

  it("falls back to path-as-given for a bare name when the repo root is unresolvable", () => {
    // root=null → the .claude/worktrees candidate can't be built, even though
    // exists() would say yes; resolve against cwd instead.
    const resolved = norm(resolveWorktreePath("spec-006", null, () => true));
    expect(resolved).not.toBe("/repo/.claude/worktrees/spec-006");
    expect(resolved.endsWith("/spec-006")).toBe(true);
  });
});

/**
 * Unit cover for the fail-loud classifier (#603). A teardown target is one of:
 *   "registered"   — a live worktree in `git worktree list` (normal teardown),
 *   "orphan"       — deregistered but a directory still on disk (long-path case),
 *   "unresolvable" — neither registered nor present (mangled path / typo slug),
 *                    which MUST fail non-zero instead of masquerading as clean.
 * `registeredPaths` + `exists` are injected so no git subprocess / real FS runs.
 */
describe("worktree-teardown classifyTeardownTarget()", () => {
  const REG = "/repo/.claude/worktrees/603";

  it("classifies an unresolvable target (the mangled-path retro bug) as unresolvable", () => {
    // The retro scenario: backslashes eaten by the shell → a path that is
    // neither registered nor a real directory. Previous behavior: exit 0.
    const mangled = "/cwd/C:Userssidorreposds-platform.claudeworktrees598";
    expect(classifyTeardownTarget(mangled, [REG], () => false)).toBe(
      "unresolvable",
    );
  });

  it("classifies a typo slug (nothing on disk, not registered) as unresolvable", () => {
    expect(
      classifyTeardownTarget(
        "/repo/.claude/worktrees/ghost",
        [REG],
        () => false,
      ),
    ).toBe("unresolvable");
  });

  it("classifies a registered worktree path as registered", () => {
    expect(classifyTeardownTarget(REG, [REG], () => false)).toBe("registered");
  });

  it("classifies a deregistered-but-present orphan dir as orphan (long-path case keeps exit 0)", () => {
    // Not in the registered list, but the directory is still on disk.
    expect(
      classifyTeardownTarget("/repo/.claude/worktrees/598", [REG], () => true),
    ).toBe("orphan");
  });

  it("registered takes precedence over a present directory", () => {
    expect(classifyTeardownTarget(REG, [REG], () => true)).toBe("registered");
  });

  it("matches the registered list case-insensitively and across separators", () => {
    // git worktree list yields forward slashes; resolve() on Windows yields
    // backslashes + a drive-letter case that may differ — norm() bridges both.
    const absWin = "C:\\Repo\\.claude\\worktrees\\603";
    const registeredPosix = "c:/repo/.claude/worktrees/603";
    expect(classifyTeardownTarget(absWin, [registeredPosix], () => false)).toBe(
      "registered",
    );
  });
});

/**
 * Unit cover for the pre-purge process sweep's kill-scope (#616). The impure
 * half (Win32_Process snapshot, taskkill) is exercised live; these tests prove
 * the SAFETY property on the pure selectors: only processes whose command line
 * references the exact target worktree path are ever selected, and the
 * teardown's own process chain is shielded.
 */
const WT = "C:\\Users\\dev\\repos\\ds-platform\\.claude\\worktrees\\556";

describe("worktree-teardown commandLineReferencesPath()", () => {
  it("matches a command line holding a file under the worktree (the retro nest-start chain)", () => {
    expect(
      commandLineReferencesPath(
        'node "C:\\Users\\dev\\repos\\ds-platform\\.claude\\worktrees\\556\\apps\\api\\dist\\main.js"',
        WT,
      ),
    ).toBe(true);
  });

  it("matches across separator style and case (posix command line vs windows path)", () => {
    expect(
      commandLineReferencesPath(
        "node c:/users/DEV/repos/ds-platform/.claude/worktrees/556/apps/api/dist/main.js",
        WT,
      ),
    ).toBe(true);
  });

  it("matches the bare worktree path at end-of-string and before a quote", () => {
    expect(commandLineReferencesPath(`cmd /c cd ${WT}`, WT)).toBe(true);
    expect(commandLineReferencesPath(`powershell -Command "${WT}"`, WT)).toBe(
      true,
    );
  });

  it("NEVER matches a sibling worktree whose name extends the target's (61 vs 616)", () => {
    // The safety core: substring-contains alone would let worktree '61' kill
    // worktree '616' processes. The boundary check forbids it, both directions.
    const wt61 = "C:\\repo\\.claude\\worktrees\\61";
    const cmd616 = "node C:\\repo\\.claude\\worktrees\\616\\apps\\api\\main.js";
    expect(commandLineReferencesPath(cmd616, wt61)).toBe(false);
    const cmd61 = "node C:\\repo\\.claude\\worktrees\\61\\apps\\api\\main.js";
    expect(commandLineReferencesPath(cmd61, wt61)).toBe(true);
  });

  it("NEVER matches the main tree or another worktree", () => {
    expect(
      commandLineReferencesPath(
        "node C:\\Users\\dev\\repos\\ds-platform\\apps\\api\\dist\\main.js",
        WT,
      ),
    ).toBe(false);
    expect(
      commandLineReferencesPath(
        "node C:\\Users\\dev\\repos\\ds-platform\\.claude\\worktrees\\608\\apps\\api\\dist\\main.js",
        WT,
      ),
    ).toBe(false);
  });

  it("returns false for a null command line (Win32_Process yields null for protected processes)", () => {
    expect(commandLineReferencesPath(null, WT)).toBe(false);
    expect(commandLineReferencesPath("", WT)).toBe(false);
  });
});

describe("worktree-teardown collectProtectedPids()", () => {
  it("shields self plus the full ancestor chain (node ← pnpm ← shell)", () => {
    const table = [
      { pid: 100, ppid: 10, name: "node.exe", commandLine: null },
      { pid: 10, ppid: 1, name: "pnpm.cmd", commandLine: null },
      { pid: 1, ppid: 0, name: "powershell.exe", commandLine: null },
      { pid: 200, ppid: 1, name: "node.exe", commandLine: null },
    ];
    const shielded = collectProtectedPids(table, 100);
    expect([...shielded].sort((a, b) => a - b)).toEqual([1, 10, 100]);
  });

  it("shields self even when absent from the snapshot, and survives a ppid cycle", () => {
    expect([...collectProtectedPids([], 42)]).toEqual([42]);
    const cyclic = [
      { pid: 100, ppid: 10, name: "a", commandLine: null },
      { pid: 10, ppid: 100, name: "b", commandLine: null }, // PID-reuse loop
    ];
    const shielded = collectProtectedPids(cyclic, 100);
    expect(shielded.has(100)).toBe(true);
    expect(shielded.has(10)).toBe(true);
  });
});

describe("worktree-teardown selectWorktreeProcesses()", () => {
  const table = [
    // The retro orphan chain — all reference worktree 556.
    { pid: 300, ppid: 1, name: "node.exe", commandLine: `node ${WT}\\x.js` },
    { pid: 301, ppid: 300, name: "cmd.exe", commandLine: `cmd /c cd ${WT}` },
    // Another worktree + the main tree — must never be selected.
    {
      pid: 400,
      ppid: 1,
      name: "node.exe",
      commandLine:
        "node C:\\Users\\dev\\repos\\ds-platform\\.claude\\worktrees\\608\\x.js",
    },
    {
      pid: 401,
      ppid: 1,
      name: "node.exe",
      commandLine: "node C:\\Users\\dev\\repos\\ds-platform\\x.js",
    },
    // A protected system process (null command line) and the System PID.
    { pid: 500, ppid: 1, name: "svchost.exe", commandLine: null },
    { pid: 4, ppid: 0, name: "System", commandLine: `${WT}` },
  ];

  it("selects only processes whose command line references the target worktree", () => {
    const picked = selectWorktreeProcesses(table, WT);
    expect(picked.map((p) => p.pid).sort((a, b) => a - b)).toEqual([300, 301]);
  });

  it("never selects a shielded self/ancestor PID even when its command line matches", () => {
    // The teardown invoked with the ABSOLUTE worktree path: its own command
    // line (and pnpm's) contain the path — the shield must exclude them.
    const withSelf = [
      ...table,
      { pid: 600, ppid: 10, name: "node.exe", commandLine: `node t.mjs ${WT}` },
    ];
    const picked = selectWorktreeProcesses(withSelf, WT, new Set([600, 10]));
    expect(picked.map((p) => p.pid).sort((a, b) => a - b)).toEqual([300, 301]);
  });

  it("never selects the Windows Idle/System PIDs (<= 4)", () => {
    const picked = selectWorktreeProcesses(table, WT);
    expect(picked.some((p) => p.pid === 4)).toBe(false);
  });

  it("selects nothing for a clean worktree (no behavior change)", () => {
    const clean = "C:\\Users\\dev\\repos\\ds-platform\\.claude\\worktrees\\999";
    expect(selectWorktreeProcesses(table, clean)).toEqual([]);
  });
});

/**
 * Unit cover for the purge-failure holder escalation (#810). The retro case
 * (aa855696, twice on 2026-07-13): a dev-stand `node.exe` whose command line
 * did NOT reference the worktree held the tree via its CURRENT DIRECTORY, so
 * the cmdline-only sweep missed it and the purge died with "used by another
 * process" + a bare "remove by hand". These tests prove the escalation's pure
 * classifier: holder evidence = cwd / exe-path / cmdline inside the tree, or
 * descendant of such; killable iff the image is dev-tooling (allowlist);
 * anything else is FOREIGN (reported, never killed); protected self/ancestor
 * PIDs are shielded entirely.
 */
describe("worktree-teardown isDevToolingImage()", () => {
  it("accepts the dev-tooling family, case-insensitively, with or without .exe/.cmd", () => {
    for (const name of [
      "node.exe",
      "node",
      "NODE.EXE",
      "pnpm",
      "pnpm.cmd",
      "npm.cmd",
      "tsx.exe",
      "next",
      "esbuild.exe",
      "turbo.exe",
    ]) {
      expect(isDevToolingImage(name)).toBe(true);
    }
  });

  it("rejects anything outside the family (foreign holders are never killable)", () => {
    for (const name of [
      "powershell.exe",
      "cmd.exe",
      "chrome.exe",
      "Code.exe",
      "explorer.exe",
      "svchost.exe",
      "nodepad.exe", // near-miss: not 'node'
      "",
      null,
    ]) {
      expect(isDevToolingImage(name as string)).toBe(false);
    }
  });

  it("exports the allowlist constant with the exact image family", () => {
    expect([...DEV_TOOLING_IMAGES].sort()).toEqual(
      ["esbuild", "next", "node", "npm", "pnpm", "tsx", "turbo"].sort(),
    );
  });
});

describe("worktree-teardown pathIsUnder()", () => {
  it("matches the worktree root itself and any nested path", () => {
    expect(pathIsUnder(WT, WT)).toBe(true);
    expect(pathIsUnder(`${WT}\\apps\\api`, WT)).toBe(true);
  });

  it("bridges separator style and case", () => {
    expect(
      pathIsUnder(
        "c:/users/DEV/repos/ds-platform/.claude/worktrees/556/apps/api",
        WT,
      ),
    ).toBe(true);
  });

  it("NEVER matches a sibling worktree whose name extends the target's (61 vs 616)", () => {
    const wt61 = "C:\\repo\\.claude\\worktrees\\61";
    expect(pathIsUnder("C:\\repo\\.claude\\worktrees\\616\\apps", wt61)).toBe(
      false,
    );
    expect(pathIsUnder("C:\\repo\\.claude\\worktrees\\61\\apps", wt61)).toBe(
      true,
    );
  });

  it("returns false for null/empty candidates (Win32_Process yields nulls)", () => {
    expect(pathIsUnder(null, WT)).toBe(false);
    expect(pathIsUnder("", WT)).toBe(false);
    expect(pathIsUnder("C:\\elsewhere", WT)).toBe(false);
  });
});

describe("worktree-teardown classifyHolders()", () => {
  const row = (
    pid: number,
    ppid: number,
    name: string,
    over: Record<string, unknown> = {},
  ) => ({
    pid,
    ppid,
    name,
    executablePath: null,
    cwd: null,
    commandLine: null,
    ...over,
  });

  it("catches the retro case: a node.exe whose CWD is inside the tree but whose command line is not", () => {
    const table = [
      row(300, 1, "node.exe", {
        commandLine: "node apps/api/dist/main.js", // relative — the sweep missed exactly this
        cwd: `${WT}\\apps\\api`,
      }),
    ];
    const { killable, foreign } = classifyHolders(table, WT);
    expect(killable.map((p) => p.pid)).toEqual([300]);
    expect(killable[0].evidence).toMatch(/cwd/i);
    expect(foreign).toEqual([]);
  });

  it("catches an exe-path holder (binary run from the worktree's node_modules)", () => {
    const table = [
      row(310, 1, "esbuild.exe", {
        executablePath: `${WT}\\node_modules\\.pnpm\\esbuild\\esbuild.exe`,
      }),
    ];
    const { killable, foreign } = classifyHolders(table, WT);
    expect(killable.map((p) => p.pid)).toEqual([310]);
    expect(killable[0].evidence).toMatch(/executable/i);
    expect(foreign).toEqual([]);
  });

  it("expands to transitive descendants of a matched holder, cycle-safe", () => {
    const table = [
      row(300, 1, "node.exe", { cwd: WT }),
      row(301, 300, "node.exe"), // child, no own evidence
      row(302, 301, "esbuild.exe"), // grandchild, no own evidence
      row(400, 1, "node.exe"), // unrelated — must not be swept in
      // ppid cycle between two matched-subtree pids must not hang the walk
      row(303, 302, "tsx.exe", { ppid: 302 }),
    ];
    const { killable, foreign } = classifyHolders(table, WT);
    expect(killable.map((p) => p.pid).sort((a, b) => a - b)).toEqual([
      300, 301, 302, 303,
    ]);
    expect(
      killable.find((p) => p.pid === 302)?.evidence,
    ).toMatch(/descendant/i);
    expect(foreign).toEqual([]);
  });

  it("classifies a non-dev-tooling holder as FOREIGN (reported, never killable)", () => {
    const table = [
      row(500, 1, "powershell.exe", { cwd: `${WT}\\apps` }),
      row(300, 1, "node.exe", { cwd: WT }),
    ];
    const { killable, foreign } = classifyHolders(table, WT);
    expect(killable.map((p) => p.pid)).toEqual([300]);
    expect(foreign.map((p) => p.pid)).toEqual([500]);
    expect(foreign[0].evidence).toMatch(/cwd/i);
  });

  it("applies the allowlist boundary to descendants too (a chrome.exe child of a holder is foreign)", () => {
    const table = [
      row(300, 1, "node.exe", { cwd: WT }),
      row(301, 300, "chrome.exe"), // descendant of a holder, but not dev-tooling
    ];
    const { killable, foreign } = classifyHolders(table, WT);
    expect(killable.map((p) => p.pid)).toEqual([300]);
    expect(foreign.map((p) => p.pid)).toEqual([301]);
  });

  it("shields protected self/ancestor PIDs entirely — no selection, no expansion through them", () => {
    const table = [
      // The teardown's own ancestor chain cwd'd in the tree (invoked from inside).
      row(100, 10, "node.exe", { cwd: WT }),
      row(10, 1, "pnpm.cmd", { cwd: WT }),
      // A child of the protected pid with NO evidence of its own must not be
      // swept in via descendant expansion from a shielded root.
      row(101, 100, "node.exe"),
    ];
    const { killable, foreign } = classifyHolders(
      table,
      WT,
      new Set([100, 10]),
    );
    expect(killable).toEqual([]);
    expect(foreign).toEqual([]);
  });

  it("never selects the Windows Idle/System PIDs and ignores clean processes", () => {
    const table = [
      row(4, 0, "System", { cwd: WT }),
      row(600, 1, "node.exe", { cwd: "C:\\elsewhere" }),
    ];
    const { killable, foreign } = classifyHolders(table, WT);
    expect(killable).toEqual([]);
    expect(foreign).toEqual([]);
  });
});
