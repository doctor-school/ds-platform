#!/usr/bin/env node
/**
 * tools/gh/create-issue.mjs — file a GitHub Issue AND put it on the Projects v2
 * board in one deterministic step.
 *
 * Why: the board's "Item closed → Done" automation fires reliably, but the
 * "Item added → Todo" auto-add is delayed/unreliable **within a session** — an
 * Issue created via `gh issue create` mid-session may not appear on the board
 * before it is closed (observed 2026-07-05: #500 / #502 both missed the board
 * and needed a manual `item-add` + Status reconcile). This helper closes that
 * board-honesty gap: create → add-to-board → set Status=Todo → confirm the item
 * is really present via a direct GraphQL `node(id)` read (NOT `item-list`, which
 * has a read-lag on a just-added item).
 *
 * Canon: AGENTS.md §2 + §6 (Issue conventions / board honesty),
 * .claude/rules/repo-conventions.md (Issue conventions), memory
 * `reference_gh_issue_board_autoadd_delay` + `feedback_project_status_done_on_merge`
 * (board ids). Sibling helpers: set-board-status.mjs, wait-ci-green.mjs.
 *
 * Usage (thin passthrough — everything after the control flags is forwarded to
 * `gh issue create` verbatim; do not reimplement its flags). Exactly ONE
 * `source:*` provenance label is required (#1009) — see SOURCE_LABELS:
 *   node tools/gh/create-issue.mjs --title "<t>" --body-file <f> --label source:agent [--label <l> …] [gh flags…]
 *   node tools/gh/create-issue.mjs --no-todo  --title "<t>" --body-file <f>   # add to board, leave Status unset
 *   pnpm issue:create --title "<t>" --body-file <f> --label tooling           # alias
 *
 * Control flags (consumed here, NOT forwarded to gh) — put them BEFORE the gh
 * passthrough; a passthrough VALUE equal to a control flag would be consumed too:
 *   --no-todo   add the Issue to the board but do not set Status=Todo.
 *
 * Repo is hard-pinned to the board's repo (the Projects v2 board is repo-specific):
 * a `--repo`/`-R` in the passthrough is REJECTED rather than silently honored, so
 * the created Issue can never land in a foreign repo while item-add still targets
 * the doctor-school board.
 *
 * Safety: every `gh` call uses an explicit argv array (no shell string) — no
 * command injection. Project/field/option ids below are cross-checked against
 * the live API where a lookup exists; item-add returns the authoritative item id.
 *
 * Exit codes: 0 = Issue created, added to the board, and confirmed present;
 * 1 = usage / gh / confirmation error.
 */
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Large payloads (board lists, GraphQL) overflow spawnSync's default 1 MiB
// stdout buffer → ENOBUFS, which would crash silently (#315).
const GH_MAX_BUFFER = 64 * 1024 * 1024;

const OWNER = "doctor-school";
const PROJECT_NUMBER = "1";
const REPO = "doctor-school/ds-platform";

// Known board ids (memory `reference_gh_issue_board_autoadd_delay` +
// `feedback_project_status_done_on_merge`) — the item-add step returns the
// authoritative item id; these drive the Status mutation + the confirmation.
const KNOWN = {
  projectId: "PVT_kwDOEQZdbM4BYYrZ",
  statusFieldId: "PVTSSF_lADOEQZdbM4BYYrZzhTe6SA",
  todoOptionId: "f75ad846",
};

function die(msg) {
  process.stderr.write(`[create-issue] ${msg}\n`);
  process.exit(1);
}

/** Run `gh <args>`; return parsed JSON (or raw string when json:false). Dies on non-zero. */
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
    die(`gh ${args.join(" ")} exited ${res.status}: ${(res.stderr ?? "").trim()}`);
  if (!json) return res.stdout;
  try {
    return JSON.parse(res.stdout);
  } catch {
    die(`could not parse gh JSON output for: gh ${args.join(" ")}`);
  }
}

// ── Pure helpers (side-effect-free → import-safe for a unit check, mirroring
//    wait-ci-green.mjs's exported `classify`). ────────────────────────────────

/**
 * Split argv into our own control flags and the passthrough forwarded to
 * `gh issue create` verbatim (thin wrapper — we never reimplement gh's flags).
 * @param {string[]} argv
 * @returns {{ setTodo: boolean, passthrough: string[] }}
 */
export function partitionArgs(argv) {
  const passthrough = [];
  let setTodo = true;
  for (const a of argv) {
    if (a === "--no-todo") {
      setTodo = false;
      continue;
    }
    passthrough.push(a);
  }
  return { setTodo, passthrough };
}

/**
 * Detect a `--repo` / `-R` override in the gh passthrough. This helper is
 * hard-pinned to the board's repo, so an override is rejected (not silently
 * honored) — gh would otherwise let a passthrough `--repo` win over our pin.
 * @param {string[]} args
 * @returns {boolean}
 */
export function hasRepoOverride(args) {
  return (args ?? []).some(
    (a) => a === "--repo" || a.startsWith("--repo=") || a === "-R" || a.startsWith("-R"),
  );
}

/** The provenance-label taxonomy (#1009) — every new Issue carries exactly one. */
export const SOURCE_LABELS = [
  "source:owner",
  "source:spec",
  "source:retro",
  "source:agent",
];

/**
 * Collect every `source:*` label value out of the gh passthrough (#1009).
 * Handles the forms gh accepts: `--label v`, `--label=v`, `-l v`, and
 * comma-separated lists (`--label a,b`).
 * @param {string[]} args
 * @returns {string[]}
 */
export function collectSourceLabels(args) {
  const values = [];
  const list = args ?? [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    let raw;
    if (a === "--label" || a === "-l") raw = list[i + 1];
    else if (a.startsWith("--label=")) raw = a.slice("--label=".length);
    else continue;
    if (!raw) continue;
    for (const v of raw.split(",")) {
      const label = v.trim();
      if (label.startsWith("source:")) values.push(label);
    }
  }
  return values;
}

/**
 * Validate the provenance-label requirement (#1009): exactly ONE `source:*`
 * label, drawn from the known taxonomy. Returns null when valid, else the
 * error message to die with.
 * @param {string[]} args  the gh passthrough
 * @returns {string|null}
 */
export function sourceLabelError(args) {
  const taxonomy = SOURCE_LABELS.join(" | ");
  const found = collectSourceLabels(args);
  if (found.length === 0)
    return (
      `every new Issue needs exactly ONE provenance label — pass ` +
      `--label <source>, one of: ${taxonomy}.`
    );
  if (found.length > 1)
    return `exactly ONE source:* label is allowed, got: ${found.join(", ")} (taxonomy: ${taxonomy}).`;
  if (!SOURCE_LABELS.includes(found[0]))
    return `unknown source label "${found[0]}" — must be one of: ${taxonomy}.`;
  return null;
}

/**
 * Extract the created Issue's URL from `gh issue create` stdout — gh prints the
 * canonical `https://github.com/<owner>/<repo>/issues/<N>` URL on its own line.
 * @param {string} stdout
 * @returns {string|null}
 */
export function extractIssueUrl(stdout) {
  const m = (stdout ?? "").match(
    /https?:\/\/[^\s]*\/issues\/(\d+)\b/,
  );
  return m ? m[0] : null;
}

/**
 * Parse the trailing Issue number out of an issue URL.
 * @param {string} url
 * @returns {number|null}
 */
export function issueNumberFromUrl(url) {
  const m = (url ?? "").match(/\/issues\/(\d+)\b/);
  return m ? Number(m[1]) : null;
}

/**
 * Build the GraphQL query that reads a ProjectV2Item back by node id — the
 * read-lag-free confirmation (`item-list` can still 404 a just-added item).
 * @param {string} itemId
 * @returns {string}
 */
export function buildNodeQuery(itemId) {
  return (
    `{ node(id:"${itemId}"){ ... on ProjectV2Item { ` +
    `content { ... on Issue { number state url } } ` +
    `fieldValueByName(name:"Status"){ ... on ProjectV2ItemFieldSingleSelectValue { name } } } } }`
  );
}

/**
 * Validate the GraphQL node read-back against the Issue we just created.
 * @param {any} apiJson  parsed `gh api graphql` response
 * @param {number} expectedNumber
 * @param {{ expectTodo?: boolean }} [opts]  when expectTodo, Status must read back "Todo"
 * @returns {{ ok: boolean, reason?: string, status?: string|null, number?: number }}
 */
export function parseNodeReadback(apiJson, expectedNumber, { expectTodo = false } = {}) {
  const node = apiJson?.data?.node;
  if (!node) return { ok: false, reason: "node not found on the board (GraphQL returned null)" };
  const number = node.content?.number;
  if (number == null)
    return { ok: false, reason: "board item has no Issue content" };
  if (number !== expectedNumber)
    return {
      ok: false,
      reason: `board item resolves to Issue #${number}, expected #${expectedNumber}`,
    };
  const status = node.fieldValueByName?.name ?? null;
  if (expectTodo && status !== "Todo")
    return {
      ok: false,
      reason: `board Status reads "${status ?? "(unset)"}", expected "Todo"`,
      status,
      number,
    };
  return { ok: true, status, number };
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    process.stderr.write(
      "Usage: node tools/gh/create-issue.mjs [--no-todo] --title \"<t>\" --body-file <f> --label <source:*> [--label <l> …]\n" +
        "  Thin wrapper over `gh issue create` (flags forwarded verbatim) that also adds the\n" +
        "  new Issue to Projects v2 board #1 (doctor-school), sets Status=Todo, and confirms\n" +
        "  the item via a GraphQL node read. --no-todo adds to the board without setting Status.\n" +
        `  Exactly ONE provenance label is required (#1009): ${SOURCE_LABELS.join(" | ")}.\n`,
    );
    process.exit(1);
  }

  const { setTodo, passthrough } = partitionArgs(argv);

  // The board is repo-specific, so the repo pin must win. gh honors the LAST
  // --repo, so a passthrough override would silently defeat a leading pin —
  // reject it outright rather than land the Issue in a foreign repo.
  if (hasRepoOverride(passthrough))
    die(
      `--repo/-R is not allowed: this helper is hard-pinned to ${REPO} because the ` +
        `Projects v2 board is repo-specific. Remove it from the arguments.`,
    );

  // Provenance gate (#1009): refuse creation unless exactly one source:* label
  // is passed — BEFORE any gh call, so no Issue is created on a violation.
  const sourceError = sourceLabelError(passthrough);
  if (sourceError) die(sourceError);

  // 1. Create the Issue — thin passthrough. Pin --repo AFTER the passthrough so
  //    the returned URL is guaranteed to belong to the board's repo (gh honors
  //    the last --repo; the reject above already blocks a passthrough override,
  //    this is belt-and-suspenders).
  process.stdout.write(`[create-issue] creating Issue…\n`);
  const createOut = gh(["issue", "create", ...passthrough, "--repo", REPO], {
    json: false,
  });
  const url = extractIssueUrl(createOut);
  if (!url)
    die(
      `could not find the created Issue URL in gh output:\n${createOut.trim()}`,
    );
  const issueNumber = issueNumberFromUrl(url);
  if (!issueNumber) die(`could not parse an Issue number from URL: ${url}`);
  process.stdout.write(`[create-issue] created #${issueNumber} — ${url}\n`);

  // 2. Add it to the board — item-add returns the authoritative item id.
  const added = gh([
    "project",
    "item-add",
    PROJECT_NUMBER,
    "--owner",
    OWNER,
    "--url",
    url,
    "--format",
    "json",
  ]);
  const itemId = added?.id;
  if (!itemId)
    die(
      `gh project item-add returned no item id (payload: ${JSON.stringify(added)}); ` +
        `Issue #${issueNumber} exists but is NOT on the board — reconcile with: ` +
        `gh project item-add ${PROJECT_NUMBER} --owner ${OWNER} --url ${url}`,
    );
  process.stdout.write(`[create-issue] added to board — item ${itemId}\n`);

  // 3. Optionally set Status=Todo.
  if (setTodo) {
    gh(
      [
        "project",
        "item-edit",
        "--id",
        itemId,
        "--project-id",
        KNOWN.projectId,
        "--field-id",
        KNOWN.statusFieldId,
        "--single-select-option-id",
        KNOWN.todoOptionId,
      ],
      { json: false },
    );
    process.stdout.write(`[create-issue] Status set to Todo\n`);
  }

  // 4. Confirm via a direct GraphQL node read (dodges item-list read-lag).
  const readback = gh([
    "api",
    "graphql",
    "-f",
    `query=${buildNodeQuery(itemId)}`,
  ]);
  const check = parseNodeReadback(readback, issueNumber, { expectTodo: setTodo });
  if (!check.ok)
    die(
      `board confirmation failed: ${check.reason} (item ${itemId}); ` +
        `reconcile with: pnpm board:status ${issueNumber} Todo`,
    );

  process.stdout.write(
    `[create-issue] OK — confirmed on board.\n` +
      `  issue  = #${issueNumber}\n` +
      `  url    = ${url}\n` +
      `  item   = ${itemId}\n` +
      `  status = ${check.status ?? "(unset)"}\n`,
  );
  process.exit(0);
}

// Run main only when invoked directly, so the pure helpers can be imported in a
// test. `pathToFileURL` yields the canonical `file:///C:/…` form on Windows too;
// `process.argv[1]` is undefined under `node --eval` (import-only), so guard it.
const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main();
}
