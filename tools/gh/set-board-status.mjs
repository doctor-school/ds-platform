#!/usr/bin/env node
/**
 * tools/gh/set-board-status.mjs — deterministic GitHub Projects v2 board-status setter.
 *
 * Why: `Closes #N` closes the Issue but does NOT move the Projects v2 board column
 * (there is no closed→Done workflow wired). The merge step of every task therefore
 * has to set Status by hand, and the audit (epic #247, Theme B) found this is the
 * single most-forgotten step. This script operationalizes the rule so the
 * `run-task-lifecycle` skill can run it as one deterministic command instead of a
 * fragile hand-typed `gh project item-edit` with copy-pasted ids.
 *
 * Resolution is a single TARGETED per-issue GraphQL query (#993): the issue's
 * `projectItems` carry the item id, the owning project's id, and the Status
 * field + options — everything needed for the mutation — at a few GraphQL
 * points. The previous flow paged the ENTIRE board (`gh project item-list
 * --limit 1000`, hundreds of points per invocation) against the 5000/hr quota
 * SHARED across all sessions; no full-board scan exists anywhere on this path.
 *
 * Canon: AGENTS.md §2 + §6 ("set board Status = Done"), .claude/rules/repo-conventions.md
 * (Issue conventions), memory `feedback_project_status_done_on_merge` (board ids).
 *
 * Queue-position guard (#1855): `In Progress` is the claim marker, so the claim
 * is where priority is actually decided. Setting `In Progress` therefore refuses
 * (exit 3) an Issue that sits outside its track's queue-head milestone — the open
 * release milestone with the earliest owner-set `due_on`. Allowed without a flag:
 * the queue head itself, «Platform ops & hardening», a `track:platform` Issue
 * outside any track release, and an `epic:` container. Override with
 * `--ahead-of-queue "<verbatim owner quote>"`, which proceeds AND posts the quote
 * as the `claim:` comment so `pnpm backlog:triage` sees the claim and the reason.
 * Rules live in tools/gh/lib/queue-position.mjs; `--resolve` prints the computed
 * position and writes nothing. The guard fails OPEN when no head can be computed
 * (empty milestones payload / `gh` failure): WARN and allow, never refuse on
 * absent data (#1857).
 *
 * Usage:
 *   node tools/gh/set-board-status.mjs <issue#> <Todo|In Progress|Review|Done>
 *   node tools/gh/set-board-status.mjs <issue#> "In Progress" --ahead-of-queue "<owner quote>"
 *   node tools/gh/set-board-status.mjs <issue#> --resolve   # read-only: print item id + queue position
 *   pnpm board:status <issue#> <status>                     # alias
 *
 * Safety: every `gh` call uses an explicit argv array (no shell string) — no command
 * injection (the issue number is validated as a positive integer before it is
 * interpolated into the query). The project/field/option ids are resolved live
 * from the targeted query; the documented values below are a cross-check WARN,
 * and the resolved values are what the mutation uses.
 *
 * Exit codes: 0 = status set (or resolved in --resolve mode); 1 = usage / resolution
 * / mutation error; 3 = claim refused — the Issue is ahead of its track's queue
 * (#1855), re-run with `--ahead-of-queue "<verbatim owner quote>"` to override.
 *
 * Partial success (#1857): the `claim:` comment of an overridden claim is posted
 * AFTER the board mutation (step 5), so a comment failure exits 1 with the board
 * ALREADY set to "In Progress". That state is board-correct and comment-missing —
 * re-run is unnecessary for the board; post the quote as an `gh issue comment`
 * by hand so `pnpm backlog:triage` sees the claim.
 */
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  OWNER,
  PROJECT_NUMBER,
  PROJECT_TITLE,
  REPO,
  ghGraphqlResult,
  pickProjectItem,
} from "./lib/projects-v2.mjs";
import {
  AHEAD_OF_QUEUE_FLAG,
  formatQueueRefusal,
  LITMUS_LINE,
  parseAheadOfQueue,
  queueHead,
  queuePosition,
  trackOf,
} from "./lib/queue-position.mjs";

// Re-exported so importers (guard-tests) keep resolving the shared item picker
// from this module's public surface (#1140 moved the plumbing to lib/).
export { pickProjectItem };
// The queue-position rules are pure and shared with tools/backlog-triage.ts;
// re-exported here so the guard-test suite covers them through this module.
export { LITMUS_LINE, parseAheadOfQueue, queueHead, queuePosition, trackOf };

/** Board status whose assignment is the claim — the only one the guard gates. */
export const CLAIM_STATUS = "In Progress";

const STATUS_FIELD = "Status";
export const VALID_STATUS = ["Todo", "In Progress", "Review", "Done"];

// Known ids (memory `feedback_project_status_done_on_merge`) — used only as a
// post-resolution cross-check, never as the value we mutate against.
export const KNOWN = {
  projectId: "PVT_kwDOEQZdbM4BYYrZ",
  statusFieldId: "PVTSSF_lADOEQZdbM4BYYrZzhTe6SA",
  options: {
    Todo: "f75ad846",
    "In Progress": "47fc9ee4",
    Review: "f7f44e89",
    Done: "98236657",
  },
};

/* ------------------------------------------------------------------------- *
 * Pure seams — unit-tested in tools/lint/guard-tests/set-board-status.spec.ts
 * (main-gate pattern mirrors merge-gate.mjs).
 * ------------------------------------------------------------------------- */

/**
 * Build the targeted per-issue GraphQL query: the issue's projectItems with,
 * per item, its id + owning project (id/number/title) + that project's Status
 * single-select field (id + options). One cheap call resolves everything the
 * mutation needs.
 */
export function buildProjectItemsQuery(issueNumber) {
  if (!Number.isInteger(issueNumber) || issueNumber <= 0)
    throw new Error(`buildProjectItemsQuery: invalid issue number ${issueNumber}`);
  return (
    `query{repository(owner:"${OWNER}",name:"${REPO}"){` +
    `issue(number:${issueNumber}){title milestone{title} ` +
    `labels(first:30){nodes{name}} projectItems(first:10){nodes{id ` +
    `project{id number title field(name:"${STATUS_FIELD}"){` +
    `... on ProjectV2SingleSelectField{id name options{id name}}}}}}}}}`
  );
}

/**
 * Build the repository-milestones query used to compute queue heads (#1855).
 * Only OPEN milestones matter — a closed release is a shipped release.
 *
 * `first:100` is a deliberate single page, not pagination: the repo has ~10 open
 * milestones and the roadmap model keeps that count small by construction. The
 * query also asks for `totalCount` so a silent truncation cannot happen — see
 * `milestonesPageWarning` (#1857).
 */
export function buildMilestonesQuery() {
  return (
    `query{repository(owner:"${OWNER}",name:"${REPO}"){` +
    `milestones(first:100,states:OPEN){totalCount nodes{title dueOn state}}}}`
  );
}

/**
 * Sanity check on the single-page milestones read: null when the page holds
 * every open milestone, a WARN line when `totalCount` exceeds what came back
 * (the queue head would then be computed from a truncated set).
 * @returns {string|null}
 */
export function milestonesPageWarning(data) {
  const page = data?.repository?.milestones;
  const total = page?.totalCount;
  const returned = Array.isArray(page?.nodes) ? page.nodes.length : 0;
  if (!Number.isInteger(total) || total <= returned) return null;
  return (
    `open milestones truncated: ${returned} of ${total} returned by a single ` +
    `first:100 page — the computed queue head may be wrong; paginate buildMilestonesQuery().`
  );
}

/**
 * Normalise the milestones GraphQL payload into the REST-shaped records
 * (`title` / `due_on` / `state`) the pure queue rules consume.
 */
export function parseMilestones(data) {
  const nodes = data?.repository?.milestones?.nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes
    .filter((n) => typeof n?.title === "string")
    .map((n) => ({
      title: n.title,
      due_on: n.dueOn ?? null,
      state: typeof n.state === "string" ? n.state.toLowerCase() : "open",
    }));
}

/** Resolve a status option by exact name; null when absent. */
export function resolveStatusOption(options, statusName) {
  if (!Array.isArray(options)) return null;
  return options.find((o) => o?.name === statusName) ?? null;
}

/**
 * Cross-check the live-resolved ids against the documented KNOWN constants.
 * Returns an array of human-readable WARN lines (empty = all consistent).
 * Mismatches never block — the resolved value always wins.
 */
export function knownIdWarnings(resolved, known = KNOWN) {
  const warnings = [];
  if (resolved.projectId && resolved.projectId !== known.projectId)
    warnings.push(
      `resolved project id ${resolved.projectId} differs from documented ${known.projectId} — using resolved value`,
    );
  if (resolved.statusFieldId && resolved.statusFieldId !== known.statusFieldId)
    warnings.push(
      `resolved "${STATUS_FIELD}" field id ${resolved.statusFieldId} differs from documented ${known.statusFieldId} — using resolved value`,
    );
  for (const option of resolved.options ?? []) {
    const documented = known.options[option.name];
    if (documented && option.id !== documented)
      warnings.push(
        `resolved option "${option.name}" id ${option.id} differs from documented ${documented} — using resolved value`,
      );
  }
  return warnings;
}

/** Build the updateProjectV2ItemFieldValue mutation from resolved ids. */
export function buildStatusMutation(projectId, itemId, fieldId, optionId) {
  for (const [name, value] of Object.entries({ projectId, itemId, fieldId, optionId })) {
    if (typeof value !== "string" || value === "" || /["\\{}]/.test(value))
      throw new Error(`buildStatusMutation: invalid ${name}: ${value}`);
  }
  return (
    `mutation{updateProjectV2ItemFieldValue(input:{projectId:"${projectId}",` +
    `itemId:"${itemId}",fieldId:"${fieldId}",` +
    `value:{singleSelectOptionId:"${optionId}"}})` +
    `{projectV2Item{id}}}`
  );
}

/* ------------------------------------------------------------------------- *
 * Impure half — gh spawns + CLI wiring (exercised live, not unit-tested).
 * ------------------------------------------------------------------------- */

function die(msg) {
  process.stderr.write(`[set-board-status] ${msg}\n`);
  process.exit(1);
}

function warn(msg) {
  process.stderr.write(`[set-board-status] note: ${msg}\n`);
}

/** Run `gh api graphql -f query=<q>`; return the parsed `data` object. Dies on
 * error — wraps the shared non-fatal `ghGraphqlResult` (#1140) with this tool's
 * fail-fast posture. */
function ghGraphql(query) {
  const res = ghGraphqlResult(query);
  if (!res.ok) die(res.error);
  return res.data;
}

/** Refuse the claim: exit 3, the dedicated queue-position code (#1855). */
function refuse(msg) {
  process.stderr.write(`[set-board-status] ${msg}\n`);
  process.exit(3);
}

/**
 * Post the ahead-of-queue justification as the canonical `claim:` comment so
 * `pnpm backlog:triage` picks it up as the claim AND records the owner's reason.
 * Explicit argv array — never a shell string.
 */
function postClaimComment(issueNumber, quote) {
  const body = `claim: ahead of queue — «${quote}»`;
  const res = spawnSync("gh", ["issue", "comment", String(issueNumber), "--body", body], {
    encoding: "utf8",
    shell: false,
  });
  if (res.status !== 0)
    die(
      `failed to post the ahead-of-queue claim comment on #${issueNumber}: ` +
        `${(res.stderr || res.error?.message || "unknown error").trim()}`,
    );
  process.stdout.write(`[set-board-status] posted claim comment: ${body}\n`);
}

function usage() {
  process.stderr.write(
    "Usage: node tools/gh/set-board-status.mjs <issue#> <Todo|In Progress|Review|Done>\n" +
      `       node tools/gh/set-board-status.mjs <issue#> "${CLAIM_STATUS}" ${AHEAD_OF_QUEUE_FLAG} "<verbatim owner quote>"\n` +
      "       node tools/gh/set-board-status.mjs <issue#> --resolve   (read-only: resolve + print item id + queue position)\n",
  );
  process.exit(1);
}

function main() {
  const [rawIssue, rawStatus, ...rest] = process.argv.slice(2);
  if (!rawIssue || !rawStatus) usage();

  const override = parseAheadOfQueue(rest);
  if (override.error) die(override.error);

  const issueNumber = Number(rawIssue);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0)
    die(`invalid issue number: "${rawIssue}"`);

  const resolveOnly = rawStatus === "--resolve";
  if (!resolveOnly && !VALID_STATUS.includes(rawStatus))
    die(`invalid status "${rawStatus}". Valid: ${VALID_STATUS.join(", ")}`);

  // 1. Targeted per-issue resolution — ONE cheap GraphQL query, no board scan.
  const data = ghGraphql(buildProjectItemsQuery(issueNumber));
  const issue = data?.repository?.issue;
  if (!issue) die(`issue #${issueNumber} not found in ${OWNER}/${REPO}`);

  const item = pickProjectItem(issue.projectItems?.nodes, PROJECT_NUMBER);
  if (!item)
    die(
      `issue #${issueNumber} is not an item on the "${PROJECT_TITLE}" board (project #${PROJECT_NUMBER}). ` +
        `Add it first (gh project item-add ${PROJECT_NUMBER} --owner ${OWNER} --url <issue-url>).`,
    );

  const project = item.project;
  const statusField = project.field;
  if (!statusField?.id)
    die(`"${STATUS_FIELD}" single-select field not found on project #${PROJECT_NUMBER}`);

  // 2. Cross-check resolved ids against the documented constants (WARN only).
  for (const w of knownIdWarnings({
    projectId: project.id,
    statusFieldId: statusField.id,
    options: statusField.options,
  }))
    warn(w);

  // 2b. Queue position (#1855) — computed for --resolve (reporting) and for the
  // claim status (gating). One extra cheap GraphQL call, and only when needed.
  const issueMilestone = issue.milestone?.title ?? "";
  let position = null;
  if (resolveOnly || rawStatus === CLAIM_STATUS) {
    const milestonesData = ghGraphql(buildMilestonesQuery());
    const pageWarning = milestonesPageWarning(milestonesData);
    if (pageWarning) warn(pageWarning);
    const milestones = parseMilestones(milestonesData);
    position = queuePosition(
      {
        track: trackOf(issue.labels?.nodes ?? []),
        milestone: issueMilestone,
        title: issue.title ?? "",
      },
      milestones,
    );
  }

  if (resolveOnly) {
    process.stdout.write(
      `[set-board-status] resolved (read-only, targeted per-issue query):\n` +
        `  project   = ${project.title} (#${project.number}) ${project.id}\n` +
        `  field     = ${STATUS_FIELD} ${statusField.id}\n` +
        `  item      = #${issueNumber} -> ${item.id}\n` +
        `  options   = ${(statusField.options ?? []).map((o) => `${o.name}:${o.id}`).join(", ")}\n` +
        `  milestone = ${issueMilestone || "(none)"}\n` +
        `  queue     = ${position.ok ? "OK" : "AHEAD-OF-QUEUE"} (${position.reason}); ` +
        `head = ${position.head ?? "(none)"}\n` +
        `  litmus    = ${LITMUS_LINE}\n` +
        `  No mutation performed (--resolve).\n`,
    );
    process.exit(0);
  }

  // 3. Queue-position gate — the claim status only (#1855).
  if (override.present && rawStatus !== CLAIM_STATUS)
    die(`${AHEAD_OF_QUEUE_FLAG} applies only when setting "${CLAIM_STATUS}"`);
  if (rawStatus === CLAIM_STATUS && position && !position.ok) {
    if (!override.present) refuse(formatQueueRefusal(issueNumber, position, issueMilestone));
    warn(
      `#${issueNumber} is ahead of queue (head: ${position.head ?? "none"}) — ` +
        `proceeding under ${AHEAD_OF_QUEUE_FLAG}.`,
    );
  }
  // Fail-open path (#1857): no queue head could be computed, so the guard has no
  // evidence either way. The claim proceeds, loudly — never silently.
  if (rawStatus === CLAIM_STATUS && position?.reason === "no-queue-data")
    warn(
      `no queue head could be computed for #${issueNumber} (milestone ` +
        `${issueMilestone || "(none)"}) — allowing the claim unguarded. ` +
        `Litmus stands: ${LITMUS_LINE}`,
    );

  const option = resolveStatusOption(statusField.options, rawStatus);
  if (!option) die(`"${STATUS_FIELD}" has no option "${rawStatus}"`);

  // 4. Mutate with the live-resolved ids.
  ghGraphql(buildStatusMutation(project.id, item.id, statusField.id, option.id));

  process.stdout.write(
    `[set-board-status] OK — issue #${issueNumber} board Status set to "${rawStatus}" (item ${item.id}).\n`,
  );

  // 5. An overridden claim records the owner's reason as the claim comment —
  // but ONLY when the Issue really was ahead of queue (#1857). An override on an
  // Issue the guard would have allowed anyway must not publish «ahead of queue»
  // as a fact about it.
  if (override.present && rawStatus === CLAIM_STATUS) {
    if (position && !position.ok) postClaimComment(issueNumber, override.quote);
    else
      warn(
        `${AHEAD_OF_QUEUE_FLAG} was passed but #${issueNumber} is not ahead of queue ` +
          `(${position?.reason ?? "position not computed"}) — no claim comment posted.`,
      );
  }
}

// Run main only when invoked directly, so the pure seams are importable in the
// guard-test harness without firing subprocesses (mirrors merge-gate.mjs).
const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main();
}
