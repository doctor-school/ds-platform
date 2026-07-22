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
 * The pure resolution/classification seams (`parseProseBlockers`, `classify`,
 * `detectClaim`)
 * are exported and unit-tested (tools/lint/guard-tests/backlog-triage.spec.ts)
 * WITHOUT firing the `gh` subprocesses — the `main()` entry point is guarded.
 *
 * Never throws for a per-Issue failure: a graph-query error degrades that one
 * Issue to "unresolved" with a printed warning, never crashes the run.
 */
import { execa } from "execa";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
 * A `Blocked by nothing` / `Blocked by none` clause yields NO blocker (so a
 * "landed in #460" mention inside it is never mistaken for a live dep). Only the
 * explicit "Blocked by" surface counts — a "Sub-issue of #N" / "Successor to #N"
 * / "Parent epic: #N" / "Related: #N" reference is hierarchy or lineage, NEVER a
 * blocker, and is deliberately ignored.
 */
export function parseProseBlockers(body: string): ProseBlocker[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const items: string[] = [];

  const isHeading = (l: string) => /^\s{0,3}#{1,6}\s/.test(l);
  const isBlockedByHeading = (l: string) =>
    /^\s{0,3}#{1,6}\s+blocked\s+by\b/i.test(l);
  const isBullet = (l: string) => /^\s*[-*]\s+/.test(l);
  // A placeholder bullet/clause that explicitly declares NO blocker, e.g.
  // `- None currently.` / `Nothing yet.` / the template's canonical empty marker
  // `**Blocked by:** — · **Blocks:** —` (em/en-dash / hyphen / `n/a` / `tbd`).
  // Must be skipped in BOTH the section-bullet loop and the inline branch, else
  // it parses to a bogus `{subsystem: "—"}` and falsely reports the Issue blocked
  // (#919 — six takeable Issues mis-reported). We normalise off any list marker
  // and surrounding emphasis before matching.
  const isNoBlockerText = (t: string) => {
    const stripped = t
      .replace(/^\s*(?:[-*]\s+)?/, "") // list marker
      .replace(/^\s*\*\*\s*/, "") // opening emphasis
      .replace(/\s*\*\*\s*$/, "") // closing emphasis
      .trim();
    return (
      /^(?:nothing|none)\b/i.test(stripped) ||
      /^(?:n\/a|tbd|[—–-])$/i.test(stripped)
    );
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

export function formatReport(triaged: Triage[]): string {
  const out: string[] = [];
  const takeable = triaged
    .filter((t) => t.readiness === "takeable" && !t.claim)
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
    }${blocked.length} blocked.`,
  );
  out.push("");

  // Stream split (#1009): product stream FIRST, each with its own count —
  // presentation grouping only, readiness stays graph-computed.
  const byStream = (items: Triage[], stream: Stream) =>
    items.filter((t) => t.stream === stream);
  const kindTag = (t: Triage) => (t.noKindLabel ? " (no kind label)" : "");

  out.push(`## Takeable (${takeable.length})`);
  out.push(
    "Rank takeable by value + readiness ONLY — owner Stage-B is a handback, not a deprioritizer (F-22; memory feedback_own_lead_decisions).",
  );
  for (const stream of ["product", "process"] as const) {
    const items = byStream(takeable, stream);
    out.push(`### ${stream === "product" ? "Product" : "Process"} (${items.length})`);
    if (items.length === 0) out.push("(none)");
    for (const t of items) {
      const tag = t.isDecisionDebt
        ? " [decision-debt — deferred decision, deps all closed]"
        : "";
      out.push(`- #${t.number}${tag} ${truncateTitle(t.title, 80)}${kindTag(t)}`);
      for (const n of t.notes) out.push(`    ↳ (${n})`);
    }
  }
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

async function main(): Promise<void> {
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

  const out: string[] = [];
  if (staleBanner) out.push(`> ${staleBanner}`, "");
  out.push(formatReport(triaged));

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
