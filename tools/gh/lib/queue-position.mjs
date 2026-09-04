/**
 * tools/gh/lib/queue-position.mjs — queue-position rules for Issue claims (#1855).
 *
 * Why: claims used to be free — any open Issue could be moved to `In Progress`,
 * so work drifted ahead of the release actually being shipped (owner, 2026-09-03:
 * «города — это далеко не первый приоритет, они явно не стоят блокером перед
 * регистрацией юзера и просмотра ближайшего эфира»). The milestone model already
 * encodes the order: one release = one milestone, dated by the owner via `due_on`.
 * This module turns that ordering into a pure, testable predicate shared by the
 * claim guard (`tools/gh/set-board-status.mjs`) and the backlog report
 * (`tools/backlog-triage.ts`) so both speak the same queue.
 *
 * Queue head of a track = the OPEN milestone whose title starts with the track's
 * Russian prefix («Витрина» / «Академия») with the earliest non-null `due_on`;
 * undated milestones sort after every dated one, and a «· Позже» backlog
 * milestone is never the head.
 *
 * The guard FAILS OPEN on missing data (#1857): a claim is refused only when a
 * head could actually be computed and differs from the Issue's milestone. No
 * milestones (empty payload, `gh` failure, a track with no open release) ⇒
 * `no-queue-data`, allowed with a WARN.
 *
 * Pure only — no `gh`, no I/O. Unit-tested in
 * tools/lint/guard-tests/set-board-status.spec.ts.
 *
 * Canon: .claude/rules/repo-conventions.md → Issue conventions,
 * apps/docs/content/skills/run-task-lifecycle/SKILL.md §1.
 */
import {
  FALLBACK_MILESTONE,
  TRACK_MILESTONE_PREFIXES,
  isEpicTitle,
  milestoneTrack,
} from "./roadmap-taxonomy.mjs";

/**
 * The one-line question a claim has to answer out loud before it is taken.
 *
 * STALENESS (recorded, #1857): this is the R1 question — it names registration
 * and the nearest broadcast because that is what «Витрина R1 — MVP витрины»
 * gates. It is a CONSTANT, not derived from the current head milestone's `gate:`
 * Issue, because this module is pure by contract (no `gh`, no I/O) and deriving
 * it would put a network read on every claim. When the queue head rolls to R2
 * the sentence has to be rewritten by hand. Tracked as a `DEBT.md` line
 * (2026-09-04, #1857) rather than an Issue: nothing is blocked and the wrong
 * sentence would be advisory prose in a refusal message, never a wrong gate.
 */
export const LITMUS_LINE = "блокирует ли это регистрацию врача и просмотр ближайшего эфира?";

/** Marker of a per-track backlog milestone («<Трек> · Позже») — never a queue head. */
export const LATER_MILESTONE_MARKER = "· Позже";

/** The override flag that lets a claim jump the queue with a verbatim owner quote. */
export const AHEAD_OF_QUEUE_FLAG = "--ahead-of-queue";

/** Every track label the milestone model knows about. */
export const TRACK_LABELS = Object.freeze([
  "track:academy",
  "track:doctor",
  "track:platform",
]);

/** Normalise a labels array of strings or `{name}` objects into trimmed strings. */
function labelNames(labels) {
  if (!Array.isArray(labels)) return [];
  return labels
    .map((l) => (typeof l === "string" ? l : typeof l?.name === "string" ? l.name : ""))
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * The `track:*` label an Issue carries; null when it carries none.
 * Convention allows exactly one — with several, the first in `TRACK_LABELS`
 * order wins so the result is deterministic rather than array-order dependent.
 * @param {Array<string|{name?:string}>} labels
 * @returns {string|null}
 */
export function trackOf(labels) {
  const names = new Set(labelNames(labels));
  for (const track of TRACK_LABELS) if (names.has(track)) return track;
  return null;
}

/** Is this milestone a per-track backlog («… · Позже»)? */
export function isLaterMilestone(milestoneTitle) {
  return typeof milestoneTitle === "string" && milestoneTitle.includes(LATER_MILESTONE_MARKER);
}

/**
 * The queue head of a track: the open, dated, non-«· Позже» release milestone
 * with the earliest `due_on`. Undated milestones are considered only when no
 * dated one exists, and tie-break by title so the result is stable.
 * @param {string|null} track — a `track:*` label
 * @param {Array<{title?:string, due_on?:string|null, state?:string}>} milestones
 * @returns {string|null} the milestone title, or null when the track has no queue
 */
export function queueHead(track, milestones) {
  const prefix = TRACK_MILESTONE_PREFIXES[track];
  if (!prefix || !Array.isArray(milestones)) return null;

  const candidates = milestones.filter(
    (m) =>
      typeof m?.title === "string" &&
      m.title.startsWith(prefix) &&
      (m.state ?? "open") === "open" &&
      !isLaterMilestone(m.title),
  );
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const aDate = a.due_on ?? null;
    const bDate = b.due_on ?? null;
    if (aDate && bDate) return aDate < bDate ? -1 : aDate > bDate ? 1 : a.title.localeCompare(b.title);
    if (aDate) return -1; // dated before undated
    if (bDate) return 1;
    return a.title.localeCompare(b.title);
  });
  return candidates[0].title;
}

/**
 * Where an Issue sits relative to its track's queue.
 *
 * Allowed without the override flag:
 *  - `queue-head`    — the Issue's milestone IS its track's queue head;
 *  - `platform-ops`  — the non-roadmap «Platform ops & hardening» milestone;
 *  - `platform-track`— a `track:platform` Issue outside any track release milestone;
 *  - `epic`          — an `epic:` container, which carries no milestone;
 *  - `no-queue-data` — no queue head could be COMPUTED for the relevant track
 *    (an empty/failed milestones payload, or a track with no open dated release
 *    milestone). The guard fails OPEN here (#1857): absent data is not evidence
 *    that the Issue jumps the queue, and refusing every milestoned Issue on a
 *    transient `gh` failure would leave the override quote as the only escape.
 * Anything else is `ahead-of-queue` — which now requires a head that EXISTS and
 * differs from the Issue's milestone.
 *
 * A `track:platform` Issue that DOES sit in a track release milestone (the
 * convention «platform work takes the milestone of the release it blocks»)
 * follows the milestone rule, not the track exemption.
 *
 * @param {{track?:string|null, milestone?:string|null, title?:string}} issue
 * @param {Array<{title?:string, due_on?:string|null, state?:string}>} milestones
 * @returns {{ok:boolean, reason:"queue-head"|"platform-ops"|"platform-track"|"epic"|"no-queue-data"|"ahead-of-queue", head:string|null}}
 */
export function queuePosition(issue, milestones) {
  const track = issue?.track ?? null;
  const milestone = typeof issue?.milestone === "string" ? issue.milestone.trim() : "";
  const title = issue?.title ?? "";

  if (milestone === FALLBACK_MILESTONE)
    return { ok: true, reason: "platform-ops", head: queueHead(track, milestones) };

  const releaseTrack = milestoneTrack(milestone);
  if (releaseTrack) {
    const head = queueHead(releaseTrack, milestones);
    if (!head) return { ok: true, reason: "no-queue-data", head: null };
    return milestone === head
      ? { ok: true, reason: "queue-head", head }
      : { ok: false, reason: "ahead-of-queue", head };
  }

  if (!milestone && isEpicTitle(title))
    return { ok: true, reason: "epic", head: queueHead(track, milestones) };

  if (track === "track:platform") return { ok: true, reason: "platform-track", head: null };

  const head = queueHead(track, milestones);
  return head
    ? { ok: false, reason: "ahead-of-queue", head }
    : { ok: true, reason: "no-queue-data", head: null };
}

/**
 * Parse the `--ahead-of-queue "<verbatim owner quote>"` override out of the
 * trailing argv. Both `--ahead-of-queue <quote>` and `--ahead-of-queue=<quote>`
 * are accepted; the quote is mandatory and must be non-empty.
 * @param {string[]} rest — argv after `<issue#> <status>`
 * @returns {{present:boolean, quote:string|null, error:string|null}}
 */
export function parseAheadOfQueue(rest) {
  const argv = Array.isArray(rest) ? rest : [];
  const none = { present: false, quote: null, error: null };
  if (argv.length === 0) return none;

  const [first, ...tail] = argv;
  if (typeof first !== "string" || !first.startsWith(AHEAD_OF_QUEUE_FLAG))
    return { present: false, quote: null, error: `unknown argument "${first}"` };

  let quote;
  if (first.startsWith(`${AHEAD_OF_QUEUE_FLAG}=`)) {
    if (tail.length > 0)
      return { present: true, quote: null, error: `unexpected extra argument "${tail[0]}"` };
    quote = first.slice(AHEAD_OF_QUEUE_FLAG.length + 1);
  } else if (first === AHEAD_OF_QUEUE_FLAG) {
    if (tail.length !== 1)
      return {
        present: true,
        quote: null,
        error: `${AHEAD_OF_QUEUE_FLAG} needs exactly one argument: the verbatim owner quote`,
      };
    quote = tail[0];
  } else {
    return { present: false, quote: null, error: `unknown argument "${first}"` };
  }

  quote = typeof quote === "string" ? quote.trim() : "";
  if (!quote)
    return {
      present: true,
      quote: null,
      error: `${AHEAD_OF_QUEUE_FLAG} needs a non-empty verbatim owner quote`,
    };
  return { present: true, quote, error: null };
}

/**
 * The refusal message printed on exit 3 — names the Issue milestone, the queue
 * head, the litmus question and the override flag.
 */
export function formatQueueRefusal(issueNumber, position, milestone) {
  return (
    `refusing to claim #${issueNumber}: it is AHEAD OF QUEUE.\n` +
    `  issue milestone = ${milestone || "(none)"}\n` +
    `  queue head      = ${position.head ?? "(no dated open release milestone for this track)"}\n` +
    `  litmus          = ${LITMUS_LINE}\n` +
    `  override        = re-run with ${AHEAD_OF_QUEUE_FLAG} "<verbatim owner quote>" ` +
    `(the quote is posted as the claim comment).`
  );
}
