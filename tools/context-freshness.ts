/**
 * tools/context-freshness.ts — the SessionStart release-notes reconciliation
 * seam (#927 core).
 *
 * Spec: apps/docs/content/specs/tech/2026-07-15-release-cycle-context-freshness-design-en.md
 *
 * Driver: session `5fbaaa9c` (2026-07-15) groomed the backlog three times on a
 * production model three releases stale, because `AGENTS.md §1`'s deploy-scope /
 * phase claim had silently fallen behind the shipped releases. Prose ("never say
 * no production") did NOT prevent stating a stale scope. The fix is a
 * DETERMINISTIC comparison at session start: read the date `AGENTS.md §1` was
 * last reconciled against a release (a machine-parseable marker), read the
 * latest release/changeset head date, and if §1 predates the head, flag it
 * loudly BEFORE the first grooming/triage output.
 *
 * Mirrors `tools/project-reality.ts` / `tools/main-sync.ts` EXACTLY: pure
 * parsers + a pure classifier (`evaluateContextStaleness`, no I/O) are exported
 * and unit-tested with fabricated inputs; a thin I/O probe
 * (`probeContextFreshness`) reads AGENTS.md + the CHANGELOG head + a `git log`
 * date and NEVER throws. It complements `project-reality.ts`: that section
 * surfaces the GitHub Release/Deployment reconciliation; this one adds the
 * CHANGELOG-head fallback (when NO GitHub Release is cut yet) and the §1
 * staleness flag.
 */
import { execa } from "execa";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { ReleaseInfo } from "./project-reality";

/** The authoritative CHANGELOG for the deployed app — its head version is the
 *  best "latest shipped" signal when no GitHub Release exists yet (the app whose
 *  SHA `/v1/health` reports). Repo-relative — resolved against `cwd`, never a
 *  hardcoded absolute path. */
export const AUTHORITATIVE_CHANGELOG_REL = "apps/api/CHANGELOG.md";

/** The `AGENTS.md §1` reconcile marker — a machine-parseable stamp of the date
 *  §1's deploy-scope pointer was last reconciled against a release. Parseable,
 *  in-repo, testable — the deterministic comparison target the #927 incident
 *  proves prose alone cannot be. */
const RECONCILED_MARKER_RE = /prod-reality-reconciled:\s*(\d{4}-\d{2}-\d{2})/;

/** Raw evidence gathered by `probeContextFreshness`, fed to the classifier +
 *  formatter. Every field degrades to `null` (+ an optional `*Error`) rather
 *  than throwing, exactly like `ProjectRealityProbe`. */
export interface ContextFreshnessProbe {
  /** ISO date (`YYYY-MM-DD`) the `AGENTS.md §1` marker was last reconciled, or
   *  `null` when the marker is absent / AGENTS.md was unreadable. */
  section1Date: string | null;
  /** First line of the error when reading/parsing AGENTS.md failed. */
  section1Error?: string;

  /** Display tag of the latest release/changeset head — a GitHub Release tag
   *  (`release-2026.07.15-1`) or, on fallback, the CHANGELOG head
   *  (`@ds/api 0.18.4`). `null` when neither source yielded a head. */
  headTag: string | null;
  /** ISO date (`YYYY-MM-DD`) of that head, or `null`. */
  headDate: string | null;
  /** One-line human scope of the head — only on the CHANGELOG-fallback path
   *  (GitHub Releases carry their scope on the Releases page). */
  headScope: string | null;
  /** Where the head came from: a GitHub `release`, a `changeset` CHANGELOG head,
   *  or `none` (neither available). */
  headSource: "release" | "changeset" | "none";
  /** First line of the error when the CHANGELOG-head fallback failed. */
  headError?: string;
}

/** Inputs to the pure staleness classifier — plain fields so it is trivially
 *  testable with fabricated dates (no probe object required). */
export interface StalenessInput {
  section1Date: string | null;
  headDate: string | null;
  headTag: string | null;
}

/** The staleness verdict. `stale` carries the tag to name in the flag; `fresh`
 *  = §1 is level-or-newer; `indeterminate` = a date was missing/unparseable, so
 *  NO flag is emitted (never a false positive). */
export type StalenessResult =
  | { kind: "stale"; tag: string }
  | { kind: "fresh" }
  | { kind: "indeterminate" };

function isoDayMs(iso: string): number {
  // Parse a bare `YYYY-MM-DD` at UTC midnight — day-granular comparison, so an
  // intraday clock difference never manufactures a stale flag.
  return Date.parse(`${iso}T00:00:00Z`);
}

/**
 * Classify staleness (NO I/O): if §1 was last reconciled BEFORE the latest
 * release/changeset head, the always-on scope prose may lag what shipped →
 * `stale`. Equal-day or newer → `fresh`. A missing/unparseable date →
 * `indeterminate` (never a false flag — the #927 fix must not itself cry wolf).
 */
export function evaluateContextStaleness(
  input: StalenessInput,
): StalenessResult {
  if (!input.section1Date || !input.headDate) return { kind: "indeterminate" };
  const s = isoDayMs(input.section1Date);
  const h = isoDayMs(input.headDate);
  if (Number.isNaN(s) || Number.isNaN(h)) return { kind: "indeterminate" };
  if (s < h) return { kind: "stale", tag: input.headTag ?? "(latest)" };
  return { kind: "fresh" };
}

/** The `## 1. …` section body of AGENTS.md, sliced at the next top-level `## N`
 *  heading. Matches the slicing in the D5 §1 guard-test so the marker is read
 *  from §1 ONLY (a later section's marker must never win). */
function sliceSection1(md: string): string {
  const start = md.search(/^## 1\.[^\n]*$/m);
  if (start === -1) return "";
  const rest = md.slice(start);
  const nextIdx = rest.slice(1).search(/^## \d/m);
  return nextIdx === -1 ? rest : rest.slice(0, nextIdx + 1);
}

/** Extract the `prod-reality-reconciled: YYYY-MM-DD` date from `AGENTS.md §1`,
 *  or `null` when §1 carries no marker. Pure. */
export function parseSection1ReconciledDate(md: string): string | null {
  const s1 = sliceSection1(md);
  const m = s1.match(RECONCILED_MARKER_RE);
  return m ? m[1]! : null;
}

/** Collapse a CHANGELOG bullet's markdown into a plain one-line scope: strip
 *  `[text](url)` links to `text`, drop bare `(url)`, collapse whitespace, and
 *  cap at 120 chars so the bootstrap line stays a one-liner. Pure. */
function toOneLineScope(raw: string): string {
  const plain = raw
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // [text](url) → text
    .replace(/`([^`]*)`/g, "$1") // `code` → code
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > 120 ? `${plain.slice(0, 117).trimEnd()}…` : plain;
}

/**
 * Parse the head of a changesets-authored CHANGELOG into `{ version, scope }`:
 * the package name (`# @ds/api`) + the top `## x.y.z` version, and the first
 * human scope line of that version's block (the text after the changesets
 * `Thanks …! - ` marker). `null` when there is no version heading yet. Pure.
 */
export function parseChangelogHead(
  text: string,
): { version: string; scope: string } | null {
  const nameMatch = text.match(/^#\s+(\S+)/m);
  const pkg = nameMatch ? nameMatch[1]! : null;

  const verMatch = text.match(/^##\s+(\d+\.\d+\.\d+[^\n]*)$/m);
  if (!verMatch) return null;
  const version = pkg
    ? `${pkg} ${verMatch[1]!.trim()}`
    : verMatch[1]!.trim();

  // The head version's block = from its heading to the next `## ` heading.
  const afterVer = text.slice(
    (verMatch.index ?? 0) + verMatch[0]!.length,
  );
  const nextVer = afterVer.search(/^##\s+/m);
  const block = nextVer === -1 ? afterVer : afterVer.slice(0, nextVer);

  // Changesets render each entry as `- […refs…] Thanks [@x]! - <scope>`; take
  // the text after the first `! - `. Fall back to the first non-empty bullet.
  const marked = block.match(/!\s*-\s*(.+)/);
  let scope = marked ? marked[1]! : "";
  if (!scope) {
    const bullet = block
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.startsWith("- "));
    scope = bullet ? bullet.replace(/^- /, "") : "";
  }
  return { version, scope: toOneLineScope(scope) };
}

/**
 * Render the freshness lines appended to the `## Project reality` section:
 * (1) a CHANGELOG-head fallback line (tag + date + scope) ONLY when no GitHub
 * Release drove the release line (else the reality section already showed it);
 * (2) a `§1 reconciled` line for provenance; (3) the LOUD stale banner when the
 * classifier says stale. Pure — no I/O.
 */
export function renderContextFreshness(
  probe: ContextFreshnessProbe,
  staleness: StalenessResult,
): string[] {
  const out: string[] = [];

  if (probe.headSource === "changeset" && probe.headTag) {
    const date = probe.headDate ?? "date unknown";
    const scope = probe.headScope ? ` — ${probe.headScope}` : "";
    out.push(
      `- Changeset head (no GitHub Release cut yet): ${probe.headTag} (${date})${scope}`,
    );
  }

  if (probe.section1Date) {
    const vs = probe.headDate ? ` (vs latest head ${probe.headDate})` : "";
    out.push(`- AGENTS.md §1 reconciled: ${probe.section1Date}${vs}`);
  }

  if (staleness.kind === "stale") {
    out.push(
      `> ⚠ **CONTEXT MAY BE STALE — reconcile §1/prod-reality with release ${staleness.tag} before triage.** ` +
        `AGENTS.md §1 was last reconciled on ${probe.section1Date} but a newer release/changeset head shipped since — ` +
        `re-derive the deployed scope from \`## Project reality\` + \`gh release list\` before the first grooming/triage output.`,
    );
  }

  return out;
}

// ── I/O probe seam (never throws) ───────────────────────────────────────────

function firstLine(e: unknown): string {
  return e instanceof Error ? e.message.split("\n")[0]! : String(e);
}

/**
 * Gather freshness evidence: the `AGENTS.md §1` reconcile date, and the latest
 * release/changeset head (tag + date + scope). A GitHub Release (from the
 * already-fetched `ReleaseInfo`) wins; when none exists yet the CHANGELOG head
 * is the fallback, dated by the commit that last touched it. NEVER throws:
 * every failure is captured in the returned probe so the SessionStart hook
 * degrades to a printable line instead of crashing.
 */
export async function probeContextFreshness(
  cwd: string,
  release: ReleaseInfo,
): Promise<ContextFreshnessProbe> {
  const probe: ContextFreshnessProbe = {
    section1Date: null,
    headTag: null,
    headDate: null,
    headScope: null,
    headSource: "none",
  };

  // 1. §1 reconcile date from AGENTS.md (repo-relative, resolved against cwd).
  try {
    const md = await readFile(resolve(cwd, "AGENTS.md"), "utf8");
    probe.section1Date = parseSection1ReconciledDate(md);
  } catch (e) {
    probe.section1Error = firstLine(e);
  }

  // 2. Latest release/changeset head. Priority order (spec §2 D4 / the Issue):
  //    a GitHub Release, else the authoritative CHANGELOG head.
  if (release.tag) {
    probe.headSource = "release";
    probe.headTag = release.tag;
    probe.headDate = release.publishedAt
      ? release.publishedAt.slice(0, 10)
      : null;
  } else {
    try {
      const text = await readFile(
        resolve(cwd, AUTHORITATIVE_CHANGELOG_REL),
        "utf8",
      );
      const head = parseChangelogHead(text);
      if (head) {
        probe.headSource = "changeset";
        probe.headTag = head.version;
        probe.headScope = head.scope;
        // CHANGELOGs carry no dates → date the head by the commit that last
        // touched the file (≈ when that version was cut/merged).
        try {
          const { stdout } = await execa(
            "git",
            ["log", "-1", "--format=%cI", "--", AUTHORITATIVE_CHANGELOG_REL],
            { cwd, timeout: 15000 },
          );
          const iso = stdout.trim();
          probe.headDate = iso ? iso.slice(0, 10) : null;
        } catch (e) {
          probe.headError = firstLine(e);
        }
      }
    } catch (e) {
      probe.headError = firstLine(e);
    }
  }

  return probe;
}
