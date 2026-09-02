#!/usr/bin/env node
/**
 * tools/gh/roadmap-forecast.mjs — `pnpm roadmap:forecast` (#1729, Stage 3).
 *
 * WHAT IT DOES
 * Recomputes the roadmap Target date of every open track-release milestone
 * («Академия R…», «Витрина R…») from measured throughput, and writes the answer
 * to the two places the board design names:
 *
 *   1. the board «Target date» field of every date-carrying Issue of the
 *      milestone (features + the release gate — `ownsBoardDates` in
 *      `lib/roadmap-taxonomy.mjs`), and
 *   2. ONE comment per run on the milestone's release-gate Issue. Comments are
 *      appended, never edited: the comment history IS the forecast audit trail.
 *
 * «Start date» is NEVER touched by this script — it records when work actually
 * began and only a human sets it.
 *
 * THE RULE (spec §3.2 «Date semantics» + §7.1 «Forecast rule»)
 *
 *   throughput = closed `kind:ears-handler` Issues carrying the milestone's
 *                track label in the trailing WINDOW_DAYS (28) days
 *   remaining  = open `kind:ears-handler` Issues in the milestone
 *   days       = ceil(remaining × WINDOW_DAYS / throughput)     [calendar days]
 *   Target     = today + days
 *
 * Throughput 0, or a milestone with no EARS children at all (e.g. «Академия R2»
 * until its epic is decomposed) → the Target is UNDEFINED: nothing is written
 * and the comment says so. We never divide by zero into a date.
 *
 * OWNER OVERRIDE
 * An Issue whose body carries the line `Target date: owner-set` (anywhere in the
 * body) is skipped — its board date is the owner's, not ours — and listed in the
 * comment under «owner-set».
 *
 * NO GATE ISSUE
 * A release milestone with no gate Issue yet (resolved by milestone + title
 * prefix `gate:` or the legacy `Release N gate:`) still gets its feature Target
 * dates written; the comment is skipped with a WARN.
 *
 * USAGE
 *   pnpm roadmap:forecast [--dry-run] [--today YYYY-MM-DD]
 *
 * Every `gh` call goes through an explicit argv array (never a shell string).
 * All the math/formatting below the CLI is pure and unit-tested in
 * `roadmap-forecast.test.mjs`; the process only touches the network in `main()`.
 */

import { spawnSync } from "node:child_process";

import {
  OWNER,
  PROJECT_NUMBER,
  REPO,
  buildBoardItemsPageQuery,
  ghGraphqlResult,
  parseBoardItemsPage,
} from "./lib/projects-v2.mjs";
import {
  EARS_KIND_LABEL,
  RELEASE_GATE_TITLE_PREFIX,
  TARGET_DATE_FIELD,
  TRACK_MILESTONE_PREFIXES,
  classifyIssueTaxonomy,
  isReleaseGateTitle,
  ownsBoardDates,
} from "./lib/roadmap-taxonomy.mjs";

const GH_MAX_BUFFER = 64 * 1024 * 1024;

/** The trailing throughput window, in days (spec §7.1: «trailing 4 weeks»). */
export const WINDOW_DAYS = 28;

const HELP = `pnpm roadmap:forecast [--dry-run] [--today YYYY-MM-DD]

Recompute the roadmap Target date of every open track-release milestone from
the trailing ${WINDOW_DAYS}-day EARS throughput, write it to the board «${TARGET_DATE_FIELD}»
field of the milestone's features + release gate, and append one forecast
comment to the gate Issue.

  --dry-run           print the plan; write no comment and no board field
  --today YYYY-MM-DD  pin "today" (deterministic runs; default: the system date)
  -h, --help          this text

Issues whose body carries the line "Target date: owner-set" are never written.
"Start date" is never written.`;

// ── Pure helpers (no I/O — unit-tested directly) ─────────────────────────────

/**
 * Parse argv into options, or an error string the caller fails closed on.
 * @param {string[]} argv
 * @returns {{help:boolean, dryRun:boolean, today:string|null, error:string|null}}
 */
export function parseArgs(argv) {
  const out = { help: false, dryRun: false, today: null, error: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") out.help = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--today" || a.startsWith("--today=")) {
      const value = a.startsWith("--today=") ? a.slice("--today=".length) : argv[++i];
      if (!isIsoDate(value)) {
        out.error = `--today expects a YYYY-MM-DD date, got ${value ?? "(nothing)"}`;
        return out;
      }
      out.today = value;
    } else {
      out.error = `unknown argument: ${a}`;
      return out;
    }
  }
  return out;
}

/** Is this a plain `YYYY-MM-DD` calendar date? */
export function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value;
}

/** `YYYY-MM-DD` + n calendar days, as `YYYY-MM-DD` (UTC, no DST surprises). */
export function addDays(isoDate, days) {
  const t = Date.parse(`${isoDate}T00:00:00Z`);
  return new Date(t + days * 86400000).toISOString().slice(0, 10);
}

/**
 * The trailing throughput window ending on `today` (inclusive of both ends):
 * `since` is `today - (windowDays - 1)` so exactly `windowDays` days are counted.
 * @returns {{since:string, until:string}}
 */
export function throughputWindow(today, windowDays = WINDOW_DAYS) {
  return { since: addDays(today, -(windowDays - 1)), until: today };
}

/** Does `closedAt` (an ISO timestamp) fall inside the window? */
export function inWindow(closedAt, { since, until }) {
  if (typeof closedAt !== "string" || closedAt.length < 10) return false;
  const day = closedAt.slice(0, 10);
  return day >= since && day <= until;
}

/**
 * Days until the milestone drains, or null when the forecast is UNDEFINED
 * (no throughput, or nothing left to do → no meaningful date to publish).
 * @param {{remaining:number, throughput:number, windowDays?:number}} input
 * @returns {number|null}
 */
export function forecastDays({ remaining, throughput, windowDays = WINDOW_DAYS }) {
  if (!Number.isFinite(remaining) || remaining <= 0) return null;
  if (!Number.isFinite(throughput) || throughput <= 0) return null;
  return Math.ceil((remaining * windowDays) / throughput);
}

/**
 * The full forecast for one milestone: `{days, targetDate, undefinedReason}`.
 * `targetDate` is null exactly when the forecast is undefined.
 */
export function forecastFor({ today, remaining, throughput, windowDays = WINDOW_DAYS }) {
  const days = forecastDays({ remaining, throughput, windowDays });
  if (days == null) {
    const undefinedReason =
      remaining <= 0
        ? "no open EARS children — nothing to forecast"
        : `zero EARS throughput in the trailing ${windowDays} days`;
    return { days: null, targetDate: null, undefinedReason };
  }
  return { days, targetDate: addDays(today, days), undefinedReason: null };
}

/** The owner-override marker: one body line reading `Target date: owner-set`. */
export const OWNER_OVERRIDE_MARKER = "Target date: owner-set";

/** Does this Issue body claim the owner set the Target date by hand? */
export function hasOwnerOverride(body) {
  if (typeof body !== "string") return false;
  return body.split(/\r?\n/).some((line) => line.trim().toLowerCase() === OWNER_OVERRIDE_MARKER.toLowerCase());
}

/**
 * Is this the release-gate Issue of a milestone? The canonical shape is the
 * `gate: <milestone>` prefix (#1730); the legacy `Release N gate: …` titles are
 * still live, so both resolve — never by Issue number.
 */
export function isGateTitle(title) {
  if (isReleaseGateTitle(title)) return true;
  return /^\s*release\s+\d+\s+gate\s*:/i.test(typeof title === "string" ? title : "");
}

/**
 * Is this milestone a track release («Академия R1 — …», «Витрина R2 — …»)?
 * Returns its track label, or null for dateless «· Позже» buckets, the
 * «Platform ops & hardening» fallback and anything else.
 */
export function releaseMilestoneTrack(milestoneTitle) {
  const title = typeof milestoneTitle === "string" ? milestoneTitle.trim() : "";
  for (const [track, prefix] of Object.entries(TRACK_MILESTONE_PREFIXES)) {
    if (new RegExp(`^${prefix}\\s+R\\d+\\b`).test(title)) return track;
  }
  return null;
}

/**
 * The Issues of a milestone whose board Target date this script owns, split
 * into `writes` (we set the date) and `ownerSet` (skipped — owner override).
 * @param {{number:number,title:string,body?:string,labels?:string[]}[]} issues
 */
export function partitionDateTargets(issues) {
  const writes = [];
  const ownerSet = [];
  for (const issue of Array.isArray(issues) ? issues : []) {
    const kind = classifyIssueTaxonomy(issue);
    if (!ownsBoardDates(kind) && !isGateTitle(issue?.title)) continue;
    (hasOwnerOverride(issue?.body) ? ownerSet : writes).push({
      number: issue.number,
      title: issue.title,
    });
  }
  return { writes, ownerSet };
}

/**
 * Render the forecast comment body (English; milestone names quoted verbatim).
 * One comment per run — the gate Issue's comment history is the audit trail.
 */
export function renderForecastComment(f) {
  const lines = [];
  lines.push(`### Roadmap forecast — ${f.today}`);
  lines.push("");
  lines.push(`Milestone: «${f.milestone}» (${f.track})`);
  lines.push(
    `Throughput: ${f.throughput} closed \`${EARS_KIND_LABEL}\` Issues in the trailing ${f.windowDays} days (${f.since} … ${f.until}).`,
  );
  lines.push(`Remaining: ${f.remaining} open EARS ${f.remaining === 1 ? "child" : "children"}.`);
  lines.push("");
  if (f.targetDate == null) {
    lines.push(`**Target date: undefined** — ${f.undefinedReason}. No board date was written.`);
  } else {
    lines.push(`**Target date: ${f.targetDate}** (${f.days} calendar days from ${f.today}).`);
    lines.push("");
    lines.push(
      f.writes.length
        ? `Written to the board «${TARGET_DATE_FIELD}» field of: ${f.writes.map((i) => `#${i.number}`).join(", ")}.`
        : `No board «${TARGET_DATE_FIELD}» field was written (no date-carrying Issue in this milestone).`,
    );
  }
  if (f.ownerSet?.length) {
    lines.push("");
    lines.push(
      `owner-set (skipped, body carries \`${OWNER_OVERRIDE_MARKER}\`): ${f.ownerSet.map((i) => `#${i.number}`).join(", ")}.`,
    );
  }
  lines.push("");
  lines.push(`<sub>Generated by \`pnpm roadmap:forecast\` — «Start date» is never written by this script.</sub>`);
  return lines.join("\n");
}

/** Render the one-line-per-milestone plan the CLI prints (dry-run and live). */
export function renderPlanLine(f) {
  const head = `«${f.milestone}» ${f.remaining} open / ${f.throughput} closed per ${f.windowDays}d`;
  if (f.targetDate == null) return `  ${head} → Target UNDEFINED (${f.undefinedReason})`;
  const targets = [...f.writes.map((i) => `#${i.number}`)].join(",") || "none";
  return `  ${head} → Target ${f.targetDate} (+${f.days}d) → ${targets}`;
}

/** The `updateProjectV2ItemFieldValue` mutation for a date field. */
export function buildDateMutation(projectId, itemId, fieldId, date) {
  for (const [name, value] of Object.entries({ projectId, itemId, fieldId })) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_=-]+$/.test(value))
      throw new Error(`unsafe ${name} for the GraphQL mutation: ${value}`);
  }
  if (!isIsoDate(date)) throw new Error(`unsafe date for the GraphQL mutation: ${date}`);
  return (
    `mutation{updateProjectV2ItemFieldValue(input:{projectId:"${projectId}",` +
    `itemId:"${itemId}",fieldId:"${fieldId}",value:{date:"${date}"}}){` +
    `projectV2Item{id}}}`
  );
}

/** The project id + «Target date» field id resolution query. */
export function buildTargetFieldQuery() {
  return (
    `query{organization(login:"${OWNER}"){projectV2(number:${PROJECT_NUMBER}){id ` +
    `field(name:"${TARGET_DATE_FIELD}"){... on ProjectV2FieldCommon{id name}}}}}`
  );
}

// ── I/O ──────────────────────────────────────────────────────────────────────

function die(msg) {
  console.error(`[roadmap:forecast] ${msg}`);
  process.exit(1);
}

function warn(msg) {
  console.error(`[roadmap:forecast] WARN: ${msg}`);
}

/** Run `gh` with an explicit argv array; die on failure. */
function gh(args, { json = true } = {}) {
  const res = spawnSync("gh", args, { encoding: "utf8", maxBuffer: GH_MAX_BUFFER });
  if (res.error)
    die(`failed to spawn gh: ${res.error.message} (is the gh CLI installed + on PATH?)`);
  if (res.status !== 0)
    die(`gh ${args.join(" ")} exited ${res.status}: ${(res.stderr ?? "").trim()}`);
  if (!json) return res.stdout;
  try {
    return JSON.parse(res.stdout);
  } catch {
    die(`could not parse gh JSON output for: gh ${args.join(" ")}`);
  }
}

function ghGraphql(query) {
  const res = ghGraphqlResult(query);
  if (!res.ok) die(res.error);
  return res.data;
}

/** Every open milestone of the repo. */
function openMilestones() {
  return gh([
    "api",
    "--paginate",
    `repos/${OWNER}/${REPO}/milestones?state=open&per_page=100`,
  ]);
}

/** Open Issues of a milestone, with the fields the taxonomy + override need. */
function milestoneIssues(milestoneTitle) {
  return gh([
    "issue",
    "list",
    "--state",
    "open",
    "--milestone",
    milestoneTitle,
    "--limit",
    "300",
    "--json",
    "number,title,body,labels",
  ]).map((i) => ({
    number: i.number,
    title: i.title,
    body: i.body ?? "",
    labels: (i.labels ?? []).map((l) => l.name),
  }));
}

/** Count of open `kind:ears-handler` Issues in the milestone. */
function openEarsCount(milestoneTitle) {
  return gh([
    "issue",
    "list",
    "--state",
    "open",
    "--label",
    EARS_KIND_LABEL,
    "--milestone",
    milestoneTitle,
    "--limit",
    "300",
    "--json",
    "number",
  ]).length;
}

/** Closed `kind:ears-handler` Issues of a track inside the window. */
function trackThroughput(track, window) {
  const rows = gh([
    "issue",
    "list",
    "--state",
    "closed",
    "--label",
    EARS_KIND_LABEL,
    "--label",
    track,
    "--search",
    `closed:>=${window.since}`,
    "--limit",
    "300",
    "--json",
    "number,closedAt",
  ]);
  return rows.filter((r) => inWindow(r.closedAt, window)).length;
}

/** One paginated board sweep → `Map<issueNumber, projectItemId>`. */
function boardItemIds() {
  const map = new Map();
  let after = null;
  for (let page = 0; page < 50; page++) {
    const data = ghGraphql(buildBoardItemsPageQuery(after));
    const parsed = parseBoardItemsPage(data);
    if (!parsed) die("unexpected board-items response shape");
    for (const node of parsed.nodes) {
      const content = node?.content;
      if (content?.__typename === "Issue" && typeof content.number === "number")
        map.set(content.number, node.id);
    }
    if (!parsed.hasNextPage || !parsed.endCursor) return map;
    after = parsed.endCursor;
  }
  die("board pagination did not terminate after 50 pages");
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.error) die(`${opts.error}\n\n${HELP}`);
  if (opts.help) {
    console.log(HELP);
    return;
  }
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const window = throughputWindow(today);
  const mode = opts.dryRun ? "DRY RUN (no writes)" : "LIVE";
  console.log(`[roadmap:forecast] ${mode} — today ${today}, window ${window.since} … ${window.until}`);

  const releases = openMilestones()
    .map((m) => ({ title: m.title, number: m.number, track: releaseMilestoneTrack(m.title) }))
    .filter((m) => m.track);
  if (!releases.length) die("no open track-release milestone found — nothing to forecast");

  const throughputByTrack = new Map();
  const forecasts = [];
  for (const milestone of releases) {
    if (!throughputByTrack.has(milestone.track))
      throughputByTrack.set(milestone.track, trackThroughput(milestone.track, window));
    const throughput = throughputByTrack.get(milestone.track);
    const remaining = openEarsCount(milestone.title);
    const { days, targetDate, undefinedReason } = forecastFor({ today, remaining, throughput });
    const { writes, ownerSet } = partitionDateTargets(milestoneIssues(milestone.title));
    const gate = [...writes, ...ownerSet].find((i) => isGateTitle(i.title)) ?? null;
    forecasts.push({
      milestone: milestone.title,
      track: milestone.track,
      today,
      windowDays: WINDOW_DAYS,
      since: window.since,
      until: window.until,
      remaining,
      throughput,
      days,
      targetDate,
      undefinedReason,
      writes,
      ownerSet,
      gate,
    });
  }

  console.log("");
  for (const f of forecasts) console.log(renderPlanLine(f));
  console.log("");

  const needsWrite = forecasts.some((f) => f.targetDate && f.writes.length);
  let projectId = null;
  let fieldId = null;
  let items = null;
  if (!opts.dryRun && needsWrite) {
    const project = ghGraphql(buildTargetFieldQuery())?.organization?.projectV2;
    projectId = project?.id ?? null;
    fieldId = project?.field?.id ?? null;
    if (!projectId || !fieldId)
      die(`could not resolve project #${PROJECT_NUMBER} or its «${TARGET_DATE_FIELD}» field`);
    items = boardItemIds();
  }

  for (const f of forecasts) {
    if (!f.gate)
      warn(
        `no gate Issue for milestone «${f.milestone}» (expected a title starting «${RELEASE_GATE_TITLE_PREFIX}») — no comment written`,
      );
    if (f.targetDate == null) {
      console.log(`[roadmap:forecast] «${f.milestone}»: Target undefined — ${f.undefinedReason}`);
      continue;
    }
    if (opts.dryRun) continue;
    for (const issue of f.writes) {
      const itemId = items?.get(issue.number);
      if (!itemId) {
        warn(`#${issue.number} is not on project #${PROJECT_NUMBER} — Target date not written`);
        continue;
      }
      ghGraphql(buildDateMutation(projectId, itemId, fieldId, f.targetDate));
      console.log(`[roadmap:forecast] #${issue.number} ${TARGET_DATE_FIELD} = ${f.targetDate}`);
    }
  }

  if (opts.dryRun) {
    console.log("[roadmap:forecast] dry run — no comment and no board field was written.");
    for (const f of forecasts.filter((x) => x.gate)) {
      console.log(`\n--- comment that WOULD be posted on #${f.gate.number} ---`);
      console.log(renderForecastComment(f));
    }
    return;
  }

  for (const f of forecasts) {
    if (!f.gate) continue;
    gh(
      ["issue", "comment", String(f.gate.number), "--body", renderForecastComment(f)],
      { json: false },
    );
    console.log(`[roadmap:forecast] commented on #${f.gate.number} («${f.milestone}»)`);
  }
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("roadmap-forecast.mjs");
if (invokedDirectly) main();
