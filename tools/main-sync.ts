/**
 * tools/main-sync.ts — shared "is local `main` behind `origin/main`?" seam for
 * the backlog-triage + agent-bootstrap tools (#630).
 *
 * Driver: session `e020ce26` ran `pnpm backlog:triage` in a tree whose local
 * `main` was BEHIND `origin/main` — the just-merged #624 (EARS-prose resolution)
 * was not in the local tool code, so takeability was classified against stale
 * logic and open items were reported blocked by an already-closed EARS handler.
 * This is the #418 stale-main-read pattern applied to triage tooling. The remedy
 * is deterministic (a command, not more prose): fetch `origin/main` first, then
 * compare the LOCAL `main` ref against it —
 *
 *   - `backlog-triage` REFUSES (non-zero exit) when behind, so readiness is never
 *     computed from stale tool code / a stale dependency graph;
 *   - `agent-bootstrap` prints a LOUD header warning when behind;
 *   - a fetch failure (offline) degrades to an explicit "results may be stale"
 *     banner and PROCEEDS — it never crashes and never hard-refuses.
 *
 * The behind-check compares the LOCAL `main` ref (`main..origin/main`), NOT
 * `HEAD`, so it does not misfire when the current checkout is a feature branch,
 * a detached HEAD, or a linked worktree (`main` is a shared ref in all of them).
 *
 * The pure classifier (`evaluateMainSync`) + message/gate formatters are
 * exported and unit-tested (tools/lint/guard-tests/main-sync.spec.ts) WITHOUT
 * firing the `git` subprocesses — `probeMainSync` is the I/O seam.
 */
import { execa } from "execa";

/** The raw evidence gathered by `probeMainSync`, fed to the pure classifier. */
export interface MainSyncProbe {
  /** Did `git fetch origin main` succeed? `false` on offline / network error. */
  fetchOk: boolean;
  /** First line of the fetch error, when it failed. */
  fetchError?: string;
  /**
   * Commits in `origin/main` NOT in the local `main` ref (`main..origin/main`).
   * `null` when uncomputable (no local `main`, no fetched `origin/main`, …).
   */
  behindCount: number | null;
  /** First line of the rev-list error, when the count was uncomputable. */
  behindError?: string;
}

export type MainSyncStatus =
  | { kind: "in-sync" }
  | { kind: "behind"; behindCount: number }
  | { kind: "fetch-failed"; message: string }
  | { kind: "unknown"; message: string };

/** The explicit offline / staleness banner (AGENTS.md §3.5 — stale ≠ crash). */
export const STALE_BANNER =
  "⚠ could not fetch origin/main — results may be stale";

/**
 * Classify a probe into a sync status. Precedence:
 *   1. fetch failed → `fetch-failed` (banner + proceed), even if a STALE
 *      `origin/main` would otherwise compute a behind-count — we could not
 *      confirm freshness, so we warn rather than hard-refuse.
 *   2. behind-count uncomputable → `unknown` (banner + proceed).
 *   3. behind-count > 0 → `behind` (refuse in triage / loud warn in bootstrap).
 *   4. otherwise → `in-sync`.
 */
export function evaluateMainSync(probe: MainSyncProbe): MainSyncStatus {
  if (!probe.fetchOk) {
    return {
      kind: "fetch-failed",
      message: probe.fetchError ?? "git fetch origin main failed",
    };
  }
  if (probe.behindCount == null) {
    return {
      kind: "unknown",
      message:
        probe.behindError ?? "could not compare local main to origin/main",
    };
  }
  if (probe.behindCount > 0) {
    return { kind: "behind", behindCount: probe.behindCount };
  }
  return { kind: "in-sync" };
}

/**
 * A human-readable line for a status, or `null` when in-sync (nothing to say).
 * `behind` → the WARN copy; `fetch-failed` / `unknown` → the stale banner.
 */
export function mainSyncMessage(status: MainSyncStatus): string | null {
  switch (status.kind) {
    case "in-sync":
      return null;
    case "behind":
      return `local \`main\` is ${status.behindCount} commit(s) BEHIND \`origin/main\``;
    case "fetch-failed":
      return `${STALE_BANNER} (${status.message})`;
    case "unknown":
      return `${STALE_BANNER} (${status.message})`;
  }
}

/** Triage refuses to compute readiness ONLY when local `main` is behind. */
export function shouldRefuseTriage(status: MainSyncStatus): boolean {
  return status.kind === "behind";
}

/**
 * Fetch `origin/main` and measure how far the LOCAL `main` ref is behind it.
 * Never throws: a fetch failure or an uncomputable count is captured in the
 * returned probe, so callers degrade to a banner instead of crashing.
 */
export async function probeMainSync(cwd: string): Promise<MainSyncProbe> {
  let fetchOk = true;
  let fetchError: string | undefined;
  try {
    // Plain `git fetch origin main` opportunistically updates the tracking ref
    // `refs/remotes/origin/main` (default fetch refspec). A short timeout keeps
    // an offline SessionStart hook from hanging.
    await execa("git", ["fetch", "origin", "main"], { cwd, timeout: 20000 });
  } catch (e) {
    fetchOk = false;
    fetchError = e instanceof Error ? e.message.split("\n")[0] : String(e);
  }

  let behindCount: number | null = null;
  let behindError: string | undefined;
  try {
    // `main..origin/main` = commits on origin/main missing from LOCAL main.
    // Using the `main` ref (not HEAD) means a feature-branch / detached /
    // worktree checkout never misfires this behind-check.
    const { stdout } = await execa(
      "git",
      ["rev-list", "--count", "main..origin/main"],
      { cwd },
    );
    const n = Number.parseInt(stdout.trim(), 10);
    behindCount = Number.isNaN(n) ? null : n;
  } catch (e) {
    behindError = e instanceof Error ? e.message.split("\n")[0] : String(e);
  }

  return { fetchOk, fetchError, behindCount, behindError };
}
