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
 * `gh issue create` verbatim; do not reimplement its flags). Fail-closed field
 * gates run BEFORE any gh call (#1009 + #1137 + #1583): exactly ONE `source:*`
 * provenance label (see SOURCE_LABELS), exactly ONE kind label (see
 * KIND_LABELS), exactly ONE `track:*` product-axis label (see TRACK_LABELS),
 * and a milestone. The org Issue Type is auto-derived from the
 * kind label (bug→Bug, feature→Feature, else Task) and the assignee defaults to
 * `@me` — both overridable via explicit `--type` / `--assignee`:
 *   node tools/gh/create-issue.mjs --title "<t>" --body-file <f> --label source:agent --label tooling --label track:platform --milestone "Platform ops & hardening" [--label <l> …] [gh flags…]
 *   node tools/gh/create-issue.mjs --no-todo  --title "<t>" --body-file <f> …    # add to board, leave Status unset
 *   pnpm issue:create --title "<t>" --body-file <f> --label source:agent --label tooling --label track:platform -m "Platform ops & hardening"   # alias
 *
 * Control flags (consumed here, NOT forwarded to gh) — put them BEFORE the gh
 * passthrough; a passthrough VALUE equal to a control flag would be consumed too:
 *   --no-todo     add the Issue to the board but do not set Status=Todo.
 *   --parent <N>  file the Issue as a sub-issue of Issue #N (#1729): the parent's
 *                 milestone is INHERITED when the caller passes no --milestone,
 *                 a passed milestone that differs from the parent's is rejected,
 *                 and the sub-issue link is made after creation via the REST
 *                 `sub_issues` endpoint (no manual follow-up step).
 *
 * Roadmap taxonomy gates (#1729, spec §7.1 of
 * `2026-05-21-dsp-198-github-projects-v2-board-design.md`), all fail-closed
 * BEFORE any gh call:
 *   • a `kind:ears-handler` Issue REQUIRES --parent — an EARS task inherits its
 *     feature's release milestone and is meaningless without that parent;
 *   • an `epic: …` title needs NO milestone and REJECTS one — an epic container
 *     spans releases, so homing it on a single milestone is a taxonomy error;
 *   • every other Issue keeps the standing milestone requirement (#1137).
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

import {
  EARS_KIND_LABEL,
  isEpicTitle,
} from "./lib/roadmap-taxonomy.mjs";

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
 * `--parent <N>` / `--parent=<N>` is consumed here and NEVER forwarded (gh
 * issue create has no such flag); `parentError` carries a malformed value so the
 * caller can fail closed before any gh call.
 * @param {string[]} argv
 * @returns {{ setTodo: boolean, parent: number|null, parentError: string|null, passthrough: string[] }}
 */
export function partitionArgs(argv) {
  const passthrough = [];
  let setTodo = true;
  let parentRaw = null;
  const list = argv ?? [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a === "--no-todo") {
      setTodo = false;
      continue;
    }
    if (a === "--parent") {
      parentRaw = list[i + 1] ?? "";
      i++;
      continue;
    }
    if (a.startsWith("--parent=")) {
      parentRaw = a.slice("--parent=".length);
      continue;
    }
    passthrough.push(a);
  }
  if (parentRaw === null) return { setTodo, parent: null, parentError: null, passthrough };
  const parent = Number(String(parentRaw).replace(/^#/, ""));
  if (!Number.isInteger(parent) || parent <= 0)
    return {
      setTodo,
      parent: null,
      parentError: `--parent expects a positive Issue number, got "${parentRaw}".`,
      passthrough,
    };
  return { setTodo, parent, parentError: null, passthrough };
}

/**
 * The `--title` / `-t` value in the gh passthrough (the roadmap taxonomy is
 * title-shaped: `epic: …`, `gate: …`, `[Академия][NNN] …`). Empty string when
 * absent — gh itself gates a genuinely missing title.
 * @param {string[]} args
 * @returns {string}
 */
export function titleValue(args) {
  const list = args ?? [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a === "--title" || a === "-t") return list[i + 1] ?? "";
    if (a.startsWith("--title=")) return a.slice("--title=".length);
  }
  return "";
}

/**
 * The `--milestone` / `-m` value in the gh passthrough, or null when absent —
 * needed to diff a caller-passed milestone against the parent's (#1729).
 * @param {string[]} args
 * @returns {string|null}
 */
export function milestoneValue(args) {
  const list = args ?? [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a === "--milestone" || a === "-m") return list[i + 1] ?? "";
    if (a.startsWith("--milestone=")) return a.slice("--milestone=".length);
    if (a.startsWith("-m") && a.length > 2) return a.slice(2);
  }
  return null;
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

/** The kind-label taxonomy (#1137) — every new Issue carries exactly one. */
export const KIND_LABELS = [
  "bug",
  "feature",
  "chore",
  "refactor",
  "docs",
  "tooling",
];

/**
 * The track-label taxonomy (#1583) — the permanent product-axis every new Issue
 * carries exactly one of. `track:academy` = academy.doctor.school surfaces
 * (specs 012–016); `track:doctor` = the doctor showcase site `apps/doctor`
 * (specs 017–021); `track:platform` = shared backend/infra/process/both-sites.
 */
export const TRACK_LABELS = ["track:academy", "track:doctor", "track:platform"];

/**
 * Collect every `--label` value out of the gh passthrough, across the forms gh
 * accepts: `--label v`, `--label=v`, `-l v`, and comma-separated lists
 * (`--label a,b`). Shared by the source-, kind- and track-label gates (#1583) —
 * one parser, never duplicated.
 * @param {string[]} args
 * @returns {string[]}
 */
export function collectLabels(args) {
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
      if (label) values.push(label);
    }
  }
  return values;
}

/**
 * Collect every `source:*` label value out of the gh passthrough (#1009).
 * @param {string[]} args
 * @returns {string[]}
 */
export function collectSourceLabels(args) {
  return collectLabels(args).filter((l) => l.startsWith("source:"));
}

/**
 * Collect every kind label out of the gh passthrough (#1137) — the values in
 * KIND_LABELS. Non-kind labels (`source:*`, `feature:NNN-*`, `agent-ready`, …)
 * are ignored, so an Issue may carry any number of them alongside exactly one kind.
 * @param {string[]} args
 * @returns {string[]}
 */
export function collectKindLabels(args) {
  return collectLabels(args).filter((l) => KIND_LABELS.includes(l));
}

/**
 * Collect every `track:*` label value out of the gh passthrough (#1583).
 * @param {string[]} args
 * @returns {string[]}
 */
export function collectTrackLabels(args) {
  return collectLabels(args).filter((l) => l.startsWith("track:"));
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
 * Validate the kind-label requirement (#1137): exactly ONE kind label, drawn
 * from KIND_LABELS. Extra non-kind labels are fine. Returns null when valid,
 * else the error message to die with.
 * @param {string[]} args  the gh passthrough
 * @returns {string|null}
 */
export function kindLabelError(args) {
  const taxonomy = KIND_LABELS.join(" | ");
  const found = collectKindLabels(args);
  if (found.length === 0)
    return (
      `every new Issue needs exactly ONE kind label — pass ` +
      `--label <kind>, one of: ${taxonomy}.`
    );
  if (found.length > 1)
    return `exactly ONE kind label is allowed, got: ${found.join(", ")} (taxonomy: ${taxonomy}).`;
  return null;
}

/**
 * Validate the track-label requirement (#1583): exactly ONE `track:*` label,
 * drawn from TRACK_LABELS. The track is the permanent product axis (academy ↔
 * doctor showcase ↔ shared platform); the milestone is the track release and
 * the epic Issue is a closable container — a track never gets an evergreen
 * epic. Returns null when valid, else the error message to die with.
 * @param {string[]} args  the gh passthrough
 * @returns {string|null}
 */
export function trackLabelError(args) {
  const taxonomy = TRACK_LABELS.join(" | ");
  const found = collectTrackLabels(args);
  if (found.length === 0)
    return (
      `every new Issue needs exactly ONE track label — pass ` +
      `--label <track>, one of: ${taxonomy}.`
    );
  if (found.length > 1)
    return `exactly ONE track:* label is allowed, got: ${found.join(", ")} (taxonomy: ${taxonomy}).`;
  if (!TRACK_LABELS.includes(found[0]))
    return `unknown track label "${found[0]}" — must be one of: ${taxonomy}.`;
  return null;
}

/**
 * Detect a milestone flag (`--milestone` / `--milestone=` / `-m`) in the gh
 * passthrough (#1137). Every new Issue is homed under its track release
 * milestone; «Platform ops & hardening» is the standing fallback.
 * @param {string[]} args
 * @returns {boolean}
 */
export function hasMilestone(args) {
  return (args ?? []).some(
    (a) =>
      a === "--milestone" || a.startsWith("--milestone=") || a.startsWith("-m"),
  );
}

/** The standing fallback milestone for ops/process Issues (#1137). */
export const FALLBACK_MILESTONE = "Platform ops & hardening";

/**
 * The milestone-requirement error (#1137 + #1729). Returns null when a
 * milestone flag is present, else the message to die with (names the standing
 * fallback). Two taxonomy exemptions (spec §7.1): an `epic: …` container spans
 * releases and carries NO milestone, and a `--parent`ed sub-issue INHERITS the
 * parent's milestone.
 * @param {string[]} args  the gh passthrough
 * @param {{ parent?: number|null }} [opts]
 * @returns {string|null}
 */
export function milestoneError(args, { parent = null } = {}) {
  if (hasMilestone(args)) return null;
  if (isEpicTitle(titleValue(args))) return null;
  if (parent != null) return null;
  return (
    `every new Issue needs a milestone — pass --milestone <name>, the ` +
    `track release milestone the Issue ships in; use «${FALLBACK_MILESTONE}» as the ` +
    `standing fallback for ops/process work.`
  );
}

/**
 * An `epic: …` container Issue REJECTS a milestone (#1729, spec §7.1): an epic
 * spans releases, so homing it on one is a taxonomy error the board's Roadmap
 * view would then plot wrongly. Returns null when valid.
 * @param {string[]} args  the gh passthrough
 * @returns {string|null}
 */
export function epicMilestoneError(args) {
  const title = titleValue(args);
  if (!isEpicTitle(title)) return null;
  if (!hasMilestone(args)) return null;
  return (
    `an epic container ("${title}") must NOT carry a milestone — an epic spans ` +
    `releases (spec §7.1). Drop --milestone; its child features carry the ` +
    `track release milestones.`
  );
}

/**
 * A `kind:ears-handler` Issue REQUIRES `--parent <N>` (#1729, spec §7.1): an
 * EARS task inherits its feature Issue's release milestone, so it cannot be
 * filed standalone. Returns null when valid.
 * @param {string[]} args  the gh passthrough
 * @param {number|null} parent
 * @returns {string|null}
 */
export function earsParentError(args, parent) {
  if (!collectLabels(args).includes(EARS_KIND_LABEL)) return null;
  if (parent != null) return null;
  return (
    `a \`${EARS_KIND_LABEL}\` Issue needs --parent <N> — an EARS task inherits ` +
    `its feature Issue's release milestone (spec §7.1). File the feature Issue ` +
    `first, then pass --parent <feature Issue number>.`
  );
}

/**
 * The parent/child milestone conflict (#1729): when the caller passed a
 * milestone AND a `--parent`, the two must name the same milestone — a child
 * shipping in a different release than its parent is a taxonomy error, not a
 * silent override. Returns null when valid.
 * @param {string|null} passed        the caller's --milestone value
 * @param {string|null} parentMilestone
 * @param {number} parentNumber
 * @returns {string|null}
 */
export function milestoneConflictError(passed, parentMilestone, parentNumber) {
  if (passed == null) return null;
  if (!parentMilestone) return null;
  if (passed === parentMilestone) return null;
  return (
    `--milestone «${passed}» conflicts with parent #${parentNumber}'s milestone ` +
    `«${parentMilestone}» — a sub-issue inherits its parent's release (spec §7.1). ` +
    `Drop --milestone to inherit, or re-home the parent first.`
  );
}

/**
 * The `gh api` argv that links a created Issue as a sub-issue of its parent
 * (#1729) — the REST `sub_issues` endpoint takes the child's DB **id**, not its
 * number. Pure builder so the argv shape is unit-tested without a spawn.
 * @param {number} parentNumber
 * @param {number} childId  the child Issue's REST `id`
 * @returns {string[]}
 */
export function buildSubIssueLinkArgs(parentNumber, childId) {
  return [
    "api",
    "--method",
    "POST",
    `repos/${REPO}/issues/${parentNumber}/sub_issues`,
    "-F",
    `sub_issue_id=${childId}`,
  ];
}

/**
 * Derive the org Issue Type from the single kind label (#1137): `bug`→Bug,
 * `feature`→Feature, everything else→Task.
 * @param {string} kindLabel
 * @returns {"Bug"|"Feature"|"Task"}
 */
export function deriveType(kindLabel) {
  if (kindLabel === "bug") return "Bug";
  if (kindLabel === "feature") return "Feature";
  return "Task";
}

/** Is a `--type` flag already present in the passthrough? */
export function hasTypeFlag(args) {
  return (args ?? []).some((a) => a === "--type" || a.startsWith("--type="));
}

/**
 * Append `--type <derived>` (from the single kind label) when the caller passed
 * no explicit `--type`. An explicit `--type` is never overridden. Returns a new
 * argv array (#1137).
 * @param {string[]} args
 * @returns {string[]}
 */
export function ensureTypeFlag(args) {
  const list = [...(args ?? [])];
  if (hasTypeFlag(list)) return list;
  const kind = collectKindLabels(list)[0];
  if (!kind) return list; // kindLabelError already gates a missing kind upstream
  return [...list, "--type", deriveType(kind)];
}

/** Is an assignee flag (`--assignee` / `--assignee=` / `-a`) already present? */
export function hasAssignee(args) {
  return (args ?? []).some(
    (a) =>
      a === "--assignee" || a.startsWith("--assignee=") || a.startsWith("-a"),
  );
}

/**
 * Append `--assignee @me` when the caller passed no explicit assignee. Returns a
 * new argv array (#1137).
 * @param {string[]} args
 * @returns {string[]}
 */
export function ensureAssigneeFlag(args) {
  const list = [...(args ?? [])];
  if (hasAssignee(list)) return list;
  return [...list, "--assignee", "@me"];
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
      "Usage: node tools/gh/create-issue.mjs [--no-todo] [--parent <N>] --title \"<t>\" --body-file <f> --label <source:*> --label <kind> --label <track:*> --milestone <name> [--label <l> …]\n" +
        "  Thin wrapper over `gh issue create` (flags forwarded verbatim) that also adds the\n" +
        "  new Issue to Projects v2 board #1 (doctor-school), sets Status=Todo, and confirms\n" +
        "  the item via a GraphQL node read. --no-todo adds to the board without setting Status.\n" +
        "  --parent <N> files the Issue as a sub-issue of #N: the parent's milestone is inherited\n" +
        "  when no --milestone is passed, a differing --milestone is rejected, and the sub-issue\n" +
        "  link is made for you (no manual REST follow-up).\n" +
        `  Roadmap taxonomy (#1729, spec §7.1): a \`${EARS_KIND_LABEL}\` Issue REQUIRES --parent;\n` +
        "  an `epic: …` title needs NO milestone and rejects one (an epic spans releases).\n" +
        `  Required (fail-closed, BEFORE any gh call): exactly ONE source label (#1009) — ${SOURCE_LABELS.join(" | ")};\n` +
        `  exactly ONE kind label (#1137) — ${KIND_LABELS.join(" | ")}; exactly ONE track label (#1583) — ${TRACK_LABELS.join(" | ")};\n` +
        `  and a --milestone (fallback «${FALLBACK_MILESTONE}»).\n` +
        "  Issue Type is auto-derived from the kind label; assignee defaults to @me (both overridable via --type/--assignee).\n",
    );
    process.exit(1);
  }

  const { setTodo, parent, parentError, passthrough } = partitionArgs(argv);
  if (parentError) die(parentError);

  // The board is repo-specific, so the repo pin must win. gh honors the LAST
  // --repo, so a passthrough override would silently defeat a leading pin —
  // reject it outright rather than land the Issue in a foreign repo.
  if (hasRepoOverride(passthrough))
    die(
      `--repo/-R is not allowed: this helper is hard-pinned to ${REPO} because the ` +
        `Projects v2 board is repo-specific. Remove it from the arguments.`,
    );

  // Field gates — all run BEFORE any gh call, so no Issue is created on a
  // violation (fail-closed, the #1009 provenance-gate precedent):
  //   • exactly one source:* provenance label (#1009);
  //   • exactly one kind label + a milestone (#1137);
  //   • exactly one track:* product-axis label (#1583).
  const sourceError = sourceLabelError(passthrough);
  if (sourceError) die(sourceError);
  const kindError = kindLabelError(passthrough);
  if (kindError) die(kindError);
  const trackError = trackLabelError(passthrough);
  if (trackError) die(trackError);
  //   • roadmap taxonomy (#1729, spec §7.1): EARS tasks need a parent, epics
  //     reject a milestone, everything else still needs one (a --parent'ed
  //     sub-issue inherits it, resolved below).
  const earsErr = earsParentError(passthrough, parent);
  if (earsErr) die(earsErr);
  const epicErr = epicMilestoneError(passthrough);
  if (epicErr) die(epicErr);
  const milestoneErr = milestoneError(passthrough, { parent });
  if (milestoneErr) die(milestoneErr);

  // Milestone inheritance (#1729): read the parent's milestone once. A passed
  // milestone that differs from the parent's is a taxonomy error (fail closed,
  // BEFORE creating anything); no passed milestone means we inject the parent's.
  let inheritedMilestone = null;
  let parentTitle = null;
  if (parent != null) {
    const parentIssue = gh([
      "issue",
      "view",
      String(parent),
      "--repo",
      REPO,
      "--json",
      "number,title,milestone",
    ]);
    parentTitle = parentIssue?.title ?? null;
    const parentMilestone = parentIssue?.milestone?.title ?? null;
    const passedMilestone = milestoneValue(passthrough);
    const conflict = milestoneConflictError(
      passedMilestone,
      parentMilestone,
      parent,
    );
    if (conflict) die(conflict);
    if (passedMilestone == null) {
      if (!parentMilestone)
        die(
          `parent #${parent} has no milestone, so there is nothing to inherit — ` +
            `home the parent on its track release milestone first (spec §7.1), ` +
            `or pass --milestone explicitly.`,
        );
      inheritedMilestone = parentMilestone;
      process.stdout.write(
        `[create-issue] inheriting milestone «${inheritedMilestone}» from parent #${parent}\n`,
      );
    }
  }

  // Auto-derive the org Issue Type from the kind label and default the assignee
  // to @me when the caller left them off — both overridable via an explicit
  // --type / --assignee, neither of which is ever clobbered (#1137).
  const withMilestone = inheritedMilestone
    ? [...passthrough, "--milestone", inheritedMilestone]
    : passthrough;
  const augmented = ensureAssigneeFlag(ensureTypeFlag(withMilestone));

  // 1. Create the Issue — thin passthrough. Pin --repo AFTER the passthrough so
  //    the returned URL is guaranteed to belong to the board's repo (gh honors
  //    the last --repo; the reject above already blocks a passthrough override,
  //    this is belt-and-suspenders).
  process.stdout.write(`[create-issue] creating Issue…\n`);
  const createOut = gh(["issue", "create", ...augmented, "--repo", REPO], {
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

  // 1b. Link it under its parent (#1729). The REST `sub_issues` endpoint takes
  //     the child's DB id, not its number — resolve it, then POST the link.
  //     A failure here is fatal: a half-filed EARS task with no parent is
  //     exactly the taxonomy drift the gates above exist to prevent, so we die
  //     with the manual reconcile command rather than report a green run.
  let linkedParent = null;
  if (parent != null) {
    const childId = gh([
      "api",
      `repos/${REPO}/issues/${issueNumber}`,
      "--jq",
      ".id",
    ]);
    if (typeof childId !== "number")
      die(
        `could not resolve the DB id of #${issueNumber} for the sub-issue link; ` +
          `reconcile with: gh api --method POST repos/${REPO}/issues/${parent}/sub_issues -F sub_issue_id=<id>`,
      );
    gh(buildSubIssueLinkArgs(parent, childId), { json: false });
    linkedParent = parent;
    process.stdout.write(
      `[create-issue] linked as a sub-issue of #${parent}` +
        (parentTitle ? ` — ${parentTitle}` : "") +
        `\n`,
    );
  }

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
      `  status = ${check.status ?? "(unset)"}\n` +
      (linkedParent != null
        ? `  parent = #${linkedParent}${inheritedMilestone ? ` (milestone «${inheritedMilestone}» inherited)` : ""}\n`
        : ""),
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
