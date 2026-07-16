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
 * Usage:
 *   node tools/gh/set-board-status.mjs <issue#> <Todo|In Progress|Review|Done>
 *   node tools/gh/set-board-status.mjs <issue#> --resolve   # read-only: print item id, no write
 *   pnpm board:status <issue#> <status>                     # alias
 *
 * Safety: every `gh` call uses an explicit argv array (no shell string) — no command
 * injection (the issue number is validated as a positive integer before it is
 * interpolated into the query). The project/field/option ids are resolved live
 * from the targeted query; the documented values below are a cross-check WARN,
 * and the resolved values are what the mutation uses.
 *
 * Exit codes: 0 = status set (or resolved in --resolve mode); 1 = usage / resolution
 * / mutation error.
 */
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Generous stdout buffer for spawnSync (#315 hit ENOBUFS at the 1 MB default on
// full-board payloads). The targeted query is tiny, but keep the headroom — a
// silent truncation crash costs more than the bytes.
const GH_MAX_BUFFER = 64 * 1024 * 1024;

const OWNER = "doctor-school";
const REPO = "ds-platform";
const PROJECT_NUMBER = 1;
const PROJECT_TITLE = "DS Platform";
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
    `issue(number:${issueNumber}){projectItems(first:10){nodes{id ` +
    `project{id number title field(name:"${STATUS_FIELD}"){` +
    `... on ProjectV2SingleSelectField{id name options{id name}}}}}}}}}`
  );
}

/** Pick the projectItems node belonging to the given project number (the DS Platform board). */
export function pickProjectItem(nodes, projectNumber) {
  if (!Array.isArray(nodes)) return null;
  return nodes.find((n) => n?.project?.number === projectNumber) ?? null;
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

/** Run `gh api graphql -f query=<q>`; return the parsed `data` object. Dies on error. */
function ghGraphql(query) {
  const res = spawnSync("gh", ["api", "graphql", "-f", `query=${query}`], {
    encoding: "utf8",
    maxBuffer: GH_MAX_BUFFER,
  });
  if (res.error)
    die(
      `failed to spawn gh: ${res.error.message} (is the gh CLI installed + on PATH?)`,
    );
  if (res.status !== 0)
    die(`gh api graphql exited ${res.status}: ${res.stderr.trim()}`);
  let parsed;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    die(`could not parse gh api graphql JSON output`);
  }
  if (parsed.errors?.length)
    die(`GraphQL errors: ${parsed.errors.map((e) => e.message).join("; ")}`);
  return parsed.data;
}

function usage() {
  process.stderr.write(
    "Usage: node tools/gh/set-board-status.mjs <issue#> <Todo|In Progress|Review|Done>\n" +
      "       node tools/gh/set-board-status.mjs <issue#> --resolve   (read-only: resolve + print item id)\n",
  );
  process.exit(1);
}

function main() {
  const [rawIssue, rawStatus, ...rest] = process.argv.slice(2);
  if (!rawIssue || !rawStatus || rest.length > 0) usage();

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

  if (resolveOnly) {
    process.stdout.write(
      `[set-board-status] resolved (read-only, targeted per-issue query):\n` +
        `  project   = ${project.title} (#${project.number}) ${project.id}\n` +
        `  field     = ${STATUS_FIELD} ${statusField.id}\n` +
        `  item      = #${issueNumber} -> ${item.id}\n` +
        `  options   = ${(statusField.options ?? []).map((o) => `${o.name}:${o.id}`).join(", ")}\n` +
        `  No mutation performed (--resolve).\n`,
    );
    process.exit(0);
  }

  const option = resolveStatusOption(statusField.options, rawStatus);
  if (!option) die(`"${STATUS_FIELD}" has no option "${rawStatus}"`);

  // 3. Mutate with the live-resolved ids.
  ghGraphql(buildStatusMutation(project.id, item.id, statusField.id, option.id));

  process.stdout.write(
    `[set-board-status] OK — issue #${issueNumber} board Status set to "${rawStatus}" (item ${item.id}).\n`,
  );
}

// Run main only when invoked directly, so the pure seams are importable in the
// guard-test harness without firing subprocesses (mirrors merge-gate.mjs).
const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main();
}
