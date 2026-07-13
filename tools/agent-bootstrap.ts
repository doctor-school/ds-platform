#!/usr/bin/env tsx
/**
 * tools/agent-bootstrap.ts — deterministic session bootstrap.
 *
 * Spec: docs/superpowers/specs/2026-05-15-ds-platform-ai-stack-design-en.md §4
 * ADR:  docs/adr/0007-ai-stack-en.md §2.5
 *
 * Prints a ≤ 2 KB markdown snapshot of git + GitHub state + active spec metadata
 * + recommended next step. Used by Claude Code SessionStart hook (pnpm bootstrap),
 * Codex AGENTS.md "Before any task" first step, or manual invocation.
 *
 * Hard rule: NEVER throw an unhandled error. Every failure path returns a
 * printable warning so the SessionStart hook does not crash. Exit code is
 * always 0 (warnings reported in a "Warnings" section).
 */
import { execa } from "execa";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import {
  evaluateMainSync,
  mainSyncFixCommand,
  mainSyncMessage,
  primaryWorktreePath,
  probeMainSync,
} from "./main-sync";
import { claimLabel, probeClaim } from "./backlog-triage";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface Warn {
  source: string;
  message: string;
}
const warnings: Warn[] = [];

function note(source: string, err: unknown): void {
  const message =
    err instanceof Error ? err.message.split("\n")[0] : String(err);
  warnings.push({ source, message });
}

interface GitState {
  branch: string;
  clean: boolean;
  recent: string[];
  aheadOfMain: string; // "?" if unknown
}

async function gitState(): Promise<GitState> {
  let branch = "(unknown)";
  let clean = true;
  let recent: string[] = [];
  let aheadOfMain = "?";

  try {
    const { stdout } = await execa("git", ["branch", "--show-current"], {
      cwd: REPO_ROOT,
    });
    branch = stdout.trim() || "(detached)";
  } catch (e) {
    note("git branch", e);
  }

  try {
    const { stdout } = await execa("git", ["status", "--porcelain"], {
      cwd: REPO_ROOT,
    });
    clean = stdout.trim() === "";
  } catch (e) {
    note("git status", e);
  }

  try {
    const { stdout } = await execa("git", ["log", "-5", "--pretty=%h %s"], {
      cwd: REPO_ROOT,
    });
    recent = stdout.split("\n").filter(Boolean);
  } catch (e) {
    note("git log", e);
  }

  try {
    const { stdout } = await execa(
      "git",
      ["rev-list", "--count", "origin/main..HEAD"],
      {
        cwd: REPO_ROOT,
      },
    );
    aheadOfMain = stdout.trim();
  } catch {
    // origin/main not fetched yet — common on fresh clone / fresh repo.
    aheadOfMain = "?";
  }

  return { branch, clean, recent, aheadOfMain };
}

interface GhIssue {
  number: number;
  title: string;
  labels?: Array<{ name: string }>;
  milestone?: { title: string } | null;
  assignees?: Array<{ login: string }>;
  updatedAt?: string;
  body?: string;
}

interface GhPR {
  number: number;
  title: string;
  reviewDecision?: string | null;
  updatedAt?: string;
  headRefName?: string;
  author?: { login: string };
  statusCheckRollup?: Array<{
    conclusion?: string | null;
    status?: string | null;
  }>;
}

interface GhPRGroups {
  mine: GhPR[];
  others: GhPR[];
}

type CiState = "red" | "yellow" | "green" | "none";

function ciState(p: GhPR): CiState {
  const rollup = p.statusCheckRollup ?? [];
  if (rollup.length === 0) return "none";
  if (
    rollup.some(
      (c) =>
        c.conclusion === "FAILURE" ||
        c.conclusion === "TIMED_OUT" ||
        c.conclusion === "CANCELLED" ||
        c.conclusion === "STARTUP_FAILURE",
    )
  ) {
    return "red";
  }
  if (rollup.some((c) => c.status !== "COMPLETED")) return "yellow";
  return "green";
}

const CI_BADGE: Record<CiState, string> = {
  red: "CI ❌",
  yellow: "CI ⏳",
  green: "CI ✅",
  none: "CI —",
};

const CI_RANK: Record<CiState, number> = {
  red: 0,
  yellow: 1,
  green: 2,
  none: 3,
};

async function ghIssues(args: string[]): Promise<GhIssue[]> {
  try {
    const { stdout } = await execa(
      "gh",
      [
        "issue",
        "list",
        ...args,
        "--json",
        "number,title,labels,milestone,assignees,updatedAt,body",
      ],
      { cwd: REPO_ROOT },
    );
    return JSON.parse(stdout) as GhIssue[];
  } catch (e) {
    note(`gh issue list ${args.join(" ")}`, e);
    return [];
  }
}

/** `gh issue list` has no `--no-assignee` flag in all versions — post-filter. */
async function ghUnassignedIssues(args: string[]): Promise<GhIssue[]> {
  const all = await ghIssues(args);
  return all.filter((i) => !i.assignees || i.assignees.length === 0);
}

/**
 * Raw count of ALL open issues — independent of the agent-ready/working/awaiting
 * labels (#306). This is the un-maskable backlog signal: an empty triage bucket
 * must never present as an empty board. Returns `null` on failure so the caller
 * can print "(unknown)" rather than a misleading "0".
 */
async function ghOpenIssueCount(): Promise<number | null> {
  try {
    const { stdout } = await execa(
      "gh",
      [
        "issue",
        "list",
        "--state",
        "open",
        "--limit",
        "200",
        "--json",
        "number",
      ],
      { cwd: REPO_ROOT },
    );
    return (JSON.parse(stdout) as Array<{ number: number }>).length;
  } catch (e) {
    note("gh issue list --state open", e);
    return null;
  }
}

async function meLogin(): Promise<string> {
  try {
    const { stdout } = await execa("gh", ["api", "user", "--jq", ".login"], {
      cwd: REPO_ROOT,
    });
    return stdout.trim();
  } catch (e) {
    note("gh api user", e);
    return "";
  }
}

async function ghPRs(): Promise<GhPRGroups> {
  try {
    const [{ stdout }, me] = await Promise.all([
      execa(
        "gh",
        [
          "pr",
          "list",
          "--state",
          "open",
          "--limit",
          "50",
          "--json",
          "number,title,reviewDecision,updatedAt,headRefName,author,statusCheckRollup",
        ],
        { cwd: REPO_ROOT },
      ),
      meLogin(),
    ]);
    const all = JSON.parse(stdout) as GhPR[];
    const mine: GhPR[] = [];
    const others: GhPR[] = [];
    for (const p of all) {
      if (me && p.author?.login === me) mine.push(p);
      else others.push(p);
    }
    others.sort((a, b) => CI_RANK[ciState(a)] - CI_RANK[ciState(b)]);
    return { mine, others };
  } catch (e) {
    note("gh pr list", e);
    return { mine: [], others: [] };
  }
}

interface SpecMeta {
  status: string;
  adrs: string[];
  terms: string[];
  path: string;
}

// The spec folder is the slug of the `feature:NNN-<slug>` label (AGENTS.md §2 —
// the milestone is a product theme, not a spec folder). Product specs may use
// the bilingual `NNN-requirements-en.md` split, so accept either filename.
async function readSpecMeta(featureSlug: string): Promise<SpecMeta | null> {
  const specDir = resolve(
    REPO_ROOT,
    "apps/docs/content/specs/features",
    featureSlug,
  );
  const numMatch = featureSlug.match(/^(\d{3})-/);
  if (!numMatch) return null;
  try {
    const nnn = numMatch[1];
    let raw: string;
    try {
      raw = await readFile(resolve(specDir, `${nnn}-requirements.md`), "utf-8");
    } catch {
      raw = await readFile(
        resolve(specDir, `${nnn}-requirements-en.md`),
        "utf-8",
      );
    }
    const parsed = matter(raw);
    const content = parsed.content;
    const data = parsed.data as Record<string, unknown>;
    const adrs = Array.from(new Set(content.match(/ADR-\d{4}/g) ?? []));
    const terms = Array.from(
      new Set(
        (content.match(/\[\[([a-z][a-z0-9_-]*)\]\]/g) ?? []).map((m) =>
          m.slice(2, -2),
        ),
      ),
    );
    const status =
      typeof data["status"] === "string"
        ? (data["status"] as string)
        : "unknown";
    return { status, adrs, terms, path: specDir };
  } catch {
    // Spec folder does not exist yet (Issue may predate spec creation).
    return null;
  }
}

// `openCount` is the raw `gh issue list --state open` total — deliberately
// independent of the working/awaiting/ready triage buckets (#306). An empty
// ready bucket (label-driven) must NEVER read as an empty backlog: when the
// buckets are all empty but open issues exist, the recommendation is to triage
// the board by readiness, not "clean slate / nothing to do".
export function recommend(
  activeWorking: GhIssue[],
  awaitingReview: GhIssue[],
  prs: GhPRGroups,
  readyQueue: GhIssue[],
  openCount: number,
): string {
  if (prs.others.length > 0) {
    return `${prs.others.length} non-author PR(s) open (Dependabot et al.) — triage before product work.`;
  }
  if (awaitingReview.length > 0) {
    return `Address review on Issue #${awaitingReview[0]!.number}.`;
  }
  if (prs.mine.some((pr) => pr.reviewDecision === "CHANGES_REQUESTED")) {
    return `You have a PR with CHANGES_REQUESTED — address feedback first.`;
  }
  if (activeWorking.length > 0) {
    return `Resume #${activeWorking[0]!.number} (most recently updated).`;
  }
  if (readyQueue.length > 0) {
    return `No active work. Pick from ready queue: ${readyQueue
      .slice(0, 3)
      .map((i) => `#${i.number}`)
      .join(", ")}.`;
  }
  if (openCount > 0) {
    // Buckets empty (none labelled agent-ready / agent-working / awaiting-review)
    // but the board is NOT empty — the `ready` queue is a label-driven view, not
    // ground truth (AGENTS.md §3.5). Direct the agent to TRIAGE by resolving the
    // dependency graph (`pnpm backlog:triage`, #497), never "done".
    return `${openCount} open issue(s) but none in ready/working/awaiting buckets — run \`pnpm backlog:triage\` to TRIAGE the open board by readiness resolved from the native blocked_by graph (NOT labels). The ready queue is label-driven, not ground truth; an empty bucket set is NOT an empty backlog.`;
  }
  return `Clean slate. Open a new feature-spec via superpowers:brainstorming.`;
}

// ── concurrency detector (#359) ─────────────────────────────────────────────
// The user runs PARALLEL Claude sessions in one repo. A session editing the
// SHARED main tree while another is live sweeps uncommitted edits into the wrong
// PR (happened on #345/#355 — now AGENTS.md §6). These pure seams let the
// detector be unit-tested without firing `main()`'s subprocesses.

/** One Claude session log: its session id, mtime, and which tree it runs in. */
export interface SessionLog {
  id: string;
  mtimeMs: number;
  inSharedMainTree: boolean;
  /** Absolute path to the `.jsonl` log — lets the PreToolUse guard re-check
   * liveness later (a stale flag must never warn). Optional: older callers /
   * tests omit it. */
  logPath?: string;
}

export interface LiveSessionOpts {
  nowMs: number;
  windowMs: number;
  /** Current session id to exclude; "" excludes nothing (over-count is safe). */
  selfId: string;
}

/**
 * Count live parallel sessions: logs touched within `windowMs` of `nowMs`,
 * excluding the current session. A future mtime (clock skew) is "live", never
 * negative. Returns the total plus the shared-main-tree subset (the ones that
 * can actually collide with a main-tree edit).
 */
export function liveParallelSessions(
  logs: SessionLog[],
  opts: LiveSessionOpts,
): { total: number; inMainTree: number; live: SessionLog[] } {
  const live = logs.filter(
    (l) => l.id !== opts.selfId && opts.nowMs - l.mtimeMs <= opts.windowMs,
  );
  return {
    total: live.length,
    inMainTree: live.filter((l) => l.inSharedMainTree).length,
    live,
  };
}

// ── parallel-sessions flag + directive (#823) ───────────────────────────────
// When live parallel sessions exist AND this session is in the SHARED main
// tree, the bootstrap (1) prints an imperative first-action directive (not an
// advisory ⚠) and (2) drops a machine-readable flag file that the PreToolUse
// hook `tools/hooks/main-tree-read-guard.mjs` consults to WARN on main-tree
// source reads until the session enters a worktree. When no parallel sessions
// exist, the flag is removed so the guard stays silent.

/** MUST match `FLAG_REL` in `tools/hooks/main-tree-read-guard.mjs` (asserted
 * equal by the guard-tests spec). Gitignored — session-local state, not repo. */
export const PARALLEL_FLAG_REL = ".claude/parallel-sessions.flag.json";

export interface ParallelSessionsFlag {
  generatedAt: string; // ISO timestamp of the bootstrap that wrote the flag
  liveSessions: number;
  liveInMainTree: number;
  sessions: Array<{ id: string; logPath: string; inSharedMainTree: boolean }>;
}

export function buildParallelFlag(
  live: SessionLog[],
  generatedAt: string,
): ParallelSessionsFlag {
  return {
    generatedAt,
    liveSessions: live.length,
    liveInMainTree: live.filter((l) => l.inSharedMainTree).length,
    sessions: live.map((l) => ({
      id: l.id,
      logPath: l.logPath ?? "",
      inSharedMainTree: l.inSharedMainTree,
    })),
  };
}

/** Imperative first-action directive — replaces the former advisory ⚠ (#823). */
export function mainTreeIsolationDirective(liveSessions: number): string {
  return (
    `> 🛑 **FIRST ACTION — ISOLATE BEFORE ANY REPO-FILE READ.** ${liveSessions} other live ` +
    `session(s) share this repo and you are in the SHARED main tree. Run ` +
    "`pnpm task:worktree <N>` → `EnterWorktree path:.claude/worktrees/<N>` NOW — " +
    `before any repo-file Read/Grep/Glob, analysis reads included (#418): a parallel ` +
    `session can advance origin/main or switch HEAD under you and sweep uncommitted ` +
    `edits into the wrong PR (AGENTS.md §6). A PreToolUse guard warns on every ` +
    `main-tree source read until this session enters a worktree.`
  );
}

/**
 * True when the CWD is the PRIMARY working tree, not a linked worktree. In the
 * primary tree `git rev-parse --git-dir` and `--git-common-dir` resolve to the
 * same `.git`; in a linked worktree the git-dir is `.git/worktrees/<name>`.
 * Both inputs are resolved against `cwd` so a relative `.git` compares equal.
 */
export function isSharedMainTree(
  gitDir: string,
  gitCommonDir: string,
  cwd: string,
): boolean {
  const norm = (p: string) =>
    resolve(cwd, p).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return norm(gitDir) === norm(gitCommonDir);
}

/**
 * Encode an absolute path the way Claude Code names its project log directory
 * under `~/.claude/projects/` — every non-alphanumeric run is a single dash...
 * (`C:\Users\…\ds-platform` → `C--Users-…-ds-platform`). Used to locate the
 * repo's session logs — the primary tree's slug, plus each linked worktree's
 * `…--claude-worktrees-<name>` sibling (see `isRepoSessionDir`).
 */
export function encodeProjectSlug(absPath: string): string {
  return absPath.replace(/[^a-zA-Z0-9]/g, "-");
}

/**
 * Is `dirName` a session-log dir for THIS repo? The primary tree is `mainSlug`
 * exactly; a linked worktree is `mainSlug` + a `--claude-worktrees-<name>`
 * suffix. A bare `startsWith(mainSlug)` would also match a SIBLING repo whose
 * slug merely starts the same way (`…-ds-platform` vs `…-ds-platform-2`), so the
 * suffix must be the worktree separator, never an arbitrary continuation.
 */
export function isRepoSessionDir(dirName: string, mainSlug: string): boolean {
  return (
    dirName === mainSlug || dirName.startsWith(`${mainSlug}--claude-worktrees-`)
  );
}

interface Concurrency {
  inSharedMainTree: boolean;
  liveSessions: number;
  liveInMainTree: number;
  liveList: SessionLog[];
  worktrees: string[];
}

const SESSION_WINDOW_MS = 10 * 60 * 1000; // 10 min — validated on the #345 session.

async function concurrency(): Promise<Concurrency> {
  let inSharedMainTree = true;
  let mainRoot = REPO_ROOT;
  try {
    const [gd, gcd] = await Promise.all([
      execa("git", ["rev-parse", "--git-dir"], { cwd: REPO_ROOT }),
      execa("git", ["rev-parse", "--git-common-dir"], { cwd: REPO_ROOT }),
    ]);
    inSharedMainTree = isSharedMainTree(
      gd.stdout.trim(),
      gcd.stdout.trim(),
      REPO_ROOT,
    );
    // The primary tree's root = parent of the common `.git` dir.
    mainRoot = dirname(resolve(REPO_ROOT, gcd.stdout.trim()));
  } catch (e) {
    note("git rev-parse (concurrency)", e);
  }

  let worktrees: string[] = [];
  try {
    const { stdout } = await execa("git", ["worktree", "list"], {
      cwd: REPO_ROOT,
    });
    worktrees = stdout.split("\n").filter(Boolean);
  } catch (e) {
    note("git worktree list", e);
  }

  let liveSessions = 0;
  let liveInMainTree = 0;
  let liveList: SessionLog[] = [];
  try {
    const { readdir, stat } = await import("node:fs/promises");
    const { homedir } = await import("node:os");
    const projectsDir = resolve(homedir(), ".claude", "projects");
    const mainSlug = encodeProjectSlug(mainRoot);
    const selfId = process.env["CLAUDE_CODE_SESSION_ID"] ?? "";
    const nowMs = Date.now();

    const dirs = (await readdir(projectsDir, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && isRepoSessionDir(d.name, mainSlug))
      .map((d) => d.name);

    const logs: SessionLog[] = [];
    for (const dir of dirs) {
      // The bare main slug = the primary tree; a `…-claude-worktrees-…` suffix
      // = a linked worktree session.
      const inMain = dir === mainSlug;
      const full = resolve(projectsDir, dir);
      let entries: string[] = [];
      try {
        entries = (await readdir(full)).filter((f) => f.endsWith(".jsonl"));
      } catch {
        continue;
      }
      for (const f of entries) {
        try {
          const logPath = resolve(full, f);
          const s = await stat(logPath);
          logs.push({
            id: f.replace(/\.jsonl$/, ""),
            mtimeMs: s.mtimeMs,
            inSharedMainTree: inMain,
            logPath,
          });
        } catch {
          // Log vanished mid-scan — ignore.
        }
      }
    }

    const counts = liveParallelSessions(logs, {
      nowMs,
      windowMs: SESSION_WINDOW_MS,
      selfId,
    });
    liveSessions = counts.total;
    liveInMainTree = counts.inMainTree;
    liveList = counts.live;
  } catch (e) {
    note("session-log scan", e);
  }

  return {
    inSharedMainTree,
    liveSessions,
    liveInMainTree,
    liveList,
    worktrees,
  };
}

/**
 * Maintain the machine-readable parallel-sessions flag (#823). Only a
 * main-tree bootstrap manages it: write when live parallel sessions exist,
 * remove when none do (so the PreToolUse guard goes silent). A worktree
 * bootstrap never touches it — its REPO_ROOT is the worktree, not the main
 * tree, and the flag belongs to the main tree.
 */
async function syncParallelFlag(conc: Concurrency): Promise<void> {
  if (!conc.inSharedMainTree) return;
  const flagPath = resolve(REPO_ROOT, PARALLEL_FLAG_REL);
  try {
    if (conc.liveSessions > 0) {
      const flag = buildParallelFlag(conc.liveList, new Date().toISOString());
      await writeFile(flagPath, JSON.stringify(flag, null, 2) + "\n", "utf-8");
    } else {
      await rm(flagPath, { force: true });
    }
  } catch (e) {
    note("parallel-sessions flag", e);
  }
}

/**
 * Parallel-session claim signals (#811) for the ready-queue rollup — the SAME
 * check `pnpm backlog:triage` runs (single implementation: `probeClaim` is
 * imported from `tools/backlog-triage.ts`, never duplicated). Returns
 * issue-number → `IN-FLIGHT-ELSEWHERE (worktree|start-comment, age <a>)`.
 * Never throws — a probe failure degrades to "no signal" with a warning.
 */
async function claimSignals(ready: GhIssue[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (ready.length === 0) return map;
  const mainRoot = await primaryWorktreePath(REPO_ROOT);
  const nowMs = Date.now();
  for (const i of ready) {
    try {
      const claim = await probeClaim(i.number, mainRoot, REPO_ROOT, nowMs);
      if (claim) map.set(i.number, claimLabel(claim));
    } catch (e) {
      note(`claim probe #${i.number}`, e);
    }
  }
  return map;
}

function ts(): string {
  // YYYY-MM-DD HH:mm UTC — stable, sortable.
  return new Date().toISOString().slice(0, 16).replace("T", " ");
}

async function main(): Promise<void> {
  const [git, working, awaiting, ready, prs, openCount, conc, syncProbe] =
    await Promise.all([
      gitState(),
      ghIssues(["--assignee", "@me", "--label", "agent-working"]),
      ghIssues(["--assignee", "@me", "--label", "awaiting-review"]),
      ghUnassignedIssues(["--label", "agent-ready", "--limit", "20"]).then(
        (rs) => rs.slice(0, 5),
      ),
      ghPRs(),
      ghOpenIssueCount(),
      concurrency(),
      probeMainSync(REPO_ROOT),
    ]);
  const sync = evaluateMainSync(syncProbe);
  await syncParallelFlag(conc);
  // Parallel-session claim signal (#811) — same check as `pnpm backlog:triage`.
  const claims = await claimSignals(ready);
  const readyFree = ready.filter((i) => !claims.has(i.number));

  const activeSpecs = await Promise.all(
    working.map(async (i) => {
      const slug = (i.labels ?? [])
        .map((l) => l.name.match(/^feature:(\d{3}-[\w-]+)$/)?.[1])
        .find(Boolean);
      if (!slug) return { issue: i, spec: null as SpecMeta | null };
      return { issue: i, spec: await readSpecMeta(slug) };
    }),
  );

  const out: string[] = [];
  out.push(`# Agent bootstrap — ${ts()} UTC`);
  out.push("");

  // Freshness banner (#630): loud header warning when the LOCAL `main` ref is
  // behind `origin/main` — running tools (triage, this bootstrap) against stale
  // main code / a stale graph is the #624/#418 miss. A fetch failure (offline)
  // degrades to the softer stale banner and never blocks.
  const syncMsg = mainSyncMessage(sync);
  if (sync.kind === "behind") {
    const fix = mainSyncFixCommand(await primaryWorktreePath(REPO_ROOT));
    out.push(
      `> 🛑 **STALE MAIN — ${syncMsg}.** Your local \`main\` is behind \`origin/main\`, so readiness and tooling computed now may be stale (#630/#418). Run this exact command, then re-run bootstrap/triage before trusting readiness:\n> \`${fix}\``,
    );
    out.push("");
  } else if (syncMsg) {
    out.push(`> ${syncMsg}`);
    out.push("");
  }

  out.push("## Git");
  const aheadStr =
    git.aheadOfMain === "?"
      ? "(origin/main unknown)"
      : git.aheadOfMain === "0"
        ? "in sync with origin/main"
        : `${git.aheadOfMain} ahead of origin/main`;
  out.push(
    `- Branch: \`${git.branch}\` ${git.clean ? "(clean)" : "(DIRTY)"} — ${aheadStr}`,
  );
  if (git.recent.length > 0) {
    out.push("- Recent commits:");
    for (const c of git.recent) out.push(`  - ${c}`);
  } else {
    out.push("- Recent commits: (none)");
  }
  out.push("");

  out.push("## Concurrency");
  out.push(
    `- Working tree: ${conc.inSharedMainTree ? "SHARED main tree" : "isolated worktree"}`,
  );
  out.push(
    `- Live parallel sessions (excl. self): ${conc.liveSessions}${
      conc.liveSessions > 0
        ? ` (${conc.liveInMainTree} in the shared main tree)`
        : ""
    }`,
  );
  if (conc.worktrees.length > 1) {
    out.push(`- Worktrees (${conc.worktrees.length}):`);
    for (const w of conc.worktrees) out.push(`  - ${w}`);
  }
  if (conc.inSharedMainTree && conc.liveSessions > 0) {
    out.push("");
    out.push(mainTreeIsolationDirective(conc.liveSessions));
  }
  out.push("");

  out.push("## Issues (working / awaiting / ready)");
  // Raw open-issue total — independent of the triage buckets below (#306). An
  // empty bucket set is NOT an empty backlog; this line is the un-maskable signal.
  out.push(
    `- Open issues: ${openCount ?? "(unknown)"} (\`gh issue list --state open\`)`,
  );
  // Readiness is COMPUTED from the dependency graph, never a label (#497,
  // AGENTS.md §3.5). The bucket lines below are the label-driven view; the
  // authoritative blocked-vs-takeable split comes from `pnpm backlog:triage`.
  out.push(
    "- Readiness (blocked vs takeable) resolved from the native blocked_by graph, NOT labels: `pnpm backlog:triage`",
  );
  if (working.length === 0 && awaiting.length === 0 && ready.length === 0) {
    out.push(
      openCount && openCount > 0
        ? "(no triage buckets populated — see open-issue total above; TRIAGE the board by readiness)"
        : "(none)",
    );
  } else {
    for (const i of working) {
      out.push(
        `- working  #${i.number} ${i.title} — milestone: ${i.milestone?.title ?? "(none)"}`,
      );
    }
    for (const i of awaiting) {
      out.push(`- awaiting #${i.number} ${i.title} — review-response needed`);
    }
    for (const i of ready) {
      // A claimed ready item is IN-FLIGHT-ELSEWHERE (#811), not takeable — the
      // age is surfaced (an abandoned claim is the human's call).
      const claim = claims.get(i.number);
      out.push(
        `- ready    #${i.number} ${i.title} — milestone: ${i.milestone?.title ?? "(none)"}${
          claim ? ` — ⚠ ${claim}` : ""
        }`,
      );
    }
  }
  out.push("");

  out.push("## PRs");
  if (prs.mine.length === 0 && prs.others.length === 0) {
    out.push("(none)");
  } else {
    out.push(`### Yours (${prs.mine.length})`);
    if (prs.mine.length === 0) {
      out.push("(none)");
    } else {
      for (const p of prs.mine) {
        out.push(
          `- #${p.number} ${p.title} — ${p.reviewDecision ?? "pending"} · ${CI_BADGE[ciState(p)]}`,
        );
      }
    }
    out.push("");
    out.push(`### Others (${prs.others.length})`);
    if (prs.others.length === 0) {
      out.push("(none)");
    } else {
      for (const p of prs.others) {
        const who = p.author?.login ?? "?";
        out.push(
          `- #${p.number} [@${who}] ${p.title} — ${CI_BADGE[ciState(p)]}`,
        );
      }
    }
  }
  out.push("");

  out.push("## Active specs");
  const withSpec = activeSpecs.filter((x) => x.spec !== null);
  if (withSpec.length === 0) {
    out.push(
      "(no active spec — start a new one via superpowers:brainstorming)",
    );
  } else {
    for (const { issue, spec } of withSpec) {
      if (!spec) continue;
      const rel = spec.path
        .replace(REPO_ROOT + "\\", "")
        .replace(REPO_ROOT + "/", "");
      out.push(`- #${issue.number} → ${rel}`);
      out.push(`  - status: ${spec.status}`);
      out.push(`  - ADRs: ${spec.adrs.join(", ") || "(none cited)"}`);
      out.push(`  - glossary: ${spec.terms.join(", ") || "(none)"}`);
    }
  }
  out.push("");

  out.push("## Recommendation");
  // The pick list excludes IN-FLIGHT-ELSEWHERE items (#811) — a claimed Issue
  // must never be recommended as free (the #770 miss).
  out.push(recommend(working, awaiting, prs, readyFree, openCount ?? 0));
  out.push("");

  if (warnings.length > 0) {
    out.push("## Warnings");
    for (const w of warnings) {
      out.push(`- ${w.source}: ${w.message}`);
    }
    out.push("");
  }

  process.stdout.write(out.join("\n"));
}

// Run only as the entry point (`tsx tools/agent-bootstrap.ts`). Guarding this
// keeps the pure helpers (e.g. `recommend`) importable from a unit test without
// firing the side-effecting `main()` / its `gh` + `git` subprocess calls.
const INVOKED_PATH = process.argv[1] ? resolve(process.argv[1]) : "";
const IS_ENTRY = INVOKED_PATH === fileURLToPath(import.meta.url);

if (IS_ENTRY) {
  main().catch((e) => {
    // Last-resort guard: must never crash the SessionStart hook.
    process.stderr.write(`[agent-bootstrap] unexpected error: ${String(e)}\n`);
    process.exit(0);
  });
}
