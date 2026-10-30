// tools/deploy/lib/release-lane.mjs — the pure half of `pnpm release:lane` (#3561):
// which main SHA a release targets and what is queued ahead of it. The GitHub reads
// live in `github-release-facts.mjs`; the CLI is `../release-lane.mjs`.

import { newestGreenStageSuite } from "./registry-retention.mjs";

/** Run statuses GitHub reports for a run that has not finished. */
const OPEN_STATUSES = new Set([
  "queued",
  "in_progress",
  "waiting",
  "pending",
  "requested",
]);

/**
 * The release candidate — the newest first-parent `main` commit with a green
 * `stage-suite` (the exact SHA `deploy-prod.yml` accepts, #3240) — located against
 * production. `readState(sha)` is the `stage-suite` state reader (null = none).
 *
 * @returns {Promise<{sha: string | null, walked: number, behindHead: number | null,
 *   relation: "ahead" | "live" | "behind" | "unknown" | null,
 *   unreadable: {sha: string, message: string} | null, bounded: boolean}>}
 *   `relation` places the candidate against the live SHA: `ahead` = releasable,
 *   `live` = already in production, `behind` = older than production (the box
 *   driver refuses a backwards release, #3157), `unknown` = production SHA not in
 *   the read main history.
 */
export async function laneCandidate({
  history,
  readState,
  productionSha,
  depth,
}) {
  const walk = await newestGreenStageSuite(history, readState, depth);
  const sha = walk.greenSha;
  let relation = null;
  if (sha) {
    const candidateAt = history.indexOf(sha);
    const productionAt = productionSha ? history.indexOf(productionSha) : -1;
    if (productionAt < 0) relation = "unknown";
    else if (candidateAt === productionAt) relation = "live";
    else relation = candidateAt < productionAt ? "ahead" : "behind";
  }
  return {
    sha,
    walked: walk.walked,
    behindHead: sha ? history.indexOf(sha) : null,
    relation,
    unreadable: walk.unreadable,
    bounded: walk.bounded,
  };
}

/** The runs of one workflow that have not finished, oldest first. */
export function openRuns(runs) {
  return runs
    .filter((r) => OPEN_STATUSES.has(r.status))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

const short = (sha) => (sha ? String(sha).slice(0, 9) : "—");

function runLine(r) {
  const source =
    r.event === "pull_request"
      ? `PR #${r.pull_requests?.[0]?.number ?? "?"} (${r.head_branch})`
      : `${r.event} ${r.head_branch}`;
  return `    ${r.status.padEnd(11)} ${short(r.head_sha)}  ${source}  since ${r.created_at}  ${r.html_url}`;
}

function runSection(title, runs, empty) {
  if (runs.length === 0) return [`${title}: ${empty}`];
  return [`${title}: ${runs.length}`, ...runs.map(runLine)];
}

/** The five lane facts as plain text. */
export function renderLane({
  productionSha,
  head,
  candidate,
  stage,
  images,
  deploy,
}) {
  const lines = [`Production (live):  ${short(productionSha)}`];
  lines.push(`main head:          ${short(head)}`);
  if (candidate.sha) {
    const note = {
      ahead: "releasable — the target for deploy-prod.yml",
      live: "already in production — nothing newer is stage-green",
      behind: "older than production — nothing newer is stage-green",
      unknown: "production SHA not found in main history",
    }[candidate.relation];
    lines.push(
      `Release candidate:  ${candidate.sha} (${candidate.behindHead} commit(s) behind head; ${note})`,
    );
  } else if (candidate.unreadable) {
    lines.push(
      `Release candidate:  unknown — stage-suite of ${short(candidate.unreadable.sha)} could not be read (${candidate.unreadable.message})`,
    );
  } else {
    lines.push(
      `Release candidate:  none — no green stage-suite in the newest ${candidate.walked} main commit(s)`,
    );
  }
  lines.push(...runSection("Stage main (stage.yml)", stage, "idle"));
  lines.push(
    ...runSection("Image builds (runtime-images.yml)", images, "idle"),
  );
  lines.push(...runSection("Deploy queue (deploy-prod.yml)", deploy, "empty"));
  if (deploy.some((r) => r.status !== "in_progress"))
    lines.push(
      "  ! a deploy is already pending — a new dispatch would silently cancel it (one pending run per group)",
    );
  return lines.join("\n");
}
