#!/usr/bin/env node
/**
 * tools/gh/sync-pr-track.mjs — put the `track:*` product-axis label on a PR by
 * DERIVING it from the Issue(s) the PR body closes (#1600).
 *
 * Why derived and not hand-set: the track axis is enforced at Issue creation
 * (`create-issue.mjs`, #1583) and the Issue is its single source of truth. A PR
 * label typed by hand at `gh pr create` time is a second copy of that fact — and
 * a second copy drifts silently (a PR labeled `track:academy` closing a
 * `track:doctor` Issue reads as honest on the board and is not). So the author
 * types nothing; this helper reads `Closes #N`, reads the Issue's track, and
 * applies it. A hand-set label that CONTRADICTS the Issue is not silently
 * overwritten either — it exits non-zero and names both sides, because one of
 * the two is wrong and only a human knows which.
 *
 * Board consequence this closes: a track slice over the board dropped every PR
 * row (of the last 40 PRs before this landed, 2 carried a track label, both by
 * accident) — i.e. it hid exactly the work in flight.
 *
 * Canon: AGENTS.md §2 (Issue/PR conventions), `.claude/rules/repo-conventions.md`
 * → Commits, versioning, PRs. Sibling: create-issue.mjs (the Issue-side gate).
 * The auto-close keyword shape is the one already in
 * `tools/lint/spec-link-lint.ts` — kept identical so PR→Issue linkage means the
 * same thing in both places.
 *
 * Usage (CI: .github/workflows/pr-track-sync.yml; locally for a dry read):
 *   PR_NUMBER=1600 PR_BODY="$(gh pr view 1600 --json body -q .body)" \
 *     node tools/gh/sync-pr-track.mjs
 *   node tools/gh/sync-pr-track.mjs --dry-run   # decide + report, never mutate
 *
 * `PR_BODY` is read from the event payload in CI on purpose: a fresh `gh pr view`
 * right after PR creation has returned a stale/absent body (#651), while the
 * payload is always current for its triggering event. Absent `PR_BODY` falls back
 * to a `gh pr view` read.
 *
 * Exit codes: 0 = applied / already correct / nothing to derive;
 *             1 = usage or `gh` failure;
 *             2 = CONFLICT — the PR and its Issue(s) disagree on the track.
 */
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const GH_MAX_BUFFER = 64 * 1024 * 1024;
const REPO = "doctor-school/ds-platform";

/**
 * The track taxonomy (#1583). Duplicated from create-issue.mjs by intent, not by
 * omission: that module spawns `gh` at import-time-adjacent paths and is the
 * Issue-creation entry point — importing it here to share three strings would
 * couple the PR-side CI job to the whole board-mutation helper. The unit test
 * pins both lists to the same three values.
 */
export const TRACK_LABELS = ["track:academy", "track:doctor", "track:platform"];

/** GitHub's auto-close keywords — identical to `tools/lint/spec-link-lint.ts`. */
const CLOSE_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi;

function die(msg, code = 1) {
  process.stderr.write(`[sync-pr-track] ${msg}\n`);
  process.exit(code);
}

/** Run `gh <args>`; parsed JSON (or raw when json:false). Dies on non-zero. */
function gh(args, { json = true } = {}) {
  const res = spawnSync("gh", args, {
    encoding: "utf8",
    maxBuffer: GH_MAX_BUFFER,
  });
  if (res.error) die(`failed to spawn gh: ${res.error.message}`);
  if (res.status !== 0)
    die(
      `gh ${args.join(" ")} exited ${res.status}: ${(res.stderr ?? "").trim()}`,
    );
  if (!json) return res.stdout;
  try {
    return JSON.parse(res.stdout);
  } catch {
    die(`could not parse gh JSON output for: gh ${args.join(" ")}`);
  }
}

// ── Pure helpers (side-effect-free → import-safe for the unit check). ────────

/**
 * The Issue numbers a PR body auto-closes, deduped, in first-seen order.
 * @param {string|undefined} body
 * @returns {number[]}
 */
export function extractClosedIssues(body) {
  if (!body) return [];
  const out = new Set();
  for (const m of body.matchAll(CLOSE_RE)) out.add(Number(m[1]));
  return [...out];
}

/**
 * The `track:*` members of a label list (any value, valid or not — validation is
 * the caller's, so a typo'd track can be REPORTED rather than silently dropped).
 * @param {string[]} labels
 * @returns {string[]}
 */
export function trackLabelsOf(labels) {
  return (labels ?? []).filter((l) => l.startsWith("track:"));
}

/**
 * Decide what to do with the PR's track label, as pure data.
 *
 * @param {{ prLabels: string[], issues: Array<{number: number, labels: string[]}> }} input
 * @returns {{ action: 'none'|'ok'|'apply'|'conflict', label?: string, reason: string }}
 *
 * - `none`    nothing to derive — no linked Issue (bot PRs: Version Packages,
 *             Dependabot), or no linked Issue carries a track (pre-#1583). A
 *             hand-set PR track is LEFT ALONE here: with no Issue-side fact to
 *             check it against, reding the PR would be a guess.
 * - `ok`      the PR already carries exactly the derived track.
 * - `apply`   add `label` to the PR.
 * - `conflict` the two sides disagree — never auto-resolved.
 */
export function planTrackSync({ prLabels = [], issues = [] } = {}) {
  const prTracks = trackLabelsOf(prLabels);

  if (issues.length === 0)
    return {
      action: "none",
      reason:
        "PR body links no Issue via an auto-close keyword — nothing to derive a track from.",
    };

  const perIssue = issues.map((i) => ({
    number: i.number,
    tracks: trackLabelsOf(i.labels),
  }));
  const issueTracks = [...new Set(perIssue.flatMap((i) => i.tracks))];

  if (issueTracks.length === 0)
    return {
      action: "none",
      reason: `linked Issue(s) ${perIssue.map((i) => `#${i.number}`).join(", ")} carry no track:* label (pre-#1583) — nothing to derive.`,
    };

  if (issueTracks.length > 1)
    return {
      action: "conflict",
      reason: `linked Issues disagree on the track: ${perIssue
        .filter((i) => i.tracks.length > 0)
        .map((i) => `#${i.number} → ${i.tracks.join(" + ")}`)
        .join("; ")}. Split the PR, or fix the Issue labels.`,
    };

  const derived = issueTracks[0];
  const owner = perIssue.find((i) => i.tracks.includes(derived));

  if (!TRACK_LABELS.includes(derived))
    return {
      action: "conflict",
      reason: `Issue #${owner.number} carries "${derived}", which is outside the #1583 taxonomy (${TRACK_LABELS.join(" | ")}). Fix the Issue label — a typo must not spread to the PR.`,
    };

  if (prTracks.length === 0)
    return {
      action: "apply",
      label: derived,
      reason: `derived ${derived} from Issue #${owner.number}.`,
    };

  if (prTracks.length === 1 && prTracks[0] === derived)
    return {
      action: "ok",
      label: derived,
      reason: `PR already carries ${derived} (Issue #${owner.number}).`,
    };

  return {
    action: "conflict",
    reason: `PR carries ${prTracks.join(" + ")} but Issue #${owner.number} says ${derived}. The Issue is the source of truth for the track — remove the hand-set PR label, or fix the Issue.`,
  };
}

// ── I/O shell ───────────────────────────────────────────────────────────────

function main(argv) {
  const dryRun = argv.includes("--dry-run");
  const prNumber = process.env.PR_NUMBER?.trim();
  if (!prNumber || !/^\d+$/.test(prNumber))
    die("PR_NUMBER env var is required (a positive integer).");

  const pr = gh([
    "pr",
    "view",
    prNumber,
    "--repo",
    REPO,
    "--json",
    "number,body,labels",
  ]);
  // The event payload's body is authoritative for its triggering event; a REST
  // read right after PR creation has returned a stale/absent body (#651).
  const body = process.env.PR_BODY ?? pr.body ?? "";
  const prLabels = (pr.labels ?? []).map((l) => l.name);

  const issues = extractClosedIssues(body).map((num) => {
    const issue = gh([
      "issue",
      "view",
      String(num),
      "--repo",
      REPO,
      "--json",
      "number,labels",
    ]);
    return {
      number: issue.number,
      labels: (issue.labels ?? []).map((l) => l.name),
    };
  });

  const plan = planTrackSync({ prLabels, issues });
  process.stdout.write(`[sync-pr-track] ${plan.action}: ${plan.reason}\n`);

  if (plan.action === "conflict") process.exit(2);
  if (plan.action !== "apply") process.exit(0);

  if (dryRun) {
    process.stdout.write(
      `[sync-pr-track] --dry-run — would add ${plan.label} to PR #${prNumber}.\n`,
    );
    process.exit(0);
  }

  gh(["pr", "edit", prNumber, "--repo", REPO, "--add-label", plan.label], {
    json: false,
  });
  process.stdout.write(
    `[sync-pr-track] added ${plan.label} to PR #${prNumber}.\n`,
  );
}

// Import-safe: main() runs only on direct invocation, so the unit test can
// import the pure helpers without spawning gh.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main(process.argv.slice(2));
