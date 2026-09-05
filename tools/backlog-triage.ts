#!/usr/bin/env tsx
/**
 * tools/backlog-triage.ts — compute per-Issue readiness from the DEPENDENCY
 * GRAPH, not a label.
 *
 * Driver (#497): readiness/blocked was historically asserted from a label
 * (`agent-ready` present / `decision-debt` = "blocked"), never resolved from the
 * native `blocked_by` graph or the prose "Blocked by …" clauses in the Issue
 * body. AGENTS.md §3.5 forbids trusting the bootstrap rollup; nothing computed
 * the truth. This command does: per open Issue it resolves
 *
 *   1. the native GitHub `blocked_by` graph (REST
 *      `…/issues/{n}/dependencies/blocked_by`) to each blocker's real open/closed
 *      state, AND
 *   2. every prose "Blocked by #N" issue ref (resolved to its live state); every
 *      prose "Blocked by EARS-N …" clause naming same-feature sibling handlers
 *      (resolved to the sibling Issue carrying that `EARS-N` under the same
 *      `feature:NNN-*` label — a CLOSED sibling satisfies the dependency, #622);
 *      and every prose "Blocked by <named subsystem>" clause that names an
 *      owning-subsystem with no tracked Issue — an ABSENT dependency.
 *
 * It prints a ready-vs-blocked split where each blocked item carries its
 * concrete unblocking condition (which dep Issue + verified state, or which
 * absent owning subsystem), and each takeable item that an EARS prose-ref
 * unblocked carries a `prose ref resolved: EARS-N closed as #M` note.
 *
 * Queue grouping (#1855): readiness answers "can this be worked", not "should it
 * be worked NEXT". Takeable rows are therefore grouped by queue position —
 * QUEUE-HEAD (the Issue sits in its track's current release milestone, the open
 * one with the earliest owner-set `due_on`) first, then PLATFORM / EPIC, then
 * AHEAD-OF-QUEUE rows tagged with the head they jump. Grouping is presentation
 * only: readiness stays graph-computed, and an AHEAD-OF-QUEUE row is still listed,
 * never hidden. The same pure rules (`tools/gh/lib/queue-position.mjs`) back the
 * claim guard in `tools/gh/set-board-status.mjs`, which refuses `In Progress` on
 * an AHEAD-OF-QUEUE Issue (exit 3) absent `--ahead-of-queue "<owner quote>"`.
 *
 * `decision-debt` is NOT treated as "blocked" — it is a DEFERRED-decision label;
 * an item is takeable the moment its resolved deps are all closed (AGENTS.md §6,
 * memory `feedback_blocked_is_computed_not_labeled`).
 *
 * PROVENANCE CHECK (#853): a `blocked_by` edge is a TECHNICAL dependency with a
 * recorded rationale (repo-conventions.md → Issue conventions) — a body/comment
 * line on either side naming the other Issue. An edge where NEITHER side
 * mentions the other is a provenance-orphan (the 2026-07-13 shape: ~12 tooling
 * Issues carried rationale-free native `blocked_by → #729` edges encoding
 * "prod first" as a fake critical path). This command flags each such edge with
 * `⚠ no recorded rationale` in the Blocked list, and any node blocking ≥5 open
 * issues gets a per-edge `rationale: present|ABSENT` rollup so an unexplained
 * mega-blocker can never be relayed as ground truth. Read-only — no
 * auto-unwiring (unwiring is an owner decision).
 *
 * PARALLEL-SESSION CLAIM SIGNAL (#811): sessions run concurrently in this repo,
 * and in-flight status used to be guessed in both directions (worktree 713
 * believed live but abandoned; takeable #770 recommended but claimed). For every
 * takeable item this command cross-checks (a) a worktree at
 * `.claude/worktrees/<N>` under the PRIMARY tree and (b) the Issue's latest
 * start/claim comment vs its latest stop-state comment, and reports matching
 * rows as `IN-FLIGHT-ELSEWHERE (worktree|start-comment, age <a>)` instead of
 * takeable. The age is always SURFACED, never auto-suppressed — an abandoned
 * worktree is the human's call. The claim convention (post a one-line claim
 * comment or create the worktree BEFORE the first edit) lives in
 * `.claude/rules/repo-conventions.md` → Issue conventions.
 *
 * GROOMING SECTIONS (#1873) — the deterministic half of a backlog groom; the
 * judgment + owner dialogue half is the catalog skill `groom-backlog`, which
 * runs this command as its step 1. Five sections, each grouped by `track:*`
 * with a one-line `none` when empty, all READ-ONLY (nothing is closed,
 * re-milestoned or re-linked here — those are lead/owner decisions):
 *
 *   - `## Wait for reuse`     — an Issue whose `Reuse:` field names a capability
 *     the PAIRED track is already building (registry row or a claimed Issue with
 *     the same path). Removed from Takeable — AGENTS.md §6 forbids the second
 *     implementation; the matched path is always printed.
 *   - `## Orphans`            — open, no native `blocked_by`, no sub-issue
 *     parent, milestone ≠ the track's queue head (`no-blocker`, `no-parent`,
 *     `off-head (<milestone>)`). Fails open when no head is computable (#1857),
 *     and the whole section degrades to one `skipped` line when the board scan
 *     that carries the sub-issue parent probe failed.
 *   - `## Stalled`            — undelivered work to DRAIN first: `STALE-CLAIM`
 *     (claim older than `--stalled-days`, default 3, with no open PR),
 *     `READY-TO-LAND` (open PR with a head-pinned Mode-a APPROVE + green checks,
 *     unmerged — the #1867 rule, reused from `merge-gate.mjs`), `MERGED-BUT-OPEN`
 *     (a merged PR says `Closes #N`, #N still open).
 *   - `## Likely done`        — an open Issue a MERGED PR claims to DELIVER:
 *     either it closes it (`Closes/Fixes/Resolves #N`) or it carries it as the
 *     Conventional-Commit scope of the PR title (`type(N):` / `type(N-slug):`).
 *     A bare `#N` mention is NOT delivery evidence — merged bodies here are
 *     dense with roadmap/board/dependency refs, and matching them flagged 55%
 *     of the open backlog. `epic:` / `gate:` Issues are excluded (they outlive
 *     every PR that names them). Verify against the diff, then close.
 *   - `## Release rotation`   — per track, open milestones in queue order with
 *     their open counts and the `EMPTY-NEXT` / `ALL-CLOSED-STILL-OPEN` /
 *     `POZHE: n` flags.
 *
 * The pure resolution/classification seams (`parseProseBlockers`, `classify`,
 * `detectClaim`, `findWaitForReuse`, `findOrphans`, `findStalled`,
 * `findLikelyDone`, `releaseRotation`)
 * are exported and unit-tested (tools/lint/guard-tests/backlog-triage.spec.ts)
 * WITHOUT firing the `gh` subprocesses — the `main()` entry point is guarded.
 *
 * Never throws for a per-Issue failure: a graph-query error degrades that one
 * Issue to "unresolved" with a printed warning, never crashes the run.
 */
import { execa } from "execa";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildBoardItemsPageQuery,
  formatBoardTruncation,
  parseBoardItemsPage,
} from "./gh/lib/projects-v2.mjs";
import {
  TRACK_MILESTONE_PREFIXES,
  formatRoadmapHygiene,
  parseIssueBoardNode,
  roadmapHygiene,
} from "./gh/lib/roadmap-taxonomy.mjs";
import {
  LITMUS_LINE,
  isLaterMilestone,
  queueHead,
  queuePosition,
  trackOf,
} from "./gh/lib/queue-position.mjs";
// The single definition of a head-pinned Mode (a) APPROVE (#1867) — reused, not
// re-implemented. `merge-gate.mjs` guards its own entry point, so importing the
// pure classifier fires no `gh` call.
import { classifyModeAVerdict } from "./gh/merge-gate.mjs";
import {
  evaluateMainSync,
  mainSyncFixCommand,
  mainSyncMessage,
  primaryWorktreePath,
  probeMainSync,
  shouldRefuseTriage,
} from "./main-sync";

// ── pure model ──────────────────────────────────────────────────────────────

export type IssueState = "open" | "closed";

/**
 * Provenance verdict for one `blocked_by` edge (#853): `present` — a body or
 * comment on either side mentions the other Issue's number; `absent` — neither
 * side does (a provenance-orphan edge to challenge); `unknown` — a provenance
 * text could not be fetched, so no verdict is asserted (never flagged).
 */
export type Rationale = "present" | "absent" | "unknown";

/** One resolved dependency edge feeding the classifier. */
export interface DepRef {
  source: "native-blocked-by" | "prose";
  /** A referenced GitHub Issue, when the dep names one. */
  number?: number;
  state?: IssueState | "unknown";
  title?: string;
  /** A named owning-subsystem with no tracked Issue (an ABSENT dependency). */
  subsystem?: string;
  /**
   * The EARS handler number this dep was named as in the prose (e.g. "Blocked by
   * EARS-1 …"), when the clause references a same-feature sibling handler rather
   * than a subsystem or an explicit `#N`. Set alongside `number`/`state` once the
   * sibling Issue carrying that `EARS-N` has been resolved to its live state.
   */
  ears?: number;
  /**
   * Provenance verdict for this edge (#853). Prose edges are `present` by
   * construction (the blocked body names the blocker); native edges are
   * computed via `evaluateRationale`. Unset = not evaluated (e.g. subsystem
   * deps) — treated like `unknown`: no orphan marker.
   */
  rationale?: Rationale;
}

export interface IssueInput {
  number: number;
  title: string;
  labels: string[];
}

export type Readiness = "takeable" | "blocked";

// ── stream split (#1009) — presentation grouping, not a readiness change ────

/** Backlog stream: product (owner-facing backlog) vs process (agent/tooling). */
export type Stream = "product" | "process";

const PRODUCT_KIND_LABELS = new Set(["feature", "bug"]);
const PROCESS_KIND_LABELS = new Set(["tooling", "chore", "docs", "refactor"]);

/**
 * Classify an Issue into the product vs process stream from its kind labels
 * (#1009): product = `feature`/`bug` kind label or any `feature:NNN-*` label;
 * process = `tooling`/`chore`/`docs`/`refactor`. An Issue with NO kind label
 * falls into process with `noKindLabel: true` so the report can mark it —
 * no new label is introduced, this reuses the existing kind-label taxonomy.
 */
export function issueStream(labels: string[]): {
  stream: Stream;
  noKindLabel: boolean;
} {
  if (
    labels.some((l) => PRODUCT_KIND_LABELS.has(l) || l.startsWith("feature:"))
  ) {
    return { stream: "product", noKindLabel: false };
  }
  const hasProcess = labels.some((l) => PROCESS_KIND_LABELS.has(l));
  return { stream: "process", noKindLabel: !hasProcess };
}

// ── field hygiene (#1137) — the required-field completeness of an open Issue ──

/** The kind-label taxonomy (#1137) — exactly one per Issue. */
const ALL_KIND_LABELS = new Set([
  ...PRODUCT_KIND_LABELS,
  ...PROCESS_KIND_LABELS,
]);

/** Plain-data input to `missingFields` — probes pre-resolved by the caller. */
export interface FieldHygieneInput {
  number: number;
  labels: string[];
  /** An org Issue Type is set. */
  hasType: boolean;
  /** A milestone is assigned. */
  hasMilestone: boolean;
  /** At least one assignee is set. */
  hasAssignee: boolean;
}

/**
 * The required fields an open Issue is missing (#1137): Type, milestone,
 * assignee, exactly one kind label, exactly one `source:*` label. Returns the
 * missing-field names (empty = compliant). `pnpm issue:create` enforces these
 * at creation; this surfaces pre-gate Issues.
 */
export function missingFields(i: FieldHygieneInput): string[] {
  const missing: string[] = [];
  if (!i.hasType) missing.push("Type");
  if (!i.hasMilestone) missing.push("milestone");
  if (!i.hasAssignee) missing.push("assignee");
  const kinds = i.labels.filter((l) => ALL_KIND_LABELS.has(l));
  if (kinds.length !== 1)
    missing.push(kinds.length === 0 ? "kind-label" : "one-kind-label");
  const sources = i.labels.filter((l) => l.startsWith("source:"));
  if (sources.length !== 1)
    missing.push(sources.length === 0 ? "source-label" : "one-source-label");
  return missing;
}

/**
 * Render the `## Field hygiene` report section (#1137) from per-Issue
 * missing-field rows. Silent (empty string) when every open Issue is compliant.
 */
export function formatFieldHygiene(
  rows: Array<{ number: number; missing: string[] }>,
): string {
  const bad = rows
    .filter((r) => r.missing.length > 0)
    .sort((a, b) => a.number - b.number);
  if (bad.length === 0) return "";
  const out = [
    `## Field hygiene (${bad.length})`,
    "Open issues missing a required field (#1137): Type / milestone / assignee / exactly-one kind label / exactly-one `source:*`. `pnpm issue:create` enforces these at creation; pre-gate Issues surface here.",
  ];
  for (const r of bad) out.push(`- #${r.number}: missing ${r.missing.join(", ")}`);
  return out.join("\n");
}

// ── PR board hygiene (#1140) — dead + under-fielded PR rows on the board ───────

/**
 * One PR item on the Projects v2 board, from the single paginated board scan.
 * `state` is the GraphQL `PullRequest.state` enum (OPEN | CLOSED | MERGED).
 */
export interface PrBoardRow {
  number: number;
  state: string;
  hasAssignee: boolean;
  hasMilestone: boolean;
}

/**
 * One OPEN Issue row from the same board scan, carrying the roadmap-taxonomy
 * fields (#1729). Shape mirrors `roadmap-taxonomy.mjs`'s `RoadmapRow` typedef —
 * declared here so the .ts consumer is typed without depending on JS inference.
 */
export interface RoadmapRow {
  number: number;
  title: string;
  labels: string[];
  milestone: string | null;
  parent: { number: number; milestone: string | null } | null;
  startDate: string | null;
  targetDate: string | null;
}

/** The two PR-board-hygiene findings derived from one board scan (#1140). */
export interface PrBoardHygiene {
  /** Board rows whose PR is MERGED or CLOSED — dead rows that should auto-leave. */
  dead: Array<{ number: number; state: string }>;
  /** OPEN-PR rows missing an assignee and/or a milestone. */
  unfielded: Array<{ number: number; missing: string[] }>;
}

/**
 * Split PR board rows (#1140) into dead rows (MERGED/CLOSED — `pr:land` deletes
 * these on merge, but a closed-without-merge PR or a pre-#1140 merge leaves one
 * behind) and under-fielded OPEN rows (missing assignee and/or milestone — the
 * PR-side mirror of the Issue Field-contract). Pure: board rows in → findings
 * out, no I/O.
 */
export function classifyPrBoardRows(rows: PrBoardRow[]): PrBoardHygiene {
  const dead: PrBoardHygiene["dead"] = [];
  const unfielded: PrBoardHygiene["unfielded"] = [];
  for (const r of rows) {
    const state = (r.state ?? "").toUpperCase();
    if (state === "MERGED" || state === "CLOSED") {
      dead.push({ number: r.number, state });
      continue;
    }
    if (state !== "OPEN") continue;
    const missing: string[] = [];
    if (!r.hasAssignee) missing.push("assignee");
    if (!r.hasMilestone) missing.push("milestone");
    if (missing.length > 0) unfielded.push({ number: r.number, missing });
  }
  dead.sort((a, b) => a.number - b.number);
  unfielded.sort((a, b) => a.number - b.number);
  return { dead, unfielded };
}

/**
 * Render the `## PR board hygiene` section (#1140) from the classified findings.
 * Silent (empty string) when the board carries no dead and no under-fielded PR
 * row — mirrors `formatFieldHygiene`'s silent-when-clean convention.
 */
export function formatPrBoardHygiene(h: PrBoardHygiene): string {
  const total = h.dead.length + h.unfielded.length;
  if (total === 0) return "";
  const out = [
    `## PR board hygiene (${total})`,
    "Projects v2 PR rows needing attention (#1140): a MERGED/CLOSED PR row is dead (`pnpm pr:land` removes it on merge; a closed-without-merge PR is the catch-all here); an OPEN-PR row must carry ≥1 assignee AND a milestone.",
  ];
  if (h.dead.length > 0) {
    out.push(`### Dead rows (${h.dead.length}) — remove from the board`);
    for (const r of h.dead) out.push(`- PR #${r.number}: ${r.state} (dead row)`);
  }
  if (h.unfielded.length > 0) {
    out.push(`### Under-fielded open PRs (${h.unfielded.length})`);
    for (const r of h.unfielded)
      out.push(`- PR #${r.number}: missing ${r.missing.join(", ")}`);
  }
  return out.join("\n");
}

export interface BlockReason {
  kind: "open-issue" | "absent-subsystem";
  number?: number;
  text: string;
  /** Provenance verdict for the underlying edge (#853), when evaluated. */
  rationale?: Rationale;
}

export interface Triage {
  number: number;
  title: string;
  readiness: Readiness;
  reasons: BlockReason[];
  /**
   * Informational annotations for a TAKEABLE item — currently the prose-ref
   * resolutions (`prose ref resolved: EARS-N closed as #M`) that unblocked it.
   */
  notes: string[];
  isDecisionDebt: boolean;
  /** Stream split (#1009): product vs process, derived from kind labels. */
  stream: Stream;
  /** True when the Issue carries NO kind label (marked in the report). */
  noKindLabel: boolean;
  /**
   * Parallel-session claim signal (#811), attached by `main()` for TAKEABLE
   * items only. When set, the report row prints
   * `IN-FLIGHT-ELSEWHERE (worktree|start-comment, age <a>)` instead of takeable.
   */
  claim?: ClaimSignal;
  /**
   * Queue position (#1855), attached by `main()` for TAKEABLE items only.
   * Presentation grouping — readiness stays graph-computed.
   */
  queue?: QueueAnnotation;
}

/** Where a takeable Issue sits relative to its track's release queue (#1855). */
export type QueuePosition =
  | "QUEUE-HEAD"
  | "AHEAD-OF-QUEUE"
  | "PLATFORM"
  | "EPIC";

export interface QueueAnnotation {
  position: QueuePosition;
  /** The track's queue-head milestone, when the track has one. */
  head: string | null;
}

/** A repository milestone as the queue rules consume it. */
export interface MilestoneRecord {
  title: string;
  due_on: string | null;
  state?: string;
}

/**
 * Map a queue-position reason onto the report's position tag (#1855) — pure,
 * so the report can be unit-tested without any `gh` call.
 *
 * Returns `null` when the milestones payload is empty (#1857): the `gh api
 * milestones` read is best-effort and degrades to `[]`, and annotating every
 * takeable row `[AHEAD-OF-QUEUE (head: none)]` on that failure would report a
 * priority verdict the tool did not compute. No data ⇒ no annotation.
 */
export function queueAnnotationFor(
  issue: { title: string; labels: string[]; milestone: string | null },
  milestones: MilestoneRecord[],
): QueueAnnotation | null {
  if (!Array.isArray(milestones) || milestones.length === 0) return null;
  const result = queuePosition(
    {
      track: trackOf(issue.labels),
      milestone: issue.milestone ?? "",
      title: issue.title,
    },
    milestones,
  );
  // A computable-but-headless track is the same non-verdict as an empty payload.
  if (result.reason === "no-queue-data") return null;
  const position: QueuePosition = !result.ok
    ? "AHEAD-OF-QUEUE"
    : result.reason === "epic"
      ? "EPIC"
      : result.reason === "queue-head"
        ? "QUEUE-HEAD"
        : "PLATFORM";
  return { position, head: result.head ?? null };
}

/** Per-track queue heads, for the report's summary lines (#1855). */
export function trackQueueHeads(
  milestones: MilestoneRecord[],
): Array<{ track: string; head: string | null }> {
  return ["track:doctor", "track:academy"].map((track) => ({
    track,
    head: queueHead(track, milestones),
  }));
}

/** A blocker parsed out of the Issue body prose, pre-state-resolution. */
export interface ProseBlocker {
  /** Issue numbers referenced inside the blocker clause. */
  issues: number[];
  /** A named subsystem, when the clause references no Issue. */
  subsystem?: string;
  /**
   * EARS handler numbers named in the clause (e.g. "Blocked by EARS-7 (…) and
   * EARS-1 (…)"). Each resolves against a same-feature sibling Issue carrying
   * that `EARS-N` in its title. When set, `subsystem` (if present) is only the
   * conservative fallback text used for any EARS that resolves to no sibling.
   */
  ears?: number[];
}

/** A same-feature sibling Issue candidate for an EARS prose-ref resolution. */
export interface SiblingIssue {
  number: number;
  title: string;
  state: IssueState;
}

/**
 * Find the sibling Issue carrying `EARS-<ears>` in its title (word-bounded so
 * `EARS-1` never matches `EARS-12`). The caller has already scoped `siblings` to
 * one `feature:NNN-*` label, so a title match is an unambiguous handler hit.
 */
export function findSiblingByEars(
  siblings: SiblingIssue[],
  ears: number,
): SiblingIssue | undefined {
  const re = new RegExp(`\\bEARS-${ears}\\b`);
  return siblings.find((s) => re.test(s.title));
}

/**
 * Does `text` mention Issue `n`? Matches the canonical `#N` ref (digit-bounded,
 * so `#72` never matches inside `#729` and `#729` never matches `#7290`) and
 * the full-URL forms GitHub renders cross-references as
 * (`…/issues/N` / `…/pull/N`).
 */
export function mentionsIssue(text: string, n: number): boolean {
  return new RegExp(`(?:#|/issues/|/pull/)${n}(?!\\d)`).test(text);
}

/**
 * Provenance verdict for one native `blocked_by` edge (#853): the rationale is
 * PRESENT when either side's provenance text (body + comments) mentions the
 * other Issue's number; ABSENT when both texts were fetched and neither does;
 * UNKNOWN when a text could not be fetched (`undefined`) and the fetched side
 * (if any) carries no mention — a missing fetch never asserts an orphan.
 */
export function evaluateRationale(
  blockedNumber: number,
  blockerNumber: number,
  blockedText: string | undefined,
  blockerText: string | undefined,
): Rationale {
  if (blockedText != null && mentionsIssue(blockedText, blockerNumber))
    return "present";
  if (blockerText != null && mentionsIssue(blockerText, blockedNumber))
    return "present";
  if (blockedText == null || blockerText == null) return "unknown";
  return "absent";
}

function truncateTitle(t: string, max = 52): string {
  const s = t.trim();
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/**
 * Clean a prose blocker clause down to a short owning-subsystem NAME: drop the
 * leading list marker, keep only the head phrase before the explanatory dash,
 * strip markdown emphasis, collapse whitespace.
 * `- **ADR-0009 \`retention.ts\` SSOT** — the retention duration …`
 *   → `ADR-0009 retention.ts SSOT`
 */
export function subsystemName(text: string): string {
  let t = text.replace(/^\s*[-*]\s+/, "");
  // The head phrase is everything before the first em/en-dash or " - " gloss …
  t = t.split(/\s+[—–]\s+| - /u)[0] ?? t;
  // … and only the first sentence (a bullet may append "Track alongside …").
  t = t.split(/(?<=\.)\s/u)[0] ?? t;
  t = t.replace(/[*`]/g, "").replace(/\s+/g, " ").trim();
  t = t.replace(/[.,;:]+$/u, "").trim();
  return t;
}

/**
 * Parse the "Blocked by …" clauses out of an Issue body. Two forms:
 *
 *   - SECTION heading `## Blocked by` followed by `-`/`*` bullet items (each
 *     bullet is one blocker), terminated by the next heading.
 *   - INLINE `Blocked by <clause>.` sentence (the clause runs to the first
 *     sentence terminator or end of line).
 *
 * A clause that explicitly declares NO blocker yields NO blocker (so a "landed
 * in #460" mention inside it is never mistaken for a live dep). The recognised
 * empty-blocker marker set — this is the WRITTEN CONTRACT; extend it here, never
 * by rewriting Issue bodies (#1264). After stripping any list marker, `**`
 * emphasis, one leading dash placeholder (`—` / `–` / `-`, with any `:`/`·`
 * separator that follows it), one enclosing parenthesis and trailing `.,;`, the
 * remainder must be either EMPTY or begin (case-insensitively, word-bounded)
 * with one of `none` / `nothing` / `n/a` / `tbd`. That covers every spelling the
 * repo writes:
 *
 *   `—`  ·  `-`  ·  `n/a`  ·  `tbd`  ·  `None currently.`  ·  `Nothing yet.`
 *   `— (none)`  ·  `— (none).`  ·  `— (none technical)`
 *   `— (none known yet; the spec will surface backend dependencies …)`
 *
 * The match is on the NORMALISED clause, not whole-string equality — a qualified
 * tail after the marker word is still an empty marker. It stays word-bounded and
 * anchored at the head so a REAL blocker clause (`#872 — needs ESP`,
 * `ADR-0009 retention.ts SSOT`) never matches: over-matching would silently free
 * genuinely blocked rows, the one failure direction this parser must not have.
 *
 * Only the explicit "Blocked by" surface counts — a "Sub-issue of #N" /
 * "Successor to #N" / "Parent epic: #N" / "Related: #N" reference is hierarchy or
 * lineage, NEVER a blocker, and is deliberately ignored. The `**Blocks:**` half
 * of a combined Dependencies line feeds no graph edge at all: it is cut off
 * before this test (see the `·` / `**Blocks` split below), so its own empty
 * markers are inert by construction.
 */
export function parseProseBlockers(body: string): ProseBlocker[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const items: string[] = [];

  const isHeading = (l: string) => /^\s{0,3}#{1,6}\s/.test(l);
  const isBlockedByHeading = (l: string) =>
    /^\s{0,3}#{1,6}\s+blocked\s+by\b/i.test(l);
  const isBullet = (l: string) => /^\s*[-*]\s+/.test(l);
  // A placeholder bullet/clause that explicitly declares NO blocker — the marker
  // set is the docstring's written contract. Must be skipped in BOTH the
  // section-bullet loop and the inline branch, else the clause survives
  // normalisation, parses to a bogus `{subsystem: "— (none)"}` and falsely
  // reports the Issue blocked (#919 — six takeable Issues mis-reported; #1264 —
  // five more, on the parenthesised/qualified forms). Normalisation peels the
  // decorations off in a fixed order, then the head word is matched.
  const isNoBlockerText = (t: string) => {
    const stripped = t
      .replace(/^\s*(?:[-*]\s+)?/, "") // list marker
      .replace(/^\s*\*\*\s*/, "") // opening emphasis
      .replace(/\s*\*\*\s*$/, "") // closing emphasis
      .trim()
      // ONE leading dash placeholder plus whatever separates it from the word:
      // `— (none)`, `- n/a`, `– tbd`. A dash INSIDE a real clause (`#872 — needs
      // ESP`) is untouched — this is anchored at the head.
      .replace(/^[—–-]+[\s:·]*/u, "")
      // an enclosing parenthesis around the marker: `(none)`, `(none technical)`,
      // `(none known yet; …)`. Stripped by ends, not by balance, so a truncated
      // or `.`-bearing tail still normalises.
      .replace(/^\(\s*/u, "")
      .replace(/\s*\)[.,;]*\s*$/u, "")
      .replace(/[.,;]+\s*$/u, "")
      .trim();
    // Empty ⇒ the bare dash / empty-value placeholder.
    return stripped === "" || /^(?:nothing|none|n\/a|tbd)\b/iu.test(stripped);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // SECTION form: a "## Blocked by" heading → collect the bullet items under it.
    if (isBlockedByHeading(line)) {
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j]!;
        if (isHeading(l)) break; // next section ends the block
        if (isBullet(l) && !isNoBlockerText(l)) items.push(l);
      }
      continue;
    }

    // INLINE form: a non-heading line that BEGINS with "Blocked by …" (a real
    // dependency declaration). Anchoring at line start rejects a mid-sentence,
    // quoted mention — e.g. an Issue body that merely DESCRIBES `"Blocked by
    // #N"` prose (like #497's own body) is not itself blocked.
    if (isHeading(line)) continue;
    const m = line.match(/^\s*(?:[-*]\s+)?(?:\*\*)?blocked\s+by\b[:\s*]*(.*)$/i);
    if (m) {
      // A combined `**Blocked by:** … · **Blocks:** …` Dependencies line carries
      // the Blocks half after a `·` separator (or the emphasised `**Blocks:**`
      // marker) — cut it off so the Blocks value is never parsed as a Blocked-by
      // blocker (#919). The marker alternative REQUIRES the `**` emphasis so a
      // legitimate blocker clause whose prose contains the bare word "blocks"
      // (e.g. `the content-blocks refactor #873`) is never truncated.
      const rest = (m[1] ?? "").split(/\s*·\s*|\s*\*\*\s*blocks\b/i)[0] ?? "";
      if (isNoBlockerText(rest)) continue; // explicit no-blocker
      // Clause runs to the first sentence terminator followed by space/EOL.
      const clause = rest.split(/(?<=[.])\s|(?<=[.])$/u)[0] ?? rest;
      if (clause.trim()) items.push(clause);
    }
  }

  const blockers: ProseBlocker[] = [];
  for (const item of items) {
    const issues = Array.from(item.matchAll(/#(\d+)/g)).map((x) =>
      Number(x[1]),
    );
    if (issues.length > 0) {
      blockers.push({ issues });
      continue;
    }
    // No explicit `#N` — a clause that names one or more EARS handlers of the
    // same feature (e.g. "Blocked by EARS-7 (…) and EARS-1 (…)") is resolved
    // against sibling Issues at state-resolution time; the subsystem name is
    // kept only as the conservative fallback for any EARS that finds no sibling.
    const ears = Array.from(item.matchAll(/\bEARS-(\d+)\b/gi)).map((x) =>
      Number(x[1]),
    );
    const name = subsystemName(item);
    if (ears.length > 0) {
      blockers.push({
        issues: [],
        ears: Array.from(new Set(ears)),
        subsystem: name || undefined,
      });
    } else if (name) {
      blockers.push({ issues: [], subsystem: name });
    }
  }
  return blockers;
}

/**
 * Classify an Issue from its resolved dependency edges. Blocked iff at least one
 * edge is an OPEN blocking Issue or an absent owning-subsystem; otherwise
 * takeable. `decision-debt` is surfaced as an annotation, NEVER as a blocker.
 * Duplicate edges (same open Issue via native + prose, same subsystem) collapse
 * to one reason.
 */
export function classify(issue: IssueInput, deps: DepRef[]): Triage {
  const reasons: BlockReason[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();
  const notesSeen = new Set<string>();

  for (const d of deps) {
    if (d.number != null) {
      if (d.state === "open") {
        const key = `#${d.number}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // An EARS prose-ref whose sibling Issue is still OPEN blocks, named as
        // the concrete open sibling it resolved to.
        const earsTag = d.ears != null ? `EARS-${d.ears} → ` : "";
        // A provenance-orphan edge (#853) — neither side records why — is
        // flagged inline so the lead challenges it instead of relaying it.
        const orphanTag =
          d.rationale === "absent" ? " ⚠ no recorded rationale" : "";
        reasons.push({
          kind: "open-issue",
          number: d.number,
          rationale: d.rationale,
          text: `blocked by open ${earsTag}#${d.number}${
            d.title ? ` (${truncateTitle(d.title)})` : ""
          }${orphanTag}`,
        });
      } else if (d.ears != null && d.state === "closed") {
        // A prose "Blocked by EARS-N" ref resolved to a CLOSED sibling Issue:
        // the dependency is satisfied — record it as an unblocking note, not a
        // blocker (the #468 / #557 false-blocked pattern this command fixes).
        const key = `ears:${d.ears}`;
        if (notesSeen.has(key)) continue;
        notesSeen.add(key);
        notes.push(`prose ref resolved: EARS-${d.ears} closed as #${d.number}`);
      }
      // A closed blocking Issue is resolved — not a blocker.
    } else if (d.subsystem) {
      const key = `sub:${d.subsystem.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      reasons.push({
        kind: "absent-subsystem",
        text: `owning subsystem absent (${d.subsystem})`,
      });
    }
  }

  const { stream, noKindLabel } = issueStream(issue.labels);
  return {
    number: issue.number,
    title: issue.title,
    readiness: reasons.length > 0 ? "blocked" : "takeable",
    reasons,
    notes,
    isDecisionDebt: issue.labels.includes("decision-debt"),
    stream,
    noKindLabel,
  };
}

/** One node's mega-blocker rollup (#853): the open issues it blocks + per-edge rationale. */
export interface MegaBlocker {
  /** The blocking node's Issue number. */
  number: number;
  /** Every open Issue blocked by this node, with that edge's provenance verdict. */
  edges: Array<{ blocked: number; rationale: Rationale | undefined }>;
}

/**
 * Find every node blocking ≥ `threshold` open issues (#853). Computed from the
 * classified `open-issue` block reasons — i.e. only edges to OPEN blockers of
 * OPEN issues count (a closed dep blocks nothing). Sorted by fan-out desc, then
 * by node number; edges sorted by blocked-issue number.
 */
export function findMegaBlockers(
  triaged: Triage[],
  threshold = 5,
): MegaBlocker[] {
  const byNode = new Map<number, MegaBlocker>();
  for (const t of triaged) {
    for (const r of t.reasons) {
      if (r.kind !== "open-issue" || r.number == null) continue;
      let node = byNode.get(r.number);
      if (!node) {
        node = { number: r.number, edges: [] };
        byNode.set(r.number, node);
      }
      node.edges.push({ blocked: t.number, rationale: r.rationale });
    }
  }
  return Array.from(byNode.values())
    .filter((n) => n.edges.length >= threshold)
    .map((n) => ({
      ...n,
      edges: [...n.edges].sort((a, b) => a.blocked - b.blocked),
    }))
    .sort((a, b) => b.edges.length - a.edges.length || a.number - b.number);
}

// ── parallel-session claim signal (#811) — pure seams ───────────────────────

/** One Issue comment, reduced to what the claim detector needs. */
export interface ClaimComment {
  body: string;
  /** Comment creation time in epoch ms (0 when unparseable — sorts oldest). */
  createdAtMs: number;
}

/** Plain-data input to `detectClaim` — both probes pre-resolved by the caller. */
export interface ClaimProbe {
  /** mtime (epoch ms) of `.claude/worktrees/<N>` when present, else undefined. */
  worktreeMtimeMs?: number;
  /** The Issue's comments (any order); undefined = comments unavailable. */
  comments?: ClaimComment[];
  /** "now" in epoch ms — injected for testability. */
  nowMs: number;
}

/** A detected parallel-session claim on a takeable Issue. */
export interface ClaimSignal {
  source: "worktree" | "start-comment";
  /** Age of the signal (never negative — future mtimes clamp to 0). */
  ageMs: number;
}

/**
 * Is this comment a START/CLAIM comment (repo-conventions.md → Issue
 * conventions, #811)? Canonical shape is a one-liner opening with `claim:`;
 * tolerant of the other natural openers a session posts when taking an Issue
 * (`Start…`/`Started…`/`Starting…`, `Taking…`, `In progress…`). Matched against
 * the first non-empty line only — a mid-comment "starting with" never claims.
 */
export function isStartClaimComment(body: string): boolean {
  const first = body
    .replace(/\r\n/g, "\n")
    .split("\n")
    .find((l) => l.trim() !== "");
  if (!first) return false;
  return /^\s*(?:\*\*)?\s*(?:claim(?:ed|ing)?\b|start(?:ed|ing)?\b|taking\b|in[- ]progress\b)/i.test(
    first,
  );
}

/**
 * Is this comment a STOP-STATE comment (board-design §6 four-field shape)? The
 * canonical form opens with `**Where I stopped:**` — that opener is the
 * deterministic marker.
 */
export function isStopStateComment(body: string): boolean {
  const first = body
    .replace(/\r\n/g, "\n")
    .split("\n")
    .find((l) => l.trim() !== "");
  if (!first) return false;
  return /^\s*(?:\*\*)?\s*where i stopped\b/i.test(first);
}

/** Compact claim age: `<1m`, `34m`, `2h`, `3d`. */
export function formatClaimAge(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return "<1m";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * Detect a parallel-session claim (#811). Two independent signals:
 *
 *   - WORKTREE: `.claude/worktrees/<N>` exists under the primary tree. Always a
 *     signal, however old — the age is surfaced (mtime-derived) and the human
 *     decides whether it's live or abandoned. Never auto-suppressed.
 *   - START-COMMENT: the Issue's latest start/claim comment is NEWER than its
 *     latest stop-state comment (a stop-state posted after the claim releases
 *     it — that session ended and recorded where it stopped).
 *
 * When both fire, the FRESHEST signal is reported (ties → worktree). Returns
 * null when neither fires — the item stays plainly takeable.
 */
export function detectClaim(probe: ClaimProbe): ClaimSignal | null {
  const signals: ClaimSignal[] = [];
  if (probe.worktreeMtimeMs != null) {
    signals.push({
      source: "worktree",
      ageMs: Math.max(0, probe.nowMs - probe.worktreeMtimeMs),
    });
  }
  let latestStart: number | undefined;
  let latestStop: number | undefined;
  for (const c of probe.comments ?? []) {
    if (isStartClaimComment(c.body)) {
      if (latestStart == null || c.createdAtMs > latestStart)
        latestStart = c.createdAtMs;
    } else if (isStopStateComment(c.body)) {
      if (latestStop == null || c.createdAtMs > latestStop)
        latestStop = c.createdAtMs;
    }
  }
  if (latestStart != null && (latestStop == null || latestStart > latestStop)) {
    signals.push({
      source: "start-comment",
      ageMs: Math.max(0, probe.nowMs - latestStart),
    });
  }
  if (signals.length === 0) return null;
  // Freshest signal wins; Array.prototype.sort is stable, so an exact tie keeps
  // the worktree (pushed first) — the harder artifact.
  signals.sort((a, b) => a.ageMs - b.ageMs);
  return signals[0]!;
}

/** Render the report label: `IN-FLIGHT-ELSEWHERE (worktree, age 2h)`. */
export function claimLabel(claim: ClaimSignal): string {
  return `IN-FLIGHT-ELSEWHERE (${claim.source}, age ${formatClaimAge(claim.ageMs)})`;
}

// ── grooming sections (#1873) — pure seams ──────────────────────────────────

/** The track sub-headings every grooming section groups by (#1873). */
export const GROOM_TRACKS = [
  "track:academy",
  "track:doctor",
  "track:platform",
] as const;

/** One grouped row of a grooming section: a track bucket plus its rendered line. */
export interface TrackRow {
  track: string | null;
  line: string;
}

/**
 * Render one grooming section: `## <heading> (n)`, a one-line lead, then a
 * `### track:*` sub-heading per non-empty bucket (an Issue with no `track:*`
 * label falls into `track:platform`). An EMPTY section prints exactly one
 * content line — `none` — so a groom can tell "checked, nothing found" from
 * "not computed" (the section is omitted entirely only when its fetch failed,
 * and then a `## Warnings` row says so).
 */
export function formatTrackSection(
  heading: string,
  lead: string,
  rows: TrackRow[],
): string {
  const out = [`## ${heading} (${rows.length})`, lead];
  if (rows.length === 0) {
    out.push("none");
    return out.join("\n");
  }
  for (const track of GROOM_TRACKS) {
    const items = rows.filter((r) => (r.track ?? "track:platform") === track);
    if (items.length === 0) continue;
    out.push(`### ${track} (${items.length})`);
    for (const i of items) out.push(i.line);
  }
  return out.join("\n");
}

// ── wait-for-reuse ──────────────────────────────────────────────────────────

/** One `Reuse:` field entry parsed out of an Issue body (ADR-0013 A1, #1821). */
export interface ReuseRef {
  kind: "canon" | "extract-from" | "new";
  /** The canonical path the entry names (empty for `new:`). */
  path: string;
  /** An Issue number named inside the entry — `extract-from: <path> (#N)`. */
  issue?: number;
}

/**
 * Reduce one `Reuse:` value chunk to a bare path: drop parentheticals
 * (`(extend)`, `(#1234)`), markdown emphasis/backticks and trailing
 * punctuation. Returns `""` when what is left is not a repo path.
 */
export function normaliseReusePath(text: string): string {
  const t = String(text)
    .replace(/\([^)]*\)/g, " ")
    .replace(/[`*"']/g, "")
    .trim()
    .replace(/[.,;:]+$/, "")
    .trim();
  return t.includes("/") ? t : "";
}

/**
 * Parse every `Reuse: <kind>: <paths>` line of an Issue body (the
 * `.github/ISSUE_TEMPLATE/default.md` field). A value may list several
 * comma-separated paths; each becomes its own ref. Unknown kinds are ignored —
 * this never guesses a capability out of free prose.
 */
export function parseReuseField(body: string): ReuseRef[] {
  const refs: ReuseRef[] = [];
  const re = /^[ \t]*(?:[-*][ \t]*)?\*{0,2}Reuse\*{0,2}[ \t]*:[ \t]*(.+)$/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body ?? "")) !== null) {
    const value = (m[1] ?? "").trim();
    const km = /^(canon|extract-from|new)[ \t]*:[ \t]*(.*)$/i.exec(value);
    if (!km) continue;
    const kind = (km[1] ?? "").toLowerCase() as ReuseRef["kind"];
    if (kind === "new") {
      refs.push({ kind, path: "" });
      continue;
    }
    for (const chunk of (km[2] ?? "").split(",")) {
      const path = normaliseReusePath(chunk);
      if (!path) continue;
      const issueMatch = /#(\d+)/.exec(chunk);
      refs.push(
        issueMatch
          ? { kind, path, issue: Number(issueMatch[1]) }
          : { kind, path },
      );
    }
  }
  return refs;
}

/** One row of the capability-ownership registry, reduced to what matching needs. */
export interface CapabilityRow {
  capability: string;
  /** The `Canonical location` cell verbatim (may name several paths). */
  canonical: string;
  /** Every `#N` Issue ref anywhere in the row. */
  issues: number[];
}

/**
 * Parse the single markdown table of
 * `apps/docs/content/specs/product/two-site-ia/capability-ownership.md`.
 * Header and separator rows are skipped; `#N` refs are collected from the WHOLE
 * row (consumer cells carry them as often as the `Extraction / debt` cell does).
 */
export function parseCapabilityRegistry(md: string): CapabilityRow[] {
  const rows: CapabilityRow[] = [];
  for (const raw of String(md ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("|") || !line.endsWith("|")) continue;
    const cells = line
      .slice(1, -1)
      .split("|")
      .map((c) => c.trim());
    if (cells.length < 3) continue;
    const first = cells[0] ?? "";
    if (/^:?-{2,}/.test(first)) continue; // separator row
    if (first.toLowerCase() === "capability") continue; // header row
    rows.push({
      capability: first,
      canonical: cells[1] ?? "",
      issues: Array.from(
        new Set((line.match(/#(\d+)/g) ?? []).map((x) => Number(x.slice(1)))),
      ),
    });
  }
  return rows;
}

/** An open Issue as the wait-for-reuse matcher consumes it. */
export interface ReuseCandidate {
  number: number;
  title: string;
  /** The Issue's `track:*` label, or null. */
  track: string | null;
  reuse: ReuseRef[];
  /** Someone is actively building it (a live claim signal / In Progress). */
  building: boolean;
}

/** One Issue that must WAIT because the other track is already building the block. */
export interface WaitForReuse {
  number: number;
  title: string;
  track: string;
  /** The canonical path that matched — always printed, never implied. */
  path: string;
  blocker: number;
  blockerTrack: string;
  via: "registry" | "reuse-field";
}

/** The two product tracks that must not build the same block twice (#1873). */
const PAIRED_TRACK: Record<string, string> = {
  "track:academy": "track:doctor",
  "track:doctor": "track:academy",
};

/**
 * Cross-front reuse collision (AGENTS.md §6 «Cross-front capability reuse»,
 * owner 2026-09-05: «a block being built in one track must NOT be started in
 * the other — wait and reuse»).
 *
 * Issue A (track X) declaring `Reuse: canon:<path>` / `extract-from:<path>`
 * WAITS when some OTHER open Issue B in the paired track either
 *   (a) is referenced by the registry row whose `Canonical location` contains
 *       that path, or
 *   (b) declares the same path in its own `Reuse:` field AND is actively being
 *       built (claim signal / In Progress).
 * A `new:` ref never collides — nothing canonical exists to wait for.
 *
 * Read-only: the row is REMOVED from Takeable and listed with the matched path,
 * so the lead can confirm it is the same capability before wiring `blocked_by`.
 */
export function findWaitForReuse(
  candidates: ReuseCandidate[],
  registry: CapabilityRow[],
): WaitForReuse[] {
  const byNumber = new Map(candidates.map((c) => [c.number, c]));
  const out: WaitForReuse[] = [];
  for (const c of candidates) {
    const other = c.track ? PAIRED_TRACK[c.track] : undefined;
    if (!c.track || !other) continue;
    let hit: WaitForReuse | null = null;
    const base = { number: c.number, title: c.title, track: c.track };
    for (const ref of c.reuse) {
      if (ref.kind === "new" || !ref.path) continue;
      const needle = ref.path.toLowerCase();
      for (const row of registry) {
        if (!row.canonical.toLowerCase().includes(needle)) continue;
        for (const n of row.issues) {
          const b = byNumber.get(n);
          if (!b || b.number === c.number || b.track !== other) continue;
          hit = {
            ...base,
            path: ref.path,
            blocker: b.number,
            blockerTrack: other,
            via: "registry",
          };
          break;
        }
        if (hit) break;
      }
      if (hit) break;
      for (const b of candidates) {
        if (b.number === c.number || b.track !== other || !b.building) continue;
        if (!b.reuse.some((r) => r.path && r.path.toLowerCase() === needle))
          continue;
        hit = {
          ...base,
          path: ref.path,
          blocker: b.number,
          blockerTrack: other,
          via: "reuse-field",
        };
        break;
      }
      if (hit) break;
    }
    if (hit) out.push(hit);
  }
  return out.sort((a, b) => a.number - b.number);
}

/** Render the `## Wait for reuse` section (#1873). */
export function formatWaitForReuse(rows: WaitForReuse[]): string {
  return formatTrackSection(
    "Wait for reuse",
    "The paired track is already building this block — AGENTS.md §6 forbids a second implementation. These rows are REMOVED from Takeable: confirm it is the same capability, then wire `blocked_by` on the building Issue WITH a rationale (registry: `apps/docs/content/specs/product/two-site-ia/capability-ownership.md`).",
    rows.map((r) => ({
      track: r.track,
      line: `- #${r.number} WAIT-FOR-REUSE (#${r.blocker}, ${r.blockerTrack}) via ${r.via} — \`${r.path}\` — ${truncateTitle(r.title, 70)}`,
    })),
  );
}

// ── orphans ─────────────────────────────────────────────────────────────────

/** Plain-data input to `findOrphans` — every probe pre-resolved by the caller. */
export interface OrphanInput {
  number: number;
  title: string;
  labels: string[];
  milestone: string | null;
  /** The Issue has at least one native `blocked_by` edge. */
  hasNativeBlockedBy: boolean;
  /** The Issue is a native sub-issue of some parent. */
  hasParent: boolean;
}

/** One un-attached open Issue, with the reason tokens that made it one. */
export interface Orphan {
  number: number;
  title: string;
  track: string | null;
  reasons: string[];
}

/**
 * Open Issues with NO attachment to the critical path (owner 2026-09-05:
 * «критический путь понятен, нет issue-сирот»): no native `blocked_by`, no
 * sub-issue parent, and a milestone that is not the track's queue head. Epic
 * and gate Issues are roots by construction and never orphans.
 *
 * FAILS OPEN like the claim guard (#1857): a track whose queue head could not
 * be computed yields no verdict at all, rather than declaring every Issue
 * off-head. Read-only — attaching an orphan is the lead's / owner's call.
 */
export function findOrphans(
  inputs: OrphanInput[],
  queueHeads: Array<{ track: string; head: string | null }>,
): Orphan[] {
  const headByTrack = new Map(queueHeads.map((q) => [q.track, q.head]));
  const out: Orphan[] = [];
  for (const i of inputs) {
    const title = i.title.trim().toLowerCase();
    if (title.startsWith("epic:") || title.startsWith("gate:")) continue;
    if (i.hasNativeBlockedBy || i.hasParent) continue;
    const track = trackOf(i.labels) as string | null;
    const head = track ? (headByTrack.get(track) ?? null) : null;
    if (head == null) continue;
    const milestone = i.milestone ?? "";
    if (milestone === head) continue;
    out.push({
      number: i.number,
      title: i.title,
      track,
      reasons: [
        "no-blocker",
        "no-parent",
        `off-head (${milestone || "no milestone"})`,
      ],
    });
  }
  return out.sort((a, b) => a.number - b.number);
}

const ORPHANS_LEAD =
  "Open, unattached to the critical path: no native `blocked_by`, no sub-issue parent, milestone ≠ the track's queue head. Judge each one — attach to its epic, wire a technical `blocked_by` WITH a rationale, re-milestone, or ask the owner. Listing only: nothing is closed or re-linked here.";

/**
 * Render the `## Orphans` section (#1873). The sub-issue `parent` probe is the
 * board scan; when that scan FAILED the whole section degrades to one skipped
 * line rather than rendering with `no-parent` true for every Issue — a report
 * telling the lead to re-link ~114 Issues that are already sub-issues is worse
 * than no section at all (same fail-open posture as the missing queue head,
 * #1857). The failure itself is already a `## Warnings` row.
 */
export function formatOrphans(rows: Orphan[], boardScanOk = true): string {
  if (!boardScanOk) {
    return [
      "## Orphans (skipped)",
      ORPHANS_LEAD,
      "skipped — board scan failed (see Warnings); the sub-issue parent probe is unavailable, so every Issue would falsely read `no-parent`.",
    ].join("\n");
  }
  return formatTrackSection(
    "Orphans",
    ORPHANS_LEAD,
    rows.map((r) => ({
      track: r.track,
      line: `- #${r.number} [${r.reasons.join(", ")}] ${truncateTitle(r.title, 70)}`,
    })),
  );
}

// ── stalled + likely-done ───────────────────────────────────────────────────

/** Every `Closes/Fixes/Resolves #N` Issue ref in a PR title/body. */
export function closesRefs(text: string): number[] {
  const out = new Set<number>();
  const re = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(text ?? ""))) !== null) out.add(Number(m[1]));
  return Array.from(out).sort((a, b) => a - b);
}

/** One `statusCheckRollup` entry, reduced to what the green test needs. */
export interface RollupCheck {
  name?: string;
  status?: string | null;
  conclusion?: string | null;
  state?: string | null;
  completedAt?: string | null;
  startedAt?: string | null;
}

const GREEN_CONCLUSIONS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

const NON_TERMINAL_STATES = new Set([
  "IN_PROGRESS",
  "QUEUED",
  "PENDING",
  "WAITING",
  "REQUESTED",
  "EXPECTED",
]);

/**
 * Is this rollup entry still running? GitHub reports a run in flight with a
 * non-terminal `status` AND the placeholder `completedAt: "0001-01-01T…"` —
 * so the timestamp alone would sort an in-flight re-run BEHIND the older
 * COMPLETED attempt it supersedes.
 */
export function isCheckInFlight(c: RollupCheck): boolean {
  if (String(c?.completedAt ?? "").startsWith("0001-")) return true;
  const status = String(c?.status ?? "").toUpperCase();
  if (status && NON_TERMINAL_STATES.has(status)) return true;
  const state = String(c?.state ?? "").toUpperCase();
  return NON_TERMINAL_STATES.has(state);
}

/**
 * Keep only the LATEST run per check name. GitHub returns every attempt in the
 * rollup, so a re-run that fixed a red check still leaves the failed attempt in
 * the array — comparing the raw list would report a green PR as red. Recency is
 * keyed on `startedAt` (never on the `0001-` placeholder `completedAt` an
 * in-flight run carries), and an in-flight attempt always wins its name: a
 * re-run in progress must not read as the older green it is replacing.
 */
export function latestChecks(checks: RollupCheck[]): RollupCheck[] {
  const byName = new Map<string, RollupCheck>();
  for (const c of Array.isArray(checks) ? checks : []) {
    const key = c?.name ?? "";
    const prev = byName.get(key);
    if (!prev) {
      byName.set(key, c);
      continue;
    }
    if (isCheckInFlight(prev)) continue;
    const at = (x: RollupCheck) =>
      x.startedAt ??
      (String(x.completedAt ?? "").startsWith("0001-")
        ? ""
        : (x.completedAt ?? "")) ??
      "";
    if (isCheckInFlight(c) || at(c) >= at(prev)) byName.set(key, c);
  }
  return Array.from(byName.values());
}

/**
 * Are ALL of a PR's checks green? Zero registered checks is NOT green (the
 * #836 rule the merge gate uses): nothing ran, so nothing passed. A check still
 * in flight is not green either.
 */
export function checksAllGreen(checks: RollupCheck[]): boolean {
  const all = Array.isArray(checks) ? checks : [];
  const latest = latestChecks(all);
  if (latest.length === 0) return false;
  // Any attempt of any check still running ⇒ the PR is not green, whatever the
  // superseded attempts concluded (a spurious READY-TO-LAND is the worst row
  // this report can print — the skill sends it straight to `ds-lander`).
  if (all.some((c) => isCheckInFlight(c))) return false;
  return latest.every((c) => {
    const verdict = (c.conclusion ?? c.state ?? "").toUpperCase();
    if ((c.status ?? "COMPLETED").toUpperCase() !== "COMPLETED") return false;
    return GREEN_CONCLUSIONS.has(verdict);
  });
}

/** An open PR as the stalled detector consumes it. */
export interface StalledOpenPr {
  number: number;
  title: string;
  body: string;
  headRefOid: string;
  /** Native review records — `commit_id` is the head pin (#1867). */
  reviews: Array<{
    body?: string;
    commit_id?: string;
    submitted_at?: string | null;
  }>;
  checks: RollupCheck[];
}

/**
 * How far back the merged-PR scan looks. Printed in the `## Likely done` lead
 * so a groom knows what was NOT looked at: an Issue whose closing PR merged
 * beyond this horizon can never surface here.
 */
export const MERGED_PR_HORIZON = 100;

/** A merged PR, reduced to the text the `Closes #N` scan reads. */
export interface MergedPr {
  number: number;
  title: string;
  body: string;
}

/** An open Issue as the stalled / likely-done detectors consume it. */
export interface StalledIssue {
  number: number;
  title: string;
  labels: string[];
  /** Age of the live claim signal in ms, or null when the Issue is unclaimed. */
  claimAgeMs: number | null;
}

export type StalledKind = "STALE-CLAIM" | "READY-TO-LAND" | "MERGED-BUT-OPEN";

/** One undelivered item — the work that must be DRAINED before anything new. */
export interface StalledRow {
  kind: StalledKind;
  /** Issue number for (a)/(c), PR number for (b). */
  number: number;
  title: string;
  track: string | null;
  detail: string;
}

/**
 * Nothing undelivered left behind (owner 2026-09-05): three shapes of stalled
 * work, all read-only findings.
 *
 * (a) `STALE-CLAIM`     — a claim signal older than `stalledDays` with no open
 *     PR naming the Issue: either resume it or post a stop-state comment.
 * (b) `READY-TO-LAND`   — an open PR carrying a Mode (a) APPROVE pinned to the
 *     CURRENT head (`commit_id === headRefOid`, the #1867 rule) with every
 *     check green, still unmerged: hand it to `ds-lander`.
 * (c) `MERGED-BUT-OPEN` — a merged PR says `Closes #N` and #N is still open
 *     (the keyword did not fire, or the merge tail stopped half-way).
 */
export function findStalled(input: {
  issues: StalledIssue[];
  openPrs: StalledOpenPr[];
  mergedPrs: MergedPr[];
  stalledDays: number;
  /**
   * Head-pinned Mode-a verdict classifier — injected so the pure seam stays
   * testable; defaults to the merge gate's own `classifyModeAVerdict` (#1867),
   * which is the single definition of a fresh APPROVE.
   */
  classifyVerdict?: (
    reviews: StalledOpenPr["reviews"],
    headSha: string,
  ) => { state: string };
}): StalledRow[] {
  const classifyVerdict = input.classifyVerdict ?? classifyModeAVerdict;
  const issueByNumber = new Map(input.issues.map((i) => [i.number, i]));
  const thresholdMs = Math.max(0, input.stalledDays) * 24 * 60 * 60 * 1000;
  const rows: StalledRow[] = [];

  for (const i of input.issues) {
    if (i.claimAgeMs == null || i.claimAgeMs <= thresholdMs) continue;
    const claimed = input.openPrs.some((p) =>
      mentionsIssue(`${p.title}\n${p.body}`, i.number),
    );
    if (claimed) continue;
    rows.push({
      kind: "STALE-CLAIM",
      number: i.number,
      title: i.title,
      track: trackOf(i.labels) as string | null,
      detail: `claimed ${formatClaimAge(i.claimAgeMs)} ago, no open PR (threshold ${input.stalledDays}d)`,
    });
  }

  for (const p of input.openPrs) {
    if (classifyVerdict(p.reviews, p.headRefOid).state !== "fresh-approve")
      continue;
    if (!checksAllGreen(p.checks)) continue;
    const closes = closesRefs(`${p.title}\n${p.body}`);
    const linked = closes.map((n) => issueByNumber.get(n)).find(Boolean);
    rows.push({
      kind: "READY-TO-LAND",
      number: p.number,
      title: p.title,
      track: linked ? (trackOf(linked.labels) as string | null) : null,
      detail: `PR — Mode (a) APPROVE pinned to ${p.headRefOid.slice(0, 7)} + all checks green, unmerged${
        closes.length > 0 ? ` (closes ${closes.map((n) => `#${n}`).join(", ")})` : ""
      }`,
    });
  }

  const seen = new Set<string>();
  for (const p of input.mergedPrs) {
    for (const n of closesRefs(`${p.title}\n${p.body}`)) {
      const issue = issueByNumber.get(n);
      if (!issue) continue; // not open ⇒ the keyword did its job
      const key = `${p.number}:${n}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        kind: "MERGED-BUT-OPEN",
        number: n,
        title: issue.title,
        track: trackOf(issue.labels) as string | null,
        detail: `merged PR #${p.number} says \`Closes #${n}\` — Issue still open`,
      });
    }
  }

  return rows.sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.number - b.number,
  );
}

/** Render the `## Stalled` section (#1873). */
export function formatStalled(rows: StalledRow[]): string {
  return formatTrackSection(
    "Stalled",
    "Undelivered work — DRAIN this before picking anything new (owner 2026-09-05). `READY-TO-LAND` → `ds-lander` (`pnpm pr:land <N>`); `MERGED-BUT-OPEN` → verify the diff, then close; `STALE-CLAIM` → resume it or post a stop-state comment. Claim ages are surfaced, never auto-suppressed.",
    rows.map((r) => ({
      track: r.track,
      line: `- #${r.number} ${r.kind} — ${r.detail} — ${truncateTitle(r.title, 60)}`,
    })),
  );
}

/** One open Issue a merged PR already claims to have delivered. */
export interface LikelyDone {
  number: number;
  title: string;
  track: string | null;
  prs: number[];
}

/**
 * The Issue number a Conventional-Commit PR title carries as its scope —
 * `tooling(1873): …` / `feat(1722-slug): …` → `1873` / `1722`. This is the
 * repo's own «this PR delivers that Issue» marker (AGENTS.md §2 squash title =
 * PR title), so it is delivery evidence where a bare `#N` mention is not.
 */
export function titleScopeIssue(title: string): number | null {
  const m = /^\s*[a-z]+\((\d+)(?:[^)]*)\)!?\s*:/i.exec(String(title ?? ""));
  return m ? Number(m[1]) : null;
}

/**
 * Actuality (owner 2026-09-05): an open Issue a MERGED PR claims to have
 * DELIVERED — it closes it (`Closes/Fixes/Resolves #N`) or names it as the
 * Conventional-Commit scope of its title. A bare `#N` mention is deliberately
 * NOT enough: merged bodies in this repo carry roadmap, board and dependency
 * references, and the mention rule flagged 106 of 191 open Issues, i.e. a list
 * no groom can verify. `epic:` / `gate:` Issues are excluded — they are
 * long-lived containers every slice PR names. Candidates to VERIFY against the
 * merged diff and close; never auto-closed.
 */
export function findLikelyDone(
  issues: StalledIssue[],
  mergedPrs: MergedPr[],
): LikelyDone[] {
  const out: LikelyDone[] = [];
  for (const i of issues) {
    const title = i.title.trim().toLowerCase();
    if (title.startsWith("epic:") || title.startsWith("gate:")) continue;
    const prs = mergedPrs
      .filter(
        (p) =>
          closesRefs(`${p.title}\n${p.body}`).includes(i.number) ||
          titleScopeIssue(p.title) === i.number,
      )
      .map((p) => p.number)
      .sort((a, b) => a - b);
    if (prs.length === 0) continue;
    out.push({
      number: i.number,
      title: i.title,
      track: trackOf(i.labels) as string | null,
      prs,
    });
  }
  return out.sort((a, b) => a.number - b.number);
}

/** Render the `## Likely done` section (#1873). */
export function formatLikelyDone(rows: LikelyDone[]): string {
  return formatTrackSection(
    "Likely done",
    `Open, but a MERGED PR claims to DELIVER it — it closes the Issue (\`Closes/Fixes/Resolves #N\`) or carries it as the Conventional-Commit scope of its title (\`type(N):\`). A bare \`#N\` mention is not delivery evidence and is not listed; \`epic:\` / \`gate:\` Issues are excluded. Horizon: the last ${MERGED_PR_HORIZON} merged PRs. VERIFY against that PR's diff before closing (\`gh pr diff <N>\`), then close with a \`state_reason\` — the script never closes anything itself.`,
    rows.map((r) => ({
      track: r.track,
      line: `- #${r.number} delivered by merged ${r.prs.map((p) => `PR #${p}`).join(", ")} — ${truncateTitle(r.title, 60)}`,
    })),
  );
}

// ── release rotation ────────────────────────────────────────────────────────

/** One rendered milestone row of the rotation table. */
export interface RotationRow {
  title: string;
  due: string | null;
  open: number;
  flags: string[];
}

/** The rotation view of one track. */
export interface RotationTrack {
  track: string;
  head: string | null;
  rows: RotationRow[];
}

/**
 * Milestone track membership, from the SAME Russian prefixes the queue rules
 * use (`TRACK_MILESTONE_PREFIXES`). A milestone matching no track prefix
 * («Platform ops & hardening») belongs to `track:platform`.
 */
export function milestoneTrackOf(title: string): string {
  for (const track of ["track:academy", "track:doctor"]) {
    const prefix = (
      TRACK_MILESTONE_PREFIXES as Record<string, string | undefined>
    )[track];
    if (prefix && String(title ?? "").startsWith(prefix)) return track;
  }
  return "track:platform";
}

/**
 * Release rotation (owner 2026-09-05: «каждый релиз должен быть наполнен»):
 * per track, every OPEN milestone ordered the way the queue orders them —
 * dated by `due_on` first, then undated, with the «· Позже» backlog last of
 * all — carrying its open-Issue count and the rotation flags:
 *
 *   - `EMPTY-NEXT`            — the release right AFTER the queue head has zero
 *     open Issues: the next release is empty and needs filling / a «Позже» lift.
 *   - `ALL-CLOSED-STILL-OPEN` — an open milestone, past its `due_on`, with zero
 *     open Issues: it shipped, close the milestone.
 *   - `POZHE: <n>`            — the size of the track's «· Позже» backlog, the
 *     pool the last question of every groom lifts from.
 */
export function releaseRotation(
  milestones: MilestoneRecord[],
  issues: Array<{ milestone: string | null }>,
  nowMs: number = Date.now(),
): RotationTrack[] {
  const openByMilestone = new Map<string, number>();
  for (const i of issues) {
    const key = i.milestone ?? "";
    if (!key) continue;
    openByMilestone.set(key, (openByMilestone.get(key) ?? 0) + 1);
  }
  const heads = new Map(
    trackQueueHeads(milestones).map((q) => [q.track, q.head]),
  );

  return GROOM_TRACKS.map((track) => {
    const mine = milestones
      .filter(
        (m) =>
          typeof m.title === "string" &&
          (m.state ?? "open") === "open" &&
          milestoneTrackOf(m.title) === track,
      )
      .sort((a, b) => {
        const later = (m: MilestoneRecord) => (isLaterMilestone(m.title) ? 1 : 0);
        if (later(a) !== later(b)) return later(a) - later(b);
        if (a.due_on && b.due_on)
          return a.due_on < b.due_on ? -1 : a.due_on > b.due_on ? 1 : a.title.localeCompare(b.title);
        if (a.due_on) return -1;
        if (b.due_on) return 1;
        return a.title.localeCompare(b.title);
      });

    const head = heads.get(track) ?? null;
    const headIndex = head ? mine.findIndex((m) => m.title === head) : -1;
    // The release right after the head, skipping the «· Позже» backlog.
    const nextTitle =
      headIndex >= 0
        ? (mine.slice(headIndex + 1).find((m) => !isLaterMilestone(m.title))
            ?.title ?? null)
        : null;

    const rows: RotationRow[] = mine.map((m) => {
      const open = openByMilestone.get(m.title) ?? 0;
      const flags: string[] = [];
      if (m.title === head) flags.push("QUEUE-HEAD");
      if (m.title === nextTitle && open === 0) flags.push("EMPTY-NEXT");
      if (isLaterMilestone(m.title)) flags.push(`POZHE: ${open}`);
      else if (
        open === 0 &&
        m.due_on != null &&
        Date.parse(m.due_on) < nowMs
      )
        flags.push("ALL-CLOSED-STILL-OPEN");
      return {
        title: m.title,
        due: m.due_on ? m.due_on.slice(0, 10) : null,
        open,
        flags,
      };
    });
    return { track, head, rows };
  }).filter((t) => t.rows.length > 0);
}

/** Render the `## Release rotation` section (#1873). */
export function formatReleaseRotation(tracks: RotationTrack[]): string {
  const total = tracks.reduce((n, t) => n + t.rows.length, 0);
  const out = [
    `## Release rotation (${total})`,
    "Open milestones per track, in queue order (dated by `due_on`, then undated, «· Позже» last). `EMPTY-NEXT` = the release after the head has nothing in it; `ALL-CLOSED-STILL-OPEN` = it shipped, close the milestone; `POZHE: n` = the backlog the last groom question lifts from. Moving a milestone is an OWNER decision — this only reports.",
  ];
  if (total === 0) {
    out.push("none");
    return out.join("\n");
  }
  for (const t of tracks) {
    out.push(`### ${t.track} (head: ${t.head ?? "none"})`);
    for (const r of t.rows) {
      out.push(
        `- ${r.title} — due ${r.due ?? "—"}, ${r.open} open${
          r.flags.length > 0 ? ` [${r.flags.join(" | ")}]` : ""
        }`,
      );
    }
  }
  return out.join("\n");
}

// ── gh I/O (only reached from main()) ───────────────────────────────────────

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

interface Warn {
  source: string;
  message: string;
}
const warnings: Warn[] = [];
function note(source: string, err: unknown): void {
  warnings.push({
    source,
    message: err instanceof Error ? err.message.split("\n")[0] : String(err),
  });
}

interface RawIssue {
  number: number;
  title: string;
  body?: string;
  labels?: Array<{ name: string }>;
  milestone?: { title?: string } | null;
  assignees?: Array<{ login: string }>;
  issueType?: { name?: string } | null;
}

async function listOpenIssues(): Promise<RawIssue[]> {
  const { stdout } = await execa(
    "gh",
    [
      "issue",
      "list",
      "--state",
      "open",
      "--limit",
      "300",
      "--json",
      "number,title,body,labels,milestone,assignees,issueType",
    ],
    { cwd: REPO_ROOT },
  );
  return JSON.parse(stdout) as RawIssue[];
}

/**
 * Every OPEN repository milestone, for the queue-head computation (#1855).
 * A failure degrades to an empty list (rows then group as PLATFORM/AHEAD by the
 * pure rules) with a warning — the triage run never dies on it.
 */
async function listMilestones(): Promise<MilestoneRecord[]> {
  const { stdout } = await execa(
    "gh",
    [
      "api",
      "repos/:owner/:repo/milestones",
      "--paginate",
      "-X",
      "GET",
      "-f",
      "state=open",
      "--jq",
      "[.[] | {title, due_on, state}]",
    ],
    { cwd: REPO_ROOT },
  );
  // `--paginate` concatenates one JSON array per page.
  return stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => JSON.parse(line) as MilestoneRecord[]);
}

/**
 * Sweep EVERY Projects v2 row via the single sanctioned paginated GraphQL scan
 * (#1140) — 100 items/page, cursor-paginated to exhaustion (the board is 650+
 * items; a sub-limit read is a false negative). NEVER `gh project item-list`
 * (banned quota sink, #984). ONE sweep feeds two sections: PR rows drive the
 * `## PR board hygiene` findings, and OPEN Issue rows — with their labels,
 * milestone, sub-issue parent and Start/Target board dates — drive the
 * `## Roadmap hygiene` findings (#1729). A query failure throws; the caller
 * degrades both sections to a warning, never crashes the whole run.
 */
async function listBoardRows(): Promise<{
  prRows: PrBoardRow[];
  issueRows: RoadmapRow[];
}> {
  const rows: PrBoardRow[] = [];
  const issueRows: RoadmapRow[] = [];
  const truncations: string[] = [];
  let after: string | null = null;
  // Hard page cap as a runaway guard (≈100 pages = 10k items ≫ any real board).
  for (let page = 0; page < 100; page++) {
    const { stdout } = await execa(
      "gh",
      ["api", "graphql", "-f", `query=${buildBoardItemsPageQuery(after)}`],
      { cwd: REPO_ROOT },
    );
    const parsed = JSON.parse(stdout) as { data?: unknown; errors?: unknown[] };
    if (Array.isArray(parsed.errors) && parsed.errors.length > 0)
      throw new Error(
        `GraphQL errors: ${parsed.errors
          .map((e) => (e as { message?: string }).message)
          .join("; ")}`,
      );
    const pageData = parseBoardItemsPage(parsed.data);
    if (!pageData) break;
    // A connection read short makes every finding computed from it unreliable —
    // surface it as a WARN row instead of silently under-reading (#1730).
    for (const t of pageData.truncations)
      truncations.push(formatBoardTruncation(t));
    for (const node of pageData.nodes) {
      const content = node?.content as
        | {
            __typename?: string;
            number?: number;
            state?: string;
            assignees?: { totalCount?: number };
            milestone?: { title?: string } | null;
          }
        | undefined;
      if (content?.__typename === "Issue") {
        const issueRow = parseIssueBoardNode(node) as RoadmapRow | null;
        if (issueRow) issueRows.push(issueRow);
        continue;
      }
      if (content?.__typename !== "PullRequest") continue;
      if (typeof content.number !== "number") continue;
      rows.push({
        number: content.number,
        state: content.state ?? "",
        hasAssignee: (content.assignees?.totalCount ?? 0) > 0,
        hasMilestone: !!content.milestone?.title,
      });
    }
    if (!pageData.hasNextPage) break;
    after = pageData.endCursor;
    if (!after) break;
  }
  return { prRows: rows, issueRows, truncations };
}

/** Merged PRs, newest first — the `Likely done` / `MERGED-BUT-OPEN` source (#1873). */
async function listMergedPrs(): Promise<MergedPr[]> {
  const { stdout } = await execa(
    "gh",
    ["pr", "list", "--state", "merged", "--limit", String(MERGED_PR_HORIZON), "--json", "number,title,body"],
    { cwd: REPO_ROOT },
  );
  return JSON.parse(stdout) as MergedPr[];
}

/** Open PRs with their head SHA and check rollup — the `READY-TO-LAND` source (#1873). */
async function listOpenPrs(): Promise<Omit<StalledOpenPr, "reviews">[]> {
  const { stdout } = await execa(
    "gh",
    [
      "pr",
      "list",
      "--state",
      "open",
      "--limit",
      "100",
      "--json",
      "number,title,body,headRefOid,statusCheckRollup",
    ],
    { cwd: REPO_ROOT },
  );
  const raw = JSON.parse(stdout) as Array<{
    number: number;
    title: string;
    body?: string;
    headRefOid?: string;
    statusCheckRollup?: RollupCheck[] | null;
  }>;
  return raw.map((p) => ({
    number: p.number,
    title: p.title,
    body: p.body ?? "",
    headRefOid: p.headRefOid ?? "",
    checks: p.statusCheckRollup ?? [],
  }));
}

/**
 * One PR's native reviews. The REST payload is the only source of `commit_id`
 * (the head pin `classifyModeAVerdict` needs) — `gh pr list --json reviews`
 * omits it. One call per OPEN PR only, so the fan-out stays small.
 */
async function listPrReviews(n: number): Promise<StalledOpenPr["reviews"]> {
  const { stdout } = await execa(
    "gh",
    [
      "api",
      `repos/{owner}/{repo}/pulls/${n}/reviews?per_page=100`,
      "--jq",
      "[.[] | {body, commit_id, submitted_at}]",
    ],
    { cwd: REPO_ROOT },
  );
  return JSON.parse(stdout) as StalledOpenPr["reviews"];
}

/** The capability-ownership registry, parsed from the repo working tree (#1873). */
async function readCapabilityRegistry(): Promise<CapabilityRow[]> {
  const md = await readFile(
    resolve(
      REPO_ROOT,
      "apps/docs/content/specs/product/two-site-ia/capability-ownership.md",
    ),
    "utf8",
  );
  return parseCapabilityRegistry(md);
}

interface NativeDep {
  number: number;
  state: string;
  title: string;
}

async function nativeBlockedBy(n: number): Promise<NativeDep[]> {
  try {
    const { stdout } = await execa(
      "gh",
      ["api", `repos/{owner}/{repo}/issues/${n}/dependencies/blocked_by`],
      { cwd: REPO_ROOT },
    );
    return JSON.parse(stdout) as NativeDep[];
  } catch (e) {
    note(`native blocked_by #${n}`, e);
    return [];
  }
}

/**
 * Resolve a referenced Issue number to its live state, cached. Numbers already
 * known-open (they appear in the open-list) skip the round-trip.
 */
function makeStateResolver(openNumbers: Set<number>) {
  const cache = new Map<
    number,
    { state: IssueState | "unknown"; title?: string }
  >();
  return async function resolve(
    n: number,
  ): Promise<{ state: IssueState | "unknown"; title?: string }> {
    if (openNumbers.has(n)) return { state: "open" };
    const hit = cache.get(n);
    if (hit) return hit;
    try {
      const { stdout } = await execa(
        "gh",
        ["issue", "view", String(n), "--json", "number,state,title"],
        { cwd: REPO_ROOT },
      );
      const j = JSON.parse(stdout) as { state: string; title: string };
      const rec = {
        state: j.state.toLowerCase() === "open" ? "open" : "closed",
        title: j.title,
      } as { state: IssueState; title?: string };
      cache.set(n, rec);
      return rec;
    } catch (e) {
      note(`resolve #${n}`, e);
      const rec = { state: "unknown" as const };
      cache.set(n, rec);
      return rec;
    }
  };
}

/**
 * Resolve an Issue number to its PROVENANCE TEXT — body + every comment body
 * concatenated — cached (#853). Used to evaluate `blocked_by` edge rationale:
 * one fetch per Issue regardless of how many edges touch it. A fetch failure
 * degrades to `undefined` (rationale `unknown`, never a false orphan flag)
 * with a printed warning.
 */
function makeProvenanceResolver() {
  const cache = new Map<number, string | undefined>();
  return async function provenanceText(
    n: number,
  ): Promise<string | undefined> {
    if (cache.has(n)) return cache.get(n);
    let text: string | undefined;
    try {
      const { stdout } = await execa(
        "gh",
        ["issue", "view", String(n), "--json", "body,comments"],
        { cwd: REPO_ROOT },
      );
      const j = JSON.parse(stdout) as {
        body?: string;
        comments?: Array<{ body?: string }>;
      };
      text = [j.body ?? "", ...(j.comments ?? []).map((c) => c.body ?? "")]
        .join("\n");
    } catch (e) {
      note(`provenance #${n}`, e);
    }
    cache.set(n, text);
    return text;
  };
}

/**
 * mtime (epoch ms) of the claim worktree `.claude/worktrees/<n>` under
 * `mainRoot` (the PRIMARY tree — worktrees never nest), or undefined when
 * absent. Absence is the common case, not an error.
 */
export async function worktreeClaimMtime(
  mainRoot: string,
  n: number,
): Promise<number | undefined> {
  try {
    const { stat } = await import("node:fs/promises");
    const s = await stat(resolve(mainRoot, ".claude", "worktrees", String(n)));
    return s.isDirectory() ? s.mtimeMs : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Fetch Issue `n`'s comments reduced to `ClaimComment`s. Returns undefined on a
 * fetch failure (the claim check degrades to worktree-only — never crashes the
 * run); the caller decides whether to surface a warning.
 */
export async function fetchClaimComments(
  n: number,
  cwd: string,
): Promise<ClaimComment[] | undefined> {
  try {
    const { stdout } = await execa(
      "gh",
      ["issue", "view", String(n), "--json", "comments"],
      { cwd },
    );
    const j = JSON.parse(stdout) as {
      comments?: Array<{ body?: string; createdAt?: string }>;
    };
    return (j.comments ?? []).map((c) => ({
      body: c.body ?? "",
      createdAtMs: Date.parse(c.createdAt ?? "") || 0,
    }));
  } catch {
    return undefined;
  }
}

/**
 * Full claim probe for one Issue (#811): worktree presence + start/stop
 * comments → `detectClaim`. Shared by this command's `main()` and
 * `tools/agent-bootstrap.ts`'s readiness rollup (single implementation, reused
 * — never duplicated). Never throws.
 */
export async function probeClaim(
  n: number,
  mainRoot: string,
  cwd: string,
  nowMs = Date.now(),
): Promise<ClaimSignal | null> {
  const [worktreeMtimeMs, comments] = await Promise.all([
    worktreeClaimMtime(mainRoot, n),
    fetchClaimComments(n, cwd),
  ]);
  return detectClaim({ worktreeMtimeMs, comments, nowMs });
}

/**
 * Resolve a same-feature EARS prose-ref to its sibling Issue, cached per
 * `feature:NNN-*` label. All Issues carrying the label (any state) are listed
 * once, then `findSiblingByEars` matches the title. A list failure degrades to
 * "no sibling" (the ref stays a conservative blocker) with a printed warning.
 */
function makeSiblingResolver() {
  const cache = new Map<string, SiblingIssue[]>();
  async function siblingsFor(featureLabel: string): Promise<SiblingIssue[]> {
    const hit = cache.get(featureLabel);
    if (hit) return hit;
    let sibs: SiblingIssue[] = [];
    try {
      const { stdout } = await execa(
        "gh",
        [
          "issue",
          "list",
          "--state",
          "all",
          "--label",
          featureLabel,
          "--limit",
          "300",
          "--json",
          "number,title,state",
        ],
        { cwd: REPO_ROOT },
      );
      sibs = (
        JSON.parse(stdout) as Array<{
          number: number;
          title: string;
          state: string;
        }>
      ).map((s) => ({
        number: s.number,
        title: s.title,
        state: s.state.toLowerCase() === "open" ? "open" : "closed",
      }));
    } catch (e) {
      note(`siblings ${featureLabel}`, e);
    }
    cache.set(featureLabel, sibs);
    return sibs;
  }
  return async function resolveSibling(
    featureLabel: string,
    ears: number,
  ): Promise<SiblingIssue | undefined> {
    return findSiblingByEars(await siblingsFor(featureLabel), ears);
  };
}

async function resolveDeps(
  issue: RawIssue,
  resolveState: (n: number) => Promise<{
    state: IssueState | "unknown";
    title?: string;
  }>,
  resolveSibling: (
    featureLabel: string,
    ears: number,
  ) => Promise<SiblingIssue | undefined>,
  provenanceText: (n: number) => Promise<string | undefined>,
): Promise<DepRef[]> {
  const deps: DepRef[] = [];

  // (1) native blocked_by graph. Each OPEN edge gets a provenance verdict
  // (#853): the body already in hand short-circuits the common case (a
  // prose-documented dep); otherwise both sides' body+comments are fetched
  // (cached) and evaluated. Closed edges never print — skip the round-trips.
  for (const d of await nativeBlockedBy(issue.number)) {
    const state: IssueState =
      d.state.toLowerCase() === "open" ? "open" : "closed";
    let rationale: Rationale | undefined;
    if (state === "open") {
      rationale = mentionsIssue(issue.body ?? "", d.number)
        ? "present"
        : evaluateRationale(
            issue.number,
            d.number,
            await provenanceText(issue.number),
            await provenanceText(d.number),
          );
    }
    deps.push({
      source: "native-blocked-by",
      number: d.number,
      state,
      title: d.title,
      rationale,
    });
  }

  const featureLabel = (issue.labels ?? [])
    .map((l) => l.name)
    .find((n) => n.startsWith("feature:"));

  // (2) prose "Blocked by …" clauses.
  for (const pb of parseProseBlockers(issue.body ?? "")) {
    if (pb.issues.length > 0) {
      for (const n of pb.issues) {
        const r = await resolveState(n);
        // A prose edge's rationale is present BY CONSTRUCTION — the blocked
        // body itself names the blocker (#853).
        deps.push({
          source: "prose",
          number: n,
          state: r.state,
          title: r.title,
          rationale: "present",
        });
      }
    } else if (pb.ears && pb.ears.length > 0) {
      // A prose ref to same-feature EARS handlers — resolve each against a
      // sibling Issue and treat a CLOSED sibling as a satisfied dependency.
      for (const e of pb.ears) {
        const sib = featureLabel
          ? await resolveSibling(featureLabel, e)
          : undefined;
        if (sib) {
          deps.push({
            source: "prose",
            ears: e,
            number: sib.number,
            state: sib.state,
            title: sib.title,
            rationale: "present",
          });
        } else {
          // Unresolvable (no feature label, or no sibling carries this EARS):
          // stay blocked, unchanged — fall back to the subsystem prose.
          deps.push({
            source: "prose",
            ears: e,
            subsystem: pb.subsystem ?? `EARS-${e}`,
          });
        }
      }
    } else if (pb.subsystem) {
      deps.push({ source: "prose", subsystem: pb.subsystem });
    }
  }

  return deps;
}

function ts(): string {
  return new Date().toISOString().slice(0, 16).replace("T", " ");
}

export function formatReport(
  triaged: Triage[],
  queueHeads: Array<{ track: string; head: string | null }> = [],
  waitForReuse: WaitForReuse[] = [],
): string {
  const out: string[] = [];
  // A WAIT-FOR-REUSE row is NOT takeable (#1873): the paired track is already
  // building the block, and offering it here is exactly the duplicate-build the
  // cross-front reuse rule forbids. It is listed in its own section, never hidden.
  const waiting = new Set(waitForReuse.map((w) => w.number));
  const takeable = triaged
    .filter((t) => t.readiness === "takeable" && !t.claim && !waiting.has(t.number))
    .sort((a, b) => a.number - b.number);
  const inFlight = triaged
    .filter((t) => t.readiness === "takeable" && t.claim)
    .sort((a, b) => a.number - b.number);
  const blocked = triaged
    .filter((t) => t.readiness === "blocked")
    .sort((a, b) => a.number - b.number);

  out.push(`# Backlog triage — ${ts()} UTC`);
  out.push(
    "Readiness resolved from the native `blocked_by` graph + prose \"Blocked by\" refs — NOT labels (AGENTS.md §3.5).",
  );
  out.push(
    `${triaged.length} open issue(s): ${takeable.length} takeable, ${
      inFlight.length > 0 ? `${inFlight.length} in-flight-elsewhere, ` : ""
    }${waitForReuse.length > 0 ? `${waitForReuse.length} wait-for-reuse, ` : ""}${blocked.length} blocked.`,
  );
  out.push("");

  // Stream split (#1009): product stream FIRST, each with its own count —
  // presentation grouping only, readiness stays graph-computed.
  const byStream = (items: Triage[], stream: Stream) =>
    items.filter((t) => t.stream === stream);
  const kindTag = (t: Triage) => (t.noKindLabel ? " (no kind label)" : "");

  // Queue grouping (#1855): QUEUE-HEAD / PLATFORM / EPIC rows first, then the
  // AHEAD-OF-QUEUE ones tagged with the head they jump. Presentation only —
  // nothing is hidden, and readiness stays graph-computed.
  const QUEUE_ORDER: QueuePosition[] = [
    "QUEUE-HEAD",
    "PLATFORM",
    "EPIC",
    "AHEAD-OF-QUEUE",
  ];
  const positionOf = (t: Triage): QueuePosition => t.queue?.position ?? "PLATFORM";
  const queueRank = (t: Triage) => QUEUE_ORDER.indexOf(positionOf(t));
  const queueTag = (t: Triage) => {
    if (!t.queue) return "";
    return t.queue.position === "AHEAD-OF-QUEUE"
      ? ` [AHEAD-OF-QUEUE (head: ${t.queue.head ?? "none"})]`
      : ` [${t.queue.position}]`;
  };

  out.push(`## Takeable (${takeable.length})`);
  out.push(
    "Rank takeable by value + readiness ONLY — owner Stage-B is a handback, not a deprioritizer (F-22; memory feedback_own_lead_decisions).",
  );
  if (queueHeads.length > 0) {
    for (const { track, head } of queueHeads)
      out.push(`- queue head: ${track} → ${head ?? "(no dated open release milestone)"}`);
    out.push(
      `Claim litmus before taking anything: «${LITMUS_LINE}» — an AHEAD-OF-QUEUE claim needs \`--ahead-of-queue "<owner quote>"\` (#1855).`,
    );
  }
  for (const stream of ["product", "process"] as const) {
    const items = byStream(takeable, stream).sort(
      (a, b) => queueRank(a) - queueRank(b) || a.number - b.number,
    );
    out.push(`### ${stream === "product" ? "Product" : "Process"} (${items.length})`);
    if (items.length === 0) out.push("(none)");
    for (const t of items) {
      const tag = t.isDecisionDebt
        ? " [decision-debt — deferred decision, deps all closed]"
        : "";
      out.push(
        `- #${t.number}${queueTag(t)}${tag} ${truncateTitle(t.title, 80)}${kindTag(t)}`,
      );
      for (const n of t.notes) out.push(`    ↳ (${n})`);
    }
  }
  out.push("");

  // Cross-front reuse collisions (#1873) — printed directly after Takeable so
  // the rows removed from it are visible in the same breath.
  out.push(formatWaitForReuse(waitForReuse));
  out.push("");

  // Parallel-session claim signal (#811): deps all closed, but another session
  // shows a claim (worktree / start-comment). Age is SURFACED, never
  // auto-suppressed — an abandoned claim is the human's call.
  if (inFlight.length > 0) {
    out.push(`## In flight elsewhere (${inFlight.length})`);
    out.push(
      "Deps all closed, but a parallel session shows a claim signal — a worktree `.claude/worktrees/<N>` or a start/claim comment newer than the last stop-state (repo-conventions.md → Issue conventions, #811). Verify before taking; an old age suggests an abandoned claim — human call, never auto-suppressed.",
    );
    for (const t of inFlight) {
      out.push(
        `- #${t.number} ${claimLabel(t.claim!)} — ${truncateTitle(t.title, 80)}`,
      );
    }
    out.push("");
  }

  out.push(`## Blocked (${blocked.length})`);
  for (const stream of ["product", "process"] as const) {
    const items = byStream(blocked, stream);
    out.push(`### ${stream === "product" ? "Product" : "Process"} (${items.length})`);
    if (items.length === 0) out.push("(none)");
    for (const t of items) {
      const tag = t.isDecisionDebt ? " [decision-debt]" : "";
      out.push(`- #${t.number}${tag} ${truncateTitle(t.title, 80)}${kindTag(t)}`);
      for (const r of t.reasons) out.push(`    ↳ ${r.text}`);
    }
  }
  out.push("");

  // Mega-blocker rollup (#853): a node blocking ≥5 open issues gets a per-edge
  // rationale present/ABSENT column, so an unexplained mega-blocker (the fake
  // `blocked_by → #729` critical path of 2026-07-13) is never relayed as ground
  // truth. Read-only — unwiring an orphan edge is an owner decision.
  const mega = findMegaBlockers(triaged);
  if (mega.length > 0) {
    out.push(`## Mega-blockers (a single node blocking ≥5 open issues)`);
    out.push(
      "Per-edge provenance — an ABSENT rationale (neither side's body/comments mentions the other) is a provenance-orphan edge to challenge, not ground truth (repo-conventions.md → Issue conventions).",
    );
    for (const m of mega) {
      const absent = m.edges.filter((e) => e.rationale === "absent").length;
      out.push(
        `- #${m.number} blocks ${m.edges.length} open issue(s)${
          absent > 0 ? ` — ${absent} edge(s) with NO recorded rationale` : ""
        }`,
      );
      for (const e of m.edges) {
        const verdict =
          e.rationale === "absent"
            ? "ABSENT ⚠"
            : (e.rationale ?? "unknown");
        out.push(`    ↳ #${e.blocked} rationale: ${verdict}`);
      }
    }
    out.push("");
  }

  return out.join("\n");
}

/** Default age (days) after which a claim with no open PR is a STALE-CLAIM (#1873). */
const DEFAULT_STALLED_DAYS = 3;

/**
 * `--stalled-days <n>` — the STALE-CLAIM threshold. A missing, non-numeric or
 * negative value falls back to the default rather than inventing a threshold.
 */
export function parseStalledDays(
  argv: string[],
  fallback = DEFAULT_STALLED_DAYS,
): number {
  const i = argv.indexOf("--stalled-days");
  if (i < 0) return fallback;
  const raw = argv[i + 1];
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

async function main(): Promise<void> {
  const stalledDays = parseStalledDays(process.argv.slice(2));
  // Freshness gate (#630): fetch origin/main first, then REFUSE if the local
  // `main` ref is behind — readiness computed from stale tool code / a stale
  // dependency graph is exactly the #624/#418 miss this command must prevent. A
  // fetch failure (offline) degrades to a stale banner and proceeds, never dies.
  const sync = evaluateMainSync(await probeMainSync(REPO_ROOT));
  if (shouldRefuseTriage(sync)) {
    const fix = mainSyncFixCommand(await primaryWorktreePath(REPO_ROOT));
    process.stderr.write(
      `🛑 [backlog-triage] REFUSING to triage: ${mainSyncMessage(sync)}.\n` +
        `The local tool code and dependency graph may be stale (#630/#418). ` +
        `Run this exact command, then re-run \`pnpm backlog:triage\`:\n` +
        `  ${fix}\n`,
    );
    process.exit(1);
  }
  const staleBanner = mainSyncMessage(sync); // null only when in-sync

  let issues: RawIssue[] = [];
  try {
    issues = await listOpenIssues();
  } catch (e) {
    note("gh issue list", e);
    process.stderr.write(
      `[backlog-triage] could not list open issues: ${String(e)}\n`,
    );
    process.exit(0);
  }

  const openNumbers = new Set(issues.map((i) => i.number));
  const resolveState = makeStateResolver(openNumbers);
  const resolveSibling = makeSiblingResolver();
  const provenanceText = makeProvenanceResolver();

  const triaged: Triage[] = [];
  // Native `blocked_by` presence per Issue — the orphan rule's first token
  // (#1873), taken from the SAME resolution pass so no second graph query runs.
  const hasNativeEdge = new Map<number, boolean>();
  for (const raw of issues) {
    const input: IssueInput = {
      number: raw.number,
      title: raw.title,
      labels: (raw.labels ?? []).map((l) => l.name),
    };
    const deps = await resolveDeps(
      raw,
      resolveState,
      resolveSibling,
      provenanceText,
    );
    hasNativeEdge.set(
      raw.number,
      deps.some((d) => d.source === "native-blocked-by"),
    );
    triaged.push(classify(input, deps));
  }

  // Parallel-session claim signal (#811) — takeable items only (a blocked item
  // is not offered, so a claim on it changes nothing). Worktrees live under the
  // PRIMARY tree even when this command runs from a linked worktree.
  const mainRoot = await primaryWorktreePath(REPO_ROOT);
  const nowMs = Date.now();
  for (const t of triaged) {
    if (t.readiness !== "takeable") continue;
    const claim = await probeClaim(t.number, mainRoot, REPO_ROOT, nowMs);
    if (claim) t.claim = claim;
  }

  // Queue position (#1855) — takeable items only, from the open milestones and
  // the SAME pure rules the claim guard uses.
  let milestones: MilestoneRecord[] = [];
  try {
    milestones = await listMilestones();
  } catch (e) {
    note("gh api milestones", e);
  }
  const rawByNumber = new Map(issues.map((raw) => [raw.number, raw]));
  for (const t of triaged) {
    if (t.readiness !== "takeable") continue;
    const raw = rawByNumber.get(t.number);
    const annotation = queueAnnotationFor(
      {
        title: t.title,
        labels: (raw?.labels ?? []).map((l) => l.name),
        milestone: raw?.milestone?.title ?? null,
      },
      milestones,
    );
    if (annotation) t.queue = annotation;
  }

  // ── grooming inputs (#1873) ───────────────────────────────────────────────
  // Every fetch below is best-effort: a failure degrades ITS section to a
  // `## Warnings` row, never kills the run (the #497 posture).
  const queueHeads = milestones.length > 0 ? trackQueueHeads(milestones) : [];
  const claimAgeByNumber = new Map<number, number | null>(
    triaged.map((t) => [t.number, t.claim?.ageMs ?? null]),
  );
  const groomIssues: StalledIssue[] = issues.map((raw) => ({
    number: raw.number,
    title: raw.title,
    labels: (raw.labels ?? []).map((l) => l.name),
    claimAgeMs: claimAgeByNumber.get(raw.number) ?? null,
  }));

  // One board scan feeds PR hygiene, roadmap hygiene AND the orphan rule's
  // sub-issue parent probe — never an `gh api issues/N` call per Issue.
  let board: Awaited<ReturnType<typeof listBoardRows>> | null = null;
  try {
    board = await listBoardRows();
    for (const t of board.truncations)
      warnings.push({ source: "board scan", message: t });
  } catch (e) {
    note("board scan", e);
  }
  const parented = new Set(
    (board?.issueRows ?? []).filter((r) => r.parent != null).map((r) => r.number),
  );

  let registry: CapabilityRow[] = [];
  try {
    registry = await readCapabilityRegistry();
  } catch (e) {
    note("capability registry", e);
  }
  const waitForReuse = findWaitForReuse(
    issues.map((raw) => ({
      number: raw.number,
      title: raw.title,
      track: trackOf((raw.labels ?? []).map((l) => l.name)) as string | null,
      reuse: parseReuseField(raw.body ?? ""),
      building: (claimAgeByNumber.get(raw.number) ?? null) != null,
    })),
    registry,
  );

  let mergedPrs: MergedPr[] = [];
  try {
    mergedPrs = await listMergedPrs();
  } catch (e) {
    note("gh pr list --state merged", e);
  }
  const openPrs: StalledOpenPr[] = [];
  try {
    for (const p of await listOpenPrs()) {
      let reviews: StalledOpenPr["reviews"] = [];
      try {
        reviews = await listPrReviews(p.number);
      } catch (e) {
        note(`gh api reviews #${p.number}`, e);
      }
      openPrs.push({ ...p, reviews });
    }
  } catch (e) {
    note("gh pr list --state open", e);
  }

  const out: string[] = [];
  if (staleBanner) out.push(`> ${staleBanner}`, "");
  out.push(formatReport(triaged, queueHeads, waitForReuse));

  out.push(
    formatOrphans(
      findOrphans(
        issues.map((raw) => ({
          number: raw.number,
          title: raw.title,
          labels: (raw.labels ?? []).map((l) => l.name),
          milestone: raw.milestone?.title ?? null,
          hasNativeBlockedBy: hasNativeEdge.get(raw.number) ?? false,
          hasParent: parented.has(raw.number),
        })),
        queueHeads,
      ),
      board != null,
    ),
    "",
  );
  out.push(
    formatStalled(
      findStalled({
        issues: groomIssues,
        openPrs,
        mergedPrs,
        stalledDays,
      }),
    ),
    "",
  );
  out.push(formatLikelyDone(findLikelyDone(groomIssues, mergedPrs)), "");
  out.push(
    formatReleaseRotation(
      releaseRotation(
        milestones,
        issues.map((raw) => ({ milestone: raw.milestone?.title ?? null })),
      ),
    ),
    "",
  );

  // Field hygiene (#1137): open Issues missing a required field. Silent when
  // every open Issue is compliant.
  const hygiene = formatFieldHygiene(
    issues.map((raw) => ({
      number: raw.number,
      missing: missingFields({
        number: raw.number,
        labels: (raw.labels ?? []).map((l) => l.name),
        hasType: !!raw.issueType?.name,
        hasMilestone: !!raw.milestone?.title,
        hasAssignee: (raw.assignees ?? []).length > 0,
      }),
    })),
  );
  if (hygiene) out.push(hygiene, "");

  // PR board hygiene (#1140) + roadmap hygiene (#1729): both fed by the SINGLE
  // paginated board scan run above (it also feeds the #1873 orphan rule).
  if (board) {
    const prHygiene = formatPrBoardHygiene(classifyPrBoardRows(board.prRows));
    if (prHygiene) out.push(prHygiene, "");
    const roadmap = formatRoadmapHygiene(roadmapHygiene(board.issueRows));
    if (roadmap) out.push(roadmap, "");
  }

  if (warnings.length > 0) {
    out.push("## Warnings");
    for (const w of warnings) out.push(`- ${w.source}: ${w.message}`);
    out.push("");
  }
  process.stdout.write(out.join("\n"));
}

// Run only as the entry point — importing the pure seams (`classify`,
// `parseProseBlockers`) into a unit test must NOT fire `main()`'s `gh` calls.
const INVOKED = process.argv[1] ? resolve(process.argv[1]) : "";
const IS_ENTRY = INVOKED === fileURLToPath(import.meta.url);
if (IS_ENTRY) {
  main().catch((e) => {
    process.stderr.write(`[backlog-triage] unexpected error: ${String(e)}\n`);
    process.exit(0);
  });
}
