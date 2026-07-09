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
 * The pure resolution/classification seams (`parseProseBlockers`, `classify`)
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
}

export interface IssueInput {
  number: number;
  title: string;
  labels: string[];
}

export type Readiness = "takeable" | "blocked";

export interface BlockReason {
  kind: "open-issue" | "absent-subsystem";
  number?: number;
  text: string;
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
  // `- None currently.` / `Nothing yet.` — its content (after any list marker
  // and emphasis) begins with "none"/"nothing". Must be skipped in BOTH the
  // section-bullet loop and the inline branch, else it parses to a bogus
  // `{subsystem: "None"}` and falsely reports the Issue blocked.
  const isNoBlockerText = (t: string) =>
    /^\s*(?:[-*]\s+)?(?:\*\*)?\s*(nothing|none)\b/i.test(t);

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
      const rest = m[1] ?? "";
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
        reasons.push({
          kind: "open-issue",
          number: d.number,
          text: `blocked by open ${earsTag}#${d.number}${
            d.title ? ` (${truncateTitle(d.title)})` : ""
          }`,
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

  return {
    number: issue.number,
    title: issue.title,
    readiness: reasons.length > 0 ? "blocked" : "takeable",
    reasons,
    notes,
    isDecisionDebt: issue.labels.includes("decision-debt"),
  };
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
      "number,title,body,labels",
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
): Promise<DepRef[]> {
  const deps: DepRef[] = [];

  // (1) native blocked_by graph.
  for (const d of await nativeBlockedBy(issue.number)) {
    deps.push({
      source: "native-blocked-by",
      number: d.number,
      state: d.state.toLowerCase() === "open" ? "open" : "closed",
      title: d.title,
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
        deps.push({ source: "prose", number: n, state: r.state, title: r.title });
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
    .filter((t) => t.readiness === "takeable")
    .sort((a, b) => a.number - b.number);
  const blocked = triaged
    .filter((t) => t.readiness === "blocked")
    .sort((a, b) => a.number - b.number);

  out.push(`# Backlog triage — ${ts()} UTC`);
  out.push(
    "Readiness resolved from the native `blocked_by` graph + prose \"Blocked by\" refs — NOT labels (AGENTS.md §3.5).",
  );
  out.push(
    `${triaged.length} open issue(s): ${takeable.length} takeable, ${blocked.length} blocked.`,
  );
  out.push("");

  out.push(`## Takeable (${takeable.length})`);
  if (takeable.length === 0) out.push("(none)");
  for (const t of takeable) {
    const tag = t.isDecisionDebt
      ? " [decision-debt — deferred decision, deps all closed]"
      : "";
    out.push(`- #${t.number}${tag} ${truncateTitle(t.title, 80)}`);
    for (const n of t.notes) out.push(`    ↳ (${n})`);
  }
  out.push("");

  out.push(`## Blocked (${blocked.length})`);
  if (blocked.length === 0) out.push("(none)");
  for (const t of blocked) {
    const tag = t.isDecisionDebt ? " [decision-debt]" : "";
    out.push(`- #${t.number}${tag} ${truncateTitle(t.title, 80)}`);
    for (const r of t.reasons) out.push(`    ↳ ${r.text}`);
  }
  out.push("");

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

  const triaged: Triage[] = [];
  for (const raw of issues) {
    const input: IssueInput = {
      number: raw.number,
      title: raw.title,
      labels: (raw.labels ?? []).map((l) => l.name),
    };
    const deps = await resolveDeps(raw, resolveState, resolveSibling);
    triaged.push(classify(input, deps));
  }

  const out: string[] = [];
  if (staleBanner) out.push(`> ${staleBanner}`, "");
  out.push(formatReport(triaged));
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
