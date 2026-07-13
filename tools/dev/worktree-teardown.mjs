#!/usr/bin/env node
// DS Platform — subagent worktree teardown (long-path safe).
//
// Why: a subagent dispatched with `isolation:worktree` that ran `pnpm install`
// leaves a worktree whose deep `node_modules` paths exceed Windows MAX_PATH. So
// `git worktree remove --force <path>` DEREGISTERS the worktree (branch freed)
// but FAILS the filesystem delete with `error: failed to delete '...': Filename
// too long`, leaving an orphan directory that needs an improvised 3-4-step
// `\\?\ rmdir` / robocopy-mirror recovery on every teardown (#335). This helper
// makes each teardown one deterministic command.
//
// Canon: memory `reference_windows_worktree_teardown_longpath` (the recipe this
// promotes) + `feedback_subagent_dispatch_teardown` (the teardown step it wires
// into). On non-Windows the long-path dance is a no-op — plain remove suffices.
//
// Usage:
//   node tools/dev/worktree-teardown.mjs <worktree|path> [--keep-branch] [--branch <name>]
//   pnpm worktree:teardown 598                            # bare name → .claude/worktrees/598
//   pnpm worktree:teardown spec-006                       # bare slug → .claude/worktrees/spec-006
//   pnpm worktree:teardown .claude/worktrees/598          # explicit path (still works)
//
// The argument mirrors `task:worktree` name-resolution (#598): a BARE name (no
// path separator) resolves against the PRIMARY tree's `.claude/worktrees/<name>`
// — so a teardown fired from INSIDE another worktree targets the right tree, not
// the current cwd. An explicit path (absolute or with a separator) is honored
// as-given, and a bare name with nothing under `.claude/worktrees/` also falls
// back to path-as-given.
//
// What it does, in order:
//   1. kill worktree-scoped orphan processes (#616): Windows-only sweep of
//      `Win32_Process` for command lines referencing the target worktree path
//      (strictly path-scoped; self + ancestor PIDs shielded) — a surviving
//      `nest start` chain otherwise holds handles that fail the FS purge
//      ("used by another process"). Non-Windows / no-PowerShell → skipped
//      gracefully (POSIX rm does not fail on held handles),
//   2. resolve the worktree's branch from `git worktree list --porcelain`,
//   3. `git worktree remove --force` (tolerating the long-path FS error),
//   4. delete any orphan dir: Windows → PowerShell `Remove-Item -LiteralPath
//      "\\?\<path>" -Recurse -Force` (verified most reliable one-shot purge),
//      then `cmd /c rmdir /s /q \\?\<path>`, then a robocopy-mirror-from-empty
//      retry; POSIX → fs.rmSync recursive,
//   5. on Windows purge failure, escalate to holder-PID detection (#810): the
//      cmdline sweep in step 1 misses a holder whose command line never names
//      the tree (retro aa855696 — a dev-stand node.exe merely CWD'd inside it),
//      so the escalation snapshots `Win32_Process` with ExecutablePath plus a
//      per-PID current directory (NtQueryInformationProcess → PEB), matches
//      holders by cwd / exe-path / cmdline inside the tree + their transitive
//      descendants, reports each holder's listening TCP ports (diagnostics
//      only, never a kill criterion), kills only dev-tooling images
//      (DEV_TOOLING_IMAGES — node/pnpm/npm/tsx/next/esbuild/turbo) outside the
//      self/ancestor shield, and retries the purge ONCE. A non-dev-tooling
//      holder is FOREIGN: named (pid + image + evidence), never killed, exit 1,
//   6. `git worktree prune`,
//   7. branch cleanup (unless --keep-branch): a temp `worktree-agent-*` branch
//      is deleted unconditionally; any other branch only if already merged into
//      main (ancestor check) — an unmerged non-temp branch is kept + warned.
//
// Exit codes: 0 = torn down clean (dir gone, branch handled); 1 = the orphan
// directory could not be removed — only with a NAMED foreign holder, or with
// the holder state explicitly reported (killed-but-still-failing / none
// detectable / enumeration unavailable) — never a bare "remove by hand";
// 2 = usage error; 3 = unresolvable target — the argument names neither a
// registered worktree nor a directory under `.claude/worktrees/` (a
// shell-mangled backslash path or a typo slug). Fail loud instead of a WARN +
// exit 0 that masquerades as a clean teardown (#603).

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";

const IS_WIN = process.platform === "win32";

function out(msg) {
  process.stdout.write(`[worktree-teardown] ${msg}\n`);
}
function warn(msg) {
  process.stderr.write(`[worktree-teardown] WARN: ${msg}\n`);
}
function die(msg, code = 2) {
  process.stderr.write(`[worktree-teardown] ${msg}\n`);
  process.exit(code);
}

/** Run a command, never throw; return {status, stdout, stderr}. */
function run(cmd, args) {
  // maxBuffer raised above the 1 MiB default: the Win32_Process JSON dump for
  // the process sweep (#616) can exceed it on a busy box.
  const res = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    error: res.error,
  };
}

/** Normalize a path for cross-tool comparison (lowercase, forward slashes). */
const norm = (p) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/**
 * The primary working tree's root, even when invoked from inside a linked
 * worktree (mirrors task-worktree.mjs). Returns null if not resolvable (not a
 * git repo) — bare-name resolution then falls back to path-as-given.
 */
function mainRepoRoot() {
  const res = run("git", ["rev-parse", "--git-common-dir"]);
  if (res.status !== 0) return null;
  // --git-common-dir → "<root>/.git" — resolve against cwd, root is its parent.
  return dirname(resolve(res.stdout.trim()));
}

/**
 * Resolve the teardown argument to an absolute worktree path, mirroring
 * `task:worktree` name-resolution (#598). A BARE name (no path separator, not
 * absolute) resolves against the PRIMARY tree's `.claude/worktrees/<name>`, so
 * `pnpm worktree:teardown <slug>` fired from inside another worktree targets the
 * right tree rather than the current cwd. An explicit path (absolute or
 * containing a separator) is honored as-given, and a bare name with nothing
 * under `.claude/worktrees/` also falls back to path-as-given.
 *
 * Pure + injectable (`root`, `exists`) so the guard-test harness can drive it
 * without a git subprocess or a real filesystem.
 */
export function resolveWorktreePath(rawArg, root, exists = existsSync) {
  if (isAbsolute(rawArg) || /[\\/]/.test(rawArg)) return resolve(rawArg);
  if (root) {
    const candidate = join(root, ".claude", "worktrees", rawArg);
    if (exists(candidate)) return candidate;
  }
  return resolve(rawArg);
}

/**
 * Classify a teardown target so the caller can fail loud on an unresolvable one
 * (#603) instead of the old WARN + exit 0. Given the resolved absolute path, the
 * registered-worktree paths (from `git worktree list`), and an `exists` probe:
 *   - "registered"   — matches a live registered worktree → normal teardown,
 *   - "orphan"       — not registered but a directory is still on disk → the
 *                      long-path deregistered-but-present case (keeps exit 0),
 *   - "unresolvable" — neither → a shell-mangled backslash path or typo slug
 *                      that must NOT masquerade as a clean teardown.
 *
 * Pure + injectable (`registeredPaths`, `exists`) so the guard-test harness can
 * drive every branch without a git subprocess or a real filesystem. Comparison
 * is via `norm()` so git's forward-slash output and `resolve()`'s Windows
 * backslashes/drive-letter case still match.
 */
export function classifyTeardownTarget(
  absPath,
  registeredPaths,
  exists = existsSync,
) {
  const want = norm(absPath);
  if (registeredPaths.some((p) => norm(p) === want)) return "registered";
  if (exists(absPath)) return "orphan";
  return "unresolvable";
}

/**
 * True when a process command line references the worktree at `absPath` (#616).
 * Matching is strictly path-scoped and boundary-aware: after normalizing both
 * sides (backslashes → `/`, lowercase), the worktree path must appear followed
 * by a path separator, whitespace, a quote, or end-of-string — so the worktree
 * `…/worktrees/61` never matches a command line referencing `…/worktrees/616`,
 * and nothing outside the exact worktree subtree can ever match.
 *
 * Pure (string → bool) so the guard-test harness can drive it directly.
 */
export function commandLineReferencesPath(commandLine, absPath) {
  if (typeof commandLine !== "string" || commandLine.length === 0) return false;
  const cmd = commandLine.replace(/\\/g, "/").toLowerCase();
  const want = norm(absPath);
  if (!want) return false;
  let idx = cmd.indexOf(want);
  while (idx !== -1) {
    const next = cmd[idx + want.length];
    if (
      next === undefined ||
      next === "/" ||
      next === '"' ||
      next === "'" ||
      /\s/.test(next)
    ) {
      return true;
    }
    idx = cmd.indexOf(want, idx + 1);
  }
  return false;
}

/**
 * The PID set the sweep must never touch (#616): this process plus its ancestor
 * chain (pnpm → shell → the dispatching agent session). When the teardown is
 * invoked with the worktree's ABSOLUTE path as its argument, the teardown's own
 * command line — and its ancestors' — contain that path, so without this shield
 * the sweep would kill itself mid-teardown.
 *
 * Pure + injectable (`processes` rows carry {pid, ppid}, `selfPid` explicit) so
 * the guard-test harness can drive it. The walk is cycle-safe (PID-reuse can
 * make ppid chains loop).
 */
export function collectProtectedPids(processes, selfPid) {
  const byPid = new Map(processes.map((p) => [p.pid, p]));
  const shielded = new Set([selfPid]);
  let cur = byPid.get(selfPid);
  while (
    cur &&
    Number.isInteger(cur.ppid) &&
    cur.ppid > 0 &&
    !shielded.has(cur.ppid)
  ) {
    shielded.add(cur.ppid);
    cur = byPid.get(cur.ppid);
  }
  return shielded;
}

/**
 * Select the processes the pre-purge sweep may kill (#616): command line
 * references the target worktree path (boundary-aware, see
 * `commandLineReferencesPath`), PID is a real user process (> 4 — never the
 * Windows Idle/System PIDs), and PID is not in the shielded self/ancestor set.
 *
 * Pure + injectable so the guard-test harness proves the kill scope without a
 * live process table.
 */
export function selectWorktreeProcesses(
  processes,
  absPath,
  protectedPids = new Set(),
) {
  return processes.filter(
    (p) =>
      Number.isInteger(p.pid) &&
      p.pid > 4 &&
      !protectedPids.has(p.pid) &&
      commandLineReferencesPath(p.commandLine, absPath),
  );
}

/**
 * The image-name family the holder escalation (#810) may kill: our own dev
 * tooling and nothing else. A holder outside this family is FOREIGN — named,
 * never killed. Matching strips a `.exe`/`.cmd`/`.bat`/`.com` extension and is
 * case-insensitive (see `isDevToolingImage`).
 */
export const DEV_TOOLING_IMAGES = [
  "node",
  "pnpm",
  "npm",
  "tsx",
  "next",
  "esbuild",
  "turbo",
];

/**
 * True when a process image name belongs to the dev-tooling family (#810).
 * Pure (string → bool) so the guard-test harness can drive it directly.
 */
export function isDevToolingImage(name) {
  if (typeof name !== "string" || name.length === 0) return false;
  const base = name.toLowerCase().replace(/\.(exe|cmd|bat|com)$/, "");
  return DEV_TOOLING_IMAGES.includes(base);
}

/**
 * True when `candidate` is the directory at `absPath` or anything nested under
 * it (#810). Boundary-aware like `commandLineReferencesPath`: worktree `…/61`
 * never contains `…/616`. Bridges separator style and case via `norm()`.
 * Pure (string → bool) so the guard-test harness can drive it directly.
 */
export function pathIsUnder(candidate, absPath) {
  if (typeof candidate !== "string" || candidate.length === 0) return false;
  const want = norm(absPath);
  if (!want) return false;
  const c = norm(candidate);
  return c === want || c.startsWith(`${want}/`);
}

/**
 * Classify the processes holding the worktree at `absPath` for the
 * purge-failure escalation (#810). A process is a HOLDER when its evidence
 * roots it in THIS worktree — current directory, executable path, or command
 * line inside the tree — or when it is a transitive descendant of such a
 * process (ParentProcessId chain, cycle-safe). The Windows Idle/System PIDs
 * (<= 4) and the shielded self/ancestor set are excluded entirely: never
 * selected, never expanded through.
 *
 * A holder is KILLABLE iff its image name is in the dev-tooling family
 * (`DEV_TOOLING_IMAGES`); anything else is FOREIGN — the caller names it and
 * exits 1 without killing. Rows carry {pid, ppid, name, executablePath, cwd,
 * commandLine}; each returned holder gains an `evidence` string.
 *
 * Pure + injectable so the guard-test harness proves the kill scope without a
 * live process table.
 */
export function classifyHolders(processes, absPath, protectedPids = new Set()) {
  const eligible = (p) =>
    Number.isInteger(p.pid) && p.pid > 4 && !protectedPids.has(p.pid);
  const evidenceOf = (p) => {
    if (pathIsUnder(p.cwd, absPath))
      return `cwd '${p.cwd}' is inside the worktree`;
    if (pathIsUnder(p.executablePath, absPath))
      return `executable '${p.executablePath}' is inside the worktree`;
    if (commandLineReferencesPath(p.commandLine, absPath))
      return "command line references the worktree";
    return null;
  };

  const holders = new Map(); // pid → row + evidence
  for (const p of processes) {
    if (!eligible(p)) continue;
    const evidence = evidenceOf(p);
    if (evidence) holders.set(p.pid, { ...p, evidence });
  }

  // Transitive descendants of any matched holder are holders too (a matched
  // parent's children inherit its handles/cwd). Cycle-safe: a pid already in
  // `holders` is never re-queued, so PID-reuse ppid loops terminate.
  const childrenOf = new Map();
  for (const p of processes) {
    if (!childrenOf.has(p.ppid)) childrenOf.set(p.ppid, []);
    childrenOf.get(p.ppid).push(p);
  }
  const queue = [...holders.keys()];
  while (queue.length > 0) {
    const pid = queue.shift();
    for (const child of childrenOf.get(pid) ?? []) {
      if (!eligible(child) || holders.has(child.pid)) continue;
      holders.set(child.pid, {
        ...child,
        evidence: `descendant of holder pid=${pid}`,
      });
      queue.push(child.pid);
    }
  }

  const killable = [];
  const foreign = [];
  for (const h of holders.values()) {
    (isDevToolingImage(h.name) ? killable : foreign).push(h);
  }
  return { killable, foreign };
}

/**
 * Snapshot the live process table via `Win32_Process` (Windows only). Returns
 * rows of {pid, ppid, name, commandLine} or null when enumeration is
 * unavailable/failed — the caller then skips the sweep gracefully rather than
 * blocking the teardown.
 */
function listProcessesWindows() {
  const script =
    "Get-CimInstance Win32_Process | " +
    "Select-Object ProcessId,ParentProcessId,Name,CommandLine | " +
    "ConvertTo-Json -Compress";
  const res = run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
  ]);
  if (res.error || res.status !== 0) return null;
  try {
    const parsed = JSON.parse(res.stdout);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.map((r) => ({
      pid: r.ProcessId,
      ppid: r.ParentProcessId,
      name: r.Name ?? "",
      commandLine: r.CommandLine ?? null,
    }));
  } catch {
    return null;
  }
}

/**
 * Pre-purge process sweep (#616): kill processes whose command line references
 * the target worktree, so held handles (e.g. a subagent's surviving `nest
 * start` chain) stop failing the FS purge with "used by another process".
 * Subagent self-reports about process teardown are structurally unreliable —
 * this puts the sweep in the deterministic teardown step instead.
 *
 * Windows-only by design: on POSIX `rm -rf` does not fail on held handles, so
 * the sweep is skipped gracefully there (and also when `Get-CimInstance` is
 * unavailable or fails).
 */
function sweepWorktreeProcesses(absPath) {
  if (!IS_WIN) {
    out(
      "process sweep skipped (non-Windows: held handles do not block the purge).",
    );
    return;
  }
  const procs = listProcessesWindows();
  if (!procs) {
    warn(
      "process sweep unavailable (Win32_Process enumeration failed) — proceeding; the purge may fail on held handles.",
    );
    return;
  }
  const shielded = collectProtectedPids(procs, process.pid);
  const matched = selectWorktreeProcesses(procs, absPath, shielded);
  if (matched.length === 0) {
    out("no processes reference the worktree — nothing to kill.");
    return;
  }
  for (const p of matched) {
    const res = run("taskkill", ["/PID", String(p.pid), "/F"]);
    if (res.status === 0) {
      out(
        `killed orphan process pid=${p.pid} name=${p.name} (command line references '${absPath}').`,
      );
    } else {
      // Non-fatal: the process may have exited between snapshot and kill; the
      // purge below is the real gate and still fails loud on a held handle.
      warn(
        `could not kill pid=${p.pid} name=${p.name}: ${(res.stderr || res.stdout).trim()}`,
      );
    }
  }
}

// C# helper compiled in-process by the escalation snapshot (#810): reads a
// target process's CURRENT DIRECTORY via NtQueryInformationProcess → PEB →
// RTL_USER_PROCESS_PARAMETERS.CurrentDirectory.DosPath (x64 offsets 0x20 /
// 0x38 — the standard Add-Type snippet). Per-PID failures (access denied,
// exited, 32-bit edge cases) return null and are skipped.
const PROC_CWD_CSHARP = `
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class ProcCwd {
  [DllImport("ntdll.dll")]
  private static extern int NtQueryInformationProcess(IntPtr h, int cls, ref PBI pbi, int len, out int ret);
  [DllImport("kernel32.dll", SetLastError=true)]
  private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError=true)]
  private static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, int size, out IntPtr read);
  [DllImport("kernel32.dll")]
  private static extern bool CloseHandle(IntPtr h);
  [StructLayout(LayoutKind.Sequential)]
  private struct PBI {
    public IntPtr ExitStatus; public IntPtr PebBaseAddress; public IntPtr AffinityMask;
    public IntPtr BasePriority; public IntPtr UniqueProcessId; public IntPtr InheritedFromUniqueProcessId;
  }
  public static string GetCwd(int pid) {
    // PROCESS_QUERY_INFORMATION | PROCESS_VM_READ
    IntPtr h = OpenProcess(0x0410u, false, pid);
    if (h == IntPtr.Zero) return null;
    try {
      PBI pbi = new PBI(); int ret;
      if (NtQueryInformationProcess(h, 0, ref pbi, Marshal.SizeOf(typeof(PBI)), out ret) != 0) return null;
      if (pbi.PebBaseAddress == IntPtr.Zero) return null;
      byte[] ptrBuf = new byte[8]; IntPtr read;
      // PEB+0x20 → ProcessParameters (x64)
      if (!ReadProcessMemory(h, IntPtr.Add(pbi.PebBaseAddress, 0x20), ptrBuf, 8, out read)) return null;
      IntPtr pp = new IntPtr(BitConverter.ToInt64(ptrBuf, 0));
      if (pp == IntPtr.Zero) return null;
      // ProcessParameters+0x38 → CurrentDirectory.DosPath (UNICODE_STRING)
      byte[] us = new byte[16];
      if (!ReadProcessMemory(h, IntPtr.Add(pp, 0x38), us, 16, out read)) return null;
      ushort len = BitConverter.ToUInt16(us, 0);
      IntPtr strPtr = new IntPtr(BitConverter.ToInt64(us, 8));
      if (len == 0 || len > 32768 || strPtr == IntPtr.Zero) return null;
      byte[] strBuf = new byte[len];
      if (!ReadProcessMemory(h, strPtr, strBuf, len, out read)) return null;
      return Encoding.Unicode.GetString(strBuf).TrimEnd('\\\\');
    } catch { return null; } finally { CloseHandle(h); }
  }
}
`;

/**
 * Run a (possibly multi-line) PowerShell script via `-EncodedCommand` — the
 * base64/UTF-16LE transport sidesteps every Windows argument-quoting and
 * newline hazard that `-Command` has for scripts with embedded here-strings.
 */
function runPowerShell(script) {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    encoded,
  ]);
}

/**
 * Detailed process snapshot for the holder escalation (#810): `Win32_Process`
 * rows enriched with ExecutablePath and the per-PID current directory (PEB
 * read, try/catch per PID — inaccessible PIDs yield null cwd rather than
 * failing the snapshot). Windows only; returns null when enumeration fails —
 * the caller then reports the holders-undetectable state instead of killing
 * blind.
 */
function listProcessesWindowsDetailed() {
  const script =
    `Add-Type -TypeDefinition @'\n${PROC_CWD_CSHARP}\n'@\n` +
    "$rows = Get-CimInstance Win32_Process | ForEach-Object {\n" +
    "  $cwd = $null\n" +
    "  try { $cwd = [ProcCwd]::GetCwd([int]$_.ProcessId) } catch {}\n" +
    "  [pscustomobject]@{ ProcessId = $_.ProcessId; ParentProcessId = $_.ParentProcessId;\n" +
    "    Name = $_.Name; ExecutablePath = $_.ExecutablePath; CommandLine = $_.CommandLine; Cwd = $cwd }\n" +
    "}\n" +
    "ConvertTo-Json -InputObject @($rows) -Compress";
  const res = runPowerShell(script);
  if (res.error || res.status !== 0) return null;
  try {
    const parsed = JSON.parse(res.stdout);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.map((r) => ({
      pid: r.ProcessId,
      ppid: r.ParentProcessId,
      name: r.Name ?? "",
      executablePath: r.ExecutablePath ?? null,
      commandLine: r.CommandLine ?? null,
      cwd: r.Cwd ?? null,
    }));
  } catch {
    return null;
  }
}

/**
 * Listening TCP ports per owning PID (`Get-NetTCPConnection -State Listen`) —
 * DIAGNOSTICS ONLY for the holder report (#810): a port names the stand a
 * holder belongs to, but a port alone is never a kill criterion. Returns a
 * Map pid → [ports], empty on any failure.
 */
function listListeningPortsByPid() {
  const script =
    "Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | " +
    "Select-Object OwningProcess,LocalPort | ConvertTo-Json -Compress";
  const res = runPowerShell(script);
  const byPid = new Map();
  if (res.error || res.status !== 0) return byPid;
  try {
    const parsed = JSON.parse(res.stdout);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    for (const r of rows) {
      if (!Number.isInteger(r.OwningProcess)) continue;
      if (!byPid.has(r.OwningProcess)) byPid.set(r.OwningProcess, []);
      byPid.get(r.OwningProcess).push(r.LocalPort);
    }
  } catch {
    /* diagnostics only — an unparsable dump degrades to no port info */
  }
  return byPid;
}

/** All registered worktree absolute paths, from `git worktree list --porcelain`. */
function listWorktreePaths() {
  const res = run("git", ["worktree", "list", "--porcelain"]);
  if (res.status !== 0) return [];
  const paths = [];
  for (const line of res.stdout.split(/\r?\n/)) {
    if (line.startsWith("worktree "))
      paths.push(line.slice("worktree ".length));
  }
  return paths;
}

/** Find the branch checked out in the worktree at `absPath`, or null (detached). */
function resolveWorktreeBranch(absPath) {
  const res = run("git", ["worktree", "list", "--porcelain"]);
  if (res.status !== 0) return null;
  const want = norm(absPath);
  let current = null;
  for (const line of res.stdout.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      current = norm(line.slice("worktree ".length));
    } else if (line.startsWith("branch ") && current === want) {
      return line.slice("branch ".length).replace(/^refs\/heads\//, "");
    }
  }
  return null;
}

/** Windows long-path-aware directory purge. Returns true if the dir is gone. */
function purgeDirWindows(absPath) {
  const winPath = win32.normalize(absPath);
  const longPath = `\\\\?\\${winPath}`;
  // Pass 1 — PowerShell Remove-Item on the \\?\ literal path: verified the
  // most reliable one-shot purge for these trees (2026-07-05 ×2, 2026-07-13).
  runPowerShell(
    `Remove-Item -LiteralPath '${longPath.replace(/'/g, "''")}' -Recurse -Force -ErrorAction SilentlyContinue`,
  );
  if (!existsSync(absPath)) return true;
  // Pass 2 — cmd rmdir on the \\?\ path (bypasses MAX_PATH).
  run("cmd", ["/c", "rmdir", "/s", "/q", longPath]);
  if (!existsSync(absPath)) return true;
  // Pass 3 — empty the tree with robocopy /MIR from a fresh empty dir, then retry.
  // robocopy exit codes < 8 are success-ish (1/2/3 = copied/extra/mismatch).
  const empty = mkdtempSync(join(tmpdir(), "wt-empty-"));
  try {
    run("robocopy", [
      empty,
      winPath,
      "/MIR",
      "/NFL",
      "/NDL",
      "/NJH",
      "/NJS",
      "/NC",
      "/NS",
    ]);
    run("cmd", ["/c", "rmdir", "/s", "/q", longPath]);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
  return !existsSync(absPath);
}

/**
 * Purge-failure escalation (#810): detect the PIDs actually HOLDING the tree
 * (cwd / exe-path / cmdline inside it + transitive descendants — the cmdline
 * sweep alone missed a dev-stand node.exe merely CWD'd in the tree, retro
 * aa855696), report each with its evidence and listening TCP ports
 * (diagnostics only), kill only dev-tooling images outside the self/ancestor
 * shield, and retry the purge ONCE. Exits 0 via the caller on success; exits 1
 * here with the holder state always NAMED — a foreign holder (never killed),
 * killed-but-still-failing, none detectable, or enumeration unavailable —
 * never a bare "remove by hand".
 */
function escalatePurgeFailure(absPath) {
  out("purge failed — escalating to holder-PID detection (#810).");
  const procs = listProcessesWindowsDetailed();
  if (!procs) {
    die(
      `could not remove orphan directory '${absPath}' — holder detection unavailable ` +
        `(Win32_Process enumeration failed) and the purge still fails. Find the holder by ` +
        `hand (e.g. Get-NetTCPConnection -State Listen; Stop-Process) and re-run.`,
      1,
    );
  }
  const shielded = collectProtectedPids(procs, process.pid);
  const { killable, foreign } = classifyHolders(procs, absPath, shielded);
  const portsByPid = listListeningPortsByPid();
  const describe = (p) => {
    const ports = portsByPid.get(p.pid);
    const portNote = ports?.length
      ? ` (listening on TCP ${[...ports].sort((a, b) => a - b).join(", ")})`
      : "";
    return `pid=${p.pid} name=${p.name}${portNote} — ${p.evidence}`;
  };

  for (const p of foreign) {
    warn(`FOREIGN holder (not killed): ${describe(p)}`);
  }
  for (const p of killable) {
    const res = run("taskkill", ["/PID", String(p.pid), "/F"]);
    if (res.status === 0) out(`killed holder ${describe(p)}.`);
    else
      warn(
        `could not kill holder pid=${p.pid} name=${p.name}: ${(res.stderr || res.stdout).trim()}`,
      );
  }

  // Retry the purge ONCE after the kills.
  if (purgeDir(absPath)) {
    out(`purged orphan directory '${absPath}' after killing its holder(s).`);
    return;
  }
  if (foreign.length > 0) {
    die(
      `could not remove orphan directory '${absPath}' — a FOREIGN process holds it ` +
        `(not dev-tooling, not killed):\n` +
        foreign.map((p) => `    ${describe(p)}`).join("\n") +
        `\nStop it yourself if it is safe, then re-run the teardown.`,
      1,
    );
  }
  die(
    killable.length > 0
      ? `could not remove orphan directory '${absPath}' — its dev-tooling holder(s) were ` +
          `killed but the purge still fails; a holder is undetectable by cwd/exe-path/cmdline ` +
          `evidence. Find it by handle (e.g. Sysinternals 'handle.exe ${absPath}') and re-run.`
      : `could not remove orphan directory '${absPath}' — no holder is detectable by ` +
          `cwd/exe-path/cmdline evidence and the purge still fails. Find it by handle ` +
          `(e.g. Sysinternals 'handle.exe ${absPath}') and re-run.`,
    1,
  );
}

function purgeDir(absPath) {
  if (!existsSync(absPath)) return true;
  if (IS_WIN) return purgeDirWindows(absPath);
  rmSync(absPath, { recursive: true, force: true });
  return !existsSync(absPath);
}

function cleanupBranch(branch) {
  if (!branch) {
    out("worktree was detached (no branch) — nothing to delete.");
    return;
  }
  if (/^worktree-agent-/.test(branch)) {
    const res = run("git", ["branch", "-D", branch]);
    if (res.status === 0) out(`deleted temp isolation branch '${branch}'.`);
    else warn(`could not delete temp branch '${branch}': ${res.stderr.trim()}`);
    return;
  }
  // Non-temp branch: only delete if already merged into main (safe).
  const merged = run("git", ["merge-base", "--is-ancestor", branch, "main"]);
  if (merged.status === 0) {
    const res = run("git", ["branch", "-d", branch]);
    if (res.status === 0) out(`deleted merged branch '${branch}'.`);
    else
      warn(`could not delete merged branch '${branch}': ${res.stderr.trim()}`);
  } else {
    warn(
      `branch '${branch}' is not merged into main — kept (delete by hand if intended, or pass --branch to override).`,
    );
  }
}

function main() {
  const args = process.argv.slice(2);
  let keepBranch = false;
  let branchOverride = null;
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--keep-branch") keepBranch = true;
    else if (a === "--branch")
      branchOverride = args[(i += 1)]; // consume the value
    else if (a.startsWith("--")) die(`unknown flag '${a}'`);
    else positional.push(a);
  }

  if (positional.length !== 1) {
    die(
      "Usage: node tools/dev/worktree-teardown.mjs <worktree|path> [--keep-branch] [--branch <name>]",
    );
  }
  const absPath = resolveWorktreePath(positional[0], mainRepoRoot());

  // 0. Fail loud on an unresolvable target BEFORE any destructive git call
  //    (#603). A shell-mangled backslash path or a typo slug resolves to neither
  //    a registered worktree nor a dir on disk; the old code WARN'd + exited 0,
  //    silently no-op'ing while the real worktree stayed registered.
  const registeredPaths = listWorktreePaths();
  if (
    classifyTeardownTarget(absPath, registeredPaths, existsSync) ===
    "unresolvable"
  ) {
    const listing = registeredPaths.length
      ? registeredPaths.map((p) => `    ${p}`).join("\n")
      : "    (none registered)";
    die(
      `'${positional[0]}' resolved to '${absPath}', which is neither a registered ` +
        `worktree nor a directory under .claude/worktrees/ — nothing was torn down.\n` +
        `Registered worktrees:\n${listing}\n` +
        `Hint: pass the bare slug (e.g. 'pnpm worktree:teardown 603'); a backslashed ` +
        `Windows path can be mangled by the shell into an unresolvable string.`,
      3,
    );
  }

  // 1. Kill worktree-scoped orphan processes BEFORE any FS delete (#616) — a
  //    surviving process chain holding the worktree otherwise fails the purge.
  sweepWorktreeProcesses(absPath);

  // 2. Capture the branch before removal deregisters the worktree.
  const branch = branchOverride ?? resolveWorktreeBranch(absPath);

  // 3. Deregister via git (tolerate the long-path FS-delete failure).
  const removed = run("git", ["worktree", "remove", "--force", absPath]);
  if (removed.status === 0) {
    out(`git deregistered + removed worktree '${absPath}'.`);
  } else if (/filename too long|failed to delete/i.test(removed.stderr)) {
    out(
      `git deregistered worktree '${absPath}' (FS delete hit the long-path limit — purging below).`,
    );
  } else if (/is not a working tree|No such/i.test(removed.stderr)) {
    warn(
      `'${absPath}' is not a registered worktree — purging any orphan dir anyway.`,
    );
  } else if (removed.status !== 0) {
    warn(
      `git worktree remove returned ${removed.status}: ${removed.stderr.trim()}`,
    );
  }

  // 4. Purge any orphan directory left on disk; on Windows a failed purge
  //    escalates to holder-PID detection + a single retry (#810) instead of
  //    a bare "remove by hand".
  if (existsSync(absPath)) {
    if (purgeDir(absPath)) out(`purged orphan directory '${absPath}'.`);
    else if (IS_WIN) escalatePurgeFailure(absPath); // die(1) inside on failure
    else
      die(
        `could not remove orphan directory '${absPath}' — remove by hand.`,
        1,
      );
  } else {
    out("no orphan directory left on disk.");
  }

  // 5. Prune stale worktree administrative entries.
  run("git", ["worktree", "prune"]);
  out("git worktree prune done.");

  // 6. Branch cleanup.
  if (keepBranch)
    out(`--keep-branch: leaving branch '${branch ?? "(detached)"}' in place.`);
  else cleanupBranch(branch);

  out(`teardown complete for '${absPath}'.`);
  process.exit(0);
}

// Run only as the entry point — the IS_ENTRY guard keeps `resolveWorktreePath`
// importable from the guard-test harness without firing `main()` / its
// git + filesystem side effects (mirrors task-worktree.mjs).
const INVOKED = process.argv[1] ? resolve(process.argv[1]) : "";
const SELF = resolve(fileURLToPath(import.meta.url));
if (INVOKED === SELF) {
  main();
}
