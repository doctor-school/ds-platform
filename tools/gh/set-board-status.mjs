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
 * Canon: AGENTS.md §2 + §6 ("set board Status = Done"), .claude/rules/repo-conventions.md
 * (Issue conventions), memory `feedback_project_status_done_on_merge` (board ids).
 *
 * Usage:
 *   node tools/gh/set-board-status.mjs <issue#> <Todo|In Progress|Review|Done>
 *   node tools/gh/set-board-status.mjs <issue#> --resolve   # read-only: print item id, no write
 *   pnpm board:status <issue#> <status>                     # alias
 *
 * Safety: every `gh` call uses an explicit argv array (no shell string) — no command
 * injection. The project/field/option ids are resolved live from the API; the values
 * in memory are documented as a cross-check, not hardcoded into the mutation.
 *
 * Exit codes: 0 = status set (or resolved in --resolve mode); 1 = usage / resolution
 * / mutation error.
 */
import { spawnSync } from "node:child_process";

// The DS Platform board is already >100 items, paged below at `--limit 1000`.
// That JSON payload overflows spawnSync's default 1 MB stdout buffer → ENOBUFS,
// which would crash the manual board-status fallback silently (#315). 64 MB is
// comfortably above any realistic board-list payload.
const GH_MAX_BUFFER = 64 * 1024 * 1024;

const OWNER = "doctor-school";
const PROJECT_NUMBER = "1";
const PROJECT_TITLE = "DS Platform";
const STATUS_FIELD = "Status";
const VALID_STATUS = ["Todo", "In Progress", "Review", "Done"];

// Known ids (memory `feedback_project_status_done_on_merge`) — used only as a
// post-resolution cross-check, never as the value we mutate against.
const KNOWN = {
  projectId: "PVT_kwDOEQZdbM4BYYrZ",
  statusFieldId: "PVTSSF_lADOEQZdbM4BYYrZzhTe6SA",
  options: {
    Todo: "f75ad846",
    "In Progress": "47fc9ee4",
    Review: "f7f44e89",
    Done: "98236657",
  },
};

function die(msg) {
  process.stderr.write(`[set-board-status] ${msg}\n`);
  process.exit(1);
}

/** Run `gh <args>`; return parsed JSON (or raw string when not JSON). Throws on non-zero. */
function gh(args, { json = true } = {}) {
  const res = spawnSync("gh", args, {
    encoding: "utf8",
    maxBuffer: GH_MAX_BUFFER,
  });
  if (res.error)
    die(
      `failed to spawn gh: ${res.error.message} (is the gh CLI installed + on PATH?)`,
    );
  if (res.status !== 0)
    die(`gh ${args.join(" ")} exited ${res.status}: ${res.stderr.trim()}`);
  if (!json) return res.stdout;
  try {
    return JSON.parse(res.stdout);
  } catch {
    die(`could not parse gh JSON output for: gh ${args.join(" ")}`);
  }
}

function usage() {
  process.stderr.write(
    "Usage: node tools/gh/set-board-status.mjs <issue#> <Todo|In Progress|Review|Done>\n" +
      "       node tools/gh/set-board-status.mjs <issue#> --resolve   (read-only: resolve + print item id)\n",
  );
  process.exit(1);
}

const [rawIssue, rawStatus, ...rest] = process.argv.slice(2);
if (!rawIssue || !rawStatus || rest.length > 0) usage();

const issueNumber = Number(rawIssue);
if (!Number.isInteger(issueNumber) || issueNumber <= 0)
  die(`invalid issue number: "${rawIssue}"`);

const resolveOnly = rawStatus === "--resolve";
if (!resolveOnly && !VALID_STATUS.includes(rawStatus)) {
  die(`invalid status "${rawStatus}". Valid: ${VALID_STATUS.join(", ")}`);
}

// 1. Resolve project id (live) and cross-check against the documented value.
const projects = gh([
  "project",
  "list",
  "--owner",
  OWNER,
  "--format",
  "json",
  "--limit",
  "200",
]).projects;
const project = projects?.find((p) => p.title === PROJECT_TITLE);
if (!project) die(`project "${PROJECT_TITLE}" not found under ${OWNER}`);
if (project.id !== KNOWN.projectId) {
  process.stderr.write(
    `[set-board-status] note: resolved project id ${project.id} differs from documented ${KNOWN.projectId} — using resolved value.\n`,
  );
}

// 2. Resolve the Status field id + the requested option id (live).
const fields = gh([
  "project",
  "field-list",
  PROJECT_NUMBER,
  "--owner",
  OWNER,
  "--format",
  "json",
  "--limit",
  "50",
]).fields;
const statusField = fields?.find((f) => f.name === STATUS_FIELD);
if (!statusField)
  die(`"${STATUS_FIELD}" field not found on project #${PROJECT_NUMBER}`);

// 3. Resolve the project item id for the issue.
const itemList = gh([
  "project",
  "item-list",
  PROJECT_NUMBER,
  "--owner",
  OWNER,
  "--format",
  "json",
  "--limit",
  "1000",
]).items;
const item = itemList?.find(
  (i) => i.content?.number === issueNumber && i.content?.type === "Issue",
);
if (!item) {
  die(
    `issue #${issueNumber} is not an item on the "${PROJECT_TITLE}" board. ` +
      `Add it first (gh project item-add ${PROJECT_NUMBER} --owner ${OWNER} --url <issue-url>).`,
  );
}

if (resolveOnly) {
  process.stdout.write(
    `[set-board-status] resolved (read-only):\n` +
      `  project   = ${PROJECT_TITLE} (#${PROJECT_NUMBER}) ${project.id}\n` +
      `  field     = ${STATUS_FIELD} ${statusField.id}\n` +
      `  item      = #${issueNumber} -> ${item.id}\n` +
      `  options   = ${(statusField.options ?? []).map((o) => `${o.name}:${o.id}`).join(", ")}\n` +
      `  No mutation performed (--resolve).\n`,
  );
  process.exit(0);
}

const option = (statusField.options ?? []).find((o) => o.name === rawStatus);
if (!option) die(`"${STATUS_FIELD}" has no option "${rawStatus}"`);

// 4. Mutate.
gh(
  [
    "project",
    "item-edit",
    "--id",
    item.id,
    "--project-id",
    project.id,
    "--field-id",
    statusField.id,
    "--single-select-option-id",
    option.id,
  ],
  { json: false },
);

process.stdout.write(
  `[set-board-status] OK — issue #${issueNumber} board Status set to "${rawStatus}" (item ${item.id}).\n`,
);
