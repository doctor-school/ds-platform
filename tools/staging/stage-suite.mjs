/**
 * tools/staging/stage-suite.mjs — the `stage-suite` verdict of `main` (#3269).
 *
 * `.github/workflows/stage.yml` posts the commit status `stage-suite` on `main`
 * SHAs (pending while the converge + suite run, then success / failure / error).
 * Nothing read it outside the release pre-flight, so on 2026-10-22 `main` stayed
 * red for 10 consecutive commits (~5 h) unnoticed. This module is the one reader
 * both surfaces share:
 *
 *   - `pnpm bootstrap` (`tools/agent-bootstrap.ts`) prints the newest main
 *     commit's state + the newest green SHA, and a `## Warnings` row when main
 *     is red or the newest commit has no verdict > 1 h after its commit time;
 *   - `pnpm pr:land` (`tools/gh/pr-land.mjs`) prints a WARNING (never a refusal,
 *     never an exit code) naming the first red commit of the current red streak.
 *
 * The walk goes newest-first over at most `limit` main commits and stops at the
 * first `success`. A commit with no status (`stage.yml` queues one run at a
 * time, so a newer push can replace a queued older one) or a `pending` one is
 * not a verdict: the red streak is the run of red verdicts from the newest
 * verdict back to the newest green, skipping commits without one.
 *
 * Never throws: a failed fetch is carried as `error` and rendered as a warning.
 */
import { execFile } from "node:child_process";

const DEFAULT_LIMIT = 20;
const STALE_MS = 3600_000;
const RED = new Set(["failure", "error"]);
const GH_MAX_BUFFER = 16 * 1024 * 1024;

/** @typedef {{ sha: string, subject: string, date: string }} MainCommit */
/** @typedef {MainCommit & { state: string | null }} WalkedCommit */
/**
 * @typedef {{
 *   newest: WalkedCommit | null,
 *   newestGreen: WalkedCommit | null,
 *   redStreak: { first: WalkedCommit, count: number, truncated: boolean } | null,
 *   walked: number,
 *   limit: number,
 *   now: number,
 *   error: string | null,
 * }} StageSuiteSummary
 */

function firstLine(err) {
  return (err instanceof Error ? err.message : String(err)).split("\n")[0];
}

function gh(args) {
  return new Promise((resolve, reject) => {
    execFile(
      "gh",
      args,
      { maxBuffer: GH_MAX_BUFFER, windowsHide: true },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

/** Newest-first `main` commits (squash merges: committer date = merge time). */
export async function ghListMainCommits(limit = DEFAULT_LIMIT) {
  const out = await gh([
    "api",
    `repos/{owner}/{repo}/commits?sha=main&per_page=${limit}`,
  ]);
  return JSON.parse(out).map((c) => ({
    sha: c.sha,
    subject: String(c.commit?.message ?? "").split("\n")[0],
    date: c.commit?.committer?.date ?? c.commit?.author?.date ?? "",
  }));
}

/** The newest `stage-suite` status state on a SHA, or null when none is posted. */
export async function ghReadStageSuiteState(sha) {
  const out = await gh([
    "api",
    `repos/{owner}/{repo}/commits/${sha}/statuses?per_page=100`,
  ]);
  // The statuses list is newest-first; the first `stage-suite` entry is current.
  const hit = JSON.parse(out).find((s) => s.context === "stage-suite");
  return hit ? hit.state : null;
}

/**
 * Walk main newest-first until the first green (bounded by `limit`).
 * @param {{
 *   listCommits?: (limit: number) => Promise<MainCommit[]>,
 *   readState?: (sha: string) => Promise<string | null>,
 *   now?: number,
 *   limit?: number,
 * }} [io]
 * @returns {Promise<StageSuiteSummary>}
 */
export async function probeStageSuite(io = {}) {
  const listCommits = io.listCommits ?? ghListMainCommits;
  const readState = io.readState ?? ghReadStageSuiteState;
  const now = io.now ?? Date.now();
  const limit = io.limit ?? DEFAULT_LIMIT;
  /** @type {StageSuiteSummary} */
  const summary = {
    newest: null,
    newestGreen: null,
    redStreak: null,
    walked: 0,
    limit,
    now,
    error: null,
  };
  try {
    const list = (await listCommits(limit)).slice(0, limit);
    const reds = [];
    for (const c of list) {
      const walked = { ...c, state: await readState(c.sha) };
      summary.walked++;
      if (!summary.newest) summary.newest = walked;
      if (walked.state === "success") {
        summary.newestGreen = walked;
        break;
      }
      if (RED.has(walked.state ?? "")) reds.push(walked);
    }
    if (reds.length > 0)
      summary.redStreak = {
        first: reds[reds.length - 1],
        count: reds.length,
        truncated: summary.newestGreen === null,
      };
  } catch (e) {
    summary.error = firstLine(e);
  }
  return summary;
}

const short = (sha) => sha.slice(0, 8);

function age(iso, now) {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return "age unknown";
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

function redSince(s) {
  const { first, count, truncated } = s.redStreak;
  const green = s.newestGreen
    ? `newest green ${short(s.newestGreen.sha)}`
    : `no green in the last ${s.limit} main commits`;
  return (
    `RED since ${short(first.sha)} "${first.subject}" (${age(first.date, s.now)}, ` +
    `${truncated ? "≥" : ""}${count} red commit${count === 1 ? "" : "s"}) — ${green}`
  );
}

/** `## Stage suite (main)` section body. @param {StageSuiteSummary} s */
export function renderStageSuiteSection(s) {
  if (s.error || !s.newest) return ["(unknown — see Warnings)"];
  return [
    `- newest main ${short(s.newest.sha)} (${age(s.newest.date, s.now)}): ${s.newest.state ?? "not posted"}`,
    s.newestGreen
      ? `- newest green: ${short(s.newestGreen.sha)} (${age(s.newestGreen.date, s.now)})`
      : `- newest green: none in the last ${s.walked} main commits`,
  ];
}

/** Bootstrap `## Warnings` rows. @param {StageSuiteSummary} s */
export function stageSuiteWarnings(s) {
  const source = "stage-suite on main";
  if (s.error) return [{ source, message: `fetch failed — ${s.error}` }];
  if (!s.newest)
    return [{ source, message: "fetch failed — no main commits returned" }];
  const rows = [];
  if (s.redStreak)
    rows.push({ source, message: `${redSince(s)} — see stage.yml runs` });
  const { state, date, sha } = s.newest;
  if (
    state !== "success" &&
    !RED.has(state ?? "") &&
    s.now - Date.parse(date) > STALE_MS
  )
    rows.push({
      source,
      message: `newest main ${short(sha)} has ${state ?? "no status (not posted)"} ${age(date, s.now).replace(" ago", "")} after its commit — check stage.yml`,
    });
  return rows;
}

/** One `pr:land` WARNING line, or null when main is not red. @param {StageSuiteSummary} s */
export function stageSuiteLandWarning(s) {
  if (s.error)
    return `WARNING: main's stage-suite could not be read (${s.error}) — check stage.yml runs before merging.`;
  if (!s.redStreak) return null;
  return `WARNING: main's newest stage-suite is ${redSince(s)}. Merging lands on a red main (not a refusal).`;
}
