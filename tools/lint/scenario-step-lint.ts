#!/usr/bin/env tsx
/**
 * tools/lint/scenario-step-lint.ts — BLOCK: a navigation OUTCOME step must name
 * its landing evidence (staging/regression-contour tech spec §6.2, Issue #2067).
 *
 * Why this exists: `Then the shell navigates to "/account/events"` asserts an
 * ADDRESS. A build that serves a 200 with the wrong page — the #2012 class, a
 * route whose runtime files are missing from the standalone image and that
 * renders a fallback — satisfies that step and the suite stays green. §6.2 makes
 * the destination, not the URL, the assertion: the accepted form is
 * `Then the shell lands on "/account/events" showing "Мои события"`, and the step
 * implementation asserts the pathname AND the evidence.
 *
 * ── What it scans ─────────────────────────────────────────────────────────────
 *   - `packages/e2e/steps/**\/*.ts`  — the shared step definitions (§6.1).
 *   - `apps/docs/content/specs/features/*\/*-scenarios.feature` — the suite (§6.1).
 *   - `apps/portal/e2e/features/*.feature` — the journey files not yet folded in.
 *
 * ── What it flags ─────────────────────────────────────────────────────────────
 * An OUTCOME step whose text matches `navigates to | opens | lands on` and does
 * NOT name landing evidence.
 *
 * «Outcome step» is the deliberate scope. In a feature file that is a `Then`
 * step, plus the `And`/`But` steps that continue a `Then` block; in a step
 * definition file it is a `Then(...)` binding. A `When the doctor opens the ≡
 * navigation` is an ACTION the person performs — §6.2's rule is about the
 * assertion of where they landed, and flagging actions would only teach authors
 * to reword the verb.
 *
 * «Landing evidence» is either form §6.2 names:
 *   - a `showing <evidence>` clause (`showing "Мои события"`, `showing {string}`), or
 *   - a `data-surface` marker anywhere in the step text.
 *
 * ── Output / severity ─────────────────────────────────────────────────────────
 * Each finding → stderr `relative/file:line -> <step text>`; exit 1 if any, else
 * exit 0. BLOCK by spec mandate (§6.2), registered in the `guards-block` CI job.
 *
 * Seam: `LINT_FIXTURE_ROOT` (guard-tests harness) points the scan at a fixture
 * tree; inert in production (unset → repo root from import.meta.url).
 * Run: `pnpm exec tsx tools/lint/scenario-step-lint.ts`.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import fg from "fast-glob";

import { touchedPaths } from "./lib/diff.js";

// TEST SEAM: `LINT_FIXTURE_ROOT` lets the guard-tests harness point the scan at a
// fixture tree. Inert in production — unset resolves to the repo root.
const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[scenario-step]";

const FEATURE_GLOBS = [
  "apps/docs/content/specs/features/*/*-scenarios.feature",
  "apps/portal/e2e/features/*.feature",
];
const STEP_GLOBS = ["packages/e2e/steps/**/*.ts"];
const SCAN_IGNORE = ["**/node_modules/**", "**/.features-gen/**", "**/.next/**"];

/** The navigation verbs §6.2 names. */
const NAV_RE = /\b(?:navigates?\s+to|re-?opens|opens|lands?\s+on)\b/i;
/** Landing evidence: a `showing <evidence>` clause or a `data-surface` marker. */
const EVIDENCE_RE = /\bshowing\b\s*\S|data-surface/i;
/**
 * A destination the step ASSERTS: a URL path token (`"/account/events"`,
 * `/webinars/[slug]`) or a cucumber parameter standing in for one
 * (`lands on {string}`). A step that merely says a panel «opens» names no
 * address, so §6.2's «200 on the wrong page» defect cannot hide in it and the
 * rule does not apply.
 */
const DESTINATION_RE = /(?:^|[\s"'«(])\/[A-Za-z0-9_\-./[\]{}]*|\{(?:string|word|int)\}/;
/**
 * A negative assertion (`the visitor never lands on /`). It asserts the ABSENCE
 * of a destination, so there is no landing whose evidence could be named.
 */
const NEGATION_RE = /\b(?:never|not|no longer)\b/i;

/** A Gherkin step line: `<keyword> <text>`. */
const GHERKIN_STEP_RE = /^\s*(Given|When|Then|And|But|\*)\s+(.+?)\s*$/;
/** A playwright-bdd outcome binding: `Then("…", …)` / `Then('…', …)`. */
const THEN_BINDING_RE =
  /(?:^|[^A-Za-z0-9_.])Then\s*\(\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

/** Repo-relative, POSIX-slashed path — the form the git diff set uses. */
function relPath(file: string): string {
  return relative(REPO_ROOT, file).split(sep).join("/");
}

export interface Finding {
  file: string;
  line: number;
  step: string;
}

/** Does a step text assert a destination without naming the landing evidence? */
export function isBareNavigationStep(text: string): boolean {
  if (!NAV_RE.test(text)) return false;
  if (!DESTINATION_RE.test(text)) return false; // no address asserted
  if (NEGATION_RE.test(text)) return false; // absence assertion
  return !EVIDENCE_RE.test(text);
}

/**
 * Scan a `.feature` file. Only OUTCOME steps are checked: a `Then`, and the
 * `And`/`But`/`*` steps that continue a `Then` block (Gherkin conjunction steps
 * inherit the keyword of the last primary step).
 */
export function scanFeatureText(text: string): Omit<Finding, "file">[] {
  const findings: Omit<Finding, "file">[] = [];
  let context: "given" | "when" | "then" | null = null;
  text.split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.replace(/\s+#.*$/, "");
    if (/^\s*#/.test(raw)) return; // comment line
    const m = line.match(GHERKIN_STEP_RE);
    if (!m) {
      // A Scenario/Background/Feature header resets the conjunction context.
      if (/^\s*(Feature|Background|Scenario|Scenario Outline|Example|Rule)\b/.test(line)) {
        context = null;
      }
      return;
    }
    const keyword = m[1];
    const step = m[2];
    if (keyword === "Given") context = "given";
    else if (keyword === "When") context = "when";
    else if (keyword === "Then") context = "then";
    if (context !== "then") return;
    if (isBareNavigationStep(step)) findings.push({ line: idx + 1, step });
  });
  return findings;
}

/** Scan a step-definition source for `Then("…")` bindings. */
export function scanStepDefText(text: string): Omit<Finding, "file">[] {
  const findings: Omit<Finding, "file">[] = [];
  text.split(/\r?\n/).forEach((line, idx) => {
    THEN_BINDING_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = THEN_BINDING_RE.exec(line)) !== null) {
      const step = m[1] ?? m[2] ?? m[3];
      if (isBareNavigationStep(step)) findings.push({ line: idx + 1, step });
    }
  });
  return findings;
}

async function main(): Promise<void> {
  const features = await fg(FEATURE_GLOBS, {
    cwd: REPO_ROOT,
    ignore: SCAN_IGNORE,
    absolute: true,
  });
  const stepDefs = await fg(STEP_GLOBS, {
    cwd: REPO_ROOT,
    ignore: SCAN_IGNORE,
    absolute: true,
  });

  const findings: Finding[] = [];
  for (const file of features) {
    for (const f of scanFeatureText(readFileSync(file, "utf8"))) {
      findings.push({ file, ...f });
    }
  }
  for (const file of stepDefs) {
    for (const f of scanStepDefText(readFileSync(file, "utf8"))) {
      findings.push({ file, ...f });
    }
  }

  info(
    `scanned ${features.length} feature file(s) and ${stepDefs.length} step-definition source(s).`,
  );

  if (findings.length === 0) {
    info(
      "PASS — every navigation outcome step names its landing evidence (§6.2).",
    );
    process.exit(0);
  }

  // §6.4 severity model, applied to §6.2's rule: the check on what THIS PR wrote
  // is a hard BLOCK; scenario prose authored before the contract existed reports
  // as a WARN row until the §8 backfill waves fold the journey files in. An
  // unavailable diff (`null`) is «severity unknown» — report, never block.
  const touched = await touchedPaths(REPO_ROOT);
  const blocking: Finding[] = [];
  const warning: Finding[] = [];
  for (const f of findings) {
    const rel = relPath(f.file);
    (touched?.has(rel) ? blocking : warning).push(f);
  }

  for (const f of warning) {
    process.stdout.write(
      `${TAG} WARN ${relPath(f.file)}:${f.line} -> ${f.step}\n`,
    );
  }
  if (warning.length > 0) {
    info(
      `${warning.length} pre-existing bare navigation step(s) in files this PR ` +
        `did not touch — WARN until the §8 backfill waves reword them.`,
    );
  }
  if (touched === null) {
    info(
      "the PR diff was unavailable (no base ref), so every finding is reported " +
        "as a WARN row rather than guessed into a BLOCK.",
    );
  }

  if (blocking.length === 0) {
    info("PASS — no navigation outcome step this PR touched is missing its landing evidence (§6.2).");
    process.exit(0);
  }

  for (const f of blocking) {
    process.stderr.write(`${TAG} ${relPath(f.file)}:${f.line} -> ${f.step}\n`);
  }
  process.stderr.write(
    `${TAG} FAIL — ${blocking.length} navigation outcome step(s) THIS PR touched ` +
      `assert an ADDRESS with no landing evidence, so a 200 on the wrong page ` +
      `passes them (tech spec §6.2). Name the destination: ` +
      `\`Then the shell lands on "/account/events" showing "Мои события"\`, and ` +
      `assert BOTH the pathname and the evidence in the step implementation ` +
      `(a \`data-surface\` marker is the accepted alternative to an h1).\n`,
  );
  process.exit(1);
}

main().catch((e) => {
  process.stderr.write(
    `${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`,
  );
  process.exit(1);
});
