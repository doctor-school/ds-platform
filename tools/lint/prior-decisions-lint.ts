#!/usr/bin/env tsx
/**
 * tools/lint/prior-decisions-lint.ts — WARN v1 (job `prior-decisions`) for the
 * ADR-0007 design §5.2 "Prior decisions cited" row ("New spec without cited ADRs
 * in 'Prior decisions' if category ≠ docs-only. Spec lint: `NNN-requirements.md`
 * has a section with ≥1 ADR-link").
 *
 * Was a `[stub]` exit-0 (never failed → vacuous green history, not promotable).
 * Implemented per Issue #438. Lands as a REAL WARN v1: exits non-zero on
 * findings; the CI job keeps `continue-on-error: true` until its ADR-0007 §2.6
 * promotion window matures. PR-event-gated and run by `pnpm pr:preflight` — so it
 * MUST exit 0 cleanly outside a PR context.
 *
 * ── The rule (exact) ──────────────────────────────────────────────────────────
 * For each feature-spec requirements file the PR adds or modifies
 * (`apps/docs/content/specs/features/<slug>/<nnn>-requirements*.md`), the file MUST contain
 * a `## Prior decisions` section whose body cites at least one ADR (`ADR-NNNN`).
 * A file with no such section, or a section citing zero ADRs, FAILS.
 *
 * ── Edge cases ────────────────────────────────────────────────────────────────
 * - **Section, not frontmatter.** The design says "a *section* with ≥1 ADR-link";
 *   this guard checks the markdown `## Prior decisions` heading + body, NOT the
 *   convenience `prior_decisions:` frontmatter list (a spec may carry both).
 * - **"category ≠ docs-only" is moot here.** Feature specs under `specs/features/`
 *   are implementation specs by definition — none is a docs-only spec (there is no
 *   `category:` frontmatter field to opt out). So every touched feature-spec
 *   requirements file is in scope; the docs-only exemption has no representation
 *   to honour. (Tech specs under `specs/tech/` are out of scope — not feature
 *   specs.)
 * - **Bilingual split.** `-en.md` / `-ru.md` / single `.md` are all matched; each
 *   touched variant is validated independently (both mirror the section).
 * - **Diff-scoped ("new spec").** Only requirements files IN THE PR DIFF are
 *   checked — a PR that touches no spec passes trivially. Existing specs on `main`
 *   are not re-scanned (they already satisfy the rule).
 * - Non-PR run, or a PR touching no requirements file → exit 0.
 *
 * Seams: `LINT_GH_FIXTURE_DIR` (gh pr view files) + `LINT_FIXTURE_ROOT` (spec
 * tree). Run: `pnpm lint:prior-decisions` (PR_NUMBER from Actions). Findings:
 * stderr + exit 1. Clean / skip: stdout + exit 0.
 */
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { ghViewJson } from "./lib/gh";

const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[prior-decisions]";

// A feature-spec requirements file (single, or bilingual -en / -ru).
const REQ_RE =
  /^apps\/docs\/content\/specs\/features\/[^/]+\/\d{3}-requirements(?:-[a-z]{2})?\.md$/;
// An ADR citation: `ADR-0002`, `**ADR-0013**`, … (4-digit id, 3-digit tolerated).
const ADR_RE = /\bADR-\d{3,4}\b/;
// The `## Prior decisions` heading (any level, case-insensitive).
const PRIOR_HEADING_RE = /^#{1,6}\s*prior\s+decisions\b.*$/im;
// A subsequent markdown heading that ends the section.
const NEXT_HEADING_RE = /\n#{1,6}\s/;

/** The `## Prior decisions` section body, or null when there is no such heading. */
function priorSection(text: string): string | null {
  const h = text.match(PRIOR_HEADING_RE);
  if (h?.index === undefined) return null;
  const rest = text.slice(h.index + h[0].length);
  const next = rest.search(NEXT_HEADING_RE);
  return next === -1 ? rest : rest.slice(0, next);
}

interface GhPR {
  number: number;
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

  const res = await ghViewJson<GhPR>("pr", prNumber, "number,files", REPO_ROOT);
  if (!res.ok) fail(`could not fetch PR #${prNumber} metadata: ${res.error}`);
  const pr = res.data;

  const reqFiles = (pr.files ?? [])
    .map((f) => f.path.replace(/\\/g, "/"))
    .filter((p) => REQ_RE.test(p));
  if (reqFiles.length === 0) {
    info(`PR #${pr.number} touches no feature-spec requirements file, rule does not apply`);
    process.exit(0);
  }
  info(`PR #${pr.number} touches ${reqFiles.length} requirements file(s): ${reqFiles.join(", ")}`);

  const failures: string[] = [];
  for (const rel of reqFiles) {
    let text: string;
    try {
      text = await readFile(resolve(REPO_ROOT, rel), "utf8");
    } catch (e) {
      // A DELETED requirements file appears in the diff but is absent from the
      // tree — nothing to validate.
      info(`${rel}: not present in the tree (deleted/renamed?), skipping — ${(e as Error).message.split("\n")[0]}`);
      continue;
    }
    const section = priorSection(text);
    if (section === null) {
      failures.push(`${rel}: no \`## Prior decisions\` section.`);
      continue;
    }
    if (!ADR_RE.test(section)) {
      failures.push(`${rel}: \`## Prior decisions\` section cites no ADR (need ≥1 \`ADR-NNNN\` link).`);
      continue;
    }
    info(`${rel}: Prior decisions section cites ≥1 ADR OK`);
  }

  if (failures.length > 0) {
    for (const f of failures) process.stderr.write(`${TAG} ${f}\n`);
    process.stderr.write(
      `${TAG} FAIL — every feature spec grounds itself in prior architecture: add a ` +
        `\`## Prior decisions\` section citing the ADR(s) it builds on (design §5.2 / ADR-0006 §7).\n`,
    );
    process.exit(1);
  }

  info(`all ${reqFiles.length} touched requirements file(s) cite ≥1 ADR in Prior decisions`);
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(
    `${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`,
  );
  process.exit(1);
});
