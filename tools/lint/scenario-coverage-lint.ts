#!/usr/bin/env tsx
/**
 * tools/lint/scenario-coverage-lint.ts — the EARS-to-scenario coverage lint of
 * the regression contour (tech spec §6.4 + §6.5, Issue #2067).
 *
 * Why this exists: coverage of a user-facing handler by an end-to-end scenario
 * was a reviewer's memory. §6.4 makes it an exit code: for every feature spec
 * whose `NNN-requirements*.md` frontmatter says `surface: user-facing`, every
 * `EARS-N` handler declared in that file must appear as an `@EARS-N` tag in the
 * sibling `NNN-scenarios.feature`, on a scenario that is NOT quarantined.
 *
 * Handlers. A handler is a clause DECLARATION — the repo's flat-numbering list
 * item `- **EARS-N** …` (ADR-0006 §4). A prose cross-reference to another
 * spec's clause is not a declaration and is not required to be covered. A
 * declaration marked `_Retired._` carries no handler and is skipped (008
 * EARS-10's pattern: the id is kept only to preserve flat numbering).
 *
 * Quarantine (§6.5). `@quarantine(#N)` on a scenario parks it: it counts as
 * ABSENT for coverage, so a quarantined `@EARS-N` shows as uncovered. `#N` must
 * be an OPEN Issue naming the scenario — a bare `@quarantine` with no Issue, or
 * one whose Issue is CLOSED, is a finding at BLOCK severity wherever it sits,
 * because a quarantine nobody tracks is a test switched off for good.
 *
 * Severity (§6.4). BLOCK for a spec this PR created or modified (either the
 * requirements file or its feature file); a WARN report row for untouched specs,
 * until the §8 backfill waves close. So the guard exits 1 only on coverage the
 * author of THIS PR is responsible for, plus any bad quarantine. Registered in
 * the `guards-block` CI job: it self-limits its own exit code, so the WARN rows
 * never block a merge, and a real finding is a red check the moment it appears.
 *
 * Sign-in-host binding (#3345 item 3, ADR-0015 §4). A scenario names the door
 * it journeys through with a scenario-level `@door:<login|register|reset|verify>`
 * tag. Once that door is `mounted` on the sign-in host — the row
 * `apps/login/app/<door>/page.tsx` of the route-mount registry («## Route-file
 * registry» in `capability-ownership.md`, read by the one shared parser
 * `lib/registry-rows.ts`) — the scenario must carry the sign-in-host binding
 * `@host:login`, which puts it in the `login` Gherkin project of `packages/e2e`.
 * That project generates with `missingSteps: "fail-on-gen"`, so a bound scenario
 * with no step definitions fails `bddgen` instead of becoming a skip. The only
 * exclusion is a host quarantine `@quarantine:login(#N)` naming an OPEN Issue
 * (checked exactly like `@quarantine(#N)`); unlike the ordinary quarantine it
 * removes the scenario from the sign-in-host binding only, so its `@EARS-N` tags
 * still count for coverage on the storefront project. A free-text comment
 * («… not shared-sign-in-host acceptance») is no exclusion and is itself a
 * finding, as are an unknown door name, a binding plus a host quarantine on
 * one scenario, and a binding on a `@default-auth-limits` scenario — the `login`
 * project excludes that tag, so the binding would be counted while no project
 * runs it. These findings are BLOCK wherever they sit, from day 0 rather than
 * the ADR-0007 §2.6 WARN v1 default: Issue #3345 (owner-sourced) requires the
 * sign-in-host binding under `scenario-coverage (BLOCK)`, and the catalog
 * carries no backfill debt of the rule. The §2.6 demotion rule still applies —
 * one confirmed false positive demotes it to WARN.
 *
 * Seams: `LINT_FIXTURE_ROOT` (spec tree), `LINT_GH_FIXTURE_DIR` (lib/gh.ts —
 * canned `gh issue view` JSON for the quarantine check),
 * `LINT_DIFF_NAMESTATUS_FILE` / `LINT_DIFF_BASE` (lib/diff.ts — touched set).
 * All inert in production.
 * Run: `pnpm exec tsx tools/lint/scenario-coverage-lint.ts`.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname, relative, sep, join } from "node:path";
import { fileURLToPath } from "node:url";
import fg from "fast-glob";

import { ghViewJson } from "./lib/gh.js";
import { touchedPaths } from "./lib/diff.js";
import { parseRegistryRows } from "./lib/registry-rows.js";

const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[scenario-coverage]";

/** The EN/base requirements file of each spec (the RU twin is a translation). */
const REQUIREMENTS_GLOB =
  "apps/docs/content/specs/features/*/*-requirements*.md";
const REQUIREMENTS_IGNORE = ["**/node_modules/**", "**/*-requirements-ru.md"];

/** A handler DECLARATION list item. */
const HANDLER_RE = /^\s*[-*]\s+\*\*EARS-(\d+)\*\*/;
/** A retired id keeps flat numbering but declares no handler. */
const RETIRED_RE = /_Retired\._/i;
/** A Gherkin tag line (only tag tokens on it). */
const TAG_LINE_RE = /^\s*@\S+(\s+@\S+)*\s*$/;
const SCENARIO_RE = /^\s*(Scenario|Scenario Outline|Example)\b/;
const FEATURE_RE = /^\s*Feature\b/;
const EARS_TAG_RE = /^@EARS-(\d+)$/;
const QUARANTINE_RE = /^@quarantine(?:\((#?\d+)\))?$/i;

/** The doors `@ds/auth-flow` renders; each is a sign-in-host route once mounted. */
export const DOORS = ["login", "register", "reset", "verify"] as const;
const DOOR_TAG_RE = /^@door:(\S*)$/;
/** The scenario-level sign-in-host binding (selected by the `login` e2e project). */
export const SIGN_IN_HOST_BINDING = "@host:login";
/** The loopback default-limits contour the `login` project never selects. */
const DEFAULT_AUTH_LIMITS = "@default-auth-limits";
const HOST_QUARANTINE_RE = /^@quarantine:login(?:\((#?\d+)\))?$/i;
/** The free-text exclusion form #3345 retires: a comment is not a quarantine. */
const COMMENT_EXCLUSION_RE = /^\s*#.*sign-in-host acceptance/i;
const ROUTE_REGISTRY_HEADING = "## Route-file registry";
const FEATURE_GLOB = "apps/docs/content/specs/features/*/*-scenarios.feature";

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

/** Repo-relative, POSIX-slashed path — the form the git diff set uses. */
function relPath(file: string): string {
  return relative(REPO_ROOT, file).split(sep).join("/");
}

export interface ScenarioTags {
  line: number;
  tags: string[];
}

/**
 * Parse a `.feature` file into one entry per scenario, carrying the scenario's
 * own tags plus the feature-level tags (Gherkin tag inheritance).
 */
export function parseScenarios(text: string): ScenarioTags[] {
  const lines = text.split(/\r?\n/);
  const scenarios: ScenarioTags[] = [];
  let pending: string[] = [];
  let featureTags: string[] = [];
  let seenFeature = false;
  lines.forEach((raw, idx) => {
    if (/^\s*#/.test(raw)) return;
    if (TAG_LINE_RE.test(raw)) {
      pending.push(...raw.trim().split(/\s+/).filter(Boolean));
      return;
    }
    if (!seenFeature && FEATURE_RE.test(raw)) {
      seenFeature = true;
      featureTags = pending;
      pending = [];
      return;
    }
    if (SCENARIO_RE.test(raw)) {
      scenarios.push({ line: idx + 1, tags: [...featureTags, ...pending] });
      pending = [];
      return;
    }
    if (raw.trim() === "") return;
    // Any other content line ends a tag block that belongs to no scenario.
    if (pending.length > 0) pending = [];
  });
  return scenarios;
}

/** The handler ids declared in a requirements file (retired ids excluded). */
export function declaredHandlers(text: string): number[] {
  const ids: number[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(HANDLER_RE);
    if (!m) continue;
    if (RETIRED_RE.test(line)) continue;
    ids.push(Number(m[1]));
  }
  return [...new Set(ids)].sort((a, b) => a - b);
}

/** Is the frontmatter's `surface:` key `user-facing`? */
export function isUserFacing(text: string): boolean {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return false;
  return /^surface:\s*user-facing\s*$/m.test(fm[1]);
}

interface Quarantine {
  file: string;
  line: number;
  raw: string;
  issue: number | null;
}

interface SpecReport {
  slug: string;
  feature: string | null;
  declared: number[];
  covered: Set<number>;
  quarantined: Set<number>;
  touched: boolean;
}

/** The doors whose sign-in-host route the route-mount registry marks `mounted`. */
export function mountedDoors(
  rows: readonly { path: string; until: string }[],
): Set<string> {
  const mounted = new Set<string>();
  for (const door of DOORS) {
    const row = rows.find((r) => r.path === `apps/login/app/${door}/page.tsx`);
    if (row && row.until.trim() === "mounted") mounted.add(door);
  }
  return mounted;
}

interface DoorScan {
  findings: string[];
  hostQuarantines: Quarantine[];
  bound: number;
  quarantined: number;
}

/** The sign-in-host binding rule over every spec feature file (header above). */
async function scanDoorBindings(): Promise<DoorScan> {
  const files = await fg([FEATURE_GLOB], {
    cwd: REPO_ROOT,
    ignore: ["**/node_modules/**"],
    absolute: true,
  });
  const scan: DoorScan = {
    findings: [],
    hostQuarantines: [],
    bound: 0,
    quarantined: 0,
  };
  // Read lazily: a tree with no `@door:` tag needs no registry.
  let mounted: Set<string> | undefined;
  let registryError = "";
  const doorsMounted = (): Set<string> | null => {
    if (mounted === undefined && registryError === "") {
      try {
        mounted = mountedDoors(parseRegistryRows(ROUTE_REGISTRY_HEADING));
      } catch (e) {
        registryError = (e as Error).message;
      }
    }
    return mounted ?? null;
  };
  for (const file of files.sort()) {
    const rel = relPath(file);
    const text = readFileSync(file, "utf8");
    text.split(/\r?\n/).forEach((line, idx) => {
      if (COMMENT_EXCLUSION_RE.test(line)) {
        scan.findings.push(
          `${rel}:${idx + 1} -> a comment-only sign-in-host exclusion; bind the ` +
            `scenario with ${SIGN_IN_HOST_BINDING} or park it with @quarantine:login(#N)`,
        );
      }
    });
    for (const scenario of parseScenarios(text)) {
      const where = `${rel}:${scenario.line}`;
      const doors = scenario.tags
        .map((t) => t.match(DOOR_TAG_RE))
        .filter((m): m is RegExpMatchArray => m !== null)
        .map((m) => m[1]);
      const hostQ = scenario.tags
        .map((t) => t.match(HOST_QUARANTINE_RE))
        .find((m) => m !== null);
      const bound = scenario.tags.includes(SIGN_IN_HOST_BINDING);
      // The `login` project starts its journeys on the Academy entry
      // (`packages/e2e/playwright.config.ts`): a binding in a doctor-only or
      // admin feature would run against the wrong storefront.
      if (
        bound &&
        !scenario.tags.includes("@host:academy") &&
        !scenario.tags.includes("@host:both")
      ) {
        scan.findings.push(
          `${where} -> ${SIGN_IN_HOST_BINDING} outside an Academy feature; the ` +
            `login project starts on the Academy entry only`,
        );
      }
      // The `login` project excludes `@default-auth-limits` (`signInHostTags()`
      // in `packages/e2e/lib/host-tags.ts`): those scenarios run only on the
      // loopback storefront contour, so such a binding selects nothing on the
      // sign-in host. Counting it bound would let the guard vouch for a run that
      // never happens; park it with `@quarantine:login(#N)` instead.
      const unrunnable = bound && scenario.tags.includes(DEFAULT_AUTH_LIMITS);
      if (unrunnable) {
        scan.findings.push(
          `${where} -> ${SIGN_IN_HOST_BINDING} on a ${DEFAULT_AUTH_LIMITS} scenario; ` +
            `no e2e project runs that binding — park it with @quarantine:login(#N)`,
        );
      }
      if (hostQ) {
        scan.hostQuarantines.push({
          file,
          line: scenario.line,
          raw: hostQ[0],
          issue: hostQ[1] ? Number(hostQ[1].replace("#", "")) : null,
        });
        if (bound) {
          scan.findings.push(
            `${where} -> ${SIGN_IN_HOST_BINDING} and ${hostQ[0]} on one scenario; ` +
              `a scenario is either bound to the sign-in host or parked from it`,
          );
        }
      }
      for (const door of doors) {
        if (!(DOORS as readonly string[]).includes(door)) {
          scan.findings.push(
            `${where} -> unknown door @door:${door} (expected one of ` +
              DOORS.map((d) => `@door:${d}`).join(", ") +
              `)`,
          );
          continue;
        }
        const live = doorsMounted();
        if (live === null) {
          scan.findings.push(
            `${where} -> @door:${door} cannot be checked: ${registryError}`,
          );
          continue;
        }
        if (!live.has(door)) continue;
        if (unrunnable) continue;
        if (bound) scan.bound += 1;
        else if (hostQ) scan.quarantined += 1;
        else {
          scan.findings.push(
            `${where} -> @door:${door} is mounted on the sign-in host, but the ` +
              `scenario has no ${SIGN_IN_HOST_BINDING} binding (or a tracked ` +
              `@quarantine:login(#N))`,
          );
        }
      }
    }
  }
  return scan;
}

async function main(): Promise<void> {
  const reqFiles = await fg([REQUIREMENTS_GLOB], {
    cwd: REPO_ROOT,
    ignore: REQUIREMENTS_IGNORE,
    absolute: true,
  });

  const touched = await touchedPaths(REPO_ROOT);
  const reports: SpecReport[] = [];
  const quarantines: Quarantine[] = [];

  for (const reqFile of reqFiles) {
    const reqText = readFileSync(reqFile, "utf8");
    if (!isUserFacing(reqText)) continue; // backend-only owns Vitest e2e (F-22)
    const declared = declaredHandlers(reqText);
    if (declared.length === 0) continue;

    const dir = dirname(reqFile);
    const slug = relPath(dir).split("/").pop() ?? relPath(dir);
    const prefix = slug.split("-")[0];
    const featureFile = join(dir, prefix + "-scenarios.feature");
    const hasFeature = existsSync(featureFile);

    const covered = new Set<number>();
    const quarantined = new Set<number>();
    if (hasFeature) {
      const featureText = readFileSync(featureFile, "utf8");
      for (const scenario of parseScenarios(featureText)) {
        const q = scenario.tags
          .map((t) => t.match(QUARANTINE_RE))
          .find((m) => m !== null);
        const ears = scenario.tags
          .map((t) => t.match(EARS_TAG_RE))
          .filter((m): m is RegExpMatchArray => m !== null)
          .map((m) => Number(m[1]));
        if (q) {
          quarantines.push({
            file: featureFile,
            line: scenario.line,
            raw: q[0],
            issue: q[1] ? Number(q[1].replace("#", "")) : null,
          });
          // §6.5: a quarantined scenario counts as ABSENT for coverage.
          for (const id of ears) quarantined.add(id);
          continue;
        }
        for (const id of ears) covered.add(id);
      }
    }

    const reqRel = relPath(reqFile);
    const featureRel = hasFeature ? relPath(featureFile) : null;
    reports.push({
      slug,
      feature: featureRel,
      declared,
      covered,
      quarantined,
      touched:
        touched !== null &&
        (touched.has(reqRel) ||
          (featureRel !== null && touched.has(featureRel))),
    });
  }

  const doorScan = await scanDoorBindings();
  quarantines.push(...doorScan.hostQuarantines);

  // §6.5 — every quarantine must name an OPEN Issue. BLOCK wherever it sits: a
  // quarantine nobody tracks is a test switched off for good, not backfill debt.
  const badQuarantines: string[] = [];
  for (const q of quarantines) {
    if (q.issue === null) {
      badQuarantines.push(
        `${relPath(q.file)}:${q.line} -> ${q.raw} names no Issue`,
      );
      continue;
    }
    const res = await ghViewJson<{ state?: string }>(
      "issue",
      q.issue,
      "state",
      REPO_ROOT,
    );
    if (!res.ok) {
      info(
        `WARN ${relPath(q.file)}:${q.line} -> could not read Issue #${q.issue} ` +
          `(${res.error}); quarantine state unverified, not blocked on a guess.`,
      );
      continue;
    }
    if ((res.data.state ?? "").toUpperCase() !== "OPEN") {
      badQuarantines.push(
        `${relPath(q.file)}:${q.line} -> ${q.raw} tracks Issue #${q.issue}, ` +
          `which is ${res.data.state}`,
      );
    }
  }

  const blocking: string[] = [];
  const warning: string[] = [];
  for (const r of reports) {
    const missing = r.declared.filter((id) => !r.covered.has(id));
    if (missing.length === 0) continue;
    const where = r.feature ?? `${r.slug} (no NNN-scenarios.feature)`;
    const parked = missing.filter((id) => r.quarantined.has(id));
    const line =
      `${where} -> uncovered handler(s): ` +
      missing.map((id) => `EARS-${id}`).join(", ") +
      (parked.length > 0
        ? ` (quarantined, therefore absent: ` +
          parked.map((id) => `EARS-${id}`).join(", ") +
          `)`
        : "");
    (r.touched ? blocking : warning).push(line);
  }

  info(`scanned ${reports.length} user-facing feature spec(s).`);
  info(
    `${doorScan.bound + doorScan.quarantined} mounted-door scenario(s): ` +
      `${doorScan.bound} bound to the sign-in host, ${doorScan.quarantined} host-quarantined.`,
  );
  for (const w of warning) process.stdout.write(`${TAG} WARN ${w}\n`);
  if (warning.length > 0) {
    info(
      `${warning.length} untouched spec(s) carry uncovered handlers — WARN ` +
        `until the §8 backfill waves close (ADR-0007 §2.6 promotion applies).`,
    );
  }
  if (touched === null) {
    info(
      "the PR diff was unavailable (no base ref), so coverage findings are " +
        "reported as WARN rows rather than guessed into a BLOCK.",
    );
  }

  if (
    blocking.length === 0 &&
    badQuarantines.length === 0 &&
    doorScan.findings.length === 0
  ) {
    info(
      "PASS — every user-facing handler this PR touched is covered by a live " +
        "scenario, every mounted-door scenario is bound to the sign-in host or " +
        "host-quarantined, and every quarantine names an OPEN Issue.",
    );
    process.exit(0);
  }

  for (const b of badQuarantines) process.stderr.write(`${TAG} ${b}\n`);
  for (const b of blocking) process.stderr.write(`${TAG} ${b}\n`);
  for (const b of doorScan.findings) process.stderr.write(`${TAG} ${b}\n`);
  process.stderr.write(
    `${TAG} FAIL — ${blocking.length} touched spec(s) with an uncovered EARS ` +
      `handler, ${doorScan.findings.length} sign-in-host binding finding(s) ` +
      `(#3345) and ${badQuarantines.length} untracked quarantine(s) (tech spec ` +
      `§6.4/§6.5). Tag a live scenario in the spec's NNN-scenarios.feature with ` +
      `@EARS-N for each handler, and give every @quarantine an OPEN Issue that ` +
      `names the scenario.\n`,
  );
  process.exit(1);
}

main().catch((e) => {
  process.stderr.write(
    `${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`,
  );
  process.exit(1);
});
