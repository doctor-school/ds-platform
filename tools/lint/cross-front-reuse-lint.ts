#!/usr/bin/env tsx
/**
 * tools/lint/cross-front-reuse-lint.ts — enforcement gate for the
 * "cross-front capability reuse before invention" rule (Issue #1821).
 *
 * Why this exists: AGENTS.md §6 ("Cross-front capability reuse before
 * invention") + ADR-0013 §A1 already say that every cross-front behaviour
 * (feed, card, calendar, filter, query/URL codec, live-state resolution,
 * room-entry policy, state machine, …) has ONE canonical core implementation
 * in a shared package (`packages/**`) or a shared service (`apps/api/**`), and
 * that each storefront adds only a thin host projection. The rule kept being
 * missed anyway: a capability that already ships on the Academy storefront
 * (`apps/portal`) was re-described as new work for the Doctor storefront
 * (`apps/doctor`), which the owner reads as «rebuilding what already works».
 * It lived as passive prose and never fired at the decision point.
 *
 * This gate makes it fire on the PR that actually writes the host code: a PR
 * touching either storefront's `app/` / `components/` / `lib/` tree must state,
 * in its body, WHICH canonical unit it consumed — or say `new` / `bespoke` with
 * a rationale. The checked-in answer key it points at is
 * `apps/docs/content/specs/product/two-site-ia/capability-ownership.md`.
 *
 * What it checks: if the PR diff touches any
 *   apps/portal/{app,components,lib}/**  or  apps/doctor/{app,components,lib}/**
 * source file (tests, specs and the `e2e/` tree are exempt — they ship no host
 * composition), the PR body MUST carry a `cross-front reuse:` marker line
 * (`cross-front-reuse:` is accepted too) or a `## Cross-front reuse` section,
 * whose value is evidence — one of:
 *   - it names the canonical location it consumed (a `packages/…` or
 *     `apps/api/…` path), e.g.
 *       cross-front reuse: consumes packages/design-system/src/blocks/event-list.tsx
 *   - or it declares `new` / `bespoke` / `n/a` WITH a rationale of at least 20
 *     characters, e.g.
 *       cross-front reuse: new — no shared unit exists for the sponsor banner; registry row added
 * An empty or placeholder marker (`tbd`, `n/a` alone, `<…>`) fails: a field the
 * author can leave blank is not evidence.
 *
 * Severity: WARN in Phase 0 (ADR-0007 §2.6 posture: new AI-specific guards land
 * as WARN, promote to BLOCK once stable). Its `pr-body-guards` batch step is
 * `continue-on-error`, so the non-zero exit below annotates without blocking.
 *
 * Non-PR runs, and PRs that touch no storefront host source → exit 0 with a
 * skip note. Failures: stderr, exit 1. Success: stdout summary, exit 0.
 *
 * Run: `pnpm lint:cross-front-reuse` (PR_NUMBER from the Actions context).
 */
import { ghViewJson } from "./lib/gh";

const TAG = "[cross-front-reuse]";

/** The two storefront hosts' composition trees — where a fork would land. */
const STOREFRONT_HOST_RE = /^apps\/(?:portal|doctor)\/(?:app|components|lib)\//;
/**
 * Test/E2E code inside those trees ships no host composition, so it never trips
 * the gate on its own — the same carve-out shape `lib/ui-surface.ts` uses for
 * the registry-research guard.
 */
const NON_HOST_SOURCE_RE =
  /(\.test\.[tj]sx?$|\.spec\.[tj]sx?$|\/__tests__\/|(^|\/)e2e\/)/;

function isStorefrontHostPath(path: string): boolean {
  if (NON_HOST_SOURCE_RE.test(path)) return false;
  return STOREFRONT_HOST_RE.test(path);
}

/**
 * The artifact: a `cross-front reuse:` marker line (hyphen or space between the
 * words, both accepted), or a `## Cross-front reuse` section heading followed
 * by its body. Either form is accepted.
 */
const MARKER_RE = /^[ \t>*-]*cross[ -]front[ -]reuse\s*:\s*(.*)$/im;
// NB: no `m` flag. Under `m` the `$` in the terminating lookahead matches at
// the first line END, so the lazy body capture stops empty and a valid section
// reads as a blank artifact. `(?:^|\n)` anchors the heading instead, and a
// non-multiline `$` means end-of-body.
const SECTION_RE =
  /(?:^|\n)#{1,6}[ \t]*cross[ -]front[ -]reuse\b[^\n]*\n([\s\S]*?)(?=\n#{1,6}[ \t]|$)/i;

/** A canonical location: a shared package or the shared API. */
const CANONICAL_PATH_RE = /\b(?:packages|apps\/api)\/[A-Za-z0-9._@/-]+/;
/** The declared-divergence vocabulary — allowed, but only with a rationale. */
const DIVERGENCE_RE = /\b(new|bespoke|n\/?a|none\s+exists)\b/i;
/** Values that read as "left blank" — rejected explicitly. */
const EMPTY_VALUE_RE = /^(|n\/?a|none|tbd|todo|xxx|\.\.\.|<.*>|_+|-+)$/i;
/** How much prose a declared-divergence marker must carry to count. */
const MIN_RATIONALE_CHARS = 20;

interface GhPR {
  number: number;
  body: string;
  files?: { path: string }[];
}

function fail(msg: string): never {
  process.stderr.write(`${TAG} ${msg}\n`);
  process.exit(1);
}
function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

function resolvePrNumber(): string {
  let prNumber = process.env.PR_NUMBER ?? process.env.GITHUB_PR_NUMBER ?? "";
  if (!prNumber && process.env.GITHUB_REF) {
    const m = process.env.GITHUB_REF.match(/refs\/pull\/(\d+)\//);
    if (m) prNumber = m[1];
  }
  return prNumber;
}

async function ghPR(prNumber: string): Promise<GhPR | null> {
  const res = await ghViewJson<GhPR>("pr", prNumber, "number,body,files");
  if (!res.ok) {
    process.stderr.write(`${TAG} gh pr view ${prNumber} failed: ${res.error}\n`);
    return null;
  }
  return res.data;
}

function extractArtifact(body: string): string | null {
  if (!body) return null;
  const marker = body.match(MARKER_RE);
  if (marker) return (marker[1] ?? "").trim();
  const section = body.match(SECTION_RE);
  if (section) return (section[1] ?? "").trim();
  return null;
}

function artifactIsEvidence(value: string): boolean {
  const firstLine = value.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  const v = firstLine.trim();
  if (EMPTY_VALUE_RE.test(v)) return false;
  // Naming the canonical unit is the primary, self-evidencing form.
  if (CANONICAL_PATH_RE.test(value)) return true;
  if (DIVERGENCE_RE.test(value)) {
    // A declared divergence must carry a real rationale, not just the word.
    return (
      value
        .replace(new RegExp(DIVERGENCE_RE.source, "gi"), "")
        .replace(/[—–\-:,.;]/g, " ")
        .trim().length >= MIN_RATIONALE_CHARS
    );
  }
  return false;
}

async function main(): Promise<void> {
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
    info(
      `not a pull_request event (GITHUB_EVENT_NAME=${process.env.GITHUB_EVENT_NAME ?? "unset"}), skipping`,
    );
    process.exit(0);
  }
  const prNumber = resolvePrNumber();
  if (!prNumber) {
    info("cannot determine PR number from environment, skipping");
    process.exit(0);
  }
  const pr = await ghPR(prNumber);
  if (!pr) fail(`could not fetch PR #${prNumber} metadata`);

  const files = (pr.files ?? []).map((f) => f.path);
  const hostFiles = files.filter(isStorefrontHostPath);
  if (hostFiles.length === 0) {
    info(
      `PR #${pr.number} touches no storefront host composition (apps/portal|doctor app|components|lib), rule does not apply`,
    );
    process.exit(0);
  }

  info(
    `PR #${pr.number} touches ${hostFiles.length} storefront host file(s), e.g. ${hostFiles
      .slice(0, 3)
      .join(", ")}`,
  );

  const artifact = extractArtifact(pr.body ?? "");
  if (artifact === null) {
    fail(
      `PR #${pr.number} touches a storefront host tree but carries no cross-front reuse artifact. ` +
        `Check the registry (apps/docs/content/specs/product/two-site-ia/capability-ownership.md) and add to the PR body either:\n` +
        `    cross-front reuse: consumes <packages/… | apps/api/… canonical path>\n` +
        `  or, when nothing canonical exists yet:\n` +
        `    cross-front reuse: new — <why no shared unit fits, and where the registry row now says so>`,
    );
  }
  if (!artifactIsEvidence(artifact)) {
    fail(
      `PR #${pr.number} has a cross-front reuse marker but its value is not evidence: "${artifact.slice(0, 80)}". ` +
        `Name the canonical unit you consumed (a packages/… or apps/api/… path), or declare new/bespoke with a rationale ` +
        `of at least ${MIN_RATIONALE_CHARS} characters. An empty/placeholder marker is not the artifact.`,
    );
  }

  info(
    `cross-front reuse artifact OK: "${artifact.split(/\r?\n/)[0].slice(0, 100)}"`,
  );
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(
    `${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`,
  );
  process.exit(1);
});
